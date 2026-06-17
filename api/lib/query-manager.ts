import type { QueryResult, QueryError } from "./types";

type PendingEntry = {
  resolve: (result: QueryResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type ResultPayload = {
  type: "result";
  query_id: string;
  status: "success" | "error";
  duration_ms: number;
  columns?: QueryResult["columns"];
  rows?: QueryResult["rows"];
  row_count?: number;
  error?: QueryError["error"];
};

export class QueryManager {
  private readonly pending = new Map<string, PendingEntry>();

  register(queryId: string, timeoutMs: number): Promise<QueryResult> {
    return new Promise<QueryResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(queryId);
        reject(Object.assign(new Error("Query timed out"), { code: "TIMEOUT" }));
      }, timeoutMs);

      this.pending.set(queryId, { resolve, reject, timer });
    });
  }

  resolve(message: ResultPayload): void {
    const entry = this.pending.get(message.query_id);
    if (!entry) return;

    clearTimeout(entry.timer);
    this.pending.delete(message.query_id);

    if (message.status === "success") {
      entry.resolve({
        query_id: message.query_id,
        status: "success",
        columns: message.columns ?? [],
        rows: message.rows ?? [],
        row_count: message.row_count ?? 0,
        duration_ms: message.duration_ms,
      });
    } else {
      const err = Object.assign(
        new Error(message.error?.message ?? "Oracle error"),
        { code: message.error?.code ?? "ORA-00000" }
      );
      entry.reject(err);
    }
  }

  rejectAll(code: string, message: string): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(Object.assign(new Error(message), { code }));
    }
    this.pending.clear();
  }

  hasPending(queryId: string): boolean {
    return this.pending.has(queryId);
  }
}

const _key = Symbol.for("jrti.queryManager");
if (!(globalThis as Record<symbol, unknown>)[_key]) {
  (globalThis as Record<symbol, unknown>)[_key] = new QueryManager();
}
export const queryManager = (globalThis as Record<symbol, unknown>)[_key] as QueryManager;
