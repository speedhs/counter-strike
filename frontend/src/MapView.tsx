import { useEffect, useRef } from 'react'
import {
  Map,
  NavigationControl,
  AttributionControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type MapMouseEvent,
} from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Aircraft } from './types'

// Vite prebundles maplibre-gl, so the default worker URL points at a file
// that does not exist next to the bundle. Point it at the real worker.
setWorkerUrl(maplibreWorkerUrl)

interface Props {
  aircraft: Aircraft[]
  flashIcaos: Set<string>
  selected: string | null
  onSelect: (icao24: string | null) => void
}

function toFeatureCollection(
  aircraft: Aircraft[],
  flashIcaos: Set<string>,
  selected: string | null,
) {
  return {
    type: 'FeatureCollection' as const,
    features: aircraft.map((ac) => ({
      type: 'Feature' as const,
      properties: {
        icao24: ac.icao24,
        callsign: (ac.callsign || '').trim() || ac.icao24,
        heading: ac.heading,
        alt: ac.alt,
        flash: flashIcaos.has(ac.icao24) ? 1 : 0,
        selected: selected === ac.icao24 ? 1 : 0,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [ac.lon, ac.lat],
      },
    })),
  }
}

export function MapView({ aircraft, flashIcaos, selected, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const readyRef = useRef(false)
  const onSelectRef = useRef(onSelect)
  const dataRef = useRef({ aircraft, flashIcaos, selected })
  onSelectRef.current = onSelect
  dataRef.current = { aircraft, flashIcaos, selected }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const map = new Map({
      container: el,
      // CARTO's anonymous raster CDN now returns "API KEY REQUIRED" tiles.
      // OpenFreeMap's dark vector style is keyless and stays in the same palette.
      style: 'https://tiles.openfreemap.org/styles/dark',
      center: [10, 20],
      zoom: 1.6,
      attributionControl: false,
    })

    map.addControl(new NavigationControl({ visualizePitch: false }), 'bottom-left')
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')

    const pushData = () => {
      const src = map.getSource('aircraft') as GeoJSONSource | undefined
      if (!src) return
      const d = dataRef.current
      src.setData(toFeatureCollection(d.aircraft, d.flashIcaos, d.selected))
    }

    map.on('load', () => {
      map.addSource('aircraft', {
        type: 'geojson',
        data: toFeatureCollection([], new Set(), null),
        cluster: true,
        clusterMaxZoom: 8,
        clusterRadius: 42,
      })

      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'aircraft',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#6f8a55',
          'circle-stroke-color': '#9ec27a',
          'circle-stroke-width': 1.2,
          'circle-opacity': 0.85,
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            14,
            25,
            18,
            100,
            24,
            500,
            30,
          ],
        },
      })

      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'aircraft',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#0b0f0c',
        },
      })

      map.addLayer({
        id: 'aircraft-glow',
        type: 'circle',
        source: 'aircraft',
        filter: [
          'all',
          ['!', ['has', 'point_count']],
          ['==', ['get', 'flash'], 1],
        ],
        paint: {
          'circle-radius': 12,
          'circle-color': '#e8b84a',
          'circle-opacity': 0.35,
          'circle-blur': 0.5,
        },
      })

      map.addLayer({
        id: 'aircraft-points',
        type: 'circle',
        source: 'aircraft',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            1,
            2.2,
            4,
            3.5,
            8,
            5.5,
          ],
          'circle-color': [
            'case',
            ['==', ['get', 'selected'], 1],
            '#9ec27a',
            ['==', ['get', 'flash'], 1],
            '#e8b84a',
            '#c6d2b8',
          ],
          'circle-stroke-width': 1,
          'circle-stroke-color': '#0b0f0c',
          'circle-opacity': 0.95,
        },
      })

      map.on('click', 'clusters', (e: MapLayerMouseEvent) => {
        const feature = e.features?.[0]
        const clusterId = feature?.properties?.cluster_id as number | undefined
        const src = map.getSource('aircraft') as GeoJSONSource
        if (clusterId == null || !feature) return
        src.getClusterExpansionZoom(clusterId).then((zoom) => {
          const geometry = feature.geometry as {
            type: string
            coordinates: [number, number]
          }
          map.easeTo({ center: geometry.coordinates, zoom })
        })
      })

      map.on('click', 'aircraft-points', (e: MapLayerMouseEvent) => {
        const icao = e.features?.[0]?.properties?.icao24 as string | undefined
        if (icao) onSelectRef.current(icao)
      })

      map.on('click', (e: MapMouseEvent) => {
        const hits = map.queryRenderedFeatures(e.point, {
          layers: ['aircraft-points', 'clusters'],
        })
        if (!hits.length) onSelectRef.current(null)
      })

      for (const layer of ['clusters', 'aircraft-points']) {
        map.on('mouseenter', layer, () => {
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', layer, () => {
          map.getCanvas().style.cursor = ''
        })
      }

      readyRef.current = true
      map.resize()
      pushData()
    })

    mapRef.current = map

    const ro = new ResizeObserver(() => {
      map.resize()
    })
    ro.observe(el)

    // Layout may settle after first paint (grid/flex).
    requestAnimationFrame(() => map.resize())
    const t = window.setTimeout(() => map.resize(), 100)

    return () => {
      window.clearTimeout(t)
      ro.disconnect()
      readyRef.current = false
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const src = map.getSource('aircraft') as GeoJSONSource | undefined
    if (!src) return
    src.setData(toFeatureCollection(aircraft, flashIcaos, selected))
  }, [aircraft, flashIcaos, selected])

  return <div className="map-root" ref={containerRef} />
}
