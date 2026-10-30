import { useState, useRef, useEffect, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'

const API = '/api/project-management/sonar-report'

const SEV_STYLE = {
  BLOCKER:  { bg: '#B71C1C', color: '#fff' },
  CRITICAL: { bg: '#C62828', color: '#fff' },
  MAJOR:    { bg: '#E65100', color: '#fff' },
  MINOR:    { bg: '#2E7D32', color: '#fff' },
  INFO:     { bg: '#546E7A', color: '#fff' },
}

function parseSonarUrl(raw) {
  try {
    const url  = new URL(raw.trim())
    const id   = url.searchParams.get('id')   || ''
    const pr   = url.searchParams.get('pullRequest') || ''
    return { id: id.replace(/%3A/gi, ':'), pr }
  } catch {
    return null
  }
}

function fmtSize(bytes) {
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fmtDate(epochSec) {
  return new Date(epochSec * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// Colour git-status lines: modified = amber, added/untracked = green, deleted = red, renamed = blue.
function colorizeLog(text) {
  let untracked = false
  return text.split('\n').map((ln, i) => {
    if (/^Untracked files:/.test(ln)) untracked = true
    else if (/^(Changes (not staged|to be committed)|On branch|\$ )/.test(ln)) untracked = false
    let style = null
    const m = ln.match(/^\s+(modified|new file|deleted|renamed|typechange):/)
    if (m) {
      const k = m[1]
      style = k === 'modified' || k === 'typechange' ? { color: '#ffb300' } : k === 'new file' ? { color: '#3fb950' } : k === 'deleted' ? { color: '#ff5252' } : { color: '#58a6ff' }
    } else if (untracked && /^(\t| {4})\S/.test(ln)) style = { color: '#3fb950' }
    if (style) style = { ...style, fontWeight: 600, background: 'rgba(255,255,255,0.05)', display: 'inline-block', width: '100%' }
    return <span key={i} style={style || undefined}>{ln}{'\n'}</span>
  })
}

export default function SonarReportPage() {
  const [searchParams]             = useSearchParams()
  const navigate                   = useNavigate()
  const [component, setComponent] = useState('')
  const [pr,        setPr]        = useState('')
  const [urlInput,  setUrlInput]  = useState('')
  const [loading,   setLoading]   = useState(false)
  const [result,    setResult]    = useState(null)
  const [error,     setError]     = useState(null)
  const [reports,         setReports]         = useState([])
  const [reportSummaries, setReportSummaries] = useState({})  // { [filename]: {qg_status,total,blocker,...} }
  const [deleting,        setDeleting]        = useState(null)
  const [viewing,         setViewing]         = useState(null)
  const [viewData,        setViewData]        = useState(null)
  const [reportSearch,    setReportSearch]    = useState('')
  const [activeTab,       setActiveTab]       = useState('')   // '' = All
  const [appTabs,         setAppTabs]         = useState([])   // display names from sonar_config
  const [configOpen,        setConfigOpen]        = useState(false)
  const [configApps,        setConfigApps]        = useState([])
  const [configActiveIdx,   setConfigActiveIdx]   = useState(0)
  const [configLoading,     setConfigLoading]     = useState(false)
  const [configSaving,      setConfigSaving]      = useState(false)
  const [configError,       setConfigError]       = useState(null)
  const [pendingDeleteRow,  setPendingDeleteRow]  = useState(null)   // row index awaiting confirm
  const [pendingDeleteApp,  setPendingDeleteApp]  = useState(null)   // app index awaiting confirm
  const [confirmOverwrite,  setConfirmOverwrite]  = useState(null)   // { prNum, name } when duplicate detected
  const urlRef  = useRef(null)
  const autoRan = useRef(false)
  const fetchedSummaries = useRef(new Set())

  const loadAppTabs = useCallback(() => {
    fetch(`${API}/config`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          const tabs = (d.apps || []).map(a => a.name.charAt(0).toUpperCase() + a.name.slice(1))
          setAppTabs(tabs)
          setActiveTab(prev => (prev && !tabs.includes(prev)) ? '' : prev)
        }
      })
      .catch(() => {})
  }, [])

  const loadReports = useCallback(() => {
    fetch(`${API}/list`)
      .then(r => r.json())
      .then(d => {
        if (!d.ok) return
        const files = d.files || []
        setReports(files)
        // fetch summary for any file not yet fetched
        files.forEach(f => {
          const key = f.path || f.name
          if (fetchedSummaries.current.has(key)) return
          fetchedSummaries.current.add(key)
          fetch(`${API}/summary/${key}`)
            .then(r => r.json())
            .then(s => {
              if (s.ok) setReportSummaries(prev => ({ ...prev, [key]: s }))
            })
            .catch(() => {})
        })
      })
      .catch(() => {})
  }, [])

  useEffect(() => { loadReports(); loadAppTabs() }, [loadReports, loadAppTabs])

  // Restore viewer state across navigation
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('sonar_viewer')
      if (saved) setViewData(JSON.parse(saved))
    } catch {}
  }, [])

  // Persist viewer state so it survives navigation away and back
  useEffect(() => {
    try {
      if (viewData) sessionStorage.setItem('sonar_viewer', JSON.stringify(viewData))
      else sessionStorage.removeItem('sonar_viewer')
    } catch {}
  }, [viewData])

  useEffect(() => {
    if (autoRan.current) return
    const raw = searchParams.get('sonarUrl')
    if (!raw) return
    const parsed = parseSonarUrl(raw)
    if (!parsed?.id || !parsed?.pr) return
    autoRan.current = true
    setComponent(parsed.id)
    setPr(parsed.pr)
    const prNum = parsed.pr.trim()
    // Check existing reports before auto-generating
    fetch(`${API}/list`)
      .then(r => r.json())
      .then(d => {
        const files = d.ok ? (d.files || []) : []
        const existing = files.find(f => {
          const base = (f.name || f.path || '').split('/').pop()
          return base.startsWith(`${prNum}_`) && base.endsWith('_Sonar_Report.xlsx')
        })
        if (existing) {
          const name = (existing.name || existing.path || '').split('/').pop()
          const path = existing.path || existing.name || ''
          setConfirmOverwrite({ prNum, name, path, componentOverride: parsed.id.trim() })
        } else {
          runGenerate(prNum, parsed.id.trim())
        }
      })
      .catch(() => runGenerate(prNum, parsed.id.trim()))
  }, [searchParams])

  function applyUrl() {
    const parsed = parseSonarUrl(urlInput)
    if (!parsed) { setError('Could not parse Sonar URL — paste the full dashboard URL'); return }
    setError(null)
    if (parsed.id) setComponent(parsed.id)
    if (parsed.pr) setPr(parsed.pr)
    setUrlInput('')
  }

  async function runGenerate(prNum, componentOverride) {
    const comp = (componentOverride ?? component).trim()
    setError(null); setResult(null); setLoading(true)
    try {
      const r = await fetch(`${API}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ component: comp, pull_request: prNum }),
      })
      const d = await r.json()
      if (d.ok) { setResult(d); loadReports() }
      else      setError(d.error || 'Report generation failed')
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  function generate() {
    if (!component.trim()) { setError('Component key is required'); return }
    if (!pr.trim())        { setError('Pull Request number is required'); return }
    const prNum = pr.trim()
    const existing = reports.find(f => {
      const base = (f.name || f.path || '').split('/').pop()
      return base.startsWith(`${prNum}_`) && base.endsWith('_Sonar_Report.xlsx')
    })
    if (existing) {
      const name = (existing.name || existing.path || '').split('/').pop()
      const path = existing.path || existing.name || ''
      setConfirmOverwrite({ prNum, name, path })
    } else {
      runGenerate(prNum)
    }
  }

  async function deleteReport(path, name) {
    setDeleting(path)
    try {
      await fetch(`${API}/files/${path}`, { method: 'DELETE' })
      setReports(prev => prev.filter(f => (f.path || f.name) !== path))
      setReportSummaries(prev => { const n = { ...prev }; delete n[path]; return n })
      fetchedSummaries.current.delete(path)
      if (result?.file === name) setResult(null)
      if (viewData?.path === path) setViewData(null)
    } catch { /* ignore */ }
    setDeleting(null)
  }

  async function viewReport(path, name) {
    if (viewData?.path === path) { setViewData(null); return }
    setViewing(path)
    try {
      const r = await fetch(`${API}/view/${path}`)
      const d = await r.json()
      if (d.ok) {
        setViewData({ path, file: name, ...d })
        try {
          const rj = await fetch(`${API}/ai-job-latest/${path}`)
          const dj = await rj.json()
          const j = dj.ok && dj.job
          if (j) {
            setAiLog({ jobId: j.job_id, label: j.label, text: j.output || '', state: j.status, kind: j.kind, follow: j.follow, prUrl: j.pr_url })
            if (j.status === 'running') { setAiJob({ jobId: j.job_id, issueNum: j.kind }); watchJob(j.job_id, j.label) }
          } else setAiLog(null)
        } catch { /* ignore */ }
      } else setError(d.error || 'Could not load report')
    } catch (e) { setError(String(e)) }
    setViewing(null)
  }

  const [aiStarting, setAiStarting] = useState(null)   // endpoint while the start request is in flight
  const [aiJob,     setAiJob]     = useState(null)   // {jobId, issueNum, issueMsg}
  const aiPollRef = useRef(null)
  const [aiLog, setAiLog] = useState(null)   // {jobId, label, text, state: running|done|error|aborted}
  const aiLogRef = useRef(null)
  const [aiPushing, setAiPushing] = useState(false)
  useEffect(() => { if (aiLogRef.current) aiLogRef.current.scrollTop = aiLogRef.current.scrollHeight }, [aiLog?.text])
  async function abortAi() {
    if (!aiLog) return
    try { await fetch(`${API}/ai-abort/${aiLog.jobId}`, { method: 'POST' }) } catch { /* ignore */ }
  }

  async function refreshView() {
    if (!viewData) return
    const r = await fetch(`${API}/view/${viewData.path}`)
    const d = await r.json()
    if (d.ok) setViewData(prev => ({ ...prev, ...d }))
  }

  async function resolveIssues(issueNums, all = false) {
    if (!viewData) return
    const body = all ? { all: true } : { issues: issueNums }
    try {
      const r = await fetch(`${API}/resolve/${viewData.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      if (d.ok) await refreshView()
    } catch { /* ignore */ }
  }

  function resolveWithAI(issue, appName) {
    return startAiJob('ai-resolve', { issue_num: issue['#'], issue, app_name: appName },
      { issueNum: issue['#'], label: `fixing issue #${issue['#']}`, issueMsg: issue['Message'] })
  }
  function resolveAllWithAI(appName) {
    const open = viewData.issues.filter(i => (i['Resolved'] || '').toUpperCase() !== 'YES')
    return startAiJob('ai-resolve-all', { issues: open, app_name: appName },
      { issueNum: 'all', label: `fixing ${open.length} issue${open.length !== 1 ? 's' : ''}`, issueMsg: 'Resolve All' })
  }
  function increaseCoverage(appName) {
    return startAiJob('ai-coverage', { app_name: appName, coverage: viewData.coverage, requirement: viewData.coverage_requirement },
      { issueNum: 'coverage', label: 'increasing code coverage for the pull request', issueMsg: `Coverage ${viewData.coverage}% → ${viewData.coverage_requirement}%` })
  }

  function watchJob(jid, label) {
    clearInterval(aiPollRef.current)
    const tick = async () => {
      try {
        const r2 = await fetch(`${API}/ai-job/${jid}`)
        const d2 = await r2.json()
        if (!d2.ok) return
        setAiLog(prev => prev && prev.jobId !== jid ? prev
          : { jobId: jid, label: d2.label || label, text: d2.output || '', state: d2.status, kind: d2.kind, follow: d2.follow, prUrl: d2.pr_url })
        if (d2.status && d2.status !== 'running') {
          clearInterval(aiPollRef.current)
          setAiJob(null)
          if (d2.status === 'done' && (d2.kind === 'fix' || d2.kind === 'coverage')) await refreshView()
        }
      } catch { /* keep polling */ }
    }
    aiPollRef.current = setInterval(tick, 1500)
    tick()
  }

  async function startAiJob(endpoint, payload, info) {
    if (!viewData) return
    setAiStarting(endpoint)
    try {
      const r = await fetch(`${API}/${endpoint}/${viewData.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await r.json()
      if (!d.ok) { setError(d.error || 'Failed to start AI agent'); return }
      setAiJob({ jobId: d.job_id, ...info })
      setAiLog({ jobId: d.job_id, label: info.label, text: '', state: 'running' })
      watchJob(d.job_id, info.label)
    } catch (e) { setError(String(e)) }
    finally { setAiStarting(null) }
  }

  async function buildModule(m) {
    if (!aiLog) return
    try {
      const r = await fetch(`${API}/ai-build/${aiLog.jobId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: m.path }),
      })
      const d = await r.json()
      if (!d.ok) { setError(d.error || 'Build failed to start'); return }
      setAiJob({ jobId: d.job_id, issueNum: 'build' })
      setAiLog({ jobId: d.job_id, label: `building & testing ${m.name}`, text: '', state: 'running', kind: 'build', follow: aiLog.follow })
      watchJob(d.job_id, `building & testing ${m.name}`)
    } catch (e) { setError(String(e)) }
  }

  const [aiStatusing, setAiStatusing] = useState(false)
  const addLog = t => setAiLog(prev => prev ? { ...prev, text: (prev.text || '') + t } : prev)
  async function gitStatus() {
    if (!aiLog?.follow) return
    setAiStatusing(true)
    addLog(`\n$ git status  (${aiLog.follow.root}) …\n`)
    try {
      const d = await (await fetch(`${API}/ai-git-status/${aiLog.jobId}`, { method: 'POST' })).json()
      addLog((d.output || d.error || '') + '\n')
    } catch (e) { setError(String(e)) }
    setAiStatusing(false)
  }

  const [pushDlg, setPushDlg] = useState(null)   // {ticket} while the push dialog is open
  const pushWhat = aiLog?.follow?.kind === 'coverage' ? 'Increased Unit Test Coverage' : 'Fixed Sonar Issues'
  function pushChanges() {
    if (!aiLog?.follow) return
    setPushDlg({ ticket: aiLog.follow.ticket || '' })
  }
  async function doPush(ticket) {
    const f = aiLog.follow
    setPushDlg(null)
    setAiPushing(true)
    addLog(`\n━━ Pushing to origin/${f.branch}: git add, commit, push … ━━\n`)
    try {
      const r = await fetch(`${API}/ai-push/${aiLog.jobId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket }),
      })
      const d = await r.json()
      const out = (d.ok ? '\n━━ Pushed to origin/' + f.branch + ' ━━\n' : '\n━━ Push failed: ' + (d.error || '') + ' ━━\n') + (d.output || '')
      setAiLog(prev => prev ? { ...prev, text: (prev.text || '') + out, prUrl: d.pr_url || prev.prUrl,
        follow: d.ok ? { ...prev.follow, pushed: true } : prev.follow } : prev)
    } catch (e) { setError(String(e)) }
    setAiPushing(false)
  }

  async function closeAiLog() {
    if (aiLog) { try { await fetch(`${API}/ai-job-dismiss/${aiLog.jobId}`, { method: 'POST' }) } catch { /* ignore */ } }
    setAiLog(null)
  }

  async function openConfig() {
    setConfigOpen(true); setConfigError(null); setConfigLoading(true)
    try {
      const r = await fetch(`${API}/config`)
      const d = await r.json()
      if (d.ok) { setConfigApps(d.apps || []); setConfigActiveIdx(0); setPendingDeleteRow(null); setPendingDeleteApp(null) }
      else setConfigError(d.error || 'Failed to load config')
    } catch (e) { setConfigError(String(e)) }
    setConfigLoading(false)
  }

  async function saveConfig() {
    setConfigSaving(true); setConfigError(null)
    try {
      const r = await fetch(`${API}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apps: configApps.filter(a => a.name.trim()).map(a => ({ name: a.name.trim(), rows: a.rows || [] })) }),
      })
      const d = await r.json()
      if (d.ok) { setConfigOpen(false); loadReports(); loadAppTabs() }
      else setConfigError(d.error || 'Failed to save config')
    } catch (e) { setConfigError(String(e)) }
    setConfigSaving(false)
  }

  const inputStyle = {
    width: '100%', fontSize: 13, padding: '8px 10px',
    border: '1px solid var(--border)', borderRadius: 6,
    background: 'var(--bg)', color: 'var(--text-primary)',
    outline: 'none', fontFamily: 'monospace',
    boxSizing: 'border-box',
  }
  const labelStyle = {
    display: 'block', fontSize: 11, fontWeight: 600,
    color: 'var(--text-muted)', textTransform: 'uppercase',
    letterSpacing: '0.05em', marginBottom: 5,
  }

  return (
    <div style={{ padding: '24px 28px' }}>

      {/* Header — full width above both columns */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
            Sonar Report Generator
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            Generate an Excel report from a SonarQube Pull Request analysis
          </div>
        </div>
        <button
          onClick={openConfig}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', fontSize: 13, fontWeight: 600,
            background: 'var(--surface2)', color: 'var(--text-primary)',
            border: '1px solid var(--border)', borderRadius: 7, cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          ⚙ Configure
        </button>
      </div>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>

      {/* ── Left: generator ── */}
      <div style={{ flex: '0 0 560px', minWidth: 0 }}>

        {/* Parse from URL */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: 'var(--text-primary)' }}>
            Parse from SonarQube URL <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}>(optional shortcut)</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={urlRef}
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applyUrl()}
              placeholder="https://sonar-ent2…/dashboard?id=…&pullRequest=…"
              style={{ ...inputStyle, flex: 1, fontFamily: 'inherit', fontSize: 12 }}
            />
            <button
              onClick={applyUrl}
              style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--primary,#1976d2)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Apply
            </button>
          </div>
        </div>

        {/* Inputs */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 16, color: 'var(--text-primary)' }}>
            Report Parameters
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 16, marginBottom: 20 }}>
            <div>
              <label style={labelStyle}>Component Key (id)</label>
              <input
                value={component}
                onChange={e => setComponent(e.target.value)}
                placeholder="com.healthedge.core:core-parent"
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--primary,#1976d2)'}
                onBlur={e  => e.target.style.borderColor = 'var(--border)'}
              />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Found in Sonar dashboard URL as <code style={{ fontSize: 11 }}>?id=</code>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Pull Request #</label>
              <input
                value={pr}
                onChange={e => setPr(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && generate()}
                placeholder="13123"
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--primary,#1976d2)'}
                onBlur={e  => e.target.style.borderColor = 'var(--border)'}
              />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Found in URL as <code style={{ fontSize: 11 }}>&pullRequest=</code>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={generate}
              disabled={loading}
              style={{
                padding: '9px 24px', fontSize: 13, fontWeight: 700,
                background: loading ? 'var(--surface)' : 'var(--primary,#1976d2)',
                color: loading ? 'var(--text-muted)' : '#fff',
                border: 'none', borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              {loading && <span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} />}
              {loading ? 'Generating…' : '⬇  Generate Report'}
            </button>
            {!loading && (component || pr) && (
              <button
                onClick={() => { setComponent(''); setPr(''); setResult(null); setError(null) }}
                style={{ fontSize: 12, padding: '6px 12px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{ padding: '12px 16px', background: '#FFEBEE', border: '1px solid #EF9A9A', borderRadius: 8, fontSize: 13, color: '#B71C1C', marginBottom: 16 }}>
            ⚠ {error}
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="card" style={{ border: `2px solid ${result.qg_status === 'OK' ? '#4CAF50' : '#EF5350'}` }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
              padding: '10px 14px', borderRadius: 6,
              background: result.qg_status === 'OK' ? '#E8F5E9' : '#FFEBEE',
            }}>
              <span style={{ fontSize: 22 }}>{result.qg_status === 'OK' ? '✅' : '❌'}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: result.qg_status === 'OK' ? '#1B5E20' : '#B71C1C' }}>
                  Quality Gate {result.qg_status === 'OK' ? 'Passed' : (result.qg_status === 'ERROR' ? 'Failed' : result.qg_status)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  PR #{pr} · {component}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center', marginRight: 4 }}>
                {result.total_issues} issue{result.total_issues !== 1 ? 's' : ''}
              </div>
              {['BLOCKER','CRITICAL','MAJOR','MINOR','INFO'].map(sev => {
                const cnt = result[sev.toLowerCase()]
                if (!cnt) return null
                const s = SEV_STYLE[sev]
                return (
                  <span key={sev} style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: s.bg, color: s.color }}>
                    {sev}: {cnt}
                  </span>
                )
              })}
            </div>

            <a
              href={`${API}/download/${encodeURIComponent(result.file)}`}
              download={result.file}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '9px 20px', fontSize: 13, fontWeight: 700,
                background: '#2E7D32', color: '#fff', borderRadius: 6,
                textDecoration: 'none',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#1B5E20'}
              onMouseLeave={e => e.currentTarget.style.background = '#2E7D32'}
            >
              ⬇  Download {result.file}
            </a>
          </div>
        )}
      </div>

      {/* ── Right: report history ── */}
      <div style={{ flex: '1 1 260px', minWidth: 220 }}>
        <div className="card" style={{ position: 'sticky', top: 16 }}>
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
              Generated Reports
            </span>
            <input
              value={reportSearch}
              onChange={e => setReportSearch(e.target.value)}
              placeholder="Search…"
              style={{
                flex: 1, fontSize: 11, padding: '4px 8px',
                border: '1px solid var(--border)', borderRadius: 5,
                background: 'var(--bg)', color: 'var(--text-primary)', outline: 'none',
              }}
            />
            <button
              onClick={loadReports}
              title="Refresh list"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, padding: 2, flexShrink: 0 }}
            >
              ↻
            </button>
          </div>
          {/* App tabs — driven by sonar_config, not by report files */}
          {appTabs.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
              {['All', ...appTabs].map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab === 'All' ? '' : tab)} style={{
                  fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12,
                  border: 'none', cursor: 'pointer',
                  background: (activeTab === '' && tab === 'All') || activeTab === tab ? 'var(--primary,#1976d2)' : 'var(--surface2)',
                  color:      (activeTab === '' && tab === 'All') || activeTab === tab ? '#fff' : 'var(--text-muted)',
                }}>{tab}</button>
              ))}
            </div>
          )}

          {reports.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
              No reports yet
            </div>
          ) : (() => {
            const visible = [...reports]
              .sort((a, b) => b.modified - a.modified)
              .filter(f => !activeTab || f.app === activeTab)
              .filter(f => !reportSearch || f.name.toLowerCase().includes(reportSearch.toLowerCase()))
            if (visible.length === 0) return (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
                {reportSearch ? `No reports match "${reportSearch}"` : 'No reports in this tab'}
              </div>
            )
            return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {visible.map(f => {
                const fpath = f.path || f.name
                const sm = reportSummaries[fpath]
                const isActive = result?.file === f.name
                return (
                  <div key={f.name} style={{
                    padding: '8px 10px', borderRadius: 6,
                    background: isActive ? 'rgba(25,118,210,0.07)' : 'var(--surface2)',
                    border: isActive ? '1px solid rgba(25,118,210,0.3)' : '1px solid transparent',
                  }}>
                    {/* single row: filename · summary · buttons */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                        {f.name}
                      </span>
                      {sm ? (
                        <>
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                            background: sm.qg_status === 'OK' ? '#E8F5E9' : sm.qg_status === 'ERROR' ? '#FFEBEE' : 'var(--surface2)',
                            color: sm.qg_status === 'OK' ? '#2E7D32' : sm.qg_status === 'ERROR' ? '#B71C1C' : 'var(--text-muted)',
                            border: `1px solid ${sm.qg_status === 'OK' ? '#A5D6A7' : sm.qg_status === 'ERROR' ? '#EF9A9A' : 'var(--border)'}`,
                          }}>
                            {sm.qg_status === 'OK' ? '✅ Passed' : sm.qg_status === 'ERROR' ? '❌ Failed' : '—'}
                          </span>
                          {sm.total > 0 && (
                            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{sm.total} issues</span>
                          )}
                          {['blocker','critical','major','minor','info'].map(sev => {
                            const cnt = sm[sev]
                            if (!cnt) return null
                            const S = SEV_STYLE[sev.toUpperCase()]
                            return <span key={sev} style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: S.bg, color: S.color }}>{sev.slice(0,3).toUpperCase()}: {cnt}</span>
                          })}
                        </>
                      ) : (
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>loading…</span>
                      )}
                      <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexShrink: 0 }}>
                        <button
                          onClick={() => viewReport(fpath, f.name)}
                          disabled={viewing === fpath}
                          style={{
                            fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 4,
                            background: viewData?.path === fpath ? 'rgba(25,118,210,0.15)' : 'rgba(25,118,210,0.08)',
                            color: '#1565C0',
                            border: `1px solid ${viewData?.path === fpath ? 'rgba(25,118,210,0.5)' : 'rgba(25,118,210,0.25)'}`,
                            cursor: 'pointer', whiteSpace: 'nowrap',
                          }}
                        >
                          {viewing === fpath ? '…' : viewData?.path === fpath ? '▲ Close' : '👁 View'}
                        </button>
                        <a
                          href={`${API}/download/${fpath}`}
                          download={f.name}
                          style={{
                            fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 4,
                            background: '#2E7D32', color: '#fff', textDecoration: 'none',
                            display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                          }}
                        >
                          ⬇ Download
                        </a>
                        <button
                          onClick={() => deleteReport(fpath, f.name)}
                          disabled={deleting === fpath}
                          style={{
                            fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 4,
                            background: 'rgba(183,28,28,0.1)', color: '#B71C1C',
                            border: '1px solid rgba(183,28,28,0.25)', cursor: 'pointer', whiteSpace: 'nowrap',
                          }}
                        >
                          {deleting === fpath ? '…' : '✕ Delete'}
                        </button>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                      {fmtSize(f.size)} · {fmtDate(f.modified)}
                    </div>
                  </div>
                )
              })}
            </div>
            )
          })()}
        </div>
      </div>
      </div>{/* end flex */}

      {/* ── Inline Report Viewer ── */}
      {viewData && (() => {
        const _appName = viewData.path ? viewData.path.split('/')[0] : ''
        return (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{
              padding: '6px 14px', borderRadius: 6, fontWeight: 700, fontSize: 14,
              background: viewData.qg_status === 'OK' ? '#E8F5E9' : viewData.qg_status === 'ERROR' ? '#FFEBEE' : 'var(--surface2)',
              color: viewData.qg_status === 'OK' ? '#1B5E20' : viewData.qg_status === 'ERROR' ? '#B71C1C' : 'var(--text-primary)',
              border: `1px solid ${viewData.qg_status === 'OK' ? '#A5D6A7' : viewData.qg_status === 'ERROR' ? '#EF9A9A' : 'var(--border)'}`,
            }}>
              {viewData.qg_status === 'OK' ? '✅ Quality Gate Passed' : viewData.qg_status === 'ERROR' ? '❌ Quality Gate Failed' : 'Quality Gate Unknown'}
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{viewData.file}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {viewData.issues.some(i => (i['Resolved'] || '').toUpperCase() !== 'YES') && (
                  <button
                    onClick={() => resolveAllWithAI(_appName)}
                    disabled={!!aiJob || !!aiStarting}
                    title="Fix all unresolved issues with Claude AI agent"
                    style={{ background: (aiJob || aiStarting) ? 'var(--surface2)' : '#2E7D32', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: (aiJob || aiStarting) ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    {(aiStarting === 'ai-resolve-all' || aiJob?.issueNum === 'all')
                      ? <><span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> Resolving…</>
                      : '✔ Resolve All'}
                  </button>
                )}
                <button
                  onClick={() => setViewData(null)}
                  style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--text-muted)' }}
                >
                  ✕ Close
                </button>
              </div>
              {_appName && (
                <button
                  onClick={() => navigate('/local-app/' + _appName, { state: { from: 'sonar-report', reportPath: viewData.path } })}
                  style={{ background: '#1565C0', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 20px', fontSize: 12, fontWeight: 600, cursor: 'pointer', width: '100%' }}
                >
                  Navigate {_appName.charAt(0).toUpperCase() + _appName.slice(1)}
                </button>
              )}
            </div>
          </div>

          {/* Code coverage badge */}
          {viewData.coverage != null && (() => {
            const cov = viewData.coverage, req = viewData.coverage_requirement ?? 90
            const ok  = cov >= req
            const t   = ok ? Math.min(1, (cov - req) / Math.max(100 - req, 1)) : Math.min(1, (req - cov) / Math.max(req, 1))
            const bg  = ok ? `hsl(135, 45%, ${88 - t * 48}%)` : `hsl(4, 75%, ${93 - t * 43}%)`
            const fg  = t > 0.45 ? '#fff' : (ok ? '#1B5E20' : '#B71C1C')
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                <span title={`Required: ${req}% (${viewData.coverage_source} coverage)`}
                  style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 12, background: bg, color: fg, border: `1px solid ${ok ? '#A5D6A7' : '#EF9A9A'}` }}>
                  Code Coverage: {cov}%
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>required {req}%</span>
                {viewData.coverage_ai && (
                  <>
                    <span title={viewData.coverage_ai} style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 12, background: '#E8F5E9', color: '#1B5E20', border: '1px dashed #66BB6A' }}>
                      ↑ {String(viewData.coverage_ai).split(' ')[0]} (AI)
                    </span>
                    <a href="/tools/gp-run" style={{ fontSize: 11, fontWeight: 600, color: '#1565C0' }}>Execute GP to confirm →</a>
                  </>
                )}
                {!ok && (
                  <button onClick={() => increaseCoverage(_appName)} disabled={!!aiJob}
                    title="Add unit tests with Claude AI agent"
                    style={{ fontSize: 11, fontWeight: 600, padding: '3px 12px', borderRadius: 12, background: aiJob ? 'var(--surface2)' : 'rgba(25,118,210,0.08)', color: aiJob ? 'var(--text-muted)' : '#1565C0', border: `1px solid ${aiJob ? 'var(--border)' : 'rgba(25,118,210,0.3)'}`, cursor: aiJob ? 'not-allowed' : 'pointer' }}>
                    ⚡ Increase Code Coverage
                  </button>
                )}
              </div>
            )
          })()}

          {/* Severity summary badges */}
          {viewData.issues.length > 0 && (() => {
            const counts = {}
            viewData.issues.forEach(i => { const s = i['Severity'] || ''; counts[s] = (counts[s] || 0) + 1 })
            return (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
                  {viewData.issues.length} issue{viewData.issues.length !== 1 ? 's' : ''}
                </span>
                {['BLOCKER','CRITICAL','MAJOR','MINOR','INFO'].map(sev => {
                  const cnt = counts[sev]
                  if (!cnt) return null
                  const s = SEV_STYLE[sev]
                  return <span key={sev} style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: s.bg, color: s.color }}>{sev}: {cnt}</span>
                })}
              </div>
            )
          })()}

          {/* AI agent live terminal */}
          {aiLog && (() => {
            const st = aiLog.state
            const color = st === 'done' ? '#2E7D32' : st === 'running' ? '#1565C0' : '#B71C1C'
            const isBuild = aiLog.kind === 'build'
            const title = st === 'running' ? (isBuild ? `Maven is ${aiLog.label}…` : `Claude is ${aiLog.label}…`)
              : st === 'done' ? `✅ ${isBuild ? 'Build passed' : 'Completed'}: ${aiLog.label}`
              : st === 'aborted' ? '⛔ Aborted'
              : isBuild ? `❌ Build failed: ${aiLog.label}` : '❌ AI Agent Error'
            return (
              <div style={{ marginBottom: 16, border: `1px solid ${color}`, borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface2)' }}>
                  {st === 'running' && <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2, borderColor: color, borderTopColor: 'transparent' }} />}
                  <span style={{ fontWeight: 600, fontSize: 13, color }}>{title}</span>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    {st === 'running'
                      ? <button onClick={abortAi} style={{ fontSize: 11, fontWeight: 600, padding: '3px 12px', borderRadius: 6, background: '#B71C1C', color: '#fff', border: 'none', cursor: 'pointer' }}>■ Abort</button>
                      : <button onClick={closeAiLog} style={{ fontSize: 11, padding: '3px 12px', borderRadius: 6, background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-muted)' }}>Close</button>}
                  </span>
                </div>
                <pre ref={aiLogRef} style={{ margin: 0, padding: 12, background: '#0d1117', color: '#c9d1d9', fontSize: 11.5, lineHeight: 1.45, height: 280, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{aiLog.text ? colorizeLog(aiLog.text) : 'Starting agent…'}</pre>
                {aiLog.follow && st !== 'running' && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '8px 12px', background: 'var(--surface2)', borderTop: '1px solid var(--border)' }}>
                    {aiLog.follow.modules.length === 0
                      ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No modified modules detected{aiLog.follow.files ? '' : ' (no changed files)'}.</span>
                      : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Impacted modules:</span>}
                    {aiLog.follow.modules.map(m => (
                      <button key={m.path} onClick={() => buildModule(m)} disabled={!!aiJob} title={m.path}
                        style={{ fontSize: 11, fontWeight: 600, padding: '3px 12px', borderRadius: 6, background: 'rgba(25,118,210,0.08)', color: '#1565C0', border: '1px solid rgba(25,118,210,0.3)', cursor: aiJob ? 'not-allowed' : 'pointer' }}>
                        🔨 Build &amp; Test {m.name}
                      </button>
                    ))}
                    {aiLog.prUrl && <a href={aiLog.prUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, fontWeight: 600, color: '#1565C0' }}>↗ Open Pull Request</a>}
                    {aiLog.follow.pushed && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: '#2E7D32' }}>✓ Pushed to origin/{aiLog.follow.branch}</span>}
                    <button onClick={gitStatus} disabled={!!aiJob || aiStatusing || aiPushing} title={`git status in ${aiLog.follow.root}`}
                      style={{ marginLeft: aiLog.follow.pushed ? 0 : 'auto', fontSize: 11, fontWeight: 600, padding: '3px 12px', borderRadius: 6, background: 'rgba(25,118,210,0.08)', color: '#1565C0', border: '1px solid rgba(25,118,210,0.3)', cursor: aiJob || aiStatusing ? 'not-allowed' : 'pointer' }}>
                      {aiStatusing ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Running…</> : 'git status'}
                    </button>
                    {!aiLog.follow.pushed
                      && <button onClick={pushChanges} disabled={!!aiJob || aiPushing} title={`git add, commit and push to origin/${aiLog.follow.branch}`}
                      style={{ fontSize: 11, fontWeight: 600, padding: '3px 14px', borderRadius: 6, background: '#2E7D32', color: '#fff', border: 'none', cursor: aiJob || aiPushing ? 'not-allowed' : 'pointer' }}>
                      {aiPushing ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Pushing…</> : `⬆ Push to origin/${aiLog.follow.branch}`}
                    </button>}
                    {aiLog.follow.pushed && viewData?.path && (
                      <button onClick={() => navigate('/local-app/' + viewData.path.split('/')[0], { state: { openTab: 'gp_run', newRun: true } })}
                        title="Open the GP Run tab with a new run"
                        style={{ fontSize: 11, fontWeight: 600, padding: '3px 14px', borderRadius: 6, background: '#1565C0', color: '#fff', border: 'none', cursor: 'pointer' }}>
                        🚀 GP Run
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })()}

          {pushDlg && aiLog?.follow && (
            <div className="modal-overlay" onMouseDown={() => setPushDlg(null)}>
              <div className="modal" style={{ maxWidth: 460 }} onMouseDown={e => e.stopPropagation()}>
                <div className="modal-header">
                  <span className="modal-title">⬆ Push to origin/{aiLog.follow.branch}</span>
                  <button className="modal-close" onClick={() => setPushDlg(null)}>✕</button>
                </div>
                <div className="modal-body">
                  <p style={{ color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.6 }}>
                    Runs <code>git add -A</code>, <code>git commit</code> and <code>git push</code> in <code style={{ color: 'var(--text)' }}>{aiLog.follow.root}</code>.
                  </p>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Ticket ID{!aiLog.follow.ticket && ' (not found in the branch name)'}</div>
                  <input autoFocus value={pushDlg.ticket} onChange={e => setPushDlg({ ticket: e.target.value })}
                    onKeyDown={e => e.key === 'Enter' && pushDlg.ticket.trim() && doPush(pushDlg.ticket.trim())}
                    placeholder="e.g. PAYOR-123456" style={{ width: '100%', boxSizing: 'border-box', marginBottom: 10 }} />
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Commit message</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 12, padding: '6px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 20 }}>
                    {pushDlg.ticket.trim() || '<ticket>'}: {pushWhat}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button className="btn" onClick={() => setPushDlg(null)}>Cancel</button>
                    <button className="btn btn-primary" disabled={!pushDlg.ticket.trim()} onClick={() => doPush(pushDlg.ticket.trim())}>Commit &amp; Push</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Issues table */}
          {viewData.issues.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ padding: '10px 14px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                Issues ({viewData.issues.length})
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface2)' }}>
                      {['#','Type','Severity','File / Component','Line','Message','Rule','Status','Author','Effort','Resolved'].map(h => (
                        <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)', fontSize: 11 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {viewData.issues.map((issue, idx) => {
                      const sev = issue['Severity'] || ''
                      const s = SEV_STYLE[sev] || { bg: 'transparent', color: 'inherit' }
                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '5px 10px', color: 'var(--text-muted)' }}>{issue['#']}</td>
                          <td style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}>{issue['Type']}</td>
                          <td style={{ padding: '5px 10px' }}>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: s.bg, color: s.color }}>{sev}</span>
                          </td>
                          <td style={{ padding: '5px 10px', fontFamily: 'monospace', fontSize: 11, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={issue['File / Component']}>{issue['File / Component']}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'center', color: 'var(--text-muted)' }}>{issue['Line']}</td>
                          <td style={{ padding: '5px 10px', maxWidth: 360, wordBreak: 'break-word' }}>{issue['Message']}</td>
                          <td style={{ padding: '5px 10px', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{issue['Rule']}</td>
                          <td style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}>{issue['Status']}</td>
                          <td style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}>{issue['Author']}</td>
                          <td style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}>{issue['Effort']}</td>
                          <td style={{ padding: '5px 10px', whiteSpace: 'nowrap' }}>
                            {(issue['Resolved'] || '').toUpperCase() === 'YES' ? (
                              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 10, background: '#E8F5E9', color: '#2E7D32', border: '1px solid #A5D6A7' }}>Resolved</span>
                            ) : (
                              <button
                                onClick={() => resolveWithAI(issue, _appName)}
                                disabled={!!aiJob}
                                title="Fix with Claude AI agent"
                                style={{ fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 10, background: aiJob ? 'var(--surface2)' : 'rgba(25,118,210,0.08)', color: aiJob ? 'var(--text-muted)' : '#1565C0', border: `1px solid ${aiJob ? 'var(--border)' : 'rgba(25,118,210,0.3)'}`, cursor: aiJob ? 'not-allowed' : 'pointer' }}
                              >{aiJob?.issueNum === issue['#'] ? '…' : '⚡ Resolve'}</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {viewData.issues.length === 0 && (
            <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: 13 }}>No issues found in this report.</div>
          )}
        </div>
        )
      })()}

      {/* ── Overwrite Confirm Dialog ── */}
      {confirmOverwrite && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: 420, maxWidth: '92vw', padding: '24px 24px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
              <span style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>⚠️</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Report already exists</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  A report for <strong>PR #{confirmOverwrite.prNum}</strong> already exists:
                </div>
                <code style={{ display: 'block', marginTop: 6, fontSize: 11, padding: '5px 8px', borderRadius: 5, background: 'var(--surface2, rgba(128,128,128,0.08))', border: '1px solid var(--border)', wordBreak: 'break-all' }}>
                  {confirmOverwrite.name}
                </code>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 10 }}>
                  Do you want to overwrite it with a freshly generated report?
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              {confirmOverwrite.path && (
                <button className="btn btn-primary" onClick={() => { const { path: p, name: n } = confirmOverwrite; setConfirmOverwrite(null); viewReport(p, n) }}>
                  View Existing
                </button>
              )}
              <button className="btn" onClick={() => { const { prNum: p, componentOverride: c } = confirmOverwrite; setConfirmOverwrite(null); runGenerate(p, c) }}>
                Overwrite
              </button>
              <button className="btn" onClick={() => setConfirmOverwrite(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Configure Modal ── */}
      {configOpen && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={e => { if (e.target === e.currentTarget) setConfigOpen(false) }}>
          <div className="card" style={{ width: 560, maxWidth: '92vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>

            {/* modal header */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', flex: 1 }}>⚙ Sonar Configuration</span>
              <button onClick={() => setConfigOpen(false)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>✕</button>
            </div>

            {configLoading ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
            ) : (
              <>
                {/* tab bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '0 18px', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
                  {configApps.map((app, idx) => {
                    const isActive = idx === configActiveIdx
                    return (
                      <div key={idx} style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '9px 14px 8px', cursor: 'pointer', whiteSpace: 'nowrap',
                        borderBottom: isActive ? '2px solid var(--primary,#1976d2)' : '2px solid transparent',
                        color: isActive ? 'var(--primary,#1976d2)' : 'var(--text-muted)',
                        fontWeight: isActive ? 700 : 400, fontSize: 13,
                        marginBottom: -1,
                      }} onClick={() => { setConfigActiveIdx(idx); setPendingDeleteRow(null); setPendingDeleteApp(null) }}>
                        {app.name || <em style={{ opacity: 0.5 }}>New App</em>}
                      </div>
                    )
                  })}
                  {/* Add App button */}
                  <button
                    onClick={() => {
                      setConfigApps(prev => [...prev, { name: '', rows: [] }])
                      setConfigActiveIdx(configApps.length)
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '7px 12px', marginLeft: 4,
                      background: 'none', border: '1px dashed var(--border)', borderRadius: 6,
                      cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600,
                      whiteSpace: 'nowrap', flexShrink: 0,
                    }}
                  >+ Add Application</button>
                </div>

                {/* tab content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px' }}>
                  {configApps.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, paddingTop: 24 }}>
                      No applications configured. Click <strong>+ Add Application</strong> to get started.
                    </div>
                  ) : configApps[configActiveIdx] ? (() => {
                    const cur = configApps[configActiveIdx]
                    const updateApp = patch => setConfigApps(prev => prev.map((a, i) => i === configActiveIdx ? { ...a, ...patch } : a))
                    const updateRow = (ri, col, val) => updateApp({ rows: cur.rows.map((r, i) => i === ri ? (col === 0 ? [val, r[1]] : [r[0], val]) : r) })
                    const deleteRow = ri => { updateApp({ rows: cur.rows.filter((_, i) => i !== ri) }); setPendingDeleteRow(null) }
                    const addRow    = () => { updateApp({ rows: [...(cur.rows || []), ['', '']] }); setPendingDeleteRow(null) }
                    const labelStyle = { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }
                    const inputBase  = { fontSize: 13, padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 5, background: 'var(--bg)', color: 'var(--text-primary)', outline: 'none', width: '100%', boxSizing: 'border-box' }
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                        {/* App deletion confirmation */}
                        {pendingDeleteApp === configActiveIdx && (
                          <div style={{ padding: '12px 14px', background: '#FFF3E0', border: '1px solid #FFB74D', borderRadius: 8 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, color: '#E65100', marginBottom: 6 }}>
                              Delete "{cur.name || 'this application'}"?
                            </div>
                            <div style={{ fontSize: 12, color: '#BF360C', marginBottom: 10 }}>
                              This will remove the application from the configuration. All reports stored under the <code style={{ fontSize: 11 }}>{cur.name || '…'}/</code> folder will also be deleted from disk when you save.
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button
                                onClick={() => {
                                  const idx = configActiveIdx
                                  setConfigApps(prev => prev.filter((_, i) => i !== idx))
                                  setConfigActiveIdx(prev => Math.max(0, prev >= idx ? prev - 1 : prev))
                                  setPendingDeleteApp(null)
                                }}
                                style={{ padding: '5px 14px', fontSize: 12, fontWeight: 700, background: '#E65100', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' }}
                              >Yes, Delete</button>
                              <button
                                onClick={() => setPendingDeleteApp(null)}
                                style={{ padding: '5px 14px', fontSize: 12, background: 'none', border: '1px solid #FFB74D', borderRadius: 5, cursor: 'pointer', color: '#E65100' }}
                              >Cancel</button>
                            </div>
                          </div>
                        )}

                        {/* App name */}
                        <div>
                          <label style={labelStyle}>App Name <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--text-muted)' }}>(Excel sheet tab name · required)</span></label>
                          <input
                            value={cur.name}
                            onChange={e => updateApp({ name: e.target.value })}
                            placeholder="e.g. payor"
                            style={inputBase}
                          />
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>Used as the folder name and report tab label.</div>
                        </div>

                        {/* Row data */}
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                            <label style={{ ...labelStyle, marginBottom: 0 }}>Configuration Rows</label>
                            <button
                              onClick={addRow}
                              style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', background: 'none', border: '1px dashed var(--border)', borderRadius: 5, cursor: 'pointer', color: 'var(--text-muted)' }}
                            >+ Add Row</button>
                          </div>

                          {(!cur.rows || cur.rows.length === 0) ? (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '10px 0' }}>No rows yet. Click <strong>+ Add Row</strong> to add configuration entries.</div>
                          ) : (
                            <>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 32px', gap: 6, marginBottom: 4 }}>
                                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Key</div>
                                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Value</div>
                                <div />
                              </div>
                              {cur.rows.map((row, ri) => (
                                <div key={ri} style={{ marginBottom: 6 }}>
                                  {pendingDeleteRow === ri ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#FFEBEE', border: '1px solid #EF9A9A', borderRadius: 6 }}>
                                      <span style={{ fontSize: 12, color: '#B71C1C', flex: 1 }}>Delete row <strong>{row[0] || '(empty)'}</strong>?</span>
                                      <button onClick={() => deleteRow(ri)} style={{ padding: '3px 10px', fontSize: 11, fontWeight: 700, background: '#B71C1C', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Delete</button>
                                      <button onClick={() => setPendingDeleteRow(null)} style={{ padding: '3px 10px', fontSize: 11, background: 'none', border: '1px solid #EF9A9A', borderRadius: 4, cursor: 'pointer', color: '#B71C1C' }}>Cancel</button>
                                    </div>
                                  ) : (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 32px', gap: 6 }}>
                                      <input
                                        value={row[0]}
                                        onChange={e => updateRow(ri, 0, e.target.value)}
                                        placeholder="key"
                                        style={inputBase}
                                      />
                                      <input
                                        value={row[1]}
                                        onChange={e => updateRow(ri, 1, e.target.value)}
                                        placeholder="value"
                                        style={{ ...inputBase, fontFamily: 'monospace', fontSize: 12 }}
                                      />
                                      <button
                                        onClick={() => setPendingDeleteRow(ri)}
                                        style={{ background: 'rgba(183,28,28,0.07)', border: '1px solid rgba(183,28,28,0.2)', borderRadius: 5, cursor: 'pointer', color: '#B71C1C', fontSize: 13, fontWeight: 700 }}
                                      >✕</button>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })() : null}
                </div>

                {/* error */}
                {configError && (
                  <div style={{ margin: '0 18px 12px', padding: '8px 12px', background: '#FFEBEE', border: '1px solid #EF9A9A', borderRadius: 6, fontSize: 12, color: '#B71C1C' }}>
                    ⚠ {configError}
                  </div>
                )}

                {/* footer */}
                <div style={{ display: 'flex', alignItems: 'center', padding: '12px 18px', borderTop: '1px solid var(--border)', gap: 8 }}>
                  {/* left — destructive action */}
                  {configApps.length > 0 && configApps[configActiveIdx] && (
                    <button
                      onClick={() => { setPendingDeleteApp(configActiveIdx); setPendingDeleteRow(null) }}
                      style={{ padding: '7px 16px', fontSize: 13, fontWeight: 600, background: 'rgba(183,28,28,0.07)', color: '#B71C1C', border: '1px solid rgba(183,28,28,0.25)', borderRadius: 6, cursor: 'pointer' }}
                    >
                      Delete Application
                    </button>
                  )}
                  {/* right — cancel / save */}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    <button onClick={() => setConfigOpen(false)} style={{ padding: '7px 16px', fontSize: 13, background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-muted)' }}>
                      Cancel
                    </button>
                    <button
                      onClick={saveConfig}
                      disabled={configSaving}
                      style={{ padding: '7px 20px', fontSize: 13, fontWeight: 700, background: configSaving ? 'var(--surface)' : 'var(--primary,#1976d2)', color: configSaving ? 'var(--text-muted)' : '#fff', border: 'none', borderRadius: 6, cursor: configSaving ? 'not-allowed' : 'pointer' }}
                    >
                      {configSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
