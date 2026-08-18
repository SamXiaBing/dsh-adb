import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { AdbError, classifyFailure, jsonOutput, runAdb, type AdbConfig } from '../adb.js'
import { parseLogcat } from '../parsers/logcat.js'
import { capturePerfSnapshot } from './perf.js'

type CrashSource = 'crash-buffer' | 'dropbox' | 'processes' | 'meminfo'

interface CrashReportArgs {
  package?: string
  serial?: string
  since?: string
  include?: CrashSource[]
  tail?: number
}

const DEFAULT_INCLUDE: CrashSource[] = ['crash-buffer', 'dropbox', 'processes']

function excerpt(text: string, maxLines: number): { lines: number; excerpt: string } {
  const lines = text.split(/\r?\n/).filter((line) => line !== '')
  return { lines: lines.length, excerpt: lines.slice(-maxLines).join('\n') }
}

/** adb_crash_report: collect a crash scene from an Android device. */
export function registerCrashReportTool(ctx: Context, cfg: AdbConfig): void {
  ctx.tools.register({
    name: 'adb_crash_report',
    description: 'Collect a crash scene from an Android device into one structured report: the logcat crash buffer (parsed entries), dropbox crash entries excerpt, process state excerpt, and (when a package is given) memory summary. Use it to gather crash context in one call instead of hunting through buffers.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        package: { type: 'string', description: 'App package id; enables the meminfo section and helps narrow the crash buffer.' },
        serial: { type: 'string', description: 'Target device serial; defaults to the plugin defaultSerial.' },
        since: { type: 'string', description: 'Only crash-buffer entries at/after this time, e.g. "08-15 10:00:00.000".' },
        include: {
          type: 'array',
          items: { type: 'string', enum: ['crash-buffer', 'dropbox', 'processes', 'meminfo'] },
          description: 'Which sections to collect; defaults to crash-buffer, dropbox, processes (plus meminfo when package is given).',
        },
        tail: { type: 'integer', description: 'Cap for parsed crash-buffer entries and excerpt lines; defaults to 100.' },
      },
    },
    output: jsonOutput(),
    async execute(args: CrashReportArgs, exec: ToolExecution) {
      const { since, tail } = args
      const tailCount = tail ?? 100
      const include = args.include ?? [
        ...DEFAULT_INCLUDE,
        ...(args.package !== undefined ? (['meminfo' as CrashSource]) : []),
      ]
      const result: Record<string, unknown> = { collectedAt: new Date().toISOString() }
      if (args.package !== undefined) result.package = args.package

      if (include.includes('crash-buffer')) {
        const output = await runAdb(ctx, cfg, ['logcat', '-b', 'crash', '-v', 'threadtime', '-d'], {
          signal: exec.signal,
          serial: args.serial,
          maxBytes: 8 * 1024 * 1024,
        })
        if (output.exitCode !== 0) throw classifyFailure(output)
        let entries = parseLogcat(output.stdout)
        if (since !== undefined) entries = entries.filter((entry) => entry.time >= since)
        const truncated = entries.length > tailCount
        result.crashBuffer = {
          total: entries.length,
          truncated,
          entries: (truncated ? entries.slice(-tailCount) : entries).map((entry) => ({
            time: entry.time,
            pid: entry.pid,
            tid: entry.tid,
            level: entry.level,
            tag: entry.tag,
            message: entry.message,
          })),
        }
      }

      if (include.includes('dropbox')) {
        const output = await runAdb(ctx, cfg, ['shell', 'dumpsys', 'dropbox', '--print'], {
          signal: exec.signal,
          serial: args.serial,
          maxBytes: 4 * 1024 * 1024,
        })
        if (output.exitCode !== 0) throw classifyFailure(output)
        const capped = excerpt(output.stdout, tailCount)
        result.dropbox = {
          lines: capped.lines,
          truncated: capped.lines > tailCount,
          excerpt: capped.excerpt,
        }
      }

      if (include.includes('processes')) {
        const output = await runAdb(ctx, cfg, ['shell', 'dumpsys', 'activity', 'processes'], {
          signal: exec.signal,
          serial: args.serial,
          maxBytes: 2 * 1024 * 1024,
        })
        if (output.exitCode !== 0) throw classifyFailure(output)
        const capped = excerpt(output.stdout, tailCount)
        result.processes = {
          lines: capped.lines,
          truncated: capped.lines > tailCount,
          excerpt: capped.excerpt,
        }
      }

      if (include.includes('meminfo')) {
        if (args.package === undefined) {
          throw new AdbError('ARGS_INVALID', 'meminfo section requires a package')
        }
        const snapshot = await capturePerfSnapshot(ctx, cfg, exec.signal, {
          package: args.package,
          serial: args.serial,
          metrics: ['meminfo'],
        })
        result.meminfo = snapshot.meminfo
      }

      return result
    },
  })
}
