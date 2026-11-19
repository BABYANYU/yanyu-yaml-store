# Yanyu YAML Store

Yanyu YAML Store 是轻量文本与文件分享服务，支持通过网页或 HTTP API 上传、读取、更新和删除内容。服务运行在 Cloudflare Workers 上，使用 KV 存储；上传时保留原始内容，YAML 语义需自行校验。

**在线网页入口：** [fakeyou.eu.org](https://fakeyou.eu.org/)

## 功能

- 网页粘贴文本或上传文件，并生成读取链接。
- 设置有效期、自定义名称或较长的随机名称；可管理已有内容。
- 按需通过文件扩展名或 MIME 类型提供内容，支持语法高亮、Markdown 展示及 URL 跳转。
- 使用 [HTTP API 指南](doc/api.md) 通过 `POST`、`GET`、`PUT` 和 `DELETE` 管理内容。命令行脚本见 [scripts 使用说明](scripts/README.md)。

## 快速使用

在网页打开服务，粘贴文本或选择文件，按需设置有效期与链接方式，然后生成链接。管理已有内容时，使用管理链接更新或删除。

也可使用 `curl` 上传并读取：

```sh
# 终端一：启动本地 Worker
npm run dev

# 终端二：上传并读取本地内容
curl.exe -F 'c=@config.yaml' -F 'n=my-config' http://localhost:8787/
curl.exe http://localhost:8787/~my-config
```

API 上传的表单字段包括：`c`（内容，必需）、`e`（有效期）、`s`（管理密码）、`n`（自定义名称）和 `p`（较长随机名称模式）。响应包含 `url`、`suggestUrl`、`admin`、`expire` 和 `isPrivate`；其中 `url` 是读取链接，`admin` 是包含管理密码的管理链接。完整参数、响应字段和调用示例见 [API 指南](doc/api.md)。

## 安全与存储边界

- **管理链接是 bearer credential。** `admin` URL 内含可用于更新或删除内容的管理密码；持有该链接即可使用对应管理能力，请像密码一样保管，切勿作为公开读取链接分享。
- **读取链接本身不要求登录。** `p` 只生成更长的随机名称，不是访问控制、认证或加密。任何获得读取 URL 的人都能读取内容。
- **HTML、SVG 与 sandbox 的范围不同。** 未使用 `lang` 的原始读取响应带 `Content-Security-Policy: sandbox`，由浏览器限制该响应中的活动内容及其源权限；这不会清洗或改写存储的原始字节。`?lang=...` 高亮页和 `/a/<name>` Markdown 页是生成的 HTML，当前没有此 sandbox 响应头，也不应视为独立来源隔离。请勿把这些展示方式当作承载敏感内容的隔离环境。
- **KV 是最终一致性存储。** 新建、更新、删除和过期状态传播到不同边缘位置可能有延迟；成功响应或 `Cache-Control: no-store` 都不代表各地立即一致。名称的检查与写入也不是原子操作，并发创建或更新可能发生竞争。

## 本地开发

需要 Node.js 24 或更高版本及 npm。安装依赖后可运行本地 Worker、测试或生成 dry-run 构建产物：

```sh
npm ci
npm run dev
npm test
npm run build
```

`npm run dev` 默认在 `http://localhost:8787` 提供本地服务；`npm run build` 使用 Wrangler dry-run，不会发布 Worker。`npm test` 运行 Vitest 测试。

## 项目链接

- [API 使用指南](doc/api.md)
- [命令行脚本说明](scripts/README.md)
- [MIT 许可](LICENSE)
- [GitHub 仓库](https://github.com/BABYANYU/yanyu-yaml-store)
- [问题反馈](https://github.com/BABYANYU/yanyu-yaml-store/issues)
