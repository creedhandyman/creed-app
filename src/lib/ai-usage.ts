/**
 * Server-only: write one ai_usage row (Phase 0 cost measurement). Shared by
 * the Anthropic wrapper (anthropic-server.ts) and the OpenAI one
 * (openai-server.ts). Best-effort — a missing ai_usage table or insert error
 * is swallowed and never blocks or breaks the AI call it measures.
 */
import { serviceClient } from "./api-auth";

/** Who/what a call is logged under. call_type is free TEXT: parse | ping |
 *  voicewalk | assist | troubleshoot | receipt | tax | render | transcribe | other. */
export interface AiUsageLog {
  orgId?: string | null;
  userId?: string | null;
  callType?: string;
}

export interface AiUsageRow {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  estCost?: number;
}

export async function logAiUsage(log: AiUsageLog, row: AiUsageRow): Promise<void> {
  try {
    await serviceClient().from("ai_usage").insert({
      org_id: log.orgId || null,
      user_id: log.userId || null,
      call_type: log.callType || "other",
      model: row.model,
      input_tokens: row.inputTokens || 0,
      output_tokens: row.outputTokens || 0,
      cache_creation_tokens: row.cacheWriteTokens || 0,
      cache_read_tokens: row.cacheReadTokens || 0,
      est_cost: Number((row.estCost || 0).toFixed(6)),
    });
  } catch {
    /* logging is best-effort — ignore */
  }
}
