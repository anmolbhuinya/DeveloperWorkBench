import IntegGroupPicker, { selectedIntegGroups } from '../components/IntegGroupPicker'
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import WorkflowBackButton from '../components/WorkflowBackButton'

const PAGE_SIZE = 10
const TERMINAL  = new Set(['passed', 'failed', 'cancelled', 'completed'])

const REFRESH_RATE_KEY = 'gp_run_refresh_rate'
const REFRESH_OPTIONS  = [
  { label: 'Off',  value: 0        },
  { label: '1m',   value: 60000    },
  { label: '2m',   value: 120000   },
  { label: '5m',   value: 300000   },
  { label: '10m',  value: 600000   },
  { label: '15m',  value: 900000   },
  { label: '20m',  value: 1200000  },
  { label: '30m',  value: 1800000  },
]

function StatusBadge({ value }) {
  const v = (value || '').toLowerCase()
  let cls = 'badge badge-pending'
  if (['passed', 'completed'].some(s => v.includes(s)))                                           cls = 'badge badge-success'
  else if (['failed', 'error'].some(s => v.includes(s)))                                          cls = 'badge badge-danger'
  else if (['running', 'scheduled', 'triggered', 'building', 'created'].some(s => v.includes(s))) cls = 'badge badge-warning'
  else if (['cancelled', 'aborted'].some(s => v.includes(s)))                                     cls = 'badge badge-skipped'
  return <span className={cls}>{value || '—'}</span>
}

function PrBadge({ prUrl, prStatus }) {
  if (!prUrl) return <span style={{ color: 'var(--text-muted)' }}>—</span>
  const s = (prStatus || '').toLowerCase().trim()
  let bg, color, border, label
  if (s === 'merged') {
    bg = 'rgba(130,80,200,0.12)'; color = '#7c3aed'; border = 'rgba(130,80,200,0.35)'; label = 'Merged'
  } else if (s === 'closed') {
    bg = 'rgba(220,38,38,0.1)';  color = '#b91c1c'; border = 'rgba(220,38,38,0.3)';   label = 'Closed'
  } else if (s === 'draft') {
    bg = 'rgba(100,100,100,0.1)'; color = 'var(--text-muted)'; border = 'var(--border)'; label = 'Draft'
  } else {
    bg = 'rgba(22,163,74,0.1)';  color = '#166534'; border = 'rgba(22,163,74,0.3)';   label = s === 'open' ? 'Open' : (s || 'PR')
  }
  return (
    <a href={prUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: bg, color, border: `1px solid ${border}`, whiteSpace: 'nowrap', cursor: 'pointer' }}>
        {label}
      </span>
    </a>
  )
}

function SonarQgBadge({ qg, to }) {
  const cls = qg === 'OK' ? 'badge badge-success' : qg === 'ERROR' ? 'badge badge-danger' : 'badge badge-pending'
  const label = qg === 'OK' ? 'Passed' : qg === 'ERROR' ? 'Failed' : 'Sonar'
  if (to) return <Link to={to} style={{ textDecoration: 'none' }}><span className={cls}>{label}</span></Link>
  return <span className={cls}>{label}</span>
}

function fmtEta(sec) {
  if (sec === null || sec === undefined) return null
  const sign = sec < 0 ? '+' : ''
  const abs  = Math.abs(Math.round(sec))
  const m    = Math.floor(abs / 60), s = abs % 60
  return sign + (m ? `${m}m ` : '') + `${s}s`
}

function DetailPanel({ row, live, jiraBase, githubRepo }) {
  const merged = {
    ...row,
    ...(live?.status    ? { status:    live.status }    : {}),
    ...(live?.sonar_url ? { sonar_url: live.sonar_url } : {}),
  }
  const entries = Object.entries(merged).filter(([k, v]) =>
    v != null && v !== '' && !['eta_seconds', 'sonar_url', 'jira_base_url'].includes(k)
  )
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: '10px 28px' }}>
      {entries.map(([k, v]) => {
        let href = ''
        if (String(v).startsWith('http')) href = String(v)
        else if (k === 'ticket_id'      && jiraBase && v) href = `${jiraBase}/browse/${v}`
        else if (k === 'feature_branch' && githubRepo && v) href = `${githubRepo}/tree/${v}`
        else if (k === 'dest_branch'    && githubRepo && v) href = `${githubRepo}/tree/${v}`
        const sonarU = live?.sonar_url || row.sonar_url || ''
        if (k === 'sonar' && sonarU) return (
          <div key={k}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: 2 }}>{k}</div>
            <a href={sonarU} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 12 }}>↗ sonar dashboard</a>
          </div>
        )
        return (
          <div key={k}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: 2 }}>{k}</div>
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

const GP_ACTIVE_RUN_KEY = 'gp_active_run_id'

// ---------------------------------------------------------------------------
// In-page terminal panel for a running GP process
// ---------------------------------------------------------------------------
function GpTerminal({ runId, onClose, onDone }) {
  const [output,   setOutput]   = useState('')
  const [status,   setStatus]   = useState('running')
  const [aborting, setAborting] = useState(false)
  const outputRef = useRef(null)
  const pollRef   = useRef(null)

  useEffect(() => {
    if (!runId) return
    function poll() {
      fetch(`/api/tools/gp-run/output/${runId}`)
        .then(r => r.json())
        .then(d => {
          if (!d.ok) {
            clearInterval(pollRef.current)
            setStatus('lost')
            onDone && onDone('lost')
            return
          }
          setOutput(d.output || '')
          setStatus(d.status)
          if (d.status !== 'running') {
            clearInterval(pollRef.current)
            onDone && onDone(d.status)
          }
        })
        .catch(() => {})
    }
    poll()
    pollRef.current = setInterval(poll, 1000)
    return () => clearInterval(pollRef.current)
  }, [runId])

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [output])

  async function abort() {
    setAborting(true)
    try {
      await fetch(`/api/tools/gp-run/abort/${runId}`, { method: 'POST' })
      setStatus('aborted')
      clearInterval(pollRef.current)
      localStorage.removeItem(GP_ACTIVE_RUN_KEY)
      onDone && onDone('aborted')
    } catch (_) {}
    setAborting(false)
  }

  const isRunning = status === 'running'
  const statusColor = isRunning ? '#f0ad4e'
    : status === 'done'    ? '#4caf50'
    : status === 'failed'  ? '#f44336'
    : status === 'aborted' ? '#f44336'
    : status === 'lost'    ? '#9e9e9e'
    : '#9e9e9e'

  return (
    <div style={{ marginTop: 24, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '7px 14px', background: '#161b22', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: '#58a6ff', fontWeight: 600 }}>GP Run — Output</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: statusColor, display: 'flex', alignItems: 'center', gap: 5 }}>
            {isRunning && <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5, borderColor: statusColor, borderTopColor: 'transparent' }} />}
            {status}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isRunning && (
            <button
              className="btn btn-sm"
              onClick={abort}
              disabled={aborting}
              style={{ color: '#f44336', borderColor: '#4d1e1e', fontSize: 11 }}
            >
              {aborting ? '…' : '✕ Abort'}
            </button>
          )}
          <button className="btn btn-sm" onClick={onClose} style={{ fontSize: 11, padding: '1px 8px' }}>✕ Close</button>
        </div>
      </div>
      <pre
        ref={outputRef}
        style={{
          margin: 0, padding: '10px 14px', fontSize: 11,
          background: '#0d1117', color: '#c9d1d9',
          maxHeight: 320, overflow: 'auto',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          fontFamily: 'Consolas, monospace', lineHeight: 1.5,
        }}
      >
        {output || <span style={{ color: 'var(--text-muted)' }}>Starting…</span>}
      </pre>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create modal
// ---------------------------------------------------------------------------
const INTEG_SETTINGS_LS = 'gp_integ_settings'

// Clone starts from the source project's own Auto Merge / Sonar / Integration Test choices (kept in its config file)
async function withCloneInfo(app, row) {
  try {
    const r = await fetch(`/api/tools/gp-run/clone-info?app=${encodeURIComponent(app)}&pid=${encodeURIComponent(row.project_id)}`)
    const d = await r.json()
    if (d.ok) return { ...row, ...d }
  } catch { /* fall back to the row */ }
  return row
}

function CreateModal({ onClose, initial, releaseBranch, featureBranch, app }) {
  const isYes = v => String(v || '').toLowerCase() === 'yes'
  const _isMaster = b => b === 'master' || b === 'main'
  const computedDest = releaseBranch
    ? (_isMaster(releaseBranch) ? releaseBranch : `release-${releaseBranch}`)
    : ''
  const [form, setForm] = useState({
    feature_branch:       initial?.feature_branch || featureBranch || '',
    dest_branch:          computedDest || initial?.dest_branch || '',
    auto_merge:           initial ? isYes(initial.auto_merge)           : false,
    run_sonar:            initial ? isYes(initial.run_sonar ?? initial.sonar) : true,
    run_integration_test: initial ? isYes(initial.run_integration_test) : false,
  })
  const [destEdited,    setDestEdited]    = useState(false)
  const [featureEdited, setFeatureEdited] = useState(false)
  // Update fields when branch data arrives after mount (async timing)
  useEffect(() => {
    if (!destEdited && releaseBranch) {
      setForm(f => ({ ...f, dest_branch: _isMaster(releaseBranch) ? releaseBranch : `release-${releaseBranch}` }))
    }
  }, [releaseBranch])
  useEffect(() => {
    if (!featureEdited && featureBranch) {
      setForm(f => ({ ...f, feature_branch: featureBranch }))
    }
  }, [featureBranch])
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState('')
  const [showIntegSettings, setShowIntegSettings] = useState(false)
  const [integCategories,   setIntegCategories]   = useState([])
  const [integGroups,       setIntegGroups]       = useState({})
  const [integSettings, setIntegSettings] = useState(() => {
    const saved = (() => { try { return JSON.parse(localStorage.getItem(INTEG_SETTINGS_LS) || '{}') } catch { return {} } })()
    if (!initial) return saved
    return {
      ...saved,
      ...(initial.integ_category ? { category:      initial.integ_category } : {}),
      ...(initial.integ_custom   ? { custom_groups: initial.integ_custom   } : {}),
    }
  })

  useEffect(() => {
    fetch(`/api/tools/gp-run/integ-config?app=${encodeURIComponent(app)}`)
      .then(r => r.json())
      .then(d => {
        if (!d.ok) return
        setIntegCategories(d.categories); setIntegGroups(d.groups || {})
        // Clone: re-check exactly the groups the source project ran with
        if (initial?.integ_groups) {
          const cat = initial.integ_category || 'Platform'
          const picked = new Set(String(initial.integ_groups).split(',').map(x => x.trim()).filter(Boolean))
          const excluded = (d.groups?.[cat] || []).filter(g => !picked.has(g))
          setIntegSettings(p => ({ ...p, excluded: { ...(p.excluded || {}), [cat]: excluded } }))
        }
      })
      .catch(() => {})
  }, [app])

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(false, null) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  function saveInteg(upd) {
    const next = { ...integSettings, ...upd }
    setIntegSettings(next)
    localStorage.setItem(INTEG_SETTINGS_LS, JSON.stringify(next))
  }

  const submit = async () => {
    if (!form.feature_branch.trim()) { setErr('Feature Branch is required.'); return }
    if (!form.dest_branch.trim()) { setErr('Dest Branch is required.'); return }
    const catKey       = integSettings.category || 'Platform'
    const catGroups    = integGroups[catKey] || []
    const pickedGroups = selectedIntegGroups(catGroups, (integSettings.excluded || {})[catKey])
    const useCustom    = !!(integSettings.custom_groups || '').trim()
    if (form.run_integration_test && !useCustom && catGroups.length > 0 && pickedGroups.length === 0) {
      setErr('Select at least one INTEG_TEST_GROUP.'); return
    }
    setBusy(true); setErr('')
    try {
      const payload = {
        app:                   app,
        feature_branch:        form.feature_branch,
        dest_branch:           form.dest_branch,
        auto_merge:            form.auto_merge ? 'yes' : 'no',
        run_sonar:             form.run_sonar  ? 'yes' : 'no',
        run_integration_test:  form.run_integration_test ? 'yes' : 'no',
        integ_category:        form.run_integration_test ? (integSettings.category || 'Platform') : '',
        integ_custom:          form.run_integration_test ? (integSettings.custom_groups || '') : '',
        // only sent when something was deselected; otherwise the category's full list applies
        integ_groups:          form.run_integration_test && !useCustom && pickedGroups.length < catGroups.length ? pickedGroups.join(',') : '',
      }
      const r = await fetch('/api/tools/gp-run/trigger', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await r.json()
      if (d.ok) {
        onClose(true, d.run_id)
      } else {
        setErr(d.error || 'Failed to trigger.')
      }
    } catch { setErr('Request failed.') }
    setBusy(false)
  }

  const catOptions = integCategories.length > 0 ? integCategories : ['Platform']
  const currentCat = integSettings.category || 'Platform'

  return (
    <div className="modal-overlay" onClick={() => onClose(false, null)}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <span className="modal-title">{initial ? `Clone GP Run (${app})` : `New GP Run — ${app}`}</span>
          <button className="modal-close" onClick={() => onClose(false, null)}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="field-label">Feature Branch</label>
            <input placeholder="e.g. feature/PAYOR-208524" value={form.feature_branch}
              onChange={e => { setFeatureEdited(true); setForm(p => ({ ...p, feature_branch: e.target.value })) }}
              onKeyDown={e => e.key === 'Enter' && submit()} />
          </div>
          <div className="form-group">
            <label className="field-label">Dest Branch *</label>
            <input placeholder="e.g. release-26.2.1.0.1" value={form.dest_branch}
              onChange={e => { setDestEdited(true); setForm(p => ({ ...p, dest_branch: e.target.value })) }}
              onKeyDown={e => e.key === 'Enter' && submit()} />
          </div>

          <div style={{ display: 'flex', gap: 20, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {[
              { name: 'auto_merge', label: 'Auto Merge' },
              { name: 'run_sonar',  label: 'Run Sonar'  },
            ].map(f => (
              <label key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                <input type="checkbox" checked={form[f.name]}
                  onChange={e => setForm(p => ({ ...p, [f.name]: e.target.checked }))}
                  style={{ width: 16, height: 16, cursor: 'pointer' }} />
                {f.label}
              </label>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                <input type="checkbox" checked={form.run_integration_test}
                  onChange={e => setForm(p => ({ ...p, run_integration_test: e.target.checked }))}
                  style={{ width: 16, height: 16, cursor: 'pointer' }} />
                Integration Test
              </label>
              <button
                type="button"
                title="Configure integration test settings"
                onClick={() => setShowIntegSettings(p => !p)}
                style={{
                  background: showIntegSettings ? 'rgba(88,166,255,0.12)' : 'transparent',
                  border: '1px solid ' + (showIntegSettings ? '#58a6ff' : 'var(--border)'),
                  borderRadius: 5, cursor: 'pointer', padding: '2px 6px',
                  color: showIntegSettings ? '#58a6ff' : 'var(--text-muted)', fontSize: 14,
                  lineHeight: 1,
                }}
              >⚙</button>
            </div>
          </div>

          {showIntegSettings && (
            <div style={{
              border: '1px solid var(--border)', borderRadius: 8,
              background: 'var(--surface2)', padding: '12px 14px',
              marginBottom: 12,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#58a6ff', marginBottom: 10 }}>
                Integration Test Settings
              </div>
              <div className="form-group" style={{ marginBottom: 10 }}>
                <label className="field-label" style={{ fontSize: 11 }}>Test Group Category</label>
                <select
                  value={currentCat}
                  onChange={e => saveInteg({ category: e.target.value })}
                  style={{ fontSize: 13, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', width: '100%' }}
                >
                  {catOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <IntegGroupPicker
                groups={integGroups[currentCat] || []}
                excluded={(integSettings.excluded || {})[currentCat]}
                disabled={!!(integSettings.custom_groups || '').trim()}
                onChange={ex => saveInteg({ excluded: { ...(integSettings.excluded || {}), [currentCat]: ex } })} />
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="field-label" style={{ fontSize: 11 }}>Custom Test Groups <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(comma-separated, overrides category)</span></label>
                <textarea
                  value={integSettings.custom_groups || ''}
                  onChange={e => saveInteg({ custom_groups: e.target.value })}
                  placeholder="e.g. com.healthedge.cvc.impl.finance.billing.test.**"
                  rows={3}
                  style={{ fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', width: '100%', resize: 'vertical', fontFamily: 'monospace', boxSizing: 'border-box' }}
                />
              </div>
            </div>
          )}

          {err && <div className="alert alert-error">{err}</div>}
          <div className="flex-gap" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" onClick={() => onClose(false, null)}>Cancel</button>
            <button className="btn btn-primary" onClick={submit} disabled={busy}>
              {busy ? 'Triggering…' : '▶ Trigger Run'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Config modal (config.xlsx — application + url table)
// ---------------------------------------------------------------------------
const _gpCfgInputStyle = { fontSize: 12, width: '100%', padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'monospace' }

function ConfigModal({ initialApp, apps: appsProp, onAppsChanged, onClose }) {
  const [modalApps,   setModalApps]   = useState(appsProp || [])
  const [activeTab,   setActiveTab]   = useState(initialApp || (appsProp || [])[0] || '')
  const [urlsByApp,   setUrlsByApp]   = useState({})
  const [loadingCfg,  setLoadingCfg]  = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [err,         setErr]         = useState('')
  const [saved,       setSaved]       = useState(false)
  const [showAddTab,  setShowAddTab]  = useState(false)
  const [newAppName,  setNewAppName]  = useState('')
  const [addingApp,   setAddingApp]   = useState(false)
  const [addErr,      setAddErr]      = useState('')
  const [confirmDel,  setConfirmDel]  = useState(false)
  const [deletingApp, setDeletingApp] = useState(false)
  const [delErr,      setDelErr]      = useState('')
  const newAppRef = useRef(null)

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  useEffect(() => {
    fetch('/api/tools/gp-run/config')
      .then(r => r.json())
      .then(d => {
        const rows = d.apps || []
        const appsList = rows.map(r => r.application).filter(Boolean)
        const map = {}
        rows.forEach(r => { map[r.application] = r.url || '' })
        setUrlsByApp(map)
        if (appsList.length > 0) {
          setModalApps(appsList)
          setActiveTab(prev => (prev && appsList.includes(prev)) ? prev : appsList[0])
        }
        setLoadingCfg(false)
      })
      .catch(() => setLoadingCfg(false))
  }, [])

  useEffect(() => {
    if (showAddTab && newAppRef.current) newAppRef.current.focus()
  }, [showAddTab])

  const save = async () => {
    setSaving(true); setErr(''); setSaved(false)
    try {
      const appsPayload = modalApps.map(a => ({ application: a, url: urlsByApp[a] || '' }))
      const r = await fetch('/api/tools/gp-run/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apps: appsPayload }),
      })
      const d = await r.json()
      if (d.ok) setSaved(true)
      else setErr(d.error || 'Save failed.')
    } catch { setErr('Request failed.') }
    setSaving(false)
  }

  const addApp = async () => {
    const name = newAppName.trim()
    if (!name) return
    setAddingApp(true); setAddErr('')
    try {
      const r = await fetch('/api/tools/gp-run/apps', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const d = await r.json()
      if (!d.ok) { setAddErr(d.error || 'Failed to add app.'); setAddingApp(false); return }
      setModalApps(d.apps || [])
      onAppsChanged && onAppsChanged(d.apps || [])
      setUrlsByApp(prev => ({ ...prev, [name]: '' }))
      setActiveTab(name)
      setShowAddTab(false)
      setNewAppName('')
    } catch { setAddErr('Request failed.') }
    setAddingApp(false)
  }

  const deleteApp = async () => {
    setDeletingApp(true); setDelErr('')
    try {
      const r = await fetch(`/api/tools/gp-run/apps/${encodeURIComponent(activeTab)}`, { method: 'DELETE' })
      const d = await r.json()
      if (!d.ok) { setDelErr(d.error || 'Failed to delete app.'); setDeletingApp(false); return }
      setModalApps(d.apps || [])
      onAppsChanged && onAppsChanged(d.apps || [])
      setActiveTab((d.apps || [])[0] || '')
      setConfirmDel(false)
    } catch { setDelErr('Request failed.') }
    setDeletingApp(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
        <div className="modal-header">
          <span className="modal-title">Configure Applications</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '2px solid var(--border)', marginBottom: 16, gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            {modalApps.map(a => (
              <button key={a} onClick={() => { setActiveTab(a); setConfirmDel(false); setShowAddTab(false) }}
                style={{
                  padding: '5px 12px', fontSize: 12, fontWeight: activeTab === a ? 600 : 400,
                  border: 'none', borderBottom: activeTab === a ? '2px solid var(--primary)' : '2px solid transparent',
                  marginBottom: -2, background: 'none', cursor: 'pointer',
                  color: activeTab === a ? 'var(--primary)' : 'var(--text-muted)',
                }}>
                {a}
              </button>
            ))}
            <button
              onClick={() => { setShowAddTab(true); setConfirmDel(false) }}
              title="Add application"
              style={{
                padding: '4px 10px', fontSize: 14, border: 'none', background: 'none',
                cursor: 'pointer', color: 'var(--text-muted)', marginBottom: -2,
                borderBottom: showAddTab ? '2px solid var(--primary)' : '2px solid transparent',
              }}>
              +
            </button>
          </div>

          {/* Add new app inline */}
          {showAddTab && (
            <div style={{ marginBottom: 16, padding: 12, background: 'var(--surface)', borderRadius: 6, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>New application name</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  ref={newAppRef}
                  value={newAppName}
                  onChange={e => { setNewAppName(e.target.value); setAddErr('') }}
                  onKeyDown={e => { if (e.key === 'Enter') addApp(); if (e.key === 'Escape') { setShowAddTab(false); setNewAppName('') } }}
                  placeholder="e.g. Enrollment"
                  style={{ ..._gpCfgInputStyle, flex: 1, fontFamily: 'inherit' }}
                />
                <button className="btn btn-primary btn-sm" onClick={addApp} disabled={addingApp || !newAppName.trim()}>
                  {addingApp ? 'Adding…' : 'Add'}
                </button>
                <button className="btn btn-sm" onClick={() => { setShowAddTab(false); setNewAppName(''); setAddErr('') }}>
                  Cancel
                </button>
              </div>
              {addErr && <div style={{ color: '#f44336', fontSize: 12, marginTop: 6 }}>{addErr}</div>}
            </div>
          )}

          {/* Tab content */}
          {!showAddTab && activeTab && (
            loadingCfg
              ? <div className="center"><span className="spinner" /></div>
              : (
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Jenkins URL</label>
                  <input
                    value={urlsByApp[activeTab] || ''}
                    onChange={e => setUrlsByApp(prev => ({ ...prev, [activeTab]: e.target.value }))}
                    placeholder="http://jenkins-host/job/..."
                    style={{ ..._gpCfgInputStyle, marginTop: 4 }}
                  />
                </div>
              )
          )}

          {err  && <div className="alert alert-error"   style={{ marginTop: 12 }}>{err}</div>}
          {saved && <div style={{ color: '#4caf50', fontSize: 12, marginTop: 12 }}>Saved successfully.</div>}

          {/* Delete confirmation */}
          {confirmDel && (
            <div style={{ marginTop: 16, padding: 12, background: '#2d1515', border: '1px solid #7c2222', borderRadius: 6 }}>
              <div style={{ fontSize: 12, color: '#f44336', marginBottom: 8 }}>
                This will permanently delete all projects, run history, and GP parameters for <strong>{activeTab}</strong>. This action cannot be undone.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm btn-danger" onClick={deleteApp} disabled={deletingApp}>
                  {deletingApp ? 'Deleting…' : 'Confirm Delete'}
                </button>
                <button className="btn btn-sm" onClick={() => { setConfirmDel(false); setDelErr('') }}>Cancel</button>
              </div>
              {delErr && <div style={{ color: '#f44336', fontSize: 12, marginTop: 6 }}>{delErr}</div>}
            </div>
          )}

          <div className="flex-gap" style={{ justifyContent: 'space-between', marginTop: 20, alignItems: 'center' }}>
            <div>
              {!confirmDel && activeTab && !showAddTab && (
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => setConfirmDel(true)}
                  style={{ opacity: 0.8 }}>
                  Delete Application
                </button>
              )}
            </div>
            <div className="flex-gap">
              <button className="btn" onClick={onClose}>Close</button>
              <button className="btn btn-primary" onClick={save} disabled={saving || loadingCfg}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// GP Params modal (per-app gp_params xlsx)
// ---------------------------------------------------------------------------
function GpParamsModal({ app, onClose }) {
  const [params,    setParams]    = useState([])
  const [exists,    setExists]    = useState(true)
  const [loading,   setLoading]   = useState(true)
  const [busy,      setBusy]      = useState(false)
  const [fetching,  setFetching]  = useState(false)
  const [err,       setErr]       = useState('')
  const [saved,     setSaved]     = useState(false)
  const [fetchOut,  setFetchOut]  = useState('')

  const loadParams = useCallback(() => {
    setLoading(true); setErr('')
    fetch(`/api/tools/gp-run/gp-params/${encodeURIComponent(app)}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setParams(d.parameters || []); setExists(d.exists !== false) }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [app])

  useEffect(() => { loadParams() }, [loadParams])

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const save = async () => {
    setBusy(true); setErr(''); setSaved(false)
    try {
      const r = await fetch(`/api/tools/gp-run/gp-params/${encodeURIComponent(app)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parameters: params }),
      })
      const d = await r.json()
      if (d.ok) setSaved(true)
      else setErr(d.error || 'Save failed.')
    } catch { setErr('Request failed.') }
    setBusy(false)
  }

  const fetchFromJenkins = async () => {
    setFetching(true); setFetchOut(''); setErr(''); setSaved(false)
    try {
      const r = await fetch(`/api/tools/gp-run/fetch-params/${encodeURIComponent(app)}`, { method: 'POST' })
      const d = await r.json()
      setFetchOut(d.output || (d.ok ? 'Done.' : d.error || 'Failed.'))
      if (d.ok) loadParams()
      else setErr(d.error || 'Fetch failed.')
    } catch { setErr('Request failed.') }
    setFetching(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 740 }}>
        <div className="modal-header">
          <span className="modal-title">GP Params — {app}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {loading ? <div className="center"><span className="spinner" /></div> : !exists ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              <p>No gp_params file found for <strong>{app}</strong>.</p>
              <p style={{ fontFamily: 'monospace', background: 'var(--surface2)', padding: '8px 12px', borderRadius: 6, marginTop: 8 }}>
                Click <strong>Fetch from Jenkins</strong> to populate parameters from Jenkins.
              </p>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                Edit the <strong>value</strong> column. Other columns are read-only (from Jenkins).
              </div>
              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Parameter', 'Value', 'Type', 'Default', 'Description'].map(h => (
                        <th key={h} style={{ textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', padding: '4px 6px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {params.map((p, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '4px 6px', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>{p.parameter}</td>
                        <td style={{ padding: '4px 6px' }}>
                          <input value={p.value || ''} onChange={e => setParams(prev => prev.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}
                            style={{ fontSize: 12, width: '100%', minWidth: 120, padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'monospace' }} />
                        </td>
                        <td style={{ padding: '4px 6px', fontSize: 11, color: 'var(--text-muted)' }}>{p.type}</td>
                        <td style={{ padding: '4px 6px', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{p.default}</td>
                        <td style={{ padding: '4px 6px', fontSize: 11, color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.description}>{p.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
              {exists && !loading && (
                <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Local-branch setup helpers (shared by page + tab)
// ---------------------------------------------------------------------------
const _APP_SLUG_GP    = { PAYOR:'payor', CLASSIC:'classic', CONNECTOR:'connector', ENROLLMENT:'enrollment', PIK:'pik' }
const _APP_DISPLAY_GP = { payor:'Payor', classic:'Classic', connector:'Connector', enrollment:'Enrollment', pik:'PIK' }

function gpLocalPath(appName) {
  const slug = _APP_SLUG_GP[(appName||'').toUpperCase()] || (appName||'').toLowerCase()
  return slug ? `/local-app/${slug}` : null
}
function gpDisplayName(appName) {
  const slug = _APP_SLUG_GP[(appName||'').toUpperCase()] || (appName||'').toLowerCase()
  return _APP_DISPLAY_GP[slug] || appName
}

const SIC = { ok:'✓', warning:'⚠', error:'✗', running:'…' }
const SCL = { ok:'#2e7d32', warning:'#e65100', error:'#c62828', running:'var(--text-muted)' }

function BranchSetupModal({ setup, onNavigate, onClose }) {
  if (!setup) return null
  const isBuildBlock = setup.phase === 'error' && setup.steps?.length === 1 && setup.steps[0]?.label === 'Build check'
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <span className="modal-title">Local Branch Setup — {setup.appName}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {setup.phase === 'running' ? (
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 0' }}>
              <span className="spinner" />
              <span style={{ fontSize:13, color:'var(--text-muted)' }}>Setting up branch…</span>
            </div>
          ) : (
            <>
              {(setup.steps || []).map((s, i) => (
                <div key={i} style={{ display:'flex', gap:8, alignItems:'flex-start', padding:'3px 0', fontSize:12 }}>
                  <span style={{ color: SCL[s.status] || 'var(--text-muted)', fontWeight:600, minWidth:14, flexShrink:0 }}>{SIC[s.status] || '•'}</span>
                  <span style={{ fontWeight:500, minWidth:130, flexShrink:0 }}>{s.label}</span>
                  {s.detail && <span style={{ color:'var(--text-muted)', fontFamily:'monospace', fontSize:11, wordBreak:'break-all' }}>{s.detail}</span>}
                </div>
              ))}
              {setup.phase === 'error' && setup.error && (
                <div style={{ color: isBuildBlock ? '#e65100' : '#c62828', background: isBuildBlock ? '#fff3e0' : 'rgba(198,40,40,0.06)', border:`1px solid ${isBuildBlock ? '#ffcc80' : 'rgba(198,40,40,0.2)'}`, borderRadius:5, padding:'8px 12px', fontSize:12, marginTop:8 }}>
                  {isBuildBlock ? '⚠' : '✗'} {setup.error}
                </div>
              )}
              {setup.phase === 'done' && setup.localAppPath && (
                <button onClick={() => { onNavigate(setup.localAppPath); onClose() }}
                  style={{ marginTop:12, fontSize:13, fontWeight:600, padding:'6px 18px', background:'#1565c0', color:'#fff', border:'none', borderRadius:5, cursor:'pointer' }}>
                  Go to {setup.appName} →
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function GpRunPage() {
  const navigate = useNavigate()
  const [apps,      setApps]      = useState([])
  const [activeApp, setActiveApp] = useState(() => localStorage.getItem('gp_active_app') || 'Payor')
  const [rows,          setRows]          = useState([])
  const [meta,          setMeta]          = useState({})
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState('')
  const [liveStatus,    setLiveStatus]    = useState({})
  const [page,          setPage]          = useState(0)
  const [expanded,      setExpanded]      = useState({})
  const [refreshing,    setRefreshing]    = useState(new Set())
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting,      setDeleting]      = useState(null)
  const [showCreate,    setShowCreate]    = useState(false)
  const [cloneSource,   setCloneSource]   = useState(null)
  const [showConfig,    setShowConfig]    = useState(false)
  const [showGpParams,  setShowGpParams]  = useState(false)
  const [activeRunId,   setActiveRunId]   = useState(() => localStorage.getItem(GP_ACTIVE_RUN_KEY) || null)
  const [refreshRate,   setRefreshRate]   = useState(() => {
    const saved = parseInt(localStorage.getItem(REFRESH_RATE_KEY), 10)
    return REFRESH_OPTIONS.some(o => o.value === saved) ? saved : 60000
  })
  const [branchSetup,   setBranchSetup]   = useState(null)
  const [featureBranch, setFeatureBranch] = useState(null)
  const sonarFetchedRef = useRef(new Set())
  const [showScheduler,  setShowScheduler]  = useState(false)
  const [schedSettings,  setSchedSettings]  = useState([])
  const [schedSaving,    setSchedSaving]    = useState(false)
  const [schedSaved,     setSchedSaved]     = useState(false)
  const [schedErr,       setSchedErr]       = useState('')

  const loadSchedulerSettings = () => {
    fetch('/api/tools/gp-run/scheduler-settings')
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.settings) {
          setSchedSettings(d.settings)
          const pollSetting = d.settings.find(s => s.key.toLowerCase() === 'poll_interval_s')
          if (pollSetting) {
            const ms = (parseInt(pollSetting.value, 10) || 0) * 1000
            if (ms > 0 && REFRESH_OPTIONS.some(o => o.value === ms)) {
              setRefreshRate(ms); localStorage.setItem(REFRESH_RATE_KEY, String(ms))
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
      const r = await fetch('/api/tools/gp-run/scheduler-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: updates }),
      })
      const d = await r.json()
      if (d.ok) { setSchedSaved(true); loadSchedulerSettings() }
      else setSchedErr(d.error || 'Failed to save')
    } catch { setSchedErr('Network error') }
    finally { setSchedSaving(false) }
  }

  useEffect(() => {
    if (!activeApp) return
    setFeatureBranch(null)
  }, [activeApp])

  const doSetupLocalBranch = useCallback(async (branchName, appName) => {
    if (!branchName || !appName) return
    const localAppPath = gpLocalPath(appName)
    const displayName  = gpDisplayName(appName)
    setBranchSetup({ phase:'running', steps:[], error:null, localAppPath, appName: displayName })
    try {
      const d = await fetch('/api/project-management/sprint/project-setup-branch', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ branch_name: branchName, application: appName.toUpperCase() }),
      }).then(r => r.json())
      setBranchSetup(prev => prev ? ({
        ...prev,
        phase: d.ok ? 'done' : 'error',
        steps: d.steps || [],
        error: d.ok ? null : (d.error || 'Setup failed'),
      }) : prev)
    } catch(e) {
      setBranchSetup(prev => prev ? ({ ...prev, phase:'error', steps:[], error:String(e) }) : prev)
    }
  }, [])

  const openRun = useCallback((id) => {
    if (id) localStorage.setItem(GP_ACTIVE_RUN_KEY, id)
    else    localStorage.removeItem(GP_ACTIVE_RUN_KEY)
    setActiveRunId(id)
  }, [])

  const loadApps = useCallback((onDone) => {
    fetch('/api/tools/gp-run/apps')
      .then(r => r.json())
      .then(d => {
        const list = d.apps || []
        setApps(list)
        onDone && onDone(list)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadApps(list => {
      if (list.length > 0 && !list.includes(activeApp)) {
        setActiveApp(list[0])
        localStorage.setItem('gp_active_app', list[0])
      }
    })
  }, [])

  useEffect(() => {
    if (apps.length > 0 && !apps.includes(activeApp)) {
      setActiveApp(apps[0])
      localStorage.setItem('gp_active_app', apps[0])
    }
  }, [apps])

  const load = useCallback(() => {
    setLoading(true); setError('')
    fetch(`/api/tools/gp-run/projects?app=${encodeURIComponent(activeApp)}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok === false) { setError(d.error || 'Failed to load data.'); setLoading(false); return }
        const arr = Array.isArray(d) ? d : (d.rows || [])
        const m   = d.meta || {}
        setRows(arr)
        setMeta(m)
        setLiveStatus(prev => {
          const next = { ...prev }
          arr.forEach(p => {
            const k = String(p.project_id)
            if (k in next && TERMINAL.has((p.status || '').toLowerCase())) delete next[k]
          })
          return next
        })
        setLoading(false)
      })
      .catch(e => { setError(`Failed to load data: ${e.message}`); setLoading(false) })
  }, [activeApp])

  useEffect(() => { load() }, [load])

  const jiraBase = meta.jira_base_url || ''

  const githubRepo = useMemo(() => {
    const withPr = rows.find(r => r.pr_url && r.pr_url.startsWith('http'))
    if (!withPr) return ''
    const m = withPr.pr_url.match(/^(https?:\/\/[^/]+\/[^/]+\/[^/]+)/)
    return m ? m[1] : ''
  }, [rows])

  const sorted     = [...rows].sort((a, b) => Number(b.project_id || 0) - Number(a.project_id || 0))
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE) || 1
  const pageRows   = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const refreshPid = useCallback(async (pid) => {
    setRefreshing(prev => new Set([...prev, pid]))
    try {
      const r = await fetch(`/api/tools/gp-run/projects/${encodeURIComponent(pid)}/status?app=${encodeURIComponent(activeApp)}`)
      const d = await r.json()
      if (d.ok) {
        const isTerminal = TERMINAL.has((d.status || '').toLowerCase())
        setLiveStatus(prev => {
          const next = { ...prev }
          if (isTerminal) delete next[String(pid)]
          else next[String(pid)] = { status: d.status, eta_seconds: d.eta_seconds, sonar_url: d.sonar_url || '' }
          return next
        })
        setRows(prev => prev.map(r2 => {
          if (String(r2.project_id) !== String(pid)) return r2
          const upd = { ...r2 }
          if (d.status)    upd.status    = d.status
          if (d.sonar_url) upd.sonar_url = d.sonar_url
          return upd
        }))
      }
    } catch { /* silently ignore */ }
    setRefreshing(prev => { const n = new Set(prev); n.delete(pid); return n })
  }, [activeApp])

  // Silent Sonar-only fetch — no spinner, only updates sonar_url
  const fetchSonarUrl = useCallback(async (pid) => {
    try {
      const r = await fetch(`/api/tools/gp-run/projects/${encodeURIComponent(pid)}/status?app=${encodeURIComponent(activeApp)}`)
      const d = await r.json()
      if (d.sonar_debug) console.log('[sonar]', pid, d.sonar_debug)
      if (d.ok && d.sonar_url) {
        setRows(prev => prev.map(r2 =>
          String(r2.project_id) === String(pid)
            ? { ...r2, sonar_url: d.sonar_url, sonar_qg: d.sonar_qg || '' }
            : r2
        ))
      } else if (!d.ok) {
        sonarFetchedRef.current.delete(pid)
      }
    } catch { sonarFetchedRef.current.delete(pid) }
  }, [activeApp])

  // Background-fetch Sonar URLs for completed rows that have sonar='yes' but no cached URL yet
  useEffect(() => {
    rows.filter(r => {
      const pid = String(r.project_id)
      return TERMINAL.has((r.status || '').toLowerCase()) &&
             (r.sonar || '').toLowerCase() === 'yes' &&
             !r.sonar_url && r.jenkins_url &&
             !sonarFetchedRef.current.has(pid)
    }).forEach(r => {
      const pid = String(r.project_id)
      sonarFetchedRef.current.add(pid)
      fetchSonarUrl(pid)
    })
  }, [rows, fetchSonarUrl])

  const [countdown, setCountdown] = useState(null)

  useEffect(() => {
    if (!refreshRate) { setCountdown(null); return }
    setCountdown(refreshRate / 1000)
    const tick = setInterval(() => setCountdown(c => (c !== null && c > 1) ? c - 1 : refreshRate / 1000), 1000)
    const poll = setInterval(() => {
      setCountdown(refreshRate / 1000)
      setRows(current => {
        current.filter(r => !TERMINAL.has((r.status || '').toLowerCase()))
               .forEach(r => refreshPid(String(r.project_id)))
        return current
      })
    }, refreshRate)
    return () => { clearInterval(tick); clearInterval(poll) }
  }, [refreshRate, refreshPid])

  const refreshPage = async () => {
    const toRefresh = pageRows.filter(r => {
      const s = (liveStatus[String(r.project_id)]?.status || r.status || '').toLowerCase()
      return s && !TERMINAL.has(s)
    })
    await Promise.all(toRefresh.map(r => refreshPid(String(r.project_id))))
    load()
  }

  const toggleExpand = (pid) => {
    const key = String(pid)
    const willOpen = !expanded[key]
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))
    if (willOpen) refreshPid(key)
  }

  const deleteRow = async (id) => {
    setDeleting(id)
    try {
      await fetch(`/api/tools/gp-run/projects/${encodeURIComponent(id)}?app=${encodeURIComponent(activeApp)}`, { method: 'DELETE' })
      setRows(prev => prev.filter(r => String(r.project_id) !== String(id)))
    } catch { /* ignore */ }
    setDeleting(null)
    setPendingDelete(null)
  }

  const switchTab = (a) => {
    setActiveApp(a)
    localStorage.setItem('gp_active_app', a)
    setPage(0)
    setExpanded({})
    setLiveStatus({})
  }

  return (
    <div>
      <button className="btn back-link" onClick={() => navigate('/workflow-projects')}
        style={{ marginBottom: 16, fontSize: 12, padding: '4px 10px' }}>
        ← Workflow Projects
      </button>
      <WorkflowBackButton />

      <div className="page-header">
        <h1 className="page-title">GP Run</h1>
        <div className="flex-gap" style={{ alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Auto-refresh:</span>
            <select
              value={refreshRate}
              onChange={e => {
                const v = parseInt(e.target.value, 10)
                setRefreshRate(v)
                localStorage.setItem(REFRESH_RATE_KEY, String(v))
                fetch('/api/tools/gp-run/scheduler-settings', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ settings: { poll_interval_s: String(Math.round(v / 1000)) } }),
                }).catch(() => {})
              }}
              style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}
            >
              {REFRESH_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {refreshRate > 0 && countdown !== null && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 28, textAlign: 'right' }}>
                {countdown}s
              </span>
            )}
          </div>
          <button className="btn" onClick={() => setShowConfig(true)} title="Configure config.xlsx (application URLs)">
            ⚙ Configure
          </button>
          <button className="btn" onClick={() => { setShowScheduler(v => !v); setSchedSaved(false); setSchedErr('') }}
            title="Scheduler settings" style={{ fontSize: 12, padding: '5px 12px' }}>
            ⏱ Scheduler
          </button>
        </div>
      </div>

      {showScheduler && (
        <div style={{ margin: '0 0 16px 0', padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Scheduler Settings</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(applies to all GP Run projects)</span>
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
            onClick={() => switchTab(a)}
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Run</button>
        <div className="flex-gap" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => setShowGpParams(true)} title={`Configure GP parameters for ${activeApp}`}>
            ⚙ Configure Params
          </button>
          <button className="btn" onClick={refreshPage} disabled={refreshing.size > 0 || loading}
            title="Refresh eligible projects on this page via gpstatus, then reload">
            {refreshing.size > 0 ? '↺ Refreshing…' : '↺ Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="center"><span className="spinner" /></div>
      ) : sorted.length === 0 ? (
        <div className="empty"><h3>No GP runs yet for {activeApp}</h3><p>Trigger a new run to get started.</p></div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th>ID</th>
                  <th>Ticket</th>
                  <th>Feature Branch</th>
                  <th>Dest Branch</th>
                  <th>Status</th>
                  <th>ETA</th>
                  <th>Auto Merge</th>
                  <th>PR</th>
                  <th>Jenkins</th>
                  <th>Sonar</th>
                  <th>Triggered At</th>
                  <th style={{ width: 100 }}></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const pid        = String(row.project_id)
                  const live       = liveStatus[pid] || {}
                  const effStatus  = live.status      || row.status    || ''
                  const effEta     = live.eta_seconds !== undefined ? live.eta_seconds : row.eta_seconds
                  const effSonar   = live.sonar_url  || row.sonar_url || ''
                  const effSonarQg = live.sonar_qg   || row.sonar_qg  || ''
                  const isOpen     = !!expanded[pid]
                  const isElig     = effStatus && !TERMINAL.has(effStatus.toLowerCase())
                  const isSpin     = refreshing.has(pid)
                  const jid        = (row.job_id || '').replace(/^#/, '')
                  const ticketHref = jiraBase && row.ticket_id ? `${jiraBase}/browse/${row.ticket_id}` : ''
                  const branchHref = githubRepo && row.feature_branch ? `${githubRepo}/tree/${row.feature_branch}` : ''
                  const destHref   = githubRepo && row.dest_branch    ? `${githubRepo}/tree/${row.dest_branch}`    : ''
                  return (
                    <React.Fragment key={pid}>
                      <tr style={{ cursor: 'pointer' }} onClick={() => toggleExpand(pid)}>
                        <td style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'center', userSelect: 'none' }}>
                          {isSpin ? <span className="spinner" style={{ width: 12, height: 12 }} /> : isOpen ? '▾' : '▸'}
                        </td>
                        <td><span style={{ fontWeight: 600 }}>{row.project_id}</span></td>
                        <td onClick={e => e.stopPropagation()}>
                          {ticketHref
                            ? <a href={ticketHref} target="_blank" rel="noreferrer"
                                 style={{ color: 'var(--primary)', fontWeight: 500, fontSize: 13 }}>
                                {row.ticket_id}
                              </a>
                            : <span style={{ color: row.ticket_id ? 'var(--primary)' : 'var(--text-muted)', fontWeight: 500 }}>
                                {row.ticket_id || '—'}
                              </span>}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          {branchHref
                            ? <a href={branchHref} target="_blank" rel="noreferrer"
                                 className="mono" style={{ fontSize: 12 }} title={row.feature_branch}>
                                {row.feature_branch.slice(0, 28)}{row.feature_branch.length > 28 ? '…' : ''}
                              </a>
                            : <span className="mono" style={{ fontSize: 12, color: row.feature_branch ? 'var(--text)' : 'var(--text-muted)' }} title={row.feature_branch}>
                                {row.feature_branch ? row.feature_branch.slice(0, 28) : '—'}
                              </span>}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          {destHref
                            ? <a href={destHref} target="_blank" rel="noreferrer"
                                 className="mono" style={{ fontSize: 12 }} title={row.dest_branch}>
                                {row.dest_branch.slice(0, 20)}{row.dest_branch.length > 20 ? '…' : ''}
                              </a>
                            : <span className="mono" style={{ fontSize: 12 }} title={row.dest_branch}>{row.dest_branch ? row.dest_branch.slice(0, 20) : '—'}</span>}
                        </td>
                        <td><StatusBadge value={effStatus} /></td>
                        <td>
                          {isElig && effEta !== null && effEta !== undefined
                            ? <span style={{ fontSize: 12, color: effEta < 0 ? 'var(--warning, orange)' : 'var(--text-muted)' }}>
                                {fmtEta(effEta)}
                              </span>
                            : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td>
                          {row.auto_merge
                            ? <span className="mono" style={{ fontSize: 12, color: (row.auto_merge || '').toLowerCase() === 'yes' ? '#2e7d32' : 'var(--text-muted)' }}>{row.auto_merge}</span>
                            : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <PrBadge prUrl={row.pr_url} prStatus={row.pr_status} />
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          {row.jenkins_url
                            ? <a href={row.jenkins_url} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 12 }}>↗ #{jid}</a>
                            : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          {effSonar
                            ? <SonarQgBadge qg={effSonarQg} to={`/developer-tools/sonar-report?sonarUrl=${encodeURIComponent(effSonar)}`} />
                            : row.sonar
                              ? <span className="mono" style={{ fontSize: 12, color: row.sonar === 'yes' ? 'var(--text)' : 'var(--text-muted)' }}>{row.sonar}</span>
                              : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td>
                          <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {row.triggered_at ? row.triggered_at.slice(0, 16) : '—'}
                          </span>
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
                            <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 4, alignItems: 'center' }}>
                              {row.feature_branch && (
                                <button className="btn btn-sm"
                                  title={`Set ${activeApp} local repo to ${row.feature_branch}`}
                                  onClick={() => doSetupLocalBranch(row.feature_branch, activeApp)}
                                  style={{ background:'rgba(21,101,192,0.1)', color:'#1565c0', border:'1px solid rgba(21,101,192,0.3)', fontWeight:600 }}>
                                  {activeApp}
                                </button>
                              )}
                              <button className="btn btn-sm" title="Clone this run" onClick={async () => setCloneSource(await withCloneInfo(activeApp, row))}>⎘ Clone</button>
                              <button className="btn btn-sm btn-danger" onClick={() => setPendingDelete(pid)}>Delete</button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={13} style={{ background: 'var(--surface2)', padding: '12px 16px 12px 32px' }}>
                            <DetailPanel row={row} live={live} jiraBase={jiraBase} githubRepo={githubRepo} />
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

      {activeRunId && (
        <GpTerminal
          runId={activeRunId}
          onClose={() => openRun(null)}
          onDone={(finalStatus) => {
            localStorage.removeItem(GP_ACTIVE_RUN_KEY)
            if (finalStatus === 'done') load()
          }}
        />
      )}

      {(showCreate || cloneSource) && (
        <CreateModal
          app={activeApp}
          initial={cloneSource || undefined}
          featureBranch={featureBranch}
          onClose={(refresh, runId) => {
            setShowCreate(false)
            setCloneSource(null)
            if (refresh) {
              load()
              if (runId) openRun(runId)
            }
          }}
        />
      )}

      {showConfig && <ConfigModal initialApp={activeApp} apps={apps} onAppsChanged={newApps => setApps(newApps)} onClose={() => setShowConfig(false)} />}

      {showGpParams && <GpParamsModal app={activeApp} onClose={() => setShowGpParams(false)} />}

      {branchSetup && (
        <BranchSetupModal setup={branchSetup} onNavigate={navigate} onClose={() => setBranchSetup(null)} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Embeddable tab — same features as GpRunPage, fixed to one app
// ---------------------------------------------------------------------------
export function GpRunTab({ app, branch, releaseBranch: _releaseBranchProp, featureBranch: _featureBranchProp, autoNewRun = false }) {
  const navigate = useNavigate()
  const [rows,          setRows]          = useState([])
  const [meta,          setMeta]          = useState({})
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState('')
  const [liveStatus,    setLiveStatus]    = useState({})
  const [page,          setPage]          = useState(0)
  const [expanded,      setExpanded]      = useState({})
  const [refreshing,    setRefreshing]    = useState(new Set())
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting,      setDeleting]      = useState(null)
  const [showCreate,    setShowCreate]    = useState(autoNewRun)   // opened straight from Sonar Report "GP Run"
  const [cloneSource,   setCloneSource]   = useState(null)
  const [showGpParams,  setShowGpParams]  = useState(false)
  const [activeRunId,   setActiveRunId]   = useState(null)
  const [branchSetup,   setBranchSetup]   = useState(null)
  const [localFeatureBranch, setLocalFeatureBranch] = useState(null)
  const [localReleaseBranch, setLocalReleaseBranch] = useState(null)
  // Props from parent take priority; local fetch is fallback when props are absent
  const releaseBranch = _releaseBranchProp || localReleaseBranch
  const featureBranch = _featureBranchProp || localFeatureBranch
  const [refreshRate, setRefreshRate] = useState(() => {
    const saved = parseInt(localStorage.getItem(REFRESH_RATE_KEY), 10)
    return REFRESH_OPTIONS.some(o => o.value === saved) ? saved : 60000
  })
  const [countdown, setCountdown] = useState(null)
  const sonarFetchedRef = useRef(new Set())

  useEffect(() => {
    // Only fetch local branches when no prop override is provided
    if (_releaseBranchProp && _featureBranchProp) return
    const appKey = app.toLowerCase()
    if (!_releaseBranchProp) {
      setLocalReleaseBranch(null)
      fetch(`/api/local-app/${appKey}/current-branch`)
        .then(r => r.json())
        .then(d => { if (d.ok) setLocalReleaseBranch((d.branch === 'master' || d.branch === 'main') ? d.branch : (d.release_ver || d.branch)) })
        .catch(() => {})
    }
    if (!_featureBranchProp) {
      setLocalFeatureBranch(null)
      fetch(`/api/local-app/${appKey}/git-local-branches`)
        .then(r => r.json())
        .then(d => { if (d.ok && d.current) setLocalFeatureBranch(d.current) })
        .catch(() => {})
    }
  }, [app])

  const openRun = useCallback((id) => { setActiveRunId(id) }, [])

  const doSetupLocalBranch = useCallback(async (branchName, appName) => {
    if (!branchName || !appName) return
    const localAppPath = gpLocalPath(appName)
    const displayName  = gpDisplayName(appName)
    setBranchSetup({ phase:'running', steps:[], error:null, localAppPath, appName: displayName })
    try {
      const d = await fetch('/api/project-management/sprint/project-setup-branch', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ branch_name: branchName, application: appName.toUpperCase() }),
      }).then(r => r.json())
      setBranchSetup(prev => prev ? ({
        ...prev,
        phase: d.ok ? 'done' : 'error',
        steps: d.steps || [],
        error: d.ok ? null : (d.error || 'Setup failed'),
      }) : prev)
    } catch(e) {
      setBranchSetup(prev => prev ? ({ ...prev, phase:'error', steps:[], error:String(e) }) : prev)
    }
  }, [])

  const load = useCallback(() => {
    setLoading(true); setError('')
    fetch(`/api/tools/gp-run/projects?app=${encodeURIComponent(app)}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok === false) { setError(d.error || 'Failed to load data.'); setLoading(false); return }
        const arr = Array.isArray(d) ? d : (d.rows || [])
        setRows(arr); setMeta(d.meta || {})
        setLiveStatus(prev => {
          const next = { ...prev }
          arr.forEach(p => {
            const k = String(p.project_id)
            if (k in next && TERMINAL.has((p.status || '').toLowerCase())) delete next[k]
          })
          return next
        })
        setLoading(false)
      })
      .catch(e => { setError(`Failed: ${e.message}`); setLoading(false) })
  }, [app])

  useEffect(() => { load() }, [load])

  const refreshPid = useCallback(async (pid) => {
    setRefreshing(prev => new Set([...prev, pid]))
    try {
      const r = await fetch(`/api/tools/gp-run/projects/${encodeURIComponent(pid)}/status?app=${encodeURIComponent(app)}`)
      const d = await r.json()
      if (d.ok) {
        const isTerminal = TERMINAL.has((d.status || '').toLowerCase())
        setLiveStatus(prev => {
          const next = { ...prev }
          if (isTerminal) delete next[String(pid)]
          else next[String(pid)] = { status: d.status, eta_seconds: d.eta_seconds, sonar_url: d.sonar_url || '' }
          return next
        })
        setRows(prev => prev.map(r2 => {
          if (String(r2.project_id) !== String(pid)) return r2
          const upd = { ...r2 }
          if (d.status)    upd.status    = d.status
          if (d.sonar_url) upd.sonar_url = d.sonar_url
          return upd
        }))
      }
    } catch { /* ignore */ }
    setRefreshing(prev => { const n = new Set(prev); n.delete(pid); return n })
  }, [app])

  // Silent Sonar-only fetch — no spinner, only updates sonar_url
  const fetchSonarUrl = useCallback(async (pid) => {
    try {
      const r = await fetch(`/api/tools/gp-run/projects/${encodeURIComponent(pid)}/status?app=${encodeURIComponent(app)}`)
      const d = await r.json()
      if (d.sonar_debug) console.log('[sonar]', pid, d.sonar_debug)
      if (d.ok && d.sonar_url) {
        setRows(prev => prev.map(r2 =>
          String(r2.project_id) === String(pid)
            ? { ...r2, sonar_url: d.sonar_url, sonar_qg: d.sonar_qg || '' }
            : r2
        ))
      } else if (!d.ok) {
        sonarFetchedRef.current.delete(pid)
      }
    } catch { sonarFetchedRef.current.delete(pid) }
  }, [app])

  // Background-fetch Sonar URLs for completed rows that have sonar='yes' but no cached URL yet
  useEffect(() => {
    rows.filter(r => {
      const pid = String(r.project_id)
      return TERMINAL.has((r.status || '').toLowerCase()) &&
             (r.sonar || '').toLowerCase() === 'yes' &&
             !r.sonar_url && r.jenkins_url &&
             !sonarFetchedRef.current.has(pid)
    }).forEach(r => {
      const pid = String(r.project_id)
      sonarFetchedRef.current.add(pid)
      fetchSonarUrl(pid)
    })
  }, [rows, fetchSonarUrl])

  useEffect(() => {
    if (!refreshRate) { setCountdown(null); return }
    setCountdown(refreshRate / 1000)
    const tick = setInterval(() => setCountdown(c => (c !== null && c > 1) ? c - 1 : refreshRate / 1000), 1000)
    const poll = setInterval(() => {
      setCountdown(refreshRate / 1000)
      setRows(current => {
        current.filter(r => !TERMINAL.has((r.status || '').toLowerCase()))
               .forEach(r => refreshPid(String(r.project_id)))
        return current
      })
    }, refreshRate)
    return () => { clearInterval(tick); clearInterval(poll) }
  }, [refreshRate, refreshPid])

  const jiraBase   = meta.jira_base_url || ''
  const githubRepo = useMemo(() => {
    const withPr = rows.find(r => r.pr_url && r.pr_url.startsWith('http'))
    if (!withPr) return ''
    const m = withPr.pr_url.match(/^(https?:\/\/[^/]+\/[^/]+\/[^/]+)/)
    return m ? m[1] : ''
  }, [rows])

  // Use explicit props for filtering — local fallback values are wrong for remote-app context
  const filterByRelease = _releaseBranchProp || null
  const filterByFeature = _featureBranchProp || null
  const computedDest = (filterByRelease && filterByRelease !== 'master' && filterByRelease !== 'main')
    ? `release-${filterByRelease}` : null
  const allSorted  = [...rows].sort((a, b) => Number(b.project_id || 0) - Number(a.project_id || 0))
  const sorted     = (filterByFeature || computedDest)
    ? allSorted.filter(r =>
        (!filterByFeature || (r.feature_branch || '').toLowerCase() === filterByFeature.toLowerCase()) &&
        (!computedDest    || (r.dest_branch    || '').toLowerCase() === computedDest.toLowerCase())
      )
    : allSorted
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE) || 1
  const pageRows   = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const toggleExpand = (pid) => {
    const key = String(pid)
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))
    if (!expanded[key]) refreshPid(key)
  }

  const deleteRow = async (id) => {
    setDeleting(id)
    try {
      await fetch(`/api/tools/gp-run/projects/${encodeURIComponent(id)}?app=${encodeURIComponent(app)}`, { method: 'DELETE' })
      setRows(prev => prev.filter(r => String(r.project_id) !== String(id)))
    } catch { /* ignore */ }
    setDeleting(null); setPendingDelete(null)
  }

  const refreshPage = async () => {
    const toRefresh = pageRows.filter(r => {
      const s = (liveStatus[String(r.project_id)]?.status || r.status || '').toLowerCase()
      return s && !TERMINAL.has(s)
    })
    await Promise.all(toRefresh.map(r => refreshPid(String(r.project_id))))
    load()
  }

  return (
    <div>
      {/* Action row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Run</button>
          {(releaseBranch || branch) && (
            <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 10, background: 'rgba(76,175,80,0.1)', color: '#2e7d32', border: '1px solid rgba(76,175,80,0.3)', fontWeight: 500, whiteSpace: 'nowrap' }}>
              {releaseBranch || branch}
            </span>
          )}
        </div>
        <div className="flex-gap" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => setShowGpParams(true)} title={`Configure GP parameters for ${app}`}>
            ⚙ Configure Params
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Auto-refresh:</span>
            <select value={refreshRate}
              onChange={e => { const v = parseInt(e.target.value, 10); setRefreshRate(v); localStorage.setItem(REFRESH_RATE_KEY, String(v)) }}
              style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>
              {REFRESH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {refreshRate > 0 && countdown !== null && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 28, textAlign: 'right' }}>{countdown}s</span>
            )}
          </div>
          <button className="btn" onClick={refreshPage} disabled={refreshing.size > 0 || loading}>
            {refreshing.size > 0 ? '↺ Refreshing…' : '↺ Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="center"><span className="spinner" /></div>
      ) : sorted.length === 0 ? (
        <div className="empty"><h3>No GP runs yet for {app}</h3><p>Trigger a new run to get started.</p></div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th>ID</th>
                  <th>Ticket</th>
                  <th>Feature Branch</th>
                  <th>Dest Branch</th>
                  <th>Status</th>
                  <th>ETA</th>
                  <th>Auto Merge</th>
                  <th>PR</th>
                  <th>Jenkins</th>
                  <th>Sonar</th>
                  <th>Triggered At</th>
                  <th style={{ width: 100 }}></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const pid       = String(row.project_id)
                  const live      = liveStatus[pid] || {}
                  const effStatus = live.status      || row.status    || ''
                  const effEta    = live.eta_seconds !== undefined ? live.eta_seconds : row.eta_seconds
                  const effSonar   = live.sonar_url  || row.sonar_url || ''
                  const effSonarQg = live.sonar_qg   || row.sonar_qg  || ''
                  const isOpen    = !!expanded[pid]
                  const isElig    = effStatus && !TERMINAL.has(effStatus.toLowerCase())
                  const isSpin    = refreshing.has(pid)
                  const jid       = (row.job_id || '').replace(/^#/, '')
                  const ticketHref = jiraBase && row.ticket_id ? `${jiraBase}/browse/${row.ticket_id}` : ''
                  const branchHref = githubRepo && row.feature_branch ? `${githubRepo}/tree/${row.feature_branch}` : ''
                  const destHref   = githubRepo && row.dest_branch    ? `${githubRepo}/tree/${row.dest_branch}` : ''
                  return (
                    <React.Fragment key={pid}>
                      <tr style={{ cursor: 'pointer' }} onClick={() => toggleExpand(pid)}>
                        <td style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'center', userSelect: 'none' }}>
                          {isSpin ? <span className="spinner" style={{ width: 12, height: 12 }} /> : isOpen ? '▾' : '▸'}
                        </td>
                        <td><span style={{ fontWeight: 600 }}>{row.project_id}</span></td>
                        <td onClick={e => e.stopPropagation()}>
                          {ticketHref
                            ? <a href={ticketHref} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontWeight: 500, fontSize: 13 }}>{row.ticket_id}</a>
                            : <span style={{ color: row.ticket_id ? 'var(--primary)' : 'var(--text-muted)', fontWeight: 500 }}>{row.ticket_id || '—'}</span>}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          {branchHref
                            ? <a href={branchHref} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 12 }} title={row.feature_branch}>{row.feature_branch.slice(0, 28)}{row.feature_branch.length > 28 ? '…' : ''}</a>
                            : <span className="mono" style={{ fontSize: 12, color: row.feature_branch ? 'var(--text)' : 'var(--text-muted)' }} title={row.feature_branch}>{row.feature_branch ? row.feature_branch.slice(0, 28) : '—'}</span>}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          {destHref
                            ? <a href={destHref} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 12 }} title={row.dest_branch}>{row.dest_branch.slice(0, 20)}{row.dest_branch.length > 20 ? '…' : ''}</a>
                            : <span className="mono" style={{ fontSize: 12 }} title={row.dest_branch}>{row.dest_branch ? row.dest_branch.slice(0, 20) : '—'}</span>}
                        </td>
                        <td><StatusBadge value={effStatus} /></td>
                        <td>
                          {isElig && effEta !== null && effEta !== undefined
                            ? <span style={{ fontSize: 12, color: effEta < 0 ? 'var(--warning, orange)' : 'var(--text-muted)' }}>{fmtEta(effEta)}</span>
                            : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td>
                          {row.auto_merge
                            ? <span className="mono" style={{ fontSize: 12, color: (row.auto_merge || '').toLowerCase() === 'yes' ? '#2e7d32' : 'var(--text-muted)' }}>{row.auto_merge}</span>
                            : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <PrBadge prUrl={row.pr_url} prStatus={row.pr_status} />
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          {row.jenkins_url ? <a href={row.jenkins_url} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 12 }}>↗ #{jid}</a> : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          {effSonar
                            ? <SonarQgBadge qg={effSonarQg} to={`/developer-tools/sonar-report?sonarUrl=${encodeURIComponent(effSonar)}`} />
                            : row.sonar
                              ? <span className="mono" style={{ fontSize: 12, color: row.sonar === 'yes' ? 'var(--text)' : 'var(--text-muted)' }}>{row.sonar}</span>
                              : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td>
                          <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {row.triggered_at ? row.triggered_at.slice(0, 16) : '—'}
                          </span>
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          {pendingDelete === pid ? (
                            <div className="flex-gap">
                              <button className="btn btn-sm btn-danger" disabled={deleting === pid} onClick={() => deleteRow(pid)}>
                                {deleting === pid ? '…' : 'Confirm'}
                              </button>
                              <button className="btn btn-sm" onClick={() => setPendingDelete(null)}>Cancel</button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 4, alignItems: 'center' }}>
                              {row.feature_branch && (
                                <button className="btn btn-sm"
                                  title={`Set ${app} local repo to ${row.feature_branch}`}
                                  onClick={() => doSetupLocalBranch(row.feature_branch, app)}
                                  style={{ background:'rgba(21,101,192,0.1)', color:'#1565c0', border:'1px solid rgba(21,101,192,0.3)', fontWeight:600 }}>
                                  {app}
                                </button>
                              )}
                              <button className="btn btn-sm" title="Clone this run" onClick={async () => setCloneSource(await withCloneInfo(app, row))}>⎘ Clone</button>
                              <button className="btn btn-sm btn-danger" onClick={() => setPendingDelete(pid)}>Delete</button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={13} style={{ background: 'var(--surface2)', padding: '12px 16px 12px 32px' }}>
                            <DetailPanel row={row} live={live} jiraBase={jiraBase} githubRepo={githubRepo} />
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
                <button key={i} className={`btn btn-sm${i === page ? ' btn-primary' : ''}`} onClick={() => setPage(i)}>{i + 1}</button>
              ))}
              <button className="btn btn-sm" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}>Next ›</button>
            </div>
          )}
        </>
      )}

      {activeRunId && (
        <GpTerminal runId={activeRunId} onClose={() => openRun(null)}
          onDone={(finalStatus) => { if (finalStatus === 'done') load() }} />
      )}

      {(showCreate || cloneSource) && (
        <CreateModal app={app}
          key={`tab-${releaseBranch ?? 'loading'}`}
          initial={cloneSource || undefined}
          releaseBranch={releaseBranch}
          featureBranch={featureBranch}
          onClose={(refresh, runId) => {
            setShowCreate(false); setCloneSource(null)
            if (refresh) { load(); if (runId) openRun(runId) }
          }} />
      )}

      {showGpParams && <GpParamsModal app={app} onClose={() => setShowGpParams(false)} />}

      {branchSetup && (
        <BranchSetupModal setup={branchSetup} onNavigate={navigate} onClose={() => setBranchSetup(null)} />
      )}
    </div>
  )
}
