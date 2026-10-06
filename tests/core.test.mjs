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
  mediaTypeIntent,
  jev,
  readIntent,
  negatedAt,
  normalizeFilters,
  normalizeQuery,
  explain,
  normalizePersonal,
  querySignature,
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
test("movie and series intent stays separated", () => {
  assert.equal(mediaTypeIntent("想看一部电影"), "movie");
  assert.equal(mediaTypeIntent("想看高质量动画剧集"), "series");
  const mixed = [
    {...films[0], mediaType: "movie"},
    {...films[0], id: "series", mediaType: "series", title: "Series", zh: "高质量剧集", genres: ["Animation"], overview: "An animated series about friendship."},
  ];
  assert.deepEqual(filtered(mixed, {mediaType: "series"}).map(m => m.id), ["series"]);
  assert.equal(retrieve(mixed, "想看高质量动画剧集", {}, {}, 1)[0].id, "series");
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
      retryDelayMs: 1,
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

test("quality catalog excludes low-signal records", () => {
  const movies = JSON.parse(fs.readFileSync("public/data/movies.json"));
  assert.ok(movies.length > 0);
  assert.ok(movies.every((m) =>
    Number(m.doubanRating) > 7.5 ||
    m.recognition?.length ||
    (Number(m.rating) >= 7 && Number(m.votes) >= 100),
  ));
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

const intentAnswers = {genre: {type: 'choice', choice: 'Science Fiction'}, mood: {type: 'choice', choice: 'mindbending'}};
const isRerank = (payload) => Object.keys(payload.questions).some(k => k.endsWith('::aspect'));

test('1000 candidates are all scored exactly once, then the shortlist is reranked together', async () => {
  const movies = Array.from({length: 1100}, (_, i) => ({...films[0], id: `m${i}`, title: `Movie ${i}`, zh: `影片${i}`, language: 'en'}));
  const seen = [], sizes = [];
  let active = 0, peak = 0, reranks = 0;
  const result = await recommend({query: '梦境电影', movies, key: 'test', fetcher: async (url, options) => {
    const payload = JSON.parse(options.body);
    if (!payload.state.movies) return Response.json({answers: intentAnswers});
    if (isRerank(payload)) {
      reranks++;
      return Response.json({answers: Object.fromEntries(payload.state.movies.flatMap(m => [
        [m.id, {type: 'score', score: m.id === 'm99' ? 3 : 2.2, confidence: 0.9}],
        [`${m.id}::aspect`, {type: 'choice', choice: 'theme'}],
      ]))});
    }
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
  assert.equal(CANDIDATE_LIMIT, 1000);
  assert.equal(result.candidateCount, 1000);
  assert.equal(new Set(seen).size, 1000);
  assert.equal(seen.length, 1000);
  assert.deepEqual(sizes, Array(50).fill(20));
  assert.ok(peak <= 5);
  assert.equal(reranks, 1);
  assert.equal(result.reranked, true);
  assert.equal(result.results.length, 12);
  assert.equal(result.results[0].id, 'm99');
  assert.equal(result.results[0].aspect, 'theme');
  assert.ok(Array.isArray(result.results[0].reasons));
  assert.equal(result.modelRequestCount, 52);
  assert.equal(result.partial, undefined);
});

test('ranking failures beyond the tolerance stop queued batches and fail closed', async () => {
  let rankingCalls = 0;
  const movies = Array.from({length: 100}, (_, i) => ({...films[0], id: `m${i}`}));
  await assert.rejects(recommend({query: '梦境电影', movies, key: 'test', batchSize: 8, concurrency: 2, retryDelayMs: 1, fetcher: async (url, options) => {
    const payload = JSON.parse(options.body);
    if (!payload.state.movies) return Response.json({answers: intentAnswers});
    rankingCalls++;
    return new Response('{}', {status: 503});
  }}), /暂不可用/);
  // 13 batches tolerate one failure; the second failure stops the queue.
  assert.ok(rankingCalls <= 4, `stopped after ${rankingCalls} calls`);
});

test('a single failed batch out of many returns a labeled partial result', async () => {
  const movies = Array.from({length: 1000}, (_, i) => ({...films[0], id: `m${i}`}));
  let batch = 0;
  const result = await recommend({query: '梦境电影', movies, key: 'test', retryDelayMs: 1, fetcher: async (url, options) => {
    const payload = JSON.parse(options.body);
    if (!payload.state.movies) return Response.json({answers: intentAnswers});
    if (!isRerank(payload) && ++batch === 3) return new Response('{}', {status: 500});
    return Response.json({answers: Object.fromEntries(payload.state.movies.map(m => [m.id, {type: 'score', score: 2.5, confidence: 0.8}]))});
  }});
  assert.deepEqual(result.partial, {failedBatches: 1, totalBatches: 50});
  assert.equal(result.results.length, 12);
});

test('429 and 529 are retried once before failing', async () => {
  let calls = 0;
  const data = await jev({}, 'k', async () => (++calls === 1 ? new Response('{}', {status: 529}) : Response.json({answers: {}})), {retryDelayMs: 1});
  assert.deepEqual(data.answers, {});
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(jev({}, 'k', async () => { calls++; return new Response('{}', {status: 429}); }, {retryDelayMs: 1}), /请求较多/);
  assert.equal(calls, 2);
});

test('a failed rerank keeps the first-pass Jev ranking', async () => {
  const movies = Array.from({length: 30}, (_, i) => ({...films[0], id: `m${i}`}));
  const result = await recommend({query: '梦境电影', movies, key: 'test', retryDelayMs: 1, fetcher: async (url, options) => {
    const payload = JSON.parse(options.body);
    if (!payload.state.movies) return Response.json({answers: intentAnswers});
    if (isRerank(payload)) return new Response('{}', {status: 500});
    return Response.json({answers: Object.fromEntries(payload.state.movies.map(m => [m.id, {type: 'score', score: m.id === 'm7' ? 2.9 : 2, confidence: 0.8}]))});
  }});
  assert.equal(result.reranked, false);
  assert.equal(result.results[0].id, 'm7');
});

test('Jev-detected avoidance removes rejected genres from recall', async () => {
  const movies = [
    {...films[0], id: 'scary', genres: ['Horror'], overview: 'A dream turns into a haunting nightmare.'},
    {...films[0], id: 'calm', genres: ['Drama'], overview: 'A dream of a quiet seaside summer.'},
  ];
  const ids = [];
  await recommend({query: '想看关于梦的片子，别太吓人', movies, key: 'test', fetcher: async (url, options) => {
    const payload = JSON.parse(options.body);
    if (!payload.state.movies) return Response.json({answers: {...intentAnswers, genre: {type: 'choice', choice: 'any'}, avoidGenre: {type: 'choice', choice: 'Horror'}, avoidScary: {type: 'noul', noul: 0.9}}});
    ids.push(...payload.state.movies.map(m => m.id));
    return Response.json({answers: Object.fromEntries(payload.state.movies.map(m => [m.id, {type: 'score', score: 2, confidence: 0.8}]))});
  }});
  assert.equal(ids[0], 'calm');
  const intent = readIntent({answers: {...intentAnswers, avoidGenre: {choice: 'Horror'}, avoidSad: {type: 'noul', noul: 0.2}}});
  assert.deepEqual(intent.avoid.genres, ['Horror']);
  assert.equal(intent.avoid.sad, false);
});

test('semantic similarity brings in titles that keyword recall misses', () => {
  const sample = [
    {...films[0], id: 'keyword', overview: 'A lonely writer in the city.', genres: ['Drama'], language: 'en'},
    {...films[0], id: 'semantic', overview: 'Two strangers share a night train and talk until dawn.', genres: ['Romance'], language: 'fr'},
    ...Array.from({length: 20}, (_, i) => ({...films[0], id: `filler${i}`, overview: 'An unrelated heist.', genres: ['Crime'], language: 'en', rating: 8, votes: 5000})),
  ];
  const plain = retrieve(sample, '孤独但不悲伤', {}, {}, 2).map(m => m.id);
  assert.ok(!plain.includes('semantic'));
  const semantic = new Map(sample.map(m => [m.id, m.id === 'semantic' ? 0.8 : 0.1]));
  const fused = retrieve(sample, '孤独但不悲伤', {}, {}, 2, semantic).map(m => m.id);
  assert.deepEqual(fused.sort(), ['keyword', 'semantic']);
});

test('negation, decades and pre-1950 filters', () => {
  assert.equal(negatedAt('不要恐怖片，想看恐怖喜剧', '恐怖'), false);
  assert.equal(negatedAt('不要恐怖，也别恐怖', '恐怖'), true);
  assert.deepEqual(parseFilters('', {decade: 'pre1950'}), {maxYear: 1949});
  assert.deepEqual(parseFilters('', {decade: '1970'}), {minYear: 1970, maxYear: 1979});
  assert.equal(parseFilters('1980年以前的科幻').maxYear, 1979);
  assert.equal(parseFilters('1990 年前后').maxYear, undefined);
  assert.deepEqual(normalizeFilters({genre: 'Nope', decade: '1960', extra: 1}), {mediaType: '', genre: '', decade: '1960', maxRuntime: ''});
  assert.equal(normalizeQuery('  想看　电影  '), '想看 电影');
});

test('reasons cite only verifiable signals', () => {
  const m = {...films[0], language: 'ja', genres: ['Drama', 'Family'], overview: '一个关于家庭与日常的故事。', runtime: 100, doubanRating: 8.8, recognition: [{list: 'BFI Sight and Sound 2022', url: 'https://www.bfi.org.uk/'}]};
  const reasons = explain(m, '想看日本电影，关于家庭和日常，两小时以内');
  assert.ok(reasons.includes('日语'));
  assert.ok(reasons.some(r => r.startsWith('简介提到')));
  assert.ok(reasons.length <= 4);
});

test('personal exclusions, taste profile and spare results', async () => {
  const movies = Array.from({length: 60}, (_, i) => ({...films[0], id: `m${i}`, rating: 7, votes: 500}));
  const seen = [];
  const result = await recommend({query: '梦境电影', movies, key: 'test', exclude: ['m0', 'm1'],
    profile: new Map(movies.map(m => [m.id, m.id === 'm59' ? 0.9 : 0.1])),
    fetcher: async (url, options) => {
      const payload = JSON.parse(options.body);
      if (!payload.state.movies) return Response.json({answers: intentAnswers});
      if (!isRerank(payload)) seen.push(...payload.state.movies.map(m => m.id));
      return Response.json({answers: Object.fromEntries(payload.state.movies.map(m => [m.id, {type: 'score', score: 2.2, confidence: 0.8}]))});
    }});
  assert.ok(!seen.includes('m0') && !seen.includes('m1'));
  assert.equal(seen[0], 'm59');
  assert.equal(result.personalized, true);
  assert.equal(result.results.length, 12);
  assert.ok(result.more.length > 0);
  assert.ok(result.more.every(x => !result.results.some(r => r.id === x.id) && Array.isArray(x.reasons)));
});

test('personal payloads are bounded and normalized', () => {
  assert.ok(validInput({query: '温暖', personal: {exclude: ['a'], like: ['b']}}));
  assert.equal(validInput({query: '温暖', personal: {like: Array(61).fill('x')}}), false);
  assert.equal(validInput({query: '温暖', personal: {like: [1]}}), false);
  assert.deepEqual(normalizePersonal({like: ['b', 'a', 'b']}), {exclude: [], like: ['a', 'b'], dislike: []});
  assert.equal(normalizePersonal({like: []}), null);
});

test('query signatures separate constraint changes but not punctuation', () => {
  assert.equal(querySignature('想看一部日本电影，关于家庭和日常'), querySignature('想看一部日本电影，关于家庭和日常。'));
  assert.notEqual(querySignature('想看一部日本电影，关于家庭和日常'), querySignature('想看一部韩国电影，关于家庭和日常'));
  assert.notEqual(querySignature('孤独但不悲伤'), querySignature('孤独又悲伤'));
  assert.notEqual(querySignature('像《盗梦空间》一样'), querySignature('像《星际穿越》一样'));
});
