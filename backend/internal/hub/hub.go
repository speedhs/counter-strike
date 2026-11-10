package hub

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// Message is a WebSocket envelope.
type Message struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

// Hub fans out messages to connected WebSocket clients.
type Hub struct {
	mu      sync.Mutex
	clients map[*websocket.Conn]struct{}
}

func New() *Hub {
	return &Hub{clients: make(map[*websocket.Conn]struct{})}
}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade: %v", err)
		return
	}
	h.mu.Lock()
	h.clients[conn] = struct{}{}
	h.mu.Unlock()

	defer func() {
		h.mu.Lock()
		delete(h.clients, conn)
		h.mu.Unlock()
		_ = conn.Close()
	}()

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
	}
}

func (h *Hub) Broadcast(msg Message) {
	payload, err := json.Marshal(msg)
	if err != nil {
		log.Printf("ws marshal: %v", err)
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for conn := range h.clients {
		if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
			_ = conn.Close()
			delete(h.clients, conn)
		}
	}
}
