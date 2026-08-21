import test from 'node:test'
import assert from 'node:assert/strict'
import {
  checkBootComplete,
  checkDeviceOnline,
  checkLogcatKeyword,
  checkProcessPresent,
  waitForCondition,
} from '../lib/tools/wait.js'

// ---- Pure condition checks ----

test('checkDeviceOnline matches state=device, honoring serial', () => {
  const devices = [
    { serial: 'abc123', state: 'device' },
    { serial: 'def456', state: 'offline' },
  ]
  assert.equal(checkDeviceOnline(devices), true)
  assert.equal(checkDeviceOnline(devices, 'abc123'), true)
  assert.equal(checkDeviceOnline(devices, 'def456'), false) // offline is not online
  assert.equal(checkDeviceOnline(devices, 'ghost'), false)
  assert.equal(checkDeviceOnline([]), false)
})

test('checkBootComplete requires exactly "1"', () => {
  assert.equal(checkBootComplete('1'), true)
  assert.equal(checkBootComplete('1\n'), true)
  assert.equal(checkBootComplete('0'), false)
  assert.equal(checkBootComplete(''), false)
})

test('checkProcessPresent matches name substring', () => {
  const processes = [
    { pid: '1', name: 'init', rss: 100 },
    { pid: '2', name: 'com.example.hmi', rss: 200 },
  ]
  assert.equal(checkProcessPresent(processes, 'com.example'), true)
  assert.equal(checkProcessPresent(processes, 'com.example.hmi'), true)
  assert.equal(checkProcessPresent(processes, 'nope'), false)
  assert.equal(checkProcessPresent([], 'x'), false)
})

test('checkLogcatKeyword matches tag or message', () => {
  const entries = [
    { time: 't', pid: '1', tid: '1', level: 'E', tag: 'HmiApp', message: 'boom' },
  ]
  assert.equal(checkLogcatKeyword(entries, 'HmiApp'), true) // tag
  assert.equal(checkLogcatKeyword(entries, 'boom'), true) // message
  assert.equal(checkLogcatKeyword(entries, 'nope'), false)
  assert.equal(checkLogcatKeyword([], 'x'), false)
})

// ---- Poll loop (fake adb whose answers change over attempts) ----

function fakeCtx(probeCalls) {
  let callIndex = 0
  const subprocess = {
    resolveExecutable: async () => 'adb',
    spawn: (spec) => {
      const canned = probeCalls[Math.min(callIndex, probeCalls.length - 1)](spec.argv)
      callIndex++
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

const noDevices = () => ({ stdout: 'List of devices attached\n', stderr: '', exitCode: 0 })
const online = () => ({ stdout: 'List of devices attached\nabc123 device product:x model:y\n', stderr: '', exitCode: 0 })

test('waitForCondition device-online returns matched once the device appears', async () => {
  const ctx = fakeCtx([noDevices, noDevices, online])
  const result = await waitForCondition(ctx, {}, new AbortController().signal, {
    condition: 'device-online',
    serial: 'abc123',
    intervalMs: 250,
    timeoutMs: 5000,
  })
  assert.equal(result.matched, true)
  assert.equal(result.condition, 'device-online')
  assert.equal(result.attempts, 3)
  assert.ok(result.waitedMs >= 0)
})

test('waitForCondition returns matched:false on timeout without error', async () => {
  const ctx = fakeCtx([noDevices])
  const result = await waitForCondition(ctx, {}, new AbortController().signal, {
    condition: 'device-online',
    intervalMs: 250,
    timeoutMs: 600,
  })
  assert.equal(result.matched, false)
  assert.ok(result.attempts >= 1)
  assert.ok(result.reason !== undefined)
})

test('waitForCondition boot-complete accepts the getprop route', async () => {
  const stillBooting = () => ({ stdout: '0\n', stderr: '', exitCode: 0 })
  const booted = () => ({ stdout: '1\n', stderr: '', exitCode: 0 })
  const ctx = fakeCtx([stillBooting, booted])
  const result = await waitForCondition(ctx, {}, new AbortController().signal, {
    condition: 'boot-complete',
    intervalMs: 250,
    timeoutMs: 5000,
  })
  assert.equal(result.matched, true)
  assert.equal(result.attempts, 2)
})

test('waitForCondition process requires pattern and matches via ps', async () => {
  const noApp = () => ({ stdout: 'USER     PID   PPID  VSZ    RSS   WCHAN    ADDR S NAME\nroot      1     0     31264  1720  SyS_epoll 0    S init\n', stderr: '', exitCode: 0 })
  const appUp = () => ({ stdout: 'USER     PID   PPID  VSZ    RSS   WCHAN    ADDR S NAME\nroot      1     0     31264  1720  SyS_epoll 0    S init\nshell     5678  1     99999  8888  SyS_epoll 0    S com.example.hmi\n', stderr: '', exitCode: 0 })
  const ctx = fakeCtx([noApp, appUp])
  const result = await waitForCondition(ctx, {}, new AbortController().signal, {
    condition: 'process',
    pattern: 'com.example.hmi',
    intervalMs: 250,
    timeoutMs: 5000,
  })
  assert.equal(result.matched, true)
  assert.equal(result.attempts, 2)
})

test('waitForCondition logcat-pattern matches keyword in the main buffer', async () => {
  const quiet = () => ({ stdout: '08-14 10:30:12.345  1234  5678 I HmiApp: ok\n', stderr: '', exitCode: 0 })
  const noisy = () => ({ stdout: '08-14 10:30:12.345  1234  5678 I HmiApp: ok\n08-14 10:30:12.346  1234  5678 W HmiApp: MainActivity resumed\n', stderr: '', exitCode: 0 })
  const ctx = fakeCtx([quiet, noisy])
  const result = await waitForCondition(ctx, {}, new AbortController().signal, {
    condition: 'logcat-pattern',
    pattern: 'MainActivity',
    intervalMs: 250,
    timeoutMs: 5000,
  })
  assert.equal(result.matched, true)
  assert.equal(result.attempts, 2)
})

test('waitForCondition tolerates transient probe failures until the budget', async () => {
  // First probe throws (device not found), second succeeds — still matches.
  let calls = 0
  const ctx = fakeCtx([(argv) => {
    calls++
    if (calls === 1) return { stdout: '', stderr: "adb.exe: device 'ghost' not found", exitCode: 1 }
    return { stdout: 'List of devices attached\nghost device\n', stderr: '', exitCode: 0 }
  }])
  const result = await waitForCondition(ctx, {}, new AbortController().signal, {
    condition: 'device-online',
    serial: 'ghost',
    intervalMs: 250,
    timeoutMs: 5000,
  })
  assert.equal(result.matched, true)
  assert.equal(result.attempts, 2)
})

test('waitForCondition unknown condition throws', async () => {
  const ctx = fakeCtx([noDevices])
  await assert.rejects(
    waitForCondition(ctx, {}, new AbortController().signal, { condition: 'nope' }),
    /unknown condition/,
  )
})

test('waitForCondition process without pattern throws', async () => {
  const ctx = fakeCtx([noDevices])
  await assert.rejects(
    waitForCondition(ctx, {}, new AbortController().signal, { condition: 'process' }),
    /requires a non-empty "pattern"/,
  )
})
