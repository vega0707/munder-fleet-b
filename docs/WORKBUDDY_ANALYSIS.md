# WorkBuddy 调研 & Strategy B 对标建议

> 调研日期：2026-09-01  
> 姊妹仓对照：[`munder-fleet-a`](https://github.com/vega0707/munder-fleet-a) · [`munder-fleet-c`](https://github.com/vega0707/munder-fleet-c) · [`munder-fleet-d`](https://github.com/vega0707/munder-fleet-d)  
> 后续里程碑：[`ROADMAP.md`](./ROADMAP.md) § P4

## 一、WorkBuddy 是什么

WorkBuddy 是腾讯云 CodeBuddy 团队推出的 **桌面 AI Agent 工作台**（另有 Team / Enterprise 云端形态）。核心卖点不是「聊天问答」，而是：

**一句话下达目标 → 自主规划 → 多专家并行执行 → 交付可验收产物**（报告、PPT、表格、代码等）。

公开资料可将其能力拆为六层（产品逻辑架构，非内部实现细节）：

```
┌─────────────────────────────────────────────────────────────┐
│ ⑥ 治理：权限 · 沙箱 · 高风险确认 · SSO · Credit · 审计       │
├─────────────────────────────────────────────────────────────┤
│ ⑤ 交付：任务产物 · 文件变更 · 报告/表格/PPT · 分享同步       │
├─────────────────────────────────────────────────────────────┤
│ ④ 执行：本地文件 · Skills · MCP/CLI · 浏览器 · 第三方服务    │
├─────────────────────────────────────────────────────────────┤
│ ③ 编排：理解需求 · 拆解规划 · 模型/专家协作 · 结果检查       │
├─────────────────────────────────────────────────────────────┤
│ ② 上下文：Task · Workspace · Project · Memory                │
├─────────────────────────────────────────────────────────────┤
│ ① 入口：桌面输入 · 文件/截图 · IM 指令 · 定时自动化          │
└─────────────────────────────────────────────────────────────┘
```

参考：[WorkBuddy 官网](https://www.workbuddy.ai/) · [腾讯云产品概述](https://cloud.tencent.com/document/product/1831/134329) · [运行逻辑解读（博客园）](https://www.cnblogs.com/tgzhu/p/21629693)

### 核心概念

| WorkBuddy 概念 | 含义 | 典型用法 |
|----------------|------|----------|
| **Project** | 团队级上下文容器，不是单纯文件夹 | 预置全局指令、默认专家、Skill、连接器、资料标准；新建 Task 时自动注入 |
| **Task** | 一次 Agent 执行链 | 可迭代追问；状态：规划中 → 进行中 → 待处理 → 完成/失败 |
| **Expert（专家）** | 角色定位 + 方法论 + 工具链 | 如「行业研究专家」「PPT 设计专家」；官方宣称 100+ 预置 |
| **Expert Group（专家团）** | 单任务内多专家并行协作 | 团长拆任务，成员并行，再汇总交付 |
| **Skill** | 可复用流程包（`SKILL.md` + 脚本 + 模板 + 工具白名单） | 如「竞品分析 Skill」「数据分析 Skill」 |
| **Connector** | 外部系统桥（腾讯文档、邮箱、TAPD、知识库等） | Agent 能否「进你的业务系统」 |
| **Workspace** | 本次任务的文件边界 | 安全沙箱 + 输入/输出目录 |
| **Memory** | 跨 Task 的个人偏好 | 「汇报先结论后过程」「偏好企业风 PPT」 |

WorkBuddy Enterprise 还叠加：**CodeBuddy（编码）+ WorkBuddy（办公）+ Managed Agents（托管运行时 PaaS）** 三产品一体，含 Credit 计量、SSO、组织管理、OpenAPI。

---

## 二、WorkBuddy vs 本仓（Strategy B）概念对照

本仓 Fleet 语义见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。与 WorkBuddy 的对照：

| 本仓（B） | WorkBuddy | 相似度 | 差异 |
|-----------|-----------|--------|------|
| `Project` | Project | 高 | 本仓偏「看板/角色边界」；WorkBuddy 偏「团队标准 + 能力预置」 |
| `Task` + assignee | Task | 中 | 本仓：**真人角色 + CLI runtime 接活**；WorkBuddy：**内置 AI 专家接活** |
| `Role` | Expert | 中 | 本仓 Role 绑 owner + runtime；WorkBuddy Expert 是预置领域 Agent |
| `Michael` | 专家团团长 / Lead | 中 | Michael 收完成汇报；WorkBuddy 团长还负责 **单任务内并行拆分子任务** |
| `Runtime` + claim | Managed Agent / 执行运行时 | 中 | 本仓接 **Claude/Codex/Cursor CLI**；WorkBuddy 接内置 Skill + 本地工具 |
| `PendingDecision` 硬闸 | 高风险确认 / 权限控制 | 高 | 思路一致，都是 HITL 卡点 |
| （暂无） | Skill / SkillHub | 低 | WorkBuddy 护城河之一 |
| （暂无） | Connector 生态 | 低 | 腾讯文档/邮箱/IM 等深度集成 |
| （暂无） | 办公产物管线 | 低 | PDF/PPT/Excel 端到端生成 |
| （暂无） | Credit / 企业治理 | 低 | 组织级计量与管控 |
| Munder 办公楼壳 | Agent 工作台 UI | 中 | 本仓有独特可视化；WorkBuddy 偏任务/产物中心 |

**结论：概念上有重叠（Project / Task / 编排者 / 多 Agent），但产品重心不同。**

- **WorkBuddy**：办公知识工作 + 预置专家/Skill 生态 + 产物交付
- **本仓 Fleet B**：真实 coding CLI 的多机接活 + assignee 看板 + 硬闸协作

要到 WorkBuddy 那个水平，**不只是在 A/B/C/D 里选一个后端**，还要补一整层「Expert / Skill / Connector / 产物交付 / 企业治理」产品能力。

---

## 三、WorkBuddy 真正强的三件事（本仓最大缺口）

### 1. 专家 & Skill 生态（内容 + 编排）

- 100+ 预置 Expert，持续新增 Skill
- Expert Group 在 **单个复杂任务内** 并行分工（研究 / 图表 / 写报告 / 做 PPT / 格式校验）
- Skill 不是 prompt，而是 **流程 + 脚本 + 工具白名单 + 输出模板** 的复用包

### 2. Project 作为「团队标准注入器」

项目里配好一次，所有 Task 自动继承：输出格式、默认专家、默认 Skill、连接器、资料库。这是 WorkBuddy 企业版「超级团队」叙事的核心。

### 3. 执行闭环（不是建议，是交付）

本地文件读写、Office 多格式、沙箱、IM 遥控、产物区可检查迭代——Agent 在 **授权环境里干活并交卷**。

本仓 P0–P3 已做到 claim → subprocess 干活 → 回传 Michael；「干活」目前是 Fleet 语义演示级，离 WorkBuddy 的办公产物管线还有距离。

---

## 四、A/B/C/D 四条路线对照（以「逼近 WorkBuddy 水平」为标尺）

| 维度 | **A 激进** | **B 中等（本仓）** | **C 自研对齐** | **D Multica 主核** |
|------|------------|-------------------|----------------|-------------------|
| 主栈 | AionCore Rust fork | **Munder TS monorepo** | 纯 Munder 重写 | Multica Go |
| 产品壳 | 最小 shell | **完整 Munder 延续** | 完整 Munder 产品 | Munder 壳 + Multica 核 |
| 迭代 Expert/Skill UI | 慢（双栈 Rust+TS） | **最快（单 TS 栈）** | 慢（全自研） | 慢（Go+TS 异构） |
| 企业 auth/SSO/实时 | 最强（AionCore 原生） | 模块级移植 | 需自研 | Multica 有，偏 dev fleet |
| Team MCP / wake | Aion 原生，待 Rust 合入 | **已对齐 TeamWake→Michael** | 规格有 team-tools | 差距大，靠 adapter |
| 多机 claim | 协议重写（TS→Rust） | 协议重写（TS daemon） | 规格自研 | 开箱 Multica |
| 办公楼/Command Center | 最小壳 | **完整 refs Munder** | 完整产品 | shell 过渡 |
| 商用 SaaS | 可行（Multica 不 vendor） | 可行 | 可行 | **许可红线** |
| 路线自述风险 | Rust 双栈人力 | **中等；最可能成为主产品路径** | 最慢 | 许可 + 非办公向 |

### 各路线对 WorkBuddy 能力的「天然匹配度」

| WorkBuddy 能力块 | 最合适路线 | 原因 |
|------------------|------------|------|
| Expert Center / SkillHub 产品层 | **B** | 单 TS 栈 + 完整 Munder UI，迭代 Expert/Skill 市场最快 |
| Project 上下文注入 | **B 或 C** | 已有 Project/Task 模型；B 更快落地 UI |
| 专家团单任务内并行 | **B + 扩 Michael** | 编排逻辑放 TS daemon 最顺；与 Aion Team 概念可融合 |
| 桌面 Agent + 本地文件 | **B / C** | Electron 完整产品已在 Munder 线 |
| 企业 SSO / 审计 / OpenAPI | **A**（或 B 模块化借 A） | AionCore fork 自带 auth/realtime |
| IM 远程遥控 | **B** | TS gateway 扩展 Slack/TG 比 Rust fork 改 UI 快 |
| 多机接活 / runtime 注册 | **D**（但不必选 D 做主路线） | claim 语义四条线都已对齐，D 优势可被 B 吸收 |
| 100+ 办公 Expert 内容 | **无路线自带** | 纯内容与产品投入，与 A/B/C/D 无关 |
| Managed Agents PaaS | **四条线均非目标** | 不做公有云代跑 agent 算力 |

---

## 五、结论：主选 B，模块化借 A，不选 D 做主核

### 为何 B 是本仓主路径（对标 WorkBuddy 时）

1. **WorkBuddy 的竞争点是产品体验 + Expert/Skill 生态**，不是选 Rust 还是 Go 当后端。B 的「Munder TS 主栈 + 行为对齐 Aion/Multica」最适合快速叠产品层。
2. 本仓自述 **「最可能成为主产品路径」**，且已有 Gateway / DecisionGate / TeamWake / Claim / Blocker 全套 TS 契约；离「Project 预置 Expert+Skill」只差产品层，不是架构推倒重来。
3. WorkBuddy 的 Expert Group ≈ **Michael + 多 Role 并行 claim** 的上层封装；在 B 里扩展 Michael 编排器，比 A 等 Rust overlay 合入后再做 UI 快得多。
4. 完整 Munder 办公楼 / Command Center / assignee 看板，是 WorkBuddy 没有的差异化；B 能保留这条线，同时向 WorkBuddy 的 Expert/Skill/Project 配置中心演进。

### 从 A 借什么（不必整仓 A 为主）

- JWT / CSRF / refresh、Web 鉴权合同
- Team MCP wake 全链路（本仓 COMPARISON 已对齐 TeamWake→Michael，可继续深化）
- 企业级 realtime / session；后期 SSO 审计可模块化引入

**不建议以 A 为主路线追 WorkBuddy**：双栈（Rust Core + TS Fleet + 最小 shell）会把 Expert Center、Skill 安装、Project 配置 UI 的迭代速度拖慢。

### C 何时考虑

- 当 B 的「vendor/重写 Aion 模块」债务过高、协议需要一次做对时
- 长期最干净，但 **到 WorkBuddy 水平最慢**；适合长期架构洁癖，不适合「尽快到那个产品水位」

### D 为何不推荐做主路线

- Multica 强项是 **dev agent fleet 接活**，不是 WorkBuddy 式办公 Expert/Skill/文档交付
- License Part I 限制对外 SaaS/嵌入式商业分发
- 与 WorkBuddy 的「100+ 办公专家 + 腾讯文档生态」方向错位

D 的价值：**多机 claim 语义参考**——四条线已在协议层吸收，无需把 Multica 升为主核。

---

## 六、对标 WorkBuddy：B 之上还要补的产品清单（→ P4）

无论后端选型，下面是 WorkBuddy 水位、且 **当前 Fleet 四仓都未覆盖** 的能力。本仓落地建议见 [`ROADMAP.md`](./ROADMAP.md) § P4。

| 优先级 | 能力 | 说明 | 本仓模块建议 |
|--------|------|------|----------------|
| P0 | **Expert 模型** | 从 Role 扩展：角色定位 + 方法论 + 默认 Skill/Connector | `packages/fleet-protocol` 类型扩展 + `shell-web` |
| P0 | **Skill 包格式** | 参考 `SKILL.md` + 脚本 + 工具白名单；Project 级预置 | `packages/fleet-daemon` skill loader |
| P1 | **Expert Group 编排** | Michael 单任务内拆子任务 → 多 Role/Expert 并行 → 汇总交付 | `fleet-daemon` orchestrator 扩展 |
| P1 | **Project 配置中心** | 全局指令、默认 Expert/Skill、连接器、资料库一键注入 Task | `fleet-gateway` + `shell-web` |
| P2 | **Connector 层** | MCP + 邮箱/文档/IM | `packages/fleet-gateway` channels |
| P2 | **产物交付区** | Task 产物版本化、可检查、可迭代（不只 stdout 回传） | `shell-web` + daemon artifact store |
| P3 | **Memory** | 跨 Task 个人偏好（与 Project 团队标准分离） | `fleet-daemon` memory |
| P3 | **企业治理** | Credit、SSO、审计——可模块化从 Aion 借 | `fleet-gateway` enterprise |

**硬约束（继承 AGENTS.md）：**

- 单一 Fleet 协议；禁止 `solo|distributed` 双模式
- 表现层品牌 **Munder**；不把默认 UI 换成 AionUi
- Multica 默认协议重写，不 vendor 源码做对外 SaaS

---

## 七、一句话摘要

| 问题 | 答案 |
|------|------|
| WorkBuddy 强在哪？ | **Expert/Skill 生态 + Project 团队标准 + 端到端产物交付 + 企业治理** |
| 我们和它最像什么？ | Project / Task / Michael / 硬闸 / 多 runtime——**骨架相似，Skill/Connector/办公交付差很多** |
| 要到它那个水平选谁？ | **主选 B（本仓）**；企业后端 **从 A 模块化借**；**不要选 D 做主核** |
| 选 B 就够了吗？ | **不够**。B 解决「用什么架构最快长出 WorkBuddy 式产品层」；Expert 市场、Skill 内容、Connector、产物管线仍需单独建设（P4） |
