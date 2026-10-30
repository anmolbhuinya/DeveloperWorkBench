import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

function StatusBadge({ status }) {
  const map = {
    'Completed':   'badge badge-success',
    'In Progress': 'badge badge-warning',
    'Paused':      'badge badge-warning',
    'Failed':      'badge badge-danger',
    'Skipped':     'badge badge-skipped',
    'Pending':     'badge badge-pending',
  }
  return <span className={map[status] || 'badge badge-pending'}>{status || 'Pending'}</span>
}

function StageActions({ stage, onUpdate, saving }) {
  const s = stage.status
  return (
    <div className="flex-gap">
      {s !== 'Completed' && (
        <button className="btn btn-sm btn-success" disabled={saving} onClick={() => onUpdate({ status: 'Completed' })}>
          Done
        </button>
      )}
      {s !== 'Skipped' && s !== 'Completed' && (
        <button className="btn btn-sm" disabled={saving} onClick={() => onUpdate({ status: 'Skipped' })}>
          Skip
        </button>
      )}
      {(s === 'Skipped' || s === 'Completed') && (
        <button className="btn btn-sm" disabled={saving} onClick={() => onUpdate({ status: 'Pending' })}>
          Reset
        </button>
      )}
    </div>
  )
}

export default function ProjectDetail() {
  const { pid }    = useParams()
  const navigate   = useNavigate()
  const [data,     setData]     = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState({})
  const [toolPids, setToolPids] = useState({})
  const [dirty,    setDirty]    = useState({})

  const load = useCallback(() => {
    fetch(`/api/projects/${pid}`)
      .then(r => r.json())
      .then(d => {
        setData(d)
        const pids = {}
        ;(d.stages || []).forEach(s => { pids[s.stage_id] = s.tool_pid || '' })
        setToolPids(pids)
        setDirty({})
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [pid])

  useEffect(() => { load() }, [load])

  const patchStage = useCallback(async (stageId, patch) => {
    setSaving(s => ({ ...s, [stageId]: true }))
    await fetch(`/api/projects/${pid}/stages/${stageId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(patch),
    })
    setSaving(s => ({ ...s, [stageId]: false }))
    load()
  }, [pid, load])

  const savePid = (stageId) => {
    patchStage(stageId, { tool_pid: toolPids[stageId] || '' })
    setDirty(d => ({ ...d, [stageId]: false }))
  }

  if (loading) return <div className="center"><span className="spinner" /></div>
  if (!data)   return <div className="empty"><h3>Project not found</h3></div>

  const { project, stages } = data

  return (
    <div>
      <button className="btn back-link" onClick={() => navigate('/')}>← Back</button>

      <div className="page-header">
        <h1 className="page-title">Project #{project.pid} — {project.ticket}</h1>
        <StatusBadge status={project.status} />
      </div>

      <div className="meta">
        {project.payor_version && (
          <div className="meta-item">
            <div className="meta-label">Payor Version</div>
            <div className="meta-value mono" style={{ color: 'var(--text)' }}>{project.payor_version}</div>
          </div>
        )}
        <div className="meta-item">
          <div className="meta-label">Stages</div>
          <div className="meta-value">{project.completed_stages || 0} / {project.total_stages || 0} done</div>
        </div>
        <div className="meta-item">
          <div className="meta-label">Created</div>
          <div className="meta-value mono" style={{ fontSize: 13 }}>{(project.created_at || '').slice(0, 16)}</div>
        </div>
        {project.completed_at && (
          <div className="meta-item">
            <div className="meta-label">Completed</div>
            <div className="meta-value mono" style={{ fontSize: 13 }}>{(project.completed_at || '').slice(0, 16)}</div>
          </div>
        )}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Stage</th>
              <th>Tool</th>
              <th>Tool PID</th>
              <th>Status</th>
              <th>Started</th>
              <th>Completed</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {stages.map(s => (
              <tr key={s.stage_id}>
                <td style={{ fontWeight: 600 }}>{s.stage_id}</td>
                <td style={{ fontWeight: 500 }}>{s.stage_name}</td>
                <td className="mono">{s.tool_command}</td>
                <td>
                  <div className="flex-gap">
                    <input
                      className="pid-input"
                      type="text"
                      value={toolPids[s.stage_id] ?? ''}
                      placeholder="—"
                      onChange={e => {
                        setToolPids(p => ({ ...p, [s.stage_id]: e.target.value }))
                        setDirty(d => ({ ...d, [s.stage_id]: true }))
                      }}
                      onKeyDown={e => e.key === 'Enter' && savePid(s.stage_id)}
                    />
                    {dirty[s.stage_id] && (
                      <button
                        className="btn btn-sm"
                        disabled={saving[s.stage_id]}
                        onClick={() => savePid(s.stage_id)}
                      >{saving[s.stage_id] ? '…' : 'Save'}</button>
                    )}
                  </div>
                </td>
                <td><StatusBadge status={s.status} /></td>
                <td className="mono">{(s.started_at || '').slice(0, 16)}</td>
                <td className="mono">{(s.completed_at || '').slice(0, 16)}</td>
                <td>
                  <StageActions
                    stage={s}
                    saving={!!saving[s.stage_id]}
                    onUpdate={patch => patchStage(s.stage_id, patch)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
