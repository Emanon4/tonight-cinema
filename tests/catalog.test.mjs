import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogLoader, toWorkerMovie} from '../server/catalog.mjs';
import {retrieve} from '../server/core.mjs';
import fs from 'node:fs';
function environment({version='v1',badPart=false}={}) {
  const calls=[];
  const data={
    '/manifest.json':{version,count:2,parts:['a.json','b.json']},
    '/a.json':[{id:'a'}], '/b.json':badPart ? [{id:'a'}] : [{id:'b'}],
  };
  return {calls,env:{CATALOG_VERSION:'v1',CATALOG_COUNT:2,ASSETS:{fetch:async url=>{
    const path=new URL(url).pathname;calls.push(path);return Response.json(data[path]);
  }}}};
}
test('concurrent catalog reads load once and retain every shard',async()=>{
 const {env,calls}=environment();const load=createCatalogLoader();
 const [a,b]=await Promise.all([load(env),load(env)]);
 assert.deepEqual(a.map(m=>m.id),['a','b']);assert.strictEqual(a,b);assert.equal(calls.length,3);
});
test('failed catalog loads can recover, and mixed versions are rejected',async()=>{
 const load=createCatalogLoader();
 await assert.rejects(load(environment({version:'old'}).env),/版本不一致/);
 assert.equal((await load(environment().env)).length,2);
});
test('duplicate movie IDs in shards cannot masquerade as a complete catalog',async()=>{
 await assert.rejects(createCatalogLoader()(environment({badPart:true}).env),/不完整/);
});

test('production shards preserve the same recall as the complete local catalog', () => {
 const movies = JSON.parse(fs.readFileSync('public/data/movies.json'));
 const projected = JSON.parse(JSON.stringify(movies.map(toWorkerMovie)));
 for (const query of ['想看一部日本电影，关于家庭和日常', '想看影史经典科幻片', '像《盗梦空间》一样，让我脑子转起来']) {
  assert.deepEqual(retrieve(projected,query,{}, {},100).map(m=>m.id),retrieve(movies,query,{}, {},100).map(m=>m.id));
 }
});
