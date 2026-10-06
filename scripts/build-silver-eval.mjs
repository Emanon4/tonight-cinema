import fs from "node:fs";
import os from "node:os";
import { retrieve, rankingPayload, readRanking, jev, parseFilters, filtered } from "../server/core.mjs";
import { createSemanticIndex, embedWithRest } from "../server/semantic.mjs";
import { cloudflareCredentials } from "./cloudflare-credentials.mjs";

// Silver labels: pool candidates from three recall methods so no single method
// defines "relevant", then let Jev score the pool. These are model judgements
// pending human review, kept apart from the hand-labeled cases.json.
if (!process.argv.includes("--live")) throw Error("Use --live: this makes paid Jev calls (about 4 per query).");
const queries = [
  "想看一部让人笑出声的喜剧，轻松不费脑", "适合和爸妈一起看的温情电影", "关于成长和青春期的电影，有点怀旧",
  "下雨天在家看的安静文艺片", "节奏紧张的悬疑推理，结局有反转", "关于友情的公路旅行电影",
  "法国爱情片，浪漫但不俗套", "像宫崎骏那样温柔的动画", "二战题材的战争片，但不要太血腥",
  "关于美食和烹饪的电影", "太空探索题材的科幻片", "讲母亲与女儿关系的电影",
  "黑色幽默的犯罪片", "适合周末追的高分英剧", "关于失去与疗愈，看完想哭但很温暖",
  "西班牙语的好电影", "关于人工智能和人性的科幻", "小人物逆袭的体育电影",
  "看完让人想去旅行的电影", "关于老年人生活的电影，平静动人",
];
const POOL = 80, THRESHOLD = 2.3;
const movies = JSON.parse(fs.readFileSync("public/data/movies.json", "utf8"));
const byId = new Map(movies.map((m) => [m.id, m]));
const meta = JSON.parse(fs.readFileSync("data/embeddings/meta.json"));
const bin = fs.readFileSync("data/embeddings/vectors.i8");
const index = createSemanticIndex({ ids: meta.ids, dims: meta.dims, vectors: new Int8Array(bin.buffer, bin.byteOffset, bin.length) });
const vectors = await embedWithRest(await cloudflareCredentials(), queries);
const key = fs.readFileSync(os.homedir() + "/.config/typesafe/api-key.txt", "utf8").trim();
const cases = [];
let calls = 0;
for (const [i, query] of queries.entries()) {
  const semantic = index.scores(vectors[i]);
  const hard = filtered(movies, parseFilters(query, {}));
  const pool = [];
  const add = (list, n) => { for (const m of list) { if (pool.length >= POOL) break; if (n-- <= 0) break; if (!pool.some((p) => p.id === m.id)) pool.push(m); } };
  add(retrieve(movies, query, {}, {}, 30), 30);
  add(retrieve(movies, query, {}, {}, 30, semantic), 30);
  add(hard.slice().sort((a, b) => semantic.get(b.id) - semantic.get(a.id)), 30);
  const scores = [];
  for (let s = 0; s < pool.length; s += 20) {
    const batch = pool.slice(s, s + 20);
    calls++;
    scores.push(...readRanking(await jev(rankingPayload(query, batch), key), batch));
  }
  const relevant = scores.filter((x) => x.score >= THRESHOLD).sort((a, b) => b.score - a.score).map((x) => x.id);
  cases.push({ id: `silver-${String(i + 1).padStart(2, "0")}`, query, pooled: pool.length, relevant });
  console.log(`${query} → ${relevant.length}/${pool.length}: ${relevant.slice(0, 5).map((id) => byId.get(id).zh).join("、")}`);
}
fs.writeFileSync("data/eval/cases-silver.json", JSON.stringify({
  note: "银标准：三种召回方式各取前 30 合并成候选池（最多 80 部），由 Jev 逐部评分，得分 ≥ 2.3 记为相关。是模型判断，不是人工标注；用于补充覆盖面，待人工复核。",
  generatedAt: new Date().toISOString(), threshold: THRESHOLD, jevCalls: calls, cases,
}, null, 2));
console.log(`Wrote ${cases.length} silver cases with ${calls} Jev calls`);
