import type { Alert } from './types'

interface Props {
  alerts: Alert[]
  onSelect: (icao24: string) => void
  selected: string | null
}

function formatAlertValue(a: Alert): string {
  if (a.kind === 'heading') return `${a.value.toFixed(1)}°/s`
  return `${a.value.toFixed(1)} m/s`
}

function formatTs(ts: number): string {
  if (!ts) return '—'
  // OpenSky times are unix seconds
  const ms = ts > 1e12 ? ts : ts * 1000
  return new Date(ms).toLocaleTimeString(undefined, { hour12: false })
}

export function AlertRail({ alerts, onSelect, selected }: Props) {
  return (
    <aside className="alert-rail">
      <div className="rail-head">
        <h2>Anomaly feed</h2>
        <span className="rail-sub">Heading &gt; 8°/s · Alt rate &gt; 35 m/s</span>
      </div>
      <ul className="alert-list">
        {alerts.length === 0 && (
          <li className="alert-empty">Awaiting anomalous tracks…</li>
        )}
        {alerts.map((a, i) => (
          <li key={`${a.icao24}-${a.ts}-${a.kind}-${i}`}>
            <button
              type="button"
              className={`alert-item ${selected === a.icao24 ? 'active' : ''} kind-${a.kind}`}
              onClick={() => onSelect(a.icao24)}
            >
              <span className="alert-kind">{a.kind}</span>
              <span className="alert-icao mono">{a.icao24}</span>
              <span className="alert-val mono">{formatAlertValue(a)}</span>
              <span className="alert-ts mono">{formatTs(a.ts)}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
