export default function AccountPage() {
  return (
    <div>
      <h1 className="page-title" style={{ marginBottom: 28 }}>Account</h1>
      <div className="card" style={{ maxWidth: 440 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 24 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--primary)', color: '#0d1117',
            fontSize: 22, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>A</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Anmol</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Developer</div>
          </div>
        </div>
        <div className="meta">
          <div className="meta-item">
            <div className="meta-label">Platform</div>
            <div className="meta-value">Developer WorkBench</div>
          </div>
          <div className="meta-item">
            <div className="meta-label">Role</div>
            <div className="meta-value">Developer</div>
          </div>
        </div>
      </div>
    </div>
  )
}
