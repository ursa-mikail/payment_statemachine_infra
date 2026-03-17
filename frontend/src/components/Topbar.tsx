import type { SystemMetrics } from '../types'

interface Props { metrics: SystemMetrics; connected: boolean }

const fmt = (n: number, dec = 0) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M`
  : n >= 1_000   ? `$${(n / 1_000).toFixed(1)}k`
  : `$${n.toFixed(dec)}`

export function Topbar({ metrics, connected }: Props) {
  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px', height: 52,
      background: 'var(--bg-1)',
      borderBottom: '1px solid var(--border)',
      position: 'sticky', top: 0, zIndex: 100,
    }}>
      {/* Left */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 500, letterSpacing: '0.05em', color: 'var(--text-0)' }}>
          <span style={{ color: 'var(--green)' }}>⬡</span> RAMP / PAYMENTS
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em',
          color: connected ? 'var(--green)' : 'var(--red)',
          background: connected ? 'rgba(0,229,160,0.08)' : 'rgba(255,77,106,0.08)',
          border: `1px solid ${connected ? 'rgba(0,229,160,0.25)' : 'rgba(255,77,106,0.25)'}`,
          borderRadius: 4, padding: '2px 8px',
        }}>
          <span className="live-dot" style={{ background: connected ? 'var(--green)' : 'var(--red)' }} />
          {connected ? 'LIVE' : 'RECONNECTING'}
        </div>
      </div>

      {/* Center stats */}
      <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
        {[
          { label: 'THROUGHPUT', value: `${metrics.throughput_per_sec.toFixed(1)}/s` },
          { label: 'TOTAL VOLUME', value: fmt(metrics.total_volume) },
          { label: 'AVG SETTLE', value: metrics.avg_settlement_ms ? `${(metrics.avg_settlement_ms / 1000).toFixed(1)}s` : '—' },
          { label: 'DISCREPANCY', value: fmt(metrics.discrepancy, 2), color: metrics.discrepancy > 10 ? 'var(--red)' : 'var(--green)' },
        ].map(s => (
          <div key={s.label} style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)', letterSpacing: '0.12em', marginBottom: 1 }}>{s.label}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 500, color: s.color ?? 'var(--text-0)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Right */}
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-2)' }}>
        {new Date().toLocaleTimeString()}
      </div>
    </header>
  )
}
