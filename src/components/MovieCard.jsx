import React from "react";
import { ArrowUpRight, Bookmark, Sparkles } from "lucide-react";
import Poster from "./Poster.jsx";
import { mediaLabel, genreName, seriesCount, matchLabel } from "./format.js";

export default function MovieCard({ movie: m, index, saved, onOpen, onToggleSave }) {
  const count = seriesCount(m);
  // The meta row already shows the Douban rating.
  const chips = (m.match?.reasons || []).filter((r) => !r.startsWith("豆瓣")).slice(0, 3);
  return (
    <article className="movie-card" style={{ "--delay": `${Math.min(index, 11) * 35}ms` }}>
      <div className="poster-wrap">
        <button className="poster-open" onClick={() => onOpen(m)} aria-label={"查看 " + (m.zh || m.title)}>
          <Poster movie={m} />
          <span className="poster-hover">
            走进这个故事 <ArrowUpRight size={16} />
          </span>
        </button>
        <button
          className={"save " + (saved ? "is-saved" : "")}
          aria-label={(saved ? "取消收藏 " : "收藏 ") + (m.zh || m.title)}
          aria-pressed={saved}
          onClick={() => onToggleSave(m.id)}
        >
          <Bookmark size={17} fill={saved ? "currentColor" : "none"} />
        </button>
        {m.match && (
          <span className="match-badge">
            <Sparkles size={11} />
            {matchLabel(m.match)}
          </span>
        )}
      </div>
      <button className="movie-name" onClick={() => onOpen(m)}>
        {m.zh || m.title}
      </button>
      {m.zh && <div className="original-title">{m.title}</div>}
      <div className="movie-meta">
        <span className="media-type">{mediaLabel(m)}</span>
        <span>·</span>
        <span>{m.year}</span>
        <span>·</span>
        <span>{m.genres.slice(0, 2).map(genreName).join(" / ") || mediaLabel(m)}</span>
        {count && <span className="series-count">{count}</span>}
        {m.rating > 0 && <span className="rating">★ {m.rating.toFixed(1)}</span>}
        {m.doubanRating > 7.5 && (
          <span className="rating douban-rating">豆瓣 {m.doubanRating.toFixed(1)}</span>
        )}
      </div>
      {chips.length > 0 && (
        <ul className="reason-chips" aria-label="推荐依据">
          {chips.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </article>
  );
}
