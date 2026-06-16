import type WebSocket from "ws";
import { encryptCredentials } from "./crypto";
import { queryManager } from "./query-manager";
import type { QueryRequest, ColumnInfo } from "./types";

type WsResultMessage = {
  type: "result";
  query_id: string;
  status: "success" | "error";
  duration_ms: number;
  columns?: ColumnInfo[];
  rows?: Record<string, unknown>[];
  row_count?: number;
  error?: { code: string; message: string };
};

export class AgentManager {
  private socket: WebSocket | null = null;

  get connected(): boolean {
    return this.socket !== null;
  }

  handleConnection(ws: WebSocket): void {
    // Expect the first message to be auth
    ws.once("message", (raw: Buffer | string) => {
      let msg: { type: string; key?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.close(4001, "Invalid JSON in auth message");
        return;
      }

      if (msg.type !== "auth" || msg.key !== process.env.AGENT_API_KEY) {
        ws.close(4001, "Unauthorized");
        return;
      }

      // Accept the connection
      this.socket = ws;
      console.log("[AgentManager] Agent connected");

      // Send encrypted Oracle credentials
      try {
        const payload = this.buildCredentialsPayload();
        ws.send(JSON.stringify({ type: "credentials", data: payload }));
      } catch (err) {
        console.error("[AgentManager] Failed to send credentials:", err);
        ws.close(1011, "Internal server error");
        this.socket = null;
        return;
      }

      ws.on("message", (data: Buffer | string) => this.handleMessage(data.toString()));

      ws.on("close", () => {
        console.log("[AgentManager] Agent disconnected");
        this.socket = null;
        queryManager.rejectAll("AGENT_DISCONNECTED", "Agent disconnected during query execution");
      });

      ws.on("error", (err) => {
        console.error("[AgentManager] WebSocket error:", err);
        this.socket = null;
        queryManager.rejectAll("AGENT_DISCONNECTED", "Agent connection error");
      });
    });
  }

  handleMessage(raw: string): void {
    let msg: { type: string } & Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.warn("[AgentManager] Received invalid JSON:", raw.slice(0, 200));
      return;
    }

    if (msg.type === "ping") {
      this.socket?.send(JSON.stringify({ type: "pong" }));
      return;
    }

    if (msg.type === "result") {
      queryManager.resolve(msg as unknown as WsResultMessage);
    }
  }

  sendQuery(query: QueryRequest): boolean {
    if (!this.socket) return false;
    this.socket.send(
      JSON.stringify({
        type: "query",
        query_id: query.query_id,
        sql: query.sql,
        params: query.params,
        timeout_ms: query.timeout_ms,
      })
    );
    return true;
  }

  buildCredentialsPayload(): string {
    const apiKey = process.env.AGENT_API_KEY;
    if (!apiKey) throw new Error("AGENT_API_KEY environment variable is not set");

    const credentials = {
      host: process.env.ORACLE_HOST ?? "",
      port: process.env.ORACLE_PORT ?? "1521",
      service: process.env.ORACLE_SERVICE ?? "",
      user: process.env.ORACLE_USER ?? "",
      password: process.env.ORACLE_PASSWORD ?? "",
    };

    return encryptCredentials(credentials, apiKey);
  }
}

export const agentManager = new AgentManager();
