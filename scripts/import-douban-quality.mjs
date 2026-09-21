import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { api as tmdbApi, details, normalize } from "./tmdb-client.mjs";

const root = path.resolve(import.meta.dirname, "..");
const dest = path.join(root, "public/data/movies.json");
const cacheDir = path.join(root, ".cache/douban");
fs.mkdirSync(cacheDir, { recursive: true });
const movies = JSON.parse(fs.readFileSync(dest, "utf8")).map(movie => ({
  ...movie,
  mediaType: movie.mediaType || "movie",
}));

// These are public Douban classifications. The endpoint returns at most 300
// subjects per tag; the report records the collected scope instead of claiming
// that a public page is a complete export of every Douban movie.
const tags = [
  "经典", "电影", "动画", "剧情", "纪录片", "犯罪", "战争", "奇幻", "家庭",
  "同性", "音乐", "传记", "历史", "短片", "文艺", "青春", "科幻", "喜剧",
  "爱情", "动作", "悬疑", "惊悚", "黑色幽默",
];
const minimumDoubanRating = 7.5;
const minimumTmdbRating = 7;
const minimumTmdbVotes = 100;
const userAgent = "TonightCinema/quality-import (+https://emanon4.github.io/tonight-cinema/)";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const keyOf = value => (value || "")
  .normalize("NFKD")
  .toLowerCase()
  .replace(/\p{M}/gu, "")
  .replace(/[^\p{L}\p{N}]+/gu, "");

async function json(url, file) {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": userAgent,
          Accept: "application/json,text/plain,*/*",
          Referer: "https://movie.douban.com/explore/movie/",
        },
        signal: AbortSignal.timeout(20000),
      });
      if (response.status === 429 || response.status >= 500) {
        throw Error(`Douban HTTP ${response.status}`);
      }
      if (!response.ok) throw Error(`Douban HTTP ${response.status}`);
      const data = await response.json();
      fs.writeFileSync(file, JSON.stringify(data));
      return data;
    } catch (error) {
      last = error;
      if (attempt < 3) await sleep(500 * 2 ** attempt);
    }
  }
  throw last;
}

function cacheFile(prefix, value) {
  return path.join(cacheDir, `${prefix}-${keyOf(value).slice(0, 100) || "empty"}.json`);
}

const subjects = new Map();
for (const tag of tags) {
  for (let start = 0; start <= 300; start += 100) {
    const u = new URL("https://movie.douban.com/j/search_subjects");
    for (const [k, v] of Object.entries({
      type: "movie", tag, sort: "recommend", page_limit: 100, page_start: start,
    })) u.searchParams.set(k, v);
    const data = await json(u, cacheFile("tag", `${tag}-${start}`));
    const rows = data.subjects || [];
    for (const row of rows) {
      const rating = Number(row.rate);
      if (row.id && row.title && Number.isFinite(rating) && rating > minimumDoubanRating)
        subjects.set(String(row.id), { ...row, doubanRating: rating, doubanTag: tag });
    }
    if (rows.length < 100) break;
    await sleep(120);
  }
  console.log(`Douban tag ${tag}: ${subjects.size} high-rated unique subjects`);
}

const suggestions = [];
let suggestionCursor = 0;
const subjectRows = [...subjects.values()];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (suggestionCursor < subjectRows.length) {
    const row = subjectRows[suggestionCursor++];
    const file = cacheFile("suggest", row.id);
    let data;
    try {
      data = await json(
        `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(row.title)}`,
        file,
      );
    } catch (error) {
      suggestions.push({ row, error: error.message });
      continue;
    }
    const candidates = (data || []).filter(x => x.type === "movie");
    let chosen = candidates.find(x => String(x.id) === String(row.id)) ||
      candidates.find(x => keyOf(x.title) === keyOf(row.title));
    if (!chosen) {
      try {
        const canonical = await json(
          `https://movie.douban.com/j/subject/${row.id}/`,
          cacheFile("subject", row.id),
        );
        if (canonical?.title) chosen = { title: canonical.title, sub_title: row.title, year: "" };
      } catch (error) {
        suggestions.push({ row, suggestion: null, error: error.message });
        continue;
      }
    }
    suggestions.push({ row, suggestion: chosen || null });
    await sleep(80);
  }
}));

function names(movie) {
  return [movie.zh, movie.title, movie.originalTitle].filter(Boolean).map(keyOf);
}
const byName = new Map();
for (const movie of movies) for (const name of names(movie)) {
  if (!name) continue;
  if (!byName.has(name)) byName.set(name, []);
  byName.get(name).push(movie);
}

function matchLocal(suggestion, row) {
  const year = Number(suggestion?.year);
  const keys = [row?.title, suggestion?.title, suggestion?.sub_title].map(keyOf).filter(Boolean);
  const matches = keys.flatMap(key => byName.get(key) || []);
  const unique = [...new Map(matches.map(movie => [movie.id, movie])).values()];
  return unique.find(movie => !year || Math.abs(Number(movie.year) - year) <= 2) || unique[0] || null;
}

const matched = [];
const unmatched = [];
for (const item of suggestions) {
  const suggestion = item.suggestion;
  const movie = matchLocal(suggestion, item.row);
  if (movie) {
    movie.doubanRating = item.row.doubanRating;
    movie.doubanSource = `https://movie.douban.com/subject/${item.row.id}/`;
    movie.doubanTags = [...new Set([...(movie.doubanTags || []), item.row.doubanTag])];
    matched.push({ id: movie.id, doubanId: item.row.id, title: item.row.title, rating: item.row.doubanRating });
  } else {
    unmatched.push({ row: item.row, suggestion, error: item.error });
  }
}

// Try TMDB title/year search for high-rated Douban subjects absent from the
// current catalog. Detail normalization still requires a poster and overview.
const existingIds = new Set(movies.map(movie => movie.id));
const additions = [];
let tmdbCursor = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (tmdbCursor < unmatched.length) {
    const item = unmatched[tmdbCursor++];
    const suggestion = item.suggestion || { title: item.row.title, sub_title: "", year: "" };
    const query = suggestion.sub_title || suggestion.title || item.row.title;
    if (!query) continue;
    const targetYear = Number(suggestion.year);
    const dataFile = cacheFile("tmdb-search", `${query}-${targetYear || "none"}`);
    let data;
    try {
      if (fs.existsSync(dataFile)) data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
      else {
        const params = { query, language: "zh-CN", include_adult: "false" };
        if (targetYear) params.year = targetYear;
        data = await tmdbApi("search/movie", params);
        fs.writeFileSync(dataFile, JSON.stringify(data));
      }
    } catch (error) {
      item.tmdbError = error.message;
      continue;
    }
    const results = (data.results || []).filter(result => result.poster_path && !result.adult);
    const result = results.find(candidate =>
      (!targetYear || Math.abs(Number(candidate.release_date?.slice(0, 4)) - targetYear) <= 2) &&
      [candidate.title, candidate.original_title].some(name =>
        [item.row.title, suggestion.title, suggestion.sub_title].some(target => keyOf(name) === keyOf(target)),
      ),
    ) || results.find(candidate => !targetYear || Math.abs(Number(candidate.release_date?.slice(0, 4)) - targetYear) <= 2);
    if (!result || existingIds.has(`tmdb-${result.id}`)) continue;
    try {
      const movie = normalize(await details(result.id));
      if (!movie) continue;
      movie.doubanRating = item.row.doubanRating;
      movie.doubanSource = `https://movie.douban.com/subject/${item.row.id}/`;
      movie.doubanTags = [item.row.doubanTag];
      movie.addedBy = "douban-rating";
      additions.push(movie);
      existingIds.add(movie.id);
    } catch (error) {
      item.tmdbError = error.message;
    }
  }
}));

const before = movies.length;
const all = [...new Map([...movies, ...additions].map(movie => [movie.id, movie])).values()];
const keep = movie =>
  Number(movie.doubanRating) > minimumDoubanRating ||
  movie.recognition?.length ||
  (Number(movie.rating) >= minimumTmdbRating && Number(movie.votes) >= minimumTmdbVotes);
const result = all.filter(keep).sort((a, b) =>
  (b.popularity || 0) - (a.popularity || 0) || a.id.localeCompare(b.id),
);
const removed = all.filter(movie => !keep(movie));
const ids = new Set(result.map(movie => movie.id));
const invalid = result.filter(movie => !movie.overview || !movie.poster || !movie.source);
if (ids.size !== result.length || invalid.length) {
  console.error(JSON.stringify({ duplicateCount: result.length - ids.size, invalidCount: invalid.length, invalid: invalid.slice(0, 5) }, null, 2));
  throw Error("Quality catalog integrity failed");
}

fs.writeFileSync(dest + ".next", JSON.stringify(result));
fs.renameSync(dest + ".next", dest);
const report = {
  generatedAt: new Date().toISOString(),
  source: "Douban public tag search + TMDB detail records",
  scope: { tags, pageLimit: 100, maxPageStart: 300, minimumDoubanRating },
  policy: { minimumTmdbRating, minimumTmdbVotes, keepRecognition: true },
  previousCount: before,
  added: additions.length,
  matchedExisting: matched.length,
  totalBeforeQualityFilter: all.length,
  total: result.length,
  removed: removed.length,
  doubanSubjects: subjectRows.length,
  doubanMatched: matched.length + additions.length,
  unresolved: subjectRows.length - matched.length - additions.length,
  failures: unmatched.filter(item => item.error || item.tmdbError).length,
  catalogReasons: {
    doubanRating: result.filter(movie => Number(movie.doubanRating) > minimumDoubanRating).length,
    recognition: result.filter(movie => movie.recognition?.length && !(Number(movie.doubanRating) > minimumDoubanRating)).length,
    tmdbQuality: result.filter(movie =>
      !(Number(movie.doubanRating) > minimumDoubanRating) && !movie.recognition?.length &&
      Number(movie.rating) >= minimumTmdbRating && Number(movie.votes) >= minimumTmdbVotes,
    ).length,
  },
  catalogByType: {
    movie: result.filter(movie => movie.mediaType === "movie").length,
    series: result.filter(movie => movie.mediaType === "series").length,
  },
  removedSamples: removed.slice(0, 100).map(movie => ({ id: movie.id, title: movie.zh, rating: movie.rating, votes: movie.votes })),
  unmatchedSamples: unmatched.slice(0, 200).map(item => ({ title: item.row.title, rating: item.row.doubanRating, suggestion: item.suggestion?.sub_title || item.suggestion?.title, error: item.error || item.tmdbError })),
};
fs.writeFileSync(path.join(root, "data/curation/douban-quality-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
