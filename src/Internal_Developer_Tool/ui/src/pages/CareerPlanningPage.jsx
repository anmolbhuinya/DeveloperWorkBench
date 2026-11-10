import { useState, useEffect } from 'react'

const KEY = 'dwb_career_planning'
const DEFAULT = {
  cols: ['Technical Role', 'Scope', 'Management Equivalent'],
  rows: [
    ['Software Engineer', 'Individual feature/task', 'Team Lead'],
    ['Senior Software Engineer', 'Multiple stories/features', 'Engineering Manager'],
    ['Lead Engineer', 'Team / Product area', 'Senior Engineering Manager'],
    ['Principal Engineer', 'Multiple teams / Domain', 'Director'],
    ['Architect', 'Multiple teams / Domain', 'Director'],
    ['Distinguished Engineer', 'Organization-wide', 'VP'],
    ['Fellow', 'Company-wide', 'CTO'],
  ],
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY))
    if (d && Array.isArray(d.cols) && Array.isArray(d.rows)) return d
  } catch { /* ignore */ }
  return DEFAULT
}

export default function CareerPlanningPage() {
  const [data, setData] = useState(load)
  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(data)) }, [data])

  const setCol = (c, v) => setData(d => ({ ...d, cols: d.cols.map((x, i) => i === c ? v : x) }))
  const setCell = (r, c, v) => setData(d => ({ ...d, rows: d.rows.map((row, i) => i === r ? row.map((x, j) => j === c ? v : x) : row) }))
  const addRow = () => setData(d => ({ ...d, rows: [...d.rows, d.cols.map(() => '')] }))
  const addCol = () => setData(d => ({ cols: [...d.cols, 'New Column'], rows: d.rows.map(r => [...r, '']) }))
  const delRow = r => setData(d => ({ ...d, rows: d.rows.filter((_, i) => i !== r) }))
  const delCol = c => setData(d => d.cols.length < 2 ? d : ({ cols: d.cols.filter((_, i) => i !== c), rows: d.rows.map(r => r.filter((_, j) => j !== c)) }))

  const inp = { width: '100%', background: 'transparent', border: 'none', color: 'inherit', font: 'inherit', padding: '6px 8px', outline: 'none' }
  const cell = { border: '1px solid var(--border)', padding: 0 }
  const btn = { cursor: 'pointer', background: 'none', border: 'none', color: 'var(--text-muted)' }

  return (
    <div>
      <div className="page-header"><h1 className="page-title">Career Planning</h1></div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              {data.cols.map((c, i) => (
                <th key={i} style={cell}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input style={{ ...inp, fontWeight: 700 }} value={c} onChange={e => setCol(i, e.target.value)} />
                    <button style={btn} title="Delete column" onClick={() => delCol(i)}>✕</button>
                  </div>
                </th>
              ))}
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, r) => (
              <tr key={r}>
                {row.map((v, c) => (
                  <td key={c} style={cell}><input style={inp} value={v} onChange={e => setCell(r, c, e.target.value)} /></td>
                ))}
                <td style={{ textAlign: 'center' }}><button style={btn} title="Delete row" onClick={() => delRow(r)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn" onClick={addRow}>+ Add Row</button>
          <button className="btn" onClick={addCol}>+ Add Column</button>
        </div>
      </div>
    </div>
  )
}
