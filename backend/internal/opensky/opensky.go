package opensky

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const DefaultURL = "https://opensky-network.org/api/states/all"

// BBox is a geographic bounding box for OpenSky queries.
// When Global is true, OpenSky is queried with no bbox (worldwide).
type BBox struct {
	Lamin  float64
	Lomin  float64
	Lamax  float64
	Lomax  float64
	Global bool
}

// GlobalBBox fetches the full OpenSky state vector set.
func GlobalBBox() BBox {
	return BBox{Global: true}
}

// RegionalBBox is a busy US East Coast corridor (lighter anonymous rate use).
func RegionalBBox() BBox {
	return BBox{
		Lamin: 35.0,
		Lomin: -80.0,
		Lamax: 42.0,
		Lomax: -71.0,
	}
}

// Aircraft is a parsed airborne state vector.
type Aircraft struct {
	ICAO24   string  `json:"icao24"`
	Callsign string  `json:"callsign"`
	Lat      float64 `json:"lat"`
	Lon      float64 `json:"lon"`
	Alt      float64 `json:"alt"`
	Heading  float64 `json:"heading"`
	Velocity float64 `json:"velocity"`
	VRate    float64 `json:"v_rate"`
	OnGround bool    `json:"on_ground"`
	Time     float64 `json:"time"`
}

type apiResponse struct {
	Time   float64         `json:"time"`
	States [][]interface{} `json:"states"`
}

// Client fetches OpenSky state vectors.
type Client struct {
	URL        string
	HTTPClient *http.Client
}

func NewClient() *Client {
	return &Client{
		URL: DefaultURL,
		HTTPClient: &http.Client{
			// Worldwide state dumps are large; keep headroom for anonymous CDN latency.
			Timeout: 60 * time.Second,
		},
	}
}

// Fetch returns airborne aircraft. Pass Global bbox for worldwide; otherwise clamps to box.
// statusCode is useful for 429 backoff.
func (c *Client) Fetch(bbox BBox) ([]Aircraft, int, error) {
	u, err := url.Parse(c.URL)
	if err != nil {
		return nil, 0, err
	}
	if !bbox.Global {
		q := u.Query()
		q.Set("lamin", fmt.Sprintf("%f", bbox.Lamin))
		q.Set("lomin", fmt.Sprintf("%f", bbox.Lomin))
		q.Set("lamax", fmt.Sprintf("%f", bbox.Lamax))
		q.Set("lomax", fmt.Sprintf("%f", bbox.Lomax))
		u.RawQuery = q.Encode()
	}

	resp, err := c.HTTPClient.Get(u.String())
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, resp.StatusCode, fmt.Errorf("opensky status %d: %s", resp.StatusCode, string(body))
	}

	var data apiResponse
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, resp.StatusCode, err
	}

	out := make([]Aircraft, 0, len(data.States))
	for _, s := range data.States {
		ac, ok := parseState(s, data.Time)
		if !ok {
			continue
		}
		out = append(out, ac)
	}
	return out, resp.StatusCode, nil
}

func parseState(s []interface{}, fallbackTime float64) (Aircraft, bool) {
	if len(s) < 12 {
		return Aircraft{}, false
	}
	icao24, _ := s[0].(string)
	if icao24 == "" {
		return Aircraft{}, false
	}

	callsign, _ := s[1].(string)
	onGround, _ := s[8].(bool)

	lat, okLat := asFloat(s[6])
	lon, okLon := asFloat(s[5])
	alt, okAlt := asFloat(s[7])
	heading, okHdg := asFloat(s[10])
	if onGround || !okLat || !okLon || !okAlt || !okHdg {
		return Aircraft{}, false
	}

	velocity, _ := asFloat(s[9])
	vRate, _ := asFloat(s[11])
	t, okT := asFloat(s[3])
	if !okT {
		t = fallbackTime
	}

	return Aircraft{
		ICAO24:   icao24,
		Callsign: callsign,
		Lat:      lat,
		Lon:      lon,
		Alt:      alt,
		Heading:  heading,
		Velocity: velocity,
		VRate:    vRate,
		OnGround: onGround,
		Time:     t,
	}, true
}

func asFloat(v interface{}) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	case string:
		f, err := strconv.ParseFloat(n, 64)
		return f, err == nil
	case nil:
		return 0, false
	default:
		return 0, false
	}
}
