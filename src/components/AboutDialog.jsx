import React, { useEffect, useRef } from "react";
import { X, Film } from "lucide-react";

export default function AboutDialog({ open, count, base, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    if (open) ref.current?.showModal?.();
    else ref.current?.close?.();
  }, [open]);
  return (
    <dialog ref={ref} onCancel={onClose} className="small-dialog" aria-label="关于片库">
      <button className="close" aria-label="关闭关于片库" onClick={onClose}>
        <X />
      </button>
      <Film />
      <h2>每一个故事，都有出处。</h2>
      <p>当前收录 {count.toLocaleString()} 部电影与剧集。电影与剧集资料、海报来自 TMDB。</p>
      <p>
        候选先由关键词、结构条件与多语言语义检索召回，再由 Jev 阅读简介判断匹配，不会直接观看正片。简介不完整时，情绪判断也可能有偏差；中文效果仍在持续验证。
      </p>
      <p>
        想看、看过与不合适都只保存在当前浏览器，清除浏览器数据会移除。这些记录不会上传给站长，也不表示模型已经学习。
      </p>
      <div className="tmdb-credit">
        <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer">
          <img src={base + "tmdb.svg"} alt="TMDB" width="100" />
        </a>
        <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </div>
    </dialog>
  );
}
