import movies from "../public/data/movies.json";
import { recommend, validInput } from "./core.mjs";
export class Budget {
  constructor(ctx) {
    this.ctx = ctx;
  }
  async fetch() {
    const day = new Date().toISOString().slice(0, 10);
    const allowed = await this.ctx.storage.transaction(async (s) => {
      const state = (await s.get("budget")) || { day, count: 0 };
      if (state.day !== day) {
        state.day = day;
        state.count = 0;
      }
      if (state.count >= 100) return false;
      state.count++;
      await s.put("budget", state);
      return true;
    });
    return Response.json({ allowed });
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
          "Access-Control-Allow-Headers": "Content-Type,Authorization",
        },
      });
    const path = new URL(req.url).pathname;
    if (path === "/api/health")
      return send(200, {
        ready: !!env.TYPESAFE_API_KEY && !!env.APP_ACCESS_TOKEN,
        accessRequired: true,
        engine: "jev",
        catalogCount: movies.length,
      });
    if (path !== "/api/recommend" || req.method !== "POST")
      return send(404, { error: "Not found" });
    if (
      !env.APP_ACCESS_TOKEN ||
      req.headers.get("Authorization") !== `Bearer ${env.APP_ACCESS_TOKEN}`
    )
      return send(401, { error: "请先在连接设置中输入网站访问码。" });
    if (!env.TYPESAFE_API_KEY) return send(503, { error: "Jev 尚未配置。" });
    try {
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
      const hash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(
              JSON.stringify([
                env.CATALOG_VERSION || "initial",
                b.query.trim(),
                b.filters,
              ]),
            ),
          ),
        ),
      )
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      const ck = new Request(new URL("/cache/" + hash, req.url));
      const cache = caches.default;
      const hit = await cache.match(ck);
      if (hit) return send(200, { ...(await hit.json()), cached: true });
      const budget = env.BUDGET.get(env.BUDGET.idFromName("global"));
      const limit = await (await budget.fetch("https://budget/")).json();
      if (!limit.allowed)
        return send(429, {
          error: "今天的 100 次智能筛选额度已用完，明天再来。",
        });
      const result = await recommend({
        ...b,
        query: b.query.trim(),
        movies,
        key: env.TYPESAFE_API_KEY,
      });
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
      return send(200, result);
    } catch (e) {
      return send(502, {
        error:
          e.name === "TimeoutError"
            ? "Jev 响应超时，请手动重试。"
            : e.message || "筛选失败。",
      });
    }
  },
};
