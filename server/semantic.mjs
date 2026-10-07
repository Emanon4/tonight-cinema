// Multilingual embedding recall. Catalog vectors are built offline with the
// same Workers AI model that embeds queries at request time.
import { genreLabels } from "./core.mjs";
export const EMBEDDING_MODEL = "@cf/baai/bge-m3";
export const EMBEDDING_DIMS = 1024;

export function embeddingText(m) {
  const genres = (m.genres || []).map((g) => genreLabels[g] || g).join("、");
  const kind = m.mediaType === "series" ? "剧集" : "电影";
  const extra = [m.tagline, m.director && `导演 ${m.director}`, m.keywords?.length && `Keywords: ${m.keywords.slice(0, 15).join(", ")}`]
    .filter(Boolean).join("。");
  return `${m.zh || m.title} / ${m.title}（${m.year || ""}，${kind}）。${genres}。${extra}\n${m.overview || ""}\n${m.overviewEn || ""}`
    .slice(0, 1600);
}

export function unit(vec) {
  let n = 0;
  for (const x of vec) n += x * x;
  n = Math.sqrt(n) || 1;
  return Float32Array.from(vec, (x) => x / n);
}

export function quantize(vec) {
  return Int8Array.from(unit(vec), (x) => Math.max(-127, Math.min(127, Math.round(x * 127))));
}

// vectors: Int8Array of ids.length * dims, each row a unit vector scaled by 127.
export function createSemanticIndex({ ids, dims, vectors }) {
  if (vectors.length !== ids.length * dims) throw Error("向量索引不完整。");
  const rowOf = new Map(ids.map((id, i) => [id, i]));
  return {
    size: ids.length,
    has: (id) => rowOf.has(id),
    // Taste direction: mean of liked titles minus half the mean of disliked ones.
    profile(like = [], dislike = []) {
      const out = new Float32Array(dims);
      const add = (list, weight) => {
        const rows = list.map((id) => rowOf.get(id)).filter((r) => r !== undefined);
        for (const r of rows)
          for (let i = 0; i < dims; i++) out[i] += (weight / rows.length) * vectors[r * dims + i];
        return rows.length;
      };
      const liked = add(like, 1);
      if (!liked) return null;
      add(dislike, -0.5);
      return out;
    },
    scores(queryVec) {
      const q = unit(queryVec);
      if (q.length !== dims) throw Error("查询向量维度不一致。");
      const out = new Map();
      for (let row = 0; row < ids.length; row++) {
        let dot = 0;
        const offset = row * dims;
        for (let i = 0; i < dims; i++) dot += q[i] * vectors[offset + i];
        out.set(ids[row], dot / 127);
      }
      return out;
    },
  };
}

export async function embedWithBinding(ai, texts) {
  const result = await ai.run(EMBEDDING_MODEL, { text: texts });
  if (!Array.isArray(result?.data) || result.data.length !== texts.length)
    throw Error("向量服务返回格式异常。");
  return result.data;
}

export async function embedWithRest({ accountId, token }, texts) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${EMBEDDING_MODEL}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: texts }),
      signal: AbortSignal.timeout(60000),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success)
    throw Error(`Workers AI ${response.status}: ${body.errors?.[0]?.message || "embedding failed"}`);
  if (body.result?.data?.length !== texts.length) throw Error("向量服务返回格式异常。");
  return body.result.data;
}

// Returns async (query) => Map<id, similarity>, or null when no index exists.
export function semanticSearcher(loadIndex, embed) {
  return async (query) => {
    const index = await loadIndex();
    if (!index?.size) return null;
    const [vec] = await embed([query]);
    return index.scores(vec);
  };
}
