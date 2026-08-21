import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { classifyFailure, jsonOutput, runAdb, type AdbConfig } from '../adb.js'
import { parseDevices, type AdbDevice } from '../parsers/devices.js'
import { parseLogcat, type LogcatEntry } from '../parsers/logcat.js'
import { parseProcessList, type ProcessEntry } from '../parsers/sysinfo.js'

/**
 * adb_wait_for: wait until a device reaches a condition, instead of sleeping a
 * fixed number of seconds. Conditions: device-online, boot-complete, process
 * (a process appears), logcat-pattern (a keyword appears). Polls at
 * `intervalMs` until `timeoutMs`, then returns `matched: false` (not an error)
 * so the agent can react to the timeout instead of guessing.
 */

export type WaitCondition = 'device-online' | 'boot-complete' | 'process' | 'logcat-pattern'

export interface WaitArgs {
  serial?: string
  condition: WaitCondition
  /** Substring matched against process names (condition=process) or logcat tag/message (condition=logcat-pattern). */
  pattern?: string
  /** Overall wait budget in milliseconds; defaults to 30000, capped at 300000. */
  timeoutMs?: number
  /** Poll interval in milliseconds; defaults to 1000. */
  intervalMs?: number
}

export interface WaitResult {
  condition: WaitCondition
  matched: boolean
  waitedMs: number
  attempts: number
  reason?: string
}

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 300_000
const DEFAULT_INTERVAL_MS = 1_000

// ---- Pure condition checks (unit-tested) ----

/** device-online: the serial is present in `adb devices -l` with state `device`. */
export function checkDeviceOnline(devices: AdbDevice[], serial?: string): boolean {
  return devices.some((device) => {
    if (serial !== undefined && device.serial !== serial) return false
    return device.state === 'device'
  })
}

/** boot-complete: `getprop sys.boot_completed` output is exactly "1". */
export function checkBootComplete(getpropOut: string): boolean {
  return getpropOut.trim() === '1'
}

/** process: any process name contains the pattern. */
export function checkProcessPresent(processes: ProcessEntry[], pattern: string): boolean {
  return processes.some((entry) => entry.name.includes(pattern))
}

/** logcat-pattern: any entry's tag or message contains the keyword. */
export function checkLogcatKeyword(entries: LogcatEntry[], keyword: string): boolean {
  return entries.some((entry) => entry.tag.includes(keyword) || entry.message.includes(keyword))
}

// ---- Poll loop ----

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('tool call aborted'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('tool call aborted'))
    }, { once: true })
  })
}

/** Run one adb probe for the condition; returns true when satisfied. */
async function probe(ctx: Context, cfg: AdbConfig, args: WaitArgs, signal: AbortSignal): Promise<boolean> {
  const serial = args.serial
  switch (args.condition) {
    case 'device-online': {
      const result = await runAdb(ctx, cfg, ['devices', '-l'], { signal, maxBytes: 1024 * 1024 })
      if (result.exitCode !== 0) throw classifyFailure(result)
      return checkDeviceOnline(parseDevices(result.stdout), args.serial)
    }
    case 'boot-complete': {
      const result = await runAdb(ctx, cfg, ['shell', 'getprop', 'sys.boot_completed'], { signal, serial })
      if (result.exitCode !== 0) throw classifyFailure(result)
      return checkBootComplete(result.stdout)
    }
    case 'process': {
      const result = await runAdb(ctx, cfg, ['shell', 'ps', '-A'], { signal, serial, maxBytes: 2 * 1024 * 1024 })
      if (result.exitCode !== 0) throw classifyFailure(result)
      return checkProcessPresent(parseProcessList(result.stdout), args.pattern as string)
    }
    case 'logcat-pattern': {
      const result = await runAdb(ctx, cfg, ['logcat', '-v', 'threadtime', '-d'], { signal, serial, maxBytes: 8 * 1024 * 1024 })
      if (result.exitCode !== 0) throw classifyFailure(result)
      return checkLogcatKeyword(parseLogcat(result.stdout), args.pattern as string)
    }
    default:
      throw new Error(`unknown condition: ${String(args.condition)}`)
  }
}

/** Validate args that fail fast — before the poll loop so they surface as errors, not timeouts. */
function validateArgs(args: WaitArgs): void {
  if (!['device-online', 'boot-complete', 'process', 'logcat-pattern'].includes(args.condition)) {
    throw new Error(`unknown condition: ${String(args.condition)}`)
  }
  if ((args.condition === 'process' || args.condition === 'logcat-pattern') && (args.pattern === undefined || args.pattern === '')) {
    throw new Error(`condition "${args.condition}" requires a non-empty "pattern"`)
  }
}

/** Wait until the condition holds or the budget expires (returns matched:false on timeout). */
export async function waitForCondition(ctx: Context, cfg: AdbConfig, signal: AbortSignal, args: WaitArgs): Promise<WaitResult> {
  validateArgs(args)
  const timeoutMs = Math.min(Math.floor(args.timeoutMs ?? DEFAULT_TIMEOUT_MS), MAX_TIMEOUT_MS)
  const intervalMs = Math.max(Math.floor(args.intervalMs ?? DEFAULT_INTERVAL_MS), 250)
  const start = Date.now()
  const deadline = start + timeoutMs
  let attempts = 0
  let lastProbe: string | undefined

  while (true) {
    attempts++
    try {
      const satisfied = await probe(ctx, cfg, args, signal)
      if (satisfied) {
        return { condition: args.condition, matched: true, waitedMs: Date.now() - start, attempts }
      }
    } catch (error) {
      // A transient probe failure (device offline mid-wait) is not terminal:
      // keep polling until the budget, but record the reason.
      lastProbe = error instanceof Error ? error.message : String(error)
    }
    if (Date.now() >= deadline) {
      return {
        condition: args.condition,
        matched: false,
        waitedMs: timeoutMs,
        attempts,
        ...(lastProbe !== undefined ? { reason: lastProbe } : { reason: `condition not met within ${timeoutMs}ms` }),
      }
    }
    await sleep(Math.min(intervalMs, deadline - Date.now()), signal)
  }
}

/** adb_wait_for: wait until a device condition holds (online / boot complete / process / logcat keyword). */
export function registerWaitTool(ctx: Context, cfg: AdbConfig): void {
  ctx.tools.register({
    name: 'adb_wait_for',
    description: 'Wait until a device reaches a condition, then return — instead of sleeping a fixed number of seconds. Conditions: device-online (device is in `adb devices` with state `device`), boot-complete (sys.boot_completed=1), process (a process whose name contains `pattern` appears in ps), logcat-pattern (a keyword appears in logcat tag/message). Polls every `intervalMs` up to `timeoutMs`; on timeout returns matched:false (not an error) so you can react. Use it to sequence multi-step device flows: install → wait for process → snapshot.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['condition'],
      properties: {
        condition: {
          type: 'string',
          enum: ['device-online', 'boot-complete', 'process', 'logcat-pattern'],
          description: 'Which condition to wait for.',
        },
        serial: { type: 'string', description: 'Target device serial; defaults to the plugin defaultSerial. For device-online, omit serial to wait for ANY device to come online.' },
        pattern: { type: 'string', description: 'Required for process (process-name substring) and logcat-pattern (keyword).' },
        timeoutMs: { type: 'integer', description: 'Overall wait budget in milliseconds; defaults to 30000, capped at 300000.' },
        intervalMs: { type: 'integer', description: 'Poll interval in milliseconds; defaults to 1000, minimum 250.' },
      },
    },
    output: jsonOutput(),
    async execute(args: WaitArgs, exec: ToolExecution) {
      return waitForCondition(ctx, cfg, exec.signal, args)
    },
  })
}
