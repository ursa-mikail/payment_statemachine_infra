import { useState, useEffect, useRef } from 'react'

// In Docker: nginx proxies /api/* → backend:8080/*
// In dev:    Vite proxy does the same
const API = '/api'

export function useSSE<T>(path: string, initial: T): T {
  const [data, setData] = useState<T>(initial)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource(`${API}${path}`)
    esRef.current = es
    es.onmessage = (e) => {
      try { setData(JSON.parse(e.data)) } catch {}
    }
    es.onerror = () => {
      es.close()
      // Reconnect after 2s
      setTimeout(() => {
        esRef.current = new EventSource(`${API}${path}`)
      }, 2000)
    }
    return () => { es.close() }
  }, [path])

  return data
}

export function useFetch<T>(path: string, initial: T, intervalMs = 2000): T {
  const [data, setData] = useState<T>(initial)
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API}${path}`)
        if (res.ok) setData(await res.json())
      } catch {}
    }
    load()
    const id = setInterval(load, intervalMs)
    return () => clearInterval(id)
  }, [path, intervalMs])
  return data
}
