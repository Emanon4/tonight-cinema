// Load data separately from the Worker bundle and reuse it within this isolate.
export function createCatalogLoader() {
  let pending;
  return function loadCatalog(env) {
    if (!pending) pending = (async () => {
      const read = async file => {
        const response = await env.ASSETS.fetch(`https://assets.local/${file}`);
        if (!response.ok) throw Error('电影库加载失败，请稍后重试。');
        return response.json();
      };
      const manifest = await read('manifest.json');
      if (manifest.version !== env.CATALOG_VERSION || manifest.count !== Number(env.CATALOG_COUNT)) {
        throw Error('电影库版本不一致，请稍后重试。');
      }
      const movies=[];
      for (const file of manifest.parts) {
        const part = await read(file);
        movies.push(...part);
      }
      if (movies.length !== manifest.count || new Set(movies.map(m=>m.id)).size !== manifest.count) {
        throw Error('电影库不完整，请稍后重试。');
      }
      return movies;
    })().catch(error=>{pending=undefined;throw error;});
    return pending;
  };
}
