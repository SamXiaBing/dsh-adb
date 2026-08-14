import { existsSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { AdbError, classifyFailure, jsonOutput, runAdb, type AdbConfig } from '../adb.js'

interface InstallArgs {
  apk: string
  serial?: string
  reinstall?: boolean
  downgrade?: boolean
  grantPermissions?: boolean
}

/** adb_install: push and install an apk on the target device. */
export function registerInstallTool(ctx: Context, cfg: AdbConfig): void {
  ctx.tools.register({
    name: 'adb_install',
    description: 'Install an APK on the target Android device (adb install). Requires a local path to the apk file.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['apk'],
      properties: {
        apk: { type: 'string', description: 'Local absolute path to the .apk file.' },
        serial: { type: 'string', description: 'Target device serial; defaults to the plugin defaultSerial.' },
        reinstall: { type: 'boolean', description: 'Reinstall an existing app, keeping its data (-r).' },
        downgrade: { type: 'boolean', description: 'Allow version downgrade (-d).' },
        grantPermissions: { type: 'boolean', description: 'Grant all runtime permissions (for targetSdk >= 23, -g).' },
      },
    },
    output: jsonOutput(),
    async execute(args: InstallArgs, exec: ToolExecution) {
      if (!existsSync(args.apk)) {
        throw new AdbError('LOCAL_FILE_NOT_FOUND', `apk not found: ${args.apk}`)
      }
      const flags = [
        ...(args.reinstall === true ? ['-r'] : []),
        ...(args.downgrade === true ? ['-d'] : []),
        ...(args.grantPermissions === true ? ['-g'] : []),
      ]
      const result = await runAdb(ctx, cfg, ['install', ...flags, args.apk], {
        signal: exec.signal,
        serial: args.serial,
      })
      if (result.exitCode !== 0) throw classifyFailure(result)
      const output = result.stdout.trim()
      return { installed: output.includes('Success'), package: args.apk, message: output }
    },
  })
}
