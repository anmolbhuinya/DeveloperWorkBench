import { useState, useEffect, useRef } from 'react'

const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December']

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

function firstWeekday(year, month) {
  return new Date(year, month, 1).getDay()
}

function toYMD(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseYMD(str) {
  if (!str) return null
  const [y, m, d] = str.split('-').map(Number)
  return { year: y, month: m - 1, day: d }
}

export default function DatePicker({ value, onChange, min, placeholder = 'Select date', label }) {
  const today    = new Date()
  const initDate = parseYMD(value)
  const [open,   setOpen]   = useState(false)
  const [year,   setYear]   = useState(initDate?.year  ?? today.getFullYear())
  const [month,  setMonth]  = useState(initDate?.month ?? today.getMonth())
  const ref = useRef(null)

  // sync view when value changes externally
  useEffect(() => {
    const d = parseYMD(value)
    if (d) { setYear(d.year); setMonth(d.month) }
  }, [value])

  // close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const prev = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  const next = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  const total   = daysInMonth(year, month)
  const offset  = firstWeekday(year, month)
  const minDate = min || null

  const cells = []
  for (let i = 0; i < offset; i++) cells.push(null)
  for (let d = 1; d <= total; d++) cells.push(d)

  const display = value
    ? (() => { const d = parseYMD(value); return d ? `${d.day} ${MONTHS[d.month]} ${d.year}` : value })()
    : ''

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {label && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 3 }}>{label}</div>}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', fontSize: 13, padding: '5px 8px',
          border: '1px solid var(--border)', borderRadius: 4,
          background: 'var(--bg)', color: display ? 'var(--text)' : 'var(--text-muted)',
          cursor: 'pointer', userSelect: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        }}
      >
        <span>{display || placeholder}</span>
        <span style={{ fontSize: 14, opacity: 0.6 }}>📅</span>
      </div>

      {open && (
        <div style={{
          position: 'absolute', zIndex: 200, top: 'calc(100% + 4px)', left: 0,
          background: 'var(--bg, #fff)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          padding: '12px', minWidth: 240,
        }}>
          {/* Month navigation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button
              onClick={prev}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text)', padding: '2px 6px', borderRadius: 4 }}
              title="Previous month"
            >‹</button>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{MONTHS[month]} {year}</span>
            <button
              onClick={next}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text)', padding: '2px 6px', borderRadius: 4 }}
              title="Next month"
            >›</button>
          </div>

          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
            {DAYS.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', padding: '2px 0' }}>
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {cells.map((day, i) => {
              if (!day) return <div key={`e${i}`} />
              const ymd      = toYMD(year, month, day)
              const selected = value === ymd
              const isToday  = toYMD(today.getFullYear(), today.getMonth(), today.getDate()) === ymd
              const disabled = minDate && ymd < minDate

              return (
                <button
                  key={day}
                  disabled={disabled}
                  onClick={() => { onChange(ymd); setOpen(false) }}
                  style={{
                    border: selected ? '2px solid var(--primary, #1976d2)' : isToday ? '1px solid var(--primary, #1976d2)' : '1px solid transparent',
                    borderRadius: 4,
                    background: selected ? 'var(--primary, #1976d2)' : 'none',
                    color: selected ? '#fff' : disabled ? 'var(--text-muted)' : 'var(--text)',
                    fontSize: 12, fontWeight: isToday ? 700 : 400,
                    padding: '4px 2px', cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.4 : 1,
                    textAlign: 'center',
                  }}
                >
                  {day}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
