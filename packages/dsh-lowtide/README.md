# dsh-lowtide

lowtide 是 DeepSeek Harness (dsh) 的一个插件。它解决的问题其实很自然：

通常，用户想让 Agent 干活的时候，就得坐在电脑前向它发送指令，等待回复，然后人工审核。但这种工作方式似乎忘了：用户日常有大把的空闲时间，也有避开某些模型峰谷定价的机会。

用户在白天想到什么活儿（适合进行峰谷运行的任务），可以随手扔进队列，审一眼放行；它攒到用户设定的时间（比如晚上七点以后——那会儿 DeepSeek 是低谷价）自动开跑；第二天早上用户可以打开报告，查收晚上的具体成果。

“时间就是金钱，效率就是生命”……

几个关键能力：

- **四种执行策略**：单次、迭代、采样、复核，从“一遍过”到“跑五份用户来挑”
- **168 项单元测试 + 10 个端到端 spec**
- **桌面端和网页端用的是同一份构建产物**，装一次两端通用
- **闲时自动落在 DeepSeek 低谷价时段**，同样一批任务，成本大约是高峰的一半
- **各种自定义模块**，满足用户的高灵活性任务的日常需求

## 四种执行方式

| 方式 | 说明 | 费用 |
|---|---|---|
| **单次** | 一次完成，等价于普通 harness 提示词+任务 | 单次 |
| **智能迭代** | 同一会话按轮执行：每轮先做**结构化维度审查**（按任务类型自动选择审查维度，输出问题清单 JSON），再**逐条修复**；无高危问题或修复无明显变化即提前结束。生成 1 轮 + 每轮审查+修复 | 约 1 + (N-1)×2 次调用 |
| **采样** | N 个独立会话（2–5 可选）各跑一遍同一指令，闲时只**生成** N 份候选结果；之后由**你**挑选最满意的一份（机器不做自动择优） | 约 N 倍 |
| **复核** | 执行一份结果后，再开一个独立会话以挑剔眼光复核，附审查意见 | 约 2 倍 |

- 新建工单时选择执行方式与轮数；迭代/采样/复核旁有 ⓘ 悬停说明。
- 新建工单时可选**运行模式**（L1 逐条确认 / L2 批次确认 / L3 全自动，按钮组，默认跟随设置页的全局自治级别、可逐任务覆盖）；每个按钮都有悬停一句话 + 选中后的详细效果说明。任务统一按「标准开发」权限档执行（投递 UI 不再暴露权限档选择）。
- 智能迭代的审查历史（每轮评分与问题清单）写入任务详情与执行报告的「审查意见」。
- 采样任务的候选在任务详情与执行报告中并列呈现（含每份花费），可点击「选这份」记录你的选择。
- 报告明示「迭代 3 轮 / 采样 3 份 / 已复核 · 实花 ¥X」。

## 峰谷定价与时间语义

**DeepSeek 的峰谷定价是什么**：DeepSeek 对 API 实行峰谷分时定价（[模型与价格](https://api-docs.deepseek.com/quick_start/pricing)，[更新日志](https://api-docs.deepseek.com/updates)）：**工作日** 09:00–12:00、14:00–18:00（北京时间）为高峰时段，其余时间为非高峰时段；**周末（周六、周日）全天为非高峰**。非高峰价格恰为高峰价的一半。

**2026-09-10 的官方变化（本版已对齐）**：DeepSeek-V4.1-Flash 上线并**下调 Flash 价**，模型名改为 `deepseek-flash`；旧名 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 仍可调用，但请求被路由到 V4.1-Flash 并**按 Flash 价计费**。**V4 Pro 于北京时间 2026-09-14 12:00 起下线**，此后的请求同样路由到 V4.1-Flash 并按 Flash 价计费。插件把旧名登记为**别名**、把 V4 Pro 的下线登记为**按日期生效的计费路由**，因此旧任务、旧模型目录都能继续正确计费，界面上会给出提示。

**术语映射**：官方公告里的「高峰 / 非高峰」就是本插件的「忙时 / 闲时」。

**时间语义（三种时间，请分清）**：

| 时间 | 判定时区 | 说明 |
|---|---|---|
| 官方忙时段（默认） | **北京时间**（`Asia/Shanghai`） | 计费正确性要求：DeepSeek 按北京时间收费，插件的省/花账目必须与官方一致，因此未配置自定义窗口时永远按北京时间判定 |
| 你自定义的忙时/闲时窗口 | **你的本地时间** | 设置页里填的起止时间一律按你机器的本地时区判定（含跨零点窗口） |
| 闲时运行窗口（批处理） | **你的本地时间** | 未填时区则跟随系统本地时区 |

**看官方时段在你本地长什么样**：设置页的「官方定价说明」卡片会显示你当前的系统时区，并把官方忙时段换算成你的本地钟点（跨时区可能出现"前一天/后一天、跨零点"的形态）；点「一键采用官方忙时（换算到我的时区）」可直接把换算结果填入自定义窗口。若 DeepSeek 将来调整时段或价目，在设置页修改窗口或价目表覆盖即可，无需改代码。

## 能力（当前已实现）

| 界面 | 槽位 | 说明 |
|---|---|---|
| ① 价格状态胶囊 | `conversation.session.header.utilities` | 状态点 + 闲时/忙时/执行中（本地时钟推导，推送中断也不冻结）· 队列数（价格明细移入悬停提示）；**点击即可编辑闲时/忙时时段**（本地时间 · 多段 · 实时色带预览） |
| ② 忙时拦截卡 | `conversation.composer`（chain 槽） | 忙时输入时接管 composer：现在就跑 vs 投递闲时队列，草稿保留 |
| ③ 队列面板 | `conversation.input.dock` | 分组队列 · 行内裁定（✓ 批准 / ⏸ 顺延 / ✕ 放弃）· 已放弃可恢复 · 立即开跑 · 执行中独立分组 |
| ④ 批次确认卡 | `shell.overlay` | 批次窗口前 T-30min 出现，未放行不执行（fail-safe） |
| ⑤ 执行报告 | `shell.overlay` | 结论先行：本次已省 ¥X · 异常置顶 · 采样候选择优 · 智能迭代审查意见 · 历史报告 |
| ⑥ 设置页 | `settings.section` | 官方定价说明（本地时区换算+一键采用）/ 闲时运行窗口（含最大并发）/ 忙时闲时窗口 / 24h 本地时间价格带预览 / 价目表覆盖 / 自治三档 |

**核心语义**：只有 `queued` 状态的任务会被闲时 runner 拾取；`pending-review` 是人与机器之间的海关——机器永远不能自己把任务推过这道关（采样模式的"选哪份"也是人的事）。

## 安装（用户）

从 [GitHub Releases](https://github.com/KelaoHu/dsh-lowtide/releases/latest) 下载预构建的 `dsh-lowtide.tgz`（或在 dsh 插件市场中一键安装），无需本地构建。桌面端与网页端使用同一份产物，按需要装入对应 profile：

```powershell
# 桌面端（DSH Desktop 客户端使用的 profile）
dsh plugin --profile desktop add dsh-lowtide.tgz

# 网页端（浏览器访问的 dsh web）
dsh plugin --profile web add dsh-lowtide.tgz
dsh web
```

- 网页端需要 `@deepseek-ai/dsh` ≥ 0.1.1-rc.2（`npm i -g @deepseek-ai/dsh` 或随桌面客户端附带），与桌面端同代引擎可同时服务两端。
- 两个 profile 的状态文件相互独立（`DSH_PROFILE` 隔离），桌面端与网页端可并行运行。
- 状态文件：`$DSH_HOME/lowtide.json`（web 端为 `$DSH_HOME/profiles/web/lowtide.json`）。

## 安装（开发）

```powershell
# 前置：Node ^22.19 / >=24，pnpm 11.7
pnpm.cmd install
pnpm.cmd --filter lowtide-core bundle     # core 构建产物要先于 dsh 测试
pnpm.cmd --filter dsh-lowtide bundle      # 构建 dsh 宿主半 + 客户端 bundle

# 首次：把插件 link 进 profile（client 半按包名从 profile 目录 resolve）
# 桌面端与网页端通用同一份产物，按需要装入对应 profile：
npx.cmd --yes @deepseek-ai/dsh@0.1.0-rc.7 plugin --profile desktop add ./packages/dsh-lowtide   # 桌面端
npx.cmd --yes @deepseek-ai/dsh@0.1.0-rc.7 plugin --profile web add ./packages/dsh-lowtide       # 网页端

# 启动（本地源码 checkout 或 npx 均可）
pnpm.cmd dev   # = dsh web --patch ./cordis.dev.yml
```

## 数据模型

- **状态文件**：`$DSH_HOME/lowtide.json`（`$DSH_HOME` 默认 `~/.dsh`）。若进程暴露 `DSH_PROFILE` 环境变量，则按 profile 隔离为 `$DSH_HOME/profiles/<profile>/lowtide.json`，避免并行实例互相覆盖。**同一时刻只应运行一个写入该文件的实例**（dev 与 desktop profile 分属不同文件的前提是 `DSH_PROFILE` 被正确设置）。
- **任务生命周期**：`draft → pending-review → queued → preflight → running → done/failed/stale/timeout`，加 `deferred`（顺延）与 `dropped`（软删，可恢复）。

## HTTP API（前缀 `/ds-lowtide/`，同源 + loopback 信任围栏）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/state` | 聚合状态（窗口/当前价/倒计时/队列/最新报告） |
| GET | `/events` | SSE 增量推送（客户端降级 4s 轮询） |
| GET/PUT | `/config` | 读/写配置（窗口、价目、自治档） |
| POST | `/tasks` | 投递工单（落 pending-review；支持 strategy/rounds） |
| POST | `/tasks/:id/approve \| defer \| drop \| cancel \| retry \| restore \| delete \| choose-candidate` | 裁定与管理（状态机守卫；choose-candidate 记录采样择优） |
| POST | `/tasks/approve-all` | 全部放行 |
| POST | `/estimate` | 测算：峰价（当前模型）vs 谷价（批量模型） |
| POST | `/batch/run-now` | 立即开跑（测试/手动） |
| POST | `/dismiss` | 今日不再拦截 |
| GET | `/health` | 心跳 |

## 执行引擎

- **并发调度**：同一批内按工作区分组——同工作区任务串行（git 索引锁安全），不同工作区并行，全局并发上限 `batch.maxConcurrency`（默认 3，设置页可调 1–8）。
- 每任务独立会话（失败隔离）；`agents.create` + `followup` + `whenIdle`；超时/重试一次；迭代（智能迭代）/采样按轮次执行并累加成本。
- **智能迭代**（iterative）：按任务类型自动选择审查维度（代码/文档/测试/重构/通用），每轮输出结构化问题清单并逐条修复；无高危问题或修复无实质变化即提前结束；审查历史进入执行报告的「审查意见」。费用约为生成 1 次 + 每轮（审查+修复）2 次调用。
- **模型**：默认批量模型跟随界面当前选择（全新安装的官方默认是 `deepseek-official` / `deepseek-flash`，即 DeepSeek-V4.1-Flash；旧名 `deepseek-v4-flash` 按别名计费）；新建工单「高级设置」里可从**本机 Harness 已接入的任意模型**中选择（含 llm-pi-ai / 自定义 OpenAI 兼容 provider），投递时携带 `model` + `modelProvider`，执行时以该 provider+model 真实运行。选「跟随全局」则使用界面当前选中的模型。非 deepseek 模型无官方价目 → 记账显示「价格未知」（可在设置页 `prices[model]` 手动补价目）。老任务（有 model 无 modelProvider）执行时自动按模型目录推断 provider。
- **预检**：文件 sha256/size 快照、git HEAD、工作区存在性、窗口适配、预算——任一不符 → stale/deferred，绝不盲跑。
- **顺延恢复**：窗口开始时 preflight-deferred 任务自动重新入队（`deferCount` ≥3 标失败）；用户手动顺延的回到待裁定。
- 每个窗口只跑一批（跨零点安全）；空队列不产生执行报告。

## 权限档（cordis.patch.yml 自带）

| preset | sandbox | approval |
|---|---|---|
| `lt-readonly` | read-only | never |
| `lt-standard` | workspace-write | never |
| `lt-trusted` | danger-full-access | never |

闲时无人值守执行 = 沙箱 + 零审批（fail-closed），任务级权限档由用户在投递时选择。

## 测试

```powershell
pnpm.cmd --filter lowtide-core test    # core 纯函数 44 测试
pnpm.cmd --filter dsh-lowtide test     # dsh 单测 124 测试
pnpm.cmd --filter dsh-lowtide exec playwright test   # e2e（需 dsh web 在 3080 运行）
```

e2e（10 个 spec，串行执行）：`smoke`（双面加载）、`css-vars`（CSS 变量在宿主主题全部可解析）、
`g1-screens`（六界面明暗截图）、`g2-modal`（新建工单弹窗）、`g3-settings`（设置页）、
`g4-window-editor`（胶囊窗口编辑器回读）、`g5-concurrency`（跨工作区并发/同工作区串行）、
`dock-new`（收起/展开态新建弹窗回归）、`full-loop`（投递→裁定→run-now→done→执行报告全闭环，
真实 API 执行）、`strategies`（迭代收敛/采样候选+择优/复核审查意见/清空已完成）。

## 安全

- 路由带 Host/Origin 信任围栏（loopback + 同源 + `sec-fetch-site` 跨站拒绝）；**不要将 3080 直接暴露公网**，远程部署走 SSH 隧道或鉴权反代。
- Windows 端沙箱为"缓解级"（partial），Linux/macOS 为完整强制；无人值守场景建议叠加任务级文件白名单与预算兜底。

### 威胁模型说明（安全审查结论）

- **工作区/文件路径不做"必须位于某目录之下"的限制**：任意绝对路径的工作区是本插件的核心能力（你要在自己的项目目录跑任务）。API 只监听 loopback 且有 Host/Origin 信任围栏，攻击面是本机进程/页面；恶意网页无法直接调用（跨站拒绝）。任务 ID 与文件路径从不参与任何"按路径删除文件"的操作——`delete` 只删除任务记录，不触碰磁盘文件。
- **状态文件为明文**（任务 prompt、路径、git sha）：`lowtide.json` 的读取权限等同于本机用户权限，注意备份与机器安全。
- **同一时刻只应运行一个写入同一状态文件的实例**：dev 与桌面端请用 `DSH_PROFILE` 隔离（见数据模型节），否则多进程写盘可能相互覆盖。
- **配置输入已加固**：PUT /config 拒绝非法时区与非法 HH:MM 窗口（400），持久化加载对旧文件保持宽松（升级不丢数据）。
- 无人值守执行使用沙箱 + 零审批（fail-closed）：`lt-readonly` / `lt-standard` / `lt-trusted` 三档按任务选择；L3 全自动会跳过人工确认，切换前有二次确认。

## 许可

MIT
