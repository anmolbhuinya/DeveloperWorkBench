import { useNavigate } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'

const CARDS = [
  {
    icon: '🐳',
    title: 'Manage Local Docker',
    desc: 'Manage local Docker containers, start/stop servers, and handle state snapshots.',
    path: '/docker',
    available: true,
  },
  {
    icon: '⚙️',
    title: 'Local App Development',
    desc: 'Build, deploy, and manage Payor, Classic, Connector, Enrollment, and PIK on your local environment.',
    path: '/local-app',
    available: true,
  },
  {
    icon: '🌐',
    title: 'Remote App Development',
    desc: 'Manage HealthEdge applications running on a remote development VM — check status, start/stop containers, and manage runtime properties.',
    path: '/remote-app',
    available: true,
  },
  {
    icon: '🖥️',
    title: 'Manage Developer VMs',
    desc: 'View developer VMs, check branch status via SSH, set up remote VMs, and search across all VMs.',
    path: '/manage-dev-vms',
    available: true,
  },
  {
    icon: '🔀',
    title: 'Workflow Projects',
    desc: 'Orchestrate multi-stage clone/release workflows with per-stage tracking and tool integration.',
    path: '/workflow-projects',
    available: true,
  },
  {
    icon: '📋',
    title: 'Project Management',
    desc: 'Manage sprints and project resources — create sprint planning files and track team progress.',
    path: '/project-management',
    available: true,
  },
]

const LOCAL_APPS  = ['payor', 'classic', 'connector', 'enrollment', 'pik']
const REMOTE_APPS = ['payor', 'classic', 'connector', 'enrollment', 'pik']
const ACTIVE_PROJ_STATUSES = new Set(['in_progress', 'running', 'active', 'started'])
const DEFAULT_POLL_MS = 60000

function ActivityBar({ localBuilds, remoteBuilds, workflowRuns, navigate }) {
  const total = localBuilds + remoteBuilds + workflowRuns
  if (total === 0) return null

  const pills = []

  if (localBuilds > 0) pills.push({
    key: 'local',
    label: `${localBuilds} local build${localBuilds > 1 ? 's' : ''} running`,
    path: '/local-app',
    color: 'var(--primary)',
    bg: 'rgba(var(--primary-rgb,59,130,246),0.12)',
    border: 'rgba(var(--primary-rgb,59,130,246),0.35)',
  })

  if (remoteBuilds > 0) pills.push({
    key: 'remote',
    label: `${remoteBuilds} remote build${remoteBuilds > 1 ? 's' : ''} running`,
    path: '/remote-app',
    color: '#a371f7',
    bg: 'rgba(163,113,247,0.12)',
    border: 'rgba(163,113,247,0.35)',
  })

  if (workflowRuns > 0) pills.push({
    key: 'workflow',
    label: `${workflowRuns} workflow${workflowRuns > 1 ? 's' : ''} active`,
    path: '/workflow-projects',
    color: '#22c55e',
    bg: 'rgba(34,197,94,0.12)',
    border: 'rgba(34,197,94,0.35)',
  })

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '10px 16px',
      marginBottom: 24,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>Active:</span>
      {pills.map(p => (
        <button
          key={p.key}
          onClick={() => navigate(p.path)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 600,
            background: p.bg, color: p.color,
            border: `1px solid ${p.border}`,
            borderRadius: 20, padding: '3px 10px',
            cursor: 'pointer',
          }}
        >
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: p.color,
            animation: 'spin 1.2s linear infinite',
            display: 'inline-block',
            flexShrink: 0,
          }} />
          {p.label}
        </button>
      ))}
    </div>
  )
}

function ResourcePanel() {
  const [d, setD] = useState(null)
  useEffect(() => {
    let stop = false, busy = false
    const load = () => {
      if (busy || document.hidden) return              // never stack requests on a busy server
      busy = true
      fetch('/api/system/resources').then(r => r.json()).then(x => { if (!stop) setD(x) }).catch(() => {}).finally(() => { busy = false })
    }
    load()
    const id = setInterval(load, 5000)
    return () => { stop = true; clearInterval(id) }
  }, [])
  const bar = (pct, color) => (
    <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: '100%', background: color, transition: 'width .4s' }} />
    </div>
  )
  const box = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px', width: 280, flexShrink: 0, alignSelf: 'flex-start' }
  if (!d || !d.ok) return <div style={box}><div style={{ fontWeight: 600, marginBottom: 6 }}>Workbench Resources</div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d ? (d.error || 'Unavailable') : 'Loading…'}</div></div>
  const memPct = d.ram_mb ? d.mem_mb / d.ram_mb * 100 : 0
  return (
    <div style={box}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>Workbench Resources</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: 'var(--text-muted)' }}>CPU</span><b>{d.cpu.toFixed(1)}%</b>
      </div>
      {bar(d.cpu, 'var(--primary)')}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, margin: '12px 0 4px' }}>
        <span style={{ color: 'var(--text-muted)' }}>Memory</span>
        <b>{d.mem_mb >= 1024 ? (d.mem_mb / 1024).toFixed(2) + ' GB' : Math.round(d.mem_mb) + ' MB'}{d.ram_mb ? ` (${memPct.toFixed(1)}%)` : ''}</b>
      </div>
      {bar(memPct, '#a371f7')}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '12px 0 6px' }}>{d.count} processes · top by memory</div>
      {d.processes.slice(0, 6).map(p => (
        <div key={p.pid} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }} title={`PID ${p.pid}`}>{p.name}</span>
          <span style={{ color: 'var(--text-muted)' }}>{p.cpu.toFixed(1)}% · {Math.round(p.mem_mb)} MB</span>
        </div>
      ))}
    </div>
  )
}

export default function Welcome() {
  const navigate = useNavigate()
  const [localBuilds,  setLocalBuilds]  = useState(0)
  const [remoteBuilds, setRemoteBuilds] = useState(0)
  const [workflowRuns, setWorkflowRuns] = useState(0)
  const [pollMs,       setPollMs]       = useState(DEFAULT_POLL_MS)
  const pollRef  = useRef(null)
  const pollMsRef = useRef(DEFAULT_POLL_MS)

  useEffect(() => { pollMsRef.current = pollMs }, [pollMs])

  // Load poll interval from config.xlsx via backend
  useEffect(() => {
    fetch('/api/idp-config')
      .then(r => r.json())
      .then(d => { if (d.ok && d.welcome_activity_poll_ms) setPollMs(d.welcome_activity_poll_ms) })
      .catch(() => {})
  }, [])

  async function fetchActivity() {
    // Local builds
    try {
      const results = await Promise.allSettled(
        LOCAL_APPS.map(app =>
          fetch(`/api/local-app/${app}/build-status`)
            .then(r => r.json())
            .catch(() => null)
        )
      )
      const running = results.filter(r => r.status === 'fulfilled' && r.value?.status === 'running').length
      setLocalBuilds(running)
    } catch (_) {}

    // Remote builds from localStorage cmd IDs
    try {
      const cmdChecks = REMOTE_APPS.map(app => {
        const cmdId = localStorage.getItem(`remote_build_cmd_${app}`)
        if (!cmdId) return Promise.resolve(false)
        return fetch(`/api/remote-app/${app}/command-status?cmd_id=${cmdId}`)
          .then(r => r.json())
          .then(d => d.ok && d.status === 'running')
          .catch(() => false)
      })
      const results = await Promise.allSettled(cmdChecks)
      const running = results.filter(r => r.status === 'fulfilled' && r.value === true).length
      setRemoteBuilds(running)
    } catch (_) {}

    // Workflow runs: clone projects + GP builds (all apps via workflow-stats)
    try {
      const [projResp, statsResp] = await Promise.allSettled([
        fetch('/api/projects').then(r => r.json()).catch(() => ({ rows: [] })),
        fetch('/api/tools/workflow-stats').then(r => r.json()).catch(() => ({ ok: false, stats: {} })),
      ])
      let count = 0
      if (projResp.status === 'fulfilled') {
        const rows = projResp.value?.rows || projResp.value || []
        count += rows.filter(r => ACTIVE_PROJ_STATUSES.has((r.status || '').toLowerCase())).length
      }
      if (statsResp.status === 'fulfilled' && statsResp.value?.ok) {
        const stats = statsResp.value.stats || {}
        count += Object.values(stats).reduce((sum, s) => sum + (s?.running || 0), 0)
      }
      setWorkflowRuns(count)
    } catch (_) {}
  }

  useEffect(() => {
    fetchActivity()
    clearInterval(pollRef.current)
    pollRef.current = setInterval(fetchActivity, pollMs)
    return () => clearInterval(pollRef.current)
  }, [pollMs])

  return (
    <div className="welcome">
      <div className="welcome-greeting">Welcome, Anmol</div>
      <p className="welcome-sub">Developer WorkBench — your central hub for managing development workflows and tools.</p>

      <ActivityBar
        localBuilds={localBuilds}
        remoteBuilds={remoteBuilds}
        workflowRuns={workflowRuns}
        navigate={navigate}
      />

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div className="welcome-sections">
        {CARDS.map(card => (
          <div
            key={card.path}
            className="welcome-card"
            onClick={() => navigate(card.path)}
            style={{ cursor: 'pointer' }}
          >
            <div className="welcome-card-icon">{card.icon}</div>
            <div className="welcome-card-title">{card.title}</div>
            <div className="welcome-card-desc">{card.desc}</div>
            {card.available
              ? <span className="welcome-card-available">Available</span>
              : <span className="welcome-card-soon">Coming soon</span>
            }
          </div>
        ))}
      </div>
      <ResourcePanel />
      </div>
    </div>
  )
}
