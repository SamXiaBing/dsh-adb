import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { classifyFailure, jsonOutput, runAdb, type AdbConfig } from '../adb.js'
import { parseBattery, parseGfxinfo, parseMeminfo } from '../parsers/perf.js'

export type PerfMetric = 'meminfo' | 'gfxinfo' | 'battery'

export interface PerfSnapshot {
  package: string
  metrics: PerfMetric[]
  meminfo?: ReturnType<typeof parseMeminfo>
  gfxinfo?: ReturnType<typeof parseGfxinfo>
  battery?: ReturnType<typeof parseBattery>
}

interface PerfArgs {
  package: string
  serial?: string
  metrics?: PerfMetric[]
}

/** Shared capture: dumpsys meminfo / gfxinfo / battery for one app. */
export async function capturePerfSnapshot(
  ctx: Context,
  cfg: AdbConfig,
  signal: AbortSignal,
  args: { package: string; serial?: string; metrics?: PerfMetric[] },
): Promise<PerfSnapshot> {
  const metrics = args.metrics ?? ['meminfo', 'gfxinfo', 'battery']
  const result: PerfSnapshot = { package: args.package, metrics: [...metrics] }
  for (const metric of metrics) {
    // dumpsys battery is device-global and takes no package argument.
    const argv = metric === 'battery'
      ? ['shell', 'dumpsys', 'battery']
      : ['shell', 'dumpsys', metric, args.package]
    const output = await runAdb(ctx, cfg, argv, {
      signal,
      serial: args.serial,
      maxBytes: 4 * 1024 * 1024,
    })
    if (output.exitCode !== 0) throw classifyFailure(output)
    if (metric === 'meminfo') result.meminfo = parseMeminfo(output.stdout)
    else if (metric === 'gfxinfo') result.gfxinfo = parseGfxinfo(output.stdout)
    else result.battery = parseBattery(output.stdout)
  }
  return result
}

/** adb_perf_snapshot: dumpsys meminfo / gfxinfo / battery for one app. */
export function registerPerfTool(ctx: Context, cfg: AdbConfig): void {
  ctx.tools.register({
    name: 'adb_perf_snapshot',
    description: 'Capture a performance snapshot of one installed app on an Android device: memory (dumpsys meminfo), rendering (dumpsys gfxinfo: janky frames, percentiles), and battery. Use it for bench/regression checks before or after a change.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['package'],
      properties: {
        package: { type: 'string', description: 'App package id, e.g. com.example.hmi.' },
        serial: { type: 'string', description: 'Target device serial; defaults to the plugin defaultSerial.' },
        metrics: {
          type: 'array',
          items: { type: 'string', enum: ['meminfo', 'gfxinfo', 'battery'] },
          description: 'Which metrics to collect; defaults to all three.',
        },
      },
    },
    output: jsonOutput(),
    async execute(args: PerfArgs, exec: ToolExecution) {
      return capturePerfSnapshot(ctx, cfg, exec.signal, args)
    },
  })
}
