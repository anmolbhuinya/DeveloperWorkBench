import { useState, useEffect } from 'react'

// File explorer for a docker container: left-click a folder to open it, ".." goes up,
// right-click an item to export it to this machine, import a file / folder into the current (or any) folder.

const joinPath = (dir, name) => (dir === '/' ? '' : dir.replace(/\/$/, '')) + '/' + name
const parentPath = (p) => { const s = p.replace(/\/$/, ''); const i = s.lastIndexOf('/'); return i <= 0 ? '/' : s.slice(0, i) }

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }
const box = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, width: 560, maxWidth: '94vw', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }
const inp = { flex: 1, fontSize: 12, padding: '5px 8px', fontFamily: 'monospace', background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4 }

// Pick a folder (or a file / folder) on this machine.
function LocalPicker({ mode, start, onPick, onClose }) {   // mode: 'folder' | 'any'
  const [path, setPath] = useState(start || '~/Downloads')
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [sel, setSel] = useState(null)
  useEffect(() => {
    setErr(null); setSel(null)
    fetch(`/api/docker/local-fs?path=${encodeURIComponent(path)}`).then(r => r.json())
      .then(d => { if (d.ok) setData(d); else setErr(d.error) }).catch(() => setErr('Could not reach server'))
  }, [path])
  const cur = data?.path || path
  return (
    <div style={{ ...overlay, zIndex: 3100 }} onMouseDown={onClose}>
      <div style={{ ...box, width: 520 }} onMouseDown={e => e.stopPropagation()}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>{mode === 'folder' ? 'Choose a folder' : 'Choose a file or folder'}</div>
        <div style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 6, wordBreak: 'break-all' }}>{cur}</div>
        {err && <div style={{ color: '#c62828', fontSize: 12, marginBottom: 6 }}>{err}</div>}
        <div style={{ height: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4 }}>
          {data?.parent && <div onClick={() => setPath(data.parent)} style={{ padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>📁 ..</div>}
          {(data?.items || []).filter(i => mode === 'any' || i.dir).map(i => {
            const full = cur.replace(/[\\/]$/, '') + '\\' + i.name
            return (
              <div key={i.name} onClick={() => (i.dir ? setPath(full) : setSel(full))}
                onDoubleClick={() => { if (i.dir && mode === 'any') setSel(null) }}
                style={{ padding: '4px 10px', cursor: 'pointer', fontSize: 12, background: sel === full ? 'rgba(59,130,246,0.15)' : 'transparent', display: 'flex', gap: 8 }}>
                <span>{i.dir ? '📁' : '📄'}</span><span style={{ flex: 1 }}>{i.name}</span>
                {i.dir && mode === 'any' && <a style={{ fontSize: 11, cursor: 'pointer' }} onClick={e => { e.stopPropagation(); setSel(full) }}>select</a>}
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" disabled={mode === 'any' && !sel && false} onClick={() => onPick(sel || cur)}>
            {mode === 'folder' ? 'Use this folder' : (sel ? 'Use selected' : 'Use this folder')}
          </button>
        </div>
      </div>
    </div>
  )
}

function TransferDialog({ container, kind, remotePath, isDir, onClose, onDone }) {   // kind: 'export' | 'import'
  const [local, setLocal] = useState('~/Downloads')   // export: destination folder; import: source file/folder
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [pick, setPick] = useState(false)
  const exporting = kind === 'export'

  function go() {
    setBusy(true); setMsg(null)
    const url = `/api/docker/containers/${encodeURIComponent(container)}/fs/${kind}`
    const body = exporting ? { path: remotePath, dest: local } : { src: local, dest: remotePath }
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setMsg({ ok: true, text: exporting ? `Exported to ${d.saved_to}` : 'Imported' }); onDone && onDone() }
        else setMsg({ ok: false, text: d.error || 'Failed' })
      })
      .catch(() => setMsg({ ok: false, text: 'Could not reach server' }))
      .finally(() => setBusy(false))
  }

  return (
    <div style={overlay} onMouseDown={onClose}>
      <div style={box} onMouseDown={e => e.stopPropagation()}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>{exporting ? `Export ${isDir ? 'folder' : 'file'} to this machine` : 'Import a file or folder into the container'}</div>
        <div style={{ fontSize: 12, marginBottom: 10 }}>
          {exporting ? 'From container' : 'Into container folder'}: <code>{container}:{remotePath}</code>
        </div>
        <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--text-muted)' }}>{exporting ? 'Save in folder' : 'File or folder on this machine'}</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <input style={inp} value={local} onChange={e => setLocal(e.target.value)} />
          <button className="btn btn-sm" onClick={() => setPick(true)}>Browse…</button>
        </div>
        {msg && <div style={{ fontSize: 12, marginBottom: 8, color: msg.ok ? '#2e7d32' : '#c62828', wordBreak: 'break-all' }}>{msg.text}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-sm" onClick={onClose}>{msg?.ok ? 'Close' : 'Cancel'}</button>
          <button className="btn btn-sm btn-primary" disabled={busy || !local.trim()} onClick={go}>
            {busy ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> : (exporting ? 'Export' : 'Import')}
          </button>
        </div>
        {pick && <LocalPicker mode={exporting ? 'folder' : 'any'} start={exporting ? local : '~/Downloads'} onClose={() => setPick(false)} onPick={p => { setLocal(p); setPick(false) }} />}
      </div>
    </div>
  )
}

export function ContextMenu({ x, y, items, onClose }) {
  useEffect(() => {
    const close = () => onClose()
    document.addEventListener('mousedown', close); document.addEventListener('scroll', close, true)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('scroll', close, true) }
  }, [onClose])
  return (
    <div onMouseDown={e => e.stopPropagation()} style={{ position: 'fixed', left: x, top: y, zIndex: 4000, background: '#252525', border: '1px solid #444',
      borderRadius: 6, minWidth: 190, padding: '4px 0', boxShadow: '0 4px 12px rgba(0,0,0,.5)' }}>
      {items.map((it, i) => (
        <div key={i} onClick={() => { onClose(); it.onClick() }} style={{ padding: '6px 14px', cursor: 'pointer', fontSize: 12, color: '#ddd' }}
          onMouseEnter={e => e.currentTarget.style.background = '#333'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>{it.label}</div>
      ))}
    </div>
  )
}

export default function DockerExplorer({ container, onClose }) {
  const [path, setPath] = useState('/')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [menu, setMenu] = useState(null)       // {x, y, items}
  const [dialog, setDialog] = useState(null)   // {kind, remotePath, isDir}
  const [tick, setTick] = useState(0)

  useEffect(() => {
    setLoading(true); setErr(null)
    fetch(`/api/docker/containers/${encodeURIComponent(container)}/fs?path=${encodeURIComponent(path)}`).then(r => r.json())
      .then(d => { if (d.ok) { setData(d); if (d.path !== path) setPath(d.path) } else setErr(d.error) })
      .catch(() => setErr('Could not reach server'))
      .finally(() => setLoading(false))
  }, [container, path, tick])

  const cur = data?.path || path
  const crumbs = cur === '/' ? [] : cur.split('/').filter(Boolean)

  function itemMenu(e, item) {
    e.preventDefault()
    const full = joinPath(cur, item.name)
    const items = [{ label: `Export ${item.dir ? 'folder' : 'file'} to this machine…`, onClick: () => setDialog({ kind: 'export', remotePath: full, isDir: item.dir }) }]
    if (item.dir) items.push({ label: 'Import file / folder into this folder…', onClick: () => setDialog({ kind: 'import', remotePath: full, isDir: true }) })
    setMenu({ x: e.clientX, y: e.clientY, items })
  }
  function areaMenu(e) {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'Import file / folder here…', onClick: () => setDialog({ kind: 'import', remotePath: cur, isDir: true }) },
      { label: 'Export this folder to this machine…', onClick: () => setDialog({ kind: 'export', remotePath: cur, isDir: true }) },
      { label: 'Refresh', onClick: () => setTick(t => t + 1) },
    ] })
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>📂 {container}</span>
        <span style={{ fontFamily: 'monospace', fontSize: 12, flex: 1, wordBreak: 'break-all' }}>
          <a style={{ cursor: 'pointer' }} onClick={() => setPath('/')}>/</a>
          {crumbs.map((c, i) => (
            <span key={i}><a style={{ cursor: 'pointer' }} onClick={() => setPath('/' + crumbs.slice(0, i + 1).join('/'))}>{c}</a>{i < crumbs.length - 1 ? ' / ' : ''}</span>
          ))}
        </span>
        <button className="btn btn-sm" onClick={() => setDialog({ kind: 'import', remotePath: cur, isDir: true })} disabled={!data}>⬆ Import here</button>
        <button className="btn btn-sm" onClick={() => setTick(t => t + 1)}>↻</button>
        <button className="btn btn-sm" onClick={onClose}>✕ Close</button>
      </div>
      <div style={{ maxHeight: 360, overflowY: 'auto', minHeight: 120 }} onContextMenu={areaMenu}>
        {loading && <div style={{ padding: 12 }}><span className="spinner" /></div>}
        {err && <div style={{ padding: 12, color: '#c62828', fontSize: 12 }}>{err}</div>}
        {!loading && !err && cur !== '/' && (
          <div onClick={() => setPath(parentPath(cur))} onContextMenu={e => e.stopPropagation() || e.preventDefault()}
            style={{ padding: '4px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border)' }}>📁 ..</div>
        )}
        {!loading && !err && (data?.items || []).map(i => (
          <div key={i.name} onClick={() => i.dir && setPath(joinPath(cur, i.name))} onContextMenu={e => { e.stopPropagation(); itemMenu(e, i) }}
            style={{ padding: '4px 12px', cursor: i.dir ? 'pointer' : 'default', fontSize: 13, borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(128,128,128,0.08)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <span>{i.dir ? '📁' : '📄'}</span><span style={{ fontFamily: 'monospace' }}>{i.name}</span>
          </div>
        ))}
        {!loading && !err && data && data.items.length === 0 && <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>Empty folder</div>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '3px 10px' }}>Click a folder to open it · right-click for Export / Import</div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {dialog && <TransferDialog container={container} kind={dialog.kind} remotePath={dialog.remotePath} isDir={dialog.isDir}
        onClose={() => setDialog(null)} onDone={() => dialog.kind === 'import' && setTick(t => t + 1)} />}
    </div>
  )
}
