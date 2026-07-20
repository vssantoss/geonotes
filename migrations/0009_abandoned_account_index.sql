-- Partial index for the abandoned-account sweep (purgeAbandonedAccounts). That
-- sweep looks for active accounts (deletion_requested_at IS NULL, so the partial
-- idx_users_deletion_requested does not apply) whose creation time predates the
-- abandonment cutoff. Indexing created_at over just the active rows lets the
-- sweep seek the aged candidates instead of scanning every user; the NOT EXISTS
-- checks against credentials, notes and sessions already ride their own
-- user-id indexes.
CREATE INDEX idx_users_active_created ON users(created_at)
  WHERE deletion_requested_at IS NULL;
