# 今夜放映 · Tonight Cinema

用一句观影需求寻找电影。React + Vite 前端部署到 GitHub Pages；Jev 仅从服务端调用。

## 本地运行

Node 22+。先 `npm ci`，再分别运行 `npm run server` 和 `npm run dev`，打开 http://127.0.0.1:5173。

本地服务读取 `~/.config/typesafe/api-key.txt`，或环境变量 `TYPESAFE_API_KEY`。密钥不进入前端。

## 电影库

正式片库来自 TMDB，覆盖多个原始语言，按热度及语言分层获取，优先收录票数至少 50、有海报和简介的电影。当前 5,000 部，覆盖 21 种原始语言，4669 部有中文简介。这是精选覆盖，不是全球全量库。

`npm run import:tmdb` 从 `~/.config/tmdb/api-key.txt`（Read Access Token 或 v3 API key）导入多语言电影资料，默认目标 5,000 部。可通过 `CATALOG_TARGET` 调整。支持磁盘缓存断点续跑；失败不覆盖现有片库。导入结束重启本地 API；线上需要重新部署 Worker 和前端。不要提交 `.cache` 或 API 密钥。

推荐链路：Jev 判断需求类型 → 程序用关键词与主题召回 24 部 → 3 批 Jev 独立评分 → 只展示得分达到阈值的最多 12 部。阈值是产品起始值，不代表经校准的喜欢概率。没有足够证据时允许空结果。未知片长不会通过片长限制。

已知边界：候选召回采用启发式词表，仍可能漏片；偏好判断取决于简介证据，不能保证情节细节；中文语义需持续人工评估。没有全文搜索引擎或向量数据库，未来扩到数万部应迁移检索到数据库索引。当前精选片库在浏览器中加载，海报按需加载；未宣称已实现百万片库。

## 部署

1. `npm test && npm run build`
2. GitHub Pages 选择 GitHub Actions；`.github/workflows/pages.yml` 推送 main 后自动部署，支持项目子路径。
3. Cloudflare：`npx wrangler login`，`npx wrangler deploy`。
4. 用 `npx wrangler secret put TYPESAFE_API_KEY` 配置 Jev 密钥；`npx wrangler secret put APP_ACCESS_TOKEN` 配置随机网站访问码。不得放入仓库。
5. 将 `public/config.json` 的 `apiBase` 设为 Worker HTTPS 地址，然后重新发布前端。
6. 页面右上角连接设置输入网站访问码（不是 Jev key）。访问码只保存在当前浏览器标签会话。

Worker 必须验证访问码；CORS 不代替认证。Durable Object 保证共享上限 100 次新筛选/UTC 日；缓存命中不计额度。每次筛选最多 4 次 Jev 请求，不自动重试。服务错误明确展示，绝不伪造 AI 推荐。日志默认关闭，避免记录用户需求。

## 验证

`npm test` 检查片长约束、中文年代、召回、AI 响应校验及错误处理。真实 Jev 和浏览器验证记录见 `VERIFICATION.md`。

## 数据与版权

代码 MIT。开发初期启动数据由 [prust/wikipedia-movie-data](https://github.com/prust/wikipedia-movie-data) 整理（项目 MIT），文字来自 Wikipedia，按 CC BY-SA 保留来源和相同方式共享；每个条目附原文链接。归一化处理包括字段重组、去重、类型名称归一化及少量中文片名补充。原始文字与图片不因仓库许可证而改为 MIT。海报权利归各自权利人。

正式片库已切换 TMDB；网页展示官方署名及标志，TMDB 数据按其 API 条款使用。本站不提供电影正片播放或下载。
