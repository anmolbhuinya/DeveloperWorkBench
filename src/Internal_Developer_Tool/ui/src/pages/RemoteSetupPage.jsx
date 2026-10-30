import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import WorkflowBackButton from '../components/WorkflowBackButton'

const RS_REFRESH_KEY  = 'rs_auto_refresh_ms'
const RS_REFRESH_OPTS = [
  { label: 'Off',    value: 0        },
  { label: '5 min',  value: 300000   },
  { label: '10 min', value: 600000   },
  { label: '15 min', value: 900000   },
  { label: '20 min', value: 1200000  },
  { label: '30 min', value: 1800000  },
  { label: '1 hr',   value: 3600000  },
]

const PARAM_GROUPS = [
  { label: 'Connection',  keys: ['VM_IP', 'VM_USER', 'VM_PASSWORD'] },
  {
    label: 'Versions',
    tabs: [
      { label: 'Release Branch', keys: ['DEV_TOOLS_VERSION', 'PAYOR_VERSION', 'CLASSIC_VERSION', 'CONNECTOR_VERSION', 'ENROLLMENT_VERSION', 'REST_ADAPTOR_VERSION', 'PAYER_UI_REACT_VERSION'] },
      { label: 'Feature Branches',    keys: ['DEV_TOOLS_FEATURE_BRANCH', 'PAYOR_FEATURE_BRANCH', 'CLASSIC_FEATURE_BRANCH', 'CONNECTOR_FEATURE_BRANCH', 'ENROLLMENT_FEATURE_BRANCH'] },
    ],
  },
  { label: 'Run Options', keys: ['RUN_ALL', 'RUN_DEV_TOOLS', 'RUN_PAYOR', 'RUN_CLASSIC', 'RUN_CONNECTOR', 'RUN_ENROLLMENT', 'RUN_REST_ADAPTOR', 'RUN_PAYER_UI', 'CREATE_OLTP_SCHEMA', 'CLEAR_CACHE', 'RUN_WITHOUT_BUILD', 'NBLD_REPOS'] },
  { label: 'Upgrade',     keys: ['RUN_UPGRADE', 'CUSTOMER_NAME', 'SOURCE_PAYER_VERSION', 'SOURCE_PAYER_FEATURE_BRANCH', 'TARGET_PAYER_VERSION', 'TARGET_PAYER_FEATURE_BRANCH', 'UPGRADE_RESUME_STEP'] },
]

const BACK_LABELS = { '/workflow-projects': 'Workflow Projects', '/manage-dev-vms': 'Manage Developer VMs' }

const ELIGIBLE_STATUSES = new Set(['triggered', 'queued', 'building', 'running', 'in progress'])

function fmtEta(seconds) {
  if (seconds == null) return null
  if (seconds < 0) {
    // Negative = elapsed time (no Jenkins estimation available)
    const e = -seconds
    const h = Math.floor(e / 3600)
    const m = Math.floor((e % 3600) / 60)
    const s = e % 60
    if (h > 0) return `+${h}h ${m}m`
    if (m > 0) return `+${m}m ${s}s`
    return `+${s}s`
  }
  if (seconds === 0) return 'finishing…'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

const COLOR_CLASS = { yellow: 'badge-yellow', orange: 'badge-orange', green: 'badge-success', red: 'badge-danger', gray: 'badge-pending' }

function StatusBadge({ value, statusMap }) {
  if (!value) return <span style={{ color: 'var(--text-muted)' }}>—</span>
  const entry = statusMap
    ? statusMap[value] || statusMap[value.toLowerCase()] || statusMap[value.toUpperCase()]
    : null
  const colorName  = entry?.color || 'yellow'
  const badgeCls   = COLOR_CLASS[colorName] || 'badge-yellow'
  return <span className={`badge ${badgeCls}`}>{value}</span>
}

const HIDDEN_IF_RUN_ALL    = new Set(['RUN_PAYOR', 'RUN_CLASSIC', 'RUN_CONNECTOR', 'RUN_ENROLLMENT'])
const HIDDEN_IF_NO_UPGRADE = new Set(['CUSTOMER_NAME', 'SOURCE_PAYER_VERSION', 'SOURCE_PAYER_FEATURE_BRANCH', 'TARGET_PAYER_VERSION', 'TARGET_PAYER_FEATURE_BRANCH', 'UPGRADE_RESUME_STEP'])

function ParamEditor({ pid, initialParams, paramDefs, onSave, onTrigger, onCollapse, readOnly = false }) {
  const [vals,       setVals]       = useState(() => ({ ...initialParams }))
  const [busy,       setBusy]       = useState(false)
  const [saved,      setSaved]      = useState(false)
  const [trigErr,    setTrigErr]    = useState('')
  const [triggered,  setTriggered]  = useState(false)
  const [grpTabs,    setGrpTabs]    = useState({})
  const lastSavedRef = useRef({ ...initialParams })
  const isDirty = JSON.stringify(vals) !== JSON.stringify(lastSavedRef.current)

  // Auto-fill VM_PASSWORD from secrets if not set
  useEffect(() => {
    fetch('/api/secrets')
      .then(r => r.json())
      .then(d => {
        const pw = (d.secrets || []).find(s => (s.key || '').toLowerCase() === 'vm_password')
        if (pw?.value) setVals(p => p['VM_PASSWORD'] ? p : { ...p, VM_PASSWORD: pw.value })
      })
      .catch(() => {})
  }, [])

  const defMap = {}
  paramDefs.forEach(d => { defMap[d.key] = d })

  const isBool    = (key) => (defMap[key]?.type || '').toLowerCase().includes('boolean')
  const isPass    = (key) => (defMap[key]?.type || '').toLowerCase().includes('password')
  const runAll    = String(vals['RUN_ALL']    || '').toLowerCase() === 'true'
  const runUpgrade = String(vals['RUN_UPGRADE'] || '').toLowerCase() === 'true'

  const isVisible = (key) => {
    if (runAll    && HIDDEN_IF_RUN_ALL.has(key))    return false
    if (!runUpgrade && HIDDEN_IF_NO_UPGRADE.has(key)) return false
    return true
  }

  const save = async () => {
    setBusy(true)
    await onSave(pid, vals)
    lastSavedRef.current = { ...vals }
    setSaved(true); setTimeout(() => setSaved(false), 2000)
    setBusy(false)
  }

  const trigger = async () => {
    setTrigErr('')
    setBusy(true)
    const res = await onTrigger(pid)
    if (res.ok) {
      setTriggered(true)
      setTimeout(() => onCollapse && onCollapse(), 1200)
    } else {
      setTrigErr(res.error || 'Trigger failed.')
    }
    setBusy(false)
  }

  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: 'var(--text)' }}>
        Jenkins Parameters
        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 10 }}>
          {readOnly ? '(read only)' : '(review & edit before triggering)'}
        </span>
      </div>

      {PARAM_GROUPS.map(grp => {
        const tabStyle = (active) => ({
          padding: '5px 14px', fontSize: 12,
          fontWeight: active ? 600 : 400,
          color: active ? 'var(--primary)' : 'var(--text-muted)',
          background: 'none', border: 'none',
          borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
          cursor: 'pointer', marginBottom: -1,
        })

        let activeKeys
        if (grp.tabs) {
          const activeTabIdx = grpTabs[grp.label] || 0
          activeKeys = grp.tabs[activeTabIdx].keys.filter(k => (k in defMap || k in vals) && isVisible(k))
        } else {
          activeKeys = (grp.keys || []).filter(k => (k in defMap || k in vals) && isVisible(k))
        }
        const hasContent = grp.tabs
          ? grp.tabs.some(t => t.keys.some(k => (k in defMap || k in vals) && isVisible(k)))
          : activeKeys.length > 0
        if (!hasContent) return null

        return (
          <div key={grp.label} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.6px', color: 'var(--text-muted)', marginBottom: 8 }}>
              {grp.label}
            </div>

            {grp.tabs && (
              <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 10 }}>
                {grp.tabs.map((t, i) => (
                  <button key={t.label} style={tabStyle((grpTabs[grp.label] || 0) === i)}
                    onClick={() => setGrpTabs(p => ({ ...p, [grp.label]: i }))}>
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            <div className="table-wrap" style={{ marginBottom: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 220 }}>Parameter</th>
                    <th style={{ width: 220 }}>Value</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {activeKeys.map(key => {
                    const def  = defMap[key] || {}
                    const val  = vals[key] ?? def.default ?? ''
                    const bool = isBool(key)
                    const pass = isPass(key)
                    return (
                      <tr key={key}>
                        <td className="mono" style={{ fontSize: 12, fontWeight: 500 }}>{key}</td>
                        <td>
                          {bool ? (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: readOnly ? 'default' : 'pointer' }}>
                              <input type="checkbox"
                                checked={String(val).toLowerCase() === 'true'}
                                onChange={readOnly ? undefined : e => setVals(p => ({ ...p, [key]: String(e.target.checked) }))}
                                disabled={readOnly}
                              />
                              <span style={{ fontSize: 12 }}>{String(val).toLowerCase() === 'true' ? 'True' : 'False'}</span>
                            </label>
                          ) : (
                            <input
                              type={pass ? 'password' : 'text'}
                              value={val}
                              onChange={readOnly ? undefined : e => setVals(p => ({ ...p, [key]: e.target.value }))}
                              readOnly={readOnly}
                              style={{ maxWidth: 200, fontSize: 12, background: readOnly ? 'var(--surface2)' : undefined, cursor: readOnly ? 'default' : undefined }}
                              placeholder={def.default || ''}
                            />
                          )}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{def.description || ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {trigErr && <div className="alert alert-error" style={{ marginBottom: 8 }}>{trigErr}</div>}
      {triggered && <div className="alert alert-info" style={{ marginBottom: 8 }}>✓ Run triggered. Status updated to "triggered".</div>}

      {!readOnly && <div className="flex-gap" style={{ marginTop: 8 }}>
        <button className="btn btn-sm btn-primary" onClick={save} disabled={busy || !isDirty}>
          {busy && !triggered ? 'Saving…' : saved ? '✓ Saved' : 'Save Params'}
        </button>
        <button
          className="btn btn-sm"
          style={{ background: isDirty ? 'var(--text-muted)' : 'var(--success)', color: '#fff', border: 'none', cursor: isDirty ? 'not-allowed' : 'pointer' }}
          onClick={trigger}
          disabled={busy || triggered || isDirty}
          title={isDirty ? 'Save params before triggering' : ''}
        >
          {triggered ? '✓ Triggered' : '▶ Trigger Run'}
        </button>
        {isDirty && !triggered && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
            Save params before triggering
          </span>
        )}
      </div>}

    </div>
  )
}

const LOGS_PAGE_SIZE = 10

function ProjectDetail({ row, params, paramDefs, statusMap, onSave, etaSeconds }) {
  const [showParams,   setShowParams]   = useState(false)
  const [showLogs,     setShowLogs]     = useState(false)
  const [logs,         setLogs]         = useState(null)   // null = not loaded
  const [paramCols,    setParamCols]    = useState([])
  const [logsPage,     setLogsPage]     = useState(1)
  const [logsLoading,  setLogsLoading]  = useState(false)
  const [logsError,    setLogsError]    = useState('')

  const etaStr = fmtEta(etaSeconds)

  const detailFields = [
    { label: 'PID',         value: row.pid },
    { label: 'VM Name',     value: row.vm_name },
    { label: 'IP Address',  value: row.vm_ip || params['VM_IP'] },
    { label: 'Status',      value: row.status, isStatus: true },
    ...(etaStr ? [{ label: 'ETA', value: etaStr, isEta: true }] : []),
    { label: 'Timestamp',   value: (row.timestamp || row.created_at || '').slice(0, 19) },
    { label: 'Jenkins URL', value: row.jenkins_url, isLink: true },
    { label: 'Queue URL',   value: row.queue_url,   isLink: true },
  ].filter(f => f.value)

  function fetchLogs() {
    setLogsLoading(true); setLogsError('')
    fetch(`/api/tools/remote-setup/projects/${row.pid}/server-logs`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setLogs(d.logs || [])
          setParamCols(d.param_cols || [])
          setLogsPage(1)
        } else {
          setLogsError(d.error || 'Failed to load logs')
        }
        setLogsLoading(false)
      })
      .catch(() => { setLogsError('Network error'); setLogsLoading(false) })
  }

  function toggleLogs() {
    const next = !showLogs
    setShowLogs(next)
    if (next && logs === null) fetchLogs()
  }

  const logTotalPages = logs ? Math.max(1, Math.ceil(logs.length / LOGS_PAGE_SIZE)) : 1
  const logPageRows   = logs ? logs.slice((logsPage - 1) * LOGS_PAGE_SIZE, logsPage * LOGS_PAGE_SIZE) : []
  const STD_COLS      = ['pid', 'timestamp', 'vm_name', 'vm_ip', 'status', 'queue_url']
  const logCols       = ['timestamp', 'status', 'vm_name', 'vm_ip', ...paramCols, 'queue_url']

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text)' }}>
        Project Details
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '10px 28px', marginBottom: 18 }}>
        {detailFields.map(f => (
          <div key={f.label}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: 3 }}>{f.label}</div>
            {f.isStatus
              ? <StatusBadge value={f.value} statusMap={statusMap} />
              : f.isEta
              ? <div className="mono" style={{ fontSize: 12, color: 'var(--warning)' }}>{f.value}</div>
              : f.isLink
              ? <a href={f.value} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>↗ {f.value.slice(0, 60)}{f.value.length > 60 ? '…' : ''}</a>
              : <div className="mono" style={{ fontSize: 12, color: 'var(--text)', wordBreak: 'break-all' }}>{f.value}</div>
            }
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: showParams || showLogs ? 14 : 0 }}>
        <button className="btn btn-sm" onClick={() => setShowParams(p => !p)}>
          {showParams ? '▾ Hide' : '▸ View'} Katalon Parameters
        </button>
        {row.config_file && (
          <button className="btn btn-sm" onClick={toggleLogs}>
            {showLogs ? '▾ Hide' : '▸'} Server Setup Logs
          </button>
        )}
      </div>

      {showParams && (
        <div style={{ marginTop: 14 }}>
          <ParamEditor
            pid={row.pid}
            initialParams={params}
            paramDefs={paramDefs}
            onSave={onSave}
            readOnly
          />
        </div>
      )}

      {showLogs && (
        <div style={{ marginTop: 14 }}>
          {logsLoading && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading logs…</div>}
          {logsError   && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{logsError}</div>}
          {!logsLoading && !logsError && logs !== null && (
            <>
              {logs.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No setup runs recorded yet.</div>
                : <>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr>
                            {logCols.map(c => (
                              <th key={c} style={{ textAlign: 'left', padding: '5px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
                                {c.replace(/_/g, ' ')}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {logPageRows.map((r, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                              {logCols.map(c => (
                                <td key={c} style={{ padding: '5px 10px', color: 'var(--text)', whiteSpace: c === 'queue_url' ? 'nowrap' : 'normal', maxWidth: c === 'queue_url' ? 220 : undefined, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {c === 'queue_url' && r[c]
                                    ? <a href={r[c]} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 11 }}>↗ {r[c].slice(0, 40)}{r[c].length > 40 ? '…' : ''}</a>
                                    : c === 'status'
                                    ? <StatusBadge value={r[c]} statusMap={statusMap} />
                                    : <span className="mono">{r[c] || '—'}</span>
                                  }
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {logTotalPages > 1 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12 }}>
                        <button className="btn btn-sm" onClick={() => setLogsPage(p => Math.max(1, p - 1))} disabled={logsPage === 1}>‹ Prev</button>
                        <span style={{ color: 'var(--text-muted)' }}>Page {logsPage} / {logTotalPages}</span>
                        <button className="btn btn-sm" onClick={() => setLogsPage(p => Math.min(logTotalPages, p + 1))} disabled={logsPage === logTotalPages}>Next ›</button>
                      </div>
                    )}
                  </>
              }
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function RemoteSetupPage() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const backPath  = location.state?.backPath || '/workflow-projects'
  const backLabel = BACK_LABELS[backPath] || 'Back'

  const [rows,         setRows]         = useState([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState('')
  const [expanded,     setExpanded]     = useState({})
  const [pendingDelete,setPendingDelete] = useState(null)
  const [deleting,     setDeleting]     = useState(null)
  const [showCreate,   setShowCreate]   = useState(false)
  const [newVm,        setNewVm]        = useState('')
  const [creating,     setCreating]     = useState(false)
  const [createErr,    setCreateErr]    = useState('')
  const [vmOptions,    setVmOptions]    = useState([])   // [{value, label, ip}]
  const [paramDefs,    setParamDefs]    = useState([])
  const [statusMap,    setStatusMap]    = useState(null) // {status: {color, description}}
  const [etaMap,       setEtaMap]       = useState({})   // {pid: seconds | null}
  const [liveStatus,   setLiveStatus]   = useState({})   // {pid: status} — overrides xlsx value after Jenkins refresh
  const [refreshingPids, setRefreshingPids] = useState(new Set())
  const [page,           setPage]           = useState(1)
  const [autoRefreshMs,  setAutoRefreshMs]  = useState(
    () => Number(localStorage.getItem(RS_REFRESH_KEY) ?? 0)
  )
  const autoRefreshRef = useRef(null)
  const PAGE_SIZE = 10
  const [showScheduler,    setShowScheduler]    = useState(false)
  const [schedSettings,    setSchedSettings]    = useState([])
  const [schedSaving,      setSchedSaving]      = useState(false)
  const [schedSaved,       setSchedSaved]       = useState(false)
  const [schedErr,         setSchedErr]         = useState('')

  const loadSchedulerSettings = () => {
    fetch('/api/tools/remote-setup/scheduler-settings')
      .then(r => r.json())
      .then(d => { if (d.ok && d.settings) setSchedSettings(d.settings) })
      .catch(() => {})
  }

  const saveSchedulerSettings = async () => {
    setSchedSaving(true); setSchedSaved(false); setSchedErr('')
    try {
      const updates = {}
      schedSettings.forEach(s => { updates[s.key] = s.value })
      const r = await fetch('/api/tools/remote-setup/scheduler-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: updates }),
      })
      const d = await r.json()
      if (d.ok) { setSchedSaved(true); loadSchedulerSettings() }
      else setSchedErr(d.error || 'Failed to save')
    } catch { setSchedErr('Network error') }
    finally { setSchedSaving(false) }
  }

  const load = useCallback(() => {
    setLoading(true); setError('')
    fetch('/api/tools/remote-setup/projects')
      .then(r => r.json())
      .then(d => {
        const projects = Array.isArray(d) ? d : []
        setRows(projects)
        setLoading(false)
        setPage(1)
        // Seed etaMap from cached values — don't overwrite fresher values already in state
        setEtaMap(prev => {
          const next = { ...prev }
          projects.forEach(p => {
            const key = String(p.pid)
            if (p.eta_seconds != null && !(key in next)) {
              next[key] = p.eta_seconds
            }
          })
          return next
        })
        // Clear liveStatus for projects whose xlsx status is now terminal — the build finished
        // and xlsx is the source of truth; stale liveStatus would otherwise keep showing "Running"
        setLiveStatus(prev => {
          const next = { ...prev }
          projects.forEach(p => {
            const key = String(p.pid)
            if (key in next && !ELIGIBLE_STATUSES.has((p.status || '').toLowerCase())) {
              delete next[key]
            }
          })
          return next
        })
      })
      .catch(() => { setError('Failed to load.'); setLoading(false) })
  }, [])

  // Sync auto-refresh selection to server (persists to scheduler_config.xlsx)
  useEffect(() => {
    localStorage.setItem(RS_REFRESH_KEY, String(autoRefreshMs))
    fetch('/api/tools/remote-setup/poll-interval', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_ms: autoRefreshMs }),
    }).catch(() => {})
  }, [autoRefreshMs])

  useEffect(() => { loadSchedulerSettings() }, [])

  // Auto-refresh project list
  useEffect(() => {
    clearInterval(autoRefreshRef.current)
    if (autoRefreshMs > 0) autoRefreshRef.current = setInterval(load, autoRefreshMs)
    return () => clearInterval(autoRefreshRef.current)
  }, [autoRefreshMs, load])

  useEffect(() => {
    load()
    fetch('/api/tools/remote-setup/vms')
      .then(r => r.json())
      .then(d => {
        if (!Array.isArray(d)) return
        setVmOptions(d.filter(v => v.name).map(v => {
          const parts = [v.name]
          if (v.ip)          parts.push(`(${v.ip})`)
          if (v.assigned_to) parts.push(`- ${v.assigned_to}`)
          return { value: v.name, label: parts.join(' '), ip: v.ip }
        }))
      })
      .catch(() => {})
    fetch('/api/tools/remote-setup/params')
      .then(r => r.json())
      .then(d => setParamDefs(Array.isArray(d) ? d : []))
      .catch(() => {})
    fetch('/api/jenkins-status')
      .then(r => r.json())
      .then(d => {
        if (!Array.isArray(d)) return
        const map = {}
        d.forEach(e => { if (e.status) map[e.status] = e })
        setStatusMap(map)
      })
      .catch(() => {})
  }, [load])

  const refreshStatus = useCallback(async (pid) => {
    setRefreshingPids(s => new Set([...s, pid]))
    try {
      const r = await fetch(`/api/tools/remote-setup/projects/${pid}/status`)
      const d = await r.json()
      if (d.ok) {
        // Store live status in a separate map so load() reloading xlsx can't overwrite it
        setLiveStatus(m => ({ ...m, [String(pid)]: d.status }))
        if (d.jenkins_url || d.queue_url) {
          setRows(prev => prev.map(row => {
            if (String(row.pid) !== String(pid)) return row
            const updates = {}
            if (d.jenkins_url) updates.jenkins_url = d.jenkins_url
            if (d.queue_url)   updates.queue_url   = d.queue_url
            return { ...row, ...updates }
          }))
        }
        setEtaMap(m => ({ ...m, [String(pid)]: d.eta_seconds ?? null }))
      }
    } catch { /* ignore */ }
    setRefreshingPids(s => { const n = new Set(s); n.delete(pid); return n })
  }, [])

  const toggle = useCallback((pid, currentStatus) => {
    const eligible = ELIGIBLE_STATUSES.has((currentStatus || '').toLowerCase())
    if (eligible) refreshStatus(pid)
    setExpanded(e => ({ ...e, [pid]: !e[pid] }))
  }, [refreshStatus])

  const createProject = async () => {
    if (!newVm) { setCreateErr('Please select a VM.'); return }
    setCreating(true); setCreateErr('')
    try {
      const r = await fetch('/api/tools/remote-setup/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vm_name: newVm }),
      })
      const d = await r.json()
      if (d.ok) { setShowCreate(false); setNewVm(''); load() }
      else setCreateErr(d.error || 'Failed to create project.')
    } catch { setCreateErr('Request failed.') }
    setCreating(false)
  }

  const deleteProject = async (pid) => {
    setDeleting(pid)
    try {
      await fetch(`/api/tools/remote-setup/projects/${encodeURIComponent(pid)}`, { method: 'DELETE' })
      load()
    } catch { /* ignore */ }
    setDeleting(null); setPendingDelete(null)
  }

  const saveParams = async (pid, params) => {
    await fetch(`/api/tools/remote-setup/projects/${pid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params }),
    })
    setRows(prev => prev.map(r =>
      String(r.pid) === String(pid) ? { ...r, params_json: JSON.stringify(params) } : r
    ))
  }

  const triggerRun = async (pid) => {
    try {
      const r = await fetch(`/api/tools/remote-setup/projects/${pid}/trigger`, { method: 'POST' })
      const d = await r.json()
      if (d.ok) {
        setRows(prev => prev.map(r => String(r.pid) === String(pid) ? { ...r, status: 'triggered' } : r))
      }
      return d
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }

  const sorted    = [...rows].sort((a, b) => Number(b.pid) - Number(a.pid))
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const pageRows   = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <div>
      <button className="btn back-link" onClick={() => navigate(backPath)}
        style={{ marginBottom: 16, fontSize: 12, padding: '4px 10px' }}>
        ← {backLabel}
      </button>
      <WorkflowBackButton />

      <div className="page-header">
        <h1 className="page-title">Remote VM Setup</h1>
        <div className="flex-gap" style={{ alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Auto-refresh:</span>
          <select
            value={autoRefreshMs}
            onChange={e => setAutoRefreshMs(Number(e.target.value))}
            style={{ fontSize: 11, padding: '2px 5px', borderRadius: 5,
                     border: '1px solid var(--border)', background: 'var(--surface)',
                     color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            {RS_REFRESH_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="btn btn-primary" onClick={() => { setShowCreate(true); setCreateErr(''); setNewVm('') }}>
            + New Run
          </button>
          <button className="btn" onClick={() => {
            load()
            pageRows.filter(r => ELIGIBLE_STATUSES.has((r.status || '').toLowerCase()))
                    .forEach(r => refreshStatus(r.pid))
          }} disabled={loading}>↺ Refresh</button>
          <button className="btn" onClick={() => { setShowScheduler(v => !v); setSchedSaved(false); setSchedErr('') }}
            title="Scheduler settings (poll timeout, stale threshold)"
            style={{ fontSize: 12, padding: '5px 12px' }}>
            ⏱ Scheduler
          </button>
        </div>
      </div>

      {showScheduler && (
        <div style={{ margin: '0 0 16px 0', padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Scheduler Settings</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(applies to all Remote VM Setup runs)</span>
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

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="center"><span className="spinner" /></div>
      ) : sorted.length === 0 ? (
        <div className="empty">
          <h3>No projects yet</h3>
          <p>Click <strong>+ New Run</strong> to create your first Remote VM Setup project.</p>
        </div>
      ) : (
        <>
        <div className="table-wrap" style={{ borderBottom: totalPages > 1 ? 'none' : undefined }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>PID</th>
                <th>VM Name</th>
                <th>IP</th>
                <th>Owner</th>
                <th>Status</th>
                <th>ETA</th>
                <th>Created At</th>
                <th>Jenkins</th>
                <th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(row => {
                const isOpen     = expanded[row.pid]
                const rowStatus  = liveStatus[String(row.pid)] ?? row.status
                let params = {}
                try { params = JSON.parse(row.params_json || '{}') } catch { /* ignore */ }
                const ownerEntry = vmOptions.find(v => v.value === row.vm_name)
                const ownerRaw   = ownerEntry
                  ? (ownerEntry.label.split('- ')[1] || '').trim()
                  : ''
                return (
                  <React.Fragment key={row.pid}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => toggle(row.pid, rowStatus)}>
                      <td style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'center', userSelect: 'none' }}>
                        {isOpen ? '▾' : '▸'}
                      </td>
                      <td><strong>{row.pid}</strong></td>
                      <td style={{ fontWeight: 500, color: 'var(--primary)' }}>{row.vm_name || '—'}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{row.vm_ip || params['VM_IP'] || '—'}</td>
                      <td style={{ fontSize: 13 }}>{ownerRaw || '—'}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <StatusBadge value={rowStatus} statusMap={statusMap} />
                          {refreshingPids.has(row.pid) && <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />}
                        </div>
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {(() => {
                          const v = etaMap[String(row.pid)]
                          const s = fmtEta(v)
                          if (!s) return <span style={{ color: 'var(--text-muted)' }}>—</span>
                          const elapsed = typeof v === 'number' && v < 0
                          return <span style={{ color: elapsed ? 'var(--text-muted)' : 'var(--warning)' }}>{s}</span>
                        })()}
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>{(row.timestamp || row.created_at || '').slice(0, 16)}</td>
                      <td>{row.jenkins_url
                        ? <a href={row.jenkins_url} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 12 }} onClick={e => e.stopPropagation()}>↗ open</a>
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        {pendingDelete === row.pid ? (
                          <div className="flex-gap">
                            <button className="btn btn-sm btn-danger" disabled={deleting === row.pid}
                              onClick={() => deleteProject(row.pid)}>
                              {deleting === row.pid ? '…' : 'Confirm'}
                            </button>
                            <button className="btn btn-sm" onClick={() => setPendingDelete(null)}>Cancel</button>
                          </div>
                        ) : (
                          <button className="btn btn-sm btn-danger" onClick={() => setPendingDelete(row.pid)}>
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={10} style={{ background: 'var(--surface2)', padding: '16px 20px 16px 32px' }}>
                          {(rowStatus || '').toLowerCase() === 'pending'
                            ? <ParamEditor
                                pid={row.pid}
                                initialParams={params}
                                paramDefs={paramDefs}
                                onSave={saveParams}
                                onTrigger={triggerRun}
                                onCollapse={() => setExpanded(e => ({ ...e, [row.pid]: false }))}
                              />
                            : <ProjectDetail
                                row={{ ...row, status: rowStatus }}
                                params={params}
                                paramDefs={paramDefs}
                                statusMap={statusMap}
                                onSave={saveParams}
                                etaSeconds={etaMap[String(row.pid)] ?? null}
                              />
                          }
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px',
            border: '1px solid var(--border)', borderTop: 'none',
            borderRadius: '0 0 8px 8px',
            background: 'var(--surface)',
          }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, sorted.length)} of {sorted.length}
            </span>
            <div className="flex-gap" style={{ gap: 4 }}>
              <button className="btn btn-sm" onClick={() => setPage(1)} disabled={safePage === 1}>«</button>
              <button className="btn btn-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>‹</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                .reduce((acc, p, idx, arr) => {
                  if (idx > 0 && arr[idx - 1] !== p - 1)
                    acc.push(<span key={`ellipsis-${p}`} style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 4px' }}>…</span>)
                  acc.push(
                    <button key={p} className={`btn btn-sm${safePage === p ? ' btn-primary' : ''}`}
                      onClick={() => setPage(p)} style={{ minWidth: 30 }}>
                      {p}
                    </button>
                  )
                  return acc
                }, [])}
              <button className="btn btn-sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>›</button>
              <button className="btn btn-sm" onClick={() => setPage(totalPages)} disabled={safePage === totalPages}>»</button>
            </div>
          </div>
        )}
        </>
      )}

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <span className="modal-title">New Run — Remote VM Setup</span>
              <button className="modal-close" onClick={() => setShowCreate(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="field-label">Select VM *</label>
                {vmOptions.length > 0 ? (
                  <select
                    value={newVm}
                    onChange={e => setNewVm(e.target.value)}
                    autoFocus
                    style={{
                      width: '100%', maxWidth: 380, padding: '8px 12px',
                      background: 'var(--surface)', border: '1px solid var(--border)',
                      borderRadius: 6, color: 'var(--text)', fontSize: 14, fontFamily: 'inherit',
                    }}
                  >
                    <option value="">— choose a VM —</option>
                    {vmOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input type="text" placeholder="e.g. haeng-haproxy2" autoFocus
                    value={newVm} onChange={e => setNewVm(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && createProject()} />
                )}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>
                Default Jenkins parameters will be pre-filled from katalon_params.xlsx. You can review and edit them before triggering the run.
              </p>
              {createErr && <div className="alert alert-error" style={{ marginTop: 10 }}>{createErr}</div>}
              <div className="flex-gap" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="btn" onClick={() => setShowCreate(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={createProject} disabled={creating || !newVm}>
                  {creating ? 'Creating…' : 'Create Project'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
