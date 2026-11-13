import { useState, useEffect, useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const BASE = '/project-management/portfolio'
const API = '/api/project-management/portfolio'
const TABS = [['initiative-progress', 'Initiative Progress'], ['epic-progress', 'Epic Progress'], ['feature-progress', 'Feature Progress'],
  ['delivery-metrics', 'Delivery Metrics'], ['engineering-investment', 'Engineering Investment'], ['team-capacity', 'Team Capacity']]
const C = { done: '#43a047', prog: '#1e88e5', todo: '#90a4ae', warn: '#f9a825', bad: '#e53935' }
const PALETTE = ['#1e88e5', '#e53935', '#43a047', '#f9a825', '#8e24aa', '#00acc1', '#ff7043', '#6d4c41', '#546e7a']

const field = { boxSizing: 'border-box', padding: '5px 9px', fontSize: 13, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'inherit' }
const th = { textAlign: 'left', padding: '7px 10px', fontSize: 12, color: 'var(--text-muted)', borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap' }
const td = { padding: '7px 10px', fontSize: 13, borderBottom: '1px solid var(--border)', verticalAlign: 'middle' }

const get = async url => { try { return await (await fetch(url)).json() } catch { return { ok: false, error: 'Could not reach server' } } }
const post = async (url, body) => { try { return await (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json() } catch { return { ok: false, error: 'Could not reach server' } } }

// stacked bar: done / in progress / to do
function Stack({ done = 0, prog = 0, todo = 0, height = 10, width = 160 }) {
  const t = done + prog + todo || 1
  return (
    <div title={`${done} done · ${prog} in progress · ${todo} to do`} style={{ display: 'flex', width, height, borderRadius: 5, overflow: 'hidden', background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div style={{ width: `${100 * done / t}%`, background: C.done }} /><div style={{ width: `${100 * prog / t}%`, background: C.prog }} /><div style={{ width: `${100 * todo / t}%`, background: C.todo }} />
    </div>
  )
}
const Pct = ({ v }) => <b style={{ color: v >= 100 ? C.done : 'var(--text)' }}>{v == null ? '—' : `${v}%`}</b>
function Legend() {
  return <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'inline-flex', gap: 10 }}>
    <span style={{ color: C.done }}>■ done</span><span style={{ color: C.prog }}>■ in progress</span><span style={{ color: C.todo }}>■ to do</span></span>
}
function Bars({ rows, max, color = C.prog, unit = '' }) {          // simple horizontal bars [{label, value, sub}]
  const m = max || Math.max(...rows.map(r => r.value), 1)
  return (
    <div>{rows.map(r => (
      <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, fontSize: 12 }}>
        <span style={{ width: 150, textAlign: 'right', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>{r.label}</span>
        <div style={{ flex: 1, height: 14, background: 'var(--surface)', borderRadius: 4, overflow: 'hidden' }}><div style={{ width: `${100 * r.value / m}%`, height: '100%', background: r.color || color }} /></div>
        <span style={{ width: 90 }}>{Math.round(r.value * 10) / 10}{unit}{r.sub ? <span style={{ color: 'var(--text-muted)' }}> {r.sub}</span> : null}</span>
      </div>))}</div>
  )
}
const Err = ({ e }) => e ? <div className="alert alert-error" style={{ fontSize: 12, marginBottom: 10 }}>{e}</div> : null
const Loading = () => <div style={{ padding: 24, textAlign: 'center' }}><span className="spinner" /></div>
const Empty = ({ children }) => <div style={{ padding: 18, fontSize: 13, color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 8 }}>{children}</div>

// ── tracked keys (initiatives / epics) ──────────────────────────────────────────────────────────────
function Tracker({ level, cfg, reload, label }) {
  const [key, setKey] = useState('')
  const [err, setErr] = useState('')
  const add = async k => { const d = await post(`${API}/config`, { level, key: k || key, op: 'add' }); if (d.ok) { setKey(''); setErr(''); reload() } else setErr(d.error) }
  const keys = cfg[level]
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={key} onChange={e => setKey(e.target.value)} onKeyDown={e => e.key === 'Enter' && key.trim() && add()} placeholder={`Track a ${label} (e.g. PAYOR-204946)`} style={{ ...field, width: 280 }} />
        <button className="btn btn-sm btn-primary" disabled={!key.trim()} onClick={() => add()}>＋ Track</button>
        {keys.map(k => <span key={k} style={{ fontSize: 12, border: '1px solid var(--border)', borderRadius: 12, padding: '2px 4px 2px 10px', background: 'var(--surface)' }}>{k}
          <button title="Stop tracking" onClick={async () => { await post(`${API}/config`, { level, key: k, op: 'remove' }); reload() }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button></span>)}
      </div>
      {level === 'epics' && cfg.suggested_epics.length > 0 && (
        <div style={{ fontSize: 12, marginTop: 6, color: 'var(--text-muted)' }}>Epics in your sprint files: {cfg.suggested_epics.map(k =>
          <button key={k} className="btn btn-sm" style={{ margin: '0 4px 2px 0', padding: '0 8px' }} onClick={() => add(k)}>＋ {k}</button>)}</div>)}
      <Err e={err} />
    </div>
  )
}

const Jira = ({ base, k }) => <a href={`${base}/browse/${k}`} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontWeight: 600 }}>{k}</a>

function useData(url, deps = []) {
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback((refresh) => { setBusy(true); get(url + (refresh ? (url.includes('?') ? '&' : '?') + 'refresh=1' : '')).then(r => { setD(r); setBusy(false) }) }, [url, ...deps])
  useEffect(() => { load(false) }, [load])
  return [d, busy, load]
}

function Header({ title, busy, onRefresh, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
      <b style={{ fontSize: 16 }}>{title}</b>{children}
      {onRefresh && <button className="btn btn-sm" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => onRefresh(true)}>{busy ? 'Loading…' : '↻ Refresh from Jira'}</button>}
    </div>
  )
}

// ── Initiative Progress ──────────────────────────────────────────────────────────────────────────────
function InitiativeProgress({ cfg, reload }) {
  const [d, busy, load] = useData(`${API}/initiatives`, [cfg.initiatives.join(), cfg.epics.join()])
  const [open, setOpen] = useState({})
  return (
    <>
      <Header title="Initiative Progress" busy={busy} onRefresh={load}><Legend /></Header>
      <Tracker level="initiatives" cfg={cfg} reload={reload} label="initiative" />
      {!d ? <Loading /> : !d.ok ? <Err e={d.error} /> : d.initiatives.length === 0 ? <Empty>No initiatives yet. Track an initiative above, or track epics (Epic Progress) - their parent initiatives appear here.</Empty> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['', 'Initiative', 'Status', 'Epics', 'Work items', 'Progress', 'Items done', 'Points done'].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
            <tbody>{d.initiatives.map(i => i.error ? <tr key={i.key}><td style={td} colSpan={8}>{i.key}: {i.error}</td></tr> : [
              <tr key={i.key}>
                <td style={{ ...td, cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setOpen(o => ({ ...o, [i.key]: !o[i.key] }))}>{open[i.key] ? '▾' : '▸'}</td>
                <td style={td}><Jira base={cfg.jira_base} k={i.key} /> <span style={{ color: 'var(--text-muted)' }}>{i.summary}</span></td>
                <td style={td}>{i.status}</td><td style={td}>{i.epics_done}/{i.epics_total} done</td><td style={td}>{i.done}/{i.total}</td>
                <td style={td}><Stack done={i.done} prog={Math.max(0, i.epics.reduce((n, e) => n + (e.inprogress || 0), 0))} todo={Math.max(0, i.total - i.done - i.epics.reduce((n, e) => n + (e.inprogress || 0), 0))} /></td>
                <td style={td}><Pct v={i.pct_items} /></td><td style={td}><Pct v={i.pct_points} /></td></tr>,
              open[i.key] && i.epics.map(e => e.error ? null : (
                <tr key={i.key + e.key} style={{ background: 'var(--surface)' }}>
                  <td style={td} /><td style={{ ...td, paddingLeft: 28 }}><Jira base={cfg.jira_base} k={e.key} /> <span style={{ color: 'var(--text-muted)' }}>{e.summary}</span></td>
                  <td style={td}>{e.status}</td><td style={td} /><td style={td}>{e.done}/{e.total}</td>
                  <td style={td}><Stack done={e.done} prog={e.inprogress} todo={e.todo} /></td><td style={td}><Pct v={e.pct_items} /></td><td style={td}><Pct v={e.pct_points} /></td></tr>)),
            ])}</tbody>
          </table>
        </div>)}
    </>
  )
}

// ── Epic Progress ────────────────────────────────────────────────────────────────────────────────────
function EpicProgress({ cfg, reload }) {
  const [d, busy, load] = useData(`${API}/epics`, [cfg.epics.join()])
  const [open, setOpen] = useState({})
  return (
    <>
      <Header title="Epic Progress" busy={busy} onRefresh={load}><Legend /></Header>
      <Tracker level="epics" cfg={cfg} reload={reload} label="epic" />
      {!d ? <Loading /> : !d.ok ? <Err e={d.error} /> : d.epics.length === 0 ? <Empty>No epics tracked yet. Track an epic above - the suggestions come from the epics in your sprint files.</Empty> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['', 'Epic', 'Initiative', 'Status', 'Done', 'In progress', 'To do', 'Progress', 'Items', 'Points'].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
            <tbody>{d.epics.map(e => e.error ? <tr key={e.key}><td style={td} colSpan={10}>{e.key}: {e.error}</td></tr> : [
              <tr key={e.key}>
                <td style={{ ...td, cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setOpen(o => ({ ...o, [e.key]: !o[e.key] }))}>{open[e.key] ? '▾' : '▸'}</td>
                <td style={td}><Jira base={cfg.jira_base} k={e.key} /> <span style={{ color: 'var(--text-muted)' }}>{e.summary}</span></td>
                <td style={td}>{e.parent ? <Jira base={cfg.jira_base} k={e.parent.key} /> : '—'}</td><td style={td}>{e.status}</td>
                <td style={td}>{e.done}</td><td style={td}>{e.inprogress}</td><td style={td}>{e.todo}</td>
                <td style={td}><Stack done={e.done} prog={e.inprogress} todo={e.todo} /></td><td style={td}><Pct v={e.pct_items} /></td>
                <td style={td}>{e.points_total ? <span><Pct v={e.pct_points} /> <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{e.points_done}/{e.points_total}</span></span> : '—'}</td></tr>,
              open[e.key] && (
                <tr key={e.key + 'x'} style={{ background: 'var(--surface)' }}><td style={td} /><td style={td} colSpan={9}>
                  <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12 }}>
                    {Object.entries(e.by_type).map(([t, b]) => <span key={t}><b>{t}</b> {b.done}/{b.total}</span>)}
                  </div></td></tr>),
            ])}</tbody>
          </table>
        </div>)}
    </>
  )
}

// ── Feature Progress ─────────────────────────────────────────────────────────────────────────────────
function FeatureProgress({ cfg }) {
  const [d, busy, load] = useData(`${API}/features`, [cfg.epics.join()])
  const [epic, setEpic] = useState('')
  const [st, setSt] = useState('')
  const rows = (d?.features || []).filter(f => (!epic || f.epic === epic) && (!st || f.cat === st))
  return (
    <>
      <Header title="Feature Progress" busy={busy} onRefresh={load}><Legend /></Header>
      {!d ? <Loading /> : !d.ok ? <Err e={d.error} /> : (d.features || []).length === 0 ? <Empty>No features found under the tracked epics. Track epics on the Epic Progress tab.</Empty> : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={epic} onChange={e => setEpic(e.target.value)} style={field}><option value="">All epics</option>{cfg.epics.map(k => <option key={k}>{k}</option>)}</select>
            <select value={st} onChange={e => setSt(e.target.value)} style={field}><option value="">All statuses</option><option value="new">To do</option><option value="indeterminate">In progress</option><option value="done">Done</option></select>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{rows.length} of {d.features.length} features · {rows.filter(f => f.cat === 'done').length} done</span>
          </div>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Feature', 'Epic', 'Status', 'Sub-tasks', 'Progress', 'Points'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{rows.map(f => (
                <tr key={f.key}>
                  <td style={td}><Jira base={cfg.jira_base} k={f.key} /> <span style={{ color: 'var(--text-muted)' }}>{f.summary}</span></td>
                  <td style={td}><Jira base={cfg.jira_base} k={f.epic} /></td>
                  <td style={td}><span style={{ fontSize: 11, fontWeight: 600, color: '#fff', background: f.cat === 'done' ? C.done : f.cat === 'indeterminate' ? C.prog : C.todo, borderRadius: 10, padding: '2px 9px' }}>{f.status}</span></td>
                  <td style={td}>{f.sub_total ? `${f.sub_done}/${f.sub_total}` : '—'}</td>
                  <td style={td}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Stack done={f.pct} todo={100 - f.pct} width={120} /><Pct v={f.pct} /></div></td>
                  <td style={td}>{f.points || '—'}</td></tr>))}</tbody>
            </table>
          </div>
        </>)}
    </>
  )
}

function TeamPick({ teams, team, setTeam, last, setLast }) {
  return (
    <>
      <select value={team} onChange={e => setTeam(e.target.value)} style={field}><option value="">All teams</option>{teams.map(t => <option key={t}>{t}</option>)}</select>
      {setLast && <select value={last} onChange={e => setLast(Number(e.target.value))} style={field}><option value={0}>All sprints</option><option value={3}>Last 3</option><option value={6}>Last 6</option><option value={10}>Last 10</option></select>}
    </>
  )
}

// ── Delivery Metrics ─────────────────────────────────────────────────────────────────────────────────
function DeliveryMetrics() {
  const [team, setTeam] = useState(''); const [last, setLast] = useState(0)
  const [d, busy, load] = useData(`${API}/delivery?team=${encodeURIComponent(team)}&last=${last}`)
  return (
    <>
      <Header title="Delivery Metrics" busy={busy}><TeamPick teams={d?.teams || []} team={team} setTeam={setTeam} last={last} setLast={setLast} /></Header>
      {!d ? <Loading /> : !d.ok ? <Err e={d.error} /> : d.sprints.length === 0 ? <Empty>No sprint files found.</Empty> : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            {[['Sprints', d.sprints.length], ['Average velocity', `${d.avg_velocity} pts`], ['Avg completion', `${Math.round(d.sprints.reduce((n, s) => n + s.completion, 0) / d.sprints.length)}%`],
              ['Carried over (total)', d.sprints.reduce((n, s) => n + s.carried, 0)]].map(([l, v]) => (
              <div key={l} className="card" style={{ minWidth: 150, padding: '10px 14px' }}><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{v}</div></div>))}
          </div>
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Velocity - story points completed per sprint <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11 }}>(avg {d.avg_velocity})</span></div>
            <Bars rows={d.sprints.map(s => ({ label: `${s.name} · ${s.date}`, value: s.points_done, sub: `of ${s.points}`, color: s.current ? C.warn : C.prog }))} unit=" pts" />
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}><span style={{ color: C.prog }}>■</span> completed sprint <span style={{ color: C.warn }}>■</span> current sprint</div>
          </div>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Sprint', 'Team', 'Items', 'Done', 'Completion', 'Points', 'Points done', 'Carried over', 'Adhoc', 'Bugs', 'Avg dev days', 'Avg QA days'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{d.sprints.map(s => (
                <tr key={s.file}><td style={td}>{s.name} <span style={{ color: 'var(--text-muted)' }}>{s.date}</span>{s.current && <b style={{ color: C.warn }}> · current</b>}</td><td style={td}>{s.team}</td><td style={td}>{s.items}</td><td style={td}>{s.done}</td>
                  <td style={td}><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Stack done={s.done} todo={s.items - s.done} width={80} /><Pct v={s.completion} /></div></td>
                  <td style={td}>{s.points}</td><td style={td}>{s.points_done}</td><td style={td}>{s.carried}</td><td style={td}>{s.adhoc}</td><td style={td}>{s.bugs}</td><td style={td}>{s.avg_dev_days ?? '—'}</td><td style={td}>{s.avg_qa_days ?? '—'}</td></tr>))}</tbody>
            </table>
          </div>
        </>)}
    </>
  )
}

// ── Engineering Investment ───────────────────────────────────────────────────────────────────────────
function Investment() {
  const [team, setTeam] = useState(''); const [last, setLast] = useState(0)
  const [metric, setMetric] = useState('points')
  const [d, busy] = useData(`${API}/investment?team=${encodeURIComponent(team)}&last=${last}`)
  const types = useMemo(() => d?.ok ? Object.keys(d.total).sort((a, b) => d.total[b][metric] - d.total[a][metric]) : [], [d, metric])
  const colorOf = t => PALETTE[types.indexOf(t) % PALETTE.length]
  const sum = types.reduce((n, t) => n + d.total[t][metric], 0) || 1
  return (
    <>
      <Header title="Engineering Investment" busy={busy}>
        <TeamPick teams={d?.teams || []} team={team} setTeam={setTeam} last={last} setLast={setLast} />
        <select value={metric} onChange={e => setMetric(e.target.value)} style={field}><option value="points">Story points</option><option value="items">Work items</option><option value="days">Dev + QA days</option></select>
      </Header>
      {!d ? <Loading /> : !d.ok ? <Err e={d.error} /> : types.length === 0 ? <Empty>No sprint data found.</Empty> : (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Where the effort goes (by issue type, {metric === 'points' ? 'story points' : metric === 'items' ? 'work items' : 'days'})</div>
            <div style={{ display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
              {types.map(t => <div key={t} title={`${t}: ${Math.round(d.total[t][metric] * 10) / 10} (${Math.round(100 * d.total[t][metric] / sum)}%)`} style={{ width: `${100 * d.total[t][metric] / sum}%`, background: colorOf(t) }} />)}
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
              {types.map(t => <span key={t}><span style={{ color: colorOf(t) }}>■</span> {t} <b>{Math.round(100 * d.total[t][metric] / sum)}%</b> <span style={{ color: 'var(--text-muted)' }}>({Math.round(d.total[t][metric] * 10) / 10})</span></span>)}
            </div>
          </div>
          <div className="card">
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Per sprint</div>
            {d.per_sprint.map(s => {
              const tot = types.reduce((n, t) => n + (s.by_type[t]?.[metric] || 0), 0) || 1
              return (
                <div key={s.sprint + s.team} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12 }}>
                  <span style={{ width: 210, textAlign: 'right', color: 'var(--text-muted)' }}>{s.sprint}</span>
                  <div style={{ flex: 1, display: 'flex', height: 16, borderRadius: 4, overflow: 'hidden', background: 'var(--surface)' }}>
                    {types.map(t => <div key={t} title={`${t}: ${Math.round((s.by_type[t]?.[metric] || 0) * 10) / 10}`} style={{ width: `${100 * (s.by_type[t]?.[metric] || 0) / tot}%`, background: colorOf(t) }} />)}
                  </div>
                  <span style={{ width: 50 }}>{Math.round(tot * 10) / 10}</span>
                </div>)
            })}
          </div>
        </>)}
    </>
  )
}

// ── Team Capacity ────────────────────────────────────────────────────────────────────────────────────
function Capacity() {
  const [team, setTeam] = useState('')
  const [d, busy] = useData(`${API}/capacity?team=${encodeURIComponent(team)}`)
  const load = p => p == null ? 'var(--text-muted)' : p > 120 ? C.bad : p > 100 ? C.warn : C.done
  return (
    <>
      <Header title="Team Capacity" busy={busy}><TeamPick teams={d?.teams || []} team={team} setTeam={setTeam} />
        {d?.sprint && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d.sprint.team} · {d.sprint.name} ({d.sprint.date}) · capacity = average points done over the previous {d.sprint.baseline_sprints} sprint(s)</span>}</Header>
      {!d ? <Loading /> : !d.ok ? <Err e={d.error} /> : d.developers.length === 0 ? <Empty>No assigned work found in the sprint files.</Empty> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Developer', 'Items', 'In progress', 'Done', 'Points assigned', 'Points done', 'Avg velocity', 'Load vs capacity', 'Dev days'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{d.developers.map(p => (
              <tr key={p.name}><td style={{ ...td, fontWeight: 600 }}>{p.name}</td><td style={td}>{p.items}</td><td style={td}>{p.inprogress}</td><td style={td}>{p.done}</td>
                <td style={td}>{p.points}</td><td style={td}>{p.points_done}</td><td style={td}>{p.avg_velocity ?? '—'}</td>
                <td style={td}>{p.load_pct == null ? '—' : <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 120, height: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5, overflow: 'hidden' }}><div style={{ width: `${Math.min(p.load_pct, 150) / 1.5}%`, height: '100%', background: load(p.load_pct) }} /></div>
                  <b style={{ color: load(p.load_pct) }}>{p.load_pct}%</b></div>}</td>
                <td style={td}>{p.days || '—'}</td></tr>))}</tbody>
          </table>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>Load = points assigned this sprint ÷ the developer's average points completed in earlier sprints. <span style={{ color: C.done }}>■ ≤100%</span> <span style={{ color: C.warn }}>■ 100–120%</span> <span style={{ color: C.bad }}>■ over 120%</span></div>
        </div>)}
    </>
  )
}

export default function PortfolioPage() {
  const loc = useLocation(), nav = useNavigate()
  const slug = loc.pathname.slice(BASE.length).split('/').filter(Boolean)[0] || TABS[0][0]
  const [cfg, setCfg] = useState(null)
  const reload = useCallback(() => get(`${API}/config`).then(d => setCfg(d.ok ? d : { initiatives: [], epics: [], suggested_epics: [], jira_base: '', error: d.error })), [])
  useEffect(() => { reload() }, [reload])
  return (
    <div>
      <div className="page-header"><h1 className="page-title">Portfolio</h1></div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => nav(`${BASE}/${k}`)} style={{ fontSize: 13, fontWeight: 600, padding: '6px 16px', borderRadius: 16, cursor: 'pointer', border: '1px solid var(--primary, #1976d2)',
            background: slug === k ? 'var(--primary, #1976d2)' : 'var(--bg)', color: slug === k ? '#fff' : 'var(--primary, #1976d2)' }}>{l}</button>))}
      </div>
      {!cfg ? <Loading /> : (
        <>
          {cfg.error && <Err e={cfg.error} />}
          {slug === 'initiative-progress' && <InitiativeProgress cfg={cfg} reload={reload} />}
          {slug === 'epic-progress' && <EpicProgress cfg={cfg} reload={reload} />}
          {slug === 'feature-progress' && <FeatureProgress cfg={cfg} />}
          {slug === 'delivery-metrics' && <DeliveryMetrics />}
          {slug === 'engineering-investment' && <Investment />}
          {slug === 'team-capacity' && <Capacity />}
        </>)}
    </div>
  )
}
