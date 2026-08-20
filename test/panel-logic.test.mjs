import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

// Load the REAL client.js into a sandbox with no `window` and a fake `module`,
// so the dual-mode file exports its pure helpers (the browser branch is skipped).
const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const sandbox = { module: { exports: {} } }
vm.runInNewContext(code, sandbox, { filename: 'client.js' })
const { formatLogcatBlock, formatSnapshotBlock, formatReportBlock, extractAdbActivity, nodeArrayOf, DICTIONARY } = sandbox.module.exports

test('dictionary: zh and en share the same key set and every key resolves', () => {
  const zhKeys = Object.keys(DICTIONARY.zh).sort()
  const enKeys = Object.keys(DICTIONARY.en).sort()
  assert.deepEqual(zhKeys, enKeys)
  assert.ok(zhKeys.length >= 25, `expected >= 25 keys, got ${zhKeys.length}`)
  for (const key of zhKeys) {
    assert.ok(DICTIONARY.zh[key].length > 0, `zh empty for ${key}`)
    assert.ok(DICTIONARY.en[key].length > 0, `en empty for ${key}`)
  }
})

const ENTRIES = [
  { time: '08-14 10:30:12.345', pid: '1234', tid: '5678', level: 'E', tag: 'AndroidRuntime', message: 'FATAL EXCEPTION' },
  { time: '08-14 10:30:12.346', pid: '1234', tid: '5678', level: 'E', tag: 'AndroidRuntime', message: 'at com.example.Main.onCreate' },
]

test('formatLogcatBlock builds a send-to-chat text block', () => {
  const block = formatLogcatBlock(ENTRIES)
  assert.match(block, /^以下是从设备面板抓取的 logcat 片段（2 条），请分析：/)
  assert.match(block, /FATAL EXCEPTION/)
  assert.match(block, /```log/)
  assert.equal(formatLogcatBlock([]), '以下是从设备面板抓取的 logcat 片段（0 条），请分析：\n```log\n```')
})

test('formatSnapshotBlock renders meminfo/gfxinfo/battery rows', () => {
  const snapshot = {
    meminfo: { totalPssKb: 8192, totalRssKb: 10240, javaHeapKb: 2048, nativeHeapKb: 4096 },
    gfxinfo: { totalFrames: 240, jankyFrames: 12, jankyPercent: 5, percentile50Ms: 8, percentile90Ms: 15, percentile95Ms: 20, percentile99Ms: 30, missedVsync: 3 },
    battery: { levelPercent: 87, temperatureC: 31.2 },
  }
  const block = formatSnapshotBlock(snapshot)
  assert.match(block, /内存 PSS=8192KB/)
  assert.match(block, /卡顿=12\(5%\)/)
  assert.match(block, /电量=87%/)
  assert.match(block, /^以下是从设备面板抓取的性能快照，请分析：/)
})

test('formatReportBlock renders device summary, counts, top processes, and log blocks', () => {
  const report = {
    collectedAt: '2026-08-19T08:00:00.000Z',
    serial: 'abc123',
    device: { model: '22011211C', manufacturer: 'Xiaomi', release: '13', sdk: '33', resolution: '1080x2400', memTotalKb: 1234567 },
    topProcesses: [{ name: 'com.android.systemui', pid: '1234', rss: 23456 }, { name: 'com.example.hmi', pid: '5678', rss: 8888 }],
    crashBuffer: { total: 1, truncated: false, entries: [{ time: '08-19 07:59:00.000', pid: '1234', tid: '1', level: 'F', tag: 'libc', message: 'Fatal signal 11' }] },
    logcat: { total: 1, truncated: false, entries: [{ time: '08-19 07:59:01.000', pid: '1234', tid: '1', level: 'E', tag: 'HmiApp', message: 'boom' }] },
    errors: [],
    savedTo: 'abc123--42.json',
  }
  const block = formatReportBlock(report)
  assert.match(block, /^以下是从设备面板生成的一键体检报告/)
  assert.match(block, /22011211C · Xiaomi · Android 13 · API 33 · 1080x2400 · 内存 1206MB/)
  assert.match(block, /崩溃缓冲：1 条/)
  assert.match(block, /W\/E\/F 日志：1 条/)
  assert.match(block, /com\.android\.systemui\(23456KB\)/)
  assert.match(block, /Fatal signal 11/)
  assert.match(block, /boom/)
  assert.equal(formatReportBlock(null), '（无体检报告数据）')
})

test('formatReportBlock surfaces per-section collection errors', () => {
  const report = {
    collectedAt: '2026-08-19T08:00:00.000Z',
    serial: 'abc123',
    crashBuffer: { total: 0, truncated: false, entries: [] },
    logcat: { total: 0, truncated: false, entries: [] },
    errors: [{ section: 'device', message: 'adb.exe: device not found' }, { section: 'storage', message: 'Permission denied' }],
  }
  const block = formatReportBlock(report)
  assert.match(block, /采集失败：device: adb\.exe: device not found; storage: Permission denied/)
  assert.match(block, /崩溃缓冲：0 条/)
})

test('extractAdbActivity filters adb_* tool-call nodes, newest last-8 reversed', () => {
  const nodes = [
    { kind: 'user', root: null },
    { kind: 'tool-call', root: { name: 'bash', time: 1 } },
    { kind: 'tool-call', root: { name: 'adb_devices', time: 2 } },
    { kind: 'tool-call', root: { name: 'adb_logcat', time: 3 } },
    { kind: 'tool-call', root: { name: 'read', time: 4 } },
  ]
  const activity = JSON.parse(JSON.stringify(extractAdbActivity(nodes)))
  assert.deepStrictEqual(activity, [{ name: 'adb_logcat', time: 3 }, { name: 'adb_devices', time: 2 }])
  assert.deepStrictEqual(JSON.parse(JSON.stringify(extractAdbActivity([]))), [])
  assert.deepStrictEqual(JSON.parse(JSON.stringify(extractAdbActivity(null))), [])
})

test('nodeArrayOf reads snapshot.chat.nodes as Map or array', () => {
  const map = new Map([[1, { kind: 'tool-call', root: { name: 'adb_devices' } }]])
  assert.equal(nodeArrayOf({ chat: { nodes: map } }).length, 1)
  assert.equal(nodeArrayOf({ chat: { nodes: [{ kind: 'x' }] } }).length, 1)
  assert.equal(nodeArrayOf({ chat: {} }).length, 0)
  assert.equal(nodeArrayOf(undefined).length, 0)
})
