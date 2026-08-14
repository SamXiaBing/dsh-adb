# dsh-adb Development & Release Plan

[简体中文](PLAN.md) | English

> ADB device & bench operations — DeepSeek Harness third-party plugin (bundle)
> Status: M0 ✅ M1 ✅ M2 ✅ M3 ✅ M4 ✅ (current release: v0.1.5)

## Progress

- **M0 (done)**: scaffold + plan + git init + build verification (tsc)
- **M1 (done)**: adb execution layer + seven tools + parser unit tests (8 green)
- **M2 (done)**: GitHub repo `SamXiaBing/dsh-adb` (SSH:22 + 6 topics: dsh-plugin/dsh/adb/android/automotive/bench); three catalog PRs — 0xsline#87 ✅ merged, awesome-dsh-plugin#85 ✅ merged, Alex-Yanggg#29 ⏳ pending; npm `dsh-adb` published
- **M3 (done)**: bench end-to-end smoke (Android 13 automotive bench) — all 7 tools verified; found & fixed two shipped bugs (0.1.1 missing `inject: ['tools']`, 0.1.2 background logcat jobs string contract)
- **M4 (done)**: Android 13 phone retest — fixed 0.1.3 (DEVICE_NOT_FOUND classification), 0.1.4 (battery package arg); closed all environment gaps (real battery data, positive wireless connect); "ship only what is tested" achieved
- Environment notes: `NODE_ENV=production` skips devDeps (use `--include=dev`); sandbox EPERM blocks pnpm spawns (use npm + tsc); GitHub direct connections intermittently time out (push via `ssh://git@github.com:22/`)

## 1. Why (positioning)

Chosen after correcting from "domain-knowledge moat" to "generic-within-a-domain scenario"; meets all four criteria:

| Criterion | Rationale |
| --- | --- |
| Scenario-anchored | on-vehicle / bench debugging is the most frequent, time-consuming workflow (dev/test/QA share it) |
| Generic within the domain | multi-role, multi-project; no Unity, no vendor protocol; any Android/embedded device |
| Self-sufficient | the plugin encapsulates adb; the agent needs no domain expertise |
| Composable | works with ctx.jobs (background), GenUI (device panel), settings (config) |

**Market gap**: 129+ third-party plugins had no adb class; first-party only had generic shell (text output, Windows quoting pitfalls, no structured long-running collection).

## 2. Scope

### v0.1 (MVP, shipped)

Seven tools (host-side, `ctx.tools`, JSON schema, no UI):

1. `adb_devices` — structured device enumeration (serial/state/model)
2. `adb_connect` / `adb_disconnect` — wireless bench connect (host:port)
3. `adb_logcat` — tag/level/keyword/time-window filters; `run_in_background` via ctx.jobs with incremental reads
4. `adb_install` — apk path + target + `-r`/`-d` flags
5. `adb_file` — pull/push/ls/rm, per-device isolation
6. `adb_perf_snapshot` — dumpsys meminfo/gfxinfo/battery summaries

Config: `adbPath` (absolute; auto-detect PATH/ANDROID_HOME/ANDROID_SDK_ROOT/platform-tools), `defaultSerial`, `timeoutMs` (default 30000).

Platforms: Windows / macOS / Linux; executes adb via `ctx.subprocess` (no shell layer). Degradation: ADB_NOT_FOUND with install guidance; empty device list, not an error; DEVICE_NOT_FOUND for a missing target.

### v1.0 candidates (on demand)

- `adb_screenshot` / `adb_screenrecord`
- Performance baseline comparison (multi-version gfxinfo diff + chart report)
- Client device panel (Slot: device list/status + logcat stream + snapshot diff charts)
- `am start -W` cold-start timing
- Multi-device bench session management

### Explicit non-goals

- No vehicle business protocol parsing (SR / perception / SOME-IP etc.) — domain skills' job
- No GUI automation / click injection (dsh-computer-use covers desktop)
- No Unity / vendor binding

## 3. Architecture

```
dsh-adb/
├── package.json        # dsh.bundle manifest (patch: ./cordis.patch.yml)
├── cordis.patch.yml    # plugin row: - insert: [{id: dsh-adb, name: dsh-adb}]
├── src/
│   ├── index.ts        # namespace exports name/inject/Config/apply (no default export)
│   ├── adb.ts          # adb locate + execute (subprocess, timeout, exit code, error normalization)
│   ├── parsers/        # logcat / meminfo / gfxinfo / battery parsers (pure functions)
│   └── tools/          # one file per tool
└── docs/research/      # ecosystem research material (market evidence)
```

- Build: `tsc` (single process, no bundler); publish prebuilt `lib/`
- Background collection follows the jobs producer contract
- Tests: pure-function unit tests + headless E2E (see docs/TESTING.md)

## 4. GitHub management

- Repo: `dsh-adb` (public), ecosystem naming (`dsh-*`)
- Topics: `dsh-plugin`, `dsh`, `adb`, `android`, `automotive`, `bench`
- Branch: `main` + milestone tags (v0.1.x)

## 5. Publishing to the DSH plugin market (the real channels)

1. GitHub public + `#dsh-plugin` topic (discovery)
2. npm publish (prebuilt `lib/`, no allowBuilds; name checked)
3. PRs to the three catalogs: `awesome-dsh-plugin` / `awesome-deepseek-harness` / `Alex-Yanggg/awesome-DSH-plugin`
4. Bilingual README + one-line install + optional GIF demo
5. Ecosystem hygiene: `dsh-plugin-check` health check; `dsh.bundle` declared; prebuilt artifacts

## 6. Milestones

| Milestone | Content | Date |
| --- | --- | --- |
| M0 | scaffold + plan + git init (local) | week 1 |
| M1 | seven tools + unit tests | week 1-2 |
| M2 | release: npm + GitHub (public + topics) + catalog PRs | week 2-3 |
| M3/M4 | bench + phone E2E smoke, 4 bug fixes | 2026-08-14 |
| M5 | v1.0: baseline comparison + device panel | on demand |

## 7. Backlog / open items

- [x] GitHub auth (SSH:22), repo creation + push + topics
- [x] npm publish (`dsh-adb@0.1.5` latest)
- [x] bench/phone smoke: devices → logcat → install → perf full chain (incl. battery real data, positive wireless connect)
- [ ] PR #29 (Alex-Yanggg) merge
- [ ] v1.0 candidates (above)
- [ ] Revoke publish tokens once releases settle
