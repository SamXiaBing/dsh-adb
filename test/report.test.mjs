import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateByTag,
  buildHealthSummary,
  classifyCrashBuffer,
  collectDeviceReport,
  isBootMarker,
  isRealCrash,
} from '../lib/report.js'

const GETPROP_OUT = '[ro.product.model]: [22011211C]\n[ro.product.manufacturer]: [Xiaomi]\n[ro.build.version.release]: [13]\n[ro.build.version.sdk]: [33]\n[ro.build.fingerprint]: [Xiaomi/star]\n'
const WM_SIZE_OUT = 'Physical size: 1080x2400\n'
const MEMINFO_OUT = 'MemTotal:       1234567 kB\nMemFree:         12345 kB\n'
const PS_OUT = [
  'USER     PID   PPID  VSZ    RSS   WCHAN    ADDR S NAME',
  'root      1     0     31264  1720  SyS_epoll 0    S init',
  'system    1234  1     123456 23456 SyS_epoll 0    S com.android.systemui',
  'shell     5678  1234  99999  8888  SyS_epoll 0    S com.example.hmi',
  '',
].join('\n')
const LOGCAT_OUT = [
  '08-14 10:30:12.345  1234  5678 I HmiApp: ok',
  '08-14 10:30:12.346  1234  5678 W HmiApp: warn',
  '08-14 10:30:12.347  1234  5678 E HmiApp: err',
  '08-14 10:30:12.348  9999  7777 F Other: fatal',
  '08-14 10:30:12.349  9999  7777 W AOSP-MdnsDiscoveryManag: sendto failed: EPERM',
  '08-14 10:30:12.350  9999  7777 W AOSP-MdnsDiscoveryManag: sendto failed: EPERM',
  '',
].join('\n')
const CRASH_OUT = [
  '08-14 10:31:00.000  1234  5678 I emdlogger: mtk-brm-commit-id:abc',
  '08-14 10:31:00.001  1234  5678 F AndroidRuntime: FATAL EXCEPTION: main',
  '08-14 10:31:00.002  1234  5678 E AndroidRuntime: Process: com.example.hmi',
  '08-14 10:31:00.003  1234  5678 E AndroidRuntime: at com.example.Main.onCreate',
  '08-14 10:31:00.004  9999  7777 I SmartRatSwitch: mtk-brm-change-id:def',
  '',
].join('\n')
const DF_OUT = [
  'Filesystem      1K-blocks     Used Available Use% Mounted on',
  '/dev/block/sda5   58458112 30407680  28050432  53% /data',
  '',
].join('\n')

function routerFor(argv) {
  const joined = argv.join(' ')
  if (joined.includes('getprop')) return { stdout: GETPROP_OUT, stderr: '', exitCode: 0 }
  if (joined.includes('wm size')) return { stdout: WM_SIZE_OUT, stderr: '', exitCode: 0 }
  if (joined.includes('/proc/meminfo')) return { stdout: MEMINFO_OUT, stderr: '', exitCode: 0 }
  if (joined.includes('ps -A')) return { stdout: PS_OUT, stderr: '', exitCode: 0 }
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

const signal = new AbortController().signal

// ---- Evidence → signal pure helpers ----

test('isRealCrash / isBootMarker classify crash-buffer lines', () => {
  assert.equal(isRealCrash({ message: 'FATAL EXCEPTION: main', tag: 'AndroidRuntime', pid: '1' }), true)
  assert.equal(isRealCrash({ message: 'Fatal signal 11 (SIGSEGV)', tag: 'libc', pid: '1' }), true)
  assert.equal(isRealCrash({ message: 'at com.example.Main.onCreate', tag: 'AndroidRuntime', pid: '1' }), false)
  assert.equal(isRealCrash({ message: 'mtk-brm-commit-id:abc', tag: 'emdlogger', pid: '1' }), false)
  assert.equal(isBootMarker({ message: 'mtk-brm-commit-id:abc', tag: 'emdlogger', pid: '1' }), true)
  assert.equal(isBootMarker({ message: 'mtk-brm-change-id:def', tag: 'SmartRatSwitch', pid: '1' }), true)
  assert.equal(isBootMarker({ message: 'FATAL EXCEPTION', tag: 'AndroidRuntime', pid: '1' }), false)
})

test('classifyCrashBuffer splits real crashes from boot markers and groups chains', () => {
  const entries = [
    { time: 'a', pid: '1234', tid: '1', level: 'I', tag: 'emdlogger', message: 'mtk-brm-commit-id:abc' },
    { time: 'b', pid: '1234', tid: '2', level: 'F', tag: 'AndroidRuntime', message: 'FATAL EXCEPTION: main' },
    { time: 'c', pid: '1234', tid: '2', level: 'E', tag: 'AndroidRuntime', message: 'Process: com.example.hmi' },
    { time: 'd', pid: '1234', tid: '2', level: 'E', tag: 'AndroidRuntime', message: 'at com.example.Main.onCreate' },
    { time: 'e', pid: '9999', tid: '3', level: 'I', tag: 'SmartRatSwitch', message: 'mtk-brm-change-id:def' },
    { time: 'f', pid: '9999', tid: '3', level: 'W', tag: 'SomeTag', message: 'unrelated warning' },
  ]
  const summary = classifyCrashBuffer(entries)
  assert.equal(summary.total, 6)
  assert.equal(summary.realCrashCount, 1)
  assert.equal(summary.bootMarkerCount, 2)
  assert.equal(summary.otherCount, 3)
  assert.equal(summary.chains.length, 1)
  assert.equal(summary.chains[0].signature.message, 'FATAL EXCEPTION: main')
  // The same-pid tail captures the Process:/at stack lines but stops at the next pid.
  assert.deepEqual(summary.chains[0].following.map((e) => e.message), [
    'Process: com.example.hmi',
    'at com.example.Main.onCreate',
  ])
})

test('aggregateByTag collapses repetitive lines into counted groups with one sample', () => {
  const entries = [
    { time: '1', pid: '1', tid: '1', level: 'W', tag: 'AOSP-MdnsDiscoveryManag', message: 'sendto failed: EPERM' },
    { time: '2', pid: '1', tid: '1', level: 'W', tag: 'AOSP-MdnsDiscoveryManag', message: 'sendto failed: EPERM' },
    { time: '3', pid: '1', tid: '1', level: 'W', tag: 'AOSP-MdnsDiscoveryManag', message: 'sendto failed: EPERM' },
    { time: '4', pid: '1', tid: '1', level: 'E', tag: 'AOSP-MdnsDiscoveryManag', message: 'sendto failed: EPERM' },
    { time: '5', pid: '1', tid: '1', level: 'W', tag: 'PowerKeeper.Thermal', message: 'NumberFormatException' },
  ]
  const summary = aggregateByTag(entries, 10)
  assert.equal(summary.total, 5)
  assert.equal(summary.byTag.length, 3)
  const top = summary.byTag[0]
  assert.equal(top.tag, 'AOSP-MdnsDiscoveryManag')
  assert.equal(top.level, 'W')
  assert.equal(top.count, 3)
  assert.equal(top.sample.time, '1') // first sample kept
})

test('buildHealthSummary emits verdict, lines and issues', () => {
  const report = {
    device: { model: '22011211C', release: '13', memTotalKb: 1234567 },
    crashBuffer: {
      total: 6,
      realCrashCount: 1,
      bootMarkerCount: 2,
      otherCount: 3,
      chains: [{ signature: { tag: 'AndroidRuntime', message: 'FATAL EXCEPTION' }, following: [] }],
    },
    logcat: {
      total: 5,
      byTag: [
        { tag: 'AOSP-MdnsDiscoveryManag', level: 'W', count: 3, sample: { tag: 'AOSP-MdnsDiscoveryManag', message: 'sendto failed: EPERM (Operation not permitted)' } },
        { tag: 'PowerKeeper.Thermal', level: 'E', count: 1, sample: { tag: 'PowerKeeper.Thermal', message: 'NumberFormatException' } },
      ],
    },
    processes: [{ name: 'com.tencent.czn', rss: 987724 }, { name: 'system_server', rss: 498612 }],
  }
  const health = buildHealthSummary(report)
  assert.equal(health.verdict, 'attention')
  assert.equal(health.issues.length, 2)
  assert.match(health.issues[0], /真实崩溃 1 起（AndroidRuntime）/)
  assert.match(health.issues[1], /网络异常信号/)
  assert.ok(health.lines.some((line) => line.includes('内存大户：com.tencent.czn(987724KB), system_server(498612KB)')))
  assert.ok(health.lines.some((line) => line.includes('PowerKeeper.Thermal 为 MIUI 解析噪音')))
})

test('buildHealthSummary returns ok verdict when nothing is wrong', () => {
  const report = {
    device: { model: 'M', release: '13' },
    crashBuffer: { total: 42, realCrashCount: 0, bootMarkerCount: 42, otherCount: 0, chains: [] },
    logcat: { total: 0, byTag: [] },
    processes: [],
  }
  const health = buildHealthSummary(report)
  assert.equal(health.verdict, 'ok')
  assert.deepEqual(health.issues, [])
  assert.ok(health.lines.some((line) => line.includes('无真实崩溃')))
})

// ---- Collection integration ----

test('collectDeviceReport gathers all sections with rss-sorted processes', async () => {
  const report = await collectDeviceReport(fakeCtx(routerFor), {}, signal, { serial: 'abc123' })
  assert.equal(report.serial, 'abc123')
  assert.equal(report.device.model, '22011211C')
  assert.equal(report.device.fingerprint, 'Xiaomi/star')
  assert.equal(report.device.resolution, '1080x2400')
  assert.equal(report.device.memTotalKb, 1234567)
  assert.deepEqual(report.processes, [
    { pid: '1234', name: 'com.android.systemui', rss: 23456 },
    { pid: '5678', name: 'com.example.hmi', rss: 8888 },
    { pid: '1', name: 'init', rss: 1720 },
  ])
  assert.equal(report.crashBuffer.total, 5)
  assert.equal(report.crashBuffer.realCrashCount, 1)
  assert.equal(report.crashBuffer.bootMarkerCount, 2)
  assert.equal(report.crashBuffer.chains[0].signature.message, 'FATAL EXCEPTION: main')
  assert.equal(report.logcat.total, 5) // W/E/F only (the I line is filtered out)
  assert.equal(report.logcat.byTag[0].tag, 'AOSP-MdnsDiscoveryManag')
  assert.equal(report.logcat.byTag[0].count, 2)
  assert.match(report.storage.excerpt, /\/data/)
  assert.equal(report.health.verdict, 'attention')
  assert.deepEqual(report.errors, [])
})

test('collectDeviceReport degrades each failing section into errors', async () => {
  const failing = (argv) => {
    const joined = argv.join(' ')
    if (joined.includes('shell df')) return { stdout: '', stderr: 'df: permission denied', exitCode: 1 }
    if (joined.includes('logcat -b crash')) return { stdout: '', stderr: 'device offline', exitCode: 1 }
    return routerFor(argv)
  }
  const report = await collectDeviceReport(fakeCtx(failing), {}, signal, { serial: 'abc123' })
  assert.equal(report.storage, undefined)
  assert.equal(report.crashBuffer, undefined)
  assert.equal(report.errors.length, 2)
  const sections = report.errors.map((e) => e.section).sort()
  assert.deepEqual(sections, ['crash', 'storage'])
  assert.ok(report.device !== undefined, 'healthy sections still collected')
  assert.ok(report.logcat !== undefined)
  assert.equal(report.health.verdict, 'attention') // network signal still surfaced from logcat
})

test('collectDeviceReport honors include filtering and default serial', async () => {
  const report = await collectDeviceReport(fakeCtx(routerFor), { defaultSerial: 'abc123' }, signal, { include: ['device'] })
  assert.equal(report.serial, 'abc123')
  assert.ok(report.device !== undefined)
  assert.equal(report.processes, undefined)
  assert.equal(report.crashBuffer, undefined)
  assert.equal(report.logcat, undefined)
  assert.equal(report.storage, undefined)
  assert.equal(report.health.verdict, 'ok')
})

test('collectDeviceReport caps tag aggregates by tail', async () => {
  const report = await collectDeviceReport(fakeCtx(routerFor), {}, signal, { serial: 'abc123', tail: 1 })
  assert.equal(report.logcat.total, 5)
  assert.equal(report.logcat.byTag.length, 1)
  assert.equal(report.logcat.byTag[0].tag, 'AOSP-MdnsDiscoveryManag')
  assert.equal(report.crashBuffer.chains.length, 1)
})
