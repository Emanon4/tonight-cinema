import { createSemanticIndex } from "./semantic.mjs";
// Load data separately from the Worker bundle and reuse it within this isolate.
export function toWorkerMovie({id,mediaType,title,originalTitle,zh,year,runtime,genres,overview,overviewEn,recognition,language,rating,votes,doubanRating,doubanVotes,doubanSource,seasons,episodes,status}) {
  return {id,mediaType:mediaType || "movie",title,originalTitle,zh,year,runtime,genres,overview,overviewEn,recognition,language,rating,votes,doubanRating,doubanVotes,doubanSource,seasons,episodes,status};
}

async function readManifest(env) {
  const response = await env.ASSETS.fetch('https://assets.local/manifest.json');
  if (!response.ok) throw Error('内容库加载失败，请稍后重试。');
  const manifest = await response.json();
  if (manifest.version !== env.CATALOG_VERSION || manifest.count !== Number(env.CATALOG_COUNT)) {
    throw Error('内容库版本不一致，请稍后重试。');
  }
  return manifest;
}

export function createCatalogLoader() {
  let pending;
  return function loadCatalog(env) {
    if (!pending) pending = (async () => {
      const read = async file => {
        const response = await env.ASSETS.fetch(`https://assets.local/${file}`);
        if (!response.ok) throw Error('内容库加载失败，请稍后重试。');
        return response.json();
      };
      const manifest = await readManifest(env);
      const movies=[];
      // Keep below the Workers limit of six simultaneous outgoing connections.
      for (let start = 0; start < manifest.parts.length; start += 4) {
        const parts = await Promise.all(manifest.parts.slice(start, start + 4).map(read));
        for (const part of parts) movies.push(...part);
      }
      if (movies.length !== manifest.count || new Set(movies.map(m=>m.id)).size !== manifest.count) {
        throw Error('内容库不完整，请稍后重试。');
      }
      return movies;
    })().catch(error=>{pending=undefined;throw error;});
    return pending;
  };
}

// Resolves to a semantic index, or null when this deploy ships no vectors.
export function createVectorLoader() {
  let pending;
  return function loadVectors(env) {
    if (!pending) pending = (async () => {
      const manifest = await readManifest(env);
      if (!manifest.vectors) return null;
      const [metaResponse, binResponse] = await Promise.all([
        env.ASSETS.fetch('https://assets.local/vectors.json'),
        env.ASSETS.fetch('https://assets.local/vectors.i8'),
      ]);
      if (!metaResponse.ok || !binResponse.ok) throw Error('向量索引加载失败。');
      const meta = await metaResponse.json();
      if (meta.ids.length !== manifest.vectors.count || meta.dims !== manifest.vectors.dims) throw Error('向量索引版本不一致。');
      return createSemanticIndex({ ids: meta.ids, dims: meta.dims, vectors: new Int8Array(await binResponse.arrayBuffer()) });
    })().catch(error=>{pending=undefined;throw error;});
    return pending;
  };
}
