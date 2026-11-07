import { useState, useEffect } from 'react'
import { usePanels, GearIcon } from './ScreenConfig'

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
            <th style={th}>{cfg.scope_label}</th><th style={th}>Options</th>{kind === 'ldap' && <th style={th}>Provider settings (Key=Value per line)</th>}<th style={th}></th></tr></thead>
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
              {kind === 'ldap' && <td style={{ ...td, minWidth: 260 }}><textarea style={{ ...inp, height: 60 }} value={r.settings || ''} onChange={e => set(i, 'settings', e.target.value)} /></td>}
              <td style={td}><button style={btn} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button></td>
            </tr>))}</tbody>
        </table>
      </div>
      <div style={{ margin: '8px 0' }}>
        <button style={btn} onClick={() => setRows([...rows, { name: '', enabled: true, provider: cfg.providers[0], host: 'localhost', port: '', username: '', secret: '', scope: '', options: '', settings: '' }])}>Add connection</button>{' '}
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
        <input style={{ ...inp, width: 260 }} value={pat} onChange={e => setPat(e.target.value)} placeholder="Filter Cache Tables, e.g. *CLAIM*" />
        <button style={btn} onClick={scan} disabled={busy}>{busy ? 'Loading...' : 'Refresh'}</button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{rows.length} tables</span>
      </div>
      <Err m={err} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '0 1 340px', maxHeight: 460, overflow: 'auto' }}>
          {[['meta', 'Cache Metadata Table'], ['cache', 'Cache Table']].map(([cat, title]) => (
            <div key={cat} style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 12, padding: '4px 6px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>{title} ({rows.filter(r => r.cat === cat).length})</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>{rows.filter(r => r.cat === cat).map(r => (
                  <tr key={r.key} style={{ cursor: r.type === 'missing' ? 'default' : 'pointer', opacity: r.type === 'missing' ? 0.5 : 1, background: cur === r.key ? 'var(--surface2)' : '' }}
                    onClick={() => r.type !== 'missing' && open(r.key)}>
                    <td style={{ ...td, ...mono }}>{r.key.toLowerCase()}</td><td style={td}>{r.ttl}</td></tr>))}</tbody>
              </table>
            </div>))}
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
          </> : <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Click a table to see its details.</div>}
        </div>
      </div>
    </div>
  )
}

function LdapBrowse({ act, defBase, settings }) {
  const [base, setBase] = useState(defBase || '')
  const [filter, setFilter] = useState('(objectClass=*)')
  const [scope, setScope] = useState('sub')
  const [user, setUser] = useState('')
  const [res, setRes] = useState([])
  const [open, setOpen] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { setBase(defBase || '') }, [defBase])
  const st = settings || {}
  const run = (o = {}) => {
    const q = { base, filter, scope, ...o }
    setBase(q.base); setFilter(q.filter); setScope(q.scope); setErr('')
    act({ action: 'search', ...q }).then(r => { if (r.ok) { setRes(r.entries); setOpen(null) } else setErr(r.error) })
  }
  const users = () => run({ base: st.UserBaseDn || base, filter: st.AllUsersFilter || `(objectClass=${st.UserObjectClass || '*'})`, scope: 'sub' })
  const groups = () => run({ base: st.GroupBaseDn || base, filter: st.AllGroupsFilter || `(objectClass=${st.StaticGroupObjectClass || '*'})`, scope: 'sub' })
  const findUser = () => run({ base: st.UserBaseDn || base, filter: (st.UserFromNameFilter || `(${st.UserNameAttribute || 'uid'}=%u)`).replace('%u', user), scope: 'sub' })
  return (
    <div>
      {Object.keys(st).length > 0 && <details style={{ marginBottom: 8 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Provider settings ({Object.keys(st).length})</summary>
        <table style={{ borderCollapse: 'collapse' }}><tbody>{Object.entries(st).map(([k, v]) => (<tr key={k}><td style={{ ...td, ...mono, color: 'var(--text-muted)' }}>{k}</td><td style={{ ...td, ...mono, wordBreak: 'break-all' }}>{v}</td></tr>))}</tbody></table>
      </details>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={btn} onClick={users}>All users</button>
        <button style={btn} onClick={groups}>All groups</button>
        <input style={{ ...inp, width: 160 }} value={user} onChange={e => setUser(e.target.value)} placeholder="User name" />
        <button style={btn} onClick={findUser} disabled={!user}>Find user</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <input style={{ ...inp, width: 300 }} value={base} onChange={e => setBase(e.target.value)} placeholder="Base DN" />
        <input style={{ ...inp, width: 260 }} value={filter} onChange={e => setFilter(e.target.value)} placeholder="(uid=jsmith) or (cn=*smith*)" />
        <select style={{ ...inp, width: 'auto' }} value={scope} onChange={e => setScope(e.target.value)}><option value="base">Base</option><option value="one">One level</option><option value="sub">Subtree</option></select>
        <button style={btn} onClick={() => run()}>Search</button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>{res.length} entries (max 200)</span>
      </div>
      <Err m={err} />
      <div style={{ maxHeight: 460, overflow: 'auto' }}>
        {res.map((e, i) => (
          <div key={i} style={{ borderBottom: '1px solid var(--border)', padding: '3px 0' }}>
            <div style={{ ...mono, cursor: 'pointer' }} onClick={() => setOpen(open === i ? null : i)}>{open === i ? '\u25BC' : '\u25B6'} {e.dn}</div>
            {open === i && <table style={{ marginLeft: 16 }}><tbody>{Object.entries(e.attrs).map(([k, v]) => (<tr key={k}><td style={{ ...td, ...mono, color: 'var(--text-muted)' }}>{k}</td><td style={{ ...td, ...mono }}>{v.join(', ')}</td></tr>))}</tbody></table>}
          </div>))}
      </div>
    </div>
  )
}

const first = (e, k) => (e?.attrs?.[k] || [])[0] || ''
const F = ({ label, children }) => <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>{label}{children}</label>

function LdapUsers({ act, st, ad, defBase }) {
  const nameAttr = st.UserNameAttribute || (ad ? 'sAMAccountName' : 'uid')
  const oc = st.UserObjectClass || (ad ? 'user' : 'inetOrgPerson')
  const base = st.UserBaseDn || defBase
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(null)
  const [grp, setGrp] = useState(null)
  const [msg, setMsg] = useState(null)
  const say = r => setMsg(r.ok ? { ok: true, t: r.message } : { ok: false, t: r.error })
  const list = () => {
    const nm = q.trim()
    const filter = nm ? `(&(objectClass=${oc})(|(${nameAttr}=*${nm}*)(cn=*${nm}*)(mail=*${nm}*)))` : `(objectClass=${oc})`
    act({ action: 'search', base, filter, scope: 'sub' }).then(r => r.ok ? setRows(r.entries) : say(r))
  }
  useEffect(() => { list() }, [])
  const blank = { mode: 'add', dn: '', v: { [nameAttr]: '', cn: '', givenName: '', sn: '', mail: '', description: '', password: '' } }
  const edit = e => setForm({ mode: 'edit', dn: e.dn, v: { [nameAttr]: first(e, nameAttr), cn: first(e, 'cn'), givenName: first(e, 'givenName'), sn: first(e, 'sn'), mail: first(e, 'mail'), description: first(e, 'description') }, orig: e })
  async function save() {
    const v = form.v
    if (form.mode === 'add') {
      const key = v[nameAttr].trim(); const cn = (v.cn || key).trim()
      if (!key) return say({ ok: false, error: nameAttr + ' is required' })
      const dn = ad ? `CN=${cn},${base}` : `${nameAttr}=${key},${base}`
      const attrs = ad
        ? { objectClass: ['top', 'person', 'organizationalPerson', 'user'], cn, sAMAccountName: key, givenName: v.givenName, sn: v.sn, mail: v.mail, description: v.description, userAccountControl: '514' }
        : { objectClass: ['top', 'person', 'organizationalPerson', oc], [nameAttr]: key, cn, sn: v.sn || cn, givenName: v.givenName, mail: v.mail, description: v.description, userPassword: v.password }
      let r = await act({ action: 'add', dn, attrs })
      if (r.ok && ad && v.password) {
        const p = await act({ action: 'password', dn, password: v.password })
        if (p.ok) { await act({ action: 'enable', dn }); r = { ok: true, message: `Created ${dn} (enabled, password set)` } }
        else r = { ok: true, message: `Created ${dn} as a DISABLED account - ${p.error}` }
      } else if (r.ok && ad) r = { ok: true, message: `Created ${dn} as a disabled account (no password given)` }
      say(r); if (r.ok) { setForm(null); list() }
    } else {
      const changes = []
      for (const k of ['cn', 'givenName', 'sn', 'mail', 'description']) {
        const o = first(form.orig, k); const n = (v[k] || '').trim()
        if (o !== n) changes.push({ op: n ? 'replace' : 'delete', attr: k, values: n ? [n] : [] })
      }
      if (!changes.length) return say({ ok: false, error: 'Nothing changed' })
      const r = await act({ action: 'modify', dn: form.dn, changes }); say(r); if (r.ok) { setForm(null); list() }
    }
  }
  const del = e => { if (window.confirm(`Delete user ${e.dn}?`)) act({ action: 'delete', dn: e.dn }).then(r => { say(r); list() }) }
  const pw = e => { const p = window.prompt(`New password for ${e.dn}`); if (p) act({ action: 'password', dn: e.dn, password: p }).then(say) }
  const toggle = e => act({ action: (parseInt(first(e, 'userAccountControl') || '0', 10) & 2) ? 'enable' : 'disable', dn: e.dn }).then(r => { say(r); list() })
  const groupsOf = e => {
    const gb = st.GroupBaseDn || base; const ma = st.StaticMemberDNAttribute || 'member'
    act({ action: 'search', base: gb, filter: `(${ma}=${e.dn})`, scope: 'sub' }).then(r => r.ok ? setGrp({ user: e.dn, ma, list: r.entries }) : say(r))
  }
  const leave = g => act({ action: 'modify', dn: g.dn, changes: [{ op: 'delete', attr: grp.ma, values: [grp.user] }] }).then(r => { say(r); setGrp(null) })
  const fld = (k, l, o = {}) => <F label={l}><input style={inp} type={o.type} value={form.v[k] || ''} readOnly={o.ro} onChange={e => setForm({ ...form, v: { ...form.v, [k]: e.target.value } })} /></F>
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <input style={{ ...inp, width: 240 }} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && list()} placeholder="Search name / cn / mail" />
        <button style={btn} onClick={list}>Search</button>
        <button style={btn} onClick={() => setForm(blank)}>Add user</button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>{rows.length} users in {base}</span>
      </div>
      {msg && <div style={{ fontSize: 12, margin: '4px 0', color: msg.ok ? '#16a34a' : '#dc2626', whiteSpace: 'pre-wrap' }}>{msg.t}</div>}
      {form && <div className="card" style={{ padding: 10, marginBottom: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{form.mode === 'add' ? 'New user' : 'Edit ' + form.dn}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {fld(nameAttr, nameAttr + ' (login)', { ro: form.mode === 'edit' })}{fld('cn', 'cn (full name)')}{fld('givenName', 'First name')}{fld('sn', 'Last name')}{fld('mail', 'Email')}{fld('description', 'Description')}
          {form.mode === 'add' && fld('password', 'Password', { type: 'password' })}
        </div>
        <div style={{ marginTop: 8 }}><button style={btn} onClick={save}>{form.mode === 'add' ? 'Create' : 'Save'}</button>{' '}<button style={btn} onClick={() => setForm(null)}>Cancel</button></div>
        {form.mode === 'add' && ad && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>Active Directory only accepts passwords over LDAPS. Without ssl=true in Options (and port 636) the account is created disabled.</div>}
      </div>}
      {grp && <div className="card" style={{ padding: 10, marginBottom: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Groups of {grp.user} <button style={{ ...btn, float: 'right' }} onClick={() => setGrp(null)}>Close</button></div>
        {grp.list.length === 0 && <div style={{ fontSize: 12 }}>Not a member of any group.</div>}
        {grp.list.map(g => <div key={g.dn} style={{ ...mono, padding: '2px 0' }}>{g.dn} <button style={btn} onClick={() => leave(g)}>Remove from group</button></div>)}
      </div>}
      <div style={{ maxHeight: 440, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>{nameAttr}</th><th style={th}>cn</th><th style={th}>mail</th>{ad && <th style={th}>State</th>}<th style={th}>DN</th><th style={th}></th></tr></thead>
          <tbody>{rows.map(e => (
            <tr key={e.dn}><td style={{ ...td, ...mono }}>{first(e, nameAttr)}</td><td style={td}>{first(e, 'cn')}</td><td style={td}>{first(e, 'mail')}</td>
              {ad && <td style={td}>{(parseInt(first(e, 'userAccountControl') || '0', 10) & 2) ? 'disabled' : 'enabled'}</td>}
              <td style={{ ...td, ...mono, wordBreak: 'break-all' }}>{e.dn}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                <button style={btn} onClick={() => edit(e)}>Edit</button>{' '}<button style={btn} onClick={() => pw(e)}>Password</button>{' '}
                {ad && <><button style={btn} onClick={() => toggle(e)}>{(parseInt(first(e, 'userAccountControl') || '0', 10) & 2) ? 'Enable' : 'Disable'}</button>{' '}</>}
                <button style={btn} onClick={() => groupsOf(e)}>Groups</button>{' '}<button style={btn} onClick={() => del(e)}>Delete</button></td></tr>))}</tbody>
        </table>
      </div>
    </div>
  )
}

function LdapGroups({ act, st, ad, defBase }) {
  const goc = st.StaticGroupObjectClass || (ad ? 'group' : 'groupOfNames')
  const ma = st.StaticMemberDNAttribute || 'member'
  const gna = st.StaticGroupNameAttribute || 'cn'
  const base = st.GroupBaseDn || defBase
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(null)
  const [mem, setMem] = useState(null)
  const [add, setAdd] = useState('')
  const [pick, setPick] = useState([])
  const [msg, setMsg] = useState(null)
  const say = r => setMsg(r.ok ? { ok: true, t: r.message } : { ok: false, t: r.error })
  const list = () => act({ action: 'search', base, filter: q.trim() ? `(&(objectClass=${goc})(${gna}=*${q.trim()}*))` : `(objectClass=${goc})`, scope: 'sub' }).then(r => r.ok ? setRows(r.entries) : say(r))
  useEffect(() => { list() }, [])
  const members = e => e.attrs[ma] || []
  async function create() {
    const v = form.v; const nm = v.name.trim()
    if (!nm) return say({ ok: false, error: 'Group name is required' })
    const dn = `CN=${nm},${base}`
    const attrs = ad ? { objectClass: ['top', 'group'], cn: nm, sAMAccountName: nm, description: v.description, groupType: '-2147483646' }
      : { objectClass: ['top', goc], cn: nm, description: v.description, [ma]: [v.member || st.Principal || ''] }
    const r = await act({ action: 'add', dn: ad ? dn : dn.replace(/^CN=/, 'cn='), attrs }); say(r); if (r.ok) { setForm(null); list() }
  }
  const saveDesc = async () => {
    const n = (form.v.description || '').trim(); const o = first(form.orig, 'description')
    if (n === o) return say({ ok: false, error: 'Nothing changed' })
    const r = await act({ action: 'modify', dn: form.dn, changes: [{ op: n ? 'replace' : 'delete', attr: 'description', values: n ? [n] : [] }] }); say(r); if (r.ok) { setForm(null); list() }
  }
  const del = e => { if (window.confirm(`Delete group ${e.dn}?`)) act({ action: 'delete', dn: e.dn }).then(r => { say(r); setMem(null); list() }) }
  const refreshMem = dn => act({ action: 'search', base: dn, filter: `(objectClass=*)`, scope: 'base' }).then(r => { if (r.ok && r.entries[0]) { setMem(r.entries[0]); list() } })
  const addMember = dn => dn && act({ action: 'modify', dn: mem.dn, changes: [{ op: 'add', attr: ma, values: [dn.trim()] }] }).then(r => { say(r); setAdd(''); refreshMem(mem.dn) })
  const rmMember = dn => act({ action: 'modify', dn: mem.dn, changes: [{ op: 'delete', attr: ma, values: [dn] }] }).then(r => { say(r); refreshMem(mem.dn) })
  const findUsers = () => act({ action: 'search', base: st.UserBaseDn || defBase, filter: `(&(objectClass=${st.UserObjectClass || (ad ? 'user' : 'inetOrgPerson')})(|(${st.UserNameAttribute || (ad ? 'sAMAccountName' : 'uid')}=*${add}*)(cn=*${add}*)))`, scope: 'sub' }).then(r => r.ok && setPick(r.entries.slice(0, 20)))
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <input style={{ ...inp, width: 240 }} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && list()} placeholder="Search group name" />
        <button style={btn} onClick={list}>Search</button>
        <button style={btn} onClick={() => setForm({ mode: 'add', v: { name: '', description: '', member: '' } })}>Add group</button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>{rows.length} groups in {base}</span>
      </div>
      {msg && <div style={{ fontSize: 12, margin: '4px 0', color: msg.ok ? '#16a34a' : '#dc2626', whiteSpace: 'pre-wrap' }}>{msg.t}</div>}
      {form && <div className="card" style={{ padding: 10, marginBottom: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{form.mode === 'add' ? 'New group' : 'Edit ' + form.dn}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
          {form.mode === 'add' && <F label="Group name"><input style={inp} value={form.v.name} onChange={e => setForm({ ...form, v: { ...form.v, name: e.target.value } })} /></F>}
          <F label="Description"><input style={inp} value={form.v.description} onChange={e => setForm({ ...form, v: { ...form.v, description: e.target.value } })} /></F>
          {form.mode === 'add' && !ad && <F label="Initial member DN (groupOfNames needs one)"><input style={inp} value={form.v.member} placeholder={st.Principal || ''} onChange={e => setForm({ ...form, v: { ...form.v, member: e.target.value } })} /></F>}
        </div>
        <div style={{ marginTop: 8 }}><button style={btn} onClick={form.mode === 'add' ? create : saveDesc}>{form.mode === 'add' ? 'Create' : 'Save'}</button>{' '}<button style={btn} onClick={() => setForm(null)}>Cancel</button></div>
      </div>}
      {mem && <div className="card" style={{ padding: 10, marginBottom: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Members of {mem.dn} ({members(mem).length}) <button style={{ ...btn, float: 'right' }} onClick={() => setMem(null)}>Close</button></div>
        <div style={{ maxHeight: 200, overflow: 'auto', marginBottom: 6 }}>{members(mem).map(m => <div key={m} style={{ ...mono, padding: '2px 0' }}>{m} <button style={btn} onClick={() => rmMember(m)}>Remove</button></div>)}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={{ ...inp, width: 340 }} value={add} onChange={e => setAdd(e.target.value)} placeholder="Member DN, or a name to look up" />
          <button style={btn} onClick={() => addMember(add)}>Add member (DN)</button>
          <button style={btn} onClick={findUsers}>Look up user</button>
        </div>
        {pick.map(u => <div key={u.dn} style={{ ...mono, padding: '2px 0', cursor: 'pointer' }} onClick={() => { addMember(u.dn); setPick([]) }}>+ {u.dn}</div>)}
      </div>}
      <div style={{ maxHeight: 440, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>{gna}</th><th style={th}>Members</th><th style={th}>Description</th><th style={th}>DN</th><th style={th}></th></tr></thead>
          <tbody>{rows.map(e => (
            <tr key={e.dn}><td style={{ ...td, ...mono }}>{first(e, gna)}</td><td style={td}>{members(e).length}</td><td style={td}>{first(e, 'description')}</td><td style={{ ...td, ...mono, wordBreak: 'break-all' }}>{e.dn}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}><button style={btn} onClick={() => { setMem(e); setPick([]) }}>Members</button>{' '}
                <button style={btn} onClick={() => setForm({ mode: 'edit', dn: e.dn, orig: e, v: { description: first(e, 'description') } })}>Edit</button>{' '}<button style={btn} onClick={() => del(e)}>Delete</button></td></tr>))}</tbody>
        </table>
      </div>
    </div>
  )
}

function LdapPane({ act, defBase, settings, provider }) {
  const [v0, setV] = useKept('ldapview', 'browse')
  const on = usePanels()
  const vis = ['browse', 'users', 'groups'].filter(k => on('ldap_' + k))
  const v = vis.includes(v0) ? v0 : vis[0]
  const ad = provider === 'activedirectory'
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {[['browse', 'Browse'], ['users', 'Users'], ['groups', 'Groups']].filter(([k]) => vis.includes(k)).map(([k, l]) => (
          <button key={k} onClick={() => setV(k)} style={{ padding: '3px 12px', fontSize: 12, borderRadius: 14, cursor: 'pointer', border: '1px solid var(--border)',
            background: v === k ? 'var(--primary, #2563eb)' : 'transparent', color: v === k ? '#fff' : 'inherit' }}>{l}</button>))}
      </div>
      {v === 'browse' && <LdapBrowse act={act} defBase={defBase} settings={settings} />}
      {v === 'users' && <LdapUsers act={act} st={settings} ad={ad} defBase={defBase} />}
      {v === 'groups' && <LdapGroups act={act} st={settings} ad={ad} defBase={defBase} />}
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

function ServiceTab({ appName, kind, title, filter, importer, side }) {
  const base = `/api/local-app/${appName}/svc/${kind}`
  const [cfg, setCfg] = useState(null)
  const [sel, setSel] = useKept(base + 'sel' + title, '')
  const [cfgOpen, setCfgOpen] = useState(false)
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = () => getJson(`${base}/config`).then(r => { if (r.ok) setCfg(r) })
  useEffect(() => { load() }, [])
  const list = (cfg?.connections || []).filter(c => (kind === 'ldap' || c.enabled) && (!filter || filter(c)))
  const [src, setSrc] = useKept(base + 'src', '')
  const [imp, setImp] = useState(null)
  const [pasted, setPasted] = useKept(base + 'pasted', '')
  const cur = list.find(c => c.name === sel) || list[0]
  const eff = cur?.name || ''
  const act = body => post(`${base}/action`, { name: eff, ...body })
  function doImport() {
    setImp({ busy: true }); post(`${base}/import`, { path: src, text: pasted }).then(r => { setImp(r.ok ? { ok: true, text: `Imported ${r.imported.join(', ')} from ${r.file}` } : { ok: false, text: r.error }); if (r.ok) load() })
  }
  function test() { setBusy(true); setRes(null); act({ action: 'test' }).then(setRes).finally(() => setBusy(false)) }
  if (!cfg) return <div style={{ fontSize: 12 }}>Loading...</div>
  const verdict = res && <div style={{ fontSize: 12, color: res.ok ? '#16a34a' : '#dc2626', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{res.ok ? res.message : res.error}</div>
  const picker = (
    <select style={{ ...inp, width: kind === 'ldap' ? '100%' : 'auto' }} value={eff} onChange={e => { setSel(e.target.value); setRes(null) }}>
      {list.length === 0 && <option value="">No enabled connection</option>}
      {list.map(c => <option key={c.name} value={c.name}>{c.name} ({c.provider} {c.host}:{c.port}){c.enabled ? '' : ' - disabled'}</option>)}
    </select>
  )
  const body = (
    <>
      {cfgOpen && <ConfigTable base={base} kind={kind} cfg={cfg} reload={load} />}
      {eff && kind === 'cache' && (cur?.provider === 'he-blob' ? <HeBlobBrowse key={eff} act={act} /> : <CacheBrowse key={eff} act={act} />)}
      {eff && kind === 'ldap' && <LdapPane key={eff} act={act} defBase={cur?.scope} provider={cur?.provider} settings={Object.fromEntries((cur?.settings || '').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))} />}
      {eff && kind === 'vault' && <VaultBrowse key={eff} act={act} />}
    </>
  )
  if (kind === 'ldap') {
    return (
      <div>
        <div className="card" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', marginBottom: 10 }}>
          {side}
          <div style={{ flex: '1 1 260px', minWidth: 200 }}>{picker}</div>
          <button style={btn} onClick={test} disabled={busy || !eff}>{busy ? 'Testing...' : 'Test connection'}</button>
          {importer && <button style={btn} onClick={doImport} disabled={imp?.busy}>{imp?.busy ? 'Importing...' : 'Import configuration from server'}</button>}
          {importer && <input style={{ ...inp, flex: '1 1 220px', minWidth: 180 }} value={src} onChange={e => setSrc(e.target.value)} placeholder="Properties file in the container (blank = auto-find)" />}
          <button onClick={() => setCfgOpen(v => !v)} title="Configure" aria-label="Configure" style={{ marginLeft: 'auto', background: cfgOpen ? 'var(--surface2)' : 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-muted)', padding: '3px 6px', display: 'inline-flex', alignItems: 'center' }}><GearIcon /></button>
        </div>
        {verdict && <div style={{ marginBottom: 8 }}>{verdict}</div>}
        {imp && !imp.busy && <div style={{ fontSize: 12, marginBottom: 8, color: imp.ok ? '#16a34a' : '#dc2626', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{imp.text}</div>}
        {importer && <details style={{ marginBottom: 10 }}>
          <summary style={{ fontSize: 12, cursor: 'pointer' }}>Or paste the authentication properties and import them</summary>
          <textarea style={{ ...inp, height: 120, marginTop: 4 }} value={pasted} onChange={e => setPasted(e.target.value)} placeholder="[authprovider-AD]Host=..." />
        </details>}
        {list.length === 0 && <div className="card" style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>
          No {title} connection is configured yet. Use <b>Import configuration from server</b> (or paste the properties above), or add one under <b>Configure</b>.</div>}
        {body}
      </div>
    )
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        {picker}
        <button style={btn} onClick={test} disabled={busy || !eff}>{busy ? 'Testing...' : 'Test connection'}</button>
        {res && <span style={{ fontSize: 12, color: res.ok ? '#16a34a' : '#dc2626' }}>{res.ok ? res.message : res.error}</span>}
        <button onClick={() => setCfgOpen(v => !v)} title="Configure" aria-label="Configure" style={{ marginLeft: 'auto', background: cfgOpen ? 'var(--surface2)' : 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-muted)', padding: '3px 6px', display: 'inline-flex', alignItems: 'center' }}><GearIcon /></button>
      </div>
      {body}
    </div>
  )
}

export const CacheTab = ({ appName }) => <ServiceTab appName={appName} kind="cache" title="Cache" />
export function LdapTab({ appName }) {
  const [grp, setGrp] = useKept('ldapgrp', 'ad')
  const items = [{ key: 'ad', label: 'AD', f: c => c.provider === 'activedirectory' }, { key: 'ol', label: 'OLDAP', f: c => c.provider !== 'activedirectory' }]
  const cur = items.find(x => x.key === grp) || items[0]
  const pills = (
    <div style={{ display: 'flex', gap: 6 }}>
      {items.map(t => (
        <button key={t.key} onClick={() => setGrp(t.key)}
          style={{ padding: '4px 14px', fontSize: 12, borderRadius: 14, cursor: 'pointer', border: '1px solid var(--border)',
            background: grp === t.key ? 'var(--primary, #2563eb)' : 'transparent', color: grp === t.key ? '#fff' : 'inherit' }}>{t.label}</button>))}
    </div>
  )
  return <ServiceTab key={cur.key} appName={appName} kind="ldap" title={cur.key === 'ad' ? 'Active Directory' : 'OpenLDAP'} filter={cur.f} importer side={pills} />
}
export const VaultTab = ({ appName }) => <ServiceTab appName={appName} kind="vault" title="Secrets / Vault" />
