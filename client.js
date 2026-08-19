/* dsh-adb Web device panel (client half, v1.1.2) — plain JS, no build step.
 * Registers a "设备" tab in conversation.view and talks to the Host half over
 * the package RPC channel /dsh-adb. Uses only client builtins: React, ctx.
 * Dual-mode: in the browser it registers via __ModuleLoader__; when required
 * from Node (tests, via node:vm with a fake `module`), it exports the pure
 * helper functions (formatLogcatBlock / formatSnapshotBlock / extractAdbActivity).
 */
'use strict'

// ---- Pure helpers (shared by the panel and the unit tests) ----

function nodeArrayOf(snapshot) {
  try {
    const nodes = snapshot && snapshot.chat && snapshot.chat.nodes
    if (!nodes) return []
    if (typeof nodes.values === 'function') return Array.from(nodes.values())
    if (Array.isArray(nodes)) return nodes
    return []
  } catch {
    return []
  }
}

/** Extract recent adb_* tool calls from conversation nodes: [{name, time}]. */
function extractAdbActivity(nodes) {
  const out = []
  const list = Array.isArray(nodes) ? nodes : []
  for (const node of list) {
    if (!node || node.kind !== 'tool-call') continue
    const root = node.root
    const name = root && typeof root.name === 'string' ? root.name : ''
    if (!name.startsWith('adb_')) continue
    out.push({ name, time: root.time })
  }
  return out.slice(-8).reverse()
}

/** Format a logcat entry list into a send-to-conversation text block. */
function formatLogcatBlock(entries) {
  const lines = (Array.isArray(entries) ? entries : [])
    .map((e) => `${e.time} ${e.pid} ${e.tid} ${e.level} ${e.tag}: ${e.message}`)
  return [`以下是从设备面板抓取的 logcat 片段（${lines.length} 条），请分析：`, '```log', ...lines, '```'].join('\n')
}

/** Format a perf snapshot into a send-to-conversation text block. */
function formatSnapshotBlock(snapshot) {
  const rows = []
  const m = snapshot && snapshot.meminfo
  const g = snapshot && snapshot.gfxinfo
  const b = snapshot && snapshot.battery
  if (m) rows.push(`内存 PSS=${m.totalPssKb}KB RSS=${m.totalRssKb}KB JavaHeap=${m.javaHeapKb}KB NativeHeap=${m.nativeHeapKb}KB`)
  if (g) rows.push(`帧=${g.totalFrames} 卡顿=${g.jankyFrames}(${g.jankyPercent}%) P50=${g.percentile50Ms}ms P90=${g.percentile90Ms}ms P95=${g.percentile95Ms}ms P99=${g.percentile99Ms}ms MissedVsync=${g.missedVsync}`)
  if (b) rows.push(`电量=${b.levelPercent}% 温度=${b.temperatureC}°C`)
  return ['以下是从设备面板抓取的性能快照，请分析：', ...rows.map((r) => '- ' + r)].join('\n')
}

// ---- Browser entry ----

if (typeof window !== 'undefined' && typeof window.__ModuleLoader__ === 'object') {
  window.__ModuleLoader__.load({
    id: 'dsh-adb',
    factory: (require) => {
      const module = { exports: {} }

      const React = require('react')
      const CHANNEL = '/dsh-adb'

      function unwrap(value) {
        if (typeof value !== 'object' || value === null || !('ok' in value)) {
          throw new Error('dsh-adb host returned an invalid response.')
        }
        if (value.ok === true && 'value' in value) return value.value
        if (value.ok === false && value.error) {
          throw new Error(value.error.message ?? 'dsh-adb request failed.')
        }
        throw new Error('dsh-adb host returned an invalid response.')
      }

      function createRuntime(rpc) {
        const call = (endpoint, payload) => rpc.call(CHANNEL, endpoint, payload).then(unwrap)
        return {
          listDevices: () => call('listDevices', {}),
          listPackages: (payload) => call('listPackages', payload),
          deviceInfo: (payload) => call('deviceInfo', payload),
          processList: (payload) => call('processList', payload),
          logcatDelta: (payload) => call('logcatDelta', payload),
          perfSnapshot: (payload) => call('perfSnapshot', payload),
        }
      }

      const h = React.createElement
      const ROW = { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', flexWrap: 'wrap' }
      const BTN = { padding: '3px 10px', cursor: 'pointer' }
      const INPUT = { padding: '3px 6px' }
      const SECTION = { marginTop: 14, borderTop: '1px solid var(--dsh-border, #ddd)', paddingTop: 10 }
      const DROPDOWN = {
        position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: 180, overflowY: 'auto',
        background: 'var(--dsh-bg, #ffffff)', color: 'inherit',
        border: '1px solid var(--dsh-border, #ccc)', borderRadius: 4, zIndex: 20, boxShadow: '0 2px 8px rgba(0,0,0,.2)',
      }
      const DROPDOWN_ITEM = { padding: '4px 8px', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

      function MetricRows({ rows }) {
        if (!rows || rows.length === 0) return h('div', null, '（无数据）')
        return h('table', { style: { borderCollapse: 'collapse' } },
          rows.map((row) => h('tr', { key: row[0] },
            h('td', { style: { padding: '2px 12px 2px 0', color: 'var(--dsh-text-secondary, #888)' } }, row[0]),
            h('td', { style: { padding: '2px 0' } }, String(row[1])),
          )),
        )
      }

      function PackageCombobox({ packages, value, placeholder, onChange }) {
        const [query, setQuery] = React.useState('')
        const [open, setOpen] = React.useState(false)
        const shown = open
          ? packages.filter((name) => query === '' || name.toLowerCase().includes(query.toLowerCase())).slice(0, 60)
          : []
        return h('div', { style: { position: 'relative', flex: 1, minWidth: 220 } },
          h('input', {
            style: { ...INPUT, width: '100%', boxSizing: 'border-box' },
            value: query,
            placeholder: value || placeholder || '',
            onChange: (e) => { setQuery(e.target.value); setOpen(true) },
            onFocus: () => setOpen(true),
            onBlur: () => setTimeout(() => { setOpen(false); setQuery('') }, 150),
            onKeyDown: (e) => {
              if (e.key === 'Enter' && shown.length > 0) { onChange(shown[0]); setQuery(''); setOpen(false) }
            },
          }),
          open && shown.length > 0 && h('div', { style: DROPDOWN },
            shown.map((name) => h('div', {
              key: name,
              onMouseDown: () => { onChange(name); setQuery(''); setOpen(false) },
              onMouseEnter: (e) => { e.currentTarget.style.background = 'var(--dsh-accent-soft, rgba(66,133,244,.12))' },
              onMouseLeave: (e) => { e.currentTarget.style.background = 'transparent' },
              style: DROPDOWN_ITEM,
            }, name))),
        )
      }

      function DeviceView(props) {
        const runtime = props.runtime
        const [devices, setDevices] = React.useState([])
        const [selected, setSelected] = React.useState(null)
        const [info, setInfo] = React.useState(null)
        const [packages, setPackages] = React.useState([])
        const [pkg, setPkg] = React.useState('com.android.systemui')
        const [snapshot, setSnapshot] = React.useState(null)
        const [processes, setProcesses] = React.useState([])
        const [logEntries, setLogEntries] = React.useState([])
        const [logLevel, setLogLevel] = React.useState('V')
        const [logKeyword, setLogKeyword] = React.useState('')
        const [logPkg, setLogPkg] = React.useState('')
        const [logPids, setLogPids] = React.useState([])
        const [logPaused, setLogPaused] = React.useState(false)
        const [logAuto, setLogAuto] = React.useState(true)
        const [error, setError] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const logRef = React.useRef(null)
        const sinceRef = React.useRef('')
        const selectedRef = React.useRef(null)
        const levelFilterRef = React.useRef('V')
        const keywordFilterRef = React.useRef('')
        const pidsFilterRef = React.useRef([])

        selectedRef.current = selected

        // Agent adb activity from the live session snapshot (standard prop).
        const adbActivity = props.useSession
          ? props.useSession((snap) => extractAdbActivity(nodeArrayOf(snap)))
          : []
        const sendToChat = (text) => {
          if (props.inputActions && typeof props.inputActions.setDraft === 'function') {
            props.inputActions.setDraft(text)
          }
        }

        const fail = (e) => setError(String((e && e.message) || e))

        const refresh = () => {
          setBusy(true); setError(null)
          runtime.listDevices()
            .then((value) => setDevices(value.devices ?? []))
            .catch(fail)
            .finally(() => setBusy(false))
        }
        React.useEffect(refresh, [])

        const selectDevice = (device) => {
          setSelected(device)
          setInfo(null); setSnapshot(null); setProcesses([])
          setLogEntries([]); setLogPids([]); pidsFilterRef.current = []; sinceRef.current = ''
          setBusy(true); setError(null)
          Promise.all([
            runtime.deviceInfo({ serial: device.serial }).then(setInfo),
            runtime.listPackages({ serial: device.serial }).then((v) => setPackages(v.packages ?? [])),
          ]).catch(fail).finally(() => setBusy(false))
        }

        const loadProcesses = (pkgName) => {
          const device = selectedRef.current
          if (!device) return
          runtime.processList({ serial: device.serial, package: pkgName })
            .then((v) => setProcesses(v.processes ?? []))
            .catch(fail)
        }
        React.useEffect(() => { if (selected) loadProcesses(pkg) }, [pkg]) // eslint-disable-line react-hooks/exhaustive-deps

        const runSnapshot = () => {
          if (!selected) return
          setBusy(true); setError(null)
          runtime.perfSnapshot({ serial: selected.serial, package: pkg })
            .then(setSnapshot)
            .catch(fail)
            .finally(() => setBusy(false))
        }

        const applyPackageFilter = (name) => {
          setLogPkg(name)
          setLogEntries([]); sinceRef.current = ''
          if (name === '') {
            setLogPids([]); pidsFilterRef.current = []
            return
          }
          const device = selectedRef.current
          if (!device) return
          runtime.processList({ serial: device.serial, package: name })
            .then((v) => {
              const pids = (v.processes ?? []).map((p) => p.pid)
              setLogPids(pids); pidsFilterRef.current = pids
            })
            .catch(fail)
        }

        const applyLogFilters = (level, keyword, pids) => {
          levelFilterRef.current = level
          keywordFilterRef.current = keyword
          pidsFilterRef.current = pids
          setLogEntries([])
          sinceRef.current = ''
        }

        React.useEffect(() => {
          if (!selected || logPaused) return
          const timer = setInterval(() => {
            runtime.logcatDelta({
              serial: selected.serial,
              since: sinceRef.current,
              level: levelFilterRef.current,
              keyword: keywordFilterRef.current || undefined,
              tail: 200,
            }).then((value) => {
              let entries = value.entries ?? []
              const pids = pidsFilterRef.current
              if (pids.length > 0) entries = entries.filter((e) => pids.includes(e.pid))
              if (entries.length > 0) {
                setLogEntries((prev) => {
                  const seen = new Set(prev.map((e) => `${e.time}:${e.pid}:${e.message}`))
                  const fresh = entries.filter((e) => !seen.has(`${e.time}:${e.pid}:${e.message}`))
                  const next = [...prev, ...fresh]
                  return next.length > 500 ? next.slice(-500) : next
                })
                sinceRef.current = entries[entries.length - 1].time
              }
            }).catch(() => { /* transient poll errors are ignored */ })
          }, 1500)
          return () => clearInterval(timer)
        }, [selected, logPaused])

        React.useEffect(() => {
          const el = logRef.current
          if (el && logAuto) el.scrollTop = el.scrollHeight
        }, [logEntries, logAuto])

        const snapshotRows = []
        if (snapshot) {
          const m = snapshot.meminfo; const g = snapshot.gfxinfo; const b = snapshot.battery
          if (m) snapshotRows.push(['内存 PSS (KB)', m.totalPssKb], ['内存 RSS (KB)', m.totalRssKb], ['Java Heap (KB)', m.javaHeapKb], ['Native Heap (KB)', m.nativeHeapKb])
          if (g) snapshotRows.push(['总帧数', g.totalFrames], ['卡顿帧 / %', `${g.jankyFrames} / ${g.jankyPercent}%`], ['P50/P90 (ms)', `${g.percentile50Ms} / ${g.percentile90Ms}`], ['P95/P99 (ms)', `${g.percentile95Ms} / ${g.percentile99Ms}`])
          if (b) snapshotRows.push(['电量', `${b.levelPercent}%`], ['温度 (°C)', b.temperatureC])
        }
        const infoRows = info
          ? [['型号', info.model], ['厂商', info.manufacturer], ['Android', info.release], ['API', info.sdk], ['分辨率', info.resolution], ['内存总量', info.memTotalKb ? `${Math.round(info.memTotalKb / 1024)} MB` : undefined]].filter((r) => r[1] !== undefined && r[1] !== null)
          : []

        const pidsLabel = logPids.length > 0 ? ` · pid=${logPids.join(',')}` : ''

        return h('div', { style: { padding: 12, fontFamily: 'inherit', fontSize: 13 } },
          h('div', { style: { ...ROW, justifyContent: 'space-between' } },
            h('strong', null, 'ADB 设备'),
            h('button', { style: BTN, onClick: refresh, disabled: busy }, busy ? '…' : '刷新'),
          ),
          error !== null && h('div', { style: { color: '#e5484d', margin: '6px 0', wordBreak: 'break-all' } }, String(error)),
          devices.length === 0
            ? h('div', { style: { color: 'var(--dsh-text-secondary, #888)', margin: '8px 0' } }, '未连接设备')
            : h('div', null, devices.map((d) =>
                h('button', {
                  key: d.serial,
                  onClick: () => selectDevice(d),
                  style: { ...BTN, display: 'block', width: '100%', textAlign: 'left', margin: '2px 0',
                    background: selected && selected.serial === d.serial ? 'var(--dsh-accent-soft, rgba(66,133,244,.15))' : 'transparent' },
                }, `${d.serial} · ${d.state}${d.model ? ' · ' + d.model : ''}`),
              )),

          adbActivity.length > 0 && h('div', { style: SECTION },
            h('strong', null, 'agent 的 adb 操作'),
            h('div', { style: { marginTop: 4, fontSize: 12, color: 'var(--dsh-text-secondary, #888)' } },
              adbActivity.map((a, i) => h('div', { key: `${a.name}-${i}` }, `• ${a.name}${a.time ? '  @ ' + a.time : ''}`))),
          ),

          selected !== null && h('div', { style: { marginTop: 14 } },
            info !== null && infoRows.length > 0 && h('div', { style: SECTION },
              h('strong', null, '设备信息'),
              h(MetricRows, { rows: infoRows }),
            ),

            h('div', { style: SECTION },
              h('div', { style: ROW },
                h('label', null, '包名'),
                h(PackageCombobox, { packages, value: pkg, placeholder: '输入或选择包名', onChange: (name) => setPkg(name) }),
                h('button', { style: BTN, onClick: runSnapshot, disabled: busy }, '性能快照'),
                snapshot && h('button', { style: BTN, onClick: () => sendToChat(formatSnapshotBlock(snapshot)) }, '发送到对话'),
              ),
              snapshot && h('div', { style: { marginTop: 8 } }, h(MetricRows, { rows: snapshotRows })),

              processes.length > 0 && h('div', { style: { marginTop: 8 } },
                h('div', { style: { color: 'var(--dsh-text-secondary, #888)' } }, `进程（${processes.length}）— 点击按 pid 过滤 logcat`),
                h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 } },
                  processes.map((p) => {
                    const active = logPids.length === 1 && logPids[0] === p.pid
                    return h('button', {
                      key: p.pid,
                      onClick: () => {
                        const next = active ? [] : [p.pid]
                        setLogPids(next); applyLogFilters(logLevel, logKeyword, next)
                      },
                      style: { ...BTN, fontSize: 11, background: active ? 'var(--dsh-accent-soft, rgba(66,133,244,.15))' : 'transparent' },
                    }, `${p.pid} ${p.name}`)
                  })),
              ),
            ),

            h('div', { style: SECTION },
              h('div', { style: ROW },
                h('label', null, 'logcat'),
                h('select', { style: INPUT, value: logLevel, onChange: (e) => { setLogLevel(e.target.value); applyLogFilters(e.target.value, logKeyword, logPids) } },
                  ['V', 'D', 'I', 'W', 'E', 'F'].map((lv) => h('option', { key: lv, value: lv }, lv))),
                h('input', { style: { ...INPUT, minWidth: 130 }, placeholder: '关键字过滤', value: logKeyword, onChange: (e) => { setLogKeyword(e.target.value); applyLogFilters(logLevel, e.target.value, logPids) } }),
                h('div', { style: { flex: 1, minWidth: 180 } },
                  h(PackageCombobox, { packages, value: logPkg, placeholder: logPkg || '包名过滤（按进程）', onChange: applyPackageFilter })),
                h('button', { style: BTN, onClick: () => setLogPaused(!logPaused) }, logPaused ? '继续' : '暂停'),
                h('button', { style: BTN, onClick: () => { setLogEntries([]); sinceRef.current = '' } }, '清空'),
                h('button', { style: BTN, onClick: () => sendToChat(formatLogcatBlock(logEntries)), disabled: logEntries.length === 0 }, '发送到对话'),
                h('label', { style: { fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 } },
                  h('input', { type: 'checkbox', checked: logAuto, onChange: (e) => setLogAuto(e.target.checked) }), ' 自动滚动'),
              ),
              h('div', { style: { color: 'var(--dsh-text-secondary, #888)', margin: '4px 0', fontSize: 12 } },
                `已显示 ${logEntries.length} 条${logPkg ? ` · 包=${logPkg}` : ''}${pidsLabel}${logPaused ? ' · 已暂停' : ' · 每 1.5s 增量刷新'}`),
              h('div', { ref: logRef, style: { maxHeight: 300, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', border: '1px solid var(--dsh-border, #ccc)', padding: 6 } },
                logEntries.length === 0
                  ? h('div', { style: { color: 'var(--dsh-text-secondary, #888)' } }, '（等待日志…）')
                  : logEntries.map((e) => h('div', { key: `${e.time}-${e.pid}-${e.tid}-${e.message}` },
                      `${e.time} ${e.pid} ${e.tid} ${e.level} ${e.tag}: ${e.message}`))),
            ),
          ),
        )
      }

      function apply(ctx) {
        const slots = ctx.get('slots')
        const connection = ctx.get('connection')
        if (slots === undefined || connection === undefined || connection.rpc === undefined) return
        const runtime = createRuntime(connection.rpc)
        slots.inject('conversation.view', () => slots.register(
          { name: 'conversation.view', id: 'devices', order: 30, label: '设备' },
          (props) => h(DeviceView, { ...props, runtime }),
        ))
      }

      module.exports = { apply }
      return module.exports
    },
  })
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatLogcatBlock, formatSnapshotBlock, extractAdbActivity, nodeArrayOf }
}
