# COMPARISON — Strategy B vs 上游（收尾对照）

对照基准：`refs/`（`scripts/bootstrap.sh`）· 本仓：`packages/*` + `apps/*`。

## 总览

| 能力 | Munder | AionCore | Multica | **本仓 B** |
|------|--------|----------|---------|-----------|
| 主栈 | Electron TS | Rust + WebUi | Go + CLI | **TS monorepo** |
| Daemon | Electron main | 内嵌 | `multica daemon` | **`fleet-daemon`** |
| 鉴权 | 本机信任 | Local/WebUi JWT+CSRF+refresh | PAT/cookie | **Local/userSession+CSRF+refresh** |
| 硬闸 | Control+HITL | Confirmation | 常自动批准 | **`DecisionGate`** |
| Team wake | workerWake | try_wake/mark_idle | — | **`TeamWakeScheduler` → Michael** |
| Runtime/claim | SeatHub | — | register+claim 150s | **ensureLocal + Claim + AutoClaimLoop** |
| Blocker | humanQA | blocked_by | agent_blocked | **`BlockerService` → owner** |
| Hive mail | HiveManager | mailbox | — | **`HiveMailRouter`** |
| Shell | Electron UI | WebUi | Web | **shell-web 看板 + Electron Local client** |
| 观测 | telemetry | — | logs | **`/metrics` + `docs/OPS.md` + CI** |

## 对齐状态（摘要）

| 契约域 | 状态 |
|--------|------|
| Gateway Local / session / CSRF / refresh 隔离 | **对齐** |
| DecisionGate 409 硬闸 | **对齐** |
| TeamWake → Michael idle_notification | **对齐** |
| Runtime freshness 150s + auto claim 跳过 human/blocker | **对齐** |
| Blocker → owner resolve | **对齐** |
| HookServer PreToolUse/halt/steer + mail routeOnce | **对齐（子集）** |
| 全量 HiveManager/god roster/Windows shim | **未全量**（有意增量） |
| OAuth 白名单 | **未做**（可选） |
| Multica 远端 server 协议字节兼容 | **不做**（许可+重写） |

## 仍非目标

- Vendor Multica Go / Aion Rust 进 `packages/`
- `solo|distributed` 双模式
- 像素级复刻 Munder Pixi 办公楼（仍在 refs）
