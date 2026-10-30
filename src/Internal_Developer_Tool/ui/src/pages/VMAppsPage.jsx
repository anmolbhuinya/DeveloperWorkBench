import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

// Remote apps that have a /api/remote-app/:app/current-branch endpoint
const REMOTE_APPS = new Set(['payor', 'classic', 'connector', 'enrollment', 'pik'])

// ---------------------------------------------------------------------------
// Build param form — expands when user clicks Build
// ---------------------------------------------------------------------------
function BuildParamForm({ app, buildCmd, buildParams, busy, onRun, onCancel }) {
  const params  = buildParams[app] || []
  const initial = {}
  params.forEach(p => { initial[p.name] = p.default === 'true' || p.default === true })
  const [vals, setVals] = useState(initial)

  function toggle(name) { setVals(v => ({ ...v, [name]: !v[name] })) }

  function buildFlags() {
    const flags = []
    params.forEach(p => {
      const checked = !!vals[p.name]
      if ((p.flag_when === 'true' && checked) || (p.flag_when === 'false' && !checked)) {
        flags.push(p.flag)
      }
    })
    return flags
  }

  const preview = [buildCmd || `refresh-${app}`, ...buildFlags()].join(' ')

  return (
    <div style={{ marginTop: 12, padding: '14px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>Build Parameters</div>
      {params.map(p => (
        <label key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={!!vals[p.name]}
            onChange={() => toggle(p.name)}
            style={{ accentColor: 'var(--primary)', width: 14, height: 14 }}
          />
          {p.label}
        </label>
      ))}
      <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', padding: '5px 8px', background: 'var(--surface)', borderRadius: 4, margin: '10px 0 12px' }}>
        {preview}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-sm" onClick={() => onRun(buildFlags())} disabled={busy}>
          {busy ? <><span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> Running…</> : '▶ Run Build'}
        </button>
        <button className="btn btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Action output panel
// ---------------------------------------------------------------------------
function ActionOutput({ output, error, onClose }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [output])

  return (
    <div style={{ marginTop: 12, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 12px', background: '#161b22', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 11, color: '#58a6ff', fontWeight: 600 }}>Output</span>
        <button className="btn btn-sm" onClick={onClose} style={{ fontSize: 10, padding: '1px 6px' }}>✕ Close</button>
      </div>
      <pre ref={ref} style={{ margin: 0, padding: '10px 14px', fontSize: 11, background: '#0d1117', color: error ? '#f85149' : '#8b949e', maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {output || error || '…'}
      </pre>
    </div>
  )
}

// ---------------------------------------------------------------------------
// App card
// ---------------------------------------------------------------------------
function AppCard({ cfg, buildParams, vmName, vmIp, onRefreshStatus }) {
  const [buildOpen,   setBuildOpen]   = useState(false)
  const [actionBusy,  setActionBusy]  = useState({})
  const [output,      setOutput]      = useState(null)
  const [branchInfo,  setBranchInfo]  = useState(null)   // {branch, release_ver, env_type} or null
  const [branchLoading, setBranchLoading] = useState(false)

  const app = cfg.app

  useEffect(() => {
    if (!vmIp || !REMOTE_APPS.has(app)) return
    setBranchLoading(true)
    fetch(`/api/remote-app/${app}/current-branch?vm_ip=${encodeURIComponent(vmIp)}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) setBranchInfo({ branch: d.branch, release_ver: d.release_ver, env_type: d.env_type })
      })
      .catch(() => {})
      .finally(() => setBranchLoading(false))
  }, [app, vmIp])

  function runAction(action, extraFlags = []) {
    setActionBusy(b => ({ ...b, [action]: true }))
    setOutput(null)

    const body = { app, action }
    if (action === 'build') body.extra_flags = extraFlags

    fetch(`/api/vms/developer/${encodeURIComponent(vmName)}/app-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.json())
      .then(d => {
        setOutput({ text: d.output || '', error: d.ok ? '' : (d.error || 'Failed') })
        setActionBusy(b => ({ ...b, [action]: false }))
        setBuildOpen(false)
        if (d.ok) onRefreshStatus()
      })
      .catch(err => {
        setOutput({ text: '', error: String(err) })
        setActionBusy(b => ({ ...b, [action]: false }))
      })
  }

  const anyBusy  = Object.values(actionBusy).some(Boolean)
  const hasBuild = !!cfg.build_cmd

  const statusColor  = cfg.running == null ? 'var(--text-muted)' : cfg.running ? '#4caf50' : '#f44336'
  const statusBg     = cfg.running == null ? 'var(--surface2)'   : cfg.running ? '#0d2a0d' : '#2a0d0d'
  const statusBorder = cfg.running == null ? 'var(--border)'     : cfg.running ? '#1e4d1e' : '#4d1e1e'
  const statusLabel  = cfg.running == null ? 'Unknown' : cfg.running ? '● Running' : '○ Stopped'

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '18px 20px' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', minWidth: 100 }}>
          {app.charAt(0).toUpperCase() + app.slice(1)}
        </span>

        <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: statusBg, color: statusColor, border: `1px solid ${statusBorder}` }}>
          {statusLabel}
        </span>

        {/* Branch / release version badges */}
        {branchLoading && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
          </span>
        )}
        {!branchLoading && branchInfo?.branch && (
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
            background: 'rgba(88,166,255,0.1)', color: '#58a6ff',
            border: '1px solid rgba(88,166,255,0.3)',
          }}>
            {branchInfo.branch}
          </span>
        )}
        {!branchLoading && branchInfo?.release_ver && (
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
            background: 'rgba(163,113,247,0.1)', color: '#a371f7',
            border: '1px solid rgba(163,113,247,0.3)',
          }}>
            v{branchInfo.release_ver}
          </span>
        )}

        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
          {hasBuild && (
            <button
              className="btn btn-sm"
              disabled={anyBusy}
              onClick={() => setBuildOpen(o => !o)}
            >
              {actionBusy['build']
                ? <><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> Building…</>
                : buildOpen ? '▾ Build' : '▸ Build'}
            </button>
          )}
          {[
            { action: 'start',   label: 'Start'   },
            { action: 'stop',    label: 'Stop'     },
            { action: 'restart', label: 'Restart'  },
          ].map(({ action, label }) => (
            <button
              key={action}
              className="btn btn-sm"
              disabled={anyBusy}
              onClick={() => runAction(action)}
            >
              {actionBusy[action]
                ? <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />
                : label}
            </button>
          ))}
        </div>
      </div>

      {/* Build param form */}
      {buildOpen && (
        <BuildParamForm
          app={app}
          buildCmd={cfg.build_cmd}
          buildParams={buildParams}
          busy={!!actionBusy['build']}
          onRun={(flags) => runAction('build', flags)}
          onCancel={() => setBuildOpen(false)}
        />
      )}

      {/* Output */}
      {output && (
        <ActionOutput
          output={output.text}
          error={output.error}
          onClose={() => setOutput(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function VMAppsPage() {
  const navigate = useNavigate()
  const { vmName } = useParams()

  const [appsConfig,    setAppsConfig]    = useState([])
  const [buildParams,   setBuildParams]   = useState({})
  const [configLoading, setConfigLoading] = useState(true)

  const [appStatuses,   setAppStatuses]   = useState({})
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError,   setStatusError]   = useState('')
  const [vmIp,          setVmIp]          = useState('')

  // Load app config once
  useEffect(() => {
    fetch(`/api/vms/developer/${encodeURIComponent(vmName)}/app-config`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setAppsConfig(d.apps || []); setBuildParams(d.build_params || {}) }
        setConfigLoading(false)
      })
      .catch(() => setConfigLoading(false))
  }, [vmName])

  // Fallback: look up VM IP from /api/vms if app-status doesn't return it
  useEffect(() => {
    if (vmIp) return
    fetch('/api/vms')
      .then(r => r.json())
      .then(rows => {
        const match = rows.find(v => v.name && v.name.toLowerCase() === vmName.toLowerCase())
        if (match?.ip) setVmIp(match.ip)
      })
      .catch(() => {})
  }, [vmName, vmIp])

  const fetchStatus = useCallback(() => {
    setStatusLoading(true); setStatusError('')
    fetch(`/api/vms/developer/${encodeURIComponent(vmName)}/app-status`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          const map = {}
          ;(d.apps || []).forEach(a => { map[a.app] = a.running })
          setAppStatuses(map)
          if (d.vm_ip) setVmIp(d.vm_ip)
        } else {
          setStatusError(d.error || 'Failed to fetch app status')
        }
        setStatusLoading(false)
      })
      .catch(() => { setStatusError('Request failed'); setStatusLoading(false) })
  }, [vmName])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  const mergedApps = appsConfig.map(cfg => ({
    ...cfg,
    running: appStatuses[cfg.app] ?? null,
  }))

  return (
    <div>
      <button
        className="btn back-link"
        onClick={() => navigate('/dev-vms')}
        style={{ marginBottom: 16, fontSize: 12, padding: '4px 10px' }}
      >
        ← Developer VMs
      </button>

      <div className="page-header">
        <div>
          <h1 className="page-title">VM Applications</h1>
          {vmIp && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{vmName} · {vmIp}</div>}
          {!vmIp && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{vmName}</div>}
        </div>
        <button className="btn" onClick={fetchStatus} disabled={statusLoading}>
          {statusLoading ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : '↺ Refresh Status'}
        </button>
      </div>

      {statusError && <div className="alert alert-error" style={{ marginBottom: 16 }}>{statusError}</div>}

      {(configLoading || statusLoading) && mergedApps.length === 0 ? (
        <div className="center"><span className="spinner" /></div>
      ) : mergedApps.length === 0 ? (
        <div className="empty">
          <h3>No applications configured</h3>
          <p>Add entries to app_config.xlsx to manage applications.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 860 }}>
          {mergedApps.map(cfg => (
            <AppCard
              key={cfg.app}
              cfg={cfg}
              buildParams={buildParams}
              vmName={vmName}
              vmIp={vmIp}
              onRefreshStatus={fetchStatus}
            />
          ))}
        </div>
      )}
    </div>
  )
}
