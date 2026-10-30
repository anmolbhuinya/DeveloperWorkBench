import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const CARDS = [
  {
    id: 'sonar',
    path: '/developer-tools/sonar-report',
    icon: '🔍',
    title: 'Sonar Report',
    desc: 'Generate an Excel report from a SonarQube Pull Request analysis',
  },
  {
    id: 'copilot',
    path: '/developer-tools/copilot-review',
    icon: '🤖',
    title: 'AI PR Review',
    desc: 'View GitHub Copilot inline review comments for a Pull Request',
  },
  {
    id: 'ai-analyzer',
    path: '/developer-tools/ai-analyzer',
    icon: '🧠',
    title: 'AI Analyzer',
    desc: 'Analyse a JIRA ticket with the AI agent and generate an RCA document',
  },
  {
    id: 'm2',
    path: '/developer-tools/m2-repo-cleaner',
    icon: '🗑',
    title: 'M2 Repo Cleaner',
    desc: 'Scan and clean the local Maven (.m2) repository cache',
  },
  {
    id: 'pc',
    path: '/developer-tools/project-cleaner',
    icon: '📂',
    title: 'Project Cleaner',
    desc: 'View and delete local project workspaces to reclaim disk space',
  },
]

function fmtGb(bytes) {
  if (bytes == null || bytes === 0) return null
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const LEVEL_CARD_STYLE = {
  warn_70:   { borderColor: '#e6a817', background: 'rgba(230,168,23,0.07)' },
  warn_80:   { borderColor: '#ff9800', background: 'rgba(255,152,0,0.07)' },
  alert_90:  { borderColor: '#f44336', background: 'rgba(244,67,54,0.07)' },
  alert_100: { borderColor: '#b71c1c', background: 'rgba(183,28,28,0.09)' },
}

const LEVEL_TEXT_COLOR = {
  warn_70: '#e6a817',
  warn_80: '#ff9800',
  alert_90: '#f44336',
  alert_100: '#b71c1c',
}

export default function ToolsPage() {
  const navigate = useNavigate()
  const [m2Stats, setM2Stats] = useState(null)

  useEffect(() => {
    fetch('/api/tools/m2-repo/stats')
      .then(r => r.json())
      .then(d => { if (d.ok) setM2Stats(d) })
      .catch(() => {})
  }, [])

  return (
    <div style={{ padding: '24px 28px', maxWidth: 860 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--text-primary, #111)' }}>
          Tools
        </h1>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
          Developer utilities and report generators
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {CARDS.map(card => {
          const level    = card.id === 'm2' ? m2Stats?.warning_level : null
          const cardStyle = level ? (LEVEL_CARD_STYLE[level] ?? {}) : {}
          const sizeBytes = card.id === 'm2' ? m2Stats?.last_scan?.size_bytes : null
          const sizeLabel = fmtGb(sizeBytes)

          return (
            <div
              key={card.path}
              className="card"
              style={{ width: 220, cursor: 'pointer', transition: 'box-shadow 0.15s, border-color 0.15s', ...cardStyle }}
              onClick={() => navigate(card.path)}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.12)' }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = '' }}
            >
              <div style={{ fontSize: 36, marginBottom: 10 }}>{card.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{card.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{card.desc}</div>
              {sizeLabel && (
                <div style={{
                  marginTop: 10, fontSize: 15, fontWeight: 700,
                  color: level ? (LEVEL_TEXT_COLOR[level] ?? 'var(--text)') : 'var(--text)',
                }}>
                  {sizeLabel}
                  {m2Stats?.pct_of_median != null && (
                    <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 4, color: 'var(--text-muted)' }}>
                      ({m2Stats.pct_of_median.toFixed(0)}%)
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
