import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyFailure } from '../lib/adb.js'
import { parseDevices } from '../lib/parsers/devices.js'
import { matchesLevel, matchesKeyword, parseLogcat } from '../lib/parsers/logcat.js'
import { parseBattery, parseGfxinfo, parseMeminfo } from '../lib/parsers/perf.js'

test('classifyFailure maps common adb errors to stable codes', () => {
  const cases = [
    { stderr: "error: device 'emulator-5554' not found", expected: 'DEVICE_NOT_FOUND' },
    { stderr: "adb.exe: device 'does-not-exist' not found", expected: 'DEVICE_NOT_FOUND' },
    { stderr: '- waiting for device -', expected: 'DEVICE_NOT_FOUND' },
    { stderr: 'error: no devices/emulators found', expected: 'NO_DEVICES' },
    { stderr: 'failed to connect to 192.168.1.100:5555', expected: 'CONNECT_FAILED' },
    { stderr: 'adb: error: failed to install app.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]', expected: 'INSTALL_FAILED' },
    { stdout: 'Failure [INSTALL_FAILED_ALREADY_EXISTS]', stderr: '', expected: 'INSTALL_FAILED' },
    { stderr: 'error: closed', expected: 'ADB_DEVICE_CLOSED' },
    { stderr: 'unknown thing happened', stdout: '', exitCode: 42, expected: 'ADB_EXIT_42' },
  ]
  for (const item of cases) {
    const error = classifyFailure({
      stdout: item.stdout ?? '',
      stderr: item.stderr ?? '',
      stdoutTruncated: false,
      stderrTruncated: false,
      exitCode: item.exitCode ?? 1,
    })
    assert.equal(error.code, item.expected, `case: ${item.stderr}`)
  }
})

test('parseDevices parses -l output with attributes', () => {
  const text = [
    'List of devices attached',
    'emulator-5554          device product:sdk_gphone64_x86_64 model:emulator device:emu64xa transport_id:1',
    '192.168.1.100:5555     device product:bench model:BENCH-01 device:bench',
    'deadbeef               offline',
  ].join('\n')
  const devices = parseDevices(text)
  assert.equal(devices.length, 3)
  assert.equal(devices[0].serial, 'emulator-5554')
  assert.equal(devices[0].state, 'device')
  assert.equal(devices[0].model, 'emulator')
  assert.equal(devices[0].transportId, '1')
  assert.equal(devices[1].serial, '192.168.1.100:5555')
  assert.equal(devices[2].state, 'offline')
})

test('parseDevices handles empty output', () => {
  assert.deepEqual(parseDevices('List of devices attached\n'), [])
  assert.deepEqual(parseDevices(''), [])
})

test('parseLogcat parses threadtime lines and skips headers', () => {
  const text = [
    '--------- beginning of main',
    '08-14 10:30:12.345  1234  5678 I HmiApp: render frame ok',
    '08-14 10:30:12.346  1234  5678 E HmiApp: render frame failed',
    'not a logcat line',
  ].join('\n')
  const entries = parseLogcat(text)
  assert.equal(entries.length, 2)
  assert.equal(entries[0].time, '08-14 10:30:12.345')
  assert.equal(entries[0].pid, '1234')
  assert.equal(entries[0].tid, '5678')
  assert.equal(entries[0].level, 'I')
  assert.equal(entries[0].tag, 'HmiApp')
  assert.equal(entries[0].message, 'render frame ok')
})

test('logcat level and keyword filters', () => {
  const entries = parseLogcat('08-14 10:30:12.345  1  2 V VerboseTag: v\n08-14 10:30:12.346  1  2 E ErrTag: crash happened')
  assert.equal(entries.filter((e) => matchesLevel(e, 'W')).length, 1)
  assert.equal(entries.filter((e) => matchesKeyword(e, 'crash')).length, 1)
  assert.equal(entries.filter((e) => matchesKeyword(e, 'frame')).length, 0)
})

test('parseMeminfo extracts totals and categories', () => {
  const text = [
    '** MEMINFO in pid 1234 [com.example.hmi] **',
    '                   Pss  Private  Private  Swap     Heap     Heap     Heap',
    '                 Total    Dirty    Clean  Dirty     Size    Alloc     Free',
    '                ------  ------  ------  ------  ------  ------  ------',
    '  Native Heap     4096     4096        0        0    8192     5120     3072',
    '  Dalvik Heap     2048     2048        0        0    4096     2048     2048',
    ' Graphics          512      512        0        0',
    'TOTAL PSS:    8192            TOTAL RSS:   10240        TOTAL SWAP PSS:    0',
    'App Summary',
    '                       Pss(KB)',
    '                       ------',
    '           Java Heap:    2048',
    '         Native Heap:    4096',
    '           Graphics:     512',
    '                Code:     1024',
  ].join('\n')
  const summary = parseMeminfo(text)
  assert.equal(summary.totalPssKb, 8192)
  assert.equal(summary.totalRssKb, 10240)
  assert.equal(summary.javaHeapKb, 2048)
  assert.equal(summary.nativeHeapKb, 4096)
  assert.equal(summary.graphicsKb, 512)
})

test('parseGfxinfo extracts frame stats', () => {
  const text = [
    'Total frames rendered: 240',
    'Janky frames: 12 (5.00%)',
    '50th percentile: 8ms',
    '90th percentile: 15ms',
    '95th percentile: 20ms',
    '99th percentile: 30ms',
    'Number Missed Vsync: 3',
    'Number High input latency: 0',
  ].join('\n')
  const summary = parseGfxinfo(text)
  assert.equal(summary.totalFrames, 240)
  assert.equal(summary.jankyFrames, 12)
  assert.equal(summary.jankyPercent, 5)
  assert.equal(summary.percentile90Ms, 15)
  assert.equal(summary.missedVsync, 3)
})

test('parseBattery extracts level, status, temperature', () => {
  const text = '  level: 87\n  scale: 100\n  status: 2\n  temperature: 312\n  technology: Li-ion\n'
  const summary = parseBattery(text)
  assert.equal(summary.levelPercent, 87)
  assert.equal(summary.status, 'charging')
  assert.equal(summary.temperatureC, 31.2)
})
