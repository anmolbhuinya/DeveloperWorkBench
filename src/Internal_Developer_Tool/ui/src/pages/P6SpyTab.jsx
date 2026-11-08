import { useState, useEffect, useMemo } from 'react'

const th = { textAlign: 'left', padding: '5px 8px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)' }
const td = { padding: '4px 8px', fontSize: 12, borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const mono = { fontFamily: 'monospace', fontSize: 11 }
const inp = { ...mono, width: '100%', background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px' }
const pick = (d) => ({ lib_dir: d.lib_dir || '', targets: JSON.parse(JSON.stringify(d.targets || [])) })
const copyText = (txt) => { try { navigator.clipboard.writeText(txt) } catch (e) { /* ignore */ } }

// a copy button that says "Copying…" and then "Copied ✓" with the same wording as its label
export function CopyBtn({ text, label, disabled }) {
  const [st, setSt] = useState('')
  const go = async () => {
    setSt('copying')
    try { await navigator.clipboard.writeText(typeof text === 'function' ? text() : text); await new Promise(r => setTimeout(r, 350)); setSt('done') } catch (e) { setSt('failed') }
    setTimeout(() => setSt(''), 1800)
  }
  const what = label.replace(/^Copy\s*/i, '')
  return (
    <button className="btn btn-sm" onClick={go} disabled={disabled || st === 'copying'} style={st === 'done' ? { color: '#2e7d32', borderColor: '#2e7d32' } : st === 'failed' ? { color: '#c62828' } : undefined}>
      {st === 'copying' ? `Copying ${what}…` : st === 'done' ? `Copied ${what} ✓` : st === 'failed' ? 'Copy failed' : label}
    </button>
  )
}

// keeps loaded data while navigating to other pages and back
const CACHE = {}

export default function P6SpyTab({ appName }) {
  const c0 = CACHE[appName] || {}
  const [st, setSt] = useState(c0.st || null)
  const [rows, setRows] = useState(c0.rows || [])
  const [total, setTotal] = useState(c0.total || 0)
  const [sel, setSel] = useState(c0.sel ?? null)
  const [q, setQ] = useState(c0.q || '')
  const [cfgOpen, setCfgOpen] = useState(false)
  const [setOpen, setSetOpen] = useState(false)
  const [form, setForm] = useState({})
  const [cfgText, setCfgText] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => { CACHE[appName] = { st, rows, total, sel, q } }, [appName, st, rows, total, sel, q])

  const base = `/api/local-app/${appName}/p6spy`
  function loadStatus() {
    fetch(`${base}/settings`).then(r => r.json()).then(d => { if (d.ok) { setSt(d); setForm(f => Object.keys(f).length ? f : pick(d)) } }).catch(() => {})
  }
  function loadLog() {
    setLoading(true)
    fetch(`${base}/log?limit=1000`).then(r => r.json())
      .then(d => { if (d.ok) { setRows(d.rows || []); setTotal(d.total || 0); setSel(null) } else setMsg({ ok: false, text: d.error }) })
      .catch(() => setMsg({ ok: false, text: 'Could not reach server' }))
      .finally(() => setLoading(false))
  }
  useEffect(() => { loadStatus(); if (!CACHE[appName]) loadLog() }, [appName])   // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(en) {
    setBusy(true)
    fetch(`${base}/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: en }) })
      .then(r => r.json()).then(d => { if (d.ok) { setSt(d); setMsg({ ok: true, text: d.message || '' }) } })
      .catch(() => setMsg({ ok: false, text: 'Could not reach server' }))
      .finally(() => setBusy(false))
  }
  const setT = (i, fn) => setForm(f => ({ ...f, targets: f.targets.map((x, j) => j === i ? fn(x) : x) }))
  function saveSettings() {
    setBusy(true)
    fetch(`${base}/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      .then(r => r.json()).then(d => { if (d.ok) { setSt(d); setForm(pick(d)); setMsg({ ok: true, text: d.message || 'Settings saved' }) } else setMsg({ ok: false, text: d.error }) })
      .catch(() => setMsg({ ok: false, text: 'Could not reach server' }))
      .finally(() => setBusy(false))
  }
  function openCfg() {
    setCfgOpen(o => !o)
    if (!cfgOpen) fetch(`${base}/config`).then(r => r.json()).then(d => { if (d.ok) setCfgText(d.content) })
  }
  function saveCfg() {
    fetch(`${base}/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: cfgText }) })
      .then(r => r.json()).then(d => setMsg(d.ok ? { ok: true, text: d.message || 'spy.properties saved' } : { ok: false, text: d.error }))
  }
  function clearLog() {
    fetch(`${base}/clear`, { method: 'POST' }).then(() => { setRows([]); setTotal(0); setSel(null) })
  }

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? rows.filter(r => (r.sql + ' ' + r.result).toLowerCase().includes(s)) : rows
  }, [rows, q])
  const cur = sel != null ? shown[sel] : null

  return (
    <div>
      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" checked={!!st?.enabled} disabled={busy || !st} onChange={e => toggle(e.target.checked)} />
          Enable P6Spy
          {busy && <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />}
        </label>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.6 }}>
          Logs every SQL statement with its real bind values (and result rows when the <code>resultset</code> category is not excluded).
          Enabling copies the P6Spy jar and <code>spy.properties</code> into the app server container and points the JDBC URLs/drivers in
          <code> runtime.properties</code> at P6Spy; disabling reverts that. <b>Restart the app server</b> after changing it.
        </div>
        {st && !st.installed && <div className="alert alert-error" style={{ marginTop: 8 }}>P6Spy is not installed - install it in Setup → Dev Softwares first.</div>}
        {st && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, fontFamily: 'monospace', lineHeight: 1.6 }}>
            jar: {st.jar || '-'}<br />config: {st.config}<br />project: {st.project}<br />container: {st.container || '-'}
          </div>
        )}
        {msg && msg.text && <div className={'alert ' + (msg.ok ? 'alert-success' : 'alert-error')} style={{ marginTop: 8 }}>{msg.text}</div>}
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={() => setSetOpen(o => !o)}>{setOpen ? 'Hide settings' : 'Settings'}</button>
          <button className="btn btn-sm" onClick={openCfg}>{cfgOpen ? 'Hide spy.properties' : 'Edit spy.properties'}</button>
        </div>
        {setOpen && form.targets && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.6 }}>
              Files inside the container that are rewritten when P6Spy is enabled (and reverted when disabled). A rule with <b>keys</b> changes
              <code> key=&lt;from&gt;</code> lines (<code>*</code> = any prefix, comma separated); a rule without keys replaces the text anywhere in the file
              (e.g. in <code>.jocl</code> files).
            </div>
            {form.targets.map((t, ti) => (
              <div key={ti} className="card" style={{ padding: 8, marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input type="text" value={t.file} placeholder="/path/in/container/file" onChange={e => setT(ti, x => ({ ...x, file: e.target.value }))} style={{ ...inp, flex: 1 }} />
                  <button className="btn btn-sm" onClick={() => setForm(f => ({ ...f, targets: f.targets.filter((_, i) => i !== ti) }))}>Remove file</button>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th}>Keys (optional)</th><th style={th}>Replace</th><th style={th}>With</th><th style={th}></th></tr></thead>
                  <tbody>
                    {t.rules.map((r, ri) => (
                      <tr key={ri}>
                        {['keys', 'from', 'to'].map(k => (
                          <td key={k} style={td}><input type="text" value={r[k]} onChange={e => setT(ti, x => ({ ...x, rules: x.rules.map((y, i) => i === ri ? { ...y, [k]: e.target.value } : y) }))} style={inp} /></td>
                        ))}
                        <td style={td}><button className="btn btn-sm" onClick={() => setT(ti, x => ({ ...x, rules: x.rules.filter((_, i) => i !== ri) }))}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="btn btn-sm" style={{ marginTop: 4 }} onClick={() => setT(ti, x => ({ ...x, rules: [...x.rules, { keys: '', from: '', to: '' }] }))}>+ Add rule</button>
              </div>
            ))}
            <button className="btn btn-sm" onClick={() => setForm(f => ({ ...f, targets: [...f.targets, { file: '', rules: [{ keys: '', from: '', to: '' }] }] }))}>+ Add file</button>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', margin: '10px 0 0' }}>Container folder for the P6Spy jar + spy.properties (on the app server classpath)
              <input type="text" value={form.lib_dir || ''} onChange={e => setForm(f => ({ ...f, lib_dir: e.target.value }))} style={{ ...inp, display: 'block', width: '100%', marginTop: 2 }} />
            </label>
            <div style={{ marginTop: 8 }}>
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={saveSettings}>Save settings</button>
              <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => setForm(pick(st?.defaults || {}))}>Reset to defaults</button>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>If P6Spy is enabled, the old values are reverted and the new ones applied in the container.</span>
            </div>
          </div>
        )}        {cfgOpen && (
          <div style={{ marginTop: 8 }}>
            <textarea value={cfgText} onChange={e => setCfgText(e.target.value)} spellCheck={false}
              style={{ width: '100%', minHeight: 170, ...mono, background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: 8 }} />
            <button className="btn btn-sm btn-primary" onClick={saveCfg}>Save</button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <input type="text" placeholder="Filter SQL / values…" value={q} onChange={e => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 200, background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 10px', fontSize: 12 }} />
        <button className="btn btn-sm" onClick={loadLog} disabled={loading}>{loading ? '…' : '↻ Refresh'}</button>
        <button className="btn btn-sm" onClick={clearLog} disabled={!rows.length}>🗑 Clear log</button>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{shown.length} shown · {total} log lines (newest first)</span>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
          No P6Spy log yet. Enable P6Spy, restart the app server, make a call that hits the database, then press Refresh.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, maxHeight: 480, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 4 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Time</th><th style={th}>ms</th><th style={th}>Category</th><th style={th}>SQL (bind values applied)</th></tr></thead>
              <tbody>
                {shown.slice(0, 500).map((r, i) => (
                  <tr key={i} onClick={() => setSel(i)} style={{ cursor: 'pointer', background: sel === i ? 'rgba(59,130,246,0.12)' : 'transparent' }}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.time}</td>
                    <td style={td}>{r.ms}</td>
                    <td style={td}>{r.category}</td>
                    <td style={{ ...td, ...mono, wordBreak: 'break-word' }}>{r.sql.length > 160 ? r.sql.slice(0, 160) + '…' : r.sql}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {!cur ? <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 12 }}>Click a statement to see it in full.</div> : (
              <div className="card" style={{ padding: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{cur.time} · {cur.ms} ms · {cur.category} · connection {cur.conn}</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <CopyBtn text={cur.sql} label="Copy query" />
                  <CopyBtn text={cur.result} label="Copy result" disabled={!cur.result} />
                </div>
                <pre style={{ ...mono, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, maxHeight: 200, overflow: 'auto' }}>{cur.sql}</pre>
                <div style={{ fontWeight: 600, fontSize: 12, margin: '10px 0 4px' }}>Result</div>
                <pre style={{ ...mono, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, maxHeight: 220, overflow: 'auto' }}>
                  {cur.result || 'No result rows logged for this statement (P6Spy logs only the columns the application actually read, as column number = value; updates/inserts have none; make sure the resultset category is not excluded in spy.properties).'}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
