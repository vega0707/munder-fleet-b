# OPS — 观测与运行（P3）

## 进程

```bash
./scripts/bootstrap.sh
npm install
npm run daemon -- --listen 127.0.0.1:3920 --hive ~/.fleet-b
npm run gateway -- --mode userSession --listen 127.0.0.1:25808 --daemon http://127.0.0.1:3920
# Electron / 本机壳：
npm run gateway -- --mode local --listen 127.0.0.1:25808 --daemon http://127.0.0.1:3920
npm run web   # http://127.0.0.1:5173
```

## 观测

- `GET /metrics`（daemon）— 计数器 + 最近事件（`daemon.start` / `claim` / `team.complete`）
- `GET /health` — daemon / gateway 存活
- 无 `solo|distributed` 旗标；本地即单节点 Fleet

## 从 A/C 吸收的教训

| 来源 | 教训 | 本仓做法 |
|------|------|----------|
| A（Rust 主栈） | 双栈人力成本高 | 坚持 TS；Aion 仅行为契约 |
| C（只设计） | 无实现则无法验收 | 每个对齐项强制契约测试 |
| Aion Local vs IP | 勿把 loopback 当鉴权 | `identityMode` |
| Multica 许可 | 勿 vendor Go 服务 | 协议重写于 `packages/` |
| Multica headless 自动批准 | 交互壳需要硬闸 | DecisionGate ≠ 自动批准 |

## 穿透检查清单

见 [`ACCEPTANCE.md`](./ACCEPTANCE.md) 与 [`COMPARISON.md`](./COMPARISON.md)。
