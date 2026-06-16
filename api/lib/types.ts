export interface OracleCredentials {
  host: string;
  port: string;
  service: string;
  user: string;
  password: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
}

export interface QueryRequest {
  api_key: string;
  query_id: string;
  sql: string;
  params: unknown[];
  timeout_ms: number;
}

export interface QueryResult {
  query_id: string;
  status: "success";
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  row_count: number;
  duration_ms: number;
}

export interface QueryError {
  query_id: string;
  status: "error";
  error: {
    code: string;
    message: string;
  };
  duration_ms: number;
}

export type WsMessage =
  | { type: "auth"; key: string }
  | { type: "ping" }
  | { type: "pong" }
  | { type: "credentials"; data: string }
  | {
      type: "query";
      query_id: string;
      sql: string;
      params: unknown[];
      timeout_ms: number;
    }
  | ({
      type: "result";
      query_id: string;
      status: "success" | "error";
      duration_ms: number;
    } & (
      | { status: "success"; columns: ColumnInfo[]; rows: Record<string, unknown>[]; row_count: number }
      | { status: "error"; error: { code: string; message: string } }
    ));
