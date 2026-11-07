import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

const VM_STORAGE_KEY      = 'remote_app_dev_vm'
const BRANCH_TTL_KEY      = 'rcache_branch_ttl'
const SERVER_RATE_KEY     = 'rcache_server_rate'
const DEFAULT_BRANCH_TTL  = 600000  // 10 min
const DEFAULT_SERVER_RATE = 300000  // 5 min

const BRANCH_TTL_OPTS = [
  { label: 'No cache', value: 0        },
  { label: '2 min',    value: 120000   },
  { label: '5 min',    value: 300000   },
  { label: '10 min',   value: 600000   },
  { label: '30 min',   value: 1800000  },
  { label: '1 hr',     value: 3600000  },
]
const SERVER_RATE_OPTS = [
  { label: 'Off',   value: 0        },
  { label: '1 min', value: 60000    },
  { label: '2 min', value: 120000   },
  { label: '3 min', value: 180000   },
  { label: '5 min', value: 300000   },
  { label: '10 min', value: 600000  },
  { label: '15 min', value: 900000  },
  { label: '20 min', value: 1200000 },
  { label: '30 min', value: 1800000 },
]

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

const selStyle = {
  fontSize: 11, padding: '2px 5px', borderRadius: 5,
  border: '1px solid var(--border)', background: 'var(--surface)',
  color: 'var(--text-muted)', cursor: 'pointer',
}

import { TabBar, ScmTab } from './LocalAppShared'
import { ScreenCfgProvider, ScreenConfigButton } from './ScreenConfig'
import { GpRunTab } from './GpRunPage'
import ItTab from './ItTab'
import {
  RemoteDeployedBanner,  // used in header — handles all apps
  RemoteCodeTab, RemoteSimpleServerTab, RemoteAppServerTab,
  RemoteQueueTab, RemoteFullApiTab, RemoteUserInterfaceTab, RemoteDatabaseTab,
} from './RemoteAppShared'

const DEFAULT_SCREEN_CFG = {
  header: {
    back_button:     { enabled: true },
    app_logo:        { enabled: true },
    branch_banner:   { enabled: true },
    deployed_banner: { enabled: true },
  },
  tabs: [
    { key: 'code',       label: 'Code',       enabled: true, order: 1 },
    { key: 'app_server', label: 'App Server', enabled: true, order: 2 },
    { key: 'scm',        label: 'Pull Requests', enabled: true, order: 98 },
    { key: 'gp_run',     label: '🚀 GP Run',  enabled: true, order: 99 },
  ],
  panels: [
    { key: 'current_branch',    label: 'Environment',       enabled: true, order: 1 },
    { key: 'set_branch',        label: 'Set Branch',        enabled: true, order: 2 },
    { key: 'branch_management', label: 'Branch Management', enabled: true, order: 3 },
    { key: 'build_deploy',      label: 'Build & Deploy',    enabled: true, order: 4 },
    { key: 'modules',           label: 'Modules',           enabled: true, order: 5 },
    { key: 'terminal',          label: 'Open in Terminal',  enabled: true, order: 6 },
  ],
  build_flags: null,
  settings: {},
}

export default function GenericRemoteAppPage({
  appName,
  displayName,
  icon,
  defaultVm,
  backPath  = '/remote-app',
  backLabel = 'Remote App Development',
  serverTabVariant = 'simple',
  defaultServerType = null,
}) {
  const navigate       = useNavigate()
  const [searchParams] = useSearchParams()
  const [vmIp,           setVmIp]           = useState(
    () => searchParams.get('vm_ip') || localStorage.getItem(VM_STORAGE_KEY) || defaultVm || ''
  )
  const [activeTab,      setActiveTab]      = useState('code')
  const [screenCfg,      setScreenCfg]      = useState(DEFAULT_SCREEN_CFG)
  const [branch,         setBranch]         = useState(null)
  const [branchLoad,     setBranchLoad]     = useState(false)
  const [branchErr,      setBranchErr]      = useState(null)
  const [releaseBranch,  setReleaseBranch]  = useState(null)
  const [featureBranch,  setFeatureBranch]  = useState(null)
  const [gitBranch,      setGitBranch]      = useState(null)
  const [pulling,        setPulling]        = useState(false)
  const [pullOk,         setPullOk]         = useState(false)
  const [pullErr,        setPullErr]        = useState(null)
  const [branchMgmtTick, setBranchMgmtTick] = useState(0)
  const [serverUp,       setServerUp]       = useState(null)
  const [serverChecking, setServerChecking] = useState(false)

  const [branchTtl, setBranchTtl] = useState(() => {
    const v = parseInt(localStorage.getItem(BRANCH_TTL_KEY), 10)
    return BRANCH_TTL_OPTS.some(o => o.value === v) ? v : DEFAULT_BRANCH_TTL
  })
  const [serverRefreshMs, setServerRefreshMs] = useState(() => {
    const v = parseInt(localStorage.getItem(SERVER_RATE_KEY), 10)
    return SERVER_RATE_OPTS.some(o => o.value === v) ? v : DEFAULT_SERVER_RATE
  })
  const branchTtlRef     = useRef(branchTtl)
  const serverRefreshRef = useRef(serverRefreshMs)
  const serverPollRef    = useRef(null)
  useEffect(() => { branchTtlRef.current = branchTtl },          [branchTtl])
  useEffect(() => { serverRefreshRef.current = serverRefreshMs }, [serverRefreshMs])

  function saveBranchTtl(v) { setBranchTtl(v); localStorage.setItem(BRANCH_TTL_KEY, String(v)) }
  function saveServerRate(v) { setServerRefreshMs(v); localStorage.setItem(SERVER_RATE_KEY, String(v)) }

  useEffect(() => {
    fetch(`/api/remote-app/${appName}/screen-config`)
      .then(r => r.json())
      .then(d => {
        if (!d.ok) return
        const serverTabs = d.tabs || []
        const mergedTabs = DEFAULT_SCREEN_CFG.tabs.map(dt => {
          const st = serverTabs.find(s => s.key === dt.key)
          return st ? { ...dt, ...st } : dt
        })
        serverTabs.forEach(st => { if (!mergedTabs.find(m => m.key === st.key)) mergedTabs.push(st) })
        setScreenCfg({ ...d, tabs: mergedTabs })
      })
      .catch(() => {})
  }, [appName])

  const [appTitle, setAppTitle] = useState('')
  const loadAppTitle = () => fetch(`/api/remote-app/${appName}/application-info`).then(r => r.json()).then(r => { if (r.ok) setAppTitle(r.saved?.application_name || '') }).catch(() => {})
  useEffect(() => { loadAppTitle() }, [appName])

  function reloadScreenCfg() {
    loadAppTitle()
    fetch(`/api/remote-app/${appName}/screen-config?force=1`).then(r => r.json()).then(d => {
      if (!d.ok) return
      const serverTabs = d.tabs || []
      const mergedTabs = DEFAULT_SCREEN_CFG.tabs.map(dt => { const st = serverTabs.find(x => x.key === dt.key); return st ? { ...dt, ...st } : dt })
      serverTabs.forEach(st => { if (!mergedTabs.find(m => m.key === st.key)) mergedTabs.push(st) })
      setScreenCfg({ ...d, tabs: mergedTabs })
    }).catch(() => {})
  }

  function loadBranch(force = false) {
    if (!vmIp) return
    const cacheKey = `rcache_branch_${appName}_${vmIp}`
    if (!force && branchTtlRef.current > 0) {
      const cached = cacheGet(cacheKey)
      if (cached !== undefined) { setBranch(cached); setBranchLoad(false); return }
    }
    if (force) localStorage.removeItem(cacheKey)
    setBranchLoad(true); setBranchErr(null)
    fetch(`/api/remote-app/${appName}/current-branch?vm_ip=${encodeURIComponent(vmIp)}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setBranch(d); cacheSet(cacheKey, d, branchTtlRef.current) }
        else setBranchErr(d.error || 'Failed')
      })
      .catch(() => setBranchErr('Could not reach server'))
      .finally(() => setBranchLoad(false))
  }

  function forceRefreshBranch() {
    localStorage.removeItem(`rcache_branch_${appName}_${vmIp}`)
    loadBranch(true)
  }

  useEffect(() => {
    fetch(`/api/local-app/${appName}/current-branch`)
      .then(r => r.json())
      .then(d => { if (d.ok && d.branch) setReleaseBranch(d.branch) })
      .catch(() => {})
    fetch(`/api/local-app/${appName}/git-local-branches`)
      .then(r => r.json())
      .then(d => { if (d.ok && d.current) setFeatureBranch(d.current) })
      .catch(() => {})
  }, [appName])

  useEffect(() => {
    if (!vmIp) return
    const cacheKey = `rcache_branch_${appName}_${vmIp}`
    // Branch warm — serve immediately and fetch server status separately
    if (branchTtlRef.current > 0) {
      const cached = cacheGet(cacheKey)
      if (cached !== undefined) { setBranch(cached); setBranchLoad(false); checkServer(); return }
    }
    // Cold cache — use all/page-init to batch ALL apps over one SSH connection.
    // Stores branch/modules/server for every app in localStorage so navigating
    // between apps is instant (no re-fetch within the TTL window).
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
      })
      .catch(() => setBranchErr('Could not reach server'))
      .finally(() => setBranchLoad(false))
  }, [vmIp, appName])

  function handlePull() {
    if (!vmIp) return
    setPulling(true); setPullOk(false); setPullErr(null)
    fetch(`/api/remote-app/${appName}/git-pull`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vm_ip: vmIp }) })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setPullOk(true); loadBranch(true) }  // force=true clears cache after pull
        else setPullErr(d.error || 'Pull failed')
      })
      .catch(() => setPullErr('Could not reach server'))
      .finally(() => setPulling(false))
  }

  function checkServer(force = false) {
    if (!vmIp) return
    const cacheKey = `rcache_server_${appName}_${vmIp}`
    if (!force) {
      const cached = cacheGet(cacheKey)
      if (cached !== undefined) { setServerUp(cached); return }
    }
    setServerChecking(true)
    fetch(`/api/remote-app/${appName}/server-status?vm_ip=${encodeURIComponent(vmIp)}`)
      .then(r => r.json())
      .then(d => {
        const up = d.ok ? !!d.running : null
        setServerUp(up)
        if (serverRefreshRef.current > 0) cacheSet(cacheKey, up, serverRefreshRef.current)
      })
      .catch(() => {})
      .finally(() => setServerChecking(false))
  }

  useEffect(() => {
    clearInterval(serverPollRef.current)
    checkServer()
    if (serverRefreshMs > 0) serverPollRef.current = setInterval(() => checkServer(), serverRefreshMs)
    return () => clearInterval(serverPollRef.current)
  }, [vmIp, appName, serverRefreshMs])

  const hdr         = screenCfg.header || DEFAULT_SCREEN_CFG.header
  const _baseTabs  = screenCfg.tabs || DEFAULT_SCREEN_CFG.tabs
  const visibleTabs = (_baseTabs.some(t => t.key === 'it') ? _baseTabs : [..._baseTabs, { key: 'it', label: '🧪 IT', enabled: true, order: (_baseTabs.find(t => t.key === 'code')?.order ?? 0) + 0.5 }]).filter(t => t.enabled !== false).sort((a, b) => a.order - b.order)
  const resolvedTab = visibleTabs.find(t => t.key === activeTab)?.key ?? visibleTabs[0]?.key ?? 'code'

  const codeTabProps = {
    vmIp, appName, appLabel: displayName, appIcon: icon,
    screenCfg, defaultPanels: DEFAULT_SCREEN_CFG.panels,
    branch, branchLoad, branchErr, loadBranch,
    handlePull, pulling, pullOk, pullErr,
    branchMgmtTick, setBranchMgmtTick,
    onGitBranchChange: setGitBranch,
  }

  return (
    <ScreenCfgProvider cfg={screenCfg}>
    <div>
      {/* ── Header — single row ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface, rgba(128,128,128,0.04))' }}>

        {hdr.back_button?.enabled !== false && (
          <>
            <button className="btn back-link" style={{ marginBottom: 0 }} onClick={() => navigate(backPath)}>
              ← {backLabel}
            </button>
            <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>/</span>
          </>
        )}

        {hdr.app_logo?.enabled !== false && (
          <span style={{ fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap' }}>{icon} {appTitle || displayName}</span>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>VM:</span>
          <input type="text" value={vmIp} onChange={e => setVmIp(e.target.value)}
            placeholder="e.g. 10.192.x.x"
            style={{ width: 130, fontSize: 12, padding: '3px 7px', border: '1px solid var(--border-color)', borderRadius: 4, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }} />
        </div>

        <span style={{ color: 'var(--border)', fontSize: 14 }}>|</span>

        {hdr.branch_banner?.enabled !== false && (
          branchLoad
            ? <span className="spinner" style={{ width: 11, height: 11 }} />
            : branch?.branch
              ? <>
                  <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 9px', borderRadius: 12, background: 'rgba(76,175,80,0.1)', color: '#2e7d32', border: '1px solid rgba(76,175,80,0.3)', whiteSpace: 'nowrap' }}>
                    {branch.branch}
                  </span>
                  {branch.release_ver && (
                    <code style={{ fontSize: 11, padding: '2px 7px', borderRadius: 8, background: 'var(--surface2, rgba(128,128,128,0.08))', color: 'var(--text-muted)', border: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                      {branch.release_ver}
                    </code>
                  )}
                </>
              : branchErr
                ? <span style={{ fontSize: 11, color: '#c62828' }} title={branchErr}>⚠ branch err</span>
                : null
        )}

        {hdr.deployed_banner?.enabled !== false && (
          <RemoteDeployedBanner vmIp={vmIp} appName={appName} serverUp={serverUp} noMargin />
        )}

        <button
          onClick={() => checkServer(true)}
          disabled={serverChecking}
          title="Refresh server status"
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, cursor: serverChecking ? 'default' : 'pointer', color: 'var(--text-muted)', fontSize: 13, padding: '2px 7px', lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: 4 }}>
          {serverChecking
            ? <span className="spinner" style={{ width: 10, height: 10 }} />
            : '⟳'}
        </button>

        <ScreenConfigButton kind="remote" appName={appName} cfg={screenCfg} onSaved={reloadScreenCfg} onDeleted={() => navigate(backPath)} />

      </div>

      <TabBar visibleTabs={visibleTabs} resolvedTab={resolvedTab} onTabChange={setActiveTab} />

      {resolvedTab === 'code' && <RemoteCodeTab {...codeTabProps} />}

      {resolvedTab === 'app_server' && (
        serverTabVariant === 'rich'
          ? <RemoteAppServerTab vmIp={vmIp} appName={appName} displayName={displayName}
              serverType={screenCfg.settings?.app_server_type || defaultServerType}
              serverTypeRules={screenCfg.server_type_rules}
              defaultServerType={defaultServerType}
              branchInfo={branch}
              onOpSuccess={() => setServerUp(true)} />
          : <RemoteSimpleServerTab vmIp={vmIp} appName={appName} displayName={displayName} />
      )}

      {resolvedTab === 'database' && <RemoteDatabaseTab vmIp={vmIp} appName={appName} />}

      {resolvedTab === 'queue' && <RemoteQueueTab vmIp={vmIp} appName={appName} />}

      {resolvedTab === 'api' && (
        <RemoteFullApiTab vmIp={vmIp} appName={appName} serverUp={serverUp} />
      )}

      {resolvedTab === 'user_interface' && (
        <RemoteUserInterfaceTab vmIp={vmIp} appName={appName} />
      )}

      {resolvedTab === 'scm' && (
        <ScmTab appName={appName} branch={gitBranch || branch?.git_branch || branch?.branch} />
      )}

      {resolvedTab === 'it' && <ItTab appName={appName} scope="remote" vmIp={vmIp} />}

      {resolvedTab === 'gp_run' && (
        <GpRunTab app={appName === 'pik' ? 'PIK' : appName.charAt(0).toUpperCase() + appName.slice(1)} branch={branch?.branch} releaseBranch={(branch?.branch === 'master' || branch?.branch === 'main') ? branch.branch : (branch?.release_ver || branch?.branch)} featureBranch={gitBranch || branch?.git_branch || branch?.branch} />
      )}

      {!['code', 'app_server', 'database', 'queue', 'api', 'user_interface', 'scm', 'gp_run', 'it'].includes(resolvedTab) && (
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🚧</div>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>
            {visibleTabs.find(t => t.key === resolvedTab)?.label || resolvedTab}
          </div>
          <div style={{ fontSize: 14 }}>This section is under construction.</div>
        </div>
      )}
    </div>
    </ScreenCfgProvider>
  )
}
