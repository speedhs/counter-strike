package detect

import "math"

const (
	HeadingShiftThreshold = 8.0  // deg/s
	AltitudeRateThreshold = 35.0 // m/s (~7,000 fpm)
	HistoryDepth          = 10
)

// State is one telemetry snapshot used for anomaly detection.
type State struct {
	Time    float64
	Alt     float64
	Heading float64
	VRate   float64
}

// AlertKind identifies the anomaly type.
type AlertKind string

const (
	KindHeading   AlertKind = "heading"
	KindAltitude  AlertKind = "altitude"
)

// Alert is a detected anomaly for an aircraft.
type Alert struct {
	ICAO24 string    `json:"icao24"`
	Kind   AlertKind `json:"kind"`
	Value  float64   `json:"value"`
	TS     float64   `json:"ts"`
}

// NormalizeAngleDelta returns the minimal angular delta handling 360/0 wrap-around.
func NormalizeAngleDelta(a1, a2 float64) float64 {
	diff := math.Mod(math.Abs(a1-a2), 360)
	if diff > 180 {
		return 360 - diff
	}
	return diff
}

// History tracks recent states per aircraft and emits alerts.
type History struct {
	buf map[string][]State
}

func NewHistory() *History {
	return &History{buf: make(map[string][]State)}
}

// Check compares current state to the last stored sample and returns any alerts.
func (h *History) Check(icao24 string, curr State) []Alert {
	prevList, ok := h.buf[icao24]
	if !ok || len(prevList) < 1 {
		h.buf[icao24] = []State{curr}
		return nil
	}

	prev := prevList[len(prevList)-1]
	dt := curr.Time - prev.Time
	if dt <= 0 {
		return nil
	}

	var alerts []Alert
	headingShiftRate := NormalizeAngleDelta(curr.Heading, prev.Heading) / dt
	altRateActual := math.Abs(curr.Alt-prev.Alt) / dt

	if headingShiftRate > HeadingShiftThreshold {
		alerts = append(alerts, Alert{
			ICAO24: icao24,
			Kind:   KindHeading,
			Value:  headingShiftRate,
			TS:     curr.Time,
		})
	}
	if altRateActual > AltitudeRateThreshold {
		alerts = append(alerts, Alert{
			ICAO24: icao24,
			Kind:   KindAltitude,
			Value:  altRateActual,
			TS:     curr.Time,
		})
	}

	prevList = append(prevList, curr)
	if len(prevList) > HistoryDepth {
		prevList = prevList[len(prevList)-HistoryDepth:]
	}
	h.buf[icao24] = prevList
	return alerts
}
