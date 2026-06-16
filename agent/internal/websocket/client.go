package websocket

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	agentcrypto "github.com/jrti/oracle-query-agent/internal/crypto"
	"github.com/jrti/oracle-query-agent/internal/model"
)

const (
	pingInterval    = 10 * time.Minute
	pongTimeout     = 15 * time.Second
	maxReconnectWait = 30 * time.Second
)

// Client manages the WebSocket connection to the API server.
type Client struct {
	url     string
	apiKey  string
	OnQuery func(msg model.QueryMessage)

	mu          sync.Mutex
	conn        *websocket.Conn
	credentials *model.OracleCredentials
	pongCh      chan struct{}
}

func NewClient(url, apiKey string) *Client {
	return &Client{
		url:    url,
		apiKey: apiKey,
		pongCh: make(chan struct{}, 1),
	}
}

// Connect establishes the WebSocket connection, authenticates, and receives credentials.
func (c *Client) Connect(ctx context.Context) error {
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, _, err := dialer.DialContext(ctx, c.url, nil)
	if err != nil {
		return fmt.Errorf("dial %s: %w", c.url, err)
	}

	// Send auth message
	authMsg := model.AuthMessage{Type: "auth", Key: c.apiKey}
	if err := conn.WriteJSON(authMsg); err != nil {
		conn.Close()
		return fmt.Errorf("send auth: %w", err)
	}

	// Expect credentials message
	_, rawMsg, err := conn.ReadMessage()
	if err != nil {
		conn.Close()
		return fmt.Errorf("read credentials: %w", err)
	}

	var credsMsg model.CredentialsMessage
	if err := json.Unmarshal(rawMsg, &credsMsg); err != nil || credsMsg.Type != "credentials" {
		conn.Close()
		return fmt.Errorf("expected credentials message, got: %s", string(rawMsg[:min(len(rawMsg), 100)]))
	}

	creds, err := agentcrypto.DecryptCredentials(credsMsg.Data, c.apiKey)
	if err != nil {
		conn.Close()
		return fmt.Errorf("decrypt credentials: %w", err)
	}

	c.mu.Lock()
	c.conn = conn
	c.credentials = creds
	c.mu.Unlock()

	log.Println("[client] Connected and credentials received")

	go c.readLoop(ctx)
	go c.pingLoop(ctx)

	return nil
}

// Credentials returns the decrypted Oracle credentials (nil until connected).
func (c *Client) Credentials() *model.OracleCredentials {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.credentials
}

// SendResult sends a query result back to the API.
func (c *Client) SendResult(result model.ResultMessage) error {
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn == nil {
		return fmt.Errorf("not connected")
	}
	return conn.WriteJSON(result)
}

func (c *Client) readLoop(ctx context.Context) {
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			if ctx.Err() == nil {
				log.Printf("[client] Read error (will reconnect): %v", err)
			}
			c.closeConn()
			return
		}

		var base model.IncomingMessage
		if err := json.Unmarshal(raw, &base); err != nil {
			log.Printf("[client] Unrecognised message: %s", string(raw[:min(len(raw), 100)]))
			continue
		}

		switch base.Type {
		case "pong":
			select {
			case c.pongCh <- struct{}{}:
			default:
			}
		case "query":
			if c.OnQuery == nil {
				continue
			}
			var qMsg model.QueryMessage
			if err := json.Unmarshal(raw, &qMsg); err != nil {
				log.Printf("[client] Failed to parse query message: %v", err)
				continue
			}
			go c.OnQuery(qMsg)
		default:
			log.Printf("[client] Unknown message type: %s", base.Type)
		}
	}
}

func (c *Client) pingLoop(ctx context.Context) {
	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.mu.Lock()
			conn := c.conn
			c.mu.Unlock()
			if conn == nil {
				return
			}

			if err := conn.WriteJSON(model.PingMessage{Type: "ping"}); err != nil {
				log.Printf("[client] Failed to send ping: %v", err)
				c.closeConn()
				return
			}

			select {
			case <-c.pongCh:
				// pong received in time
			case <-time.After(pongTimeout):
				log.Println("[client] Pong timeout — closing connection")
				c.closeConn()
				return
			case <-ctx.Done():
				return
			}
		}
	}
}

// RunWithReconnect connects and reconnects with exponential backoff until ctx is cancelled.
func (c *Client) RunWithReconnect(ctx context.Context) {
	delay := time.Second

	for {
		if ctx.Err() != nil {
			return
		}

		log.Printf("[client] Connecting to %s", c.url)
		err := c.Connect(ctx)
		if err != nil {
			log.Printf("[client] Connection failed: %v — retrying in %s", err, delay)
			select {
			case <-ctx.Done():
				return
			case <-time.After(delay):
			}
			delay = min(delay*2, maxReconnectWait)
			continue
		}

		// Wait until the connection drops (readLoop sets conn to nil on error)
		for {
			time.Sleep(500 * time.Millisecond)
			c.mu.Lock()
			alive := c.conn != nil
			c.mu.Unlock()
			if !alive || ctx.Err() != nil {
				break
			}
		}

		if ctx.Err() != nil {
			return
		}

		log.Printf("[client] Reconnecting in %s", delay)
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		delay = min(delay*2, maxReconnectWait)
	}
}

// Close gracefully closes the WebSocket connection.
func (c *Client) Close() {
	c.mu.Lock()
	conn := c.conn
	c.conn = nil
	c.mu.Unlock()
	if conn != nil {
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, "shutdown"))
		conn.Close()
	}
}

func (c *Client) closeConn() {
	c.mu.Lock()
	conn := c.conn
	c.conn = nil
	c.mu.Unlock()
	if conn != nil {
		conn.Close()
	}
}

func min[T int | int64 | time.Duration](a, b T) T {
	if a < b {
		return a
	}
	return b
}
