# 开发日志与经验（DEVELOPMENT-LOG.md）

本文件记录已发生的事实与教训。向前看的计划在 PLAN.md。

## 进度时间线

- **M0（2026-08-14）**：立项。从「领域知识护城河」修正为「业务内较通用场景」（用户否决了 SR 几何验证等过细方向，提出 ADB 台架运维更通用）。脚手架（dsh.bundle + cordis.patch.yml + tsc 构建）+ 计划 + git init + npm 包名 `dsh-adb` 占用检查。
- **M1**：adb 执行层（定位/执行/错误分类）+ 7 工具 + 解析器单测 8 用例全绿。
- **M2**：GitHub 仓库创建（SSH 认证 + topics）+ 三份清单 PR（0xsline#87 ✅、awesome-dsh-plugin#85 ✅、Alex-Yanggg#29 ⏳）+ npm 发布 0.1.0。
- **M3**：台架端到端冒烟（Android 13 车机台架）→ 抓到 bug ①②，发 0.1.1/0.1.2；补测全部 7 工具 → 抓到 bug ③，发 0.1.3。
- **M4（真机补测）**：用户插入 Android 13 真机 → 抓到 bug ④（battery），发 0.1.4；补测关闭全部环境缺口（battery 实数据、正向无线连接）。至此「提交即测」达成。

## 已修复的 4 个发布级 bug（最大教训源）

| # | 版本 | 发现方式 | 现象 | 根因 | 修复 | 防再犯 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.1.0→0.1.1 | headless 加载 | 插件加载即崩 `cannot get property "tools" without inject` | `ctx.tools.register` 未声明 `inject: ['tools']`，Cordis Guard 拒绝未声明服务访问 | index.ts 加 `export const inject = ['tools']` | 任何 `ctx.<svc>` 必须进 inject；可选服务用 `ctx.get` |
| 2 | 0.1.1→0.1.2 | 后台 logcat 冒烟 | `job_output` 报 `value.text must be a string` | `readOutput()` 返回 `{added,text}` 对象，jobs 契约要求字符串 | 改为返回 `read.text` 字符串 | 读 jobs 契约（tool-jobs 源码的 output schema）再写 producer |
| 3 | 0.1.2→0.1.3 | 错误分类验证 | 坏 serial 落 `ADB_EXIT_1` 而非 `DEVICE_NOT_FOUND` | 匹配正则要求 `error:` 前缀，真实输出是 `adb.exe: device 'X' not found` | 放宽为 `(?:error:\s*)?device ... not found` | 分类正则要按真实 adb 输出写；模型看到的 message 与错误码无关，验证错误码要确定性测试 |
| 4 | 0.1.3→0.1.4 | 手机 battery 冒烟 | battery 永远返回空 `{}` | `dumpsys battery` 不接受包名参数（返回 "Unknown command"），perf 工具对每个指标都传了包名 | battery 分支不传包名 | 新指标先验证 dumpsys 语法；「返回空」可能是工具传参错而非设备无数据 |

共性教训：**纯单测无法覆盖「组合加载 + 真实工具管道 + 真实设备」的契约层**（Guard、jobs 序列化、dumpsys 参数、adb 输出变体）。因此「提交即测」必须含 E2E。

## 环境与工具经验（踩过的坑）

- **沙箱 EPERM**：`pnpm` spawn 子进程被沙箱拦截（文档边界，不可提权——本会话审批已禁用）。规避：构建/安装用 npm；`dsh plugin add` 走 pnpm 偶发 EPERM，重试或 `npm install --no-save` 直装。
- **NODE_ENV=production**：本机环境变量导致 npm 跳过 devDependencies。安装一律 `npm install --include=dev`。
- **npm 11 arborist bug**：某依赖树（unbuild/consola）触发 `Cannot read properties of null (reading 'matches')`。规避：砍掉 tsup/vitest，构建只用 tsc（单进程无 spawn，还顺带绕开沙箱 EPERM）。
- **GitHub 网络**：本机（公司网络）`github.com/login/oauth/access_token` 端点必超时（设备码流程不可用）；`api.github.com` 稳定；github.com 网页偶发抖动。授权改用 SSH 密钥（22 端口通）。
- **git insteadof 坑**：用户全局 `url.https://github.com/.insteadof=ssh://git@github.com/` 会把 ssh URL 改写为 https 导致认证失败；`-c url.https://github.com/.insteadOf=`（空值）会变成「把空前缀替换为 https」把所有 URL 都叠前缀——正确解法是 remote 用 `ssh://git@github.com:22/<repo>.git`（显式端口使改写规则不匹配）。
- **gh CLI**：`gh auth login --with-token` 校验要求 `read:org` scope（repo scope 的 token 不行）；用 `GH_TOKEN` 环境变量即可跳过校验（repo scope 够用）。gh 装于 `C:\Program Files\GitHub CLI\gh.exe`，后台任务的 PATH 可能不含它。
- **npm 发布**：账号开 2FA 后，classic token 发布会被拒（E403 要求 bypass 2FA）；需 granular token 勾选 "Bypass 2FA when publishing"。token 用命令参数 `npm publish --//registry.npmjs.org/:_authToken=<token>` 传入，不落盘。
- **headless 冒烟要点**：`dsh-base` 只是核心基建（无 agent-loop），跑任务必须加 `@deepseek-ai/dsh-headless` bundle；模型凭据在 `~/.dsh/.credentials.yaml`（不在 settings.yaml）；会话日志在 `~/.dsh/sessions`。
- **psql/pwsh 工具边界**：每条 pwsh 命令是全新进程（无持久 cwd，必须传 workdir 或命令内 Set-Location）；忘记 Set-Location 会把 clone 落进默认工作目录（污染 harness checkout，已清理）。
- **client.js 的 React 全局陷阱（v1.1 事故）**：我假设静态 bundle 的 client 代码能用裸 `React` 全局（误读了 client Builtin 列表——那是动态包才有）。实际静态 bundle 跑在 `__ModuleLoader__.load` 的 factory 里，必须 `const React = require('react')`。v1.1 整份重写 client.js 时漏掉了这行 → ReferenceError → client 插件加载失败 → harness 无法载入。由用户在外部会话修复（加回 require），教训：重写 client.js 后必须 grep 确认 `require('react')` 存在；这一行是命脉，AGENTS.md 已列为铁律。

## 生态经验（DSH 三方插件市场）

- 市场形态：**没有官方中心市场**。真实通路 = GitHub `#dsh-plugin` 话题（发现）+ 社区清单（awesome-*）+ npm bundle（安装）+ `dsh-find-plugin` 类工具（会话内检索）。官方 0811 已删除 repository 机制。
- 三份清单各是独立维护者、格式不同：0xsline（手维护 README 双语）、awesome-dsh-plugin（README 双语 + 中文镜像站）、Alex-Yanggg（`catalog/plugins.json` + python 脚本生成中文镜像，含空分类可占位）。
- 插件质量门面：`dsh.bundle` 必须声明；README 双语；安装一行命令；有实机验证故事是强加分项（本次 4 个 bug 修复记录成了最佳宣传素材）。
- `dsh plugin add` 从 npm 安装免构建授权（git 源安装需要 `prepare` 脚本 + pnpm allowBuilds）。

## 决策记录（为什么这么做）

- **选 ADB 台架运维而非领域插件**：用户指正——通用 harness 的插件应「靠近一个场景但业务内通用」，ADB 操作对任何安卓/车机团队通用，且能力自足（agent 不需领域知识）。领域知识（SR 几何等）的正确载体是 skill，不是工具。
- **纯 JS 依赖最小化**：运行时只依赖 schemastery；`@deepseek-ai/*` 仅类型。降低发布/解析风险。
- **错误码体系**：结构化错误码是模型可见契约，用分类器统一映射，避免 agent 面对裸 adb 文本。
- **面板定位（2026-08-18，用户质询「为什么不用 Android Studio」后确立）**：面板单独存在没有意义（Android Studio 更强）——价值必须来自 harness 集成：① 工具（agent）与面板（人）共享同一套 adb 执行核心，同一设备同一状态；② 面板是「人在回路」观察台，人能看到 agent 在设备上做什么；③ 数据直通对话（日志/快照/崩溃一键注入 agent 分析）是 Studio 无法复制的；④ 轻量 Web 面板 vs 重型 IDE，台架巡检随时开；⑤ 会话资产可检索可复盘。下一步产品化关键：面板↔对话互操作（「发送到对话」按钮、agent 工具调用时面板同步状态）。面板不是替代 Studio 的 IDE，而是 harness 内「设备操作台 + AI 协同入口」。据此砍掉采样曲线/截图（无协同价值），保留性能快照。
- **证据→信号（2026-08-20，真机验收发现原始数字误导）**：一键体检首版直接把原始计数丢给 agent——崩溃缓冲 43 条、W/E/F 16987 条。真机拆解发现 43 里真实崩溃只有 1 条（其余是 MediaTek 启动标记 `mtk-brm-*`），16987 里 90%+ 是同一标签（mDNS EPERM）刷屏。教训：**给 LLM 的「证据」必须先做噪音过滤，否则数字本身会误导归因**。改为三层提炼：崩溃按签名分类（真实崩溃 + 同 pid 堆栈链 / 启动标记 / 其他）、日志按 tag 聚合（计数 + 单样本行）、插件自产健康摘要（verdict + lines + issues）。agent 从此从结论出发而非从原始证据出发。同类教训在 harness 侧同理：任何给模型的展示面都要先问「这个数字在误导吗」。
