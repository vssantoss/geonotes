-- Indexes for opportunistic TTL eviction (pruneExpiredEmailCodes). Without
-- these, DELETE ... WHERE expires_at < ? / window_started_at < ? would scan the
-- whole table on every prune, reading every row; the index lets the delete
-- touch only the stale rows it removes.
CREATE INDEX idx_email_codes_expires ON email_codes(expires_at);
CREATE INDEX idx_email_code_rate_limits_window ON email_code_rate_limits(window_started_at);
