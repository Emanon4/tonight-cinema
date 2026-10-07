import React, { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

const REGION_NAMES = { CN: "中国内地", HK: "中国香港", TW: "中国台湾", SG: "新加坡", US: "美国", JP: "日本", KR: "韩国", GB: "英国" };
const KINDS = [["flatrate", "订阅"], ["free", "免费"], ["ads", "免费（含广告）"], ["rent", "租借"], ["buy", "购买"]];
// Mainland platforms have no JustWatch data; link their own search pages.
const SEARCHES = [
  ["腾讯视频", (q) => `https://v.qq.com/x/search/?q=${q}`],
  ["爱奇艺", (q) => `https://so.iqiyi.com/so/q_${q}`],
  ["优酷", (q) => `https://so.youku.com/search_video/q_${q}`],
  ["芒果TV", (q) => `https://so.mgtv.com/so?k=${q}`],
  ["哔哩哔哩", (q) => `https://search.bilibili.com/all?keyword=${q}`],
];

function guessRegion() {
  const lang = (typeof navigator !== "undefined" && navigator.language) || "";
  const m = lang.match(/-([A-Z]{2})$/i);
  if (m) return m[1].toUpperCase();
  return /^zh/i.test(lang) ? "CN" : "US";
}

export default function WatchPanel({ movie }) {
  const watch = movie.watch || {};
  const regions = ["CN", ...Object.keys(watch)];
  const [region, setRegion] = useState("CN");
  useEffect(() => {
    const guess = guessRegion();
    setRegion(regions.includes(guess) ? guess : "CN");
  }, [movie.id]);
  const data = watch[region];
  const query = encodeURIComponent(movie.zh || movie.title);
  return (
    <section className="watch" aria-label="在哪看">
      <div className="watch-head">
        <h3 className="sub">在哪看</h3>
        <div className="watch-regions" role="tablist" aria-label="地区">
          {regions.map((r) => (
            <button key={r} role="tab" aria-selected={r === region} className={"chip" + (r === region ? " is-on" : "")} onClick={() => setRegion(r)}>
              {REGION_NAMES[r] || r}
            </button>
          ))}
        </div>
      </div>
      {region === "CN" ? (
        <>
          <p className="watch-note">中国内地暂无正版渠道数据，可以在这些平台搜索：</p>
          <div className="watch-search">
            {SEARCHES.map(([name, url]) => (
              <a key={name} className="pill" href={url(query)} target="_blank" rel="noreferrer">
                {name} <ExternalLink size={13} />
              </a>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="watch-groups">
            {KINDS.filter(([k]) => data?.[k]?.length).map(([k, label]) => (
              <div className="watch-group" key={k}>
                <span>{label}</span>
                <ul>
                  {data[k].map((p) => (
                    <li key={p.n} title={p.n}>
                      <img src={`https://image.tmdb.org/t/p/w92${p.l}`} alt={p.n} loading="lazy" width="36" height="36" />
                      <small>{p.n}</small>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {data?.link && (
            <a className="watch-more" href={data.link} target="_blank" rel="noreferrer">
              查看全部渠道与价格 <ExternalLink size={13} />
            </a>
          )}
        </>
      )}
      <small className="source-note">观看渠道数据由 JustWatch 提供，经 TMDB 获取；可能与平台实际上架情况有出入。</small>
    </section>
  );
}
