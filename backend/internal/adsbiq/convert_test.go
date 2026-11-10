package adsbiq

import (
	"encoding/json"
	"testing"
)

func TestApplyConvertsUnits(t *testing.T) {
	var tr track
	flight := "FIN74   "
	lat, lon := 66.5, -167.8
	gs, trackDeg, rate := 506.4, 2.26, -960.0
	airborne := tr.apply(patch{
		Hex:      "461F4A",
		Flight:   &flight,
		Lat:      &lat,
		Lon:      &lon,
		AltBaro:  []byte("37000"),
		GS:       &gs,
		Track:    &trackDeg,
		BaroRate: &rate,
	}, 100)
	if !airborne {
		t.Fatal("expected airborne")
	}
	if tr.ac.ICAO24 != "461f4a" || tr.ac.Callsign != "FIN74" {
		t.Fatalf("identity: %+v", tr.ac)
	}
	if tr.ac.Alt < 11200 || tr.ac.Alt > 11300 {
		t.Fatalf("alt meters = %v", tr.ac.Alt)
	}
	if tr.ac.Velocity < 250 || tr.ac.Velocity > 270 {
		t.Fatalf("speed m/s = %v", tr.ac.Velocity)
	}
	if tr.ac.VRate > -4 || tr.ac.VRate < -6 {
		t.Fatalf("vrate m/s = %v", tr.ac.VRate)
	}
	if tr.ac.Heading != 2.26 {
		t.Fatalf("heading = %v", tr.ac.Heading)
	}
}

func TestApplySparseUpdateKeepsPosition(t *testing.T) {
	var tr track
	lat, lon := 40.0, -74.0
	if !tr.apply(patch{Hex: "abc123", Lat: &lat, Lon: &lon, AltBaro: []byte("10000")}, 10) {
		t.Fatal("expected airborne")
	}
	rate := 0.0
	if !tr.apply(patch{Hex: "abc123", BaroRate: &rate}, 12) {
		t.Fatal("sparse update should stay airborne")
	}
	if tr.ac.Lat != 40 || tr.ac.Lon != -74 || tr.ac.Time != 12 {
		t.Fatalf("merged: %+v", tr.ac)
	}
}

func TestDeltaDropsGroundAircraft(t *testing.T) {
	tracks := map[string]*track{}
	full := applyFrame(tracks, frame{
		Type: "full",
		Now:  10,
		AC: []json.RawMessage{
			json.RawMessage(`{"hex":"abc","lat":1,"lon":2,"alt_baro":10000,"track":90}`),
		},
	})
	if len(full.Aircraft) != 1 || full.Aircraft[0].Heading != 90 {
		t.Fatalf("full: %+v", full.Aircraft)
	}
	delta := applyFrame(tracks, frame{
		Type: "delta",
		Now:  12,
		Update: []json.RawMessage{
			json.RawMessage(`{"hex":"abc","alt_baro":"ground"}`),
		},
	})
	if len(delta.Aircraft) != 0 || len(delta.Removed) != 1 || delta.Removed[0] != "abc" {
		t.Fatalf("delta: aircraft=%d removed=%v", len(delta.Aircraft), delta.Removed)
	}
}

func TestLastPositionRestoresDroppedTrack(t *testing.T) {
	tracks := map[string]*track{}
	applyFrame(tracks, frame{
		Type: "full",
		Now:  10,
		AC: []json.RawMessage{
			json.RawMessage(`{"hex":"800cd5","flight":"AXB619","lat":11.404221,"lon":76.560311,"alt_baro":32000}`),
		},
	})
	delta := applyFrame(tracks, frame{
		Type:   "delta",
		Now:    20,
		Remove: []string{"800cd5"},
		Update: []json.RawMessage{
			json.RawMessage(`{"hex":"800cd5","flight":"AXB619","alt_baro":32000,"lastPosition":{"lat":11.404221,"lon":76.560311,"seen_pos":201}}`),
		},
	})
	var found bool
	var call string
	var lat, lon float64
	for _, ac := range delta.Aircraft {
		if ac.ICAO24 == "800cd5" {
			found = true
			call, lat, lon = ac.Callsign, ac.Lat, ac.Lon
		}
	}
	if !found {
		t.Fatal("lastPosition update should keep AXB619 on the picture")
	}
	for _, id := range delta.Removed {
		if id == "800cd5" {
			t.Fatal("same-frame update should undo the removal")
		}
	}
	if call != "AXB619" || lat < 11.4 || lat > 11.41 || lon < 76.56 || lon > 76.57 {
		t.Fatalf("restored %s %v %v", call, lat, lon)
	}
}

func TestApplyGroundDropsTrack(t *testing.T) {
	var tr track
	lat, lon := 1.0, 2.0
	tr.apply(patch{Hex: "abc", Lat: &lat, Lon: &lon, AltBaro: []byte("5000")}, 1)
	if tr.apply(patch{Hex: "abc", AltBaro: []byte(`"ground"`)}, 2) {
		t.Fatal("ground aircraft should leave the picture")
	}
}
