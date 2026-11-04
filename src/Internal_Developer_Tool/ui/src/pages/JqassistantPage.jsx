import { useNavigate } from 'react-router-dom'
import JqassistantPanel from './JqassistantPanel'

export default function JqassistantPage() {
  const navigate = useNavigate()
  const back = () => navigate('/setup/dev-softwares')
  return (
    <div style={{ padding: '24px 28px' }}>
      <button onClick={back} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: 13, padding: 0 }}>← Dev Softwares</button>
      <JqassistantPanel onClose={back} />
    </div>
  )
}
