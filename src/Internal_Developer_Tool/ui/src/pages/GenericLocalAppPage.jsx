import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AppServerTab, DatabaseTab, QueueTab, ApiTab, UserInterfaceTab, CodeTab, ScmTab, PageHeader, TabBar } from './LocalAppShared'
import { GpRunTab } from './GpRunPage'
import ItTab from './ItTab'
import AppMapTab from './AppMapTab'
import P6SpyTab from './P6SpyTab'
import InvestigationTab from './InvestigationTab'
import EventsTab from './EventsTab'
import { ScreenCfgProvider, ScreenConfigButton, resolveLocalTabs, usePanels } from './ScreenConfig'
import { CacheTab, LdapTab, VaultTab } from './ServiceTabs'
import { LogsTab, MetricsTab, ApplicationTraceTab } from './ObservabilityTabs'

// icon shown in front of a tab label that has none of its own
const TAB_ICONS = {
  code: '💻', app_server: '🖥️', database: '🗄️', queue: '📨', api: '🔌', user_interface: '🖼️',
  scm: '🔀', app_config: '⚙️', it: '🧪', gp_run: '🚀', cache: '⚡', ldap: '📇', vault: '🔐',
  observability: '🔭', investigation: '🔎', sonar: '🛡️', logs: '📜', metrics: '📊',
}
let _obsSub = 'metrics'
const _obsInner = { traces: 'appmap', logs: 'p6spy' }
function Pills2({ items, value, onChange, small }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
      {items.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)}
          style={{ padding: small ? '3px 10px' : '5px 14px', fontSize: small ? 12 : 13, borderRadius: 16, cursor: 'pointer', border: '1px solid var(--border)',
            background: value === t.key ? 'var(--primary, #2563eb)' : 'transparent', color: value === t.key ? '#fff' : 'inherit' }}>{t.label}</button>
      ))}
    </div>
  )
}
function ObservabilityTab({ appName, displayName }) {
  const [sub0, setSub] = useState(_obsSub)
  const [inner, setInner] = useState({ ..._obsInner })
  const on = usePanels()
  const pick = k => { _obsSub = k; setSub(k) }
  const pickInner = (g, k) => { _obsInner[g] = k; setInner({ ..._obsInner }) }
  const subs = [{ key: 'metrics', label: '📊 Metrics' }, { key: 'events', label: '📅 Events' }, { key: 'traces', label: '🧵 Traces' }, { key: 'logs', label: '📜 Logs' }].filter(x => on('obs_' + x.key))
  const sub = subs.some(x => x.key === sub0) ? sub0 : subs[0]?.key
  const tItems = [{ key: 'appmap', label: '🗺️ AppMap', p: 'tr_appmap' }, { key: 'apptrace', label: 'Application Trace', p: 'tr_apptrace' }].filter(x => on(x.p))
  const lItems = [{ key: 'p6spy', label: '🔬 P6Spy', p: 'lg_p6spy' }, { key: 'applog', label: 'Application Log', p: 'lg_applog' }].filter(x => on(x.p))
  const tSel = tItems.some(x => x.key === inner.traces) ? inner.traces : tItems[0]?.key
  const lSel = lItems.some(x => x.key === inner.logs) ? inner.logs : lItems[0]?.key
  return (
    <div>
      <Pills2 items={subs} value={sub} onChange={pick} />
      {subs.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>All Observability panels are switched off - turn some on with the settings icon at the top right.</div>}
      {sub === 'metrics' && <MetricsTab appName={appName} />}
      {sub === 'events' && <EventsTab appName={appName} />}
      {sub === 'traces' && <>
        <Pills2 small value={tSel} onChange={k => pickInner('traces', k)} items={tItems} />
        {tSel === 'appmap' && <AppMapTab appName={appName} displayName={displayName} />}
        {tSel === 'apptrace' && <ApplicationTraceTab appName={appName} />}
      </>}
      {sub === 'logs' && <>
        <Pills2 small value={lSel} onChange={k => pickInner('logs', k)} items={lItems} />
        {lSel === 'applog' && <LogsTab appName={appName} />}
        {lSel === 'p6spy' && <P6SpyTab appName={appName} />}
      </>}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <div className="meta-label">{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500, marginTop: 3 }}>{children}</div>
    </div>
  )
}

// ── App Config Panel ───────────────────────────────────────────────────────────
function AppConfigPanel({ appName }) {
  const [config,   setConfig]   = useState({})
  const [loading,  setLoading]  = useState(true)
  const [editing,  setEditing]  = useState(false)
  const [draft,    setDraft]    = useState({})
  const [saving,   setSaving]   = useState(false)
  const [err,      setErr]      = useState(null)

  function load() {
    setLoading(true)
    fetch(`/api/local-app/${appName}/app-config`)
      .then(r => r.json())
      .then(d => { if (d.ok) setConfig(d.config || {}); else setErr(d.error) })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [appName])

  function save() {
    setSaving(true)
    fetch(`/api/local-app/${appName}/app-config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    })
      .then(r => r.json())
      .then(d => { if (d.ok) { setConfig(d.config || {}); setEditing(false) } else setErr(d.error) })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setSaving(false))
  }

  if (loading) return <div className="card"><span className="spinner" /></div>

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>App Config</div>
        {!editing && <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => { setEditing(true); setDraft({ ...config }) }}>Edit</button>}
      </div>

      {err && <div className="alert alert-error" style={{ marginBottom: 10 }}>{err}</div>}

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { key: 'container', label: 'Docker Container Name', placeholder: 'e.g. classic-tc' },
            { key: 'port',      label: 'Server Port',           placeholder: 'e.g. 7002' },
            { key: 'git_path',  label: 'Git Repository Path',   placeholder: 'C:/Users/you/git/app-source' },
          ].map(f => (
            <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>{f.label}</span>
              <input
                value={draft[f.key] ?? ''}
                onChange={e => setDraft(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                style={{ fontSize: 13, padding: '6px 10px' }}
              />
            </label>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button className="btn btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Field label="Container">{config.container ? <code>{config.container}</code> : <em style={{ color: 'var(--text-muted)', fontSize: 12 }}>not set</em>}</Field>
          <Field label="Port">{config.port || <em style={{ color: 'var(--text-muted)', fontSize: 12 }}>not set</em>}</Field>
          <Field label="Git Path">
            <code style={{ fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-all' }}>
              {config.git_path || <em>not set</em>}
            </code>
          </Field>
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

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
    { key: 'app_config', label: 'App Config', enabled: true, order: 3 },
    { key: 'scm',        label: 'Pull Requests', enabled: true, order: 98 },
    { key: 'gp_run',     label: '🚀 GP Run',  enabled: true, order: 99 },
  ],
  panels: [
    { key: 'current_branch',    label: 'Environment',       enabled: true, order: 1 },
    { key: 'set_branch',        label: 'Set Branch',        enabled: true, order: 2 },
    { key: 'branch_management', label: 'Branch Management', enabled: true, order: 3 },
    { key: 'build_deploy',      label: 'Build & Deploy',    enabled: true, order: 4 },
    { key: 'modules',           label: 'Modules',           enabled: true, order: 5 },
    { key: 'ide',               label: 'Open in IDE',       enabled: true, order: 6 },
    { key: 'terminal',          label: 'Open in Terminal',  enabled: true, order: 7 },
  ],
  build_flags: null,
}

export default function GenericLocalAppPage({
  appName,
  displayName,
  icon,
  backPath = '/local-app',
  backLabel = 'Local App Development',
  description,
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const fromSonar = location.state?.from === 'sonar-report'

  const [activeTab,      setActiveTab]      = useState(location.state?.openTab || 'code')
  const [screenCfg,      setScreenCfg]      = useState(DEFAULT_SCREEN_CFG)
  const [branch,         setBranch]         = useState(null)
  const [deployed,       setDeployed]       = useState(undefined)
  const [serverUp,       setServerUp]       = useState(null)
  const [currentBranch,  setCurrentBranch]  = useState(null)
  const [featureBranch,  setFeatureBranch]  = useState(null)

  const [appTitle, setAppTitle] = useState('')
  const loadAppTitle = () => fetch(`/api/local-app/${appName}/application-info`).then(r => r.json()).then(r => { if (r.ok) setAppTitle(r.saved?.application_name || '') }).catch(() => {})
  useEffect(() => { loadAppTitle() }, [appName])

  function reloadScreenCfg() {
    loadAppTitle()
    fetch(`/api/local-app/${appName}/screen-config?force=1`).then(r => r.json()).then(d => {
      if (!d.ok) return
      const serverTabs = d.tabs || []
      const mergedTabs = DEFAULT_SCREEN_CFG.tabs.map(dt => { const st = serverTabs.find(x => x.key === dt.key); return st ? { ...dt, ...st } : dt })
      serverTabs.forEach(st => { if (!mergedTabs.find(m => m.key === st.key)) mergedTabs.push(st) })
      setScreenCfg({ ...d, tabs: mergedTabs })
    }).catch(() => {})
  }

  function refreshDeployed() {
    fetch(`/api/local-app/${appName}/deployed-info`)
      .then(r => r.json())
      .then(d => setDeployed(d.ok && d.branch ? d : null))
      .catch(() => setDeployed(null))
  }

  useEffect(() => {
    fetch(`/api/local-app/${appName}/current-branch`)
      .then(r => r.json())
      .then(d => { if (d.ok) setBranch(d) })
      .catch(() => {})
    fetch(`/api/local-app/${appName}/git-local-branches`)
      .then(r => r.json())
      .then(d => { if (d.ok && d.current) setFeatureBranch(d.current) })
      .catch(() => {})
    refreshDeployed()
    fetch(`/api/local-app/${appName}/screen-config`)
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
    function pollServer() {
      fetch(`/api/local-app/${appName}/server-status`)
        .then(r => r.json())
        .then(d => { if (d.ok) setServerUp(!!(d.running ?? d[appName])) })
        .catch(() => {})
    }
    pollServer()
    const id = setInterval(pollServer, 5000)
    return () => clearInterval(id)
  }, [appName])

  useEffect(() => {
    const h = e => { const d = e.detail || {}; if (d.sub) _obsSub = d.sub; Object.assign(_obsInner, d.inner || {}); setActiveTab(d.tab || 'observability') }
    window.addEventListener('dwb-nav', h)
    return () => window.removeEventListener('dwb-nav', h)
  }, [])
  const hdr         = screenCfg.header || DEFAULT_SCREEN_CFG.header
  const visibleTabs = resolveLocalTabs(screenCfg.tabs || DEFAULT_SCREEN_CFG.tabs, !!screenCfg.settings?.tabs_custom)
    .filter(t => t.enabled !== false && t.key !== 'app_config')
    .map(t => (TAB_ICONS[t.key] && !/^\p{Extended_Pictographic}/u.test(String(t.label || '').trim())) ? { ...t, label: TAB_ICONS[t.key] + ' ' + t.label } : t)
    .sort((a, b) => a.order - b.order)
  const resolvedTab = visibleTabs.find(t => t.key === activeTab)?.key ?? visibleTabs[0]?.key ?? 'code'
  return (
    <ScreenCfgProvider cfg={screenCfg}>
    <div>
      {fromSonar && (
        <div style={{ marginBottom: 10 }}>
          <button
            onClick={() => navigate('/developer-tools/sonar-report')}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            ← Back to Sonar Report
          </button>
        </div>
      )}
      <PageHeader
        displayName={appTitle || displayName} icon={icon}
        backPath={backPath} backLabel={backLabel}
        branch={branch} deployed={deployed} serverUp={serverUp}
        hdr={hdr}
        right={<ScreenConfigButton kind="local" appName={appName} cfg={screenCfg} onSaved={reloadScreenCfg} onDeleted={() => navigate(backPath)} />}
      />
      <TabBar visibleTabs={visibleTabs} resolvedTab={resolvedTab} onTabChange={setActiveTab} />

      {/* ── Code tab ── */}
      {resolvedTab === 'code' && <CodeTab appName={appName} displayName={displayName} icon={icon} onDeployed={refreshDeployed} onBranchChange={setCurrentBranch} />}

      {/* ── App Server tab ── */}
      {resolvedTab === 'app_server' && <AppServerTab appName={appName} displayName={displayName} serverType={screenCfg.settings?.app_server_type} />}

      {/* ── Database tab ── */}
      {resolvedTab === 'database' && <DatabaseTab appName={appName} displayName={displayName} />}

      {/* ── Queue tab ── */}
      {resolvedTab === 'queue' && <QueueTab appName={appName} displayName={displayName} />}

      {/* ── API tab ── */}
      {resolvedTab === 'api' && <ApiTab appName={appName} displayName={displayName} />}
      {resolvedTab === 'user_interface' && <UserInterfaceTab appName={appName} displayName={displayName} />}

      {/* ── SCM tab ── */}
      {resolvedTab === 'scm' && (
        <ScmTab appName={appName} branch={currentBranch || branch?.branch} />
      )}

      {/* ── IT tab ── */}
      {resolvedTab === 'it' && <ItTab appName={appName} scope="local" />}

      {/* ── AppMap tab ── */}
      {resolvedTab === 'observability' && <ObservabilityTab appName={appName} displayName={displayName} />}
      {resolvedTab === 'investigation' && <InvestigationTab appName={appName} />}
      {resolvedTab === 'cache' && <CacheTab appName={appName} />}
      {resolvedTab === 'ldap' && <LdapTab appName={appName} />}
      {resolvedTab === 'vault' && <VaultTab appName={appName} />}

      {/* ── GP Run tab ── */}
      {resolvedTab === 'gp_run' && (
        <GpRunTab autoNewRun={!!location.state?.newRun} app={appName === 'pik' ? 'PIK' : appName.charAt(0).toUpperCase() + appName.slice(1)} branch={branch?.branch} releaseBranch={branch?.branch} featureBranch={currentBranch || featureBranch} />
      )}

      {/* ── App Config tab ── */}
      {resolvedTab === 'app_config' && (
        <div style={{ maxWidth: 600 }}>
          <AppConfigPanel appName={appName} />
          {description && (
            <div className="card" style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>About {displayName}</div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>{description}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Other tabs: placeholder ── */}
      {!['code', 'app_server', 'database', 'queue', 'api', 'user_interface', 'app_config', 'scm', 'gp_run', 'it', 'observability', 'investigation', 'cache', 'ldap', 'vault'].includes(resolvedTab) && (
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
