/** Parsers for `dumpsys` performance snapshots (meminfo / gfxinfo / battery). */

export interface MeminfoSummary {
  totalPssKb?: number
  totalRssKb?: number
  javaHeapKb?: number
  nativeHeapKb?: number
  graphicsKb?: number
}

export interface GfxinfoSummary {
  totalFrames?: number
  jankyFrames?: number
  jankyPercent?: number
  percentile50Ms?: number
  percentile90Ms?: number
  percentile95Ms?: number
  percentile99Ms?: number
  missedVsync?: number
}

export interface BatterySummary {
  levelPercent?: number
  status?: string
  temperatureC?: number
}

export function parseMeminfo(text: string): MeminfoSummary {
  const summary: MeminfoSummary = {}
  const total = /TOTAL PSS:\s+(\d+)\s+TOTAL RSS:\s+(\d+)/.exec(text)
  if (total !== null) {
    summary.totalPssKb = Number(total[1])
    summary.totalRssKb = Number(total[2])
  }
  const byName: Record<string, keyof MeminfoSummary> = {
    'Java Heap': 'javaHeapKb',
    'Native Heap': 'nativeHeapKb',
    Graphics: 'graphicsKb',
  }
  for (const [name, key] of Object.entries(byName)) {
    const match = new RegExp(`^\\s+${name}:\\s+(\\d+)`, 'm').exec(text)
    if (match !== null) summary[key] = Number(match[1])
  }
  return summary
}

export function parseGfxinfo(text: string): GfxinfoSummary {
  const summary: GfxinfoSummary = {}
  const total = /Total frames rendered:\s+(\d+)/.exec(text)
  if (total !== null) summary.totalFrames = Number(total[1])
  const janky = /Janky frames:\s+(\d+)\s*\(([\d.]+)%\)/.exec(text)
  if (janky !== null) {
    summary.jankyFrames = Number(janky[1])
    summary.jankyPercent = Number(janky[2])
  }
  const percentiles: Array<[RegExp, keyof GfxinfoSummary]> = [
    [/50th percentile:\s+(\d+)ms/, 'percentile50Ms'],
    [/90th percentile:\s+(\d+)ms/, 'percentile90Ms'],
    [/95th percentile:\s+(\d+)ms/, 'percentile95Ms'],
    [/99th percentile:\s+(\d+)ms/, 'percentile99Ms'],
  ]
  for (const [pattern, key] of percentiles) {
    const match = pattern.exec(text)
    if (match !== null) summary[key] = Number(match[1])
  }
  const missed = /Number Missed Vsync:\s+(\d+)/.exec(text)
  if (missed !== null) summary.missedVsync = Number(missed[1])
  return summary
}

const BATTERY_STATUS: Record<string, string> = {
  '1': 'unknown',
  '2': 'charging',
  '3': 'discharging',
  '4': 'not-charging',
  '5': 'full',
}

export function parseBattery(text: string): BatterySummary {
  const summary: BatterySummary = {}
  const level = /level:\s+(\d+)/.exec(text)
  if (level !== null) summary.levelPercent = Number(level[1])
  const status = /status:\s+(\d+)/.exec(text)
  if (status !== null) summary.status = BATTERY_STATUS[status[1]] ?? status[1]
  // temperature is reported in tenths of a degree Celsius
  const temperature = /temperature:\s+(\d+)/.exec(text)
  if (temperature !== null) summary.temperatureC = Number(temperature[1]) / 10
  return summary
}
