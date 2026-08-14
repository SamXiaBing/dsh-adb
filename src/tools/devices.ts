import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { AdbError, classifyFailure, jsonOutput, runAdb, type AdbConfig } from '../adb.js'
import { parseDevices } from '../parsers/devices.js'

/** adb_devices / adb_connect / adb_disconnect. */
export function registerDeviceTools(ctx: Context, cfg: AdbConfig): void {
  ctx.tools.register({
    name: 'adb_devices',
    description: 'List connected Android devices (serial, state, product, model) visible to the adb server. Run this first to discover device serials before other adb_* tools.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: jsonOutput(),
    async execute(_args: unknown, exec: ToolExecution) {
      const result = await runAdb(ctx, cfg, ['devices', '-l'], { signal: exec.signal })
      if (result.exitCode !== 0) throw classifyFailure(result)
      return { server: 'ok', devices: parseDevices(result.stdout) }
    },
  })

  ctx.tools.register({
    name: 'adb_connect',
    description: 'Connect to a bench/device over TCP/IP (adb connect host:port). Wireless bench devices must be reachable from this machine.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['host'],
      properties: {
        host: { type: 'string', description: 'Device IP address or hostname, e.g. 192.168.1.100.' },
        port: { type: 'integer', description: 'TCP port; defaults to 5555.' },
      },
    },
    output: jsonOutput(),
    async execute(args: { host: string; port?: number }, exec: ToolExecution) {
      const target = `${args.host}:${args.port ?? 5555}`
      const result = await runAdb(ctx, cfg, ['connect', target], { signal: exec.signal })
      if (result.exitCode !== 0) throw classifyFailure(result)
      const message = result.stdout.trim()
      if (/failed to connect|cannot connect/i.test(message)) {
        throw new AdbError('CONNECT_FAILED', message)
      }
      return { target, connected: /connected|already connected/i.test(message), message }
    },
  })

  ctx.tools.register({
    name: 'adb_disconnect',
    description: 'Disconnect a TCP/IP device (adb disconnect [host:port]). Omit host to disconnect every wireless device.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        host: { type: 'string', description: 'Host or host:port to disconnect; omit to disconnect all.' },
      },
    },
    output: jsonOutput(),
    async execute(args: { host?: string }, exec: ToolExecution) {
      const argv = ['disconnect', ...(args.host !== undefined ? [args.host] : [])]
      const result = await runAdb(ctx, cfg, argv, { signal: exec.signal })
      if (result.exitCode !== 0) throw classifyFailure(result)
      return { message: result.stdout.trim() }
    },
  })
}
