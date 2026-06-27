const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Helper: single row or undefined
async function get(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows[0];
}

// Helper: all rows
async function all(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}

// Helper: insert/update/delete — returns { lastInsertId, rowCount }
async function run(sql, params = []) {
  const res = await pool.query(sql, params);
  return { lastInsertId: res.rows[0]?.id ?? null, rowCount: res.rowCount };
}

// Helper: raw exec (schema setup etc.)
async function exec(sql) {
  await pool.query(sql);
}

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id            SERIAL PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name  TEXT,
      role          TEXT NOT NULL DEFAULT 'analyst' CHECK (role IN ('admin','analyst','viewer')),
      permissions   JSONB NOT NULL DEFAULT '[]'::jsonb,
      last_login    TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      created_by    TEXT
    );
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'::jsonb;

    CREATE TABLE IF NOT EXISTS roblox_entities (
      id           SERIAL PRIMARY KEY,
      roblox_id    TEXT UNIQUE NOT NULL,
      username     TEXT NOT NULL,
      display_name TEXT,
      avatar_url   TEXT,
      profile_data JSONB,
      last_fetched TIMESTAMPTZ,
      added_by     TEXT NOT NULL,
      added_at     TIMESTAMPTZ DEFAULT NOW(),
      severity     TEXT NOT NULL DEFAULT 'LOW'
                   CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
      status       TEXT NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE','INACTIVE','ARCHIVED','BANNED')),
      category     TEXT NOT NULL DEFAULT 'UNCATEGORISED',
      notes        TEXT
    );

    CREATE TABLE IF NOT EXISTS entity_tags (
      id         SERIAL PRIMARY KEY,
      entity_id  INTEGER NOT NULL REFERENCES roblox_entities(id) ON DELETE CASCADE,
      tag        TEXT NOT NULL,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id          SERIAL PRIMARY KEY,
      action      TEXT NOT NULL,
      actor       TEXT NOT NULL,
      target      TEXT,
      target_type TEXT,
      details     TEXT,
      ip_address  TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS "session" (
      "sid"    VARCHAR NOT NULL COLLATE "default",
      "sess"   JSON NOT NULL,
      "expire" TIMESTAMP(6) NOT NULL,
      PRIMARY KEY ("sid")
    );

    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
  `);
}

module.exports = { pool, get, all, run, exec, initSchema };
