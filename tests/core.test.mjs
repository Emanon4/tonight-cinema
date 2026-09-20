import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseFilters,
  filtered,
  retrieve,
  readRanking,
  validInput,
  recommend,
} from "../server/core.mjs";
const films = [
  {
    id: "1",
    title: "Dream",
    zh: "梦中",
    year: 1995,
    runtime: 90,
    genres: ["Science Fiction"],
    cast: [],
    overview: "A dream thief explores subconscious reality.",
  },
  {
    id: "2",
    title: "Crime",
    zh: "犯罪",
    year: 2020,
    runtime: null,
    genres: ["Crime"],
    cast: [],
    overview: "A criminal heist.",
  },
];
test("unknown runtimes never pass hard duration constraints", () =>
  assert.deepEqual(
    filtered(films, { maxRuntime: 120 }).map((x) => x.id),
    ["1"],
  ));
test("Chinese decade and duration parsing", () => {
  assert.equal(parseFilters("90 年代的犯罪片").minYear, 1990);
  assert.equal(parseFilters("2020 年代").minYear, 2020);
  assert.equal(parseFilters("两小时以内").maxRuntime, 120);
});
test("recall finds Chinese dream intent across English metadata", () =>
  assert.equal(retrieve(films, "梦境与现实", {}, {}, 1)[0].id, "1"));
test("malformed or missing AI scores fail closed", () => {
  assert.throws(() => readRanking({ answers: {} }, films));
  assert.throws(() =>
    readRanking(
      { answers: { 1: { type: "score", score: 100, confidence: 1 } } },
      films.slice(0, 1),
    ),
  );
});
test("bound query length and filter shape", () => {
  assert.equal(validInput({ query: "x".repeat(301) }), false);
  assert.equal(validInput({ query: "温暖", filters: [] }), false);
  assert.ok(validInput({ query: "温暖" }));
});
test("upstream failure never turns into fake recommendations", async () => {
  await assert.rejects(
    recommend({
      query: "温暖",
      movies: films,
      key: "test",
      fetcher: async () => new Response("{}", { status: 429 }),
    }),
    /请求较多/,
  );
});
test("all catalog records have unique IDs and source links", () => {
  const movies = JSON.parse(fs.readFileSync("public/data/movies.json"));
  assert.equal(new Set(movies.map((m) => m.id)).size, movies.length);
  assert.ok(
    movies.every(
      (m) => m.source.startsWith("https://") && m.overview.length > 0,
    ),
  );
});

test("null filters and invalid confidence are rejected", () => {
  assert.equal(validInput({ query: "温暖", filters: null }), false);
  assert.throws(() =>
    readRanking(
      { answers: { 1: { type: "score", score: 2, confidence: 9 } } },
      films.slice(0, 1),
    ),
  );
});
