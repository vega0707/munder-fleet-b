# ROADMAP — Strategy B

## P0
- [x] 抽出 `fleet-daemon` 无头进程（行为 ≈ 现 Electron main 的 hive/pty）
- [x] `fleet-gateway`：密码/令牌 session + Local 身份免鉴权（非 IP 旁路）
- [x] PendingDecision 硬闸
- [x] Runtime.ensureLocal()

## P1
- [x] TeamWake + 完成回传 Michael（对齐 Aion internals 时序）
- [x] Web：看板（assignee）+ 待定列表 + 角色注册 UI

## P2
- [x] 多机 runtime + claim（手动/自动 `AutoClaimLoop`）
- [x] Blocker → owner
- [x] 契约测试对拍 Multica 生命周期

## P3
- [x] 穿透文档、观测、从 A/C 策略吸收教训（`docs/OPS.md` + `/metrics` + CI）
