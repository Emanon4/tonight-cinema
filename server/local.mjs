import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import {
  recommend,
  validInput,
  normalizeFilters,
  normalizeQuery,
  RECALL_VERSION,
} from "./core.mjs";
import { createSemanticIndex, embedWithRest, semanticSearcher } from "./semantic.mjs";
import { cloudflareCredentials } from "../scripts/cloudflare-credentials.mjs";
const movies = JSON.parse(
  fs.readFileSync(new URL("../public/data/movies.json", import.meta.url)),
);
const key =
  process.env.TYPESAFE_API_KEY ||
  fs
    .readFileSync(os.homedir() + "/.config/typesafe/api-key.txt", "utf8")
    .trim();
// Semantic recall locally needs both the vector file and Workers AI credentials.
let semantic = null;
const metaUrl = new URL("../data/embeddings/meta.json", import.meta.url);
if (fs.existsSync(metaUrl)) {
  const meta = JSON.parse(fs.readFileSync(metaUrl));
  const bin = fs.readFileSync(new URL("../data/embeddings/vectors.i8", import.meta.url));
  const index = createSemanticIndex({ ids: meta.ids, dims: meta.dims, vectors: new Int8Array(bin.buffer, bin.byteOffset, bin.length) });
  const credentials = await cloudflareCredentials().catch(() => null);
  if (credentials) semantic = semanticSearcher(async () => index, (texts) => embedWithRest(credentials, texts));
}
const cache = new Map();
let busy = 0;
http
  .createServer(async (req, res) => {
    const send = (code, data) => {
      res.writeHead(code, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    if (
      req.headers.origin &&
      !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(req.headers.origin)
    )
      return send(403, { error: "Origin denied" });
    if (req.url === "/api/health")
      return send(200, {
        ready: !!key,
        engine: "jev",
        semantic: !!semantic,
        catalogCount: movies.length,
        accessRequired: false,
      });
    if (req.url !== "/api/recommend" || req.method !== "POST")
      return send(404, { error: "Not found" });
    let body = "";
    for await (const part of req) {
      body += part;
      if (body.length > 4096) return send(413, { error: "请求过长。" });
    }
    let b;
    try {
      b = JSON.parse(body);
    } catch {
      return send(400, { error: "请求格式错误。" });
    }
    if (!validInput(b))
      return send(400, { error: "请输入 2—300 字的观影需求。" });
    const query = normalizeQuery(b.query);
    const filters = normalizeFilters(b.filters);
    const stream = (req.headers.accept || "").includes("application/x-ndjson");
    if (stream) res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" });
    const finish = (code, data) => {
      if (!stream) return send(code, data);
      res.end(JSON.stringify(code === 200 ? { type: "result", ...data } : { type: "error", status: code, ...data }) + "\n");
    };
    const id = JSON.stringify([RECALL_VERSION, query, filters]);
    if (cache.has(id)) return finish(200, { ...cache.get(id), cached: true });
    if (busy >= 2) return finish(429, { error: "正在挑选电影，请稍后重试。" });
    busy++;
    try {
      const result = await recommend({
        filters,
        query,
        movies,
        key,
        semantic,
        onProgress: (p) => stream && res.write(JSON.stringify({ type: "progress", ...p }) + "\n"),
      });
      if (!result.partial) cache.set(id, result);
      if (cache.size > 100) cache.delete(cache.keys().next().value);
      finish(200, result);
    } catch (e) {
      finish(502, {
        error:
          e.name === "TimeoutError"
            ? "Jev 响应超时，请手动重试。"
            : e.message || "筛选失败。",
      });
    } finally {
      busy--;
    }
  })
  .listen(8793, "127.0.0.1", () =>
    console.log(
      `Cinema API http://127.0.0.1:8793 · ${movies.length} titles · Jev ${key ? "ready" : "missing"} · semantic ${semantic ? "on" : "off"}`,
    ),
  );
