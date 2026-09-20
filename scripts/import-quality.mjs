import fs from 'node:fs';
import path from 'node:path';
import {api,details,normalize,titleKey} from './tmdb-client.mjs';
const root=path.resolve(import.meta.dirname,'..');
const dest=path.join(root,'public/data/movies.json');
const cache=path.join(root,'.cache/curation');fs.mkdirSync(cache,{recursive:true});
const movies=JSON.parse(fs.readFileSync(dest));
const originalIds=new Set(movies.map(m=>m.id));
const byId=new Map(movies.map(m=>[Number(m.id.slice(5)),m]));
const byTitle=new Map();
for(const m of movies)for(const title of new Set([m.title,m.originalTitle,m.zh])){
 const k=titleKey(title);if(!k)continue;if(!byTitle.has(k))byTitle.set(k,[]);byTitle.get(k).push(m);
}
const refs=JSON.parse(fs.readFileSync(path.join(root,'data/curation/reference-lists.json')));
const overrides=JSON.parse(fs.readFileSync(path.join(root,'data/curation/match-overrides.json')));
const resolved=[],unresolved=[],seeds=new Map();
let next=0;
await Promise.all(Array.from({length:6},async()=>{
 while(next<refs.length){
  const ref=refs[next++];
  if(overrides[ref.title]) {
   const d=await details(overrides[ref.title].id);
   resolved.push({...ref,tmdbId:d.id,tmdbYear:Number(d.release_date.slice(0,4)),matchMethod:overrides[ref.title].verifiedBy});
   seeds.set(d.id,{id:d.id,reason:'reference-list'});continue;
  }
  const local=[...new Map((byTitle.get(titleKey(ref.title))||[]).filter(m=>Math.abs(m.year-ref.year)<=2).map(m=>[m.id,m])).values()];
  let candidates=local.map(m=>({id:Number(m.id.slice(5)),title:m.title,original_title:m.originalTitle,release_date:String(m.year)}));
  if(candidates.length!==1){
   const file=path.join(cache,'search-'+titleKey(ref.title)+'-'+ref.year+'.json');
   const data=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):await api('search/movie',{query:ref.title,language:'en-US',include_adult:'false'});
   if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify(data));
   candidates=(data.results||[]).filter(m=>Math.abs(Number(m.release_date?.slice(0,4))-ref.year)<=2&&[m.title,m.original_title].some(t=>titleKey(t)===titleKey(ref.title)));
  }
  if(candidates.length!==1){unresolved.push({...ref,candidates});continue;}
  const candidate=candidates[0];
  resolved.push({...ref,tmdbId:candidate.id,tmdbYear:Number(candidate.release_date?.slice(0,4))});
  seeds.set(candidate.id,{id:candidate.id,reason:'reference-list'});
 }
}));
fs.writeFileSync(path.join(cache,'reference-audit.json'),JSON.stringify({resolved,unresolved},null,2));
console.log('Reference rows:',resolved.length,'resolved,',unresolved.length,'need review');
// Separate audience evidence from critic-list recognition. Never pad to a target size.
const cutoffYear=new Date().getUTCFullYear()-2;
for(let start=1900;start<=cutoffYear;start+=10){
 const end=Math.min(start+9,cutoffYear);let count=0;
 for(let page=1;page<=500;page++){
  const file=path.join(cache,`quality-${start}-${end}-${page}.json`);
  const params={language:'zh-CN',sort_by:'vote_average.desc',include_adult:'false','primary_release_date.gte':`${start}-01-01`,'primary_release_date.lte':`${end}-12-31`,'vote_average.gte':7,'vote_count.gte':start<1970?50:200,page};
  const d=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):await api('discover/movie',params);
  if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify(d));
  for(const m of d.results||[]){count++;if(m.poster_path&&!seeds.has(m.id))seeds.set(m.id,{id:m.id,reason:'audience-rating'});}
  if(page>=d.total_pages||!d.results?.length)break;
 }
 console.log('Quality decade',start,'candidates',count,'unique',seeds.size);
}
const rejected=[];const newIds=[];let cursor=0;const list=[...seeds.values()];
await Promise.all(Array.from({length:12},async()=>{
 while(cursor<list.length){
  const seed=list[cursor++];if(byId.has(seed.id))continue;
  const d=await details(seed.id);const m=normalize(d);
  const canonical=seed.reason==='reference-list';
  const eligible=canonical||(m&&m.year<=cutoffYear&&m.rating>=7&&m.votes>=(m.year<1970?50:200));
  if(!m||!eligible){rejected.push({id:seed.id,reason:!m?'missing metadata or adult':'rating threshold changed'});continue;}
  m.addedBy=canonical?'reference-list':'audience-rating';byId.set(seed.id,m);newIds.push(m.id);
  if(newIds.length%100===0)console.log('Added',newIds.length);
 }
}));
for(const ref of resolved){
 const m=byId.get(ref.tmdbId);if(!m)continue;
 m.recognition ||= [];
 if(!m.recognition.some(r=>r.list===ref.list))m.recognition.push({list:ref.list,url:ref.url});
}
const result=[...byId.values()].sort((a,b)=>b.popularity-a.popularity||a.id.localeCompare(b.id));
const resultIds=new Set(result.map(m=>m.id));
if(!result.every(m=>m.id&&m.overview)||resultIds.size!==result.length||!movies.every(m=>resultIds.has(m.id)))throw Error('Catalog integrity failed');
fs.writeFileSync(dest+'.next',JSON.stringify(result));fs.renameSync(dest+'.next',dest);
const report={generatedAt:new Date().toISOString(),previousCount:originalIds.size,total:result.length,added:newIds.length,canonicalAdded:newIds.filter(id=>byId.get(Number(id.slice(5)))?.recognition?.length).length,recognized:result.filter(m=>m.recognition?.length).length,referenceRows:refs.length,resolvedRows:resolved.length,unresolved,rejected,newIds,policy:{rating:7,votesBefore1970:50,votesSince1970:200,releasedThrough:cutoffYear}};
fs.writeFileSync(path.join(root,'data/curation/import-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,newIds:undefined,unresolved:report.unresolved.map(r=>r.title)},null,2));
