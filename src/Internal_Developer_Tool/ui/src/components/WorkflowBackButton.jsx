import { useLocation, useNavigate } from 'react-router-dom'

export default function WorkflowBackButton() {
  const location = useLocation()
  const navigate  = useNavigate()
  const pid = location.state?.fromProject
  if (!pid) return null
  return (
    <button
      className="btn back-link"
      onClick={() => navigate(`/projects/${pid}`)}
      style={{ marginBottom: 8, fontSize: 12, padding: '4px 10px' }}
    >
      ← Workflow #{pid}
    </button>
  )
}
