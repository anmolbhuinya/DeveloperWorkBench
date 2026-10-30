import { useState, useEffect, useCallback } from 'react'
import Modal from '../components/Modal'

const EMPTY = { key: '', value: '', notes: '' }

function MaskedValue({ value }) {
  const [show, setShow] = useState(false)
  if (!value) return <span style={{ color: 'var(--text-muted)' }}>—</span>
  return (
    <div className="flex-gap">
      <span className="mono" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {show ? value : '•'.repeat(Math.min(value.length, 24))}
      </span>
      <button className="btn btn-sm" onClick={() => setShow(s => !s)}>{show ? 'Hide' : 'Show'}</button>
    </div>
  )
}

export default function SecretsPage() {
  const [data,      setData]      = useState({ categories: [], secrets: [] })
  const [loading,   setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState(null)
  const [modal,     setModal]     = useState(null)
  const [form,      setForm]      = useState(EMPTY)
  const [saving,    setSaving]    = useState(false)
  const [deleting,  setDeleting]  = useState(null)
  const [error,     setError]     = useState('')

  const load = useCallback(() => {
    fetch('/api/secrets')
      .then(r => r.json())
      .then(d => {
        setData(d)
        setActiveTab(prev => (d.categories.includes(prev) ? prev : d.categories[0] || null))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = data.secrets.filter(s => s.category === activeTab)

  const openAdd  = () => { setForm(EMPTY); setError(''); setModal('add') }
  const openEdit = (s) => {
    setForm({ key: s.key || '', value: s.value || '', notes: s.notes || '' })
    setError(''); setModal(s)
  }
  const closeModal = () => { setModal(null); setError('') }

  const handleSave = async () => {
    if (!form.key.trim()) { setError('Key is required.'); return }
    setSaving(true)
    try {
      if (modal === 'add') {
        await fetch('/api/secrets', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, category: activeTab }),
        })
      } else {
        await fetch(`/api/secrets/${encodeURIComponent(modal.category)}/${encodeURIComponent(modal.key)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
      }
      closeModal(); load()
    } catch { setError('Server error.') }
    setSaving(false)
  }

  const handleDelete = async (s) => {
    if (!window.confirm(`Delete secret "${s.key}"?`)) return
    setDeleting(s.key)
    await fetch(`/api/secrets/${encodeURIComponent(s.category)}/${encodeURIComponent(s.key)}`, { method: 'DELETE' })
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
        <h1 className="page-title">Secrets Management</h1>
        {activeTab && (
          <button className="btn btn-primary" onClick={openAdd}>+ Add Secret</button>
        )}
      </div>

      {loading ? (
        <div className="center"><span className="spinner" /></div>
      ) : data.categories.length === 0 ? (
        <div className="empty">
          <h3>No secrets found</h3>
          <p>Add sheets to <strong>secrets.xlsx</strong> to categorize secrets.</p>
        </div>
      ) : (
        <>
          <div className="tabs">
            {data.categories.map(cat => (
              <button
                key={cat}
                className={`tab${activeTab === cat ? ' active' : ''}`}
                onClick={() => setActiveTab(cat)}
              >{cat}</button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="empty">
              <h3>No secrets in {activeTab}</h3>
              <p>Click <strong>+ Add Secret</strong> to add one.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Key</th><th>Value</th><th>Notes</th><th></th></tr>
                </thead>
                <tbody>
                  {filtered.map(s => (
                    <tr key={s.key}>
                      <td style={{ fontWeight: 500, fontFamily: 'Consolas, monospace', fontSize: 13 }}>{s.key}</td>
                      <td><MaskedValue value={s.value} /></td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{s.notes || '—'}</td>
                      <td>
                        <div className="flex-gap">
                          <button className="btn btn-sm" onClick={() => openEdit(s)}>Edit</button>
                          <button className="btn btn-sm btn-danger"
                            disabled={deleting === s.key} onClick={() => handleDelete(s)}
                          >{deleting === s.key ? '…' : 'Delete'}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {modal && (
        <Modal
          title={modal === 'add' ? `Add Secret — ${activeTab}` : `Edit Secret — ${modal.key}`}
          onClose={closeModal}
        >
          {error && <div className="alert alert-error">{error}</div>}
          {modal === 'add' && f('key', 'Key *', 'e.g. JENKINS_API_TOKEN')}
          {f('value', 'Value')}
          {f('notes', 'Notes', 'What is this secret used for?')}
          <div className="flex-gap" style={{ marginTop: 8 }}>
            <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
              {saving ? 'Saving…' : modal === 'add' ? 'Add Secret' : 'Save Changes'}
            </button>
            <button className="btn" onClick={closeModal}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
