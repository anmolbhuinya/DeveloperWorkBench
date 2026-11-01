import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const CARDS = [
  {
    path: '/setup/dev-softwares',
    icon: '💾',
    title: 'Dev Softwares',
    desc: 'IntelliJ IDEA, Postman, SoapUI, Fiddler, Docker Desktop',
  },
  {
    path: '/setup/dev-tools',
    icon: '🛠',
    title: 'Dev Tools',
    desc: 'Developer tool links and resources',
  },
  {
    path: '/setup/version-managers',
    icon: '🔀',
    title: 'Version Managers',
    desc: 'SDKMAN (Java), Pyenv (Python), NVM (JavaScript)',
  },
]

export default function SetupPage() {
  const navigate  = useNavigate()
  const [dir, setDir]       = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]   = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  const [dwbPath,    setDwbPath]    = useState('')
  const [dwbInput,   setDwbInput]   = useState('')
  const [dwbSaving,  setDwbSaving]  = useState(false)
  const [dwbSaveMsg, setDwbSaveMsg] = useState('')

  const [dwbFolders, setDwbFolders] = useState({ exists: true, folders: [] })
  const [openErr,    setOpenErr]    = useState('')
  const loadDwbFolders = () => fetch('/api/setup/dwb-folders').then(r => r.json())
    .then(d => { if (d.ok) setDwbFolders({ exists: d.exists, folders: d.folders || [] }) }).catch(() => {})
  const openPath = (target, name) => {
    setOpenErr('')
    fetch('/api/setup/open-path', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target, name }) })
      .then(r => r.json()).then(d => { if (!d.ok) setOpenErr(d.error || 'Could not open folder') })
      .catch(() => setOpenErr('Could not reach server'))
  }
  const [toolMsg, setToolMsg] = useState('')
  const runTool = (tool) => {
    setToolMsg('')
    fetch('/api/setup/run-tool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool }) })
      .then(r => r.json()).then(d => { if (!d.ok) setToolMsg(d.error || 'Could not start the tool') })
      .catch(() => setToolMsg('Could not reach server'))
  }
  const TOOLS = [
    { tool: 'export',    label: 'Export Projects',  icon: '/tool-export.png',    tip: 'ExportProjects.exe - save your projects, settings and run history as one zip' },
    { tool: 'import',    label: 'Import Projects',  icon: '/tool-import.png',    tip: 'ImportProjects.exe - restore an export zip (a backup of replaced files is kept)' },
    { tool: 'installer', label: 'Create Installer', icon: '/tool-installer.png', tip: 'CreateInstaller.exe - build DeveloperWorkbenchSetup.exe from this installation' },
  ]
  const openBtn = {
    background: 'transparent', color: 'var(--primary)', border: '1px solid var(--border)', borderRadius: 4,
    padding: '4px 12px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
  }
  useEffect(() => { loadDwbFolders() }, [dwbPath])

  useEffect(() => {
    fetch('/api/setup/config')
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setDir(d.project_directory || '')
          setDwbPath(d.dwb_workspace || '')
          setDwbInput(d.dwb_workspace || '')
        }
      })
      .catch(() => {})
  }, [])

  const startEdit = () => { setDraft(dir); setEditing(true); setSaveMsg('') }
  const cancelEdit = () => { setEditing(false); setSaveMsg('') }

  const save = () => {
    setSaving(true); setSaveMsg('')
    fetch('/api/setup/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_directory: draft }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setDir(draft); setEditing(false); setSaveMsg('Saved') }
        else setSaveMsg(d.error || 'Save failed')
      })
      .catch(() => setSaveMsg('Save failed'))
      .finally(() => setSaving(false))
  }

  const saveDwb = () => {
    setDwbSaving(true); setDwbSaveMsg('')
    fetch('/api/setup/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dwb_workspace: dwbInput }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setDwbPath(dwbInput); setDwbSaveMsg('Saved') }
        else setDwbSaveMsg(d.error || 'Save failed')
      })
      .catch(() => setDwbSaveMsg('Save failed'))
      .finally(() => setDwbSaving(false))
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 860 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--text)' }}>
          Setup
        </h1>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
          Configure credentials, account settings, and platform preferences
        </div>
      </div>

      {/* Project Directory */}
      <div style={{
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '14px 16px',
        marginBottom: 28,
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
          Project Directory
        </div>

        {editing ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              style={{
                flex: 1, minWidth: 280,
                background: 'var(--surface)', border: '1px solid var(--primary)',
                borderRadius: 4, padding: '6px 10px',
                color: 'var(--text)', fontFamily: 'monospace', fontSize: 13,
                outline: 'none',
              }}
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancelEdit() }}
              autoFocus
            />
            <button
              onClick={save}
              disabled={saving}
              style={{
                background: 'var(--primary)', color: '#fff',
                border: 'none', borderRadius: 4, padding: '6px 14px',
                fontSize: 13, cursor: saving ? 'default' : 'pointer', fontWeight: 600,
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={cancelEdit}
              style={{
                background: 'transparent', color: 'var(--text-muted)',
                border: '1px solid var(--border)', borderRadius: 4, padding: '6px 12px',
                fontSize: 13, cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            {saveMsg && <span style={{ fontSize: 12, color: saveMsg === 'Saved' ? 'var(--success)' : 'var(--danger)' }}>{saveMsg}</span>}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text)', wordBreak: 'break-all', flex: 1 }}>
              {dir || <span style={{ color: 'var(--text-muted)' }}>Not configured</span>}
            </span>
            <button onClick={() => openPath('project')} disabled={!dir} style={openBtn} title="Open in Explorer">📂 Open</button>
            <button
              onClick={startEdit}
              style={{
                background: 'transparent', color: 'var(--primary)',
                border: '1px solid var(--border)', borderRadius: 4, padding: '4px 12px',
                fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {/* DWB Workspace */}
      <div style={{
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '14px 16px',
        marginBottom: 28,
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
          Developer Workbench
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>DWB_HOME:</span>
          <input
            value={dwbInput}
            onChange={e => { setDwbInput(e.target.value); setDwbSaveMsg('') }}
            onKeyDown={e => e.key === 'Enter' && dwbInput !== dwbPath && saveDwb()}
            style={{
              flex: 1, minWidth: 280,
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 4, padding: '6px 10px',
              color: 'var(--text)', fontFamily: 'monospace', fontSize: 13,
            }}
            placeholder="e.g. C:\Users\you\DWB"
          />
          <button
            onClick={saveDwb}
            disabled={dwbSaving || dwbInput === dwbPath}
            style={{
              background: 'var(--primary)', color: '#fff',
              border: 'none', borderRadius: 4, padding: '6px 14px',
              fontSize: 13, cursor: (dwbSaving || dwbInput === dwbPath) ? 'default' : 'pointer',
              fontWeight: 600, opacity: dwbInput === dwbPath ? 0.5 : 1,
            }}
          >
            {dwbSaving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => openPath('dwb')} style={openBtn} title="Open in Explorer">📂 Open</button>
          {dwbSaveMsg && <span style={{ fontSize: 12, color: dwbSaveMsg === 'Saved' ? 'var(--success)' : 'var(--danger)' }}>{dwbSaveMsg}</span>}
        </div>
        {openErr && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{openErr}</div>}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
          {TOOLS.map(t => (
            <button key={t.tool} onClick={() => runTool(t.tool)} title={t.tip}
              style={{ ...openBtn, color: 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px 6px 8px', fontSize: 13, fontWeight: 600 }}>
              <img src={t.icon} alt="" width={26} height={26} style={{ borderRadius: 6, display: 'block' }} />
              {t.label}
            </button>
          ))}
        </div>
        {toolMsg && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{toolMsg}</div>}

        <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '14px 0 6px' }}>
          Folders in Developer Workbench ({dwbFolders.folders.length})
        </div>
        {!dwbFolders.exists
          ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>The folder does not exist yet.</div>
          : dwbFolders.folders.length === 0
            ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No folders yet.</div>
            : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {dwbFolders.folders.map(f => (
                  <button key={f.name} onClick={() => openPath('dwb_sub', f.name)} title={f.path}
                    style={{ ...openBtn, color: 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    📁 {f.name}
                  </button>
                ))}
              </div>
            )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {CARDS.map(card => (
          <div
            key={card.path}
            className="card"
            style={{ width: 220, cursor: 'pointer', transition: 'box-shadow 0.15s, border-color 0.15s' }}
            onClick={() => navigate(card.path)}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.2)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = '' }}
          >
            <div style={{ fontSize: 36, marginBottom: 10 }}>{card.icon}</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4, color: 'var(--text)' }}>{card.title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{card.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
