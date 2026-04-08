/**
 * Database migration script
 * Run: npx tsx scripts/migrate.ts
 * 
 * Adds tables that were added in recent updates but not created for existing databases:
 * - complaints
 * - complaint_exams
 * - routing_stats
 * - events
 * - api_keys
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "bcproxyai.db");

function migrate() {
  if (!fs.existsSync(DB_PATH)) {
    console.log(`Database not found at ${DB_PATH} - will be created on first run.`);
    console.log("Run migration manually after first run: npx tsx scripts/migrate.ts");
    return; // Don't exit with error - DB will be created automatically
  }

  const db = new Database(DB_PATH);
  
  // Get existing tables
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  const existingTables = new Set(tables.map(t => t.name));
  
  console.log("Existing tables:", Array.from(existingTables).join(", "));

  // Tables to add
  const migrations = [
    {
      name: "complaints",
      sql: `
        CREATE TABLE IF NOT EXISTS complaints (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          model_id TEXT NOT NULL,
          provider TEXT,
          error_code TEXT,
          error_message TEXT,
          severity TEXT DEFAULT 'low',
          status TEXT DEFAULT 'pending',
          created_at TEXT DEFAULT (datetime('now')),
          resolved_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_complaints_model ON complaints(model_id);
        CREATE INDEX IF NOT EXISTS idx_complaints_created ON complaints(created_at);
        CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
      `
    },
    {
      name: "complaint_exams",
      sql: `
        CREATE TABLE IF NOT EXISTS complaint_exams (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          complaint_id INTEGER NOT NULL,
          model_id TEXT NOT NULL,
          provider TEXT,
          exam_prompt TEXT,
          exam_response TEXT,
          score INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (complaint_id) REFERENCES complaints(id)
        );
      `
    },
    {
      name: "routing_stats",
      sql: `
        CREATE TABLE IF NOT EXISTS routing_stats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL,
          model_id TEXT NOT NULL,
          request_count INTEGER DEFAULT 0,
          success_count INTEGER DEFAULT 0,
          error_count INTEGER DEFAULT 0,
          avg_latency_ms REAL DEFAULT 0,
          total_input_tokens INTEGER DEFAULT 0,
          total_output_tokens INTEGER DEFAULT 0,
          complaint_count INTEGER DEFAULT 0,
          complaint_after INTEGER DEFAULT 0,
          period TEXT DEFAULT 'daily',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `
    },
    {
      name: "events",
      sql: `
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          provider TEXT,
          model_id TEXT,
          message TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `
    },
    {
      name: "api_keys",
      sql: `
        CREATE TABLE IF NOT EXISTS api_keys (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL,
          key_name TEXT NOT NULL,
          key_value TEXT NOT NULL,
          priority INTEGER DEFAULT 1,
          cooldown_until TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(provider, key_name)
        );
      `
    }
  ];

  for (const migration of migrations) {
    if (existingTables.has(migration.name)) {
      console.log(`✓ ${migration.name} already exists, skipping`);
      continue;
    }
    
    console.log(`Adding ${migration.name}...`);
    db.exec(migration.sql);
    console.log(`✓ ${migration.name} added`);
  }

  const newTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  console.log("\nAll tables:", newTables.map(t => t.name).join(", "));
  console.log("\nMigration complete!");
  
  db.close();
}

migrate();
