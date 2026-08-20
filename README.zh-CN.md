# dsh-adb

> ADB 设备·台架运维工具集 for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) | 简体中文

让 DSH agent 直接操作 Android 设备 / 车机台架：设备发现、结构化 logcat、apk 安装、文件 pull/push、性能快照、一键体检。面向实车与台架联调场景，业务内通用（不限 Unity、不限具体车机协议）。

## 安装

```sh
dsh plugin --profile web add dsh-adb
```

或从 GitHub 直装：`dsh plugin --profile web add github:SamXiaBing/dsh-adb`

## Web 设备面板（v1.2.0）

会话视图页签「设备」（与 chat/轨迹/任务管理并列）：设备列表/状态、包名下拉自动补全、实时 logcat 窗口（级别/关键字/包名/pid 过滤、暂停/清空/自动滚动）、设备信息卡、进程列表、性能快照、**一键体检**（设备信息 + Top RSS 进程 + 崩溃缓冲 + W/E/F 日志 + 存储用量，落盘到 `reportDir`，可一键发送到对话诊断）。体检报告先做**证据→信号**提炼再交给 agent：崩溃按签名分类（真实崩溃+堆栈链 / MediaTek 启动标记 / 其他）、W/E/F 按 tag 聚合（计数+样本行）、插件自产健康摘要（verdict + issues）——agent 从结论出发而非从 17k 行原始日志出发。harness 协同：logcat/快照/体检报告**一键发送到对话**、面板顶部实时显示 agent 的 adb 操作、注册 **crash-analysis 技能**（`dsh-adb-crash-analysis`）供自动化流水线使用。数据走 Package RPC；需装入 web profile 并重启 GUI 生效（一键重启见 `scripts/restart-web.ps1`）。

## 生态收录

- ✅ [npm](https://www.npmjs.com/package/dsh-adb) — `dsh-adb` 已发布（latest: 1.1.0）
- ✅ [awesome-deepseek-harness#87](https://github.com/0xsline/awesome-deepseek-harness/pull/87) — **已合并**
- ✅ [awesome-dsh-plugin#85](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/85) — **已合并**
- ✅ [awesome-DSH-plugin#29](https://github.com/Alex-Yanggg/awesome-DSH-plugin/pull/29) — **已合并**

Topics：`dsh-plugin` `dsh` `adb` `android` `automotive` `bench`

## 工具

| 工具 | 说明 |
| --- | --- |
| `adb_devices` | 列出设备（serial/state/product/model），先发现再操作 |
| `adb_connect` / `adb_disconnect` | 无线台架连接（host:port，默认 5555） |
| `adb_logcat` | 过滤读取（tag/级别/关键字/时间窗/tail）；`run_in_background` 后台连续采集，job_output 读增量、job_kill 停止 |
| `adb_install` | 安装 apk（-r/-d/-g 选项），校验本地文件存在 |
| `adb_file` | pull / push / ls / rm，设备隔离 |
| `adb_perf_snapshot` | `dumpsys meminfo / gfxinfo / battery` 结构化快照（PSS/帧率百分位/卡顿率/电量） |
| `adb_perf_baseline` | 性能回归：快照存基线（label/tags）、与当前状态数值对比（PSS/卡顿率/百分位）、list/delete（本地存储，`baselineDir`） |
| `adb_crash_report` | 崩溃现场一键采集：crash buffer 解析 + dropbox 摘录 + 进程状态 + 内存摘要 |
| `adb_device_report` | 一键体检：设备信息 + Top RSS 进程 + 崩溃缓冲（真实崩溃带堆栈/启动标记分类）+ W/E/F 日志按 tag 聚合 + 存储用量 + 健康结论；每节独立降级；落盘到 `reportDir` |

错误码：`ADB_NOT_FOUND`、`ADB_UNAVAILABLE`、`DEVICE_NOT_FOUND`、`NO_DEVICES`、`CONNECT_FAILED`、`INSTALL_FAILED`、`ADB_EXIT_<code>` 等，均为结构化 `AdbError`。

## 配置

`cordis.patch.yml` 的 `config` 块（或 profile patch）：

```yaml
- id: dsh-adb
  name: dsh-adb
  config:
    adbPath: C:\Users\me\AppData\Local\Android\Sdk\platform-tools\adb.exe
    defaultSerial: emulator-5554
    timeoutMs: 30000
```

| 键 | 说明 | 默认 |
| --- | --- | --- |
| `adbPath` | adb 可执行文件绝对路径 | 自动探测 PATH / ANDROID_HOME / ANDROID_SDK_ROOT/platform-tools |
| `defaultSerial` | 默认设备 serial | 无 |
| `timeoutMs` | 命令超时 | 30000 |
| `baselineDir` | `adb_perf_baseline` 基线存储目录 | `~/.dsh/storages/dsh-adb` |
| `reportDir` | `adb_device_report` 体检报告存储目录 | `<baselineDir>/reports` |

## 开发

```sh
npm install            # 本机 NODE_ENV=production 时加 --include=dev
npm run build          # tsc → lib/
npm test               # 解析器/错误分类单测（node --test）
npm pack --dry-run     # 校验发布包内容（lib/ + cordis.patch.yml）
```

注意：本机若设了 `NODE_ENV=production`，npm 会跳过 devDependencies，安装时用 `npm install --include=dev`。

## 测试与验证

- 原则：**提交即测** —— 全部已提交功能均有实测覆盖（单元 + headless 端到端 + 车机台架/真机）。
- 验证设备：Android 13 车机台架 + Android 13 真机。
- 版本化变更与每版验证记录见 [CHANGELOG.md](CHANGELOG.md)；测试方法与覆盖现状见 [docs/TESTING.md](docs/TESTING.md)。

## 项目文档（双语，供 AI 对话/协作者参考）

- [docs/AGENTS.md](docs/AGENTS.md) / [docs/AGENTS.en.md](docs/AGENTS.en.md) — 进项目先读：定位、铁律、命令、环境事实、文档地图
- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) / [docs/REQUIREMENTS.en.md](docs/REQUIREMENTS.en.md) — 目的/范围/非目标/验收标准
- [docs/TESTING.md](docs/TESTING.md) / [docs/TESTING.en.md](docs/TESTING.en.md) — 测试哲学（提交即测）、三层测试方法、E2E 步骤、回归清单
- [docs/DEVELOPMENT-LOG.md](docs/DEVELOPMENT-LOG.md) / [docs/DEVELOPMENT-LOG.en.md](docs/DEVELOPMENT-LOG.en.md) — 进度时间线、4 个已修复 bug 教训、环境/生态经验
- [docs/ROADMAP.md](docs/ROADMAP.md) — harness×adb 协同功能路线图（诊断报告/崩溃归因/截图视觉/台架自动化测试/等待原语/审批/多设备对比/定时巡检/回滚台账）
- [PLAN.md](PLAN.md) / [PLAN.en.md](PLAN.en.md) — 里程碑与待办

## License

MIT
