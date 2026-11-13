import { useState, useEffect, useCallback } from 'react'

// Certificate management of an application's trust store (keytool inside the container / on the VM).
// Settings (trust store path, temp upload folder, password, keytool) are kept in <app>\server_config.xlsx, sheet certificate_management.
export default function CertificateManager({ scope = 'local', appName, vmIp = '' }) {
  const api = `/api/cm/${scope}/${appName}`
  const vq  = p => (scope === 'remote' && vmIp ? `${p}${p.includes('?') ? '&' : '?'}vm_ip=${encodeURIComponent(vmIp)}` : p)
  const call = useCallback(async (action, body) => {
    try {
      return await (await fetch(vq(`${api}/${action}`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })).json()
    } catch { return { ok: false, error: 'Could not reach server' } }
  }, [api, vmIp])

  const [cfg, setCfg]       = useState(null)       // { settings, container, container_error, config_file }
  const [draft, setDraft]   = useState({})
  const [tab, setTab]       = useState('store')    // store | import
  const [entries, setEntries] = useState(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [open, setOpen]     = useState({})         // alias -> details shown
  const [backups, setBackups] = useState([])
  const [files, setFiles]   = useState([])
  const [split, setSplit]   = useState({})         // file -> parts[]
  const [alias, setAlias]   = useState({})         // file / part file -> alias being typed
  const [pwd, setPwd]       = useState({})         // file / part file -> keystore password override
  const [bk, setBk]         = useState(true)       // back the trust store up before delete / import
  const [busy, setBusy]     = useState('')
  const [msg, setMsg]       = useState(null)       // { ok, text }
  const [dlg, setDlg]       = useState(null)

  const say = (ok, text) => setMsg({ ok, text })
  const loadCfg = useCallback(() => fetch(vq(api)).then(r => r.json()).then(d => { if (d.ok) { setCfg(d); setDraft(d.settings) } }).catch(() => {}), [api, vmIp])
  useEffect(() => { loadCfg() }, [loadCfg])

  const [cands, setCands] = useState([])     // cacerts files found in the container when the configured trust store is missing
  const load = async () => {
    setLoading(true); setMsg(null); setCands([])
    const d = await call('list')
    setLoading(false)
    if (d.ok) {
      setEntries(d.entries)
      if (d.settings) { setCfg(c => ({ ...c, settings: d.settings })); setDraft(d.settings) }
      if (d.auto) say(true, d.auto)
    } else { setEntries(null); setCands(d.candidates || []); say(false, d.error) }
  }
  const useStore = async p => {
    setBusy('settings'); const d = await call('settings', { ...draft, trust_store: p }); setBusy('')
    if (d.ok) { setCfg(c => ({ ...c, settings: d.settings })); setDraft(d.settings); load() } else say(false, d.error)
  }
  const loadFiles = async () => { const d = await call('temp'); if (d.ok) setFiles(d.files); else say(false, d.error) }
  useEffect(() => { if (tab === 'store' && entries === null && cfg && !cfg.container_error) load(); if (tab === 'import' && cfg && !cfg.container_error) loadFiles() }, [tab, cfg?.container, cfg?.container_error])

  const saveSettings = async () => {
    setBusy('settings'); const d = await call('settings', draft); setBusy('')
    if (d.ok) { say(true, 'Settings saved'); setCfg(c => ({ ...c, settings: d.settings })); setDraft(d.settings); setEntries(null) } else say(false, d.error)
  }
  const doBackup = async () => {
    setBusy('backup'); const d = await call('backup'); setBusy('')
    if (d.ok) { setBackups(d.backups); say(true, `Backed up to ${d.backups[d.backups.length - 1] || 'a .bak_<date> file'}`) } else say(false, d.error)
  }
  const del = a => setDlg({ icon: '🗑', tone: '#e53935', title: 'Delete certificate', chip: a.alias, confirmLabel: 'Delete', message: `This removes the alias from ${cfg.settings.trust_store}.${bk ? ' The trust store is backed up first.' : ' No backup will be taken.'}`,
    onOk: async () => { setBusy('del:' + a.alias); const d = await call('delete', { alias: a.alias, backup: bk }); setBusy(''); if (d.ok) { say(true, `Deleted ${a.alias}`); load() } else say(false, d.error) } })
  const upload = async file => {
    if (!file) return
    setBusy('upload')
    const buf = new Uint8Array(await file.arrayBuffer()); let bin = ''; buf.forEach(b => { bin += String.fromCharCode(b) })
    const d = await call('upload', { name: file.name.replace(/[^\w.\-]+/g, '_'), content: btoa(bin) })
    setBusy(''); if (d.ok) { say(true, `Uploaded ${d.file} to ${cfg.settings.temp_dir}`); loadFiles() } else say(false, d.error)
  }
  const importCert = async (file) => {
    const a = (alias[file] || '').trim()
    if (!a) { say(false, 'Enter an alias first'); return }
    setBusy('imp:' + file); const d = await call('import', { file, alias: a, password: pwd[file] || '', backup: bk }); setBusy('')
    if (d.ok) { say(true, `Imported ${file} as "${a}"`); setEntries(null) } else say(false, d.error)
  }
  const doSplit = async file => {
    setBusy('split:' + file); const d = await call('split', { file }); setBusy('')
    if (d.ok) { setSplit(s => ({ ...s, [file]: d.parts })); setAlias(a => ({ ...a, ...Object.fromEntries(d.parts.map(p => [p.file, p.alias])) })); say(true, `Split into ${d.count} certificate${d.count === 1 ? '' : 's'}`); loadFiles() } else say(false, d.error)
  }
  const rmTemp = async file => { const d = await call('temp-delete', { file }); if (d.ok) { setSplit(s => { const n = { ...s }; delete n[file]; return n }); loadFiles() } else say(false, d.error) }

  const q = filter.trim().toLowerCase()
  const shown = (entries || []).filter(e => !q || `${e.alias} ${e.subject} ${e.issuer} ${e.sha256} ${e.serial}`.toLowerCase().includes(q))
  const input = { background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 4, padding: '3px 7px', fontSize: 12 }
  const cell  = { padding: '5px 8px', fontSize: 12, verticalAlign: 'top' }
  const sbtn  = { fontSize: 11, padding: '2px 9px' }
  const tabBtn = a => ({ fontSize: 12, fontWeight: 600, padding: '4px 14px', borderRadius: 14, cursor: 'pointer', border: '1px solid var(--primary,#1976d2)', background: a ? 'var(--primary,#1976d2)' : 'var(--bg)', color: a ? '#fff' : 'var(--primary,#1976d2)' })
  const dirty = cfg && JSON.stringify(draft) !== JSON.stringify(cfg.settings)
  const field = (label, k, w, type = 'text') => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: 'var(--text-muted)', flex: w }}>{label}
      <input type={type} value={draft[k] || ''} onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} style={{ ...input, fontFamily: 'monospace', color: 'var(--text-primary)' }} />
    </label>)

  return (
    <div className="card" style={{ marginTop: 14 }}>
      {dlg && <CertDialog dlg={dlg} onClose={() => setDlg(null)} />}
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>🔐 Certificate Management</div>

      {/* configurable locations */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 6 }}>
        {field('Trust store', 'trust_store', '1 1 300px')}
        {field('Temporary upload folder (in the container)', 'temp_dir', '1 1 200px')}
        {field('Store password', 'store_password', '0 0 130px', 'password')}
        {field('keytool', 'keytool', '0 0 110px')}
        <button className="btn btn-sm btn-primary" style={sbtn} disabled={!dirty || busy === 'settings'} onClick={saveSettings}>Save</button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
        {cfg ? <>Container <b>{cfg.container || '—'}</b> · saved in {cfg.config_file} › certificate_management</> : 'Loading…'}
      </div>
      {cfg?.container_error && <div className="alert alert-error" style={{ fontSize: 12, marginBottom: 8 }}>{cfg.container_error} <button className="btn btn-sm" style={sbtn} onClick={loadCfg}>↻ Retry</button></div>}
      {msg && <div style={{ fontSize: 12, marginBottom: 8, color: msg.ok ? '#2e7d32' : '#c62828', whiteSpace: 'pre-wrap' }}>{msg.ok ? '✓ ' : '⚠ '}{msg.text}</div>}
      {cands.length > 0 && (
        <div style={{ marginBottom: 8, padding: '8px 10px', border: '1px dashed #f9a825', borderRadius: 6, background: 'rgba(249,168,37,0.10)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Trust stores found in this container</div>
          {cands.map(p => (
            <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <code style={{ fontSize: 12, flex: 1, wordBreak: 'break-all' }}>{p}</code>
              <button className="btn btn-sm btn-primary" style={sbtn} disabled={busy === 'settings'} onClick={() => useStore(p)}>Use this</button>
            </div>))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={tabBtn(tab === 'store')} onClick={() => setTab('store')}>Trust store{entries ? ` (${entries.length})` : ''}</button>
        <button style={tabBtn(tab === 'import')} onClick={() => setTab('import')}>Upload / Import</button>
        <label style={{ marginLeft: 'auto', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} title="Copies the trust store to <trust store>.bak_<yyyy-mm-dd> before deleting or importing">
          <input type="checkbox" checked={bk} onChange={e => setBk(e.target.checked)} /> Back up the trust store before delete / import
        </label>
      </div>

      {tab === 'store' && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="🔍 Filter by alias, subject, issuer, fingerprint, serial…" style={{ ...input, flex: 1, minWidth: 260 }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{entries ? `${shown.length} of ${entries.length}` : ''}</span>
            <button className="btn btn-sm" style={sbtn} disabled={loading || !!cfg?.container_error} onClick={load}>{loading ? 'Loading…' : '↻ Reload'}</button>
            <button className="btn btn-sm" style={sbtn} disabled={busy === 'backup' || !!cfg?.container_error} title="cp cacerts cacerts.bak_$(date +%F)" onClick={doBackup}>💾 Backup trust store</button>
          </div>
          {backups.length > 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontFamily: 'monospace' }}>Backups: {backups.join('  ·  ')}</div>}
          {loading && !entries ? <div style={{ textAlign: 'center', padding: 20 }}><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /></div> : (
            <div style={{ maxHeight: 460, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 5 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: 'var(--bg-secondary)', position: 'sticky', top: 0, zIndex: 1 }}>
                  {['', 'Alias', 'Subject (CN)', 'Issuer', 'Valid until', 'SHA-256', ''].map((h, i) => <th key={i} style={{ ...cell, textAlign: 'left', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {entries && shown.length === 0 && <tr><td colSpan={7} style={{ ...cell, textAlign: 'center', color: 'var(--text-muted)', padding: 16 }}>{filter ? 'No certificates match' : 'The trust store is empty'}</td></tr>}
                  {shown.map(e => [
                    <tr key={e.alias} style={{ borderBottom: '1px solid var(--border-color)', background: e.expired ? 'rgba(229,57,53,0.08)' : undefined }}>
                      <td style={{ ...cell, cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setOpen(o => ({ ...o, [e.alias]: !o[e.alias] }))} title="Show details">{open[e.alias] ? '▾' : '▸'}</td>
                      <td style={{ ...cell, fontFamily: 'monospace', wordBreak: 'break-all' }}>{e.alias}</td>
                      <td style={{ ...cell, wordBreak: 'break-word' }} title={e.subject}>{e.cn}</td>
                      <td style={{ ...cell, wordBreak: 'break-word', maxWidth: 220 }} title={e.issuer}>{(e.issuer.match(/CN=([^,]+)/) || [])[1] || e.issuer}</td>
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>{(e.valid_until.match(/(\w{3} \d{1,2}) [\d:]+ \w+ (\d{4})/) || []).slice(1).join(', ') || e.valid_until}{e.expired && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#fff', background: '#e53935', borderRadius: 8, padding: '1px 6px' }}>expired</span>}</td>
                      <td style={{ ...cell, fontFamily: 'monospace', fontSize: 10, wordBreak: 'break-all', maxWidth: 190 }} title={e.sha256}>{e.sha256.slice(0, 23)}…</td>
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                        <button className="btn btn-sm" style={{ ...sbtn, padding: '1px 6px' }} onClick={() => navigator.clipboard?.writeText(e.sha256)} title="Copy SHA-256">📋</button>{' '}
                        <button disabled={busy === 'del:' + e.alias} title="Delete this alias" onClick={() => del(e)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f44336', fontSize: 14, padding: '2px 4px' }}>🗑</button>
                      </td>
                    </tr>,
                    open[e.alias] && (
                      <tr key={e.alias + '-d'}><td colSpan={7} style={{ ...cell, background: 'var(--surface)' }}>
                        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                          <span>Type: {e.type}</span><span>Created: {e.created}</span><span>Valid from: {e.valid_from}</span><span>Until: {e.valid_until}</span><span>Signature: {e.sig_alg}</span>
                        </div>
                        <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 280, overflow: 'auto' }}>{e.detail}</pre>
                      </td></tr>),
                  ])}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'import' && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <label className="btn btn-sm btn-primary" style={{ ...sbtn, cursor: 'pointer' }}>
              {busy === 'upload' ? 'Uploading…' : '⬆ Upload certificate…'}
              <input type="file" accept=".pem,.crt,.cer,.der,.txt,.p7b" style={{ display: 'none' }} disabled={!!cfg?.container_error}
                onChange={e => { upload(e.target.files[0]); e.target.value = '' }} />
            </label>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Uploaded to <code>{cfg?.settings?.temp_dir}</code> {scope === 'remote' ? 'inside the container on the VM' : 'inside the container'} · PEM / CRT / CER, single certificate or a full chain</span>
            <button className="btn btn-sm" style={{ ...sbtn, marginLeft: 'auto' }} onClick={loadFiles}>↻ Refresh</button>
          </div>
          {files.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 14, textAlign: 'center', border: '1px dashed var(--border-color)', borderRadius: 6 }}>No files in the temporary folder yet. Upload a certificate first.</div>}
          {files.map(f => (
            <div key={f.name} style={{ border: '1px solid var(--border-color)', borderRadius: 6, padding: '8px 10px', marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{f.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.size} bytes</span>
                {f.certs > 1 && <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: '#f9a825', borderRadius: 8, padding: '1px 7px' }}>chain · {f.certs} certificates</span>}
                {f.certs === 1 && <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: '#43a047', borderRadius: 8, padding: '1px 7px' }}>1 certificate</span>}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {f.certs > 1
                    ? <button className="btn btn-sm btn-primary" style={sbtn} disabled={busy === 'split:' + f.name} onClick={() => doSplit(f.name)}>✂ Split full chain</button>
                    : <>
                        <input placeholder="alias" value={alias[f.name] || ''} onChange={e => setAlias(a => ({ ...a, [f.name]: e.target.value }))} style={{ ...input, width: 150 }} />
                        <input placeholder={`password (default ${cfg?.settings?.store_password === 'changeit' ? 'changeit' : 'saved'})`} type="password" value={pwd[f.name] || ''} onChange={e => setPwd(a => ({ ...a, [f.name]: e.target.value }))} style={{ ...input, width: 150 }} />
                        <button className="btn btn-sm btn-primary" style={sbtn} disabled={busy === 'imp:' + f.name} onClick={() => importCert(f.name)}>{busy === 'imp:' + f.name ? 'Importing…' : '⬇ Import to trust store'}</button>
                      </>}
                  <button className="btn btn-sm btn-danger" style={sbtn} title="Remove this file from the temporary folder" onClick={() => rmTemp(f.name)}>🗑</button>
                </span>
              </div>
              {split[f.name] && (
                <div style={{ marginTop: 8, borderTop: '1px dashed var(--border-color)', paddingTop: 6 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Individual certificates (each saved as its own file in the temporary folder):</div>
                  {split[f.name].map(p => (
                    <div key={p.file} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '5px 0', borderBottom: '1px solid var(--border-color)' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 18 }}>{p.index}.</span>
                      <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, wordBreak: 'break-word' }} title={p.subject}>{(p.subject.match(/CN=([^,]+)/) || [])[1] || p.subject || p.file}
                          {p.self_signed && <span style={{ marginLeft: 6, fontSize: 10, color: '#fff', background: '#1e88e5', borderRadius: 8, padding: '1px 6px' }}>root</span>}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-word' }}>Issuer: {(p.issuer.match(/CN=([^,]+)/) || [])[1] || p.issuer} · until {(p.valid_until.match(/(\w{3} \d{1,2}) [\d:]+ \w+ (\d{4})/) || []).slice(1).join(', ') || p.valid_until} · <span style={{ fontFamily: 'monospace' }}>{p.file}</span></div>
                      </div>
                      <input placeholder="alias" value={alias[p.file] || ''} onChange={e => setAlias(a => ({ ...a, [p.file]: e.target.value }))} style={{ ...input, width: 150 }} />
                      <input placeholder="password" type="password" value={pwd[p.file] || ''} onChange={e => setPwd(a => ({ ...a, [p.file]: e.target.value }))} style={{ ...input, width: 100 }} />
                      <button className="btn btn-sm btn-primary" style={sbtn} disabled={busy === 'imp:' + p.file} onClick={() => importCert(p.file)}>{busy === 'imp:' + p.file ? 'Importing…' : '⬇ Import'}</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function CertDialog({ dlg, onClose }) {
  const ok = () => { onClose(); dlg.onOk() }
  useEffect(() => { const h = e => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter') ok() }; document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h) })
  return (
    <div className="modal-overlay" onMouseDown={onClose} style={{ backdropFilter: 'blur(2px)' }}>
      <div onMouseDown={e => e.stopPropagation()} style={{ width: 440, maxWidth: '92vw', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderTop: `4px solid ${dlg.tone}`, borderRadius: 12, boxShadow: '0 20px 50px rgba(0,0,0,0.45)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 14, padding: '20px 22px 6px' }}>
          <div style={{ width: 42, height: 42, borderRadius: '50%', background: dlg.tone + '26', color: dlg.tone, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{dlg.icon}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{dlg.title}</div>
            {dlg.chip && <div style={{ display: 'inline-block', marginTop: 6, fontFamily: 'monospace', fontSize: 12, fontWeight: 600, padding: '2px 9px', borderRadius: 10, background: dlg.tone + '26', color: dlg.tone, wordBreak: 'break-all' }}>{dlg.chip}</div>}
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>{dlg.message}</div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 22px 18px' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn" autoFocus onClick={ok} style={{ background: dlg.tone, borderColor: dlg.tone, color: '#fff', fontWeight: 600 }}>{dlg.confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
