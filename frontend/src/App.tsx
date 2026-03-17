import { useState, useEffect, useRef } from 'react'
import { Topbar } from './components/Topbar'
import { MetricsPanel } from './components/MetricsPanel'
import { IntentFeed } from './components/IntentFeed'
import { RightPanel } from './components/RightPanel'
import type { SystemMetrics, PaymentIntent, AuditEvent } from './types'

// In Docker: nginx proxies /api/* → backend:8080/*
// In dev:    Vite proxy does the same from localhost:3000/api → localhost:8080
const API = '/api'

const EMPTY_METRICS: SystemMetrics = {
  total_intents: 0, pending_intents: 0, succeeded_intents: 0, failed_intents: 0,
  total_volume: 0, by_rail: {} as any, travel_rule: { total: 0, verified: 0, rejected: 0, pending: 0, exempt: 0 },
  avg_settlement_ms: 0, outbox_pending: 0, discrepancy: 0, throughput_per_sec: 0,
  timestamp: new Date().toISOString(),
}

function useSSE<T>(path: string, initial: T): [T, boolean] {
  const [data, setData] = useState<T>(initial)
  const [connected, setConnected] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const connect = () => {
      const es = new EventSource(`${API}${path}`)
      esRef.current = es
      es.onopen = () => setConnected(true)
      es.onmessage = (e) => {
        try { setData(JSON.parse(e.data)) } catch {}
      }
      es.onerror = () => {
        setConnected(false)
        es.close()
        retryRef.current = setTimeout(connect, 2500)
      }
    }
    connect()
    return () => {
      esRef.current?.close()
      if (retryRef.current) clearTimeout(retryRef.current)
    }
  }, [path])

  return [data, connected]
}

function useSSEList<T>(path: string): T[] {
  const [data, setData] = useState<T[]>([])
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const connect = () => {
      const es = new EventSource(`${API}${path}`)
      esRef.current = es
      es.onmessage = (e) => {
        try { setData(JSON.parse(e.data) ?? []) } catch {}
      }
      es.onerror = () => {
        es.close()
        setTimeout(connect, 2500)
      }
    }
    connect()
    return () => esRef.current?.close()
  }, [path])

  return data
}

const MAX_HISTORY = 60

export default function App() {
  const [metrics, connected] = useSSE<SystemMetrics>('/stream', EMPTY_METRICS)
  const intents = useSSEList<PaymentIntent>('/stream/intents')
  const audit   = useSSEList<AuditEvent>('/stream/audit')

  // Rolling 60-point volume history for sparkline
  const volHistory = useRef<number[]>(Array(MAX_HISTORY).fill(0))
  const lastVol = useRef(0)
  useEffect(() => {
    if (metrics.total_volume !== lastVol.current) {
      const delta = Math.max(0, metrics.total_volume - lastVol.current)
      lastVol.current = metrics.total_volume
      volHistory.current = [...volHistory.current.slice(1), delta]
    }
  }, [metrics.total_volume])

  // Clock tick to keep topbar time fresh
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg-0)' }}>
      <Topbar metrics={metrics} connected={connected} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <MetricsPanel metrics={metrics} volumeHistory={[...volHistory.current]} />
        <IntentFeed intents={intents} />
        <RightPanel metrics={metrics} audit={audit} />
      </div>
    </div>
  )
}
