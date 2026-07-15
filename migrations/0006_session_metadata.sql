-- Session metadata for the settings "active sessions" list: a public id used to
-- revoke a specific session, when it was created and last used, and the raw
-- user agent for a friendly device label. Sessions created before this
-- migration have NULL columns: they cannot be listed or revoked individually
-- (they expire within the 7-day session TTL) but are still cleared by
-- "sign out all other sessions".
ALTER TABLE sessions ADD COLUMN id TEXT;
ALTER TABLE sessions ADD COLUMN created_at INTEGER;
ALTER TABLE sessions ADD COLUMN last_seen INTEGER;
ALTER TABLE sessions ADD COLUMN user_agent TEXT;
CREATE INDEX idx_sessions_id ON sessions(id);
