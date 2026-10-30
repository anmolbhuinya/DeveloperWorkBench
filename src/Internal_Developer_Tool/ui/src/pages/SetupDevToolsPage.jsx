import { useState, useEffect, useRef } from 'react'

export default function SetupDevToolsPage() {
  const [tools, setTools]     = useState([])
  const [projDir, setProjDir] = useState('')
  const [oracleUrl, setOracleUrl] = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(true)
  const [opState, setOpState] = useState({})
  const [scriptData, setScriptData] = useState({}) // repoName -> {options, scriptDir, selected, running, output, status}
  const [oracleDl, setOracleDl] = useState({ status: '', output: '' }) // oracle download state
  const [editTool, setEditTool] = useState(null) // {index, url, clone_url}
  const [editSaving, setEditSaving] = useState(false)
  const pollRef = useRef({})

  const load = () =>
    fetch('/api/setup/dev-tools')
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setTools(d.tools); setProjDir(d.project_directory || ''); setOracleUrl(d.oracle_url || '') }
        else setError(d.error || 'Failed to load')
      })
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false))

  useEffect(() => { load() }, [])

  const getRepoName = (t) => {
    const u = t.clone_url || t.url
    return u.replace(/\/+$/, '').replace(/\.git$/, '').split('/').pop().split(':').pop()
  }

  // Load script options when a tool is installed
  useEffect(() => {
    tools.forEach(t => {
      if (!t.installed) return
      const rn = getRepoName(t)
      if (scriptData[rn]) return
      const params = new URLSearchParams({ url: t.url, clone_url: t.clone_url || '' })
      fetch(`/api/setup/dev-tools/script-options?${params}`)
        .then(r => r.json())
        .then(d => {
          if (d.ok) {
            setScriptData(prev => ({
              ...prev,
              [rn]: { options: d.options, scriptDir: d.script_dir,
                       selected: [], running: false, output: '', status: '',
                       scriptStatuses: d.persisted_results || {},
                       downloadHints: d.download_hints || {} },
            }))
          }
        })
        .catch(() => {})
    })
  }, [tools])

  const startPoll = (key) => {
    if (pollRef.current[key]) return
    pollRef.current[key] = setInterval(() => {
      fetch(`/api/setup/dev-tools/install-status?key=${encodeURIComponent(key)}`)
        .then(r => r.json())
        .then(s => {
          setOpState(prev => ({ ...prev, [key]: { status: s.status, output: s.output } }))
          if (s.status !== 'running') {
            clearInterval(pollRef.current[key])
            delete pollRef.current[key]
            if (s.status === 'success') load()
          }
        })
        .catch(() => {})
    }, 1500)
  }

  const triggerOp = (endpoint, tool) => {
    const opUrl    = tool.clone_url || tool.url
    const repoName = opUrl.replace(/\/+$/, '').replace(/\.git$/, '').split('/').pop().split(':').pop()
    setOpState(prev => ({ ...prev, [repoName]: { status: 'running', output: '' } }))
    fetch(`/api/setup/dev-tools/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: tool.url, clone_url: tool.clone_url || '' }),
    })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) {
          setOpState(prev => ({ ...prev, [repoName]: { status: 'failed', output: d.error || 'Failed' } }))
          return
        }
        startPoll(d.key)
      })
      .catch(() => {
        setOpState(prev => ({ ...prev, [repoName]: { status: 'failed', output: 'Request failed' } }))
      })
  }

  const toggleSelect = (rn, opt) => {
    setScriptData(prev => {
      const cur = prev[rn] || {}
      const sel = cur.selected || []
      const next = sel.includes(opt) ? sel.filter(s => s !== opt) : [...sel, opt]
      return { ...prev, [rn]: { ...cur, selected: next } }
    })
  }

  const selectAll = (rn) => {
    setScriptData(prev => {
      const cur = prev[rn] || {}
      return { ...prev, [rn]: { ...cur, selected: [...(cur.options || [])] } }
    })
  }

  const runScripts = (rn, sd) => {
    if (!sd.selected?.length) return
    setScriptData(prev => {
      const cur = prev[rn] || {}
      const resetSelected = (sd.selected || []).reduce((acc, s) => ({ ...acc, [s]: { status: 'pending', script_path: '', install_path: '' } }), {})
      return { ...prev, [rn]: { ...cur, running: true, output: '', status: '', scriptStatuses: { ...(cur.scriptStatuses || {}), ...resetSelected } } }
    })
    fetch('/api/setup/dev-tools/run-scripts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selected: sd.selected, script_dir: sd.scriptDir }),
    })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) {
          setScriptData(prev => ({ ...prev, [rn]: { ...prev[rn], running: false, status: 'failed', output: d.error } }))
          return
        }
        const pollKey = d.key
        const iv = setInterval(() => {
          fetch(`/api/setup/dev-tools/run-status?key=${encodeURIComponent(pollKey)}`)
            .then(r => r.json())
            .then(s => {
              setScriptData(prev => ({
                ...prev, [rn]: {
                  ...prev[rn],
                  output: s.output,
                  status: s.status,
                  running: s.status === 'running',
                  scriptStatuses: { ...(prev[rn]?.scriptStatuses || {}), ...(s.scripts || {}) },
                },
              }))
              if (s.status !== 'running') clearInterval(iv)
            })
            .catch(() => {})
        }, 1500)
      })
      .catch(() => {
        setScriptData(prev => ({ ...prev, [rn]: { ...prev[rn], running: false, status: 'failed', output: 'Request failed' } }))
      })
  }

  const saveToolEdit = () => {
    if (!editTool) return
    setEditSaving(true)
    fetch('/api/setup/dev-tools', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: editTool.url, clone_url: editTool.clone_url, oracle_url: editTool.oracle_url }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setEditTool(null); load() }
      })
      .catch(() => {})
      .finally(() => setEditSaving(false))
  }

  const downloadOracle = (scriptDir) => {
    const destPath = scriptDir.replace(/\\/g, '\\') + '\\oraclearchve.tar.gz'
    setOracleDl({ status: 'running', output: '' })
    fetch('/api/setup/oracle-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dest_path: destPath }),
    })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) { setOracleDl({ status: 'failed', output: d.error }); return }
        const iv = setInterval(() => {
          fetch(`/api/setup/oracle-download-status?key=${encodeURIComponent(d.key)}`)
            .then(r => r.json())
            .then(s => {
              setOracleDl({ status: s.status, output: s.output })
              if (s.status !== 'running') clearInterval(iv)
            })
            .catch(() => {})
        }, 1000)
      })
      .catch(() => setOracleDl({ status: 'failed', output: 'Request failed' }))
  }

  const Btn = ({ label, color, onClick, disabled }) => (
    <button onClick={onClick} disabled={disabled} style={{
      background: color, color: '#fff', border: 'none', borderRadius: 4,
      padding: '6px 14px', fontSize: 13, cursor: disabled ? 'default' : 'pointer',
      fontWeight: 600, opacity: disabled ? 0.6 : 1,
    }}>{label}</button>
  )

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1400 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--text)' }}>Dev Tools</h1>
        {projDir && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Install location: <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>{projDir}</span>
          </div>
        )}
      </div>

      {loading && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>}
      {error   && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
      {!loading && !error && tools.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No tools configured.</div>
      )}

      {tools.map((t, i) => {
        const repoName  = getRepoName(t)
        const op        = opState[repoName]
        const isRunning = op?.status === 'running'
        const isFailed  = op?.status === 'failed'
        const isDone    = op?.status === 'success'
        const installed = t.installed || isDone
        const sd        = scriptData[repoName]

        return (
          <div key={i} style={{
            background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: 6, marginBottom: 16,
          }}>
            {/* Header row */}
            <div style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                {/* URL info / edit form */}
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{t.name}</span>
                    {editTool?.index !== i && (
                      <button onClick={() => setEditTool({ index: i, url: t.url, clone_url: t.clone_url, oracle_url: oracleUrl })}
                        style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 3,
                          padding: '2px 8px', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>
                        Edit
                      </button>
                    )}
                  </div>

                  {editTool?.index === i ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 70, flexShrink: 0 }}>HTTPS URL</span>
                        <input value={editTool.url} onChange={e => setEditTool(p => ({ ...p, url: e.target.value }))}
                          style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--primary)',
                            borderRadius: 4, padding: '4px 8px', color: 'var(--text)', fontSize: 12,
                            fontFamily: 'monospace', outline: 'none' }} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 70, flexShrink: 0 }}>SSH Clone</span>
                        <input value={editTool.clone_url} onChange={e => setEditTool(p => ({ ...p, clone_url: e.target.value }))}
                          style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--primary)',
                            borderRadius: 4, padding: '4px 8px', color: 'var(--text)', fontSize: 12,
                            fontFamily: 'monospace', outline: 'none' }} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 70, flexShrink: 0 }}>Oracle URL</span>
                        <input value={editTool.oracle_url || ''} onChange={e => setEditTool(p => ({ ...p, oracle_url: e.target.value }))}
                          style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--primary)',
                            borderRadius: 4, padding: '4px 8px', color: 'var(--text)', fontSize: 12,
                            outline: 'none' }} />
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                        <button onClick={saveToolEdit} disabled={editSaving}
                          style={{ background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 4,
                            padding: '4px 12px', fontSize: 12, cursor: editSaving ? 'default' : 'pointer', fontWeight: 600 }}>
                          {editSaving ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => setEditTool(null)}
                          style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)',
                            borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {t.url && (
                        <div style={{ marginTop: 2 }}>
                          <a href={t.url} target="_blank" rel="noreferrer"
                             style={{ fontSize: 12, color: 'var(--primary)', wordBreak: 'break-all' }}>{t.url}</a>
                        </div>
                      )}
                      {t.clone_url && (
                        <div style={{ marginTop: 2, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                          SSH: {t.clone_url}
                        </div>
                      )}
                      {oracleUrl && (
                        <div style={{ marginTop: 2, fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-all' }}>
                          Oracle:{' '}
                          <a href={oracleUrl} target="_blank" rel="noreferrer"
                             style={{ color: 'var(--primary)' }}>{oracleUrl}</a>
                        </div>
                      )}
                    </>
                  )}

                  {/* Installed path */}
                  {installed && projDir && (
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>Path:</span>
                      <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text)', wordBreak: 'break-all' }}>
                        {projDir.replace(/\/+$/, '').replace(/\\+$/, '')}{'\\' + repoName}
                      </span>
                      <button title="Open in Explorer"
                        onClick={() => fetch('/api/utils/open-folder', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ path: projDir.replace(/[/\\]+$/, '') + '\\' + repoName }),
                        })}
                        style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 3,
                          padding: '1px 5px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, flexShrink: 0 }}>
                        📂
                      </button>
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingTop: 2 }}>
                  {isRunning ? (
                    <span style={{ fontSize: 12, color: 'var(--warning)' }}>Running…</span>
                  ) : installed ? (
                    <>
                      <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600, marginRight: 4 }}>✓ Installed</span>
                      <Btn label="Update"    color="var(--primary)" onClick={() => triggerOp('update',    t)} />
                      <Btn label="Reinstall" color="var(--warning)" onClick={() => triggerOp('reinstall', t)} />
                    </>
                  ) : (
                    <Btn label="Install" color="var(--primary)" onClick={() => triggerOp('install', t)} />
                  )}
                  {isFailed && <span style={{ fontSize: 12, color: 'var(--danger)' }}>Failed</span>}
                </div>
              </div>
            </div>

            {/* Git op output */}
            {op?.output && (
              <div style={{ padding: '0 16px 12px' }}>
                <pre style={{
                  padding: '8px 10px', background: 'var(--surface)',
                  border: '1px solid var(--border)', borderRadius: 4,
                  fontSize: 11, color: 'var(--text-muted)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 120, overflowY: 'auto',
                }}>{op.output}</pre>
              </div>
            )}

            {/* Script options — only when installed and options loaded */}
            {installed && sd?.options?.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Setup Options
                  </span>
                  <span style={{ fontSize: 12, cursor: 'pointer', color: 'var(--primary)' }}
                        onClick={() => selectAll(repoName)}>Select All</span>
                </div>

                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface)' }}>
                      <th style={{ width: 32, padding: '6px 10px', borderBottom: '1px solid var(--border)' }}></th>
                      <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontWeight: 600 }}>Script</th>
                      <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontWeight: 600 }}>Status</th>
                      <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontWeight: 600 }}>Script Path</th>
                      <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontWeight: 600 }}>Installed Path</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sd.options.map(opt => {
                      const ss   = sd.scriptStatuses?.[opt]
                      const isInstalled = ss?.status === 'installed'
                      const isFail      = ss?.status === 'failed'
                      const isRunning   = ss?.status === 'running'
                      const isPending   = ss?.status === 'pending'
                      return (
                        <tr key={opt} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={sd.selected?.includes(opt) || false}
                              onChange={() => toggleSelect(repoName, opt)}
                              style={{ accentColor: 'var(--primary)', width: 14, height: 14, cursor: 'pointer' }}
                            />
                          </td>
                          <td style={{ padding: '7px 10px', color: 'var(--text)', fontWeight: 500 }}>
                            {opt}
                            {opt === 'setup-oraclejars' && !(ss?.status === 'installed') && (
                              <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <button
                                  disabled={oracleDl.status === 'running'}
                                  onClick={() => downloadOracle(sd.scriptDir)}
                                  style={{
                                    background: oracleDl.status === 'success' ? 'var(--success)' : 'var(--warning)',
                                    color: '#fff', border: 'none', borderRadius: 3,
                                    padding: '3px 10px', fontSize: 11, cursor: oracleDl.status === 'running' ? 'default' : 'pointer',
                                    fontWeight: 600, opacity: oracleDl.status === 'running' ? 0.6 : 1,
                                  }}
                                >
                                  {oracleDl.status === 'running' ? 'Downloading…' : oracleDl.status === 'success' ? '✓ Downloaded' : '⬇ Download oracle tar'}
                                </button>
                                {oracleDl.status === 'failed' && <span style={{ fontSize: 11, color: 'var(--danger)' }}>Failed</span>}
                                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Required before running</span>
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                            {isInstalled && <span style={{ color: 'var(--success)', fontWeight: 600 }}>✓ Installed</span>}
                            {isFail      && <span style={{ color: 'var(--danger)'  }}>Failed</span>}
                            {isRunning   && <span style={{ color: 'var(--warning)' }}>Running…</span>}
                            {isPending   && <span style={{ color: 'var(--text-muted)' }}>Pending</span>}
                          </td>
                          <td style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', wordBreak: 'break-all' }}>
                            {ss?.script_path || ''}
                          </td>
                          <td style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'monospace', color: 'var(--text)', wordBreak: 'break-all' }}>
                            {ss?.install_path ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {ss.install_path.split(' ; ').map((p, pi) => (
                                  <span key={pi} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    <span title="Click to copy" style={{ cursor: 'pointer' }}
                                          onClick={() => navigator.clipboard.writeText(p.trim())}>
                                      {p.trim()}
                                    </span>
                                    <button title="Open in Explorer"
                                      onClick={() => fetch('/api/utils/open-folder', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ path: p.trim() }),
                                      })}
                                      style={{
                                        background: 'transparent', border: '1px solid var(--border)',
                                        borderRadius: 3, padding: '1px 5px', cursor: 'pointer',
                                        color: 'var(--text-muted)', fontSize: 12, flexShrink: 0,
                                      }}>
                                      📂
                                    </button>
                                  </span>
                                ))}
                              </div>
                            ) : ''}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                {oracleDl.output && (
                  <pre style={{
                    marginBottom: 10, padding: '8px 10px',
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 4, fontSize: 11, color: 'var(--text-muted)',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 120, overflowY: 'auto',
                  }}>{oracleDl.output}</pre>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Btn
                    label={sd.running ? 'Running…' : 'Run Selected'}
                    color="var(--success)"
                    disabled={!sd.selected?.length || sd.running}
                    onClick={() => runScripts(repoName, sd)}
                  />
                  {sd.status === 'success' && !sd.running && <span style={{ fontSize: 12, color: 'var(--success)' }}>All completed</span>}
                  {sd.status === 'failed'  && !sd.running && <span style={{ fontSize: 12, color: 'var(--danger)'  }}>One or more failed</span>}
                </div>

                {sd.output && (
                  <pre style={{
                    marginTop: 10, padding: '8px 10px',
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 4, fontSize: 11, color: 'var(--text-muted)',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflowY: 'auto',
                  }}>{sd.output}</pre>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
