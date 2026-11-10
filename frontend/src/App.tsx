import { useEffect, useMemo, useState } from 'react'
import { AlertRail } from './AlertRail'
import { DetailPanel } from './DetailPanel'
import { FlightFilter } from './FlightFilter'
import { MapView } from './MapView'
import { StatusStrip } from './StatusStrip'
import { useLiveData } from './useLiveData'

export default function App() {
  const { snapshot, conn, flashIcaos } = useLiveData()
  const [selected, setSelected] = useState<string | null>(null)
  const [watched, setWatched] = useState<string[]>([])

  const watchSet = useMemo(() => new Set(watched), [watched])
  const monitoring = watchSet.size > 0

  const visibleAircraft = useMemo(
    () =>
      monitoring
        ? snapshot.aircraft.filter((ac) => watchSet.has(ac.icao24))
        : snapshot.aircraft,
    [snapshot.aircraft, monitoring, watchSet],
  )

  const visibleAlerts = useMemo(
    () =>
      monitoring
        ? snapshot.alerts.filter((alert) => watchSet.has(alert.icao24))
        : snapshot.alerts,
    [snapshot.alerts, monitoring, watchSet],
  )

  const focusKey = useMemo(
    () => (monitoring ? [...watched].sort().join(',') : ''),
    [monitoring, watched],
  )

  useEffect(() => {
    if (selected && monitoring && !watchSet.has(selected)) setSelected(null)
  }, [selected, monitoring, watchSet])

  const selectedAircraft = useMemo(
    () => visibleAircraft.find((a) => a.icao24 === selected) ?? null,
    [visibleAircraft, selected],
  )

  const lastAlert = useMemo(
    () => visibleAlerts.find((a) => a.icao24 === selected),
    [visibleAlerts, selected],
  )

  const toggleWatch = (icao24: string) => {
    setWatched((prev) =>
      prev.includes(icao24) ? prev.filter((id) => id !== icao24) : [...prev, icao24],
    )
  }

  return (
    <div className="ops-shell">
      <StatusStrip conn={conn} snapshot={snapshot} />
      <main className="ops-main">
        <div className="map-stage">
          <MapView
            aircraft={visibleAircraft}
            flashIcaos={flashIcaos}
            selected={selected}
            focusKey={focusKey}
            onSelect={setSelected}
          />
          <FlightFilter
            aircraft={snapshot.aircraft}
            watched={watched}
            onToggle={toggleWatch}
            onClear={() => setWatched([])}
          />
          <DetailPanel
            aircraft={selectedAircraft}
            lastAlert={lastAlert}
            onClose={() => setSelected(null)}
          />
        </div>
        <AlertRail
          alerts={visibleAlerts}
          selected={selected}
          onSelect={setSelected}
        />
      </main>
    </div>
  )
}
