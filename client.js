/* dsh-adb Web device panel (client half, v1.1) — plain JS, no build step.
 * Registers a "设备" tab in conversation.view and talks to the Host half over
 * the package RPC channel /dsh-adb. Uses only client builtins: React, ctx.
 */
window.__ModuleLoader__.load({
  id: 'dsh-adb',
  factory: (require) => {
    'use strict'
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
        screenshot: (payload) => call('screenshot', payload),
        perfSample: (payload) => call('perfSample', payload),
      }
    }

    const h = React.createElement
    const ROW = { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', flexWrap: 'wrap' }
    const BTN = { padding: '3px 10px', cursor: 'pointer' }
    const INPUT = { padding: '3px 6px' }
    const SECTION = { marginTop: 14, borderTop: '1px solid var(--dsh-border, #333)', paddingTop: 10 }

    function MetricRows({ rows }) {
      if (!rows || rows.length === 0) return h('div', null, '（无数据）')
      return h('table', { style: { borderCollapse: 'collapse' } },
        rows.map((row) => h('tr', { key: row[0] },
          h('td', { style: { padding: '2px 12px 2px 0', color: 'var(--dsh-text-secondary, #888)' } }, row[0]),
          h('td', { style: { padding: '2px 0' } }, String(row[1])),
        )),
      )
    }

    function SampleChart({ points }) {
      if (points.length < 2) return h('div', { style: { color: 'var(--dsh-text-secondary, #888)', margin: '6px 0' } }, '采样中…（至少 2 个点出图）')
      const W = 480
      const H = 120
      const maxPss = Math.max(...points.map((p) => p.pss), 1)
      const maxBat = 100
      const x = (i) => (i / (points.length - 1)) * W
      const yPss = (v) => H - (v / maxPss) * (H - 10) - 5
      const yBat = (v) => H - (v / maxBat) * (H - 10) - 5
      const pssLine = points.map((p, i) => `${x(i)},${yPss(p.pss)}`).join(' ')
      const batLine = points.map((p, i) => `${x(i)},${yBat(p.battery)}`).join(' ')
      return h('svg', { width: W, height: H, style: { border: '1px solid var(--dsh-border, #333)', marginTop: 6 } },
        h('polyline', { points: pssLine, fill: 'none', stroke: '#4c8bf5', strokeWidth: 1.5 }),
        h('polyline', { points: batLine, fill: 'none', stroke: '#30a46c', strokeWidth: 1.5 }),
        h('text', { x: 4, y: 10, fill: '#4c8bf5', fontSize: 10 }, 'PSS'),
        h('text', { x: 40, y: 10, fill: '#30a46c', fontSize: 10 }, '电池%'),
      )
    }

    function DeviceView(props) {
      const runtime = props.runtime
      const [devices, setDevices] = React.useState([])
      const [selected, setSelected] = React.useState(null)
      const [info, setInfo] = React.useState(null)
      const [packages, setPackages] = React.useState([])
      const [pkgOpen, setPkgOpen] = React.useState(false)
      const [pkg, setPkg] = React.useState('com.android.systemui')
      const [snapshot, setSnapshot] = React.useState(null)
      const [processes, setProcesses] = React.useState([])
      const [logEntries, setLogEntries] = React.useState([])
      const [logLevel, setLogLevel] = React.useState('V')
      const [logKeyword, setLogKeyword] = React.useState('')
      const [logPid, setLogPid] = React.useState(null)
      const [logPaused, setLogPaused] = React.useState(false)
      const [logAuto, setLogAuto] = React.useState(true)
      const [samples, setSamples] = React.useState([])
      const [sampling, setSampling] = React.useState(false)
      const [shot, setShot] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const logRef = React.useRef(null)
      const samplingTimer = React.useRef(null)
      const sinceRef = React.useRef('')
      const selectedRef = React.useRef(null)
      const levelFilterRef = React.useRef('V')
      const keywordFilterRef = React.useRef('')
      const pidFilterRef = React.useRef(null)

      selectedRef.current = selected

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
        setInfo(null); setSnapshot(null); setProcesses([]); setShot(null); setSamples([])
        setLogEntries([]); sinceRef.current = ''
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

      const runShot = () => {
        if (!selected) return
        setBusy(true); setError(null)
        runtime.screenshot({ serial: selected.serial })
          .then((v) => setShot(v.dataUrl ?? null))
          .catch(fail)
          .finally(() => setBusy(false))
      }

      // Real-time logcat: incremental polling (only new entries after since).
      React.useEffect(() => {
        if (!selected || logPaused) return
        const timer = setInterval(() => {
          runtime.logcatDelta({
            serial: selected.serial,
            since: sinceRef.current,
            level: levelFilterRef.current,
            keyword: keywordFilterRef.current || undefined,
            pid: pidFilterRef.current || undefined,
            tail: 200,
          }).then((value) => {
            const entries = value.entries ?? []
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

      const applyLogFilters = (level, keyword, pid) => {
        levelFilterRef.current = level
        keywordFilterRef.current = keyword
        pidFilterRef.current = pid
        setLogEntries([])
        sinceRef.current = ''
      }

      const toggleSampling = () => {
        if (!selected) return
        if (sampling) {
          setSampling(false)
          if (samplingTimer.current) { clearInterval(samplingTimer.current); samplingTimer.current = null }
          return
        }
        setSampling(true); setSamples([])
        const tick = () => {
          runtime.perfSample({ serial: selected.serial, package: pkg })
            .then((v) => setSamples((prev) => [...prev.slice(-59), {
              t: Date.now(),
              pss: v.meminfo && v.meminfo.totalPssKb,
              battery: v.battery && v.battery.levelPercent,
            }]))
            .catch(() => {})
        }
        tick()
        samplingTimer.current = setInterval(tick, 3000)
      }
      React.useEffect(() => () => { if (samplingTimer.current) clearInterval(samplingTimer.current) }, [])

      const filteredPackages = pkgOpen
        ? packages.filter((name) => name.toLowerCase().includes(pkg.toLowerCase())).slice(0, 60)
        : []

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
                onClick: () => selectDevice(d),
                style: { ...BTN, display: 'block', width: '100%', textAlign: 'left', margin: '2px 0',
                  background: selected && selected.serial === d.serial ? 'var(--dsh-accent-soft, rgba(66,133,244,.15))' : 'transparent' },
              }, `${d.serial} · ${d.state}${d.model ? ' · ' + d.model : ''}`),
            )),

        selected !== null && h('div', { style: { marginTop: 14 } },
          info !== null && infoRows.length > 0 && h('div', { style: SECTION },
            h('strong', null, '设备信息'),
            h(MetricRows, { rows: infoRows }),
          ),

          h('div', { style: SECTION },
            h('div', { style: ROW },
              h('label', null, '包名'),
              h('div', { style: { position: 'relative', flex: 1, minWidth: 220 } },
                h('input', {
                  style: { ...INPUT, width: '100%', boxSizing: 'border-box' },
                  value: pkg,
                  onChange: (e) => { setPkg(e.target.value); setPkgOpen(true) },
                  onFocus: () => setPkgOpen(true),
                  onBlur: () => setTimeout(() => setPkgOpen(false), 150),
                  onKeyDown: (e) => {
                    if (e.key === 'Enter' && filteredPackages.length > 0) { setPkg(filteredPackages[0]); setPkgOpen(false) }
                  },
                }),
                pkgOpen && filteredPackages.length > 0 && h('div', {
                  style: { position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: 180, overflowY: 'auto', background: 'var(--dsh-bg, #1c1c1e)', border: '1px solid var(--dsh-border, #444)', zIndex: 10 },
                }, filteredPackages.map((name) => h('div', {
                  key: name,
                  onMouseDown: () => { setPkg(name); setPkgOpen(false) },
                  style: { padding: '3px 8px', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                }, name))),
              ),
              h('button', { style: BTN, onClick: runSnapshot, disabled: busy }, '性能快照'),
              h('button', { style: BTN, onClick: toggleSampling, disabled: !selected }, sampling ? '停止采样' : '开始采样'),
              h('button', { style: BTN, onClick: runShot, disabled: busy }, '截图'),
            ),
            snapshot && h('div', { style: { marginTop: 8 } }, h(MetricRows, { rows: snapshotRows })),
            sampling && h('div', { style: { marginTop: 8 } }, h(SampleChart, { points: samples })),

            processes.length > 0 && h('div', { style: { marginTop: 8 } },
              h('div', { style: { color: 'var(--dsh-text-secondary, #888)' } }, `进程（${processes.length}）— 点击按 pid 过滤 logcat`),
              h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 } },
                processes.map((p) => {
                  const active = logPid === p.pid
                  return h('button', {
                    key: p.pid,
                    onClick: () => { const next = active ? null : p.pid; setLogPid(next); applyLogFilters(logLevel, logKeyword, next) },
                    style: { ...BTN, fontSize: 11, background: active ? 'var(--dsh-accent-soft, rgba(66,133,244,.15))' : 'transparent' },
                  }, `${p.pid} ${p.name}`)
                })),
            ),
          ),

          h('div', { style: SECTION },
            h('div', { style: ROW },
              h('label', null, 'logcat'),
              h('select', { style: INPUT, value: logLevel, onChange: (e) => { setLogLevel(e.target.value); applyLogFilters(e.target.value, logKeyword, logPid) } },
                ['V', 'D', 'I', 'W', 'E', 'F'].map((lv) => h('option', { key: lv, value: lv }, lv))),
              h('input', { style: { ...INPUT, minWidth: 140 }, placeholder: '关键字过滤', value: logKeyword, onChange: (e) => { setLogKeyword(e.target.value); applyLogFilters(logLevel, e.target.value, logPid) } }),
              h('button', { style: BTN, onClick: () => setLogPaused(!logPaused) }, logPaused ? '继续' : '暂停'),
              h('button', { style: BTN, onClick: () => { setLogEntries([]); sinceRef.current = '' } }, '清空'),
              h('label', { style: { fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 } },
                h('input', { type: 'checkbox', checked: logAuto, onChange: (e) => setLogAuto(e.target.checked) }), ' 自动滚动'),
            ),
            h('div', { style: { color: 'var(--dsh-text-secondary, #888)', margin: '4px 0', fontSize: 12 } },
              `已显示 ${logEntries.length} 条${logPid ? ` · pid=${logPid}` : ''}${logPaused ? ' · 已暂停' : ' · 每 1.5s 增量刷新'}`),
            h('div', { ref: logRef, style: { maxHeight: 300, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', border: '1px solid var(--dsh-border, #333)', padding: 6 } },
              logEntries.length === 0
                ? h('div', { style: { color: 'var(--dsh-text-secondary, #888)' } }, '（等待日志…）')
                : logEntries.map((e) => h('div', { key: `${e.time}-${e.pid}-${e.tid}-${e.message}` },
                    `${e.time} ${e.pid} ${e.tid} ${e.level} ${e.tag}: ${e.message}`))),
          ),

          shot !== null && h('div', { style: SECTION },
            h('strong', null, '截图'),
            h('img', { src: shot, style: { maxWidth: '100%', marginTop: 6, border: '1px solid var(--dsh-border, #333)' } }),
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
