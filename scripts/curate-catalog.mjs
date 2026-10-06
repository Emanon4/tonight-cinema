import fs from "node:fs";
import path from "node:path";

// Talk shows, news, reality and soap-opera series with only fan-driven TMDB
// ratings do not fit a curated film/series catalog. Keep them when Douban or a
// documented list vouches for them.
const root = path.resolve(import.meta.dirname, "..");
const dest = path.join(root, "public/data/movies.json");
const lowSignal = new Set(["Talk", "News", "Reality", "Soap"]);
const movies = JSON.parse(fs.readFileSync(dest));
const removed = [], kept = [];
for (const m of movies) {
  const flagged = m.genres.some((g) => lowSignal.has(g));
  const vouched = Number(m.doubanRating) > 7.5 || m.recognition?.length;
  if (flagged && !vouched) removed.push({ id: m.id, title: m.title, zh: m.zh, genres: m.genres, rating: m.rating });
  else kept.push(m);
}
fs.writeFileSync(dest + ".next", JSON.stringify(kept));
fs.renameSync(dest + ".next", dest);
fs.writeFileSync(path.join(root, "data/curation/genre-cleanup-report.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  policy: "Remove series tagged Talk/News/Reality/Soap unless doubanRating > 7.5 or recognition exists.",
  previousCount: movies.length, total: kept.length, removed,
}, null, 2));
console.log(`Removed ${removed.length}; ${kept.length} titles remain`);
