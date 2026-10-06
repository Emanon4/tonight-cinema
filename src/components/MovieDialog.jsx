import React, { useEffect, useRef } from "react";
import { ArrowLeft, Plus, Check, Eye, Ban, ExternalLink, Sparkles } from "lucide-react";
import { mediaLabel, genreName, seriesCount } from "./format.js";
import { aspectLabels, languageNames } from "../../server/core.mjs";

const large = (url) => (url || "").replace("/w342/", "/w780/");

export default function MovieDialog({ movie, query, saved, feedback, onClose, onToggleSave, onWatched, onSkip }) {
  const ref = useRef(null);
  useEffect(() => {
    if (movie) {
      ref.current?.showModal?.();
      ref.current?.scrollTo?.(0, 0);
    } else ref.current?.close?.();
  }, [movie?.id]);
  const m = movie;
  const count = m && seriesCount(m);
  const watched = m && feedback.watched.includes(m.id);
  const skipped = m && feedback.skip.includes(m.id);
  const language = m && (languageNames[m.language] || m.language?.toUpperCase());
  return (
    <dialog ref={ref} onCancel={onClose} className="movie-dialog" aria-label="内容详情">
      {m && (
        <>
          <div className="backdrop" aria-hidden="true">
            {m.poster && <img src={large(m.poster)} alt="" />}
          </div>
          <button className="back" aria-label="返回" onClick={onClose}>
            <ArrowLeft size={20} />
          </button>
          <div className="detail-head">
            <h2>{m.zh || m.title}</h2>
            {m.zh && m.zh !== m.title && <p className="detail-original">{m.title}</p>}
            <div className="genre-dots">
              {m.genres.slice(0, 3).map((g) => (
                <span key={g}>{genreName(g)}</span>
              ))}
              <span>{mediaLabel(m)}</span>
            </div>
            <div className="detail-actions">
              <button className="primary" onClick={() => onToggleSave(m.id)}>
                {saved ? <Check size={17} /> : <Plus size={17} />}
                {saved ? "已在片单" : "留给下一晚"}
              </button>
              <button className={"round" + (watched ? " is-on" : "")} aria-label={watched ? "取消看过" : "看过"} title={watched ? "已看过" : "看过"} aria-pressed={watched} onClick={() => onWatched(m.id)}>
                <Eye size={18} />
              </button>
              <button className={"round" + (skipped ? " is-on" : "")} aria-label={skipped ? "取消不合适" : "不合适"} title={skipped ? "已标为不合适" : "不合适"} aria-pressed={skipped} onClick={() => onSkip(m.id)}>
                <Ban size={18} />
              </button>
              {m.provider === "TMDB" && (
                <a className="pill" href={m.source + "/watch"} target="_blank" rel="noreferrer">
                  在哪看 <ExternalLink size={14} />
                </a>
              )}
            </div>
          </div>
          <div className="detail-body">
            <p className="detail-stats">
              <span>{m.year}</span>
              {m.runtime ? <span>{m.mediaType === "series" ? `单集约 ${m.runtime} 分钟` : `${m.runtime} 分钟`}</span> : null}
              {count ? <span>{count}</span> : null}
              {language && <span className="tag">{language}</span>}
              {m.rating ? <span className="rating">★ {m.rating.toFixed(1)}</span> : null}
              {m.doubanRating > 7.5 ? <span>豆瓣 {m.doubanRating.toFixed(1)}</span> : null}
            </p>
            <p className="overview">{m.overview || m.detailError || "正在加载简介…"}</p>
            {m.match && (
              <div className="evidence">
                <h3>
                  <Sparkles size={13} /> 为什么推荐
                </h3>
                {m.match.aspect && (
                  <p>
                    Jev 判断它主要契合：<b>{aspectLabels[m.match.aspect]}</b>。
                  </p>
                )}
                <p>根据以上简介判断与“{query}”的匹配程度，未验证的情节不作为保证。</p>
                {m.match.reasons?.length > 0 && (
                  <div className="tags">
                    {m.match.reasons.map((r) => (
                      <span key={r}>{r}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="facts">
              <div>
                <span>{m.mediaType === "series" ? "单集时长" : "片长"}</span>
                <span>{m.runtime ? `${m.runtime} 分钟` : "资料待补充"}</span>
              </div>
              <div>
                <span>原始语言</span>
                <span>{language || "—"}</span>
              </div>
              <div>
                <span>{m.mediaType === "series" ? "首播年份" : "上映年份"}</span>
                <span>{m.year}</span>
              </div>
              {m.recognition?.length > 0 && (
                <div>
                  <span>影史榜单</span>
                  <span>
                    {m.recognition.map((r, i) => (
                      <React.Fragment key={r.list}>
                        {i > 0 ? " · " : ""}
                        <a href={r.url} target="_blank" rel="noreferrer">
                          {r.list}
                        </a>
                      </React.Fragment>
                    ))}
                  </span>
                </div>
              )}
              <div>
                <span>资料来源</span>
                <span>
                  <a href={m.source} target="_blank" rel="noreferrer">
                    {m.provider}
                  </a>
                  {m.doubanRating > 7.5 ? " · 豆瓣评分" : ""}
                </span>
              </div>
            </div>
            {m.cast?.length > 0 && (
              <>
                <h3 className="sub">出演</h3>
                <ul className="cast">
                  {m.cast.map((name) => (
                    <li key={name}>
                      <i aria-hidden="true">{name.slice(0, 1)}</i>
                      {name}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <small className="source-note">本站不提供正片播放</small>
          </div>
        </>
      )}
    </dialog>
  );
}
