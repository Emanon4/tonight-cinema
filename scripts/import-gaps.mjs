import fs from "node:fs";
import path from "node:path";
import { api, details, normalize, seriesDetails, normalizeSeries, enrichment } from "./tmdb-client.mjs";

// Fills two measured gaps: series that already meet the quality bar but were
// missed by the popularity-ordered import, and East/Southeast Asian titles
// that are acclaimed but under-rated in TMDB's mostly Western vote counts
// (深夜食堂 has 69 votes). The low-vote route demands a higher rating.
const root = path.resolve(import.meta.dirname, "..");
const dest = path.join(root, "public/data/movies.json");
const movies = JSON.parse(fs.readFileSync(dest));
const existing = new Set(movies.map((m) => m.id));
const lowSignal = new Set(["Talk", "News", "Reality", "Soap"]);
const routes = [
  { kind: "tv", name: "series-bar", params: { "vote_average.gte": 7.5, "vote_count.gte": 100 }, min: { rating: 7.5, votes: 100 } },
  ...["ja", "ko", "zh", "cn", "th"].map((l) => ({ kind: "tv", name: `regional-tv-${l}`, params: { "vote_average.gte": 8.0, "vote_count.gte": 20, with_original_language: l }, min: { rating: 8.0, votes: 20 } })),
  ...["ja", "ko", "zh", "cn"].map((l) => ({ kind: "movie", name: `regional-movie-${l}`, params: { "vote_average.gte": 7.7, "vote_count.gte": 30, with_original_language: l }, min: { rating: 7.7, votes: 30 } })),
];
const seeds = new Map();
for (const r of routes) {
  for (let page = 1; page <= 500; page++) {
    const data = await api(`discover/${r.kind}`, { language: "zh-CN", include_adult: "false", sort_by: "vote_count.desc", page, ...r.params });
    for (const row of data.results || []) {
      const id = r.kind === "tv" ? `tmdb-tv-${row.id}` : `tmdb-${row.id}`;
      if (row.poster_path && !existing.has(id) && !seeds.has(id)) seeds.set(id, { route: r, tmdb: row.id });
    }
    if (page >= data.total_pages || !data.results?.length) break;
  }
  console.log(`${r.name}: ${seeds.size} new candidates so far`);
}
const added = [], rejected = [], failures = [];
const list = [...seeds.values()];
let cursor = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (cursor < list.length) {
    const { route, tmdb } = list[cursor++];
    try {
      const d = route.kind === "tv" ? await seriesDetails(tmdb) : await details(tmdb);
      const m = route.kind === "tv" ? normalizeSeries(d) : normalize(d);
      if (!m || !m.year || m.rating < route.min.rating || m.votes < route.min.votes || m.genres.some((g) => lowSignal.has(g))) { rejected.push(tmdb); continue; }
      const countries = [...new Set([...(d.origin_country || []), ...(d.production_countries || []).map((c) => c.iso_3166_1)])].slice(0, 4);
      added.push({ mediaType: "movie", ...m, ...enrichment(d, route.kind === "tv" ? "series" : "movie"), countries, addedBy: route.name });
    } catch (e) { failures.push({ tmdb, error: e.message }); }
  }
}));
if (failures.length > 20) throw Error(`${failures.length} failures; catalog unchanged`);
const result = [...movies, ...added];
if (new Set(result.map((m) => m.id)).size !== result.length) throw Error("Catalog integrity failed");
fs.writeFileSync(dest + ".next", JSON.stringify(result));
fs.renameSync(dest + ".next", dest);
const byRoute = {};
for (const m of added) byRoute[m.addedBy] = (byRoute[m.addedBy] || 0) + 1;
fs.writeFileSync(path.join(root, "data/curation/gap-import-report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), routes: routes.map((r) => ({ name: r.name, ...r.min })), previousCount: movies.length, total: result.length, byRoute, rejected: rejected.length, failures, added: added.map((m) => ({ id: m.id, zh: m.zh, rating: m.rating, votes: m.votes, route: m.addedBy })) }, null, 2));
console.log(JSON.stringify({ added: added.length, byRoute, rejected: rejected.length, failures: failures.length, total: result.length }, null, 2));
