import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import SqlQueryPanel from '../components/SqlQueryPanel'
import ConfirmDialog from '../components/ConfirmDialog'
import { ConfigureModal, KarafRightPanel, GpRunPanel, ColoredTerminal } from './LocalAppShared'
export { KarafRightPanel }

// Shared localStorage TTL cache (same keys as GenericRemoteAppPage / RemoteAppDevPage)
const BRANCH_TTL_KEY = 'rcache_branch_ttl'
function _cacheGet(key) {
  try {
    const item = JSON.parse(localStorage.getItem(key))
    if (item && item.expires > Date.now()) return item.data
  } catch {}
  return undefined
}
function _cacheSet(key, data, ttlMs) {
  if (!ttlMs) return
  localStorage.setItem(key, JSON.stringify({ data, expires: Date.now() + ttlMs }))
}
function _cacheTtl() {
  const v = parseInt(localStorage.getItem(BRANCH_TTL_KEY), 10)
  return isNaN(v) ? 600000 : v  // default 10 min when not yet configured
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [text])
  if (!text) return null
  return (
    <button onClick={copy} className="btn btn-sm"
      style={{ fontSize: 11, padding: '1px 7px', marginLeft: 4 }}>
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

const BUILD_FLAGS = [
  { flag: '-ncs',  label: 'No Code Sync',   def: true  },
  { flag: '-st',   label: 'Skip Tests',     def: true  },
  { flag: '-c',    label: 'Create Schema',  def: false },
  { flag: '-ncb',  label: 'No Clean Build', def: false },
  { flag: '-nbld', label: 'No Build',       def: false },
]

export function Field({ label, children }) {
  return (
    <div>
      <div className="meta-label">{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500, marginTop: 3 }}>{children}</div>
    </div>
  )
}

function ComingSoon({ title }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>🚧</div>
      <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 14 }}>Remote access — Coming soon</div>
    </div>
  )
}

// ── Current Branch panel ─────────────────────────────────────────────────────
export function RemoteCurrentBranchPanel({ appIcon, appLabel = 'App', branch, branchLoad, branchErr,
                                           onRefresh, onPull, pulling, pullOk, pullErr }) {
  return (
    <div className="card" style={{ flex: '1 1 320px', marginBottom: 0 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Current Branch</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ fontSize: 30, lineHeight: 1, flexShrink: 0 }}>{appIcon}</div>
        {branchLoad ? (
          <span className="spinner" style={{ marginLeft: 4 }} />
        ) : branchErr ? (
          <span style={{ color: 'var(--danger)', fontSize: 13 }}>{branchErr}</span>
        ) : branch ? (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', flex: 1 }}>
            <Field label="Release Branch">
              <span className="badge badge-success" title={branch.branch} style={{ fontSize: 13, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{branch.branch}</span>
            </Field>
            <Field label={`${appLabel} Version`}><code>{branch.release_ver || '—'}</code></Field>
            <Field label="App Server">{branch.env_type || '—'}</Field>
            <Field label="Clone Directory">
              <code style={{ fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{branch.srcdir || '—'}</code>
            </Field>
          </div>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, alignSelf: 'flex-start', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm" onClick={onRefresh} disabled={branchLoad} title="Refresh">↻</button>
            <button className="btn btn-sm" onClick={onPull} disabled={pulling || branchLoad} style={{ whiteSpace: 'nowrap' }}>
              {pulling ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Pulling…</> : '↓ Pull'}
            </button>
          </div>
          {pullOk && (
            <div style={{ fontSize: 11, color: '#2e7d32', maxWidth: 260, wordBreak: 'break-word',
              background: 'rgba(76,175,80,0.08)', border: '1px solid rgba(76,175,80,0.3)',
              borderRadius: 4, padding: '3px 8px' }}>
              {pullOk}
            </div>
          )}
          {pullErr && (
            <div style={{ fontSize: 11, color: '#c62828', maxWidth: 260, wordBreak: 'break-word',
              background: 'rgba(244,67,54,0.08)', border: '1px solid rgba(244,67,54,0.25)',
              borderRadius: 4, padding: '3px 8px' }}>
              {pullErr}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
function _extractMajorMinor(ver) {
  if (!ver) return null
  const m = String(ver).match(/(\d+)\.(\d+)/)
  return m ? `${m[1]}.${m[2]}` : null
}

function _versionPrefix(ver, n) {
  const parts = String(ver).match(/\d+/g) || []
  return parts.slice(0, n).join('.')
}

export function SetBranchPanel({ vmIp, appName = 'payor', appLabel = 'Payor', domainStatus, onBranchSet, branchInfo }) {
  const [branches,    setBranches]    = useState([])
  const [branchesErr, setBranchesErr] = useState(null)
  const [filter,      setFilter]      = useState('')
  const [selected,    setSelected]    = useState('')
  const [setting,     setSetting]     = useState(false)
  const [cmdId,       setCmdId]       = useState(null)
  const [setErr,      setSetErr]      = useState(null)
  const [setOk,       setSetOk]       = useState(false)
  const [domainOnly,  setDomainOnly]  = useState(appName === 'payor')
  const [setOutput,   setSetOutput]   = useState('')
  const [showSetLog,  setShowSetLog]  = useState(false)
  const sbLogRef   = useRef(null)
  const SB_LS_KEY  = `set_branch_${appName}_${vmIp}`

  useEffect(() => {
    if (!vmIp) return
    fetch(`/api/remote-app/${appName}/branches?vm_ip=${encodeURIComponent(vmIp)}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setBranches(d.branches || [])
          if (d.branches && d.branches.length > 0) setSelected(d.branches[0])
        } else {
          setBranchesErr(d.error || 'Failed to load branches')
        }
      })
      .catch(() => setBranchesErr('Could not load branches'))
  }, [vmIp, appName])

  // Poll command status while set-branch is running
  useEffect(() => {
    if (!cmdId || !setting) return
    const id = setInterval(() => {
      fetch(`/api/remote-app/${appName}/command-status?cmd_id=${cmdId}`)
        .then(r => r.json())
        .then(d => {
          if (d.ok) {
            if (d.output) setSetOutput(d.output)
            if (d.status !== 'running') {
              setSetting(false); setCmdId(null)
              localStorage.removeItem(SB_LS_KEY)
              if (d.status === 'success') { setSetOk(true); onBranchSet?.(); setTimeout(() => setSetOk(false), 5000) }
              else if (d.status !== 'aborted') setSetErr(d.output || 'Set branch failed')
            }
          }
        })
        .catch(() => {})
    }, 1200)
    return () => clearInterval(id)
  }, [cmdId, setting])

  // Reattach to an in-progress set-branch on mount (survives browser refresh)
  useEffect(() => {
    const saved = localStorage.getItem(SB_LS_KEY)
    if (!saved) return
    fetch(`/api/remote-app/${appName}/command-status?cmd_id=${saved}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setSetOutput(d.output || '')
          if (d.status === 'running') {
            setCmdId(saved); setSetting(true); setShowSetLog(true)
          } else {
            if (d.status === 'success') { setSetOk(true); onBranchSet?.() }
            else if (d.status !== 'aborted') setSetErr(d.output || 'Set branch failed')
            localStorage.removeItem(SB_LS_KEY)
          }
        } else {
          localStorage.removeItem(SB_LS_KEY)
        }
      })
      .catch(() => {})
  }, [vmIp, appName])

  useEffect(() => {
    if (sbLogRef.current) sbLogRef.current.scrollTop = sbLogRef.current.scrollHeight
  }, [setOutput])

  function handleSet() {
    if (!selected) return
    setSetting(true); setSetErr(null); setSetOk(false); setSetOutput(''); setShowSetLog(true)
    fetch(`/api/remote-app/${appName}/set-branch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vm_ip: vmIp, version: selected }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setCmdId(d.cmd_id); localStorage.setItem(SB_LS_KEY, d.cmd_id) }
        else { setSetErr(d.error || 'Failed'); setSetting(false) }
      })
      .catch(() => { setSetErr('Could not reach server'); setSetting(false) })
  }

  function handleSetAbort() {
    if (!cmdId) return
    fetch(`/api/remote-app/${appName}/run-command/abort`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vm_ip: vmIp, cmd_id: cmdId }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setSetting(false); setCmdId(null); localStorage.removeItem(SB_LS_KEY) }
      })
      .catch(() => {})
  }

  const allDomains       = domainStatus?.all_domain_versions || []
  const branchReleaseMap = domainStatus?.branch_release_map || {}
  const domainInfoLoaded = domainStatus != null

  function matchingDomain(b) {
    if (!b) return null
    const entry = branchReleaseMap[b]
    if (entry) return entry.domain || null
    if (branchInfo?.branch === b && branchInfo?.release_ver) {
      const rv = branchInfo.release_ver
      return allDomains.includes(rv) ? rv : null
    }
    return null
  }

  const domainFiltered = (domainOnly && domainInfoLoaded)
    ? branches.filter(b => matchingDomain(b) !== null)
    : branches
  const filtered = domainFiltered.filter(b => !filter || b.startsWith(filter))

  // Keep selected in sync when filter/domainOnly changes
  useEffect(() => {
    if (filtered.length > 0 && !filtered.includes(selected)) setSelected(filtered[0])
  }, [domainOnly, filter])

  return (
    // Column wrapper: card stays fixed-size; log terminal expands below without
    // affecting adjacent cards in the flex row.
    <div style={{ flex: '0 1 280px', display: 'flex', flexDirection: 'column', gap: 8, alignSelf: 'flex-start' }}>
      <div className="card" style={{ marginBottom: 0, boxSizing: 'border-box' }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Set {appLabel} Branch</div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginBottom: 10, height: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
                          color: 'var(--text-muted)', cursor: domainInfoLoaded ? 'pointer' : 'default',
                          userSelect: 'none', opacity: domainInfoLoaded ? 1 : 0.5 }}>
            <input type="checkbox" checked={domainOnly} onChange={e => setDomainOnly(e.target.checked)}
              disabled={!domainInfoLoaded}
              style={{ accentColor: 'var(--primary)', width: 13, height: 13, flexShrink: 0 }} />
            Domain available only
          </label>
          <span style={{ fontSize: 11, color: '#2e7d32', fontWeight: 600, minWidth: 24, textAlign: 'right' }}>
            {domainInfoLoaded && domainOnly ? `(${domainFiltered.length})` : ''}
          </span>
        </div>

        {branchesErr && <div className="alert alert-error" style={{ marginBottom: 10 }}>{branchesErr}</div>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="text" placeholder="Filter…" value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ width: 80, maxWidth: 80, flexShrink: 0 }} />
          <select value={selected} onChange={e => setSelected(e.target.value)}
            disabled={filtered.length === 0}
            style={{ flex: 1, minWidth: 0, width: 0, padding: '8px 10px', background: 'var(--surface)',
              border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 13, fontFamily: 'inherit' }}>
            {filtered.length === 0
              ? <option value="">No matches</option>
              : filtered.map(b => {
                  const dv = matchingDomain(b)
                  return <option key={b} value={b}>{b}{dv ? ` → v${dv}` : ''}</option>
                })}
          </select>
        </div>
        <button className="btn btn-primary btn-sm" onClick={handleSet}
          disabled={setting || !selected || filtered.length === 0}
          style={{ marginTop: 10, width: '100%' }}>
          {setting ? <><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> Setting…</> : `Set ${appLabel} Branch`}
        </button>
        {setErr && <div className="alert alert-error" style={{ marginTop: 8 }}>{setErr}</div>}
        {setOk && !setErr && <div className="alert alert-info" style={{ marginTop: 8 }}>Branch set to <strong>{selected}</strong>.</div>}

        {/* Set-branch log controls (inside card, terminal rendered below) */}
        {(setting || setOutput) && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10 }}>
            <button className="btn btn-sm" onClick={() => setShowSetLog(v => !v)}>
              {showSetLog ? '▲ Hide Log' : '▼ Show Log'}
            </button>
            {setting && (
              <button className="btn btn-sm" style={{ color: '#c62828', borderColor: '#e57373' }}
                onClick={handleSetAbort}>⊗ Abort</button>
            )}
            {!setting && setOutput && (
              <>
                <CopyButton text={setOutput} />
                <button className="btn btn-sm" onClick={() => { setSetOutput(''); setShowSetLog(false) }}>
                  ✕ Clear
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Set-branch log terminal (below card) ── */}
      {showSetLog && (setting || setOutput) && (
        <ColoredTerminal output={setOutput} termRef={sbLogRef} height={180} />
      )}
    </div>
  )
}
export function RemoteBranchManagementPanel({ vmIp, appName = 'payor', onCheckout, onCurrentChange, style: outerStyle, refreshTick }) {
  const [localBranches, setLocalBranches] = useState([])
  const [currentLocal,  setCurrentLocal]  = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [err,           setErr]           = useState(null)
  const [selected,      setSelected]      = useState('')
  const [checkoutName,  setCheckoutName]  = useState('')
  const [checking,      setChecking]      = useState(false)
  const [checkoutErr,   setCheckoutErr]   = useState(null)
  const [checkoutOk,    setCheckoutOk]    = useState(null)
  const [deleting,      setDeleting]      = useState(false)
  const [deleteErr,     setDeleteErr]     = useState(null)
  const [copiedBranch,  setCopiedBranch]  = useState(false)

  function copyBranch() {
    if (!currentLocal) return
    navigator.clipboard.writeText(currentLocal).then(() => {
      setCopiedBranch(true)
      setTimeout(() => setCopiedBranch(false), 1500)
    })
  }

  useEffect(() => { if (currentLocal) onCurrentChange?.(currentLocal) }, [currentLocal])

  function load(force = false) {
    const cacheKey = `rcache_branchmgmt_${appName}_${vmIp}`
    const ttl = _cacheTtl()
    if (!force && ttl > 0) {
      const cached = _cacheGet(cacheKey)
      if (cached !== undefined) {
        setLocalBranches(cached.branches || [])
        setCurrentLocal(cached.current || null)
        setSelected(cached.current || cached.branches?.[0] || '')
        setLoading(false)
        return
      }
    }
    if (force) localStorage.removeItem(cacheKey)
    setLoading(true); setErr(null)
    fetch(`/api/remote-app/${appName}/git-local-branches?vm_ip=${encodeURIComponent(vmIp)}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setLocalBranches(d.branches || [])
          setCurrentLocal(d.current || null)
          setSelected(d.current || d.branches?.[0] || '')
          _cacheSet(cacheKey, d, ttl)
        } else {
          setErr(d.error || 'Failed to load branches')
        }
      })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [vmIp, appName])
  useEffect(() => { if (refreshTick) load(true) }, [refreshTick])

  function doCheckout(branch) {
    if (!branch) return
    setChecking(true); setCheckoutErr(null); setCheckoutOk(null)
    fetch(`/api/remote-app/${appName}/git-checkout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vm_ip: vmIp, branch }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setCheckoutOk(`Switched to branch '${branch}'`)
          setCheckoutName('')
          load(true)
          onCheckout?.()
          setTimeout(() => setCheckoutOk(null), 4000)
        } else {
          setCheckoutErr(d.error || 'Checkout failed')
        }
      })
      .catch(() => setCheckoutErr('Could not reach server'))
      .finally(() => setChecking(false))
  }

  const [confirmDel, setConfirmDel] = useState(null)
  function doDelete(branch) {
    setConfirmDel(null)
    setDeleting(true); setDeleteErr(null)
    fetch(`/api/remote-app/${appName}/git-branch`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vm_ip: vmIp, branch }),
    })
      .then(r => r.json())
      .then(d => { if (d.ok) { load(true) } else { setDeleteErr(d.error || 'Delete failed') } })
      .catch(() => setDeleteErr('Could not reach server'))
      .finally(() => setDeleting(false))
  }

  const isProtected = b => !b || /^(master|main)$/i.test(b) || /release/i.test(b)

  return (
    <div className="card" style={outerStyle}>
      {err && <div className="alert alert-error" style={{ marginBottom: 10, fontSize: 13 }}>{err}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 14, flexShrink: 0 }}>Branch Management</div>
        <span style={{ color: 'var(--border)', fontSize: 16 }}>|</span>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>Feature Branch:</div>
        {loading
          ? <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />
          : <span
              onClick={copyBranch}
              title={copiedBranch ? '✓ copied' : (currentLocal || undefined)}
              style={{
                fontWeight: 600, fontSize: 12, padding: '2px 10px', borderRadius: 12,
                background: copiedBranch ? 'rgba(76,175,80,0.2)' : 'rgba(76,175,80,0.1)',
                color: copiedBranch ? '#1b5e20' : '#2e7d32',
                border: '1px solid rgba(76,175,80,0.3)', fontFamily: 'monospace',
                cursor: currentLocal ? 'pointer' : 'default', userSelect: 'all',
                maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'middle',
              }}>{copiedBranch ? '✓ copied' : (currentLocal || '—')}</span>
        }
        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {localBranches.length} branch{localBranches.length !== 1 ? 'es' : ''} checked out
        </span>
        <button className="btn btn-sm" onClick={() => load(true)} disabled={loading} title="Refresh" style={{ marginLeft: 'auto' }}>↻</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>Switch/Delete:</div>
        <select
          value={selected}
          onChange={e => setSelected(e.target.value)}
          disabled={localBranches.length === 0 || checking}
          style={{
            padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 6, color: 'var(--text)', fontSize: 13, fontFamily: 'inherit',
          }}
        >
          {localBranches.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <button
          className="btn btn-sm btn-primary"
          disabled={checking || deleting || !selected || selected === currentLocal}
          onClick={() => doCheckout(selected)}
        >
          {checking ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Switching…</> : 'Switch'}
        </button>
        {selected && selected !== currentLocal && !isProtected(selected) && (
          <button
            className="btn btn-sm"
            disabled={checking || deleting}
            onClick={() => setConfirmDel(selected)}
            style={{ color: '#c62828', borderColor: '#e57373' }}
          >
            {deleting ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Deleting…</> : 'Delete'}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>Checkout branch:</div>
        <input
          type="text"
          placeholder="branch name or remote branch…"
          value={checkoutName}
          onChange={e => setCheckoutName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doCheckout(checkoutName.trim())}
          disabled={checking}
          style={{ flex: '1 1 200px', maxWidth: 320 }}
        />
        <button
          className="btn btn-sm btn-primary"
          disabled={checking || !checkoutName.trim()}
          onClick={() => doCheckout(checkoutName.trim())}
        >
          {checking ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Checking out…</> : 'Checkout'}
        </button>
      </div>

      {checkoutErr && <div className="alert alert-error" style={{ marginTop: 8, fontSize: 12 }}>{checkoutErr}</div>}
      {deleteErr && (
        <div className="alert alert-error" style={{ marginTop: 8, fontSize: 12, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{deleteErr}</span>
          <button onClick={() => setDeleteErr(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14, lineHeight: 1, flexShrink: 0, padding: '0 2px' }}>✕</button>
        </div>
      )}
      {checkoutOk && <div className="alert alert-info" style={{ marginTop: 8, fontSize: 12 }}>{checkoutOk}</div>}
      {confirmDel && (
        <ConfirmDialog
          title="Delete branch"
          message={<>Delete local branch <code style={{ color: 'var(--text)' }}>{confirmDel}</code> on the remote VM? This cannot be undone.</>}
          confirmLabel="Delete"
          onConfirm={() => doDelete(confirmDel)}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}
export function RemoteModulePanel({ vmIp, appName = 'payor', appLabel = 'Payor', refreshIntervalMs = 300000 }) {
  const [modules,    setModules]    = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [loadErr,    setLoadErr]    = useState(null)
  const [selected,   setSelected]   = useState(null)
  const [deps,       setDeps]       = useState([])
  const [depsLoading, setDepsLoading] = useState(false)
  const [depsErr,    setDepsErr]    = useState(null)
  const [skipTests,   setSkipTests]   = useState(true)
  const [withDeps,    setWithDeps]    = useState(false)
  const [deployMap,   setDeployMap]   = useState({})   // {module: {targets:[{deployment_artifact_name, deployment_dir}], target_artifact_name, ...}}
  const [domainTool,  setDomainTool]  = useState('')
  const [opStatus,   setOpStatus]   = useState(null)
  const [opKind,     setOpKind]     = useState(null)
  const [cmdId,      setCmdId]      = useState(null)
  const [output,     setOutput]     = useState('')
  const [opErr,      setOpErr]      = useState(null)
  const [cfgEdit,    setCfgEdit]    = useState({})   // {module: {targets:[{deployment_artifact_name, deployment_dir}], target_artifact_name, suppress_warning, disable_needs_build}}
  const [cfgSaving,  setCfgSaving]  = useState(null) // module name being saved
  const [cfgSaveOk,  setCfgSaveOk]  = useState(null) // module name last saved ok
  const [cfgErr,     setCfgErr]     = useState(null)
  const [modFilter,  setModFilter]  = useState('')
  const termRef        = useRef(null)
  const loadModulesRef = useRef(null)

  function loadModules(force = false) {
    const cacheKey = `rcache_modules_${appName}_${vmIp}`
    const ttl = _cacheTtl()
    if (!force && ttl > 0) {
      const cached = _cacheGet(cacheKey)
      if (cached !== undefined) { setModules(cached); setLoading(false); return }
    }
    setLoading(true); setLoadErr(null)
    fetch(`/api/remote-app/${appName}/modules?vm_ip=${encodeURIComponent(vmIp)}&force=1`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setModules(d); _cacheSet(cacheKey, d, ttl) }
        else setLoadErr(d.error || 'Failed')
      })
      .catch(() => setLoadErr('Could not reach server'))
      .finally(() => setLoading(false))
  }

  loadModulesRef.current = loadModules

  useEffect(() => { loadModules() }, [vmIp, appName])

  function loadDeployMap() {
    fetch(`/api/remote-app/${appName}/module-deploy-dirs`)
      .then(r => r.json())
      .then(d => { if (d.ok) setDeployMap(d.dirs || {}) })
      .catch(() => {})
  }

  function saveCfg(module) {
    const edit = cfgEdit[module] || {}
    setCfgSaving(module); setCfgSaveOk(null); setCfgErr(null)
    fetch(`/api/remote-app/${appName}/module-deploy-dirs/${encodeURIComponent(module)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edit),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setCfgSaveOk(module)
          setTimeout(() => setCfgSaveOk(null), 2000)
          setDeployMap(d.dirs || {})
        } else {
          setCfgErr(d.error || 'Save failed')
        }
      })
      .catch(() => setCfgErr('Could not reach server'))
      .finally(() => setCfgSaving(null))
  }

  useEffect(() => {
    loadDeployMap()
    fetch(`/api/remote-app/${appName}/vm-deps`)
      .then(r => r.json())
      .then(d => { if (d.ok && d.domain_tool) setDomainTool(d.domain_tool) })
      .catch(() => {})
  }, [appName])

  // Auto-refresh while main full build is running
  useEffect(() => {
    const prev = { status: null }
    const id = setInterval(() => {
      const storedCmdId = localStorage.getItem(`remote_build_cmd_${appName}`)
      if (!storedCmdId) return
      fetch(`/api/remote-app/${appName}/command-status?cmd_id=${storedCmdId}`)
        .then(r => r.json())
        .then(d => {
          const wasRunning = prev.status === 'running'
          prev.status = d.ok ? d.status : null
          if (d.ok && (d.status === 'running' || wasRunning)) loadModulesRef.current(true)
        })
        .catch(() => {})
    }, refreshIntervalMs)
    return () => clearInterval(id)
  }, [appName, refreshIntervalMs])

  // Fetch dependents when a module is selected
  useEffect(() => {
    if (!selected) { setDeps([]); setDepsErr(null); return }
    setDepsLoading(true); setDepsErr(null)
    fetch(`/api/remote-app/${appName}/modules/${encodeURIComponent(selected)}/dependents?vm_ip=${encodeURIComponent(vmIp)}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) setDeps(d.dependents || [])
        else { setDeps([]); setDepsErr(d.error || 'Failed to load dependents') }
      })
      .catch(() => { setDeps([]); setDepsErr('Could not reach server') })
      .finally(() => setDepsLoading(false))
  }, [selected, vmIp, appName])

  // Poll op status
  useEffect(() => {
    if (opStatus !== 'running' || !cmdId) return
    const id = setInterval(() => {
      fetch(`/api/remote-app/${appName}/command-status?cmd_id=${cmdId}`)
        .then(r => r.json())
        .then(d => {
          if (d.ok) {
            setOutput(d.output || '')
            if (d.status !== 'running') {
              setOpStatus(d.status)
              if (d.status === 'success') loadModules(true)
            }
          }
        })
        .catch(() => {})
    }, 800)
    return () => clearInterval(id)
  }, [opStatus, cmdId])

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [output])

  function startOp(op) {
    if (!selected || opStatus === 'running') return
    const cfg = deployMap[selected]
    if (op === 'deploy') {
      if (!cfg?.targets?.some(t => t.deployment_artifact_name && t.deployment_dir)) {
        setOpErr(`No deploy targets configured for ${selected} in vm_dependencies.xlsx → module_deploy`); return
      }
    }
    setOpKind(op); setOpStatus('running'); setOutput(''); setOpErr(null); setCmdId(null)
    const dtool    = domainTool || 'todomain'
    const mvnFlags = skipTests ? ' -DskipTests' : ''
    const allMods  = (withDeps && deps.length > 0) ? [selected, ...deps] : [selected]
    let command
    if (op === 'build') {
      command = allMods.map(m => `(cd ${m} && mvn package${mvnFlags})`).join(' && ')
    } else {
      const toDeploy = allMods.filter(m => deployMap[m]?.targets?.some(t => t.deployment_artifact_name && t.deployment_dir))
      const opParts  = []
      for (const m of toDeploy) {
        const mcfg = deployMap[m]
        // Determine source glob extension from target_artifact_name (if set) or first target's artifact name
        const srcArtifact = mcfg.target_artifact_name || (mcfg.targets?.[0]?.deployment_artifact_name || '')
        const srcExt = srcArtifact.endsWith('.war') ? '*.war' : '*.jar'
        for (const t of (mcfg.targets || [])) {
          if (!t.deployment_artifact_name || !t.deployment_dir) continue
          const isWar  = t.deployment_artifact_name.endsWith('.war')
          const stem   = t.deployment_artifact_name.replace(/\.(war|jar)$/, '')
          // Cleanup existing artifact and (for WAR) its unpacked folder, then copy.
          // Use semicolons (not &&) for cleanup so a locked/missing file never blocks the copy.
          // Group with { } so the block's exit code = cp's exit code.
          let ops = `{ rm -f "$DOMAINROOT/${t.deployment_dir}/${t.deployment_artifact_name}" 2>/dev/null`
          if (isWar) ops += `; rm -rf "$DOMAINROOT/${t.deployment_dir}/${stem}" 2>/dev/null`
          if (isWar && mcfg.catalina_dir) ops += `; rm -rf "$DOMAINROOT/${mcfg.catalina_dir}/${stem}" 2>/dev/null`
          ops += `; cp $SRCDIR/${m}/target/${srcExt} "$DOMAINROOT/${t.deployment_dir}/${t.deployment_artifact_name}"; }`
          opParts.push(ops)
        }
      }
      // domain_tool (e.g. todomain) is a shell alias that cd's to domain root.
      // Aliases need bash -i; run it in a bash -i subshell and capture the resulting pwd.
      command = `SRCDIR=$(pwd) && DOMAINROOT=$(bash -i -c "${dtool} 2>/dev/null; pwd" 2>/dev/null) && [ -n "$DOMAINROOT" ] && ` + opParts.join(' && ')
    }
    fetch(`/api/remote-app/${appName}/run-command`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vm_ip: vmIp, command }),
    })
      .then(r => r.json())
      .then(d => { if (d.ok) setCmdId(d.cmd_id); else { setOpErr(d.error); setOpStatus(null) } })
      .catch(() => { setOpErr('Could not reach server'); setOpStatus(null) })
  }

  const allMods = modules
    ? [
        ...(modules.ready       || []).map(m => ({ ...m, status: 'ready' })),
        ...(modules.needs_build || []).map(m => ({
          ...m,
          status: deployMap[m.name]?.disable_needs_build ? 'ready' : 'needs_build',
        })),
      ].sort((a, b) => a.name.localeCompare(b.name))
    : []

  const busy = opStatus === 'running'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      <div className="card" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            {appLabel} Modules{allMods.length > 0 ? ` (${allMods.length})` : ''}
          </div>
          <button className="btn btn-sm" onClick={() => loadModules(true)} disabled={loading} title="Refresh">↻</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: '#4caf50', display: 'inline-block' }} />
              Ready ({allMods.filter(m => m.status === 'ready').length})
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: '#ff9800', display: 'inline-block' }} />
              Needs Build ({allMods.filter(m => m.status === 'needs_build').length})
            </span>
          </div>
          <input
            value={modFilter} onChange={e => setModFilter(e.target.value)}
            placeholder="Filter modules…"
            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', width: 160 }}
          />
        </div>
        {loadErr && <div className="alert alert-error" style={{ marginTop: 8, fontSize: 12 }}>{loadErr}</div>}
      </div>

      <div style={{ overflowY: 'auto', maxHeight: 320, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)' }}>
        {loading && <div style={{ padding: 16, textAlign: 'center' }}><span className="spinner" /></div>}
        {!loading && allMods.length === 0 && !loadErr && (
          <div style={{ padding: 12, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>No modules found</div>
        )}
        {!loading && allMods.filter(m => !modFilter || m.name.toLowerCase().includes(modFilter.toLowerCase())).map(m => {
          const cfg    = deployMap[m.name]
          const hasCfg = !!(cfg?.targets?.some(t => t.deployment_artifact_name && t.deployment_dir))
          const warn   = !hasCfg && !cfg?.suppress_warning
          return (
          <div key={m.name} onClick={() => {
            const next = selected === m.name ? null : m.name
            setSelected(next)
            if (next) {
              const existing = deployMap[next] || {}
              setCfgEdit(e => ({ ...e, [next]: {
                targets: existing.targets?.length > 0
                  ? existing.targets.map(t => ({ ...t }))
                  : [{ deployment_artifact_name: '', deployment_dir: '' }],
                target_artifact_name: existing.target_artifact_name || '',
                catalina_dir: existing.catalina_dir || '',
                suppress_warning: !!existing.suppress_warning,
                disable_needs_build: !!existing.disable_needs_build,
              }}))
            }
          }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', cursor: 'pointer', fontSize: 12,
              background: selected === m.name ? 'var(--primary-faint, rgba(59,130,246,0.1))' : 'transparent',
              borderBottom: '1px solid var(--border)', userSelect: 'none',
            }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: m.status === 'ready' ? '#4caf50' : '#ff9800' }} />
            <span style={{ fontFamily: 'monospace', flex: 1 }}>{m.name}</span>
            {warn && (
              <span title="No deploy configuration" style={{ fontSize: 10, color: '#ff9800', lineHeight: 1 }}>⚠</span>
            )}
            {m.status === 'ready' && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                {m.jar?.replace(m.name + '-', '').replace(/\.(jar|war)$/, '')}
              </span>
            )}
          </div>
          )
        })}
      </div>

      {selected && (
        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, fontFamily: 'monospace' }}>{selected}</div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
              Dependents{!depsLoading && ` (${deps.length})`}
              {depsLoading && <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} />}
            </div>
            {depsErr && <div style={{ fontSize: 11, color: '#f44336' }}>{depsErr}</div>}
            {!depsLoading && !depsErr && deps.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>None</div>
            )}
            {deps.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {deps.map(d => (
                  <code key={d} style={{ fontSize: 10, background: 'var(--surface-2, var(--bg))', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)' }}>{d}</code>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={skipTests} onChange={e => setSkipTests(e.target.checked)} disabled={busy} />
              Skip Tests
            </label>
            {deps.length > 0 && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={withDeps} onChange={e => setWithDeps(e.target.checked)} disabled={busy} />
                With Dependents ({deps.length})
              </label>
            )}
          </div>
          {(() => {
            const cfg         = deployMap[selected]
            const dt          = domainTool || 'todomain'
            const cfgTargets  = (cfg?.targets || []).filter(t => t.deployment_artifact_name && t.deployment_dir)
            const depsToDeploy = withDeps ? deps.filter(m => deployMap[m]?.targets?.some(t => t.deployment_artifact_name && t.deployment_dir)) : []
            const depsUncfg    = withDeps ? deps.filter(m => !deployMap[m]?.targets?.some(t => t.deployment_artifact_name && t.deployment_dir)) : []
            if (cfgTargets.length > 0) return (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.6 }}>
                {cfgTargets.map((t, i) => (
                  <div key={i}>
                    {i === 0 && <span>Artifact: <code style={{ fontSize: 10 }}>{t.deployment_artifact_name}</code><br/></span>}
                    Deploy{cfgTargets.length > 1 ? ` #${i + 1}` : ''} → <code style={{ fontSize: 10 }}>{`\`${dt}\`/${t.deployment_dir}/${t.deployment_artifact_name}`}</code>
                  </div>
                ))}
                {cfg?.catalina_dir && (
                  <div style={{ color: '#80cbc4' }}>Catalina cleanup → <code style={{ fontSize: 10 }}>{`\`${dt}\`/${cfg.catalina_dir}/<stem>`}</code></div>
                )}
                {withDeps && depsToDeploy.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    Also deploying: {depsToDeploy.map(m => <code key={m} style={{ fontSize: 10, marginRight: 4 }}>{m}</code>)}
                  </div>
                )}
                {withDeps && depsUncfg.length > 0 && (
                  <div style={{ color: '#ff9800', marginTop: 2 }}>
                    Skipped (no deploy config): {depsUncfg.map(m => <code key={m} style={{ fontSize: 10, marginRight: 4 }}>{m}</code>)}
                  </div>
                )}
              </div>
            )
            if (!cfg?.suppress_warning) return (
              <div style={{ fontSize: 11, color: '#ff9800', marginBottom: 8 }}>
                ⚠ Not configured — configure below
              </div>
            )
            return null
          })()}

          {/* Per-module configuration */}
          {(() => {
            const edit    = cfgEdit[selected] || {}
            const targets = edit.targets || [{ deployment_artifact_name: '', deployment_dir: '' }]
            const inp = { width: '100%', padding: '3px 6px', fontSize: 11, fontFamily: 'monospace',
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text)' }
            const dt = domainTool || 'todomain'
            const updateTarget = (i, key, val) => setCfgEdit(p => ({
              ...p, [selected]: { ...p[selected], targets: (p[selected]?.targets || []).map((t, idx) => idx === i ? { ...t, [key]: val } : t) }
            }))
            const addTarget = () => setCfgEdit(p => ({
              ...p, [selected]: { ...p[selected], targets: [...(p[selected]?.targets || []), { deployment_artifact_name: '', deployment_dir: '' }] }
            }))
            const removeTarget = (i) => setCfgEdit(p => ({
              ...p, [selected]: { ...p[selected], targets: (p[selected]?.targets || []).filter((_, idx) => idx !== i) }
            }))
            return (
              <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 5, background: 'var(--bg, rgba(0,0,0,0.03))', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 7 }}>Configure Module</div>
                <div style={{ marginBottom: 5 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Target Artifact Name</div>
                  <input style={{ ...inp, maxWidth: 260 }} value={edit.target_artifact_name || ''} placeholder="module-1.0-SNAPSHOT.jar"
                    onChange={e => setCfgEdit(p => ({ ...p, [selected]: { ...p[selected], target_artifact_name: e.target.value } }))} />
                </div>
                <div style={{ marginBottom: 5 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>
                    Catalina Dir <span style={{ fontWeight: 400 }}>(Tomcat work dir, relative to <code style={{ fontSize: 9 }}>{`$(${dt})/`}</code> — WAR unpacked folder deleted on deploy)</span>
                  </div>
                  <input style={{ ...inp, maxWidth: 380 }} value={edit.catalina_dir || ''}
                    placeholder="tomcat/tomcat-current/work/Catalina/localhost"
                    onChange={e => setCfgEdit(p => ({ ...p, [selected]: { ...p[selected], catalina_dir: e.target.value } }))} />
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>Deploy Targets</div>
                {targets.map((t, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 5, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 130px' }}>
                      {i === 0 && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Deployment Artifact Name</div>}
                      <input style={inp} value={t.deployment_artifact_name || ''} placeholder="module.war"
                        onChange={e => updateTarget(i, 'deployment_artifact_name', e.target.value)} />
                    </div>
                    <div style={{ flex: '1 1 160px' }}>
                      {i === 0 && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Deploy Dir (after <code style={{ fontSize: 9 }}>{`$(${dt})/`}</code>)</div>}
                      <input style={inp} value={t.deployment_dir || ''} placeholder="applications/domain/lib"
                        onChange={e => updateTarget(i, 'deployment_dir', e.target.value)} />
                    </div>
                    {targets.length > 1 && (
                      <button onClick={() => removeTarget(i)} title="Remove target"
                        style={{ fontSize: 12, padding: '2px 7px', background: 'none', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', color: '#f44336', lineHeight: 1.5 }}>✕</button>
                    )}
                  </div>
                ))}
                <button onClick={addTarget}
                  style={{ fontSize: 10, padding: '2px 10px', marginBottom: 7, background: 'none', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', color: 'var(--text-muted)' }}>
                  + Add Target
                </button>
                {targets.some(t => t.deployment_dir && t.deployment_artifact_name) && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 7 }}>
                    {targets.filter(t => t.deployment_dir && t.deployment_artifact_name).map((t, i) => {
                      const stem = t.deployment_artifact_name.replace(/\.(war|jar)$/, '')
                      const isWar = t.deployment_artifact_name.endsWith('.war')
                      return (
                        <div key={i}>
                          → <code style={{ fontSize: 9 }}>{`\`${dt}\`/${t.deployment_dir}/${t.deployment_artifact_name}`}</code>
                          {isWar && edit.catalina_dir && (
                            <div style={{ color: '#80cbc4', marginLeft: 8 }}>
                              ✕ catalina: <code style={{ fontSize: 9 }}>{`\`${dt}\`/${edit.catalina_dir}/${stem}`}</code>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!edit.suppress_warning}
                      onChange={e => setCfgEdit(p => ({ ...p, [selected]: { ...p[selected], suppress_warning: e.target.checked } }))} />
                    Suppress ⚠ Warning
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!edit.disable_needs_build}
                      onChange={e => setCfgEdit(p => ({ ...p, [selected]: { ...p[selected], disable_needs_build: e.target.checked } }))} />
                    Disable "Needs Build"
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => saveCfg(selected)}
                    disabled={cfgSaving === selected}
                    style={{ fontSize: 11, padding: '3px 14px' }}>
                    {cfgSaving === selected
                      ? <><span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} /> Saving…</>
                      : 'Save Config'}
                  </button>
                  {cfgSaveOk === selected && <span style={{ fontSize: 11, color: '#4caf50' }}>Saved ✓</span>}
                  {cfgErr && <span style={{ fontSize: 11, color: '#f44336' }}>{cfgErr}</span>}
                </div>
              </div>
            )
          })()}

          {opErr && <div className="alert alert-error" style={{ marginBottom: 8, fontSize: 12 }}>{opErr}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={() => startOp('build')} disabled={busy} style={{ flex: 1 }}>
              {busy && opKind === 'build' ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Building…</> : 'Build'}
            </button>
            <button className="btn btn-sm" onClick={() => startOp('deploy')} disabled={busy} style={{ flex: 1 }}>
              {busy && opKind === 'deploy' ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Deploying…</> : 'Clean Deploy'}
            </button>
          </div>
        </div>
      )}

      {(opStatus || output) && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 5, display: 'flex', gap: 8, alignItems: 'center' }}>
            {opKind === 'build' ? 'Build' : 'Deploy'} output
            {opStatus === 'running' && <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />}
            {opStatus === 'success' && <span style={{ color: '#4caf50' }}>✓ Done</span>}
            {opStatus === 'failed'  && <span style={{ color: '#f44336' }}>✗ Failed</span>}
            {opStatus !== 'running' && (
              <button
                onClick={() => { setOpStatus(null); setOutput(''); setCmdId(null); setOpKind(null) }}
                title="Close"
                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--text-muted)', padding: '0 2px', lineHeight: 1 }}
              >✕</button>
            )}
          </div>
          <ColoredTerminal output={output} termRef={termRef} maxHeight={200} />
        </div>
      )}
    </div>
  )
}
export function RemoteTerminalCard({ vmIp, appName = 'payor', appLabel = 'Payor' }) {
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState(null)
  const [ok,   setOk]   = useState(false)

  function openTerminal() {
    setBusy(true); setErr(null); setOk(false)
    fetch(`/api/remote-app/${appName}/open-terminal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vm_ip: vmIp }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setOk(true); setTimeout(() => setOk(false), 3000) }
        else setErr(d.error || 'Failed to open terminal')
      })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setBusy(false))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
      <div style={{ fontSize: 22, lineHeight: 1 }}>💻</div>
      <div style={{ fontWeight: 600, fontSize: 12, lineHeight: 1.3 }}>Open {appLabel} in Terminal</div>
      {err && <div className="alert alert-error" style={{ fontSize: 11, padding: '3px 6px', marginTop: 2 }}>{err}</div>}
      {ok  && <div className="alert alert-info"  style={{ fontSize: 11, padding: '3px 6px', marginTop: 2 }}>Launched!</div>}
      <button className="btn btn-sm" onClick={openTerminal} disabled={busy} style={{ width: '100%', fontSize: 12 }}>
        {busy ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> : 'Open Terminal'}
      </button>
    </div>
  )
}

// ── Remote Build And Deploy panel ─────────────────────────────────────────────
export function RemoteBuildPanel({ vmIp, appName = 'payor', appLabel = 'Payor', buildFlagsCfg }) {
  const STORE_KEY   = `remote_build_cmd_${appName}`
  const DISMISS_KEY = `remote_build_dismissed_${appName}`

  const effectiveFlags = useMemo(() => {
    if (buildFlagsCfg && buildFlagsCfg.length > 0)
      return buildFlagsCfg
        .filter(f => f.enabled !== false)
        .map(f => ({ flag: f.key, label: f.label, def: !!f.default }))
    return BUILD_FLAGS
  }, [buildFlagsCfg])

  const [checked,       setChecked]       = useState(() => Object.fromEntries(BUILD_FLAGS.map(f => [f.flag, f.def])))
  const [building,      setBuilding]      = useState(false)
  const [buildStatus,   setBuildStatus]   = useState(null)
  const [cmdId,         setCmdId]         = useState(null)
  const [output,        setOutput]        = useState('')
  const [err,           setErr]           = useState(null)
  const [progress,      setProgress]      = useState(null)
  const [elapsedMs,     setElapsedMs]     = useState(0)
  const [estimatedMs,   setEstimatedMs]   = useState(null)
  const [currentModule, setCurrentModule] = useState(null)
  const [moduleNum,     setModuleNum]     = useState(null)
  const [totalModules,  setTotalModules]  = useState(null)
  const [phase,         setPhase]         = useState(null)
  const [showCfg,       setShowCfg]       = useState(false)
  const [aborting,      setAborting]      = useState(false)
  const termRef = useRef(null)

  const activeFlags = effectiveFlags.filter(f => checked[f.flag]).map(f => f.flag)
  const cmd = [`refresh-${appName}`, ...activeFlags].join(' ')

  function fmtMs(ms) {
    if (ms == null || ms < 0) return '—'
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60)
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
  }

  // Reset checked state when configured flags change (e.g. after screenCfg loads)
  useEffect(() => {
    setChecked(Object.fromEntries(effectiveFlags.map(f => [f.flag, f.def])))
  }, [effectiveFlags])

  // Reconnect to a running/recent build on mount
  useEffect(() => {
    const storedId = localStorage.getItem(STORE_KEY)
    if (!storedId) return
    fetch(`/api/remote-app/${appName}/command-status?cmd_id=${storedId}`)
      .then(r => r.json())
      .then(d => {
        if (!d.ok) { localStorage.removeItem(STORE_KEY); return }
        if (d.status === 'running') {
          setCmdId(storedId); setBuilding(true); setBuildStatus('running')
          setOutput(d.output || ''); setProgress(d.progress ?? null)
          setElapsedMs(d.elapsed_ms || 0); setEstimatedMs(d.estimated_ms || null)
          setCurrentModule(d.current_module || null); setModuleNum(d.module_num || null)
          setTotalModules(d.total_modules || null); setPhase(d.phase || null)
        } else if (d.status && !localStorage.getItem(DISMISS_KEY)) {
          setCmdId(storedId); setBuildStatus(d.status)
          setOutput(d.output || '')
          setProgress(d.status === 'success' ? 100 : null)
          setPhase(d.phase || null)
        }
      })
      .catch(() => {})
  }, [])

  // Poll command status
  useEffect(() => {
    if (!cmdId || buildStatus !== 'running') return
    const id = setInterval(() => {
      fetch(`/api/remote-app/${appName}/command-status?cmd_id=${cmdId}`)
        .then(r => r.json())
        .then(d => {
          if (d.ok) {
            setOutput(d.output || '')
            setProgress(d.progress ?? null)
            setElapsedMs(d.elapsed_ms || 0)
            setEstimatedMs(d.estimated_ms || null)
            setCurrentModule(d.current_module || null)
            setModuleNum(d.module_num || null)
            setTotalModules(d.total_modules || null)
            setPhase(d.phase || null)
            if (d.status !== 'running') {
              setBuildStatus(d.status)
              setBuilding(false); setAborting(false)
              if (d.status === 'success') {
                fetch(`/api/remote-app/${appName}/deployed-info`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ vm_ip: vmIp }),
                }).then(r => r.json()).then(rd => {
                  if (rd.ok) window.dispatchEvent(new CustomEvent('remote-deployed-updated', { detail: { vmIp } }))
                }).catch(() => {})
              }
            }
          }
        })
        .catch(() => {})
    }, 1200)
    return () => clearInterval(id)
  }, [cmdId, buildStatus])

  // Local elapsed ticker between polls
  useEffect(() => {
    if (buildStatus !== 'running') return
    const id = setInterval(() => setElapsedMs(ms => ms + 1000), 1000)
    return () => clearInterval(id)
  }, [buildStatus])

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [output])

  function run() {
    localStorage.removeItem(DISMISS_KEY)
    setBuilding(true); setErr(null); setOutput(''); setBuildStatus('running'); setCmdId(null)
    setProgress(null); setElapsedMs(0); setEstimatedMs(null)
    setCurrentModule(null); setModuleNum(null); setTotalModules(null); setPhase(null)
    fetch(`/api/remote-app/${appName}/run-command`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vm_ip: vmIp, command: cmd }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          localStorage.setItem(STORE_KEY, d.cmd_id)
          setCmdId(d.cmd_id)
        } else {
          setErr(d.error || 'Failed'); setBuilding(false); setBuildStatus(null)
        }
      })
      .catch(() => { setErr('Could not reach server'); setBuilding(false); setBuildStatus(null) })
  }

  function abort() {
    if (!cmdId) return
    setAborting(true)
    fetch(`/api/remote-app/${appName}/run-command/abort`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vm_ip: vmIp, cmd_id: cmdId }),
    })
      .then(r => r.json())
      .then(d => { if (!d.ok) setAborting(false) })
      .catch(() => setAborting(false))
  }

  function reset() {
    localStorage.setItem(DISMISS_KEY, '1')
    setOutput(''); setBuildStatus(null); setCmdId(null); setErr(null)
    setChecked(Object.fromEntries(effectiveFlags.map(f => [f.flag, f.def])))
    setProgress(null); setElapsedMs(0); setEstimatedMs(null)
    setCurrentModule(null); setModuleNum(null); setTotalModules(null); setPhase(null)
    setAborting(false)
  }

  const barPct        = progress !== null ? progress
    : buildStatus === 'running' ? Math.min(Math.floor((elapsedMs / 120000) * 90), 90) : 0
  const barPctDisplay = buildStatus === 'success' ? 100 : barPct
  const barVisible    = buildStatus === 'running' || buildStatus === 'success'
  const eta           = estimatedMs
    ? (estimatedMs > elapsedMs ? `~${fmtMs(estimatedMs - elapsedMs)} left` : `+${fmtMs(elapsedMs - estimatedMs)} over`)
    : null
  const timeLabel     = barVisible
    ? (buildStatus === 'success' ? fmtMs(elapsedMs) : eta ? `${fmtMs(elapsedMs)} / ${eta}` : fmtMs(elapsedMs))
    : null
  const phaseLabel    = { building: 'Building…', deploying: 'Deploying…', creating_schema: 'Schema…', bootstrapping: 'Starting server…' }

  return (
    <>
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ fontSize: 28, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>🔨</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Build {appLabel} And Deploy</div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
            {effectiveFlags.map(f => (
              <label key={f.flag} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={checked[f.flag]} disabled={building}
                  onChange={() => setChecked(p => ({ ...p, [f.flag]: !p[f.flag] }))} />
                <span>{f.label}</span>
                <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.flag}</code>
              </label>
            ))}
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Command</div>
          <code style={{ fontSize: 13, background: 'var(--surface-2, var(--surface))', padding: '4px 10px', borderRadius: 4, display: 'inline-block' }}>
            {cmd}
          </code>

          {err && <div className="alert alert-error" style={{ marginTop: 10 }}>{err}</div>}

          {/* ── Progress bar ── */}
          {barVisible && (
            <div style={{ marginTop: 14 }}>
              {/* Module info row */}
              {(currentModule || moduleNum) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, fontSize: 12 }}>
                  {moduleNum && totalModules && (
                    <span style={{ background: 'rgba(76,175,80,0.15)', color: '#2e7d32', border: '1px solid rgba(76,175,80,0.4)', borderRadius: 10, padding: '1px 8px', fontWeight: 600, fontSize: 11 }}>
                      {moduleNum}/{totalModules}
                    </span>
                  )}
                  {currentModule && (
                    <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 340 }}>
                      {currentModule}
                    </span>
                  )}
                </div>
              )}
              {/* Phase + time label */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                <span>{phase ? (phaseLabel[phase] || phase) : (buildStatus === 'success' ? '✓ Complete' : '')}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{timeLabel}</span>
              </div>
              {/* Bar */}
              <div style={{ height: 16, borderRadius: 8, background: 'var(--surface-2, #e8e8e8)', overflow: 'hidden', position: 'relative', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.15)' }}>
                <div style={{
                  height: '100%', width: `${barPctDisplay}%`,
                  background: 'linear-gradient(180deg, #81c784 0%, #4caf50 45%, #388e3c 46%, #43a047 100%)',
                  borderRadius: 8, transition: 'width 0.6s ease',
                  boxShadow: '0 1px 4px rgba(56,142,60,0.45)',
                }} />
                {barPctDisplay > 8 && (
                  <span style={{
                    position: 'absolute', left: '50%', top: '50%',
                    transform: 'translate(-50%, -50%)',
                    fontSize: 10, fontWeight: 700, color: '#fff',
                    textShadow: '0 1px 2px rgba(0,0,0,0.5)', pointerEvents: 'none',
                  }}>
                    {barPctDisplay}%
                  </span>
                )}
              </div>
            </div>
          )}

          {(buildStatus || output) && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 8 }}>
                Output
                {buildStatus === 'running' && <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />}
                {buildStatus === 'success' && <span style={{ color: '#4caf50' }}>✓ Done</span>}
                {buildStatus === 'failed'  && <span style={{ color: '#f44336' }}>✗ Failed</span>}
                <CopyButton text={output} />
              </div>
              <ColoredTerminal output={output} termRef={termRef} height={280} fontSize={12} />
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, alignItems: 'flex-end' }}>
          <button className="btn btn-primary btn-sm" onClick={run} disabled={building}>
            {building
              ? <><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> Building…</>
              : 'Build & Deploy'}
          </button>
          {building && (
            <button className="btn btn-sm" onClick={abort} disabled={aborting}
              style={{ color: '#f44336', borderColor: '#f44336' }}>
              {aborting ? 'Aborting…' : 'Abort'}
            </button>
          )}
          {!building && (
            <button className="btn btn-sm" onClick={() => setShowCfg(true)} title="Configure build_deploy_config.xlsx"
              style={{ fontSize: 13 }}>⚙</button>
          )}
          {!building && buildStatus && (
            <button className="btn btn-sm" onClick={reset}
              style={{ color: '#1976d2', borderColor: '#1976d2', fontWeight: 600 }}>
              OK
            </button>
          )}
        </div>
      </div>
    </div>
    {showCfg && (
      <ConfigureModal
        appName={appName}
        onClose={() => setShowCfg(false)}
        apiBase="/api/remote-app"
        showBuildTab={false}
      />
    )}
    </>
  )
}
// ── Deployed banner (shared by all remote app tabs + header) ─────────────────
export function RemoteDeployedBanner({ vmIp, appName = 'payor', noMargin, serverUp }) {
  const [info,   setInfo]   = useState(null)
  const [loaded, setLoaded] = useState(false)

  function load() {
    if (!vmIp) return
    fetch(`/api/remote-app/${appName}/deployed-info?vm_ip=${encodeURIComponent(vmIp)}`)
      .then(r => r.json())
      .then(d => { setInfo(d.ok ? d : null); setLoaded(true) })
      .catch(() => setLoaded(true))
  }

  useEffect(() => {
    setLoaded(false); setInfo(null)
    load()
    const handler = e => { if (e.detail?.vmIp === vmIp) load() }
    window.addEventListener('remote-deployed-updated', handler)
    return () => window.removeEventListener('remote-deployed-updated', handler)
  }, [vmIp, appName])

  // Render when loaded OR server status is explicitly known
  if (!loaded && serverUp == null) return null

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 8, marginBottom: noMargin ? 0 : 16,
      background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)',
      fontSize: 12, color: 'var(--text-muted)',
    }}>
      {loaded && !info?.release_ver && (
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', opacity: 0.7 }}>Not Deployed</span>
      )}
      {info?.release_ver && (
        <>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--primary,#3b82f6)', opacity: 0.8 }}>DEPLOYED</span>
          <span style={{
            fontWeight: 700, padding: '1px 8px', borderRadius: 10, fontSize: 12,
            background: 'rgba(59,130,246,0.1)', color: 'var(--primary,#3b82f6)',
            border: '1px solid rgba(59,130,246,0.25)',
          }}>v{info.release_ver}</span>
        </>
      )}
      {serverUp != null && (
        <>
          {info?.release_ver && <span style={{ color: 'var(--border)', opacity: 0.5 }}>·</span>}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontWeight: 600, padding: '1px 8px', borderRadius: 10, fontSize: 12,
            background: serverUp ? 'rgba(76,175,80,0.1)' : 'rgba(244,67,54,0.08)',
            color: serverUp ? '#2e7d32' : '#c62828',
            border: `1px solid ${serverUp ? 'rgba(76,175,80,0.3)' : 'rgba(244,67,54,0.25)'}`,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: serverUp ? '#4caf50' : '#f44336', display: 'inline-block' }} />
            {serverUp ? 'Running' : 'Stopped'}
          </span>
        </>
      )}
    </div>
  )
}

function RemoteTableStructureModal({ vmIp, schema, table, onClose, onInsert, appName = 'payor' }) {
  const [navStack, setNavStack] = useState([{ schema, table }])
  const current = navStack[navStack.length - 1]
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState(null)

  useEffect(() => {
    setData(null); setErr(null); setLoading(true)
    fetch(`/api/remote-app/${appName}/db/table-structure?vm_ip=${encodeURIComponent(vmIp)}&schema=${encodeURIComponent(current.schema)}&table=${encodeURIComponent(current.table)}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setData(d); else setErr(d.error) })
      .catch(() => setErr('Request failed'))
      .finally(() => setLoading(false))
  }, [current.schema, current.table])

  const thStyle = { padding: '5px 10px', textAlign: 'left', borderBottom: '2px solid var(--border)',
    fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap', color: 'var(--text)', background: 'var(--surface)' }
  const tdStyle = { padding: '4px 10px', borderBottom: '1px solid var(--border)', fontSize: 11,
    fontFamily: 'monospace', whiteSpace: 'nowrap', color: 'var(--text)' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)',
        minWidth: 680, maxWidth: '90vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
          {navStack.length > 1 && (
            <button onClick={() => setNavStack(p => p.slice(0, -1))} className="btn btn-sm"
              style={{ padding: '2px 8px', fontSize: 11, flexShrink: 0 }}>← Back</button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, flexWrap: 'wrap', minWidth: 0 }}>
            {navStack.map((entry, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {i > 0 && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>›</span>}
                <span style={{ fontWeight: i === navStack.length - 1 ? 700 : 400, fontSize: 12,
                  fontFamily: 'monospace', color: i === navStack.length - 1 ? 'var(--text)' : 'var(--primary)',
                  cursor: i < navStack.length - 1 ? 'pointer' : 'default',
                  textDecoration: i < navStack.length - 1 ? 'underline' : 'none' }}
                  onClick={() => i < navStack.length - 1 && setNavStack(navStack.slice(0, i + 1))}>
                  {entry.schema}.{entry.table}
                </span>
              </span>
            ))}
          </div>
          <button onClick={() => onInsert(`SELECT * FROM ${current.schema}.${current.table} WHERE ROWNUM <= 100`)}
            style={{ fontSize: 11, padding: '2px 10px', flexShrink: 0 }} className="btn btn-sm">SELECT 100</button>
          <button onClick={() => onInsert(`SELECT COUNT(*) FROM ${current.schema}.${current.table}`)}
            style={{ fontSize: 11, padding: '2px 10px', flexShrink: 0 }} className="btn btn-sm">COUNT(*)</button>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16,
              color: 'var(--text-muted)', padding: '0 4px', lineHeight: 1, flexShrink: 0 }}>✕</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading && <div style={{ padding: 24, textAlign: 'center' }}><span className="spinner" /></div>}
          {err     && <div style={{ padding: 16, color: '#c62828', fontSize: 12 }}>{err}</div>}
          {data    && (
            <>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 'max-content' }}>
                <thead><tr>{['Column','Type','Nullable','Default','PK','FK → References'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.columns.map((col, i) => {
                    const pk = data.pk_cols.includes(col.name)
                    const fk = data.fk_map[col.name]
                    return (
                      <tr key={i} style={{ background: pk ? 'rgba(255,193,7,0.07)' : i % 2 === 0 ? 'transparent' : 'rgba(128,128,128,0.03)' }}>
                        <td style={{ ...tdStyle, fontWeight: pk ? 700 : 400 }}>{col.name}</td>
                        <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>
                          {col.type}{col.precision ? `(${col.precision}${col.scale ? ','+col.scale : ''})` : col.length ? `(${col.length})` : ''}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          {col.nullable === 'Y' ? <span style={{ color: 'var(--text-muted)' }}>✓</span> : <span style={{ color: '#c62828', fontWeight: 700 }}>✕</span>}
                        </td>
                        <td style={{ ...tdStyle, color: 'var(--text-muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.default_val || ''}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>{pk && <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 13 }}>🔑</span>}</td>
                        <td style={{ ...tdStyle, fontSize: 10 }}>
                          {fk ? (
                            <span onClick={() => setNavStack(p => [...p, { schema: fk.ref_schema, table: fk.ref_table }])}
                              style={{ color: '#1d4ed8', cursor: 'pointer', textDecoration: 'underline' }}>
                              {fk.ref_schema}.{fk.ref_table}.{fk.ref_col}
                            </span>
                          ) : ''}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {data.indexes?.length > 0 && (
                <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>INDEXES</div>
                  {data.indexes.map((idx, i) => (
                    <div key={i} style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', marginBottom: 2 }}>
                      <span style={{ color: 'var(--text)', fontWeight: 600 }}>{idx.name}</span>
                      {idx.uniqueness === 'UNIQUE' && <span style={{ color: '#2e7d32', marginLeft: 6 }}>UNIQUE</span>}
                      <span style={{ marginLeft: 8 }}>({idx.columns.join(', ')})</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function RemoteSchemaNode({ vmIp, schema, onInsert, appName = 'payor' }) {
  const [open,        setOpen]        = useState(false)
  const [tables,      setTables]      = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [err,         setErr]         = useState(null)
  const [openTbl,     setOpenTbl]     = useState({})
  const [cols,        setCols]        = useState({})
  const [colLoad,     setColLoad]     = useState({})
  const [tableFilter, setTableFilter] = useState('')
  const [ctxMenu,     setCtxMenu]     = useState(null)
  const [structModal, setStructModal] = useState(null)

  useEffect(() => {
    if (!ctxMenu) return
    const dismiss = () => setCtxMenu(null)
    window.addEventListener('click', dismiss)
    window.addEventListener('contextmenu', dismiss)
    return () => { window.removeEventListener('click', dismiss); window.removeEventListener('contextmenu', dismiss) }
  }, [ctxMenu])

  function toggleSchema() {
    if (!open && tables === null) {
      setLoading(true); setErr(null)
      fetch(`/api/remote-app/${appName}/db/tables?vm_ip=${encodeURIComponent(vmIp)}&schema=${encodeURIComponent(schema)}`)
        .then(r => r.json())
        .then(d => { if (d.ok) setTables(d.tables); else setErr(d.error) })
        .catch(() => setErr('Failed'))
        .finally(() => setLoading(false))
    }
    setOpen(o => !o)
  }

  function toggleTable(tbl) {
    const nowOpen = !openTbl[tbl]
    setOpenTbl(p => ({ ...p, [tbl]: nowOpen }))
    if (nowOpen && !cols[tbl]) {
      setColLoad(p => ({ ...p, [tbl]: true }))
      fetch(`/api/remote-app/${appName}/db/columns?vm_ip=${encodeURIComponent(vmIp)}&schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(tbl)}`)
        .then(r => r.json())
        .then(d => { if (d.ok) setCols(p => ({ ...p, [tbl]: d.columns })) })
        .catch(() => {})
        .finally(() => setColLoad(p => ({ ...p, [tbl]: false })))
    }
  }

  return (
    <div>
      <div onClick={toggleSchema} style={{
        display: 'flex', alignItems: 'center', gap: 5, padding: '5px 8px',
        cursor: 'pointer', fontWeight: 600, fontSize: 12, color: 'var(--primary, #3b82f6)',
        background: 'var(--surface-2, var(--surface))', borderBottom: '1px solid var(--border)',
        userSelect: 'none',
      }}>
        <span>{open ? '▼' : '▶'}</span>
        <span style={{ fontFamily: 'monospace' }}>{schema}</span>
        {loading && <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />}
      </div>
      {err && <div style={{ fontSize: 11, color: '#f44336', padding: '4px 16px' }}>{err}</div>}
      {open && tables && (
        <div style={{ padding: '5px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <input type="text" value={tableFilter} onChange={e => setTableFilter(e.target.value)}
            placeholder="Filter tables…"
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 11, padding: '3px 7px', borderRadius: 4,
              border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', outline: 'none' }} />
        </div>
      )}
      {ctxMenu && (
        <div style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 1500,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)', minWidth: 200, fontSize: 12 }}
          onClick={e => e.stopPropagation()}>
          <div style={{ padding: '4px 0' }}>
            {[
              { label: '🔍 View Structure', action: () => { setStructModal(ctxMenu.tbl); setCtxMenu(null) } },
              { label: '▷  SELECT 100 rows', action: () => { onInsert(`SELECT * FROM ${schema}.${ctxMenu.tbl} WHERE ROWNUM <= 100`); setCtxMenu(null) } },
              { label: '📊 COUNT rows',       action: () => { onInsert(`SELECT COUNT(*) FROM ${schema}.${ctxMenu.tbl}`); setCtxMenu(null) } },
              { label: '✏️  INSERT template',  action: () => {
                  const tblCols = cols[ctxMenu.tbl]
                  const colList = tblCols ? tblCols.map(c => c.name).join(', ') : 'col1, col2'
                  const valList = tblCols ? tblCols.map(() => 'NULL').join(', ') : 'val1, val2'
                  onInsert(`INSERT INTO ${schema}.${ctxMenu.tbl} (${colList})\nVALUES (${valList})`)
                  setCtxMenu(null)
              }},
            ].map(item => (
              <div key={item.label} onClick={item.action}
                style={{ padding: '7px 14px', cursor: 'pointer', color: 'var(--text)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(59,130,246,0.1)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                {item.label}
              </div>
            ))}
          </div>
        </div>
      )}
      {structModal && (
        <RemoteTableStructureModal vmIp={vmIp} schema={schema} table={structModal}
          appName={appName}
          onClose={() => setStructModal(null)}
          onInsert={text => { onInsert(text); setStructModal(null) }} />
      )}
      {open && tables && tables
        .filter(tbl => !tableFilter.trim() || tbl.toLowerCase().includes(tableFilter.toLowerCase()))
        .map(tbl => (
          <div key={tbl}>
            <div onClick={() => toggleTable(tbl)}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, tbl }) }}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 16px',
                cursor: 'pointer', fontSize: 12, userSelect: 'none', borderBottom: '1px solid var(--border)',
                background: openTbl[tbl] ? 'rgba(59,130,246,0.06)' : 'transparent' }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{openTbl[tbl] ? '▼' : '▶'}</span>
              <span style={{ fontFamily: 'monospace', flex: 1 }} title={tbl}>{tbl}</span>
              <span onClick={e => { e.stopPropagation(); onInsert(`SELECT * FROM ${schema}.${tbl} WHERE ROWNUM <= 100`) }}
                style={{ fontSize: 10, color: 'var(--primary)', cursor: 'pointer', flexShrink: 0 }} title="Insert SELECT">▷</span>
              {colLoad[tbl] && <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} />}
            </div>
            {openTbl[tbl] && cols[tbl] && cols[tbl].map(col => (
              <div key={col.name} onClick={() => onInsert(col.name)} style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '2px 30px',
                fontSize: 11, cursor: 'pointer', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)',
              }} title={`${col.type}${col.length ? '(' + col.length + ')' : ''} ${col.nullable === 'Y' ? 'NULL' : 'NOT NULL'}`}>
                <span style={{ fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.name}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{col.type}</span>
              </div>
            ))}
          </div>
        ))}
    </div>
  )
}

export function RemoteDatabaseTab({ vmIp, appName = 'payor' }) {
  const [serverUp,   setServerUp]   = useState(null)
  const [connected,  setConnected]  = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connErr,    setConnErr]    = useState(null)
  const [connInfo,   setConnInfo]   = useState(null)
  const [schemas,    setSchemas]    = useState([])

  const [activeTab, setActiveTab] = useState('')      // sheet (tab) name in SQL_Queries\Remote\<App>\<Version>\<App>_<Version>_Queries.xlsx
  const [results,   setResults]   = useState({})
  const [executing, setExecuting] = useState({})
  const [execErr,   setExecErr]   = useState({})
  const [version,   setVersion]   = useState(null)
  const queryPanel  = useRef(null)

  const [editedCells, setEditedCells] = useState({})
  const [editingCell, setEditingCell] = useState(null)
  const [newRows,     setNewRows]     = useState({})
  const [keyCol,      setKeyCol]      = useState({})
  const [commitTable, setCommitTable] = useState({})
  const [commitBusy,  setCommitBusy]  = useState(false)
  const [commitMsg,   setCommitMsg]   = useState(null)
  const [commitErr,   setCommitErr]   = useState(null)

  const QS = `?vm_ip=${encodeURIComponent(vmIp)}`

  function connect() {
    setConnecting(true); setConnErr(null)
    fetch(`/api/remote-app/${appName}/db/connect`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vm_ip: vmIp }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setConnected(true); setConnInfo(d); loadSchemas() }
        else setConnErr(d.error || 'Connection failed')
      })
      .catch(() => setConnErr('Could not reach server'))
      .finally(() => setConnecting(false))
  }

  function loadSchemas() {
    fetch(`/api/remote-app/${appName}/db/schemas${QS}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setSchemas(d.schemas) })
      .catch(() => {})
  }

  useEffect(() => {
    if (!vmIp) return
    fetch(`/api/remote-app/${appName}/server-status?vm_ip=${encodeURIComponent(vmIp)}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setServerUp(!!d.running) })
      .catch(() => {})
  }, [vmIp, appName])

  useEffect(() => { connect() }, [vmIp])

  useEffect(() => {
    // the app version names the workbook: SQL_Queries\Remote\<App>\<Version>\<App>_<Version>_Queries.xlsx
    if (!vmIp) return
    fetch(`/api/remote-app/${appName}/current-branch${QS}`).then(r => r.json())
      .then(d => setVersion((d.ok && d.release_ver) ? String(d.release_ver) : ''))
      .catch(() => setVersion(''))
  }, [vmIp, appName])   // eslint-disable-line react-hooks/exhaustive-deps

  // Runs sql for the given tab and shows its result there; resolves true when it executed without error.
  function executeQuery(sql, tab) {
    if (!sql || !connected) return Promise.resolve(false)
    setExecuting(p => ({ ...p, [tab]: true }))
    setExecErr(p => ({ ...p, [tab]: null }))
    setResults(p => ({ ...p, [tab]: null }))
    setNewRows(p => ({ ...p, [tab]: [] }))
    return fetch(`/api/remote-app/${appName}/db/execute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vm_ip: vmIp, sql }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setResults(p => ({ ...p, [tab]: { ...d, sql } }))
          const m = sql.match(/\bFROM\s+(["'\w.]+)/i)
          if (m) setCommitTable(p => ({ ...p, [tab]: m[1].replace(/['"]/g, '') }))
          return true
        }
        setExecErr(p => ({ ...p, [tab]: d.error }))
        return false
      })
      .catch(() => { setExecErr(p => ({ ...p, [tab]: 'Request failed' })); return false })
      .finally(() => setExecuting(p => ({ ...p, [tab]: false })))
  }

  function insertIntoEditor(text) { queryPanel.current && queryPanel.current.insert(text) }

  function doCommit() {
    if (!result) return
    const table = (commitTable[activeTab] || '').trim()
    if (!table) { setCommitErr('Enter the target table name before committing.'); return }
    const ki = keyCol[activeTab] ?? 0
    const changes = []
    const touched = new Set(Object.keys(editedCells).filter(k => k.startsWith(tabPrefix)).map(k => Number(k.split(':')[1])))
    touched.forEach(ri => {
      const original = result.rows[ri]
      const updated  = original.map((cell, ci) => {
        const key = `${activeTab}:${ri}:${ci}`
        return key in editedCells ? (editedCells[key] === '' ? null : editedCells[key]) : cell
      })
      changes.push({ original, updated, keyIndex: ki })
    })
    const inserts = tabNewRows.map(row => ({ values: row.map(v => v === '' ? null : v) }))
    setCommitBusy(true); setCommitErr(null); setCommitMsg(null)
    fetch('/api/local-app/payor/db/commit-edits', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, columns: result.columns, changes, inserts }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setEditedCells(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(tabPrefix))))
          setNewRows(prev => ({ ...prev, [activeTab]: [] }))
          setCommitMsg(`Committed ${d.committed} row(s) — refreshing…`)
          executeQuery(result.sql, activeTab); setTimeout(() => setCommitMsg(null), 3000)
        } else setCommitErr(d.error || 'Commit failed')
      })
      .catch(() => setCommitErr('Request failed'))
      .finally(() => setCommitBusy(false))
  }

  function discardEdits() {
    setEditedCells(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(tabPrefix))))
    setNewRows(prev => ({ ...prev, [activeTab]: [] }))
    setCommitMsg(null); setCommitErr(null)
  }

  function addNewRow() {
    if (!result) return
    setNewRows(prev => ({ ...prev, [activeTab]: [...(prev[activeTab] || []), result.columns.map(() => '')] }))
  }

  function removeNewRow(ni) {
    setNewRows(prev => ({ ...prev, [activeTab]: (prev[activeTab] || []).filter((_, i) => i !== ni) }))
  }

  function updateNewCell(ni, ci, val) {
    setNewRows(prev => {
      const rows = [...(prev[activeTab] || [])]; rows[ni] = rows[ni].map((v, i) => i === ci ? val : v)
      return { ...prev, [activeTab]: rows }
    })
  }

  function triggerDownload(content, filename, mime) {
    const blob = new Blob([content], { type: mime }), url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url)
  }

  function exportResults(fmt) {
    if (!result || !result.columns.length) return
    const { columns, rows } = result
    const esc = v => (v === null ? '' : String(v))
    const q   = v => `"${esc(v).replace(/"/g, '""')}"`
    if (fmt === 'csv') {
      const lines = [columns.map(q).join(',')]; rows.forEach(r => lines.push(r.map(v => q(v)).join(',')))
      triggerDownload(lines.join('\r\n'), 'query_result.csv', 'text/csv')
    } else if (fmt === 'txt') {
      const lines = [columns.join('\t')]; rows.forEach(r => lines.push(r.map(esc).join('\t')))
      triggerDownload(lines.join('\r\n'), 'query_result.txt', 'text/plain')
    } else if (fmt === 'sql') {
      const tbl = (() => { const m = (result.sql || '').match(/\bFROM\s+(["'\w.]+)/i); return m ? m[1].replace(/['"]/g, '') : 'table_name' })()
      triggerDownload(
        rows.map(r => {
          const vals = r.map(v => v === null ? 'NULL' : typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`)
          return `INSERT INTO ${tbl} (${columns.join(', ')}) VALUES (${vals.join(', ')});`
        }).join('\n'), 'query_result.sql', 'text/plain')
    } else if (fmt === 'xls' || fmt === 'xlsx') {
      fetch('/api/local-app/payor/db/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columns, rows, format: fmt }),
      })
        .then(r => r.ok ? r.blob() : r.json().then(d => { throw new Error(d.error || 'Export failed') }))
        .then(blob => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `query_result.${fmt}`; a.click(); URL.revokeObjectURL(url) })
        .catch(err => alert(err.message))
    }
  }

  const result     = results[activeTab]
  const busy       = executing[activeTab]
  const eErr       = execErr[activeTab]
  const tabPrefix  = `${activeTab}:`
  const tabNewRows = newRows[activeTab] || []
  const hasEdits   = Object.keys(editedCells).some(k => k.startsWith(tabPrefix)) || tabNewRows.length > 0

  return (
    <div>
      <RemoteDeployedBanner vmIp={vmIp} appName={appName} serverUp={serverUp} />
      <div style={{ display: 'flex', gap: 0, height: 'calc(100vh - 160px)', minHeight: 500 }}>
        {/* Left: schema tree */}
        <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--border)',
          overflowY: 'auto', background: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: connected ? '#4caf50' : connecting ? '#ff9800' : '#f44336' }} />
            <span style={{ fontSize: 12, flex: 1, color: 'var(--text-muted)' }}>
              {connected ? (connInfo?.schema_user || 'Connected') : connecting ? 'Connecting…' : 'Disconnected'}
            </span>
            {!connected && !connecting && (
              <button className="btn btn-sm" style={{ padding: '2px 8px', fontSize: 11 }}
                onClick={connect}>Connect</button>
            )}
          </div>
          {connErr && <div style={{ fontSize: 11, color: '#f44336', padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{connErr}</div>}
          {connecting && <div style={{ padding: 16, textAlign: 'center' }}><span className="spinner" /></div>}
          {connected && schemas.map(s => (
            <RemoteSchemaNode key={s} vmIp={vmIp} schema={s} appName={appName} onInsert={insertIntoEditor} />
          ))}
        </div>

        {/* Right: query editor + results */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <SqlQueryPanel ref={queryPanel} scope="remote" appName={appName} version={version} connected={connected}
            busy={busy} onActive={setActiveTab} runSql={(sql, tab) => executeQuery(sql, tab)} />

          {/* Error */}
          {eErr && <div style={{ padding: '8px 14px', fontSize: 12, color: '#f44336',
            background: 'rgba(244,67,54,0.08)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>{eErr}</div>}

          {/* Results */}
          {result && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--text-muted)',
                borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)',
                display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ marginRight: 4 }}>
                  {result.is_dml
                    ? `${result.row_count} row(s) affected`
                    : `${result.row_count} row(s)${result.row_count === 1000 ? ' (limit 1000)' : ''}`}
                </span>
                {commitMsg && <span style={{ color: '#2e7d32', fontWeight: 600 }}>{commitMsg}</span>}
                {commitErr && <span style={{ color: '#c62828' }}>{commitErr}</span>}
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {result.columns.length > 0 && !result.is_dml && (
                    <>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Table:</span>
                      <input value={commitTable[activeTab] || ''} onChange={e => setCommitTable(p => ({ ...p, [activeTab]: e.target.value }))}
                        placeholder="schema.table"
                        style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, border: '1px solid var(--border)',
                          background: 'var(--surface2)', color: 'var(--text)', width: 160 }} />
                      <span style={{ borderLeft: '1px solid var(--border)', height: 12, margin: '0 2px' }} />
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Key:</span>
                      <select value={keyCol[activeTab] ?? 0} onChange={e => setKeyCol(p => ({ ...p, [activeTab]: Number(e.target.value) }))}
                        style={{ fontSize: 10, padding: '1px 4px', borderRadius: 4, border: '1px solid var(--border)',
                          background: 'var(--surface2)', color: 'var(--text)', maxWidth: 120 }}>
                        {result.columns.map((c, i) => <option key={i} value={i}>{c}</option>)}
                      </select>
                      <button className="btn btn-sm" onClick={addNewRow}
                        style={{ padding: '1px 8px', fontSize: 11, color: '#2e7d32', borderColor: 'rgba(46,125,50,0.4)' }}>
                        + Insert Row
                      </button>
                    </>
                  )}
                  {hasEdits && <>
                    <button className="btn btn-sm btn-primary" onClick={doCommit} disabled={commitBusy}
                      style={{ padding: '1px 8px', fontSize: 11 }}>
                      {commitBusy ? <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} /> : 'Commit'}
                    </button>
                    <button className="btn btn-sm" onClick={discardEdits}
                      style={{ padding: '1px 8px', fontSize: 11, color: '#c62828', borderColor: 'rgba(198,40,40,0.35)' }}>
                      Discard
                    </button>
                    <span style={{ borderLeft: '1px solid var(--border)', height: 14, margin: '0 2px' }} />
                  </>}
                  {result.columns.length > 0 && !result.is_dml && ['CSV','XLSX','XLS','SQL','TXT'].map(fmt => (
                    <button key={fmt} className="btn btn-sm" onClick={() => exportResults(fmt.toLowerCase())}
                      style={{ padding: '1px 7px', fontSize: 10 }}>{fmt}</button>
                  ))}
                </div>
              </div>
              {result.columns.length > 0 && (
                <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', minWidth: 'max-content' }}>
                    <thead>
                      <tr>
                        <th style={{ width: 24, padding: 0, position: 'sticky', top: 0, background: 'var(--surface)', borderBottom: '2px solid var(--border)' }} />
                        {result.columns.map(c => (
                          <th key={c} style={{ padding: '5px 10px', textAlign: 'left', position: 'sticky', top: 0,
                            background: 'var(--surface)', borderBottom: '2px solid var(--border)',
                            fontFamily: 'monospace', fontWeight: 700, whiteSpace: 'nowrap', color: 'var(--text)' }}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, ri) => (
                        <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : 'rgba(128,128,128,0.04)' }}>
                          <td style={{ width: 24, padding: 0, borderBottom: '1px solid var(--border)' }} />
                          {row.map((cell, ci) => {
                            const cellKey   = `${activeTab}:${ri}:${ci}`
                            const isEdited  = cellKey in editedCells
                            const isEditing = editingCell?.ri === ri && editingCell?.ci === ci
                            const displayVal = isEdited ? editedCells[cellKey] : (cell === null ? '' : String(cell))
                            return (
                              <td key={ci} onClick={() => !isEditing && setEditingCell({ ri, ci })}
                                style={{ padding: isEditing ? '0' : '4px 10px', borderBottom: '1px solid var(--border)',
                                  fontFamily: 'monospace', whiteSpace: 'nowrap', maxWidth: 300,
                                  overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'text',
                                  color: cell === null && !isEdited ? 'var(--text-muted)' : 'var(--text)',
                                  background: isEdited ? 'rgba(255,235,59,0.18)' : undefined,
                                  outline: isEdited ? '1px solid rgba(255,193,7,0.5)' : undefined }}
                                title={!isEditing ? (isEdited ? displayVal : (cell != null ? String(cell) : 'NULL')) : undefined}>
                                {isEditing ? (
                                  <input autoFocus value={displayVal}
                                    onChange={e => setEditedCells(prev => ({ ...prev, [cellKey]: e.target.value }))}
                                    onBlur={() => setEditingCell(null)}
                                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingCell(null) }}
                                    style={{ width: '100%', minWidth: 80, padding: '4px 10px', border: 'none',
                                      outline: '2px solid var(--primary)', fontFamily: 'monospace',
                                      fontSize: 12, background: 'rgba(59,130,246,0.06)', color: 'var(--text)', boxSizing: 'border-box' }} />
                                ) : isEdited ? (
                                  displayVal === '' ? <em style={{ opacity: 0.5 }}>NULL</em> : displayVal
                                ) : (
                                  cell === null ? <em style={{ opacity: 0.5 }}>NULL</em> : String(cell)
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                      {tabNewRows.map((newRow, ni) => (
                        <tr key={`new-${ni}`} style={{ background: 'rgba(76,175,80,0.08)', outline: '1px solid rgba(76,175,80,0.3)' }}>
                          <td style={{ width: 24, padding: '0 2px', borderBottom: '1px solid rgba(76,175,80,0.2)', textAlign: 'center' }}>
                            <button onClick={() => removeNewRow(ni)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c62828', fontSize: 13, lineHeight: 1, padding: 0 }}>✕</button>
                          </td>
                          {newRow.map((val, ci) => (
                            <td key={ci} style={{ padding: 0, borderBottom: '1px solid rgba(76,175,80,0.2)' }}>
                              <input value={val} placeholder="NULL" onChange={e => updateNewCell(ni, ci, e.target.value)}
                                style={{ width: '100%', minWidth: 80, padding: '4px 10px', border: 'none',
                                  outline: 'none', fontFamily: 'monospace', fontSize: 12,
                                  background: 'transparent', color: 'var(--text)', boxSizing: 'border-box' }} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Shared Code Tab ───────────────────────────────────────────────────────────
export function RemoteCodeTab({ vmIp, appName, appLabel, appIcon, screenCfg, defaultPanels,
                                branch, branchLoad, branchErr, loadBranch,
                                handlePull, pulling, pullOk, pullErr,
                                branchMgmtTick, setBranchMgmtTick, domainStatus, onGitBranchChange }) {
  const panels      = screenCfg?.panels || defaultPanels || []
  const panelOn     = key => panels.find(p => p.key === key)?.enabled !== false
  const [localBranch, setLocalBranch] = useState(null)
  useEffect(() => { if (localBranch) onGitBranchChange?.(localBranch) }, [localBranch])

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {(panelOn('current_branch') || panelOn('set_branch') || panelOn('branch_management') || panelOn('ide') || panelOn('terminal')) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, alignItems: 'stretch' }}>

            {/* Row 1 Col 1 — Current Branch */}
            {panelOn('current_branch')
              ? <RemoteCurrentBranchPanel appIcon={appIcon} appLabel={appLabel}
                  branch={branch} branchLoad={branchLoad} branchErr={branchErr}
                  onRefresh={() => loadBranch(true)} onPull={handlePull}
                  pulling={pulling} pullOk={pullOk} pullErr={pullErr} />
              : <div />
            }

            {/* Row 1 Col 2 — Set Branch */}
            {panelOn('set_branch')
              ? <SetBranchPanel vmIp={vmIp} appName={appName} appLabel={appLabel}
                  domainStatus={domainStatus || null} branchInfo={branch}
                  onBranchSet={() => { loadBranch(true); setBranchMgmtTick(t => t + 1) }} />
              : <div />
            }

            {/* Row 2 Col 1 — Branch Management */}
            {panelOn('branch_management')
              ? <RemoteBranchManagementPanel vmIp={vmIp} appName={appName}
                  onCheckout={() => loadBranch(true)} refreshTick={branchMgmtTick}
                  onCurrentChange={setLocalBranch}
                  style={{ marginBottom: 0 }} />
              : <div />
            }

            {/* Row 2 Col 2 — IDE · Terminal · GP Run */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
              {(panelOn('ide') || panelOn('terminal')) && (
                <div style={{ flex: '0 0 110px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {panelOn('ide') && (
                    <div className="card" style={{ flex: 1, marginBottom: 0, padding: '8px 10px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, textAlign: 'center' }}>
                        <div style={{ fontSize: 18, lineHeight: 1 }}>🧠</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Remote IDE</div>
                      </div>
                    </div>
                  )}
                  {panelOn('terminal') && (
                    <div className="card" style={{ flex: 1, marginBottom: 0, padding: '8px 10px' }}>
                      <RemoteTerminalCard vmIp={vmIp} appName={appName} appLabel={appLabel} />
                    </div>
                  )}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <GpRunPanel appName={appName} branch={localBranch || branch?.branch} releaseBranch={branch?.release_ver || branch?.branch} />
              </div>
            </div>

          </div>
        )}
        {panelOn('build_deploy') && (
          <RemoteBuildPanel vmIp={vmIp} appName={appName} appLabel={appLabel}
            buildFlagsCfg={screenCfg?.build_flags} />
        )}
      </div>
      {panelOn('modules') && (
        <div style={{ width: 340, flexShrink: 0 }}>
          <RemoteModulePanel vmIp={vmIp} appName={appName} appLabel={appLabel}
            refreshIntervalMs={(screenCfg?.settings?.module_refresh_interval ?? 300) * 1000} />
        </div>
      )}
    </div>
  )
}

// ── Simple Server Tab (start/stop/restart without log polling) ────────────────
export function RemoteSimpleServerTab({ vmIp, appName, displayName }) {
  const [serverUp, setServerUp] = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [opStatus, setOpStatus] = useState(null)
  const [opOutput, setOpOutput] = useState('')
  const [opKind,   setOpKind]   = useState(null)
  const [opErr,    setOpErr]    = useState(null)

  function fetchStatus() {
    fetch(`/api/remote-app/${appName}/server-status?vm_ip=${encodeURIComponent(vmIp)}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setServerUp(d.running ?? null) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 10000)
    return () => clearInterval(id)
  }, [vmIp])

  function serverOp(operation) {
    setOpKind(operation); setOpStatus('running'); setOpOutput(''); setOpErr(null)
    fetch(`/api/remote-app/${appName}/server-op`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vm_ip: vmIp, operation }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setOpStatus('success'); setOpOutput(d.output || 'Done'); fetchStatus() }
        else { setOpStatus('failed'); setOpErr(d.error || 'Operation failed') }
      })
      .catch(() => { setOpStatus('failed'); setOpErr('Could not reach server') })
  }

  const busy = opStatus === 'running'

  return (
    <div style={{ maxWidth: 600 }}>
      <div className="card">
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>{displayName} Server</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          {loading
            ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
            : <span style={{ width: 10, height: 10, borderRadius: '50%', background: serverUp === null ? '#9e9e9e' : serverUp ? '#4caf50' : '#f44336', display: 'inline-block' }} />
          }
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {loading ? 'Checking…' : serverUp === null ? 'Unknown' : serverUp ? 'Running' : 'Stopped'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={() => serverOp('start')} disabled={busy || serverUp === true}>
            {busy && opKind === 'start' ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Starting…</> : 'Start'}
          </button>
          <button className="btn btn-sm" style={{ borderColor: '#f44336', color: '#f44336' }}
            onClick={() => serverOp('stop')} disabled={busy || serverUp === false}>
            {busy && opKind === 'stop' ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Stopping…</> : 'Stop'}
          </button>
          <button className="btn btn-sm" onClick={() => serverOp('restart')} disabled={busy}>
            {busy && opKind === 'restart' ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Restarting…</> : 'Restart'}
          </button>
          <button className="btn btn-sm" onClick={fetchStatus} disabled={loading} title="Refresh status">↻</button>
        </div>
        {opErr && <div className="alert alert-error" style={{ marginTop: 10, fontSize: 12 }}>{opErr}</div>}
        {opOutput && (
          <ColoredTerminal output={opOutput} maxHeight={180} style={{ marginTop: 10 }} />
        )}
      </div>
    </div>
  )
}

// ── Runtime Properties Panel (used by RemoteAppServerTab) ─────────────────────
function SharedRuntimePropertiesPanel({ vmIp, appName }) {
  const [props,    setProps]    = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [err,      setErr]      = useState(null)
  const [filter,   setFilter]   = useState('')
  const [editKey,  setEditKey]  = useState(null)
  const [editVal,  setEditVal]  = useState('')
  const [saving,   setSaving]   = useState(false)
  const [newKey,   setNewKey]   = useState('')
  const [newVal,   setNewVal]   = useState('')
  const [addErr,   setAddErr]   = useState(null)
  const [adding,   setAdding]   = useState(false)
  const [deleting, setDeleting] = useState(null)

  function load() {
    setLoading(true)
    fetch(`/api/remote-app/${appName}/runtime-properties?vm_ip=${encodeURIComponent(vmIp)}`)
      .then(r => r.json())
      .then(d => { if (d.ok) { setProps(d.properties); setErr(null) } else setErr(d.error) })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [vmIp])

  function startEdit(key) { setEditKey(key); setEditVal(props[key] ?? '') }
  function cancelEdit()   { setEditKey(null); setEditVal('') }

  function saveEdit(key) {
    setSaving(true)
    fetch(`/api/remote-app/${appName}/runtime-properties/${encodeURIComponent(key)}?vm_ip=${encodeURIComponent(vmIp)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: editVal }),
    })
      .then(r => r.json())
      .then(d => { if (d.ok) { setProps(d.properties); setEditKey(null) } else setErr(d.error) })
      .finally(() => setSaving(false))
  }

  function deleteKey(key) {
    setDeleting(key)
    fetch(`/api/remote-app/${appName}/runtime-properties/${encodeURIComponent(key)}?vm_ip=${encodeURIComponent(vmIp)}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(d => { if (d.ok) setProps(d.properties); else setErr(d.error) })
      .finally(() => setDeleting(null))
  }

  function addProperty() {
    const k = newKey.trim()
    if (!k) { setAddErr('Key is required'); return }
    setAdding(true); setAddErr(null)
    fetch(`/api/remote-app/${appName}/runtime-properties?vm_ip=${encodeURIComponent(vmIp)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vm_ip: vmIp, key: k, value: newVal }),
    })
      .then(r => r.json())
      .then(d => { if (d.ok) { setProps(d.properties); setNewKey(''); setNewVal('') } else setAddErr(d.error) })
      .finally(() => setAdding(false))
  }

  const entries  = props ? Object.entries(props) : []
  const q        = filter.toLowerCase()
  const filtered = q ? entries.filter(([k, v]) => k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)) : entries

  const inputStyle = {
    background: 'var(--bg-secondary)', color: 'var(--text-primary)',
    border: '1px solid var(--border-color)', borderRadius: 4,
    padding: '3px 7px', fontSize: 12, width: '100%',
  }
  const cellStyle = { padding: '5px 8px', fontSize: 12, verticalAlign: 'middle' }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          Runtime Properties{props ? ` (${entries.length})` : ''}
        </span>
        <button onClick={load} disabled={loading} className="btn btn-sm" style={{ fontSize: 11, padding: '2px 10px' }}>
          {loading ? <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} /> : '↻ Refresh'}
        </button>
      </div>
      {err && <div className="alert alert-error" style={{ marginBottom: 10, fontSize: 12 }}>{err}</div>}
      <input type="text" placeholder="Filter by key or value…"
        value={filter} onChange={e => setFilter(e.target.value)}
        style={{ ...inputStyle, marginBottom: 10, width: '100%', boxSizing: 'border-box' }} />
      {loading && !props ? (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
        </div>
      ) : (
        <div style={{ maxHeight: 340, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 5 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)', position: 'sticky', top: 0, zIndex: 1 }}>
                <th style={{ ...cellStyle, width: '38%', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Key</th>
                <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Value</th>
                <th style={{ ...cellStyle, width: 60, borderBottom: '1px solid var(--border-color)' }} />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={3} style={{ ...cellStyle, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>
                  {filter ? 'No matches' : 'No properties yet'}
                </td></tr>
              ) : filtered.map(([k, v]) => (
                <tr key={k} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ ...cellStyle, fontFamily: 'monospace', wordBreak: 'break-all' }}>{k}</td>
                  <td style={cellStyle}>
                    {editKey === k ? (
                      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                        <input value={editVal} onChange={e => setEditVal(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(k); if (e.key === 'Escape') cancelEdit() }}
                          autoFocus style={{ ...inputStyle, flex: 1 }} />
                        <button className="btn btn-primary btn-sm" onClick={() => saveEdit(k)} disabled={saving}
                          style={{ fontSize: 11, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                          {saving ? '…' : 'Save'}
                        </button>
                        <button className="btn btn-sm" onClick={cancelEdit} disabled={saving}
                          style={{ fontSize: 11, padding: '2px 8px' }}>✕</button>
                      </div>
                    ) : (
                      <span style={{ fontFamily: 'monospace', cursor: 'pointer', display: 'block', wordBreak: 'break-all' }}
                        onClick={() => startEdit(k)} title="Click to edit">
                        {String(v) || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>(empty)</span>}
                      </span>
                    )}
                  </td>
                  <td style={{ ...cellStyle, textAlign: 'center' }}>
                    {editKey !== k && (
                      <button onClick={() => deleteKey(k)} disabled={deleting === k}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f44336', fontSize: 14, padding: '2px 4px', lineHeight: 1 }}>
                        {deleting === k ? '…' : '🗑'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: 6, border: '1px solid var(--border-color)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-muted)' }}>Add Property</div>
        {addErr && <div style={{ color: '#f44336', fontSize: 11, marginBottom: 6 }}>{addErr}</div>}
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <div style={{ flex: '0 0 38%' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Key</div>
            <input value={newKey} onChange={e => { setNewKey(e.target.value); setAddErr(null) }}
              onKeyDown={e => e.key === 'Enter' && addProperty()}
              placeholder="property.key" style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Value</div>
            <input value={newVal} onChange={e => setNewVal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addProperty()}
              placeholder="value" style={inputStyle} />
          </div>
          <button className="btn btn-primary btn-sm" onClick={addProperty} disabled={adding}
            style={{ fontSize: 12, padding: '4px 14px', whiteSpace: 'nowrap' }}>
            {adding ? <><span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} /> Adding…</> : '+ Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Rich App Server Tab (with log polling + runtime properties) ───────────────
function SharedStatusBadge({ running }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
      background: running ? 'rgba(76,175,80,0.12)' : 'rgba(244,67,54,0.10)',
      color: running ? '#2e7d32' : '#c62828',
      border: `1px solid ${running ? 'rgba(76,175,80,0.35)' : 'rgba(244,67,54,0.25)'}`,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: running ? '#4caf50' : '#f44336', display: 'inline-block' }} />
      {running ? 'Running' : 'Not Running'}
    </span>
  )
}

function evalCond(cond, ver) {
  const s = (cond || '').trim()
  if (!s) return { ok: true, exact: false }
  const andParts = s.split(/\s+and\s+/i)
  if (andParts.length > 1) {
    const rs = andParts.map(p => evalCond(p, ver))
    return { ok: rs.every(r => r.ok), exact: rs.every(r => r.exact) }
  }
  const orParts = s.split(/\s+or\s+/i)
  if (orParts.length > 1) {
    const rs = orParts.map(p => evalCond(p, ver))
    return { ok: rs.some(r => r.ok), exact: rs.some(r => r.exact) }
  }
  const m = s.match(/^([<>]=?|==?)(\d+\.?\d*)$/)
  if (!m) return { ok: false, exact: false }
  const t = parseFloat(m[2])
  const op = m[1]
  const ok = op === '<' ? ver < t : op === '<=' ? ver <= t : op === '>' ? ver > t
           : op === '>=' ? ver >= t : (op === '=' || op === '==') ? ver === t : false
  return { ok, exact: op === '=' || op === '==' }
}

function resolveVersionType(releaseVer, rules) {
  if (!rules || !releaseVer) return null
  const ver = parseFloat(String(releaseVer).split('.')[0]) || 0
  for (const rule of rules) {
    const { ok, exact } = evalCond(rule.condition, ver)
    if (ok && exact) return rule.value
  }
  for (const rule of rules) {
    if (!(rule.condition || '').trim()) continue
    if (evalCond(rule.condition, ver).ok) return rule.value
  }
  for (const rule of rules) {
    if (!(rule.condition || '').trim()) return rule.value
  }
  return null
}

export function RemoteAppServerTab({ vmIp, appName, displayName = 'App', serverType, serverTypeRules, defaultServerType, branchInfo, onOpSuccess }) {
  const [serverUp,          setServerUp]          = useState(null)
  const [serverDebug,       setServerDebug]       = useState(false)
  const [loading,           setLoading]           = useState(true)
  const [opStatus,          setOpStatus]          = useState(null)
  const [opOutput,          setOpOutput]          = useState('')
  const [opKind,            setOpKind]            = useState(null)
  const [opErr,             setOpErr]             = useState(null)
  const [resolvedType,      setResolvedType]      = useState(serverType)
  const [logCopied,         setLogCopied]         = useState(false)
  const [aborting,          setAborting]          = useState(false)
  const [logSignal,         setLogSignal]         = useState(0)
  const termRef    = useRef(null)
  const logPollRef = useRef(null)
  const opPollRef  = useRef(null)

  useEffect(() => {
    if (serverType !== 'version-based') { setResolvedType(serverType); return }
    if (!vmIp) return
    fetch(`/api/remote-app/${appName}/deployed-info?vm_ip=${encodeURIComponent(vmIp)}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.release_ver != null) {
          const resolved = resolveVersionType(d.release_ver, serverTypeRules)
          setResolvedType(resolved || defaultServerType || null)
        } else {
          setResolvedType(defaultServerType || null)
        }
      })
      .catch(() => { setResolvedType(defaultServerType || null) })
  }, [serverType, serverTypeRules, defaultServerType, vmIp, appName])

  function stopLogPoll() {
    if (logPollRef.current) { clearInterval(logPollRef.current); logPollRef.current = null }
    if (opPollRef.current)  { clearInterval(opPollRef.current);  opPollRef.current  = null }
  }

  function abortOp() {
    setAborting(true)
    fetch(`/api/remote-app/${appName}/server-op/abort`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vm_ip: vmIp }),
    })
      .then(r => r.json())
      .then(() => { stopLogPoll(); setOpStatus('aborted'); setAborting(false) })
      .catch(() => setAborting(false))
  }

  function startOpPoll() {
    opPollRef.current = setInterval(() => {
      fetch(`/api/remote-app/${appName}/server-op/status?vm_ip=${encodeURIComponent(vmIp)}`)
        .then(r => r.json())
        .then(d => {
          if (d.output) setOpOutput(d.output)
          if (d.status && d.status !== 'running') {
            stopLogPoll()
            if (d.status === 'success') {
              setOpStatus('success')
              setOpOutput(d.output || `${opKind} completed`)
              setTimeout(fetchStatus, 2000)
              setTimeout(() => onOpSuccess?.(), 3000)
            } else if (d.status === 'failed') {
              setOpStatus('failed')
              setOpErr(d.output || 'Operation failed')
            }
          }
        })
        .catch(() => {})
    }, 1500)
  }

  function fetchStatus() {
    fetch(`/api/remote-app/${appName}/server-status?vm_ip=${encodeURIComponent(vmIp)}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          const running = !!d.running
          setServerUp(running)
          setServerDebug(running && !!d.debug)
          if (running && logPollRef.current) {
            stopLogPoll()
            setOpStatus(s => s === 'running' ? 'success' : s)
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 4000)
    return () => { clearInterval(id); stopLogPoll() }
  }, [vmIp])

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [opOutput])

  function startLogPoll() {
    let elapsed = 0
    logPollRef.current = setInterval(() => {
      elapsed += 1500
      fetch(`/api/remote-app/${appName}/server-log?vm_ip=${encodeURIComponent(vmIp)}`)
        .then(r => r.json())
        .then(d => { if (d.ok && d.output) setOpOutput(d.output) })
        .catch(() => {})
      if (elapsed >= 120000) {
        stopLogPoll()
        setOpStatus(s => s === 'running' ? 'success' : s)
      }
    }, 1500)
  }

  function runOp(operation) {
    setOpKind(operation); setOpStatus('running'); setOpOutput(''); setOpErr(null); setAborting(false)
    setLogSignal(n => n + 1)
    stopLogPoll()
    fetch(`/api/remote-app/${appName}/server-op`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vm_ip: vmIp,
        operation,
        server_type: resolvedType,
        branch_version: branchInfo?.release_ver || branchInfo?.branch || '',
      }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          if (d.async) {
            startOpPoll()
            if (operation !== 'stop') startLogPoll()
          } else if (operation !== 'stop') {
            startLogPoll()
            setTimeout(fetchStatus, 5000)
            setTimeout(() => onOpSuccess?.(), 10000)
          } else {
            setOpStatus('success'); setOpOutput(d.output || `${operation} completed`)
            setTimeout(fetchStatus, 2000)
            setTimeout(() => onOpSuccess?.(), 3000)
          }
        } else {
          setOpErr(d.error || 'Operation failed'); setOpStatus('failed'); setOpOutput(d.output || '')
        }
      })
      .catch(() => { setOpErr('Could not reach server'); setOpStatus('failed') })
  }

  const busy = opStatus === 'running'

  const terminalEl = opKind !== 'stop' && opKind !== 'start_debug' && (opStatus || opOutput) && (
    <div style={{ marginTop: 12, borderRadius: 8, overflow: 'hidden', border: '1px solid #333' }}>
      <div style={{ background: '#2d2d2d', padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #3a3a3a' }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57', display: 'inline-block' }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e', display: 'inline-block' }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840', display: 'inline-block' }} />
        <span style={{ fontSize: 12, color: '#aaa', marginLeft: 4, flex: 1, textTransform: 'capitalize' }}>
          {opKind || 'server'} — Log
        </span>
        {busy && <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5, borderColor: '#888 transparent transparent transparent' }} />}
        {opStatus === 'success' && <span style={{ fontSize: 11, color: '#4caf50', fontWeight: 600 }}>✓ Done</span>}
        {opStatus === 'failed'  && <span style={{ fontSize: 11, color: '#f44336', fontWeight: 600 }}>✗ Failed</span>}
        {opStatus === 'aborted' && <span style={{ fontSize: 11, color: '#ff9800', fontWeight: 600 }}>⊘ Aborted</span>}
        {busy && (
          <button onClick={abortOp} disabled={aborting}
            style={{ background: 'none', border: '1px solid #f44336', borderRadius: 4, cursor: aborting ? 'default' : 'pointer',
              color: '#f44336', fontSize: 11, padding: '1px 8px', lineHeight: 1.6, fontWeight: 600 }}>
            {aborting ? 'Aborting…' : '⊗ Abort'}
          </button>
        )}
        {opOutput && (
          <button onClick={() => { navigator.clipboard.writeText(opOutput).catch(() => {}); setLogCopied(true); setTimeout(() => setLogCopied(false), 2000) }}
            title="Copy log to clipboard"
            style={{ background: 'none', border: '1px solid #444', borderRadius: 4, cursor: 'pointer', color: logCopied ? '#4caf50' : '#888', fontSize: 11, padding: '1px 7px', lineHeight: 1.6 }}>
            {logCopied ? '✓ Copied' : 'Copy'}
          </button>
        )}
        {opStatus !== 'running' && (
          <button onClick={() => { stopLogPoll(); setOpStatus(null); setOpOutput(''); setOpKind(null); setOpErr(null); setAborting(false) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 16, lineHeight: 1, padding: '0 2px', marginLeft: 4 }}>✕</button>
        )}
      </div>
      <ColoredTerminal output={opOutput || (busy ? '' : ' ')} termRef={termRef}
        maxHeight={320} fontSize={12}
        style={{ minHeight: 100, fontFamily: '"Cascadia Code","Fira Mono","Consolas",monospace', lineHeight: 1.65, padding: '12px 14px' }} />
    </div>
  )

  return (
    <div>
      <RemoteDeployedBanner vmIp={vmIp} appName={appName} serverUp={serverUp} />
      <div className="card" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '10px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>App Server</span>
          {resolvedType && resolvedType !== 'version-based' && (
            <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, background: 'var(--surface2)', color: 'var(--text-muted)', border: '1px solid var(--border)', fontWeight: 500 }}>
              {({ karaf: 'Karaf', weblogic: 'WebLogic', tomcat: 'Tomcat' }[resolvedType?.toLowerCase()] || resolvedType)}
            </span>
          )}
          {loading
            ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
            : <SharedStatusBadge running={serverUp} />}
          {serverUp && serverDebug && (
            <span title="JVM started with the JDWP debug agent (startServer -d)"
              style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, background: '#f3e5f5', color: '#7b1fa2', border: '1px solid #ce93d8', fontWeight: 600 }}>🐞 Debug Mode</span>
          )}
        </div>
        {opErr && <div className="alert alert-error" style={{ fontSize: 12, padding: '4px 10px', margin: 0 }}>{opErr}</div>}
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          {!serverUp ? (
            <>
            <button className="btn btn-primary btn-sm" onClick={() => runOp('start')} disabled={busy}>
              {busy && opKind === 'start'
                ? <><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> Starting…</>
                : '▶ Start Server'}
            </button>
            {resolvedType === 'tomcat' && (
              <button className="btn btn-sm" onClick={() => runOp('start_debug')} disabled={busy}
                title="export DEBUG=true, then startServer -d"
                style={{ color: '#7b1fa2', borderColor: '#7b1fa2' }}>
                {busy && opKind === 'start_debug'
                  ? <><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> Starting (debug)…</>
                  : '🐞 Start in Debug Mode'}
              </button>
            )}
            </>
          ) : (
            <>
              <button className="btn btn-sm" onClick={() => runOp('stop')} disabled={busy}
                style={{ color: '#f44336', borderColor: '#f44336' }}>
                {busy && opKind === 'stop'
                  ? <><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> Stopping…</>
                  : '⏹ Stop Server'}
              </button>
              <button className="btn btn-sm" onClick={() => runOp('restart')} disabled={busy}
                style={{ color: '#ff9800', borderColor: '#ff9800' }}>
                {busy && opKind === 'restart'
                  ? <><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> Restarting…</>
                  : '↺ Restart Server'}
              </button>
            </>
          )}
        </div>
      </div>
      {terminalEl}
      {resolvedType === 'karaf'
        ? <KarafRightPanel base={`/api/remote-app/${appName}/karaf`} query={`vm_ip=${encodeURIComponent(vmIp)}`} />
        : resolvedType === 'tomcat'
        ? <TomcatRightPanel vmIp={vmIp} appName={appName} logSignal={logSignal} opOutput={opOutput} opKind={opKind} opStatus={opStatus} />
        : <SharedRuntimePropertiesPanel vmIp={vmIp} appName={appName} />}
    </div>
  )
}

// ── Tomcat Right Panel ────────────────────────────────────────────────────────
export function TomcatRightPanel({ vmIp, appName, base: baseProp, query: queryProp, propertiesPanel, logSignal = 0, opOutput = '', opKind = null, opStatus = null }) {
  const base  = baseProp  !== undefined ? baseProp  : `/api/remote-app/${appName}/tomcat`
  const query = queryProp !== undefined ? queryProp : (vmIp ? `vm_ip=${encodeURIComponent(vmIp)}` : '')
  const [tab, setTab] = useState('logs')
  // a start/restart in the parent bumps logSignal -> jump to the Server Logs tab
  useEffect(() => { if (logSignal > 0) setTab('logs') }, [logSignal])
  function tabBtn(key, label) {
    const active = tab === key
    return (
      <button onClick={() => setTab(key)} style={{
        padding: '6px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12,
        fontWeight: active ? 600 : 400, color: active ? 'var(--primary)' : 'var(--text-muted)',
        borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
        marginBottom: -1, whiteSpace: 'nowrap',
      }}>{label}</button>
    )
  }
  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 14, overflowX: 'auto' }}>
        {tabBtn('logs',       'Server Logs')}
        {tabBtn('system',     'System')}
        {tabBtn('apps',       'Application')}
        {tabBtn('properties', 'Runtime Properties')}
      </div>
      {tab === 'system'     && <TomcatSystemTab base={base} query={query} />}
      {tab === 'apps'       && <TomcatAppsTab   base={base} query={query} vmIp={vmIp} />}
      {tab === 'properties' && (propertiesPanel || <SharedRuntimePropertiesPanel vmIp={vmIp} appName={appName} />)}
      {/* stays mounted (just hidden) so the log keeps loading and its content survives tab switches */}
      <div style={{ display: tab === 'logs' ? 'block' : 'none' }}>
        <TomcatServerLogsTab base={base} query={query} followFast={logSignal > 0} opOutput={opOutput} opKind={opKind} opStatus={opStatus} visible={tab === 'logs'} />
      </div>
    </div>
  )
}

// Live tail of the Tomcat log; polls while this tab is open (faster right after a start/restart)
const _tomcatLogCache = {}   // last log per endpoint: shown instantly when the tab is re-opened
function TomcatServerLogsTab({ base, query = '', followFast, opOutput, opKind, opStatus, visible = true }) {
  const cacheKey = `${base}?${query}`
  const [output,  setOutput]  = useState(_tomcatLogCache[cacheKey] || '')
  const [err,     setErr]     = useState(null)
  const [paused,  setPaused]  = useState(false)
  const [copied,  setCopied]  = useState(false)
  const termRef = useRef(null)
  const qs = query ? `&${query}` : ''

  useEffect(() => {
    if (paused) return
    let alive = true
    const load = () => fetch(`${base}/server-log?n=500${qs}`)
      .then(r => r.json())
      .then(d => {
        if (!alive) return
        if (d.ok) {
          // never blank out a log we already have because one poll came back empty
          if (d.output) { _tomcatLogCache[cacheKey] = d.output; setOutput(d.output) }
          setErr(null)
        } else setErr(d.error || 'Could not read server log')
      })
      .catch(() => { if (alive) setErr('Could not reach server') })
    load()
    const id = setInterval(load, followFast ? 1500 : 3000)
    return () => { alive = false; clearInterval(id) }
  }, [base, qs, paused, followFast])

  // Start/Stop/Restart output goes into this same terminal, ahead of the Tomcat log tail
  const opState = opStatus === 'running' ? ' (running…)' : opStatus === 'failed' ? ' (failed)' : opStatus === 'aborted' ? ' (aborted)' : opStatus === 'success' ? ' (done)' : ''
  const shown = (opKind !== 'start_debug' && (opKind || opOutput))
    ? `━━ ${opKind ? (opKind === 'start_debug' ? 'Start (debug)' : opKind.charAt(0).toUpperCase() + opKind.slice(1)) : 'Server'} output${opState} ━━\n${opOutput || ''}\n\n━━ Tomcat log ━━\n${output}`
    : output

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [shown, visible])

  return (
    <div>
    <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #333' }}>
      <div style={{ background: '#2d2d2d', padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #3a3a3a' }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57', display: 'inline-block' }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e', display: 'inline-block' }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840', display: 'inline-block' }} />
        <span style={{ fontSize: 12, color: '#aaa', marginLeft: 4, flex: 1 }}>Tomcat — Server Logs {paused ? '(paused)' : '(live)'}</span>
        {err && <span style={{ fontSize: 11, color: '#f44336' }}>{err}</span>}
        <button onClick={() => setPaused(p => !p)}
          style={{ background: 'none', border: '1px solid #444', borderRadius: 4, cursor: 'pointer', color: '#888', fontSize: 11, padding: '1px 7px', lineHeight: 1.6 }}>
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button onClick={() => { navigator.clipboard.writeText(shown).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
          style={{ background: 'none', border: '1px solid #444', borderRadius: 4, cursor: 'pointer', color: copied ? '#4caf50' : '#888', fontSize: 11, padding: '1px 7px', lineHeight: 1.6 }}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <ColoredTerminal output={shown || ' '} termRef={termRef} maxHeight={480} fontSize={12}
        style={{ minHeight: 200, fontFamily: '"Cascadia Code","Fira Mono","Consolas",monospace', lineHeight: 1.65, padding: '12px 14px' }} />
    </div>
    </div>
  )
}

function TomcatSystemTab({ base, query = '' }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState(null)
  const [gcBusy,  setGcBusy]  = useState(false)
  const [gcMsg,   setGcMsg]   = useState(null)
  const qs = query ? `?${query}` : ''

  function load() {
    setLoading(true); setErr(null)
    fetch(`${base}/system${qs}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setData(d); else setErr(d.error) })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [base, query])

  function runGc() {
    setGcBusy(true); setGcMsg(null)
    fetch(`${base}/gc${qs}`, { method: 'POST' })
      .then(r => r.json())
      .then(d => setGcMsg(d.ok ? 'GC triggered successfully' : (d.error || 'GC failed')))
      .catch(() => setGcMsg('Request failed'))
      .finally(() => setGcBusy(false))
  }

  function InfoRow({ label, value }) {
    return (
      <div style={{ display: 'flex', padding: '5px 0', borderBottom: '1px solid var(--border)', gap: 12 }}>
        <span style={{ width: 200, flexShrink: 0, fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ fontSize: 12, fontFamily: 'monospace', flex: 1 }}>{value || '—'}</span>
      </div>
    )
  }

  function Section({ title, children }) {
    const [open, setOpen] = useState(true)
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: open ? 8 : 0 }}>
          <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{title}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
        </div>
        {open && children}
      </div>
    )
  }

  if (loading) return <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}><span className="spinner" /></div>
  if (err) return <div className="card"><div className="alert alert-error">{err}</div><button className="btn btn-sm" onClick={load} style={{ marginTop: 8 }}>↻ Retry</button></div>

  const parseSize = s => {
    if (!s) return 0
    const m = String(s).match(/([\d.]+)([KMG]?)/i)
    if (!m) return 0
    const n = parseFloat(m[1])
    const u = m[2].toUpperCase()
    return u === 'G' ? n * 1024 * 1024 : u === 'M' ? n * 1024 : n
  }
  const fmtMb = kb => kb > 1024 ? `${(kb / 1024).toFixed(1)} GB` : `${kb.toFixed(0)} MB`

  const heap = data?.heap || {}
  const usedKb  = parseSize(heap.used)
  const totalKb = parseSize(heap.total)
  const usedPct = totalKb ? Math.round(usedKb / totalKb * 100) : 0
  const metaUsed = parseSize(heap.metaspace_used)
  const metaCom  = parseSize(heap.metaspace_committed)
  const metaPct  = metaCom ? Math.round(metaUsed / metaCom * 100) : 0

  const props = data?.props || {}

  return (
    <div>
      <Section title="JVM / Process">
        <InfoRow label="PID"            value={data?.pid} />
        <InfoRow label="Java Version"   value={data?.java_version} />
        <InfoRow label="Catalina Home"  value={props['catalina.home']} />
        <InfoRow label="Catalina Base"  value={props['catalina.base']} />
        <InfoRow label="Java Vendor"    value={props['java.vendor']} />
        <InfoRow label="VM Resident"    value={data?.vmrss} />
        <InfoRow label="VM Virtual"     value={data?.vmsize} />
      </Section>

      <Section title="Heap Memory">
        {totalKb > 0 ? (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
              <span>Heap: {fmtMb(usedKb)} used / {fmtMb(totalKb)} total</span>
              <span>{usedPct}%</span>
            </div>
            <div style={{ height: 12, background: 'var(--surface2)', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${usedPct}%`,
                background: usedPct > 85 ? '#f44336' : usedPct > 70 ? '#ff9800' : '#4caf50', borderRadius: 6 }} />
            </div>
          </div>
        ) : null}
        {metaCom > 0 ? (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
              <span>Metaspace: {fmtMb(metaUsed)} used / {fmtMb(metaCom)} committed</span>
              <span>{metaPct}%</span>
            </div>
            <div style={{ height: 8, background: 'var(--surface2)', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${metaPct}%`, background: '#2196f3', borderRadius: 6 }} />
            </div>
          </div>
        ) : null}
        {heap.raw && <pre style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{heap.raw}</pre>}
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-sm" onClick={runGc} disabled={gcBusy}>
            {gcBusy ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Running…</> : 'Run Garbage Collection'}
          </button>
          {gcMsg && <span style={{ fontSize: 12, color: gcMsg.includes('triggered') ? '#4caf50' : '#f44336' }}>{gcMsg}</span>}
        </div>
      </Section>

      <Section title="Threads">
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '6px 0' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'monospace', color: 'var(--primary)' }}>{data?.threads || '—'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total Threads</div>
          </div>
        </div>
        {data?.jstat_raw && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>jstat -gcutil</div>
            <pre style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{data.jstat_raw}</pre>
          </div>
        )}
      </Section>

      <div style={{ marginTop: 4 }}>
        <button className="btn btn-sm" onClick={load} style={{ fontSize: 11 }}>↻ Refresh</button>
      </div>
    </div>
  )
}

function TomcatAppsTab({ base, query = '', vmIp }) {
  const [apps,     setApps]     = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [err,      setErr]      = useState(null)
  const [manager,  setManager]  = useState(false)
  const [actionBusy, setActionBusy] = useState(null)
  const [actionMsg,  setActionMsg]  = useState(null)
  const [showDeploy, setShowDeploy] = useState(false)
  const [deployFile, setDeployFile] = useState(null)
  const [deploying,  setDeploying]  = useState(false)
  const [deployMsg,  setDeployMsg]  = useState(null)
  const qs = query ? `?${query}` : ''

  function load() {
    setLoading(true); setErr(null)
    fetch(`${base}/apps${qs}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setApps(d.apps); setManager(!!d.manager) }
        else setErr(d.error)
      })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [base, query])

  function doAction(path, action) {
    setActionBusy(path + ':' + action); setActionMsg(null)
    fetch(`${base}/app-action`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(vmIp ? { vm_ip: vmIp } : {}), path, action }),
    })
      .then(r => r.json())
      .then(d => {
        setActionMsg(d.ok ? `${action} → OK` : (d.error || `${action} failed`))
        if (d.ok) setTimeout(load, 1000)
      })
      .catch(() => setActionMsg('Request failed'))
      .finally(() => setActionBusy(null))
  }

  function doDeploy() {
    if (!deployFile) return
    setDeploying(true); setDeployMsg(null)
    const fd = new FormData()
    fd.append('war', deployFile)
    if (vmIp) fd.append('vm_ip', vmIp)
    fetch(`${base}/deploy`, { method: 'POST', body: fd })
      .then(r => r.json())
      .then(d => {
        setDeployMsg(d.ok ? 'Deployed successfully' : (d.error || 'Deploy failed'))
        if (d.ok) { setDeployFile(null); setTimeout(load, 1000) }
      })
      .catch(() => setDeployMsg('Request failed'))
      .finally(() => setDeploying(false))
  }

  const inputStyle = {
    background: 'var(--bg-secondary)', color: 'var(--text-primary)',
    border: '1px solid var(--border-color)', borderRadius: 4,
    padding: '4px 8px', fontSize: 12, flex: 1,
  }

  const stateColor = s => s === 'running' ? '#4caf50' : s === 'stopped' ? '#f44336' : 'var(--text-muted)'

  if (loading) return <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}><span className="spinner" /></div>
  if (err) return <div className="card"><div className="alert alert-error">{err}</div><button className="btn btn-sm" onClick={load} style={{ marginTop: 8 }}>↻ Retry</button></div>

  return (
    <div>
      {!manager && (
        <div className="alert" style={{ marginBottom: 10, fontSize: 12, background: 'rgba(255,152,0,0.1)', color: '#e65100', border: '1px solid rgba(255,152,0,0.3)', borderRadius: 6, padding: '8px 12px' }}>
          Tomcat Manager not available — showing webapps directory. Start/Stop/Reload/Undeploy require Tomcat Manager. Configure <code>tomcat_manager_user</code> / <code>tomcat_manager_pass</code> in screen_config to enable.
        </div>
      )}
      {actionMsg && (
        <div style={{ marginBottom: 8, fontSize: 12, padding: '6px 10px', borderRadius: 5,
          background: actionMsg.includes('OK') ? 'rgba(76,175,80,0.1)' : 'rgba(244,67,54,0.1)',
          color: actionMsg.includes('OK') ? '#2e7d32' : '#c62828',
          border: `1px solid ${actionMsg.includes('OK') ? 'rgba(76,175,80,0.3)' : 'rgba(244,67,54,0.3)'}`,
        }}>
          {actionMsg}
          <button onClick={() => setActionMsg(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>
        </div>
      )}
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Deployed Applications ({apps?.length ?? 0})</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm" onClick={() => setShowDeploy(s => !s)} style={{ fontSize: 11 }}>
              {showDeploy ? '✕ Cancel Deploy' : '+ Deploy'}
            </button>
            <button className="btn btn-sm" onClick={load} disabled={loading} style={{ fontSize: 11 }}>↻ Refresh</button>
          </div>
        </div>
        {showDeploy && (
          <div style={{ marginBottom: 12, padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: 6, border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Deploy New Application</div>
            {deployMsg && <div style={{ fontSize: 12, marginBottom: 6, color: deployMsg.includes('success') ? '#2e7d32' : '#c62828' }}>{deployMsg}</div>}
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 90, flexShrink: 0 }}>WAR file to deploy</span>
              <input type="file" accept=".war" onChange={e => setDeployFile(e.target.files?.[0] || null)}
                style={{ ...inputStyle, padding: 2 }} />
            </div>
            {deployFile && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
              Context path: <code>{deployFile.name.replace(/\.war$/i, '') === 'ROOT' ? '/' : '/' + deployFile.name.replace(/\.war$/i, '')}</code> (from file name, like Tomcat Manager)
            </div>}
            <button className="btn btn-primary btn-sm" onClick={doDeploy} disabled={deploying || !deployFile} style={{ fontSize: 11 }}>
              {deploying ? <><span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} /> Deploying…</> : '▶ Deploy'}
            </button>
          </div>
        )}
        {!apps || apps.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0', textAlign: 'center' }}>No applications found</div>
        ) : (
          <div style={{ border: '1px solid var(--border-color)', borderRadius: 5, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)' }}>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Path</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid var(--border-color)', width: 90 }}>State</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid var(--border-color)', width: 80 }}>Sessions</th>
                  {manager && <th style={{ padding: '6px 10px', borderBottom: '1px solid var(--border-color)', width: 200 }} />}
                </tr>
              </thead>
              <tbody>
                {apps.map(app => {
                  const key = app.path
                  const busy = actionBusy && actionBusy.startsWith(key + ':')
                  const busyAction = busy ? actionBusy.split(':')[1] : null
                  return (
                    <tr key={key} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '6px 10px', fontFamily: 'monospace', wordBreak: 'break-all' }}>{app.path}</td>
                      <td style={{ padding: '6px 10px' }}>
                        <span style={{ fontWeight: 600, color: stateColor(app.state) }}>
                          {app.state === 'unknown' ? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span> : app.state}
                        </span>
                      </td>
                      <td style={{ padding: '6px 10px', color: 'var(--text-muted)' }}>{app.sessions}</td>
                      {manager && (
                        <td style={{ padding: '4px 8px' }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {app.state !== 'running' && (
                              <button className="btn btn-sm" onClick={() => doAction(app.path, 'start')} disabled={!!actionBusy}
                                style={{ fontSize: 10, padding: '2px 7px', color: '#4caf50', borderColor: '#4caf50' }}>
                                {busy && busyAction === 'start' ? '…' : '▶ Start'}
                              </button>
                            )}
                            {app.state === 'running' && (
                              <button className="btn btn-sm" onClick={() => doAction(app.path, 'stop')} disabled={!!actionBusy}
                                style={{ fontSize: 10, padding: '2px 7px', color: '#f44336', borderColor: '#f44336' }}>
                                {busy && busyAction === 'stop' ? '…' : '⏹ Stop'}
                              </button>
                            )}
                            <button className="btn btn-sm" onClick={() => doAction(app.path, 'reload')} disabled={!!actionBusy}
                              style={{ fontSize: 10, padding: '2px 7px', color: '#ff9800', borderColor: '#ff9800' }}>
                              {busy && busyAction === 'reload' ? '…' : '↺ Reload'}
                            </button>
                            <button className="btn btn-sm" onClick={() => doAction(app.path, 'undeploy')} disabled={!!actionBusy}
                              style={{ fontSize: 10, padding: '2px 7px', color: '#9e9e9e', borderColor: '#9e9e9e' }}>
                              {busy && busyAction === 'undeploy' ? '…' : '✕ Undeploy'}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
// ── Queues Panel + Queue Tab ──────────────────────────────────────────────────
function SharedQueuesPanel({ vmIp, appName }) {
  const [queues,  setQueues]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState(null)
  const [filter,  setFilter]  = useState('')

  function load() {
    setLoading(true)
    fetch(`/api/remote-app/${appName}/artemis/queues?vm_ip=${encodeURIComponent(vmIp)}`)
      .then(r => r.json())
      .then(d => { if (d.ok) { setQueues(d.queues); setErr(null) } else setErr(d.error) })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [vmIp])

  const q        = filter.toLowerCase()
  const filtered = (queues || []).filter(item => !q || item.name.toLowerCase().includes(q))
  const cellStyle = { padding: '5px 8px', fontSize: 12, verticalAlign: 'middle' }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Queues{queues ? ` (${queues.length})` : ''}</span>
        {loading && <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />}
      </div>
      {err && <div className="alert alert-error" style={{ marginBottom: 8, fontSize: 12 }}>{err}</div>}
      <input type="text" placeholder="Filter queues…" value={filter} onChange={e => setFilter(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 4, padding: '4px 8px', fontSize: 12 }} />
      <div style={{ maxHeight: 400, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 5 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg-secondary)', position: 'sticky', top: 0, zIndex: 1 }}>
              <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Queue</th>
              <th style={{ ...cellStyle, textAlign: 'right', fontWeight: 600, borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>Current</th>
              <th style={{ ...cellStyle, textAlign: 'right', fontWeight: 600, borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>Total Added</th>
              <th style={{ ...cellStyle, textAlign: 'right', fontWeight: 600, borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>Consumers</th>
            </tr>
          </thead>
          <tbody>
            {!queues ? (
              <tr><td colSpan={4} style={{ ...cellStyle, textAlign: 'center', padding: 20 }}>
                <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
              </td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={4} style={{ ...cellStyle, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>
                {filter ? 'No matches' : 'No queues found'}
              </td></tr>
            ) : filtered.map(item => (
              <tr key={item.name} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <td style={{ ...cellStyle, fontFamily: 'monospace', wordBreak: 'break-all' }}>{item.name}</td>
                <td style={{ ...cellStyle, textAlign: 'right', fontWeight: item.message_count > 0 ? 600 : 400, color: item.message_count > 0 ? '#f44336' : 'inherit' }}>
                  {item.message_count}
                </td>
                <td style={{ ...cellStyle, textAlign: 'right', color: 'var(--text-muted)' }}>{item.messages_added}</td>
                <td style={{ ...cellStyle, textAlign: 'right', color: 'var(--text-muted)' }}>{item.consumer_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function RemoteQueueTab({ vmIp, appName }) {
  const [artemisUp, setArtemisUp] = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [opStatus,  setOpStatus]  = useState(null)
  const [opOutput,  setOpOutput]  = useState('')
  const [opKind,    setOpKind]    = useState(null)
  const [opErr,     setOpErr]     = useState(null)
  const [logCopied, setLogCopied] = useState(false)
  const termRef       = useRef(null)
  const logPollRef    = useRef(null)
  const opStatusPoll  = useRef(null)

  function stopLogPoll() {
    if (logPollRef.current)   { clearInterval(logPollRef.current);   logPollRef.current   = null }
    if (opStatusPoll.current) { clearInterval(opStatusPoll.current); opStatusPoll.current = null }
  }

  function fetchStatus() {
    fetch(`/api/remote-app/${appName}/artemis/server-status?vm_ip=${encodeURIComponent(vmIp)}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          const up = !!d.running
          setArtemisUp(up)
          if (up && logPollRef.current) {
            stopLogPoll()
            setOpStatus(s => s === 'running' ? 'success' : s)
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  // On mount: check if a server-side op is already in progress (survives page reload)
  useEffect(() => {
    fetch(`/api/remote-app/${appName}/artemis/server-op-status`)
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.status === 'running') {
          setOpKind(d.operation || 'start')
          setOpOutput(d.output || '')
          setOpStatus('running')
          startOpStatusPoll()
        }
      })
      .catch(() => {})
  }, [vmIp])

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 4000)
    return () => { clearInterval(id); stopLogPoll() }
  }, [vmIp])

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [opOutput])

  function startOpStatusPoll() {
    opStatusPoll.current = setInterval(() => {
      fetch(`/api/remote-app/${appName}/artemis/server-op-status`)
        .then(r => r.json())
        .then(d => {
          if (!d.ok) return
          // Always update terminal with latest accumulated output
          if (d.output) setOpOutput(d.output)
          if (d.status === 'running') return
          clearInterval(opStatusPoll.current); opStatusPoll.current = null
          if (d.status === 'failed' || d.status === 'aborted') {
            stopLogPoll()
            setOpStatus(d.status)
            if (d.status === 'aborted') setOpErr('Operation aborted')
            else setOpErr('Operation failed')
          }
          // 'success': fetchStatus (4s interval) will confirm Artemis is up and stop remaining polls
        })
        .catch(() => {})
    }, 1500)
  }

  function runOp(operation) {
    setOpKind(operation); setOpStatus('running'); setOpOutput(''); setOpErr(null)
    stopLogPoll()
    fetch(`/api/remote-app/${appName}/artemis/server-op`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vm_ip: vmIp, operation }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          // Use op-status poll for real-time streaming output (both start and stop)
          startOpStatusPoll()
          setTimeout(fetchStatus, 5000)
        } else {
          setOpErr(d.error || 'Operation failed'); setOpStatus('failed')
        }
      })
      .catch(() => { setOpErr('Could not reach server'); setOpStatus('failed') })
  }

  function abortOp() {
    fetch(`/api/remote-app/${appName}/artemis/server-op-abort`, { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (!d.ok) setOpErr(d.error || 'Could not abort') })
      .catch(() => { setOpErr('Could not reach server') })
  }

  const busy = opStatus === 'running'

  return (
    <div>
      <RemoteDeployedBanner vmIp={vmIp} appName={appName} serverUp={artemisUp} />
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: '0 0 220px' }}>
          <div className="card">
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Queue Status</div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Artemis</div>
              {loading
                ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
                : <SharedStatusBadge running={artemisUp} />}
            </div>
            {opErr && <div className="alert alert-error" style={{ marginBottom: 12 }}>{opErr}</div>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-sm" onClick={() => runOp('start')} disabled={busy || artemisUp === true}>
                {busy && opKind === 'start' ? <><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> Starting…</> : '▶ Start'}
              </button>
              <button className="btn btn-sm" onClick={() => runOp('stop')} disabled={busy || artemisUp === false}
                style={{ color: '#f44336', borderColor: '#f44336' }}>
                {busy && opKind === 'stop' ? <><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> Stopping…</> : '⏹ Stop'}
              </button>
              {busy && (
                <button className="btn btn-sm" onClick={abortOp}
                  style={{ color: '#ff9800', borderColor: '#ff9800' }} title="Abort the running operation">
                  ✕ Abort
                </button>
              )}
            </div>
          </div>
          {(opStatus || opOutput) && (
            <div style={{ marginTop: 8, borderRadius: 8, overflow: 'hidden', border: '1px solid #333' }}>
              <div style={{ background: '#2d2d2d', padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #3a3a3a' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57', display: 'inline-block' }} />
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e', display: 'inline-block' }} />
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840', display: 'inline-block' }} />
                <span style={{ fontSize: 12, color: '#aaa', marginLeft: 4, flex: 1, textTransform: 'capitalize' }}>
                  {opKind || 'artemis'} — Log
                </span>
                {busy && <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5, borderColor: '#888 transparent transparent transparent' }} />}
                {opStatus === 'success' && <span style={{ fontSize: 11, color: '#4caf50', fontWeight: 600 }}>✓ Done</span>}
                {opStatus === 'aborted' && <span style={{ fontSize: 11, color: '#ff9800', fontWeight: 600 }}>⚠ Aborted</span>}
                {opStatus === 'failed'  && <span style={{ fontSize: 11, color: '#f44336', fontWeight: 600 }}>✗ Failed</span>}
                {opOutput && (
                  <button onClick={() => { navigator.clipboard.writeText(opOutput).catch(() => {}); setLogCopied(true); setTimeout(() => setLogCopied(false), 2000) }}
                    title="Copy log to clipboard"
                    style={{ background: 'none', border: '1px solid #444', borderRadius: 4, cursor: 'pointer', color: logCopied ? '#4caf50' : '#888', fontSize: 11, padding: '1px 7px', lineHeight: 1.6 }}>
                    {logCopied ? '✓ Copied' : 'Copy'}
                  </button>
                )}
                {opStatus !== 'running' && (
                  <button onClick={() => { stopLogPoll(); setOpStatus(null); setOpOutput(''); setOpKind(null); setOpErr(null) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 16, lineHeight: 1, padding: '0 2px', marginLeft: 4 }}>✕</button>
                )}
              </div>
              <ColoredTerminal output={opOutput || (busy ? '' : ' ')} termRef={termRef}
                maxHeight={280} fontSize={12}
                style={{ minHeight: 100, fontFamily: '"Cascadia Code","Fira Mono","Consolas",monospace', lineHeight: 1.65, padding: '12px 14px' }} />
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {artemisUp === true
            ? <SharedQueuesPanel vmIp={vmIp} appName={appName} />
            : (
              <div className="card" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>⏹</div>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Artemis Not Running</div>
                <div style={{ fontSize: 13 }}>Start Artemis to browse queues.</div>
              </div>
            )
          }
        </div>
      </div>
    </div>
  )
}

// ── Full API Tab (SOAP/REST service browser) ──────────────────────────────────
function rSoapTemplate(op, namespace) {
  const ns = namespace || 'ns'
  const shortNs = ns.split('/').pop() || 'tns'
  return `<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:${shortNs}="${ns}">
  <soapenv:Header/>
  <soapenv:Body>
    <${shortNs}:${op}>
      <!-- add parameters here -->
    </${shortNs}:${op}>
  </soapenv:Body>
</soapenv:Envelope>`
}

function rPreprocessXml(xml) {
  const result = []; let i = 0
  while (i < xml.length) {
    const gtPos = xml.indexOf('>', i)
    if (gtPos === -1) { result.push(xml.slice(i)); break }
    result.push(xml.slice(i, gtPos + 1))
    const ltPos = xml.indexOf('<', gtPos + 1)
    if (ltPos === -1) { result.push(xml.slice(gtPos + 1)); break }
    const text = xml.slice(gtPos + 1, ltPos)
    result.push(text.includes('&lt;')
      ? text.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'")
      : text)
    i = ltPos
  }
  return result.join('')
}

function rPrettyXml(xml) {
  const INDENT = '  '; let depth = 0
  return xml.replace(/>\s*</g, '>\n<').split('\n').map(raw => {
    const t = raw.trim()
    if (!t) return ''
    if (t.startsWith('</')) { depth = Math.max(0, depth - 1); return INDENT.repeat(depth) + t }
    const line = INDENT.repeat(depth) + t
    if (!t.startsWith('<?') && !t.startsWith('<!') && !t.endsWith('/>') && !/<[^>]+>.*<\/[^>]+>/.test(t) && !t.includes('</')) depth++
    return line
  }).filter(Boolean).join('\n')
}

function RXmlHighlight2({ xml }) {
  const TAG_OPEN = '#4ec9b0', TAG_ANGLE = '#808080', ATTR_NAME = '#9cdcfe', ATTR_VAL = '#ce9178', COMMENT = '#6a9955', TEXT = 'var(--text)'
  const tokenRe = /(<\/[\w:.-]+\s*>|<!--[\s\S]*?-->|<[\s\S]*?>|[^<]+)/g
  const parts = []; let key = 0, m
  while ((m = tokenRe.exec(xml)) !== null) {
    const tok = m[0]
    if (tok.startsWith('<!--')) { parts.push(<span key={key++} style={{ color: COMMENT }}>{tok}</span>); continue }
    if (!tok.startsWith('<')) { const t = tok.trim(); parts.push(<span key={key++} style={t ? { color: TEXT } : {}}>{tok}</span>); continue }
    const inner = tok.slice(1, tok.endsWith('/>') ? -2 : tok.endsWith('>') ? -1 : tok.length)
    const isClose = inner.startsWith('/')
    const nameMatch = inner.match(/^\/?([\w:.-]+)/), tagName = nameMatch ? nameMatch[1] : ''
    const rest = nameMatch ? inner.slice(nameMatch[0].length) : inner
    const attrRe = /([\w:.-]+)(\s*=\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g
    const attrParts = []; let last = 0, am
    while ((am = attrRe.exec(rest)) !== null) {
      if (am.index > last) attrParts.push(<span key={`r${key++}`} style={{ color: TAG_ANGLE }}>{rest.slice(last, am.index)}</span>)
      attrParts.push(<span key={`n${key++}`} style={{ color: ATTR_NAME }}>{am[1]}</span>)
      attrParts.push(<span key={`e${key++}`} style={{ color: TAG_ANGLE }}>{am[2]}</span>)
      attrParts.push(<span key={`v${key++}`} style={{ color: ATTR_VAL }}>{am[3]}</span>)
      last = am.index + am[0].length
    }
    if (last < rest.length) attrParts.push(<span key={`r${key++}`} style={{ color: TAG_ANGLE }}>{rest.slice(last)}</span>)
    parts.push(<span key={key++}><span style={{ color: TAG_ANGLE }}>{'<'}{isClose ? '/' : ''}</span><span style={{ color: TAG_OPEN }}>{tagName}</span>{attrParts}<span style={{ color: TAG_ANGLE }}>{tok.endsWith('/>') ? '/>' : '>'}</span></span>)
  }
  return <>{parts}</>
}

function RCopyButton2({ text }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text || '').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {}) }}
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px', fontSize: 11, color: copied ? '#4caf50' : 'var(--text-muted)', lineHeight: 1 }}>
      {copied ? '✓ Copied' : '⎘ Copy'}
    </button>
  )
}

function RCurlCopyButton2({ url, method, headers, body }) {
  const [copied, setCopied] = useState(false)
  function buildCurl() {
    const parts = ['curl', '-s', '-X', method]
    Object.entries(headers || {}).forEach(([k, v]) => parts.push('-H', `'${k}: ${v}'`))
    if (body && !['GET', 'HEAD'].includes(method)) parts.push('--data', `'${body.replace(/'/g, "'\\''")}'`)
    parts.push(`'${url}'`)
    return parts.join(' ')
  }
  return (
    <button className="btn btn-sm" onClick={() => { navigator.clipboard.writeText(buildCurl()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {}) }}
      style={{ fontSize: 11 }}>
      {copied ? '✓ Copied' : '⌘ Copy as cURL'}
    </button>
  )
}

function SharedRequestBuilder({ svc, op, type, appName, onClose }) {
  const isSoap = type === 'soap'
  const apiName = svc.name
  const version = `remote_${appName}`

  const [url,          setUrl]          = useState(svc.endpoint || '')
  const [method,       setMethod]       = useState(isSoap ? 'POST' : 'GET')
  const [authType,     setAuthType]     = useState('none')
  const [bearerToken,  setBearerToken]  = useState('')
  const [basicUser,    setBasicUser]    = useState('')
  const [basicPass,    setBasicPass]    = useState('')
  const [showPass,     setShowPass]     = useState(false)
  const [preemptive,   setPreemptive]   = useState('global')
  const [body,         setBody]         = useState(isSoap ? rSoapTemplate(op, svc.namespace) : '')
  const [busy,         setBusy]         = useState(false)
  const [response,     setResponse]     = useState(null)
  const [reqErr,       setReqErr]       = useState(null)
  const [savedList,    setSavedList]    = useState([])
  const [loadMenuOpen, setLoadMenuOpen] = useState(false)
  const [loadedId,     setLoadedId]     = useState(null)
  const [saveMsg,      setSaveMsg]      = useState(null)
  const [authSaveMsg,  setAuthSaveMsg]  = useState(null)

  useEffect(() => { // eslint-disable-line react-hooks/exhaustive-deps
    fetch(`/api/local-app/${appName}/api-auth/load`)
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.found) {
          setAuthType(d.authType || 'none'); setBearerToken(d.bearerToken || '')
          setBasicUser(d.username || ''); setBasicPass(d.password || '')
        }
      })
      .catch(() => {})
  }, [])

  function saveAuth() {
    fetch(`/api/local-app/${appName}/api-auth/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authType, username: basicUser, password: basicPass, bearerToken }),
    })
      .then(r => r.json())
      .then(d => { setAuthSaveMsg(d.ok ? { ok: true, text: 'Auth saved' } : { ok: false, text: d.error || 'Failed' }); setTimeout(() => setAuthSaveMsg(null), 2500) })
      .catch(() => setAuthSaveMsg({ ok: false, text: 'Could not reach server' }))
  }

  function toXml() {
    const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    return `<?xml version="1.0" encoding="UTF-8"?>\n<request>\n` +
      `  <url>${esc(url)}</url>\n  <method>${esc(method)}</method>\n` +
      `  <authType>${esc(authType)}</authType>\n  <bearerToken>${esc(bearerToken)}</bearerToken>\n` +
      `  <basicUser>${esc(basicUser)}</basicUser>\n  <basicPass>${esc(basicPass)}</basicPass>\n` +
      `  <preemptive>${esc(preemptive)}</preemptive>\n  <body><![CDATA[${body}]]></body>\n</request>`
  }

  function fromXml(xml) {
    const get = tag => { const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)); return m ? m[1] : '' }
    const getCdata = tag => { const m = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`)); return m ? m[1] : get(tag) }
    const unesc = s => s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    setUrl(unesc(get('url'))); setMethod(get('method') || (isSoap ? 'POST' : 'GET'))
    setAuthType(get('authType') || 'none'); setBearerToken(unesc(get('bearerToken')))
    setBasicUser(unesc(get('basicUser'))); setBasicPass(unesc(get('basicPass')))
    setPreemptive(get('preemptive') || 'global'); setBody(getCdata('body'))
  }

  function loadSavedList() {
    fetch(`/api/local-app/${appName}/api-requests?scope=remote&version=${encodeURIComponent(version)}&api=${encodeURIComponent(apiName)}&method=${encodeURIComponent(op)}`)
      .then(r => r.json()).then(d => { if (d.ok) setSavedList(d.requests || []) }).catch(() => {})
  }

  function doLoad(id) {
    setLoadMenuOpen(false)
    fetch(`/api/local-app/${appName}/api-requests/load?scope=remote&version=${encodeURIComponent(version)}&api=${encodeURIComponent(apiName)}&id=${encodeURIComponent(id)}`)
      .then(r => r.json()).then(d => { if (d.ok) { fromXml(d.content); setLoadedId(id) } }).catch(() => {})
  }

  function doSave() {
    const now = new Date()
    const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`
    fetch(`/api/local-app/${appName}/api-requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'remote', version, api: apiName, id: `${op}_${ts}`, content: toXml() }),
    })
      .then(r => r.json())
      .then(d => { setSaveMsg(d.ok ? { ok: true, text: `Saved as "${op}_${ts}"` } : { ok: false, text: d.error }); if (d.ok) loadSavedList(); setTimeout(() => setSaveMsg(null), 3000) })
      .catch(() => setSaveMsg({ ok: false, text: 'Could not reach server' }))
  }

  function doDelete(id, { clearLoaded = false } = {}) {
    fetch(`/api/local-app/${appName}/api-requests`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'remote', version, api: apiName, id }),
    })
      .then(r => r.json()).then(d => { if (d.ok) { loadSavedList(); if (clearLoaded) doClear() } }).catch(() => {})
  }

  function doClear() {
    setUrl(svc.endpoint || ''); setMethod(isSoap ? 'POST' : 'GET')
    setAuthType('none'); setBearerToken(''); setBasicUser(''); setBasicPass('')
    setPreemptive('global'); setBody(isSoap ? rSoapTemplate(op, svc.namespace) : '')
    setResponse(null); setReqErr(null); setLoadedId(null)
  }

  function buildHeaders() {
    const h = {}
    if (isSoap) { h['Content-Type'] = 'text/xml; charset=utf-8'; h['SOAPAction'] = '""' }
    else if (body.trim().startsWith('{') || body.trim().startsWith('[')) h['Content-Type'] = 'application/json'
    if (authType === 'bearer' && bearerToken.trim()) {
      h['Authorization'] = `Bearer ${bearerToken.trim()}`
    } else if (authType === 'basic') {
      if ((preemptive === 'preemptive' || preemptive === 'global') && (basicUser || basicPass))
        h['Authorization'] = `Basic ${btoa(`${basicUser}:${basicPass}`)}`
    }
    return h
  }

  function submit() {
    setBusy(true); setReqErr(null); setResponse(null)
    fetch('/api/proxy-request', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, method, headers: buildHeaders(), body: ['GET', 'HEAD'].includes(method) ? null : body }),
    })
      .then(r => r.json())
      .then(d => { if (d.ok) setResponse({ status: d.status, body: d.body, isOk: d.status < 400 }); else setReqErr(d.error || 'Request failed') })
      .catch(() => setReqErr('Could not reach server'))
      .finally(() => setBusy(false))
  }

  const inp = { fontSize: 12, padding: '5px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }

  return (
    <div style={{ margin: '4px 0 0 0', padding: '14px 16px', borderTop: '2px solid var(--primary)', background: 'var(--surface2)', borderRadius: '0 0 6px 6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: 13, fontFamily: 'monospace', color: 'var(--primary)' }}>{op}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>— Request Builder</span>
        <button className="btn btn-sm" onClick={onClose} style={{ marginLeft: 'auto', fontSize: 11 }}>✕ Close</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap', position: 'relative' }}>
        <div style={{ position: 'relative' }}>
          <button className="btn btn-sm" onClick={() => { loadSavedList(); setLoadMenuOpen(o => !o) }}
            style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
            📂 Load {loadMenuOpen ? '▴' : '▾'}
          </button>
          {loadMenuOpen && (
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 100, marginTop: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, minWidth: 220, boxShadow: '0 4px 16px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
              {savedList.length === 0
                ? <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)' }}>No saved requests</div>
                : savedList.map(r => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--border)', background: 'transparent' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(88,166,255,0.06)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <button onClick={() => doLoad(r.id)} style={{ flex: 1, textAlign: 'left', fontSize: 12, fontFamily: 'monospace', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', padding: 0 }}>{r.name}</button>
                    <button onClick={() => doDelete(r.id)} style={{ fontSize: 11, color: '#f44336', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', flexShrink: 0 }} title="Delete">✕</button>
                  </div>
                ))}
            </div>
          )}
        </div>
        <button className="btn btn-sm" onClick={() => { doSave(); setLoadMenuOpen(false) }} style={{ fontSize: 11 }}>💾 Save</button>
        <button className="btn btn-sm" onClick={doClear} style={{ fontSize: 11 }}>🗑 Clear</button>
        <RCurlCopyButton2 url={url} method={method} headers={buildHeaders()} body={body} />
        {saveMsg && <span style={{ fontSize: 12, color: saveMsg.ok ? '#4caf50' : '#f44336' }}>{saveMsg.ok ? '✓' : '✗'} {saveMsg.text}</span>}
        {loadMenuOpen && <div onClick={() => setLoadMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        {!isSoap && (
          <select value={method} onChange={e => setMethod(e.target.value)} style={{ ...inp, flexShrink: 0 }}>
            {['GET','POST','PUT','PATCH','DELETE'].map(m => <option key={m}>{m}</option>)}
          </select>
        )}
        <input type="text" value={url} onChange={e => setUrl(e.target.value)} placeholder="Endpoint URL"
          style={{ ...inp, flex: 1, fontFamily: 'monospace' }} />
        <RCopyButton2 text={url} />
      </div>
      <div style={{ marginBottom: 10, padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: authType === 'none' ? 0 : 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0, fontWeight: 600 }}>Authentication:</span>
          <select value={authType} onChange={e => setAuthType(e.target.value)} style={{ ...inp, flexShrink: 0 }}>
            <option value="none">None</option>
            <option value="bearer">Bearer Token</option>
            <option value="basic">Basic Auth</option>
          </select>
        </div>
        {authType === 'bearer' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0, width: 56 }}>Token:</span>
            <input type="text" value={bearerToken} onChange={e => setBearerToken(e.target.value)} placeholder="Paste Bearer token…" style={{ ...inp, flex: 1, fontFamily: 'monospace' }} />
          </div>
        )}
        {authType === 'basic' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '70px minmax(0, 240px)', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Username:</span>
              <input type="text" value={basicUser} onChange={e => setBasicUser(e.target.value)} placeholder="Username" style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Password:</span>
              <div style={{ position: 'relative', width: '100%', boxSizing: 'border-box' }}>
                <input type={showPass ? 'text' : 'password'} value={basicPass} onChange={e => setBasicPass(e.target.value)} placeholder="Password"
                  style={{ ...inp, width: '100%', boxSizing: 'border-box', paddingRight: 28 }} />
                <button onClick={() => setShowPass(v => !v)} tabIndex={-1}
                  style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1 }}>
                  {showPass ? '🙈' : '👁'}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0, width: 70 }}>Pre-emptive:</span>
              <div style={{ display: 'flex', gap: 16 }}>
                {[{ val: 'global', label: 'Use Global Preference' }, { val: 'preemptive', label: 'Authenticate Pre-emptively' }].map(opt => (
                  <label key={opt.val} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text)', cursor: 'pointer' }}>
                    <input type="radio" name={`preemptive-${op}`} value={opt.val} checked={preemptive === opt.val} onChange={() => setPreemptive(opt.val)} style={{ accentColor: 'var(--primary)', cursor: 'pointer' }} />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
        {authType !== 'none' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <button className="btn btn-sm" onClick={saveAuth} style={{ fontSize: 11 }}>💾 Save Auth</button>
            {authSaveMsg && <span style={{ fontSize: 11, color: authSaveMsg.ok ? '#4caf50' : '#f44336' }}>{authSaveMsg.text}</span>}
          </div>
        )}
      </div>
      {(isSoap || !['GET', 'HEAD'].includes(method)) && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{isSoap ? 'SOAP Envelope (XML)' : 'Request Body'}</span>
            <RCopyButton2 text={body} />
          </div>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={isSoap ? 10 : 6}
            style={{ ...inp, width: '100%', fontFamily: 'monospace', resize: 'vertical', padding: '8px 10px', boxSizing: 'border-box' }} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: response || reqErr ? 12 : 0 }}>
        <button className="btn btn-sm btn-primary" onClick={submit} disabled={busy || !url.trim()}>
          {busy ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Sending…</> : `▶ Submit ${isSoap ? 'SOAP' : method} Request`}
        </button>
        {response && <span style={{ fontSize: 12, fontWeight: 600, color: response.isOk ? '#4caf50' : '#f44336' }}>HTTP {response.status}</span>}
        {loadedId && (
          <button className="btn btn-sm" onClick={() => doDelete(loadedId, { clearLoaded: true })}
            style={{ fontSize: 11, color: '#f44336', borderColor: 'rgba(244,67,54,0.4)' }}>
            🗑 Delete Saved Request
          </button>
        )}
      </div>
      {reqErr && <div className="alert alert-error" style={{ fontSize: 12, marginBottom: 10 }}>{reqErr}</div>}
      {response && (() => {
        const isXml = response.body?.trimStart().startsWith('<')
        const displayBody = isXml ? rPrettyXml(rPreprocessXml(response.body)) : response.body
        return (
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Response</span><RCopyButton2 text={response.body} />
            </div>
            <pre style={{ margin: 0, padding: '10px 12px', borderRadius: 6, fontSize: 11, fontFamily: 'monospace', lineHeight: 1.6, overflowX: 'auto', maxHeight: 400, overflowY: 'auto', background: '#1e1e1e', color: 'var(--text)', border: `1px solid ${response.isOk ? 'rgba(76,175,80,0.4)' : 'rgba(244,67,54,0.4)'}` }}>
              {isXml ? <RXmlHighlight2 xml={displayBody} /> : displayBody}
            </pre>
          </div>
        )
      })()}
    </div>
  )
}

function SharedServiceRow({ svc, type, appName }) {
  const [open,     setOpen]     = useState(false)
  const [activeOp, setActiveOp] = useState(null)
  const shortName = svc.name.replace(/(?:StronglyTyped|WeaklyTyped)Type$/, '')
  const isRest = type === 'rest'
  const badge = isRest
    ? { bg: '#2e7d32', color: '#fff', label: 'REST' }
    : { bg: '#1565c0', color: '#fff', label: 'SOAP' }
  const restDirect = isRest && svc.ops.length === 0

  function selectOp(op) { setActiveOp(prev => prev === op ? null : op) }

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', userSelect: 'none', background: open ? 'rgba(59,130,246,0.04)' : 'transparent' }}>
        <span style={{ fontSize: 11, width: 8, color: 'var(--text-muted)', flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: badge.bg, color: badge.color, flexShrink: 0, letterSpacing: '0.03em' }}>{badge.label}</span>
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortName}</span>
        {!restDirect && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{svc.ops.length} op{svc.ops.length !== 1 ? 's' : ''}</span>
        )}
        {svc.wsdl && (
          <a href={svc.wsdl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
            style={{ fontSize: 11, color: '#1976d2', flexShrink: 0, textDecoration: 'none', padding: '2px 8px', border: '1px solid rgba(25,118,210,0.4)', borderRadius: 4, background: 'rgba(25,118,210,0.07)' }}>
            {isRest ? 'WADL ↗' : 'WSDL ↗'}
          </a>
        )}
        {svc.endpoint && (
          <a href={svc.endpoint} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
            style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, textDecoration: 'none', padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 4 }}>
            Endpoint ↗
          </a>
        )}
      </div>
      {open && (
        <div style={{ padding: '8px 12px 8px 32px', background: 'rgba(59,130,246,0.04)' }}>
          {svc.namespace && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontFamily: 'monospace' }}>ns: {svc.namespace}</div>
          )}
          {restDirect ? (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontFamily: 'monospace' }}>
                {svc.endpoint}
              </div>
              <button
                onClick={() => setActiveOp(prev => prev ? null : shortName)}
                style={{
                  fontSize: 11, padding: '4px 12px', borderRadius: 4, cursor: 'pointer', marginBottom: 8,
                  border: activeOp ? '1px solid var(--primary)' : '1px solid var(--border)',
                  background: activeOp ? 'var(--primary)' : 'var(--surface)',
                  color: activeOp ? '#fff' : 'var(--text)',
                  fontWeight: activeOp ? 600 : 400, transition: 'all 0.15s',
                }}>
                {activeOp ? '✕ Close Request Builder' : '▶ Build Request'}
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Click an operation to build a request:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 8px', marginBottom: 8 }}>
                {svc.ops.map(op => (
                  <button key={op} onClick={() => selectOp(op)} style={{
                    fontSize: 11, fontFamily: 'monospace', padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
                    border: activeOp === op ? '1px solid var(--primary)' : '1px solid var(--border)',
                    background: activeOp === op ? 'var(--primary)' : 'var(--surface)',
                    color: activeOp === op ? '#fff' : 'var(--text)',
                    fontWeight: activeOp === op ? 600 : 400, transition: 'all 0.15s',
                  }}>{op}</button>
                ))}
              </div>
            </>
          )}
          {activeOp && (
            <SharedRequestBuilder key={activeOp} svc={svc} op={activeOp} type={type} appName={appName} onClose={() => setActiveOp(null)} />
          )}
        </div>
      )}
    </div>
  )
}

export function RemoteFullApiTab({ vmIp, appName, serverUp }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState(null)
  const [filter,  setFilter]  = useState('')

  function load() {
    setLoading(true)
    fetch(`/api/remote-app/${appName}/web-services?vm_ip=${encodeURIComponent(vmIp)}`)
      .then(r => r.json())
      .then(d => { if (d.ok) { setData(d); setErr(null) } else setErr(d.error) })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { if (serverUp !== false) load() }, [vmIp, serverUp])

  const q     = filter.toLowerCase()
  const match = svc =>
    !q || svc.name.toLowerCase().includes(q) ||
    svc.ops.some(op => op.toLowerCase().includes(q)) ||
    svc.endpoint.toLowerCase().includes(q)

  const soap = (data?.soap || []).filter(match)
  const rest  = (data?.rest  || []).filter(match)

  if (serverUp === false) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 28, marginBottom: 10 }}>⏹</div>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>App Server Not Running</div>
        <div style={{ fontSize: 13 }}>Start the server to browse available APIs.</div>
      </div>
    )
  }

  return (
    <div>
      <RemoteDeployedBanner vmIp={vmIp} appName={appName} serverUp={serverUp} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <input type="text" placeholder="Filter by service name or operation…"
          value={filter} onChange={e => setFilter(e.target.value)}
          style={{ flex: 1, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 10px', fontSize: 13 }} />
        <button onClick={load} disabled={loading} className="btn btn-sm" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          {loading ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> : '↻ Refresh'}
        </button>
        {data?.url && (
          <a href={data.url} target="_blank" rel="noreferrer" className="btn btn-sm" style={{ fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap' }}>
            Open in Browser ↗
          </a>
        )}
      </div>
      {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}
      {loading && !data ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>SOAP Services</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{soap.length} service{soap.length !== 1 ? 's' : ''}</span>
            </div>
            {soap.length === 0
              ? <div style={{ padding: '20px 14px', color: 'var(--text-muted)', fontSize: 13 }}>{filter ? 'No matches' : 'None available'}</div>
              : soap.map(svc => <SharedServiceRow key={svc.name} svc={svc} type="soap" appName={appName} />)}
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>RESTful Services</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{rest.length} service{rest.length !== 1 ? 's' : ''}</span>
            </div>
            {rest.length === 0
              ? <div style={{ padding: '20px 14px', color: 'var(--text-muted)', fontSize: 13 }}>{filter ? 'No matches' : 'None available'}</div>
              : rest.map(svc => <SharedServiceRow key={svc.name} svc={svc} type="rest" appName={appName} />)}
          </div>
        </>
      )}
    </div>
  )
}

// ── User Interface Tab (ClickOnce UI apps) ────────────────────────────────────
const _UI_APP_ICONS = { manager: '🖥️', designer: '✏️', admin: '🔐' }

// Extract "major.minor" from any version format so that "27.1", "release-27.1.0.3",
// and "27.1.0.0" all compare as equal (same release line).
function _vMajorMinor(v) {
  const m = v && String(v).match(/(\d+)\.(\d+)/)
  return m ? `${m[1]}.${m[2]}` : (v || '')
}

function _fmtTime(s) {
  if (!s || s < 0) return '0s'
  const t = Math.round(s)
  return t < 60 ? `${t}s` : `${Math.floor(t / 60)}m ${t % 60}s`
}
function _fmtSpeed(bps) {
  if (!bps || bps <= 0) return ''
  if (bps < 1048576) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / 1048576).toFixed(1)} MB/s`
}
function _GlossyBar({ percent, label }) {
  const pct = Math.min(100, Math.max(0, percent || 0))
  return (
    <div style={{ width: '100%', height: 22, borderRadius: 11, background: '#e8f5e9', overflow: 'hidden', position: 'relative', border: '1px solid #c8e6c9' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${pct}%`,
                    background: 'linear-gradient(to bottom, #81c784 0%, #388e3c 45%, #2e7d32 46%, #43a047 100%)',
                    borderRadius: 11, transition: 'width 0.35s ease', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '48%',
                      background: 'linear-gradient(to bottom,rgba(255,255,255,.42),rgba(255,255,255,.05))',
                      borderRadius: '11px 11px 0 0' }} />
      </div>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, zIndex: 1,
                    color: pct > 45 ? '#fff' : '#2e7d32', textShadow: pct > 45 ? '0 1px 2px rgba(0,0,0,.25)' : 'none' }}>
        {label}
      </div>
    </div>
  )
}

function _UiAppTile({ app, op, openErr, deployedVersion, onDownload, onRunInstaller, onDeleteInstaller, onOpen, onOpenFolder, onUninstall, onAbort, onAbortDownload, onDismissErr }) {
  const icon  = _UI_APP_ICONS[app.app_id] || '📦'
  const phase = op?.phase
  const isDownloading = phase === 'downloading'
  const isInstalling  = phase === 'installing'
  const isInstalled   = (app.installed || phase === 'installed') && phase !== 'installing'
  const dlPct   = op?.percent || 0
  const dlLabel = isDownloading ? `${Math.round(dlPct)}%${op?.speed ? ` • ${_fmtSpeed(op.speed)}` : ''}` : `${Math.round(dlPct)}%`
  const instEst     = op?.estimated || 120
  const instElapsed = op?.elapsed || 0
  const instPct     = op?.percent != null ? op.percent : Math.min(97, (instElapsed / instEst) * 100)
  const instLabel   = op?.phase_label ? `${op.phase_label}${op.percent != null ? ` (${Math.round(op.percent)}%)` : ''}` : `Installing… ${_fmtTime(instElapsed)}`
  const versionMismatch = !!(deployedVersion && deployedVersion !== 'master' && app.version && app.version !== 'unknown' && _vMajorMinor(app.version) !== _vMajorMinor(deployedVersion))
  const statusText  = versionMismatch && isInstalled ? '⚠ Outdated' : isInstalled ? '✓ Installed' : app.downloaded ? '↓ Downloaded' : 'Not installed'
  const statusColor = versionMismatch && isInstalled ? '#e65100' : isInstalled ? '#2e7d32' : app.downloaded ? '#f57c00' : '#9e9e9e'

  return (
    <div style={{ width: 300, border: `1px solid ${versionMismatch && isInstalled ? '#ffb74d' : '#dde2ea'}`, borderRadius: 10, padding: 18, background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.06)', display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 28 }}>{icon}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{app.display_name}</div>
          <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2, color: statusColor }}>
            {statusText}
          </div>
          {app.version && app.version !== 'unknown' && (
            <div style={{ fontSize: 11, color: versionMismatch ? '#e65100' : '#888', marginTop: 1 }}>
              v{app.version}{versionMismatch ? <span style={{ color: '#9e9e9e' }}> — server: v{deployedVersion}</span> : null}
            </div>
          )}
        </div>
      </div>
      {versionMismatch && isInstalled && (
        <div style={{ fontSize: 11, color: '#e65100', background: '#fff3e0', borderRadius: 4, padding: '4px 8px', lineHeight: 1.4 }}>
          UI v{deployedVersion} is not available yet. Installed v{app.version} may be incompatible.
        </div>
      )}
      {isDownloading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <_GlossyBar percent={dlPct} label={dlLabel} />
          <div style={{ fontSize: 11, color: '#555', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>⏱ {_fmtTime(op?.elapsed)}</span>
            {op?.remaining != null && <span>~{_fmtTime(op.remaining)} left</span>}
            <button onClick={onAbortDownload} style={{ fontSize: 10, padding: '2px 8px', background: '#ffebee', color: '#c62828', border: '1px solid #e57373', borderRadius: 4, cursor: 'pointer' }}>Abort</button>
          </div>
        </div>
      )}
      {isInstalling && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <_GlossyBar percent={instPct} label={instLabel} />
          <div style={{ fontSize: 11, color: '#555', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>⏱ {_fmtTime(instElapsed)}</span>
            <span>~{_fmtTime(Math.max(0, instEst - instElapsed))} left</span>
            <button onClick={onAbort} style={{ fontSize: 10, padding: '2px 8px', background: '#ffebee', color: '#c62828', border: '1px solid #e57373', borderRadius: 4, cursor: 'pointer' }}>Abort</button>
          </div>
        </div>
      )}
      {op?.warning && phase === 'installed' && <div style={{ fontSize: 11, color: '#e65100', background: '#fff3e0', borderRadius: 4, padding: '4px 8px' }}>{op.warning}</div>}
      {isInstalled && op?.phase === 'installed' && (
        <div style={{ fontSize: 11, color: '#2e7d32', background: '#e8f5e9', borderRadius: 4, padding: '4px 8px' }}>✓ Installation complete</div>
      )}
      {phase === 'error' && (
        <div style={{ fontSize: 12, color: '#c62828', background: '#ffebee', borderRadius: 4, padding: '5px 8px', lineHeight: 1.4 }}>
          {op.error}
          {op.source_url && <div style={{ fontSize: 10, color: '#888', marginTop: 4, wordBreak: 'break-all' }}>URL: <code style={{ fontSize: 10 }}>{op.source_url}</code></div>}
          <button style={{ marginLeft: 8, fontSize: 11, color: '#888', background: 'none', border: 'none', cursor: 'pointer' }} onClick={onDismissErr}>✕</button>
        </div>
      )}
      {openErr && (
        <div style={{ fontSize: 11, borderRadius: 4, padding: '4px 8px', wordBreak: 'break-all', color: openErr.startsWith('✓') ? '#2e7d32' : '#c62828', background: openErr.startsWith('✓') ? '#e8f5e9' : '#ffebee' }}>
          {openErr}
        </div>
      )}
      {!isDownloading && !isInstalling && (
        <div style={{ display: 'flex', gap: 8 }}>
          {isInstalled ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
              <button className="btn btn-sm btn-primary" style={{ width: '100%' }} onClick={onOpen}>Open</button>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm" style={{ flex: 1, fontSize: 11, background: '#e8f5e9', color: '#2e7d32', borderColor: '#a5d6a7' }} onClick={onOpenFolder} title="Open install folder in Explorer">📂 Location</button>
                <button className="btn btn-sm" style={{ flex: 1, fontSize: 11, background: '#ffebee', color: '#c62828', borderColor: '#e57373' }} onClick={onUninstall}>🗑 Uninstall</button>
              </div>
            </div>
          ) : app.downloaded ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
              <button className="btn btn-sm btn-primary" style={{ width: '100%' }} onClick={onRunInstaller}>Run Installer</button>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm" style={{ flex: 1, fontSize: 11, background: '#e3f2fd', color: '#1565c0', borderColor: '#90caf9' }} onClick={onDownload}>↓ Re-download</button>
                <button className="btn btn-sm" style={{ flex: 1, fontSize: 11, background: '#ffebee', color: '#c62828', borderColor: '#e57373' }} onClick={onDeleteInstaller}>🗑 Delete</button>
              </div>
            </div>
          ) : (
            <button className="btn btn-sm btn-primary" style={{ flex: 1 }} onClick={onDownload}>Download</button>
          )}
        </div>
      )}
    </div>
  )
}

export function RemoteUserInterfaceTab({ vmIp, appName }) {
  const [apps, setApps]               = useState([])
  const [config, setConfig]           = useState({ base_url: '', version: '', installers_base: '', installed_base: '', ui_version: '' })
  const [loading, setLoading]         = useState(true)
  const [err, setErr]                 = useState(null)
  const [editConfig, setEditConfig]   = useState(false)
  const [draftConfig, setDraftConfig] = useState({})
  const [savingConfig, setSavingConfig] = useState(false)
  const [dlOps, setDlOps]             = useState({})
  const [openErr, setOpenErr]         = useState({})
  const pollRef                       = useRef({})

  const API = `/api/remote-app/${appName}/ui-apps`
  const qs  = `vm_ip=${encodeURIComponent(vmIp)}`

  const load = (silent = false) => {
    if (!silent) setLoading(true)
    fetch(`${API}?${qs}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setConfig(d.config); setApps(d.apps)
          if (!silent) {
            d.apps.forEach(app => {
              fetch(`${API}/${app.app_id}/install-progress?${qs}`)
                .then(r => r.json())
                .then(prog => {
                  if (prog.status === 'installing') {
                    setDlOps(p => ({ ...p, [app.app_id]: { ...prog, phase: 'installing' } }))
                    startPoll(app.app_id, `${API}/${app.app_id}/install-progress?${qs}`, 1000, (result) => {
                      const done = result.status === 'done'
                      setDlOps(p => ({ ...p, [app.app_id]: { ...p[app.app_id], phase: done ? 'installed' : 'error', error: !done ? (result.error || 'Installation failed') : null, warning: result.warning || null } }))
                      load(true)
                    })
                  } else {
                    fetch(`${API}/${app.app_id}/download/progress?${qs}`)
                      .then(r => r.json())
                      .then(dlProg => {
                        if (['downloading', 'starting'].includes(dlProg.status)) {
                          setDlOps(p => ({ ...p, [app.app_id]: { ...dlProg, phase: 'downloading' } }))
                          startPoll(app.app_id, `${API}/${app.app_id}/download/progress?${qs}`, 600, (result) => {
                            if (result.status === 'done') {
                              setDlOps(p => ({ ...p, [app.app_id]: { ...p[app.app_id], phase: 'downloaded' } }))
                              load(true)
                            } else if (result.status === 'aborted') {
                              setDlOps(p => ({ ...p, [app.app_id]: { phase: 'error', error: 'Download aborted' } }))
                            } else {
                              setDlOps(p => ({ ...p, [app.app_id]: { phase: 'error', error: result.error || 'Download failed' } }))
                            }
                          })
                        }
                      }).catch(() => {})
                  }
                }).catch(() => {})
            })
          }
        } else if (!silent) setErr(d.error)
      })
      .catch(e => { if (!silent) setErr(String(e)) })
      .finally(() => { if (!silent) setLoading(false) })
  }

  useEffect(() => { load(false) }, [vmIp])
  useEffect(() => () => { Object.values(pollRef.current).forEach(clearInterval) }, [])

  const stopPoll = (appId) => {
    if (pollRef.current[appId]) { clearInterval(pollRef.current[appId]); delete pollRef.current[appId] }
  }
  const startPoll = (appId, endpoint, ms, onDone) => {
    stopPoll(appId)
    pollRef.current[appId] = setInterval(() => {
      fetch(endpoint).then(r => r.json()).then(d => {
        setDlOps(p => ({ ...p, [appId]: { ...(p[appId] || {}), ...d } }))
        if (['done', 'timeout', 'error', 'aborted'].includes(d.status)) { stopPoll(appId); onDone(d) }
      }).catch(() => {})
    }, ms)
  }

  const doDownload = (app) => {
    setDlOps(p => ({ ...p, [app.app_id]: { phase: 'downloading', status: 'starting', percent: 0 } }))
    fetch(`${API}/${app.app_id}/download?${qs}`, { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) { setDlOps(p => ({ ...p, [app.app_id]: { phase: 'error', error: d.error } })); return }
        startPoll(app.app_id, `${API}/${app.app_id}/download/progress?${qs}`, 600, (result) => {
          if (result.status === 'done') { setDlOps(p => ({ ...p, [app.app_id]: { ...p[app.app_id], phase: 'downloaded' } })); load(true) }
          else if (result.status === 'aborted') setDlOps(p => ({ ...p, [app.app_id]: { phase: 'error', error: 'Download aborted' } }))
          else setDlOps(p => ({ ...p, [app.app_id]: { phase: 'error', error: result.error || 'Download failed' } }))
        })
      })
      .catch(e => setDlOps(p => ({ ...p, [app.app_id]: { phase: 'error', error: String(e) } })))
  }

  const doRunInstaller = (app) => {
    setDlOps(p => ({ ...p, [app.app_id]: { phase: 'installing', status: 'installing', elapsed: 0 } }))
    fetch(`${API}/${app.app_id}/run-installer?${qs}`, { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) { setDlOps(p => ({ ...p, [app.app_id]: { phase: 'error', error: d.error } })); return }
        startPoll(app.app_id, `${API}/${app.app_id}/install-progress?${qs}`, 1000, (result) => {
          const done = result.status === 'done', aborted = result.status === 'aborted'
          setDlOps(p => ({ ...p, [app.app_id]: { ...p[app.app_id], phase: done ? 'installed' : 'error', error: (!done && !aborted) ? (result.error || 'Installation failed') : (aborted ? 'Aborted' : null), warning: result.warning || null } }))
          load(true)
        })
      })
      .catch(e => setDlOps(p => ({ ...p, [app.app_id]: { phase: 'error', error: String(e) } })))
  }

  const doAbort         = (app) => fetch(`${API}/${app.app_id}/install/abort?${qs}`,  { method: 'POST' }).catch(() => {})
  const doAbortDownload = (app) => fetch(`${API}/${app.app_id}/download/abort?${qs}`, { method: 'POST' }).catch(() => {})
  const doOpenFolder    = (app) => { fetch(`${API}/${app.app_id}/open-folder?${qs}`, { method: 'POST' }).then(r => r.json()).then(d => { if (!d.ok) setOpenErr(p => ({ ...p, [app.app_id]: d.error })) }).catch(() => {}) }
  const doDeleteInstaller = (app) => { fetch(`${API}/${app.app_id}/installer?${qs}`, { method: 'DELETE' }).then(r => r.json()).then(d => { if (d.ok) load(true) }).catch(() => {}) }
  const doOpen = (app) => {
    fetch(`${API}/${app.app_id}/open?${qs}`, { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (!d.ok) setOpenErr(p => ({ ...p, [app.app_id]: d.error })); else if (d.message) setOpenErr(p => ({ ...p, [app.app_id]: `✓ ${d.message}` })) })
      .catch(e => setOpenErr(p => ({ ...p, [app.app_id]: String(e) })))
  }
  const doUninstall = (app) => {
    if (!confirm(`Uninstall ${app.display_name}?`)) return
    fetch(`${API}/${app.app_id}/uninstall?${qs}`, { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (!d.ok) { setOpenErr(p => ({ ...p, [app.app_id]: d.error })); return }; setDlOps(p => ({ ...p, [app.app_id]: null })); load(true) })
      .catch(e => setOpenErr(p => ({ ...p, [app.app_id]: String(e) })))
  }

  const saveConfig = () => {
    setSavingConfig(true)
    fetch(`${API}/config?${qs}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vm_ip: vmIp, ...draftConfig }),
    })
      .then(r => r.json())
      .then(d => { if (d.ok) { setConfig(d.config); setApps(d.apps); setEditConfig(false); setDraftConfig({}) } else alert(d.error) })
      .catch(e => alert(String(e)))
      .finally(() => setSavingConfig(false))
  }

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>
  if (err)     return <div style={{ padding: 24, color: '#c62828' }}>Error: {err}</div>

  return (
    <div style={{ padding: '16px 0' }}>
      <RemoteDeployedBanner vmIp={vmIp} appName={appName} />
      <div style={{ background: '#f5f7fa', border: '1px solid #e0e4ea', borderRadius: 8, padding: '10px 14px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {editConfig ? (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span style={{ whiteSpace: 'nowrap', color: '#555', fontWeight: 500 }} title="ClickOnce distribution server">ClickOnce Server URL:</span>
              <input style={{ width: 360, fontSize: 13, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4 }} placeholder="https://heeng-sugarloaf.healthedge.net" value={draftConfig.base_url ?? config.base_url} onChange={e => setDraftConfig(p => ({ ...p, base_url: e.target.value }))} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span style={{ whiteSpace: 'nowrap', color: '#555', fontWeight: 500 }}>Version:</span>
              <input style={{ width: 170, fontSize: 13, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4 }} value={draftConfig.version ?? config.version} onChange={e => setDraftConfig(p => ({ ...p, version: e.target.value }))} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span style={{ whiteSpace: 'nowrap', color: '#555', fontWeight: 500 }}>Installers Base:</span>
              <input style={{ width: 380, fontSize: 13, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4 }} value={draftConfig.installers_base ?? config.installers_base} onChange={e => setDraftConfig(p => ({ ...p, installers_base: e.target.value }))} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span style={{ whiteSpace: 'nowrap', color: '#555', fontWeight: 500 }}>Installed Base:</span>
              <input style={{ width: 380, fontSize: 13, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4 }} value={draftConfig.installed_base ?? config.installed_base} onChange={e => setDraftConfig(p => ({ ...p, installed_base: e.target.value }))} />
            </label>
            <button className="btn btn-sm btn-primary" onClick={saveConfig} disabled={savingConfig}>{savingConfig ? 'Saving…' : 'Save'}</button>
            <button className="btn btn-sm" onClick={() => { setEditConfig(false); setDraftConfig({}) }}>Cancel</button>
          </>
        ) : (
          <>
            <span style={{ fontSize: 13, color: '#444' }}><strong>ClickOnce Server:</strong>&nbsp;{config.base_url ? <code style={{ fontSize: 12 }}>{config.base_url}</code> : <em style={{ color: '#e65100' }}>not set — click Edit Config</em>}</span>
            <span style={{ fontSize: 13, color: '#444' }}>&nbsp;|&nbsp;<strong>Version:</strong>&nbsp;{config.version ? <code style={{ fontSize: 12 }}>{config.version}</code> : <em style={{ color: '#aaa' }}>not set</em>}{config.ui_version && _vMajorMinor(config.ui_version) !== _vMajorMinor(config.version) && <span style={{ color: '#e65100', marginLeft: 4 }} title={`UI v${config.version} not yet available on ClickOnce server — showing closest version ${config.ui_version}`}>→ UI: <code style={{ fontSize: 12 }}>{config.ui_version}</code> <em style={{ fontSize: 11 }}>(v{config.version} not available)</em></span>}</span>
            <span style={{ fontSize: 13, color: '#444' }}>&nbsp;|&nbsp;<strong>Installers Base:</strong>&nbsp;{config.installers_base ? <code style={{ fontSize: 12 }}>{config.installers_base}</code> : <em style={{ color: '#aaa' }}>not set</em>}</span>
            <span style={{ fontSize: 13, color: '#444' }}>&nbsp;|&nbsp;<strong>Installed Base:</strong>&nbsp;{config.installed_base ? <code style={{ fontSize: 12 }}>{config.installed_base}</code> : <em style={{ color: '#aaa' }}>not set</em>}</span>
            {apps[0]?.url && <span style={{ fontSize: 12, color: '#666' }}>&nbsp;|&nbsp;<strong>Sample URL:</strong>&nbsp;<code style={{ fontSize: 11, color: '#1565c0', wordBreak: 'break-all' }}>{apps[0].url}</code></span>}
            <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => { setEditConfig(true); setDraftConfig({}) }}>Edit Config</button>
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        {apps.map(app => (
          <_UiAppTile key={app.app_id} app={app} op={dlOps[app.app_id]} openErr={openErr[app.app_id]}
            deployedVersion={config.version}
            onDownload={() => doDownload(app)} onRunInstaller={() => doRunInstaller(app)}
            onDeleteInstaller={() => doDeleteInstaller(app)} onOpen={() => doOpen(app)}
            onOpenFolder={() => doOpenFolder(app)} onUninstall={() => doUninstall(app)}
            onAbort={() => doAbort(app)} onAbortDownload={() => doAbortDownload(app)}
            onDismissErr={() => setDlOps(p => ({ ...p, [app.app_id]: null }))} />
        ))}
      </div>
    </div>
  )
}
