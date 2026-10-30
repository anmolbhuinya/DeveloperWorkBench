import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

const TOOLS = [
  { icon: '🔀', title: 'Clone Workflow Projects', desc: 'Orchestrate multi-stage clone/release workflows with per-stage tracking.', path: '/clone-projects',    statsKey: 'clone-workflow' },
  { icon: '🔨', title: 'Jenkins Commit Job',       desc: 'Trigger and track Jenkins Commit Job runs grouped by project and job type.', path: '/tools/jcj',        statsKey: 'jcj'  },
  { icon: '📐', title: 'Baseline',                desc: 'Trigger and track Jenkins baseline creation jobs by payor version.',       path: '/tools/baseline',   statsKey: 'baseline' },
  { icon: '🖥️', title: 'Remote VM Setup',         desc: 'Provision and monitor remote VM setup runs via Jenkins.',                  path: '/tools/remote-setup', statsKey: 'remote-setup' },
  { icon: '💊', title: 'Melissa Update',           desc: 'Track Melissa data license update runs across remote VMs.',               path: '/tools/melissa',    statsKey: 'melissa' },
  { icon: '📋', title: 'Clone',                    desc: 'Manage payor clone projects, tickets, and associated PRs.',               path: '/tools/clone',      statsKey: null },
  { icon: '✅', title: 'Payor Utils Certification',desc: 'Run and track Payor Utils Certification jobs on Jenkins.',                 path: '/tools/puc',        statsKey: 'puc' },
  { icon: '🧪', title: 'Jenkins Regression',       desc: 'Monitor Jenkins IT regression runs grouped by project and job type.',     path: '/tools/jreg',       statsKey: 'jreg' },
  { icon: '📊', title: 'Remote Regression',        desc: 'Browse remote regression report folders with per-file detail.',           path: '/tools/rpb',        statsKey: 'rpb' },
  { icon: '⚡', title: 'GP Run',                   desc: 'Trigger and track GP end-to-end build runs with live output and abort.',  path: '/tools/gp-run',     statsKey: 'gp-run' },
]

const WORKFLOW_STATS_POLL_MS = 30000

function StatsBar({ s }) {
  if (!s || s.running === 0) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginTop: 10 }}>
      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20,
        background: 'rgba(255,193,7,0.12)', color: '#e6a817', border: '1px solid rgba(255,193,7,0.3)' }}>
        ● {s.running} in progress
      </span>
    </div>
  )
}

export default function WorkflowProjectsPage() {
  const navigate = useNavigate()
  const [stats, setStats] = useState({})
  const pollRef = useRef(null)

  function fetchStats() {
    fetch('/api/tools/workflow-stats')
      .then(r => r.json())
      .then(d => { if (d.ok) setStats(d.stats) })
      .catch(() => {})
  }

  useEffect(() => {
    fetchStats()
    pollRef.current = setInterval(fetchStats, WORKFLOW_STATS_POLL_MS)
    return () => clearInterval(pollRef.current)
  }, [])

  const totalRunning = Object.values(stats).reduce((a, s) => a + (s.running || 0), 0)

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 8 }}>
        <h1 className="page-title">Workflow Projects</h1>
      </div>

      {/* Summary status bar */}
      {totalRunning > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          background: 'var(--surface)', border: '1px solid rgba(255,193,7,0.35)',
          borderRadius: 8, padding: '8px 16px', marginBottom: 18,
        }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>All tools:</span>
          <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 20,
            background: 'rgba(255,193,7,0.12)', color: '#e6a817', border: '1px solid rgba(255,193,7,0.3)',
            display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#e6a817', display: 'inline-block', animation: 'spin 1.5s linear infinite' }} />
            {totalRunning} in progress
          </span>
        </div>
      )}

      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
        Select a tool to manage its projects and runs.
      </p>
      <div className="welcome-sections" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        {TOOLS.map(t => {
          const s = t.statsKey ? stats[t.statsKey] : null
          const hasActivity = s && s.running > 0
          return (
            <div
              key={t.path}
              className="welcome-card"
              onClick={() => navigate(t.path)}
              style={{ cursor: 'pointer', border: hasActivity ? '1px solid rgba(255,193,7,0.4)' : undefined }}
            >
              <div className="welcome-card-icon">{t.icon}</div>
              <div className="welcome-card-title">{t.title}</div>
              <div className="welcome-card-desc">{t.desc}</div>
              <StatsBar s={s} />
              <span className="welcome-card-available" style={{ marginTop: s && s.total > 0 ? 8 : undefined }}>Open</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
