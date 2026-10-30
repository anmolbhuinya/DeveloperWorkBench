import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import WorkflowBackButton from '../components/WorkflowBackButton'

function StatusBadge({ value }) {
  const v = (value || '').toLowerCase()
  let cls = 'badge badge-pending'
  if (['passed', 'completed', 'done', 'success'].some(s => v.includes(s)))                              cls = 'badge badge-success'
  else if (['failed', 'error', 'failure', 'timeout'].some(s => v.includes(s)))                           cls = 'badge badge-danger'
  else if (['running','scheduled','in progress','triggered','queued','building'].some(s => v.includes(s))) cls = 'badge badge-warning'
  else if (['skipped', 'cancelled', 'aborted'].some(s => v.includes(s)))                                 cls = 'badge badge-skipped'
  return <span className={cls}>{value || '—'}</span>
}

function Cell({ col, value }) {
  if (!value) return <span style={{ color: 'var(--text-muted)' }}>—</span>
  const display = col.truncate ? value.slice(0, col.truncate) : value
  if (col.badge) return <StatusBadge value={value} />
  if (col.link)  return (
    <a href={value} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
       className="mono" style={{ fontSize: 12 }}>↗ open</a>
  )
  const st = {}
  if (col.bold)    st.fontWeight = 600
  if (col.mono)    { st.fontFamily = 'Consolas, monospace'; st.fontSize = 12 }
  if (col.primary) st.color = 'var(--primary)'
  return <span style={st}>{display}</span>
}

function DetailRow({ row, colSpan, allColumns }) {
  const labelMap = Object.fromEntries((allColumns || []).map(c => [c.key, c.label]))
  const entries = Object.entries(row).filter(([, v]) => v != null && v !== '')
  return (
    <tr>
      <td colSpan={colSpan} style={{ background: 'var(--surface2)', padding: '12px 16px 12px 32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px,1fr))', gap: '10px 28px' }}>
          {entries.map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: 2 }}>
                {labelMap[k] || k}
              </div>
              {String(v).startsWith('http') ? (
                <a href={String(v)} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                  ↗ {String(v).slice(0, 70)}{String(v).length > 70 ? '…' : ''}
                </a>
              ) : (
                <div className="mono" style={{ color: 'var(--text)', wordBreak: 'break-all' }}>{String(v)}</div>
              )}
            </div>
          ))}
        </div>
      </td>
    </tr>
  )
}

function CreateModal({ title, fields, onClose, onSubmit }) {
  const [form, setForm] = useState(() =>
    Object.fromEntries(fields.map(f => {
      const firstOpt = f.type === 'select' && f.options?.[0]
        ? (typeof f.options[0] === 'object' ? f.options[0].value : f.options[0])
        : ''
      return [f.name, f.default || firstOpt]
    }))
  )
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const res = await onSubmit(form)
      if (res.ok) { setDone(true); setTimeout(() => onClose(true), 1200) }
      else setErr(res.error || 'Failed to trigger.')
    } catch { setErr('Request failed.') }
    setBusy(false)
  }

  return (
    <div className="modal-overlay" onClick={() => onClose(false)}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <span className="modal-title">New Run — {title}</span>
          <button className="modal-close" onClick={() => onClose(false)}>✕</button>
        </div>
        <div className="modal-body">
          {done ? (
            <div className="alert alert-info">
              ✓ Triggered successfully. Refresh the list in a moment to see the new entry.
            </div>
          ) : (
            <>
              {fields.map(f => (
                <div key={f.name} className="form-group">
                  <label className="field-label">{f.label}{f.required ? ' *' : ''}</label>
                  {f.type === 'select' ? (
                    <select
                      value={form[f.name]}
                      onChange={e => setForm(p => ({ ...p, [f.name]: e.target.value }))}
                      style={{
                        width: '100%', maxWidth: 380, padding: '8px 12px',
                        background: 'var(--surface)', border: '1px solid var(--border)',
                        borderRadius: 6, color: 'var(--text)', fontSize: 14,
                        fontFamily: 'inherit',
                      }}
                    >
                      {(f.options || []).map(o => {
                        const val = typeof o === 'object' ? o.value : o
                        const lbl = typeof o === 'object' ? o.label : o
                        return <option key={val} value={val}>{lbl}</option>
                      })}
                    </select>
                  ) : (
                    <input
                      type={f.type || 'text'}
                      placeholder={f.placeholder || ''}
                      value={form[f.name]}
                      onChange={e => setForm(p => ({ ...p, [f.name]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && submit()}
                    />
                  )}
                </div>
              ))}
              {err && <div className="alert alert-error">{err}</div>}
              <div className="flex-gap" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="btn" onClick={() => onClose(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={submit}
                  disabled={busy || fields.some(f => f.required && !String(form[f.name] || '').trim())}>
                  {busy ? 'Triggering…' : '▶ Trigger Run'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ToolRunsPage({
  title,
  tool,
  fetchUrl,
  columns,
  sortBy,
  sortNum,
  emptyMsg,
  backPath     = '/workflow-projects',
  idKey        = 'pid',
  createFields = null,
  createUrl    = null,
  onNewRun     = null,
  onConfigure         = null,
  onExecute           = null,   // (row, activeTabKey) => void
  renderRowActions    = null,   // (row, activeTabKey) => ReactNode — overrides onExecute column
  renderRowDetail     = null,   // (row, activeTabKey) => ReactNode — extra content in expanded panel
  deletable           = false,
  // tabs: [{key, label, fetchUrl, deleteUrl?}] — when set, renders a tab bar
  tabs                = null,
  // URL for GET/PUT of auto-refresh interval (scheduler_config)
  schedulerConfigUrl      = null,
  // Custom interval options (minutes). Replaces the default [5,10,15,20,30].
  refreshIntervalOptions  = null,
  // URL for GET/POST of full scheduler settings table (all keys from scheduler_config.xlsx)
  schedulerSettingsUrl    = null,
}) {
  const navigate  = useNavigate()
  const location  = useLocation()
  const resolvedBack = location.state?.backPath || backPath
  const BACK_LABELS = { '/workflow-projects': 'Workflow Projects', '/manage-dev-vms': 'Manage Developer VMs' }
  const backLabel = BACK_LABELS[resolvedBack] || 'Back'
  const [rows,       setRows]       = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [expanded,   setExpanded]   = useState({})
  const [deleting,       setDeleting]       = useState(null)
  const [pendingDelete,  setPendingDelete]  = useState(null)
  const [showCreate,     setShowCreate]     = useState(false)
  const [activeTab,       setActiveTab]       = useState(() => tabs?.[0]?.key ?? null)
  const [autoRefreshMins, setAutoRefreshMins] = useState(0)
  const [executingId,     setExecutingId]     = useState(null)
  const autoRefTimerRef = useRef(null)
  const [showSchedSettings, setShowSchedSettings] = useState(false)
  const [schedSettings,     setSchedSettings]     = useState([])
  const [schedSaving,       setSchedSaving]       = useState(false)
  const [schedSaved,        setSchedSaved]        = useState(false)
  const [schedErr,          setSchedErr]          = useState('')

  const activeTabObj = tabs ? (tabs.find(t => t.key === activeTab) ?? tabs[0]) : null
  const url       = activeTabObj?.fetchUrl ?? fetchUrl ?? `/api/tools/${tool}/projects`
  const deleteBase = activeTabObj?.deleteUrl ?? `/api/tools/${tool}/projects`

  const load = useCallback(() => {
    setLoading(true); setError('')
    fetch(url)
      .then(r => r.json())
      .then(d => { setRows(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => { setError('Failed to load data.'); setLoading(false) })
  }, [url])

  useEffect(() => { load() }, [load])

  // Load saved auto-refresh interval once on mount
  useEffect(() => {
    if (!schedulerConfigUrl) return
    fetch(schedulerConfigUrl)
      .then(r => r.json())
      .then(d => { if (d.ok) setAutoRefreshMins(d.interval_minutes || 0) })
      .catch(() => {})
  }, [schedulerConfigUrl])

  // Auto-refresh timer — reset whenever interval or load function changes
  useEffect(() => {
    clearInterval(autoRefTimerRef.current)
    if (autoRefreshMins > 0) {
      autoRefTimerRef.current = setInterval(load, autoRefreshMins * 60 * 1000)
    }
    return () => clearInterval(autoRefTimerRef.current)
  }, [autoRefreshMins, load])

  const handleAutoRefreshChange = (mins) => {
    setAutoRefreshMins(mins)
    if (schedulerConfigUrl) {
      fetch(schedulerConfigUrl, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval_minutes: mins }),
      }).catch(() => {})
    }
  }

  const loadSchedulerSettings = () => {
    if (!schedulerSettingsUrl) return
    fetch(schedulerSettingsUrl)
      .then(r => r.json())
      .then(d => { if (d.ok && d.settings) setSchedSettings(d.settings) })
      .catch(() => {})
  }

  useEffect(() => { loadSchedulerSettings() }, [schedulerSettingsUrl])

  const saveSchedulerSettings = async () => {
    if (!schedulerSettingsUrl) return
    setSchedSaving(true); setSchedSaved(false); setSchedErr('')
    try {
      const updates = {}
      schedSettings.forEach(s => { updates[s.key] = s.value })
      const r = await fetch(schedulerSettingsUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: updates }),
      })
      const d = await r.json()
      if (d.ok) { setSchedSaved(true); loadSchedulerSettings() }
      else setSchedErr(d.error || 'Failed to save')
    } catch { setSchedErr('Network error') }
    finally { setSchedSaving(false) }
  }

  const switchTab = (key) => {
    setActiveTab(key)
    setRows([])
    setExpanded({})
    setPendingDelete(null)
  }

  const toggle = (key) => setExpanded(e => ({ ...e, [key]: !e[key] }))

  const deleteRow = async (id) => {
    setDeleting(id)
    try {
      await fetch(`${deleteBase}/${encodeURIComponent(id)}`, { method: 'DELETE' })
      setRows(prev => prev.filter(r => String(r[idKey] ?? '') !== String(id)))
    } catch { /* ignore */ }
    setDeleting(null)
    setPendingDelete(null)
  }

  const triggerRun = async (form) => {
    const endpoint = createUrl || `/api/tools/${tool}/trigger`
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    return r.json()
  }

  const sorted = sortBy
    ? [...rows].sort((a, b) => {
        const av = a[sortBy] || '', bv = b[sortBy] || ''
        return sortNum ? (Number(bv) - Number(av)) : (bv > av ? -1 : bv < av ? 1 : 0)
      })
    : rows

  const tableColumns = columns.filter(c => !c.detailOnly)
  const hasActionCol = !!(onExecute || renderRowActions)
  const colCount = tableColumns.length + 1 + (deletable ? 1 : 0) + (hasActionCol ? 1 : 0)

  return (
    <div>
      <button
        className="btn back-link"
        onClick={() => navigate(resolvedBack)}
        style={{ marginBottom: 16, fontSize: 12, padding: '4px 10px' }}
      >
        ← {backLabel}
      </button>
      <WorkflowBackButton />

      <div className="page-header" style={{ alignItems: 'flex-start' }}>
        <h1 className="page-title">{title}</h1>
        <div className="flex-gap" style={{ alignItems: 'flex-start' }}>
          {schedulerConfigUrl && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                Auto refresh:
              </label>
              <select
                value={autoRefreshMins}
                onChange={e => handleAutoRefreshChange(Number(e.target.value))}
                style={{
                  fontSize: 12, padding: '4px 8px', borderRadius: 5,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)', color: 'var(--text)',
                }}
              >
                <option value={0}>Off</option>
                {(refreshIntervalOptions || [5, 10, 15, 20, 30]).map(m => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>
            </div>
          )}
          <button className="btn" onClick={load} disabled={loading}>↺ Refresh</button>
          {onConfigure && (
            <button className="btn" onClick={onConfigure} title="Configure apps">
              ⚙ Configure
            </button>
          )}
          {schedulerSettingsUrl && (
            <button className="btn" onClick={() => setShowSchedSettings(v => !v)} title="Scheduler settings">
              ⏱ Scheduler
            </button>
          )}
          {/* New Run shown here only when there is no tab bar */}
          {!tabs && (createFields || onNewRun) && (
            <button className="btn btn-primary"
              onClick={() => onNewRun ? onNewRun() : setShowCreate(true)}>
              + New Run
            </button>
          )}
        </div>
      </div>

      {showSchedSettings && schedulerSettingsUrl && (
        <div style={{ margin: '0 0 16px 0', padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Scheduler Settings</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(applies to all {title} runs)</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 10 }}>
            <thead>
              <tr>
                {['Key', 'Value', 'Notes'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schedSettings.map((s, i) => (
                <tr key={s.key}>
                  <td style={{ padding: '4px 8px', fontFamily: 'monospace', color: 'var(--text)' }}>{s.key}</td>
                  <td style={{ padding: '4px 8px' }}>
                    <input value={s.value}
                      onChange={e => { setSchedSettings(prev => prev.map((r, j) => j === i ? { ...r, value: e.target.value } : r)); setSchedSaved(false) }}
                      style={{ width: 110, padding: '3px 7px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }} />
                  </td>
                  <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{s.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn" onClick={saveSchedulerSettings} disabled={schedSaving}
              style={{ fontSize: 12, padding: '5px 14px' }}>
              {schedSaving ? 'Saving…' : 'Save'}
            </button>
            {schedSaved && <span style={{ fontSize: 12, color: '#4caf50' }}>✓ Saved</span>}
            {schedErr  && <span style={{ fontSize: 12, color: '#f44336' }}>{schedErr}</span>}
          </div>
        </div>
      )}

      {tabs && tabs.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 0,
          borderBottom: '2px solid var(--border)',
          marginBottom: 16,
        }}>
          {tabs.map(tab => {
            const active = (activeTab ?? tabs[0].key) === tab.key
            return (
              <button key={tab.key} onClick={() => switchTab(tab.key)} style={{
                padding: '7px 20px', fontSize: 13, cursor: 'pointer',
                background: 'transparent', border: 'none', outline: 'none',
                borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
                marginBottom: -2,
                color: active ? 'var(--primary)' : 'var(--text)',
                fontWeight: active ? 600 : 400,
                transition: 'color 0.12s, border-color 0.12s',
              }}>
                {tab.label}
              </button>
            )
          })}
          {/* New Run aligned to the right of the tab bar */}
          {(createFields || onNewRun) && (
            <button
              className="btn btn-primary"
              onClick={() => onNewRun ? onNewRun() : setShowCreate(true)}
              style={{ marginLeft: 'auto', marginBottom: 4 }}
            >
              + New Run
            </button>
          )}
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="center"><span className="spinner" /></div>
      ) : sorted.length === 0 ? (
        <div className="empty">
          <h3>No records yet</h3>
          <p>{emptyMsg || `No ${title} records found.`}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                {tableColumns.map(c => <th key={c.key}>{c.label}</th>)}
                {hasActionCol && <th style={{ width: 160 }}></th>}
                {deletable && <th style={{ width: 80 }}></th>}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => {
                const rowId  = row[idKey] || String(i)
                const expKey = `${rowId}:${i}`
                const isOpen = expanded[expKey]
                return (
                  <React.Fragment key={i}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => toggle(expKey)}>
                      <td style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'center', userSelect: 'none' }}>
                        {isOpen ? '▾' : '▸'}
                      </td>
                      {tableColumns.map(c => (
                        <td key={c.key}><Cell col={c} value={row[c.key]} /></td>
                      ))}
                      {hasActionCol && (
                        <td onClick={e => e.stopPropagation()}>
                          {renderRowActions
                            ? renderRowActions(row, activeTabObj?.key ?? activeTab)
                            : onExecute && (
                              <button
                                className="btn btn-sm btn-primary"
                                disabled={executingId === rowId}
                                onClick={async () => {
                                  setExecutingId(rowId)
                                  await onExecute(row, activeTabObj?.key ?? activeTab)
                                  setExecutingId(null)
                                }}
                              >
                                {executingId === rowId ? '…' : '▶ Execute'}
                              </button>
                            )
                          }
                        </td>
                      )}
                      {deletable && (
                        <td onClick={e => e.stopPropagation()}>
                          {pendingDelete === rowId ? (
                            <div className="flex-gap">
                              <button
                                className="btn btn-sm btn-danger"
                                disabled={deleting === rowId}
                                onClick={() => deleteRow(rowId)}
                              >
                                {deleting === rowId ? '…' : 'Confirm'}
                              </button>
                              <button
                                className="btn btn-sm"
                                onClick={() => setPendingDelete(null)}
                              >Cancel</button>
                            </div>
                          ) : (
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() => setPendingDelete(rowId)}
                            >Delete</button>
                          )}
                        </td>
                      )}
                    </tr>
                    {isOpen && (
                      <>
                        <DetailRow row={row} colSpan={colCount} allColumns={columns} />
                        {renderRowDetail && (() => {
                          const extra = renderRowDetail(row, activeTabObj?.key ?? activeTab)
                          return extra ? (
                            <tr>
                              <td colSpan={colCount} style={{ background: 'var(--surface2)', padding: '0 16px 12px 32px', borderTop: '1px solid var(--border)' }}>
                                {extra}
                              </td>
                            </tr>
                          ) : null
                        })()}
                      </>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateModal
          title={title}
          fields={createFields}
          onClose={(refresh) => { setShowCreate(false); if (refresh) load() }}
          onSubmit={triggerRun}
        />
      )}
    </div>
  )
}
