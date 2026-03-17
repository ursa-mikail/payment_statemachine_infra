import { useState } from 'react'
import type { PaymentIntent, IntentState, TravelRuleState } from '../types'
import { formatDistanceToNow } from 'date-fns'

const RAIL_STYLE: Record<string, { bg: string; color: string }> = {
  ETHEREUM: { bg: 'rgba(167,139,250,0.12)', color: '#a78bfa' },
  POLYGON:  { bg: 'rgba(129,140,248,0.12)', color: '#818cf8' },
  SOLANA:   { bg: 'rgba(56,189,248,0.12)',  color: '#38bdf8' },
  STELLAR:  { bg: 'rgba(45,212,191,0.12)',  color: '#2dd4bf' },
  ACH:      { bg: 'rgba(139,154,176,0.12)', color: '#8b9ab0' },
  CARD:     { bg: 'rgba(192,132,252,0.12)', color: '#c084fc' },
}

const RAIL_SHORT: Record<string, string> = {
  ETHEREUM: 'ETH', POLYGON: 'POL', SOLANA: 'SOL', STELLAR: 'STL', ACH: 'ACH', CARD: 'CRD',
}

const STATE_COLOR: Record<IntentState, string> = {
  PENDING: 'var(--amber)', SUCCEEDED: 'var(--green)', FAILED: 'var(--red)',
}

const TR_COLOR: Record<TravelRuleState, string> = {
  VERIFIED: 'var(--green)', PENDING: 'var(--amber)', REJECTED: 'var(--red)', EXEMPT: 'var(--text-2)',
}

interface Props { intents: PaymentIntent[] }

function IntentDetail({ intent, onClose }: { intent: PaymentIntent; onClose: () => void }) {
  const tr = intent.travel_rule
  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'var(--bg-1)', zIndex: 10,
      overflowY: 'auto', padding: 20,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500, color: 'var(--text-0)' }}>{intent.id}</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-2)', marginTop: 2 }}>
            {intent.metadata.originator_name} → {intent.metadata.beneficiary_name}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--text-1)', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 11 }}>
          ← BACK
        </button>
      </div>

      {/* Summary row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
        {[
          { k: 'AMOUNT', v: `$${intent.amount.toLocaleString()} ${intent.currency}` },
          { k: 'RAIL', v: intent.rail },
          { k: 'STATE', v: intent.state, c: STATE_COLOR[intent.state] },
        ].map(r => (
          <div key={r.k} style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)', letterSpacing: '0.1em', marginBottom: 3 }}>{r.k}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500, color: (r as any).c ?? 'var(--text-0)' }}>{r.v}</div>
          </div>
        ))}
      </div>

      {/* Travel Rule */}
      {tr && (
        <div style={{ background: 'var(--bg-3)', border: `1px solid ${tr.state === 'VERIFIED' ? 'rgba(0,229,160,0.2)' : tr.state === 'REJECTED' ? 'rgba(255,77,106,0.2)' : 'var(--border)'}`, borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)', letterSpacing: '0.12em' }}>TRAVEL RULE (FATF R.16)</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 500, color: TR_COLOR[tr.state] }}>{tr.state}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
            {[
              ['ORIGINATOR VASP', tr.originator_vasp],
              ['BENEFICIARY VASP', tr.beneficiary_vasp],
              ['JURISDICTION', tr.jurisdiction],
              ['PROTOCOL', tr.exchange_protocol],
              ['THRESHOLD', `$${tr.required_threshold}`],
              ['ORIGINATOR', tr.originator_name],
            ].map(([k, v]) => (
              <div key={k}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)' }}>{k}: </span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-1)' }}>{v}</span>
              </div>
            ))}
          </div>
          {tr.rejection_reason && (
            <div style={{ marginTop: 8, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--red)', padding: '6px 8px', background: 'rgba(255,77,106,0.08)', borderRadius: 4 }}>
              ✕ {tr.rejection_reason}
            </div>
          )}
        </div>
      )}

      {/* Attempts */}
      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)', letterSpacing: '0.12em', marginBottom: 8 }}>SETTLEMENT ATTEMPTS</div>
      {intent.attempts.length === 0
        ? <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-2)' }}>No attempts yet</div>
        : intent.attempts.map(a => (
          <div key={a.id} style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px', marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500, color: a.state === 'CONFIRMED' ? 'var(--green)' : a.state === 'FAILED' ? 'var(--red)' : 'var(--amber)' }}>{a.state}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)' }}>attempt #{a.retry_count + 1}</span>
            </div>
            {a.provider_ref && <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)' }}>ref: {a.provider_ref}</div>}
            {a.confirmation_blocks ? <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-1)' }}>blocks: {a.confirmation_blocks}</div> : null}
            {a.error_code && <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--red)' }}>{a.error_code}</div>}
          </div>
        ))
      }
    </div>
  )
}

export function IntentFeed({ intents }: Props) {
  const [selected, setSelected] = useState<PaymentIntent | null>(null)
  const [railFilter, setRailFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')

  const filtered = intents.filter(i =>
    (railFilter === '' || i.rail === railFilter) &&
    (stateFilter === '' || i.state === stateFilter)
  )

  const selectStyle = {
    background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--text-1)',
    fontFamily: 'var(--mono)', fontSize: 10, padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
  }

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {selected
        ? <IntentDetail intent={selected} onClose={() => setSelected(null)} />
        : <>
          {/* Header */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)', letterSpacing: '0.14em' }}>
              PAYMENT INTENT FEED · {filtered.length} shown
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select style={selectStyle} value={railFilter} onChange={e => setRailFilter(e.target.value)}>
                <option value="">ALL RAILS</option>
                {['ETHEREUM','POLYGON','SOLANA','STELLAR','ACH','CARD'].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <select style={selectStyle} value={stateFilter} onChange={e => setStateFilter(e.target.value)}>
                <option value="">ALL STATES</option>
                <option value="PENDING">PENDING</option>
                <option value="SUCCEEDED">SETTLED</option>
                <option value="FAILED">FAILED</option>
              </select>
            </div>
          </div>

          {/* Column headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: '108px 70px 62px 84px 1fr 80px',
            gap: 8, padding: '6px 16px', flexShrink: 0,
            fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-2)', letterSpacing: '0.12em',
            borderBottom: '1px solid var(--border)',
          }}>
            <span>INTENT ID</span><span>AMOUNT</span><span>RAIL</span><span>STATUS</span><span>BENEFICIARY</span><span style={{ textAlign: 'right' }}>TRAVEL RULE</span>
          </div>

          {/* Rows */}
          <div style={{ overflowY: 'auto', flex: 1, padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {filtered.map(intent => {
              const rs = RAIL_STYLE[intent.rail] ?? { bg: 'rgba(139,154,176,0.1)', color: '#8b9ab0' }
              const tr = intent.travel_rule
              const trColor = tr ? TR_COLOR[tr.state] : 'var(--text-2)'
              const isTrCheck = intent.state === 'PENDING' && tr?.state === 'PENDING'
              return (
                <div
                  key={intent.id}
                  className="fade-up"
                  onClick={() => setSelected(intent)}
                  style={{
                    display: 'grid', gridTemplateColumns: '108px 70px 62px 84px 1fr 80px',
                    gap: 8, padding: '8px 12px',
                    background: 'var(--bg-2)', border: '1px solid var(--border)',
                    borderRadius: 6, cursor: 'pointer', alignItems: 'center',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-hi)'
                    ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-3)'
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
                    ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-2)'
                  }}
                >
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-2)' }}>{intent.id}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500, color: 'var(--text-0)' }}>
                    ${intent.amount >= 1000 ? (intent.amount / 1000).toFixed(1) + 'k' : intent.amount.toFixed(0)}
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 500, background: rs.bg, color: rs.color, padding: '2px 6px', borderRadius: 3, textAlign: 'center' }}>
                    {RAIL_SHORT[intent.rail] ?? intent.rail}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--mono)', fontSize: 10, color: isTrCheck ? 'var(--purple)' : STATE_COLOR[intent.state] }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: isTrCheck ? 'var(--purple)' : STATE_COLOR[intent.state], flexShrink: 0 }} />
                    {isTrCheck ? 'TR CHECK' : intent.state}
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {intent.metadata.beneficiary_name}
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: trColor, textAlign: 'right' }}>
                    {tr ? tr.state : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      }
    </div>
  )
}
