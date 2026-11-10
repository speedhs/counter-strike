# COUNTER-STRIKE — Live Aircraft Ops Dashboard

Defense-tech style ops console: live ADS-B tracks on a map with heading/altitude anomaly detection.

- **Backend:** Go — OpenSky poller, anomaly detector, WebSocket fan-out
- **Frontend:** React + MapLibre — full-bleed air picture + anomaly feed

Prototype detector logic lives in [`trial.py`](trial.py); the product path is the Go server.

## Quick start

Terminal 1 — API:

```bash
cd backend
go run ./cmd/server
```

Terminal 2 — UI:

```bash
cd frontend
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Tracks appear with the first websocket snapshot (a few seconds). The default feed is the ADSBiq live stream, worldwide.

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Liveness |
| `GET /api/snapshot` | Current aircraft + recent alerts |
| `GET /ws` | Stream `{ type: "tick" \| "alert", data: ... }` |

Vite proxies `/api` and `/ws` to `localhost:8080`.

## Environment (backend)

| Variable | Default | Meaning |
|----------|---------|---------|
| `ADDR` | `:8080` | Listen address |
| `FEED` | `adsbiq` | `adsbiq` = live `wss` stream; `opensky` = REST poll |
| `ADSBIQ_URL` | `wss://api.adsbiq.com/ws/` | Upstream websocket |
| `ADSBIQ_TOKEN` | | Optional feeder API key (faster tier) |
| `ADSBIQ_LAT` / `ADSBIQ_LON` | | Set both for the 250 nm zone stream (~1s) |
| `POLL_INTERVAL` | `15s` | OpenSky poll interval when `FEED=opensky` |
| `OPENSKY_SCOPE` | `global` | `global` or `regional` (OpenSky only) |
| `BBOX_LAMIN` | `35.0` | South latitude (OpenSky regional only) |
| `BBOX_LOMIN` | `-80.0` | West longitude (OpenSky regional only) |
| `BBOX_LAMAX` | `42.0` | North latitude (OpenSky regional only) |
| `BBOX_LOMAX` | `-71.0` | East longitude (OpenSky regional only) |

Zone example (New York, higher update rate):

```bash
ADSBIQ_LAT=40.7 ADSBIQ_LON=-74.0 go run ./cmd/server
```

OpenSky fallback:

```bash
FEED=opensky OPENSKY_SCOPE=regional POLL_INTERVAL=10 go run ./cmd/server
```

## Anomaly rules

Same thresholds as `trial.py`:

- Heading shift rate &gt; **8°/s**
- Absolute altitude change rate &gt; **35 m/s** (~7,000 fpm)
