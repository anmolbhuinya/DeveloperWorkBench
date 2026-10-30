import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const FILTERS = [
  { key: 'prb',    label: 'Payor Release Branch', placeholder: 'e.g. master or 26.2.2.0.1', active: true },
  { key: 'c4b',    label: 'C4 Branch',             placeholder: 'e.g. master',               active: false },
  { key: 'domain', label: 'Domain',                placeholder: 'e.g. healthedge_27.1',      active: false },
  { key: 'db',     label: 'DB Platform',           placeholder: 'e.g. Oracle',               active: false },
]

// Status for each VM row during search
function RowStatus({ status }) {
  if (status === 'checking')  return <span style={{ color: 'var(--text-muted)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}><span className="spinner" style={{ width: 12, height: 12 }} /> Checking…</span>
  if (status === 'matched')   return <span className="badge badge-success">✓ Matched</span>
  if (status === 'no-match')  return <span className="badge badge-pending">No match</span>
  if (status === 'error')     return <span className="badge badge-danger">Error</span>
  return null
}

export default function SearchVMsPage() {
  const navigate   = useNavigate()
  const [prb,      setPrb]      = useState('')
  const [error,    setError]    = useState('')
  const [rows,     setRows]     = useState([])   // [{name, ip, description, assigned_to, _status, _parsed, _error}]
  const [searching, setSearching] = useState(false)
  const [searched,  setSearched]  = useState('')

  const search = async () => {
    const val = prb.trim()
    if (!val) { setError('Please enter a Payor Release Branch to search.'); return }
    setError(''); setSearching(true); setSearched(val)

    // 1. Load all developer VMs
    let vms = []
    try {
      const r = await fetch('/api/vms/developer')
      vms = await r.json()
      if (!Array.isArray(vms)) vms = []
    } catch {
      setError('Failed to load VM list.'); setSearching(false); return
    }
    if (vms.length === 0) {
      setRows([]); setSearching(false); return
    }

    // 2. Init all rows as 'checking'
    const init = vms.map(vm => ({ ...vm, _status: 'checking', _parsed: null, _error: null }))
    setRows(init)

    // 3. Fire parallel fetch per VM, update rows as each completes
    await Promise.all(
      vms.map((vm, idx) =>
        fetch(`/api/vms/developer/${encodeURIComponent(vm.name)}/status`)
          .then(r => r.json())
          .then(d => {
            const cb      = (d.parsed || {})['Current branch'] || ''
            const matched = cb.toLowerCase() === val.toLowerCase()
            setRows(prev => prev.map((r, i) =>
              i === idx
                ? { ...r, _status: d.ok ? (matched ? 'matched' : 'no-match') : 'error',
                    _parsed: d.parsed || null, _error: d.error || null }
                : r
            ))
          })
          .catch(err => {
            setRows(prev => prev.map((r, i) =>
              i === idx ? { ...r, _status: 'error', _error: err.message } : r
            ))
          })
      )
    )
    setSearching(false)
  }

  const matched   = rows.filter(r => r._status === 'matched')
  const checking  = rows.filter(r => r._status === 'checking').length
  const hasResults = rows.length > 0

  return (
    <div>
      <button
        className="btn back-link"
        onClick={() => navigate('/manage-dev-vms')}
        style={{ marginBottom: 16, fontSize: 12, padding: '4px 10px' }}
      >
        ← Manage Developer VMs
      </button>

      <div className="page-header" style={{ marginBottom: 20 }}>
        <h1 className="page-title">Search VMs</h1>
      </div>

      {/* Filter form */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '20px 24px', marginBottom: 24, maxWidth: 600 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, color: 'var(--text)' }}>Filters</div>
        {FILTERS.map(f => (
          <div key={f.key} className="form-group" style={{ marginBottom: 14 }}>
            <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {f.label}
              {!f.active && <span className="badge badge-pending" style={{ fontSize: 10 }}>Coming Soon</span>}
            </label>
            <input
              type="text"
              placeholder={f.active ? f.placeholder : 'Not available yet'}
              disabled={!f.active || searching}
              value={f.key === 'prb' ? prb : ''}
              onChange={f.key === 'prb' ? e => { setPrb(e.target.value); setError('') } : undefined}
              onKeyDown={f.active ? (e => e.key === 'Enter' && !searching && search()) : undefined}
              style={{ maxWidth: 380, opacity: f.active ? 1 : 0.5 }}
            />
          </div>
        ))}
        {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}
        <button className="btn btn-primary" onClick={search} disabled={searching || !prb.trim()}>
          {searching ? 'Searching…' : '🔍 Search'}
        </button>
      </div>

      {/* Progress summary */}
      {hasResults && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 16 }}>
          {checking > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="spinner" style={{ width: 12, height: 12 }} />
              Checking {checking} VM{checking !== 1 ? 's' : ''}…
            </span>
          )}
          {checking === 0 && (
            <span>
              <strong style={{ color: matched.length > 0 ? 'var(--success)' : 'var(--text)' }}>{matched.length}</strong>
              {' '}of {rows.length} VM{rows.length !== 1 ? 's' : ''} matched
              {' '}Payor branch <strong>"{searched}"</strong>
            </span>
          )}
        </div>
      )}

      {/* Results table — all VMs with live status */}
      {hasResults && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>IP Address</th>
                <th>Description</th>
                <th>Assigned To</th>
                <th>Status</th>
                <th>Current Branch</th>
                <th>Domain</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.name || i}
                  style={{
                    opacity: r._status === 'no-match' ? 0.45 : 1,
                    background: r._status === 'matched' ? 'rgba(34,197,94,0.05)' : undefined,
                  }}
                >
                  <td style={{ fontWeight: 500, color: r._status === 'matched' ? 'var(--success)' : 'var(--primary)' }}>
                    {r.name || '—'}
                  </td>
                  <td className="mono">{r.ip || '—'}</td>
                  <td>{r.description || '—'}</td>
                  <td>{r.assigned_to || '—'}</td>
                  <td><RowStatus status={r._status} /></td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {r._parsed?.['Current branch']
                      ? <span className={r._status === 'matched' ? 'badge badge-success' : ''}>{r._parsed['Current branch']}</span>
                      : r._status === 'error'
                        ? <span style={{ color: 'var(--danger)', fontSize: 11 }}>{r._error}</span>
                        : '—'}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{r._parsed?.['Domain'] || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
