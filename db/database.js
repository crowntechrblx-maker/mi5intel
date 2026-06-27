const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function get(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows[0];
}

async function all(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}

async function run(sql, params = []) {
  const res = await pool.query(sql, params);
  return { lastInsertId: res.rows[0]?.id ?? null, rowCount: res.rowCount };
}

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
      role          TEXT NOT NULL DEFAULT 'analyst',
      permissions   JSONB NOT NULL DEFAULT '[]'::jsonb,
      last_login    TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      created_by    TEXT
    );
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS suspended BOOLEAN NOT NULL DEFAULT FALSE;

    CREATE TABLE IF NOT EXISTS entity_aliases (
      id         SERIAL PRIMARY KEY,
      entity_id  INTEGER NOT NULL REFERENCES roblox_entities(id) ON DELETE CASCADE,
      old_username TEXT NOT NULL,
      new_username TEXT NOT NULL,
      detected_at  TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_aliases_entity_id ON entity_aliases (entity_id);

    CREATE TABLE IF NOT EXISTS group_events (
      id         SERIAL PRIMARY KEY,
      entity_id  INTEGER NOT NULL REFERENCES roblox_entities(id) ON DELETE CASCADE,
      group_id   TEXT NOT NULL,
      group_name TEXT,
      event_type TEXT NOT NULL CHECK (event_type IN ('JOINED','LEFT')),
      detected_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_group_events_entity ON group_events (entity_id);
    CREATE INDEX IF NOT EXISTS idx_group_events_group  ON group_events (group_id);

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

    CREATE TABLE IF NOT EXISTS entity_notes (
      id         SERIAL PRIMARY KEY,
      entity_id  INTEGER NOT NULL REFERENCES roblox_entities(id) ON DELETE CASCADE,
      author     TEXT NOT NULL,
      note       TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS entity_snapshots (
      id         SERIAL PRIMARY KEY,
      entity_id  INTEGER NOT NULL REFERENCES roblox_entities(id) ON DELETE CASCADE,
      fetched_by TEXT NOT NULL,
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      diff       JSONB,
      snapshot   JSONB NOT NULL
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

    CREATE TABLE IF NOT EXISTS entity_links (
      id               SERIAL PRIMARY KEY,
      entity_id        INTEGER NOT NULL REFERENCES roblox_entities(id) ON DELETE CASCADE,
      linked_entity_id INTEGER NOT NULL REFERENCES roblox_entities(id) ON DELETE CASCADE,
      link_type        TEXT NOT NULL DEFAULT 'ASSOCIATE'
                       CHECK (link_type IN ('ALT_ACCOUNT','SUSPECTED_ALT','ASSOCIATE','KNOWN_CONTACT','HANDLER')),
      notes            TEXT,
      created_by       TEXT NOT NULL,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(entity_id, linked_entity_id)
    );

    CREATE TABLE IF NOT EXISTS groups_of_interest (
      id           SERIAL PRIMARY KEY,
      group_id     TEXT UNIQUE NOT NULL,
      group_name   TEXT NOT NULL,
      description  TEXT,
      member_count INTEGER,
      icon_url     TEXT,
      group_data   JSONB,
      added_by     TEXT NOT NULL,
      added_at     TIMESTAMPTZ DEFAULT NOW(),
      last_fetched TIMESTAMPTZ
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS "IDX_session_expire"       ON "session"         ("expire");
    CREATE INDEX IF NOT EXISTS idx_entities_profile_gin   ON roblox_entities   USING GIN (profile_data);
    CREATE INDEX IF NOT EXISTS idx_entities_severity      ON roblox_entities   (severity);
    CREATE INDEX IF NOT EXISTS idx_entities_status        ON roblox_entities   (status);
    CREATE INDEX IF NOT EXISTS idx_entities_added_at      ON roblox_entities   (added_at DESC);
    CREATE INDEX IF NOT EXISTS idx_entities_username      ON roblox_entities   (username);
    CREATE INDEX IF NOT EXISTS idx_audit_created_at       ON audit_logs        (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_actor            ON audit_logs        (actor);
    CREATE INDEX IF NOT EXISTS idx_audit_action           ON audit_logs        (action);
    CREATE INDEX IF NOT EXISTS idx_audit_target           ON audit_logs        (target);
    CREATE INDEX IF NOT EXISTS idx_tags_entity_id         ON entity_tags       (entity_id);
    CREATE INDEX IF NOT EXISTS idx_notes_entity_id        ON entity_notes      (entity_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_entity_id    ON entity_snapshots  (entity_id, fetched_at DESC);
  `);
}

module.exports = { pool, get, all, run, exec, initSchema };
