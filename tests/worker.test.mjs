import test from "node:test";
import assert from "node:assert/strict";
import worker, { Budget, DAILY_LIMIT, HOURLY_LIMIT_PER_VISITOR } from "../server/worker.mjs";

const films = Array.from({ length: 30 }, (_, i) => ({
  id: `m${i}`, title: `Dream ${i}`, zh: `梦${i}`, year: 2000, runtime: 100, genres: ["Drama"],
  overview: "A dream about a quiet summer.", language: "en",
}));
const cacheStore = new Map();
globalThis.caches = {
  default: {
    match: async (req) => cacheStore.get(req.url)?.clone(),
    put: async (req, res) => void cacheStore.set(req.url, res.clone()),
  },
};
let jevMode = "ok";
let jevCalls = 0;
globalThis.fetch = async (url, options) => {
  jevCalls++;
  const payload = JSON.parse(options.body);
  if (jevMode === "fail") return new Response("{}", { status: 500 });
  if (!payload.state.movies)
    return Response.json({ answers: { genre: { type: "choice", choice: "any" }, mood: { type: "choice", choice: "unspecified" } } });
  return Response.json({
    answers: Object.fromEntries(payload.state.movies.map((m) => [m.id, { type: "score", score: 2.4, confidence: 0.8 }])),
  });
};

function makeEnv() {
  const data = new Map();
  const storage = { get: async (k) => structuredClone(data.get(k)), put: async (k, v) => void data.set(k, structuredClone(v)) };
  const budget = new Budget({ storage: { transaction: (fn) => fn(storage) } });
  return {
    data,
    env: {
      ALLOWED_ORIGIN: "https://site.test",
      APP_ACCESS_TOKEN: "secret-code",
      TYPESAFE_API_KEY: "jev-key",
      CATALOG_VERSION: "v1",
      CATALOG_COUNT: films.length,
      ASSETS: {
        fetch: async (url) => {
          const path = new URL(url).pathname;
          if (path === "/manifest.json") return Response.json({ version: "v1", count: films.length, parts: ["movies-0.json"], vectors: null });
          if (path === "/movies-0.json") return Response.json(films);
          return new Response("missing", { status: 404 });
        },
      },
      BUDGET: { idFromName: () => "global", get: () => ({ fetch: (url, init) => budget.fetch(new Request(url, init)) }) },
    },
  };
}
function call(env, { query = "想看关于梦的电影", token = "secret-code", origin = "https://site.test", ip = "1.2.3.4", accept } = {}) {
  const pending = [];
  const req = new Request("https://api.test/api/recommend", {
    method: "POST",
    headers: {
      Origin: origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json", "CF-Connecting-IP": ip,
      ...(accept ? { Accept: accept } : {}),
    },
    body: JSON.stringify({ query, filters: { genre: "" } }),
  });
  return { pending, response: worker.fetch(req, env, { waitUntil: (p) => pending.push(p) }) };
}

test("wrong access codes and foreign origins are rejected before any Jev call", async () => {
  const { env } = makeEnv();
  jevCalls = 0;
  assert.equal((await call(env, { token: "nope" }).response).status, 401);
  assert.equal((await call(env, { origin: "https://evil.test" }).response).status, 403);
  assert.equal(jevCalls, 0);
});

test("successful searches are cached and charged once", async () => {
  cacheStore.clear();
  const { env, data } = makeEnv();
  const first = call(env, { query: "缓存测试的梦" });
  const body = await (await first.response).json();
  await Promise.all(first.pending);
  assert.equal(body.results.length, 12);
  assert.equal(data.get("budget").count, 1);
  const again = await (await call(env, { query: " 缓存测试的梦 " }).response).json();
  assert.equal(again.cached, true);
  assert.equal(data.get("budget").count, 1);
});

test("failed searches refund the shared quota", async () => {
  cacheStore.clear();
  const { env, data } = makeEnv();
  jevMode = "fail";
  const { response, pending } = call(env, { query: "失败退款" });
  const res = await response;
  await Promise.all(pending);
  jevMode = "ok";
  assert.equal(res.status, 502);
  assert.equal(data.get("budget").count, 0);
  assert.equal(data.get("visitors").counts[Object.keys(data.get("visitors").counts)[0]], 0);
});

test("one visitor cannot exhaust the shared daily budget", async () => {
  cacheStore.clear();
  const { env } = makeEnv();
  for (let i = 0; i < HOURLY_LIMIT_PER_VISITOR; i++)
    assert.equal((await call(env, { query: `访客限额 ${i}` }).response).status, 200);
  const blocked = await call(env, { query: "访客限额 extra" }).response;
  assert.equal(blocked.status, 429);
  assert.match((await blocked.json()).error, /这一小时/);
  assert.equal((await call(env, { query: "另一位访客", ip: "5.6.7.8" }).response).status, 200);
});

test("the daily budget still caps all visitors", async () => {
  const { env, data } = makeEnv();
  data.set("budget", { day: new Date().toISOString().slice(0, 10), count: DAILY_LIMIT });
  cacheStore.clear();
  const res = await call(env, { query: "每日上限" }).response;
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /明天/);
});

test("streamed responses send progress lines before the result", async () => {
  cacheStore.clear();
  const { env } = makeEnv();
  const { response, pending } = call(env, { query: "流式进度", accept: "application/x-ndjson" });
  const res = await response;
  assert.match(res.headers.get("Content-Type"), /ndjson/);
  const text = await res.text();
  await Promise.all(pending);
  const lines = text.trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(lines.some((l) => l.type === "progress" && l.stage === "ranking"));
  assert.equal(lines.at(-1).type, "result");
  assert.equal(lines.at(-1).results.length, 12);
});

test("streamed failures end with an error line", async () => {
  cacheStore.clear();
  const { env } = makeEnv();
  jevMode = "fail";
  const { response, pending } = call(env, { query: "流式失败", accept: "application/x-ndjson" });
  const text = await (await response).text();
  await Promise.all(pending);
  jevMode = "ok";
  const last = JSON.parse(text.trim().split("\n").at(-1));
  assert.equal(last.type, "error");
  assert.match(last.error, /暂不可用/);
});
