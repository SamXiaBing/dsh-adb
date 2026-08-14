# dsh-adb

> ADB 设备·台架运维工具集 for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

让 DSH agent 直接操作 Android 设备 / 车机台架：设备发现、结构化 logcat、apk 安装、文件 pull/push、性能快照。面向实车与台架联调场景，业务内通用（不限 Unity、不限具体车机协议）。

## 安装

```sh
dsh plugin --profile web add dsh-adb
```

（v0.1 尚未发布，见 [PLAN.md](PLAN.md) 里程碑）

## 工具（v0.1 规划）

- `adb_devices` — 设备列表（serial/state/型号/版本）
- `adb_connect` / `adb_disconnect` — 无线台架连接
- `adb_logcat` — 过滤 + 后台采集
- `adb_install` — apk 安装
- `adb_file` — pull/push/ls/rm
- `adb_perf_snapshot` — meminfo/gfxinfo/帧率快照

## 配置

| 键 | 说明 | 默认 |
| --- | --- | --- |
| `adbPath` | adb 可执行文件路径 | 自动探测 |
| `defaultSerial` | 默认设备 serial | 无 |
| `timeoutMs` | 命令超时 | 30000 |

## 开发

```sh
pnpm install
pnpm build       # tsup → lib/
pnpm test        # vitest（解析器单测 + mock 回放）
```

## License

MIT
