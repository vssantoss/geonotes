-- Distinguishes an explicitly revoked session ("sign out other devices" or
-- revoking one session from the settings list) from one that merely expired.
-- Revoking now stamps revoked_at and keeps the row as a tombstone until its
-- original expiry, instead of deleting it. On the revoked device's next
-- request, requireUser sees the tombstone and answers with a distinct
-- session_revoked reason so the client wipes its local data, whereas a natural
-- 401 only re-prompts sign-in. Tombstones are swept at login once past expiry.
ALTER TABLE sessions ADD COLUMN revoked_at INTEGER;
