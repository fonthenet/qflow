-- ─────────────────────────────────────────────────────────────────────
-- Rider phone-OTP auth — long-lived sessions, no password.
--
-- Riders log in with their WhatsApp phone number and a 6-digit code
-- delivered via the same WhatsApp outbox the rest of the app uses.
-- Once verified the device gets a long-lived bearer token (sha256
-- stored server-side so we can revoke). No expiry by default — the
-- session lives until the rider taps Sign Out or an operator
-- inactivates the rider record. Sliding `last_seen_at` lets us spot
-- abandoned devices later if we want to add idle timeout.
--
-- The per-ticket HMAC token (see lib/rider-token.ts) keeps working
-- in parallel: a rider who taps a deeplink without logging in still
-- gets the per-ticket flow. The rider endpoints accept either auth.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rider_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  -- sha256 of the bearer token issued to the device. We never store
  -- the plaintext token — just enough to verify on subsequent calls.
  token_hash text NOT NULL UNIQUE,
  -- Optional human-readable device label ("iPhone 14, Algiers").
  -- Surfaced on a future "active sessions" management screen.
  device_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- Set when the rider taps Sign Out or an operator force-revokes.
  -- Verifications check IS NULL — never deleted, so we have an audit
  -- trail of when sessions ended.
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_rider_sessions_rider
  ON rider_sessions (rider_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rider_sessions_token_hash
  ON rider_sessions (token_hash) WHERE revoked_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- One-time codes. Phone-keyed, not rider-keyed, because:
--   1) The "change phone number" flow needs to OTP an unregistered phone.
--   2) Multi-device login should still work — nothing on this row binds
--      to a specific device until verify succeeds.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rider_otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- E.164 phone — same shape as riders.phone.
  phone text NOT NULL,
  -- sha256(code) so a DB leak never reveals the OTP. Verification
  -- recomputes the hash and compares.
  code_hash text NOT NULL,
  -- Expires fast — 10 minutes. Past expiry the verify endpoint 401s.
  expires_at timestamptz NOT NULL,
  -- Bumped per failed verify; we cap at 5 attempts before invalidating.
  attempts smallint NOT NULL DEFAULT 0,
  -- Set when the OTP successfully verifies — single-use enforcement.
  used_at timestamptz,
  -- 'login' | 'change_phone' — keeps the two flows isolated so a
  -- login OTP can't be replayed against the change-phone endpoint.
  purpose text NOT NULL DEFAULT 'login',
  -- For change-phone: bind the OTP to the existing rider so an
  -- attacker who knows a target's new number can't claim someone
  -- else's account. NULL for plain login.
  rider_id uuid REFERENCES riders(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Verify path is keyed on (phone, purpose) — fast lookup of the
-- newest unused, unexpired code for a given phone+purpose.
CREATE INDEX IF NOT EXISTS idx_rider_otp_phone_purpose
  ON rider_otp_codes (phone, purpose, created_at DESC)
  WHERE used_at IS NULL;

-- Periodic cleanup: codes older than 24h are useless (10-min expiry,
-- but we keep them around briefly for forensics).
CREATE INDEX IF NOT EXISTS idx_rider_otp_expired
  ON rider_otp_codes (created_at)
  WHERE used_at IS NULL;
