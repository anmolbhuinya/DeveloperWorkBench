import { useNavigate } from 'react-router-dom'

const TILES = [
  {
    icon: '🖥️',
    title: 'Developer VMs',
    desc: 'View available developer VMs registered in the VM registry.',
    path: '/dev-vms',
    back: null,
  },
  {
    icon: '🔍',
    title: 'Search VMs',
    desc: 'Search VMs by branch, domain, or other criteria.',
    path: '/search-vms',
    back: null,
  },
  {
    icon: '⚙️',
    title: 'Remote VM Setup',
    desc: 'Provision and monitor remote VM setup runs via Jenkins.',
    path: '/tools/remote-setup',
    back: '/manage-dev-vms',
  },
]

export default function ManageDevVMsPage() {
  const navigate = useNavigate()

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 8 }}>
        <h1 className="page-title">Manage Developer VMs</h1>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 28 }}>
        View developer VMs and manage remote VM setup workflows.
      </p>
      <div className="welcome-sections" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {TILES.map(t => (
          <div
            key={t.path}
            className="welcome-card"
            onClick={() => navigate(t.path, t.back ? { state: { backPath: t.back } } : {})}
            style={{ cursor: 'pointer' }}
          >
            <div className="welcome-card-icon">{t.icon}</div>
            <div className="welcome-card-title">{t.title}</div>
            <div className="welcome-card-desc">{t.desc}</div>
            <span className="welcome-card-available">Open</span>
          </div>
        ))}
      </div>
    </div>
  )
}
