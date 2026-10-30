import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

const APPS = [
  { name: 'payor',      label: 'Payor',      icon: '⚙️',  desc: 'Core adjudication and payer management platform.' },
  { name: 'classic',    label: 'Classic',    icon: '📚',  desc: 'HealthRules Classic legacy adjudication platform.' },
  { name: 'connector',  label: 'Connector',  icon: '🔌',  desc: 'Integration Platform Connector for EDI/FHIR/HL7.' },
  { name: 'enrollment', label: 'Enrollment', icon: '📋',  desc: 'Member enrollment and eligibility processing.' },
  { name: 'pik',        label: 'PIK',        icon: '💳',  desc: 'Payment Innovation Kit for advanced payment models.' },
]

const DEFAULT_VM     = '10.192.251.19'
const VM_STORAGE_KEY = 'remote_app_dev_vm'
const DEFAULT_POLL   = 600000  // 10 minutes

const BRANCH_TTL_KEY    = 'rcache_branch_ttl'
const SERVER_RATE_KEY   = 'rcache_server_rate'
const SSH_KEEPALIVE_KEY = 'ssh_keepalive_s'
const DEFAULT_BRANCH_TTL  = 600000  // 10 min
const DEFAULT_SERVER_RATE = 300000  // 5 min
const DEFAULT_KEEPALIVE   = 60      // seconds

const BRANCH_TTL_OPTS = [
  { label: 'No cache', value: 0       },
  { label: '2 min',    value: 120000  },
  { label: '5 min',    value: 300000  },
  { label: '10 min',   value: 600000  },
  { label: '30 min',   value: 1800000 },
  { label: '1 hr',     value: 3600000 },
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
const SSH_KEEPALIVE_OPTS = [
  { label: 'Off',    value: 0    },
  { label: '1 min',  value: 60   },
  { label: '2 min',  value: 120  },
  { label: '3 min',  value: 180  },
  { label: '5 min',  value: 300  },
  { label: '10 min', value: 600  },
  { label: '15 min', value: 900  },
  { label: '30 min', value: 1800 },
  { label: '1 hr',   value: 3600 },
]

const selStyle = {
  fontSize: 11, padding: '2px 5px', borderRadius: 5,
  border: '1px solid var(--border)', background: 'var(--surface)',
  color: 'var(--text-muted)', cursor: 'pointer',
}

function buildStoreKey(appName) {
  return `remote_build_cmd_${appName}`
}

function fmtEta(remainMs) {
  if (remainMs <= 0) return 'almost done'
  const s = Math.round(remainMs / 1000)
  if (s < 60) return `~${s}s left`
  const m = Math.floor(s / 60), rs = s % 60
  return rs > 0 ? `~${m}m ${rs}s left` : `~${m}m left`
}

function computeProgress(d) {
  if (!d) return null
  if (d.progress != null) return d.progress
  const est = d.estimated_ms || d.estimate_ms
  if (est && d.elapsed_ms) return Math.min(Math.round(d.elapsed_ms / est * 100), 95)
  if (d.module_num && d.total_modules) return Math.min(Math.round(d.module_num / d.total_modules * 80), 80)
  return null
}

function BuildProgress({ build }) {
  if (!build) return null
  const pct = computeProgress(build)
  const remainMs = (build.estimated_ms != null && build.elapsed_ms != null) ? (build.estimated_ms - build.elapsed_ms) : null
  const phase = build.phase || 'building'
  const modLabel = build.current_module
    ? `${build.current_module}${build.module_num && build.total_modules ? ` (${build.module_num}/${build.total_modules})` : ''}`
    : null

  return (
    <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{
          fontSize: 10, color: 'var(--primary)', fontWeight: 600,
          textTransform: 'capitalize', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%',
        }}>
          {modLabel || phase}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
          {pct != null ? `${pct}%` : ''}
          {remainMs != null
            ? (remainMs > 0
              ? ` · ${fmtEta(remainMs)}`
              : ` · +${Math.ceil(-remainMs / 60000)}m over`)
            : ''}
        </span>
      </div>
      <div style={{ height: 4, borderRadius: 4, background: 'rgba(128,128,128,0.2)' }}>
        {pct != null ? (
          <div style={{
            height: '100%', width: `${pct}%`, background: 'var(--primary)',
            borderRadius: 4, transition: 'width 0.6s ease',
          }} />
        ) : (
          <div className="progress-bar-indeterminate" style={{ height: '100%', borderRadius: 4, background: 'rgba(128,128,128,0.2)' }} />
        )}
      </div>
    </div>
  )
}

export default function RemoteAppPage() {
  const navigate   = useNavigate()
  const [vmIp,     setVmIp]     = useState(() => localStorage.getItem(VM_STORAGE_KEY) || DEFAULT_VM)
  const [vms,      setVms]      = useState([])
  const [statuses,       setStatuses]       = useState({})
  const [builds,         setBuilds]         = useState({})   // appName → command-status response
  const [pollMs,         setPollMs]         = useState(DEFAULT_POLL)
  const [refreshing,     setRefreshing]     = useState(false)
  const [branchTtl, setBranchTtl] = useState(() => {
    const v = parseInt(localStorage.getItem(BRANCH_TTL_KEY), 10)
    return BRANCH_TTL_OPTS.some(o => o.value === v) ? v : DEFAULT_BRANCH_TTL
  })
  const [serverRefreshMs, setServerRefreshMs] = useState(() => {
    const v = parseInt(localStorage.getItem(SERVER_RATE_KEY), 10)
    return SERVER_RATE_OPTS.some(o => o.value === v) ? v : DEFAULT_SERVER_RATE
  })
  const [keepaliveS, setKeepaliveS] = useState(() => {
    const v = parseInt(localStorage.getItem(SSH_KEEPALIVE_KEY), 10)
    return SSH_KEEPALIVE_OPTS.some(o => o.value === v) ? v : DEFAULT_KEEPALIVE
  })
  const pollRef       = useRef(null)
  const statusPollRef = useRef(null)
  const vmIpRef       = useRef(vmIp)

  useEffect(() => { vmIpRef.current = vmIp }, [vmIp])

  function saveBranchTtl(v) { setBranchTtl(v); localStorage.setItem(BRANCH_TTL_KEY, String(v)) }
  function saveServerRate(v) { setServerRefreshMs(v); localStorage.setItem(SERVER_RATE_KEY, String(v)) }
  function saveKeepalive(v) {
    setKeepaliveS(v)
    localStorage.setItem(SSH_KEEPALIVE_KEY, String(v))
    fetch('/api/ssh-pool/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keepalive_s: v }) }).catch(() => {})
  }
  function clearAllBranchCaches() {
    Object.keys(localStorage)
      .filter(k => k.startsWith('rcache_'))
      .forEach(k => localStorage.removeItem(k))
    setStatuses({})
    fetchStatuses(vmIp)
  }

  // Load VM list
  useEffect(() => {
    fetch('/api/vms').then(r => r.json()).then(rows => {
      setVms(rows.filter(v => v.ip))
    }).catch(() => {})
  }, [])

  // Load poll intervals from config.json via backend
  useEffect(() => {
    fetch('/api/remote-build-config')
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          if (d.overview_build_poll_ms) setPollMs(d.overview_build_poll_ms)
        }
      })
      .catch(() => {})
  }, [])

  // Sync stored SSH keepalive to backend on mount
  useEffect(() => {
    const stored = parseInt(localStorage.getItem(SSH_KEEPALIVE_KEY), 10)
    if (!isNaN(stored)) {
      fetch('/api/ssh-pool/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keepalive_s: stored }) }).catch(() => {})
    }
  }, [])

  function selectVm(ip) {
    setVmIp(ip)
    localStorage.setItem(VM_STORAGE_KEY, ip)
    setStatuses({})
    setBuilds({})
  }

  function fetchStatuses(ip) {
    const target = ip || vmIpRef.current
    const ttl    = branchTtl
    const srvTtl = serverRefreshMs

    // Serve from localStorage first — populate statuses instantly from cache
    // and skip the SSH round-trip entirely if every app's entry is still fresh.
    if (srvTtl > 0) {
      const fromCache = {}
      let allFresh = true
      for (const app of APPS) {
        try {
          const item = JSON.parse(localStorage.getItem(`rcache_server_${app.name}_${target}`))
          if (item && item.expires > Date.now()) {
            fromCache[app.name] = item.data === true ? 'running' : item.data === false ? 'stopped' : 'error'
          } else {
            allFresh = false
          }
        } catch {
          allFresh = false
        }
      }
      if (Object.keys(fromCache).length > 0) setStatuses(p => ({ ...p, ...fromCache }))
      if (allFresh) return  // every app fresh — skip HTTP entirely
    }

    setRefreshing(true)
    fetch(`/api/remote-app/all/page-init?vm_ip=${encodeURIComponent(target)}`)
      .then(r => r.json())
      .then(d => {
        if (!d.ok) return
        const next = {}
        const now  = Date.now()
        for (const [name, app] of Object.entries(d.apps)) {
          const running = app.server?.running ?? null
          next[name] = running === null ? 'error' : running ? 'running' : 'stopped'
          if (running !== null && srvTtl > 0)
            localStorage.setItem(`rcache_server_${name}_${target}`,  JSON.stringify({ data: running,    expires: now + srvTtl }))
          if (app.branch?.ok && ttl > 0)
            localStorage.setItem(`rcache_branch_${name}_${target}`,  JSON.stringify({ data: app.branch, expires: now + ttl }))
          if (app.modules?.ok && ttl > 0)
            localStorage.setItem(`rcache_modules_${name}_${target}`, JSON.stringify({ data: app.modules, expires: now + ttl }))
        }
        setStatuses(p => ({ ...p, ...next }))
      })
      .catch(() => {
        const err = {}
        APPS.forEach(a => { err[a.name] = 'error' })
        setStatuses(p => ({ ...p, ...err }))
      })
      .finally(() => setRefreshing(false))
  }

  // For each app that has a stored cmd_id in localStorage, poll command-status.
  // Only show progress if the build's vm_ip matches the currently selected VM.
  async function fetchBuildStatuses() {
    const ip = vmIpRef.current
    const results = await Promise.allSettled(
      APPS.map(app => {
        const cmdId = localStorage.getItem(buildStoreKey(app.name))
        if (!cmdId) return Promise.resolve({ name: app.name, value: null })
        return fetch(`/api/remote-app/${app.name}/command-status?cmd_id=${cmdId}`)
          .then(r => r.json())
          .then(d => {
            if (!d.ok || d.status !== 'running') return { name: app.name, value: null }
            if (d.vm_ip && d.vm_ip !== ip) return { name: app.name, value: null }
            return { name: app.name, value: d }
          })
          .catch(() => ({ name: app.name, value: null }))
      })
    )
    const next = {}
    for (const r of results) {
      if (r.status === 'fulfilled') next[r.value.name] = r.value.value
    }
    setBuilds(next)
  }

  // Build status: initial fetch + poll at configured interval
  useEffect(() => {
    fetchBuildStatuses()
  }, [vmIp])

  useEffect(() => {
    clearInterval(pollRef.current)
    pollRef.current = setInterval(fetchBuildStatuses, pollMs)
    return () => clearInterval(pollRef.current)
  }, [pollMs, vmIp])

  // Server status: initial fetch + auto-poll at user-configured interval
  useEffect(() => {
    fetchStatuses(vmIp)
    clearInterval(statusPollRef.current)
    if (serverRefreshMs > 0) statusPollRef.current = setInterval(() => fetchStatuses(), serverRefreshMs)
    return () => clearInterval(statusPollRef.current)
  }, [serverRefreshMs, vmIp])

  const activeBuilds = APPS.filter(a => !!builds[a.name]).length

  const statusColor = s => s === 'running' ? '#2e7d32' : s === 'stopped' ? '#e65100' : s === 'error' ? '#c62828' : '#9e9e9e'
  const statusBg    = s => s === 'running' ? 'rgba(76,175,80,0.1)' : s === 'stopped' ? 'rgba(230,81,0,0.08)' : 'rgba(244,67,54,0.08)'
  const statusDot   = s => s === 'running' ? '#4caf50' : s === 'stopped' ? '#ff9800' : s === 'error' ? '#f44336' : '#9e9e9e'

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Remote App Development</h1>
      </div>

      <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 20, maxWidth: 700 }}>
        Manage and develop HealthEdge applications running on a remote development VM via SSH.
        Select a VM and connect to any application to check status, start/stop containers, or manage runtime properties.
      </p>

      {/* VM selector + settings */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>Target VM:</span>
        {vms.length > 0 ? (
          <select
            value={vmIp}
            onChange={e => selectVm(e.target.value)}
            style={{ fontSize: 13, padding: '5px 10px', fontFamily: 'monospace', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', minWidth: 260 }}
          >
            {!vms.some(v => v.ip === vmIp) && <option value={vmIp}>{vmIp}</option>}
            {vms.map(vm => (
              <option key={vm.ip} value={vm.ip}>
                {vm.name ? `${vm.name} (${vm.ip})` : vm.ip}{vm.assigned_to ? ` — ${vm.assigned_to}` : ''}
              </option>
            ))}
          </select>
        ) : (
          <code style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{vmIp}</code>
        )}
        {activeBuilds > 0 && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 600,
            background: 'rgba(var(--primary-rgb, 59,130,246),0.12)',
            color: 'var(--primary)', border: '1px solid rgba(var(--primary-rgb, 59,130,246),0.35)',
            borderRadius: 20, padding: '3px 10px',
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--primary)', animation: 'spin 1.2s linear infinite', display: 'inline-block' }} />
            {activeBuilds} build{activeBuilds > 1 ? 's' : ''} running
          </span>
        )}
        <span style={{ color: 'var(--border)', fontSize: 16 }}>|</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)' }}>
          <span>Branch cache:</span>
          <select value={branchTtl} onChange={e => saveBranchTtl(parseInt(e.target.value, 10))} style={selStyle}>
            {BRANCH_TTL_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="btn btn-sm" onClick={clearAllBranchCaches} disabled={refreshing} style={{ fontSize: 11, padding: '2px 6px' }} title="Clear all cached remote app data">
            {refreshing ? <span className="spinner" style={{ width: 9, height: 9 }} /> : '⟳'}
          </button>
          <span style={{ color: 'var(--border)' }}>|</span>
          <span>Server refresh:</span>
          <select value={serverRefreshMs} onChange={e => saveServerRate(parseInt(e.target.value, 10))} style={selStyle}>
            {SERVER_RATE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="btn btn-sm" onClick={() => fetchStatuses(vmIp)} disabled={refreshing} style={{ fontSize: 11, padding: '2px 6px' }} title="Force refresh server status for all apps">
            {refreshing ? <span className="spinner" style={{ width: 9, height: 9 }} /> : '⟳'}
          </button>
          <span style={{ color: 'var(--border)' }}>|</span>
          <span>SSH keepalive:</span>
          <select value={keepaliveS} onChange={e => saveKeepalive(parseInt(e.target.value, 10))} style={selStyle} title="How often to send SSH keepalive packets to prevent idle connections from dropping">
            {SSH_KEEPALIVE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* App tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16, maxWidth: 900 }}>
        {APPS.map(app => {
          const s         = statuses[app.name]
          const build     = builds[app.name]
          const isBuilding = !!build
          return (
            <button
              key={app.name}
              onClick={() => navigate(`/remote-app/${app.name}?vm_ip=${encodeURIComponent(vmIp)}`)}
              style={{
                textAlign: 'left', cursor: 'pointer', background: 'var(--surface)',
                border: `1px solid ${isBuilding ? 'var(--primary)' : 'var(--border)'}`,
                borderRadius: 10, padding: '20px 18px',
                transition: 'border-color 0.15s, box-shadow 0.15s',
                boxShadow: isBuilding ? '0 0 0 1px var(--primary)' : 'none',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.boxShadow = '0 0 0 1px var(--primary)' }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = isBuilding ? 'var(--primary)' : 'var(--border)'
                e.currentTarget.style.boxShadow   = isBuilding ? '0 0 0 1px var(--primary)' : 'none'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 28 }}>{app.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{app.label}</div>
                  {s && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 3, fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 10, background: statusBg(s), color: statusColor(s) }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusDot(s), display: 'inline-block' }} />
                      {s}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{app.desc}</div>
              <BuildProgress build={build} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
