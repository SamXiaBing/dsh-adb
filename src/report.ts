import type { Context } from '@deepseek-ai/cordis'
import { classifyFailure, runAdb, type AdbConfig } from './adb.js'
import { matchesLevel, parseLogcat, type LogcatEntry } from './parsers/logcat.js'
import { parseGetprop, parseMemTotal, parseProcessList, parseWmSize, type ProcessEntry } from './parsers/sysinfo.js'

/**
 * One-click device health report ("体检"): collect device identity, top
 * processes, crash buffer, the worrying logcat window (W/E/F), and storage
 * usage into one structured snapshot. Every section degrades independently —
 * a failing section lands in `errors` instead of killing the whole report,
 * so a half-alive device still yields whatever could be read.
 */

export type ReportSection = 'device' | 'processes' | 'crash' | 'logcat' | 'storage'

export const REPORT_SECTIONS: readonly ReportSection[] = ['device', 'processes', 'crash', 'logcat', 'storage']

export interface ReportDeviceInfo {
  model?: string
  manufacturer?: string
  release?: string
  sdk?: string
  fingerprint?: string
  resolution?: string
  memTotalKb?: number
}

export interface DeviceReport {
  collectedAt: string
  serial: string
  device?: ReportDeviceInfo
  processes?: ProcessEntry[]
  crashBuffer?: { total: number; truncated: boolean; entries: LogcatEntry[] }
  logcat?: { total: number; truncated: boolean; entries: LogcatEntry[] }
  storage?: { lines: number; truncated: boolean; excerpt: string }
  errors: Array<{ section: string; message: string }>
}

export interface CollectDeviceReportArgs {
  serial?: string
  include?: ReportSection[]
  /** Cap for crash/logcat entries and the process/df lists; defaults to 100. */
  tail?: number
}

function excerpt(text: string, maxLines: number): { lines: number; truncated: boolean; excerpt: string } {
  const lines = text.split(/\r?\n/).filter((line) => line !== '')
  return {
    lines: lines.length,
    truncated: lines.length > maxLines,
    excerpt: lines.slice(-maxLines).join('\n'),
  }
}

/** Device identity block: getprop + wm size + /proc/meminfo. */
async function collectDevice(ctx: Context, cfg: AdbConfig, signal: AbortSignal, serial: string | undefined): Promise<ReportDeviceInfo> {
  const [getpropOut, sizeOut, memOut] = await Promise.all([
    runAdb(ctx, cfg, ['shell', 'getprop'], { signal, serial, maxBytes: 2 * 1024 * 1024 }),
    runAdb(ctx, cfg, ['shell', 'wm', 'size'], { signal, serial }),
    runAdb(ctx, cfg, ['shell', 'cat', '/proc/meminfo'], { signal, serial }),
  ])
  for (const result of [getpropOut, sizeOut, memOut]) {
    if (result.exitCode !== 0) throw classifyFailure(result)
  }
  const props = parseGetprop(getpropOut.stdout)
  const size = parseWmSize(sizeOut.stdout)
  return {
    model: props['ro.product.model'],
    manufacturer: props['ro.product.manufacturer'],
    release: props['ro.build.version.release'],
    sdk: props['ro.build.version.sdk'],
    fingerprint: props['ro.build.fingerprint'],
    resolution: size === undefined ? undefined : `${size.width}x${size.height}`,
    memTotalKb: parseMemTotal(memOut.stdout),
  }
}

/** Top processes by RSS (memory hogs first). */
async function collectProcesses(ctx: Context, cfg: AdbConfig, signal: AbortSignal, serial: string | undefined, tail: number): Promise<ProcessEntry[]> {
  const result = await runAdb(ctx, cfg, ['shell', 'ps', '-A'], { signal, serial, maxBytes: 2 * 1024 * 1024 })
  if (result.exitCode !== 0) throw classifyFailure(result)
  return parseProcessList(result.stdout)
    .filter((entry) => entry.rss !== undefined)
    .sort((a, b) => (b.rss ?? 0) - (a.rss ?? 0))
    .slice(0, tail)
}

/** Crash buffer as parsed entries (last `tail`). */
async function collectCrash(ctx: Context, cfg: AdbConfig, signal: AbortSignal, serial: string | undefined, tail: number): Promise<{ total: number; truncated: boolean; entries: LogcatEntry[] }> {
  const result = await runAdb(ctx, cfg, ['logcat', '-b', 'crash', '-v', 'threadtime', '-d'], { signal, serial, maxBytes: 8 * 1024 * 1024 })
  if (result.exitCode !== 0) throw classifyFailure(result)
  const entries = parseLogcat(result.stdout)
  const truncated = entries.length > tail
  return { total: entries.length, truncated, entries: entries.slice(-tail) }
}

/** The worrying logcat window: W/E/F entries from the main buffer, last `tail`. */
async function collectLogcat(ctx: Context, cfg: AdbConfig, signal: AbortSignal, serial: string | undefined, tail: number): Promise<{ total: number; truncated: boolean; entries: LogcatEntry[] }> {
  const result = await runAdb(ctx, cfg, ['logcat', '-v', 'threadtime', '-d'], { signal, serial, maxBytes: 8 * 1024 * 1024 })
  if (result.exitCode !== 0) throw classifyFailure(result)
  const entries = parseLogcat(result.stdout).filter((entry) => matchesLevel(entry, 'W'))
  const truncated = entries.length > tail
  return { total: entries.length, truncated, entries: entries.slice(-tail) }
}

/** Storage usage excerpt (`df`). */
async function collectStorage(ctx: Context, cfg: AdbConfig, signal: AbortSignal, serial: string | undefined, tail: number): Promise<{ lines: number; truncated: boolean; excerpt: string }> {
  const result = await runAdb(ctx, cfg, ['shell', 'df'], { signal, serial, maxBytes: 1024 * 1024 })
  if (result.exitCode !== 0) throw classifyFailure(result)
  return excerpt(result.stdout, tail)
}

/** Collect the one-click device health report with per-section degradation. */
export async function collectDeviceReport(
  ctx: Context,
  cfg: AdbConfig,
  signal: AbortSignal,
  args: CollectDeviceReportArgs = {},
): Promise<DeviceReport> {
  const serial = args.serial ?? cfg.defaultSerial
  const tail = args.tail !== undefined && args.tail > 0 ? Math.floor(args.tail) : 100
  const include = args.include ?? [...REPORT_SECTIONS]
  const report: DeviceReport = { collectedAt: new Date().toISOString(), serial: serial ?? 'default', errors: [] }

  const guard = async <T>(section: string, collect: () => Promise<T>, assign: (value: T) => void): Promise<void> => {
    try {
      assign(await collect())
    } catch (error) {
      report.errors.push({ section, message: error instanceof Error ? error.message : String(error) })
    }
  }

  await Promise.all([
    include.includes('device') && guard('device', () => collectDevice(ctx, cfg, signal, serial), (v) => { report.device = v }),
    include.includes('processes') && guard('processes', () => collectProcesses(ctx, cfg, signal, serial, tail), (v) => { report.processes = v }),
    include.includes('crash') && guard('crash', () => collectCrash(ctx, cfg, signal, serial, tail), (v) => { report.crashBuffer = v }),
    include.includes('logcat') && guard('logcat', () => collectLogcat(ctx, cfg, signal, serial, tail), (v) => { report.logcat = v }),
    include.includes('storage') && guard('storage', () => collectStorage(ctx, cfg, signal, serial, tail), (v) => { report.storage = v }),
  ])

  return report
}
