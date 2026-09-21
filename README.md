# 今夜放映 · Tonight Cinema

用一句观影需求寻找电影或剧集。React + Vite 前端部署到 GitHub Pages；Jev 仅从服务端调用。

## 本地运行

Node 22+。先 `npm ci`，再分别运行 `npm run server` 和 `npm run dev`，打开 http://127.0.0.1:5173。

本地服务读取 `~/.config/typesafe/api-key.txt`，或环境变量 `TYPESAFE_API_KEY`。密钥不进入前端。

## 内容库

正式内容库来自 TMDB，覆盖多个原始语言，按热度并结合多语言、不同年代获取，再经过口碑门槛和资料完整度筛选。当前 9,574 部，其中 7,197 部电影、2,374 部剧集；这是精选覆盖，不是全球全量库。

`npm run import:tmdb` 从 `~/.config/tmdb/api-key.txt`（Read Access Token 或 v3 API key）导入多语言电影资料，默认目标 50,000 部。可通过 `CATALOG_TARGET` 调整。扩容保留已有条目和电影 ID，支持磁盘缓存断点续跑，发现页缓存一天；网络暂时失败时有限重试，未达到目标不覆盖现有片库。导入结束重启本地 API；线上需要重新部署 Worker 和前端。不要提交 `.cache` 或 API 密钥。

`npm run import:series` 从 TMDB 的 `discover/tv` 导入高质量剧集，默认收集约 2,400 个评分候选，再写入有海报和简介的剧集记录。门槛为 TMDB 评分至少 7.5、评分数至少 100；记录带有 `mediaType: "series"`、单集时长、季数和集数。电影记录使用 `mediaType: "movie"`，两类内容在筛选器、卡片和详情中明确区分。可通过 `SERIES_TARGET` 调整导入规模。

推荐链路：Jev 判断需求类型 → 程序用中文语义扩展、简介主题、内容类型、语言/类型/片名结构信号和质量加权从全库召回最多 1000 部 → 每批 20 部、最多 50 批并行交给 Jev 独立评分 → 只展示得分达到阈值的最多 12 部。用户写“电影”时只召回电影，写“剧集、电视剧、美剧、动画剧”等时只召回剧集；没有明确类型时两者都可进入候选。未知片长不会通过片长限制，剧集的片长指单集时长。明确片名优先召回；「像某片」会排除参考片本身。固定评估需求与改动前后对比在 `data/eval/`。

已知边界：候选召回仍是启发式混合检索，不是向量检索，仍可能漏片；偏好判断取决于简介证据，不能保证情节细节；中文语义需持续人工评估。想看复用原有收藏；看过与不合适只存在当前浏览器，不会上传，也不表示模型已学习。当前仍采用内存检索，后续规模继续增加时可迁移到数据库索引。浏览器只加载内容卡片索引，简介与演员按点击加载；Worker 通过静态资源分片加载用于 Jev 选片的完整资料，避免把整库打进 JavaScript 包。

## 经典与高口碑补充

`npm run import:quality` 保留已有电影，补入两类有记录依据的作品，不按固定数量凑满：

- BFI Sight and Sound 2022 影评人榜单（并列名次展开为 263 部）及 AFI 百年百佳 2007 版。片名和年份匹配，同名片及别名通过人工核对导演处理；映射依据保存在 `data/curation/match-overrides.json`。现覆盖 BFI 262 部、AFI 100 部，合并去重 318 部。BFI 的《电影史》在 TMDB 按 TV series 206647 收录，未用单集冒充完整作品。
- 不限语言、地区，按年代补充 TMDB 评分至少 7.0、1970 年前至少 50 票、1970 年起至少 200 票、发行至少跨过两个自然年份的电影。本轮截止 2024 年。评分是观众口碑筛选依据，不等于影史地位。

本轮新增 2,296 部，其中 54 部带有上述榜单收录依据。已有 20,000 个 ID 全部保留。详情页展示榜单来源链接；明确提出经典偏好时，召回阶段适当提升已核实榜单作品，Jev 仍根据需求和简介判断匹配。来源制作年份与 TMDB 公映年份可能不同。

榜单来源：[BFI](https://www.bfi.org.uk/sight-and-sound/greatest-films-all-time)、[AFI](https://www.afi.com/afis-100-years-100-movies-10th-anniversary-edition/)。本地核对清单及导入报告在 `data/curation/`，不复制榜单的影评文字。

## 豆瓣高分与质量门槛

`npm run import:douban-quality` 从豆瓣公开电影分类页收集评分超过 7.5 的条目，并用豆瓣公开 subject 接口和 TMDB 片名、原名、年份做实体匹配；能确认是 TMDB 内容实体的条目全部保留并写入 `doubanRating`、豆瓣来源和分类标签。公开分类范围本轮得到 1,807 个高分条目，匹配或补入 1,565 个，最终目录含 1,569 个去重后的豆瓣高分内容；报告在 `data/curation/douban-quality-report.json`。

其余 TMDB 电影和剧集必须达到评分至少 7.0 且有至少 100 个评分，已有 BFI/AFI 认领记录继续保留。没有可靠 TMDB 内容实体的公开豆瓣条目不会用空资料硬加入，因此这份结果不能宣称覆盖豆瓣全站所有评分超过 7.5 的条目；公开检索范围、未匹配数和失败数均写入报告。页面会在卡片和详情中显示豆瓣评分。

## 部署

1. `npm test && npm run build`
2. GitHub Pages 选择 GitHub Actions；`.github/workflows/pages.yml` 推送 main 后自动部署，支持项目子路径。
3. Cloudflare：`npx wrangler login`，`npm run deploy:api`（自动生成片库分片再部署）。
4. 用 `npx wrangler secret put TYPESAFE_API_KEY` 配置 Jev 密钥；`npx wrangler secret put APP_ACCESS_TOKEN` 配置随机网站访问码。不得放入仓库。
5. 将 `public/config.json` 的 `apiBase` 设为 Worker HTTPS 地址，然后重新发布前端。
6. 页面右上角连接设置输入网站访问码（不是 Jev key）。访问码只保存在当前浏览器标签会话。

Worker 必须验证访问码；CORS 不代替认证。Durable Object 保证共享上限 100 次新筛选/UTC 日；缓存命中不计额度。每次筛选最多 51 次 Jev 请求（1 次意图判断 + 50 批内容评分），不自动重试。服务错误明确展示，绝不伪造 AI 推荐。日志默认关闭，避免记录用户需求。

## 验证

`npm test` 检查片长约束、中文年代、召回、1000 个候选全量评分、并发限制、生产分片与本地召回一致性、AI 响应校验及错误处理。真实 Jev 和浏览器验证记录见 `VERIFICATION.md`。

## 数据与版权

代码 MIT。开发初期启动数据由 [prust/wikipedia-movie-data](https://github.com/prust/wikipedia-movie-data) 整理（项目 MIT），文字来自 Wikipedia，按 CC BY-SA 保留来源和相同方式共享；每个条目附原文链接。归一化处理包括字段重组、去重、类型名称归一化及少量中文片名补充。原始文字与图片不因仓库许可证而改为 MIT。海报权利归各自权利人。

正式片库已切换 TMDB；网页展示官方署名及标志，TMDB 数据按其 API 条款使用。本站不提供电影正片播放或下载。

## 候选数量速度对照

`node scripts/benchmark-recommend.mjs --live` 默认运行三条固定需求的 24/100 部对照；可用 `BENCHMARK_LIMITS=500,1000 BENCHMARK_OUTPUT=data/eval/benchmark-1000.json` 重测当前生产上限。每批 20 部、并发 5；记录 token 用量、请求数和每批耗时，任一失败即停止，不自动重试；此命令会产生 Jev 调用费用。小样本用于实际速度观察，不代表稳定延迟保证或推荐质量普遍提升。

`npm run import:expansion` 补充 TMDB 至少 7 分、至少 30 票、截至上一个完整自然年发行的全球电影。必须有海报和非空简介，保留全部已有 ID 与榜单标记；不为凑数降低门槛。导入报告在 `data/curation/expansion-report.json`。评价人数较少的作品口碑证据较弱，不等于公认经典。

本轮先补充 23,748 部电影，再补入 2,374 部高质量剧集；当前共 9,574 部内容，覆盖电影与剧集的多个原始语言。实际速度与证据边界见 [SPEED_REPORT.md](SPEED_REPORT.md)。
