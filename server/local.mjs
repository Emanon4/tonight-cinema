import http from 'node:http';import fs from 'node:fs';import os from 'node:os';import {recommend,validInput} from './core.mjs';
const movies=JSON.parse(fs.readFileSync(new URL('../public/data/movies.json',import.meta.url)));const key=process.env.TYPESAFE_API_KEY||fs.readFileSync(os.homedir()+'/.config/typesafe/api-key.txt','utf8').trim();
const cache=new Map();let busy=0;
http.createServer(async(req,res)=>{const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(req.headers.origin&&!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(req.headers.origin))return send(403,{error:'Origin denied'});
 if(req.url==='/api/health')return send(200,{ready:!!key,engine:'jev',catalogCount:movies.length,accessRequired:false});
 if(req.url!=='/api/recommend'||req.method!=='POST')return send(404,{error:'Not found'});
 try{let body='';for await(const part of req){body+=part;if(body.length>4096)return send(413,{error:'请求过长。'});}let b;try{b=JSON.parse(body);}catch{return send(400,{error:'请求格式错误。'});}
 if(!validInput(b))return send(400,{error:'请输入 2—300 字的观影需求。'});
 const id=JSON.stringify([b.query.trim(),b.filters]);if(cache.has(id))return send(200,{...cache.get(id),cached:true});
 if(busy>=2)return send(429,{error:'正在挑选电影，请稍后重试。'});busy++;
 try{const result=await recommend({...b,query:b.query.trim(),movies,key});cache.set(id,result);if(cache.size>100)cache.delete(cache.keys().next().value);send(200,result);}finally{busy--;}
 }catch(e){send(502,{error:e.name==='TimeoutError'?'Jev 响应超时，请手动重试。':e.message||'筛选失败。'});}
}).listen(8793,'127.0.0.1',()=>console.log(`Cinema API http://127.0.0.1:8793 · ${movies.length} films · Jev ${key?'ready':'missing'}`));
