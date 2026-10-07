import fs from "node:fs";
import os from "node:os";
import { recommend, retrieve } from "../server/core.mjs";
import { createSemanticIndex, embedWithRest } from "../server/semantic.mjs";
import { cloudflareCredentials } from "./cloudflare-credentials.mjs";

// Pools titles for human grading: production picks, spares, and recalled
// titles Jev passed over (to catch false negatives). Order is shuffled and the
// source hidden from the rater; sources stay in the file for analysis.
if (!process.argv.includes("--live")) throw Error("Use --live: about 27 paid Jev calls per query.");
const extra = [
  "适合一个人深夜看的韩剧", "像《请回答1988》那样温暖的剧集", "节奏很快、一口气看完的悬疑美剧",
  "80年代的香港电影，江湖气重一点", "不要太长的动画电影，适合周末下午", "像《海边的曼彻斯特》那样克制的悲伤",
  "让人笑到停不下来的英式喜剧", "关于创业和商战的电影", "宫崎骏以外的温柔日本动画",
  "女性视角的成长故事", "看完想好好吃饭的美食剧集", "冷门但高分的欧洲艺术片",
];
const gold = JSON.parse(fs.readFileSync("data/eval/cases.json", "utf8")).cases.map((c) => c.query);
const silver = JSON.parse(fs.readFileSync("data/eval/cases-silver.json", "utf8")).cases.map((c) => c.query);
const queries = [...new Set([...gold, ...silver, ...extra])];
const movies = JSON.parse(fs.readFileSync("public/data/movies.json", "utf8"));
const byId = new Map(movies.map((m) => [m.id, m]));
const meta = JSON.parse(fs.readFileSync("data/embeddings/meta.json"));
const bin = fs.readFileSync("data/embeddings/vectors.i8");
const index = createSemanticIndex({ ids: meta.ids, dims: meta.dims, vectors: new Int8Array(bin.buffer, bin.byteOffset, bin.length) });
const vectors = await embedWithRest(await cloudflareCredentials(), queries);
const key = fs.readFileSync(os.homedir() + "/.config/typesafe/api-key.txt", "utf8").trim();
const file = "data/eval/rating-pool.json";
const done = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)).queries : [];
const out = { generatedAt: new Date().toISOString(), queries: done };
// Deterministic shuffle so the pool is reproducible.
const shuffle = (arr, seed) => { const a = [...arr]; let s = seed; for (let i = a.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = Math.floor((s / 233280) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
let cursor = 0;
const todo = queries.map((q, i) => [q, i]).filter(([q]) => !done.some((d) => d.query === q));
await Promise.all(Array.from({ length: 2 }, async () => {
  while (cursor < todo.length) {
    const [query, i] = todo[cursor++];
    const semantic = index.scores(vectors[i]);
    const r = await recommend({ query, movies, key, semantic: async () => semantic });
    const items = new Map();
    r.results.forEach((x) => items.set(x.id, "picked"));
    r.more.slice(0, 4).forEach((x) => items.has(x.id) || items.set(x.id, "spare"));
    for (const m of retrieve(movies, query, {}, {}, 60, semantic)) {
      if (items.size >= 20) break;
      if (!items.has(m.id) && ![...items.keys()].includes(m.id)) items.set(m.id, "recalled");
    }
    const entries = shuffle([...items.entries()], i + 7).map(([id, source]) => {
      const m = byId.get(id);
      return { id, source, zh: m.zh || m.title, title: m.title, year: m.year, mediaType: m.mediaType || "movie", genres: m.genres, language: m.language, overview: (m.overview || "").slice(0, 170) };
    });
    out.queries.push({ qid: `q${String(i + 1).padStart(2, "0")}`, query, items: entries });
    out.queries.sort((a, b) => a.qid.localeCompare(b.qid));
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log(`${out.queries.length}/${queries.length} ${query}: ${entries.length} titles`);
  }
}));
console.log(`Done: ${out.queries.reduce((n, q) => n + q.items.length, 0)} titles to rate`);
