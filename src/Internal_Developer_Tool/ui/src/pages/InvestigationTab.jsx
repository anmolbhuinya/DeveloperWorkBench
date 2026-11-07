import { useState, useEffect } from 'react'
import { usePanels } from './ScreenConfig'
import { JvmDiagnosticsTab, jumpJvm } from './ObservabilityTabs'

const th = { textAlign: 'left', padding: '5px 8px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)' }
const td = { padding: '4px 8px', fontSize: 12, borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const mono = { fontFamily: 'monospace', fontSize: 11 }
const inp = { ...mono, background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', boxSizing: 'border-box' }
const pre = { ...mono, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, margin: 0, maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap' }
const btn = { padding: '4px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }
const SEV = { critical: '#dc2626', high: '#ea580c', medium: '#ca8a04', info: '#2563eb' }
const CONF = { High: '#16a34a', Medium: '#ca8a04', Low: '#6b7280' }

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
const H = ({ children }) => <div style={{ fontWeight: 600, fontSize: 13, margin: '14px 0 6px' }}>{children}</div>

// issue categories are shared by Investigate and RCA
const CATS = { list: null }
function useCategories(base) {
  const [cats, setCats] = useState(CATS.list)
  const load = () => getJson(`${base}/inv/categories`).then(r => { if (r.ok) { CATS.list = r; setCats(r) } })
  useEffect(() => { if (!CATS.list) load() }, [])
  return [cats, load]
}
function CategoryPills({ cats, value, onChange }) {
  const list = (cats?.categories || []).filter(c => c.enabled)
  useEffect(() => { if (list.length && !list.find(c => c.key === value)) onChange(list[0].key) }, [cats])
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
      {list.map(c => (
        <button key={c.key} onClick={() => onChange(c.key)}
          style={{ padding: '3px 10px', fontSize: 12, borderRadius: 14, cursor: 'pointer', border: '1px solid var(--border)',
            background: value === c.key ? 'var(--primary, #2563eb)' : 'transparent', color: value === c.key ? '#fff' : 'inherit' }}>{c.name}</button>))}
    </div>
  )
}

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

// ── Investigate ──────────────────────────────────────────────────────────────
function Investigate({ base, cats, onNav }) {
  const [cat, setCat] = useKept('invcat', '')
  const [text, setText] = useKept(base + 'itext', '')
  const [slow, setSlow] = useKept(base + 'islow', 1000)
  const [results, setResults] = useKept(base + 'ires2', {})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const c = (cats?.categories || []).find(x => x.key === cat)
  const res = results[cat]
  function run() {
    setBusy(true); setErr('')
    post(`${base}/inv/assess`, { category: cat, text, slow_ms: slow }).then(r => { if (r.ok) setResults({ ...results, [cat]: r }); else setErr(r.error) }).finally(() => setBusy(false))
  }
  const causes = res ? res.causes : (c?.causes || []).map(t => ({ text: t, confidence: '', signals: [] }))
  const actions = res ? res.actions : (c?.action_items || [])
  const ev = res?.evidence
  return (
    <div>
      <CategoryPills cats={cats} value={cat} onChange={setCat} />
      <textarea style={{ ...inp, width: '100%', height: 56 }} placeholder="Optional: describe the issue, or paste an error message / class name (used to find matching log lines; the first line becomes the Issue)"
        value={text} onChange={e => setText(e.target.value)} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0', flexWrap: 'wrap' }}>
        <button style={btn} onClick={run} disabled={busy || !cat}>{busy ? 'Investigating...' : 'Investigate'}</button>
        <label style={{ fontSize: 12 }}>Slow SQL threshold (ms) <input type="number" style={{ ...inp, width: 80 }} value={slow} onChange={e => setSlow(+e.target.value)} /></label>
      </div>
      <Err m={err} />
      {c && <div className="card" style={{ padding: '10px 14px', fontSize: 13, lineHeight: 1.7 }}>
        <div><b>Issue:</b></div>
        <div style={{ marginBottom: 8 }}>{res ? res.issue : (text.trim().split('\n')[0] || c.name)}</div>
        <div><b>Possible Causes:</b></div>
        <div style={{ marginBottom: 8 }}>
          {causes.map((x, i) => (
            <div key={i}>{i + 1}. {x.text}
              {x.confidence && <span style={{ marginLeft: 8, fontSize: 11, color: CONF[x.confidence] }}>{x.confidence}</span>}
              {x.signals?.length > 0 && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>- {x.signals.join('; ')}</span>}
            </div>))}
          {!res && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Run Investigate to rank these against live evidence.</div>}
        </div>
        <div><b>Confidence:</b></div>
        <div style={{ marginBottom: 8 }}>
          {['High', 'Medium', 'Low'].map((k, i) => (
            <span key={k}>{i > 0 && ' / '}<span style={{ fontWeight: res?.confidence === k ? 700 : 400, color: res?.confidence === k ? CONF[k] : 'var(--text-muted)' }}>{k}</span></span>))}
        </div>
        <div><b>Recommended Actions:</b></div>
        <div>{actions.map((a, i) => (
          <div key={i}>{a.target ? <a href="#" onClick={e => { e.preventDefault(); onNav(a.target) }} style={{ color: 'var(--primary, #2563eb)' }}>{a.label}</a> : a.label}</div>))}</div>
      </div>}
      {ev && <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Evidence ({ev.findings.length} findings)</summary>
        {ev.findings.length ? <Findings list={ev.findings} /> : <div style={{ fontSize: 12 }}>Nothing suspicious found in the evidence collected.</div>}
        {ev.jvm && <><H>JVM</H><div style={{ fontSize: 12 }}>Heap {ev.jvm.heap_used_mb} / {ev.jvm.heap_total_mb} MB - threads {Object.entries(ev.jvm.states).map(([k, v]) => `${k}:${v}`).join('  ')}</div></>}
        {ev.exceptions.length > 0 && <><H>Exceptions in the container log</H>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Count</th><th style={th}>Exception</th><th style={th}>Message</th><th style={th}>App frame</th></tr></thead>
            <tbody>{ev.exceptions.map((g, i) => (
              <tr key={i}><td style={td}>{g.count}</td><td style={{ ...td, ...mono }}>{g.type}</td><td style={{ ...td, ...mono }}>{g.message}</td>
                <td style={{ ...td, ...mono }}>{g.frame ? `${g.frame.cls}.${g.frame.method} (${g.frame.file}:${g.frame.line})` : ''}</td></tr>))}</tbody>
          </table></>}
        {ev.slow_sql.length > 0 && <><H>Slow SQL</H>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>ms</th><th style={th}>Time</th><th style={th}>SQL</th></tr></thead>
            <tbody>{ev.slow_sql.map((s, i) => (<tr key={i}><td style={td}>{s.ms}</td><td style={td}>{s.time}</td><td style={{ ...td, ...mono }}>{s.sql}</td></tr>))}</tbody>
          </table></>}
        {ev.keyword_hits.length > 0 && <><H>Log lines matching your description</H><pre style={pre}>{ev.keyword_hits.join('\n')}</pre></>}
      </details>}
    </div>
  )
}

// ── Root Cause Analysis ──────────────────────────────────────────────────────
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
const NOTE_KEYS = [['issue', 'Issue', 1], ['root_cause', 'Root Cause', 2], ['evidence', 'Evidence', 5], ['impact', 'Impact', 4], ['resolution', 'Resolution', 3], ['verification', 'Verification', 4], ['prevention', 'Prevention', 3]]
function Rca({ base, cats }) {
  const [cat, setCat] = useKept('invcat', '')
  const [text, setText] = useKept(base + 'rtext', '')
  const [res, setRes] = useKept(base + 'rres', null)
  const [allNotes, setAllNotes] = useKept(base + 'rnotes2', {})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState('')
  const [showRules, setShowRules] = useKept(base + 'rrules', false)
  const c = (cats?.categories || []).find(x => x.key === cat)
  useEffect(() => {
    if (cat && !(cat in allNotes)) getJson(`${base}/inv/rca-notes?category=${cat}`).then(r => setAllNotes(a => ({ ...a, [cat]: r.notes || {} })))
  }, [cat])
  const n = allNotes[cat] || {}
  const setN = (k, v) => setAllNotes({ ...allNotes, [cat]: { ...n, [k]: v } })
  const val = k => k === 'issue' && n.issue === undefined ? (c?.name || '') : (n[k] || '')
  function run() {
    setBusy(true); setErr('')
    post(`${base}/inv/rca`, { text }).then(r => { if (r.ok) setRes(r); else setErr(r.error) }).finally(() => setBusy(false))
  }
  const save = () => post(`${base}/inv/rca-notes?category=${cat}`, { ...Object.fromEntries(NOTE_KEYS.map(([k]) => [k, val(k)])) }).then(r => setSaved(r.ok ? 'Saved' : r.error))
  const md = () => NOTE_KEYS.map(([k, l]) => `${l}:\n${val(k)}`).join('\n\n')
  const useHyp = h => setAllNotes({ ...allNotes, [cat]: { ...n, root_cause: h.title,
    evidence: [h.why, ...h.files.map(f => 'Changed file: ' + f), ...h.commits.map(x => 'Commit: ' + x)].map(x => '• ' + x).join('\n') } })
  return (
    <div>
      <CategoryPills cats={cats} value={cat} onChange={setCat} />
      <div className="card" style={{ padding: 10, marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input style={{ ...inp, flex: 1, minWidth: 260 }} placeholder="Symptom / error text (optional)" value={text} onChange={e => setText(e.target.value)} />
          <button style={btn} onClick={run} disabled={busy}>{busy ? 'Analysing...' : 'Analyse likely causes'}</button>
          <button style={{ ...btn, background: showRules ? 'var(--primary, #2563eb)' : btn.background, color: showRules ? '#fff' : btn.color }} onClick={() => setShowRules(v => !v)}>Rules</button>
        </div>
        <Err m={err} />
        {showRules && <RulesPanel />}
        {res && <>
          {res.hypotheses.length === 0 && <div style={{ fontSize: 12, marginTop: 6 }}>No hypotheses - no symptoms were found.</div>}
          {res.hypotheses.map((h, i) => (
            <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13 }}><b>#{i + 1}</b> {h.title} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>[{h.kind}, score {h.score}]</span>
                <button style={{ ...btn, float: 'right', padding: '1px 8px' }} onClick={() => useHyp(h)}>Use as root cause</button></div>
              <div style={{ fontSize: 12, marginTop: 2 }}>{h.why}</div>
              {h.files.map(f => <div key={f} style={mono}>changed: {f}</div>)}
              {h.commits.map(x => <div key={x} style={mono}>commit: {x}</div>)}
            </div>))}
        </>}
      </div>
      {NOTE_KEYS.map(([k, l, rows]) => (
        <div key={k} style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{l}:</div>
          {rows === 1 ? <input style={{ ...inp, width: '100%' }} value={val(k)} onChange={e => setN(k, e.target.value)} />
            : <textarea style={{ ...inp, width: '100%', height: rows * 20 + 12 }} placeholder={k === 'evidence' || k === 'impact' ? 'One item per line' : ''} value={val(k)} onChange={e => setN(k, e.target.value)} />}
        </div>))}
      <button style={btn} onClick={save}>Save</button>{' '}
      <button style={btn} onClick={() => navigator.clipboard?.writeText(md())}>Copy</button>
      <span style={{ fontSize: 12, marginLeft: 8, color: 'var(--text-muted)' }}>{saved}</span>
    </div>
  )
}

// ── Issue Categories ─────────────────────────────────────────────────────────
function Categories({ base, cats, reload }) {
  const [rows, setRows] = useState(null)
  const [msg, setMsg] = useState('')
  useEffect(() => { if (cats) setRows(cats.categories.map(c => ({ ...c, _old: true, causes: c.causes.join('\n'), actions: c.actions.join('\n') }))) }, [cats])
  if (!rows) return <div style={{ fontSize: 12 }}>Loading...</div>
  const set = (i, k, v) => setRows(rows.map((r, j) => j === i ? { ...r, [k]: v } : r))
  const save = () => post(`${base}/inv/categories`, { categories: rows }).then(r => { setMsg(r.ok ? 'Saved to issue_categories.xlsx' : r.error); if (r.ok) { CATS.list = null; reload() } })
  return (
    <div>
      <div style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead><tr><th style={th}>On</th><th style={th}>Key</th><th style={th}>Category</th><th style={th}>Possible causes (one per line)</th><th style={th}>Recommended actions (one per line: Label &gt; target)</th><th style={th}></th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>
              <td style={td}><input type="checkbox" checked={r.enabled} onChange={e => set(i, 'enabled', e.target.checked)} /></td>
              <td style={{ ...td, width: 110 }}><input style={{ ...inp, width: '100%' }} value={r.key} readOnly={r._old} onChange={e => set(i, 'key', e.target.value)} /></td>
              <td style={{ ...td, width: 170 }}><input style={{ ...inp, width: '100%' }} value={r.name} onChange={e => set(i, 'name', e.target.value)} /></td>
              <td style={td}><textarea style={{ ...inp, width: '100%', height: 84 }} value={r.causes} onChange={e => set(i, 'causes', e.target.value)} /></td>
              <td style={td}><textarea style={{ ...inp, width: '100%', height: 84 }} value={r.actions} onChange={e => set(i, 'actions', e.target.value)} /></td>
              <td style={td}><button style={btn} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Delete</button></td>
            </tr>))}</tbody>
        </table>
      </div>
      <div style={{ margin: '8px 0' }}>
        <button style={btn} onClick={() => setRows([...rows, { key: '', name: '', enabled: true, causes: '', actions: '' }])}>Add category</button>{' '}
        <button style={btn} onClick={save}>Save</button>{' '}
        <button style={btn} onClick={() => { CATS.list = null; reload() }}>Discard changes</button>
        <span style={{ fontSize: 12, marginLeft: 8, color: 'var(--text-muted)' }}>{msg}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
        <div>Config file: {cats.file}</div>
        <div>An action's target decides where it links: {(cats.targets || []).join(', ')}. For example <span style={mono}>Open SQL Analyzer &gt; sql</span>. An action without a target is shown as plain text.
          Causes are ranked against live evidence by matching words in their text (sql, pool, gc/heap/memory, thread/lock, timeout/network, config/startup).</div>
      </div>
    </div>
  )
}

// ── Root ─────────────────────────────────────────────────────────────────────
export default function InvestigationTab({ appName }) {
  const [sub0, setSub] = useKept('invsub', 'inv')
  const on = usePanels()
  const INV = { cats: 'inv_categories', inv: 'inv_investigate', jvm: 'inv_jvm', rca: 'inv_rca' }
  const vis = Object.keys(INV).filter(k => on(INV[k]))
  const sub = vis.includes(sub0) ? sub0 : vis[0]
  const base = `/api/local-app/${appName}`
  const [cats, reload] = useCategories(base)
  const items = [{ key: 'cats', label: 'Issue Categories' }, { key: 'inv', label: 'Investigate' }, { key: 'jvm', label: '☕ JVM Diagnostics' }, { key: 'rca', label: 'Root Cause Analysis' }].filter(t => vis.includes(t.key))
  const JVM = { threads: 'thr', heap: 'heap', jfr: 'jfr', dash: 'dash' }
  const NAV = { sql: { sub: 'logs', inner: { logs: 'p6spy' } }, logs: { sub: 'logs', inner: { logs: 'applog' } }, metrics: { sub: 'metrics' },
    events: { sub: 'events' }, appmap: { sub: 'traces', inner: { traces: 'appmap' } }, trace: { sub: 'traces', inner: { traces: 'apptrace' } } }
  function onNav(t) {
    if (t in JVM) { jumpJvm(JVM[t]); setSub('jvm') }
    else if (t === 'rca') setSub('rca')
    else if (t in NAV) window.dispatchEvent(new CustomEvent('dwb-nav', { detail: { tab: 'observability', ...NAV[t] } }))
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {items.map(t => (
          <button key={t.key} onClick={() => setSub(t.key)}
            style={{ padding: '4px 12px', fontSize: 12, borderRadius: 14, cursor: 'pointer', border: '1px solid var(--border)',
              background: sub === t.key ? 'var(--primary, #2563eb)' : 'transparent', color: sub === t.key ? '#fff' : 'inherit' }}>{t.label}</button>))}
      </div>
      {sub === 'inv' && <Investigate base={base} cats={cats} onNav={onNav} />}
      {sub === 'jvm' && <JvmDiagnosticsTab appName={appName} />}
      {sub === 'rca' && <Rca base={base} cats={cats} />}
      {sub === 'cats' && <Categories base={base} cats={cats} reload={reload} />}
    </div>
  )
}
