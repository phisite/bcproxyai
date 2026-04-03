// API Key Rotation — round-robin + cooldown on 429
const keyIndexMap = new Map<string, number>();
const cooldownMap = new Map<string, number>(); // "provider:key" -> cooldown until timestamp

const ENV_MAP: Record<string, string> = {
  openrouter: "OPENROUTER_API_KEY",
  kilo: "KILO_API_KEY",
  google: "GOOGLE_AI_API_KEY",
  groq: "GROQ_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  sambanova: "SAMBANOVA_API_KEY",
  mistral: "MISTRAL_API_KEY",
};

export function getNextApiKey(provider: string): string {
  const envVar = ENV_MAP[provider];
  if (!envVar) return "";

  const raw = process.env[envVar] ?? "";
  const keys = raw.split(",").map((k) => k.trim()).filter(Boolean);
  if (keys.length === 0) return "";

  // Filter out cooled-down keys
  const now = Date.now();
  const available = keys.filter((k) => {
    const cd = cooldownMap.get(`${provider}:${k}`);
    return !cd || cd < now;
  });

  // Fallback to all keys if every key is in cooldown
  const pool = available.length > 0 ? available : keys;
  const idx = (keyIndexMap.get(provider) ?? 0) % pool.length;
  keyIndexMap.set(provider, idx + 1);

  return pool[idx];
}

export function markKeyCooldown(provider: string, key: string, durationMs = 300000) {
  cooldownMap.set(`${provider}:${key}`, Date.now() + durationMs);
}

/**
 * Get all keys for a provider as a record (for health/benchmark that read at module level).
 * Returns the first available key per provider.
 */
export function getApiKeysRecord(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const provider of Object.keys(ENV_MAP)) {
    result[provider] = getNextApiKey(provider);
  }
  return result;
}
