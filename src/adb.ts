import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolOutputDefinition } from '@deepseek-ai/dsh-tools'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

/**
 * dsh-adb execution core: locate the adb executable, run one adb command
 * through the host `subprocess` service, and normalize failures into
 * structured {@link AdbError} codes. No shell layer: every argument is an
 * unquoted argv element.
 */

export interface AdbConfig {
  /** Absolute path to the adb executable. */
  adbPath?: string
  /** Default target device serial used when a tool omits `serial`. */
  defaultSerial?: string
  /** Per-command timeout in milliseconds. */
  timeoutMs?: number
}

export class AdbError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AdbError'
    this.code = code
  }
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_STDOUT_MAX_BYTES = 8 * 1024 * 1024
const DEFAULT_STDERR_MAX_BYTES = 1 * 1024 * 1024

/** Shared tool `output` declaration: permissive schema + pretty-printed JSON rendering. */
export function jsonOutput(): ToolOutputDefinition {
  return {
    schema: {},
    render: (_args: unknown, value: unknown): ContentBlock[] => [
      { type: 'text', text: JSON.stringify(value, null, 2) },
    ],
  }
}

function requireSubprocess(ctx: Context): SubprocessService {
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) {
    throw new AdbError(
      'ADB_UNAVAILABLE',
      'subprocess service is not available: load @deepseek-ai/dsh-subprocess (e.g. dsh-subprocess-local) in the composition',
    )
  }
  return subprocess as SubprocessService
}

/** Minimal structural view of the subprocess service used by this package. */
type SubprocessService = {
  resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string>
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle
}

function exeName(base: string): string {
  return process.platform === 'win32' ? `${base}.exe` : base
}

function platformToolsCandidates(): string[] {
  const names: string[] = []
  for (const root of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) {
    if (root !== undefined && root !== '') {
      names.push(join(root, 'platform-tools', exeName('adb')))
    }
  }
  return names
}

/**
 * Resolve the adb executable: configured `adbPath` (must be absolute), then
 * the provider's PATH, then ANDROID_HOME / ANDROID_SDK_ROOT platform-tools.
 */
export async function resolveAdb(ctx: Context, cfg: AdbConfig, signal?: AbortSignal): Promise<string> {
  const subprocess = requireSubprocess(ctx)
  if (cfg.adbPath !== undefined && !isAbsolute(cfg.adbPath)) {
    throw new AdbError('ADB_CONFIG_INVALID', `adbPath must be an absolute path, got: ${cfg.adbPath}`)
  }
  const candidates = [...(cfg.adbPath !== undefined ? [cfg.adbPath] : []), 'adb', ...platformToolsCandidates()]
  let lastCause: unknown
  for (const candidate of candidates) {
    try {
      const resolved = await subprocess.resolveExecutable(candidate, undefined, signal)
      if (resolved !== '') return resolved
    } catch (error) {
      lastCause = error
    }
  }
  throw new AdbError(
    'ADB_NOT_FOUND',
    'adb executable not found. Set `adbPath` in the dsh-adb plugin config to the absolute adb path, or install Android platform-tools and expose them via PATH / ANDROID_HOME / ANDROID_SDK_ROOT.',
    { cause: lastCause },
  )
}

export interface AdbRunOptions {
  /** Target device serial; defaults to the plugin `defaultSerial`. */
  serial?: string
  /** Caller-owned cancellation (the tool `exec.signal`). */
  signal?: AbortSignal
  timeoutMs?: number
  maxBytes?: number
}

export interface AdbRunResult {
  stdout: string
  stdoutTruncated: boolean
  stderr: string
  stderrTruncated: boolean
  exitCode: number
}

/** Run one adb command to completion with collected stdout/stderr. */
export async function runAdb(
  ctx: Context,
  cfg: AdbConfig,
  argv: readonly string[],
  options: AdbRunOptions = {},
): Promise<AdbRunResult> {
  const adb = await resolveAdb(ctx, cfg, options.signal)
  const serial = options.serial ?? cfg.defaultSerial
  const args = serial === undefined ? argv : ['-s', serial, ...argv]
  const timeoutMs = options.timeoutMs ?? cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal = options.signal === undefined ? timeoutSignal : AbortSignal.any([options.signal, timeoutSignal])

  let handle: SubprocessHandle
  try {
    handle = requireSubprocess(ctx).spawn({
      argv: [adb, ...args],
      cwd: process.cwd(),
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: options.maxBytes ?? DEFAULT_STDOUT_MAX_BYTES },
        stderr: { maxBytes: DEFAULT_STDERR_MAX_BYTES },
      },
      graceMs: 3000,
      signal,
    } satisfies SubprocessSpawnSpec)
  } catch (error) {
    throw new AdbError('ADB_LAUNCH_FAILED', `failed to start adb process: ${describe(error)}`, { cause: error })
  }

  let outcome: SubprocessOutcome
  try {
    outcome = await handle.done
  } catch (error) {
    throw new AdbError('ADB_LAUNCH_FAILED', `adb process could not start: ${describe(error)}`, { cause: error })
  }

  const stdout = handle.collected.stdout?.readFrom(0)
  const stderr = handle.collected.stderr?.readFrom(0)
  const stdoutText = stdout?.text ?? ''
  const stderrText = stderr?.text ?? ''

  if (options.signal?.aborted) {
    const error = new Error('tool call aborted')
    error.name = 'AbortError'
    throw error
  }
  if (outcome.signal !== null || outcome.exitCode === null) {
    throw new AdbError('ADB_KILLED', `adb was killed by signal ${outcome.signal ?? '(unknown)'}`)
  }

  return {
    stdout: stdoutText,
    stdoutTruncated: stdout?.lossy ?? false,
    stderr: stderrText,
    stderrTruncated: stderr?.lossy ?? false,
    exitCode: outcome.exitCode,
  }
}

/** Map a non-zero adb exit to a structured {@link AdbError}. */
export function classifyFailure(result: AdbRunResult): AdbError {
  const stderr = result.stderr
  const stdout = result.stdout
  if (/(?:error:\s*)?device ['"]?[^'\r\n]*['"]? not found|waiting for device/i.test(stderr)) {
    return new AdbError('DEVICE_NOT_FOUND', excerpt(stderr))
  }
  if (/no devices\/emulators found/i.test(stderr)) {
    return new AdbError('NO_DEVICES', 'no connected devices/emulators; run adb_devices first, or connect one via adb_connect')
  }
  if (/failed to connect|cannot connect|connection refused/i.test(stderr)) {
    return new AdbError('CONNECT_FAILED', excerpt(stderr))
  }
  if (/error: closed/i.test(stderr)) {
    return new AdbError('ADB_DEVICE_CLOSED', 'adb device connection closed (device unplugged or crashed)')
  }
  const failure = /Failure \[([^\]]+)\]/.exec(`${stdout}\n${stderr}`)
  if (failure !== null) {
    return new AdbError('INSTALL_FAILED', `install failed: ${failure[1]}`)
  }
  return new AdbError(`ADB_EXIT_${result.exitCode}`, `adb exited with code ${result.exitCode}: ${excerpt(stderr || stdout)}`)
}

function excerpt(text: string, max = 500): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
