# DECISIONS — Strategy B

## 2026-08-31 — TS 主栈

不以 AionCore 替换主后端；用契约对齐。

## 2026-08-31 — 单一 Fleet

无 solo/distributed 开关。

## 2026-08-31 — Multica 协议重写

不 vendor Multica 源码。

## 2026-08-31 — P0 包边界

- `fleet-protocol`：共享类型与常量（无实现副作用）。
- `fleet-daemon`：无头进程；`RuntimeRegistry.ensureLocal`、`DecisionGate`、hive task ledger、pty/control/HookServer、`ClaimService`。从 munder `control`/`taskLedger`/`hooks`/`ptyEnv` 行为抽出，不依赖 Electron。
- `fleet-gateway`：`identityMode: local | userSession`（对齐 Aion Local/WebUi），**不是**「127.0.0.1 免鉴权」。Session 存 SQLite；userSession cookie 客户端走 CSRF。
- `apps/shell-web` / `apps/shell-electron`：同一 gateway 的双壳接线（Web 鉴权 / Electron Local）。
- 禁止 `solo|distributed` 旗标；本地即 Fleet 单节点。

## 2026-08-31 — 抽出深度（诚实边界）

不全量 vendor `hive.ts`；以契约测试锁行为，增量抽出。对照见 `docs/COMPARISON.md`。
