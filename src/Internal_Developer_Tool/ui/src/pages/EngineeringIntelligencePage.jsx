import { useState, useEffect, useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const BASE = '/project-management/engineering-intelligence'
const API = '/api/project-management/ei'
const SLUG = { Epic: 'epic', Feature: 'feature', Story: 'story', Task: 'task', Bug: 'bug', Other: 'other' }
const STATUS_CLR = { 'Not Started': '#78909c', 'In Progress': '#1e88e5', Completed: '#43a047', Blocked: '#e53935', Skipped: '#8d6e63' }

const field = { boxSizing: 'border-box', padding: '6px 9px', fontSize: 13, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'inherit' }
const th = { textAlign: 'left', padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap' }
const td = { padding: '9px 12px', fontSize: 13, borderBottom: '1px solid var(--border)', verticalAlign: 'top' }

const api = async (url, method = 'GET', body) => {
  try {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    return await r.json()
  } catch { return { ok: false, error: 'Could not reach server' } }
}

let nav2 = () => {}
function Back({ to, label }) {
  const nav = useNavigate()
  return <button className="btn btn-sm" onClick={() => nav(to)} style={{ marginBottom: 12 }}>← {label}</button>
}
function Badge({ status }) {
  return <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', background: STATUS_CLR[status] || '#78909c', borderRadius: 10, padding: '2px 9px', whiteSpace: 'nowrap' }}>{status}</span>
}
function Progress({ done, total }) {
  const pct = total ? Math.round(done / total * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 150 }}>
      <div style={{ flex: 1, height: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5, overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: '#43a047' }} /></div>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{done}/{total}</span>
    </div>
  )
}

// ── landing: the tree ────────────────────────────────────────────────────────────────────────────
// one entry per workflow: the main workflow of every work item type, then the other built-in workflows of that type (e.g. Clone Bug Workflow under Bug)
function workflowEntries(cfg) {
  const out = []
  cfg.types.forEach(t => {
    const wf = id => (cfg.workflows.find(w => w.id === id) || {})
    out.push({ key: t.type, type: t, wf: wf(t.workflow), label: t.type === 'Other' ? 'Other' : wf(t.workflow).name || t.type, to: `${BASE}/work-items/${SLUG[t.type]}${t.type === 'Other' ? '' : `?wf=${t.workflow}`}` })
    if (t.type !== 'Other') cfg.workflows.filter(w => w.builtin && w.type === t.type && w.id !== t.workflow).forEach(w =>
      out.push({ key: w.id, type: t, wf: w, label: w.name, to: `${BASE}/work-items/${SLUG[t.type]}?wf=${w.id}`, extra: true }))
  })
  return out
}

function Landing({ cfg }) {
  const nav = useNavigate()
  const link = { background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: 14, padding: 0, textAlign: 'left' }
  const wfOf = id => (cfg.workflows.find(w => w.id === id) || {}).name
  const entries = workflowEntries(cfg)
  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <div style={{ fontFamily: 'monospace', fontSize: 14, lineHeight: 2 }}>
        <div>Project Management</div>
        <div style={{ paddingLeft: 18 }}>└─ <b>Engineering Intelligence</b></div>
        <div style={{ paddingLeft: 52 }}>└─ <button style={{ ...link, fontWeight: 700 }} onClick={() => nav(`${BASE}/work-items`)}>Work Item Intelligence</button></div>
        {entries.map((e, i) => (
          <div key={e.key} style={{ paddingLeft: 88 }}>{i === entries.length - 1 ? '└─' : '├─'} <button style={link} onClick={() => nav(e.to)}>{e.label}</button></div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.7 }}>
        Definitions: <code>{cfg.config_dir}</code><br />Work item state: <code>{cfg.data_dir}</code>
      </div>
    </div>
  )
}

const SPRINT_API = '/api/project-management/sprint'
const APP_SLUG = { PAYOR: 'payor', CLASSIC: 'classic', CONNECTOR: 'connector', ENROLLMENT: 'enrollment', PIK: 'pik' }
const small = { fontSize: 11, padding: '2px 9px' }

// Jira issue type -> work item type (project_config.xlsx, tab router): decides where a Sprint project lands
function RouterEditor() {
  const [d, setD] = useState(null)
  const [rows, setRows] = useState([])
  const [msg, setMsg] = useState('')
  const [open, setOpen] = useState(false)
  useEffect(() => { if (open && !d) api(`${API}/router`).then(r => { if (r.ok) { setD(r); setRows(r.rows) } else setMsg(r.error) }) }, [open])
  const set = (i, k, v) => setRows(rs => rs.map((r, j) => j === i ? { ...r, [k]: v } : r))
  const save = async () => {
    const r = await api(`${API}/router`, 'POST', { rows })
    if (r.ok) { setD(r); setRows(r.rows); setMsg('Saved') } else setMsg(r.error)
    setTimeout(() => setMsg(''), 3000)
  }
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <b style={{ fontSize: 14 }}>{open ? '▾' : '▸'} Project router</b>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Which work item type / workflow a project created in Sprint &gt; My Stories belongs to, by Jira issue type</span>
      </div>
      {open && !d && !msg && <span className="spinner" />}
      {open && d && (
        <div style={{ marginTop: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Jira issue type (* = anything else)', 'Work item type', 'Workflow', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i}>
                <td style={td}><input value={r['Jira Issue Type']} onChange={e => set(i, 'Jira Issue Type', e.target.value)} style={{ ...field, width: '100%' }} /></td>
                <td style={td}><select value={r['Work Item Type']} onChange={e => set(i, 'Work Item Type', e.target.value)} style={field}>{d.types.map(t => <option key={t}>{t}</option>)}</select></td>
                <td style={td}><select value={r['Workflow ID']} onChange={e => set(i, 'Workflow ID', e.target.value)} style={field}>
                  <option value="">(default of the type)</option>{d.workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></td>
                <td style={td}><button className="btn btn-sm btn-danger" style={small} onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} disabled={r['Jira Issue Type'] === '*'}>✕</button></td></tr>))}</tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
            <button className="btn btn-sm" onClick={() => setRows(rs => [...rs, { 'Jira Issue Type': '', 'Work Item Type': 'Task', 'Workflow ID': '' }])}>＋ Add issue type</button>
            <button className="btn btn-sm btn-primary" onClick={save}>Save</button>
            {msg && <span style={{ fontSize: 12, color: msg === 'Saved' ? '#2e7d32' : '#c62828' }}>{msg}</span>}
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{d.file}</span>
          </div>
        </div>)}
    </div>
  )
}

// Repo branch rules (repo_branch_rule.xlsx, tab rule): application and branch name pattern per Jira prefix / ticket type
function RulesEditor({ onSaved }) {
  const [d, setD] = useState(null)
  const [rows, setRows] = useState([])
  const [msg, setMsg] = useState('')
  useEffect(() => { api(`${API}/branch-rules`).then(r => { if (r.ok) { setD(r); setRows(r.rows) } else setMsg(r.error) }) }, [])
  const set = (i, k, v) => setRows(rs => rs.map((r, j) => j === i ? { ...r, [k]: v } : r))
  const save = async () => {
    const r = await api(`${API}/branch-rules`, 'POST', { rows })
    if (r.ok) { setD(r); setRows(r.rows); setMsg('Saved'); onSaved && onSaved() } else setMsg(r.error)
    setTimeout(() => setMsg(''), 3000)
  }
  if (!d) return msg ? <div className="alert alert-error">{msg}</div> : <span className="spinner" />
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Repo branch rules <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>— branch = Prefix + JIRA ID + Midfix + story title (snake_case) + Postfix</span></div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr>{[...d.cols, ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>{d.cols.map(c => <td key={c} style={{ ...td, padding: '4px 4px' }}>
              {c === 'Default' ? <select value={r[c]} onChange={e => set(i, c, e.target.value)} style={field}><option value=""></option><option>Yes</option></select>
                : <input value={r[c] || ''} onChange={e => set(i, c, e.target.value)} style={{ ...field, width: c === 'Application' || c === 'Ticket Type' ? 110 : 90 }} />}</td>)}
              <td style={{ ...td, padding: '4px 4px' }}><button className="btn btn-sm btn-danger" style={small} onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>✕</button></td></tr>))}</tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
        <button className="btn btn-sm" onClick={() => setRows(rs => [...rs, Object.fromEntries(d.cols.map(c => [c, '']))])}>＋ Add rule</button>
        <button className="btn btn-sm btn-primary" onClick={save}>Save rules</button>
        {msg && <span style={{ fontSize: 12, color: msg === 'Saved' ? '#2e7d32' : '#c62828' }}>{msg}</span>}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{d.file}</span>
      </div>
    </div>
  )
}

// Development stage: repo branch rule, the project's branches (checkout / delete) and creating a new branch
function BranchPanel({ d, itemKey, reload }) {
  const proj = d.project
  const [pv, setPv] = useState(null)
  const [newBranch, setNewBranch] = useState('')
  const [busy, setBusy] = useState('')
  const [steps, setSteps] = useState(null)         // result of a checkout / branch setup
  const [stale, setStale] = useState(null)         // { branch, files } waiting for "revert & proceed"
  const [err, setErr] = useState('')
  const [rules, setRules] = useState(false)
  const loadPv = useCallback(() => {
    if (!proj) return
    api(`${SPRINT_API}/project-preview`, 'POST', { jira_id: itemKey, story: proj.story, issue_type: proj.issue_type }).then(r => {
      setPv(r); if (r.ok) setNewBranch(r.next_branch_suggestion || r.branch_name || '')
    })
  }, [itemKey, proj?.story, proj?.issue_type])
  useEffect(() => { loadPv() }, [loadPv])
  if (!proj) return <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>No project information for this work item yet.</div>
  const app = (pv?.ok && pv.rule?.application) || proj.application
  const setup = async (branch, confirm_revert = false) => {
    setBusy('setup:' + branch); setErr(''); setSteps(null); setStale(null)
    const r = await api(`${SPRINT_API}/project-setup-branch`, 'POST', { application: app, branch_name: branch, confirm_revert })
    setBusy('')
    if (r.stale_files) { setStale({ branch, files: r.changed_files }); setSteps(r.steps || []); return }
    setSteps(r.steps || []); if (!r.ok) setErr(r.error || 'Failed')
    return r
  }
  const create = async () => {
    const name = newBranch.trim()
    if (!name) return
    setBusy('create'); setErr('')
    const r = await api(`${SPRINT_API}/project-add-branch`, 'POST', { jira_id: itemKey, branch_name: name, team: proj.team })
    if (!r.ok) { setBusy(''); setErr(r.error); return }
    await reload()
    setBusy('')
    await setup(name)
  }
  const del = async (label, name) => {
    if (!window.confirm(`Delete local branch ${name}?`)) return
    setBusy('del:' + name)
    const r = await api(`${SPRINT_API}/project-delete-branch`, 'POST', { jira_id: itemKey, branch_name: name, branch_label: label, application: app, team: proj.team })
    setBusy(''); if (!r.ok) setErr(r.error); else reload()
  }
  const ap = APP_SLUG[(app || '').toUpperCase()]
  const rule = pv?.ok ? pv.rule : null
  return (
    <div style={{ border: '1px solid var(--border)', borderLeft: '4px solid #6a1b9a', borderRadius: 8, padding: '10px 14px', margin: '12px 0', background: 'var(--surface)' }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>🌿 Repository &amp; branches <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)' }}>— where the development of this work item happens</span></div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, marginBottom: 8 }}>
        <span>Application {ap ? <button className="btn btn-sm" style={{ ...small, color: '#1565c0' }} onClick={() => nav2(`/local-app/${ap}`)}>{app} ↗</button> : <b>{app || '—'}</b>}</span>
        {rule && <span style={{ color: 'var(--text-muted)' }}>Rule: <code>{rule.branch_prefix}{itemKey}{rule.branch_midfix}…{rule.branch_postfix}</code> {pv.is_default && <i>(default rule - issue type not matched)</i>}</span>}
        {pv && !pv.ok && <span style={{ color: '#c62828' }}>{pv.error}</span>}
        <button className="btn btn-sm" style={{ ...small, marginLeft: 'auto' }} onClick={() => setRules(r => !r)}>{rules ? 'Hide' : '⚙ Edit'} branch rules</button>
      </div>
      {rules && <RulesEditor onSaved={loadPv} />}

      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', margin: '10px 0 4px' }}>Existing branches</div>
      {proj.branches.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No branch yet.</div> : proj.branches.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, padding: '2px 0', flexWrap: 'wrap' }}>
          <span style={{ width: 64, color: 'var(--text-muted)' }}>{k}</span>
          <button onClick={() => setup(v)} disabled={!!busy} title="Check this branch out in the local application" style={{ background: 'none', border: 'none', color: 'var(--primary)', textDecoration: 'underline dotted', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12, padding: 0 }}>{v}</button>
          <button onClick={() => del(k, v)} disabled={!!busy} title="Delete the local branch" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}>🗑</button>
        </div>))}

      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', margin: '10px 0 4px' }}>New branch</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={newBranch} onChange={e => setNewBranch(e.target.value)} style={{ ...field, flex: '1 1 380px', maxWidth: 620, fontFamily: 'monospace' }} placeholder={pv?.ok ? '' : 'branch name'} />
        <button className="btn btn-sm btn-primary" disabled={!!busy || !newBranch.trim()} onClick={create}>{busy === 'create' ? 'Creating…' : 'Create branch & check out'}</button>
      </div>
      {busy.startsWith('setup') && <div style={{ fontSize: 12, marginTop: 8 }}><span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> Setting up the branch…</div>}
      {err && <div className="alert alert-error" style={{ marginTop: 8, fontSize: 12 }}>{err}</div>}
      {stale && (
        <div style={{ marginTop: 8, fontSize: 12, border: '1px solid #ffcc80', background: 'rgba(230,81,0,0.07)', borderRadius: 6, padding: 8 }}>
          <b style={{ color: '#e65100' }}>⚠ Uncommitted changes in the repository:</b>
          <div style={{ fontFamily: 'monospace', fontSize: 11, maxHeight: 100, overflow: 'auto', margin: '4px 0' }}>{stale.files.map((f, i) => <div key={i}>{f}</div>)}</div>
          <button className="btn btn-sm btn-primary" onClick={() => setup(stale.branch, true)}>Revert &amp; proceed</button>{' '}<button className="btn btn-sm" onClick={() => setStale(null)}>Abort</button>
        </div>)}
      {steps && steps.length > 0 && !stale && (
        <div style={{ marginTop: 8 }}>{steps.map((st, i) => (
          <div key={i} style={{ fontSize: 12, display: 'flex', gap: 6 }}>
            <span style={{ color: st.status === 'ok' ? '#2e7d32' : st.status === 'warning' ? '#e65100' : '#c62828' }}>{st.status === 'ok' ? '✓' : st.status === 'warning' ? '⚠' : '✗'}</span>
            <b>{st.label}</b><span style={{ color: 'var(--text-muted)' }}>{st.detail ? `— ${st.detail}` : ''}</span></div>))}</div>)}
    </div>
  )
}

// Implement Clone stage: a ticket that already has a Clone Workflow project is associated with it (its status feeds the stage);
// only a ticket without one starts a new clone workflow, with the ticket and release version filled in
function ClonePanel({ d, itemKey, typ, reload }) {
  const proj = d.project
  const [pv, setPv] = useState(null)
  const [cps, setCps] = useState(null)            // Clone Workflow projects of this ticket
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api(`${API}/item/${typ}/${itemKey}/clone-projects`).then(r => { setCps(r.ok ? r.projects : []); if (r.ok && r.projects.length) reload() })
    if (proj) api(`${SPRINT_API}/project-preview`, 'POST', { jira_id: itemKey, story: proj.story, issue_type: proj.issue_type }).then(setPv)
  }, [itemKey, typ, proj?.story, proj?.issue_type])
  const fv = (pv?.ok && pv.fix_versions || [])[0] || ''
  const app = ((pv?.ok && pv.rule?.application) || proj?.application || 'Payor').toLowerCase()
  const startNew = async () => {
    setBusy(true)
    let payorVersion = ''
    if (fv && app) {
      const r = await api('/api/project-management/sprint/resolve-release-branch', 'POST', { app, fix_version: fv })
      if (r.ok && r.release_branch) payorVersion = r.release_branch.replace(/^release-/i, '')
    }
    setBusy(false)
    nav2('/clone-projects/new', { state: { ticket: itemKey, payorVersion } })
  }
  const has = cps && cps.length > 0
  const clr = s => (String(s).toLowerCase() === 'completed' ? '#43a047' : /fail|abort|error/i.test(s) ? '#e53935' : '#1e88e5')
  return (
    <div style={{ border: '1px solid var(--border)', borderLeft: '4px solid #e65100', borderRadius: 8, padding: '10px 14px', margin: '12px 0', background: 'var(--surface)' }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>🧬 Clone Workflow <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)' }}>— brings the fix of {itemKey} to its target release</span></div>
      {!cps ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> : has ? (
        <>
          <div style={{ fontSize: 12, marginBottom: 6 }}>✓ This ticket already has {cps.length === 1 ? 'a Clone Workflow project' : `${cps.length} Clone Workflow projects`} - the stage is associated with {cps.length === 1 ? 'it' : 'the newest one'}; no new clone workflow is needed.</div>
          {cps.map((p, i) => (
            <div key={p.pid} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, padding: '5px 0', borderTop: i ? '1px dashed var(--border)' : 'none' }}>
              <b>Project #{p.pid}</b>
              <span style={{ color: '#fff', background: clr(p.status), borderRadius: 10, padding: '1px 9px', fontSize: 11, fontWeight: 600 }}>{p.status}</span>
              <span>{p.completed_stages}/{p.total_stages} stages</span>
              <span>Release <b>{p.payor_version || p.release_branch || '—'}</b></span>
              {p.clone_branch && <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{p.clone_branch}</span>}
              {p.clone_pr_url && <a href={p.clone_pr_url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>PR ↗</a>}
              <button className="btn btn-sm btn-primary" style={{ marginLeft: 'auto', background: '#e65100', borderColor: '#e65100' }} onClick={() => nav2(`/projects/${p.pid}`)}>Open Clone Workflow project #{p.pid} ↗</button>
            </div>))}
          <div style={{ marginTop: 6 }}><button className="btn btn-sm" style={small} disabled={busy} onClick={() => { if (window.confirm(`${itemKey} already has a Clone Workflow project. Start another one anyway?`)) startNew() }}>Start another clone workflow…</button></div>
        </>
      ) : (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, alignItems: 'center' }}>
          <span>Ticket <b>{itemKey}</b></span>
          <span>Fix version {pv ? <b>{fv || '—'}</b> : <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />}</span>
          <span>Application <b>{proj?.application || app}</b></span>
          <span style={{ color: 'var(--text-muted)' }}>No Clone Workflow project exists for this ticket yet.</span>
          <button className="btn btn-sm btn-primary" style={{ marginLeft: 'auto', background: '#e65100', borderColor: '#e65100' }} disabled={busy || !pv} onClick={startNew}>{busy ? 'Opening…' : 'Start Clone Workflow ↗'}</button>
        </div>)}
      {pv && !pv.ok && <div style={{ fontSize: 12, color: '#c62828', marginTop: 6 }}>{pv.error}</div>}
    </div>
  )
}

// ── Work Item Intelligence table ─────────────────────────────────────────────────────────────────
function WorkItemTable({ cfg }) {
  const nav = useNavigate()
  const wfOf = id => (cfg.workflows.find(w => w.id === id) || {}).name
  return (
    <>
      <Back to={BASE} label="Engineering Intelligence" />
      <div className="card" style={{ overflowX: 'auto' }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>Work Item Intelligence</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Work Item Type', 'Primary Focus', 'Workflow', 'Owner', 'Contributors'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {workflowEntries(cfg).map(e => (
              <tr key={e.key}>
                <td style={{ ...td, fontWeight: 600, color: e.extra ? 'var(--text-muted)' : undefined }}>{e.extra ? `${e.type.type} (${e.wf.name.replace(/ Workflow$/, '')})` : e.type.type}</td>
                <td style={td}>{e.extra ? 'Port an existing fix to another release' : e.type.focus}</td>
                <td style={td}>
                  <button onClick={() => nav(e.to)} style={{ background: 'none', border: 'none', color: 'var(--primary)', textDecoration: 'underline', cursor: 'pointer', fontSize: 13, padding: 0 }}>
                    {e.type.type === 'Other' ? 'Custom' : e.wf.name}
                  </button>
                </td>
                <td style={td}>{e.type.owner}</td>
                <td style={td}>{e.type.contributors}</td>
              </tr>))}
          </tbody>
        </table>
      </div>
      <RouterEditor />
    </>
  )
}

// ── custom workflow designer (Other): stages are independent building blocks ──────────────────────
function Designer({ cfg, reload, edit, onDone }) {
  const [name, setName] = useState(edit?.name || '')
  const [ids, setIds] = useState(edit?.stages || [])
  const [q, setQ] = useState('')
  const [nn, setNn] = useState('')
  const [nd, setNd] = useState('')
  const [err, setErr] = useState('')
  const byId = useMemo(() => Object.fromEntries(cfg.stages.map(s => [s.id, s])), [cfg])
  const move = (i, d) => setIds(a => { const b = [...a], j = i + d; if (j < 0 || j >= b.length) return a; [b[i], b[j]] = [b[j], b[i]]; return b })
  const addStage = async () => {
    const d = await api(`${API}/stage`, 'POST', { name: nn, description: nd })
    if (!d.ok) { setErr(d.error); return }
    setNn(''); setNd(''); setErr(''); setIds(a => [...a, d.stage.id]); reload()
  }
  const save = async () => {
    const d = await api(`${API}/workflow`, 'POST', { id: edit?.id, name, stages: ids })
    if (!d.ok) { setErr(d.error); return }
    setErr(''); await reload(); onDone(d.id)
  }
  const cat = cfg.stages.filter(s => !q || s.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>{edit ? `Edit workflow - ${edit.name}` : 'Custom workflow designer'}</div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: 260 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Stage catalog <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(click to add; reusable in any workflow)</span></div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter stages…" style={{ ...field, width: '100%', marginBottom: 6 }} />
          <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
            {cat.map(s => (
              <div key={s.id} onClick={() => setIds(a => [...a, s.id])} title={s.description} style={{ padding: '5px 10px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                <span style={{ flex: 1 }}>{s.name}</span><span style={{ color: 'var(--primary)' }}>＋</span>
              </div>))}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input value={nn} onChange={e => setNn(e.target.value)} placeholder="New stage name" style={{ ...field, flex: '1 1 140px' }} />
            <input value={nd} onChange={e => setNd(e.target.value)} placeholder="What it covers (optional)" style={{ ...field, flex: '2 1 180px' }} />
            <button className="btn btn-sm" disabled={!nn.trim()} onClick={addStage}>+ Create stage</button>
          </div>
        </div>
        <div style={{ flex: '1 1 320px', minWidth: 260 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Workflow name</div>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Production Support Analysis" style={{ ...field, width: '100%', marginBottom: 8 }} />
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Stages in order ({ids.length})</div>
          <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
            {ids.length === 0 && <div style={{ padding: 14, fontSize: 12, color: 'var(--text-muted)' }}>Add stages from the catalog.</div>}
            {ids.map((id, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px 10px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                <span style={{ width: 20, color: 'var(--text-muted)' }}>{i + 1}</span><span style={{ flex: 1 }}>{byId[id]?.name || id}</span>
                <button className="btn btn-sm" style={{ padding: '0 6px' }} onClick={() => move(i, -1)} disabled={i === 0}>▲</button>
                <button className="btn btn-sm" style={{ padding: '0 6px' }} onClick={() => move(i, 1)} disabled={i === ids.length - 1}>▼</button>
                <button className="btn btn-sm btn-danger" style={{ padding: '0 6px' }} onClick={() => setIds(a => a.filter((_, j) => j !== i))}>✕</button>
              </div>))}
          </div>
        </div>
      </div>
      {err && <div className="alert alert-error" style={{ marginTop: 8, fontSize: 12 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn btn-sm btn-primary" disabled={!name.trim() || !ids.length} onClick={save}>Save workflow</button>
        <button className="btn btn-sm" onClick={() => onDone(null)}>Cancel</button>
      </div>
    </div>
  )
}

// ── workflow home: its stages, the work items created from it ─────────────────────────────────────
function WorkflowHome({ cfg, reload, typeSlug }) {
  const nav = useNavigate()
  const t = cfg.types.find(x => SLUG[x.type] === typeSlug)
  const [items, setItems] = useState(null)
  const [key, setKey] = useState('')
  const [title, setTitle] = useState('')
  const [wid, setWid] = useState('')
  const [err, setErr] = useState('')
  const [designer, setDesigner] = useState(null)       // null | {} (new) | workflow (edit)
  const isOther = t?.type === 'Other'
  const only = new URLSearchParams(useLocation().search).get('wf')           // ?wf=<workflow id>: that workflow of the type only
  const typeWfs = isOther ? cfg.workflows.filter(w => !w.builtin) : cfg.workflows.filter(w => w.builtin && w.type === t?.type)
  const wfs = only && typeWfs.some(w => w.id === only) ? typeWfs.filter(w => w.id === only) : typeWfs
  const loadItems = useCallback(() => { if (t) api(`${API}/items?type=${t.type}`).then(d => setItems(d.ok ? d.items.filter(i => !only || i.workflow_id === only || !typeWfs.some(w => w.id === only)) : [])) }, [t?.type, only])
  useEffect(() => { loadItems() }, [loadItems])
  useEffect(() => { if (wfs.length && !wfs.some(w => w.id === wid)) setWid(wfs[0].id) }, [wfs.map(w => w.id).join()])
  if (!t) return <div className="alert alert-error">Unknown work item type.</div>
  const names = Object.fromEntries(cfg.stages.map(s => [s.id, s.name]))
  const create = async () => {
    const d = await api(`${API}/item`, 'POST', { type: t.type, key, title, workflow_id: wid || wfs[0]?.id })
    if (!d.ok) { setErr(d.error); return }
    nav(`${BASE}/work-items/${typeSlug}/${d.item.key}`)
  }
  const del = async k => { if (window.confirm(`Delete ${k} and its saved workflow state?`)) { await api(`${API}/item/${t.type}/${k}`, 'DELETE'); loadItems() } }
  return (
    <>
      <Back to={`${BASE}/work-items`} label="Work Item Intelligence" />
      <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>{isOther ? 'Other - custom workflows' : wfs.length === 1 ? wfs[0].name : `${t.type} workflows`}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>{t.type} · {t.focus || 'Custom'}{t.owner ? ` · Owner: ${t.owner}` : ''}</div>

      {wfs.map(w => (
        <div key={w.id} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <b style={{ fontSize: 14 }}>{w.name}</b>
            {isOther && <><button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setDesigner(w)}>✎ Edit</button>
              <button className="btn btn-sm btn-danger" onClick={async () => { if (window.confirm(`Delete workflow "${w.name}"? Existing work items keep their saved state.`)) { await api(`${API}/workflow/${w.id}`, 'DELETE'); reload() } }}>🗑</button></>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', fontSize: 12 }}>
            {w.stages.map((s, i) => <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>{i + 1}. {names[s] || s}</span>{i < w.stages.length - 1 && <span style={{ color: 'var(--text-muted)' }}>→</span>}</span>)}
          </div>
        </div>))}

      {isOther && !designer && <button className="btn btn-sm btn-primary" style={{ marginBottom: 12 }} onClick={() => setDesigner({})}>＋ Design a custom workflow</button>}
      {isOther && designer && <Designer cfg={cfg} reload={reload} edit={designer.id ? designer : null} onDone={id => { setDesigner(null); if (id) setWid(id) }} />}

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>New {t.type === 'Other' ? 'work item' : t.type}</div>
        {wfs.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Design a custom workflow first - a work item is created from a workflow.</div> : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={key} onChange={e => setKey(e.target.value)} placeholder={isOther ? 'PAYSUST-210790' : 'PAYOR-211607'} style={{ ...field, width: 170, textTransform: 'uppercase' }} />
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title (optional)" style={{ ...field, flex: '1 1 240px' }} />
            {wfs.length > 1 && <select value={wid} onChange={e => setWid(e.target.value)} style={field}>{wfs.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>}
            <button className="btn btn-sm btn-primary" disabled={!key.trim()} onClick={create}>Create &amp; open</button>
          </div>)}
        {err && <div className="alert alert-error" style={{ marginTop: 8, fontSize: 12 }}>{err}</div>}
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{t.type} work items {items ? `(${items.length})` : ''}</div>
        {items === null ? <span className="spinner" /> : items.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>None yet.</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Key', 'Title', ...(wfs.length > 1 || isOther ? ['Workflow'] : []), 'Progress', 'Created', ''].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
            <tbody>{items.map(it => (
              <tr key={it.key}>
                <td style={td}><button onClick={() => nav(`${BASE}/work-items/${typeSlug}/${it.key}`)} style={{ background: 'none', border: 'none', color: 'var(--primary)', textDecoration: 'underline', cursor: 'pointer', fontWeight: 600, padding: 0 }}>{it.key}</button></td>
                <td style={td}>{it.title}</td>
                {(wfs.length > 1 || isOther) && <td style={td}>{it.workflow}</td>}
                <td style={td}><Progress done={it.done} total={it.total} /></td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{it.created}</td>
                <td style={td}><button className="btn btn-sm btn-danger" onClick={() => del(it.key)}>🗑</button></td>
              </tr>))}</tbody>
          </table>)}
      </div>
    </>
  )
}

// ── one work item: Workflow View | Stage View | Saved State | Notes | Generated Artifacts ─────────────
function ItemWorkflow({ cfg, typeSlug, itemKey }) {
  const t = cfg.types.find(x => SLUG[x.type] === typeSlug)
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState('workflow')
  const [sel, setSel] = useState(0)
  const [draft, setDraft] = useState(null)         // stage being edited
  const [notes, setNotes] = useState('')
  const [msg, setMsg] = useState('')
  const [art, setArt] = useState({ name: '', content: '' })
  const [view, setView] = useState(null)

  const apply = r => { if (r.ok) { setD(r); setErr('') } else setErr(r.error || 'Failed') ; return r.ok }
  useEffect(() => { api(`${API}/item/${t.type}/${itemKey}`).then(r => { if (apply(r)) setNotes(r.notes) }) }, [t.type, itemKey])
  const stage = d?.stages[sel]
  useEffect(() => { if (stage) setDraft({ status: stage.status, checks: stage.checks || {}, notes: stage.notes, output: stage.output }) }, [d, sel])
  if (err && !d) return <><Back to={`${BASE}/work-items/${typeSlug}`} label={`${t.type} workflow`} /><div className="alert alert-error">{err}</div></>
  if (!d) return <span className="spinner" />

  const done = d.stages.filter(s => s.status === 'Completed' || s.status === 'Skipped').length
  const flash = m => { setMsg(m); setTimeout(() => setMsg(''), 2500) }
  const saveStage = async (next) => {
    const r = await api(`${API}/item/${t.type}/${itemKey}/stage/${stage.id}`, 'PUT', draft)
    if (apply(r)) { flash('Saved'); if (next && sel < d.stages.length - 1) setSel(sel + 1) }
  }
  const tabBtn = (k, l) => <button key={k} onClick={() => setTab(k)} style={{ padding: '7px 16px', fontSize: 13, cursor: 'pointer', background: 'none', border: 'none', fontWeight: tab === k ? 700 : 500,
    color: tab === k ? 'var(--primary)' : 'var(--text-muted)', borderBottom: tab === k ? '2px solid var(--primary)' : '2px solid transparent' }}>{l}</button>

  return (
    <>
      <Back to={`${BASE}/work-items/${typeSlug}`} label={`${t.type === 'Other' ? 'Other' : d.workflow.name} - work items`} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 20 }}>{d.meta.Key}</span>
        <span style={{ fontSize: 14 }}>{d.meta.Title}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d.workflow.name} · {t.type}</span>
        <span style={{ marginLeft: 'auto' }}><Progress done={done} total={d.stages.length} /></span>
      </div>
      {d.project && (
        <div className="card" style={{ padding: '8px 14px', marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12, alignItems: 'center' }}>
            {d.project.fields.filter(([k, v]) => v && k !== 'JIRA ID' && k !== 'Story').map(([k, v]) => (
              <div key={k}><span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{k}&nbsp;</span>
                {k === 'Application' && APP_SLUG[v.toUpperCase()] ? <button className="btn btn-sm" style={{ ...small, color: '#1565c0' }} onClick={() => nav2(`/local-app/${APP_SLUG[v.toUpperCase()]}`)}>{v} ↗</button> : <b style={{ fontWeight: 500 }}>{v}</b>}</div>))}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {d.project.jira_url && <a className="btn btn-sm" href={d.project.jira_url} target="_blank" rel="noreferrer">Jira ↗</a>}
              <button className="btn btn-sm btn-primary" title="Open this story in Sprint > My Stories"
                onClick={() => nav2('/project-management/sprint', { state: { openSprint: d.project.sprint_file ? { file: d.project.sprint_file, name: d.project.sprint_file.replace(/\.xlsx$/i, ''), _openTab: 'My Stories', _highlightJira: itemKey } : null } })}>Sprint › My Stories ↗</button>
            </span>
          </div>
          {d.project.story && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{d.project.story}</div>}
        </div>)}
      {msg && <div style={{ fontSize: 12, color: '#2e7d32', marginBottom: 6 }}>✓ {msg}</div>}
      {err && <div className="alert alert-error" style={{ fontSize: 12, marginBottom: 6 }}>{err}</div>}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 14, flexWrap: 'wrap' }}>
        {tabBtn('workflow', 'Workflow View')}{tabBtn('stage', 'Stage View')}{tabBtn('state', 'Saved State')}{tabBtn('notes', 'Notes')}{tabBtn('artifacts', `Generated Artifacts (${d.artifacts.length})`)}
      </div>

      {tab === 'workflow' && (
        <div style={{ maxWidth: 560 }}>
          {d.stages.map((s, i) => (
            <div key={s.id}>
              <div onClick={() => { setSel(i); setTab('stage') }} title="Open this stage" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', cursor: 'pointer', border: '1px solid var(--border)',
                borderLeft: `5px solid ${STATUS_CLR[s.status]}`, borderRadius: 8, background: 'var(--surface)' }}>
                <span style={{ width: 24, height: 24, borderRadius: '50%', background: STATUS_CLR[s.status], color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{s.status === 'Completed' ? '✓' : s.n}</span>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{s.name}</span>
                {s.checklist.length > 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.checklist.filter(c => s.checks[c]).length}/{s.checklist.length}</span>}
                <Badge status={s.status} />
              </div>
              {i < d.stages.length - 1 && <div style={{ textAlign: 'center', color: 'var(--text-muted)', lineHeight: '18px' }}>↓</div>}
            </div>))}
        </div>)}

      {tab === 'stage' && stage && draft && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" disabled={sel === 0} onClick={() => setSel(sel - 1)}>◀ Previous</button>
            <select value={sel} onChange={e => setSel(Number(e.target.value))} style={{ ...field, minWidth: 260 }}>{d.stages.map((s, i) => <option key={s.id} value={i}>{s.n}. {s.name} — {s.status}</option>)}</select>
            <button className="btn btn-sm" disabled={sel === d.stages.length - 1} onClick={() => setSel(sel + 1)}>Next ▶</button>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>{stage.updated ? `Updated ${stage.updated}` : 'Not saved yet'}</span>
          </div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{stage.n}. {stage.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 10px' }}>{stage.description}</div>
          {stage.clone && <ClonePanel d={d} itemKey={itemKey} typ={t.type} reload={() => api(`${API}/item/${t.type}/${itemKey}`).then(apply)} />}
          {stage.branching && <BranchPanel d={d} itemKey={itemKey} reload={() => api(`${API}/item/${t.type}/${itemKey}`).then(apply)} />}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12 }}>Status{' '}
              <select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })} style={field}>{cfg.statuses.map(s => <option key={s}>{s}</option>)}</select></label>
            {stage.checklist.map(c => (
              <label key={c} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!draft.checks[c]} onChange={e => setDraft({ ...draft, checks: { ...draft.checks, [c]: e.target.checked } })} /> {c}</label>))}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3 }}>Findings / output</div>
          <textarea rows={9} value={draft.output} onChange={e => setDraft({ ...draft, output: e.target.value })} style={{ ...field, width: '100%', fontFamily: 'monospace' }} />
          <div style={{ fontSize: 12, fontWeight: 600, margin: '8px 0 3px' }}>Stage notes</div>
          <textarea rows={3} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} style={{ ...field, width: '100%' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-sm btn-primary" onClick={() => saveStage(false)}>Save</button>
            <button className="btn btn-sm" onClick={() => { setDraft({ ...draft, status: 'Completed' }); setTimeout(() => saveStage(true), 0) }}>Save as completed &amp; next ▶</button>
          </div>
        </div>)}

      {tab === 'state' && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Saved in <code>{d.folder}</code>: <code>workflow.xlsx</code> (stages, notes), <code>analysis.json</code>, <code>recommendations.json</code>, <code>artifacts\</code></div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['#', 'Stage', 'Status', 'Started', 'Completed', 'Updated'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{d.stages.map((s, i) => (
              <tr key={s.id} onClick={() => { setSel(i); setTab('stage') }} style={{ cursor: 'pointer' }}>
                <td style={td}>{s.n}</td><td style={td}>{s.name}</td><td style={td}><Badge status={s.status} /></td><td style={td}>{s.started}</td><td style={td}>{s.completed}</td><td style={td}>{s.updated}</td></tr>))}</tbody>
          </table>
        </div>)}

      {tab === 'notes' && (
        <div className="card">
          <textarea rows={12} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes for this work item…" style={{ ...field, width: '100%' }} />
          <div style={{ marginTop: 8 }}><button className="btn btn-sm btn-primary" onClick={async () => { if (apply(await api(`${API}/item/${t.type}/${itemKey}/notes`, 'PUT', { notes }))) flash('Notes saved') }}>Save notes</button></div>
          {d.recommendations.length > 0 && <>
            <div style={{ fontWeight: 600, fontSize: 13, margin: '14px 0 6px' }}>Recommendations (recommendations.json)</div>
            {d.recommendations.map(r => <div key={r.stage} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', marginBottom: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{r.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {r.updated}</span></div><div style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{r.text}</div></div>)}
          </>}
        </div>)}

      {tab === 'artifacts' && (
        <div className="card">
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-primary" onClick={async () => { if (apply(await api(`${API}/item/${t.type}/${itemKey}/artifact`, 'POST', { generate: true }))) flash('Summary report generated') }}>⚙ Generate summary report</button>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Compiles every stage, its output and the notes into a Markdown file in <code>artifacts\</code>.</span>
          </div>
          {d.artifacts.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>No artifacts yet.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 10 }}>
              <thead><tr>{['File', 'Size', 'Modified', ''].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
              <tbody>{d.artifacts.map(a => (
                <tr key={a.name}><td style={{ ...td, fontFamily: 'monospace' }}>{a.name}</td><td style={td}>{a.size} B</td><td style={td}>{a.modified}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm" onClick={async () => { const r = await api(`${API}/item/${t.type}/${itemKey}/artifact/${encodeURIComponent(a.name)}`); if (r.ok) setView(r) }}>View</button>{' '}
                    <button className="btn btn-sm btn-danger" onClick={async () => { if (window.confirm(`Delete ${a.name}?`)) apply(await api(`${API}/item/${t.type}/${itemKey}/artifact/${encodeURIComponent(a.name)}`, 'DELETE')) }}>🗑</button></td></tr>))}</tbody>
            </table>)}
          {view && <div style={{ marginBottom: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 3 }}>{view.name} <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => setView(null)}>Close</button></div>
            <pre style={{ margin: 0, padding: 10, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto', fontSize: 12 }}>{view.content}</pre></div>}
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>Add an artifact</div>
          <input value={art.name} onChange={e => setArt({ ...art, name: e.target.value })} placeholder="file name, e.g. rca.md" style={{ ...field, width: 260, marginBottom: 6 }} />
          <textarea rows={5} value={art.content} onChange={e => setArt({ ...art, content: e.target.value })} placeholder="Content" style={{ ...field, width: '100%', fontFamily: 'monospace' }} />
          <div style={{ marginTop: 6 }}><button className="btn btn-sm" disabled={!art.name.trim()} onClick={async () => { if (apply(await api(`${API}/item/${t.type}/${itemKey}/artifact`, 'POST', art))) { setArt({ name: '', content: '' }); flash('Artifact saved') } }}>Save artifact</button></div>
        </div>)}
    </>
  )
}

export default function EngineeringIntelligencePage() {
  const loc = useLocation()
  nav2 = useNavigate()
  const [cfg, setCfg] = useState(null)
  const [err, setErr] = useState('')
  const reload = useCallback(async () => { const d = await api(`${API}/config`); if (d.ok) setCfg(d); else setErr(d.error || 'Failed to load') }, [])
  useEffect(() => { reload() }, [reload])
  const parts = loc.pathname.slice(BASE.length).split('/').filter(Boolean)    // [] | ['work-items'] | ['work-items', type] | ['work-items', type, KEY]
  return (
    <div>
      <div className="page-header"><h1 className="page-title">Engineering Intelligence</h1></div>
      {err && <div className="alert alert-error">{err}</div>}
      {!cfg ? (!err && <span className="spinner" />) : parts.length === 0 ? <Landing cfg={cfg} />
        : parts[0] !== 'work-items' ? <Landing cfg={cfg} />
        : parts.length === 1 ? <WorkItemTable cfg={cfg} />
        : parts.length === 2 ? <WorkflowHome cfg={cfg} reload={reload} typeSlug={parts[1]} />
        : <ItemWorkflow key={parts[1] + parts[2]} cfg={cfg} typeSlug={parts[1]} itemKey={parts[2].toUpperCase()} />}
    </div>
  )
}
