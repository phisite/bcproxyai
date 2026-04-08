import { createHash } from "crypto";
import { getRedis } from "./redis";

const CACHE_TTL_SEC = 300; // 5 minutes

function cacheKey(body: Record<string, unknown>): string {
  const messages = body.messages;
  const model = body.model ?? "auto";
  const temperature = body.temperature ?? 0;
  const tools = body.tools ?? null;
  const payload = JSON.stringify({ model, messages, temperature, tools });
  const hash = createHash("sha256").update(payload).digest("hex").slice(0, 32);
  return `respcache:${hash}`;
}

export async function getCachedResponse(
  body: Record<string, unknown>,
): Promise<{ content: string; provider: string; model: string } | null> {
  // Don't cache streaming or high-randomness requests, or tool requests
  if (body.stream === true) return null;
  const temp = typeof body.temperature === "number" ? body.temperature : 0;
  if (temp > 0.3) return null;
  if (Array.isArray(body.tools) && (body.tools as unknown[]).length > 0) return null;
  try {
    const redis = getRedis();
    const raw = await redis.get(cacheKey(body));
    if (!raw) return null;
    return JSON.parse(raw) as { content: string; provider: string; model: string };
  } catch {
    return null;
  }
}

export async function setCachedResponse(
  body: Record<string, unknown>,
  response: { content: string; provider: string; model: string },
): Promise<void> {
  if (body.stream === true) return;
  const temp = typeof body.temperature === "number" ? body.temperature : 0;
  if (temp > 0.3) return;
  if (Array.isArray(body.tools) && (body.tools as unknown[]).length > 0) return;
  try {
    const redis = getRedis();
    await redis.set(cacheKey(body), JSON.stringify(response), "EX", CACHE_TTL_SEC);
  } catch {
    // silent — cache is optional
  }
}
