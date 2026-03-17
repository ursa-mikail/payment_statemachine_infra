import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import type { SystemMetrics, AuditEvent } from '../types'
import { formatDistanceToNow } from 'date-fns'

interface Props {
  metrics: SystemMetrics
  audit: AuditEvent[]
}

const EVENT_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  INTENT_CREATED:   { bg: 'rgba(56,189,248,0.1)',   color: '#38bdf8', label: 'CREATED' },
  INTENT_FINALIZED: { bg: 'rgba(0,229,160,0.1)',    color: '#00e5a0', label: 'FINALIZED' },
  ATTEMPT_UPDATED:  { bg: 'rgba(167,139,250,0.1)',  color: '#a78bfa', label: 'ATTEMPT' },
  TRAVEL_RULE_UPDATE:{ bg: 'rgba(251,191,36,0.1)',  color: '#fbbf24', label: 'TRAVEL RULE' },
}

export function RightPanel({ metrics, audit }: Props) {
  const tr = metrics.travel_rule
  const trTotal = tr.verified + tr.rejected + tr.pending
  const acceptRate = trTotal > 0 ? (tr.verified / trTotal * 100) : 0

  const pieData = [
    { name: 'Verified', value: tr.verified, color: '#00e5a0' },
    { name: 'Rejected', value: tr.rejected, color: '#ff4d6a' },
    { name: 'Pending',  value: tr.pending,  color: '#fbbf24' },
    { name: 'Exempt',   value: tr.exempt,   color: '#4a5a70' },
  ].filter(d => d.value > 0)

  return (
    <div style={{
      width: 308, minWidth: 308,
      background: 'var(--bg-1)', borderLeft: '1px solid var(--border)',
      overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 16,
    }}>
      {/* Travel Rule */}
      <section>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)', letterSpacing: '0.14em', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>TRAVEL RULE COMPLIANCE</div>

        {/* Stat grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
          {[
            { l: 'VERIFIED', v: tr.verified, c: 'var(--green)' },
            { l: 'PENDING',  v: tr.pending,  c: 'var(--amber)' },
            { l: 'REJECTED', v: tr.rejected, c: 'var(--red)' },
            { l: 'EXEMPT',   v: tr.exempt,   c: 'var(--text-2)' },
          ].map(s => (
            <div key={s.l} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 500, color: s.c }}>{s.v}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)', letterSpacing: '0.1em', marginTop: 2 }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* Pie */}
        {pieData.length > 0 && (
          <div style={{ height: 120, marginBottom: 10 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={30} outerRadius={50} dataKey="value" strokeWidth={0} isAnimationActive={false}>
                  {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 11 }}
                  itemStyle={{ color: 'var(--text-0)' }}
                  labelStyle={{ color: 'var(--text-2)' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Accept rate bar */}
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)', letterSpacing: '0.1em' }}>ACCEPTANCE RATE</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500, color: acceptRate > 90 ? 'var(--green)' : 'var(--amber)' }}>{acceptRate.toFixed(1)}%</span>
          </div>
          <div style={{ height: 4, background: 'var(--bg-4)', borderRadius: 2 }}>
            <div style={{ height: '100%', width: `${Math.min(acceptRate, 100)}%`, background: acceptRate > 90 ? 'var(--green)' : 'var(--amber)', borderRadius: 2, transition: 'width 0.6s ease' }} />
          </div>
          <div style={{ marginTop: 6, fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)' }}>
            total exchanges: {tr.total}
          </div>
        </div>
      </section>

      {/* Audit Trail */}
      <section>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)', letterSpacing: '0.14em', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>AUDIT TRAIL</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {audit.slice(0, 40).map(ev => {
            const s = EVENT_STYLE[ev.event_type] ?? { bg: 'rgba(139,154,176,0.1)', color: '#8b9ab0', label: ev.event_type }
            const ts = new Date(ev.timestamp)
            return (
              <div key={ev.id} className="fade-up" style={{ display: 'flex', gap: 8, padding: '7px 10px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 5, alignItems: 'flex-start' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)', minWidth: 56, flexShrink: 0, paddingTop: 1 }}>
                  {ts.toTimeString().slice(0, 8)}
                </span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 9, background: s.bg, color: s.color, padding: '1px 5px', borderRadius: 3, minWidth: 84, textAlign: 'center', flexShrink: 0 }}>
                  {s.label}
                </span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {ev.detail}
                </span>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
