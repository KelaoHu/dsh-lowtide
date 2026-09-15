<div align="center">

# dsh-lowtide

**忙时排任务，闲时自动跑。**

<sub>半自动、全自动两种模式，躲开大模型的高峰时段和峰顶价格。DeepSeek Harness 必备插件。</sub>

[English](./README.md) | **简体中文** | [繁體中文](./README.zh-HK.md) | [العربية](./docs/README.ar.md) | [Deutsch](./docs/README.de.md) | [Español](./docs/README.es.md) | [Français](./docs/README.fr.md) | [Italiano](./docs/README.it.md) | [한국어](./docs/README.ko.md)

<img src="./assets/overview.zh-CN.png" alt="lowtide overview" width="100%">

</div>

---

![hero](./assets/screenshots/hero.png)

<p align="center"><i>队列里压着三条任务，会话头部亮着价格状态，到了你设的窗口它自己开跑</i></p>

## 简介

lowtide 是 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/dsh) 的一个插件。它解决的问题很朴素也非常自然：

通常，你想让 Agent 干活的时候，就得坐在电脑前向它发送指令，等待回复，然后人工审核。但这种工作方式似乎忘了：你有大把的空闲时间，也有避开某些模型峰谷定价的机会。

装了这个插件，日子会变成这样：白天想到什么活儿，随手扔进队列，审一眼放行；它攒到你设定的时间（比如晚上七点以后——那会儿 DeepSeek 是低谷价）自动开跑；第二天早上你打开报告，跑得好的收下，跑砸的打回去重跑。

就这点事。但用上一周，你的工作节奏真的会变慢的，可别忘了“时间就是金钱，效率就是生命”……

几个关键能力：

- 四种执行策略：单次、迭代、采样、复核，从“一遍过”到“跑五份我来挑”
- 168 项单元测试 + 10 个端到端 spec，CI 在 ubuntu / windows × node 22 / 24 四个环境全绿
- 桌面端和网页端用的是同一份构建产物，装一次两端通用
- 闲时自动落在 DeepSeek 低谷价时段，同样一批任务，成本大约是高峰的一半

## 正常使用 Agent 的一天可能是这样的……

**下班前十分钟。** 你 review 完代码，顺手排了三个明天的活：一个重构（迭代策略，3 轮）、一份周报（单次）、一个拿不准的方案（采样，跑 4 份候选）。全部放行，关机走人。第二天到工位打开晨报：重构做完了，周报躺在那儿，4 份方案并排摆着，每份花了多少钱写得明明白白。

**周五晚上。** 把攒了一周的杂活一口气排进去：清依赖、补测试、跑数据脚本。周末两天全天低谷价，你出去玩，它在家干活。周一回来看报告，不合格的 retry，合格的合并。

**上午十点的灵机一动。** 你正跟 Agent 聊一个紧急 bug，忽然想让它“顺便把文档也更了”。拦截卡弹出来：现在跑是高峰价，投到晚上跑便宜一半，差多少钱直接写给你看。点一下“投递闲时队列”，草稿一个字不丢，接着聊 bug。

**常开服务器。** 你有台 24 小时开着的机器跑 dsh。切成 L3 全自动档，之后从任何地方用 API 投任务（`POST /ds-lowtide/tasks`），它到点自己跑、自己出报告。无人值守，但沙箱、日预算、文件锁定这些保险丝一根不少。

**要给客户的交付物。** 用复核策略：先跑一遍，再自动开个独立会话，按你指定的关注点（比如“专挑数据来源的硬伤”）把结果重新挑一遍刺。早上你看到的不是裸结果，是结果加一份挑剔的审查意见。

**人在海外。** 你在旧金山，DeepSeek 的高峰是北京时间，换算过来其实是前一天的傍晚和夜里。设置页会把官方时段换算成你的本地时钟，一键采用。你按自己的作息设窗口，账永远跟官方对齐。

## lowtide 是怎么工作的

```
① 投递              ② 裁定              ③ 执行                 ④ 验收
你有空时：           队列面板按工作区      到达闲时窗口：          你忙完回来：
拦截卡一键投递        分组展示，逐条        预检五关全部过了        打开执行报告——
或手动填工单     →   ✓批准 ⏸顺延  →    才进沙箱执行       →  结果 + diff + 实花
（四种策略可选）      ✕放弃 / 全部放行     每个窗口只跑一批        + 省下的钱
```

一条任务的完整流程：`pending-review → queued → preflight → running → done / failed / stale / timeout`，外加 `deferred`（顺延）和 `dropped`（软删，能捞回来）。

第二步“裁定”是 lowtide 跟“全自动脚本”最大的区别：**每条任务都得你亲手放行才会执行**（L2 档是批次开跑前统一放一次）。机器不能自行进入运行队列。自动化的是执行，不是决策——所以你可以放心地不在场。

## lowtide 的界面介绍

**新建工单弹窗。** 四种策略并排摆开，每个下面都有一句通俗说明；轮数、优先级、运行模式跟着任务走，不用回设置页改全局。任务落地就是“待审”，谁也别想绕过你进队列。

![new-task-modal](./assets/screenshots/new-task-modal.png)

**高级设置。** 模型、推理强度、0–9 的优先级、开新会话还是接着上次聊、锁定文件清单，都在这张小窗里。锁定文件单独说一下：列进去的文件执行前会算一遍 sha256，对不上就标 stale 拒跑——防止排队期间文件被其他任务改动，而它毫不知情地覆盖上去。

![advanced-options](./assets/screenshots/advanced-options.png)

**模型自由选择。** 默认用官方 `deepseek-flash`（DeepSeek-V4.1-Flash；旧名 `deepseek-v4-flash` 仍可调用但按 Flash 价计费），但每个任务都能单独指定模型——你 Harness 里接的都在下拉里，按来源分组。接了私有 provider 也能用。非官方模型没有公开价目，账本会标注“价格未知”；想记账就去设置页补个价目。

![model-picker](./assets/screenshots/model-picker.png)

**窗口编辑器。** 多段、跨零点、按星期几都行。底下那条 24 小时价格带是实时的：红高峰绿低谷，你这会儿在哪儿标得清清楚楚。不在东八区就点“一键采用官方忙时”，北京时段自动换算成本地时间。

![window-editor](./assets/screenshots/window-editor.png)

**设置页。** 窗口几点到几点、一批跑几个、单任务最长多久、并发开多少、每天最多花多少、报告留几份、自治开哪档、价目表要不要覆盖——全是图形界面，不用碰配置文件。官方定价规则（含周末全天低谷那条新规）在这页做了通俗说明。

![settings](./assets/screenshots/settings.png)

日常使用中还有三个界面：**价格胶囊**（会话头部，忙闲状态、队列数，点它直接改窗口）；**忙时拦截卡**（高峰打字就弹，价差写在明面上，草稿不丢）；**执行报告**（晨报：先说省了多少，异常置顶，候选等你挑，一键复制 Markdown）。

## lowtide 的工作区介绍

每个任务都得落在某个工作区（workspace）里跑。这一个下拉决定了三件事：

**它能动哪些文件。** 任务跑在沙箱里，沙箱的边界就是工作区目录。选错了，轻则找不到文件，重则改了不该改的。

**它跟谁排队。** 同工作区的任务串行（两个任务不会同时改一个仓库），不同工作区并行（上限默认 3，可调）。想要吞吐就把不相关的活撒开，想要顺序就收在一起。

**报告怎么归组。** 队列面板和晨报都按工作区分组，任务一多，这个分组会很有用。

工单里的 Workspace 下拉有三个来源：**Use current workspace**（就用当前会话的，最常用）、**列表里的已有工作区**（每个都带绝对路径，一眼认出来）、**Custom path…**（手填路径）。选了“续接前序会话”的话，还要再挑工作区和具体会话，任务接着那个会话的上下文继续干。

我的建议：**一个项目一个工作区，不要混用。** 预检里的 git 快照和文件锁定都按工作区生效，混着放容易把自己绕进去。

## 四种策略，什么时候用哪个

| 策略 | 它干什么 | 什么时候用 | 费用 |
|---|---|---|---|
| **单次** | 跑一遍就完 | 简单明确的活 | 1× |
| **迭代** | 同一会话连跑 2–5 轮，每轮按你的“迭代眼光”改上一轮；两轮足够像就判定收敛，提前收工 | 要打磨的东西：文章、方案、代码 | 约 N× |
| **采样** | 2–5 个互不可见的独立会话各跑一份，并排展示标明花费，**你挑**——机器不做审美判断 | 标题、创意、方案：你要选项不要答案 | 约 N× |
| **复核** | 跑完另开独立会话，按你的关注点重新挑刺，输出审查意见 | 重要交付物，发出去前再过一道 | 约 2× |

## 自治三档

- **L1 per-task**：每条任务单独 ✓ 才跑。刚开始用、仓库很重要的时候用它。
- **L2 batch**（默认）：任务进待审，开跑前 30 分钟弹确认门，一次全放；不放就一律不跑。日常用这个。
- **L3 full-auto**：投递即入队，到点直接跑，零确认（切换时要确认两次）。常开服务器专用。

单个任务还能在工单里临时覆盖全局档位。

## 架构：如何在你不在场时安全工作

让 Agent 在你睡觉时跑批任务，并不是一件小事。lowtide 能做到，靠的是底下四层设计。

**Cordis 微内核。** dsh 跑在 Cordis 微内核插件体系上：所有能力都是插件，插件之间靠服务注入说话，互不直接依赖。lowtide 的宿主半就是一组守规矩的 Cordis 服务——路由、调度、状态机各干各的，注册进内核，随 harness 启动，也能干净卸掉。一句话：它不是贴在 dsh 外面的一层皮，而是长在内核里的一个器官。

**双面构建，一份产物。** 宿主半（Node.js）管调度、执行、账本；浏览器半（React）管全部界面。一次构建出双面产物——桌面版 dsh 的界面本来就是 Web 渲染，所以桌面端和网页端不用两个分支，行为一模一样。

**平台无关的核心层。** `lowtide-core` 里是窗口模型、价目表、计费公式、队列汇总、账本、批次窗口计算——全是不碰 dsh 任何 API 的纯函数，独立成包独立测试。核心逻辑经过 44 个纯函数单测反复测试；哪天想移植到别的 Agent 框架，这个包拆出来就能用。

**纵深防御。** 预检五关（工作区还在吗、git HEAD 动了吗、锁定文件 sha256 对吗、窗口装得下吗、预算够吗），任何一关不过就标 stale 或顺延，绝不盲跑；三档沙箱预设审批全置 never——无人值守意味着没人能点“允许”，所以允许做什么，开跑前就已限定好；状态文件原子写入，写坏了自动回退备份；HTTP 路由只认本机同源请求。

状态同步走 SSE，断了自动降级 4 秒轮询——队列动一下，界面立刻跟着动。

## 安装

**一键安装（预构建包）：** `dsh plugin --profile web add https://github.com/KelaoHu/dsh-lowtide/releases/latest/download/dsh-lowtide.tgz`——或按下文从源码构建。

前置：Node `^22.19 || >=24`，pnpm `11.7`。所有依赖都在公共 npm registry，不需要私有源。

先装 dsh（二选一）：桌面版去 DeepSeek 官方渠道装 dsh Desktop；命令行版 `npm install -g @deepseek-ai/dsh`。然后在 dsh 的模型设置里配好一个能用的模型（比如 DeepSeek 官方 API Key）——lowtide 自己不碰你的凭据。

> **兼容性（dsh-lowtide ≥ 0.2.3）:**dsh CLI **≥ 0.1.5-rc.1** 或 **DSH Desktop 2.0.3**。浏览器半包只依赖各代外壳都静态播种的模块词,一份产物两端都能启动;0.1.1 时代的 CLI 外壳与桌面端共用同一张种子表,行为应当一致,但只有上面两个目标经过实测。(0.2.2 及更早版本在 CLI 0.1.5 上无法启动——见 issue #4。)

然后拉源码、构建、装进去：

```powershell
git clone https://github.com/KelaoHu/dsh-lowtide
cd dsh-lowtide
pnpm install

# 先构建核心层（插件的测试依赖它的产物）
pnpm --filter lowtide-core bundle
# 再构建插件：宿主半 + 浏览器半一次出齐
pnpm --filter dsh-lowtide bundle

# 装进 profile——桌面端网页端同一份产物
npx @deepseek-ai/dsh@0.1.5-rc.1 plugin --profile desktop add ./packages/dsh-lowtide   # 桌面端
npx @deepseek-ai/dsh@0.1.5-rc.1 plugin --profile web add ./packages/dsh-lowtide       # 网页端

# 起开发实例（3080 端口）
pnpm --filter dsh-lowtide dev
```

装完打开 dsh，会话头部应该能看到价格胶囊，输入区旁边有队列面板。看不到就翻下面的常见问题。

## 日常使用

**投递有三条路。** 拦截卡（高峰打字，一键投递，草稿原样变工单）；手动工单（输入区旁点“New”，提示词、策略、轮数、优先级随便填）；API（`POST /ds-lowtide/tasks`，接进你自己的自动化）。

**队列面板的日常。** 按工作区分待执行 / 已结束 / 已放弃三栏；行内 ✓ 批准、⏸ 顺延、✕ 放弃（软删能恢复）；“全部放行”一次批完；“清空已完成”保持清爽（账不受影响）；“Run now”不等窗口立刻跑一批，调试用。

**时间语义。** 官方忙时段按**北京时间**判定（DeepSeek 按北京时间收费，账得对齐；周末全天闲时）；你自定义的窗口和闲时运行窗口按**你的本地时间**判定，支持跨零点、按星期。窗口结束只是不再启动新任务，不打断正在跑的。

**账本。** `ledger[YYYY-MM-DD] = { yuan, savedYuan }`，实花和省下的按天累计。显示价就是计费价，同一个公式，逐位可核对。

## 配置项全表

`GET /ds-lowtide/config` 读，`PUT` 部分更新（未列出的字段会被拒绝）：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `autonomy` | `'l1'\|'l2'\|'l3'` | `l2` | 自治三档；工单里可单任务覆盖 |
| `batch.window` | `"HH:MM-HH:MM"` | `19:00-23:30` | 闲时运行窗口（本地时区） |
| `batch.tz` | IANA 时区 | 系统时区 | 运行窗口时区（留空=本地） |
| `batch.gateLeadMin` | 分钟 | `30` | 批次确认门提前量 |
| `batch.maxTasksPerNight` | 数字 | `10` | 每批任务上限 |
| `batch.maxDurationMin` | 分钟 | `240` | 单任务最长时长（超时取消重试一次） |
| `batch.maxConcurrency` | 数字 | `3` | 最大并发 1–8（同工作区串行，跨工作区并行） |
| `batch.paused` | 布尔 | `false` | 暂停自动批处理 |
| `budgetDailyYuan` | ¥ | `0` | 日预算（0=不限） |
| `windows[]` | 数组 | `[]` | 自定义窗口；空=官方忙时（北京时间） |
| `windows[].level` | `peak\|off\|custom` | — | 忙时 / 闲时 / 自定义（闲时价×倍率） |
| `windows[].start/end` | `"HH:MM"` | — | 本地钟点，支持跨零点 |
| `windows[].days` | `1..7` 数组 | 每天 | ISO 星期（1=周一 … 7=周日） |
| `windows[].tz` | IANA 时区 | 系统时区 | 该窗口的时区 |
| `windows[].multiplier` | 数字 | `1` | custom 窗口的闲时价倍率 |
| `prices[model].{peak,off}.{input,inputCached,output}` | ¥/1M | 官方 | 价目表覆盖 |

## HTTP API

前缀 `/ds-lowtide/`，同源 + loopback 信任围栏：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/state` | 聚合状态（价格/倒计时/队列/最新报告） |
| GET | `/events` | SSE 增量推送（客户端降级 4s 轮询） |
| GET/PUT | `/config` | 读/写配置 |
| POST | `/tasks` | 投递工单 |
| POST | `/tasks/:id/approve \| defer \| drop \| cancel \| retry \| restore \| delete \| choose-candidate` | 裁定与管理 |
| POST | `/tasks/approve-all` | 全部放行 |
| POST | `/estimate` | 测算：峰价 vs 谷价 |
| POST | `/batch/run-now` | 立即开跑 |
| POST | `/dismiss` | 今日不再拦截 |
| GET | `/health` | 心跳 |

## 权限档

| preset | sandbox | approval |
|---|---|---|
| `lt-readonly` | read-only | never |
| `lt-standard` | workspace-write | never |
| `lt-trusted` | danger-full-access | never |

投递 UI 不提供选择，任务统一按 `lt-standard` 跑；其余两档留给 API（`POST /tasks` 传 `permissionPreset`）。过了预检才跑，绝不盲跑。

## 数据与状态

- 一切持久化在 `$DSH_HOME/lowtide.json`（原子写入，损坏自动回退备份）；有 `DSH_PROFILE` 时按 profile 隔离。**同一时刻只让一个实例写同一个文件**——桌面版和 Web 版别同时开，或者做好 profile 隔离。
- 每窗口只跑一批，跨零点安全；空队列不产空报告。
- 顺延恢复：窗口开始时预检顺延的任务自动重新入队（≥3 次标失败）；你手动顺延的回到待裁定。

## 测试与 CI

```powershell
pnpm --filter lowtide-core test    # 核心层纯函数 44 测试
pnpm --filter dsh-lowtide test     # 插件单测 124 测试
pnpm --filter dsh-lowtide exec playwright test   # e2e（需 dsh web 在 3080 跑着）
```

10 个 e2e spec 串行跑，从双面加载冒烟到“投递→裁定→执行→报告”全闭环（真实 API）都覆盖。仓库自带 GitHub Actions，每次 push / PR 在四个环境上跑 install → build → typecheck → 全部单测。

## 安全

- 路由只认 loopback + 同源；**不要把 3080 暴露到公网**，远程走 SSH 隧道或鉴权反代。
- Windows 端沙箱是缓解级，Linux/macOS 完整强制；无人值守建议叠加文件白名单和日预算。
- L3 全自动切换有二次确认。
- 状态文件里有完整任务提示词和路径，备份注意保管。
- 发现漏洞走 [SECURITY.md](./SECURITY.md) 的私密渠道。

## 常见问题

**窗口到了为什么没跑？**
按顺序查：任务批了没 →“暂停闲时批处理”勾了没 → 确认门放了没 → 预算用完没 → 预检是不是挂了（任务变 `stale`，详情页有原因）。

**采样为什么不会自动选最好的？**
故意的。机器不替你做审美判断，候选和花费摆给你，你点“选这份”。

**我在国外，忙时对不上作息？**
设置页会显示官方时段在你本地长什么样；按自己作息来就自定义窗口，或点“一键采用官方忙时（换算到我的时区）”。

**估算和实花对不上？**
估算只按输入 token 上界粗算，实花按真实 usage（含输出和缓存命中）。报告里两个数都有。

**任务变 stale 了？**
预检挂了：工作区没了、git 快照变了、锁定文件被改了、预算不够、窗口装不下。详情页看 `lastError`，修好点 `retry`。

## 已知限制与路线图

- 当前是发布候选（v0.2.2）；e2e 需要真实 dsh web 实例。
- 默认批量模型 `deepseek-flash`；非官方模型没公开价目，账本标“价格未知”，可在设置页手动补。
- 单任务最长 240 分钟，超时取消重试一次。
- 路线图候选：多窗口多批次、任务依赖图、预算自动分摊、报告推送（邮件/Webhook）、价格波动提醒。

## 目录结构

```
dsh-lowtide/
├── README.md                  English
├── README.zh-CN.md            本文件
├── README.zh-HK.md            繁體中文版
├── assets/screenshots/        README 界面截图
├── docs/                      多语言 README（ar, de, es, fr, it, ko）
├── LICENSE                    MIT
├── CHANGELOG.md               版本记录
├── CONTRIBUTING.md            贡献指南
├── CODE_OF_CONDUCT.md         行为准则
├── SECURITY.md                安全策略
├── .github/                   CI 工作流 + Issue/PR 模板
├── package.json               pnpm workspace 根
└── packages/
    ├── core/                  平台无关核心层（lowtide-core）
    │   ├── src/               windows / pricing / model / digest / ledger / scheduler
    │   └── test/              纯函数单测
    └── dsh-lowtide/           插件本体（dsh-lowtide）
        ├── src/               宿主半：routes / runner / scheduler / intake / store / state-machine
        ├── client/            浏览器半：components / hooks / i18n / store
        ├── test/              单测 + e2e（Playwright）
        ├── cordis.patch.yml   插件行 + lt-* 权限预设
        └── README.md          包级 README
```

## 写在最后

我把这个插件的内容完全开源给大家，希望能够实现大家生产力水平的提高。同时我也希望能够得到来自开源社区的反馈，能够让我学习到更多的内容，我们一起把这一款插件运营好。让我们在前往 AGI 的星辰大海上一起进步。

做了一点微小的贡献，谢谢大家。

## 许可

MIT License（见 [LICENSE](./LICENSE)）。

- 构建于 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/dsh) · Cordis 插件体系
- [DeepSeek 模型与价格（2026-09-10 更新）](https://api-docs.deepseek.com/quick_start/pricing) · [更新日志：V4.1-Flash 上线、模型改名与降价（2026-09-10）](https://api-docs.deepseek.com/updates) · [news](https://api-docs.deepseek.com/news)
