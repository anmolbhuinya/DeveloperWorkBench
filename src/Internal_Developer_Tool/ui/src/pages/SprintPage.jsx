import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import DatePicker from '../components/DatePicker'

const API = '/api/project-management/sprint'
const DATA_SHEETS = ['Sprint Board', 'Adhoc Task', 'PR Reviews']
const MAIN_COLS   = ['JIRA ID', 'Story', 'Issue Type', 'Story Point', 'Status', 'DevDays', 'Developer', 'QA', 'QADays']
const COL_WIDTHS  = { 'JIRA ID': 110, 'Story': 320, 'Issue Type': 100, 'Story Point': 70, 'Status': 80, 'DevDays': 70, 'Developer': 100, 'QA': 90, 'QADays': 70, 'Date Added': 110 }
const DETAIL_COLS     = ['Notes', 'Commit Job', 'IT Job', 'Code Freeze Date', 'Releasae Date', 'Deployment Date', 'Deployed']
const COL_LABEL_OVERRIDE = { 'Deployed': 'Deployment Date' }

function parseEndDate(f) { const m = f.match(/(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null }
function displayName(f)  { return f.replace(/^.+_\d{4}-\d{2}-\d{2}_/, '').replace(/_/g, ' ') || f.replace(/_/g, ' ') }
function teamFrom(f)     { const m = f.match(/^(.+)_\d{4}-\d{2}-\d{2}_/); return m ? m[1] : '' }
function stemOf(file)    { return file.replace(/\.xlsx$/i, '') }

function FixVersionBlock({ fixVersions, app, codeFreezeDate, releaseDate }) {
  const [resolved, setResolved] = useState({})
  const fvKey = (fixVersions || []).join(',')

  useEffect(() => {
    if (!fixVersions?.length || !app) return
    fixVersions.forEach(fv => {
      setResolved(r => ({ ...r, [fv]: { loading: true, branch: undefined } }))
      fetch('/api/project-management/sprint/resolve-release-branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: app.toLowerCase(), fix_version: fv }),
      })
        .then(r => r.json())
        .then(d => setResolved(r => ({ ...r, [fv]: { loading: false, branch: d.release_branch ?? null } })))
        .catch(() => setResolved(r => ({ ...r, [fv]: { loading: false, branch: null } })))
    })
  }, [fvKey, app])

  if (!fixVersions?.length) return null
  return (
    <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', padding:'7px 10px', background:'rgba(255,152,0,0.07)', border:'1px solid rgba(255,152,0,0.3)', borderRadius:6 }}>
      {fixVersions.map(fv => {
        const info = resolved[fv]
        return (
          <div key={fv} style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:10, fontWeight:600, color:'#2e7d32', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:2 }}>Release Branch</div>
              {(!info || info.loading) ? (
                <span className="spinner" style={{ width:10, height:10, display:'inline-block', verticalAlign:'middle' }} />
              ) : info.branch ? (
                <code style={{ fontSize:12, fontWeight:700, color:'#2e7d32', background:'rgba(76,175,80,0.12)', border:'1px solid rgba(76,175,80,0.35)', borderRadius:6, padding:'2px 10px' }}>{info.branch}</code>
              ) : (
                <span style={{ fontSize:11, color:'var(--text-muted)', fontStyle:'italic' }}>Not Available</span>
              )}
            </div>
            <span style={{ fontSize:13, color:'var(--text-muted)' }}>·</span>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:10, fontWeight:600, color:'#e65100', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:2 }}>App Version</div>
              <span style={{ fontSize:12, fontWeight:700, color:'#e65100', background:'rgba(255,152,0,0.15)', border:'1px solid rgba(255,152,0,0.4)', borderRadius:6, padding:'2px 10px' }}>{fv}</span>
            </div>
          </div>
        )
      })}
      {codeFreezeDate && (
        <>
          <span style={{ fontSize:13, color:'var(--text-muted)' }}>·</span>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:10, fontWeight:600, color:'#546e7a', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:2 }}>Code Freeze</div>
            <span style={{ fontSize:12, fontWeight:700, color:'#546e7a', background:'rgba(84,110,122,0.1)', border:'1px solid rgba(84,110,122,0.3)', borderRadius:6, padding:'2px 10px' }}>{codeFreezeDate}</span>
          </div>
        </>
      )}
      {releaseDate && (
        <>
          <span style={{ fontSize:13, color:'var(--text-muted)' }}>·</span>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:10, fontWeight:600, color:'#1565c0', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:2 }}>Release Date</div>
            <span style={{ fontSize:12, fontWeight:700, color:'#1565c0', background:'rgba(21,101,192,0.1)', border:'1px solid rgba(21,101,192,0.3)', borderRadius:6, padding:'2px 10px' }}>{releaseDate}</span>
          </div>
        </>
      )}
    </div>
  )
}

function findCurrent(sprints) {
  const today = new Date().toISOString().slice(0, 10)
  const up = sprints.map(s => ({ ...s, ed: parseEndDate(s.name) })).filter(s => s.ed && s.ed >= today).sort((a,b)=>a.ed.localeCompare(b.ed))
  if (up.length) return up[0]
  const past = sprints.map(s => ({ ...s, ed: parseEndDate(s.name) })).filter(s => s.ed).sort((a,b)=>b.ed.localeCompare(a.ed))
  return past[0] || null
}

function extractJiraId(v) {
  if (!v) return ''
  const m = String(v).match(/\/browse\/([A-Z]+-\d+)/i) || String(v).match(/^([A-Z]+-\d+)$/i)
  return m ? m[1].toUpperCase() : v
}
// Copy a table to the clipboard (HTML with clickable JIRA links + tab-separated text fallback)
async function copyRowsToClipboard(head, body) {
  const jp = head.indexOf('JIRA ID')
  const text = [head, ...body].map(r => r.join('\t')).join('\n')
  const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const cell = (v, i) => (i === jp && v && jiraUrl(v)) ? `<td><a href="${esc(jiraUrl(v))}" style="color:#0563C1;text-decoration:underline">${esc(v)}</a></td>` : `<td>${esc(v)}</td>`
  const html = `<table><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${body.map(r => `<tr>${r.map(cell).join('')}</tr>`).join('')}</table>`
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })])
  } catch {
    try { await navigator.clipboard.writeText(text) }
    catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove() }
  }
}

// Download a table as .xlsx with clickable JIRA links
async function exportRowsToXlsx(head, body, name) {
  const jp = head.indexOf('JIRA ID')
  const urls = body.map(r => (jp >= 0 && r[jp]) ? (jiraUrl(r[jp]) || '') : '')
  try {
    const res = await fetch('/api/project-management/sprint/export-xlsx', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ head, rows: body, urls, jp, sheet: name.slice(0, 31), name }),
    })
    if (!res.ok) throw new Error('export failed')
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${name}.xlsx`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  } catch (e) { alert('Export failed: ' + e.message) }
}

function jiraUrl(id) {
  return /^[A-Z]+-\d+$/i.test(String(id||''))
    ? `https://healthedge.atlassian.net/browse/${String(id).toUpperCase()}`
    : null
}
function normalizeRow(row, jiraIdx) {
  if (jiraIdx < 0 || !row) return row
  const r = [...row]
  r[jiraIdx] = extractJiraId(r[jiraIdx])
  return r
}
function buildHyperlinks(row, jiraIdx) {
  if (jiraIdx < 0 || !row) return {}
  const url = jiraUrl(row[jiraIdx])
  return url ? { [jiraIdx]: url } : {}
}

const CELL_INPUT = {
  width: '100%', border: 'none', background: 'transparent',
  fontSize: 12, padding: '6px 10px', color: 'var(--text-primary)',
  outline: 'none',
}
const FORM_FIELD = {
  width: '100%', fontSize: 13, padding: '5px 8px',
  border: '1px solid var(--border)', borderRadius: 4,
  background: 'var(--bg)', color: 'var(--text)',
}

const TYPE_META = {
  'Bug':         { symbol: '🐞', bg: '#ffebee', color: '#c62828', border: '#ef9a9a' },
  'Story':       { symbol: '📋', bg: '#e3f2fd', color: '#1565c0', border: '#90caf9' },
  'Task':        { symbol: '✔',  bg: '#e8f5e9', color: '#1b5e20', border: '#a5d6a7' },
  'New Feature': { symbol: '✨', bg: '#f3e5f5', color: '#6a1b9a', border: '#ce93d8' },
  'Improvement': { symbol: '⬆', bg: '#fff3e0', color: '#e65100', border: '#ffcc80' },
  'Epic':        { symbol: '⚡', bg: '#ede7f6', color: '#4527a0', border: '#b39ddb' },
  'Sub-task':    { symbol: '↳',  bg: '#fafafa', color: '#546e7a', border: '#cfd8dc' },
  'Feature':     { symbol: '✨', bg: '#f3e5f5', color: '#6a1b9a', border: '#ce93d8' },
}

function TypeBadge({ type }) {
  if (!type) return null
  const m = TYPE_META[type] || { symbol: '◆', bg: 'var(--surface)', color: 'var(--text-muted)', border: 'var(--border)' }
  return (
    <span title={type} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, padding: '1px 5px', borderRadius: 4, flexShrink: 0,
      background: m.bg, color: m.color, border: `1px solid ${m.border}`,
      whiteSpace: 'nowrap', lineHeight: 1.4, marginRight: 2,
    }}>
      {m.symbol}
    </span>
  )
}

const PR_STATUS_COLORS = {
  OPEN:     { bg: '#1565c0', color: '#fff',    border: '#0d47a1' },
  MERGED:   { bg: '#2e7d32', color: '#fff',    border: '#1b5e20' },
  DECLINED: { bg: '#c62828', color: '#fff',    border: '#b71c1c' },
  CLOSED:   { bg: '#546e7a', color: '#fff',    border: '#37474f' },
  DRAFT:    { bg: '#6a1b9a', color: '#fff',    border: '#4a148c' },
}

// ─── PrGpPanel ───────────────────────────────────────────────────────────────
function PrGpPanel({ prsVal, prStatusVal, gpVal, onChange }) {
  const parsePairs = (p, st, g) => {
    const ps  = (p  || '').split('|').map(s => s.trim()).filter(Boolean)
    const sts = (st || '').split('|').map(s => s.trim())
    const gs  = (g  || '').split('|').map(s => s.trim())
    if (ps.length === 0) return [{ pr: '', prStatus: '', gp: '' }]
    return ps.map((pr, i) => ({ pr, prStatus: sts[i] || '', gp: gs[i] || '' }))
  }
  const [pairs, setPairs] = useState(() => parsePairs(prsVal, prStatusVal, gpVal))

  useEffect(() => {
    setPairs(parsePairs(prsVal, prStatusVal, gpVal))
  }, [prsVal, prStatusVal, gpVal])

  const serialize = (ps) => {
    const active = ps.filter(p => p.pr || p.gp || p.prStatus)
    return [
      active.map(p => p.pr).join('|'),
      active.map(p => p.prStatus).join('|'),
      active.map(p => p.gp).join('|'),
    ]
  }
  const update = (i, field, v) => setPairs(prev => prev.map((p, j) => j === i ? { ...p, [field]: v } : p))
  const add    = () => setPairs(prev => [...prev, { pr: '', prStatus: '', gp: '' }])
  const remove = (i) => {
    const next = pairs.filter((_, j) => j !== i)
    const emp  = next.length === 0 ? [{ pr: '', prStatus: '', gp: '' }] : next
    setPairs(emp)
    const [ps, sts, gs] = serialize(emp)
    onChange(ps, sts, gs)
  }
  const onBlur = () => { const [ps, sts, gs] = serialize(pairs); onChange(ps, sts, gs) }

  const inp = { fontSize: 12, padding: '4px 7px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', color: 'var(--text-primary)', outline: 'none' }
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>PRs &amp; GP</div>
      {pairs.map((pair, i) => {
        const sc = PR_STATUS_COLORS[pair.prStatus?.toUpperCase()] || null
        return (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
            {/* PR URL + status grouped in a contour */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 5,
              border: `1px solid ${sc ? sc.border : 'var(--border)'}`, borderRadius: 6,
              padding: '2px 6px', background: sc ? `${sc.bg}22` : 'var(--surface)',
              transition: 'border-color 0.15s' }}
              onFocusCapture={e => e.currentTarget.style.borderColor = sc ? sc.border : 'var(--primary,#1976d2)'}
              onBlurCapture={e => e.currentTarget.style.borderColor = sc ? sc.border : 'var(--border)'}
            >
              <input value={pair.pr} placeholder="PR URL" onChange={e => update(i, 'pr', e.target.value)} onBlur={onBlur}
                style={{ flex: 1, fontSize: 12, border: 'none', outline: 'none', background: 'transparent',
                  color: 'var(--text-primary)', padding: '3px 2px', minWidth: 0 }} />
              {sc ? (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 5,
                  background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`,
                  whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {pair.prStatus}
                </span>
              ) : (
                <input value={pair.prStatus} placeholder="Status" onChange={e => update(i, 'prStatus', e.target.value)} onBlur={onBlur}
                  style={{ width: 64, fontSize: 12, border: 'none', outline: 'none', background: 'transparent',
                    color: 'var(--text-primary)', padding: '3px 2px', flexShrink: 0 }} />
              )}
            </div>
            {/* GP Job */}
            <input value={pair.gp} placeholder="GP Job" onChange={e => update(i, 'gp', e.target.value)}
              onFocus={e => e.target.style.borderColor = 'var(--primary,#1976d2)'}
              onBlur={e => { e.target.style.borderColor = 'var(--border)'; onBlur() }}
              style={{ ...inp, flex: 1 }} />
            <button onClick={() => remove(i)} title="Remove PR"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)', padding: '2px 4px', opacity: 0.45, flexShrink: 0 }}
              onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = '#c62828' }}
              onMouseLeave={e => { e.currentTarget.style.opacity = 0.45; e.currentTarget.style.color = 'var(--text-muted)' }}>✕</button>
          </div>
        )
      })}
      <button onClick={add}
        style={{ fontSize: 11, color: 'var(--primary,#1976d2)', background: 'none', border: '1px dashed rgba(25,118,210,0.35)', borderRadius: 4, cursor: 'pointer', padding: '2px 10px', marginTop: 2 }}>
        + Add PR
      </button>
    </div>
  )
}

const _APP_SLUG = { PAYOR:'payor', CLASSIC:'classic', CONNECTOR:'connector', ENROLLMENT:'enrollment', PIK:'pik' }
function localAppPath(application) {
  const slug = _APP_SLUG[(application||'').toUpperCase()] || (application||'').toLowerCase()
  return slug ? `/local-app/${slug}` : null
}

// ─── SetupProgress ───────────────────────────────────────────────────────────
function SetupProgress({ setup, onNavigate, onConfirmRevert, onAbort }) {
  if (!setup) return null
  const STATUS_ICON = { ok: '✓', warning: '⚠', error: '✗' }
  const STATUS_COLOR = { ok: '#2e7d32', warning: '#e65100', error: '#c62828' }
  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Branch Setup</div>
      {setup.phase === 'running' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
          <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> Setting up branch…
        </div>
      ) : setup.phase === 'stale' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, color: '#e65100', fontWeight: 600 }}>⚠ Uncommitted changes detected in repository:</div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', background: 'rgba(230,81,0,0.06)', border: '1px solid rgba(230,81,0,0.25)', borderRadius: 4, padding: '6px 10px', maxHeight: 120, overflowY: 'auto' }}>
            {(setup.staleFiles || []).map((f, i) => <div key={i} style={{ color: 'var(--text-primary)', lineHeight: 1.6 }}>{f}</div>)}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={onConfirmRevert}
              style={{ fontSize: 12, padding: '4px 14px', background: '#e65100', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>
              Revert &amp; Proceed
            </button>
            <button onClick={onAbort}
              style={{ fontSize: 12, padding: '4px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', color: 'var(--text)' }}>
              Abort
            </button>
          </div>
        </div>
      ) : (
        <>
          {(setup.steps || []).map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, fontSize: 12, marginBottom: 3, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <span style={{ color: STATUS_COLOR[s.status] || 'var(--text-muted)', flexShrink: 0 }}>{STATUS_ICON[s.status] || '·'}</span>
              <span style={{ fontWeight: 500, flexShrink: 0 }}>{s.label}</span>
              {s.detail && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>— {s.detail}</span>}
            </div>
          ))}
          {setup.phase === 'done' && setup.localAppPath && (
            <button onClick={() => onNavigate(setup.localAppPath)}
              style={{ marginTop: 6, fontSize: 12, padding: '4px 14px', background: 'var(--primary,#1976d2)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>
              Go to {setup.appName} →
            </button>
          )}
          {setup.phase === 'error' && setup.error && (
            <div style={{ fontSize: 11, color: '#c62828', marginTop: 4 }}>{setup.error}</div>
          )}
        </>
      )}
    </div>
  )
}

// ─── SprintDetail ────────────────────────────────────────────────────────────
function SprintDetail({ sprint: sprintProp, onBack, onRename }) {
  const navigate = useNavigate()
  const [file, setFile]         = useState(sprintProp.file)
  const [activeTab, setActiveTab] = useState(sprintProp._openTab || 'My Task')
  const [highlightJira, setHighlightJira] = useState((sprintProp._highlightJira || '').toUpperCase())
  const highlightRowRef = useRef(null)
  const [tabRows, setTabRows]   = useState({})   // {tab: string[][]}
  const [tabCols, setTabCols]   = useState({})   // {tab: string[]}
  const [newRows, setNewRows]   = useState({})   // {tab: string[]}
  const [loading, setLoading]   = useState(true)
  const [loadErr, setLoadErr]   = useState(null)
  const origRef = useRef({})                      // {tab: string[][]} last saved

  // Rename
  const [renaming, setRenaming]   = useState(false)
  const [renameTo, setRenameTo]   = useState('')
  const [renameErr, setRenameErr] = useState(null)
  const [renameBusy, setRenameBusy] = useState(false)

  const [sprintUrl,     setSprintUrl]     = useState('')
  const [qaNames,       setQaNames]       = useState([])

  // Board refresh
  const [boardBusy,   setBoardBusy]   = useState(false)
  const [boardResult, setBoardResult] = useState(null)

  // Freeze Dev — default true (frozen); persisted per sprint file in localStorage
  const [freezeDev, setFreezeDev] = useState(() => {
    try { return localStorage.getItem(`freeze_dev_${sprintProp.file}`) !== 'false' } catch { return true }
  })
  useEffect(() => {
    try { setFreezeDev(localStorage.getItem(`freeze_dev_${file}`) !== 'false') } catch {}
  }, [file])
  const toggleFreeze = () => {
    const next = !freezeDev
    setFreezeDev(next)
    try { localStorage.setItem(`freeze_dev_${file}`, String(next)) } catch {}
  }

  // My developer
  const [myDeveloper, setMyDeveloper] = useState('')
  useEffect(() => {
    fetch(`${API}/my-developer`).then(r => r.json())
      .then(d => { if (d.ok && d.developer) setMyDeveloper(d.developer) })
      .catch(() => {})
  }, [])

  const doRefreshBoard = async () => {
    setBoardBusy(true); setBoardResult(null)
    try {
      const d = await fetch(`${API}/refresh-board`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, freeze_dev: freezeDev }),
      }).then(r => r.json())
      if (d.ok) { setBoardResult({ count: d.count, total: d.total_board, message: d.message }); loadData() }
      else setBoardResult({ error: d.error })
    } catch(e) { setBoardResult({ error: String(e) }) }
    finally { setBoardBusy(false) }
  }

  // Row ops
  const [savingKey, setSavingKey]         = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [rowErr, setRowErr]               = useState(null)
  const [expandedRows, setExpandedRows]   = useState(new Set())
  const [filterDev, setFilterDev]         = useState('')
  const [filterStatus, setFilterStatus]   = useState('')
  const saveTimers = useRef({})

  // Sprint Log state
  const [logDeleteConfirm, setLogDeleteConfirm] = useState(null)
  const [logSaving, setLogSaving] = useState({})

  // Sprint Summary state
  const [summaryData,    setSummaryData]    = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryErr,     setSummaryErr]     = useState(null)
  // Project Summary state
  const [psData,    setPsData]    = useState(null)
  const [psLoading, setPsLoading] = useState(false)
  const [psSyncing, setPsSyncing] = useState(false)
  const [psErr,     setPsErr]     = useState(null)
  const [psOpen,    setPsOpen]    = useState({})
  const [psCopied,  setPsCopied]  = useState('')   // '' | 'copying' | 'copied'
  const [psNewEpic, setPsNewEpic] = useState('')
  const [tasks,     setTasks]     = useState([])
  const [taskErr,   setTaskErr]   = useState(null)
  const [taskLoading, setTaskLoading] = useState(false)
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [showDone,  setShowDone]  = useState(false)
  const defaultDue = () => { const d = new Date(); d.setDate(d.getDate() + 3); return d.toISOString().slice(0, 10) }
  const blankTask = () => ({ title: '', description: '', due: defaultDue(), important: 'Yes', urgent: 'Auto', delegate_to: '' })
  const [taskDraft, setTaskDraft] = useState(blankTask)
  const [psAdding,  setPsAdding]  = useState(false)
  const logTimers = useRef({})

  // Create Project modal state
  const [projectModal, setProjectModal] = useState(null)

  const toggleRow = (ri) => setExpandedRows(p => {
    const s = new Set(p); s.has(ri) ? s.delete(ri) : s.add(ri); return s
  })

  // Debounced save — allows focus to move between main row and its detail panel
  const scheduleRowSave  = (tab, ri)  => {
    const key = `${tab}:${ri}`
    clearTimeout(saveTimers.current[key])
    saveTimers.current[key] = setTimeout(() => saveRow(tab, ri), 250)
  }
  const scheduleNewRowSave = (tab) => {
    const t   = tab === 'My Stories' ? 'Sprint Board' : tab
    const key = `${t}:new`
    clearTimeout(saveTimers.current[key])
    saveTimers.current[key] = setTimeout(() => saveNewRow(t), 250)
  }

  const psTimers = useRef({})
  // Keep refs so async callbacks see fresh values
  const tabRowsRef = useRef(tabRows)
  const newRowsRef = useRef(newRows)
  const tabColsRef = useRef(tabCols)
  useEffect(() => { tabRowsRef.current = tabRows }, [tabRows])
  useEffect(() => { newRowsRef.current = newRows }, [newRows])
  useEffect(() => { tabColsRef.current = tabCols }, [tabCols])

  const loadData = () => {
    setLoading(true); setLoadErr(null)
    fetch(`${API}/data?file=${encodeURIComponent(file)}`)
      .then(r => r.json())
      .then(d => {
        if (!d.ok) { setLoadErr(d.error); return }
        const rows = {}, cols = {}, nrows = {}
        DATA_SHEETS.forEach(s => {
          const sh = d.sheets[s] || { columns: [], rows: [] }
          const ji = sh.columns.indexOf('JIRA ID')
          rows[s]  = sh.rows.map(r => normalizeRow([...r], ji))
          cols[s]  = sh.columns
          nrows[s] = Array(sh.columns.length).fill('')
        })
        // Sprint Log
        const sl = d.sheets['Sprint Log'] || { columns: ['S.No', 'Date', 'Notes', 'Status'], rows: [] }
        rows['Sprint Log'] = sl.rows; cols['Sprint Log'] = sl.columns
        setTabRows(rows); setTabCols(cols); setNewRows(nrows)
        origRef.current = Object.fromEntries(DATA_SHEETS.map(s => [s, rows[s].map(r => [...r])]))
        if (d.sprint_url) setSprintUrl(d.sprint_url)
        if (d.qa_names)   setQaNames(d.qa_names)
      })
      .catch(e => setLoadErr(String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(loadData, [file])

  // Scroll to highlighted row once data loads
  useEffect(() => {
    if (highlightJira && highlightRowRef.current) {
      setTimeout(() => highlightRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120)
    }
  }, [highlightJira, tabRows])

  // ── cell handlers ──
  const jiraIdx = (tab) => (tabColsRef.current[tab] || []).indexOf('JIRA ID')

  const cellChange = (tab, ri, ci, v) => {
    const val = ci === jiraIdx(tab) ? extractJiraId(v) : v
    setTabRows(p => { const rows = p[tab].map(r=>[...r]); rows[ri][ci] = val; return { ...p, [tab]: rows } })
  }

  const newCellChange = (tab, ci, v) => {
    const t   = tab === 'My Stories' ? 'Sprint Board' : tab
    const val = ci === jiraIdx(t) ? extractJiraId(v) : v
    setNewRows(p => { const row = [...(p[t]||[])]; row[ci] = val; return { ...p, [t]: row } })
  }

  // ── save data row on blur ──
  const saveRow = async (tab, ri) => {
    const rows = tabRowsRef.current[tab] || []
    const orig = origRef.current[tab] || []
    if (JSON.stringify(rows[ri]) === JSON.stringify(orig[ri])) return
    const key = `${tab}:${ri}`
    setSavingKey(key); setRowErr(null)
    try {
      const ji = jiraIdx(tab)
      const d = await fetch(`${API}/row/update`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, sheet: tab, row_index: ri, values: rows[ri], hyperlinks: buildHyperlinks(rows[ri], ji) }),
      }).then(r => r.json())
      if (d.ok) origRef.current = { ...origRef.current, [tab]: tabRowsRef.current[tab].map(r=>[...r]) }
      else setRowErr(d.error)
    } catch(e) { setRowErr(String(e)) }
    finally { setSavingKey(p => p === key ? null : p) }
  }

  // ── save new row on blur ──
  const saveNewRow = async (tab) => {
    const row = newRowsRef.current[tab] || []
    if (!row.some(v => String(v).trim())) return
    const key = `${tab}:new`
    setSavingKey(key); setRowErr(null)
    try {
      const ji = jiraIdx(tab)
      const d = await fetch(`${API}/row/add`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, sheet: tab, values: row, hyperlinks: buildHyperlinks(row, ji) }),
      }).then(r => r.json())
      if (d.ok) {
        const saved = [...row]
        setTabRows(p => {
          const rows = [...(p[tab]||[]), saved]
          origRef.current = { ...origRef.current, [tab]: rows.map(r=>[...r]) }
          return { ...p, [tab]: rows }
        })
        setNewRows(p => ({ ...p, [tab]: Array((tabCols[tab]||[]).length).fill('') }))
      } else setRowErr(d.error)
    } catch(e) { setRowErr(String(e)) }
    finally { setSavingKey(p => p === key ? null : p) }
  }

  // ── delete row ──
  const deleteRow = async (tab, ri) => {
    setRowErr(null)
    try {
      const d = await fetch(`${API}/row/delete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, sheet: tab, row_index: ri }),
      }).then(r => r.json())
      if (d.ok) {
        setTabRows(p => {
          const rows = p[tab].filter((_,i) => i !== ri)
          origRef.current = { ...origRef.current, [tab]: rows.map(r=>[...r]) }
          return { ...p, [tab]: rows }
        })
      } else setRowErr(d.error)
    } catch(e) { setRowErr(String(e)) }
    setDeleteConfirm(null)
  }

  // ── create project ──
  const openProjectPreview = async (origIdx, row, isAdhoc = false) => {
    const jiraId    = jiraCol     >= 0 ? (row[jiraCol]     ?? '') : ''
    const story     = storyColIdx >= 0 ? (row[storyColIdx] ?? '') : ''
    const issueType = typeColIdx  >= 0 ? (row[typeColIdx]  ?? '') : ''
    const developer = devColIdx   >= 0 ? (row[devColIdx]   ?? '') : ''
    setProjectModal({ origIdx, isAdhoc, jiraId, story, issueType, developer, team, sprints: [stem], branches: [], loading: true, rule: null, isDefault: false, error: null, creating: false, created: null, createError: null, confirmDeleteBranch: null, deleteBranchBusy: false, deleteBranchError: null, deleteBranchWarning: null })
    try {
      const d = await fetch(`${API}/project-preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jira_id: jiraId, story, issue_type: issueType }),
      }).then(r => r.json())
      if (d.ok) {
        setProjectModal(prev => prev?.origIdx === origIdx ? {
          ...prev, loading: false, branches: [d.branch_name], rule: d.rule, isDefault: d.is_default,
          alreadyExists: d.project_exists, existingFile: d.project_file,
          projectInfo: d.project_info || {},
          newBranchInput: d.next_branch_suggestion || '',
          fixVersions: d.fix_versions || [],
          codeFreezeDate: d.code_freeze_date || null,
          releaseDate: d.release_date || null,
          addBranchBusy: false, addBranchDone: false, addBranchError: null,
        } : prev)
      } else {
        setProjectModal(prev => prev?.origIdx === origIdx ? { ...prev, loading: false, error: d.error } : prev)
      }
    } catch(e) {
      setProjectModal(prev => prev?.origIdx === origIdx ? { ...prev, loading: false, error: String(e) } : prev)
    }
  }

  const handleCloneWF = async () => {
    if (!projectModal || projectModal.cloneWFLoading) return
    setProjectModal(prev => ({ ...prev, cloneWFLoading: true }))
    const fv  = (projectModal.fixVersions || [])[0] || ''
    const app = (projectModal.rule?.application || 'Payor').toLowerCase()
    let payorVersion = ''
    if (fv && app) {
      try {
        const d = await fetch('/api/project-management/sprint/resolve-release-branch', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ app, fix_version: fv }),
        }).then(r => r.json())
        if (d.ok && d.release_branch) {
          payorVersion = d.release_branch.replace(/^release-/i, '')
        }
      } catch {}
    }
    navigate('/clone-projects/new', { state: { ticket: projectModal.jiraId, payorVersion } })
  }

  const doCreateProject = async () => {
    if (!projectModal || projectModal.creating) return
    setProjectModal(prev => ({ ...prev, creating: true, createError: null }))
    try {
      const d = await fetch(`${API}/project-create`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jira_id: projectModal.jiraId, story: projectModal.story,
          issue_type: projectModal.issueType,
          branches: (projectModal.branches || []).filter(b => b.trim()),
          developer: projectModal.developer, application: projectModal.rule?.application || '',
          sprints: (projectModal.sprints || []).filter(s => s.trim()),
          team: projectModal.team || '',
          code_freeze_date: projectModal.codeFreezeDate || '',
          release_date: projectModal.releaseDate || '',
        }),
      }).then(r => r.json())
      if (d.ok) {
        const firstBranch = (projectModal.branches || []).find(b => b.trim()) || ''
        const app = projectModal.rule?.application || ''
        setProjectModal(prev => ({ ...prev, creating: false, created: d.file }))
        doSetupBranch(firstBranch, app)
      } else {
        setProjectModal(prev => ({ ...prev, creating: false, createError: d.error }))
      }
    } catch(e) {
      setProjectModal(prev => ({ ...prev, creating: false, createError: String(e) }))
    }
  }

  const updateSprint = (i, v) => setProjectModal(prev => { const s=[...(prev.sprints||[])]; s[i]=v; return {...prev,sprints:s} })
  const addSprint    = () => setProjectModal(prev => ({ ...prev, sprints: [...(prev.sprints||[]), ''] }))
  const removeSprint = (i) => setProjectModal(prev => ({ ...prev, sprints: (prev.sprints||[]).filter((_,j)=>j!==i) }))
  const updateBranch = (i, v) => setProjectModal(prev => { const b=[...(prev.branches||[])]; b[i]=v; return {...prev,branches:b} })
  const addBranch    = () => setProjectModal(prev => ({ ...prev, branches: [...(prev.branches||[]), ''] }))
  const removeBranch = (i) => setProjectModal(prev => ({ ...prev, branches: (prev.branches||[]).filter((_,j)=>j!==i) }))

  const doAddBranch = async () => {
    if (!projectModal || projectModal.addBranchBusy || !projectModal.newBranchInput?.trim()) return
    setProjectModal(prev => ({ ...prev, addBranchBusy: true, addBranchError: null }))
    try {
      const d = await fetch(`${API}/project-add-branch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jira_id: projectModal.jiraId, branch_name: projectModal.newBranchInput.trim(), team: projectModal.team || '' }),
      }).then(r => r.json())
      if (d.ok) {
        const branchAdded = projectModal.newBranchInput?.trim() || ''
        const app = projectModal.rule?.application || ''
        setProjectModal(prev => ({
          ...prev, addBranchBusy: false, addBranchDone: true,
          projectInfo: { ...(prev.projectInfo||{}), [d.label]: prev.newBranchInput },
        }))
        doSetupBranch(branchAdded, app)
      } else {
        setProjectModal(prev => ({ ...prev, addBranchBusy: false, addBranchError: d.error }))
      }
    } catch(e) {
      setProjectModal(prev => ({ ...prev, addBranchBusy: false, addBranchError: String(e) }))
    }
  }

  const doSetupBranch = async (branchName, application, confirmRevert = false) => {
    if (!branchName || !application) return
    setProjectModal(prev => prev ? ({ ...prev, setup: { phase: 'running', steps: [], error: null, localAppPath: null, appName: null } }) : prev)
    try {
      const d = await fetch(`${API}/project-setup-branch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch_name: branchName, application, confirm_revert: confirmRevert }),
      }).then(r => r.json())
      if (d.stale_files) {
        setProjectModal(prev => prev ? ({
          ...prev,
          setup: {
            phase: 'stale', steps: d.steps || [], staleFiles: d.changed_files || [],
            error: null, localAppPath: null, appName: application,
            _branchName: branchName, _application: application,
          },
        }) : prev)
      } else {
        setProjectModal(prev => prev ? ({
          ...prev,
          setup: {
            phase: d.ok ? 'done' : 'error',
            steps: d.steps || [],
            error: d.ok ? null : (d.error || 'Setup failed'),
            localAppPath: d.local_app_path || null,
            appName: d.app_name || application,
          },
        }) : prev)
      }
    } catch(e) {
      setProjectModal(prev => prev ? ({
        ...prev, setup: { phase: 'error', steps: [], error: String(e), localAppPath: null, appName: null },
      }) : prev)
    }
  }

  const doDeleteBranch = async () => {
    const { label, name } = projectModal.confirmDeleteBranch || {}
    if (!label || !name || projectModal.deleteBranchBusy) return
    const application = projectModal.rule?.application || projectModal.projectInfo?.Application || ''
    setProjectModal(prev => ({ ...prev, deleteBranchBusy: true, deleteBranchError: null, deleteBranchWarning: null }))
    try {
      const d = await fetch(`${API}/project-delete-branch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jira_id: projectModal.jiraId, branch_name: name, branch_label: label, application, team: projectModal.team || '' }),
      }).then(r => r.json())
      if (d.ok) {
        const newInfo = { ...(projectModal.projectInfo || {}) }
        delete newInfo[label]
        setProjectModal(prev => ({ ...prev, deleteBranchBusy: false, confirmDeleteBranch: null, projectInfo: newInfo }))
      } else if (d.blocked) {
        setProjectModal(prev => ({ ...prev, deleteBranchBusy: false, confirmDeleteBranch: null, deleteBranchWarning: d.error }))
      } else {
        setProjectModal(prev => ({ ...prev, deleteBranchBusy: false, confirmDeleteBranch: null, deleteBranchError: d.error }))
      }
    } catch(e) {
      setProjectModal(prev => ({ ...prev, deleteBranchBusy: false, confirmDeleteBranch: null, deleteBranchError: String(e) }))
    }
  }

  // ── rename ──
  const doRename = async () => {
    if (!renameTo.trim()) { setRenameErr('Name required'); return }
    setRenameBusy(true); setRenameErr(null)
    try {
      const d = await fetch(`${API}/rename`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, new_name: renameTo.trim() }),
      }).then(r => r.json())
      if (d.ok) {
        const old = file
        setFile(d.new_file)
        setRenaming(false)
        onRename?.(old, d.new_file)
      } else setRenameErr(d.error)
    } catch(e) { setRenameErr(String(e)) }
    finally { setRenameBusy(false) }
  }

  // Delete sprint
  const [deleteBusy,       setDeleteBusy]       = useState(false)
  const [sprintDeleteConfirm, setSprintDeleteConfirm] = useState(false)
  const [deleteDetailErr, setDeleteDetailErr] = useState(null)

  const doDelete = async () => {
    setDeleteBusy(true); setDeleteDetailErr(null)
    try {
      const d = await fetch(`${API}/delete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file }),
      }).then(r => r.json())
      if (d.ok) { onBack?.() }
      else setDeleteDetailErr(d.error)
    } catch(e) { setDeleteDetailErr(String(e)) }
    finally { setDeleteBusy(false) }
  }

  // Complete sprint
  const [completeBusy,       setCompleteBusy]       = useState(false)
  const [sprintCompleteConfirm, setSprintCompleteConfirm] = useState(false)
  const [completeErr, setCompleteErr] = useState(null)

  const doComplete = async () => {
    setCompleteBusy(true); setCompleteErr(null)
    try {
      const d = await fetch(`${API}/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file }),
      }).then(r => r.json())
      if (d.ok) { onBack?.() }
      else setCompleteErr(d.error)
    } catch(e) { setCompleteErr(String(e)) }
    finally { setCompleteBusy(false) }
  }

  const taskCall = (path, body, method = 'POST') => {
    setTaskErr(null)
    return fetch(`${API}/tasks${path}`, method === 'GET' ? undefined : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file, ...body }) })
      .then(r => r.json()).then(d => { if (d.ok) setTasks(d.tasks); else setTaskErr(d.error); return d })
      .catch(e => setTaskErr(String(e)))
  }
  const loadTasks = () => { setTaskLoading(true); fetch(`${API}/tasks?file=${encodeURIComponent(file)}`).then(r => r.json()).then(d => { if (d.ok) setTasks(d.tasks); else setTaskErr(d.error) }).catch(e => setTaskErr(String(e))).finally(() => setTaskLoading(false)) }
  useEffect(() => { if (activeTab === 'My Task') loadTasks() }, [file])
  const addTask = () => {
    if (!taskDraft.title.trim()) { setTaskErr('Task title is required'); return }
    taskCall('/add', taskDraft).then(d => { if (d?.ok) { setTaskDraft(blankTask()); setTaskFormOpen(false) } })
  }
  const updateTask = (id, patch) => {
    setTasks(p => p.map(t => t.id === id ? { ...t, ...patch } : t))
    taskCall('/update', { id, ...patch })
  }
  const deleteTask = (t) => { if (window.confirm(`Delete task "${t.title}"?`)) taskCall('/delete', { id: t.id }) }

  const loadProjectSummary = () => {
    setPsLoading(true); setPsErr(null)
    fetch(`${API}/project-summary?file=${encodeURIComponent(file)}`)
      .then(r => r.json()).then(d => { if (d.ok) setPsData(d); else setPsErr(d.error) })
      .catch(e => setPsErr(String(e))).finally(() => setPsLoading(false))
  }
  const syncProjectSummary = () => {
    setPsSyncing(true); setPsErr(null)
    fetch(`${API}/project-summary/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file }) })
      .then(r => r.json()).then(d => { if (d.ok) loadProjectSummary(); else setPsErr(d.error) })
      .catch(e => setPsErr(String(e))).finally(() => setPsSyncing(false))
  }
  const copyProjectSummary = async () => {
    setPsErr(null); setPsCopied('copying')
    const done = () => { setPsCopied('copied'); setTimeout(() => setPsCopied(''), 2500) }
    let excelErr = ''
    try {
      const d = await fetch(`${API}/project-summary/copy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file }) }).then(r => r.json())
      if (d.ok) { done(); return }
      excelErr = d.error || 'Excel copy failed'
    } catch (e) { excelErr = String(e) }
    // Fallback (no Excel): same layout as the export — one row per current-sprint ticket, only the id is a link
    const cols = ['S.No', 'HINIT', 'HINIT Due Date', 'Epic-JIRA', 'HINIT/Epic goal', 'Current Sprint Target', 'Ticket Details', 'Next Sprint Target', 'Status', 'Risk and Mitigation', 'Comments1', 'Comments2', `SP Done (${psQuarter()})`, `SP Committed (${psQuarter()})`, `Tickets Done (${psQuarter()})`, `Tickets Committed (${psQuarter()})`, 'Velocity (per 2 weeks)']
    const base = (sprintUrl || '').split('/jira/')[0]
    const STATUS_BG = { 'Not Started': '#CFD8DC', 'In Progress': '#BBDEFB', 'At Risk': '#FFE0B2', 'Completed': '#C8E6C9', 'Overdue': '#FFCDD2' }
    const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')
    const a1 = (k) => base ? `<a href="${base}/browse/${k}">${esc(k)}</a>` : esc(k)
    const lines = v => String(v || '').split('\n').map(l => l.trim()).filter(Boolean)
    const split = l => { const m = l.replace(/^•\s*/, '').match(/^([A-Z][A-Z0-9]+-\d+)(.*)$/); return m ? [m[1], m[2].replace(/^[\s-]+/, '')] : [null, l.replace(/^•\s*/, '')] }
    const tsv = [cols.join('\t')]
    const q = v => { const t = String(v ?? ''); return /[\t\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }
    let body = ''
    ;(psData?.rows || []).forEach((r, i) => {
      const cur = lines(r['Current Sprint Target']), n = Math.max(1, cur.length)
      const nextHtml = lines(r['Next Sprint Target']).map(l => { const [k, rest] = split(l); return k ? `• ${a1(k)}${esc(' - ' + rest)}` : `• ${esc(rest)}` }).join('<br>')
      const span = (html, bg) => `<td rowspan="${n}" valign="top"${bg ? ` bgcolor="${bg}"` : ''}>${html}</td>`
      for (let t = 0; t < n; t++) {
        const [k, rest] = cur[t] ? split(cur[t]) : [null, '']
        let row = ''
        if (t === 0) row += span(i + 1) + span(r['HINIT'] ? a1(r['HINIT']) : '') + span(esc(r['HINIT Due Date'])) + span(a1(r['Epic-JIRA'])) + span(esc(r['HINIT/Epic goal']))
        row += `<td valign="top">${cur[t] ? '• ' + (k ? a1(k) : esc(rest)) : ''}</td><td valign="top">${k ? esc(rest) : ''}</td>`
        if (t === 0) row += span(nextHtml) + span(esc(r['Status']), STATUS_BG[r['Status']]) + span(esc(r['Risk and Mitigation'])) + span(esc(r['Comments1'])) + span(esc(r['Comments2'])) + ['sp_done', 'sp_committed', 'tickets_done', 'tickets_committed'].map(k => span((r.qtr || {})[k] ?? 0)).join('') + span(r.forecast?.velocity ?? 0)
        body += `<tr>${row}</tr>`
        const cells = t === 0
          ? [i + 1, r['HINIT'], r['HINIT Due Date'], r['Epic-JIRA'], r['HINIT/Epic goal'], cur[t] ? '• ' + (k || rest) : '', k ? rest : '', lines(r['Next Sprint Target']).join('\n'), r['Status'], r['Risk and Mitigation'], r['Comments1'], r['Comments2'], ...['sp_done', 'sp_committed', 'tickets_done', 'tickets_committed'].map(k => (r.qtr || {})[k] ?? 0), r.forecast?.velocity ?? 0]
          : ['', '', '', '', '', cur[t] ? '• ' + (k || rest) : '', k ? rest : '', '', '', '', '', '', '', '', '', '', '']
        tsv.push(cells.map(q).join('\t'))
      }
    })
    const QK = ['sp_done', 'sp_committed', 'tickets_done', 'tickets_committed']
    const tot = QK.map(k => Math.round((psData?.rows || []).reduce((a, x) => a + (Number((x.qtr || {})[k]) || 0), 0) * 10) / 10)
    const velT = Math.round((psData?.rows || []).filter(x => x.forecast?.unit === 'SP').reduce((a, x) => a + (x.forecast.velocity || 0), 0) * 10) / 10
    body += `<tr><td colspan="12" align="right"><b>Total</b></td>${tot.map(v => `<td><b>${v}</b></td>`).join('')}<td><b>${velT}</b></td></tr>`
    tsv.push([...Array(11).fill(''), 'Total', ...tot, velT].map(q).join('\t'))
    const html = `<table border="1"><tr>${cols.map(c => `<th bgcolor="#1565C0"><font color="#FFFFFF">${c}</font></th>`).join('')}</tr>${body}</table>`
    const text = tsv.join('\n')
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })])
      done()
    } catch (e) {
      setPsCopied('')
      setPsErr(`Excel copy failed (${excelErr}); browser copy was blocked (${e.name || e}) — keep this window focused and click Copy again.`)
    }
  }
  const psQuarter = () => psData?.quarter || `Q${Math.floor(new Date().getMonth() / 3) + 1} ${new Date().getFullYear()}`
  const psAddEpic = () => {
    const key = psNewEpic.trim()
    if (!key) return
    setPsAdding(true); setPsErr(null)
    fetch(`${API}/project-summary/add-epic`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file, epic: key }) })
      .then(r => r.json()).then(d => { if (d.ok) { setPsData(p => ({ ...p, rows: d.rows })); setPsNewEpic('') } else setPsErr(d.error) })
      .catch(e => setPsErr(String(e))).finally(() => setPsAdding(false))
  }
  const psRemoveEpic = (epic) => {
    if (!window.confirm(`Remove ${epic} from the Project Summary?`)) return
    psPost('remove-epic', { epic })
  }
  const psTargetLines = v => String(v || '').split('\n').map(l => l.trim()).filter(Boolean)
  const psTargetAdd = (epic, cur, line) => psEdit(epic, 'Next Sprint Target', [...psTargetLines(cur), line.startsWith('\u2022') ? line : `\u2022 ${line}`].join('\n'))
  const psTargetRemove = (epic, cur, idx) => psEdit(epic, 'Next Sprint Target', psTargetLines(cur).filter((_, i) => i !== idx).join('\n'))
  const psPost = (path, body) =>
    fetch(`${API}/project-summary/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file, ...body }) })
      .then(r => r.json()).then(d => { if (d.ok) setPsData(p => ({ ...p, rows: d.rows })); else setPsErr(d.error) })
      .catch(e => setPsErr(String(e)))
  const psEdit = (epic, field, value) => {
    setPsData(p => ({ ...p, rows: p.rows.map(r => r['Epic-JIRA'] === epic ? { ...r, [field]: value } : r) }))
    clearTimeout(psTimers.current[epic + field])
    psTimers.current[epic + field] = setTimeout(() => psPost('update', { epic, fields: { [field]: value } }), 800)
  }

  const MY_STORIES      = 'My Stories'
  const DEV_BW_TAB      = 'Dev Bandwidth'
  const SPRINT_LOG_TAB     = 'Sprint Log'
  const SPRINT_SUMMARY_TAB = 'Sprint Summary'
  const PROJECT_SUMMARY_TAB = 'Project Summary'
  const TASKS_TAB = 'My Task'
  const ALL_TABS        = myDeveloper
    ? [TASKS_TAB, MY_STORIES, ...DATA_SHEETS, DEV_BW_TAB, SPRINT_LOG_TAB, SPRINT_SUMMARY_TAB, PROJECT_SUMMARY_TAB]
    : [TASKS_TAB, ...DATA_SHEETS, DEV_BW_TAB, SPRINT_LOG_TAB, SPRINT_SUMMARY_TAB, PROJECT_SUMMARY_TAB]

  const stem    = stemOf(file)
  const today   = new Date().toISOString().slice(0, 10)
  const endDate = parseEndDate(stem)
  const team    = teamFrom(stem)
  const name    = displayName(stem)

  // For My Stories, source data is Sprint Board
  const srcTab    = activeTab === MY_STORIES ? 'Sprint Board' : activeTab
  const cols      = tabCols[srcTab] || []
  const jiraCol   = cols.indexOf('JIRA ID')
  const typeColIdx = cols.indexOf('Type')
  const devColIdx = cols.indexOf('Developer')

  // All rows with original indices; filtered for My Stories
  const allSrcRows  = tabRows[srcTab] || []
  const displayRows = activeTab === MY_STORIES && myDeveloper
    ? allSrcRows.map((r, i) => [r, i]).filter(([r]) => devColIdx >= 0 && r[devColIdx] === myDeveloper)
    : allSrcRows.map((r, i) => [r, i])

  // New row: for My Stories, read/write Sprint Board; pre-fill Developer
  const rawNewRow = newRows[srcTab] || []
  const newRow    = (() => {
    if (activeTab !== MY_STORIES || !myDeveloper) return rawNewRow
    const r = [...rawNewRow]
    if (devColIdx >= 0 && !r[devColIdx]) r[devColIdx] = myDeveloper
    return r
  })()

  const mainIndices = (() => {
    const base = MAIN_COLS.map(n => cols.indexOf(n)).filter(i => i >= 0)
    if (activeTab === 'Adhoc Task') {
      const dai = cols.indexOf('Date Added')
      if (dai >= 0) return [...base, dai]
    }
    return base
  })()
  const detailIndices = DETAIL_COLS.map(n => cols.indexOf(n)).filter(i => i >= 0)
  const _DATE_DETAIL  = new Set(['Code Freeze Date', 'Releasae Date', 'Deployment Date', 'Deployed'])
  const _NOTES_COLS   = new Set(['Notes'])
  const otherDetailIndices   = detailIndices.filter(ci => !_DATE_DETAIL.has(cols[ci]) && !_NOTES_COLS.has(cols[ci]))
  const dateDetailIndices    = detailIndices.filter(ci =>  _DATE_DETAIL.has(cols[ci]))
  const notesDetailIndices   = detailIndices.filter(ci =>  _NOTES_COLS.has(cols[ci]))
  const prsColIdx      = cols.indexOf('PRs')
  const prStatusColIdx = cols.indexOf('PR Status')
  const gpColIdx       = cols.indexOf('GP')
  const statusColIdx  = cols.indexOf('Status')
  const spColIdx      = cols.indexOf('Story Point')
  const storyColIdx   = cols.indexOf('Story')

  // Unique values for filter dropdowns (from full source, not already-filtered view)
  const uniqueDevs     = [...new Set(allSrcRows.map(r => devColIdx    >= 0 ? r[devColIdx]    : '').filter(Boolean))].sort()
  const uniqueStatuses = [...new Set(allSrcRows.map(r => statusColIdx >= 0 ? r[statusColIdx] : '').filter(Boolean))].sort()

  // Apply developer + status filters on top of the My Stories base filter
  const showDevFilter = activeTab === 'Sprint Board'
  const filteredRows  = displayRows.filter(([r]) => {
    if (showDevFilter && filterDev    && (devColIdx    < 0 || r[devColIdx]    !== filterDev))    return false
    if (filterStatus && (statusColIdx < 0 || r[statusColIdx] !== filterStatus)) return false
    return true
  })

  // Status sort order: In Dev → Ready For Dev → New → In Testing → In Doc → Closed → Cancelled
  const STATUS_RANK_LIST = ['in dev','ready for dev','new','in testing','in doc','closed','cancelled','canceled']
  const statusRank = s => {
    const v = (s || '').toLowerCase().trim()
    const i = STATUS_RANK_LIST.indexOf(v)
    return i >= 0 ? i : STATUS_RANK_LIST.length - 3  // unknown before Closed
  }
  // Stories carried over from the previous sprint are flagged "Yes" in the hidden "Carried Over" column
  const carriedIdx = cols.indexOf('Carried Over')
  const isCarried  = r => carriedIdx >= 0 && String(r[carriedIdx] ?? '').trim().toLowerCase() === 'yes'
  const sortedRows = [...filteredRows].sort((a, b) =>
    (isCarried(b[0]) - isCarried(a[0])) ||
    (statusRank(statusColIdx >= 0 ? (a[0][statusColIdx] ?? '') : '') -
     statusRank(statusColIdx >= 0 ? (b[0][statusColIdx] ?? '') : ''))
  )
  const prevCount = sortedRows.filter(([r]) => isCarried(r)).length
  const spNum = r => { const n = spColIdx >= 0 ? Number(r[spColIdx]) : NaN; return Number.isFinite(n) ? n : 0 }
  const prevSP = sortedRows.reduce((s, [r]) => s + (isCarried(r) ? spNum(r) : 0), 0)

  // Adhoc rows shown read-only below Sprint Board rows
  const adhocInBoard = (activeTab === 'Sprint Board' || activeTab === MY_STORIES) ? (() => {
    const adhocCols = tabCols['Adhoc Task'] || []
    return (tabRows['Adhoc Task'] || [])
      .map((adhocRow, ai) => ({
        row: cols.map(colName => { const idx = adhocCols.indexOf(colName); return idx >= 0 ? adhocRow[idx] : null }),
        idx: ai,
      }))
      .filter(({ row }) => row.some(v => v != null && v !== ''))
      .filter(({ row }) => activeTab !== MY_STORIES || !myDeveloper || devColIdx < 0 || row[devColIdx] === myDeveloper)
  })() : []

  // Story points sum across visible rows
  const totalSP = filteredRows.reduce((sum, [r]) => {
    const n = spColIdx >= 0 ? Number(r[spColIdx]) : NaN
    return sum + (Number.isFinite(n) ? n : 0)
  }, 0)

  // Adhoc SP for Sprint Board / My Stories count bar
  const adhocSP = adhocInBoard.reduce((sum, { row }) => {
    if (activeTab === MY_STORIES && myDeveloper && devColIdx >= 0 && row[devColIdx] !== myDeveloper) return sum
    const n = spColIdx >= 0 ? Number(row[spColIdx]) : NaN
    return sum + (Number.isFinite(n) ? n : 0)
  }, 0)

  const currCount = filteredRows.length - prevCount
  const currSP    = (totalSP - prevSP) + adhocSP
  const fmtSP     = n => Math.round(n * 10) / 10
  const strongS   = { color: 'var(--text-primary)' }
  const countsEl = (
    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
      Previous: <strong style={strongS}>{prevCount}</strong> {prevCount === 1 ? 'story' : 'stories'} · <strong style={strongS}>{fmtSP(prevSP)} SP</strong>
      &nbsp;&nbsp;|&nbsp;&nbsp;
      Current: <strong style={strongS}>{currCount}</strong> {currCount === 1 ? 'story' : 'stories'} · <strong style={strongS}>{fmtSP(currSP)} SP</strong>
      &nbsp;&nbsp;|&nbsp;&nbsp;
      Total: <strong style={strongS}>{filteredRows.length}</strong> · <strong style={strongS}>{fmtSP(totalSP + adhocSP)} SP</strong>
    </span>
  )

  // Copy / Export of the visible table (main columns + segment), including adhoc rows shown under Sprint Board / My Stories
  const [copied, setCopied] = useState(false)
  const exportTable = () => {
    const head = [...mainIndices.map(ci => cols[ci]), 'Segment']
    const clean = v => String(v ?? '').replace(/[\r\n]+/g, ' ')
    const body = sortedRows.map(([r]) => [...mainIndices.map(ci => clean(r[ci])), isCarried(r) ? 'Previous Sprint' : 'Current Sprint'])
    adhocInBoard.forEach(({ row }) => body.push([...mainIndices.map(ci => clean(row[ci])), 'Adhoc']))
    return { head, body, jp: mainIndices.indexOf(jiraCol) }
  }
  const copyTable = async () => {
    const { head, body, jp } = exportTable()
    const text = [head, ...body].map(r => r.join('\t')).join('\n')
    const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const cell = (v, i) => (i === jp && v && jiraUrl(v)) ? `<td><a href="${esc(jiraUrl(v))}" style="color:#0563C1;text-decoration:underline">${esc(v)}</a></td>` : `<td>${esc(v)}</td>`
    const html = `<table><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${body.map(r => `<tr>${r.map(cell).join('')}</tr>`).join('')}</table>`
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })])
    } catch { try { await navigator.clipboard.writeText(text) } catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove() } }
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }
  const downloadTable = async () => {
    const { head, body, jp } = exportTable()
    const urls = body.map(r => (jp >= 0 && r[jp]) ? (jiraUrl(r[jp]) || '') : '')
    try {
      const res = await fetch(`${API}/export-xlsx`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ head, rows: body, urls, jp, sheet: activeTab, name: `${stem}_${activeTab.replace(/\s+/g, '_')}` }),
      })
      if (!res.ok) throw new Error('export failed')
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${stem}_${activeTab.replace(/\s+/g, '_')}.xlsx`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } catch (e) { alert('Export failed: ' + e.message) }
  }
  const btnS = { fontSize: 11, padding: '3px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer' }
  const actionsEl = (
    <span style={{ display: 'inline-flex', gap: 6, marginLeft: 12 }}>
      <button onClick={copyTable} style={btnS} title="Copy the table to the clipboard (paste into Excel / mail)">{copied ? '✓ Copied' : 'Copy'}</button>
      <button onClick={downloadTable} style={btnS} title="Download the table as Excel (.xlsx) with clickable JIRA links">Export</button>
    </span>
  )

  return (
    <div style={{ padding: '24px 28px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
        <button className="btn btn-sm" onClick={onBack} style={{ fontSize: 12, marginTop: 3 }}>← Back</button>
        <div style={{ flex: 1 }} />
        {/* Right column: action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          {/* Row 1: team + date + sprint name/rename-input + Rename + Delete */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {team && <span style={{ fontSize: 14, fontWeight: 500 }}>👥 {team}</span>}
            {endDate && <span style={{ fontSize: 13, fontWeight: 500, color: endDate >= today ? '#2e7d32' : '#c62828' }}>{endDate >= today ? `Ends ${endDate}` : `Ended ${endDate}`}</span>}
            {renaming ? (
              <>
                <input
                  value={renameTo}
                  onChange={e => setRenameTo(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') doRename(); if (e.key === 'Escape') { setRenaming(false); setRenameErr(null) } }}
                  autoFocus
                  style={{ fontSize: 15, fontWeight: 700, padding: '3px 8px', border: '1px solid var(--primary, #1976d2)', borderRadius: 4, background: 'var(--bg)', color: 'var(--text)', minWidth: 160 }}
                />
                <button className="btn btn-primary btn-sm" onClick={doRename} disabled={renameBusy}>{renameBusy ? 'Saving…' : 'Save'}</button>
                <button className="btn btn-sm" onClick={() => { setRenaming(false); setRenameErr(null) }}>Cancel</button>
                {renameErr && <span style={{ fontSize: 12, color: '#c62828' }}>{renameErr}</span>}
              </>
            ) : (
              <>
                <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{name}</span>
                <button
                  className="btn btn-sm"
                  onClick={() => { setRenameTo(name); setRenaming(true); setRenameErr(null) }}
                  style={{ fontSize: 11 }}
                >
                  ✏ Rename
                </button>
                {sprintDeleteConfirm ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span style={{ color: '#c62828', fontWeight: 500 }}>Delete this sprint?</span>
                    <button onClick={doDelete} disabled={deleteBusy}
                      style={{ fontSize: 11, padding: '2px 8px', background: '#c62828', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer' }}>
                      {deleteBusy ? 'Deleting…' : 'Yes, delete'}
                    </button>
                    <button onClick={() => { setSprintDeleteConfirm(false); setDeleteDetailErr(null) }}
                      style={{ fontSize: 11, padding: '2px 6px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', color: 'var(--text)' }}>
                      Cancel
                    </button>
                    {deleteDetailErr && <span style={{ color: '#c62828', fontSize: 11 }}>{deleteDetailErr}</span>}
                  </span>
                ) : (
                  <button
                    className="btn btn-sm"
                    onClick={() => setSprintDeleteConfirm(true)}
                    style={{ fontSize: 11, color: '#c62828', border: '1px solid #ef9a9a' }}
                  >
                    🗑 Delete
                  </button>
                )}
              </>
            )}
          </div>
          {/* Row 2: Freeze Dev + Refresh Sprint Board + Complete Sprint (not for completed / previous sprints) */}
          {!sprintProp.previous && <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {sprintUrl && (<>
              <button
                onClick={toggleFreeze}
                title={freezeDev ? 'Dev & QA columns are frozen — click to allow refresh to update Developer from JIRA' : 'Dev & QA columns are live — click to freeze them on refresh'}
                style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap',
                  fontWeight: 600,
                  background: freezeDev ? 'rgba(230,115,0,0.12)' : 'var(--surface)',
                  color: freezeDev ? '#e65100' : 'var(--text-muted)',
                  border: freezeDev ? '1px solid rgba(230,115,0,0.4)' : '1px solid var(--border)',
                }}
              >
                {freezeDev ? '🔒 Dev Frozen' : '🔓 Freeze Dev'}
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={doRefreshBoard}
                disabled={boardBusy}
                style={{ whiteSpace: 'nowrap' }}
                title={`Sync all tickets from board sprint\n${sprintUrl}`}
              >
                {boardBusy ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Syncing…</> : '↻ Refresh Sprint Board'}
              </button>
            </>)}
            {(() => {
              const canComplete = !endDate || endDate <= today
              return (
                <button
                  onClick={() => canComplete && setSprintCompleteConfirm(true)}
                  disabled={!canComplete}
                  title={canComplete ? 'Generate summary and move sprint to PreviousSprints' : `Available from ${endDate}`}
                  style={{
                    fontSize: 12, padding: '4px 14px', borderRadius: 4, whiteSpace: 'nowrap',
                    fontWeight: 600, border: '1px solid #a5d6a7',
                    background: canComplete ? '#e8f5e9' : 'var(--surface)',
                    color: canComplete ? '#2e7d32' : 'var(--text-muted)',
                    cursor: canComplete ? 'pointer' : 'not-allowed',
                    opacity: canComplete ? 1 : 0.55,
                  }}
                  onMouseEnter={e => { if (canComplete) { e.currentTarget.style.background = '#2e7d32'; e.currentTarget.style.color = '#fff' } }}
                  onMouseLeave={e => { if (canComplete) { e.currentTarget.style.background = '#e8f5e9'; e.currentTarget.style.color = '#2e7d32' } }}
                >
                  ✓ Complete Sprint
                </button>
              )
            })()}
          </div>}
          {/* Complete Sprint confirmation banner */}
          {sprintCompleteConfirm && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              padding: '8px 12px', borderRadius: 4, background: '#f1f8e9', border: '1px solid #c5e1a5', fontSize: 12 }}>
              <span style={{ color: '#2e7d32', fontWeight: 500 }}>
                Complete this sprint? A summary will be generated and the sprint moved to PreviousSprints.
              </span>
              <button
                onClick={doComplete}
                disabled={completeBusy}
                style={{ fontSize: 12, padding: '3px 12px', background: '#2e7d32', color: '#fff',
                  border: 'none', borderRadius: 4, cursor: completeBusy ? 'default' : 'pointer', fontWeight: 600 }}
              >
                {completeBusy ? 'Processing…' : 'Yes, Complete'}
              </button>
              <button
                onClick={() => { setSprintCompleteConfirm(false); setCompleteErr(null) }}
                style={{ fontSize: 12, padding: '3px 10px', background: 'var(--surface)',
                  border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', color: 'var(--text)' }}
              >
                Cancel
              </button>
              {completeErr && <span style={{ color: '#c62828' }}>{completeErr}</span>}
            </div>
          )}
        </div>
      </div>

      {/* Board refresh result banner */}
      {boardResult && (
        <div style={{ marginBottom: 12, fontSize: 12, borderRadius: 4, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 10,
          background: boardResult.error ? '#ffebee' : '#e8f5e9',
          border: `1px solid ${boardResult.error ? '#ef9a9a' : '#a5d6a7'}`,
        }}>
          {boardResult.error
            ? <span style={{ color: '#c62828' }}>Board sync failed: {boardResult.error}</span>
            : boardResult.message
              ? <span style={{ color: '#2e7d32' }}>✓ {boardResult.message}</span>
              : <span style={{ color: '#2e7d32' }}>✓ Synced {boardResult.count} ticket{boardResult.count !== 1 ? 's' : ''} from board ({boardResult.total} in active sprint)</span>
          }
          <button onClick={() => setBoardResult(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)' }}>✕</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, borderBottom: '2px solid var(--border)', marginBottom: 12 }}>
        {ALL_TABS.map(tab => (
          <button key={tab} onClick={() => {
            setActiveTab(tab); setFilterDev(''); setFilterStatus(''); setProjectModal(null)
            if (tab === SPRINT_SUMMARY_TAB) {
              setSummaryData(null); setSummaryErr(null); setSummaryLoading(true)
              fetch(`${API}/summary-data?file=${encodeURIComponent(file)}`)
                .then(r => r.json())
                .then(d => { if (d.ok) setSummaryData(d); else setSummaryErr(d.error) })
                .catch(e => setSummaryErr(String(e)))
                .finally(() => setSummaryLoading(false))
            }
            if (tab === PROJECT_SUMMARY_TAB) loadProjectSummary()
            if (tab === TASKS_TAB) loadTasks()
          }} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '7px 16px', fontSize: 13,
            fontWeight: activeTab === tab ? 700 : 400,
            color: activeTab === tab
              ? tab === MY_STORIES ? '#7b1fa2' : 'var(--primary, #1976d2)'
              : 'var(--text-muted)',
            borderBottom: activeTab === tab
              ? `2px solid ${tab === MY_STORIES ? '#7b1fa2' : 'var(--primary, #1976d2)'}`
              : '2px solid transparent',
            marginBottom: -2,
          }}>{tab === MY_STORIES ? `👤 ${tab}` : tab}</button>
        ))}
        {savingKey && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', paddingRight: 4 }}>
            <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Saving…
          </div>
        )}
      </div>

      {rowErr && (
        <div style={{ marginBottom: 10, fontSize: 12, color: '#c62828', background: '#ffebee', padding: '5px 10px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          {rowErr}
          <button onClick={() => setRowErr(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#c62828' }}>✕</button>
        </div>
      )}

      {/* ── Dev Bandwidth tab ──────────────────────────────────────────── */}
      {activeTab === DEV_BW_TAB && !loading && !loadErr && (() => {
        const BW_SHEETS = ['Sprint Board', 'Adhoc Task']
        const DONE = new Set(['done','closed','released','completed','deployed','merged'])
        const qaSet = new Set(qaNames.map(n => n.toLowerCase()))
        const allBwRows = BW_SHEETS.flatMap(sh => {
          const shCols = tabCols[sh] || []
          const shRows = tabRows[sh] || []
          const _dev = shCols.indexOf('Developer')
          const _sp  = shCols.indexOf('Story Point')
          const _st  = shCols.indexOf('Status')
          const _jid = shCols.indexOf('JIRA ID')
          const _sto = shCols.indexOf('Story')
          const _qa  = shCols.indexOf('QA')
          return shRows
            .filter(r => r.some(v => v))
            .filter(r => {
              const qaVal = _qa >= 0 ? String(r[_qa] || '').trim() : ''
              if (qaVal) return false
              const dev = _dev >= 0 ? String(r[_dev] || '').trim() : ''
              return !qaSet.has(dev.toLowerCase())
            })
            .map(r => ({
              dev:    _dev >= 0 ? (r[_dev] || '') : '',
              sp:     _sp  >= 0 ? (parseFloat(r[_sp]) || 0) : 0,
              status: _st  >= 0 ? (r[_st]  || '') : '',
              jiraId: _jid >= 0 ? (r[_jid] || '') : '',
              story:  _sto >= 0 ? (r[_sto] || '') : '',
            }))
        })
        const byDev = {}
        allBwRows.forEach(r => {
          const key = r.dev || '(Unassigned)'
          if (!byDev[key]) byDev[key] = []
          byDev[key].push(r)
        })
        const BW_STATUS_ORDER = ['in dev','ready for dev','new','in testing','in doc','closed','cancelled','canceled']
        const bwStatusRank = s => { const i = BW_STATUS_ORDER.indexOf((s||'').toLowerCase().trim()); return i >= 0 ? i : BW_STATUS_ORDER.length - 3 }
        const sorted = Object.entries(byDev)
          .map(([dev, rows]) => ({
            dev,
            rows: [...rows].sort((a, b) => bwStatusRank(a.status) - bwStatusRank(b.status) || a.sp - b.sp),
            totalSp: rows.reduce((s, r) => s + r.sp, 0),
            doneSp:  rows.filter(r => DONE.has(r.status.toLowerCase())).reduce((s, r) => s + r.sp, 0),
          }))
          .sort((a, b) => a.totalSp - b.totalSp)
        const statusColor = s => {
          const v = s.toLowerCase()
          if (DONE.has(v)) return { color: '#fff', bg: '#2e7d32' }
          if (['cancelled','abandoned','won\'t do','won\'t fix'].some(x => v.includes(x))) return { color: '#fff', bg: '#757575' }
          if (['in dev','in progress','in review','building'].some(x => v.includes(x))) return { color: '#fff', bg: '#1565c0' }
          if (['new','open','todo','backlog','scheduled'].some(x => v.includes(x))) return { color: '#fff', bg: '#546e7a' }
          return { color: '#fff', bg: '#546e7a' }
        }
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, paddingTop: 4 }}>
            {sorted.map(({ dev, rows, totalSp, doneSp }) => (
              <div key={dev} style={{
                minWidth: 280, maxWidth: 380, flex: '1 1 300px',
                border: '1px solid var(--border)', borderRadius: 8,
                background: 'var(--surface)', overflow: 'hidden',
              }}>
                {/* Developer header */}
                <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'var(--surface2, var(--surface))' }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>👤 {dev}</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {doneSp > 0 && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#2e7d32', color: '#fff', fontWeight: 600 }}>{doneSp} done</span>}
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#1565c0', color: '#fff', fontWeight: 700 }}>{totalSp} SP</span>
                  </div>
                </div>
                {/* Story list */}
                <div style={{ padding: '6px 0' }}>
                  {rows.map((r, i) => {
                    const sc           = statusColor(r.status)
                    const bwCancelled  = /^cancel/i.test(r.status || '')
                    return (
                      <div key={i} style={{ padding: '6px 14px', borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none',
                        display: 'flex', gap: 8, alignItems: 'flex-start', opacity: bwCancelled ? 0.4 : 1 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, minWidth: 26, textAlign: 'center',
                          padding: '2px 6px', borderRadius: 4, background: '#6a1b9a', color: '#fff', flexShrink: 0 }}>
                          {r.sp || '—'}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {r.jiraId && (
                            <a href={jiraUrl(r.jiraId)} target="_blank" rel="noreferrer"
                              style={{ fontSize: 10, color: 'var(--primary,#1565c0)', marginBottom: 1, fontFamily: 'monospace', textDecoration: 'none' }}
                              onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                              onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                            >{r.jiraId}</a>
                          )}
                          <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4,
                            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {r.story || '—'}
                          </div>
                        </div>
                        {r.status && (
                          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 10, whiteSpace: 'nowrap',
                            background: sc.bg, color: sc.color, fontWeight: 600, flexShrink: 0 }}>
                            {r.status}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
            {sorted.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No developer data found.</div>}
          </div>
        )
      })()}

      {/* ── Sprint Log tab ──────────────────────────────────────────────────── */}
      {activeTab === SPRINT_LOG_TAB && !loading && !loadErr && (() => {
        const logRows = tabRows['Sprint Log'] || []
        // col indices: [0]=S.No [1]=Date [2]=Notes [3]=Status
        const LOG_STATUSES = ['Pending', 'In Progress', 'Done']
        const logStatusStyle = s => {
          if (!s || s === 'Pending')     return { border: '1.5px solid #bf6000', bg: 'rgba(191,96,0,0.06)',   badge: '#bf6000' }
          if (s === 'In Progress')       return { border: '1.5px solid #1565c0', bg: 'rgba(21,101,192,0.06)', badge: '#1565c0' }
          if (s === 'Done')              return { border: '1.5px solid #2e7d32', bg: 'rgba(46,125,50,0.06)',  badge: '#2e7d32' }
          return { border: '1.5px solid var(--border)', bg: 'var(--surface)', badge: '#546e7a' }
        }
        const saveLogRow = async (idx) => {
          const rows = tabRowsRef.current['Sprint Log'] || []
          await fetch(`${API}/row/update`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file, sheet: 'Sprint Log', row_index: idx, values: rows[idx] }),
          })
          setLogSaving(p => ({ ...p, [idx]: false }))
        }
        const addLogNote = async () => {
          const sno  = logRows.length + 1
          const date = today
          const res  = await fetch(`${API}/row/add`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file, sheet: 'Sprint Log', values: [sno, date, '', 'Pending'] }),
          }).then(r => r.json())
          if (res.ok)
            setTabRows(p => ({ ...p, 'Sprint Log': [...(p['Sprint Log'] || []), [String(sno), date, '', 'Pending']] }))
        }
        const handleNoteChange = (idx, val) => {
          setTabRows(p => {
            const rows = [...(p['Sprint Log'] || [])]
            rows[idx] = [rows[idx][0], rows[idx][1], val, rows[idx][3] || 'Pending']
            return { ...p, 'Sprint Log': rows }
          })
          clearTimeout(logTimers.current[idx])
          setLogSaving(p => ({ ...p, [idx]: true }))
          logTimers.current[idx] = setTimeout(() => saveLogRow(idx), 900)
        }
        const handleStatusChange = (idx, val) => {
          setTabRows(p => {
            const rows = [...(p['Sprint Log'] || [])]
            rows[idx] = [rows[idx][0], rows[idx][1], rows[idx][2] || '', val]
            return { ...p, 'Sprint Log': rows }
          })
          clearTimeout(logTimers.current[idx])
          setLogSaving(p => ({ ...p, [idx]: true }))
          logTimers.current[idx] = setTimeout(() => saveLogRow(idx), 300)
        }
        const deleteLogNote = async (idx) => {
          const res = await fetch(`${API}/row/delete`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file, sheet: 'Sprint Log', row_index: idx }),
          }).then(r => r.json())
          if (res.ok) {
            setTabRows(p => ({ ...p, 'Sprint Log': (p['Sprint Log'] || []).filter((_, i) => i !== idx) }))
            setLogDeleteConfirm(null)
          }
        }
        return (
          <div style={{ maxWidth: 800 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{logRows.length} {logRows.length === 1 ? 'entry' : 'entries'}</span>
              <button onClick={addLogNote} style={{
                padding: '6px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: 'var(--primary, #1565c0)', color: '#fff', border: 'none', borderRadius: 6,
              }}>+ Add Note</button>
            </div>
            {logRows.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0' }}>No log entries yet.</div>
            )}
            {[...logRows].reverse().map((row, di) => {
              const idx    = logRows.length - 1 - di
              const status = row[3] || 'Pending'
              const ss = logStatusStyle(status)
              return (
                <div key={idx} style={{
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                  padding: '12px 14px', marginBottom: 8,
                  border: ss.border, borderRadius: 8, background: ss.bg,
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 18, paddingTop: 5, textAlign: 'right' }}>
                    {idx + 1}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 88, paddingTop: 5, whiteSpace: 'nowrap' }}>
                    {row[1] || today}
                  </div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <textarea
                      value={row[2] || ''}
                      onChange={e => handleNoteChange(idx, e.target.value)}
                      placeholder="Type your note here…"
                      rows={3}
                      style={{
                        width: '100%', resize: 'vertical', fontSize: 13,
                        padding: '6px 8px', borderRadius: 6, boxSizing: 'border-box',
                        border: '1px solid var(--border)', background: 'var(--bg)',
                        color: 'var(--text)', fontFamily: 'inherit', lineHeight: 1.5,
                      }}
                    />
                    {logSaving[idx] && (
                      <span style={{ position: 'absolute', bottom: 6, right: 8, fontSize: 10, color: 'var(--text-muted)' }}>saving…</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                    <select
                      value={status}
                      onChange={e => handleStatusChange(idx, e.target.value)}
                      style={{
                        fontSize: 11, fontWeight: 700, padding: '3px 6px', borderRadius: 4, cursor: 'pointer',
                        background: ss.badge, color: '#fff', border: 'none', appearance: 'none',
                        minWidth: 90, textAlign: 'center',
                      }}
                    >
                      {LOG_STATUSES.map(s => <option key={s} value={s} style={{ background: '#333', color: '#fff' }}>{s}</option>)}
                    </select>
                    {logDeleteConfirm === idx ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <button onClick={() => deleteLogNote(idx)} style={{
                          fontSize: 11, padding: '3px 8px', cursor: 'pointer',
                          background: '#c62828', color: '#fff', border: 'none', borderRadius: 4,
                        }}>Confirm</button>
                        <button onClick={() => setLogDeleteConfirm(null)} style={{
                          fontSize: 11, padding: '3px 8px', cursor: 'pointer',
                          background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)',
                        }}>Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => setLogDeleteConfirm(idx)} title="Delete note" style={{
                        fontSize: 13, padding: '3px 6px', cursor: 'pointer',
                        background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: '#c62828',
                      }}>🗑</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })()}

      {/* ── My Task tab ───────────────────────────────────────── */}
      {activeTab === TASKS_TAB && (() => {
        const STATUSES = ['To Do', 'In Progress', 'Blocked', 'Done']
        const ST_COLOR = { 'To Do': '#546e7a', 'In Progress': '#1565c0', 'Blocked': '#c62828', 'Done': '#2e7d32' }
        const daysTo = (d) => d ? Math.round((new Date(d + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000) : null
        const isUrgent = (t) => t.urgent === 'Yes' || (t.urgent !== 'No' && daysTo(t.due) !== null && daysTo(t.due) <= 2)
        const quadOf = (t) => { const u = isUrgent(t), i = t.important !== 'No'; return i && u ? 'do' : i ? 'schedule' : u ? 'delegate' : 'delete' }
        const QUADS = {
          do:       { title: 'DO',       sub: 'Urgent + Important — do it now',            color: '#c62828', bg: 'rgba(198,40,40,0.07)' },
          schedule: { title: 'SCHEDULE', sub: 'Important, not urgent — plan a time',       color: '#1565c0', bg: 'rgba(21,101,192,0.07)' },
          delegate: { title: 'DELEGATE', sub: 'Urgent, not important — hand it off',       color: '#ef6c00', bg: 'rgba(239,108,0,0.07)' },
          delete:   { title: 'DELETE',   sub: 'Neither urgent nor important — drop it',    color: '#546e7a', bg: 'rgba(84,110,122,0.07)' },
        }
        const open = tasks.filter(t => t.status !== 'Done')
        const done = tasks.filter(t => t.status === 'Done')
        const inp = { fontSize: 12, padding: '5px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit', boxSizing: 'border-box' }
        const lbl = { fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }
        const statusSel = (t) => <select value={t.status} onChange={e => updateTask(t.id, { status: e.target.value })} style={{ fontSize: 11, fontWeight: 700, padding: '2px 4px', borderRadius: 4, background: ST_COLOR[t.status], color: '#fff', border: 'none', cursor: 'pointer' }}>
          {STATUSES.map(s => <option key={s} value={s} style={{ background: '#333' }}>{s}</option>)}</select>
        const chip = (text, color) => <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 9, background: color, color: '#fff', whiteSpace: 'nowrap', alignSelf: 'flex-start' }}>{text}</span>
        const due = (t) => { const n = daysTo(t.due); return t.due ? <span style={{ color: n !== null && n < 0 && t.status !== 'Done' ? '#c62828' : 'var(--text-muted)' }}>{t.due}{n !== null && t.status !== 'Done' ? (n < 0 ? ` · ${-n}d overdue` : n === 0 ? ' · today' : ` · in ${n}d`) : ''}</span> : <span style={{ color: 'var(--text-muted)' }}>no due date</span> }
        const card = (t, q) => (
          <div key={t.id} style={{ background: 'var(--bg)', border: `1px solid ${QUADS[q].color}`, borderLeft: `5px solid ${QUADS[q].color}`, borderRadius: 5, padding: '6px 8px', marginBottom: 6 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{t.title}</div>
              {chip(isUrgent(t) ? 'Urgent' : 'Not urgent', isUrgent(t) ? '#c62828' : '#90a4ae')}
              {chip(t.important !== 'No' ? 'Important' : 'Not important', t.important !== 'No' ? '#1565c0' : '#90a4ae')}
              {statusSel(t)}
              <button onClick={() => deleteTask(t)} title="Delete task" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#c62828', fontSize: 12, padding: 0 }}>✕</button>
            </div>
            {t.description && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{t.description}</div>}
            <div style={{ fontSize: 11, marginTop: 3 }}>{due(t)}{q === 'delegate' && <> · <span>delegate to: </span>
              <input value={t.delegate_to || ''} placeholder="name" onChange={e => setTasks(p => p.map(x => x.id === t.id ? { ...x, delegate_to: e.target.value } : x))} onBlur={e => updateTask(t.id, { delegate_to: e.target.value })} style={{ ...inp, padding: '1px 5px', width: 110, fontSize: 11 }} /></>}</div>
          </div>)
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{open.length} open task{open.length !== 1 ? 's' : ''} · {done.length} done · urgent = due within 2 days (or marked Urgent)</span>
              <button onClick={() => setTaskFormOpen(o => !o)} style={{ marginLeft: 'auto', fontSize: 12, padding: '5px 12px', background: 'var(--primary, #1565c0)', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' }}>{taskFormOpen ? 'Cancel' : '+ Add Task'}</button>
              <button onClick={loadTasks} style={{ fontSize: 12, padding: '5px 12px', background: 'none', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer', color: 'var(--text-muted)' }}>↺ Reload</button>
            </div>
            {taskErr && <div style={{ color: '#c62828', fontSize: 12, marginBottom: 8 }}>{taskErr}</div>}
            {taskFormOpen && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12, marginBottom: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
                <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Task *</label><input autoFocus value={taskDraft.title} onChange={e => setTaskDraft(d => ({ ...d, title: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') addTask() }} style={{ ...inp, width: '100%' }} placeholder="What needs to be done?" /></div>
                <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Description (optional)</label><input value={taskDraft.description} onChange={e => setTaskDraft(d => ({ ...d, description: e.target.value }))} style={{ ...inp, width: '100%' }} /></div>
                <div><label style={lbl}>Due date (default: 3 days from today)</label><input type="date" value={taskDraft.due} onChange={e => setTaskDraft(d => ({ ...d, due: e.target.value }))} style={{ ...inp, width: '100%' }} /></div>
                <div><label style={lbl}>Important? (moves your goals forward)</label><select value={taskDraft.important} onChange={e => setTaskDraft(d => ({ ...d, important: e.target.value }))} style={{ ...inp, width: '100%' }}><option>Yes</option><option>No</option></select></div>
                <div><label style={lbl}>Urgent?</label><select value={taskDraft.urgent} onChange={e => setTaskDraft(d => ({ ...d, urgent: e.target.value }))} style={{ ...inp, width: '100%' }}><option value="Auto">Auto (from due date)</option><option>Yes</option><option>No</option></select></div>
                <div><label style={lbl}>Delegate to (optional)</label><input value={taskDraft.delegate_to} onChange={e => setTaskDraft(d => ({ ...d, delegate_to: e.target.value }))} style={{ ...inp, width: '100%' }} /></div>
                <div style={{ alignSelf: 'end' }}><button onClick={addTask} style={{ fontSize: 12, padding: '6px 16px', background: 'var(--primary, #1565c0)', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' }}>Add Task</button></div>
              </div>
            )}
            {taskLoading ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div> : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {['do', 'schedule', 'delegate', 'delete'].map(q => {
                    const list = open.filter(t => quadOf(t) === q).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'))
                    return (
                      <div key={q} style={{ background: QUADS[q].bg, border: `1px solid ${QUADS[q].color}`, borderRadius: 8, padding: 10, minHeight: 130 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                          <span style={{ fontWeight: 800, fontSize: 13, color: QUADS[q].color }}>{QUADS[q].title}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{QUADS[q].sub}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: QUADS[q].color }}>{list.length}</span>
                        </div>
                        {list.length ? list.map(t => card(t, q)) : <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>No tasks</div>}
                      </div>)
                  })}
                </div>
                {done.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <a href="#" onClick={e => { e.preventDefault(); setShowDone(s => !s) }} style={{ fontSize: 12 }}>{showDone ? '▾' : '▸'} Done ({done.length})</a>
                    {showDone && done.map(t => <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, padding: '4px 0', color: 'var(--text-muted)' }}>
                      <span style={{ textDecoration: 'line-through', flex: 1 }}>{t.title}</span>{statusSel(t)}
                      <button onClick={() => deleteTask(t)} title="Delete task" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#c62828', fontSize: 12, padding: 0 }}>✕</button></div>)}
                  </div>
                )}
              </>
            )}
          </div>
        )
      })()}

      {/* ── Project Summary tab ─────────────────────────────────────────────── */}
      {activeTab === PROJECT_SUMMARY_TAB && (() => {
        const STATUS_COLOR = { 'Not Started': '#546e7a', 'In Progress': '#1565c0', 'At Risk': '#ef6c00', 'Completed': '#2e7d32', 'Overdue': '#c62828' }
        const th = { fontSize: 11, fontWeight: 700, color: '#fff', background: '#1565c0', padding: '6px 8px', textAlign: 'left', border: '1px solid #BBDEFB', whiteSpace: 'nowrap' }
        const td = (i) => ({ fontSize: 12, padding: '6px 8px', verticalAlign: 'top', background: i % 2 ? 'rgba(21,101,192,0.05)' : 'transparent', border: '1px solid var(--border)' })
        const ta = { width: '100%', minWidth: 150, boxSizing: 'border-box', fontSize: 12, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit', resize: 'vertical' }
        const jiraBase = (sprintUrl || '').split('/jira/')[0]
        const link = (k) => jiraBase ? <a href={`${jiraBase}/browse/${k}`} target="_blank" rel="noreferrer">{k}</a> : k
        const bullets = (text, onRemove) => psTargetLines(text).map((l, li) => {
          const body = l.replace(/^\u2022\s*/, '')
          const m = body.match(/^([A-Z][A-Z0-9]+-\d+)(.*)$/)
          return (
            <div key={li} style={{ display: 'flex', gap: 4, alignItems: 'baseline', marginBottom: 2 }}>
              <span>•</span>
              <span style={{ flex: 1 }}>{m ? <>{link(m[1])}{m[2]}</> : body}</span>
              {onRemove && <button onClick={() => onRemove(li)} title="Remove" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#c62828', fontSize: 11, padding: 0 }}>✕</button>}
            </div>
          )
        })
        const DONE = ['closed', 'done', 'released', 'completed', 'deployed', 'merged', 'bug filed', 'resolved', 'cancelled']
        // Next-sprint candidates: team stories that are still open and not already in the current sprint
        const nextCandidates = (r) => (r.stories || []).filter(x =>
          (x['Team Story'] || '').toLowerCase() === 'yes' &&
          (x['In Current Sprint'] || '').toLowerCase() !== 'yes' &&
          !DONE.includes((x['Status'] || '').trim().toLowerCase()) &&
          !(r['Next Sprint Target'] || '').includes(x['JIRA ID'] + ' '))
        const rows = psData?.rows || []
        const statuses = psData?.statuses || ['Not Started', 'In Progress', 'At Risk', 'Completed', 'Overdue']
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{rows.length} epic{rows.length !== 1 ? 's' : ''} in sprint · progress counts only stories marked <strong>Team ({team})</strong> · Current quarter: <strong>{psQuarter()}</strong> · Team velocity: <strong>{Math.round(rows.filter(x => x.forecast?.unit === 'SP').reduce((a, x) => a + (x.forecast.velocity || 0), 0) * 10) / 10} SP / 2 wks</strong></span>
              <input value={psNewEpic} onChange={e => setPsNewEpic(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') psAddEpic() }}
                placeholder="Epic key, e.g. PAYOR-12345" style={{ marginLeft: 'auto', fontSize: 12, padding: '5px 8px', width: 190, borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }} />
              <button onClick={psAddEpic} disabled={psAdding || !psNewEpic.trim()} style={{ fontSize: 12, padding: '5px 12px', background: 'none', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer', color: 'var(--text)' }}>
                {psAdding ? 'Adding…' : '+ Add Epic'}
              </button>
              <button onClick={copyProjectSummary} disabled={!rows.length || psCopied === 'copying'} title="Copy this tab as tab-separated cells to paste into an Excel tab" style={{ fontSize: 12, padding: '5px 12px', background: 'none', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer', color: psCopied === 'copied' ? '#2e7d32' : 'var(--text)', fontWeight: psCopied ? 700 : 400 }}>
                {psCopied === 'copying' ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5, marginRight: 6 }} />Copying…</> : psCopied === 'copied' ? '✓ Copied' : '⧉ Copy'}
              </button>
              <a href={`${API}/project-summary/export?file=${encodeURIComponent(file)}`} title="Download Project Summary + all Epic tabs as .xlsx" style={{ fontSize: 12, padding: '5px 12px', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)', textDecoration: 'none' }}>⬇ Export</a>
              <button onClick={syncProjectSummary} disabled={psSyncing} style={{ fontSize: 12, padding: '5px 12px', background: 'var(--primary, #1565c0)', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
                {psSyncing ? 'Syncing…' : '⟳ Sync from Jira'}
              </button>
              <button onClick={loadProjectSummary} style={{ fontSize: 12, padding: '5px 12px', background: 'none', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer', color: 'var(--text-muted)' }}>↺ Reload</button>
            </div>
            {psErr && <div style={{ color: '#c62828', fontSize: 13, padding: '6px 0' }}>{psErr}</div>}
            {(psLoading || psSyncing) && <div style={{ padding: 20, textAlign: 'center' }}><span className="spinner" /></div>}
            {!psLoading && !psSyncing && rows.length === 0 && !psErr && (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 24, textAlign: 'center' }}>No epics yet — click “Sync from Jira” to build the Project Summary from this sprint.</div>
            )}
            {rows.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1500 }}>
                  <thead><tr>
                    {['S.No', 'HINIT', 'HINIT Due Date', 'Epic-JIRA', 'HINIT/Epic goal', 'Current Sprint Target', 'Next Sprint Target', 'Status', 'Risk and Mitigation', 'Comments1', 'Comments2', `SP Done (${psQuarter()})`, `SP Committed (${psQuarter()})`, `Tickets Done (${psQuarter()})`, `Tickets Committed (${psQuarter()})`, 'Velocity / 2 wks'].map(h => <th key={h} style={th}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const epic = r['Epic-JIRA'], pr = r.progress || {}, open = !!psOpen[epic]
                      const st = r['Status'], sc = STATUS_COLOR[st] || '#546e7a'
                      return (
                        <React.Fragment key={epic}>
                          <tr>
                            <td style={td(i)}>{i + 1}</td>
                            <td style={td(i)}>
                              {r['HINIT'] ? link(r['HINIT']) : '—'}
                              {(i === 0 || rows[i - 1]['HINIT'] !== r['HINIT']) && (() => {
                                const groups = rows.reduce((a, x) => a.includes(x['HINIT']) ? a : [...a, x['HINIT']], [])
                                const gi = groups.indexOf(r['HINIT'])
                                const btn = (dir, label, disabled) => <button disabled={disabled} onClick={() => psPost('move-hinit', { hinit: r['HINIT'] || '', direction: dir })}
                                  title={`Move this HINIT ${dir}`} style={{ fontSize: 10, padding: '0 5px', marginRight: 2, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.3 : 1, background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text)' }}>{label}</button>
                                return <div style={{ marginTop: 4 }}>{btn('up', '▲', gi === 0)}{btn('down', '▼', gi === groups.length - 1)}</div>
                              })()}
                            </td>
                            <td style={td(i)}>
                              <input type="date" value={(r['HINIT Due Date'] || '').slice(0, 10)} onChange={e => psEdit(epic, 'HINIT Due Date', e.target.value)}
                                style={{ ...ta, minWidth: 120, resize: 'none' }} />
                            </td>
                            <td style={td(i)}>
                              {link(epic)}
                              {(() => {
                                const first = i === 0 || rows[i - 1]['HINIT'] !== r['HINIT']
                                const last  = i === rows.length - 1 || rows[i + 1]['HINIT'] !== r['HINIT']
                                const mb = (dir, label, disabled) => <button disabled={disabled} onClick={() => psPost('move-epic', { epic, direction: dir })}
                                  title={`Move this Epic ${dir} within its HINIT`} style={{ fontSize: 10, padding: '0 5px', marginLeft: 3, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.3 : 1, background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text)' }}>{label}</button>
                                return <>{mb('up', '▲', first)}{mb('down', '▼', last)}</>
                              })()}
                              {r['Source'] === 'Manual' && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-muted)' }}>manual <a href="#" onClick={e => { e.preventDefault(); psRemoveEpic(epic) }} style={{ color: '#c62828' }}>✕ remove</a></span>}
                              <div><button onClick={() => setPsOpen(p => ({ ...p, [epic]: !p[epic] }))} style={{ marginTop: 4, fontSize: 11, padding: '1px 6px', cursor: 'pointer', background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-muted)' }}>
                                {open ? '▾' : '▸'} Stories ({(r.stories || []).length})
                              </button></div>
                            </td>
                            <td style={td(i)}><textarea rows={3} value={r['HINIT/Epic goal'] || ''} onChange={e => psEdit(epic, 'HINIT/Epic goal', e.target.value)} style={{ ...ta, minWidth: 200 }} /></td>
                            <td style={{ ...td(i), minWidth: 260 }}>{bullets(r['Current Sprint Target'])}</td>
                            <td style={{ ...td(i), minWidth: 260 }}>
                              {bullets(r['Next Sprint Target'], li => psTargetRemove(epic, r['Next Sprint Target'], li))}
                              <select value="" onChange={e => { const s0 = nextCandidates(r).find(x => x['JIRA ID'] === e.target.value); if (s0) psTargetAdd(epic, r['Next Sprint Target'], `${s0['JIRA ID']} - ${s0['Story']} [${s0['Status']}]`) }}
                                style={{ ...ta, minWidth: 0, marginTop: 4, cursor: 'pointer' }}>
                                <option value="">{nextCandidates(r).length ? `+ Add ${team} story (${nextCandidates(r).length})…` : 'No open team stories left'}</option>
                                {nextCandidates(r).map(s0 =>
                                  <option key={s0['JIRA ID']} value={s0['JIRA ID']}>{s0['JIRA ID']} - {(s0['Story'] || '').slice(0, 70)} [{s0['Status']}]</option>)}
                              </select>
                              <input placeholder="+ custom item, press Enter" onKeyDown={e => { if (e.key === 'Enter' && e.target.value.trim()) { psTargetAdd(epic, r['Next Sprint Target'], e.target.value.trim()); e.target.value = '' } }}
                                style={{ ...ta, minWidth: 0, marginTop: 4, resize: 'none' }} />
                            </td>
                            <td style={td(i)}>
                              <select value={st} onChange={e => psEdit(epic, 'Status Override', e.target.value)}
                                style={{ fontSize: 11, fontWeight: 700, padding: '3px 6px', borderRadius: 4, background: sc, color: '#fff', border: 'none', cursor: 'pointer' }}>
                                {statuses.map(s => <option key={s} value={s} style={{ background: '#333' }}>{s}</option>)}
                              </select>
                              <div style={{ fontSize: 11, marginTop: 4, fontWeight: 600 }}>{pr.pct || 0}% <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({pr.done}/{pr.total} {pr.unit})</span></div>
                              <div style={{ height: 5, background: 'var(--border)', borderRadius: 3, marginTop: 3 }}><div style={{ width: `${pr.pct || 0}%`, height: '100%', background: sc, borderRadius: 3 }} /></div>
                              {r.forecast && <div style={{ fontSize: 10, marginTop: 3, color: r.forecast.on_track ? 'var(--text-muted)' : '#ef6c00' }}>
                                {r.forecast.remaining} {r.forecast.unit === 'SP' ? 'SP' : 'tkts'} left · can do ~{r.forecast.capacity} in {r.forecast.days_left} working days to quarter end
                              </div>}
                              {r['Status Override'] && <div style={{ fontSize: 10, marginTop: 3, color: 'var(--text-muted)' }}>manual · auto: {r.auto_status} <a href="#" onClick={e => { e.preventDefault(); psEdit(epic, 'Status Override', '') }}>reset</a></div>}
                            </td>
                            <td style={td(i)}><textarea rows={4} value={r['Risk and Mitigation'] || ''} onChange={e => psEdit(epic, 'Risk and Mitigation', e.target.value)} style={ta} /></td>
                            <td style={td(i)}><textarea rows={4} value={r['Comments1'] || ''} onChange={e => psEdit(epic, 'Comments1', e.target.value)} style={ta} /></td>
                            <td style={td(i)}><textarea rows={4} value={r['Comments2'] || ''} onChange={e => psEdit(epic, 'Comments2', e.target.value)} style={ta} /></td>
                            {['sp_done', 'sp_committed', 'tickets_done', 'tickets_committed'].map(k => <td key={k} style={{ ...td(i), textAlign: 'center', fontWeight: 600 }}>{(r.qtr || {})[k] ?? 0}</td>)}
                            <td style={{ ...td(i), textAlign: 'center', fontWeight: 600 }}>{r.forecast?.velocity ?? 0} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{r.forecast?.unit === 'SP' ? 'SP' : 'tkts'}</span></td>
                          </tr>
                          {open && (
                            <tr><td colSpan={16} style={{ padding: '6px 12px 12px 40px', border: '1px solid var(--border)' }}>
                              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                                <thead><tr>{[`Team (${team})`, 'JIRA ID', 'Story', 'Type', 'Status', 'SP', 'Assignee', 'In Sprint'].map(h => <th key={h} style={{ ...th, background: '#455A64' }}>{h}</th>)}</tr></thead>
                                <tbody>
                                  {(r.stories || []).map((s, si) => (
                                    <tr key={s['JIRA ID']}>
                                      <td style={td(si)}><input type="checkbox" checked={(s['Team Story'] || '').toLowerCase() === 'yes'} onChange={e => psPost('story-team', { epic, jira_id: s['JIRA ID'], team: e.target.checked })} /></td>
                                      <td style={td(si)}>{link(s['JIRA ID'])}</td>
                                      <td style={td(si)}>{s['Story']}</td>
                                      <td style={td(si)}>{s['Type']}</td>
                                      <td style={td(si)}>{s['Status']}</td>
                                      <td style={td(si)}>{s['Story Point']}</td>
                                      <td style={td(si)}>{s['Assignee']}</td>
                                      <td style={td(si)}>{s['In Current Sprint']}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td></tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                    {rows.length > 0 && (() => {
                      const sum = k => Math.round(rows.reduce((a, x) => a + (Number((x.qtr || {})[k]) || 0), 0) * 10) / 10
                      const vel = Math.round(rows.filter(x => x.forecast?.unit === 'SP').reduce((a, x) => a + (x.forecast.velocity || 0), 0) * 10) / 10
                      const tt = { ...th, background: '#455A64', textAlign: 'center' }
                      return <tr>
                        <td colSpan={11} style={{ ...tt, textAlign: 'right' }}>Total</td>
                        {['sp_done', 'sp_committed', 'tickets_done', 'tickets_committed'].map(k => <td key={k} style={tt}>{sum(k)}</td>)}
                        <td style={tt}>{vel} SP</td>
                      </tr>
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Sprint Summary tab ──────────────────────────────────────────────── */}
      {activeTab === SPRINT_SUMMARY_TAB && (() => {
        const thStyle = { fontSize: 11, fontWeight: 700, color: '#fff', background: '#1565c0', padding: '6px 10px', textAlign: 'left', border: '1px solid #BBDEFB' }
        const tdStyle = (i, bold) => ({ fontSize: 13, padding: '6px 10px', background: i % 2 ? 'rgba(21,101,192,0.06)' : 'transparent', fontWeight: bold ? 600 : 400, border: '1px solid var(--border)' })
        const tdC = (i) => ({ ...tdStyle(i, false), textAlign: 'center' })

        const PIE_COLORS = ['#1565c0','#2196f3','#4caf50','#ff9800','#e53935','#9c27b0','#00bcd4','#8bc34a','#ff5722','#607d8b']

        const PieChart = ({ data, valueKey, title }) => {
          const total = data.reduce((s, d) => s + (d[valueKey] || 0), 0)
          if (!total) return <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', paddingTop: 20 }}>No data</div>
          const R = 80, CX = 150, CY = 150
          let angle = -Math.PI / 2
          const slices = data.map((d, i) => {
            const val = d[valueKey] || 0
            const sweep = (val / total) * 2 * Math.PI
            const mid = angle + sweep / 2
            const x1 = CX + R * Math.cos(angle)
            const y1 = CY + R * Math.sin(angle)
            angle += sweep
            const x2 = CX + R * Math.cos(angle)
            const y2 = CY + R * Math.sin(angle)
            const large = sweep > Math.PI ? 1 : 0
            const path = `M${CX},${CY} L${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`
            const pct = Math.round(val / total * 100)
            // inside label centre
            const iLx = CX + R * 0.62 * Math.cos(mid)
            const iLy = CY + R * 0.62 * Math.sin(mid)
            // outside connector end + text anchor
            const oLx = CX + (R + 22) * Math.cos(mid)
            const oLy = CY + (R + 22) * Math.sin(mid)
            const anchor = Math.cos(mid) > 0.1 ? 'start' : Math.cos(mid) < -0.1 ? 'end' : 'middle'
            return { path, color: PIE_COLORS[i % PIE_COLORS.length], label: d.status || '(No Status)', val, pct, mid, iLx, iLy, oLx, oLy, anchor }
          })
          return (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: '#1565c0', textAlign: 'center' }}>{title}</div>
              <svg width="300" height="300" viewBox="0 0 300 300" style={{ display: 'block', margin: '0 auto', overflow: 'visible' }}>
                {slices.map((s, i) => <path key={i} d={s.path} fill={s.color} stroke="#fff" strokeWidth="2" />)}
                {slices.map((s, i) => {
                  if (s.pct < 4) return null
                  if (s.pct >= 12) {
                    return (
                      <g key={i}>
                        <text x={s.iLx} y={s.iLy - 5} textAnchor="middle" fontSize="9" fill="#fff" fontWeight="700">{s.label}</text>
                        <text x={s.iLx} y={s.iLy + 7} textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.9)">{s.val} ({s.pct}%)</text>
                      </g>
                    )
                  }
                  const lx1 = CX + (R + 3) * Math.cos(s.mid), ly1 = CY + (R + 3) * Math.sin(s.mid)
                  const lx2 = CX + (R + 14) * Math.cos(s.mid), ly2 = CY + (R + 14) * Math.sin(s.mid)
                  return (
                    <g key={i}>
                      <line x1={lx1.toFixed(1)} y1={ly1.toFixed(1)} x2={lx2.toFixed(1)} y2={ly2.toFixed(1)} stroke={s.color} strokeWidth="1.2" />
                      <text x={s.oLx} y={s.oLy - 4} textAnchor={s.anchor} fontSize="9" fill="var(--text)" fontWeight="600">{s.label}</text>
                      <text x={s.oLx} y={s.oLy + 7} textAnchor={s.anchor} fontSize="8" fill="var(--text-muted)">{s.val} ({s.pct}%)</text>
                    </g>
                  )
                })}
              </svg>
            </div>
          )
        }

        if (summaryLoading) return <div style={{ padding: 32, textAlign: 'center' }}><span className="spinner" /></div>
        if (summaryErr)     return <div style={{ color: '#c62828', fontSize: 13, padding: 16 }}>{summaryErr}</div>
        if (!summaryData)   return (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 32, textAlign: 'center' }}>
            Click the tab to load the Sprint Summary.
          </div>
        )

        const sb = summaryData.status_breakdown || []
        return (
          <div style={{ maxWidth: 1100 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sprint: <strong>{summaryData.sprint_label}</strong></span>
              <button onClick={() => {
                setSummaryLoading(true); setSummaryErr(null)
                fetch(`${API}/summary-data?file=${encodeURIComponent(file)}`)
                  .then(r => r.json()).then(d => { if (d.ok) setSummaryData(d); else setSummaryErr(d.error) })
                  .catch(e => setSummaryErr(String(e))).finally(() => setSummaryLoading(false))
              }} style={{ fontSize: 12, padding: '5px 12px', background: 'none', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer', color: 'var(--text-muted)' }}>
                ↺ Refresh
              </button>
            </div>

            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {/* Overview table + progress bar */}
              <div style={{ flex: '0 0 360px', minWidth: 300 }}>
                {/* SP progress bar */}
                {(() => {
                  // Weighted "work remaining" per status — how much of the SP is still at risk
                  const RISK_W = {
                    'closed': 0, 'done': 0, 'released': 0, 'completed': 0, 'deployed': 0, 'merged': 0, 'bug filed': 0,
                    'in doc': 0.10,
                    'in testing': 0.30,
                    'in dev': 0.65, 'in development': 0.65,
                    'ready for dev': 0.90,
                    'new': 1.0,
                    'cancelled': 0, 'canceled': 0,
                  }
                  const sb2 = summaryData.status_breakdown || []
                  const totalSP2  = sb2.reduce((s, r) => s + (r.sp || 0), 0)
                  const remainSP  = sb2.reduce((s, r) => {
                    const w = RISK_W[(r.status || '').toLowerCase()] ?? 1
                    return s + (r.sp || 0) * w
                  }, 0)
                  const effectivePct = totalSP2 > 0 ? Math.round((1 - remainSP / totalSP2) * 100) : 0

                  const _todayLocal = new Date(); _todayLocal.setHours(0, 0, 0, 0)
                  const daysRem = (() => {
                    if (!endDate) return null
                    const end = new Date(endDate + 'T00:00:00'); end.setHours(0, 0, 0, 0)
                    let count = 0, cur = new Date(_todayLocal)
                    while (cur <= end) { const d = cur.getDay(); if (d !== 0 && d !== 6) count++; cur.setDate(cur.getDate() + 1) }
                    return count
                  })()

                  // Risk: compare effective completion against how far through sprint we are
                  // Color thresholds tighten as days run out
                  let barColor = '#2e7d32', statusLabel = 'On Track'
                  if (totalSP2 === 0) {
                    barColor = '#546e7a'; statusLabel = 'No Data'
                  } else if (daysRem !== null) {
                    const needed =
                      daysRem <= 1 ? 90 :
                      daysRem <= 3 ? 80 :
                      daysRem <= 5 ? 65 :
                      daysRem <= 8 ? 45 : 25
                    const atRiskThreshold = needed - 20
                    if      (effectivePct >= needed)         { barColor = '#2e7d32'; statusLabel = 'On Track'    }
                    else if (effectivePct >= atRiskThreshold){ barColor = '#f57c00'; statusLabel = 'At Risk'     }
                    else                                      { barColor = '#c62828'; statusLabel = 'Behind'     }
                    if (daysRem <= 1 && effectivePct < 70)   { barColor = '#c62828'; statusLabel = 'Critical'   }
                  } else {
                    if      (effectivePct >= 70) { barColor = '#2e7d32'; statusLabel = 'On Track' }
                    else if (effectivePct >= 40) { barColor = '#f57c00'; statusLabel = 'At Risk'  }
                    else                          { barColor = '#c62828'; statusLabel = 'Behind'   }
                  }

                  // Stage breakdown hint
                  const STAGE_ORDER = ['ready for dev','in dev','in testing','in doc','closed']
                  const stageHints = STAGE_ORDER.map(st => {
                    const match = sb2.find(r => (r.status || '').toLowerCase() === st)
                    return match ? `${match.sp} SP ${match.status}` : null
                  }).filter(Boolean)

                  return (
                    <div style={{ marginBottom: 16, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#1565c0' }}>Sprint Risk</span>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          {daysRem !== null && (
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {daysRem} {daysRem === 1 ? 'day' : 'days'} remaining
                            </span>
                          )}
                          <span style={{ fontSize: 11, fontWeight: 700, color: barColor,
                            background: `${barColor}18`, borderRadius: 3, padding: '2px 8px' }}>
                            {statusLabel}
                          </span>
                        </div>
                      </div>
                      <div style={{ height: 20, borderRadius: 8, background: 'var(--border)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(effectivePct, 100)}%`,
                          background: barColor, borderRadius: 8, transition: 'width 0.5s ease',
                          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 6 }}>
                          {effectivePct >= 12 && <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{effectivePct}%</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, alignItems: 'flex-start' }}>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                          {stageHints.join(' · ')}
                        </span>
                        {effectivePct < 12 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{effectivePct}%</span>}
                      </div>
                    </div>
                  )
                })()}

                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: '#1565c0' }}>Overview</div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={thStyle}>Stories</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Count</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Story Points</th>
                    <th style={thStyle} />
                  </tr></thead>
                  <tbody>
                    {(summaryData.overview_rows || []).map((m, i) => {
                      const g = (summaryData.groups || {})[m.key] || { head: [], rows: [] }
                      const nm = `${stem}_${m.label.replace(/\s+/g, '_')}_Stories`
                      return (
                        <tr key={m.key}>
                          <td style={tdStyle(i, true)}>{m.label}</td>
                          <td style={tdC(i)}>{m.stories}</td>
                          <td style={tdC(i)}>{m.sp}</td>
                          <td style={{ ...tdC(i), whiteSpace: 'nowrap' }}>
                            <button style={{ fontSize: 11, padding: '2px 8px', marginRight: 4, border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer' }}
                              title={`Copy the ${m.label.toLowerCase()} stories (all Sprint Board columns)`}
                              onClick={() => copyRowsToClipboard(g.head, g.rows)}>Copy</button>
                            <button style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer' }}
                              title={`Export the ${m.label.toLowerCase()} stories to Excel`}
                              onClick={() => exportRowsToXlsx(g.head, g.rows, nm)}>Export</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pie charts */}
              <div style={{ flex: '1 1 500px', display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
                <div style={{ flex: '0 0 300px', padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
                  <PieChart data={sb} valueKey="count" title="Stories by Status" />
                </div>
                <div style={{ flex: '0 0 300px', padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
                  <PieChart data={sb} valueKey="sp" title="Story Points by Status" />
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center' }}><span className="spinner" /></div>
      ) : loadErr ? (
        <div style={{ color: '#c62828', fontSize: 13 }}>{loadErr}</div>
      ) : activeTab === DEV_BW_TAB || activeTab === SPRINT_LOG_TAB || activeTab === SPRINT_SUMMARY_TAB || activeTab === PROJECT_SUMMARY_TAB || activeTab === TASKS_TAB ? null : (
        <div>
          {/* Adhoc Task count bar */}
          {activeTab === 'Adhoc Task' && (
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ marginLeft: 'auto' }}>{countsEl}{actionsEl}</span>
            </div>
          )}
          {/* Filter bar — Sprint Board: Developer + Status; My Stories: Status only */}
          {(activeTab === 'Sprint Board' || activeTab === MY_STORIES) && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
              {showDevFilter && (
                <select value={filterDev} onChange={e => setFilterDev(e.target.value)}
                  style={{ fontSize: 12, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer' }}>
                  <option value="">All Developers</option>
                  {uniqueDevs.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              )}
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                style={{ fontSize: 12, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer' }}>
                <option value="">All Statuses</option>
                {uniqueStatuses.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {(filterDev || filterStatus) && (
                <button onClick={() => { setFilterDev(''); setFilterStatus('') }}
                  style={{ fontSize: 11, padding: '4px 8px', background: 'none', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', color: 'var(--text-muted)' }}>
                  Clear
                </button>
              )}
              <span style={{ marginLeft: 'auto' }}>{countsEl}{actionsEl}</span>
            </div>
          )}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ width: 28, background: 'var(--surface)', borderBottom: '2px solid var(--border)', position: 'sticky', top: 0 }} />
                {mainIndices.map(ci => (
                  <th key={ci} style={{
                    padding: '7px 10px', textAlign: 'left', whiteSpace: 'nowrap',
                    background: 'var(--surface)', borderBottom: '2px solid var(--border)',
                    color: 'var(--text-muted)', fontWeight: 600, fontSize: 11,
                    position: 'sticky', top: 0,
                    width: COL_WIDTHS[cols[ci]] || 90,
                    minWidth: COL_WIDTHS[cols[ci]] || 70,
                  }}>{cols[ci]}</th>
                ))}
                <th style={{ width: 40, background: 'var(--surface)', borderBottom: '2px solid var(--border)', position: 'sticky', top: 0 }} />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(([row, origIdx], di) => {
                const expanded    = expandedRows.has(origIdx)
                const rowBg       = di % 2 === 0 ? 'transparent' : 'var(--surface, rgba(0,0,0,0.02))'
                const isCancelled = statusColIdx >= 0 && /^cancel/i.test(row[statusColIdx] || '')
                const rowJira     = jiraCol >= 0 ? String(row[jiraCol] || '').trim().toUpperCase() : ''
                const isHighlighted = highlightJira && rowJira === highlightJira
                const carried   = isCarried(row)
                const segHead   = di === 0 ? (carried ? 'prev' : 'curr') : (!carried && isCarried(sortedRows[di - 1][0]) ? 'curr' : null)
                const segCount  = segHead === 'prev' ? prevCount : (filteredRows.length - prevCount)
                const segSP     = segHead === 'prev' ? prevSP : (totalSP - prevSP)
                return (
                  <>
                    {segHead && (
                      <tr key={`seg_${segHead}`}>
                        <td colSpan={mainIndices.length + 2} style={{ padding: '5px 10px', background: segHead === 'prev' ? 'rgba(230,81,0,0.08)' : 'rgba(21,101,192,0.07)', borderBottom: '1px solid var(--border)' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: segHead === 'prev' ? '#e65100' : '#1565c0' }}>
                            {segHead === 'prev' ? 'Previous Sprint Stories' : 'Current Sprint Stories'} ({segCount} · {fmtSP(segSP)} SP)
                          </span>
                        </td>
                      </tr>
                    )}
                    <tr key={origIdx}
                      ref={isHighlighted ? highlightRowRef : null}
                      style={{ background: isHighlighted ? 'rgba(25,118,210,0.22)' : rowBg,
                        opacity: isCancelled ? 0.4 : 1,
                        outline: isHighlighted ? '2px solid #1565c0' : 'none', outlineOffset: -1,
                        color: isHighlighted ? '#0d47a1' : 'inherit', fontWeight: isHighlighted ? 600 : 'inherit' }}>
                      {/* expand toggle */}
                      <td style={{ padding: '3px 4px 3px 8px', borderBottom: expanded ? 'none' : '1px solid var(--border)', textAlign: 'center' }}>
                        <button
                          onClick={() => toggleRow(origIdx)}
                          title={expanded ? 'Collapse' : 'Expand details'}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text-muted)', padding: '2px 3px', lineHeight: 1 }}
                        >{expanded ? '▾' : '▸'}</button>
                      </td>
                      {/* main cols */}
                      {mainIndices.map(ci => {
                        const cell   = row[ci] ?? ''
                        const isJira = ci === jiraCol
                        const link   = isJira ? jiraUrl(cell) : null
                        return (
                          <td key={ci} style={{ padding: 0, borderBottom: expanded ? 'none' : '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                              {isJira && <TypeBadge type={typeColIdx >= 0 ? (row[typeColIdx] ?? '') : ''} />}
                              <input
                                value={cell}
                                onChange={e => cellChange(srcTab, origIdx, ci, e.target.value)}
                                style={{ ...CELL_INPUT, color: link ? 'var(--primary,#1976d2)' : 'var(--text-primary)' }}
                                onFocus={e => e.target.style.background = 'rgba(25,118,210,0.06)'}
                                onBlur={e  => { e.target.style.background = 'transparent'; scheduleRowSave(srcTab, origIdx) }}
                              />
                              {link && (
                                <a href={link} target="_blank" rel="noreferrer" onMouseDown={e => e.preventDefault()}
                                  title="Open in JIRA" style={{ flexShrink:0, padding:'0 6px 0 2px', fontSize:12, color:'var(--primary,#1976d2)', opacity:0.7, textDecoration:'none' }}>↗</a>
                              )}
                            </div>
                          </td>
                        )
                      })}
                      {/* delete / create project */}
                      <td style={{ padding: '3px 6px', borderBottom: (expanded || projectModal?.origIdx === origIdx) ? 'none' : '1px solid var(--border)', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {activeTab === MY_STORIES && (
                          <button onClick={() => openProjectPreview(origIdx, row)} title="Create Project"
                            style={{ fontSize:10, fontWeight:600, padding:'2px 6px', background:'rgba(106,27,154,0.08)', color:'#6a1b9a', border:'1px solid rgba(106,27,154,0.25)', borderRadius:3, cursor:'pointer', marginRight:3, whiteSpace:'nowrap' }}
                            onMouseEnter={e => { e.currentTarget.style.background='rgba(106,27,154,0.18)'; e.currentTarget.style.borderColor='#9c27b0' }}
                            onMouseLeave={e => { e.currentTarget.style.background='rgba(106,27,154,0.08)'; e.currentTarget.style.borderColor='rgba(106,27,154,0.25)' }}
                          >+ Project</button>
                        )}
                        {deleteConfirm?.tab === srcTab && deleteConfirm?.ri === origIdx ? (
                          <span style={{ display: 'inline-flex', gap: 4 }}>
                            <button onClick={() => deleteRow(srcTab, origIdx)} style={{ fontSize:10, padding:'2px 6px', background:'#c62828', color:'#fff', border:'none', borderRadius:3, cursor:'pointer' }}>Yes</button>
                            <button onClick={() => setDeleteConfirm(null)}   style={{ fontSize:10, padding:'2px 6px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:3, cursor:'pointer', color:'var(--text)' }}>No</button>
                          </span>
                        ) : (
                          <button onClick={() => setDeleteConfirm({ tab: srcTab, ri: origIdx })} title="Delete row"
                            style={{ background:'none', border:'none', cursor:'pointer', fontSize:14, color:'var(--text-muted)', padding:'2px 4px', opacity:0.5 }}
                            onMouseEnter={e => { e.currentTarget.style.opacity=1; e.currentTarget.style.color='#c62828' }}
                            onMouseLeave={e => { e.currentTarget.style.opacity=0.5; e.currentTarget.style.color='var(--text-muted)' }}
                          >🗑</button>
                        )}
                      </td>
                    </tr>
                    {/* Create Project preview row */}
                    {projectModal?.origIdx === origIdx && !projectModal?.isAdhoc && (
                      <tr key={`${origIdx}-proj`} style={{ background: 'rgba(106,27,154,0.04)' }}>
                        <td />
                        <td colSpan={mainIndices.length + 1} style={{ padding: '12px 16px', borderBottom: expanded ? 'none' : '2px solid #ce93d8' }}>
                          {projectModal.loading ? (
                            <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:'var(--text-muted)' }}>
                              <span className="spinner" style={{ width:12, height:12, borderWidth:1.5 }} /> Loading branch rules…
                            </div>
                          ) : projectModal.error ? (
                            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                              <span style={{ fontSize:12, color:'#c62828' }}>⚠ {projectModal.error}</span>
                              <button onClick={() => setProjectModal(null)} style={{ fontSize:11, padding:'2px 8px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:3, cursor:'pointer', color:'var(--text)' }}>Close</button>
                            </div>
                          ) : projectModal.created ? (
                            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                                <span style={{ fontSize:12, color:'#2e7d32', fontWeight:600 }}>✓ Project created: {projectModal.created}</span>
                                <button onClick={() => setProjectModal(null)} style={{ fontSize:11, padding:'2px 8px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:3, cursor:'pointer', color:'var(--text)' }}>Close</button>
                              </div>
                              <SetupProgress setup={projectModal.setup} onNavigate={navigate} onConfirmRevert={() => doSetupBranch(projectModal.setup?._branchName, projectModal.setup?._application, true)} onAbort={() => setProjectModal(prev => prev ? ({ ...prev, setup: null }) : prev)} />
                            </div>
                          ) : projectModal.alreadyExists ? (() => {
                            const info = projectModal.projectInfo || {}
                            const existingBranches = Object.entries(info).filter(([k]) => k === 'Branch' || /^Branch \d+$/.test(k))
                            const infoFields = Object.entries(info).filter(([k]) => k !== 'Branch' && !/^Branch \d+$/.test(k))
                            const inp12 = { fontSize:12, padding:'4px 8px', border:'1px solid #90caf9', borderRadius:4, background:'var(--bg)', color:'var(--text-primary)', outline:'none', fontFamily:'monospace' }
                            return (
                              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                                  <span style={{ fontSize:12, fontWeight:700, color:'#1565c0' }}>📁 {projectModal.existingFile}</span>
                                  <button onClick={() => setProjectModal(null)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:13, color:'var(--text-muted)', padding:'2px 4px' }}>✕</button>
                                </div>
                                {/* Project info summary */}
                                <div style={{ display:'flex', gap:16, flexWrap:'wrap', fontSize:12 }}>
                                  {infoFields.map(([k, v]) => {
                                    if (!v) return null
                                    const isApp = k === 'Application'
                                    const ap = isApp ? localAppPath(v) : null
                                    return (
                                      <div key={k}>
                                        <span style={{ fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em' }}>{k}&nbsp;</span>
                                        {ap ? (
                                          <button onClick={() => navigate(ap)} title={`Open ${v} local app`}
                                            style={{ fontWeight:700, color:'#1565c0', background:'#e3f2fd', border:'1px solid #90caf9', borderRadius:4, padding:'2px 8px', fontSize:12, cursor:'pointer' }}
                                            onMouseEnter={e => e.currentTarget.style.background='#bbdefb'}
                                            onMouseLeave={e => e.currentTarget.style.background='#e3f2fd'}>
                                            {v} ↗
                                          </button>
                                        ) : (
                                          <span style={{ fontWeight:500, color:'var(--text-primary)' }}>{v}</span>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                                {/* Fix Versions + Release Branch */}
                                <FixVersionBlock fixVersions={projectModal.fixVersions} app={projectModal.rule?.application || ''} codeFreezeDate={projectModal.codeFreezeDate} releaseDate={projectModal.releaseDate} />
                                {/* Existing branches */}
                                {existingBranches.length > 0 && (
                                  <div>
                                    <div style={{ fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:4 }}>Existing Branches</div>
                                    {existingBranches.map(([k, v]) => (
                                      <div key={k} style={{ fontSize:12, padding:'2px 0', display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                                        <span style={{ fontSize:10, color:'var(--text-muted)', minWidth:60, flexShrink:0 }}>{k}</span>
                                        <button
                                          onClick={() => doSetupBranch(v, projectModal.rule?.application || info.Application || '')}
                                          title="Click to checkout this branch in local app"
                                          style={{ fontFamily:'monospace', fontSize:12, background:'none', border:'none', color:'var(--primary,#1976d2)', cursor:'pointer', padding:'1px 4px', textAlign:'left', borderRadius:3, textDecoration:'underline', textDecorationStyle:'dotted' }}
                                          onMouseEnter={e => { e.currentTarget.style.background='rgba(25,118,210,0.08)'; e.currentTarget.style.textDecorationStyle='solid' }}
                                          onMouseLeave={e => { e.currentTarget.style.background='none'; e.currentTarget.style.textDecorationStyle='dotted' }}
                                        >{v}</button>
                                        {projectModal.confirmDeleteBranch?.label === k ? (
                                          <span style={{ display:'inline-flex', gap:4, alignItems:'center', fontSize:11 }}>
                                            <span style={{ color:'#c62828', fontWeight:500 }}>Delete?</span>
                                            <button onClick={doDeleteBranch} disabled={projectModal.deleteBranchBusy}
                                              style={{ fontSize:11, padding:'1px 8px', background:'#c62828', color:'#fff', border:'none', borderRadius:3, cursor:'pointer', fontWeight:600, opacity:projectModal.deleteBranchBusy ? 0.6 : 1 }}>
                                              {projectModal.deleteBranchBusy ? '…' : 'Yes'}
                                            </button>
                                            <button onClick={() => setProjectModal(prev => ({ ...prev, confirmDeleteBranch: null }))}
                                              disabled={projectModal.deleteBranchBusy}
                                              style={{ fontSize:11, padding:'1px 8px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:3, cursor:'pointer', color:'var(--text)' }}>
                                              No
                                            </button>
                                          </span>
                                        ) : (
                                          <button
                                            onClick={() => setProjectModal(prev => ({ ...prev, confirmDeleteBranch: { label: k, name: v }, deleteBranchError: null, deleteBranchWarning: null }))}
                                            title={`Delete ${k}`}
                                            style={{ fontSize:12, background:'none', border:'none', cursor:'pointer', color:'#999', padding:'0 2px', lineHeight:1, borderRadius:2 }}
                                            onMouseEnter={e => { e.currentTarget.style.color='#c62828' }}
                                            onMouseLeave={e => { e.currentTarget.style.color='#999' }}
                                          >🗑</button>
                                        )}
                                      </div>
                                    ))}
                                    {projectModal.deleteBranchWarning && (
                                      <div style={{ fontSize:11, color:'#e65100', background:'#fff3e0', border:'1px solid #ffcc80', borderRadius:4, padding:'5px 8px', marginTop:4 }}>
                                        ⚠ {projectModal.deleteBranchWarning}
                                      </div>
                                    )}
                                    {projectModal.deleteBranchError && (
                                      <div style={{ fontSize:11, color:'#c62828', marginTop:4 }}>{projectModal.deleteBranchError}</div>
                                    )}
                                  </div>
                                )}
                                {/* Add new branch */}
                                {projectModal.addBranchDone ? (
                                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                                    <span style={{ fontSize:12, color:'#2e7d32', fontWeight:600 }}>✓ Branch created in project</span>
                                    <button onClick={() => setProjectModal(null)} style={{ fontSize:11, padding:'2px 8px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:3, cursor:'pointer', color:'var(--text)' }}>Close</button>
                                  </div>
                                ) : (projectModal.issueType?.toLowerCase() === 'clone - bug' ? (
                                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                                    <button
                                      onClick={handleCloneWF}
                                      disabled={!!projectModal?.cloneWFLoading}
                                      style={{ fontSize:12, padding:'5px 14px', background: projectModal?.cloneWFLoading ? '#b35000' : '#e65100', color:'#fff', border:'none', borderRadius:4, cursor: projectModal?.cloneWFLoading ? 'not-allowed' : 'pointer', fontWeight:600, opacity: projectModal?.cloneWFLoading ? 0.75 : 1 }}
                                    >{projectModal?.cloneWFLoading ? 'Opening…' : 'Clone WF'}</button>
                                    <button onClick={() => setProjectModal(null)} style={{ fontSize:12, padding:'5px 12px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:4, cursor:'pointer', color:'var(--text)' }}>Cancel</button>
                                  </div>
                                ) : (
                                  <>
                                    <div>
                                      <div style={{ fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:4 }}>New Branch</div>
                                      <input
                                        value={projectModal.newBranchInput || ''}
                                        onChange={e => setProjectModal(prev => ({ ...prev, newBranchInput: e.target.value }))}
                                        style={{ ...inp12, width:'100%', maxWidth:560 }}
                                        onFocus={e => e.target.style.borderColor='#1565c0'}
                                        onBlur={e  => e.target.style.borderColor='#90caf9'}
                                      />
                                    </div>
                                    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                                      <button
                                        onClick={doAddBranch}
                                        disabled={projectModal.addBranchBusy || !projectModal.newBranchInput?.trim()}
                                        style={{ fontSize:12, padding:'5px 14px', background:'#1565c0', color:'#fff', border:'none', borderRadius:4, cursor:'pointer', fontWeight:600, opacity:(projectModal.addBranchBusy || !projectModal.newBranchInput?.trim()) ? 0.6 : 1 }}
                                      >{projectModal.addBranchBusy ? 'Creating…' : 'Create Branch'}</button>
                                      <button onClick={() => setProjectModal(null)} style={{ fontSize:12, padding:'5px 12px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:4, cursor:'pointer', color:'var(--text)' }}>Cancel</button>
                                      {projectModal.addBranchError && <span style={{ fontSize:11, color:'#c62828' }}>{projectModal.addBranchError}</span>}
                                    </div>
                                  </>
                                ))}
                                {/* Setup progress — triggered by clicking any branch or creating new */}
                                <SetupProgress setup={projectModal.setup} onNavigate={navigate} onConfirmRevert={() => doSetupBranch(projectModal.setup?._branchName, projectModal.setup?._application, true)} onAbort={() => setProjectModal(prev => prev ? ({ ...prev, setup: null }) : prev)} />
                              </div>
                            )
                          })() : (
                            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                                <span style={{ fontSize:12, fontWeight:700, color:'#6a1b9a' }}>+ Create Project</span>
                                <button onClick={() => setProjectModal(null)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:13, color:'var(--text-muted)', padding:'2px 4px' }}>✕</button>
                              </div>
                              {/* Context info */}
                              <div style={{ display:'flex', gap:16, alignItems:'center', flexWrap:'wrap' }}>
                                {projectModal.rule?.application && (() => {
                                  const ap = localAppPath(projectModal.rule.application)
                                  return (
                                    <div style={{ fontSize:12 }}>
                                      <span style={{ fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em' }}>Application&nbsp;</span>
                                      {ap ? (
                                        <button onClick={() => navigate(ap)} title={`Open ${projectModal.rule.application} local app`}
                                          style={{ fontWeight:700, color:'#1565c0', background:'#e3f2fd', border:'1px solid #90caf9', borderRadius:4, padding:'2px 8px', fontSize:12, cursor:'pointer' }}
                                          onMouseEnter={e => e.currentTarget.style.background='#bbdefb'}
                                          onMouseLeave={e => e.currentTarget.style.background='#e3f2fd'}>
                                          {projectModal.rule.application} ↗
                                        </button>
                                      ) : (
                                        <span style={{ fontWeight:700, color:'#1565c0', background:'#e3f2fd', border:'1px solid #90caf9', borderRadius:4, padding:'2px 8px', fontSize:12 }}>
                                          {projectModal.rule.application}
                                        </span>
                                      )}
                                    </div>
                                  )
                                })()}
                                {projectModal.team && (
                                  <div style={{ fontSize:12 }}>
                                    <span style={{ fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em' }}>Team&nbsp;</span>
                                    <span style={{ fontWeight:600, color:'var(--text-primary)', fontSize:12 }}>{projectModal.team}</span>
                                  </div>
                                )}
                                {projectModal.isDefault && (
                                  <span style={{ fontSize:11, color:'#e65100', background:'#fff3e0', padding:'2px 8px', borderRadius:10, border:'1px solid #ffcc80' }}>
                                    Using default rule (ticket type not matched)
                                  </span>
                                )}
                              </div>
                              {/* Fix Versions + Release Branch */}
                              <FixVersionBlock fixVersions={projectModal.fixVersions} app={projectModal.rule?.application || ''} codeFreezeDate={projectModal.codeFreezeDate} releaseDate={projectModal.releaseDate} />
                              {/* Sprint(s) */}
                              {(() => {
                                const inp = { fontSize:12, padding:'4px 8px', border:'1px solid var(--border)', borderRadius:4, background:'var(--bg)', color:'var(--text-primary)', outline:'none', fontFamily:'monospace', flex:1 }
                                const sprints = projectModal.sprints || []
                                const branches = projectModal.branches || []
                                return (
                                  <>
                                    <div>
                                      <div style={{ fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:5 }}>Sprint(s)</div>
                                      {sprints.map((s, i) => (
                                        <div key={i} style={{ display:'flex', gap:6, marginBottom:5, alignItems:'center' }}>
                                          <input value={s} onChange={e => updateSprint(i, e.target.value)}
                                            placeholder="e.g. StormTroopers_2026-10-20_U"
                                            style={{ ...inp, maxWidth:400 }}
                                            onFocus={e => e.target.style.borderColor='#6a1b9a'}
                                            onBlur={e  => e.target.style.borderColor='var(--border)'}
                                          />
                                          <button onClick={() => removeSprint(i)}
                                            style={{ background:'none', border:'none', cursor:'pointer', fontSize:13, color:'var(--text-muted)', padding:'2px 4px', opacity:0.5 }}
                                            onMouseEnter={e => { e.currentTarget.style.opacity=1; e.currentTarget.style.color='#c62828' }}
                                            onMouseLeave={e => { e.currentTarget.style.opacity=0.5; e.currentTarget.style.color='var(--text-muted)' }}>✕</button>
                                        </div>
                                      ))}
                                      <button onClick={addSprint}
                                        style={{ fontSize:11, color:'#6a1b9a', background:'none', border:'1px dashed rgba(106,27,154,0.35)', borderRadius:4, cursor:'pointer', padding:'2px 10px' }}>
                                        + Add Sprint
                                      </button>
                                    </div>
                                    {/* Branch(es) */}
                                    <div>
                                      <div style={{ fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:5 }}>Branch(es)</div>
                                      {branches.map((b, i) => (
                                        <div key={i} style={{ display:'flex', gap:6, marginBottom:5, alignItems:'center' }}>
                                          <input value={b} onChange={e => updateBranch(i, e.target.value)}
                                            placeholder="branch-name"
                                            style={{ ...inp, maxWidth:560 }}
                                            onFocus={e => e.target.style.borderColor='#6a1b9a'}
                                            onBlur={e  => e.target.style.borderColor='var(--border)'}
                                          />
                                          <button onClick={() => removeBranch(i)}
                                            style={{ background:'none', border:'none', cursor:'pointer', fontSize:13, color:'var(--text-muted)', padding:'2px 4px', opacity:0.5 }}
                                            onMouseEnter={e => { e.currentTarget.style.opacity=1; e.currentTarget.style.color='#c62828' }}
                                            onMouseLeave={e => { e.currentTarget.style.opacity=0.5; e.currentTarget.style.color='var(--text-muted)' }}>✕</button>
                                        </div>
                                      ))}
                                      <button onClick={addBranch}
                                        style={{ fontSize:11, color:'#6a1b9a', background:'none', border:'1px dashed rgba(106,27,154,0.35)', borderRadius:4, cursor:'pointer', padding:'2px 10px' }}>
                                        + Add Branch
                                      </button>
                                    </div>
                                  </>
                                )
                              })()}
                              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                                <button
                                  onClick={doCreateProject}
                                  disabled={projectModal.creating || !(projectModal.branches||[]).some(b=>b.trim())}
                                  style={{ fontSize:12, padding:'5px 14px', background:'#6a1b9a', color:'#fff', border:'none', borderRadius:4, cursor:'pointer', fontWeight:600, opacity: (projectModal.creating || !(projectModal.branches||[]).some(b=>b.trim())) ? 0.6 : 1 }}
                                >
                                  {projectModal.creating ? 'Creating…' : 'Create Project'}
                                </button>
                                <button onClick={() => setProjectModal(null)} style={{ fontSize:12, padding:'5px 12px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:4, cursor:'pointer', color:'var(--text)' }}>
                                  Cancel
                                </button>
                                {projectModal.createError && (
                                  <span style={{ fontSize:11, color:'#c62828' }}>{projectModal.createError}</span>
                                )}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                    {expanded && (
                      <tr key={`${origIdx}-detail`} style={{ background: rowBg }}>
                        <td />
                        <td colSpan={mainIndices.length + 1} style={{ padding: '8px 12px 14px', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                            {/* Info panel */}
                            {(prsColIdx >= 0 || gpColIdx >= 0 || detailIndices.length > 0) && (
                              <div style={{ flex: 1, minWidth: 320 }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>Info</div>
                                {(prsColIdx >= 0 || gpColIdx >= 0) && (
                                  <div style={{ marginBottom: detailIndices.length > 0 ? 12 : 0 }}>
                                    <PrGpPanel
                                      prsVal={row[prsColIdx] ?? ''}
                                      prStatusVal={row[prStatusColIdx] ?? ''}
                                      gpVal={row[gpColIdx] ?? ''}
                                      onChange={(newPrs, newPrStatuses, newGps) => {
                                        if (prsColIdx      >= 0) cellChange(srcTab, origIdx, prsColIdx,      newPrs)
                                        if (prStatusColIdx >= 0) cellChange(srcTab, origIdx, prStatusColIdx, newPrStatuses)
                                        if (gpColIdx       >= 0) cellChange(srcTab, origIdx, gpColIdx,       newGps)
                                        scheduleRowSave(srcTab, origIdx)
                                      }}
                                    />
                                  </div>
                                )}
                                {otherDetailIndices.length > 0 && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12, marginBottom: (dateDetailIndices.length > 0 || notesDetailIndices.length > 0) ? 10 : 0 }}>
                                    {otherDetailIndices.map(ci => {
                                      const cell = row[ci] ?? ''
                                      return (
                                        <label key={ci} style={{ fontSize: 12 }}>
                                          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{cols[ci]}</div>
                                          <input
                                            value={cell}
                                            onChange={e => cellChange(srcTab, origIdx, ci, e.target.value)}
                                            style={{ width: '100%', fontSize: 12, padding: '4px 7px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', color: 'var(--text-primary)', outline: 'none' }}
                                            onFocus={e => e.target.style.borderColor = 'var(--primary,#1976d2)'}
                                            onBlur={e  => { e.target.style.borderColor = 'var(--border)'; scheduleRowSave(srcTab, origIdx) }}
                                          />
                                        </label>
                                      )
                                    })}
                                  </div>
                                )}
                                {dateDetailIndices.length > 0 && (
                                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${dateDetailIndices.length}, 1fr)`, gap: '8px 12px', marginBottom: notesDetailIndices.length > 0 ? 10 : 0 }}>
                                    {dateDetailIndices.map(ci => {
                                      const cell = row[ci] ?? ''
                                      return (
                                        <label key={ci} style={{ fontSize: 12 }}>
                                          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{COL_LABEL_OVERRIDE[cols[ci]] || cols[ci]}</div>
                                          <DatePicker
                                            value={cell}
                                            onChange={v => { cellChange(srcTab, origIdx, ci, v); scheduleRowSave(srcTab, origIdx) }}
                                          />
                                        </label>
                                      )
                                    })}
                                  </div>
                                )}
                                {notesDetailIndices.map(ci => {
                                  const cell = row[ci] ?? ''
                                  return (
                                    <label key={ci} style={{ fontSize: 12 }}>
                                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{cols[ci]}</div>
                                      <input
                                        value={cell}
                                        onChange={e => cellChange(srcTab, origIdx, ci, e.target.value)}
                                        style={{ width: '100%', fontSize: 12, padding: '4px 7px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', color: 'var(--text-primary)', outline: 'none' }}
                                        onFocus={e => e.target.style.borderColor = 'var(--primary,#1976d2)'}
                                        onBlur={e  => { e.target.style.borderColor = 'var(--border)'; scheduleRowSave(srcTab, origIdx) }}
                                      />
                                    </label>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}

              {/* New empty row */}
              <tr style={{ background: 'rgba(25,118,210,0.02)', borderTop: '1px dashed var(--border)' }}>
                <td style={{ padding: '3px 4px 3px 8px', borderBottom: expandedRows.has('new') ? 'none' : '1px solid var(--border)', textAlign: 'center' }}>
                  <button onClick={() => toggleRow('new')} title="Expand details"
                    style={{ background:'none', border:'none', cursor:'pointer', fontSize:11, color:'var(--text-muted)', padding:'2px 3px', lineHeight:1 }}>
                    {expandedRows.has('new') ? '▾' : '▸'}
                  </button>
                </td>
                {mainIndices.map(ci => {
                  const cell   = newRow[ci] ?? ''
                  const isJira = ci === jiraCol
                  const link   = isJira ? jiraUrl(cell) : null
                  const isDevPrefilled = activeTab === MY_STORIES && ci === devColIdx && cell === myDeveloper
                  return (
                    <td key={ci} style={{ padding: 0, borderBottom: expandedRows.has('new') ? 'none' : '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <input
                          value={cell}
                          placeholder={ci === cols.indexOf('JIRA ID') ? 'New row…' : ''}
                          onChange={e => newCellChange(activeTab, ci, e.target.value)}
                          style={{ ...CELL_INPUT, fontStyle: !cell && ci === cols.indexOf('JIRA ID') ? 'italic' : 'normal',
                            color: link ? 'var(--primary,#1976d2)' : isDevPrefilled ? 'var(--text-muted)' : 'var(--text-primary)' }}
                          onFocus={e => e.target.style.background = 'rgba(25,118,210,0.06)'}
                          onBlur={e  => { e.target.style.background = 'transparent'; scheduleNewRowSave(activeTab) }}
                        />
                        {link && (
                          <a href={link} target="_blank" rel="noreferrer" onMouseDown={e => e.preventDefault()}
                            title="Open in JIRA" style={{ flexShrink:0, padding:'0 6px 0 2px', fontSize:12, color:'var(--primary,#1976d2)', opacity:0.7, textDecoration:'none' }}>↗</a>
                        )}
                      </div>
                    </td>
                  )
                })}
                <td style={{ padding: '3px 6px', borderBottom: expandedRows.has('new') ? 'none' : '1px solid var(--border)' }} />
              </tr>
              {expandedRows.has('new') && (
                <tr style={{ background: 'rgba(25,118,210,0.02)' }}>
                  <td />
                  <td colSpan={mainIndices.length + 1} style={{ padding: '8px 12px 14px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                      {/* Info panel — new row */}
                      {(prsColIdx >= 0 || gpColIdx >= 0 || detailIndices.length > 0) && (
                        <div style={{ flex: 1, minWidth: 320 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>Info</div>
                          {(prsColIdx >= 0 || gpColIdx >= 0) && (
                            <div style={{ marginBottom: detailIndices.length > 0 ? 12 : 0 }}>
                              <PrGpPanel
                                prsVal={newRow[prsColIdx] ?? ''}
                                prStatusVal={newRow[prStatusColIdx] ?? ''}
                                gpVal={newRow[gpColIdx] ?? ''}
                                onChange={(newPrs, newPrStatuses, newGps) => {
                                  if (prsColIdx      >= 0) newCellChange(activeTab, prsColIdx,      newPrs)
                                  if (prStatusColIdx >= 0) newCellChange(activeTab, prStatusColIdx, newPrStatuses)
                                  if (gpColIdx       >= 0) newCellChange(activeTab, gpColIdx,       newGps)
                                  scheduleNewRowSave(activeTab)
                                }}
                              />
                            </div>
                          )}
                          {otherDetailIndices.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12, marginBottom: (dateDetailIndices.length > 0 || notesDetailIndices.length > 0) ? 10 : 0 }}>
                              {otherDetailIndices.map(ci => {
                                const cell = newRow[ci] ?? ''
                                return (
                                  <label key={ci} style={{ fontSize: 12 }}>
                                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{cols[ci]}</div>
                                    <input
                                      value={cell}
                                      onChange={e => newCellChange(activeTab, ci, e.target.value)}
                                      style={{ width: '100%', fontSize: 12, padding: '4px 7px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', color: 'var(--text-primary)', outline: 'none' }}
                                      onFocus={e => e.target.style.borderColor = 'var(--primary,#1976d2)'}
                                      onBlur={e  => { e.target.style.borderColor = 'var(--border)'; scheduleNewRowSave(activeTab) }}
                                    />
                                  </label>
                                )
                              })}
                            </div>
                          )}
                          {dateDetailIndices.length > 0 && (
                            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${dateDetailIndices.length}, 1fr)`, gap: '8px 12px', marginBottom: notesDetailIndices.length > 0 ? 10 : 0 }}>
                              {dateDetailIndices.map(ci => {
                                const cell = newRow[ci] ?? ''
                                return (
                                  <label key={ci} style={{ fontSize: 12 }}>
                                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{cols[ci]}</div>
                                    <DatePicker
                                      value={cell}
                                      onChange={v => { newCellChange(activeTab, ci, v); scheduleNewRowSave(activeTab) }}
                                    />
                                  </label>
                                )
                              })}
                            </div>
                          )}
                          {notesDetailIndices.map(ci => {
                            const cell = newRow[ci] ?? ''
                            return (
                              <label key={ci} style={{ fontSize: 12 }}>
                                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{cols[ci]}</div>
                                <input
                                  value={cell}
                                  onChange={e => newCellChange(activeTab, ci, e.target.value)}
                                  style={{ width: '100%', fontSize: 12, padding: '4px 7px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', color: 'var(--text-primary)', outline: 'none' }}
                                  onFocus={e => e.target.style.borderColor = 'var(--primary,#1976d2)'}
                                  onBlur={e  => { e.target.style.borderColor = 'var(--border)'; scheduleNewRowSave(activeTab) }}
                                />
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
              {/* Adhoc rows — read-only, shown below Sprint Board rows */}
              {adhocInBoard.length > 0 && (
                <>
                  <tr>
                    <td colSpan={mainIndices.length + 2}
                      style={{ padding: '4px 10px', background: 'rgba(156,39,176,0.07)', borderTop: '2px dashed rgba(156,39,176,0.3)', borderBottom: '1px solid rgba(156,39,176,0.2)' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#7b1fa2', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Adhoc Tasks ({adhocInBoard.length})
                      </span>
                    </td>
                  </tr>
                  {adhocInBoard.map(({ row, idx }, di) => {
                    const isCancelled = statusColIdx >= 0 && /^cancel/i.test(row[statusColIdx] || '')
                    const isMyAdhoc = activeTab === MY_STORIES && myDeveloper && devColIdx >= 0 && row[devColIdx] === myDeveloper
                    const adhocExpanded = projectModal?.isAdhoc && projectModal?.origIdx === idx
                    const adhocCols = tabCols['Adhoc Task'] || []
                    return (
                      <React.Fragment key={`adhoc_${idx}`}>
                      <tr
                        style={{ background: di % 2 === 0 ? 'rgba(156,39,176,0.03)' : 'rgba(156,39,176,0.06)', opacity: isCancelled ? 0.4 : 1 }}>
                        <td style={{ padding: '3px 4px 3px 8px', borderBottom: adhocExpanded ? 'none' : '1px solid var(--border)' }} />
                        {mainIndices.map(ci => {
                          const cell  = String(row[ci] ?? '')
                          const isJira = ci === jiraCol
                          const link  = isJira && cell ? jiraUrl(cell) : null
                          const adhocColIdx = adhocCols.indexOf(cols[ci])
                          return (
                            <td key={ci} style={{ padding: 0, borderBottom: adhocExpanded ? 'none' : '1px solid var(--border)' }}>
                              {isJira ? (
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                  <TypeBadge type={typeColIdx >= 0 ? (row[typeColIdx] ?? '') : ''} />
                                  {link ? (
                                    <a href={link} target="_blank" rel="noreferrer"
                                      style={{ color: 'var(--primary,#1976d2)', textDecoration: 'none', fontFamily: 'monospace', fontSize: 11, padding: '4px 10px' }}>{cell}</a>
                                  ) : (
                                    <span style={{ color: 'var(--text-primary)', padding: '4px 10px', fontSize: 12 }}>{cell}</span>
                                  )}
                                </div>
                              ) : adhocColIdx >= 0 ? (
                                <input
                                  value={cell}
                                  onChange={e => cellChange('Adhoc Task', idx, adhocColIdx, e.target.value)}
                                  style={{ ...CELL_INPUT }}
                                  onFocus={e => e.target.style.background = 'rgba(156,39,176,0.06)'}
                                  onBlur={e  => { e.target.style.background = 'transparent'; scheduleRowSave('Adhoc Task', idx) }}
                                />
                              ) : (
                                <span style={{ color: 'var(--text-primary)', padding: '4px 10px', fontSize: 12, display: 'block' }}>{cell}</span>
                              )}
                            </td>
                          )
                        })}
                        <td style={{ padding: '3px 6px', borderBottom: adhocExpanded ? 'none' : '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                            {isMyAdhoc && (
                              <button onClick={() => adhocExpanded ? setProjectModal(null) : openProjectPreview(idx, row, true)}
                                style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', background: adhocExpanded ? 'rgba(106,27,154,0.18)' : 'rgba(106,27,154,0.08)', color: '#6a1b9a', border: '1px solid rgba(106,27,154,0.25)', borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap' }}
                                onMouseEnter={e => { e.currentTarget.style.background='rgba(106,27,154,0.18)'; e.currentTarget.style.borderColor='#9c27b0' }}
                                onMouseLeave={e => { e.currentTarget.style.background=adhocExpanded?'rgba(106,27,154,0.18)':'rgba(106,27,154,0.08)'; e.currentTarget.style.borderColor='rgba(106,27,154,0.25)' }}
                              >{adhocExpanded ? '✕ Close' : '+ Project'}</button>
                            )}
                            <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3, background: '#f3e5f5', color: '#7b1fa2', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Adhoc</span>
                          </div>
                        </td>
                      </tr>
                      {/* Adhoc Create Project preview row */}
                      {adhocExpanded && (
                        <tr style={{ background: 'rgba(106,27,154,0.04)' }}>
                          <td />
                          <td colSpan={mainIndices.length + 1} style={{ padding: '12px 16px', borderBottom: '2px solid #ce93d8' }}>
                            {projectModal.loading ? (
                              <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:'var(--text-muted)' }}>
                                <span className="spinner" style={{ width:12, height:12, borderWidth:1.5 }} /> Loading branch rules…
                              </div>
                            ) : projectModal.error ? (
                              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                                <span style={{ fontSize:12, color:'#c62828' }}>⚠ {projectModal.error}</span>
                                <button onClick={() => setProjectModal(null)} style={{ fontSize:11, padding:'2px 8px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:3, cursor:'pointer', color:'var(--text)' }}>Close</button>
                              </div>
                            ) : projectModal.created ? (
                              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                                  <span style={{ fontSize:12, color:'#2e7d32', fontWeight:600 }}>✓ Project created: {projectModal.created}</span>
                                  <button onClick={() => setProjectModal(null)} style={{ fontSize:11, padding:'2px 8px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:3, cursor:'pointer', color:'var(--text)' }}>Close</button>
                                </div>
                                <SetupProgress setup={projectModal.setup} onNavigate={navigate} onConfirmRevert={() => doSetupBranch(projectModal.setup?._branchName, projectModal.setup?._application, true)} onAbort={() => setProjectModal(prev => prev ? ({ ...prev, setup: null }) : prev)} />
                              </div>
                            ) : projectModal.alreadyExists ? (() => {
                              const info = projectModal.projectInfo || {}
                              const existingBranches = Object.entries(info).filter(([k]) => k === 'Branch' || /^Branch \d+$/.test(k))
                              const infoFields = Object.entries(info).filter(([k]) => k !== 'Branch' && !/^Branch \d+$/.test(k))
                              const inp12 = { fontSize:12, padding:'4px 8px', border:'1px solid #90caf9', borderRadius:4, background:'var(--bg)', color:'var(--text-primary)', outline:'none', fontFamily:'monospace' }
                              return (
                                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                                    <span style={{ fontSize:12, fontWeight:700, color:'#1565c0' }}>📁 {projectModal.existingFile}</span>
                                    <button onClick={() => setProjectModal(null)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:13, color:'var(--text-muted)', padding:'2px 4px' }}>✕</button>
                                  </div>
                                  <div style={{ display:'flex', gap:16, flexWrap:'wrap', fontSize:12 }}>
                                    {infoFields.map(([k, v]) => {
                                      if (!v) return null
                                      const isApp = k === 'Application'
                                      const ap = isApp ? localAppPath(v) : null
                                      return (
                                        <div key={k}>
                                          <span style={{ fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em' }}>{k}&nbsp;</span>
                                          {ap ? (
                                            <button onClick={() => navigate(ap)} title={`Open ${v} local app`}
                                              style={{ fontWeight:700, color:'#1565c0', background:'#e3f2fd', border:'1px solid #90caf9', borderRadius:4, padding:'2px 8px', fontSize:12, cursor:'pointer' }}
                                              onMouseEnter={e => e.currentTarget.style.background='#bbdefb'}
                                              onMouseLeave={e => e.currentTarget.style.background='#e3f2fd'}>
                                              {v} ↗
                                            </button>
                                          ) : (
                                            <span style={{ fontWeight:500, color:'var(--text-primary)' }}>{v}</span>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                  <FixVersionBlock fixVersions={projectModal.fixVersions} app={projectModal.rule?.application || ''} codeFreezeDate={projectModal.codeFreezeDate} releaseDate={projectModal.releaseDate} />
                                  {existingBranches.length > 0 && (
                                    <div>
                                      <div style={{ fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:4 }}>Existing Branches</div>
                                      {existingBranches.map(([k, v]) => (
                                        <div key={k} style={{ fontSize:12, padding:'2px 0', display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                                          <span style={{ fontSize:10, color:'var(--text-muted)', minWidth:60, flexShrink:0 }}>{k}</span>
                                          <button
                                            onClick={() => doSetupBranch(v, projectModal.rule?.application || info.Application || '')}
                                            title="Click to checkout this branch in local app"
                                            style={{ fontFamily:'monospace', fontSize:12, background:'none', border:'none', color:'var(--primary,#1976d2)', cursor:'pointer', padding:'1px 4px', textAlign:'left', borderRadius:3, textDecoration:'underline', textDecorationStyle:'dotted' }}
                                            onMouseEnter={e => { e.currentTarget.style.background='rgba(25,118,210,0.08)'; e.currentTarget.style.textDecorationStyle='solid' }}
                                            onMouseLeave={e => { e.currentTarget.style.background='none'; e.currentTarget.style.textDecorationStyle='dotted' }}
                                          >{v}</button>
                                          {projectModal.confirmDeleteBranch?.label === k ? (
                                            <span style={{ display:'inline-flex', gap:4, alignItems:'center', fontSize:11 }}>
                                              <span style={{ color:'#c62828', fontWeight:500 }}>Delete?</span>
                                              <button onClick={doDeleteBranch} disabled={projectModal.deleteBranchBusy}
                                                style={{ fontSize:11, padding:'1px 8px', background:'#c62828', color:'#fff', border:'none', borderRadius:3, cursor:'pointer', fontWeight:600, opacity:projectModal.deleteBranchBusy ? 0.6 : 1 }}>
                                                {projectModal.deleteBranchBusy ? '…' : 'Yes'}
                                              </button>
                                              <button onClick={() => setProjectModal(prev => ({ ...prev, confirmDeleteBranch: null }))}
                                                disabled={projectModal.deleteBranchBusy}
                                                style={{ fontSize:11, padding:'1px 8px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:3, cursor:'pointer', color:'var(--text)' }}>
                                                No
                                              </button>
                                            </span>
                                          ) : (
                                            <button
                                              onClick={() => setProjectModal(prev => ({ ...prev, confirmDeleteBranch: { label: k, name: v }, deleteBranchError: null, deleteBranchWarning: null }))}
                                              title={`Delete ${k}`}
                                              style={{ fontSize:12, background:'none', border:'none', cursor:'pointer', color:'#999', padding:'0 2px', lineHeight:1, borderRadius:2 }}
                                              onMouseEnter={e => { e.currentTarget.style.color='#c62828' }}
                                              onMouseLeave={e => { e.currentTarget.style.color='#999' }}
                                            >🗑</button>
                                          )}
                                        </div>
                                      ))}
                                      {projectModal.deleteBranchWarning && (
                                        <div style={{ fontSize:11, color:'#e65100', background:'#fff3e0', border:'1px solid #ffcc80', borderRadius:4, padding:'5px 8px', marginTop:4 }}>
                                          ⚠ {projectModal.deleteBranchWarning}
                                        </div>
                                      )}
                                      {projectModal.deleteBranchError && (
                                        <div style={{ fontSize:11, color:'#c62828', marginTop:4 }}>{projectModal.deleteBranchError}</div>
                                      )}
                                    </div>
                                  )}
                                  {projectModal.addBranchDone ? (
                                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                                      <span style={{ fontSize:12, color:'#2e7d32', fontWeight:600 }}>✓ Branch created in project</span>
                                      <button onClick={() => setProjectModal(null)} style={{ fontSize:11, padding:'2px 8px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:3, cursor:'pointer', color:'var(--text)' }}>Close</button>
                                    </div>
                                  ) : (projectModal.issueType?.toLowerCase() === 'clone - bug' ? (
                                    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                                      <button
                                        onClick={handleCloneWF}
                                        style={{ fontSize:12, padding:'5px 14px', background:'#e65100', color:'#fff', border:'none', borderRadius:4, cursor:'pointer', fontWeight:600 }}
                                      >Clone WF</button>
                                      <button onClick={() => setProjectModal(null)} style={{ fontSize:12, padding:'5px 12px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:4, cursor:'pointer', color:'var(--text)' }}>Cancel</button>
                                    </div>
                                  ) : (
                                    <>
                                      <div>
                                        <div style={{ fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:4 }}>New Branch</div>
                                        <input
                                          value={projectModal.newBranchInput || ''}
                                          onChange={e => setProjectModal(prev => ({ ...prev, newBranchInput: e.target.value }))}
                                          style={{ ...inp12, width:'100%', maxWidth:560 }}
                                          onFocus={e => e.target.style.borderColor='#1565c0'}
                                          onBlur={e  => e.target.style.borderColor='#90caf9'}
                                        />
                                      </div>
                                      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                                        <button onClick={doAddBranch} disabled={projectModal.addBranchBusy || !projectModal.newBranchInput?.trim()}
                                          style={{ fontSize:12, padding:'5px 14px', background:'#1565c0', color:'#fff', border:'none', borderRadius:4, cursor:'pointer', fontWeight:600, opacity:(projectModal.addBranchBusy || !projectModal.newBranchInput?.trim()) ? 0.6 : 1 }}
                                        >{projectModal.addBranchBusy ? 'Creating…' : 'Create Branch'}</button>
                                        <button onClick={() => setProjectModal(null)} style={{ fontSize:12, padding:'5px 12px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:4, cursor:'pointer', color:'var(--text)' }}>Cancel</button>
                                        {projectModal.addBranchError && <span style={{ fontSize:11, color:'#c62828' }}>{projectModal.addBranchError}</span>}
                                      </div>
                                    </>
                                  ))}
                                  <SetupProgress setup={projectModal.setup} onNavigate={navigate} onConfirmRevert={() => doSetupBranch(projectModal.setup?._branchName, projectModal.setup?._application, true)} onAbort={() => setProjectModal(prev => prev ? ({ ...prev, setup: null }) : prev)} />
                                </div>
                              )
                            })() : (
                              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                                  <span style={{ fontSize:12, fontWeight:700, color:'#6a1b9a' }}>+ Create Project</span>
                                  <button onClick={() => setProjectModal(null)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:13, color:'var(--text-muted)', padding:'2px 4px' }}>✕</button>
                                </div>
                                <div style={{ display:'flex', gap:16, alignItems:'center', flexWrap:'wrap' }}>
                                  {projectModal.rule?.application && (() => {
                                    const ap = localAppPath(projectModal.rule.application)
                                    return (
                                      <div style={{ fontSize:12 }}>
                                        <span style={{ fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em' }}>Application&nbsp;</span>
                                        {ap ? (
                                          <button onClick={() => navigate(ap)} title={`Open ${projectModal.rule.application} local app`}
                                            style={{ fontWeight:700, color:'#1565c0', background:'#e3f2fd', border:'1px solid #90caf9', borderRadius:4, padding:'2px 8px', fontSize:12, cursor:'pointer' }}
                                            onMouseEnter={e => e.currentTarget.style.background='#bbdefb'}
                                            onMouseLeave={e => e.currentTarget.style.background='#e3f2fd'}>
                                            {projectModal.rule.application} ↗
                                          </button>
                                        ) : (
                                          <span style={{ fontWeight:700, color:'#1565c0', background:'#e3f2fd', border:'1px solid #90caf9', borderRadius:4, padding:'2px 8px', fontSize:12 }}>
                                            {projectModal.rule.application}
                                          </span>
                                        )}
                                      </div>
                                    )
                                  })()}
                                  {projectModal.team && (
                                    <div style={{ fontSize:12 }}>
                                      <span style={{ fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em' }}>Team&nbsp;</span>
                                      <span style={{ fontWeight:600, color:'var(--text-primary)', fontSize:12 }}>{projectModal.team}</span>
                                    </div>
                                  )}
                                  {projectModal.isDefault && (
                                    <span style={{ fontSize:11, color:'#e65100', background:'#fff3e0', padding:'2px 8px', borderRadius:10, border:'1px solid #ffcc80' }}>
                                      Using default rule (ticket type not matched)
                                    </span>
                                  )}
                                </div>
                                <FixVersionBlock fixVersions={projectModal.fixVersions} app={projectModal.rule?.application || ''} codeFreezeDate={projectModal.codeFreezeDate} releaseDate={projectModal.releaseDate} />
                                {(() => {
                                  const inp = { fontSize:12, padding:'4px 8px', border:'1px solid var(--border)', borderRadius:4, background:'var(--bg)', color:'var(--text-primary)', outline:'none', fontFamily:'monospace', flex:1 }
                                  const sprints = projectModal.sprints || []
                                  const branches = projectModal.branches || []
                                  return (
                                    <>
                                      <div>
                                        <div style={{ fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:5 }}>Sprint(s)</div>
                                        {sprints.map((s, i) => (
                                          <div key={i} style={{ display:'flex', gap:6, marginBottom:5, alignItems:'center' }}>
                                            <input value={s} onChange={e => updateSprint(i, e.target.value)}
                                              placeholder="e.g. StormTroopers_2026-10-20_U"
                                              style={{ ...inp, maxWidth:400 }}
                                              onFocus={e => e.target.style.borderColor='#6a1b9a'}
                                              onBlur={e  => e.target.style.borderColor='var(--border)'}
                                            />
                                            <button onClick={() => removeSprint(i)}
                                              style={{ background:'none', border:'none', cursor:'pointer', fontSize:13, color:'var(--text-muted)', padding:'2px 4px', opacity:0.5 }}
                                              onMouseEnter={e => { e.currentTarget.style.opacity=1; e.currentTarget.style.color='#c62828' }}
                                              onMouseLeave={e => { e.currentTarget.style.opacity=0.5; e.currentTarget.style.color='var(--text-muted)' }}>✕</button>
                                          </div>
                                        ))}
                                        <button onClick={addSprint}
                                          style={{ fontSize:11, color:'#6a1b9a', background:'none', border:'1px dashed rgba(106,27,154,0.35)', borderRadius:4, cursor:'pointer', padding:'2px 10px' }}>
                                          + Add Sprint
                                        </button>
                                      </div>
                                      <div>
                                        <div style={{ fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:5 }}>Branch(es)</div>
                                        {branches.map((b, i) => (
                                          <div key={i} style={{ display:'flex', gap:6, marginBottom:5, alignItems:'center' }}>
                                            <input value={b} onChange={e => updateBranch(i, e.target.value)}
                                              placeholder="branch-name"
                                              style={{ ...inp, maxWidth:560 }}
                                              onFocus={e => e.target.style.borderColor='#6a1b9a'}
                                              onBlur={e  => e.target.style.borderColor='var(--border)'}
                                            />
                                            <button onClick={() => removeBranch(i)}
                                              style={{ background:'none', border:'none', cursor:'pointer', fontSize:13, color:'var(--text-muted)', padding:'2px 4px', opacity:0.5 }}
                                              onMouseEnter={e => { e.currentTarget.style.opacity=1; e.currentTarget.style.color='#c62828' }}
                                              onMouseLeave={e => { e.currentTarget.style.opacity=0.5; e.currentTarget.style.color='var(--text-muted)' }}>✕</button>
                                          </div>
                                        ))}
                                        <button onClick={addBranch}
                                          style={{ fontSize:11, color:'#6a1b9a', background:'none', border:'1px dashed rgba(106,27,154,0.35)', borderRadius:4, cursor:'pointer', padding:'2px 10px' }}>
                                          + Add Branch
                                        </button>
                                      </div>
                                    </>
                                  )
                                })()}
                                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                                  <button onClick={doCreateProject} disabled={projectModal.creating || !(projectModal.branches||[]).some(b=>b.trim())}
                                    style={{ fontSize:12, padding:'5px 14px', background:'#6a1b9a', color:'#fff', border:'none', borderRadius:4, cursor:'pointer', fontWeight:600, opacity: (projectModal.creating || !(projectModal.branches||[]).some(b=>b.trim())) ? 0.6 : 1 }}>
                                    {projectModal.creating ? 'Creating…' : 'Create Project'}
                                  </button>
                                  <button onClick={() => setProjectModal(null)} style={{ fontSize:12, padding:'5px 12px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:4, cursor:'pointer', color:'var(--text)' }}>Cancel</button>
                                  {projectModal.createError && <span style={{ fontSize:11, color:'#c62828' }}>{projectModal.createError}</span>}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    )
                  })}
                </>
              )}
            </tbody>
          </table>
        </div>
        </div>
      )}
    </div>
  )
}

// ─── SprintPage (list view) ──────────────────────────────────────────────────
export default function SprintPage() {
  const [sprints,       setSprints]       = useState([])
  const [teams,         setTeams]         = useState([])
  const [loading,       setLoading]       = useState(true)
  const [showForm,      setShowForm]      = useState(false)
  const [sprintName,    setSprintName]    = useState('')
  const [teamName,      setTeamName]      = useState('')
  const [startDate,     setStartDate]     = useState('')
  const [endDate,       setEndDate]       = useState('')
  const [creating,      setCreating]      = useState(false)
  const [createErr,     setCreateErr]     = useState(null)
  const [createMsg,     setCreateMsg]     = useState(null)
  const [selected,      setSelected]      = useState(null)
  const [activeTeamTab,  setActiveTeamTab]  = useState('All')
  const [showTeamConfig,  setShowTeamConfig]  = useState(false)
  const [configTeams,     setConfigTeams]     = useState([])
  const [configSaving,    setConfigSaving]    = useState(false)
  const [configErr,       setConfigErr]       = useState(null)
  const [sprintSearch,        setSprintSearch]        = useState('')
  const [sprintSearchResults, setSprintSearchResults] = useState(null)
  const [sprintSearchLoading, setSprintSearchLoading] = useState(false)
  const sprintSearchTimer = useRef(null)

  const [showRulesConfig, setShowRulesConfig] = useState(false)
  const [configRules,     setConfigRules]     = useState({ Sprint: [], Project: [] })
  const [rulesTab,        setRulesTab]        = useState('Sprint')
  const [rulesSaving,     setRulesSaving]     = useState(false)
  const [rulesErr,        setRulesErr]        = useState(null)

  const load = () => {
    setLoading(true)
    Promise.all([
      fetch(`${API}/list`).then(r => r.json()),
      fetch(`${API}/teams`).then(r => r.json()),
    ])
      .then(([ld, td]) => {
        if (ld.ok) setSprints(ld.sprints || [])
        if (td.ok) {
          const ts = (td.teams || []).map(t => typeof t === 'string' ? { name: t, board_url: '' } : t)
          setTeams(ts)
          if (ts.length === 1) { setTeamName(ts[0].name); setActiveTeamTab(ts[0].name) }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const openForm = () => {
    setShowForm(true); setCreateErr(null); setCreateMsg(null)
    setSprintName(''); setStartDate(''); setEndDate('')
    fetch(`${API}/rules`).then(r => r.json()).then(d => {
      if (d.ok) {
        if (d.start_date) setStartDate(d.start_date)
        if (d.end_date)   setEndDate(d.end_date)
      }
    }).catch(() => {})
  }

  const handleCreate = () => {
    const team = activeTeamTab !== 'All' ? activeTeamTab : ''
    if (!sprintName.trim()) { setCreateErr('Sprint name is required'); return }
    if (!team)              { setCreateErr('Select a team tab first'); return }
    if (!startDate)         { setCreateErr('Sprint start date is required'); return }
    if (!endDate)           { setCreateErr('Sprint end date is required'); return }
    if (endDate <= startDate){ setCreateErr('End date must be after start date'); return }
    setCreating(true); setCreateErr(null); setCreateMsg(null)
    fetch(`${API}/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sprint_name: sprintName.trim(), team_name: team, sprint_start_date: startDate, sprint_end_date: endDate }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setShowForm(false)
          if (d.message) setCreateMsg(d.message)
          load()
        } else setCreateErr(d.error || 'Failed')
      })
      .catch(e => setCreateErr(String(e)))
      .finally(() => setCreating(false))
  }

  const handleRename = (oldFile, newFile) => {
    const newName = newFile.replace(/\.xlsx$/i, '')
    setSprints(p => p.map(s => s.file === oldFile ? { file: newFile, name: newName } : s))
    setSelected(p => p && p.file === oldFile ? { ...p, file: newFile, name: newName } : p)
  }

  const [deleteConfirmFile, setDeleteConfirmFile] = useState(null)
  const [deleteErr,         setDeleteErr]         = useState(null)
  const [sprintListPage,    setSprintListPage]    = useState(0)
  const SPRINT_PAGE_SIZE = 5

  const handleDelete = async (file) => {
    setDeleteErr(null)
    try {
      const d = await fetch(`${API}/delete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file }),
      }).then(r => r.json())
      if (d.ok) {
        setSprints(p => p.filter(s => s.file !== file))
        setDeleteConfirmFile(null)
      } else setDeleteErr(d.error)
    } catch(e) { setDeleteErr(String(e)) }
  }

  if (selected) return (
    <SprintDetail sprint={selected} onBack={() => { setSelected(null); load() }} onRename={handleRename} />
  )

  const today          = new Date().toISOString().slice(0, 10)
  const teamNames      = teams.map(t => t.name)
  const teamTabs       = teamNames.length > 1 ? ['All', ...teamNames] : teamNames
  const visibleSprints = activeTeamTab === 'All'
    ? sprints
    : sprints.filter(s => teamFrom(s.name) === activeTeamTab)
  const current        = findCurrent(visibleSprints.filter(s => !s.previous))
  const canCreateHere  = activeTeamTab !== 'All' && teamNames.includes(activeTeamTab)

  return (
    <div style={{ padding: '24px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flexShrink: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Sprint</h1>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Create and manage sprint planning files</div>
        </div>

        {/* Search bar */}
        <div style={{ flex: '1 1 260px', maxWidth: 400, position: 'relative' }}>
          <input
            value={sprintSearch}
            onChange={e => {
              const v = e.target.value
              setSprintSearch(v)
              clearTimeout(sprintSearchTimer.current)
              if (!v.trim()) { setSprintSearchResults(null); return }
              setSprintSearchLoading(true)
              sprintSearchTimer.current = setTimeout(() => {
                fetch(`${API}/search?q=${encodeURIComponent(v.trim())}`)
                  .then(r => r.json())
                  .then(d => { setSprintSearchResults(d.ok ? d.results : []); setSprintSearchLoading(false) })
                  .catch(() => { setSprintSearchResults([]); setSprintSearchLoading(false) })
              }, 400)
            }}
            onKeyDown={e => e.key === 'Escape' && (setSprintSearch(''), setSprintSearchResults(null))}
            placeholder="Search JIRA ID or Story…"
            style={{ width: '100%', padding: '7px 32px 7px 12px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box' }}
          />
          {sprintSearch && (
            <button onClick={() => { setSprintSearch(''); setSprintSearchResults(null) }}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--text-muted)', lineHeight: 1 }}>✕</button>
          )}
          {/* Results dropdown */}
          {(sprintSearchLoading || sprintSearchResults !== null) && sprintSearch.trim() && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, marginTop: 4,
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
              boxShadow: '0 4px 20px rgba(0,0,0,0.15)', maxHeight: 380, overflowY: 'auto' }}>
              {sprintSearchLoading ? (
                <div style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>Searching…</div>
              ) : sprintSearchResults.length === 0 ? (
                <div style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)' }}>No results found.</div>
              ) : (
                <>
                  <div style={{ padding: '6px 12px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
                    {sprintSearchResults.length} result{sprintSearchResults.length !== 1 ? 's' : ''} across sprints
                  </div>
                  {sprintSearchResults.map((r, i) => (
                    <div key={i} style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer',
                      background: r.previous ? 'transparent' : 'rgba(21,101,192,0.04)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                      onMouseLeave={e => e.currentTarget.style.background = r.previous ? 'transparent' : 'rgba(21,101,192,0.04)'}
                      onClick={() => {
                        const _team = r.sprint.match(/^(.+?)_\d{4}-\d{2}-\d{2}_/) ?. [1] || ''
                        if (_team) setActiveTeamTab(_team)
                        setSelected({ file: r.file, name: r.sprint, previous: r.previous, _highlightJira: r.jira_id, _openTab: r.sheet === 'Adhoc Task' ? 'Adhoc Task' : 'Sprint Board' })
                        setSprintSearch(''); setSprintSearchResults(null)
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary,#1565c0)', fontFamily: 'monospace' }}>{r.jira_id}</span>
                        {r.status && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'var(--border)', color: 'var(--text-muted)' }}>{r.status}</span>}
                        {r.previous && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: '#f3e5f5', color: '#7b1fa2' }}>Previous</span>}
                        {r.sheet === 'Adhoc Task' && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: '#fff3e0', color: '#e65100' }}>Adhoc</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.story || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 10 }}>
                        <span>📊 {r.sprint.replace(/^.+_\d{4}-\d{2}-\d{2}_/, '').replace(/_/g, ' ')}</span>
                        {r.developer && <span>👤 {r.developer}</span>}
                        {r.sp != null && r.sp !== '' && <span>SP {r.sp}</span>}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button className="btn btn-sm" onClick={() => {
            setShowRulesConfig(true); setRulesErr(null); setRulesTab('Sprint')
            fetch(`${API}/rules-all`).then(r => r.json()).then(d => {
              if (d.ok) setConfigRules({ Sprint: d.rules.Sprint || [], Project: d.rules.Project || [] })
            }).catch(() => {})
          }} style={{ fontSize: 12 }}>⚙ Configure Rules</button>
          <button className="btn btn-sm" onClick={() => setShowTeamConfig(true)}
            style={{ fontSize: 12 }}>⚙ Configure Teams</button>
        </div>
      </div>

      {/* Team tabs */}
      {teamTabs.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, borderBottom: '2px solid var(--border)', marginBottom: 20 }}>
          {teamTabs.map(t => (
            <button key={t} onClick={() => { setActiveTeamTab(t); setShowForm(false); setSprintListPage(0) }}
              style={{
                padding: '7px 18px', fontSize: 13, fontWeight: activeTeamTab === t ? 700 : 500,
                background: 'none', border: 'none', borderBottom: activeTeamTab === t ? '2px solid var(--primary, #1976d2)' : '2px solid transparent',
                marginBottom: -2, cursor: 'pointer', whiteSpace: 'nowrap',
                color: activeTeamTab === t ? 'var(--primary, #1976d2)' : 'var(--text-muted)',
              }}>
              {t === 'All' ? '🌐 All Teams' : `👥 ${t}`}
            </button>
          ))}
        </div>
      )}

      {/* Per-tab New Sprint button */}
      {canCreateHere && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: showForm ? 0 : 16 }}>
          <button className="btn btn-primary btn-sm" onClick={showForm ? () => setShowForm(false) : openForm}>
            {showForm ? 'Cancel' : '+ New Sprint'}
          </button>
        </div>
      )}

      {showForm && (
        <div className="card" style={{ marginBottom: 20, maxWidth: 460 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>
            New Sprint — <span style={{ color: 'var(--primary,#1976d2)' }}>👥 {activeTeamTab}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ fontSize: 12, gridColumn: '1 / -1' }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: 3 }}>Sprint Name</div>
              <input style={FORM_FIELD} placeholder="e.g. Sprint 42" value={sprintName} onChange={e => setSprintName(e.target.value)} autoFocus />
            </label>
            <div style={{ fontSize: 12 }}>
              <DatePicker label="Start Date" value={startDate} onChange={setStartDate} placeholder="Select start date" />
            </div>
            <div style={{ fontSize: 12 }}>
              <DatePicker label="End Date" value={endDate} onChange={setEndDate} min={startDate || undefined} placeholder="Select end date" />
            </div>
          </div>
          {createErr && <div style={{ marginTop: 8, fontSize: 12, color: '#c62828', background: '#ffebee', borderRadius: 4, padding: '4px 8px' }}>{createErr}</div>}
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={handleCreate} disabled={creating}>
              {creating ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Creating…</> : 'Create'}
            </button>
            <button className="btn btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {createMsg && (() => {
        const isOk = createMsg.startsWith('Populated')
        const isWarn = !isOk
        return (
          <div style={{ marginBottom: 16, fontSize: 12, borderRadius: 4, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 10,
            background: isOk ? '#e8f5e9' : '#fff8e1',
            border: `1px solid ${isOk ? '#a5d6a7' : '#ffe082'}` }}>
            <span style={{ color: isOk ? '#2e7d32' : '#e65100' }}>{isOk ? '✓' : 'ℹ'} {createMsg}</span>
            <button onClick={() => setCreateMsg(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)' }}>✕</button>
          </div>
        )
      })()}

      {loading ? (
        <div style={{ padding: '32px 0', textAlign: 'center' }}><span className="spinner" /></div>
      ) : (
        <>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Current Ongoing Sprint
            </div>
            {current ? (
              <div className="card" onClick={() => setSelected(current)}
                style={{ border: '2px solid var(--primary, #1976d2)', background: 'var(--primary-bg, rgba(25,118,210,0.04))', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 28 }}>🏃</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{displayName(current.name)}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      {teamFrom(current.name) && <span style={{ marginRight: 8 }}>👥 {teamFrom(current.name)}</span>}
                      {current.ed && <span style={{ color: current.ed >= today ? '#2e7d32' : '#c62828' }}>{current.ed >= today ? `Ends ${current.ed}` : `Ended ${current.ed}`}</span>}
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--primary, #1976d2)', fontWeight: 600 }}>View →</span>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 0' }}>No active sprint — create one with "+ New Sprint".</div>
            )}
          </div>

          {(() => {
            const pastSprints = [...visibleSprints]
              .filter(s => !current || s.file !== current.file)
              .sort((a, b) => (parseEndDate(b.name) || '').localeCompare(parseEndDate(a.name) || ''))
            const totalPages = Math.ceil(pastSprints.length / SPRINT_PAGE_SIZE)
            const safePage = Math.min(sprintListPage, Math.max(0, totalPages - 1))
            const pageSprints = pastSprints.slice(safePage * SPRINT_PAGE_SIZE, (safePage + 1) * SPRINT_PAGE_SIZE)
            if (pastSprints.length === 0) return null
            return (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', flex: 1 }}>
                    {activeTeamTab === 'All' ? 'All Sprints' : `${activeTeamTab} Sprints`}
                    <span style={{ fontWeight: 400, marginLeft: 6 }}>({pastSprints.length})</span>
                  </div>
                  {totalPages > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button onClick={() => setSprintListPage(p => Math.max(0, p - 1))} disabled={safePage === 0}
                        style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', cursor: safePage === 0 ? 'default' : 'pointer', color: safePage === 0 ? 'var(--text-muted)' : 'var(--text)', fontSize: 12 }}>‹</button>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{safePage + 1} / {totalPages}</span>
                      <button onClick={() => setSprintListPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage === totalPages - 1}
                        style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', cursor: safePage === totalPages - 1 ? 'default' : 'pointer', color: safePage === totalPages - 1 ? 'var(--text-muted)' : 'var(--text)', fontSize: 12 }}>›</button>
                    </div>
                  )}
                </div>
                {deleteErr && (
                  <div style={{ marginBottom: 8, fontSize: 12, color: '#c62828', background: '#ffebee', borderRadius: 4, padding: '4px 8px' }}>{deleteErr}</div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {pageSprints.map(s => {
                    const ed = parseEndDate(s.name)
                    const confirmingDelete = deleteConfirmFile === s.file
                    return (
                      <div key={s.file}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 5,
                          background: 'var(--surface)', border: '1px solid var(--border)' }}
                        onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 1px 6px rgba(0,0,0,0.1)' }}
                        onMouseLeave={e => { e.currentTarget.style.boxShadow = '' }}
                      >
                        <span style={{ fontSize: 14, cursor: 'pointer' }} onClick={() => setSelected(s)}>📊</span>
                        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setSelected(s)}>
                          <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(s.name)}{s.previous && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: '#f3e5f5', color: '#7b1fa2', marginLeft: 8 }}>Completed</span>}</div>
                          {teamFrom(s.name) && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>👥 {teamFrom(s.name)}</div>}
                        </div>
                        {ed && <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={() => setSelected(s)}>{ed}</span>}
                        <span style={{ fontSize: 11, color: 'var(--primary, #1976d2)', fontWeight: 600, cursor: 'pointer' }} onClick={() => setSelected(s)}>View →</span>
                        {confirmingDelete ? (
                          <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
                            <button onClick={() => handleDelete(s.file)}
                              style={{ fontSize: 10, padding: '2px 7px', background: '#c62828', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer' }}>
                              Delete
                            </button>
                            <button onClick={() => { setDeleteConfirmFile(null); setDeleteErr(null) }}
                              style={{ fontSize: 10, padding: '2px 6px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', color: 'var(--text)' }}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button onClick={e => { e.stopPropagation(); setDeleteConfirmFile(s.file); setDeleteErr(null) }}
                            title="Delete sprint"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--text-muted)', padding: '2px 4px', opacity: 0.45, flexShrink: 0 }}
                            onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = '#c62828' }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = 0.45; e.currentTarget.style.color = 'var(--text-muted)' }}
                          >🗑</button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </>
      )}

      {/* ── Configure Rules modal ────────────────────────────────────────── */}
      {showRulesConfig && (() => {
        const RULE_TABS = ['Sprint', 'Project']
        const RULE_COLS = {
          Sprint:  ['Rule', 'Condition', 'Unit', 'Notes'],
          Project: ['JIRA Prefix', 'Ticket Type', 'Branch Prefix', 'Branch Midfix', 'Branch Postfix', 'Application', 'Default'],
        }
        const cols = RULE_COLS[rulesTab] || []
        const rows = configRules[rulesTab] || []
        const setRows = updater => setConfigRules(p => ({ ...p, [rulesTab]: typeof updater === 'function' ? updater(p[rulesTab] || []) : updater }))
        const emptyRow = () => Object.fromEntries(cols.map(c => [c, '']))

        const saveRules = async () => {
          setRulesSaving(true); setRulesErr(null)
          try {
            const d = await fetch(`${API}/rules-save`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ rules: { Sprint: configRules.Sprint, Project: configRules.Project } }),
            }).then(r => r.json())
            if (d.ok) setShowRulesConfig(false)
            else setRulesErr(d.error)
          } catch(e) { setRulesErr(String(e)) }
          finally { setRulesSaving(false) }
        }

        const inputStyle = { padding: '5px 6px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', color: 'var(--text)', width: '100%', boxSizing: 'border-box' }

        return (
          <div className="modal-overlay" onClick={() => setShowRulesConfig(false)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: rulesTab === 'Project' ? 960 : 620, width: '97vw' }}>
              <div className="modal-header">
                <span className="modal-title">⚙ Configure Rules</span>
                <button className="modal-close" onClick={() => setShowRulesConfig(false)}>✕</button>
              </div>
              <div className="modal-body">
                {/* Sub-tabs */}
                <div style={{ display: 'flex', gap: 2, borderBottom: '2px solid var(--border)', marginBottom: 16 }}>
                  {RULE_TABS.map(t => (
                    <button key={t} onClick={() => setRulesTab(t)} style={{
                      padding: '6px 16px', fontSize: 13, fontWeight: rulesTab === t ? 700 : 400,
                      background: 'none', border: 'none', cursor: 'pointer',
                      borderBottom: rulesTab === t ? '2px solid var(--primary,#1976d2)' : '2px solid transparent',
                      marginBottom: -2, color: rulesTab === t ? 'var(--primary,#1976d2)' : 'var(--text-muted)',
                    }}>{t}</button>
                  ))}
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                    <colgroup>
                      {cols.map((_, ci) => <col key={ci} style={{ width: `${Math.floor(88 / cols.length)}%` }} />)}
                      <col style={{ width: '12%' }} />
                    </colgroup>
                    <thead>
                      <tr>
                        {cols.map(c => (
                          <th key={c} style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid var(--border)' }}>{c}</th>
                        ))}
                        <th style={{ width: 36, borderBottom: '1px solid var(--border)' }} />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}>
                          {cols.map(c => (
                            <td key={c} style={{ padding: '4px 4px' }}>
                              <input value={r[c] ?? ''} placeholder={c}
                                onChange={e => setRows(p => p.map((x, j) => j === i ? { ...x, [c]: e.target.value } : x))}
                                style={inputStyle} />
                            </td>
                          ))}
                          <td style={{ padding: '4px 4px', textAlign: 'center' }}>
                            <button onClick={() => setRows(p => p.filter((_, j) => j !== i))}
                              style={{ fontSize: 13, color: '#c62828', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>🗑</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button onClick={() => setRows(p => [...p, emptyRow()])}
                  style={{ fontSize: 12, padding: '5px 12px', marginTop: 8, background: 'none', border: '1px dashed var(--border)', borderRadius: 5, cursor: 'pointer', color: 'var(--text-muted)' }}>
                  + Add Rule
                </button>

                {rulesErr && <div style={{ marginTop: 10, fontSize: 12, color: '#c62828', background: '#ffebee', borderRadius: 4, padding: '4px 8px' }}>{rulesErr}</div>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                  <button className="btn btn-sm" onClick={() => setShowRulesConfig(false)}>Cancel</button>
                  <button className="btn btn-primary btn-sm" onClick={saveRules} disabled={rulesSaving}>
                    {rulesSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Configure Teams modal ─────────────────────────────────────────── */}
      {showTeamConfig && (() => {
        const openConfig = () => {
          setConfigTeams(teams.map(t => ({ ...t })))
          setConfigErr(null)
        }
        if (configTeams.length === 0 && teams.length > 0 && !configErr) openConfig()

        const saveConfig = async () => {
          const valid = configTeams.filter(t => t.name.trim())
          setConfigSaving(true); setConfigErr(null)
          try {
            const d = await fetch(`${API}/teams/save`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ teams: valid.map(t => ({ name: t.name.trim(), board_url: t.board_url.trim() })) }),
            }).then(r => r.json())
            if (d.ok) { setShowTeamConfig(false); setConfigTeams([]); load() }
            else setConfigErr(d.error)
          } catch(e) { setConfigErr(String(e)) }
          finally { setConfigSaving(false) }
        }

        return (
          <div className="modal-overlay" onClick={() => { setShowTeamConfig(false); setConfigTeams([]) }}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560, width: '95vw' }}>
              <div className="modal-header">
                <span className="modal-title">⚙ Configure Teams</span>
                <button className="modal-close" onClick={() => { setShowTeamConfig(false); setConfigTeams([]) }}>✕</button>
              </div>
              <div className="modal-body">
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                  Team names and Scrum board URLs — saved to Template.xlsx Teams tab.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr auto', gap: '6px 8px', alignItems: 'center', marginBottom: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Team Name</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Scrum Board URL</div>
                  <div />
                  {configTeams.map((t, i) => (
                    <>
                      <input key={`n${i}`} value={t.name} placeholder="Team name"
                        onChange={e => setConfigTeams(p => p.map((x, j) => j===i ? {...x, name: e.target.value} : x))}
                        style={{ padding: '6px 8px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 5, background: 'var(--bg)', color: 'var(--text)' }} />
                      <input key={`u${i}`} value={t.board_url} placeholder="https://…/boards/123"
                        onChange={e => setConfigTeams(p => p.map((x, j) => j===i ? {...x, board_url: e.target.value} : x))}
                        style={{ padding: '6px 8px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 5, background: 'var(--bg)', color: 'var(--text)' }} />
                      <button key={`d${i}`} onClick={() => setConfigTeams(p => p.filter((_, j) => j !== i))}
                        style={{ padding: '4px 8px', fontSize: 13, color: '#c62828', background: 'none', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }}>🗑</button>
                    </>
                  ))}
                </div>
                <button onClick={() => setConfigTeams(p => [...p, { name: '', board_url: '' }])}
                  style={{ fontSize: 12, padding: '5px 12px', marginTop: 4, background: 'none', border: '1px dashed var(--border)', borderRadius: 5, cursor: 'pointer', color: 'var(--text-muted)' }}>
                  + Add Team
                </button>
                {configErr && <div style={{ marginTop: 10, fontSize: 12, color: '#c62828', background: '#ffebee', borderRadius: 4, padding: '4px 8px' }}>{configErr}</div>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                  <button className="btn btn-sm" onClick={() => { setShowTeamConfig(false); setConfigTeams([]) }}>Cancel</button>
                  <button className="btn btn-primary btn-sm" onClick={saveConfig} disabled={configSaving}>
                    {configSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
