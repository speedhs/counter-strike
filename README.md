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

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Tracks appear within one poll cycle (~15s). Default scope is **global** (worldwide OpenSky).

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
| `POLL_INTERVAL` | `15s` | OpenSky poll interval (`15` or `15s`) |
| `OPENSKY_SCOPE` | `global` | `global` = worldwide; `regional` = use bbox |
| `BBOX_LAMIN` | `35.0` | South latitude (regional only) |
| `BBOX_LOMIN` | `-80.0` | West longitude (regional only) |
| `BBOX_LAMAX` | `42.0` | North latitude (regional only) |
| `BBOX_LOMAX` | `-71.0` | East longitude (regional only) |

On HTTP 429 the server backs off up to 60s. Prefer a longer `POLL_INTERVAL` for global anonymous access.

Regional example (US East Coast):

```bash
OPENSKY_SCOPE=regional POLL_INTERVAL=10 go run ./cmd/server
```

## Anomaly rules

Same thresholds as `trial.py`:

- Heading shift rate &gt; **8°/s**
- Absolute altitude change rate &gt; **35 m/s** (~7,000 fpm)
