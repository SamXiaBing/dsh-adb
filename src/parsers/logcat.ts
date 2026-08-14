/** Parser for `adb logcat -v threadtime` output. */

export type LogLevel = 'V' | 'D' | 'I' | 'W' | 'E' | 'F'

export interface LogcatEntry {
  time: string
  pid: string
  tid: string
  level: LogLevel
  tag: string
  message: string
}

const THREADTIME_LINE = /^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+):\s?(.*)$/

/** Parse threadtime lines; unrecognized lines are skipped (headers, sections). */
export function parseLogcat(text: string): LogcatEntry[] {
  const entries: LogcatEntry[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const match = THREADTIME_LINE.exec(rawLine)
    if (match === null) continue
    entries.push({
      time: match[1],
      pid: match[2],
      tid: match[3],
      level: match[4] as LogLevel,
      tag: match[5],
      message: match[6] ?? '',
    })
  }
  return entries
}

const LEVEL_ORDER: Record<LogLevel, number> = { V: 0, D: 1, I: 2, W: 3, E: 4, F: 5 }

export function matchesLevel(entry: LogcatEntry, minimum: LogLevel): boolean {
  return LEVEL_ORDER[entry.level] >= LEVEL_ORDER[minimum]
}

export function matchesKeyword(entry: LogcatEntry, keyword: string): boolean {
  return entry.message.includes(keyword) || entry.tag.includes(keyword)
}
