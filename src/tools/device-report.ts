import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { jsonOutput, type AdbConfig } from '../adb.js'
import { collectDeviceReport, REPORT_SECTIONS, type ReportSection } from '../report.js'
import { saveReport, type StoredReportMeta } from '../report-store.js'

interface DeviceReportArgs {
  serial?: string
  include?: ReportSection[]
  tail?: number
}

/**
 * adb_device_report: one-click device health check ("体检"). Collects device
 * identity, top RSS processes, crash buffer, the W/E/F logcat window, and
 * storage usage into one structured report, persists it under the report
 * store, and returns it for the agent to diagnose (pair with the
 * dsh-adb-crash-analysis skill).
 */
export function registerDeviceReportTool(ctx: Context, cfg: AdbConfig, reportDir: string): void {
  ctx.tools.register({
    name: 'adb_device_report',
    description: 'One-click device health report: collect device identity, top memory processes, the crash buffer (classified into real crashes vs. boot markers, with stack chains), the warning/error logcat window (aggregated by tag), storage usage, and a compact health summary (verdict + issues) into one structured snapshot, persist it to the report store, and return it. Each section degrades independently — a failing section lands in errors instead of failing the whole report. Pair the result with the dsh-adb-crash-analysis skill to diagnose the device state.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        serial: { type: 'string', description: 'Target device serial; defaults to the plugin defaultSerial.' },
        include: {
          type: 'array',
          items: { type: 'string', enum: [...REPORT_SECTIONS] },
          description: 'Which sections to collect; defaults to all five (device, processes, crash, logcat, storage).',
        },
        tail: { type: 'integer', description: 'Cap for crash/logcat entries and the process/storage lists; defaults to 100.' },
      },
    },
    output: jsonOutput(),
    async execute(args: DeviceReportArgs, exec: ToolExecution) {
      const report = await collectDeviceReport(ctx, cfg, exec.signal, args)
      let saved: StoredReportMeta | undefined
      try {
        saved = saveReport(reportDir, report)
      } catch {
        // Persistence is best-effort: the report is still returned to the agent.
      }
      return {
        collectedAt: report.collectedAt,
        serial: report.serial,
        ...(report.device !== undefined ? { device: report.device } : {}),
        ...(report.processes !== undefined ? { topProcesses: report.processes } : {}),
        ...(report.crashBuffer !== undefined ? { crashBuffer: report.crashBuffer } : {}),
        ...(report.logcat !== undefined ? { logcat: report.logcat } : {}),
        ...(report.storage !== undefined ? { storage: report.storage } : {}),
        ...(report.health !== undefined ? { health: report.health } : {}),
        errors: report.errors,
        ...(saved !== undefined ? { savedTo: saved.file } : {}),
      }
    },
  })
}
