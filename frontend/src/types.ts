export type AlertKind = 'heading' | 'altitude'

export interface Aircraft {
  icao24: string
  callsign: string
  lat: number
  lon: number
  alt: number
  heading: number
  velocity: number
  v_rate: number
  on_ground: boolean
  time: number
}

export interface Alert {
  icao24: string
  kind: AlertKind
  value: number
  ts: number
}

export interface Snapshot {
  aircraft: Aircraft[]
  alerts: Alert[]
  last_poll: string
  poll_ok: boolean
  count: number
  alert_count: number
}

export type ConnState = 'connecting' | 'live' | 'reconnecting' | 'offline'
