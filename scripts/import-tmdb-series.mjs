import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const key = (
  process.env.TMDB_API_KEY ||
  fs.readFileSync(os.homedir() + "/.config/tmdb/api-key.txt", "utf8")
).trim();
const cacheDir = path.join(root, ".cache/tmdb-series");
fs.mkdirSync(cacheDir, { recursive: true });
const dest = path.join(root, "public/data/movies.json");
const existing = fs.existsSync(dest) ? JSON.parse(fs.readFileSync(dest)) : [];
const target = Number(process.env.SERIES_TARGET || 2400);
if (!Number.isSafeInteger(target) || target < 1) throw Error("Invalid SERIES_TARGET");

async function api(route, params = {}) {
  const u = new URL("https://api.themoviedb.org/3/" + route);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const headers = key.includes(".") ? { Authorization: "Bearer " + key } : {};
  if (!key.includes(".")) u.searchParams.set("api_key", key);
  for (let attempt = 0; attempt < 4; attempt++) {
    let response;
    try {
      response = await fetch(u, { headers, signal: AbortSignal.timeout(25000) });
    } catch (error) {
      if (attempt === 3) throw new Error("TMDB connection failed after 4 attempts");
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
      continue;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, Math.max(
        1000 * 2 ** attempt,
        Number(response.headers.get("Retry-After") || 0) * 1000,
      )));
      continue;
    }
    if (!response.ok) throw Error(`TMDB HTTP ${response.status}`);
    return response.json();
  }
}

const languages = ["", "en", "ja", "ko", "zh", "fr", "de", "es", "it", "ru", "pt", "tr", "hi", "ar", "sv", "da", "no", "fi", "pl", "nl"];
const existingIds = new Set(existing.map(movie => movie.id));
const seeds = new Map();
const today = new Date().toISOString().slice(0, 10);
const maxPages = Math.max(1, Math.ceil(target / 20));

for (const language of languages) {
  for (let page = 1; page <= maxPages; page++) {
    const params = {
      language: "zh-CN",
      sort_by: "popularity.desc",
      include_adult: "false",
      "first_air_date.lte": today,
      "vote_average.gte": "7.5",
      "vote_count.gte": "100",
      page,
      ...(language ? { with_original_language: language } : {}),
    };
    const file = path.join(cacheDir, `discover-${language || "all"}-${page}.json`);
    let data;
    if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file));
    else {
      data = await api("discover/tv", params);
      fs.writeFileSync(file, JSON.stringify(data));
    }
    for (const row of data.results || []) {
      if (row.id && row.poster_path && Number(row.vote_average) >= 7.5 && Number(row.vote_count) >= 100)
        seeds.set(row.id, row);
    }
    if (!data.results?.length || page >= data.total_pages) break;
    if (!language && seeds.size >= target) break;
  }
  console.log(`Discovered ${language || "all"}: ${seeds.size} series`);
  if (seeds.size >= target) break;
}

const seedList = [...seeds.values()].filter(row => !existingIds.has(`tmdb-tv-${row.id}`));
const added = [];
const failures = [];
let cursor = 0;
const genreNames = {
  16: ["Animation"], 18: ["Drama"], 35: ["Comedy"], 36: ["Historical"], 37: ["Western"], 80: ["Crime"],
  99: ["Documentary"], 10751: ["Family"], 10759: ["Action", "Adventure"],
  10762: ["Family"], 10763: ["Documentary"], 10764: ["Documentary"], 10765: ["Science Fiction", "Fantasy"],
  10749: ["Romance"], 10766: ["Drama"], 10767: ["Drama"], 10768: ["War"],
};

async function worker() {
  while (cursor < seedList.length) {
    const row = seedList[cursor++];
    try {
      const file = path.join(cacheDir, `${row.id}.json`);
      let d;
      if (fs.existsSync(file)) d = JSON.parse(fs.readFileSync(file));
      else {
        d = await api(`tv/${row.id}`, {
          language: "zh-CN",
          append_to_response: "credits,translations",
        });
        fs.writeFileSync(file, JSON.stringify(d));
      }
      const en = d.translations?.translations?.find(t => t.iso_639_1 === "en")?.data;
      const overview = (d.overview || en?.overview || "").trim();
      if (!overview || !d.poster_path || d.adult) continue;
      const runtime = (d.episode_run_time || []).find(value => Number(value) > 0) || null;
      added.push({
        id: `tmdb-tv-${d.id}`,
        mediaType: "series",
        title: en?.name || d.original_name,
        originalTitle: d.original_name,
        zh: d.name,
        year: Number(d.first_air_date?.slice(0, 4)),
        genres: [...new Set((d.genres || []).flatMap(g => genreNames[g.id] || [g.name]))],
        cast: (d.aggregate_credits?.cast || d.credits?.cast || []).slice(0, 6).map(c => c.name),
        overview,
        overviewEn: en?.overview || "",
        poster: `https://image.tmdb.org/t/p/w342${d.poster_path}`,
        source: `https://www.themoviedb.org/tv/${d.id}`,
        runtime,
        rating: d.vote_average || null,
        votes: d.vote_count,
        provider: "TMDB",
        language: d.original_language,
        popularity: d.popularity,
        seasons: d.number_of_seasons || null,
        episodes: d.number_of_episodes || null,
        status: d.status || "",
      });
    } catch (error) {
      failures.push({ id: row.id, error: error.message });
    }
  }
}
await Promise.all(Array.from({ length: 12 }, worker));

const all = [...existing, ...added].map(movie => ({
  mediaType: movie.mediaType || "movie",
  ...movie,
}));
const unique = [...new Map(all.map(movie => [movie.id, movie])).values()];
if (unique.length < existing.length || !unique.every(movie => movie.overview && movie.poster && movie.source))
  throw Error("Series catalog integrity failed");
fs.writeFileSync(dest + ".next", JSON.stringify(unique));
fs.renameSync(dest + ".next", dest);
console.log(JSON.stringify({ previousCount: existing.length, added: added.length, total: unique.length, discovered: seeds.size, failures }, null, 2));
