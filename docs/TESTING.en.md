# Testing Requirements & Methodology (TESTING.md)

[简体中文](TESTING.md) | English

## Philosophy: ship only what is tested

**Every committed feature must have unit and/or end-to-end coverage; environment-limited items must be explicitly marked ⚠️ and never passed off as tested.**

This principle caught 4 shipped bugs during development (see DEVELOPMENT-LOG.md) — all of them invisible to pure unit tests and only triggered by real composition loading, the real tool pipeline, and real devices.

## Three test layers

### 1. Unit tests (node --test, currently 9 cases)

`test/parsers.test.mjs`: parsers (devices/logcat/meminfo/gfxinfo/battery), logcat filter helpers, and `classifyFailure` error classification (including the no-`error:`-prefix DEVICE_NOT_FOUND case).

```sh
npm test   # = npm run build && node --test "test/*.test.mjs"
```

### 2. Deterministic verification (for pure functions like error classification)

No model or device needed: run node directly against the **installed npm package** (`~/.dsh/profiles/bench/node_modules/dsh-adb/lib/adb.js`) and assert error codes with real adb stderr text. Used to verify the 0.1.3 DEVICE_NOT_FOUND fix. Note: the model sees the error **message** (a stderr excerpt), not the code — verifying codes requires this approach, not reading headless task output.

### 3. End-to-end smoke (headless + real device)

Full chain: npm install → bundle load → config override → tool registration → real adb call → parse → structured result → model consumption.

**Smoke environment (ready on this machine):**

1. adb: `D:\AIWorkSpace\platform-tools\adb.exe`
2. Smoke profile: `~/.dsh/profiles/bench`, bundles = `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless` + `dsh-adb`; `cordis.patch.yml` sets `adbPath`/`defaultSerial`
3. Model credentials: `DEEPSEEK_API_KEY` in `~/.dsh/.credentials.yaml` (**never write the value in docs**; inject into `$env:DEEPSEEK_API_KEY` before a headless run)
4. Device: USB-connected (USB debugging enabled and authorized)

**How to run:**

```powershell
$dsh = "$HOME\.dsh\profiles\node_modules\@deepseek-ai\dsh\lib\bin.js"
$key = (Select-String -Path "$HOME\.dsh\.credentials.yaml" -Pattern '^DEEPSEEK_API_KEY:\s*(.+)$').Matches[0].Groups[1].Value.Trim()
$env:DEEPSEEK_API_KEY = $key
node $dsh --profile bench "call adb_devices and report the result"
```

Notes:
- Upgrading the plugin in the profile: `node $dsh plugin --profile bench add "dsh-adb@<version>"` (pnpm intermittently EPERMs — retry; if it keeps failing, `npm install dsh-adb@<version> --no-save` into the profile's node_modules)
- Headless tasks can intermittently stall (flaky model responses): run them as background jobs or shrink the task; session logs live in `~/.dsh/sessions` (not in the profile dir)
- Wireless connect tests need the device in TCP mode first: `adb -s <serial> tcpip 5555` (`adb tcpip` temporarily drops the USB channel — standard adb behavior)

## Coverage matrix (current v0.1.5, all green)

Verified on: Android 13 automotive bench + Android 13 phone.

| Feature | Unit | E2E |
| --- | --- | --- |
| adb_devices | ✅ | ✅ bench + phone |
| adb_connect failure/success paths | ✅ classifier | ✅ CONNECT_FAILED on unreachable + wireless connect success on phone |
| adb_disconnect | - | ✅ |
| adb_logcat foreground (level/tail) | ✅ | ✅ |
| adb_logcat tag/keyword filters | ✅ | ✅ positive matches |
| adb_logcat background collection | - | ✅ job_output read 43k lines / 7MB |
| adb_install success/failure | ✅ classifier | ✅ Success + INSTALL_PARSE_FAILED_NOT_APK |
| adb_file ls/-lR/push/pull/rm | - | ✅ all operations |
| adb_perf_snapshot meminfo | ✅ | ✅ bench + phone |
| adb_perf_snapshot gfxinfo | ✅ | ✅ |
| adb_perf_snapshot battery | ✅ | ✅ real phone data |
| config overrides | - | ✅ |
| core error codes (5) | ✅ classifier | ✅ smoke/deterministic |

## Regression checklist (run after any code change)

1. `npm test` (all unit tests green)
2. Headless smoke: `adb_devices` + the changed tool's success and failure paths
3. If the execution layer / classifier changed: deterministic classifyFailure verification
4. If the background path changed: background logcat start/read/stop flow
5. Real-device (when bench/phone attached): battery real data + wireless connect positive
6. Before publishing: `npm pack --dry-run` confirms contents (lib/ + cordis.patch.yml + README + LICENSE)
