import { useEffect, useMemo, useRef, useState } from 'react'
import type { Aircraft } from './types'

const RESULT_CAP = 80

interface Props {
  aircraft: Aircraft[]
  watched: string[]
  onToggle: (icao24: string) => void
  onClear: () => void
}

function callsignOf(ac: Aircraft): string {
  return (ac.callsign || '').trim() || ac.icao24
}

export function FlightFilter({ aircraft, watched, onToggle, onClear }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const watchedSet = useMemo(() => new Set(watched), [watched])

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const byIcao = useMemo(() => {
    const map = new Map<string, Aircraft>()
    for (const ac of aircraft) map.set(ac.icao24, ac)
    return map
  }, [aircraft])

  const { matches, total } = useMemo(() => {
    if (!open) return { matches: [] as Aircraft[], total: 0 }
    const q = query.trim().toLowerCase()
    const hits: Aircraft[] = []
    for (const ac of aircraft) {
      if (!q) {
        hits.push(ac)
        continue
      }
      const callsign = callsignOf(ac).toLowerCase()
      if (callsign.includes(q) || ac.icao24.includes(q)) hits.push(ac)
    }
    hits.sort((a, b) => callsignOf(a).localeCompare(callsignOf(b)) || a.icao24.localeCompare(b.icao24))
    return { matches: hits.slice(0, RESULT_CAP), total: hits.length }
  }, [aircraft, open, query])

  const label =
    watched.length === 0
      ? 'All flights'
      : watched.length === 1
        ? '1 flight'
        : `${watched.length} flights`

  return (
    <div className="flight-filter" ref={rootRef}>
      <button
        type="button"
        className={`flight-filter-btn ${watched.length ? 'active' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flight-filter-kicker">Monitor</span>
        <span className="mono">{label}</span>
        <span className="flight-filter-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="flight-filter-panel" role="dialog" aria-label="Choose flights to monitor">
          <input
            ref={searchRef}
            className="flight-filter-search mono"
            value={query}
            placeholder="Callsign or ICAO"
            aria-label="Search flights"
            onChange={(event) => setQuery(event.target.value)}
          />

          {watched.length > 0 && (
            <div className="flight-filter-chips">
              {watched.map((icao) => {
                const ac = byIcao.get(icao)
                return (
                  <button
                    key={icao}
                    type="button"
                    className="flight-chip mono"
                    onClick={() => onToggle(icao)}
                  >
                    {ac ? callsignOf(ac) : icao}
                    <span aria-hidden="true">×</span>
                  </button>
                )
              })}
              <button type="button" className="flight-filter-clear" onClick={onClear}>
                Clear
              </button>
            </div>
          )}

          <ul className="flight-filter-list">
            {matches.length === 0 && (
              <li className="flight-filter-empty">
                {query.trim() ? 'No flights match' : 'No flights in the feed'}
              </li>
            )}
            {matches.map((ac) => {
              const checked = watchedSet.has(ac.icao24)
              return (
                <li key={ac.icao24}>
                  <label className={`flight-option ${checked ? 'checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(ac.icao24)}
                    />
                    <span className="mono flight-option-call">{callsignOf(ac)}</span>
                    <span className="mono flight-option-icao">{ac.icao24}</span>
                  </label>
                </li>
              )
            })}
          </ul>

          <p className="flight-filter-foot mono">
            {total > matches.length
              ? `${matches.length} of ${total.toLocaleString()} — keep typing`
              : `${total.toLocaleString()} in view`}
            {watched.length === 0 ? ' · empty selection shows all' : ''}
          </p>
        </div>
      )}
    </div>
  )
}
