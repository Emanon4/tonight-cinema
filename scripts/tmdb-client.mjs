import fs from "node:fs";
import os from "node:os";
import path from "node:path";
export const cacheDir=path.resolve(import.meta.dirname,"../.cache/tmdb");
fs.mkdirSync(cacheDir, {recursive: true});
const keyFile=os.homedir()+"/.config/tmdb/api-key.txt";
const key=(process.env.TMDB_API_KEY||(fs.existsSync(keyFile)?fs.readFileSync(keyFile,"utf8"):"")).trim();
if(!key)throw Error("缺少 TMDB 凭据：设置 TMDB_API_KEY，或写入 ~/.config/tmdb/api-key.txt。");
export async function api(route, params = {}) {
  const u = new URL("https://api.themoviedb.org/3/" + route);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (!key.includes(".")) u.searchParams.set("api_key", key);
  for (let attempt = 0; attempt < 4; attempt++) {
  let r;
  try { r = await fetch(u, {
    headers: key.includes(".") ? { Authorization: "Bearer " + key } : {},
    signal: AbortSignal.timeout(25000),
  }); } catch (error) {
    if (attempt === 3) throw new Error("TMDB connection failed after 4 attempts");
    await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    continue;
  }
  if ((r.status === 429 || r.status >= 500) && attempt < 3) {
    await new Promise(resolve => setTimeout(resolve, Math.max(1000 * 2 ** attempt, Number(r.headers.get("Retry-After") || 0) * 1000)));
    continue;
  }
  if (!r.ok) throw new Error("TMDB HTTP " + r.status);
  return r.json();
  }
}
const genres = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "Historical",
  27: "Horror",
  10402: "Musical",
  9648: "Mystery",
  10749: "Romance",
  878: "Science Fiction",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
};

export async function details(id, {fresh=false}={}) {
 const file=path.join(cacheDir,`${id}.json`);
 if(!fresh&&fs.existsSync(file))return JSON.parse(fs.readFileSync(file));
 const d=await api(`movie/${id}`,{language:"zh-CN",append_to_response:"credits,translations,keywords"});
 fs.writeFileSync(file,JSON.stringify(d));return d;
}
export function normalize(d) {
 const en=d.translations?.translations?.find(t=>t.iso_639_1==="en")?.data;
 const overview=(chineseOverview(d)||d.overview||en?.overview||"").trim();
 if(!overview||!d.poster_path||d.adult)return null;
 return {id:"tmdb-"+d.id,title:en?.title||d.original_title,originalTitle:d.original_title,zh:d.title,year:Number(d.release_date?.slice(0,4)),genres:d.genres.map(g=>genres[g.id]||g.name),cast:(d.credits?.cast||[]).slice(0,6).map(c=>c.name),overview,overviewEn:en?.overview||"",poster:"https://image.tmdb.org/t/p/w342"+d.poster_path,source:"https://www.themoviedb.org/movie/"+d.id,runtime:d.runtime||null,rating:d.vote_average||null,votes:d.vote_count,provider:"TMDB",language:d.original_language,popularity:d.popularity};
}
export const titleKey=s=>(s||"").normalize("NFKD").replace(/\p{Diacritic}/gu,"").toLowerCase().replace(/^(the|a|an) /,"").replace(/[^a-z0-9]/g,"");

const tvGenres = {
  16: ["Animation"], 18: ["Drama"], 35: ["Comedy"], 36: ["Historical"], 37: ["Western"], 80: ["Crime"],
  99: ["Documentary"], 10751: ["Family"], 10759: ["Action", "Adventure"], 10762: ["Kids"],
  10763: ["News"], 10764: ["Reality"], 10765: ["Science Fiction", "Fantasy"], 9648: ["Mystery"],
  10749: ["Romance"], 10766: ["Soap"], 10767: ["Talk"], 10768: ["War"],
};
export async function seriesDetails(id, {fresh=false}={}) {
 const file=path.join(cacheDir,`tv-${id}.json`);
 if(!fresh&&fs.existsSync(file))return JSON.parse(fs.readFileSync(file));
 const d=await api(`tv/${id}`,{language:"zh-CN",append_to_response:"credits,translations,keywords"});
 fs.writeFileSync(file,JSON.stringify(d));return d;
}
// Chinese overview: Simplified first, then any other Chinese translation.
export function chineseOverview(d) {
 if(d.overview&&/[\u4e00-\u9fff]/.test(d.overview))return d.overview.trim();
 const zh=(d.translations?.translations||[]).filter(t=>t.iso_639_1==="zh").map(t=>t.data?.overview).find(o=>o&&o.trim());
 return zh?.trim()||"";
}
export function seriesRuntime(d) {
 return (d.episode_run_time||[]).find(v=>Number(v)>0)||d.last_episode_to_air?.runtime||d.next_episode_to_air?.runtime||null;
}
export function normalizeSeries(d) {
 const en=d.translations?.translations?.find(t=>t.iso_639_1==="en")?.data;
 const overview=(chineseOverview(d)||en?.overview||"").trim();
 if(!overview||!d.poster_path||d.adult)return null;
 return {id:`tmdb-tv-${d.id}`,mediaType:"series",title:en?.name||d.original_name,originalTitle:d.original_name,zh:d.name,year:Number(d.first_air_date?.slice(0,4)),genres:[...new Set((d.genres||[]).flatMap(g=>tvGenres[g.id]||[g.name]))],cast:(d.credits?.cast||[]).slice(0,6).map(c=>c.name),overview,overviewEn:en?.overview||"",poster:`https://image.tmdb.org/t/p/w342${d.poster_path}`,source:`https://www.themoviedb.org/tv/${d.id}`,runtime:seriesRuntime(d),rating:d.vote_average||null,votes:d.vote_count,provider:"TMDB",language:d.original_language,popularity:d.popularity,seasons:d.number_of_seasons||null,episodes:d.number_of_episodes||null,status:d.status||""};
}

// Extra evidence for Jev: keywords, a tagline and who made it.
export function enrichment(d, mediaType) {
 const kw=(d.keywords?.keywords||d.keywords?.results||[]).map(k=>k.name).slice(0,20);
 const en=d.translations?.translations?.find(t=>t.iso_639_1==="en")?.data;
 const tagline=(d.tagline||en?.tagline||"").trim();
 const director=mediaType==="series"
  ? (d.created_by||[]).map(c=>c.name).slice(0,2).join(" / ")
  : (d.credits?.crew||[]).filter(c=>c.job==="Director").map(c=>c.name).slice(0,2).join(" / ");
 return {keywords:kw,tagline:tagline||undefined,director:director||undefined};
}
