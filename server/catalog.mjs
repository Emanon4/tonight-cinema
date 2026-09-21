// Load data separately from the Worker bundle and reuse it within this isolate.
export function toWorkerMovie({id,mediaType,title,originalTitle,zh,year,runtime,genres,overview,overviewEn,recognition,language,rating,votes,doubanRating,doubanVotes,doubanSource,seasons,episodes,status}) {
  return {id,mediaType:mediaType || "movie",title,originalTitle,zh,year,runtime,genres,overview,overviewEn,recognition,language,rating,votes,doubanRating,doubanVotes,doubanSource,seasons,episodes,status};
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
      const manifest = await read('manifest.json');
      if (manifest.version !== env.CATALOG_VERSION || manifest.count !== Number(env.CATALOG_COUNT)) {
        throw Error('内容库版本不一致，请稍后重试。');
      }
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
