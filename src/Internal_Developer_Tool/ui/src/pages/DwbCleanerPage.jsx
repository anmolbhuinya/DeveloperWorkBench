import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

const API = '/api/tools/dwb-cleaner'

function fmtSize(b) {
  if (b == null) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`
  return `${(b / 1073741824).toFixed(2)} GB`
}

// DWB Cleaner: housekeeping for the Developer WorkBench itself. Task 1: build / deploy run logs.
export default function DwbCleanerPage() {
  const navigate = useNavigate()
  const [scan, setScan] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)

  const load = useCallback(() => {
    setErr(null)
    fetch(`${API}/scan`).then(r => r.json())
      .then(d => d.ok ? setScan(d) : setErr(d.error || 'Scan failed'))
      .catch(() => setErr('Could not reach server'))
  }, [])
  useEffect(() => { load() }, [load])

  function clearLogs() {
    if (!window.confirm('Delete the logs of all finished builds / deploys?\nBuilds that are still running are kept.')) return
    setBusy(true); setMsg(null); setErr(null)
    fetch(`${API}/run-logs/clear`, { method: 'POST' }).then(r => r.json())
      .then(d => {
        if (d.ok) setMsg(`Removed ${d.removed} file${d.removed === 1 ? '' : 's'}, freed ${fmtSize(d.freed_bytes)}` + (d.kept_running ? ` (${d.kept_running} running job${d.kept_running > 1 ? 's' : ''} kept)` : ''))
        else setErr(d.error || 'Clear failed')
        load()
      })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setBusy(false))
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button className="btn" onClick={() => navigate('/developer-tools')}>← Tools</button>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--text)' }}>🧹 DWB Cleaner</h1>
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Build &amp; deploy run logs</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          Every build / module deploy keeps its output so it survives a Workbench restart. Large logs slow the Workbench start; clear them when you no longer need the old output.
        </div>
        {scan ? (
          <>
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginBottom: 12, fontSize: 13 }}>
              <div><div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Size</div><b style={{ fontSize: 18 }}>{fmtSize(scan.total_bytes)}</b></div>
              <div><div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Files</div><b style={{ fontSize: 18 }}>{scan.count}</b></div>
              <div><div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Running (kept)</div><b style={{ fontSize: 18 }}>{scan.running}</b></div>
            </div>
            <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{scan.path}</code>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button className="btn btn-danger" disabled={busy || scan.count === scan.running} onClick={clearLogs}>
                {busy ? 'Clearing…' : 'Clear run logs'}
              </button>
              <button className="btn" disabled={busy} onClick={load}>Rescan</button>
            </div>
          </>
        ) : !err && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Scanning…</div>}
        {msg && <div className="alert alert-success" style={{ marginTop: 12 }}>{msg}</div>}
        {err && <div className="alert alert-error" style={{ marginTop: 12 }}>{err}</div>}
      </div>
    </div>
  )
}
