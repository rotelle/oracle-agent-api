package websocket_test

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	gws "github.com/gorilla/websocket"
	agentcrypto "github.com/jrti/oracle-query-agent/internal/crypto"
	"github.com/jrti/oracle-query-agent/internal/model"
	agentws "github.com/jrti/oracle-query-agent/internal/websocket"
)

const testKey = "sk_reconnect_test"

var testCreds = model.OracleCredentials{
	Host: "localhost", Port: "1521", Service: "XE", User: "u", Password: "p",
}

// encryptCreds mirrors the TypeScript encryptCredentials to build test payloads
// without depending on the API binary.
func encryptCreds(creds model.OracleCredentials, apiKey string) string {
	key := agentcrypto.DeriveKey(apiKey)
	plain, _ := json.Marshal(creds)
	block, _ := aes.NewCipher(key)
	gcm, _ := cipher.NewGCM(block)
	iv := make([]byte, gcm.NonceSize())
	_, _ = rand.Read(iv)
	sealed := gcm.Seal(nil, iv, plain, nil)
	ct := sealed[:len(sealed)-16]
	tag := sealed[len(sealed)-16:]
	return strings.Join([]string{
		base64.StdEncoding.EncodeToString(iv),
		base64.StdEncoding.EncodeToString(tag),
		base64.StdEncoding.EncodeToString(ct),
	}, ":")
}

// fakeServer starts an httptest.Server that acts as the API: accepts the auth
// handshake, sends encrypted credentials, then signals each accepted conn on
// connCh so the test can interact with or close it.
func fakeServer(connCh chan<- *gws.Conn) *httptest.Server {
	up := gws.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		_, raw, err := conn.ReadMessage()
		if err != nil {
			conn.Close()
			return
		}
		var auth model.AuthMessage
		if json.Unmarshal(raw, &auth) != nil || auth.Type != "auth" || auth.Key != testKey {
			conn.Close()
			return
		}
		conn.WriteJSON(model.CredentialsMessage{ //nolint:errcheck
			Type: "credentials",
			Data: encryptCreds(testCreds, testKey),
		})
		connCh <- conn
		// Drain until the connection is closed by the test or server shutdown.
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}))
}

// TestRunWithReconnect_ReconnectsAfterDrop verifies that the client re-establishes
// the WebSocket connection automatically when the server forcibly drops it.
func TestRunWithReconnect_ReconnectsAfterDrop(t *testing.T) {
	connCh := make(chan *gws.Conn, 2)
	srv := fakeServer(connCh)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	client := agentws.NewClient(wsURL, testKey)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	go client.RunWithReconnect(ctx)

	// Wait for the first successful connection.
	var first *gws.Conn
	select {
	case first = <-connCh:
	case <-time.After(5 * time.Second):
		t.Fatal("timeout waiting for initial connection")
	}

	// Simulate a network drop by closing the server-side socket.
	first.Close()

	// The client should detect the drop and reconnect within a few seconds
	// (500 ms poll + 1 s backoff + dial time).
	select {
	case <-connCh:
		// Reconnected successfully.
	case <-time.After(5 * time.Second):
		t.Fatal("timeout waiting for reconnection after server-side drop")
	}
}
