package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	mrand "math/rand"
	"net/http"
	"sort"
	"sync"
	"time"
)

// newID generates a random hex ID using crypto/rand — no external deps needed.
func newID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// ─── Domain Types ─────────────────────────────────────────────────────────────

type PaymentRail     string
type IntentState     string
type AttemptState    string
type TravelRuleState string

const (
	RailACH      PaymentRail = "ACH"
	RailCard     PaymentRail = "CARD"
	RailEthereum PaymentRail = "ETHEREUM"
	RailPolygon  PaymentRail = "POLYGON"
	RailSolana   PaymentRail = "SOLANA"
	RailStellar  PaymentRail = "STELLAR"

	IntentPending   IntentState = "PENDING"
	IntentSucceeded IntentState = "SUCCEEDED"
	IntentFailed    IntentState = "FAILED"

	AttemptInitiated       AttemptState = "INITIATED"
	AttemptPendingExternal AttemptState = "PENDING_EXTERNAL"
	AttemptConfirmed       AttemptState = "CONFIRMED"
	AttemptFailed          AttemptState = "FAILED"

	TRPending  TravelRuleState = "PENDING"
	TRVerified TravelRuleState = "VERIFIED"
	TRRejected TravelRuleState = "REJECTED"
	TRExempt   TravelRuleState = "EXEMPT"
)

// ─── Core Domain Models ───────────────────────────────────────────────────────

type TravelRuleData struct {
	State             TravelRuleState `json:"state"`
	OriginatorName    string          `json:"originator_name"`
	BeneficiaryName   string          `json:"beneficiary_name"`
	OriginatorVASP    string          `json:"originator_vasp"`
	BeneficiaryVASP   string          `json:"beneficiary_vasp"`
	RequiredThreshold float64         `json:"required_threshold"`
	Jurisdiction      string          `json:"jurisdiction"`
	ExchangeProtocol  string          `json:"exchange_protocol"`
	VerifiedAt        *time.Time      `json:"verified_at,omitempty"`
	RejectionReason   string          `json:"rejection_reason,omitempty"`
}

type PaymentIntent struct {
	ID             string              `json:"id"`
	Amount         float64             `json:"amount"`
	Currency       string              `json:"currency"`
	Rail           PaymentRail         `json:"rail"`
	State          IntentState         `json:"state"`
	SourceID       string              `json:"source_id"`
	Destination    string              `json:"destination"`
	CreatedAt      time.Time           `json:"created_at"`
	UpdatedAt      time.Time           `json:"updated_at"`
	FinalizedAt    *time.Time          `json:"finalized_at,omitempty"`
	IdempotencyKey string              `json:"idempotency_key"`
	TravelRule     *TravelRuleData     `json:"travel_rule,omitempty"`
	Attempts       []SettlementAttempt `json:"attempts"`
	Metadata       map[string]string   `json:"metadata"`
}

type SettlementAttempt struct {
	ID                 string       `json:"id"`
	IntentID           string       `json:"intent_id"`
	State              AttemptState `json:"state"`
	Rail               PaymentRail  `json:"rail"`
	ProviderRef        string       `json:"provider_ref,omitempty"`
	RetryCount         int          `json:"retry_count"`
	StartedAt          time.Time    `json:"started_at"`
	UpdatedAt          time.Time    `json:"updated_at"`
	CompletedAt        *time.Time   `json:"completed_at,omitempty"`
	ErrorCode          string       `json:"error_code,omitempty"`
	ConfirmationBlocks int          `json:"confirmation_blocks,omitempty"`
}

type OutboxMessage struct {
	ID        string    `json:"id"`
	IntentID  string    `json:"intent_id"`
	Type      string    `json:"type"`
	CreatedAt time.Time `json:"created_at"`
	Sent      bool      `json:"sent"`
}

type AuditEvent struct {
	ID        string    `json:"id"`
	IntentID  string    `json:"intent_id"`
	EventType string    `json:"event_type"`
	OldState  string    `json:"old_state,omitempty"`
	NewState  string    `json:"new_state"`
	Detail    string    `json:"detail"`
	Timestamp time.Time `json:"timestamp"`
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

type RailMetric struct {
	Count       int     `json:"count"`
	Volume      float64 `json:"volume"`
	SuccessRate float64 `json:"success_rate"`
	AvgLatMs    float64 `json:"avg_lat_ms"`
}

type TRMetrics struct {
	Total    int `json:"total"`
	Verified int `json:"verified"`
	Rejected int `json:"rejected"`
	Pending  int `json:"pending"`
	Exempt   int `json:"exempt"`
}

type SystemMetrics struct {
	TotalIntents     int                        `json:"total_intents"`
	PendingIntents   int                        `json:"pending_intents"`
	SucceededIntents int                        `json:"succeeded_intents"`
	FailedIntents    int                        `json:"failed_intents"`
	TotalVolume      float64                    `json:"total_volume"`
	ByRail           map[PaymentRail]RailMetric `json:"by_rail"`
	TravelRule       TRMetrics                  `json:"travel_rule"`
	AvgSettlementMs  float64                    `json:"avg_settlement_ms"`
	OutboxPending    int                        `json:"outbox_pending"`
	Discrepancy      float64                    `json:"discrepancy"`
	ThroughputPerSec float64                    `json:"throughput_per_sec"`
	Timestamp        time.Time                  `json:"timestamp"`
}

// ─── Ledger (Durable Source of Truth) ────────────────────────────────────────

type Ledger struct {
	mu          sync.RWMutex
	intents     map[string]*PaymentIntent
	intentOrder []string // insertion order
	outbox      []OutboxMessage
	audit       []AuditEvent
	idempotency map[string]string
}

func NewLedger() *Ledger {
	return &Ledger{
		intents:     make(map[string]*PaymentIntent),
		idempotency: make(map[string]string),
	}
}

func (l *Ledger) RecordIntent(intent *PaymentIntent) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, ok := l.idempotency[intent.IdempotencyKey]; ok {
		return false
	}
	l.intents[intent.ID] = intent
	l.intentOrder = append(l.intentOrder, intent.ID)
	l.idempotency[intent.IdempotencyKey] = intent.ID
	l.outbox = append(l.outbox, OutboxMessage{
		ID: newID(), IntentID: intent.ID,
		Type: "PROCESS_INTENT", CreatedAt: time.Now(),
	})
	l.addAudit(intent.ID, "INTENT_CREATED", "", string(intent.State),
		fmt.Sprintf("rail=%s amount=%.2f %s originator=%s",
			intent.Rail, intent.Amount, intent.Currency, intent.Metadata["originator_name"]))
	return true
}

func (l *Ledger) UpdateAttempt(intentID string, sa SettlementAttempt, detail string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	i, ok := l.intents[intentID]
	if !ok {
		return
	}
	var old AttemptState
	found := false
	for idx, a := range i.Attempts {
		if a.ID == sa.ID {
			old = i.Attempts[idx].State
			i.Attempts[idx] = sa
			found = true
			break
		}
	}
	if !found {
		i.Attempts = append(i.Attempts, sa)
	}
	i.UpdatedAt = time.Now()
	l.addAudit(intentID, "ATTEMPT_UPDATED", string(old), string(sa.State), detail)
}

func (l *Ledger) UpdateTravelRule(intentID string, tr TravelRuleData) {
	l.mu.Lock()
	defer l.mu.Unlock()
	i, ok := l.intents[intentID]
	if !ok {
		return
	}
	i.TravelRule = &tr
	i.UpdatedAt = time.Now()
	l.addAudit(intentID, "TRAVEL_RULE_UPDATE", "", string(tr.State),
		fmt.Sprintf("vasp=%s protocol=%s jurisdiction=%s", tr.BeneficiaryVASP, tr.ExchangeProtocol, tr.Jurisdiction))
}

func (l *Ledger) FinalizeIntent(intentID string, state IntentState) {
	l.mu.Lock()
	defer l.mu.Unlock()
	i, ok := l.intents[intentID]
	if !ok {
		return
	}
	old := i.State
	i.State = state
	now := time.Now()
	i.FinalizedAt = &now
	i.UpdatedAt = now
	for idx := range l.outbox {
		if l.outbox[idx].IntentID == intentID && !l.outbox[idx].Sent {
			l.outbox[idx].Sent = true
		}
	}
	l.addAudit(intentID, "INTENT_FINALIZED", string(old), string(state),
		fmt.Sprintf("settled via %s", i.Rail))
}

func (l *Ledger) addAudit(intentID, eventType, old, newState, detail string) {
	l.audit = append([]AuditEvent{{
		ID: newID(), IntentID: intentID,
		EventType: eventType, OldState: old, NewState: newState,
		Detail: detail, Timestamp: time.Now(),
	}}, l.audit...)
	if len(l.audit) > 1000 {
		l.audit = l.audit[:1000]
	}
}

func (l *Ledger) GetRecent(limit int) []*PaymentIntent {
	l.mu.RLock()
	defer l.mu.RUnlock()
	order := l.intentOrder
	if len(order) > limit {
		order = order[len(order)-limit:]
	}
	out := make([]*PaymentIntent, 0, len(order))
	for i := len(order) - 1; i >= 0; i-- {
		if intent, ok := l.intents[order[i]]; ok {
			cp := *intent
			out = append(out, &cp)
		}
	}
	return out
}

func (l *Ledger) GetAudit(intentID string, limit int) []AuditEvent {
	l.mu.RLock()
	defer l.mu.RUnlock()
	var ev []AuditEvent
	for _, e := range l.audit {
		if intentID == "" || e.IntentID == intentID {
			ev = append(ev, e)
			if len(ev) >= limit {
				break
			}
		}
	}
	return ev
}

func (l *Ledger) PendingOutbox() int {
	l.mu.RLock()
	defer l.mu.RUnlock()
	n := 0
	for _, m := range l.outbox {
		if !m.Sent {
			n++
		}
	}
	return n
}

func (l *Ledger) AllIntents() []*PaymentIntent {
	l.mu.RLock()
	defer l.mu.RUnlock()
	out := make([]*PaymentIntent, 0, len(l.intents))
	for _, v := range l.intents {
		cp := *v
		out = append(out, &cp)
	}
	return out
}

// ─── Rail Configurations (Anti-Corruption Layer) ─────────────────────────────

type RailConfig struct {
	SuccessRate  float64
	MinMs, MaxMs int
	Blocks       int
	TRThreshold  float64
}

var railCfg = map[PaymentRail]RailConfig{
	RailACH:      {0.97, 300, 900, 0, 3000},
	RailCard:     {0.92, 80, 350, 0, 0},
	RailEthereum: {0.88, 600, 3000, 12, 1000},
	RailPolygon:  {0.91, 200, 1200, 64, 1000},
	RailSolana:   {0.93, 80, 600, 31, 1000},
	RailStellar:  {0.95, 120, 500, 1, 1000},
}

var (
	vasps     = []string{"Coinbase Institutional", "Binance VASP", "Kraken Trust", "Anchorage Digital", "Bitgo Inc", "Gemini Custody"}
	protocols = []string{"TRP v2.1", "OpenVASP", "Shyft Network", "VerifyVASP"}
	jdicts    = []string{"EEA", "UK", "US", "CA", "SG", "UAE"}
	errCodes  = []string{"INSUFFICIENT_FUNDS", "INVALID_DESTINATION", "PROVIDER_TIMEOUT", "CHAIN_REORG", "PSP_DECLINE", "AML_BLOCK", "RATE_LIMITED"}
	firstN    = []string{"Alice", "Bob", "Carlos", "Diana", "Ethan", "Fatima", "George", "Hana", "Ivan", "Julia", "Kofi", "Lena"}
	lastN     = []string{"Smith", "Kumar", "Chen", "Okafor", "Müller", "Santos", "Park", "Ivanova", "Tanaka", "Williams", "Dubois", "Al-Rashid"}
	ccys      = []string{"USDC", "USDT", "USD", "EUR", "PYUSD", "USDC"}
	allRails  = []PaymentRail{RailACH, RailCard, RailEthereum, RailPolygon, RailSolana, RailStellar}
)

func pick(s []string) string { return s[mrand.Intn(len(s))] }
func r2(f float64) float64   { return float64(int(f*100)) / 100 }

// ─── Saga Orchestrator ────────────────────────────────────────────────────────

type Orchestrator struct{ ledger *Ledger }

func (o *Orchestrator) Submit(intent *PaymentIntent) {
	if o.ledger.RecordIntent(intent) {
		go o.saga(intent)
	}
}

func (o *Orchestrator) saga(intent *PaymentIntent) {
	cfg, ok := railCfg[intent.Rail]
	if !ok {
		o.ledger.FinalizeIntent(intent.ID, IntentFailed)
		return
	}

	// Step 1: Travel Rule — MUST complete before any settlement (irreversibility)
	if cfg.TRThreshold > 0 && intent.Amount >= cfg.TRThreshold {
		tr := TravelRuleData{
			State: TRPending, OriginatorName: intent.Metadata["originator_name"],
			BeneficiaryName: intent.Metadata["beneficiary_name"],
			OriginatorVASP: pick(vasps), BeneficiaryVASP: pick(vasps),
			RequiredThreshold: cfg.TRThreshold, Jurisdiction: pick(jdicts),
			ExchangeProtocol: pick(protocols),
		}
		o.ledger.UpdateTravelRule(intent.ID, tr)
		time.Sleep(time.Duration(150+mrand.Intn(700)) * time.Millisecond)
		if mrand.Float64() < 0.06 {
			tr.State = TRRejected
			tr.RejectionReason = "Beneficiary name mismatch / Sanctions screening hit"
			o.ledger.UpdateTravelRule(intent.ID, tr)
			o.ledger.FinalizeIntent(intent.ID, IntentFailed)
			return
		}
		now := time.Now()
		tr.State = TRVerified
		tr.VerifiedAt = &now
		o.ledger.UpdateTravelRule(intent.ID, tr)
	} else if cfg.TRThreshold > 0 {
		o.ledger.UpdateTravelRule(intent.ID, TravelRuleData{
			State: TRExempt, RequiredThreshold: cfg.TRThreshold, Jurisdiction: pick(jdicts),
		})
	}

	// Step 2: Settlement saga with exponential backoff (max 3 attempts)
	for retry := 0; retry < 3; retry++ {
		sa := SettlementAttempt{
			ID: newID(), IntentID: intent.ID,
			State: AttemptInitiated, Rail: intent.Rail,
			RetryCount: retry, StartedAt: time.Now(), UpdatedAt: time.Now(),
		}
		o.ledger.UpdateAttempt(intent.ID, sa, fmt.Sprintf("attempt %d initiated", retry+1))
		sa.State = AttemptPendingExternal
		sa.UpdatedAt = time.Now()
		o.ledger.UpdateAttempt(intent.ID, sa, "awaiting provider confirmation")
		time.Sleep(time.Duration(cfg.MinMs+mrand.Intn(cfg.MaxMs-cfg.MinMs)) * time.Millisecond)

		if mrand.Float64() < cfg.SuccessRate {
			now := time.Now()
			sa.State = AttemptConfirmed
			sa.ProviderRef = fmt.Sprintf("0x%016x", mrand.Int63())
			sa.CompletedAt = &now
			sa.ConfirmationBlocks = cfg.Blocks
			sa.UpdatedAt = now
			o.ledger.UpdateAttempt(intent.ID, sa, fmt.Sprintf("confirmed ref=%s blocks=%d", sa.ProviderRef, cfg.Blocks))
			o.ledger.FinalizeIntent(intent.ID, IntentSucceeded)
			return
		}
		sa.State = AttemptFailed
		sa.ErrorCode = pick(errCodes)
		sa.UpdatedAt = time.Now()
		o.ledger.UpdateAttempt(intent.ID, sa, fmt.Sprintf("failed: %s", sa.ErrorCode))
		if retry < 2 {
			time.Sleep(time.Duration(100*(1<<retry)) * time.Millisecond)
		}
	}
	o.ledger.FinalizeIntent(intent.ID, IntentFailed)
}

// ─── Metrics Computation ──────────────────────────────────────────────────────

func computeMetrics(l *Ledger, recentCount int) SystemMetrics {
	intents := l.AllIntents()
	m := SystemMetrics{
		ByRail:    make(map[PaymentRail]RailMetric),
		Timestamp: time.Now(),
		OutboxPending: l.PendingOutbox(),
	}
	rc := make(map[PaymentRail]int)
	rv := make(map[PaymentRail]float64)
	rs := make(map[PaymentRail]int)
	rl := make(map[PaymentRail][]float64)
	var sv, tms float64
	var sn int
	now := time.Now()
	var recentWindow []time.Time

	for _, i := range intents {
		m.TotalIntents++
		m.TotalVolume += i.Amount
		if now.Sub(i.CreatedAt) < 5*time.Second {
			recentWindow = append(recentWindow, i.CreatedAt)
		}
		switch i.State {
		case IntentPending:
			m.PendingIntents++
		case IntentSucceeded:
			m.SucceededIntents++
			sv += i.Amount
			if i.FinalizedAt != nil {
				sn++
				tms += float64(i.FinalizedAt.Sub(i.CreatedAt).Milliseconds())
			}
		case IntentFailed:
			m.FailedIntents++
		}
		rc[i.Rail]++
		rv[i.Rail] += i.Amount
		if i.State == IntentSucceeded {
			rs[i.Rail]++
			if i.FinalizedAt != nil {
				rl[i.Rail] = append(rl[i.Rail], float64(i.FinalizedAt.Sub(i.CreatedAt).Milliseconds()))
			}
		}
		if t := i.TravelRule; t != nil {
			m.TravelRule.Total++
			switch t.State {
			case TRVerified:
				m.TravelRule.Verified++
			case TRRejected:
				m.TravelRule.Rejected++
			case TRPending:
				m.TravelRule.Pending++
			case TRExempt:
				m.TravelRule.Exempt++
			}
		}
	}

	for rail, cnt := range rc {
		var sr, al float64
		if cnt > 0 {
			sr = float64(rs[rail]) / float64(cnt) * 100
		}
		if lats := rl[rail]; len(lats) > 0 {
			for _, x := range lats {
				al += x
			}
			al /= float64(len(lats))
		}
		m.ByRail[rail] = RailMetric{cnt, r2(rv[rail]), r2(sr), r2(al)}
	}
	if sn > 0 {
		m.AvgSettlementMs = r2(tms / float64(sn))
	}
	m.ThroughputPerSec = r2(float64(len(recentWindow)) / 5.0)
	m.Discrepancy = r2(mrand.Float64() * 0.001 * sv)
	return m
}

// ─── Simulator ────────────────────────────────────────────────────────────────

func spawnSim(o *Orchestrator) {
	for {
		n := []int{1, 1, 2, 2, 3}[mrand.Intn(5)]
		for range make([]struct{}, n) {
			rail := allRails[mrand.Intn(len(allRails))]
			amt := 50 + mrand.Float64()*4950
			if mrand.Float64() < 0.2 {
				amt = 1000 + mrand.Float64()*24000
			}
			o.Submit(&PaymentIntent{
				ID: "pi_" + newID()[:8], Amount: r2(amt),
				Currency: pick(ccys), Rail: rail, State: IntentPending,
				SourceID: "usr_" + newID()[:6],
				Destination: "dest_" + newID()[:8],
				CreatedAt: time.Now(), UpdatedAt: time.Now(),
				IdempotencyKey: newID(),
				Metadata: map[string]string{
					"originator_name":  pick(firstN) + " " + pick(lastN),
					"beneficiary_name": pick(firstN) + " " + pick(lastN),
				},
			})
		}
		time.Sleep(time.Duration(250+mrand.Intn(500)) * time.Millisecond)
	}
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

type Server struct{ ledger *Ledger }

func (s *Server) handleSSE(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", 500)
		return
	}
	tick := time.NewTicker(400 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-tick.C:
			m := computeMetrics(s.ledger, 200)
			d, _ := json.Marshal(m)
			fmt.Fprintf(w, "data: %s\n\n", d)
			fl.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func (s *Server) handleIntents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	intents := s.ledger.GetRecent(120)
	// Sort newest first already done in GetRecent
	json.NewEncoder(w).Encode(intents)
}

func (s *Server) handleIntentsFeed(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	fl, ok := w.(http.Flusher)
	if !ok {
		return
	}
	tick := time.NewTicker(600 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-tick.C:
			intents := s.ledger.GetRecent(80)
			d, _ := json.Marshal(intents)
			fmt.Fprintf(w, "data: %s\n\n", d)
			fl.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func (s *Server) handleAudit(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	intentID := r.URL.Query().Get("intent_id")
	events := s.ledger.GetAudit(intentID, 300)
	json.NewEncoder(w).Encode(events)
}

func (s *Server) handleAuditFeed(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	fl, ok := w.(http.Flusher)
	if !ok {
		return
	}
	tick := time.NewTicker(800 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-tick.C:
			events := s.ledger.GetAudit("", 50)
			d, _ := json.Marshal(events)
			fmt.Fprintf(w, "data: %s\n\n", d)
			fl.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "ok", "version": "1.0.0",
		"intents": len(s.ledger.AllIntents()),
	})
}

// handleVolumeHistory returns last N seconds of volume data for sparkline
func (s *Server) handleVolumeHistory(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	intents := s.ledger.AllIntents()
	// bucket by second, last 60s
	now := time.Now()
	buckets := make([]float64, 60)
	for _, i := range intents {
		age := int(now.Sub(i.CreatedAt).Seconds())
		if age >= 0 && age < 60 {
			buckets[59-age] += i.Amount
		}
	}
	// sort intents for rail breakdown
	type railVol struct {
		Rail   PaymentRail `json:"rail"`
		Volume float64     `json:"volume"`
		Count  int         `json:"count"`
	}
	railMap := make(map[PaymentRail]*railVol)
	for _, i := range intents {
		if _, ok := railMap[i.Rail]; !ok {
			railMap[i.Rail] = &railVol{Rail: i.Rail}
		}
		railMap[i.Rail].Volume += i.Amount
		railMap[i.Rail].Count++
	}
	rails := make([]railVol, 0)
	for _, v := range railMap {
		rails = append(rails, *v)
	}
	sort.Slice(rails, func(i, j int) bool { return rails[i].Volume > rails[j].Volume })
	json.NewEncoder(w).Encode(map[string]interface{}{
		"buckets": buckets,
		"rails":   rails,
	})
}

func main() {
	mrand.Seed(time.Now().UnixNano())
	l := NewLedger()
	o := &Orchestrator{ledger: l}
	s := &Server{ledger: l}

	go spawnSim(o)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", corsMiddleware(s.handleHealth))
	mux.HandleFunc("/stream", corsMiddleware(s.handleSSE))
	mux.HandleFunc("/stream/intents", corsMiddleware(s.handleIntentsFeed))
	mux.HandleFunc("/stream/audit", corsMiddleware(s.handleAuditFeed))
	mux.HandleFunc("/intents", corsMiddleware(s.handleIntents))
	mux.HandleFunc("/audit", corsMiddleware(s.handleAudit))
	mux.HandleFunc("/volume-history", corsMiddleware(s.handleVolumeHistory))

	log.Println("╔══════════════════════════════════════╗")
	log.Println("║  Payment Infrastructure  v1.0.0      ║")
	log.Println("║  → http://localhost:8080             ║")
	log.Println("╚══════════════════════════════════════╝")
	log.Fatal(http.ListenAndServe(":8080", mux))
}
