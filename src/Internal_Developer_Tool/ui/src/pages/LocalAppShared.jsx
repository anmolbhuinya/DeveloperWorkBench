import { useState, useEffect, useRef, useCallback } from 'react'
import { usePanels } from './ScreenConfig'
import { ConnConfigPanel, ConnBar, setDbConn, installDbFetch } from './ConnConfig'
import ConfirmDialog from '../components/ConfirmDialog'
import SqlQueryPanel from '../components/SqlQueryPanel'
import { useNavigate } from 'react-router-dom'
import { TomcatRightPanel } from './RemoteAppShared'

function CopyButton({ text, label, style: extraStyle }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [text])
  if (!text) return null
  return (
    <button onClick={copy} className="btn btn-sm"
      style={{ fontSize: 11, padding: '1px 7px', marginLeft: 4, ...extraStyle }}>
      {copied ? '✓ Copied!' : (label || 'Copy')}
    </button>
  )
}

function _logLineColor(line) {
  if (!line || !line.trim()) return null
  if (/BUILD SUCCESS/i.test(line)) return '#00e676'
  if (/BUILD FAILURE|BUILD FAILED/i.test(line)) return '#ff1744'
  if (/^\[ERROR\]/.test(line)) return '#ef5350'
  if (/^\[WARNING\]/.test(line)) return '#ffcc02'
  if (/^\[INFO\]\s*---/.test(line)) return '#546e7a'
  if (/^\[INFO\]/.test(line)) return '#90caf9'
  if (/\s(ERROR|FATAL|SEVERE)\s/.test(line) || /^(ERROR|FATAL|SEVERE)\s/.test(line)) return '#ff5252'
  if (/\s(WARN|WARNING)\s/.test(line) || /^(WARN|WARNING)\s/.test(line)) return '#ffb74d'
  if (/^\s+at /.test(line) || /\bCaused by:/.test(line)) return '#ef9a9a'
  if (/Exception\b/.test(line) && !/no.*exception/i.test(line)) return '#ff7043'
  if (/started successfully|start.*success|deploy.*complete/i.test(line)) return '#00e676'
  if (/\btomcat started\b|\bserver started\b/i.test(line) || /\bstarted\.\s*$/.test(line)) return '#66bb6a'
  if (/\b(stopping|stopped|shutdown|halted)\b/i.test(line)) return '#ef9a9a'
  if (/^(using |catalina_home:|catalina_base:|catalina_tmpdir:|jre_home:|classpath:|catalina_opts:|payer_home:|java_home:)/i.test(line)) return '#80cbc4'
  if (/^[A-Z][A-Z0-9_]+=/.test(line)) return '#ce93d8'
  if (/^\$\s/.test(line)) return '#e0e0e0'
  if (/\b(starting|initializing|loading|deploying|scanning)\b/i.test(line)) return '#64b5f6'
  if (/^[-=]{4,}/.test(line.trim())) return '#546e7a'
  return null
}

export function ColoredTerminal({ output, termRef, height, maxHeight, fontSize = 11, style: outerStyle }) {
  const lines = typeof output === 'string' ? output.split('\n') : []
  const empty = !output || output === ' '
  return (
    <div ref={termRef} style={{
      background: '#141414', fontFamily: 'monospace', fontSize, lineHeight: 1.6,
      padding: '8px 12px', borderRadius: 6, overflowY: 'auto',
      border: '1px solid #333', wordBreak: 'break-all',
      height, maxHeight,
      ...outerStyle,
    }}>
      {empty
        ? <span style={{ color: '#555' }}>Starting…</span>
        : lines.map((line, i) => (
            <div key={i} style={{ color: _logLineColor(line) || '#c9d1d9', whiteSpace: 'pre-wrap', minHeight: '1em' }}>{line}</div>
          ))
      }
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <div className="meta-label">{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500, marginTop: 3 }}>{children}</div>
    </div>
  )
}

export function CurrentBranchPanel({ appName, icon, branch, branchLoad, branchErr, onRefresh }) {
  const [pulling,    setPulling]    = useState(false)
  const [pullOk,     setPullOk]     = useState(null)
  const [pullErr,    setPullErr]    = useState(null)
  const [copiedDir,  setCopiedDir]  = useState(false)

  function copyDir() {
    const val = branch?.srcdir
    if (!val) return
    navigator.clipboard.writeText(val).then(() => {
      setCopiedDir(true)
      setTimeout(() => setCopiedDir(false), 2000)
    }).catch(() => {})
  }

  function handlePull() {
    setPulling(true); setPullOk(null); setPullErr(null)
    fetch(`/api/local-app/${appName}/git-pull`, { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setPullOk(d.output || 'Already up to date.')
          onRefresh?.()
          setTimeout(() => setPullOk(null), 3000)
        } else {
          setPullErr(d.error || 'git pull failed')
        }
      })
      .catch(() => setPullErr('Could not reach server'))
      .finally(() => setPulling(false))
  }

  return (
    <div className="card" style={{ flex: '1 1 320px', marginBottom: 0 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>{appName ? appName.charAt(0).toUpperCase() + appName.slice(1) : 'App'} Environment</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>{icon}</div>
        {branchLoad ? (
          <span className="spinner" style={{ marginLeft: 4 }} />
        ) : branchErr ? (
          <span style={{ color: 'var(--danger)', fontSize: 13 }}>{branchErr}</span>
        ) : branch ? (
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
            <div style={{ minWidth: 0, maxWidth: 200 }}>
              <div className="meta-label">Release Branch</div>
              <span
                className="badge badge-success"
                title={branch.branch}
                style={{ fontSize: 13, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}
              >{branch.branch}</span>
            </div>
            <Field label={`${appName ? appName.charAt(0).toUpperCase() + appName.slice(1) : 'Release'} Version`}><code>{branch.release_ver || '—'}</code></Field>
            {branch.env_type && <Field label="App Server">{branch.env_type}</Field>}
            <Field label="Repository">
              <code
                onClick={branch.srcdir ? copyDir : undefined}
                title={copiedDir ? '✓ copied' : (branch.srcdir ? 'Click to copy' : undefined)}
                style={{ fontSize: 11, wordBreak: 'break-all', cursor: branch.srcdir ? 'pointer' : 'default', color: copiedDir ? '#2e7d32' : 'var(--text-muted)', userSelect: 'all' }}
              >{copiedDir ? '✓ copied!' : (branch.srcdir || '—')}</code>
            </Field>
          </div>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, alignSelf: 'flex-start', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm" onClick={onRefresh} disabled={branchLoad} title="Refresh">↻</button>
            <button className="btn btn-sm" onClick={handlePull} disabled={pulling || branchLoad} style={{ whiteSpace: 'nowrap' }}>
              {pulling ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Pulling…</> : '↓ Pull'}
            </button>
          </div>
          {pullOk && (
            <div style={{ fontSize: 11, color: '#2e7d32', maxWidth: 260, wordBreak: 'break-word',
              background: 'rgba(76,175,80,0.08)', border: '1px solid rgba(76,175,80,0.3)',
              borderRadius: 4, padding: '3px 8px' }}>
              {pullOk}
            </div>
          )}
          {pullErr && (
            <div style={{ fontSize: 11, color: '#c62828', maxWidth: 260, wordBreak: 'break-word',
              background: 'rgba(244,67,54,0.08)', border: '1px solid rgba(244,67,54,0.25)',
              borderRadius: 4, padding: '3px 8px' }}>
              {pullErr}
            </div>
          )}
        </div>
      </div>
      <EnvTools appName={appName} />
    </div>
  )
}

// runtimes (JDK, Node, Python), build tools (Gradle, Maven, npm) and the application server - configured in the application's Environment settings
function EnvTools({ appName }) {
  const [tools, setTools] = useState(null)
  const [up, setUp] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = (force) => {
    setBusy(true)
    fetch(`/api/local-app/${appName}/environment-runtime${force ? '?force=1' : ''}`).then(r => r.json()).then(r => setTools(r.ok ? r.tools : [])).catch(() => setTools([])).finally(() => setBusy(false))
    fetch(`/api/local-app/${appName}/server-status`).then(r => r.json()).then(d => { if (d.ok) setUp(!!(d.running ?? d[appName])) }).catch(() => {})
  }
  useEffect(() => { load(false) }, [appName])
  const groups = [['runtime', 'Runtime'], ['build', 'Build tools'], ['server', 'Server']]
  const chip = t => (
    <span key={t.key} title={t.ok ? t.path : (t.error || 'not available')} style={{ fontSize: 12, padding: '2px 10px', borderRadius: 12, border: '1px solid ' + (t.ok ? 'rgba(76,175,80,0.35)' : 'rgba(244,67,54,0.3)'),
      background: t.ok ? 'rgba(76,175,80,0.08)' : 'rgba(244,67,54,0.06)', color: t.ok ? 'inherit' : '#c62828', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <b>{t.label}</b> {t.ok ? t.version : (t.error || 'n/a')}
      {t.kind === 'server' && up !== null && <><span style={{ width: 6, height: 6, borderRadius: '50%', background: up ? '#4caf50' : '#f44336', display: 'inline-block' }} />{up ? 'running' : 'stopped'}</>}
    </span>
  )
  return (
    <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {!tools ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> : groups.map(([k, title], gi) => {
        const rows = tools.filter(t => t.kind === k)
        if (!rows.length) return null
        return (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {gi > 0 && <span style={{ color: 'var(--border)', margin: '0 4px' }}>|</span>}
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{title}</span>
            {rows.map(chip)}
          </span>)
      })}
      {tools && tools.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No runtime, build tool or server is configured (settings icon, Environment tab).</span>}
      <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => load(true)} disabled={busy} title="Re-check versions">{busy ? '...' : '\u21BB'}</button>
    </div>
  )
}

export function SetBranchPanel({ appName, displayName, onBranchSet }) {
  const [branches,    setBranches]    = useState([])
  const [branchesErr, setBranchesErr] = useState(null)
  const [filter,      setFilter]      = useState('')
  const [selected,    setSelected]    = useState('master')
  const [sbStatus,    setSbStatus]    = useState('idle')
  const [sbOutput,    setSbOutput]    = useState('')
  const [sbVersion,   setSbVersion]   = useState('')
  const [sbShowLog,   setSbShowLog]   = useState(false)
  const sbPollRef = useRef(null)
  const sbLogRef  = useRef(null)

  const filtered = branches.filter(b => !filter || b.startsWith(filter))

  function loadBranches() {
    fetch(`/api/local-app/${appName}/branches`)
      .then(r => r.json())
      .then(d => { if (d.ok) setBranches(d.branches || []); else setBranchesErr(d.error || 'Failed') })
      .catch(() => setBranchesErr('Could not load branches'))
  }

  function stopPoll() {
    if (sbPollRef.current) { clearInterval(sbPollRef.current); sbPollRef.current = null }
  }

  function startPoll() {
    stopPoll()
    sbPollRef.current = setInterval(() => {
      fetch(`/api/local-app/${appName}/set-branch-status`)
        .then(r => r.json())
        .then(d => {
          setSbOutput(d.output || '')
          setSbVersion(d.version || '')
          if (d.status !== 'running') {
            setSbStatus(d.status)
            stopPoll()
            if (d.status === 'success') { loadBranches(); onBranchSet?.() }
          }
          if (sbLogRef.current) sbLogRef.current.scrollTop = sbLogRef.current.scrollHeight
        })
        .catch(() => {})
    }, 800)
  }

  useEffect(() => {
    loadBranches()
    fetch(`/api/local-app/${appName}/set-branch-status`)
      .then(r => r.json())
      .then(d => {
        setSbStatus(d.status || 'idle')
        setSbOutput(d.output || '')
        setSbVersion(d.version || '')
        if (d.status === 'running') { setSbShowLog(true); startPoll() }
      })
      .catch(() => {})
    return stopPoll
  }, [appName])

  function handleSet() {
    if (!selected || sbStatus === 'running') return
    setSbStatus('running'); setSbOutput(''); setSbVersion(selected); setSbShowLog(true)
    fetch(`/api/local-app/${appName}/set-branch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: selected }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { startPoll() }
        else { setSbStatus('failed'); setSbOutput(d.error || 'Failed') }
      })
      .catch(() => { setSbStatus('failed'); setSbOutput('Could not reach server') })
  }

  function handleAbort() {
    fetch(`/api/local-app/${appName}/abort-set-branch`, { method: 'POST' })
      .then(() => { stopPoll(); setSbStatus('failed'); setSbOutput(o => o + '\n[ABORTED]\n') })
      .catch(() => {})
  }

  return (
    <>
      <div className="card" style={{ flex: '0 1 280px', marginBottom: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Set {displayName} Branch</div>
        {branchesErr && <div className="alert alert-error" style={{ marginBottom: 10 }}>{branchesErr}</div>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <input type="text" placeholder="Filter…" value={filter}
            onChange={e => { setFilter(e.target.value); setSelected(filtered[0] || '') }}
            style={{ width: 70, maxWidth: 70, flexShrink: 0 }} />
          <select value={selected} onChange={e => setSelected(e.target.value)}
            disabled={branches.length === 0 || sbStatus === 'running'}
            style={{ flex: '1 1 0', minWidth: 0, maxWidth: 120, padding: '8px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 13, fontFamily: 'inherit' }}>
            {filtered.length === 0 ? <option value="">No matches</option>
              : filtered.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-primary btn-sm" onClick={handleSet}
            disabled={sbStatus === 'running' || !selected || filtered.length === 0}
            style={{ flex: 1 }}>
            {sbStatus === 'running'
              ? <><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> Running…</>
              : `Set ${displayName} Branch`}
          </button>
          {(sbStatus === 'running' || sbStatus === 'success' || sbStatus === 'failed') && (
            <button className="btn btn-sm" onClick={() => setSbShowLog(l => !l)} title="Show/hide log"
              style={{ flexShrink: 0, fontSize: 11 }}>
              {sbShowLog ? '▲ Log' : '▼ Log'}
            </button>
          )}
        </div>
        {sbStatus === 'success' && <div className="alert alert-info" style={{ marginTop: 8, fontSize: 12 }}>Branch set to <strong>{sbVersion}</strong>.</div>}
        {sbStatus === 'failed' && !sbShowLog && <div className="alert alert-error" style={{ marginTop: 8, fontSize: 12 }}>Set branch failed. Show log for details.</div>}
      </div>
      {sbShowLog && sbStatus !== 'idle' && (
        <div className="card" style={{ flex: '0 0 100%', marginBottom: 0, padding: '10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>
              {sbStatus === 'running'
                ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5, marginRight: 6 }} />Setting branch {sbVersion}…</>
                : `Set branch ${sbVersion} — ${sbStatus}`}
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {sbStatus === 'running' && (
                <button className="btn btn-sm" onClick={handleAbort}
                  style={{ fontSize: 11, color: '#c62828', borderColor: '#e57373' }}>Abort</button>
              )}
              <CopyButton text={sbOutput} />
              <button className="btn btn-sm" onClick={() => setSbShowLog(false)} style={{ fontSize: 11 }}>✕</button>
            </div>
          </div>
          <ColoredTerminal output={sbOutput} termRef={sbLogRef} maxHeight={220} />
        </div>
      )}
    </>
  )
}

export function fmtMs(ms) {
  if (!ms) return ''
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

export const DEFAULT_BUILD_FLAGS = [
  { key: '-ncs',  label: 'No Code Sync',   enabled: true, order: 1, default: true  },
  { key: '-st',   label: 'Skip Tests',     enabled: true, order: 2, default: true  },
  { key: '-ncb',  label: 'No Clean Build', enabled: true, order: 3, default: false },
  { key: '-nbld', label: 'No Build',       enabled: true, order: 4, default: false },
  { key: '-rf',   label: 'Resume From',    enabled: true, order: 5, default: false },
  { key: '-sdu',  label: 'Skip DB Update', enabled: true, order: 6, default: false },
  { key: '-nd',   label: 'No Deploy',      enabled: true, order: 7, default: false },
  { key: '-p',    label: 'Parallel Build', enabled: true, order: 8, default: false, value: '1C' },
]

// AIDev: starts `lai` in the repository and resumes the session named like the branch (a new session is named after it)
export function AiDevCard({ kind = 'local', appName, branch, vmIp, style }) {
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)
  function run() {
    setBusy(true); setRes(null)
    fetch(`/api/${kind}-app/${appName}/ai-dev`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branch: branch || '', vm_ip: vmIp || '' }) })
      .then(r => r.json()).then(setRes).catch(() => setRes({ ok: false, error: 'Could not reach server' })).finally(() => setBusy(false))
  }
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 10px', textAlign: 'center', ...style }}>
      <div style={{ fontSize: 18, lineHeight: 1 }}>🤖</div>
      <button className="btn btn-sm" onClick={run} disabled={busy || !branch} style={{ width: '100%', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}
        title={branch ? `Runs lai: resumes the session "${branch}" or starts one with that name` : 'Waiting for the branch'}>
        {busy ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> : 'AIDev'}
      </button>
      {res && <div style={{ fontSize: 11, color: res.ok ? '#2e7d32' : '#c62828', wordBreak: 'break-word' }}>
        {res.ok ? (res.mode === 'resume' ? `Resumed session "${res.session}"` : `Started a new session named "${res.session}"`) : res.error}
      </div>}
    </div>
  )
}

export function ActionCard({ appName, title, icon, desc, srcdir, action, btnLabel, style, compact }) {
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState(null)
  const [ok,   setOk]   = useState(false)

  function run() {
    setBusy(true); setErr(null); setOk(false)
    fetch(`/api/local-app/${appName}/${action}`, { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (d.ok) { setOk(true); setTimeout(() => setOk(false), 4000) } else setErr(d.error) })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setBusy(false))
  }

  if (compact) {
    return (
      <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '8px 10px', ...style }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, textAlign: 'center' }}>
          <div style={{ fontSize: 18, lineHeight: 1 }}>{icon}</div>
          {err && <div className="alert alert-error" style={{ fontSize: 11, padding: '2px 5px' }}>{err}</div>}
          {ok  && <div className="alert alert-info"  style={{ fontSize: 11, padding: '2px 5px' }}>Launched!</div>}
          <button className="btn btn-sm" onClick={run} disabled={busy} style={{ width: '100%', fontSize: 11 }}>
            {busy ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> : btnLabel}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={style}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ fontSize: 28, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>{icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{title}</div>
          {desc && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: srcdir ? 4 : 0 }}>{desc}</div>}
          {srcdir && <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{srcdir}</code>}
          {err && <div className="alert alert-error" style={{ marginTop: 10 }}>{err}</div>}
          {ok  && <div className="alert alert-info"  style={{ marginTop: 10 }}>Launched successfully.</div>}
        </div>
        <button className="btn btn-sm" onClick={run} disabled={busy} style={{ flexShrink: 0 }}>
          {busy ? <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> : btnLabel}
        </button>
      </div>
    </div>
  )
}

export function ConfigureModal({ appName, onClose, apiBase = '/api/local-app', showBuildTab = true }) {
  const [tab,          setTab]          = useState('build_params')
  const [buildRows,    setBuildRows]    = useState([])
  const [deployRows,   setDeployRows]   = useState([])
  const [flagRows,     setFlagRows]     = useState([])
  const [loading,      setLoading]      = useState(true)
  const [flagsLoading, setFlagsLoading] = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [err,          setErr]          = useState(null)
  const [saveOk,       setSaveOk]       = useState(false)

  useEffect(() => {
    fetch(`${apiBase}/${appName}/deploy-config`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setBuildRows(d.build || []); setDeployRows(d.deploy || []) }
        else setErr(d.error || 'Failed to load config')
      })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
    fetch(`${apiBase}/${appName}/build-params`)
      .then(r => r.json())
      .then(d => {
        if (!d.ok) return
        const rows = d.flags || []
        const needP = appName === 'payor' && rows.length > 0 && !rows.some(f => f.key === '-p')
        setFlagRows(needP ? [...rows, { ...DEFAULT_BUILD_FLAGS.find(f => f.key === '-p'), order: rows.length + 1 }] : rows)
      })
      .catch(() => {})
      .finally(() => setFlagsLoading(false))
  }, [appName])

  function save() {
    if (tab === 'build_params') {
      setSaving(true); setSaveOk(false); setErr(null)
      fetch(`${apiBase}/${appName}/build-params`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flags: flagRows }),
      })
        .then(r => r.json())
        .then(d => {
          if (d.ok) { setSaveOk(true); setTimeout(() => setSaveOk(false), 3000) }
          else setErr(d.error || 'Save failed')
        })
        .catch(() => setErr('Could not reach server'))
        .finally(() => setSaving(false))
    } else {
      setSaving(true); setSaveOk(false); setErr(null)
      fetch(`${apiBase}/${appName}/deploy-config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ build: buildRows, deploy: deployRows }),
      })
        .then(r => r.json())
        .then(d => {
          if (d.ok) { setSaveOk(true); setTimeout(() => setSaveOk(false), 3000) }
          else setErr(d.error || 'Save failed')
        })
        .catch(() => setErr('Could not reach server'))
        .finally(() => setSaving(false))
    }
  }

  const upd = (setter, i, field, val) =>
    setter(rows => rows.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  const del = (setter, i) => setter(rows => rows.filter((_, idx) => idx !== i))
  const move = (setter, i, dir) => setter(rows => {
    const r = [...rows], j = i + dir
    if (j < 0 || j >= r.length) return r
    ;[r[i], r[j]] = [r[j], r[i]]
    return r
  })

  const inp = { width: '100%', padding: '4px 6px', fontSize: 12, background: 'var(--surface)',
    border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontFamily: 'monospace' }
  const th  = { textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid var(--border)',
    color: 'var(--text-muted)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }
  const td  = { padding: '3px 4px', verticalAlign: 'middle' }
  const delBtn = (fn) => (
    <button onClick={fn} style={{ background: 'none', border: 'none', cursor: 'pointer',
      color: '#f44336', fontSize: 15, padding: '0 4px', lineHeight: 1 }}>✕</button>
  )
  const isLoading = loading || flagsLoading

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)', width: 820, maxWidth: '96vw', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Configure — {appName}</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none',
            cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)', lineHeight: 1 }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 20px' }}>
          {[['build', 'Build Configuration'], ['build_params', 'Build Parameters'], ['deploy', 'Deploy Configuration']]
            .filter(([key]) => key !== 'build' || showBuildTab)
            .map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{
              padding: '10px 18px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: tab === key ? 700 : 400,
              color: tab === key ? 'var(--primary, #3b82f6)' : 'var(--text-muted)',
              borderBottom: tab === key ? '2px solid var(--primary, #3b82f6)' : '2px solid transparent',
              marginBottom: -1,
            }}>{label}</button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
          {isLoading && <div style={{ textAlign: 'center', padding: 32 }}><span className="spinner" /></div>}
          {err       && <div className="alert alert-error" style={{ marginBottom: 10 }}>{err}</div>}

          {!isLoading && tab === 'build' && (
            <>
              {buildRows.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                  No Build sheet in xlsx yet. Add rows and save to create it.
                </div>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  {['Key', 'Value', 'Condition', 'Description', '', ''].map(h => <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {buildRows.map((row, i) => (
                    <tr key={i}>
                      <td style={{ ...td, width: '20%' }}><input style={inp} value={row.key} onChange={e => upd(setBuildRows, i, 'key', e.target.value)} /></td>
                      <td style={{ ...td, width: '24%' }}><input style={inp} value={row.value} onChange={e => upd(setBuildRows, i, 'value', e.target.value)} /></td>
                      <td style={{ ...td, width: '20%' }}><input style={inp} value={row.condition || ''} onChange={e => upd(setBuildRows, i, 'condition', e.target.value)} placeholder=">26 and <27" /></td>
                      <td style={td}><input style={inp} value={row.description || ''} onChange={e => upd(setBuildRows, i, 'description', e.target.value)} /></td>
                      <td style={{ ...td, width: 40, whiteSpace: 'nowrap' }}>
                        <button onClick={() => move(setBuildRows, i, -1)} disabled={i === 0}
                          style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer',
                            color: i === 0 ? 'var(--border)' : 'var(--text-muted)', fontSize: 13, padding: '0 2px', lineHeight: 1 }}>▲</button>
                        <button onClick={() => move(setBuildRows, i, 1)} disabled={i === buildRows.length - 1}
                          style={{ background: 'none', border: 'none', cursor: i === buildRows.length - 1 ? 'default' : 'pointer',
                            color: i === buildRows.length - 1 ? 'var(--border)' : 'var(--text-muted)', fontSize: 13, padding: '0 2px', lineHeight: 1 }}>▼</button>
                      </td>
                      <td style={{ ...td, width: 28 }}>{delBtn(() => del(setBuildRows, i))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn btn-sm" onClick={() => setBuildRows(r => [...r, { key: '', value: '', condition: '', description: '' }])}
                style={{ marginTop: 10, fontSize: 12 }}>+ Add Row</button>
            </>
          )}

          {!isLoading && tab === 'deploy' && (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  {['Key', 'Value', 'Condition', 'Description', '', ''].map(h => <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {deployRows.map((row, i) => (
                    <tr key={i}>
                      <td style={{ ...td, width: '20%' }}><input style={inp} value={row.key} onChange={e => upd(setDeployRows, i, 'key', e.target.value)} /></td>
                      <td style={{ ...td, width: '24%' }}><input style={inp} value={row.value} onChange={e => upd(setDeployRows, i, 'value', e.target.value)} /></td>
                      <td style={{ ...td, width: '20%' }}><input style={inp} value={row.condition || ''} onChange={e => upd(setDeployRows, i, 'condition', e.target.value)} placeholder=">26 and <27" /></td>
                      <td style={td}><input style={inp} value={row.description || ''} onChange={e => upd(setDeployRows, i, 'description', e.target.value)} /></td>
                      <td style={{ ...td, width: 40, whiteSpace: 'nowrap' }}>
                        <button onClick={() => move(setDeployRows, i, -1)} disabled={i === 0}
                          style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer',
                            color: i === 0 ? 'var(--border)' : 'var(--text-muted)', fontSize: 13, padding: '0 2px', lineHeight: 1 }}>▲</button>
                        <button onClick={() => move(setDeployRows, i, 1)} disabled={i === deployRows.length - 1}
                          style={{ background: 'none', border: 'none', cursor: i === deployRows.length - 1 ? 'default' : 'pointer',
                            color: i === deployRows.length - 1 ? 'var(--border)' : 'var(--text-muted)', fontSize: 13, padding: '0 2px', lineHeight: 1 }}>▼</button>
                      </td>
                      <td style={{ ...td, width: 28 }}>{delBtn(() => del(setDeployRows, i))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn btn-sm" onClick={() => setDeployRows(r => [...r, { key: '', value: '', condition: '', description: '' }])}
                style={{ marginTop: 10, fontSize: 12 }}>+ Add Row</button>
            </>
          )}

          {!isLoading && tab === 'build_params' && (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                Configure the build flag checkboxes shown in the Build &amp; Deploy panel. Changes take effect after saving.
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  {['Key', 'Label', 'Value', 'Enabled', 'Order', 'Default On', ''].map(h => <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {flagRows.map((row, i) => (
                    <tr key={i}>
                      <td style={{ ...td, width: '17%' }}><input style={inp} value={row.key || ''} onChange={e => upd(setFlagRows, i, 'key', e.target.value)} /></td>
                      <td style={{ ...td, width: '24%' }}><input style={inp} value={row.label || ''} onChange={e => upd(setFlagRows, i, 'label', e.target.value)} /></td>
                      <td style={{ ...td, width: '10%' }}><input style={inp} value={row.value || ''} placeholder="e.g. 1C" onChange={e => upd(setFlagRows, i, 'value', e.target.value)} /></td>
                      <td style={{ ...td, width: '10%', textAlign: 'center' }}>
                        <input type="checkbox" checked={row.enabled !== false} onChange={e => upd(setFlagRows, i, 'enabled', e.target.checked)} />
                      </td>
                      <td style={{ ...td, width: '8%' }}>
                        <input type="number" style={{ ...inp, width: 44, textAlign: 'center' }} value={row.order ?? ''} onChange={e => upd(setFlagRows, i, 'order', parseInt(e.target.value) || 0)} />
                      </td>
                      <td style={{ ...td, width: '10%', textAlign: 'center' }}>
                        <input type="checkbox" checked={!!row.default} onChange={e => upd(setFlagRows, i, 'default', e.target.checked)} />
                      </td>
                      <td style={{ ...td, width: 28 }}>{delBtn(() => del(setFlagRows, i))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn btn-sm" onClick={() => setFlagRows(r => [...r, { key: '', label: '', value: '', enabled: true, order: r.length + 1, default: false }])}
                style={{ marginTop: 10, fontSize: 12 }}>+ Add Flag</button>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10 }}>
          {saveOk && <span style={{ fontSize: 12, color: '#4caf50', fontWeight: 600 }}>Saved ✓</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || isLoading}>
              {saving
                ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Saving…</>
                : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function BuildCard({ appName, displayName, branch, onDeployed, buildFlagsCfg, buildCmd }) {
  const _cfgFlags   = buildFlagsCfg !== null && buildFlagsCfg !== undefined ? buildFlagsCfg : DEFAULT_BUILD_FLAGS
  // Payor's refresh script supports -p (Maven -T); surface it even when the saved config predates it
  const _withP      = appName === 'payor' && !_cfgFlags.some(f => f.key === '-p')
    ? [..._cfgFlags, DEFAULT_BUILD_FLAGS.find(f => f.key === '-p')] : _cfgFlags
  const buildFlags  = _withP.filter(f => f.enabled !== false)
  const initChecked = Object.fromEntries(buildFlags.map(f => [f.key, f.default ?? false]))
  const effectiveCmd = buildCmd || `refresh-${appName}`
  const [checked,     setChecked]     = useState(initChecked)
  const [building,    setBuilding]    = useState(false)
  const [buildStatus, setBuildStatus] = useState(null)
  const [output,      setOutput]      = useState('')
  const [err,         setErr]         = useState(null)
  const [progress,       setProgress]       = useState(null)
  const [elapsedMs,      setElapsedMs]      = useState(0)
  const [estimatedMs,    setEstimatedMs]    = useState(null)
  const [aborting,       setAborting]       = useState(false)
  const [currentModule,  setCurrentModule]  = useState(null)
  const [moduleNum,      setModuleNum]      = useState(null)
  const [totalModules,   setTotalModules]   = useState(null)
  // the module of the last failed build is remembered, so Resume From stays available after a reload / Workbench restart
  const [failedModule,   setFailedModule]   = useState(() => { try { return localStorage.getItem(`${appName}_failed_module`) || null } catch { return null } })
  useEffect(() => {
    try { failedModule ? localStorage.setItem(`${appName}_failed_module`, failedModule) : localStorage.removeItem(`${appName}_failed_module`) } catch {}
  }, [failedModule, appName])
  const [phase,          setPhase]          = useState(null)
  const [retryCount,     setRetryCount]     = useState(0)
  const [maxRetries,     setMaxRetries]     = useState(5)
  const [fixingDep,      setFixingDep]      = useState(false)
  const [fixOutput,      setFixOutput]      = useState(null)
  const [fixErr,         setFixErr]         = useState(null)
  const [postalEnabled,  setPostalEnabled]  = useState(null)
  const [postalToggling, setPostalToggling] = useState(false)
  const [showCfg,        setShowCfg]        = useState(false)
  const termRef = useRef(null)

  const activeFlags = buildFlags.filter(f => checked[f.key]).map(f => f.value && String(f.value).trim() ? `${f.key} ${String(f.value).trim()}` : f.key)
  // POM <name> may leak in ('Connector X:: artifact-id 27.1-SNAPSHOT'); -rf needs the artifactId
  const rfModule = checked['-rf'] && failedModule
    ? (f => f.includes('::') ? f.split('::').pop().trim().split(/\s+/).pop() : f)(failedModule.replace(/\s+\d[\w.-]*$/, '').trim())
    : null
  const cmdParts = [effectiveCmd, ...activeFlags.map(f => f === '-rf' && rfModule ? `${f} :${rfModule}` : f)]
  const cmd = cmdParts.join(' ')

  useEffect(() => {
    if (appName !== 'payor') return
    fetch('/api/local-app/payor/postal-address-status')
      .then(r => r.json())
      .then(d => { if (d.ok) setPostalEnabled(d.enabled) })
      .catch(() => {})
  }, [appName])

  function togglePostal() {
    setPostalToggling(true)
    fetch('/api/local-app/payor/postal-address-toggle', { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (d.ok) setPostalEnabled(d.enabled) })
      .catch(() => {})
      .finally(() => setPostalToggling(false))
  }

  useEffect(() => {
    fetch(`/api/local-app/${appName}/build-status`)
      .then(r => r.json())
      .then(d => {
        if (d.status === 'running') {
          setBuilding(true); setBuildStatus('running')
          setOutput(d.output || ''); setProgress(d.progress ?? null)
          setElapsedMs(d.elapsed_ms || 0); setEstimatedMs(d.estimated_ms || null)
          setCurrentModule(d.current_module || null)
          setModuleNum(d.module_num || null)
          setTotalModules(d.total_modules || null)
          setPhase(d.phase || null)
          if (d.retry_count != null) setRetryCount(d.retry_count)
          if (d.max_retries != null) setMaxRetries(d.max_retries)
        } else if (d.status && d.status !== 'idle') {
          if (!sessionStorage.getItem(`${appName}_build_dismissed`)) {
            setBuildStatus(d.status); setOutput(d.output || '')
            setProgress(d.status === 'success' ? 100 : null)
            setPhase(d.phase || null)
            if (d.failed_module) {
              setFailedModule(d.failed_module)
              setChecked(p => ({ ...p, '-rf': true }))
            } else if (d.status === 'failed') {
              setFailedModule(null)                 // failed after the Maven build (deploy / start): nothing to resume from
              setChecked(p => ({ ...p, '-rf': false }))
            }
          }
        }
      })
      .catch(() => {})
  }, [appName])

  useEffect(() => {
    if (buildStatus !== 'running') return
    const id = setInterval(() => {
      fetch(`/api/local-app/${appName}/build-status`)
        .then(r => r.json())
        .then(d => {
          setOutput(d.output || '')
          setElapsedMs(d.elapsed_ms || 0)
          setEstimatedMs(d.estimated_ms ?? null)
          setProgress(d.progress ?? null)
          setCurrentModule(d.current_module || null)
          setModuleNum(d.module_num || null)
          setTotalModules(d.total_modules || null)
          setPhase(d.phase || null)
          if (d.retry_count != null) setRetryCount(d.retry_count)
          if (d.status !== 'running') {
            setBuildStatus(d.status); setBuilding(false); setAborting(false)
            setProgress(d.status === 'success' ? 100 : null)
            if (d.failed_module) {
              setFailedModule(d.failed_module)
              setChecked(p => ({ ...p, '-rf': true }))
            } else if (d.status === 'failed') {
              setFailedModule(null)                 // failed after the Maven build (deploy / start): nothing to resume from
              setChecked(p => ({ ...p, '-rf': false }))
            }
          }
        })
        .catch(() => {})
    }, 800)
    return () => clearInterval(id)
  }, [buildStatus, appName])

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [output])

  useEffect(() => {
    if (buildStatus === 'success') setFailedModule(null)       // a good build ends the resume-from state
    if (buildStatus === 'success' && branch?.branch) {
      fetch(`/api/local-app/${appName}/deployed-info`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: branch.branch, release_ver: branch.release_ver || null }),
      })
        .then(() => onDeployed?.())
        .catch(() => {})
    }
  }, [buildStatus])

  function reset() {
    sessionStorage.setItem(`${appName}_build_dismissed`, '1')
    setBuildStatus(null); setOutput(''); setErr(null)
    setProgress(null); setElapsedMs(0); setPhase(null)
    setCurrentModule(null); setModuleNum(null); setTotalModules(null)
    setFailedModule(null); setRetryCount(0); setFixOutput(null); setFixErr(null)
    setChecked(initChecked)
  }

  function run() {
    sessionStorage.removeItem(`${appName}_build_dismissed`)
    setBuilding(true); setErr(null); setOutput('')
    setBuildStatus('running'); setProgress(null); setElapsedMs(0)
    setFailedModule(null); setPhase(null); setRetryCount(0)
    setChecked(p => ({ ...p, '-rf': false }))
    const body = { flags: activeFlags, max_retries: maxRetries }
    if (rfModule) body.resume_from = rfModule
    fetch(`/api/local-app/${appName}/build`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setEstimatedMs(d.estimated_ms || null) }
        else { setErr(d.error); setBuilding(false); setBuildStatus(null) }
      })
      .catch(() => { setErr('Could not reach server'); setBuilding(false); setBuildStatus(null) })
  }

  function abort() {
    setAborting(true)
    fetch(`/api/local-app/${appName}/abort-build`, { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (!d.ok) setAborting(false) })
      .catch(() => setAborting(false))
  }

  function fixDependency() {
    setFixingDep(true); setFixOutput(null); setFixErr(null)
    fetch(`/api/local-app/${appName}/fix-dependency`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setFixOutput(`Installed: ${d.artifact}\n\n${d.output || ''}`)
          run()
        } else {
          setFixErr(d.error || 'Fix failed')
          if (d.output) setFixOutput(d.output)
        }
      })
      .catch(() => setFixErr('Could not reach server'))
      .finally(() => setFixingDep(false))
  }

  const isDepFailure = buildStatus === 'failed' &&
    /Could not transfer artifact|connect timed out|Could not resolve dependencies|Failed to collect dependencies/i.test(output)

  const barPct = progress !== null
    ? progress
    : buildStatus === 'running' ? Math.min(Math.floor((elapsedMs / 120000) * 90), 90) : 0

  const barVisible = buildStatus === 'running' || buildStatus === 'success'
  const barPctDisplay = buildStatus === 'success' ? 100 : barPct
  const elapsed = fmtMs(elapsedMs)
  const eta = estimatedMs
    ? (estimatedMs > elapsedMs ? `~${fmtMs(estimatedMs - elapsedMs)} left` : `+${fmtMs(elapsedMs - estimatedMs)} over`)
    : null
  const timeLabel = barVisible
    ? (buildStatus === 'success' ? elapsed : eta ? `${elapsed} / ${eta}` : elapsed)
    : null

  return (
    <>
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ fontSize: 28, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>🔨</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Build {displayName || appName} And Deploy</span>
            {postalEnabled !== null && (
              <button onClick={togglePostal} disabled={postalToggling || building}
                style={{
                  borderRadius: 16, cursor: 'pointer',
                  padding: '3px 12px', fontSize: 12, fontWeight: 600,
                  whiteSpace: 'nowrap', textAlign: 'center',
                  background: postalEnabled ? 'rgba(76,175,80,0.15)' : 'rgba(255,152,0,0.15)',
                  color: postalEnabled ? '#2e7d32' : '#e65100',
                  border: `1px solid ${postalEnabled ? 'rgba(76,175,80,0.4)' : 'rgba(255,152,0,0.4)'}`,
                  opacity: postalToggling ? 0.6 : 1,
                }}>
                {postalToggling
                  ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Toggling…</>
                  : postalEnabled ? '● Postal Address Enabled' : '○ Postal Address Disabled'}
              </button>
            )}
          </div>

          {buildFlags.length > 0 && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
            {buildFlags.filter(f => f.key !== '-rf' || buildStatus === 'failed' || failedModule).map(f => (
              <label key={f.key} style={{
                display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 13,
                ...(f.key === '-rf' ? {
                  background: 'rgba(255,152,0,0.12)',
                  border: '1px solid rgba(255,152,0,0.50)',
                  borderRadius: 6,
                  padding: '3px 8px',
                  color: '#e65100',
                  fontWeight: 600,
                } : {}),
              }}>
                <input type="checkbox" checked={checked[f.key]} disabled={building}
                  onChange={() => setChecked(p => ({ ...p, [f.key]: !p[f.key] }))} />
                <span>{f.label}</span>
                <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.key}{f.value ? ` ${f.value}` : ''}</code>
                {f.key === '-rf' && checked['-rf'] && failedModule && (
                  <span style={{ fontSize: 11, color: 'var(--primary, #3b82f6)', fontFamily: 'monospace', marginLeft: 2 }}>
                    :{rfModule}
                  </span>
                )}
              </label>
            ))}
          </div>
          )}

          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Command</div>
          <code style={{ fontSize: 13, background: 'var(--surface-2, var(--surface))', padding: '4px 10px', borderRadius: 4, display: 'inline-block' }}>
            {cmd}
          </code>

          {err && <div className="alert alert-error" style={{ marginTop: 10 }}>{err}</div>}

          {barVisible && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, minWidth: 0 }}>
                {buildStatus === 'success' ? (
                  <span style={{ fontSize: 13, color: '#4caf50', fontWeight: 600 }}>Completed ✓</span>
                ) : phase && phase !== 'building' ? (
                  <span style={{ fontSize: 13, color: 'var(--primary, #3b82f6)', fontWeight: 600 }}>
                    {{ stopping: 'Stopping…', deploying: 'Deploying…', starting: 'Starting…', creating_schema: 'Creating DB Schema…', bootstrapping: 'Bootstrapping…' }[phase] || phase}
                  </span>
                ) : retryCount > 0 && !currentModule ? (
                  <span style={{ fontSize: 13, color: '#ff9800', fontWeight: 600 }}>
                    Retrying ({retryCount}/{maxRetries})…
                  </span>
                ) : currentModule ? (
                  <>
                    {moduleNum != null && totalModules != null && (
                      <span style={{ background: 'var(--primary, #3b82f6)', color: '#fff', borderRadius: 10, padding: '2px 10px', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                        {moduleNum}/{totalModules}
                      </span>
                    )}
                    <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }} title={currentModule}>
                      {currentModule}
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Starting…</span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ position: 'relative', flex: 1, height: 26, background: 'var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{
                    position: 'absolute', left: 0, top: 0, height: '100%',
                    width: `${barPctDisplay}%`,
                    background: 'linear-gradient(180deg, #81c784 0%, #4caf50 45%, #388e3c 46%, #43a047 100%)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35)',
                    borderRadius: 6,
                    transition: 'width 0.8s ease',
                  }} />
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, pointerEvents: 'none',
                    color: barPctDisplay > 45 ? '#fff' : 'var(--text)',
                    textShadow: barPctDisplay > 45 ? '0 1px 2px rgba(0,0,0,0.4)' : 'none',
                  }}>
                    {barPctDisplay}%
                  </div>
                </div>
                {timeLabel && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {timeLabel}
                  </span>
                )}
              </div>
            </div>
          )}

          {(buildStatus || output) && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 8 }}>
                Output
                {buildStatus === 'running' && <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />}
                {buildStatus === 'success' && <span style={{ color: '#4caf50' }}>✓ Done</span>}
                {buildStatus === 'failed'  && <span style={{ color: '#f44336' }}>✗ Failed</span>}
                {buildStatus === 'aborted' && <span style={{ color: '#ff9800' }}>⏹ Aborted</span>}
                {retryCount > 0 && <span style={{ color: '#ff9800', fontSize: 11 }}>↺ {retryCount} retr{retryCount === 1 ? 'y' : 'ies'}</span>}
                <CopyButton text={output} />
              </div>
              <ColoredTerminal output={output} termRef={termRef} height={280} fontSize={12} />

              {isDepFailure && (
                <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 6,
                  background: 'rgba(255,152,0,0.07)', border: '1px solid rgba(255,152,0,0.35)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: fixOutput || fixErr ? 8 : 0 }}>
                    <span style={{ fontSize: 13, color: '#e65100', fontWeight: 600 }}>
                      Dependency download failed
                    </span>
                    <button className="btn btn-sm" onClick={fixDependency} disabled={fixingDep}
                      style={{ color: '#e65100', borderColor: 'rgba(255,152,0,0.5)', whiteSpace: 'nowrap' }}>
                      {fixingDep
                        ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Installing…</>
                        : '⚙ Fix & Retry'}
                    </button>
                  </div>
                  {fixErr && (
                    <div style={{ fontSize: 12, color: '#f44336', marginBottom: fixOutput ? 6 : 0 }}>{fixErr}</div>
                  )}
                  {fixOutput && (
                    <pre style={{
                      margin: 0, fontSize: 11, fontFamily: 'monospace', lineHeight: 1.5,
                      background: '#0d0d0d', color: '#d4d4d4', padding: '8px 10px',
                      borderRadius: 4, maxHeight: 160, overflowY: 'auto',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    }}>{fixOutput}</pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            Dep. retries
            <input type="number" min={0} max={10} value={maxRetries} disabled={building}
              onChange={e => setMaxRetries(Math.max(0, Math.min(10, parseInt(e.target.value) || 0)))}
              style={{ width: 44, padding: '3px 6px', fontSize: 12, textAlign: 'center',
                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }} />
          </label>
          <button className="btn btn-primary btn-sm" onClick={run} disabled={building}>
            {building ? (
              <><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> {
                { building: 'Building…', stopping: 'Stopping…', deploying: 'Deploying…', starting: 'Starting…', creating_schema: 'Creating Schema…', bootstrapping: 'Bootstrapping…' }[phase] || 'Building…'
              }</>
            ) : 'Build & Deploy'}
          </button>
          {!building && (
            <button className="btn btn-sm" onClick={() => setShowCfg(true)} title="Configure build_deploy_config.xlsx"
              style={{ fontSize: 13 }}>⚙</button>
          )}
          {building && (
            <button className="btn btn-sm" onClick={abort} disabled={aborting}
              style={{ color: '#f44336', borderColor: '#f44336' }}>
              {aborting ? 'Aborting…' : 'Abort'}
            </button>
          )}
          {!building && buildStatus && buildStatus !== 'running' && (
            <button className="btn btn-sm" onClick={reset}
              style={{ color: '#1976d2', borderColor: '#1976d2', fontWeight: 600 }}>
              OK
            </button>
          )}
        </div>
      </div>
    </div>
    {showCfg && <ConfigureModal appName={appName} onClose={() => setShowCfg(false)} />}
    </>
  )
}

function ModuleDeployTargets({ targets, targetArtifactName, onSave, saving }) {
  const normalize = (ts) => ts?.length > 0 ? ts.map(t => ({ ...t })) : [{ deploy_dir: '', deployment_artifact_name: '' }]
  const [editTargets,   setEditTargets]   = useState(() => normalize(targets))
  const [editTartifact, setEditTartifact] = useState(targetArtifactName || '')
  useEffect(() => { setEditTargets(normalize(targets)); setEditTartifact(targetArtifactName || '') }, [JSON.stringify(targets), targetArtifactName])
  const inp = { width: '100%', padding: '3px 6px', fontSize: 11, fontFamily: 'monospace',
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text)' }
  const origStr   = JSON.stringify(normalize(targets))
  const editStr   = JSON.stringify(editTargets)
  const dirty     = editStr !== origStr || editTartifact !== (targetArtifactName || '')
  const updateT   = (i, key, val) => setEditTargets(prev => prev.map((t, idx) => idx === i ? { ...t, [key]: val } : t))
  const addTarget = () => setEditTargets(prev => [...prev, { deploy_dir: '', deployment_artifact_name: '' }])
  const removeT   = (i) => setEditTargets(prev => prev.filter((_, idx) => idx !== i))
  return (
    <div>
      {editTargets.map((t, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 5, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 160px' }}>
            {i === 0 && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Deploy Dir (in container)</div>}
            <input style={inp} value={t.deploy_dir || ''} onChange={e => updateT(i, 'deploy_dir', e.target.value)} placeholder="/path/in/container" />
          </div>
          <div style={{ flex: '1 1 130px' }}>
            {i === 0 && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Deployment Artifact Name</div>}
            <input style={inp} value={t.deployment_artifact_name || ''} onChange={e => updateT(i, 'deployment_artifact_name', e.target.value)} placeholder="module.jar / module.war" />
          </div>
          {editTargets.length > 1 && (
            <button onClick={() => removeT(i)} title="Remove"
              style={{ fontSize: 12, padding: '2px 7px', background: 'none', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', color: '#f44336', lineHeight: 1.5 }}>✕</button>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 3, flexWrap: 'wrap' }}>
        <button onClick={addTarget}
          style={{ fontSize: 10, padding: '2px 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          + Add Target
        </button>
        <div style={{ flex: '1 1 130px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Target Artifact Name</div>
          <input style={inp} value={editTartifact} onChange={e => setEditTartifact(e.target.value)} placeholder="module-1.0-SNAPSHOT.jar" />
        </div>
        {dirty && (
          <button className="btn btn-sm" onClick={() => onSave(editTargets, editTartifact)} disabled={saving}
            style={{ fontSize: 11, padding: '3px 10px', whiteSpace: 'nowrap' }}>
            {saving ? <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} /> : 'Save'}
          </button>
        )}
      </div>
    </div>
  )
}

export function ModulePanel({ appName, displayName, srcdir }) {
  const [modules,     setModules]    = useState(null)
  const [loading,     setLoading]    = useState(false)
  const [loadErr,     setLoadErr]    = useState(null)
  const [selected,    setSelected]   = useState(null)
  const [deps,        setDeps]       = useState([])
  const [depsLoading, setDepsLoading] = useState(false)
  const [depsErr,     setDepsErr]    = useState(null)
  const [skipTests,   setSkipTests]  = useState(true)
  const [withDist,    setWithDist]   = useState(false)
  const [opStatus,    setOpStatus]   = useState(null)
  const [opKind,      setOpKind]     = useState(null)
  const [output,      setOutput]     = useState('')
  const [opErr,       setOpErr]      = useState(null)
  const [deployCfg,   setDeployCfg]  = useState(null)
  const [cfgSaving,   setCfgSaving]  = useState(false)
  const [cfgSaveOk,   setCfgSaveOk]  = useState(false)
  const [cfgErr,      setCfgErr]     = useState(null)
  const [modFilter,   setModFilter]  = useState('')
  const termRef        = useRef(null)
  const loadModulesRef = useRef(null)

  function loadModules() {
    setLoading(true); setLoadErr(null)
    fetch(`/api/local-app/${appName}/modules`)
      .then(r => r.json())
      .then(d => { if (d.ok) setModules(d); else setLoadErr(d.error || 'Failed') })
      .catch(() => setLoadErr('Could not reach server'))
      .finally(() => setLoading(false))
  }

  loadModulesRef.current = loadModules

  useEffect(() => { loadModules() }, [appName, srcdir])

  useEffect(() => {
    fetch(`/api/local-app/${appName}/module-deploy-cfg`)
      .then(r => r.json())
      .then(d => { if (d.ok) setDeployCfg(d) })
      .catch(() => {})
  }, [appName])

  useEffect(() => {
    const prev = { status: null }
    const id = setInterval(() => {
      fetch(`/api/local-app/${appName}/build-status`)
        .then(r => r.json())
        .then(d => {
          const wasRunning = prev.status === 'running'
          prev.status = d.status
          if (d.status === 'running' || wasRunning) {
            loadModulesRef.current()
          }
        })
        .catch(() => {})
    }, 10000)
    return () => clearInterval(id)
  }, [appName])

  useEffect(() => {
    if (!selected) { setDeps([]); setDepsErr(null); return }
    setDepsLoading(true); setDepsErr(null)
    fetch(`/api/local-app/${appName}/modules/${encodeURIComponent(selected)}/dependents`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) setDeps(d.dependents || [])
        else { setDeps([]); setDepsErr(d.error || 'Failed to load dependents') }
      })
      .catch(() => { setDeps([]); setDepsErr('Could not reach server') })
      .finally(() => setDepsLoading(false))
  }, [selected, appName])

  useEffect(() => {
    if (opStatus !== 'running') return
    const id = setInterval(() => {
      fetch(`/api/local-app/${appName}/module-op-status`)
        .then(r => r.json())
        .then(d => {
          setOutput(d.output || '')
          if (d.status !== 'running') {
            setOpStatus(d.status)
            if (d.status === 'success') loadModules()
          }
        })
        .catch(() => {})
    }, 800)
    return () => clearInterval(id)
  }, [opStatus, appName])

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [output])

  function abortOp() {
    if (!window.confirm('Abort the running ' + (opKind === 'build' ? 'build' : 'deploy') + '?')) return
    fetch(`/api/local-app/${appName}/module-op-abort`, { method: 'POST' }).catch(() => {})
  }

  // A build / deploy keeps running when the Workbench restarts or this page is left: pick it up again
  useEffect(() => {
    fetch(`/api/local-app/${appName}/module-op-status`).then(r => r.json()).then(d => {
      if (d.status === 'running') { setOpKind(d.op); setOutput(d.output || ''); setOpStatus('running') }
    }).catch(() => {})
  }, [appName])

  function startOp(op) {
    if (!selected || opStatus === 'running') return
    setOpKind(op); setOpStatus('running'); setOutput(''); setOpErr(null)
    const url  = op === 'build'
      ? `/api/local-app/${appName}/module-build`
      : `/api/local-app/${appName}/module-deploy`
    const body = op === 'build'
      ? { module: selected, skip_tests: skipTests, with_dist: withDist }
      : { module: selected }
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.json())
      .then(d => { if (!d.ok) { setOpErr(d.error); setOpStatus(null) } })
      .catch(() => { setOpErr('Could not reach server'); setOpStatus(null) })
  }

  const moduleOverrides = deployCfg?.module_overrides || {}

  function saveModuleOverride(module, patch) {
    setCfgSaving(true); setCfgSaveOk(false); setCfgErr(null)
    fetch(`/api/local-app/${appName}/module-deploy-cfg`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module, ...patch }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setCfgSaveOk(true)
          setTimeout(() => setCfgSaveOk(false), 2000)
          // Refresh deployCfg to get updated overrides
          fetch(`/api/local-app/${appName}/module-deploy-cfg`)
            .then(r => r.json())
            .then(d2 => { if (d2.ok) setDeployCfg(d2) })
            .catch(() => {})
        } else {
          setCfgErr(d.error || 'Save failed')
        }
      })
      .catch(() => setCfgErr('Could not reach server'))
      .finally(() => setCfgSaving(false))
  }

  const allMods = modules
    ? [
        ...(modules.ready       || []).map(m => ({ ...m, status: 'ready' })),
        ...(modules.needs_build || []).map(m => ({
          ...m,
          status: moduleOverrides[m.name]?.disable_needs_build ? 'ready' : 'needs_build',
        })),
      ].sort((a, b) => a.name.localeCompare(b.name))
    : []

  const busy = opStatus === 'running'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      <div className="card" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            {displayName || appName} Modules{allMods.length > 0 ? ` (${allMods.length})` : ''}
          </div>
          <button className="btn btn-sm" onClick={loadModules} disabled={loading} title="Refresh">↻</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: '#4caf50', display: 'inline-block' }} />
              Ready ({(modules?.ready || []).length})
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: '#ff9800', display: 'inline-block' }} />
              Needs Build ({(modules?.needs_build || []).length})
            </span>
          </div>
          <input
            value={modFilter} onChange={e => setModFilter(e.target.value)}
            placeholder="Filter modules…"
            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', width: 160 }}
          />
        </div>
        {loadErr && <div className="alert alert-error" style={{ marginTop: 8, fontSize: 12 }}>{loadErr}</div>}
      </div>

      <div style={{ overflowY: 'auto', maxHeight: 320, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)' }}>
        {loading && <div style={{ padding: 16, textAlign: 'center' }}><span className="spinner" /></div>}
        {!loading && allMods.length === 0 && !loadErr && (
          <div style={{ padding: 12, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>No modules found</div>
        )}
        {!loading && allMods.filter(m => !modFilter || m.name.toLowerCase().includes(modFilter.toLowerCase())).map(m => {
          const mov       = moduleOverrides[m.name] || {}
          const hasTarget = mov.targets?.some(t => t.deploy_dir || t.deployment_artifact_name) || mov.deploy_dir || deployCfg?.deploy_dir
          const warn      = deployCfg && !hasTarget && !mov.suppress_warning
          return (
          <div key={m.name} onClick={() => setSelected(sel => sel === m.name ? null : m.name)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', cursor: 'pointer', fontSize: 12,
              background: selected === m.name ? 'var(--primary-faint, rgba(59,130,246,0.1))' : 'transparent',
              borderBottom: '1px solid var(--border)', userSelect: 'none',
            }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: m.status === 'ready' ? '#4caf50' : '#ff9800' }} />
            <span style={{ fontFamily: 'monospace', flex: 1 }}>{m.name}</span>
            {warn && (
              <span title="Deploy path not configured" style={{ fontSize: 10, color: '#ff9800', lineHeight: 1 }}>⚠</span>
            )}
            {m.status === 'ready' && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                {m.jar?.replace(m.name + '-', '').replace(/\.(jar|war)$/, '')}
              </span>
            )}
          </div>
          )
        })}
      </div>

      {selected && (() => {
        const ov          = moduleOverrides[selected] || {}
        const selectedMod = allMods.find(m => m.name === selected)
        // Normalize to targets array (backward compat: old deploy_dir/deployment_artifact_name keys)
        const allTargets  = ov.targets?.length > 0
          ? ov.targets
          : (ov.deploy_dir || ov.deployment_artifact_name || ov.jar_name)
            ? [{ deploy_dir: ov.deploy_dir || '', deployment_artifact_name: ov.deployment_artifact_name || ov.jar_name || '' }]
            : []
        const firstTarget = allTargets[0] || {}
        const resolvedDir = firstTarget.deploy_dir || deployCfg?.deploy_dir
        const resolvedJar = firstTarget.deployment_artifact_name || ov.jar_name || selectedMod?.jar || (selected + '.jar')
        return (
        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, fontFamily: 'monospace' }}>{selected}</div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
              Dependents{!depsLoading && ` (${deps.length})`}
              {depsLoading && <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} />}
            </div>
            {depsErr && <div style={{ fontSize: 11, color: '#f44336' }}>{depsErr}</div>}
            {!depsLoading && !depsErr && deps.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>None</div>
            )}
            {deps.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {deps.map(d => (
                  <code key={d} style={{ fontSize: 10, background: 'var(--surface-2, var(--bg))', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)' }}>{d}</code>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={skipTests} onChange={e => setSkipTests(e.target.checked)} disabled={busy} />
              Skip Tests <code style={{ fontSize: 10 }}>-st</code>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={withDist} onChange={e => setWithDist(e.target.checked)} disabled={busy} />
              With Dependents <code style={{ fontSize: 10 }}>-dist</code>
            </label>
          </div>
          {allTargets.length > 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.6 }}>
              {deployCfg?.container && <div>Container: <code style={{ fontSize: 10 }}>{deployCfg.container}</code></div>}
              {allTargets.map((t, i) => (
                <div key={i}>Deploy{allTargets.length > 1 ? ` #${i + 1}` : ''} → <code style={{ fontSize: 10 }}>{t.deploy_dir || resolvedDir}/{t.deployment_artifact_name || resolvedJar}</code></div>
              ))}
            </div>
          ) : !ov.suppress_warning ? (
            <div style={{ fontSize: 11, color: '#ff9800', marginBottom: 8 }}>
              ⚠ {deployCfg?.reason || 'Deploy path not configured — set deploy dir in Module Overrides below'}
            </div>
          ) : null}

          {/* Per-module configuration */}
          <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 5, background: 'var(--bg, rgba(0,0,0,0.03))', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 7 }}>Module Overrides</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!ov.suppress_warning}
                  onChange={e => saveModuleOverride(selected, { suppress_warning: e.target.checked })} />
                Suppress ⚠ Warning
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!ov.disable_needs_build}
                  onChange={e => saveModuleOverride(selected, { disable_needs_build: e.target.checked })} />
                Disable "Needs Build"
              </label>
            </div>
            <ModuleDeployTargets
              targets={allTargets}
              targetArtifactName={ov.target_artifact_name || ''}
              onSave={(targets, target_artifact_name) => saveModuleOverride(selected, { targets, target_artifact_name })}
              saving={cfgSaving}
            />
            {cfgSaveOk && <div style={{ fontSize: 11, color: '#4caf50', marginTop: 5 }}>Saved ✓</div>}
            {cfgErr && <div style={{ fontSize: 11, color: '#f44336', marginTop: 5 }}>{cfgErr}</div>}
          </div>

          {opErr && <div className="alert alert-error" style={{ marginBottom: 8, fontSize: 12 }}>{opErr}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={() => startOp('build')} disabled={busy} style={{ flex: 1 }}>
              {busy && opKind === 'build' ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Building…</> : 'Build'}
            </button>
            <button className="btn btn-sm" onClick={() => startOp('deploy')} disabled={busy} style={{ flex: 1 }}>
              {busy && opKind === 'deploy' ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Deploying…</> : 'Deploy'}
            </button>
          </div>
        </div>
        )
      })()}

      {(opStatus || output) && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 5, display: 'flex', gap: 8, alignItems: 'center' }}>
            {opKind === 'build' ? 'Build' : 'Deploy'} output
            {opStatus === 'running' && <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />}
            {opStatus === 'success' && <span style={{ color: '#4caf50' }}>✓ Done</span>}
            {opStatus === 'failed'  && <span style={{ color: '#f44336' }}>✗ Failed</span>}
            {opStatus === 'aborted' && <span style={{ color: '#ff9800' }}>⏹ Aborted</span>}
            <CopyButton text={output} />
            {opStatus === 'running' && (
              <button className="btn btn-sm" onClick={abortOp}
                style={{ marginLeft: 8, color: '#f44336', borderColor: '#f44336' }}>Abort</button>
            )}
            {opStatus !== 'running' && (
              <button
                onClick={() => { setOpStatus(null); setOutput(''); setOpKind(null) }}
                title="Close terminal"
                style={{
                  marginLeft: 'auto', background: 'none', border: 'none',
                  cursor: 'pointer', fontSize: 14, color: 'var(--text-muted)',
                  padding: '0 2px', lineHeight: 1,
                }}
              >✕</button>
            )}
          </div>
          <ColoredTerminal output={output} termRef={termRef} height={220} />
        </div>
      )}
    </div>
  )
}

// ── Shared App Server components ──────────────────────────────────────────────

export function DeployedBanner({ appName, noMargin }) {
  const [info, setInfo] = useState(null)

  useEffect(() => {
    fetch(`/api/local-app/${appName}/deployed-info`)
      .then(r => r.json())
      .then(d => { if (d.ok && d.branch) setInfo(d) })
      .catch(() => {})
  }, [appName])

  if (!info) return null

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '5px 14px', borderRadius: 8, marginBottom: noMargin ? 0 : 16,
      background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.2)',
      fontSize: 12, color: 'var(--text-muted)',
    }}>
      <span style={{ fontSize: 11, color: 'var(--primary,#3b82f6)', fontWeight: 700 }}>DEPLOYED</span>
      <span style={{
        fontWeight: 600, padding: '1px 8px', borderRadius: 10, fontSize: 12,
        background: 'rgba(76,175,80,0.1)', color: '#2e7d32', border: '1px solid rgba(76,175,80,0.3)',
      }}>{info.branch}</span>
      {info.release_ver && (
        <span style={{
          fontWeight: 600, padding: '1px 8px', borderRadius: 10, fontSize: 12,
          background: 'rgba(59,130,246,0.1)', color: 'var(--primary,#3b82f6)', border: '1px solid rgba(59,130,246,0.25)',
        }}>v{info.release_ver}</span>
      )}
      {info.deployed_at && (
        <span style={{ opacity: 0.65 }}>· {info.deployed_at}</span>
      )}
    </div>
  )
}

export function StatusBadge({ running }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
      background: running ? 'rgba(76,175,80,0.12)' : 'rgba(244,67,54,0.10)',
      color: running ? '#2e7d32' : '#c62828',
      border: `1px solid ${running ? 'rgba(76,175,80,0.35)' : 'rgba(244,67,54,0.25)'}`,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: running ? '#4caf50' : '#f44336', display: 'inline-block' }} />
      {running ? 'Running' : 'Not Running'}
    </span>
  )
}

export function RuntimePropertiesPanel({ appName }) {
  const [props,     setProps]     = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [err,       setErr]       = useState(null)
  const [filter,    setFilter]    = useState('')
  const [editKey,   setEditKey]   = useState(null)
  const [editVal,   setEditVal]   = useState('')
  const [saving,    setSaving]    = useState(false)
  const [newKey,    setNewKey]    = useState('')
  const [newVal,    setNewVal]    = useState('')
  const [addErr,    setAddErr]    = useState(null)
  const [adding,    setAdding]    = useState(false)
  const [deleting,  setDeleting]  = useState(null)

  function load() {
    setLoading(true)
    fetch(`/api/local-app/${appName}/runtime-properties`)
      .then(r => r.json())
      .then(d => { if (d.ok) setProps(d.properties); else setErr(d.error) })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [appName])

  function startEdit(key) { setEditKey(key); setEditVal(props[key] ?? '') }
  function cancelEdit()   { setEditKey(null); setEditVal('') }

  function saveEdit(key) {
    setSaving(true)
    fetch(`/api/local-app/${appName}/runtime-properties/${encodeURIComponent(key)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: editVal }),
    })
      .then(r => r.json())
      .then(d => { if (d.ok) { setProps(d.properties); setEditKey(null) } else setErr(d.error) })
      .finally(() => setSaving(false))
  }

  function deleteKey(key) {
    setDeleting(key)
    fetch(`/api/local-app/${appName}/runtime-properties/${encodeURIComponent(key)}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(d => { if (d.ok) setProps(d.properties); else setErr(d.error) })
      .finally(() => setDeleting(null))
  }

  function addProperty() {
    const k = newKey.trim()
    if (!k) { setAddErr('Key is required'); return }
    setAdding(true); setAddErr(null)
    fetch(`/api/local-app/${appName}/runtime-properties`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: k, value: newVal }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setProps(d.properties); setNewKey(''); setNewVal('') }
        else setAddErr(d.error)
      })
      .finally(() => setAdding(false))
  }

  const entries  = props ? Object.entries(props) : []
  const q        = filter.toLowerCase()
  const filtered = q ? entries.filter(([k, v]) => k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)) : entries

  const inputStyle = {
    background: 'var(--bg-secondary)', color: 'var(--text-primary)',
    border: '1px solid var(--border-color)', borderRadius: 4,
    padding: '3px 7px', fontSize: 12, width: '100%',
  }
  const cellStyle = { padding: '5px 8px', fontSize: 12, verticalAlign: 'middle' }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          Runtime Properties{props ? ` (${entries.length})` : ''}
        </span>
        <button onClick={load} disabled={loading} className="btn btn-sm"
          style={{ fontSize: 11, padding: '2px 10px' }}>
          {loading ? <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} /> : '↻ Refresh'}
        </button>
      </div>

      {err && <div className="alert alert-error" style={{ marginBottom: 10, fontSize: 12 }}>{err}</div>}

      <input
        type="text" placeholder="Filter by key or value…"
        value={filter} onChange={e => setFilter(e.target.value)}
        style={{ ...inputStyle, marginBottom: 10, width: '100%', boxSizing: 'border-box' }}
      />

      {loading && !props ? (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
        </div>
      ) : (
        <div style={{ maxHeight: 340, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 5 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)', position: 'sticky', top: 0, zIndex: 1 }}>
                <th style={{ ...cellStyle, width: '38%', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Key</th>
                <th style={{ ...cellStyle, textAlign: 'left', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Value</th>
                <th style={{ ...cellStyle, width: 60, borderBottom: '1px solid var(--border-color)' }} />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={3} style={{ ...cellStyle, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>
                  {filter ? 'No matches' : 'No properties yet'}
                </td></tr>
              ) : filtered.map(([k, v]) => (
                <tr key={k} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ ...cellStyle, fontFamily: 'monospace', wordBreak: 'break-all' }}>{k}</td>
                  <td style={cellStyle}>
                    {editKey === k ? (
                      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                        <input value={editVal} onChange={e => setEditVal(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(k); if (e.key === 'Escape') cancelEdit() }}
                          autoFocus style={{ ...inputStyle, flex: 1 }} />
                        <button className="btn btn-primary btn-sm" onClick={() => saveEdit(k)} disabled={saving}
                          style={{ fontSize: 11, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                          {saving ? '…' : 'Save'}
                        </button>
                        <button className="btn btn-sm" onClick={cancelEdit} disabled={saving}
                          style={{ fontSize: 11, padding: '2px 8px' }}>✕</button>
                      </div>
                    ) : (
                      <span style={{ fontFamily: 'monospace', cursor: 'pointer', display: 'block', wordBreak: 'break-all' }}
                        onClick={() => startEdit(k)} title="Click to edit">
                        {String(v) || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>(empty)</span>}
                      </span>
                    )}
                  </td>
                  <td style={{ ...cellStyle, textAlign: 'center' }}>
                    {editKey !== k && (
                      <button onClick={() => deleteKey(k)} disabled={deleting === k}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f44336', fontSize: 14, padding: '2px 4px', lineHeight: 1 }}>
                        {deleting === k ? '…' : '🗑'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: 6, border: '1px solid var(--border-color)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-muted)' }}>Add Property</div>
        {addErr && <div style={{ color: '#f44336', fontSize: 11, marginBottom: 6 }}>{addErr}</div>}
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <div style={{ flex: '0 0 38%' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Key</div>
            <input value={newKey} onChange={e => { setNewKey(e.target.value); setAddErr(null) }}
              onKeyDown={e => e.key === 'Enter' && addProperty()}
              placeholder="property.key" style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Value</div>
            <input value={newVal} onChange={e => setNewVal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addProperty()}
              placeholder="value" style={inputStyle} />
          </div>
          <button className="btn btn-primary btn-sm" onClick={addProperty} disabled={adding}
            style={{ fontSize: 12, padding: '4px 14px', whiteSpace: 'nowrap' }}>
            {adding ? <><span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} /> Adding…</> : '+ Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

function KarafStateBadge({ state }) {
  const color = state === 'Started' || state === 'Installed' ? '#4caf50'
              : state === 'Uninstalled' ? 'var(--text-muted)' : '#ff9800'
  const isMuted = color === 'var(--text-muted)'
  return (
    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, flexShrink: 0,
      background: isMuted ? 'rgba(128,128,128,0.12)' : color + '20',
      color, border: `1px solid ${isMuted ? 'rgba(128,128,128,0.3)' : color + '50'}` }}>
      {state}
    </span>
  )
}

function FeatureRepoTab({ base, query = '' }) {
  const [repos,    setRepos]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [err,      setErr]      = useState(null)
  const [filter,   setFilter]   = useState('')
  const [adding,   setAdding]   = useState(false)
  const [newUrl,   setNewUrl]   = useState('')
  const [opErr,    setOpErr]    = useState(null)
  const [busy,     setBusy]     = useState(null)  // repo name being operated on
  const _q = query ? `?${query}` : ''

  function loadRepos() {
    setLoading(true); setErr(null)
    fetch(`${base}/repos${_q}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setRepos(d.repos || []); else setErr(d.error) })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { loadRepos() }, [base, query])

  function addRepo() {
    if (!newUrl.trim()) return
    setBusy('__add__'); setOpErr(null)
    fetch(`${base}/repo-op${_q}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'add', name: newUrl.trim() }),
    })
      .then(r => r.json())
      .then(d => { if (d.ok) { setNewUrl(''); setAdding(false); loadRepos() } else setOpErr(d.error) })
      .catch(() => setOpErr('Request failed'))
      .finally(() => setBusy(null))
  }

  function removeRepo(name) {
    setBusy(name); setOpErr(null)
    fetch(`${base}/repo-op${_q}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'remove', name }),
    })
      .then(r => r.json())
      .then(d => { if (d.ok) loadRepos(); else setOpErr(d.error) })
      .catch(() => setOpErr('Request failed'))
      .finally(() => setBusy(null))
  }

  const flt = filter.toLowerCase()
  const visible = flt ? repos.filter(r => r.name.toLowerCase().includes(flt) || r.url.toLowerCase().includes(flt)) : repos

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input value={filter} onChange={e => setFilter(e.target.value)}
          placeholder="Filter repos…" style={{ flex: 1, fontSize: 12, padding: '5px 10px' }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{visible.length}</span>
        <button className="btn btn-sm" onClick={loadRepos} title="Refresh" disabled={!!busy}>↻</button>
        <button className="btn btn-primary btn-sm" onClick={() => { setAdding(a => !a); setOpErr(null) }}>
          {adding ? 'Cancel' : '+ Add Repo'}
        </button>
      </div>

      {adding && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input value={newUrl} onChange={e => setNewUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addRepo()}
            placeholder="mvn:groupId/artifactId/version/xml/features or repo name"
            style={{ flex: 1, fontSize: 12, padding: '5px 10px' }} autoFocus />
          <button className="btn btn-primary btn-sm" onClick={addRepo} disabled={busy === '__add__' || !newUrl.trim()}>
            {busy === '__add__' ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Adding…</> : 'Add'}
          </button>
        </div>
      )}

      {opErr && <div className="alert alert-error" style={{ marginBottom: 10, fontSize: 12 }}>{opErr}</div>}

      {loading
        ? <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}><span className="spinner" /></div>
        : err
          ? <div className="alert alert-error">{err}</div>
          : visible.length === 0
            ? <div style={{ padding: '16px 0', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>No repositories</div>
            : <div style={{ overflowY: 'auto', maxHeight: 480 }}>
                {visible.map(repo => (
                  <div key={repo.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={repo.name}>{repo.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }} title={repo.url}>{repo.url}</div>
                    </div>
                    <button className="btn btn-sm" onClick={() => removeRepo(repo.name)} disabled={!!busy}
                      style={{ color: '#f44336', borderColor: '#f44336', flexShrink: 0, fontSize: 11, padding: '2px 8px' }}>
                      {busy === repo.name ? <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} /> : 'Remove'}
                    </button>
                  </div>
                ))}
              </div>
      }
    </div>
  )
}

function FeatureTab({ base, query = '' }) {
  const [features,  setFeatures]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [err,       setErr]       = useState(null)
  const [filter,       setFilter]       = useState('')
  const [connectorOnly, setConnectorOnly] = useState(true)
  const [busy,      setBusy]      = useState(null)
  const [opErr,     setOpErr]     = useState(null)
  const [opMsg,     setOpMsg]     = useState(null)
  const _q = query ? `?${query}` : ''

  function loadFeatures() {
    setLoading(true); setErr(null)
    fetch(`${base}/features${_q}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setFeatures(d.features || []); else setErr(d.error) })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { loadFeatures() }, [base, query])

  function featureOp(name, op) {
    setBusy(name); setOpErr(null); setOpMsg(null)
    fetch(`${base}/feature-op${_q}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, name }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setOpMsg(`${op === 'install' ? 'Installed' : 'Uninstalled'}: ${name}`); setTimeout(loadFeatures, 1500); setTimeout(loadFeatures, 4000) }
        else setOpErr(d.error)
      })
      .catch(() => setOpErr('Request failed'))
      .finally(() => setBusy(null))
  }

  const flt = filter.toLowerCase()
  const visible = features
    .filter(f => !connectorOnly || f.name.startsWith('connector-'))
    .filter(f => !flt || f.name.toLowerCase().includes(flt))

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={filter} onChange={e => setFilter(e.target.value)}
          placeholder="Filter features…" style={{ flex: '1 1 160px', fontSize: 12, padding: '5px 10px' }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{visible.length}</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={connectorOnly} onChange={e => setConnectorOnly(e.target.checked)} style={{ margin: 0 }} />
          connector-
        </label>
        <button className="btn btn-sm" onClick={loadFeatures} title="Refresh" disabled={!!busy}>↻</button>
      </div>

      {opErr && <div className="alert alert-error" style={{ marginBottom: 8, fontSize: 12 }}>{opErr} <button onClick={() => setOpErr(null)} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>✕</button></div>}
      {opMsg && <div style={{ marginBottom: 8, fontSize: 12, color: '#4caf50' }}>{opMsg}</div>}

      {loading
        ? <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}><span className="spinner" /></div>
        : err
          ? <div className="alert alert-error">{err}</div>
          : visible.length === 0
            ? <div style={{ padding: '16px 0', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>No features</div>
            : <div style={{ overflowY: 'auto', maxHeight: 480 }}>
                {visible.map((f, i) => {
                  const installed = f.state === 'Started' || f.state === 'Installed'
                  const isBusy = busy === f.name
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ flex: 1, fontSize: 12, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.name}>{f.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{f.version}</span>
                      <KarafStateBadge state={f.state} />
                      <button className="btn btn-sm" disabled={!!busy} onClick={() => featureOp(f.name, installed ? 'uninstall' : 'install')}
                        style={{ flexShrink: 0, fontSize: 11, padding: '2px 8px',
                          color: installed ? '#f44336' : 'var(--primary)',
                          borderColor: installed ? '#f44336' : 'var(--primary)' }}>
                        {isBusy
                          ? <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} />
                          : installed ? 'Uninstall' : 'Install'}
                      </button>
                    </div>
                  )
                })}
              </div>
      }
    </div>
  )
}

function BundleStateBadge({ state }) {
  const map = {
    Active:   '#4caf50',
    Resolved: '#ff9800',
    Installed:'#2196f3',
    Starting: '#00bcd4',
    Stopping: '#ff9800',
    Failure:  '#f44336',
  }
  const color = map[state] || 'var(--text-muted)'
  const isMuted = color === 'var(--text-muted)'
  return (
    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, flexShrink: 0,
      background: isMuted ? 'rgba(128,128,128,0.12)' : color + '20',
      color, border: `1px solid ${isMuted ? 'rgba(128,128,128,0.3)' : color + '50'}` }}>
      {state || '—'}
    </span>
  )
}

function BundleTab({ base, query = '' }) {
  const [bundles,    setBundles]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [err,        setErr]        = useState(null)
  const [filter,     setFilter]     = useState('')
  const [activeOnly, setActiveOnly] = useState(false)
  const [busy,       setBusy]       = useState(null)
  const [opErr,      setOpErr]      = useState(null)
  const [opMsg,      setOpMsg]      = useState(null)
  const [installing, setInstalling] = useState(false)
  const [installUrl, setInstallUrl] = useState('')
  const _q = query ? `?${query}` : ''

  function loadBundles() {
    setLoading(true); setErr(null)
    fetch(`${base}/bundles${_q}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setBundles(d.bundles || []); else setErr(d.error) })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { loadBundles() }, [base, query])

  function bundleOp(id, op, url) {
    const key = `${op}:${id}`
    setBusy(key); setOpErr(null); setOpMsg(null)
    fetch(`${base}/bundle-op${_q}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, id, url }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setOpMsg(`${op}: bundle ${id || url}`)
          setTimeout(loadBundles, 1500)
          setTimeout(loadBundles, 4000)
        } else setOpErr(d.error)
      })
      .catch(() => setOpErr('Request failed'))
      .finally(() => setBusy(null))
  }

  function doInstall() {
    if (!installUrl.trim()) return
    bundleOp('', 'install', installUrl.trim())
    setInstallUrl(''); setInstalling(false)
  }

  const flt = filter.toLowerCase()
  const visible = bundles
    .filter(b => !activeOnly || b.state === 'Active')
    .filter(b => !flt || b.name.toLowerCase().includes(flt) || b.id.includes(flt))

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={filter} onChange={e => setFilter(e.target.value)}
          placeholder="Filter by name or ID…" style={{ flex: '1 1 160px', fontSize: 12, padding: '5px 10px' }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{visible.length}</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none', flexShrink: 0 }}>
          <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} style={{ margin: 0 }} />
          Active only
        </label>
        <button className="btn btn-sm" onClick={loadBundles} title="Refresh" disabled={!!busy}>↻</button>
        <button className="btn btn-primary btn-sm" onClick={() => { setInstalling(i => !i); setOpErr(null) }}>
          {installing ? 'Cancel' : '+ Install'}
        </button>
      </div>

      {installing && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input value={installUrl} onChange={e => setInstallUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doInstall()}
            placeholder="mvn:groupId/artifactId/version or file:///path/to/bundle.jar"
            style={{ flex: 1, fontSize: 12, padding: '5px 10px' }} autoFocus />
          <button className="btn btn-primary btn-sm" onClick={doInstall}
            disabled={busy === 'install:' || !installUrl.trim()}>
            {busy === 'install:' ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> : 'Install'}
          </button>
        </div>
      )}

      {opErr && <div className="alert alert-error" style={{ marginBottom: 8, fontSize: 12 }}>{opErr}
        <button onClick={() => setOpErr(null)} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>✕</button>
      </div>}
      {opMsg && <div style={{ marginBottom: 8, fontSize: 12, color: '#4caf50' }}>{opMsg}</div>}

      {loading
        ? <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}><span className="spinner" /></div>
        : err
          ? <div className="alert alert-error">{err}</div>
          : visible.length === 0
            ? <div style={{ padding: '16px 0', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>No bundles</div>
            : <div style={{ overflowY: 'auto', maxHeight: 500 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr auto auto', gap: '4px 10px',
                  fontSize: 11, color: 'var(--text-muted)', padding: '4px 0', borderBottom: '2px solid var(--border)',
                  fontWeight: 600, position: 'sticky', top: 0, background: 'var(--surface)' }}>
                  <span>ID</span><span>Name</span><span>State</span><span>Actions</span>
                </div>
                {visible.map((b, i) => {
                  const isActive = b.state === 'Active'
                  return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '40px 1fr auto auto',
                      gap: '4px 10px', padding: '5px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{b.id}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.name}>{b.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{b.version}</div>
                      </div>
                      <BundleStateBadge state={b.state} />
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        {!isActive && (
                          <button className="btn btn-sm" disabled={!!busy} onClick={() => bundleOp(b.id, 'start')}
                            style={{ fontSize: 10, padding: '2px 6px', color: '#4caf50', borderColor: '#4caf50' }}>
                            {busy === `start:${b.id}` ? <span className="spinner" style={{ width: 8, height: 8, borderWidth: 1.5 }} /> : 'Start'}
                          </button>
                        )}
                        {isActive && (
                          <button className="btn btn-sm" disabled={!!busy} onClick={() => bundleOp(b.id, 'stop')}
                            style={{ fontSize: 10, padding: '2px 6px', color: '#f44336', borderColor: '#f44336' }}>
                            {busy === `stop:${b.id}` ? <span className="spinner" style={{ width: 8, height: 8, borderWidth: 1.5 }} /> : 'Stop'}
                          </button>
                        )}
                        <button className="btn btn-sm" disabled={!!busy} onClick={() => bundleOp(b.id, 'restart')}
                          style={{ fontSize: 10, padding: '2px 6px' }}>
                          {busy === `restart:${b.id}` ? <span className="spinner" style={{ width: 8, height: 8, borderWidth: 1.5 }} /> : '↺'}
                        </button>
                        <button className="btn btn-sm" disabled={!!busy} onClick={() => bundleOp(b.id, 'update')}
                          style={{ fontSize: 10, padding: '2px 6px' }}>
                          {busy === `update:${b.id}` ? <span className="spinner" style={{ width: 8, height: 8, borderWidth: 1.5 }} /> : '↑'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
      }
    </div>
  )
}


function SystemTab({ base, query = '' }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState(null)
  const [envFilter, setEnvFilter] = useState('')
  const [gcBusy,  setGcBusy]  = useState(false)
  const [gcMsg,   setGcMsg]   = useState(null)
  const _q = query ? `?${query}` : ''

  function load() {
    setLoading(true); setErr(null)
    fetch(`${base}/system${_q}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setData(d); else setErr(d.error) })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [base, query])

  function runGc() {
    setGcBusy(true); setGcMsg(null)
    fetch(`${base}/system/gc${_q}`, { method: 'POST' })
      .then(r => r.json())
      .then(d => setGcMsg(d.ok ? 'GC triggered' : (d.error || 'GC failed')))
      .catch(() => setGcMsg('Request failed'))
      .finally(() => setGcBusy(false))
  }

  function InfoRow({ label, value }) {
    return (
      <div style={{ display: 'flex', padding: '5px 0', borderBottom: '1px solid var(--border)', gap: 12 }}>
        <span style={{ width: 220, flexShrink: 0, fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ fontSize: 12, fontFamily: 'monospace', flex: 1 }}>{value || '—'}</span>
      </div>
    )
  }

  function Section({ title, children, defaultOpen = true }) {
    const [open, setOpen] = useState(defaultOpen)
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: open ? 8 : 0 }}>
          <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{title}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
        </div>
        {open && children}
      </div>
    )
  }

  if (loading) return <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}><span className="spinner" /></div>
  if (err) return <div className="card"><div className="alert alert-error">{err}</div><button className="btn btn-sm" onClick={load} style={{ marginTop: 8 }}>Retry</button></div>

  const info = data?.info || {}
  const env  = data?.env  || {}
  const karaf = info['Karaf'] || {}
  const jvm   = info['JVM']   || {}
  const mem   = info['Memory'] || {}
  const thr   = info['Threads'] || {}
  const cls   = info['Classes'] || {}
  const os    = info['Operating system'] || {}

  // Parse memory values for the bar
  const parseKb = s => parseInt((s || '0').replace(/[^0-9]/g, ''), 10) || 0
  const curHeap = parseKb(mem['Current heap size'])
  const comHeap = parseKb(mem['Committed heap size'])
  const maxHeap = parseKb(mem['Maximum heap size'])
  const usedPct = maxHeap ? Math.round(curHeap / maxHeap * 100) : 0
  const comPct  = maxHeap ? Math.round(comHeap / maxHeap * 100) : 0
  const fmtMb   = kb => `${(kb / 1024).toFixed(0)} MB`

  const gcEntries = Object.entries(mem).filter(([k]) => k === 'Garbage collector')

  const envFlt = envFilter.toLowerCase()
  const envVisible = Object.entries(env).filter(([k, v]) => !envFlt || k.toLowerCase().includes(envFlt) || v.toLowerCase().includes(envFlt))

  return (
    <div>
      {/* ── Karaf + JVM ── */}
      <Section title="Karaf / JVM">
        <InfoRow label="Karaf Version"     value={karaf['Karaf version']} />
        <InfoRow label="Karaf Home"        value={karaf['Karaf home']} />
        <InfoRow label="OSGi Framework"    value={karaf['OSGi Framework']} />
        <InfoRow label="Java VM"           value={jvm['Java Virtual Machine']} />
        <InfoRow label="Java Version"      value={jvm['Version']} />
        <InfoRow label="Vendor"            value={jvm['Vendor']} />
        <InfoRow label="PID"               value={jvm['Pid']} />
        <InfoRow label="Uptime"            value={jvm['Uptime']} />
        <InfoRow label="Process CPU Time"  value={jvm['Process CPU time']} />
        <InfoRow label="System CPU Load"   value={jvm['System CPU load']} />
      </Section>

      {/* ── Memory ── */}
      <Section title="Memory">
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
            <span>Heap: {fmtMb(curHeap)} used / {fmtMb(comHeap)} committed / {fmtMb(maxHeap)} max</span>
            <span>{usedPct}%</span>
          </div>
          <div style={{ height: 12, background: 'var(--surface2)', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', height: '100%', width: `${comPct}%`, background: 'rgba(33,150,243,0.25)', borderRadius: 6 }} />
            <div style={{ position: 'absolute', height: '100%', width: `${usedPct}%`,
              background: usedPct > 85 ? '#f44336' : usedPct > 70 ? '#ff9800' : '#4caf50', borderRadius: 6 }} />
          </div>
        </div>
        <InfoRow label="Pending Objects" value={mem['Pending objects']} />
        {gcEntries.map(([, v], i) => <InfoRow key={i} label={`GC ${i+1}`} value={v} />)}
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-sm" onClick={runGc} disabled={gcBusy}>
            {gcBusy ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Running…</> : 'Run Garbage Collection'}
          </button>
          {gcMsg && <span style={{ fontSize: 12, color: gcMsg.includes('triggered') ? '#4caf50' : '#f44336' }}>{gcMsg}</span>}
        </div>
      </Section>

      {/* ── Threads ── */}
      <Section title="Threads">
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', padding: '6px 0' }}>
          {[['Live', thr['Live threads']], ['Daemon', thr['Daemon threads']], ['Peak', thr['Peak']], ['Total Started', thr['Total started']]].map(([l, v]) => (
            <div key={l} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: 'var(--primary)' }}>{v || '—'}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Classes + OS ── */}
      <Section title="Classes / OS">
        <InfoRow label="Current classes loaded"  value={cls['Current classes loaded']} />
        <InfoRow label="Total classes loaded"    value={cls['Total classes loaded']} />
        <InfoRow label="Total classes unloaded"  value={cls['Total classes unloaded']} />
        <InfoRow label="OS"                      value={os['Name']} />
        <InfoRow label="Architecture"            value={os['Architecture']} />
        <InfoRow label="Processors"              value={os['Processors']} />
        <InfoRow label="Total / Free physical memory" value={os['Total physical memory'] ? `${os['Total physical memory']} / ${os['Free physical memory'] || '—'}` : undefined} />
      </Section>

      {/* ── Environment Variables ── */}
      <Section title={`Environment Variables (${envVisible.length})`} defaultOpen={true}>
        <input value={envFilter} onChange={e => setEnvFilter(e.target.value)}
          placeholder="Filter…" style={{ width: '100%', fontSize: 12, padding: '5px 10px', marginBottom: 8 }} />
        <div style={{ overflowY: 'auto', maxHeight: 300 }}>
          {envVisible.map(([k, v], i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={k}>{k}</span>
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v}>{v}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

const LOG_LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR']
const LEVEL_COLOR = { TRACE: '#9e9e9e', DEBUG: '#2196f3', INFO: '#4caf50', WARN: '#ff9800', ERROR: '#f44336' }

function LogTab({ base, query = '' }) {
  const [entries,   setEntries]   = useState([])
  const [loggers,   setLoggers]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [err,       setErr]       = useState(null)
  const [filter,    setFilter]    = useState('')
  const [levelFilter, setLevelFilter] = useState('') // show only this level+
  const [lines,     setLines]     = useState(200)
  const [showLevels, setShowLevels] = useState(false)
  const [setLvlBusy, setSetLvlBusy] = useState(null)
  const [setLvlMsg,  setSetLvlMsg]  = useState(null)
  const _q = query ? `?${query}` : ''
  const _qa = query ? `&${query}` : ''

  function loadLog() {
    setLoading(true); setErr(null)
    fetch(`${base}/log?n=${lines}${_qa}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setEntries(d.entries || []); else setErr(d.error) })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
  }
  function loadLevels() {
    fetch(`${base}/log/levels${_q}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setLoggers(d.loggers || []) })
      .catch(() => {})
  }
  useEffect(() => { loadLog(); loadLevels() }, [base, query])

  function setLevel(logger, level) {
    setSetLvlBusy(logger); setSetLvlMsg(null)
    fetch(`${base}/log/set-level${_q}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logger, level }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setSetLvlMsg(`${logger} → ${level}`); loadLevels() }
        else setSetLvlMsg(`Error: ${d.error}`)
      })
      .catch(() => setSetLvlMsg('Request failed'))
      .finally(() => setSetLvlBusy(null))
  }

  const LEVEL_ORDER = { TRACE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4 }
  const minOrder = levelFilter ? (LEVEL_ORDER[levelFilter] ?? 0) : -1
  const flt = filter.toLowerCase()
  const visible = entries.filter(e => {
    if (minOrder >= 0 && (LEVEL_ORDER[e.level] ?? 0) < minOrder) return false
    if (flt && !e.message.toLowerCase().includes(flt) && !e.thread.toLowerCase().includes(flt)) return false
    return true
  })

  return (
    <div>
      {/* ── Log Levels panel ── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
          onClick={() => setShowLevels(v => !v)}>
          <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>Log Levels</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{showLevels ? '▲' : '▼'}</span>
        </div>
        {showLevels && (
          <div style={{ marginTop: 10 }}>
            {setLvlMsg && <div style={{ marginBottom: 8, fontSize: 12, color: setLvlMsg.startsWith('Error') ? '#f44336' : '#4caf50' }}>{setLvlMsg}</div>}
            <div style={{ overflowY: 'auto', maxHeight: 260 }}>
              {loggers.map((lg, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ flex: 1, fontSize: 12, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={lg.logger}>{lg.logger}</span>
                  <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                    {LOG_LEVELS.map(lvl => {
                      const active = lg.level === lvl
                      const color = LEVEL_COLOR[lvl]
                      return (
                        <button key={lvl} disabled={!!setLvlBusy} onClick={() => setLevel(lg.logger, lvl)}
                          style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${color}`,
                            background: active ? color : 'transparent', color: active ? '#fff' : color,
                            opacity: setLvlBusy === lg.logger ? 0.5 : 1 }}>
                          {lvl}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Log entries ── */}
      <div className="card">
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="Filter message or thread…" style={{ flex: '1 1 160px', fontSize: 12, padding: '5px 10px' }} />
          <select value={levelFilter} onChange={e => setLevelFilter(e.target.value)}
            style={{ fontSize: 12, padding: '5px 8px' }}>
            <option value="">All levels</option>
            {LOG_LEVELS.map(l => <option key={l} value={l}>{l}+</option>)}
          </select>
          <select value={lines} onChange={e => setLines(Number(e.target.value))}
            style={{ fontSize: 12, padding: '5px 8px' }}>
            {[50, 100, 200, 500].map(n => <option key={n} value={n}>Last {n}</option>)}
          </select>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{visible.length}</span>
          <button className="btn btn-sm" onClick={loadLog} disabled={loading} title="Refresh">↻</button>
        </div>

        {loading
          ? <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}><span className="spinner" /></div>
          : err
            ? <div className="alert alert-error">{err}</div>
            : visible.length === 0
              ? <div style={{ padding: '16px 0', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>No log entries</div>
              : <div style={{ overflowY: 'auto', maxHeight: 520, fontFamily: 'monospace', fontSize: 11 }}>
                  {visible.map((e, i) => {
                    const color = LEVEL_COLOR[e.level] || 'var(--text-muted)'
                    return (
                      <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <span style={{ color: 'var(--text-muted)', flexShrink: 0, width: 72 }}>{e.time}</span>
                        <span style={{ color, fontWeight: 600, flexShrink: 0, width: 44 }}>{e.level}</span>
                        <span style={{ color: 'var(--text-muted)', flexShrink: 0, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={e.thread}>[{e.thread}]</span>
                        <span style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11 }}>{e.message}</span>
                      </div>
                    )
                  })}
                </div>
        }
      </div>
    </div>
  )
}

function ConfigurationTab({ base, query = '' }) {
  const [pids,     setPids]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [err,      setErr]      = useState(null)
  const [filter,   setFilter]   = useState('')
  const [editing,  setEditing]  = useState(null)   // pid string
  const [propLoad, setPropLoad] = useState(false)
  const [draft,    setDraft]    = useState({})      // {key: value}
  const [saveErr,  setSaveErr]  = useState(null)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(null)
  const [newKey,   setNewKey]   = useState('')
  const [newVal,   setNewVal]   = useState('')

  const _q = query ? `?${query}` : ''

  function loadPids() {
    setLoading(true); setErr(null)
    fetch(`${base}/configs${_q}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setPids(d.pids || []); else setErr(d.error) })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { loadPids() }, [base, query])

  function openEdit(pid) {
    setEditing(pid); setPropLoad(true); setSaveErr(null); setSaved(null)
    fetch(`${base}/config/${pid}${_q}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setDraft(d.properties || {}); else setSaveErr(d.error) })
      .catch(() => setSaveErr('Could not load config'))
      .finally(() => setPropLoad(false))
  }

  function cancel() { setEditing(null); setDraft({}); setSaveErr(null); setNewKey(''); setNewVal('') }

  function update() {
    setSaving(true); setSaveErr(null)
    fetch(`${base}/config/${editing}${_q}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: draft }),
    })
      .then(r => r.json())
      .then(d => { if (d.ok) { setSaved(editing); cancel() } else setSaveErr(d.error) })
      .catch(() => setSaveErr('Save failed'))
      .finally(() => setSaving(false))
  }

  function setProperty(key, value) { setDraft(p => ({ ...p, [key]: value })) }
  function deleteProperty(key) { setDraft(p => { const n = { ...p }; delete n[key]; return n }) }
  function addProperty() {
    if (!newKey.trim()) return
    setDraft(p => ({ ...p, [newKey.trim()]: newVal }))
    setNewKey(''); setNewVal('')
  }

  const flt = filter.toLowerCase()
  const visible = flt ? pids.filter(p => p.toLowerCase().includes(flt)) : pids

  if (editing) {
    return (
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <button className="btn btn-sm" onClick={cancel} style={{ fontSize: 11 }}>← Back</button>
          <span style={{ fontWeight: 600, fontSize: 13, fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{editing}.cfg</span>
          {saved === editing && <span style={{ fontSize: 11, color: '#4caf50' }}>Saved</span>}
        </div>

        {saveErr && <div className="alert alert-error" style={{ marginBottom: 10, fontSize: 12 }}>{saveErr}</div>}

        {propLoad
          ? <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}><span className="spinner" /></div>
          : <>
              <div style={{ overflowY: 'auto', maxHeight: 400, marginBottom: 10 }}>
                {Object.entries(draft).map(([k, v]) => (
                  <div key={k} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6, padding: '4px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={k}>{k}</span>
                    <input value={v} onChange={e => setProperty(k, e.target.value)}
                      style={{ fontSize: 12, padding: '3px 6px', width: '100%' }} />
                    <button onClick={() => deleteProperty(k)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f44336', fontSize: 14, padding: '0 4px' }}>✕</button>
                  </div>
                ))}
                {Object.keys(draft).length === 0 && <div style={{ padding: '12px 0', color: 'var(--text-muted)', fontSize: 13 }}>No properties</div>}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
                <input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="New key"
                  style={{ fontSize: 12, padding: '4px 6px' }} onKeyDown={e => e.key === 'Enter' && addProperty()} />
                <input value={newVal} onChange={e => setNewVal(e.target.value)} placeholder="Value"
                  style={{ fontSize: 12, padding: '4px 6px' }} onKeyDown={e => e.key === 'Enter' && addProperty()} />
                <button className="btn btn-sm" onClick={addProperty} disabled={!newKey.trim()}>+ Add</button>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button className="btn btn-primary btn-sm" onClick={update} disabled={saving}>
                  {saving ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Saving…</> : 'Update'}
                </button>
                <button className="btn btn-sm" onClick={cancel}>Cancel</button>
              </div>
            </>
        }
      </div>
    )
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <input value={filter} onChange={e => setFilter(e.target.value)}
          placeholder="Filter configurations…" style={{ flex: 1, fontSize: 12, padding: '5px 10px' }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{visible.length}</span>
        <button className="btn btn-sm" onClick={loadPids} title="Refresh" disabled={loading}>↻</button>
      </div>

      {saved && <div style={{ marginBottom: 8, fontSize: 12, color: '#4caf50' }}>Saved: {saved}</div>}

      {loading
        ? <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}><span className="spinner" /></div>
        : err
          ? <div className="alert alert-error">{err}</div>
          : <div style={{ overflowY: 'auto', maxHeight: 520 }}>
              {visible.map((pid, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ flex: 1, fontSize: 12, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pid}>{pid}</span>
                  <button className="btn btn-sm" onClick={() => openEdit(pid)} style={{ fontSize: 11, padding: '2px 10px' }}>Edit</button>
                </div>
              ))}
              {visible.length === 0 && <div style={{ padding: '16px 0', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>No configurations</div>}
            </div>
      }
    </div>
  )
}

function PackageTab({ base, query = '' }) {
  const [packages,     setPackages]     = useState([])
  const [loading,      setLoading]      = useState(true)
  const [err,          setErr]          = useState(null)
  const [filter,       setFilter]       = useState('')
  const [showExports,  setShowExports]  = useState(true)
  const [showImports,  setShowImports]  = useState(true)
  const _q = query ? `?${query}` : ''

  function loadPackages() {
    setLoading(true); setErr(null)
    fetch(`${base}/packages${_q}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setPackages(d.packages || []); else setErr(d.error) })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { loadPackages() }, [base, query])

  const flt = filter.toLowerCase()
  const visible = packages.filter(p => {
    if (p.type === 'export' && !showExports) return false
    if (p.type === 'import' && !showImports) return false
    if (flt && !p.package.toLowerCase().includes(flt) && !p.bundle.toLowerCase().includes(flt)) return false
    return true
  })

  const exports = packages.filter(p => p.type === 'export').length
  const imports = packages.filter(p => p.type === 'import').length

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={filter} onChange={e => setFilter(e.target.value)}
          placeholder="Filter by package or bundle…"
          style={{ flex: '1 1 160px', fontSize: 12, padding: '5px 10px' }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{visible.length}</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', userSelect: 'none',
          color: showExports ? '#4caf50' : 'var(--text-muted)' }}>
          <input type="checkbox" checked={showExports} onChange={e => setShowExports(e.target.checked)} style={{ margin: 0 }} />
          Exports ({exports})
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', userSelect: 'none',
          color: showImports ? '#2196f3' : 'var(--text-muted)' }}>
          <input type="checkbox" checked={showImports} onChange={e => setShowImports(e.target.checked)} style={{ margin: 0 }} />
          Imports ({imports})
        </label>
        <button className="btn btn-sm" onClick={loadPackages} title="Refresh" disabled={loading}>↻</button>
      </div>

      {loading
        ? <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}><span className="spinner" /></div>
        : err
          ? <div className="alert alert-error">{err}</div>
          : visible.length === 0
            ? <div style={{ padding: '16px 0', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>No packages</div>
            : <div style={{ overflowY: 'auto', maxHeight: 520 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr auto auto', gap: '4px 10px',
                  fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, padding: '4px 0',
                  borderBottom: '2px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)' }}>
                  <span>Type</span><span>Package</span><span>Version</span><span>Bundle ID</span>
                </div>
                {visible.map((p, i) => {
                  const isExport = p.type === 'export'
                  const color = isExport ? '#4caf50' : '#2196f3'
                  return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '52px 1fr auto auto',
                      gap: '4px 10px', padding: '5px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, textAlign: 'center',
                        background: color + '20', color, border: `1px solid ${color}50` }}>
                        {isExport ? 'Export' : 'Import'}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={p.package}>{p.package}</div>
                        {p.bundle && <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={p.bundle}>{p.bundle}</div>}
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{p.version}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{p.id}</span>
                    </div>
                  )
                })}
              </div>
      }
    </div>
  )
}

function ServiceTab({ base, query = '' }) {
  const [services, setServices] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [err,      setErr]      = useState(null)
  const [filter,   setFilter]   = useState('')
  const _q = query ? `?${query}` : ''

  function loadServices() {
    setLoading(true); setErr(null)
    fetch(`${base}/services${_q}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setServices(d.services || []); else setErr(d.error) })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { loadServices() }, [base, query])

  const flt = filter.toLowerCase()
  const visible = flt
    ? services.filter(s =>
        s.objectClass.toLowerCase().includes(flt) ||
        s.bundle.toLowerCase().includes(flt) ||
        s.id.includes(flt))
    : services

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <input value={filter} onChange={e => setFilter(e.target.value)}
          placeholder="Filter by interface, bundle or ID…"
          style={{ flex: 1, fontSize: 12, padding: '5px 10px' }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{visible.length}</span>
        <button className="btn btn-sm" onClick={loadServices} title="Refresh" disabled={loading}>↻</button>
      </div>

      {loading
        ? <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}><span className="spinner" /></div>
        : err
          ? <div className="alert alert-error">{err}</div>
          : visible.length === 0
            ? <div style={{ padding: '16px 0', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>No services</div>
            : <div style={{ overflowY: 'auto', maxHeight: 520 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: '4px 10px',
                  fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, padding: '4px 0',
                  borderBottom: '2px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)' }}>
                  <span>ID</span><span>Object Class</span><span>Bundle</span>
                </div>
                {visible.map((s, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '40px 1fr auto',
                    gap: '4px 10px', padding: '5px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{s.id}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={s.objectClass}>{s.objectClass}</div>
                      {s.component && <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.component}</div>}
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {s.bundle_id && `bundle ${s.bundle_id}`}
                    </span>
                  </div>
                ))}
              </div>
      }
    </div>
  )
}

export function KarafRightPanel({ base, query = '' }) {
  const [tab, setTab] = useState('system')
  function tabBtn(key, label) {
    const active = tab === key
    return (
      <button onClick={() => setTab(key)} style={{
        padding: '6px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12,
        fontWeight: active ? 600 : 400, color: active ? 'var(--primary)' : 'var(--text-muted)',
        borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
        marginBottom: -1, whiteSpace: 'nowrap',
      }}>{label}</button>
    )
  }
  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 14, overflowX: 'auto' }}>
        {tabBtn('system',  'System')}
        {tabBtn('repo',    'Feature Repo')}
        {tabBtn('feature', 'Feature')}
        {tabBtn('bundle',  'Bundle')}
        {tabBtn('service', 'Service')}
        {tabBtn('package', 'Package')}
        {tabBtn('config',  'Configuration')}
        {tabBtn('log',     'Log')}
      </div>
      {tab === 'system'  && <SystemTab base={base} query={query} />}
      {tab === 'repo'    && <FeatureRepoTab base={base} query={query} />}
      {tab === 'feature' && <FeatureTab base={base} query={query} />}
      {tab === 'bundle'  && <BundleTab base={base} query={query} />}
      {tab === 'service' && <ServiceTab base={base} query={query} />}
      {tab === 'package' && <PackageTab base={base} query={query} />}
      {tab === 'config'  && <ConfigurationTab base={base} query={query} />}
      {tab === 'log'     && <LogTab base={base} query={query} />}
    </div>
  )
}

export function AppServerTab({ appName, displayName, serverType }) {
  const on = usePanels()
  const [serverStatus, setServerStatus] = useState(null)
  const [opStatus,     setOpStatus]     = useState(null)
  const [opOutput,     setOpOutput]     = useState('')
  const [opKind,       setOpKind]       = useState(null)
  const [opErr,        setOpErr]        = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [logSignal,    setLogSignal]    = useState(0)
  const termRef = useRef(null)

  function fetchStatus() {
    fetch(`/api/local-app/${appName}/server-status`)
      .then(r => r.json())
      .then(d => { if (d.ok) setServerStatus(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 4000)
    return () => clearInterval(id)
  }, [appName])

  useEffect(() => {
    if (opStatus !== 'running') return
    const id = setInterval(() => {
      fetch(`/api/local-app/${appName}/server-op-status`)
        .then(r => r.json())
        .then(d => {
          setOpOutput(d.output || d.error || '')
          if (d.status !== 'running') {
            setOpStatus(d.status)
            if (d.error && d.status === 'failed') setOpErr(d.error)
            fetchStatus()
          }
        })
        .catch(() => {})
    }, 800)
    return () => clearInterval(id)
  }, [opStatus, appName])

  useEffect(() => {
    if (opStatus !== 'success' || opKind !== 'start') return
    const ids = [
      setTimeout(fetchStatus, 3000),
      setTimeout(fetchStatus, 8000),
      setTimeout(fetchStatus, 15000),
      setTimeout(fetchStatus, 25000),
      setTimeout(fetchStatus, 40000),
      setTimeout(fetchStatus, 60000),
      setTimeout(fetchStatus, 90000),
    ]
    return () => ids.forEach(clearTimeout)
  }, [opStatus, opKind])

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [opOutput])

  function runOp(operation) {
    setOpKind(operation); setOpStatus('running'); setOpOutput(''); setOpErr(null)
    setLogSignal(n => n + 1)
    fetch(`/api/local-app/${appName}/server-op`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation }),
    })
      .then(r => r.json())
      .then(d => { if (!d.ok) { setOpErr(d.error); setOpStatus(null) } })
      .catch(() => { setOpErr('Could not reach server'); setOpStatus(null) })
  }

  const serverUp = serverStatus?.[appName] ?? serverStatus?.running ?? false
  const busy     = opStatus === 'running'

  return (
    <div>
      {on('as_banner') && <DeployedBanner appName={appName} />}

      {/* ── Status banner ── */}
      {on('as_status') && (
      <div className="card" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '10px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>App Server</span>
          {serverType && (
            <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, background: 'var(--surface2)',
              color: 'var(--text-muted)', border: '1px solid var(--border)', fontWeight: 500 }}>
              {({'karaf': 'Karaf', 'weblogic': 'WebLogic', 'tomcat': 'Tomcat'}[serverType?.toLowerCase()] || serverType)}
            </span>
          )}
          {loading
            ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
            : <StatusBadge running={serverUp} />}
          {serverUp && serverStatus?.debug && (
            <span title="JVM started with the JDWP debug agent (startServer -d)"
              style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, background: '#f3e5f5', color: '#7b1fa2', border: '1px solid #ce93d8', fontWeight: 600 }}>🐞 Debug Mode</span>
          )}
        </div>

        {opErr && <div className="alert alert-error" style={{ margin: 0, padding: '4px 10px', fontSize: 12 }}>{opErr}</div>}

        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          {!serverUp ? (
            <>
            <button className="btn btn-primary btn-sm" onClick={() => runOp('start')} disabled={busy}>
              {busy && opKind === 'start'
                ? <><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> Starting…</>
                : '▶ Start'}
            </button>
            {serverType === 'tomcat' && (
              <button className="btn btn-sm" onClick={() => runOp('start_debug')} disabled={busy}
                title="export DEBUG=true, then startServer -d"
                style={{ color: '#7b1fa2', borderColor: '#7b1fa2' }}>
                {busy && opKind === 'start_debug'
                  ? <><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> Starting (debug)…</>
                  : '🐞 Start in Debug Mode'}
              </button>
            )}
            </>
          ) : (
            <>
              <button className="btn btn-sm" onClick={() => runOp('stop')} disabled={busy}
                style={{ color: '#f44336', borderColor: '#f44336' }}>
                {busy && opKind === 'stop'
                  ? <><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> Stopping…</>
                  : '⏹ Stop'}
              </button>
              <button className="btn btn-sm" onClick={() => runOp('restart')} disabled={busy}
                style={{ color: '#ff9800', borderColor: '#ff9800' }}>
                {busy && opKind === 'restart'
                  ? <><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> Restarting…</>
                  : '↺ Restart'}
              </button>
            </>
          )}
        </div>
      </div>
      )}

      {/* ── Op output (shown when active) ── */}
      {opKind !== 'stop' && opKind !== 'start_debug' && !(['start', 'restart'].includes(opKind) && serverType === 'tomcat') && (opStatus || opOutput) && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
            {opKind && opKind.charAt(0).toUpperCase() + opKind.slice(1)} output
            {opStatus === 'running' && <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />}
            {opStatus === 'success' && <span style={{ color: '#4caf50' }}>✓ Done</span>}
            {opStatus === 'failed'  && <span style={{ color: '#f44336' }}>✗ Failed</span>}
            {opStatus !== 'running' && (
              <button onClick={() => { setOpStatus(null); setOpOutput(''); setOpKind(null) }}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1, padding: '0 2px' }}>✕</button>
            )}
          </div>
          <ColoredTerminal output={opOutput} termRef={termRef} height={180} fontSize={12} />
        </div>
      )}

      {/* ── Full-width panel ── */}
      {on('as_server') && (serverType === 'karaf'
        ? <KarafRightPanel base={`/api/local-app/${appName}/karaf`} />
        : serverType === 'tomcat'
        ? <TomcatRightPanel
            base={`/api/local-app/${appName}/tomcat`}
            query=""
            propertiesPanel={<RuntimePropertiesPanel appName={appName} />}
            logSignal={logSignal}
            opOutput={['start', 'restart'].includes(opKind) ? '' : opOutput} opKind={['start', 'restart'].includes(opKind) ? null : opKind} opStatus={['start', 'restart'].includes(opKind) ? null : opStatus}
          />
        : <RuntimePropertiesPanel appName={appName} />)}
    </div>
  )
}

// ── Database Tab ──────────────────────────────────────────────────────────────


function TableStructureModal({ appName, schema, table, onClose, onInsert }) {
  const [navStack, setNavStack] = useState([{ schema, table }])
  const current = navStack[navStack.length - 1]

  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState(null)

  useEffect(() => {
    setData(null); setErr(null); setLoading(true)
    fetch(`/api/local-app/${appName}/db/table-structure?schema=${encodeURIComponent(current.schema)}&table=${encodeURIComponent(current.table)}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setData(d); else setErr(d.error) })
      .catch(() => setErr('Request failed'))
      .finally(() => setLoading(false))
  }, [appName, current.schema, current.table])

  function navigateTo(refSchema, refTable) {
    setNavStack(prev => [...prev, { schema: refSchema, table: refTable }])
  }

  const thStyle = { padding: '5px 10px', textAlign: 'left', borderBottom: '2px solid var(--border)',
    fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap', color: 'var(--text)', background: 'var(--surface)' }
  const tdStyle = { padding: '4px 10px', borderBottom: '1px solid var(--border)', fontSize: 11,
    fontFamily: 'monospace', whiteSpace: 'nowrap', color: 'var(--text)' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)',
        minWidth: 680, maxWidth: '90vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
          {navStack.length > 1 && (
            <button onClick={() => setNavStack(prev => prev.slice(0, -1))} className="btn btn-sm"
              style={{ padding: '2px 8px', fontSize: 11, flexShrink: 0 }}>← Back</button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, flexWrap: 'wrap', minWidth: 0 }}>
            {navStack.map((entry, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {i > 0 && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>›</span>}
                <span style={{
                  fontWeight: i === navStack.length - 1 ? 700 : 400,
                  fontSize: 12, fontFamily: 'monospace',
                  color: i === navStack.length - 1 ? 'var(--text)' : 'var(--primary)',
                  cursor: i < navStack.length - 1 ? 'pointer' : 'default',
                  textDecoration: i < navStack.length - 1 ? 'underline' : 'none',
                }}
                onClick={() => i < navStack.length - 1 && setNavStack(navStack.slice(0, i + 1))}>
                  {entry.schema}.{entry.table}
                </span>
              </span>
            ))}
          </div>
          <button onClick={() => onInsert(`SELECT * FROM ${current.schema}.${current.table} WHERE ROWNUM <= 100`)}
            style={{ fontSize: 11, padding: '2px 10px', flexShrink: 0 }} className="btn btn-sm">SELECT 100</button>
          <button onClick={() => onInsert(`SELECT COUNT(*) FROM ${current.schema}.${current.table}`)}
            style={{ fontSize: 11, padding: '2px 10px', flexShrink: 0 }} className="btn btn-sm">COUNT(*)</button>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16,
              color: 'var(--text-muted)', padding: '0 4px', lineHeight: 1, flexShrink: 0 }}>✕</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading && <div style={{ padding: 24, textAlign: 'center' }}><span className="spinner" /></div>}
          {err    && <div style={{ padding: 16, color: '#c62828', fontSize: 12 }}>{err}</div>}
          {data   && (
            <>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 'max-content' }}>
                <thead>
                  <tr>
                    {['Column', 'Type', 'Nullable', 'Default', 'PK', 'FK → References'].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.columns.map((col, i) => {
                    const pk = data.pk_cols.includes(col.name)
                    const fk = data.fk_map[col.name]
                    return (
                      <tr key={i} style={{ background: pk ? 'rgba(255,193,7,0.07)' : i % 2 === 0 ? 'transparent' : 'rgba(128,128,128,0.03)' }}>
                        <td style={{ ...tdStyle, fontWeight: pk ? 700 : 400 }}>{col.name}</td>
                        <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>
                          {col.type}{col.precision ? `(${col.precision}${col.scale ? ',' + col.scale : ''})` : col.length ? `(${col.length})` : ''}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          {col.nullable === 'Y' ? <span style={{ color: 'var(--text-muted)' }}>✓</span> : <span style={{ color: '#c62828', fontWeight: 700 }}>✕</span>}
                        </td>
                        <td style={{ ...tdStyle, color: 'var(--text-muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {col.default_val || ''}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          {pk && <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 13 }} title="Primary Key">🔑</span>}
                        </td>
                        <td style={{ ...tdStyle, fontSize: 10 }}>
                          {fk ? (
                            <span onClick={() => navigateTo(fk.ref_schema, fk.ref_table)}
                              style={{ color: '#1d4ed8', cursor: 'pointer', textDecoration: 'underline' }}
                              title={`View structure of ${fk.ref_schema}.${fk.ref_table}`}>
                              {fk.ref_schema}.{fk.ref_table}.{fk.ref_col}
                            </span>
                          ) : ''}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {data.indexes?.length > 0 && (
                <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>INDEXES</div>
                  {data.indexes.map((idx, i) => (
                    <div key={i} style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', marginBottom: 2 }}>
                      <span style={{ color: 'var(--text)', fontWeight: 600 }}>{idx.name}</span>
                      {idx.uniqueness === 'UNIQUE' && <span style={{ color: '#2e7d32', marginLeft: 6 }}>UNIQUE</span>}
                      <span style={{ marginLeft: 8 }}>({idx.columns.join(', ')})</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SchemaNode({ appName, schema, onInsert }) {
  const [open,        setOpen]        = useState(false)
  const [tables,      setTables]      = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [err,         setErr]         = useState(null)
  const [openTbl,     setOpenTbl]     = useState({})
  const [cols,        setCols]        = useState({})
  const [colLoad,     setColLoad]     = useState({})
  const [tableFilter, setTableFilter] = useState('')
  const [ctxMenu,     setCtxMenu]     = useState(null)
  const [structModal, setStructModal] = useState(null)

  useEffect(() => {
    if (!ctxMenu) return
    const dismiss = () => setCtxMenu(null)
    window.addEventListener('click', dismiss)
    window.addEventListener('contextmenu', dismiss)
    return () => { window.removeEventListener('click', dismiss); window.removeEventListener('contextmenu', dismiss) }
  }, [ctxMenu])

  function toggleSchema() {
    if (!open && tables === null) {
      setLoading(true); setErr(null)
      fetch(`/api/local-app/${appName}/db/tables?schema=${encodeURIComponent(schema)}`)
        .then(r => r.json())
        .then(d => { if (d.ok) setTables(d.tables); else setErr(d.error) })
        .catch(() => setErr('Failed'))
        .finally(() => setLoading(false))
    }
    setOpen(o => !o)
  }

  function toggleTable(tbl) {
    const nowOpen = !openTbl[tbl]
    setOpenTbl(p => ({ ...p, [tbl]: nowOpen }))
    if (nowOpen && !cols[tbl]) {
      setColLoad(p => ({ ...p, [tbl]: true }))
      fetch(`/api/local-app/${appName}/db/columns?schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(tbl)}`)
        .then(r => r.json())
        .then(d => { if (d.ok) setCols(p => ({ ...p, [tbl]: d.columns })) })
        .catch(() => {})
        .finally(() => setColLoad(p => ({ ...p, [tbl]: false })))
    }
  }

  return (
    <div>
      <div onClick={toggleSchema} style={{
        display: 'flex', alignItems: 'center', gap: 5, padding: '5px 8px',
        cursor: 'pointer', fontWeight: 600, fontSize: 12, color: 'var(--primary, #3b82f6)',
        background: 'var(--surface-2, var(--surface))', borderBottom: '1px solid var(--border)',
        userSelect: 'none',
      }}>
        <span>{open ? '▼' : '▶'}</span>
        <span style={{ fontFamily: 'monospace' }}>{schema}</span>
        {loading && <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />}
      </div>
      {err && <div style={{ fontSize: 11, color: '#f44336', padding: '4px 16px' }}>{err}</div>}
      {open && tables && (
        <div style={{ padding: '5px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <input type="text" value={tableFilter} onChange={e => setTableFilter(e.target.value)}
            placeholder="Filter tables…"
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 11, padding: '3px 7px', borderRadius: 4,
              border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', outline: 'none' }} />
        </div>
      )}
      {ctxMenu && (
        <div style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 1500,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)', minWidth: 200, fontSize: 12 }}
          onClick={e => e.stopPropagation()}>
          <div style={{ padding: '4px 0' }}>
            {[
              { label: '🔍 View Structure', action: () => { setStructModal(ctxMenu.tbl); setCtxMenu(null) } },
              { label: '▷  SELECT 100 rows', action: () => { onInsert(`SELECT * FROM ${schema}.${ctxMenu.tbl} WHERE ROWNUM <= 100`); setCtxMenu(null) } },
              { label: '📊 COUNT rows', action: () => { onInsert(`SELECT COUNT(*) FROM ${schema}.${ctxMenu.tbl}`); setCtxMenu(null) } },
              { label: '✏️  INSERT template', action: () => {
                const tblCols = cols[ctxMenu.tbl]
                const colList = tblCols ? tblCols.map(c => c.name).join(', ') : 'col1, col2'
                const valList = tblCols ? tblCols.map(() => 'NULL').join(', ') : 'val1, val2'
                onInsert(`INSERT INTO ${schema}.${ctxMenu.tbl} (${colList})\nVALUES (${valList})`)
                setCtxMenu(null)
              }},
            ].map(item => (
              <div key={item.label} onClick={item.action}
                style={{ padding: '7px 14px', cursor: 'pointer', color: 'var(--text)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(59,130,246,0.1)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                {item.label}
              </div>
            ))}
          </div>
        </div>
      )}
      {structModal && (
        <TableStructureModal appName={appName} schema={schema} table={structModal}
          onClose={() => setStructModal(null)}
          onInsert={text => { onInsert(text); setStructModal(null) }} />
      )}
      {open && tables && tables
        .filter(tbl => !tableFilter.trim() || tbl.toLowerCase().includes(tableFilter.toLowerCase()))
        .map(tbl => (
          <div key={tbl}>
            <div onClick={() => toggleTable(tbl)}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, tbl }) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '4px 16px',
                cursor: 'pointer', fontSize: 12, userSelect: 'none',
                borderBottom: '1px solid var(--border)',
                background: openTbl[tbl] ? 'rgba(59,130,246,0.06)' : 'transparent',
              }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{openTbl[tbl] ? '▼' : '▶'}</span>
              <span style={{ fontFamily: 'monospace', flex: 1 }} title={tbl}>{tbl}</span>
              <span onClick={e => { e.stopPropagation(); onInsert(`SELECT * FROM ${schema}.${tbl} WHERE ROWNUM <= 100`) }}
                style={{ fontSize: 10, color: 'var(--primary)', cursor: 'pointer', flexShrink: 0 }}
                title="Insert SELECT into editor">▷</span>
              {colLoad[tbl] && <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} />}
            </div>
            {openTbl[tbl] && cols[tbl] && cols[tbl].map(col => (
              <div key={col.name} onClick={() => onInsert(col.name)} style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '2px 30px', fontSize: 11, cursor: 'pointer',
                borderBottom: '1px solid var(--border)', color: 'var(--text-muted)',
              }} title={`${col.type}${col.length ? '(' + col.length + ')' : ''} ${col.nullable === 'Y' ? 'NULL' : 'NOT NULL'}`}>
                <span style={{ fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.name}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{col.type}</span>
              </div>
            ))}
          </div>
        ))}
    </div>
  )
}

// ── Database tab: one connection (schema) at a time - payor_oltp, payor_dw, ... from database_config.xlsx ──
export function DatabaseTab(props) {
  const { appName } = props
  const [conns, setConns] = useState(null)
  const [conn, setConn] = useKept(`dbconn_${appName}`, '')
  const [cfgOpen, setCfgOpen] = useState(false)
  installDbFetch()
  const load = () => fetch(`/api/local-app/${appName}/db/connections`).then(r => r.json()).then(r => setConns(r.ok ? r.connections : [])).catch(() => setConns([]))
  useEffect(() => { load(); return () => setDbConn('') }, [appName])
  const eff = conns && conns.length ? (conns.find(c => c.name === conn)?.name || conns[0].name) : ''
  setDbConn(eff)
  if (conns === null) return <div className="card"><span className="spinner" /></div>
  return (
    <div>
      {conns.length > 0 || appName === 'payor' ? <ConnBar label="Schema" conns={conns} value={eff} onChange={setConn} onGear={() => setCfgOpen(v => !v)} gearOn={cfgOpen} /> : null}
      {cfgOpen && <ConnConfigPanel base={`/api/local-app/${appName}`} kind="database" title="Database" onSaved={load} />}
      <DatabaseTabInner key={eff} {...props} />
    </div>
  )
}

function DatabaseTabInner({ appName, displayName }) {
  const [connected,  setConnected]  = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connErr,    setConnErr]    = useState(null)
  const [connInfo,   setConnInfo]   = useState(null)
  const [schemas,    setSchemas]    = useState([])

  const [svcStatus,  setSvcStatus]  = useState(null)
  const [dbUp,       setDbUp]       = useState(null)
  const [svcBusy,    setSvcBusy]    = useState(false)
  const [svcErr,     setSvcErr]     = useState(null)

  function refreshSvcStatus() {
    fetch(`/api/local-app/${appName}/db/service-status`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setSvcStatus(d.service)
          setDbUp(d.db_up)
          setSvcErr(d.service === 'unknown' && !d.db_up ? `Service "${d.service_name || 'OracleServiceDB19C'}" not found` : null)
        }
      })
      .catch(() => {})
  }

  function startDb() {
    setSvcBusy(true); setSvcErr(null)
    fetch(`/api/local-app/${appName}/db/start`, { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (!d.ok) setSvcErr(d.error); setTimeout(refreshSvcStatus, 2000) })
      .catch(() => setSvcErr('Could not reach server'))
      .finally(() => setSvcBusy(false))
  }

  function stopDb() {
    setSvcBusy(true); setSvcErr(null)
    fetch(`/api/local-app/${appName}/db/stop`, { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (!d.ok) setSvcErr(d.error); setTimeout(refreshSvcStatus, 2000) })
      .catch(() => setSvcErr('Could not reach server'))
      .finally(() => setSvcBusy(false))
  }

  useEffect(() => { refreshSvcStatus() }, [appName])

  const [activeTab,  setActiveTab]  = useState('')     // sheet (tab) name in SQL_Queries\Local\<App>\<Version>\<App>_<Version>_Queries.xlsx
  const [results,    setResults]    = useState({})
  const [executing,  setExecuting]  = useState({})
  const [execErr,    setExecErr]    = useState({})
  const [version,    setVersion]    = useState(null)
  const queryPanel   = useRef(null)

  const [editedCells, setEditedCells] = useState({})
  const [editingCell, setEditingCell] = useState(null)
  const [newRows,     setNewRows]     = useState({})
  const [keyCol,      setKeyCol]      = useState({})
  const [commitTable, setCommitTable] = useState({})
  const [commitBusy,  setCommitBusy]  = useState(false)
  const [commitMsg,   setCommitMsg]   = useState(null)
  const [commitErr,   setCommitErr]   = useState(null)

  function connect() {
    setConnecting(true); setConnErr(null)
    fetch(`/api/local-app/${appName}/db/connect`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setConnected(true); setConnInfo(d); loadSchemas() }
        else setConnErr(d.error || 'Connection failed')
      })
      .catch(() => setConnErr('Could not reach server'))
      .finally(() => setConnecting(false))
  }

  function loadSchemas() {
    fetch(`/api/local-app/${appName}/db/schemas`)
      .then(r => r.json())
      .then(d => { if (d.ok) setSchemas(d.schemas) })
      .catch(() => {})
  }

  useEffect(() => {
    // the app version names the workbook: SQL_Queries\Local\<App>\<Version>\<App>_<Version>_Queries.xlsx
    fetch(`/api/local-app/${appName}/current-branch`).then(r => r.json())
      .then(d => setVersion((d.ok && d.release_ver) ? String(d.release_ver) : ''))
      .catch(() => setVersion(''))
  }, [appName])

  useEffect(() => { connect() }, [appName])

  // Runs sql for the given tab and shows its result there; resolves true when it executed without error.
  function executeQuery(sql, tab) {
    if (!sql || !connected) return Promise.resolve(false)
    setExecuting(p => ({ ...p, [tab]: true }))
    setExecErr(p => ({ ...p, [tab]: null }))
    setResults(p => ({ ...p, [tab]: null }))
    setNewRows(p => ({ ...p, [tab]: [] }))
    return fetch(`/api/local-app/${appName}/db/execute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setResults(p => ({ ...p, [tab]: { ...d, sql } }))
          const m = sql.match(/\bFROM\s+(["'\w.]+)/i)
          if (m) setCommitTable(p => ({ ...p, [tab]: m[1].replace(/['"]/g, '') }))
          return true
        }
        setExecErr(p => ({ ...p, [tab]: d.error }))
        return false
      })
      .catch(() => { setExecErr(p => ({ ...p, [tab]: 'Request failed' })); return false })
      .finally(() => setExecuting(p => ({ ...p, [tab]: false })))
  }

  function insertIntoEditor(text) { queryPanel.current && queryPanel.current.insert(text) }

  function triggerDownload(content, filename, mime) {
    const blob = new Blob([content], { type: mime })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  function exportResults(fmt) {
    if (!result || !result.columns.length) return
    const { columns, rows } = result
    const esc = v => (v === null ? '' : String(v))
    const q   = v => `"${esc(v).replace(/"/g, '""')}"`
    if (fmt === 'csv') {
      const lines = [columns.map(q).join(',')]
      rows.forEach(r => lines.push(r.map(v => q(v)).join(',')))
      triggerDownload(lines.join('\r\n'), 'query_result.csv', 'text/csv')
    } else if (fmt === 'txt') {
      const lines = [columns.join('\t')]
      rows.forEach(r => lines.push(r.map(esc).join('\t')))
      triggerDownload(lines.join('\r\n'), 'query_result.txt', 'text/plain')
    } else if (fmt === 'sql') {
      const tbl   = (() => { const m = (result.sql || '').match(/\bFROM\s+(["'\w.]+)/i); return m ? m[1].replace(/['"]/g, '') : 'table_name' })()
      const lines = rows.map(r => {
        const vals = r.map(v => v === null ? 'NULL' : typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`)
        return `INSERT INTO ${tbl} (${columns.join(', ')}) VALUES (${vals.join(', ')});`
      })
      triggerDownload(lines.join('\n'), 'query_result.sql', 'text/plain')
    } else if (fmt === 'xls' || fmt === 'xlsx') {
      fetch(`/api/local-app/${appName}/db/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columns, rows, format: fmt }),
      })
        .then(r => {
          if (!r.ok) return r.json().then(d => { throw new Error(d.error || 'Export failed') })
          return r.blob()
        })
        .then(blob => {
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url; a.download = `query_result.${fmt}`; a.click()
          URL.revokeObjectURL(url)
        })
        .catch(err => alert(err.message))
    }
  }

  function doCommit() {
    if (!result) return
    const table = (commitTable[activeTab] || '').trim()
    if (!table) { setCommitErr('Enter the target table name in the Table field before committing.'); return }
    const ki        = keyCol[activeTab] ?? 0
    const tabPrefix = `${activeTab}:`
    const changes   = []
    const touched   = new Set(
      Object.keys(editedCells).filter(k => k.startsWith(tabPrefix)).map(k => Number(k.split(':')[1]))
    )
    touched.forEach(ri => {
      const original = result.rows[ri]
      const updated  = original.map((cell, ci) => {
        const key = `${activeTab}:${ri}:${ci}`
        return key in editedCells ? (editedCells[key] === '' ? null : editedCells[key]) : cell
      })
      changes.push({ original, updated, keyIndex: ki })
    })
    const inserts = (newRows[activeTab] || []).map(row => ({ values: row.map(v => v === '' ? null : v) }))
    setCommitBusy(true); setCommitErr(null); setCommitMsg(null)
    fetch(`/api/local-app/${appName}/db/commit-edits`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, columns: result.columns, changes, inserts }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setEditedCells(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(tabPrefix))))
          setNewRows(prev => ({ ...prev, [activeTab]: [] }))
          setCommitMsg(`Committed ${d.committed} row(s) — refreshing…`)
          executeQuery(result.sql, activeTab)
          setTimeout(() => setCommitMsg(null), 3000)
        } else {
          setCommitErr(d.error || 'Commit failed')
        }
      })
      .catch(() => setCommitErr('Request failed'))
      .finally(() => setCommitBusy(false))
  }

  function discardEdits() {
    const tabPrefix = `${activeTab}:`
    setEditedCells(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(tabPrefix))))
    setNewRows(prev => ({ ...prev, [activeTab]: [] }))
    setCommitMsg(null); setCommitErr(null)
  }

  function addNewRow() {
    if (!result) return
    setNewRows(prev => ({ ...prev, [activeTab]: [...(prev[activeTab] || []), result.columns.map(() => '')] }))
  }

  function removeNewRow(ni) {
    setNewRows(prev => ({ ...prev, [activeTab]: (prev[activeTab] || []).filter((_, i) => i !== ni) }))
  }

  function updateNewCell(ni, ci, val) {
    setNewRows(prev => {
      const rows = [...(prev[activeTab] || [])]
      rows[ni] = rows[ni].map((v, i) => i === ci ? val : v)
      return { ...prev, [activeTab]: rows }
    })
  }

  const result     = results[activeTab]
  const busy       = executing[activeTab]
  const eErr       = execErr[activeTab]
  const tabPrefix  = `${activeTab}:`
  const tabNewRows = newRows[activeTab] || []
  const hasEdits   = Object.keys(editedCells).some(k => k.startsWith(tabPrefix)) || tabNewRows.length > 0

  return (
    <div>
      {/* Top bar: deployed info + DB status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <DeployedBanner appName={appName} noMargin />
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '5px 14px', borderRadius: 8, marginBottom: 0,
          background: (svcStatus === 'running' || dbUp) ? 'rgba(76,175,80,0.07)' : svcStatus === 'stopped' ? 'rgba(244,67,54,0.07)' : 'rgba(0,0,0,0.04)',
          border: `1px solid ${(svcStatus === 'running' || dbUp) ? 'rgba(76,175,80,0.25)' : svcStatus === 'stopped' ? 'rgba(244,67,54,0.2)' : 'rgba(0,0,0,0.1)'}`,
          fontSize: 12, color: 'var(--text-muted)',
        }}>
          <span style={{ fontSize: 11, fontWeight: 700,
            color: (svcStatus === 'running' || dbUp) ? '#2e7d32' : svcStatus === 'stopped' ? '#c62828' : 'var(--text-muted)' }}>
            DB
          </span>
          <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: (svcStatus === 'running' || dbUp) ? '#4caf50' : svcStatus === 'starting' ? '#ff9800' : svcStatus === 'stopped' ? '#f44336' : '#888' }} />
          <span style={{ fontWeight: 600 }}>
            {svcStatus === 'running' ? (dbUp ? 'Up' : 'Service Running') :
             svcStatus === 'starting' ? 'Starting…' :
             svcStatus === 'stopped' ? 'Stopped' :
             svcStatus === null ? '…' :
             dbUp ? 'Up' : 'Unknown'}
          </span>
          <button onClick={refreshSvcStatus} disabled={svcBusy}
            title="Refresh DB status"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1 }}>↻</button>
          <button className="btn btn-sm btn-primary" onClick={startDb} disabled={svcBusy || dbUp}
            style={{ padding: '1px 8px', fontSize: 11 }}>
            {svcBusy ? <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} /> : 'Start'}
          </button>
          <button className="btn btn-sm" onClick={stopDb} disabled={svcBusy || !dbUp}
            style={{ padding: '1px 8px', fontSize: 11, color: '#f44336', borderColor: 'rgba(244,67,54,0.4)' }}>
            {svcBusy ? <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} /> : 'Stop'}
          </button>
          {svcErr && <span style={{ color: '#c62828', fontSize: 11 }}>{svcErr}</span>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 0, height: 'calc(100vh - 160px)', minHeight: 500 }}>

        {/* Left: schema tree */}
        <div style={{
          width: 260, flexShrink: 0, borderRight: '1px solid var(--border)',
          overflowY: 'auto', background: 'var(--surface)',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            padding: '8px 10px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: connected ? '#4caf50' : connecting ? '#ff9800' : '#f44336' }} />
            <span style={{ fontSize: 12, flex: 1, color: 'var(--text-muted)' }}>
              {connected ? (connInfo?.schema_user || 'Connected') : connecting ? 'Connecting…' : 'Disconnected'}
            </span>
            {!connected && !connecting && (
              <button className="btn btn-sm" style={{ padding: '2px 8px', fontSize: 11 }}
                onClick={() => connect()}>Connect</button>
            )}
          </div>
          {connErr && (
            <div style={{ fontSize: 11, color: '#f44336', padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
              {connErr}
            </div>
          )}
          {connecting && <div style={{ padding: 16, textAlign: 'center' }}><span className="spinner" /></div>}
          {connected && schemas.map(s => (
            <SchemaNode key={s} appName={appName} schema={s} onInsert={insertIntoEditor} />
          ))}
        </div>

        {/* Right: query editor + results */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>

          <SqlQueryPanel ref={queryPanel} scope="local" appName={appName} version={version} connected={connected}
            busy={busy} onActive={setActiveTab} runSql={(sql, tab) => executeQuery(sql, tab)} />

          {/* Results */}
          {eErr && (
            <div style={{
              padding: '8px 14px', fontSize: 12, color: '#f44336',
              background: 'rgba(244,67,54,0.08)', borderBottom: '1px solid var(--border)', flexShrink: 0,
            }}>{eErr}</div>
          )}
          {result && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{
                padding: '4px 8px', fontSize: 11, color: 'var(--text-muted)',
                borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)',
                display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
              }}>
                <span style={{ marginRight: 4 }}>
                  {result.is_dml
                    ? `${result.row_count} row(s) affected`
                    : `${result.row_count} row(s)${result.row_count === 1000 ? ' (limit 1000)' : ''}`}
                </span>
                {commitMsg && <span style={{ color: '#2e7d32', fontWeight: 600 }}>{commitMsg}</span>}
                {commitErr && <span style={{ color: '#c62828' }}>{commitErr}</span>}
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {result.columns.length > 0 && !result.is_dml && (
                    <>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Table:</span>
                      <input
                        value={commitTable[activeTab] || ''}
                        onChange={e => setCommitTable(p => ({ ...p, [activeTab]: e.target.value }))}
                        placeholder="schema.table"
                        style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, border: '1px solid var(--border)',
                          background: 'var(--surface2)', color: 'var(--text)', width: 160 }}
                      />
                      <span style={{ borderLeft: '1px solid var(--border)', height: 12, margin: '0 2px' }} />
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Key:</span>
                      <select value={keyCol[activeTab] ?? 0}
                        onChange={e => setKeyCol(p => ({ ...p, [activeTab]: Number(e.target.value) }))}
                        style={{ fontSize: 10, padding: '1px 4px', borderRadius: 4, border: '1px solid var(--border)',
                          background: 'var(--surface2)', color: 'var(--text)', maxWidth: 120 }}>
                        {result.columns.map((c, i) => <option key={i} value={i}>{c}</option>)}
                      </select>
                      <button className="btn btn-sm" onClick={addNewRow}
                        style={{ padding: '1px 8px', fontSize: 11, color: '#2e7d32', borderColor: 'rgba(46,125,50,0.4)' }}>
                        + Insert Row
                      </button>
                    </>
                  )}
                  {hasEdits && <>
                    <button className="btn btn-sm btn-primary" onClick={doCommit} disabled={commitBusy}
                      style={{ padding: '1px 8px', fontSize: 11 }}>
                      {commitBusy ? <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} /> : 'Commit'}
                    </button>
                    <button className="btn btn-sm" onClick={discardEdits}
                      style={{ padding: '1px 8px', fontSize: 11, color: '#c62828', borderColor: 'rgba(198,40,40,0.35)' }}>
                      Discard
                    </button>
                    <span style={{ borderLeft: '1px solid var(--border)', height: 14, margin: '0 2px' }} />
                  </>}
                  {result.columns.length > 0 && !result.is_dml && ['CSV','XLSX','XLS','SQL','TXT'].map(fmt => (
                    <button key={fmt} className="btn btn-sm" onClick={() => exportResults(fmt.toLowerCase())}
                      style={{ padding: '1px 7px', fontSize: 10 }}>{fmt}</button>
                  ))}
                </div>
              </div>
              {result.columns.length > 0 && (
                <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', minWidth: 'max-content' }}>
                    <thead>
                      <tr>
                        <th style={{ width: 24, padding: 0, position: 'sticky', top: 0, background: 'var(--surface)', borderBottom: '2px solid var(--border)' }} />
                        {result.columns.map(c => (
                          <th key={c} style={{
                            padding: '5px 10px', textAlign: 'left', position: 'sticky', top: 0,
                            background: 'var(--surface)', borderBottom: '2px solid var(--border)',
                            fontFamily: 'monospace', fontWeight: 700, whiteSpace: 'nowrap', color: 'var(--text)',
                          }}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, ri) => (
                        <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : 'rgba(128,128,128,0.04)' }}>
                          <td style={{ width: 24, padding: 0, borderBottom: '1px solid var(--border)' }} />
                          {row.map((cell, ci) => {
                            const cellKey   = `${activeTab}:${ri}:${ci}`
                            const isEdited  = cellKey in editedCells
                            const isEditing = editingCell?.ri === ri && editingCell?.ci === ci
                            const displayVal = isEdited ? editedCells[cellKey] : (cell === null ? '' : String(cell))
                            return (
                              <td key={ci}
                                onClick={() => !isEditing && setEditingCell({ ri, ci })}
                                style={{
                                  padding: isEditing ? '0' : '4px 10px',
                                  borderBottom: '1px solid var(--border)',
                                  fontFamily: 'monospace', whiteSpace: 'nowrap', maxWidth: 300,
                                  overflow: 'hidden', textOverflow: 'ellipsis',
                                  color: cell === null && !isEdited ? 'var(--text-muted)' : 'var(--text)',
                                  cursor: 'text',
                                  background: isEdited ? 'rgba(255,235,59,0.18)' : undefined,
                                  outline: isEdited ? '1px solid rgba(255,193,7,0.5)' : undefined,
                                }}
                                title={!isEditing ? (isEdited ? displayVal : (cell != null ? String(cell) : 'NULL')) : undefined}>
                                {isEditing ? (
                                  <input autoFocus value={displayVal}
                                    onChange={e => setEditedCells(prev => ({ ...prev, [cellKey]: e.target.value }))}
                                    onBlur={() => setEditingCell(null)}
                                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingCell(null) }}
                                    style={{
                                      width: '100%', minWidth: 80, padding: '4px 10px', border: 'none',
                                      outline: '2px solid var(--primary)', fontFamily: 'monospace',
                                      fontSize: 12, background: 'rgba(59,130,246,0.06)', color: 'var(--text)',
                                      boxSizing: 'border-box',
                                    }}
                                  />
                                ) : isEdited ? (
                                  displayVal === '' ? <em style={{ opacity: 0.5 }}>NULL</em> : displayVal
                                ) : (
                                  cell === null ? <em style={{ opacity: 0.5 }}>NULL</em> : String(cell)
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                      {tabNewRows.map((newRow, ni) => (
                        <tr key={`new-${ni}`} style={{ background: 'rgba(76,175,80,0.08)', outline: '1px solid rgba(76,175,80,0.3)' }}>
                          <td style={{ width: 24, padding: '0 2px', borderBottom: '1px solid rgba(76,175,80,0.2)', textAlign: 'center' }}>
                            <button onClick={() => removeNewRow(ni)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c62828', fontSize: 13, lineHeight: 1, padding: 0 }}>✕</button>
                          </td>
                          {newRow.map((val, ci) => (
                            <td key={ci} style={{ padding: 0, borderBottom: '1px solid rgba(76,175,80,0.2)' }}>
                              <input value={val} placeholder="NULL"
                                onChange={e => updateNewCell(ni, ci, e.target.value)}
                                style={{
                                  width: '100%', minWidth: 80, padding: '4px 10px', border: 'none',
                                  outline: 'none', fontFamily: 'monospace', fontSize: 12,
                                  background: 'transparent', color: 'var(--text)', boxSizing: 'border-box',
                                }}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

// ── Queue Tab ─────────────────────────────────────────────────────────────────

function QueuesListPanel({ appName, conn }) {
  const [queues,  setQueues]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState(null)
  const [filter,  setFilter]  = useState('')

  function load() {
    setLoading(true)
    fetch(`/api/local-app/${appName}/queue/list?conn=${encodeURIComponent(conn || '')}`)
      .then(r => r.json())
      .then(d => { if (d.ok) { setQueues(d.queues); setErr(null) } else setErr(d.error) })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [appName, conn])

  const q        = filter.toLowerCase()
  const filtered = (queues || []).filter(q2 => !q || q2.name.toLowerCase().includes(q))
  const stripNs  = n => n.replace(/^javax\.jms\./, '')
  const cell     = { padding: '5px 8px', fontSize: 12, verticalAlign: 'middle' }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Queues{queues ? ` (${queues.length})` : ''}</span>
        {loading && <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />}
      </div>
      {err && <div className="alert alert-error" style={{ marginBottom: 8, fontSize: 12 }}>{err}</div>}
      <input type="text" placeholder="Filter queues…" value={filter} onChange={e => setFilter(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8,
          background: 'var(--bg-secondary)', color: 'var(--text-primary)',
          border: '1px solid var(--border-color)', borderRadius: 4, padding: '4px 8px', fontSize: 12 }} />
      <div style={{ maxHeight: 400, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 5 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg-secondary)', position: 'sticky', top: 0, zIndex: 1 }}>
              <th style={{ ...cell, textAlign: 'left',  fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Queue</th>
              <th style={{ ...cell, textAlign: 'right', fontWeight: 600, borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>Current</th>
              <th style={{ ...cell, textAlign: 'right', fontWeight: 600, borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>Total Added</th>
              <th style={{ ...cell, textAlign: 'right', fontWeight: 600, borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>Consumers</th>
            </tr>
          </thead>
          <tbody>
            {!queues ? (
              <tr><td colSpan={4} style={{ ...cell, textAlign: 'center', padding: 20 }}>
                <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
              </td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={4} style={{ ...cell, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>
                {filter ? 'No matches' : 'No queues found'}
              </td></tr>
            ) : filtered.map(q2 => (
              <tr key={q2.name} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <td style={{ ...cell, fontFamily: 'monospace', wordBreak: 'break-all' }}>{stripNs(q2.name)}</td>
                <td style={{ ...cell, textAlign: 'right',
                  color: q2.messageCount > 0 ? '#ff9800' : 'inherit',
                  fontWeight: q2.messageCount > 0 ? 600 : 400 }}>
                  {q2.messageCount.toLocaleString()}
                </td>
                <td style={{ ...cell, textAlign: 'right', color: 'var(--text-muted)' }}>{q2.messagesAdded.toLocaleString()}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{q2.consumerCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function QueueTab({ appName }) {
  const [artemisUp, setArtemisUp] = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [opStatus,  setOpStatus]  = useState(null)
  const [opOutput,  setOpOutput]  = useState('')
  const [opKind,    setOpKind]    = useState(null)
  const [opErr,     setOpErr]     = useState(null)
  const termRef = useRef(null)
  const [qconns, setQconns] = useState(null)
  const [qsel, setQsel] = useKept(`queueconn_${appName}`, '')
  const [qcfg, setQcfg] = useState(false)
  const loadQconns = () => fetch(`/api/local-app/${appName}/queue/connections`).then(r => r.json()).then(r => setQconns(r.ok ? r.connections : [])).catch(() => setQconns([]))
  useEffect(() => { loadQconns() }, [appName])
  const qconn = qconns && qconns.length ? (qconns.find(c => c.name === qsel)?.name || qconns[0].name) : ''

  function fetchStatus() {
    fetch(`/api/local-app/${appName}/server-status`)
      .then(r => r.json())
      .then(d => { if (d.ok) setArtemisUp(d.artemis) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 4000)
    return () => clearInterval(id)
  }, [appName])

  useEffect(() => {
    if (opStatus !== 'running') return
    const id = setInterval(() => {
      fetch(`/api/local-app/${appName}/artemis/server-op-status`)
        .then(r => r.json())
        .then(d => {
          setOpOutput(d.output || '')
          if (d.status !== 'running') { setOpStatus(d.status); fetchStatus() }
        })
        .catch(() => {})
    }, 800)
    return () => clearInterval(id)
  }, [opStatus, appName])

  useEffect(() => {
    if (opStatus !== 'success' || opKind !== 'start') return
    const ids = [setTimeout(fetchStatus, 2000), setTimeout(fetchStatus, 5000), setTimeout(fetchStatus, 10000)]
    return () => ids.forEach(clearTimeout)
  }, [opStatus, opKind])

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [opOutput])

  function runOp(operation) {
    setOpKind(operation); setOpStatus('running'); setOpOutput(''); setOpErr(null)
    fetch(`/api/local-app/${appName}/artemis/server-op`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation }),
    })
      .then(r => r.json())
      .then(d => { if (!d.ok) { setOpErr(d.error); setOpStatus(null) } })
      .catch(() => { setOpErr('Could not reach server'); setOpStatus(null) })
  }

  const busy = opStatus === 'running'

  return (
    <div>
      <ConnBar label="Queue connection" conns={qconns} value={qconn} onChange={setQsel} onGear={() => setQcfg(v => !v)} gearOn={qcfg} />
      {qcfg && <ConnConfigPanel base={`/api/local-app/${appName}`} kind="queue" title="Queue" onSaved={loadQconns} />}
      <DeployedBanner appName={appName} />
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: '0 0 220px' }}>
          <div className="card">
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Queue Status</div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Artemis</div>
              {loading ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> : <StatusBadge running={artemisUp} />}
            </div>
            {opErr && <div className="alert alert-error" style={{ marginBottom: 12 }}>{opErr}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => runOp('start')} disabled={busy || artemisUp === true}>
                {busy && opKind === 'start'
                  ? <><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> Starting…</>
                  : '▶ Start'}
              </button>
              <button className="btn btn-sm" onClick={() => runOp('stop')} disabled={busy || artemisUp === false}
                style={{ color: '#f44336', borderColor: '#f44336' }}>
                {busy && opKind === 'stop'
                  ? <><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> Stopping…</>
                  : '⏹ Stop'}
              </button>
            </div>
          </div>
          {(opStatus || opOutput) && (
            <div className="card" style={{ marginTop: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                {opKind && opKind.charAt(0).toUpperCase() + opKind.slice(1)} output
                {opStatus === 'running' && <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />}
                {opStatus === 'success' && <span style={{ color: '#4caf50' }}>✓ Done</span>}
                {opStatus === 'failed'  && <span style={{ color: '#f44336' }}>✗ Failed</span>}
                {opStatus !== 'running' && (
                  <button onClick={() => { setOpStatus(null); setOpOutput(''); setOpKind(null) }}
                    style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-muted)', fontSize: 14, lineHeight: 1, padding: '0 2px' }}>✕</button>
                )}
              </div>
              <ColoredTerminal output={opOutput} termRef={termRef} height={240} fontSize={12} />
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <QueuesListPanel appName={appName} conn={qconn} />
        </div>
      </div>
    </div>
  )
}

// ── API Tab ──────────────────────────────────────────────────────────────────

function soapTemplate(op, namespace) {
  const ns = namespace || 'ns'
  const shortNs = ns.split('/').pop() || 'tns'
  return `<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:${shortNs}="${ns}">
  <soapenv:Header/>
  <soapenv:Body>
    <${shortNs}:${op}>
      <!-- add parameters here -->
    </${shortNs}:${op}>
  </soapenv:Body>
</soapenv:Envelope>`
}

function CurlCopyButton({ url, method, headers, body }) {
  const [copied, setCopied] = useState(false)
  function buildCurl() {
    const parts = ['curl', '-s', '-X', method]
    Object.entries(headers || {}).forEach(([k, v]) => {
      parts.push('-H', `'${k}: ${v}'`)
    })
    if (body && !['GET', 'HEAD'].includes(method)) {
      const escaped = body.replace(/'/g, "'\\''")
      parts.push('--data', `'${escaped}'`)
    }
    parts.push(`'${url}'`)
    return parts.join(' ')
  }
  function copy() {
    navigator.clipboard.writeText(buildCurl()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }
  return (
    <button onClick={copy} className="btn btn-sm" title="Copy as cURL command"
      style={{ fontSize: 11 }}>
      {copied ? '✓ Copied' : '⎘ Copy as cURL'}
    </button>
  )
}

function preprocessXml(xml) {
  const result = []
  let i = 0
  while (i < xml.length) {
    const gtPos = xml.indexOf('>', i)
    if (gtPos === -1) { result.push(xml.slice(i)); break }
    result.push(xml.slice(i, gtPos + 1))
    const ltPos = xml.indexOf('<', gtPos + 1)
    if (ltPos === -1) { result.push(xml.slice(gtPos + 1)); break }
    const text = xml.slice(gtPos + 1, ltPos)
    result.push(text.includes('&lt;')
      ? text.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'")
      : text)
    i = ltPos
  }
  return result.join('')
}

function prettyXml(xml) {
  const INDENT = '  '
  let depth = 0
  const lines = xml.replace(/>\s*</g, '>\n<').split('\n')
  return lines.map(raw => {
    const t = raw.trim()
    if (!t) return ''
    if (t.startsWith('</')) {
      depth = Math.max(0, depth - 1)
      return INDENT.repeat(depth) + t
    }
    const line = INDENT.repeat(depth) + t
    if (!t.startsWith('<?') && !t.startsWith('<!') && !t.endsWith('/>') && !/<[^>]+>.*<\/[^>]+>/.test(t) && !t.includes('</')) {
      depth++
    }
    return line
  }).filter(Boolean).join('\n')
}

function XmlHighlight({ xml }) {
  const TAG_OPEN  = '#4ec9b0'
  const TAG_ANGLE = '#808080'
  const ATTR_NAME = '#9cdcfe'
  const ATTR_VAL  = '#ce9178'
  const COMMENT   = '#6a9955'
  const TEXT      = 'var(--text)'
  const tokenRe = /(<\/[\w:.-]+\s*>|<!--[\s\S]*?-->|<[\s\S]*?>|[^<]+)/g
  const parts = []
  let key = 0
  let m
  while ((m = tokenRe.exec(xml)) !== null) {
    const tok = m[0]
    if (tok.startsWith('<!--')) {
      parts.push(<span key={key++} style={{ color: COMMENT }}>{tok}</span>)
    } else if (tok.startsWith('<')) {
      const inner = tok.slice(1, tok.endsWith('/>') ? -2 : tok.endsWith('>') ? -1 : tok.length)
      const isClose = inner.startsWith('/')
      const nameMatch = inner.match(/^\/?([\w:.-]+)/)
      const tagName  = nameMatch ? nameMatch[1] : ''
      const rest     = nameMatch ? inner.slice(nameMatch[0].length) : inner
      const attrRe   = /([\w:.-]+)(\s*=\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g
      const attrParts = []
      let last = 0, am
      while ((am = attrRe.exec(rest)) !== null) {
        if (am.index > last) attrParts.push(<span key={`r${key++}`} style={{ color: TAG_ANGLE }}>{rest.slice(last, am.index)}</span>)
        attrParts.push(<span key={`n${key++}`} style={{ color: ATTR_NAME }}>{am[1]}</span>)
        attrParts.push(<span key={`e${key++}`} style={{ color: TAG_ANGLE }}>{am[2]}</span>)
        attrParts.push(<span key={`v${key++}`} style={{ color: ATTR_VAL }}>{am[3]}</span>)
        last = am.index + am[0].length
      }
      if (last < rest.length) attrParts.push(<span key={`r${key++}`} style={{ color: TAG_ANGLE }}>{rest.slice(last)}</span>)
      parts.push(
        <span key={key++}>
          <span style={{ color: TAG_ANGLE }}>{'<'}{isClose ? '/' : ''}</span>
          <span style={{ color: TAG_OPEN }}>{tagName}</span>
          {attrParts}
          <span style={{ color: TAG_ANGLE }}>{tok.endsWith('/>') ? '/>' : '>'}</span>
        </span>
      )
    } else {
      const t = tok.trim()
      if (t) parts.push(<span key={key++} style={{ color: TEXT }}>{tok}</span>)
      else   parts.push(<span key={key++}>{tok}</span>)
    }
  }
  return <>{parts}</>
}

function RequestBuilder({ svc, op, type, version, apiName, appName, onClose }) {
  const isSoap = type === 'soap'
  const _k = `rb|${appName}|${version}|${apiName}|${op}|`
  const [url,         setUrl]         = useKept(_k+'url', svc.endpoint || '')
  const [method,      setMethod]      = useKept(_k+'method', isSoap ? 'POST' : 'GET')
  const [authType,    setAuthType]    = useKept(_k+'authType', 'none')
  const [bearerToken, setBearerToken] = useKept(_k+'bearer', '')
  const [basicUser,   setBasicUser]   = useKept(_k+'user', '')
  const [basicPass,   setBasicPass]   = useKept(_k+'pass', '')
  const [showPass,    setShowPass]    = useState(false)
  const [preemptive,  setPreemptive]  = useKept(_k+'preemptive', 'global')
  const [body,        setBody]        = useKept(_k+'body', () => isSoap ? soapTemplate(op, svc.namespace) : '')
  const [busy,        setBusy]        = useState(false)
  const [response,    setResponse]    = useKept(_k+'response', null)
  const [reqErr,      setReqErr]      = useKept(_k+'err', null)
  const [savedList,   setSavedList]   = useState([])
  const [loadMenuOpen,setLoadMenuOpen]= useState(false)
  const [loadedId,    setLoadedId]    = useState(null)
  const [saveMsg,     setSaveMsg]     = useState(null)
  const [authSaveMsg, setAuthSaveMsg] = useState(null)

  function loadAuth() {
    fetch(`/api/local-app/${appName}/api-auth/load`)
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.found) {
          setAuthType(d.authType || 'none')
          setBearerToken(d.bearerToken || '')
          setBasicUser(d.username || '')
          setBasicPass(d.password || '')
        }
      })
      .catch(() => {})
  }

  useEffect(() => { if (!KEPT[_k+'user'] && !KEPT[_k+'bearer']) loadAuth() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  function saveAuth() {
    fetch(`/api/local-app/${appName}/api-auth/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authType, username: basicUser, password: basicPass, bearerToken }),
    })
      .then(r => r.json())
      .then(d => {
        setAuthSaveMsg(d.ok ? { ok: true, text: 'Auth saved' } : { ok: false, text: d.error || 'Failed' })
        setTimeout(() => setAuthSaveMsg(null), 2500)
      })
      .catch(() => setAuthSaveMsg({ ok: false, text: 'Could not reach server' }))
  }

  function toXml() {
    const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    return `<?xml version="1.0" encoding="UTF-8"?>\n<request>\n` +
      `  <url>${esc(url)}</url>\n` +
      `  <method>${esc(method)}</method>\n` +
      `  <authType>${esc(authType)}</authType>\n` +
      `  <bearerToken>${esc(bearerToken)}</bearerToken>\n` +
      `  <basicUser>${esc(basicUser)}</basicUser>\n` +
      `  <basicPass>${esc(basicPass)}</basicPass>\n` +
      `  <preemptive>${esc(preemptive)}</preemptive>\n` +
      `  <body><![CDATA[${body}]]></body>\n` +
      `</request>`
  }

  function fromXml(xml) {
    const get = tag => { const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)); return m ? m[1] : '' }
    const getCdata = tag => { const m = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`)); return m ? m[1] : get(tag) }
    const unesc = s => s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    setUrl(unesc(get('url')))
    setMethod(get('method') || (isSoap ? 'POST' : 'GET'))
    setAuthType(get('authType') || 'none')
    setBearerToken(unesc(get('bearerToken')))
    setBasicUser(unesc(get('basicUser')))
    setBasicPass(unesc(get('basicPass')))
    setPreemptive(get('preemptive') || 'global')
    setBody(getCdata('body'))
  }

  function loadSavedList() {
    if (!version || !apiName) return
    fetch(`/api/local-app/${appName}/api-requests?version=${encodeURIComponent(version)}&api=${encodeURIComponent(apiName)}&method=${encodeURIComponent(op)}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setSavedList(d.requests || []) })
      .catch(() => {})
  }

  function doLoad(id) {
    setLoadMenuOpen(false)
    fetch(`/api/local-app/${appName}/api-requests/load?version=${encodeURIComponent(version)}&api=${encodeURIComponent(apiName)}&id=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(d => { if (d.ok) { fromXml(d.content); setLoadedId(id) } })
      .catch(() => {})
  }

  function doSave() {
    const now = new Date()
    const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`
    const id = `${op}_${ts}`
    fetch(`/api/local-app/${appName}/api-requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, api: apiName, id, content: toXml() }),
    })
      .then(r => r.json())
      .then(d => {
        setSaveMsg(d.ok ? { ok: true, text: `Saved as "${id}"` } : { ok: false, text: d.error })
        if (d.ok) loadSavedList()
        setTimeout(() => setSaveMsg(null), 3000)
      })
      .catch(() => setSaveMsg({ ok: false, text: 'Could not reach server' }))
  }

  function doDelete(id, { clearLoaded = false } = {}) {
    return fetch(`/api/local-app/${appName}/api-requests`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, api: apiName, id }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          loadSavedList()
          if (clearLoaded) doClear()
        }
      })
      .catch(() => {})
  }

  function doClear() {
    setUrl(svc.endpoint || ''); setMethod(isSoap ? 'POST' : 'GET')
    setAuthType('none'); setBearerToken(''); setBasicUser(''); setBasicPass('')
    setPreemptive('global'); setBody(isSoap ? soapTemplate(op, svc.namespace) : '')
    setResponse(null); setReqErr(null); setLoadedId(null)
  }

  function openLoadMenu() {
    loadSavedList()
    setLoadMenuOpen(o => !o)
  }

  function buildHeaders() {
    const h = {}
    if (isSoap) {
      h['Content-Type'] = 'text/xml; charset=utf-8'
      h['SOAPAction'] = '""'
    } else {
      if (body.trim().startsWith('{') || body.trim().startsWith('['))
        h['Content-Type'] = 'application/json'
    }
    if (authType === 'bearer' && bearerToken.trim()) {
      h['Authorization'] = `Bearer ${bearerToken.trim()}`
    } else if (authType === 'basic') {
      const shouldSend = preemptive === 'preemptive' || preemptive === 'global'
      if (shouldSend && (basicUser || basicPass)) {
        const encoded = btoa(`${basicUser}:${basicPass}`)
        h['Authorization'] = `Basic ${encoded}`
      }
    }
    return h
  }

  function submit() {
    setBusy(true); setReqErr(null); setResponse(null)
    fetch('/api/proxy-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, method, headers: buildHeaders(), body: ['GET', 'HEAD'].includes(method) ? null : body }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) setResponse({ status: d.status, body: d.body, isOk: d.status < 400 })
        else setReqErr(d.error || 'Request failed')
      })
      .catch(() => setReqErr('Could not reach server'))
      .finally(() => setBusy(false))
  }

  const inputStyle = {
    fontSize: 12, padding: '5px 8px', borderRadius: 4,
    border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)',
  }

  return (
    <div style={{ margin: '4px 0 0 0', padding: '14px 16px',
      borderTop: '2px solid var(--primary)', background: 'var(--surface2)', borderRadius: '0 0 6px 6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: 13, fontFamily: 'monospace', color: 'var(--primary)' }}>{op}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>— Request Builder</span>
        <button className="btn btn-sm" onClick={onClose} style={{ marginLeft: 'auto', fontSize: 11 }}>✕ Close</button>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap', position: 'relative' }}>
        <div style={{ position: 'relative' }}>
          <button className="btn btn-sm" onClick={openLoadMenu}
            style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
            📂 Load {loadMenuOpen ? '▴' : '▾'}
          </button>
          {loadMenuOpen && (
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 100, marginTop: 4,
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
              minWidth: 220, boxShadow: '0 4px 16px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
              {savedList.length === 0
                ? <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)' }}>No saved requests</div>
                : savedList.map(r => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 10px', borderBottom: '1px solid var(--border)', background: 'transparent' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(88,166,255,0.06)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <button onClick={() => doLoad(r.id)}
                      style={{ flex: 1, textAlign: 'left', fontSize: 12, fontFamily: 'monospace',
                        background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', padding: 0 }}>
                      {r.name}
                    </button>
                    <button onClick={() => doDelete(r.id)}
                      style={{ fontSize: 11, color: '#f44336', background: 'none', border: 'none',
                        cursor: 'pointer', padding: '0 4px', flexShrink: 0 }}
                      title="Delete this saved request">✕</button>
                  </div>
                ))
              }
            </div>
          )}
        </div>
        <button className="btn btn-sm" onClick={() => { doSave(); setLoadMenuOpen(false) }}
          style={{ fontSize: 11 }}>💾 Save</button>
        <button className="btn btn-sm" onClick={doClear} style={{ fontSize: 11 }}>🗑 Clear</button>
        <CurlCopyButton url={url} method={method} headers={buildHeaders()} body={body} />
        {saveMsg && (
          <span style={{ fontSize: 12, color: saveMsg.ok ? '#4caf50' : '#f44336', marginLeft: 4 }}>
            {saveMsg.ok ? '✓' : '✗'} {saveMsg.text}
          </span>
        )}
        {loadMenuOpen && <div onClick={() => setLoadMenuOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 99 }} />}
      </div>

      {/* URL + Method */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        {!isSoap && (
          <select value={method} onChange={e => setMethod(e.target.value)}
            style={{ ...inputStyle, flexShrink: 0 }}>
            {['GET','POST','PUT','PATCH','DELETE'].map(m => <option key={m}>{m}</option>)}
          </select>
        )}
        <input type="text" value={url} onChange={e => setUrl(e.target.value)}
          placeholder="Endpoint URL"
          style={{ ...inputStyle, flex: 1, fontFamily: 'monospace' }} />
        <CopyButton text={url} />
      </div>

      {/* Auth */}
      <div style={{ marginBottom: 10, padding: '10px 12px', borderRadius: 6,
        border: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: authType === 'none' ? 0 : 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0, fontWeight: 600 }}>Authentication:</span>
          <select value={authType} onChange={e => setAuthType(e.target.value)}
            style={{ ...inputStyle, flexShrink: 0 }}>
            <option value="none">None</option>
            <option value="bearer">Bearer Token</option>
            <option value="basic">Basic Auth</option>
          </select>
        </div>
        {authType === 'bearer' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0, width: 56 }}>Token:</span>
            <input type="text" value={bearerToken} onChange={e => setBearerToken(e.target.value)}
              placeholder="Paste Bearer token…"
              style={{ ...inputStyle, flex: 1, fontFamily: 'monospace' }} />
          </div>
        )}
        {authType === 'basic' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '70px minmax(0, 240px)', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Username:</span>
              <input type="text" value={basicUser} onChange={e => setBasicUser(e.target.value)}
                placeholder="Username" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Password:</span>
              <div style={{ position: 'relative', width: '100%', boxSizing: 'border-box' }}>
                <input type={showPass ? 'text' : 'password'} value={basicPass}
                  onChange={e => setBasicPass(e.target.value)} placeholder="Password"
                  style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', paddingRight: 28 }} />
                <button onClick={() => setShowPass(v => !v)} tabIndex={-1}
                  title={showPass ? 'Hide password' : 'Show password'}
                  style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
                    fontSize: 13, color: 'var(--text-muted)', lineHeight: 1 }}>
                  {showPass ? '🙈' : '👁'}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0, width: 70 }}>Pre-emptive:</span>
              <div style={{ display: 'flex', gap: 16 }}>
                {[
                  { val: 'global',     label: 'Use Global Preference' },
                  { val: 'preemptive', label: 'Authenticate Pre-emptively' },
                ].map(opt => (
                  <label key={opt.val} style={{ display: 'flex', alignItems: 'center', gap: 5,
                    fontSize: 12, color: 'var(--text)', cursor: 'pointer' }}>
                    <input type="radio" name={`preemptive-${op}`} value={opt.val}
                      checked={preemptive === opt.val} onChange={() => setPreemptive(opt.val)}
                      style={{ accentColor: 'var(--primary)', cursor: 'pointer' }} />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
        {authType !== 'none' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <button className="btn btn-sm" onClick={saveAuth} style={{ fontSize: 11 }}>💾 Save Auth</button>
            {authSaveMsg && (
              <span style={{ fontSize: 11, color: authSaveMsg.ok ? '#4caf50' : '#f44336' }}>
                {authSaveMsg.text}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      {(isSoap || !['GET', 'HEAD'].includes(method)) && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{isSoap ? 'SOAP Envelope (XML)' : 'Request Body'}</span>
            <CopyButton text={body} />
          </div>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={isSoap ? 10 : 6}
            style={{ ...inputStyle, width: '100%', fontFamily: 'monospace', resize: 'vertical',
              padding: '8px 10px', boxSizing: 'border-box' }} />
        </div>
      )}

      {/* Submit */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: response || reqErr ? 12 : 0 }}>
        <button className="btn btn-sm btn-primary" onClick={submit} disabled={busy || !url.trim()}>
          {busy
            ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Sending…</>
            : `▶ Submit ${isSoap ? 'SOAP' : method} Request`}
        </button>
        {response && (
          <span style={{ fontSize: 12, fontWeight: 600, color: response.isOk ? '#4caf50' : '#f44336' }}>
            HTTP {response.status}
          </span>
        )}
        {loadedId && (
          <button className="btn btn-sm" onClick={() => doDelete(loadedId, { clearLoaded: true })}
            style={{ fontSize: 11, color: '#f44336', borderColor: 'rgba(244,67,54,0.4)' }}
            title={`Delete saved request "${loadedId}"`}>
            🗑 Delete Saved Request
          </button>
        )}
      </div>

      {reqErr && <div className="alert alert-error" style={{ fontSize: 12, marginBottom: 10 }}>{reqErr}</div>}

      {/* Response */}
      {response && (() => {
        const isXml = response.body?.trimStart().startsWith('<')
        const displayBody = isXml ? prettyXml(preprocessXml(response.body)) : response.body
        return (
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Response</span>
              <CopyButton text={response.body} />
            </div>
            <pre style={{ margin: 0, padding: '10px 12px', borderRadius: 6, fontSize: 11,
              fontFamily: 'monospace', lineHeight: 1.6, overflowX: 'auto', maxHeight: 400, overflowY: 'auto',
              background: '#1e1e1e',
              border: `1px solid ${response.isOk ? 'rgba(76,175,80,0.4)' : 'rgba(244,67,54,0.4)'}`,
              color: 'var(--text)',
            }}>
              {isXml ? <XmlHighlight xml={displayBody} /> : displayBody}
            </pre>
          </div>
        )
      })()}
    </div>
  )
}

// keeps API tab state (responses, bodies, open rows) while navigating to other pages and back
const KEPT = {}
function useKept(key, init) {
  const [v, setV] = useState(() => (key in KEPT ? KEPT[key] : (typeof init === 'function' ? init() : init)))
  KEPT[key] = v
  return [v, setV]
}

function ApiServiceRow({ svc, type, version, appName }) {
  const [open,     setOpen]     = useKept(`api|${appName}|${svc.name}|open`, false)
  const [activeOp, setActiveOp] = useKept(`api|${appName}|${svc.name}|op`, null)
  const shortName = svc.name.replace(/(?:StronglyTyped|WeaklyTyped)Type$/, '')
  const isRest = type === 'rest'
  const badge = isRest
    ? { bg: '#2e7d32', color: '#fff', label: 'REST' }
    : { bg: '#1565c0', color: '#fff', label: 'SOAP' }
  const restDirect = isRest && svc.ops.length === 0

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
          cursor: 'pointer', userSelect: 'none',
          background: open ? 'rgba(59,130,246,0.04)' : 'transparent' }}>
        <span style={{ fontSize: 11, width: 8, color: 'var(--text-muted)', flexShrink: 0 }}>
          {open ? '▾' : '▸'}
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
          background: badge.bg, color: badge.color, flexShrink: 0, letterSpacing: '0.03em' }}>
          {badge.label}
        </span>
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortName}</span>
        {!restDirect && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
            {svc.ops.length} op{svc.ops.length !== 1 ? 's' : ''}
          </span>
        )}
        {svc.wsdl && (
          <a href={svc.wsdl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
            style={{ fontSize: 11, color: '#1976d2', flexShrink: 0, textDecoration: 'none',
              padding: '2px 8px', border: '1px solid rgba(25,118,210,0.4)',
              borderRadius: 4, background: 'rgba(25,118,210,0.07)' }}>
            {isRest ? 'WADL ↗' : 'WSDL ↗'}
          </a>
        )}
        {svc.endpoint && (
          <a href={svc.endpoint} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
            style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, textDecoration: 'none',
              padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 4 }}>
            Endpoint ↗
          </a>
        )}
      </div>
      {open && (
        <div style={{ padding: '8px 12px 4px 32px', background: 'rgba(59,130,246,0.04)' }}>
          {svc.namespace && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontFamily: 'monospace' }}>
              ns: {svc.namespace}
            </div>
          )}
          {restDirect ? (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontFamily: 'monospace' }}>
                {svc.endpoint}
              </div>
              <button
                onClick={() => setActiveOp(prev => prev ? null : shortName)}
                style={{
                  fontSize: 11, padding: '4px 12px', borderRadius: 4, cursor: 'pointer', marginBottom: 8,
                  border: activeOp ? '1px solid var(--primary)' : '1px solid var(--border)',
                  background: activeOp ? 'var(--primary)' : 'var(--surface2)',
                  color: activeOp ? '#fff' : 'var(--text)',
                  fontWeight: activeOp ? 600 : 400, transition: 'all 0.15s',
                }}>
                {activeOp ? '✕ Close Request Builder' : '▶ Build Request'}
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                Click an operation to build a request:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 8px', marginBottom: 8 }}>
                {svc.ops.map(op => (
                  <button key={op} onClick={() => setActiveOp(prev => prev === op ? null : op)} style={{
                    fontSize: 11, fontFamily: 'monospace', padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
                    border: activeOp === op ? '1px solid var(--primary)' : '1px solid var(--border)',
                    background: activeOp === op ? 'var(--primary)' : 'var(--surface2)',
                    color: activeOp === op ? '#fff' : 'var(--text)',
                    fontWeight: activeOp === op ? 600 : 400, transition: 'all 0.15s',
                  }}>{op}</button>
                ))}
              </div>
            </>
          )}
          {activeOp && (
            <RequestBuilder
              key={activeOp}
              svc={svc} op={activeOp} type={type}
              version={version} apiName={shortName}
              appName={appName}
              onClose={() => setActiveOp(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}

export function ApiTab({ appName, displayName }) {
  const [data,    setData]    = useKept(`apitab|${appName}|data`, null)
  const [loading, setLoading] = useState(!data)
  const [err,     setErr]     = useState(null)
  const [filter,  setFilter]  = useKept(`apitab|${appName}|filter`, '')
  const [version, setVersion] = useKept(`apitab|${appName}|ver`, 'default')

  useEffect(() => {
    fetch(`/api/local-app/${appName}/current-branch`)
      .then(r => r.json())
      .then(d => { if (d.ok && d.release_ver) setVersion(d.release_ver) })
      .catch(() => {})
  }, [appName])

  function load() {
    setLoading(true)
    fetch(`/api/local-app/${appName}/web-services`)
      .then(r => r.json())
      .then(d => { if (d.ok) { setData(d); setErr(null) } else setErr(d.error) })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { if (!data) load() }, [appName])  // eslint-disable-line react-hooks/exhaustive-deps

  const q    = filter.toLowerCase()
  const match = svc =>
    !q || svc.name.toLowerCase().includes(q) ||
    svc.ops.some(op => op.toLowerCase().includes(q)) ||
    svc.endpoint.toLowerCase().includes(q)

  const soap = (data?.soap || []).filter(match)
  const rest  = (data?.rest  || []).filter(match)

  return (
    <div>
      <DeployedBanner appName={appName} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <input type="text" placeholder="Filter by service name or operation…"
          value={filter} onChange={e => setFilter(e.target.value)}
          style={{
            flex: 1, background: 'var(--surface2)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 4,
            padding: '6px 10px', fontSize: 13,
          }} />
        <button onClick={load} disabled={loading} className="btn btn-sm"
          style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          {loading ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> : '↻ Refresh'}
        </button>
        {data?.url && (
          <a href={data.url} target="_blank" rel="noreferrer"
            className="btn btn-sm" style={{ fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap' }}>
            Open in Browser ↗
          </a>
        )}
      </div>

      {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}

      {loading && !data ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px', borderBottom: '1px solid var(--border)',
              background: 'var(--surface2)' }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>SOAP Services</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{soap.length} service{soap.length !== 1 ? 's' : ''}</span>
            </div>
            {soap.length === 0
              ? <div style={{ padding: '20px 14px', color: 'var(--text-muted)', fontSize: 13 }}>
                  {filter ? 'No matches' : 'None available'}
                </div>
              : soap.map(svc => <ApiServiceRow key={svc.name} svc={svc} type="soap" version={version} appName={appName} />)
            }
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px', borderBottom: '1px solid var(--border)',
              background: 'var(--surface2)' }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>RESTful Services</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{rest.length} service{rest.length !== 1 ? 's' : ''}</span>
            </div>
            {rest.length === 0
              ? <div style={{ padding: '20px 14px', color: 'var(--text-muted)', fontSize: 13 }}>
                  {filter ? 'No matches' : 'None available'}
                </div>
              : rest.map(svc => <ApiServiceRow key={svc.name} svc={svc} type="rest" version={version} appName={appName} />)
            }
          </div>
        </>
      )}
    </div>
  )
}

// ── User Interface Tab ────────────────────────────────────────────────────────

const UI_APP_ICONS = { manager: '🖥️', designer: '✏️', admin: '🔐' }

function _vMajorMinor(v) {
  const m = v && String(v).match(/(\d+)\.(\d+)/)
  return m ? `${m[1]}.${m[2]}` : (v || '')
}

function fmtTime(s) {
  if (!s || s < 0) return '0s'
  const t = Math.round(s)
  return t < 60 ? `${t}s` : `${Math.floor(t / 60)}m ${t % 60}s`
}

function fmtSpeed(bps) {
  if (!bps || bps <= 0) return ''
  if (bps < 1048576) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / 1048576).toFixed(1)} MB/s`
}

function GlossyBar({ percent, label }) {
  const pct = Math.min(100, Math.max(0, percent || 0))
  return (
    <div style={{ width: '100%', height: 22, borderRadius: 11, background: '#e8f5e9',
                  overflow: 'hidden', position: 'relative', border: '1px solid #c8e6c9' }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, bottom: 0, width: `${pct}%`,
        background: 'linear-gradient(to bottom, #81c784 0%, #388e3c 45%, #2e7d32 46%, #43a047 100%)',
        borderRadius: 11, transition: 'width 0.35s ease', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '48%',
                      background: 'linear-gradient(to bottom,rgba(255,255,255,.42),rgba(255,255,255,.05))',
                      borderRadius: '11px 11px 0 0' }} />
      </div>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: 11, fontWeight: 700, zIndex: 1,
                    color: pct > 45 ? '#fff' : '#2e7d32',
                    textShadow: pct > 45 ? '0 1px 2px rgba(0,0,0,.25)' : 'none' }}>
        {label}
      </div>
    </div>
  )
}

function UiAppTile({ app, op, openErr, deployedVersion, onDownload, onRunInstaller, onDeleteInstaller, onOpen, onOpenFolder, onUninstall, onAbort, onAbortDownload, onDismissErr }) {
  const icon  = UI_APP_ICONS[app.app_id] || '📦'
  const phase = op?.phase

  const isDownloading = phase === 'downloading'
  const isInstalling  = phase === 'installing'
  const isError       = phase === 'error'
  const isInstalled   = (app.installed || phase === 'installed') && phase !== 'installing'
  const versionMismatch = !!(deployedVersion && deployedVersion !== 'master' && app.version && app.version !== 'unknown' && _vMajorMinor(app.version) !== _vMajorMinor(deployedVersion))
  const statusText  = versionMismatch && isInstalled ? '⚠ Outdated' : isInstalled ? '✓ Installed' : app.downloaded ? '↓ Downloaded' : 'Not installed'
  const statusColor = versionMismatch && isInstalled ? '#e65100' : isInstalled ? '#2e7d32' : app.downloaded ? '#f57c00' : '#9e9e9e'

  const dlPct   = op?.percent || 0
  const dlLabel = isDownloading
    ? `${Math.round(dlPct)}%${op?.speed ? ` • ${fmtSpeed(op.speed)}` : ''}`
    : `${Math.round(dlPct)}%`

  const instEst     = op?.estimated || 120
  const instElapsed = op?.elapsed || 0
  const instPct     = op?.percent != null
    ? op.percent
    : Math.min(97, (instElapsed / instEst) * 100)
  const instLabel   = op?.phase_label
    ? `${op.phase_label}${op.percent != null ? ` (${Math.round(op.percent)}%)` : ''}`
    : `Installing… ${fmtTime(instElapsed)}`

  return (
    <div style={{ width: 300, border: `1px solid ${versionMismatch && isInstalled ? '#ffb74d' : '#dde2ea'}`, borderRadius: 10, padding: 18,
                  background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.06)',
                  display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 28 }}>{icon}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{app.display_name}</div>
          <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2, color: statusColor }}>
            {statusText}
          </div>
          {app.version && (
            <div style={{ fontSize: 11, color: versionMismatch ? '#e65100' : '#888', marginTop: 1 }}>
              v{app.version}{versionMismatch ? <span style={{ color: '#9e9e9e' }}> — server: v{deployedVersion}</span> : null}
            </div>
          )}
        </div>
      </div>

      {versionMismatch && isInstalled && (
        <div style={{ fontSize: 11, color: '#e65100', background: '#fff3e0', borderRadius: 4, padding: '4px 8px', lineHeight: 1.4 }}>
          UI v{deployedVersion} is not available yet. Installed v{app.version} may be incompatible.
        </div>
      )}

      {isDownloading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <GlossyBar percent={dlPct} label={dlLabel} />
          <div style={{ fontSize: 11, color: '#555', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>⏱ {fmtTime(op?.elapsed)}</span>
            {op?.remaining != null && <span>~{fmtTime(op.remaining)} left</span>}
            <button onClick={onAbortDownload} style={{ fontSize: 10, padding: '2px 8px', background: '#ffebee',
              color: '#c62828', border: '1px solid #e57373', borderRadius: 4, cursor: 'pointer' }}>Abort</button>
          </div>
        </div>
      )}

      {isInstalling && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <GlossyBar percent={instPct} label={instLabel} />
          <div style={{ fontSize: 11, color: '#555', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>⏱ {fmtTime(instElapsed)}</span>
            <span>~{fmtTime(Math.max(0, instEst - instElapsed))} left</span>
            <button onClick={onAbort} style={{ fontSize: 10, padding: '2px 8px', background: '#ffebee',
              color: '#c62828', border: '1px solid #e57373', borderRadius: 4, cursor: 'pointer' }}>Abort</button>
          </div>
        </div>
      )}

      {op?.warning && phase === 'installed' && (
        <div style={{ fontSize: 11, color: '#e65100', background: '#fff3e0', borderRadius: 4, padding: '4px 8px' }}>
          {op.warning}
        </div>
      )}

      {isError && (
        <div style={{ fontSize: 12, color: '#c62828', background: '#ffebee', borderRadius: 4, padding: '5px 8px', lineHeight: 1.4 }}>
          {op.error}
          <button style={{ marginLeft: 8, fontSize: 11, color: '#888', background: 'none', border: 'none', cursor: 'pointer' }} onClick={onDismissErr}>✕</button>
        </div>
      )}

      {openErr && (
        <div style={{ fontSize: 11, borderRadius: 4, padding: '4px 8px', wordBreak: 'break-all',
                      color: openErr.startsWith('✓') ? '#2e7d32' : '#c62828',
                      background: openErr.startsWith('✓') ? '#e8f5e9' : '#ffebee' }}>
          {openErr}
        </div>
      )}

      {!isDownloading && !isInstalling && (
        <div style={{ display: 'flex', gap: 8 }}>
          {isInstalled ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
              <button className="btn btn-sm btn-primary" style={{ width: '100%' }} onClick={onOpen}>Open</button>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm" style={{ flex: 1, fontSize: 11,
                  background: '#e8f5e9', color: '#2e7d32', borderColor: '#a5d6a7' }}
                  onClick={onOpenFolder} title="Open install folder in Explorer">📂 Location</button>
                <button className="btn btn-sm" style={{ flex: 1, fontSize: 11,
                  background: '#ffebee', color: '#c62828', borderColor: '#e57373' }}
                  onClick={onUninstall}>🗑 Uninstall</button>
              </div>
            </div>
          ) : app.downloaded ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
              <button className="btn btn-sm btn-primary" style={{ width: '100%' }} onClick={onRunInstaller}>Run Installer</button>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm" style={{ flex: 1, fontSize: 11,
                  background: '#e3f2fd', color: '#1565c0', borderColor: '#90caf9' }} onClick={onDownload}>↓ Re-download</button>
                <button className="btn btn-sm" style={{ flex: 1, fontSize: 11,
                  background: '#ffebee', color: '#c62828', borderColor: '#e57373' }} onClick={onDeleteInstaller}>🗑 Delete</button>
              </div>
            </div>
          ) : (
            <button className="btn btn-sm btn-primary" style={{ flex: 1 }} onClick={onDownload}>Download</button>
          )}
        </div>
      )}
    </div>
  )
}

export function UserInterfaceTab({ appName, displayName }) {
  const UI_API = `/api/local-app/${appName}/ui-apps`
  const [apps, setApps]               = useState([])
  const [config, setConfig]           = useState({ base_url: '', version: '', installers_base: '', installed_base: '', ui_version: '' })
  const [loading, setLoading]         = useState(true)
  const [err, setErr]                 = useState(null)
  const [editConfig, setEditConfig]   = useState(false)
  const [draftConfig, setDraftConfig] = useState({})
  const [savingConfig, setSavingConfig] = useState(false)
  const [dlOps, setDlOps]             = useState({})
  const [openErr, setOpenErr]         = useState({})
  const pollRef                       = useRef({})

  const stopPoll = (appId) => {
    if (pollRef.current[appId]) { clearInterval(pollRef.current[appId]); delete pollRef.current[appId] }
  }

  const startPoll = (appId, endpoint, ms, onDone) => {
    stopPoll(appId)
    pollRef.current[appId] = setInterval(() => {
      fetch(endpoint).then(r => r.json()).then(d => {
        setDlOps(p => ({ ...p, [appId]: { ...(p[appId] || {}), ...d } }))
        if (['done', 'timeout', 'error', 'aborted'].includes(d.status)) { stopPoll(appId); onDone(d) }
      }).catch(() => {})
    }, ms)
  }

  const load = () => {
    setLoading(true)
    fetch(UI_API)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setConfig(d.config); setApps(d.apps)
          d.apps.forEach(app => {
            fetch(`${UI_API}/${app.app_id}/install-progress`)
              .then(r => r.json())
              .then(prog => {
                if (prog.status === 'installing') {
                  setDlOps(p => ({ ...p, [app.app_id]: { ...prog, phase: 'installing' } }))
                  startPoll(app.app_id, `${UI_API}/${app.app_id}/install-progress`, 1000, (result) => {
                    const done = result.status === 'done'
                    setDlOps(p => ({ ...p, [app.app_id]: { ...p[app.app_id],
                      phase: done ? 'installed' : 'error',
                      error: !done ? (result.error || 'Installation failed') : null,
                      warning: result.warning || null } }))
                    load()
                  })
                } else {
                  fetch(`${UI_API}/${app.app_id}/download/progress`)
                    .then(r => r.json())
                    .then(dlProg => {
                      if (['downloading', 'starting'].includes(dlProg.status)) {
                        setDlOps(p => ({ ...p, [app.app_id]: { ...dlProg, phase: 'downloading' } }))
                        startPoll(app.app_id, `${UI_API}/${app.app_id}/download/progress`, 600, (result) => {
                          if (result.status === 'done') {
                            setDlOps(p => ({ ...p, [app.app_id]: { ...p[app.app_id], phase: 'downloaded' } }))
                            load()
                          } else if (result.status === 'aborted') {
                            setDlOps(p => ({ ...p, [app.app_id]: { phase: 'error', error: 'Download aborted' } }))
                          } else {
                            setDlOps(p => ({ ...p, [app.app_id]: { phase: 'error', error: result.error || 'Download failed' } }))
                          }
                        })
                      }
                    })
                    .catch(() => {})
                }
              })
              .catch(() => {})
          })
        } else setErr(d.error)
      })
      .catch(e => setErr(String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])
  useEffect(() => () => { Object.values(pollRef.current).forEach(clearInterval) }, [])

  const doDownload = (app) => {
    setDlOps(p => ({ ...p, [app.app_id]: { phase: 'downloading', status: 'starting', percent: 0 } }))
    fetch(`${UI_API}/${app.app_id}/download`, { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) { setDlOps(p => ({ ...p, [app.app_id]: { phase: 'error', error: d.error } })); return }
        startPoll(app.app_id, `${UI_API}/${app.app_id}/download/progress`, 600, (result) => {
          if (result.status === 'done') {
            setDlOps(p => ({ ...p, [app.app_id]: { ...p[app.app_id], phase: 'downloaded' } }))
            load()
          } else if (result.status === 'aborted') {
            setDlOps(p => ({ ...p, [app.app_id]: { phase: 'error', error: 'Download aborted' } }))
          } else {
            setDlOps(p => ({ ...p, [app.app_id]: { phase: 'error', error: result.error || 'Download failed' } }))
          }
        })
      })
      .catch(e => setDlOps(p => ({ ...p, [app.app_id]: { phase: 'error', error: String(e) } })))
  }

  const doRunInstaller = (app) => {
    setDlOps(p => ({ ...p, [app.app_id]: { phase: 'installing', status: 'installing', elapsed: 0 } }))
    fetch(`${UI_API}/${app.app_id}/run-installer`, { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) { setDlOps(p => ({ ...p, [app.app_id]: { phase: 'error', error: d.error } })); return }
        startPoll(app.app_id, `${UI_API}/${app.app_id}/install-progress`, 1000, (result) => {
          const done    = result.status === 'done'
          const aborted = result.status === 'aborted'
          setDlOps(p => ({ ...p, [app.app_id]: { ...p[app.app_id],
            phase: done ? 'installed' : 'error',
            error: (!done && !aborted) ? (result.error || 'Installation failed') : (aborted ? 'Aborted' : null),
            warning: result.warning || null } }))
          load()
        })
      })
      .catch(e => setDlOps(p => ({ ...p, [app.app_id]: { phase: 'error', error: String(e) } })))
  }

  const doAbort          = (app) => { fetch(`${UI_API}/${app.app_id}/install/abort`,   { method: 'POST' }).catch(() => {}) }
  const doAbortDownload  = (app) => { fetch(`${UI_API}/${app.app_id}/download/abort`,  { method: 'POST' }).catch(() => {}) }
  const doDeleteInstaller = (app) => {
    fetch(`${UI_API}/${app.app_id}/installer`, { method: 'DELETE' })
      .then(r => r.json()).then(d => { if (d.ok) load() }).catch(() => {})
  }
  const doOpenFolder = (app) => {
    fetch(`${UI_API}/${app.app_id}/open-folder`, { method: 'POST' })
      .then(r => r.json()).then(d => { if (!d.ok) setOpenErr(p => ({ ...p, [app.app_id]: d.error })) }).catch(() => {})
  }
  const doOpen = (app) => {
    fetch(`${UI_API}/${app.app_id}/open`, { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) setOpenErr(p => ({ ...p, [app.app_id]: d.error }))
        else if (d.message) setOpenErr(p => ({ ...p, [app.app_id]: `✓ ${d.message}` }))
      })
      .catch(e => setOpenErr(p => ({ ...p, [app.app_id]: String(e) })))
  }
  const doUninstall = (app) => {
    if (!confirm(`Uninstall ${app.display_name}?`)) return
    fetch(`${UI_API}/${app.app_id}/uninstall`, { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) { setOpenErr(p => ({ ...p, [app.app_id]: d.error })); return }
        setDlOps(p => ({ ...p, [app.app_id]: null }))
        load()
      })
      .catch(e => setOpenErr(p => ({ ...p, [app.app_id]: String(e) })))
  }

  const saveConfig = () => {
    setSavingConfig(true)
    fetch(`${UI_API}/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draftConfig) })
      .then(r => r.json())
      .then(d => { if (d.ok) { setConfig(d.config); setApps(d.apps); setEditConfig(false); setDraftConfig({}) } else alert(d.error) })
      .catch(e => alert(String(e)))
      .finally(() => setSavingConfig(false))
  }

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>
  if (err)     return <div style={{ padding: 24, color: '#c62828' }}>Error: {err}</div>

  return (
    <div style={{ padding: '16px 0' }}>
      <DeployedBanner appName={appName} />
      <div style={{ background: '#f5f7fa', border: '1px solid #e0e4ea', borderRadius: 8,
                    padding: '10px 14px', marginBottom: 20, display: 'flex', alignItems: 'center',
                    gap: 12, flexWrap: 'wrap' }}>
        {editConfig ? (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span style={{ whiteSpace: 'nowrap', color: '#555', fontWeight: 500 }}>Base URL:</span>
              <input style={{ width: 320, fontSize: 13, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4 }}
                value={draftConfig.base_url ?? config.base_url}
                onChange={e => setDraftConfig(p => ({ ...p, base_url: e.target.value }))} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span style={{ whiteSpace: 'nowrap', color: '#555', fontWeight: 500 }}>Version:</span>
              <input style={{ width: 170, fontSize: 13, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4 }}
                value={draftConfig.version ?? config.version}
                onChange={e => setDraftConfig(p => ({ ...p, version: e.target.value }))} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span style={{ whiteSpace: 'nowrap', color: '#555', fontWeight: 500 }}>Installers Base:</span>
              <input style={{ width: 380, fontSize: 13, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4 }}
                value={draftConfig.installers_base ?? config.installers_base}
                onChange={e => setDraftConfig(p => ({ ...p, installers_base: e.target.value }))} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span style={{ whiteSpace: 'nowrap', color: '#555', fontWeight: 500 }}>Installed Base:</span>
              <input style={{ width: 380, fontSize: 13, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4 }}
                value={draftConfig.installed_base ?? config.installed_base}
                onChange={e => setDraftConfig(p => ({ ...p, installed_base: e.target.value }))} />
            </label>
            <button className="btn btn-sm btn-primary" onClick={saveConfig} disabled={savingConfig}>{savingConfig ? 'Saving…' : 'Save'}</button>
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
              {config.ui_version && _vMajorMinor(config.ui_version) !== _vMajorMinor(config.version) && (
                <span style={{ color: '#e65100', marginLeft: 4 }} title={`UI v${config.version} not yet available on ClickOnce server — showing closest version ${config.ui_version}`}>
                  → UI: <code style={{ fontSize: 12 }}>{config.ui_version}</code> <em style={{ fontSize: 11 }}>(v{config.version} not available)</em>
                </span>
              )}
            </span>
            <span style={{ fontSize: 13, color: '#444' }}>
              &nbsp;|&nbsp;<strong>Installers Base:</strong>&nbsp;
              {config.installers_base ? <code style={{ fontSize: 12 }}>{config.installers_base}</code> : <em style={{ color: '#aaa' }}>not set</em>}
            </span>
            <span style={{ fontSize: 13, color: '#444' }}>
              &nbsp;|&nbsp;<strong>Installed Base:</strong>&nbsp;
              {config.installed_base ? <code style={{ fontSize: 12 }}>{config.installed_base}</code> : <em style={{ color: '#aaa' }}>not set</em>}
            </span>
            <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => { setEditConfig(true); setDraftConfig({}) }}>Edit Config</button>
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        {apps.map(app => (
          <UiAppTile
            key={app.app_id}
            app={app}
            op={dlOps[app.app_id]}
            openErr={openErr[app.app_id]}
            deployedVersion={config.version}
            onDownload={() => doDownload(app)}
            onRunInstaller={() => doRunInstaller(app)}
            onDeleteInstaller={() => doDeleteInstaller(app)}
            onOpen={() => doOpen(app)}
            onOpenFolder={() => doOpenFolder(app)}
            onUninstall={() => doUninstall(app)}
            onAbort={() => doAbort(app)}
            onAbortDownload={() => doAbortDownload(app)}
            onDismissErr={() => setDlOps(p => ({ ...p, [app.app_id]: null }))}
          />
        ))}
      </div>
    </div>
  )
}

// ── Branch Management (private helper for CodeTab) ────────────────────────────

function BranchManagementPanel({ appName, onCheckout, onCurrentChange, style: outerStyle }) {
  const [localBranches, setLocalBranches] = useState([])
  const [currentLocal,  setCurrentLocal]  = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [err,           setErr]           = useState(null)
  const [selected,      setSelected]      = useState('')
  const [checkoutName,  setCheckoutName]  = useState('')
  const [checking,      setChecking]      = useState(false)
  const [checkoutErr,   setCheckoutErr]   = useState(null)
  const [checkoutOk,    setCheckoutOk]    = useState(null)
  const [deleting,      setDeleting]      = useState(false)
  const [deleteErr,     setDeleteErr]     = useState(null)
  const [copiedBranch,  setCopiedBranch]  = useState(false)

  function copyBranch() {
    if (!currentLocal) return
    navigator.clipboard.writeText(currentLocal).then(() => {
      setCopiedBranch(true)
      setTimeout(() => setCopiedBranch(false), 1500)
    })
  }

  useEffect(() => { if (currentLocal) onCurrentChange?.(currentLocal) }, [currentLocal])

  function load() {
    setLoading(true); setErr(null)
    fetch(`/api/local-app/${appName}/git-local-branches`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setLocalBranches(d.branches || []); setCurrentLocal(d.current || null); setSelected(d.current || d.branches?.[0] || '') }
        else setErr(d.error || 'Failed to load branches')
      })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [appName])

  function doCheckout(branch) {
    if (!branch) return
    setChecking(true); setCheckoutErr(null); setCheckoutOk(null)
    fetch(`/api/local-app/${appName}/git-checkout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setCheckoutOk(`Switched to branch '${branch}'`); setCheckoutName(''); load(); onCheckout?.(); setTimeout(() => setCheckoutOk(null), 4000) }
        else setCheckoutErr(d.error || 'Checkout failed')
      })
      .catch(() => setCheckoutErr('Could not reach server'))
      .finally(() => setChecking(false))
  }

  const [confirmDel, setConfirmDel] = useState(null)
  function doDelete(branch) {
    setConfirmDel(null)
    setDeleting(true); setDeleteErr(null)
    fetch(`/api/local-app/${appName}/git-branch`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch }),
    })
      .then(r => r.json())
      .then(d => { if (d.ok) load(); else setDeleteErr(d.error || 'Delete failed') })
      .catch(() => setDeleteErr('Could not reach server'))
      .finally(() => setDeleting(false))
  }

  // ── Merge release branch into the checked-out feature branch ──
  // The merge runs as a detached server job, so it keeps going if the Workbench restarts; this panel
  // re-attaches to it (and to its final result) whenever it is shown.
  const [mr,     setMr]     = useState(null)    // status: {current, release, is_feature, merging, conflicts}
  const [mrBusy, setMrBusy] = useState('')      // '' | 'abort' | 'ide' | 'start'
  const [mrRes,  setMrRes]  = useState(null)    // {kind: running|ok|dirty|conflict|error, ...}
  function jobToRes(j) {
    const phase = j.phase === 'pushing' ? 'Pushing to origin…' : j.mode === 'finish' ? 'Completing merge…' : `Pulling origin/${j.release}…`
    if (j.status === 'running') return { kind: 'running', message: phase, output: j.output }
    if (j.status === 'ok') return { kind: 'ok', message: j.message, output: j.output, job: true }
    if (j.status === 'conflict') return { kind: 'conflict', conflicts: j.conflicts || [], error: j.message, output: j.output, job: true }
    return { kind: 'error', error: j.message || 'Failed', output: j.output, job: true }
  }
  function loadMr() {
    fetch(`/api/local-app/${appName}/merge-release/status`).then(r => r.json())
      .then(d => {
        if (!d.ok) { setMr(null); return }
        setMr(d)
        if (d.merging && d.conflicts?.length) setMrRes(r => r || { kind: 'conflict', conflicts: d.conflicts, error: 'A merge is in progress with unresolved conflicts.' })
      }).catch(() => {})
    fetch(`/api/local-app/${appName}/merge-release/job`).then(r => r.json())
      .then(d => { if (d.ok && d.job) setMrRes(jobToRes(d.job)) }).catch(() => {})
  }
  useEffect(() => { loadMr() }, [appName, currentLocal])

  // poll while a merge job is running (also after coming back to the page / a Workbench restart)
  useEffect(() => {
    if (mrRes?.kind !== 'running') return
    const id = setInterval(() => {
      fetch(`/api/local-app/${appName}/merge-release/job`).then(r => r.json())
        .then(d => {
          if (!d.ok || !d.job) return
          setMrRes(jobToRes(d.job))
          if (d.job.status !== 'running') loadMr()
        }).catch(() => {})
    }, 2000)
    return () => clearInterval(id)
  }, [mrRes?.kind, appName])

  function startJob(path) {
    setMrBusy('start')
    return fetch(`/api/local-app/${appName}/merge-release${path}`, { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.job) setMrRes(jobToRes(d.job))
        else if (d.code === 'dirty') setMrRes({ kind: 'dirty', files: d.files || [], error: d.error })
        else if (d.code === 'conflict') setMrRes({ kind: 'conflict', conflicts: d.conflicts || [], error: d.error })
        else setMrRes({ kind: 'error', error: d.error || 'Failed' })
      })
      .catch(() => setMrRes({ kind: 'error', error: 'Could not reach server' }))
      .finally(() => setMrBusy(''))
  }
  const mergeRelease = () => { setMrRes(null); startJob('') }
  const finishMerge  = () => startJob('/finish')
  const abortMerge   = () => {
    setMrBusy('abort')
    fetch(`/api/local-app/${appName}/merge-release/abort`, { method: 'POST' }).then(r => r.json())
      .then(d => setMrRes(d.ok ? { kind: 'ok', message: 'Merge aborted - the branch is back to its previous state.' } : { kind: 'error', error: d.error }))
      .catch(() => setMrRes({ kind: 'error', error: 'Could not reach server' }))
      .finally(() => { setMrBusy(''); loadMr() })
  }
  const openIde = () => {
    setMrBusy('ide')
    fetch(`/api/local-app/${appName}/merge-release/open-ide`, { method: 'POST' }).then(r => r.json())
      .then(d => { if (!d.ok) setMrRes(r => ({ ...(r || { kind: 'conflict', conflicts: [] }), error: d.error })) })
      .catch(() => {}).finally(() => setMrBusy(''))
  }
  const dismissMr = () => { setMrRes(null); fetch(`/api/local-app/${appName}/merge-release/job/dismiss`, { method: 'POST' }).catch(() => {}) }
  const mrRunning = mrRes?.kind === 'running'

  const isProtected = b => !b || /^(master|main)$/i.test(b) || /release/i.test(b)

  return (
    <div className="card" style={{ marginBottom: 0, ...outerStyle }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <div style={{ fontWeight: 600, fontSize: 14, flexShrink: 0 }}>Branch Management</div>
        <span style={{ color: 'var(--border)', fontSize: 16 }}>|</span>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>Feature Branch:</div>
        {loading
          ? <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />
          : <span
              onClick={copyBranch}
              title={copiedBranch ? '✓ copied' : (currentLocal || undefined)}
              style={{ fontWeight: 600, fontSize: 12, padding: '2px 10px', borderRadius: 12, background: copiedBranch ? 'rgba(76,175,80,0.2)' : 'rgba(76,175,80,0.1)', color: copiedBranch ? '#1b5e20' : '#2e7d32', border: '1px solid rgba(76,175,80,0.3)', fontFamily: 'monospace', cursor: currentLocal ? 'pointer' : 'default', userSelect: 'all', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'middle' }}>
              {copiedBranch ? '✓ copied' : (currentLocal || '—')}
            </span>
        }
        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {localBranches.length} branch{localBranches.length !== 1 ? 'es' : ''} checked out
        </span>
        {mr?.is_feature && !mr.merging && (
          <button className="btn btn-sm" onClick={mergeRelease} disabled={!!mrBusy || loading || mrRunning}
            title={`git pull origin ${mr.release}, then push ${mr.current}`}
            style={{ marginLeft: 'auto', color: '#1565c0', borderColor: '#90caf9' }}>
            {mrRunning || mrBusy === 'start' ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Merging…</> : '⇄ Merge Release Branch'}
          </button>
        )}
        <button className="btn btn-sm" onClick={load} disabled={loading} title="Refresh" style={mr?.is_feature && !mr.merging ? undefined : { marginLeft: 'auto' }}>↻</button>
      </div>

      {err && <div className="alert alert-error" style={{ marginBottom: 6, fontSize: 12 }}>{err}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>Switch/Delete:</div>
        <select value={selected} onChange={e => setSelected(e.target.value)} disabled={localBranches.length === 0 || checking}
          style={{ flex: '1 1 0', minWidth: 0, padding: '6px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 13, fontFamily: 'inherit' }}>
          {localBranches.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <button className="btn btn-sm btn-primary" style={{ flexShrink: 0 }} disabled={checking || deleting || !selected || selected === currentLocal} onClick={() => doCheckout(selected)}>
          {checking ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Switching…</> : 'Switch'}
        </button>
        {selected && selected !== currentLocal && !isProtected(selected) && (
          <button className="btn btn-sm" style={{ flexShrink: 0, color: '#c62828', borderColor: '#e57373' }} disabled={checking || deleting} onClick={() => setConfirmDel(selected)}>
            {deleting ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Deleting…</> : 'Delete'}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>Checkout branch:</div>
        <input type="text" placeholder="branch name or remote branch…" value={checkoutName} onChange={e => setCheckoutName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doCheckout(checkoutName.trim())} disabled={checking}
          style={{ flex: '1 1 200px', maxWidth: 320 }} />
        <button className="btn btn-sm btn-primary" disabled={checking || !checkoutName.trim()} onClick={() => doCheckout(checkoutName.trim())}>
          {checking ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Checking out…</> : 'Checkout'}
        </button>
      </div>

      {checkoutErr && <div className="alert alert-error" style={{ marginTop: 6, fontSize: 12 }}>{checkoutErr}</div>}
      {deleteErr   && <div className="alert alert-error" style={{ marginTop: 6, fontSize: 12 }}>{deleteErr}</div>}
      {confirmDel && (
        <ConfirmDialog
          title="Delete branch"
          message={<>Delete local branch <code style={{ color: 'var(--text)' }}>{confirmDel}</code>? This cannot be undone.</>}
          confirmLabel="Delete"
          onConfirm={() => doDelete(confirmDel)}
          onCancel={() => setConfirmDel(null)}
        />
      )}
      {checkoutOk  && <div className="alert alert-info"  style={{ marginTop: 6, fontSize: 12 }}>{checkoutOk}</div>}
      {mrRes && (
        <div className="card" style={{ marginTop: 8, padding: '10px 12px', fontSize: 12,
          borderLeft: `3px solid ${mrRes.kind === 'ok' ? '#2e7d32' : mrRes.kind === 'conflict' ? '#ef6c00' : '#c62828'}` }}>
          {mrRes.kind === 'running' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
              <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> {mrRes.message}
              <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(keeps running if the Workbench is restarted)</span>
            </div>
          )}
          {mrRes.kind === 'ok' && <div style={{ color: '#2e7d32', fontWeight: 600 }}>✓ {mrRes.message}</div>}
          {mrRes.kind === 'dirty' && (
            <>
              <div style={{ fontWeight: 600, color: '#c62828' }}>Local changes or untracked files found - revert/remove them before merging.</div>
              <div style={{ margin: '4px 0', color: 'var(--text-muted)' }}>{mr?.release ? `Merging '${mr.release}' needs a clean working tree.` : ''}</div>
              <pre style={{ margin: 0, maxHeight: 140, overflow: 'auto', fontSize: 11 }}>{(mrRes.files || []).join('\n')}</pre>
            </>
          )}
          {mrRes.kind === 'conflict' && (
            <>
              <div style={{ fontWeight: 600, color: '#ef6c00' }}>Merge conflicts in {(mrRes.conflicts || []).length} file{(mrRes.conflicts || []).length !== 1 ? 's' : ''}</div>
              <pre style={{ margin: '4px 0', maxHeight: 140, overflow: 'auto', fontSize: 11 }}>{(mrRes.conflicts || []).join('\n')}</pre>
              {mrRes.error && <div style={{ color: 'var(--text-muted)', marginBottom: 6 }}>{mrRes.error}</div>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-sm btn-primary" onClick={openIde} disabled={!!mrBusy}>
                  {mrBusy === 'ide' ? 'Opening…' : 'Resolve in IntelliJ'}
                </button>
                <button className="btn btn-sm" onClick={finishMerge} disabled={!!mrBusy} title="After resolving: commit the merge and push">
                  {"I've resolved - Continue & Push"}
                </button>
                <button className="btn btn-sm" onClick={abortMerge} disabled={!!mrBusy} style={{ color: '#c62828', borderColor: '#e57373' }}>
                  {mrBusy === 'abort' ? 'Aborting…' : 'Abort Merge'}
                </button>
              </div>
            </>
          )}
          {mrRes.kind === 'error' && <div style={{ color: '#c62828', whiteSpace: 'pre-wrap' }}>{mrRes.error}</div>}
          {mrRes.output && mrRes.kind !== 'dirty' && (
            <details style={{ marginTop: 6 }}><summary style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>git output</summary>
              <pre style={{ margin: '4px 0 0', maxHeight: 160, overflow: 'auto', fontSize: 11 }}>{mrRes.output}</pre></details>
          )}
          {mrRes.kind !== 'conflict' && mrRes.kind !== 'running' && (
            <button className="btn btn-sm" onClick={dismissMr} style={{ marginTop: 6 }}>Dismiss</button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Code Tab ──────────────────────────────────────────────────────────────────

const CODE_TAB_DEFAULT_PANELS = [
  { key: 'current_branch',    enabled: true, order: 1 },
  { key: 'set_branch',        enabled: true, order: 2 },
  { key: 'branch_management', enabled: true, order: 3 },
  { key: 'ide',               enabled: true, order: 4 },
  { key: 'terminal',          enabled: true, order: 5 },
  { key: 'build_deploy',      enabled: true, order: 6 },
  { key: 'modules',           enabled: true, order: 7 },
]

export function CodeTab({ appName, displayName, icon, onDeployed, onBranchChange }) {
  const [branch,       setBranch]       = useState(null)
  const [branchLoad,   setBranchLoad]   = useState(true)
  const [branchErr,    setBranchErr]    = useState(null)
  const [screenCfg,    setScreenCfg]    = useState(null)
  const [localBranch,  setLocalBranch]  = useState(null)

  useEffect(() => { onBranchChange?.(localBranch) }, [localBranch])

  function loadCurrent(force = false) {
    setBranchLoad(true); setBranchErr(null)
    const url = `/api/local-app/${appName}/current-branch${force ? '?force=true' : ''}`
    fetch(url)
      .then(r => r.json())
      .then(d => { if (d.ok) setBranch(d); else setBranchErr(d.error || 'Failed') })
      .catch(() => setBranchErr('Could not reach server'))
      .finally(() => setBranchLoad(false))
  }

  useEffect(() => {
    loadCurrent()
    fetch(`/api/local-app/${appName}/screen-config`)
      .then(r => r.json())
      .then(d => { if (d.ok) setScreenCfg(d) })
      .catch(() => {})
  }, [appName])

  const panels       = screenCfg?.panels || CODE_TAB_DEFAULT_PANELS
  const panelOn      = key => panels.find(p => p.key === key)?.enabled !== false
  const buildFlagsCfg = screenCfg?.build_flags ?? null

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>

        {(panelOn('current_branch') || panelOn('set_branch') || panelOn('branch_management') || panelOn('ide') || panelOn('terminal')) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 16, alignItems: 'stretch' }}>

            {/* Row 1 Col 1 — Current Branch */}
            {panelOn('current_branch')
              ? <CurrentBranchPanel appName={appName} icon={icon} branch={branch} branchLoad={branchLoad} branchErr={branchErr} onRefresh={() => loadCurrent(true)} />
              : <div />
            }

            {/* Row 1 Col 2 — Set Branch */}
            {panelOn('set_branch')
              ? <SetBranchPanel appName={appName} displayName={displayName} onBranchSet={() => loadCurrent(true)} />
              : <div />
            }

            {/* Row 2 Col 1 — Branch Management */}
            {panelOn('branch_management')
              ? <BranchManagementPanel appName={appName} onCheckout={() => loadCurrent(true)}
                  onCurrentChange={setLocalBranch}
                  style={{ marginBottom: 0 }} />
              : <div />
            }

            {/* Row 2 Col 2 — IDE | AIDev  /  Terminal | GP Run */}
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gridAutoRows: 'auto', gap: 10, alignItems: 'stretch', alignSelf: 'start' }}>
              {panelOn('ide')
                ? <ActionCard appName={appName} title={`Open ${displayName} in IDE`} icon="🧠"
                    action="open-ide" btnLabel="Open in IntelliJ"
                    style={{ marginBottom: 0 }} compact />
                : <div />}
              {panelOn('aidev')
                ? <AiDevCard kind="local" appName={appName} branch={localBranch || branch?.branch} style={{ marginBottom: 0 }} />
                : <div />}
              {panelOn('terminal')
                ? <ActionCard appName={appName} title={`Open ${displayName} in Terminal`} icon="💻"
                    action="open-terminal" btnLabel="Open PowerShell"
                    style={{ marginBottom: 0 }} compact />
                : <div />}
              <div style={{ minWidth: 0 }}>
                <GpRunPanel appName={appName} branch={localBranch || branch?.branch} releaseBranch={branch?.branch} />
              </div>
            </div>

          </div>
        )}

        {panelOn('build_deploy') && (
          <BuildCard appName={appName} displayName={displayName} branch={branch} onDeployed={onDeployed} buildFlagsCfg={buildFlagsCfg} />
        )}
      </div>

      {panelOn('modules') && (
        <div style={{ width: 340, flexShrink: 0 }}>
          <ModulePanel appName={appName} displayName={displayName} srcdir={branch?.srcdir} />
        </div>
      )}
    </div>
  )
}

// ── GP Run Panel ──────────────────────────────────────────────────────────────

function _gpAppName(appName) {
  if (!appName) return ''
  if (appName.toLowerCase() === 'pik') return 'PIK'
  return appName.charAt(0).toUpperCase() + appName.slice(1)
}

import IntegGroupPicker, { selectedIntegGroups } from '../components/IntegGroupPicker'
const GP_INTEG_LS = 'gp_integ_settings'

function GpRunModal({ gpApp, featureBranch: initFeature, destBranch: initDest, releaseBranch, onClose }) {
  const isYes = v => String(v || '').toLowerCase() === 'yes'

  const computedDest = releaseBranch
    ? ((releaseBranch === 'master' || releaseBranch === 'main') ? releaseBranch : `release-${releaseBranch}`) : ''

  const [form, setForm] = useState({
    feature_branch:       initFeature || '',
    dest_branch:          computedDest || initDest || '',
    auto_merge:           false,
    run_sonar:            true,
    run_integration_test: false,
  })
  const [destEdited,       setDestEdited]       = useState(false)
  const [busy,             setBusy]             = useState(false)
  const [err,              setErr]              = useState('')
  const [showIntegSettings, setShowIntegSettings] = useState(false)

  useEffect(() => {
    if (!destEdited && releaseBranch) {
      setForm(f => ({ ...f, dest_branch: (releaseBranch === 'master' || releaseBranch === 'main') ? releaseBranch : `release-${releaseBranch}` }))
    }
  }, [releaseBranch])
  const [integCategories,   setIntegCategories]   = useState([])
  const [integGroups,       setIntegGroups]       = useState({})
  const [integSettings,     setIntegSettings]     = useState(() => {
    try { return JSON.parse(localStorage.getItem(GP_INTEG_LS) || '{}') } catch { return {} }
  })

  useEffect(() => {
    fetch(`/api/tools/gp-run/integ-config?app=${encodeURIComponent(gpApp)}`)
      .then(r => r.json())
      .then(d => { if (d.ok) { setIntegCategories(d.categories); setIntegGroups(d.groups || {}) } })
      .catch(() => {})
  }, [gpApp])

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(null) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  function saveInteg(upd) {
    const next = { ...integSettings, ...upd }
    setIntegSettings(next)
    localStorage.setItem(GP_INTEG_LS, JSON.stringify(next))
  }

  function handleDestChange(v) {
    setDestEdited(true)
    setForm(p => ({ ...p, dest_branch: v }))
  }

  async function submit() {
    if (!form.dest_branch.trim()) { setErr('Dest Branch is required.'); return }
    setBusy(true); setErr('')
    const catOptions = integCategories.length > 0 ? integCategories : ['Platform']
    const currentCat = integSettings.category || catOptions[0]
    const catGroups    = integGroups[currentCat] || []
    const pickedGroups = selectedIntegGroups(catGroups, (integSettings.excluded || {})[currentCat])
    const useCustom    = !!(integSettings.custom_groups || '').trim()
    if (form.run_integration_test && !useCustom && catGroups.length > 0 && pickedGroups.length === 0) {
      setBusy(false); setErr('Select at least one INTEG_TEST_GROUP.'); return
    }
    try {
      const r = await fetch('/api/tools/gp-run/trigger', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app:                  gpApp,
          feature_branch:       form.feature_branch,
          dest_branch:          form.dest_branch,
          auto_merge:           form.auto_merge ? 'yes' : 'no',
          run_sonar:            form.run_sonar  ? 'yes' : 'no',
          run_integration_test: form.run_integration_test ? 'yes' : 'no',
          integ_category:       form.run_integration_test ? currentCat : '',
          integ_custom:         form.run_integration_test ? (integSettings.custom_groups || '') : '',
          // only sent when something was deselected; otherwise the category's full list applies
          integ_groups:         form.run_integration_test && !useCustom && pickedGroups.length < catGroups.length ? pickedGroups.join(',') : '',
        }),
      })
      const d = await r.json()
      if (d.ok) onClose(d.run_id)
      else setErr(d.error || 'Failed to trigger.')
    } catch { setErr('Request failed.') }
    setBusy(false)
  }

  const catOptions = integCategories.length > 0 ? integCategories : ['Platform']
  const currentCat = integSettings.category || catOptions[0]

  return (
    <div className="modal-overlay" onClick={() => onClose(null)}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <span className="modal-title">New GP Run — {gpApp}</span>
          <button className="modal-close" onClick={() => onClose(null)}>✕</button>
        </div>
        <div className="modal-body">
          {[
            { name: 'feature_branch', label: 'Feature Branch', placeholder: 'e.g. feature/PAYOR-208524' },
            { name: 'dest_branch',    label: 'Dest Branch *',  placeholder: 'e.g. main' },
          ].map(f => (
            <div key={f.name} className="form-group">
              <label className="field-label">{f.label}</label>
              <input placeholder={f.placeholder} value={form[f.name]}
                onChange={e => f.name === 'dest_branch'
                  ? handleDestChange(e.target.value)
                  : setForm(p => ({ ...p, [f.name]: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && submit()} />
            </div>
          ))}

          <div style={{ display: 'flex', gap: 20, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {[
              { name: 'auto_merge', label: 'Auto Merge' },
              { name: 'run_sonar',  label: 'Run Sonar'  },
            ].map(f => (
              <label key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                <input type="checkbox" checked={form[f.name]}
                  onChange={e => setForm(p => ({ ...p, [f.name]: e.target.checked }))}
                  style={{ width: 16, height: 16, cursor: 'pointer' }} />
                {f.label}
              </label>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                <input type="checkbox" checked={form.run_integration_test}
                  onChange={e => setForm(p => ({ ...p, run_integration_test: e.target.checked }))}
                  style={{ width: 16, height: 16, cursor: 'pointer' }} />
                Integration Test
              </label>
              <button type="button" title="Configure integration test settings"
                onClick={() => setShowIntegSettings(p => !p)}
                style={{
                  background: showIntegSettings ? 'rgba(88,166,255,0.12)' : 'transparent',
                  border: '1px solid ' + (showIntegSettings ? '#58a6ff' : 'var(--border)'),
                  borderRadius: 5, cursor: 'pointer', padding: '2px 6px',
                  color: showIntegSettings ? '#58a6ff' : 'var(--text-muted)', fontSize: 14, lineHeight: 1,
                }}>⚙</button>
            </div>
          </div>

          {showIntegSettings && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface2)', padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#58a6ff', marginBottom: 10 }}>Integration Test Settings</div>
              <div className="form-group" style={{ marginBottom: 10 }}>
                <label className="field-label" style={{ fontSize: 11 }}>Test Group Category</label>
                <select value={currentCat} onChange={e => saveInteg({ category: e.target.value })}
                  style={{ fontSize: 13, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', width: '100%' }}>
                  {catOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <IntegGroupPicker
                groups={integGroups[currentCat] || []}
                excluded={(integSettings.excluded || {})[currentCat]}
                disabled={!!(integSettings.custom_groups || '').trim()}
                onChange={ex => saveInteg({ excluded: { ...(integSettings.excluded || {}), [currentCat]: ex } })} />
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="field-label" style={{ fontSize: 11 }}>Custom Test Groups <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(comma-separated, overrides category)</span></label>
                <textarea value={integSettings.custom_groups || ''}
                  onChange={e => saveInteg({ custom_groups: e.target.value })}
                  placeholder="e.g. com.healthedge.cvc.impl.finance.billing.test.**"
                  rows={3}
                  style={{ fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', width: '100%', resize: 'vertical', fontFamily: 'monospace', boxSizing: 'border-box' }} />
              </div>
            </div>
          )}

          {err && <div className="alert alert-error">{err}</div>}
          <div className="flex-gap" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" onClick={() => onClose(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={submit} disabled={busy}>
              {busy ? 'Triggering…' : '▶ Trigger Run'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── GP Run Terminal modal ─────────────────────────────────────────────────────
function GpRunTerminalModal({ runId, onClose, onStatusChange }) {
  const [output,   setOutput]   = useState('')
  const [status,   setStatus]   = useState('running')
  const [aborting, setAborting] = useState(false)
  const outputRef = useRef(null)
  const pollRef   = useRef(null)

  useEffect(() => {
    if (!runId) return
    function poll() {
      fetch(`/api/tools/gp-run/output/${runId}`)
        .then(r => r.json())
        .then(d => {
          if (!d.ok) { clearInterval(pollRef.current); setStatus('lost'); onStatusChange?.('lost'); return }
          setOutput(d.output || '')
          setStatus(d.status)
          if (d.status !== 'running') { clearInterval(pollRef.current); onStatusChange?.(d.status) }
        })
        .catch(() => {})
    }
    poll()
    pollRef.current = setInterval(poll, 1000)
    return () => clearInterval(pollRef.current)
  }, [runId])

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [output])

  async function abort() {
    setAborting(true)
    try {
      await fetch(`/api/tools/gp-run/abort/${runId}`, { method: 'POST' })
      setStatus('aborted')
      clearInterval(pollRef.current)
      onStatusChange?.('aborted')
    } catch (_) {}
    setAborting(false)
  }

  const isRunning = status === 'running'
  const statusColor = isRunning ? '#f0ad4e'
    : status === 'done'    ? '#4caf50'
    : status === 'failed'  ? '#f44336'
    : status === 'aborted' ? '#9e9e9e'
    : '#9e9e9e'

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 680, padding: 0, overflow: 'hidden' }}>
        {/* Terminal header bar */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 14px', background: '#161b22', borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: '#58a6ff', fontWeight: 600 }}>GP Run — Output</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: statusColor, display: 'flex', alignItems: 'center', gap: 5 }}>
              {isRunning && <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5, borderColor: statusColor, borderTopColor: 'transparent' }} />}
              {status}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>#{runId}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {isRunning && (
              <button className="btn btn-sm" onClick={abort} disabled={aborting}
                style={{ color: '#f44336', borderColor: '#4d1e1e', fontSize: 11 }}>
                {aborting ? '…' : '✕ Abort'}
              </button>
            )}
            <button className="btn btn-sm" onClick={onClose} style={{ fontSize: 11, padding: '1px 8px' }}>✕ Close</button>
          </div>
        </div>
        {/* Terminal output */}
        <pre ref={outputRef} style={{
          margin: 0, padding: '10px 14px', fontSize: 11,
          background: '#0d1117', color: '#c9d1d9',
          height: 380, overflow: 'auto',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          fontFamily: 'Consolas, monospace', lineHeight: 1.5,
        }}>
          {output || <span style={{ color: 'var(--text-muted)' }}>Starting…</span>}
        </pre>
      </div>
    </div>
  )
}

export function GpRunPanel({ appName, branch, releaseBranch }) {
  const gpApp = _gpAppName(appName)

  const [showModal,    setShowModal]    = useState(false)
  const [activeRunId,  setActiveRunId]  = useState(null)
  const [lastStatus,   setLastStatus]   = useState(null)
  const [defaultDest,  setDefaultDest]  = useState('')

  useEffect(() => {
    fetch(`/api/tools/gp-run/gp-params/${encodeURIComponent(gpApp)}`)
      .then(r => r.json())
      .then(d => {
        if (!d.ok) return
        const param = (d.parameters || []).find(
          p => (p.parameter || '').toUpperCase() === 'DESTINATION_BRANCH'
        )
        if (param) setDefaultDest((param.value || '').trim() || (param.default || '').trim())
      })
      .catch(() => {})
  }, [gpApp])

  // Re-attach to a GP run that is still going (e.g. after a browser refresh or Workbench restart)
  useEffect(() => {
    fetch(`/api/tools/gp-run/active?app=${encodeURIComponent(gpApp)}`)
      .then(r => r.json())
      .then(d => { if (d.ok && d.run_id) { setActiveRunId(id => id || d.run_id); setLastStatus(null) } })
      .catch(() => {})
  }, [gpApp])

  function handleModalClose(id) {
    setShowModal(false)
    if (id) { setActiveRunId(id); setLastStatus(null) }
  }

  const statusColor = lastStatus === 'done'    ? '#4caf50'
    : lastStatus === 'failed'  ? '#f44336'
    : lastStatus === 'aborted' ? '#9e9e9e'
    : null

  return (
    <div className="card" style={{ height: '100%', marginBottom: 0, boxSizing: 'border-box', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <button onClick={() => setShowModal(true)}
        style={{ flex: 1, width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--text)', borderRadius: 'inherit' }}>
        🚀 GP Run
        {activeRunId && lastStatus && statusColor && (
          <span style={{ fontSize: 10, fontWeight: 600, color: statusColor, whiteSpace: 'nowrap' }}>
            #{activeRunId} {lastStatus}
          </span>
        )}
        {activeRunId && !lastStatus && (
          <span style={{ fontSize: 10, color: '#f0ad4e', fontWeight: 600, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 3 }}>
            <span className="spinner" style={{ width: 8, height: 8, borderWidth: 1.5, borderColor: '#f0ad4e', borderTopColor: 'transparent' }} />
            running
          </span>
        )}
      </button>

      {showModal && (
        <GpRunModal
          gpApp={gpApp}
          featureBranch={branch || ''}
          destBranch={defaultDest}
          releaseBranch={releaseBranch}
          onClose={handleModalClose}
        />
      )}

      {activeRunId && (
        <GpRunTerminalModal
          runId={activeRunId}
          onClose={() => { setActiveRunId(null); setLastStatus(null) }}
          onStatusChange={setLastStatus}
        />
      )}
    </div>
  )
}

// ── Page-level shared components ──────────────────────────────────────────────

const DEFAULT_HDR = {
  back_button:     { enabled: true },
  app_logo:        { enabled: true },
  branch_banner:   { enabled: true },
  deployed_banner: { enabled: true },
}

export function PageHeader({
  displayName, icon,
  backPath = '/local-app', backLabel = 'Local App Development',
  branch, deployed, serverUp,
  hdr = DEFAULT_HDR, right,
}) {
  const navigate = useNavigate()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
      {hdr.back_button?.enabled !== false && (
        <>
          <button className="btn back-link" style={{ marginBottom: 0 }} onClick={() => navigate(backPath)}>
            ← {backLabel}
          </button>
          <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>/</span>
        </>
      )}
      {hdr.app_logo?.enabled !== false && (
        <span style={{ fontWeight: 600, fontSize: 15 }}>{icon} {displayName}</span>
      )}

      {hdr.branch_banner?.enabled !== false && branch?.branch && (
        <span style={{
          fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 12,
          background: 'rgba(76,175,80,0.1)', color: '#2e7d32',
          border: '1px solid rgba(76,175,80,0.3)', letterSpacing: '0.01em',
        }}>
          {branch.branch}
        </span>
      )}
      {hdr.branch_banner?.enabled !== false && branch?.release_ver && (
        <span style={{
          fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 12,
          background: 'rgba(59,130,246,0.1)', color: 'var(--primary, #3b82f6)',
          border: '1px solid rgba(59,130,246,0.25)', letterSpacing: '0.01em',
        }}>
          v{branch.release_ver}
        </span>
      )}

      {hdr.deployed_banner?.enabled !== false && deployed !== undefined && (
        <>
          <span style={{ color: 'var(--border)', fontSize: 16, margin: '0 2px' }}>|</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>Deployed</span>
          {deployed ? (
            <>
              <span style={{
                fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 12,
                background: 'rgba(76,175,80,0.1)', color: '#2e7d32',
                border: '1px solid rgba(76,175,80,0.3)', letterSpacing: '0.01em',
              }}>
                {deployed.branch}
              </span>
              {deployed.release_ver && (
                <span style={{
                  fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 12,
                  background: 'rgba(59,130,246,0.1)', color: 'var(--primary, #3b82f6)',
                  border: '1px solid rgba(59,130,246,0.25)', letterSpacing: '0.01em',
                }}>
                  v{deployed.release_ver}
                </span>
              )}
            </>
          ) : (
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 12,
              background: 'rgba(244,67,54,0.08)', color: '#c62828',
              border: '1px solid rgba(244,67,54,0.2)', letterSpacing: '0.01em',
            }}>
              Not Deployed
            </span>
          )}
          {deployed && serverUp !== null && (
            <>
              <span style={{ color: 'var(--border)', fontSize: 16, margin: '0 2px' }}>·</span>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 12,
                background: serverUp ? 'rgba(76,175,80,0.12)' : 'rgba(244,67,54,0.08)',
                color: serverUp ? '#2e7d32' : '#c62828',
                border: `1px solid ${serverUp ? 'rgba(76,175,80,0.35)' : 'rgba(244,67,54,0.2)'}`,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: serverUp ? '#4caf50' : '#f44336', display: 'inline-block' }} />
                {serverUp ? 'Running' : 'Stopped'}
              </span>
            </>
          )}
        </>
      )}
      {right}
    </div>
  )
}

export function TabBar({ visibleTabs, resolvedTab, onTabChange }) {
  return (
    <div style={{ display: 'flex', gap: 2, borderBottom: '2px solid var(--border)', marginBottom: 20 }}>
      {visibleTabs.map(tab => (
        <button key={tab.key} onClick={() => onTabChange(tab.key)} style={{
          padding: '8px 18px', border: 'none',
          borderBottom: resolvedTab === tab.key ? '2px solid var(--primary, #3b82f6)' : '2px solid transparent',
          marginBottom: -2, background: 'transparent',
          color: resolvedTab === tab.key ? 'var(--primary, #3b82f6)' : 'var(--text-muted)',
          fontWeight: resolvedTab === tab.key ? 600 : 400,
          fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', transition: 'color 0.15s',
        }}>
          {tab.label}
        </button>
      ))}
    </div>
  )
}

// ── SCM Tab ───────────────────────────────────────────────────────────────────

function PrStateBadge({ pr }) {
  if (pr.merged) return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'rgba(130,80,255,0.12)', color: '#8050ff', border: '1px solid rgba(130,80,255,0.3)', fontWeight: 600, whiteSpace: 'nowrap' }}>Merged</span>
  if (pr.state === 'open') return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'rgba(46,160,67,0.12)', color: '#2ea043', border: '1px solid rgba(46,160,67,0.3)', fontWeight: 600, whiteSpace: 'nowrap' }}>{pr.draft ? 'Draft' : 'Open'}</span>
  return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'rgba(244,67,54,0.1)', color: '#c62828', border: '1px solid rgba(244,67,54,0.25)', fontWeight: 600, whiteSpace: 'nowrap' }}>Closed</span>
}

function relTime(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

export function ScmTab({ appName, branch: initialBranch }) {
  const navigate               = useNavigate()
  const [branch,   setBranch]   = useState('')
  const [input,    setInput]    = useState('')
  const [state,    setState]    = useState('all')
  const [prs,      setPrs]      = useState([])
  const [repo,     setRepo]     = useState('')
  const [loading,  setLoading]  = useState(false)
  const [err,      setErr]      = useState(null)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    if (initialBranch) {
      setBranch(initialBranch)
      setInput(initialBranch)
      loadPrsFor(initialBranch, 'all')
    }
  }, [initialBranch])

  function loadPrsFor(b, s) {
    setLoading(true); setErr(null); setSearched(true)
    const params = new URLSearchParams({ app: appName, state: s })
    if (b) params.set('branch', b)
    fetch(`/api/scm/pull-requests?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setPrs(d.prs || []); setRepo(d.repo || '') }
        else setErr(d.error)
      })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
  }

  function search() {
    const b = input.trim()
    setBranch(b)
    loadPrsFor(b, state)
  }

  function changeState(s) {
    setState(s)
    loadPrsFor(branch, s)
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Pull Request Management</div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="Branch name…"
            style={{ flex: '1 1 220px', fontSize: 12, padding: '6px 10px' }}
          />
          <select value={state} onChange={e => changeState(e.target.value)}
            style={{ fontSize: 12, padding: '5px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="closed">Closed / Merged</option>
          </select>
          <button className="btn btn-primary btn-sm" onClick={search} disabled={loading}>
            {loading ? <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> : '🔍 Search'}
          </button>
          {searched && <button className="btn btn-sm" onClick={() => loadPrsFor(branch, state)} disabled={loading} title="Refresh">↻</button>}
          {repo && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{repo}</span>}
        </div>

        {err && <div className="alert alert-error" style={{ marginBottom: 10, fontSize: 12 }}>{err}</div>}

        {!searched && !loading && (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            Enter a branch name and click Search to load pull requests
          </div>
        )}

        {searched && !loading && !err && prs.length === 0 && (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No pull requests found{branch ? ` for branch "${branch}"` : ''}
          </div>
        )}

        {prs.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-muted)', fontWeight: 600 }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>#</th>
                  <th style={{ padding: '6px 8px 6px 8px', textAlign: 'left' }}>Title</th>
                  <th style={{ padding: '6px 2px 6px 0', textAlign: 'left', whiteSpace: 'nowrap' }}>State</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>PR Review</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>Author</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>Base Branch</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {prs.map(pr => (
                  <tr key={pr.number} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '7px 8px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                      <a href={pr.html_url} target="_blank" rel="noreferrer"
                        style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}
                        title="Open PR on GitHub">#{pr.number}</a>
                      <CopyButton text={pr.html_url} label="Copy URL" style={{ fontSize: 11, padding: '2px 9px' }} />
                    </td>
                    <td style={{ padding: '7px 4px 7px 8px', maxWidth: 320 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pr.title}>{pr.title}</div>
                      {pr.labels?.length > 0 && (
                        <div style={{ marginTop: 3, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {pr.labels.map(l => (
                            <span key={l} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{l}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '7px 2px 7px 0', whiteSpace: 'nowrap' }}><PrStateBadge pr={pr} /></td>
                    <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>
                      {pr.html_url && (
                        <button className="btn btn-sm btn-primary"
                          style={{ fontSize: 11, padding: '2px 10px' }}
                          onClick={e => { e.stopPropagation(); navigate(`/developer-tools/copilot-review?prUrl=${encodeURIComponent(pr.html_url)}`) }}>
                          🤖 Review
                        </button>
                      )}
                    </td>
                    <td style={{ padding: '7px 8px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{pr.author}</td>
                    <td style={{ padding: '7px 8px', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{pr.base_branch}</td>
                    <td style={{ padding: '7px 8px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{relTime(pr.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
