import { createContext, useContext, useState } from 'react'

// ── what the page may show, per kind of application page ─────────────────────
const P = (key, label) => ({ key, label })
const CODE_PANELS = [P('current_branch', 'Current Branch'), P('set_branch', 'Set Branch'), P('branch_management', 'Branch Management'), P('build_deploy', 'Build & Deploy'),
  P('modules', 'Modules'), P('ide', 'Open in IDE'), P('terminal', 'Open in Terminal')]

export const CATALOG = {
  local: {
    header: [['back_button', 'Back button'], ['app_logo', 'Application name'], ['branch_banner', 'Branch banner'], ['deployed_banner', 'Deployed banner']],
    tabs: [['code', 'Code'], ['it', '🧪 IT'], ['user_interface', 'User Interface'], ['api', 'API'], ['observability', 'Observability'], ['investigation', 'Investigation'],
      ['app_server', 'App Server'], ['database', 'Database'], ['queue', 'Queue'], ['cache', 'Cache'], ['ldap', 'LDAP'], ['vault', 'Secrets / Vault'], ['scm', 'Pull Requests'], ['gp_run', 'GP Run']],
    panels: {
      code: CODE_PANELS,
      app_server: [P('as_banner', 'Deployed banner'), P('as_status', 'Server status and controls'), P('as_server', 'Server details (logs, properties, services)')],
      observability: [P('obs_metrics', 'Metrics'), P('obs_events', 'Events'), P('obs_traces', 'Traces'), P('obs_logs', 'Logs'),
        P('met_system', 'Metrics > System'), P('met_app', 'Metrics > Application'), P('ev_timeline', 'Events > Timeline'), P('ev_config', 'Events > Configuration'),
        P('tr_appmap', 'Traces > AppMap'), P('tr_apptrace', 'Traces > Application Trace'), P('lg_applog', 'Logs > Application Log'), P('lg_p6spy', 'Logs > P6Spy'),
        P('am_services', 'AppMap > Service Maps'), P('am_sequence', 'AppMap > Sequence Diagram'), P('am_http', 'AppMap > Http Flow Visualization'), P('am_deps', 'AppMap > Dependency Map'),
        P('am_flame', 'AppMap > Flame Graph'), P('am_trace', 'AppMap > Trace View'), P('am_calls', 'AppMap > Call Graphs'), P('am_code', 'AppMap > Code to Runtime Navigation'),
        P('am_sql', 'AppMap > SQL Visualization'), P('am_sqlx', 'AppMap > SQL Executions')],
      investigation: [P('inv_categories', 'Issue Categories'), P('inv_investigate', 'Investigate'), P('inv_jvm', 'JVM Diagnostics'), P('inv_rca', 'Root Cause Analysis'),
        P('jvm_dash', 'JVM > Dashboard'), P('jvm_threads', 'JVM > Thread Analyzer'), P('jvm_heap', 'JVM > Heap Analyzer'), P('jvm_jfr', 'JVM > JFR')],
      ldap: [P('ldap_browse', 'Browse'), P('ldap_users', 'Users'), P('ldap_groups', 'Groups')],
    },
  },
  remote: {
    header: [['back_button', 'Back button'], ['app_logo', 'Application name'], ['vm_details', 'VM details'], ['branch_banner', 'Branch banner'], ['deployed_banner', 'Deployed banner']],
    tabs: [['code', 'Code'], ['it', '🧪 IT'], ['user_interface', 'User Interface'], ['api', 'API'], ['app_server', 'App Server'], ['database', 'Database'], ['queue', 'Queue'],
      ['scm', 'Pull Requests'], ['gp_run', 'GP Run']],
    panels: { code: CODE_PANELS },
  },
}

// default positions of tabs the page adds itself when the screen config does not mention them
export function resolveLocalTabs(cfgTabs, custom) {
  const base = (cfgTabs || []).filter(t => t.key !== 'appmap' && t.key !== 'p6spy')
  const by = Object.fromEntries(base.map(t => [t.key, t]))
  const codeOrder = by.code?.order ?? 0
  const itOrder = by.it?.order ?? codeOrder + 0.5
  const asOrder = by.app_server?.order ?? 2
  const D = {
    it: ['🧪 IT', codeOrder + 0.5], user_interface: ['User Interface', itOrder + 0.01], api: ['API', itOrder + 0.02],
    observability: ['Observability', itOrder + 0.1], investigation: ['Investigation', itOrder + 0.15],
    database: ['Database', asOrder + 0.01], queue: ['Queue', asOrder + 0.02],
    cache: ['Cache', asOrder + 0.03], ldap: ['LDAP', asOrder + 0.04], vault: ['Secrets / Vault', asOrder + 0.05],
  }
  const forced = custom ? {} : { user_interface: D.user_interface[1], api: D.api[1], database: D.database[1], queue: D.queue[1] }
  const out = base.map(t => (t.key in forced ? { ...t, order: forced[t.key] } : t))
  Object.entries(D).forEach(([k, [label, order]]) => {
    if (!custom && (k === 'it' || ['observability', 'investigation', 'cache', 'ldap', 'vault'].includes(k))) {
      if (!by[k]) out.push({ key: k, label, enabled: true, order })
    }
  })
  return out
}

// ── panel switches the tabs read ─────────────────────────────────────────────
const Ctx = createContext({ panels: [], settings: {} })
export function ScreenCfgProvider({ cfg, children }) {
  return <Ctx.Provider value={{ panels: cfg?.panels || [], settings: cfg?.settings || {} }}>{children}</Ctx.Provider>
}
export function usePanels() {
  const c = useContext(Ctx)
  return key => c.panels.find(p => p.key === key)?.enabled !== false
}
export function usePanel(key) {
  const c = useContext(Ctx)
  return c.panels.find(p => p.key === key)?.enabled !== false
}

// ── settings icon + configuration dialog ─────────────────────────────────────
const btn = { padding: '4px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }
const inp = { fontSize: 12, background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 6px' }
const arrow = { ...btn, padding: '0 6px', lineHeight: '18px' }

export function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function build(kind, cfg) {
  const cat = CATALOG[kind]
  const has = {}
  const src = kind === 'local' ? resolveLocalTabs(cfg?.tabs, !!cfg?.settings?.tabs_custom) : (cfg?.tabs || [])
  const tabs = src.filter(t => t.key !== 'app_config' && t.key !== 'appmap' && t.key !== 'p6spy').map(t => ({ ...t }))
  tabs.forEach(t => { has[t.key] = true })
  const baseOrder = tabs.reduce((m, t) => Math.max(m, t.order || 0), 0)
  // every tab of the catalog is offered; one this application does not have yet starts deselected (the remote page always adds IT itself)
  cat.tabs.forEach(([k, l], i) => { if (!has[k]) { tabs.push({ key: k, label: l, enabled: kind === 'remote' && k === 'it', order: baseOrder + i + 1 }); has[k] = true } })
  tabs.sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
  const header = {}
  cat.header.forEach(([k, l]) => { header[k] = { key: k, label: l, enabled: cfg?.header?.[k]?.enabled !== false } })
  Object.entries(cfg?.header || {}).forEach(([k, v]) => { if (!header[k]) header[k] = { key: k, label: v.label || k, enabled: v.enabled !== false } })
  const panels = {}
  Object.entries(cat.panels).forEach(([tab, list]) => {
    panels[tab] = list.map(({ key, label }, i) => {
      const c = (cfg?.panels || []).find(p => p.key === key)
      return { key, label: c?.label || label, enabled: c ? c.enabled !== false : true, order: c?.order ?? i + 1 }
    }).sort((a, b) => a.order - b.order)
  })
  ;(cfg?.panels || []).forEach(p => {                          // panels named in the sheet but not in the catalog are kept
    const tab = p.tab || 'code'
    if (!(panels[tab] || []).some(x => x.key === p.key)) (panels[tab] = panels[tab] || []).push({ key: p.key, label: p.label || p.key, enabled: p.enabled !== false, order: p.order ?? 99 })
  })
  return { header, tabs, panels }
}

export function ScreenConfigButton({ kind, appName, cfg, onSaved }) {
  const [open, setOpen] = useState(false)
  const [d, setD] = useState(null)
  const [sel, setSel] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState('app')
  const [app, setApp] = useState(null)
  const [appMsg, setAppMsg] = useState('')
  const [dev, setDev] = useState(null)
  const [devMsg, setDevMsg] = useState('')
  const base = `/api/${kind}-app/${appName}/screen-config`
  const show = () => {
    const b = build(kind, cfg); setD(b); setSel(b.tabs[0]?.key || ''); setMsg(''); setAppMsg(''); setDevMsg(''); setView('app'); setApp(null); setDev(null); setOpen(true)
    if (kind === 'local') fetch(`/api/local-app/${appName}/devtool-config`).then(r => r.json()).then(r => { if (r.ok && r.rows) setDev(r); else setDevMsg(r.error || 'Could not load') }).catch(() => setDevMsg('Could not reach server'))
    fetch(`/api/${kind}-app/${appName}/application-info`).then(r => r.json()).then(r => { if (r.ok && r.fields) setApp(r); else setAppMsg(r.error || 'Could not load - restart the Workbench') }).catch(() => setAppMsg('Could not reach server'))
  }
  const setDevRow = (i, k, v) => setDev({ ...dev, rows: dev.rows.map((r, j) => j === i ? { ...r, [k]: v } : r) })
  function saveDev() {
    setBusy(true); setDevMsg('')
    fetch(`/api/local-app/${appName}/devtool-config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: dev.rows }) }).then(r => r.json())
      .then(r => { setDevMsg(r.ok ? 'Saved' : r.error || 'Save failed'); if (r.ok) onSaved && onSaved() })
      .catch(() => setDevMsg('Could not reach server')).finally(() => setBusy(false))
  }
  function saveApp() {
    setBusy(true); setAppMsg('')
    fetch(`/api/${kind}-app/${appName}/application-info`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: app.values }) }).then(r => r.json())
      .then(r => { setAppMsg(r.ok ? 'Saved' : r.error || 'Save failed'); if (r.ok) onSaved && onSaved() })
      .catch(() => setAppMsg('Could not reach server')).finally(() => setBusy(false))
  }
  const setTab = (i, patch) => setD({ ...d, tabs: d.tabs.map((t, j) => j === i ? { ...t, ...patch } : t) })
  const moveTab = (i, dir) => { const t = [...d.tabs]; const j = i + dir; if (j < 0 || j >= t.length) return; [t[i], t[j]] = [t[j], t[i]]; setD({ ...d, tabs: t }) }
  const setPanel = (tab, i, patch) => setD({ ...d, panels: { ...d.panels, [tab]: d.panels[tab].map((p, j) => j === i ? { ...p, ...patch } : p) } })
  const movePanel = (tab, i, dir) => { const l = [...d.panels[tab]]; const j = i + dir; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; setD({ ...d, panels: { ...d.panels, [tab]: l } }) }
  function reset() { const b = build(kind, { tabs: [], panels: [], header: {} }); setD({ ...b, tabs: b.tabs.map((t, i) => ({ ...t })) }); setMsg('Defaults loaded - press Save to apply') }
  function save() {
    setBusy(true)
    const body = {
      header: Object.fromEntries(Object.values(d.header).map((h, i) => [h.key, { label: h.label, enabled: h.enabled, order: i + 1 }])),
      tabs: d.tabs.map((t, i) => ({ key: t.key, label: t.label, enabled: t.enabled !== false, order: i + 1 })),
      panels: Object.entries(d.panels).flatMap(([tab, list]) => list.map((p, i) => ({ key: p.key, label: p.label, enabled: p.enabled, order: i + 1, tab }))),
    }
    fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
      .then(r => { if (r.ok) { setOpen(false); onSaved && onSaved() } else setMsg(r.error || 'Save failed') })
      .catch(() => setMsg('Could not reach server')).finally(() => setBusy(false))
  }
  const curPanels = d?.panels?.[sel] || []
  return (
    <>
      <button onClick={show} title="Configure tabs and panels" aria-label="Configure"
        style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-muted)', padding: '4px 6px', display: 'inline-flex', alignItems: 'center' }}>
        <GearIcon />
      </button>
      {open && d && (
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 50 }}>
          <div className="card" onClick={e => e.stopPropagation()} style={{ width: 'min(900px, 94vw)', maxHeight: '84vh', display: 'flex', flexDirection: 'column', padding: 0, background: 'var(--surface)' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
              <b style={{ fontSize: 15 }}>Configure {appName} ({kind})</b>
              <button style={{ ...btn, marginLeft: 'auto' }} onClick={() => setOpen(false)}>Close</button>
            </div>
            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', padding: '0 16px' }}>
              {[['app', 'Application'], ...(kind === 'local' ? [['devtool', 'DevTool']] : []), ['screen', 'Screen']].map(([k, l]) => (
                <button key={k} onClick={() => setView(k)} style={{ padding: '8px 18px', fontSize: 13, cursor: 'pointer', background: 'none', border: 'none', fontFamily: 'inherit',
                  borderBottom: view === k ? '2px solid var(--primary, #3b82f6)' : '2px solid transparent', color: view === k ? 'var(--primary, #3b82f6)' : 'var(--text-muted)', fontWeight: view === k ? 600 : 400 }}>{l}</button>))}
            </div>
            {view === 'app' && (
              <div style={{ overflow: 'auto', padding: 16 }}>
                {!app ? <div style={{ fontSize: 12 }}>{appMsg || 'Loading...'}</div> : <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10 }}>
                    {app.fields.map(f => (
                      <label key={f.key} style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', gridColumn: f.key === 'description' || f.key === 'repository_url' || f.key === 'repository_path' ? '1 / -1' : undefined }}>{f.label}
                        <input style={{ ...inp, width: '100%', boxSizing: 'border-box', marginTop: 2, padding: '5px 7px' }} value={app.values[f.key] || ''}
                          onChange={e => setApp({ ...app, values: { ...app.values, [f.key]: e.target.value } })} />
                      </label>))}
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button style={btn} onClick={saveApp} disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
                    {kind === 'local' && <button style={btn} onClick={() => setApp({ ...app, values: { ...app.values, ...Object.fromEntries(Object.entries(app.detected || {}).filter(([, v]) => v)) } })}>Fill from local clone</button>}
                    <span style={{ fontSize: 12, color: appMsg === 'Saved' ? '#16a34a' : '#dc2626' }}>{appMsg}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>Saved to {app.file}</span>
                  </div>
                </>}
              </div>
            )}
            {view === 'devtool' && (
              <div style={{ overflow: 'auto', padding: 16 }}>
                {!dev ? <div style={{ fontSize: 12 }}>{devMsg || 'Loading...'}</div> : <>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>{['Section', 'Key', 'Label', 'Command', ''].map(h => <th key={h} style={{ textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', padding: '4px 6px', borderBottom: '2px solid var(--border)' }}>{h}</th>)}</tr></thead>
                    <tbody>{dev.rows.map((r, i) => (
                      <tr key={i}>
                        {['section', 'key', 'label', 'command'].map(c => (
                          <td key={c} style={{ padding: '3px 4px', borderBottom: '1px solid var(--border)', width: c === 'section' ? 100 : undefined }}>
                            <input style={{ ...inp, width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' }} value={r[c] || ''} title={c === 'key' ? dev.known?.[r.key] || '' : ''} onChange={e => setDevRow(i, c, e.target.value)} />
                          </td>))}
                        <td style={{ padding: '3px 4px', borderBottom: '1px solid var(--border)' }}><button style={btn} onClick={() => setDev({ ...dev, rows: dev.rows.filter((_, j) => j !== i) })}>Remove</button></td>
                      </tr>))}</tbody>
                  </table>
                  <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button style={btn} onClick={() => setDev({ ...dev, rows: [...dev.rows, { section: 'app', key: '', label: '', command: '' }] })}>Add row</button>
                    <button style={btn} onClick={saveDev} disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
                    <span style={{ fontSize: 12, color: devMsg === 'Saved' ? '#16a34a' : '#dc2626' }}>{devMsg}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>Saved to {dev.file}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
                    Keys the Workbench uses: <b>env_tool</b> (sets the branch), <b>build_tool</b> (builds), <b>terminal_init</b> (runs when a terminal opens), <b>default_branch_file</b> (holds the current branch), <b>git_pattern</b> (name pattern of the clones).
                  </div>
                </>}
              </div>
            )}
            {view === 'screen' && (
            <div style={{ overflow: 'auto', padding: 16, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 340px', minWidth: 300 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Tabs (top to bottom = left to right)</div>
                {d.tabs.map((t, i) => (
                  <div key={t.key} onClick={() => setSel(t.key)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', marginBottom: 3, borderRadius: 4, cursor: 'pointer',
                    border: '1px solid ' + (sel === t.key ? 'var(--primary, #3b82f6)' : 'var(--border)'), background: sel === t.key ? 'var(--surface2)' : 'transparent' }}>
                    <input type="checkbox" checked={t.enabled !== false} onClick={e => e.stopPropagation()} onChange={e => setTab(i, { enabled: e.target.checked })} title="Show this tab" />
                    <input style={{ ...inp, flex: 1, minWidth: 0 }} value={t.label} onClick={e => e.stopPropagation()} onChange={e => setTab(i, { label: e.target.value })} />
                    <button style={arrow} onClick={e => { e.stopPropagation(); moveTab(i, -1) }} disabled={i === 0}>{'↑'}</button>
                    <button style={arrow} onClick={e => { e.stopPropagation(); moveTab(i, 1) }} disabled={i === d.tabs.length - 1}>{'↓'}</button>
                  </div>))}
                <div style={{ fontWeight: 600, fontSize: 13, margin: '14px 0 6px' }}>Header</div>
                {Object.values(d.header).map(h => (
                  <label key={h.key} style={{ display: 'block', fontSize: 12, padding: '2px 0' }}>
                    <input type="checkbox" checked={h.enabled} onChange={e => setD({ ...d, header: { ...d.header, [h.key]: { ...h, enabled: e.target.checked } } })} /> {h.label}
                  </label>))}
              </div>
              <div style={{ flex: '1 1 340px', minWidth: 300 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Panels in {d.tabs.find(t => t.key === sel)?.label || sel}</div>
                {curPanels.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>This tab has no panels that can be switched on or off.</div>}
                {curPanels.map((p, i) => (
                  <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', marginBottom: 3, border: '1px solid var(--border)', borderRadius: 4 }}>
                    <input type="checkbox" checked={p.enabled} onChange={e => setPanel(sel, i, { enabled: e.target.checked })} title="Show this panel" />
                    <input style={{ ...inp, flex: 1, minWidth: 0 }} value={p.label} onChange={e => setPanel(sel, i, { label: e.target.value })} />
                    <button style={arrow} onClick={() => movePanel(sel, i, -1)} disabled={i === 0}>{'↑'}</button>
                    <button style={arrow} onClick={() => movePanel(sel, i, 1)} disabled={i === curPanels.length - 1}>{'↓'}</button>
                  </div>))}
              </div>
            </div>
            )}
            {view === 'screen' && (
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <button style={btn} onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
              <button style={btn} onClick={reset}>Reset to defaults</button>
              <span style={{ fontSize: 12, color: msg.startsWith('Defaults') ? 'var(--text-muted)' : '#dc2626' }}>{msg}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>Saved to screen_config.xlsx of this application</span>
            </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
