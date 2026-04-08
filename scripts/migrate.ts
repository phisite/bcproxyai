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

  // Tables to add (with correct schema)
  const migrations = [
    {
      name: "complaints",
      sql: `
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
      `,
      migrateOld: true,
      oldSchema: {
        model_id: "model_id",
        category: "",  // New column, no mapping
        reason: "",    // New column, no mapping
        user_message: "",  // New column, no mapping
        assistant_message: "",  // New column, no mapping
        source: "source",  // May exist in old schema
        status: "status",
        created_at: "created_at"
      }
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

  // Column additions for existing tables
  const columnAdditions = [
    {
      table: "benchmark_results",
      columns: [
        { name: "category", type: "TEXT" }
      ]
    },
    {
      table: "models",
      columns: [
        { name: "description", type: "TEXT" },
        { name: "supports_tools", type: "INTEGER DEFAULT -1" },
        { name: "supports_vision", type: "INTEGER DEFAULT -1" },
        { name: "nickname", type: "TEXT" }
      ]
    },
    {
      table: "health_logs",
      columns: [
        { name: "cooldown_until", type: "TEXT" }
      ]
    }
  ];

  for (const migration of migrations) {
    if (existingTables.has(migration.name)) {
      // Check if table needs migration (has old schema)
      const columns = db.prepare(`PRAGMA table_info(${migration.name})`).all() as { name: string }[];
      const existingColumns = new Set(columns.map(c => c.name));
      
      // Check if this table needs schema migration
      if (migration.migrateOld) {
        // Check if it has the wrong schema (has 'error_message' but not 'category')
        if (existingColumns.has('error_message') && !existingColumns.has('category')) {
          console.log(`⚠ ${migration.name} has old schema, migrating...`);
          
          // Rename old table
          db.exec(`ALTER TABLE ${migration.name} RENAME TO ${migration.name}_old`);
          
          // Create new table
          db.exec(migration.sql);
          
          // Copy data (map old columns to new)
          const oldColumns = db.prepare(`PRAGMA table_info(${migration.name}_old)`).all() as { name: string }[];
          const oldColsSet = new Set(oldColumns.map(c => c.name));
          
          // Build insert that copies compatible columns
          const compatibleCols = ['model_id', 'status', 'created_at'].filter(col => oldColsSet.has(col));
          if (compatibleCols.length > 0) {
            db.exec(`INSERT INTO ${migration.name} (${compatibleCols.join(',')}) SELECT ${compatibleCols.join(',')} FROM ${migration.name}_old`);
          }
          
          // Drop old table
          db.exec(`DROP TABLE ${migration.name}_old`);
          console.log(`✓ ${migration.name} migrated to new schema`);
          continue;
        }
      }
      
      console.log(`✓ ${migration.name} already exists, skipping`);
      continue;
    }
    
    console.log(`Adding ${migration.name}...`);
    db.exec(migration.sql);
    console.log(`✓ ${migration.name} added`);
  }

  // Add missing columns to existing tables
  console.log("\nChecking for missing columns...");
  for (const addition of columnAdditions) {
    if (!existingTables.has(addition.table)) {
      console.log(`  ${addition.table} table doesn't exist, skipping columns`);
      continue;
    }
    
    // Get existing columns for this table
    const columns = db.prepare(`PRAGMA table_info(${addition.table})`).all() as { name: string }[];
    const existingColumns = new Set(columns.map(c => c.name));
    
    for (const col of addition.columns) {
      if (existingColumns.has(col.name)) {
        console.log(`  ${addition.table}.${col.name} already exists, skipping`);
        continue;
      }
      
      console.log(`  Adding ${addition.table}.${col.name}...`);
      db.exec(`ALTER TABLE ${addition.table} ADD COLUMN ${col.name} ${col.type}`);
      console.log(`  ✓ ${addition.table}.${col.name} added`);
    }
  }

  const newTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  console.log("\nAll tables:", newTables.map(t => t.name).join(", "));
  console.log("\nMigration complete!");
  
  db.close();
}

migrate();
