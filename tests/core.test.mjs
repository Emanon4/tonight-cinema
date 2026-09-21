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
  findReferences,
  CANDIDATE_LIMIT,
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

test('classic requests favor documented recognition without changing ordinary matching',()=>{
 const sample=[{...films[0],id:'popular',title:'Space',zh:'太空',overview:'Astronaut explores space.'},{...films[0],id:'classic',title:'Classic',zh:'梦中科学家',overview:'A scientist explores dreams.',recognition:[{list:'BFI Sight and Sound 2022',url:'https://www.bfi.org.uk/'}]}];
 assert.equal(retrieve(sample,'想看经典科幻',{}, {},1)[0].id,'classic');
 assert.equal(retrieve(sample,'太空探索',{}, {},1)[0].id,'popular');
 assert.equal(retrieve(sample,'不要经典科幻',{}, {},1)[0].id,'popular');
});
test("short Chinese titles do not hijack unrelated queries", () => {
  const sample = [
    { ...films[0], id: "no", title: "No", zh: "不", overview: "A crime story." },
    {
      ...films[0],
      id: "lonely",
      title: "Alone",
      zh: "独行",
      overview: "A lonely writer finds solitude in the city.",
    },
  ];
  assert.deepEqual(
    findReferences(sample, "孤独但不悲伤").map((m) => m.id),
    [],
  );
  assert.equal(retrieve(sample, "孤独但不悲伤", {}, {}, 1)[0].id, "lonely");
});
test("quoted similar-to requests exclude the reference film", () => {
  const sample = [
    {
      ...films[0],
      id: "inception",
      title: "Inception",
      zh: "盗梦空间",
      overview: "A dream thief explores subconscious reality.",
      overviewEn: "A dream thief explores the subconscious.",
    },
    {
      ...films[0],
      id: "paprika",
      title: "Paprika",
      zh: "红辣椒",
      overview: "A therapist enters the subconscious dream world.",
      overviewEn: "A therapist enters the subconscious dream world.",
    },
  ];
  assert.equal(findReferences(sample, "像《盗梦空间》一样")[0].id, "inception");
  assert.deepEqual(
    retrieve(sample, "像《盗梦空间》一样，让我脑子转起来", {}, {}, 2).map(
      (m) => m.id,
    ),
    ["paprika"],
  );
});

test('100 candidates are all scored exactly once, including the last batch', async () => {
  const movies = Array.from({length: 130}, (_, i) => ({...films[0], id: `m${i}`, title: `Movie ${i}`, zh: `影片${i}`, language: 'en'}));
  const seen = [], sizes = [];
  let active = 0, peak = 0;
  const result = await recommend({query: '梦境电影', movies, key: 'test', fetcher: async (url, options) => {
    const payload = JSON.parse(options.body);
    if (!payload.state.movies) return Response.json({answers: {genre: {choice: 'Science Fiction'}, mood: {choice: 'mindbending'}}});
    active++; peak = Math.max(peak, active);
    sizes.push(payload.state.movies.length);
    await new Promise(resolve => setTimeout(resolve, 5));
    const answers = Object.fromEntries(payload.state.movies.map(m => {
      seen.push(m.id);
      return [m.id, {type: 'score', score: m.id === 'm99' ? 3 : 2, confidence: 0.9}];
    }));
    active--;
    return Response.json({answers});
  }});
  assert.equal(CANDIDATE_LIMIT, 100);
  assert.equal(result.candidateCount, 100);
  assert.equal(new Set(seen).size, 100);
  assert.equal(seen.length, 100);
  assert.deepEqual(sizes, [20, 20, 20, 20, 20]);
  assert.ok(peak <= 5);
  assert.equal(result.results.length, 12);
  assert.equal(result.results[0].id, 'm99');
  assert.equal(result.modelRequestCount, 6);
});

test('ranking error stops queued batches without retries or partial recommendations', async () => {
  let rankingCalls = 0;
  const movies = Array.from({length: 100}, (_, i) => ({...films[0], id: `m${i}`}));
  await assert.rejects(recommend({query: '梦境电影', movies, key: 'test', batchSize: 8, concurrency: 2, fetcher: async (url, options) => {
    const payload = JSON.parse(options.body);
    if (!payload.state.movies) return Response.json({answers: {genre: {choice: 'Science Fiction'}, mood: {choice: 'mindbending'}}});
    rankingCalls++;
    if (rankingCalls === 1) return new Response('{}', {status: 429});
    await new Promise(resolve => setTimeout(resolve, 10));
    return Response.json({answers: Object.fromEntries(payload.state.movies.map(m => [m.id, {type:'score', score:2, confidence:0.8}]))});
  }}), /请求较多/);
  assert.equal(rankingCalls, 2);
});
