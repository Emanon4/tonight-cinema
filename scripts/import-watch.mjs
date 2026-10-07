import fs from "node:fs";
import path from "node:path";
import { api } from "./tmdb-client.mjs";

// Official trailer + where-to-watch (TMDB data provided by JustWatch) for each
// title. Stored only in browser detail chunks, so recall data stays lean.
// Mainland China has no JustWatch coverage; the page links platform searches.
const root = path.resolve(import.meta.dirname, "..");
const dest = path.join(root, "public/data/movies.json");
const cache = path.join(root, ".cache/tmdb-watch");
fs.mkdirSync(cache, { recursive: true });
const REGIONS = ["HK", "TW", "SG", "US", "JP", "KR", "GB"];
const KINDS = { flatrate: "订阅", free: "免费", ads: "免费（含广告）", rent: "租借", buy: "购买" };
const movies = JSON.parse(fs.readFileSync(dest));
const fresh = process.argv.includes("--fresh");

function pickTrailer(videos, original) {
  const yt = (videos || []).filter((v) => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser"));
  const rank = (v) => (v.type === "Trailer" ? 0 : 4) + (v.official ? 0 : 2) +
    (v.iso_639_1 === "zh" ? 0 : v.iso_639_1 === original ? 1 : v.iso_639_1 === "en" ? 1.5 : 3);
  const best = yt.sort((a, b) => rank(a) - rank(b))[0];
  return best ? { key: best.key, name: best.name, lang: best.iso_639_1 } : undefined;
}
function compactProviders(results = {}) {
  const out = {};
  for (const r of REGIONS) {
    const p = results[r];
    if (!p) continue;
    const region = { link: p.link };
    for (const k of Object.keys(KINDS))
      if (p[k]?.length) region[k] = p[k].slice(0, 6).map((x) => ({ n: x.provider_name, l: x.logo_path }));
    if (Object.keys(region).length > 1) out[r] = region;
  }
  return Object.keys(out).length ? out : undefined;
}

let cursor = 0, done = 0, trailers = 0, watch = 0;
const failures = [];
await Promise.all(Array.from({ length: 10 }, async () => {
  while (cursor < movies.length) {
    const m = movies[cursor++];
    const tv = m.mediaType === "series";
    const id = m.id.replace(/^tmdb-(tv-)?/, "");
    const file = path.join(cache, `${tv ? "tv" : "movie"}-${id}.json`);
    try {
      let d;
      if (!fresh && fs.existsSync(file)) d = JSON.parse(fs.readFileSync(file));
      else {
        d = await api(`${tv ? "tv" : "movie"}/${id}`, { language: "zh-CN", append_to_response: "videos,watch/providers", include_video_language: `zh,${m.language},en,null` });
        d = { videos: d.videos, providers: d["watch/providers"] };
        fs.writeFileSync(file, JSON.stringify(d));
      }
      const trailer = pickTrailer(d.videos?.results, m.language);
      const w = compactProviders(d.providers?.results);
      if (trailer) { m.trailer = trailer; trailers++; } else delete m.trailer;
      if (w) { m.watch = w; watch++; } else delete m.watch;
    } catch (e) { failures.push({ id: m.id, error: e.message }); }
    if (++done % 1000 === 0) console.log(`${done}/${movies.length}`);
  }
}));
if (failures.length > 50) throw Error(`${failures.length} failures; catalog unchanged`);
fs.writeFileSync(dest + ".next", JSON.stringify(movies));
fs.renameSync(dest + ".next", dest);
console.log(`trailers ${trailers}, watch data ${watch}, failures ${failures.length}`);
