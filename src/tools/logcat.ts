import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { AdbError, classifyFailure, jsonOutput, resolveAdb, runAdb, type AdbConfig } from '../adb.js'
import { matchesKeyword, matchesLevel, parseLogcat, type LogLevel } from '../parsers/logcat.js'

const MAX_ENTRIES = 500
const FOREGROUND_MAX_BYTES = 16 * 1024 * 1024
const BACKGROUND_MAX_BYTES = 64 * 1024 * 1024

interface LogcatArgs {
  serial?: string
  tag?: string
  level?: LogLevel
  keyword?: string
  tail?: number
  since?: string
  until?: string
  run_in_background?: boolean
}

/** adb_logcat: foreground buffer dump with filters, or a continuous background stream job. */
export function registerLogcatTool(ctx: Context, cfg: AdbConfig): void {
  ctx.tools.register({
    name: 'adb_logcat',
    description: 'Read or stream the Android logcat. Foreground: dump the current buffer (optionally last `tail` entries) filtered by tag/level/keyword/since/until. Background: stream new entries continuously as a background job — the call returns a job id, read deltas with job_output and stop with job_kill.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        serial: { type: 'string', description: 'Target device serial; defaults to the plugin defaultSerial.' },
        tag: { type: 'string', description: 'Only entries whose tag equals this value.' },
        level: { type: 'string', enum: ['V', 'D', 'I', 'W', 'E', 'F'], description: 'Minimum log level (V < D < I < W < E < F).' },
        keyword: { type: 'string', description: 'Only entries whose tag or message contains this keyword.' },
        tail: { type: 'integer', description: 'Foreground: return only the last N entries.' },
        since: { type: 'string', description: 'Foreground: only entries at/after this time, e.g. "08-14 10:00:00.000".' },
        until: { type: 'string', description: 'Foreground: only entries at/before this time, e.g. "08-14 10:30:00.000".' },
        run_in_background: { type: 'boolean', description: 'Stream as a background job and return a job id immediately.' },
      },
    },
    output: jsonOutput(),
    async execute(args: LogcatArgs, exec: ToolExecution) {
      if (args.run_in_background === true) {
        return startBackgroundLogcat(ctx, cfg, args, exec)
      }
      const result = await runAdb(ctx, cfg, ['logcat', '-v', 'threadtime', '-d'], {
        signal: exec.signal,
        maxBytes: FOREGROUND_MAX_BYTES,
        serial: args.serial,
      })
      if (result.exitCode !== 0) throw classifyFailure(result)
      const { since, until, tag, level, keyword, tail } = args
      let entries = parseLogcat(result.stdout)
      // threadtime timestamps ("MM-DD HH:MM:SS.mmm") sort lexicographically.
      if (since !== undefined) entries = entries.filter((entry) => entry.time >= since)
      if (until !== undefined) entries = entries.filter((entry) => entry.time <= until)
      if (tag !== undefined) entries = entries.filter((entry) => entry.tag === tag)
      if (level !== undefined) entries = entries.filter((entry) => matchesLevel(entry, level))
      if (keyword !== undefined) entries = entries.filter((entry) => matchesKeyword(entry, keyword))
      if (tail !== undefined && tail >= 0) entries = entries.slice(-tail)
      const truncated = entries.length > MAX_ENTRIES
      const returned = truncated ? entries.slice(-MAX_ENTRIES) : entries
      return {
        total: entries.length,
        truncated,
        entries: returned.map((entry) => ({
          time: entry.time,
          pid: entry.pid,
          tid: entry.tid,
          level: entry.level,
          tag: entry.tag,
          message: entry.message,
        })),
      }
    },
  })
}

function startBackgroundLogcat(ctx: Context, cfg: AdbConfig, args: LogcatArgs, exec: ToolExecution) {
  const jobs = ctx.get('jobs')
  if (jobs === undefined) {
    throw new AdbError('JOBS_UNAVAILABLE', 'background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
  }
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) {
    throw new AdbError('ADB_UNAVAILABLE', 'subprocess service is not available: load @deepseek-ai/dsh-subprocess (e.g. dsh-subprocess-local) in the composition')
  }
  if (exec.signal.aborted) {
    const error = new Error('tool call aborted')
    error.name = 'AbortError'
    throw error
  }
  const serial = args.serial ?? cfg.defaultSerial
  const argv = [
    ...(serial !== undefined ? ['-s', serial] : []),
    'logcat',
    '-v',
    'threadtime',
    ...(args.tag !== undefined ? ['-s', `${args.tag}:V`] : []),
  ]
  // Preflight: resolve adb before committing the job, so a broken setup fails
  // the call instead of leaving a dead background job.
  const adbPromise = resolveAdb(ctx, cfg, exec.signal)
  const id = jobs.start({
    kind: 'adb-logcat',
    label: `logcat${args.tag !== undefined ? ` tag=${args.tag}` : ''}`,
    ...(exec.agent !== undefined ? { owner: exec.agent } : {}),
    run: () => {
      // The stream must outlive the tool call, so the spawn carries no exec.signal.
      let handle: SubprocessHandle | undefined
      let cursor = 0
      return {
        cancel: () => {
          handle?.terminate()
        },
        done: adbPromise.then(async (adb) => {
          handle = subprocess.spawn({
            argv: [adb, ...argv],
            cwd: process.cwd(),
            stdio: {
              stdin: 'ignore',
              stdout: { maxBytes: BACKGROUND_MAX_BYTES },
              stderr: { maxBytes: 1024 * 1024 },
            },
            graceMs: 3000,
          })
          const outcome = await handle.done
          return { exitCode: outcome.exitCode, signal: outcome.signal }
        }),
        readOutput: () => {
          const read = handle?.collected.stdout?.readFrom(cursor)
          if (read === undefined) return ''
          cursor += Buffer.byteLength(read.text, 'utf8')
          return read.text
        },
      }
    },
  })
  return { kind: 'background', jobId: id }
}
