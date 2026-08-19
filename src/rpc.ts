import { readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AdbConfig } from './adb.js'
import { classifyFailure, runAdb } from './adb.js'
import { parseDevices } from './parsers/devices.js'
import { matchesKeyword, matchesLevel, parseLogcat, type LogLevel } from './parsers/logcat.js'
import {
  parseGetprop,
  parseMemTotal,
  parsePackageList,
  parseProcessList,
  parseWmSize,
  type ProcessEntry,
} from './parsers/sysinfo.js'
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

async function requireDevice(
  ctx: Context,
  cfg: AdbConfig,
  argv: string[],
  options: { serial?: string; signal: AbortSignal; maxBytes?: number },
): Promise<string> {
  const result = await runAdb(ctx, cfg, argv, { signal: options.signal, serial: options.serial, maxBytes: options.maxBytes })
  if (result.exitCode !== 0) throw classifyFailure(result)
  return result.stdout
}

function serialOf(payload: Record<string, unknown>): string | undefined {
  return typeof payload.serial === 'string' ? payload.serial : undefined
}

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
        const stdout = await requireDevice(ctx, cfg, ['devices', '-l'], { signal })
        return { ok: true, value: { server: 'ok', devices: parseDevices(stdout) } }
      }

      case 'listPackages': {
        const stdout = await requireDevice(ctx, cfg, ['shell', 'pm', 'list', 'packages'], {
          signal,
          serial: serialOf(payload),
          maxBytes: 4 * 1024 * 1024,
        })
        return { ok: true, value: { packages: parsePackageList(stdout) } }
      }

      case 'deviceInfo': {
        const serial = serialOf(payload)
        const getprop = parseGetprop(await requireDevice(ctx, cfg, ['shell', 'getprop'], { signal, serial, maxBytes: 2 * 1024 * 1024 }))
        const size = parseWmSize(await requireDevice(ctx, cfg, ['shell', 'wm', 'size'], { signal, serial }))
        const memTotalKb = parseMemTotal(await requireDevice(ctx, cfg, ['shell', 'cat', '/proc/meminfo'], { signal, serial }))
        return {
          ok: true,
          value: {
            model: getprop['ro.product.model'],
            manufacturer: getprop['ro.product.manufacturer'],
            release: getprop['ro.build.version.release'],
            sdk: getprop['ro.build.version.sdk'],
            resolution: size === undefined ? undefined : `${size.width}x${size.height}`,
            memTotalKb,
          },
        }
      }

      case 'processList': {
        const stdout = await requireDevice(ctx, cfg, ['shell', 'ps', '-A'], {
          signal,
          serial: serialOf(payload),
          maxBytes: 2 * 1024 * 1024,
        })
        let processes: ProcessEntry[] = parseProcessList(stdout)
        const pkg = typeof payload.package === 'string' ? payload.package : undefined
        if (pkg !== undefined) processes = processes.filter((entry) => entry.name.includes(pkg))
        processes = processes.slice(0, 100)
        return { ok: true, value: { total: processes.length, processes } }
      }

      case 'logcatTail':
      case 'logcatDelta': {
        const serial = serialOf(payload)
        const stdout = await requireDevice(ctx, cfg, ['logcat', '-v', 'threadtime', '-d'], {
          signal,
          serial,
          maxBytes: 8 * 1024 * 1024,
        })
        const since = typeof payload.since === 'string' ? payload.since : undefined
        const level = typeof payload.level === 'string' ? payload.level : undefined
        const keyword = typeof payload.keyword === 'string' ? payload.keyword : undefined
        const pid = typeof payload.pid === 'string' ? payload.pid : undefined
        const tail = typeof payload.tail === 'number' && payload.tail > 0 ? Math.floor(payload.tail) : 200
        let entries = parseLogcat(stdout)
        // threadtime timestamps ("MM-DD HH:MM:SS.mmm") sort lexicographically.
        if (since !== undefined) entries = entries.filter((entry) => entry.time > since)
        if (level !== undefined) entries = entries.filter((entry) => matchesLevel(entry, level as LogLevel))
        if (keyword !== undefined) entries = entries.filter((entry) => matchesKeyword(entry, keyword))
        if (pid !== undefined) entries = entries.filter((entry) => entry.pid === pid)
        const capped = entries.slice(-tail)
        return { ok: true, value: { total: entries.length, truncated: entries.length > tail, entries: capped } }
      }

      case 'perfSnapshot': {
        const pkg = typeof payload.package === 'string' ? payload.package : undefined
        if (pkg === undefined) throw new Error('perfSnapshot requires a string "package"')
        const snapshot = await capturePerfSnapshot(ctx, cfg, signal, { package: pkg, serial: serialOf(payload) })
        return { ok: true, value: snapshot }
      }

      case 'screenshot': {
        const serial = serialOf(payload)
        const devicePath = `/data/local/tmp/dsh-shot-${Date.now()}.png`
        const localPath = join(tmpdir(), `dsh-shot-${Date.now()}.png`)
        try {
          await requireDevice(ctx, cfg, ['shell', 'screencap', '-p', devicePath], { signal, serial })
          await requireDevice(ctx, cfg, ['pull', devicePath, localPath], { signal, serial })
          const bytes = readFileSync(localPath)
          return { ok: true, value: { mime: 'image/png', bytes: bytes.length, dataUrl: `data:image/png;base64,${bytes.toString('base64')}` } }
        } finally {
          try { unlinkSync(localPath) } catch { /* temp cleanup is best-effort */ }
        }
      }

      case 'perfSample': {
        const pkg = typeof payload.package === 'string' ? payload.package : undefined
        if (pkg === undefined) throw new Error('perfSample requires a string "package"')
        const snapshot = await capturePerfSnapshot(ctx, cfg, signal, { package: pkg, serial: serialOf(payload), metrics: ['meminfo', 'battery'] })
        return { ok: true, value: { package: pkg, meminfo: snapshot.meminfo, battery: snapshot.battery } }
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
