import { useState, useEffect, useMemo } from 'react'
import { usePanels } from './ScreenConfig'
import { CopyBtn } from './P6SpyTab'

const VIEWS = [
  { key: 'services', label: 'Service Maps' },
  { key: 'http',     label: 'Http Flow Visualization' },
  { key: 'deps',     label: 'Dependency Map' },
  { key: 'sequence', label: 'Sequence Diagram' },
  { key: 'flame',    label: 'Flame Graph' },
  { key: 'trace',    label: 'Trace View' },
  { key: 'calls',    label: 'Call Graphs' },
  { key: 'code',     label: 'Code to Runtime Navigation' },
  { key: 'sql',      label: 'SQL Visualization' },
]
const short = (c) => String(c || '').split('.').pop() || String(c || '')
const th = { textAlign: 'left', padding: '5px 8px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)' }
const td = { padding: '4px 8px', fontSize: 12, borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const mono = { fontFamily: 'monospace', fontSize: 11 }

function Empty({ children }) { return <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>{children}</div> }

const KIND_COLOR = { call: '#1565c0', sql: '#e65100', http: '#2e7d32', httpc: '#6a1b9a' }
function Legend() {
  return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Legend: <span style={{ color: KIND_COLOR.call }}>■ code</span> <span style={{ color: KIND_COLOR.sql }}>■ SQL</span> <span style={{ color: KIND_COLOR.http }}>■ HTTP in</span> <span style={{ color: KIND_COLOR.httpc }}>■ HTTP out</span></span>
}

// Dependency map: classes (or packages) as nodes laid out in columns by call depth, arrows = calls
function DepMap({ m }) {
  const [level, setLevel] = useState('class')
  const nameOf = c => level === 'class' ? c : (String(c).split('.').slice(0, -1).join('.') || c)
  const agg = {}
  ;(m.edges || []).forEach(e => { const a = nameOf(e.from), b = nameOf(e.to); if (a === b) return; const k = a + '\u0000' + b; agg[k] = (agg[k] || 0) + e.count })
  const edges = Object.entries(agg).map(([k, n]) => { const [a, b] = k.split('\u0000'); return { a, b, n } })
  if (!edges.length) return <Empty>No dependencies between {level === 'class' ? 'classes' : 'packages'} were recorded in this map.</Empty>
  const nodes = [...new Set(edges.flatMap(e => [e.a, e.b]))]
  const inc = {}; edges.forEach(e => { inc[e.b] = true })
  const col = {}; nodes.filter(n => !inc[n]).forEach(n => { col[n] = 0 })
  if (!Object.keys(col).length) col[nodes[0]] = 0
  for (let i = 0; i < nodes.length; i++) edges.forEach(e => { if (col[e.a] != null && (col[e.b] == null || col[e.b] < col[e.a] + 1) && col[e.a] + 1 < 8 && col[e.b] == null) col[e.b] = col[e.a] + 1 })
  nodes.forEach(n => { if (col[n] == null) col[n] = 0 })
  const cols = []; nodes.forEach(n => { (cols[col[n]] = cols[col[n]] || []).push(n) })
  const colW = 230, rowH = 38, NW = 190
  const pos = {}; cols.forEach((c, ci) => (c || []).forEach((n, ri) => { pos[n] = { x: 10 + ci * colW, y: 10 + ri * rowH } }))
  const W = cols.length * colW + 20, H = Math.max(...cols.map(c => (c || []).length)) * rowH + 30
  const maxN = Math.max(...edges.map(e => e.n))
  return (
    <div>
      <div style={{ marginBottom: 8, fontSize: 12 }}>Group by:{' '}
        {['class', 'package'].map(l => <button key={l} className={'btn btn-sm' + (level === l ? ' btn-primary' : '')} style={{ marginRight: 6 }} onClick={() => setLevel(l)}>{l}</button>)}
        <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{nodes.length} nodes · {edges.length} dependencies · line width = call count</span>
      </div>
      <div style={{ overflow: 'auto', maxHeight: 560 }}>
        <svg width={W} height={H}>
          <defs><marker id="am-d" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#78909c" /></marker></defs>
          {edges.map((e, i) => { const p = pos[e.a], q = pos[e.b]; const x1 = p.x + NW, y1 = p.y + 14, x2 = q.x, y2 = q.y + 14, back = x2 <= x1
            return <path key={i} d={back ? `M${p.x + NW / 2},${p.y + 28} C${p.x + NW / 2},${p.y + 60} ${q.x + NW / 2},${q.y - 20} ${q.x + NW / 2},${q.y}` : `M${x1},${y1} C${x1 + 40},${y1} ${x2 - 40},${y2} ${x2},${y2}`}
              fill="none" stroke="#78909c" strokeOpacity="0.7" strokeWidth={1 + 3 * e.n / maxN} markerEnd="url(#am-d)"><title>{e.a} → {e.b} ({e.n})</title></path> })}
          {nodes.map(n => <g key={n}><rect x={pos[n].x} y={pos[n].y} width={NW} height={28} rx={5} fill="rgba(21,101,192,0.12)" stroke="#1565c0" />
            <text x={pos[n].x + 8} y={pos[n].y + 18} fontSize="11" fill="currentColor"><title>{n}</title>{(level === 'class' ? short(n) : n).slice(-28)}</text></g>)}
        </svg>
      </div>
    </div>
  )
}

// Flame graph: bar width = time, row = call depth. Click a bar to zoom into it, "Reset" to go back
function Flame({ m }) {
  const spans = m.spans || []
  const [focus, setFocus] = useState(null)
  useEffect(() => setFocus(null), [m])
  if (!spans.length) return <Empty>No calls were recorded in this map.</Empty>
  const byId = {}; spans.forEach(s => { byId[s.id] = s })
  const inFocus = s => { if (focus == null) return true; let c = s; while (c) { if (c.id === focus) return true; c = byId[c.parent] } return false }
  const root = focus != null ? byId[focus] : null
  const vis = spans.filter(inFocus)
  const t0 = root ? root.start : 0
  const total = root ? root.ms : Math.max(...spans.filter(s => s.depth === 0).map(s => s.start + s.ms), 0.001)
  const W = 1000, rowH = 20, d0 = root ? root.depth : 0
  const maxD = Math.max(...vis.map(s => s.depth - d0))
  const H = (maxD + 1) * rowH + 10
  return (
    <div>
      <div style={{ fontSize: 12, marginBottom: 6 }}>
        {focus != null && <button className="btn btn-sm" style={{ marginRight: 8 }} onClick={() => setFocus(null)}>↩ Reset zoom</button>}
        <span style={{ color: 'var(--text-muted)' }}>Total {Math.round(total * 100) / 100} ms · click a bar to zoom · colours: <span style={{ color: KIND_COLOR.call }}>■ code</span> <span style={{ color: KIND_COLOR.sql }}>■ SQL</span> <span style={{ color: KIND_COLOR.http }}>■ HTTP in</span> <span style={{ color: KIND_COLOR.httpc }}>■ HTTP out</span></span>
      </div>
      <div style={{ overflow: 'auto', maxHeight: 560 }}>
        <svg width={W} height={H} style={{ background: 'var(--bg)' }}>
          {vis.map(s => { const w = s.ms / total * W; if (w < 1) return null; const x = (s.start - t0) / total * W; const y = (s.depth - d0) * rowH
            return <g key={s.id} onClick={() => setFocus(s.id)} style={{ cursor: 'pointer' }}>
              <rect x={x} y={y} width={Math.max(w - 1, 1)} height={rowH - 2} fill={KIND_COLOR[s.kind] || '#1565c0'} fillOpacity={0.35 + 0.1 * ((s.depth) % 5)} stroke="#fff" strokeWidth="0.5"><title>{s.label} — {s.ms} ms</title></rect>
              {w > 46 && <text x={x + 3} y={y + 13} fontSize="10" fill="currentColor" style={{ pointerEvents: 'none' }}>{s.label.slice(0, Math.floor(w / 6))}</text>}
            </g> })}
        </svg>
      </div>
    </div>
  )
}

// Trace view: waterfall of every span (code calls, SQL, HTTP) with its offset and duration
function Trace({ m }) {
  const spans = m.spans || []
  const [q, setQ] = useState('')
  if (!spans.length) return <Empty>No events were recorded in this map.</Empty>
  const total = Math.max(...spans.filter(s => s.depth === 0).map(s => s.start + s.ms), 0.001)
  const rows = spans.filter(s => !q || s.label.toLowerCase().includes(q.toLowerCase())).slice(0, 700)
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter spans…" style={{ width: 260, fontSize: 12, padding: '5px 8px' }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total {Math.round(total * 100) / 100} ms · {rows.length} spans · offsets are laid out sequentially (AppMap stores durations, not timestamps)</span>
        <Legend />
      </div>
      <div style={{ maxHeight: 560, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
        {rows.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', height: 22 }}>
            <div style={{ width: 380, flexShrink: 0, paddingLeft: 6 + Math.min(s.depth, 20) * 12, ...mono, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: KIND_COLOR[s.kind] }} title={s.label}>{s.label}</div>
            <div style={{ flex: 1, position: 'relative', height: 14 }}>
              <div style={{ position: 'absolute', left: `${s.start / total * 100}%`, width: `${Math.max(s.ms / total * 100, 0.3)}%`, height: '100%', background: KIND_COLOR[s.kind], borderRadius: 2, opacity: 0.8 }} />
            </div>
            <div style={{ width: 70, textAlign: 'right', paddingRight: 6, fontSize: 11 }}>{s.ms} ms</div>
          </div>
        ))}
      </div>
    </div>
  )
}

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
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Call tree <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => setOpen(o => !o)}>{open ? 'Collapse to depth 3' : 'Expand all'}</button> <span style={{ marginLeft: 8, fontWeight: 400 }}><Legend /></span></div>
        {calls.filter(c => open || c.depth < 3).map(c => (
          <div key={c.id} style={{ paddingLeft: Math.min(c.depth, 30) * 14, ...mono, borderLeft: '1px dotted var(--border)', whiteSpace: 'nowrap' }} title={`${c.path}:${c.line}`}>
            <span style={{ color: '#1565c0' }}>{short(c.cls)}</span>.{c.method}
            {c.params?.length > 0 && <span style={{ color: '#6a1b9a' }} title={c.params.join('\n')}>({c.params.join(', ').slice(0, 160)})</span>}
            {c.ret != null && <span style={{ color: '#2e7d32' }} title={c.ret}> → {c.ret.slice(0, 120)}</span>}
            {c.ms != null && <span style={{ color: 'var(--text-muted)' }}> {c.ms} ms</span>}
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

const copyText = (txt) => { try { navigator.clipboard.writeText(txt) } catch (e) { /* ignore */ } }

function Sql({ m }) {
  const rows = m.sql || []
  if (!rows.length) return <Empty>No SQL queries were recorded in this map.</Empty>
  const max = Math.max(...rows.map(r => r.total_ms), 1)
  return (
    <div style={{ maxHeight: 560, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>Statement (literals replaced by ?)<button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => copyText(rows.map(r => r.sql).join('\n\n'))}>Copy all</button></th><th style={th}>DB</th><th style={th}>Count</th><th style={th}>Total ms</th><th style={th}>Max ms</th><th style={{ ...th, width: 160 }}>Time</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i}><td style={{ ...td, ...mono, wordBreak: 'break-word' }}>{r.sql} <button className="btn btn-sm" onClick={() => copyText(r.sql)}>Copy</button></td><td style={td}>{r.db}</td><td style={td}>{r.count}</td><td style={td}>{r.total_ms}</td><td style={td}>{r.max_ms}</td>
            <td style={td}><div style={{ height: 10, width: `${Math.max(2, r.total_ms / max * 100)}%`, background: '#e65100', borderRadius: 3 }} /></td></tr>))}
        </tbody>
      </table>
    </div>
  )
}

function SqlExec({ m }) {
  const runs = m.sql_runs || []
  const [sel, setSel] = useState(null)
  if (!runs.length) return <Empty>No SQL queries were recorded in this map.</Empty>
  const r0 = runs.find(r => r.id === sel)
  return (
    <div style={{ maxHeight: 560, overflow: 'auto' }}>
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Executions ({runs.length}) — click one to see the statement as recorded</div>
      <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 8 }}>
        {runs.map((r, i) => (
          <div key={r.id} onClick={() => setSel(r.id)} style={{ ...mono, padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', background: sel === r.id ? 'rgba(21,101,192,0.12)' : undefined, borderBottom: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--text-muted)' }}>#{i + 1} · {r.ms ?? '—'} ms · </span>{r.sql.replace(/\s+/g, ' ')}
          </div>
        ))}
      </div>
      {r0 && (
        <div className="card" style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <b style={{ fontSize: 12, flex: 1 }}>Query · {r0.db} · {r0.ms ?? '—'} ms</b>
            <CopyBtn text={r0.sql} label="Copy query" />
            <button className="btn btn-sm" onClick={() => copyText(r0.params.join('\n'))} disabled={!r0.params.length}>Copy bind values</button>
          </div>
          <pre style={{ ...mono, margin: 0, whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto' }}>{r0.sql}</pre>
          <div style={{ fontSize: 11, marginTop: 6, color: 'var(--text-muted)' }}>
            Bind values: {r0.params.length ? r0.params.join(', ') : 'not recorded — the AppMap Java agent only records the statement text, so ? placeholders stay as ?.'}
            <br />Result set: not recorded by AppMap.
          </div>
        </div>
      )}
    </div>
  )
}

const SENSITIVE = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)$/i

// One side (request or response) of an HTTP exchange with everything AppMap recorded
function HttpSide({ title, color, general, side, reveal }) {
  const hs = Object.entries(side?.headers || {})
  const ctype = Object.entries(side?.headers || {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1]
  const clen = Object.entries(side?.headers || {}).find(([k]) => k.toLowerCase() === 'content-length')?.[1]
  const sub = { fontWeight: 600, fontSize: 11, margin: '8px 0 3px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }
  const kv = { ...td, ...mono, wordBreak: 'break-all' }
  return (
    <div style={{ flex: '1 1 420px', minWidth: 0, border: '1px solid var(--border)', borderTop: `3px solid ${color}`, borderRadius: 6, padding: '8px 12px' }}>
      <div style={{ fontWeight: 700, fontSize: 13, color }}>{title}</div>
      <div style={sub}>General</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>{general.map(([k, v]) => (
        <tr key={k}><td style={{ ...td, width: 110, color: 'var(--text-muted)' }}>{k}</td><td style={{ ...kv, ...(v?.style || {}) }}>{v?.text ?? (v || '—')}</td></tr>))}</tbody></table>
      {side?.params?.length > 0 && <>
        <div style={sub}>Query / form parameters ({side.params.length})</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>{side.params.map((p, i) => (
          <tr key={i}><td style={{ ...kv, width: '34%', fontWeight: 600 }}>{p.name}</td><td style={kv}>{p.value ?? '—'}</td></tr>))}</tbody></table>
      </>}
      <div style={sub}>Headers ({hs.length})</div>
      {hs.length === 0 ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>No headers were recorded.</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>{hs.map(([k, v]) => (
          <tr key={k}><td style={{ ...kv, width: '34%', fontWeight: 600 }}>{k}</td><td style={kv}>{SENSITIVE.test(k) && !reveal ? '••••••••  (hidden)' : v}</td></tr>))}</tbody></table>
      )}
      <div style={sub}>Body {side?.body != null && <CopyBtn text={side.body} label="Copy" />}</div>
      {side?.body != null
        ? <pre style={{ ...mono, margin: 0, padding: 8, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 260, overflow: 'auto' }}>{side.body}</pre>
        : <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>Not recorded — the AppMap Java agent does not capture HTTP bodies{clen ? <> (the {title.toLowerCase()} declares <b>{clen} bytes</b>{ctype ? <> of <code>{ctype}</code></> : null})</> : null}.</div>}
    </div>
  )
}

function Http({ m }) {
  const s = m.http_server || [], c = m.http_client || []
  const [open, setOpen] = useState({})              // "s<id>" / "c<id>" -> details shown
  const [reveal, setReveal] = useState(false)       // show Authorization / Cookie header values
  if (!s.length && !c.length) return <Empty>No HTTP requests were recorded in this map.</Empty>
  const all = [...s.map(r => 's' + r.id), ...c.map(r => 'c' + r.id)]
  const max = Math.max(...[...s, ...c].map(r => r.ms || 0), 1)
  const sc = st => st >= 500 ? '#c62828' : st >= 400 ? '#ef6c00' : '#2e7d32'
  const tbl = (title, rows, key, pre) => rows.length > 0 && (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>{title} ({rows.length})</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={{ ...th, width: 24 }} /><th style={th}>Method</th><th style={th}>{key === 'path' ? 'Path' : 'URL'}</th><th style={th}>Status</th><th style={th}>ms</th><th style={{ ...th, width: 200 }}>Duration</th></tr></thead>
        <tbody>{rows.map(r => {
          const id = pre + r.id, isOpen = !!open[id]
          const url = r[key] || ''
          return [
            <tr key={id} onClick={() => setOpen(o => ({ ...o, [id]: !o[id] }))} style={{ cursor: 'pointer', background: isOpen ? 'rgba(21,101,192,0.08)' : undefined }} title="Click to show request / response details">
              <td style={{ ...td, color: 'var(--text-muted)' }}>{isOpen ? '▾' : '▸'}</td>
              <td style={{ ...td, fontWeight: 600 }}>{r.method}</td><td style={{ ...td, ...mono, wordBreak: 'break-all' }}>{url}</td>
              <td style={{ ...td, color: sc(r.status), fontWeight: 600 }}>{r.status ?? '—'}</td><td style={td}>{r.ms ?? '—'}</td>
              <td style={td}><div style={{ height: 10, width: `${Math.max(2, (r.ms || 0) / max * 100)}%`, background: sc(r.status), borderRadius: 3 }} /></td></tr>,
            isOpen && (
              <tr key={id + 'd'}><td colSpan={6} style={{ ...td, background: 'var(--surface)', padding: 10 }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <HttpSide title="Request" color="#1565c0" reveal={reveal} side={r.req}
                    general={[['URL / path', url], ['Method', r.method], ['Protocol', r.req?.protocol]]} />
                  <HttpSide title="Response" color={sc(r.status)} reveal={reveal} side={r.res}
                    general={[['Status code', { text: r.status ?? '—', style: { color: sc(r.status), fontWeight: 700 } }], ['Duration', r.ms != null ? `${r.ms} ms` : '—'], ['Protocol', r.res?.protocol]]} />
                </div>
              </td></tr>),
          ]
        })}
        </tbody>
      </table>
    </div>)
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-sm" onClick={() => setOpen(Object.fromEntries(all.map(k => [k, true])))}>▾ Show all details</button>
        <button className="btn btn-sm" onClick={() => setOpen({})}>▸ Hide all</button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} title="Authorization, Cookie and similar headers are masked unless this is on">
          <input type="checkbox" checked={reveal} onChange={e => setReveal(e.target.checked)} /> Show sensitive headers (Authorization, Cookie…)
        </label>
        <span style={{ color: 'var(--text-muted)' }}>Click a row for the request and response details.</span>
      </div>
      <div style={{ maxHeight: 640, overflow: 'auto' }}>{tbl('Incoming requests (server)', s, 'path', 's')}{tbl('Outgoing requests (client)', c, 'url', 'c')}</div>
    </div>
  )
}

// Loaded data survives leaving and re-entering the tab (kept per app until Refresh)
const CACHE = {}

export default function AppMapTab({ appName, displayName }) {
  const C = CACHE[appName] || (CACHE[appName] = { mc: {} })
  const [status, setStatus] = useState(C.status ?? null)
  const [maps, setMaps] = useState(C.maps ?? [])
  const [file, setFile] = useState(C.file ?? '')
  const [m, setM] = useState(C.m ?? null)
  const [view0, setView] = useState(C.view ?? 'services')
  const on = usePanels()
  const VV = VIEWS.filter(v => on('am_' + v.key))
  const view = VV.some(v => v.key === view0) ? view0 : VV[0]?.key
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [cfg, setCfg] = useState(C.cfg ?? null)       // { path, content, output, lib }
  const [cfgText, setCfgText] = useState(C.cfg?.content ?? '')
  const [amSet, setAmSet] = useState(C.amSet ?? { enabled: false, record_values: false })
  useEffect(() => { Object.assign(C, { status, maps, file, m, view, cfg, amSet }) })
  // always read the saved setting: the effect above already put the default (disabled) into C.amSet, so a cache check here
  // would skip the fetch and show "disabled" while the server still has recording enabled
  useEffect(() => {
    fetch(`/api/local-app/${appName}/appmap/settings`).then(r => r.json()).then(d => { if (d.ok) setAmSet({ enabled: d.enabled, record_values: d.record_values }) }).catch(() => {})
  }, [appName])
  const saveSet = (patch) => {
    const n = { ...amSet, ...patch }; setAmSet(n)
    fetch(`/api/local-app/${appName}/appmap/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(n) }).catch(() => {})
  }
  const [cfgOpen, setCfgOpen] = useState(false)
  const [cfgMsg, setCfgMsg] = useState('')
  useEffect(() => {
    if (C.cfg) return
    fetch(`/api/local-app/${appName}/appmap/config`).then(r => r.json())
      .then(d => { if (d.ok) { setCfg(d); setCfgText(d.content) } }).catch(() => {})
  }, [appName])
  const delMaps = (all) => {
    const x = maps.find(q => q.file === file)
    if (!window.confirm(all ? `Delete all ${maps.length} recordings?` : `Delete recording ${x?.name || file}?`)) return
    fetch(`/api/local-app/${appName}/appmap/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(all ? { all: true } : { file }) })
      .then(r => r.json()).then(d => { if (!d.ok) setErr(d.error || 'Delete failed'); setFile(''); setM(null); loadList() })
      .catch(() => setErr('Request failed'))
  }
  const saveCfg = () => {
    setCfgMsg('Saving…')
    fetch(`/api/local-app/${appName}/appmap/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: cfgText }) })
      .then(r => r.json()).then(d => { if (d.ok) { setCfg(d); setCfgText(d.content); setCfgMsg('Saved') } else setCfgMsg(d.error || 'Failed') })
      .catch(() => setCfgMsg('Request failed'))
  }

  const loadList = () => {
    C.mc = {}
    fetch(`/api/local-app/${appName}/appmap`).then(r => r.json()).then(setStatus).catch(() => {})
    fetch(`/api/local-app/${appName}/appmap/maps`).then(r => r.json()).then(d => {
      if (d.ok) { setMaps(d.maps); setFile(f => (d.maps.some(x => x.file === f) ? f : (d.maps[0]?.file || ''))) } else setErr(d.error || '')
    }).catch(() => setErr('Could not reach server'))
  }
  useEffect(() => { if (!C.maps) loadList() }, [appName])
  useEffect(() => {
    if (!file) { setM(null); setErr(''); return }
    if (C.mc[file]) { setM(C.mc[file]); return }
    setLoading(true); setErr('')
    fetch(`/api/local-app/${appName}/appmap/map?file=${encodeURIComponent(file)}`).then(r => r.json())
      .then(d => { if (d.ok) { C.mc[file] = d; setM(d) } else { setM(null); setErr(d.error || 'Failed') } })
      .catch(() => setErr('Could not reach server')).finally(() => setLoading(false))
  }, [file, appName])

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>🗺️ AppMap — {displayName || appName}</div>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} title="Attach the AppMap agent when a test runs from the IT tab">
          <input type="checkbox" checked={amSet.enabled} onChange={e => saveSet({ enabled: e.target.checked })} /> Enable recording
        </label>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: amSet.enabled ? 'pointer' : 'not-allowed', opacity: amSet.enabled ? 1 : 0.5 }} title="Record parameter and return values. Slower, and can fail on objects whose toString() throws">
          <input type="checkbox" checked={amSet.record_values} disabled={!amSet.enabled} onChange={e => saveSet({ record_values: e.target.checked })} /> Record parameter &amp; return values
        </label>
        <select value={file} onChange={e => setFile(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', marginLeft: 'auto', maxWidth: 360 }}>
          {maps.length === 0 && <option value="">No recordings found</option>}
          {maps.map(x => <option key={x.file} value={x.file}>{x.name} · {x.modified} · {x.size > 1048576 ? Math.round(x.size / 1048576) + ' MB' : Math.round(x.size / 1024) + ' KB'}</option>)}
        </select>
        <button className="btn btn-sm" onClick={loadList}>↻ Refresh</button>
        <button className="btn btn-sm" onClick={() => delMaps(false)} disabled={!file} title="Delete the selected recording">🗑 Delete</button>
        <button className="btn btn-sm" onClick={() => delMaps(true)} disabled={maps.length === 0} title="Delete all recordings">🗑 Delete all</button>
      </div>

      {cfg && (
        <div style={{ marginBottom: 12, fontSize: 12 }}>
          <button className="btn btn-sm" onClick={() => setCfgOpen(o => !o)}>{cfgOpen ? '▾' : '▸'} appmap.yml configuration</button>
          <span style={{ marginLeft: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{cfg.path}</span>
          {cfgOpen && (
            <div style={{ marginTop: 8 }}>
              <textarea value={cfgText} onChange={e => setCfgText(e.target.value)} spellCheck={false}
                style={{ width: '100%', minHeight: 140, fontFamily: 'monospace', fontSize: 12, padding: 8, boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6 }}>
                <button className="btn btn-sm btn-primary" onClick={saveCfg} disabled={cfgText === cfg.content}>Save</button>
                <span style={{ color: 'var(--text-muted)' }}>{cfgMsg}</span>
              </div>
              <div style={{ color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.6 }}>
                Agent jar: <code>{cfg.lib}</code> · Recordings: <code>{cfg.output}</code>. List the packages to record under <code>packages:</code>.
              </div>
            </div>
          )}
        </div>
      )}
      {maps.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, padding: '8px 12px', border: '1px dashed var(--border)', borderRadius: 6, marginBottom: 12 }}>
          No <code>*.appmap.json</code> recordings found under <code>DWB_Projects\Setup\Dev_Softwares\AppMap\&lt;App&gt;\tmp\appmap</code>.
          Install the agent in Setup → Dev Softwares → AppMap, tick Enable recording, then run a test from the IT tab (the agent is attached automatically), then press Refresh.
        </div>
      )}
      {err && <div style={{ color: '#c62828', fontSize: 12, marginBottom: 8 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)', marginBottom: 12, flexWrap: 'wrap' }}>
        {VV.map(v => (
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
          {view === 'deps'     && <DepMap m={m} />}
          {view === 'flame'    && <Flame m={m} />}
          {view === 'trace'    && <Trace m={m} />}
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
