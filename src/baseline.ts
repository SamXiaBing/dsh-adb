import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { homedir } from 'node:os'
import type { PerfSnapshot } from './tools/perf.js'

/**
 * Perf baseline store + numeric diff computation. Storage is a single JSON
 * file under a configurable directory; diff logic is pure and unit-tested.
 */

export interface BaselineMeta {
  id: string
  label: string
  createdAt: string
  device: string
  package: string
  tags?: string[]
}

export interface BaselineEntry extends BaselineMeta {
  snapshot: PerfSnapshot
}

export interface BaselineStoreData {
  version: 1
  baselines: BaselineEntry[]
}

export interface BaselineStore {
  list(): BaselineEntry[]
  get(id: string): BaselineEntry | undefined
  latest(device: string, pkg: string): BaselineEntry | undefined
  save(entry: Omit<BaselineEntry, 'id' | 'createdAt'>): BaselineEntry
  delete(id: string): boolean
}

export const DEFAULT_BASELINE_DIR = joinDefault()

function joinDefault(): string {
  return `${homedir().replace(/\\/g, '/')}/.dsh/storages/dsh-adb`
}

function filePath(dir: string): string {
  return `${dir.replace(/\\/g, '/')}/baselines.json`
}

function emptyData(): BaselineStoreData {
  return { version: 1, baselines: [] }
}

export function loadBaselines(dir: string): BaselineStoreData {
  const file = filePath(dir)
  if (!existsSync(file)) return emptyData()
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    throw new Error(`baseline store unreadable at ${file}: ${describe(error)}`)
  }
  try {
    const data = JSON.parse(raw) as BaselineStoreData
    if (data?.version !== 1 || !Array.isArray(data.baselines)) {
      throw new Error('unexpected shape')
    }
    return data
  } catch {
    throw new Error(`baseline store corrupted at ${file}: not valid version-1 JSON`)
  }
}

export function saveBaselines(dir: string, data: BaselineStoreData): void {
  const file = filePath(dir)
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
  } catch (error) {
    throw new Error(`baseline store unwritable at ${file}: ${describe(error)}`)
  }
}

export function createStore(dir: string): BaselineStore {
  return {
    list(): BaselineEntry[] {
      return loadBaselines(dir).baselines
    },
    get(id: string): BaselineEntry | undefined {
      return loadBaselines(dir).baselines.find((entry) => entry.id === id)
    },
    latest(device: string, pkg: string): BaselineEntry | undefined {
      const data = loadBaselines(dir)
      const matches = data.baselines.filter((entry) => entry.device === device && entry.package === pkg)
      if (matches.length === 0) return undefined
      return matches.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
    },
    save(entry: Omit<BaselineEntry, 'id' | 'createdAt'>): BaselineEntry {
      const data = loadBaselines(dir)
      const stored: BaselineEntry = {
        ...entry,
        id: `bl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
      }
      data.baselines.push(stored)
      saveBaselines(dir, data)
      return stored
    },
    delete(id: string): boolean {
      const data = loadBaselines(dir)
      const before = data.baselines.length
      data.baselines = data.baselines.filter((entry) => entry.id !== id)
      if (data.baselines.length === before) return false
      saveBaselines(dir, data)
      return true
    },
  }
}

/** Human-readable names for diff fields. */
export const FIELD_LABELS: Record<string, string> = {
  'meminfo.totalPssKb': 'Total PSS (KB)',
  'meminfo.totalRssKb': 'Total RSS (KB)',
  'meminfo.javaHeapKb': 'Java Heap (KB)',
  'meminfo.nativeHeapKb': 'Native Heap (KB)',
  'meminfo.graphicsKb': 'Graphics (KB)',
  'gfxinfo.totalFrames': 'Total frames',
  'gfxinfo.jankyFrames': 'Janky frames',
  'gfxinfo.jankyPercent': 'Janky %',
  'gfxinfo.percentile50Ms': '50th percentile (ms)',
  'gfxinfo.percentile90Ms': '90th percentile (ms)',
  'gfxinfo.percentile95Ms': '95th percentile (ms)',
  'gfxinfo.percentile99Ms': '99th percentile (ms)',
  'gfxinfo.missedVsync': 'Missed vsync',
  'battery.levelPercent': 'Battery level (%)',
  'battery.temperatureC': 'Temperature (°C)',
}

export interface FieldDiff {
  field: string
  label: string
  from?: number
  to?: number
  delta?: number
  deltaPercent?: number
}

const DIFF_FIELDS: Array<[string, string]> = [
  ['meminfo', 'totalPssKb'],
  ['meminfo', 'totalRssKb'],
  ['meminfo', 'javaHeapKb'],
  ['meminfo', 'nativeHeapKb'],
  ['meminfo', 'graphicsKb'],
  ['gfxinfo', 'totalFrames'],
  ['gfxinfo', 'jankyFrames'],
  ['gfxinfo', 'jankyPercent'],
  ['gfxinfo', 'percentile50Ms'],
  ['gfxinfo', 'percentile90Ms'],
  ['gfxinfo', 'percentile95Ms'],
  ['gfxinfo', 'percentile99Ms'],
  ['gfxinfo', 'missedVsync'],
  ['battery', 'levelPercent'],
  ['battery', 'temperatureC'],
]

/** Numeric diff between two snapshots; only fields present in both are reported. */
export function diffSnapshots(from: PerfSnapshot, to: PerfSnapshot): FieldDiff[] {
  const diffs: FieldDiff[] = []
  for (const [group, field] of DIFF_FIELDS) {
    const fromGroup = from as unknown as Record<string, Record<string, number | undefined>>
    const toGroup = to as unknown as Record<string, Record<string, number | undefined>>
    const fromValue = fromGroup[group]?.[field]
    const toValue = toGroup[group]?.[field]
    if (fromValue === undefined || toValue === undefined) continue
    const key = `${group}.${field}`
    const delta = toValue - fromValue
    diffs.push({
      field: key,
      label: FIELD_LABELS[key] ?? key,
      from: fromValue,
      to: toValue,
      delta,
      deltaPercent: fromValue === 0 ? undefined : (delta / fromValue) * 100,
    })
  }
  return diffs
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
