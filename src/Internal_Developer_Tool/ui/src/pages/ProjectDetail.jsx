import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  ReactFlow, Background, Controls, Panel,
  Handle, Position, MarkerType,
  useNodesState, useEdgesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'

// "26.2.1.0.1" or "release/26.2.1.0.1" → "26.2.1.0"
// "26.2.1.0.1" → "26.2.1.0"  (keep first 4 segments; "26.2.1.0" → "26.2.1.0" unchanged)
function derivePayorVersion(releaseBranch) {
  const v = (releaseBranch || '').trim().replace(/^release\//i, '')
  const parts = v.split('.')
  if (parts.length >= 5) return parts.slice(0, 4).join('.')
  return v
}

// ── Stage key → app route ─────────────────────────────────────────────────────
const STAGE_ROUTE = {
  jcj:                '/tools/jcj',
  puc_baseline:       '/tools/puc',
  baseline:           '/tools/baseline',
  remote_setup:       '/tools/remote-setup',
  melissa_update:     '/tools/melissa',
  melissa_gp_payor:   '/tools/gp-run',
  melissa_gp_classic: '/tools/gp-run',
  clone:              '/tools/clone',
  clone_pr_gp:        '/tools/gp-run',
  jreg:               '/tools/jreg',
  rpb:                '/tools/rpb',
  puc:                '/tools/puc',
}

// ── Stage manual inputs: fields users must/can provide when skipping ──────────
// required:true means Skip is blocked until the value is provided
// baseline and jreg are absent — fields are generated dynamically from their respective job-config APIs
const STAGE_MANUAL_INPUTS = {
  jcj_baseline:       [{ key: 'jcj_baseline_build_version', label: 'Payor Build Version (Baseline)', required: true, placeholder: 'e.g. 26.2.1.0.4-202610160150-4d49dc5' }],
  melissa_gp_payor:   [{ key: 'pr_url', label: 'Melissa PR URL (Payor)',   required: false, placeholder: 'https://github.com/...' }],
  melissa_gp_classic: [{ key: 'pr_url', label: 'Melissa PR URL (Classic)', required: false, placeholder: 'https://github.com/...' }],
  clone:              [
    { key: 'clone_branch', label: 'Clone Branch', required: true, placeholder: 'e.g. bug-PAYOR-210071-fix-summary' },
  ],
  clone_pr_gp:        [{ key: 'pr_url', label: 'Clone PR GP URL', required: false, placeholder: 'https://github.com/...' }],
  jcj:                [{ key: 'jcj_build_version',          label: 'Payor Build Version',          required: true, placeholder: 'e.g. 26.2.1.0.4-202610160150-4d49dc5' }],
}

// Canonical workflow stage order — used to sort Stage Inputs display
const STAGE_ORDER = [
  'jcj_baseline', 'puc_baseline', 'baseline', 'remote_setup',
  'melissa_update', 'melissa_gp_payor', 'melissa_gp_classic',
  'clone', 'clone_pr_gp', 'jcj', 'jreg', 'rpb', 'puc',
]

// ── Dagre auto-layout ─────────────────────────────────────────────────────────
const NODE_W = 270
const NODE_H = 172

function layoutGraph(rawNodes, rawEdges) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', ranksep: 100, nodesep: 36, marginx: 24, marginy: 24 })
  rawNodes.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }))
  rawEdges.forEach(e => g.setEdge(e.source, e.target))
  dagre.layout(g)
  return rawNodes.map(n => {
    const p = g.node(n.id)
    return { ...n, position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 } }
  })
}

// ── Status colours ────────────────────────────────────────────────────────────
const S_COLOR = {
  'Completed':    '#22c55e',
  'In Progress':  '#3b82f6',
  'Waiting':      '#f59e0b',
  'Failed':       '#ef4444',
  'Skipped':      '#94a3b8',
  'Pending':      '#cbd5e1',
  'Stage Paused': '#a855f7',
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(seconds) {
  if (seconds == null || seconds < 0) return null
  if (seconds < 60)   return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}

function fmtPoll(s) {
  if (!s) return '—'
  if (s < 60)   return `${s}s`
  if (s < 3600) return `${s / 60}m`
  return `${s / 3600}h`
}

function elapsed(startStr, endStr) {
  if (!startStr) return null
  const start = new Date(startStr.replace(' ', 'T'))
  const end   = endStr ? new Date(endStr.replace(' ', 'T')) : new Date()
  return Math.max(0, Math.round((end - start) / 1000))
}

// ── Custom Stage Node ─────────────────────────────────────────────────────────
const StageNode = memo(function StageNode({ data }) {
  const { stage, eta, hasRoute, pausedAt, onRetrigger, retriggering, onSkip, skipping, onInclude, including, canSkip, onPause, onResume, stagePausing, stageResuming, runbookData } = data
  const color      = S_COLOR[stage.status] || S_COLOR['Pending']
  const pct        = eta?.progress ?? (stage.status === 'Completed' || stage.status === 'Skipped' ? 100 : 0)
  // When workflow is paused and stage is still in progress, freeze elapsed at pausedAt
  const elapsedS   = elapsed(stage.started_at, stage.completed_at || (stage.status === 'In Progress' && pausedAt ? pausedAt : null))
  const remainingS = eta?.remaining ?? null
  const inProgress = stage.status === 'In Progress'
  const isWaiting     = stage.status === 'Waiting'
  const awaitingUrls  = isWaiting && stage.notes?.startsWith('Awaiting Jenkins URLs:')
  const waitingOn     = isWaiting && !awaitingUrls && stage.notes
    ? stage.notes.replace(/^Waiting on:\s*/i, '').split(',').map(x => x.trim()).filter(Boolean)
    : []

  return (
    <div style={{
      width: NODE_W, height: NODE_H,
      background: 'var(--surface, #fff)',
      border: `2px solid ${color}`,
      borderRadius: 10,
      overflow: 'hidden',
      boxShadow: inProgress
        ? `0 0 0 3px ${color}33, 0 2px 8px rgba(0,0,0,0.12)`
        : '0 2px 6px rgba(0,0,0,0.08)',
      cursor: hasRoute ? 'pointer' : 'default',
      fontFamily: 'inherit',
    }}>
      <Handle type="target" position={Position.Left}  style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />

      {/* Header */}
      <div style={{
        background: `${color}22`,
        borderBottom: `1px solid ${color}44`,
        padding: '7px 10px 6px',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{
          fontSize: 10, fontWeight: 700,
          color: 'var(--surface, #fff)',
          background: color,
          borderRadius: 4, padding: '1px 5px',
          flexShrink: 0, lineHeight: 1.5,
        }}>
          #{stage.stage_id}
        </span>
        <span style={{
          fontWeight: 600, fontSize: 12,
          color: 'var(--text, #111)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1,
        }}>
          {stage.stage_name}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {/* Progress bar */}
        <div>
          <div style={{ background: 'rgba(0,0,0,0.08)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, Math.max(0, pct))}%`, height: '100%',
              background: stage.status === 'Completed' || stage.status === 'Skipped'
                ? 'linear-gradient(90deg,#4ade80,#22c55e)'
                : `linear-gradient(90deg,${color}bb,${color})`,
              borderRadius: 4, transition: 'width 0.5s ease',
            }} />
          </div>
          <div style={{ fontSize: 10, color, marginTop: 2, textAlign: 'right', fontWeight: 600 }}>
            {pct}%
          </div>
        </div>

        {/* Awaiting Jenkins URLs */}
        {awaitingUrls && (
          <div style={{ fontSize: 9, color: '#22c55e', lineHeight: 1.4 }}>
            ⓘ {stage.notes.replace(/^Awaiting Jenkins URLs:\s*/i, 'Provide Jenkins URLs: ')}
          </div>
        )}
        {/* Waiting on */}
        {waitingOn.length > 0 && (
          <div style={{ fontSize: 10, color: '#f59e0b', lineHeight: 1.3 }}>
            ⏳ {waitingOn.join(', ')}
          </div>
        )}

        {/* Timing */}
        {(elapsedS != null || remainingS != null || eta?.avg_eta) && (
          <div style={{ display: 'flex', gap: 8, fontSize: 10, color: 'var(--text-muted,#6b7280)', flexWrap: 'wrap' }}>
            {elapsedS != null && (inProgress || stage.status === 'Completed' || stage.status === 'Failed' || stage.status === 'Skipped' || stage.status === 'Aborted') && <span title="Elapsed">⏱ {fmtTime(elapsedS)}</span>}
            {inProgress && remainingS != null && fmtTime(remainingS) && (
              <span title="Remaining" style={{ color }}>↩ {fmtTime(remainingS)}</span>
            )}
            {(stage.status === 'Pending' || isWaiting) && eta?.avg_eta && (
              <span title="Estimated avg" style={{ opacity: 0.7 }}>~{fmtTime(eta.avg_eta)}</span>
            )}
          </div>
        )}

        {/* Project / run ID */}
        {(() => {
          // For clone_pr_gp, show the real GP project_id (from output_params) not the internal UUID tool_pid
          if (stage.stage_key === 'clone_pr_gp') {
            let gpId = ''
            try {
              const op = typeof stage.output_params === 'string'
                ? JSON.parse(stage.output_params)
                : (stage.output_params || {})
              gpId = op.gp_project_id || ''
            } catch (_) {}
            if (!gpId) return null
            return (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                fontSize: 10, fontWeight: 600,
                color,
                background: `${color}15`,
                border: `1px solid ${color}40`,
                borderRadius: 4, padding: '1px 6px',
                alignSelf: 'flex-start', marginTop: 2,
              }}>
                GP #{gpId}
              </div>
            )
          }
          return stage.tool_pid ? (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 10, fontWeight: 600,
              color,
              background: `${color}15`,
              border: `1px solid ${color}40`,
              borderRadius: 4, padding: '1px 6px',
              alignSelf: 'flex-start', marginTop: 2,
            }}>
              Run #{stage.tool_pid}
            </div>
          ) : null
        })()}

        {/* Runbook hint panel for Failed stages */}
        {stage.status === 'Failed' && runbookData && (
          (runbookData.failure_rate?.failed > 0 || (runbookData.suggestions || []).length > 0) && (
            <div style={{ margin: '6px 0 2px 0', padding: '8px 10px',
                          background: '#fff8f0', border: '1px solid #f0d0a0',
                          borderRadius: 4, fontSize: 11 }}>
              {runbookData.failure_rate?.reached > 0 && runbookData.failure_rate?.failed > 0 && (
                <div style={{ color: '#c0392b', fontWeight: 600, marginBottom: 4 }}>
                  ⚠ Failed {runbookData.failure_rate.failed} of last {runbookData.failure_rate.reached} runs
                </div>
              )}
              {(runbookData.suggestions || []).length > 0 && (
                <>
                  <div style={{ color: '#7a5500', fontWeight: 600, marginBottom: 3 }}>
                    💡 Suggested checks:
                  </div>
                  <ul style={{ margin: '0 0 0 14px', padding: 0 }}>
                    {runbookData.suggestions.map((s, i) => (
                      <li key={i} style={{ color: '#555', marginBottom: 2 }}>{s}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )
        )}
        {/* Retrigger button for Failed stages */}
        {stage.status === 'Failed' && onRetrigger && (
          <button
            onClick={e => { e.stopPropagation(); onRetrigger(String(stage.stage_key || stage.stage_id)) }}
            disabled={retriggering === String(stage.stage_key || stage.stage_id)}
            style={{
              all: 'unset', cursor: 'pointer', marginTop: 'auto',
              fontSize: 10, fontWeight: 700, color: '#fff',
              background: retriggering === String(stage.stage_key || stage.stage_id) ? '#999' : '#ef4444',
              borderRadius: 4, padding: '2px 8px', alignSelf: 'flex-start',
              border: 'none', lineHeight: 1.6,
            }}
          >
            {retriggering === String(stage.stage_key || stage.stage_id) ? '…' : '⟳ Retrigger'}
          </button>
        )}
        {/* Include button for Skipped */}
        {stage.status === 'Skipped' && onInclude && (
          <button
            onClick={e => { e.stopPropagation(); onInclude(String(stage.stage_key || stage.stage_id)) }}
            disabled={including === String(stage.stage_key || stage.stage_id)}
            style={{
              all: 'unset', cursor: 'pointer', marginTop: 2,
              fontSize: 10, fontWeight: 700, color: '#fff',
              background: including === String(stage.stage_key || stage.stage_id) ? '#999' : '#22c55e',
              borderRadius: 4, padding: '2px 8px', alignSelf: 'flex-start',
              border: 'none', lineHeight: 1.6,
            }}
          >
            {including === String(stage.stage_key || stage.stage_id) ? '…' : '↩ Include'}
          </button>
        )}
        {/* Pause button for Pending / Waiting stages (before execution) */}
        {['Pending', 'Waiting'].includes(stage.status) && onPause && (
          <button
            onClick={e => { e.stopPropagation(); onPause(String(stage.stage_key || stage.stage_id)) }}
            disabled={stagePausing === String(stage.stage_key || stage.stage_id)}
            style={{
              all: 'unset', cursor: 'pointer', marginTop: 2,
              fontSize: 10, fontWeight: 700, color: '#fff',
              background: stagePausing === String(stage.stage_key || stage.stage_id) ? '#999' : '#a855f7',
              borderRadius: 4, padding: '2px 8px', alignSelf: 'flex-start',
              border: 'none', lineHeight: 1.6,
            }}
          >
            {stagePausing === String(stage.stage_key || stage.stage_id) ? '…' : '⏸ Pause'}
          </button>
        )}
        {/* Resume button for Stage Paused */}
        {stage.status === 'Stage Paused' && onResume && (
          <button
            onClick={e => { e.stopPropagation(); onResume(String(stage.stage_key || stage.stage_id)) }}
            disabled={stageResuming === String(stage.stage_key || stage.stage_id)}
            style={{
              all: 'unset', cursor: 'pointer', marginTop: 2,
              fontSize: 10, fontWeight: 700, color: '#fff',
              background: stageResuming === String(stage.stage_key || stage.stage_id) ? '#999' : '#22c55e',
              borderRadius: 4, padding: '2px 8px', alignSelf: 'flex-start',
              border: 'none', lineHeight: 1.6,
            }}
          >
            {stageResuming === String(stage.stage_key || stage.stage_id) ? '…' : '▶ Resume'}
          </button>
        )}
        {/* Skip button — available for any non-terminal status */}
        {!['Completed', 'Skipped'].includes(stage.status) && onSkip && (
          <>
            <button
              onClick={e => { e.stopPropagation(); if (canSkip !== false) onSkip(String(stage.stage_key || stage.stage_id)) }}
              disabled={skipping === String(stage.stage_key || stage.stage_id) || canSkip === false}
              style={{
                all: 'unset', cursor: canSkip === false ? 'not-allowed' : 'pointer', marginTop: 2,
                fontSize: 10, fontWeight: 700, color: '#fff',
                background: skipping === String(stage.stage_key || stage.stage_id) ? '#999' : canSkip === false ? '#94a3b8' : '#64748b',
                borderRadius: 4, padding: '2px 8px', alignSelf: 'flex-start',
                border: 'none', lineHeight: 1.6, opacity: canSkip === false ? 0.7 : 1,
              }}
            >
              {skipping === String(stage.stage_key || stage.stage_id) ? '…' : '⊘ Skip'}
            </button>
            {canSkip === false && (
              <div style={{ fontSize: 9, color: '#22c55e', marginTop: 2, lineHeight: 1.3 }}>
                ⓘ Provide stage inputs to enable skip
              </div>
            )}
          </>
        )}
        {/* Click hint */}
        {hasRoute && stage.status !== 'Failed' && stage.status !== 'Pending'
          && stage.status !== 'Waiting' && stage.status !== 'Aborted' && (
          <div style={{ fontSize: 9, color, opacity: 0.65, marginTop: 'auto' }}>
            Click to open ↗
          </div>
        )}
      </div>
    </div>
  )
})

const NODE_TYPES = { stage: StageNode }

// ── Glossy green project progress bar ────────────────────────────────────────
function GlossyBar({ pct, elapsedS, remainingS }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                    fontSize: 12, marginBottom: 6 }}>
        <div style={{ display: 'flex', gap: 16, color: 'var(--text-muted,#6b7280)' }}>
          {elapsedS != null && (
            <span>⏱ Elapsed: <strong style={{ color: 'var(--text,#111)' }}>{fmtTime(elapsedS)}</strong></span>
          )}
          {remainingS != null && fmtTime(remainingS) && (
            <span>↩ Remaining: <strong style={{ color: '#22c55e' }}>{fmtTime(remainingS)}</strong></span>
          )}
        </div>
        <span style={{ fontWeight: 700, fontSize: 14, color: pct === 100 ? '#22c55e' : 'var(--text,#111)' }}>
          {pct}%
        </span>
      </div>

      <div style={{
        background: 'rgba(0,0,0,0.08)', borderRadius: 12, height: 22,
        overflow: 'hidden', border: '1px solid rgba(0,0,0,0.07)', position: 'relative',
      }}>
        <div style={{
          width: `${Math.min(100, Math.max(0, pct))}%`, height: '100%',
          background: 'linear-gradient(180deg,#86efac 0%,#4ade80 18%,#22c55e 48%,#16a34a 78%,#166534 100%)',
          boxShadow: 'inset 0 3px 0 rgba(255,255,255,0.45),inset 0 -2px 0 rgba(0,0,0,0.2)',
          borderRadius: 11, transition: 'width 0.7s cubic-bezier(0.4,0,0.2,1)', position: 'relative',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: '45%',
            background: 'linear-gradient(180deg,rgba(255,255,255,0.35) 0%,rgba(255,255,255,0.05) 100%)',
            borderRadius: '11px 11px 0 0',
          }} />
        </div>
        {pct > 12 && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex', alignItems: 'center', paddingLeft: 10,
            fontSize: 11, fontWeight: 700, color: '#fff',
            textShadow: '0 1px 2px rgba(0,0,0,0.3)', pointerEvents: 'none',
          }}>
            {pct}% complete
          </div>
        )}
      </div>
    </div>
  )
}

// ── Editable meta field ───────────────────────────────────────────────────────
function EditableMetaItem({ label, value, onSave, placeholder = '' }) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(value || '')
  const [busy,    setBusy]    = useState(false)

  // Sync draft when parent value changes (e.g. after load)
  useEffect(() => { if (!editing) setDraft(value || '') }, [value, editing])

  const save = async () => {
    setBusy(true)
    await onSave(draft)
    setBusy(false)
    setEditing(false)
  }

  if (!editing) {
    return (
      <div className="meta-item">
        <div className="meta-label">{label}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className="meta-value mono" style={{ color: value ? undefined : 'var(--text-muted)' }}>
            {value || '—'}
          </div>
          <button
            title="Edit"
            onClick={() => { setDraft(value || ''); setEditing(true) }}
            style={{
              all: 'unset', cursor: 'pointer', fontSize: 12,
              color: 'var(--primary)', opacity: 0.65,
              lineHeight: 1,
            }}
          >✎</button>
        </div>
      </div>
    )
  }

  return (
    <div className="meta-item">
      <div className="meta-label">{label}</div>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          autoFocus
          value={draft}
          placeholder={placeholder}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
          style={{
            fontSize: 12, fontFamily: 'Consolas, monospace',
            padding: '4px 8px', border: '1px solid var(--primary)',
            borderRadius: 5, background: 'var(--surface)',
            color: 'var(--text)', width: 180, outline: 'none',
          }}
        />
        <button className="btn btn-sm btn-primary" onClick={save} disabled={busy}>
          {busy ? '…' : 'Save'}
        </button>
        <button className="btn btn-sm" onClick={() => setEditing(false)}>✕</button>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ProjectDetail() {
  const { pid }    = useParams()
  const navigate   = useNavigate()
  const [data,          setData]          = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [etaData,       setEtaData]       = useState({})
  const [wfRemaining,   setWfRemaining]   = useState(null)
  const [engineRunning,      setEngineRunning]      = useState(false)
  const [executing,          setExecuting]           = useState(false)
  const [execError,          setExecError]           = useState('')
  const [preflightChecking,  setPreflightChecking]   = useState(false)
  const [preflightFailed,    setPreflightFailed]     = useState(null)  // array of failed checks or null
  const [validating,         setValidating]          = useState(false)
  const [validationResults,  setValidationResults]   = useState(null)  // null | array of checks
  const [aborting,      setAborting]      = useState(false)
  const [pausing,       setPausing]       = useState(false)
  const [resuming,      setResuming]      = useState(false)
  const [confirmDlg,    setConfirmDlg]    = useState(null)
  const [deps,          setDeps]          = useState({})
  const [toolPids,      setToolPids]      = useState({})
  const [saving,        setSaving]        = useState({})
  const [dirty,         setDirty]         = useState({})
  const [showPids,          setShowPids]          = useState(false)
  const [showCollectedData, setShowCollectedData] = useState(false)
  const [stageOutputs,   setStageOutputs]   = useState({})
  const [baselineJobs,   setBaselineJobs]   = useState([])
  const [jregJobs,       setJregJobs]       = useState([])
  const [expandedInputs, setExpandedInputs] = useState(null)
  const [draftInputs,    setDraftInputs]    = useState({})
  const [savingInputs,   setSavingInputs]   = useState(null)

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [ctxMenu,      setCtxMenu]      = useState(null)   // { x, y, nodeId, stageName, stageStatus }
  const [retriggering,   setRetriggering]   = useState(null)
  const [skipping,       setSkipping]       = useState(null)
  const [including,      setIncluding]      = useState(null)
  const [stagePausing,   setStagePausing]   = useState(null)
  const [stageResuming,  setStageResuming]  = useState(null)
  const [runbook,        setRunbook]        = useState({})   // {stage_key: {suggestions, failure_rate}}
  const [releaseNotes,        setReleaseNotes]        = useState(null)
  const [releaseNotesLoading, setReleaseNotesLoading] = useState(false)
  const [releaseNotesError,   setReleaseNotesError]   = useState('')
  const [showReleaseNotes,    setShowReleaseNotes]    = useState(false)
  const [rnCopied,            setRnCopied]            = useState(false)

  // ── Data loading ──────────────────────────────────────────────────────────
  const load = useCallback(() => {
    fetch(`/api/projects/${pid}`)
      .then(r => r.json())
      .then(d => {
        setData(d)
        const pids = {}
        ;(d.stages || []).forEach(s => { pids[s.stage_key || s.stage_id] = s.tool_pid || '' })
        setToolPids(pids)
        setDirty({})
        const so = d?.project?.stage_outputs || {}
        setStageOutputs(typeof so === 'object' ? so : {})
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [pid])

  const loadEta = useCallback(() => {
    fetch(`/api/projects/${pid}/eta`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setEtaData(d.stages || {})
          setWfRemaining(d.workflow_remaining ?? null)
          setEngineRunning(d.is_engine_running || false)
        }
      })
      .catch(() => {})
  }, [pid])

  const loadDeps = useCallback(() => {
    fetch('/api/workflow/dependencies')
      .then(r => r.json())
      .then(d => { if (d.ok) setDeps(d.dependencies || {}) })
      .catch(() => {})
  }, [])

  useEffect(() => { load(); loadEta(); loadDeps() }, [load, loadEta, loadDeps])

  useEffect(() => {
    fetch('/api/clone-workflow/runbook')
      .then(r => r.json())
      .then(d => { if (d.ok) setRunbook(d.runbook || {}) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/tools/jbaseline/jobs?app=Payor')
      .then(r => r.json())
      .then(d => { if (d.ok && Array.isArray(d.jobs)) setBaselineJobs(d.jobs) })
      .catch(() => {})
    fetch('/api/tools/jreg/job-config/Payor')
      .then(r => r.json())
      .then(d => {
        if (d.ok && Array.isArray(d.jobs)) {
          setJregJobs(d.jobs.filter(j => j.enabled !== false).map(j => j.job_name))
        }
      })
      .catch(() => {})
  }, [])

  // Merge static STAGE_MANUAL_INPUTS with dynamic per-job fields for baseline and jreg
  const effectiveManualInputs = useMemo(() => {
    const inputs = { ...STAGE_MANUAL_INPUTS }
    if (baselineJobs.length > 0) {
      inputs.baseline = baselineJobs.map(job => ({
        key: `baseline_url_${job}`,
        label: `${job} Jenkins URL`,
        required: true,
        placeholder: 'https://jenkins/job/...',
      }))
    }
    if (jregJobs.length > 0) {
      inputs.jreg = jregJobs.map(job => ({
        key: `jreg_url_${job}`,
        label: `${job} Jenkins URL`,
        required: true,
        placeholder: 'https://jenkins/job/...',
      }))
    }
    return inputs
  }, [baselineJobs, jregJobs])

  // Collected data from completed stages — shown in the summary card
  const collectedData = useMemo(() => {
    const stages  = data?.stages || []
    const project = data?.project || {}

    const parseOuts = (key) => {
      const s = stages.find(s => (s.stage_key || s.stage_id) === key)
      if (!s) return {}
      try { return JSON.parse(s.output_params || '{}') || {} } catch { return {} }
    }

    // VM info: prefer remote_setup outputs, fall back to project-level remote_vm
    const rsOuts = parseOuts('remote_setup')
    const vmName = rsOuts.remote_vm || project.remote_vm || ''
    const vmIp   = rsOuts.vm_ip   || ''

    // Payor branch version (release branch like 26.2.1.0.1 — same for both baseline and regression)
    const payorVersion = project.release_branch || ''

    // Baseline Jenkins URLs: from completed stage output_params merged with user-provided
    const blOuts     = parseOuts('baseline')
    const blUserOuts = stageOutputs.baseline || {}
    const baselineUrls = {}
    ;[...Object.entries(blUserOuts), ...Object.entries(blOuts)].forEach(([k, v]) => {
      if (k.startsWith('baseline_url_') && v) {
        baselineUrls[k.slice('baseline_url_'.length)] = v
      }
    })

    // Regression Jenkins URLs: from completed stage output_params merged with user-provided
    const jrOuts     = parseOuts('jreg')
    const jrUserOuts = stageOutputs.jreg || {}
    const regressionUrls = {}
    ;[...Object.entries(jrUserOuts), ...Object.entries(jrOuts)].forEach(([k, v]) => {
      if (k.startsWith('jreg_url_') && v) {
        regressionUrls[k.slice('jreg_url_'.length)] = v
      }
    })

    // Melissa Data outputs: from melissa_update stage output_params
    const mdlOuts               = parseOuts('melissa_update')
    const melissaChanges        = mdlOuts.changes        || ''
    const payorPomUpdated       = mdlOuts.payor_melissa_updated   || ''
    const classicPomUpdated     = mdlOuts.classic_melissa_updated || ''
    const payorFeatureBranch    = mdlOuts.payor_feature_branch    || ''
    const payorReleaseBranch    = mdlOuts.payor_release_branch    || ''
    const payorPrUrl            = mdlOuts.payor_pr_url            || ''
    const classicFeatureBranch  = mdlOuts.classic_feature_branch  || ''
    const classicReleaseBranch  = mdlOuts.classic_release_branch  || ''
    const classicPrUrl          = mdlOuts.classic_pr_url          || ''
    const hasMelissaOutputs     = !!(melissaChanges || payorPomUpdated || payorPrUrl || classicPrUrl)

    return { vmName, vmIp, payorVersion, baselineUrls, regressionUrls,
             melissaChanges, payorPomUpdated, classicPomUpdated,
             payorFeatureBranch, payorReleaseBranch, payorPrUrl,
             classicFeatureBranch, classicReleaseBranch, classicPrUrl,
             hasMelissaOutputs }
  }, [data?.stages, data?.project, stageOutputs])

  // Reverse-dependency map: stageKey → [stages that depend on it]
  const reverseDeps = useMemo(() => {
    const map = {}
    Object.entries(deps).forEach(([sid, depList]) => {
      ;(depList || []).forEach(dep => {
        if (!map[dep]) map[dep] = []
        map[dep].push(sid)
      })
    })
    return map
  }, [deps])

  // Returns true if a Skipped stage can safely be re-included (no downstream stage is Completed)
  const canIncludeStage = useCallback((stageKey) => {
    const downstreams = reverseDeps[stageKey] || []
    return !downstreams.some(dsKey => {
      const ds = data?.stages?.find(s => String(s.stage_key || s.stage_id) === dsKey)
      return ds?.status === 'Completed'
    })
  }, [reverseDeps, data?.stages])

  // Returns true if a stage can be skipped (all required manual inputs are provided).
  const canSkipStage = useCallback((stageKey) => {
    const stage = data?.stages?.find(s => String(s.stage_key || s.stage_id) === String(stageKey))
    if (!stage || ['Completed', 'Skipped'].includes(stage.status)) return false
    const inputs = effectiveManualInputs[stageKey]
    if (!inputs) return true
    const required = inputs.filter(f => f.required)
    if (required.length === 0) return true
    const saved = stageOutputs[stageKey] || {}
    return required.every(f => (saved[f.key] || '').trim() !== '')
  }, [stageOutputs, effectiveManualInputs, data?.stages])

  const retriggerStage = useCallback(async (stageKey) => {
    const stage = data?.stages?.find(s => (s.stage_key || s.stage_id) === stageKey)
    if (!stage) return
    setRetriggering(stageKey)
    setCtxMenu(null)
    try {
      await fetch(`/api/projects/${pid}/stages/${stage.stage_id}/retrigger`, { method: 'POST' })
      load(); loadEta()
    } catch {}
    setRetriggering(null)
  }, [pid, data?.stages, load, loadEta])

  const skipStage = useCallback(async (stageKey) => {
    const stage = data?.stages?.find(s => (s.stage_key || s.stage_id) === stageKey)
    if (!stage) return
    setSkipping(stageKey)
    setCtxMenu(null)
    try {
      await fetch(`/api/projects/${pid}/stages/${stage.stage_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Skipped' }),
      })
      load(); loadEta()
    } catch {}
    setSkipping(null)
  }, [pid, data?.stages, load, loadEta])

  const includeStage = useCallback(async (stageKey) => {
    const stage = data?.stages?.find(s => (s.stage_key || s.stage_id) === stageKey)
    if (!stage) return
    setIncluding(stageKey)
    setCtxMenu(null)
    try {
      await fetch(`/api/projects/${pid}/stages/${stage.stage_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Pending' }),
      })
      load(); loadEta()
    } catch {}
    setIncluding(null)
  }, [pid, data?.stages, load, loadEta])

  const pauseStage = useCallback(async (stageKey) => {
    const stage = data?.stages?.find(s => String(s.stage_key || s.stage_id) === String(stageKey))
    if (!stage) return
    setStagePausing(stageKey)
    setCtxMenu(null)
    try {
      await fetch(`/api/projects/${pid}/stages/${stage.stage_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Stage Paused' }),
      })
      load()
    } catch {}
    setStagePausing(null)
  }, [pid, data?.stages, load])

  const resumeStage = useCallback(async (stageKey) => {
    const stage = data?.stages?.find(s => String(s.stage_key || s.stage_id) === String(stageKey))
    if (!stage) return
    setStageResuming(stageKey)
    setCtxMenu(null)
    try {
      await fetch(`/api/projects/${pid}/stages/${stage.stage_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Pending' }),
      })
      load()
    } catch {}
    setStageResuming(null)
  }, [pid, data?.stages, load])

  // Auto-poll: 5 s while active, otherwise at polling_interval / 2
  useEffect(() => {
    const isActive     = engineRunning || data?.project?.status === 'In Progress'
    const cfgInterval  = data?.project?.polling_interval
    if (!isActive && !cfgInterval) return
    const ms = isActive ? 5000 : Math.max(15000, Math.round(Number(cfgInterval) * 500))
    const id = setInterval(() => { load(); loadEta() }, ms)
    return () => clearInterval(id)
  }, [engineRunning, data?.project?.status, data?.project?.polling_interval, load, loadEta])

  // ── Build graph whenever data / eta / deps change ─────────────────────────
  const _layoutedNodeIdsRef = useRef(null)
  const nodesRef = useRef([])
  useEffect(() => { nodesRef.current = nodes }, [nodes])

  useEffect(() => {
    if (!data?.stages) return
    const stages = data.stages

    // Use stage_key as node ID (matches deps graph and _TOOL_CMD keys)
    const rawNodes = stages.map(s => {
      const key = String(s.stage_key || s.stage_id)
      return {
        id:   key,
        type: 'stage',
        data: {
          stage:       s,
          eta:         etaData[key] || null,
          hasRoute:    !!STAGE_ROUTE[key],
          pausedAt:    data?.project?.status === 'Paused' ? (data?.project?.paused_at || null) : null,
          onRetrigger:  retriggerStage,
          retriggering,
          onSkip:       skipStage,
          canSkip:      canSkipStage(key),
          skipping,
          onInclude:    canIncludeStage(key) ? includeStage : null,
          including,
          onPause:      pauseStage,
          onResume:     resumeStage,
          stagePausing,
          stageResuming,
          runbookData:  runbook[key] || null,
        },
        position: { x: 0, y: 0 },
      }
    })

    const nodeKeySet = new Set(rawNodes.map(n => n.id))

    // Edges: dep → stage  (source = dependency, target = stage that waits for it)
    const rawEdges = []
    Object.entries(deps).forEach(([sid, depList]) => {
      ;(depList || []).forEach(dep => {
        if (nodeKeySet.has(dep) && nodeKeySet.has(sid)) {
          const srcStage = stages.find(s => String(s.stage_key || s.stage_id) === dep)
          const color = S_COLOR[srcStage?.status] || '#cbd5e1'
          rawEdges.push({
            id:        `${dep}→${sid}`,
            source:    dep,
            target:    sid,
            animated:  srcStage?.status === 'In Progress',
            style:     { stroke: color, strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
          })
        }
      })
    })

    const nodeIdsKey = rawNodes.map(n => n.id).sort().join(',')
    const nodeSetChanged = _layoutedNodeIdsRef.current !== nodeIdsKey

    if (nodeSetChanged) {
      _layoutedNodeIdsRef.current = nodeIdsKey
      // Restore saved positions if available; fall back to Dagre auto-layout
      let savedPositions = {}
      try { savedPositions = JSON.parse(localStorage.getItem(`project-layout-${pid}`)) || {} } catch {}
      const hasSaved = Object.keys(savedPositions).length > 0
      const dagreNodes = layoutGraph(rawNodes, rawEdges)
      setNodes(hasSaved
        ? dagreNodes.map(n => ({ ...n, position: savedPositions[n.id] ?? n.position }))
        : dagreNodes
      )
    } else {
      // Same set of nodes — update data, preserve manually-set positions from the ref
      const posMap = {}
      nodesRef.current.forEach(n => { posMap[n.id] = n.position })
      setNodes(rawNodes.map(n => ({ ...n, position: posMap[n.id] ?? n.position })))
    }
    setEdges(rawEdges)
  }, [data?.stages, data?.project, etaData, deps, setNodes, setEdges, retriggerStage, retriggering, skipStage, skipping, includeStage, including, canIncludeStage, canSkipStage])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const doExecute = async () => {
    setExecuting(true)
    setExecError('')
    try {
      const resp = await fetch(`/api/projects/${pid}/execute`, { method: 'POST' })
      const d    = await resp.json()
      if (!resp.ok || d.ok === false) {
        setExecError(d.error || 'Failed to start workflow')
      } else {
        if (d.is_running) setEngineRunning(true)
        load(); loadEta()
      }
    } catch {
      setExecError('Could not reach the server')
    }
    setExecuting(false)
  }

  const handleExecute = async () => {
    setPreflightFailed(null)
    setExecError('')
    setPreflightChecking(true)
    try {
      const pf   = await fetch('/api/preflight')
      const pfData = await pf.json()
      setPreflightChecking(false)
      const failed = (pfData.checks || []).filter(c => c.reachable === false)
      if (failed.length > 0) {
        setPreflightFailed(failed)
        return
      }
    } catch {
      // preflight itself unreachable — don't block execute
      setPreflightChecking(false)
    }
    doExecute()
  }

  const handleValidate = async () => {
    setValidating(true)
    setValidationResults(null)
    try {
      const resp = await fetch('/api/clone-workflow/validate-inputs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid }),
      })
      const d = await resp.json()
      setValidationResults(d.checks || [])
    } catch {
      setValidationResults([{ key: 'error', status: 'error', message: 'Could not reach the server' }])
    }
    setValidating(false)
  }

  const fetchReleaseNotes = () => {
    setReleaseNotesLoading(true)
    setReleaseNotesError('')
    fetch(`/api/projects/${pid}/release-notes`)
      .then(r => r.json())
      .then(d => {
        setReleaseNotesLoading(false)
        if (d.ok) setReleaseNotes(d)
        else setReleaseNotesError(d.error || 'Failed to generate release notes')
      })
      .catch(() => {
        setReleaseNotesLoading(false)
        setReleaseNotesError('Server unreachable')
      })
  }

  const handleAbort = () => {
    setConfirmDlg({
      title: 'Abort Workflow',
      message: 'All running and scheduled sub-workflows will be stopped. This cannot be undone.',
      confirmLabel: 'Abort',
      onConfirm: async () => {
        setConfirmDlg(null)
        setAborting(true)
        try {
          await fetch(`/api/projects/${pid}/abort`, { method: 'POST' })
          setEngineRunning(false)
          load(); loadEta()
        } catch {}
        setAborting(false)
      },
    })
  }

  const handlePause = async () => {
    setPausing(true)
    try {
      await fetch(`/api/projects/${pid}/pause`, { method: 'POST' })
      load(); loadEta()
    } catch {}
    setPausing(false)
  }

  const handleResume = async () => {
    setResuming(true)
    try {
      await fetch(`/api/projects/${pid}/resume`, { method: 'POST' })
      load(); loadEta()
    } catch {}
    setResuming(false)
  }

  const patchStage = useCallback(async (stageKey, patch) => {
    setSaving(s => ({ ...s, [stageKey]: true }))
    // stageKey may be "baseline" etc; the PATCH route uses stage_id (number)
    // find numeric stage_id from loaded data
    const stageId = data?.stages?.find(
      s => (s.stage_key || s.stage_id) === stageKey
    )?.stage_id ?? stageKey
    await fetch(`/api/projects/${pid}/stages/${stageId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    setSaving(s => ({ ...s, [stageKey]: false }))
    load()
  }, [pid, load, data?.stages])

  const savePid = (stageKey) => {
    patchStage(stageKey, { tool_pid: toolPids[stageKey] || '' })
    setDirty(d => ({ ...d, [stageKey]: false }))
  }

  const patchProject = useCallback(async (patch) => {
    await fetch(`/api/projects/${pid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    load()
  }, [pid, load])

  const handleNodeClick = useCallback((_, node) => {
    setCtxMenu(null)
    const route = STAGE_ROUTE[node.id]
    if (route) navigate(route, { state: { fromProject: pid } })
  }, [navigate, pid])

  const handleNodeContextMenu = useCallback((event, node) => {
    event.preventDefault()
    const stage = data?.stages?.find(s => String(s.stage_key || s.stage_id) === node.id)
    const status = stage?.status || ''
    setCtxMenu({
      x: event.clientX, y: event.clientY, nodeId: node.id,
      stageName: stage?.stage_name || node.id, stageStatus: status,
      canInclude: status === 'Skipped' && canIncludeStage(node.id),
    })
  }, [data?.stages, canIncludeStage])

  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])

  const handleNodeDragStop = useCallback(() => {
    const positions = {}
    nodesRef.current.forEach(n => { positions[n.id] = n.position })
    localStorage.setItem(`project-layout-${pid}`, JSON.stringify(positions))
  }, [pid])

  const resetLayout = useCallback(() => {
    localStorage.removeItem(`project-layout-${pid}`)
    _layoutedNodeIdsRef.current = null
    load()
  }, [pid, load])

  const ctxSetStatus = useCallback(async (status) => {
    if (!ctxMenu) return
    await patchStage(ctxMenu.nodeId, { status })
    setCtxMenu(null)
  }, [ctxMenu, patchStage])

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return <div className="center"><span className="spinner" /></div>
  if (!data || !data.project) return <div className="empty"><h3>Project not found</h3></div>

  const { project, stages } = data
  const total      = Number(project.total_stages)     || 0
  const done       = Number(project.completed_stages) || 0
  const overallPct = total > 0 ? Math.round((done / total) * 100) : 0
  const projElapsed = elapsed(
    project.started_at || null,
    project.status === 'Completed' ? project.completed_at
    : project.status === 'Paused'  ? (project.paused_at || null)
    : null,
  )

  const inProgressStages = stages.filter(s => s.status === 'In Progress')

  return (
    <div>
      <button className="btn back-link" onClick={() => navigate('/clone-projects')}>← Back</button>

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ marginBottom: 2 }}>
            Project #{project.pid} — {project.ticket}
          </h1>
          {project.polling_interval && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Poll interval: {fmtPoll(Number(project.polling_interval))}
            </span>
          )}
        </div>
        <div className="flex-gap">
          <span className={`badge ${
            project.status === 'Completed' ? 'badge-success'
            : project.status === 'In Progress' ? 'badge-warning'
            : project.status === 'Paused' ? 'badge-warning'
            : project.status === 'Failed' ? 'badge-danger'
            : project.status === 'Aborted' ? 'badge-danger'
            : 'badge-pending'}`}>
            {project.status}
          </span>
          {!engineRunning
           && project.status !== 'Completed'
           && project.status !== 'Aborted'
           && project.status !== 'In Progress'
           && project.status !== 'Paused'
           && (
            <>
              <button
                className="btn"
                onClick={handleValidate}
                disabled={validating}
                style={{ background: 'var(--border)', color: 'var(--text)' }}
              >
                {validating ? 'Validating…' : '✓ Validate'}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleExecute}
                disabled={executing || preflightChecking}
              >
                {preflightChecking ? 'Checking…' : executing ? '…' : '▶ Execute Workflow'}
              </button>
              {validationResults && (
                <div style={{ marginTop: 8, padding: '8px 12px',
                              background: 'var(--surface-alt, #f8fafc)',
                              border: '1px solid var(--border)',
                              borderRadius: 4, fontSize: 13, minWidth: 340 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <strong>Input Validation</strong>
                    <button
                      onClick={() => setValidationResults(null)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer',
                               color: 'var(--text-muted)', fontSize: 14, padding: '0 2px' }}
                    >✕</button>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <tbody>
                      {validationResults.map(c => {
                        const icon = c.status === 'ok' ? '✓' : c.status === 'error' ? '✗' : c.status === 'warning' ? '⚠' : '—'
                        const color = c.status === 'ok' ? '#22c55e' : c.status === 'error' ? '#ef4444' : c.status === 'warning' ? '#f59e0b' : '#94a3b8'
                        return (
                          <tr key={c.key} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ width: 20, color, fontWeight: 700, paddingRight: 6, paddingTop: 4, paddingBottom: 4 }}>{icon}</td>
                            <td style={{ color: 'var(--text-muted)', wordBreak: 'break-word' }}>{c.message}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {validationResults.every(c => c.status !== 'error') && (
                    <div style={{ marginTop: 6, fontSize: 11, color: '#22c55e' }}>
                      No blocking issues — safe to execute.
                    </div>
                  )}
                  {validationResults.some(c => c.status === 'error') && (
                    <div style={{ marginTop: 6, fontSize: 11, color: '#ef4444' }}>
                      Errors found — review before executing.
                    </div>
                  )}
                </div>
              )}
              {preflightFailed && (
                <div style={{ marginTop: 8, padding: '8px 12px',
                              background: 'var(--danger-bg, #fff0f0)',
                              border: '1px solid var(--danger, #d9534f)',
                              borderRadius: 4, fontSize: 13 }}>
                  <strong>Cannot start — connectivity check failed:</strong>
                  <ul style={{ margin: '4px 0 6px 16px', padding: 0 }}>
                    {preflightFailed.map(c => (
                      <li key={c.name}><strong>{c.name}</strong>: {c.error}</li>
                    ))}
                  </ul>
                  <button
                    style={{ fontSize: 12, cursor: 'pointer', background: 'none',
                             border: 'none', color: 'var(--text-muted)',
                             textDecoration: 'underline', padding: 0 }}
                    onClick={() => { setPreflightFailed(null); doExecute() }}
                  >Ignore and execute anyway</button>
                </div>
              )}
              {execError && (
                <span style={{ fontSize: 12, color: 'var(--danger)' }}>{execError}</span>
              )}
            </>
          )}
          {project.status === 'In Progress' && engineRunning && (
            <button
              className="btn"
              onClick={handlePause}
              disabled={pausing}
              style={{ background: 'var(--border)', color: 'var(--text)' }}
            >
              {pausing ? 'Pausing…' : '⏸ Pause'}
            </button>
          )}
          {project.status === 'Paused' && (
            <button
              className="btn btn-primary"
              onClick={handleResume}
              disabled={resuming}
            >
              {resuming ? 'Resuming…' : '▶ Resume'}
            </button>
          )}
          {project.status !== 'Aborted' && project.status !== 'Completed'
            && project.status !== 'Pending' && project.status !== 'Failed'
            && (project.status === 'In Progress' || project.status === 'Paused' || engineRunning) && (
            <button
              className="btn btn-danger"
              onClick={handleAbort}
              disabled={aborting}
            >
              {aborting ? 'Aborting…' : '■ Abort'}
            </button>
          )}
          {project.release_branch && (
            <button
              onClick={() => { setShowReleaseNotes(v => !v); if (!releaseNotes && !releaseNotesLoading) fetchReleaseNotes() }}
              style={{ fontSize: 12, padding: '4px 12px', border: '1px solid var(--border)',
                       borderRadius: 4, background: 'var(--bg-subtle)', cursor: 'pointer', color: 'var(--text)' }}
            >
              📄 Release Notes
            </button>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="meta" style={{ marginBottom: 16 }}>
        <EditableMetaItem
          label="Release Branch Version"
          value={project.release_branch}
          placeholder="e.g. 26.2.1.0.1"
          onSave={async v => {
            const patch = { release_branch: v }
            try {
              const r = await fetch(`/api/clone-workflow/pom-version?branch=${encodeURIComponent(v.trim())}`)
              const d = await r.json()
              if (d.ok && d.payor_release_version) patch.payor_version = d.payor_release_version
              else { const fb = derivePayorVersion(v); if (fb) patch.payor_version = fb }
            } catch { const fb = derivePayorVersion(v); if (fb) patch.payor_version = fb }
            patchProject(patch)
          }}
        />
        <EditableMetaItem
          label="Payor Release Version"
          value={project.payor_version}
          placeholder="e.g. 24.10.0"
          onSave={v => patchProject({ payor_version: v })}
        />
        <EditableMetaItem
          label="BC Config Version Prefix"
          value={project.bluecard_config_version_prefix}
          placeholder="e.g. staging:24.10.0-"
          onSave={v => patchProject({ bluecard_config_version_prefix: v })}
        />
        <EditableMetaItem
          label="DataUniverse Version Prefix"
          value={project.datauniverse_version_prefix}
          placeholder="e.g. staging:24.10.0-"
          onSave={v => patchProject({ datauniverse_version_prefix: v })}
        />
        <EditableMetaItem
          label="Remote VM"
          value={project.remote_vm}
          placeholder="e.g. dev-vm-01"
          onSave={v => patchProject({ remote_vm: v })}
        />
        {stages.some(s => ['melissa_update', 'melissa_gp_payor', 'melissa_gp_classic'].includes(s.stage_key)) && (
          <EditableMetaItem
            label="Melissa Data JIRA Ticket"
            value={project.melissa_ticket}
            placeholder="e.g. PAYOR-210066"
            onSave={v => patchProject({ melissa_ticket: v })}
          />
        )}
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

      {/* Release Notes Panel */}
      {showReleaseNotes && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 6,
                      marginBottom: 16, background: 'var(--bg)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
                        borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>📄 Release Notes Draft</span>
            {releaseNotes && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {releaseNotes.commit_count} commits · {releaseNotes.branch_name}
              </span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {releaseNotes && (
                <>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(releaseNotes.draft).then(() => {
                        setRnCopied(true); setTimeout(() => setRnCopied(false), 2000)
                      }).catch(() => {})
                    }}
                    style={{ fontSize: 11, padding: '2px 10px', border: '1px solid var(--border)',
                             borderRadius: 3, background: 'none', cursor: 'pointer', color: 'var(--text)' }}
                  >
                    {rnCopied ? '✓ Copied' : '📋 Copy'}
                  </button>
                  <button
                    onClick={() => {
                      const blob = new Blob([releaseNotes.draft], { type: 'text/plain' })
                      const a = document.createElement('a')
                      a.href = URL.createObjectURL(blob)
                      a.download = `release-notes-${releaseNotes.release_branch || 'draft'}.txt`
                      a.click()
                      URL.revokeObjectURL(a.href)
                    }}
                    style={{ fontSize: 11, padding: '2px 10px', border: '1px solid var(--border)',
                             borderRadius: 3, background: 'none', cursor: 'pointer', color: 'var(--text)' }}
                  >
                    ⬇ Download
                  </button>
                  <button
                    onClick={fetchReleaseNotes}
                    disabled={releaseNotesLoading}
                    style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--border)',
                             borderRadius: 3, background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                  >
                    {releaseNotesLoading ? '…' : '↻'}
                  </button>
                </>
              )}
              <button
                onClick={() => setShowReleaseNotes(false)}
                style={{ fontSize: 14, padding: '2px 6px', border: 'none', background: 'none',
                         cursor: 'pointer', color: 'var(--text-muted)' }}
              >✕</button>
            </div>
          </div>
          <div style={{ padding: '10px 14px' }}>
            {releaseNotesLoading && (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Fetching commits from GitHub…</div>
            )}
            {releaseNotesError && !releaseNotesLoading && (
              <div style={{ color: '#ef4444', fontSize: 13 }}>⚠ {releaseNotesError}</div>
            )}
            {releaseNotes && !releaseNotesLoading && (
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'Consolas, monospace',
                            fontSize: 12, color: 'var(--text)', lineHeight: 1.6,
                            maxHeight: 400, overflowY: 'auto' }}>
                {releaseNotes.draft}
              </pre>
            )}
          </div>
        </div>
      )}


      {/* Glossy overall progress bar */}
      <GlossyBar pct={overallPct} elapsedS={projElapsed} remainingS={wfRemaining} />

      {/* React Flow graph */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{
          padding: '10px 14px 8px', borderBottom: '1px solid var(--border)',
          fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 10,
          flexWrap: 'wrap',
        }}>
          <span>Workflow Execution Graph</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
            {done}/{total} stages complete · click to open tool · right-click to set status
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto', flexWrap: 'wrap' }}>
            {[
              ['Completed',    '#22c55e'],
              ['In Progress',  '#3b82f6'],
              ['Waiting',      '#f59e0b'],
              ['Pending',      '#cbd5e1'],
              ['Failed',       '#ef4444'],
              ['Skipped',      '#94a3b8'],
              ['Stage Paused', '#a855f7'],
            ].map(([label, c]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 400 }}>
                <span style={{
                  width: 10, height: 10, borderRadius: 2,
                  background: c, flexShrink: 0,
                  boxShadow: `0 0 0 1px ${c}66`,
                }} />
                <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ height: 720 }} onClick={closeCtxMenu}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={NODE_TYPES}
            onNodeClick={handleNodeClick}
            onNodeContextMenu={handleNodeContextMenu}
            onNodeDragStop={handleNodeDragStop}
            onPaneClick={closeCtxMenu}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.25}
            maxZoom={2}
            zoomOnScroll={false}
            zoomOnPinch={true}
            panOnScroll={false}
            preventScrolling={false}
            zoomActivationKeyCode="Control"
            proOptions={{ hideAttribution: true }}
          >
            <Background color="var(--border)" gap={18} />
            <Controls showInteractive={false} />
            <Panel position="top-right">
              <button
                onClick={resetLayout}
                title="Clear saved node positions and re-run auto-layout"
                style={{
                  fontSize: 11, padding: '3px 8px', cursor: 'pointer',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 4, color: 'var(--text-muted)',
                }}
              >
                ⟳ Reset Layout
              </button>
            </Panel>
          </ReactFlow>
        </div>
      </div>

      {/* Workflow Collected Data — collapsed by default, per-stage sections */}
      {(collectedData.vmName || collectedData.payorVersion ||
        Object.keys(collectedData.baselineUrls).length > 0 ||
        Object.keys(collectedData.regressionUrls).length > 0 ||
        collectedData.hasMelissaOutputs) && (
        <div className="card" style={{ marginBottom: 16 }}>
          <button
            style={{
              all: 'unset', cursor: 'pointer', fontWeight: 600, fontSize: 13,
              display: 'flex', alignItems: 'center', gap: 6, width: '100%',
              padding: '12px 16px', boxSizing: 'border-box',
            }}
            onClick={() => setShowCollectedData(p => !p)}
          >
            <span>{showCollectedData ? '▾' : '▸'}</span>
            Workflow Collected Data
            <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>
              {[
                collectedData.vmName && 'Remote Setup',
                (collectedData.payorVersion || Object.keys(collectedData.baselineUrls).length > 0) && 'Baseline',
                Object.keys(collectedData.regressionUrls).length > 0 && 'Jenkins Regression',
                collectedData.hasMelissaOutputs && 'Melissa Update',
              ].filter(Boolean).join(' · ')}
            </span>
          </button>

          {showCollectedData && (
            <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* ── Remote Setup ── */}
              {collectedData.vmName && (
                <div>
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em',
                    textTransform: 'uppercase', marginBottom: 6, paddingBottom: 4,
                    borderBottom: '1px solid var(--border)',
                  }}>
                    Remote Setup
                  </div>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 5, overflow: 'hidden' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                      background: 'var(--surface)',
                    }}>
                      <span style={{ fontSize: 11, fontWeight: 600, minWidth: 160, color: 'var(--text-muted)' }}>Remote VM</span>
                      <span style={{ fontSize: 11, fontFamily: 'Consolas, monospace', color: 'var(--text)' }}>
                        {collectedData.vmName}{collectedData.vmIp ? ` (${collectedData.vmIp})` : ''}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Baseline ── */}
              {(collectedData.payorVersion || Object.keys(collectedData.baselineUrls).length > 0) && (
                <div>
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em',
                    textTransform: 'uppercase', marginBottom: 6, paddingBottom: 4,
                    borderBottom: '1px solid var(--border)',
                  }}>
                    Baseline
                  </div>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 5, overflow: 'hidden' }}>
                    {collectedData.payorVersion && (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                        borderBottom: Object.keys(collectedData.baselineUrls).length > 0 ? '1px solid var(--border)' : 'none',
                        background: 'var(--surface)',
                      }}>
                        <span style={{ fontSize: 11, fontWeight: 600, minWidth: 160, color: 'var(--text-muted)' }}>
                          Payor Branch Version
                        </span>
                        <span style={{ fontSize: 11, fontFamily: 'Consolas, monospace', color: 'var(--text)' }}>
                          {collectedData.payorVersion}
                        </span>
                      </div>
                    )}
                    {Object.entries(collectedData.baselineUrls).map(([job, url], i, arr) => (
                      <div key={job} style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                        borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                        background: (i + (collectedData.payorVersion ? 1 : 0)) % 2 === 0
                          ? 'var(--surface-alt, var(--surface))' : 'var(--surface)',
                      }}>
                        <span style={{ fontSize: 11, fontWeight: 600, minWidth: 160, color: 'var(--text-muted)' }}>
                          {job}
                        </span>
                        <a
                          href={url} target="_blank" rel="noreferrer"
                          style={{ fontSize: 11, fontFamily: 'Consolas, monospace', color: 'var(--primary)',
                                   textDecoration: 'none', wordBreak: 'break-all' }}
                          onClick={e => e.stopPropagation()}
                        >
                          {url}
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Jenkins Regression ── */}
              {Object.keys(collectedData.regressionUrls).length > 0 && (
                <div>
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em',
                    textTransform: 'uppercase', marginBottom: 6, paddingBottom: 4,
                    borderBottom: '1px solid var(--border)',
                  }}>
                    Jenkins Regression
                  </div>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 5, overflow: 'hidden' }}>
                    {Object.entries(collectedData.regressionUrls).map(([job, url], i, arr) => (
                      <div key={job} style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                        borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                        background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface-alt, var(--surface))',
                      }}>
                        <span style={{ fontSize: 11, fontWeight: 600, minWidth: 160, color: 'var(--text-muted)' }}>
                          {job}
                        </span>
                        <a
                          href={url} target="_blank" rel="noreferrer"
                          style={{ fontSize: 11, fontFamily: 'Consolas, monospace', color: 'var(--primary)',
                                   textDecoration: 'none', wordBreak: 'break-all' }}
                          onClick={e => e.stopPropagation()}
                        >
                          {url}
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Melissa Update ── */}
              {collectedData.hasMelissaOutputs && (
                <div>
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em',
                    textTransform: 'uppercase', marginBottom: 6, paddingBottom: 4,
                    borderBottom: '1px solid var(--border)',
                  }}>
                    Melissa Data Update
                  </div>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 5, overflow: 'hidden' }}>
                    {[
                      { label: 'Changes Detected',        value: collectedData.melissaChanges },
                      { label: 'Payor pom.xml Updated',   value: collectedData.payorPomUpdated },
                      { label: 'Classic pom.xml Updated', value: collectedData.classicPomUpdated },
                    ].filter(r => r.value).map((row, i, arr) => (
                      <div key={row.label} style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                        borderBottom: (i < arr.length - 1 || collectedData.payorFeatureBranch || collectedData.classicFeatureBranch)
                          ? '1px solid var(--border)' : 'none',
                        background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface-alt, var(--surface))',
                      }}>
                        <span style={{ fontSize: 11, fontWeight: 600, minWidth: 200, color: 'var(--text-muted)' }}>
                          {row.label}
                        </span>
                        <span style={{
                          fontSize: 11, fontFamily: 'Consolas, monospace',
                          color: row.value === 'Yes' ? '#22c55e' : row.value === 'No' ? 'var(--text-muted)' : 'var(--text)',
                        }}>
                          {row.value}
                        </span>
                      </div>
                    ))}
                    {[
                      {
                        label:   'Payor PR',
                        branch:  collectedData.payorFeatureBranch,
                        release: collectedData.payorReleaseBranch,
                        pr:      collectedData.payorPrUrl,
                      },
                      {
                        label:   'Classic PR',
                        branch:  collectedData.classicFeatureBranch,
                        release: collectedData.classicReleaseBranch,
                        pr:      collectedData.classicPrUrl,
                      },
                    ].filter(r => r.branch || r.pr).map((row, i, arr) => (
                      <div key={row.label} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 10px',
                        borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                        background: i % 2 === 0 ? 'var(--surface-alt, var(--surface))' : 'var(--surface)',
                      }}>
                        <span style={{ fontSize: 11, fontWeight: 600, minWidth: 200, color: 'var(--text-muted)', paddingTop: 1 }}>
                          {row.label}
                        </span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {row.branch && (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, minWidth: 60 }}>feature</span>
                              <span style={{ fontSize: 11, fontFamily: 'Consolas, monospace', color: 'var(--text)' }}>
                                {row.branch}
                              </span>
                            </div>
                          )}
                          {row.release && (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, minWidth: 60 }}>base</span>
                              <span style={{ fontSize: 11, fontFamily: 'Consolas, monospace', color: 'var(--text-muted)' }}>
                                {row.release}
                              </span>
                            </div>
                          )}
                          {row.pr && (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, minWidth: 60 }}>PR</span>
                              <a href={row.pr} target="_blank" rel="noreferrer"
                                style={{ fontSize: 11, fontFamily: 'Consolas, monospace', color: 'var(--primary)',
                                         textDecoration: 'none', wordBreak: 'break-all' }}
                                onClick={e => e.stopPropagation()}>
                                {row.pr}
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      )}

      {/* Manual PID tracking for In Progress stages */}
      {inProgressStages.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <button
            style={{
              all: 'unset', cursor: 'pointer', fontWeight: 600, fontSize: 13,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
            onClick={() => setShowPids(p => !p)}
          >
            <span>{showPids ? '▾' : '▸'}</span>
            Manual Tool PID Tracking
            <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)' }}>
              (enter PID for stages without auto-detection)
            </span>
          </button>
          {showPids && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {inProgressStages.map(s => {
                const key = s.stage_key || s.stage_id
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, width: 200 }}>{s.stage_name}</span>
                    <input
                      className="pid-input"
                      type="text"
                      value={toolPids[key] ?? ''}
                      placeholder="Process PID"
                      onChange={e => {
                        setToolPids(p => ({ ...p, [key]: e.target.value }))
                        setDirty(d => ({ ...d, [key]: true }))
                      }}
                      onKeyDown={e => e.key === 'Enter' && savePid(key)}
                      style={{ width: 120 }}
                    />
                    {dirty[key] && (
                      <button className="btn btn-sm" disabled={saving[key]} onClick={() => savePid(key)}>
                        {saving[key] ? '…' : 'Save'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Stage Inputs — manual values for stages with required downstream outputs */}
      {stages.some(s => effectiveManualInputs[s.stage_key || s.stage_id]) && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>
            Stage Inputs
            <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
              (these values are auto-generated when a stage runs — provide them here only when skipping)
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stages
              .filter(s => effectiveManualInputs[s.stage_key || s.stage_id])
              .sort((a, b) => {
                const ai = STAGE_ORDER.indexOf(a.stage_key || a.stage_id)
                const bi = STAGE_ORDER.indexOf(b.stage_key || b.stage_id)
                return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
              })
              .map(s => {
              const key    = s.stage_key || s.stage_id
              const fields = effectiveManualInputs[key] || []
              const saved  = stageOutputs[key] || {}
              const missingRequired = fields.filter(f => f.required && !(saved[f.key] || '').trim())
              const isOpen = expandedInputs === key
              const draft  = draftInputs[key] || {}

              return (
                <div key={key} style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                  <button
                    style={{
                      all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 12px', width: '100%', boxSizing: 'border-box',
                      background: 'var(--surface-alt, var(--surface))',
                      borderBottom: isOpen ? '1px solid var(--border)' : 'none',
                    }}
                    onClick={() => {
                      if (isOpen) {
                        setExpandedInputs(null)
                      } else {
                        setExpandedInputs(key)
                        setDraftInputs(d => ({ ...d, [key]: { ...saved } }))
                      }
                    }}
                  >
                    <span style={{ fontSize: 11 }}>{isOpen ? '▾' : '▸'}</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{s.stage_name}</span>
                    {missingRequired.length > 0 && (
                      <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 500, marginLeft: 4 }}>
                        ⓘ {s.stage_name} generates {missingRequired.length} field{missingRequired.length > 1 ? 's' : ''} when it runs — provide {missingRequired.length > 1 ? 'them' : 'it'} here to skip this stage
                      </span>
                    )}
                    {missingRequired.length === 0 && fields.some(f => saved[f.key]) && (
                      <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 700, marginLeft: 4 }}>✓ inputs saved</span>
                    )}
                  </button>
                  {isOpen && (
                    <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {missingRequired.length > 0 && (
                        <div style={{
                          fontSize: 11, color: '#166534',
                          background: '#f0fdf4', border: '1px solid #bbf7d0',
                          borderRadius: 4, padding: '6px 10px', lineHeight: 1.5,
                        }}>
                          ⓘ <strong>{s.stage_name}</strong> generates {fields.filter(f => f.required).length} field{fields.filter(f => f.required).length > 1 ? 's' : ''} automatically when it runs.
                          To skip this stage, provide {fields.filter(f => f.required).length > 1 ? 'those values' : 'that value'} below.
                        </div>
                      )}
                      {fields.map(f => (
                        <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <label style={{ fontSize: 12, fontWeight: 500, minWidth: 180, display: 'flex', gap: 4, alignItems: 'center' }}>
                            {f.label}
                            {f.required && <span style={{ color: 'var(--danger)', fontSize: 11 }}>*</span>}
                          </label>
                          <input
                            type="text"
                            value={draft[f.key] || ''}
                            placeholder={f.placeholder || ''}
                            onChange={e => setDraftInputs(d => ({ ...d, [key]: { ...d[key], [f.key]: e.target.value } }))}
                            style={{
                              flex: 1, minWidth: 220, maxWidth: 420,
                              fontSize: 12, fontFamily: 'Consolas, monospace',
                              padding: '4px 8px',
                              border: `1px solid ${f.required && !(draft[f.key] || '').trim() ? 'var(--danger)' : 'var(--border)'}`,
                              borderRadius: 5, background: 'var(--surface)', color: 'var(--text)',
                            }}
                          />
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={savingInputs === key}
                          onClick={async () => {
                            setSavingInputs(key)
                            try {
                              await fetch(`/api/projects/${pid}/stage-outputs`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ stage_id: key, outputs: draft }),
                              })
                              setStageOutputs(prev => ({ ...prev, [key]: { ...draft } }))
                              setExpandedInputs(null)
                              load()
                            } catch {}
                            setSavingInputs(null)
                          }}
                        >
                          {savingInputs === key ? 'Saving…' : 'Save Inputs'}
                        </button>
                        <button className="btn btn-sm" onClick={() => setExpandedInputs(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Stage context menu (right-click on node) */}
      {ctxMenu && (
        <div
          style={{
            position: 'fixed', zIndex: 9999,
            top: ctxMenu.y, left: ctxMenu.x,
            background: 'var(--surface, #fff)',
            border: '1px solid var(--border, #e2e8f0)',
            borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            minWidth: 190, overflow: 'hidden',
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{
            padding: '7px 14px 6px',
            fontSize: 11, fontWeight: 700,
            color: 'var(--text-muted, #6b7280)',
            borderBottom: '1px solid var(--border, #e2e8f0)',
            background: 'var(--surface-alt, var(--surface))',
          }}>
            {ctxMenu.stageName}
          </div>
          {ctxMenu?.stageStatus === 'Failed' && (
            <button
              onClick={() => retriggerStage(ctxMenu.nodeId)}
              disabled={retriggering === ctxMenu.nodeId}
              style={{
                all: 'unset', display: 'block', width: '100%', boxSizing: 'border-box',
                padding: '8px 14px', cursor: 'pointer', fontSize: 12,
                color: '#ef4444', fontWeight: 700, transition: 'background 0.12s',
                borderBottom: '1px solid var(--border, #e2e8f0)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-alt, #f8fafc)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              {retriggering === ctxMenu.nodeId ? '…' : '⟳ Retrigger Stage'}
            </button>
          )}
          {ctxMenu?.stageStatus === 'Skipped' && ctxMenu?.canInclude && (
            <button
              onClick={() => includeStage(ctxMenu.nodeId)}
              disabled={including === ctxMenu.nodeId}
              style={{
                all: 'unset', display: 'block', width: '100%', boxSizing: 'border-box',
                padding: '8px 14px', cursor: 'pointer', fontSize: 12,
                color: '#22c55e', fontWeight: 700, transition: 'background 0.12s',
                borderBottom: '1px solid var(--border, #e2e8f0)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-alt, #f8fafc)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              {including === ctxMenu.nodeId ? '…' : '↩ Include Stage'}
            </button>
          )}
          {['Pending', 'Waiting'].includes(ctxMenu?.stageStatus) && (
            <button
              onClick={() => pauseStage(ctxMenu.nodeId)}
              disabled={stagePausing === ctxMenu.nodeId}
              style={{
                all: 'unset', display: 'block', width: '100%', boxSizing: 'border-box',
                padding: '8px 14px', cursor: 'pointer', fontSize: 12,
                color: '#a855f7', fontWeight: 700, transition: 'background 0.12s',
                borderBottom: '1px solid var(--border, #e2e8f0)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-alt, #f8fafc)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              {stagePausing === ctxMenu.nodeId ? '…' : '⏸ Pause Stage'}
            </button>
          )}
          {ctxMenu?.stageStatus === 'Stage Paused' && (
            <button
              onClick={() => resumeStage(ctxMenu.nodeId)}
              disabled={stageResuming === ctxMenu.nodeId}
              style={{
                all: 'unset', display: 'block', width: '100%', boxSizing: 'border-box',
                padding: '8px 14px', cursor: 'pointer', fontSize: 12,
                color: '#22c55e', fontWeight: 700, transition: 'background 0.12s',
                borderBottom: '1px solid var(--border, #e2e8f0)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-alt, #f8fafc)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              {stageResuming === ctxMenu.nodeId ? '…' : '▶ Resume Stage'}
            </button>
          )}
          {!['Completed', 'Skipped'].includes(ctxMenu?.stageStatus) && ctxMenu?.stageStatus && (
            <>
              <button
                onClick={() => { if (canSkipStage(ctxMenu.nodeId)) skipStage(ctxMenu.nodeId) }}
                disabled={skipping === ctxMenu.nodeId || !canSkipStage(ctxMenu.nodeId)}
                style={{
                  all: 'unset', display: 'block', width: '100%', boxSizing: 'border-box',
                  padding: '8px 14px', cursor: !canSkipStage(ctxMenu.nodeId) ? 'not-allowed' : 'pointer',
                  fontSize: 12, color: !canSkipStage(ctxMenu.nodeId) ? '#94a3b8' : '#64748b',
                  fontWeight: 700, transition: 'background 0.12s',
                  borderBottom: !canSkipStage(ctxMenu.nodeId) ? 'none' : '1px solid var(--border, #e2e8f0)',
                  opacity: !canSkipStage(ctxMenu.nodeId) ? 0.7 : 1,
                }}
                onMouseEnter={e => { if (canSkipStage(ctxMenu.nodeId)) e.currentTarget.style.background = 'var(--surface-alt, #f8fafc)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                {skipping === ctxMenu.nodeId ? '…' : '⊘ Skip Stage'}
              </button>
              {!canSkipStage(ctxMenu.nodeId) && (
                <div style={{
                  padding: '4px 14px 8px', fontSize: 11, color: '#166534',
                  borderBottom: '1px solid var(--border, #e2e8f0)',
                }}>
                  ⓘ {ctxMenu.stageName} generates required fields when it runs — fill them in Stage Inputs to enable skip
                </div>
              )}
            </>
          )}
          {[
            ['Reset to Pending', 'Pending',     'var(--text-muted)'],
            ['Mark In Progress', 'In Progress',  '#3b82f6'],
            ['Mark Completed',   'Completed',    '#22c55e'],
            ['Mark Skipped',     'Skipped',      '#94a3b8'],
            ['Mark Failed',      'Failed',       '#ef4444'],
          ].map(([label, status, color]) => (
            <button key={status}
              onClick={() => ctxSetStatus(status)}
              style={{
                all: 'unset', display: 'block', width: '100%', boxSizing: 'border-box',
                padding: '8px 14px', cursor: 'pointer', fontSize: 12,
                color, transition: 'background 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-alt, #f8fafc)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {confirmDlg && (
        <ConfirmDialog
          title={confirmDlg.title}
          message={confirmDlg.message}
          confirmLabel={confirmDlg.confirmLabel}
          onConfirm={confirmDlg.onConfirm}
          onCancel={() => setConfirmDlg(null)}
        />
      )}
    </div>
  )
}
