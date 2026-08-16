# dsh-adb

> ADB device & bench operations for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

Give DSH agents direct control over Android devices and automotive bench rigs: device discovery, structured logcat, APK install, file pull/push, and performance snapshots. Built for on-vehicle and bench debugging workflows — generic within the domain (no Unity, no vendor protocol lock-in).

**English** | [简体中文](README.zh-CN.md)

## Install

```sh
dsh plugin --profile web add dsh-adb
```

Or install directly from GitHub: `dsh plugin --profile web add github:SamXiaBing/dsh-adb`

## Ecosystem

- ✅ [npm](https://www.npmjs.com/package/dsh-adb) — `dsh-adb` published (latest: 0.1.5)
- ✅ [awesome-deepseek-harness#87](https://github.com/0xsline/awesome-deepseek-harness/pull/87) — **merged**
- ✅ [awesome-dsh-plugin#85](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/85) — **merged**
- ✅ [awesome-DSH-plugin#29](https://github.com/Alex-Yanggg/awesome-DSH-plugin/pull/29) — **merged**

Topics: `dsh-plugin` `dsh` `adb` `android` `automotive` `bench`

## Tools

| Tool | Description |
| --- | --- |
| `adb_devices` | List devices (serial/state/product/model); run first to discover serials |
| `adb_connect` / `adb_disconnect` | Wireless bench connection (host:port, default 5555) |
| `adb_logcat` | Filtered read (tag/level/keyword/time-window/tail); `run_in_background` streams continuously as a job — read deltas with `job_output`, stop with `job_kill` |
| `adb_install` | Install APKs (`-r`/`-d`/`-g` options); validates the local file exists |
| `adb_file` | pull / push / ls / rm, per-device isolation |
| `adb_perf_snapshot` | Structured `dumpsys meminfo / gfxinfo / battery` snapshots (PSS, frame percentiles, jank rate, battery) |
| `adb_perf_baseline` | Perf regression: save a snapshot as a baseline (label/tags), compare current state and get a numeric diff (PSS, janky %, percentiles), list/delete baselines (stored locally under `baselineDir`) |
| `adb_crash_report` | One-call crash scene: parsed logcat crash buffer + dropbox excerpt + process state + memory summary |

Errors are structured `AdbError` with stable codes: `ADB_NOT_FOUND`, `ADB_UNAVAILABLE`, `DEVICE_NOT_FOUND`, `NO_DEVICES`, `CONNECT_FAILED`, `INSTALL_FAILED`, `ADB_EXIT_<code>`, etc.

## Configuration

Set the `config` block in `cordis.patch.yml` (or a profile patch):

```yaml
- id: dsh-adb
  name: dsh-adb
  config:
    adbPath: C:\Users\me\AppData\Local\Android\Sdk\platform-tools\adb.exe
    defaultSerial: emulator-5554
    timeoutMs: 30000
```

| Key | Description | Default |
| --- | --- | --- |
| `adbPath` | Absolute path to the adb executable | Auto-detect PATH / ANDROID_HOME / ANDROID_SDK_ROOT/platform-tools |
| `defaultSerial` | Default target device serial | none |
| `timeoutMs` | Per-command timeout | 30000 |
| `baselineDir` | Directory for `adb_perf_baseline` storage | `~/.dsh/storages/dsh-adb` |

## Development

```sh
npm install            # add --include=dev when NODE_ENV=production
npm run build          # tsc → lib/
npm test               # parser/classification unit tests (node --test)
npm pack --dry-run     # verify publish contents (lib/ + cordis.patch.yml)
```

## Testing & Verification

- Principle: **ship only what is tested** — every committed feature has unit and/or end-to-end coverage.
- Verified on: Android 13 automotive bench + Android 13 phone.
- Per-version changes and verification: [CHANGELOG.md](CHANGELOG.md); test methodology and coverage: [docs/TESTING.md](docs/TESTING.md) (Chinese).

## Project Docs (bilingual; for AI agents & contributors)

- [docs/AGENTS.md](docs/AGENTS.md) / [docs/AGENTS.en.md](docs/AGENTS.en.md) — read first: purpose, rules, commands, environment facts, doc map
- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) / [docs/REQUIREMENTS.en.md](docs/REQUIREMENTS.en.md) — purpose / scope / non-goals / acceptance criteria
- [docs/TESTING.md](docs/TESTING.md) / [docs/TESTING.en.md](docs/TESTING.en.md) — testing philosophy, three test layers, E2E steps, regression checklist
- [docs/DEVELOPMENT-LOG.md](docs/DEVELOPMENT-LOG.md) / [docs/DEVELOPMENT-LOG.en.md](docs/DEVELOPMENT-LOG.en.md) — timeline, fixed-bug lessons, environment & ecosystem notes
- [PLAN.md](PLAN.md) / [PLAN.en.md](PLAN.en.md) — milestones & backlog

## License

MIT
