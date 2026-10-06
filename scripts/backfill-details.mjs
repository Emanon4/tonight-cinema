import fs from "node:fs";
import path from "node:path";
import { details, seriesDetails, chineseOverview, seriesRuntime } from "./tmdb-client.mjs";

// Fills missing runtimes and Chinese overviews without touching IDs or adding titles.
const root = path.resolve(import.meta.dirname, "..");
const dest = path.join(root, "public/data/movies.json");
const movies = JSON.parse(fs.readFileSync(dest));
const hasChinese = (s) => /[一-鿿]/.test(s || "");
const todo = movies.filter((m) => !m.runtime || !hasChinese(m.overview));
console.log(`${todo.length} titles lack a runtime or Chinese overview`);
let cursor = 0, runtimes = 0, overviews = 0;
const failures = [];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (cursor < todo.length) {
    const m = todo[cursor++];
    const tmdbId = m.id.replace(/^tmdb-(tv-)?/, "");
    try {
      // Fresh fetch for series: cached copies predate the runtime fallback fields.
      const d = m.mediaType === "series" ? await seriesDetails(tmdbId, { fresh: true }) : await details(tmdbId);
      const runtime = m.mediaType === "series" ? seriesRuntime(d) : d.runtime;
      if (!m.runtime && runtime > 0) { m.runtime = runtime; runtimes++; }
      const zh = chineseOverview(d);
      if (!hasChinese(m.overview) && zh) {
        if (!m.overviewEn) m.overviewEn = m.overview;
        m.overview = zh; overviews++;
      }
    } catch (e) { failures.push({ id: m.id, error: e.message }); }
  }
}));
fs.writeFileSync(dest + ".next", JSON.stringify(movies));
fs.renameSync(dest + ".next", dest);
fs.writeFileSync(path.join(root, "data/curation/backfill-report.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), checked: todo.length, runtimes, overviews,
  stillMissingRuntime: movies.filter((m) => !m.runtime).length,
  stillMissingChinese: movies.filter((m) => !hasChinese(m.overview)).length, failures,
}, null, 2));
console.log(`Filled ${runtimes} runtimes and ${overviews} Chinese overviews; ${failures.length} failures`);
