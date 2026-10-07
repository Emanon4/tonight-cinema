import fs from "node:fs";
import path from "node:path";
import { api, details, normalize, seriesDetails, normalizeSeries, enrichment } from "./tmdb-client.mjs";

// Incremental refresh for scheduled runs: titles first released in the last
// RECENT_MONTHS that already meet the catalog's quality gate. Existing IDs are
// never removed or rewritten here.
const root = path.resolve(import.meta.dirname, "..");
const dest = path.join(root, "public/data/movies.json");
const movies = JSON.parse(fs.readFileSync(dest));
const existing = new Set(movies.map((m) => m.id));
const months = Number(process.env.RECENT_MONTHS || 18);
const since = new Date(Date.now() - months * 30.4 * 86400000).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);
const gate = { movie: { rating: 7, votes: 100 }, series: { rating: 7.5, votes: 100 } };
const lowSignal = new Set(["Talk", "News", "Reality", "Soap"]);

async function discover(kind) {
  const dateKey = kind === "movie" ? "primary_release_date" : "first_air_date";
  const ids = new Set();
  for (let page = 1; page <= 25; page++) {
    const data = await api(`discover/${kind === "movie" ? "movie" : "tv"}`, {
      language: "zh-CN", sort_by: "vote_count.desc", include_adult: "false",
      [`${dateKey}.gte`]: since, [`${dateKey}.lte`]: today,
      "vote_average.gte": gate[kind].rating, "vote_count.gte": gate[kind].votes, page,
    });
    for (const row of data.results || []) if (row.poster_path) ids.add(row.id);
    if (page >= data.total_pages || !data.results?.length) break;
  }
  return [...ids];
}

const added = [], rejected = [], failures = [];
for (const kind of ["movie", "series"]) {
  const ids = (await discover(kind)).filter((id) => !existing.has(kind === "movie" ? `tmdb-${id}` : `tmdb-tv-${id}`));
  let cursor = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      try {
        const d = kind === "movie" ? await details(id) : await seriesDetails(id);
        const m = kind === "movie" ? normalize(d) : normalizeSeries(d);
        if (m) Object.assign(m, enrichment(d, kind));
        if (!m || !m.year || m.rating < gate[kind].rating || m.votes < gate[kind].votes ||
            m.genres.some((g) => lowSignal.has(g))) { rejected.push({ id, kind }); continue; }
        added.push({ mediaType: "movie", ...m, addedBy: "scheduled-recent" });
      } catch (e) { failures.push({ id, kind, error: e.message }); }
    }
  }));
}
if (failures.length > 10) throw Error(`${failures.length} TMDB failures; catalog unchanged.`);
const result = [...movies, ...added];
if (new Set(result.map((m) => m.id)).size !== result.length) throw Error("Catalog integrity failed");
fs.writeFileSync(dest + ".next", JSON.stringify(result));
fs.renameSync(dest + ".next", dest);
const report = { generatedAt: new Date().toISOString(), since, gate, previousCount: movies.length, total: result.length,
  added: added.map((m) => ({ id: m.id, title: m.zh || m.title, year: m.year, mediaType: m.mediaType })), rejected: rejected.length, failures };
fs.writeFileSync(path.join(root, "data/curation/recent-import-report.json"), JSON.stringify(report, null, 2));
console.log(`Added ${added.length} recent titles (${rejected.length} rejected, ${failures.length} failures); total ${result.length}`);
