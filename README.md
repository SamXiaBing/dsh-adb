# dsh-adb

> ADB 设备·台架运维工具集 for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

让 DSH agent 直接操作 Android 设备 / 车机台架：设备发现、结构化 logcat、apk 安装、文件 pull/push、性能快照。面向实车与台架联调场景，业务内通用（不限 Unity、不限具体车机协议）。

## 安装

```sh
dsh plugin --profile web add dsh-adb
```

> v0.1 发布前可从 GitHub 直装：`dsh plugin --profile web add github:SamXiaBing/dsh-adb`

## 生态收录（PR 已提交，待合并）

- [awesome-deepseek-harness#87](https://github.com/0xsline/awesome-deepseek-harness/pull/87)
- [awesome-dsh-plugin#85](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/85)
- [awesome-DSH-plugin#29](https://github.com/Alex-Yanggg/awesome-DSH-plugin/pull/29)

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

## License

MIT
