package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/speed/counter-strike/backend/internal/adsbiq"
	"github.com/speed/counter-strike/backend/internal/detect"
	"github.com/speed/counter-strike/backend/internal/hub"
	"github.com/speed/counter-strike/backend/internal/opensky"
	"github.com/speed/counter-strike/backend/internal/store"
)

func main() {
	addr := env("ADDR", ":8080")
	interval := envDuration("POLL_INTERVAL", 15*time.Second)
	bbox := resolveBBox()

	st := store.New()
	h := hub.New()
	client := opensky.NewClient()
	history := detect.NewHistory()

	feed := env("FEED", "adsbiq")
	if feed == "opensky" {
		if bbox.Global {
			log.Printf("feed: opensky poll every %s, scope global", interval)
		} else {
			log.Printf("feed: opensky poll every %s, bbox lamin=%.2f lomin=%.2f lamax=%.2f lomax=%.2f",
				interval, bbox.Lamin, bbox.Lomin, bbox.Lamax, bbox.Lomax)
		}
		go pollLoop(client, bbox, interval, st, history, h)
	} else {
		cfg := adsbiq.Config{
			URL:   env("ADSBIQ_URL", adsbiq.DefaultURL),
			Token: os.Getenv("ADSBIQ_TOKEN"),
			Lat:   os.Getenv("ADSBIQ_LAT"),
			Lon:   os.Getenv("ADSBIQ_LON"),
		}
		if cfg.Lat != "" && cfg.Lon != "" {
			log.Printf("feed: adsbiq wss zone lat=%s lon=%s", cfg.Lat, cfg.Lon)
		} else {
			log.Printf("feed: adsbiq wss global")
		}
		go streamLoop(adsbiq.New(cfg), st, history, h)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/api/snapshot", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(st.Snapshot())
	})
	mux.HandleFunc("/ws", h.ServeWS)

	handler := withCORS(mux)
	log.Printf("ops server listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, handler))
}

func streamLoop(client *adsbiq.Client, st *store.Store, history *detect.History, h *hub.Hub) {
	client.Run(func(batch adsbiq.Batch) {
		var newAlerts []detect.Alert
		for _, ac := range batch.Changed {
			newAlerts = append(newAlerts, history.Check(ac.ICAO24, detect.State{
				Time:    ac.Time,
				Alt:     ac.Alt,
				Heading: ac.Heading,
				VRate:   ac.VRate,
			})...)
		}
		for _, id := range batch.Removed {
			history.Forget(id)
		}

		st.UpdateAircraft(batch.Aircraft, true)
		st.AddAlerts(newAlerts)

		snap := st.Snapshot()
		h.Broadcast(hub.Message{Type: "tick", Data: snap})
		for _, a := range newAlerts {
			h.Broadcast(hub.Message{Type: "alert", Data: a})
		}
		log.Printf("stream ok: %d aircraft, %d new alerts", len(batch.Aircraft), len(newAlerts))
	}, func() {
		st.SetLive(false)
		h.Broadcast(hub.Message{Type: "tick", Data: st.Snapshot()})
	})
}

func pollLoop(
	client *opensky.Client,
	bbox opensky.BBox,
	interval time.Duration,
	st *store.Store,
	history *detect.History,
	h *hub.Hub,
) {
	backoff := interval
	for {
		aircraft, status, err := client.Fetch(bbox)
		if err != nil {
			log.Printf("opensky fetch: %v", err)
			st.UpdateAircraft(nil, false)
			h.Broadcast(hub.Message{Type: "tick", Data: st.Snapshot()})
			if status == http.StatusTooManyRequests {
				backoff = minDuration(backoff*2, 60*time.Second)
				log.Printf("rate limited; backing off to %s", backoff)
			}
			time.Sleep(backoff)
			continue
		}
		backoff = interval

		var newAlerts []detect.Alert
		for _, ac := range aircraft {
			alerts := history.Check(ac.ICAO24, detect.State{
				Time:    ac.Time,
				Alt:     ac.Alt,
				Heading: ac.Heading,
				VRate:   ac.VRate,
			})
			newAlerts = append(newAlerts, alerts...)
		}

		st.UpdateAircraft(aircraft, true)
		st.AddAlerts(newAlerts)

		snap := st.Snapshot()
		h.Broadcast(hub.Message{Type: "tick", Data: snap})
		for _, a := range newAlerts {
			h.Broadcast(hub.Message{Type: "alert", Data: a})
		}
		log.Printf("poll ok: %d aircraft, %d new alerts", len(aircraft), len(newAlerts))
		time.Sleep(interval)
	}
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func resolveBBox() opensky.BBox {
	scope := env("OPENSKY_SCOPE", "global")
	if scope == "global" {
		return opensky.GlobalBBox()
	}
	return opensky.BBox{
		Lamin: envFloat("BBOX_LAMIN", 35.0),
		Lomin: envFloat("BBOX_LOMIN", -80.0),
		Lamax: envFloat("BBOX_LAMAX", 42.0),
		Lomax: envFloat("BBOX_LOMAX", -71.0),
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envFloat(key string, fallback float64) float64 {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return fallback
	}
	return f
}

func envDuration(key string, fallback time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	if secs, err := strconv.Atoi(v); err == nil {
		return time.Duration(secs) * time.Second
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return fallback
	}
	return d
}

func minDuration(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}
