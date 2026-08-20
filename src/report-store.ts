import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { DeviceReport } from './report.js'

/**
 * Device health report store: one JSON file per report under a configurable
 * directory (`<baselineDir>/reports` by default). Read/write helpers are pure
 * fs functions so the store is unit-testable like the baseline store.
 * Filename: `<serial>--<epoch-ms>.json`; the id is the epoch prefix.
 */

export interface StoredReportMeta {
  id: string
  collectedAt: string
  serial: string
  file: string
}

export const DEFAULT_REPORT_DIR = `${homedir().replace(/\\/g, '/')}/.dsh/storages/dsh-adb/reports`

const FILE_PATTERN = /^(.+)--(\d+)\.json$/

/** Parse a report filename back into its meta; undefined for foreign files. */
function parseMeta(file: string): StoredReportMeta | undefined {
  const match = FILE_PATTERN.exec(file)
  if (match === null) return undefined
  return { id: match[2], collectedAt: '', serial: match[1], file }
}

export function reportFileFor(serial: string): string {
  const safeSerial = serial.replace(/[^A-Za-z0-9._-]/g, '_')
  return `${safeSerial}--${Date.now()}.json`
}

export function listReports(dir: string): StoredReportMeta[] {
  if (!existsSync(dir)) return []
  const metas: StoredReportMeta[] = []
  for (const name of readdirSync(dir)) {
    const meta = parseMeta(name)
    if (meta !== undefined) metas.push(meta)
  }
  // Newest first by epoch id.
  return metas.sort((a, b) => (Number(a.id) < Number(b.id) ? 1 : -1))
}

export function saveReport(dir: string, report: DeviceReport): StoredReportMeta {
  try {
    mkdirSync(dir, { recursive: true })
    const file = reportFileFor(report.serial)
    writeFileSync(join(dir, file), JSON.stringify(report, null, 2), 'utf8')
    return { id: String(Date.now()), collectedAt: report.collectedAt, serial: report.serial, file }
  } catch (error) {
    throw new Error(`report store unwritable at ${dir}: ${describe(error)}`)
  }
}

export function loadReport(dir: string, file: string): DeviceReport {
  try {
    const raw = readFileSync(join(dir, file), 'utf8')
    const parsed = JSON.parse(raw) as DeviceReport
    if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.errors) || typeof parsed.collectedAt !== 'string') {
      throw new Error('unexpected shape')
    }
    return parsed
  } catch (error) {
    throw new Error(`report store unreadable at ${join(dir, file)}: ${describe(error)}`)
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
