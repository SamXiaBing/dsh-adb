import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore, diffSnapshots, loadBaselines } from '../lib/baseline.js'

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'dsh-adb-test-'))
}

function snapshot(overrides = {}) {
  return {
    package: 'com.example.hmi',
    metrics: ['meminfo', 'gfxinfo'],
    meminfo: { totalPssKb: 100000, totalRssKb: 200000, javaHeapKb: 20000, nativeHeapKb: 30000, graphicsKb: 5000 },
    gfxinfo: { totalFrames: 240, jankyFrames: 12, jankyPercent: 5, percentile50Ms: 8, percentile90Ms: 15, percentile95Ms: 20, percentile99Ms: 30, missedVsync: 3 },
    ...overrides,
  }
}

test('diffSnapshots reports numeric deltas and percentages', () => {
  const from = snapshot()
  const to = snapshot({ gfxinfo: { totalFrames: 250, jankyFrames: 25, jankyPercent: 10, percentile50Ms: 10, percentile90Ms: 20, percentile95Ms: 25, percentile99Ms: 40, missedVsync: 5 } })
  const diffs = diffSnapshots(from, to)
  const janky = diffs.find((d) => d.field === 'gfxinfo.jankyPercent')
  assert.ok(janky)
  assert.equal(janky.from, 5)
  assert.equal(janky.to, 10)
  assert.equal(janky.delta, 5)
  assert.equal(janky.deltaPercent, 100)
  const pss = diffs.find((d) => d.field === 'meminfo.totalPssKb')
  assert.equal(pss.delta, 0)
})

test('diffSnapshots skips fields absent from either side', () => {
  const from = snapshot()
  const to = snapshot()
  delete to.meminfo
  delete to.gfxinfo
  const diffs = diffSnapshots(from, to)
  assert.equal(diffs.length, 0)
})

test('diffSnapshots skips battery when absent', () => {
  const from = snapshot()
  const to = snapshot({ battery: { levelPercent: 90, temperatureC: 35 } })
  const diffs = diffSnapshots(from, to)
  assert.equal(diffs.some((d) => d.field.startsWith('battery.')), false)
  const withBattery = diffSnapshots(to, to)
  assert.equal(withBattery.filter((d) => d.field.startsWith('battery.')).length, 2)
})

test('store save/list/get/latest/delete lifecycle', () => {
  const dir = tmpDir()
  try {
    const store = createStore(dir)
    assert.deepEqual(store.list(), [])
    const saved = store.save({
      label: 'release-1.2',
      device: 'serial-a',
      package: 'com.example.hmi',
      tags: ['release'],
      snapshot: snapshot(),
    })
    assert.ok(saved.id.startsWith('bl-'))
    assert.equal(store.list().length, 1)
    assert.equal(store.get(saved.id).label, 'release-1.2')
    assert.equal(store.latest('serial-a', 'com.example.hmi').id, saved.id)
    assert.equal(store.latest('serial-b', 'com.example.hmi'), undefined)
    const newer = store.save({
      label: 'release-1.3',
      device: 'serial-a',
      package: 'com.example.hmi',
      snapshot: snapshot(),
    })
    assert.equal(store.latest('serial-a', 'com.example.hmi').id, newer.id)
    assert.equal(store.delete(newer.id), true)
    assert.equal(store.delete(newer.id), false)
    assert.equal(store.list().length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('store fails loud on corrupted file', () => {
  const dir = tmpDir()
  try {
    writeFileSync(join(dir, 'baselines.json'), 'not json {', 'utf8')
    assert.throws(() => loadBaselines(dir), /corrupted/)
    assert.throws(() => createStore(dir).list(), /corrupted/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
