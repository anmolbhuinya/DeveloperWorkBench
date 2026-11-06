import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AppServerTab, DatabaseTab, QueueTab, ApiTab, UserInterfaceTab, CodeTab, ScmTab, PageHeader, TabBar } from './LocalAppShared'
import { GpRunTab } from './GpRunPage'
import ItTab from './ItTab'
import AppMapTab from './AppMapTab'
import P6SpyTab from './P6SpyTab'

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
    { key: 'current_branch',    label: 'Current Branch',    enabled: true, order: 1 },
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

  const hdr         = screenCfg.header || DEFAULT_SCREEN_CFG.header
  const _baseTabs  = screenCfg.tabs || DEFAULT_SCREEN_CFG.tabs
  const _codeOrder = _baseTabs.find(t => t.key === 'code')?.order ?? 0
  const _withIt    = _baseTabs.some(t => t.key === 'it') ? _baseTabs : [..._baseTabs, { key: 'it', label: '🧪 IT', enabled: true, order: _codeOrder + 0.5 }]
  const _itOrder   = _withIt.find(t => t.key === 'it')?.order ?? _codeOrder + 0.5
  const _vt0 = (_withIt.some(t => t.key === 'appmap') ? _withIt : [..._withIt, { key: 'appmap', label: '🗺️ AppMap', enabled: true, order: _itOrder + 0.1 }]).filter(t => t.enabled !== false && t.key !== 'app_config').sort((a, b) => a.order - b.order)
  const visibleTabs = (_vt0.some(t => t.key === 'p6spy') ? _vt0 : [..._vt0, { key: 'p6spy', label: '\uD83D\uDD2C P6Spy', enabled: true, order: (_vt0.find(t => t.key === 'appmap')?.order ?? _itOrder + 0.1) + 0.05 }]).sort((a, b) => a.order - b.order)
  const resolvedTab = visibleTabs.find(t => t.key === activeTab)?.key ?? visibleTabs[0]?.key ?? 'code'
  return (
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
        displayName={displayName} icon={icon}
        backPath={backPath} backLabel={backLabel}
        branch={branch} deployed={deployed} serverUp={serverUp}
        hdr={hdr}
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
      {resolvedTab === 'appmap' && <AppMapTab appName={appName} displayName={displayName} />}
      {resolvedTab === 'p6spy' && <P6SpyTab appName={appName} />}

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
      {!['code', 'app_server', 'database', 'queue', 'api', 'user_interface', 'app_config', 'scm', 'gp_run', 'it', 'appmap', 'p6spy'].includes(resolvedTab) && (
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🚧</div>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>
            {visibleTabs.find(t => t.key === resolvedTab)?.label || resolvedTab}
          </div>
          <div style={{ fontSize: 14 }}>This section is under construction.</div>
        </div>
      )}
    </div>
  )
}
