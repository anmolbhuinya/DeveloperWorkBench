import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { TomcatRightPanel, KarafRightPanel } from './RemoteAppShared'

const APP_META = {
  payor:      { label: 'Payor',      icon: '⚙️',  container: 'payor-tc',      port: 7001, defaultServerType: 'tomcat' },
  classic:    { label: 'Classic',    icon: '📚',  container: 'classic-tc',    port: 7002, defaultServerType: 'tomcat' },
  connector:  { label: 'Connector',  icon: '🔌',  container: 'connector',     port: 8080, defaultServerType: 'karaf'  },
  enrollment: { label: 'Enrollment', icon: '📋',  container: 'enrollment-tc', port: 7003, defaultServerType: 'tomcat' },
  pik:        { label: 'PIK',        icon: '💳',  container: 'pik-tc',        port: 7004, defaultServerType: 'tomcat' },
}

const DEFAULT_VM       = '10.192.251.19'
const VM_STORAGE_KEY   = 'remote_app_dev_vm'
const BRANCH_TTL_KEY   = 'rcache_branch_ttl'
const SERVER_RATE_KEY  = 'rcache_server_rate'
const DEFAULT_BRANCH_TTL  = 600000   // 10 min
const DEFAULT_SERVER_RATE = 300000   // 5 min

const BRANCH_TTL_OPTS = [
  { label: 'No cache', value: 0        },
  { label: '2 min',    value: 120000   },
  { label: '5 min',    value: 300000   },
  { label: '10 min',   value: 600000   },
  { label: '30 min',   value: 1800000  },
  { label: '1 hr',     value: 3600000  },
]
const SERVER_RATE_OPTS = [
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

// Returns cached data, or `undefined` on cache miss (null is a valid cached value)
function cacheGet(key) {
  try {
    const item = JSON.parse(localStorage.getItem(key))
    if (item && item.expires > Date.now()) return item.data
  } catch {}
  return undefined
}

function cacheSet(key, data, ttlMs) {
  if (!ttlMs) return
  localStorage.setItem(key, JSON.stringify({ data, expires: Date.now() + ttlMs }))
}

function Field({ label, children }) {
  return (
    <div>
      <div className="meta-label">{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500, marginTop: 3 }}>{children}</div>
    </div>
  )
}

const selStyle = {
  fontSize: 11, padding: '2px 5px', borderRadius: 5,
  border: '1px solid var(--border)', background: 'var(--surface)',
  color: 'var(--text-muted)', cursor: 'pointer',
}

export default function RemoteAppDevPage() {
  const navigate       = useNavigate()
  const { appName }    = useParams()
  const [searchParams] = useSearchParams()
  const urlVmIp        = searchParams.get('vm_ip')

  const [vmIp, setVmIp] = useState(() =>
    urlVmIp || localStorage.getItem(VM_STORAGE_KEY) || DEFAULT_VM
  )
  const [vms, setVms] = useState([])

  useEffect(() => {
    if (urlVmIp && urlVmIp !== vmIp) {
      setVmIp(urlVmIp)
      localStorage.setItem(VM_STORAGE_KEY, urlVmIp)
    }
  }, [urlVmIp])

  useEffect(() => {
    fetch('/api/vms').then(r => r.json()).then(rows => setVms(rows.filter(v => v.ip))).catch(() => {})
  }, [])

  useEffect(() => {
    fetch(`/api/remote-app/${appName}/screen-config`)
      .then(r => r.json())
      .then(d => { if (d.settings?.app_server_type) setServerType(d.settings.app_server_type) })
      .catch(() => {})
  }, [appName])

  function changeVm(ip) {
    setVmIp(ip)
    localStorage.setItem(VM_STORAGE_KEY, ip)
    navigate(`/remote-app/${appName}?vm_ip=${encodeURIComponent(ip)}`, { replace: true })
  }

  const meta = APP_META[appName] || { label: appName, icon: '📦', container: appName, port: 8080 }
  const [activeTab, setActiveTab] = useState('App Server')

  const [serverUp,   setServerUp]   = useState(null)
  const [serverOp,   setServerOp]   = useState('start')
  const [opRunning,  setOpRunning]  = useState(false)
  const [opResult,   setOpResult]   = useState(null)
  const [opErr,      setOpErr]      = useState(null)
  const [opOutput,   setOpOutput]   = useState('')
  const opPollRef = useRef(null)

  const [branch,     setBranch]     = useState(null)
  const [branchLoad, setBranchLoad] = useState(true)
  const [branchErr,  setBranchErr]  = useState(null)

  const [deployed,   setDeployed]   = useState(undefined)
  const [serverType, setServerType] = useState(() => APP_META[appName]?.defaultServerType || null)

  // Cache settings — persisted in localStorage, shared across all remote app pages
  const [branchTtl, setBranchTtl] = useState(() => {
    const v = parseInt(localStorage.getItem(BRANCH_TTL_KEY), 10)
    return BRANCH_TTL_OPTS.some(o => o.value === v) ? v : DEFAULT_BRANCH_TTL
  })
  const [serverRefreshMs, setServerRefreshMs] = useState(() => {
    const v = parseInt(localStorage.getItem(SERVER_RATE_KEY), 10)
    return SERVER_RATE_OPTS.some(o => o.value === v) ? v : DEFAULT_SERVER_RATE
  })
  // Refs so interval callbacks always see latest values without re-registering
  const branchTtlRef     = useRef(branchTtl)
  const serverRefreshRef = useRef(serverRefreshMs)
  useEffect(() => { branchTtlRef.current = branchTtl },         [branchTtl])
  useEffect(() => { serverRefreshRef.current = serverRefreshMs }, [serverRefreshMs])

  const [props,     setProps]     = useState({})
  const [propsLoad, setPropsLoad] = useState(false)
  const [addKey,    setAddKey]    = useState('')
  const [addVal,    setAddVal]    = useState('')
  const [adding,    setAdding]    = useState(false)
  const [editKey,   setEditKey]   = useState(null)
  const [editVal,   setEditVal]   = useState('')
  const [propErr,   setPropErr]   = useState(null)

  // ── Server status ────────────────────────────────────────────────────────────
  function checkStatus(force = false) {
    const cacheKey = `rcache_server_${appName}_${vmIp}`
    if (!force) {
      const cached = cacheGet(cacheKey)
      if (cached !== undefined) { setServerUp(cached); return }
    }
    fetch(`/api/remote-app/${appName}/server-status?vm_ip=${encodeURIComponent(vmIp)}`)
      .then(r => r.json())
      .then(d => {
        const up = d.ok ? !!d.running : null
        setServerUp(up)
        if (serverRefreshRef.current > 0) cacheSet(cacheKey, up, serverRefreshRef.current)
      })
      .catch(() => {})
  }

  // ── Branch / deployed info ───────────────────────────────────────────────────
  function loadBranch(force = false) {
    const cacheKey = `rcache_branch_${appName}_${vmIp}`
    if (!force && branchTtlRef.current > 0) {
      const cached = cacheGet(cacheKey)
      if (cached !== undefined) { setBranch(cached); setBranchLoad(false); return }
    }
    setBranchLoad(true); setBranchErr(null)
    fetch(`/api/remote-app/${appName}/current-branch?vm_ip=${encodeURIComponent(vmIp)}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setBranch(d)
          cacheSet(cacheKey, d, branchTtlRef.current)
        } else setBranchErr(d.error || 'Failed')
      })
      .catch(() => setBranchErr('Could not reach server'))
      .finally(() => setBranchLoad(false))
  }

  function loadDeployed(force = false) {
    const cacheKey = `rcache_deployed_${appName}_${vmIp}`
    if (!force && branchTtlRef.current > 0) {
      const cached = cacheGet(cacheKey)
      if (cached !== undefined) { setDeployed(cached); return }  // null = valid "no deployment"
    }
    fetch(`/api/remote-app/${appName}/deployed-info?vm_ip=${encodeURIComponent(vmIp)}`)
      .then(r => r.json())
      .then(d => {
        const val = d.ok && d.branch ? d : null
        setDeployed(val)
        cacheSet(cacheKey, val, branchTtlRef.current)
      })
      .catch(() => setDeployed(null))
  }

  function forceRefreshInfo() {
    localStorage.removeItem(`rcache_branch_${appName}_${vmIp}`)
    localStorage.removeItem(`rcache_deployed_${appName}_${vmIp}`)
    loadBranch(true)
    loadDeployed(true)
  }

  // Initial data load on app/VM change — use page-init on cold cache to batch SSH calls
  const serverPollRef = useRef(null)
  useEffect(() => {
    setBranch(null); setBranchErr(null); setDeployed(undefined); setServerUp(null)
    if (!vmIp) return
    const branchKey   = `rcache_branch_${appName}_${vmIp}`
    const deployedKey = `rcache_deployed_${appName}_${vmIp}`
    const branchCached   = branchTtlRef.current > 0 ? cacheGet(branchKey)   : undefined
    const deployedCached = branchTtlRef.current > 0 ? cacheGet(deployedKey) : undefined
    if (branchCached !== undefined) {
      setBranch(branchCached); setBranchLoad(false)
      if (deployedCached !== undefined) setDeployed(deployedCached)
      else loadDeployed()
      checkStatus()
      return
    }
    // Cold cache — use all/page-init to batch ALL apps over one SSH connection.
    // This populates localStorage for every app atomically before returning, so
    // navigating to a different app is instant with no re-fetch.
    setBranchLoad(true); setBranchErr(null)
    fetch(`/api/remote-app/all/page-init?vm_ip=${encodeURIComponent(vmIp)}`)
      .then(r => r.json())
      .then(allD => {
        if (!allD.ok) { setBranchErr(allD.error || 'Failed to load app data'); return }
        const now = Date.now()
        for (const [name, appData] of Object.entries(allD.apps || {})) {
          if (branchTtlRef.current > 0) {
            if (appData.branch?.ok)
              cacheSet(`rcache_branch_${name}_${vmIp}`, appData.branch, branchTtlRef.current)
            cacheSet(`rcache_deployed_${name}_${vmIp}`,
              appData.deployed?.release_ver ? appData.deployed : null, branchTtlRef.current)
            if (appData.modules?.ok)
              localStorage.setItem(`rcache_modules_${name}_${vmIp}`,
                JSON.stringify({ data: appData.modules, expires: now + branchTtlRef.current }))
          }
          if (appData.server?.running != null && serverRefreshRef.current > 0)
            cacheSet(`rcache_server_${name}_${vmIp}`, appData.server.running, serverRefreshRef.current)
        }
        const cur = allD.apps?.[appName]
        if (!cur) { setBranchErr('App data not returned'); return }
        if (cur.branch?.ok) setBranch(cur.branch)
        else if (cur.branch) setBranchErr(cur.branch.error || 'Failed')
        if (cur.server?.running !== null && cur.server?.running !== undefined)
          setServerUp(cur.server.running)
        setDeployed(cur.deployed?.release_ver ? cur.deployed : null)
      })
      .catch(() => setBranchErr('Could not reach server'))
      .finally(() => setBranchLoad(false))
  }, [appName, vmIp])

  // Server auto-refresh poll — re-registers when refresh rate or app/VM changes
  useEffect(() => {
    clearInterval(serverPollRef.current)
    if (serverRefreshMs > 0) {
      serverPollRef.current = setInterval(() => checkStatus(), serverRefreshMs)
    }
    return () => clearInterval(serverPollRef.current)
  }, [serverRefreshMs, appName, vmIp])

  function saveBranchTtl(v) {
    setBranchTtl(v)
    localStorage.setItem(BRANCH_TTL_KEY, String(v))
  }
  function saveServerRate(v) {
    setServerRefreshMs(v)
    localStorage.setItem(SERVER_RATE_KEY, String(v))
  }

  // ── Server operations ────────────────────────────────────────────────────────
  function doServerOp(op) {
    setOpRunning(true); setOpResult(null); setOpErr(null); setOpOutput(''); setServerOp(op)
    fetch(`/api/remote-app/${appName}/server-op`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vm_ip: vmIp,
        operation: op,
        branch_version: branch?.release_ver || branch?.branch || '',
      }),
    })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) { setOpErr(d.error || 'Operation failed'); setOpRunning(false) }
        // async: true → polling effect handles completion
      })
      .catch(() => { setOpErr('Could not reach server'); setOpRunning(false) })
  }

  function doServerOpAbort() {
    fetch(`/api/remote-app/${appName}/server-op/abort`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vm_ip: vmIp }),
    })
      .then(r => r.json())
      .then(() => { setOpRunning(false); setOpOutput('') })
      .catch(() => {})
  }

  // Poll server-op status while running
  useEffect(() => {
    clearInterval(opPollRef.current)
    if (!opRunning) return
    opPollRef.current = setInterval(() => {
      fetch(`/api/remote-app/${appName}/server-op/status?vm_ip=${encodeURIComponent(vmIp)}`)
        .then(r => r.json())
        .then(d => {
          if (d.output) setOpOutput(d.output)
          if (d.status && d.status !== 'running') {
            clearInterval(opPollRef.current)
            setOpRunning(false)
            if (d.status === 'success') { setOpResult(d.output || `${d.operation || serverOp} successful`); setTimeout(() => checkStatus(true), 1500) }
            else if (d.status === 'failed') setOpErr(d.output || 'Operation failed')
          }
        })
        .catch(() => {})
    }, 1500)
    return () => clearInterval(opPollRef.current)
  }, [opRunning, appName, vmIp])

  // ── Runtime props ────────────────────────────────────────────────────────────
  function loadProps() {
    setPropsLoad(true); setPropErr(null)
    fetch(`/api/remote-app/${appName}/runtime-properties?vm_ip=${encodeURIComponent(vmIp)}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setProps(d.properties || {}); else setPropErr(d.error) })
      .catch(() => setPropErr('Could not reach server'))
      .finally(() => setPropsLoad(false))
  }

  function addProp() {
    if (!addKey.trim()) return
    setAdding(true)
    fetch(`/api/remote-app/${appName}/runtime-properties?vm_ip=${encodeURIComponent(vmIp)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: addKey.trim(), value: addVal }),
    })
      .then(r => r.json())
      .then(d => { if (d.ok) { setProps(d.properties || {}); setAddKey(''); setAddVal('') } else setPropErr(d.error) })
      .catch(() => setPropErr('Could not reach server'))
      .finally(() => setAdding(false))
  }

  function updateProp(key) {
    fetch(`/api/remote-app/${appName}/runtime-properties/${encodeURIComponent(key)}?vm_ip=${encodeURIComponent(vmIp)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: editVal }),
    })
      .then(r => r.json())
      .then(d => { if (d.ok) { setProps(d.properties || {}); setEditKey(null) } else setPropErr(d.error) })
      .catch(() => setPropErr('Could not reach server'))
  }

  function deleteProp(key) {
    if (!window.confirm(`Delete property '${key}'?`)) return
    fetch(`/api/remote-app/${appName}/runtime-properties/${encodeURIComponent(key)}?vm_ip=${encodeURIComponent(vmIp)}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(d => { if (d.ok) setProps(d.properties || {}); else setPropErr(d.error) })
      .catch(() => setPropErr('Could not reach server'))
  }

  const TABS = ['App Server', 'Code', 'Runtime Properties']

  return (
    <div>
      {/* ── Main header row ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <button className="btn back-link" style={{ marginBottom: 0 }} onClick={() => navigate('/remote-app')}>
          ← Remote App Development
        </button>
        <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>/</span>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{meta.icon} {meta.label}</span>

        {vms.length > 0 ? (
          <select
            value={vmIp}
            onChange={e => changeVm(e.target.value)}
            style={{ fontSize: 12, padding: '2px 8px', fontFamily: 'monospace', borderRadius: 6, border: '1px solid rgba(59,130,246,0.35)', background: 'rgba(59,130,246,0.06)', color: 'var(--primary)', minWidth: 200 }}
          >
            {!vms.some(v => v.ip === vmIp) && <option value={vmIp}>{vmIp}</option>}
            {vms.map(vm => (
              <option key={vm.ip} value={vm.ip}>
                {vm.name ? `${vm.name} (${vm.ip})` : vm.ip}{vm.assigned_to ? ` — ${vm.assigned_to}` : ''}
              </option>
            ))}
          </select>
        ) : (
          <span style={{ fontFamily: 'monospace', fontSize: 12, padding: '2px 10px', borderRadius: 10, background: 'rgba(59,130,246,0.1)', color: 'var(--primary)', border: '1px solid rgba(59,130,246,0.25)' }}>
            VM: {vmIp}
          </span>
        )}

        {/* Branch & release info */}
        {branchLoad ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ color: 'var(--border)', fontSize: 16, margin: '0 2px' }}>|</span>
            <span className="spinner" style={{ width: 11, height: 11 }} />
          </span>
        ) : branch ? (
          <>
            <span style={{ color: 'var(--border)', fontSize: 16, margin: '0 2px' }}>|</span>
            <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 12,
              background: 'rgba(76,175,80,0.1)', color: '#2e7d32', border: '1px solid rgba(76,175,80,0.3)' }}>
              {branch.branch}
            </span>
            {branch.release_ver && (
              <code style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8,
                background: 'var(--surface2, rgba(128,128,128,0.08))', color: 'var(--text-muted)',
                border: '1px solid var(--border)' }}>
                {branch.release_ver}
              </code>
            )}
          </>
        ) : branchErr ? (
          <>
            <span style={{ color: 'var(--border)', fontSize: 16, margin: '0 2px' }}>|</span>
            <span style={{ fontSize: 11, color: '#c62828' }} title={branchErr}>⚠ branch error</span>
          </>
        ) : null}

        {/* Deployed banner */}
        {deployed !== undefined && deployed && (
          <>
            <span style={{ color: 'var(--border)', fontSize: 16, margin: '0 2px' }}>|</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Deployed:</span>
            <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 12,
              background: 'rgba(76,175,80,0.1)', color: '#2e7d32', border: '1px solid rgba(76,175,80,0.3)' }}>
              {deployed.branch}
            </span>
            {deployed.release_ver && (
              <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>v{deployed.release_ver}</code>
            )}
          </>
        )}

        {/* Server status */}
        {serverUp !== null && (
          <>
            <span style={{ color: 'var(--border)', fontSize: 16, margin: '0 2px' }}>·</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11,
              fontWeight: 600, padding: '2px 10px', borderRadius: 12,
              background: serverUp ? 'rgba(76,175,80,0.12)' : 'rgba(244,67,54,0.08)',
              color: serverUp ? '#2e7d32' : '#c62828',
              border: `1px solid ${serverUp ? 'rgba(76,175,80,0.35)' : 'rgba(244,67,54,0.2)'}` }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%',
                background: serverUp ? '#4caf50' : '#f44336', display: 'inline-block' }} />
              {serverUp ? 'Running' : 'Stopped'}
            </span>
          </>
        )}
      </div>

      {/* ── Tab bar ── */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '2px solid var(--border)', marginBottom: 20 }}>
        {TABS.map(tab => (
          <button key={tab} onClick={() => { setActiveTab(tab); if (tab === 'Runtime Properties') loadProps() }} style={{
            padding: '8px 18px', border: 'none',
            borderBottom: activeTab === tab ? '2px solid var(--primary, #3b82f6)' : '2px solid transparent',
            marginBottom: -2, background: 'transparent',
            color: activeTab === tab ? 'var(--primary, #3b82f6)' : 'var(--text-muted)',
            fontWeight: activeTab === tab ? 600 : 400,
            fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {tab}
          </button>
        ))}
      </div>

      {/* ── App Server tab ── */}
      {activeTab === 'App Server' && (
        serverType === 'tomcat'
          ? <TomcatRightPanel vmIp={vmIp} appName={appName} />
          : serverType === 'karaf'
          ? (
            <div>
              {/* Server controls card (same for all non-tomcat apps) */}
              <div className="card" style={{ marginBottom: 16, maxWidth: 640 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>App Server (Karaf)</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%',
                      background: serverUp === null ? '#9e9e9e' : serverUp ? '#4caf50' : '#f44336',
                      display: 'inline-block' }} />
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                      {serverUp === null ? 'Checking…' : serverUp ? 'Running' : 'Stopped'}
                    </span>
                  </div>
                  <button className="btn btn-sm" onClick={() => checkStatus(true)} disabled={opRunning}>↻ Refresh</button>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {['start', 'stop', 'restart'].map(op => (
                    <button key={op}
                      className={`btn btn-sm${op === 'start' ? ' btn-primary' : ''}`}
                      disabled={opRunning}
                      style={op === 'stop' ? { color: '#c62828', borderColor: '#e57373' } : op === 'restart' ? { color: '#ff9800', borderColor: '#ff9800' } : {}}
                      onClick={() => doServerOp(op)}>
                      {opRunning && serverOp === op
                        ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> {op.charAt(0).toUpperCase() + op.slice(1)}ing…</>
                        : op.charAt(0).toUpperCase() + op.slice(1)}
                    </button>
                  ))}
                  {opRunning && (
                    <button className="btn btn-sm" onClick={doServerOpAbort}
                      style={{ color: '#f44336', borderColor: '#f44336' }}>
                      ⊗ Abort
                    </button>
                  )}
                </div>
                {branch?.release_ver && (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                    Branch version: <code style={{ fontSize: 10 }}>{branch.release_ver}</code>
                  </div>
                )}
                {(opRunning || opOutput || opResult || opErr) && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                      {opRunning && <><span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} /> {(serverOp || 'Operation').charAt(0).toUpperCase() + (serverOp || 'operation').slice(1)} in progress…</>}
                      {!opRunning && opResult && <span style={{ color: '#4caf50' }}>✓ Done</span>}
                      {!opRunning && opErr    && <span style={{ color: '#f44336' }}>✗ Failed</span>}
                    </div>
                    <div style={{ background: '#141414', color: '#d4d4d4', fontFamily: 'monospace',
                      fontSize: 11, padding: '6px 10px', borderRadius: 5, whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all', maxHeight: 160, overflowY: 'auto', border: '1px solid #333',
                      minHeight: 32 }}>
                      {opOutput || (opErr ? opErr : (opResult ? opResult : <span style={{ color: '#555' }}>Waiting for output…</span>))}
                    </div>
                  </div>
                )}
              </div>
              <KarafRightPanel base={`/api/remote-app/${appName}/karaf`} query={`vm_ip=${encodeURIComponent(vmIp)}`} />
            </div>
          )
          : (
            <div style={{ maxWidth: 600 }}>
              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Server Status</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%',
                      background: serverUp === null ? '#9e9e9e' : serverUp ? '#4caf50' : '#f44336',
                      display: 'inline-block' }} />
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                      {serverUp === null ? 'Checking…' : serverUp ? 'Running' : 'Stopped'}
                    </span>
                  </div>
                  <button className="btn btn-sm" onClick={() => checkStatus(true)}>↻ Refresh</button>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {['start', 'stop', 'restart'].map(op => (
                    <button key={op}
                      className={`btn btn-sm${op === 'start' ? ' btn-success' : ''}`}
                      disabled={opRunning}
                      style={op === 'stop' ? { color: '#c62828', borderColor: '#e57373' } : {}}
                      onClick={() => doServerOp(op)}>
                      {opRunning && serverOp === op
                        ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> {op.charAt(0).toUpperCase() + op.slice(1)}ing…</>
                        : op.charAt(0).toUpperCase() + op.slice(1)}
                    </button>
                  ))}
                  {opRunning && (
                    <button className="btn btn-sm" onClick={doServerOpAbort}
                      style={{ color: '#f44336', borderColor: '#f44336' }}>
                      ⊗ Abort
                    </button>
                  )}
                </div>
                {opResult && <div className="alert alert-info"  style={{ marginTop: 12, fontSize: 12 }}>{opResult}</div>}
                {opErr    && <div className="alert alert-error" style={{ marginTop: 12, fontSize: 12 }}>{opErr}</div>}
              </div>
            </div>
          )
      )}

      {/* ── Code tab ── */}
      {activeTab === 'Code' && (
        <div style={{ maxWidth: 700 }}>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Source Branch (on VM)</div>
              <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={forceRefreshInfo} disabled={branchLoad}>
                {branchLoad ? <span className="spinner" style={{ width: 10, height: 10 }} /> : '↻ Refresh'}
              </button>
            </div>
            {branchLoad ? <span className="spinner" />
              : branchErr ? <div className="alert alert-error">{branchErr}</div>
              : branch ? (
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                  <Field label="Branch"><span className="badge badge-success">{branch.branch}</span></Field>
                  {branch.release_ver && <Field label="Release"><code>{branch.release_ver}</code></Field>}
                  {branch.srcdir && <Field label="Directory">
                    <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{branch.srcdir}</code>
                  </Field>}
                </div>
              ) : null}
          </div>

          {deployed !== undefined && (
            <div className="card" style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Deployed Build</div>
              {deployed ? (
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                  <Field label="Branch"><code>{deployed.branch}</code></Field>
                  {deployed.release_ver && <Field label="Version"><code>v{deployed.release_ver}</code></Field>}
                  {deployed.deployed_at && <Field label="Deployed At"><span style={{ fontSize: 12 }}>{deployed.deployed_at}</span></Field>}
                </div>
              ) : <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No deployment recorded.</span>}
            </div>
          )}
        </div>
      )}

      {/* ── Runtime Properties tab ── */}
      {activeTab === 'Runtime Properties' && (
        <div style={{ maxWidth: 900 }}>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Runtime Properties</div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{Object.keys(props).length} entries</span>
              <button className="btn btn-sm" onClick={loadProps} disabled={propsLoad} style={{ marginLeft: 'auto' }}>↻</button>
            </div>

            {propErr && <div className="alert alert-error" style={{ marginBottom: 10, fontSize: 12 }}>{propErr}</div>}

            {propsLoad ? <span className="spinner" /> : Object.keys(props).length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 0' }}>No properties loaded. Click ↻ to fetch.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 14 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-muted)', width: '40%' }}>Key</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-muted)' }}>Value</th>
                    <th style={{ width: 80 }} />
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(props).map(([k, v]) => (
                    <tr key={k} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontSize: 11 }}>{k}</td>
                      <td style={{ padding: '5px 8px' }}>
                        {editKey === k ? (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <input autoFocus value={editVal} onChange={e => setEditVal(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') updateProp(k); if (e.key === 'Escape') setEditKey(null) }}
                              style={{ flex: 1, fontSize: 11, padding: '2px 6px' }} />
                            <button className="btn btn-sm btn-primary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => updateProp(k)}>✓</button>
                            <button className="btn btn-sm" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => setEditKey(null)}>✕</button>
                          </div>
                        ) : (
                          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{String(v)}</span>
                        )}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                        {editKey !== k && (
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                            <button className="btn btn-sm" style={{ fontSize: 10, padding: '1px 7px' }} onClick={() => { setEditKey(k); setEditVal(String(v)) }}>Edit</button>
                            <button className="btn btn-sm" style={{ fontSize: 10, padding: '1px 7px', color: '#c62828', borderColor: '#e57373' }} onClick={() => deleteProp(k)}>Del</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Add:</span>
              <input type="text" placeholder="key" value={addKey} onChange={e => setAddKey(e.target.value)} style={{ width: 180, fontSize: 12, padding: '4px 8px' }} />
              <input type="text" placeholder="value" value={addVal} onChange={e => setAddVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && addProp()} style={{ flex: '1 1 180px', fontSize: 12, padding: '4px 8px' }} />
              <button className="btn btn-sm btn-primary" onClick={addProp} disabled={adding || !addKey.trim()}>
                {adding ? '…' : '+ Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
