# 今夜放映 · Tonight Cinema

用一句观影需求寻找电影或剧集。React + Vite 前端部署在 GitHub Pages，推荐 API 是 Cloudflare Worker；Jev 只从服务端调用。

- 网站：https://emanon4.github.io/tonight-cinema/
- API：https://tonight-cinema-api.moji-pet.workers.dev
- 历史变更见 [CHANGELOG.md](CHANGELOG.md)，验收记录见 [VERIFICATION.md](VERIFICATION.md)。

## 内容库

当前共 9,453 部：电影 7,200 部、剧集 2,253 部，覆盖 57 种原始语言。资料来自 TMDB，是经过口碑门槛筛选的精选库，不是全球全量库。

入库门槛（满足其一）：

- 豆瓣评分高于 7.5（1,569 部带豆瓣评分）；
- 收录于 BFI Sight and Sound 2022 或 AFI 百年百佳 2007（共 318 部，映射依据见 `data/curation/match-overrides.json`）；
- TMDB 评分至少 7.0 且至少 100 个评分（剧集要求 7.5）。

脱口秀、新闻、真人秀和肥皂剧类剧集，除非有豆瓣或榜单背书，否则不收录（清理记录见 `data/curation/genre-cleanup-report.json`）。仍有 707 部缺片长、641 部只有英文简介，可由补全脚本修复。

## 推荐链路

1. **意图识别（1 次 Jev 调用）**：判断题材和氛围，同时识别用户明确要避开的题材，以及是否要避开悲伤、暴力或恐怖内容。
2. **混合召回**：硬条件（类型、年代、片长、电影/剧集）过滤后，把关键词、结构信号（语言、题材、片名、经典偏好、质量加权）与 bge-m3 多语言向量相似度相加排序。
   - 有向量时召回 500 部，否则召回 1000 部。
   - 固定评估集上，人工标注相关作品的召回结果：混合召回 500 部命中 87/101；纯关键词 500 部命中 84，1000 部命中 91（见 `data/eval/hybrid-recall.json`）。
   - 另有 20 条 Jev 标注的银标准需求（`data/eval/cases-silver.json`，待人工复核）：混合召回 500 部命中 269/277，纯关键词 1000 部只命中 147。
3. **分批评分**：每批 20 部、并发 10，交给 Jev 打分。给 Jev 的证据包括中文与英文简介、TMDB 关键词、宣传语、导演、主演、类型、年代、语言、片长和榜单。
   - 用户明确要避开悲伤、暴力或恐怖内容时，每部再问一个是/否问题，Jev 判断概率 ≥ 0.85 才排除。
   - 批次失败不超过 10% 时，仍返回结果并标注为"部分结果"，且不写入缓存；超过 10% 则整次失败。
   - 遇到 429/529 会退避重试一次。
4. **整体挑选**：达到阈值 1.8 的前 30 部放进同一次 Jev 调用，用一个选择题问"哪一部最符合"，Jev 给出的概率作为加分，再加一点口碑权重；同时让 Jev 判断每部作品"主要契合哪个方面"。最多展示 12 部。
   - 人工标注评估（`data/eval/ranking-ab-tuned.json`）：前 12 部命中从 34 提升到 40（共 101 部），输入 token 约为原来的 1.44 倍，调用次数不变。
5. **推荐理由**：显示 Jev 判断的契合方面，再加上程序可核对的依据（语言、题材、简介关键词、片长、年代、榜单、豆瓣分）。
6. **备选结果**：第一轮评分达到阈值但没进前 12 的作品，最多再返回 36 部。前端的"换一批"在这些备选里翻页，不会再调用 Jev。

有向量时，每次未命中缓存的搜索需要 27 次 Jev 调用（1 次意图 + 25 批评分 + 1 次重排，不含重试）；没有向量时最多 52 次。

已知边界：

- 评估集的标注来自早期关键词召回的候选，对语义召回并不完全公平。
- 偏好判断只依据简介，不能保证情节细节。
- 阈值不是校准过的"喜欢概率"。

## Worker 与限额

- 每次请求都要验证网站访问码，比较时用摘要做常量时间比较；CORS 不代替认证。
- 所有访客共享每天 100 次新筛选（按 UTC 日计）。另外每位访客每小时最多 10 次。
  - 访客按 IP 加盐哈希识别，只保留当前这一小时的计数。
  - 筛选失败会退还额度；缓存命中不扣额度。
- 缓存键由片库版本、召回版本（`RECALL_VERSION`）、规范化后的需求、白名单内的筛选值和个性化参数组成，缓存 24 小时。
- **相似需求复用**：同时满足以下两个条件时，直接返回之前的缓存结果，不扣额度：
  - 新需求与最近 300 次需求之一的向量相似度 ≥ 0.93；
  - 两者的结构指纹（语言、否定、片名、年代、片长、题材、主题词）以及筛选条件完全一致。

  实测同义改写的相似度在 0.93～0.997，换国家、换参考片或加否定的都低于 0.90。这里只保存向量和缓存键，不保存需求原文。个性化请求不参与复用。
- **运行指标**：`GET /api/stats`（需要访问码）返回最近 14 天的按日汇总：新搜索、缓存命中、相似复用、失败、部分结果、个性化次数、总耗时、Jev 调用数、token 数。不记录需求原文。
- 请求头带 `Accept: application/x-ndjson` 时，Worker 会逐行返回进度（意图识别、x/y 批、重排），最后一行是结果或错误。
- 日志默认关闭。服务出错时明确展示错误，绝不伪造推荐。

## 前端

- 视觉：深色"夜色毛玻璃"风格，参考 CineJoy 的布局语言。
  - 背景是当前首位作品的海报大幅模糊后形成的环境光，会随结果变化。
  - 搜索框、筛选、"再调一下"和底部悬浮导航都用毛玻璃胶囊；海报大圆角，是页面的视觉主体。
  - 收藏按钮是片名右侧的小书签图标，不压在海报上。
  - 详情页整屏铺海报，中文片名居中，下面是"留给下一晚"、看过、不合适和"在哪看"。
- 修改筛选条件时，先在已有结果里本地筛选，不会再调用 Jev；只有点"按新条件重新选片"才重新搜索。
- 搜索需求和筛选条件写进 URL，可以分享；浏览器后退可回到上一次搜索，同一会话内重复搜索直接用本地缓存。
- 访问码默认记在本设备，可改为只在当前标签页有效。返回 401 时会自动打开设置框。
- 每次出结果后可以"再调一下"：点"更轻松一点""近几年的""换成剧集"等选项，或写一句补充，会把补充内容接在原需求后面重新搜索。
- "让我的片单参与选片"默认关闭，在连接设置里开启。开启后，请求会附带想看、看过、不合适的作品编号：
  - 看过和不合适的直接从候选里排除；
  - 想看和看过的生成口味向量，在召回时给相近的作品加分；
  - 服务端不保存这些编号。

  不开启时，想看、看过、不合适都只保存在当前浏览器，不会上传。
- 详情页的"在哪看"链接到 TMDB 的观看渠道页（数据来自 JustWatch）。
- 代码结构：`src/App.jsx` 加 `src/components/`（卡片、详情、筛选、设置、关于）和 `src/lib/`（接口、URL 状态、结果筛选、存储）。

## 本地运行

Node 22+。先运行 `npm ci`，再分别运行 `npm run server` 和 `npm run dev`，然后打开 http://127.0.0.1:5173。

- 本地服务读取 `~/.config/typesafe/api-key.txt` 或环境变量 `TYPESAFE_API_KEY`，密钥不会进入前端。
- 存在 `data/embeddings/` 且能拿到 Cloudflare 凭据（`npx wrangler login`，或 `CLOUDFLARE_API_TOKEN` 加 `CLOUDFLARE_ACCOUNT_ID`）时，本地也会启用语义召回。

## 数据脚本

| 命令 | 作用 |
|---|---|
| `npm run import:recent` | 导入最近 18 个月（可用 `RECENT_MONTHS` 调整）达到门槛的新电影和剧集，不删除、不改写已有 ID |
| `npm run backfill:details` | 从 TMDB 补全缺失的片长（剧集取单集时长）和中文简介 |
| `npm run embeddings` | 用 Workers AI `@cf/baai/bge-m3` 生成向量，只重新计算变化的条目 |
| `npm run catalog:curate` | 执行剧集类型清理规则 |
| `npm run eval` / `node scripts/eval-hybrid.mjs` | 离线召回评估（人工标注的金标准和 Jev 标注的银标准分开统计） |
| `node scripts/build-silver-eval.mjs --live` | 重新生成银标准评估集（约 80 次 Jev 调用） |
| `npm run import:tmdb` / `import:quality` / `import:expansion` / `import:series` | 早期的扩库脚本 |

TMDB 凭据从环境变量 `TMDB_API_KEY` 或 `~/.config/tmdb/api-key.txt` 读取。不要提交 `.cache` 或任何密钥。

`import:douban-quality` 默认停用：它请求的 `/j/` 接口被 movie.douban.com 的 robots.txt 禁止。已有的豆瓣评分继续展示；重新抓取前需要先评估条款，再用 `--accept-douban-terms` 显式运行，并会按 Crawl-delay 每次间隔 5 秒。

### 每月自动更新片库

`.github/workflows/catalog-refresh.yml` 在每月 1 日运行：导入新片、补全资料、刷新向量、跑测试和构建，然后开 PR。需要先配置以下仓库 secret：

- `TMDB_API_KEY`（必需）；
- `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`（可选，用于刷新向量；令牌需要 Workers AI 权限）；
- 仓库设置里要开启 “Allow GitHub Actions to create and approve pull requests”。

PR 合并后会自动发布前端；Worker 仍需手动运行 `npm run deploy:api`。

## 部署

1. 运行 `npm test && npm run build`。
2. 推送到 `main` 后，`.github/workflows/pages.yml` 自动部署 GitHub Pages。
3. Worker：运行 `npm run deploy:api`，它会先生成片库分片和向量资源，再部署。Worker 绑定了 Workers AI（`AI`），用于计算查询向量。
4. secrets：
   - `npx wrangler secret put TYPESAFE_API_KEY`
   - `npx wrangler secret put APP_ACCESS_TOKEN`
   - 两者都不得放进仓库。
5. 只改了推荐逻辑时，必须升级 `RECALL_VERSION`，避免命中旧缓存。

## 测试

`npm test` 共 45 项，覆盖：

- 召回与过滤：硬条件、否定识别、年代、电影与剧集分开、语义融合、离线评估的回归门槛、生产分片与本地召回一致。
- Jev 调用：1000 部候选全部评分、重排、部分失败、重试、AI 响应校验。
- Worker：访问码、Origin、缓存、退还额度、访客限额、每日限额、流式返回。
- 前端：URL 状态、本地筛选、NDJSON 解析、服务端渲染冒烟测试。

## 数据与版权

代码使用 MIT 许可证。电影与剧集资料、海报来自 TMDB，网页展示官方署名及标志，按 TMDB API 条款使用。榜单来源为 [BFI](https://www.bfi.org.uk/sight-and-sound/greatest-films-all-time) 和 [AFI](https://www.afi.com/afis-100-years-100-movies-10th-anniversary-edition/)，不复制影评文字。早期启动数据的来源与 CC BY-SA 声明见 `public/data/UPSTREAM-LICENSE.txt`。本站不提供正片播放或下载。
