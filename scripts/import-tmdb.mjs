import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const key = (
  process.env.TMDB_API_KEY ||
  fs.readFileSync(os.homedir() + "/.config/tmdb/api-key.txt", "utf8")
).trim();
const cacheDir = path.join(root, ".cache/tmdb");
fs.mkdirSync(cacheDir, { recursive: true });
const target = Number(process.env.CATALOG_TARGET || 50000);
if (!Number.isSafeInteger(target) || target < 1) throw Error("Invalid CATALOG_TARGET");
const dest = path.join(root, "public/data/movies.json");
const existing = fs.existsSync(dest) ? JSON.parse(fs.readFileSync(dest)) : [];
if (target < existing.length) throw Error("Expansion cannot shrink the existing catalog");
async function api(route, params = {}) {
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
// Discover across languages plus broad popularity; exclude adult titles, future releases, and weak metadata.
const seeds = new Map();
const languages = ["", "en", "zh", "cn", "ja", "ko", "fr", "it", "es", "de", "hi", "fa", "ru", "pt", "tr", "th", "sv", "da", "pl", "id", "ar", "he", "fi", "no", "cs", "hu", "el", "ta", "te", "ml", "bn", "nl", ...Array.from({length:13}, (_,i)=>"decade-"+(1900+i*10))];
for (const m of existing) seeds.set(Number(m.id.replace("tmdb-", "")), {id: Number(m.id.replace("tmdb-", ""))});
const exhausted = new Set();
const seedTarget = Math.ceil(target * 1.1);
// Keep a small, explicitly identified editorial shelf independent of current popularity.
const shelf=[['The Grand Budapest Hotel',2014],['Interstellar',2014],['La La Land',2016],['Her',2013],['Fantastic Mr. Fox',2009],['The Truman Show',1998],['The Secret Life of Walter Mitty',2013],['Soul',2020],['Before Sunrise',1995],['The Royal Tenenbaums',2001],['Arrival',2016],['Moonrise Kingdom',2012],['In the Mood for Love',2000],['Spirited Away',2001],['Chungking Express',1994],['Parasite',2019]];
for(const [title,year] of shelf){
 const file=path.join(cacheDir,`shelf-${title.replace(/[^a-z0-9]/gi,'_')}-${year}.json`);
 let d;if(fs.existsSync(file))d=JSON.parse(fs.readFileSync(file));else{d=await api('search/movie',{query:title,year,language:'en-US',include_adult:'false'});fs.writeFileSync(file,JSON.stringify(d));}
 const m=d.results?.find(x=>(x.title.toLowerCase()===title.toLowerCase()||x.original_title.toLowerCase()===title.toLowerCase())&&Number(x.release_date?.slice(0,4))===year);
 if(m)seeds.set(m.id,m);
}

for (let page = 1; seeds.size < seedTarget && page <= 500; page++) {
  const active = languages.filter(language => !exhausted.has(language));
  if (!active.length) break;
  for (let start = 0; start < active.length; start += 8) {
  await Promise.all(active.slice(start, start + 8).map(async language => {
    const params = {
      language: "zh-CN",
      sort_by: "popularity.desc",
      include_adult: "false",
      "primary_release_date.lte": new Date().toISOString().slice(0, 10),
      "vote_count.gte": 10,
      page,
      ...(language.startsWith("decade-") ? {
        "primary_release_date.gte": language.slice(7) + "-01-01",
        "primary_release_date.lte": Math.min(Number(language.slice(7))+9,new Date().getUTCFullYear()) + "-" + (Number(language.slice(7))+9 >= new Date().getUTCFullYear() ? new Date().toISOString().slice(5,10) : "12-31"),
      } : language ? { with_original_language: language } : {}),
    };
    const file = path.join(
      cacheDir,
      `discover-v2-${language || "all"}-${page}.json`,
    );
    let d;
    if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 86400000) d = JSON.parse(fs.readFileSync(file));
    else {
      d = await api("discover/movie", params);
      fs.writeFileSync(file, JSON.stringify(d));
    }
    for (const m of d.results || [])
      if (m.poster_path && m.id) seeds.set(m.id, m);
    if (!d.results?.length || page >= d.total_pages) exhausted.add(language);
  }));
  }
  console.log("Discovered", seeds.size);
}
const existingIds = new Set(existing.map(m => Number(m.id.replace("tmdb-", ""))));
const seedList = [...seeds.values()].filter(m => !existingIds.has(m.id));
const result = [...existing];
let cursor = 0,
  failed = 0;
async function worker() {
  while (cursor < seedList.length && result.length < target) {
    const seed = seedList[cursor++];
    try {
      const file = path.join(cacheDir, `${seed.id}.json`);
      let d;
      if (fs.existsSync(file)) d = JSON.parse(fs.readFileSync(file));
      else {
        d = await api("movie/" + seed.id, {
          language: "zh-CN",
          append_to_response: "credits,translations",
        });
        fs.writeFileSync(file, JSON.stringify(d));
      }
      const en = d.translations?.translations?.find(
        (t) => t.iso_639_1 === "en",
      )?.data;
      const overview = d.overview || en?.overview;
      if (!overview || !d.poster_path || d.adult || result.length >= target) continue;
      result.push({
        id: "tmdb-" + d.id,
        title: en?.title || d.original_title,
        originalTitle: d.original_title,
        zh: d.title,
        year: Number(d.release_date?.slice(0, 4)),
        genres: d.genres.map((g) => genres[g.id] || g.name),
        cast: (d.credits?.cast || []).slice(0, 6).map((c) => c.name),
        overview,
        overviewEn: en?.overview || "",
        poster: "https://image.tmdb.org/t/p/w342" + d.poster_path,
        source: "https://www.themoviedb.org/movie/" + d.id,
        runtime: d.runtime || null,
        rating: d.vote_average || null,
        votes: d.vote_count,
        provider: "TMDB",
        language: d.original_language,
        popularity: d.popularity,
      });
      if (result.length % 100 === 0) console.log("Imported", result.length);
    } catch (e) {
      failed++;
      console.error("Movie", seed.id, e.message);
      if (failed >= 10)
        throw Error(
          "Stopped after 10 failures; existing catalog remains intact.",
        );
    }
  }
}
await Promise.all(Array.from({ length: 12 }, worker));
result.sort((a, b) => b.popularity - a.popularity || a.id.localeCompare(b.id));
if (result.length < target)
  throw Error("Too few valid records; refusing to replace catalog.");
fs.writeFileSync(dest + ".next", JSON.stringify(result));
fs.renameSync(dest + ".next", dest);
const { createHash } = await import("node:crypto");
const configPath = path.join(root, "wrangler.jsonc");
const config = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/,\s*([}\]])/g, "$1"));
config.vars.CATALOG_VERSION = createHash("sha256")
  .update(fs.readFileSync(dest))
  .digest("hex")
  .slice(0, 16);
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
console.log(
  JSON.stringify({
    imported: result.length,
    failed,
    languages: [...new Set(result.map((x) => x.language))],
  }),
);
