import { useState } from 'react'

const API = '/api/tools/regression-parity'
const SEGMENTS = [
  ['failing',  'Failing in regression, passing in baseline', '#C62828'],
  ['missing',  'Missing in regression, present in baseline', '#6A1B9A'],
  ['disabled', 'Disabled in regression, enabled in baseline', '#E65100'],
  ['added',    'Newly added in regression', '#2E7D32'],
]
const inp = { fontSize: 13, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', width: '100%', boxSizing: 'border-box' }

export default function RegressionParityPage() {
  const [baseline, setBaseline] = useState('')
  const [regression, setRegression] = useState('')
  const [loading, setLoading] = useState(false)
  const [rep, setRep] = useState(null)
  const [open, setOpen] = useState('failing')

  const check = () => {
    setLoading(true); setRep(null)
    fetch(`${API}/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseline_url: baseline, regression_url: regression }) })
      .then(r => r.json()).then(setRep).catch(e => setRep({ ok: false, error: String(e) }))
      .finally(() => setLoading(false))
  }
  const exportAs = async fmt => {
    const res = await fetch(`${API}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: fmt, report: rep }) })
    if (!res.ok) { alert('Export failed'); return }
    const blob = await res.blob()
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `regression-parity-report.${fmt}`
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const th = { textAlign: 'left', padding: '4px 8px', fontSize: 11, background: 'var(--surface)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
  const td = { padding: '4px 8px', fontSize: 12, borderBottom: '1px solid var(--border)', wordBreak: 'break-all' }
  const tile = (label, value, color) => (
    <div className="card" style={{ minWidth: 170, flex: '1 1 170px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || 'var(--text)' }}>{value}</div>
    </div>
  )

  return (
    <div style={{ padding: '24px 28px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Regression Parity Checker</h1>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 16px' }}>
        Compare the test results of a Jenkins regression job with a baseline job. Use build URLs (a job URL uses its last completed build).
      </div>
      <div className="card" style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'end' }}>
        <label style={{ fontSize: 12, fontWeight: 600 }}>Baseline job URL
          <input style={inp} value={baseline} onChange={e => setBaseline(e.target.value)} placeholder="https://jenkins/job/baseline/123/" />
        </label>
        <label style={{ fontSize: 12, fontWeight: 600 }}>Regression job URL
          <input style={inp} value={regression} onChange={e => setRegression(e.target.value)} placeholder="https://jenkins/job/regression/456/" />
        </label>
        <button className="btn btn-primary" disabled={loading || !baseline.trim() || !regression.trim()} onClick={check}>{loading ? 'Checking…' : 'Check Parity'}</button>
      </div>

      {loading && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}><span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> Reading test reports from Jenkins …</div>}
      {rep && !rep.ok && <div className="alert alert-danger">{rep.error}</div>}
      {rep?.ok && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>Parity report <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)' }}>generated {rep.generated}</span></div>
            {['json', 'html', 'csv', 'xlsx'].map(f => (
              <button key={f} onClick={() => exportAs(f)} style={{ fontSize: 11, padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer' }}>{f.toUpperCase()}</button>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            {tile('Total tests — baseline', rep.baseline.total)}
            {tile('Total tests — regression', rep.regression.total)}
            {SEGMENTS.map(([k, t, c]) => (
              <div key={k} onClick={() => setOpen(k)} style={{ cursor: 'pointer', flex: '1 1 170px', minWidth: 170 }}>
                <div className="card" style={{ outline: open === k ? `2px solid ${c}` : 'none' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: c }}>{rep.totals[k]}</div>
                </div>
              </div>
            ))}
          </div>
          {SEGMENTS.filter(([k]) => k === open).map(([k, t, c]) => (
            <div key={k} className="card">
              <div style={{ fontWeight: 700, fontSize: 13, color: c, borderBottom: `2px solid ${c}`, paddingBottom: 3, marginBottom: 6 }}>{t} ({rep[k].length})</div>
              {rep[k].length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>None</div> : (
                <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 420px)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th}>Class</th><th style={th}>Test case</th><th style={th}>Baseline</th><th style={th}>Regression</th></tr></thead>
                    <tbody>{rep[k].map((e, i) => (
                      <tr key={i}><td style={td}>{e.class}</td><td style={td}>{e.name}</td><td style={td}>{e.baseline || '—'}</td><td style={td}>{e.regression}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
            Baseline: passed {rep.baseline.passed} · failed {rep.baseline.failed} · disabled {rep.baseline.disabled} &nbsp;|&nbsp;
            Regression: passed {rep.regression.passed} · failed {rep.regression.failed} · disabled {rep.regression.disabled}
          </div>
        </>
      )}
    </div>
  )
}
