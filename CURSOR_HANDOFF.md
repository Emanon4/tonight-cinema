# Cursor 交接：今夜放映

交接日期：2026-09-21。本文不包含密钥。先阅读本文件、README.md 和 VERIFICATION.md，再按本次用户指令继续；不要重建项目。

## 用户目标与当前边界

这是用 Jev 根据自然语言需求选电影或剧集的网站。用户希望全球内容库持续扩充，优先经典佳作，不要擅自限定成华语片库。保持现有中文界面与访问码体验。

当前继续执行用户指定的扩库及 500 部候选方案。此前已完成固定评估基线、混合召回和最简单的看过/不合适反馈。不要重建项目、缩减片库或改成华语限定。不要顺带开发正片播放或更换 Jev。后续可改善多轮交互或开放心情句的漏召回，以用户最新指令为准。

## 现状与交付

- 本机项目：`/Users/sean/Downloads/tonight-cinema`
- 仓库：https://github.com/Emanon4/tonight-cinema ，分支 `main`
- 网站：https://emanon4.github.io/tonight-cinema/
- API：https://tonight-cinema-api.moji-pet.workers.dev
- 片库扩至 50,000 部（+23,748），77 种原始语言代码；catalog version `919fad1905c4324e`。原有电影逐条保持不变。
- 电影阶段执行豆瓣高分与质量筛选：电影基线为 7,197 部；当前合并剧集后目录含 1,569 部去重后的豆瓣评分 >7.5 内容，239 部带 BFI/AFI 认领记录，其余通过 TMDB ≥7.0 且评分数 ≥100。最新公开豆瓣范围收集 1,807 部，匹配或补入 1,565 部，242 部未能确认 TMDB 内容实体，报告见 `data/curation/douban-quality-report.json`。
- 新增剧集池：2,374 部 `mediaType=series`，其中 839 部含 Animation 题材；电影为 `mediaType=movie`。内容类型会进入召回硬筛选，前端提供电影/剧集下拉区分；剧集记录保存单集时长、季数和集数。
- 召回策略版本 `RECALL_VERSION=v4-500`，已写入 Worker / 本地缓存键，避免命中旧算法的 24 小时缓存。
- 19 项测试通过。本轮同片库单条真实需求完成 100/500 候选对照；详细证据在 VERIFICATION.md 与 `data/eval/benchmark-500.json`。
- 本轮发布记录和正式网站验证见 VERIFICATION.md；此前 c978aa5 的 24 部方案已被本轮取代。

## 必须理解的推荐链路

`server/core.mjs` 的 `recommend()`：

1. `findReferences()` 用书名号和足够长的片名识别最多两部参考电影，不再用单字中文片名做子串匹配。
2. Jev 先判断 genre/mood。
3. `retrieve()` 从全库召回最多 **500 部**：硬过滤 + 语言/类型/片名结构信号 + 简介主题词 + 有结构约束时的评分人数加权。生产通过 CANDIDATE_LIMIT=500 指定上限。
4. 每批 20 部，最多 25 批并行交给 Jev 评分；得分 >=1.8，最多展示 12 部。每次最多 26 次 Jev API 调用。
5. 经典偏好只在明确提出且未否定时加权核实榜单作品。

瓶颈仍在：未进入 500 部候选的电影不会被 Jev 评估。扩大候选数不等于已证明推荐质量提升，需要看固定评估与用户反馈；单条实测输入 token 约增加 4.7 倍。开放心情句若简介没有对应词，合适片仍会漏掉。阈值不是校准后的喜欢概率。API 异常明确报错，不允许用规则结果冒充 Jev。

## 评估集与反馈

- `data/eval/cases.json`：18 条固定中文需求与人工相关 ID。
- `data/eval/baseline-retrieve.json` / `after-retrieve.json`：改动前后 24 部候选。
- `scripts/eval-retrieve.mjs` 可复跑离线对比。不要把模型分数当真值。
- 想看仍用 `cinema-saved`。看过/不合适在 `cinema-feedback`，只存在当前浏览器，前端会从本次推荐展示里隐藏，不上传、不训练模型。

## 代码导航

- `server/core.mjs`：过滤、召回、Jev payload、响应校验和推荐编排。
- `server/worker.mjs`：Cloudflare API、访问码、CORS、缓存与每日预算。缓存键含 catalog version 与 `RECALL_VERSION`。
- `server/catalog.mjs`：Worker 静态资源片库加载与共享 toWorkerMovie 投影。必须保留 originalTitle、language、rating、votes；此前生产分片遗漏这些字段使线上排序与本地不同，现已修复并加入一致性测试。
- `server/local.mjs`：本地 API，127.0.0.1:8793。
- `src/main.jsx`：界面、收藏、看过/不合适、设置、推荐卡片和详情。
- `public/data/movies.json`：完整片库。ID 不得随意改变。
- `tests/core.test.mjs`、`tests/catalog.test.mjs`、`tests/retrieve-eval.test.mjs`。

## 运行与发布

Node 22+。

```sh
npm run server
# 另一个终端
npm run dev
# 浏览器 http://127.0.0.1:5173
npm test
npm run build
```

`dev`、`build` 的前置脚本会重新生成片库资产；不要在 Worker 上传这些资产的同时运行它们。GitHub Pages：推送 main。Cloudflare：`npm run deploy:api`，推送不会自动发布 Worker。只改推荐逻辑时必须更新缓存策略版本。

## 本机凭据与预算

凭据已经配置，不要让用户重新在聊天里粘贴。以下仅为本机路径，不能把内容打印、提交、放入前端或 URL：

- Jev：`~/.config/typesafe/api-key.txt`，本地也支持 `TYPESAFE_API_KEY`。
- TMDB：`~/.config/tmdb/api-key.txt`。
- 网站访问码：`~/.config/tonight-cinema/access-code.txt`，不要擅自重置。
- Cloudflare 已配置 secrets `TYPESAFE_API_KEY`、`APP_ACCESS_TOKEN`。
- 所有访客共享每天 100 次新筛选（UTC），缓存命中不扣额度；一次筛选最多 26 次模型请求。24 小时缓存。

网站独立运行于 GitHub Pages + Cloudflare。片库目前手动更新。保留 TMDB 署名和既有来源链接。

## 本轮测速方式

`node scripts/benchmark-recommend.mjs --live` 默认会产生六次无缓存的付费推荐（3 条需求 × 24/100 两档）；500 部单条对照记录在 `data/eval/benchmark-500.json`。不自动重试。HTTP 请求不能覆盖 candidateLimit、batchSize 或 concurrency；这些参数仅供本地测速显式使用。
