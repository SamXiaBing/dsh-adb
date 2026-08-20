import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleRpcEndpoint } from '../lib/rpc.js'

const DEVICES_OUT = 'List of devices attached\nabc123 device product:matisse model:22011211C transport_id:1\n'
const PACKAGES_OUT = 'package:com.android.systemui\npackage:com.example.hmi\npackage:org.chromium.webview_shell\n'
const GETPROP_OUT = '[ro.product.model]: [22011211C]\n[ro.product.manufacturer]: [Xiaomi]\n[ro.build.version.release]: [13]\n[ro.build.version.sdk]: [33]\n[other]: [x]\n'
const WM_SIZE_OUT = 'Physical size: 1080x2400\n'
const MEMINFO_OUT = 'MemTotal:       1234567 kB\nMemFree:         12345 kB\n'
const PS_OUT = [
  'USER     PID   PPID  VSZ    RSS   WCHAN    ADDR S NAME',
  'root      1     0     31264  1720  SyS_epoll 0    S init',
  'system    1234  1     123456 23456 SyS_epoll 0    S com.android.systemui',
  'shell     5678  1234  99999  8888  SyS_epoll 0    S com.example.hmi',
  '',
].join('\n')
const GFXINFO_OUT = [
  'Total frames rendered: 240',
  'Janky frames: 12 (5.00%)',
  '50th percentile: 8ms',
  '90th percentile: 15ms',
  '95th percentile: 20ms',
  '99th percentile: 30ms',
  'Number Missed Vsync: 3',
].join('\n')
const LOGCAT_OUT = [
  '08-14 10:30:12.345  1234  5678 I HmiApp: ok',
  '08-14 10:30:12.346  1234  5678 W HmiApp: warn',
  '08-14 10:30:12.347  1234  5678 E HmiApp: err',
  '08-14 10:30:12.348  9999  7777 W Other: w2',
  '',
].join('\n')
const CRASH_OUT = [
  '08-14 10:31:00.000  1234  5678 F libc: Fatal signal 11 (SIGSEGV)',
  '08-14 10:31:00.001  1234  5678 E DEBUG: backtrace: #00 pc 0001',
  '',
].join('\n')
const DF_OUT = [
  'Filesystem      1K-blocks     Used Available Use% Mounted on',
  '/dev/block/sda5   58458112 30407680  28050432  53% /data',
  '',
].join('\n')

function routerFor(argv) {
  const joined = argv.join(' ')
  if (joined.includes('devices -l')) return { stdout: DEVICES_OUT, stderr: '', exitCode: 0 }
  if (joined.includes('pm list packages')) return { stdout: PACKAGES_OUT, stderr: '', exitCode: 0 }
  if (joined.includes('getprop')) return { stdout: GETPROP_OUT, stderr: '', exitCode: 0 }
  if (joined.includes('wm size')) return { stdout: WM_SIZE_OUT, stderr: '', exitCode: 0 }
  if (joined.includes('/proc/meminfo')) return { stdout: MEMINFO_OUT, stderr: '', exitCode: 0 }
  if (joined.includes('ps -A')) return { stdout: PS_OUT, stderr: '', exitCode: 0 }
  if (joined.includes('dumpsys meminfo')) {
    return { stdout: 'TOTAL PSS:    8192            TOTAL RSS:   10240        TOTAL SWAP PSS:    0\nApp Summary\n           Java Heap:    2048\n         Native Heap:    4096\n           Graphics:     512\n', stderr: '', exitCode: 0 }
  }
  if (joined.includes('dumpsys gfxinfo')) return { stdout: GFXINFO_OUT, stderr: '', exitCode: 0 }
  if (joined.includes('dumpsys battery')) return { stdout: '  level: 87\n  status: 2\n  temperature: 312\n', stderr: '', exitCode: 0 }
  if (joined.includes('logcat -b crash')) return { stdout: CRASH_OUT, stderr: '', exitCode: 0 }
  if (joined.includes('logcat')) return { stdout: LOGCAT_OUT, stderr: '', exitCode: 0 }
  if (joined.includes('shell df')) return { stdout: DF_OUT, stderr: '', exitCode: 0 }
  throw new Error(`unexpected adb argv: ${joined}`)
}

function fakeCtx(router) {
  const subprocess = {
    resolveExecutable: async () => 'adb',
    spawn: (spec) => {
      const canned = router(spec.argv)
      return {
        done: Promise.resolve({ exitCode: canned.exitCode, signal: null }),
        collected: {
          stdout: { readFrom: () => ({ text: canned.stdout, lossy: false }) },
          stderr: { readFrom: () => ({ text: canned.stderr, lossy: false }) },
        },
        terminate: () => {},
      }
    },
  }
  return { get: (name) => (name === 'subprocess' ? subprocess : undefined) }
}

const REPORT_DIR = mkdtempSync(join(tmpdir(), 'dsh-adb-rpc-report-'))
test.after(() => rmSync(REPORT_DIR, { recursive: true, force: true }))

function call(endpoint, payload, router = routerFor) {
  const signal = new AbortController().signal
  return handleRpcEndpoint(fakeCtx(router), {}, REPORT_DIR, endpoint, payload, signal)
}

test('rpc listDevices returns parsed devices', async () => {
  const result = await call('listDevices', {})
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.devices.length, 1)
    assert.equal(result.value.devices[0].serial, 'abc123')
  }
})

test('rpc listDevices maps adb failure to ok:false', async () => {
  const failing = (argv) => ({ stdout: '', stderr: "adb.exe: device 'ghost' not found", exitCode: 1 })
  const result = await call('listDevices', {}, failing)
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error.message, /not found/i)
})

test('rpc listPackages returns parsed package names', async () => {
  const result = await call('listPackages', { serial: 'abc123' })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.deepEqual(result.value.packages, ['com.android.systemui', 'com.example.hmi', 'org.chromium.webview_shell'])
  }
})

test('rpc deviceInfo composes model/release/sdk/resolution/memory', async () => {
  const result = await call('deviceInfo', { serial: 'abc123' })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.model, '22011211C')
    assert.equal(result.value.manufacturer, 'Xiaomi')
    assert.equal(result.value.release, '13')
    assert.equal(result.value.sdk, '33')
    assert.equal(result.value.resolution, '1080x2400')
    assert.equal(result.value.memTotalKb, 1234567)
  }
})

test('rpc processList filters by package', async () => {
  const result = await call('processList', { serial: 'abc123', package: 'com.example' })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.processes.length, 1)
    assert.equal(result.value.processes[0].pid, '5678')
    assert.equal(result.value.processes[0].name, 'com.example.hmi')
  }
})

test('rpc logcatDelta filters since/keyword/pid', async () => {
  const result = await call('logcatDelta', { serial: 'abc123', since: '08-14 10:30:12.346', keyword: 'err' })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.entries.length, 1)
    assert.equal(result.value.entries[0].message, 'err')
  }
  const byPid = await call('logcatDelta', { serial: 'abc123', pid: '1234' })
  assert.equal(byPid.ok, true)
  if (byPid.ok) assert.equal(byPid.value.entries.length, 3)
})

test('rpc logcatTail filters by level and caps by tail', async () => {
  const result = await call('logcatTail', { serial: 'abc123', level: 'W', tail: 2 })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.total, 3)
    assert.equal(result.value.truncated, true)
    assert.deepEqual(result.value.entries.map((e) => e.tag), ['HmiApp', 'Other'])
  }
})

test('rpc perfSnapshot parses meminfo/gfxinfo/battery', async () => {
  const result = await call('perfSnapshot', { package: 'com.android.systemui', serial: 'abc123' })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.meminfo.totalPssKb, 8192)
    assert.equal(result.value.gfxinfo.jankyPercent, 5)
    assert.equal(result.value.battery.levelPercent, 87)
  }
})

test('rpc perfSample returns meminfo and battery', async () => {
  const result = await call('perfSample', { package: 'com.example.hmi', serial: 'abc123' })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.package, 'com.example.hmi')
    assert.equal(result.value.meminfo.totalPssKb, 8192)
    assert.equal(result.value.battery.levelPercent, 87)
  }
})

test('rpc perfSnapshot rejects missing package', async () => {
  const result = await call('perfSnapshot', { serial: 'abc123' })
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error.message, /requires a string "package"/)
})

test('rpc unknown endpoint returns ok:false', async () => {
  const result = await call('nope', {})
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error.message, /unknown endpoint/)
})

test('rpc deviceReport collects all sections and persists', async () => {
  const result = await call('deviceReport', { serial: 'abc123' })
  assert.equal(result.ok, true)
  if (result.ok) {
    const value = result.value
    assert.equal(value.serial, 'abc123')
    assert.equal(value.device.model, '22011211C')
    assert.equal(value.device.resolution, '1080x2400')
    assert.equal(value.device.memTotalKb, 1234567)
    assert.equal(value.crashBuffer.total, 2)
    assert.equal(value.crashBuffer.realCrashCount, 1) // Fatal signal only; backtrace is following
    assert.equal(value.logcat.total, 3) // W/E/F only from the main buffer
    assert.ok(value.health !== undefined, 'health summary is included')
    assert.equal(value.health.verdict, 'attention') // the fatal signal drives attention
    assert.ok(value.health.issues.some((issue) => issue.includes('真实崩溃')))
    assert.ok(value.topProcesses === undefined || Array.isArray(value.topProcesses))
    assert.ok(value.storage.excerpt.includes('/data'))
    assert.deepEqual(value.errors, [])
    assert.match(value.savedTo, /abc123--\d+\.json/)
    // The report file is actually on disk and loadable.
    const stored = readFileSync(join(REPORT_DIR, value.savedTo), 'utf8')
    assert.match(stored, /22011211C/)
  }
})

test('rpc deviceReport degrades per-section on adb failure', async () => {
  const failing = (argv) => {
    const joined = argv.join(' ')
    if (joined.includes('logcat -b crash')) {
      return { stdout: '', stderr: "adb.exe: device 'ghost' not found", exitCode: 1 }
    }
    return routerFor(argv)
  }
  const result = await call('deviceReport', { serial: 'abc123' }, failing)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.crashBuffer, undefined)
    assert.equal(result.value.errors.length, 1)
    assert.equal(result.value.errors[0].section, 'crash')
    assert.ok(result.value.device !== undefined, 'other sections still collected')
  }
})

test('rpc deviceReport honors include filtering', async () => {
  const result = await call('deviceReport', { serial: 'abc123', include: ['device'] })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.ok(result.value.device !== undefined)
    assert.equal(result.value.crashBuffer, undefined)
    assert.equal(result.value.logcat, undefined)
    assert.deepEqual(result.value.errors, [])
  }
})
