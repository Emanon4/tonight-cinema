import React, { useEffect, useRef } from "react";
import { X, Check, Bookmark, Eye, Ban, ExternalLink } from "lucide-react";
import Poster from "./Poster.jsx";
import { mediaLabel, genreName, seriesCount } from "./format.js";
import { aspectLabels } from "../../server/core.mjs";

export default function MovieDialog({ movie, query, saved, feedback, onClose, onToggleSave, onWatched, onSkip }) {
  const ref = useRef(null);
  useEffect(() => {
    if (movie) ref.current?.showModal?.();
    else ref.current?.close?.();
  }, [movie]);
  const m = movie;
  const count = m && seriesCount(m);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="movie-dialog"
      aria-label="内容详情"
    >
      {m && (
        <>
          <button className="close" aria-label="关闭内容详情" onClick={onClose}>
            <X />
          </button>
          <div className="detail-layout">
            <Poster movie={m} lazy={false} />
            <div className="detail-body">
              <div className="eyebrow">TONIGHT'S POSSIBLE WORLD</div>
              <h2>{m.zh || m.title}</h2>
              <p className="detail-original">
                {mediaLabel(m)} · {m.title} · {m.year}
              </p>
              <div className="tags">
                {m.genres.map((g) => (
                  <span key={g}>{genreName(g)}</span>
                ))}
              </div>
              <p className="detail-stats">
                {m.runtime
                  ? m.mediaType === "series"
                    ? `单集约 ${m.runtime} 分钟`
                    : `${m.runtime} 分钟`
                  : m.mediaType === "series"
                    ? "单集时长待补充"
                    : "片长资料待补充"}
                {count ? ` · ${count}` : ""}
                {m.rating ? ` · TMDB ${m.rating.toFixed(1)}` : ""}
                {m.doubanRating > 7.5 ? ` · 豆瓣 ${m.doubanRating.toFixed(1)}` : ""}
              </p>
              <h3>故事从这里开始</h3>
              <p className="overview">{m.overview || m.detailError || "正在加载简介…"}</p>
              {m.match && (
                <div className="evidence">
                  <strong>为什么推荐</strong>
                  {m.match.aspect && <p>Jev 判断它主要契合：{aspectLabels[m.match.aspect]}。</p>}
                  {m.match.reasons?.length > 0 && <p>可核对的依据：{m.match.reasons.join(" · ")}。</p>}
                  <p>
                    Jev 根据以上简介判断与“{query}”的匹配程度，未验证的情节不作为保证。
                  </p>
                </div>
              )}
              {m.recognition?.length > 0 && (
                <p className="source-note">
                  影史榜单收录：
                  {m.recognition.map((r, i) => (
                    <React.Fragment key={r.list}>
                      {i > 0 ? " · " : ""}
                      <a href={r.url} target="_blank" rel="noreferrer">
                        {r.list}
                      </a>
                    </React.Fragment>
                  ))}
                </p>
              )}
              <p className="cast">{m.cast?.length ? "出演 · " + m.cast.join(" / ") : ""}</p>
              <div className="detail-actions">
                <button className="primary" onClick={() => onToggleSave(m.id)}>
                  {saved ? <Check size={17} /> : <Bookmark size={17} />} {saved ? "已放入片单" : "留给下一晚"}
                </button>
                <button className={"ghost" + (feedback.watched.includes(m.id) ? " is-on" : "")} onClick={() => onWatched(m.id)}>
                  <Eye size={16} /> {feedback.watched.includes(m.id) ? "已看过" : "看过"}
                </button>
                <button className={"ghost" + (feedback.skip.includes(m.id) ? " is-on" : "")} onClick={() => onSkip(m.id)}>
                  <Ban size={16} /> {feedback.skip.includes(m.id) ? "已标为不合适" : "不合适"}
                </button>
                <a href={m.source} target="_blank" rel="noreferrer">
                  查看资料来源 <ExternalLink size={14} />
                </a>
              </div>
              <small className="source-note">资料来自 {m.provider} · 本站不提供正片播放</small>
            </div>
          </div>
        </>
      )}
    </dialog>
  );
}
