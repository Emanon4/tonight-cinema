import { createCatalogLoader, createVectorLoader } from "./catalog.mjs";
import {
  recommend,
  validInput,
  normalizeFilters,
  normalizeQuery,
  RECALL_VERSION,
} from "./core.mjs";
import { embedWithBinding, semanticSearcher } from "./semantic.mjs";
const loadCatalog = createCatalogLoader();
const loadVectors = createVectorLoader();
export const DAILY_LIMIT = 100;
export const HOURLY_LIMIT_PER_VISITOR = 10;

export class Budget {
  constructor(ctx) {
    this.ctx = ctx;
  }
  async fetch(req) {
    const { action, visitor } = await req.json();
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const hour = now.toISOString().slice(0, 13);
    const result = await this.ctx.storage.transaction(async (s) => {
      const budget = (await s.get("budget")) || { day, count: 0 };
      if (budget.day !== day) Object.assign(budget, { day, count: 0 });
      // Only the current hour is kept, so visitor hashes never accumulate.
      const visitors = (await s.get("visitors")) || { hour, counts: {} };
      if (visitors.hour !== hour) Object.assign(visitors, { hour, counts: {} });
      if (action === "refund") {
        budget.count = Math.max(0, budget.count - 1);
        if (visitor && visitors.counts[visitor])
          visitors.counts[visitor] = Math.max(0, visitors.counts[visitor] - 1);
      } else {
        if (budget.count >= DAILY_LIMIT) return { allowed: false, reason: "daily" };
        if (visitor && (visitors.counts[visitor] || 0) >= HOURLY_LIMIT_PER_VISITOR)
          return { allowed: false, reason: "visitor" };
        budget.count++;
        if (visitor) visitors.counts[visitor] = (visitors.counts[visitor] || 0) + 1;
      }
      await s.put("budget", budget);
      await s.put("visitors", visitors);
      return { allowed: true, remaining: DAILY_LIMIT - budget.count };
    });
    return Response.json(result);
  }
}

async function sha256(text) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
}

// Compare digests so the check does not leak how many leading characters match.
async function sameSecret(given, expected) {
  if (!given || !expected) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get("Origin");
    const allowed = env.ALLOWED_ORIGIN;
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
    };
    if (origin === allowed) headers["Access-Control-Allow-Origin"] = origin;
    const send = (n, b) =>
      new Response(JSON.stringify(b), { status: n, headers });
    if (origin && origin !== allowed)
      return send(403, { error: "Origin denied" });
    if (req.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,Authorization,Accept",
        },
      });
    const path = new URL(req.url).pathname;
    if (path === "/api/health")
      return send(200, {
        ready: !!env.TYPESAFE_API_KEY && !!env.APP_ACCESS_TOKEN,
        accessRequired: true,
        engine: "jev",
        semantic: !!env.AI,
        catalogCount: Number(env.CATALOG_COUNT),
        catalogVersion: env.CATALOG_VERSION,
      });
    if (path !== "/api/recommend" || req.method !== "POST")
      return send(404, { error: "Not found" });
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
    if (!env.APP_ACCESS_TOKEN || !(await sameSecret(token, env.APP_ACCESS_TOKEN)))
      return send(401, { error: "访问码不正确，请在连接设置中重新输入。", code: "access" });
    if (!env.TYPESAFE_API_KEY) return send(503, { error: "Jev 尚未配置。" });
    const text = await req.text();
    if (text.length > 4096) return send(413, { error: "请求过长。" });
    let b;
    try {
      b = JSON.parse(text);
    } catch {
      return send(400, { error: "请求格式错误。" });
    }
    if (!validInput(b))
      return send(400, { error: "请输入 2—300 字的观影需求。" });
    const query = normalizeQuery(b.query);
    const filters = normalizeFilters(b.filters);
    const hash = await sha256(
      JSON.stringify([env.CATALOG_VERSION || "initial", RECALL_VERSION, query, filters]),
    );
    const ck = new Request(new URL("/cache/" + hash, req.url));
    const cache = caches.default;
    const ip = req.headers.get("CF-Connecting-IP") || "";
    // Salted so stored counters cannot be mapped back to an address.
    const visitor = ip ? (await sha256(env.APP_ACCESS_TOKEN + ip)).slice(0, 16) : "";
    const budget = env.BUDGET.get(env.BUDGET.idFromName("global"));
    const callBudget = async (action) =>
      (await budget.fetch("https://budget/", {
        method: "POST",
        body: JSON.stringify({ action, visitor }),
      })).json();

    const run = async (emit) => {
      const hit = await cache.match(ck);
      if (hit) return { ...(await hit.json()), cached: true };
      const movies = await loadCatalog(env);
      const limit = await callBudget("take");
      if (!limit.allowed)
        throw new HttpError(
          429,
          limit.reason === "visitor"
            ? `这一小时内的筛选次数已达 ${HOURLY_LIMIT_PER_VISITOR} 次，稍后再来。`
            : `今天的 ${DAILY_LIMIT} 次智能筛选额度已用完，明天再来。`,
        );
      let result;
      try {
        const semantic = env.AI
          ? semanticSearcher(() => loadVectors(env), (texts) => embedWithBinding(env.AI, texts))
          : null;
        result = await recommend({
          filters,
          query,
          movies,
          key: env.TYPESAFE_API_KEY,
          semantic,
          onProgress: emit,
        });
      } catch (e) {
        // A failed search produced nothing for the visitor, so it is not charged.
        ctx.waitUntil(callBudget("refund").catch(() => {}));
        throw e;
      }
      if (!result.partial)
        ctx.waitUntil(
          cache.put(
            ck,
            new Response(JSON.stringify(result), {
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "public,max-age=86400",
              },
            }),
          ),
        );
      return { ...result, remaining: limit.remaining };
    };
    const errorBody = (e) => ({
      status: e.status || 502,
      error:
        e.name === "TimeoutError"
          ? "Jev 响应超时，请手动重试。"
          : e.message || "筛选失败。",
    });

    if (!(req.headers.get("Accept") || "").includes("application/x-ndjson")) {
      try {
        return send(200, await run(() => {}));
      } catch (e) {
        const { status, error } = errorBody(e);
        return send(status, { error });
      }
    }
    // Streamed mode: one JSON object per line — progress events, then result or error.
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const write = (obj) => writer.write(encoder.encode(JSON.stringify(obj) + "\n")).catch(() => {});
    ctx.waitUntil(
      (async () => {
        try {
          const result = await run((p) => write({ type: "progress", ...p }));
          await write({ type: "result", ...result });
        } catch (e) {
          await write({ type: "error", ...errorBody(e) });
        } finally {
          await writer.close().catch(() => {});
        }
      })(),
    );
    return new Response(readable, {
      status: 200,
      headers: { ...headers, "Content-Type": "application/x-ndjson" },
    });
  },
};
