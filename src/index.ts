import Schema from 'schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { AdbConfig } from './adb.js'
import { registerDeviceTools } from './tools/devices.js'
import { registerFileTool } from './tools/file.js'
import { registerInstallTool } from './tools/install.js'
import { registerLogcatTool } from './tools/logcat.js'
import { registerPerfTool } from './tools/perf.js'

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
}

export const Config: Schema<Config> = Schema.object({
  adbPath: Schema.string().description('adb 可执行文件绝对路径；缺省自动探测 PATH / ANDROID_HOME / ANDROID_SDK_ROOT / platform-tools'),
  defaultSerial: Schema.string().description('默认目标设备 serial'),
  timeoutMs: Schema.number().default(30000).description('adb 命令超时（毫秒）'),
})

export function apply(ctx: Context, config: Config): void {
  const cfg: AdbConfig = config
  registerDeviceTools(ctx, cfg)
  registerInstallTool(ctx, cfg)
  registerFileTool(ctx, cfg)
  registerLogcatTool(ctx, cfg)
  registerPerfTool(ctx, cfg)
  ctx.logger.info('[dsh-adb] loaded: adb_devices / adb_connect / adb_disconnect / adb_logcat / adb_install / adb_file / adb_perf_snapshot')
}
