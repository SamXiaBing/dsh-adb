import test from 'node:test'
import assert from 'node:assert/strict'
import { handleRpcEndpoint } from '../lib/rpc.js'

const DEVICES_OUT = [
  'List of devices attached',
  'abc123 device product:matisse model:22011211C transport_id:1',
  '',
].join('\n')

const MEMINFO_OUT = [
  'TOTAL PSS:    8192            TOTAL RSS:   10240        TOTAL SWAP PSS:    0',
  'App Summary',
  '           Java Heap:    2048',
  '         Native Heap:    4096',
  '           Graphics:     512',
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

const BATTERY_OUT = '  level: 87\n  status: 2\n  temperature: 312\n'

const LOGCAT_OUT = [
  '08-14 10:30:12.345  1234  5678 I HmiApp: ok',
  '08-14 10:30:12.346  1234  5678 W HmiApp: warn',
  '08-14 10:30:12.347  1234  5678 E HmiApp: err',
  '08-14 10:30:12.348  1234  5678 W Other: w2',
  '',
].join('\n')

function routerFor(argv) {
  const joined = argv.join(' ')
  if (joined.includes('devices -l')) return { stdout: DEVICES_OUT, stderr: '', exitCode: 0 }
  if (joined.includes('dumpsys meminfo')) return { stdout: MEMINFO_OUT, stderr: '', exitCode: 0 }
  if (joined.includes('dumpsys gfxinfo')) return { stdout: GFXINFO_OUT, stderr: '', exitCode: 0 }
  if (joined.includes('dumpsys battery')) return { stdout: BATTERY_OUT, stderr: '', exitCode: 0 }
  if (joined.includes('logcat')) return { stdout: LOGCAT_OUT, stderr: '', exitCode: 0 }
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

function call(endpoint, payload, router = routerFor) {
  const signal = new AbortController().signal
  return handleRpcEndpoint(fakeCtx(router), {}, endpoint, payload, signal)
}

test('rpc listDevices returns parsed devices', async () => {
  const result = await call('listDevices', {})
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.devices.length, 1)
    assert.equal(result.value.devices[0].serial, 'abc123')
    assert.equal(result.value.devices[0].model, '22011211C')
  }
})

test('rpc listDevices maps adb failure to ok:false', async () => {
  const failing = (argv) => ({ stdout: '', stderr: "adb.exe: device 'ghost' not found", exitCode: 1 })
  const result = await call('listDevices', {}, failing)
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error.message, /not found/i)
})

test('rpc perfSnapshot parses meminfo/gfxinfo/battery', async () => {
  const result = await call('perfSnapshot', { package: 'com.android.systemui', serial: 'abc123' })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.package, 'com.android.systemui')
    assert.equal(result.value.meminfo.totalPssKb, 8192)
    assert.equal(result.value.gfxinfo.jankyPercent, 5)
    assert.equal(result.value.battery.levelPercent, 87)
  }
})

test('rpc perfSnapshot rejects missing package', async () => {
  const result = await call('perfSnapshot', { serial: 'abc123' })
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error.message, /requires a string "package"/)
})

test('rpc logcatTail filters by level and caps by tail', async () => {
  const result = await call('logcatTail', { serial: 'abc123', level: 'W', tail: 2 })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.total, 3) // W-level and above, before capping
    assert.equal(result.value.truncated, true)
    assert.deepEqual(result.value.entries.map((e) => e.tag), ['HmiApp', 'Other'])
  }
})

test('rpc logcatTail defaults tail when invalid', async () => {
  const result = await call('logcatTail', { serial: 'abc123', level: 'E', tail: 0 })
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.value.entries.length, 1)
})

test('rpc unknown endpoint returns ok:false', async () => {
  const result = await call('nope', {})
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error.message, /unknown endpoint/)
})
