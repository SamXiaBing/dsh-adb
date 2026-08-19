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
const { formatLogcatBlock, formatSnapshotBlock, extractAdbActivity, nodeArrayOf, DICTIONARY } = sandbox.module.exports

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
