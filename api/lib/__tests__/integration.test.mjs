/**
 * Integration tests for the POST /api/query flow.
 *
 * Uses an in-process HTTP + WebSocket test server with a mock agent.
 * No Oracle database or Next.js is required.
 *
 * Run: node --test api/lib/__tests__/integration.test.mjs
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash, randomBytes, createCipheriv } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

// ─────────────────────────────────────────────────────────────────────────────
// Shared state
// ─────────────────────────────────────────────────────────────────────────────

const API_KEY = "sk_integration_test_key";
process.env.AGENT_API_KEY = API_KEY;

let server, wss, port;
let mockAgentWs = null;   // client-side socket (the "agent" side)
let serverAgentWs = null; // server-side socket for this connection
let onQuery = null;       // set by each test to intercept queries

/** Mimics api/lib/crypto.ts encryptCredentials for the test server. */
function fakeEncryptCreds() {
  const key = createHash("sha256").update(API_KEY).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const pt = JSON.stringify({ host: "localhost", port: "1521", service: "ORCL", user: "u", password: "p" });
  const enc = Buffer.concat([cipher.update(pt, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal stub of QueryManager (mirrors api/lib/query-manager.ts)
// ─────────────────────────────────────────────────────────────────────────────

class QueryManager {
  #pending = new Map();

  register(queryId, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(queryId);
        reject(Object.assign(new Error("TIMEOUT"), { code: "TIMEOUT" }));
      }, timeoutMs);
      this.#pending.set(queryId, { resolve, reject, timer });
    });
  }

  resolve(msg) {
    const entry = this.#pending.get(msg.query_id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.#pending.delete(msg.query_id);
    if (msg.status === "success") {
      entry.resolve({ query_id: msg.query_id, status: "success", columns: msg.columns ?? [], rows: msg.rows ?? [], row_count: msg.row_count ?? 0, duration_ms: msg.duration_ms ?? 0 });
    } else {
      entry.reject(Object.assign(new Error(msg.error?.message ?? "error"), { code: msg.error?.code ?? "ORA-00000" }));
    }
  }

  rejectAll(code, message) {
    for (const [, e] of this.#pending) { clearTimeout(e.timer); e.reject(Object.assign(new Error(message), { code })); }
    this.#pending.clear();
  }
}

const qm = new QueryManager();

// ─────────────────────────────────────────────────────────────────────────────
// Minimal HTTP handler (mirrors api/app/api/query/route.ts)
// ─────────────────────────────────────────────────────────────────────────────

function handlePostQuery(req, res) {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    // Parse body
    let body;
    try { body = JSON.parse(raw); } catch {
      res.writeHead(400); res.end(JSON.stringify({ status: "error", error: { code: "INVALID_REQUEST", message: "Invalid JSON" } })); return;
    }
    // Validate SELECT
    if (typeof body.sql !== "string" || !/^select\s/i.test(body.sql.trimStart())) {
      res.writeHead(400); res.end(JSON.stringify({ status: "error", error: { code: "INVALID_REQUEST", message: "Must be SELECT" } })); return;
    }
    // Validate api_key
    if (body.api_key !== process.env.AGENT_API_KEY) {
      res.writeHead(401); res.end(JSON.stringify({ status: "error", error: { code: "UNAUTHORIZED", message: "Invalid api_key" } })); return;
    }
    // Check agent
    if (!serverAgentWs || serverAgentWs.readyState !== 1 /* OPEN */) {
      res.writeHead(503); res.end(JSON.stringify({ status: "error", error: { code: "AGENT_OFFLINE", message: "Agent not connected" } })); return;
    }
    const timeoutMs = body.timeout_ms ?? 300000;
    // Register then forward
    const promise = qm.register(body.query_id, timeoutMs);
    serverAgentWs.send(JSON.stringify({ type: "query", query_id: body.query_id, sql: body.sql, params: body.params ?? [], timeout_ms: timeoutMs }));
    try {
      const result = await promise;
      res.writeHead(200); res.end(JSON.stringify(result));
    } catch (err) {
      if (err.code === "TIMEOUT") { res.writeHead(504); res.end(JSON.stringify({ status: "error", error: { code: "TIMEOUT", message: "Timed out" } })); return; }
      if (err.code === "AGENT_DISCONNECTED") { res.writeHead(503); res.end(JSON.stringify({ status: "error", error: { code: "AGENT_DISCONNECTED", message: err.message } })); return; }
      res.writeHead(500); res.end(JSON.stringify({ status: "error", error: { code: "INTERNAL", message: err.message } }));
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test lifecycle
// ─────────────────────────────────────────────────────────────────────────────

before(async () => {
  server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/query") handlePostQuery(req, res);
    else { res.writeHead(404); res.end(); }
  });

  wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws) => {
    // Expect auth as first message
    ws.once("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type !== "auth" || msg.key !== process.env.AGENT_API_KEY) {
        ws.close(4001, "Unauthorized"); return;
      }
      serverAgentWs = ws;
      ws.send(JSON.stringify({ type: "credentials", data: fakeEncryptCreds() }));

      // Handle subsequent messages from agent (results + pings)
      ws.on("message", (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
        if (m.type === "result") qm.resolve(m);
      });

      ws.on("close", () => {
        serverAgentWs = null;
        qm.rejectAll("AGENT_DISCONNECTED", "Agent disconnected");
      });
    });
  });

  server.on("upgrade", (req, socket, head) => {
    if (req.url === "/agent") wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    else socket.destroy();
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;

  // Connect mock agent and wait for credentials
  await new Promise((resolve, reject) => {
    mockAgentWs = new WebSocket(`ws://127.0.0.1:${port}/agent`);
    mockAgentWs.on("open", () => mockAgentWs.send(JSON.stringify({ type: "auth", key: API_KEY })));
    mockAgentWs.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === "credentials") resolve();
      // Route incoming query messages to the currently registered onQuery handler
      else if (m.type === "query" && typeof onQuery === "function") onQuery(m);
    });
    mockAgentWs.on("error", reject);
  });

  // After initial credentials resolved, keep routing query messages
  mockAgentWs.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "query" && typeof onQuery === "function") onQuery(m);
  });
});

after(async () => {
  onQuery = null;
  if (mockAgentWs) mockAgentWs.close();
  wss.close();
  await new Promise((r) => server.close(r));
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────

async function postQuery(body) {
  const res = await fetch(`http://127.0.0.1:${port}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests (12.1)
// ─────────────────────────────────────────────────────────────────────────────

test("12.1a — agent connected: POST returns success result", async () => {
  const queryId = "int-test-success";
  onQuery = (q) => {
    mockAgentWs.send(JSON.stringify({
      type: "result", query_id: q.query_id, status: "success",
      columns: [{ name: "ID", type: "NUMBER" }],
      rows: [{ ID: 42 }], row_count: 1, duration_ms: 5,
    }));
  };

  const { status, body } = await postQuery({
    api_key: API_KEY, query_id: queryId,
    sql: "SELECT id FROM pedidos", params: [],
  });
  onQuery = null;

  assert.equal(status, 200);
  assert.equal(body.status, "success");
  assert.equal(body.row_count, 1);
  assert.deepEqual(body.rows, [{ ID: 42 }]);
});

test("12.1b — agent offline: POST returns 503 AGENT_OFFLINE", async () => {
  // Temporarily mark agent as disconnected
  const saved = serverAgentWs;
  serverAgentWs = null;

  const { status, body } = await postQuery({
    api_key: API_KEY, query_id: "int-test-offline",
    sql: "SELECT 1 FROM DUAL",
  });

  serverAgentWs = saved;

  assert.equal(status, 503);
  assert.equal(body.error.code, "AGENT_OFFLINE");
});

test("12.1c — invalid api_key: POST returns 401 UNAUTHORIZED", async () => {
  const { status, body } = await postQuery({
    api_key: "wrong_key", query_id: "int-test-unauth",
    sql: "SELECT 1 FROM DUAL",
  });
  assert.equal(status, 401);
  assert.equal(body.error.code, "UNAUTHORIZED");
});

test("12.1d — malformed JSON: POST returns 400 INVALID_REQUEST", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ not valid json",
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error.code, "INVALID_REQUEST");
});

test("12.1e — timeout: POST returns 504 TIMEOUT (5s)", { timeout: 10000 }, async () => {
  // onQuery = null → agent never responds → timeout fires
  onQuery = null;
  const { status, body } = await postQuery({
    api_key: API_KEY, query_id: "int-test-timeout",
    sql: "SELECT id FROM pedidos", timeout_ms: 5000,
  });
  assert.equal(status, 504);
  assert.equal(body.error.code, "TIMEOUT");
});
