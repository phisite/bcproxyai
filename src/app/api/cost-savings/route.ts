import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// Pricing per 1M tokens (USD)
const PRICING = {
  gpt4o: { input: 2.5, output: 10 },
  claude: { input: 3, output: 15 },
};

export async function GET() {
  try {
    const db = getDb();

    // All-time totals
    const allTime = db
      .prepare(
        `SELECT
          COALESCE(SUM(input_tokens), 0) AS total_input,
          COALESCE(SUM(output_tokens), 0) AS total_output
        FROM token_usage`
      )
      .get() as { total_input: number; total_output: number };

    // Today totals
    const today = new Date().toISOString().slice(0, 10);
    const todayUsage = db
      .prepare(
        `SELECT
          COALESCE(SUM(input_tokens), 0) AS total_input,
          COALESCE(SUM(output_tokens), 0) AS total_output
        FROM token_usage
        WHERE created_at >= ?`
      )
      .get(`${today}T00:00:00`) as { total_input: number; total_output: number };

    const calcCost = (input: number, output: number, pricing: { input: number; output: number }) =>
      (input / 1_000_000) * pricing.input + (output / 1_000_000) * pricing.output;

    const costGpt4o = calcCost(allTime.total_input, allTime.total_output, PRICING.gpt4o);
    const costClaude = calcCost(allTime.total_input, allTime.total_output, PRICING.claude);
    const actualCost = 0; // Free models!

    const todayCostGpt4o = calcCost(todayUsage.total_input, todayUsage.total_output, PRICING.gpt4o);
    const todayCostClaude = calcCost(todayUsage.total_input, todayUsage.total_output, PRICING.claude);

    return NextResponse.json({
      totalInputTokens: allTime.total_input,
      totalOutputTokens: allTime.total_output,
      costGpt4o: Math.round(costGpt4o * 10000) / 10000,
      costClaude: Math.round(costClaude * 10000) / 10000,
      actualCost,
      totalSaved: Math.round(Math.max(costGpt4o, costClaude) * 10000) / 10000,
      todaySaved: Math.round(Math.max(todayCostGpt4o, todayCostClaude) * 10000) / 10000,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
