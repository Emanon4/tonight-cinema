import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {toWorkerMovie} from '../server/catalog.mjs';
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
for (let start=0; start<movies.length; start+=250) {
  const part=movies.slice(start,start+250);
  const filename=`details-${version}-${start/250}.json`;
  fs.writeFileSync(path.join(browserDir,filename),JSON.stringify(part.map(({id,overview,cast,trailer,watch})=>({id,overview,cast,trailer,watch}))));
  for (const m of part) {
    const {overview,overviewEn,cast,originalTitle,popularity,votes,tagline,keywords,director,trailer,watch,...card}=m;
    index.push({...card,detailChunk:filename});
  }
}
fs.writeFileSync(path.join(browserDir,`index-${version}.json`),JSON.stringify(index));
const parts=[];
for (let start=0; start<movies.length; start+=1000) {
  const name=`movies-${start/1000}.json`;
  const records = movies.slice(start,start+1000).map(toWorkerMovie);
  fs.writeFileSync(path.join(workerDir,name),JSON.stringify(records));
  parts.push(name);
}
// Semantic vectors are optional: without them the Worker uses keyword recall only.
let vectors=null;
const metaFile=path.join(root,'data/embeddings/meta.json'), binFile=path.join(root,'data/embeddings/vectors.i8');
if (fs.existsSync(metaFile) && fs.existsSync(binFile)) {
  const meta=JSON.parse(fs.readFileSync(metaFile)), bin=fs.readFileSync(binFile);
  const known=new Set(movies.map(m=>m.id));
  if (bin.length !== meta.ids.length*meta.dims) throw Error('Embedding file does not match meta.json');
  const stale=meta.ids.filter(id=>!known.has(id)).length, missing=movies.length-meta.ids.filter(id=>known.has(id)).length;
  fs.writeFileSync(path.join(workerDir,'vectors.i8'),bin);
  fs.writeFileSync(path.join(workerDir,'vectors.json'),JSON.stringify({model:meta.model,dims:meta.dims,ids:meta.ids}));
  vectors={model:meta.model,dims:meta.dims,count:meta.ids.length,hash:createHash('sha256').update(bin).digest('hex').slice(0,16)};
  if (stale||missing) console.warn(`Embeddings: ${missing} titles without vectors, ${stale} stale rows. Run npm run embeddings.`);
}
fs.writeFileSync(path.join(workerDir,'manifest.json'),JSON.stringify({version,count:movies.length,parts,vectors}));
const configPath=path.join(root,'wrangler.jsonc');
const config=JSON.parse(fs.readFileSync(configPath));
config.vars.CATALOG_VERSION=version;
config.vars.CATALOG_COUNT=movies.length;
fs.writeFileSync(configPath,JSON.stringify(config,null,2)+'\n');
console.log(`Prepared ${movies.length} titles; browser index ${(Buffer.byteLength(JSON.stringify(index))/1024/1024).toFixed(2)} MiB; ${parts.length} worker shards; vectors ${vectors?`${vectors.count}×${vectors.dims}`:'none'}`);
