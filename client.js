/* dsh-adb Web device panel (client half) — plain JS, no build step.
 * Registers a "设备" tab in conversation.view (beside chat/trajectory/automation)
 * and talks to the Host half over the package RPC channel /dsh-adb.
 * Uses only client builtins: React, ctx, styles, console.
 */
window.__ModuleLoader__.load({
  id: 'dsh-adb',
  factory: (require) => {
    'use strict'
    const module = { exports: {} }

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
      return {
        listDevices: () => rpc.call(CHANNEL, 'listDevices', {}).then(unwrap),
        perfSnapshot: (payload) => rpc.call(CHANNEL, 'perfSnapshot', payload).then(unwrap),
        logcatTail: (payload) => rpc.call(CHANNEL, 'logcatTail', payload).then(unwrap),
      }
    }

    const h = React.createElement
    const ROW = { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }
    const BTN = { padding: '3px 10px', cursor: 'pointer' }
    const INPUT = { padding: '3px 6px' }

    function MetricRows({ rows }) {
      if (!rows || rows.length === 0) return h('div', null, '（无数据）')
      return h('table', { style: { borderCollapse: 'collapse' } },
        rows.map((row) => h('tr', { key: row[0] },
          h('td', { style: { padding: '2px 12px 2px 0', color: 'var(--dsh-text-secondary, #888)' } }, row[0]),
          h('td', { style: { padding: '2px 0' } }, String(row[1])),
        )),
      )
    }

    function DeviceView(props) {
      const runtime = props.runtime
      const [devices, setDevices] = React.useState([])
      const [selected, setSelected] = React.useState(null)
      const [pkg, setPkg] = React.useState('com.android.systemui')
      const [snapshot, setSnapshot] = React.useState(null)
      const [logEntries, setLogEntries] = React.useState([])
      const [logTotal, setLogTotal] = React.useState(0)
      const [level, setLevel] = React.useState('E')
      const [tail, setTail] = React.useState('30')
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      const refresh = () => {
        setBusy(true); setError(null)
        runtime.listDevices()
          .then((value) => setDevices(value.devices ?? []))
          .catch((e) => setError(String(e.message ?? e)))
          .finally(() => setBusy(false))
      }
      React.useEffect(refresh, [])

      const runSnapshot = () => {
        if (!selected) return
        setBusy(true); setError(null)
        runtime.perfSnapshot({ serial: selected.serial, package: pkg })
          .then(setSnapshot)
          .catch((e) => setError(String(e.message ?? e)))
          .finally(() => setBusy(false))
      }

      const runLogcat = () => {
        if (!selected) return
        setBusy(true); setError(null)
        const n = parseInt(tail, 10)
        runtime.logcatTail({ serial: selected.serial, level, tail: Number.isFinite(n) && n > 0 ? n : 30 })
          .then((value) => { setLogEntries(value.entries ?? []); setLogTotal(value.total ?? 0) })
          .catch((e) => setError(String(e.message ?? e)))
          .finally(() => setBusy(false))
      }

      const snapshotRows = []
      if (snapshot) {
        const m = snapshot.meminfo; const g = snapshot.gfxinfo; const b = snapshot.battery
        if (m) snapshotRows.push(['内存 PSS (KB)', m.totalPssKb], ['内存 RSS (KB)', m.totalRssKb], ['Java Heap (KB)', m.javaHeapKb], ['Native Heap (KB)', m.nativeHeapKb])
        if (g) snapshotRows.push(['总帧数', g.totalFrames], ['卡顿帧 / %', `${g.jankyFrames} / ${g.jankyPercent}%`], ['P50/P90 (ms)', `${g.percentile50Ms} / ${g.percentile90Ms}`], ['P95/P99 (ms)', `${g.percentile95Ms} / ${g.percentile99Ms}`], ['Missed Vsync', g.missedVsync])
        if (b) snapshotRows.push(['电量', `${b.levelPercent}%`], ['温度 (°C)', b.temperatureC])
      }

      return h('div', { style: { padding: 12, fontFamily: 'inherit', fontSize: 13 } },
        h('div', { style: { ...ROW, justifyContent: 'space-between' } },
          h('strong', null, 'ADB 设备'),
          h('button', { style: BTN, onClick: refresh, disabled: busy }, busy ? '…' : '刷新'),
        ),
        error !== null && h('div', { style: { color: '#e5484d', margin: '6px 0' } }, String(error)),
        devices.length === 0
          ? h('div', { style: { color: 'var(--dsh-text-secondary, #888)', margin: '8px 0' } }, '未连接设备')
          : h('div', null, devices.map((d) =>
              h('button', {
                key: d.serial,
                onClick: () => setSelected(d),
                style: { ...BTN, display: 'block', width: '100%', textAlign: 'left', margin: '2px 0',
                  background: selected && selected.serial === d.serial ? 'var(--dsh-accent-soft, rgba(66,133,244,.15))' : 'transparent' },
              }, `${d.serial} · ${d.state}${d.model ? ' · ' + d.model : ''}`),
            )),

        selected !== null && h('div', { style: { marginTop: 14, borderTop: '1px solid var(--dsh-border, #333)', paddingTop: 10 } },
          h('div', { style: ROW },
            h('label', null, '包名'),
            h('input', { style: INPUT, value: pkg, onChange: (e) => setPkg(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') runSnapshot() } }),
            h('button', { style: BTN, onClick: runSnapshot, disabled: busy }, '性能快照'),
          ),
          snapshot && h('div', { style: { marginTop: 8 } }, h(MetricRows, { rows: snapshotRows })),

          h('div', { style: { ...ROW, marginTop: 12 } },
            h('label', null, '级别'),
            h('select', { style: INPUT, value: level, onChange: (e) => setLevel(e.target.value) },
              ['V', 'D', 'I', 'W', 'E', 'F'].map((lv) => h('option', { key: lv, value: lv }, lv))),
            h('label', null, '条数'),
            h('input', { style: { ...INPUT, width: 56 }, value: tail, onChange: (e) => setTail(e.target.value) }),
            h('button', { style: BTN, onClick: runLogcat, disabled: busy }, '获取日志'),
          ),
          h('div', { style: { color: 'var(--dsh-text-secondary, #888)', margin: '4px 0' } }, `logcat 共 ${logTotal} 条（显示 ${logEntries.length}）`),
          h('div', { style: { maxHeight: 260, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap' } },
            logEntries.length === 0
              ? h('div', null, '（暂无）')
              : logEntries.map((e) => h('div', { key: `${e.time}-${e.pid}-${e.tid}-${e.message}` },
                  `${e.time} ${e.pid} ${e.tid} ${e.level} ${e.tag}: ${e.message}`)),
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
