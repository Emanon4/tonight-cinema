import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { retrieve, parseFilters, filtered } from "../server/core.mjs";

const movies = JSON.parse(fs.readFileSync("public/data/movies.json", "utf8"));
const spec = JSON.parse(fs.readFileSync("data/eval/cases.json", "utf8"));
const baseline = JSON.parse(
  fs.readFileSync("data/eval/baseline-retrieve.json", "utf8"),
);

function hitsOf(ids, relevant) {
  return relevant.filter((id) => ids.includes(id)).length;
}

test("fixed eval set beats the saved baseline without growing the candidate cap", () => {
  let before = 0;
  let after = 0;
  let any = 0;
  for (const c of spec.cases) {
    const got = retrieve(movies, c.query, {}, {}, spec.candidateLimit);
    assert.ok(got.length <= spec.candidateLimit);
    const ids = got.map((m) => m.id);
    const n = hitsOf(ids, c.relevant);
    after += n;
    before += hitsOf(baseline.cases[c.id]?.ids || [], c.relevant);
    if (n > 0) any++;
    for (const id of c.require || [])
      assert.ok(ids.includes(id), `${c.id} missing required ${id}`);
    for (const id of c.exclude || [])
      assert.ok(!ids.includes(id), `${c.id} leaked excluded ${id}`);
    const f = parseFilters(c.query, {});
    assert.equal(got.filter((m) => !filtered([m], f).length).length, 0);
  }
  assert.ok(after > before, `relevant hits ${before} → ${after}`);
  assert.ok(after >= 30, `expected at least 30 labeled hits, got ${after}`);
  assert.ok(any >= 16, `expected 16+ cases with a hit, got ${any}`);
});

test("named titles, language, years and rejected genres still hold on the catalog", () => {
  const green = retrieve(
    movies,
    "想看《绿光》，关于孤独、假期里寻找陪伴的影史佳作",
    {},
    {},
    24,
  );
  assert.equal(green[0].id, "tmdb-54898");
  const zip = retrieve(
    movies,
    "想看《127小时》，高空冒险与求生的惊悚电影",
    {},
    {},
    3,
  );
  assert.equal(zip[0].id, "tmdb-44115");
  const japan = retrieve(movies, "想看一部日本电影，关于家庭和日常", {}, {}, 12);
  assert.ok(japan.filter((m) => m.language === "ja").length >= 8);
  const nineties = retrieve(movies, "90 年代的犯罪片，氛围越浓越好", {}, {}, 24);
  assert.ok(nineties.every((m) => m.year >= 1990 && m.year <= 1999));
  const warm = retrieve(movies, "想看温暖的电影，不要恐怖或惊悚", {}, {}, 12);
  assert.ok(warm.every((m) => !m.genres.includes("Horror")));
  assert.ok(warm.every((m) => !m.genres.includes("Thriller")));
});
