import { useState, useEffect, useCallback } from 'react'
import Modal from '../components/Modal'

const EMPTY = { name: '', ip: '', description: '', password: '', assigned_to: '' }

function MaskedCell({ value }) {
  const [show, setShow] = useState(false)
  if (!value) return <span style={{ color: 'var(--text-muted)' }}>—</span>
  return (
    <div className="flex-gap">
      <span className="mono">{show ? value : '••••••••'}</span>
      <button className="btn btn-sm" onClick={() => setShow(s => !s)}>{show ? 'Hide' : 'Show'}</button>
    </div>
  )
}

export default function VMsPage() {
  const [vms,      setVms]      = useState([])
  const [loading,  setLoading]  = useState(true)
  const [modal,    setModal]    = useState(null)
  const [form,     setForm]     = useState(EMPTY)
  const [saving,   setSaving]   = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [error,    setError]    = useState('')

  const load = useCallback(() => {
    fetch('/api/vms')
      .then(r => r.json())
      .then(d => { setVms(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const openAdd  = () => { setForm(EMPTY); setError(''); setModal('add') }
  const openEdit = (vm) => {
    setForm({
      name: vm.name || '', ip: vm.ip || '', description: vm.description || '',
      password: vm.password || '', assigned_to: vm.assigned_to || '',
    })
    setError(''); setModal(vm)
  }
  const closeModal = () => { setModal(null); setError('') }

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required.'); return }
    setSaving(true)
    try {
      if (modal === 'add') {
        await fetch('/api/vms', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
      } else {
        await fetch(`/api/vms/${encodeURIComponent(modal.name)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
      }
      closeModal(); load()
    } catch { setError('Server error.') }
    setSaving(false)
  }

  const handleDelete = async (vm) => {
    if (!window.confirm(`Delete VM "${vm.name}"?`)) return
    setDeleting(vm.name)
    await fetch(`/api/vms/${encodeURIComponent(vm.name)}`, { method: 'DELETE' })
    setDeleting(null); load()
  }

  const f = (key, label, placeholder = '') => (
    <div className="form-group">
      <label className="field-label">{label}</label>
      <input type="text" value={form[key]} placeholder={placeholder}
        onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} />
    </div>
  )

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">VM Management</h1>
        <button className="btn btn-primary" onClick={openAdd}>+ Add VM</button>
      </div>

      {loading ? (
        <div className="center"><span className="spinner" /></div>
      ) : vms.length === 0 ? (
        <div className="empty">
          <h3>No VMs yet</h3>
          <p>Click <strong>+ Add VM</strong> to register your first VM.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>IP Address</th><th>Description</th>
                <th>Password</th><th>Assigned To</th><th></th>
              </tr>
            </thead>
            <tbody>
              {vms.map(vm => (
                <tr key={vm.name}>
                  <td style={{ fontWeight: 500 }}>{vm.name}</td>
                  <td className="mono">{vm.ip || '—'}</td>
                  <td>{vm.description || '—'}</td>
                  <td><MaskedCell value={vm.password} /></td>
                  <td>{vm.assigned_to || '—'}</td>
                  <td>
                    <div className="flex-gap">
                      <button className="btn btn-sm" onClick={() => openEdit(vm)}>Edit</button>
                      <button className="btn btn-sm btn-danger"
                        disabled={deleting === vm.name} onClick={() => handleDelete(vm)}
                      >{deleting === vm.name ? '…' : 'Delete'}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={modal === 'add' ? 'Add VM' : `Edit VM — ${modal.name}`} onClose={closeModal}>
          {error && <div className="alert alert-error">{error}</div>}
          {modal === 'add' && f('name', 'Name *', 'e.g. heeng-pik-dev1')}
          {f('ip', 'IP Address', 'e.g. 10.192.251.191')}
          {f('description', 'Description', 'e.g. weblogic')}
          {f('password', 'Password')}
          {f('assigned_to', 'Assigned To', 'e.g. Anmol')}
          <div className="flex-gap" style={{ marginTop: 8 }}>
            <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
              {saving ? 'Saving…' : modal === 'add' ? 'Add VM' : 'Save Changes'}
            </button>
            <button className="btn" onClick={closeModal}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
