# dsh-adb

> ADB 设备·台架运维工具集 for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

让 DSH agent 直接操作 Android 设备 / 车机台架：设备发现、结构化 logcat、apk 安装、文件 pull/push、性能快照。面向实车与台架联调场景，业务内通用（不限 Unity、不限具体车机协议）。

## 安装

```sh
dsh plugin --profile web add dsh-adb
```

或从 GitHub 直装：`dsh plugin --profile web add github:SamXiaBing/dsh-adb`

## 生态收录

- ✅ [npm](https://www.npmjs.com/package/dsh-adb) — `dsh-adb@0.1.0` 已发布（2026-08-14）
- ✅ [awesome-deepseek-harness#87](https://github.com/0xsline/awesome-deepseek-harness/pull/87) — **已合并**
- ✅ [awesome-dsh-plugin#85](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/85) — **已合并**
- ⏳ [awesome-DSH-plugin#29](https://github.com/Alex-Yanggg/awesome-DSH-plugin/pull/29) — 待合并

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

## 开发

```sh
npm install            # 本机 NODE_ENV=production 时加 --include=dev
npm run build          # tsc → lib/
npm test               # 解析器/错误分类单测（node --test）
npm pack --dry-run     # 校验发布包内容（lib/ + cordis.patch.yml）
```

注意：本机若设了 `NODE_ENV=production`，npm 会跳过 devDependencies，安装时用 `npm install --include=dev`。

## 真机/台架冒烟（2026-08-14，SA_DIREWOLF_IVI 台架，Android 13）

headless profile 端到端验证（`dsh --profile bench "任务"`），**7 个工具全部实测通过**：

| 工具 | 实测结果 |
| --- | --- |
| `adb_devices` | ✅ 返回 `f20c9b04 device msmnile_gvmq_for_arm64` |
| `adb_connect` / `adb_disconnect` | ✅ 不可达端点正确返回 CONNECT_FAILED；disconnect 正常 |
| `adb_logcat`（前向） | ✅ level=E tail=5 返回真实错误日志 |
| `adb_logcat`（后台采集） | ✅ job_output 读回 43065 行/7MB 流，job_kill 正常 |
| `adb_install` | ✅ pull 真机 apk → `install -r` → "Performing Streamed Install / Success" |
| `adb_file` | ✅ ls / push / pull 往返字节一致 |
| `adb_perf_snapshot` | ✅ meminfo（SystemUI PSS 131MB）+ gfxinfo（232 帧/60.78% 卡顿）解析正确；battery 空（台架无电池服务） |

配置覆盖（`adbPath`/`defaultSerial`）✅ · 错误码（`ADB_NOT_FOUND`/`CONNECT_FAILED`）✅

> 冒烟发现并修复四个已发布 bug：
> - **v0.1.0 → v0.1.1**：`ctx.tools.register` 未声明 `inject: ['tools']` 导致加载失败（Cordis Guard 拒绝未声明依赖）
> - **v0.1.1 → v0.1.2**：后台 logcat 的 `readOutput` 返回 `{added,text}` 对象，违反 jobs 契约（须返回字符串）导致 `job_output` 报 `value.text must be a string`
> - **v0.1.2 → v0.1.3**：`DEVICE_NOT_FOUND` 分类只匹配带 `error:` 前缀的 adb 输出，真实输出 `adb.exe: device 'X' not found` 落入通用 `ADB_EXIT_1`
> - **v0.1.3 → v0.1.4**：`adb_perf_snapshot` 对 battery 也传了包名，而 `dumpsys battery` 不接受包名参数（返回 "Unknown command"），导致电池数据永远解析为空

## 测试覆盖率矩阵（v0.1.4）

验证设备：SA_DIREWOLF_IVI 台架（Android 13）+ Redmi K50 Pro / 22011211C（真机，Android 13）

| 功能 | 单元测试 | 端到端实测 |
| --- | --- | --- |
| `adb_devices` | ✅ 解析器 | ✅ 台架 + 手机 |
| `adb_connect` 失败路径 | ✅ 分类器 | ✅ 台架不可达 → CONNECT_FAILED |
| `adb_connect` 成功路径 | - | ✅ 手机无线 192.168.1.193:5555 连接成功 |
| `adb_disconnect` | - | ✅ 断开正常 |
| `adb_logcat` 前向（level/tail） | ✅ 解析器+过滤 | ✅ |
| `adb_logcat` tag/keyword 过滤 | ✅ 过滤助手 | ✅（tag+keyword 均正向命中） |
| `adb_logcat` 后台采集 | - | ✅ job_output 读回 43065 行/7MB，job_kill 正常 |
| `adb_install` 成功 | - | ✅ install -r Success |
| `adb_install` 失败（LOCAL_FILE_NOT_FOUND/INSTALL_FAILED） | ✅ 分类器 | ✅ 伪 apk → INSTALL_PARSE_FAILED_NOT_APK |
| `adb_file` ls / ls -lR / push / pull / rm | - | ✅ 全操作实测（往返字节一致） |
| `adb_perf_snapshot` meminfo | ✅ 解析器 | ✅ 台架 + 手机（PSS/Heap/Graphics） |
| `adb_perf_snapshot` gfxinfo | ✅ 解析器 | ✅ 帧率/卡顿/百分位 |
| `adb_perf_snapshot` battery | ✅ 解析器 | ✅ 手机实数据（100%/charging/45.4°C） |
| 配置 adbPath/defaultSerial | - | ✅ 覆盖生效 |
| 错误码 ADB_NOT_FOUND/DEVICE_NOT_FOUND/NO_DEVICES/CONNECT_FAILED/INSTALL_FAILED | ✅ 分类器 | ✅ 实测/确定性验证 |

**原则：提交即测。** 全部已提交功能均有实测覆盖。

## License

MIT
