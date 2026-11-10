import { useCallback, useEffect, useRef, useState } from 'react'
import type { Alert, ConnState, Snapshot } from './types'

const emptySnapshot: Snapshot = {
  aircraft: [],
  alerts: [],
  last_poll: '',
  poll_ok: false,
  count: 0,
  alert_count: 0,
}

export function useLiveData() {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot)
  const [conn, setConn] = useState<ConnState>('connecting')
  const [flashIcaos, setFlashIcaos] = useState<Set<string>>(new Set())
  const flashTimers = useRef<Map<string, number>>(new Map())
  const wsRef = useRef<WebSocket | null>(null)
  const retryRef = useRef(0)

  const flash = useCallback((icao: string) => {
    setFlashIcaos((prev) => new Set(prev).add(icao))
    const existing = flashTimers.current.get(icao)
    if (existing) window.clearTimeout(existing)
    const t = window.setTimeout(() => {
      setFlashIcaos((prev) => {
        const next = new Set(prev)
        next.delete(icao)
        return next
      })
      flashTimers.current.delete(icao)
    }, 4000)
    flashTimers.current.set(icao, t)
  }, [])

  useEffect(() => {
    let cancelled = false
    let retryTimer: number | undefined

    async function loadSnapshot() {
      try {
        const res = await fetch('/api/snapshot')
        if (!res.ok) return
        const data = (await res.json()) as Snapshot
        if (!cancelled) setSnapshot(data)
      } catch {
        /* ignore; WS will retry */
      }
    }

    function connect() {
      if (cancelled) return
      setConn(retryRef.current === 0 ? 'connecting' : 'reconnecting')
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${window.location.host}/ws`)
      wsRef.current = ws

      ws.onopen = () => {
        retryRef.current = 0
        if (!cancelled) setConn('live')
        void loadSnapshot()
      }

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as {
            type: string
            data: Snapshot | Alert
          }
          if (msg.type === 'tick') {
            setSnapshot(msg.data as Snapshot)
          } else if (msg.type === 'alert') {
            const alert = msg.data as Alert
            flash(alert.icao24)
            setSnapshot((prev) => ({
              ...prev,
              alerts: [alert, ...prev.alerts].slice(0, 100),
              alert_count: Math.min(100, prev.alert_count + 1),
            }))
          }
        } catch {
          /* ignore bad frames */
        }
      }

      ws.onclose = () => {
        if (cancelled) return
        setConn('reconnecting')
        const delay = Math.min(1000 * 2 ** retryRef.current, 15000)
        retryRef.current += 1
        retryTimer = window.setTimeout(connect, delay)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    void loadSnapshot()
    connect()

    return () => {
      cancelled = true
      if (retryTimer) window.clearTimeout(retryTimer)
      wsRef.current?.close()
      flashTimers.current.forEach((t) => window.clearTimeout(t))
    }
  }, [flash])

  return { snapshot, conn, flashIcaos }
}
