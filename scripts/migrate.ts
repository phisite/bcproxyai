/**
 * Database migration script
 * Run: npx tsx scripts/migrate.ts
 * 
 * Handles schema mismatches between existing database and code expectations.
 * Some tables need rebuild (schema changes too complex for ALTER).
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "bcproxyai.db");

function migrate() {
  if (!fs.existsSync(DB_PATH)) {
    console.log(`Database not found at ${DB_PATH} - will be created on first run.`);
    console.log("Run migration manually after first run: npx tsx scripts/migrate.ts");
    return;
  }

  const db = new Database(DB_PATH);
  
  // Get existing tables
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  const existingTables = new Set(tables.map(t => t.name));
  
  console.log("Existing tables:", Array.from(existingTables).join(", "));

  // ========================================
  // TABLE REBUILDS (schema changes too big for ALTER)
  // ========================================

  // 1. complaint_exams - completely different structure
  // Code expects: question, answer, score, max_score, reasoning, latency_ms, passed, tested_at
  // DB has: provider, exam_prompt, exam_response, score
  if (existingTables.has("complaint_exams")) {
    const cols = db.prepare("PRAGMA table_info(complaint_exams)").all() as { name: string }[];
    const colSet = new Set(cols.map(c => c.name));
    
    if (!colSet.has("question") && colSet.has("exam_prompt")) {
      console.log("⚠ Rebuilding complaint_exams table...");
      
      // Create temp copy with new schema
      db.exec(`
        CREATE TABLE complaint_exams_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          complaint_id INTEGER NOT NULL,
          model_id TEXT NOT NULL,
          question TEXT NOT NULL,
          answer TEXT,
          score REAL DEFAULT 0,
          max_score REAL DEFAULT 10,
          reasoning TEXT,
          latency_ms INTEGER DEFAULT 0,
          passed INTEGER DEFAULT 0,
          tested_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (complaint_id) REFERENCES complaints(id),
          FOREIGN KEY (model_id) REFERENCES models(id)
        );
      `);
      
      // Migrate data (map old columns to new)
      db.exec(`
        INSERT INTO complaint_exams_new (complaint_id, model_id, question, answer, score, tested_at)
        SELECT complaint_id, model_id, exam_prompt, exam_response, score, COALESCE(created_at, datetime('now'))
        FROM complaint_exams
      `);
      
      db.exec("DROP TABLE complaint_exams");
      db.exec("ALTER TABLE complaint_exams_new RENAME TO complaint_exams");
      console.log("✓ complaint_exams rebuilt");
    } else if (colSet.has("question")) {
      console.log("✓ complaint_exams already has new schema");
    }
  }

  // 2. routing_stats - code uses different columns (prompt_category, success, latency_ms)
  // DB has: request_count, success_count, error_count, avg_latency_ms, etc.
  if (existingTables.has("routing_stats")) {
    const cols = db.prepare("PRAGMA table_info(routing_stats)").all() as { name: string }[];
    const colSet = new Set(cols.map(c => c.name));
    
    if (!colSet.has("prompt_category") && colSet.has("request_count")) {
      console.log("⚠ Rebuilding routing_stats table...");
      
      db.exec(`
        CREATE TABLE routing_stats_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          model_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          prompt_category TEXT NOT NULL DEFAULT 'general',
          success INTEGER DEFAULT 1,
          latency_ms INTEGER DEFAULT 0,
          complaint_after INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (model_id) REFERENCES models(id)
        );
        CREATE INDEX IF NOT EXISTS idx_routing_stats_cat ON routing_stats_new(prompt_category, provider);
        CREATE INDEX IF NOT EXISTS idx_routing_stats_model ON routing_stats_new(model_id);
      `);
      
      // Migrate data: map old success_count/request_count ratio to success
      db.exec(`
        INSERT INTO routing_stats_new (model_id, provider, prompt_category, success, latency_ms, complaint_after, created_at)
        SELECT 
          model_id, 
          provider, 
          'general',
          CASE WHEN request_count > 0 THEN CAST(success_count AS REAL) / request_count ELSE 1 END,
          COALESCE(avg_latency_ms, 0),
          complaint_after,
          COALESCE(created_at, datetime('now'))
        FROM routing_stats
      `);
      
      db.exec("DROP TABLE routing_stats");
      db.exec("ALTER TABLE routing_stats_new RENAME TO routing_stats");
      console.log("✓ routing_stats rebuilt");
    } else if (colSet.has("prompt_category")) {
      console.log("✓ routing_stats already has new schema");
    }
  }

  // 3. events - code uses type, title, detail, severity (not event_type, message)
  if (existingTables.has("events")) {
    const cols = db.prepare("PRAGMA table_info(events)").all() as { name: string }[];
    const colSet = new Set(cols.map(c => c.name));
    
    if (!colSet.has("title") && colSet.has("event_type")) {
      console.log("⚠ Rebuilding events table...");
      
      db.exec(`
        CREATE TABLE events_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          detail TEXT,
          provider TEXT,
          model_id TEXT,
          severity TEXT DEFAULT 'info',
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_events_created ON events_new(created_at);
      `);
      
      // Migrate data: map event_type -> type, message -> detail
      db.exec(`
        INSERT INTO events_new (type, title, detail, provider, model_id, severity, created_at)
        SELECT 
          COALESCE(event_type, 'unknown'),
          COALESCE(event_type, 'Event'),
          message,
          provider,
          model_id,
          'info',
          COALESCE(created_at, datetime('now'))
        FROM events
      `);
      
      db.exec("DROP TABLE events");
      db.exec("ALTER TABLE events_new RENAME TO events");
      console.log("✓ events rebuilt");
    } else if (colSet.has("title")) {
      console.log("✓ events already has new schema");
    }
  }

  // 4. api_keys - code expects (provider PK, api_key, updated_at)
  if (existingTables.has("api_keys")) {
    const cols = db.prepare("PRAGMA table_info(api_keys)").all() as { name: string }[];
    const colSet = new Set(cols.map(c => c.name));
    
    if (colSet.has("key_name")) {
      console.log("⚠ Rebuilding api_keys table...");
      
      db.exec(`
        CREATE TABLE api_keys_new (
          provider TEXT PRIMARY KEY,
          api_key TEXT NOT NULL,
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `);
      
      // Migrate data: keep latest key per provider
      db.exec(`
        INSERT INTO api_keys_new (provider, api_key, updated_at)
        SELECT provider, key_value, COALESCE(created_at, datetime('now'))
        FROM api_keys
        WHERE rowid IN (
          SELECT MAX(rowid) FROM api_keys GROUP BY provider
        )
      `);
      
      db.exec("DROP TABLE api_keys");
      db.exec("ALTER TABLE api_keys_new RENAME TO api_keys");
      console.log("✓ api_keys rebuilt");
    } else if (colSet.has("provider") && colSet.has("api_key")) {
      console.log("✓ api_keys already has new schema");
    }
  }

  // ========================================
  // COLUMN ADDITIONS (simple ALTER TABLE ADD COLUMN)
  // ========================================

  console.log("\n--- Adding missing columns ---");

  // 1. models - add capability columns
  if (existingTables.has("models")) {
    const cols = db.prepare("PRAGMA table_info(models)").all() as { name: string }[];
    const colSet = new Set(cols.map(c => c.name));
    
    const modelCaps: [string, string][] = [
      ["supports_audio_input", "INTEGER DEFAULT 0"],
      ["supports_audio_output", "INTEGER DEFAULT 0"],
      ["supports_image_gen", "INTEGER DEFAULT 0"],
      ["supports_embedding", "INTEGER DEFAULT 0"],
      ["supports_json_mode", "INTEGER DEFAULT 0"],
      ["supports_reasoning", "INTEGER DEFAULT 0"],
      ["supports_code", "INTEGER DEFAULT 0"],
      ["max_output_tokens", "INTEGER DEFAULT 0"],
      ["pricing_input", "REAL DEFAULT 0"],
      ["pricing_output", "REAL DEFAULT 0"],
    ];
    
    for (const [col, def] of modelCaps) {
      if (!colSet.has(col)) {
        console.log(`  Adding models.${col}...`);
        db.exec(`ALTER TABLE models ADD COLUMN ${col} ${def}`);
      } else {
        console.log(`  ✓ models.${col} exists`);
      }
    }
  }

  // ========================================
  // NEW TABLES (from original migration)
  // ========================================

  console.log("\n--- Creating new tables ---");

  // complaints - only if not exists
  if (!existingTables.has("complaints")) {
    console.log("Adding complaints table...");
    db.exec(`
      CREATE TABLE IF NOT EXISTS complaints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model_id TEXT NOT NULL,
        category TEXT NOT NULL,
        reason TEXT,
        user_message TEXT,
        assistant_message TEXT,
        source TEXT DEFAULT 'api',
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (model_id) REFERENCES models(id)
      );
      CREATE INDEX IF NOT EXISTS idx_complaints_model ON complaints(model_id);
      CREATE INDEX IF NOT EXISTS idx_complaints_created ON complaints(created_at);
      CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
    `);
    console.log("✓ complaints added");
  } else {
    console.log("✓ complaints already exists");
  }

  // ========================================
  // FINAL VERIFICATION
  // ========================================

  const finalTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  console.log("\n=== All tables after migration ===");
  console.log(finalTables.map(t => t.name).join(", "));

  // Show key table column counts
  const keyTables = ["models", "complaints", "complaint_exams", "routing_stats", "events", "api_keys"];
  for (const tableName of keyTables) {
    if (existingTables.has(tableName)) {
      const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
      console.log(`  ${tableName}: ${cols.length} columns`);
    }
  }

  console.log("\n✓ Migration complete!");
  db.close();
}

migrate();