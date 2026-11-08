import { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import ConfirmDialog from './ConfirmDialog'

// Query tabs backed by SQL_Queries\<Local|Remote>\<App>\<Version>\<App>_<Version>_Queries.xlsx
// (tab = sheet, query = row). A query is only added / changed after it has executed successfully.
// Parent supplies runSql(sql, tabName) -> Promise<boolean> (true = executed OK) and renders the results.
const SqlQueryPanel = forwardRef(function SqlQueryPanel({ scope, appName, version, connected, busy, runSql, onActive }, ref) {
  const [tabs,     setTabs]     = useState([])          // open tabs: [{name, queries}]
  const [closed,   setClosed]   = useState([])          // closed sheet names (can be re-opened)
  const [path,     setPath]     = useState('')
  const [active,   setActive]   = useState('')
  const [entry,    setEntry]    = useState('')
  const [editIdx,  setEditIdx]  = useState(null)        // index of the query being modified
  const [renaming, setRenaming] = useState(null)        // {name, text}
  const [confirm,  setConfirm]  = useState(null)        // {index}
  const [msg,      setMsg]      = useState(null)        // {ok, text}
  const [saving,   setSaving]   = useState(false)
  const taRef = useRef(null)
  const [dragQ, setDragQ] = useState(null), [overQ, setOverQ] = useState(null)             // drag a saved query to put it at another position
  const [dragTab, setDragTab] = useState(null), [overTab, setOverTab] = useState(null)      // drag a tab to put it at another position
  const base = `/api/sqlq/${scope}/${appName}`
  const vq = `version=${encodeURIComponent(version || '')}`

  useImperativeHandle(ref, () => ({
    insert(text) {
      const ta = taRef.current
      if (!ta) { setEntry(e => e + text); return }
      const s = ta.selectionStart, e = ta.selectionEnd
      setEntry(cur => cur.slice(0, s) + text + cur.slice(e))
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + text.length; ta.focus() })
    },
  }))

  function apply(d, pick) {
    if (!d.ok) { setMsg({ ok: false, text: d.error || 'Failed' }); return false }
    setTabs(d.tabs || []); setClosed(d.closed || []); setPath(d.path || '')
    pick = pick || d.created
    setActive(cur => {
      const names = (d.tabs || []).map(t => t.name)
      return pick && names.includes(pick) ? pick :(names.includes(cur) ? cur : (names[0] || ''))
    })
    return true
  }

  function post(url, body, pick) {
    return fetch(`${base}/${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, ...body }) })
      .then(r => r.json()).then(d => apply(d, pick)).catch(() => { setMsg({ ok: false, text: 'Could not reach server' }); return false })
  }

  useEffect(() => {
    if (version == null) return
    fetch(`${base}/tabs?${vq}`).then(r => r.json()).then(d => apply(d)).catch(() => {})
  }, [scope, appName, version])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (active) onActive && onActive(active) }, [active])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setEntry(''); setEditIdx(null); setMsg(null) }, [active])

  const tab = tabs.find(t => t.name === active)
  const queries = tab ? tab.queries : []

  function execute() {
    const sql = entry.trim().replace(/;+\s*$/, '')
    if (!sql || !connected || !active || busy || saving) return
    runSql(sql, active).then(ok => {
      if (!ok) return                                       // failed: nothing is saved
      setSaving(true)
      const op = editIdx == null ? 'add' : 'update'
      post(`queries/${op}`, { tab: active, sql, index: editIdx }, active).then(saved => {
        setSaving(false)
        if (saved) { setEntry(''); setEditIdx(null); setMsg({ ok: true, text: op === 'add' ? 'Executed and added' : 'Executed and updated' }) }
      })
    })
  }

  const btn = { fontSize: 11, padding: '1px 8px' }
  const iconBtn = (dis) => ({ background: 'none', border: 'none', cursor: dis ? 'default' : 'pointer', padding: '0 3px', fontSize: 12,
    color: dis ? 'var(--border)' : 'var(--text-muted)' })

  return (
    <div style={{ flexShrink: 0 }}>
      {/* Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', background: 'var(--surface)', overflowX: 'auto' }}>
        {tabs.map(t => (
          <div key={t.name} onClick={() => setActive(t.name)}
            draggable={renaming?.name !== t.name}
            onDragStart={e => { setDragTab(t.name); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', t.name) } catch (x) { /* ignore */ } }}
            onDragOver={e => { if (dragTab && dragTab !== t.name) { e.preventDefault(); setOverTab(t.name) } }}
            onDragLeave={() => setOverTab(o => (o === t.name ? null : o))}
            onDragEnd={() => { setDragTab(null); setOverTab(null) }}
            onDrop={e => {
              e.preventDefault()
              const from = dragTab; setDragTab(null); setOverTab(null)
              if (!from || from === t.name) return
              const names = tabs.map(x => x.name), fi = names.indexOf(from), ti = names.indexOf(t.name)
              const before = fi < ti ? (names[ti + 1] || '') : t.name            // dropped on a tab: it takes that tab's place
              setTabs(ts => { const m = ts.find(x => x.name === from); const rest = ts.filter(x => x.name !== from); const at = rest.findIndex(x => x.name === t.name); rest.splice(fi < ti ? at + 1 : at, 0, m); return rest })
              post('tabs/move', { name: from, before }, from)
            }}
            title="Drag to change the position of the tab"
            style={{
            opacity: dragTab === t.name ? 0.4 : 1, boxShadow: overTab === t.name ? 'inset 3px 0 0 var(--primary, #3b82f6)' : undefined,
            display: 'flex', alignItems: 'center', gap: 4, padding: '7px 14px', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap',
            borderRight: '1px solid var(--border)', background: active === t.name ? 'var(--bg, #fff)' : 'transparent',
            borderBottom: active === t.name ? '2px solid var(--primary, #3b82f6)' : '2px solid transparent',
            color: active === t.name ? 'var(--primary, #3b82f6)' : 'var(--text-muted)', fontWeight: active === t.name ? 600 : 400,
          }}>
            {renaming?.name === t.name ? (
              <input autoFocus value={renaming.text} onChange={e => setRenaming(r => ({ ...r, text: e.target.value }))}
                onClick={e => e.stopPropagation()}
                onBlur={() => { const r = renaming; setRenaming(null); if (r.text.trim() && r.text.trim() !== r.name) post('tabs/rename', { name: r.name, new: r.text }, r.text.trim().slice(0, 31)) }}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null) }}
                style={{ width: 120, fontSize: 12, padding: '1px 4px' }} />
            ) : (
              <span onDoubleClick={e => { e.stopPropagation(); setRenaming({ name: t.name, text: t.name }) }} title="Double-click to rename">{t.name}</span>
            )}
            {tabs.length > 1 && (
              <span onClick={e => { e.stopPropagation(); post('tabs/close', { name: t.name }) }} title="Close (can be re-opened)"
                style={{ marginLeft: 2, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1, padding: '0 2px' }}>×</span>
            )}
          </div>
        ))}
        <button onClick={() => post('tabs', {})} title="New tab" style={{ border: 'none', background: 'transparent', cursor: 'pointer',
          padding: '7px 12px', fontSize: 16, color: 'var(--text-muted)', lineHeight: 1 }}>+</button>
        {closed.length > 0 && (
          <select value="" onChange={e => { if (e.target.value) post('tabs', { name: e.target.value }, e.target.value) }}
            title="Re-open a closed tab" style={{ fontSize: 11, padding: '2px 4px', marginLeft: 4, background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4 }}>
            <option value="">Re-open… ({closed.length})</option>
            {closed.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
        <div style={{ flex: 1 }} />
      </div>

      {/* Query entry */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        {editIdx != null && (
          <div style={{ fontSize: 11, color: '#e65100', marginBottom: 4 }}>
            Modifying query #{editIdx + 1} — it is saved only after it executes successfully.{' '}
            <a style={{ cursor: 'pointer' }} onClick={() => { setEditIdx(null); setEntry('') }}>Cancel</a>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <textarea ref={taRef} value={entry} rows={3} onChange={e => setEntry(e.target.value)}
            onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); execute() } }}
            placeholder="Enter a SQL query… (Ctrl+Enter to execute)"
            style={{ flex: 1, background: '#141414', color: '#d4d4d4', fontFamily: 'monospace', fontSize: 13, lineHeight: 1.5,
              padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 4, outline: 'none', resize: 'vertical', minHeight: 56 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button className="btn btn-primary btn-sm" onClick={execute} disabled={busy || saving || !connected || !entry.trim()} style={{ fontSize: 12, padding: '3px 12px' }}>
              {busy || saving ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Running…</> : '▶ Execute'}
            </button>
            <button className="btn btn-sm" onClick={() => { setEntry(''); setEditIdx(null) }} disabled={busy} style={{ fontSize: 12, padding: '3px 12px' }}>Clear</button>
          </div>
        </div>
        {msg && <div style={{ fontSize: 11, marginTop: 4, color: msg.ok ? '#2e7d32' : '#c62828' }}>{msg.text}</div>}
      </div>

      {/* Saved queries of this tab */}
      <div style={{ maxHeight: 180, overflowY: 'auto', borderBottom: '1px solid var(--border)' }}>
        {queries.length === 0 ? (
          <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>No queries in this tab yet — a query is added here once it executes successfully.</div>
        ) : queries.map((q, i) => (
          <div key={i} draggable
            onDragStart={e => { setDragQ(i); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(i)) } catch (x) { /* ignore */ } }}
            onDragOver={e => { if (dragQ !== null && dragQ !== i) { e.preventDefault(); setOverQ(i) } }}
            onDragLeave={() => setOverQ(o => (o === i ? null : o))}
            onDragEnd={() => { setDragQ(null); setOverQ(null) }}
            onDrop={e => {
              e.preventDefault()
              const from = dragQ; setDragQ(null); setOverQ(null)
              if (from === null || from === i) return
              const remap = k => (k === from ? i : from < i && k > from && k <= i ? k - 1 : from > i && k >= i && k < from ? k + 1 : k)
              setTabs(ts => ts.map(t => { if (t.name !== active) return t; const qs = [...t.queries]; qs.splice(i, 0, qs.splice(from, 1)[0]); return { ...t, queries: qs } }))
              if (editIdx != null) setEditIdx(remap(editIdx))
              post('queries/move', { tab: active, index: from, to: i }, active)
            }}
            title="Drag to change the position of the query"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderBottom: '1px solid var(--border)', opacity: dragQ === i ? 0.4 : 1,
              boxShadow: overQ === i ? (dragQ < i ? 'inset 0 -3px 0 var(--primary, #3b82f6)' : 'inset 0 3px 0 var(--primary, #3b82f6)') : undefined,
              background: editIdx === i ? 'rgba(255,193,7,0.12)' : 'transparent' }}>
            <span style={{ cursor: 'grab', color: 'var(--text-muted)', fontSize: 12, userSelect: 'none' }}>⋮⋮</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 18, textAlign: 'right' }}>{i + 1}</span>
            <code title={q} style={{ flex: 1, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.replace(/\s+/g, ' ')}</code>
            <button className="btn btn-sm" style={btn} disabled={busy || !connected} onClick={() => runSql(q, active)}>▶ Execute</button>
            <button className="btn btn-sm" style={btn} disabled={busy} onClick={() => { setEditIdx(i); setEntry(q); setMsg(null); taRef.current && taRef.current.focus() }}>✎ Modify</button>
            <button className="btn btn-sm" style={{ ...btn, color: '#c62828', borderColor: 'rgba(198,40,40,0.35)' }} disabled={busy} onClick={() => setConfirm({ index: i })}>🗑 Delete</button>
            <button style={iconBtn(i === 0)} disabled={i === 0} title="Move up" onClick={() => post('queries/move', { tab: active, index: i, to: i - 1 }, active)}>▲</button>
            <button style={iconBtn(i === queries.length - 1)} disabled={i === queries.length - 1} title="Move down" onClick={() => post('queries/move', { tab: active, index: i, to: i + 1 }, active)}>▼</button>
          </div>
        ))}
      </div>
      {path && <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '2px 12px' }} title={path}>Saved in {path}</div>}

      {confirm && (
        <ConfirmDialog title="Delete query" confirmLabel="Delete"
          message={`Delete query #${confirm.index + 1} from "${active}"?\n${(queries[confirm.index] || '').slice(0, 200)}`}
          onCancel={() => setConfirm(null)}
          onConfirm={() => { const i = confirm.index; setConfirm(null); if (editIdx === i) { setEditIdx(null); setEntry('') }; post('queries/delete', { tab: active, index: i }, active) }} />
      )}
    </div>
  )
})

export default SqlQueryPanel
