# 更新日志（CHANGELOG）

版本化变更与验证记录。测试方法与覆盖现状见 [docs/TESTING.md](docs/TESTING.md)；历史教训见 [docs/DEVELOPMENT-LOG.md](docs/DEVELOPMENT-LOG.md)。

## [0.2.0] - 2026-08-15

**Added**：
- `adb_perf_baseline`：性能基线管理（save/compare/list/delete）。save 存快照（label/tags）；compare 对当前状态做数值 diff（PSS/卡顿率/帧率百分位，含变化量与百分比）；基线存本地 JSON（`baselineDir` 配置，缺省 `~/.dsh/storages/dsh-adb`）。
- `adb_crash_report`：崩溃现场一键采集——logcat crash buffer（解析为结构化条目）+ dropbox 摘录 + 进程状态摘录 +（给包名时）内存摘要，按时间线组织。

**Changed**：`DEVICE_NOT_FOUND` 分类增加 `- waiting for device -` 匹配（无设备时 adb 的真实输出）。

**Verified**：单测 14 用例全绿（新增 diff 计算 / 存储生命周期 / 损坏文件处理）；headless 验证新工具注册与错误路径（list 返回空基线；save/crash 无设备时返回结构化 DEVICE_NOT_FOUND）。**happy path（真机）待接设备验证后发布**。

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
