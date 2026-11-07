import { useState, useEffect } from 'react'
import { JvmDiagnosticsTab } from './ObservabilityTabs'

const th = { textAlign: 'left', padding: '5px 8px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)' }
const td = { padding: '4px 8px', fontSize: 12, borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const mono = { fontFamily: 'monospace', fontSize: 11 }
const inp = { ...mono, background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px' }
const pre = { ...mono, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, margin: 0, maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap' }
const btn = { padding: '4px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }
const SEV = { critical: '#dc2626', high: '#ea580c', medium: '#ca8a04', info: '#2563eb' }

const KEPT = {}
function useKept(key, init) {
  const [v, setV] = useState(() => (key in KEPT ? KEPT[key] : init))
  useEffect(() => { KEPT[key] = v }, [key, v])
  return [v, setV]
}
const getJson = (u, opt) => fetch(u, opt).then(r => r.json()).catch(() => ({ ok: false, error: 'Could not reach server' }))
const post = (u, b) => getJson(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) })
const Err = ({ m }) => m ? <div style={{ color: '#dc2626', fontSize: 12, margin: '6px 0', whiteSpace: 'pre-wrap' }}>{m}</div> : null
const Badge = ({ s }) => <span style={{ background: SEV[s] || '#6b7280', color: '#fff', fontSize: 10, padding: '1px 6px', borderRadius: 8, marginRight: 6 }}>{s}</span>
const H = ({ children }) => <div style={{ fontWeight: 600, fontSize: 13, margin: '12px 0 6px' }}>{children}</div>

function Findings({ list }) {
  return (
    <div>
      {(list || []).map((f, i) => (
        <div key={i} className="card" style={{ padding: '6px 10px', marginBottom: 6 }}>
          <div style={{ fontSize: 13 }}><Badge s={f.severity} /><b>{f.title}</b> <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>[{f.area}]</span></div>
          {f.detail && <div style={{ ...mono, marginTop: 3, wordBreak: 'break-word' }}>{f.detail}</div>}
        </div>))}
    </div>
  )
}

// ── 1. Investigate Issue ─────────────────────────────────────────────────────
function Investigate({ base }) {
  const [text, setText] = useKept(base + 'itext', '')
  const [slow, setSlow] = useKept(base + 'islow', 1000)
  const [res, setRes] = useKept(base + 'ires', null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  function run() {
    setBusy(true); setErr('')
    post(`${base}/inv/investigate`, { text, slow_ms: slow }).then(r => { if (r.ok) setRes(r); else setErr(r.error) }).finally(() => setBusy(false))
  }
  return (
    <div>
      <textarea style={{ ...inp, width: '100%', height: 80 }} placeholder="Describe the issue, or paste an error message / stack trace / class name (optional - used to find matching log lines)"
        value={text} onChange={e => setText(e.target.value)} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0', flexWrap: 'wrap' }}>
        <button style={btn} onClick={run} disabled={busy}>{busy ? 'Investigating...' : 'Investigate'}</button>
        <label style={{ fontSize: 12 }}>Slow SQL threshold (ms) <input type="number" style={{ ...inp, width: 80 }} value={slow} onChange={e => setSlow(+e.target.value)} /></label>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Checks container logs, JVM state, slow SQL (P6Spy) and changes since the last deploy.</span>
      </div>
      <Err m={err} />
      {res && <>
        <H>Findings ({res.findings.length})</H>
        {res.findings.length ? <Findings list={res.findings} /> : <div style={{ fontSize: 12 }}>Nothing suspicious found in the evidence collected.</div>}
        {res.jvm && <><H>JVM</H><div style={{ fontSize: 12 }}>Heap {res.jvm.heap_used_mb} / {res.jvm.heap_total_mb} MB - threads {Object.entries(res.jvm.states).map(([k, v]) => `${k}:${v}`).join('  ')}</div></>}
        {res.exceptions.length > 0 && <><H>Exceptions in the container log</H>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Count</th><th style={th}>Exception</th><th style={th}>Message</th><th style={th}>App frame</th></tr></thead>
            <tbody>{res.exceptions.map((g, i) => (
              <tr key={i}><td style={td}>{g.count}</td><td style={{ ...td, ...mono }}>{g.type}</td><td style={{ ...td, ...mono }}>{g.message}</td>
                <td style={{ ...td, ...mono }}>{g.frame ? `${g.frame.cls}.${g.frame.method} (${g.frame.file}:${g.frame.line})` : ''}</td></tr>))}</tbody>
          </table></>}
        {res.slow_sql.length > 0 && <><H>Slow SQL</H>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>ms</th><th style={th}>Time</th><th style={th}>SQL</th></tr></thead>
            <tbody>{res.slow_sql.map((s, i) => (<tr key={i}><td style={td}>{s.ms}</td><td style={td}>{s.time}</td><td style={{ ...td, ...mono }}>{s.sql}</td></tr>))}</tbody>
          </table></>}
        {res.keyword_hits.length > 0 && <><H>Log lines matching your description</H><pre style={pre}>{res.keyword_hits.join('\n')}</pre></>}
      </>}
    </div>
  )
}

// ── 2. Deployment Diff ───────────────────────────────────────────────────────
export function DeploymentDiff({ base }) {
  const [frm, setFrm] = useKept(base + 'dfrom', '')
  const [to, setTo] = useKept(base + 'dto', 'HEAD')
  const [res, setRes] = useKept(base + 'dres', null)
  const [refs, setRefs] = useState([])
  const [sel, setSel] = useState(null)
  const [patch, setPatch] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  function run() {
    setBusy(true); setErr(''); setSel(null); setPatch('')
    getJson(`${base}/inv/diff?from=${encodeURIComponent(frm)}&to=${encodeURIComponent(to)}`).then(r => { if (r.ok) setRes(r); else setErr(r.error) }).finally(() => setBusy(false))
  }
  useEffect(() => { getJson(`${base}/inv/branches`).then(r => { if (r.ok) setRefs(r.refs) }); if (!res) run() }, [])
  function openFile(f) {
    setSel(f); setPatch('Loading...')
    getJson(`${base}/inv/diff-file?from=${encodeURIComponent(res.from)}&to=${encodeURIComponent(res.to)}&file=${encodeURIComponent(f)}`).then(r => setPatch(r.ok ? (r.patch || '(no textual diff)') : r.error))
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12 }}>From <input list="inv-refs" style={{ ...inp, width: 200 }} placeholder="blank = commit at last deploy" value={frm} onChange={e => setFrm(e.target.value)} /></label>
        <label style={{ fontSize: 12 }}>To <input list="inv-refs" style={{ ...inp, width: 160 }} value={to} onChange={e => setTo(e.target.value)} /></label>
        <datalist id="inv-refs">{refs.map(r => <option key={r} value={r} />)}</datalist>
        <button style={btn} onClick={run} disabled={busy}>{busy ? 'Comparing...' : 'Compare'}</button>
      </div>
      <Err m={err} />
      {res && <>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
          Deployed: {res.deployed_at || 'unknown'}{res.deployed_branch ? ` (${res.deployed_branch})` : ''}{res.release_ver ? ` v${res.release_ver}` : ''} - comparing <b>{res.from}</b> .. <b>{res.to}</b>
          {res.note && <span> - {res.note}</span>}
        </div>
        <H>Commits ({res.commits.length})</H>
        <div style={{ maxHeight: 220, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Commit</th><th style={th}>Author</th><th style={th}>Date</th><th style={th}>Subject</th></tr></thead>
            <tbody>{res.commits.map(c => (<tr key={c.hash}><td style={{ ...td, ...mono }}>{c.hash}</td><td style={td}>{c.author}</td><td style={td}>{c.date}</td><td style={td}>{c.subject}</td></tr>))}</tbody>
          </table>
        </div>
        <H>Changed files ({res.files.length})</H>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 380px', maxHeight: 360, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>{res.files.map(f => (
                <tr key={f.file} onClick={() => openFile(f.file)} style={{ cursor: 'pointer', background: sel === f.file ? 'var(--surface2)' : '' }}>
                  <td style={{ ...td, ...mono }}>{f.file}</td><td style={{ ...td, color: '#16a34a' }}>+{f.add}</td><td style={{ ...td, color: '#dc2626' }}>-{f.del}</td></tr>))}</tbody>
            </table>
          </div>
          <div style={{ flex: '2 1 480px' }}>
            {sel ? <pre style={{ ...pre, maxHeight: 360 }}>{patch.split('\n').map((l, i) => <div key={i} style={{ color: l.startsWith('+') && !l.startsWith('+++') ? '#16a34a' : l.startsWith('-') && !l.startsWith('---') ? '#dc2626' : undefined }}>{l || ' '}</div>)}</pre>
              : <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Click a file to see its diff.</div>}
          </div>
        </div>
      </>}
    </div>
  )
}

// ── 3. Root Cause Analysis ───────────────────────────────────────────────────
const RULES = [
  { rule: 'Exception in the log, thrown from a file that changed since the last deploy', score: '90 + min(count, 10)', max: 100, when: 'An exception type/message appears in the last 6000 container log lines, its first com.healthedge / com.healthrules stack frame maps to a .java file in the deployment diff.' },
  { rule: 'Thread deadlock', score: '95', max: 95, when: 'Thread.print reports a Java-level deadlock.' },
  { rule: 'Heap pressure', score: '80', max: 80, when: 'Heap used is 90% or more of committed heap.' },
  { rule: 'Lock contention', score: '70', max: 70, when: '5 or more threads are BLOCKED.' },
  { rule: 'Slow SQL', score: '50 + min(slowest ms / 1000, 20)', max: 70, when: 'P6Spy logged statements of 1000 ms or more (the slowest one is used).' },
  { rule: 'Exception in the log, no matching changed file', score: '35 + min(count, 10)', max: 45, when: 'Same as the first rule, but no changed file matches the app frame (or there is no app frame / no diff).' },
  { rule: 'No runtime symptom', score: '20', max: 20, when: 'Nothing above fired but there are commits since the deploy.' },
]
function RulesPanel() {
  return (
    <div className="card" style={{ padding: 10, margin: '8px 0' }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Scoring rules</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>Rule</th><th style={th}>Score</th><th style={th}>Max</th><th style={th}>Fires when</th></tr></thead>
        <tbody>{RULES.map(r => (<tr key={r.rule}><td style={td}><b>{r.rule}</b></td><td style={{ ...td, ...mono }}>{r.score}</td><td style={td}>{r.max}</td><td style={td}>{r.when}</td></tr>))}</tbody>
      </table>
      <div style={{ fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>
        <b>How scoring works:</b> every symptom found in the evidence becomes one hypothesis with a fixed base score from the table, plus a bonus for how often it occurred (exceptions) or how slow it was (SQL).
        Hypotheses are sorted by score, highest first, and the top 15 are shown. Scores rank leads against each other; they are not probabilities.
        A changed file is the strongest signal because it ties a symptom to a specific deployment change. Only the 25 most frequent exception groups are considered.
        Evidence is read from the running container; the diff is the deployment diff (last deploy to HEAD).
      </div>
    </div>
  )
}
const NOTE_KEYS =[['title', 'Title'], ['summary', 'Summary'], ['impact', 'Impact'], ['timeline', 'Timeline'], ['root_cause', 'Root cause'], ['contributing', 'Contributing factors'], ['fix', 'Fix / mitigation'], ['prevention', 'Prevention']]
function Rca({ base }) {
  const [text, setText] = useKept(base + 'rtext', '')
  const [res, setRes] = useKept(base + 'rres', null)
  const [notes, setNotes] = useKept(base + 'rnotes', null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState('')
  const [showRules, setShowRules] = useKept(base + 'rrules', false)
  useEffect(() => { if (!notes) getJson(`${base}/inv/rca-notes`).then(r => setNotes(r.notes || {})) }, [])
  function run() {
    setBusy(true); setErr('')
    post(`${base}/inv/rca`, { text }).then(r => { if (r.ok) setRes(r); else setErr(r.error) }).finally(() => setBusy(false))
  }
  const n = notes || {}
  const save = () => post(`${base}/inv/rca-notes`, n).then(r => setSaved(r.ok ? 'Saved' : r.error))
  const md = () => NOTE_KEYS.map(([k, l]) => k === 'title' ? `# ${n[k] || 'Root Cause Analysis'}` : `## ${l}\n${n[k] || ''}`).join('\n\n')
  const useHyp = h => setNotes({ ...n, root_cause: `${h.title}\n${h.why}${h.files.length ? '\nFiles: ' + h.files.join(', ') : ''}${h.commits.length ? '\nCommits:\n' + h.commits.join('\n') : ''}` })
  return (
    <div>
      <textarea style={{ ...inp, width: '100%', height: 60 }} placeholder="Symptom / error text (optional)" value={text} onChange={e => setText(e.target.value)} />
      <div style={{ margin: '8px 0' }}>
        <button style={btn} onClick={run} disabled={busy}>{busy ? 'Analysing...' : 'Analyse likely causes'}</button>{' '}
        <button style={{ ...btn, background: showRules ? 'var(--primary, #2563eb)' : btn.background, color: showRules ? '#fff' : btn.color }} onClick={() => setShowRules(v => !v)}>Rules</button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>Correlates log exceptions, JVM and SQL evidence with files changed since the last deploy.</span>
      </div>
      <Err m={err} />
      {showRules && <RulesPanel />}
      {res && <>
        <H>Ranked hypotheses</H>
        {res.hypotheses.length === 0 && <div style={{ fontSize: 12 }}>No hypotheses - no symptoms were found.</div>}
        {res.hypotheses.map((h, i) => (
          <div key={i} className="card" style={{ padding: '8px 10px', marginBottom: 6 }}>
            <div style={{ fontSize: 13 }}><b>#{i + 1}</b> {h.title} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>[{h.kind}, score {h.score}]</span>
              <button style={{ ...btn, float: 'right', padding: '1px 8px' }} onClick={() => useHyp(h)}>Use as root cause</button></div>
            <div style={{ fontSize: 12, marginTop: 3 }}>{h.why}</div>
            {h.files.map(f => <div key={f} style={mono}>changed: {f}</div>)}
            {h.commits.map(c => <div key={c} style={mono}>commit: {c}</div>)}
          </div>))}
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Compared {res.diff.from}..{res.diff.to}: {res.diff.commits} commits, {res.diff.files} files. {res.diff.error}</div>
      </>}
      <H>RCA write-up</H>
      {NOTE_KEYS.map(([k, l]) => (
        <div key={k} style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l}</div>
          {k === 'title' ? <input style={{ ...inp, width: '100%' }} value={n[k] || ''} onChange={e => setNotes({ ...n, [k]: e.target.value })} />
            : <textarea style={{ ...inp, width: '100%', height: k === 'root_cause' ? 90 : 56 }} value={n[k] || ''} onChange={e => setNotes({ ...n, [k]: e.target.value })} />}
        </div>))}
      <button style={btn} onClick={save}>Save</button>{' '}
      <button style={btn} onClick={() => navigator.clipboard?.writeText(md())}>Copy as Markdown</button>
      <span style={{ fontSize: 12, marginLeft: 8, color: 'var(--text-muted)' }}>{saved}</span>
    </div>
  )
}

export default function InvestigationTab({ appName }) {
  const [sub, setSub] = useKept('invsub', 'inv')
  const base = `/api/local-app/${appName}`
  const items = [{ key: 'inv', label: 'Investigate Issue' }, { key: 'rca', label: 'Root Cause Analysis' }, { key: 'jvm', label: '☕ JVM Diagnostics' }]
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {items.map(t => (
          <button key={t.key} onClick={() => setSub(t.key)}
            style={{ padding: '4px 12px', fontSize: 12, borderRadius: 14, cursor: 'pointer', border: '1px solid var(--border)',
              background: sub === t.key ? 'var(--primary, #2563eb)' : 'transparent', color: sub === t.key ? '#fff' : 'inherit' }}>{t.label}</button>))}
      </div>
      {sub === 'inv' && <Investigate base={base} />}
      {sub === 'rca' && <Rca base={base} />}
      {sub === 'jvm' && <JvmDiagnosticsTab appName={appName} />}
    </div>
  )
}
