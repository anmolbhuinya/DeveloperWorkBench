import { useState, useEffect } from 'react'
import { GearIcon } from './ScreenConfig'

const th = { textAlign: 'left', padding: '5px 6px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap' }
const td = { padding: '3px 4px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const inp = { fontFamily: 'monospace', fontSize: 11, width: '100%', background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 5px', boxSizing: 'border-box' }
const btn = { padding: '4px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }

// db (connection name -> ?conn=, query workbook -> ?schema=) is switched for the Database tab only while it is on screen
let _dbConn = ''
let _installed = false
export function setDbConn(v) { _dbConn = v || '' }
export function installDbFetch() {
  if (_installed || typeof window === 'undefined') return
  _installed = true
  const orig = window.fetch.bind(window)
  window.fetch = (input, init) => {
    try {
      if (_dbConn && typeof input === 'string') {
        const add = (u, k) => u + (u.includes('?') ? '&' : '?') + k + '=' + encodeURIComponent(_dbConn)
        if (/^\/api\/local-app\/[^/]+\/db\//.test(input) && !/\/db\/connections/.test(input) && !/[?&]conn=/.test(input)) input = add(input, 'conn')
        else if (/^\/api\/sqlq\/local\//.test(input) && !/[?&]schema=/.test(input)) input = add(input, 'schema')
      }
    } catch (e) { /* leave the request as it is */ }
    return orig(input, init)
  }
}

const LABEL = { name: 'Name', enabled: 'On', host: 'Host', port: 'Port', service: 'Service / DB', username: 'Username', password: 'Password', schema: 'Schema', path: 'Path', options: 'Options' }

export function ConnConfigPanel({ base, kind, title, onSaved }) {
  const [d, setD] = useState(null)
  const [type, setType] = useState('')
  const [msg, setMsg] = useState('')
  const load = () => fetch(`${base}/${kind}-config`).then(r => r.json()).then(r => {
    if (r.ok) { setD({ ...r, types: Object.fromEntries(Object.entries(r.types).map(([t, rows]) => [t, rows.map(x => ({ ...x, _old: true }))])) }); setType(t => t || r.order[0]) } else setMsg(r.error)
  }).catch(() => setMsg('Could not reach server'))
  useEffect(() => { load() }, [])
  if (!d) return <div style={{ fontSize: 12 }}>{msg || 'Loading...'}</div>
  const rows = d.types[type] || []
  const setRows = nr => setD({ ...d, types: { ...d.types, [type]: nr } })
  const set = (i, k, v) => setRows(rows.map((r, j) => j === i ? { ...r, [k]: v } : r))
  const save = () => fetch(`${base}/${kind}-config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ types: d.types }) })
    .then(r => r.json()).then(r => { setMsg(r.ok ? 'Saved' : r.error); if (r.ok) { load(); onSaved && onSaved() } })
  return (
    <div className="card" style={{ padding: 10, marginBottom: 10 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{title} connections - one sheet per type, one row per connection</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {d.order.map(t => (
          <button key={t} onClick={() => setType(t)} style={{ padding: '3px 12px', fontSize: 12, borderRadius: 14, cursor: 'pointer', border: '1px solid var(--border)',
            background: type === t ? 'var(--primary, #2563eb)' : 'transparent', color: type === t ? '#fff' : 'inherit' }}>{t} ({(d.types[t] || []).length})</button>))}
      </div>
      <div style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
          <thead><tr>{d.columns.map(c => <th key={c} style={th}>{LABEL[c] || c}</th>)}<th style={th}></th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>
              {d.columns.map(c => (
                <td key={c} style={{ ...td, width: c === 'enabled' || c === 'port' ? 60 : undefined }}>
                  {c === 'enabled' ? <input type="checkbox" checked={!!r.enabled} onChange={e => set(i, 'enabled', e.target.checked)} />
                    : <input style={inp} type={c === 'password' ? 'password' : 'text'} value={r[c] || ''} readOnly={c === 'name' && r._old} onChange={e => set(i, c, e.target.value)} />}
                </td>))}
              <td style={td}><button style={btn} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button></td>
            </tr>))}</tbody>
        </table>
        {rows.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>No {type} connection yet.</div>}
      </div>
      <div style={{ margin: '8px 0' }}>
        <button style={btn} onClick={() => setRows([...rows, Object.fromEntries(d.columns.map(c => [c, c === 'enabled' ? true : c === 'host' ? 'localhost' : '']))])}>Add connection</button>{' '}
        <button style={btn} onClick={save}>Save</button>{' '}
        <button style={btn} onClick={load}>Discard changes</button>
        <span style={{ fontSize: 12, marginLeft: 8, color: msg === 'Saved' ? '#16a34a' : '#dc2626' }}>{msg}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>File: {d.file}</div>
    </div>
  )
}

export function ConnBar({ conns, value, onChange, onGear, gearOn, label }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
      {(conns || []).map(c => (
        <button key={c.name} onClick={() => onChange(c.name)} title={`${c.type} ${c.host}:${c.port}`}
          style={{ padding: '4px 14px', fontSize: 12, borderRadius: 14, cursor: 'pointer', border: '1px solid var(--border)',
            background: value === c.name ? 'var(--primary, #2563eb)' : 'transparent', color: value === c.name ? '#fff' : 'inherit' }}>{c.name} <span style={{ opacity: 0.7 }}>({c.type})</span></button>))}
      {(!conns || conns.length === 0) && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No enabled connection</span>}
      <button onClick={onGear} title="Configure connections" aria-label="Configure connections"
        style={{ marginLeft: 'auto', background: gearOn ? 'var(--surface2)' : 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-muted)', padding: '3px 6px', display: 'inline-flex', alignItems: 'center' }}>
        <GearIcon />
      </button>
    </div>
  )
}
