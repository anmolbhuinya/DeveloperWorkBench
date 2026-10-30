import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

const API = '/api/tools/m2-repo'

function fmtSize(bytes) {
  if (bytes == null) return '—'
  if (bytes === 0) return '0 B'
  if (bytes < 1024)                return `${bytes} B`
  if (bytes < 1024 * 1024)         return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function toGb(bytes) {
  return bytes / (1024 * 1024 * 1024)
}

const LEVEL_META = {
  warn_70:   { color: '#e6a817', bg: 'rgba(230,168,23,0.08)',  border: 'rgba(230,168,23,0.35)',  icon: '⚠',  text: '70% of median — consider cleaning soon' },
  warn_80:   { color: '#ff9800', bg: 'rgba(255,152,0,0.08)',   border: 'rgba(255,152,0,0.35)',   icon: '⚠',  text: '80% of median — cleaning recommended' },
  alert_90:  { color: '#f44336', bg: 'rgba(244,67,54,0.08)',   border: 'rgba(244,67,54,0.35)',   icon: '🔴', text: '90% of median — clean now (Windows alert shown)' },
  alert_100: { color: '#b71c1c', bg: 'rgba(183,28,28,0.10)',   border: 'rgba(183,28,28,0.45)',   icon: '🔴', text: '100%+ of median — clean immediately (Windows alert shown)' },
}

/* ── SVG bar chart ──────────────────────────────────────────────────────── */
function CleanHistoryChart({ history, currentBytes, medianBytes }) {
  if (!history?.length && currentBytes == null) return null

  const W = 560, H = 180, PAD_L = 46, PAD_R = 12, PAD_T = 14, PAD_B = 30
  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B

  // Build data points: history cleans + optional current bar
  const bars = history.map((rec, i) => ({ label: rec.timestamp.slice(0, 10), bytes: rec.size_bytes, current: false }))
  if (currentBytes != null) {
    bars.push({ label: 'Now', bytes: currentBytes, current: true })
  }

  const maxBytes = Math.max(...bars.map(b => b.bytes), medianBytes ?? 0, 1)
  const barW  = Math.min(36, (innerW / (bars.length + 1)) - 6)
  const gap   = (innerW - barW * bars.length) / (bars.length + 1)

  const yScale = v => innerH - (v / maxBytes) * innerH
  const yTick  = v => PAD_T + yScale(v)
  const xBar   = i => PAD_L + gap + i * (barW + gap)

  // Y axis ticks: 0, 25%, 50%, 75%, 100%
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * maxBytes)

  const medianY = medianBytes != null ? yTick(medianBytes) : null

  const levelColor = (bytes) => {
    if (!medianBytes) return 'var(--primary, #4a90e2)'
    const pct = (bytes / medianBytes) * 100
    if (pct >= 100) return '#b71c1c'
    if (pct >= 90)  return '#f44336'
    if (pct >= 80)  return '#ff9800'
    if (pct >= 70)  return '#e6a817'
    return 'var(--primary, #4a90e2)'
  }

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      {/* Y axis ticks & gridlines */}
      {ticks.map((v, i) => (
        <g key={i}>
          <line x1={PAD_L} y1={yTick(v)} x2={W - PAD_R} y2={yTick(v)}
            stroke="var(--border, #333)" strokeWidth={0.5} strokeDasharray="3 3" />
          <text x={PAD_L - 4} y={yTick(v) + 4} textAnchor="end"
            fill="var(--text-muted, #888)" fontSize={9}>
            {toGb(v) < 0.01 ? '0' : `${toGb(v).toFixed(1)}G`}
          </text>
        </g>
      ))}

      {/* Median line */}
      {medianY != null && (
        <>
          <line x1={PAD_L} y1={medianY} x2={W - PAD_R} y2={medianY}
            stroke="#4caf50" strokeWidth={1.5} strokeDasharray="6 4" />
          <text x={W - PAD_R + 2} y={medianY + 4} fill="#4caf50" fontSize={9}>med</text>
        </>
      )}

      {/* Bars */}
      {bars.map((bar, i) => {
        const x = xBar(i)
        const bh = Math.max(1, (bar.bytes / maxBytes) * innerH)
        const y  = PAD_T + innerH - bh
        const color = bar.current ? '#7e57c2' : levelColor(bar.bytes)
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={bh} fill={color} rx={2} opacity={0.85} />
            <text x={x + barW / 2} y={H - PAD_B + 12} textAnchor="middle"
              fill="var(--text-muted, #888)" fontSize={8.5}>
              {bar.current ? 'Now' : bar.label.slice(5)}
            </text>
            {bar.bytes > 0 && bh > 16 && (
              <text x={x + barW / 2} y={y + 11} textAnchor="middle"
                fill="#fff" fontSize={8} fontWeight="600">
                {toGb(bar.bytes).toFixed(1)}
              </text>
            )}
          </g>
        )
      })}

      {/* X axis line */}
      <line x1={PAD_L} y1={PAD_T + innerH} x2={W - PAD_R} y2={PAD_T + innerH}
        stroke="var(--border, #333)" strokeWidth={1} />
    </svg>
  )
}

/* ── settings.xml modal ─────────────────────────────────────────────────── */
function SettingsXmlModal({ onClose }) {
  const [loading, setLoading] = useState(true)
  const [data, setData]       = useState(null)
  const [err, setErr]         = useState('')

  useEffect(() => {
    fetch(`${API}/settings-xml`)
      .then(r => r.json())
      .then(d => { if (d.ok) setData(d); else setErr(d.error || 'Failed to load') })
      .catch(() => setErr('Request failed'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: 'var(--surface, #1a1a1a)', border: '1px solid var(--border)',
        borderRadius: 8, width: '100%', maxWidth: 720, maxHeight: '80vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid var(--border)',
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>settings.xml</div>
            {data?.path && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'monospace' }}>{data.path}</div>}
          </div>
          <button className="btn btn-sm" onClick={onClose} style={{ fontSize: 12 }}>✕ Close</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
          {loading && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>}
          {err && <div style={{ color: '#f44336', fontSize: 13 }}>{err}</div>}
          {data?.content && (
            <pre style={{
              margin: 0, fontSize: 12, fontFamily: 'Consolas, monospace',
              color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              lineHeight: 1.6,
            }}>
              {data.content}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Main page ──────────────────────────────────────────────────────────── */
export default function M2RepoCleanerPage() {
  const navigate = useNavigate()

  const [configPath,   setConfigPath]   = useState('')
  const [editPath,     setEditPath]     = useState('')
  const [configSaving, setConfigSaving] = useState(false)
  const [configSaved,  setConfigSaved]  = useState(false)
  const [configErr,    setConfigErr]    = useState('')
  const [showConfig,   setShowConfig]   = useState(false)

  const [stats,     setStats]     = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const [confirm,     setConfirm]     = useState(false)
  const [cleaning,    setCleaning]    = useState(false)
  const [cleanResult, setCleanResult] = useState(null)
  const [cleanErr,    setCleanErr]    = useState('')

  // HealthEdge version browser
  const [heScan,        setHeScan]        = useState(null)
  const [heScanning,    setHeScanning]    = useState(false)
  const [heScanErr,     setHeScanErr]     = useState('')
  const [heMaxDepth,    setHeMaxDepth]    = useState(3)
  const [heSelected,    setHeSelected]    = useState(new Set())
  const [heConfirm,     setHeConfirm]     = useState(false)
  const [heCleaning,    setHeCleaning]    = useState(false)
  const [heCleanResult, setHeCleanResult] = useState(null)
  const [heCleanErr,    setHeCleanErr]    = useState('')

  const loadStats = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true)
    try {
      const r = await fetch(`${API}/stats`)
      const d = await r.json()
      if (d.ok) setStats(d)
    } catch {}
    if (showSpinner) setRefreshing(false)
  }, [])

  useEffect(() => {
    fetch(`${API}/config`)
      .then(r => r.json())
      .then(d => { if (d.ok) { setConfigPath(d.path); setEditPath(d.path) } })
      .catch(() => {})
    loadStats()
  }, [loadStats])

  const scanHe = async () => {
    setHeScanning(true); setHeScanErr(''); setHeScan(null)
    setHeSelected(new Set()); setHeCleanResult(null); setHeCleanErr('')
    try {
      const r = await fetch(`${API}/healthedge-scan?max_depth=${heMaxDepth}`)
      const d = await r.json()
      if (d.ok) setHeScan(d)
      else setHeScanErr(d.error || 'Scan failed')
    } catch { setHeScanErr('Request failed') }
    setHeScanning(false)
  }

  const cleanHeVersions = async () => {
    setHeCleaning(true); setHeCleanErr(''); setHeCleanResult(null); setHeConfirm(false)
    try {
      const r = await fetch(`${API}/clean-versions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version_labels: [...heSelected], max_depth: heMaxDepth }),
      })
      const d = await r.json()
      if (d.ok) { setHeCleanResult(d); setHeSelected(new Set()); await scanHe() }
      else setHeCleanErr(d.error || 'Delete failed')
    } catch { setHeCleanErr('Request failed') }
    setHeCleaning(false)
  }

  const toggleHeVersion = (label) => setHeSelected(prev => {
    const next = new Set(prev); next.has(label) ? next.delete(label) : next.add(label); return next
  })

  const saveConfig = async () => {
    setConfigSaving(true); setConfigErr(''); setConfigSaved(false)
    try {
      const r = await fetch(`${API}/config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: editPath }),
      })
      const d = await r.json()
      if (d.ok) { setConfigPath(editPath); setConfigSaved(true) }
      else setConfigErr(d.error || 'Save failed')
    } catch { setConfigErr('Request failed') }
    setConfigSaving(false)
  }

  const clean = async () => {
    setCleaning(true); setCleanErr(''); setCleanResult(null); setConfirm(false)
    try {
      const body = stats?.last_scan?.size_bytes != null ? { size_bytes: stats.last_scan.size_bytes } : {}
      const r = await fetch(`${API}/clean`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      if (d.ok) { setCleanResult(d); await loadStats() }
      else setCleanErr(d.error || 'Clean failed')
    } catch { setCleanErr('Request failed') }
    setCleaning(false)
  }

  const level       = stats?.warning_level
  const levelMeta   = level ? LEVEL_META[level] : null
  const currentSize = stats?.last_scan?.size_bytes
  const medianSize  = stats?.median_bytes
  const pct         = stats?.pct_of_median
  const pathChanged = editPath !== configPath

  return (
    <div style={{ padding: '24px 28px', maxWidth: 740 }}>
      {showSettings && <SettingsXmlModal onClose={() => setShowSettings(false)} />}

      <button className="btn back-link" onClick={() => navigate('/developer-tools')}
        style={{ marginBottom: 16, fontSize: 12, padding: '4px 10px' }}>
        ← Tools
      </button>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--text-primary, #111)' }}>
            M2 Repo Cleaner
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            {configPath || 'Maven local repository cache'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {currentSize != null && (
            <span style={{
              fontSize: 22, fontWeight: 800,
              color: levelMeta ? levelMeta.color : 'var(--text)',
            }}>
              {fmtSize(currentSize)}
            </span>
          )}
          <button className="btn btn-sm" onClick={() => loadStats(true)} disabled={refreshing}
            style={{ fontSize: 12 }}>
            {refreshing ? '…' : '↻ Refresh'}
          </button>
          <button className="btn btn-sm" onClick={() => setShowSettings(true)}
            style={{ fontSize: 12 }}>
            📄 settings.xml
          </button>
          <button className="btn btn-sm" onClick={() => setShowConfig(v => !v)}
            style={{ fontSize: 12 }}>
            ⚙ Config
          </button>
        </div>
      </div>

      {/* ── Config (collapsible) ────────────────────────────────────────── */}
      {showConfig && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Repository Path</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={editPath} onChange={e => { setEditPath(e.target.value); setConfigSaved(false) }}
              onKeyDown={e => e.key === 'Enter' && pathChanged && saveConfig()}
              style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}
              placeholder="e.g. C:\Users\you\.m2\repository" />
            <button className="btn btn-primary" onClick={saveConfig}
              disabled={configSaving || !pathChanged} style={{ whiteSpace: 'nowrap' }}>
              {configSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {configSaved && <div style={{ color: '#4caf50', fontSize: 12, marginTop: 6 }}>✓ Saved</div>}
          {configErr   && <div style={{ color: '#f44336', fontSize: 12, marginTop: 6 }}>{configErr}</div>}
        </div>
      )}

      {/* ── Warning banner ──────────────────────────────────────────────── */}
      {levelMeta && (
        <div style={{
          padding: '10px 14px', borderRadius: 6, marginBottom: 16,
          background: levelMeta.bg, border: `1px solid ${levelMeta.border}`,
          display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 16, lineHeight: 1.4 }}>{levelMeta.icon}</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: levelMeta.color }}>{levelMeta.text}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
              Current: <strong>{fmtSize(currentSize)}</strong>
              {medianSize != null && <> &nbsp;·&nbsp; Median: <strong>{fmtSize(medianSize)}</strong></>}
              {pct != null && <> &nbsp;·&nbsp; {pct.toFixed(1)}% of median</>}
            </div>
          </div>
        </div>
      )}

      {/* ── Dashboard ───────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>Repository Usage</div>

        {/* Stat pills */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          {[
            { label: 'Current Size',  value: fmtSize(currentSize),  color: levelMeta?.color },
            { label: 'Median (10 cleans)', value: fmtSize(medianSize) },
            { label: 'Usage %',       value: pct != null ? `${pct.toFixed(1)}%` : stats?.history?.length < 10 ? `${stats?.history?.length ?? 0}/10 cleans` : '—' },
          ].map(s => (
            <div key={s.label} style={{
              padding: '8px 18px', borderRadius: 8, background: 'var(--surface2)',
              border: '1px solid var(--border)', textAlign: 'center', minWidth: 110,
            }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.color ?? 'var(--primary)' }}>{s.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Chart */}
        {(stats?.history?.length > 0 || currentSize != null) ? (
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
              Clean history
              <span style={{ marginLeft: 12 }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, background: '#4caf50', borderRadius: 1, marginRight: 4, verticalAlign: 'middle' }} />
                Median
              </span>
              <span style={{ marginLeft: 8 }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, background: '#7e57c2', borderRadius: 1, marginRight: 4, verticalAlign: 'middle' }} />
                Current
              </span>
            </div>
            <CleanHistoryChart
              history={stats?.history ?? []}
              currentBytes={currentSize}
              medianBytes={medianSize}
            />
          </div>
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            No data yet — repository has not been scanned or cleaned.
          </div>
        )}
      </div>

      {/* ── Clean History table ──────────────────────────────────────────── */}
      {stats?.history?.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
            Clean History
            <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>
              ({stats.history.length}/10)
            </span>
            {stats.history.length < 10 && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>
                — {10 - stats.history.length} more needed for threshold alerts
              </span>
            )}
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--surface2)' }}>
                  <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontWeight: 600 }}>#</th>
                  <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontWeight: 600 }}>Cleaned At</th>
                  <th style={{ textAlign: 'right', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontWeight: 600 }}>Size at Clean</th>
                </tr>
              </thead>
              <tbody>
                {[...stats.history].reverse().map((rec, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '5px 10px', color: 'var(--text-muted)' }}>{stats.history.length - i}</td>
                    <td style={{ padding: '5px 10px', fontFamily: 'monospace' }}>{rec.timestamp}</td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 600 }}>{fmtSize(rec.size_bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── HealthEdge Versions ─────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>HealthEdge Artifacts by Version</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              com/healthedge — grouped by version for bulk deletion
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              Max depth
            </label>
            <input
              type="number" min={1} max={10} value={heMaxDepth}
              onChange={e => setHeMaxDepth(Math.max(1, Math.min(10, parseInt(e.target.value) || 3)))}
              style={{ width: 52, fontFamily: 'monospace', fontSize: 12, padding: '4px 6px', textAlign: 'center' }}
            />
            <button className="btn btn-primary" onClick={scanHe} disabled={heScanning}
              style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              {heScanning
                ? <><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />Scanning…</>
                : '🔍 Scan Versions'}
            </button>
          </div>
        </div>

        {heScanErr && <div className="alert alert-error" style={{ marginBottom: 10 }}>{heScanErr}</div>}

        {heCleanResult && (
          <div style={{
            color: '#2e7d32', fontSize: 13, marginBottom: 12,
            padding: '10px 14px', background: 'rgba(46,125,50,0.06)',
            border: '1px solid rgba(46,125,50,0.3)', borderRadius: 6,
          }}>
            ✓ Deleted {heCleanResult.deleted} artifact folder{heCleanResult.deleted !== 1 ? 's' : ''}.
            {heCleanResult.errors?.length > 0 && (
              <span style={{ marginLeft: 8, color: '#e65100' }}>
                {heCleanResult.errors.length} error{heCleanResult.errors.length !== 1 ? 's' : ''}.
              </span>
            )}
          </div>
        )}
        {heCleanErr && <div className="alert alert-error" style={{ marginBottom: 10 }}>{heCleanErr}</div>}

        {heScan && (
          <>
            {/* Toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {heScan.versions.length} version{heScan.versions.length !== 1 ? 's' : ''} &nbsp;·&nbsp; {fmtSize(heScan.total_size_bytes)} total
              </div>
              {heSelected.size > 0 && !heConfirm && (
                <button
                  onClick={() => setHeConfirm(true)}
                  style={{
                    padding: '5px 14px', fontSize: 12, fontWeight: 600,
                    background: '#c62828', color: '#fff',
                    border: 'none', borderRadius: 5, cursor: 'pointer',
                  }}>
                  🗑 Delete Selected ({heSelected.size})
                </button>
              )}
            </div>

            {/* Confirmation */}
            {heConfirm && (
              <div style={{
                padding: '14px', background: 'rgba(198,40,40,0.05)',
                border: '1px solid rgba(198,40,40,0.35)', borderRadius: 6, marginBottom: 12,
              }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#c62828', marginBottom: 6 }}>
                  ⚠ Delete all artifacts for: {[...heSelected].join(', ')}?
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                  This will remove every artifact folder under com/healthedge matching these versions. Maven will re-download on next build.
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={cleanHeVersions} disabled={heCleaning}
                    style={{ padding: '6px 16px', fontSize: 12, fontWeight: 600, background: '#c62828', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                    {heCleaning ? 'Deleting…' : 'Yes, Delete'}
                  </button>
                  <button className="btn" onClick={() => setHeConfirm(false)} disabled={heCleaning}>Cancel</button>
                </div>
              </div>
            )}

            {/* Version rows */}
            <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              {heScan.versions.map((ver, i) => {
                const isSelected = heSelected.has(ver.label)
                const displayVer = ver.label.replace(/-(SNAPSHOT|RELEASE|RC\d*|BETA\d*|ALPHA\d*)$/i, '')
                return (
                  <div key={ver.label} style={{
                    display: 'grid', gridTemplateColumns: '28px 1fr auto auto',
                    gap: '0 12px', alignItems: 'center', padding: '10px 14px',
                    background: isSelected ? 'rgba(74,144,226,0.07)' : 'var(--surface2)',
                    borderBottom: i < heScan.versions.length - 1 ? '1px solid var(--border)' : 'none',
                    cursor: 'pointer',
                  }} onClick={() => toggleHeVersion(ver.label)}>
                    <input type="checkbox" checked={isSelected}
                      onChange={() => toggleHeVersion(ver.label)}
                      onClick={e => e.stopPropagation()} style={{ cursor: 'pointer' }} />
                    <span style={{ fontWeight: 700, fontSize: 14, fontFamily: 'monospace', color: 'var(--text)' }}>
                      {displayVer}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                      {fmtSize(ver.total_size_bytes)}
                    </span>
                    <button
                      onClick={e => { e.stopPropagation(); setHeSelected(new Set([ver.label])); setHeConfirm(true) }}
                      disabled={heCleaning}
                      style={{
                        padding: '4px 10px', fontSize: 12, background: 'transparent',
                        color: '#c62828', border: '1px solid rgba(198,40,40,0.4)',
                        borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap',
                      }}>
                      🗑 Delete
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {!heScan && !heScanErr && !heScanning && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Click <strong>Scan Versions</strong> to browse HealthEdge artifacts grouped by version.
          </div>
        )}
      </div>

      {/* ── Clean ───────────────────────────────────────────────────────── */}
      <div className="card">
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Clean Repository</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
          Removes all cached artifacts from the M2 repository. The folder itself is preserved.
        </div>

        {cleanResult && (
          <div style={{
            color: '#2e7d32', fontSize: 13, marginBottom: 14,
            padding: '10px 14px', background: 'rgba(46,125,50,0.06)',
            border: '1px solid rgba(46,125,50,0.3)', borderRadius: 6,
          }}>
            ✓ Cleaned — {cleanResult.deleted} item{cleanResult.deleted !== 1 ? 's' : ''} removed
            {cleanResult.size_before_bytes > 0 && ` · freed ${fmtSize(cleanResult.size_before_bytes)}`}.
            {cleanResult.errors?.length > 0 && (
              <div style={{ marginTop: 6, color: '#e65100', fontSize: 12 }}>
                {cleanResult.errors.length} error{cleanResult.errors.length !== 1 ? 's' : ''}:
                {cleanResult.errors.slice(0, 5).map((e, i) => <div key={i} style={{ fontFamily: 'monospace', fontSize: 11 }}>{e}</div>)}
              </div>
            )}
          </div>
        )}
        {cleanErr && <div className="alert alert-error" style={{ marginBottom: 14 }}>{cleanErr}</div>}

        {!confirm ? (
          <button
            onClick={() => setConfirm(true)}
            disabled={cleaning}
            style={{
              padding: '8px 24px', fontSize: 13, fontWeight: 600,
              background: '#c62828', color: '#fff',
              border: 'none', borderRadius: 6, cursor: cleaning ? 'default' : 'pointer',
              opacity: cleaning ? 0.6 : 1,
            }}>
            🗑 Clean M2 Repository
          </button>
        ) : (
          <div style={{
            padding: '16px', background: 'rgba(198,40,40,0.05)',
            border: '1px solid rgba(198,40,40,0.35)', borderRadius: 6,
          }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#c62828', marginBottom: 6 }}>
              ⚠ Confirm Repository Clean
            </div>
            <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>
              This will permanently delete all artifacts from:
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text)', marginBottom: 10, padding: '6px 10px', background: 'var(--surface2)', borderRadius: 4 }}>
              {configPath}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
              Maven will re-download dependencies on the next build. This action cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={clean}
                disabled={cleaning}
                style={{
                  padding: '7px 20px', fontSize: 13, fontWeight: 600,
                  background: '#c62828', color: '#fff',
                  border: 'none', borderRadius: 5, cursor: 'pointer',
                }}>
                {cleaning ? 'Cleaning…' : 'Yes, Clean Repository'}
              </button>
              <button className="btn" onClick={() => setConfirm(false)} disabled={cleaning}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
