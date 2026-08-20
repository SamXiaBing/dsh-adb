# 待开发功能清单（ROADMAP.md）

harness × adb 协同功能路线图。每个功能标注：**使用场景**、**为什么在 harness 插件上具备该能力带来好处**（相对独立 CLI / Android Studio 的差异价值）、**依托的 harness 机制**、**大致成本**、**状态**。

共同主线：单条 adb 命令在独立 CLI 里也能跑；harness 插件独有的价值是让**设备数据进入模型推理**、让**模型推理反过来驱动设备操作**，并且全程可审计、可定时、可回滚——即「观察 → 分析 → 决策 → 行动 → 留痕」闭环。对应能力已在 [REQUIREMENTS.md](REQUIREMENTS.md) 的「明确不做」中更新边界。

---

## 已实现

### ① 设备诊断报告（一键体检）— v1.2.0 ✅

- **使用场景**：QA 拿到一台异常设备，想知道「这台设备现在怎么了」。面板点「一键体检」，采集设备信息（型号/版本/分辨率/内存）、Top RSS 进程、崩溃缓冲、W/E/F logcat 窗口、存储用量，落盘到报告存储，并一键发送到对话让 agent 结合 `dsh-adb-crash-analysis` 技能产出结构化诊断结论。还能对比「上午体检 vs 下午体检」的变化。
- **为什么在 harness 插件上有价值**：Android Studio 只能给原始 dump；模型在 harness 里直接解读成可读结论，报告作为文件留存可回溯。
- **依托机制**：现有 RPC 采集 + crash-analysis skill + send-to-chat + 新增报告存储（`~/.dsh/storages/dsh-adb/reports`）。
- **实现**：`adb_device_report` 工具 + RPC `deviceReport` 端点 + 面板「一键体检」按钮；每节独立降级（失败进 errors，不整体失败）。**Evidence → Signal**：崩溃按签名分类（真实崩溃+堆栈链 / MediaTek 启动标记 / 其他）、W/E/F 按 tag 聚合（计数+样本行）、插件自产健康摘要（verdict/lines/issues）——agent 从结论出发而非从 17k 行原始日志出发。单测 56 例全绿，真机验证通过。

---

## 待开发

### ② 崩溃归因闭环 — 数据→模型

- **使用场景**：复现 bug 后，agent 盯着 crash buffer，一旦出现新崩溃签名就自动拉取崩溃前 30s logcat + 当时内存，模型定位根因行：「是这条 OOM 导致的」。
- **为什么在 harness 插件上有价值**：工具采集 + 模型推理的组合是独立工具链没有的——崩溃日志谁都会抓，但「抓完直接归因」需要 LLM。
- **依托机制**：后台 jobs 轮询 + crash-report 工具 + 模型上下文。
- **成本**：中（watch-crash 后台任务 + 归因 prompt）。状态：待开发。

### ③ 截图视觉解读 — 数据→模型

- **使用场景**：UI 测试/崩溃复现时，agent 自动 screencap 并让多模态模型描述当前屏幕状态：「崩溃瞬间屏幕显示黑屏 + 状态栏无响应」。
- **为什么在 harness 插件上有价值**：RPC screenshot 端点已保留，接上多模态模型就把 adb 变成语义化 UI 状态理解器；Android Studio 只能给你一张图。
- **依托机制**：screenshot RPC 端点（已有）+ `ctx.llm.stream({provider, model})` 指定视觉模型（pi-ai 适配器支持 image block；主会话 deepseek 纯文本模型不受影响）。
- **成本**：小-中。状态：待开发。

### ④ 台架自动化测试（脚本执行 + AI 图像比对）— 模型↔设备

- **使用场景**：harness 按用户配置的脚本在台架上执行**拉起应用（`am start`）、杀应用（`am force-stop`）、点击/输入（`input tap/swipe/text`）**，每步/终点按用户配置的检测条件做**AI 级图像比对**（截图 → 视觉模型判断「是否出现登录成功页面」等），产出结构化测试报告（每步 ✓/✗ + AI 依据 + 截图附件）→ 发送到对话 + 落盘。
- **为什么在 harness 插件上有价值**：台架动作编排（Appium/UIAutomator 也能做）只是前半；「AI 图像比对」是 harness 独有的——截图经 `ctx.llm.stream` 路由到视觉模型做语义判断，替代写死的像素/坐标断言，测试结果从「一堆 logcat 行」变成「通过/失败 + 原因 + 截图证据」。这正是「观察→分析→决策→行动→反馈」闭环的完整走通。
- **依托机制**：adb 执行核心（am/input 现成）+ screenshot 端点 + `ctx.llm.stream` 视觉模型路由 + image attachment 服务（attachment-local `saveImage/readImage`）+ send-to-chat。检测条件类型：image（视觉比对）/ text（uiautomator dump 查文本）/ process（进程存活）/ property（getprop 值）。
- **注意**：视觉比对需要部署配置了支持图像的模型路由；若只有纯文本模型，自动降级为像素级 diff + 文本条件，功能不失效只是少 AI 判断。
- **成本**：中-高（脚本引擎 + 检测层 + 结果反馈 + 配套文档）。状态：待开发。

### ⑤ 等待/条件原语 — 模型→设备

- **使用场景**：agent 编排多步流水线「装 APK → 等设备在线 → 等 MainActivity 出现在 logcat → 抓快照」，而不是盲目 sleep 固定秒数。
- **为什么在 harness 插件上有价值**：agent loop + 后台 jobs 让「观察→判断→继续」成为一等原语；单一 adb 命令做不到跨命令编排，这是 agent 驱动设备的刚需。
- **依托机制**：ctx.jobs 后台任务 + `adb_wait_for` 新工具（设备在线/启动完成/进程出现/logcat 模式）。
- **成本**：小（纯 host 新工具 + 测试）。状态：待开发。

### ⑥ 危险操作审批 — 模型→设备

- **使用场景**：agent 想把测试 APK 装到别人正在用的真机、或对 bench 执行 reboot/清数据。install/卸载/reboot 等破坏性命令走 harness 审批，用户点「允许一次」才执行。
- **为什么在 harness 插件上有价值**：Android Studio 没有审批概念；harness 的 interaction 能力给 adb 一个安全人机协同层——这是「在 harness 里」才有的能力，也让 agent 敢用破坏性命令而不用担心误伤。
- **依托机制**：`ctx.approval` 分发服务（packages/interaction/user-approval，审批瀑布 + ask/never 策略）。
- **成本**：中（工具审批策略层 + 测试）。状态：待开发。

### ⑦ 多设备对比分析 — 模型→设备

- **使用场景**：「这个构建手机 OK 但 bench 卡顿」。agent 把同一快照/同一命令并行跑在 bench + 手机 + 模拟器上，对比并解释差异（内存占用、帧率、进程差异）。
- **为什么在 harness 插件上有价值**：多工具并行编排 + 对比推理正是模型强项；单设备工具只能给你两堆数字，模型能给出「为什么不同」的结论。
- **依托机制**：subagent 并行 / workflow 编排 + 现有快照解析器。
- **成本**：中。状态：待开发。

### ⑧ 定时巡检看护 — 时间维度

- **使用场景**：夜班 soak 测试后早上看结论：定时跑 perf_baseline compare + 崩溃扫描，检出回归时 agent 自动深挖（拉 logcat 窗口）并以会话轮次汇报：「2:00-6:00 内存涨 15%，来源是这条泄漏链」。
- **为什么在 harness 插件上有价值**：adb 从「查询工具」变成「看门狗」：harness 的 schedule/automation 让无人值守检测带解释闭环，不是半夜发个数字。
- **依托机制**：schedule_create 会话交付工具（packages/schedule）或 dsh-automation 定时任务。
- **成本**：中（host 编排工具 + 定时 prompt 模板）。状态：待开发。

### ⑨ 操作回滚台账 — 沉淀复用

- **使用场景**：agent 装了新 build 发现更糟，用户说「回到上一个版本」。插件记录每次 push/install/卸载/替换 APK 的操作台账，agent 据此回滚。
- **为什么在 harness 插件上有价值**：harness 有持久化存储；把设备操作变成可审计、可回滚的事务，对「agent 自主改设备」是信任基础——没有台账，agent 不敢动设备。
- **依托机制**：现有基线存储模式（baselineDir JSON）+ 操作日志工具。
- **成本**：小-中。状态：待开发。

---

## 延伸（暂缓）

- **调试流水线导出**：把一次成功的 adb 操作序列从会话 tool-call 历史导出为 automation 任务，白天交互式复现 → 晚上无人值守复跑。
- **agent preset 封装**：一个「设备 QA agent」preset（adb 工具 + crash skill + 面板），一条命令给新同事完整的设备调试能力。
- **反向标注**：agent 分析 logcat 后把根因行高亮回面板，用户能直观看到「模型认为哪几行是问题」。

## 实现纪律

- **提交即测**：每个功能落地时配套单测（假 adb 后端注入），全量跑绿后提交。
- **发布节奏**：GUI 验收通过后发布 npm（当前 v1.2.0 待验收）。
- **顺序**：按成本从低到高滚动（②③ 依赖视觉模型路由就绪；⑤ 最小成本先做）。
