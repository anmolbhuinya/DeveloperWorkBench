import { useState, useEffect, useRef } from 'react'

const field = { padding: '5px 8px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)' }
const th = { textAlign: 'left', padding: '4px 8px', fontSize: 11, background: 'var(--surface)', borderBottom: '2px solid var(--border)', position: 'sticky', top: 0 }
const td = { padding: '3px 8px', fontSize: 12, borderBottom: '1px solid var(--border)' }

// Server-side folder picker (the browser cannot reveal real folder paths)
function FolderPicker({ start, onPick, onCancel }) {
  const [st, setSt] = useState({ path: '', parent: null, dirs: [], has_pom: false })
  const [err, setErr] = useState('')
  const go = p => fetch(`/api/jqassistant/browse?path=${encodeURIComponent(p || '')}`).then(r => r.json())
    .then(d => { if (d.ok) { setSt(d); setErr('') } else setErr(d.error) }).catch(() => setErr('Request failed'))
  useEffect(() => { go(start) }, [])
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontWeight: 700 }}>Select project folder</div>
        <div style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{st.path || 'This PC'}{st.has_pom && <span style={{ color: 'var(--success)' }}> · Maven project (pom.xml)</span>}</div>
        {err && <div className="alert alert-danger">{err}</div>}
        <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6, minHeight: 220 }}>
          {st.path !== '' && <div style={{ padding: '5px 10px', cursor: 'pointer', fontSize: 13 }} onClick={() => go(st.parent || '')}>⬆ ..</div>}
          {st.dirs.map(d => <div key={d.path} style={{ padding: '5px 10px', cursor: 'pointer', fontSize: 13, borderTop: '1px solid var(--border)' }} onClick={() => go(d.path)}>📁 {d.name}</div>)}
          {st.dirs.length === 0 && !err && <div style={{ padding: 10, fontSize: 12, color: 'var(--text-muted)' }}>No sub-folders</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {st.home && st.path === '' && <button className="btn" onClick={() => go(st.home)}>Home</button>}
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={!st.path} onClick={() => onPick(st.path)}>Select this folder</button>
        </div>
      </div>
    </div>
  )
}

export default function JqassistantPanel({ onClose }) {
  const [tab, setTab] = useState('code')
  const [cfg, setCfg] = useState({ apps: [], installed: true, version: '', results: {} })
  const [apps, setApps] = useState([])            // editable copy of the configured code bases
  const [msg, setMsg] = useState('')
  const [job, setJob] = useState(null)            // {id, label, status, output}
  const [sel, setSel] = useState('')              // application shown on the Analyze tab
  const [result, setResult] = useState(null)
  const [view, setView] = useState('direct')
  const [sbomApps, setSbomApps] = useState({})
  const [sbom, setSbom] = useState(null)
  const timer = useRef(null)
  const [pickIdx, setPickIdx] = useState(null)   // row whose folder is being browsed

  const load = () => fetch('/api/jqassistant/config').then(r => r.json()).then(d => {
    if (d.ok) { setCfg(d); setApps(d.apps.length ? d.apps : [{ name: '', path: '' }]); if (!sel && d.apps[0]) setSel(d.apps[0].name) }
  })
  useEffect(() => { load(); return () => clearInterval(timer.current) }, [])
  useEffect(() => {
    if (tab === 'analyze' && sel) fetch(`/api/jqassistant/result/${encodeURIComponent(sel)}`).then(r => r.json()).then(d => setResult(d))
  }, [tab, sel, job?.status])

  const save = async () => {
    setMsg('')
    const r = await fetch('/api/jqassistant/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apps }) }).then(r => r.json())
    if (r.ok) { setCfg(r); setApps(r.apps.length ? r.apps : [{ name: '', path: '' }]); setMsg('Saved'); if (!sel && r.apps[0]) setSel(r.apps[0].name) } else setMsg(r.error || 'Failed')
  }
  const run = async (app, step) => {
    if (job?.status === 'running') return
    const r = await fetch('/api/jqassistant/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app, step }) }).then(r => r.json())
    if (!r.ok) { setJob({ label: `${step} ${app}`, status: 'failed', output: r.error }); return }
    setJob({ id: r.job, label: `${step} ${app}`, status: 'running', output: '' })
    clearInterval(timer.current)
    timer.current = setInterval(() => {
      fetch(`/api/jqassistant/job/${r.job}`).then(x => x.json()).then(j => {
        setJob({ id: r.job, label: j.label, status: j.status, output: j.output })
        if (j.status !== 'running') { clearInterval(timer.current); load() }
      }).catch(() => {})
    }, 1500)
  }
  const makeSbom = async () => {
    const names = Object.keys(sbomApps).filter(k => sbomApps[k])
    const r = await fetch('/api/jqassistant/sbom', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apps: names }) }).then(r => r.json())
    setSbom(r)
  }

  const modules = result?.modules || []
  const direct = [], trans = []
  modules.forEach(m => m.deps.forEach(d => (d.level <= 1 ? direct : trans).push([m.module, d.group, d.artifact, d.version, d.scope])))
  const tabBtn = (k, t) => <button className={`btn ${tab === k ? 'btn-primary' : ''}`} onClick={() => setTab(k)}>{t}</button>
  const running = job?.status === 'running'

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1, fontWeight: 700, fontSize: 16 }}>🔍 jQAssistant {cfg.version && <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)' }}>v{cfg.version}</span>}</div>
        {tabBtn('code', '1. Code base')}{tabBtn('analyze', '2. Scan & Analyze')}{tabBtn('sbom', '3. SBOM')}
        <button className="btn" onClick={onClose}>✕</button>
      </div>

      {tab === 'code' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Configure the code bases (application folders) jQAssistant should scan. Add several applications for a combined SBOM.</div>
          {apps.map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...field, width: 180 }} placeholder="Application name" value={a.name} onChange={e => setApps(x => x.map((y, j) => j === i ? { ...y, name: e.target.value } : y))} />
              <input style={{ ...field, flex: 1 }} placeholder="Folder - use Browse… to pick the project" value={a.path} onChange={e => setApps(x => x.map((y, j) => j === i ? { ...y, path: e.target.value } : y))} />
              <button className="btn" onClick={() => setPickIdx(i)}>Browse…</button>
              <button className="btn" onClick={() => setApps(x => x.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn" onClick={() => setApps(x => [...x, { name: '', path: '' }])}>+ Add application</button>
            <button className="btn btn-primary" onClick={save}>Save</button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{msg}</span>
          </div>
        </div>
      )}
      {pickIdx !== null && (
        <FolderPicker start={apps[pickIdx]?.path} onCancel={() => setPickIdx(null)}
          onPick={p => {
            setApps(x => x.map((y, j) => j === pickIdx ? { ...y, path: p, name: y.name || p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() } : y))
            setPickIdx(null)
          }} />
      )}

      {tab === 'analyze' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cfg.apps.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Configure a code base first.</div>}
          {cfg.apps.length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select style={field} value={sel} onChange={e => setSel(e.target.value)}>{cfg.apps.map(a => <option key={a.name}>{a.name}</option>)}</select>
              <button className="btn" disabled={running || !sel} onClick={() => run(sel, 'scan')}>Scan code base</button>
              <button className="btn btn-primary" disabled={running || !sel} onClick={() => run(sel, 'analyze')}>Analyze dependencies</button>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {cfg.results[sel]?.scanned ? `scanned ${cfg.results[sel].scanned}` : 'not scanned'} · {cfg.results[sel]?.analyzed ? `analyzed ${cfg.results[sel].analyzed}` : 'not analyzed'}
              </span>
            </div>
          )}
          {job && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: job.status === 'failed' ? 'var(--danger)' : job.status === 'success' ? 'var(--success)' : 'var(--text)' }}>{job.label} — {job.status}</div>
              <pre style={{ margin: 0, maxHeight: 200, overflow: 'auto', fontSize: 11, whiteSpace: 'pre-wrap' }}>{job.output || 'Starting…'}</pre>
            </div>
          )}
          {modules.length > 0 && (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className={`btn ${view === 'direct' ? 'btn-primary' : ''}`} onClick={() => setView('direct')}>Dependencies ({direct.length})</button>
                <button className={`btn ${view === 'trans' ? 'btn-primary' : ''}`} onClick={() => setView('trans')}>Transitive dependencies ({trans.length})</button>
              </div>
              <div style={{ maxHeight: 340, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{['Module', 'Group', 'Artifact', 'Version', 'Scope'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>{(view === 'direct' ? direct : trans).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={td}>{c}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'sbom' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Pick the applications to include (each must be analyzed). One SBOM (CycloneDX JSON) plus CSV and HTML reports are generated across them.</div>
          {cfg.apps.map(a => (
            <label key={a.name} style={{ fontSize: 13 }}>
              <input type="checkbox" checked={!!sbomApps[a.name]} onChange={e => setSbomApps(s => ({ ...s, [a.name]: e.target.checked }))} /> {a.name}
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}> {cfg.results[a.name]?.analyzed ? `(analyzed ${cfg.results[a.name].analyzed})` : '(not analyzed)'}</span>
            </label>
          ))}
          <div><button className="btn btn-primary" disabled={!Object.values(sbomApps).some(Boolean)} onClick={makeSbom}>Generate SBOM &amp; report</button></div>
          {sbom && (sbom.ok
            ? <div style={{ fontSize: 13 }}>{sbom.applications} application(s) · {sbom.components} unique components · {sbom.entries} entries —{' '}
                {['json', 'csv', 'html'].map(k => <a key={k} style={{ marginRight: 10 }} href={`/api/jqassistant/sbom/download?file=${sbom.files[k]}`}>Download {k.toUpperCase()}</a>)}</div>
            : <div className="alert alert-danger">{sbom.error}</div>)}
        </div>
      )}
    </div>
  )
}
