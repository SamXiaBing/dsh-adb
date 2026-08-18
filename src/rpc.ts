import { appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type { AdbConfig } from './adb.js'
import { classifyFailure, runAdb } from './adb.js'
import { parseDevices } from './parsers/devices.js'
import { matchesLevel, parseLogcat, type LogLevel } from './parsers/logcat.js'
import { capturePerfSnapshot } from './tools/perf.js'

type RpcConnection = {
  rpc?: {
    handle(
      channel: string,
      handler: (endpoint: string, raw: unknown, signal: AbortSignal) => Promise<{ ok: boolean; value?: unknown; error?: { message: string } }>,
      options: { authority: 'trusted-host' | 'loopback' },
    ): () => Promise<void>
  }
}

const DEBUG_FILE = `${homedir().replace(/\\/g, '/')}/.dsh/dsh-adb-rpc-debug.log`

/** Temporary diagnostics for the 405 investigation; remove once resolved. */
function dbg(message: string): void {
  try {
    appendFileSync(DEBUG_FILE, `${new Date().toISOString()} ${message}\n`, 'utf8')
  } catch {
    // diagnostics must never break the plugin
  }
}

export function registerRpc(ctx: Context, cfg: AdbConfig): void {
  const connection = ctx.get('connection') as RpcConnection | undefined
  if (connection === undefined || connection.rpc === undefined) {
    dbg('registerRpc: connection unavailable (skip)')
    return
  }
  dbg('registerRpc: connection found; calling rpc.handle(/dsh-adb)')
  let dispose: (() => Promise<void>) | undefined
  try {
    dispose = connection.rpc.handle(
      '/dsh-adb',
      async (endpoint: string, raw: unknown, signal: AbortSignal): Promise<{ ok: boolean; value?: unknown; error?: { message: string } }> => {
        try {
          const payload = (raw ?? {}) as Record<string, unknown>
          switch (endpoint) {
            case 'listDevices': {
              const result = await runAdb(ctx, cfg, ['devices', '-l'], { signal })
              if (result.exitCode !== 0) throw classifyFailure(result)
              return { ok: true, value: { server: 'ok', devices: parseDevices(result.stdout) } }
            }
            case 'perfSnapshot': {
              const pkg = typeof payload.package === 'string' ? payload.package : undefined
              if (pkg === undefined) throw new Error('perfSnapshot requires a string "package"')
              const serial = typeof payload.serial === 'string' ? payload.serial : undefined
              const snapshot = await capturePerfSnapshot(ctx, cfg, signal, { package: pkg, serial })
              return { ok: true, value: snapshot }
            }
            case 'logcatTail': {
              const serial = typeof payload.serial === 'string' ? payload.serial : undefined
              const level = typeof payload.level === 'string' ? payload.level : undefined
              const tail = typeof payload.tail === 'number' && payload.tail > 0 ? Math.floor(payload.tail) : 30
              const output = await runAdb(ctx, cfg, ['logcat', '-v', 'threadtime', '-d'], {
                signal,
                serial,
                maxBytes: 8 * 1024 * 1024,
              })
              if (output.exitCode !== 0) throw classifyFailure(output)
              let entries = parseLogcat(output.stdout)
              if (level !== undefined) entries = entries.filter((entry) => matchesLevel(entry, level as LogLevel))
              const capped = entries.slice(-tail)
              return { ok: true, value: { total: entries.length, truncated: entries.length > tail, entries: capped } }
            }
            default:
              return { ok: false, error: { message: `unknown endpoint: ${endpoint}` } }
          }
        } catch (error) {
          return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } }
        }
      },
      // Browser-only channel: accept requests from the loopback web GUI.
      { authority: 'loopback' },
    )
    dbg('registerRpc: rpc.handle returned OK (route registered)')
  } catch (error) {
    dbg(`registerRpc: rpc.handle THREW: ${String(error)}`)
    throw error
  }
  ctx.effect(() => {
    dbg('registerRpc: ctx.effect installing disposer')
    return dispose
  })
}
