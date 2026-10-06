export class ApiError extends Error {
  constructor(message, status = 0, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Reads the Worker's NDJSON stream: progress lines, then one result or error.
export async function requestRecommendation({ apiBase, token, query, filters, personal, signal, onProgress = () => {} }) {
  const response = await fetch(apiBase + "/api/recommend", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify({ query, filters, ...(personal ? { personal } : {}) }),
    signal,
  });
  const type = response.headers.get("Content-Type") || "";
  if (!type.includes("ndjson")) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(data.error || "筛选暂时失败。", response.status, data.code);
    return data;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handle = (line) => {
    if (!line.trim()) return null;
    const event = JSON.parse(line);
    if (event.type === "progress") onProgress(event);
    else if (event.type === "error") throw new ApiError(event.error || "筛选暂时失败。", event.status);
    else if (event.type === "result") return event;
    return null;
  };
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      const result = handle(line);
      if (result) return result;
    }
    if (done) break;
  }
  const result = handle(buffer);
  if (result) return result;
  throw new ApiError("连接中断，没有收到完整结果，请重试。");
}

export function progressText(progress) {
  if (!progress) return "先找相关内容，再让 Jev 阅读简介、判断匹配。";
  if (progress.stage === "intent") return "正在理解你的需求…";
  if (progress.stage === "ranking")
    return `Jev 正在阅读候选简介 · ${progress.done}/${progress.total} 批`;
  if (progress.stage === "rerank") return "正在把入围内容放在一起比较…";
  return "正在挑选…";
}
