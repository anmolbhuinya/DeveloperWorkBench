import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function NewWorkflow() {
  const navigate       = useNavigate()
  const [stages,       setStages]       = useState([])
  const [selected,     setSelected]     = useState({})
  const [ticket,       setTicket]       = useState('')
  const [payorVersion, setPayorVersion] = useState('')
  const [submitting,   setSubmitting]   = useState(false)
  const [error,        setError]        = useState('')

  useEffect(() => {
    fetch('/api/stages')
      .then(r => r.json())
      .then(setStages)
  }, [])

  const toggle = (id) => setSelected(s => ({ ...s, [id]: !s[id] }))

  const needsPayor = stages.some(s => selected[s.id] && s.needs_payor)
  const selectedIds = stages.filter(s => selected[s.id]).map(s => s.id)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!ticket.trim()) { setError('JIRA ticket is required.'); return }
    if (selectedIds.length === 0) { setError('Select at least one stage.'); return }
    if (needsPayor && !payorVersion.trim()) {
      setError('Payor version is required for the selected stages (Baseline / Jenkins Regression).')
      return
    }
    setSubmitting(true)
    try {
      const resp = await fetch('/api/projects', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          ticket:        ticket.trim(),
          payor_version: payorVersion.trim(),
          stage_ids:     selectedIds,
        }),
      })
      if (resp.ok) {
        const { pid } = await resp.json()
        navigate(`/projects/${pid}`)
      } else {
        setError('Failed to create project. Check server logs.')
      }
    } catch {
      setError('Server unreachable.')
    }
    setSubmitting(false)
  }

  return (
    <div>
      <button className="btn back-link" onClick={() => navigate('/')}>← Back</button>
      <h1 className="page-title" style={{ marginBottom: 28 }}>New Clone Workflow</h1>

      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        {/* Parameters */}
        <div className="card">
          <div className="form-section-title">Parameters</div>

          <div className="form-group">
            <label className="field-label">JIRA Ticket <span style={{ color: 'var(--danger)' }}>*</span></label>
            <input
              type="text"
              value={ticket}
              onChange={e => setTicket(e.target.value)}
              placeholder="e.g. PAYOR-12345"
            />
          </div>

          <div className="form-group">
            <label className="field-label">
              Payor Version
              {needsPayor
                ? <span style={{ color: 'var(--danger)' }}> *</span>
                : <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> (required if Baseline or Jenkins Regression selected)</span>
              }
            </label>
            <input
              type="text"
              value={payorVersion}
              onChange={e => setPayorVersion(e.target.value)}
              placeholder="e.g. 26.1.1.1"
            />
          </div>
        </div>

        {/* Stage selection */}
        <div className="card">
          <div className="form-section-title">
            Select Stages
            {selectedIds.length > 0 && (
              <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}>
                {selectedIds.length} selected
              </span>
            )}
          </div>

          {stages.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading stages…</div>
          ) : (
            <div className="stage-grid">
              {stages.map(s => (
                <label
                  key={s.id}
                  className={`stage-item${selected[s.id] ? ' checked' : ''}`}
                  onClick={() => toggle(s.id)}
                >
                  <input
                    type="checkbox"
                    checked={!!selected[s.id]}
                    onChange={() => {}}
                  />
                  <div>
                    <div className="stage-label">{s.label}</div>
                    <div className="stage-tool">{s.tool}</div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex-gap">
          <button type="submit" className="btn btn-primary" disabled={submitting || stages.length === 0}>
            {submitting ? 'Creating…' : 'Create Workflow'}
          </button>
          <button type="button" className="btn" onClick={() => navigate('/')}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
