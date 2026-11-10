import type { ConnState, Snapshot } from './types'

interface Props {
  conn: ConnState
  snapshot: Snapshot
}

function formatTime(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString(undefined, { hour12: false })
}

export function StatusStrip({ conn, snapshot }: Props) {
  return (
    <header className="status-strip">
      <div className="brand">
        <span className="brand-mark">CS</span>
        <div className="brand-text">
          <strong>COUNTER-STRIKE</strong>
          <span>Live Air Picture</span>
        </div>
      </div>

      <div className="metrics">
        <div className="metric">
          <span className="label">Link</span>
          <span className={`value conn conn-${conn}`}>{conn.toUpperCase()}</span>
        </div>
        <div className="metric">
          <span className="label">Tracks</span>
          <span className="value mono">{snapshot.count}</span>
        </div>
        <div className="metric">
          <span className="label">Alerts</span>
          <span className="value mono">{snapshot.alert_count}</span>
        </div>
        <div className="metric">
          <span className="label">Updated</span>
          <span className="value mono">{formatTime(snapshot.last_poll)}</span>
        </div>
        <div className="metric">
          <span className="label">Feed</span>
          <span className={`value ${snapshot.poll_ok ? 'ok' : 'bad'}`}>
            {snapshot.poll_ok ? 'NOMINAL' : 'DEGRADED'}
          </span>
        </div>
      </div>
    </header>
  )
}
