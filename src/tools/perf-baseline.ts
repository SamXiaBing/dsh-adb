import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { AdbError, jsonOutput, type AdbConfig } from '../adb.js'
import { createStore, diffSnapshots, type BaselineEntry } from '../baseline.js'
import { capturePerfSnapshot, type PerfMetric } from './perf.js'

type BaselineCommand = 'save' | 'compare' | 'list' | 'delete'

interface PerfBaselineArgs {
  command: BaselineCommand
  package?: string
  serial?: string
  metrics?: PerfMetric[]
  label?: string
  tags?: string[]
  id?: string
}

function publicMeta(entry: BaselineEntry): Record<string, unknown> {
  return {
    id: entry.id,
    label: entry.label,
    createdAt: entry.createdAt,
    device: entry.device,
    package: entry.package,
    tags: entry.tags ?? [],
  }
}

/** adb_perf_baseline: save/compare/list/delete perf snapshots as baselines. */
export function registerPerfBaselineTool(
  ctx: Context,
  cfg: AdbConfig,
  baselineDir: string,
): void {
  ctx.tools.register({
    name: 'adb_perf_baseline',
    description: 'Manage performance baselines for regression checks: save a snapshot as a baseline (label + optional tags), compare the current device state against a baseline and get a numeric diff report (PSS, janky %, frame percentiles), list stored baselines, or delete one. Baselines are stored locally on the host under the configured baselineDir.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['command'],
      properties: {
        command: {
          type: 'string',
          enum: ['save', 'compare', 'list', 'delete'],
          description: 'save: capture + store a baseline; compare: diff current state against a baseline (id, or latest for device+package); list: stored baselines; delete: remove one by id.',
        },
        package: { type: 'string', description: 'App package id; required for save and compare.' },
        serial: { type: 'string', description: 'Target device serial; defaults to the plugin defaultSerial.' },
        metrics: {
          type: 'array',
          items: { type: 'string', enum: ['meminfo', 'gfxinfo', 'battery'] },
          description: 'Which metrics to capture; defaults to all three.',
        },
        label: { type: 'string', description: 'Baseline label for save, e.g. the build/version under test.' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for save, e.g. ["release", "before-optimization"].',
        },
        id: { type: 'string', description: 'Baseline id; required for delete, optional for compare (defaults to the latest for device+package).' },
      },
    },
    output: jsonOutput(),
    async execute(args: PerfBaselineArgs, exec: ToolExecution) {
      const store = createStore(baselineDir)
      const device = args.serial ?? cfg.defaultSerial ?? 'default'

      if (args.command === 'list') {
        const entries = store.list().map(publicMeta)
        return { command: 'list', count: entries.length, baselines: entries }
      }

      if (args.command === 'delete') {
        if (args.id === undefined) throw new AdbError('ARGS_INVALID', 'delete requires a baseline id')
        const deleted = store.delete(args.id)
        if (!deleted) throw new AdbError('BASELINE_NOT_FOUND', `no baseline with id ${args.id}`)
        return { command: 'delete', deleted: true, id: args.id }
      }

      if (args.package === undefined) {
        throw new AdbError('ARGS_INVALID', `${args.command} requires a package`)
      }

      if (args.command === 'save') {
        const snapshot = await capturePerfSnapshot(ctx, cfg, exec.signal, {
          package: args.package,
          serial: args.serial,
          metrics: args.metrics,
        })
        const stored = store.save({
          label: args.label ?? `baseline-${new Date().toISOString().slice(0, 10)}`,
          device,
          package: args.package,
          ...(args.tags !== undefined && args.tags.length > 0 ? { tags: args.tags } : {}),
          snapshot,
        })
        return { command: 'save', saved: publicMeta(stored) }
      }

      // compare
      const baseline = args.id !== undefined
        ? store.get(args.id)
        : store.latest(device, args.package)
      if (baseline === undefined) {
        throw new AdbError(
          'BASELINE_NOT_FOUND',
          `no baseline for device ${device} package ${args.package}${args.id !== undefined ? ` (id ${args.id})` : ''}; save one with command=save first`,
        )
      }
      const current = await capturePerfSnapshot(ctx, cfg, exec.signal, {
        package: args.package,
        serial: args.serial,
        metrics: args.metrics,
      })
      const diffs = diffSnapshots(baseline.snapshot, current)
      return {
        command: 'compare',
        baseline: publicMeta(baseline),
        current: { package: current.package, metrics: current.metrics },
        diffs,
      }
    },
  })
}
