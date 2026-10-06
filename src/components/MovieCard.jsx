import React from "react";
import { Bookmark, Sparkles } from "lucide-react";
import Poster from "./Poster.jsx";
import { mediaLabel, seriesCount, matchLabel } from "./format.js";

export default function MovieCard({ movie: m, index, saved, onOpen, onToggleSave }) {
  const count = seriesCount(m);
  // The meta row already shows the Douban rating.
  const chips = (m.match?.reasons || []).filter((r) => !r.startsWith("豆瓣")).slice(0, 3);
  const name = m.zh || m.title;
  return (
    <article className="movie-card" style={{ "--delay": `${Math.min(index, 11) * 35}ms` }}>
      <button className="poster-open" onClick={() => onOpen(m)} aria-label={"查看 " + name}>
        <Poster movie={m} />
        {m.match && (
          <span className="match-badge">
            <Sparkles size={10} />
            {matchLabel(m.match)}
          </span>
        )}
      </button>
      <div className="card-title">
        <button className="movie-name" onClick={() => onOpen(m)}>
          {name}
        </button>
        <button
          className={"save" + (saved ? " is-saved" : "")}
          aria-label={(saved ? "取消收藏 " : "收藏 ") + name}
          aria-pressed={saved}
          title={saved ? "已在片单" : "留给下一晚"}
          onClick={() => onToggleSave(m.id)}
        >
          <Bookmark size={15} strokeWidth={1.9} fill={saved ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="movie-meta">
        {m.rating > 0 && <span className="rating">★ {m.rating.toFixed(1)}</span>}
        <span>{m.year}</span>
        {m.doubanRating > 7.5 && <span>豆瓣 {m.doubanRating.toFixed(1)}</span>}
        {m.mediaType === "series" && <span>{count || mediaLabel(m)}</span>}
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
