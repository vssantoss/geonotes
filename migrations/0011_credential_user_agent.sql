-- The user agent of the device that enrolled a passkey, so the settings list can
-- say where each one came from ("Chrome on Windows") instead of showing a row of
-- identically-named entries. Stored raw and turned into a label on the client by
-- the same deviceLabel() the sessions list uses.
--
-- Display only, never a security input: a passkey is identified by its
-- credential id and public key, and this string is attacker-controlled like any
-- request header. Passkeys enrolled before this migration keep NULL and simply
-- show no device.
ALTER TABLE credentials ADD COLUMN user_agent TEXT;
