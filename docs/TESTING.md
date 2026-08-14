# 测试要求与方法（TESTING.md）

## 测试哲学：提交即测

**任何提交的功能必须有实测覆盖（单元或端到端），环境受限项必须显式标注 ⚠️，不得冒充已测通过。**

这个原则在开发期抓到过 4 个已发布 bug（见 DEVELOPMENT-LOG.md）——它们都是纯单测无法暴露、只有真实组合加载 + 真实工具管道 + 真实设备才能触发的。

## 三层测试

### 1. 单元测试（node --test，当前 9 用例）

`test/parsers.test.mjs`：解析器（devices/logcat/meminfo/gfxinfo/battery）、logcat 过滤助手、`classifyFailure` 错误分类（含无 `error:` 前缀的 DEVICE_NOT_FOUND 用例）。

```sh
npm test   # = npm run build && node --test "test/*.test.mjs"
```

### 2. 确定性验证（针对错误分类这类纯函数）

不需要模型/设备：直接用 node 对**已安装的 npm 包**（`~/.dsh/profiles/bench/node_modules/dsh-adb/lib/adb.js`）跑 `classifyFailure`，喂真实 adb 报错文本断言错误码。曾用于验证 0.1.3 的 DEVICE_NOT_FOUND 修复。注意：模型看到的错误**消息**是 stderr 摘录，与错误码无关——验证错误码必须用这种方式，不能靠看 headless 任务输出。

### 3. 端到端冒烟（headless + 真实设备）

完整链路：npm 安装 → bundle 加载 → 配置覆盖 → 工具注册 → 真实 adb 调用 → 解析 → 结构化结果 → 模型消费。

**冒烟环境搭建（本机已就绪）：**

1. adb：`D:\AIWorkSpace\platform-tools\adb.exe`
2. 冒烟 profile：`~/.dsh/profiles/bench`，bundles = `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless` + `dsh-adb`；`cordis.patch.yml` 配 `adbPath`/`defaultSerial`
3. 模型凭据：`~/.dsh/.credentials.yaml` 的 `DEEPSEEK_API_KEY`（**文档不写值**；headless 运行前注入 `$env:DEEPSEEK_API_KEY`）
4. 设备：USB 连接（需已开 USB 调试并授权）

**运行方法：**

```powershell
$dsh = "$HOME\.dsh\profiles\node_modules\@deepseek-ai\dsh\lib\bin.js"
$key = (Select-String -Path "$HOME\.dsh\.credentials.yaml" -Pattern '^DEEPSEEK_API_KEY:\s*(.+)$').Matches[0].Groups[1].Value.Trim()
$env:DEEPSEEK_API_KEY = $key
node $dsh --profile bench "调用 adb_devices 并报告结果"
```

注意：
- 升级 profile 里的插件：`node $dsh plugin --profile bench add "dsh-adb@<版本>"`（pnpm 偶发 EPERM，重试；仍失败可 `npm install dsh-adb@<版本> --no-save` 直接装进 profile 的 node_modules）
- headless 任务偶发卡住/慢（模型响应不稳定）：改用后台 job 跑，或换更小的任务；会话日志在 `~/.dsh/sessions`（profile 目录里没有）
- 无线连接测试先给设备开 TCP 模式：`adb -s <serial> tcpip 5555`（`adb tcpip` 会临时断开 USB 通道，属 adb 标准行为）

## 覆盖率矩阵（当前 v0.1.4，全绿）

验证设备：Android 13 车机台架 + Android 13 真机。

| 功能 | 单元 | 端到端 |
| --- | --- | --- |
| adb_devices | ✅ | ✅ 台架+手机 |
| adb_connect 失败/成功路径 | ✅ 分类器 | ✅ 台架不可达 CONNECT_FAILED + 手机无线连接成功 |
| adb_disconnect | - | ✅ |
| adb_logcat 前向（level/tail） | ✅ | ✅ |
| adb_logcat tag/keyword 过滤 | ✅ | ✅ 均正向命中 |
| adb_logcat 后台采集 | - | ✅ job_output 读回 43065 行/7MB |
| adb_install 成功/失败 | ✅ 分类器 | ✅ Success + INSTALL_PARSE_FAILED_NOT_APK |
| adb_file ls/-lR/push/pull/rm | - | ✅ 全操作 |
| adb_perf_snapshot meminfo | ✅ | ✅ 台架+手机 |
| adb_perf_snapshot gfxinfo | ✅ | ✅ |
| adb_perf_snapshot battery | ✅ | ✅ 手机实数据 |
| 配置覆盖 | - | ✅ |
| 错误码 5 类核心 | ✅ | ✅ 实测/确定性验证 |

## 回归清单（改代码后必跑）

1. `npm test`（单测全绿）
2. headless 冒烟：`adb_devices`（设备识别）+ 改动相关工具的成败两路径
3. 若改动执行层/分类器：确定性验证 classifyFailure
4. 若改动后台路径：后台 logcat 起止读全流程
5. 真机环境（本机有台架/手机时）：battery 实数据 + 无线连接正向
6. 发布前：`npm pack --dry-run` 确认包内容（lib/ + cordis.patch.yml + README + LICENSE）
