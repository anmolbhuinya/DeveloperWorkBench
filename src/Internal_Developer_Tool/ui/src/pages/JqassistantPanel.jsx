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

// Layered module diagram: modules that depend on others sit higher; arrows point to the dependency
function ArchDiagram({ nodes, edges, svgRef }) {
  const levels = {}
  nodes.forEach(n => { (levels[n.level] = levels[n.level] || []).push(n) })
  const top = Math.max(...nodes.map(n => n.level))
  const W = 190, H = 44, GX = 24, GY = 70
  const widest = Math.max(...Object.values(levels).map(l => l.length))
  const width = widest * (W + GX) + GX, height = (top + 1) * (H + GY) + GY / 2
  const pos = {}
  Object.entries(levels).forEach(([lv, arr]) => arr.forEach((n, i) => {
    const rowW = arr.length * (W + GX) - GX
    pos[n.id] = { x: (width - rowW) / 2 + i * (W + GX), y: (top - lv) * (H + GY) + GY / 4 }
  }))
  const col = p => p === 'pom' ? '#fff3e0' : p === 'war' || p === 'ear' ? '#e8f5e9' : '#e3f2fd'
  return (
    <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" width={width} height={height} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 6 }}>
      <defs><marker id="ah" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#78909c" /></marker></defs>
      {edges.map(([m, d], i) => {
        const a = pos[m], b = pos[d]
        return <line key={i} x1={a.x + W / 2} y1={a.y + H} x2={b.x + W / 2} y2={b.y} stroke="#90a4ae" strokeWidth="1" markerEnd="url(#ah)" />
      })}
      {nodes.map(n => (
        <g key={n.id}>
          <rect x={pos[n.id].x} y={pos[n.id].y} width={W} height={H} rx="6" fill={col(n.packaging)} stroke="#1565c0" />
          <text x={pos[n.id].x + W / 2} y={pos[n.id].y + 18} textAnchor="middle" fontSize="11" fontWeight="700" fill="#0d47a1">{n.id.length > 28 ? n.id.slice(0, 27) + '…' : n.id}</text>
          <text x={pos[n.id].x + W / 2} y={pos[n.id].y + 33} textAnchor="middle" fontSize="10" fill="#546e7a">{n.packaging} · {n.java_files} java files</text>
        </g>
      ))}
    </svg>
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
  const [diff, setDiff] = useState(null)
  const [arch, setArch] = useState(null)
  const [archBusy, setArchBusy] = useState(false)
  const [neo, setNeo] = useState({ running: false, url: 'http://localhost:7474', msg: '' })
  const timer = useRef(null)
  const svgRef = useRef(null)
  const [loc, setLoc] = useState('')
  const [locPick, setLocPick] = useState(false)
  const [clone, setClone] = useState({ url: '', branch: '', name: '' })
  const [pickIdx, setPickIdx] = useState(null)   // row whose folder is being browsed

  const load = () => fetch('/api/jqassistant/config').then(r => r.json()).then(d => {
    if (d.ok) { setCfg(d); setLoc(d.project_location); setApps(d.apps.length ? d.apps : [{ name: '', path: '' }]); if (!sel && d.apps[0]) setSel(d.apps[0].name) }
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
  const saveLoc = async () => {
    setMsg('')
    const r = await fetch('/api/jqassistant/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_location: loc }) }).then(r => r.json())
    if (r.ok) { setCfg(r); setLoc(r.project_location); setMsg('Project location saved') } else setMsg(r.error || 'Failed')
  }
  const doClone = async () => {
    if (job?.status === 'running') return
    const r = await fetch('/api/jqassistant/clone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clone) }).then(r => r.json())
    if (!r.ok) { setJob({ label: 'clone', status: 'failed', output: r.error }); return }
    setJob({ id: r.job, label: 'clone', status: 'running', output: '' })
    clearInterval(timer.current)
    timer.current = setInterval(() => {
      fetch(`/api/jqassistant/job/${r.job}`).then(x => x.json()).then(j => {
        setJob({ id: r.job, label: j.label, status: j.status, output: j.output })
        if (j.status !== 'running') { clearInterval(timer.current); if (j.status === 'success') setClone({ url: '', branch: '', name: '' }); load() }
      }).catch(() => {})
    }, 1500)
  }
  const genArch = async () => {
    setArchBusy(true); setArch(null)
    try { setArch(await fetch('/api/jqassistant/architecture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: sel }) }).then(r => r.json())) }
    finally { setArchBusy(false) }
  }
  const neoCall = async action => {
    setNeo(n => ({ ...n, msg: action === 'start' ? 'Starting Neo4j (can take up to 30 s)…' : 'Stopping…' }))
    const r = await fetch('/api/jqassistant/neo4j', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: sel, action }) }).then(r => r.json())
    if (!r.ok) { setNeo(n => ({ ...n, msg: r.error })); return }
    setNeo({ running: r.running, url: r.url || 'http://localhost:7474', msg: r.running ? 'Neo4j is running' : 'Stopped' })
    if (action === 'start' && r.running) window.open(r.url, '_blank')
  }
  useEffect(() => { if (tab === 'arch') fetch('/api/jqassistant/neo4j').then(r => r.json()).then(d => { if (d.ok) setNeo(n => ({ ...n, running: d.running, url: d.url })) }).catch(() => {}) }, [tab])
  const downloadText = (name, text, type) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const makeDiff = async () => {
    const names = Object.keys(sbomApps).filter(k => sbomApps[k])
    setDiff(await fetch('/api/jqassistant/sbom-diff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apps: names }) }).then(r => r.json()))
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
        {tabBtn('code', '1. Code base')}{tabBtn('analyze', '2. Scan & Analyze')}{tabBtn('sbom', '3. SBOM')}{tabBtn('arch', '4. Architecture')}
        <button className="btn" onClick={onClose}>✕</button>
      </div>

      {tab === 'code' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Project location</span>
            <input style={{ ...field, flex: 1, minWidth: 240 }} value={loc} onChange={e => setLoc(e.target.value)} placeholder="~/hebb" />
            <button className="btn" onClick={() => setLocPick(true)}>Browse…</button>
            <button className="btn btn-primary" onClick={saveLoc}>Save location</button>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{cfg.project_location_abs} · stored in Setup\Dev_Softwares\jQAssistant\config.xlsx</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Add from git</span>
            <input style={{ ...field, flex: 1, minWidth: 260 }} placeholder="Repository URL (https://… or git@…)" value={clone.url} onChange={e => setClone(c => ({ ...c, url: e.target.value }))} />
            <input style={{ ...field, width: 130 }} placeholder="Branch (optional)" value={clone.branch} onChange={e => setClone(c => ({ ...c, branch: e.target.value }))} />
            <input style={{ ...field, width: 150 }} placeholder="Folder name (optional)" value={clone.name} onChange={e => setClone(c => ({ ...c, name: e.target.value }))} />
            <button className="btn btn-primary" disabled={!clone.url.trim() || job?.status === 'running'} onClick={doClone}>Clone</button>
          </div>
          {job && job.label.startsWith('clone') && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: job.status === 'failed' ? 'var(--danger)' : job.status === 'success' ? 'var(--success)' : 'var(--text)' }}>{job.label} — {job.status}</div>
              <pre style={{ margin: 0, maxHeight: 200, overflow: 'auto', fontSize: 11, whiteSpace: 'pre-wrap' }}>{job.output || 'Starting…'}</pre>
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Code bases jQAssistant should scan (cloned projects are added automatically). Add several applications for a combined SBOM.</div>
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
      {locPick && <FolderPicker start={cfg.project_location_abs} onCancel={() => setLocPick(false)} onPick={p => { setLoc(p); setLocPick(false) }} />}
      {pickIdx !== null && (
        <FolderPicker start={apps[pickIdx]?.path || cfg.project_location_abs} onCancel={() => setPickIdx(null)}
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

      {tab === 'arch' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cfg.apps.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Configure a code base first.</div>}
          {cfg.apps.length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select style={field} value={sel} onChange={e => { setSel(e.target.value); setArch(null) }}>{cfg.apps.map(a => <option key={a.name}>{a.name}</option>)}</select>
              <button className="btn btn-primary" disabled={archBusy || !sel} onClick={genArch}>{archBusy ? 'Generating…' : 'Generate architecture'}</button>
              <span style={{ borderLeft: '1px solid var(--border)', height: 22 }} />
              <button className="btn" disabled={!sel} onClick={() => neoCall('start')} title="Starts jQAssistant's embedded Neo4j on the scanned store and opens Neo4j Browser">Open Neo4j Browser</button>
              {neo.running && <><a href={neo.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>{neo.url}</a><button className="btn" onClick={() => neoCall('stop')}>Stop Neo4j</button></>}
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{neo.msg}</span>
            </div>
          )}
          {arch && !arch.ok && <div className="alert alert-danger">{arch.error}</div>}
          {arch?.ok && (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{arch.nodes.length} modules · {arch.edges.length} dependencies between them (top = depends on the ones below)</span>
                <button className="btn" onClick={() => downloadText(`${sel}_architecture.svg`, new XMLSerializer().serializeToString(svgRef.current), 'image/svg+xml')}>Download SVG</button>
                <button className="btn" onClick={() => downloadText(`${sel}_architecture.mmd`, arch.mermaid, 'text/plain')}>Download Mermaid</button>
              </div>
              <div style={{ overflow: 'auto', maxHeight: 560 }}><ArchDiagram nodes={arch.nodes} edges={arch.edges} svgRef={svgRef} /></div>
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
          <div><button className="btn btn-primary" disabled={!Object.values(sbomApps).some(Boolean)} onClick={makeSbom}>Generate SBOM &amp; report</button>
            <button className="btn" style={{ marginLeft: 8 }} disabled={Object.values(sbomApps).filter(Boolean).length < 2} onClick={makeDiff}
              title="Libraries used with different versions across the selected applications">SBOM Diff</button></div>
          {sbom && (sbom.ok
            ? <div style={{ fontSize: 13 }}>{sbom.applications} application(s) · {sbom.components} unique components · {sbom.entries} entries —{' '}
                {['json', 'csv', 'html'].map(k => <a key={k} style={{ marginRight: 10 }} href={`/api/jqassistant/sbom/download?file=${sbom.files[k]}`}>Download {k.toUpperCase()}</a>)}</div>
            : <div className="alert alert-danger">{sbom.error}</div>)}
          {diff && (diff.ok
            ? <div>
                <div style={{ fontSize: 13, marginBottom: 6 }}>{diff.differences.length} librar{diff.differences.length === 1 ? 'y' : 'ies'} with different versions across {diff.applications.join(', ')} —{' '}
                  {['json', 'csv', 'html'].map(k => <a key={k} style={{ marginRight: 10 }} href={`/api/jqassistant/sbom/download?file=${diff.files[k]}`}>Download {k.toUpperCase()}</a>)}</div>
                {diff.differences.length > 0 && (
                  <div style={{ maxHeight: 340, overflow: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>{['Group', 'Artifact', ...diff.applications].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                      <tbody>{diff.differences.map((d, i) => {
                        const by = d.apps
                        return <tr key={i}><td style={td}>{d.group}</td><td style={td}>{d.artifact}</td>{diff.applications.map(a => <td key={a} style={{ ...td, background: by[a] ? 'rgba(255,152,0,0.12)' : 'transparent' }}>{by[a] ? by[a].join(', ') : '-'}</td>)}</tr>
                      })}</tbody>
                    </table>
                  </div>)}
              </div>
            : <div className="alert alert-danger">{diff.error}</div>)}
        </div>
      )}
    </div>
  )
}
