import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import WorkflowBackButton from '../components/WorkflowBackButton'

const PAGE_SIZE = 10
const TERMINAL  = new Set(['success', 'passed', 'failure', 'failed', 'aborted', 'trigger failed', 'unstable'])
const ETAS_KEY  = 'jreg_project_etas'

const APP_KEY = 'jreg_active_app'

function _loadEtas(app) {
  try { return JSON.parse(localStorage.getItem(ETAS_KEY) || '{}')[app] || {} }
  catch { return {} }
}
function _saveEtas(app, etas) {
  try {
    const all = JSON.parse(localStorage.getItem(ETAS_KEY) || '{}')
    all[app] = etas
    localStorage.setItem(ETAS_KEY, JSON.stringify(all))
  } catch {}
}

function fmtEta(sec) {
  if (!sec || sec <= 0) return 'soon'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function isActive(status) {
  const v = (status || '').toLowerCase()
  return v.includes('running') || v.includes('queued') || v.includes('triggering') || v.includes('scheduled')
}

const AUTO_REFRESH_KEY  = 'jreg_auto_refresh_ms'
const AUTO_REFRESH_OPTS = [
  { label: 'Off',    value: 0        },
  { label: '1 min',  value: 60000    },
  { label: '2 min',  value: 120000   },
  { label: '3 min',  value: 180000   },
  { label: '5 min',  value: 300000   },
  { label: '10 min', value: 600000   },
  { label: '15 min', value: 900000   },
  { label: '20 min', value: 1200000  },
  { label: '30 min', value: 1800000  },
]

const selStyle = {
  fontSize: 11, padding: '2px 5px', borderRadius: 5,
  border: '1px solid var(--border)', background: 'var(--surface)',
  color: 'var(--text-muted)', cursor: 'pointer',
}

function StatusBadge({ value }) {
  const v = (value || '').toLowerCase()
  let cls = 'badge badge-pending'
  if (['passed', 'completed', 'done', 'success'].some(s => v.includes(s)))                                cls = 'badge badge-success'
  else if (['failure', 'failed', 'error', 'timeout'].some(s => v.includes(s)))                            cls = 'badge badge-danger'
  else if (['running', 'scheduled', 'in progress', 'triggered', 'queued', 'building'].some(s => v.includes(s))) cls = 'badge badge-warning'
  else if (['skipped', 'cancelled', 'aborted'].some(s => v.includes(s)))                                  cls = 'badge badge-skipped'
  else if (v.includes('unstable') || v.includes('partial'))                                                cls = 'badge badge-warning'
  return <span className={cls}>{value || '—'}</span>
}

const _S_COLOR = {
  'success':        '#22c55e',
  'failed':         '#ef4444',
  'trigger failed': '#ef4444',
  'unstable':       '#f59e0b',
  'aborted':        '#94a3b8',
  'running':        '#3b82f6',
  'scheduled':      '#a78bfa',
}
const _PART_RE = /(\d+)\s+(trigger failed|failed|unstable|aborted|running|scheduled|success)/g

function SummaryStatus({ summary, status }) {
  if (!summary) return <StatusBadge value={status} />

  const parts = []
  let m
  _PART_RE.lastIndex = 0
  while ((m = _PART_RE.exec(summary)) !== null) {
    parts.push({ count: m[1], key: m[2] })
  }

  if (parts.length === 0) {
    const v = summary.toLowerCase()
    let cls = 'badge badge-success'
    if (v.includes('fail'))                                    cls = 'badge badge-danger'
    else if (v.includes('unstable'))                           cls = 'badge badge-warning'
    else if (v.includes('aborted'))                            cls = 'badge badge-skipped'
    else if (v.includes('running') || v.includes('scheduled')) cls = 'badge badge-warning'
    return <span className={cls}>{summary}</span>
  }

  const totalMatch = summary.match(/^(\d+)\s+jobs?/i)
  const total = totalMatch ? totalMatch[1] : null

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
      {total && (
        <span style={{
          fontSize: 10, fontWeight: 700,
          color: 'var(--text-muted, #6b7280)',
          background: 'rgba(0,0,0,0.06)',
          border: '1px solid rgba(0,0,0,0.1)',
          borderRadius: 4, padding: '1px 6px',
          whiteSpace: 'nowrap', lineHeight: 1.6,
        }}>
          {total} jobs
        </span>
      )}
      {parts.map(({ count, key }) => {
        const color = _S_COLOR[key] || '#94a3b8'
        return (
          <span key={key} style={{
            fontSize: 10, fontWeight: 700, color,
            background: `${color}1a`,
            border: `1px solid ${color}55`,
            borderRadius: 4, padding: '1px 6px',
            whiteSpace: 'nowrap', lineHeight: 1.6,
          }}>
            {count} {key}
          </span>
        )
      })}
    </div>
  )
}

function JobsTable({ pid, activeApp, onUpdate }) {
  const [jobs,     setJobs]     = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [err,      setErr]      = useState('')
  const [retrying, setRetrying] = useState({})
  const [retryErr, setRetryErr] = useState({})
  const [syncing,  setSyncing]  = useState(false)
  const [syncMsg,  setSyncMsg]  = useState('')
  const pollRef     = useRef(null)
  const onUpdateRef = useRef(onUpdate)
  useEffect(() => { onUpdateRef.current = onUpdate }, [onUpdate])

  const fetchJobs = useCallback(() => {
    fetch(`/api/tools/jreg/projects/${encodeURIComponent(pid)}/jobs?app=${encodeURIComponent(activeApp)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        const arr = Array.isArray(d) ? d : []
        setJobs(arr)
        setLoading(false)
        if (onUpdateRef.current) onUpdateRef.current(arr)
      })
      .catch(() => { setErr('Failed to load job details.'); setLoading(false) })
  }, [pid, activeApp])

  useEffect(() => { fetchJobs() }, [fetchJobs])

  // auto-poll while any job is active
  useEffect(() => {
    clearInterval(pollRef.current)
    if (!jobs) return
    const hasActive = jobs.some(j => isActive(j.completed))
    if (hasActive) pollRef.current = setInterval(fetchJobs, 30000)
    return () => clearInterval(pollRef.current)
  }, [jobs, fetchJobs])

  async function retriggerJob(jobName) {
    setRetrying(prev => ({ ...prev, [jobName]: true }))
    setRetryErr(prev => ({ ...prev, [jobName]: '' }))
    try {
      const r = await fetch(`/api/tools/jreg/projects/${encodeURIComponent(pid)}/retrigger-job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_name: jobName, app: activeApp }),
      })
      const d = await r.json()
      if (d.ok) {
        setJobs(prev => prev.map(j =>
          j.job_name === jobName ? { ...j, completed: d.status || 'Scheduled', queue_url: d.queue_url || '', build_url: '' } : j
        ))
      } else {
        setRetryErr(prev => ({ ...prev, [jobName]: d.error || 'Retrigger failed' }))
      }
    } catch {
      setRetryErr(prev => ({ ...prev, [jobName]: 'Request failed' }))
    }
    setRetrying(prev => ({ ...prev, [jobName]: false }))
  }

  async function syncFromJenkins() {
    setSyncing(true)
    setSyncMsg('')
    try {
      const r = await fetch(`/api/tools/jreg/projects/${encodeURIComponent(pid)}/sync-from-jenkins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: activeApp }),
      })
      const d = await r.json()
      if (d.ok) {
        const n = (d.updated || []).length
        setSyncMsg(n > 0 ? `Synced ${n} job${n !== 1 ? 's' : ''}` : 'No new builds found')
        if (n > 0) fetchJobs()
      } else {
        setSyncMsg(d.error || 'Sync failed')
      }
    } catch {
      setSyncMsg('Request failed')
    }
    setSyncing(false)
  }

  if (loading) return <div style={{ padding: '8px 0' }}><span className="spinner" style={{ width: 14, height: 14 }} /></div>
  if (err)     return <div style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</div>
  if (!jobs || jobs.length === 0)
    return <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No job details found for this project.</div>

  const hasScheduled = jobs.some(j => (j.completed || '').toLowerCase() === 'scheduled' && !j.build_url)

  return (
    <>
    {hasScheduled && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <button
          className="btn btn-sm"
          onClick={syncFromJenkins}
          disabled={syncing}
          style={{ fontSize: 11 }}
        >
          {syncing ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Syncing…</> : '🔍 Sync from Jenkins'}
        </button>
        {syncMsg && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{syncMsg}</span>}
      </div>
    )}
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr>
          {['Job Name', 'Status', 'ETA', 'Runs', 'Triggered At', 'Build URL'].map(h => (
            <th key={h} style={{
              textAlign: 'left', padding: '4px 10px', fontWeight: 600,
              color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase',
              letterSpacing: '0.4px', borderBottom: '1px solid var(--border)',
            }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {jobs.map((job, i) => (
          <tr key={i}>
            <td style={{ padding: '5px 10px', fontFamily: 'Consolas, monospace' }}>
              {job.job_url ? (
                <a href={job.job_url} target="_blank" rel="noreferrer"
                   style={{ fontFamily: 'Consolas, monospace', color: 'var(--accent)',
                            textDecoration: 'underline', cursor: 'pointer' }}
                   onClick={e => e.stopPropagation()}>
                  {job.job_name || '—'}
                </a>
              ) : (job.job_name || '—')}
            </td>
            <td style={{ padding: '5px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <StatusBadge value={job.completed} />
                {(['fail', 'unstable'].some(k => (job.completed || '').toLowerCase().includes(k))) && (
                  retrying[job.job_name]
                    ? <span className="spinner" style={{ width: 12, height: 12 }} />
                    : <button
                        onClick={e => { e.stopPropagation(); retriggerJob(job.job_name) }}
                        title="Retrigger this job"
                        style={{
                          background: 'transparent', border: '1px solid rgba(255,165,0,0.4)',
                          borderRadius: 4, cursor: 'pointer', color: '#ff9800',
                          fontSize: 10, padding: '1px 6px', lineHeight: 1.4,
                        }}>
                        ⟳ Retry
                      </button>
                )}
                {retryErr[job.job_name] && (
                  <span style={{ fontSize: 10, color: 'var(--danger)' }}>{retryErr[job.job_name]}</span>
                )}
              </div>
            </td>
            <td style={{ padding: '5px 10px', fontFamily: 'Consolas, monospace', color: 'var(--text-muted)', fontSize: 11 }}>
              {isActive(job.completed) && job.eta_seconds ? fmtEta(parseInt(job.eta_seconds)) : '—'}
            </td>
            <td style={{ padding: '5px 10px', fontFamily: 'Consolas, monospace' }}>{job.runs || '—'}</td>
            <td style={{ padding: '5px 10px', fontFamily: 'Consolas, monospace' }}>
              {(job.triggered_at || '').slice(0, 19) || '—'}
            </td>
            <td style={{ padding: '5px 10px' }}>
              {job.build_url ? (
                <a href={job.build_url} target="_blank" rel="noreferrer"
                   className="mono" style={{ fontSize: 12 }}
                   onClick={e => e.stopPropagation()}>
                  ↗ open
                </a>
              ) : job.queue_url ? (
                <a href={job.queue_url} target="_blank" rel="noreferrer"
                   className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}
                   onClick={e => e.stopPropagation()}>
                  ↗ queue
                </a>
              ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  )
}

const VERSION_PREFIX_FIELDS = [
  { key: 'payor_version_prefix',            label: 'PAYOR_VERSION_PREFIX' },
  { key: 'bluecard_config_version_prefix',  label: 'BLUECARD_CONFIG_VERSION_PREFIX' },
  { key: 'datauniverse_version_prefix',     label: 'DATAUNIVERSE_VERSION_PREFIX' },
]

function CreateModal({ onClose, onTriggered, activeApp }) {
  const isPayor = activeApp === 'Payor'
  const [form, setForm] = useState({
    payor_version: '', runs: '1',
    payor_version_prefix: '', bluecard_config_version_prefix: '', datauniverse_version_prefix: '',
  })
  const [showCfg, setShowCfg] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState('')
  const [pomHints, setPomHints] = useState({})
  const pomTimerRef = useRef(null)

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  useEffect(() => {
    const v = form.payor_version.trim()
    if (!v || !/^\d+\.\d+/.test(v)) {
      setPomHints({})
      setForm(prev => ({ ...prev, payor_version_prefix: '', bluecard_config_version_prefix: '', datauniverse_version_prefix: '' }))
      return
    }
    clearTimeout(pomTimerRef.current)
    pomTimerRef.current = setTimeout(() => {
      fetch(`/api/tools/jreg/pom-preview?version=${encodeURIComponent(v)}`)
        .then(r => r.json())
        .then(d => {
          if (d.ok) {
            const hints = d.hints || {}
            setPomHints(hints)
            setForm(prev => {
              const updated = { ...prev }
              VERSION_PREFIX_FIELDS.forEach(({ key }) => {
                if (!updated[key].trim() && hints[key]) updated[key] = hints[key]
              })
              return updated
            })
          }
        })
        .catch(() => {})
    }, 800)
    return () => clearTimeout(pomTimerRef.current)
  }, [form.payor_version])

  const submit = async () => {
    if (!form.payor_version.trim()) {
      setErr(isPayor ? 'Payor Branch Version is required.' : 'Release Version is required.')
      return
    }
    setBusy(true); setErr('')
    try {
      const body = { payor_version: form.payor_version.trim(), app: activeApp }
      if (form.runs) body.runs = form.runs
      VERSION_PREFIX_FIELDS.forEach(({ key }) => {
        if (form[key].trim()) body[key] = form[key].trim()
      })
      const r = await fetch('/api/tools/jreg/trigger', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      if (d.ok) { onTriggered(); onClose() }
      else setErr(d.error || 'Failed to trigger.')
    } catch { setErr('Request failed.') }
    setBusy(false)
  }

  const hasCfgValues = VERSION_PREFIX_FIELDS.some(({ key }) => form[key].trim())

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <span className="modal-title">New Run — Jenkins Regression ({activeApp})</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="field-label">{isPayor ? 'Payor Branch Version *' : 'Release Version *'}</label>
            <input placeholder="e.g. 26.1.1.1" value={form.payor_version}
              onChange={e => setForm(p => ({ ...p, payor_version: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && submit()} />
          </div>
          <div className="form-group">
            <label className="field-label">Runs</label>
            <input type="number" placeholder="e.g. 3" value={form.runs}
              onChange={e => setForm(p => ({ ...p, runs: e.target.value }))} />
          </div>

          {/* Version prefix configure toggle */}
          <div style={{ marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => setShowCfg(v => !v)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: showCfg ? 'rgba(88,166,255,0.1)' : 'transparent',
                border: `1px solid ${showCfg ? '#58a6ff' : 'var(--border)'}`,
                borderRadius: 5, cursor: 'pointer', padding: '4px 10px',
                color: showCfg ? '#58a6ff' : 'var(--text-muted)', fontSize: 12,
              }}
            >
              ⚙ Configure
              {hasCfgValues && !showCfg && (
                <span style={{ background: '#1565c0', color: '#fff', borderRadius: 8, fontSize: 10, padding: '0 5px', fontWeight: 700 }}>
                  {VERSION_PREFIX_FIELDS.filter(({ key }) => form[key].trim()).length}
                </span>
              )}
            </button>
          </div>

          {showCfg && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface2)', padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#58a6ff', marginBottom: 4 }}>Version Prefix Overrides</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                Leave blank to use values from pom.xml. Set to override.
              </div>
              {VERSION_PREFIX_FIELDS.map(({ key, label }) => (
                <div key={key} className="form-group" style={{ marginBottom: 8 }}>
                  <label className="field-label" style={{ fontSize: 11, fontFamily: 'monospace' }}>{label}</label>
                  <input
                    placeholder={pomHints[key] || 'blank = pom.xml default'}
                    value={form[key]}
                    onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                    style={{ fontFamily: 'monospace', fontSize: 12 }}
                  />
                </div>
              ))}
            </div>
          )}

          {err && <div className="alert alert-error">{err}</div>}
          <div className="flex-gap" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={submit} disabled={busy}>
              {busy ? 'Triggering…' : '▶ Trigger Run'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const _cfgInputStyle = { fontSize: 12, width: '100%', padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'monospace' }
const _cfgThStyle    = { textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', padding: '4px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }

function JregConfigModal({ initialApp, apps: appsProp, onAppsChanged, onClose }) {
  const [modalApps,   setModalApps]   = useState(appsProp || [])
  const [activeTab,   setActiveTab]   = useState(initialApp || (appsProp || [])[0] || '')
  const [jobsByApp,     setJobsByApp]     = useState({})
  const [repoUrlsByApp, setRepoUrlsByApp] = useState({})
  const [loadedApps,    setLoadedApps]    = useState(new Set())
  const [loadingTab,  setLoadingTab]  = useState(null)
  const [saving,      setSaving]      = useState(false)
  const [err,         setErr]         = useState('')
  const [saved,       setSaved]       = useState(false)
  // Add app via + tab
  const [showAddTab,  setShowAddTab]  = useState(false)
  const [newAppName,  setNewAppName]  = useState('')
  const [addingApp,   setAddingApp]   = useState(false)
  const [addErr,      setAddErr]      = useState('')
  // Delete app confirmation
  const [confirmDel,  setConfirmDel]  = useState(false)
  const [deletingApp, setDeletingApp] = useState(false)
  const [delErr,      setDelErr]      = useState('')
  const newAppRef = useRef(null)

  const loadApp = useCallback((a) => {
    setLoadingTab(a); setErr('')
    fetch(`/api/tools/jreg/job-config/${encodeURIComponent(a)}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setJobsByApp(prev => ({ ...prev, [a]: d.jobs || [] }))
          setRepoUrlsByApp(prev => ({ ...prev, [a]: d.repo_url || '' }))
          setLoadedApps(prev => new Set([...prev, a]))
        } else { setErr(d.error || 'Failed to load.') }
        setLoadingTab(null)
      })
      .catch(() => { setErr('Request failed.'); setLoadingTab(null) })
  }, [])

  useEffect(() => { if (activeTab) loadApp(activeTab) }, [])

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  useEffect(() => {
    if (showAddTab && newAppRef.current) newAppRef.current.focus()
  }, [showAddTab])

  const switchTab = (a) => {
    setActiveTab(a); setErr(''); setSaved(false); setConfirmDel(false); setDelErr('')
    if (!loadedApps.has(a) && loadingTab !== a) loadApp(a)
  }

  const openAddTab = () => { setShowAddTab(true); setNewAppName(''); setAddErr('') }
  const cancelAdd  = () => { setShowAddTab(false); setAddErr('') }

  const addApp = async () => {
    const name = newAppName.trim()
    if (!name) return
    if (modalApps.some(a => a.toLowerCase() === name.toLowerCase())) {
      setAddErr('An application with that name already exists.'); return
    }
    setAddingApp(true); setAddErr('')
    try {
      const r = await fetch('/api/tools/jreg/apps', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const d = await r.json()
      if (d.ok) {
        setModalApps(d.apps); onAppsChanged(d.apps)
        setShowAddTab(false); setNewAppName('')
        switchTab(name)
      } else { setAddErr(d.error || 'Failed to add.') }
    } catch { setAddErr('Request failed.') }
    setAddingApp(false)
  }

  const confirmDelete = async () => {
    setDeletingApp(true); setDelErr('')
    try {
      const r = await fetch(`/api/tools/jreg/apps/${encodeURIComponent(activeTab)}`, { method: 'DELETE' })
      const d = await r.json()
      if (d.ok) {
        setModalApps(d.apps); onAppsChanged(d.apps)
        setConfirmDel(false)
        const next = d.apps[0] || ''
        setActiveTab(next)
        if (next && !loadedApps.has(next)) loadApp(next)
      } else { setDelErr(d.error || 'Failed to delete.') }
    } catch { setDelErr('Request failed.') }
    setDeletingApp(false)
  }

  const jobs     = jobsByApp[activeTab] || []
  const isLoaded = loadedApps.has(activeTab)

  const updateJob = (i, field, val) =>
    setJobsByApp(prev => ({ ...prev, [activeTab]: prev[activeTab].map((j, idx) => idx === i ? { ...j, [field]: val } : j) }))
  const removeJob = (i) =>
    setJobsByApp(prev => ({ ...prev, [activeTab]: prev[activeTab].filter((_, idx) => idx !== i) }))
  const addJob = () =>
    setJobsByApp(prev => ({ ...prev, [activeTab]: [...(prev[activeTab] || []), { job_name: '', job_url: '', enabled: true }] }))

  const save = async () => {
    setSaving(true); setErr(''); setSaved(false)
    try {
      const r = await fetch(`/api/tools/jreg/job-config/${encodeURIComponent(activeTab)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobs: jobsByApp[activeTab] || [], repo_url: repoUrlsByApp[activeTab] || '' }),
      })
      const d = await r.json()
      if (d.ok) setSaved(true)
      else setErr(d.error || 'Save failed.')
    } catch { setErr('Request failed.') }
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 860, width: '95vw' }}>
        <div className="modal-header">
          <span className="modal-title">Configure Jobs</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {/* Tab bar with + at end */}
          <div style={{ display: 'flex', borderBottom: '2px solid var(--border)', marginBottom: 14, gap: 0, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {modalApps.map(a => (
              <button key={a} onClick={() => { cancelAdd(); switchTab(a) }}
                style={{
                  padding: '6px 14px', fontSize: 12, fontWeight: activeTab === a && !showAddTab ? 600 : 400,
                  border: 'none', borderBottom: activeTab === a && !showAddTab ? '2px solid var(--primary)' : '2px solid transparent',
                  marginBottom: -2, background: 'none', cursor: 'pointer',
                  color: activeTab === a && !showAddTab ? 'var(--primary)' : 'var(--text-muted)',
                }}>
                {a}
              </button>
            ))}
            {!showAddTab && (
              <button onClick={openAddTab}
                style={{
                  padding: '6px 10px', fontSize: 14, lineHeight: 1, fontWeight: 400,
                  border: 'none', borderBottom: '2px solid transparent', marginBottom: -2,
                  background: 'none', cursor: 'pointer', color: 'var(--text-muted)',
                }} title="Add application">
                +
              </button>
            )}
            {showAddTab && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', marginBottom: -2 }}>
                <input ref={newAppRef} value={newAppName} onChange={e => setNewAppName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addApp(); if (e.key === 'Escape') cancelAdd() }}
                  placeholder="Application name…"
                  style={{ fontSize: 12, padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', width: 160 }} />
                <button className="btn btn-sm btn-primary" onClick={addApp} disabled={addingApp || !newAppName.trim()}>
                  {addingApp ? '…' : 'Add'}
                </button>
                <button className="btn btn-sm" onClick={cancelAdd}>Cancel</button>
              </div>
            )}
          </div>
          {addErr && <div style={{ color: '#f44336', fontSize: 12, marginBottom: 10 }}>{addErr}</div>}

          {/* Tab content */}
          {loadingTab === activeTab && !showAddTab ? (
            <div className="center"><span className="spinner" /></div>
          ) : isLoaded && activeTab && !showAddTab && (
            <>
              {/* GitHub Repository URL */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>GitHub Repository URL</label>
                <input
                  value={repoUrlsByApp[activeTab] || ''}
                  onChange={e => setRepoUrlsByApp(prev => ({ ...prev, [activeTab]: e.target.value }))}
                  placeholder="https://github.com/org/repo"
                  style={{ ..._cfgInputStyle, width: '100%' }}
                />
              </div>
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ..._cfgThStyle, width: 36, textAlign: 'center' }}>On</th>
                      <th style={_cfgThStyle}>Job Name</th>
                      <th style={_cfgThStyle}>Job URL</th>
                      <th style={{ ..._cfgThStyle, width: 32 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((j, i) => {
                      const isEnabled = j.enabled !== false
                      return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)', opacity: isEnabled ? 1 : 0.45 }}>
                        <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                          <input type="checkbox" checked={isEnabled}
                            onChange={e => updateJob(i, 'enabled', e.target.checked)}
                            title={isEnabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                            style={{ cursor: 'pointer', width: 14, height: 14 }} />
                        </td>
                        <td style={{ padding: '4px 8px' }}>
                          <input value={j.job_name || ''} onChange={e => updateJob(i, 'job_name', e.target.value)}
                            style={{ ..._cfgInputStyle, minWidth: 100 }} />
                        </td>
                        <td style={{ padding: '4px 8px' }}>
                          <input value={j.job_url || ''} onChange={e => updateJob(i, 'job_url', e.target.value)}
                            style={{ ..._cfgInputStyle, minWidth: 260 }} />
                        </td>
                        <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                          <button onClick={() => removeJob(i)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger, #f44336)', fontSize: 14, lineHeight: 1, padding: '2px 4px' }}>✕</button>
                        </td>
                      </tr>
                      )
                    })}
                    {jobs.length === 0 && (
                      <tr><td colSpan={4} style={{ padding: '14px 8px', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
                        No jobs configured. Click <strong>+ Add Job</strong> to add one.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <button className="btn btn-sm" onClick={addJob} style={{ marginTop: 10 }}>+ Add Job</button>

              {/* Delete app section */}
              <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                {!confirmDel ? (
                  <button className="btn btn-sm btn-danger" onClick={() => { setConfirmDel(true); setDelErr('') }}
                    style={{ fontSize: 12 }}>
                    Delete Application
                  </button>
                ) : (
                  <div style={{ background: 'var(--surface2)', border: '1px solid var(--danger, #f44336)', borderRadius: 7, padding: '12px 14px' }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--danger, #f44336)', marginBottom: 6 }}>
                      Delete "{activeTab}"?
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
                      This will permanently delete all projects, run history, Jenkins parameters, and job configurations for <strong>{activeTab}</strong>. This action cannot be undone.
                    </div>
                    {delErr && <div style={{ color: '#f44336', fontSize: 12, marginBottom: 8 }}>{delErr}</div>}
                    <div className="flex-gap">
                      <button className="btn btn-sm btn-danger" onClick={confirmDelete} disabled={deletingApp}>
                        {deletingApp ? 'Deleting…' : 'Confirm Delete'}
                      </button>
                      <button className="btn btn-sm" onClick={() => { setConfirmDel(false); setDelErr('') }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {err && <div className="alert alert-error" style={{ marginTop: 10 }}>{err}</div>}
          {saved && <div style={{ color: '#4caf50', fontSize: 12, marginTop: 10 }}>Saved successfully.</div>}
          <div className="flex-gap" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn" onClick={onClose}>Close</button>
            {isLoaded && activeTab && !showAddTab && (
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function JregParamsModal({ app, onClose }) {
  const [jobs,       setJobs]       = useState([])
  const [activeJob,  setActiveJob]  = useState(null)
  const [editParams, setEditParams] = useState({})
  const [loading,    setLoading]    = useState(true)
  const [fetching,   setFetching]   = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [fetchOut,   setFetchOut]   = useState('')
  const [err,        setErr]        = useState('')
  const [saved,      setSaved]      = useState(false)

  const loadParams = useCallback(() => {
    setLoading(true); setErr('')
    fetch(`/api/tools/jreg/params/${encodeURIComponent(app)}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setJobs(d.jobs || [])
          const ep = {}
          for (const j of (d.jobs || [])) ep[j.job_name] = j.params ? [...j.params] : []
          setEditParams(ep)
          setActiveJob(prev => (prev && (d.jobs || []).some(j => j.job_name === prev)) ? prev : (d.jobs?.[0]?.job_name || null))
        } else {
          setErr(d.error || 'Failed to load params.')
        }
        setLoading(false)
      })
      .catch(() => { setErr('Request failed.'); setLoading(false) })
  }, [app])

  useEffect(() => { loadParams() }, [loadParams])

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const save = async () => {
    if (!activeJob) return
    setSaving(true); setErr(''); setSaved(false)
    try {
      const r = await fetch(`/api/tools/jreg/params/${encodeURIComponent(app)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_name: activeJob, params: editParams[activeJob] || [] }),
      })
      const d = await r.json()
      if (d.ok) setSaved(true)
      else setErr(d.error || 'Save failed.')
    } catch { setErr('Request failed.') }
    setSaving(false)
  }

  const fetchFromJenkins = async () => {
    setFetching(true); setFetchOut(''); setErr(''); setSaved(false)
    try {
      const r = await fetch(`/api/tools/jreg/fetch-params/${encodeURIComponent(app)}`, { method: 'POST' })
      const d = await r.json()
      setFetchOut(d.output || (d.ok ? 'Done.' : d.error || 'Failed.'))
      if (d.ok) loadParams()
      else setErr(d.error || 'Fetch failed.')
    } catch { setErr('Request failed.') }
    setFetching(false)
  }

  const currentJob    = jobs.find(j => j.job_name === activeJob)
  const currentParams = editParams[activeJob] || []

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 820, width: '95vw' }}>
        <div className="modal-header">
          <span className="modal-title">Jenkins Params — {app}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {loading ? <div className="center"><span className="spinner" /></div> : jobs.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              <p>No parameter files found for <strong>{app}</strong>.</p>
              <p style={{ fontFamily: 'monospace', background: 'var(--surface2)', padding: '8px 12px', borderRadius: 6, marginTop: 8 }}>
                Click <strong>Fetch from Jenkins</strong> to populate parameters from Jenkins.
              </p>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 12, gap: 2, flexWrap: 'wrap' }}>
                {jobs.map(j => (
                  <button key={j.job_name} onClick={() => { setActiveJob(j.job_name); setSaved(false); setErr('') }}
                    style={{
                      padding: '5px 12px', fontSize: 11, fontWeight: activeJob === j.job_name ? 600 : 400,
                      border: 'none', borderBottom: activeJob === j.job_name ? '2px solid var(--primary)' : '2px solid transparent',
                      marginBottom: -1, background: 'none', cursor: 'pointer',
                      color: activeJob === j.job_name ? 'var(--primary)' : 'var(--text-muted)',
                    }}>
                    {j.job_name}
                  </button>
                ))}
              </div>
              {activeJob && (
                <>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                    Edit the <strong>Value</strong> column. Parameter names are read-only.
                  </div>
                  <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          {['Parameter', 'Value'].map(h => (
                            <th key={h} style={{ textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', padding: '4px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {currentParams.map((p, i) => {
                          const choices = currentJob?.choices?.[p.param_name]
                          return (
                            <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>{p.param_name}</td>
                              <td style={{ padding: '4px 8px' }}>
                                {choices && choices.length > 0 ? (
                                  <select value={p.param_value || ''} onChange={e => setEditParams(prev => {
                                    const copy = [...(prev[activeJob] || [])]
                                    copy[i] = { ...copy[i], param_value: e.target.value }
                                    return { ...prev, [activeJob]: copy }
                                  })} style={{ fontSize: 12, width: '100%', padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'monospace' }}>
                                    {choices.map(c => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                ) : (
                                  <input value={p.param_value || ''} onChange={e => setEditParams(prev => {
                                    const copy = [...(prev[activeJob] || [])]
                                    copy[i] = { ...copy[i], param_value: e.target.value }
                                    return { ...prev, [activeJob]: copy }
                                  })} style={{ fontSize: 12, width: '100%', minWidth: 120, padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'monospace' }} />
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
          {fetchOut && (
            <pre style={{ background: '#1a1a1a', color: '#d4d4d4', fontFamily: 'Consolas, monospace', fontSize: 11, padding: '8px 12px', borderRadius: 6, marginTop: 12, maxHeight: 180, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {fetchOut}
            </pre>
          )}
          {err && <div className="alert alert-error" style={{ marginTop: 10 }}>{err}</div>}
          {saved && <div style={{ color: '#4caf50', fontSize: 12, marginTop: 10 }}>Saved successfully.</div>}
          <div className="flex-gap" style={{ justifyContent: 'space-between', marginTop: 14 }}>
            <button className="btn" onClick={fetchFromJenkins} disabled={fetching}>
              {fetching ? 'Fetching…' : '↓ Fetch from Jenkins'}
            </button>
            <div className="flex-gap">
              <button className="btn" onClick={onClose}>Close</button>
              {jobs.length > 0 && activeJob && (
                <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function JregPage() {
  const navigate = useNavigate()
  const [apps,      setApps]      = useState([])
  const [activeApp, setActiveApp] = useState(() => localStorage.getItem(APP_KEY) || 'Payor')
  const [rows,          setRows]          = useState([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState('')
  const [expanded,      setExpanded]      = useState({})
  const [page,          setPage]          = useState(0)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting,      setDeleting]      = useState(null)
  const [showCreate,    setShowCreate]    = useState(false)
  const [showParams,    setShowParams]    = useState(false)
  const [showConfig,      setShowConfig]      = useState(false)
  const [showScheduler,   setShowScheduler]   = useState(false)
  const [payorRepo,       setPayorRepo]       = useState('')
  const [schedSettings,   setSchedSettings]   = useState([])
  const [schedSaving,     setSchedSaving]     = useState(false)
  const [schedSaved,      setSchedSaved]      = useState(false)
  const [schedErr,        setSchedErr]        = useState('')
  const [projectEtas,   setProjectEtas]   = useState(() => _loadEtas(localStorage.getItem(APP_KEY) || 'Payor'))
  const rowsRef          = useRef([])
  const activeAppRef     = useRef(localStorage.getItem(APP_KEY) || 'Payor')
  const activeRefreshRef = useRef(null)

  // Op log terminal state
  const [opStatus,  setOpStatus]  = useState(null)
  const [opApp,     setOpApp]     = useState(null)
  const [opOutput,  setOpOutput]  = useState('')
  const [opErr,     setOpErr]     = useState(null)
  const [logOpen,   setLogOpen]   = useState(false)
  const [logCopied, setLogCopied] = useState(false)
  const opPollRef = useRef(null)
  const termRef   = useRef(null)

  // Auto-refresh
  const [autoRefreshMs, setAutoRefreshMs] = useState(() => {
    const v = parseInt(localStorage.getItem(AUTO_REFRESH_KEY), 10)
    return AUTO_REFRESH_OPTS.some(o => o.value === v) ? v : 0
  })
  const autoRefreshRef     = useRef(autoRefreshMs)
  const autoRefreshPollRef = useRef(null)
  useEffect(() => { autoRefreshRef.current = autoRefreshMs }, [autoRefreshMs])

  function saveAutoRefresh(v) {
    setAutoRefreshMs(v)
    localStorage.setItem(AUTO_REFRESH_KEY, String(v))
  }

  useEffect(() => {
    fetch('/api/tools/jreg/config')
      .then(r => r.json())
      .then(d => { setPayorRepo(d.payor_repo_url || '') })
      .catch(() => {})
  }, [])

  const loadSchedulerSettings = () => {
    fetch('/api/tools/jreg/scheduler-settings')
      .then(r => r.json())
      .then(d => { if (d.ok && d.settings) setSchedSettings(d.settings) })
      .catch(() => {})
  }
  useEffect(() => { loadSchedulerSettings() }, [])

  const loadApps = useCallback((onDone) => {
    fetch('/api/tools/jreg/apps')
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.apps) {
          setApps(d.apps)
          if (onDone) onDone(d.apps)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadApps(list => {
      const saved = localStorage.getItem(APP_KEY)
      if (!saved || !list.includes(saved)) {
        const first = list[0] || 'Payor'
        setActiveApp(first)
        localStorage.setItem(APP_KEY, first)
      }
    })
  }, [loadApps])

  // Validate activeApp whenever apps list changes
  useEffect(() => {
    if (apps.length > 0 && !apps.includes(activeApp)) {
      setActiveApp(apps[0])
      localStorage.setItem(APP_KEY, apps[0])
    }
  }, [apps])

  const fetchAndSetEta = useCallback((pid, app) => {
    fetch(`/api/tools/jreg/projects/${encodeURIComponent(pid)}/jobs?app=${encodeURIComponent(app)}`)
      .then(r => r.json())
      .then(jobs => {
        if (!Array.isArray(jobs)) return
        const maxEta = Math.max(0, ...jobs.map(j => parseInt(j.eta_seconds || '0') || 0))
        setProjectEtas(prev => ({ ...prev, [pid]: maxEta }))
      })
      .catch(() => {})
  }, [])

  const load = useCallback(() => {
    setLoading(true); setError('')
    fetch(`/api/tools/jreg/projects?app=${encodeURIComponent(activeApp)}`)
      .then(r => r.json())
      .then(d => {
        const r = Array.isArray(d) ? d : []
        setRows(r); rowsRef.current = r; setLoading(false)
        r.filter(p => isActive(p.status)).forEach(p => fetchAndSetEta(String(p.project_id), activeApp))
      })
      .catch(() => { setError('Failed to load data.'); setLoading(false) })
  }, [activeApp, fetchAndSetEta])

  useEffect(() => { load() }, [load])

  // Keep ref and ETA state in sync when app switches
  useEffect(() => { activeAppRef.current = activeApp; setProjectEtas(_loadEtas(activeApp)) }, [activeApp])

  // Persist ETAs — use ref to avoid app-switch overwrite race
  useEffect(() => { _saveEtas(activeAppRef.current, projectEtas) }, [projectEtas])

  // Poll active projects every 30 s
  useEffect(() => {
    clearInterval(activeRefreshRef.current)
    activeRefreshRef.current = setInterval(() => {
      rowsRef.current.filter(r => isActive(r.status))
        .forEach(p => fetchAndSetEta(String(p.project_id), activeApp))
    }, 30000)
    return () => clearInterval(activeRefreshRef.current)
  }, [activeApp, fetchAndSetEta])

  // Auto-refresh table
  useEffect(() => {
    clearInterval(autoRefreshPollRef.current)
    if (autoRefreshMs > 0) autoRefreshPollRef.current = setInterval(() => load(), autoRefreshMs)
    return () => clearInterval(autoRefreshPollRef.current)
  }, [autoRefreshMs, load])

  // Scroll terminal to bottom on output change
  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [opOutput])

  function stopOpPoll() {
    clearInterval(opPollRef.current)
    opPollRef.current = null
  }

  function startOpPoll() {
    opPollRef.current = setInterval(() => {
      fetch('/api/tools/jreg/op-status')
        .then(r => r.json())
        .then(d => {
          if (!d.ok) return
          if (d.output) setOpOutput(d.output)
          if (d.app)    setOpApp(d.app)
          if (d.status !== 'running') {
            stopOpPoll()
            setOpStatus(d.status)
            if (d.status === 'failed')  setOpErr('Run failed')
            if (d.status === 'aborted') { setOpErr('Run aborted'); setLogOpen(false) }
            load()
          }
        })
        .catch(() => {})
    }, 1500)
  }

  // On mount: check if a run is already in progress (survived browser close)
  useEffect(() => {
    fetch('/api/tools/jreg/op-status')
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.status === 'running') {
          startOpPoll()
        }
      })
      .catch(() => {})
    return () => stopOpPoll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  function onTriggered() {
    setOpStatus('running'); setOpOutput(''); setOpErr(null); setOpApp(activeApp); setLogOpen(true)
    startOpPoll()
  }

  function abortOp() {
    fetch('/api/tools/jreg/op-abort', { method: 'POST' }).catch(() => {})
  }

  function switchApp(a) {
    setActiveApp(a)
    localStorage.setItem(APP_KEY, a)
    setPage(0)
    setExpanded({})
  }

  const busy    = opStatus === 'running'
  const sorted     = [...rows].sort((a, b) => Number(b.project_id || 0) - Number(a.project_id || 0))
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE) || 1
  const pageRows   = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const toggle = (pid) => setExpanded(prev => ({ ...prev, [pid]: !prev[pid] }))

  const deleteRow = async (pid) => {
    setDeleting(pid)
    try {
      await fetch(`/api/tools/jreg/projects/${encodeURIComponent(pid)}?app=${encodeURIComponent(activeApp)}`, { method: 'DELETE' })
      setRows(prev => prev.filter(r => String(r.project_id) !== String(pid)))
    } catch { /* ignore */ }
    setDeleting(null)
    setPendingDelete(null)
  }

  const versionLabel = activeApp === 'Payor' ? 'Payor Branch Version' : 'Release Version'

  const saveSchedulerSettings = async () => {
    setSchedSaving(true); setSchedErr(''); setSchedSaved(false)
    try {
      const updates = {}
      schedSettings.forEach(s => { updates[s.key] = s.value })
      const r = await fetch('/api/tools/jreg/scheduler-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: updates }),
      })
      const d = await r.json()
      if (d.ok) { setSchedSaved(true); loadSchedulerSettings() }
      else setSchedErr(d.error || 'Save failed.')
    } catch { setSchedErr('Request failed.') }
    setSchedSaving(false)
  }

  return (
    <div>
      <button className="btn back-link" onClick={() => navigate('/workflow-projects')}
        style={{ marginBottom: 16, fontSize: 12, padding: '4px 10px' }}>
        ← Workflow Projects
      </button>
      <WorkflowBackButton />

      <div className="page-header">
        <h1 className="page-title">Jenkins Regression</h1>
        <div className="flex-gap" style={{ alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Auto-refresh:</span>
          <select value={autoRefreshMs} onChange={e => saveAutoRefresh(Number(e.target.value))} style={selStyle}>
            {AUTO_REFRESH_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="btn" onClick={load} disabled={loading}>↺ Refresh</button>
          <button className="btn" onClick={() => setShowConfig(true)} title="Configure job URLs for current app">
            ⚙ Configure
          </button>
          <button className="btn" onClick={() => { setShowScheduler(v => !v); setSchedSaved(false); setSchedErr('') }}
            title="Scheduler settings (poll timeout, stale threshold)"
            style={{ fontSize: 12, padding: '5px 12px' }}>
            ⏱ Scheduler
          </button>
        </div>
      </div>

      {/* Scheduler settings panel */}
      {showScheduler && (
        <div style={{ margin: '0 0 16px 0', padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Scheduler Settings</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(applies to all Jenkins Regression runs)</span>
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

      {/* Application tab bar */}
      <div style={{ display: 'flex', borderBottom: '2px solid var(--border)', marginBottom: 16, gap: 2, flexWrap: 'wrap' }}>
        {apps.map(a => (
          <button key={a}
            onClick={() => switchApp(a)}
            style={{
              padding: '6px 14px', fontSize: 12, fontWeight: activeApp === a ? 600 : 400,
              border: 'none', borderBottom: activeApp === a ? '2px solid var(--primary)' : '2px solid transparent',
              marginBottom: -2, background: 'none', cursor: 'pointer',
              color: activeApp === a ? 'var(--primary)' : 'var(--text-muted)',
            }}>
            {a}
          </button>
        ))}
      </div>

      {/* Per-tab action row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)} disabled={busy}>
          {busy && opApp === activeApp ? '● Running…' : '+ New Run'}
        </button>
        <button className="btn" onClick={() => setShowParams(true)} title="Configure Jenkins Params"
          style={{ fontSize: 12, padding: '5px 12px' }}>
          ⚙ Configure Params
        </button>
      </div>

      {/* Log terminal panel */}
      {logOpen && (
        <div style={{ marginBottom: 20, borderRadius: 8, overflow: 'hidden', border: '1px solid #333', boxShadow: '0 2px 12px rgba(0,0,0,0.3)' }}>
          <div style={{ background: '#2d2d2d', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57', display: 'inline-block' }} />
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e', display: 'inline-block' }} />
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840', display: 'inline-block' }} />
            <span style={{ flex: 1, textAlign: 'center', fontSize: 12, color: '#aaa', fontFamily: 'Consolas, monospace' }}>
              Jenkins Regression{opApp ? ` — ${opApp}` : ''} — Run Log
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {opOutput && (
                <button onClick={() => { navigator.clipboard.writeText(opOutput).catch(() => {}); setLogCopied(true); setTimeout(() => setLogCopied(false), 2000) }}
                  title="Copy log"
                  style={{ background: 'none', border: '1px solid #444', borderRadius: 4, cursor: 'pointer', color: logCopied ? '#4caf50' : '#888', fontSize: 11, padding: '1px 7px' }}>
                  {logCopied ? '✓ Copied' : 'Copy'}
                </button>
              )}
              {busy && (
                <button onClick={abortOp}
                  style={{ background: 'none', border: '1px solid #ff6b35', borderRadius: 4, cursor: 'pointer', color: '#ff6b35', fontSize: 11, padding: '1px 7px' }}>
                  ✕ Abort
                </button>
              )}
              <button onClick={() => setLogOpen(false)}
                style={{ background: 'none', border: '1px solid #555', borderRadius: 4, cursor: 'pointer', color: '#aaa', fontSize: 11, padding: '1px 7px' }}
                title="Close terminal (run continues in background)">
                ✕ Close
              </button>
            </div>
          </div>

          <div style={{ background: '#1e1e1e', padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #333' }}>
            {busy
              ? <><span className="spinner" style={{ width: 10, height: 10, borderColor: '#888', borderTopColor: '#4caf50' }} /><span style={{ fontSize: 11, color: '#aaa' }}>Running…</span></>
              : opStatus === 'success'
                ? <span style={{ fontSize: 11, color: '#4caf50' }}>✓ Completed successfully</span>
                : opStatus === 'aborted'
                  ? <span style={{ fontSize: 11, color: '#ff9800' }}>⚠ Aborted</span>
                  : opStatus === 'failed'
                    ? <span style={{ fontSize: 11, color: '#f44336' }}>✗ Failed</span>
                    : null}
            {!busy && (
              <button onClick={() => setShowCreate(true)}
                style={{ marginLeft: 'auto', background: 'none', border: '1px solid #555', borderRadius: 4, cursor: 'pointer', color: '#aaa', fontSize: 11, padding: '1px 9px' }}>
                + New Run
              </button>
            )}
          </div>

          <pre ref={termRef} style={{
            background: '#1a1a1a', color: '#d4d4d4', fontFamily: 'Consolas, "Courier New", monospace',
            fontSize: 12, lineHeight: 1.5, margin: 0, padding: '12px 16px',
            maxHeight: 380, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {opOutput || <span style={{ color: '#666' }}>Waiting for output…</span>}
          </pre>
        </div>
      )}

      {/* Reopen terminal button when closed after a completed run */}
      {!logOpen && !busy && opStatus && (
        <div style={{ marginBottom: 12 }}>
          <button className="btn btn-sm" onClick={() => setLogOpen(true)}>
            ▤ View last run log
          </button>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="center"><span className="spinner" /></div>
      ) : sorted.length === 0 ? (
        <div className="empty"><h3>No runs yet for {activeApp}</h3><p>Trigger a new run to get started.</p></div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th>Project ID</th>
                  <th>{versionLabel}</th>
                  <th>Runs</th>
                  <th>Status</th>
                  <th>ETA</th>
                  <th>Triggered At</th>
                  <th style={{ width: 100 }}></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const pid    = String(row.project_id)
                  const isOpen = !!expanded[pid]
                  return (
                    <React.Fragment key={pid}>
                      <tr style={{ cursor: 'pointer' }} onClick={() => toggle(pid)}>
                        <td style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'center', userSelect: 'none' }}>
                          {isOpen ? '▾' : '▸'}
                        </td>
                        <td><span style={{ fontWeight: 600 }}>{row.project_id}</span></td>
                        <td>{(() => {
                          const ver      = row.payor_release_version || ''
                          const branchUrl = activeApp === 'Payor' && payorRepo && ver
                            ? `${payorRepo}/tree/release-${ver}` : ''
                          return branchUrl ? (
                            <a href={branchUrl} target="_blank" rel="noreferrer"
                               className="mono"
                               style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }}
                               onClick={e => e.stopPropagation()}>
                              {ver}
                            </a>
                          ) : <span className="mono" style={{ fontSize: 12 }}>{ver || '—'}</span>
                        })()}</td>
                        <td><span className="mono" style={{ fontSize: 12 }}>{row.runs || '—'}</span></td>
                        <td><SummaryStatus summary={row.job_summary} status={row.status} /></td>
                        <td><span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                          {isActive(row.status) && projectEtas[pid] > 0 ? fmtEta(projectEtas[pid]) : '—'}
                        </span></td>
                        <td><span className="mono" style={{ fontSize: 12 }}>{(row.triggered_at || '').slice(0, 16)}</span></td>
                        <td onClick={e => e.stopPropagation()}>
                          {pendingDelete === pid ? (
                            <div className="flex-gap">
                              <button className="btn btn-sm btn-danger" disabled={deleting === pid}
                                onClick={() => deleteRow(pid)}>
                                {deleting === pid ? '…' : 'Confirm'}
                              </button>
                              <button className="btn btn-sm" onClick={() => setPendingDelete(null)}>Cancel</button>
                            </div>
                          ) : (
                            <button className="btn btn-sm btn-danger" onClick={() => setPendingDelete(pid)}>Delete</button>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={8} style={{ background: 'var(--surface2)', padding: '12px 16px 12px 32px' }}>
                            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px',
                              color: 'var(--text-muted)', marginBottom: 8 }}>Job Details</div>
                            <JobsTable pid={pid} activeApp={activeApp} onUpdate={jobs => {
                              const maxEta = Math.max(0, ...jobs.map(j => parseInt(j.eta_seconds || '0') || 0))
                              if (maxEta > 0) setProjectEtas(prev => ({ ...prev, [pid]: maxEta }))
                            }} />
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
            <div className="flex-gap" style={{ justifyContent: 'center', marginTop: 16, flexWrap: 'wrap', gap: 6 }}>
              <button className="btn btn-sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>‹ Prev</button>
              {Array.from({ length: totalPages }, (_, i) => (
                <button key={i} className={`btn btn-sm${i === page ? ' btn-primary' : ''}`}
                  onClick={() => setPage(i)}>{i + 1}</button>
              ))}
              <button className="btn btn-sm" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}>Next ›</button>
            </div>
          )}
        </>
      )}

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onTriggered={onTriggered}
          activeApp={activeApp}
        />
      )}

      {showParams && (
        <JregParamsModal
          app={activeApp}
          onClose={() => setShowParams(false)}
        />
      )}

      {showConfig && (
        <JregConfigModal
          initialApp={activeApp}
          apps={apps}
          onAppsChanged={newApps => setApps(newApps)}
          onClose={() => setShowConfig(false)}
        />
      )}
    </div>
  )
}
