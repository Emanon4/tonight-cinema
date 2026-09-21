import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {api, details, normalize} from './tmdb-client.mjs';

// Expand the long tail without removing existing titles or padding to a count.
const root = path.resolve(import.meta.dirname, '..');
const dest = path.join(root, 'public/data/movies.json');
const cache = path.join(root, '.cache/curation');
fs.mkdirSync(cache, {recursive: true});
const movies = JSON.parse(fs.readFileSync(dest));
const existing = new Set(movies.map(m => m.id));
const policy = {rating: 7, minimumVotes: 30, releasedThrough: new Date().getUTCFullYear() - 1};
const seeds = new Map();
const decades = Array.from({length: Math.floor((policy.releasedThrough - 1900) / 10) + 1}, (_, i) => 1900 + i * 10);
let nextDecade = 0;
await Promise.all(Array.from({length: 4}, async () => {
  while (nextDecade < decades.length) {
    const start = decades[nextDecade++], end = Math.min(start + 9, policy.releasedThrough);
    for (let page = 1; page <= 500; page++) {
      const params = {language: 'zh-CN', sort_by: 'vote_average.desc', include_adult: 'false', 'primary_release_date.gte': `${start}-01-01`, 'primary_release_date.lte': `${end}-12-31`, 'vote_average.gte': policy.rating, 'vote_count.gte': policy.minimumVotes, page};
      const name = createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 20);
      const file = path.join(cache, `expansion-${name}.json`);
      let data;
      if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 86400000) data = JSON.parse(fs.readFileSync(file));
      else { data = await api('discover/movie', params); fs.writeFileSync(file, JSON.stringify(data)); }
      if (data.total_pages > 500) throw Error(`Split decade ${start} before importing more than 500 pages`);
      for (const m of data.results || []) if (m.poster_path && !existing.has(`tmdb-${m.id}`)) seeds.set(m.id, m);
      if (page >= data.total_pages || !data.results?.length) break;
    }
    console.log(`Discovered through ${start}–${end}; new unique candidates ${seeds.size}`);
  }
}));

const list = [...seeds.values()].sort((a, b) => a.id - b.id);
const added = [], rejected = [], failures = [];
let cursor = 0;
await Promise.all(Array.from({length: 8}, async () => {
  while (cursor < list.length && failures.length < 10) {
    const seed = list[cursor++];
    try {
      const d = await details(seed.id), m = normalize(d);
      if (!m || !m.year || m.year > policy.releasedThrough || m.rating < policy.rating || m.votes < policy.minimumVotes) {
        rejected.push({id: seed.id, reason: 'incomplete metadata or no longer eligible'}); continue;
      }
      added.push({...m, addedBy: 'audience-long-tail'});
      if (added.length % 100 === 0) console.log(`Imported ${added.length} new films`);
    } catch (e) { failures.push({id: seed.id, error: e.message}); }
  }
}));
if (failures.length) {
  fs.writeFileSync(path.join(cache, 'expansion-failures.json'), JSON.stringify(failures, null, 2));
  throw Error(`${failures.length} detail failures; existing catalog unchanged. Cached successes allow resumption.`);
}
const result = [...movies, ...added].sort((a, b) => b.popularity - a.popularity || a.id.localeCompare(b.id));
const ids = new Set(result.map(m => m.id));
if (ids.size !== result.length || !movies.every(m => ids.has(m.id))) throw Error('Catalog integrity failed');
const report = {generatedAt: new Date().toISOString(), policy, previousCount: movies.length, total: result.length, added: added.length, languages: [...new Set(result.map(m => m.language))].sort(), rejected, failures, newIds: added.map(m => m.id)};
fs.writeFileSync(dest + '.next', JSON.stringify(result));
fs.renameSync(dest + '.next', dest);
fs.writeFileSync(path.join(root, 'data/curation/expansion-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({...report, newIds: undefined, rejected: rejected.length}, null, 2));
