import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const raw = fs.readFileSync(path.join(root, 'public/data/movies.json'));
const movies = JSON.parse(raw);
const version = createHash('sha256').update(raw).digest('hex').slice(0,16);
const browserDir = path.join(root, 'public/data/catalog');
const workerDir = path.join(root, '.cache/worker-assets');
// Both directories contain only generated catalog assets.
for (const dir of [browserDir, workerDir]) {
  fs.rmSync(dir, {recursive:true, force:true});
  fs.mkdirSync(dir, {recursive:true});
}
const index = [];
for (let start=0; start<movies.length; start+=500) {
  const part=movies.slice(start,start+500);
  const filename=`details-${version}-${start/500}.json`;
  fs.writeFileSync(path.join(browserDir,filename),JSON.stringify(part.map(({id,overview,cast})=>({id,overview,cast}))));
  for (const m of part) {
    const {overview,overviewEn,cast,originalTitle,popularity,votes,...card}=m;
    index.push({...card,detailChunk:filename});
  }
}
fs.writeFileSync(path.join(browserDir,`index-${version}.json`),JSON.stringify(index));
const parts=[];
for (let start=0; start<movies.length; start+=1000) {
  const name=`movies-${start/1000}.json`;
  const records = movies.slice(start,start+1000).map(({id,title,zh,year,runtime,genres,cast,overview,overviewEn}) => ({id,title,zh,year,runtime,genres,cast,overview,overviewEn}));
  fs.writeFileSync(path.join(workerDir,name),JSON.stringify(records));
  parts.push(name);
}
fs.writeFileSync(path.join(workerDir,'manifest.json'),JSON.stringify({version,count:movies.length,parts}));
const configPath=path.join(root,'wrangler.jsonc');
const config=JSON.parse(fs.readFileSync(configPath));
config.vars.CATALOG_VERSION=version;
config.vars.CATALOG_COUNT=movies.length;
fs.writeFileSync(configPath,JSON.stringify(config,null,2)+'\n');
console.log(`Prepared ${movies.length} films; browser index ${(Buffer.byteLength(JSON.stringify(index))/1024/1024).toFixed(2)} MiB; ${parts.length} worker shards`);
