import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

const ITEMS = [
  { label: 'Account', path: '/account', icon: '👤' },
  { label: 'VMs',     path: '/vms',     icon: '🖥️'  },
  { label: 'Secrets', path: '/secrets', icon: '🔒'  },
]

export default function UserMenu({ name = 'Anmol' }) {
  const [open, setOpen] = useState(false)
  const ref             = useRef(null)
  const navigate        = useNavigate()

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const go = (path) => { setOpen(false); navigate(path) }

  return (
    <div className="user-menu" ref={ref}>
      <button className="user-menu-trigger" onClick={() => setOpen(o => !o)}>
        <div className="header-avatar">{name[0].toUpperCase()}</div>
        <span className="header-username">{name}</span>
        <span className="user-menu-chevron">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="user-menu-dropdown">
          {ITEMS.map(item => (
            <button key={item.path} className="user-menu-item" onClick={() => go(item.path)}>
              <span className="user-menu-item-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
