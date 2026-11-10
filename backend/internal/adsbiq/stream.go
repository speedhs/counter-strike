package adsbiq

import (
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"sort"
	"time"

	"github.com/gorilla/websocket"
	"github.com/speed/counter-strike/backend/internal/opensky"
)

const DefaultURL = "wss://api.adsbiq.com/ws/"

// Config selects the ADSBiq live channel.
// Lat and Lon together switch on the 250 nm zone stream.
type Config struct {
	URL   string
	Token string
	Lat   string
	Lon   string
}

// Batch is the airborne picture after one websocket frame.
type Batch struct {
	Aircraft []opensky.Aircraft
	Changed  []opensky.Aircraft
	Removed  []string
}

// Client consumes the ADSBiq websocket and reconnects on failure.
type Client struct {
	cfg Config
}

func New(cfg Config) *Client {
	if cfg.URL == "" {
		cfg.URL = DefaultURL
	}
	return &Client{cfg: cfg}
}

// Run reads until the process exits. handle runs for each applied frame.
// down runs when the socket drops, before the next reconnect.
func (c *Client) Run(handle func(Batch), down func()) {
	backoff := 2 * time.Second
	for {
		gotFrame, err := c.session(handle)
		if err != nil {
			log.Printf("adsbiq: %v", err)
		}
		if down != nil {
			down()
		}
		if !gotFrame && backoff < 30*time.Second {
			backoff *= 2
		} else if gotFrame {
			backoff = 2 * time.Second
		}
		time.Sleep(backoff)
	}
}

func (c *Client) session(handle func(Batch)) (bool, error) {
	dialer := websocket.Dialer{
		HandshakeTimeout:  15 * time.Second,
		EnableCompression: true,
	}
	conn, _, err := dialer.Dial(c.endpoint(), nil)
	if err != nil {
		return false, err
	}
	defer conn.Close()

	conn.SetReadLimit(32 << 20)
	extend := func() {
		// The server pings every 30s. A quiet free-tier push can be much
		// slower than that, so keep the deadline alive from ping frames too.
		_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	}
	extend()
	conn.SetPingHandler(func(appData string) error {
		extend()
		return conn.WriteControl(websocket.PongMessage, []byte(appData), time.Now().Add(5*time.Second))
	})
	conn.SetPongHandler(func(string) error {
		extend()
		return nil
	})

	tracks := make(map[string]*track)
	var lastSeq int64
	ready := false
	got := false

	for {
		_, payload, err := conn.ReadMessage()
		if err != nil {
			return got, err
		}
		extend()

		var fr frame
		if err := json.Unmarshal(payload, &fr); err != nil {
			return got, err
		}
		if fr.Type != "full" && fr.Type != "delta" {
			continue
		}
		if fr.Type == "delta" && !ready {
			return got, fmt.Errorf("delta before snapshot")
		}
		if fr.Type == "delta" && fr.Seq != lastSeq+1 {
			return got, fmt.Errorf("sequence gap: have %d, got %d", lastSeq, fr.Seq)
		}

		batch := applyFrame(tracks, fr)
		if fr.Type == "full" {
			ready = true
		}
		lastSeq = fr.Seq
		got = true
		if handle != nil {
			handle(batch)
		}
	}
}

type frame struct {
	Type   string            `json:"type"`
	Seq    int64             `json:"seq"`
	Now    float64           `json:"now"`
	AC     []json.RawMessage `json:"ac"`
	New    []json.RawMessage `json:"new"`
	Update []json.RawMessage `json:"update"`
	Remove []string          `json:"remove"`
}

func applyFrame(tracks map[string]*track, fr frame) Batch {
	now := fr.Now
	if now <= 0 {
		now = float64(time.Now().Unix())
	}

	var removed []string
	var changed []opensky.Aircraft

	if fr.Type == "full" {
		// Full objects replace state. Merging onto the previous track would
		// keep fields the new snapshot no longer sends.
		fresh := make(map[string]*track, len(fr.AC))
		seen := make(map[string]struct{}, len(fr.AC))
		for _, raw := range fr.AC {
			ac, ok := mergeOne(fresh, raw, now)
			if !ok {
				continue
			}
			seen[ac.ICAO24] = struct{}{}
			changed = append(changed, ac)
		}
		for id := range tracks {
			if _, ok := seen[id]; !ok {
				removed = append(removed, id)
			}
		}
		clear(tracks)
		for id, tr := range fresh {
			tracks[id] = tr
		}
	} else {
		for _, raw := range fr.New {
			changed, removed = upsert(tracks, raw, now, changed, removed)
		}
		for _, raw := range fr.Update {
			changed, removed = upsert(tracks, raw, now, changed, removed)
		}
		for _, id := range fr.Remove {
			id = lowerHex(id)
			if _, exists := tracks[id]; exists {
				delete(tracks, id)
				removed = append(removed, id)
			}
		}
	}

	list := make([]opensky.Aircraft, 0, len(tracks))
	for _, tr := range tracks {
		list = append(list, tr.ac)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].ICAO24 < list[j].ICAO24 })
	return Batch{Aircraft: list, Changed: changed, Removed: removed}
}

func upsert(tracks map[string]*track, raw json.RawMessage, now float64, changed []opensky.Aircraft, removed []string) ([]opensky.Aircraft, []string) {
	id := hexOf(raw)
	_, existed := tracks[id]
	ac, ok := mergeOne(tracks, raw, now)
	if ok {
		return append(changed, ac), removed
	}
	if existed && id != "" {
		removed = append(removed, id)
	}
	return changed, removed
}

func mergeOne(tracks map[string]*track, raw json.RawMessage, now float64) (opensky.Aircraft, bool) {
	var p patch
	if err := json.Unmarshal(raw, &p); err != nil || p.Hex == "" {
		return opensky.Aircraft{}, false
	}
	id := lowerHex(p.Hex)
	tr := tracks[id]
	if tr == nil {
		tr = &track{}
	}
	if !tr.apply(p, now) {
		if tracks[id] != nil {
			delete(tracks, id)
		}
		return opensky.Aircraft{}, false
	}
	tracks[id] = tr
	return tr.ac, true
}

func hexOf(raw json.RawMessage) string {
	var p struct {
		Hex string `json:"hex"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return ""
	}
	return lowerHex(p.Hex)
}

func lowerHex(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + ('a' - 'A')
		}
	}
	return string(b)
}

func (c *Client) endpoint() string {
	u, err := url.Parse(c.cfg.URL)
	if err != nil {
		return c.cfg.URL
	}
	q := u.Query()
	if c.cfg.Token != "" {
		q.Set("token", c.cfg.Token)
	}
	if c.cfg.Lat != "" && c.cfg.Lon != "" {
		q.Set("lat", c.cfg.Lat)
		q.Set("lon", c.cfg.Lon)
	}
	u.RawQuery = q.Encode()
	return u.String()
}
