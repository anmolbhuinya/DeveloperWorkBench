import { useState, useEffect, useMemo, useRef } from 'react'
import { renderRelations } from './relView'
import relSrc from './relView.js?raw'

// Sorting, filtering, the row context menu (Copy / Export / View Relations) and the relationship diagram for a query result grid.

const cellText = v => (v === null || v === undefined ? '' : String(v))
const csvEsc = v => `"${cellText(v).replace(/"/g, '""')}"`

function download(content, filename, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export function saveRows(columns, rows, fmt, base, exportUrl) {
  if (fmt === 'csv') { download('﻿' + [columns.map(csvEsc).join(','), ...rows.map(r => r.map(csvEsc).join(','))].join('\r\n'), base + '.csv', 'text/csv'); return Promise.resolve() }
  return fetch(exportUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ columns, rows, format: 'xlsx' }) })
    .then(r => { if (!r.ok) throw new Error('Export failed'); return r.blob() })
    .then(b => { const url = URL.createObjectURL(b); const a = document.createElement('a'); a.href = url; a.download = base + '.xlsx'; a.click(); URL.revokeObjectURL(url) })
    .catch(e => alert(e.message))
}

// ── sort + filter state; `order` is the list of original row indexes to show ─────────────────────────────────
export function useGridView(result) {
  const [sort, setSort] = useState(null)             // { ci, dir }
  const [filters, setFilters] = useState({})         // ci -> text
  const [menu, setMenu] = useState(null)             // { x, y, ri }
  const [rel, setRel] = useState(null)               // { ri }
  useEffect(() => { setSort(null); setFilters({}) }, [result?.sql])
  const order = useMemo(() => {
    if (!result?.rows) return []
    let idx = result.rows.map((_, i) => i)
    const act = Object.entries(filters).filter(([, t]) => t !== '')
    if (act.length) idx = idx.filter(i => act.every(([ci, t]) => cellText(result.rows[i][ci]).toLowerCase().includes(t.toLowerCase())))
    if (sort) {
      const { ci, dir } = sort
      const num = idx.every(i => { const v = result.rows[i][ci]; return v === null || v === '' || (typeof v === 'number') || (!isNaN(Number(v)) && String(v).trim() !== '') })
      idx = [...idx].sort((a, b) => {
        const x = result.rows[a][ci], y = result.rows[b][ci]
        if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1      // NULLs last
        if (y === null || y === undefined) return -1
        const c = num ? Number(x) - Number(y) : cellText(x).localeCompare(cellText(y), undefined, { numeric: true, sensitivity: 'base' })
        return dir === 'asc' ? c : -c
      })
    }
    return idx
  }, [result, sort, filters])
  const clickSort = ci => setSort(s => !s || s.ci !== ci ? { ci, dir: 'asc' } : s.dir === 'asc' ? { ci, dir: 'desc' } : null)
  const filterActive = Object.values(filters).some(t => t !== '')
  return { sort, clickSort, filters, setFilters, order, menu, setMenu, rel, setRel, filterActive, clear: () => { setSort(null); setFilters({}) } }
}

const sortMark = (gv, ci) => gv.sort && gv.sort.ci === ci ? (gv.sort.dir === 'asc' ? ' ▲' : ' ▼') : ''
export function SortableTh({ gv, ci, label, style }) {
  return <th onClick={() => gv.clickSort(ci)} title="Click to sort (ascending, descending, none)" style={{ ...style, cursor: 'pointer', userSelect: 'none' }}>{label}{sortMark(gv, ci)}</th>
}
export function FilterRow({ gv, columns }) {
  const st = { position: 'sticky', top: 28, background: 'var(--surface)', padding: '2px 4px', borderBottom: '1px solid var(--border)', zIndex: 1 }
  return (
    <tr>
      <th style={{ ...st, padding: 0 }} />
      {columns.map((c, ci) => (
        <th key={ci} style={st}>
          <input value={gv.filters[ci] || ''} onChange={e => gv.setFilters(f => ({ ...f, [ci]: e.target.value }))} placeholder="filter"
            style={{ width: '100%', minWidth: 60, boxSizing: 'border-box', fontSize: 10, padding: '1px 4px', border: '1px solid var(--border)', borderRadius: 3, background: 'var(--surface2)', color: 'var(--text)' }} />
        </th>))}
    </tr>
  )
}

// ── row context menu ─────────────────────────────────────────────────────────────────────────────────────────
export function RowMenu({ gv, result, exportUrl, table }) {
  const [sub, setSub] = useState(false)
  const [copied, setCopied] = useState('')
  useEffect(() => {
    if (!gv.menu) { setSub(false); setCopied(''); return }
    const close = () => gv.setMenu(null)
    window.addEventListener('click', close); window.addEventListener('scroll', close, true)
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true) }
  }, [gv.menu])
  if (!gv.menu || !result) return null
  const row = result.rows[gv.menu.ri]
  const item = { padding: '6px 14px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }
  const hov = e => { e.currentTarget.style.background = 'rgba(128,128,128,0.15)' }
  const unhov = e => { e.currentTarget.style.background = 'transparent' }
  const copy = (e) => {
    e.stopPropagation()
    setCopied('Copying row…')
    navigator.clipboard.writeText(result.columns.join('\t') + '\n' + row.map(cellText).join('\t'))
      .then(() => { setCopied('Copied row ✓'); setTimeout(() => gv.setMenu(null), 700) }).catch(() => setCopied('Copy failed'))
  }
  return (
    <div onClick={e => e.stopPropagation()} style={{ position: 'fixed', top: gv.menu.y, left: gv.menu.x, zIndex: 3000, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.25)', minWidth: 170, padding: '4px 0' }}>
      <div style={item} onMouseEnter={hov} onMouseLeave={unhov} onClick={copy}>{copied || '📋 Copy'}</div>
      <div style={{ ...item, position: 'relative' }} onMouseEnter={e => { hov(e); setSub(true) }} onMouseLeave={unhov} onClick={() => setSub(s => !s)}>
        ⬇ Export ▸
        {sub && (
          <div style={{ position: 'absolute', left: '100%', top: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.25)', minWidth: 90, padding: '4px 0' }}>
            {['csv', 'xlsx'].map(f => (
              <div key={f} style={item} onMouseEnter={hov} onMouseLeave={unhov}
                onClick={e => { e.stopPropagation(); saveRows(result.columns, [row], f, 'row', exportUrl); gv.setMenu(null) }}>{f.toUpperCase()}</div>))}
          </div>)}
      </div>
      <div style={{ ...item, opacity: table ? 1 : 0.5 }} onMouseEnter={hov} onMouseLeave={unhov}
        title={table ? '' : 'Enter the source table in the Table field first'}
        onClick={() => { if (table) { gv.setRel({ ri: gv.menu.ri }); gv.setMenu(null) } }}>🕸 View Relations</div>
    </div>
  )
}

// ── relationship diagrams (the drawing code lives in relView.js and is also embedded in the exported HTML) ──────────────
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// the colours of the Workbench as it looks right now (light or dark), so the exported page matches the screen
function themeCss() {
  const names = ['text', 'text-muted', 'border', 'surface', 'surface2', 'bg', 'primary']
  const cs = getComputedStyle(document.documentElement)
  const pick = (n, fb) => (cs.getPropertyValue('--' + n) || '').trim() || fb
  const bodyBg = getComputedStyle(document.body).backgroundColor
  const fb = { text: '#1f2933', 'text-muted': '#667', border: '#cfd8dc', surface: '#fff', surface2: '#fff', bg: bodyBg || '#fafafa', primary: '#1565c0' }
  return ':root{' + names.map(n => `--${n}:${pick(n, fb[n])}`).join(';') + '}'
}

function buildHtml(g, mode, title) {
  const data = JSON.stringify(g).replace(/</g, '\\u003c')
  const src = relSrc.replace(/^export\s+/gm, '')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${themeCss()}
html,body{height:100%;margin:0}body{font-family:system-ui,sans-serif;background:var(--surface);color:var(--text);display:flex;flex-direction:column;padding:14px;box-sizing:border-box}
h2{margin:0 0 4px;font-size:16px}.sub{font-size:11px;color:var(--text-muted);margin-bottom:10px}#v{flex:1;min-height:0}</style></head>
<body><h2>${esc(title)}</h2><div class="sub">Generated ${esc(new Date().toLocaleString())} · ${g.nodes.length} ${mode === 'row' ? 'row(s)' : 'table(s)'} · ${g.edges.length} relation(s)</div><div id="v"></div>
<script>${src.replace(/<\/script/gi, '<\\/script')}</script>
<script>renderRelations(document.getElementById('v'), ${data}, { mode: '${mode}' })</script></body></html>`
}

function graphRows(g, mode) {
  const byId = Object.fromEntries(g.nodes.map(n => [n.id, n]))
  const link = {}
  g.edges.forEach(e => { if (!link[e.from]) link[e.from] = { to: byId[e.to], label: e.label }; if (!link[e.to]) link[e.to] = { to: byId[e.from], label: e.label } })
  if (mode === 'schema') {
    const par = {}, chi = {}
    g.edges.forEach(e => { (par[e.from] = par[e.from] || []).push(byId[e.to]?.table); (chi[e.to] = chi[e.to] || []).push(byId[e.from]?.table) })
    return { cols: ['Schema', 'Table', 'Relations', 'Parents (points to)', 'Children (pointed at by)'],
      rows: [...g.nodes].map(n => [n.schema, n.table, (par[n.id] || []).length + (chi[n.id] || []).length, [...new Set(par[n.id] || [])].join(', '), [...new Set(chi[n.id] || [])].join(', ')]).sort((a, b) => b[2] - a[2]) }
  }
  const cols = ['Level', 'Schema', 'Table', 'Related To', 'Via (FK columns)', mode === 'row' ? 'Row Values' : 'Columns']
  const rows = [...g.nodes].sort((a, b) => a.level - b.level).map(n => {
    const l = link[n.id]
    return [n.level, n.schema, n.table, n.id === g.root ? '(selected)' : l ? l.to.table : '', l ? l.label : '',
      Object.entries(n.row || {}).filter(([, v]) => v !== null && v !== '').map(([k, v]) => mode === 'row' ? `${k}=${v}` : `${k} ${v}`).join('; ')]
  })
  return { cols, rows }
}

function RelView({ g, mode, onPick, loadCols, onSearchMiss, searchTables }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current || !g) return
    const hnd = renderRelations(ref.current, g, { mode, onPick, loadCols, onSearchMiss, searchTables })
    return () => hnd.destroy()
  }, [g])
  return <div ref={ref} style={{ height: '100%' }} />
}

const navBtn = { background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 9px', cursor: 'pointer', color: 'var(--text)', fontSize: 12 }
function Shell({ title, onClose, left, right, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 3100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, width: '94vw', height: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {left}<b style={{ fontSize: 13 }}>{title}</b>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>{right}
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)' }}>✕</button></span>
        </div>
        <div style={{ flex: 1, minHeight: 0, padding: 12, display: 'flex', flexDirection: 'column' }}>{children}</div>
      </div>
    </div>
  )
}
const DepthSel = ({ depth, setDepth }) => <span style={{ fontSize: 11 }}>Depth <select value={depth} onChange={e => setDepth(Number(e.target.value))} style={{ fontSize: 11 }}>{[1, 2, 3].map(d => <option key={d} value={d}>{d}</option>)}</select></span>
function ExportBtns({ g, mode, title, base, exportUrl, prep }) {
  if (!g) return null
  const go = async f => {
    const gg = prep ? await prep(g) : g
    if (f === 'html') download(buildHtml(gg, mode, title), base + '.html', 'text/html')
    else { const { cols, rows } = graphRows(gg, mode); saveRows(cols, rows, f, base, exportUrl) }
  }
  return ['csv', 'xlsx', 'html'].map(f => <button key={f} className="btn btn-sm" onClick={() => go(f)}>Export {f.toUpperCase()}</button>)
}
function useGraph(fetcher, deps) {
  const [g, setG] = useState(null), [err, setErr] = useState(null), [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true); setErr(null); setG(null)
    fetcher().then(d => { if (d.ok) setG(d); else setErr(d.error) }).catch(() => setErr('Request failed')).finally(() => setLoading(false))
  }, deps)
  return { g, err, loading }
}
const Body = ({ loading, err, g, note, children }) => <>
  {loading && <div style={{ textAlign: 'center', padding: 30 }}><span className="spinner" /></div>}
  {err && <div style={{ color: '#c62828', fontSize: 12 }}>{err}</div>}
  {g && <>{note && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{note}</div>}<div style={{ flex: 1, minHeight: 0 }}>{children}</div></>}
</>

// one clicked row of a query result; clicking another box re-centres on that row (Back / Forward step through the rows seen)
export function RelationsModal({ gv, result, table, schemaFallback, relationsUrl, exportUrl, extra = {} }) {
  const [depth, setDepth] = useState(2)
  const ri = gv.rel?.ri
  const [schema, tbl] = useMemo(() => { const p = String(table || '').replace(/"/g, '').split('.'); return p.length > 1 ? [p[0], p[1]] : [schemaFallback || '', p[0]] }, [table, schemaFallback])
  const [hist, setHist] = useState([]), [hp, setHp] = useState(0)
  useEffect(() => {
    if (ri === undefined) { setHist([]); setHp(0); return }
    const values = {}; result.columns.forEach((c, i) => { values[c] = result.rows[ri][i] })
    setHist([{ schema, table: tbl, values }]); setHp(0)
  }, [ri])
  const cur = hist[hp]
  const { g, err, loading } = useGraph(() => cur ? fetch(relationsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schema: cur.schema, table: cur.table, values: cur.values, depth, ...extra }) }).then(r => r.json()) : new Promise(() => {}), [hist, hp, depth])
  if (ri === undefined || !cur) return null
  const pick = n => { if (n.id === g?.root) return; setHist(h => [...h.slice(0, hp + 1), { schema: n.schema, table: n.table, values: n.row }]); setHp(hp + 1) }
  return (
    <Shell title={`Relations of ${cur.schema}.${cur.table}`} onClose={() => gv.setRel(null)}
      left={<><button style={{ ...navBtn, opacity: hp > 0 ? 1 : 0.4 }} disabled={hp <= 0} onClick={() => setHp(hp - 1)}>← Back</button>
        <button style={{ ...navBtn, opacity: hp < hist.length - 1 ? 1 : 0.4 }} disabled={hp >= hist.length - 1} onClick={() => setHp(hp + 1)}>Forward →</button></>}
      right={<><DepthSel depth={depth} setDepth={setDepth} /><ExportBtns g={g} mode="row" title={`Relations of ${cur.schema}.${cur.table} (row)`} base="relations" exportUrl={exportUrl} /></>}>
      <Body loading={loading} err={err} g={g} note={g && `${g.nodes.length} row(s) in ${new Set(g.nodes.map(n => n.table)).size} table(s)${g.truncated ? ' - the list was limited, lower the depth to see everything' : ''}${g.nodes.length === 1 ? ' · this row has no related rows through foreign keys' : ''}`}>
        <RelView g={g} mode="row" onPick={pick} />
      </Body>
    </Shell>
  )
}

// the tables related to one table
export function TableRelationsModal({ url, schema, table, onClose, exportUrl, extra = '' }) {
  const [hist, setHist] = useState([{ schema, table }]), [hp, setHp] = useState(0), [depth, setDepth] = useState(1)
  const cur = hist[hp]
  const { g, err, loading } = useGraph(() => fetch(`${url}?schema=${encodeURIComponent(cur.schema)}&table=${encodeURIComponent(cur.table)}&depth=${depth}${extra}`).then(r => r.json()), [hist, hp, depth])
  const pick = n => { if (n.id === g?.root) return; setHist(h => [...h.slice(0, hp + 1), { schema: n.schema, table: n.table }]); setHp(hp + 1) }
  return (
    <Shell title={`Relations of ${cur.schema}.${cur.table}`} onClose={onClose}
      left={<><button style={{ ...navBtn, opacity: hp > 0 ? 1 : 0.4 }} disabled={hp <= 0} onClick={() => setHp(hp - 1)}>← Back</button>
        <button style={{ ...navBtn, opacity: hp < hist.length - 1 ? 1 : 0.4 }} disabled={hp >= hist.length - 1} onClick={() => setHp(hp + 1)}>Forward →</button></>}
      right={<><DepthSel depth={depth} setDepth={setDepth} /><ExportBtns g={g} mode="table" title={`Relations of ${cur.schema}.${cur.table}`} base="table_relations" exportUrl={exportUrl} /></>}>
      <Body loading={loading} err={err} g={g} note={g && `${g.nodes.length} table(s)${g.truncated ? ' - limited, lower the depth' : ''}${g.nodes.length === 1 ? ' · this table has no foreign key relations' : ''}`}>
        <RelView g={g} mode="table" onPick={pick} />
      </Body>
    </Shell>
  )
}

// the whole schema: tables are sized by how many relations they have; selecting one enlarges it and its neighbours to show their columns
export function SchemaRelationsModal({ schema, onClose, schemaUrl, colsUrl, exportUrl, extra = '' }) {
  const [iso, setIso] = useState(false)
  const [focus, setFocus] = useState('')
  const { g, err, loading } = useGraph(() => fetch(`${schemaUrl}?schema=${encodeURIComponent(schema)}${iso ? '&isolated=1' : ''}${focus ? '&focus=' + encodeURIComponent(focus) : ''}${extra}`).then(r => r.json()), [schema, iso, focus])
  const loadCols = async ids => {
    const tables = ids.map(id => { const n = g.nodes.find(x => x.id === id); return n && { schema: n.schema, table: n.table } }).filter(Boolean)
    const out = {}
    for (let i = 0; i < tables.length; i += 100) {
      const d = await fetch(colsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tables: tables.slice(i, i + 100), ...(extra ? { vm_ip: new URLSearchParams(extra).get('vm_ip') } : {}) }) }).then(r => r.json())
      if (d.ok) Object.assign(out, d.cols)
    }
    return out
  }
  const prep = async gg => ({ ...gg, cols: await loadCols(gg.nodes.map(n => n.id)) })     // the exported page carries the columns of every table
  return (
    <Shell title={`Relations in schema ${schema}`} onClose={onClose} right={<><label style={{ fontSize: 11, display: 'inline-flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={iso} onChange={e => setIso(e.target.checked)} />Show tables without relations</label><ExportBtns g={g} mode="schema" title={`Relations in schema ${schema}`} base={`${schema}_relations`} exportUrl={exportUrl} prep={prep} /></>}>
      <Body loading={loading} err={err} g={g} note={g && `${g.nodes.length} table(s)${iso ? '' : ' with foreign keys'}${g.total ? ' of ' + g.total : ''}, ${g.edges.length} relation(s)${g.truncated ? ` - showing the ${g.nodes.length - (g.focus ? 0 : 0)} most connected of ${g.connected} tables that have relations; type a table name in the find box and click Search to bring any other table in` : ''}`}>
        <RelView g={g} mode="schema" loadCols={loadCols} onSearchMiss={q => setFocus(q)} searchTables={q => fetch(`${schemaUrl.replace('schema-relations', 'search-tables')}?schema=${encodeURIComponent(schema)}&q=${encodeURIComponent(q)}${extra}`).then(r => r.json()).then(d => d.ok ? d.tables : [])} />
      </Body>
    </Shell>
  )
}
