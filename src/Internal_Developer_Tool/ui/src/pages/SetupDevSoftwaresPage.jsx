import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const ICONS = { intellij: '🧠', postman: '📮', soapui: '🧼', fiddler: '🕵️', docker: '🐳' }

export default function SetupDevSoftwaresPage() {
  const navigate = useNavigate()
  const [data, setData]       = useState({ root: '', items: [], winget: true })
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [job, setJob]         = useState(null) // {title, status, output}

  const load = () => {
    setLoading(true); setError('')
    fetch('/api/setup/dev-softwares').then(r => r.json())
      .then(d => { if (d.ok) setData(d); else setError(d.error || 'Failed to load') })
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const install = (it) => {
    if (job?.status === 'running') return
    setJob({ title: it.title, status: 'running', output: '' })
    fetch('/api/setup/dev-softwares/install', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: it.key }),
    }).then(r => r.json()).then(d => {
      if (!d.ok) { setJob(j => ({ ...j, status: 'failed', output: d.error || 'Failed' })); return }
      const iv = setInterval(() => {
        fetch(`/api/setup/version-managers/status?key=${encodeURIComponent(d.key)}`).then(r => r.json())
          .then(s => {
            setJob(j => ({ ...j, status: s.status, output: s.output }))
            if (s.status !== 'running') { clearInterval(iv); load() }
          }).catch(() => {})
      }, 2000)
    }).catch(() => setJob(j => ({ ...j, status: 'failed', output: 'Request failed' })))
  }
  const busy = job?.status === 'running'

  return (
    <div style={{ padding: '24px 28px', maxWidth: 960 }}>
      <button onClick={() => navigate('/setup')} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 10 }}>← Setup</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--text)' }}>Dev Softwares</h1>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            Installed into <span style={{ fontFamily: 'monospace' }}>{data.root || '{DWB_HOME}\\Installed_Softwares'}</span>
          </div>
        </div>
        <button className="btn" onClick={load} disabled={loading}>{loading ? 'Checking…' : '↻ Refresh'}</button>
      </div>
      {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{error}</div>}
      {!data.winget && <div className="alert alert-danger" style={{ marginBottom: 12 }}>winget is not available on this machine, so installs cannot run.</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {data.items.map(it => (
          <div key={it.key} className="card" style={{ width: 290 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>{ICONS[it.key] || '📦'}</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>{it.title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>{it.desc}</div>
            {it.installed_here
              ? <div style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>● Installed</div>
              : it.installed_elsewhere
                ? <div style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>● Installed elsewhere</div>
                : <div style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>○ Not installed</div>}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all', margin: '4px 0 10px' }}>
              {it.installed_elsewhere || it.target}
            </div>
            {!it.installed_here && (
              <button className="btn btn-primary" disabled={busy || !data.winget} onClick={() => install(it)}>
                {busy && job?.title === it.title ? 'Installing…' : 'Install'}
              </button>
            )}
          </div>
        ))}
      </div>

      {job && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: job.status === 'failed' ? 'var(--danger)' : job.status === 'success' ? 'var(--success)' : 'var(--text)' }}>
            Install {job.title} — {job.status}
          </div>
          <pre style={{ margin: 0, maxHeight: 260, overflow: 'auto', fontSize: 11, whiteSpace: 'pre-wrap' }}>{job.output || 'Starting…'}</pre>
        </div>
      )}
    </div>
  )
}
