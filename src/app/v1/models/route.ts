import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/schema";
import { openAIError, toOpenAIModelObject, unixNow } from "@/lib/openai-compat";

export const dynamic = "force-dynamic";

interface ModelRow {
  id: string;
  name: string;
  provider: string;
  model_id: string;
  context_length: number;
  tier: string;
  supports_tools: number;
  supports_vision: number;
  first_seen: string;
  health_status: string | null;
  cooldown_until: string | null;
  avg_score: number | null;
  avg_latency: number | null;
}

// Virtual bcproxy/* models shown at top
const VIRTUAL_MODELS = [
  toOpenAIModelObject("bcproxy/auto", "bcproxy"),
  toOpenAIModelObject("bcproxy/fast", "bcproxy"),
  toOpenAIModelObject("bcproxy/tools", "bcproxy"),
  toOpenAIModelObject("bcproxy/thai", "bcproxy"),
  toOpenAIModelObject("bcproxy/consensus", "bcproxy"),
];

export async function GET(_req: NextRequest) {
  try {
    const db = getDb();

    const rows = db
      .prepare(
        `
        SELECT
          m.id,
          m.name,
          m.provider,
          m.model_id,
          m.context_length,
          m.tier,
          m.supports_tools,
          m.supports_vision,
          m.first_seen,
          h.status as health_status,
          h.cooldown_until,
          COALESCE(b.avg_score, 0) as avg_score,
          COALESCE(b.avg_latency, 0) as avg_latency
        FROM models m
        LEFT JOIN (
          SELECT hl.model_id, hl.status, hl.cooldown_until
          FROM health_logs hl
          INNER JOIN (
            SELECT model_id, MAX(checked_at) as max_checked
            FROM health_logs
            GROUP BY model_id
          ) latest ON hl.model_id = latest.model_id AND hl.checked_at = latest.max_checked
        ) h ON m.id = h.model_id
        LEFT JOIN (
          SELECT model_id, AVG(score) as avg_score, AVG(latency_ms) as avg_latency
          FROM benchmark_results
          GROUP BY model_id
        ) b ON m.id = b.model_id
        ORDER BY avg_score DESC, m.provider ASC, m.name ASC
      `
      )
      .all() as ModelRow[];

    const realModels = rows.map((row) => {
      const created = row.first_seen
        ? Math.floor(new Date(row.first_seen).getTime() / 1000)
        : unixNow();

      return toOpenAIModelObject(
        `${row.provider}/${row.model_id}`,
        row.provider,
        created
      );
    });

    return NextResponse.json({
      object: "list",
      data: [...VIRTUAL_MODELS, ...realModels],
    });
  } catch (err) {
    console.error("[v1/models] Error:", err);
    return openAIError(500, { message: String(err) });
  }
}

// Handle OPTIONS for CORS preflight
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
