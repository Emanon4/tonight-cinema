import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { renderToString } from "react-dom/server";
import React from "react";
import { readUrlState, urlFor, emptyFilters, sameFilters } from "../src/lib/urlState.js";
import { narrowResults, genreOptions } from "../src/lib/results.js";
import { requestRecommendation, progressText } from "../src/lib/api.js";

const movies = [
  { id: "a", title: "Her", zh: "她", year: 2013, runtime: 126, genres: ["Romance", "Drama"], mediaType: "movie", rating: 7.8, poster: "", detailChunk: "x" },
  { id: "b", title: "Before Sunrise", zh: "爱在黎明破晓前", year: 1995, runtime: 101, genres: ["Romance"], mediaType: "movie", rating: 7.9, poster: "", detailChunk: "x" },
  { id: "c", title: "Long Show", zh: "长剧", year: 2020, runtime: 45, genres: ["Drama"], mediaType: "series", rating: 8, poster: "", detailChunk: "x" },
];

test("URL state round-trips the query and only non-default filters", () => {
  const url = urlFor({ query: "孤独但不悲伤", filters: { ...emptyFilters, decade: "1990", mediaType: "movie" } });
  assert.equal(url, "?q=%E5%AD%A4%E7%8B%AC%E4%BD%86%E4%B8%8D%E6%82%B2%E4%BC%A4&type=movie&decade=1990");
  const state = readUrlState(url);
  assert.equal(state.query, "孤独但不悲伤");
  assert.ok(sameFilters(state.filters, { ...emptyFilters, decade: "1990", mediaType: "movie" }));
  assert.equal(urlFor({ query: "", filters: emptyFilters }), "");
});

test("filter changes narrow existing results without a new search", () => {
  const byId = new Map(movies.map((m) => [m.id, m]));
  const results = movies.map((m) => ({ id: m.id, score: 2.5 }));
  assert.deepEqual(narrowResults(results, byId, { ...emptyFilters, maxRuntime: "120" }).map((r) => r.id), ["b", "c"]);
  assert.deepEqual(narrowResults(results, byId, { ...emptyFilters, mediaType: "series" }).map((r) => r.id), ["c"]);
  assert.deepEqual(genreOptions(movies, 2).map((g) => g.value), ["Drama", "Romance"]);
});

test("NDJSON responses report progress and resolve with the result line", async () => {
  const lines = [
    { type: "progress", stage: "intent" },
    { type: "progress", stage: "ranking", done: 1, total: 2 },
    { type: "result", results: [{ id: "a", score: 2.6 }], candidateCount: 40 },
  ].map((l) => JSON.stringify(l) + "\n").join("");
  // Split mid-line to exercise buffering across chunks.
  const chunks = [lines.slice(0, 30), lines.slice(30)];
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(c) { for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk)); c.close(); },
  }), { headers: { "Content-Type": "application/x-ndjson" } });
  const seen = [];
  const result = await requestRecommendation({ apiBase: "", token: "t", query: "q", filters: emptyFilters, onProgress: (p) => seen.push(p.stage) });
  assert.deepEqual(seen, ["intent", "ranking"]);
  assert.equal(result.candidateCount, 40);
  assert.match(progressText({ stage: "ranking", done: 1, total: 2 }), /1\/2/);
  globalThis.fetch = async () => new Response(JSON.stringify({ type: "error", error: "额度已用完", status: 429 }) + "\n", { headers: { "Content-Type": "application/x-ndjson" } });
  await assert.rejects(requestRecommendation({ apiBase: "", query: "q", filters: emptyFilters }), (e) => e.status === 429 && /额度/.test(e.message));
  globalThis.fetch = async () => Response.json({ error: "访问码不正确", code: "access" }, { status: 401 });
  await assert.rejects(requestRecommendation({ apiBase: "", query: "q", filters: emptyFilters }), (e) => e.status === 401);
});

test("the app and its dialogs render with a catalog", async (t) => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  t.after(() => vite.close());
  const { default: App } = await vite.ssrLoadModule("/src/App.jsx");
  const { default: MovieCard } = await vite.ssrLoadModule("/src/components/MovieCard.jsx");
  const html = renderToString(React.createElement(App, { initialMovies: movies, initialUrl: "?decade=1990" }));
  assert.match(html, /今晚，想走进/);
  assert.match(html, /1950 年前/);
  assert.match(html, /爱在黎明破晓前/);
  assert.doesNotMatch(html, /长剧/);
  const card = renderToString(React.createElement(MovieCard, {
    movie: { ...movies[0], match: { score: 2.7, reasons: ["爱情", "简介提到孤独"] } },
    index: 0, saved: false, onOpen() {}, onToggleSave() {},
  }));
  assert.match(card, /很合心意/);
  assert.match(card, /简介提到孤独/);
});
