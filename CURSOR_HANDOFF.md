# Cursor 交接：今夜放映

交接日期：2026-09-21。本文不包含密钥。先阅读本文件、README.md 和 VERIFICATION.md，再按本次用户指令继续；不要重建项目。

## 用户目标与当前边界

这是用 Jev 根据自然语言需求选电影的网站。用户希望全球电影库持续扩充，优先经典佳作，不要擅自限定成华语片库。保持现有中文界面与访问码体验。

当前任务是交接；下一阶段建议是改善召回质量，并加最简单的推荐反馈。该建议尚未实施。让用户在 Cursor 中明确启动下一阶段即可，不需要重复询问已经明确的需求。不要顺带开发正片播放或更换 Jev。

## 现状与交付

- 本机项目：`/Users/sean/Downloads/tonight-cinema`
- 仓库：https://github.com/Emanon4/tonight-cinema ，分支 `main`
- 网站：https://emanon4.github.io/tonight-cinema/
- API：https://tonight-cinema-api.moji-pet.workers.dev
- 功能提交 `adcc0e4`；上线验收记录提交 `5ce3b38`。本交接文件为后续文档提交。
- 22,296 部电影、58 种原始语言；旧有 20,000 个 ID 全保留，本轮新增 2,296 部。54 部新增来自核实的经典榜单，其余是按评分与评价人数筛选，不能统称公认经典。
- BFI Sight and Sound 2022 覆盖 262/263（含并列名次）；《电影史》在 TMDB 为电视剧，未用章节冒充。AFI 2007 百年百佳 100/100。两榜去重为 318 部。
- Worker catalog version `cebabfc710102ef7`；部署版本 `525861b4-8654-48df-882c-218ff2d5c9ee`。
- 交接时远端 main 与本机一致，工作区无未提交业务改动；API health 实测 ready=true、engine=jev、catalogCount=22296。
- 12 项测试、生产构建通过。GitHub Pages 工作流 35537809175 成功。线上真实查询“想看《绿光》，关于孤独、假期里寻找陪伴的影史佳作”返回新电影《绿光》，详情中文简介及 BFI 来源正常。详细证据在 VERIFICATION.md。

## 必须理解的推荐链路

`server/core.mjs` 的 `recommend()`：

1. 从查询中识别最多两部参考电影，附其简介给 Jev。
2. Jev 先判断 genre/mood；并非全程只有规则在理解需求。
3. `retrieve()` 用关键词、主题和过滤规则，从全库召回 **24 部**。注意该函数默认 limit=32，但生产调用显式传24。
4. 每批8部，3批并行交给 Jev 评分；得分 >=1.8，最多展示12部。每次最多4次 Jev API 调用（含意图识别）。
5. 经典/影史偏好对有核实榜单依据的电影加权；普通需求及简单的排除经典表达不加权。

瓶颈：未进入24部候选的电影不会被 Jev 评估。不能声称每次 Jev 读遍两万部，也不要只把24改成更大数字就宣布质量改善。当前阈值不是校准后的“喜欢概率”。API异常明确报错，不允许用规则结果冒充 Jev。

## 下一阶段建议与验收标准

优先改善召回，保留 Jev 最终判断。先建立约15—20条中文评估需求，涵盖心情与否定限制（“孤独但不悲伤”）、参考电影相似推荐、明确片名、经典偏好、年代与片长。人工选择并核实一小组相关电影作为参考，不把模型自己的评分当真值。保存当前候选结果作为基线，再改动检索策略。

可先做无需新增收费服务的混合检索改进；如确需 embedding 服务，应说明新增费用和运行依赖，不假定现有 Jev 密钥能用于其他 API。不要将整库在每次请求中发给模型。

交付时需要：

- 同一组需求的改动前后候选对比，说明漏召回改善及仍存在的失败案例；经典、冷门片和非英语片不能被热门程度长期压住。
- 硬过滤仍成立，未知片长不能通过片长限制；“像某片”应排除参考片本身。
- 费用、候选数和真实等待时间有记录。少量真实 Jev 端到端测试即可，禁止自动反复重试收费调用。
- 最简单的反馈可先存在 localStorage：想看可复用现有收藏，另加不合适/看过，避免重复按钮；如只存本机，明确它不会自动汇总到站长，也不意味着模型已学习。
- 测试与构建通过后验证实际浏览器结果。最终报告区分离线检索改进、真实 Jev 行为与未完成项。

多轮“再轻松一点”是后续方向，不必与本轮捆绑成大改造。保持全球选片定位，暂不继续为了数量扩库。

## 代码导航

- `server/core.mjs`：过滤、召回、Jev payload、响应校验和推荐编排。
- `server/worker.mjs`：Cloudflare API、访问码、CORS、缓存与每日预算。
- `server/catalog.mjs`：Worker 静态资源片库加载；每批4个分片，校验版本/总数/唯一ID，失败重置缓存。
- `server/local.mjs`：本地 API，127.0.0.1:8793。
- `src/main.jsx`：React界面、收藏、设置、推荐卡片和详情。样式文件在同目录。
- `scripts/prepare-catalog.mjs`：由完整片库生成浏览器索引/详情分片及 Worker 分片，更新部署配置的版本与数量。
- `public/data/movies.json`：完整片库源文件。ID不得随意改变，否则收藏与映射失效。
- `scripts/import-quality.mjs`、`scripts/tmdb-client.mjs`：佳作扩充与 TMDB 缓存读取。
- `data/curation/`：官方榜单条目、人工匹配覆盖及导入报告。
- `tests/core.test.mjs`、`tests/catalog.test.mjs`：现有自动化测试。
- `.github/workflows/pages.yml`：main 推送触发测试、构建及 Pages 发布。

## 运行与发布

Node22+。依赖已安装；换机器先 `npm ci`。

```sh
npm run server
# 另一个终端
npm run dev
# 浏览器 http://127.0.0.1:5173
npm test
npm run build
```

`dev`、`build` 的前置脚本会重新生成片库资产；不要在 Worker 上传这些资产的同时运行它们。已有本地进程可能仍在运行，先检查端口再决定重启。

GitHub Pages：提交推送 main，检查 Actions 成功并验证正式页面。Cloudflare 后端需要单独 `npm run deploy:api`，GitHub 推送不会自动发布 Worker。若改了片库，应协调两端部署，验证一致性。生成目录 public/data/catalog、.cache、dist 不提交；CI会重新生成前端片库资产。

如果只改变推荐逻辑而片库不变，要更新推荐缓存的策略版本/键，避免上线后继续命中24小时的旧算法结果；检查 worker.mjs 当前缓存键构造再修改。

上线验收至少包括 API `/api/health`、真实推荐请求、浏览器打开电影详情。失败先定位，不无限重试付费模型。更新 VERIFICATION.md 记录真实证据。

## 本机凭据与预算

凭据已经配置，不要让用户重新在聊天里粘贴。以下仅为本机路径，不能把内容打印、提交、放入前端或URL：

- Jev：`~/.config/typesafe/api-key.txt`，本地也支持 `TYPESAFE_API_KEY`。
- TMDB：`~/.config/tmdb/api-key.txt`。
- 网站访问码：`~/.config/tonight-cinema/access-code.txt`，不要擅自重置。
- Cloudflare 已配置 secrets `TYPESAFE_API_KEY`、`APP_ACCESS_TOKEN`。`gh`、Wrangler 本机此前已登录，使用前可只读检查，不输出认证凭据。
- Jev 接口 `https://api.typesafe.ai/v1/systemone`，现有 payload 实现以 core.mjs 为准。可按需阅读本机 `~/.agents/skills/typesafe-ai/SKILL.md`，不要假设 Cursor 自动加载 Codex 的技能。
- 所有访客共享每天100次新筛选（UTC），缓存命中不扣额度；一次筛选最多4次模型请求。24小时缓存。默认不记录用户原始查询日志。

网站独立运行于 GitHub Pages + Cloudflare，关闭电脑不会停站；模型余额/密钥有效性仍需维护。片库目前手动更新，没有自动定时任务。保留 TMDB 署名和既有来源链接。
