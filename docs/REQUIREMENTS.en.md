# Requirements & Scope (REQUIREMENTS.md)

[简体中文](REQUIREMENTS.md) | English

## Purpose

dsh-adb lets a DSH agent operate Android devices and automotive bench rigs directly: device discovery, log collection, APK install, file transfer, performance snapshots. It targets on-vehicle / bench debugging workflows and raises "agent can run adb" from raw text shell output to structured, composable semantic tools.

## Positioning: four criteria (selection basis)

1. **Scenario-anchored**: maps to one real recurring workflow (debugging, release verification, perf regression), not a single technique.
2. **Generic within the domain**: usable across roles (dev/QA/test) and projects; no Unity, no vendor protocol lock-in.
3. **Self-sufficient**: the plugin encapsulates adb — the agent does not need to become a domain expert.
4. **Composable**: works with ctx.jobs (background collection), config overrides, and the error-code system.

Explicit non-goals (scope creep guard): vendor business-protocol parsing (SR/perception/SOME-IP — that belongs to domain skills), GUI automation / click injection, binding to a single vendor or engine.

## Scope

### v0.1 (shipped; current v0.1.5)

Seven tools (all host-side, registered via `ctx.tools`, JSON schema):

| Tool | Capability | Key semantics |
| --- | --- | --- |
| `adb_devices` | device list | structured array (serial/state/product/model/transport) |
| `adb_connect` | wireless connect | host+port (default 5555); failure → CONNECT_FAILED |
| `adb_disconnect` | wireless disconnect | no host = disconnect all |
| `adb_logcat` | log read/collect | filters: tag/level/keyword/since/until/tail; `run_in_background` streams via ctx.jobs |
| `adb_install` | APK install | local file checked first (LOCAL_FILE_NOT_FOUND); -r/-d/-g flags |
| `adb_file` | file operations | pull/push/ls(-lR)/rm; push validates local existence |
| `adb_perf_snapshot` | perf snapshot | meminfo/gfxinfo need a package; battery is device-global, **must not receive a package** |

Config (`Config` schema, overridable via cordis.patch.yml): `adbPath` (absolute; auto-detect PATH/ANDROID_HOME/ANDROID_SDK_ROOT), `defaultSerial`, `timeoutMs` (default 30000).

Error codes (model-visible contract, stable): `ADB_NOT_FOUND`, `ADB_UNAVAILABLE`, `ADB_CONFIG_INVALID`, `ADB_LAUNCH_FAILED`, `ADB_KILLED`, `DEVICE_NOT_FOUND`, `NO_DEVICES`, `CONNECT_FAILED`, `ADB_DEVICE_CLOSED`, `INSTALL_FAILED`, `LOCAL_FILE_NOT_FOUND`, `ARGS_INVALID`, `JOBS_UNAVAILABLE`, `ADB_EXIT_<code>` (fallback).

### v1.0 candidates (not scheduled, on demand)

- Performance baseline comparison (multi-version gfxinfo diff + report)
- Client device panel (Slot: device list/status + logcat stream + snapshot diff charts)
- `adb_screenshot` / `adb_screenrecord`
- `am start -W` cold-start timing

### Explicit non-goals

- Vehicle business protocol parsing (SR/perception/SOME-IP/MMKV etc.) — domain skills' job
- GUI automation / click injection (ecosystem has dsh-computer-use class)
- Binding to Unity / a single vendor

## Acceptance criteria (per tool)

- Success path: returns structured JSON (fields per tool schema) the model can consume directly.
- Failure path: throws `AdbError` with a stable enumerable code and an actionable message (e.g. ADB_NOT_FOUND suggests configuring adbPath).
- Degradation: missing adb → ADB_NOT_FOUND; no devices → empty list, not an error; missing target device → DEVICE_NOT_FOUND.
- Background path: `run_in_background` returns a job id; `job_output` reads the stream; `job_kill` terminates; `readOutput` returns a string.

## Ecosystem goals (done / in flight)

- GitHub public + 6 topics incl. `#dsh-plugin` ✅
- npm `dsh-adb` published (latest) ✅
- Three catalog PRs: 0xsline#87 ✅ merged, awesome-dsh-plugin#85 ✅ merged, Alex-Yanggg#29 ⏳ pending
- Anyone can install with `dsh plugin --profile web add dsh-adb` ✅
