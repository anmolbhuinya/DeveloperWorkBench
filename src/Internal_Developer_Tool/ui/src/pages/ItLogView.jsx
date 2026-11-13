import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { parsePattern, buildTree, recordText, literalKind } from './itLogParse'

// Colour of a log line by importance (highest first)
const LEVELS = [
  [/\bBUILD FAILURE\b|\bFATAL\b|\bSEVERE\b|\bERROR\b|Exception\b|Caused by:|\bFAIL(?:ED|URE)?\b/, '#ff7b72'],
  [/Tests run:.*(?:Failures: [1-9]|Errors: [1-9])/, '#ff7b72'],
  [/\bWARN(?:ING)?\b/, '#e3b341'],
  [/\bBUILD SUCCESS\b|Tests run:/, '#3fb950'],
  [/^\s+at\s|\.\.\. \d+ more/, '#8b949e'],
  [/\bDEBUG\b|\bTRACE\b/, '#6e7681'],
  [/\[INFO\] (?:Running|---|Building)/, '#79c0ff'],
]
const lineColor = t => { for (const [re, c] of LEVELS) if (re.test(t)) return c; return '#c9d1d9' }
const WATCH_COLORS = ['#f0c674', '#7ee787', '#d2a8ff', '#ffa657', '#79c0ff', '#ff9bce']

// highlighted segments: needles = [{ s, mc, color }]
function paint(text, needles) {
  const ranges = []
  const low = text.toLowerCase()
  for (const n of needles) {
    if (!n.s) continue
    const hay = n.mc ? text : low, nd = n.mc ? n.s : n.s.toLowerCase()
    let i = 0
    while ((i = hay.indexOf(nd, i)) >= 0) { ranges.push([i, i + nd.length, n.color, n.bg]); i += nd.length }
  }
  if (!ranges.length) return text
  ranges.sort((a, b) => a[0] - b[0])
  const out = []
  let pos = 0, k = 0
  for (const [a, b, c, bg] of ranges) {
    if (a < pos) continue
    if (a > pos) out.push(text.slice(pos, a))
    out.push(<mark key={k++} style={{ background: bg || c, color: '#0d1117', borderRadius: 2, padding: '0 1px' }}>{text.slice(a, b)}</mark>)
    pos = b
  }
  if (pos < text.length) out.push(text.slice(pos))
  return out
}

const Line = React.memo(function Line({ n, text, needles, state }) {
  return (
    <div id={`itl-${n}`} style={{ display: 'flex', gap: 8, color: lineColor(text), background: state === 2 ? 'rgba(240,198,116,0.35)' : state === 1 ? 'rgba(88,166,255,0.22)' : undefined }}>
      <span style={{ flex: '0 0 46px', textAlign: 'right', color: '#484f58', userSelect: 'none' }}>{n}</span>
      <span style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{needles.length ? paint(text, needles) : (text || ' ')}</span>
    </div>
  )
})

const copyText = async text => {
  try { await navigator.clipboard.writeText(text) }
  catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy') } catch { /* ignore */ } document.body.removeChild(ta) }
}

// One node of a matched tree: the line (or the collapsed XML) with the literal that matched, children indented
function Node({ node, color, depth, goTo, colorOf }) {
  const [open, setOpen] = useState(false)       // XML expanded
  const [kids, setKids] = useState(true)
  const c = colorOf(node.lit) || color
  return (
    <div style={{ marginLeft: depth ? 18 : 0, borderLeft: depth ? '1px dashed #30363d' : 'none', paddingLeft: depth ? 8 : 0 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: '2px 0' }}>
        <span onClick={() => node.children.length && setKids(k => !k)} style={{ width: 12, color: '#8b949e', cursor: node.children.length ? 'pointer' : 'default', userSelect: 'none' }}>{node.children.length ? (kids ? '▾' : '▸') : ''}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#0d1117', background: c, borderRadius: 8, padding: '0 7px', whiteSpace: 'nowrap', marginTop: 1 }}>{node.lit}</span>
        <span style={{ color: '#6e7681', minWidth: 34, textAlign: 'right' }} title={node.xml ? `lines ${node.line}–${node.endLine}` : `line ${node.line}`}>{node.line}</span>
        {node.xml ? (
          <span style={{ flex: 1, minWidth: 0 }}>
            <span onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer', color: '#79c0ff', fontFamily: 'monospace' }} title="Click to show the whole structure">
              {open ? '▾ ' : '▸ '}&lt;{node.tag}&gt;…{node.closed ? `</${node.tag}>` : ' (not closed yet)'} <span style={{ color: '#6e7681' }}>· lines {node.line}–{node.endLine}</span>
            </span>
            {open && (
              <pre style={{ margin: '4px 0', padding: 8, background: '#161b22', border: '1px solid #30363d', borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 260, overflow: 'auto', color: '#c9d1d9' }}>{node.xml}</pre>
            )}
          </span>
        ) : <span style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word', minWidth: 0 }}>{node.text}</span>}
        <button onClick={() => goTo(node.line)} title="Show this place in the log" style={{ background: 'none', border: 'none', color: '#58a6ff', cursor: 'pointer', fontSize: 12 }}>↗ log</button>
        <button onClick={() => copyText(node.xml || node.text)} title="Copy" style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 12 }}>⧉</button>
      </div>
      {kids && node.children.map((ch, i) => <Node key={i} node={ch} color={color} depth={depth + 1} goTo={goTo} colorOf={colorOf} />)}
    </div>
  )
}

export default function ItLogView({ text, running, watches, saveWatches, btn, termRef }) {
  const [tab, setTab] = useState('log')
  const [sq, setSq] = useState('')                 // log search
  const [sCase, setSCase] = useState(false)
  const [cur, setCur] = useState(0)                // index into the search hits
  const [flash, setFlash] = useState(0)            // line flashed after "↗ log"
  const [wText, setWText] = useState('')
  const [wCase, setWCase] = useState(false)
  const follow = useRef(true)
  const own = useRef(null)
  const box = termRef || own

  const lines = useMemo(() => (text || '').split('\n'), [text])
  const hits = useMemo(() => {
    const q = sq.trim()
    if (!q) return []
    const nd = sCase ? q : q.toLowerCase()
    const r = []
    lines.forEach((l, i) => { if ((sCase ? l : l.toLowerCase()).includes(nd)) r.push(i + 1) })
    return r
  }, [lines, sq, sCase])
  useEffect(() => { setCur(0) }, [sq, sCase])

  // literals of the watched patterns, painted in the log with one colour per watch
  const parsed = useMemo(() => watches.map((w, i) => ({ w, levels: parsePattern(w.text), color: WATCH_COLORS[i % WATCH_COLORS.length] })), [watches])
  const colorOfLit = useMemo(() => { const m = {}; parsed.forEach(p => p.levels.forEach(l => l.forEach(x => { m[x] = p.color }))); return lit => m[lit] }, [parsed])
  const needles = useMemo(() => {
    const out = []
    parsed.forEach(p => p.levels.forEach(l => l.forEach(lit => { if (literalKind(lit) !== 'xml') out.push({ s: lit, mc: p.w.matchCase, color: p.color }) })))
    if (sq.trim()) out.push({ s: sq.trim(), mc: sCase, color: '#ffa657', bg: '#ffa657' })
    return out
  }, [parsed, sq, sCase])

  const trees = useMemo(() => parsed.map(p => ({ ...p, records: buildTree(text || '', p.levels, p.w.matchCase) })), [parsed, text])
  const totalRecords = trees.reduce((n, t) => n + t.records.length, 0)

  // follow the end of the log while it grows, unless the user scrolled up / jumped somewhere
  useEffect(() => { if (tab === 'log' && follow.current && box.current) box.current.scrollTop = box.current.scrollHeight }, [lines, tab])
  const onScroll = () => { const el = box.current; if (el) follow.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 30 }
  const goTo = useCallback(n => {
    follow.current = false
    setTab('log'); setFlash(n)
    setTimeout(() => { document.getElementById(`itl-${n}`)?.scrollIntoView({ block: 'center' }) }, 60)
    setTimeout(() => setFlash(f => (f === n ? 0 : f)), 2800)
  }, [])
  const step = d => {
    if (!hits.length) return
    const i = (cur + d + hits.length) % hits.length
    setCur(i); goTo(hits[i])
  }
  const addWatch = () => {
    const t = wText.trim()
    if (!t) return
    if (!watches.some(w => w.text === t && w.matchCase === wCase)) saveWatches([...watches, { id: Date.now(), text: t, matchCase: wCase }])
    setWText('')
  }
  const field = { fontSize: 12, padding: '4px 8px', background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6 }

  return (
    <>
      <div style={{ display: 'flex', background: 'var(--surface2)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        {[['log', 'Log'], ['watch', `Watched strings${watches.length ? ` (${totalRecords} match${totalRecords === 1 ? '' : 'es'})` : ''}`]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ padding: '6px 16px', fontSize: 12, cursor: 'pointer', background: 'none', border: 'none', fontWeight: tab === k ? 700 : 500,
            color: tab === k ? 'var(--primary, #1565c0)' : 'var(--text-muted)', borderBottom: tab === k ? '2px solid var(--primary, #1565c0)' : '2px solid transparent', marginBottom: -1 }}>{l}</button>
        ))}
      </div>

      {tab === 'log' && (
        <div style={{ background: '#0d1117' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 12px', borderBottom: '1px solid #21262d' }}>
            <input value={sq} onChange={e => setSq(e.target.value)} placeholder="🔍 Search the log…" style={{ ...field, width: 240 }}
              onKeyDown={e => { if (e.key === 'Enter') step(e.shiftKey ? -1 : 1) }} />
            <label style={{ fontSize: 11, color: '#8b949e', display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}><input type="checkbox" checked={sCase} onChange={e => setSCase(e.target.checked)} /> Match case</label>
            <button onClick={() => step(-1)} disabled={!hits.length} style={{ ...btn(false, !hits.length), padding: '1px 8px' }} title="Previous (Shift+Enter)">▲</button>
            <button onClick={() => step(1)} disabled={!hits.length} style={{ ...btn(false, !hits.length), padding: '1px 8px' }} title="Next (Enter)">▼</button>
            <span style={{ fontSize: 11, color: '#8b949e' }}>{sq.trim() ? (hits.length ? `${cur + 1} of ${hits.length} line${hits.length === 1 ? '' : 's'}` : 'No match') : `${lines.length} lines`}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10.5, display: 'flex', gap: 8 }}>
              <span style={{ color: '#ff7b72' }}>■ error / fail</span><span style={{ color: '#e3b341' }}>■ warn</span><span style={{ color: '#3fb950' }}>■ success</span><span style={{ color: '#79c0ff' }}>■ phase</span><span style={{ color: '#c9d1d9' }}>■ info</span><span style={{ color: '#6e7681' }}>■ debug / stack</span>
            </span>
          </div>
          <div ref={box} onScroll={onScroll} style={{ padding: 12, color: '#c9d1d9', fontSize: 11.5, lineHeight: 1.45, height: 340, overflow: 'auto', fontFamily: 'monospace' }}>
            {!text ? 'Starting Maven…' : lines.map((l, i) => (
              <Line key={i} n={i + 1} text={l} needles={needles} state={flash === i + 1 ? 2 : hits[cur] === i + 1 ? 1 : 0} />
            ))}
          </div>
        </div>
      )}

      {tab === 'watch' && (
        <div style={{ background: '#0d1117', color: '#c9d1d9', height: 380, overflow: 'auto', padding: 12, fontSize: 11.5 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
            <input value={wText} onChange={e => setWText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addWatch() }} placeholder="e.g.  TEST CASE|[HCC ID|<ConsolidatedClaim>]"
              style={{ ...field, flex: '1 1 320px', minWidth: 220, fontFamily: 'monospace' }} />
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><input type="checkbox" checked={wCase} onChange={e => setWCase(e.target.checked)} /> Match case</label>
            <button onClick={addWatch} disabled={!wText.trim()} style={btn(true, !wText.trim())}>+ Add</button>
            {totalRecords > 0 && <button onClick={() => copyText(trees.flatMap(t => t.records.map(r => recordText(r))).join('\n\n'))} style={btn(false)}>⧉ Copy all</button>}
          </div>
          <div style={{ fontSize: 10.5, color: '#8b949e', marginBottom: 10, lineHeight: 1.6 }}>
            <code>A|B|C</code> builds a tree (B under A, C under B) · <code>A|[B|C]</code> B and C at the same level · <code>&lt;Tag&gt;</code> captures <code>&lt;Tag&gt;…&lt;/Tag&gt;</code> over several lines · <code>&lt;XML&gt;</code> captures every outermost XML element · escape <code>\| \[ \] \\</code> with <code>\</code>.
            B / C are only listed under an A that was found before them.
          </div>
          {watches.length === 0 && <div style={{ color: '#8b949e' }}>Add a string (or a pattern) and the matching lines of this IT run are kept here, live while the test runs.</div>}
          {trees.map(t => (
            <div key={t.w.id} style={{ marginBottom: 12, border: '1px solid #30363d', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', background: '#161b22' }}>
                <b style={{ color: t.color, fontFamily: 'monospace' }}>{t.w.text}</b>
                <span style={{ fontSize: 10, color: '#8b949e' }}>{t.w.matchCase ? 'match case' : 'ignore case'} · {t.records.length} match{t.records.length === 1 ? '' : 'es'}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  {t.records.length > 0 && <button onClick={() => copyText(t.records.map(r => recordText(r)).join('\n\n'))} title="Copy everything matched by this pattern" style={{ ...btn(false), padding: '1px 8px' }}>⧉ Copy</button>}
                  <button onClick={() => saveWatches(watches.filter(x => x.id !== t.w.id))} title="Stop watching this pattern" style={{ ...btn(false), color: '#f85149', padding: '1px 8px' }}>🗑 Delete</button>
                </span>
              </div>
              {t.records.length === 0
                ? <div style={{ padding: '6px 10px', color: '#8b949e' }}>{running ? 'Not found yet…' : 'Not found in this run.'}</div>
                : t.records.map((r, i) => (
                  <div key={i} style={{ padding: '3px 10px', borderTop: '1px solid #21262d' }}>
                    <Node node={r} color={t.color} depth={0} goTo={goTo} colorOf={colorOfLit} />
                  </div>))}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
