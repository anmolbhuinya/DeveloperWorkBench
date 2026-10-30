import { useNavigate } from 'react-router-dom'

const CARDS = [
  {
    path: '/help/erd',
    icon: '📝',
    title: 'ERD',
    desc: 'Wishlist and bugs — request features, file and track defects',
  },
]

export default function HelpIndexPage() {
  const navigate = useNavigate()
  return (
    <div>
      <div className="page-header"><h1 className="page-title">Help</h1></div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {CARDS.map(card => (
          <div
            key={card.path}
            className="card"
            style={{ width: 220, cursor: 'pointer', transition: 'box-shadow 0.15s, border-color 0.15s' }}
            onClick={() => navigate(card.path)}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.2)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = '' }}
          >
            <div style={{ fontSize: 36, marginBottom: 10 }}>{card.icon}</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4, color: 'var(--text)' }}>{card.title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{card.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
