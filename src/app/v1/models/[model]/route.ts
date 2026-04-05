import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/schema";
import { openAIError, toOpenAIModelObject, unixNow } from "@/lib/openai-compat";

export const dynamic = "force-dynamic";

// Virtual bcproxy/* models
const VIRTUAL_MODELS: Record<string, { description: string }> = {
  "bcproxy/auto": { description: "Best available model (highest benchmark score)" },
  "bcproxy/fast": { description: "Fastest model (lowest latency)" },
  "bcproxy/tools": { description: "Best model that supports tool calling" },
  "bcproxy/thai": { description: "Best model for Thai language" },
  "bcproxy/consensus": { description: "Send to 3 models, pick best answer" },
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ model: string }> }
) {
  try {
    const { model: modelParam } = await params;
    const modelId = decodeURIComponent(modelParam);

    // Check virtual models
    if (VIRTUAL_MODELS[modelId]) {
      return NextResponse.json(
        toOpenAIModelObject(modelId, "bcproxy", unixNow()),
        { headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    // Search in database: try provider/model_id format first, then model_id
    const db = getDb();
    const row = db.prepare(
      `SELECT m.provider, m.model_id, m.first_seen
       FROM models m
       WHERE m.model_id = ? OR (m.provider || '/' || m.model_id) = ?
       LIMIT 1`
    ).get(modelId, modelId) as { provider: string; model_id: string; first_seen: string } | undefined;

    if (!row) {
      return openAIError(404, {
        message: `The model '${modelId}' does not exist`,
        param: "model",
      });
    }

    const created = row.first_seen
      ? Math.floor(new Date(row.first_seen).getTime() / 1000)
      : unixNow();

    return NextResponse.json(
      toOpenAIModelObject(`${row.provider}/${row.model_id}`, row.provider, created),
      { headers: { "Access-Control-Allow-Origin": "*" } }
    );
  } catch (err) {
    console.error("[v1/models/:id] Error:", err);
    return openAIError(500, { message: String(err) });
  }
}

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
