import fs from 'node:fs';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {recommend, RECALL_VERSION, retrieve} from '../server/core.mjs';

// Explicit opt-in: this benchmark makes uncached, paid recommendations.
if (!process.argv.includes('--live')) throw Error('Use --live to run real Jev recommendations; no automatic retry.');
const raw = fs.readFileSync('public/data/movies.json');
const movies = JSON.parse(raw), byId = new Map(movies.map(m=>[m.id,m]));
const key = fs.readFileSync(os.homedir()+'/.config/typesafe/api-key.txt','utf8').trim();
const queries = ['想看一部日本电影，关于家庭和日常', '孤独但不悲伤，想看人与人相遇的故事', '像《盗梦空间》一样，让我脑子转起来，两小时以内'];
const runs = [];
const limits = (process.env.BENCHMARK_LIMITS || '24,100').split(',').map(Number);
if (!limits.length || limits.some(limit => !Number.isInteger(limit) || limit < 1 || limit > 500)) throw Error('Invalid BENCHMARK_LIMITS');
const file = process.env.BENCHMARK_OUTPUT || `data/eval/benchmark-${limits.at(-1)}.json`;
const report = {generatedAt:new Date().toISOString(),catalogCount:movies.length,catalogVersion:createHash('sha256').update(raw).digest('hex').slice(0,16),recallVersion:RECALL_VERSION,limits,method:'Same full catalog and corrected metadata; three fixed queries, one uncached run per configuration, alternating order. Includes network + intent + retrieval + ranking, excludes catalog loading and browser. Small sample, not an SLA or proof of preference quality.',runs};
for (const [i,query] of queries.entries()) {
  const variants = limits.map(candidateLimit => ({candidateLimit,batchSize:candidateLimit <= 24 ? 8 : 20,concurrency:5}));
  if(i%2) variants.reverse();
  for (const variant of variants) {
    let calls=0; const requestTimings=[];
    const start=performance.now();
    try {
      const result = await recommend({query,filters:{genre:'',decade:'all',maxRuntime:''},movies,key,...variant,fetcher:async(url,options)=>{
        const payload=JSON.parse(options.body), t=performance.now(); calls++;
        const response=await fetch(url,options);
        const data=await response.json();
        requestTimings.push({kind:payload.state.movies?'ranking':'intent',candidates:payload.state.movies?.length||0,ms:Math.round(performance.now()-t),status:response.status});
        return Response.json(data,{status:response.status});
      }});
      const row={query,...variant,wallMs:Math.round(performance.now()-start),elapsedMs:result.elapsedMs,candidateCount:result.candidateCount,calls,usage:result.usage,model:result.model,requestTimings,results:result.results.map(r=>({...r,title:byId.get(r.id).zh,runtime:byId.get(r.id).runtime,language:byId.get(r.id).language}))};
      runs.push(row);fs.writeFileSync(file,JSON.stringify(report,null,2));
      console.log(JSON.stringify({query,limit:variant.candidateLimit,wallMs:row.wallMs,calls,usage:row.usage,results:row.results.map(r=>r.title)}));
    } catch(error) {
      runs.push({query,...variant,error:error.message,wallMs:Math.round(performance.now()-start),calls,requestTimings});
      fs.writeFileSync(file,JSON.stringify(report,null,2));throw error;
    }
  }
}
// Separate offline evidence from model rankings: labeled recall is not liking probability.
const spec=JSON.parse(fs.readFileSync('data/eval/cases.json'));
report.offline=spec.cases.map(c=>({id:c.id,query:c.query,relevant:c.relevant.length,...Object.fromEntries(limits.map(limit=>{
  const ids=new Set(retrieve(movies,c.query,{}, {},limit).map(m=>m.id));
  return [`hits${limit}`,c.relevant.filter(id=>ids.has(id)).length];
}))}));
fs.writeFileSync(file,JSON.stringify(report,null,2));
