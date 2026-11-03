import { useState, useEffect, useRef, useCallback } from 'react'

const JOB_API = '/api/project-management/sonar-report'

// Survives navigating away and back (component unmounts): search text, results, selected class and its methods
const _itCache = {}

// IT tab: search test classes of the configured test modules, list their methods and run them with Maven.
// Runs are detached server-side jobs, so they keep going across Workbench restarts until aborted.
export default function ItTab({ appName, scope = 'local', vmIp = '' }) {
  const API = `/api/it/${scope}/${appName}`
  // remote apps run everything on the VM, so every call carries its IP
  const vq = (path) => scope === 'remote' ? `${path}${path.includes('?') ? '&' : '?'}vm_ip=${encodeURIComponent(vmIp)}` : path
  const jobKey = `it/${scope}/${appName}`
  const c0 = _itCache[jobKey] || {}

  const [cfg,        setCfg]        = useState(null)       // {modules, test_properties, srcdir, config_path}
  const [cfgOpen,    setCfgOpen]    = useState(false)
  const [draftMods,  setDraftMods]  = useState('')
  const [draftProps, setDraftProps] = useState('')
  const [cfgErr,     setCfgErr]     = useState('')
  const [q,          setQ]          = useState(c0.q || '')
  const [classes,    setClasses]    = useState(c0.classes || [])
  const [total,      setTotal]      = useState(c0.total || 0)
  const [loadErr,    setLoadErr]    = useState('')
  const [searching,  setSearching]  = useState(false)
  const [selected,   setSelected]   = useState(c0.selected || null)
  const [methods,    setMethods]    = useState(c0.methods || [])
  const [mq,         setMq]         = useState(c0.mq || '')
  const [methLoading, setMethLoading] = useState(false)
  const [term,       setTerm]       = useState(null)       // {jobId, label, text, state}
  const [err,        setErr]        = useState('')
  const [base,         setBase]         = useState('')
  const [changedTotal, setChangedTotal] = useState(0)
  const [changedMeths, setChangedMeths] = useState(c0.changedMeths || [])
  const [recent,       setRecent]       = useState(!!c0.recent)   // "Recent IT": only tests changed on this branch
  const selRef  = useRef(c0.selected?.path || '')
  const pollRef = useRef(null)
  const termRef = useRef(null)

  useEffect(() => {
    _itCache[jobKey] = { q, classes, total, selected, methods, mq, changedMeths, recent }
  }, [jobKey, q, classes, total, selected, methods, mq, changedMeths, recent])

  const loadCfg = useCallback(async () => {
    try {
      const d = await (await fetch(vq(`${API}/config`))).json()
      if (d.ok) { setCfg(d); setDraftMods((d.modules || []).join('\n')); setDraftProps(d.test_properties || '') }
    } catch { /* ignore */ }
  }, [API, vmIp])

  useEffect(() => { loadCfg() }, [loadCfg])

  // search classes (debounced); stale responses are ignored so the list always matches the box
  useEffect(() => {
    if (!cfg) return
    let stale = false
    const t = setTimeout(async () => {
      setSearching(true); setLoadErr('')
      try {
        const d = await (await fetch(vq(`${API}/classes?q=${encodeURIComponent(q.trim())}${recent ? '&recent=1' : ''}`))).json()
        if (stale) return
        if (d.ok) {
          setClasses(d.classes); setTotal(d.total); setBase(d.base || ''); setChangedTotal(d.changed_total || 0)
        } else { setClasses([]); setTotal(0); setLoadErr(d.error || 'Failed to load classes') }
      } catch (e) { if (!stale) setLoadErr(String(e)) }
      if (!stale) setSearching(false)
    }, 200)
    return () => { stale = true; clearTimeout(t) }
  }, [q, cfg, API, recent, vmIp])

  async function selectClass(c) {
    setSelected(c); setMq(''); setMethods([]); setChangedMeths([]); setMethLoading(true)
    selRef.current = c.path
    try {
      const d = await (await fetch(vq(`${API}/methods?path=${encodeURIComponent(c.path)}`))).json()
      if (selRef.current !== c.path) return   // another class was clicked meanwhile
      if (d.ok) {
        // changed methods first so they are easy to spot
        const ch = new Set(d.changed_methods || [])
        setChangedMeths(d.changed_methods || [])
        setMethods([...d.methods.filter(m => ch.has(m)), ...d.methods.filter(m => !ch.has(m))])
      }
    } catch { /* ignore */ }
    if (selRef.current === c.path) setMethLoading(false)
  }

  async function saveCfg() {
    setCfgErr('')
    try {
      const d = await (await fetch(vq(`${API}/config`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modules: draftMods.split('\n').map(s => s.trim()).filter(Boolean), test_properties: draftProps }),
      })).json()
      if (d.ok) { setCfgOpen(false); setSelected(null); await loadCfg() } else setCfgErr(d.error || 'Save failed')
    } catch (e) { setCfgErr(String(e)) }
  }

  // ── test.properties editor ──
  const [propsOpen,  setPropsOpen]  = useState(false)
  const [propRows,   setPropRows]   = useState([])   // [{key, value}]
  const [propInfo,   setPropInfo]   = useState({ path: '', exists: true })
  const [propQ,      setPropQ]      = useState('')
  const [propMsg,    setPropMsg]    = useState('')
  const [showSecret, setShowSecret] = useState(false)

  async function openProps() {
    setPropMsg(''); setPropQ('')
    try {
      const d = await (await fetch(vq(`${API}/properties`))).json()
      if (d.ok) { setPropRows(d.props); setPropInfo({ path: d.path, exists: d.exists }); setPropsOpen(true) }
    } catch (e) { setPropMsg(String(e)); setPropsOpen(true) }
  }
  async function saveProps() {
    setPropMsg('')
    try {
      const d = await (await fetch(vq(`${API}/properties`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ props: propRows }),
      })).json()
      setPropMsg(d.ok ? `✓ Saved ${d.count} properties (backup: .bak)` : (d.error || 'Save failed'))
    } catch (e) { setPropMsg(String(e)) }
  }
  const setProp = (i, f, v) => setPropRows(rs => rs.map((r, j) => j === i ? { ...r, [f]: v } : r))
  const isSecret = k => /PASS(WORD)?|PWD|SECRET|TOKEN/i.test(k)

  // ── job terminal ──
  const watch = useCallback((jid, label) => {
    clearInterval(pollRef.current)
    const tick = async () => {
      try {
        const d = await (await fetch(`${JOB_API}/ai-job/${jid}`)).json()
        if (!d.ok) return
        setTerm(prev => prev && prev.jobId !== jid ? prev : { jobId: jid, label: d.label || label, text: d.output || '', state: d.status })
        if (d.status && d.status !== 'running') clearInterval(pollRef.current)
      } catch { /* keep polling */ }
    }
    pollRef.current = setInterval(tick, 1500)
    tick()
  }, [])

  // re-attach to the latest run (e.g. after a Workbench restart)
  useEffect(() => {
    (async () => {
      try {
        const d = await (await fetch(`${JOB_API}/ai-job-latest/${jobKey}`)).json()
        const j = d.ok && d.job
        if (j) { setTerm({ jobId: j.job_id, label: j.label, text: j.output || '', state: j.status }); if (j.status === 'running') watch(j.job_id, j.label) }
      } catch { /* ignore */ }
    })()
    return () => clearInterval(pollRef.current)
  }, [jobKey, watch])

  useEffect(() => { if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight }, [term?.text])

  async function run(c, method) {
    setErr('')
    try {
      const d = await (await fetch(vq(`${API}/run`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module: c.module, cls: c.cls, method: method || '' }),
      })).json()
      if (!d.ok) { setErr(d.error || 'Failed to start'); return }
      const label = `running ${c.cls}${method ? '#' + method : ''}`
      setTerm({ jobId: d.job_id, label, text: '', state: 'running' })
      watch(d.job_id, label)
    } catch (e) { setErr(String(e)) }
  }

  const [copied, setCopied] = useState(false)
  async function copyLog() {
    const text = term?.text || ''
    try { await navigator.clipboard.writeText(text) }
    catch {
      const ta = document.createElement('textarea')   // fallback for non-secure contexts
      ta.value = text; document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      document.body.removeChild(ta)
    }
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  async function abort() {
    if (term) try { await fetch(`${JOB_API}/ai-abort/${term.jobId}`, { method: 'POST' }) } catch { /* ignore */ }
  }
  async function closeTerm() {
    if (term && term.state !== 'running') try { await fetch(`${JOB_API}/ai-job-dismiss/${term.jobId}`, { method: 'POST' }) } catch { /* ignore */ }
    clearInterval(pollRef.current)
    setTerm(null)
  }

  const running = term?.state === 'running'
  const shownMethods = methods.filter(m => !mq.trim() || m.toLowerCase().includes(mq.trim().toLowerCase()))
  const btn = (primary, disabled) => ({
    fontSize: 11, fontWeight: 600, padding: '3px 12px', borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
    background: disabled ? 'var(--surface2)' : primary ? '#2E7D32' : 'rgba(25,118,210,0.08)',
    color: disabled ? 'var(--text-muted)' : primary ? '#fff' : '#1565C0',
    border: primary && !disabled ? 'none' : '1px solid var(--border)',
  })
  const stColor = term?.state === 'done' ? '#2E7D32' : term?.state === 'running' ? '#1565C0' : '#B71C1C'
  const stTitle = !term ? '' : term.state === 'running' ? `Maven is ${term.label}…` : term.state === 'done' ? `✅ Passed: ${term.label}`
    : term.state === 'aborted' ? '⛔ Aborted' : `❌ Failed: ${term.label}`

  return (
    <div>
      <div className="card" style={{ marginBottom: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>🧪 Integration Tests</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {cfg ? `${(cfg.modules || []).length} test module${(cfg.modules || []).length !== 1 ? 's' : ''} · ${cfg.test_properties}` : 'loading…'}
        </span>
        <button onClick={() => (propsOpen ? setPropsOpen(false) : openProps())} style={{ ...btn(false), marginLeft: 'auto' }}>📝 test.properties</button>
        <button onClick={() => setCfgOpen(o => !o)} style={btn(false)}>⚙ Configure</button>
        <button onClick={async () => { await fetch(vq(`${API}/classes?refresh=1`)); setQ(x => x + ' '); setTimeout(() => setQ(x => x.trim()), 0) }} style={btn(false)}>↻ Rescan</button>
      </div>

      {cfgOpen && (
        <div className="card" style={{ marginBottom: 12, padding: '12px 14px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Test modules <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(one per line, relative to the project root)</span></div>
          <textarea value={draftMods} onChange={e => setDraftMods(e.target.value)} rows={5}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, boxSizing: 'border-box' }} />
          <div style={{ fontSize: 12, fontWeight: 600, margin: '10px 0 6px' }}>test.properties location</div>
          <input value={draftProps} onChange={e => setDraftProps(e.target.value)} placeholder="~/test.properties"
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, boxSizing: 'border-box' }} />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>Saved to {cfg?.config_path}</div>
          {cfgErr && <div style={{ color: '#B71C1C', fontSize: 12, marginTop: 6 }}>{cfgErr}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={saveCfg} style={btn(true)}>Save</button>
            <button onClick={() => setCfgOpen(false)} style={btn(false)}>Cancel</button>
          </div>
        </div>
      )}

      {propsOpen && (
        <div className="card" style={{ marginBottom: 12, padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>test.properties</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{propInfo.path}{!propInfo.exists && ' (not found - will be created on save)'}</span>
            <input value={propQ} onChange={e => setPropQ(e.target.value)} placeholder="Filter keys / values…" style={{ marginLeft: 'auto', width: 220 }} />
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={showSecret} onChange={e => setShowSecret(e.target.checked)} /> show passwords
            </label>
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
            {propRows.map((r, i) => {
              const q2 = propQ.trim().toLowerCase()
              if (q2 && !r.key.toLowerCase().includes(q2) && !r.value.toLowerCase().includes(q2)) return null
              return (
                <div key={i} style={{ display: 'flex', gap: 6, padding: '3px 6px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                  <input value={r.key} onChange={e => setProp(i, 'key', e.target.value)} style={{ flex: '0 0 280px', fontFamily: 'monospace', fontSize: 12 }} />
                  <input value={r.value} type={isSecret(r.key) && !showSecret ? 'password' : 'text'} onChange={e => setProp(i, 'value', e.target.value)}
                    style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }} />
                  <button onClick={() => setPropRows(rs => rs.filter((_, j) => j !== i))} title="Remove" style={{ ...btn(false), color: '#B71C1C', padding: '1px 8px' }}>✕</button>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
            <button onClick={() => { setPropQ(''); setPropRows(rs => [...rs, { key: '', value: '' }]) }} style={btn(false)}>+ Add property</button>
            <button onClick={saveProps} style={btn(true)}>Save</button>
            <button onClick={() => setPropsOpen(false)} style={btn(false)}>Close</button>
            {propMsg && <span style={{ fontSize: 12, color: propMsg.startsWith('✓') ? '#2E7D32' : '#B71C1C' }}>{propMsg}</span>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>Comments and commented-out entries in the file are preserved.</div>
        </div>
      )}

      {err && <div style={{ color: '#B71C1C', fontSize: 12, marginBottom: 8 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* class search */}
        <div className="card" style={{ flex: '1 1 360px', minWidth: 300, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder={recent ? 'Filter recently added ITs…' : 'Search test classes…'} style={{ flex: 1, minWidth: 0, boxSizing: 'border-box' }} />
              <button onClick={() => setRecent(r => !r)} title="Show only tests added or changed on this branch (vs master/main)"
                style={{ ...btn(recent), background: recent ? '#E65100' : 'rgba(25,118,210,0.08)', color: recent ? '#fff' : '#1565C0', whiteSpace: 'nowrap' }}>
                🕘 Recently Added ITs
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {searching ? 'Searching…' : `${total} class${total !== 1 ? 'es' : ''}${total > classes.length ? ` (showing ${classes.length})` : ''}`}
              {recent && <span style={{ color: '#E65100', fontWeight: 600 }}> · changed vs {base || 'base'}</span>}
            </div>
          </div>
          {loadErr && <div style={{ padding: 12, color: '#B71C1C', fontSize: 12 }}>{loadErr}</div>}
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
            {classes.map(c => (
              <div key={c.path} onClick={() => selectClass(c)}
                style={{ padding: '6px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: 12,
                  background: selected?.path === c.path ? 'rgba(25,118,210,0.10)' : 'transparent' }}>
                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {c.cls}
                  {c.changed && <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 7px', borderRadius: 8, background: c.changed === 'new' ? '#E8F5E9' : '#FFF8E1', color: c.changed === 'new' ? '#2E7D32' : '#E65100', border: `1px solid ${c.changed === 'new' ? '#A5D6A7' : '#FFCC80'}` }}>{c.changed === 'new' ? 'NEW' : 'MODIFIED'}</span>}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{c.module} · {c.fqcn}</div>
              </div>
            ))}
            {!searching && !loadErr && classes.length === 0 && (
              <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>{recent ? 'No tests added or changed on this branch.' : 'No test classes found. Check the test modules in ⚙ Configure.'}</div>
            )}
          </div>
        </div>

        {/* methods */}
        <div className="card" style={{ flex: '1 1 360px', minWidth: 300, padding: 0, overflow: 'hidden' }}>
          {!selected ? (
            <div style={{ padding: 20, fontSize: 12, color: 'var(--text-muted)' }}>Select a test class to see its test methods.</div>
          ) : (
            <>
              <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, flex: 1, minWidth: 0, wordBreak: 'break-all' }}>{selected.cls}</div>
                  <button onClick={() => run(selected)} disabled={running} style={btn(true, running)}>▶ Run class</button>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'monospace', margin: '2px 0 8px' }}>mvn test -Dtest={selected.cls} · {selected.module}{scope === 'remote' ? ' · on the VM' : ''}</div>
                <input value={mq} onChange={e => setMq(e.target.value)} placeholder="Filter methods…" style={{ width: '100%', boxSizing: 'border-box' }} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{methLoading ? 'Loading methods…' : `${shownMethods.length} of ${methods.length} methods`}</div>
              </div>
              <div style={{ maxHeight: 380, overflow: 'auto' }}>
                {shownMethods.map(m => (
                  <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderBottom: '1px solid var(--border)', fontSize: 12,
                    background: changedMeths.includes(m) ? 'rgba(255,193,7,0.18)' : 'transparent',
                    borderLeft: changedMeths.includes(m) ? '3px solid #FFA000' : '3px solid transparent' }}>
                    <span style={{ flex: 1, fontFamily: 'monospace', wordBreak: 'break-all', fontWeight: changedMeths.includes(m) ? 700 : 400 }}>{m}</span>
                    {changedMeths.includes(m) && <span style={{ fontSize: 9.5, fontWeight: 700, color: '#E65100' }}>{selected?.changed === 'new' ? 'NEW' : 'CHANGED'}</span>}
                    <button onClick={() => run(selected, m)} disabled={running} style={btn(false, running)}>▶ Run</button>
                  </div>
                ))}
                {methLoading && (
                  <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Loading test methods…
                  </div>
                )}
                {!methLoading && methods.length === 0 && <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>No @Test methods found in this class.</div>}
              </div>
            </>
          )}
        </div>
      </div>

      {term && (
        <div style={{ marginTop: 14, border: `1px solid ${stColor}`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface2)' }}>
            {running && <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2, borderColor: stColor, borderTopColor: 'transparent' }} />}
            <span style={{ fontWeight: 600, fontSize: 13, color: stColor }}>{stTitle}</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button onClick={copyLog} title="Copy the whole log"
                style={{ fontSize: 11, padding: '3px 12px', borderRadius: 6, background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-muted)' }}>
                {copied ? '✓ Copied' : '⧉ Copy'}
              </button>
              {running && <button onClick={abort} style={{ fontSize: 11, fontWeight: 600, padding: '3px 12px', borderRadius: 6, background: '#B71C1C', color: '#fff', border: 'none', cursor: 'pointer' }}>■ Abort</button>}
              <button onClick={closeTerm} title={running ? 'Hide the log - the test keeps running' : 'Close'}
                style={{ fontSize: 11, padding: '3px 12px', borderRadius: 6, background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-muted)' }}>✕ Close</button>
            </span>
          </div>
          <pre ref={termRef} style={{ margin: 0, padding: 12, background: '#0d1117', color: '#c9d1d9', fontSize: 11.5, lineHeight: 1.45, height: 340, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{term.text || 'Starting Maven…'}</pre>
        </div>
      )}
    </div>
  )
}
