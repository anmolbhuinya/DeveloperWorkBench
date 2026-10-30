import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

const PAGE_SIZE  = 10
const ETAS_KEY   = 'jcj_project_etas'

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
const TERMINAL  = new Set(['success', 'passed', 'failure', 'failed', 'aborted', 'trigger failed', 'unstable'])

const APP_KEY = 'jcj_active_app'

const AUTO_REFRESH_KEY  = 'jcj_auto_refresh_ms'
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
  if (['failure', 'failed', 'error', 'timeout'].some(s => v.includes(s)))                                 cls = 'badge badge-danger'
  else if (['running', 'scheduled', 'in progress', 'triggered', 'queued', 'building'].some(s => v.includes(s))) cls = 'badge badge-warning'
  else if (['passed', 'completed', 'done', 'success'].some(s => v.includes(s)))                           cls = 'badge badge-success'
  else if (['skipped', 'cancelled', 'aborted'].some(s => v.includes(s)))                                  cls = 'badge badge-skipped'
  else if (v.includes('unstable') || v.includes('partial'))                                                cls = 'badge badge-warning'
  return <span className={cls}>{value || '—'}</span>
}

function JcjProjectStatus({ value }) {
  if (!value) return <span className="badge badge-pending">—</span>
  const colon = value.indexOf(': ')
  if (colon === -1) return <StatusBadge value={value} />
  const prefix = value.slice(0, colon + 2) // "4 jobs: "
  const parts  = value.slice(colon + 2).split(', ')
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{prefix}</span>
      {parts.map((part, i) => {
        const v = part.toLowerCase()
        let cls = 'badge badge-pending'
        if (['failed','failure','error'].some(k => v.includes(k)))           cls = 'badge badge-danger'
        else if (['running','building','queued','triggered'].some(k => v.includes(k))) cls = 'badge badge-warning'
        else if (['success','passed','completed','done'].some(k => v.includes(k)))     cls = 'badge badge-success'
        else if (v.includes('unstable'))                                                cls = 'badge badge-warning'
        return <span key={i} className={cls}>{part}</span>
      })}
    </span>
  )
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
  return v.includes('running') || v.includes('queued') || v.includes('triggering')
}

function CopyVersionButton({ value }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(null)
  const handleClick = (e) => {
    e.stopPropagation(); e.preventDefault()
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1500)
    })
  }
  useEffect(() => () => clearTimeout(timerRef.current), [])
  return (
    <button onClick={handleClick} title="Copy version"
      style={{
        background: copied ? 'rgba(76,175,80,0.15)' : 'transparent',
        border: `1px solid ${copied ? 'rgba(76,175,80,0.4)' : 'rgba(255,255,255,0.15)'}`,
        borderRadius: 4, cursor: 'pointer', padding: '2px 5px',
        color: copied ? '#4caf50' : 'var(--text-muted)',
        fontSize: 10, fontFamily: 'monospace', lineHeight: 1.4, transition: 'all 0.15s',
      }}>
      {copied ? '✓' : '⎘'}
    </button>
  )
}

function ArtifactDownloadButton({ url, label }) {
  const [state, setState] = useState('idle') // idle | downloading | done
  const timerRef = useRef(null)

  const handleClick = (e) => {
    e.stopPropagation()
    if (state === 'downloading') { e.preventDefault(); return }
    // let the browser follow the href naturally — just update visual state
    setState('downloading')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setState('done'), 4000)
  }

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const styles = {
    idle:        { background: 'rgba(76,175,80,0.1)',  color: '#4caf50', border: '1px solid rgba(76,175,80,0.3)',  cursor: 'pointer'     },
    downloading: { background: 'rgba(255,193,7,0.15)', color: '#e6a817', border: '1px solid rgba(255,193,7,0.4)', cursor: 'not-allowed' },
    done:        { background: 'rgba(76,175,80,0.18)', color: '#4caf50', border: '1px solid rgba(76,175,80,0.5)',  cursor: 'pointer'     },
  }
  const icons  = { idle: '⬇', downloading: '⬇', done: '✓' }
  const labels = { idle: label, downloading: 'Downloading…', done: label }

  return (
    <a
      href={url}
      download
      onClick={handleClick}
      style={{ ...styles[state], borderRadius: 4, padding: '2px 7px', fontFamily: 'monospace', fontSize: 11, textDecoration: 'none', display: 'inline-block', userSelect: 'none', transition: 'all 0.15s' }}
    >
      {icons[state]} {labels[state]}
    </a>
  )
}

function JobsTable({ pid, activeApp, onUpdate }) {
  const [jobs,     setJobs]     = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [err,      setErr]      = useState('')
  const [retrying, setRetrying] = useState({})
  const [retryErr, setRetryErr] = useState({})
  const pollRef = useRef(null)

  async function retriggerJob(jobName) {
    setRetrying(prev => ({ ...prev, [jobName]: true }))
    setRetryErr(prev => ({ ...prev, [jobName]: '' }))
    try {
      const r = await fetch(`/api/tools/jcj/projects/${encodeURIComponent(pid)}/retrigger-job`, {
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

  const fetchJobs = useCallback(() => {
    fetch(`/api/tools/jcj/projects/${encodeURIComponent(pid)}/jobs?app=${encodeURIComponent(activeApp)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        const arr = Array.isArray(d) ? d : []
        setJobs(arr)
        setLoading(false)
        if (onUpdate) onUpdate(arr)
      })
      .catch(() => { setErr('Failed to load job details.'); setLoading(false) })
  }, [pid, activeApp, onUpdate])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  // auto-poll while any job is active
  useEffect(() => {
    clearInterval(pollRef.current)
    if (!jobs) return
    const hasActive = jobs.some(j => isActive(j.completed))
    if (hasActive) pollRef.current = setInterval(fetchJobs, 30000)
    return () => clearInterval(pollRef.current)
  }, [jobs, fetchJobs])

  if (loading) return <div style={{ padding: '8px 0' }}><span className="spinner" style={{ width: 14, height: 14 }} /></div>
  if (err)     return <div style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</div>
  if (!jobs || jobs.length === 0)
    return <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No job details found for this project.</div>

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr>
          {['Job Name', 'Status', 'ETA', 'Runs', 'Triggered At', 'Build URL', 'Artifact'].map(h => (
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
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>queued…</span>
              ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
            </td>
            <td style={{ padding: '5px 10px' }}>
              {job.artifact_url && job.build_version
                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <ArtifactDownloadButton
                      url={`/api/tools/jcj/artifact-download?url=${encodeURIComponent(job.artifact_url)}${job.artifactory_url ? '&no_jenkins_auth=1' : ''}`}
                      label={job.build_version}
                    />
                    <CopyVersionButton value={job.build_version} />
                  </span>
                : <span style={{ color: 'var(--text-muted)' }}>—</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function CreateModal({ onClose, onTriggered, activeApp }) {
  const [runs, setRuns] = useState('1')
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState('')

  const [jobs,            setJobs]            = useState([])
  const [selectedJobs,    setSelectedJobs]    = useState(new Set())
  const [urlPlaceholders, setUrlPlaceholders] = useState([])
  const [urlParams,       setUrlParams]       = useState({})

  useEffect(() => {
    fetch(`/api/tools/jcj/job-config/${encodeURIComponent(activeApp)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (!d.ok || !d.jobs) return
        const jobList = d.jobs.filter(j => j.job_name)
        setJobs(jobList)
        setSelectedJobs(new Set(jobList.map(j => j.job_name)))
        const seen = new Set()
        for (const job of jobList) {
          const matches = (job.job_url || '').match(/\{([^}]+)\}/g) || []
          for (const m of matches) seen.add(m.slice(1, -1))
        }
        const list = [...seen]
        setUrlPlaceholders(list)
        setUrlParams(Object.fromEntries(list.map(k => [k, ''])))
      })
      .catch(() => {})
  }, [activeApp])

  const toggleJob = (name) => setSelectedJobs(prev => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name); else next.add(name)
    return next
  })

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const body = { app: activeApp }
      if (runs) body.runs = runs
      const orderedSelected = jobs.filter(j => selectedJobs.has(j.job_name)).map(j => j.job_name)
      if (orderedSelected.length > 0) body.selected_jobs = orderedSelected
      const filledUrlParams = Object.fromEntries(Object.entries(urlParams).filter(([, v]) => v.trim()))
      if (Object.keys(filledUrlParams).length > 0) body.url_params = filledUrlParams
      const r = await fetch('/api/tools/jcj/trigger', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      if (d.ok) { onTriggered(); onClose() }
      else setErr(d.error || 'Failed to trigger.')
    } catch { setErr('Request failed.') }
    setBusy(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <span className="modal-title">New Run — Jenkins Commit Job ({activeApp})</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {/* Job selection — all shown, all selected by default */}
          {jobs.length > 0 && (
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label className="field-label" style={{ margin: 0 }}>Jobs</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={() => setSelectedJobs(new Set(jobs.map(j => j.job_name)))}
                    style={{ background: 'none', border: 'none', fontSize: 11, color: 'var(--primary)', cursor: 'pointer', padding: 0 }}>
                    All
                  </button>
                  <button type="button" onClick={() => setSelectedJobs(new Set())}
                    style={{ background: 'none', border: 'none', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}>
                    None
                  </button>
                </div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                {jobs.map((job, i) => (
                  <label key={job.job_name} onClick={() => toggleJob(job.job_name)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 9, padding: '7px 10px',
                      cursor: 'pointer', userSelect: 'none',
                      borderBottom: i < jobs.length - 1 ? '1px solid var(--border)' : 'none',
                      background: selectedJobs.has(job.job_name) ? 'rgba(21,101,192,0.06)' : 'transparent',
                    }}>
                    <input type="checkbox" readOnly checked={selectedJobs.has(job.job_name)}
                      style={{ marginTop: 3, cursor: 'pointer', flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{job.job_name}</div>
                      {job.job_url && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all', marginTop: 2 }}>
                          {job.job_url}
                        </div>
                      )}
                      {job.artifactory_url && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all', marginTop: 1 }}>
                          <span style={{ opacity: 0.6 }}>art: </span>{job.artifactory_url}
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* URL placeholder inputs shown directly in form */}
          {urlPlaceholders.map(name => (
            <div key={name} className="form-group">
              <label className="field-label" style={{ fontFamily: 'monospace' }}>{name}</label>
              <input
                placeholder={`Value for {${name}}`}
                value={urlParams[name] || ''}
                onChange={e => setUrlParams(p => ({ ...p, [name]: e.target.value }))}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
            </div>
          ))}

          <div className="form-group">
            <label className="field-label">Runs</label>
            <input type="number" placeholder="e.g. 3" value={runs}
              onChange={e => setRuns(e.target.value)} />
          </div>

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

function JcjConfigModal({ initialApp, apps: appsProp, onAppsChanged, onClose }) {
  const [modalApps,   setModalApps]   = useState(appsProp || [])
  const [activeTab,   setActiveTab]   = useState(initialApp || (appsProp || [])[0] || '')
  const [jobsByApp,     setJobsByApp]     = useState({})
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
    fetch(`/api/tools/jcj/job-config/${encodeURIComponent(a)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setJobsByApp(prev => ({ ...prev, [a]: d.jobs || [] }))
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
      const r = await fetch('/api/tools/jcj/apps', {
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
      const r = await fetch(`/api/tools/jcj/apps/${encodeURIComponent(activeTab)}`, { method: 'DELETE' })
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
    setJobsByApp(prev => ({ ...prev, [activeTab]: [...(prev[activeTab] || []), { job_name: '', job_url: '', artifactory_url: '', enabled: true }] }))
  const moveJob = (i, dir) =>
    setJobsByApp(prev => {
      const arr = [...(prev[activeTab] || [])]
      const t = i + dir
      if (t < 0 || t >= arr.length) return prev
      ;[arr[i], arr[t]] = [arr[t], arr[i]]
      return { ...prev, [activeTab]: arr }
    })

  const save = async () => {
    setSaving(true); setErr(''); setSaved(false)
    try {
      const r = await fetch(`/api/tools/jcj/job-config/${encodeURIComponent(activeTab)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobs: jobsByApp[activeTab] || [] }),
      })
      const d = await r.json()
      if (d.ok) setSaved(true)
      else setErr(d.error || 'Save failed.')
    } catch { setErr('Request failed.') }
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 1100, width: '95vw' }}>
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
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ..._cfgThStyle, width: 36, textAlign: 'center' }}>On</th>
                      <th style={{ ..._cfgThStyle, width: 40 }}></th>
                      <th style={_cfgThStyle}>Job Name</th>
                      <th style={_cfgThStyle}>Job URL</th>
                      <th style={_cfgThStyle}>Artifactory URL</th>
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
                          <td style={{ padding: '2px 4px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <button onClick={() => moveJob(i, -1)} disabled={i === 0}
                              style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? 'var(--border)' : 'var(--text-muted)', fontSize: 12, padding: '1px 3px', lineHeight: 1 }}>▲</button>
                            <button onClick={() => moveJob(i, 1)} disabled={i === jobs.length - 1}
                              style={{ background: 'none', border: 'none', cursor: i === jobs.length - 1 ? 'default' : 'pointer', color: i === jobs.length - 1 ? 'var(--border)' : 'var(--text-muted)', fontSize: 12, padding: '1px 3px', lineHeight: 1 }}>▼</button>
                          </td>
                          <td style={{ padding: '4px 8px' }}>
                            <input value={j.job_name || ''} onChange={e => updateJob(i, 'job_name', e.target.value)}
                              style={{ ..._cfgInputStyle, minWidth: 100 }} />
                          </td>
                          <td style={{ padding: '4px 8px' }}>
                            <input value={j.job_url || ''} onChange={e => updateJob(i, 'job_url', e.target.value)}
                              style={{ ..._cfgInputStyle, minWidth: 260 }} />
                          </td>
                          <td style={{ padding: '4px 8px' }}>
                            <input value={j.artifactory_url || ''} onChange={e => updateJob(i, 'artifactory_url', e.target.value)}
                              placeholder="https://nexus.example.com/…/{artifact_version}/file-{artifact_version}.tar.gz"
                              style={{ ..._cfgInputStyle, minWidth: 220 }} />
                          </td>
                          <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                            <button onClick={() => removeJob(i)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger, #f44336)', fontSize: 14, lineHeight: 1, padding: '2px 4px' }}>✕</button>
                          </td>
                        </tr>
                      )
                    })}
                    {jobs.length === 0 && (
                      <tr><td colSpan={6} style={{ padding: '14px 8px', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
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


export default function JcjPage() {
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
  const [showConfig,    setShowConfig]    = useState(false)
  const [showScheduler,    setShowScheduler]    = useState(false)
  const [schedSettings,    setSchedSettings]    = useState([])
  const [schedSaving,      setSchedSaving]      = useState(false)
  const [schedSaved,       setSchedSaved]       = useState(false)
  const [schedErr,         setSchedErr]         = useState('')
  const [projectEtas,   setProjectEtas]   = useState(() => _loadEtas(localStorage.getItem(APP_KEY) || 'Payor'))
  const rowsRef          = useRef([])
  const activeRefreshRef = useRef(null)
  const activeAppRef     = useRef(localStorage.getItem(APP_KEY) || 'Payor')

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

  const loadSchedulerSettings = () => {
    fetch('/api/tools/jcj/scheduler-settings')
      .then(r => r.json())
      .then(d => { if (d.ok && d.settings) setSchedSettings(d.settings) })
      .catch(() => {})
  }

  useEffect(() => { loadSchedulerSettings() }, [])

  const saveSchedulerSettings = async () => {
    setSchedSaving(true); setSchedSaved(false); setSchedErr('')
    try {
      const updates = {}
      schedSettings.forEach(s => { updates[s.key] = s.value })
      const r = await fetch('/api/tools/jcj/scheduler-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: updates }),
      })
      const d = await r.json()
      if (d.ok) { setSchedSaved(true); loadSchedulerSettings() }
      else setSchedErr(d.error || 'Failed to save')
    } catch { setSchedErr('Network error') }
    finally { setSchedSaving(false) }
  }

  const loadApps = useCallback((onDone) => {
    fetch('/api/tools/jcj/apps')
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
    fetch(`/api/tools/jcj/projects/${encodeURIComponent(pid)}/jobs?app=${encodeURIComponent(app)}`)
      .then(r => r.json())
      .then(jobs => {
        if (!Array.isArray(jobs)) return
        const maxEta = Math.max(0, ...jobs.map(j => parseInt(j.eta_seconds || '0') || 0))
        setProjectEtas(prev => ({ ...prev, [pid]: maxEta }))
        const total    = jobs.length
        const failed   = jobs.filter(j => ['failed','failure','error'].some(k => (j.completed||'').toLowerCase().includes(k))).length
        const running  = jobs.filter(j => ['running','building'].some(k => (j.completed||'').toLowerCase().includes(k))).length
        const queued   = jobs.filter(j => ['queued','triggered','scheduled'].some(k => (j.completed||'').toLowerCase().includes(k))).length
        const success  = jobs.filter(j => ['success','passed','completed','done'].some(k => (j.completed||'').toLowerCase().includes(k))).length
        const unstable = jobs.filter(j => (j.completed||'').toLowerCase().includes('unstable')).length
        const parts   = []
        if (failed)   parts.push(`${failed} failed`)
        if (running)  parts.push(`${running} running`)
        if (queued)   parts.push(`${queued} queued`)
        if (unstable) parts.push(`${unstable} unstable`)
        if (success)  parts.push(`${success} success`)
        const newStatus = `${total} jobs: ${parts.join(', ') || 'pending'}`
        setRows(prev => { const u = prev.map(r => String(r.project_id) === pid ? { ...r, status: newStatus } : r); rowsRef.current = u; return u })
      })
      .catch(() => {})
  }, [])

  const load = useCallback(() => {
    setLoading(true); setError('')
    fetch(`/api/tools/jcj/projects?app=${encodeURIComponent(activeApp)}`)
      .then(r => r.json())
      .then(d => {
        const r = Array.isArray(d) ? d : []
        setRows(r); rowsRef.current = r; setLoading(false)
        // Immediately refresh ETAs for active projects so Refresh button also updates ETAs
        r.filter(p => isActive(p.status)).forEach(p => fetchAndSetEta(String(p.project_id), activeApp))
      })
      .catch(() => { setError('Failed to load data.'); setLoading(false) })
  }, [activeApp, fetchAndSetEta])

  useEffect(() => { load() }, [load])

  // Keep ref in sync so persist effect always uses the current app
  useEffect(() => { activeAppRef.current = activeApp; setProjectEtas(_loadEtas(activeApp)) }, [activeApp])

  // Persist ETAs — deps on projectEtas only; use ref to avoid app-switch overwrite race
  useEffect(() => { _saveEtas(activeAppRef.current, projectEtas) }, [projectEtas])

  // Poll active projects (queued/running jobs) every 30 s
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
      fetch('/api/tools/jcj/op-status')
        .then(r => r.json())
        .then(d => {
          if (!d.ok) return
          if (d.output) setOpOutput(d.output)
          if (d.app)    setOpApp(d.app)
          if (d.status !== 'running') {
            stopOpPoll()
            setOpStatus(d.status)
            if (d.status === 'failed')  setOpErr('Run failed')
            if (d.status === 'aborted') setOpErr('Run aborted')
            load()
          }
        })
        .catch(() => {})
    }, 1500)
  }

  // On mount: check if a run is already in progress (survived browser close)
  useEffect(() => {
    fetch('/api/tools/jcj/op-status')
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.status === 'running') {
          setOpStatus('running'); setOpOutput(d.output || ''); setOpApp(d.app || null); setLogOpen(true)
          startOpPoll()
        }
      })
      .catch(() => {})
    return () => stopOpPoll()
  }, [])

  function onTriggered() {
    setOpStatus('running'); setOpOutput(''); setOpErr(null); setOpApp(activeApp); setLogOpen(true)
    startOpPoll()
  }

  function abortOp() {
    fetch('/api/tools/jcj/op-abort', { method: 'POST' }).catch(() => {})
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
      await fetch(`/api/tools/jcj/projects/${encodeURIComponent(pid)}?app=${encodeURIComponent(activeApp)}`, { method: 'DELETE' })
      setRows(prev => prev.filter(r => String(r.project_id) !== String(pid)))
    } catch { /* ignore */ }
    setDeleting(null)
    setPendingDelete(null)
  }

  const versionLabel = 'Version'

  return (
    <div>
      <button className="btn back-link" onClick={() => navigate('/workflow-projects')}
        style={{ marginBottom: 16, fontSize: 12, padding: '4px 10px' }}>
        ← Workflow Projects
      </button>

      <div className="page-header">
        <h1 className="page-title">Jenkins Commit Job</h1>
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
            title="Scheduler settings"
            style={{ fontSize: 12, padding: '5px 12px' }}>
            ⏱ Scheduler
          </button>
        </div>
      </div>

      {showScheduler && (
        <div style={{ margin: '12px 0 0 0', padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Scheduler Settings</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>— scheduler_config.xlsx</span>
            </div>
            <button className="btn" onClick={saveSchedulerSettings} disabled={schedSaving}
              style={{ fontSize: 12, padding: '4px 14px' }}>
              {schedSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {schedSettings.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No settings found.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '4px 10px 6px 0', color: 'var(--text-muted)', fontWeight: 500, borderBottom: '1px solid var(--border)', width: '22%' }}>Key</th>
                  <th style={{ textAlign: 'left', padding: '4px 10px 6px 0', color: 'var(--text-muted)', fontWeight: 500, borderBottom: '1px solid var(--border)', width: '14%' }}>Value</th>
                  <th style={{ textAlign: 'left', padding: '4px 0 6px 0',    color: 'var(--text-muted)', fontWeight: 500, borderBottom: '1px solid var(--border)' }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {schedSettings.map((s, i) => (
                  <tr key={s.key}>
                    <td style={{ padding: '5px 10px 5px 0', fontFamily: 'Consolas, monospace', color: 'var(--text)' }}>{s.key}</td>
                    <td style={{ padding: '5px 10px 5px 0' }}>
                      <input
                        value={s.value}
                        onChange={e => {
                          const next = schedSettings.map((x, j) => j === i ? { ...x, value: e.target.value } : x)
                          setSchedSettings(next); setSchedSaved(false)
                        }}
                        style={{ width: '100%', padding: '3px 7px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontFamily: 'Consolas, monospace' }}
                      />
                    </td>
                    <td style={{ padding: '5px 0', color: 'var(--text-muted)', fontSize: 11 }}>{s.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {schedSaved && <div style={{ marginTop: 8, fontSize: 12, color: '#4caf50' }}>✓ Saved</div>}
          {schedErr  && <div style={{ marginTop: 8, fontSize: 12, color: '#f44336' }}>{schedErr}</div>}
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
      <div style={{ display: 'flex', marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)} disabled={busy}>
          {busy && opApp === activeApp ? '● Running…' : '+ New Run'}
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
              Jenkins Commit Job{opApp ? ` — ${opApp}` : ''} — Run Log
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

      {/* Reopen terminal button when closed but run is active */}
      {!logOpen && (busy || opStatus) && (
        <div style={{ marginBottom: 12 }}>
          <button className="btn btn-sm" onClick={() => setLogOpen(true)}
            style={busy ? { borderColor: '#4caf50', color: '#4caf50' } : {}}>
            {busy ? '● View running log…' : '▤ View last run log'}
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
                        <td><span className="mono" style={{ fontSize: 12 }}>{row.payor_release_version || '—'}</span></td>
                        <td><span className="mono" style={{ fontSize: 12 }}>{row.runs || '—'}</span></td>
                        <td><JcjProjectStatus value={row.status} /></td>
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
                          <td colSpan={7} style={{ background: 'var(--surface2)', padding: '12px 16px 12px 32px' }}>
                            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px',
                              color: 'var(--text-muted)', marginBottom: 8 }}>Job Details</div>
                            <JobsTable pid={pid} activeApp={activeApp} onUpdate={jobs => {
                              const maxEta = Math.max(0, ...jobs.map(j => parseInt(j.eta_seconds || '0') || 0))
                              if (maxEta > 0) setProjectEtas(prev => ({ ...prev, [pid]: maxEta }))
                              const total    = jobs.length
                              const failed   = jobs.filter(j => ['failed','failure','error'].some(k => (j.completed||'').toLowerCase().includes(k))).length
                              const running  = jobs.filter(j => ['running','building'].some(k => (j.completed||'').toLowerCase().includes(k))).length
                              const queued   = jobs.filter(j => ['queued','triggered','scheduled'].some(k => (j.completed||'').toLowerCase().includes(k))).length
                              const success  = jobs.filter(j => ['success','passed','completed','done'].some(k => (j.completed||'').toLowerCase().includes(k))).length
                              const unstable = jobs.filter(j => (j.completed||'').toLowerCase().includes('unstable')).length
                              const parts = []
                              if (failed)   parts.push(`${failed} failed`)
                              if (running)  parts.push(`${running} running`)
                              if (queued)   parts.push(`${queued} queued`)
                              if (unstable) parts.push(`${unstable} unstable`)
                              if (success)  parts.push(`${success} success`)
                              const newStatus = `${total} jobs: ${parts.join(', ') || 'pending'}`
                              setRows(prev => {
                                const updated = prev.map(r => String(r.project_id) === pid ? { ...r, status: newStatus } : r)
                                rowsRef.current = updated
                                return updated
                              })
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

      {showConfig && (
        <JcjConfigModal
          initialApp={activeApp}
          apps={apps}
          onAppsChanged={newApps => setApps(newApps)}
          onClose={() => setShowConfig(false)}
        />
      )}
    </div>
  )
}
