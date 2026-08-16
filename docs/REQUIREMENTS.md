# 需求与范围（REQUIREMENTS.md）

## 目的

dsh-adb 让 DSH agent 直接操作 Android 设备/车机台架：设备发现、日志采集、安装、文件传输、性能快照。面向实车/台架联调场景，把「agent 能调 adb」从文本 shell 提升为结构化、可组合的语义工具。

## 定位：四条标准（选型依据）

1. **场景锚定**：对应一个真实反复出现的工作流（联调/提测/性能回归），而非一个技术点。
2. **业务内较通用**：一个团队多角色（开发/测试/QA）、多项目可用；不限 Unity、不限具体车机协议。
3. **能力自足**：插件自己封装 adb，agent 不需要先成为领域专家。
4. **可组合**：与 ctx.jobs（后台采集）、配置覆盖、错误码体系拼装。

明确不做的方向（防蔓延）：具体车机业务协议解析（SR/感知物/SOME-IP——那是领域 skill 的职责）、GUI 自动化/点击注入、绑定单一厂商/引擎。

## 范围

### v0.1（已交付，当前 v0.1.4）

七个工具（全部 host 侧，`ctx.tools` 注册，JSON schema）：

| 工具 | 能力 | 关键语义 |
| --- | --- | --- |
| `adb_devices` | 设备列表 | 返回结构化设备数组（serial/state/product/model/transport） |
| `adb_connect` | 无线连接 | host+port（默认 5555）；失败返回 CONNECT_FAILED |
| `adb_disconnect` | 断开无线 | 不传 host 断开全部 |
| `adb_logcat` | 日志读取/采集 | 过滤：tag/level/keyword/since/until/tail；`run_in_background` 挂 ctx.jobs 后台流式采集 |
| `adb_install` | apk 安装 | 本地文件先校验（LOCAL_FILE_NOT_FOUND）；-r/-d/-g 选项 |
| `adb_file` | 文件操作 | pull/push/ls(-lR)/rm；push 校验本地存在 |
| `adb_perf_snapshot` | 性能快照 | meminfo/gfxinfo 需包名；battery 是设备全局、**不得传包名** |
| `adb_perf_baseline` | 性能基线（v0.2） | save 存快照（label/tags）；compare 数值 diff；list/delete；本地 JSON 存储（`baselineDir`） |
| `adb_crash_report` | 崩溃现场（v0.2） | crash buffer（解析条目）+ dropbox 摘录 + 进程摘录 + 可选 meminfo；`since`/`tail` 控制 |

配置（`Config` schema，cordis.patch.yml 可覆盖）：`adbPath`（绝对路径，缺省自动探测 PATH/ANDROID_HOME/ANDROID_SDK_ROOT）、`defaultSerial`、`timeoutMs`（默认 30000）、`baselineDir`（基线存储，缺省 `~/.dsh/storages/dsh-adb`）。

错误码（模型可见契约，稳定）：`ADB_NOT_FOUND`、`ADB_UNAVAILABLE`、`ADB_CONFIG_INVALID`、`ADB_LAUNCH_FAILED`、`ADB_KILLED`、`DEVICE_NOT_FOUND`、`NO_DEVICES`、`CONNECT_FAILED`、`ADB_DEVICE_CLOSED`、`INSTALL_FAILED`、`LOCAL_FILE_NOT_FOUND`、`ARGS_INVALID`、`JOBS_UNAVAILABLE`、`ADB_EXIT_<code>`（兜底）。

### v1.0 候选（未排期，按需）

- Client 设备面板（Slot：设备列表/状态 + logcat 流 + 快照对比图）
- `adb_screenshot` / `adb_screenrecord`
- `am start -W` 冷启动耗时

### 明确不做

- 车机业务协议解析（SR/感知物/SOME-IP/MMKV 等）——领域 skill 的职责
- GUI 自动化 / 点击注入（生态已有 dsh-computer-use 类）
- 绑定 Unity / 单一厂商

## 验收标准（每工具）

- 成功路径：返回结构化 JSON（字段见工具 schema），模型可直接消费。
- 失败路径：抛 `AdbError`，错误码稳定可枚举，消息含可操作的修复指引（如 ADB_NOT_FOUND 提示配置 adbPath）。
- 降级：adb 缺失 → ADB_NOT_FOUND；无设备 → 空列表非报错；设备不存在 → DEVICE_NOT_FOUND。
- 后台路径：`run_in_background` 返回 job id；`job_output` 能读回流式输出；`job_kill` 能终止；`readOutput` 返回字符串。

## 生态目标（已达成/在途）

- GitHub public + `#dsh-plugin` 等 6 个话题标签 ✅
- npm 发布 `dsh-adb`（latest）✅
- 三份社区清单 PR：0xsline#87 ✅合并、awesome-dsh-plugin#85 ✅合并、Alex-Yanggg#29 ⏳待合并
- 任何用户可 `dsh plugin --profile web add dsh-adb` 一行安装 ✅
