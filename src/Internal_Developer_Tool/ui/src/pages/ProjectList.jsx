import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'

const CW_REFRESH_KEY = 'cw_auto_refresh_ms'
const CW_REFRESH_OPTIONS = [
  { label: '5 min',  ms: 300000 },
  { label: '10 min', ms: 600000 },
  { label: '15 min', ms: 900000 },
  { label: '20 min', ms: 1200000 },
  { label: '30 min', ms: 1800000 },
  { label: '1 hr',   ms: 3600000 },
  { label: '2 hr',   ms: 7200000 },
]

function StatusBadge({ status }) {
  const map = {
    'Completed':   'badge badge-success',
    'In Progress': 'badge badge-warning',
    'Paused':      'badge badge-warning',
    'Failed':      'badge badge-danger',
    'Aborted':     'badge badge-danger',
    'Pending':     'badge badge-pending',
  }
  return <span className={map[status] || 'badge badge-pending'}>{status || 'Unknown'}</span>
}

function StatsPanel() {
  const [statsData,   setStatsData]   = useState(null)
  const [compareData, setCompareData] = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [err,         setErr]         = useState('')

  const load = useCallback(() => {
    setLoading(true); setErr('')
    Promise.all([
      fetch('/api/clone-workflow/stage-stats').then(r => r.json()),
      fetch('/api/clone-workflow/compare?n=10').then(r => r.json()),
    ]).then(([stats, compare]) => {
      if (!stats.ok) { setErr(stats.error || 'Failed to load stats.'); setLoading(false); return }
      setStatsData(stats)
      if (compare.ok) setCompareData(compare)
      setLoading(false)
    }).catch(() => { setErr('Request failed.'); setLoading(false) })
  }, [])

  useEffect(() => { load() }, [load])

  const failureAnalysis = useMemo(() => {
    if (!compareData) return []
    const failures = {}, counts = {}
    for (const stage of compareData.stages) {
      failures[stage] = 0; counts[stage] = 0
      for (const proj of compareData.projects) {
        const st = proj.stages[stage]
        if (st && st.status) {
          counts[stage]++
          if (st.status === 'Failed') failures[stage]++
        }
      }
    }
    return compareData.stages
      .filter(s => failures[s] > 0)
      .map(s => ({ stage: s, failures: failures[s], runs: counts[s], rate: counts[s] > 0 ? Math.round(100 * (1 - failures[s] / counts[s])) : 0 }))
      .sort((a, b) => b.failures - a.failures)
  }, [compareData])

  const durationRows = useMemo(() => {
    if (!statsData?.summary) return []
    return Object.entries(statsData.summary)
      .map(([stage, s]) => ({ stage, ...s }))
      .sort((a, b) => b.avg_s - a.avg_s)
  }, [statsData])

  const maxAvg = durationRows.length ? durationRows[0].avg_s : 1

  const fmtDur = (s) => {
    if (s == null) return '—'
    if (s < 60) return `${s}s`
    return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
  }

  return (
    <div style={{ padding: '16px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <strong style={{ fontSize: 14 }}>Workflow Stage Statistics</strong>
        <button className="btn btn-sm" onClick={load} disabled={loading}>
          {loading ? '↻ Loading…' : '↻ Refresh'}
        </button>
      </div>
      {err && <div className="alert alert-error">{err}</div>}
      {loading && <div className="center"><span className="spinner" /></div>}
      {!loading && (
        <>
          <div style={{ marginBottom: 24 }}>
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--text-muted)' }}>Stage Durations</h4>
            {durationRows.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No duration data yet. Stages will appear here after runs complete.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border)' }}>
                      <th style={{ textAlign: 'left',  padding: '4px 8px', minWidth: 160 }}>Stage</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px' }}>Avg</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px' }}>Min</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px' }}>Max</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px' }}>Runs</th>
                      <th style={{ textAlign: 'left',  padding: '4px 8px', minWidth: 120 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {durationRows.map(r => (
                      <tr key={r.stage} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{r.stage}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>{fmtDur(r.avg_s)}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{fmtDur(r.min_s)}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{fmtDur(r.max_s)}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{r.count}</td>
                        <td style={{ padding: '4px 8px' }}>
                          <div style={{ background: 'var(--border)', borderRadius: 3, height: 6, overflow: 'hidden', minWidth: 80 }}>
                            <div style={{ width: `${Math.round((r.avg_s / maxAvg) * 100)}%`, height: '100%', background: 'var(--primary)', borderRadius: 3 }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--text-muted)' }}>
              Failure Analysis <span style={{ fontWeight: 400, fontSize: 11 }}>(last 10 runs)</span>
            </h4>
            {failureAnalysis.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No stage failures in the last 10 runs.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border)' }}>
                      <th style={{ textAlign: 'left',  padding: '4px 8px', minWidth: 160 }}>Stage</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px' }}>Failures</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px' }}>Runs</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px' }}>Success Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failureAnalysis.map(r => (
                      <tr key={r.stage} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{r.stage}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: '#c0392b', fontWeight: 600 }}>{r.failures}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{r.runs}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right',
                          color: r.rate >= 80 ? '#2d8a4e' : r.rate >= 50 ? '#e67e22' : '#c0392b' }}>
                          {r.rate}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function ComparePanel({ onClose }) {
  const [n, setN] = useState(10)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const fetch_ = useCallback((count) => {
    setLoading(true); setErr('')
    fetch(`/api/clone-workflow/compare?n=${count}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setData(d); else setErr(d.error || 'Failed'); setLoading(false) })
      .catch(() => { setErr('Request failed.'); setLoading(false) })
  }, [])

  useEffect(() => { fetch_(n) }, [n, fetch_])

  const STATUS_STYLE = {
    'Completed':   { color: '#2d8a4e', dot: '●' },
    'Failed':      { color: '#c0392b', dot: '✗' },
    'In Progress': { color: '#2980b9', dot: '◉' },
    'Skipped':     { color: '#999',    dot: '○', extra: { textDecoration: 'line-through' } },
    'Waiting':     { color: '#e67e22', dot: '◑' },
  }

  return (
    <div style={{ marginTop: 20, border: '1px solid var(--border)', borderRadius: 6, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <strong style={{ fontSize: 14 }}>Compare Runs</strong>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
            Last
            <select value={n} onChange={e => setN(Number(e.target.value))}
              style={{ fontSize: 12, padding: '2px 4px' }}>
              {[5, 10, 20].map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            runs
          </label>
        </div>
        <button className="btn btn-sm" onClick={onClose}>✕ Close</button>
      </div>
      {loading && <div className="center"><span className="spinner" /></div>}
      {err && <div className="alert alert-error">{err}</div>}
      {data && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', minWidth: 140, padding: '4px 8px', borderBottom: '2px solid var(--border)' }}>Stage</th>
                {data.projects.map(p => {
                  const sc = STATUS_STYLE[p.status] || { color: 'var(--text-muted)' }
                  return (
                    <th key={p.pid} style={{ textAlign: 'center', minWidth: 120, padding: '4px 8px', borderBottom: '2px solid var(--border)' }}>
                      <span style={{ fontWeight: 700, color: sc.color }}>#{p.pid}</span><br/>
                      <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11 }}>{p.release_branch || p.payor_version || '—'}</span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {data.stages.map(sk => (
                <tr key={sk} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '3px 8px', fontFamily: 'monospace', fontSize: 12 }}>{sk}</td>
                  {data.projects.map(p => {
                    const st = p.stages[sk] || { status: '', notes: '' }
                    const s = STATUS_STYLE[st.status] || { color: '#aaa', dot: '·' }
                    return (
                      <td key={p.pid} title={st.notes || ''}
                        style={{ color: s.color, whiteSpace: 'nowrap', padding: '3px 8px', textAlign: 'center', ...(s.extra || {}) }}>
                        {st.status ? `${s.dot || '·'} ${st.status}` : '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ConfigureWorkflowModal({ onClose }) {
  const [stages,      setStages]      = useState([])
  const [deps,        setDeps]        = useState({})    // { stage_id: Set<dep_id> }
  const [stageConfig, setStageConfig] = useState({})   // { stage_id: { timeout_s: number|null, parallel_group: string|null } }
  const [runbookConfig, setRunbookConfig] = useState({})  // { stage_id: [suggestion, ...] }
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [err,    setErr]    = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/stages').then(r => r.json()),
      fetch('/api/workflow/dependencies').then(r => r.json()),
    ]).then(([stagesData, depsData]) => {
      setStages(stagesData || [])
      const raw = (depsData.ok && depsData.dependencies) ? depsData.dependencies : {}
      const asSet = {}
      for (const [k, v] of Object.entries(raw)) asSet[k] = new Set(v)
      setDeps(asSet)
      setStageConfig((depsData.ok && depsData.stage_config) ? depsData.stage_config : {})
      setRunbookConfig((depsData.ok && depsData.runbook) ? depsData.runbook : {})
    }).catch(() => setErr('Failed to load configuration.'))
  }, [])

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const toggleDep = (stageId, depId) => {
    setDeps(prev => {
      const next = { ...prev }
      const set  = new Set(next[stageId] || [])
      if (set.has(depId)) set.delete(depId); else set.add(depId)
      next[stageId] = set
      return next
    })
    setSaved(false)
  }

  const setTimeoutS = (stageId, val) => {
    setStageConfig(prev => ({
      ...prev,
      [stageId]: { ...(prev[stageId] || {}), timeout_s: val === '' ? null : Number(val) },
    }))
    setSaved(false)
  }

  const setParallelGroup = (stageId, val) => {
    setStageConfig(prev => ({
      ...prev,
      [stageId]: { ...(prev[stageId] || {}), parallel_group: val.trim() || null },
    }))
    setSaved(false)
  }

  const save = async () => {
    setSaving(true); setErr(''); setSaved(false)
    const serialised = {}
    for (const [k, v] of Object.entries(deps)) {
      const arr = [...v]
      if (arr.length) serialised[k] = arr
    }
    try {
      const r = await fetch('/api/workflow/dependencies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dependencies: serialised, stage_config: stageConfig, runbook: runbookConfig }),
      })
      const d = await r.json()
      if (d.ok) setSaved(true); else setErr(d.error || 'Save failed.')
    } catch { setErr('Request failed.') }
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}
        style={{ maxWidth: 680, width: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <span className="modal-title">Configure Workflow Dependencies</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>
          {err && <div className="alert alert-error" style={{ marginBottom: 12 }}>{err}</div>}
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
            Select which stages each sub-workflow depends on. A stage will only begin after all its dependencies are complete.
          </p>
          {stages.length === 0 ? (
            <div className="center"><span className="spinner" /></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {stages.map(stage => {
                const others    = stages.filter(s => s.id !== stage.id)
                const stageDeps = deps[stage.id] || new Set()
                return (
                  <div key={stage.id} style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ padding: '8px 14px', background: 'var(--surface-alt, var(--surface))',
                                  borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 13,
                                  display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>{stage.label || stage.name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontWeight: 400, fontSize: 12 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: 'var(--text-muted)' }}>Timeout</span>
                          <input
                            type="number"
                            min="0"
                            placeholder="none"
                            value={stageConfig[stage.id]?.timeout_s ?? ''}
                            onChange={e => setTimeoutS(stage.id, e.target.value)}
                            style={{ width: 72, padding: '2px 6px', fontSize: 12,
                                     background: 'var(--input-bg, var(--surface))',
                                     border: '1px solid var(--border)', borderRadius: 4,
                                     color: 'var(--text)' }}
                          />
                          <span style={{ color: 'var(--text-muted)' }}>s</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: 'var(--text-muted)' }}>Group</span>
                          <input
                            type="text"
                            placeholder="none"
                            value={stageConfig[stage.id]?.parallel_group || ''}
                            onChange={e => setParallelGroup(stage.id, e.target.value)}
                            style={{ width: 90, padding: '2px 6px', fontSize: 12,
                                     background: 'var(--input-bg, var(--surface))',
                                     border: '1px solid var(--border)', borderRadius: 4,
                                     color: 'var(--text)' }}
                          />
                        </label>
                      </div>
                    </div>
                    <div style={{ padding: '6px 14px 4px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>
                        💡 Runbook suggestions (one per line — shown when stage fails):
                      </div>
                      <textarea
                        rows={2}
                        style={{ width: '100%', fontSize: 11, resize: 'vertical', padding: '3px 6px',
                                 background: 'var(--input-bg, var(--surface))',
                                 border: '1px solid var(--border)', borderRadius: 3,
                                 color: 'var(--text)', fontFamily: 'inherit', boxSizing: 'border-box' }}
                        placeholder={'e.g. Check VPN connectivity\nVerify Jenkins queue is not full'}
                        value={(runbookConfig[stage.id] || []).join('\n')}
                        onChange={e => {
                          const lines = e.target.value.split('\n').map(l => l.trim()).filter(Boolean)
                          setRunbookConfig(prev => ({ ...prev, [stage.id]: lines }))
                          setSaved(false)
                        }}
                      />
                    </div>
                    <div style={{ padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: '5px 16px' }}>
                      {others.length === 0
                        ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
                        : others.map(dep => (
                          <label key={dep.id} style={{ display: 'flex', alignItems: 'center', gap: 5,
                                                       cursor: 'pointer', fontSize: 12 }}>
                            <input type="checkbox" checked={stageDeps.has(dep.id)}
                              onChange={() => toggleDep(stage.id, dep.id)} style={{ cursor: 'pointer' }} />
                            <span style={{ color: stageDeps.has(dep.id) ? 'var(--primary)' : 'var(--text-muted)' }}>
                              {dep.label || dep.name}
                            </span>
                          </label>
                        ))
                      }
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {saved && <div className="alert alert-success" style={{ marginTop: 12 }}>Dependencies, timeouts, parallel groups, and runbook suggestions saved.</div>}
          <div className="flex-gap" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn" onClick={onClose}>Close</button>
            <button className="btn btn-primary" onClick={save} disabled={saving || stages.length === 0}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const STATUS_DOT_COLOR = { ok: '#22c55e', warn: '#f59e0b', error: '#ef4444', unknown: '#9ca3af' }
function StatusDot({ status }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
      background: STATUS_DOT_COLOR[status] || STATUS_DOT_COLOR.unknown,
      marginRight: 5,
    }} />
  )
}

function HealthStrip() {
  const [health,   setHealth]   = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [expanded, setExpanded] = useState(false)

  const refresh = () => {
    setLoading(true)
    fetch('/api/health/environment')
      .then(r => r.json())
      .then(d => { setHealth(d); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 60_000)
    return () => clearInterval(t)
  }, [])

  try {
    const jq   = health?.checks?.jenkins_queue
    const gh   = health?.checks?.github_rate_limit
    const vms  = health?.checks?.vms || []
    const down = vms.filter(v => !v.reachable).length

    return (
      <div style={{ marginBottom: 12 }}>
        {/* Collapsed summary strip */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '5px 12px', background: 'var(--bg-subtle)',
          border: '1px solid var(--border)', borderRadius: 6,
          fontSize: 12, flexWrap: 'wrap',
        }}>
          <span style={{ color: 'var(--text-muted)', marginRight: 2, fontWeight: 500 }}>Env</span>

          {jq && (
            <span title={`Queue depth: ${jq.depth ?? '?'}, Stuck: ${jq.stuck ?? '?'}${jq.url ? `\n${jq.url}` : ''}`}
                  style={{ display: 'flex', alignItems: 'center' }}>
              <StatusDot status={jq.status} />
              Jenkins {jq.depth != null ? `${jq.depth} queued` : '—'}
              {jq.stuck > 0 && <span style={{ color: '#ef4444', marginLeft: 3 }}>({jq.stuck} stuck)</span>}
            </span>
          )}

          {gh && (
            <span title={`Rate limit: ${gh.remaining}/${gh.limit}, resets in ${gh.resets_in}`}
                  style={{ display: 'flex', alignItems: 'center' }}>
              <StatusDot status={gh.status} />
              GitHub {gh.remaining != null ? `${gh.remaining} req left` : '—'}
            </span>
          )}

          {vms.length > 0 && (
            <span title={vms.map(v => `${v.name}: ${v.reachable ? '✓' : '✗'}`).join(', ')}
                  style={{ display: 'flex', alignItems: 'center' }}>
              <StatusDot status={down === 0 ? 'ok' : 'error'} />
              VMs {down === 0 ? `${vms.length} reachable` : `${down}/${vms.length} down`}
            </span>
          )}

          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
            ↻ {CW_REFRESH_OPTIONS.find(o => o.ms === autoRefreshMs)?.label ?? 'Off'}
          </span>
          <button onClick={refresh} disabled={loading}
            style={{ fontSize: 11, padding: '1px 7px',
                     border: '1px solid var(--border)', borderRadius: 3,
                     background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            {loading ? '…' : '↻'}
          </button>
          <button onClick={() => setExpanded(v => !v)}
            style={{ fontSize: 11, padding: '1px 7px', border: '1px solid var(--border)',
                     borderRadius: 3, background: 'none', cursor: 'pointer',
                     color: 'var(--text-muted)' }}>
            {expanded ? '▲' : '▼'}
          </button>
        </div>

        {/* Expanded detail panel */}
        {expanded && health && (
          <div style={{
            border: '1px solid var(--border)', borderRadius: 6,
            padding: '10px 14px', marginTop: 4,
            background: 'var(--bg)', fontSize: 12,
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px 24px' }}>
              {/* Jenkins */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Jenkins Queue</div>
                {!jq ? <div style={{ color: 'var(--text-muted)' }}>—</div>
                : jq.error ? <div style={{ color: '#ef4444' }}>{jq.error}</div>
                : <>
                    <div>Depth: <strong>{jq.depth ?? '—'}</strong></div>
                    {jq.stuck > 0 && <div style={{ color: '#ef4444' }}>Stuck: {jq.stuck}</div>}
                    {jq.url && <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>{jq.url}</div>}
                  </>
                }
              </div>
              {/* GitHub */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>GitHub API</div>
                {!gh ? <div style={{ color: 'var(--text-muted)' }}>—</div>
                : gh.error ? <div style={{ color: '#ef4444' }}>{gh.error}</div>
                : <>
                    <div>Remaining: <strong>{gh.remaining ?? '—'} / {gh.limit ?? '—'}</strong></div>
                    <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>Resets in {gh.resets_in}</div>
                  </>
                }
              </div>
              {/* VMs */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Remote VMs</div>
                {vms.length === 0
                  ? <div style={{ color: 'var(--text-muted)' }}>No VMs configured</div>
                  : vms.map(v => (
                      <div key={v.name} style={{ display: 'flex', alignItems: 'center', marginBottom: 3 }}>
                        <StatusDot status={v.status} />
                        <span>{v.name}</span>
                        {v.ip && <span style={{ color: 'var(--text-muted)', marginLeft: 5 }}>({v.ip})</span>}
                      </div>
                    ))
                }
              </div>
            </div>
            {health.checked_at && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                Last checked: {new Date(health.checked_at).toLocaleTimeString()}
              </div>
            )}
          </div>
        )}
      </div>
    )
  } catch {
    return null
  }
}

const TABS = ['Payor', 'Stats']

export default function ProjectList() {
  const navigate = useNavigate()
  const [activeTab,      setActiveTab]      = useState('Payor')
  const [projects,       setProjects]       = useState([])
  const [loading,        setLoading]        = useState(true)
  const [deleting,       setDeleting]       = useState(null)
  const [executing,      setExecuting]      = useState(null)
  const [aborting,       setAborting]       = useState(null)
  const [pausing,        setPausing]        = useState(null)
  const [resuming,       setResuming]       = useState(null)
  const [confirmDlg,     setConfirmDlg]     = useState(null)
  const [jiraBaseUrl,    setJiraBaseUrl]    = useState('')
  const [showCfgWf,      setShowCfgWf]      = useState(false)
  const [showCompare,    setShowCompare]    = useState(false)
  const [autoRefreshMs,  setAutoRefreshMs]  = useState(
    () => Number(localStorage.getItem(CW_REFRESH_KEY) || 600000)
  )
  const [showScheduler,    setShowScheduler]    = useState(false)
  const [schedSettings,    setSchedSettings]    = useState([])   // [{key, value, notes}]
  const [schedSaving,      setSchedSaving]      = useState(false)
  const [schedSaved,       setSchedSaved]       = useState(false)
  const [schedErr,         setSchedErr]         = useState('')

  const load = useCallback(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(data => { setProjects(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/clone-workflow/jira-base-url')
      .then(r => r.json())
      .then(d => { if (d.jira_base_url) setJiraBaseUrl(d.jira_base_url) })
      .catch(() => {})
  }, [])

  // Load saved auto-refresh interval from server on mount
  useEffect(() => {
    fetch('/api/clone-workflow/poll-interval')
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.poll_interval_s) {
          const ms = d.poll_interval_s * 1000
          const valid = CW_REFRESH_OPTIONS.map(o => o.ms)
          if (valid.includes(ms)) { setAutoRefreshMs(ms); localStorage.setItem(CW_REFRESH_KEY, String(ms)) }
        }
      })
      .catch(() => {})
  }, [])

  // Sync Auto Refresh interval to server (persists to scheduler_config.xlsx)
  useEffect(() => {
    localStorage.setItem(CW_REFRESH_KEY, String(autoRefreshMs))
    fetch('/api/clone-workflow/poll-interval', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_ms: autoRefreshMs }),
    }).catch(() => {})
  }, [autoRefreshMs])

  const loadSchedulerSettings = () => {
    fetch('/api/clone-workflow/scheduler-settings')
      .then(r => r.json())
      .then(d => { if (d.ok && d.settings) setSchedSettings(d.settings) })
      .catch(() => {})
  }

  useEffect(() => { loadSchedulerSettings() }, [])

  // Auto-refresh project list
  useEffect(() => {
    const id = setInterval(load, autoRefreshMs)
    return () => clearInterval(id)
  }, [autoRefreshMs, load])

  const saveSchedulerSettings = async () => {
    setSchedSaving(true); setSchedSaved(false); setSchedErr('')
    try {
      const updates = {}
      schedSettings.forEach(s => { updates[s.key] = s.value })
      const r = await fetch('/api/clone-workflow/scheduler-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: updates }),
      })
      const d = await r.json()
      if (d.ok) { setSchedSaved(true); loadSchedulerSettings() }
      else setSchedErr(d.error || 'Failed to save')
    } catch { setSchedErr('Network error') }
    finally { setSchedSaving(false) }
  }

  const handleDelete = (pid, ticket, e) => {
    e.stopPropagation()
    setConfirmDlg({
      title: 'Delete Workflow',
      message: `Delete project #${pid} (${ticket})? This cannot be undone.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        setConfirmDlg(null)
        setDeleting(pid)
        await fetch(`/api/projects/${pid}`, { method: 'DELETE' })
        setDeleting(null)
        load()
      },
    })
  }

  const handleExecute = async (pid) => {
    setExecuting(pid)
    await fetch(`/api/projects/${pid}/execute`, { method: 'POST' })
    setExecuting(null)
    navigate(`/projects/${pid}`)
  }

  const handleAbort = (pid, e) => {
    e.stopPropagation()
    setConfirmDlg({
      title: 'Abort Workflow',
      message: 'All running and scheduled sub-workflows will be stopped.',
      confirmLabel: 'Abort',
      onConfirm: async () => {
        setConfirmDlg(null)
        setAborting(pid)
        await fetch(`/api/projects/${pid}/abort`, { method: 'POST' }).catch(() => {})
        setAborting(null)
        load()
      },
    })
  }

  const handlePause = async (pid, e) => {
    e.stopPropagation()
    setPausing(pid)
    await fetch(`/api/projects/${pid}/pause`, { method: 'POST' }).catch(() => {})
    setPausing(null)
    load()
  }

  const handleResume = async (pid, e) => {
    e.stopPropagation()
    setResuming(pid)
    await fetch(`/api/projects/${pid}/resume`, { method: 'POST' }).catch(() => {})
    setResuming(null)
    load()
  }

  const sorted = [...projects].sort((a, b) => Number(b.pid) - Number(a.pid))

  return (
    <div>
      <button
        className="btn back-link"
        onClick={() => navigate('/workflow-projects')}
        style={{ marginBottom: 16, fontSize: 12, padding: '4px 10px' }}
      >
        ← Workflow Projects
      </button>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <h1 className="page-title">Clone Workflow Projects</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Auto Refresh</span>
          <select
            value={autoRefreshMs}
            onChange={e => setAutoRefreshMs(Number(e.target.value))}
            style={{ fontSize: 12, padding: '3px 6px' }}
          >
            {CW_REFRESH_OPTIONS.map(o => (
              <option key={o.ms} value={o.ms}>{o.label}</option>
            ))}
          </select>
          <button className="btn" onClick={() => { setShowScheduler(v => !v); setSchedSaved(false); setSchedErr('') }}
            title="Scheduler settings (run timeout, stale threshold)"
            style={{ fontSize: 12, padding: '5px 12px' }}>
            ⏱ Scheduler
          </button>
        </div>
      </div>

      {showScheduler && (
        <div style={{ margin: '12px 0 0 0', padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Scheduler Settings</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>— scheduler_config.xlsx</span>
            </div>
            <button className="btn" onClick={saveSchedulerSettings} disabled={schedSaving}
              style={{ fontSize: 12, padding: '4px 14px' }}>
              {schedSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {schedSettings.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No settings found.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '4px 10px 6px 0', color: 'var(--text-muted)', fontWeight: 500, borderBottom: '1px solid var(--border)', width: '22%' }}>Key</th>
                  <th style={{ textAlign: 'left', padding: '4px 10px 6px 0', color: 'var(--text-muted)', fontWeight: 500, borderBottom: '1px solid var(--border)', width: '14%' }}>Value</th>
                  <th style={{ textAlign: 'left', padding: '4px 0 6px 0',    color: 'var(--text-muted)', fontWeight: 500, borderBottom: '1px solid var(--border)' }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {schedSettings.map((s, i) => (
                  <tr key={s.key}>
                    <td style={{ padding: '5px 10px 5px 0', fontFamily: 'Consolas, monospace', color: 'var(--text)' }}>{s.key}</td>
                    <td style={{ padding: '5px 10px 5px 0' }}>
                      <input
                        value={s.value}
                        onChange={e => {
                          const next = schedSettings.map((x, j) => j === i ? { ...x, value: e.target.value } : x)
                          setSchedSettings(next); setSchedSaved(false)
                        }}
                        style={{ width: '100%', padding: '3px 7px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontFamily: 'Consolas, monospace' }}
                      />
                    </td>
                    <td style={{ padding: '5px 0', color: 'var(--text-muted)', fontSize: 11 }}>{s.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {schedSaved && <div style={{ marginTop: 8, fontSize: 12, color: '#4caf50' }}>✓ Saved</div>}
          {schedErr  && <div style={{ marginTop: 8, fontSize: 12, color: '#f44336' }}>{schedErr}</div>}
        </div>
      )}

      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center',
        borderBottom: '2px solid var(--border)',
        marginTop: 14, marginBottom: 0,
      }}>
        {TABS.map(tab => {
          const active = tab === activeTab
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                all: 'unset', cursor: 'pointer',
                padding: '8px 18px',
                fontSize: 13, fontWeight: active ? 700 : 500,
                color: active ? 'var(--primary)' : 'var(--text-muted)',
                borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
                marginBottom: -2,
                transition: 'color 0.15s',
              }}
            >
              {tab}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'Payor' && (
        <>
          {/* Tab toolbar: New Workflow left, Configure Workflow right */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' }}>
            <button className="btn btn-primary" onClick={() => navigate('/clone-projects/new')}>+ New Workflow</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => setShowCompare(v => !v)}>≡ Compare Runs</button>
              <button className="btn" onClick={() => setShowCfgWf(true)}>⚙ Configure Workflow</button>
            </div>
          </div>
          <HealthStrip />
          {loading ? (
            <div className="center"><span className="spinner" /></div>
          ) : sorted.length === 0 ? (
          <div className="empty">
            <h3>No projects yet</h3>
            <p>Click <strong>+ New Workflow</strong> to start your first workflow.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>PID</th>
                  <th>Ticket</th>
                  <th>Release Branch Version</th>
                  <th>Payor Release Version</th>
                  <th>Stages</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(p => (
                  <tr key={p.pid} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${p.pid}`)}>
                    <td><strong>{p.pid}</strong></td>
                    <td>
                      {jiraBaseUrl && p.ticket ? (
                        <a href={`${jiraBaseUrl}/browse/${p.ticket}`} target="_blank" rel="noreferrer"
                           onClick={e => e.stopPropagation()}
                           style={{ color: 'var(--primary)', fontWeight: 500, textDecoration: 'none' }}>
                          {p.ticket}
                        </a>
                      ) : (
                        <span style={{ color: 'var(--primary)', fontWeight: 500 }}>{p.ticket}</span>
                      )}
                    </td>
                    <td className="mono">{p.release_branch || '—'}</td>
                    <td className="mono">{p.payor_version || '—'}</td>
                    <td style={{ minWidth: 100 }}>
                      <div style={{ fontSize: 12, marginBottom: 3 }}>
                        <span style={{ fontWeight: 500 }}>{p.completed_stages || 0}</span>
                        <span style={{ color: 'var(--text-muted)' }}>/{p.total_stages || 0}</span>
                      </div>
                      {(p.total_stages || 0) > 0 && (
                        <div style={{ background: 'var(--border)', borderRadius: 3, height: 4, overflow: 'hidden' }}>
                          <div style={{
                            width: `${Math.round(((p.completed_stages || 0) / p.total_stages) * 100)}%`,
                            height: '100%',
                            background: p.status === 'Completed' ? '#4caf50' : 'var(--primary)',
                            borderRadius: 3,
                            transition: 'width 0.3s',
                          }} />
                        </div>
                      )}
                    </td>
                    <td><StatusBadge status={p.status} /></td>
                    <td className="mono">{(p.created_at || '').slice(0, 16)}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="flex-gap">
                        {p.status === 'In Progress' ? (
                          <>
                            <button
                              className="btn btn-sm"
                              style={{ background: 'var(--border)', color: 'var(--text)' }}
                              disabled={pausing === p.pid}
                              onClick={e => handlePause(p.pid, e)}
                            >{pausing === p.pid ? '…' : '⏸'}</button>
                            <button
                              className="btn btn-sm btn-danger"
                              disabled={aborting === p.pid}
                              onClick={e => handleAbort(p.pid, e)}
                            >{aborting === p.pid ? 'Aborting…' : '■ Abort'}</button>
                          </>
                        ) : p.status === 'Paused' ? (
                          <>
                            <button
                              className="btn btn-sm btn-primary"
                              disabled={resuming === p.pid}
                              onClick={e => handleResume(p.pid, e)}
                            >{resuming === p.pid ? '…' : '▶ Resume'}</button>
                            <button
                              className="btn btn-sm btn-danger"
                              disabled={aborting === p.pid}
                              onClick={e => handleAbort(p.pid, e)}
                            >{aborting === p.pid ? 'Aborting…' : '■ Abort'}</button>
                          </>
                        ) : (
                          <button
                            className="btn btn-sm btn-primary"
                            disabled={executing === p.pid || p.status === 'Aborted'}
                            onClick={e => { e.stopPropagation(); handleExecute(p.pid) }}
                          >{executing === p.pid ? '…' : '▶ Execute'}</button>
                        )}
                        <button className="btn btn-sm" onClick={() => navigate(`/projects/${p.pid}`)}>View</button>
                        <button
                          className="btn btn-sm btn-danger"
                          disabled={deleting === p.pid || p.status === 'In Progress'}
                          onClick={e => handleDelete(p.pid, p.ticket, e)}
                        >{deleting === p.pid ? '…' : 'Delete'}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {showCompare && <ComparePanel onClose={() => setShowCompare(false)} />}
        </>
      )}

      {activeTab === 'Stats' && <StatsPanel />}

      {showCfgWf && <ConfigureWorkflowModal onClose={() => setShowCfgWf(false)} />}
      {confirmDlg && (
        <ConfirmDialog
          title={confirmDlg.title}
          message={confirmDlg.message}
          confirmLabel={confirmDlg.confirmLabel}
          onConfirm={confirmDlg.onConfirm}
          onCancel={() => setConfirmDlg(null)}
        />
      )}
    </div>
  )
}
