import { useState, useEffect, useCallback, useRef } from 'react'
import ToolRunsPage from './ToolRunsPage'

const COLS = [
  { key: 'pid',                      label: 'PID',                   bold: true },
  { key: 'ticket',                   label: 'JIRA Ticket',           primary: true },
  { key: 'release_branch',           label: 'Release Branch',        mono: true },
  { key: 'vm_name',                  label: 'VM Name' },
  { key: 'vm_ip',                    label: 'IP',                    mono: true },
  { key: 'status',                   label: 'Status',                badge: true },
  { key: 'payor_melissa_updated',    label: 'Payor pom.xml',          detailOnly: true },
  { key: 'classic_melissa_updated',  label: 'Classic pom.xml',        detailOnly: true },
  { key: 'payor_feature_branch',     label: 'Payor Feature Branch',   mono: true, detailOnly: true },
  { key: 'payor_pr_url',             label: 'Payor PR',               link: true, detailOnly: true },
  { key: 'classic_feature_branch',   label: 'Classic Feature Branch', mono: true, detailOnly: true },
  { key: 'classic_pr_url',           label: 'Classic PR',             link: true, detailOnly: true },
  { key: 'timestamp',                label: 'Timestamp',             mono: true, truncate: 16 },
  { key: 'changes',                  label: 'Changes' },
]

const IMG_SUFFIXES = [
  '_Update_MelissaData.png',
  '_Melissa_Data_Git_Status.png',
  '_Melissa_Data_Git_Status_Classic.png',
]

const TOTAL_STAGES = 21

// ── Progress bar ─────────────────────────────────────────────────────────────
function MelissaProgress({ pid }) {
  const [data,    setData]    = useState(null)
  const timerRef              = useRef(null)

  const poll = useCallback(() => {
    fetch(`/api/tools/melissa/stats/${pid}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) setData(d)
        // keep polling while something is running
        if (d.ok && (d.running_stage || d.done < d.total)) {
          timerRef.current = setTimeout(poll, 3000)
        }
      })
      .catch(() => { timerRef.current = setTimeout(poll, 5000) })
  }, [pid])

  useEffect(() => {
    poll()
    return () => clearTimeout(timerRef.current)
  }, [poll])

  if (!data || data.done === 0) return null

  const pct          = Math.round((data.done / (data.total || TOTAL_STAGES)) * 100)
  const elapsed      = data.total_elapsed_s || 0
  const avgPerStage  = data.done > 0 ? elapsed / data.done : 0
  const remaining    = Math.max(0, ((data.total || TOTAL_STAGES) - data.done) * avgPerStage)
  const fmt          = s => s < 60 ? `${Math.round(s)}s` : `${Math.floor(s/60)}m ${Math.round(s%60)}s`
  const stageName    = (data.running_stage || '').replace(/_/g, ' ')

  return (
    <div style={{ margin: '10px 0 6px', minWidth: 320 }}>
      {/* Bar */}
      <div style={{
        height: 14, borderRadius: 7, background: 'var(--surface2)',
        overflow: 'hidden', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.3)',
      }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          borderRadius: 7,
          background: 'linear-gradient(90deg, #43a047 0%, #66bb6a 60%, #a5d6a7 100%)',
          boxShadow: '0 0 8px rgba(76,175,80,0.6), 0 1px 2px rgba(0,0,0,0.2)',
          transition: 'width 0.6s ease',
          position: 'relative',
        }}>
          {pct >= 12 && (
            <span style={{
              position: 'absolute', right: 6, top: 0, lineHeight: '14px',
              fontSize: 10, fontWeight: 700, color: '#fff',
              textShadow: '0 0 4px rgba(0,0,0,0.5)',
            }}>{pct}%</span>
          )}
        </div>
      </div>
      {/* Stats row */}
      <div style={{ display: 'flex', gap: 14, marginTop: 4, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, color: '#66bb6a' }}>{pct}% complete</span>
        <span>{data.done} / {data.total || TOTAL_STAGES} stages</span>
        {elapsed > 0 && <span>Elapsed: {fmt(elapsed)}</span>}
        {remaining > 0 && data.running_stage && <span>~{fmt(remaining)} remaining</span>}
        {stageName && (
          <span style={{ color: 'var(--text)', fontStyle: 'italic' }}>
            {data.running_stage ? `Running: ${stageName}` : 'Done'}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Log terminal ─────────────────────────────────────────────────────────────
function LogTerminal({ runId, onDone }) {
  const [lines,  setLines]  = useState([])
  const [status, setStatus] = useState('running')
  const bottomRef = useRef(null)
  const timerRef  = useRef(null)

  const poll = useCallback(() => {
    if (!runId) return
    fetch(`/api/tools/melissa/output/${runId}`)
      .then(r => r.json())
      .then(d => {
        if (!d.ok) return
        setLines((d.output || '').split('\n'))
        setStatus(d.status)
        if (d.status === 'running') {
          timerRef.current = setTimeout(poll, 2000)
        } else {
          onDone && onDone(d.status)
        }
      })
      .catch(() => { timerRef.current = setTimeout(poll, 3000) })
  }, [runId, onDone])

  useEffect(() => {
    if (!runId) return
    poll()
    return () => clearTimeout(timerRef.current)
  }, [runId, poll])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  const statusColor = status === 'done' ? '#4caf50' : status === 'failed' ? '#f44336' : '#ffa726'
  const statusLabel = status === 'done' ? 'Completed' : status === 'failed' ? 'Failed' : 'Running…'

  return (
    <div style={{
      margin: '12px 0', borderRadius: 6, overflow: 'hidden',
      border: '1px solid #333', background: '#0d1117',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', background: '#161b22',
        borderBottom: '1px solid #333',
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor,
          boxShadow: `0 0 6px ${statusColor}`, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: statusColor }}>{statusLabel}</span>
        <span style={{ fontSize: 11, color: '#8b949e', marginLeft: 4 }}>
          run: {runId}
        </span>
      </div>
      <div style={{
        fontFamily: 'Consolas, "Courier New", monospace', fontSize: 12,
        color: '#c9d1d9', background: '#0d1117',
        padding: '10px 14px', maxHeight: 420, overflowY: 'auto',
        whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        lineHeight: 1.55,
      }}>
        {lines.length === 0
          ? <span style={{ color: '#8b949e' }}>Waiting for output…</span>
          : lines.map((l, i) => (
              <div key={i} style={{ color: l.startsWith('  ERROR') || l.includes('ABORT') ? '#f85149'
                : l.includes('✓') || l.includes('Connected') || l.includes('Passed') ? '#3fb950'
                : l.startsWith('  !') || l.includes('Warning') ? '#d29922'
                : '#c9d1d9' }}>
                {l || ' '}
              </div>
            ))
        }
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function MelissaPage() {
  const [vmOptions,  setVmOptions]  = useState([])
  const [defaultVm,  setDefaultVm]  = useState('')
  const [images,     setImages]     = useState([])
  const [runIds,     setRunIds]     = useState({})   // pid → run_id
  const [executing,  setExecuting]  = useState(null)
  const [reloadKey,  setReloadKey]  = useState(0)

  useEffect(() => {
    fetch('/api/vms')
      .then(r => r.json())
      .then(data => {
        const vms = Array.isArray(data) ? data : []
        const anmol = vms.find(v => (v.assigned_to || '').toLowerCase().includes('anmol'))
        if (anmol) setDefaultVm(anmol.name)
        setVmOptions(vms.map(v => ({
          value: v.name,
          label: v.assigned_to ? `${v.name} — ${v.assigned_to}` : v.name,
        })))
      })
      .catch(() => {})
  }, [])

  const refreshImages = useCallback(() => {
    fetch('/api/tools/melissa/images')
      .then(r => r.json())
      .then(d => setImages(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [])

  useEffect(() => { refreshImages() }, [refreshImages])

  const createFields = [
    { name: 'ticket',         label: 'JIRA Ticket',          type: 'text',   placeholder: 'e.g. PAYOR-12345', required: true },
    { name: 'release_branch', label: 'Payor Release Branch', type: 'text',   placeholder: 'e.g. 26.2.1.0.1',  required: true },
    { name: 'vm_name',        label: 'Remote VM',            type: 'select', options: vmOptions, default: defaultVm, required: true },
  ]

  const imageNames = new Set(images.map(i => i.name))

  const renderRowActions = (row) => {
    const pid    = String(row.pid || '')
    const isExec = executing === pid
    const runId  = runIds[pid]
    const isPassed = ['passed', 'success', 'done'].includes((row.status || '').toLowerCase())

    return (
      <div style={{ minWidth: 120 }}>
        {!isPassed && (
          <div style={{ marginBottom: runId ? 4 : 0 }}>
            <button
              className="btn btn-sm btn-primary"
              disabled={isExec}
              onClick={async () => {
                setExecuting(pid)
                try {
                  const r = await fetch(`/api/tools/melissa/projects/${pid}/execute`, { method: 'POST' })
                  const d = await r.json()
                  if (d.ok && d.run_id) {
                    setRunIds(prev => ({ ...prev, [pid]: d.run_id }))
                  } else {
                    alert(d.error || 'Execute failed')
                    setExecuting(null)
                  }
                } catch {
                  alert('Execute request failed')
                  setExecuting(null)
                }
              }}
            >
              {isExec ? '…' : '▶ Execute'}
            </button>
          </div>
        )}

        {(isExec || runId) && <MelissaProgress pid={pid} />}

        {runId && (
          <LogTerminal
            runId={runId}
            onDone={() => {
              setExecuting(null)
              refreshImages()
              setReloadKey(k => k + 1)
            }}
          />
        )}
      </div>
    )
  }

  const renderRowDetail = (row) => {
    const pid    = String(row.pid    || '')
    const ticket = row.ticket || ''
    const prefix = `${pid}_${ticket}`
    const links  = IMG_SUFFIXES
      .map(s => prefix + s)
      .filter(n => imageNames.has(n))
    if (links.length === 0) return null
    return (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>Downloads:</span>
        {links.map(name => (
          <a key={name}
            href={`/api/tools/melissa/images/${encodeURIComponent(name)}`}
            download={name}
            className="btn btn-sm"
            title={name}
            style={{ fontSize: 11 }}
          >
            ↓ {name.replace(`${prefix}_`, '').replace('.png', '')}
          </a>
        ))}
      </div>
    )
  }

  return (
    <ToolRunsPage
      key={reloadKey}
      title="Melissa Update"
      tool="melissa"
      columns={COLS}
      sortBy="pid"
      sortNum
      idKey="pid"
      deletable
      createFields={createFields}
      createUrl="/api/tools/melissa/projects"
      renderRowActions={renderRowActions}
      renderRowDetail={renderRowDetail}
      schedulerConfigUrl="/api/tools/melissa/scheduler-config"
      schedulerSettingsUrl="/api/tools/melissa/scheduler-settings"
      refreshIntervalOptions={[1, 2, 3, 5]}
    />
  )
}
