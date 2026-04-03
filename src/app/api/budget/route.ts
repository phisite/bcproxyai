import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();

    // Get daily limit config
    const configRow = db
      .prepare("SELECT value FROM budget_config WHERE key = 'daily_token_limit'")
      .get() as { value: string } | undefined;
    const dailyLimit = configRow ? Number(configRow.value) : 1000000;

    // Get today's usage
    const today = new Date().toISOString().slice(0, 10);
    const usage = db
      .prepare(
        `SELECT
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(input_tokens + output_tokens), 0) AS total_tokens,
          COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
        FROM token_usage
        WHERE created_at >= ?`
      )
      .get(`${today}T00:00:00`) as {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      estimated_cost_usd: number;
    };

    const percentUsed = dailyLimit > 0 ? (usage.total_tokens / dailyLimit) * 100 : 0;

    return NextResponse.json({
      dailyLimit,
      todayUsage: usage.total_tokens,
      todayInputTokens: usage.input_tokens,
      todayOutputTokens: usage.output_tokens,
      estimatedCostUsd: usage.estimated_cost_usd,
      percentUsed: Math.round(percentUsed * 100) / 100,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { dailyLimit } = body as { dailyLimit?: number };

    if (dailyLimit == null || dailyLimit < 0) {
      return NextResponse.json(
        { error: "dailyLimit must be a non-negative number" },
        { status: 400 }
      );
    }

    const db = getDb();
    db.prepare(
      "INSERT OR REPLACE INTO budget_config (key, value) VALUES ('daily_token_limit', ?)"
    ).run(String(dailyLimit));

    return NextResponse.json({ ok: true, dailyLimit });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
