import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

function StatusBadge({ status }) {
  const map = {
    'Completed':   'badge badge-success',
    'In Progress': 'badge badge-warning',
    'Paused':      'badge badge-warning',
    'Failed':      'badge badge-danger',
  }
  return <span className={map[status] || 'badge badge-pending'}>{status || 'Unknown'}</span>
}

export default function ProjectList() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [deleting, setDeleting] = useState(null)

  const load = useCallback(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(data => { setProjects(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const handleDelete = async (pid, ticket) => {
    if (!window.confirm(`Delete project #${pid} (${ticket})?`)) return
    setDeleting(pid)
    await fetch(`/api/projects/${pid}`, { method: 'DELETE' })
    setDeleting(null)
    load()
  }

  const sorted = [...projects].sort((a, b) => Number(b.pid) - Number(a.pid))

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Clone Workflow Projects</h1>
        <button className="btn btn-primary" onClick={() => navigate('/new')}>+ New Workflow</button>
      </div>

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
                <th>Payor Version</th>
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
                  <td style={{ color: 'var(--primary)', fontWeight: 500 }}>{p.ticket}</td>
                  <td className="mono">{p.payor_version || '—'}</td>
                  <td>
                    <span style={{ fontWeight: 500 }}>{p.completed_stages || 0}</span>
                    <span style={{ color: 'var(--text-muted)' }}>/{p.total_stages || 0}</span>
                  </td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="mono">{(p.created_at || '').slice(0, 16)}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="flex-gap">
                      <button className="btn btn-sm" onClick={() => navigate(`/projects/${p.pid}`)}>View</button>
                      <button
                        className="btn btn-sm btn-danger"
                        disabled={deleting === p.pid}
                        onClick={() => handleDelete(p.pid, p.ticket)}
                      >{deleting === p.pid ? '…' : 'Delete'}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
