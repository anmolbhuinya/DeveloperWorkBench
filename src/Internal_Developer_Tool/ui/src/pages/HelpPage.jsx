import { useState, useEffect, useCallback } from 'react'

const PANELS = [
  { kind: 'features', title: 'Wishlist', noun: 'feature', statuses: ['requested', 'implemented'], done: 'implemented' },
  { kind: 'bugs',     title: 'Bugs',     noun: 'bug',     statuses: ['filed', 'fixed'],           done: 'fixed' },
]

const fieldStyle = {
  width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 13,
  background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6,
  fontFamily: 'inherit',
}

function Panel({ kind, title, noun, statuses, done }) {
  const [items, setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr]       = useState('')
  const [draft, setDraft]   = useState({ title: '', description: '' })
  const [editId, setEditId] = useState(null)
  const [edit, setEdit]     = useState({ title: '', description: '' })
  const [busy, setBusy]     = useState(false)

  const load = useCallback(() => {
    fetch(`/api/help/${kind}`).then(r => r.json())
      .then(d => (d.ok ? setItems(d.items) : setErr(d.error || 'Failed to load')))
      .catch(() => setErr('Failed to load'))
      .finally(() => setLoading(false))
  }, [kind])
  useEffect(load, [load])

  const call = async (url, method, body) => {
    setBusy(true); setErr('')
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' },
                                   body: body ? JSON.stringify(body) : undefined })
      const d = await r.json()
      if (!d.ok) { setErr(d.error || 'Request failed'); return false }
      return true
    } catch { setErr('Request failed'); return false }
    finally { setBusy(false) }
  }

  const add = async () => {
    if (!draft.title.trim()) return
    if (await call(`/api/help/${kind}`, 'POST', draft)) { setDraft({ title: '', description: '' }); load() }
  }
  const save = async () => {
    if (!edit.title.trim()) return
    if (await call(`/api/help/${kind}/${editId}`, 'PUT', edit)) { setEditId(null); load() }
  }
  const toggle = async it => {
    const next = it.status === done ? statuses[0] : done
    if (await call(`/api/help/${kind}/${it.id}`, 'PUT', { status: next })) load()
  }
  const remove = async it => {
    if (!window.confirm(`Delete this ${noun}?\n\n${it.title}`)) return
    if (await call(`/api/help/${kind}/${it.id}`, 'DELETE')) load()
  }

  return (
    <div className="card" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 15 }}>{title} <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>({items.length})</span></div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input type="text" placeholder={`New ${noun} title`} value={draft.title}
          onChange={e => setDraft({ ...draft, title: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') add() }} style={fieldStyle} />
        <textarea rows={2} placeholder="Description (optional)" value={draft.description}
          onChange={e => setDraft({ ...draft, description: e.target.value })} style={fieldStyle} />
        <div><button className="btn btn-sm btn-primary" disabled={busy || !draft.title.trim()} onClick={add}>+ Add {noun}</button></div>
      </div>

      {err && <div className="alert alert-error">{err}</div>}
      {loading && <span className="spinner" />}
      {!loading && items.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Nothing here yet.</div>}

      {items.map(it => (
        <div key={it.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
          {editId === it.id ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input type="text" value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} style={fieldStyle} />
              <textarea rows={3} value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} style={fieldStyle} />
              <div className="flex-gap">
                <button className="btn btn-sm btn-primary" disabled={busy || !edit.title.trim()} onClick={save}>Save</button>
                <button className="btn btn-sm" onClick={() => setEditId(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13, flex: 1, wordBreak: 'break-word' }}>{it.title}</span>
                <button className={`badge ${it.status === done ? 'badge-success' : 'badge-warning'}`}
                  style={{ cursor: 'pointer', border: 'none' }} disabled={busy}
                  title={`Click to mark ${it.status === done ? statuses[0] : done}`}
                  onClick={() => toggle(it)}>{it.status}</button>
              </div>
              {it.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{it.description}</div>}
              <div style={{ display: 'flex', alignItems: 'center', marginTop: 6, gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>Added {it.created}{it.updated !== it.created ? ` · updated ${it.updated}` : ''}</span>
                <button className="btn btn-sm" onClick={() => { setEditId(it.id); setEdit({ title: it.title, description: it.description }) }}>✎ Edit</button>
                <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => remove(it)}>Delete</button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

export default function HelpPage() {
  return (
    <div>
      <div className="page-header"><h1 className="page-title">ERD</h1></div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {PANELS.map(p => <Panel key={p.kind} {...p} />)}
      </div>
    </div>
  )
}
