import React, { useEffect, useRef, useState } from "react";
import { X, Check, Settings2 } from "lucide-react";

export default function SettingsDialog({ open, token, remember, ready, message, onSave, onClose }) {
  const ref = useRef(null);
  const [draft, setDraft] = useState(token);
  const [keep, setKeep] = useState(remember);
  useEffect(() => {
    if (open) {
      setDraft(token);
      setKeep(remember);
      ref.current?.showModal?.();
    } else ref.current?.close?.();
  }, [open]);
  return (
    <dialog ref={ref} onCancel={onClose} className="small-dialog" aria-label="连接设置">
      <button className="close" aria-label="关闭连接设置" onClick={onClose}>
        <X />
      </button>
      <Settings2 size={24} />
      <h2>连接你的放映室</h2>
      {message && <p className="notice error">{message}</p>}
      <p>访问码只用于进入你的私人智能选片服务。无需在网页中填写 Jev API 密钥。</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(draft.trim(), keep);
        }}
      >
        <label>
          网站访问码
          <input
            type="text"
            autoCapitalize="none"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="输入部署时生成的访问码"
            autoComplete="off"
          />
        </label>
        <label className="remember">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          在这台设备上记住访问码
        </label>
        <button className="primary" type="submit">
          保存访问码 <Check size={16} />
        </button>
      </form>
      <p className="source-note">
        {ready ? "智能选片服务已连接。" : "智能选片后端尚未上线；普通浏览和收藏可用。"}
        {keep ? " 公用电脑上请取消“记住”。" : " 关闭标签页后需要重新输入。"}
      </p>
    </dialog>
  );
}
