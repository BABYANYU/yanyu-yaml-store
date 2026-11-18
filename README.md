> Based on [pastebin-worker](https://github.com/SharzyL/pastebin-worker) by Sharzy L (MIT). Original copyright retained in LICENSE.

# Yanyu YAML Store

基于 Cloudflare Workers 与 KV 的文本、YAML 和文件分享服务，维护站点为 **[fakeyou.eu.org](https://fakeyou.eu.org/)**。

- 维护仓库：[BABYANYU/yanyu-yaml-store](https://github.com/BABYANYU/yanyu-yaml-store)
- 问题反馈：[Issues](https://github.com/BABYANYU/yanyu-yaml-store/issues)
- 项目维护者：**BABYANYU**。
- GitHub 仓库状态已核实为 `isFork=false`；本次维护没有执行 detach 操作。

**状态（2026-11-16）：新仓库已独立发布成功，原 Cloudflare 数据保留。** 213项测试通过，发布前后原PB绑定及生产变量不变，1081条key元数据清单无原有未过期条目缺失。新仓库已配置独立发布Secrets，Actions仅手动触发。当前操作以[新仓库发布交接记录](documentation/REPOSITORY-CUTOVER-2026-11-16.md)为准；旧[维护手册](documentation/MAINTENANCE-2026-11-16.md)保留当时审查说明。

## 功能与用法

支持网页上传、更新、删除、过期时间、自定义短路径、语法高亮、Markdown 展示、URL 跳转和响应 MIME 类型。YAML Store 是项目名称，上传内容不会因此自动通过 YAML 语义校验。

网页入口：[https://fakeyou.eu.org/](https://fakeyou.eu.org/)。HTTP 接口沿用上游形态；[API 参考](doc/api.md)已同步本轮本地契约，示例不代表生产已部署或已完成验收，具体行为以对应版本的测试及维护记录为准。命令行辅助工具见 [scripts](scripts/README.md)。

以下示例仅操作本地模拟器：

```sh
npm run dev
# 在另一个终端上传文件；Windows PowerShell 使用 curl.exe
curl -F 'c=@config.yaml' -F 'n=my-config' http://localhost:8787/
curl http://localhost:8787/~my-config
```

上传响应中的 `url` 用于读取，`admin` 是包含修改/删除凭据的管理 URL，应单独保管。`p` 模式仅生成较长随机名称，并不是读取鉴权或加密；知道读取 URL 的人仍可访问内容。

## 本地安装、测试与构建

使用满足当前锁定 Wrangler/Vitest 依赖要求的 Node.js（Node.js 24 或更高版本，与 package.json 的 engines 要求一致），以及 npm。以仓库中的锁文件安装，不在维护验证中自动更新依赖：

```sh
git clone https://github.com/BABYANYU/yanyu-yaml-store.git
cd yanyu-yaml-store
npm ci
npm test -- --run
npm run build
```

`npm test -- --run` 显式请求单次测试；当前维护脚本中的 `npm test` 也已统一为非 watch。`npm run build` 调用 Wrangler 的 `deploy --dry-run --outdir=dist`，生成本地产物，不发布 Worker。可另运行 `npm run coverage` 查看覆盖率。记录 Node/npm 版本、源代码 SHA、完整测试结果、构建输出及产物 SHA-256；任一步失败就保留旧版本。

### 运行环境的硬要求

- **Node.js ≥ 24**：`package.json` 的 `engines` 已声明 `"node": ">=24.0.0"`（`packageManager` 为 `npm@11.19.1`），与上面的安装说明一致，无需改动。低于该版本时 `vitest 4.1.12`、`wrangler 4.163.0` 及锁文件中的依赖不保证可安装或可运行。
- **完整可用的 workerd 环境**：`vite.config.js` 通过 `@cloudflare/vitest-plugin` 的 `cloudflareTest({ wrangler: { configPath: "./wrangler.toml" } })` 注册 Workers 测试池，`test/*.spec.js` 会在真实 workerd 中加载 Worker 与本地 KV 绑定。跑通整套 vitest 的前提是：
  1. `npm ci` 完整成功（workerd 二进制随安装步骤获取，通常需要能访问 npm 与 Cloudflare 的下载源）；
  2. 宿主平台在 workerd 支持范围内（常见 linux/darwin x64/arm64）；
  3. 有可用的临时目录、进程启动权限和足够内存。
- 在离线、精简容器、模拟 CPU（QEMU/仿真）或不受支持的架构上，`npm test` 会在启动阶段失败；这属于环境缺失，不是用例失败，不能据此判断代码回归。区分方法见下节的纯逻辑测试。
- **本仓库本次仅修改文档与 CI，没有在本地执行 vitest 套件，也不以此宣称测试通过。** 文中提到的测试数量是历史记录，不是本轮本地运行结果；发布验证仍需在满足上述条件的机器上重新执行并留证。

### 最小纯逻辑测试（不需要 workerd）

环境不满足 workerd 要求时，可先跑一个不依赖 workerd 的最小纯逻辑测试，确认前端脚本的纯逻辑分支未被改坏：

```sh
node --test test/frontend-interactions.node.mjs
```

该文件用 `node:vm` 加一个极小的 jQuery/DOM 适配层，在纯 Node 中执行真实的 `frontend/index.client.js`（8 个用例，约 1 秒完成，不联网、不启动 workerd、不生成 Worker 绑定）。它**不能替代** vitest 套件：不覆盖浏览器布局、原生事件冒泡、剪贴板权限与可访问性树，也不能验证 Worker 端逻辑。它通过只表示“前端脚本的纯逻辑分支未回归”。

两个工作流都先执行这一步再跑完整 vitest 套件（`.github/workflows/pr.yml`、`.github/workflows/deploy.yml`），这样 workerd 环境异常时会以“纯逻辑测试已通过、vitest 启动失败”的形态暴露出来，便于区分环境问题与代码问题。

## 部署配置

仓库中的 [wrangler.toml](wrangler.toml) 是模板，**不得直接以 placeholder 配置部署生产**。部署前将模板复制到仓库外的受控配置文件，核对以下字段：

| 字段 | 部署前替换或核对 |
|---|---|
| `name` | 已有生产 Worker 的真实名称；不要用项目显示名称推断它 |
| `routes[].pattern` | 主站实际绑定域名 `fakeyou.eu.org`，核对 `custom_domain` 与账户配置 |
| `kv_namespaces[].binding` | 保持 `PB` |
| `kv_namespaces[].id` | 将 `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` 替换为经核实的生产 namespace ID |
| `vars.BASE_URL` | `https://fakeyou.eu.org`，与主站路由一致 |
| `vars.REPO` | `https://github.com/BABYANYU/yanyu-yaml-store` |
| `vars.TOS_MAINTAINER` / `vars.TOS_MAIL` | 实际维护者及有效联系方式，替换 `Your Name` / `you@example.com` |
| `vars.FAVICON` | 维护者选定的图标 URL，或留空 |

本地、预发布和生产必须使用不同 KV namespace。配置副本应位于原项目外但保留相同路径深度，或将 `main`、文本模块匹配路径改成正确的项目路径；先用该配置 dry-run 验证引用。登录、发布、KV 导入及回滚均是单独的生产操作，本次维护没有执行。生产 KV 备份/恢复、旧版本回退和发布验收步骤见 [运行手册](documentation/MAINTENANCE-2026-11-16.md)。

## 访问控制与已知边界

可选 `BASIC_AUTH` 对静态页面与新建 POST 请求设置 HTTP Basic Auth。它不是已存在粘贴的读取权限控制；更新和删除依靠管理 URL 内的凭据。当前实现读取对象形式的 `env.BASIC_AUTH`，配置应匹配该形态，不应直接将 JSON 字符串当对象使用。真实密码不要写入公开仓库。

- **不可信粘贴同源风险**：MIME 自定义、HTML/SVG、Markdown 和高亮输出可能让用户内容在站点上下文中展示。当前本地修复包含响应 sandbox、输出处理和缓存控制，但不能据此宣称所有渲染路径已获得独立源隔离，也不能宣称生产已生效。长期方案是将原始内容放在无管理凭据的独立内容域，并为每种展示路径验证 CSP、引用策略与第三方资源。
- **KV 最终一致性尚未解决**：写入、更新、删除与过期在不同边缘位置可能存在传播延迟。HTTP `no-store` 不能将 KV 变为强一致存储。
- **get-then-put 竞争尚未解决**：先查名称再写入不是原子操作；并发自定义名称、随机名称碰撞和并发更新仍可能覆盖。需要 Durable Objects 或其他串行化/条件写入设计，不能用增加随机长度代替原子性保证。
- 存储、请求和每日读写配额以当前 [Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)及 [KV 限制](https://developers.cloudflare.com/kv/platform/limits/)为准；KV 上限不等于应用上传上限，应用限制以源码与测试为准。

## 维护边界

这里只维护主站及 `BABYANYU/yanyu-yaml-store`。[rule.fakeyou.eu.org](https://rule.fakeyou.eu.org/) 仅作为流程参考，规则仓不在修改范围。可借鉴 YanyuRule 2026-11-15 审计中的“测试 + SHA 证据 + 生产验收 + 失败保留旧版本”；用户提供的最近 4 次同步成功记录属于规则站，不能当作本项目的发布证明。
