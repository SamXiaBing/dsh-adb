import { existsSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { AdbError, classifyFailure, jsonOutput, runAdb, type AdbConfig } from '../adb.js'

type FileOperation = 'pull' | 'push' | 'ls' | 'rm'

interface FileArgs {
  operation: FileOperation
  devicePath: string
  localPath?: string
  serial?: string
  recursive?: boolean
}

/** adb_file: pull / push / ls / rm on the target device. */
export function registerFileTool(ctx: Context, cfg: AdbConfig): void {
  ctx.tools.register({
    name: 'adb_file',
    description: 'Transfer or inspect files on an Android device: pull (device -> local), push (local -> device), ls (list a device directory), rm (delete a device file/dir).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['operation', 'devicePath'],
      properties: {
        operation: {
          type: 'string',
          enum: ['pull', 'push', 'ls', 'rm'],
          description: 'What to do: pull copies devicePath to localPath; push copies localPath to devicePath; ls lists devicePath; rm deletes devicePath.',
        },
        devicePath: { type: 'string', description: 'Path on the device (for pull/ls/rm) or the destination (for push).' },
        localPath: { type: 'string', description: 'Local path: destination for pull, source for push.' },
        serial: { type: 'string', description: 'Target device serial; defaults to the plugin defaultSerial.' },
        recursive: { type: 'boolean', description: 'Recursive for ls (long format) or rm (delete directory trees).' },
      },
    },
    output: jsonOutput(),
    async execute(args: FileArgs, exec: ToolExecution) {
      if (args.operation === 'push') {
        if (args.localPath === undefined) {
          throw new AdbError('ARGS_INVALID', 'push requires localPath (the source file)')
        }
        if (!existsSync(args.localPath)) {
          throw new AdbError('LOCAL_FILE_NOT_FOUND', `local file not found: ${args.localPath}`)
        }
      }
      const argv = buildArgv(args)
      const result = await runAdb(ctx, cfg, argv, { signal: exec.signal, serial: args.serial })
      if (result.exitCode !== 0) throw classifyFailure(result)
      const text = result.stdout.trim()
      if (args.operation === 'ls') {
        const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
        return { operation: args.operation, devicePath: args.devicePath, entries: lines }
      }
      return { operation: args.operation, devicePath: args.devicePath, ...(args.localPath !== undefined ? { localPath: args.localPath } : {}), message: text }
    },
  })
}

function buildArgv(args: FileArgs): string[] {
  if (args.operation === 'pull') {
    return ['pull', args.devicePath, args.localPath ?? '.']
  }
  if (args.operation === 'push') {
    return ['push', args.localPath as string, args.devicePath]
  }
  if (args.operation === 'ls') {
    return ['shell', 'ls', ...(args.recursive === true ? ['-lR'] : ['-l']), args.devicePath]
  }
  return ['shell', 'rm', ...(args.recursive === true ? ['-rf'] : ['-f']), args.devicePath]
}
