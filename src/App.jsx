import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Search,
  Bookmark,
  Shuffle,
  Sparkles,
  Film,
  LoaderCircle,
  Settings2,
  RefreshCw,
} from "lucide-react";
import { filtered, parseFilters } from "../server/core.mjs";
import MovieCard from "./components/MovieCard.jsx";
import FilterBar from "./components/FilterBar.jsx";
import MovieDialog from "./components/MovieDialog.jsx";
import SettingsDialog from "./components/SettingsDialog.jsx";
import AboutDialog from "./components/AboutDialog.jsx";
import Poster from "./components/Poster.jsx";
import { readJson, writeJson, readToken, saveToken, tokenRemembered } from "./lib/storage.js";
import { emptyFilters, readUrlState, urlFor, hasFilters, sameFilters } from "./lib/urlState.js";
import { narrowResults, genreOptions, missingIds } from "./lib/results.js";
import { requestRecommendation, progressText } from "./lib/api.js";

const BASE = import.meta.env?.BASE_URL || "./";
const examples = [
  "想看一部温暖的电影，给今天收个好尾",
  "像《盗梦空间》一样，让我脑子转起来",
  "90 年代的犯罪片，氛围越浓越好",
  "想看一部高质量动画剧集，慢慢追完",
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
const cacheKey = (q, f) => JSON.stringify([q, f]);

export default function App({ initialMovies = [], initialUrl = "" }) {
  const initial = useMemo(
    () => readUrlState(initialUrl || (typeof location !== "undefined" ? location.search : "")),
    [],
  );
  const [movies, setMovies] = useState(initialMovies),
    [error, setError] = useState(""),
    [query, setQuery] = useState(initial.query),
    [activeQuery, setActiveQuery] = useState(""),
    [activeFilters, setActiveFilters] = useState(emptyFilters),
    [results, setResults] = useState(null),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(null),
    [view, setView] = useState("discover"),
    [saved, setSaved] = useState(() => readJson("cinema-saved", [])),
    [feedback, setFeedback] = useState(() => readJson("cinema-feedback", { watched: [], skip: [] })),
    [shelf, setShelf] = useState("want"),
    [selected, setSelected] = useState(null),
    [showSettings, setShowSettings] = useState(false),
    [settingsMessage, setSettingsMessage] = useState(""),
    [showAbout, setShowAbout] = useState(false),
    [apiBase, setApiBase] = useState(null),
    [token, setToken] = useState(readToken),
    [remember, setRemember] = useState(tokenRemembered),
    [health, setHealth] = useState(null),
    [filters, setFilters] = useState(initial.filters),
    [more, setMore] = useState(24),
    [meta, setMeta] = useState(null);
  const controller = useRef(null),
    requestId = useRef(0),
    detailCache = useRef(new Map()),
    resultCache = useRef(new Map()),
    healthReady = useRef(null),
    pendingUrlSearch = useRef(!!initial.query),
    input = useRef(null);

  useEffect(() => {
    if (initialMovies.length) return;
    fetch(BASE + "data/catalog/index-" + __CATALOG_VERSION__ + ".json")
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then(setMovies)
      .catch(() => setError("内容库加载失败，请刷新页面重试。"));
    fetch(BASE + "config.json", { cache: "no-store" })
      .then((r) => r.json())
      .then((c) => setApiBase(import.meta.env.DEV ? "" : c.apiBase || ""))
      .catch(() => setApiBase(""));
  }, []);
  useEffect(() => {
    if (apiBase === null) return;
    let live = true;
    setHealth(null);
    // Searches wait for this instead of failing while health is still loading.
    healthReady.current = fetch(apiBase + "/api/health")
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .catch(() => ({ ready: false }))
      .then((h) => {
        if (live) setHealth(h);
        return h;
      });
    return () => {
      live = false;
    };
  }, [apiBase]);
  useEffect(() => writeJson("cinema-saved", saved), [saved]);
  useEffect(() => writeJson("cinema-feedback", feedback), [feedback]);
  useEffect(() => {
    if (!selected || selected.overview || !selected.detailChunk) return;
    const id = selected.id;
    let cancelled = false;
    async function loadDetails() {
      try {
        if (!detailCache.current.has(id)) {
          const response = await fetch(BASE + "data/catalog/" + selected.detailChunk);
          if (!response.ok) throw Error("简介加载失败，请刷新页面后重试。");
          const rows = await response.json();
          for (const row of rows) detailCache.current.set(row.id, row);
        }
        const detail = detailCache.current.get(id);
        if (!detail) throw Error("暂未找到这部内容的详细资料。");
        if (!cancelled) setSelected((current) => (current?.id === id ? { ...current, ...detail } : current));
      } catch (error) {
        if (!cancelled)
          setSelected((current) => (current?.id === id ? { ...current, detailError: error.message } : current));
      }
    }
    loadDetails();
    return () => {
      cancelled = true;
    };
  }, [selected?.id]);
  // A shared link (?q=…) runs once the catalog and API address are known.
  useEffect(() => {
    if (pendingUrlSearch.current && movies.length && apiBase !== null) {
      pendingUrlSearch.current = false;
      search(initial.query, initial.filters, { history: "replace" });
    }
  }, [movies.length, apiBase]);
  useEffect(() => {
    const onPop = () => {
      const state = readUrlState(location.search);
      setQuery(state.query);
      setFilters(state.filters);
      if (state.query) search(state.query, state.filters, { history: "none" });
      else clearSearch(state.filters);
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  });

  function writeUrl(q, f, mode) {
    if (mode === "none" || typeof history === "undefined") return;
    const url = location.pathname + urlFor({ query: q, filters: f }) + location.hash;
    if (url === location.pathname + location.search + location.hash) return;
    if (mode === "push") history.pushState(null, "", url);
    else history.replaceState(null, "", url);
  }
  function toggle(id) {
    setFeedback((f) => ({
      watched: f.watched.filter((x) => x !== id),
      skip: f.skip.filter((x) => x !== id),
    }));
    setSaved((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  function mark(kind, id) {
    setSaved((s) => s.filter((x) => x !== id));
    setFeedback((f) => {
      const other = kind === "watched" ? "skip" : "watched";
      return {
        [kind]: f[kind].includes(id) ? f[kind].filter((x) => x !== id) : [...f[kind], id],
        [other]: f[other].filter((x) => x !== id),
      };
    });
  }
  function clearSearch(nextFilters = emptyFilters) {
    requestId.current++;
    controller.current?.abort();
    setBusy(false);
    setProgress(null);
    setResults(null);
    setActiveQuery("");
    setActiveFilters(emptyFilters);
    setError("");
    setMeta(null);
    setFilters(nextFilters);
    setMore(24);
  }
  function reset() {
    clearSearch();
    setQuery("");
    setView("discover");
    writeUrl("", emptyFilters, "push");
  }
  async function search(text = query, override = filters, { history: mode = "push", token: accessToken = token } = {}) {
    text = text.trim();
    if (text.length < 2) {
      setError("写下两个字以上的观影心情吧。");
      input.current?.focus();
      return;
    }
    setQuery(text);
    setActiveQuery(text);
    setActiveFilters(override);
    setFilters(override);
    setView("discover");
    setError("");
    setMeta(null);
    setMore(24);
    writeUrl(text, override, mode);
    controller.current?.abort();
    const rid = ++requestId.current;
    const key = cacheKey(text, override);
    if (resultCache.current.has(key)) {
      const data = resultCache.current.get(key);
      setBusy(false);
      setResults(data.results);
      setMeta({ ...data, cached: true });
      return;
    }
    setBusy(true);
    setProgress(null);
    setResults(null);
    const ac = new AbortController();
    controller.current = ac;
    try {
      const h = health || (await healthReady.current) || { ready: false };
      if (rid !== requestId.current) return;
      if (!h.ready) throw Error("智能筛选服务尚未连接。你仍可使用类型筛选、浏览片库和收藏。");
      if (h.accessRequired && !accessToken) {
        setSettingsMessage("先输入网站访问码，再开始智能选片。");
        setShowSettings(true);
        throw Error("需要网站访问码才能智能选片。");
      }
      const data = await requestRecommendation({
        apiBase,
        token: accessToken,
        query: text,
        filters: override,
        signal: ac.signal,
        onProgress: (p) => rid === requestId.current && setProgress(p),
      });
      if (rid !== requestId.current) return;
      if (missingIds(data.results, byId).length) throw Error("内容库刚刚更新，请刷新页面后重新选片。");
      if (!data.partial) resultCache.current.set(key, data);
      setResults(data.results);
      setMeta(data);
    } catch (e) {
      if (e.name === "AbortError" || rid !== requestId.current) return;
      if (e.status === 401) {
        setSettingsMessage(e.message);
        setShowSettings(true);
      }
      setError(e.message);
      setResults([]);
    } finally {
      if (rid === requestId.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  }
  const picks = useMemo(
    () => featured.map((t) => movies.find((m) => m.title === t)).filter(Boolean),
    [movies],
  );
  const genres = useMemo(() => genreOptions(movies), [movies]);
  const all = useMemo(() => filtered(movies, parseFilters("", filters)), [movies, filters]);
  const byId = useMemo(() => new Map(movies.map((m) => [m.id, m])), [movies]);
  const hidden = useMemo(() => new Set([...feedback.watched, ...feedback.skip]), [feedback]);
  const filtersChanged = activeQuery && !sameFilters(filters, activeFilters);
  const narrowed = useMemo(
    () => (results === null ? null : filtersChanged ? narrowResults(results, byId, filters) : results),
    [results, byId, filters, filtersChanged],
  );
  const hiddenCount = narrowed ? narrowed.filter((r) => hidden.has(r.id)).length : 0;
  const shelfIds = shelf === "want" ? saved : shelf === "watched" ? feedback.watched : feedback.skip;
  const visible =
    view === "saved"
      ? shelfIds.map((id) => byId.get(id)).filter(Boolean)
      : narrowed !== null
        ? narrowed.map((r) => ({ ...byId.get(r.id), match: r })).filter((m) => m.id && !hidden.has(m.id))
        : hasFilters(filters)
          ? all.slice(0, more)
          : [...picks, ...movies.filter((m) => !picks.some((p) => p.id === m.id))].slice(0, more);
  // Changing a filter after a search narrows the paid results locally; a new
  // Jev search only runs when the visitor asks for it.
  function changeFilter(k, v) {
    const f = { ...filters, [k]: v };
    setFilters(f);
    setMore(24);
    writeUrl(activeQuery, f, "replace");
  }
  const browsing = !activeQuery && !hasFilters(filters);
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
          <button className={view === "discover" ? "active" : ""} onClick={() => setView("discover")}>
            发现内容
          </button>
          <button className={view === "saved" ? "active" : ""} onClick={() => setView("saved")}>
            <Bookmark size={15} /> 我的片单 <span className="count">{saved.length}</span>
          </button>
        </nav>
        <button
          className="connection"
          onClick={() => {
            setSettingsMessage("");
            setShowSettings(true);
          }}
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
              <p className="intro">把心情交给一句话，让电影或剧集刚好懂你。</p>
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
                  placeholder="比如：有点孤独，但看完会想拥抱生活的电影或剧集"
                  maxLength={300}
                />
                <button className="submit" aria-label="为我选片" disabled={busy || !movies.length}>
                  {busy ? <LoaderCircle className="spin" size={21} /> : <ArrowRight size={23} />}
                </button>
              </form>
              <div className="suggestions">
                <span>没有灵感？试试</span>
                {["温暖一下", "脑洞大开", "复古犯罪", "城市漫游"].map((t, i) => (
                  <button key={t} onClick={() => search(examples[i], emptyFilters)}>
                    {t}
                    <ArrowUpRight size={12} />
                  </button>
                ))}
              </div>
              <div className="hero-note">
                <Sparkles size={12} />
                {movies.length
                  ? `${movies.length.toLocaleString()} 部电影与剧集，等一句你的心情`
                  : "正在打开内容库…"}
              </div>
            </section>
            {browsing && (
              <section className="poster-stage" aria-label="今日内容灵感">
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
            <div className="shelf-tabs" role="tablist" aria-label="片单分类">
              {[
                ["want", `想看 ${saved.length}`],
                ["watched", `看过 ${feedback.watched.length}`],
                ["skip", `不合适 ${feedback.skip.length}`],
              ].map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={shelf === id}
                  className={shelf === id ? "is-on" : ""}
                  onClick={() => setShelf(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="feedback-note">
              想看仍是原来的收藏。看过与不合适只存在这台浏览器，不会上传，也不会让模型自动学习。
            </p>
          </section>
        )}
        <section className="library">
          <div className="section-title">
            <div>
              <span className="section-index">{view === "saved" ? "02" : "01"} /</span>
              <h2>
                {view === "saved"
                  ? shelf === "want"
                    ? "我的待看片单"
                    : shelf === "watched"
                      ? "已经看过"
                      : "不太合适"
                  : activeQuery
                    ? "为这一刻选的内容"
                    : "慢慢挑，总会遇见"}
              </h2>
            </div>
            {view === "discover" && (
              <button
                className="shuffle"
                onClick={() => {
                  const pool = all.filter((m) => m.poster);
                  if (pool.length) setSelected(pool[Math.floor(Math.random() * pool.length)]);
                }}
              >
                <Shuffle size={15} />
                随机邂逅
              </button>
            )}
          </div>
          {view === "discover" && (
            <FilterBar
              filters={filters}
              genres={genres}
              onChange={changeFilter}
              onClear={reset}
              showClear={!!activeQuery || hasFilters(filters)}
              meta={
                activeQuery
                  ? busy
                    ? "正在读你的观影心情…"
                    : `${visible.length} 部入选`
                  : `${all.length.toLocaleString()} 部可探索`
              }
            />
          )}
          <div aria-live="polite">
            {error && (
              <div className="notice error">
                {error}
                {activeQuery && <button onClick={() => search(activeQuery, activeFilters, { history: "none" })}>重试</button>}
              </div>
            )}
            {filtersChanged && !busy && results !== null && (
              <div className="notice refine">
                已在本次结果里按新条件筛选，没有重新调用 Jev。
                <button onClick={() => search(activeQuery, filters)}>
                  <RefreshCw size={12} /> 按新条件重新选片
                </button>
              </div>
            )}
            {meta?.partial && (
              <div className="notice">
                有 {meta.partial.failedBatches}/{meta.partial.totalBatches} 批候选因 Jev 暂时繁忙未能评分，以下结果来自其余候选，可能漏掉部分合适内容。
              </div>
            )}
            {meta && (
              <div className="query-summary">
                <Sparkles size={15} />
                <span>“{activeQuery}”</span>
                <small>
                  {meta.cached
                    ? "来自本次条件的缓存"
                    : `Jev 从 ${meta.candidateCount} 部候选中筛选${meta.semantic ? "（含语义召回）" : ""} · ${(meta.elapsedMs / 1000).toFixed(1)}s`}
                  {hiddenCount ? ` · 已隐藏 ${hiddenCount} 部你标为看过或不合适的内容` : ""}
                </small>
              </div>
            )}
            {busy && (
              <div className="loading-state">
                <LoaderCircle className="spin" />
                <h3>正在替今晚选一个世界</h3>
                <p>{progressText(progress)}</p>
                {progress?.stage === "ranking" && (
                  <div
                    className="progress"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={progress.total}
                    aria-valuenow={progress.done}
                  >
                    <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                  </div>
                )}
                <button
                  onClick={() => {
                    controller.current?.abort();
                    requestId.current++;
                    setBusy(false);
                    setActiveQuery("");
                    setResults(null);
                    writeUrl("", filters, "replace");
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
                <MovieCard
                  key={m.id}
                  movie={m}
                  index={i}
                  saved={saved.includes(m.id)}
                  onOpen={setSelected}
                  onToggleSave={toggle}
                />
              ))}
            </div>
          )}
          {!busy && movies.length > 0 && !visible.length && !error && (
            <div className="empty">
              <Film size={32} />
              <h3>{view === "saved" ? "片单还是空的" : "这次还没有合适的内容"}</h3>
              <p>
                {view === "saved"
                  ? shelf === "want"
                    ? "点一下海报上的书签，把想看的留给下一晚。"
                    : "在详情里可以改回想看，或取消这条记录。"
                  : filters.maxRuntime
                    ? "片长未知的内容不会被当作符合条件。试着放宽片长限制。"
                    : "试着少加一个限制，给故事一点相遇的余地。"}
              </p>
              <button onClick={reset}>
                回到内容库 <ArrowRight size={15} />
              </button>
            </div>
          )}
          {view === "discover" && !activeQuery && visible.length < all.length && (
            <button className="load-more" onClick={() => setMore((m) => m + 24)}>
              再遇见一些内容 <ArrowRight size={15} />
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
      <MovieDialog
        movie={selected}
        query={activeQuery}
        saved={!!selected && saved.includes(selected.id)}
        feedback={feedback}
        onClose={() => setSelected(null)}
        onToggleSave={toggle}
        onWatched={(id) => mark("watched", id)}
        onSkip={(id) => mark("skip", id)}
      />
      <SettingsDialog
        open={showSettings}
        token={token}
        remember={remember}
        ready={!!health?.ready}
        message={settingsMessage}
        onClose={() => setShowSettings(false)}
        onSave={(value, keep) => {
          saveToken(value, keep);
          setToken(value);
          setRemember(keep);
          setShowSettings(false);
          setSettingsMessage("");
          if (value && activeQuery && error) search(activeQuery, activeFilters, { history: "none", token: value });
        }}
      />
      <AboutDialog open={showAbout} count={movies.length} base={BASE} onClose={() => setShowAbout(false)} />
    </>
  );
}
