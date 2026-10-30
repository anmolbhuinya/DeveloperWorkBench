import { useNavigate } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'

const TILES = [
  {
    icon: '⚙️',
    title: 'Payor',
    desc: 'Build, deploy, and manage the Payor application on your local environment.',
    path: '/local-app/payor',
    appName: 'payor',
    statusKey: 'payor',
  },
  {
    icon: '📚',
    title: 'Classic',
    desc: 'Build, deploy, and manage HealthEdge Classic (HealthRules Classic) on your local environment.',
    path: '/local-app/classic',
    appName: 'classic',
    statusKey: 'running',
  },
  {
    icon: '🔌',
    title: 'Connector',
    desc: 'Build, deploy, and manage the Integration Platform Connector on your local environment.',
    path: '/local-app/connector',
    appName: 'connector',
    statusKey: 'running',
  },
  {
    icon: '📋',
    title: 'Enrollment',
    desc: 'Build, deploy, and manage the Enrollment application on your local environment.',
    path: '/local-app/enrollment',
    appName: 'enrollment',
    statusKey: 'running',
  },
  {
    icon: '💳',
    title: 'PIK',
    desc: 'Build, deploy, and manage the Payment Innovation Kit on your local environment.',
    path: '/local-app/pik',
    appName: 'pik',
    statusKey: 'running',
  },
]

function StatusBadge({ status }) {
  if (status === null) return null
  const running = status === true
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11, fontWeight: 600,
      color: running ? 'var(--success, #22c55e)' : 'var(--text-muted)',
      background: running ? 'rgba(34,197,94,0.1)' : 'rgba(128,128,128,0.1)',
      border: `1px solid ${running ? 'rgba(34,197,94,0.3)' : 'rgba(128,128,128,0.25)'}`,
      borderRadius: 20, padding: '2px 8px',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: running ? '#22c55e' : '#9ca3af',
        flexShrink: 0,
      }} />
      {running ? 'Running' : 'Stopped'}
    </span>
  )
}

function fmtEta(remainMs) {
  if (remainMs <= 0) return 'almost done'
  const s = Math.round(remainMs / 1000)
  if (s < 60) return `~${s}s left`
  const m = Math.floor(s / 60), rs = s % 60
  return rs > 0 ? `~${m}m ${rs}s left` : `~${m}m left`
}

function computeProgress(b) {
  if (!b || b.status !== 'running') return null
  if (b.progress != null) return b.progress
  const est = b.estimate_ms || b.estimated_ms
  if (est && b.elapsed_ms) return Math.min(Math.round(b.elapsed_ms / est * 100), 95)
  if (b.module_num && b.total_modules) return Math.min(Math.round(b.module_num / b.total_modules * 80), 80)
  return null
}

function BuildProgress({ build }) {
  if (!build || build.status !== 'running') return null
  const pct = computeProgress(build)
  const est = build.estimate_ms || build.estimated_ms
  const remainMs = (est && build.elapsed_ms) ? (est - build.elapsed_ms) : null
  const phase = build.phase || 'building'
  const modLabel = build.current_module
    ? `${build.current_module}${build.module_num && build.total_modules ? ` (${build.module_num}/${build.total_modules})` : ''}`
    : null

  return (
    <div style={{ marginTop: 10 }} onClick={e => e.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{
          fontSize: 10, color: 'var(--primary)', fontWeight: 600,
          textTransform: 'capitalize', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%',
        }}>
          {modLabel || phase}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
          {pct != null ? `${pct}%` : ''}
          {remainMs != null && remainMs > 0 ? ` · ${fmtEta(remainMs)}` : ''}
        </span>
      </div>
      <div style={{ height: 4, borderRadius: 4, background: 'rgba(128,128,128,0.2)' }}>
        {pct != null ? (
          <div style={{
            height: '100%', width: `${pct}%`, background: 'var(--primary)',
            borderRadius: 4, transition: 'width 0.6s ease',
          }} />
        ) : (
          <div className="progress-bar-indeterminate" style={{ height: '100%', borderRadius: 4, background: 'rgba(128,128,128,0.2)' }} />
        )}
      </div>
    </div>
  )
}

export default function LocalAppPage() {
  const navigate = useNavigate()
  const [statuses,   setStatuses]   = useState({})
  const [buildState, setBuildState] = useState({})
  const serverPollRef = useRef(null)
  const buildPollRef  = useRef(null)

  async function fetchStatuses() {
    const results = await Promise.allSettled(
      TILES.map(t =>
        fetch(`/api/local-app/${t.appName}/server-status`)
          .then(r => r.json())
          .then(d => ({ appName: t.appName, value: d.ok ? d[t.statusKey] : null }))
          .catch(() => ({ appName: t.appName, value: null }))
      )
    )
    const next = {}
    for (const r of results) {
      if (r.status === 'fulfilled') next[r.value.appName] = r.value.value
    }
    setStatuses(next)
  }

  async function fetchBuildStatuses() {
    const results = await Promise.allSettled(
      TILES.map(t =>
        fetch(`/api/local-app/${t.appName}/build-status`)
          .then(r => r.json())
          .then(d => ({ appName: t.appName, value: d }))
          .catch(() => ({ appName: t.appName, value: null }))
      )
    )
    const next = {}
    for (const r of results) {
      if (r.status === 'fulfilled') next[r.value.appName] = r.value.value
    }
    setBuildState(next)
  }

  useEffect(() => {
    fetchStatuses()
    serverPollRef.current = setInterval(fetchStatuses, 10000)
    return () => clearInterval(serverPollRef.current)
  }, [])

  useEffect(() => {
    fetchBuildStatuses()
    buildPollRef.current = setInterval(fetchBuildStatuses, 3000)
    return () => clearInterval(buildPollRef.current)
  }, [])

  const activeBuilds = TILES.filter(t => buildState[t.appName]?.status === 'running').length

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Local App Development</h1>
      </div>

      {activeBuilds > 0 && (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '10px 16px', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 600,
            background: 'rgba(var(--primary-rgb, 59,130,246),0.12)',
            color: 'var(--primary)', border: '1px solid rgba(var(--primary-rgb, 59,130,246),0.35)',
            borderRadius: 20, padding: '3px 10px',
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--primary)', animation: 'spin 1.2s linear infinite', display: 'inline-block' }} />
            {activeBuilds} build{activeBuilds > 1 ? 's' : ''} running
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {TILES.filter(t => buildState[t.appName]?.status === 'running').map(t => t.title).join(', ')}
          </span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginTop: 8 }}>
        {TILES.map(tile => {
          const build = buildState[tile.appName]
          const isBuilding = build?.status === 'running'
          return (
            <button
              key={tile.path}
              onClick={() => navigate(tile.path)}
              style={{
                textAlign: 'left', cursor: 'pointer', background: 'var(--surface)',
                border: `1px solid ${isBuilding ? 'var(--primary)' : 'var(--border)'}`,
                borderRadius: 10, padding: '24px 22px',
                transition: 'border-color 0.15s, box-shadow 0.15s',
                boxShadow: isBuilding ? '0 0 0 1px var(--primary)' : 'none',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.boxShadow = '0 0 0 1px var(--primary)' }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = isBuilding ? 'var(--primary)' : 'var(--border)'
                e.currentTarget.style.boxShadow   = isBuilding ? '0 0 0 1px var(--primary)' : 'none'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div style={{ fontSize: 32 }}>{tile.icon}</div>
                <StatusBadge status={statuses[tile.appName] ?? null} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{tile.title}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>{tile.desc}</div>
              <BuildProgress build={build} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
