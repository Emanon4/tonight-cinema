# 交接：今夜放映

更新日期：2026-10-06。本文不包含密钥。先读本文件、README.md 和 CHANGELOG.md，再按用户最新指令继续；不要重建项目。

## 用户目标与边界

- 这是一个用 Jev 根据自然语言需求挑选电影或剧集的网站。
- 片库保持全球覆盖、优先收录经典佳作；不要缩成华语库，不要缩减片库。
- 保持现有的中文界面和访问码体验。
- 不开发正片播放，不更换 Jev。
- 豆瓣评分继续展示（用户确认）；豆瓣抓取脚本默认停用。

## 现状

- 本机项目在 `~/Downloads/tonight-cinema`，仓库是 https://github.com/Emanon4/tonight-cinema（`main` 分支）。
- 片库 9,453 部：电影 7,200 部、剧集 2,253 部。
- 召回版本 `RECALL_VERSION=v7-personal`。
- 向量文件在 `data/embeddings/`（bge-m3，int8，9.2 MiB），由 `npm run embeddings` 增量生成。
- 生产链路：有向量时召回 500 部，否则 1000 部 → 每批 20 部评分 → 前 20 名统一重排 → 最多展示 12 部。详见 README。
- 测试 45 项：`tests/core`、`catalog`、`retrieve-eval`、`worker`、`frontend`。

## 代码导航

- `server/core.mjs`：查询分析、混合召回、Jev 调用（意图、评分、重排）、推荐理由、部分失败容错。
- `server/semantic.mjs`：生成向量用的文本、int8 索引、Workers AI 绑定和 REST 两种向量调用方式。
- `server/worker.mjs`：
  - 访问码、CORS、缓存。
  - Budget Durable Object：每日共享 100 次、每访客每小时 10 次、失败退还；也负责相似需求复用（最近 300 条向量）和按日运行指标。
  - NDJSON 流式返回。
- `server/catalog.mjs`：加载 Worker 静态资源里的片库分片和向量。
- `server/local.mjs`：本地 API，地址 127.0.0.1:8793。
- `src/App.jsx`、`src/components/*`、`src/lib/*`：前端。
- `scripts/`：导入、补全、向量、评估脚本；`.github/workflows/catalog-refresh.yml` 每月开 PR。

## 本机凭据（只记录路径，不得打印或提交内容）

- Jev 密钥：`~/.config/typesafe/api-key.txt`。
- Cloudflare：wrangler OAuth 登录，需要包含 `ai:write` 权限。
- TMDB 密钥：本机暂无，`~/.config/tmdb/api-key.txt` 或 `TMDB_API_KEY`。
- 网站访问码：只在 Cloudflare secret `APP_ACCESS_TOKEN` 里，不要擅自重置。

## 发布

- 推送到 `main` 会自动部署 GitHub Pages。
- Worker 需要手动运行 `npm run deploy:api`。
- 只改了推荐逻辑时必须升级 `RECALL_VERSION`。
- 实测会产生 Jev 费用：每次未命中缓存的搜索约 27 次调用。
