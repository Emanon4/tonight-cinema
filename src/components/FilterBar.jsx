import React from "react";
import { X } from "lucide-react";
import { decadeOptions } from "../../server/core.mjs";

export default function FilterBar({ filters, genres, onChange, onClear, showClear }) {
  const select = (name, label, options, empty) => (
    <label className={"chip select" + (filters[name] !== empty ? " is-on" : "")}>
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={filters[name]} onChange={(e) => onChange(name, e.target.value)}>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="filters">
      {select("mediaType", "内容类型", [["", "电影与剧集"], ["movie", "电影"], ["series", "剧集"]], "")}
      {select("genre", "内容题材", [["", "所有题材"], ...genres.map((g) => [g.value, g.label])], "")}
      {select("decade", "年代", [["all", "所有年代"], ...decadeOptions], "all")}
      {select("maxRuntime", "片长", [["", "不限片长"], ["90", "90 分钟内"], ["120", "两小时内"]], "")}
      {showClear && (
        <button className="chip clear" onClick={onClear}>
          清除 <X size={12} />
        </button>
      )}
    </div>
  );
}
