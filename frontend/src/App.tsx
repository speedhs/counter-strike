import { useMemo, useState } from 'react'
import { AlertRail } from './AlertRail'
import { DetailPanel } from './DetailPanel'
import { MapView } from './MapView'
import { StatusStrip } from './StatusStrip'
import { useLiveData } from './useLiveData'

export default function App() {
  const { snapshot, conn, flashIcaos } = useLiveData()
  const [selected, setSelected] = useState<string | null>(null)

  const selectedAircraft = useMemo(
    () => snapshot.aircraft.find((a) => a.icao24 === selected) ?? null,
    [snapshot.aircraft, selected],
  )

  const lastAlert = useMemo(
    () => snapshot.alerts.find((a) => a.icao24 === selected),
    [snapshot.alerts, selected],
  )

  return (
    <div className="ops-shell">
      <StatusStrip conn={conn} snapshot={snapshot} />
      <main className="ops-main">
        <div className="map-stage">
          <MapView
            aircraft={snapshot.aircraft}
            flashIcaos={flashIcaos}
            selected={selected}
            onSelect={setSelected}
          />
          <DetailPanel
            aircraft={selectedAircraft}
            lastAlert={lastAlert}
            onClose={() => setSelected(null)}
          />
        </div>
        <AlertRail
          alerts={snapshot.alerts}
          selected={selected}
          onSelect={setSelected}
        />
      </main>
    </div>
  )
}
