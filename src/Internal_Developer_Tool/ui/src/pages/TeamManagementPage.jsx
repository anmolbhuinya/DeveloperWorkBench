import { useNavigate } from 'react-router-dom'

const CARDS = [
  {
    path: '/project-management/sprint',
    icon: '🏃',
    title: 'Sprint',
    desc: 'Create and manage sprint planning files',
  },
  {
    path: '/project-management/resource-skill',
    icon: '🧠',
    title: 'Resource And Skill',
    desc: 'Skill matrix and completed JIRA work per developer',
  },
]

export default function TeamManagementPage() {
  const navigate = useNavigate()
  return (
    <div style={{ padding: '24px 28px', maxWidth: 860 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--text-primary, #111)' }}>
          Project Management
        </h1>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
          Manage sprints and project resources
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {CARDS.map(card => (
          <div
            key={card.path}
            className="card"
            style={{ width: 220, cursor: 'pointer', transition: 'box-shadow 0.15s, border-color 0.15s' }}
            onClick={() => navigate(card.path)}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.12)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = '' }}
          >
            <div style={{ fontSize: 36, marginBottom: 10 }}>{card.icon}</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{card.title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{card.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
