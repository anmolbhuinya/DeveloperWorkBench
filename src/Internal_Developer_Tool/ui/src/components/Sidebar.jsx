import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

const SECTIONS = [
  {
    id: 'docker',
    label: 'Manage Local Docker',
    path: '/docker',
    items: [
      { label: 'Docker Dashboard', path: '/docker' },
    ],
  },
  {
    id: 'local-app',
    label: 'Local App Development',
    path: '/local-app',
    items: [
      { label: 'Payor',      path: '/local-app/payor'      },
      { label: 'Classic',    path: '/local-app/classic'    },
      { label: 'Connector',  path: '/local-app/connector'  },
      { label: 'Enrollment', path: '/local-app/enrollment' },
      { label: 'PIK',        path: '/local-app/pik'        },
    ],
  },
  {
    id: 'devvms',
    label: 'Manage Developer VMs',
    path: '/dev-vms',
    items: [
      { label: 'Developer VMs',   path: '/dev-vms' },
      { label: 'Search VMs',      path: '/search-vms' },
      { label: 'Remote VM Setup', path: '/tools/remote-setup' },
    ],
  },
  {
    id: 'remote-app',
    label: 'Remote App Development',
    path: '/remote-app',
    items: [
      { label: 'Payor',      path: '/remote-app/payor'      },
      { label: 'Classic',    path: '/remote-app/classic'    },
      { label: 'Connector',  path: '/remote-app/connector'  },
      { label: 'Enrollment', path: '/remote-app/enrollment' },
      { label: 'PIK',        path: '/remote-app/pik'        },
    ],
  },
  {
    id: 'workflow',
    label: 'Workflow Projects',
    path: '/workflow-projects',
    items: [
      { label: 'Clone Workflow Projects', path: '/clone-projects' },
      { label: 'Jenkins Commit Job',     path: '/tools/jcj'  },
      { label: 'Baseline',               path: '/tools/baseline' },
      { label: 'Remote VM Setup',        path: '/tools/remote-setup' },
      { label: 'Melissa Update',         path: '/tools/melissa' },
      { label: 'Clone',                  path: '/tools/clone' },
      { label: 'GP Run',                 path: '/tools/gp-run' },
      { label: 'Payor Utils Certification', path: '/tools/puc' },
      { label: 'Jenkins Regression',     path: '/tools/jreg' },
      { label: 'Remote Regression',      path: '/tools/rpb' },
    ],
  },
  {
    id: 'project-management',
    label: 'Project Management',
    path: '/project-management',
    items: [
      { label: 'Sprint', path: '/project-management/sprint' },
    ],
  },
  {
    id: 'developer-tools',
    label: 'Tools',
    path: '/developer-tools',
    items: [
      { label: 'Sonar Report',  path: '/developer-tools/sonar-report'   },
      { label: 'AI PR Review',  path: '/developer-tools/copilot-review' },
      { label: 'AI Analyzer',   path: '/developer-tools/ai-analyzer'    },
      { label: 'M2 Repo Cleaner',   path: '/developer-tools/m2-repo-cleaner' },
      { label: 'Project Cleaner',   path: '/developer-tools/project-cleaner' },
      { label: 'DWB Cleaner',       path: '/developer-tools/dwb-cleaner'     },
    ],
  },
  {
    id: 'setup',
    label: 'Setup',
    path: '/setup',
    items: [],
  },
  {
    id: 'help',
    label: 'Help',
    path: '/help',
    items: [
      { label: 'ERD', path: '/help/erd' },
    ],
  },
]

export default function Sidebar() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const [open, setOpen] = useState({})

  const toggle = (id) => setOpen(prev => ({ ...prev, [id]: !prev[id] }))

  const isActive = (path) => {
    if (path === '/clone-projects') {
      return location.pathname === '/clone-projects'
        || location.pathname.startsWith('/projects')
        || location.pathname === '/clone-projects/new'
    }
    if (path === '/docker') {
      return location.pathname === '/docker'
    }
    if (path.startsWith('/tools/')) {
      return location.pathname === path
    }
    return location.pathname === path
  }

  return (
    <nav className="sidebar">
      {SECTIONS.map(sec => (
        <div key={sec.id} className="sidebar-section">
          <button
            className={`sidebar-section-header${open[sec.id] ? ' open' : ''}`}
            onClick={() => { toggle(sec.id); if (sec.path) navigate(sec.path) }}
          >
            <span className="sidebar-chevron">{open[sec.id] ? '▾' : '▸'}</span>
            {sec.label}
          </button>
          {open[sec.id] && (
            <div className="sidebar-items">
              {sec.items.length === 0 ? (
                <span className="sidebar-empty">Coming soon</span>
              ) : (
                sec.items.map(item => (
                  <button
                    key={item.path}
                    className={`sidebar-item${isActive(item.path) ? ' active' : ''}`}
                    onClick={() => navigate(item.path)}
                  >
                    {item.label}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      ))}
    </nav>
  )
}
