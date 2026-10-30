import { useEffect } from 'react'

export default function ConfirmDialog({ title, message, confirmLabel = 'Confirm', variant = 'danger', onConfirm, onCancel }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onCancel])

  const iconMap = { danger: { char: '⚠', color: 'var(--danger)' }, warning: { char: '⚠', color: 'var(--warning)' } }
  const icon = iconMap[variant] || iconMap.danger

  const solidStyle = {
    background: icon.color,
    color: variant === 'warning' ? '#0d1117' : '#fff',
    borderColor: icon.color,
    fontWeight: 600,
  }

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal" style={{ maxWidth: 420 }} onMouseDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: icon.color, fontSize: 15 }}>{icon.char}</span>
            {title}
          </span>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.6 }}>{message}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={onCancel}>Cancel</button>
            <button className="btn" style={solidStyle} onClick={onConfirm}>{confirmLabel}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
