import fs from "node:fs";
import { retrieve, parseFilters, filtered } from "../server/core.mjs";

const movies = JSON.parse(fs.readFileSync("public/data/movies.json", "utf8"));
const spec = JSON.parse(fs.readFileSync("data/eval/cases.json", "utf8"));
const baselinePath = "data/eval/baseline-retrieve.json";
const baseline = fs.existsSync(baselinePath)
  ? JSON.parse(fs.readFileSync(baselinePath, "utf8"))
  : { cases: {} };

function summarize(cands, relevant) {
  const ids = cands.map((m) => m.id);
  const hits = relevant.filter((id) => ids.includes(id));
  return { ids, titles: cands.map((m) => `${m.zh || m.title} (${m.year}, ${m.language})`), hits };
}

function scoreCase(c, after, before) {
  const afterHits = after.hits.length;
  const beforeHits = (before || []).filter((id) => c.relevant.includes(id)).length;
  const missing = c.require?.filter((id) => !after.ids.includes(id)) || [];
  const leaked = c.exclude?.filter((id) => after.ids.includes(id)) || [];
  return { afterHits, beforeHits, missing, leaked };
}

const after = {};
const rows = [];
for (const c of spec.cases) {
  const cands = retrieve(movies, c.query, {}, {}, spec.candidateLimit);
  after[c.id] = { query: c.query, ...summarize(cands, c.relevant) };
  const beforeIds = baseline.cases[c.id]?.ids || [];
  const s = scoreCase(c, after[c.id], beforeIds);
  rows.push({ id: c.id, query: c.query, ...s, after: after[c.id] });
  const f = parseFilters(c.query, {});
  const badFilter = cands.filter((m) => !filtered([m], f).length);
  console.log(`\n#### ${c.id}`);
  console.log(c.query);
  console.log(`hits ${s.beforeHits} → ${s.afterHits} / ${c.relevant.length}`);
  if (s.missing.length) console.log("missing required", s.missing);
  if (s.leaked.length) console.log("leaked excluded", s.leaked);
  if (badFilter.length) console.log("broke hard filter", badFilter.map((m) => m.id));
  console.log(after[c.id].titles.map((t, i) => `${i + 1}. ${t}`).join("\n"));
}

const beforeTotal = rows.reduce((n, r) => n + r.beforeHits, 0);
const afterTotal = rows.reduce((n, r) => n + r.afterHits, 0);
const improved = rows.filter((r) => r.afterHits > r.beforeHits).length;
const worsened = rows.filter((r) => r.afterHits < r.beforeHits).length;
const hitAny = rows.filter((r) => r.afterHits > 0).length;
const out = {
  savedAt: new Date().toISOString().slice(0, 10),
  engine: "retrieve-v2",
  limit: spec.candidateLimit,
  beforeTotal,
  afterTotal,
  improved,
  worsened,
  hitAny,
  cases: after,
};
fs.writeFileSync("data/eval/after-retrieve.json", JSON.stringify(out, null, 2));
console.log("\n==== summary ====");
console.log(`relevant hits ${beforeTotal} → ${afterTotal}`);
console.log(`cases improved ${improved}, worsened ${worsened}, any-hit ${hitAny}/${rows.length}`);
