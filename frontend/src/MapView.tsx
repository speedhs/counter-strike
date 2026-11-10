import { useEffect, useRef } from 'react'
import {
  LngLatBounds,
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
  focusKey: string
  onSelect: (icao24: string | null) => void
}

function tracePlane(ctx: CanvasRenderingContext2D) {
  ctx.beginPath()
  ctx.moveTo(0, -13)
  ctx.lineTo(2.1, -3.2)
  ctx.lineTo(12.2, 1.4)
  ctx.lineTo(12.2, 3.6)
  ctx.lineTo(2.4, 1.5)
  ctx.lineTo(1.8, 6.4)
  ctx.lineTo(6.4, 10.6)
  ctx.lineTo(6.4, 12.6)
  ctx.lineTo(0, 10.2)
  ctx.lineTo(-6.4, 12.6)
  ctx.lineTo(-6.4, 10.6)
  ctx.lineTo(-1.8, 6.4)
  ctx.lineTo(-2.4, 1.5)
  ctx.lineTo(-12.2, 3.6)
  ctx.lineTo(-12.2, 1.4)
  ctx.lineTo(-2.1, -3.2)
  ctx.closePath()
}

function aircraftImage(fill: string): ImageData {
  const logical = 32
  const ratio = 2
  const canvas = document.createElement('canvas')
  canvas.width = logical * ratio
  canvas.height = logical * ratio
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.scale(ratio, ratio)
  ctx.translate(logical / 2, logical / 2)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  tracePlane(ctx)
  ctx.strokeStyle = '#0b0f0c'
  ctx.lineWidth = 2.2
  ctx.stroke()
  ctx.fillStyle = fill
  ctx.fill()
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
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

export function MapView({ aircraft, flashIcaos, selected, focusKey, onSelect }: Props) {
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
        clusterMaxZoom: 4,
        clusterRadius: 48,
      })

      map.addImage('ac', aircraftImage('#d5e2c8'), { pixelRatio: 2 })
      map.addImage('ac-selected', aircraftImage('#9ec27a'), { pixelRatio: 2 })
      map.addImage('ac-alert', aircraftImage('#e8b84a'), { pixelRatio: 2 })

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

      const planeLayout = {
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      } as const

      map.addLayer({
        id: 'aircraft-icons',
        type: 'symbol',
        source: 'aircraft',
        filter: [
          'all',
          ['!', ['has', 'point_count']],
          ['!=', ['get', 'selected'], 1],
        ],
        layout: {
          ...planeLayout,
          'icon-image': [
            'case',
            ['==', ['get', 'flash'], 1],
            'ac-alert',
            'ac',
          ],
          'icon-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            3,
            0.48,
            6,
            0.7,
            9,
            0.95,
          ],
        },
      })

      map.addLayer({
        id: 'aircraft-selected',
        type: 'symbol',
        source: 'aircraft',
        filter: [
          'all',
          ['!', ['has', 'point_count']],
          ['==', ['get', 'selected'], 1],
        ],
        layout: {
          ...planeLayout,
          'icon-image': 'ac-selected',
          'icon-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            3,
            0.66,
            6,
            0.95,
            9,
            1.25,
          ],
        },
      })

      map.addLayer({
        id: 'aircraft-labels',
        type: 'symbol',
        source: 'aircraft',
        filter: ['!', ['has', 'point_count']],
        minzoom: 6,
        layout: {
          'text-field': ['get', 'callsign'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-offset': [0, 1.15],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: {
          'text-color': '#d7e0cc',
          'text-halo-color': '#0b0f0c',
          'text-halo-width': 1.2,
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

      const selectAircraft = (e: MapLayerMouseEvent) => {
        const icao = e.features?.[0]?.properties?.icao24 as string | undefined
        if (icao) onSelectRef.current(icao)
      }
      map.on('click', 'aircraft-icons', selectAircraft)
      map.on('click', 'aircraft-selected', selectAircraft)

      map.on('click', 'aircraft-labels', (e: MapLayerMouseEvent) => {
        const icao = e.features?.[0]?.properties?.icao24 as string | undefined
        if (icao) onSelectRef.current(icao)
      })

      map.on('click', (e: MapMouseEvent) => {
        const hits = map.queryRenderedFeatures(e.point, {
          layers: ['aircraft-icons', 'aircraft-selected', 'aircraft-labels', 'clusters'],
        })
        if (!hits.length) onSelectRef.current(null)
      })

      for (const layer of ['clusters', 'aircraft-icons', 'aircraft-selected', 'aircraft-labels']) {
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

  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current || !selected) return
    const ac = dataRef.current.aircraft.find((a) => a.icao24 === selected)
    if (!ac) return
    map.easeTo({
      center: [ac.lon, ac.lat],
      zoom: Math.max(map.getZoom(), 6.2),
      duration: 700,
    })
  }, [selected])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current || !focusKey) return
    const points = dataRef.current.aircraft
    if (!points.length) return
    if (points.length === 1) {
      map.easeTo({
        center: [points[0].lon, points[0].lat],
        zoom: Math.max(map.getZoom(), 6.2),
        duration: 700,
      })
      return
    }
    const bounds = new LngLatBounds()
    for (const ac of points) bounds.extend([ac.lon, ac.lat])
    map.fitBounds(bounds, {
      padding: { top: 72, bottom: 64, left: 48, right: 48 },
      maxZoom: 7,
      duration: 700,
    })
  }, [focusKey])

  return <div className="map-root" ref={containerRef} />
}
