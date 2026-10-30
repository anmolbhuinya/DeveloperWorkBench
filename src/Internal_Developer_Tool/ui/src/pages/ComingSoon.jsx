import { useNavigate } from 'react-router-dom'

export default function ComingSoon({ title, icon, backPath = '/', backLabel = 'Home' }) {
  const navigate = useNavigate()
  return (
    <div>
      <button className="btn back-link" onClick={() => navigate(backPath)}>← {backLabel}</button>
      <div className="empty">
        <div style={{ fontSize: 48, marginBottom: 16 }}>{icon}</div>
        <h3>{title}</h3>
        <p>This section is coming soon.</p>
      </div>
    </div>
  )
}
