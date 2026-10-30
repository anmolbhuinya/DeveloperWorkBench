import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

const PAGE_SIZE = 10
const TERMINAL  = new Set(['success', 'passed', 'failure', 'failed', 'aborted', 'trigger failed'])

const AUTO_REFRESH_KEY  = 'puc_auto_refresh_ms'
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

function buildNum(url) {
  const m = String(url || '').match(/\/(\d+)\/?$/)
  return m ? `#${m[1]}` : '↗'
}

function fmtEta(sec) {
  if (sec === null || sec === undefined) return null
  const sign = sec < 0 ? '+' : ''
  const abs  = Math.abs(Math.round(sec))
  const m    = Math.floor(abs / 60), s = abs % 60
  return sign + (m ? `${m}m ` : '') + `${s}s`
}

const COLOR_CLASS = {
  green:  'badge badge-success',
  red:    'badge badge-danger',
  orange: 'badge badge-orange',
  yellow: 'badge badge-yellow',
  gray:   'badge badge-skipped',
  grey:   'badge badge-skipped',
}

function statusCls(value, colorMap) {
  if (!value) return 'badge badge-pending'
  const color = colorMap?.[(value).toLowerCase()] || colorMap?.[value]
  if (color) return COLOR_CLASS[color.toLowerCase()] || 'badge badge-pending'
  const v = value.toLowerCase()
  if (['success', 'passed', 'done', 'completed'].some(s => v.includes(s)))              return 'badge badge-success'
  if (['failure', 'failed', 'error'].some(s => v.includes(s)))                          return 'badge badge-danger'
  if (['running', 'triggered', 'building', 'queued', 'in progress'].some(s => v.includes(s))) return 'badge badge-warning'
  if (['unstable', 'pending'].some(s => v.includes(s)))                                 return 'badge badge-pending'
  if (['aborted', 'cancelled', 'not_built'].some(s => v.includes(s)))                  return 'badge badge-skipped'
  return 'badge badge-pending'
}

function CertDetailsModal({ pid, onClose }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    fetch(`/api/tools/puc/projects/${encodeURIComponent(pid)}/cert-details`)
      .then(r => r.json())
      .then(j => (j.ok ? setD(j) : setErr(j.error || 'Failed to load')))
      .catch(() => setErr('Failed to load'))
    return () => window.removeEventListener('keydown', onKey)
  }, [pid]) // eslint-disable-line react-hooks/exhaustive-deps

  const stat = (label, value) => (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 20, fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div className="modal-header">
          <span className="modal-title">Certification — Project #{pid}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {err && <div className="alert alert-error">{err}</div>}
          {!d && !err && <div style={{ textAlign: 'center', padding: 24 }}><span className="spinner" /></div>}
          {d && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: 16 }}>
                {stat('Jenkins failures', d.jenkins_failures)}
                {stat('Baseline failures', d.baseline_failures)}
                {stat('Common', d.common_failures)}
                {stat('New', d.new_failures.length)}
                {stat('Fixed vs baseline', d.fixed_vs_baseline)}
              </div>
              {d.new_failures.length > 0 && (
                <>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>New failures (not in baseline)</div>
                  <div style={{ maxHeight: 280, overflow: 'auto' }}>
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead><tr>
                        <th style={{ textAlign: 'left', padding: '4px 8px' }}>Class</th>
                        <th style={{ textAlign: 'left', padding: '4px 8px' }}>Test</th>
                        <th style={{ textAlign: 'left', padding: '4px 8px' }}>Status</th>
                      </tr></thead>
                      <tbody>
                        {d.new_failures.map((f, i) => (
                          <tr key={i}>
                            <td className="mono" style={{ padding: '4px 8px', wordBreak: 'break-all' }}>{f.className}</td>
                            <td className="mono" style={{ padding: '4px 8px', wordBreak: 'break-all' }}>{f.name}</td>
                            <td style={{ padding: '4px 8px' }}>{f.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              <div style={{ marginTop: 16, textAlign: 'right' }}>
                <a className="btn btn-sm" href={`/api/tools/puc/projects/${encodeURIComponent(pid)}/cert-report`} download>
                  ⬇ Download report
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ value, colorMap }) {
  return <span className={statusCls(value, colorMap)}>{value || '—'}</span>
}

const DETAIL_LABELS = {
  status:              'jenkins status',
  payor_version:       'payor branch version',
  certification_status:'cert status',
}
const DETAIL_SKIP = new Set(['queue_url', 'jenkins_it_failures', 'baseline_it_failures'])

function DetailPanel({ row, live, githubRepo, releasePrefix, colorMap }) {
  const merged = { ...row, ...(live?.status ? { status: live.status } : {}),
                            ...(live?.build_url && !row.build_url ? { build_url: live.build_url } : {}) }
  const entries = Object.entries(merged).filter(([k, v]) => v != null && v !== '' && !DETAIL_SKIP.has(k))

  const labelStyle = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: 2 }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: '10px 28px' }}>
      {entries.map(([k, v]) => {
        const label = DETAIL_LABELS[k] || k
        let href = String(v).startsWith('http') ? String(v) : ''
        if (!href && k === 'payor_version' && githubRepo && v) href = `${githubRepo}/tree/${releasePrefix}${v}`

        if (k === 'certification_status') {
          const jCount = merged.jenkins_it_failures
          const bCount = merged.baseline_it_failures
          const hasCount = jCount !== '' && jCount != null && bCount !== '' && bCount != null
          return (
            <div key={k}>
              <div style={labelStyle}>{label}</div>
              <span className={statusCls(v, colorMap)} style={{ marginBottom: 4, display: 'inline-block' }}>{v}</span>
              {hasCount && (
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                  Jenkins: {jCount} IT failures&nbsp;&nbsp;|&nbsp;&nbsp;Baseline: {bCount} IT failures
                </div>
              )}
            </div>
          )
        }

        return (
          <div key={k}>
            <div style={labelStyle}>{label}</div>
            {href ? (
              <a href={href} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                ↗ {String(v).slice(0, 70)}{String(v).length > 70 ? '…' : ''}
              </a>
            ) : (
              <div className="mono" style={{ color: 'var(--text)', wordBreak: 'break-all' }}>{String(v)}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const CONFIG_FIELDS = [
  { key: 'github_repo_url', label: 'GitHub Repo URL',            placeholder: 'https://github.com/org/payor' },
  { key: 'release_prefix',  label: 'Release Branch Prefix',      placeholder: 'e.g. release-' },
  { key: 'job_url',         label: 'Jenkins Job URL',            placeholder: 'http://jenkins/job/Payor/job/{version}/job/payor-utils-certification' },
]

const COLOR_OPTIONS = ['green', 'red', 'orange', 'yellow', 'gray']

function ConfigModal({ onClose, onSaved }) {
  const [cfg,     setCfg]     = useState(null)
  const [sc,      setSc]      = useState([])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [err,     setErr]     = useState('')
  const [saved,   setSaved]   = useState(false)

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    fetch('/api/tools/puc/config')
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          // Ensure all known fields exist
          const base = {}
          CONFIG_FIELDS.forEach(f => { base[f.key] = '' })
          setCfg({ ...base, ...d.config })
          setSc(d.status_config.length ? d.status_config : [{ status: '', color: 'green' }])
        } else {
          setErr(d.error || 'Failed to load config')
        }
        setLoading(false)
      })
      .catch(() => { setErr('Could not reach server'); setLoading(false) })
    return () => window.removeEventListener('keydown', h)
  }, [])

  const save = async () => {
    setSaving(true); setErr('')
    try {
      const r = await fetch('/api/tools/puc/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: cfg, status_config: sc.filter(r => r.status.trim()) }),
      })
      const d = await r.json()
      if (d.ok) { setSaved(true); setTimeout(() => { onSaved(); onClose() }, 900) }
      else setErr(d.error || 'Save failed')
    } catch { setErr('Could not reach server') }
    setSaving(false)
  }

  const addScRow   = () => setSc(p => [...p, { status: '', color: 'green' }])
  const removeScRow = (i) => setSc(p => p.filter((_, idx) => idx !== i))
  const updateSc   = (i, key, val) => setSc(p => p.map((r, idx) => idx === i ? { ...r, [key]: val } : r))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <span className="modal-title">Configure — Payor Utils Certification</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div style={{ textAlign: 'center', padding: 24 }}><span className="spinner" /></div>
          ) : saved ? (
            <div className="alert alert-info">✓ Saved successfully.</div>
          ) : (
            <>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>General Settings</div>
              {CONFIG_FIELDS.map(f => (
                <div key={f.key} className="form-group">
                  <label className="field-label">{f.label}</label>
                  <input value={cfg?.[f.key] || ''} placeholder={f.placeholder}
                    onChange={e => setCfg(p => ({ ...p, [f.key]: e.target.value }))} />
                  {f.key === 'job_url' && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                      Use <code style={{ background: 'var(--surface2)', padding: '1px 4px', borderRadius: 3 }}>{'{version}'}</code> as a placeholder for the payor branch version.
                    </div>
                  )}
                </div>
              ))}

              <div style={{ fontWeight: 600, fontSize: 12, margin: '18px 0 10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status Color Mapping</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', padding: '3px 6px', fontWeight: 600 }}>Status Value</th>
                    <th style={{ textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', padding: '3px 6px', fontWeight: 600 }}>Color</th>
                    <th style={{ width: 32 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {sc.map((row, i) => (
                    <tr key={i}>
                      <td style={{ padding: '3px 4px' }}>
                        <input value={row.status} placeholder="e.g. SUCCESS"
                          onChange={e => updateSc(i, 'status', e.target.value)}
                          style={{ width: '100%', fontSize: 12 }} />
                      </td>
                      <td style={{ padding: '3px 4px' }}>
                        <select value={row.color || 'green'} onChange={e => updateSc(i, 'color', e.target.value)}
                          style={{ fontSize: 12, padding: '3px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}>
                          {COLOR_OPTIONS.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '3px 4px', textAlign: 'center' }}>
                        <button onClick={() => removeScRow(i)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 14, lineHeight: 1 }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn btn-sm" onClick={addScRow} style={{ marginBottom: 16 }}>+ Add Row</button>

              {err && <div className="alert alert-error">{err}</div>}
              <div className="flex-gap" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
                <button className="btn" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : '✓ Save'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function CreateModal({ onClose, onTriggered, jenkinsJobUrlTemplate }) {
  const [branch, setBranch] = useState('')
  const [busy,   setBusy]   = useState(false)
  const [err,    setErr]    = useState('')

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const derivedUrl = jenkinsJobUrlTemplate && branch.trim()
    ? jenkinsJobUrlTemplate.replace('{version}', branch.trim())
    : ''

  const submit = async () => {
    if (!branch.trim()) { setErr('Payor Branch Version is required.'); return }
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/tools/puc/trigger', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payor_version: branch.trim() }),
      })
      const d = await r.json()
      if (d.ok) { onTriggered(branch.trim()); onClose() }
      else setErr(d.error || 'Failed to trigger.')
    } catch { setErr('Request failed.') }
    setBusy(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <span className="modal-title">New PUC Run</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="field-label">Payor Branch Version *</label>
            <input placeholder="e.g. 26.1.1.1" value={branch}
              onChange={e => setBranch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()} autoFocus />
          </div>
          {derivedUrl && (
            <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 6, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Jenkins Job URL (auto-derived)</div>
              <code style={{ fontSize: 11, wordBreak: 'break-all', color: 'var(--text)' }}>{derivedUrl}</code>
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

export default function PucPage() {
  const navigate = useNavigate()
  const [rows,          setRows]          = useState([])
  const [meta,          setMeta]          = useState({})
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState('')
  const [liveStatus,    setLiveStatus]    = useState({})
  const [page,          setPage]          = useState(0)
  const [expanded,      setExpanded]      = useState({})
  const [refreshing,    setRefreshing]    = useState(new Set())
  const [certifying,    setCertifying]    = useState(new Set())
  const [certDetailPid, setCertDetailPid] = useState(null)
  const [pendingDelete,   setPendingDelete]   = useState(null)
  const [deleting,        setDeleting]        = useState(null)
  const [showCreate,      setShowCreate]      = useState(false)
  const [showConfig,      setShowConfig]      = useState(false)
  const [editingBaseline, setEditingBaseline] = useState(null)  // pid being edited
  const [baselineBuild,   setBaselineBuild]   = useState('')    // build number input
  const [savingBaseline,  setSavingBaseline]  = useState(false)

  // Op log terminal
  const [opStatus,  setOpStatus]  = useState(null)
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
    fetch('/api/tools/puc/scheduler-settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { auto_refresh_interval: String(Math.round(v / 60000)) } }),
    }).catch(() => {})
  }

  // Scheduler settings
  const [showScheduler, setShowScheduler] = useState(false)
  const [schedSettings, setSchedSettings] = useState([])
  const [schedSaving,   setSchedSaving]   = useState(false)
  const [schedSaved,    setSchedSaved]    = useState(false)
  const [schedErr,      setSchedErr]      = useState('')

  const loadSchedulerSettings = () => {
    fetch('/api/tools/puc/scheduler-settings')
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.settings) {
          setSchedSettings(d.settings)
          const arSetting = d.settings.find(s => s.key.toLowerCase() === 'auto_refresh_interval')
          if (arSetting) {
            const mins = parseInt(arSetting.value, 10) || 0
            const ms = mins * 60000
            if (AUTO_REFRESH_OPTS.some(o => o.value === ms)) {
              setAutoRefreshMs(ms)
              localStorage.setItem(AUTO_REFRESH_KEY, String(ms))
            }
          }
        }
      })
      .catch(() => {})
  }
  useEffect(() => { loadSchedulerSettings() }, [])

  const saveSchedulerSettings = async () => {
    setSchedSaving(true); setSchedSaved(false); setSchedErr('')
    try {
      const updates = {}
      schedSettings.forEach(s => { updates[s.key] = s.value })
      const r = await fetch('/api/tools/puc/scheduler-settings', {
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
    fetch('/api/tools/puc/projects')
      .then(r => r.json())
      .then(d => {
        const arr = Array.isArray(d) ? d : (d.rows || [])
        const m   = d.meta || {}
        setRows(arr)
        setMeta(m)
        setLiveStatus(prev => {
          const next = { ...prev }
          arr.forEach(p => {
            const k = String(p.pid)
            if (k in next && TERMINAL.has((p.status || '').toLowerCase())) delete next[k]
          })
          return next
        })
        setLoading(false)
      })
      .catch(() => { setError('Failed to load data.'); setLoading(false) })
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh table
  useEffect(() => {
    clearInterval(autoRefreshPollRef.current)
    if (autoRefreshMs > 0) autoRefreshPollRef.current = setInterval(() => load(), autoRefreshMs)
    return () => clearInterval(autoRefreshPollRef.current)
  }, [autoRefreshMs, load])

  // Scroll terminal to bottom on new output
  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [opOutput])

  function stopOpPoll() { clearInterval(opPollRef.current); opPollRef.current = null }

  function startOpPoll() {
    let pollCount = 0
    opPollRef.current = setInterval(() => {
      pollCount++
      fetch('/api/tools/puc/op-status')
        .then(r => r.json())
        .then(d => {
          if (!d.ok) return
          if (d.output) setOpOutput(d.output)
          if (d.status !== 'running') {
            stopOpPoll()
            setOpStatus(d.status)
            if (d.status === 'failed')  setOpErr('Run failed')
            if (d.status === 'aborted') setOpErr('Run aborted')
            load()
          } else if (pollCount % 4 === 0) {
            // Reload table every ~6s while running to pick up build_url as puc writes it
            load()
          }
        })
        .catch(() => {})
    }, 1500)
  }

  // On mount: restore in-progress run if browser was closed
  useEffect(() => {
    fetch('/api/tools/puc/op-status')
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.status === 'running') {
          setOpStatus('running'); setOpOutput(d.output || ''); setLogOpen(true)
          startOpPoll()
        } else if (d.ok && d.status && d.status !== null) {
          setOpStatus(d.status); setOpOutput(d.output || ''); setLogOpen(true)
          if (d.status === 'failed')  setOpErr('Run failed')
          if (d.status === 'aborted') setOpErr('Run aborted')
        }
      })
      .catch(() => {})
    return () => stopOpPoll()
  }, [])

  function onTriggered(version) {
    setOpStatus('running'); setOpOutput(''); setOpErr(null); setLogOpen(true)
    startOpPoll()
    // Reload table several times after trigger so the new row and build_url appear quickly
    ;[1500, 3000, 6000, 10000, 16000, 25000].forEach(delay => setTimeout(() => load(), delay))
  }

  function abortOp() { fetch('/api/tools/puc/op-abort', { method: 'POST' }).catch(() => {}) }

  function jobUrlForRow(row) {
    const tmpl = meta.jenkins_job_url || ''
    if (!tmpl || !row.payor_version) return ''
    return tmpl.replace('{version}', row.payor_version).replace(/\/$/, '')
  }

  async function saveBaseline(pid, buildNum, jobUrl) {
    if (!buildNum.trim()) return
    const fullUrl = `${jobUrl}/${buildNum.trim()}/`
    setSavingBaseline(true)
    try {
      const r = await fetch(`/api/tools/puc/projects/${encodeURIComponent(pid)}/baseline`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseline_url: fullUrl }),
      })
      const d = await r.json()
      if (d.ok) {
        setRows(prev => prev.map(r2 => String(r2.pid) === String(pid) ? { ...r2, baseline_url: fullUrl } : r2))
        setEditingBaseline(null)
        setBaselineBuild('')
      }
    } catch {}
    setSavingBaseline(false)
  }

  const githubRepo     = meta.github_repo_url || ''
  const releasePrefix  = meta.release_prefix  || ''
  const statusColorMap = useMemo(() => {
    const m = {}
    for (const item of (meta.status_config || []))
      m[item.status.toLowerCase()] = item.color
    return m
  }, [meta.status_config])

  const sorted     = [...rows].sort((a, b) => Number(b.pid || 0) - Number(a.pid || 0))
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE) || 1
  const pageRows   = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const refreshPid = useCallback(async (pid) => {
    setRefreshing(prev => new Set([...prev, pid]))
    try {
      const r = await fetch(`/api/tools/puc/projects/${encodeURIComponent(pid)}/status`)
      const d = await r.json()
      if (d.ok) {
        const isTerminal = TERMINAL.has((d.status || '').toLowerCase())
        setLiveStatus(prev => {
          const next = { ...prev }
          if (isTerminal) {
            delete next[String(pid)]
          } else {
            next[String(pid)] = { status: d.status, build_url: d.build_url || '', eta_seconds: d.eta_seconds ?? null }
          }
          return next
        })
        setRows(prev => prev.map(r2 => {
          if (String(r2.pid) !== String(pid)) return r2
          const upd = { ...r2 }
          if (d.status)    upd.status    = d.status
          if (d.build_url) upd.build_url = d.build_url
          return upd
        }))
      }
    } catch { /* ignore */ }
    setRefreshing(prev => { const n = new Set(prev); n.delete(pid); return n })
  }, [])

  // Auto-resolve queue_url → build_url: whenever rows change, call refreshPid for any
  // row that Jenkins has queued (has queue_url) but build hasn't started yet (no build_url).
  // refreshPid hits /api/tools/puc/projects/<pid>/status which queries Jenkins to resolve it.
  useEffect(() => {
    const toResolve = rows.filter(r => {
      const s = (r.status || '').toLowerCase()
      return r.queue_url && !r.build_url && !TERMINAL.has(s) && !refreshing.has(String(r.pid))
    })
    toResolve.forEach(r => refreshPid(String(r.pid)))
  }, [rows, refreshing, refreshPid])

  const certifyPid = useCallback(async (pid) => {
    setCertifying(prev => new Set([...prev, pid]))
    try {
      const r = await fetch(`/api/tools/puc/projects/${encodeURIComponent(pid)}/certify`, { method: 'POST' })
      const d = await r.json()
      if (d.ok) {
        setRows(prev => prev.map(r2 => {
          if (String(r2.pid) !== String(pid)) return r2
          return {
            ...r2,
            certification_status:  d.certification_status,
            jenkins_it_failures:   String(d.jenkins_failures  ?? ''),
            baseline_it_failures:  String(d.baseline_failures ?? ''),
          }
        }))
      }
    } catch { /* ignore */ }
    setCertifying(prev => { const n = new Set(prev); n.delete(pid); return n })
  }, [])

  const refreshPage = async () => {
    const toRefresh = pageRows.filter(r => {
      const s = (liveStatus[String(r.pid)]?.status || r.status || '').toLowerCase()
      return s && !TERMINAL.has(s)
    })
    await Promise.all(toRefresh.map(r => refreshPid(String(r.pid))))
    load()
  }

  const toggleExpand = (pid) => {
    const key     = String(pid)
    const willOpen = !expanded[key]
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))
    if (willOpen) refreshPid(key)
  }

  const deleteRow = async (id) => {
    setDeleting(id)
    try {
      await fetch(`/api/tools/puc/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
      setRows(prev => prev.filter(r => String(r.pid) !== String(id)))
    } catch { /* ignore */ }
    setDeleting(null)
    setPendingDelete(null)
  }

  return (
    <div>
      <button className="btn back-link" onClick={() => navigate('/workflow-projects')}
        style={{ marginBottom: 16, fontSize: 12, padding: '4px 10px' }}>
        ← Workflow Projects
      </button>

      <div className="page-header">
        <h1 className="page-title">Payor Utils Certification</h1>
        <div className="flex-gap" style={{ alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Auto-refresh:</span>
          <select value={autoRefreshMs} onChange={e => saveAutoRefresh(Number(e.target.value))} style={selStyle}>
            {AUTO_REFRESH_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)} disabled={opStatus === 'running'}>
            {opStatus === 'running' ? '● Running…' : '+ New Run'}
          </button>
          <button className="btn" onClick={refreshPage} disabled={refreshing.size > 0 || loading}
            title="Refresh eligible projects on this page via pucstatus">
            {refreshing.size > 0 ? '↺ Refreshing…' : '↺ Refresh'}
          </button>
          <button className="btn" onClick={() => setShowConfig(true)} title="Configure puc_config.xlsx">⚙ Configure</button>
          <button className="btn" onClick={() => { setShowScheduler(v => !v); setSchedSaved(false); setSchedErr('') }}
            title="Scheduler settings">
            ⏱ Scheduler
          </button>
        </div>
      </div>

      {showScheduler && (
        <div style={{ margin: '0 0 16px 0', padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Scheduler Settings</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(applies to all Payor Utils Certification runs)</span>
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

      {/* Log terminal panel */}
      {logOpen && (
        <div style={{ marginBottom: 20, borderRadius: 8, overflow: 'hidden', border: '1px solid #333', boxShadow: '0 2px 12px rgba(0,0,0,0.3)' }}>
          <div style={{ background: '#2d2d2d', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57', display: 'inline-block' }} />
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e', display: 'inline-block' }} />
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840', display: 'inline-block' }} />
            <span style={{ flex: 1, textAlign: 'center', fontSize: 12, color: '#aaa', fontFamily: 'Consolas, monospace' }}>
              Payor Utils Certification — Run Log
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {opOutput && (
                <button onClick={() => { navigator.clipboard.writeText(opOutput).catch(() => {}); setLogCopied(true); setTimeout(() => setLogCopied(false), 2000) }}
                  style={{ background: 'none', border: '1px solid #444', borderRadius: 4, cursor: 'pointer', color: logCopied ? '#4caf50' : '#888', fontSize: 11, padding: '1px 7px' }}>
                  {logCopied ? '✓ Copied' : 'Copy'}
                </button>
              )}
              {opStatus === 'running' && (
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
            {opStatus === 'running'
              ? <><span className="spinner" style={{ width: 10, height: 10, borderColor: '#888', borderTopColor: '#4caf50' }} /><span style={{ fontSize: 11, color: '#aaa' }}>Running…</span></>
              : opStatus === 'success'
                ? <span style={{ fontSize: 11, color: '#4caf50' }}>✓ Completed successfully</span>
                : opStatus === 'aborted'
                  ? <span style={{ fontSize: 11, color: '#ff9800' }}>⚠ Aborted</span>
                  : opStatus === 'failed'
                    ? <span style={{ fontSize: 11, color: '#f44336' }}>✗ Failed</span>
                    : null}
            {opStatus !== 'running' && (
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

      {/* Reopen terminal button */}
      {!logOpen && (opStatus === 'running' || opStatus) && (
        <div style={{ marginBottom: 12 }}>
          <button className="btn btn-sm" onClick={() => setLogOpen(true)}
            style={opStatus === 'running' ? { borderColor: '#4caf50', color: '#4caf50' } : {}}>
            {opStatus === 'running' ? '● View running log…' : '▤ View last run log'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="center"><span className="spinner" /></div>
      ) : sorted.length === 0 ? (
        <div className="empty"><h3>No PUC runs yet</h3><p>Trigger a new run to get started.</p></div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th>PID</th>
                  <th>Payor Branch Version</th>
                  <th>Jenkins Status</th>
                  <th>ETA</th>
                  <th>Triggered At</th>
                  <th>Build URL</th>
                  <th>Baseline URL</th>
                  <th>Cert Status</th>
                  <th style={{ width: 160 }}></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const pid       = String(row.pid)
                  const live      = liveStatus[pid] || {}
                  const effStatus  = live.status      || row.status    || ''
                  const effBuild   = live.build_url   || row.build_url || ''
                  const effEta     = live.eta_seconds !== undefined ? live.eta_seconds : row.eta_seconds
                  const isActive   = effStatus && !TERMINAL.has(effStatus.toLowerCase())
                  const certStatus = row.certification_status || ''
                  const isOpen    = !!expanded[pid]
                  const isSpin    = refreshing.has(pid)
                  const isCert    = certifying.has(pid)
                  const branchHref = githubRepo && row.payor_version
                    ? `${githubRepo}/tree/${releasePrefix}${row.payor_version}` : ''
                  return (
                    <React.Fragment key={pid}>
                      <tr style={{ cursor: 'pointer' }} onClick={() => toggleExpand(pid)}>
                        <td style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'center', userSelect: 'none' }}>
                          {isSpin ? <span className="spinner" style={{ width: 12, height: 12 }} /> : isOpen ? '▾' : '▸'}
                        </td>
                        <td><span style={{ fontWeight: 600 }}>{row.pid}</span></td>
                        <td onClick={e => e.stopPropagation()}>
                          {branchHref
                            ? <a href={branchHref} target="_blank" rel="noreferrer"
                                 className="mono" style={{ fontSize: 13 }}>
                                {row.payor_version}
                              </a>
                            : <span className="mono" style={{ fontSize: 13 }}>{row.payor_version || '—'}</span>}
                        </td>
                        <td><StatusBadge value={effStatus} colorMap={statusColorMap} /></td>
                        <td>
                          {isActive && effEta !== null && effEta !== undefined
                            ? <span style={{ fontSize: 12, color: effEta < 0 ? 'var(--warning, orange)' : 'var(--text-muted)' }}>
                                {fmtEta(effEta)}
                              </span>
                            : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td><span className="mono" style={{ fontSize: 12 }}>{(row.triggered_at || '').slice(0, 16)}</span></td>
                        <td onClick={e => e.stopPropagation()}>
                          {effBuild
                            ? <a href={effBuild} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 12 }}>↗ {buildNum(effBuild)}</a>
                            : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          {editingBaseline === pid ? (() => {
                            const jUrl = jobUrlForRow(row)
                            const preview = baselineBuild.trim() ? `${jUrl}/${baselineBuild.trim()}/` : ''
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
                                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                  <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Build #</span>
                                  <input value={baselineBuild} autoFocus
                                    onChange={e => setBaselineBuild(e.target.value.replace(/\D/g, ''))}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') saveBaseline(pid, baselineBuild, jUrl)
                                      if (e.key === 'Escape') { setEditingBaseline(null); setBaselineBuild('') }
                                    }}
                                    placeholder="e.g. 82"
                                    style={{ width: 64, fontSize: 12, padding: '2px 6px' }} />
                                  <button className="btn btn-sm btn-primary" disabled={savingBaseline || !baselineBuild.trim()}
                                    onClick={() => saveBaseline(pid, baselineBuild, jUrl)}
                                    style={{ padding: '2px 8px', fontSize: 11 }}>
                                    {savingBaseline ? '…' : '✓'}
                                  </button>
                                  <button className="btn btn-sm" onClick={() => { setEditingBaseline(null); setBaselineBuild('') }}
                                    style={{ padding: '2px 8px', fontSize: 11 }}>✕</button>
                                </div>
                                {preview && (
                                  <code style={{ fontSize: 10, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{preview}</code>
                                )}
                              </div>
                            )
                          })() : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              {row.baseline_url
                                ? <a href={row.baseline_url} target="_blank" rel="noreferrer"
                                     className="mono" style={{ fontSize: 12 }}>↗ {buildNum(row.baseline_url)}</a>
                                : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                              <button onClick={() => { setEditingBaseline(pid); setBaselineBuild(buildNum(row.baseline_url).replace('#', '')) }}
                                title="Set baseline build number"
                                className="btn btn-sm"
                                style={{ fontSize: 11, padding: '2px 7px' }}>
                                ✎ Edit
                              </button>
                            </div>
                          )}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          {certStatus
                            ? (certStatus.toLowerCase() === 'failed'
                              ? <span className={statusCls(certStatus, statusColorMap)} style={{ cursor: 'pointer' }}
                                  title="Click for failure stats and report"
                                  onClick={() => setCertDetailPid(pid)}>{certStatus}</span>
                              : <span className={statusCls(certStatus, statusColorMap)}>{certStatus}</span>)
                            : (
                              <button className="btn btn-sm" disabled={isCert}
                                onClick={() => certifyPid(pid)}
                                title="Compare IT failures with baseline and certify">
                                {isCert ? '…' : 'Certify'}
                              </button>
                            )}
                        </td>
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
                          <td colSpan={10} style={{ background: 'var(--surface2)', padding: '12px 16px 12px 32px' }}>
                            <DetailPanel row={row} live={live} githubRepo={githubRepo} releasePrefix={releasePrefix} colorMap={statusColorMap} />
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
          jenkinsJobUrlTemplate={meta.jenkins_job_url || ''}
        />
      )}

      {showConfig && (
        <ConfigModal
          onClose={() => setShowConfig(false)}
          onSaved={load}
        />
      )}

      {certDetailPid && (
        <CertDetailsModal pid={certDetailPid} onClose={() => setCertDetailPid(null)} />
      )}
    </div>
  )
}
