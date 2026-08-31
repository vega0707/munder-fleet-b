# 行为验收清单 — P0（Aion / Multica 对齐）

契约测试位置：`packages/*/test/*contract*.test.ts`。禁止「看起来像」。

## Gateway / session（对齐 Aion WebUi + Local）

- [x] 有效密码登录 → 返回 access token + 建立 session
- [x] Bearer 或 session cookie 可鉴权普通 API
- [x] 错误密码 → 401；不泄露用户是否存在
- [x] Local 身份模式（Electron）：无需 JWT/CSRF；固定 `system_default_user`
- [x] **不是**「凡 127.0.0.1 即可匿名访问」fleet API
- [x] userSession 下未认证受保护路由 → 401
- [x] Logout 使既有 token 失效

## PendingDecision 硬闸（对齐 Aion Confirmation §4.6）

- [x] 有 pending → `state=waiting_confirmation`，`canSendMessage=false`
- [x] pending 期间 send/midturn → Busy/409；不投递
- [x] confirm 清除 pending 并解除闸门
- [x] 未知 callId confirm → 错误
- [x] cancelAll 取消全部 pending

## Runtime.ensureLocal（对齐 Multica register）

- [x] daemon 启动调用 `ensureLocal` → 注册本地 runtime，owner=本地用户
- [x] heartbeat 刷新 `lastSeenAt`；超 freshness 不可 claim
- [x] `runtime_gone` → prune + 可再 ensureLocal
- [x] shutdown deregister → offline
- [x] **无** `solo|distributed` 模式旗标

## Task assignee（对齐 Munder hive）

- [x] status 变更不清除 `assignee`
- [x] 部分 patch 保留未提及字段（merge 语义）

## Hook / PTY 抽出（对齐 Munder main）

- [x] PreToolUse + ControlRegistry → `permissionDecision: deny`
- [x] halt → `continue: false`
- [x] steer → `additionalContext` 一次消费
- [x] `require_decision` → PendingDecision 硬闸
- [x] `buildPtyEnv` 剥离父会话 CLAUDE_* 身份
- [x] HiveRoot 保证 `hive/tasks.json` + hooks.sock 路径

## Claim（对齐 Multica freshness）

- [x] 新鲜 runtime 可 claim；超 150s → stale
- [x] 跨 runtime 重复 claim → conflict
- [x] 同 runtime 幂等

## Shell 接线

- [x] Web：`apps/shell-web` → gateway `/login`（userSession）
- [x] Electron：`ElectronFleetClient.assertLocalIdentity`（Local）

上游对照表：[`docs/COMPARISON.md`](./COMPARISON.md)
