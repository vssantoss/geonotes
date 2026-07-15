-- Persistent per-address limits for e-mail authentication code requests.
CREATE TABLE email_code_rate_limits (
  email TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  requests INTEGER NOT NULL
);
