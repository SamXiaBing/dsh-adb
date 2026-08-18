import type { Context } from '@deepseek-ai/cordis'
import type { AdbConfig } from './adb.js'
import { classifyFailure, runAdb } from './adb.js'
import { parseDevices } from './parsers/devices.js'
import { matchesLevel, parseLogcat, type LogLevel } from './parsers/logcat.js'
import { capturePerfSnapshot } from './tools/perf.js'

export type RpcEndpointResult = { ok: true; value: unknown } | { ok: false; error: { message: string } }

type RpcConnection = {
  rpc?: {
    handle(
      channel: string,
      handler: (endpoint: string, raw: unknown, signal: AbortSignal) => Promise<RpcEndpointResult>,
      options: { authority: 'trusted-host' | 'loopback' },
    ): () => Promise<void>
  }
}

/**
 * Package-private Client↔Host RPC endpoint dispatch for the Web device panel.
 * Extracted from the connection handler so the endpoints are unit-testable
 * against a fake adb backend.
 */
export async function handleRpcEndpoint(
  ctx: Context,
  cfg: AdbConfig,
  endpoint: string,
  raw: unknown,
  signal: AbortSignal,
): Promise<RpcEndpointResult> {
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
}

/**
 * Register the Package-private Client↔Host RPC for the Web device panel
 * (conversation.view tab "设备"). Called lazily once the client connection
 * mounts; headless compositions (no connection) stay unaffected.
 */
export function registerRpc(ctx: Context, cfg: AdbConfig): void {
  const connection = ctx.get('connection') as RpcConnection | undefined
  const rpc = connection?.rpc
  if (rpc === undefined) return
  ctx.effect(() => rpc.handle(
    '/dsh-adb',
    (endpoint: string, raw: unknown, signal: AbortSignal) =>
      handleRpcEndpoint(ctx, cfg, endpoint, raw, signal),
    // Browser-only channel: accept requests from the loopback web GUI.
    { authority: 'loopback' },
  ))
}
