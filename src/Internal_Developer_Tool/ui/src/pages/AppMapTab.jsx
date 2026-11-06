import { useState, useEffect, useMemo } from 'react'

const VIEWS = [
  { key: 'sequence', label: 'Sequence diagrams' },
  { key: 'calls',    label: 'Call graphs' },
  { key: 'services', label: 'Service maps' },
  { key: 'code',     label: 'Code-to-runtime navigation' },
  { key: 'sql',      label: 'SQL visualization' },
  { key: 'http',     label: 'HTTP flow visualization' },
]
const short = (c) => String(c || '').split('.').pop() || String(c || '')
const th = { textAlign: 'left', padding: '5px 8px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)' }
const td = { padding: '4px 8px', fontSize: 12, borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const mono = { fontFamily: 'monospace', fontSize: 11 }

function Empty({ children }) { return <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>{children}</div> }

function Sequence({ m }) {
  const rows = m.sequence || []
  if (!rows.length) return <Empty>No calls between classes were recorded in this map.</Empty>
  const freq = {}
  rows.forEach(r => { freq[r.from] = (freq[r.from] || 0) + 1; freq[r.to] = (freq[r.to] || 0) + 1 })
  const actors = Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 8)
  const shown = rows.filter(r => actors.includes(r.from) && actors.includes(r.to)).slice(0, 80)
  const colW = 150, rowH = 26, top = 40, W = actors.length * colW + 20, H = top + shown.length * rowH + 20
  const x = a => 10 + actors.indexOf(a) * colW + colW / 2
  return (
    <div style={{ overflow: 'auto', maxHeight: 560 }}>
      <svg width={W} height={H} style={{ background: 'var(--bg)' }}>
        <defs><marker id="am-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#1565c0" /></marker></defs>
        {actors.map(a => (
          <g key={a}>
            <rect x={x(a) - 62} y={6} width={124} height={24} rx={4} fill="rgba(21,101,192,0.12)" stroke="#1565c0" />
            <text x={x(a)} y={22} textAnchor="middle" fontSize="11" fill="currentColor"><title>{a}</title>{short(a).slice(0, 18)}</text>
            <line x1={x(a)} y1={30} x2={x(a)} y2={H - 10} stroke="#90a4ae" strokeDasharray="4 3" />
          </g>
        ))}
        {shown.map((r, i) => {
          const y = top + i * rowH + 14, x1 = x(r.from), x2 = x(r.to)
          return (
            <g key={i}>
              <line x1={x1} y1={y} x2={x2} y2={y} stroke="#1565c0" markerEnd="url(#am-arrow)" />
              <text x={(x1 + x2) / 2} y={y - 3} textAnchor="middle" fontSize="10" fill="currentColor">{r.method}{r.ms != null ? ` · ${r.ms}ms` : ''}</text>
            </g>
          )
        })}
      </svg>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 8px' }}>Top {actors.length} classes, first {shown.length} calls between them.</div>
    </div>
  )
}

function Calls({ m }) {
  const [open, setOpen] = useState(true)
  const calls = m.calls || []
  if (!calls.length) return <Empty>No function calls were recorded in this map.</Empty>
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 460px', maxHeight: 560, overflow: 'auto' }}>
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Call tree <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => setOpen(o => !o)}>{open ? 'Collapse to depth 3' : 'Expand all'}</button></div>
        {calls.filter(c => open || c.depth < 3).map(c => (
          <div key={c.id} style={{ paddingLeft: Math.min(c.depth, 30) * 14, ...mono, borderLeft: '1px dotted var(--border)', whiteSpace: 'nowrap' }} title={`${c.path}:${c.line}`}>
            <span style={{ color: '#1565c0' }}>{short(c.cls)}</span>.{c.method} {c.ms != null && <span style={{ color: 'var(--text-muted)' }}>{c.ms} ms</span>}
          </div>
        ))}
      </div>
      <div style={{ flex: '1 1 360px', maxHeight: 560, overflow: 'auto' }}>
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Caller → callee (most frequent)</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Caller</th><th style={th}>Callee</th><th style={th}>#</th></tr></thead>
          <tbody>{(m.edges || []).map((e, i) => <tr key={i}><td style={td} title={e.from}>{short(e.from)}</td><td style={td} title={e.to}>{short(e.to)}.{e.method}</td><td style={td}>{e.count}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}

function Services({ m, appName }) {
  const hosts = {}
  ;(m.http_client || []).forEach(h => { try { const u = new URL(h.url); hosts[u.host] = (hosts[u.host] || 0) + 1 } catch { if (h.url) hosts[h.url] = (hosts[h.url] || 0) + 1 } })
  const dbs = {}
  ;(m.sql || []).forEach(q => { dbs[q.db || 'database'] = (dbs[q.db || 'database'] || 0) + q.count })
  const t = m.totals || {}
  const left = t.http_server ? [{ n: 'HTTP clients', c: t.http_server }] : []
  const right = [...Object.entries(hosts).map(([n, c]) => ({ n, c, k: 'ext' })), ...Object.entries(dbs).map(([n, c]) => ({ n, c, k: 'db' }))]
  if (!left.length && !right.length) return <Empty>No HTTP or SQL activity was recorded, so there are no services to map.</Empty>
  const H = Math.max(160, Math.max(left.length, right.length) * 56 + 40), W = 720, cy = H / 2
  const yOf = (i, n) => 30 + (H - 60) * (n === 1 ? 0.5 : i / (n - 1))
  return (
    <div style={{ overflow: 'auto' }}>
      <svg width={W} height={H}>
        <defs><marker id="am-s" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#546e7a" /></marker></defs>
        <rect x={290} y={cy - 28} width={140} height={56} rx={8} fill="rgba(21,101,192,0.15)" stroke="#1565c0" strokeWidth="2" />
        <text x={360} y={cy + 4} textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor">{appName}</text>
        {left.map((l, i) => { const y = yOf(i, left.length); return (<g key={l.n}>
          <rect x={20} y={y - 20} width={140} height={40} rx={6} fill="rgba(84,110,122,0.12)" stroke="#546e7a" />
          <text x={90} y={y + 4} textAnchor="middle" fontSize="12" fill="currentColor">{l.n}</text>
          <line x1={160} y1={y} x2={290} y2={cy} stroke="#546e7a" markerEnd="url(#am-s)" />
          <text x={225} y={(y + cy) / 2 - 4} fontSize="10" fill="currentColor">{l.c} requests</text></g>) })}
        {right.map((r, i) => { const y = yOf(i, right.length); return (<g key={r.n}>
          <rect x={560} y={y - 20} width={150} height={40} rx={r.k === 'db' ? 14 : 6} fill={r.k === 'db' ? 'rgba(230,81,0,0.12)' : 'rgba(46,125,50,0.12)'} stroke={r.k === 'db' ? '#e65100' : '#2e7d32'} />
          <text x={635} y={y + 4} textAnchor="middle" fontSize="11" fill="currentColor">{(r.k === 'db' ? '🗄 ' : '🌐 ') + r.n.slice(0, 20)}</text>
          <line x1={430} y1={cy} x2={560} y2={y} stroke="#546e7a" markerEnd="url(#am-s)" />
          <text x={495} y={(y + cy) / 2 - 4} fontSize="10" fill="currentColor">{r.c} {r.k === 'db' ? 'queries' : 'calls'}</text></g>) })}
      </svg>
    </div>
  )
}

function CodeNav({ m }) {
  const [q, setQ] = useState('')
  const [onlyUsed, setOnlyUsed] = useState(true)
  const rows = useMemo(() => (m.functions || []).filter(f => (!onlyUsed || f.calls > 0) && (!q || `${f.cls} ${f.name} ${f.location}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 400), [m, q, onlyUsed])
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter class / method / file…" style={{ width: 300, fontSize: 12, padding: '5px 8px' }} />
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={onlyUsed} onChange={e => setOnlyUsed(e.target.checked)} /> only code executed in this recording</label>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{rows.length} shown</span>
      </div>
      <div style={{ maxHeight: 520, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Class</th><th style={th}>Method</th><th style={th}>Source location</th><th style={th}>Runtime calls</th></tr></thead>
          <tbody>{rows.map((f, i) => (
            <tr key={i}><td style={td} title={f.cls}>{short(f.cls)}</td><td style={{ ...td, ...mono }}>{f.name}</td>
              <td style={{ ...td, ...mono }}>{f.location} <button className="btn btn-sm" style={{ marginLeft: 6, padding: '0 6px' }} onClick={() => navigator.clipboard?.writeText(f.location)} title="Copy location">⧉</button></td>
              <td style={td}>{f.calls || '—'}</td></tr>))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Sql({ m }) {
  const rows = m.sql || []
  if (!rows.length) return <Empty>No SQL queries were recorded in this map.</Empty>
  const max = Math.max(...rows.map(r => r.total_ms), 1)
  return (
    <div style={{ maxHeight: 560, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>Statement (literals replaced by ?)</th><th style={th}>DB</th><th style={th}>Count</th><th style={th}>Total ms</th><th style={th}>Max ms</th><th style={{ ...th, width: 160 }}>Time</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i}><td style={{ ...td, ...mono, wordBreak: 'break-word' }}>{r.sql}</td><td style={td}>{r.db}</td><td style={td}>{r.count}</td><td style={td}>{r.total_ms}</td><td style={td}>{r.max_ms}</td>
            <td style={td}><div style={{ height: 10, width: `${Math.max(2, r.total_ms / max * 100)}%`, background: '#e65100', borderRadius: 3 }} /></td></tr>))}
        </tbody>
      </table>
    </div>
  )
}

function Http({ m }) {
  const s = m.http_server || [], c = m.http_client || []
  if (!s.length && !c.length) return <Empty>No HTTP requests were recorded in this map.</Empty>
  const max = Math.max(...[...s, ...c].map(r => r.ms || 0), 1)
  const sc = st => st >= 500 ? '#c62828' : st >= 400 ? '#ef6c00' : '#2e7d32'
  const tbl = (title, rows, key) => rows.length > 0 && (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>{title} ({rows.length})</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>Method</th><th style={th}>{key === 'path' ? 'Path' : 'URL'}</th><th style={th}>Status</th><th style={th}>ms</th><th style={{ ...th, width: 200 }}>Duration</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i}><td style={{ ...td, fontWeight: 600 }}>{r.method}</td><td style={{ ...td, ...mono, wordBreak: 'break-all' }}>{r[key]}</td>
            <td style={{ ...td, color: sc(r.status), fontWeight: 600 }}>{r.status ?? '—'}</td><td style={td}>{r.ms ?? '—'}</td>
            <td style={td}><div style={{ height: 10, width: `${Math.max(2, (r.ms || 0) / max * 100)}%`, background: sc(r.status), borderRadius: 3 }} /></td></tr>))}
        </tbody>
      </table>
    </div>)
  return <div style={{ maxHeight: 560, overflow: 'auto' }}>{tbl('Incoming requests (server)', s, 'path')}{tbl('Outgoing requests (client)', c, 'url')}</div>
}

export default function AppMapTab({ appName, displayName }) {
  const [status, setStatus] = useState(null)
  const [maps, setMaps] = useState([])
  const [file, setFile] = useState('')
  const [m, setM] = useState(null)
  const [view, setView] = useState('sequence')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const loadList = () => {
    fetch(`/api/local-app/${appName}/appmap`).then(r => r.json()).then(setStatus).catch(() => {})
    fetch(`/api/local-app/${appName}/appmap/maps`).then(r => r.json()).then(d => {
      if (d.ok) { setMaps(d.maps); if (!file && d.maps[0]) setFile(d.maps[0].file) } else setErr(d.error || '')
    }).catch(() => setErr('Could not reach server'))
  }
  useEffect(loadList, [appName])
  useEffect(() => {
    if (!file) { setM(null); return }
    setLoading(true); setErr('')
    fetch(`/api/local-app/${appName}/appmap/map?file=${encodeURIComponent(file)}`).then(r => r.json())
      .then(d => { if (d.ok) setM(d); else { setM(null); setErr(d.error || 'Failed') } })
      .catch(() => setErr('Could not reach server')).finally(() => setLoading(false))
  }, [file, appName])

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>🗺️ AppMap — {displayName || appName}</div>
        {status?.available && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 12, background: status.enabled ? 'rgba(76,175,80,0.15)' : 'rgba(255,152,0,0.15)', color: status.enabled ? '#2e7d32' : '#e65100' }}>
            {status.enabled ? '● pom.xml dependency enabled' : '○ AppMap disabled (enable it in Code → Build & Deploy)'}
          </span>
        )}
        <select value={file} onChange={e => setFile(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', marginLeft: 'auto', maxWidth: 360 }}>
          {maps.length === 0 && <option value="">No recordings found</option>}
          {maps.map(x => <option key={x.file} value={x.file}>{x.name} · {x.modified}</option>)}
        </select>
        <button className="btn btn-sm" onClick={loadList}>↻ Refresh</button>
      </div>

      {maps.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, padding: '8px 12px', border: '1px dashed var(--border)', borderRadius: 6, marginBottom: 12 }}>
          No <code>*.appmap.json</code> recordings found under the app's <code>tmp/appmap</code> or <code>target/appmap</code> folders.
          Enable AppMap (Code → Build &amp; Deploy), rebuild, then run the app or its tests with the AppMap Java agent
          (<code>-javaagent:appmap.jar</code>, see appmap.io docs) so recordings are written, then press Refresh.
        </div>
      )}
      {err && <div style={{ color: '#c62828', fontSize: 12, marginBottom: 8 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)', marginBottom: 12, flexWrap: 'wrap' }}>
        {VIEWS.map(v => (
          <button key={v.key} onClick={() => setView(v.key)} style={{
            padding: '7px 14px', fontSize: 12, fontWeight: view === v.key ? 700 : 500, cursor: 'pointer', background: 'none', border: 'none',
            borderBottom: view === v.key ? '2px solid var(--primary, #1565c0)' : '2px solid transparent', color: view === v.key ? 'var(--primary, #1565c0)' : 'var(--text-muted)' }}>{v.label}</button>
        ))}
      </div>

      {loading && <div style={{ padding: 20 }}><span className="spinner" /></div>}
      {!loading && m && (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
            {m.name} · {m.totals.events} events · {m.totals.calls} calls · {m.totals.http_server} HTTP in · {m.totals.http_client} HTTP out · {m.totals.sql} SQL
          </div>
          {view === 'sequence' && <Sequence m={m} />}
          {view === 'calls'    && <Calls m={m} />}
          {view === 'services' && <Services m={m} appName={displayName || appName} />}
          {view === 'code'     && <CodeNav m={m} />}
          {view === 'sql'      && <Sql m={m} />}
          {view === 'http'     && <Http m={m} />}
        </>
      )}
    </div>
  )
}
