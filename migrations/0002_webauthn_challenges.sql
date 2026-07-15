-- Server-side WebAuthn ceremony challenges.
--
-- Challenges were previously stateless HMAC tokens round-tripped through the
-- client, which made a captured (challenge token, passkey response) pair
-- replayable until it expired. Storing each challenge here and deleting it on
-- the first verification attempt makes every challenge single-use.
CREATE TABLE webauthn_challenges (
  -- Random, unguessable ceremony id handed to the client as the challenge
  -- token. Consuming a challenge deletes its row by this id.
  id TEXT PRIMARY KEY,
  -- The base64url challenge issued to the authenticator.
  challenge TEXT NOT NULL,
  -- Who the ceremony is for: a user id, or the usernameless-login constant.
  subject TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_webauthn_challenges_expires ON webauthn_challenges(expires_at);
