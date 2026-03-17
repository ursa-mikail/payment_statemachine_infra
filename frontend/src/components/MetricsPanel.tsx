import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import type { SystemMetrics } from '../types'

const RAIL_COLORS: Record<string, string> = {
  ETHEREUM: '#a78bfa', POLYGON: '#818cf8', SOLANA: '#38bdf8',
  STELLAR: '#2dd4bf', ACH: '#8b9ab0', CARD: '#c084fc',
}

interface Props {
  metrics: SystemMetrics
  volumeHistory: number[]
}

const fmtVol = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M`
  : n >= 1_000   ? `$${(n / 1_000).toFixed(1)}k`
  : `$${n.toFixed(0)}`

function MetricCard({ label, value, color, sub }: { label: string; value: string | number; color?: string; sub?: string }) {
  return (
    <div style={{
      background: 'var(--bg-2)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 12px',
    }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)', letterSpacing: '0.12em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 500, lineHeight: 1, color: color ?? 'var(--text-0)' }}>{value}</div>
      {sub && <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export function MetricsPanel({ metrics, volumeHistory }: Props) {
  const sparkData = volumeHistory.map((v, i) => ({ v, i }))
  const total = metrics.total_intents || 1
  const successRate = ((metrics.succeeded_intents / total) * 100).toFixed(1)

  return (
    <div style={{
      width: 272, minWidth: 272,
      background: 'var(--bg-1)', borderRight: '1px solid var(--border)',
      overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 16,
    }}>
      {/* Overview */}
      <section>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)', letterSpacing: '0.14em', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>SYSTEM OVERVIEW</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <MetricCard label="TOTAL" value={metrics.total_intents} color="var(--blue)" />
          <MetricCard label="PENDING" value={metrics.pending_intents} color="var(--amber)" />
          <MetricCard label="SETTLED" value={metrics.succeeded_intents} color="var(--green)" />
          <MetricCard label="FAILED" value={metrics.failed_intents} color="var(--red)" />
        </div>
      </section>

      {/* Volume + sparkline */}
      <section>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)', letterSpacing: '0.14em', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>VOLUME</div>
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)', letterSpacing: '0.1em', marginBottom: 2 }}>TOTAL PROCESSED</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 24, fontWeight: 600, color: 'var(--text-0)' }}>{fmtVol(metrics.total_volume)}</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--green)', marginTop: 4 }}>SR {successRate}%</div>
        </div>
        <div style={{ height: 48, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', padding: '4px 0' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkData} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
              <defs>
                <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--green)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--green)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke="var(--green)" strokeWidth={1.5} fill="url(#volGrad)" dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Rails */}
      <section>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)', letterSpacing: '0.14em', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>RAIL STATUS</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.entries(metrics.by_rail).sort((a, b) => b[1].count - a[1].count).map(([rail, m]) => {
            const color = RAIL_COLORS[rail] ?? '#8b9ab0'
            const barW = m.count ? Math.min(m.success_rate, 100) : 0
            return (
              <div key={rail} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 11px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500, color }}>{rail}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-1)' }}>{m.count} txns</span>
                </div>
                <div style={{ height: 2, background: 'var(--bg-4)', borderRadius: 1, marginBottom: 5 }}>
                  <div style={{ height: '100%', width: `${barW}%`, background: color, borderRadius: 1, transition: 'width 0.5s ease' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)' }}>SR {m.success_rate.toFixed(0)}%</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)' }}>{fmtVol(m.volume)}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)' }}>{m.avg_lat_ms.toFixed(0)}ms</span>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Outbox + Discrepancy */}
      <section>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)', letterSpacing: '0.14em', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>DURABILITY</div>
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 11px', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)', letterSpacing: '0.1em' }}>OUTBOX PENDING</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 500, color: metrics.outbox_pending > 5 ? 'var(--amber)' : 'var(--green)' }}>{metrics.outbox_pending}</div>
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)' }}>msgs</div>
        </div>
        <div style={{ background: 'var(--bg-2)', border: `1px solid ${metrics.discrepancy > 10 ? 'var(--red)' : 'var(--border)'}`, borderRadius: 6, padding: '9px 11px' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: metrics.discrepancy > 10 ? 'var(--red)' : 'var(--text-2)', letterSpacing: '0.1em' }}>LEDGER DISCREPANCY</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 500, color: metrics.discrepancy > 10 ? 'var(--red)' : 'var(--green)' }}>
            ${metrics.discrepancy.toFixed(2)}
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)', marginTop: 2 }}>provider delta</div>
        </div>
      </section>
    </div>
  )
}
