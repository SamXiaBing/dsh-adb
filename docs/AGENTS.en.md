# dsh-adb Project Agent Guide (AGENTS.md)

> Any AI conversation working in this repository should read this file first. Details live in the linked docs — one home per fact.

[简体中文](AGENTS.md) | English

## What this project is

`dsh-adb` is a third-party [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin (npm bundle) that gives DSH agents direct control over Android devices and automotive bench rigs. Positioned as a "generic-within-a-domain" scenario tool for on-vehicle / bench debugging — no Unity, no vendor protocol lock-in. Published to npm (`dsh-adb`), GitHub (SamXiaBing/dsh-adb), and listed in two community catalogs.

## Repository layout

```
dsh-adb/
├── package.json        # dsh.bundle manifest + version
├── cordis.patch.yml    # plugin row (id/name)
├── src/                # TS sources: adb.ts (execution) parsers/ tools/ index.ts (registration)
├── test/parsers.test.mjs  # node --test unit tests
├── docs/               # REQUIREMENTS / TESTING / DEVELOPMENT-LOG / AGENTS (EN + ZH)
├── PLAN.md             # milestones & backlog (forward-looking)
└── docs/research/      # DSH ecosystem research material (market evidence)
```

Dependency conventions: build with `tsc` only (no bundler); runtime dependency is only `schemastery`; `@deepseek-ai/*` are devDependencies only (types, erased at compile time).

## Commands

```sh
npm run build          # tsc → lib/
npm test               # build + node --test (currently 9 cases)
npm publish --//registry.npmjs.org/:_authToken=<token>   # publish (token never persisted)
```

## Hard rules (read before changing code)

1. **Ship only what is tested**: every committed feature must have unit and/or end-to-end coverage. Environment-limited items must be explicitly marked ⚠️, never passed off as tested. Coverage matrix: docs/TESTING.md.
2. **Namespace exports**: `index.ts` exports only named `name`/`inject`/`Config`/`apply` — **no default export** (the Cordis Loader drops the namespace and inject is lost — this killed 0.1.0).
3. **Declare inject**: accessing `ctx.<service>` requires declaring it in `inject` (the Cordis Guard rejects undeclared access); optional services use `ctx.get(name)` with an undefined check. `tools` is a hard dependency.
4. **jobs contract**: a background task's `readOutput()` must return a **string** (not an object); `done` returns a JSON-serializable value. Violations make `job_output` fail with `value.text must be a string`.
5. **dumpsys arguments**: `dumpsys battery` takes no package argument (it returns "Unknown command"); meminfo/gfxinfo need the package. Verify dumpsys syntax for any new metric.
6. **Stable error codes**: the codes emitted by `classifyFailure` are a model-visible contract — only add, never change. New matchers must account for real adb output variants (`adb.exe: device 'X' not found` has no `error:` prefix).
7. **No secrets in docs/code**: no API keys or tokens ever; reference credential file paths only (e.g. `~/.dsh/.credentials.yaml`).
8. **Versioning**: fixing a bug requires a version bump and republish (already-published versions cannot be retracted from users). Publish with a bypass-2FA granular token passed as a command argument, never written to config.

## Environment facts (this workspace)

- This machine has `NODE_ENV=production`: `npm install` skips devDependencies — use `npm install --include=dev`.
- Inside the sandbox, `pnpm` child spawns fail with EPERM (documented boundary); **prefer npm** for build/install; `dsh plugin add` uses pnpm and intermittently hits EPERM — retry.
- GitHub pushes use `ssh://git@github.com:22/<repo>.git` (the global `url.https://github.com/.insteadof=ssh://git@github.com/` rewrites ssh URLs to https and breaks auth; an explicit port-22 URL bypasses the rule). SSH key: `~/.ssh/id_ed25519` (no passphrase, added to GitHub).
- `github.com` web domain intermittently times out (especially the token endpoint); `api.github.com` is stable.
- gh CLI installed (`C:\Program Files\GitHub CLI\gh.exe`), no persistent login — use the `GH_TOKEN` env var for API calls (`gh auth login --with-token` requires the `read:org` scope; a `repo`-scope token won't validate).
- npm account `samxiabing` is logged in locally; publishing needs a bypass-2FA token.
- adb: `D:\AIWorkSpace\platform-tools\adb.exe`; bench smoke profile: `~/.dsh/profiles/bench`.
- DSH source checkout: `D:\AIWorkSpace\deepseek-harness` (for first-party API contracts; follow its AGENTS.md if you modify it).

## Doc map

- [README.md](../README.md): external entry (install/tools/coverage/ecosystem)
- [REQUIREMENTS.md](REQUIREMENTS.md): purpose/scope/non-goals/acceptance criteria
- [TESTING.md](TESTING.md): testing philosophy, methodology, E2E steps, regression checklist
- [DEVELOPMENT-LOG.md](DEVELOPMENT-LOG.md): timeline, four fixed-bug lessons, environment & ecosystem notes
- [PLAN.md](../PLAN.md): milestones & backlog (current: v0.1.5; v1.0 candidates = perf baseline comparison + device panel)
