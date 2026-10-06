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
const silver = fs.existsSync("data/eval/cases-silver.json")
  ? JSON.parse(fs.readFileSync("data/eval/cases-silver.json", "utf8")).cases
  : [];
const credentials = await cloudflareCredentials();
const allCases = [...spec.cases.map((c) => ({ ...c, set: "gold" })), ...silver.map((c) => ({ ...c, set: "silver" }))];
const queryVectors = await embedWithRest(credentials, allCases.map((c) => c.query));
const known = new Set(movies.map((m) => m.id));
const keywordLimits = [100, 500, 1000], hybridLimits = [100, 200, 500, 1000];
const rows = allCases.map((c, i) => {
  const relevant = c.relevant.filter((id) => known.has(id));
  const hits = (ids) => relevant.filter((id) => ids.has(id)).length;
  const semantic = index.scores(queryVectors[i]);
  const row = { set: c.set, id: c.id, query: c.query, relevant: relevant.length };
  for (const n of keywordLimits) row[`keyword${n}`] = hits(new Set(retrieve(movies, c.query, {}, {}, n).map((m) => m.id)));
  for (const n of hybridLimits) row[`hybrid${n}`] = hits(new Set(retrieve(movies, c.query, {}, {}, n, semantic).map((m) => m.id)));
  return row;
});
const summary = {};
for (const set of ["gold", "silver"]) {
  const subset = rows.filter((r) => r.set === set);
  if (!subset.length) continue;
  const total = (k) => subset.reduce((s, r) => s + r[k], 0);
  summary[set] = { cases: subset.length, relevant: total("relevant") };
  for (const k of [...keywordLimits.map((n) => `keyword${n}`), ...hybridLimits.map((n) => `hybrid${n}`)]) summary[set][k] = total(k);
}
fs.writeFileSync("data/eval/hybrid-recall.json", JSON.stringify({ generatedAt: new Date().toISOString(), model: meta.model, summary, rows }, null, 2));
console.table(rows.filter((r) => r.set === "silver").map(({ query, set, ...r }) => r));
console.log(summary);
