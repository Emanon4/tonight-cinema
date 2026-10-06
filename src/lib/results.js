import { filtered, parseFilters, genreLabels } from "../../server/core.mjs";

// Narrow an existing Jev result list in the browser instead of paying for a new search.
export function narrowResults(results, byId, filters) {
  const f = parseFilters("", filters);
  return results.filter((r) => {
    const m = byId.get(r.id);
    return m && filtered([m], f).length > 0;
  });
}

// Only genres with enough titles become filter options.
export function genreOptions(movies, minimum = 20) {
  const counts = {};
  for (const m of movies) for (const g of m.genres) counts[g] = (counts[g] || 0) + 1;
  return Object.entries(genreLabels)
    .filter(([g]) => (counts[g] || 0) >= minimum)
    .map(([g, label]) => ({ value: g, label, count: counts[g] }));
}

export function missingIds(results, byId) {
  return results.filter((r) => !byId.has(r.id)).map((r) => r.id);
}
