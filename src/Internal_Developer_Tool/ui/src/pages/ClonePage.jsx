import { useState, useEffect, useRef } from 'react'
import ToolRunsPage from './ToolRunsPage'

const COLS = [
  { key: 'project_id',       label: 'ID',             bold: true },
  { key: 'ticket_id',        label: 'Clone Ticket',   primary: true },
  { key: 'origin_ticket',    label: 'Origin Ticket',  mono: true },
  { key: 'app_type',         label: 'App Type',       mono: true },
  { key: 'release_branch',   label: 'Release Branch', mono: true },
  { key: 'fix_version',      label: 'Fix Version',    mono: true },
  { key: 'code_freeze_date', label: 'Code Freeze',    mono: true },
  { key: 'release_date',     label: 'Release Date',   mono: true },
  { key: 'pr_number',        label: 'PR #',           mono: true },
  { key: 'pr_status',        label: 'PR Status',      badge: true },
  { key: 'clone_pr_url',     label: 'Clone PR',       link: true },
  { key: 'status',           label: 'Status',         badge: true },
  { key: 'created_at',       label: 'Created At',     mono: true, truncate: 16 },
]

// ── Helpers ────────────────────────────────────────────────────────────────

function prLabel(pr) {
  if (pr.merged) return 'Merged'
  if (pr.draft)  return 'Draft'
  return pr.state === 'open' ? 'Open' : 'Closed'
}

function prBadgeStyle(label) {
  if (label === 'Merged') return { background: '#7c3aed', color: '#fff' }
  if (label === 'Open')   return { background: '#22c55e', color: '#fff' }
  if (label === 'Draft')  return { background: '#f59e0b', color: '#fff' }
  return { background: 'rgba(0,0,0,0.1)', color: 'var(--text-muted)' }
}

const ORIGIN_TIMEOUT_MS = 60_000

// ── Clone Config Modal ─────────────────────────────────────────────────────

function CloneConfigModal({ onClose }) {
  const [apps,          setApps]          = useState([])
  const [activeApp,     setActiveApp]     = useState(null)
  const [config,        setConfig]        = useState([])
  const [loading,       setLoading]       = useState(false)
  const [saving,        setSaving]        = useState(false)
  // New app
  const [addingApp,     setAddingApp]     = useState(false)
  const [newAppName,    setNewAppName]    = useState('')
  const [appErr,        setAppErr]        = useState('')
  // Inline edit
  const [editKey,       setEditKey]       = useState(null)
  const [editValue,     setEditValue]     = useState('')
  const [editNotes,     setEditNotes]     = useState('')
  // Add row
  const [showAddRow,    setShowAddRow]    = useState(false)
  const [addKey,        setAddKey]        = useState('')
  const [addValue,      setAddValue]      = useState('')
  const [addNotes,      setAddNotes]      = useState('')
  // Confirmations
  const [confirmDelKey, setConfirmDelKey] = useState(null)
  const [confirmDelApp, setConfirmDelApp] = useState(false)

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  // Load apps
  useEffect(() => {
    fetch('/api/tools/clone/apps')
      .then(r => r.json())
      .then(d => {
        const names = (d.apps || []).map(a => a.name)
        setApps(names)
        if (names.length > 0) setActiveApp(names[0])
      })
  }, [])

  // Load config rows when app changes
  useEffect(() => {
    if (!activeApp) { setConfig([]); return }
    setLoading(true)
    setEditKey(null); setConfirmDelKey(null); setConfirmDelApp(false)
    setShowAddRow(false); setAddKey(''); setAddValue(''); setAddNotes('')
    fetch(`/api/tools/clone/apps/${encodeURIComponent(activeApp)}/config`)
      .then(r => r.json())
      .then(d => setConfig(d.config || []))
      .finally(() => setLoading(false))
  }, [activeApp])

  const reloadConfig = () =>
    fetch(`/api/tools/clone/apps/${encodeURIComponent(activeApp)}/config`)
      .then(r => r.json())
      .then(d => setConfig(d.config || []))

  const upsertRow = async (key, value, notes) => {
    setSaving(true)
    await fetch(`/api/tools/clone/apps/${encodeURIComponent(activeApp)}/config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value, notes }),
    })
    await reloadConfig()
    setSaving(false)
  }

  const deleteRow = async (key) => {
    setSaving(true)
    await fetch(
      `/api/tools/clone/apps/${encodeURIComponent(activeApp)}/config/${encodeURIComponent(key)}`,
      { method: 'DELETE' },
    )
    setConfig(prev => prev.filter(r => r.key !== key))
    setConfirmDelKey(null)
    setSaving(false)
  }

  const createApp = async () => {
    const name = newAppName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')
    if (!name) return
    setAppErr('')
    const r = await fetch('/api/tools/clone/apps', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_name: name }),
    })
    const d = await r.json()
    if (d.ok) {
      setApps(prev => [...prev, name])
      setActiveApp(name)
      setAddingApp(false)
      setNewAppName('')
    } else {
      setAppErr(d.error || 'Failed to create app')
    }
  }

  const deleteApp = async () => {
    setSaving(true)
    await fetch(`/api/tools/clone/apps/${encodeURIComponent(activeApp)}`, { method: 'DELETE' })
    const remaining = apps.filter(a => a !== activeApp)
    setApps(remaining)
    setActiveApp(remaining[0] || null)
    setConfirmDelApp(false)
    setSaving(false)
  }

  const RO = { background: 'var(--surface2)', cursor: 'default' }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 860, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="modal-header">
          <span className="modal-title">Clone Configuration</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Tab bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap',
          padding: '8px 20px 0',
          borderBottom: '1px solid var(--border)',
        }}>
          {apps.map(name => (
            <button
              key={name}
              onClick={() => { setActiveApp(name); setAddingApp(false) }}
              style={{
                padding: '5px 14px', fontSize: 13, borderRadius: '6px 6px 0 0',
                border: `1px solid ${activeApp === name ? 'var(--border)' : 'transparent'}`,
                borderBottom: activeApp === name ? '1px solid var(--surface)' : '1px solid transparent',
                background: activeApp === name ? 'var(--surface)' : 'transparent',
                color: activeApp === name ? 'var(--primary)' : 'var(--text)',
                fontWeight: activeApp === name ? 600 : 400,
                cursor: 'pointer', marginBottom: -1,
              }}
            >
              {name}
            </button>
          ))}

          {addingApp ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 8, marginBottom: 8 }}>
              <input
                autoFocus
                type="text"
                placeholder="app name"
                value={newAppName}
                onChange={e => setNewAppName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createApp()}
                style={{ width: 140, fontSize: 12 }}
              />
              <button className="btn btn-sm btn-primary" onClick={createApp}
                disabled={!newAppName.trim()}>Create</button>
              <button className="btn btn-sm" onClick={() => {
                setAddingApp(false); setNewAppName(''); setAppErr('')
              }}>✕</button>
              {appErr && <span style={{ fontSize: 11, color: 'var(--danger)' }}>{appErr}</span>}
            </div>
          ) : (
            <button
              onClick={() => setAddingApp(true)}
              style={{
                padding: '5px 10px', fontSize: 13, borderRadius: '6px 6px 0 0',
                border: '1px solid transparent', background: 'transparent',
                color: 'var(--text-muted)', cursor: 'pointer', marginBottom: -1,
              }}
              title="Add new app type"
            >
              ＋
            </button>
          )}
        </div>

        {/* Config body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {!activeApp ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0' }}>
              No apps configured. Click ＋ to create one.
            </div>
          ) : loading ? (
            <div className="center" style={{ padding: 40 }}><span className="spinner" /></div>
          ) : (
            <>
              {/* Config table */}
              <div className="table-wrap" style={{ marginBottom: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: '22%' }}>Key</th>
                      <th style={{ width: '32%' }}>Value</th>
                      <th>Notes</th>
                      <th style={{ width: 120 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {config.length === 0 && (
                      <tr>
                        <td colSpan={4} style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
                          No configuration entries — add one below.
                        </td>
                      </tr>
                    )}
                    {config.map(row => {
                      if (confirmDelKey === row.key) {
                        return (
                          <tr key={row.key}>
                            <td colSpan={3} style={{ color: 'var(--danger)', fontSize: 12 }}>
                              Delete key <strong style={{ fontFamily: 'monospace' }}>{row.key}</strong>?
                            </td>
                            <td>
                              <div className="flex-gap" style={{ gap: 4 }}>
                                <button className="btn btn-sm btn-danger" disabled={saving}
                                  onClick={() => deleteRow(row.key)}>
                                  {saving ? '…' : 'Delete'}
                                </button>
                                <button className="btn btn-sm"
                                  onClick={() => setConfirmDelKey(null)}>Cancel</button>
                              </div>
                            </td>
                          </tr>
                        )
                      }
                      if (editKey === row.key) {
                        return (
                          <tr key={row.key}>
                            <td>
                              <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>
                                {row.key}
                              </span>
                            </td>
                            <td>
                              <input type="text" value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                style={{ width: '100%', fontSize: 12 }} />
                            </td>
                            <td>
                              <input type="text" value={editNotes}
                                onChange={e => setEditNotes(e.target.value)}
                                style={{ width: '100%', fontSize: 12 }} />
                            </td>
                            <td>
                              <div className="flex-gap" style={{ gap: 4 }}>
                                <button className="btn btn-sm btn-primary" disabled={saving}
                                  onClick={async () => {
                                    await upsertRow(row.key, editValue, editNotes)
                                    setEditKey(null)
                                  }}>
                                  {saving ? '…' : 'Save'}
                                </button>
                                <button className="btn btn-sm"
                                  onClick={() => setEditKey(null)}>✕</button>
                              </div>
                            </td>
                          </tr>
                        )
                      }
                      return (
                        <tr key={row.key}>
                          <td>
                            <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>
                              {row.key}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                              {row.value || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.notes}</span>
                          </td>
                          <td>
                            <div className="flex-gap" style={{ gap: 4 }}>
                              <button className="btn btn-sm" onClick={() => {
                                setEditKey(row.key)
                                setEditValue(row.value)
                                setEditNotes(row.notes)
                                setConfirmDelKey(null)
                              }}>Edit</button>
                              <button className="btn btn-sm btn-danger"
                                onClick={() => { setConfirmDelKey(row.key); setEditKey(null) }}>
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Add config row */}
              {showAddRow ? (
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1.4fr 2fr auto',
                  gap: 8, alignItems: 'end', marginBottom: 12,
                  padding: '10px 12px', borderRadius: 6,
                  border: '1px solid var(--border)', background: 'var(--surface2)',
                }}>
                  <div>
                    <label className="field-label" style={{ fontSize: 11 }}>Key *</label>
                    <input type="text" value={addKey} autoFocus
                      onChange={e => setAddKey(e.target.value)}
                      placeholder="e.g. repo_url" style={{ fontSize: 12 }} />
                  </div>
                  <div>
                    <label className="field-label" style={{ fontSize: 11 }}>Value</label>
                    <input type="text" value={addValue}
                      onChange={e => setAddValue(e.target.value)}
                      placeholder="value" style={{ fontSize: 12 }} />
                  </div>
                  <div>
                    <label className="field-label" style={{ fontSize: 11 }}>Notes</label>
                    <input type="text" value={addNotes}
                      onChange={e => setAddNotes(e.target.value)}
                      placeholder="optional description" style={{ fontSize: 12 }} />
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-sm btn-primary"
                      disabled={!addKey.trim() || saving}
                      onClick={async () => {
                        await upsertRow(addKey.trim(), addValue.trim(), addNotes.trim())
                        setAddKey(''); setAddValue(''); setAddNotes(''); setShowAddRow(false)
                      }}>
                      {saving ? '…' : 'Add'}
                    </button>
                    <button className="btn btn-sm" onClick={() => {
                      setShowAddRow(false); setAddKey(''); setAddValue(''); setAddNotes('')
                    }}>✕</button>
                  </div>
                </div>
              ) : (
                <button className="btn btn-sm" onClick={() => setShowAddRow(true)}
                  style={{ marginBottom: 12 }}>
                  + Add Configuration
                </button>
              )}

              {/* Danger zone */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
                {confirmDelApp ? (
                  <div style={{
                    padding: '12px 14px', borderRadius: 6,
                    background: 'rgba(239,68,68,0.06)',
                    border: '1px solid rgba(239,68,68,0.3)',
                  }}>
                    <div style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>
                      ⚠ Deleting app <strong>"{activeApp}"</strong> will permanently remove its
                      configuration and <strong>all clone projects</strong> for this app.
                      This action cannot be undone.
                    </div>
                    <div className="flex-gap" style={{ gap: 8 }}>
                      <button className="btn btn-sm btn-danger" disabled={saving} onClick={deleteApp}>
                        {saving ? '…' : `Delete "${activeApp}" and all its projects`}
                      </button>
                      <button className="btn btn-sm" onClick={() => setConfirmDelApp(false)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="btn btn-sm btn-danger"
                    onClick={() => setConfirmDelApp(true)}>
                    Delete App "{activeApp}"
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Clone New Run Modal ────────────────────────────────────────────────────

function CloneNewRunModal({ onClose }) {
  const [ticket,       setTicket]       = useState('')
  const [lookup,       setLookup]       = useState(null)
  const [looking,      setLooking]      = useState(false)
  const [lookErr,      setLookErr]      = useState('')
  const [originTicket, setOriginTicket] = useState('')
  const [detectedApp,  setDetectedApp]  = useState(null)
  const [summary,      setSummary]      = useState('')
  // 'idle' | 'loading' | 'done' | 'timeout'
  const [originStatus, setOriginStatus] = useState('idle')
  const [releaseBranch,  setReleaseBranch]  = useState(null)
  const [branchLoading,  setBranchLoading]  = useState(false)
  const [selPr,  setSelPr]  = useState(null)
  // Editable PR URL — pre-filled when user picks from list, or typed manually
  const [prUrl,  setPrUrl]  = useState('')
  const [creating,  setCreating]  = useState(false)
  const [createErr, setCreateErr] = useState('')
  const [done,      setDone]      = useState(false)
  const debounceRef = useRef(null)
  const originTmRef = useRef(null)

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  useEffect(() => () => {
    clearTimeout(debounceRef.current)
    clearTimeout(originTmRef.current)
  }, [])

  const doLookup = async (t) => {
    const tid = t.trim().toUpperCase()
    if (!tid) {
      setLookup(null); setLookErr('')
      setOriginTicket(''); setOriginStatus('idle')
      setDetectedApp(null); setSummary('')
      setReleaseBranch(null); setBranchLoading(false)
      setSelPr(null); setPrUrl('')
      clearTimeout(originTmRef.current)
      return
    }
    setLooking(true); setLookErr(''); setLookup(null)
    setOriginTicket(''); setOriginStatus('loading')
    setReleaseBranch(null); setBranchLoading(false)
    setSelPr(null); setPrUrl('')

    clearTimeout(originTmRef.current)
    originTmRef.current = setTimeout(() => {
      setOriginStatus(prev => prev === 'loading' ? 'timeout' : prev)
    }, ORIGIN_TIMEOUT_MS)

    try {
      const r = await fetch('/api/tools/clone/lookup-ticket', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: tid }),
      })
      const d = await r.json()
      clearTimeout(originTmRef.current)
      if (d.ok) {
        setLookup(d)
        setDetectedApp(d.detected_app || null)
        setSummary(d.summary || '')
        if (d.origin_ticket) {
          setOriginTicket(d.origin_ticket)
          setOriginStatus('done')
        } else {
          setOriginStatus('timeout')
        }
        // Resolve release branch from fix version via the sprint API
        const fv = (d.fix_versions || [])[0]
        if (fv) {
          setBranchLoading(true)
          fetch('/api/project-management/sprint/resolve-release-branch', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app: 'payor', fix_version: fv }),
          })
            .then(r => r.json())
            .then(rb => setReleaseBranch(rb.release_branch || null))
            .catch(() => {})
            .finally(() => setBranchLoading(false))
        }
      } else {
        setLookErr(d.error || 'Lookup failed')
        setOriginStatus('timeout')
      }
    } catch {
      clearTimeout(originTmRef.current)
      setLookErr('Server unreachable')
      setOriginStatus('timeout')
    }
    setLooking(false)
  }

  const onTicketChange = (v) => {
    setTicket(v)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doLookup(v), 800)
  }

  const togglePr = (pr) => {
    if (selPr?.number === pr.number) {
      setSelPr(null); setPrUrl('')
    } else {
      setSelPr(pr); setPrUrl(pr.html_url || '')
    }
  }

  const onPrUrlChange = (v) => {
    setPrUrl(v)
    if (selPr) setSelPr(null)
  }

  const handleCreate = async () => {
    if (!canCreate) return
    setCreating(true); setCreateErr('')
    try {
      const r = await fetch('/api/tools/clone/trigger', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_name:         detectedApp || 'payor',
          ticket_id:        ticket.trim().toUpperCase(),
          origin_ticket:    originTicket.trim(),
          app_type:         detectedApp || '',
          release_branch:   releaseBranch || '',
          fix_version:      (lookup?.fix_versions || [])[0] || '',
          summary:          summary || '',
          code_freeze_date: lookup?.code_freeze_date || '',
          release_date:     lookup?.release_date     || '',
          pr_number:        selPr ? String(selPr.number) : '',
          pr_status:        selPr ? prLabel(selPr)       : '',
          pr_url:           prUrl.trim(),
        }),
      })
      const d = await r.json()
      if (d.ok) { setDone(true); setTimeout(() => onClose(true), 1200) }
      else setCreateErr(d.error || 'Failed to create run.')
    } catch {
      setCreateErr('Server unreachable')
    }
    setCreating(false)
  }

  const canCreate = !!ticket.trim() && !looking && !!originTicket.trim() && !!prUrl.trim()

  const originHint = originStatus === 'timeout' && !originTicket
    ? 'Not resolved from JIRA — enter manually'
    : null

  const RO = { background: 'var(--surface2)', cursor: 'default' }

  return (
    <div className="modal-overlay" onClick={() => onClose(false)}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 860 }}>
        <div className="modal-header">
          <span className="modal-title">New Clone Run</span>
          <button className="modal-close" onClick={() => onClose(false)}>✕</button>
        </div>

        <div className="modal-body">
          {done ? (
            <div className="alert alert-info">✓ Clone run created. Refreshing…</div>
          ) : (
            <>
              {/* Clone Ticket */}
              <div className="form-group">
                <label className="field-label">
                  Clone Ticket <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="e.g. PAYOR-210071"
                    value={ticket}
                    onChange={e => onTicketChange(e.target.value)}
                    style={{ flex: 1 }}
                    autoFocus
                  />
                  {looking && <span className="spinner" style={{ width: 14, height: 14 }} />}
                </div>
                {lookErr && (
                  <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{lookErr}</div>
                )}
              </div>

              {/* Origin Ticket */}
              {ticket.trim() && (
                <div className="form-group">
                  <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    Origin Ticket <span style={{ color: 'var(--danger)' }}>*</span>
                    {originStatus === 'loading' && (
                      <>
                        <span className="spinner" style={{ width: 10, height: 10 }} />
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                          resolving via JIRA…
                        </span>
                      </>
                    )}
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. PAYOR-210000"
                    value={originTicket}
                    onChange={e => setOriginTicket(e.target.value)}
                    disabled={originStatus === 'loading'}
                    style={originStatus === 'loading' ? { ...RO, cursor: 'wait' } : {}}
                  />
                  {originHint && (
                    <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>⚠ {originHint}</div>
                  )}
                </div>
              )}

              {lookup && (
                <>
                  {/* JIRA info: App Type | Release Branch | Fix Version | Code Freeze | Release Date */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: '0 14px' }}>
                    <div className="form-group">
                      <label className="field-label">App Type</label>
                      <input type="text" readOnly
                        value={detectedApp || '—'}
                        style={{ ...RO, color: detectedApp ? 'var(--primary)' : 'var(--text-muted)',
                          fontWeight: detectedApp ? 600 : 400, textTransform: detectedApp ? 'capitalize' : 'none' }} />
                    </div>
                    <div className="form-group">
                      <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        Release Branch
                        {branchLoading && <span className="spinner" style={{ width: 10, height: 10 }} />}
                      </label>
                      <input type="text" readOnly
                        value={releaseBranch || (branchLoading ? '' : '—')}
                        placeholder={branchLoading ? 'resolving…' : ''}
                        style={{ ...RO, color: releaseBranch ? 'var(--text)' : 'var(--text-muted)' }} />
                    </div>
                    <div className="form-group">
                      <label className="field-label">Fix Version</label>
                      <input type="text" readOnly
                        value={(lookup.fix_versions || []).join(', ') || '—'}
                        style={{ ...RO, color: lookup.fix_versions?.length ? 'var(--text)' : 'var(--text-muted)' }} />
                    </div>
                    <div className="form-group">
                      <label className="field-label">Code Freeze Date</label>
                      <input type="text" readOnly value={lookup.code_freeze_date || '—'}
                        style={{ ...RO, color: lookup.code_freeze_date ? 'var(--text)' : 'var(--text-muted)' }} />
                    </div>
                    <div className="form-group">
                      <label className="field-label">Release Date</label>
                      <input type="text" readOnly value={lookup.release_date || '—'}
                        style={{ ...RO, color: lookup.release_date ? 'var(--text)' : 'var(--text-muted)' }} />
                    </div>
                  </div>

                  {/* PR list */}
                  <div className="form-group" style={{ marginTop: 4 }}>
                    <label className="field-label">
                      Pull Requests against <code style={{ fontSize: 11 }}>master</code>
                      <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                        ({lookup.prs?.length || 0} found)
                      </span>
                      <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>
                    </label>

                    {!lookup.prs?.length ? (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
                        No PRs found against master — paste a PR URL below.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
                        {lookup.prs.map(pr => {
                          const lbl = prLabel(pr)
                          const isSel = selPr?.number === pr.number
                          return (
                            <div key={pr.number}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '7px 10px', borderRadius: 6,
                                border: `1px solid ${isSel ? 'var(--primary)' : 'var(--border)'}`,
                                background: isSel
                                  ? 'rgba(var(--primary-rgb,59,130,246),0.06)'
                                  : 'var(--surface)',
                              }}>
                              <span style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 12, flexShrink: 0 }}>
                                #{pr.number}
                              </span>
                              <span style={{
                                fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10,
                                flexShrink: 0, ...prBadgeStyle(lbl),
                              }}>{lbl}</span>
                              <span style={{
                                fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace',
                                flexShrink: 0,
                              }}>{pr.head_branch}</span>
                              <span style={{
                                fontSize: 12, flex: 1, minWidth: 0,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                color: 'var(--text-muted)',
                              }}>{pr.title}</span>
                              {pr.html_url && (
                                <a href={pr.html_url} target="_blank" rel="noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  style={{ fontSize: 11, color: 'var(--primary)', flexShrink: 0 }}>
                                  ↗
                                </a>
                              )}
                              <button
                                className={`btn btn-sm${isSel ? ' btn-primary' : ''}`}
                                onClick={() => togglePr(pr)}
                                style={{ flexShrink: 0, minWidth: 76 }}
                              >
                                {isSel ? '✓ Selected' : 'Select'}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Editable PR URL */}
                    <div style={{
                      marginTop: 12,
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: `2px solid ${prUrl.trim() ? 'var(--primary)' : 'var(--border)'}`,
                      background: prUrl.trim()
                        ? 'rgba(var(--primary-rgb,59,130,246),0.04)'
                        : 'var(--surface2)',
                      transition: 'border-color 0.15s, background 0.15s',
                    }}>
                      <label className="field-label" style={{ fontSize: 11, marginBottom: 6 }}>
                        PR URL <span style={{ color: 'var(--danger)' }}>*</span>
                        <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                          pre-filled when you Select above, or paste manually
                        </span>
                      </label>
                      <input
                        type="text"
                        placeholder="https://github.com/…/pull/1234"
                        value={prUrl}
                        onChange={e => onPrUrlChange(e.target.value)}
                        style={{
                          width: '100%',
                          fontFamily: 'Consolas, monospace', fontSize: 13,
                          border: 'none', background: 'transparent', outline: 'none',
                          color: prUrl.trim() ? 'var(--primary)' : 'var(--text)',
                          padding: 0,
                        }}
                      />
                    </div>
                  </div>
                </>
              )}

              {createErr && (
                <div className="alert alert-error" style={{ marginTop: 8 }}>{createErr}</div>
              )}

              <div className="flex-gap" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="btn" onClick={() => onClose(false)}>Cancel</button>
                <button
                  className="btn btn-primary"
                  onClick={handleCreate}
                  disabled={!canCreate || creating}
                  title={
                    !ticket.trim()       ? 'Enter a clone ticket first' :
                    looking              ? 'Waiting for JIRA lookup…' :
                    !originTicket.trim() ? 'Origin Ticket is required' :
                    !prUrl.trim()        ? 'PR URL is required' : ''
                  }
                >
                  {creating ? 'Creating…' : '+ Create Run'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Progress modal ─────────────────────────────────────────────────────────

function CloneProgressModal({ row, appName, onClose }) {
  const projectId = row.project_id
  const STAGES = [
    { num: 1, label: 'Checkout release branch', startPct: 0,  endPct: 10  },
    { num: 2, label: 'git pull',                startPct: 10, endPct: 25  },
    { num: 3, label: 'Create clone branch',     startPct: 25, endPct: 35  },
    { num: 4, label: 'Cherry-pick from PR',     startPct: 35, endPct: 70  },
    { num: 5, label: 'Push to origin',          startPct: 70, endPct: 85  },
    { num: 6, label: 'Create pull request',     startPct: 85, endPct: 100 },
  ]

  const [progress, setProgress] = useState(null)
  const [elapsed,  setElapsed]  = useState(0)
  const pollRef  = useRef(null)
  const timerRef = useRef(null)
  const startRef = useRef(Date.now())

  const fetchProgress = () => {
    fetch(`/api/tools/clone/apps/${appName}/projects/${projectId}/progress`)
      .then(r => r.json())
      .then(d => { if (d.ok) setProgress(d) })
      .catch(() => {})
  }

  useEffect(() => {
    fetchProgress()
    pollRef.current  = setInterval(fetchProgress, 2500)
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000)
    return () => {
      clearInterval(pollRef.current)
      clearInterval(timerRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (progress && (progress.is_done || progress.is_failed || progress.is_waiting)) {
      clearInterval(pollRef.current)
    }
  }, [progress])

  const fmtTime = (s) => {
    if (s < 60) return `${s}s`
    return `${Math.floor(s / 60)}m ${s % 60}s`
  }

  const estimatedRemaining = () => {
    if (!progress || !progress.avg_durations) return null
    const stageNum = progress.stage_num
    if (stageNum < 0 || progress.is_done) return null
    let remaining = 0
    for (let i = Math.max(stageNum, 1); i <= 6; i++) {
      remaining += (progress.avg_durations[i] || 30)
    }
    if (stageNum >= 1 && stageNum <= 6) {
      const prevStagesDur = Array.from({ length: stageNum - 1 }, (_, idx) => idx + 1)
        .reduce((sum, i) => sum + (progress.avg_durations[i] || 30), 0)
      const elapsedInStage = Math.max(0, (progress.elapsed_s || 0) - prevStagesDur)
      remaining -= elapsedInStage
    }
    return Math.max(0, Math.round(remaining))
  }

  const barPct   = progress ? Math.min(100, Math.max(0, progress.pct)) : 0
  const isDone   = progress?.is_done
  const isFail   = progress?.is_failed
  const isWait   = progress?.is_waiting
  const stageN   = progress?.stage_num ?? 0
  const eta      = estimatedRemaining()
  const barColor = isDone ? '#16a34a' : isFail ? '#dc2626' : isWait ? '#f59e0b' : '#22c55e'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}
           style={{ maxWidth: 520, minWidth: 420 }}>
        <div className="modal-header">
          <span className="modal-title">
            {isDone ? '✓ Clone Completed' : isFail ? '✗ Clone Failed' : isWait ? '⚠ Waiting for Action' : '⟳ Clone in Progress'}
          </span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ paddingBottom: 20 }}>
          <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-muted)' }}>
            {row.ticket_id} — {row.release_branch}
          </div>

          {/* Glossy progress bar */}
          <div style={{
            position: 'relative', height: 22, borderRadius: 11,
            background: 'var(--surface2)', overflow: 'hidden',
            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)',
            marginBottom: 6,
          }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, bottom: 0,
              width: `${isDone ? 100 : barPct}%`,
              background: `linear-gradient(to bottom, ${barColor}cc 0%, ${barColor} 45%, ${barColor}dd 100%)`,
              borderRadius: 11,
              transition: 'width 0.6s ease',
              boxShadow: `0 0 8px ${barColor}88`,
            }}>
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: '55%',
                background: 'linear-gradient(to bottom, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.08) 100%)',
                borderRadius: '11px 11px 0 0',
              }} />
              {!isDone && !isFail && !isWait && (
                <div style={{
                  position: 'absolute', top: 0, bottom: 0, width: '40%',
                  background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.25), transparent)',
                  animation: 'cloneShimmer 1.6s infinite',
                }} />
              )}
            </div>
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 600, color: '#fff',
              textShadow: '0 1px 2px rgba(0,0,0,0.4)',
              userSelect: 'none',
            }}>
              {isDone ? '100%' : isFail ? 'Failed' : isWait ? 'Waiting' : `${barPct}%`}
            </div>
          </div>

          {/* Time row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
            <span>Elapsed: <strong style={{ color: 'var(--text)' }}>{fmtTime(elapsed)}</strong></span>
            {eta != null && !isDone && !isFail && (
              <span>Est. remaining: <strong style={{ color: 'var(--text)' }}>~{fmtTime(eta)}</strong></span>
            )}
          </div>

          {/* Stage list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {STAGES.map(s => {
              const done    = stageN > s.num || isDone
              const current = stageN === s.num && !isDone && !isFail
              const failed  = isFail && stageN === s.num
              const waiting = isWait && stageN === s.num
              return (
                <div key={s.num} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '5px 8px', borderRadius: 6,
                  background: current || waiting ? 'var(--surface2)' : 'transparent',
                  border: current ? '1px solid #22c55e44' : waiting ? '1px solid #f59e0b44' : '1px solid transparent',
                }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700,
                    background: done ? '#16a34a' : failed ? '#dc2626' : waiting ? '#f59e0b' : current ? '#22c55e' : 'var(--border)',
                    color: (done || failed || waiting || current) ? '#fff' : 'var(--text-muted)',
                    boxShadow: current ? '0 0 6px #22c55e88' : 'none',
                  }}>
                    {done ? '✓' : failed ? '✗' : waiting ? '!' : s.num}
                  </div>
                  <span style={{
                    fontSize: 13,
                    color: done ? 'var(--text-muted)' : current ? 'var(--text)' : 'var(--text-muted)',
                    fontWeight: current ? 500 : 400,
                  }}>
                    {s.label}
                  </span>
                  {current && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#22c55e', animation: 'clonePulse 1s infinite' }}>running…</span>}
                  {waiting && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#f59e0b' }}>resolve conflicts</span>}
                </div>
              )
            })}
          </div>

          {progress?.status && (
            <div style={{
              marginTop: 12, padding: '6px 10px', borderRadius: 6,
              background: 'var(--surface2)',
              fontSize: 12, fontFamily: 'Consolas, monospace',
              color: isFail ? 'var(--danger)' : isWait ? '#f59e0b' : 'var(--text-muted)',
              wordBreak: 'break-word',
            }}>
              {progress.status}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes cloneShimmer {
          0%   { transform: translateX(-150%) }
          100% { transform: translateX(350%) }
        }
        @keyframes clonePulse {
          0%, 100% { opacity: 1 } 50% { opacity: 0.4 }
        }
      `}</style>
    </div>
  )
}

// ── Cherry-pick conflict modal ─────────────────────────────────────────────

function CloneCherryPickConflictModal({ row, tabKey, onAbort, onContinue }) {
  const [continuing, setContinuing] = useState(false)
  const conflictLines = (row.conflict_info || '').split('\n').filter(Boolean)

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onAbort() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onAbort])

  return (
    <div className="modal-overlay" onClick={onAbort}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <span className="modal-title">Cherry-pick Conflicts Detected</span>
          <button className="modal-close" onClick={onAbort}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{
            padding: '10px 14px', borderRadius: 6, marginBottom: 14, fontSize: 13,
            background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)',
          }}>
            <strong>Cherry-pick failed with conflicts.</strong> Resolve the conflicts in your IDE,
            then stage the resolved files with <code>git add &lt;file&gt;</code>
            before clicking <em>Continue</em>.
          </div>

          {conflictLines.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                Conflicted files ({conflictLines.length})
              </div>
              <div style={{
                maxHeight: 180, overflowY: 'auto',
                background: 'var(--surface2)', borderRadius: 6,
                border: '1px solid var(--border)', padding: '8px 12px',
              }}>
                {conflictLines.map((f, i) => (
                  <div key={i} style={{
                    fontFamily: 'Consolas, monospace', fontSize: 12,
                    color: 'var(--danger)', padding: '2px 0',
                  }}>{f}</div>
                ))}
              </div>
            </div>
          )}

          <div style={{
            padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 12,
            background: 'var(--surface2)', border: '1px solid var(--border)',
          }}>
            <strong>Steps to resolve:</strong>
            <ol style={{ margin: '6px 0 0 16px', lineHeight: 1.8 }}>
              <li>Open the conflicted files in your IDE and resolve markers</li>
              <li>Run <code>git add &lt;resolved-file&gt;</code> for each file</li>
              <li>Return here and click <strong>Continue</strong></li>
            </ol>
          </div>

          <div className="flex-gap" style={{ justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn" onClick={onAbort} disabled={continuing}>
              Abort Cherry-pick
            </button>
            <button
              className="btn btn-primary"
              disabled={continuing}
              onClick={async () => {
                setContinuing(true)
                await onContinue()
              }}
            >
              {continuing ? 'Continuing…' : 'Continue After Resolve'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Dirty-files confirmation modal ────────────────────────────────────────

function CloneExecConfirmModal({ row, tabKey, dirtyFiles, onAbort, onRevert }) {
  const [reverting, setReverting] = useState(false)

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onAbort() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onAbort])

  return (
    <div className="modal-overlay" onClick={onAbort}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 580 }}>
        <div className="modal-header">
          <span className="modal-title">Uncommitted Changes Detected</span>
          <button className="modal-close" onClick={onAbort}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{
            padding: '10px 14px', borderRadius: 6,
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.35)',
            marginBottom: 14,
            fontSize: 13,
          }}>
            <strong>⚠ The repository already has the release branch checked out</strong> and
            contains uncommitted changes. You must revert them before proceeding, or abort.
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
              {dirtyFiles.length} uncommitted file{dirtyFiles.length !== 1 ? 's' : ''}
            </div>
            <div style={{
              maxHeight: 200, overflowY: 'auto',
              background: 'var(--surface2)', borderRadius: 6,
              border: '1px solid var(--border)', padding: '8px 12px',
            }}>
              {dirtyFiles.map((f, i) => (
                <div key={i} style={{
                  fontFamily: 'Consolas, monospace', fontSize: 12,
                  color: f.startsWith('?') ? 'var(--text-muted)' : 'var(--danger)',
                  padding: '2px 0',
                }}>{f}</div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              Lines starting with <code>??</code> are untracked files (will not be removed by revert).
            </div>
          </div>

          <div className="flex-gap" style={{ justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn" onClick={onAbort} disabled={reverting}>
              Abort
            </button>
            <button
              className="btn btn-danger"
              disabled={reverting}
              onClick={async () => {
                setReverting(true)
                await onRevert()
              }}
            >
              {reverting ? 'Reverting…' : 'Revert Changes & Continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function ClonePage() {
  const [apps,        setApps]        = useState([])
  const [showModal,   setShowModal]   = useState(false)
  const [showConfig,  setShowConfig]  = useState(false)
  const [refreshKey,  setRefreshKey]  = useState(0)
  const [execConfirm,  setExecConfirm]  = useState(null) // {row, tabKey, dirtyFiles}
  const [chPickConfirm, setChPickConfirm] = useState(null) // {row, tabKey}
  const [showProgress, setShowProgress] = useState(null)  // {row, appName}

  useEffect(() => {
    fetch('/api/tools/clone/apps')
      .then(r => r.json())
      .then(d => setApps((d.apps || []).map(a => a.name)))
  }, [showConfig])

  const tabs = apps.map(name => ({
    key:       name,
    label:     name.charAt(0).toUpperCase() + name.slice(1),
    fetchUrl:  `/api/tools/clone/apps/${name}/projects`,
    deleteUrl: `/api/tools/clone/apps/${name}/projects`,
  }))

  const _callExecute = async (row, tabKey, extraBody = {}) => {
    const res = await fetch(
      `/api/tools/clone/apps/${encodeURIComponent(tabKey)}/projects/${encodeURIComponent(row.project_id)}/execute`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(extraBody) },
    )
    return res.json()
  }

  const _callAction = async (row, tabKey, action) => {
    await fetch(
      `/api/tools/clone/apps/${encodeURIComponent(tabKey)}/projects/${encodeURIComponent(row.project_id)}/execute-action`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }) },
    )
    setRefreshKey(k => k + 1)
  }

  const handleExecute = async (row, tabKey) => {
    const d = await _callExecute(row, tabKey)
    if (d.needs_confirmation) {
      setExecConfirm({ row, tabKey, dirtyFiles: d.dirty_files || [] })
      return
    }
    if (d.started) {
      setShowProgress({ row, appName: tabKey })
      setRefreshKey(k => k + 1)
      return
    }
    setRefreshKey(k => k + 1)
  }

  const handleRevert = async () => {
    const { row, tabKey } = execConfirm
    setExecConfirm(null)
    const d = await _callExecute(row, tabKey, { revert: true })
    if (d.started) setShowProgress({ row, appName: tabKey })
    setRefreshKey(k => k + 1)
  }

  const handleCherryPickContinue = async () => {
    const { row, tabKey } = chPickConfirm
    setChPickConfirm(null)
    await _callAction(row, tabKey, 'continue_cherry_pick')
  }

  const handleCherryPickAbort = async (row, tabKey) => {
    await _callAction(row, tabKey, 'abort_cherry_pick')
  }

  // Render the action column per row based on current status
  const renderRowActions = (row, tabKey) => {
    const st = (row.status || '').toLowerCase()
    if (st.startsWith('waiting: cherry-pick conflicts')) {
      return (
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-sm btn-primary"
            onClick={() => setChPickConfirm({ row, tabKey })}>
            Continue ↩
          </button>
          <button className="btn btn-sm btn-danger"
            onClick={() => handleCherryPickAbort(row, tabKey)}>
            Abort
          </button>
        </div>
      )
    }
    if (st.startsWith('running:') || st === 'running: starting') {
      return (
        <button className="btn btn-sm" style={{ fontSize: 11 }}
          onClick={() => setShowProgress({ row, appName: tabKey })}>
          ⟳ Progress
        </button>
      )
    }
    if (st === 'completed') {
      return null
    }
    // Pending / Failed / Aborted / blank → show Execute
    return (
      <button className="btn btn-sm btn-primary"
        onClick={() => handleExecute(row, tabKey)}>
        ▶ Execute
      </button>
    )
  }

  return (
    <>
      <ToolRunsPage
        key={refreshKey}
        title="Clone"
        tool="clone"
        tabs={tabs.length > 0 ? tabs : undefined}
        columns={COLS}
        sortBy="project_id"
        sortNum
        idKey="project_id"
        deletable
        schedulerConfigUrl="/api/tools/clone/scheduler-config"
        schedulerSettingsUrl="/api/tools/clone/scheduler-settings"
        refreshIntervalOptions={[1, 2, 3, 5, 10, 15, 20, 30]}
        onConfigure={() => setShowConfig(true)}
        onNewRun={() => setShowModal(true)}
        renderRowActions={renderRowActions}
      />
      {showModal && (
        <CloneNewRunModal
          onClose={(refresh) => {
            setShowModal(false)
            if (refresh) setRefreshKey(k => k + 1)
          }}
        />
      )}
      {showConfig && (
        <CloneConfigModal onClose={() => setShowConfig(false)} />
      )}
      {execConfirm && (
        <CloneExecConfirmModal
          row={execConfirm.row}
          tabKey={execConfirm.tabKey}
          dirtyFiles={execConfirm.dirtyFiles}
          onAbort={() => setExecConfirm(null)}
          onRevert={handleRevert}
        />
      )}
      {chPickConfirm && (
        <CloneCherryPickConflictModal
          row={chPickConfirm.row}
          tabKey={chPickConfirm.tabKey}
          onAbort={() => {
            setChPickConfirm(null)
            handleCherryPickAbort(chPickConfirm.row, chPickConfirm.tabKey)
          }}
          onContinue={handleCherryPickContinue}
        />
      )}
      {showProgress && (
        <CloneProgressModal
          row={showProgress.row}
          appName={showProgress.appName}
          onClose={() => setShowProgress(null)}
        />
      )}
    </>
  )
}
