import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Search,
  Bookmark,
  Shuffle,
  Sparkles,
  Film,
  LoaderCircle,
  Settings2,
  RefreshCw,
  House,
  Clapperboard,
  Tv,
} from "lucide-react";
import { filtered, parseFilters } from "../server/core.mjs";
import MovieCard from "./components/MovieCard.jsx";
import FilterBar from "./components/FilterBar.jsx";
import MovieDialog from "./components/MovieDialog.jsx";
import SettingsDialog from "./components/SettingsDialog.jsx";
import AboutDialog from "./components/AboutDialog.jsx";
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
const cacheKey = (q, f, p) => JSON.stringify([q, f, p]);
const PAGE_SIZE = 12;
const refinements = ["更轻松一点", "更烧脑一点", "近几年的", "两小时以内", "换成剧集"];

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
    [page, setPage] = useState(0),
    [personalOn, setPersonalOn] = useState(() => readJson("cinema-personal", false)),
    [refine, setRefine] = useState(""),
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
  useEffect(() => writeJson("cinema-personal", personalOn), [personalOn]);
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
    setPage(0);
    writeUrl(text, override, mode);
    controller.current?.abort();
    const rid = ++requestId.current;
    // Opt-in only: the shelves leave the browser solely with this request.
    const personal = personalOn
      ? {
          exclude: [...feedback.watched, ...feedback.skip].slice(-300),
          like: [...saved, ...feedback.watched].slice(-60),
          dislike: feedback.skip.slice(-60),
        }
      : undefined;
    const key = cacheKey(text, override, personal);
    if (resultCache.current.has(key)) {
      const data = resultCache.current.get(key);
      setBusy(false);
      setResults([...data.results, ...(data.more || [])]);
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
        personal,
        signal: ac.signal,
        onProgress: (p) => rid === requestId.current && setProgress(p),
      });
      if (rid !== requestId.current) return;
      const pool = [...data.results, ...(data.more || [])];
      if (missingIds(pool, byId).length) throw Error("内容库刚刚更新，请刷新页面后重新选片。");
      if (!data.partial) resultCache.current.set(key, data);
      setResults(pool);
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
  const hiddenCount = narrowed ? narrowed.slice(0, (page + 1) * PAGE_SIZE).filter((r) => hidden.has(r.id)).length : 0;
  const unseen = narrowed ? narrowed.filter((r) => !hidden.has(r.id)) : [];
  const remaining = Math.max(0, unseen.length - (page + 1) * PAGE_SIZE);
  const shelfIds = shelf === "want" ? saved : shelf === "watched" ? feedback.watched : feedback.skip;
  const visible =
    view === "saved"
      ? shelfIds.map((id) => byId.get(id)).filter(Boolean)
      : narrowed !== null
        ? unseen.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((r) => ({ ...byId.get(r.id), match: r })).filter((m) => m.id)
        : hasFilters(filters)
          ? all.slice(0, more)
          : [...picks, ...movies.filter((m) => !picks.some((p) => p.id === m.id))].slice(0, more);
  // Changing a filter after a search narrows the paid results locally; a new
  // Jev search only runs when the visitor asks for it.
  function changeFilter(k, v) {
    const f = { ...filters, [k]: v };
    setFilters(f);
    setMore(24);
    setPage(0);
    writeUrl(activeQuery, f, "replace");
  }
  const browsing = !activeQuery && !hasFilters(filters);
  // The ambient light behind the page follows whatever poster leads the view.
  const ambient = visible.find((m) => m.poster)?.poster || picks[0]?.poster;
  const dockItems = [
    ["home", "首页", House, view === "discover" && !filters.mediaType, reset],
    ["movie", "电影", Clapperboard, view === "discover" && filters.mediaType === "movie", () => browseType("movie")],
    ["series", "剧集", Tv, view === "discover" && filters.mediaType === "series", () => browseType("series")],
    ["saved", "我的片单", Bookmark, view === "saved", () => setView("saved")],
    ["settings", "连接设置", Settings2, false, () => { setSettingsMessage(""); setShowSettings(true); }],
  ];
  function browseType(type) {
    setView("discover");
    if (activeQuery) changeFilter("mediaType", type);
    else {
      const f = { ...emptyFilters, mediaType: type };
      setFilters(f);
      setMore(24);
      writeUrl("", f, "push");
    }
    scrollTo?.({ top: 0, behavior: "smooth" });
  }
  return (
    <>
      <div className="ambient" aria-hidden="true">
        {ambient && <img key={ambient} src={ambient} alt="" />}
      </div>
      <header className="topbar">
        <button className="brand" onClick={reset} aria-label="今夜放映首页">
          <span className="brand-mark">夜</span>
          今夜放映
        </button>
        <button
          className="connection"
          onClick={() => {
            setSettingsMessage("");
            setShowSettings(true);
          }}
          aria-label="连接设置"
        >
          <i className={health?.ready ? "online" : ""} />
          {health?.ready ? "Jev 已就绪" : "连接 Jev"}
        </button>
      </header>
      <main>
        {view === "discover" ? (
          <section className={"hero" + (activeQuery ? " compact" : "")}>
            {!activeQuery && (
              <>
                <h1>今晚，想走进怎样的故事？</h1>
                <p className="intro">
                  {movies.length
                    ? `说一句此刻的心情，从 ${movies.length.toLocaleString()} 部电影与剧集里挑出刚好合拍的几部`
                    : "正在打开内容库…"}
                </p>
              </>
            )}
            <form
              className="searchbox"
              onSubmit={(e) => {
                e.preventDefault();
                search();
              }}
            >
              <Search size={19} />
              <input
                ref={input}
                aria-label="描述观影需求"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="比如：有点孤独，但看完会想拥抱生活"
                maxLength={300}
              />
              <button className="submit" disabled={busy || !movies.length}>
                {busy ? <LoaderCircle className="spin" size={18} /> : activeQuery ? "重新选片" : "为我选片"}
              </button>
            </form>
            {!activeQuery && (
              <div className="suggestions">
                {["温暖一下", "脑洞大开", "复古犯罪", "城市漫游"].map((t, i) => (
                  <button key={t} className="chip" onClick={() => search(examples[i], emptyFilters)}>
                    {t}
                  </button>
                ))}
              </div>
            )}
            <FilterBar
              filters={filters}
              genres={genres}
              onChange={changeFilter}
              onClear={reset}
              showClear={!!activeQuery || hasFilters(filters)}
            />
          </section>
        ) : (
          <section className="saved-hero">
            <h1>我的片单</h1>
            <p>那些想留给下一晚的故事，先收在这里。</p>
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
                  className={"chip" + (shelf === id ? " is-on" : "")}
                  onClick={() => setShelf(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="feedback-note">
              {personalOn
                ? "已开启“让片单参与选片”：选片时会附带这些作品编号，服务端不保存。"
                : "这些记录只存在这台浏览器，不会上传，也不会让模型自动学习。"}
            </p>
          </section>
        )}
        <section className="library">
          <div aria-live="polite">
            {error && (
              <div className="notice error">
                {error}
                {activeQuery && <button onClick={() => search(activeQuery, activeFilters, { history: "none" })}>重试</button>}
              </div>
            )}
            {filtersChanged && !busy && results !== null && (
              <div className="notice">
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
                <q>{activeQuery}</q>
                <small>
                  {meta.nearDuplicate
                    ? "复用了一次几乎相同需求的结果，没有重新调用 Jev"
                    : meta.cached
                      ? "来自本次条件的缓存"
                      : `Jev 从 ${meta.candidateCount} 部候选中筛选${meta.semantic ? " · 含语义召回" : ""} · ${(meta.elapsedMs / 1000).toFixed(1)} 秒`}
                  {meta.personalized ? " · 已参考你的片单" : ""}
                  {hiddenCount ? ` · 已隐藏 ${hiddenCount} 部看过或不合适的内容` : ""}
                </small>
              </div>
            )}
            {meta && !busy && (
              <form
                className="refine"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (refine.trim()) search(`${activeQuery}，${refine.trim()}`.slice(0, 300), activeFilters);
                  setRefine("");
                }}
              >
                <span>再调一下</span>
                {refinements.map((r) => (
                  <button type="button" className="chip" key={r} onClick={() => search(`${activeQuery}，${r}`.slice(0, 300), activeFilters)}>
                    {r}
                  </button>
                ))}
                <label className="sr-only" htmlFor="refine-input">补充要求</label>
                <input
                  id="refine-input"
                  value={refine}
                  onChange={(e) => setRefine(e.target.value)}
                  placeholder="或者写一句补充，比如：别太长"
                  maxLength={60}
                />
              </form>
            )}
            {busy && (
              <div className="loading-state">
                <LoaderCircle className="spin" size={26} />
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
                  className="chip"
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
            <div className="section-title">
              <h2>
                {view === "saved"
                  ? shelf === "want"
                    ? "想看"
                    : shelf === "watched"
                      ? "已经看过"
                      : "不太合适"
                  : activeQuery
                    ? `为这一刻选的 ${visible.length} 部`
                    : browsing
                      ? "今晚可以从这里开始"
                      : `${all.length.toLocaleString()} 部符合条件`}
              </h2>
              {view === "discover" && (
                <button
                  className="shuffle"
                  onClick={() => {
                    const pool = all.filter((m) => m.poster);
                    if (pool.length) setSelected(pool[Math.floor(Math.random() * pool.length)]);
                  }}
                >
                  <Shuffle size={14} />
                  随机邂逅
                </button>
              )}
            </div>
          )}
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
              <Film size={30} />
              <h3>{view === "saved" ? "这里还是空的" : "这次还没有合适的内容"}</h3>
              <p>
                {view === "saved"
                  ? shelf === "want"
                    ? "点片名旁边的书签，把想看的留给下一晚。"
                    : "在详情里可以改回想看，或取消这条记录。"
                  : filters.maxRuntime
                    ? "片长未知的内容不会被当作符合条件。试着放宽片长限制。"
                    : "试着少加一个限制，给故事一点相遇的余地。"}
              </p>
              <button className="chip" onClick={reset}>
                回到首页
              </button>
            </div>
          )}
          {view === "discover" && activeQuery && !busy && narrowed !== null && (remaining > 0 || page > 0) && (
            <div className="page-more">
              {remaining > 0 ? (
                <button className="load-more" onClick={() => { setPage((p) => p + 1); scrollTo?.({ top: 0, behavior: "smooth" }); }}>
                  换一批
                  <small>还有 {remaining} 部备选 · 不再调用 Jev</small>
                </button>
              ) : (
                <button className="load-more" onClick={() => setPage(0)}>
                  回到第一批
                  <small>合适的都看完了</small>
                </button>
              )}
            </div>
          )}
          {view === "discover" && !activeQuery && visible.length < all.length && (
            <div className="page-more">
              <button className="load-more" onClick={() => setMore((m) => m + 24)}>
                再看一些
                <small>{all.length.toLocaleString()} 部可探索</small>
              </button>
            </div>
          )}
        </section>
      </main>
      <footer>
        <span>今夜放映 · GOOD FILMS, RIGHT FEELINGS.</span>
        <button onClick={() => setShowAbout(true)}>关于片库与推荐</button>
      </footer>
      <nav className="dock" aria-label="主导航">
        {dockItems.map(([id, label, Icon, on, act]) => (
          <button key={id} className={on ? "on" : ""} aria-label={label} title={label} aria-current={on ? "page" : undefined} onClick={act}>
            <Icon size={19} strokeWidth={1.8} />
            {id === "saved" && saved.length > 0 && <span className="count">{saved.length}</span>}
          </button>
        ))}
      </nav>
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
        personal={personalOn}
        onPersonalChange={setPersonalOn}
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
