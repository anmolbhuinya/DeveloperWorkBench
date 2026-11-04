import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import JqassistantPanel from './JqassistantPanel'

const ICONS = { intellij: '🧠', postman: '📮', soapui: '🧼', fiddler: '🕵️', docker: '🐳', dbeaver: '🗄️', jqassistant: '🔍' }

export default function SetupDevSoftwaresPage() {
  const navigate = useNavigate()
  const [data, setData]       = useState({ root: '', items: [], winget: true })
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [jobs, setJobs]   = useState({}) // key -> {title, status, output}
  const timers = useRef({})
  const [showJqa, setShowJqa] = useState(false)

  const load = () => {
    setLoading(true); setError('')
    fetch('/api/setup/dev-softwares').then(r => r.json())
      .then(d => { if (d.ok) setData(d); else setError(d.error || 'Failed to load') })
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])
  useEffect(() => () => Object.values(timers.current).forEach(clearInterval), [])

  const patch = (key, v) => setJobs(j => ({ ...j, [key]: { ...(j[key] || {}), ...v } }))
  const install = (it, action = 'install') => {
    if (jobs[it.key]?.status === 'running') return
    if (action === 'uninstall' && !window.confirm(`Uninstall ${it.title}?`)) return
    patch(it.key, { title: it.title, action, status: 'running', output: '' })
    fetch(`/api/setup/dev-softwares/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: it.key }),
    }).then(r => r.json()).then(d => {
      if (!d.ok) { patch(it.key, { status: 'failed', output: d.error || 'Failed' }); return }
      timers.current[it.key] = setInterval(() => {
        fetch(`/api/setup/version-managers/status?key=${encodeURIComponent(d.key)}`).then(r => r.json())
          .then(s => {
            patch(it.key, { status: s.status, output: s.output })
            if (s.status !== 'running') { clearInterval(timers.current[it.key]); load() }
          }).catch(() => {})
      }, 2000)
    }).catch(() => patch(it.key, { status: 'failed', output: 'Request failed' }))
  }
  const closeJob = (key) => setJobs(j => { const n = { ...j }; delete n[key]; return n })
  const running = (key) => jobs[key]?.status === 'running'
  const jobKeys = Object.keys(jobs)

  return (
    <div style={{ padding: '24px 28px', }}>
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

      {showJqa && <JqassistantPanel onClose={() => setShowJqa(false)} />}
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', marginTop: showJqa ? 16 : 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 290px)', gap: 16, flex: '0 0 auto' }}>
        {data.items.map(it => (
          <div key={it.key} className="card" style={{ width: 290, cursor: it.key === 'jqassistant' && it.installed_here ? 'pointer' : 'default' }}
            onClick={() => { if (it.key === 'jqassistant' && it.installed_here) setShowJqa(true) }}
            title={it.key === 'jqassistant' && it.installed_here ? 'Click to configure, scan and analyze code bases' : undefined}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>{ICONS[it.key] || '📦'}</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>{it.title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>{it.desc}</div>
            {it.installed_here
              ? <div style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>● Installed{it.version ? ` · v${it.version}` : ''}</div>
              : it.installed_elsewhere
                ? <div style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>● Installed elsewhere</div>
                : <div style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>○ Not installed</div>}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all', margin: '4px 0 10px' }}>
              {it.installed_elsewhere || it.target}
            </div>
            {!it.installed_here && (
              <button className="btn btn-primary" disabled={running(it.key) || (!data.winget && it.key !== 'jqassistant')} onClick={e => { e.stopPropagation(); install(it) }}>
                {running(it.key) ? 'Installing…' : 'Install'}
              </button>
            )}
            {it.installed_here && (
              <button className="btn" disabled={running(it.key)} onClick={e => { e.stopPropagation(); install(it, 'uninstall') }}>
                {running(it.key) && jobs[it.key]?.action === 'uninstall' ? 'Uninstalling…' : 'Uninstall'}
              </button>
            )}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 360, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {jobKeys.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>Install logs appear here. Several installs can run at once.</div>}
        {jobKeys.map(k => { const job = jobs[k]; return (
          <div key={k} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ flex: 1, fontWeight: 600, fontSize: 13, color: job.status === 'failed' ? 'var(--danger)' : job.status === 'success' ? 'var(--success)' : 'var(--text)' }}>
                {job.action === 'uninstall' ? 'Uninstall' : 'Install'} {job.title} — {job.status}
              </div>
              {job.status !== 'running' && <button className="btn" onClick={() => closeJob(k)}>✕</button>}
            </div>
            <pre style={{ margin: 0, maxHeight: 280, overflow: 'auto', fontSize: 11, whiteSpace: 'pre-wrap' }}>{job.output || 'Starting…'}</pre>
          </div>
        ) })}
      </div>
      </div>
    </div>
  )
}
