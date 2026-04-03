import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "bcproxyai.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const fs = require("fs");
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    -- รายการ model ทั้งหมดที่เคยพบ
    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      context_length INTEGER DEFAULT 0,
      tier TEXT DEFAULT 'small',
      description TEXT,
      supports_tools INTEGER DEFAULT -1,
      supports_vision INTEGER DEFAULT -1,
      nickname TEXT,
      first_seen TEXT DEFAULT (datetime('now')),
      last_seen TEXT DEFAULT (datetime('now'))
    );

    -- ประวัติ health check + cooldown
    CREATE TABLE IF NOT EXISTS health_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id TEXT NOT NULL,
      status TEXT NOT NULL,
      latency_ms INTEGER DEFAULT 0,
      error TEXT,
      checked_at TEXT DEFAULT (datetime('now')),
      cooldown_until TEXT,
      FOREIGN KEY (model_id) REFERENCES models(id)
    );

    -- ผล benchmark แต่ละข้อ
    CREATE TABLE IF NOT EXISTS benchmark_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT,
      score REAL DEFAULT 0,
      max_score REAL DEFAULT 10,
      reasoning TEXT,
      latency_ms INTEGER DEFAULT 0,
      tested_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (model_id) REFERENCES models(id)
    );

    -- log การทำงานของ worker
    CREATE TABLE IF NOT EXISTS worker_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      step TEXT NOT NULL,
      message TEXT NOT NULL,
      level TEXT DEFAULT 'info',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- สถานะ worker
    CREATE TABLE IF NOT EXISTS worker_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_health_model ON health_logs(model_id);
    CREATE INDEX IF NOT EXISTS idx_health_checked ON health_logs(checked_at);
    CREATE INDEX IF NOT EXISTS idx_benchmark_model ON benchmark_results(model_id);
    CREATE INDEX IF NOT EXISTS idx_worker_logs_created ON worker_logs(created_at);

    -- log gateway request/response
    CREATE TABLE IF NOT EXISTS gateway_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_model TEXT NOT NULL,
      resolved_model TEXT,
      provider TEXT,
      status INTEGER DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      error TEXT,
      user_message TEXT,
      assistant_message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_gateway_logs_created ON gateway_logs(created_at);

    -- Budget config (daily token limit etc.)
    CREATE TABLE IF NOT EXISTS budget_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Token usage tracking per request
    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      estimated_cost_usd REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_token_usage_date ON token_usage(created_at);
  `);
}
