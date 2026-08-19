/* dsh-adb Web device panel (client half, v1.1.3) — plain JS, no build step.
 * Registers a "设备" tab in conversation.view and talks to the Host half over
 * the package RPC channel /dsh-adb. Uses only client builtins: React, ctx.
 * v1.1.3: i18n (follows harness locale via the slots `locale:` seat) + state
 * survives tab switches (defineStore declared at register).
 * Dual-mode: browser registers via __ModuleLoader__; Node (tests via node:vm
 * with a fake `module`) exports the pure helpers + dictionary.
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

/** Panel dictionary: zh is the key-set source of truth, en mirrors it. */
const DICTIONARY = {
  zh: {
    'panel.title': 'ADB 设备',
    'refresh': '刷新',
    'noDevices': '未连接设备',
    'deviceInfo': '设备信息',
    'package': '包名',
    'packagePlaceholder': '输入或选择包名',
    'snapshot': '性能快照',
    'sendToChat': '发送到对话',
    'processes': '进程（{n}）— 点击按 pid 过滤 logcat',
    'logcat': 'logcat',
    'keywordFilter': '关键字过滤',
    'packageFilter': '包名过滤（按进程）',
    'resume': '继续',
    'pause': '暂停',
    'clear': '清空',
    'autoScroll': '自动滚动',
    'shownCount': '已显示 {n} 条',
    'refreshing': '每 1.5s 增量刷新',
    'paused': '已暂停',
    'waitingLog': '（等待日志…）',
    'agentActivity': 'agent 的 adb 操作',
    'noData': '（无数据）',
    'model': '型号', 'manufacturer': '厂商', 'android': 'Android', 'api': 'API',
    'resolution': '分辨率', 'memTotal': '内存总量',
    'memPss': '内存 PSS (KB)', 'memRss': '内存 RSS (KB)', 'javaHeap': 'Java Heap (KB)', 'nativeHeap': 'Native Heap (KB)',
    'frames': '总帧数', 'janky': '卡顿帧 / %', 'p50p90': 'P50/P90 (ms)', 'p95p99': 'P95/P99 (ms)',
    'battery': '电量', 'temp': '温度 (°C)', 'pkg': '包=', 'pid': 'pid=',
  },
  en: {
    'panel.title': 'ADB Devices',
    'refresh': 'Refresh',
    'noDevices': 'No device connected',
    'deviceInfo': 'Device Info',
    'package': 'Package',
    'packagePlaceholder': 'Type or pick a package',
    'snapshot': 'Perf Snapshot',
    'sendToChat': 'Send to chat',
    'processes': 'Processes ({n}) — click to filter logcat by pid',
    'logcat': 'logcat',
    'keywordFilter': 'Keyword filter',
    'packageFilter': 'Package filter (by process)',
    'resume': 'Resume',
    'pause': 'Pause',
    'clear': 'Clear',
    'autoScroll': 'Auto-scroll',
    'shownCount': '{n} entries shown',
    'refreshing': 'incremental 1.5s refresh',
    'paused': 'paused',
    'waitingLog': '(waiting for logs…)',
    'agentActivity': "Agent's adb activity",
    'noData': '(no data)',
    'model': 'Model', 'manufacturer': 'Manufacturer', 'android': 'Android', 'api': 'API',
    'resolution': 'Resolution', 'memTotal': 'Total memory',
    'memPss': 'PSS (KB)', 'memRss': 'RSS (KB)', 'javaHeap': 'Java Heap (KB)', 'nativeHeap': 'Native Heap (KB)',
    'frames': 'Total frames', 'janky': 'Janky / %', 'p50p90': 'P50/P90 (ms)', 'p95p99': 'P95/P99 (ms)',
    'battery': 'Battery', 'temp': 'Temp (°C)', 'pkg': 'pkg=', 'pid': 'pid=',
  },
}

// ---- Browser entry ----

if (typeof window !== 'undefined' && typeof window.__ModuleLoader__ === 'object') {
  window.__ModuleLoader__.load({
    id: 'dsh-adb',
    factory: (require) => {
      const module = { exports: {} }

      const React = require('react')
      const { defineStore } = require('@deepseek-ai/dsh-client-runtime/client')
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
        const t = props.t || ((key) => DICTIONARY.zh[key] ?? key)
        const st = props.useStore((s) => s)
        const actions = props.actions
        const [busy, setBusy] = React.useState(false)
        const logRef = React.useRef(null)
        const stateRef = React.useRef(st)
        stateRef.current = st

        const adbActivity = props.useSession
          ? props.useSession((snap) => extractAdbActivity(nodeArrayOf(snap)))
          : []
        const sendToChat = (text) => {
          if (props.inputActions && typeof props.inputActions.setDraft === 'function') {
            props.inputActions.setDraft(text)
          }
        }

        const fail = (e) => actions.setError(String((e && e.message) || e))

        const refresh = () => {
          setBusy(true); actions.setError(null)
          runtime.listDevices()
            .then((value) => actions.setDevices(value.devices ?? []))
            .catch(fail)
            .finally(() => setBusy(false))
        }
        React.useEffect(refresh, [])

        const selectDevice = (device) => {
          actions.setSelected(device)
          actions.setInfo(null); actions.setSnapshot(null); actions.setProcesses([])
          actions.clearLog()
          setBusy(true); actions.setError(null)
          Promise.all([
            runtime.deviceInfo({ serial: device.serial }).then(actions.setInfo),
            runtime.listPackages({ serial: device.serial }).then((v) => actions.setPackages(v.packages ?? [])),
          ]).catch(fail).finally(() => setBusy(false))
        }

        const loadProcesses = (pkgName) => {
          const device = stateRef.current.selected
          if (!device) return
          runtime.processList({ serial: device.serial, package: pkgName })
            .then((v) => actions.setProcesses(v.processes ?? []))
            .catch(fail)
        }
        React.useEffect(() => { if (st.selected) loadProcesses(st.pkg) }, [st.pkg]) // eslint-disable-line react-hooks/exhaustive-deps

        const runSnapshot = () => {
          const device = stateRef.current.selected
          if (!device) return
          setBusy(true); actions.setError(null)
          runtime.perfSnapshot({ serial: device.serial, package: st.pkg })
            .then(actions.setSnapshot)
            .catch(fail)
            .finally(() => setBusy(false))
        }

        const applyPackageFilter = (name) => {
          actions.setLogPkg(name)
          actions.clearLog()
          if (name === '') { actions.setLogPids([]); return }
          const device = stateRef.current.selected
          if (!device) return
          runtime.processList({ serial: device.serial, package: name })
            .then((v) => actions.setLogPids((v.processes ?? []).map((p) => p.pid)))
            .catch(fail)
        }

        const applyLogFilters = (level, keyword, pids) => {
          actions.setLogLevel(level)
          actions.setLogKeyword(keyword)
          actions.setLogPids(pids)
          actions.clearLog()
        }

        React.useEffect(() => {
          if (!st.selected || st.logPaused) return
          const timer = setInterval(() => {
            const s = stateRef.current
            runtime.logcatDelta({
              serial: s.selected.serial,
              since: s.logSince,
              level: s.logLevel,
              keyword: s.logKeyword || undefined,
              tail: 200,
            }).then((value) => {
              let entries = value.entries ?? []
              if (s.logPids.length > 0) entries = entries.filter((e) => s.logPids.includes(e.pid))
              if (entries.length > 0) {
                actions.appendLog(entries)
                actions.setLogSince(entries[entries.length - 1].time)
              }
            }).catch(() => { /* transient poll errors are ignored */ })
          }, 1500)
          return () => clearInterval(timer)
        }, [st.selected, st.logPaused]) // eslint-disable-line react-hooks/exhaustive-deps

        React.useEffect(() => {
          const el = logRef.current
          if (el && st.logAuto) el.scrollTop = el.scrollHeight
        }, [st.logEntries, st.logAuto])

        const snapshotRows = []
        if (st.snapshot) {
          const m = st.snapshot.meminfo; const g = st.snapshot.gfxinfo; const b = st.snapshot.battery
          if (m) snapshotRows.push([t('memPss'), m.totalPssKb], [t('memRss'), m.totalRssKb], [t('javaHeap'), m.javaHeapKb], [t('nativeHeap'), m.nativeHeapKb])
          if (g) snapshotRows.push([t('frames'), g.totalFrames], [t('janky'), `${g.jankyFrames} / ${g.jankyPercent}%`], [t('p50p90'), `${g.percentile50Ms} / ${g.percentile90Ms}`], [t('p95p99'), `${g.percentile95Ms} / ${g.percentile99Ms}`])
          if (b) snapshotRows.push([t('battery'), `${b.levelPercent}%`], [t('temp'), b.temperatureC])
        }
        const infoRows = st.info
          ? [[t('model'), st.info.model], [t('manufacturer'), st.info.manufacturer], [t('android'), st.info.release], [t('api'), st.info.sdk], [t('resolution'), st.info.resolution], [t('memTotal'), st.info.memTotalKb ? `${Math.round(st.info.memTotalKb / 1024)} MB` : undefined]].filter((r) => r[1] !== undefined && r[1] !== null)
          : []

        const pidsLabel = st.logPids.length > 0 ? ` · ${t('pid')}${st.logPids.join(',')}` : ''
        const statusText = `${t('shownCount').replace('{n}', String(st.logEntries.length))}${st.logPkg ? ` · ${t('pkg')}${st.logPkg}` : ''}${pidsLabel}${st.logPaused ? ` · ${t('paused')}` : ` · ${t('refreshing')}`}`

        return h('div', { style: { padding: 12, fontFamily: 'inherit', fontSize: 13 } },
          h('div', { style: { ...ROW, justifyContent: 'space-between' } },
            h('strong', null, t('panel.title')),
            h('button', { style: BTN, onClick: refresh, disabled: busy }, busy ? '…' : t('refresh')),
          ),
          st.error !== null && h('div', { style: { color: '#e5484d', margin: '6px 0', wordBreak: 'break-all' } }, String(st.error)),
          st.devices.length === 0
            ? h('div', { style: { color: 'var(--dsh-text-secondary, #888)', margin: '8px 0' } }, t('noDevices'))
            : h('div', null, st.devices.map((d) =>
                h('button', {
                  key: d.serial,
                  onClick: () => selectDevice(d),
                  style: { ...BTN, display: 'block', width: '100%', textAlign: 'left', margin: '2px 0',
                    background: st.selected && st.selected.serial === d.serial ? 'var(--dsh-accent-soft, rgba(66,133,244,.15))' : 'transparent' },
                }, `${d.serial} · ${d.state}${d.model ? ' · ' + d.model : ''}`),
              )),

          adbActivity.length > 0 && h('div', { style: SECTION },
            h('strong', null, t('agentActivity')),
            h('div', { style: { marginTop: 4, fontSize: 12, color: 'var(--dsh-text-secondary, #888)' } },
              adbActivity.map((a, i) => h('div', { key: `${a.name}-${i}` }, `• ${a.name}${a.time ? '  @ ' + a.time : ''}`))),
          ),

          st.selected !== null && h('div', { style: { marginTop: 14 } },
            st.info !== null && infoRows.length > 0 && h('div', { style: SECTION },
              h('strong', null, t('deviceInfo')),
              h(MetricRows, { rows: infoRows }),
            ),

            h('div', { style: SECTION },
              h('div', { style: ROW },
                h('label', null, t('package')),
                h(PackageCombobox, { packages: st.packages, value: st.pkg, placeholder: t('packagePlaceholder'), onChange: (name) => actions.setPkg(name) }),
                h('button', { style: BTN, onClick: runSnapshot, disabled: busy }, t('snapshot')),
                st.snapshot && h('button', { style: BTN, onClick: () => sendToChat(formatSnapshotBlock(st.snapshot)) }, t('sendToChat')),
              ),
              st.snapshot && h('div', { style: { marginTop: 8 } }, h(MetricRows, { rows: snapshotRows })),

              st.processes.length > 0 && h('div', { style: { marginTop: 8 } },
                h('div', { style: { color: 'var(--dsh-text-secondary, #888)' } }, t('processes').replace('{n}', String(st.processes.length))),
                h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 } },
                  st.processes.map((p) => {
                    const active = st.logPids.length === 1 && st.logPids[0] === p.pid
                    return h('button', {
                      key: p.pid,
                      onClick: () => { const next = active ? [] : [p.pid]; applyLogFilters(st.logLevel, st.logKeyword, next) },
                      style: { ...BTN, fontSize: 11, background: active ? 'var(--dsh-accent-soft, rgba(66,133,244,.15))' : 'transparent' },
                    }, `${p.pid} ${p.name}`)
                  })),
              ),
            ),

            h('div', { style: SECTION },
              h('div', { style: ROW },
                h('label', null, t('logcat')),
                h('select', { style: INPUT, value: st.logLevel, onChange: (e) => applyLogFilters(e.target.value, st.logKeyword, st.logPids) },
                  ['V', 'D', 'I', 'W', 'E', 'F'].map((lv) => h('option', { key: lv, value: lv }, lv))),
                h('input', { style: { ...INPUT, minWidth: 130 }, placeholder: t('keywordFilter'), value: st.logKeyword, onChange: (e) => applyLogFilters(st.logLevel, e.target.value, st.logPids) }),
                h('div', { style: { flex: 1, minWidth: 180 } },
                  h(PackageCombobox, { packages: st.packages, value: st.logPkg, placeholder: st.logPkg || t('packageFilter'), onChange: applyPackageFilter })),
                h('button', { style: BTN, onClick: () => actions.setLogPaused(!st.logPaused) }, st.logPaused ? t('resume') : t('pause')),
                h('button', { style: BTN, onClick: () => actions.clearLog() }, t('clear')),
                h('button', { style: BTN, onClick: () => sendToChat(formatLogcatBlock(st.logEntries)), disabled: st.logEntries.length === 0 }, t('sendToChat')),
                h('label', { style: { fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 } },
                  h('input', { type: 'checkbox', checked: st.logAuto, onChange: (e) => actions.setLogAuto(e.target.checked) }), ' ', t('autoScroll')),
              ),
              h('div', { style: { color: 'var(--dsh-text-secondary, #888)', margin: '4px 0', fontSize: 12 } }, statusText),
              h('div', { ref: logRef, style: { maxHeight: 300, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', border: '1px solid var(--dsh-border, #ccc)', padding: 6 } },
                st.logEntries.length === 0
                  ? h('div', { style: { color: 'var(--dsh-text-secondary, #888)' } }, t('waitingLog'))
                  : st.logEntries.map((e) => h('div', { key: `${e.time}-${e.pid}-${e.tid}-${e.message}` },
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

        // i18n: register the panel dictionary under the harness locale system.
        const locale = ctx.get('locale')
        if (locale && typeof locale.register === 'function') {
          ctx.effect(() => locale.register('dsh-adb', DICTIONARY))
        }

        // Store: declared at register, so state survives view tab switches.
        const panelStore = defineStore({
          init: () => ({
            devices: [], selected: null, info: null, packages: [], pkg: 'com.android.systemui',
            snapshot: null, processes: [], logEntries: [], logSince: '',
            logLevel: 'V', logKeyword: '', logPkg: '', logPids: [], logPaused: false, logAuto: true, error: null,
          }),
          actions: {
            setDevices: (d, v) => { d.devices = v },
            setSelected: (d, v) => { d.selected = v },
            setInfo: (d, v) => { d.info = v },
            setPackages: (d, v) => { d.packages = v },
            setPkg: (d, v) => { d.pkg = v },
            setSnapshot: (d, v) => { d.snapshot = v },
            setProcesses: (d, v) => { d.processes = v },
            setError: (d, v) => { d.error = v },
            appendLog: (d, entries) => {
              const seen = new Set(d.logEntries.map((e) => `${e.time}:${e.pid}:${e.message}`))
              const fresh = entries.filter((e) => !seen.has(`${e.time}:${e.pid}:${e.message}`))
              d.logEntries = [...d.logEntries, ...fresh].slice(-500)
            },
            setLogSince: (d, v) => { d.logSince = v },
            setLogLevel: (d, v) => { d.logLevel = v },
            setLogKeyword: (d, v) => { d.logKeyword = v },
            setLogPkg: (d, v) => { d.logPkg = v },
            setLogPids: (d, v) => { d.logPids = v },
            setLogPaused: (d, v) => { d.logPaused = v },
            setLogAuto: (d, v) => { d.logAuto = v },
            clearLog: (d) => { d.logEntries = []; d.logSince = '' },
          },
        })

        slots.inject('conversation.view', () => slots.register(
          {
            name: 'conversation.view',
            id: 'devices',
            order: 30,
            label: () => {
              const loc = ctx.get('locale')
              return loc && typeof loc.getLocale === 'function' && loc.getLocale().active === 'en' ? 'Devices' : '设备'
            },
            store: panelStore,
            locale: 'dsh-adb',
          },
          (props) => h(DeviceView, { ...props, runtime }),
        ))
      }

      module.exports = { apply }
      return module.exports
    },
  })
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatLogcatBlock, formatSnapshotBlock, extractAdbActivity, nodeArrayOf, DICTIONARY }
}
