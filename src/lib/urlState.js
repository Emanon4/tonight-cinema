export const emptyFilters = { mediaType: "", genre: "", decade: "all", maxRuntime: "" };
const keys = { mediaType: "type", genre: "genre", decade: "decade", maxRuntime: "runtime" };

export function readUrlState(search) {
  const params = new URLSearchParams(search);
  const filters = { ...emptyFilters };
  for (const [field, param] of Object.entries(keys)) {
    const value = params.get(param);
    if (value) filters[field] = value;
  }
  return { query: (params.get("q") || "").slice(0, 300), filters };
}

export function urlFor({ query = "", filters = emptyFilters }) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  for (const [field, param] of Object.entries(keys))
    if (filters[field] && filters[field] !== emptyFilters[field]) params.set(param, filters[field]);
  const text = params.toString();
  return text ? "?" + text : "";
}

export function hasFilters(filters) {
  return Object.keys(emptyFilters).some((k) => filters[k] !== emptyFilters[k]);
}

export function sameFilters(a, b) {
  return Object.keys(emptyFilters).every((k) => (a?.[k] ?? emptyFilters[k]) === (b?.[k] ?? emptyFilters[k]));
}
