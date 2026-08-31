# COMPARISON — Strategy B vs 上游（做完后对照）

对照基准：`refs/`（`scripts/bootstrap.sh`）· 本仓实现：`packages/*` + `apps/*`。

## 总览

| 能力 | Munder (difflin) | AionCore | Multica | **本仓 B** |
|------|------------------|----------|---------|-----------|
| 主栈 | Electron TS | Rust + WebUi | Go server + CLI | **TS monorepo** |
| 无头 daemon | 嵌在 Electron main | aionui-app 内嵌 | `multica daemon` | **`fleet-daemon`** |
| 鉴权 | 本机信任 | Local / WebUi JWT+CSRF | PAT/cookie/daemon token | **Local / userSession + CSRF** |
| Pending 硬闸 | ControlRegistry + HITL | Confirmation §4.6 | 常自动批准（headless） | **`DecisionGate`（对齐 Aion）** |
| Runtime 注册 | registry + seat hub | — | register + heartbeat 15s | **`RuntimeRegistry.ensureLocal`** |
| Claim | SeatHub claim | — | claim + freshness 150s | **`ClaimService`（150s）** |
| Hive/PTY | 完整 HiveManager+PtyManager | — | ACP runtime | **子集抽出 + HookServer** |
| Shell | Electron UI | WebUi | Web app | **shell-electron client + shell-web** |

---

## 1. fleet-gateway ↔ Aion auth

| 契约 | Aion | 本仓 | 状态 |
|------|------|------|------|
| Local 固定 `system_default_user`、无 JWT/CSRF | ✅ | ✅ `identityMode:'local'` | **对齐** |
| WebUi 密码登录 → session cookie + token | ✅ | ✅ `fleet-session` + `flt_` | **对齐** |
| Bearer 或 cookie | ✅ | ✅ | **对齐** |
| CSRF double-submit（cookie 客户端） | ✅ | ✅ `fleet-csrf-token` + `x-csrf-token`；Bearer 豁免 | **对齐（简化）** |
| Refresh JWT 路径隔离 | ✅ | ❌ 无 refresh | **缺口** |
| `session_generation` 吊销 | ✅ | ✅ bump + mismatch 拒识 | **对齐** |
| OAuth 白名单 | 可选 | ❌ | **缺口（P0 原 README 可选）** |
| 「127.0.0.1 免鉴权」 | ❌（按进程身份） | ❌（按 `identityMode`） | **对齐（刻意不做 IP 旁路）** |

## 2. DecisionGate ↔ Aion Confirmation

| 契约 | Aion | 本仓 | 状态 |
|------|------|------|------|
| pending → `waiting_confirmation` / `canSendMessage=false` | ✅ | ✅ | **对齐** |
| midturn/send → 409 Busy | ✅ | ✅ `BusyError` | **对齐** |
| confirm / 未知 callId | ✅ | ✅ | **对齐** |
| duplicate callId 替换 | ✅ | ✅ | **对齐** |
| Team MCP 自动批准 | ✅ | ❌（P1 TeamWake） | **未做** |
| ACP permission_router 全量 | ✅ | Hook `require_decision` 子集 | **部分** |

## 3. Runtime / Claim ↔ Multica

| 契约 | Multica | 本仓 | 状态 |
|------|---------|------|------|
| daemon boot 注册 runtimes | ✅ | ✅ `ensureLocal` | **对齐** |
| owner = 本地用户 | ✅ | ✅ `LOCAL_DEFAULT_USER` | **对齐** |
| heartbeat freshness ≤150s 才可 claim | ✅ | ✅ | **对齐** |
| `runtime_gone` prune + 再注册 | ✅ | ✅ | **对齐** |
| deregister → offline | ✅ | ✅ | **对齐** |
| HTTP/WS 对服务端 `POST /api/daemon/register` | ✅ | 本地内存 registry（无远端 Multica server） | **语义对齐、协议自研** |
| 多 workspace 批量注册 | ✅ | 单节点 | **刻意缩小（单 Fleet）** |
| 自动 poll/claim 循环 | ✅ | API `ClaimService` 手动 | **部分（P2 多机）** |

## 4. hive / pty / hooks ↔ Munder

| 模块 | Munder | 本仓 | 状态 |
|------|--------|------|------|
| `ControlRegistry` | ✅ | ✅ 抽出 | **对齐** |
| `taskLedger` merge / assignee | ✅ | ✅ | **对齐** |
| `buildPtyEnv` 剥离 CLAUDE_* | ✅ | ✅ | **对齐** |
| `HookServer` UDS + PreToolUse deny / halt / steer | ✅ | ✅ 无 Electron 版 | **对齐（子集）** |
| Hook ↔ DecisionGate | 无同名类型 | ✅ `require_decision` | **B 增强** |
| `HiveManager` 邮件路由 / ensureAgent / god roster | ✅ ~3700 LOC | `HiveRoot` 布局 + tasks | **未全量** |
| `PtyManager` + node-pty | ✅ | `PtyManager` + Fake / 可选 node-pty | **接口齐、默认 Fake** |
| HookHub 多项目 | ✅ | 单 `HookServer`/daemon | **部分** |
| WorkerWake / SeatHub 全量 | ✅ | Claim 语义替代 seat 子集 | **部分** |

## 5. Shell 接线（HANDOFF §5）

| 路径 | 期望 | 本仓 | 状态 |
|------|------|------|------|
| Electron → gateway Local | 无密码 | `apps/shell-electron` `ElectronFleetClient` | **接线契约齐**；完整 Munder UI 仍在 refs |
| Web → gateway userSession | 登录 UI | `apps/shell-web` | **最小鉴权页** |
| 同一 gateway 双身份 | ARCHITECTURE 图 | 同一包 `--mode local\|userSession` | **对齐** |

---

## 仍未声称完成（明确边界）

1. **整份** `hive.ts` / 邮件路由器 / god roster 注入 — 需后续增量抽出，不是「看起来像」。
2. 真机 **node-pty** 依赖未默认安装（原生编译）；`preferNodePty` 有则用。
3. Aion **TeamWake / Michael 回传** — ROADMAP **P1**。
4. Multica **多机自动 claim 循环** — ROADMAP **P2**。
5. GitHub Actions CI — 仓库仍无 workflow。

## 验证命令

```bash
./scripts/bootstrap.sh
npm install && npm test
npm run test -w @munder/shell-web
npm run test -w @munder/shell-electron
```
