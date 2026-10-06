import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { EMBEDDING_MODEL, EMBEDDING_DIMS, embeddingText, embedWithRest, quantize } from "../server/semantic.mjs";
import { cloudflareCredentials } from "./cloudflare-credentials.mjs";

// Incremental: only titles whose embedding text changed are sent to Workers AI.
const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "data/embeddings");
const metaFile = path.join(dir, "meta.json"), binFile = path.join(dir, "vectors.i8");
const movies = JSON.parse(fs.readFileSync(path.join(root, "public/data/movies.json")));
const credentials = await cloudflareCredentials();
if (!credentials) throw Error("没有找到 Cloudflare 凭据：设置 CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID，或运行 npx wrangler login。");

const old = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile)) : null;
const oldRows = new Map();
if (old?.model === EMBEDDING_MODEL && old.dims === EMBEDDING_DIMS && fs.existsSync(binFile)) {
  const bin = new Int8Array(fs.readFileSync(binFile).buffer.slice(0));
  old.ids.forEach((id, i) => oldRows.set(id, { hash: old.hashes[i], vec: bin.subarray(i * EMBEDDING_DIMS, (i + 1) * EMBEDDING_DIMS) }));
}
const hashOf = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const rows = movies.map((m) => {
  const text = embeddingText(m);
  const hash = hashOf(text);
  const prev = oldRows.get(m.id);
  return { id: m.id, text, hash, vec: prev?.hash === hash ? prev.vec : null };
});
const todo = rows.filter((r) => !r.vec);
console.log(`${movies.length} titles; ${movies.length - todo.length} reused; ${todo.length} to embed with ${EMBEDDING_MODEL}`);
const batchSize = 50;
let cursor = 0, done = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < todo.length) {
    const batch = todo.slice(cursor, cursor += batchSize);
    let data;
    for (let attempt = 0; ; attempt++) {
      try { data = await embedWithRest(credentials, batch.map((r) => r.text)); break; }
      catch (error) {
        if (attempt >= 3 || /401|403|权限|登录/.test(error.message)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1500 * 2 ** attempt));
      }
    }
    data.forEach((vec, i) => {
      if (vec.length !== EMBEDDING_DIMS) throw Error(`Unexpected dims ${vec.length}`);
      batch[i].vec = quantize(vec);
    });
    done += batch.length;
    if (done % 500 < batchSize) console.log(`embedded ${done}/${todo.length}`);
  }
}));
const out = new Int8Array(rows.length * EMBEDDING_DIMS);
rows.forEach((r, i) => out.set(r.vec, i * EMBEDDING_DIMS));
fs.writeFileSync(binFile, Buffer.from(out.buffer));
fs.writeFileSync(metaFile, JSON.stringify({ model: EMBEDDING_MODEL, dims: EMBEDDING_DIMS, generatedAt: new Date().toISOString(), ids: rows.map((r) => r.id), hashes: rows.map((r) => r.hash) }));
console.log(`Wrote ${rows.length} vectors (${(out.length / 1048576).toFixed(1)} MiB)`);
