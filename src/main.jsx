import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowRight,
  Search,
  Bookmark,
  X,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Film,
  Check,
  LoaderCircle,
  Settings2,
  ExternalLink,
} from "lucide-react";
import {
  genreLabels,
  filtered,
  parseFilters,
  retrieve,
} from "../server/core.mjs";
import "./style.css";
const BASE = import.meta.env.BASE_URL;
const examples = [
  "想看一部温暖的电影，给今天收个好尾",
  "像《盗梦空间》一样，让我脑子转起来",
  "90 年代的犯罪片，氛围越浓越好",
  "关于孤独、城市和人与人相遇的故事",
];
const featured = [
  "The Grand Budapest Hotel",
  "Interstellar",
  "La La Land",
  "In the Mood for Love",
  "Spirited Away",
  "Her",
  "Fantastic Mr. Fox",
  "The Truman Show",
  "The Secret Life of Walter Mitty",
  "Soul",
  "Before Sunrise",
  "The Royal Tenenbaums",
  "Arrival",
  "Moonrise Kingdom",
];
function storage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function Poster({ movie, className = "", lazy = true }) {
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
function App() {
  const [movies, setMovies] = useState([]),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [activeQuery, setActiveQuery] = useState(""),
    [results, setResults] = useState(null),
    [busy, setBusy] = useState(false),
    [view, setView] = useState("discover"),
    [saved, setSaved] = useState(() => storage("cinema-saved", [])),
    [selected, setSelected] = useState(null),
    [showSettings, setShowSettings] = useState(false),
    [showAbout, setShowAbout] = useState(false),
    [apiBase, setApiBase] = useState(""),
    [token, setToken] = useState(
      () => sessionStorage.getItem("cinema-access") || "",
    ),
    [health, setHealth] = useState(null),
    [filters, setFilters] = useState({
      genre: "",
      decade: "all",
      maxRuntime: "",
    }),
    [more, setMore] = useState(24),
    [meta, setMeta] = useState(null);
  const controller = useRef(null),
    requestId = useRef(0),
    modal = useRef(null),
    settings = useRef(null),
    about = useRef(null),
    input = useRef(null);
  useEffect(() => {
    fetch(BASE + "data/movies.json?v=" + __CATALOG_VERSION__)
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then(setMovies)
      .catch(() => setError("片库加载失败，请刷新页面重试。"));
    fetch(BASE + "config.json", {cache:"no-store"})
      .then((r) => r.json())
      .then((c) => setApiBase(import.meta.env.DEV ? "" : c.apiBase || ""))
      .catch(() => {});
  }, []);
  useEffect(() => {
    let live = true;
    setHealth(null);
    fetch(apiBase + "/api/health")
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((h) => {
        if (live) setHealth(h);
      })
      .catch(() => {
        if (live) setHealth({ ready: false });
      });
    return () => {
      live = false;
    };
  }, [apiBase]);
  useEffect(() => {
    try {
      localStorage.setItem("cinema-saved", JSON.stringify(saved));
    } catch {}
  }, [saved]);
  useEffect(() => {
    if (selected) modal.current?.showModal();
    else modal.current?.close();
  }, [selected]);
  useEffect(() => {
    if (showSettings) settings.current?.showModal();
    else settings.current?.close();
  }, [showSettings]);
  useEffect(() => {
    if (showAbout) about.current?.showModal();
    else about.current?.close();
  }, [showAbout]);
  function toggle(id) {
    setSaved((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  function reset() {
    requestId.current++;
    controller.current?.abort();
    setBusy(false);
    setResults(null);
    setActiveQuery("");
    setQuery("");
    setError("");
    setMeta(null);
    setView("discover");
    setFilters({ genre: "", decade: "all", maxRuntime: "" });
    setMore(24);
  }
  async function search(text = query, override = filters) {
    text = text.trim();
    if (text.length < 2) {
      setError("写下两个字以上的观影心情吧。");
      input.current?.focus();
      return;
    }
    if (health?.accessRequired && !token) {
      setShowSettings(true);
      return;
    }
    setQuery(text);
    setActiveQuery(text);
    setView("discover");
    setError("");
    setBusy(true);
    setResults(null);
    setMeta(null);
    controller.current?.abort();
    const rid = ++requestId.current;
    const ac = new AbortController();
    controller.current = ac;
    try {
      if (!health?.ready) {
        throw Error(
          "智能筛选服务尚未连接。你仍可使用类型筛选、浏览片库和收藏。",
        );
      }
      const r = await fetch(apiBase + "/api/recommend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body: JSON.stringify({ query: text, filters: override }),
        signal: ac.signal,
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error || "筛选暂时失败。");
      if (rid !== requestId.current) return;
      if (data.results.some(r => !movies.some(m => m.id === r.id))) throw Error("电影库刚刚更新，请刷新页面后重新选片。");
      setResults(data.results);
      setMeta(data);
    } catch (e) {
      if (e.name !== "AbortError" && rid === requestId.current) {
        setError(e.message);
        setResults([]);
      }
    } finally {
      if (rid === requestId.current) setBusy(false);
    }
  }
  const picks = featured
    .map((t) => movies.find((m) => m.title === t))
    .filter(Boolean);
  const all = filtered(movies, parseFilters("", filters));
  const byId = new Map(movies.map((m) => [m.id, m]));
  let visible =
    view === "saved"
      ? movies.filter((m) => saved.includes(m.id))
      : results !== null
        ? results
            .map((r) => ({ ...byId.get(r.id), match: r }))
            .filter((m) => m.id)
        : filters.genre || filters.decade !== "all" || filters.maxRuntime
          ? all.slice(0, more)
          : [
              ...picks,
              ...movies.filter((m) => !picks.some((p) => p.id === m.id)),
            ].slice(0, more);
  function changeFilter(k, v) {
    const f = { ...filters, [k]: v };
    setFilters(f);
    setMore(24);
    if (activeQuery) search(activeQuery, f);
  }
  return (
    <>
      <header>
        <button className="brand" onClick={reset} aria-label="今夜放映首页">
          <span className="brand-mark">
            <Film size={21} />
          </span>
          <span>
            今夜放映<small>TONIGHT CINEMA</small>
          </span>
        </button>
        <nav aria-label="主导航">
          <button
            className={view === "discover" ? "active" : ""}
            onClick={() => setView("discover")}
          >
            发现电影
          </button>
          <button
            className={view === "saved" ? "active" : ""}
            onClick={() => setView("saved")}
          >
            <Bookmark size={15} /> 我的片单{" "}
            <span className="count">{saved.length}</span>
          </button>
        </nav>
        <button
          className="connection"
          onClick={() => setShowSettings(true)}
          aria-label="连接设置"
        >
          <i className={health?.ready ? "online" : ""} />
          <span>{health?.ready ? "Jev 已就绪" : "连接 Jev"}</span>
          <Settings2 size={14} />
        </button>
      </header>
      <main>
        {view === "discover" ? (
          <>
            <section className="hero">
              <div className="eyebrow">
                <span /> A LITTLE ESCAPE, A GREAT STORY <span />
              </div>
              <h1>
                今晚，想走进
                <br />
                <em>怎样的故事？</em>
                <span className="asterisk">✳</span>
              </h1>
              <p className="intro">
                把心情交给一句话。让下一部电影，刚好懂你。
              </p>
              <form
                className="searchbox"
                onSubmit={(e) => {
                  e.preventDefault();
                  search();
                }}
              >
                <Search size={22} strokeWidth={1.5} />
                <input
                  ref={input}
                  aria-label="描述观影需求"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="比如：有点孤独，但看完会想拥抱生活的电影"
                  maxLength={300}
                />
                <button
                  className="submit"
                  aria-label="为我选片"
                  disabled={busy || !movies.length}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={21} />
                  ) : (
                    <ArrowRight size={23} />
                  )}
                </button>
              </form>
              <div className="suggestions">
                <span>没有灵感？试试</span>
                {["温暖一下", "脑洞大开", "复古犯罪", "城市漫游"].map(
                  (t, i) => (
                    <button key={t} onClick={() => search(examples[i])}>
                      {t}
                      <ArrowUpRight size={12} />
                    </button>
                  ),
                )}
              </div>
              <div className="hero-note">
                <Sparkles size={12} />
                {movies.length
                  ? `${movies.length.toLocaleString()} 部电影，等一句你的心情`
                  : "正在打开电影库…"}
              </div>
            </section>
            {!activeQuery &&
              !filters.genre &&
              filters.decade === "all" &&
              !filters.maxRuntime && (
                <section className="poster-stage" aria-label="今日电影灵感">
                  <div className="stage-line" />
                  <span className="stage-label">
                    YOUR NEXT FAVORITE
                    <br />
                    IS SOMEWHERE HERE.
                  </span>
                  <div className="poster-fan">
                    {picks.slice(0, 9).map((m, i) => (
                      <button
                        key={m.id}
                        style={{
                          "--angle": `${(i - 4) * 5}deg`,
                          "--rise": `${Math.abs(i - 4) * 9}px`,
                          "--i": i,
                        }}
                        onClick={() => setSelected(m)}
                        aria-label={"查看 " + (m.zh || m.title)}
                      >
                        <Poster movie={m} lazy={false} />
                      </button>
                    ))}
                  </div>
                  <span className="stage-caption">
                    {Math.min(9, picks.length)} 个世界 · 随时入场 <ArrowUpRight size={14} />
                  </span>
                </section>
              )}
          </>
        ) : (
          <section className="saved-hero">
            <div className="eyebrow">YOUR PRIVATE SCREENING ROOM</div>
            <h1>
              留给<em>下一晚。</em>
            </h1>
            <p>那些让你想按下播放的故事，先收在这里。</p>
          </section>
        )}
        <section className="library">
          <div className="section-title">
            <div>
              <span className="section-index">
                {view === "saved" ? "02" : "01"} /
              </span>
              <h2>
                {view === "saved"
                  ? "我的待看片单"
                  : activeQuery
                    ? "为这一刻选的电影"
                    : "慢慢挑，总会遇见"}
              </h2>
            </div>
            {view === "discover" && (
              <button
                className="shuffle"
                onClick={() => {
                  const pool = all.filter((m) => m.poster);
                  if (pool.length)
                    setSelected(pool[Math.floor(Math.random() * pool.length)]);
                }}
              >
                <Shuffle size={15} />
                随机邂逅
              </button>
            )}
          </div>
          {view === "discover" && (
            <div className="filters">
              <SlidersHorizontal size={15} />
              <label>
                <span className="sr-only">电影类型</span>
                <select
                  aria-label="电影类型"
                  value={filters.genre}
                  onChange={(e) => changeFilter("genre", e.target.value)}
                >
                  <option value="">所有类型</option>
                  {Object.entries(genreLabels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">年代</span>
                <select
                  aria-label="年代"
                  value={filters.decade}
                  onChange={(e) => changeFilter("decade", e.target.value)}
                >
                  <option value="all">所有年代</option>
                  {["1990", "2000", "2010", "2020"].map((x) => (
                    <option key={x} value={x}>
                      {x} 年代
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">片长</span>
                <select
                  aria-label="片长"
                  value={filters.maxRuntime}
                  onChange={(e) => changeFilter("maxRuntime", e.target.value)}
                >
                  <option value="">不限片长</option>
                  <option value="90">90 分钟内</option>
                  <option value="120">两小时内</option>
                </select>
              </label>
              {activeQuery && (
                <button className="clear" onClick={reset}>
                  清除筛选 <X size={12} />
                </button>
              )}
              <span className="filter-meta">
                {activeQuery
                  ? busy
                    ? "正在读你的观影心情…"
                    : `${visible.length} 部入选`
                  : `${all.length.toLocaleString()} 部可探索`}
              </span>
            </div>
          )}
          <div aria-live="polite">
            {error && (
              <div className="notice error">
                {error}
                {activeQuery && <button onClick={() => search()}>重试</button>}
              </div>
            )}
            {meta && (
              <div className="query-summary">
                <Sparkles size={15} />
                <span>“{activeQuery}”</span>
                <small>
                  {meta.cached
                    ? "来自本次条件的缓存"
                    : `Jev 从 ${meta.candidateCount} 部候选中筛选 · ${(meta.elapsedMs / 1000).toFixed(1)}s`}
                </small>
              </div>
            )}
            {busy && (
              <div className="loading-state">
                <LoaderCircle className="spin" />
                <h3>正在替今晚选一个世界</h3>
                <p>先找相关电影，再让 Jev 阅读简介、判断匹配。</p>
                <button
                  onClick={() => {
                    controller.current?.abort();
                    requestId.current++;
                    setBusy(false);
                    setActiveQuery("");
                    setResults(null);
                  }}
                >
                  取消
                </button>
              </div>
            )}
          </div>
          {!busy && (
            <div className="movie-grid">
              {visible.map((m, i) => (
                <article
                  className="movie-card"
                  key={m.id}
                  style={{ "--delay": `${Math.min(i, 11) * 35}ms` }}
                >
                  <div className="poster-wrap">
                    <button
                      className="poster-open"
                      onClick={() => setSelected(m)}
                      aria-label={"查看 " + (m.zh || m.title)}
                    >
                      <Poster movie={m} />
                      <span className="poster-hover">
                        走进这个故事 <ArrowUpRight size={16} />
                      </span>
                    </button>
                    <button
                      className={
                        "save " + (saved.includes(m.id) ? "is-saved" : "")
                      }
                      aria-label={
                        (saved.includes(m.id) ? "取消收藏 " : "收藏 ") +
                        (m.zh || m.title)
                      }
                      aria-pressed={saved.includes(m.id)}
                      onClick={() => toggle(m.id)}
                    >
                      <Bookmark
                        size={17}
                        fill={saved.includes(m.id) ? "currentColor" : "none"}
                      />
                    </button>
                    {m.match && (
                      <span className="match-badge">
                        <Sparkles size={11} />
                        {m.match.score >= 2.6 ? "很合心意" : "值得一看"}
                      </span>
                    )}
                  </div>
                  <button className="movie-name" onClick={() => setSelected(m)}>
                    {m.zh || m.title}
                  </button>
                  {m.zh && <div className="original-title">{m.title}</div>}
                  <div className="movie-meta">
                    <span>{m.year}</span>
                    <span>·</span>
                    <span>
                      {m.genres
                        .slice(0, 2)
                        .map((g) => genreLabels[g] || g)
                        .join(" / ") || "电影"}
                    </span>
                    {m.rating > 0 && (
                      <span className="rating">★ {m.rating.toFixed(1)}</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
          {!busy && movies.length > 0 && !visible.length && !error && (
            <div className="empty">
              <Film size={32} />
              <h3>
                {view === "saved" ? "片单还是空的" : "这次还没有合适的电影"}
              </h3>
              <p>
                {view === "saved"
                  ? "点一下海报上的书签，把想看的留给下一晚。"
                  : filters.maxRuntime
                    ? "片长未知的电影不会被当作符合条件。试着放宽片长限制。"
                    : "试着少加一个限制，给故事一点相遇的余地。"}
              </p>
              <button onClick={reset}>
                回到电影库 <ArrowRight size={15} />
              </button>
            </div>
          )}
          {view === "discover" &&
            !activeQuery &&
            visible.length < all.length && (
              <button
                className="load-more"
                onClick={() => setMore((m) => m + 24)}
              >
                再遇见一些电影 <ArrowRight size={15} />
              </button>
            )}
        </section>
      </main>
      <footer>
        <span>
          今夜放映 <i>·</i> GOOD FILMS, RIGHT FEELINGS.
        </span>
        <button onClick={() => setShowAbout(true)}>
          关于片库与推荐 <ArrowUpRight size={13} />
        </button>
      </footer>
      <dialog
        ref={modal}
        onCancel={() => setSelected(null)}
        onClick={(e) => {
          if (e.target === modal.current) setSelected(null);
        }}
        className="movie-dialog"
        aria-label="电影详情"
      >
        {selected && (
          <>
            <button
              className="close"
              aria-label="关闭电影详情"
              onClick={() => setSelected(null)}
            >
              <X />
            </button>
            <div className="detail-layout">
              <Poster movie={selected} lazy={false} />
              <div className="detail-body">
                <div className="eyebrow">TONIGHT'S POSSIBLE WORLD</div>
                <h2>{selected.zh || selected.title}</h2>
                <p className="detail-original">
                  {selected.title} · {selected.year}
                </p>
                <div className="tags">
                  {selected.genres.map((g) => (
                    <span key={g}>{genreLabels[g] || g}</span>
                  ))}
                </div>
                <p className="detail-stats">
                  {selected.runtime
                    ? `${selected.runtime} 分钟`
                    : "片长资料待补充"}
                  {selected.rating
                    ? ` · TMDB ${selected.rating.toFixed(1)}`
                    : ""}
                </p>
                <h3>故事从这里开始</h3>
                <p className="overview">{selected.overview}</p>
                {selected.match && (
                  <p className="evidence">
                    Jev 根据以上简介判断与“{activeQuery}
                    ”的匹配程度。未验证的情节不作为保证。
                  </p>
                )}
                <p className="cast">
                  {selected.cast?.length
                    ? "出演 · " + selected.cast.join(" / ")
                    : ""}
                </p>
                <div className="detail-actions">
                  <button
                    className="primary"
                    onClick={() => toggle(selected.id)}
                  >
                    {saved.includes(selected.id) ? (
                      <Check size={17} />
                    ) : (
                      <Bookmark size={17} />
                    )}{" "}
                    {saved.includes(selected.id) ? "已放入片单" : "留给下一晚"}
                  </button>
                  <a href={selected.source} target="_blank" rel="noreferrer">
                    查看资料来源 <ExternalLink size={14} />
                  </a>
                </div>
                <small className="source-note">
                  资料来自 {selected.provider} · 本站不提供正片播放
                </small>
              </div>
            </div>
          </>
        )}
      </dialog>
      <dialog
        ref={settings}
        onCancel={() => setShowSettings(false)}
        className="small-dialog"
        aria-label="连接设置"
      >
        <button
          className="close"
          aria-label="关闭连接设置"
          onClick={() => setShowSettings(false)}
        >
          <X />
        </button>
        <Settings2 size={24} />
        <h2>连接你的放映室</h2>
        <p>
          访问码只用于进入你的私人智能选片服务。无需在网页中填写 Jev API 密钥。
        </p>
        <label>
          网站访问码
          <input
            type="text"
            autoCapitalize="none"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="输入部署时生成的访问码"
            autoComplete="off"
          />
        </label>
        <button
          className="primary"
          onClick={() => {
            sessionStorage.setItem("cinema-access", token);
            setShowSettings(false);
          }}
        >
          保存访问码 <Check size={16} />
        </button>
        <p className="source-note">
          {health?.ready
            ? "智能选片服务已连接。"
            : "智能选片后端尚未上线；普通浏览和收藏可用。"}
        </p>
      </dialog>
      <dialog
        ref={about}
        onCancel={() => setShowAbout(false)}
        className="small-dialog"
        aria-label="关于片库"
      >
        <button
          className="close"
          aria-label="关闭关于片库"
          onClick={() => setShowAbout(false)}
        >
          <X />
        </button>
        <Film />
        <h2>每一个故事，都有出处。</h2>
        <p>
          当前收录 {movies.length.toLocaleString()} 部电影。
          {movies.some((m) => m.provider === "TMDB")
            ? "电影资料与海报来自 TMDB。"
            : "启动片库来自 Wikipedia 的美国电影资料，范围以 1950—2022 年为主，不代表全球片库；少量中文片名为人工补充。"}
        </p>
        <p>
          Jev
          阅读候选电影简介来判断匹配，不会直接观看电影。简介不完整时，情绪判断也可能有偏差；中文效果仍在持续验证。
        </p>
        <p>收藏保存在当前浏览器，清除浏览器数据会移除片单。</p>
        {!movies.some((m) => m.provider === "TMDB") && (
          <p>
            <a
              href="https://github.com/prust/wikipedia-movie-data"
              target="_blank"
              rel="noreferrer"
            >
              Wikipedia 数据整理来源
            </a>{" "}
            ·{" "}
            <a
              href="https://creativecommons.org/licenses/by-sa/4.0/"
              target="_blank"
              rel="noreferrer"
            >
              文字 CC BY-SA
            </a>
            。每部电影详情均附原文链接。海报权利归各自权利人。
          </p>
        )}
        {movies.some((m) => m.provider === "TMDB") && (
          <div className="tmdb-credit">
            <a
              href="https://www.themoviedb.org/"
              target="_blank"
              rel="noreferrer"
            >
              <img src={BASE + "tmdb.svg"} alt="TMDB" width="100" />
            </a>
            <p>
              This product uses the TMDB API but is not endorsed or certified by
              TMDB.
            </p>
          </div>
        )}
      </dialog>
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
