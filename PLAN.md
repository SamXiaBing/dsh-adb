# dsh-adb 开发与发布计划

> ADB 设备·台架运维工具集 —— DeepSeek Harness 第三方插件（bundle）
> 状态：M0 ✅ M1 ✅ M2 进行中（GitHub 授权/发布）

## 进度记录

- M0（已完成）：脚手架 + 计划 + git init + 构建验证（tsc）
- M1（已完成）：adb 执行层 + 七个工具（devices/connect/disconnect/logcat/install/file/perf_snapshot）+ 解析器单测 8 项全绿
- M2（进行中）：
  - GitHub 仓库 `SamXiaBing/dsh-adb` 已创建并推送（SSH:22 + 6 话题标签：dsh-plugin/dsh/adb/android/automotive/bench）
  - 三份清单 PR：
    - ✅ 0xsline/awesome-deepseek-harness#87 — 已合并（2026-08-14）
    - ✅ awesome-dsh-plugin/awesome-dsh-plugin#85 — 已合并（2026-08-14）
    - ⏳ Alex-Yanggg/awesome-DSH-plugin#29 — 待合并
  - npm 发布：✅ `dsh-adb@0.1.0` 已发布到 npm（2026-08-14），`dsh plugin add dsh-adb` 可一条命令安装
- M3（已完成）：真机/台架冒烟 —— SA_DIREWOLF_IVI 台架（f20c9b04, Android 13），7 工具全链路实测通过（devices/connect/disconnect/logcat 前后台/install/file/perf）；冒烟发现并修复两个已发布 bug：v0.1.1 缺 `inject: ['tools']`、v0.1.2 后台 logcat `readOutput` 违反 jobs 字符串契约
- 环境备注：本机 `NODE_ENV=production` 导致 npm 跳过 devDeps（用 `--include=dev`）；pnpm 在沙箱内 spawn 被 EPERM 拦截，改用 npm + tsc（无子进程）；github.com 直连偶发超时，git 推送统一走 `ssh://git@github.com:22/`（避开全局 insteadof 改写）

## 1. 为什么做它（定位）

从「领域知识护城河」修正为「业务内较通用场景」后的第一选择，四条标准全中：

| 标准 | 说明 |
| --- | --- |
| 场景锚定 | 实车/台架联调是车机团队最频繁、最耗时的流程（开发/测试/QA 共用） |
| 业务内较通用 | 一个团队多角色、多项目可用；不绑 Unity、不绑具体车机协议，任何 Android 设备/嵌入式都适用 |
| 能力自足 | 插件自己封装 adb，agent 不需要先成为领域专家 |
| 可组合 | 与 ctx.jobs（后台采集）、GenUI（设备面板）、settings（配置）可拼装 |

**生态空白依据**：三方清单 129+ 插件无 adb 类；一方只有通用 shell——调 adb 是文本输出、Windows 引号/路径坑多、长采集无法结构化挂后台任务。

## 2. 产品范围

### v0.1（MVP，发布门槛）

六个工具（全部 host 侧，`ctx.tools` 注册，JSON schema，纯逻辑无 UI）：

1. `adb_devices` — 枚举设备（serial / state / 型号 / Android 版本），结构化返回；支持 tcpip 无线台架设备
2. `adb_connect` / `adb_disconnect` — 无线台架连接（host:port）
3. `adb_logcat` — tag / 级别 / 关键字 / 时间窗过滤；支持 `run_in_background` 挂 ctx.jobs 后台采集 + 增量读取
4. `adb_install` — apk 路径 + 目标设备 + `-r`/`-d` 选项，返回安装结果
5. `adb_file` — pull / push / ls / rm 子命令，设备隔离
6. `adb_perf_snapshot` — dumpsys meminfo / gfxinfo / battery 摘要 + 帧率（gfxinfo framestats）采样

配置（`Config` schema，cordis.yml 可覆盖）：

- `adbPath`：显式路径；缺省自动探测 PATH → `ANDROID_HOME`/`ANDROID_SDK_ROOT`/platform-tools → 常见安装位置
- `defaultSerial`：默认目标设备
- `timeoutMs`：adb 命令超时（默认 30s）

平台：Windows / macOS / Linux。执行层用 Node child_process（经 `ctx.subprocess`）直调 adb，不经 shell，规避引号/转义问题。

降级行为：adb 不可用 → 结构化错误 `ADB_NOT_FOUND` + 安装指引；无设备 → 返回空列表而非报错；目标设备不存在 → 明确 `DEVICE_NOT_FOUND`。

### v1.0（后续，按需）

- `adb_screenshot` / `adb_screenrecord`
- 性能基线对比（同设备多版本 gfxinfo 对比 + chart 报告）
- Client 设备面板（Slot：设备列表/状态 + logcat 流 + 快照对比图）
- `am start -W` 冷启动耗时
- 台架多设备会话管理

### 明确不做

- 不解析具体车机业务协议（SR / 感知物 / SOME-IP 等）——那是领域 skill 的职责，不是通用工具的
- 不做 GUI 自动化 / 点击注入（`dsh-computer-use` 已有桌面场景）
- 不绑定 Unity / 任何单一厂商

## 3. 架构

```
dsh-adb/
├── package.json        # dsh.bundle manifest（patch: ./cordis.patch.yml）
├── cordis.patch.yml    # 插件行：- insert: [{id: dsh-adb, name: dsh-adb}]
├── src/
│   ├── index.ts        # 命名空间导出 name/inject/Config/apply（无 default export）
│   ├── adb.ts          # adb 定位 + 执行（subprocess、超时、退出码、错误规范化）
│   ├── parsers/        # logcat / meminfo / gfxinfo / framestats 解析（纯函数，可单测）
│   └── tools/          # 每工具一个文件（defineTool 注册）
└── docs/research/      # 生态调研原始材料（竞品/市场依据）
```

- 执行层先 `cordis_inspect_query` 确认 `ctx.subprocess` 接口，再写代码
- 后台采集遵循 jobs producer 契约（`ctx.jobs.start()`，取消后改用任务自带 signal）
- 构建：`tsc`（单进程、无 bundler；沙箱友好且小型插件无需打包），发布预构建 `lib/`
- 测试：解析纯函数单测（node --test）+ mock 回放（录制 adb 输出 fixture，无真机可跑 CI）
- 命名空间插件形态：只具名导出 `name/inject/Config/apply`，**禁止混入 default export**（Loader unwrap 会丢命名空间）

## 4. GitHub 管理

- 仓库：`dsh-adb`（public），命名与生态一致（`dsh-*`）
- topics：`dsh-plugin`、`dsh`、`adb`、`android`、`automotive`、`bench`
- 认证方案：待定（gh CLI / SSH 密钥 / https+PAT 三选一，见待决问题）
- 分支：`main` + 里程碑 tag（v0.1.0 …）

## 5. 发布到 DSH 插件市场（去中心化生态的真实通路）

1. GitHub public + `#dsh-plugin` 话题（发现入口）
2. npm publish（预构建 `lib/`，用户免 allowBuilds；包名 `dsh-adb` 或 `@<scope>/dsh-adb`，先查占用）
3. 向三份清单提 PR：`awesome-dsh-plugin` / `awesome-deepseek-harness` / `Alex-Yanggg/awesome-DSH-plugin`
4. README 双语 + 一行安装命令 + GIF 演示（可选 record-browser-gif 流程）
5. 生态基建自查：`dsh-plugin-check` 健康检查；README 声明 `dsh.bundle`；构建产物入库或 npm 预构建

## 6. 里程碑

| 里程碑 | 内容 | 时间 |
| --- | --- | --- |
| M0 | 脚手架 + 计划 + git init（本地） | 本周 |
| M1 | v0.1 六工具实现 + 单测 + mock 回放 | 下周 |
| M2 | 发布：npm + GitHub（public + topics）+ 清单 PR | 第三周 |
| M3 | v1.0：基线对比 + 设备面板 | 按需 |

## 7. 待决问题

- [x] GitHub 认证方式（gh CLI 安装完成；设备码授权流程走通中）
- [x] npm 包名 `dsh-adb` 可用
- [x] v0.1 不含 client 面板（后置到 v1.0）
- [x] adb 二进制在本机缺失：解析器用 fixture 单测覆盖，真机验证放台架机
- [ ] GitHub 仓库创建 + 推送 + topics（等授权完成）
- [ ] npm publish（需要 npm 账号/token）
- [ ] 真机/台架冒烟：adb_devices → logcat → install → perf 全链路
