import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import WorkflowBackButton from '../components/WorkflowBackButton'

const PAYOR_CATS       = ['billing', 'claims', 'enrollment', 'integrations', 'platform', 'provider']
const POLL_INTERVAL_MS = 2 * 60 * 1000   // 2 minutes — matches default monitoring.intervalMinutes

const RPB_REFRESH_KEY  = 'rpb_auto_refresh_ms'
const RPB_REFRESH_OPTS = [
  { label: 'Off',    value: 0        },
  { label: '1 min',  value: 60000    },
  { label: '2 min',  value: 120000   },
  { label: '3 min',  value: 180000   },
  { label: '5 min',  value: 300000   },
  { label: '10 min', value: 600000   },
  { label: '20 min', value: 1200000  },
  { label: '30 min', value: 1800000  },
]

function parseUrls(raw) {
  try { return JSON.parse(raw || '{}') } catch { return {} }
}

// ── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ value, onClick, style }) {
  const v = (value || '').toLowerCase()
  let cls = 'badge badge-pending'
  if (v === 'n/a')                                                               cls = 'badge badge-na'
  else if (['completed', 'done', 'passed'].some(s => v.includes(s)))            cls = 'badge badge-success'
  else if (['failed', 'error', 'aborted'].some(s => v.includes(s)))             cls = 'badge badge-danger'
  else if (['running', 'in progress', 'triggered'].some(s => v.includes(s)))    cls = 'badge badge-warning'

  if (onClick) {
    return (
      <button
        className={cls}
        onClick={onClick}
        style={{ cursor: 'pointer', border: 'none', ...style }}
        title="Click for details"
      >{value || '—'}</button>
    )
  }
  return <span className={cls} style={style}>{value || '—'}</span>
}

// ── Custom VM selector ────────────────────────────────────────────────────────
function VmSelector({ value, onChange, vms, placeholder = '— select VM —' }) {
  const [open,   setOpen]   = useState(false)
  const [dropPos,setDropPos]= useState({ top: 0, left: 0, width: 0, maxH: 320 })
  const triggerRef = useRef(null)
  const dropRef    = useRef(null)
  const selected   = (vms || []).find(v => v.name === value)

  const openDropdown = () => {
    if (!triggerRef.current) return
    const r          = triggerRef.current.getBoundingClientRect()
    const MARGIN     = 8, PREFERRED = 320, MIN_H = 120
    const spaceBelow = window.innerHeight - r.bottom - MARGIN
    const spaceAbove = r.top - MARGIN
    const width      = Math.max(r.width, 400)
    let top, maxH
    if (spaceBelow >= MIN_H) {
      top = r.bottom + 4; maxH = Math.min(PREFERRED, spaceBelow)
    } else if (spaceAbove > spaceBelow) {
      maxH = Math.min(PREFERRED, spaceAbove); top = r.top - 4 - maxH
    } else {
      top = r.bottom + 4; maxH = Math.max(MIN_H, spaceBelow)
    }
    setDropPos({ top, left: r.left, width, maxH })
    setOpen(true)
  }

  useEffect(() => {
    function onDown(e) {
      const inT = triggerRef.current?.contains(e.target)
      const inD = dropRef.current?.contains(e.target)
      if (!inT && !inD) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div style={{ userSelect: 'none' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => open ? setOpen(false) : openDropdown()}
        style={{
          width: '100%', textAlign: 'left', padding: '10px 14px',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 6, cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between', gap: 8,
          transition: 'border-color 0.15s',
          ...(open ? { borderColor: 'var(--primary)' } : {}),
        }}
      >
        {selected ? (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{selected.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              <span className="mono">{selected.ip}</span>
              {selected.assigned_to ? <span style={{ marginLeft: 8 }}>· {selected.assigned_to}</span> : null}
            </div>
          </div>
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{placeholder}</span>
        )}
        <span style={{ color: 'var(--text-muted)', fontSize: 10, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          ref={dropRef}
          style={{
            position: 'fixed', top: dropPos.top, left: dropPos.left, width: dropPos.width,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
            zIndex: 9999, maxHeight: dropPos.maxH, overflowY: 'auto',
          }}
        >
          {(vms || []).length === 0 && (
            <div style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)' }}>No VMs found</div>
          )}
          {(vms || []).map((vm, i) => {
            const isSel = vm.name === value
            return (
              <div
                key={vm.name}
                onMouseDown={() => { onChange(vm.name); setOpen(false) }}
                style={{
                  padding: '12px 16px', cursor: 'pointer',
                  borderBottom: i < vms.length - 1 ? '1px solid var(--border)' : 'none',
                  background: isSel ? 'var(--surface2)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                }}
                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--surface2)' }}
                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{vm.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                    <span className="mono">{vm.ip}</span>
                    {vm.assigned_to && <span style={{ marginLeft: 8 }}>· {vm.assigned_to}</span>}
                    {vm.description && vm.description !== vm.assigned_to &&
                      <span style={{ marginLeft: 8 }}>· user: {vm.description}</span>}
                  </div>
                </div>
                {isSel && <span style={{ color: 'var(--primary)', fontSize: 14, flexShrink: 0 }}>✓</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── VM info card ──────────────────────────────────────────────────────────────
function VmCard({ vmName, vms }) {
  const vm = (vms || []).find(v => v.name === vmName)
  if (!vmName) return <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>No VM assigned</span>
  if (!vm)     return <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{vmName}</span>
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 12,
      padding: '10px 16px', background: 'var(--surface2)',
      border: '1px solid var(--border)', borderRadius: 6,
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
        background: 'var(--primary)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', opacity: 0.85,
      }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>
          {vm.name.charAt(0).toUpperCase()}
        </span>
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{vm.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          <span className="mono">{vm.ip}</span>
          {vm.assigned_to && <span style={{ marginLeft: 8 }}>· {vm.assigned_to}</span>}
        </div>
      </div>
    </div>
  )
}

// ── Baseline editor modal ─────────────────────────────────────────────────────
function BaselineModal({ pid, app, onClose }) {
  const [sheets,      setSheets]      = useState(null)   // { SheetName: [{row_idx,it_class,test_method,known_failure,local_failure}] }
  const [activeSheet, setActiveSheet] = useState(null)
  const [dirty,       setDirty]       = useState({})     // { SheetName: { row_idx: {known_failure,local_failure} } }
  const [saving,      setSaving]      = useState(false)
  const [err,         setErr]         = useState('')
  const [saved,       setSaved]       = useState(false)

  useEffect(() => {
    fetch(`/api/tools/rpb/projects/${pid}/baseline?app=${encodeURIComponent(app)}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setSheets(d.sheets)
          setActiveSheet(Object.keys(d.sheets)[0] || null)
        } else {
          setErr(d.error || 'Failed to load baseline')
        }
      })
      .catch(() => setErr('Could not load baseline'))
  }, [pid, app])

  const toggle = (sheet, rowIdx, field) => {
    setDirty(prev => {
      const sheetDirty = { ...(prev[sheet] || {}) }
      const cur = sheetDirty[rowIdx] || {}
      const original = sheets[sheet].find(r => r.row_idx === rowIdx)
      sheetDirty[rowIdx] = {
        known_failure: cur.known_failure !== undefined ? cur.known_failure : original.known_failure,
        local_failure: cur.local_failure !== undefined ? cur.local_failure : original.local_failure,
        ...cur,
        [field]: !(cur[field] !== undefined ? cur[field] : original[field]),
      }
      return { ...prev, [sheet]: sheetDirty }
    })
  }

  const getVal = (sheet, rowIdx, field) => {
    const overrides = dirty[sheet]?.[rowIdx]
    if (overrides && overrides[field] !== undefined) return overrides[field]
    return sheets[sheet].find(r => r.row_idx === rowIdx)?.[field] ?? false
  }

  const hasDirty = Object.keys(dirty).some(s => Object.keys(dirty[s]).length > 0)

  const save = async () => {
    setSaving(true); setErr(''); setSaved(false)
    const payload = {}
    for (const [sheet, rows] of Object.entries(dirty)) {
      if (!Object.keys(rows).length) continue
      payload[sheet] = Object.entries(rows).map(([ridx, vals]) => ({
        row_idx:      parseInt(ridx),
        known_failure: vals.known_failure,
        local_failure: vals.local_failure,
      }))
    }
    try {
      const r = await fetch(`/api/tools/rpb/projects/${pid}/baseline?app=${encodeURIComponent(app)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheets: payload }),
      })
      const d = await r.json()
      if (d.ok) {
        // Merge dirty into sheets state
        setSheets(prev => {
          const next = { ...prev }
          for (const [sheet, rows] of Object.entries(dirty)) {
            next[sheet] = prev[sheet].map(row => {
              const upd = rows[row.row_idx]
              return upd ? { ...row, ...upd } : row
            })
          }
          return next
        })
        setDirty({})
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } else {
        setErr(d.error || 'Save failed')
      }
    } catch { setErr('Save failed') }
    setSaving(false)
  }

  const sheetNames = sheets ? Object.keys(sheets) : []
  const rows       = activeSheet && sheets ? sheets[activeSheet] : []

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}
        style={{ maxWidth: 960, width: '95vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <span className="modal-title">Baseline — Project #{pid}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 16px', flexWrap: 'wrap' }}>
          {sheetNames.map(s => (
            <button key={s} onClick={() => setActiveSheet(s)} style={{
              padding: '6px 14px', fontSize: 13, background: 'none', border: 'none',
              cursor: 'pointer', fontWeight: activeSheet === s ? 600 : 400,
              color: activeSheet === s ? 'var(--primary)' : 'var(--text-muted)',
              borderBottom: activeSheet === s ? '2px solid var(--primary)' : '2px solid transparent',
              marginBottom: -1,
            }}>{s}</button>
          ))}
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {!sheets ? (
            err ? <div style={{ padding: 20, color: 'var(--danger)' }}>{err}</div>
                : <div className="center"><span className="spinner" /></div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--surface2)', position: 'sticky', top: 0 }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)', width: '45%' }}>IT Class</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)', width: '35%' }}>Test Method</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', borderBottom: '1px solid var(--border)', width: '10%' }}>Known Failure</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', borderBottom: '1px solid var(--border)', width: '10%' }}>Local Failure</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const known = getVal(activeSheet, row.row_idx, 'known_failure')
                  const local = getVal(activeSheet, row.row_idx, 'local_failure')
                  const isDirtyRow = !!(dirty[activeSheet]?.[row.row_idx])
                  return (
                    <tr key={row.row_idx} style={{
                      background: isDirtyRow ? 'color-mix(in srgb, var(--primary) 6%, var(--surface))' : i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)',
                      borderBottom: '1px solid var(--border)',
                    }}>
                      <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 12 }}>{row.it_class}</td>
                      <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 12 }}>{row.test_method}</td>
                      <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                        <input type="checkbox" checked={known}
                          onChange={() => toggle(activeSheet, row.row_idx, 'known_failure')} />
                      </td>
                      <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                        <input type="checkbox" checked={local}
                          onChange={() => toggle(activeSheet, row.row_idx, 'local_failure')} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end' }}>
          {err && <span style={{ color: 'var(--danger)', fontSize: 13, flex: 1 }}>{err}</span>}
          {saved && <span style={{ color: 'var(--success, #2da44e)', fontSize: 13, flex: 1 }}>Saved</span>}
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn btn-primary" disabled={!hasDirty || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Report summary modal ──────────────────────────────────────────────────────
function ReportSummaryModal({ pid, app, onClose }) {
  const [data,    setData]    = useState(null)
  const [err,     setErr]     = useState('')
  const [version, setVersion] = useState('')

  useEffect(() => {
    fetch(`/api/tools/rpb/projects/${pid}/report-summary?app=${encodeURIComponent(app)}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setData(d); setVersion(d.version || '') }
        else setErr(d.error || 'Failed to load report')
      })
      .catch(() => setErr('Could not load report'))
  }, [pid, app])

  const NUM_COLS = ['Total Failures', 'Known Failures', 'Matching Baseline', 'Locally Passing', 'Timeout', 'New Local Failure', 'GP Failure']

  // Compute totals row
  const totals = data?.rows?.reduce((acc, row) => {
    NUM_COLS.forEach(h => { acc[h] = (acc[h] || 0) + (Number(row[h]) || 0) })
    return acc
  }, {})

  const colColor = {
    'Known Failures':    '#ca8a04',
    'Matching Baseline': '#0891b2',
    'Locally Passing':   '#16a34a',
    'New Local Failure': '#dc2626',
    'Timeout':           '#9333ea',
    'GP Failure':        '#ea580c',
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}
        style={{ maxWidth: 980, width: '96vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <span className="modal-title">Regression Report — {version}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {err ? (
            <div style={{ padding: 24, color: 'var(--danger)' }}>{err}</div>
          ) : !data ? (
            <div className="center"><span className="spinner" /></div>
          ) : (
            <>
              {/* Totals summary cards */}
              <div style={{ display: 'flex', gap: 10, padding: '16px 20px', flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
                {NUM_COLS.filter(h => h !== 'GP Failure').map(h => (
                  <div key={h} style={{
                    flex: '1 1 100px', minWidth: 90, padding: '10px 14px', borderRadius: 8,
                    background: 'var(--surface2)', border: `2px solid ${colColor[h] || 'var(--border)'}`,
                    textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: colColor[h] || 'var(--text)' }}>
                      {totals?.[h] ?? 0}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{h}</div>
                  </div>
                ))}
              </div>

              {/* Breakup table */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--surface2)', position: 'sticky', top: 0 }}>
                    {(data.headers || []).filter(h => h !== 'Jenkins Job').map(h => (
                      <th key={h} style={{
                        padding: '8px 10px', textAlign: h === 'Value Stream' ? 'left' : 'center',
                        borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
                        color: colColor[h] || 'var(--text)',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data.rows || []).map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>
                      {(data.headers || []).filter(h => h !== 'Jenkins Job').map(h => (
                        <td key={h} style={{
                          padding: '6px 10px', textAlign: h === 'Value Stream' ? 'left' : 'center',
                          fontWeight: h === 'Value Stream' ? 600 : 400,
                          color: h !== 'Value Stream' && Number(row[h]) > 0 ? (colColor[h] || 'var(--text)') : 'var(--text)',
                        }}>
                          {row[h] === '' ? '' : (row[h] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {/* Totals row */}
                  <tr style={{ background: 'var(--surface2)', fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                    {(data.headers || []).filter(h => h !== 'Jenkins Job').map(h => (
                      <td key={h} style={{ padding: '7px 10px', textAlign: h === 'Value Stream' ? 'left' : 'center', color: colColor[h] || 'var(--text)' }}>
                        {h === 'Value Stream' ? 'Total' : (totals?.[h] ?? '')}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </div>

        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <a href={`/api/tools/rpb/projects/${pid}/download/report?app=${encodeURIComponent(app)}`}
            className="btn btn-sm" style={{ fontSize: 12 }}>
            ⬇ Download Excel
          </a>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ── Status detail / log modal ─────────────────────────────────────────────────
function StatusLogModal({ pid, stepLabel, stepStatus, onClose, app }) {
  const [log,     setLog]     = useState('')
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(true)
  const logRef = useRef(null)
  const _logApp = app || 'Payor'

  const fetchLog = useCallback(async () => {
    try {
      const r = await fetch(`/api/tools/rpb/projects/${pid}/log?app=${encodeURIComponent(_logApp)}`)
      const d = await r.json()
      setLog(d.log || '(no log output yet)')
      setRunning(!!d.running)
    } catch {
      setLog('Could not load log.')
    }
    setLoading(false)
  }, [pid])

  useEffect(() => { fetchLog() }, [fetchLog])

  // Auto-poll every 3s while running
  useEffect(() => {
    if (!running) return
    const t = setInterval(fetchLog, 3000)
    return () => clearInterval(t)
  }, [running, fetchLog])

  // Auto-scroll to bottom when log updates
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 860, width: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="modal-header">
          <span className="modal-title">
            {stepLabel} — Project #{pid}
            {running && <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>
              <span className="spinner" style={{ width: 10, height: 10, marginRight: 4 }} />
              Running · live
            </span>}
          </span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Status:</span>
          <StatusBadge value={stepStatus} />
          <button className="btn btn-sm" style={{ marginLeft: 'auto', fontSize: 12 }} onClick={fetchLog}>
            ↺ Refresh
          </button>
        </div>
        <div ref={logRef} style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
          {loading ? (
            <div className="center"><span className="spinner" /></div>
          ) : (
            <pre style={{
              fontFamily: 'Consolas, monospace', fontSize: 12, lineHeight: 1.6,
              margin: 0, padding: '14px 20px',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              color: '#c9d1d9', background: '#010409', minHeight: '100%',
            }}>{log}</pre>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Shared project form ───────────────────────────────────────────────────────
function ProjectForm({ initialData, isCreate, payorVersion, vms, appCats, defaultGpUrl, onSave, submitLabel, onCancel }) {
  const CAT_LIST = appCats && appCats.length ? appCats : PAYOR_CATS
  const initCats = () => {
    const base = {}
    CAT_LIST.forEach(cat => {
      const d = initialData?.[cat] || {}
      let regUrls = d.regression_urls
      if (!Array.isArray(regUrls)) regUrls = d.regression_url ? [d.regression_url] : ['']
      if (regUrls.length === 0)    regUrls = ['']
      base[cat] = { baseline_url: d.baseline_url || '', regression_urls: regUrls }
    })
    return base
  }

  const [activeTab,       setActiveTab]       = useState('remote')
  const [vmName,          setVmName]          = useState(initialData?.vm_name          || '')
  const [version,         setVersion]         = useState(initialData?.version          || payorVersion || '')
  const [baselineVersion, setBaselineVersion] = useState(initialData?.baseline_version || '')
  const [cats,            setCats]            = useState(initCats)
  const [gpUrl,           setGpUrl]           = useState(initialData?.gp_url || (isCreate ? (defaultGpUrl || '') : ''))
  const [gpEnabled,       setGpEnabled]       = useState(initialData?.gp_enabled       || false)
  const [busy,            setBusy]            = useState(false)
  const [saved,           setSaved]           = useState(false)
  const [err,             setErr]             = useState('')

  const setBaseline  = (cat, val) =>
    setCats(p => ({ ...p, [cat]: { ...p[cat], baseline_url: val } }))
  const setRegUrl    = (cat, idx, val) =>
    setCats(p => ({ ...p, [cat]: { ...p[cat], regression_urls: p[cat].regression_urls.map((u, i) => i === idx ? val : u) } }))
  const addRegUrl    = (cat) =>
    setCats(p => ({ ...p, [cat]: { ...p[cat], regression_urls: [...p[cat].regression_urls, ''] } }))
  const removeRegUrl = (cat, idx) =>
    setCats(p => ({ ...p, [cat]: { ...p[cat], regression_urls: p[cat].regression_urls.filter((_, i) => i !== idx) } }))

  const submit = async () => {
    if (isCreate && !version.trim()) { setErr('Regression Payor Branch Version is required.'); return }
    setBusy(true); setErr('')
    const result = await onSave({ ...cats, vm_name: vmName, version, baseline_version: baselineVersion, gp_url: gpUrl, gp_enabled: gpEnabled })
    if (result?.ok === false) setErr(result.error || 'Failed.')
    else if (!isCreate) { setSaved(true); setTimeout(() => setSaved(false), 2000) }
    setBusy(false)
  }

  const tabStyle = (key) => ({
    padding: '6px 16px', fontSize: 13, whiteSpace: 'nowrap',
    fontWeight: activeTab === key ? 600 : 400,
    color: activeTab === key ? 'var(--primary)' : 'var(--text-muted)',
    background: 'none', border: 'none', cursor: 'pointer', marginBottom: -1,
    borderBottom: activeTab === key ? '2px solid var(--primary)' : '2px solid transparent',
  })

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 16, gap: 0, flexWrap: 'wrap' }}>
        <button style={tabStyle('remote')}     onClick={() => setActiveTab('remote')}>Remote Server</button>
        <button style={tabStyle('general')}    onClick={() => setActiveTab('general')}>General</button>
        <button style={tabStyle('baseline')}   onClick={() => setActiveTab('baseline')}>Baseline Jenkins URLs</button>
        <button style={tabStyle('regression')} onClick={() => setActiveTab('regression')}>Regression Jenkins URLs</button>
        <button style={tabStyle('gp')}         onClick={() => setActiveTab('gp')}>GP Jenkins URLs</button>
      </div>

      {activeTab === 'remote' && (
        <div style={{ maxWidth: 480 }}>
          <label className="field-label" style={{ display: 'block', marginBottom: 8 }}>VM</label>
          {vmName && <div style={{ marginBottom: 10 }}><VmCard vmName={vmName} vms={vms} /></div>}
          <VmSelector value={vmName} onChange={setVmName} vms={vms} />
        </div>
      )}

      {activeTab === 'general' && (
        <div style={{ maxWidth: 500 }}>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="field-label" style={{ display: 'block', marginBottom: 6 }}>
              Regression Payor Branch Version{isCreate ? ' *' : ''}
            </label>
            {isCreate ? (
              <input type="text" value={version} autoFocus onChange={e => setVersion(e.target.value)}
                placeholder="e.g. 26.1.1" style={{ width: '100%' }} />
            ) : (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <div style={{
                  padding: '8px 12px', background: 'var(--surface2)',
                  border: '1px solid var(--border)', borderRadius: 6,
                  fontFamily: 'monospace', fontSize: 13, color: 'var(--text)', flex: 1,
                }}>
                  {version || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </div>
                {version && (
                  <button className="btn btn-sm" title="Copy version"
                    style={{ flexShrink: 0, padding: '4px 8px', fontSize: 13 }}
                    onClick={() => navigator.clipboard.writeText(version)}>⎘</button>
                )}
              </div>
            )}
          </div>
          <div className="form-group">
            <label className="field-label" style={{ display: 'block', marginBottom: 6 }}>Baseline Payor Branch Version</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="text" value={baselineVersion} onChange={e => setBaselineVersion(e.target.value)}
                placeholder="e.g. 26.1.0 (previous release)" style={{ flex: 1 }} />
              {baselineVersion && (
                <button className="btn btn-sm" title="Copy version"
                  style={{ flexShrink: 0, padding: '4px 8px', fontSize: 13 }}
                  onClick={() => navigator.clipboard.writeText(baselineVersion)}>⎘</button>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'baseline' && (
        <div className="table-wrap" style={{ marginBottom: 10 }}>
          <table>
            <thead><tr><th style={{ width: 140 }}>Category</th><th>Baseline Jenkins URL</th></tr></thead>
            <tbody>
              {CAT_LIST.map(cat => (
                <tr key={cat}>
                  <td style={{ fontWeight: 500, textTransform: 'capitalize', color: 'var(--primary)' }}>{cat}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="text" value={cats[cat].baseline_url} onChange={e => setBaseline(cat, e.target.value)}
                        placeholder="Jenkins build URL for baseline" style={{ flex: 1 }} />
                      {cats[cat].baseline_url && (
                        <button className="btn btn-sm" title="Copy URL"
                          style={{ flexShrink: 0, padding: '2px 8px', fontSize: 13 }}
                          onClick={() => navigator.clipboard.writeText(cats[cat].baseline_url)}>⎘</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'regression' && (
        <div className="table-wrap" style={{ marginBottom: 10 }}>
          <table>
            <thead><tr><th style={{ width: 140 }}>Category</th><th>Regression Jenkins URLs</th></tr></thead>
            <tbody>
              {CAT_LIST.map(cat => (
                <tr key={cat} style={{ verticalAlign: 'top' }}>
                  <td style={{ fontWeight: 500, textTransform: 'capitalize', color: 'var(--primary)', paddingTop: 10 }}>{cat}</td>
                  <td>
                    {cats[cat].regression_urls.map((url, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                        <input type="text" value={url} onChange={e => setRegUrl(cat, idx, e.target.value)}
                          placeholder="Jenkins build URL for regression run" style={{ flex: 1 }} />
                        {url && (
                          <button className="btn btn-sm" title="Copy URL"
                            style={{ padding: '2px 8px', fontSize: 13, lineHeight: 1.4, flexShrink: 0 }}
                            onClick={() => navigator.clipboard.writeText(url)}>⎘</button>
                        )}
                        {cats[cat].regression_urls.length > 1 && (
                          <button className="btn btn-sm btn-danger"
                            style={{ padding: '2px 8px', fontSize: 13, lineHeight: 1.4, flexShrink: 0 }}
                            onClick={() => removeRegUrl(cat, idx)}>×</button>
                        )}
                      </div>
                    ))}
                    <button className="btn btn-sm" style={{ fontSize: 12, padding: '2px 10px' }}
                      onClick={() => addRegUrl(cat)}>+ Add</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'gp' && (
        <div style={{ marginBottom: 10, maxWidth: 720 }}>
          <div style={{ marginBottom: 14 }}>
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none',
              padding: '10px 14px',
              background: gpEnabled ? 'color-mix(in srgb, var(--primary) 8%, var(--surface))' : 'var(--surface2)',
              border: `1px solid ${gpEnabled ? 'var(--primary)' : 'var(--border)'}`,
              borderRadius: 6, transition: 'all 0.15s',
            }}>
              <input type="checkbox" checked={gpEnabled} onChange={e => setGpEnabled(e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--primary)' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: gpEnabled ? 'var(--primary)' : 'var(--text)' }}>
                  Enable GP Regression
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {gpEnabled ? 'GP regression step is active — URL required below.' : 'GP regression step is disabled — URL input is not required.'}
                </div>
              </div>
            </label>
          </div>
          <div style={{ opacity: gpEnabled ? 1 : 0.45, transition: 'opacity 0.15s' }}>
            <label className="field-label" style={{ display: 'block', marginBottom: 6 }}>GP Jenkins Build URL</label>
            <input type="text" value={gpUrl} disabled={!gpEnabled} onChange={e => setGpUrl(e.target.value)}
              placeholder="e.g. http://central-gp:6060/job/stormtroopers/job/payor-end-to-end/359/"
              style={{ width: '100%', cursor: gpEnabled ? 'text' : 'not-allowed' }} />
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              Single GP run URL shared across all value streams.
            </div>
          </div>
        </div>
      )}

      {err && <div className="alert alert-error" style={{ marginTop: 12 }}>{err}</div>}
      <div className="flex-gap" style={{ marginTop: 16 }}>
        <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>
          {busy ? (isCreate ? 'Creating…' : 'Saving…') : saved ? '✓ Saved' : (submitLabel || 'Save')}
        </button>
        {onCancel && <button className="btn btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>}
      </div>
    </div>
  )
}


function RpbAppConfigModal({ app, onClose, onSaved }) {
  const [subTab,      setSubTab]      = useState('categories')
  const [categories,  setCategories]  = useState([])
  const [baselineDef, setBaselineDef] = useState({})
  const [gpUrl,       setGpUrl]       = useState('')
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [saved,       setSaved]       = useState(false)
  const [err,         setErr]         = useState('')

  useEffect(() => {
    setLoading(true); setErr('')
    fetch(`/api/tools/rpb/apps/${encodeURIComponent(app)}/config`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setCategories(d.categories || [])
          setBaselineDef(d.baseline_defaults || {})
          setGpUrl(d.gp_url || '')
        } else setErr(d.error || 'Failed to load.')
      })
      .catch(() => setErr('Request failed.'))
      .finally(() => setLoading(false))
  }, [app])

  const save = async () => {
    setSaving(true); setErr(''); setSaved(false)
    try {
      const r = await fetch(`/api/tools/rpb/apps/${encodeURIComponent(app)}/config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories, baseline_defaults: baselineDef, gp_url: gpUrl }),
      })
      const d = await r.json()
      if (d.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); onSaved?.() }
      else setErr(d.error || 'Save failed.')
    } catch { setErr('Request failed.') }
    setSaving(false)
  }

  const addCat    = () => setCategories(p => [...p, ''])
  const removeCat = (i) => setCategories(p => p.filter((_, idx) => idx !== i))
  const updateCat = (i, val) => setCategories(p => p.map((c, idx) => idx === i ? val : c))

  const _st = (key) => ({
    padding: '6px 16px', fontSize: 12, fontWeight: subTab === key ? 600 : 400,
    color: subTab === key ? 'var(--primary)' : 'var(--text-muted)',
    background: 'none', border: 'none', cursor: 'pointer',
    borderBottom: subTab === key ? '2px solid var(--primary)' : '2px solid transparent',
    marginBottom: -1,
  })

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}
        style={{ maxWidth: 640, width: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <span className="modal-title">Configure — {app}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 16, gap: 0 }}>
            <button style={_st('categories')} onClick={() => setSubTab('categories')}>Jenkins Category</button>
            <button style={_st('baseline')}   onClick={() => setSubTab('baseline')}>Baseline</button>
            <button style={_st('gp')}         onClick={() => setSubTab('gp')}>GP URL</button>
          </div>

          {loading ? (
            <div className="center" style={{ padding: 30 }}><span className="spinner" /></div>
          ) : (
            <>
              {subTab === 'categories' && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                    Value-stream categories for <strong>{app}</strong>. These drive the Baseline and Regression URL tables in each run.
                  </div>
                  <div style={{ maxHeight: 280, overflowY: 'auto', marginBottom: 10 }}>
                    {categories.map((cat, i) => (
                      <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                        <input value={cat} onChange={e => updateCat(i, e.target.value)}
                          placeholder="e.g. billing"
                          style={{ flex: 1, fontSize: 12, padding: '4px 8px' }} />
                        <button onClick={() => removeCat(i)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger, #f44336)', fontSize: 14, padding: '2px 4px' }}>✕</button>
                      </div>
                    ))}
                  </div>
                  <button className="btn btn-sm" onClick={addCat}>+ Add Category</button>
                </div>
              )}

              {subTab === 'baseline' && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                    Default baseline Jenkins URLs for <strong>{app}</strong>. Pre-filled when creating a new run.
                  </div>
                  <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', padding: '4px 8px', width: 140, borderBottom: '1px solid var(--border)' }}>Category</th>
                          <th style={{ textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>Default Baseline URL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {categories.filter(c => c.trim()).map(cat => (
                          <tr key={cat} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '5px 8px', fontSize: 12, fontWeight: 500, color: 'var(--primary)', textTransform: 'capitalize' }}>{cat}</td>
                            <td style={{ padding: '4px 8px' }}>
                              <input value={baselineDef[cat] || ''} onChange={e => setBaselineDef(p => ({ ...p, [cat]: e.target.value }))}
                                placeholder="Jenkins build URL (optional)"
                                style={{ width: '100%', fontSize: 12 }} />
                            </td>
                          </tr>
                        ))}
                        {categories.filter(c => c.trim()).length === 0 && (
                          <tr><td colSpan={2} style={{ padding: '14px 8px', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
                            No categories yet — add them in the Jenkins Category tab.
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {subTab === 'gp' && (
                <div style={{ maxWidth: 560 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                    Default GP Jenkins build URL for <strong>{app}</strong>. Pre-filled in the GP tab when creating a new run.
                  </div>
                  <label className="field-label" style={{ display: 'block', marginBottom: 6 }}>GP Jenkins Build URL</label>
                  <input value={gpUrl} onChange={e => setGpUrl(e.target.value)}
                    placeholder="e.g. http://central-gp:6060/job/stormtroopers/job/payor-end-to-end/359/"
                    style={{ width: '100%' }} />
                </div>
              )}
            </>
          )}
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
          {saved && <span style={{ fontSize: 12, color: '#4caf50' }}>✓ Saved</span>}
          {err   && <span style={{ fontSize: 12, color: '#f44336' }}>{err}</span>}
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RpbConfigureModal({ apps, onClose, onAppsChange }) {
  const [activeTab,    setActiveTab]    = useState(apps[0] || '')
  const [showAddTab,   setShowAddTab]   = useState(false)
  const [newAppName,   setNewAppName]   = useState('')
  const [addingApp,    setAddingApp]    = useState(false)
  const [addErr,       setAddErr]       = useState('')
  const [confirmDel,   setConfirmDel]   = useState(false)
  const [deletingApp,  setDeletingApp]  = useState(false)
  const [delErr,       setDelErr]       = useState('')
  const newAppRef = useRef(null)

  useEffect(() => {
    if (showAddTab && newAppRef.current) newAppRef.current.focus()
  }, [showAddTab])

  const openAddTab = () => { setShowAddTab(true); setNewAppName(''); setAddErr('') }
  const cancelAdd  = () => { setShowAddTab(false); setAddErr('') }

  const addApp = async () => {
    const name = newAppName.trim()
    if (!name) return
    if (apps.some(a => a.toLowerCase() === name.toLowerCase())) {
      setAddErr('An application with that name already exists.'); return
    }
    setAddingApp(true); setAddErr('')
    try {
      const r = await fetch('/api/tools/rpb/apps', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const d = await r.json()
      if (d.ok) {
        onAppsChange(d.apps)
        setShowAddTab(false); setNewAppName('')
        setActiveTab(name)
      } else { setAddErr(d.error || 'Failed to add.') }
    } catch { setAddErr('Request failed.') }
    setAddingApp(false)
  }

  const confirmDelete = async () => {
    setDeletingApp(true); setDelErr('')
    try {
      const r = await fetch(`/api/tools/rpb/apps/${encodeURIComponent(activeTab)}`, { method: 'DELETE' })
      const d = await r.json()
      if (d.ok) {
        onAppsChange(d.apps)
        setConfirmDel(false)
        setActiveTab(d.apps[0] || '')
      } else { setDelErr(d.error || 'Failed to delete.') }
    } catch { setDelErr('Request failed.') }
    setDeletingApp(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520, width: '95vw' }}>
        <div className="modal-header">
          <span className="modal-title">Configure Applications</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {/* App tab bar */}
          <div style={{ display: 'flex', borderBottom: '2px solid var(--border)', marginBottom: 14, gap: 0, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {apps.map(a => (
              <button key={a} onClick={() => { cancelAdd(); setActiveTab(a); setConfirmDel(false); setDelErr('') }}
                style={{
                  padding: '6px 14px', fontSize: 12, fontWeight: activeTab === a && !showAddTab ? 600 : 400,
                  border: 'none', borderBottom: activeTab === a && !showAddTab ? '2px solid var(--primary)' : '2px solid transparent',
                  marginBottom: -2, background: 'none', cursor: 'pointer',
                  color: activeTab === a && !showAddTab ? 'var(--primary)' : 'var(--text-muted)',
                }}>
                {a}
              </button>
            ))}
            {!showAddTab && (
              <button onClick={openAddTab}
                style={{
                  padding: '6px 10px', fontSize: 14, lineHeight: 1, fontWeight: 400,
                  border: 'none', borderBottom: '2px solid transparent', marginBottom: -2,
                  background: 'none', cursor: 'pointer', color: 'var(--text-muted)',
                }} title="Add application">+</button>
            )}
            {showAddTab && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', marginBottom: -2 }}>
                <input ref={newAppRef} value={newAppName} onChange={e => setNewAppName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addApp(); if (e.key === 'Escape') cancelAdd() }}
                  placeholder="Application name…"
                  style={{ fontSize: 12, padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', width: 160 }} />
                <button className="btn btn-sm btn-primary" onClick={addApp} disabled={addingApp || !newAppName.trim()}>
                  {addingApp ? '…' : 'Add'}
                </button>
                <button className="btn btn-sm" onClick={cancelAdd}>Cancel</button>
              </div>
            )}
          </div>
          {addErr && <div style={{ color: '#f44336', fontSize: 12, marginBottom: 10 }}>{addErr}</div>}

          {activeTab && !showAddTab && (
            <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              {!confirmDel ? (
                <button className="btn btn-sm btn-danger" onClick={() => { setConfirmDel(true); setDelErr('') }}
                  style={{ fontSize: 12 }}>
                  Delete Application
                </button>
              ) : (
                <div style={{ background: 'var(--surface2)', border: '1px solid var(--danger, #f44336)', borderRadius: 7, padding: '12px 14px' }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--danger, #f44336)', marginBottom: 6 }}>
                    Delete "{activeTab}"?
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
                    This will permanently remove the application and all its project data. This action cannot be undone.
                  </div>
                  {delErr && <div style={{ color: '#f44336', fontSize: 12, marginBottom: 8 }}>{delErr}</div>}
                  <div className="flex-gap">
                    <button className="btn btn-sm btn-danger" onClick={confirmDelete} disabled={deletingApp}>
                      {deletingApp ? 'Deleting…' : 'Confirm Delete'}
                    </button>
                    <button className="btn btn-sm" onClick={() => { setConfirmDel(false); setDelErr('') }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function RpbPage() {
  const navigate = useNavigate()
  const [activeApp,     setActiveApp]     = useState('Payor')
  const [apps,          setApps]          = useState(['Payor'])
  const [configModal,   setConfigModal]   = useState(false)
  const [rows,          setRows]          = useState([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState('')
  const [expanded,      setExpanded]      = useState({})
  const [deleting,      setDeleting]      = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [showCreate,    setShowCreate]    = useState(false)
  const [vms,           setVms]           = useState([])
  const [executing,       setExecuting]       = useState({})      // pid -> bool
  const [statusModal,     setStatusModal]     = useState(null)    // { pid, stepLabel, stepStatus, app }
  const [baselineModal,   setBaselineModal]   = useState(null)    // { pid, app }
  const [reportModal,     setReportModal]     = useState(null)    // { pid, app }
  const [releaseVersions, setReleaseVersions] = useState({})      // branch_version -> release_version | 'loading' | null
  const [appCats,          setAppCats]          = useState([])
  const [appGpUrl,         setAppGpUrl]         = useState('')
  const [showAppConfig,    setShowAppConfig]    = useState(false)
  const [rpbProgress,      setRpbProgress]      = useState({})      // pid -> { completed, total, eta }
  const [aborting,         setAborting]         = useState({})      // pid -> bool
  const [showScheduler,    setShowScheduler]    = useState(false)
  const [schedSettings,    setSchedSettings]    = useState([])
  const [schedSaving,      setSchedSaving]      = useState(false)
  const [schedSaved,       setSchedSaved]       = useState(false)
  const [schedErr,         setSchedErr]         = useState('')
  const [autoRefreshMs,    setAutoRefreshMs]    = useState(() => {
    const v = parseInt(localStorage.getItem(RPB_REFRESH_KEY), 10)
    return RPB_REFRESH_OPTS.some(o => o.value === v) ? v : 0
  })
  const autoRefTimerRef = useRef(null)

  const saveAutoRefresh = (v) => {
    setAutoRefreshMs(v)
    localStorage.setItem(RPB_REFRESH_KEY, String(v))
    fetch('/api/tools/rpb/scheduler-settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { poll_interval_s: String(Math.round(v / 1000)) } }),
    }).catch(() => {})
  }

  const loadSchedulerSettings = () => {
    fetch('/api/tools/rpb/scheduler-settings')
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.settings) {
          setSchedSettings(d.settings)
          const pollSetting = d.settings.find(s => s.key.toLowerCase() === 'poll_interval_s')
          if (pollSetting) {
            const ms = (parseInt(pollSetting.value, 10) || 0) * 1000
            if (ms > 0 && RPB_REFRESH_OPTS.some(o => o.value === ms)) {
              setAutoRefreshMs(ms); localStorage.setItem(RPB_REFRESH_KEY, String(ms))
            }
          }
        }
      })
      .catch(() => {})
  }
  useEffect(() => { loadSchedulerSettings() }, [])

  const saveSchedulerSettings = async () => {
    setSchedSaving(true); setSchedSaved(false); setSchedErr('')
    try {
      const updates = {}
      schedSettings.forEach(s => { updates[s.key] = s.value })
      const r = await fetch('/api/tools/rpb/scheduler-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: updates }),
      })
      const d = await r.json()
      if (d.ok) { setSchedSaved(true); loadSchedulerSettings() }
      else setSchedErr(d.error || 'Failed to save')
    } catch { setSchedErr('Network error') }
    finally { setSchedSaving(false) }
  }

  const loadAppCats = useCallback(() => {
    fetch(`/api/tools/rpb/apps/${encodeURIComponent(activeApp)}/config`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          if (d.categories?.length) setAppCats(d.categories)
          if (d.gp_url) setAppGpUrl(d.gp_url)
        }
      })
      .catch(() => {})
  }, [activeApp])

  const load = useCallback(() => {
    setLoading(true); setError('')
    fetch(`/api/tools/rpb/projects?app=${encodeURIComponent(activeApp)}`)
      .then(r => r.json())
      .then(d => { setRows(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => { setError('Failed to load.'); setLoading(false) })
  }, [activeApp])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    clearInterval(autoRefTimerRef.current)
    if (autoRefreshMs > 0) autoRefTimerRef.current = setInterval(load, autoRefreshMs)
    return () => clearInterval(autoRefTimerRef.current)
  }, [autoRefreshMs, load])
  useEffect(() => { loadAppCats() }, [loadAppCats])
  useEffect(() => {
    fetch('/api/tools/rpb/apps')
      .then(r => r.json())
      .then(d => { if (d.ok && Array.isArray(d.apps) && d.apps.length) { setApps(d.apps); if (!d.apps.includes(activeApp)) setActiveApp(d.apps[0]) } })
      .catch(() => {})
  }, [])
  useEffect(() => {
    fetch('/api/tools/rpb/vms')
      .then(r => r.json())
      .then(d => setVms(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [])

  // Fetch release versions from GitHub pom.xml for unique branch versions
  useEffect(() => {
    const unique = [...new Set(rows.map(r => r.payor_version).filter(Boolean))]
    unique.forEach(bv => {
      setReleaseVersions(prev => {
        if (prev[bv] !== undefined) return prev
        return { ...prev, [bv]: 'loading' }
      })
      fetch(`/api/tools/rpb/payor-release-version?branch_version=${encodeURIComponent(bv)}`)
        .then(r => r.json())
        .then(d => setReleaseVersions(prev => ({ ...prev, [bv]: d.ok ? d.release_version : null })))
        .catch(() => setReleaseVersions(prev => ({ ...prev, [bv]: null })))
    })
  }, [rows])

  // Auto-poll while any project is In Progress
  useEffect(() => {
    const anyRunning = rows.some(r => r.running === true)
    if (!anyRunning) return
    const t = setInterval(() => {
      fetch(`/api/tools/rpb/projects?app=${encodeURIComponent(activeApp)}`)
        .then(r => r.json())
        .then(d => setRows(Array.isArray(d) ? d : []))
        .catch(() => {})
    }, POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [rows])

  // Poll progress for rows with regression In Progress
  useEffect(() => {
    const regRunning = rows.filter(r => r.regression_status === 'In Progress')
    if (!regRunning.length) return
    const fetchProgress = () => {
      regRunning.forEach(r => {
        fetch(`/api/tools/rpb/projects/${r.pid}/progress?app=${encodeURIComponent(activeApp)}`)
          .then(res => res.json())
          .then(d => setRpbProgress(prev => ({ ...prev, [r.pid]: d })))
          .catch(() => {})
      })
    }
    fetchProgress()
    const t = setInterval(fetchProgress, 60 * 1000)
    return () => clearInterval(t)
  }, [rows, activeApp])

  const toggle = (pid) => setExpanded(e => ({ ...e, [pid]: !e[pid] }))

  const execute = async (pid) => {
    setExecuting(p => ({ ...p, [pid]: true }))
    try {
      const r = await fetch(`/api/tools/rpb/projects/${pid}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: activeApp }),
      })
      const d = await r.json()
      if (d.ok) {
        setRows(prev => prev.map(row =>
          String(row.pid) === String(pid)
            ? { ...row, status: 'In Progress', rpb_status: 'Pending', regression_status: 'Pending' }
            : row
        ))
        // Auto-open live log so user can see progress immediately
        setStatusModal({ pid, stepLabel: 'Execution Log', stepStatus: 'In Progress', app: activeApp })
      } else {
        setError(d.error || 'Execute failed.')
      }
    } catch { setError('Execute request failed.') }
    setExecuting(p => ({ ...p, [pid]: false }))
  }

  const abort = async (pid) => {
    setAborting(p => ({ ...p, [pid]: true }))
    try {
      await fetch(`/api/tools/rpb/projects/${pid}/abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: activeApp }),
      })
      load()
    } catch { /* ignore */ }
    setAborting(p => ({ ...p, [pid]: false }))
  }

  const handleCreate = async (data) => {
    try {
      const r = await fetch('/api/tools/rpb/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payor_version:    data.version,
          vm_name:          data.vm_name,
          baseline_version: data.baseline_version,
          payor_urls:       data,
          app:              activeApp,
        }),
      })
      const d = await r.json()
      if (d.ok) { setShowCreate(false); load(); return { ok: true } }
      return { ok: false, error: d.error || 'Failed to create project.' }
    } catch { return { ok: false, error: 'Request failed.' } }
  }

  const handleSave = (pid, payorVersion) => async (data) => {
    try {
      const payload = { ...data, version: data.version || payorVersion || '' }
      await fetch(`/api/tools/rpb/projects/${pid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payor_urls: payload, app: activeApp }),
      })
      setRows(prev => prev.map(r =>
        String(r.pid) === String(pid)
          ? { ...r, payor_urls: JSON.stringify(payload), vm_name: data.vm_name || r.vm_name }
          : r
      ))
      return { ok: true }
    } catch { return { ok: false, error: 'Save failed.' } }
  }

  const deleteProject = async (pid) => {
    setDeleting(pid)
    try {
      await fetch(`/api/tools/rpb/projects/${encodeURIComponent(pid)}?app=${encodeURIComponent(activeApp)}`, { method: 'DELETE' })
      load()
    } catch { /* ignore */ }
    setDeleting(null); setPendingDelete(null)
  }

  const sorted    = [...rows].sort((a, b) => Number(b.pid) - Number(a.pid))
  const appRows   = sorted.filter(r => !r.application || r.application.toLowerCase() === activeApp.toLowerCase())
  const COL_COUNT = 12

  const _appTabStyle = (app) => ({
    padding: '7px 20px', fontSize: 13, fontWeight: activeApp === app ? 600 : 400,
    color: activeApp === app ? 'var(--primary)' : 'var(--text-muted)',
    background: 'none', border: 'none', cursor: 'pointer',
    borderBottom: activeApp === app ? '2px solid var(--primary)' : '2px solid transparent',
    marginBottom: -1, transition: 'color 0.15s',
  })

  return (
    <div>
      <button className="btn back-link" onClick={() => navigate('/workflow-projects')}
        style={{ marginBottom: 16, fontSize: 12, padding: '4px 10px' }}>
        ← Workflow Projects
      </button>
      <WorkflowBackButton />

      <div className="page-header">
        <h1 className="page-title">Remote Regression</h1>
        <div className="flex-gap" style={{ alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Auto-refresh:</span>
          <select value={autoRefreshMs} onChange={e => saveAutoRefresh(Number(e.target.value))}
            style={{ fontSize: 12, padding: '4px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}>
            {RPB_REFRESH_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="btn btn-sm" style={{ fontSize: 12 }} onClick={() => setConfigModal(true)}>
            ⚙ Configure
          </button>
          <button className="btn" onClick={() => { setShowScheduler(v => !v); setSchedSaved(false); setSchedErr('') }}
            title="Scheduler settings" style={{ fontSize: 12, padding: '5px 12px' }}>
            ⏱ Scheduler
          </button>
        </div>
      </div>

      {showScheduler && (
        <div style={{ margin: '0 0 16px 0', padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Scheduler Settings</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(applies to all Remote Regression runs)</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 10 }}>
            <thead>
              <tr>
                {['Key', 'Value', 'Notes'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schedSettings.map((s, i) => (
                <tr key={s.key}>
                  <td style={{ padding: '4px 8px', fontFamily: 'monospace', color: 'var(--text)' }}>{s.key}</td>
                  <td style={{ padding: '4px 8px' }}>
                    <input value={s.value}
                      onChange={e => { setSchedSettings(prev => prev.map((r, j) => j === i ? { ...r, value: e.target.value } : r)); setSchedSaved(false) }}
                      style={{ width: 110, padding: '3px 7px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }} />
                  </td>
                  <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{s.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn" onClick={saveSchedulerSettings} disabled={schedSaving}
              style={{ fontSize: 12, padding: '5px 14px' }}>
              {schedSaving ? 'Saving…' : 'Save'}
            </button>
            {schedSaved && <span style={{ fontSize: 12, color: '#4caf50' }}>✓ Saved</span>}
            {schedErr  && <span style={{ fontSize: 12, color: '#f44336' }}>{schedErr}</span>}
          </div>
        </div>
      )}

      {/* Application tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        {apps.map(a => (
          <button key={a} style={_appTabStyle(a)} onClick={() => { setActiveApp(a); setShowCreate(false) }}>
            {a}
          </button>
        ))}
      </div>

      {/* Per-app action bar */}
      <div className="flex-gap" style={{ marginBottom: 16, justifyContent: 'space-between' }}>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Run</button>
        <div className="flex-gap">
          <button className="btn btn-sm" style={{ fontSize: 12 }} onClick={() => setShowAppConfig(true)}>
            ⚙ Configure
          </button>
          <button className="btn" onClick={load} disabled={loading}>↺ Refresh</button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="center"><span className="spinner" /></div>
      ) : appRows.length === 0 ? (
        <div className="empty">
          <h3>No projects yet</h3>
          <p>Click <strong>+ New Run</strong> to create your first {activeApp} Remote Regression project.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>PID</th>
                <th>Payor Branch Version</th>
                <th>Payor Release Version</th>
                <th>VM</th>
                <th>Status</th>
                <th>Baseline</th>
                <th>Regression</th>
                <th>GP</th>
                <th>Created At</th>
                <th style={{ width: 72, textAlign: 'center' }}>Report</th>
                <th style={{ width: 72, textAlign: 'center' }}>Email</th>
                <th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {appRows.map(row => {
                const isOpen    = expanded[row.pid]
                const urls      = parseUrls(row.payor_urls)
                const gpEnabled = urls?.gp_enabled ?? false
                // row.running = true only when a live background thread exists on the server.
                // Prevents stale "In Progress" status (e.g. after server restart) from hiding Execute.
                const isRunning = row.running === true
                const isExec    = executing[row.pid]

                return (
                  <React.Fragment key={row.pid}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => toggle(row.pid)}>
                      <td style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'center', userSelect: 'none' }}>
                        {isOpen ? '▾' : '▸'}
                      </td>
                      <td><strong>{row.pid}</strong></td>
                      <td className="mono">{row.payor_version || '—'}</td>
                      <td className="mono">
                        {(() => {
                          const rv = releaseVersions[row.payor_version]
                          if (!row.payor_version) return <span style={{ color: 'var(--text-muted)' }}>—</span>
                          if (rv === 'loading') return <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
                          if (!rv) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>N/A</span>
                          return rv
                        })()}
                      </td>
                      <td>
                        {row.vm_name
                          ? <span style={{ fontSize: 12 }}>
                              <span style={{ fontWeight: 500 }}>{row.vm_name}</span>
                              {row.vm_ip ? <span style={{ color: 'var(--text-muted)' }}> ({row.vm_ip})</span> : null}
                            </span>
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>

                      {/* Status + Execute / Abort */}
                      <td onClick={e => e.stopPropagation()} style={{ minWidth: 170 }}>
                        {isRunning ? (
                          <div className="flex-gap" style={{ gap: 6, flexWrap: 'nowrap' }}>
                            <span className="spinner" style={{ width: 12, height: 12, flexShrink: 0 }} />
                            <StatusBadge value={row.status}
                              onClick={() => setStatusModal({ pid: row.pid, stepLabel: 'Execution Log', stepStatus: row.status, app: activeApp })} />
                            <button
                              className="btn btn-sm btn-danger"
                              style={{ fontSize: 11, padding: '2px 8px' }}
                              disabled={!!aborting[row.pid]}
                              onClick={() => abort(row.pid)}
                            >
                              {aborting[row.pid] ? '…' : 'Abort'}
                            </button>
                          </div>
                        ) : (
                          <div className="flex-gap" style={{ gap: 6, flexWrap: 'wrap' }}>
                            {row.status && row.status !== 'Pending' && <StatusBadge value={row.status} />}
                            {row.status !== 'In Progress' && (
                              <button
                                className="btn btn-sm btn-primary"
                                style={{ fontSize: 11, padding: '2px 8px' }}
                                disabled={isExec || isRunning}
                                onClick={() => execute(row.pid)}
                              >
                                {isExec ? '…' : (!row.status || row.status === 'Pending') ? 'Execute' : 'Re-run'}
                              </button>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Baseline */}
                      <td onClick={e => e.stopPropagation()}>
                        <StatusBadge value={row.rpb_status || '—'}
                          onClick={row.rpb_status === 'Completed'
                            ? () => setBaselineModal({ pid: row.pid, app: activeApp })
                            : undefined} />
                      </td>

                      {/* Regression */}
                      <td onClick={e => e.stopPropagation()}>
                        {row.regression_status === 'In Progress' && rpbProgress[row.pid]?.total != null ? (() => {
                          const { completed, total, eta } = rpbProgress[row.pid]
                          const pct = total > 0 ? Math.round((completed / total) * 100) : 0
                          return (
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--warning, #d97706)', lineHeight: 1.4, whiteSpace: 'nowrap' }}>
                              {pct}% — {completed}/{total} ITs
                              {eta && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> ({eta})</span>}
                            </div>
                          )
                        })() : (
                          <StatusBadge value={row.regression_status || '—'}
                            onClick={row.regression_status === 'Completed' && row.has_report
                              ? () => setReportModal({ pid: row.pid, app: activeApp })
                              : undefined} />
                        )}
                      </td>

                      {/* GP */}
                      <td onClick={e => e.stopPropagation()}>
                        {!gpEnabled
                          ? <StatusBadge value="N/A" />
                          : <StatusBadge
                              value={row.gp_status || '—'}
                              onClick={row.gp_status && row.gp_status !== 'Pending'
                                ? () => setStatusModal({ pid: row.pid, stepLabel: 'GP Regression', stepStatus: row.gp_status, app: activeApp })
                                : undefined}
                            />}
                      </td>

                      <td className="mono">{(row.created_at || '').slice(0, 16)}</td>

                      {/* Report download */}
                      <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                        {row.has_report && row.status !== 'In Progress' && row.status !== 'Pending'
                          ? <a
                              href={`/api/tools/rpb/projects/${row.pid}/download/report?app=${encodeURIComponent(activeApp)}`}
                              title="Download Regression Report (.xlsx)"
                              style={{ fontSize: 18, textDecoration: 'none', color: 'var(--primary)' }}
                              onClick={e => e.stopPropagation()}
                            >⬇</a>
                          : <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>—</span>}
                      </td>

                      {/* Email draft download */}
                      <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                        {row.has_email && row.status !== 'In Progress' && row.status !== 'Pending'
                          ? <a
                              href={`/api/tools/rpb/projects/${row.pid}/download/email?app=${encodeURIComponent(activeApp)}`}
                              title="Download Draft Email (.docx)"
                              style={{ fontSize: 18, textDecoration: 'none', color: 'var(--success, #2da44e)' }}
                              onClick={e => e.stopPropagation()}
                            >⬇</a>
                          : <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>—</span>}
                      </td>

                      {/* Delete */}
                      <td onClick={e => e.stopPropagation()}>
                        {pendingDelete === row.pid ? (
                          <div className="flex-gap">
                            <button className="btn btn-sm btn-danger" disabled={deleting === row.pid}
                              onClick={() => deleteProject(row.pid)}>
                              {deleting === row.pid ? '…' : 'Confirm'}
                            </button>
                            <button className="btn btn-sm" onClick={() => setPendingDelete(null)}>Cancel</button>
                          </div>
                        ) : (
                          <button className="btn btn-sm btn-danger" onClick={() => setPendingDelete(row.pid)}>Delete</button>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={COL_COUNT + 1} style={{ background: 'var(--surface2)', padding: '16px 20px 16px 32px' }}>
                          <ProjectForm
                            initialData={urls}
                            isCreate={false}
                            payorVersion={row.payor_version}
                            vms={vms}
                            appCats={appCats}
                            defaultGpUrl={appGpUrl}
                            onSave={handleSave(row.pid, row.payor_version)}
                            submitLabel="Save"
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* New Run modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}
            style={{ maxWidth: 760, width: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header">
              <span className="modal-title">New Remote Regression Run — {activeApp}</span>
              <button className="modal-close" onClick={() => setShowCreate(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>
              <ProjectForm
                initialData={{}}
                isCreate={true}
                vms={vms}
                appCats={appCats}
                defaultGpUrl={appGpUrl}
                onSave={handleCreate}
                submitLabel="Create Project"
                onCancel={() => setShowCreate(false)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Status detail / log modal */}
      {statusModal && (
        <StatusLogModal
          pid={statusModal.pid}
          stepLabel={statusModal.stepLabel}
          stepStatus={statusModal.stepStatus}
          app={statusModal.app || 'Payor'}
          onClose={() => setStatusModal(null)}
        />
      )}

      {/* Baseline editor modal */}
      {baselineModal && (
        <BaselineModal
          pid={baselineModal.pid}
          app={baselineModal.app || 'Payor'}
          onClose={() => setBaselineModal(null)}
        />
      )}

      {/* Report summary modal */}
      {reportModal && (
        <ReportSummaryModal
          pid={reportModal.pid}
          app={reportModal.app || 'Payor'}
          onClose={() => setReportModal(null)}
        />
      )}

      {/* Per-app configure modal */}
      {showAppConfig && (
        <RpbAppConfigModal
          app={activeApp}
          onClose={() => setShowAppConfig(false)}
          onSaved={loadAppCats}
        />
      )}

      {/* Configure applications modal */}
      {configModal && (
        <RpbConfigureModal
          apps={apps}
          onClose={() => setConfigModal(false)}
          onAppsChange={(newApps) => {
            setApps(newApps)
            if (!newApps.includes(activeApp)) setActiveApp(newApps[0] || '')
          }}
        />
      )}
    </div>
  )
}
