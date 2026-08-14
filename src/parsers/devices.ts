/** Parser for `adb devices -l` output. */

export interface AdbDevice {
  serial: string
  state: string
  product?: string
  model?: string
  device?: string
  transportId?: string
}

export function parseDevices(text: string): AdbDevice[] {
  const devices: AdbDevice[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line === 'List of devices attached') continue
    const parts = line.split(/\s+/)
    const serial = parts[0]
    const state = parts[1]
    if (serial === undefined || state === undefined) continue
    const device: AdbDevice = { serial, state }
    for (const part of parts.slice(2)) {
      const eq = part.indexOf(':')
      if (eq === -1) continue
      const key = part.slice(0, eq)
      const value = part.slice(eq + 1)
      if (key === 'product') device.product = value
      else if (key === 'model') device.model = value
      else if (key === 'device') device.device = value
      else if (key === 'transport_id') device.transportId = value
    }
    devices.push(device)
  }
  return devices
}
