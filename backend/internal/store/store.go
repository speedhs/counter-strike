package store

import (
	"sync"
	"time"

	"github.com/speed/counter-strike/backend/internal/detect"
	"github.com/speed/counter-strike/backend/internal/opensky"
)

const MaxAlerts = 100

// Snapshot is the current in-memory view for clients.
type Snapshot struct {
	Aircraft   []opensky.Aircraft `json:"aircraft"`
	Alerts     []detect.Alert     `json:"alerts"`
	LastPoll   time.Time          `json:"last_poll"`
	PollOK     bool               `json:"poll_ok"`
	Count      int                `json:"count"`
	AlertCount int                `json:"alert_count"`
}

// Store holds live aircraft and recent alerts.
type Store struct {
	mu       sync.RWMutex
	aircraft map[string]opensky.Aircraft
	alerts   []detect.Alert
	lastPoll time.Time
	pollOK   bool
}

func New() *Store {
	return &Store{
		aircraft: make(map[string]opensky.Aircraft),
	}
}

// SetLive marks whether the upstream feed is currently healthy.
// Aircraft already in the store are left in place.
func (s *Store) SetLive(ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pollOK = ok
}

func (s *Store) UpdateAircraft(list []opensky.Aircraft, pollOK bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.aircraft = make(map[string]opensky.Aircraft, len(list))
	for _, ac := range list {
		s.aircraft[ac.ICAO24] = ac
	}
	s.lastPoll = time.Now().UTC()
	s.pollOK = pollOK
}

func (s *Store) AddAlerts(alerts []detect.Alert) {
	if len(alerts) == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.alerts = append(alerts, s.alerts...)
	if len(s.alerts) > MaxAlerts {
		s.alerts = s.alerts[:MaxAlerts]
	}
}

func (s *Store) Snapshot() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	acs := make([]opensky.Aircraft, 0, len(s.aircraft))
	for _, ac := range s.aircraft {
		acs = append(acs, ac)
	}
	alerts := make([]detect.Alert, len(s.alerts))
	copy(alerts, s.alerts)
	return Snapshot{
		Aircraft:   acs,
		Alerts:     alerts,
		LastPoll:   s.lastPoll,
		PollOK:     s.pollOK,
		Count:      len(acs),
		AlertCount: len(alerts),
	}
}
