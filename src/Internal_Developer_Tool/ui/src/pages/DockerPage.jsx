import { useState, useEffect, useCallback, useRef } from 'react'

function ConfirmModal({ message, detail, confirmLabel = 'Remove', onConfirm, onCancel }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg, #fff)', borderRadius: 12,
        boxShadow: '0 8px 40px rgba(0,0,0,0.22)',
        padding: '28px 32px', minWidth: 340, maxWidth: 440,
        border: '1px solid var(--border)',
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>
          Confirm Removal
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: detail ? 6 : 20 }}>
          {message}
        </div>
        {detail && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>{detail}</div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            padding: '8px 20px', fontSize: 13, fontWeight: 600,
            background: 'none', border: '1px solid var(--border)',
            borderRadius: 7, cursor: 'pointer', color: 'var(--text-muted)',
          }}>Cancel</button>
          <button onClick={onConfirm} style={{
            padding: '8px 20px', fontSize: 13, fontWeight: 700,
            background: '#d32f2f', color: '#fff',
            border: 'none', borderRadius: 7, cursor: 'pointer',
          }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

const DOCKER_DESKTOP_GROUP = {
  group: 'Docker Desktop',
  items: [
    { cmd: 'startdocker', label: 'Launch Docker Desktop', style: 'btn-success',
      desc: 'Restarts VM compute (vmcompute) and launches Docker Desktop, then waits until the daemon is ready.',
      showDesc: true },
  ],
}

// Start / Stop — always visible
// Buttons rendered in this order: Start All, Stop All, Restart, Setup, Provision, Delete
// disabled(running, anyRunning, stoppedCount) — per-button disable logic
const LIFECYCLE_BTNS = [
  { cmd: 'startservers',   label: 'Start All',  style: 'btn-success', desc: 'docker compose start — start stopped containers',          disabled: (r, any, sc) => !!r || sc === 0 },
  { cmd: 'stopservers',    label: 'Stop All',   style: '',            desc: 'docker compose stop — stop running containers',             disabled: (r, any)     => !!r || !any },
  { cmd: 'restartonly',    label: 'Restart',    style: '',            desc: 'docker compose stop + start — restart without removing',    disabled: (r, any)     => !!r || !any },
  { cmd: 'setupservers',   label: 'Setup',      style: 'btn-primary', desc: 'docker compose up — create + start full stack',             disabled: (r, any)     => !!r || any },
  { cmd: 'restartservers', label: 'Provision',  style: '',            desc: 'docker compose stop + down + up -d — full cycle',           disabled: (r)          => !!r },
  { cmd: 'deleteservers',  label: 'Delete',     style: 'btn-danger',  desc: 'docker compose stop + down — stop + remove containers',     disabled: (r, any)     => !!r || any },
]

export default function DockerPage() {
  const [running,       setRunning]       = useState(null)
  const [output,        setOutput]        = useState(null)
  const [states,        setStates]        = useState([])
  const [statesLoad,    setStatesLoad]    = useState(true)
  const [stateName,     setStateName]     = useState('')
  const [saving,        setSaving]        = useState(false)
  const [stateOp,       setStateOp]       = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(null)  // state name pending confirmation
  const [dockerRunning,        setDockerRunning]        = useState(null)  // null = unknown, true/false
  const [containerStats,       setContainerStats]       = useState(null)  // { total, running }
  const [containersRefreshKey, setContainersRefreshKey] = useState(0)

  const loadStates = useCallback(() => {
    setStatesLoad(true)
    fetch('/api/docker/states')
      .then(r => r.json())
      .then(d => { setStates(d); setStatesLoad(false) })
      .catch(() => setStatesLoad(false))
  }, [])

  useEffect(() => { loadStates() }, [loadStates])

  // Poll Docker Desktop status + container stats every 5 seconds
  useEffect(() => {
    function poll() {
      fetch('/api/docker/status')
        .then(r => r.json())
        .then(d => setDockerRunning(d.running))
        .catch(() => setDockerRunning(false))
      fetch('/api/docker/containers')
        .then(r => r.json())
        .then(d => {
          if (d.ok) {
            const list = d.containers || []
            setContainerStats({ total: list.length, running: list.filter(c => c.state === 'running').length })
          }
        })
        .catch(() => {})
    }
    poll()
    const id = setInterval(poll, 5000)
    return () => clearInterval(id)
  }, [])

  const runCmd = async (cmd, project = null) => {
    setRunning(cmd); setOutput(null)
    const body = project ? { cmd, project } : { cmd }
    const r = await fetch('/api/docker/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const d = await r.json()
    const label = project ? `${cmd} [${project}]` : cmd
    setOutput({ label, ok: d.ok, text: d.output || '' })
    setRunning(null)
    setContainersRefreshKey(k => k + 1)
  }

  const saveState = async () => {
    if (!stateName.trim()) return
    setSaving(true); setOutput(null)
    const r = await fetch('/api/docker/states', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: stateName.trim() }),
    })
    const d = await r.json()
    setOutput({ label: `saveds ${stateName.trim()}`, ok: d.ok, text: d.output || '' })
    setStateName(''); setSaving(false); loadStates()
  }

  const loadState = async (name) => {
    setStateOp(`${name}:load`); setOutput(null)
    const r = await fetch(`/api/docker/states/${encodeURIComponent(name)}/load`, { method: 'POST' })
    const d = await r.json()
    setOutput({ label: `loadds ${name}`, ok: d.ok, text: d.output || '' })
    setStateOp(null)
  }

  const removeState = (name) => setConfirmRemove(name)

  const doRemoveState = async (name) => {
    setConfirmRemove(null)
    setStateOp(`${name}:remove`); setOutput(null)
    const r = await fetch(`/api/docker/states/${encodeURIComponent(name)}`, { method: 'DELETE' })
    const d = await r.json()
    setOutput({ label: `removeds ${name}`, ok: d.ok, text: d.output || '' })
    setStateOp(null)
    if (d.ok) setStates(prev => prev.filter(s => s.name !== name))
    loadStates()
  }

  const busy = !!running || !!stateOp || saving

  return (
    <div>
      {confirmRemove && (
        <ConfirmModal
          message={`Remove saved state "${confirmRemove}"?`}
          detail="This will permanently delete the saved images and volumes. This cannot be undone."
          confirmLabel="Remove"
          onConfirm={() => doRemoveState(confirmRemove)}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
      <h1 className="page-title" style={{ marginBottom: 24 }}>Manage Local Docker</h1>

      {/* Docker Desktop card */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="form-section-title">{DOCKER_DESKTOP_GROUP.group}</div>
        <div className="flex-gap">
          {DOCKER_DESKTOP_GROUP.items.map(a => (
            dockerRunning
              ? (
                <div key={a.cmd} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '6px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    background: 'rgba(76,175,80,0.12)', color: '#2e7d32',
                    border: '1px solid rgba(76,175,80,0.35)',
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4caf50', display: 'inline-block' }} />
                    Docker Desktop Running
                  </span>
                  {a.showDesc && <span style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 340, lineHeight: 1.5 }}>{a.desc}</span>}
                </div>
              ) : (
                <div key={a.cmd} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button title={a.desc} className={`btn ${a.style}`} disabled={busy} onClick={() => runCmd(a.cmd)}>
                    {running === a.cmd ? <><span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5, marginRight: 6 }} />Running…</> : a.label}
                  </button>
                  {a.showDesc && <span style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 340, lineHeight: 1.5 }}>{a.desc}</span>}
                </div>
              )
          ))}
        </div>
      </div>

      <ContainersPanel runCmd={runCmd} running={running} refreshKey={containersRefreshKey} />

      {output && (
        <div className="docker-output" style={{ marginBottom: 20 }}>
          <div className="docker-output-header">
            <span>$ {output.label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ color: output.ok ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                {output.ok ? '✓ OK' : '✗ Failed'}
              </span>
              <button
                onClick={() => setOutput(null)}
                title="Close"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1, padding: '0 2px' }}
              >✕</button>
            </div>
          </div>
          <pre className="docker-output-body">{output.text || '(no output)'}</pre>
        </div>
      )}

      <SavedStatesPanel
        stateName={stateName} setStateName={setStateName}
        states={states} statesLoad={statesLoad} busy={busy} saving={saving} stateOp={stateOp}
        saveState={saveState} loadState={loadState} removeState={removeState}
      />

      <DockerComposeManagementPanel />

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <DockerImagesPanel onDeploy={() => setContainersRefreshKey(k => k + 1)} />
      </div>
    </div>
  )
}

// sessions: Map  containerName → { sessionId, output, inputVal }
function DockerImagesPanel({ onDeploy }) {
  const [images,      setImages]      = useState([])
  const [loading,     setLoading]     = useState(true)
  const [err,         setErr]         = useState(null)
  const [ops,         setOps]         = useState({})   // { [imgId]: { busy, err, ok } }
  const [deployedSet,    setDeployedSet]    = useState(new Set())  // Set of "repo:tag" strings in use
  const [imageToCompose, setImageToCompose] = useState({})         // { "repo:tag" -> compose_project }
  const [pullImage,   setPullImage]   = useState('')
  const [pulling,     setPulling]     = useState(false)
  const [pullErr,     setPullErr]     = useState(null)
  const [pullOk,      setPullOk]      = useState(null)

  function load() {
    setLoading(true); setErr(null)
    Promise.all([
      fetch('/api/docker/images').then(r => r.json()),
      fetch('/api/docker/containers').then(r => r.json()).catch(() => ({ ok: false })),
    ]).then(([imgData, ctnData]) => {
      if (imgData.ok) setImages(imgData.images)
      else setErr(imgData.error)
      if (ctnData.ok) {
        const ctns = ctnData.containers || []
        const used = new Set(ctns.map(c => (c.image || '').replace(/:latest$/, '') + (c.image?.includes(':') ? '' : ':latest')))
        const raw  = new Set(ctns.map(c => c.image || ''))
        setDeployedSet(new Set([...used, ...raw]))
        // build image → compose project map (only for compose containers)
        const i2c = {}
        ctns.forEach(c => {
          if (c.compose_project && c.image) {
            i2c[c.image] = c.compose_project
            // also store without :latest suffix variant
            const noLatest = c.image.replace(/:latest$/, '')
            if (noLatest !== c.image) i2c[noLatest] = c.compose_project
          }
        })
        setImageToCompose(i2c)
      }
    })
    .catch(() => setErr('Could not reach server'))
    .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  function doAction(img, action) {
    const key = img.id || `${img.repository}:${img.tag}`
    setOps(p => ({ ...p, [key]: { busy: action, err: null, ok: null } }))
    const url = action === 'deploy'
      ? '/api/docker/images/run'
      : `/api/docker/images/${encodeURIComponent(img.id)}`
    const opts = action === 'deploy'
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repository: img.repository, tag: img.tag }) }
      : { method: 'DELETE' }
    fetch(url, opts)
      .then(r => r.json())
      .then(d => {
        setOps(p => ({ ...p, [key]: { busy: null, err: d.ok ? null : (d.error || 'Failed'), ok: d.ok ? d.output || 'Done' : null } }))
        if (d.ok && action === 'delete') {
          setTimeout(() => { setOps(p => { const n = { ...p }; delete n[key]; return n }); load() }, 1500)
        } else if (d.ok && action === 'deploy') {
          setTimeout(() => { setOps(p => ({ ...p, [key]: { ...p[key], ok: null } })); load() }, 3000)
          onDeploy?.()
        } else if (d.ok) {
          setTimeout(() => setOps(p => ({ ...p, [key]: { ...p[key], ok: null } })), 3000)
        }
      })
      .catch(() => setOps(p => ({ ...p, [key]: { busy: null, err: 'Could not reach server', ok: null } })))
  }

  function doPull() {
    const image = pullImage.trim()
    if (!image) return
    setPulling(true); setPullErr(null); setPullOk(null)
    fetch('/api/docker/images/pull', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setPullOk(`Pulled ${image}`); setPullImage(''); load() }
        else setPullErr(d.error || 'Pull failed')
      })
      .catch(() => setPullErr('Could not reach server'))
      .finally(() => setPulling(false))
  }

  const [expanded, setExpanded] = useState(false)

  return (
    <div className="card" style={{ flex: '1 1 340px', marginBottom: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: expanded ? 12 : 0, cursor: 'pointer' }}
        onClick={() => setExpanded(e => !e)}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)', userSelect: 'none' }}>{expanded ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          Docker Image Management {!loading && <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)' }}>({images.length})</span>}
        </span>
        <button className="btn btn-sm" onClick={e => { e.stopPropagation(); load() }} disabled={loading} title="Refresh" style={{ marginLeft: 'auto' }}>
          {loading ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> : '↻'}
        </button>
      </div>
      {expanded && <>
      {/* Pull / add image row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input
          type="text"
          placeholder="image:tag (e.g. nginx:latest)"
          value={pullImage}
          onChange={e => { setPullImage(e.target.value); setPullErr(null); setPullOk(null) }}
          onKeyDown={e => e.key === 'Enter' && doPull()}
          disabled={pulling}
          style={{ flex: 1, fontSize: 12 }}
        />
        <button className="btn btn-sm btn-primary" onClick={doPull} disabled={pulling || !pullImage.trim()}>
          {pulling ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> : 'Pull'}
        </button>
      </div>
      {pullErr && <div className="alert alert-error" style={{ marginBottom: 10, fontSize: 12 }}>{pullErr}</div>}
      {pullOk  && <div className="alert alert-info"  style={{ marginBottom: 10, fontSize: 12 }}>{pullOk}</div>}
      {err && <div className="alert alert-error" style={{ marginBottom: 10, fontSize: 12 }}>{err}</div>}
      {!loading && images.length === 0 && !err && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No images found.</div>
      )}
      {images.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Repository</th><th>Tag</th><th>Created</th><th>Size</th><th style={{ textAlign: 'center' }}>Actions</th></tr>
            </thead>
            <tbody>
              {images.map((img, i) => {
                const key = img.id || `${img.repository}:${img.tag}`
                const op = ops[key] || {}
                const imageRef = `${img.repository}:${img.tag || 'latest'}`
                const isDeployed = deployedSet.has(imageRef) || deployedSet.has(img.repository) ||
                  deployedSet.has(`${img.repository}:latest`) || deployedSet.has(img.repository + ':' + img.tag)
                const composeName = imageToCompose[imageRef] || imageToCompose[img.repository] ||
                  imageToCompose[`${img.repository}:latest`] || imageToCompose[img.repository + ':' + img.tag] || null
                return (
                  <tr key={i}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }} title={img.repository}>{img.repository}</span>
                        {composeName && (
                          <span style={{ flexShrink: 0, fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 600,
                            background: 'rgba(59,130,246,0.1)', color: '#1d4ed8', border: '1px solid rgba(59,130,246,0.3)',
                            whiteSpace: 'nowrap' }} title={`Part of compose project: ${composeName}`}>
                            ⎈ {composeName}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{img.tag || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{img.created}</td>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{img.size}</td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {op.err && <span style={{ fontSize: 11, color: '#c62828', display: 'block', marginBottom: 3 }}>{op.err}</span>}
                      {op.ok  && <span style={{ fontSize: 11, color: '#2e7d32', display: 'block', marginBottom: 3 }}>{op.ok}</span>}
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                        <button className="btn btn-sm btn-primary"
                          disabled={!!op.busy || isDeployed}
                          onClick={() => doAction(img, 'deploy')}
                          title={isDeployed ? 'Container already running for this image' : 'Run container from this image'}
                          style={{ fontSize: 11, padding: '3px 8px' }}>
                          {op.busy === 'deploy' ? <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} /> : 'Deploy'}
                        </button>
                        <button className="btn btn-sm"
                          disabled={!!op.busy}
                          onClick={() => doAction(img, 'delete')}
                          style={{ fontSize: 11, padding: '3px 8px', color: '#c62828', borderColor: '#e57373' }}>
                          {op.busy === 'delete' ? <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} /> : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      </>}
    </div>
  )
}

function SavedStatesPanel({ stateName, setStateName, states, statesLoad, busy, saving, stateOp, saveState, loadState, removeState }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: expanded ? 16 : 0, cursor: 'pointer', flexWrap: 'wrap' }}
        onClick={() => setExpanded(e => !e)}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)', userSelect: 'none' }}>{expanded ? '▾' : '▸'}</span>
        <div className="form-section-title" style={{ marginBottom: 0 }}>
          Saved States {!statesLoad && <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)' }}>({states.length})</span>}
        </div>
        {expanded && (
          <div className="flex-gap" style={{ marginLeft: 'auto' }} onClick={e => e.stopPropagation()}>
            <input
              type="text"
              className="pid-input"
              style={{ width: 160 }}
              placeholder="state name"
              value={stateName}
              onChange={e => setStateName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveState()}
            />
            <button
              className="btn btn-primary"
              disabled={busy || !stateName.trim()}
              onClick={saveState}
            >{saving ? 'Saving…' : 'Save Current State'}</button>
          </div>
        )}
      </div>
      {expanded && (
        statesLoad ? (
          <div className="center" style={{ padding: '20px 0' }}><span className="spinner" /></div>
        ) : states.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No saved states yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Saved At</th><th>Size</th><th>Containers</th><th></th></tr>
              </thead>
              <tbody>
                {states.map(s => (
                  <tr key={s.name}>
                    <td style={{ fontWeight: 500 }}>{s.name}</td>
                    <td className="mono">{s.saved_at || '—'}</td>
                    <td className="mono">{s.size || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.containers || '—'}</td>
                    <td>
                      <div className="flex-gap">
                        <button className="btn btn-sm btn-primary"
                          disabled={busy} onClick={() => loadState(s.name)}
                        >{stateOp === `${s.name}:load` ? '…' : 'Load'}</button>
                        <button className="btn btn-sm btn-danger"
                          disabled={busy} onClick={() => removeState(s.name)}
                        >{stateOp === `${s.name}:remove` ? '…' : 'Remove'}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}

const COMPOSE_FILE_PATH_KEY     = 'docker_compose_file_path'
const COMPOSE_DIR_DEFAULT       = ''   // the real default (Local_Docker_Setup\dockercompose of this installation) comes from the server
const COMPOSE_FILE_PATH_DEFAULT = ''
// Migrate old path stored in localStorage from the legacy dockerVM location
;(() => {
  const stored = localStorage.getItem(COMPOSE_FILE_PATH_KEY)
  if (stored && stored.includes('dockerVM')) {
    localStorage.removeItem(COMPOSE_FILE_PATH_KEY)      // the server-provided default is used instead
  }
})()

function DockerComposeManagementPanel() {
  const [composePath,  setComposePath]  = useState(() => localStorage.getItem(COMPOSE_FILE_PATH_KEY) || COMPOSE_FILE_PATH_DEFAULT)
  const [editingPath,  setEditingPath]  = useState(false)
  const [pathDraft,    setPathDraft]    = useState(composePath)

  // Download directory — loaded from server (config.xlsx), defaults to Local_Docker_Setup\dockercompose
  const [downloadDir,     setDownloadDir]     = useState(COMPOSE_DIR_DEFAULT)
  const [editingDir,      setEditingDir]      = useState(false)
  const [dirDraft,        setDirDraft]        = useState(COMPOSE_DIR_DEFAULT)
  const [dirSaving,       setDirSaving]       = useState(false)
  const [dirSaveOk,       setDirSaveOk]       = useState(null)
  const [dirSaveErr,      setDirSaveErr]      = useState(null)

  const [deployedMap,   setDeployedMap]   = useState({})      // { [path]: boolean }
  const [servicesCount, setServicesCount] = useState(null)    // null = not yet loaded
  const [statusLoads,   setStatusLoads]   = useState({})      // { [path]: boolean }
  const [composeFiles,  setComposeFiles]  = useState(null)    // list of files in downloadDir
  const [fileOps,       setFileOps]       = useState({})      // { [path]: 'deleting' | null }
  const [viewingPath,   setViewingPath]   = useState(null)
  const [viewContent,   setViewContent]   = useState('')
  const [viewLoad,      setViewLoad]      = useState(false)
  const [viewErr,       setViewErr]       = useState(null)

  // Per-file op state — keyed by file path so operations on one file don't affect others
  const [composeOps,  setComposeOps]  = useState({})   // { [path]: 'deploying'|'deprovisioning'|null }
  const [composeMsgs, setComposeMsgs] = useState({})   // { [path]: { err, ok } }

  const [editing,      setEditing]      = useState(false)
  const [fileContent,  setFileContent]  = useState('')
  const [fileLoad,     setFileLoad]     = useState(false)
  const [fileErr,      setFileErr]      = useState(null)
  const [saving,       setSaving]       = useState(false)
  const [saveOk,       setSaveOk]       = useState(null)

  // Select file from system
  const fileInputRef                    = useRef(null)
  const [selectBusy,    setSelectBusy]  = useState(false)
  const [selectOk,      setSelectOk]    = useState(null)
  const [selectErr,     setSelectErr]   = useState(null)

  function onFileSelected(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectBusy(true); setSelectOk(null); setSelectErr(null)
    const reader = new FileReader()
    reader.onload = ev => {
      const content = ev.target.result
      const destPath = downloadDir.replace(/[/\\]+$/, '') + '\\' + file.name
      fetch('/api/docker/compose/file', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: destPath, content }),
      })
        .then(r => r.json())
        .then(d => {
          if (d.ok) { setSelectOk(`Copied to ${destPath}`); savePath(destPath); checkStatus(); loadComposeFiles() }
          else setSelectErr(d.error || 'Copy failed')
        })
        .catch(() => setSelectErr('Could not reach server'))
        .finally(() => { setSelectBusy(false); e.target.value = '' })
    }
    reader.onerror = () => { setSelectErr('Could not read file'); setSelectBusy(false); e.target.value = '' }
    reader.readAsText(file)
  }

  // Download section
  const [dlUrl,        setDlUrl]        = useState('')
  const [dlBusy,       setDlBusy]       = useState(false)
  const [dlErr,        setDlErr]        = useState(null)
  const [dlOk,         setDlOk]         = useState(null)

  function savePath(val) {
    setComposePath(val)
    localStorage.setItem(COMPOSE_FILE_PATH_KEY, val)
  }

  function checkStatus(path) {
    const filePath = path !== undefined ? path : composePath
    setStatusLoads(p => ({ ...p, [filePath]: true }))
    const url = filePath ? `/api/docker/compose?file=${encodeURIComponent(filePath)}` : '/api/docker/compose'
    fetch(url)
      .then(r => r.json())
      .then(d => { if (d.ok) { const n = (d.services || []).length; setDeployedMap(p => ({ ...p, [filePath]: n > 0 })); setServicesCount(n) } })
      .catch(() => {})
      .finally(() => setStatusLoads(p => ({ ...p, [filePath]: false })))
  }

  function loadComposeFiles() {
    fetch('/api/docker/compose-files')
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setComposeFiles(d.files)
          d.files.forEach(f => checkStatus(f.path))
        }
      })
      .catch(() => {})
  }

  function deleteComposeFile(path) {
    if (!window.confirm(`Delete "${path.split('\\').pop()}"?`)) return
    setFileOps(p => ({ ...p, [path]: 'deleting' }))
    fetch('/api/docker/compose-files/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          if (composePath === path) savePath('')
          loadComposeFiles()
        }
      })
      .catch(() => {})
      .finally(() => setFileOps(p => { const n = { ...p }; delete n[path]; return n }))
  }

  function openView(path) {
    if (viewingPath === path) { setViewingPath(null); return }
    setViewingPath(path); setViewContent(''); setViewErr(null); setViewLoad(true)
    fetch(`/api/docker/compose/file?path=${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setViewContent(d.content); else setViewErr(d.error || 'Could not read file') })
      .catch(() => setViewErr('Could not reach server'))
      .finally(() => setViewLoad(false))
  }

  useEffect(() => {
    checkStatus(composePath)
    loadComposeFiles()
  }, [])

  useEffect(() => {
    fetch('/api/docker/compose-config')
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.compose_download_dir) {
          setDownloadDir(d.compose_download_dir)
          setDirDraft(d.compose_download_dir)
          setComposePath(p => p || d.compose_download_dir.replace(/[/\\]+$/, '') + '\\compose_with_tomcat.yaml')
        }
      })
      .catch(() => {})
  }, [])

  function saveDownloadDir(val) {
    setDirSaving(true); setDirSaveOk(null); setDirSaveErr(null)
    fetch('/api/docker/compose-config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compose_download_dir: val }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setDownloadDir(val); setDirSaveOk('Saved'); setEditingDir(false); loadComposeFiles() }
        else setDirSaveErr(d.error || 'Save failed')
      })
      .catch(() => setDirSaveErr('Could not reach server'))
      .finally(() => setDirSaving(false))
  }

  function doDeploy(targetPath) {
    setComposeOps(p => ({ ...p, [targetPath]: 'deploying' }))
    setComposeMsgs(p => ({ ...p, [targetPath]: { err: null, ok: null } }))
    fetch('/api/docker/compose/deploy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: targetPath }),
    })
      .then(r => r.json())
      .then(d => {
        setComposeMsgs(p => ({ ...p, [targetPath]: { ok: d.ok ? 'Provisioned successfully' : null, err: d.ok ? null : (d.error || 'Deploy failed') } }))
        if (d.ok) checkStatus(targetPath)
      })
      .catch(() => setComposeMsgs(p => ({ ...p, [targetPath]: { err: 'Could not reach server', ok: null } })))
      .finally(() => setComposeOps(p => ({ ...p, [targetPath]: null })))
  }

  function doDeprovision(targetPath) {
    setComposeOps(p => ({ ...p, [targetPath]: 'deprovisioning' }))
    setComposeMsgs(p => ({ ...p, [targetPath]: { err: null, ok: null } }))
    fetch('/api/docker/compose/deprovision', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: targetPath }),
    })
      .then(r => r.json())
      .then(d => {
        setComposeMsgs(p => ({ ...p, [targetPath]: { err: d.ok ? null : (d.error || 'Stop failed'), ok: null } }))
        if (d.ok) checkStatus(targetPath)
      })
      .catch(() => setComposeMsgs(p => ({ ...p, [targetPath]: { err: 'Could not reach server', ok: null } })))
      .finally(() => setComposeOps(p => ({ ...p, [targetPath]: null })))
  }

  function openEdit() {
    setEditing(true); setFileLoad(true); setFileErr(null); setSaveOk(null)
    fetch(`/api/docker/compose/file?path=${encodeURIComponent(composePath)}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setFileContent(d.content); else setFileErr(d.error) })
      .catch(() => setFileErr('Could not read file'))
      .finally(() => setFileLoad(false))
  }

  function doSave() {
    setSaving(true); setSaveOk(null); setFileErr(null)
    fetch('/api/docker/compose/file', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: composePath, content: fileContent }),
    })
      .then(r => r.json())
      .then(d => { if (d.ok) { setSaveOk('Saved') } else setFileErr(d.error) })
      .catch(() => setFileErr('Could not save file'))
      .finally(() => setSaving(false))
  }

  function doDownload() {
    const url = dlUrl.trim()
    if (!url) return
    // Derive filename from URL; fall back to 'docker-compose.yaml'
    const fileName = url.split('/').filter(Boolean).pop()?.split('?')[0] || 'docker-compose.yaml'
    const localPath = downloadDir.replace(/[/\\]+$/, '') + '\\' + fileName
    setDlBusy(true); setDlErr(null); setDlOk(null)
    fetch('/api/docker/compose/download', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, local_path: localPath }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setDlOk(`Downloaded to ${localPath}`); setDlUrl(''); savePath(localPath); checkStatus(); loadComposeFiles() }
        else setDlErr(d.error || 'Download failed')
      })
      .catch(() => setDlErr('Could not reach server'))
      .finally(() => setDlBusy(false))
  }

  const [expanded, setExpanded] = useState(false)

  return (
    <div className="card">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: expanded ? 14 : 0, cursor: 'pointer' }}
        onClick={() => setExpanded(e => !e)}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)', userSelect: 'none' }}>{expanded ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          Docker Compose Management {composeFiles !== null && <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)' }}>({composeFiles.length} file{composeFiles.length !== 1 ? 's' : ''})</span>}
        </span>
        <button className="btn btn-sm" onClick={e => { e.stopPropagation(); checkStatus(); loadComposeFiles() }} title="Refresh status" style={{ marginLeft: 'auto' }}>↻</button>
      </div>
      {expanded && <>

      {/* Compose files list */}
      {composeFiles !== null && composeFiles.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Size</th>
                  <th style={{ textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {composeFiles.map(f => {
                  const isActive = composePath === f.path
                  const sizeKb = (f.size / 1024).toFixed(1)
                  const isViewing = viewingPath === f.path
                  const thisOp  = composeOps[f.path]
                  const thisMsg = composeMsgs[f.path] || {}
                  const thisStatusLoading = !!statusLoads[f.path]
                  return (
                    <>
                    <tr key={f.path}
                      onClick={() => { savePath(f.path); checkStatus(f.path); openView(f.path) }}
                      style={{
                        cursor: 'pointer',
                        background: deployedMap[f.path]
                          ? isActive ? 'rgba(76,175,80,0.18)' : 'rgba(76,175,80,0.09)'
                          : isActive ? 'rgba(59,130,246,0.08)' : undefined,
                        borderLeft: deployedMap[f.path] ? '3px solid #4caf50' : '3px solid transparent',
                      }}
                    >
                      <td style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: isActive ? 600 : 400 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, color: isViewing ? 'var(--primary,#3b82f6)' : 'var(--text-muted)', transition: 'transform .15s', display: 'inline-block', transform: isViewing ? 'rotate(90deg)' : 'none' }}>▶</span>
                          <span>{f.name}</span>
                          {isActive && (
                            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 600,
                              background: 'rgba(59,130,246,0.12)', color: '#1d4ed8', border: '1px solid rgba(59,130,246,0.3)' }}>
                              active
                            </span>
                          )}
                          {deployedMap[f.path] && (
                            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 600,
                              background: 'rgba(76,175,80,0.1)', color: '#2e7d32', border: '1px solid rgba(76,175,80,0.3)' }}>
                              ● provisioned
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{sizeKb} KB</td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                          <div style={{ display: 'inline-flex', gap: 6 }}>
                          <button className="btn btn-sm btn-primary"
                            onClick={() => { savePath(f.path); setEditing(false); doDeploy(f.path) }}
                            disabled={!!thisOp || deployedMap[f.path] || thisStatusLoading}
                            title={deployedMap[f.path] ? 'Already provisioned — stop first to reprovision' : 'Provision this file'}
                            style={{ fontSize: 11, padding: '3px 8px' }}>
                            {thisOp === 'deploying'
                              ? <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} />
                              : 'Provision'}
                          </button>
                          {deployedMap[f.path] && (
                            <button className="btn btn-sm"
                              onClick={() => { savePath(f.path); doDeprovision(f.path) }}
                              disabled={!!thisOp}
                              title="Stop containers for this file"
                              style={{ fontSize: 11, padding: '3px 8px', color: '#c62828', borderColor: '#e57373' }}>
                              {thisOp === 'deprovisioning'
                                ? <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} />
                                : 'Stop'}
                            </button>
                          )}
                          <button className="btn btn-sm"
                            onClick={() => { savePath(f.path); if (editing && composePath === f.path) setEditing(false); else { savePath(f.path); openEdit() } }}
                            style={{ fontSize: 11, padding: '3px 8px' }}>
                            ✎ Edit
                          </button>
                          <button className="btn btn-sm"
                            onClick={() => deleteComposeFile(f.path)}
                            disabled={fileOps[f.path] === 'deleting'}
                            style={{ fontSize: 11, padding: '3px 8px', color: '#c62828', borderColor: '#e57373' }}>
                            {fileOps[f.path] === 'deleting'
                              ? <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} />
                              : '🗑'}
                          </button>
                          </div>
                          {thisMsg.err && <span style={{ fontSize: 10, color: '#c62828' }}>{thisMsg.err}</span>}
                          {thisMsg.ok  && <span style={{ fontSize: 10, color: '#2e7d32' }}>{thisMsg.ok}</span>}
                        </div>
                      </td>
                    </tr>
                    {isViewing && (
                      <tr key={`${f.path}-view`}>
                        <td colSpan={3} style={{ padding: 0, borderTop: 'none' }}>
                          <div style={{ borderTop: '2px solid var(--primary,#3b82f6)', background: 'var(--surface)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
                              background: 'var(--surface2, rgba(0,0,0,0.04))', borderBottom: '1px solid var(--border)' }}>
                              <span style={{ fontFamily: 'monospace', fontSize: 12, flex: 1, color: 'var(--text-muted)' }}>{f.path}</span>
                              <span style={{ fontSize: 10, color: 'var(--text-muted)', padding: '1px 6px', border: '1px solid var(--border)', borderRadius: 4 }}>read-only</span>
                              <button onClick={() => setViewingPath(null)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, padding: '0 4px' }}
                                title="Close">✕</button>
                            </div>
                            {viewLoad && <div style={{ padding: '16px 0', textAlign: 'center' }}><span className="spinner" /></div>}
                            {viewErr  && <div className="alert alert-error" style={{ margin: 8, fontSize: 12 }}>{viewErr}</div>}
                            {!viewLoad && !viewErr && (
                              <pre style={{
                                margin: 0, padding: '10px 14px',
                                fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6,
                                color: 'var(--text)',
                                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                maxHeight: 380, overflowY: 'auto',
                              }}>{viewContent}</pre>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {composeFiles !== null && composeFiles.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          No compose files in download directory yet.
        </div>
      )}

      {/* Manual path override (for files outside the download directory) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>Active file path:</span>
        {editingPath
          ? (
            <>
              <input type="text" value={pathDraft} onChange={e => setPathDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { savePath(pathDraft); setEditingPath(false) } }}
                autoFocus style={{ flex: 1, fontSize: 12, fontFamily: 'monospace' }} />
              <button className="btn btn-sm btn-primary" onClick={() => { savePath(pathDraft); setEditingPath(false) }} style={{ fontSize: 11 }}>Save</button>
              <button className="btn btn-sm" onClick={() => { setPathDraft(composePath); setEditingPath(false) }} style={{ fontSize: 11 }}>Cancel</button>
            </>
          ) : (
            <>
              <code style={{ flex: 1, fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{composePath}</code>
              <button className="btn btn-sm" onClick={() => { setPathDraft(composePath); setEditingPath(true) }} style={{ fontSize: 11, flexShrink: 0 }}>✎</button>
            </>
          )
        }
      </div>


      {/* Inline editor */}
      {editing && (
        <div style={{ marginBottom: 14 }}>
          {fileLoad && <div style={{ padding: 12, textAlign: 'center' }}><span className="spinner" /></div>}
          {fileErr  && <div className="alert alert-error" style={{ marginBottom: 8, fontSize: 12 }}>{fileErr}</div>}
          {!fileLoad && !fileErr && (
            <>
              <textarea
                value={fileContent}
                onChange={e => setFileContent(e.target.value)}
                rows={20}
                style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, resize: 'vertical',
                  background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)',
                  borderRadius: 6, padding: 10, boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn btn-sm btn-primary" onClick={doSave} disabled={saving}>
                  {saving ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Saving…</> : 'Save File'}
                </button>
                <button className="btn btn-sm" onClick={() => setEditing(false)}>Cancel</button>
                {saveOk && <span style={{ fontSize: 12, color: '#2e7d32', alignSelf: 'center' }}>✓ {saveOk}</span>}
              </div>
            </>
          )}
        </div>
      )}

      {/* Download compose file */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Download Compose File</div>

        {/* Download directory (configurable, stored in config.xlsx) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>Download directory:</span>
          {editingDir
            ? (
              <>
                <input type="text" value={dirDraft} onChange={e => setDirDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveDownloadDir(dirDraft) }}
                  autoFocus style={{ flex: 1, fontSize: 12, fontFamily: 'monospace' }} />
                <button className="btn btn-sm btn-primary" onClick={() => saveDownloadDir(dirDraft)} disabled={dirSaving} style={{ fontSize: 11 }}>
                  {dirSaving ? <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} /> : 'Save'}
                </button>
                <button className="btn btn-sm" onClick={() => { setDirDraft(downloadDir); setEditingDir(false); setDirSaveErr(null) }} style={{ fontSize: 11 }}>Cancel</button>
              </>
            ) : (
              <>
                <code style={{ flex: 1, fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{downloadDir}</code>
                <button className="btn btn-sm" onClick={() => { setDirDraft(downloadDir); setEditingDir(true); setDirSaveOk(null) }} style={{ fontSize: 11, flexShrink: 0 }}>✎</button>
              </>
            )
          }
        </div>
        {dirSaveErr && <div className="alert alert-error" style={{ marginBottom: 8, fontSize: 12 }}>{dirSaveErr}</div>}
        {dirSaveOk  && !editingDir && <div style={{ fontSize: 11, color: '#2e7d32', marginBottom: 8 }}>✓ {dirSaveOk}</div>}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="text" placeholder="URL of docker-compose file…"
            value={dlUrl}
            onChange={e => { setDlUrl(e.target.value); setDlErr(null); setDlOk(null) }}
            onKeyDown={e => e.key === 'Enter' && doDownload()}
            disabled={dlBusy}
            style={{ flex: 1, fontSize: 12 }}
          />
          <button className="btn btn-sm btn-primary" onClick={doDownload} disabled={dlBusy || !dlUrl.trim()}>
            {dlBusy ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> : '↓ Download'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>
          Saves to the configured download directory above. Filename is taken from the URL.
        </div>
        {dlErr && <div className="alert alert-error" style={{ marginTop: 8, fontSize: 12 }}>{dlErr}</div>}
        {dlOk  && <div className="alert alert-info"  style={{ marginTop: 8, fontSize: 12 }}>{dlOk}</div>}
      </div>

      {/* Select compose file from system */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Select Compose File from System</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
          Browse your local filesystem and copy the selected file into the download directory.
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".yaml,.yml,.json"
          style={{ display: 'none' }}
          onChange={onFileSelected}
        />
        <button
          className="btn btn-sm btn-primary"
          onClick={() => { setSelectOk(null); setSelectErr(null); fileInputRef.current?.click() }}
          disabled={selectBusy}
          style={{ fontSize: 12 }}
        >
          {selectBusy
            ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5, marginRight: 6 }} />Copying…</>
            : '📂 Select File…'}
        </button>
        {selectErr && <div className="alert alert-error" style={{ marginTop: 8, fontSize: 12 }}>{selectErr}</div>}
        {selectOk  && <div className="alert alert-info"  style={{ marginTop: 8, fontSize: 12 }}>✓ {selectOk}</div>}
      </div>
      </>}
    </div>
  )
}

// tabs:     ordered array of containerNames
// activeTab: containerName currently shown
function ContainersPanel({ refreshKey, runCmd, running }) {
  const [containers,      setContainers]      = useState([])
  const [loading,         setLoading]         = useState(true)
  const [err,             setErr]             = useState(null)
  const [ops,             setOps]             = useState({})
  // sessions: { [tabId]: { sessionId, containerName, output, inputVal } }
  // tabs:     [{ tabId, containerName }, ...]
  const [sessions,        setSessions]        = useState({})
  const [tabs,            setTabs]            = useState([])
  const [activeTab,       setActiveTab]       = useState(null)  // tabId
  const [showAddMenu,     setShowAddMenu]     = useState(false)
  const [expandedPorts,   setExpandedPorts]   = useState(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())
  const [stats,           setStats]           = useState({})  // { containerName: { cpu, mem, disk } }

  const sessionsRef  = useRef(sessions)
  const termRefs     = useRef({})   // tabId → <pre> DOM el
  const addMenuRef   = useRef(null)
  const nextTabIdRef = useRef(1)

  useEffect(() => { sessionsRef.current = sessions }, [sessions])

  /* ── load containers + stats ── */
  function load() {
    setLoading(true); setErr(null)
    fetch('/api/docker/containers')
      .then(r => r.json())
      .then(d => {
        if (d.ok) setContainers(d.containers || [])
        else setErr(d.error || 'Failed to list containers')
      })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
    fetch('/api/docker/containers/stats')
      .then(r => r.json())
      .then(d => { if (d.ok) setStats(d.stats || {}) })
      .catch(() => {})
  }
  useEffect(() => { load() }, [])
  // Refresh when parent signals (e.g., after deploy from DockerImagesPanel)
  const prevRefreshKey = useRef(refreshKey)
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey !== prevRefreshKey.current) {
      prevRefreshKey.current = refreshKey
      load()
    }
  }, [refreshKey])

  /* ── poll output for all sessions ── */
  useEffect(() => {
    const id = setInterval(() => {
      Object.entries(sessionsRef.current).forEach(([tabId, s]) => {
        fetch(`/api/docker/terminal/${s.sessionId}/output`)
          .then(r => r.json())
          .then(d => {
            if (d.ok && d.output)
              setSessions(p => ({ ...p, [tabId]: { ...p[tabId], output: (p[tabId]?.output || '') + d.output } }))
          })
          .catch(() => {})
      })
    }, 300)
    return () => clearInterval(id)
  }, [])

  /* ── auto-scroll active terminal ── */
  useEffect(() => {
    if (activeTab && termRefs.current[activeTab]) {
      const el = termRefs.current[activeTab]
      el.scrollTop = el.scrollHeight
    }
  }, [sessions, activeTab])

  /* ── close add-menu on outside click ── */
  useEffect(() => {
    if (!showAddMenu) return
    function onDown(e) { if (addMenuRef.current && !addMenuRef.current.contains(e.target)) setShowAddMenu(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showAddMenu])

  /* ── cleanup on unmount ── */
  useEffect(() => {
    return () => {
      Object.values(sessionsRef.current).forEach(s =>
        fetch(`/api/docker/terminal/${s.sessionId}`, { method: 'DELETE' }).catch(() => {})
      )
    }
  }, [])

  /* ── helpers ── */
  function tabsForContainer(containerName) {
    return tabs.filter(t => t.containerName === containerName)
  }

  /* ── container start/stop/delete ── */
  function act(name, action) {
    const label = action === 'start' ? 'starting' : action === 'stop' ? 'stopping' : 'deleting'
    setOps(p => ({ ...p, [name]: label }))
    const url = action === 'delete'
      ? `/api/docker/containers/${encodeURIComponent(name)}`
      : `/api/docker/containers/${encodeURIComponent(name)}/${action}`
    const method = action === 'delete' ? 'DELETE' : 'POST'
    fetch(url, { method })
      .then(r => r.json())
      .finally(() => { setOps(p => { const n = { ...p }; delete n[name]; return n }); load() })
  }

  /* ── open terminal — always creates a new tab ── */
  function openTerminal(containerName) {
    setShowAddMenu(false)
    if (tabs.length >= 10) { alert('Maximum 10 terminals can be open at once.'); return }
    fetch('/api/docker/terminal/open', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ container: containerName }),
    })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) return
        const tabId = nextTabIdRef.current++
        setSessions(p => ({ ...p, [tabId]: { sessionId: d.session_id, containerName, output: '', inputVal: '' } }))
        setTabs(p => [...p, { tabId, containerName }])
        setActiveTab(tabId)
      })
      .catch(() => {})
  }

  /* ── close terminal tab ── */
  function closeTab(tabId) {
    const s = sessions[tabId]
    if (s) fetch(`/api/docker/terminal/${s.sessionId}`, { method: 'DELETE' }).catch(() => {})
    setSessions(p => { const n = { ...p }; delete n[tabId]; return n })
    setTabs(p => {
      const next = p.filter(t => t.tabId !== tabId)
      setActiveTab(cur => cur === tabId ? (next[next.length - 1]?.tabId ?? null) : cur)
      return next
    })
  }

  /* ── send command (or clear locally) ── */
  function sendCommand(tabId) {
    const s = sessions[tabId]
    if (!s) return
    const cmd = (s.inputVal || '').trim()
    if (!cmd) return
    setSessions(p => ({ ...p, [tabId]: { ...p[tabId], inputVal: '' } }))
    if (cmd === 'clear') {
      setSessions(p => ({ ...p, [tabId]: { ...p[tabId], output: '' } }))
      return
    }
    fetch(`/api/docker/terminal/${s.sessionId}/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd }),
    }).catch(() => {})
  }

  /* ── keydown handler on the terminal <pre> ── */
  function onTermKeyDown(e, tabId) {
    const s = sessions[tabId]
    if (!s) return
    if (e.key === 'Enter') {
      e.preventDefault(); sendCommand(tabId)
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      setSessions(p => ({ ...p, [tabId]: { ...p[tabId], inputVal: (p[tabId]?.inputVal || '').slice(0, -1) } }))
    } else if (e.ctrlKey && e.key === 'l') {
      e.preventDefault()
      setSessions(p => ({ ...p, [tabId]: { ...p[tabId], output: '' } }))
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      setSessions(p => ({ ...p, [tabId]: { ...p[tabId], inputVal: (p[tabId]?.inputVal || '') + e.key } }))
    }
  }

  function stateBadge(state, status) {
    const running = state === 'running', paused = state === 'paused'
    const color  = running ? '#2e7d32' : paused ? '#e65100' : '#757575'
    const bg     = running ? 'rgba(76,175,80,0.12)' : paused ? 'rgba(230,81,0,0.1)' : 'rgba(0,0,0,0.06)'
    const border = running ? 'rgba(76,175,80,0.35)' : paused ? 'rgba(230,81,0,0.3)' : '#ddd'
    const dot    = running ? '#4caf50' : paused ? '#ff6d00' : '#9e9e9e'
    const label  = running ? 'Running' : paused ? 'Paused' : 'Stopped'
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: bg, color, border: `1px solid ${border}` }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, display: 'inline-block' }} />
        {label}
        {status && <span style={{ fontWeight: 400, opacity: 0.75, marginLeft: 2 }}>({status})</span>}
      </span>
    )
  }

  const activeSession  = activeTab != null ? sessions[activeTab] : null

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div className="form-section-title" style={{ marginBottom: 0 }}>
          Docker Containers{!loading && containers.length > 0 && <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--text-muted)' }}> ({containers.length})</span>}
        </div>
        <button className="btn btn-sm" onClick={load} disabled={loading}>↻ Refresh</button>
      </div>

      {loading && <div style={{ padding: '16px 0', textAlign: 'center' }}><span className="spinner" /></div>}
      {err     && <div className="alert alert-error" style={{ fontSize: 13 }}>{err}</div>}
      {!loading && !err && containers.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No containers found.</p>}

      {/* Container table */}
      {!loading && containers.length > 0 && (() => {
        // Split into compose groups and standalone
        const groups = {}   // { projectName: [container, ...] }
        const standalone = []
        containers.forEach(c => {
          if (c.compose_project) {
            if (!groups[c.compose_project]) groups[c.compose_project] = []
            groups[c.compose_project].push(c)
          } else {
            standalone.push(c)
          }
        })

        const COMPOSE_BORDER = '2px solid rgba(59,130,246,0.45)'

        function renderRow(c, { inCompose = false, isLast = false } = {}) {
          const op = ops[c.name], busy = !!op, running = c.state === 'running'
          const cTabs = tabsForContainer(c.name)
          const hasTab = cTabs.length > 0
          const portList = c.ports ? c.ports.split(', ').filter(Boolean) : []
          const cStats = stats[c.name] || {}
          const rowBg = inCompose
            ? (hasTab ? 'rgba(59,130,246,0.07)' : 'rgba(59,130,246,0.025)')
            : (hasTab ? 'rgba(59,130,246,0.05)' : undefined)
          const lastBorder = isLast ? { borderBottom: COMPOSE_BORDER } : {}
          const leftBorder = inCompose ? { borderLeft: COMPOSE_BORDER } : {}
          return (
            <tr key={c.id || c.name}
              style={{ cursor: 'pointer', background: rowBg }}
              onClick={() => openTerminal(c.name)}
              title="Click to open terminal"
            >
              <td style={{ fontWeight: 500, fontFamily: 'monospace', fontSize: 13, ...leftBorder, ...lastBorder }}>
                {c.name}
                {hasTab && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--primary,#3b82f6)' }}>● {cTabs.length} terminal{cTabs.length > 1 ? 's' : ''}</span>}
              </td>
              <td style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...lastBorder }}
                title={c.image}>{c.image}</td>
              <td style={lastBorder}>{stateBadge(c.state, c.status)}</td>
              {/* CPU */}
              <td style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', whiteSpace: 'nowrap', ...lastBorder }} onClick={e => e.stopPropagation()}>
                {running ? (cStats.cpu || '—') : '—'}
              </td>
              {/* Memory */}
              <td style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', whiteSpace: 'nowrap', ...lastBorder }} onClick={e => e.stopPropagation()}>
                {running ? (cStats.mem || '—') : '—'}
              </td>
              {/* Disk (BlockIO) */}
              <td style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', whiteSpace: 'nowrap', ...lastBorder }} onClick={e => e.stopPropagation()}>
                {running ? (cStats.disk || '—') : '—'}
              </td>
              {/* Ports */}
              <td style={{ fontSize: 11, fontFamily: 'monospace', maxWidth: 200, ...lastBorder }} onClick={e => e.stopPropagation()}>
                {portList.length === 0
                  ? <span style={{ color: 'var(--text-muted)' }}>—</span>
                  : (() => {
                      const expanded = expandedPorts.has(c.name)
                      return (
                        <>
                          <span
                            onClick={() => setExpandedPorts(prev => {
                              const next = new Set(prev)
                              expanded ? next.delete(c.name) : next.add(c.name)
                              return next
                            })}
                            style={{ cursor: 'pointer', userSelect: 'none', color: running ? '#81c784' : 'var(--text-muted)', whiteSpace: 'nowrap' }}
                          >
                            {expanded ? '▾' : '▸'} {portList.length} port{portList.length !== 1 ? 's' : ''}
                          </span>
                          {expanded && portList.map((p, i) => (
                            <div key={i} style={{ whiteSpace: 'nowrap', color: running ? '#81c784' : 'var(--text-muted)', paddingLeft: 12, marginTop: 2 }}>{p}</div>
                          ))}
                        </>
                      )
                    })()
                }
              </td>
              <td style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', ...lastBorder }} onClick={e => e.stopPropagation()}>
                {c.networks || '—'}
              </td>
              <td style={{ textAlign: 'center', whiteSpace: 'nowrap', ...lastBorder }} onClick={e => e.stopPropagation()}>
                <div style={{ display: 'inline-flex', gap: 6 }}>
                  <button className="btn btn-sm btn-success" disabled={busy || running} onClick={() => act(c.name, 'start')} style={{ minWidth: 58 }}>
                    {op === 'starting' ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> : 'Start'}
                  </button>
                  {running
                    ? (
                      <button className="btn btn-sm" disabled={busy} onClick={() => act(c.name, 'stop')} style={{ minWidth: 58, color: '#c62828', borderColor: '#e57373' }}>
                        {op === 'stopping' ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> : 'Stop'}
                      </button>
                    ) : (
                      <button className="btn btn-sm" disabled={busy} onClick={() => act(c.name, 'delete')} style={{ minWidth: 58, color: '#c62828', borderColor: '#e57373' }}>
                        {op === 'deleting' ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> : 'Delete'}
                      </button>
                    )
                  }
                </div>
              </td>
            </tr>
          )
        }

        return (
          <div className="table-wrap" style={{ marginBottom: tabs.length > 0 ? 16 : 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Name</th><th>Image</th><th>Status</th><th>CPU</th><th>Memory</th><th>Disk I/O</th><th>Ports</th><th>Networks</th><th style={{ textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(groups).map(([project, members]) => {
                  const collapsed = collapsedGroups.has(project)
                  const runningCount = members.filter(c => c.state === 'running').length
                  const stoppedCount = members.length - runningCount
                  const anyRunning = runningCount > 0
                  const toggleCollapse = () => setCollapsedGroups(prev => {
                    const next = new Set(prev)
                    collapsed ? next.delete(project) : next.add(project)
                    return next
                  })
                  return (
                    <>
                      <tr key={`group-${project}`}>
                        <td colSpan={9} style={{
                          background: 'var(--bg-secondary, rgba(59,130,246,0.06))',
                          borderTop: '2px solid var(--primary, #3b82f6)',
                          padding: '8px 10px',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            {/* Toggle + title */}
                            <span onClick={toggleCollapse} style={{ cursor: 'pointer', userSelect: 'none', fontSize: 12, color: 'var(--primary,#3b82f6)' }}>
                              {collapsed ? '▸' : '▾'}
                            </span>
                            <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--primary,#3b82f6)', cursor: 'pointer' }} onClick={toggleCollapse}>
                              🐙 Docker Compose — {project}
                            </span>
                            {/* Stats badges */}
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', padding: '1px 7px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                              {members.length} total
                            </span>
                            <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10,
                              color: '#2e7d32', background: 'rgba(76,175,80,0.1)', border: '1px solid rgba(76,175,80,0.3)' }}>
                              ● {runningCount} running
                            </span>
                            <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10,
                              color: 'var(--text-muted)', background: 'var(--surface)', border: '1px solid var(--border)' }}>
                              ○ {stoppedCount} stopped
                            </span>
                            {/* Lifecycle buttons — scoped to this compose project */}
                            {runCmd && (
                              <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
                                {LIFECYCLE_BTNS.map(a => (
                                  <button key={a.cmd} className={`btn btn-sm ${a.style || ''}`}
                                    disabled={a.disabled(running, anyRunning, stoppedCount)}
                                    onClick={() => runCmd(a.cmd, project)}
                                    title={`${a.desc} (${project})`}
                                    style={{ fontSize: 11, padding: '3px 9px' }}>
                                    {running === a.cmd ? <><span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5, marginRight: 5 }} />Running…</> : a.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                      {!collapsed && members.map((c, i) => renderRow(c, { inCompose: true, isLast: i === members.length - 1 }))}
                    </>
                  )
                })}
                {standalone.map(c => renderRow(c))}
              </tbody>
            </table>
          </div>
        )
      })()}

      {/* Terminal panel */}
      {tabs.length > 0 && (
        <div style={{ border: '1px solid #333', borderRadius: 6, overflow: 'hidden' }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', alignItems: 'stretch', background: '#1a1a1a', borderBottom: '1px solid #333', flexWrap: 'wrap' }}>
            {(() => {
              // Build per-container index to disambiguate tabs for the same container
              const seenCount = {}
              return tabs.map(({ tabId, containerName }) => {
                seenCount[containerName] = (seenCount[containerName] || 0) + 1
                const idx = seenCount[containerName]
                const totalForContainer = tabs.filter(t => t.containerName === containerName).length
                const label = totalForContainer > 1 ? `${containerName} (${idx})` : containerName
                const isActive = tabId === activeTab
                return (
                  <div key={tabId} onClick={() => setActiveTab(tabId)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 14px', cursor: 'pointer',
                      background: isActive ? '#141414' : 'transparent',
                      borderRight: '1px solid #333',
                      borderBottom: isActive ? '2px solid #4caf50' : '2px solid transparent',
                      fontSize: 12, fontFamily: 'monospace',
                      color: isActive ? '#e0e0e0' : '#777',
                      userSelect: 'none',
                    }}
                  >
                    <span style={{ color: isActive ? '#4caf50' : '#444', fontSize: 9 }}>●</span>
                    {label}
                    <button onClick={e => { e.stopPropagation(); closeTab(tabId) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', fontSize: 13, lineHeight: 1, padding: '0 1px', marginLeft: 2 }}
                      title="Close">✕</button>
                  </div>
                )
              })
            })()}
            {/* + button */}
            <div style={{ position: 'relative', marginLeft: 2, display: 'flex', alignItems: 'center' }} ref={addMenuRef}>
              <button
                onClick={() => setShowAddMenu(p => !p)}
                disabled={tabs.length >= 10}
                title="Open new terminal"
                style={{
                  background: 'none', border: 'none', cursor: tabs.length < 10 ? 'pointer' : 'not-allowed',
                  color: '#777', fontSize: 18, lineHeight: 1, padding: '4px 10px',
                  fontWeight: 300,
                }}
              >+</button>
              {showAddMenu && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, zIndex: 50,
                  background: '#252525', border: '1px solid #444', borderRadius: 6,
                  minWidth: 200, boxShadow: '0 4px 12px rgba(0,0,0,.5)',
                  padding: '4px 0',
                }}>
                  {containers.length === 0
                    ? <div style={{ padding: '8px 12px', fontSize: 12, color: '#666' }}>No containers</div>
                    : containers.map(c => {
                        const count = tabsForContainer(c.name).length
                        return (
                          <div key={c.name} onClick={() => openTerminal(c.name)}
                            style={{
                              padding: '6px 14px', cursor: 'pointer', fontSize: 12,
                              fontFamily: 'monospace', color: count > 0 ? '#4caf50' : '#ccc',
                              display: 'flex', alignItems: 'center', gap: 8,
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = '#333'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            <span style={{ fontSize: 8, color: c.state === 'running' ? '#4caf50' : '#555' }}>●</span>
                            {c.name}
                            {count > 0 && <span style={{ fontSize: 10, color: '#4caf50', marginLeft: 'auto' }}>{count} open</span>}
                          </div>
                        )
                      })
                  }
                </div>
              )}
            </div>
            <span style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 11, color: '#444', paddingRight: 10 }}>
              {tabs.length}/10
            </span>
          </div>

          {/* Terminal body — captures keystrokes directly */}
          {activeSession && (
            <pre
              ref={el => { termRefs.current[activeTab] = el }}
              tabIndex={0}
              onKeyDown={e => onTermKeyDown(e, activeTab)}
              style={{
                background: '#141414', color: '#d4d4d4',
                fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6,
                padding: '10px 14px', margin: 0,
                height: 300, overflowY: 'auto',
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                outline: 'none', cursor: 'text',
              }}
            >
              {activeSession.output}{activeSession.output.endsWith('\n') ? '' : '\n'}{'$ '}{activeSession.inputVal}{'█'}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
