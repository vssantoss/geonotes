-- GeoNotes initial schema.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- WebAuthn passkey credentials, one row per registered authenticator.
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_credentials_user ON credentials(user_id);

-- Short-lived e-mail sign-in codes. Only the hash of the code is stored.
CREATE TABLE email_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

-- Bearer session tokens. Only the hash of the token is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Location notes. Ids are client-generated UUIDs so notes can be created
-- offline. lat/lng are immutable after creation (enforced by the API).
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (length(text) <= 512),
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  address TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- Server-stamped write time. Delta pulls filter on this instead of the
  -- client-provided updated_at so client clock skew cannot hide changes.
  synced_at INTEGER NOT NULL
);
CREATE INDEX idx_notes_user_synced ON notes(user_id, synced_at);

-- Compact deletion log so other devices' delta pulls learn about hard
-- deletes. Holds ids only (no note content), pruned after 30 days.
CREATE TABLE deleted_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL
);
CREATE INDEX idx_deleted_notes_user_deleted ON deleted_notes(user_id, deleted_at);
