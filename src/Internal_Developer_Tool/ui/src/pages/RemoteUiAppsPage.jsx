import { useState, useEffect } from 'react'

const API = '/api/remote-app/ui-apps'

const APP_ICONS = { manager: '🖥️', designer: '✏️', admin: '🔐' }

export default function RemoteUiAppsPage() {
  const [apps, setApps]         = useState([])
  const [config, setConfig]     = useState({ base_url: '', version: '' })
  const [loading, setLoading]   = useState(true)
  const [err, setErr]           = useState(null)
  const [editConfig, setEditConfig]   = useState(false)
  const [draftConfig, setDraftConfig] = useState({})
  const [savingConfig, setSavingConfig] = useState(false)
  const [appActions, setAppActions]   = useState({})
  const [editPath, setEditPath]       = useState({})
  const [editingPath, setEditingPath] = useState(null)

  const load = () => {
    setLoading(true)
    fetch(API)
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setConfig(d.config); setApps(d.apps) }
        else setErr(d.error)
      })
      .catch(e => setErr(String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const setAction = (id, state) => setAppActions(p => ({ ...p, [id]: state }))

  const doPost = (id, endpoint, onDone) => {
    setAction(id, { loading: true, msg: null, err: null })
    fetch(`${API}/${id}/${endpoint}`, { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        setAction(id, { loading: false, msg: d.ok ? d.message : null, err: d.ok ? null : d.error })
        if (d.ok && onDone) onDone()
      })
      .catch(e => setAction(id, { loading: false, msg: null, err: String(e) }))
  }

  const saveConfig = () => {
    setSavingConfig(true)
    fetch(`${API}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draftConfig),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setConfig(d.config); setApps(d.apps); setEditConfig(false); setDraftConfig({}) }
        else alert(d.error)
      })
      .catch(e => alert(String(e)))
      .finally(() => setSavingConfig(false))
  }

  const saveInstallPath = (appId) => {
    fetch(`${API}/${appId}/install-path`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ install_path: editPath[appId] ?? '' }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setApps(d.apps); setEditingPath(null) }
        else alert(d.error)
      })
      .catch(e => alert(String(e)))
  }

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>
  if (err)     return <div style={{ padding: 24, color: '#c62828' }}>Error: {err}</div>

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>User Interface Apps</h2>
      <p style={{ margin: '0 0 20px', color: '#666', fontSize: 14 }}>
        Manage HealthEdge desktop applications — install, open, or uninstall.
      </p>

      {/* Config bar */}
      <div style={{
        background: '#f5f7fa', border: '1px solid #e0e4ea', borderRadius: 8,
        padding: '12px 16px', marginBottom: 24,
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        {editConfig ? (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span style={{ whiteSpace: 'nowrap', color: '#555', fontWeight: 500 }}>Base URL:</span>
              <input
                style={{ width: 340, fontSize: 13, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4 }}
                value={draftConfig.base_url ?? config.base_url}
                onChange={e => setDraftConfig(p => ({ ...p, base_url: e.target.value }))}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span style={{ whiteSpace: 'nowrap', color: '#555', fontWeight: 500 }}>Version:</span>
              <input
                style={{ width: 180, fontSize: 13, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4 }}
                value={draftConfig.version ?? config.version}
                onChange={e => setDraftConfig(p => ({ ...p, version: e.target.value }))}
              />
            </label>
            <button className="btn btn-sm btn-primary" onClick={saveConfig} disabled={savingConfig}>
              {savingConfig ? 'Saving…' : 'Save'}
            </button>
            <button className="btn btn-sm" onClick={() => { setEditConfig(false); setDraftConfig({}) }}>Cancel</button>
          </>
        ) : (
          <>
            <span style={{ fontSize: 13, color: '#444' }}>
              <strong>Base URL:</strong>&nbsp;
              {config.base_url ? <code style={{ fontSize: 12 }}>{config.base_url}</code> : <em style={{ color: '#aaa' }}>not set</em>}
            </span>
            <span style={{ fontSize: 13, color: '#444' }}>
              &nbsp;|&nbsp;<strong>Version:</strong>&nbsp;
              {config.version ? <code style={{ fontSize: 12 }}>{config.version}</code> : <em style={{ color: '#aaa' }}>not set</em>}
            </span>
            <button className="btn btn-sm" style={{ marginLeft: 'auto' }}
              onClick={() => { setEditConfig(true); setDraftConfig({}) }}>
              Edit Config
            </button>
          </>
        )}
      </div>

      {/* App tiles */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {apps.map(app => {
          const action = appActions[app.app_id] || {}
          return (
            <AppTile
              key={app.app_id}
              app={app}
              action={action}
              editingPath={editingPath === app.app_id}
              editPathVal={editPath[app.app_id] ?? app.install_path}
              onEditPath={() => { setEditPath(p => ({ ...p, [app.app_id]: app.install_path })); setEditingPath(app.app_id) }}
              onPathChange={v => setEditPath(p => ({ ...p, [app.app_id]: v }))}
              onSavePath={() => saveInstallPath(app.app_id)}
              onCancelPath={() => setEditingPath(null)}
              onInstall={() => doPost(app.app_id, 'install')}
              onOpen={() => doPost(app.app_id, 'open')}
              onUninstall={() => {
                if (!confirm(`Uninstall ${app.display_name}?`)) return
                doPost(app.app_id, 'uninstall', load)
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

function AppTile({ app, action, editingPath, editPathVal, onEditPath, onPathChange, onSavePath, onCancelPath, onInstall, onOpen, onUninstall }) {
  const icon = APP_ICONS[app.app_id] || '📦'

  return (
    <div style={{
      width: 300, border: '1px solid #dde2ea', borderRadius: 10, padding: 20,
      background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.06)',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 30 }}>{icon}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{app.display_name}</div>
          <div style={{
            fontSize: 12, fontWeight: 600, marginTop: 2,
            color: app.installed ? '#2e7d32' : '#9e9e9e',
          }}>
            {app.installed ? '✓ Installed' : 'Not installed'}
          </div>
        </div>
      </div>

      {/* URL */}
      <div style={{ fontSize: 11, color: '#666', wordBreak: 'break-all', lineHeight: 1.4 }}>
        <span style={{ fontWeight: 600 }}>URL: </span>
        {app.url
          ? <a href={app.url} target="_blank" rel="noreferrer" style={{ color: '#1565c0' }}>{app.url}</a>
          : <em style={{ color: '#aaa' }}>not configured</em>
        }
      </div>

      {/* Install path */}
      <div style={{ fontSize: 12 }}>
        <div style={{ fontWeight: 600, color: '#555', marginBottom: 4 }}>Install Path</div>
        {editingPath ? (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              autoFocus
              style={{ flex: 1, fontSize: 11, padding: '3px 6px', border: '1px solid #90caf9', borderRadius: 4 }}
              value={editPathVal}
              onChange={e => onPathChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onSavePath(); if (e.key === 'Escape') onCancelPath() }}
            />
            <button className="btn btn-sm btn-primary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={onSavePath}>✓</button>
            <button className="btn btn-sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={onCancelPath}>✕</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
            <span style={{ flex: 1, color: app.install_path ? '#333' : '#bbb', wordBreak: 'break-all', fontSize: 11 }}>
              {app.install_path || <em>not set — click Edit to configure</em>}
            </span>
            <button className="btn btn-sm" style={{ fontSize: 10, padding: '1px 7px', whiteSpace: 'nowrap', flexShrink: 0 }} onClick={onEditPath}>
              Edit
            </button>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        {app.installed ? (
          <>
            <button className="btn btn-sm btn-primary" style={{ flex: 1 }}
              disabled={action.loading} onClick={onOpen}>
              {action.loading ? '…' : 'Open'}
            </button>
            <button className="btn btn-sm" style={{ flex: 1, color: '#c62828', borderColor: '#e57373' }}
              disabled={action.loading} onClick={onUninstall}>
              Uninstall
            </button>
          </>
        ) : (
          <button className="btn btn-sm btn-primary" style={{ flex: 1 }}
            disabled={action.loading} onClick={onInstall}>
            {action.loading ? 'Installing…' : 'Install'}
          </button>
        )}
      </div>

      {/* Feedback */}
      {action.msg && (
        <div style={{ fontSize: 12, color: '#2e7d32', background: '#f1f8e9', borderRadius: 4, padding: '4px 8px' }}>
          {action.msg}
        </div>
      )}
      {action.err && (
        <div style={{ fontSize: 12, color: '#c62828', background: '#ffebee', borderRadius: 4, padding: '5px 8px', lineHeight: 1.4 }}>
          {action.err}
        </div>
      )}
    </div>
  )
}
