import Schema from 'schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { DEFAULT_BASELINE_DIR } from './baseline.js'
import type { AdbConfig } from './adb.js'
import { registerDeviceTools } from './tools/devices.js'
import { registerCrashReportTool } from './tools/crash-report.js'
import { registerFileTool } from './tools/file.js'
import { registerInstallTool } from './tools/install.js'
import { registerLogcatTool } from './tools/logcat.js'
import { registerPerfTool } from './tools/perf.js'
import { registerPerfBaselineTool } from './tools/perf-baseline.js'
import { registerRpc } from './rpc.js'
import { registerSkills } from './skill.js'

export const name = 'dsh-adb'

/** The tool registry is a hard dependency: every tool registers through it. */
export const inject = ['tools']

/** Plugin config (all optional — `Config` supplies the defaults). */
export interface Config {
  /** Absolute path to the adb executable. */
  adbPath?: string
  /** Default target device serial used when a tool omits `serial`. */
  defaultSerial?: string
  /** Per-command timeout in milliseconds. */
  timeoutMs?: number
  /** Directory for adb_perf_baseline storage. */
  baselineDir?: string
}

export const Config: Schema<Config> = Schema.object({
  adbPath: Schema.string().description('adb 可执行文件绝对路径；缺省自动探测 PATH / ANDROID_HOME / ANDROID_SDK_ROOT / platform-tools'),
  defaultSerial: Schema.string().description('默认目标设备 serial'),
  timeoutMs: Schema.number().default(30000).description('adb 命令超时（毫秒）'),
  baselineDir: Schema.string().description('adb_perf_baseline 基线存储目录；缺省 ~/.dsh/storages/dsh-adb'),
})

export function apply(ctx: Context, config: Config): void {
  const cfg: AdbConfig = config
  registerDeviceTools(ctx, cfg)
  registerInstallTool(ctx, cfg)
  registerFileTool(ctx, cfg)
  registerLogcatTool(ctx, cfg)
  registerPerfTool(ctx, cfg)
  registerPerfBaselineTool(ctx, cfg, config.baselineDir ?? DEFAULT_BASELINE_DIR)
  registerCrashReportTool(ctx, cfg)
  registerSkills(ctx)
  // The RPC channel needs the client connection, which mounts after this
  // plugin starts in web compositions; register lazily so headless profiles
  // (no connection) stay unaffected.
  ctx.inject(['connection'], (readyCtx) => registerRpc(readyCtx, cfg))
  ctx.logger.info('[dsh-adb] loaded: 9 tools + web device panel rpc')
}
