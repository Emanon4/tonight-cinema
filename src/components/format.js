import { genreLabels } from "../../server/core.mjs";
const mediaTypeLabels = { movie: "电影", series: "剧集" };
export const mediaLabel = (movie) => mediaTypeLabels[movie.mediaType || "movie"] || "内容";
export const genreName = (g) => genreLabels[g] || g;
export function seriesCount(m) {
  if (m.mediaType !== "series" || !(m.seasons || m.episodes)) return "";
  return [m.seasons && `${m.seasons} 季`, m.episodes && `${m.episodes} 集`].filter(Boolean).join(" · ");
}
export function matchLabel(match) {
  return match.score >= 2.6 ? "很合心意" : "值得一看";
}
