import Schema from 'schemastery'

export const name = 'dsh-adb'

export const Config = Schema.object({
  adbPath: Schema.string().description('adb 可执行文件路径；缺省自动探测 PATH / ANDROID_HOME / ANDROID_SDK_ROOT / platform-tools'),
  defaultSerial: Schema.string().description('默认目标设备 serial'),
  timeoutMs: Schema.number().default(30000).description('adb 命令超时（毫秒）'),
})

export function apply(ctx: any): void {
  ctx.logger.info('[dsh-adb] loaded')

  // M1 里程碑：注册六工具
  // adb_devices / adb_connect / adb_disconnect / adb_logcat / adb_install / adb_file / adb_perf_snapshot
  // 执行层见 src/adb.ts（经 ctx.subprocess 直调 adb），解析层见 src/parsers/
}
