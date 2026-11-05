import { useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

const API = '/api/tools/copilot-review'

function parsePrUrl(raw) {
  try {
    const m = raw.trim().match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
    if (m) return { owner: m[1], repo: m[2], pr: m[3] }
  } catch {}
  return null
}

const SEV_RE = /\*\*(critical|high|medium|low|warning|error|note|suggestion)\*\*/i

function severityFromBody(body) {
  const m = body.match(SEV_RE)
  return m ? m[1].toUpperCase() : null
}

const SEV_COLOR = {
  CRITICAL:   { bg: '#B71C1C', color: '#fff' },
  HIGH:       { bg: '#C62828', color: '#fff' },
  ERROR:      { bg: '#C62828', color: '#fff' },
  MEDIUM:     { bg: '#E65100', color: '#fff' },
  WARNING:    { bg: '#F57F17', color: '#fff' },
  LOW:        { bg: '#2E7D32', color: '#fff' },
  NOTE:       { bg: '#546E7A', color: '#fff' },
  SUGGESTION: { bg: '#1565C0', color: '#fff' },
}

function SevBadge({ body }) {
  const sev = severityFromBody(body)
  if (!sev) return null
  const s = SEV_COLOR[sev] || { bg: '#546E7A', color: '#fff' }
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
      background: s.bg, color: s.color, marginRight: 6, flexShrink: 0 }}>
      {sev}
    </span>
  )
}

function CommentBody({ body }) {
  const parts = body.split(/```([\s\S]*?)```/)
  return (
    <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>
      {parts.map((p, i) =>
        i % 2 === 1
          ? <pre key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 4, padding: '8px 10px', fontSize: 12, overflowX: 'auto',
              margin: '6px 0', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{p.trim()}</pre>
          : <span key={i}>{p}</span>
      )}
    </div>
  )
}

// ── Rich Copilot Review Body renderer ─────────────────────────────────────────

function SevChip({ level }) {
  const conf = {
    Critical: { bg: '#6A0000' }, High: { bg: '#B71C1C' },
    Medium:   { bg: '#BF360C' }, Low:  { bg: '#1B5E20' },
  }[level] || { bg: '#37474F' }
  return (
    <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 700,
      padding: '1px 7px', borderRadius: 8, background: conf.bg, color: '#fff',
      verticalAlign: 'middle', whiteSpace: 'nowrap', margin: '0 2px' }}>{level}</span>
  )
}

function renderInline(text) {
  const parts = []
  let rem = String(text), k = 0
  while (rem.length > 0) {
    const cands = [
      { type: 'sev',      re: /\[\[SEV:([^\]]+)\]\]/              },
      { type: 'code',     re: /`([^`\n]+)`/                       },
      { type: 'bold',     re: /\*\*([^*\n]+)\*\*/                 },
      { type: 'mdlink',   re: /\[([^\]\n]+)\]\(([^)\n]+)\)/       },
      { type: 'htmllink', re: /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/ },
    ].map(c => { const mm = rem.match(c.re); return mm ? { type: c.type, match: mm, start: mm.index } : null })
     .filter(Boolean).sort((a, b) => a.start - b.start)
    if (!cands.length) { parts.push(<span key={k++}>{rem}</span>); break }
    const { type, match, start } = cands[0]
    if (start > 0) parts.push(<span key={k++}>{rem.slice(0, start)}</span>)
    if (type === 'sev') {
      parts.push(<SevChip key={k++} level={match[1]} />)
    } else if (type === 'code') {
      parts.push(<code key={k++} style={{ fontSize: 11, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 4px', fontFamily: 'monospace' }}>{match[1]}</code>)
    } else if (type === 'bold') {
      parts.push(<strong key={k++}>{match[1]}</strong>)
    } else if (type === 'mdlink') {
      const isAnchor = match[2].startsWith('#')
      parts.push(<a key={k++} href={isAnchor ? undefined : match[2]}
        target={isAnchor ? undefined : '_blank'} rel="noreferrer"
        style={{ color: 'var(--primary)', textDecoration: isAnchor ? 'none' : 'underline', cursor: isAnchor ? 'default' : 'pointer' }}>{match[1]}</a>)
    } else if (type === 'htmllink') {
      parts.push(<a key={k++} href={match[1]} target="_blank" rel="noreferrer"
        style={{ color: 'var(--primary)', textDecoration: 'underline' }}>{match[2].replace(/<[^>]+>/g, '')}</a>)
    }
    rem = rem.slice(start + match[0].length)
  }
  return parts
}

function processBodyLines(lines) {
  const out = []
  let listItems = [], tableRows = []

  function flushList() {
    if (!listItems.length) return
    out.push(
      <ul key={`l${out.length}`} style={{ margin: '3px 0 6px', padding: 0, listStyle: 'none' }}>
        {listItems.map((item, j) => (
          <li key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginBottom: 3, fontSize: 12, lineHeight: 1.5 }}>
            <span style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 1 }}>•</span>
            <span style={{ flex: 1 }}>{renderInline(item)}</span>
          </li>
        ))}
      </ul>
    )
    listItems = []
  }

  function flushTable() {
    if (!tableRows.length) return
    const rows = tableRows.filter(r => !r.every(c => /^[-:\s]+$/.test(c)))
    if (rows.length) out.push(
      <div key={`t${out.length}`} style={{ overflowX: 'auto', margin: '6px 0' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
          <thead>
            <tr>{rows[0].map((c, j) => (
              <th key={j} style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontWeight: 600 }}>{renderInline(c.trim())}</th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.slice(1).map((row, ri) => (
              <tr key={ri} style={{ borderBottom: '1px solid var(--border)' }}>
                {row.map((c, j) => <td key={j} style={{ padding: '4px 8px', verticalAlign: 'top' }}>{renderInline(c.trim())}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
    tableRows = []
  }

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()

    if (t.startsWith('|') && t.endsWith('|')) {
      flushList()
      tableRows.push(t.slice(1, -1).split('|'))
      continue
    } else flushTable()

    // Skip the always-redundant top-level heading
    if (/^##\s+Copilot review overview/i.test(t)) continue

    const h2 = t.match(/^##\s+(.+)/)
    if (h2) { flushList(); out.push(<div key={`h2${i}`} style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: '8px 0 3px' }}>{renderInline(h2[1])}</div>); continue }
    const h3 = t.match(/^###\s+(.+)/)
    if (h3) { flushList(); out.push(<div key={`h3${i}`} style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', margin: '6px 0 2px' }}>{renderInline(h3[1])}</div>); continue }
    if (t === '---') { flushList(); out.push(<hr key={`hr${i}`} style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '8px 0' }} />); continue }

    if (t.startsWith('- ')) { listItems.push(t.slice(2)); continue }
    else flushList()

    if (t.startsWith('💡')) {
      out.push(<div key={`tip${i}`} style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>💡 {renderInline(t.slice(1).trim())}</div>)
      continue
    }

    if (t === '') { out.push(<div key={`sp${i}`} style={{ height: 3 }} />); continue }

    out.push(<div key={`ln${i}`} style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text)' }}>{renderInline(t)}</div>)
  }
  flushList(); flushTable()
  return out
}

function DetailsBlock({ summaryHtml, content, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen)
  const summaryText = summaryHtml.replace(/<strong>(.*?)<\/strong>/gi, '$1').replace(/<[^>]+>/g, '').trim()
  return (
    <div style={{ marginTop: 6 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0',
          background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)' }}>{summaryText}</span>
      </button>
      {open && (
        <div style={{ paddingLeft: 12, marginTop: 2, borderLeft: '2px solid var(--border)' }}>
          {processBodyLines(content.split('\n'))}
        </div>
      )}
    </div>
  )
}

function CopilotReviewBody({ body }) {
  if (!body) return null
  let src = body.replace(/<!--[\s\S]*?-->/g, '').trim()
  src = src.replace(/<picture>[\s\S]*?<\/picture>/gi, mp => {
    const lm = (mp.match(/alt="([^"]+)"/i)?.[1] || '').match(/(Critical|High|Medium|Low)/i)
    return lm ? `[[SEV:${lm[1]}]]` : ''
  })
  const segments = []
  const re = /<details([^>]*)>([\s\S]*?)<\/details>/gi
  let last = 0, dm
  while ((dm = re.exec(src)) !== null) {
    if (dm.index > last) segments.push({ type: 'text', content: src.slice(last, dm.index) })
    const sumM = dm[2].match(/<summary>([\s\S]*?)<\/summary>/)
    segments.push({ type: 'details', defaultOpen: /\bopen\b/i.test(dm[1]),
      summaryHtml: sumM ? sumM[1] : '',
      content: (sumM ? dm[2].slice(sumM.index + sumM[0].length) : dm[2]).trim() })
    last = dm.index + dm[0].length
  }
  if (last < src.length) segments.push({ type: 'text', content: src.slice(last) })
  return (
    <div style={{ fontSize: 12 }}>
      {segments.map((seg, idx) =>
        seg.type === 'details'
          ? <DetailsBlock key={idx} summaryHtml={seg.summaryHtml} content={seg.content} defaultOpen={seg.defaultOpen} />
          : <div key={idx}>{processBodyLines(seg.content.split('\n'))}</div>
      )}
    </div>
  )
}

function FileSection({ file }) {
  const unresolved = file.comments.filter(c => !c.resolved).length
  const allResolved = file.comments.length > 0 && unresolved === 0
  const [open, setOpen] = useState(!allResolved)   // fully resolved files start collapsed
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
          background: 'var(--surface)', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ fontSize: 12 }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600,
          color: 'var(--text)', flex: 1, wordBreak: 'break-all' }}>{file.path}</span>
        {allResolved ? (
          <span style={{ fontSize: 11, fontWeight: 700, color: '#2E7D32', flexShrink: 0 }}>
            ✓ Resolved · {file.comments.length} comment{file.comments.length !== 1 ? 's' : ''}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
            <b style={{ color: '#E65100' }}>{unresolved} unresolved</b>
            {unresolved !== file.comments.length && ` · ${file.comments.length - unresolved} resolved`}
          </span>
        )}
      </button>
      {open && (
        <div>
          {file.comments.map((c, i) => (
            <div key={c.id ?? i} style={{
              padding: '12px 16px',
              opacity: c.resolved ? 0.6 : 1,
              borderTop: '1px solid var(--border)',
              background: i % 2 === 0 ? 'var(--bg)' : 'var(--surface)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                {c.resolved && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                    background: 'rgba(46,125,50,0.12)', color: '#2E7D32', border: '1px solid rgba(46,125,50,0.35)' }}>✓ Resolved</span>
                )}
                <SevBadge body={c.body} />
                {c.author && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>🤖 {c.author.replace(/\[bot\]$/, '')}</span>
                )}
                {c.line && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    Line {c.line}
                  </span>
                )}
                {c.url && (
                  <a href={c.url} target="_blank" rel="noreferrer"
                    style={{ fontSize: 11, color: 'var(--primary)', marginLeft: 'auto' }}>
                    View on GitHub ↗
                  </a>
                )}
              </div>
              <CommentBody body={c.body} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function CoPilotReviewPage() {
  const [searchParams]            = useSearchParams()
  const autoRan                   = useRef(false)
  const [urlInput, setUrlInput]   = useState('')
  const [owner,    setOwner]      = useState('')
  const [repo,     setRepo]       = useState('')
  const [pr,       setPr]         = useState('')
  const [loading,  setLoading]    = useState(false)
  const [result,   setResult]     = useState(null)
  const [error,    setError]      = useState(null)
  const [fileFilter, setFileFilter] = useState('')
  const [deps, setDeps]         = useState(null)    // dependency changes of the PR (right-hand panel)
  const [depsLoading, setDepsLoading] = useState(false)

  const loadDeps = (o, r, p) => {
    setDeps(null); setDepsLoading(true)
    fetch(`${API}/dependencies`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner: o, repo: r, pr: p }) })
      .then(x => x.json()).then(setDeps).catch(e => setDeps({ ok: false, error: String(e) }))
      .finally(() => setDepsLoading(false))
  }

  useEffect(() => {
    if (autoRan.current) return
    const raw = searchParams.get('prUrl')
    if (!raw) return
    const parsed = parsePrUrl(raw)
    if (!parsed) return
    autoRan.current = true
    setOwner(parsed.owner); setRepo(parsed.repo); setPr(parsed.pr)
    setError(null); setResult(null); setLoading(true)
    fetch(`${API}/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: parsed.owner, repo: parsed.repo, pr: parsed.pr }),
    })
      .then(r => r.json())
      .then(d => { if (d.ok) { setResult(d); loadDeps(parsed.owner, parsed.repo, parsed.pr) } else setError(d.error || 'Failed to fetch Copilot review') })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [searchParams])

  function applyUrl() {
    const p = parsePrUrl(urlInput)
    if (!p) { setError('Could not parse GitHub PR URL — paste the full URL (github.com/owner/repo/pull/123)'); return }
    setError(null)
    setOwner(p.owner); setRepo(p.repo); setPr(p.pr)
    setUrlInput('')
  }

  async function fetchReview() {
    if (!owner || !repo || !pr) { setError('Owner, repo and PR number are required'); return }
    setError(null); setResult(null); setLoading(true)
    try {
      const r = await fetch(`${API}/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, repo, pr }),
      })
      const d = await r.json()
      if (d.ok) { setResult(d); loadDeps(owner, repo, pr) }
      else      setError(d.error || 'Failed to fetch Copilot review')
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    width: '100%', fontSize: 13, padding: '8px 10px',
    border: '1px solid var(--border)', borderRadius: 6,
    background: 'var(--bg)', color: 'var(--text)',
    outline: 'none', boxSizing: 'border-box',
  }
  const labelStyle = {
    display: 'block', fontSize: 11, fontWeight: 600,
    color: 'var(--text-muted)', textTransform: 'uppercase',
    letterSpacing: '0.05em', marginBottom: 5,
  }

  const filteredFiles = result?.files?.filter(f =>
    !fileFilter || f.path.toLowerCase().includes(fileFilter.toLowerCase())
  ) ?? []

  return (
    <div style={{ padding: '24px 28px', display: 'flex', gap: 24, alignItems: 'flex-start' }}>
    <div style={{ flex: '1 1 0', minWidth: 0, maxWidth: 860 }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--text)' }}>
          AI PR Review
        </h1>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
          View GitHub Copilot review comments for a Pull Request
        </div>
      </div>

      {/* URL shortcut */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
          Paste PR URL <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}>(optional shortcut)</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applyUrl()}
            placeholder="https://github.com/owner/repo/pull/123"
            style={{ ...inputStyle, flex: 1, fontSize: 12, fontFamily: 'monospace' }}
          />
          <button onClick={applyUrl}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600,
              background: 'var(--primary,#1976d2)', color: '#fff',
              border: 'none', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Apply
          </button>
        </div>
      </div>

      {/* Params */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 16 }}>Parameters</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 140px', gap: 14, marginBottom: 18 }}>
          <div>
            <label style={labelStyle}>Owner</label>
            <input value={owner} onChange={e => setOwner(e.target.value)} placeholder="HealthEdge"
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = 'var(--primary,#1976d2)'}
              onBlur={e  => e.target.style.borderColor = 'var(--border)'} />
          </div>
          <div>
            <label style={labelStyle}>Repository</label>
            <input value={repo} onChange={e => setRepo(e.target.value)} placeholder="payor"
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = 'var(--primary,#1976d2)'}
              onBlur={e  => e.target.style.borderColor = 'var(--border)'} />
          </div>
          <div>
            <label style={labelStyle}>Pull Request #</label>
            <input value={pr} onChange={e => setPr(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchReview()}
              placeholder="1234" style={inputStyle}
              onFocus={e => e.target.style.borderColor = 'var(--primary,#1976d2)'}
              onBlur={e  => e.target.style.borderColor = 'var(--border)'} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={fetchReview} disabled={loading}
            style={{ padding: '9px 24px', fontSize: 13, fontWeight: 700,
              background: loading ? 'var(--surface)' : 'var(--primary,#1976d2)',
              color: loading ? 'var(--text-muted)' : '#fff',
              border: 'none', borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 8 }}>
            {loading && <span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} />}
            {loading ? 'Fetching…' : '🔍  Fetch Copilot Review'}
          </button>
          {!loading && (owner || repo || pr) && (
            <button onClick={() => { setOwner(''); setRepo(''); setPr(''); setResult(null); setError(null) }}
              style={{ fontSize: 12, padding: '6px 12px', background: 'none',
                border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
                color: 'var(--text-muted)' }}>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '12px 16px', background: '#FFEBEE', border: '1px solid #EF9A9A',
          borderRadius: 8, fontSize: 13, color: '#B71C1C', marginBottom: 16 }}>
          ⚠ {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <>
          {/* PR header */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1 }}>
                <a href={result.pr.url} target="_blank" rel="noreferrer"
                  style={{ fontSize: 15, fontWeight: 700, color: 'var(--primary)', textDecoration: 'none' }}>
                  #{result.pr.number} — {result.pr.title}
                </a>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {owner}/{repo} · by {result.pr.author} · {result.pr.state}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--primary)' }}>
                    {result.total_comments}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>inline comments</div>
                  {result.resolved_comments > 0 && <div style={{ fontSize: 11, color: '#2E7D32', fontWeight: 600 }}>✓ {result.resolved_comments} resolved</div>}
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--primary)' }}>
                    {result.total_reviews}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>reviews</div>
                </div>
              </div>
            </div>
          </div>

          {/* No Copilot activity */}
          {result.total_comments === 0 && result.total_reviews === 0 && (
            <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-muted)',
              fontSize: 13, background: 'var(--surface)', borderRadius: 8, marginBottom: 16 }}>
              No GitHub Copilot review activity found on this PR.
            </div>
          )}

          {/* Review summaries */}
          {result.review_summaries?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 18 }}>🤖</span>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>Copilot Review Summary</div>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '1px 8px' }}>
                  {result.review_summaries.length} review{result.review_summaries.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {result.review_summaries.map(r => {
                  const stateKey = r.state || 'COMMENTED'
                  const stateConf = {
                    APPROVED:           { icon: '✅', label: 'Approved',          bg: 'rgba(46,125,50,0.08)',  border: '#4CAF50', badge: '#2E7D32' },
                    CHANGES_REQUESTED:  { icon: '🔴', label: 'Changes Requested', bg: 'rgba(183,28,28,0.07)', border: '#EF5350', badge: '#B71C1C' },
                    DISMISSED:          { icon: '⬜', label: 'Dismissed',         bg: 'var(--surface)',        border: '#90A4AE', badge: '#546E7A' },
                    COMMENTED:          { icon: '💬', label: 'Commented',         bg: 'var(--surface)',        border: '#78909C', badge: '#455A64' },
                  }[stateKey] || { icon: '💬', label: stateKey, bg: 'var(--surface)', border: '#78909C', badge: '#546E7A' }
                  return (
                    <div key={r.id} style={{
                      border: `1px solid var(--border)`,
                      borderLeft: `4px solid ${stateConf.border}`,
                      borderRadius: 8,
                      background: stateConf.bg,
                      overflow: 'hidden',
                    }}>
                      {/* Review header */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: r.body ? '1px solid var(--border)' : 'none' }}>
                        <span style={{ fontSize: 16, lineHeight: 1 }}>{stateConf.icon}</span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: stateConf.badge }}>{stateConf.label}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>GitHub Copilot</span>
                        </div>
                        {r.url && (
                          <a href={r.url} target="_blank" rel="noreferrer"
                            style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none', padding: '3px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)' }}>
                            View on GitHub <span style={{ fontSize: 10 }}>↗</span>
                          </a>
                        )}
                      </div>
                      {/* Review body */}
                      {r.body && (
                        <div style={{ padding: '12px 16px' }}>
                          <CopilotReviewBody body={r.body} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Inline comments by file */}
          {result.files?.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  Inline Comments · {result.files.length} file{result.files.length !== 1 ? 's' : ''}
                </div>
                <input
                  value={fileFilter}
                  onChange={e => setFileFilter(e.target.value)}
                  placeholder="Filter by file path…"
                  style={{ ...inputStyle, width: 260, fontSize: 12, fontFamily: 'monospace' }}
                />
              </div>
              {filteredFiles.map(f => <FileSection key={f.path} file={f} />)}
              {filteredFiles.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>
                  No files match "{fileFilter}"
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>

    {/* Right-hand: dependency changes in the PR */}
    {(result || depsLoading) && (
      <div className="card" style={{ flex: '0 0 380px', position: 'sticky', top: 16, maxHeight: 'calc(100vh - 40px)', overflow: 'auto' }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>📦 Dependency changes</div>
        {depsLoading && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}><span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> Comparing pom.xml / package.json …</div>}
        {deps && !deps.ok && <div style={{ fontSize: 12, color: '#B71C1C' }}>⚠ {deps.error}</div>}
        {deps?.ok && deps.files.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>This PR changes no dependencies (no pom.xml / package.json dependency changes).</div>}
        {deps?.ok && deps.files.length > 0 && (
          <>
            <div style={{ fontSize: 12, marginBottom: 10 }}>
              <span style={{ color: '#2E7D32', fontWeight: 700 }}>+{deps.totals.added} added</span> · <span style={{ color: '#C62828', fontWeight: 700 }}>−{deps.totals.removed} removed</span> · <span style={{ color: '#E65100', fontWeight: 700 }}>{deps.totals.changed} version changed</span>
            </div>
            {deps.files.map(f => (
              <div key={f.file} style={{ marginBottom: 12 }}>
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-all', marginBottom: 4 }}>{f.file}</div>
                {f.added.map(d => <div key={'a' + d.name} style={{ fontSize: 12, padding: '2px 0' }}><span style={{ color: '#2E7D32', fontWeight: 700 }}>+ </span>{d.name} <span style={{ color: 'var(--text-muted)' }}>{d.version || '(managed)'}</span></div>)}
                {f.removed.map(d => <div key={'r' + d.name} style={{ fontSize: 12, padding: '2px 0' }}><span style={{ color: '#C62828', fontWeight: 700 }}>− </span>{d.name} <span style={{ color: 'var(--text-muted)' }}>{d.version || '(managed)'}</span></div>)}
                {f.changed.map(d => <div key={'c' + d.name} style={{ fontSize: 12, padding: '2px 0' }}><span style={{ color: '#E65100', fontWeight: 700 }}>~ </span>{d.name}<div style={{ paddingLeft: 14, color: 'var(--text-muted)' }}>{d.from || '(managed)'} <span style={{ color: 'var(--text)' }}>→</span> <b style={{ color: 'var(--text)' }}>{d.to || '(managed)'}</b></div></div>)}
              </div>
            ))}
          </>
        )}
      </div>
    )}
    </div>
  )
}
