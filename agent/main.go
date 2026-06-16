package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/jrti/oracle-query-agent/internal/model"
	"github.com/jrti/oracle-query-agent/internal/oracle"
	agentws "github.com/jrti/oracle-query-agent/internal/websocket"
)

func main() {
	key := flag.String("key", "", "Agent API key (must match AGENT_API_KEY on the server)")
	url := flag.String("url", "", "WebSocket URL of the API server (e.g. wss://your-api.render.com)")
	flag.Parse()

	if *key == "" || *url == "" {
		fmt.Fprintln(os.Stderr, "Usage: jrti-oracle-query.exe --key=<AGENT_API_KEY> --url=<WSS_URL>")
		os.Exit(1)
	}

	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	log.Printf("[main] Starting JRTi Oracle Query agent — target: %s", *url)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	client := agentws.NewClient(*url, *key)

	// executor is initialised lazily once credentials arrive from the API.
	var executor atomic.Pointer[oracle.Executor]

	client.OnQuery = func(msg model.QueryMessage) {
		log.Printf("[main] Query received query_id=%s", msg.QueryID)

		exec := executor.Load()
		if exec == nil {
			log.Printf("[main] Executor not ready, rejecting query_id=%s", msg.QueryID)
			_ = client.SendResult(model.ResultMessage{
				Type:    "result",
				QueryID: msg.QueryID,
				Status:  "error",
				Error: &model.QueryErrorDetail{
					Code:    "AGENT_NOT_READY",
					Message: "Oracle connection not established yet",
				},
			})
			return
		}

		result := exec.Execute(ctx, msg)
		log.Printf("[main] Query done query_id=%s status=%s duration_ms=%d",
			msg.QueryID, result.Status, result.DurationMs)

		if err := client.SendResult(result); err != nil {
			log.Printf("[main] Failed to send result query_id=%s: %v", msg.QueryID, err)
		}
	}

	// Start reconnect loop in background.
	go client.RunWithReconnect(ctx)

	// Poll for credentials and initialise executor when they arrive.
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if executor.Load() != nil {
					return
				}
				creds := client.Credentials()
				if creds == nil {
					continue
				}
				exec, err := oracle.NewExecutor(creds)
				if err != nil {
					log.Printf("[main] Failed to connect to Oracle: %v", err)
					continue
				}
				executor.Store(exec)
				log.Println("[main] Oracle executor ready")
				return
			}
		}
	}()

	<-ctx.Done()
	log.Println("[main] Shutdown signal received — closing connections")

	client.Close()

	if exec := executor.Load(); exec != nil {
		exec.Close()
	}

	log.Println("[main] Shutdown complete")
}
