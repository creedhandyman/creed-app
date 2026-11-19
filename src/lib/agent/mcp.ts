/**
 * A small MCP server (JSON-RPC 2.0 over Streamable HTTP, JSON responses
 * only — no streaming needed for quick tools). Hand-written so the app
 * carries no SDK; covers initialize, ping, tools/list, tools/call and the
 * notifications a client sends. Transport-free: the route passes the parsed
 * body in and the tool runner, and sends back what this returns.
 */
import { TOOLS, type ToolDef, type ToolResult } from "./server";
import type { AgentScope } from "./keys";

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_INFO = { name: "creed", title: "Creed Handy Manager", version: "1.0.0" };

type Json = Record<string, unknown>;
export interface RpcRequest { jsonrpc?: string; id?: string | number | null; method?: string; params?: Json }

const err = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const ok = (id: unknown, result: Json) => ({ jsonrpc: "2.0", id, result });

export function toolListing(scopes: AgentScope[]): Json[] {
  return TOOLS.filter((t: ToolDef) => scopes.includes(t.scope)).map((t) => ({
    name: t.name, description: t.description, inputSchema: t.inputSchema,
  }));
}

/**
 * One JSON-RPC message → its response, or null for a notification (no id).
 * `call` runs a tool (scope + log + rate limit live there).
 */
export async function handleRpc(
  msg: RpcRequest,
  scopes: AgentScope[],
  call: (name: string, args: unknown) => Promise<ToolResult>,
): Promise<Json | null> {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return err(msg?.id, -32600, "Invalid Request");
  }
  const isNotification = msg.id === undefined;
  if (isNotification) return null; // notifications/initialized, cancelled, …
  const p = (msg.params || {}) as Json;
  switch (msg.method) {
    case "initialize": {
      const asked = typeof p.protocolVersion === "string" ? p.protocolVersion : "";
      return ok(msg.id, {
        protocolVersion: MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: "Creed tools for ONE handyman / field-service business (the one this connection belongs to). Start with business_summary for an overview. What is booked: list_schedule. Free times: get_open_slots (an empty day says why). Jobs: list_jobs, then get_job; update_job changes a status or adds a note. People: list_customers / get_customer (find_customer for an exact phone or email match). Money, read-only: list_quotes, get_quote, list_invoices. New requests: add_work_order (becomes a lead), then draft_quote (a draft the owner reviews), then schedule_job. Dates are in the business's time zone. Nothing here contacts customers, takes payments or deletes anything.",
      });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: toolListing(scopes) });
    case "tools/call": {
      const name = typeof p.name === "string" ? p.name : "";
      if (!TOOLS.some((t) => t.name === name)) return err(msg.id, -32602, `Unknown tool: ${name.slice(0, 40)}`);
      const r = await call(name, p.arguments ?? {});
      if (r.ok) {
        return ok(msg.id, { content: [{ type: "text", text: JSON.stringify(r.data) }], structuredContent: r.data, isError: false });
      }
      // Tool errors go back as a result the model can read, not a protocol error.
      return ok(msg.id, { content: [{ type: "text", text: r.error }], isError: true });
    }
    default:
      return err(msg.id, -32601, `Method not found: ${msg.method.slice(0, 40)}`);
  }
}
