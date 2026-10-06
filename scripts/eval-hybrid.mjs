import fs from "node:fs";
import { retrieve } from "../server/core.mjs";
import { createSemanticIndex, embedWithRest } from "../server/semantic.mjs";
import { cloudflareCredentials } from "./cloudflare-credentials.mjs";

// Offline recall of labeled titles: keyword-only vs keyword+semantic fusion.
const movies = JSON.parse(fs.readFileSync("public/data/movies.json", "utf8"));
const spec = JSON.parse(fs.readFileSync("data/eval/cases.json", "utf8"));
const meta = JSON.parse(fs.readFileSync("data/embeddings/meta.json"));
const bin = fs.readFileSync("data/embeddings/vectors.i8");
const index = createSemanticIndex({ ids: meta.ids, dims: meta.dims, vectors: new Int8Array(bin.buffer, bin.byteOffset, bin.length) });
const credentials = await cloudflareCredentials();
const queryVectors = await embedWithRest(credentials, spec.cases.map((c) => c.query));
const known = new Set(movies.map((m) => m.id));
const keywordLimits = [500, 1000], hybridLimits = [200, 500, 1000];
const rows = spec.cases.map((c, i) => {
  const relevant = c.relevant.filter((id) => known.has(id));
  const hits = (ids) => relevant.filter((id) => ids.has(id)).length;
  const semantic = index.scores(queryVectors[i]);
  const row = { id: c.id, query: c.query, relevant: relevant.length };
  for (const n of keywordLimits) row[`keyword${n}`] = hits(new Set(retrieve(movies, c.query, {}, {}, n).map((m) => m.id)));
  for (const n of hybridLimits) row[`hybrid${n}`] = hits(new Set(retrieve(movies, c.query, {}, {}, n, semantic).map((m) => m.id)));
  return row;
});
const total = (k) => rows.reduce((s, r) => s + r[k], 0);
const summary = { relevant: total("relevant") };
for (const k of [...keywordLimits.map((n) => `keyword${n}`), ...hybridLimits.map((n) => `hybrid${n}`)]) summary[k] = total(k);
fs.writeFileSync("data/eval/hybrid-recall.json", JSON.stringify({ generatedAt: new Date().toISOString(), model: meta.model, summary, rows }, null, 2));
console.table(rows.map(({ query, ...r }) => r));
console.log(summary);
