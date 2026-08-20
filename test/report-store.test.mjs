import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listReports, loadReport, reportFileFor, saveReport } from '../lib/report-store.js'

const DIR = mkdtempSync(join(tmpdir(), 'dsh-adb-report-store-'))
test.after(() => rmSync(DIR, { recursive: true, force: true }))

function sampleReport(serial = 'abc123', collectedAt = '2026-08-19T08:00:00.000Z') {
  return {
    collectedAt,
    serial,
    device: { model: '22011211C' },
    processes: [{ pid: '1234', name: 'com.android.systemui', rss: 23456 }],
    errors: [],
  }
}

test('saveReport writes a serial-prefixed JSON file and returns meta', () => {
  const meta = saveReport(DIR, sampleReport())
  assert.match(meta.file, /^abc123--\d+\.json$/)
  assert.equal(meta.serial, 'abc123')
  assert.equal(meta.collectedAt, '2026-08-19T08:00:00.000Z')
  const raw = readFileSync(join(DIR, meta.file), 'utf8')
  const parsed = JSON.parse(raw)
  assert.equal(parsed.device.model, '22011211C')
})

test('loadReport round-trips the stored report and rejects foreign shapes', () => {
  const meta = saveReport(DIR, sampleReport('xyz789'))
  const loaded = loadReport(DIR, meta.file)
  assert.equal(loaded.serial, 'xyz789')
  assert.deepEqual(loaded.processes, [{ pid: '1234', name: 'com.android.systemui', rss: 23456 }])

  writeFileSync(join(DIR, 'junk--1.json'), '{not json', 'utf8')
  assert.throws(() => loadReport(DIR, 'junk--1.json'), /unreadable/)
  writeFileSync(join(DIR, 'bad--2.json'), JSON.stringify({ hello: 1 }), 'utf8')
  assert.throws(() => loadReport(DIR, 'bad--2.json'), /unexpected shape/)
})

test('listReports returns newest-first metadata and ignores foreign files', () => {
  const sub = mkdtempSync(join(tmpdir(), 'dsh-adb-report-store-list-'))
  try {
    saveReport(sub, sampleReport('a', '2026-08-19T08:00:00.000Z'))
    saveReport(sub, sampleReport('b', '2026-08-19T09:00:00.000Z'))
    writeFileSync(join(sub, 'README.txt'), 'ignored', 'utf8')
    const metas = listReports(sub)
    assert.equal(metas.length, 2)
    assert.deepEqual(metas.map((m) => m.serial).sort(), ['a', 'b'])
    assert.ok(Number(metas[0].id) >= Number(metas[1].id), 'newest first')
    assert.ok(metas.every((m) => m.file.endsWith('.json')))
  } finally {
    rmSync(sub, { recursive: true, force: true })
  }
})

test('listReports on a missing directory returns empty', () => {
  assert.deepEqual(listReports(join(DIR, 'does-not-exist')), [])
})

test('reportFileFor sanitizes serial characters', () => {
  assert.match(reportFileFor('abc:123'), /^abc_123--\d+\.json$/)
})
