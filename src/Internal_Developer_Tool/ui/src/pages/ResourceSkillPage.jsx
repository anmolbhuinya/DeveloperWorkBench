import { useState, useEffect, useCallback, useMemo } from 'react'

const API = '/api/project-management/resource-skill'
const MAX = 5

const fieldStyle = {
  boxSizing: 'border-box', padding: '5px 8px', fontSize: 13, background: 'var(--bg)', color: 'var(--text)',
  border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'inherit',
}

function heat(score) {
  const n = Number(score)
  if (!Number.isFinite(n) || n <= 0) return 'transparent'
  return `rgba(46,125,50,${Math.min(n / MAX, 1) * 0.55 + 0.08})`
}

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const fmt = n => Math.round(n * 10) / 10

function ResourceDetail({ name, onBack, onChanged }) {
  const [data, setData]   = useState(null)
  const [skills, setSkills] = useState([])
  const [err, setErr]     = useState('')
  const [msg, setMsg]     = useState('')
  const [dirty, setDirty] = useState(false)

  const load = useCallback(() => {
    fetch(`${API}/resource/${encodeURIComponent(name)}`).then(r => r.json())
      .then(d => { if (d.ok) { setData(d); setSkills(d.skills); setDirty(false) } else setErr(d.error || 'Failed to load') })
      .catch(() => setErr('Failed to load'))
  }, [name])
  useEffect(load, [load])

  const save = async () => {
    setErr('')
    try {
      const r = await fetch(`${API}/resource/${encodeURIComponent(name)}/skills`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skills }),
      })
      const d = await r.json()
      if (!d.ok) { setErr(d.error || 'Save failed'); return }
      setDirty(false); setMsg('Saved'); setTimeout(() => setMsg(''), 1500); onChanged()
    } catch { setErr('Save failed') }
  }
  const setSk = (i, patch) => { setSkills(s => s.map((x, k) => k === i ? { ...x, ...patch } : x)); setDirty(true) }

  const byQuarter = useMemo(() => {
    const m = {}
    ;(data?.jira || []).forEach(j => { (m[j.Quarter || 'Unknown'] ||= []).push(j) })
    const key = q => { const x = /Q(\d) (\d{4})/.exec(q); return x ? Number(x[2]) * 10 + Number(x[1]) : 0 }
    return Object.entries(m).sort((a, b) => key(b[0]) - key(a[0]))
  }, [data])

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-sm" onClick={onBack}>← Back</button>
        <h1 className="page-title" style={{ margin: 0 }}>{name}</h1>
      </div>
      {err && <div className="alert alert-error">{err}</div>}
      {!data && !err && <span className="spinner" />}
      {data && (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div className="card" style={{ flex: '0 0 340px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Skills <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>(proficiency 0–{MAX})</span></div>
            {skills.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No skills yet.</div>}
            {skills.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="text" value={s.skill} placeholder="Skill" onChange={e => setSk(i, { skill: e.target.value })} style={{ ...fieldStyle, flex: 1, minWidth: 0 }} />
                <input type="number" min={0} max={MAX} value={s.proficiency} onChange={e => setSk(i, { proficiency: e.target.value })} style={{ ...fieldStyle, width: 60 }} />
                <button className="btn btn-sm btn-danger" onClick={() => { setSkills(skills.filter((_, k) => k !== i)); setDirty(true) }}>✕</button>
              </div>
            ))}
            <div className="flex-gap">
              <button className="btn btn-sm" onClick={() => { setSkills([...skills, { skill: '', proficiency: 1 }]); setDirty(true) }}>+ Add skill</button>
              <button className="btn btn-sm btn-primary" disabled={!dirty} onClick={save}>Save</button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{msg}</span>
            </div>
          </div>

          <div className="card" style={{ flex: 1, minWidth: 420, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>JIRA — completed tickets by quarter</div>
            {byQuarter.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Nothing yet — tickets are recorded when a sprint is completed.</div>}
            {byQuarter.map(([q, rows]) => (
              <div key={q}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                  {q} <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 12 }}>
                    · {rows.length} ticket{rows.length === 1 ? '' : 's'} · {fmt(rows.reduce((a, r) => a + num(r['Story Point']), 0))} SP · {fmt(rows.reduce((a, r) => a + num(r.Days), 0))} days
                  </span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr>{['JIRA ID', 'Story', 'SP', 'Days', 'Module', 'Sprint'].map(h =>
                    <th key={h} style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '2px solid var(--border)', color: 'var(--text-muted)', fontSize: 11 }}>{h}</th>)}</tr></thead>
                  <tbody>{rows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', fontFamily: 'monospace' }}>{r['JIRA ID']}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>{r.Story}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>{r['Story Point']}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>{r.Days}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>{r.Module}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>{r.Sprint}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ResourceSkillPage() {
  const [m, setM]       = useState(null)
  const [err, setErr]   = useState('')
  const [sel, setSel]   = useState(null)
  const [newName, setNewName] = useState('')

  const load = useCallback(() => {
    fetch(`${API}/matrix`).then(r => r.json())
      .then(d => (d.ok ? setM(d) : setErr(d.error || 'Failed to load')))
      .catch(() => setErr('Failed to load'))
  }, [])
  useEffect(load, [load])

  const add = async () => {
    const name = newName.trim()
    if (!name) return
    const r = await fetch(`${API}/resource`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
    const d = await r.json().catch(() => ({ ok: false }))
    if (!d.ok) { setErr(d.error || 'Could not add'); return }
    setNewName(''); load(); setSel(name)
  }

  if (sel) return <ResourceDetail name={sel} onBack={() => { setSel(null); load() }} onChanged={load} />

  return (
    <div>
      <div className="page-header"><h1 className="page-title">Resource And Skill</h1></div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input type="text" placeholder="Add developer…" value={newName} onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }} style={{ ...fieldStyle, width: 240 }} />
        <button className="btn btn-sm btn-primary" disabled={!newName.trim()} onClick={add}>+ Add</button>
        {m?.path && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.path}</span>}
      </div>
      {err && <div className="alert alert-error">{err}</div>}
      {!m && !err && <span className="spinner" />}
      {m && m.resources.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No developers yet. Add one above, or complete a sprint to record its developers.</div>
      )}
      {m && m.resources.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 12px', borderBottom: '2px solid var(--border)', position: 'sticky', left: 0, background: 'var(--surface, var(--bg))' }}>Developer</th>
                {m.skills.map(s => <th key={s} style={{ padding: '6px 10px', borderBottom: '2px solid var(--border)', color: 'var(--text-muted)', fontSize: 11, whiteSpace: 'nowrap' }}>{s}</th>)}
              </tr>
            </thead>
            <tbody>
              {m.resources.map(r => (
                <tr key={r.name}>
                  <td style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)', position: 'sticky', left: 0, background: 'var(--surface, var(--bg))' }}>
                    <a href="#" onClick={e => { e.preventDefault(); setSel(r.name) }} style={{ color: 'var(--primary,#1976d2)', textDecoration: 'none', fontWeight: 600 }}>{r.name}</a>
                  </td>
                  {m.skills.map(s => (
                    <td key={s} style={{ textAlign: 'center', padding: '6px 10px', borderBottom: '1px solid var(--border)', background: heat(r.scores[s]) }}>{r.scores[s] ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
