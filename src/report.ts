import type { Context } from '@deepseek-ai/cordis'
import { classifyFailure, runAdb, type AdbConfig } from './adb.js'
import { matchesLevel, parseLogcat, type LogcatEntry, type LogLevel } from './parsers/logcat.js'
import { parseGetprop, parseMemTotal, parseProcessList, parseWmSize, type ProcessEntry } from './parsers/sysinfo.js'

/**
 * One-click device health report ("体检"): collect device identity, top
 * processes, crash buffer, the worrying logcat window (W/E/F), and storage
 * usage into one structured snapshot. Every section degrades independently —
 * a failing section lands in `errors` instead of killing the whole report,
 * so a half-alive device still yields whatever could be read.
 *
 * Evidence → signal: raw crash/logcat counts are noisy (boot markers, one
 * mDNS error repeating thousands of times), so the report classifies crashes
 * into real crashes vs. startup markers, aggregates logcat by tag, and emits a
 * compact health summary the agent can reason from instead of 17k raw lines.
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

/** A real crash with the following same-pid lines (its stack trace) attached. */
export interface CrashChain {
  signature: LogcatEntry
  following: LogcatEntry[]
}

export interface CrashSummary {
  total: number
  realCrashCount: number
  bootMarkerCount: number
  otherCount: number
  /** Real crashes, each with its contiguous same-pid tail. */
  chains: CrashChain[]
}

export interface TagAggregate {
  tag: string
  level: LogLevel
  count: number
  sample: LogcatEntry
}

export interface LogcatSummary {
  total: number
  byTag: TagAggregate[]
}

export type HealthVerdict = 'ok' | 'attention'

export interface HealthSummary {
  verdict: HealthVerdict
  /** Human/agent-readable lines: device, memory hogs, notable signals. */
  lines: string[]
  /** Concrete issues that drove the verdict (empty when ok). */
  issues: string[]
}

export interface DeviceReport {
  collectedAt: string
  serial: string
  device?: ReportDeviceInfo
  processes?: ProcessEntry[]
  crashBuffer?: CrashSummary
  logcat?: LogcatSummary
  storage?: { lines: number; truncated: boolean; excerpt: string }
  health?: HealthSummary
  errors: Array<{ section: string; message: string }>
}

export interface CollectDeviceReportArgs {
  serial?: string
  include?: ReportSection[]
  /** Cap for crash chains, logcat tag aggregates, and the process/df lists; defaults to 10. */
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

// ---- Evidence → signal pure helpers (unit-tested) ----

const REAL_CRASH = /FATAL EXCEPTION|Fatal signal|beginning of crash|SIGSEGV|SIGABRT|SIGBUS|SIGFPE|SIGILL|SIGTRAP/i
const BOOT_MARKER = /mtk-brm-(?:commit|change|merge)-id|libimsma_adapt|SmartRatSwitch.*mtk-brm/i

export function isRealCrash(entry: LogcatEntry): boolean {
  return REAL_CRASH.test(entry.message) || REAL_CRASH.test(entry.tag)
}

export function isBootMarker(entry: LogcatEntry): boolean {
  return BOOT_MARKER.test(entry.message) || BOOT_MARKER.test(entry.tag)
}

/**
 * Classify crash-buffer entries into real crashes vs. MediaTek boot markers
 * vs. everything else, grouping each real crash with the contiguous same-pid
 * lines that follow it (the stack trace).
 */
export function classifyCrashBuffer(entries: LogcatEntry[]): CrashSummary {
  const chains: CrashChain[] = []
  for (let i = 0; i < entries.length; i++) {
    if (!isRealCrash(entries[i])) continue
    const following: LogcatEntry[] = []
    const pid = entries[i].pid
    for (let j = i + 1; j < entries.length && entries[j].pid === pid; j++) {
      following.push(entries[j])
    }
    chains.push({ signature: entries[i], following })
  }
  const bootMarkerCount = entries.filter(isBootMarker).length
  return {
    total: entries.length,
    realCrashCount: chains.length,
    bootMarkerCount,
    otherCount: entries.length - chains.length - bootMarkerCount,
    chains,
  }
}

/**
 * Aggregate logcat entries by tag+level, keeping one sample line per group and
 * sorting by count descending. Turns "16987 lines" into "AOSP-MdnsDiscovery ×16200".
 */
export function aggregateByTag(entries: LogcatEntry[], topN = 10): LogcatSummary {
  const counts = new Map<string, TagAggregate>()
  for (const entry of entries) {
    const key = `${entry.tag}\u0000${entry.level}`
    const existing = counts.get(key)
    if (existing !== undefined) {
      existing.count++
      continue
    }
    counts.set(key, { tag: entry.tag, level: entry.level, count: 1, sample: entry })
  }
  const byTag = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, topN)
  return { total: entries.length, byTag }
}

const NETWORK_SIGNAL = /WifiHAL|NETWORK_ABNORMAL|MdnsDiscovery|multicast mDNS|sendto failed: EPERM/i
const THERMAL_NOISE = /PowerKeeper\.Thermal/i

/**
 * Compact health summary: verdict + a few lines the agent (or user) can reason
 * from directly, instead of raw counts. Signals are intentionally coarse —
 * the report is a triage surface, not a root-cause tool.
 */
export function buildHealthSummary(
  report: Pick<DeviceReport, 'device' | 'crashBuffer' | 'logcat' | 'processes'>,
): HealthSummary {
  const lines: string[] = []
  const issues: string[] = []
  const device = report.device
  if (device) {
    const parts = [device.model, `Android ${device.release ?? '?'}`].filter(Boolean)
    if (device.memTotalKb !== undefined) parts.push(`内存 ${Math.round(device.memTotalKb / 1024)}MB`)
    lines.push(`设备：${parts.join(' · ')}`)
  }
  const crash = report.crashBuffer
  if (crash && crash.total > 0) {
    if (crash.realCrashCount > 0) {
      const tags = [...new Set(crash.chains.map((chain) => chain.signature.tag))].join(', ')
      issues.push(`真实崩溃 ${crash.realCrashCount} 起（${tags}）`)
      lines.push(`崩溃：${crash.realCrashCount} 真实崩溃 + ${crash.bootMarkerCount} 启动标记 + ${crash.otherCount} 其他（共 ${crash.total}）`)
    } else {
      lines.push(`崩溃：无真实崩溃（${crash.bootMarkerCount} 启动标记 + ${crash.otherCount} 其他，共 ${crash.total}）`)
    }
  }
  const logcat = report.logcat
  if (logcat && logcat.total > 0) {
    const top = logcat.byTag[0]
    if (top) lines.push(`W/E/F 日志：共 ${logcat.total} 条，主要来源 ${top.tag}(${top.level}) ×${top.count}${logcat.byTag.length > 1 ? ` 等 ${logcat.byTag.length} 个来源` : ''}`)
    const net = logcat.byTag.find((agg) => NETWORK_SIGNAL.test(agg.tag) || NETWORK_SIGNAL.test(agg.sample.message))
    if (net) issues.push(`网络异常信号（${net.tag}: ${net.sample.message.slice(0, 80)}）`)
    const thermal = logcat.byTag.find((agg) => THERMAL_NOISE.test(agg.tag))
    if (thermal) lines.push('注：PowerKeeper.Thermal 为 MIUI 解析噪音，可忽略')
  }
  if (report.processes && report.processes.length > 0) {
    const top = report.processes.slice(0, 3)
    lines.push(`内存大户：${top.map((p) => `${p.name}(${p.rss}KB)`).join(', ')}`)
  }
  const verdict: HealthVerdict = issues.length > 0 ? 'attention' : 'ok'
  return { verdict, lines, issues }
}

// ---- Section collectors ----

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

/** Crash buffer classified into real crashes vs. boot markers. */
async function collectCrash(ctx: Context, cfg: AdbConfig, signal: AbortSignal, serial: string | undefined): Promise<CrashSummary> {
  const result = await runAdb(ctx, cfg, ['logcat', '-b', 'crash', '-v', 'threadtime', '-d'], { signal, serial, maxBytes: 8 * 1024 * 1024 })
  if (result.exitCode !== 0) throw classifyFailure(result)
  return classifyCrashBuffer(parseLogcat(result.stdout))
}

/** The worrying logcat window: W/E/F entries from the main buffer, aggregated by tag. */
async function collectLogcat(ctx: Context, cfg: AdbConfig, signal: AbortSignal, serial: string | undefined, tail: number): Promise<LogcatSummary> {
  const result = await runAdb(ctx, cfg, ['logcat', '-v', 'threadtime', '-d'], { signal, serial, maxBytes: 8 * 1024 * 1024 })
  if (result.exitCode !== 0) throw classifyFailure(result)
  const entries = parseLogcat(result.stdout).filter((entry) => matchesLevel(entry, 'W'))
  return aggregateByTag(entries, tail)
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
  const tail = args.tail !== undefined && args.tail > 0 ? Math.floor(args.tail) : 10
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
    include.includes('crash') && guard('crash', () => collectCrash(ctx, cfg, signal, serial), (v) => { report.crashBuffer = v }),
    include.includes('logcat') && guard('logcat', () => collectLogcat(ctx, cfg, signal, serial, tail), (v) => { report.logcat = v }),
    include.includes('storage') && guard('storage', () => collectStorage(ctx, cfg, signal, serial, tail), (v) => { report.storage = v }),
  ])

  report.health = buildHealthSummary(report)
  return report
}
