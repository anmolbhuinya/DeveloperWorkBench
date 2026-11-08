// Relationship diagram renderer. Plain DOM + SVG with no imports, so the very same code runs in the Workbench and inside the exported HTML page.
// g = { root, nodes: [{ id, schema, table, level, row: {name: value} }], edges: [{ from (child), to (parent), label }], cols?: { id: {name: value} } }
// opts = { mode: 'row' | 'table' | 'schema', onPick(node), loadCols(ids) -> Promise<{id: {name: value}}> }

export function renderRelations(root, g, opts) {
  opts = opts || {}
  const mode = opts.mode || 'row'
  const NS = 'http://www.w3.org/2000/svg'
  const AMBER = ['rgba(245,158,11,0.18)', '#f59e0b'], BLUE = ['rgba(21,101,192,0.12)', '#1565c0'], GREEN = ['rgba(46,125,50,0.12)', '#2e7d32'], GREY = ['rgba(128,128,128,0.08)', '#90a4ae']
  const noun = mode === 'row' ? 'row' : 'table'
  const h = (tag, css, parent, text) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text !== undefined) e.textContent = text; if (parent) parent.appendChild(e); return e }
  const s = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e }

  const byId = {}, parentsOf = {}, childrenOf = {}, nbr = {}
  g.nodes.forEach(n => { byId[n.id] = n; parentsOf[n.id] = []; childrenOf[n.id] = []; nbr[n.id] = new Set() })
  g.edges.forEach(e => { if (!byId[e.from] || !byId[e.to]) return; parentsOf[e.from].push(e.to); childrenOf[e.to].push(e.from); nbr[e.from].add(e.to); nbr[e.to].add(e.from) })
  const deg = {}; let maxDeg = 1
  g.nodes.forEach(n => { deg[n.id] = nbr[n.id].size; maxDeg = Math.max(maxDeg, deg[n.id]) })
  const cols = Object.assign({}, g.cols || {})
  g.nodes.forEach(n => { if (n.row && Object.keys(n.row).length) cols[n.id] = n.row })

  let sel = null, zoom = 1, destroyed = false, emph = 0          // emph: -3 reduced .. 10 most enlarged (left click on the selected table enlarges, right click reduces)
  let pinned = null, lastOff = null
  const drift = {}                       // row / table views: how far each box was dragged from the layered layout
  const pos = {}                         // schema mode: remembered positions so a selection does not shake the whole diagram

  root.innerHTML = ''
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:320px;font:12px system-ui,sans-serif;color:var(--text,#222)'
  const bar = h('div', 'display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:0 0 8px;font-size:11px;color:var(--text-muted,#666)', root)
  const legend = h('span', 'display:inline-flex;gap:12px;flex-wrap:wrap;align-items:center', bar)
  const sw = (c, t) => { const w = h('span', 'display:inline-flex;align-items:center;gap:4px', legend); h('span', `width:12px;height:12px;border-radius:3px;display:inline-block;background:${c[0]};border:1px solid ${c[1]}`, w); w.appendChild(document.createTextNode(t)) }
  if (mode === 'schema') {
    sw(AMBER, 'Selected ' + noun); sw(BLUE, 'Parent (the selected table points to it)'); sw(GREEN, 'Child (points to the selected table)'); sw(GREY, 'Other tables')
    h('span', '', legend, '· box size = number of relations · click a table for details; click it again to enlarge it and its neighbours (up to 10 steps), right-click to reduce, drag it to move it with its neighbours')
  } else {
    sw(AMBER, 'Selected ' + noun + ' (★)'); sw(BLUE, 'Parent ' + noun + ' (foreign key points to it)'); sw(GREEN, 'Child ' + noun + ' (points to the selected one)')
    h('span', '', legend, '· arrow = foreign key, child → parent · click a box to highlight it and its neighbours · drag a box to move it (with its neighbours when selected)')
  }
  const tools = h('span', 'margin-left:auto;position:relative;display:inline-flex;gap:4px;align-items:center', bar)
  let search = null, searchBtn = null
  if (mode === 'schema') {
    search = h('input', 'font-size:11px;padding:2px 6px;border:1px solid var(--border,#ccc);border-radius:4px;background:var(--surface2,#fff);color:inherit;width:150px', tools)
    search.placeholder = 'find table'
    searchBtn = h('button', 'border:1px solid var(--border,#ccc);background:var(--surface,#fff);color:inherit;border-radius:4px;padding:1px 8px;cursor:pointer;font-size:12px', tools, '🔍 Search')
    searchBtn.title = 'Find the table (any table of the schema, also ones not drawn yet)'
  }
  const btn = (t, tip, fn) => { const b = h('button', 'border:1px solid var(--border,#ccc);background:var(--surface,#fff);color:inherit;border-radius:4px;padding:1px 8px;cursor:pointer;font-size:12px', tools, t); b.title = tip; b.onclick = fn; return b }
  btn('−', 'Zoom out', () => setZoom(zoom / 1.2)); const zl = h('span', 'min-width:38px;text-align:center', tools); btn('+', 'Zoom in', () => setZoom(zoom * 1.2)); btn('Fit', 'Fit to window', fit); btn('100%', 'Actual size', () => setZoom(1))
  if (mode === 'schema') btn('Clear', 'Clear the selection', () => select(null))
  const vp = h('div', 'flex:1;min-height:0;overflow:auto;border:1px solid var(--border,#ddd);border-radius:6px;position:relative;cursor:grab;background:var(--bg,transparent)', root)
  const spacer = h('div', 'position:relative', vp)
  const stage = h('div', 'position:absolute;left:0;top:0;transform-origin:0 0', spacer)
  const svg = s('svg', {}, stage); svg.style.cssText = 'position:absolute;left:0;top:0'
  const defs = s('defs', {}, svg)
  const mk = (id, col) => { const m = s('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' }, defs); s('path', { d: 'M0,0 L10,5 L0,10 z', fill: col }, m) }
  mk('ra', '#78909c'); mk('rh', '#f59e0b')
  const eg = s('g', {}, svg)
  const layer = h('div', 'position:absolute;left:0;top:0', stage)

  // drag the background to pan
  let drag = null
  vp.addEventListener('mousedown', e => { if (e.target === vp || e.target === spacer || e.target === stage || e.target === svg) { drag = { x: e.clientX, y: e.clientY, l: vp.scrollLeft, t: vp.scrollTop }; vp.style.cursor = 'grabbing' } })
  let gdrag = null, dragMoved = false
  const mm = e => {
    if (gdrag) {
      const dx = (e.clientX - gdrag.x) / zoom, dy = (e.clientY - gdrag.y) / zoom
      if (!dragMoved && Math.abs(dx) + Math.abs(dy) < 3) return
      if (!dragMoved) gdrag.ids.forEach(i => { if (els[i]) els[i].style.cursor = 'grabbing' })       // the hand only appears once a drag really starts
      dragMoved = true
      const lim = mode === 'schema' ? [sel] : gdrag.ids       // the selected table must stay inside the canvas; neighbours may go beyond it
      const ddx = Math.max(dx, ...lim.map(i => -gdrag.o[i].x)), ddy = Math.max(dy, ...lim.map(i => -gdrag.o[i].y))
      gdrag.ids.forEach(i => { P[i].x = gdrag.o[i].x + ddx; P[i].y = gdrag.o[i].y + ddy; if (els[i]) { els[i].style.left = P[i].x + 'px'; els[i].style.top = P[i].y + 'px' } })
      gdrag.dx = ddx; gdrag.dy = ddy
      drawEdges()
      return
    }
    if (drag) { vp.scrollLeft = drag.l - (e.clientX - drag.x); vp.scrollTop = drag.t - (e.clientY - drag.y) } }
  const mu = () => {
    if (gdrag) {
      if (dragMoved) {
        if (mode === 'schema') { gdrag.ids.forEach(i => { if (pos[i]) { pos[i] = { x: pos[i].x + gdrag.dx, y: pos[i].y + gdrag.dy } } }); pinned = new Set(gdrag.ids) }
        else gdrag.ids.forEach(i => { const d = drift[i] || { x: 0, y: 0 }; drift[i] = { x: d.x + gdrag.dx, y: d.y + gdrag.dy } })
        // enlarging / reducing afterwards happens where the group was dropped       // remembered, so the next relayout starts from here
        let W = 0, H = 0; Object.values(P).forEach(p => { W = Math.max(W, p.x + p.w); H = Math.max(H, p.y + p.h) })
        dims = { W: W + 20, H: H + 20 }; svg.setAttribute('width', dims.W); svg.setAttribute('height', dims.H); stage.style.width = dims.W + 'px'; stage.style.height = dims.H + 'px'; setZoom(zoom)
        setTimeout(() => { dragMoved = false }, 0)
      }
      Object.values(els).forEach(el => { el.style.cursor = 'pointer' })
      gdrag = null
    }
    drag = null; vp.style.cursor = 'grab'
  }
  window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu)
  vp.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)) } }, { passive: false })

  let dims = { W: 100, H: 100 }
  function setZoom(z) { zoom = Math.max(0.1, Math.min(3, z)); stage.style.transform = `scale(${zoom})`; spacer.style.width = dims.W * zoom + 'px'; spacer.style.height = dims.H * zoom + 'px'; zl.textContent = Math.round(zoom * 100) + '%' }
  function fit() { setZoom(Math.min(vp.clientWidth / dims.W, vp.clientHeight / dims.H, 1.2)) }

  const fOf = e => e > 0 ? 1 + 0.4 * e : 1 + 0.12 * e
  // moves everything away from (or towards) the selected table when the detail boxes grow (or shrink), so they neither overlap nor leave big gaps
  function stepEmph(d) {
    const ne = Math.max(-3, Math.min(10, emph + d)); if (ne === emph) return
    const r = Math.pow(fOf(ne) / fOf(emph), 0.95), c = pos[sel]
    if (c) { const cx = c.x, cy = c.y; Object.keys(pos).forEach(k => { pos[k] = { x: cx + (pos[k].x - cx) * r, y: cy + (pos[k].y - cy) * r } }) }
    const a = P[sel], cx0 = a ? (a.x + a.w / 2) * zoom - vp.scrollLeft : 0, cy0 = a ? (a.y + a.h / 2) * zoom - vp.scrollTop : 0   // where the selected table is on screen now
    emph = ne; draw()
    const b = P[sel]; if (b && a) { vp.scrollLeft = (b.x + b.w / 2) * zoom - cx0; vp.scrollTop = (b.y + b.h / 2) * zoom - cy0 }       // keep it at the same place on screen
  }
  // ---- sizes -------------------------------------------------------------------------------------------------
  const MAXL = 10, LH = 13
  const lines = id => { const c = cols[id] || {}; return Object.entries(c).filter(([, v]) => v !== null && v !== '' && v !== undefined) }
  const isNb = id => sel && (id === sel || nbr[sel].has(id))
  function sizeOf(n) {
    if (mode !== 'schema') { const l = Math.min(lines(n.id).length, 9); return { w: 270, h: 26 + l * 14 + (lines(n.id).length > l ? 14 : 0) + 8, detail: true, nl: l } }
    if (sel && isNb(n.id)) {
      const F = fOf(emph), ML = emph > 0 ? MAXL + 8 * emph : Math.max(3, MAXL + 2 * emph)
      const all = lines(n.id), l = Math.min(all.length, ML)
      return { w: Math.round((n.id === sel ? 270 : 220) * F), h: Math.round((24 + (all.length ? l * LH + (all.length > l ? LH : 0) + 6 : 16)) * F), detail: true, nl: l, f: F, ml: ML }
    }
    if (deg[n.id] === 0) return { w: 170, h: 20, detail: false, k: 0.9 }
    if (sel) return { w: 84, h: 20, detail: false }
    const k = 0.8 + 1.6 * Math.sqrt(deg[n.id] / maxDeg)
    return { w: Math.round(96 * k), h: Math.round(22 * k), detail: false, k }
  }

  // ---- layout ------------------------------------------------------------------------------------------------
  function layered(sz) {
    const levels = [...new Set(g.nodes.map(n => n.level))].sort((a, b) => a - b), P = {}
    levels.forEach((lv, li) => { let y = 12; g.nodes.filter(n => n.level === lv).forEach(n => { P[n.id] = { x: 12 + li * 370, y, w: sz[n.id].w, h: sz[n.id].h }; y += sz[n.id].h + 16 }) })
    Object.keys(P).forEach(k => { const d = drift[k]; if (d) { P[k].x += d.x; P[k].y += d.y } })
    return P
  }
  function force(sz) {
    const ns = g.nodes.filter(n => deg[n.id] > 0), iso = g.nodes.filter(n => deg[n.id] === 0).sort((a, b) => a.table < b.table ? -1 : 1), N = ns.length, idx = {}; ns.forEach((n, i) => { idx[n.id] = i })
    const x = new Array(N), y = new Array(N)
    ns.forEach((n, i) => { const p = pos[n.id]; if (p) { x[i] = p.x; y[i] = p.y } else { const a = i * 2.399963, r = 70 * Math.sqrt(i + 1) * (1 + (sel ? 0.3 : 0)); x[i] = Math.cos(a) * r; y[i] = Math.sin(a) * r } })
    const E = g.edges.filter(e => idx[e.from] !== undefined && idx[e.to] !== undefined).map(e => [idx[e.from], idx[e.to]])
    const iters = Object.keys(pos).length ? 140 : 320
    for (let it = 0; it < iters; it++) {
      const t = 1 - it / iters, fx = new Array(N).fill(0), fy = new Array(N).fill(0)
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        const si = sz[ns[i].id], sj = sz[ns[j].id]
        let dx = x[i] - x[j], dy = y[i] - y[j]; const d2 = dx * dx + dy * dy + 0.5, d = Math.sqrt(d2)
        const k = (((si.w + sj.w) / 2 + 30) * ((si.h + sj.h) / 2 + 30)) * 0.9
        const f = k / d2 / d
        fx[i] += dx * f; fy[i] += dy * f; fx[j] -= dx * f; fy[j] -= dy * f
      }
      E.forEach(([a, b]) => {
        const sa = sz[ns[a].id], sb = sz[ns[b].id]
        const dx = x[b] - x[a], dy = y[b] - y[a], d = Math.sqrt(dx * dx + dy * dy) + 0.01, L = (sa.w + sb.w) / 2 + 60
        const f = (d - L) * 0.04
        fx[a] += dx / d * f; fy[a] += dy / d * f; fx[b] -= dx / d * f; fy[b] -= dy / d * f
      })
      for (let i = 0; i < N; i++) { if (pinned && pinned.has(ns[i].id)) continue; fx[i] -= x[i] * 0.004; fy[i] -= y[i] * 0.004; const m = 40 * t + 2, l = Math.hypot(fx[i], fy[i]) || 1; const c = Math.min(l, m) / l; x[i] += fx[i] * c; y[i] += fy[i] * c }
    }
    for (let pass = 0; pass < 400; pass++) {                    // separate boxes that still overlap
      let moved = false
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        const si = sz[ns[i].id], sj = sz[ns[j].id], dx = x[i] - x[j], dy = y[i] - y[j]
        const ox = (si.w + sj.w) / 2 + 14 - Math.abs(dx), oy = (si.h + sj.h) / 2 + 12 - Math.abs(dy)
        if (ox > 0 && oy > 0) {
          moved = true
          const wi = pinned && pinned.has(ns[i].id) ? 0 : 1, wj = pinned && pinned.has(ns[j].id) ? 0 : 1, sum = wi + wj
          const ai = sum ? wi / sum : 0.5, aj = sum ? wj / sum : 0.5            // a dropped (pinned) box stays, the others make room
          if (ox < oy) { const m = ox * (dx >= 0 ? 1 : -1); x[i] += m * ai; x[j] -= m * aj } else { const m = oy * (dy >= 0 ? 1 : -1); y[i] += m * ai; y[j] -= m * aj }
        }
      }
      if (!moved) break
    }
    let minx = Infinity, miny = Infinity
    ns.forEach((n, i) => { minx = Math.min(minx, x[i] - sz[n.id].w / 2); miny = Math.min(miny, y[i] - sz[n.id].h / 2) })
    const offx = pinned && lastOff ? Math.max(lastOff.x, 16 - minx) : 16 - minx, offy = pinned && lastOff ? Math.max(lastOff.y, 16 - miny) : 16 - miny
    lastOff = { x: offx, y: offy }
    const P = {}
    ns.forEach((n, i) => { pos[n.id] = { x: x[i], y: y[i] }; P[n.id] = { x: x[i] - sz[n.id].w / 2 + offx, y: y[i] - sz[n.id].h / 2 + offy, w: sz[n.id].w, h: sz[n.id].h } })
    isoTop = null
    if (iso.length) {                                              // tables without relations: a plain grid below the network
      let W0 = 0, H0 = 0; Object.values(P).forEach(p => { W0 = Math.max(W0, p.x + p.w); H0 = Math.max(H0, p.y + p.h) })
      const maxW = Math.max(W0, 1100); let cx = 16, cy = (N ? H0 + 50 : 40), rowH = 0
      isoTop = cy - 26
      iso.forEach(n => { const z = sz[n.id]; if (cx + z.w > maxW) { cx = 16; cy += rowH + 10; rowH = 0 } P[n.id] = { x: cx, y: cy, w: z.w, h: z.h }; cx += z.w + 10; rowH = Math.max(rowH, z.h) })
      isoCount = iso.length
    }
    return P
  }

  // ---- drawing -----------------------------------------------------------------------------------------------
  const tone = n => {
    if (sel) { if (n.id === sel) return AMBER; if (parentsOf[sel].includes(n.id)) return BLUE; if (childrenOf[sel].includes(n.id)) return GREEN }
    if (mode === 'schema') return GREY
    if (n.id === g.root && !sel) return AMBER
    return n.level < 0 ? BLUE : n.level > 0 ? GREEN : AMBER
  }
  let P = {}, isoTop = null, isoCount = 0
  function edgeGeo(e) {
    const a = P[e.from], b = P[e.to]; if (!a || !b) return null
    if (mode !== 'schema') {
      const left = a.x + a.w / 2 < b.x + b.w / 2
      const x1 = left ? a.x + a.w : a.x, x2 = left ? b.x : b.x + b.w, y1 = a.y + 13, y2 = b.y + 13, mx = (x1 + x2) / 2
      return { d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, lx: mx, ly: (y1 + y2) / 2 }
    }
    const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
    const clip = (c, bx, o) => { const dx = o.x - c.x, dy = o.y - c.y; const t = Math.min(dx ? (bx.w / 2) / Math.abs(dx) : 1e9, dy ? (bx.h / 2) / Math.abs(dy) : 1e9, 1); return { x: c.x + dx * t, y: c.y + dy * t } }
    const p1 = clip(ca, a, cb), p2 = clip(cb, b, ca)
    return { d: `M${p1.x},${p1.y} L${p2.x},${p2.y}`, lx: (p1.x + p2.x) / 2, ly: (p1.y + p2.y) / 2 }
  }
  function drawEdges() {
    eg.innerHTML = ''
    g.edges.forEach(e => {
      const geo = edgeGeo(e); if (!geo) return
      const touch = sel && (e.from === sel || e.to === sel)
      const dim = sel && !touch
      const p = s('path', { d: geo.d, fill: 'none', stroke: touch ? '#f59e0b' : '#78909c', 'stroke-width': touch ? 2 : 1, 'stroke-opacity': dim ? 0.18 : 0.85, 'marker-end': touch ? 'url(#rh)' : 'url(#ra)' }, eg)
      s('title', {}, p).textContent = e.label
      if (mode !== 'schema' || touch) { const t = s('text', { x: geo.lx, y: geo.ly - 3, 'font-size': 9, 'text-anchor': 'middle', fill: dim ? '#b0bec5' : '#78909c' }, eg); t.textContent = e.label.length > 38 ? e.label.slice(0, 37) + '…' : e.label }
    })
  }
  const els = {}
  function draw() {
    if (destroyed) return
    const sz = {}; g.nodes.forEach(n => { sz[n.id] = sizeOf(n) })
    P = mode === 'schema' ? force(sz) : layered(sz)
    let W = 0, H = 0; Object.values(P).forEach(p => { W = Math.max(W, p.x + p.w); H = Math.max(H, p.y + p.h) }); dims = { W: W + 20, H: H + 20 }
    svg.setAttribute('width', dims.W); svg.setAttribute('height', dims.H); stage.style.width = dims.W + 'px'; stage.style.height = dims.H + 'px'
    layer.innerHTML = ''
    drawEdges()
    if (isoTop !== null) h('div', `position:absolute;left:16px;top:${isoTop}px;font-size:12px;font-weight:600;color:var(--text-muted,#666)`, layer, `Tables without relations (${isoCount})`)
    g.nodes.forEach(n => {
      const p = P[n.id], z = sz[n.id], [bg, bd] = tone(n)
      const dim = sel && mode === 'schema' ? !isNb(n.id) : sel ? !(n.id === sel || nbr[sel].has(n.id)) : false
      const box = h('div', `position:absolute;left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;box-sizing:border-box;border:${n.id === sel ? 2 : 1}px solid ${bd};border-radius:6px;background:${bg};overflow:hidden;cursor:pointer;opacity:${dim ? 0.4 : 1};font:${10 * (z.f || 1)}px monospace;color:var(--text,#222)`, layer)
      box.title = n.schema + '.' + n.table + (mode === 'schema' ? ` - ${deg[n.id]} relation(s)` : '')
      els[n.id] = box
      box.onclick = ev => { ev.stopPropagation(); if (dragMoved) { dragMoved = false; return } onClickNode(n) }
      if (mode !== 'schema' || (sel && isNb(n.id))) {                     // the selected one and its neighbours are dragged together (a box on its own when nothing is selected)
        box.onmousedown = ev => {
          if (ev.button !== 0) return
          ev.stopPropagation(); ev.preventDefault()
          const ids = (sel && isNb(n.id) ? [sel, ...nbr[sel]] : [n.id]).filter(i => P[i])
          gdrag = { x: ev.clientX, y: ev.clientY, prim: n.id, ids, o: Object.fromEntries(ids.map(i => [i, { x: P[i].x, y: P[i].y }])) }
          dragMoved = false
        }
      }
      box.oncontextmenu = ev => { if (mode === 'schema' && n.id === sel) { ev.preventDefault(); ev.stopPropagation(); stepEmph(-1) } }
      const fs = z.k ? Math.round(10 * z.k) : Math.round(11 * (z.f || 1))
      const head = h('div', `padding:${z.detail ? 4 : 2}px 8px;font-weight:700;font-size:${fs}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${z.detail ? `border-bottom:1px solid ${bd};background:rgba(128,128,128,0.08)` : ''}`, box, n.table + (n.id === g.root && mode !== 'schema' ? '  ★' : '') + (!z.detail && mode === 'schema' && !sel && z.h >= 34 ? '' : ''))
      if (z.detail) {
        const body = h('div', 'padding:3px 8px', box), all = lines(n.id)
        if (!all.length && mode === 'schema') h('div', 'color:var(--text-muted,#777)', body, loading[n.id] ? 'loading…' : 'no column details')
        all.slice(0, mode === 'schema' ? z.ml : 9).forEach(([k, v]) => {
          const r = h('div', `height:${Math.round(13 * (z.f || 1))}px;line-height:${Math.round(13 * (z.f || 1))}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`, body)
          h('span', 'color:var(--text-muted,#777)', r, k); r.appendChild(document.createTextNode(mode === 'row' ? ' = ' + String(v) : '  ' + String(v)))
        })
        const lim = mode === 'schema' ? z.ml : 9
        if (all.length > lim) h('div', 'color:var(--text-muted,#777)', body, `+ ${all.length - lim} more column(s)`)
      } else if (mode === 'schema' && !sel && z.h >= 30) {
        h('div', 'padding:0 8px;font-size:9px;color:var(--text-muted,#777)', box, deg[n.id] + ' relation(s)')
      }
    })
    setZoom(zoom)
  }

  const loading = {}
  function select(id, scroll, keep) {
    if (id !== sel && !keep) { pinned = null; lastOff = null }
    sel = id
    if (!id) emph = 0
    if (id && mode === 'schema' && opts.loadCols) {
      const need = [id, ...nbr[id]].filter(i => !cols[i] && !loading[i]); need.forEach(i => { loading[i] = true })
      if (need.length) opts.loadCols(need).then(r => { Object.assign(cols, r || {}); need.forEach(i => { delete loading[i] }); if (sel === id) draw() }).catch(() => { need.forEach(i => { delete loading[i] }); draw() })
    }
    draw()
    if (id && scroll !== false && P[id]) { vp.scrollLeft = Math.max(0, (P[id].x + P[id].w / 2) * zoom - vp.clientWidth / 2); vp.scrollTop = Math.max(0, (P[id].y + P[id].h / 2) * zoom - vp.clientHeight / 2) }
  }
  function onClickNode(n) {
    if (mode === 'schema') {
      if (sel !== n.id) {
        if (sel && P[n.id]) {                                   // switching to another table: same size step, and the clicked table stays where it is on screen
          const a = P[n.id], cx0 = (a.x + a.w / 2) * zoom - vp.scrollLeft, cy0 = (a.y + a.h / 2) * zoom - vp.scrollTop
          pinned = new Set([n.id]); select(n.id, false, true)
          const b = P[n.id]; if (b) { vp.scrollLeft = (b.x + b.w / 2) * zoom - cx0; vp.scrollTop = (b.y + b.h / 2) * zoom - cy0 }
        } else { emph = 0; select(n.id, false) }
      } else stepEmph(1)
    }          // clicking the selected table keeps it selected; empty space clears
    else { sel = n.id; draw() }
    if (opts.onPick) opts.onPick(n)
  }
  vp.addEventListener('click', e => { if (dragMoved) return                    // letting go outside the table after a drag is not a click
    if (mode === 'schema' && sel && (e.target === vp || e.target === spacer || e.target === stage || e.target === svg || e.target === layer)) select(null) })
  // a search can match several tables: they are listed so one can be picked (any table of the schema, also ones not drawn yet)
  const list = mode === 'schema' ? h('div', 'display:none;position:absolute;right:0;top:100%;margin-top:4px;z-index:50;min-width:260px;max-height:280px;overflow:auto;background:var(--surface,#fff);color:var(--text,#222);border:1px solid var(--border,#ccc);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.25);font:11px monospace', tools) : null
  const closeList = () => { if (list) list.style.display = 'none' }
  const choose = name => {
    closeList(); search.value = name
    const m = g.nodes.find(n => n.table === name)
    if (m) select(m.id); else if (opts.onSearchMiss) opts.onSearchMiss(name)
  }
  const showList = (names, q) => {
    list.innerHTML = ''
    if (!names.length) { h('div', 'padding:6px 10px;color:var(--text-muted,#777)', list, 'No table matches "' + q + '"'); list.style.display = 'block'; return }
    h('div', 'padding:4px 10px;color:var(--text-muted,#777);border-bottom:1px solid var(--border,#ddd)', list, names.length + ' table(s) match - pick one')
    names.forEach(nm => {
      const inView = !!g.nodes.find(n => n.table === nm)
      const r = h('div', 'padding:4px 10px;cursor:pointer;white-space:nowrap', list, nm + (inView ? '' : '   (not drawn yet)'))
      r.onmouseenter = () => { r.style.background = 'rgba(128,128,128,0.18)' }; r.onmouseleave = () => { r.style.background = 'transparent' }
      r.onclick = e => { e.stopPropagation(); choose(nm) }
    })
    list.style.display = 'block'
  }
  const doSearch = () => {
    const q = search.value.trim().toUpperCase(); if (!q) return
    const local = g.nodes.filter(n => n.table.includes(q)).map(n => n.table)
    const done = names => { const all = [...new Set(names)]; if (all.length === 1) choose(all[0]); else showList(all, q) }
    if (opts.searchTables) opts.searchTables(q).then(r => done(r && r.length ? r : local)).catch(() => done(local))
    else done(local)
  }
  document.addEventListener('click', closeList)
  if (search) { search.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch() }); searchBtn.onclick = doSearch }
  if (search) search.addEventListener('input', () => { search.style.outline = '' })

  draw()
  if (mode === 'schema') setTimeout(fit, 0)
  if (g.focus && byId[g.focus]) setTimeout(() => select(g.focus), 30)
  return { destroy() { destroyed = true; document.removeEventListener('click', closeList); window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu) }, select }
}
