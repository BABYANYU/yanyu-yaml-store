# 新仓库独立发布交接 — 2026-11-16

## 本次结果

- 唯一维护仓库：BABYANYU/yanyu-yaml-store。
- 生产域名：https://fakeyou.eu.org/。
- 继续使用原 Worker `pb`、原 `PB` KV namespace，没有新建或切换存储。
- 发布源码：`65f3802add4e50f9d6724a200d33995bbddc4fb4`。
- GitHub Actions：[43877271712](https://github.com/BABYANYU/yanyu-yaml-store/actions/runs/43877271712)，成功。
- 213/213 测试通过，production dry-run通过。
- 正式版本：`e8170c5b-4679-4d80-9cc7-5598b1afb976`。
- 发布前列出1081条KV元数据，发布后仍为1081条，无原有未过期条目缺失；PB namespace及生产变量指纹一致。
- 验收只GET首页与Cloudflare只读元数据，没有创建、写入、导入、恢复或删除任何生产paste正文。清单一致不等于逐字节值一致，KV有最终一致性和并发用户写入限制。

## 发布能力

新仓库已配置CF_API_TOKEN、CF_ACCOUNT_ID、KV_NAMESPACE_ID三个GitHub加密Secrets。令牌限定目标账户、目标zone，只有Workers代码发布/路由编辑与KV只读等必要权限，没有KV写入权限；Cloudflare账户权限模型仍允许目标账户内的Workers脚本编辑，并非单脚本级绝对隔离，需保护仓库写入权限。

工作流仅手动运行（Actions → Deploy → Run workflow），推送代码不会自动改线上。发布前测试在无生产凭据环境运行，之后只读检查现有绑定，移除模板vars并用`wrangler deploy --keep-vars`保留原生产配置。原workers.dev与preview设置通过发布前读取后保持，不在本轮擅自调整。

旧仓库BABYANYU/pastebin-worker的Deploy仍为disabled_manually。新仓库发布不依赖旧仓库，原仓库是否删除另行确认；删除GitHub仓库不应同时删除Cloudflare的pb或PB。

## 日常维护

1. 修改新仓库并检查测试；不要在仓库写入令牌。
2. Actions手动运行Deploy，确认测试、生产保护、发布与发布后保护步骤均成功。
3. 出现PB绑定或原条目检查失败必须停止调查，不自动恢复/删数据。不要改KV_NAMESPACE_ID来绕过保护。
4. `scripts/production-guard.mjs`只读检查绑定及key元数据；运行器上的临时清单仅用于同一次运行比较，不上传artifact，不是业务内容备份。
5. 历史RELEASE及MAINTENANCE的“未配置Secrets/尚未上线”描述为当时状态，当前以本文及对应Actions实际结果为准。
