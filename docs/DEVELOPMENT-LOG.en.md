# Development Log & Lessons (DEVELOPMENT-LOG.md)

Records what happened and the lessons learned. Forward-looking plans live in PLAN.md.

[简体中文](DEVELOPMENT-LOG.md) | English

## Timeline

- **M0 (2026-08-14)**: Project kickoff. Position corrected from "domain-knowledge moat" to "generic-within-a-domain scenario" (the user rejected overly narrow ideas like SR geometry validation and proposed ADB bench operations as more generic). Scaffold (dsh.bundle + cordis.patch.yml + tsc build) + plan + git init + npm name `dsh-adb` availability check.
- **M1**: adb execution layer (locate/run/classify) + 7 tools + parser unit tests (8 cases green).
- **M2**: GitHub repo (SSH auth + topics) + three catalog PRs (0xsline#87 ✅, awesome-dsh-plugin#85 ✅, Alex-Yanggg#29 ⏳) + npm 0.1.0.
- **M3**: bench end-to-end smoke (Android 13 automotive bench) → caught bugs ①②, shipped 0.1.1/0.1.2; completed all 7 tools → caught bug ③, shipped 0.1.3.
- **M4 (phone retest)**: user plugged an Android 13 phone → caught bug ④ (battery), shipped 0.1.4; closed all remaining environment gaps (real battery data, positive wireless connect). "Ship only what is tested" achieved.

## The 4 shipped bugs (biggest source of lessons)

| # | Version | Found by | Symptom | Root cause | Fix | Prevent recurrence |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.1.0→0.1.1 | headless load | plugin crashes on load `cannot get property "tools" without inject` | `ctx.tools.register` without declaring `inject: ['tools']`; the Cordis Guard rejects undeclared service access | added `export const inject = ['tools']` | any `ctx.<svc>` must be in inject; optional services via `ctx.get` |
| 2 | 0.1.1→0.1.2 | background logcat smoke | `job_output` reports `value.text must be a string` | `readOutput()` returned a `{added,text}` object; the jobs contract requires a string | return `read.text` | read the jobs contract (tool-jobs source output schema) before writing producers |
| 3 | 0.1.2→0.1.3 | classification verification | bad serial fell to `ADB_EXIT_1` instead of `DEVICE_NOT_FOUND` | matcher required an `error:` prefix; real output is `adb.exe: device 'X' not found` | widened to `(?:error:\s*)?device ... not found` | write classifiers against real adb output; the model-visible message is unrelated to the code — verify codes deterministically |
| 4 | 0.1.3→0.1.4 | phone battery smoke | battery always empty `{}` | `dumpsys battery` takes no package argument (returns "Unknown command"); the perf tool passed a package for every metric | battery branch omits the package | verify dumpsys syntax for new metrics; "empty result" may be a tool argument bug, not missing device data |

Common lesson: **pure unit tests cannot cover the "composition load + real tool pipeline + real device" contract layer** (Guard, jobs serialization, dumpsys arguments, adb output variants). Hence "ship only what is tested" must include E2E.

## Environment & tooling lessons

- **Sandbox EPERM**: `pnpm` child spawns are blocked by the sandbox (documented boundary, cannot escalate — approvals disabled in this session). Workaround: use npm for build/install; `dsh plugin add` goes through pnpm and intermittently EPERMs — retry or `npm install --no-save` directly into the profile.
- **NODE_ENV=production**: this env var makes npm skip devDependencies. Always `npm install --include=dev`.
- **npm 11 arborist bug**: a dependency tree (unbuild/consola) triggered `Cannot read properties of null (reading 'matches')`. Workaround: dropped tsup/vitest, build with plain tsc (single process, no spawn — also sidesteps the sandbox EPERM).
- **GitHub network**: the `github.com/login/oauth/access_token` endpoint always times out from this machine (corporate network) — device-code auth is unusable; `api.github.com` is stable; github.com web intermittently flaky. Switched to SSH key auth (port 22 works).
- **git insteadof trap**: the global `url.https://github.com/.insteadof=ssh://git@github.com/` rewrites ssh URLs to https, breaking auth; `-c url.https://github.com/.insteadOf=` (empty value) turns into "replace empty prefix with https", prefixing every URL — the correct fix is an explicit `ssh://git@github.com:22/<repo>.git` remote (the rewrite rule doesn't match).
- **gh CLI**: `gh auth login --with-token` validation requires the `read:org` scope (a `repo`-scope token fails); using the `GH_TOKEN` env var skips validation (repo scope is enough). gh lives at `C:\Program Files\GitHub CLI\gh.exe`; background jobs' PATH may not include it.
- **npm publish**: with 2FA enabled, classic tokens are rejected (E403 requires bypass 2FA); a granular token with "Bypass 2FA when publishing" is required. Pass tokens as command arguments (`npm publish --//registry.npmjs.org/:_authToken=<token>`), never persist them.
- **Headless smoke essentials**: `dsh-base` is core infrastructure only (no agent loop) — a task run requires adding the `@deepseek-ai/dsh-headless` bundle; model credentials live in `~/.dsh/.credentials.yaml` (not settings.yaml); session logs live in `~/.dsh/sessions`.
- **pwsh tool boundaries**: every pwsh call is a fresh process (no persistent cwd — pass workdir or Set-Location inside the command); forgetting Set-Location drops clones into the default working directory (polluted the harness checkout once; cleaned).

## Ecosystem lessons (DSH third-party plugin market)

- Market shape: **no official central marketplace**. The real channels are the GitHub `#dsh-plugin` topic (discovery) + community catalogs (awesome-*) + npm bundles (install) + in-session tools like `dsh-find-plugin`. The official repository mechanism was removed (2026-08-11).
- The three catalogs are independently maintained with different formats: 0xsline (hand-maintained bilingual README), awesome-dsh-plugin (bilingual README + Chinese mirror site), Alex-Yanggg (`catalog/plugins.json` + a python script generating the Chinese mirror; empty categories are up for grabs).
- Plugin quality surface: `dsh.bundle` must be declared; bilingual README; one-line install; a real-device verification story is a strong plus (this project's 4-bug fix record became its best promo material).
- `dsh plugin add` from npm avoids build authorization (git installs need a `prepare` script + pnpm allowBuilds).

## Decision records (why)

- **ADB bench ops over domain plugins**: the user corrected the direction — a generic harness plugin should "sit near a scenario but stay generic within the business"; ADB ops are generic across Android/automotive teams and self-sufficient (the agent needs no domain knowledge). Domain knowledge (SR geometry etc.) belongs in skills, not tools.
- **Minimal dependencies**: runtime depends only on schemastery; `@deepseek-ai/*` types only. Reduces publish/resolution risk.
- **Error-code system**: structured codes are a model-visible contract, mapped by a single classifier so agents never face raw adb text.
