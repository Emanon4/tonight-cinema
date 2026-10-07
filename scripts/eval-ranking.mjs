import fs from "node:fs";
import os from "node:os";
import { recommend as recommendNew, RECALL_VERSION } from "../server/core.mjs";
import { createSemanticIndex, embedWithRest } from "../server/semantic.mjs";
import { cloudflareCredentials } from "./cloudflare-credentials.mjs";

// Paid A/B on the hand-labeled cases: hits@12 for the previous pipeline
// (v7, 500 candidates, single score) versus the current one. Labels are
// incomplete, so absolute hits understate precision; compare the two columns.
if (!process.argv.includes("--live")) throw Error("Use --live: this makes many paid Jev calls.");
// Baseline: git show <commit>:server/core.mjs > scripts/.core-baseline.tmp.mjs
const oldPath = process.env.OLD_CORE || "./.core-baseline.tmp.mjs";
const { recommend: recommendOld } = await import(oldPath);
const only = process.env.CASES ? new Set(process.env.CASES.split(",")) : null;
const movies = JSON.parse(fs.readFileSync("public/data/movies.json", "utf8"));
const spec = JSON.parse(fs.readFileSync("data/eval/cases.json", "utf8"));
const meta = JSON.parse(fs.readFileSync("data/embeddings/meta.json"));
const bin = fs.readFileSync("data/embeddings/vectors.i8");
const index = createSemanticIndex({ ids: meta.ids, dims: meta.dims, vectors: new Int8Array(bin.buffer, bin.byteOffset, bin.length) });
const credentials = await cloudflareCredentials();
const key = fs.readFileSync(os.homedir() + "/.config/typesafe/api-key.txt", "utf8").trim();
const cases = spec.cases.filter((c) => !only || only.has(c.id));
const vectors = await embedWithRest(credentials, cases.map((c) => c.query));
const out = { generatedAt: new Date().toISOString(), newVersion: RECALL_VERSION, rows: [] };
const file = process.env.OUTPUT || "data/eval/ranking-ab.json";
for (const [i, c] of cases.entries()) {
  const semantic = async () => index.scores(vectors[i]);
  const row = { id: c.id, query: c.query, relevant: c.relevant.length };
  for (const [name, fn] of [["old", recommendOld], ["new", recommendNew]]) {
    const t = Date.now();
    const r = await fn({ query: c.query, movies, key, semantic });
    const top = r.results.map((x) => x.id);
    row[name] = {
      hits12: c.relevant.filter((id) => top.includes(id)).length,
      returned: top.length,
      leaked: (c.exclude || []).filter((id) => top.includes(id)),
      calls: r.modelRequestCount, inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens,
      ms: Date.now() - t, vetoed: r.vetoed, partial: r.partial,
      titles: top.map((id) => movies.find((m) => m.id === id)?.zh),
    };
  }
  out.rows.push(row);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`${c.id}: hits@12 ${row.old.hits12} → ${row.new.hits12} / ${c.relevant.length}; tokens ${row.old.inputTokens} → ${row.new.inputTokens}; ${row.old.ms}ms → ${row.new.ms}ms`);
}
const sum = (k, f) => out.rows.reduce((s, r) => s + r[k][f], 0);
out.summary = Object.fromEntries(["old", "new"].map((k) => [k, { hits12: sum(k, "hits12"), inputTokens: sum(k, "inputTokens"), outputTokens: sum(k, "outputTokens"), calls: sum(k, "calls"), ms: sum(k, "ms") }]));
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.summary, null, 2));
