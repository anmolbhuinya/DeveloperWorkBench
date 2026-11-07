import { useState, useEffect, useMemo } from 'react'
import { usePanels } from './ScreenConfig'

const th = { textAlign: 'left', padding: '5px 6px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)' }
const td = { padding: '3px 4px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const mono = { fontFamily: 'monospace', fontSize: 11 }
const inp = { ...mono, width: '100%', background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 5px', boxSizing: 'border-box' }
const btn = { padding: '4px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }
const SEV = { info: '#2563eb', warn: '#ca8a04', error: '#dc2626' }
const KEPT = {}
function useKept(key, init) {
  const [v, setV] = useState(() => (key in KEPT ? KEPT[key] : init))
  useEffect(() => { KEPT[key] = v }, [key, v])
  return [v, setV]
}
const getJson = (u, opt) => fetch(u, opt).then(r => r.json()).catch(() => ({ ok: false, error: 'Could not reach server' }))
const post = (u, b) => getJson(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) })

function Timeline({ base }) {
  const [minutes, setMinutes] = useKept(base + 'evmin', 180)
  const [data, setData] = useKept(base + 'evdata', null)
  const [kind, setKind] = useKept(base + 'evkind', '')
  const [auto, setAuto] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  function load() {
    setBusy(true)
    getJson(`${base}/obs/events?minutes=${minutes}`).then(r => { if (r.ok) { setData(r); setErr('') } else setErr(r.error) }).finally(() => setBusy(false))
  }
  useEffect(() => { load() }, [minutes])
  useEffect(() => { if (!auto) return; const id = setInterval(load, 30000); return () => clearInterval(id) }, [auto, minutes])
  const kinds = useMemo(() => [...new Set((data?.events || []).map(e => e.event))], [data])
  const rows = (data?.events || []).filter(e => !kind || e.event === kind)
  let lastDate = ''
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <select style={{ ...inp, width: 'auto' }} value={minutes} onChange={e => setMinutes(+e.target.value)}>
          {[[60, 'Last hour'], [180, 'Last 3 hours'], [720, 'Last 12 hours'], [1440, 'Last 24 hours'], [10080, 'Last 7 days']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select style={{ ...inp, width: 'auto' }} value={kind} onChange={e => setKind(e.target.value)}>
          <option value="">All events</option>{kinds.map(k => <option key={k}>{k}</option>)}
        </select>
        <button style={btn} onClick={load} disabled={busy}>{busy ? 'Loading...' : 'Refresh'}</button>
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> Auto-refresh (30s)</label>
        <button style={btn} onClick={() => post(`${base}/obs/events/clear`).then(load)}>Clear Workbench events</button>
        {data && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{rows.length} events, {data.rules} rules enabled</span>}
      </div>
      {err && <div style={{ color: '#dc2626', fontSize: 12 }}>{err}</div>}
      <div style={{ ...mono, fontSize: 13, lineHeight: 1.9, maxHeight: 560, overflow: 'auto', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px' }}>
        {rows.length === 0 && <div style={{ color: 'var(--text-muted)' }}>No events in this window.</div>}
        {rows.map((e, i) => {
          const sep = e.date !== lastDate ? <div key={'d' + i} style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: i ? 8 : 0 }}>{e.date}</div> : null
          lastDate = e.date
          return (<div key={i}>{sep}
            <div title={e.event}><span style={{ color: 'var(--text-muted)' }}>{e.time}</span>{'  '}
              <span style={{ color: SEV[e.sev] || 'inherit' }}>{e.msg}</span></div></div>)
        })}
      </div>
    </div>
  )
}

function Config({ base }) {
  const [rules, setRules] = useState(null)
  const [sources, setSources] = useState([])
  const [file, setFile] = useState('')
  const [msg, setMsg] = useState('')
  const load = () => getJson(`${base}/obs/event-config`).then(r => { if (r.ok) { setRules(r.rules.map(x => ({ ...x, _old: true }))); setSources(r.sources); setFile(r.file) } else setMsg(r.error) })
  useEffect(() => { load() }, [])
  if (!rules) return <div style={{ fontSize: 12 }}>{msg || 'Loading...'}</div>
  const set = (i, k, v) => setRules(rules.map((r, j) => j === i ? { ...r, [k]: v } : r))
  const save = () => post(`${base}/obs/event-config`, { rules }).then(r => { setMsg(r.ok ? 'Saved to event_config.xlsx' : r.error); if (r.ok) load() })
  return (
    <div>
      <div style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead><tr><th style={th}>On</th><th style={th}>Key</th><th style={th}>Event</th><th style={th}>Source</th><th style={th}>Pattern</th><th style={th}>Threshold</th><th style={th}>Message</th><th style={th}>Severity</th><th style={th}></th></tr></thead>
          <tbody>{rules.map((r, i) => (
            <tr key={i}>
              <td style={td}><input type="checkbox" checked={r.enabled} onChange={e => set(i, 'enabled', e.target.checked)} /></td>
              <td style={{ ...td, width: 110 }}><input style={inp} value={r.key} readOnly={r._old} onChange={e => set(i, 'key', e.target.value)} /></td>
              <td style={{ ...td, width: 170 }}><input style={inp} value={r.name} onChange={e => set(i, 'name', e.target.value)} /></td>
              <td style={{ ...td, width: 110 }}><select style={inp} value={r.source} onChange={e => set(i, 'source', e.target.value)}>{sources.map(s => <option key={s}>{s}</option>)}</select></td>
              <td style={td}><input style={inp} value={r.pattern} onChange={e => set(i, 'pattern', e.target.value)} /></td>
              <td style={{ ...td, width: 70 }}><input style={inp} value={r.threshold} onChange={e => set(i, 'threshold', e.target.value)} /></td>
              <td style={td}><input style={inp} value={r.message} onChange={e => set(i, 'message', e.target.value)} /></td>
              <td style={{ ...td, width: 80 }}><select style={inp} value={r.severity} onChange={e => set(i, 'severity', e.target.value)}>{['info', 'warn', 'error'].map(s => <option key={s}>{s}</option>)}</select></td>
              <td style={td}><button style={btn} onClick={() => setRules(rules.filter((_, j) => j !== i))}>Remove</button></td>
            </tr>))}</tbody>
        </table>
      </div>
      <div style={{ margin: '8px 0' }}>
        <button style={btn} onClick={() => setRules([...rules, { key: '', name: '', enabled: true, source: 'log', pattern: '', threshold: '', message: '{line}', severity: 'info' }])}>Add event</button>{' '}
        <button style={btn} onClick={save}>Save</button>{' '}
        <button style={btn} onClick={load}>Discard changes</button>
        <span style={{ fontSize: 12, marginLeft: 8, color: 'var(--text-muted)' }}>{msg}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
        <div>Config file: {file}</div>
        <div><b>Sources</b> - log: regex per line of the container log (group 1 is {'{g1}'}, the line is {'{line}'}) - appmap_http: regex on the request path of AppMap request recordings ({'{method} {path}'}) -
          appmap_slow: same, but only calls slower than Threshold ms ({'{sec}'}) - sql: P6Spy statements at or above Threshold ms, and/or matching the Pattern regex ({'{sec} {ms} {sql}'}) -
          jvm: Pattern is a list such as heap_pct&gt;=85,threads&gt;=500,blocked&gt;=5, sampled whenever the timeline is refreshed - deploy: the recorded deployment ({'{branch} {ver}'}) -
          store: events recorded by the Workbench itself under the same key (for example config_change).</div>
      </div>
    </div>
  )
}

export default function EventsTab({ appName }) {
  const [sub0, setSub] = useKept('evsub', 'timeline')
  const on = usePanels()
  const vis = ['timeline', 'config'].filter(k => on({ timeline: 'ev_timeline', config: 'ev_config' }[k]))
  const sub = vis.includes(sub0) ? sub0 : vis[0]
  const base = `/api/local-app/${appName}`
  const items = [{ key: 'timeline', label: 'Timeline' }, { key: 'config', label: 'Configuration' }].filter(t => vis.includes(t.key))
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {items.map(t => (
          <button key={t.key} onClick={() => setSub(t.key)}
            style={{ padding: '3px 10px', fontSize: 12, borderRadius: 16, cursor: 'pointer', border: '1px solid var(--border)',
              background: sub === t.key ? 'var(--primary, #2563eb)' : 'transparent', color: sub === t.key ? '#fff' : 'inherit' }}>{t.label}</button>))}
      </div>
      {sub === 'timeline' && <Timeline base={base} />}
      {sub === 'config' && <Config base={base} />}
    </div>
  )
}
