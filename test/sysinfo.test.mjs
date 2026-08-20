import test from 'node:test'
import assert from 'node:assert/strict'
import { parseGetprop, parseMemTotal, parsePackageList, parseProcessList, parseWmSize } from '../lib/parsers/sysinfo.js'

test('parsePackageList extracts package: lines only', () => {
  const text = 'package:com.android.systemui\npackage:com.example.hmi\nnot-a-package\npackage:org.chromium.webview_shell\n'
  assert.deepEqual(parsePackageList(text), ['com.android.systemui', 'com.example.hmi', 'org.chromium.webview_shell'])
  assert.deepEqual(parsePackageList(''), [])
})

test('parseGetprop parses [key]: [value] pairs', () => {
  const text = '[ro.product.model]: [22011211C]\n[ro.build.version.release]: [13]\n[empty]: []\n[multi]: [a b c]\n'
  const props = parseGetprop(text)
  assert.equal(props['ro.product.model'], '22011211C')
  assert.equal(props['ro.build.version.release'], '13')
  assert.equal(props.empty, '')
  assert.equal(props.multi, 'a b c')
  assert.equal(props.missing, undefined)
})

test('parseProcessList extracts pid, rss and name, skips header', () => {
  const text = [
    'USER     PID   PPID  VSZ    RSS   WCHAN    ADDR S NAME',
    'root      1     0     31264  1720  SyS_epoll 0    S init',
    'system    1234  1     123456 23456 SyS_epoll 0    S com.android.systemui',
    '  shell   5678  1234  99999  8888  SyS_epoll 0    S com.example.hmi',
    '',
  ].join('\n')
  const entries = parseProcessList(text)
  assert.equal(entries.length, 3)
  assert.equal(entries[0].pid, '1')
  assert.equal(entries[0].name, 'init')
  assert.equal(entries[0].rss, 1720)
  assert.equal(entries[1].pid, '1234')
  assert.equal(entries[1].name, 'com.android.systemui')
  assert.equal(entries[1].rss, 23456)
  assert.equal(entries[2].pid, '5678')
  assert.equal(entries[2].rss, 8888)
})

test('parseMemTotal extracts kB', () => {
  assert.equal(parseMemTotal('MemTotal:       1234567 kB\nMemFree:         12345 kB\n'), 1234567)
  assert.equal(parseMemTotal('no memtotal here'), undefined)
})

test('parseWmSize parses physical size', () => {
  assert.deepEqual(parseWmSize('Physical size: 1080x2400\nOverride size: 720x1600\n'), { width: 1080, height: 2400 })
  assert.equal(parseWmSize('unknown'), undefined)
})
