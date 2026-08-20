import test from 'node:test'
import assert from 'node:assert/strict'
import { collectDeviceReport } from '../lib/report.js'

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
  '',
].join('\n')
const CRASH_OUT = [
  '08-14 10:31:00.000  1234  5678 F libc: Fatal signal 11 (SIGSEGV)',
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
  assert.equal(report.crashBuffer.total, 1)
  assert.equal(report.logcat.total, 3) // W/E/F only; the I entry is filtered out
  assert.match(report.logcat.entries[0].message, /warn/)
  assert.match(report.storage.excerpt, /\/data/)
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
})

test('collectDeviceReport honors include filtering and default serial', async () => {
  const report = await collectDeviceReport(fakeCtx(routerFor), { defaultSerial: 'abc123' }, signal, { include: ['device'] })
  assert.equal(report.serial, 'abc123')
  assert.ok(report.device !== undefined)
  assert.equal(report.processes, undefined)
  assert.equal(report.crashBuffer, undefined)
  assert.equal(report.logcat, undefined)
  assert.equal(report.storage, undefined)
})

test('collectDeviceReport caps lists by tail', async () => {
  const report = await collectDeviceReport(fakeCtx(routerFor), {}, signal, { serial: 'abc123', tail: 1 })
  assert.equal(report.logcat.total, 3)
  assert.equal(report.logcat.truncated, true)
  assert.equal(report.logcat.entries.length, 1)
  assert.equal(report.crashBuffer.entries.length, 1)
})
