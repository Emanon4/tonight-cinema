import React, { useState } from "react";
import { Film } from "lucide-react";

export default function Poster({ movie, className = "", lazy = true }) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={"poster " + className}
      style={{ "--hue": (movie.year * 7 + movie.title.length * 19) % 360 }}
    >
      {movie.poster && !failed ? (
        <img
          src={movie.poster}
          loading={lazy ? "lazy" : "eager"}
          alt={movie.zh || movie.title}
          onError={() => setFailed(true)}
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="poster-fallback">
          <Film size={30} />
          <span>{movie.zh || movie.title}</span>
          <small>{movie.year} · TONIGHT CINEMA</small>
        </div>
      )}
    </div>
  );
}
