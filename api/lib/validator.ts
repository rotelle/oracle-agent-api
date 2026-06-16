import type { QueryRequest } from "./types";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 300_000;

export function validateQueryRequest(body: unknown): QueryRequest {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Request body must be a JSON object");
  }

  const raw = body as Record<string, unknown>;

  if (typeof raw.api_key !== "string" || raw.api_key.trim() === "") {
    throw new ValidationError("api_key is required and must be a non-empty string");
  }

  if (typeof raw.query_id !== "string" || raw.query_id.trim() === "") {
    throw new ValidationError("query_id is required and must be a non-empty string");
  }

  if (typeof raw.sql !== "string" || raw.sql.trim() === "") {
    throw new ValidationError("sql is required and must be a non-empty string");
  }

  if (!/^select\s/i.test(raw.sql.trimStart())) {
    throw new ValidationError("sql must be a SELECT statement");
  }

  const params = raw.params === undefined ? [] : raw.params;
  if (!Array.isArray(params)) {
    throw new ValidationError("params must be an array");
  }

  let timeout_ms = raw.timeout_ms === undefined ? DEFAULT_TIMEOUT_MS : raw.timeout_ms;
  if (typeof timeout_ms !== "number" || !Number.isFinite(timeout_ms)) {
    throw new ValidationError("timeout_ms must be a number");
  }
  if (timeout_ms < MIN_TIMEOUT_MS || timeout_ms > MAX_TIMEOUT_MS) {
    throw new ValidationError(
      `timeout_ms must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`
    );
  }

  return {
    api_key: raw.api_key,
    query_id: raw.query_id,
    sql: raw.sql,
    params,
    timeout_ms,
  };
}

export function validateApiKey(apiKey: string): boolean {
  const expected = process.env.AGENT_API_KEY;
  if (!expected) return false;
  return apiKey === expected;
}
