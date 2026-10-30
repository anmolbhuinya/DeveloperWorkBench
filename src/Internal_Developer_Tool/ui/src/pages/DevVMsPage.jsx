import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

const BRANCH_FETCH_DELAY_MS   = 2500   // stagger after app-status to avoid concurrent SSH
const BRANCH_FETCH_TIMEOUT_MS = 45000  // abort if server hasn't replied (server caps at 35s)
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// ---------------------------------------------------------------------------
// Module-level stores — survive React unmounts (page navigation)
// ---------------------------------------------------------------------------
// _termSessions: `${vmName}-${sessionId}` → { el, term, fitAddon, ws, ro, opened }
const _termSessions = new Map()
// _vmTabState: vmName → { sessions: [{id}], activeId, nextId }
const _vmTabState = new Map()

function _sessionKey(vmName, id) { return `${vmName}-${id}` }

function _cleanupSession(vmName, id) {
  const key = _sessionKey(vmName, id)
  const s   = _termSessions.get(key)
  if (!s) return
  s.ro?.disconnect()
  try { s.ws.close() }   catch (_) {}
  try { s.term.dispose() } catch (_) {}
  try { s.el.parentNode?.removeChild(s.el) } catch (_) {}
  _termSessions.delete(key)
}

// ---------------------------------------------------------------------------
// Build param form
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
const ACTION_LABELS = { start: 'Starting', stop: 'Stopping', restart: 'Restarting' }
const REMOTE_BRANCH_APPS = new Set(['classic', 'connector', 'enrollment', 'pik'])

function AppCard({ cfg, buildParams, vmName, vmIp, onRefreshStatus, remoteBranchInfo, remBranchLoading, onRefreshBranch }) {
  const [buildOpen,      setBuildOpen]      = useState(false)
  const [buildStatus,    setBuildStatus]    = useState(null)   // null|'running'|'success'|'failed'|'aborted'
  const [buildOutput,    setBuildOutput]    = useState('')
  const [actionStatus,   setActionStatus]   = useState(null)   // null|'running'|'done'|'error'
  const [activeAction,   setActiveAction]   = useState(null)   // 'start'|'stop'|'restart'
  const [actionOutput,   setActionOutput]   = useState('')
  const [branchVersion,  setBranchVersion]  = useState(null)
  const [releaseVersion, setReleaseVersion] = useState(null)
  const [branchErr,      setBranchErr]      = useState(null)
  const [releaseErr,     setReleaseErr]     = useState(null)
  const consoleRef = useRef(null)

  // Auto-scroll live console
  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight
  }, [actionOutput])

  // Auto-resolve spinner when cfg.running already reflects the expected post-action state
  useEffect(() => {
    if (actionStatus !== 'running' || !activeAction) return
    if ((activeAction === 'start' || activeAction === 'restart') && cfg.running === true) {
      setActionStatus('done')
    } else if (activeAction === 'stop' && cfg.running === false) {
      setActionStatus('done')
    }
  }, [cfg.running, actionStatus, activeAction])

  // Fetch payor branch+release versions
  function fetchPayorVersions() {
    if (cfg.app !== 'payor') return
    setBranchVersion('loading'); setBranchErr(null)
    setReleaseVersion(null);     setReleaseErr(null)
    fetch(`/api/vms/developer/${encodeURIComponent(vmName)}/payor-version`)
      .then(r => r.json())
      .then(d => {
        if (!d.ok || !d.branch_version) {
          setBranchVersion('—')
          setBranchErr(d.error || 'No branch version returned')
          return
        }
        setBranchVersion(d.branch_version)
        setReleaseVersion('loading')
        fetch(`/api/tools/rpb/payor-release-version?branch_version=${encodeURIComponent(d.branch_version)}`)
          .then(r2 => r2.json())
          .then(d2 => {
            if (d2.ok) { setReleaseVersion(d2.release_version) }
            else { setReleaseVersion('—'); setReleaseErr(d2.error || 'Could not resolve release') }
          })
          .catch(e => { setReleaseVersion('—'); setReleaseErr(String(e)) })
      })
      .catch(e => { setBranchVersion('—'); setBranchErr(String(e)) })
  }

  useEffect(() => { fetchPayorVersions() }, [vmName, cfg.app])

  // Poll build status while a build is running
  useEffect(() => {
    if (buildStatus !== 'running') return
    const iv = setInterval(() => {
      fetch(`/api/vms/developer/${encodeURIComponent(vmName)}/app-build-status/${encodeURIComponent(cfg.app)}`)
        .then(r => r.json())
        .then(d => {
          if (d.ok && d.status && d.status !== 'running') {
            setBuildStatus(d.status)
            setBuildOutput(d.output || '')
            if (d.status === 'success') onRefreshStatus()
          }
        })
        .catch(() => {})
    }, 3000)
    return () => clearInterval(iv)
  }, [buildStatus, vmName, cfg.app, onRefreshStatus])

  // Poll action (start/stop/restart) status with live output
  // Also periodically refresh running status so auto-clear fires even when SSH cmd stays open
  useEffect(() => {
    if (actionStatus !== 'running') return
    let tick = 0
    const iv = setInterval(() => {
      fetch(`/api/vms/developer/${encodeURIComponent(vmName)}/app-action-status/${encodeURIComponent(cfg.app)}`)
        .then(r => r.json())
        .then(d => {
          if (!d.ok) return
          setActionOutput(d.output || '')
          if (d.status && d.status !== 'running') {
            setActionStatus(d.status)
            if (d.status === 'done') onRefreshStatus()
          }
        })
        .catch(() => {})
      // Refresh app running status every 5s so auto-clear can fire
      tick++
      if (tick % 5 === 0) onRefreshStatus()
    }, 1000)
    return () => clearInterval(iv)
  }, [actionStatus, vmName, cfg.app, onRefreshStatus])

  function runAction(action, extraFlags = []) {
    if (action === 'build') {
      setBuildStatus('running')
      setBuildOutput('')
      setBuildOpen(false)
      fetch(`/api/vms/developer/${encodeURIComponent(vmName)}/app-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: cfg.app, action: 'build', extra_flags: extraFlags }),
      })
        .then(r => r.json())
        .then(d => {
          if (!d.async) {
            setBuildStatus(d.ok ? 'success' : 'failed')
            setBuildOutput(d.output || d.error || '')
            if (d.ok) onRefreshStatus()
          }
        })
        .catch(err => { setBuildStatus('failed'); setBuildOutput(String(err)) })
      return
    }

    setActiveAction(action)
    setActionStatus('running')
    setActionOutput('')
    fetch(`/api/vms/developer/${encodeURIComponent(vmName)}/app-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: cfg.app, action }),
    })
      .then(r => r.json())
      .then(d => {
        if (!d.async) {
          setActionStatus(d.ok ? 'done' : 'error')
          setActionOutput(d.output || d.error || '')
          if (d.ok) onRefreshStatus()
        }
      })
      .catch(err => { setActionStatus('error'); setActionOutput(String(err)) })
  }

  function abortBuild() {
    fetch(`/api/vms/developer/${encodeURIComponent(vmName)}/app-abort-build/${encodeURIComponent(cfg.app)}`, { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (d.ok) { setBuildStatus('aborted'); setBuildOutput('') } })
      .catch(() => {})
  }

  const isBuildRunning  = buildStatus === 'running'
  const isActionRunning = actionStatus === 'running'
  const anyBusy         = isBuildRunning || isActionRunning
  const hasBuild        = !!cfg.build_cmd

  const [statusColor, statusBg, statusBorder, statusLabel, showSpinner] = (() => {
    if (buildStatus === 'running')  return ['#f0ad4e', '#2a1d0a', '#7a4d1e', '⟳ Build In Progress', true]
    if (buildStatus === 'success')  return ['#4caf50', '#0d2a0d', '#1e4d1e', '✓ Build Success',     false]
    if (buildStatus === 'failed')   return ['#f44336', '#2a0d0d', '#4d1e1e', '✗ Build Failed',      false]
    if (buildStatus === 'aborted')  return ['#f44336', '#2a0d0d', '#4d1e1e', '✗ Build Aborted',     false]
    if (isActionRunning) {
      const lbl = ACTION_LABELS[activeAction] || activeAction
      return ['#f0ad4e', '#2a1d0a', '#7a4d1e', `⟳ ${lbl}…`, true]
    }
    if (actionStatus === 'error')   return ['#f44336', '#2a0d0d', '#4d1e1e', `✗ ${ACTION_LABELS[activeAction] || ''} Failed`, false]
    if (cfg.running == null) return ['var(--text-muted)', 'var(--surface2)', 'var(--border)', 'Unknown', false]
    return cfg.running
      ? ['#4caf50', '#0d2a0d', '#1e4d1e', '● Running',  false]
      : ['#f44336', '#2a0d0d', '#4d1e1e', '○ Stopped',  false]
  })()

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', minWidth: 100 }}>
          {cfg.app.charAt(0).toUpperCase() + cfg.app.slice(1)}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
          background: statusBg, color: statusColor, border: `1px solid ${statusBorder}`,
          display: 'flex', alignItems: 'center', gap: 6 }}>
          {showSpinner && <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5, borderColor: statusColor, borderTopColor: 'transparent' }} />}
          {statusLabel}
        </span>

        {cfg.app === 'payor' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {(branchVersion === 'loading' || releaseVersion === 'loading') ? (
              <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
            ) : (
              <>
                {branchVersion && branchVersion !== '—' && !branchErr && (
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                    background: 'rgba(88,166,255,0.1)', color: '#58a6ff',
                    border: '1px solid rgba(88,166,255,0.3)',
                  }}>
                    {branchVersion}
                  </span>
                )}
                {releaseVersion && releaseVersion !== '—' && !releaseErr && (
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                    background: 'rgba(163,113,247,0.1)', color: '#a371f7',
                    border: '1px solid rgba(163,113,247,0.3)',
                  }}>
                    v{releaseVersion}
                  </span>
                )}
                {(branchErr || releaseErr) && (
                  <span style={{ fontSize: 11, color: '#f44336' }} title={branchErr || releaseErr}>⚠</span>
                )}
              </>
            )}
            <button
              className="btn btn-sm"
              onClick={fetchPayorVersions}
              disabled={branchVersion === 'loading' || releaseVersion === 'loading'}
              title="Refresh branch & release"
              style={{ fontSize: 11, padding: '2px 7px' }}
            >↻</button>
          </div>
        )}

        {REMOTE_BRANCH_APPS.has(cfg.app) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {remBranchLoading ? (
              <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
            ) : (
              <>
                {remoteBranchInfo?.branch && (
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                    background: 'rgba(88,166,255,0.1)', color: '#58a6ff',
                    border: '1px solid rgba(88,166,255,0.3)',
                  }}>
                    {remoteBranchInfo.branch}
                  </span>
                )}
                {remoteBranchInfo?.release_ver && (
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                    background: 'rgba(163,113,247,0.1)', color: '#a371f7',
                    border: '1px solid rgba(163,113,247,0.3)',
                  }}>
                    v{remoteBranchInfo.release_ver}
                  </span>
                )}
                {!remoteBranchInfo && vmIp && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
                )}
              </>
            )}
            <button
              className="btn btn-sm"
              onClick={onRefreshBranch}
              disabled={remBranchLoading}
              title="Refresh branch & release"
              style={{ fontSize: 11, padding: '2px 7px' }}
            >↻</button>
          </div>
        )}

        {cfg.app === 'connector' && cfg.running === true && vmIp && (
          <a
            href={`http://${vmIp}:8181/connector/services`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12, color: 'var(--primary)', textDecoration: 'none',
              border: '1px solid var(--primary)', borderRadius: 4, padding: '2px 8px',
              display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            ↗ Connector Webservices
          </a>
        )}

        {cfg.app === 'pik' && cfg.running === true && vmIp && (
          <a
            href={`http://${vmIp}:7004/web-services`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12, color: 'var(--primary)', textDecoration: 'none',
              border: '1px solid var(--primary)', borderRadius: 4, padding: '2px 8px',
              display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            ↗ PIK Webservices
          </a>
        )}

        {cfg.app === 'payor' && cfg.running === true && vmIp && (
          <a
            href={`http://${vmIp}:7001/web-services`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12, color: 'var(--primary)', textDecoration: 'none',
              border: '1px solid var(--primary)', borderRadius: 4, padding: '2px 8px',
              display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            ↗ Payor Webservices
          </a>
        )}

        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
          {isBuildRunning ? (
            <button className="btn btn-sm" onClick={abortBuild} style={{ color: '#f44336', borderColor: '#4d1e1e' }}>
              ✕ Abort Build
            </button>
          ) : (
            <>
              {hasBuild && (
                <button className="btn btn-sm" disabled={anyBusy} onClick={() => setBuildOpen(o => !o)}>
                  {buildOpen ? '▾ Build' : '▸ Build'}
                </button>
              )}
              {[
                { action: 'start',   label: 'Start'   },
                { action: 'stop',    label: 'Stop'     },
                { action: 'restart', label: 'Restart'  },
              ].map(({ action, label }) => (
                <button key={action} className="btn btn-sm" disabled={anyBusy} onClick={() => runAction(action)}>
                  {isActionRunning && activeAction === action
                    ? <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />
                    : label}
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Live console for start / stop / restart */}
      {actionStatus && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: 'var(--surface2)', border: '1px solid var(--border)', borderBottom: 'none',
            borderRadius: '6px 6px 0 0', padding: '5px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
            <span>
              {ACTION_LABELS[activeAction] || activeAction} output
              {actionStatus === 'running' && <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5, marginLeft: 8, display: 'inline-block' }} />}
              {actionStatus === 'done'    && <span style={{ color: '#4caf50', marginLeft: 8 }}>✓ Done</span>}
              {actionStatus === 'error'   && <span style={{ color: '#f44336', marginLeft: 8 }}>✗ Failed</span>}
            </span>
            <button onClick={() => { setActionStatus(null); setActionOutput(''); setActiveAction(null) }}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
          </div>
          <pre ref={consoleRef} style={{
            margin: 0, background: '#010409', border: '1px solid var(--border)',
            borderRadius: '0 0 6px 6px', padding: '10px 14px',
            fontFamily: 'Consolas, monospace', fontSize: 12, lineHeight: 1.5,
            color: '#c9d1d9', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            maxHeight: 240, overflowY: 'auto',
          }}>
            {actionOutput || <span style={{ color: 'var(--text-muted)' }}>Waiting for output…</span>}
          </pre>
        </div>
      )}

      {buildOpen && (
        <BuildParamForm
          app={cfg.app}
          buildCmd={cfg.build_cmd}
          buildParams={buildParams}
          busy={isBuildRunning}
          onRun={(flags) => runAction('build', flags)}
          onCancel={() => setBuildOpen(false)}
        />
      )}

      {buildStatus && buildStatus !== 'running' && buildOutput && (
        <ActionOutput
          output={buildStatus === 'success' ? buildOutput : ''}
          error={buildStatus !== 'success'  ? buildOutput : ''}
          onClose={() => { setBuildStatus(null); setBuildOutput('') }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// VM Applications tab
// ---------------------------------------------------------------------------
function VmApplicationsTab({ vmName, vmIp }) {
  const [appsConfig,      setAppsConfig]      = useState([])
  const [buildParams,     setBuildParams]     = useState({})
  const [configLoading,   setConfigLoading]   = useState(true)
  const [appStatuses,     setAppStatuses]     = useState({})
  const [statusLoading,   setStatusLoading]   = useState(true)
  const [statusError,     setStatusError]     = useState('')
  const [remoteBranchAll, setRemoteBranchAll] = useState({})
  const [branchLoading,   setBranchLoading]   = useState(false)

  useEffect(() => {
    fetch(`/api/vms/developer/${encodeURIComponent(vmName)}/app-config`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setAppsConfig(d.apps || []); setBuildParams(d.build_params || {}) }
        setConfigLoading(false)
      })
      .catch(() => setConfigLoading(false))
  }, [vmName])

  const fetchStatus = useCallback(() => {
    setStatusLoading(true); setStatusError('')
    fetch(`/api/vms/developer/${encodeURIComponent(vmName)}/app-status`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          const map = {}
          ;(d.apps || []).forEach(a => { map[a.app] = a.running })
          setAppStatuses(map)
        } else {
          setStatusError(d.error || 'Failed to fetch app status')
        }
        setStatusLoading(false)
      })
      .catch(() => { setStatusError('Request failed'); setStatusLoading(false) })
  }, [vmName])

  const fetchBranchAll = useCallback((force = false) => {
    if (!vmIp) return
    setBranchLoading(true)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), BRANCH_FETCH_TIMEOUT_MS)
    const url = `/api/remote-app/branch-info-all?vm_ip=${encodeURIComponent(vmIp)}${force ? '&force=true' : ''}`
    fetch(url, { signal: ctrl.signal })
      .then(r => r.json())
      .then(d => { if (d.ok && d.apps) setRemoteBranchAll(d.apps) })
      .catch(() => {})
      .finally(() => { clearTimeout(timer); setBranchLoading(false) })
  }, [vmIp])

  useEffect(() => { fetchStatus() }, [fetchStatus])
  useEffect(() => {
    const t = setTimeout(() => fetchBranchAll(), BRANCH_FETCH_DELAY_MS)
    return () => clearTimeout(t)
  }, [fetchBranchAll])

  const mergedApps = appsConfig.map(c => ({ ...c, running: appStatuses[c.app] ?? null }))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-sm" onClick={fetchStatus} disabled={statusLoading}>
          {statusLoading
            ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
            : '↺ Refresh Status'}
        </button>
      </div>

      {statusError && <div className="alert alert-error" style={{ marginBottom: 12 }}>{statusError}</div>}

      {(configLoading || statusLoading) && mergedApps.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', fontSize: 13 }}>
          <span className="spinner" /> Loading applications…
        </div>
      ) : mergedApps.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No applications configured for this VM.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mergedApps.map(c => (
            <AppCard
              key={c.app}
              cfg={c}
              buildParams={buildParams}
              vmName={vmName}
              vmIp={vmIp}
              onRefreshStatus={fetchStatus}
              remoteBranchInfo={remoteBranchAll[c.app] || null}
              remBranchLoading={branchLoading}
              onRefreshBranch={() => fetchBranchAll(true)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// VM Details tab (SSH branch/env info)
// ---------------------------------------------------------------------------
function VmDetailsTab({ vmName, vmIp }) {
  const [loading, setLoading] = useState(true)
  const [data,    setData]    = useState(null)
  const [error,   setError]   = useState('')

  const fetch_ = useCallback(() => {
    setLoading(true); setError(''); setData(null)
    fetch(`/api/vms/developer/${encodeURIComponent(vmName)}/status`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) setData(d)
        else setError(d.error || 'Failed to fetch status.')
        setLoading(false)
      })
      .catch(() => { setError('Request failed.'); setLoading(false) })
  }, [vmName])

  useEffect(() => { fetch_() }, [fetch_])

  return (
    <div>
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', fontSize: 13 }}>
          <span className="spinner" /> SSH connecting to {vmIp}…
        </div>
      )}
      {error && <div className="alert alert-error" style={{ margin: 0 }}>{error}</div>}
      {data && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{vmIp}</span>
            <button className="btn btn-sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={fetch_}>
              ↺ Refresh
            </button>
          </div>
          <div className="table-wrap" style={{ maxWidth: 700 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: '40%' }}>Property</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.parsed || {}).map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ color: 'var(--primary)', fontWeight: 500 }}>{k}</td>
                    <td className="mono" style={{ wordBreak: 'break-all', fontSize: 12 }}>{v || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Single SSH terminal session — persistent across page navigation
//
// The xterm.js element lives in _termSessions (module scope). On mount it is
// appended to the React-managed container; on unmount it is detached but NOT
// destroyed, so the WebSocket and scrollback history survive navigation.
// ---------------------------------------------------------------------------
function TerminalSession({ vmName, sessionId, active, onSessionEnd }) {
  const mountRef      = useRef(null)
  const onEndRef      = useRef(onSessionEnd)
  onEndRef.current    = onSessionEnd   // always latest, no stale closure

  // Attach / detach the persistent DOM element on every mount / unmount
  useEffect(() => {
    const mountEl = mountRef.current
    if (!mountEl) return

    const key = _sessionKey(vmName, sessionId)
    let s = _termSessions.get(key)

    if (!s) {
      // First time: create the persistent element + terminal + WebSocket
      const el = document.createElement('div')
      el.style.cssText = 'width:100%;height:100%;'

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'Consolas, "Courier New", monospace',
        theme: {
          background:          '#0d1117',
          foreground:          '#c9d1d9',
          cursor:              '#c9d1d9',
          selectionBackground: 'rgba(99,102,241,0.35)',
          black:   '#484f58', red:     '#ff7b72', green:   '#3fb950', yellow: '#d29922',
          blue:    '#58a6ff', magenta: '#bc8cff', cyan:    '#39c5cf', white:  '#b1bac4',
        },
        scrollback: 5000,
      })
      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(
        `${proto}//${window.location.host}/ws/vms/developer/${encodeURIComponent(vmName)}/terminal`
      )

      ws.onopen = () => { s.connected = true }

      ws.onmessage = (e) => term.write(e.data)

      // onerror only fires when the connection could never be established
      ws.onerror = () => {
        if (!s.connected) {
          term.write(
            '\r\n\x1b[31mCould not connect.\x1b[0m Ensure \x1b[33mflask-sock\x1b[0m is installed:\r\n  pip install flask-sock\r\n'
          )
        }
      }

      // onclose fires when the SSH session ends (exit/logout) or connection drops
      ws.onclose = () => {
        if (s.connected) {
          term.write('\r\n\x1b[90m[Session ended]\x1b[0m\r\n')
          // Auto-close this terminal tab after a brief pause so the message is readable
          setTimeout(() => onEndRef.current?.(), 1500)
        }
      }

      term.onData(data => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }))
      })
      term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      })

      s = { el, term, fitAddon, ws, ro: null, opened: false, connected: false }
      _termSessions.set(key, s)
    }

    // Append persistent element to current React container
    mountEl.appendChild(s.el)

    // Open terminal into DOM on first attach (needs to be in DOM for sizing)
    if (!s.opened) {
      s.term.open(s.el)
      s.opened = true
    }

    // Wire a fresh ResizeObserver to the current mount point
    s.ro?.disconnect()
    s.ro = new ResizeObserver(() => { try { s.fitAddon.fit() } catch (_) {} })
    s.ro.observe(mountEl)

    return () => {
      // Detach from DOM but keep alive — don't close WS or dispose terminal
      s.ro?.disconnect(); s.ro = null
      try { mountEl.removeChild(s.el) } catch (_) {}
    }
  }, [vmName, sessionId])

  // Refit + focus whenever this tab becomes active
  useEffect(() => {
    if (!active) return
    const s = _termSessions.get(_sessionKey(vmName, sessionId))
    if (!s) return
    const t = setTimeout(() => {
      try {
        s.fitAddon.fit()
        const dims = s.fitAddon.proposeDimensions()
        if (dims && s.ws.readyState === WebSocket.OPEN) {
          s.ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }))
        }
      } catch (_) {}
      s.term.focus()
    }, 30)
    return () => clearTimeout(t)
  }, [active, vmName, sessionId])

  return <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
}

// ---------------------------------------------------------------------------
// VM Terminal tab — multiple persistent SSH sessions with a tab bar
// ---------------------------------------------------------------------------
function VmTerminalTab({ vmName }) {
  // Restore state from module store so tab layout survives navigation
  const [sessions, setSessions] = useState(() => {
    if (!_vmTabState.has(vmName)) {
      _vmTabState.set(vmName, { sessions: [{ id: 1 }], activeId: 1, nextId: 2 })
    }
    return _vmTabState.get(vmName).sessions
  })
  const [activeId, setActiveId] = useState(() => _vmTabState.get(vmName).activeId)
  const nextIdRef = useRef(_vmTabState.get(vmName).nextId)

  // Keep module store in sync
  useEffect(() => {
    const state = _vmTabState.get(vmName)
    if (state) { state.sessions = sessions; state.activeId = activeId; state.nextId = nextIdRef.current }
  }, [sessions, activeId, vmName])

  function addTab() {
    const id = nextIdRef.current++
    setSessions(s => [...s, { id }])
    setActiveId(id)
  }

  function closeTab(id, e = null) {
    e?.stopPropagation()
    _cleanupSession(vmName, id)
    setSessions(prev => {
      const remaining = prev.filter(s => s.id !== id)
      if (remaining.length === 0) {
        // Last session closed — open a fresh one automatically
        const newId = nextIdRef.current++
        setActiveId(newId)
        return [{ id: newId }]
      }
      if (activeId === id) {
        const idx = prev.findIndex(s => s.id === id)
        setActiveId(remaining[Math.max(0, idx - 1)].id)
      }
      return remaining
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 490 }}>
      {/* Session tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', flexShrink: 0,
        background: '#161b22', borderRadius: '6px 6px 0 0',
        padding: '4px 8px 0', borderBottom: '1px solid #30363d',
      }}>
        {sessions.map((s, i) => {
          const isActive = activeId === s.id
          return (
            <div
              key={s.id}
              onClick={() => setActiveId(s.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 10px 5px 14px',
                cursor: 'pointer', userSelect: 'none',
                borderRadius: '4px 4px 0 0', fontSize: 12, fontFamily: 'monospace',
                color:        isActive ? '#c9d1d9' : '#8b949e',
                background:   isActive ? '#0d1117' : 'transparent',
                borderBottom: isActive ? '1px solid #0d1117' : '1px solid transparent',
                marginBottom: -1,
              }}
            >
              <span>Terminal {i + 1}</span>
              {sessions.length > 1 && (
                <button
                  onClick={(e) => closeTab(s.id, e)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'inherit', padding: '0 2px', fontSize: 14,
                    lineHeight: 1, opacity: 0.55,
                  }}
                  title="Close session"
                >×</button>
              )}
            </div>
          )
        })}
        <button
          onClick={addTab}
          title="New terminal session"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#8b949e', fontSize: 18, lineHeight: 1,
            padding: '2px 8px', marginLeft: 2,
          }}
        >+</button>
      </div>

      {/* Terminal panes — all mounted; inactive hidden via visibility so dimensions stay valid */}
      <div style={{ flex: 1, position: 'relative', background: '#0d1117', borderRadius: '0 0 6px 6px', overflow: 'hidden' }}>
        {sessions.map(s => (
          <div
            key={s.id}
            style={{
              position: 'absolute', inset: 0, padding: '2px 0',
              visibility:   activeId === s.id ? 'visible'  : 'hidden',
              pointerEvents: activeId === s.id ? 'auto'    : 'none',
            }}
          >
            <TerminalSession
              vmName={vmName}
              sessionId={s.id}
              active={activeId === s.id}
              onSessionEnd={() => closeTab(s.id)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline panel with tabs shown below a clicked VM row
// ---------------------------------------------------------------------------
function VmInlinePanel({ vm }) {
  const TABS = ['VM Applications', 'Terminal', 'VM Details']
  const [activeTab, setActiveTab] = useState('VM Applications')

  return (
    <tr>
      <td colSpan={5} style={{ background: 'var(--surface2)', padding: 0, borderTop: '1px solid var(--border)' }}>
        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', padding: '0 20px' }}>
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid var(--primary)' : '2px solid transparent',
                color: activeTab === tab ? 'var(--primary)' : 'var(--text-muted)',
                fontWeight: activeTab === tab ? 600 : 400,
                fontSize: 13,
                padding: '10px 16px',
                cursor: 'pointer',
                marginBottom: -1,
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ padding: '18px 24px' }}>
          {activeTab === 'VM Applications' && <VmApplicationsTab vmName={vm.name} vmIp={vm.ip} />}
          {activeTab === 'Terminal'         && <VmTerminalTab vmName={vm.name} />}
          {activeTab === 'VM Details'       && <VmDetailsTab vmName={vm.name} vmIp={vm.ip} />}
        </div>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function DevVMsPage() {
  const navigate   = useNavigate()
  const [vms,      setVms]      = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [expanded, setExpanded] = useState(null)   // vmName of currently open row
  const [vmPing,   setVmPing]   = useState({})     // { vmName: true|false|null }

  const load = useCallback(() => {
    setLoading(true); setError('')
    fetch('/api/vms/developer')
      .then(r => r.json())
      .then(d => {
        setVms(Array.isArray(d) ? d : [])
        setLoading(false)
        // probe reachability after list loads
        const names = (Array.isArray(d) ? d : []).filter(v => v.ip).map(v => v.name)
        if (names.length > 0) {
          setVmPing(Object.fromEntries(names.map(n => [n, null])))  // null = checking
          fetch('/api/vms/developer-ping')
            .then(r => r.json())
            .then(p => {
              const map = {}
              ;(p.results || []).forEach(r => { map[r.name] = r.reachable })
              setVmPing(map)
            })
            .catch(() => {})
        }
      })
      .catch(() => { setError('Failed to load VMs.'); setLoading(false) })
  }, [])

  useEffect(() => { load() }, [load])

  function toggleRow(vmName) {
    setExpanded(prev => prev === vmName ? null : vmName)
  }

  return (
    <div>
      <button
        className="btn back-link"
        onClick={() => navigate('/manage-dev-vms')}
        style={{ marginBottom: 16, fontSize: 12, padding: '4px 10px' }}
      >
        ← Manage Developer VMs
      </button>

      <div className="page-header">
        <h1 className="page-title">Developer VMs</h1>
        <button className="btn" onClick={load} disabled={loading}>↺ Refresh</button>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
        Click a row to view VM Applications and VM Details.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="center"><span className="spinner" /></div>
      ) : vms.length === 0 ? (
        <div className="empty">
          <h3>No VMs found</h3>
          <p>No entries in the Developer VMs registry yet.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>Name</th>
                <th>IP Address</th>
                <th>Status</th>
                <th>Description</th>
                <th>Assigned To</th>
              </tr>
            </thead>
            <tbody>
              {vms.map((vm, i) => {
                const key    = vm.name || String(i)
                const isOpen = expanded === key
                return (
                  <>
                    <tr
                      key={key}
                      onClick={() => toggleRow(key)}
                      style={{ cursor: 'pointer' }}
                      className="clickable-row"
                    >
                      <td style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'center', userSelect: 'none' }}>
                        {isOpen ? '▾' : '▸'}
                      </td>
                      <td style={{ fontWeight: 500, color: 'var(--primary)' }}>{vm.name || '—'}</td>
                      <td className="mono">{vm.ip || '—'}</td>
                      <td>
                        {vm.ip
                          ? vmPing[vm.name] === null
                            ? <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>○ Checking…</span>
                            : vmPing[vm.name]
                              ? <span style={{ color: '#22c55e', fontSize: 12, fontWeight: 500 }}>● Online</span>
                              : <span style={{ color: '#ef4444', fontSize: 12, fontWeight: 500 }}>● Offline</span>
                          : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                        }
                      </td>
                      <td>{vm.description || '—'}</td>
                      <td>{vm.assigned_to || '—'}</td>
                    </tr>
                    {isOpen && <VmInlinePanel key={`${key}-panel`} vm={vm} />}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
