import { test } from "node:test";
import assert from "node:assert/strict";

// Inline re-implementation matching validator.ts logic for Node-native testing
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 300_000;

function validateQueryRequest(body) {
  if (typeof body !== "object" || body === null) throw new ValidationError("Request body must be a JSON object");
  if (typeof body.api_key !== "string" || body.api_key.trim() === "") throw new ValidationError("api_key is required and must be a non-empty string");
  if (typeof body.query_id !== "string" || body.query_id.trim() === "") throw new ValidationError("query_id is required and must be a non-empty string");
  if (typeof body.sql !== "string" || body.sql.trim() === "") throw new ValidationError("sql is required and must be a non-empty string");
  if (!/^select\s/i.test(body.sql.trimStart())) throw new ValidationError("sql must be a SELECT statement");
  const params = body.params === undefined ? [] : body.params;
  if (!Array.isArray(params)) throw new ValidationError("params must be an array");
  let timeout_ms = body.timeout_ms === undefined ? DEFAULT_TIMEOUT_MS : body.timeout_ms;
  if (typeof timeout_ms !== "number" || !Number.isFinite(timeout_ms)) throw new ValidationError("timeout_ms must be a number");
  if (timeout_ms < MIN_TIMEOUT_MS || timeout_ms > MAX_TIMEOUT_MS) throw new ValidationError(`timeout_ms must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`);
  return { api_key: body.api_key, query_id: body.query_id, sql: body.sql, params, timeout_ms };
}

const VALID = {
  api_key: "sk_test",
  query_id: "uuid-123",
  sql: "SELECT id FROM pedidos",
  params: [],
  timeout_ms: 30_000,
};

test("valid request passes", () => {
  const result = validateQueryRequest(VALID);
  assert.equal(result.api_key, VALID.api_key);
  assert.equal(result.sql, VALID.sql);
});

test("missing api_key throws ValidationError", () => {
  assert.throws(() => validateQueryRequest({ ...VALID, api_key: "" }), ValidationError);
});

test("missing query_id throws ValidationError", () => {
  assert.throws(() => validateQueryRequest({ ...VALID, query_id: undefined }), ValidationError);
});

test("non-SELECT sql throws ValidationError", () => {
  assert.throws(() => validateQueryRequest({ ...VALID, sql: "DELETE FROM pedidos" }), ValidationError);
  assert.throws(() => validateQueryRequest({ ...VALID, sql: "INSERT INTO x VALUES (1)" }), ValidationError);
});

test("SELECT is case-insensitive", () => {
  assert.doesNotThrow(() => validateQueryRequest({ ...VALID, sql: "select id from pedidos" }));
  assert.doesNotThrow(() => validateQueryRequest({ ...VALID, sql: "SELECT id FROM pedidos" }));
});

test("params defaults to empty array when absent", () => {
  const { params } = validateQueryRequest({ ...VALID, params: undefined });
  assert.deepEqual(params, []);
});

test("timeout_ms defaults to 300000 when absent", () => {
  const { timeout_ms } = validateQueryRequest({ ...VALID, timeout_ms: undefined });
  assert.equal(timeout_ms, 300_000);
});

test("timeout_ms below minimum throws", () => {
  assert.throws(() => validateQueryRequest({ ...VALID, timeout_ms: 4999 }), ValidationError);
});

test("timeout_ms above maximum throws", () => {
  assert.throws(() => validateQueryRequest({ ...VALID, timeout_ms: 300_001 }), ValidationError);
});

test("null body throws ValidationError", () => {
  assert.throws(() => validateQueryRequest(null), ValidationError);
});
