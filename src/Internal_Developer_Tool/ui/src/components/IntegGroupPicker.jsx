// INTEG_TEST_GROUP checklist for a test group category. Every group starts checked;
// unchecked ones are remembered per category in integSettings.excluded.
export function selectedIntegGroups(groups, excluded) {
  return (groups || []).filter(g => !(excluded || []).includes(g))
}

export default function IntegGroupPicker({ groups, excluded, onChange, disabled }) {
  const ex = excluded || []
  const all = groups || []
  const toggle = g => onChange(ex.includes(g) ? ex.filter(x => x !== g) : [...ex, g])
  const checkedCount = all.filter(g => !ex.includes(g)).length

  return (
    <div className="form-group" style={{ marginBottom: 10, opacity: disabled ? 0.5 : 1 }}>
      <label className="field-label" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>INTEG_TEST_GROUP <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({checkedCount}/{all.length} selected)</span></span>
        {all.length > 0 && !disabled && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <a href="#all" onClick={e => { e.preventDefault(); onChange([]) }} style={{ fontSize: 11 }}>All</a>
            <a href="#none" onClick={e => { e.preventDefault(); onChange([...all]) }} style={{ fontSize: 11 }}>None</a>
          </span>
        )}
      </label>
      {all.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No groups configured for this category.</div>
      ) : (
        <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', padding: '4px 8px' }}>
          {all.map(g => (
            <label key={g} title={g} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: 'monospace', padding: '2px 0', cursor: disabled ? 'default' : 'pointer' }}>
              <input type="checkbox" checked={!ex.includes(g)} disabled={disabled} onChange={() => toggle(g)} />
              <span style={{ wordBreak: 'break-all' }}>{g}</span>
            </label>
          ))}
        </div>
      )}
      {disabled && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Custom Test Groups below override the category.</div>}
    </div>
  )
}
