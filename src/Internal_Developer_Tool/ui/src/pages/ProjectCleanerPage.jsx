import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

const API = '/api/tools/project-cleaner'

const CATEGORY_ORDER = ['Payor', 'Classic', 'Connector', 'Enrollment', 'PIK', 'Payer Utils', 'Rest Adaptor', 'UI', 'Other']

const CATEGORY_COLOR = {
  Payor:           '#1976d2',
  Classic:         '#7b1fa2',
  Connector:       '#00838f',
  Enrollment:      '#2e7d32',
  PIK:             '#e65100',
  'Payer Utils':   '#00695c',
  'Rest Adaptor':  '#4527a0',
  UI:              '#c62828',
  Other:           '#546e7a',
}

function fmtAge(mtime) {
  if (!mtime) return ''
  const secs = Date.now() / 1000 - mtime
  if (secs < 60)           return 'just now'
  if (secs < 3600)         return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400)        return `${Math.floor(secs / 3600)}h ago`
  if (secs < 86400 * 30)   return `${Math.floor(secs / 86400)}d ago`
  if (secs < 86400 * 365)  return `${Math.floor(secs / 86400 / 30)}mo ago`
  return `${(secs / 86400 / 365).toFixed(1)}y ago`
}

function ageColor(mtime) {
  if (!mtime) return 'var(--text-muted)'
  const days = (Date.now() / 1000 - mtime) / 86400
  if (days > 365) return '#f44336'
  if (days > 180) return '#ff9800'
  if (days > 90)  return '#e6a817'
  return 'var(--text-muted)'
}

function fmtSize(bytes) {
  if (bytes == null) return '—'
  if (bytes === 0) return '0 B'
  if (bytes < 1024)                return `${bytes} B`
  if (bytes < 1024 * 1024)         return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export default function ProjectCleanerPage() {
  const navigate = useNavigate()

  const [configPath,   setConfigPath]   = useState('')
  const [editPath,     setEditPath]     = useState('')
  const [configSaving, setConfigSaving] = useState(false)
  const [configSaved,  setConfigSaved]  = useState(false)
  const [configErr,    setConfigErr]    = useState('')
  const [showConfig,   setShowConfig]   = useState(false)

  const [scanning,  setScanning]  = useState(false)
  const [scanData,  setScanData]  = useState(null)
  const [scanErr,   setScanErr]   = useState('')

  const [selected,    setSelected]    = useState(new Set())
  const [confirmDel,  setConfirmDel]  = useState(null)  // null | 'selected' | projectName
  const [deleting,    setDeleting]    = useState(false)
  const [delResult,   setDelResult]   = useState(null)
  const [delErr,      setDelErr]      = useState('')

  useEffect(() => {
    fetch(`${API}/config`)
      .then(r => r.json())
      .then(d => { if (d.ok) { setConfigPath(d.path); setEditPath(d.path) } })
      .catch(() => {})
  }, [])

  const saveConfig = async () => {
    setConfigSaving(true); setConfigErr(''); setConfigSaved(false)
    try {
      const r = await fetch(`${API}/config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: editPath }),
      })
      const d = await r.json()
      if (d.ok) { setConfigPath(editPath); setConfigSaved(true); setScanData(null) }
      else setConfigErr(d.error || 'Save failed')
    } catch { setConfigErr('Request failed') }
    setConfigSaving(false)
  }

  const scan = useCallback(async () => {
    setScanning(true); setScanErr(''); setScanData(null)
    setSelected(new Set()); setDelResult(null); setDelErr('')
    try {
      const r = await fetch(`${API}/scan`)
      const d = await r.json()
      if (d.ok) setScanData(d)
      else setScanErr(d.error || 'Scan failed')
    } catch { setScanErr('Request failed') }
    setScanning(false)
  }, [])

  const deleteProjects = async (names) => {
    setDeleting(true); setDelErr(''); setDelResult(null); setConfirmDel(null)
    try {
      const r = await fetch(`${API}/clean`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      })
      const d = await r.json()
      if (d.ok) {
        setDelResult(d)
        setSelected(new Set())
        await scan()
      } else setDelErr(d.error || 'Delete failed')
    } catch { setDelErr('Request failed') }
    setDeleting(false)
  }

  const toggleSelect = (name) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const toggleAll = () => {
    if (!scanData) return
    if (selected.size === scanData.projects.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(scanData.projects.map(p => p.name)))
    }
  }

  const pathChanged = editPath !== configPath

  const groupedProjects = useMemo(() => {
    if (!scanData) return []
    const map = {}
    for (const proj of scanData.projects) {
      const cat = proj.category || 'Other'
      if (!map[cat]) map[cat] = []
      map[cat].push(proj)
    }
    return CATEGORY_ORDER.filter(cat => map[cat]?.length > 0).map(cat => ({
      category: cat,
      projects: map[cat],
    }))
  }, [scanData])

  const confirmTarget = confirmDel === 'selected'
    ? [...selected]
    : confirmDel ? [confirmDel] : []

  return (
    <div style={{ padding: '24px 28px', maxWidth: 800 }}>
      <button className="btn back-link" onClick={() => navigate('/developer-tools')}
        style={{ marginBottom: 16, fontSize: 12, padding: '4px 10px' }}>
        ← Tools
      </button>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--text-primary, #111)' }}>
            Project Cleaner
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            {configPath || 'Local project workspace'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {scanData && (
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {scanData.projects.length} project{scanData.projects.length !== 1 ? 's' : ''}
            </span>
          )}
          <button className="btn btn-primary" onClick={scan} disabled={scanning}
            style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            {scanning
              ? <><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />Scanning…</>
              : '🔍 Scan'}
          </button>
          <button className="btn btn-sm" onClick={() => setShowConfig(v => !v)} style={{ fontSize: 12 }}>
            ⚙ Config
          </button>
        </div>
      </div>

      {/* ── Config ──────────────────────────────────────────────────────── */}
      {showConfig && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Projects Root Path</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={editPath} onChange={e => { setEditPath(e.target.value); setConfigSaved(false) }}
              onKeyDown={e => e.key === 'Enter' && pathChanged && saveConfig()}
              style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}
              placeholder="e.g. C:\Users\you\projects" />
            <button className="btn btn-primary" onClick={saveConfig}
              disabled={configSaving || !pathChanged} style={{ whiteSpace: 'nowrap' }}>
              {configSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {configSaved && <div style={{ color: '#4caf50', fontSize: 12, marginTop: 6 }}>✓ Saved</div>}
          {configErr   && <div style={{ color: '#f44336', fontSize: 12, marginTop: 6 }}>{configErr}</div>}
        </div>
      )}

      {/* ── Scan error ──────────────────────────────────────────────────── */}
      {scanErr && <div className="alert alert-error" style={{ marginBottom: 16 }}>{scanErr}</div>}

      {/* ── Delete result ───────────────────────────────────────────────── */}
      {delResult && (
        <div style={{
          color: '#2e7d32', fontSize: 13, marginBottom: 16,
          padding: '10px 14px', background: 'rgba(46,125,50,0.06)',
          border: '1px solid rgba(46,125,50,0.3)', borderRadius: 6,
        }}>
          ✓ Deleted {delResult.deleted.length} project{delResult.deleted.length !== 1 ? 's' : ''}
          {delResult.deleted.length > 0 && `: ${delResult.deleted.join(', ')}`}.
          {delResult.errors?.length > 0 && (
            <div style={{ marginTop: 6, color: '#e65100', fontSize: 12 }}>
              {delResult.errors.length} error{delResult.errors.length !== 1 ? 's' : ''}:
              {delResult.errors.map((e, i) => <div key={i} style={{ fontFamily: 'monospace', fontSize: 11 }}>{e}</div>)}
            </div>
          )}
        </div>
      )}
      {delErr && <div className="alert alert-error" style={{ marginBottom: 16 }}>{delErr}</div>}

      {/* ── Confirmation ────────────────────────────────────────────────── */}
      {confirmDel && (
        <div style={{
          padding: '16px', background: 'rgba(198,40,40,0.05)',
          border: '1px solid rgba(198,40,40,0.35)', borderRadius: 6, marginBottom: 16,
        }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#c62828', marginBottom: 8 }}>
            ⚠ Confirm Delete
          </div>
          <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 8 }}>
            The following {confirmTarget.length} project{confirmTarget.length !== 1 ? 's' : ''} will be permanently deleted:
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text)', marginBottom: 12,
            padding: '8px 10px', background: 'var(--surface2)', borderRadius: 4,
            maxHeight: 120, overflowY: 'auto' }}>
            {confirmTarget.join('\n')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
            This action cannot be undone. Git history and local files will be lost.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => deleteProjects(confirmTarget)}
              disabled={deleting}
              style={{
                padding: '7px 18px', fontSize: 13, fontWeight: 600,
                background: '#c62828', color: '#fff',
                border: 'none', borderRadius: 5, cursor: 'pointer',
              }}>
              {deleting ? 'Deleting…' : 'Yes, Delete'}
            </button>
            <button className="btn" onClick={() => setConfirmDel(null)} disabled={deleting}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Project list ────────────────────────────────────────────────── */}
      {scanData && (
        <>
          {/* Global toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={selected.size === scanData.projects.length && scanData.projects.length > 0}
                onChange={toggleAll}
                style={{ cursor: 'pointer' }}
              />
              <span style={{ color: 'var(--text-muted)' }}>
                {selected.size > 0 ? `${selected.size} selected` : 'Select all'}
              </span>
            </label>
            {selected.size > 0 && !confirmDel && (
              <button
                onClick={() => setConfirmDel('selected')}
                style={{
                  padding: '5px 14px', fontSize: 12, fontWeight: 600,
                  background: '#c62828', color: '#fff',
                  border: 'none', borderRadius: 5, cursor: 'pointer',
                }}>
                🗑 Delete Selected ({selected.size})
              </button>
            )}
          </div>

          {scanData.projects.length === 0 ? (
            <div className="card" style={{ color: 'var(--text-muted)', fontSize: 13 }}>No project folders found.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {groupedProjects.map(group => (
                <div key={group.category}>
                  {/* Category header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8,
                    paddingBottom: 6, borderBottom: `2px solid ${CATEGORY_COLOR[group.category] ?? '#546e7a'}`,
                  }}>
                    <span style={{
                      fontSize: 13, fontWeight: 700, color: CATEGORY_COLOR[group.category] ?? '#546e7a',
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>
                      {group.category}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {group.projects.length} project{group.projects.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Projects in this category */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {group.projects.map((proj) => (
                      <div key={proj.name} style={{
                        display: 'grid',
                        gridTemplateColumns: '28px 1fr auto',
                        gap: '0 12px',
                        alignItems: 'center',
                        padding: '10px 12px',
                        borderRadius: 6,
                        background: selected.has(proj.name) ? 'rgba(74,144,226,0.08)' : 'var(--surface2)',
                        border: `1px solid ${selected.has(proj.name) ? 'var(--primary)' : 'var(--border)'}`,
                        cursor: 'pointer',
                        transition: 'background 0.1s, border-color 0.1s',
                      }} onClick={() => toggleSelect(proj.name)}>
                        <input
                          type="checkbox"
                          checked={selected.has(proj.name)}
                          onChange={() => toggleSelect(proj.name)}
                          onClick={e => e.stopPropagation()}
                          style={{ cursor: 'pointer' }}
                        />

                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontWeight: 600, fontSize: 13, fontFamily: 'monospace', color: 'var(--text)' }}>
                            📁 {proj.name}
                          </span>
                          {proj.mtime > 0 && (
                            <span style={{ fontSize: 11, fontWeight: 600, color: ageColor(proj.mtime) }}
                              title={proj.modified}>
                              {fmtAge(proj.mtime)}
                            </span>
                          )}
                        </div>

                        <button
                          onClick={e => { e.stopPropagation(); setConfirmDel(proj.name) }}
                          disabled={deleting}
                          style={{
                            padding: '4px 10px', fontSize: 12, background: 'transparent',
                            color: '#c62828', border: '1px solid rgba(198,40,40,0.4)',
                            borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap',
                          }}>
                          🗑 Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!scanData && !scanErr && !scanning && (
        <div className="card" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          Click <strong>Scan</strong> to list projects and their disk usage.
        </div>
      )}
    </div>
  )
}
