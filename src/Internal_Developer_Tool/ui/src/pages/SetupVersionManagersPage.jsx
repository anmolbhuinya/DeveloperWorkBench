import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const MANAGERS = [
  { key: 'sdkman', icon: '☕', title: 'SDKMAN',  lang: 'Java',       ph: 'e.g. 21.0.5-tem',       url: 'https://sdkman.io/install' },
  { key: 'pyenv',  icon: '🐍', title: 'Pyenv',   lang: 'Python',     ph: 'e.g. 3.12.4',    url: 'https://github.com/pyenv-win/pyenv-win#installation' },
  { key: 'nvm',    icon: '🟩', title: 'NVM',     lang: 'JavaScript', ph: 'e.g. 20.11.1', url: 'https://github.com/coreybutler/nvm-windows/releases' },
  { key: 'go',     icon: '🐹', title: 'Go SDKs', lang: 'Go',         ph: 'e.g. 1.22.0', url: 'https://go.dev/doc/install' },
]

export default function SetupVersionManagersPage() {
  const navigate = useNavigate()
  const [data, setData]       = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  const load = () => {
    setLoading(true); setError('')
    fetch('/api/setup/version-managers')
      .then(r => r.json())
      .then(d => { if (d.ok) setData(d.managers || {}); else setError(d.error || 'Failed to load') })
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const [inputs, setInputs] = useState({})
  const [job, setJob]       = useState(null) // {mgr, action, version, status, output}

  const run = (mgr, action, version) => {
    version = (version || '').trim()
    if (!version || job?.status === 'running') return
    if (action === 'uninstall' && !window.confirm(`Uninstall ${version}?`)) return
    setJob({ mgr, action, version, status: 'running', output: '' })
    fetch('/api/setup/version-managers/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manager: mgr, action, version }),
    })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) { setJob(j => ({ ...j, status: 'failed', output: d.error || 'Failed' })); return }
        const iv = setInterval(() => {
          fetch(`/api/setup/version-managers/status?key=${encodeURIComponent(d.key)}`)
            .then(r => r.json())
            .then(s => {
              setJob(j => ({ ...j, status: s.status, output: s.output }))
              if (s.status !== 'running') { clearInterval(iv); load() }
            })
            .catch(() => {})
        }, 1500)
      })
      .catch(() => setJob(j => ({ ...j, status: 'failed', output: 'Request failed' })))
  }
  const busy = job?.status === 'running'
  const btn = { fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1 }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 960 }}>
      <button onClick={() => navigate('/setup')} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 10 }}>← Setup</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--text)' }}>Version Managers</h1>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Manage Java, Python and JavaScript runtimes</div>
        </div>
        <button className="btn" onClick={load} disabled={loading}>{loading ? 'Checking…' : '↻ Refresh'}</button>
      </div>
      {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {MANAGERS.map(m => {
          const s = data[m.key]
          return (
            <div key={m.key} className="card" style={{ width: 290 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>{m.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>{m.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>{m.lang}</div>
              {loading && !s ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Checking…</div>
              ) : s?.installed ? (
                <>
                  <div style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>
                    ● Installed{s.version ? ` (${s.version})` : ''}
                  </div>
                  {s.path && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all', marginTop: 4 }}>{s.path}</div>}
                  <div style={{ fontSize: 12, marginTop: 8, color: 'var(--text)' }}>
                    Active: <b>{s.active || '—'}</b>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                    {(s.versions || []).length
                      ? s.versions.map(v => {
                          const act = v === s.active || `v${v}` === s.active || v === `v${s.active}`
                          return (
                            <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ flex: 1, fontSize: 12, fontFamily: 'monospace', color: act ? 'var(--primary)' : 'var(--text)', fontWeight: act ? 700 : 400 }}>{v}{act ? ' ●' : ''}</span>
                              <button disabled={busy || act} style={{ ...btn, opacity: busy || act ? 0.4 : 1 }} onClick={() => run(m.key, 'use', v)}>Use</button>
                              <button disabled={busy} style={{ ...btn, color: 'var(--danger)' }} onClick={() => run(m.key, 'uninstall', v)}>Uninstall</button>
                            </div>
                          )
                        })
                      : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No versions installed</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <input value={inputs[m.key] || ''} placeholder={m.ph}
                      onChange={e => setInputs(p => ({ ...p, [m.key]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && run(m.key, 'install', inputs[m.key])}
                      style={{ flex: 1, minWidth: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', color: 'var(--text)', fontFamily: 'monospace', fontSize: 12 }} />
                    <button disabled={busy || !(inputs[m.key] || '').trim()} className="btn btn-primary" onClick={() => run(m.key, 'install', inputs[m.key])}>Install</button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>○ Not installed</div>
                  <a href={m.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--primary)', display: 'inline-block', marginTop: 8 }}>Install instructions ↗</a>
                </>
              )}
            </div>
          )
        })}
      </div>

      {job && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: job.status === 'failed' ? 'var(--danger)' : job.status === 'success' ? 'var(--success)' : 'var(--text)' }}>
            {job.action} {job.version} ({job.mgr}) — {job.status}
          </div>
          <pre style={{ margin: 0, maxHeight: 260, overflow: 'auto', fontSize: 11, whiteSpace: 'pre-wrap' }}>{job.output || 'Starting…'}</pre>
        </div>
      )}
    </div>
  )
}
