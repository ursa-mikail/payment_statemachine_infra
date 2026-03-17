export type PaymentRail = 'ACH' | 'CARD' | 'ETHEREUM' | 'POLYGON' | 'SOLANA' | 'STELLAR'
export type IntentState = 'PENDING' | 'SUCCEEDED' | 'FAILED'
export type AttemptState = 'INITIATED' | 'PENDING_EXTERNAL' | 'CONFIRMED' | 'FAILED'
export type TravelRuleState = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXEMPT'

export interface TravelRuleData {
  state: TravelRuleState
  originator_name: string
  beneficiary_name: string
  originator_vasp: string
  beneficiary_vasp: string
  required_threshold: number
  jurisdiction: string
  exchange_protocol: string
  verified_at?: string
  rejection_reason?: string
}

export interface SettlementAttempt {
  id: string
  intent_id: string
  state: AttemptState
  rail: PaymentRail
  provider_ref?: string
  retry_count: number
  started_at: string
  updated_at: string
  completed_at?: string
  error_code?: string
  confirmation_blocks?: number
}

export interface PaymentIntent {
  id: string
  amount: number
  currency: string
  rail: PaymentRail
  state: IntentState
  source_id: string
  destination: string
  created_at: string
  updated_at: string
  finalized_at?: string
  idempotency_key: string
  travel_rule?: TravelRuleData
  attempts: SettlementAttempt[]
  metadata: Record<string, string>
}

export interface RailMetric {
  count: number
  volume: number
  success_rate: number
  avg_lat_ms: number
}

export interface TRMetrics {
  total: number
  verified: number
  rejected: number
  pending: number
  exempt: number
}

export interface SystemMetrics {
  total_intents: number
  pending_intents: number
  succeeded_intents: number
  failed_intents: number
  total_volume: number
  by_rail: Record<PaymentRail, RailMetric>
  travel_rule: TRMetrics
  avg_settlement_ms: number
  outbox_pending: number
  discrepancy: number
  throughput_per_sec: number
  timestamp: string
}

export interface AuditEvent {
  id: string
  intent_id: string
  event_type: string
  old_state?: string
  new_state: string
  detail: string
  timestamp: string
}
