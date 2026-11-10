package adsbiq

import (
	"bytes"
	"encoding/json"
	"strings"

	"github.com/speed/counter-strike/backend/internal/opensky"
)

const (
	feetToMeters = 0.3048
	knotsToMps   = 0.514444
	fpmToMps     = feetToMeters / 60
)

// lastFix is the most recent ADS-B position when the live lat/lon fields
// have aged out of the feed. The global stream keeps sending the aircraft
// this way instead of dropping it.
type lastFix struct {
	Lat *float64 `json:"lat"`
	Lon *float64 `json:"lon"`
}

// patch is one aircraft object from a full snapshot or a sparse delta.
type patch struct {
	Hex          string          `json:"hex"`
	Flight       *string         `json:"flight"`
	Lat          *float64        `json:"lat"`
	Lon          *float64        `json:"lon"`
	LastPosition *lastFix        `json:"lastPosition"`
	RRLat        *float64        `json:"rr_lat"`
	RRLon        *float64        `json:"rr_lon"`
	AltBaro      json.RawMessage `json:"alt_baro"`
	GS           *float64        `json:"gs"`
	Track        *float64        `json:"track"`
	BaroRate     *float64        `json:"baro_rate"`
}

type track struct {
	ac     opensky.Aircraft
	hasPos bool
}

// apply merges a readsb-style patch. ADSBiq altitudes are feet, ground speed
// is knots, and vertical rate is feet per minute. The returned bool is false
// when the aircraft should not be shown (on the ground, or no position yet).
func (t *track) apply(p patch, now float64) bool {
	if p.Hex != "" {
		t.ac.ICAO24 = strings.ToLower(p.Hex)
	}
	if p.Flight != nil {
		t.ac.Callsign = strings.TrimSpace(*p.Flight)
	}
	if lat, lon, ok := positionOf(p); ok {
		// A coarse rr_ estimate must not drag a real fix off its last point.
		if p.Lat != nil || !t.hasPos || p.LastPosition != nil {
			t.ac.Lat = lat
			t.ac.Lon = lon
			t.hasPos = true
		}
	}
	ground := false
	if alt, ok, isGround := parseAltBaro(p.AltBaro); isGround {
		ground = true
		t.ac.OnGround = true
	} else if ok {
		t.ac.Alt = alt * feetToMeters
		t.ac.OnGround = false
	}
	if p.GS != nil {
		t.ac.Velocity = *p.GS * knotsToMps
	}
	if p.Track != nil {
		t.ac.Heading = *p.Track
	}
	if p.BaroRate != nil {
		t.ac.VRate = *p.BaroRate * fpmToMps
	}
	if now > 0 {
		t.ac.Time = now
	}
	return t.hasPos && !ground && t.ac.ICAO24 != ""
}

// positionOf prefers a live fix, then the last ADS-B fix, then the coarse
// receiver estimate.
func positionOf(p patch) (lat, lon float64, ok bool) {
	if p.Lat != nil && p.Lon != nil {
		return *p.Lat, *p.Lon, true
	}
	if p.LastPosition != nil && p.LastPosition.Lat != nil && p.LastPosition.Lon != nil {
		return *p.LastPosition.Lat, *p.LastPosition.Lon, true
	}
	if p.RRLat != nil && p.RRLon != nil {
		return *p.RRLat, *p.RRLon, true
	}
	return 0, 0, false
}

func parseAltBaro(raw json.RawMessage) (feet float64, ok bool, ground bool) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return 0, false, false
	}
	if bytes.Equal(raw, []byte(`"ground"`)) {
		return 0, false, true
	}
	if err := json.Unmarshal(raw, &feet); err != nil {
		return 0, false, false
	}
	return feet, true, false
}
