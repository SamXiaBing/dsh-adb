/** Pure parsers for device-system info (packages, getprop, processes, meminfo, wm). */

export function parsePackageList(text: string): string[] {
  const names: string[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith('package:')) continue
    const name = line.slice('package:'.length)
    if (name !== '') names.push(name)
  }
  return names
}

export function parseGetprop(text: string): Record<string, string> {
  const props: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const match = /^\[([^\]]+)\]:\s*\[([^\]]*)\]$/.exec(rawLine.trim())
    if (match === null) continue
    props[match[1]] = match[2]
  }
  return props
}

export interface ProcessEntry {
  pid: string
  name: string
}

/** Parse `ps -A` output (Android toybox: USER PID PPID VSZ RSS WCHAN ADDR S NAME). */
export function parseProcessList(text: string): ProcessEntry[] {
  const entries: ProcessEntry[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || /^USER\s+PID/.test(line)) continue
    const parts = line.split(/\s+/)
    // Android ps: index 1 = PID, last = NAME (comm may be in brackets)
    if (parts.length < 2) continue
    const pid = parts[1]
    const name = parts[parts.length - 1]
    if (pid !== undefined && name !== undefined && /^\d+$/.test(pid)) {
      entries.push({ pid, name })
    }
  }
  return entries
}

/** Parse /proc/meminfo "MemTotal: 123456 kB" into KB. */
export function parseMemTotal(text: string): number | undefined {
  const match = /^MemTotal:\s+(\d+)\s*kB/im.exec(text)
  return match === null ? undefined : Number(match[1])
}

/** Parse `wm size` -> "Physical size: 1080x2400". */
export function parseWmSize(text: string): { width: number; height: number } | undefined {
  const match = /Physical size:\s+(\d+)x(\d+)/.exec(text)
  if (match === null) return undefined
  return { width: Number(match[1]), height: Number(match[2]) }
}
