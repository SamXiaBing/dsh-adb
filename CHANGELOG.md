# 更新日志（CHANGELOG）

版本化变更与验证记录。测试方法与覆盖现状见 [docs/TESTING.md](docs/TESTING.md)；历史教训见 [docs/DEVELOPMENT-LOG.md](docs/DEVELOPMENT-LOG.md)。

## [1.3.0] - 2026-08-20

**Added（等待原语，ROADMAP ⑤）**：
- **`adb_wait_for` 工具**：等待设备达到某条件再继续，替代盲目 sleep 固定秒数。条件：`device-online`（设备出现在 adb devices 且 state=device；不传 serial 时等任意设备上线）、`boot-complete`（`sys.boot_completed`=1）、`process`（`ps -A` 出现名称含 pattern 的进程）、`logcat-pattern`（主缓冲 tag/message 出现关键字）。轮询 `intervalMs`（默认 1s，最小 250ms）直到 `timeoutMs`（默认 30s，上限 300s）；**超时返回 `matched:false` 而非抛错**，agent 可对超时做反应；瞬时探测失败（设备中途离线）不终止，持续到预算。
- **agent 编排能力提升**：把「装 APK 后盲等 5 秒再抓快照」变成「等 com.example 进程出现后再抓快照」的确定性序列——是台架自动化测试④、崩溃归因②、定时巡检⑧的地基原语。

**Verified**：单测 68 全绿（新增 12 例：条件纯函数 4 + 轮询序列 8，含超时返回 matched:false、瞬时失败容忍、参数校验快速失败）。**真机验证通过（Redmi K50 Pro）**：device-online matched（1 次探测）、process（com.android.systemui）matched。已发布。

## [1.2.0] - 2026-08-19

**Added（一键体检，ROADMAP ①）**：
- **`adb_device_report` 工具**：一键采集设备信息（型号/厂商/版本/API/指纹/分辨率/内存）、Top RSS 进程、崩溃缓冲、W/E/F logcat 窗口、存储用量；每节独立降级（失败进 `errors`，不整体失败）；报告落盘到报告存储（`reportDir`，缺省 `<baselineDir>/reports`，`<serial>--<epoch>.json`）。
- **RPC `deviceReport` 端点**：面板「一键体检」按钮同源复用采集，结果含 `savedTo`。
- **面板「一键体检」**：采集摘要展示（体检结论/设备/真实崩溃数/日志噪音源/采集失败/保存位置）+「发送到对话」写入体检报告文本块（提示结合 crash-analysis 技能分析）。
- **`parseProcessList` 增加 `rss` 字段**（Android `ps -A` 第 4 列），体检按 RSS 排序取内存大户。
- **功能路线图文档 [docs/ROADMAP.md](docs/ROADMAP.md)**：9 条 harness×adb 协同功能（诊断报告/崩溃归因/截图视觉/台架自动化测试/等待原语/审批/多设备对比/定时巡检/回滚台账），每条含使用场景 + harness 独有价值 + 依托机制 + 成本。台架自动化测试（脚本执行 + AI 图像比对）按用户要求排在截图视觉之后。

**Evidence → Signal（评审改进，首次真机验收发现原始数字误导）**：
- **崩溃缓冲分类**：43 条里真实崩溃只有 1 条，其余是 MediaTek 启动标记——现按 `FATAL EXCEPTION / Fatal signal / SIG*` 识别真实崩溃（含同 pid 堆栈链），`mtk-brm-*` 等单列启动标记，不再把 43 当 43。
- **W/E/F 按 tag 聚合**：16987 条 → `AOSP-MdnsDiscoveryManag ×16200` 这类计数 + 每源一条样本行，噪音源一目了然。
- **健康摘要（插件自产）**：`verdict`（ok/attention）+ `lines`（设备/崩溃构成/日志来源/内存大户）+ `issues`（真实崩溃、网络异常信号等），agent 从结论出发而非从原始证据出发；PowerKeeper.Thermal 类解析噪音显式标注可忽略。
- 发送到对话的文本块同步改造：只带真实崩溃堆栈 + top 日志源样本，不再刷 17k 行。

**Verified**：单测 56 全绿（新增/重写：分类/聚合/摘要纯函数 5 例 + 采集集成 4 例 + 面板 formatReportBlock 2 例）。**真机验证通过（Redmi K50 Pro）**：43 崩溃→1 真实+9 启动标记+33 其他；13361 W/E/F→top 源 AOSP-MdnsDiscoveryManag×3264/System.err×1530/ActivityManagerWrapper×545；health.verdict=attention + 2 条具体 issue。**GUI 验收待用户刷新后确认**（体检结论/摘要/发送到对话）。

## [1.1.3] - 2026-08-19

**Added（i18n + 状态持久化）**：
- **中英文自适应**：面板文案全部接入字典（`ctx.locale.register('dsh-adb', {zh, en})`），跟随 harness 当前语言自动切换，无需手动开关；页签标签同源。
- **跨页签状态持久化**：面板状态（设备列表/选中设备/设备信息/包名/快照/进程/实时 logcat 全部过滤与暂停态）移入 `defineStore`（`@deepseek-ai/dsh-client-runtime/client`），切到对话再切回设备，页面状态原样保留。

**Verified**：单测 37 全绿（新增字典完整性 1 例：zh/en 键集一致且逐键非空）。**GUI 验收通过**（i18n 跟随语言、状态跨页签保留）。

## [1.1.0] - 2026-08-18

**Added（设备面板增强，对照 Android Studio 能力面）**：
- 包名输入改为**下拉 + 模糊搜索**自动补全（`pm list packages`）
- **实时 logcat 窗口**：1.5s 增量轮询（`logcatDelta` 按 since 只拉新增）、级别/关键字/进程/包名过滤、暂停/清空/自动滚动
- 设备信息卡（型号/厂商/Android/API/分辨率/内存总量）
- 进程列表（按包过滤，点击按 pid 过滤 logcat）
- **harness 协同（面板定位的核心）**：
  - 每段数据（logcat/快照）加「**发送到对话**」按钮 → 写入会话输入框，agent 接着分析（`inputActions.setDraft`）
  - **agent 的 adb 操作实时显示**在面板顶部（订阅会话快照的 tool-call 节点）
  - **崩溃分析 skill**（`dsh-adb-crash-analysis`，host 注册）：采集崩溃现场 → 结构化报告，可与 dsh-automation 组定时流水线
- **scripts/restart-web.ps1**：一键重启（杀 dsh web 进程树 → 重启 start-dsh-web.bat → 等服务就绪 → 打开页面）

**Review 调整**：按用户评审移除采样曲线/截图 UI（无协同价值，RPC 端点保留）；下拉改独立 query 态 + 显式对比色；关键字过滤旁加包名过滤。

**Verified**：单测 36 全绿（新增 panel 纯函数 4 例 + skill 3 例）。**GUI 验收通过**。

**Changed**：RPC 新增 6 个端点（listPackages/deviceInfo/processList/logcatDelta/screenshot/perfSample），`logcatTail` 保留兼容。

**Verified**：单测 29 全绿（新增 sysinfo 解析器 5 例 + RPC 新端点 5 例，假 adb 后端注入）。**GUI 验收通过**（验收后发布）。

## [1.0.0] - 2026-08-16

**Added**：
- **Web 设备面板**（client 半，`conversation.view` 页签「设备」，与任务管理并列）：设备列表/状态 + 包名输入 + 性能快照（内存/帧率/电量）+ logcat 过滤（级别/条数）。数据走 Package RPC（`/dsh-adb`：listDevices/perfSnapshot/logcatTail），Host 侧复用已验证的执行核心；headless 组合无 connection 时自动跳过 RPC，工具不受影响。
- `capturePerfSnapshot` 签名重构（exec → signal），工具/RPC 共用。

**Verified**：单测 20 用例全绿（含 RPC 端点 7 例：设备解析/错误信封/快照/日志过滤/未知端点，基于假 adb 后端注入）；headless 验证加载与错误路径；**Web GUI 真机验收通过**（设备页签显示、RPC 200）。

**Fixed（GUI 验收发现）**：
- `HTTP 405` 根因：`connection.rpc.handle(channel, handler, options)` 的 **options 是必填**（`{ authority: 'loopback' }` 信任策略），漏传导致内部 `options.authority` 抛 TypeError、路由未注册。同时把端点分发抽成 `handleRpcEndpoint`（导出、可单测），错误统一返回 `{ok:false, error:{message}}` 而非抛异常。
- Host 侧改用 `ctx.inject(['connection'], ...)` 等服务就绪再注册（headless 无 connection 自动跳过，工具不受影响）。

## [0.2.0] - 2026-08-15

**Added**：
- `adb_perf_baseline`：性能基线管理（save/compare/list/delete）。save 存快照（label/tags）；compare 对当前状态做数值 diff（PSS/卡顿率/帧率百分位，含变化量与百分比）；基线存本地 JSON（`baselineDir` 配置，缺省 `~/.dsh/storages/dsh-adb`）。
- `adb_crash_report`：崩溃现场一键采集——logcat crash buffer（解析为结构化条目）+ dropbox 摘录 + 进程状态摘录 +（给包名时）内存摘要，按时间线组织。

**Changed**：`DEVICE_NOT_FOUND` 分类增加 `- waiting for device -` 匹配（无设备时 adb 的真实输出）。

**Verified**：单测 14 用例全绿（新增 diff 计算 / 存储生命周期 / 损坏文件处理）；headless 验证新工具注册与错误路径（list 返回空基线；save/crash 无设备时返回结构化 DEVICE_NOT_FOUND）；**真机验证通过**（Redmi K50 Pro）：perf_baseline save→compare（15 字段 diff，渲染/电池近零、内存真实波动）→list→delete；crash_report 采集到真实 crash buffer 43 条；回归 9 工具无影响。已发布。

## [0.1.5] - 2026-08-14

**Changed**：作者身份统一为 SamXiaBing（package.json / LICENSE / 全部提交历史重写为 GitHub noreply 邮箱）。无代码变更。

## [0.1.4] - 2026-08-14

**Fixed**：`adb_perf_snapshot` 的 battery 指标误传包名（`dumpsys battery` 不接受包名参数，返回 "Unknown command"），导致电池数据永远解析为空 —— 现 battery 不传包名。

**Verified（Android 13 真机）**：battery 实数据（100% / charging / 45.4°C）；正向无线连接全流程（`adb_connect` 成功 → `adb_devices` 出现无线设备 → `adb_disconnect`）；meminfo 交叉验证。

## [0.1.3] - 2026-08-14

**Fixed**：`DEVICE_NOT_FOUND` 分类只匹配带 `error:` 前缀的输出，真实输出 `adb.exe: device 'X' not found` 落入通用 `ADB_EXIT_1` —— 正则放宽。

**Verified**：确定性验证 5 个核心错误码（DEVICE_NOT_FOUND 两种格式 / NO_DEVICES / CONNECT_FAILED / INSTALL_FAILED）；logcat tag 过滤正向命中。

## [0.1.2] - 2026-08-14

**Fixed**：后台 logcat 的 `readOutput` 返回 `{added,text}` 对象，违反 jobs 契约（须返回字符串），`job_output` 报 `value.text must be a string` —— 改为返回纯字符串。

**Verified**：后台采集全流程（job id → `job_output` 读回 43065 行/7MB → `job_kill` 终止）。

## [0.1.1] - 2026-08-14

**Fixed**：`ctx.tools.register` 未声明 `inject: ['tools']`，插件加载即失败（Cordis Guard 拒绝未声明服务访问）。

**Verified**：headless 组合加载 + 工具注册成功；`adb_devices`/`adb_perf_snapshot`/`adb_logcat` 台架 E2E。

## [0.1.0] - 2026-08-14

**Added**：七个工具（`adb_devices` / `adb_connect` / `adb_disconnect` / `adb_logcat` 前后台 / `adb_install` / `adb_file` / `adb_perf_snapshot`）；配置（`adbPath` / `defaultSerial` / `timeoutMs`）；错误码体系；解析器（devices / logcat / meminfo / gfxinfo / battery）。

**Known issues（随后版本修复）**：缺 `inject: ['tools']`；后台 logcat jobs 契约不符；DEVICE_NOT_FOUND 分类不全；battery 传参错误。
