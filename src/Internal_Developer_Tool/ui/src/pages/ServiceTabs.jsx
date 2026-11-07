import { useState, useEffect } from 'react'

const th = { textAlign: 'left', padding: '5px 6px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)' }
const td = { padding: '3px 4px', borderBottom: '1px solid var(--border)', verticalAlign: 'top', fontSize: 12 }
const mono = { fontFamily: 'monospace', fontSize: 11 }
const inp = { ...mono, width: '100%', background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 5px', boxSizing: 'border-box' }
const pre = { ...mono, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, margin: 0, maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap' }
const btn = { padding: '4px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }

const KEPT = {}
function useKept(key, init) {
  const [v, setV] = useState(() => (key in KEPT ? KEPT[key] : init))
  useEffect(() => { KEPT[key] = v }, [key, v])
  return [v, setV]
}
const getJson = (u, opt) => fetch(u, opt).then(r => r.json()).catch(() => ({ ok: false, error: 'Could not reach server' }))
const post = (u, b) => getJson(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) })
const Err = ({ m }) => m ? <div style={{ color: '#dc2626', fontSize: 12, margin: '6px 0', whiteSpace: 'pre-wrap' }}>{m}</div> : null

function ConfigTable({ base, kind, cfg, reload }) {
  const [rows, setRows] = useState(cfg.connections.map(c => ({ ...c, _old: true })))
  const [msg, setMsg] = useState('')
  const set = (i, k, v) => setRows(rows.map((r, j) => j === i ? { ...r, [k]: v } : r))
  const save = () => post(`${base}/config`, { connections: rows }).then(r => { setMsg(r.ok ? `Saved to ${kind}_config.xlsx` : r.error); if (r.ok) reload() })
  return (
    <div className="card" style={{ padding: 10, marginBottom: 10 }}>
      <div style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead><tr><th style={th}>On</th><th style={th}>Name</th><th style={th}>Provider</th><th style={th}>Host</th><th style={th}>Port</th><th style={th}>Username</th><th style={th}>Secret</th>
            <th style={th}>{cfg.scope_label}</th><th style={th}>Options</th><th style={th}></th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>
              <td style={td}><input type="checkbox" checked={r.enabled} onChange={e => set(i, 'enabled', e.target.checked)} /></td>
              <td style={{ ...td, width: 130 }}><input style={inp} value={r.name} readOnly={r._old} onChange={e => set(i, 'name', e.target.value)} /></td>
              <td style={{ ...td, width: 110 }}><select style={inp} value={r.provider} onChange={e => set(i, 'provider', e.target.value)}>
                {[...new Set([...cfg.providers, r.provider].filter(Boolean))].map(p => <option key={p}>{p}</option>)}</select></td>
              <td style={td}><input style={inp} value={r.host} onChange={e => set(i, 'host', e.target.value)} /></td>
              <td style={{ ...td, width: 64 }}><input style={inp} value={r.port} onChange={e => set(i, 'port', e.target.value)} /></td>
              <td style={td}><input style={inp} value={r.username} onChange={e => set(i, 'username', e.target.value)} /></td>
              <td style={td}><input style={inp} type="password" value={r.secret} onChange={e => set(i, 'secret', e.target.value)} /></td>
              <td style={td}><input style={inp} value={r.scope} onChange={e => set(i, 'scope', e.target.value)} /></td>
              <td style={td}><input style={inp} value={r.options} onChange={e => set(i, 'options', e.target.value)} /></td>
              <td style={td}><button style={btn} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button></td>
            </tr>))}</tbody>
        </table>
      </div>
      <div style={{ margin: '8px 0' }}>
        <button style={btn} onClick={() => setRows([...rows, { name: '', enabled: true, provider: cfg.providers[0], host: 'localhost', port: '', username: '', secret: '', scope: '', options: '' }])}>Add connection</button>{' '}
        <button style={btn} onClick={save}>Save</button>
        <span style={{ fontSize: 12, marginLeft: 8, color: 'var(--text-muted)' }}>{msg}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Config file: {cfg.file}. Host and port are as seen from this PC (published container ports). Options: {kind === 'vault' ? 'kv=2;https=true;namespace=...' : 'ssl=true'}.</div>
    </div>
  )
}

function CacheBrowse({ act }) {
  const [pat, setPat] = useState('*')
  const [rows, setRows] = useState([])
  const [val, setVal] = useState(null)
  const [info, setInfo] = useState('')
  const [err, setErr] = useState('')
  const scan = () => { setErr(''); act({ action: 'keys', pattern: pat }).then(r => { if (r.ok) { setRows(r.rows); setVal(null) } else setErr(r.error) }) }
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <input style={{ ...inp, width: 260 }} value={pat} onChange={e => setPat(e.target.value)} placeholder="Key pattern, e.g. user:*" />
        <button style={btn} onClick={scan}>Scan keys</button>
        <button style={btn} onClick={() => act({ action: 'info' }).then(r => r.ok ? setInfo(r.text) : setErr(r.error))}>Server info</button>
      </div>
      <Err m={err} />
      {info && <pre style={{ ...pre, marginBottom: 8 }}>{info}</pre>}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 380px', maxHeight: 360, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Key ({rows.length})</th><th style={th}>Type</th><th style={th}>TTL</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.key} style={{ cursor: 'pointer' }} onClick={() => act({ action: 'get', key: r.key }).then(x => x.ok ? setVal({ key: r.key, ...x }) : setErr(x.error))}>
                <td style={{ ...td, ...mono }}>{r.key}</td><td style={td}>{r.type}</td><td style={td}>{r.ttl}</td></tr>))}</tbody>
          </table>
        </div>
        <div style={{ flex: '1 1 380px' }}>{val ? <><div style={{ fontSize: 12, marginBottom: 4 }}><b>{val.key}</b> ({val.type})</div><pre style={pre}>{val.value}</pre></> :
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Click a key to see its value.</div>}</div>
      </div>
    </div>
  )
}

function HeBlobBrowse({ act }) {
  const [pat, setPat] = useState('*')
  const [rows, setRows] = useState([])
  const [tb, setTb] = useState(null)
  const [cur, setCur] = useState('')
  const [limit, setLimit] = useState(100)
  const [cell, setCell] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const scan = () => { setErr(''); setBusy(true); act({ action: 'keys', pattern: pat }).then(r => { if (r.ok) setRows(r.rows); else setErr(r.error) }).finally(() => setBusy(false)) }
  const open = (k, l = limit) => { setErr(''); setCur(k); setCell(null); act({ action: 'get', key: k, limit: l }).then(r => { if (r.ok) setTb(r.table); else setErr(r.error) }) }
  useEffect(() => { scan() }, [])
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...inp, width: 260 }} value={pat} onChange={e => setPat(e.target.value)} placeholder="Filter within BLOB_ tables, e.g. *CLAIM*" />
        <button style={btn} onClick={scan} disabled={busy}>{busy ? 'Loading...' : 'List BLOB_ tables'}</button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{rows.length} tables</span>
      </div>
      <Err m={err} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '0 1 320px', maxHeight: 460, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Table</th><th style={th}>Rows</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.key} style={{ cursor: 'pointer', background: cur === r.key ? 'var(--surface2)' : '' }} onClick={() => open(r.key)}>
                <td style={{ ...td, ...mono }}>{r.key}</td><td style={td}>{r.ttl}</td></tr>))}</tbody>
          </table>
        </div>
        <div style={{ flex: '1 1 500px', minWidth: 0 }}>
          {tb ? <>
            <div style={{ fontSize: 12, marginBottom: 6 }}><b>{cur}</b> - showing {tb.rows.length} of {tb.total} rows{' '}
              <select style={{ ...inp, width: 'auto' }} value={limit} onChange={e => { setLimit(+e.target.value); open(cur, +e.target.value) }}>{[50, 100, 500, 1000].map(n => <option key={n} value={n}>{n} rows</option>)}</select></div>
            <div style={{ overflow: 'auto', maxHeight: 400 }}>
              <table style={{ borderCollapse: 'collapse' }}>
                <thead><tr>{tb.columns.map(c => <th key={c} style={th}>{c}</th>)}</tr></thead>
                <tbody>{tb.rows.map((r, i) => (<tr key={i}>{r.map((v, j) => (
                  <td key={j} style={{ ...td, ...mono, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                    title="Click to see the full value" onClick={() => setCell({ col: tb.columns[j], v })}>{v === null ? <i style={{ color: 'var(--text-muted)' }}>null</i> : String(v)}</td>))}</tr>))}</tbody>
              </table>
            </div>
            {cell && <div style={{ marginTop: 8 }}><div style={{ fontSize: 12, marginBottom: 4 }}><b>{cell.col}</b> <button style={btn} onClick={() => navigator.clipboard?.writeText(String(cell.v ?? ''))}>Copy</button></div><pre style={pre}>{String(cell.v ?? 'null')}</pre></div>}
          </> : <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Click a BLOB_ table to see its content.</div>}
        </div>
      </div>
    </div>
  )
}

function LdapBrowse({ act, defBase }) {
  const [base, setBase] = useState(defBase || '')
  const [filter, setFilter] = useState('(objectClass=*)')
  const [scope, setScope] = useState('sub')
  const [res, setRes] = useState([])
  const [open, setOpen] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { setBase(defBase || '') }, [defBase])
  const run = () => { setErr(''); act({ action: 'search', base, filter, scope }).then(r => { if (r.ok) { setRes(r.entries); setOpen(null) } else setErr(r.error) }) }
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <input style={{ ...inp, width: 300 }} value={base} onChange={e => setBase(e.target.value)} placeholder="Base DN" />
        <input style={{ ...inp, width: 260 }} value={filter} onChange={e => setFilter(e.target.value)} placeholder="(uid=jsmith) or (cn=*smith*)" />
        <select style={{ ...inp, width: 'auto' }} value={scope} onChange={e => setScope(e.target.value)}><option value="base">Base</option><option value="one">One level</option><option value="sub">Subtree</option></select>
        <button style={btn} onClick={run}>Search</button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>{res.length} entries (max 200)</span>
      </div>
      <Err m={err} />
      <div style={{ maxHeight: 460, overflow: 'auto' }}>
        {res.map((e, i) => (
          <div key={i} style={{ borderBottom: '1px solid var(--border)', padding: '3px 0' }}>
            <div style={{ ...mono, cursor: 'pointer' }} onClick={() => setOpen(open === i ? null : i)}>{open === i ? '▼' : '▶'} {e.dn}</div>
            {open === i && <table style={{ marginLeft: 16 }}><tbody>{Object.entries(e.attrs).map(([k, v]) => (<tr key={k}><td style={{ ...td, ...mono, color: 'var(--text-muted)' }}>{k}</td><td style={{ ...td, ...mono }}>{v.join(', ')}</td></tr>))}</tbody></table>}
          </div>))}
      </div>
    </div>
  )
}

function VaultBrowse({ act }) {
  const [path, setPath] = useState('')
  const [keys, setKeys] = useState([])
  const [sec, setSec] = useState(null)
  const [show, setShow] = useState(false)
  const [err, setErr] = useState('')
  const list = p => { setErr(''); setPath(p); setSec(null); act({ action: 'list', path: p }).then(r => r.ok ? setKeys(r.keys) : setErr(r.error)) }
  const read = p => { setErr(''); act({ action: 'read', path: p }).then(r => { if (r.ok) { setSec({ path: p, ...r }); setShow(false) } else setErr(r.error) }) }
  const join = k => (path ? path.replace(/\/$/, '') + '/' : '') + k
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input style={{ ...inp, width: 300 }} value={path} onChange={e => setPath(e.target.value)} placeholder="Path under the mount (blank = root)" />
        <button style={btn} onClick={() => list(path)}>List</button>
        <button style={btn} onClick={() => read(path)}>Read</button>
      </div>
      <Err m={err} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 300px', maxHeight: 360, overflow: 'auto' }}>
          {keys.map(k => (<div key={k} style={{ ...mono, cursor: 'pointer', padding: '2px 0', fontSize: 12 }} onClick={() => k.endsWith('/') ? list(join(k)) : read(join(k))}>{k.endsWith('/') ? '📁 ' : '🔑 '}{k}</div>))}
          {keys.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nothing listed.</div>}
        </div>
        <div style={{ flex: '1 1 380px' }}>
          {sec && <>
            <div style={{ fontSize: 12, marginBottom: 4 }}><b>{sec.path}</b> <label style={{ marginLeft: 8 }}><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> Reveal values</label></div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>{Object.entries(sec.data || {}).map(([k, v]) => (
              <tr key={k}><td style={{ ...td, ...mono, color: 'var(--text-muted)' }}>{k}</td><td style={{ ...td, ...mono, wordBreak: 'break-all' }}>{show ? (typeof v === 'string' ? v : JSON.stringify(v)) : '••••••••'}</td></tr>))}</tbody></table>
            {sec.meta && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>version {sec.meta.version} - {sec.meta.created_time}</div>}
          </>}
        </div>
      </div>
    </div>
  )
}

function ServiceTab({ appName, kind, title }) {
  const base = `/api/local-app/${appName}/svc/${kind}`
  const [cfg, setCfg] = useState(null)
  const [sel, setSel] = useKept(base + 'sel', '')
  const [cfgOpen, setCfgOpen] = useState(false)
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = () => getJson(`${base}/config`).then(r => { if (r.ok) setCfg(r) })
  useEffect(() => { load() }, [])
  const list = (cfg?.connections || []).filter(c => c.enabled)
  useEffect(() => { if (list.length && !list.find(c => c.name === sel)) setSel(list[0].name) }, [cfg])
  const act = body => post(`${base}/action`, { name: sel, ...body })
  const cur = list.find(c => c.name === sel)
  function test() { setBusy(true); setRes(null); act({ action: 'test' }).then(setRes).finally(() => setBusy(false)) }
  if (!cfg) return <div style={{ fontSize: 12 }}>Loading...</div>
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        <select style={{ ...inp, width: 'auto' }} value={sel} onChange={e => { setSel(e.target.value); setRes(null) }}>
          {list.length === 0 && <option value="">No enabled connection</option>}
          {list.map(c => <option key={c.name} value={c.name}>{c.name} ({c.provider} {c.host}:{c.port})</option>)}
        </select>
        <button style={btn} onClick={test} disabled={busy || !sel}>{busy ? 'Testing...' : 'Test connection'}</button>
        <button style={btn} onClick={() => setCfgOpen(v => !v)}>{cfgOpen ? 'Hide config' : 'Configure'}</button>
        {res && <span style={{ fontSize: 12, color: res.ok ? '#16a34a' : '#dc2626' }}>{res.ok ? res.message : res.error}</span>}
      </div>
      {cfgOpen && <ConfigTable base={base} kind={kind} cfg={cfg} reload={load} />}
      {sel && kind === 'cache' && (cur?.provider === 'he-blob' ? <HeBlobBrowse key={sel} act={act} /> : <CacheBrowse key={sel} act={act} />)}
      {sel && kind === 'ldap' && <LdapBrowse key={sel} act={act} defBase={cur?.scope} />}
      {sel && kind === 'vault' && <VaultBrowse key={sel} act={act} />}
    </div>
  )
}

export const CacheTab = ({ appName }) => <ServiceTab appName={appName} kind="cache" title="Cache" />
export const LdapTab = ({ appName }) => <ServiceTab appName={appName} kind="ldap" title="LDAP" />
export const VaultTab = ({ appName }) => <ServiceTab appName={appName} kind="vault" title="Secrets / Vault" />
