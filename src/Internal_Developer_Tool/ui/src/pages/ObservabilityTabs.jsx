import { useState, useEffect, useMemo, useRef } from 'react'

const th = { textAlign: 'left', padding: '5px 8px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)' }
const td = { padding: '4px 8px', fontSize: 12, borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const mono = { fontFamily: 'monospace', fontSize: 11 }
const inp = { ...mono, background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px' }
const pre = { ...mono, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, margin: 0, maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap' }
const btn = { padding: '4px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }

const KEPT = {}
function useKept(key, init) {
  const [v, setV] = useState(() => (key in KEPT ? KEPT[key] : init))
  useEffect(() => { KEPT[key] = v }, [key, v])
  return [v, setV]
}
const getJson = (u, opt) => fetch(u, opt).then(r => r.json()).catch(() => ({ ok: false, error: 'Could not reach server' }))
const post = (u, b) => getJson(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) })
const fmtB = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? (n / 1024).toFixed(0) + ' KB' : n + ' B'
const when = t => new Date(t * 1000).toLocaleString()

function Pills({ items, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
      {items.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)}
          style={{ padding: '4px 12px', fontSize: 12, borderRadius: 14, cursor: 'pointer', border: '1px solid var(--border)',
            background: value === t.key ? 'var(--primary, #2563eb)' : 'transparent', color: value === t.key ? '#fff' : 'inherit' }}>{t.label}</button>
      ))}
    </div>
  )
}
const Err = ({ m }) => m ? <div style={{ color: '#dc2626', fontSize: 12, margin: '6px 0', whiteSpace: 'pre-wrap' }}>{m}</div> : null
function Stat({ label, value }) {
  return (
    <div className="card" style={{ padding: '8px 14px', minWidth: 130 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{value ?? '-'}</div>
    </div>
  )
}
function Spark({ data, color = '#2563eb', max }) {
  if (!data || data.length < 2) return <div style={{ height: 50, fontSize: 11, color: 'var(--text-muted)' }}>collecting...</div>
  const mx = max || Math.max(...data, 1)
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 300},${48 - (v / mx) * 46}`).join(' ')
  return <svg viewBox="0 0 300 50" style={{ width: '100%', height: 50 }}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" /></svg>
}

// ── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ base }) {
  const [d, setD] = useKept(base + 'dash', null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  function load() {
    setBusy(true)
    getJson(`${base}/jvm/info`).then(r => { if (r.ok) { setD(r); setErr('') } else setErr(r.error) }).finally(() => setBusy(false))
  }
  useEffect(() => { if (!d) load() }, [])
  return (
    <div>
      <div style={{ marginBottom: 10 }}><button style={btn} onClick={load} disabled={busy}>{busy ? 'Loading...' : 'Refresh'}</button></div>
      <Err m={err} />
      {d && <>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <Stat label="PID" value={d.pid} />
          <Stat label="Uptime" value={(d.uptime || '').replace(/^\d+:\s*/, '')} />
          <Stat label="Heap used / committed" value={d.heap_used_mb != null ? `${d.heap_used_mb} / ${d.heap_total_mb} MB` : '-'} />
          <Stat label="RSS" value={d.rss} />
          <Stat label="Threads (live / daemon / peak)" value={`${d.threads_live || d.threads} / ${d.threads_daemon || '-'} / ${d.threads_peak || '-'}`} />
          <Stat label="Classes loaded" value={d.classes_loaded} />
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, margin: '8px 0 4px' }}>Heap</div>
        <pre style={pre}>{d.heap_info}</pre>
        <div style={{ fontSize: 12, fontWeight: 600, margin: '8px 0 4px' }}>Command line / JVM flags</div>
        <pre style={pre}>{d.flags}</pre>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{(d.version || []).join(' | ')} - {d.java} - container {d.container} (user {d.user})</div>
      </>}
    </div>
  )
}

// ── Thread analyzer ──────────────────────────────────────────────────────────
function parseThreads(txt) {
  const out = []
  let cur = null
  for (const ln of txt.split('\n')) {
    const m = ln.match(/^"([^"]+)"(.*)$/)
    if (m) { cur = { name: m[1], head: m[2], state: '', stack: [] }; out.push(cur); continue }
    if (!cur) continue
    const s = ln.match(/java\.lang\.Thread\.State:\s*(\S+)/)
    if (s) cur.state = s[1]
    else if (ln.trim().startsWith('at ')) cur.stack.push(ln.trim().slice(3))
    else if (ln.trim().startsWith('- ')) cur.stack.push(ln.trim())
    else if (!ln.trim()) cur = null
  }
  return out.filter(t => t.state || t.stack.length)
}
function ThreadAnalyzer({ base }) {
  const [txt, setTxt] = useKept(base + 'thr', '')
  const [filter, setFilter] = useKept(base + 'thrf', '')
  const [stateF, setStateF] = useKept(base + 'thrs', '')
  const [group, setGroup] = useKept(base + 'thrg', false)
  const [open, setOpen] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  function load() {
    setBusy(true)
    getJson(`${base}/jvm/threads`).then(r => { if (r.ok) { setTxt(r.text); setErr('') } else setErr(r.error) }).finally(() => setBusy(false))
  }
  const th_ = useMemo(() => parseThreads(txt), [txt])
  const counts = useMemo(() => { const c = {}; th_.forEach(t => { c[t.state] = (c[t.state] || 0) + 1 }); return c }, [th_])
  const dead = /Found one Java-level deadlock|Found \d+ deadlock/i.test(txt)
  const rows = useMemo(() => {
    let r = th_.filter(t => (!stateF || t.state === stateF) && (!filter || (t.name + t.stack.join(' ')).toLowerCase().includes(filter.toLowerCase())))
    if (!group) return r.map(t => ({ ...t, n: 1 }))
    const g = {}
    r.forEach(t => { const k = t.state + '|' + t.stack.slice(0, 6).join('|'); (g[k] = g[k] || { ...t, n: 0, names: [] }).n++; g[k].names.push(t.name) })
    return Object.values(g).sort((a, b) => b.n - a.n)
  }, [th_, filter, stateF, group])
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <button style={btn} onClick={load} disabled={busy}>{busy ? 'Capturing...' : 'Capture thread dump'}</button>
        <input style={{ ...inp, width: 240 }} placeholder="Filter name / stack" value={filter} onChange={e => setFilter(e.target.value)} />
        <select style={inp} value={stateF} onChange={e => setStateF(e.target.value)}>
          <option value="">All states</option>{Object.keys(counts).map(s => <option key={s} value={s}>{s} ({counts[s]})</option>)}
        </select>
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={group} onChange={e => setGroup(e.target.checked)} /> Group identical stacks</label>
      </div>
      <Err m={err} />
      {txt && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <Stat label="Threads" value={th_.length} />
        {Object.keys(counts).map(s => <Stat key={s} label={s} value={counts[s]} />)}
        <Stat label="Deadlock" value={dead ? 'YES' : 'none'} />
      </div>}
      {dead && <pre style={{ ...pre, borderColor: '#dc2626', marginBottom: 10 }}>{txt.slice(txt.search(/Found/))}</pre>}
      <div style={{ maxHeight: 460, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>{group ? 'Count' : '#'}</th><th style={th}>Thread</th><th style={th}>State</th><th style={th}>Top frame</th></tr></thead>
          <tbody>{rows.map((t, i) => (<>
            <tr key={i} onClick={() => setOpen(open === i ? null : i)} style={{ cursor: 'pointer' }}>
              <td style={td}>{group ? t.n : i + 1}</td>
              <td style={{ ...td, ...mono }}>{group ? t.names.slice(0, 2).join(', ') + (t.names.length > 2 ? ' ...' : '') : t.name}</td>
              <td style={td}>{t.state}</td><td style={{ ...td, ...mono }}>{t.stack[0] || ''}</td>
            </tr>
            {open === i && <tr key={'d' + i}><td colSpan={4} style={td}><pre style={pre}>{t.stack.join('\n')}</pre></td></tr>}
          </>))}</tbody>
        </table>
      </div>
      {!txt && !busy && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Capture a thread dump of the app-server JVM (jcmd Thread.print).</div>}
    </div>
  )
}

// ── Heap dump analyzer ───────────────────────────────────────────────────────
function HeapAnalyzer({ base }) {
  const [files, setFiles] = useState([])
  const [dir, setDir] = useState('')
  const [hist, setHist] = useKept(base + 'hist', null)
  const [live, setLive] = useKept(base + 'histlive', true)
  const [q, setQ] = useKept(base + 'histq', '')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const list = () => getJson(`${base}/jvm/heap`).then(r => { if (r.ok) { setFiles(r.files); setDir(r.dir) } })
  useEffect(() => { list() }, [])
  function histo() {
    setBusy('hist'); setErr('')
    getJson(`${base}/jvm/histogram?live=${live ? 1 : 0}`).then(r => { if (r.ok) setHist(r); else setErr(r.error) }).finally(() => setBusy(''))
  }
  function dump() {
    setBusy('dump'); setErr('')
    post(`${base}/jvm/heap`).then(r => { if (!r.ok) setErr(r.error); list() }).finally(() => setBusy(''))
  }
  const rows = (hist?.rows || []).filter(r => !q || r.cls.toLowerCase().includes(q.toLowerCase()))
  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Class histogram (live objects)</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <button style={btn} onClick={histo} disabled={!!busy}>{busy === 'hist' ? 'Running...' : 'Run histogram'}</button>
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={live} onChange={e => setLive(e.target.checked)} /> Live only (forces a GC)</label>
        <input style={{ ...inp, width: 240 }} placeholder="Filter class" value={q} onChange={e => setQ(e.target.value)} />
        {hist && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{hist.total_n.toLocaleString()} objects, {fmtB(hist.total_bytes)}</span>}
      </div>
      <Err m={err} />
      {hist && <div style={{ maxHeight: 340, overflow: 'auto', marginBottom: 14 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Class</th><th style={th}>Instances</th><th style={th}>Size</th><th style={th}>% of heap</th></tr></thead>
          <tbody>{rows.slice(0, 200).map((r, i) => (
            <tr key={i}><td style={{ ...td, ...mono }}>{r.cls}</td><td style={td}>{r.n.toLocaleString()}</td><td style={td}>{fmtB(r.bytes)}</td>
              <td style={td}>{(r.bytes * 100 / (hist.total_bytes || 1)).toFixed(1)}%</td></tr>))}</tbody>
        </table>
      </div>}
      <div style={{ fontWeight: 600, fontSize: 13, margin: '10px 0 6px' }}>Heap dumps (.hprof)</div>
      <div style={{ marginBottom: 8 }}><button style={btn} onClick={dump} disabled={!!busy}>{busy === 'dump' ? 'Dumping (can take minutes)...' : 'Take heap dump'}</button></div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>File</th><th style={th}>Size</th><th style={th}>Taken</th><th style={th}></th></tr></thead>
        <tbody>{files.map(f => (
          <tr key={f.name}><td style={{ ...td, ...mono }}>{f.name}</td><td style={td}>{f.mb} MB</td><td style={td}>{when(f.mtime)}</td>
            <td style={td}><button style={btn} onClick={() => { navigator.clipboard?.writeText(`${dir}\\${f.name}`) }}>Copy path</button>{' '}
              <button style={btn} onClick={() => getJson(`${base}/jvm/heap?file=${encodeURIComponent(f.name)}`, { method: 'DELETE' }).then(list)}>Delete</button></td></tr>))}
        </tbody>
      </table>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>Dumps are saved to {dir || 'the project folder'}. Open them in Eclipse MAT or VisualVM for a dominator-tree analysis.</div>
    </div>
  )
}

// ── JFR ──────────────────────────────────────────────────────────────────────
function Jfr({ base }) {
  const [info, setInfo] = useState({ files: [], status: '' })
  const [res, setRes] = useKept(base + 'jfr', null)
  const [settings, setSettings] = useKept(base + 'jfrset', 'profile')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const load = () => getJson(`${base}/jvm/jfr`).then(r => { if (r.ok) setInfo(r) })
  useEffect(() => { load() }, [])
  const running = /Recording \d+: name=dwb/.test(info.status || '')
  function act(a, extra) {
    setBusy(a); setErr(''); setMsg('')
    post(`${base}/jvm/jfr`, { action: a, settings, ...extra }).then(r => {
      if (!r.ok) setErr(r.error)
      else if (a === 'stop') setRes(r)
      else setMsg(r.message || '')
    }).finally(() => { setBusy(''); load() })
  }
  const open = f => getJson(`${base}/jvm/jfr?file=${encodeURIComponent(f)}`).then(r => { if (r.ok) setRes({ ...r, file: f }); else setErr(r.error) })
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <select style={inp} value={settings} onChange={e => setSettings(e.target.value)}>
          <option value="profile">profile (more detail)</option><option value="default">default (low overhead)</option>
        </select>
        <button style={btn} onClick={() => act('start')} disabled={!!busy || running}>Start recording</button>
        <button style={btn} onClick={() => act('stop')} disabled={!!busy || !running}>{busy === 'stop' ? 'Stopping / analysing...' : 'Stop and analyse'}</button>
        <button style={btn} onClick={load}>Refresh</button>
        <span style={{ fontSize: 12, color: running ? '#16a34a' : 'var(--text-muted)' }}>{running ? 'Recording...' : 'Not recording'}</span>
      </div>
      {msg && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{msg}</div>}
      <Err m={err} />
      {res && <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 12, marginBottom: 6 }}>{res.file} - {res.samples} execution samples</div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: '2 1 420px', maxHeight: 340, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Hot method (top frame)</th><th style={th}>Samples</th><th style={th}>%</th></tr></thead>
              <tbody>{(res.top_methods || []).map((m, i) => (
                <tr key={i}><td style={{ ...td, ...mono }}>{m.m}</td><td style={td}>{m.n}</td><td style={td}>{(m.n * 100 / (res.samples || 1)).toFixed(1)}%</td></tr>))}</tbody>
            </table>
          </div>
          <div style={{ flex: '1 1 260px', maxHeight: 340, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Thread group</th><th style={th}>Samples</th></tr></thead>
              <tbody>{(res.threads || []).map((m, i) => (<tr key={i}><td style={{ ...td, ...mono }}>{m.t}</td><td style={td}>{m.n}</td></tr>))}</tbody>
            </table>
          </div>
        </div>
        <details style={{ marginTop: 8 }}><summary style={{ fontSize: 12, cursor: 'pointer' }}>Event summary</summary><pre style={pre}>{res.summary}</pre></details>
      </div>}
      <div style={{ fontWeight: 600, fontSize: 13, margin: '14px 0 6px' }}>Recordings</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>File</th><th style={th}>Size</th><th style={th}>Taken</th><th style={th}></th></tr></thead>
        <tbody>{info.files.map(f => (
          <tr key={f.name}><td style={{ ...td, ...mono }}>{f.name}</td><td style={td}>{f.mb} MB</td><td style={td}>{when(f.mtime)}</td>
            <td style={td}><button style={btn} onClick={() => open(f.name)}>Analysis</button>{' '}
              <button style={btn} onClick={() => navigator.clipboard?.writeText(`${info.dir}\\${f.name}`)}>Copy path</button>{' '}
              <button style={btn} onClick={() => act('delete', { file: f.name })}>Delete</button></td></tr>))}
        </tbody>
      </table>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>Recordings are saved to {info.dir || 'the project folder'}; open the .jfr in JDK Mission Control for full detail.</div>
    </div>
  )
}

export function JvmDiagnosticsTab({ appName }) {
  const [sub, setSub] = useKept('jvmsub', 'dash')
  const base = `/api/local-app/${appName}`
  return (
    <div>
      <Pills value={sub} onChange={setSub} items={[{ key: 'dash', label: 'Dashboard' }, { key: 'thr', label: 'Thread Analyzer' }, { key: 'heap', label: 'HeapDump Analyzer' }, { key: 'jfr', label: 'JFR' }]} />
      {sub === 'dash' && <Dashboard base={base} />}
      {sub === 'thr' && <ThreadAnalyzer base={base} />}
      {sub === 'heap' && <HeapAnalyzer base={base} />}
      {sub === 'jfr' && <Jfr base={base} />}
    </div>
  )
}

// ── Logs ─────────────────────────────────────────────────────────────────────
export function LogsTab({ appName }) {
  const base = `/api/local-app/${appName}/obs`
  const [files, setFiles] = useKept(appName + 'logfiles', ['@docker'])
  const [file, setFile] = useKept(appName + 'logfile', '@docker')
  const [lines, setLines] = useKept(appName + 'loglines', 500)
  const [q, setQ] = useKept(appName + 'logq', '')
  const [lvl, setLvl] = useKept(appName + 'loglvl', '')
  const [text, setText] = useKept(appName + 'logtext', '')
  const [auto, setAuto] = useState(false)
  const [err, setErr] = useState('')
  const box = useRef(null)
  function load() {
    getJson(`${base}/log?file=${encodeURIComponent(file)}&lines=${lines}`).then(r => { if (r.ok) { setText(r.text); setErr('') } else setErr(r.error) })
  }
  useEffect(() => { getJson(`${base}/log-files`).then(r => { if (r.ok) setFiles(r.files) }); if (!text) load() }, [])
  useEffect(() => { if (!auto) return; const id = setInterval(load, 3000); return () => clearInterval(id) }, [auto, file, lines])
  const shown = useMemo(() => text.split('\n').filter(l => (!q || l.toLowerCase().includes(q.toLowerCase())) && (!lvl || new RegExp('\\b' + lvl + '\\b').test(l))).join('\n'), [text, q, lvl])
  useEffect(() => { if (auto && box.current) box.current.scrollTop = box.current.scrollHeight }, [shown, auto])
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <select style={{ ...inp, maxWidth: 420 }} value={file} onChange={e => setFile(e.target.value)}>
          {files.map(f => <option key={f} value={f}>{f === '@docker' ? 'Container output (docker logs)' : f}</option>)}
        </select>
        <select style={inp} value={lines} onChange={e => setLines(+e.target.value)}>{[200, 500, 1000, 2000, 5000].map(n => <option key={n} value={n}>{n} lines</option>)}</select>
        <select style={inp} value={lvl} onChange={e => setLvl(e.target.value)}>
          <option value="">All levels</option>{['ERROR', 'WARN', 'INFO', 'DEBUG', 'SEVERE'].map(l => <option key={l}>{l}</option>)}
        </select>
        <input style={{ ...inp, width: 220 }} placeholder="Filter text" value={q} onChange={e => setQ(e.target.value)} />
        <button style={btn} onClick={load}>Load</button>
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> Follow</label>
        <button style={btn} onClick={() => navigator.clipboard?.writeText(shown)}>Copy</button>
      </div>
      <Err m={err} />
      <pre ref={box} style={{ ...pre, maxHeight: 560 }}>{shown || 'No log lines'}</pre>
    </div>
  )
}

// ── Metrics ──────────────────────────────────────────────────────────────────
const HIST = {}
export function MetricsTab({ appName }) {
  const [pts, setPts] = useState(HIST[appName] || [])
  const [on, setOn] = useState(true)
  const [err, setErr] = useState('')
  useEffect(() => { HIST[appName] = pts }, [appName, pts])
  useEffect(() => {
    if (!on) return
    let dead = false
    const tick = () => getJson(`/api/local-app/${appName}/obs/metrics`).then(r => {
      if (dead) return
      if (r.ok) { setErr(''); setPts(p => [...p, r].slice(-120)) } else setErr(r.error)
    })
    tick(); const id = setInterval(tick, 5000)
    return () => { dead = true; clearInterval(id) }
  }, [appName, on])
  const last = pts[pts.length - 1] || {}
  const series = k => pts.map(p => p[k] ?? 0)
  const cards = [
    { t: 'Container CPU %', k: 'cpu', v: last.cpu != null ? last.cpu.toFixed(1) + '%' : '-', max: 100 },
    { t: 'Container memory %', k: 'mem_pct', v: last.mem_pct != null ? last.mem_pct.toFixed(1) + '%' : '-', max: 100 },
    { t: 'JVM heap used (MB)', k: 'heap_used_mb', v: last.heap_used_mb != null ? `${last.heap_used_mb} / ${last.heap_total_mb}` : '-' },
    { t: 'JVM threads', k: 'threads', v: last.threads ?? '-' },
  ]
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={on} onChange={e => setOn(e.target.checked)} /> Live (every 5s)</label>
        <button style={btn} onClick={() => setPts([])}>Reset</button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{pts.length} samples</span>
      </div>
      <Err m={err} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
        {cards.map(c => (
          <div key={c.k} className="card" style={{ padding: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.t}</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{c.v}</div>
            <Spark data={series(c.k)} max={c.max} />
          </div>))}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
        <Stat label="Memory (container)" value={last.mem} />
        <Stat label="JVM RSS" value={last.rss} />
        <Stat label="Network I/O" value={last.net} />
        <Stat label="Block I/O" value={last.block} />
        <Stat label="Container PIDs" value={last.pids} />
      </div>
    </div>
  )
}
