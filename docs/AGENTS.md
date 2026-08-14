# dsh-adb 项目智能体说明（AGENTS.md）

> 任何进入本仓库工作的 AI 对话，先读本文件。其余细节在对应文档里，一处一事实。

## 项目是什么

`dsh-adb` 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的第三方插件（npm bundle）：让 DSH agent 直接操作 Android 设备 / 车机台架。定位是「业务内较通用的场景工具」——面向实车/台架联调，不限 Unity、不限具体车机协议。已发布到 npm（`dsh-adb`）、GitHub（SamXiaBing/dsh-adb）、两份社区清单已收录。

## 仓库布局

```
dsh-adb/
├── package.json        # dsh.bundle manifest + 版本号
├── cordis.patch.yml    # 插件行（id/name）
├── src/                # TS 源码：adb.ts(执行层) parsers/(解析器) tools/(7 工具) index.ts(注册)
├── test/parsers.test.mjs  # node --test 单测
├── docs/               # REQUIREMENTS(范围) TESTING(测试) DEVELOPMENT-LOG(教训) AGENTS.md(本文件)
├── PLAN.md             # 里程碑/待办（向前看）
└── docs/research/      # DSH 生态调研原始材料（市场依据）
```

关键依赖版本约定：构建仅用 `tsc`（无 bundler）；运行时依赖仅 `schemastery`；`@deepseek-ai/*` 只作 devDependencies（类型，编译期擦除）。

## 命令

```sh
npm run build          # tsc → lib/
npm test               # build + node --test（当前 9 用例）
npm publish --//registry.npmjs.org/:_authToken=<token>   # 发布（token 不落盘）
```

## 铁律（改代码前必读）

1. **提交即测**：任何提交的功能必须有实测覆盖（单元或端到端）。环境受限项必须显式标注 ⚠️，不得冒充已测。覆盖矩阵见 docs/TESTING.md。
2. **命名空间导出**：`index.ts` 只具名导出 `name`/`inject`/`Config`/`apply`，**禁止 default export**（Cordis Loader 会丢弃命名空间，inject 会丢失——这是 0.1.0 死因之一）。
3. **inject 声明**：用 `ctx.<service>` 必须声明在 `inject`（Cordis Guard 拒绝未声明访问）；可选服务一律 `ctx.get(name)` + 判空。`tools` 是硬依赖。
4. **jobs 契约**：后台任务 `readOutput()` 必须返回**字符串**（不是对象）；`done` 返回 JSON 可序列化值。违反会导致 `job_output` 报 `value.text must be a string`。
5. **dumpsys 参数**：`dumpsys battery` 不接受包名参数（会返回 "Unknown command"）；meminfo/gfxinfo 需要包名。新指标先验证 dumpsys 语法。
6. **错误码稳定**：`classifyFailure` 输出的错误码是模型可见契约，只增不改。新增匹配须考虑真实 adb 输出的前缀差异（`adb.exe: device 'X' not found` 无 `error:` 前缀）。
7. **不写机密**：文档/代码中不得出现 API key、token。凭据只引用文件路径（如 `~/.dsh/.credentials.yaml`）。
8. **版本发布**：修复 bug 必须 bump 版本并重新发布（历史版本在 npm 上无法撤回使用方升级）。发布用 bypass-2FA 的 granular token，用命令参数传入，不写进任何配置文件。

## 环境事实（本工作区已知）

- 本机 `NODE_ENV=production`：`npm install` 会跳过 devDeps，需 `npm install --include=dev`。
- 沙箱内 `pnpm` spawn 子进程会 EPERM（文档边界），**构建/安装优先用 npm**；`dsh plugin add` 走 pnpm，偶发 EPERM，重试即可。
- GitHub 推送用 `ssh://git@github.com:22/<repo>.git`（用户全局 `url.https://github.com/.insteadof=ssh://git@github.com/` 会把 ssh 改写为 https 导致认证失败；显式端口 22 可绕开）。SSH 密钥：`~/.ssh/id_ed25519`（无口令，已加入 GitHub）。
- `github.com` 网页域直连偶发超时（token 端点尤其如此）；`api.github.com` 稳定。
- gh CLI 已装（`C:\Program Files\GitHub CLI\gh.exe`），无持久登录——用 `GH_TOKEN` 环境变量走 API（`gh auth login --with-token` 需要 `read:org` scope，`repo` scope 的 token 不行）。
- npm 账号 `samxiabing` 已登录本机；发布需 bypass-2FA token。
- adb：`D:\AIWorkSpace\platform-tools\adb.exe`（本机唯一）；台架冒烟 profile：`~/.dsh/profiles/bench`。
- DSH 主仓库 checkout：`D:\AIWorkSpace\deepseek-harness`（查一方 API 契约用；改它的东西另守它的 AGENTS.md）。

## 文档地图

- [README.md](../README.md)：对外入口（安装/工具表/覆盖率矩阵/生态状态）
- [REQUIREMENTS.md](REQUIREMENTS.md)：目的/范围/非目标/验收标准
- [TESTING.md](TESTING.md)：测试哲学、方法、E2E 运行步骤、回归清单
- [DEVELOPMENT-LOG.md](DEVELOPMENT-LOG.md)：进度时间线、4 个已修复 bug 的完整教训、环境与生态经验
- [PLAN.md](../PLAN.md)：里程碑与待办（当前状态：v0.1.4，v1.0 候选=性能基线对比+设备面板）
