import type { Aircraft, Alert } from './types'

interface Props {
  aircraft: Aircraft | null
  lastAlert: Alert | undefined
  onClose: () => void
}

function fmtAlt(m: number): string {
  return `${Math.round(m)} m / ${Math.round(m * 3.28084)} ft`
}

function fmtSpd(ms: number): string {
  return `${ms.toFixed(1)} m/s / ${(ms * 1.94384).toFixed(0)} kt`
}

export function DetailPanel({ aircraft, lastAlert, onClose }: Props) {
  if (!aircraft) return null

  const callsign = (aircraft.callsign || '').trim() || '——'

  return (
    <div className="detail-panel">
      <div className="detail-head">
        <div>
          <p className="eyebrow">Selected track</p>
          <h3 className="mono">{aircraft.icao24}</h3>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <dl className="detail-grid">
        <div>
          <dt>Callsign</dt>
          <dd className="mono">{callsign}</dd>
        </div>
        <div>
          <dt>Heading</dt>
          <dd className="mono">{aircraft.heading.toFixed(0)}°</dd>
        </div>
        <div>
          <dt>Altitude</dt>
          <dd className="mono">{fmtAlt(aircraft.alt)}</dd>
        </div>
        <div>
          <dt>Ground speed</dt>
          <dd className="mono">{fmtSpd(aircraft.velocity)}</dd>
        </div>
        <div>
          <dt>Vertical rate</dt>
          <dd className="mono">{aircraft.v_rate.toFixed(1)} m/s</dd>
        </div>
        <div>
          <dt>Position</dt>
          <dd className="mono">
            {aircraft.lat.toFixed(4)}, {aircraft.lon.toFixed(4)}
          </dd>
        </div>
      </dl>
      {lastAlert && (
        <div className={`last-alert kind-${lastAlert.kind}`}>
          <span>Last anomaly</span>
          <strong>
            {lastAlert.kind} ·{' '}
            {lastAlert.kind === 'heading'
              ? `${lastAlert.value.toFixed(1)}°/s`
              : `${lastAlert.value.toFixed(1)} m/s`}
          </strong>
        </div>
      )}
    </div>
  )
}
