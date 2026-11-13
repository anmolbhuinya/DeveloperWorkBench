import { useState, useEffect, useCallback, useRef } from 'react'

const PANELS = [
  { kind: 'features', title: 'Wishlist', noun: 'feature', statuses: ['requested', 'implemented'], done: 'implemented', action: 'Implement' },
  { kind: 'bugs',     title: 'Bugs',     noun: 'bug',     statuses: ['filed', 'fixed'],           done: 'fixed',       action: 'Fix It' },
]

const fieldStyle = {
  width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 13,
  background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6,
  fontFamily: 'inherit',
}

function Panel({ kind, title, noun, statuses, done, action }) {
  const [items, setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr]       = useState('')
  const [draft, setDraft]   = useState({ title: '', description: '' })
  const [editId, setEditId] = useState(null)
  const [edit, setEdit]     = useState({ title: '', description: '' })
  const [busy, setBusy]     = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)   // item awaiting delete confirmation
  const [jobs, setJobs]     = useState({})        // item id -> latest AI job
  const [openLog, setOpenLog] = useState({})      // item id -> log expanded
  const timer = useRef(null)
  const [offline, setOffline] = useState(false)

  const loadJobs = useCallback(() => {
    fetch(`/api/help/${kind}/ai-jobs`).then(r => r.json())
      .then(d => { if (d.ok) { setJobs(d.jobs || {}); setOffline(false) } }).catch(() => setOffline(true))
  }, [kind])
  useEffect(() => { loadJobs() }, [loadJobs])
  // poll while any run is in progress
  useEffect(() => {
    clearInterval(timer.current)
    if (offline || Object.values(jobs).some(j => j.status === 'running')) {
      timer.current = setInterval(() => { loadJobs(); load() }, 3000)
    }
    return () => clearInterval(timer.current)
  }, [jobs, offline])

  const runAi = async it => {
    setErr('')
    try {
      const r = await fetch(`/api/help/${kind}/${it.id}/ai-run`, { method: 'POST' })
      const d = await r.json()
      if (!d.ok) { setErr(d.error || 'Could not start the AI agent'); return }
      setOpenLog(o => ({ ...o, [it.id]: true }))
      loadJobs()
    } catch { setErr('Could not start the AI agent') }
  }
  const abortAi = async job => {
    await fetch(`/api/project-management/sonar-report/ai-abort/${job.job_id}`, { method: 'POST' }).catch(() => {})
    loadJobs()
  }

  const load = useCallback(() => {
    fetch(`/api/help/${kind}`).then(r => r.json())
      .then(d => (d.ok ? setItems(d.items) : setErr(d.error || 'Failed to load')))
      .catch(() => setErr('Failed to load'))
      .finally(() => setLoading(false))
  }, [kind])
  useEffect(() => { fetch(`/api/help/${kind}/ai-jobs`).then(r => r.json()).then(d => { if (d.ok) setJobs(d.jobs || {}) }).catch(() => {}).finally(load) }, [load])

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
  // Reopen: back to the first status with the reason added to the description (the AI agent reads it), Git-pushed mark cleared
  const [reopenIt, setReopenIt] = useState(null)
  const [reopenWhy, setReopenWhy] = useState('')
  const reopen = async () => {
    const it = reopenIt, why = reopenWhy.trim()
    if (!it || !why) return
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const description = `${it.description ? it.description + '\n\n' : ''}--- Reopened ${stamp}: ${why}`
    setReopenIt(null); setReopenWhy('')
    if (await call(`/api/help/${kind}/${it.id}`, 'PUT', { status: statuses[0], description, pushed: '' })) load()
  }
  const move = async (it, dir) => {
    if (await call(`/api/help/${kind}/${it.id}/move`, 'POST', { dir })) load()
  }
  const gitPush = async it => {
    setBusy(true); setErr('')
    try {
      const r = await fetch(`/api/help/${kind}/${it.id}/git-push`, { method: 'POST' })
      const d = await r.json()
      if (!d.ok) setErr(`${d.error || 'Git push failed'}${d.log ? '\n' + d.log : ''}`)
      load()
    } catch { setErr('Git push failed') }
    finally { setBusy(false) }
  }
  const remove = async it => {
    setConfirmDel(null)
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

      {reopenIt && (
        <div onClick={() => setReopenIt(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 480, maxWidth: '92vw', background: 'var(--bg)', color: 'var(--text)', borderRadius: 14, borderTop: '4px solid #f9a825', boxShadow: '0 20px 50px rgba(0,0,0,0.35)', overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px 6px', display: 'flex', gap: 14 }}>
              <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'rgba(249,168,37,0.18)', color: '#f9a825', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>↻</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>Reopen this {noun}?</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6, wordBreak: 'break-word' }}>{reopenIt.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 6px' }}>What is still wrong or missing? It is added to the description, so {action === 'Fix It' ? 'Fix It' : 'Implement'} sees it on the next run.</div>
                <textarea autoFocus rows={4} value={reopenWhy} onChange={e => setReopenWhy(e.target.value)} placeholder="e.g. the button is still in the wrong place; the colour is not visible…" style={fieldStyle} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 24px 18px' }}>
              <button className="btn" onClick={() => setReopenIt(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={!reopenWhy.trim() || busy} onClick={reopen}>↻ Reopen</button>
            </div>
          </div>
        </div>
      )}
      {confirmDel && (
        <div onClick={() => setConfirmDel(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 420, maxWidth: '90vw', background: 'var(--bg)', color: 'var(--text)', borderRadius: 14, boxShadow: '0 20px 50px rgba(0,0,0,0.35)', overflow: 'hidden' }}>
            <div style={{ padding: '22px 24px 8px', display: 'flex', gap: 14 }}>
              <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'rgba(198,40,40,0.12)', color: '#c62828', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>🗑</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>Delete this {noun}?</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>This cannot be undone.</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 10, padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, wordBreak: 'break-word' }}>{confirmDel.title}</div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '16px 24px 20px' }}>
              <button className="btn" onClick={() => setConfirmDel(null)}>Cancel</button>
              <button className="btn btn-danger" autoFocus disabled={busy} onClick={() => remove(confirmDel)}>Delete</button>
            </div>
          </div>
        </div>
      )}
      {err && <div className="alert alert-error" style={{ whiteSpace: 'pre-wrap' }}>{err}</div>}
      {loading && <span className="spinner" />}
      {!loading && items.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Nothing here yet.</div>}

      {items.map((it, ix) => (
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
                <button className="btn btn-sm" disabled={busy || ix === 0} title="Move up" onClick={() => move(it, 'up')}>▲</button>
                <button className="btn btn-sm" disabled={busy || ix === items.length - 1} title="Move down" onClick={() => move(it, 'down')}>▼</button>
              </div>
              {it.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{it.description}</div>}
              <div style={{ display: 'flex', alignItems: 'center', marginTop: 6, gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>Added {it.created}{it.updated !== it.created ? ` · updated ${it.updated}` : ''}</span>
                {(() => {
                  const job = jobs[it.id]
                  const running = job?.status === 'running'
                  return (
                    <>
                      {job && <button className="btn btn-sm" onClick={() => setOpenLog(o => ({ ...o, [it.id]: !o[it.id] }))}
                        title="Show / hide the AI agent log">{openLog[it.id] ? '▾' : '▸'} AI log</button>}
                      {running
                        ? <button className="btn btn-sm btn-danger" onClick={() => abortAi(job)}>Abort</button>
                        : it.status !== done && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => runAi(it)}
                            title={`Run the AI agent to ${action === 'Fix It' ? 'fix this bug' : 'implement this feature'}`}>{action}</button>}
                    </>
                  )
                })()}
                {it.status === done
                  ? (it.pushed
                      ? <span className="badge badge-success" title={`Pushed ${it.pushed}`}>✓ Git Pushed</span>
                      : <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => gitPush(it)}
                          title={`git add . / commit "${kind === 'features' ? 'Wishlist' : 'Bug'}:${it.title}" / push (in DWB_Workspace)`}>GitPush</button>)
                  : <button className="btn btn-sm" onClick={() => { setEditId(it.id); setEdit({ title: it.title, description: it.description }) }}>✎ Edit</button>}
                {it.status === done && <button className="btn btn-sm" disabled={busy || jobs[it.id]?.status === 'running'} style={{ borderColor: '#f9a825', color: '#f9a825' }}
                  title={`Not satisfied? Reopen this ${noun} and say what is still wrong`} onClick={() => { setReopenIt(it); setReopenWhy('') }}>↻ Reopen</button>}
                <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => setConfirmDel(it)}>Delete</button>
              </div>
              {jobs[it.id] && (
                <div style={{ marginTop: 6, fontSize: 11, color: jobs[it.id].status === 'error' ? 'var(--danger, #c62828)' : 'var(--text-muted)' }}>
                  {jobs[it.id].status === 'running' && offline && 'Workbench is restarting — reconnecting…'}
                  {jobs[it.id].status === 'running' && !offline && <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> {jobs[it.id].label} — running…</>}
                  {jobs[it.id].status === 'done' && '✓ AI run finished'}
                  {jobs[it.id].status === 'error' && '✗ AI run failed — see log'}
                  {jobs[it.id].status === 'aborted' && 'AI run aborted'}
                </div>
              )}
              {jobs[it.id] && openLog[it.id] && (
                <pre style={{ marginTop: 6, maxHeight: 260, overflow: 'auto', background: '#1e1e1e', color: '#ddd', fontSize: 11, padding: 8, borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{jobs[it.id].output || '…'}</pre>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  )
}

export default function HelpPage() {
  const [session, setSession] = useState('')
  const [sessMsg, setSessMsg] = useState('')
  const [tab, setTab] = useState('features')
  useEffect(() => {
    fetch('/api/help/config').then(r => r.json()).then(d => { if (d.ok) setSession(d.session_name) }).catch(() => {})
  }, [])
  const saveSession = async (nameOverride) => {
    const name = typeof nameOverride === 'string' ? nameOverride : session
    try {
      const r = await fetch('/api/help/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_name: name }) })
      const d = await r.json()
      if (d.ok) { setSession(d.session_name); setSessMsg('Saved') } else setSessMsg(d.error || 'Failed')
    } catch { setSessMsg('Failed') }
    setTimeout(() => setSessMsg(''), 2000)
  }
  // Create New Session: server bumps the version (…_V0 -> …_V1) and runs lai --name to create it
  const newSession = async () => {
    setSessMsg('Creating…')
    try {
      const r = await fetch('/api/help/new-session', { method: 'POST' })
      const d = await r.json()
      if (d.ok) { setSession(d.session_name); setSessMsg(`Created ${d.session_name}`) } else setSessMsg(d.error || 'Failed')
    } catch { setSessMsg('Failed') }
    setTimeout(() => setSessMsg(''), 3000)
  }
  return (
    <div>
      <div className="page-header"><h1 className="page-title">ERD</h1></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13 }}>
        <span style={{ color: 'var(--text-muted)' }}>AI agent session:</span>
        <input type="text" value={session} onChange={e => setSession(e.target.value)} onBlur={saveSession}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }} style={{ ...fieldStyle, width: 260 }} />
        <button className="btn btn-sm" disabled={!session.trim()} onMouseDown={e => e.preventDefault()} onClick={newSession}
          title="Run lai to create a new session with the version incremented (e.g. Developer_WorkBench_V0 → Developer_WorkBench_V1)">Create New Session</button>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{sessMsg || 'Implement / Fix It run in this session (saved in features_and_bugs.xlsx)'}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {PANELS.map(p => (
          <button key={p.kind} onClick={() => setTab(p.kind)} style={{ fontSize: 13, fontWeight: 600, padding: '6px 18px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid var(--primary,#1976d2)', background: tab === p.kind ? 'var(--primary,#1976d2)' : 'var(--bg)', color: tab === p.kind ? '#fff' : 'var(--primary,#1976d2)' }}>{p.title}</button>
        ))}
      </div>
      {/* Both panels stay mounted (running AI jobs keep updating); only the selected one is shown, using the full width */}
      {PANELS.map(p => (
        <div key={p.kind} style={{ display: tab === p.kind ? 'flex' : 'none' }}><Panel {...p} /></div>
      ))}
    </div>
  )
}
