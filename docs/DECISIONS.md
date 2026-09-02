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

## 2026-09-01 — WorkBuddy 对标 & 主路径确认

- 外部对标：腾讯云 WorkBuddy（Expert / Skill / Project 容器 / 产物交付 / 企业治理）。调研见 `docs/WORKBUDDY_ANALYSIS.md`。
- **Strategy B 仍为产品主路径**：单 TS 栈最适合叠 Expert/Skill/Project 配置等产品层；Fleet P0–P3 语义面已落地，缺口在 P4 产品层而非换后端。
- 模块化借 A：企业 auth/SSO/realtime/Team MCP 可从 Aion 移植，不 fork 整仓 AionCore 作主后端。
- 不以 D（Multica 主核）追 WorkBuddy：Multica 偏 dev fleet 接活 + 许可限制 SaaS；claim 语义已协议对齐，无需升主核。
- P4 里程碑写入 `docs/ROADMAP.md`；仍遵守单一 Fleet 协议、Munder 品牌、Multica 不 vendor。

## 2026-09-02 — Plan 额度调度（per-plan，无全仓默认）

- 每个 coding plan 独立配置在 `hive/plans.json`；**无 fleet 级默认额度规则**。
- `limits` 全可选：不配 proactive 规则时，仅依赖 CLI 被动 rate-limit（`POST /quota/rate-limit`）。
- `QuotaScheduler` 冷却到期后自动 `AutoClaim` 积压任务；多 plan 时按剩余 headroom 选 runtime。
- PTY / Hook 输出自动 `parseRateLimitSignal`；`autoTune.enabled` 的 plan 从观测动态改写 `limits`（写入 `plan-tune-observations.json`）。
