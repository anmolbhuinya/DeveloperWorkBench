import { useState, useEffect, useRef, useCallback } from 'react'

const API = '/api/ai-analyzer'
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(r => r.json())

const STATUS_COLOR = { created: '#607d8b', analyzing: '#1565c0', analyzed: '#2e7d32', rca: '#1565c0', 'rca done': '#2e7d32', failed: '#c62828' }

// AI Analyzer: JIRA ticket -> working folder (under the configured workspace) -> AI agent analysis / RCA.
export default function AIAnalyzerPage() {
  const [cfg,      setCfg]      = useState(null)
  const [cfgOpen,  setCfgOpen]  = useState(false)
  const [draft,    setDraft]    = useState({})
  const [cfgMsg,   setCfgMsg]   = useState('')

  const [jiraId,   setJiraId]   = useState('')
  const [looking,  setLooking]  = useState(false)
  const [ticket,   setTicket]   = useState(null)    // {jira_id, title, url, status}
  const [suffix,   setSuffix]   = useState('')      // editable part of the folder name (after "<JIRA-ID>_")
  const [creating, setCreating] = useState(false)
  const [err,      setErr]      = useState('')

  const [projects, setProjects] = useState([])
  const [selId,    setSelId]    = useState(null)
  const [kind,     setKind]     = useState('analyze')     // which job output is shown
  const [job,      setJob]      = useState(null)
  const [doc,      setDoc]      = useState(null)           // {which, text}
  const [busy,     setBusy]     = useState('')
  const termRef = useRef(null)

  const sel = projects.find(p => p.id === selId) || null

  const loadCfg = () => fetch(`${API}/config`).then(r => r.json()).then(d => { if (d.ok) { setCfg(d.config); setDraft(d.config) } }).catch(() => {})
  const loadProjects = useCallback(() =>
    fetch(`${API}/projects`).then(r => r.json()).then(d => { if (d.ok) setProjects(d.projects) }).catch(() => {}), [])
  useEffect(() => { loadCfg(); loadProjects() }, [loadProjects])

  async function saveCfg() {
    setCfgMsg('')
    const d = await post(`${API}/config`, draft).catch(() => ({ ok: false, error: 'Could not reach server' }))
    if (d.ok) { setCfg(d.config); setDraft(d.config); setCfgMsg('✓ Saved'); setCfgOpen(!d.config.workspace_dir) }
    else setCfgMsg(d.error || 'Save failed')
  }

  async function lookup() {
    setErr(''); setTicket(null); setLooking(true)
    const d = await post(`${API}/lookup`, { jira_id: jiraId }).catch(() => ({ ok: false, error: 'Could not reach server' }))
    setLooking(false)
    if (!d.ok) { setErr(d.error); return }
    setTicket(d)
    setSuffix(d.folder_name.slice(d.jira_id.length + 1))
  }

  async function create() {
    setErr(''); setCreating(true)
    const clean = suffix.trim().replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_')
    const d = await post(`${API}/projects`, {
      jira_id: ticket.jira_id, title: ticket.title, url: ticket.url,
      folder_name: clean ? `${ticket.jira_id}_${clean}` : ticket.jira_id,
    }).catch(() => ({ ok: false, error: 'Could not reach server' }))
    setCreating(false)
    if (!d.ok) { setErr(d.error); return }
    setTicket(null); setJiraId(''); setSuffix('')
    await loadProjects()
    pick(d.project.id)
  }

  function pick(id) { setSelId(id); setKind('analyze'); setJob(null); setDoc(null) }

  // job output: load when the selection / tab changes, then poll while running
  const fetchJob = useCallback(async () => {
    if (!selId) return null
    const d = await fetch(`${API}/projects/${selId}/${kind}/job`).then(r => r.json()).catch(() => null)
    if (d?.ok) { setJob(d.job); return d.job }
    return null
  }, [selId, kind])
  useEffect(() => { setJob(null); fetchJob() }, [fetchJob])
  useEffect(() => {
    if (job?.status !== 'running') return
    const id = setInterval(async () => {
      const j = await fetchJob()
      if (j && j.status !== 'running') { loadProjects(); loadDoc(kind === 'analyze' ? 'analysis' : 'rca') }
    }, 2000)
    return () => clearInterval(id)
  }, [job?.status, fetchJob])
  useEffect(() => { if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight }, [job?.output])

  async function loadDoc(which) {
    if (!selId) return
    const d = await fetch(`${API}/projects/${selId}/file?which=${which}`).then(r => r.json()).catch(() => null)
    setDoc(d?.ok && d.exists ? { which, text: d.text, path: d.path } : { which, text: '', path: '' })
  }

  async function run(k) {
    setErr(''); setBusy(k)
    const d = await post(`${API}/projects/${selId}/${k}`).catch(() => ({ ok: false, error: 'Could not reach server' }))
    setBusy('')
    if (!d.ok) { setErr(d.error); return }
    setKind(k); await fetchJob(); loadProjects()
  }
  const abort = () => post(`${API}/projects/${selId}/${kind}/abort`).then(fetchJob)
  const openFolder = (id, target) => post(`${API}/projects/${id}/open-folder`, { target })

  const running = job?.status === 'running'
  const btn = (primary, disabled) => ({
    fontSize: 12, fontWeight: 600, padding: '5px 14px', borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
    background: disabled ? 'var(--surface2)' : primary ? '#2E7D32' : 'transparent',
    color: disabled ? 'var(--text-muted)' : primary ? '#fff' : 'var(--text)', border: primary && !disabled ? 'none' : '1px solid var(--border)',
  })
  const inp = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }
  const needCfg = cfg && !cfg.workspace_dir

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--text)' }}>🧠 AI Analyzer</h1>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Analyse a JIRA ticket with the AI agent and generate an RCA</div>
        </div>
        <button onClick={() => setCfgOpen(o => !o)} style={btn(false)}>⚙ Settings</button>
      </div>

      {(cfgOpen || needCfg) && (
        <div className="card" style={{ padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Settings {needCfg && <span style={{ color: '#ef6c00', fontWeight: 400 }}>- set the workspace directory to get started</span>}</div>
          {[['workspace_dir', 'Workspace directory', 'C:\\Users\\you\\Documents\\AI_Analyzer'], ['agent_command', 'Agent command', 'claude --dangerously-skip-permissions'],
            ['code_dirs', 'Source folders (optional, ; separated)', 'C:\\repos\\hrp.payer.core-master;C:\\repos\\other']].map(([k, label, ph]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 230, fontSize: 12, color: 'var(--text-muted)' }}>{label}</div>
              <input value={draft[k] || ''} placeholder={ph} onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} style={{ ...inp, flex: 1, fontFamily: 'monospace', fontSize: 12 }} />
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <button onClick={saveCfg} style={btn(true)}>Save</button>
            {cfgMsg && <span style={{ fontSize: 12, color: cfgMsg.startsWith('✓') ? '#2e7d32' : '#c62828' }}>{cfgMsg}</span>}
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Stored in Tools/AIAnalyzer/config.xlsx</span>
          </div>
        </div>
      )}

      {/* new project */}
      <div className="card" style={{ padding: '12px 14px', marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>New analysis</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={jiraId} onChange={e => { setJiraId(e.target.value); setTicket(null) }} onKeyDown={e => e.key === 'Enter' && jiraId.trim() && lookup()}
            placeholder="JIRA ID or URL, e.g. PAYOR-209520" style={{ ...inp, width: 300 }} />
          <button onClick={lookup} disabled={!jiraId.trim() || looking || needCfg} style={btn(false, !jiraId.trim() || looking || needCfg)}>
            {looking ? 'Fetching…' : 'Fetch ticket'}
          </button>
        </div>
        {ticket && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13 }}><b>{ticket.jira_id}</b> - {ticket.title} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>[{ticket.status}]</span></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Working folder:</span>
              <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{ticket.jira_id}_</span>
              <input value={suffix} onChange={e => setSuffix(e.target.value)} style={{ ...inp, flex: 1, fontFamily: 'monospace', fontSize: 12 }} title="Edit the folder name taken from the ticket title" />
              <button onClick={create} disabled={creating} style={btn(true, creating)}>{creating ? 'Creating…' : 'Create project'}</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {cfg?.workspace_dir}\{ticket.jira_id}_{suffix}\ai_workspace
            </div>
          </div>
        )}
        {err && <div style={{ color: '#c62828', fontSize: 12, marginTop: 8, whiteSpace: 'pre-wrap' }}>{err}</div>}
      </div>

      {/* all projects */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--border)' }}>
          Projects <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({projects.length})</span>
        </div>
        {projects.length === 0 && <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>No projects yet - fetch a ticket above to create one.</div>}
        {projects.map(p => (
          <div key={p.id} onClick={() => pick(p.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer',
            background: p.id === selId ? 'rgba(25,118,210,0.08)' : 'transparent' }}>
            <a href={p.jira_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontWeight: 700, fontSize: 12, width: 110, color: 'var(--primary)' }}>{p.jira_id}</a>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.folder_path}>
              {p.title}
              {!p.folder_exists && <span style={{ color: '#c62828', fontSize: 11 }}> (folder missing)</span>}
            </div>
            {p.has_analysis && <span title="ANALYSIS.md exists" style={{ fontSize: 11 }}>📝</span>}
            {p.has_rca && <span title="RCA document exists" style={{ fontSize: 11 }}>📄</span>}
            <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 10, color: '#fff', background: STATUS_COLOR[p.status] || '#607d8b' }}>{p.status}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 110 }}>{p.created}</span>
            <button onClick={e => { e.stopPropagation(); openFolder(p.id, 'folder') }} style={{ ...btn(false), padding: '2px 10px', fontSize: 11 }} title={p.folder_path}>📂 Folder</button>
          </div>
        ))}
      </div>

      {/* selected project */}
      {sel && (
        <div className="card" style={{ padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{sel.jira_id} <span style={{ fontWeight: 400 }}>{sel.title}</span></div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => run('analyze')} disabled={running || !!busy} style={btn(true, running || !!busy)}>
                {busy === 'analyze' || (running && kind === 'analyze') ? '⏳ Analysing…' : '🔍 Analyze'}
              </button>
              <button onClick={() => run('rca')} disabled={running || !!busy || !sel.has_analysis && sel.analyze_status !== 'done'} style={btn(false, running || !!busy || (!sel.has_analysis && sel.analyze_status !== 'done'))}
                title="Needs the analysis first">
                {busy === 'rca' || (running && kind === 'rca') ? '⏳ Generating RCA…' : '📄 Generate RCA'}
              </button>
              <button onClick={() => openFolder(sel.id, 'folder')} style={btn(false)}>📂 Open working folder</button>
              <button onClick={() => openFolder(sel.id, 'supporting')} style={btn(false)} title="Drop logs, stack traces and other relevant files here for the agent">
                📎 Supporting data{sel.supporting_count ? ` (${sel.supporting_count})` : ''}
              </button>
              {sel.has_rca && <button onClick={() => openFolder(sel.id, 'rca')} style={btn(false)}>📄 Show RCA file</button>}
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', marginBottom: 8 }}>{sel.ai_workspace}  (supporting_data and RCA folders are next to it)</div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {[['analyze', 'Analysis log'], ['rca', 'RCA log']].map(([k, label]) => (
              <button key={k} onClick={() => { setKind(k); setDoc(null) }} style={{ ...btn(false), background: kind === k ? 'rgba(25,118,210,0.12)' : 'transparent', fontWeight: kind === k ? 700 : 500, padding: '3px 12px' }}>{label}</button>
            ))}
            <button onClick={() => loadDoc('analysis')} style={{ ...btn(false), padding: '3px 12px', marginLeft: 'auto' }}>View ANALYSIS.md</button>
            <button onClick={() => loadDoc('rca')} style={{ ...btn(false), padding: '3px 12px' }}>View RCA</button>
            <button onClick={() => loadDoc('ticket')} style={{ ...btn(false), padding: '3px 12px' }}>View ticket</button>
          </div>

          {doc ? (
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', padding: '6px 12px', background: 'var(--surface2)', fontSize: 12 }}>
                <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{doc.path || `${doc.which} - not created yet`}</span>
                <button onClick={() => setDoc(null)} style={{ ...btn(false), marginLeft: 'auto', padding: '1px 10px', fontSize: 11 }}>✕ Close</button>
              </div>
              <pre style={{ margin: 0, padding: 12, maxHeight: 460, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.5 }}>{doc.text || 'Nothing here yet.'}</pre>
            </div>
          ) : job ? (
            <div style={{ border: `1px solid ${job.status === 'failed' ? '#c62828' : job.status === 'done' ? '#2e7d32' : '#1565c0'}`, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--surface2)', fontSize: 12, fontWeight: 600 }}>
                {running && <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />}
                {kind === 'analyze' ? 'Analysis' : 'RCA'} - {job.status}
                {running && <button onClick={abort} style={{ marginLeft: 'auto', fontSize: 11, padding: '1px 10px', borderRadius: 6, background: '#b71c1c', color: '#fff', border: 'none', cursor: 'pointer' }}>■ Abort</button>}
              </div>
              <pre ref={termRef} style={{ margin: 0, padding: 12, background: '#0d1117', color: '#c9d1d9', fontSize: 11.5, lineHeight: 1.45, height: 340, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{job.output || 'Starting agent…'}</pre>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 2px' }}>
              {kind === 'analyze' ? 'Click Analyze to let the AI agent analyse this ticket.' : 'No RCA has been generated yet.'} The agent keeps running if the Workbench is restarted.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
