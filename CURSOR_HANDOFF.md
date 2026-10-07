# 交接：今夜放映

更新日期：2026-10-07。本文不包含密钥。先读本文件、README.md 和 CHANGELOG.md，再按用户最新指令继续；不要重建项目。

## 用户目标与边界

- 用一句观影需求，由 Jev 从精选片库里挑电影或剧集。追求推荐准确，其次是成本。
- 片库保持全球覆盖、偏重口碑；不缩成华语库，不开发正片播放（调研过 CineJoy，其播放来自盗版抓取，明确不采用）。
- 界面是深色"夜色毛玻璃"风格（参考 CineJoy 的布局语言），标志是"月相胶片"，主题色琥珀 `#F3B660`。
- 豆瓣评分继续展示；豆瓣抓取脚本默认停用（robots.txt 禁止 `/j/`）。

## 现状

- 本机项目 `~/Downloads/tonight-cinema`；仓库 https://github.com/Emanon4/tonight-cinema（`main`）；网站 https://emanon4.github.io/tonight-cinema/ ；API https://tonight-cinema-api.moji-pet.workers.dev 。
- 片库 9,887 部：电影 7,295、剧集 2,592。带 TMDB 关键词、宣传语、导演、制片国家、预告片、观看渠道。
- `RECALL_VERSION=v9-country`；测试 48 项。
- 推荐链路：Jev 意图识别 → 混合召回 500 部（关键词/结构/产地/冷门 + bge-m3 向量）→ 每批 20 部打分、并发 10 → 前 30 部整体挑选 + 口碑权重 → 最多 12 部，另有 36 部备选供"换一批"。每次未命中缓存的搜索 27 次 Jev 调用，约 38 万输入 token。

## 准确率基准

- `data/eval/rating-pool.json`：50 条需求 × 20 部评分池；`data/eval/claude-ratings.json`：Claude 按作品本身判断的评分；`node scripts/score-ratings.mjs` 出结果。线上前 12 部 71.0% 很合适、26.2% 还行、2.8% 不合适（之后的产地、冷门、补缺改动只抽查了受影响需求）。
- 评分台页面已在收尾时删除；需要真人校准时，用 `rating-pool.json` 重新生成一个"只评看过的片"的打分页。
- 改推荐逻辑前后用 `scripts/eval-ranking.mjs --live`（金标准 A/B）或重跑评分池对比；不要只凭感觉上线。

## 代码导航

- `server/core.mjs`：查询分析（语言、产地、冷门、否定、片名、年代）、混合召回、Jev 调用、整体挑选、推荐理由。
- `server/semantic.mjs`：向量文本与 int8 索引；`server/worker.mjs`：访问码、限额（每日 100、每访客每小时 10、失败退还）、缓存与相似复用、流式进度、`/api/stats`、`/api/event`。
- `src/App.jsx`、`src/components/*`（含 `WatchPanel.jsx`）、`src/lib/*`、`src/brand.js`（标志几何）。
- 数据脚本：`import-recent`、`import-gaps`、`backfill-details`、`backfill-countries`、`import-watch`、`embeddings`、`generate-icons`；每月工作流 `.github/workflows/catalog-refresh.yml`。

## 本机凭据（只记录路径，不得打印或提交内容）

- Jev：`~/.config/typesafe/api-key.txt`；TMDB：`~/.config/tmdb/api-key.txt`；Cloudflare：wrangler OAuth（令牌短期有效，`npx wrangler whoami` 会刷新）。
- 网站访问码只在 Cloudflare secret `APP_ACCESS_TOKEN`。

## 发布

推送 main 自动部署 Pages；Worker 用 `npm run deploy:api`。改召回或排序必须升级 `RECALL_VERSION`。实测会产生 Jev 费用。
