import time
import requests
import numpy as np

# OpenSky API endpoint (bounding box over active airspace, e.g., US East Coast or Europe)
OPENSKY_URL = "https://opensky-network.org/api/states/all"

# Historical state buffer: { icao24: [(timestamp, alt, heading, lat, lon)] }
state_history = {}

def normalize_angle_delta(a1, a2):
    """Calculates minimal angular delta handling 360/0 degree wrap-around."""
    diff = abs(a1 - a2) % 360
    return 360 - diff if diff > 180 else diff

def detect_anomaly(icao24, current_state):
    t_curr, alt_curr, heading_curr, v_rate_curr = current_state
    
    if icao24 not in state_history or len(state_history[icao24]) < 2:
        state_history.setdefault(icao24, []).append(current_state)
        return

    # Compare with previous state snapshot
    t_prev, alt_prev, heading_prev, _ = state_history[icao24][-1]
    dt = t_curr - t_prev

    if dt <= 0:
        return

    # Calculate metrics
    alt_rate_actual = abs(alt_curr - alt_prev) / dt # m/s
    heading_shift_rate = normalize_angle_delta(heading_curr, heading_prev) / dt # deg/s

    # Threshold rules for sudden shifts (tweak based on flight phase)
    # Thresholds: Heading shift > 8 deg/s OR Altitude change > 35 m/s (~7,000 fpm)
    if heading_shift_rate > 8.0:
        print(f"⚠️ [ANOMALY DETECTED] Aircraft {icao24} | Sudden Heading Shift: {heading_shift_rate:.2f}°/s")
        
    if alt_rate_actual > 35.0:
        print(f"⚠️ [ANOMALY DETECTED] Aircraft {icao24} | Rapid Altitude Shift: {alt_rate_actual:.2f} m/s")

    # Maintain window depth
    state_history[icao24].append(current_state)
    if len(state_history[icao24]) > 10:
        state_history[icao24].pop(0)

def poll_opensky():
    response = requests.get(OPENSKY_URL)
    if response.status_code == 200:
        data = response.json()
        states = data.get("states", [])
        
        for s in states:
            icao24 = s[0]
            on_ground = s[8]
            
            # Filter out grounded aircraft or incomplete state vectors
            if on_ground or s[7] is None or s[10] is None:
                continue
                
            t_curr = s[3] or data["time"]
            alt = s[7]        # Meters
            heading = s[10]   # Degrees
            v_rate = s[11]    # m/s
            
            detect_anomaly(icao24, (t_curr, alt, heading, v_rate))

if __name__ == "__main__":
    print("Starting OpenSky Real-Time Telemetry Anomaly Detection Engine...")
    while True:
        try:
            poll_opensky()
            time.sleep(10) # Respect public rate limits
        except Exception as e:
            print(f"Error polling OpenSky: {e}")
            time.sleep(10)
