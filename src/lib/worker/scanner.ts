import { getDb } from "@/lib/db/schema";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";
const KILO_API_KEY = process.env.KILO_API_KEY ?? "";
const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY ?? "";
const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY ?? "";
const SAMBANOVA_API_KEY = process.env.SAMBANOVA_API_KEY ?? "";
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY ?? "";

interface ModelRow {
  id: string;
  name: string;
  provider: string;
  model_id: string;
  context_length: number;
  tier: string;
  description?: string;
}

export function calcTier(contextLength: number): string {
  if (contextLength >= 128000) return "large";
  if (contextLength >= 32000) return "medium";
  return "small";
}

function logWorker(step: string, message: string, level = "info") {
  try {
    const db = getDb();
    db.prepare(
      "INSERT INTO worker_logs (step, message, level) VALUES (?, ?, ?)"
    ).run(step, message, level);
  } catch {
    // silent
  }
}

async function fetchOpenRouterModels(): Promise<ModelRow[]> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models: ModelRow[] = [];
    for (const m of json.data ?? []) {
      if (m.pricing?.prompt !== "0") continue;
      const ctx = m.context_length ?? 0;
      models.push({
        id: `openrouter:${m.id}`,
        name: m.name ?? m.id,
        provider: "openrouter",
        model_id: m.id,
        context_length: ctx,
        tier: calcTier(ctx),
        description: m.description ?? undefined,
      });
    }
    return models;
  } catch (err) {
    logWorker("scan", `OpenRouter fetch error: ${err}`, "error");
    return [];
  }
}

async function fetchKiloModels(): Promise<ModelRow[]> {
  try {
    const headers: Record<string, string> = {};
    if (KILO_API_KEY) headers["Authorization"] = `Bearer ${KILO_API_KEY}`;
    const res = await fetch("https://api.kilo.ai/api/gateway/models", {
      headers,
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models: ModelRow[] = [];
    for (const m of json.data ?? json.models ?? []) {
      const mid: string = m.id ?? "";
      if (!mid.endsWith(":free")) continue;
      const ctx = m.context_length ?? 0;
      models.push({
        id: `kilo:${mid}`,
        name: m.name ?? mid,
        provider: "kilo",
        model_id: mid,
        context_length: ctx,
        tier: calcTier(ctx),
        description: m.description ?? undefined,
      });
    }
    return models;
  } catch (err) {
    logWorker("scan", `Kilo fetch error: ${err}`, "error");
    return [];
  }
}

async function fetchGoogleModels(): Promise<ModelRow[]> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${GOOGLE_AI_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models: ModelRow[] = [];
    for (const m of json.models ?? []) {
      const mid: string = (m.name ?? "").replace("models/", "");
      if (!mid) continue;
      // Only include generative models that support generateContent
      const methods: string[] = m.supportedGenerationMethods ?? [];
      if (!methods.includes("generateContent")) continue;
      const ctx = m.inputTokenLimit ?? 0;
      models.push({
        id: `google:${mid}`,
        name: m.displayName ?? mid,
        provider: "google",
        model_id: mid,
        context_length: ctx,
        tier: calcTier(ctx),
        description: m.description ?? undefined,
      });
    }
    return models;
  } catch (err) {
    logWorker("scan", `Google fetch error: ${err}`, "error");
    return [];
  }
}

async function fetchGroqModels(): Promise<ModelRow[]> {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models: ModelRow[] = [];
    for (const m of json.data ?? []) {
      const mid: string = m.id ?? "";
      const ctx = m.context_window ?? 0;
      models.push({
        id: `groq:${mid}`,
        name: m.id,
        provider: "groq",
        model_id: mid,
        context_length: ctx,
        tier: calcTier(ctx),
        description: undefined,
      });
    }
    return models;
  } catch (err) {
    logWorker("scan", `Groq fetch error: ${err}`, "error");
    return [];
  }
}

const NON_CHAT_KEYWORDS = ["whisper", "lyria", "orpheus", "prompt-guard", "safeguard", "compound", "allam"];

async function fetchCerebrasModels(): Promise<ModelRow[]> {
  if (!CEREBRAS_API_KEY) return [];
  try {
    const res = await fetch("https://api.cerebras.ai/v1/models", {
      headers: { Authorization: `Bearer ${CEREBRAS_API_KEY}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models: ModelRow[] = [];
    for (const m of json.data ?? []) {
      const mid: string = m.id ?? "";
      // Skip non-chat models (whisper, etc.)
      if (NON_CHAT_KEYWORDS.some((kw) => mid.toLowerCase().includes(kw))) continue;
      const ctx = m.context_window ?? m.context_length ?? m.max_context_length ?? 0;
      models.push({
        id: `cerebras:${mid}`,
        name: m.id,
        provider: "cerebras",
        model_id: mid,
        context_length: ctx,
        tier: calcTier(ctx),
        description: undefined,
      });
    }
    return models;
  } catch (err) {
    logWorker("scan", `Cerebras fetch error: ${err}`, "error");
    return [];
  }
}

async function fetchSambaNovaModels(): Promise<ModelRow[]> {
  if (!SAMBANOVA_API_KEY) return [];
  try {
    const res = await fetch("https://api.sambanova.ai/v1/models", {
      headers: { Authorization: `Bearer ${SAMBANOVA_API_KEY}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models: ModelRow[] = [];
    for (const m of json.data ?? []) {
      const mid: string = m.id ?? "";
      const ctx = m.context_window ?? m.context_length ?? m.max_context_length ?? m.max_tokens ?? 0;
      models.push({
        id: `sambanova:${mid}`,
        name: m.id,
        provider: "sambanova",
        model_id: mid,
        context_length: ctx,
        tier: calcTier(ctx),
        description: undefined,
      });
    }
    return models;
  } catch (err) {
    logWorker("scan", `SambaNova fetch error: ${err}`, "error");
    return [];
  }
}

async function fetchMistralModels(): Promise<ModelRow[]> {
  if (!MISTRAL_API_KEY) return [];
  try {
    const res = await fetch("https://api.mistral.ai/v1/models", {
      headers: { Authorization: `Bearer ${MISTRAL_API_KEY}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models: ModelRow[] = [];
    for (const m of json.data ?? []) {
      const mid: string = m.id ?? "";
      const ctx = m.max_context_length ?? m.context_window ?? m.context_length ?? 0;
      models.push({
        id: `mistral:${mid}`,
        name: m.id,
        provider: "mistral",
        model_id: mid,
        context_length: ctx,
        tier: calcTier(ctx),
        description: undefined,
      });
    }
    return models;
  } catch (err) {
    logWorker("scan", `Mistral fetch error: ${err}`, "error");
    return [];
  }
}

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? "";

export async function generateNickname(modelName: string, provider: string, existingNames: string[], scoreInfo = ""): Promise<string | null> {
  if (!DEEPSEEK_API_KEY) return null;
  try {
    const avoid = existingNames.length > 0 ? `\nห้ามใช้ชื่อเหล่านี้: ${existingNames.slice(-30).join(", ")}` : "";
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{
          role: "user",
          content: `ตั้งชื่อเล่นภาษาไทยตลกๆ น่ารัก ให้ AI model ชื่อ "${modelName}" จาก ${provider}${scoreInfo} ตอบแค่ชื่อเดียว สั้นๆ 2-4 คำ ห้ามใส่เครื่องหมายคำพูด ห้ามอธิบาย${avoid}`,
        }],
        max_tokens: 30,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const name = (json.choices?.[0]?.message?.content ?? "")
      .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
      .replace(/["'`]/g, "")
      .trim()
      .split("\n")[0]
      .slice(0, 30);
    return name || null;
  } catch {
    return null;
  }
}

export async function scanModels(): Promise<{ found: number; new: number; disappeared: number }> {
  logWorker("scan", "Starting model scan");
  const db = getDb();

  const [orModels, kiloModels, googleModels, groqModels, cerebrasModels, sambaNovaModels, mistralModels] = await Promise.all([
    fetchOpenRouterModels(),
    fetchKiloModels(),
    fetchGoogleModels(),
    fetchGroqModels(),
    fetchCerebrasModels(),
    fetchSambaNovaModels(),
    fetchMistralModels(),
  ]);

  const allModels = [...orModels, ...kiloModels, ...googleModels, ...groqModels, ...cerebrasModels, ...sambaNovaModels, ...mistralModels];
  const foundIds = new Set(allModels.map(m => m.id));
  let newCount = 0;

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO models (id, name, provider, model_id, context_length, tier, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStmt = db.prepare(`
    UPDATE models SET last_seen = datetime('now'), context_length = ?, tier = ?
    WHERE id = ?
  `);

  const newModels: ModelRow[] = [];

  const upsertMany = db.transaction((models: ModelRow[]) => {
    for (const m of models) {
      const result = insertStmt.run(
        m.id, m.name, m.provider, m.model_id, m.context_length, m.tier, m.description ?? null
      );
      if (result.changes > 0) {
        newCount++;
        newModels.push(m);
        logWorker("scan", `🆕 โมเดลใหม่: ${m.name} (${m.provider}) — ${calcTier(m.context_length).toUpperCase()} ${m.context_length >= 1000 ? Math.round(m.context_length/1000)+"K" : m.context_length} ctx`, "success");
      } else {
        updateStmt.run(m.context_length, m.tier, m.id);
      }
    }
  });

  try {
    upsertMany(allModels);
  } catch (err) {
    logWorker("scan", `DB upsert error: ${err}`, "error");
  }

  // ให้ DeepSeek ตั้งชื่อเล่นให้โมเดลที่ยังไม่มี nickname (max 10 ต่อรอบ ประหยัด token)
  if (DEEPSEEK_API_KEY) {
    const unnamed = db.prepare(
      "SELECT id, name, provider FROM models WHERE nickname IS NULL AND context_length >= 32000 LIMIT 10"
    ).all() as { id: string; name: string; provider: string }[];

    if (unnamed.length > 0) {
      const updateNickname = db.prepare("UPDATE models SET nickname = ? WHERE id = ?");
      const existingNicknames = (db.prepare("SELECT nickname FROM models WHERE nickname IS NOT NULL").all() as { nickname: string }[]).map(r => r.nickname);

      for (const m of unnamed) {
        const nickname = await generateNickname(m.name, m.provider, existingNicknames);
        if (nickname && !existingNicknames.includes(nickname)) {
          try {
            updateNickname.run(nickname, m.id);
            existingNicknames.push(nickname);
            logWorker("scan", `🎭 ตั้งชื่อ: ${m.name} → "${nickname}"`, "success");
          } catch { /* silent */ }
        }
      }
    }
  }

  // ตรวจจับ model ที่หายไป — ไม่เจอใน scan นี้ แต่เคย last_seen ภายใน 24 ชม.
  // ถ้า last_seen เกิน 48 ชม. = หายไปถาวร
  let disappearedCount = 0;
  try {
    const recentModels = db.prepare(`
      SELECT id, name, provider, last_seen FROM models
      WHERE last_seen < datetime('now', '-1 hour')
    `).all() as Array<{ id: string; name: string; provider: string; last_seen: string }>;

    for (const m of recentModels) {
      if (foundIds.has(m.id)) continue; // ยังอยู่

      const lastSeen = new Date(m.last_seen + "Z");
      const hoursAgo = (Date.now() - lastSeen.getTime()) / (1000 * 60 * 60);

      if (hoursAgo >= 48) {
        // หายไปถาวร (>48 ชม.)
        logWorker("scan", `💀 หายถาวร: ${m.name} (${m.provider}) — ไม่เจอมา ${Math.round(hoursAgo)} ชม.`, "error");
        disappearedCount++;
      } else if (hoursAgo >= 2) {
        // หายไปชั่วคราว (2-48 ชม.)
        logWorker("scan", `⚠️ หายชั่วคราว: ${m.name} (${m.provider}) — ไม่เจอมา ${Math.round(hoursAgo)} ชม.`, "warn");
      }
    }
  } catch { /* silent */ }

  const msg = `Scan: พบ ${allModels.length} (OR=${orModels.length}, Kilo=${kiloModels.length}, Google=${googleModels.length}, Groq=${groqModels.length}, Cerebras=${cerebrasModels.length}, SambaNova=${sambaNovaModels.length}, Mistral=${mistralModels.length}) | ใหม่ ${newCount} | หายไป ${disappearedCount}`;
  logWorker("scan", msg);

  return { found: allModels.length, new: newCount, disappeared: disappearedCount };
}
