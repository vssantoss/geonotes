-- Optional friendly name for a passkey, shown in the settings passkey list and
-- set when a signed-in user adds a passkey. Null for passkeys created before
-- this column existed or enrolled without a name.
ALTER TABLE credentials ADD COLUMN label TEXT;
