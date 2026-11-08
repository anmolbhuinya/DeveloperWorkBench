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
      (n.cols || Object.keys(n.row || {})).map(k => [k, (n.row || {})[k]]).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => mode === 'row' ? `${k}=${v}` : `${k} ${v}`).join('; ')]
  })
  return { cols, rows }
}

function RelView({ g, mode, onPick, loadCols, onSearchMiss, searchTables, picked, onToggle, keyOf }) {   // row / table views keep the enlargement step when another row or table is picked
  const ref = useRef(null), hndRef = useRef(null), pickRef = useRef(picked), keyRef = useRef(keyOf)
  pickRef.current = picked; keyRef.current = keyOf
  useEffect(() => {
    if (!ref.current || !g) return
    const hnd = renderRelations(ref.current, g, { mode, onPick, loadCols, onSearchMiss, searchTables, keepEmph: mode !== 'schema', picked: pickRef.current, onToggle, keyOf: n => (keyRef.current ? keyRef.current(n) : `${n.schema}.${n.table}`) })
    hndRef.current = hnd
    return () => { hnd.destroy(); hndRef.current = null }
  }, [g])
  useEffect(() => { if (hndRef.current) hndRef.current.setPicked(picked) }, [picked])
  return <div ref={ref} style={{ height: '100%' }} />
}

const navBtn = { background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 9px', cursor: 'pointer', color: 'var(--text)', fontSize: 12 }
function Shell({ title, onClose, left, right, children }) {
  const [full, setFull] = useState(() => { try { return localStorage.getItem('relFull') === '1' } catch (e) { return false } })
  const toggle = () => setFull(v => { const n = !v; try { localStorage.setItem('relFull', n ? '1' : '0') } catch (e) { /* ignore */ } return n })
  useEffect(() => { const k = e => { if (e.key === 'Escape' && full) setFull(false) }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [full])
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 3100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: full ? 0 : 10, width: full ? '100vw' : '94vw', height: full ? '100vh' : '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {left}<b style={{ fontSize: 13 }}>{title}</b>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>{right}
            <button onClick={toggle} title={full ? 'Exit full screen (Esc)' : 'Full screen'} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', fontSize: 13, color: 'var(--text)', padding: '1px 8px' }}>{full ? '🗗 Exit full screen' : '⛶ Full screen'}</button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)' }}>✕</button></span>
        </div>
        <div style={{ flex: 1, minHeight: 0, padding: 12, display: 'flex', flexDirection: 'column' }}>{children}</div>
      </div>
    </div>
  )
}
const DepthSel = ({ depth, setDepth }) => <span style={{ fontSize: 11 }}>Depth <select value={depth} onChange={e => setDepth(Number(e.target.value))} style={{ fontSize: 11 }}>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(d => <option key={d} value={d}>{d}</option>)}</select></span>
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
const Body = ({ loading, err, g, note, children, shrink }) => <>
  {loading && <div style={{ textAlign: 'center', padding: 30 }}><span className="spinner" /></div>}
  {err && <div style={{ color: '#c62828', fontSize: 12 }}>{err}</div>}
  {g && <>{note && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{note}</div>}<div style={{ flex: shrink ? '0 0 36%' : 1, minHeight: 0 }}>{children}</div></>}
</>

// one clicked row of a query result; clicking another box re-centres on that row (Back / Forward step through the rows seen)
const sqlLit = v => typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`

// pick columns from the related tables of a row, get the joining query, run it and export the result
// The tables of a row's neighbourhood as join instances. A table reached along a different path (parent of the row, child of the row, a distant relation ...)
// is its own instance, so its columns are picked on their own; rows of one table reached the same way share an instance.
function buildModel(g) {
  const key = n => `${n.schema}.${n.table}`
  const byId = Object.fromEntries(g.nodes.map(n => [n.id, n]))
  const rootNode = byId[g.root] || g.nodes[0]
  const tabs = {}
  g.nodes.forEach(n => {
    const k = key(n)
    if (!tabs[k]) tabs[k] = { key: k, schema: n.schema, table: n.table, cols: [], pk: n.pk || [] }
    ;(n.cols || Object.keys(n.row || {})).forEach(c => { if (!tabs[k].cols.includes(c)) tabs[k].cols.push(c) })
  })
  const adj = {}
  g.edges.forEach(e => {
    if (!byId[e.from] || !byId[e.to]) return
    ;(adj[e.from] = adj[e.from] || []).push({ to: e.to, dir: 'up', label: e.label })        // up: the other end is the parent
    ;(adj[e.to] = adj[e.to] || []).push({ to: e.from, dir: 'down', label: e.label })       // down: the other end is a child
  })
  const rk = key(rootNode)
  const insts = [{ key: rk, tk: rk, from: null, link: null, dir: null }]
  const nodeInst = { [rootNode.id]: rk }, bySig = {}, seen = new Set([rootNode.id]), queue = [rootNode.id]
  while (queue.length) {
    const u = queue.shift(), ui = nodeInst[u]
    ;(adj[u] || []).forEach(a => {
      if (seen.has(a.to)) return
      seen.add(a.to)
      const sig = `${ui} > ${a.dir} ${a.label} > ${key(byId[a.to])}`
      if (!bySig[sig]) {
        const [cc, pc] = a.label.split(' → ').map(x => x.split(', '))
        bySig[sig] = sig; insts.push({ key: sig, tk: key(byId[a.to]), from: ui, link: { cc, pc }, dir: a.dir })
      }
      nodeInst[a.to] = sig; queue.push(a.to)
    })
  }
  const count = {}; insts.forEach(i => { count[i.tk] = (count[i.tk] || 0) + 1 })
  const labels = {}, tabsOut = {}
  insts.forEach(i => {
    const t = tabs[i.tk]
    let label = t.table
    if (i.from) { const ft = tabs[insts.find(x => x.key === i.from).tk].table; label = count[i.tk] > 1 || ft === t.table ? `${t.table} (${i.dir === 'up' ? 'parent' : 'child'} of ${labels[i.from] || ft})` : t.table }
    labels[i.key] = label
    tabsOut[i.key] = { ...t, key: i.key, label }
  })
  return { tabs: tabsOut, order: insts.map(i => i.key), insts, rk, rootNode, nodeInst }
}

function QueryBuilder({ model, execUrl, extra, exportUrl, onClose, picked, setPicked }) {
  const [sql, setSql] = useState('')
  const [res, setRes] = useState(null), [err, setErr] = useState(null), [busy, setBusy] = useState(false), [copied, setCopied] = useState('')
  useEffect(() => { setSql(''); setRes(null); setErr(null) }, [model])
  useEffect(() => { if (!Object.values(picked).some(a => a && a.length)) setPicked({ [model.rk]: [...(model.tabs[model.rk]?.pk || [])] }) }, [])     // nothing ticked yet: start with the primary key of the clicked row
  const has = (t, c) => (picked[t] || []).includes(c)
  const toggle = (t, c) => setPicked(p => ({ ...p, [t]: has(t, c) ? (p[t] || []).filter(x => x !== c) : [...(p[t] || []), c] }))
  const setAll = (t, cols) => setPicked(p => ({ ...p, [t]: [...cols] }))

  const generate = () => {
    const chosen = model.order.filter(t => picked[t] && picked[t].length)
    if (!chosen.length) { setErr('Pick at least one column'); return }
    setErr(null)
    // path from the clicked row's table to every table instance that has a picked column
    const byKey = Object.fromEntries(model.insts.map(x => [x.key, x]))
    const need = new Set([model.rk])
    chosen.forEach(t => { let x = t; while (x && !need.has(x) && byKey[x]) { need.add(x); x = byKey[x].from } })
    const tables = model.order.filter(t => need.has(t))
    const al = {}; tables.forEach((t, i) => { al[t] = 't' + i })
    const nm = t => model.tabs[t].label || model.tabs[t].table
    const sel = []
    chosen.forEach(t => model.tabs[t].cols.filter(c => picked[t].includes(c)).forEach(c => sel.push(`${al[t]}.${c} AS "${nm(t)}.${c}"`)))
    const joins = tables.filter(t => t !== model.rk).map(t => {
      const { from, link: l, dir } = byKey[t]
      const on = dir === 'down' ? l.cc.map((c, i) => `${al[t]}.${c} = ${al[from]}.${l.pc[i]}`) : l.pc.map((c, i) => `${al[t]}.${c} = ${al[from]}.${l.cc[i]}`)     // down: this one is the child
      return `  LEFT JOIN ${model.tabs[t].schema}.${model.tabs[t].table} ${al[t]} ON ${on.join(' AND ')}`
    })
    const rn = model.rootNode, row = rn?.row || {}
    let wc = (rn?.pk || []).filter(c => row[c] !== null && row[c] !== undefined)
    if (!wc.length || wc.length < (rn?.pk || []).length) wc = Object.keys(row).filter(c => row[c] !== null && row[c] !== '' && (typeof row[c] === 'number' || (typeof row[c] === 'string' && row[c].length <= 200 && !/^\d{4}-\d\d-\d\d/.test(row[c]))))
    const where = wc.map(c => `${al[model.rk]}.${c} = ${sqlLit(row[c])}`)
    setSql(`SELECT ${sel.join(',\n       ')}\nFROM ${model.tabs[model.rk].schema}.${model.tabs[model.rk].table} ${al[model.rk]}\n${joins.join('\n')}${joins.length ? '\n' : ''}${where.length ? 'WHERE ' + where.join('\n  AND ') : ''}`)
    setRes(null)
  }
  const run = () => {
    if (!sql.trim()) return
    setBusy(true); setErr(null); setRes(null)
    fetch(execUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: sql.trim().replace(/;+\s*$/, ''), ...extra }) })
      .then(r => r.json()).then(d => { if (d.ok) setRes(d); else setErr(d.error) }).catch(() => setErr('Request failed')).finally(() => setBusy(false))
  }
  const copy = () => { setCopied('Copying query…'); navigator.clipboard.writeText(sql).then(() => { setCopied('Copied query ✓'); setTimeout(() => setCopied(''), 1600) }).catch(() => setCopied('Copy failed')) }
  const box = { border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)' }
  return (
    <div style={{ flex: 1, minHeight: 0, marginTop: 8, display: 'flex', gap: 10, fontSize: 12 }}>
      <div style={{ ...box, width: 330, overflow: 'auto', padding: 6, flexShrink: 0 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Columns</div>
        {model.order.map(t => (
          <details key={t} open={t === model.rk} style={{ marginBottom: 4 }}>
            <summary style={{ cursor: 'pointer', fontFamily: 'monospace' }}>{t === model.rk ? '★ ' : ''}{model.tabs[t].label || model.tabs[t].table} <span style={{ color: 'var(--text-muted)' }}>({(picked[t] || []).length}/{model.tabs[t].cols.length})</span></summary>
            <div style={{ padding: '2px 0 4px 14px', fontSize: 11 }}>
              <button className="btn btn-sm" style={{ padding: '0 5px', fontSize: 10 }} onClick={() => setAll(t, model.tabs[t].cols)}>all</button>{' '}
              <button className="btn btn-sm" style={{ padding: '0 5px', fontSize: 10 }} onClick={() => setAll(t, [])}>none</button>{' '}
              <button className="btn btn-sm" style={{ padding: '0 5px', fontSize: 10 }} onClick={() => setAll(t, model.tabs[t].pk)}>PK</button>
              {model.tabs[t].cols.map(c => (
                <label key={c} style={{ display: 'flex', gap: 4, alignItems: 'center', fontFamily: 'monospace', cursor: 'pointer' }}>
                  <input type="checkbox" checked={has(t, c)} onChange={() => toggle(t, c)} />{model.tabs[t].pk.includes(c) ? '🔑 ' : ''}{c}
                </label>))}
            </div>
          </details>))}
      </div>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', rowGap: 4, flexShrink: 0 }}>
          <button className="btn btn-sm btn-primary" onClick={generate}>Generate query</button>
          <button className="btn btn-sm" style={{ minWidth: 70 }} onClick={run} disabled={!sql.trim() || busy}>{busy ? 'Running…' : '▶ Run'}</button>
          <button className="btn btn-sm" style={{ minWidth: 116 }} onClick={copy} disabled={!sql.trim()}>{copied || 'Copy query'}</button>
          <button className="btn btn-sm" onClick={() => download(sql + String.fromCharCode(10), 'relation_query.sql', 'text/plain')} disabled={!sql.trim()}>Export query</button>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
            {['csv', 'xlsx'].map(f => <button key={f} className="btn btn-sm" disabled={!res || !res.columns?.length} title={res ? '' : 'Run the query first'} onClick={() => saveRows(res.columns, res.rows, f, 'relation_result', exportUrl)}>Export result {f.toUpperCase()}</button>)}
            <button className="btn btn-sm" onClick={onClose} title="Minimize the query builder (the query and its result are kept)">— Minimize</button>
          </span>
        </div>
        <div style={{ minHeight: 16, fontSize: 11, flexShrink: 0 }}>
          {res && <span style={{ color: 'var(--text-muted)' }}>{res.row_count} row(s)</span>}
          {err && <span style={{ color: '#c62828' }}>{err}</span>}
        </div>
        <textarea value={sql} onChange={e => setSql(e.target.value)} placeholder="Pick columns on the left and press Generate query. The query joins the picked tables along their foreign keys, for the clicked row; you can edit it before running." spellCheck={false}
          style={{ ...box, fontFamily: 'monospace', fontSize: 11, padding: 6, height: 96, flexShrink: 0, resize: 'vertical', color: 'var(--text)' }} />
        {res && res.columns?.length > 0 && (
          <div style={{ ...box, flex: 1, overflow: 'auto', minHeight: 60 }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 11, fontFamily: 'monospace' }}>
              <thead><tr>{res.columns.map(c => <th key={c} style={{ position: 'sticky', top: 0, background: 'var(--surface)', textAlign: 'left', padding: '3px 8px', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap' }}>{c}</th>)}</tr></thead>
              <tbody>{res.rows.slice(0, 200).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} style={{ padding: '2px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v === null ? <em style={{ opacity: .5 }}>NULL</em> : String(v)}</td>)}</tr>)}</tbody>
            </table>
            {res.rows.length > 200 && <div style={{ padding: 4, color: 'var(--text-muted)' }}>first 200 of {res.rows.length} rows shown - the export has all of them</div>}
          </div>)}
      </div>
    </div>
  )
}

export function RelationsModal({ gv, result, table, schemaFallback, relationsUrl, exportUrl, extra = {} }) {
  const [depth, setDepth] = useState(2)
  const [refby, setRefby] = useState(false), [inf, setInf] = useState(false), [infMax, setInfMax] = useState('40')
  const [qb, setQb] = useState(false), [qbMounted, setQbMounted] = useState(false)       // once opened it stays mounted, so minimizing keeps the query and its result
  const modelRef = useRef(null)
  const [picked, setPicked] = useState({})                     // columns ticked in the diagram / query builder: table -> [columns]
  const onToggle = (t, c, on) => setPicked(p => ({ ...p, [t]: on ? [...new Set([...(p[t] || []), c])] : (p[t] || []).filter(x => x !== c) }))
  const ri = gv.rel?.ri
  const [schema, tbl] = useMemo(() => { const p = String(table || '').replace(/"/g, '').split('.'); return p.length > 1 ? [p[0], p[1]] : [schemaFallback || '', p[0]] }, [table, schemaFallback])
  const [hist, setHist] = useState([]), [hp, setHp] = useState(0)
  useEffect(() => {
    if (ri === undefined) { setHist([]); setHp(0); return }
    const values = {}; result.columns.forEach((c, i) => { values[c] = result.rows[ri][i] })
    setHist([{ schema, table: tbl, values }]); setHp(0)
  }, [ri])
  const cur = hist[hp]
  const { g, err, loading } = useGraph(() => cur ? fetch(relationsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schema: cur.schema, table: cur.table, values: cur.values, depth, refby, inferred: inf, inferred_max: infMax, ...extra }) }).then(r => r.json()) : new Promise(() => {}), [hist, hp, depth, refby, inf, infMax])
  const model = useMemo(() => (g ? buildModel(g) : null), [g])
  if (model) modelRef.current = model
  if (ri === undefined || !cur) return null
  const pick = n => { if (n.id === g?.root) return; setHist(h => [...h.slice(0, hp + 1), { schema: n.schema, table: n.table, values: n.row }]); setHp(hp + 1) }
  return (
    <Shell title={`Relations of ${cur.schema}.${cur.table}`} onClose={() => gv.setRel(null)}
      left={<><button style={{ ...navBtn, opacity: hp > 0 ? 1 : 0.4 }} disabled={hp <= 0} onClick={() => setHp(hp - 1)}>← Back</button>
        <button style={{ ...navBtn, opacity: hp < hist.length - 1 ? 1 : 0.4 }} disabled={hp >= hist.length - 1} onClick={() => setHp(hp + 1)}>Forward →</button></>}
      right={<><button className="btn btn-sm" onClick={() => { setQb(v => !v); setQbMounted(true) }} disabled={!g && !qbMounted}>🧮 Query builder{qbMounted && !qb ? ' ▴' : ''}</button><label style={{ fontSize: 11, display: 'inline-flex', gap: 4, alignItems: 'center', cursor: 'pointer' }} title="Also show the tables that have a foreign key to a shown row's table, even when no row of them points at it"><input type="checkbox" checked={refby} onChange={e => setRefby(e.target.checked)} />Show referenced-by tables</label><label style={{ fontSize: 11, display: 'inline-flex', gap: 4, alignItems: 'center', cursor: 'pointer' }} title="Also link tables that share a key column name (e.g. USER_ACCOUNT and USER_ACCOUNT_PASSWORD share USER_ACCT_ID) even without a foreign key"><input type="checkbox" checked={inf} onChange={e => setInf(e.target.checked)} />Show relations between tables with the same column name</label>{inf && <select value={infMax} onChange={e => setInfMax(e.target.value)} title="Ignore columns found in more than this many tables (all = nothing is ignored)" style={{ fontSize: 11 }}>{['40', '50', '75', '100', 'all'].map(v => <option key={v} value={v}>{v === 'all' ? 'ignore none' : 'ignore > ' + v + ' tables'}</option>)}</select>}<DepthSel depth={depth} setDepth={setDepth} /><ExportBtns g={g} mode="row" title={`Relations of ${cur.schema}.${cur.table} (row)`} base="relations" exportUrl={exportUrl} /></>}>
      <Body loading={loading} err={err} g={g} shrink={qb} note={g && `${g.nodes.length} row(s) in ${new Set(g.nodes.map(n => n.table)).size} table(s)${g.truncated ? ' - the list was limited, lower the depth to see everything' : ''}${g.nodes.length === 1 ? ' · this row has no related rows through foreign keys' : ''}`}>
        <RelView g={g} mode="row" onPick={pick} picked={picked} onToggle={onToggle} keyOf={n => model?.nodeInst[n.id] || `${n.schema}.${n.table}`} />
      </Body>
      {qbMounted && modelRef.current && <div style={{ display: qb ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}><QueryBuilder model={modelRef.current} execUrl={relationsUrl.replace('/db/relations', '/db/execute')} extra={extra} exportUrl={exportUrl} onClose={() => setQb(false)} picked={picked} setPicked={setPicked} /></div>}
    </Shell>
  )
}

// the tables related to one table
export function TableRelationsModal({ url, schema, table, onClose, exportUrl, extra = '' }) {
  const [hist, setHist] = useState([{ schema, table }]), [hp, setHp] = useState(0), [depth, setDepth] = useState(1), [inf, setInf] = useState(false), [infMax, setInfMax] = useState('40')
  const cur = hist[hp]
  const { g, err, loading } = useGraph(() => fetch(`${url}?schema=${encodeURIComponent(cur.schema)}&table=${encodeURIComponent(cur.table)}&depth=${depth}${inf ? '&inferred=1&inferred_max=' + infMax : ''}${extra}`).then(r => r.json()), [hist, hp, depth, inf, infMax])
  const pick = n => { if (n.id === g?.root) return; setHist(h => [...h.slice(0, hp + 1), { schema: n.schema, table: n.table }]); setHp(hp + 1) }
  return (
    <Shell title={`Relations of ${cur.schema}.${cur.table}`} onClose={onClose}
      left={<><button style={{ ...navBtn, opacity: hp > 0 ? 1 : 0.4 }} disabled={hp <= 0} onClick={() => setHp(hp - 1)}>← Back</button>
        <button style={{ ...navBtn, opacity: hp < hist.length - 1 ? 1 : 0.4 }} disabled={hp >= hist.length - 1} onClick={() => setHp(hp + 1)}>Forward →</button></>}
      right={<><label style={{ fontSize: 11, display: 'inline-flex', gap: 4, alignItems: 'center', cursor: 'pointer' }} title="Also link tables that share a key column name (e.g. USER_ACCOUNT and USER_ACCOUNT_PASSWORD share USER_ACCT_ID) even without a foreign key"><input type="checkbox" checked={inf} onChange={e => setInf(e.target.checked)} />Show relations between tables with the same column name</label>{inf && <select value={infMax} onChange={e => setInfMax(e.target.value)} title="Ignore columns found in more than this many tables (all = nothing is ignored)" style={{ fontSize: 11 }}>{['40', '50', '75', '100', 'all'].map(v => <option key={v} value={v}>{v === 'all' ? 'ignore none' : 'ignore > ' + v + ' tables'}</option>)}</select>}<DepthSel depth={depth} setDepth={setDepth} /><ExportBtns g={g} mode="table" title={`Relations of ${cur.schema}.${cur.table}`} base="table_relations" exportUrl={exportUrl} /></>}>
      <Body loading={loading} err={err} g={g} note={g && `${g.nodes.length} table(s)${g.truncated ? ' - limited, lower the depth' : ''}${g.nodes.length === 1 ? ' · this table has no foreign key relations' : ''}`}>
        <RelView g={g} mode="table" onPick={pick} />
      </Body>
    </Shell>
  )
}

// the whole schema: tables are sized by how many relations they have; selecting one enlarges it and its neighbours to show their columns
export function SchemaRelationsModal({ schema, onClose, schemaUrl, colsUrl, exportUrl, extra = '' }) {
  const [iso, setIso] = useState(false)
  const [refby, setRefby] = useState(false)
  const [inf, setInf] = useState(false), [infMax, setInfMax] = useState('40')
  const [capSel, setCapSel] = useState('250')
  const [focus, setFocus] = useState('')
  const { g, err, loading } = useGraph(() => fetch(`${schemaUrl}?schema=${encodeURIComponent(schema)}${iso ? '&isolated=1' : ''}${refby ? '&refby=1' : ''}${inf ? '&inferred=1&inferred_max=' + infMax : ''}&cap=${capSel}${focus ? '&focus=' + encodeURIComponent(focus) : ''}${extra}`).then(r => r.json()), [schema, iso, refby, inf, infMax, capSel, focus])
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
    <Shell title={`Relations in schema ${schema}`} onClose={onClose} right={<><select value={capSel} onChange={e => setCapSel(e.target.value)} title="How many of the most connected tables to draw" style={{ fontSize: 11 }}>{['250', '500', 'all'].map(v => <option key={v} value={v}>{v === 'all' ? 'all tables' : 'up to ' + v + ' tables'}</option>)}</select><label style={{ fontSize: 11, display: 'inline-flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={iso} onChange={e => setIso(e.target.checked)} />Show tables without relations</label><label style={{ fontSize: 11, display: 'inline-flex', gap: 4, alignItems: 'center', cursor: 'pointer' }} title="Also show every table that has a foreign key to a shown table"><input type="checkbox" checked={refby} onChange={e => setRefby(e.target.checked)} />Show referenced-by tables</label><label style={{ fontSize: 11, display: 'inline-flex', gap: 4, alignItems: 'center', cursor: 'pointer' }} title="Also link tables that share a key column name (e.g. USER_ACCOUNT and USER_ACCOUNT_PASSWORD share USER_ACCT_ID) even without a foreign key"><input type="checkbox" checked={inf} onChange={e => setInf(e.target.checked)} />Show relations between tables with the same column name</label>{inf && <select value={infMax} onChange={e => setInfMax(e.target.value)} title="Ignore columns found in more than this many tables (all = nothing is ignored)" style={{ fontSize: 11 }}>{['40', '50', '75', '100', 'all'].map(v => <option key={v} value={v}>{v === 'all' ? 'ignore none' : 'ignore > ' + v + ' tables'}</option>)}</select>}<ExportBtns g={g} mode="schema" title={`Relations in schema ${schema}`} base={`${schema}_relations`} exportUrl={exportUrl} prep={prep} /></>}>
      <Body loading={loading} err={err} g={g} note={g && `${g.nodes.length} table(s)${iso ? '' : ' with foreign keys'}${g.total ? ' of ' + g.total : ''}, ${g.edges.length} relation(s)${g.truncated ? ` - showing the ${g.nodes.length - (g.focus ? 0 : 0)} most connected of ${g.connected} tables that have relations; type a table name in the find box and click Search to bring any other table in` : ''}`}>
        <RelView g={g} mode="schema" loadCols={loadCols} onSearchMiss={q => setFocus(q)} searchTables={q => fetch(`${schemaUrl.replace('schema-relations', 'search-tables')}?schema=${encodeURIComponent(schema)}&q=${encodeURIComponent(q)}${extra}`).then(r => r.json()).then(d => d.ok ? d.tables : [])} />
      </Body>
    </Shell>
  )
}
