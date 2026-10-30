import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

// Stages that need Release Branch Version / BC prefix / DU prefix
const PAYOR_STAGES     = new Set(['baseline', 'jreg', 'puc_baseline', 'puc'])
// Stages that need a Remote VM selection
const REMOTE_VM_STAGES  = new Set(['remote_setup', 'melissa_update', 'melissa_gp_payor', 'melissa_gp_classic', 'rpb'])
// Stages that expose GP run options (auto merge, sonar, integration test)
const GP_CLONE_STAGES   = new Set(['clone_pr_gp'])
// Stages that need a separate Melissa Data JIRA ticket
const MELISSA_GP_STAGES = new Set(['melissa_update', 'melissa_gp_payor', 'melissa_gp_classic'])

export default function NewWorkflow() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const init      = location.state || {}

  const [stages,        setStages]        = useState([])
  const [vms,           setVms]           = useState([])
  const [selected,      setSelected]      = useState({})
  const [ticket,        setTicket]        = useState(init.ticket       || '')
  const [releaseBranch, setReleaseBranch] = useState(init.payorVersion || '')  // e.g. 26.2.1.0.1
  const [payorVersion,  setPayorVersion]  = useState('')   // fetched from pom.xml
  const [pomLoading,    setPomLoading]    = useState(false)
  const [pomError,      setPomError]      = useState('')
  const [bcPrefix,      setBcPrefix]      = useState('')
  const [duPrefix,      setDuPrefix]      = useState('')
  const [remoteVm,      setRemoteVm]      = useState('')
  const [retryCount,    setRetryCount]    = useState(2)
  const [melissaTicket, setMelissaTicket] = useState('')
  const [gpAutoMerge,   setGpAutoMerge]   = useState(true)
  const [gpRunSonar,    setGpRunSonar]    = useState(true)
  const [gpRunIntegTest,setGpRunIntegTest]= useState(true)
  const [submitting,    setSubmitting]    = useState(false)
  const [error,         setError]         = useState('')
  const [templates,          setTemplates]          = useState([])
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [showSaveTemplate,   setShowSaveTemplate]   = useState(false)
  const [saveTemplateName,   setSaveTemplateName]   = useState('')
  const pomTimerRef = useRef(null)

  useEffect(() => {
    fetch('/api/stages').then(r => r.json()).then(setStages)
    fetch('/api/vms').then(r => r.json()).then(data => setVms(Array.isArray(data) ? data : []))
    fetch('/api/clone-workflow/templates')
      .then(r => r.json())
      .then(d => { if (d.ok) setTemplates(d.templates || []) })
      .catch(() => {})
  }, [])

  // When navigated from Sprint (Clone - Bug), pre-tick all stages
  useEffect(() => {
    if (stages.length === 0 || !init.ticket) return
    const all = {}
    stages.forEach(s => { all[s.id] = true })
    setSelected(all)
  }, [stages])

  // Auto-select VM owned by Anmol when VMs load
  useEffect(() => {
    if (vms.length === 0 || remoteVm) return
    const anmolVm = vms.find(vm => (vm.assigned_to || '').toLowerCase() === 'anmol')
    if (anmolVm) setRemoteVm(anmolVm.name)
  }, [vms])

  // Fetch Payor Release Version from pom.xml on the release branch, plus BC/DU hints
  useEffect(() => {
    const branch = releaseBranch.trim()
    if (!branch || !/^\d+\.\d+/.test(branch.replace(/^release[-/]/i, ''))) {
      setPayorVersion('')
      setPomError('')
      setBcPrefix('')
      setDuPrefix('')
      return
    }
    clearTimeout(pomTimerRef.current)
    setPomLoading(true)
    setPomError('')
    pomTimerRef.current = setTimeout(() => {
      fetch(`/api/clone-workflow/pom-version?branch=${encodeURIComponent(branch)}`)
        .then(r => r.json())
        .then(d => {
          setPomLoading(false)
          if (d.ok) {
            setPayorVersion(d.payor_release_version || '')
            const hints = d.hints || {}
            if (hints.bluecard_config_version_prefix) setBcPrefix(prev => prev || hints.bluecard_config_version_prefix)
            if (hints.datauniverse_version_prefix)    setDuPrefix(prev => prev || hints.datauniverse_version_prefix)
          } else {
            setPayorVersion('')
            setPomError(d.error || 'Could not read pom.xml')
          }
        })
        .catch(() => { setPomLoading(false); setPomError('Request failed') })
    }, 800)
    return () => { clearTimeout(pomTimerRef.current); setPomLoading(false) }
  }, [releaseBranch])

  const toggle = (id) => setSelected(s => ({ ...s, [id]: !s[id] }))

  const loadTemplates = () => {
    fetch('/api/clone-workflow/templates')
      .then(r => r.json())
      .then(d => { if (d.ok) setTemplates(d.templates || []) })
      .catch(() => {})
  }

  const applyTemplate = (tpl) => {
    if (tpl.ticket)         setTicket(tpl.ticket)
    if (tpl.release_branch) setReleaseBranch(tpl.release_branch)
    if (tpl.retry_count !== undefined && tpl.retry_count !== '')
      setRetryCount(Math.max(0, Math.min(10, Number(tpl.retry_count) || 0)))
    try {
      const ex = JSON.parse(tpl.extra_json || '{}')
      if (ex.bc_prefix !== undefined)   setBcPrefix(ex.bc_prefix || '')
      if (ex.du_prefix !== undefined)   setDuPrefix(ex.du_prefix || '')
      if (ex.remote_vm !== undefined)   setRemoteVm(ex.remote_vm || '')
      if (ex.melissa_ticket !== undefined) setMelissaTicket(ex.melissa_ticket || '')
      if (ex.gp_auto_merge !== undefined)  setGpAutoMerge(ex.gp_auto_merge === true || ex.gp_auto_merge === 'true')
      if (ex.gp_run_sonar !== undefined)   setGpRunSonar(ex.gp_run_sonar === true || ex.gp_run_sonar === 'true')
      if (ex.gp_run_integration_test !== undefined)
        setGpRunIntegTest(ex.gp_run_integration_test === true || ex.gp_run_integration_test === 'true')
      if (ex.selected_stages && typeof ex.selected_stages === 'object') {
        setSelected(ex.selected_stages)
      }
    } catch {}
    setShowTemplatePicker(false)
  }

  const saveTemplate = async () => {
    const name = saveTemplateName.trim()
    if (!name) return
    const extra = {
      bc_prefix:              bcPrefix,
      du_prefix:              duPrefix,
      remote_vm:              remoteVm,
      melissa_ticket:         melissaTicket,
      gp_auto_merge:          gpAutoMerge,
      gp_run_sonar:           gpRunSonar,
      gp_run_integration_test: gpRunIntegTest,
      selected_stages:        selected,
    }
    const r = await fetch('/api/clone-workflow/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_name:  name,
        ticket:         ticket,
        release_branch: releaseBranch,
        retry_count:    String(retryCount),
        extra,
      }),
    }).catch(() => null)
    if (r && r.ok) {
      setSaveTemplateName('')
      setShowSaveTemplate(false)
      loadTemplates()
    }
  }

  const deleteTemplate = async (name) => {
    await fetch(`/api/clone-workflow/templates/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {})
    loadTemplates()
  }

  const selectedIds = stages.filter(s => selected[s.id]).map(s => s.id)

  const needsPayor       = selectedIds.some(id => PAYOR_STAGES.has(id))
  const needsRemoteVm    = selectedIds.some(id => REMOTE_VM_STAGES.has(id))
  const needsGpOpts      = selectedIds.some(id => GP_CLONE_STAGES.has(id))
  const needsMelissaTicket = selectedIds.some(id => MELISSA_GP_STAGES.has(id))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!ticket.trim())               { setError('JIRA ticket is required.'); return }
    if (selectedIds.length === 0)     { setError('Select at least one stage.'); return }
    if (needsPayor && !releaseBranch.trim()) {
      setError('Release Branch Version is required for Baseline Creation / Jenkins Regression.')
      return
    }
    if (needsRemoteVm && !remoteVm) {
      setError('Remote VM is required for the selected stage(s).')
      return
    }
    if (needsMelissaTicket && !melissaTicket.trim()) {
      setError('Melissa Data JIRA Ticket is required when Melissa stages are included.')
      return
    }
    setSubmitting(true)
    try {
      const extra = {}
      if (needsMelissaTicket && melissaTicket.trim()) extra.melissa_ticket = melissaTicket.trim()
      if (needsRemoteVm && remoteVm)    extra.remote_vm      = remoteVm
      if (releaseBranch.trim())         extra.release_branch = releaseBranch.trim()
      extra.retry_count = Math.max(0, Number(retryCount) || 0)
      if (needsGpOpts) {
        extra.gp_auto_merge           = gpAutoMerge    ? 'yes' : 'no'
        extra.gp_run_sonar            = gpRunSonar     ? 'yes' : 'no'
        extra.gp_run_integration_test = gpRunIntegTest ? 'yes' : 'no'
      }
      const resp = await fetch('/api/projects', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          ticket:        ticket.trim(),
          payor_version: payorVersion.trim(),
          bluecard_config_version_prefix: bcPrefix.trim(),
          datauniverse_version_prefix:    duPrefix.trim(),
          extra_params: extra,
          stage_ids:    selectedIds,
        }),
      })
      if (resp.ok) {
        const { pid } = await resp.json()
        navigate(`/projects/${pid}`)
      } else {
        setError('Failed to create project. Check server logs.')
      }
    } catch {
      setError('Server unreachable.')
    }
    setSubmitting(false)
  }

  // Build the params row columns dynamically based on selection
  // Always: JIRA Ticket
  // Conditional: Release Branch + derived Payor version (when baseline/jreg selected), Remote VM
  const paramCols = [
    { key: 'ticket',   always: true },
    { key: 'melissa',  always: false, show: needsMelissaTicket },
    { key: 'payor',    always: false, show: needsPayor },
    { key: 'bc',       always: false, show: needsPayor },
    { key: 'du',       always: false, show: needsPayor },
    { key: 'rvm',      always: false, show: needsRemoteVm },
  ].filter(c => c.always || c.show)

  const gridCols = Math.min(4, paramCols.length)

  return (
    <div>
      <button className="btn back-link" onClick={() => navigate('/clone-projects')}>← Back</button>
      <h1 className="page-title" style={{ marginBottom: 16 }}>New Clone Workflow</h1>

      {/* Template bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: showTemplatePicker || showSaveTemplate ? 8 : 0 }}>
          <button type="button"
            onClick={() => { setShowTemplatePicker(v => !v); setShowSaveTemplate(false) }}
            style={{ fontSize: 12, padding: '3px 10px', border: '1px solid var(--border)',
                     borderRadius: 4, background: 'var(--bg-subtle)', cursor: 'pointer', color: 'var(--text)' }}>
            📋 Templates{templates.length > 0 ? ` (${templates.length})` : ''}
          </button>
          <button type="button"
            onClick={() => { setShowSaveTemplate(v => !v); setShowTemplatePicker(false) }}
            style={{ fontSize: 12, padding: '3px 10px', border: '1px solid var(--border)',
                     borderRadius: 4, background: 'var(--bg-subtle)', cursor: 'pointer', color: 'var(--text)' }}>
            💾 Save as Template
          </button>
        </div>

        {showTemplatePicker && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 4,
                        background: 'var(--bg)', maxHeight: 220, overflowY: 'auto' }}>
            {templates.length === 0 ? (
              <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: 12 }}>
                No templates saved yet.
              </div>
            ) : templates.map(tpl => (
              <div key={tpl.template_name}
                   style={{ display: 'flex', alignItems: 'center', padding: '6px 10px',
                            borderBottom: '1px solid var(--border)', gap: 8 }}>
                <button type="button"
                  onClick={() => applyTemplate(tpl)}
                  style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none',
                           cursor: 'pointer', fontSize: 13, color: 'var(--text)', padding: 0 }}>
                  <span style={{ fontWeight: 600 }}>{tpl.template_name}</span>
                  {tpl.ticket && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>{tpl.ticket}</span>
                  )}
                  {tpl.release_branch && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {tpl.release_branch}
                    </span>
                  )}
                </button>
                <button type="button"
                  onClick={() => deleteTemplate(tpl.template_name)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                           color: 'var(--text-muted)', fontSize: 14, padding: '0 4px', lineHeight: 1 }}
                  title="Delete template">✕</button>
              </div>
            ))}
          </div>
        )}

        {showSaveTemplate && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="text"
              placeholder='Template name (e.g. "Standard Payor Release")'
              value={saveTemplateName}
              onChange={e => setSaveTemplateName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveTemplate()}
              style={{ flex: 1, fontSize: 13, padding: '4px 8px', border: '1px solid var(--border)',
                       borderRadius: 4, background: 'var(--bg)', color: 'var(--text)' }}
            />
            <button type="button" onClick={saveTemplate}
              style={{ fontSize: 12, padding: '4px 12px', borderRadius: 4,
                       background: 'var(--primary)', color: '#fff', border: 'none', cursor: 'pointer' }}>
              Save
            </button>
            <button type="button" onClick={() => { setShowSaveTemplate(false); setSaveTemplateName('') }}
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, background: 'none',
                       border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text)' }}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        {/* Parameters */}
        <div className="card">
          <div className="form-section-title">Parameters</div>

          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridCols}, 1fr)`, gap: '0 16px' }}>
            {/* JIRA Ticket — always */}
            <div className="form-group">
              <label className="field-label">JIRA Ticket <span style={{ color: 'var(--danger)' }}>*</span></label>
              <input
                type="text"
                value={ticket}
                onChange={e => setTicket(e.target.value)}
                placeholder="e.g. PAYOR-12345"
              />
            </div>

            {/* Melissa Data JIRA Ticket — when melissa stages selected */}
            {needsMelissaTicket && (
              <div className="form-group">
                <label className="field-label">
                  Melissa Data JIRA Ticket <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="text"
                  value={melissaTicket}
                  onChange={e => setMelissaTicket(e.target.value)}
                  placeholder="e.g. PAYOR-210066"
                />
                <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                  Ticket for Melissa Data Update + GP PRs (Payor &amp; Classic)
                </div>
              </div>
            )}

            {/* Release Branch Version + derived Payor Release Version */}
            {needsPayor && (
              <div className="form-group">
                <label className="field-label">
                  Release Branch Version
                  <span style={{ color: 'var(--danger)' }}> *</span>
                </label>
                <input
                  type="text"
                  value={releaseBranch}
                  onChange={e => setReleaseBranch(e.target.value)}
                  placeholder="e.g. 26.2.1.0.1"
                />
                {pomLoading && (
                  <div style={{ marginTop: 5, fontSize: 11, color: 'var(--text-muted)' }}>
                    Fetching Payor Release Version…
                  </div>
                )}
                {!pomLoading && payorVersion && (
                  <div style={{ marginTop: 5, fontSize: 11, color: 'var(--text-muted)' }}>
                    Payor Release Version:&nbsp;
                    <span style={{ fontFamily: 'Consolas, monospace', fontWeight: 600, color: 'var(--primary)' }}>
                      {payorVersion}
                    </span>
                  </div>
                )}
                {!pomLoading && pomError && (
                  <div style={{ marginTop: 5, fontSize: 11, color: 'var(--danger, #ef4444)' }}>
                    ⚠ {pomError}
                  </div>
                )}
              </div>
            )}

            {needsPayor && (
              <div className="form-group">
                <label className="field-label" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                  BLUECARD_CONFIG_VERSION_PREFIX
                  <span style={{ fontFamily: 'inherit', color: 'var(--text-muted)', fontWeight: 400 }}> (opt)</span>
                </label>
                <input
                  type="text"
                  value={bcPrefix}
                  onChange={e => setBcPrefix(e.target.value)}
                  placeholder="staging:26.2.1-"
                  style={{ fontFamily: 'monospace', fontSize: 13 }}
                />
              </div>
            )}

            {needsPayor && (
              <div className="form-group">
                <label className="field-label" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                  DATAUNIVERSE_VERSION_PREFIX
                  <span style={{ fontFamily: 'inherit', color: 'var(--text-muted)', fontWeight: 400 }}> (opt)</span>
                </label>
                <input
                  type="text"
                  value={duPrefix}
                  onChange={e => setDuPrefix(e.target.value)}
                  placeholder="staging:26.2.1.0-"
                  style={{ fontFamily: 'monospace', fontSize: 13 }}
                />
              </div>
            )}

            {/* Remote VM — when any remote-vm stage selected */}
            {needsRemoteVm && (
              <div className="form-group">
                <label className="field-label">
                  Remote VM <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <select value={remoteVm} onChange={e => setRemoteVm(e.target.value)}>
                  <option value="">— Select VM —</option>
                  {vms.map(vm => (
                    <option key={vm.name} value={vm.name}>
                      {vm.name}{vm.ip ? ` (${vm.ip})` : ''}{vm.assigned_to ? ` — ${vm.assigned_to}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Retry Count — always visible */}
          <div style={{ marginTop: 14, maxWidth: 180 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="field-label">
                Auto-Retry Count
                <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11, marginLeft: 6 }}>
                  (per failed stage)
                </span>
              </label>
              <input
                type="number"
                min={0}
                max={10}
                value={retryCount}
                onChange={e => setRetryCount(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
                style={{ width: 80 }}
              />
            </div>
          </div>

        </div>

        {/* GP - Clone PR options (shown when clone_pr_gp stage is selected) */}
        {needsGpOpts && (
          <div className="card">
            <div className="form-section-title">GP — Clone PR Options</div>
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
              {[
                { label: 'Auto Merge',       value: gpAutoMerge,    set: setGpAutoMerge    },
                { label: 'Run Sonar',        value: gpRunSonar,     set: setGpRunSonar     },
                { label: 'Integration Test', value: gpRunIntegTest, set: setGpRunIntegTest },
              ].map(f => (
                <label key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                  <input type="checkbox" checked={f.value}
                    onChange={e => f.set(e.target.checked)}
                    style={{ width: 16, height: 16, cursor: 'pointer' }} />
                  {f.label}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Stage selection */}
        <div className="card">
          <div className="form-section-title">
            Select Stages
            {selectedIds.length > 0 && (
              <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}>
                {selectedIds.length} selected
              </span>
            )}
          </div>

          {stages.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading stages…</div>
          ) : (
            <div className="stage-grid">
              {stages.map(s => (
                <label
                  key={s.id}
                  className={`stage-item${selected[s.id] ? ' checked' : ''}`}
                  onClick={() => toggle(s.id)}
                >
                  <input type="checkbox" checked={!!selected[s.id]} onChange={() => {}} />
                  <div>
                    <div className="stage-label">{s.label}</div>
                    <div className="stage-tool">{s.tool}</div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex-gap">
          <button type="submit" className="btn btn-primary" disabled={submitting || stages.length === 0}>
            {submitting ? 'Creating…' : 'Create Workflow'}
          </button>
          <button type="button" className="btn" onClick={() => navigate('/clone-projects')}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
