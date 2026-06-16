import { NextRequest, NextResponse } from "next/server";
import { validateQueryRequest, validateApiKey, ValidationError } from "@/lib/validator";
import { agentManager } from "@/lib/agent-manager";
import { queryManager } from "@/lib/query-manager";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { status: "error", error: { code: "INVALID_REQUEST", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  let query;
  try {
    query = validateQueryRequest(body);
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json(
        { status: "error", error: { code: "INVALID_REQUEST", message: err.message } },
        { status: 400 }
      );
    }
    throw err;
  }

  if (!validateApiKey(query.api_key)) {
    return NextResponse.json(
      { status: "error", error: { code: "UNAUTHORIZED", message: "Invalid or missing api_key" } },
      { status: 401 }
    );
  }

  if (!agentManager.connected) {
    return NextResponse.json(
      { status: "error", error: { code: "AGENT_OFFLINE", message: "Agent is not connected" } },
      { status: 503 }
    );
  }

  const resultPromise = queryManager.register(query.query_id, query.timeout_ms);
  const sent = agentManager.sendQuery(query);

  if (!sent) {
    // Agent disconnected between the connected check and sendQuery
    return NextResponse.json(
      { status: "error", error: { code: "AGENT_OFFLINE", message: "Agent is not connected" } },
      { status: 503 }
    );
  }

  try {
    const result = await resultPromise;
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const error = err as Error & { code?: string };
    const code = error.code ?? "INTERNAL_ERROR";

    if (code === "TIMEOUT") {
      return NextResponse.json(
        { status: "error", error: { code: "TIMEOUT", message: "Query timed out" } },
        { status: 504 }
      );
    }

    if (code === "AGENT_DISCONNECTED") {
      return NextResponse.json(
        { status: "error", error: { code: "AGENT_DISCONNECTED", message: error.message } },
        { status: 503 }
      );
    }

    // Oracle error (ORA-XXXXX) — forward as-is with 200 so the client can read error details
    return NextResponse.json(
      { status: "error", query_id: query.query_id, error: { code, message: error.message } },
      { status: 200 }
    );
  }
}
