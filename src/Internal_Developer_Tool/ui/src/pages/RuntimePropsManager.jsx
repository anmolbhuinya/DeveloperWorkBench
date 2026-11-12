import { useState, useEffect, useCallback } from 'react'

const BK_BG = 'rgba(249,168,37,0.16)'   // row tint of a backed-up property

// Runtime properties of an application (local or remote): the properties themselves live in the app / container,
// while the properties-file path, the tags and the backups are kept in <app>\server_config.xlsx (sheet runtime_properties).
export default function RuntimePropsManager({ scope = 'local', appName, vmIp = '' }) {
  const rpApi   = `/api/rp/${scope}/${appName}`
  const propApi = scope === 'remote' ? `/api/remote-app/${appName}/runtime-properties` : `/api/local-app/${appName}/runtime-properties`
  const vq      = p => (scope === 'remote' && vmIp ? `${p}${p.includes('?') ? '&' : '?'}vm_ip=${encodeURIComponent(vmIp)}` : p)

  const [d, setD]             = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState('')
  const [msg, setMsg]         = useState('')
  const [tab, setTab]         = useState('All')
  const [filter, setFilter]   = useState('')
  const [pathDraft, setPathDraft] = useState('')
  const [editKey, setEditKey] = useState(null)
  const [editVal, setEditVal] = useState('')
  const [newKey, setNewKey]   = useState('')
  const [newVal, setNewVal]   = useState('')
  const [newTag, setNewTag]   = useState('')
  const [busy, setBusy]       = useState(false)
  const [showAllBk, setShowAllBk] = useState(false)   // show the backed-up value under every backed-up row
  const [openBk, setOpenBk]   = useState({})          // ... or just under the rows clicked

  const apply = r => {
    if (r.ok) {
      setD(r); setPathDraft(r.path || ''); setErr(r.load_error || '')
    } else setErr(r.error || 'Failed')
    return r.ok
  }
  const load = useCallback(() => {
    setLoading(true)
    fetch(vq(rpApi)).then(r => r.json()).then(r => { if (r.ok) { setD(r); setPathDraft(r.path || ''); setErr(r.load_error || '') } else setErr(r.error || 'Failed') })
      .catch(() => setErr('Could not reach server')).finally(() => setLoading(false))
  }, [rpApi, vmIp])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (d && tab !== 'All' && !d.tags.includes(tab)) setTab('All') }, [d])

  const post = async (action, body, okMsg) => {
    setBusy(true); setMsg(''); setErr('')
    try {
      const r = await (await fetch(vq(`${rpApi}/${action}`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
      if (apply(r) && okMsg) setMsg(okMsg)
      return r.ok
    } catch { setErr('Could not reach server'); return false } finally { setBusy(false) }
  }
  const crud = async (method, suffix, body) => {
    setBusy(true); setErr('')
    try {
      const r = await (await fetch(vq(propApi + suffix), { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json()
      if (!r.ok) { setErr(r.error || 'Failed'); return false }
      load(); return true
    } catch { setErr('Could not reach server'); return false } finally { setBusy(false) }
  }

  const props   = d?.properties || {}
  const tagmap  = d?.tagmap || {}
  const tags    = d?.tags || []
  const inTab   = Object.keys(props).filter(k => tab === 'All' || tagmap[k] === tab)
  const q       = filter.toLowerCase()
  const rows    = inTab.filter(k => !q || k.toLowerCase().includes(q) || String(props[k]).toLowerCase().includes(q))
  const level   = tab === 'All' ? { level: 'all' } : { level: 'tag', tag: tab }
  const bk      = d?.backups?.[tab === 'All' ? '*' : tab]
  const scopeLabel = tab === 'All' ? 'all properties' : `tag "${tab}"`

  const input = { background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 4, padding: '3px 7px', fontSize: 12 }
  const cell  = { padding: '5px 8px', fontSize: 12, verticalAlign: 'middle' }
  const sbtn  = { fontSize: 11, padding: '2px 9px' }
  const tabBtn = active => ({ fontSize: 12, fontWeight: 600, padding: '4px 14px', borderRadius: 14, cursor: 'pointer',
    border: '1px solid var(--primary,#1976d2)', background: active ? 'var(--primary,#1976d2)' : 'var(--bg)', color: active ? '#fff' : 'var(--primary,#1976d2)' })

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Runtime Properties{d ? ` (${Object.keys(props).length})` : ''}</span>
        <button onClick={load} disabled={loading} className="btn btn-sm" style={sbtn}>
          {loading ? <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} /> : '↻ Refresh'}
        </button>
      </div>

      {/* 1. full file path of the runtime properties */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Properties file</span>
        <input value={pathDraft} onChange={e => setPathDraft(e.target.value)} placeholder={d?.default_path || ''}
          style={{ ...input, flex: 1, minWidth: 260, fontFamily: 'monospace' }} />
        <button className="btn btn-sm btn-primary" style={sbtn} disabled={busy || pathDraft.trim() === (d?.path || '')}
          onClick={() => post('path', { path: pathDraft.trim() }, 'Path saved')}>Save path</button>
        {d?.path && <button className="btn btn-sm" style={sbtn} disabled={busy} onClick={() => { setPathDraft(''); post('path', { path: '' }, 'Using the default path') }}>Use default</button>}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flexBasis: '100%' }}>
          {d?.path ? 'Custom path' : `Default path (${d?.default_path || '…'})`} · saved in {d?.config_file || 'server_config.xlsx'} › runtime_properties
        </span>
      </div>

      {err && <div className="alert alert-error" style={{ marginBottom: 8, fontSize: 12 }}>{err}</div>}
      {msg && <div style={{ marginBottom: 8, fontSize: 12, color: '#2e7d32' }}>✓ {msg}</div>}

      {/* 2. tags: All + one tab per tag */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <button style={tabBtn(tab === 'All')} onClick={() => setTab('All')}>All</button>
        {tags.map(t => (
          <button key={t} style={tabBtn(tab === t)} onClick={() => setTab(t)}>{t} <span style={{ opacity: 0.8, fontWeight: 400 }}>({Object.values(tagmap).filter(x => x === t).length})</span></button>
        ))}
        <input value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="New tag" style={{ ...input, width: 110 }}
          onKeyDown={e => { if (e.key === 'Enter' && newTag.trim()) post('tag', { op: 'create', name: newTag.trim() }).then(ok => { if (ok) { setTab(newTag.trim()); setNewTag('') } }) }} />
        <button className="btn btn-sm" style={sbtn} disabled={busy || !newTag.trim()}
          onClick={() => post('tag', { op: 'create', name: newTag.trim() }).then(ok => { if (ok) { setTab(newTag.trim()); setNewTag('') } })}>+ Tag</button>
        {tab !== 'All' && (
          <>
            <button className="btn btn-sm" style={sbtn} disabled={busy} title="Rename this tag" onClick={() => {
              const n = window.prompt('New name for tag "' + tab + '"', tab)
              if (n && n.trim() && n.trim() !== tab) post('tag', { op: 'rename', name: tab, new: n.trim() }).then(ok => { if (ok) setTab(n.trim()) })
            }}>✎ Rename</button>
            <button className="btn btn-sm btn-danger" style={sbtn} disabled={busy} title="Delete this tag (its properties stay in All)" onClick={() => {
              if (window.confirm(`Delete tag "${tab}"? Its properties stay in All, just untagged.`)) post('tag', { op: 'delete', name: tab }).then(ok => { if (ok) setTab('All') })
            }}>🗑 Delete tag</button>
          </>
        )}
      </div>

      {/* 3. backup / toggle back for the whole list (All) or for the tagged group */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8, fontSize: 12 }}>
        <button className="btn btn-sm" style={sbtn} disabled={busy || inTab.length === 0 && tab !== 'All'} onClick={() => post('backup', level, `Backed up ${scopeLabel}`)}>💾 Backup {scopeLabel}</button>
        <button className="btn btn-sm" style={sbtn} disabled={busy || !bk} onClick={() => {
          if (window.confirm(`Toggle back ${scopeLabel} to the backup of ${bk.time}?${tab === 'All' ? '\nProperties added since the backup will be removed.' : ''}`)) post('restore', level, `Restored ${scopeLabel}`)
        }}>↩ Restore {scopeLabel}</button>
        <span style={{ color: 'var(--text-muted)' }}>{bk ? `Last backup ${bk.time} (${bk.count} propert${bk.count === 1 ? 'y' : 'ies'})` : 'No backup yet'}</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', cursor: 'pointer' }} title="Show the backed-up value under every backed-up row">
          <input type="checkbox" checked={showAllBk} onChange={e => setShowAllBk(e.target.checked)} /> Show all backup values
        </label>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)' }}><span style={{ width: 12, height: 12, borderRadius: 3, background: BK_BG, border: '1px solid #f9a825' }} /> backed up</span>
      </div>

      <input type="text" placeholder="Filter by key or value…" value={filter} onChange={e => setFilter(e.target.value)}
        style={{ ...input, marginBottom: 8, width: '100%', boxSizing: 'border-box' }} />

      {loading && !d ? (
        <div style={{ textAlign: 'center', padding: 20 }}><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /></div>
      ) : (
        <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 5 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)', position: 'sticky', top: 0, zIndex: 1 }}>
                {['Key', 'Value', 'Tag', 'Backup', ''].map((h, i) => (
                  <th key={i} style={{ ...cell, textAlign: 'left', fontWeight: 600, borderBottom: '1px solid var(--border-color)', width: i === 0 ? '32%' : i === 2 ? 130 : i === 3 ? 90 : i === 4 ? 40 : undefined }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={5} style={{ ...cell, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>
                  {filter ? 'No matches' : tab === 'All' ? 'No properties yet' : `No properties tagged "${tab}" - tag them from the All tab`}
                </td></tr>
              ) : rows.map(k => {
                const bv = d?.backup_values?.[k]            // {value, time, source} when this property is backed up
                const changed = bv && String(props[k]) !== bv.value
                const showBv = bv && (showAllBk || openBk[k])
                return (
                <tr key={k} style={{ borderBottom: '1px solid var(--border-color)', background: bv ? BK_BG : undefined, boxShadow: bv ? 'inset 4px 0 0 #f9a825' : undefined }}>
                  <td style={{ ...cell, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    {k}
                    {bv && <span title={`Backed up ${bv.time} (${bv.source})`} style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: '#8d6e00', background: '#ffe082', borderRadius: 8, padding: '1px 6px', fontFamily: 'sans-serif' }}>{changed ? 'changed since backup' : 'backed up'}</span>}
                  </td>
                  <td style={cell}>
                    {editKey === k ? (
                      <div style={{ display: 'flex', gap: 5 }}>
                        <input value={editVal} autoFocus onChange={e => setEditVal(e.target.value)} style={{ ...input, flex: 1 }}
                          onKeyDown={e => { if (e.key === 'Enter') crud('PUT', '/' + encodeURIComponent(k), { value: editVal }).then(ok => ok && setEditKey(null)); if (e.key === 'Escape') setEditKey(null) }} />
                        <button className="btn btn-primary btn-sm" style={sbtn} disabled={busy} onClick={() => crud('PUT', '/' + encodeURIComponent(k), { value: editVal }).then(ok => ok && setEditKey(null))}>Save</button>
                        <button className="btn btn-sm" style={sbtn} onClick={() => setEditKey(null)}>✕</button>
                      </div>
                    ) : (
                      <span style={{ fontFamily: 'monospace', cursor: 'pointer', display: 'block', wordBreak: 'break-all' }} title="Click to edit"
                        onClick={() => { setEditKey(k); setEditVal(props[k] ?? '') }}>
                        {String(props[k]) || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>(empty)</span>}
                      </span>
                    )}
                    {showBv && (
                      <div style={{ marginTop: 3, fontSize: 11, color: '#8d6e00', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        ↩ backup ({bv.source}, {bv.time}): {bv.value || <i>(empty)</i>}
                      </div>
                    )}
                  </td>
                  <td style={cell}>
                    <select value={tagmap[k] || ''} disabled={busy || (tags.length === 0 && !tagmap[k])} style={{ ...input, width: '100%' }}
                      title={tags.length ? 'Tag this property (or choose "— none —" to untag)' : 'Create a tag first'}
                      onChange={e => post('assign', { key: k, tag: e.target.value })}>
                      <option value="">— none —</option>
                      {tags.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm" style={{ ...sbtn, padding: '1px 6px' }} disabled={busy} title="Back up this property"
                      onClick={() => post('backup', { level: 'key', key: k }, `Backed up ${k}`)}>💾</button>{' '}
                    {bv && <><button className="btn btn-sm" style={{ ...sbtn, padding: '1px 6px' }} title="Show / hide the backed-up value of this property"
                      onClick={() => setOpenBk(o => ({ ...o, [k]: !o[k] }))}>👁</button>{' '}</>}
                    <button className="btn btn-sm" style={{ ...sbtn, padding: '1px 6px' }} disabled={busy || !d?.keybackup?.[k]}
                      title={d?.keybackup?.[k] ? `Toggle back to "${d.keybackup[k].value}" (${d.keybackup[k].time})` : 'No individual backup for this property'}
                      onClick={() => { if (window.confirm(`Toggle ${k} back to "${d.keybackup[k].value}"?`)) post('restore', { level: 'key', key: k }, `Restored ${k}`) }}>↩</button>
                  </td>
                  <td style={{ ...cell, textAlign: 'center' }}>
                    <button disabled={busy} title="Delete property" onClick={() => { if (window.confirm(`Delete ${k}?`)) crud('DELETE', '/' + encodeURIComponent(k)) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f44336', fontSize: 14, padding: '2px 4px', lineHeight: 1 }}>🗑</button>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <input placeholder="New key" value={newKey} onChange={e => setNewKey(e.target.value)} style={{ ...input, flex: '0 0 32%' }} />
        <input placeholder="Value" value={newVal} onChange={e => setNewVal(e.target.value)} style={{ ...input, flex: 1 }} />
        <button className="btn btn-primary btn-sm" disabled={busy || !newKey.trim()} style={sbtn}
          onClick={async () => {
            const k = newKey.trim()
            if (await crud('POST', '', { key: k, value: newVal })) {
              if (tab !== 'All') await post('assign', { key: k, tag: tab })   // added inside a tag tab: tagged right away
              setNewKey(''); setNewVal('')
            }
          }}>+ Add</button>
      </div>
    </div>
  )
}
