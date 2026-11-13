// Watch patterns for the IT log:  A|B|C  = levels (tree),  [B|C]  = equal-level siblings,  \  escapes  | [ ] \  .
// A literal like <Tag> captures <Tag ...> ... </Tag> (even over many lines); <XML> captures every outermost XML element.

// Split on `sep` outside [ ] and not escaped. Parts keep their escapes.
function splitTop(str, sep, brackets = true) {
  const parts = []
  let cur = '', depth = 0
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (ch === '\\' && i + 1 < str.length) { cur += ch + str[i + 1]; i++; continue }
    if (brackets && ch === '[') depth++
    else if (brackets && ch === ']' && depth > 0) depth--
    if (ch === sep && depth === 0) { parts.push(cur); cur = ''; continue }
    cur += ch
  }
  parts.push(cur)
  return parts
}
const unescape = s => s.replace(/\\(.)/g, '$1')
const isGroup = p => /^\[[\s\S]*\]$/.test(p) && !/\\\]$/.test(p)

// "TEST CASE|[HCC ID|<ConsolidatedClaim>]" -> [['TEST CASE'], ['HCC ID', '<ConsolidatedClaim>']]
export function parsePattern(src) {
  const levels = []
  for (const raw of splitTop(String(src || ''), '|')) {
    const p = raw.trim()
    if (!p) continue
    const items = isGroup(p) ? splitTop(p.slice(1, -1), '|', false).map(x => unescape(x).trim()).filter(Boolean) : [unescape(p).trim()].filter(Boolean)
    if (items.length) levels.push(items)
  }
  return levels
}

const TAG = /^<([A-Za-z_][\w:.\-]*)>$/
export const literalKind = lit => (lit === '<XML>' ? 'xml' : TAG.test(lit) ? 'tag' : 'plain')

// end offset of the element opened at `start` (name = tag name or null for any), or -1 when it is never closed
function elementEnd(text, start, name, flags) {
  const open = new RegExp(`^<(${name || '[A-Za-z_][\\w:.\\-]*'})(?:\\s[^<>]*?)?(/?)>`, flags)
  const m = open.exec(text.slice(start, start + 4000))
  if (!m) return { end: -1 }
  if (m[2] === '/') return { end: start + m[0].length, closed: true, name: m[1] }
  const nm = m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`<${nm}(?:\\s[^<>]*?)?(/?)>|</${nm}\\s*>`, 'g' + (flags.includes('i') ? 'i' : ''))
  re.lastIndex = start + m[0].length
  let depth = 1, x
  while ((x = re.exec(text))) {
    if (x[0].startsWith('</')) { if (--depth === 0) return { end: x.index + x[0].length, closed: true, name: m[1] } }
    else if (x[1] !== '/') depth++
  }
  return { end: -1, name: m[1] }
}

// Every place a literal occurs: { start, end, line, text, xml? , closed? }
function occurrences(text, lineStarts, lit, level, matchCase) {
  const out = []
  const kind = literalKind(lit)
  const lineOf = off => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= off) lo = mid; else hi = mid - 1 } return lo + 1 }
  if (kind === 'plain') {
    const needle = matchCase ? lit : lit.toLowerCase()
    for (let i = 0; i < lineStarts.length; i++) {
      const s = lineStarts[i], e = i + 1 < lineStarts.length ? lineStarts[i + 1] - 1 : text.length
      const line = text.slice(s, e)
      const at = (matchCase ? line : line.toLowerCase()).indexOf(needle)
      if (at >= 0) out.push({ start: s + at, end: e, line: i + 1, text: line.replace(/\s+$/, ''), level, lit, kind })
    }
    return out
  }
  const flags = matchCase ? '' : 'i'
  const name = kind === 'tag' ? TAG.exec(lit)[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '[A-Za-z_][\\w:.\\-]*'
  const re = new RegExp(`<(${name})(?:\\s[^<>]*?)?/?>`, 'g' + flags)
  let m, skipTo = 0
  while ((m = re.exec(text))) {
    if (m.index < skipTo) continue                                  // inside the element captured just before (outermost wins)
    const r = elementEnd(text, m.index, kind === 'tag' ? name : null, flags)
    if (r.end < 0 && kind === 'xml') continue                       // "<init>" and friends: an element that never closes is not XML
    const end = r.end < 0 ? text.length : r.end
    const xml = text.slice(m.index, end)
    out.push({ start: m.index, end, line: lineOf(m.index), endLine: lineOf(Math.max(m.index, end - 1)), text: xml.split('\n')[0].trim(), xml, closed: r.end >= 0, tag: r.name || m[1], level, lit, kind })
    skipTo = end
  }
  return out
}

// -> records (level-0 nodes) each with .children recursively; a lower level without a parent is ignored
export function buildTree(text, levels, matchCase) {
  if (!levels.length || !text) return []
  const lineStarts = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1)
  let occ = []
  levels.forEach((items, L) => items.forEach(lit => { occ = occ.concat(occurrences(text, lineStarts, lit, L, matchCase)) }))
  occ.sort((a, b) => a.start - b.start || a.level - b.level)
  const records = []
  let cur = []
  for (const o of occ) {
    const node = { ...o, children: [] }
    if (o.level === 0) { records.push(node); cur = [node]; continue }
    const parent = cur[o.level - 1]
    if (!parent) continue
    parent.children.push(node)
    cur[o.level] = node
    cur.length = o.level + 1
  }
  return records
}

// plain text of a record for copying
export function recordText(rec, indent = '') {
  const own = indent + (rec.xml ? rec.xml : rec.text)
  return [own, ...rec.children.map(c => recordText(c, indent + '    '))].join('\n')
}
