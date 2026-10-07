import fs from "node:fs";
import path from "node:path";

// Adds `countries` (ISO 3166-1, origin first) from cached TMDB details, so
// requests like "美剧" or "港片" can tell a US series from a British one.
const root = path.resolve(import.meta.dirname, "..");
const cache = path.join(root, ".cache/tmdb");
const dest = path.join(root, "public/data/movies.json");
const movies = JSON.parse(fs.readFileSync(dest));
let filled = 0, missing = 0;
for (const m of movies) {
  const id = m.id.replace(/^tmdb-(tv-)?/, "");
  const file = path.join(cache, m.mediaType === "series" ? `tv-${id}.json` : `${id}.json`);
  if (!fs.existsSync(file)) { missing++; continue; }
  const d = JSON.parse(fs.readFileSync(file));
  const list = [...(d.origin_country || []), ...(d.production_countries || []).map((c) => c.iso_3166_1)];
  const countries = [...new Set(list)].slice(0, 4);
  if (countries.length) { m.countries = countries; filled++; }
}
fs.writeFileSync(dest + ".next", JSON.stringify(movies));
fs.renameSync(dest + ".next", dest);
console.log(`countries for ${filled} titles; ${missing} without cached details`);
