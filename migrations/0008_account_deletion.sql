-- Soft-delete marker for account deletion. NULL means an active account; a
-- timestamp records when deletion was requested and starts a 30-day grace
-- window, after which a background sweep permanently removes the account and all
-- its data. During the window the e-mail stays reserved (its user row lives on,
-- so the UNIQUE constraint keeps the address taken), and signing back in clears
-- this column, cancelling the deletion.
ALTER TABLE users ADD COLUMN deletion_requested_at INTEGER;

-- Partial index so the sweep and the child-table purges (which resolve the set
-- of doomed accounts through this column) stay cheap without indexing the many
-- NULL rows of active accounts.
CREATE INDEX idx_users_deletion_requested ON users(deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL;
