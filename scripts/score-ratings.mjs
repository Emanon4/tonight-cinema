import fs from "node:fs";

// Scores the rating pool: precision of production picks, quality of spares,
// and how often Jev passed over titles the rater judged a strong fit.
const pool = JSON.parse(fs.readFileSync("data/eval/rating-pool.json", "utf8"));
const file = process.argv[2] || "data/eval/claude-ratings.json";
const ratings = JSON.parse(fs.readFileSync(file, "utf8")).ratings;
const bySource = { picked: [], spare: [], recalled: [] };
const perQuery = [];
for (const q of pool.queries) {
  const r = ratings[q.qid];
  if (!r) continue;
  const picked = q.items.filter((it) => it.source === "picked" && r[it.id] >= 0);
  for (const it of q.items) if (r[it.id] >= 0) bySource[it.source].push(r[it.id]);
  perQuery.push({ qid: q.qid, query: q.query, n: picked.length, strong: picked.filter((it) => r[it.id] === 2).length, miss: picked.filter((it) => r[it.id] === 0).map((it) => it.zh), passedOver: q.items.filter((it) => it.source === "recalled" && r[it.id] === 2).map((it) => it.zh) });
}
const share = (xs, v) => xs.length ? xs.filter((x) => x === v).length / xs.length : 0;
const pct = (x) => (x * 100).toFixed(1) + "%";
const summary = Object.fromEntries(Object.entries(bySource).map(([k, xs]) => [k, { n: xs.length, strong: pct(share(xs, 2)), ok: pct(share(xs, 1)), wrong: pct(share(xs, 0)) }]));
console.log(JSON.stringify(summary, null, 2));
const worst = perQuery.map((q) => ({ ...q, p: q.n ? q.strong / q.n : 0 })).sort((a, b) => a.p - b.p);
console.log("\nWeakest queries (strong / picked):");
for (const q of worst.slice(0, 10)) console.log(`${q.qid} ${pct(q.p)} ${q.query} | wrong: ${q.miss.join("、") || "—"} | passed over: ${q.passedOver.join("、") || "—"}`);
fs.writeFileSync(file.replace(/\.json$/, "-summary.json"), JSON.stringify({ summary, perQuery: worst }, null, 2));
