-- =============================================================================
-- Bantai — Database Dump
-- Course: IT 107 · Information Assurance and Security 1
--
-- Covers all 7 required security tables with >= 5 synthetic test records each:
--   1. public.profiles                       (users)
--   2. bantai_private.security_questions     (answers — scrypt salted hashes)
--   3. bantai_private.email_mfa              (OTPs — HMAC-SHA256 digests + AES-256-GCM contact)
--   4. public.security_events                (activity log — append-only)
--   5. bantai_private.security_monitor_flags (security flags — CLI monitor output)
--   6. bantai_private.password_history       (password history — last 3 salted hashes)
--   7. public.source_restrictions            (IP blocks — 10 failures / 10 min)
--
-- NOTE: All records below are 100% synthetic demo fixtures. No real PII,
-- plaintext passwords, plaintext answers, plaintext OTPs, or live keys exist
-- in this file.
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS bantai_private;
REVOKE ALL ON SCHEMA bantai_private FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 1. USERS (public.profiles)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id                  uuid PRIMARY KEY,
  id_number           text UNIQUE NOT NULL CHECK (id_number ~ '^\d{4}-\d{4}$'),
  username            text UNIQUE NOT NULL CHECK (username ~ '^[a-z][a-z0-9]{5,19}$'),
  email               text UNIQUE NOT NULL,
  first_name          text NOT NULL CHECK (char_length(first_name) BETWEEN 2 AND 50),
  middle_name         text CHECK (middle_name IS NULL OR char_length(middle_name) BETWEEN 2 AND 50),
  last_name           text NOT NULL CHECK (char_length(last_name) BETWEEN 2 AND 50),
  name_extension      text,
  birthdate           date NOT NULL,
  purok_street        text NOT NULL,
  barangay            text NOT NULL,
  municipality_city   text NOT NULL,
  province            text NOT NULL,
  country             text NOT NULL DEFAULT 'Philippines',
  zip_code            text NOT NULL CHECK (zip_code ~ '^\d{4}$'),
  organization_type   text NOT NULL DEFAULT 'student' CHECK (organization_type IN ('student','workplace','club','nonprofit','other')),
  preferred_currency  text NOT NULL DEFAULT 'PHP' CHECK (preferred_currency IN ('PHP','USD','EUR','GBP','JPY','CAD','AUD','SGD')),
  display_name        text CHECK (display_name IS NULL OR char_length(display_name) <= 80),
  role                text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin','super_admin')),
  email_verified      boolean NOT NULL DEFAULT false,
  privacy_consent_at  timestamptz NOT NULL,
  locked_until        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2. AUTHENTICATION QUESTIONS & HASHED ANSWERS (bantai_private.security_questions)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bantai_private.security_questions (
  user_id    uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  questions  integer[] NOT NULL CHECK (cardinality(questions) = 3),
  answers    jsonb NOT NULL,
  revision   uuid NOT NULL DEFAULT gen_random_uuid(),
  attempts   integer NOT NULL DEFAULT 0,
  window_at  timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 3. EMAIL OTPs & AES-256-GCM ENCRYPTED MFA CONTACT (bantai_private.email_mfa)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bantai_private.email_mfa (
  user_id                    uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  enrolled_email_ciphertext  text,
  pending_email_ciphertext   text,
  purpose                    text NOT NULL DEFAULT 'login' CHECK (purpose IN ('register','login','reset')),
  digest                     text,
  sent_at                    timestamptz,
  expires_at                 timestamptz,
  attempts                   smallint NOT NULL DEFAULT 0,
  send_times                 timestamptz[] NOT NULL DEFAULT '{}'
);

-- -----------------------------------------------------------------------------
-- 4. ACTIVITY LOG — APPEND-ONLY (public.security_events)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_events (
  id            bigserial PRIMARY KEY,
  category      text NOT NULL CHECK (category IN ('auth','access_control','financial','api_abuse','data_protection','operational')),
  event_class   text NOT NULL DEFAULT 'security' CHECK (event_class IN ('operational','security','audit')),
  event_source  text NOT NULL DEFAULT 'auth',
  severity      text NOT NULL DEFAULT 'low' CHECK (severity IN ('low','medium','high','critical')),
  action        text NOT NULL,
  outcome       text NOT NULL,
  actor_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  source_ip     text,
  http_status   integer,
  route         text,
  request_id    text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 5. SECURITY FLAGS — CLI MONITOR FINDINGS (bantai_private.security_monitor_flags)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bantai_private.security_monitor_flags (
  pattern      text NOT NULL CHECK (pattern IN ('ip_threshold','account_targeted','otp_guessing','off_hours_login')),
  target       text NOT NULL,
  flag_day     date NOT NULL,
  detected_at  timestamptz NOT NULL DEFAULT now(),
  occurrences  bigint NOT NULL,
  PRIMARY KEY (pattern, target, flag_day)
);

-- -----------------------------------------------------------------------------
-- 6. PASSWORD HISTORY — LAST 3 HASHES (bantai_private.password_history)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bantai_private.password_history (
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  version     bigint NOT NULL,
  verifier    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, version)
);

-- -----------------------------------------------------------------------------
-- 7. IP BLOCKS (public.source_restrictions)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.source_restrictions (
  source_ip       text PRIMARY KEY,
  status          text NOT NULL CHECK (status IN ('monitoring','restricted','cleared')),
  reason          text NOT NULL,
  risk_score      integer NOT NULL DEFAULT 0,
  attempts_count  integer NOT NULL DEFAULT 0,
  auto_triggered  boolean NOT NULL DEFAULT true,
  expires_at      timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- SYNTHETIC TEST RECORDS (6 Users: 1 Admin + 5 Users, >= 5 rows per table)
-- =============================================================================

-- 1. Users (1 admin + 5 ordinary users)
INSERT INTO public.profiles (
  id, id_number, username, email, first_name, middle_name, last_name, name_extension,
  birthdate, purok_street, barangay, municipality_city, province, country, zip_code,
  organization_type, preferred_currency, display_name, role, email_verified, privacy_consent_at, locked_until
) VALUES
  ('10000000-0000-4000-8000-000000000001', '2026-0001', 'secadmin01', 'admin.demo@bantai-test.local',
   'Elena', 'Santos', 'Villanueva', NULL, '1999-04-12', 'Purok 2 Rizal Street', 'Ampayon', 'Butuan City', 'Agusan del Norte', 'Philippines', '8600',
   'student', 'PHP', 'Platform Security Admin', 'admin', true, '2026-11-01 08:00:00+08', NULL),
  ('10000000-0000-4000-8000-000000000002', '2026-0002', 'jdelacruz', 'juan.demo@bantai-test.local',
   'Juan', 'Carlo', 'Dela Cruz', 'Jr.', '2003-08-21', 'Purok 4 Maharlika Highway', 'Libertad', 'Butuan City', 'Agusan del Norte', 'Philippines', '8600',
   'student', 'PHP', 'Juan (Treasurer)', 'user', true, '2026-11-02 09:15:00+08', NULL),
  ('10000000-0000-4000-8000-000000000003', '2026-0003', 'mreyes2026', 'maria.demo@bantai-test.local',
   'Maria', 'Clara', 'Reyes', NULL, '2004-02-14', 'Purok 1 Narra Street', 'Baan', 'Butuan City', 'Agusan del Norte', 'Philippines', '8600',
   'club', 'PHP', 'Maria (Auditor)', 'user', true, '2026-11-03 10:30:00+08', NULL),
  ('10000000-0000-4000-8000-000000000004', '2026-0004', 'cgarcia04', 'carlos.demo@bantai-test.local',
   'Carlos', NULL, 'Garcia', 'III', '2002-11-05', 'Purok 6 Acacia Avenue', 'Doongan', 'Butuan City', 'Agusan del Norte', 'Philippines', '8600',
   'nonprofit', 'PHP', 'Carlos G.', 'user', true, '2026-11-04 14:20:00+08', NULL),
  ('10000000-0000-4000-8000-000000000005', '2026-0005', 'alopez05', 'ana.demo@bantai-test.local',
   'Ana', 'Mae', 'Lopez', NULL, '2003-06-30', 'Purok 3 Molave Lane', 'San Vicente', 'Butuan City', 'Agusan del Norte', 'Philippines', '8600',
   'workplace', 'USD', 'Ana Lopez', 'user', true, '2026-11-05 16:45:00+08', NULL),
  ('10000000-0000-4000-8000-000000000006', '2026-0006', 'rmendoza06', 'rafael.demo@bantai-test.local',
   'Rafael', 'Luis', 'Mendoza', NULL, '2001-09-18', 'Purok 5 Yakal Road', 'Villa Kananga', 'Butuan City', 'Agusan del Norte', 'Philippines', '8600',
   'student', 'PHP', 'Rafael M.', 'user', false, '2026-11-06 11:10:00+08', NULL)
ON CONFLICT (id) DO NOTHING;

-- 2. Security Questions & Salted Hashed Answers (3 distinct questions from Section 5 bank 1..8)
INSERT INTO bantai_private.security_questions (user_id, questions, answers, attempts) VALUES
  ('10000000-0000-4000-8000-000000000001', ARRAY[1, 3, 7],
   '["scrypt$16384$8$1$a1b2c3d4e5f60718$9f8e7d6c5b4a39281706f5e4d3c2b1a0", "scrypt$16384$8$1$b2c3d4e5f6071829$8e7d6c5b4a39281706f5e4d3c2b1a09f", "scrypt$16384$8$1$c3d4e5f60718293a$7d6c5b4a39281706f5e4d3c2b1a09f8e"]'::jsonb, 0),
  ('10000000-0000-4000-8000-000000000002', ARRAY[1, 4, 8],
   '["scrypt$16384$8$1$d4e5f60718293a4b$6c5b4a39281706f5e4d3c2b1a09f8e7d", "scrypt$16384$8$1$e5f60718293a4b5c$5b4a39281706f5e4d3c2b1a09f8e7d6c", "scrypt$16384$8$1$f60718293a4b5c6d$4a39281706f5e4d3c2b1a09f8e7d6c5b"]'::jsonb, 0),
  ('10000000-0000-4000-8000-000000000003', ARRAY[2, 5, 6],
   '["scrypt$16384$8$1$0718293a4b5c6d7e$39281706f5e4d3c2b1a09f8e7d6c5b4a", "scrypt$16384$8$1$18293a4b5c6d7e8f$281706f5e4d3c2b1a09f8e7d6c5b4a39", "scrypt$16384$8$1$293a4b5c6d7e8f90$1706f5e4d3c2b1a09f8e7d6c5b4a3928"]'::jsonb, 1),
  ('10000000-0000-4000-8000-000000000004', ARRAY[2, 4, 7],
   '["scrypt$16384$8$1$3a4b5c6d7e8f90a1$06f5e4d3c2b1a09f8e7d6c5b4a392817", "scrypt$16384$8$1$4b5c6d7e8f90a1b2$f5e4d3c2b1a09f8e7d6c5b4a39281706", "scrypt$16384$8$1$5c6d7e8f90a1b2c3$e4d3c2b1a09f8e7d6c5b4a39281706f5"]'::jsonb, 0),
  ('10000000-0000-4000-8000-000000000005', ARRAY[3, 6, 8],
   '["scrypt$16384$8$1$6d7e8f90a1b2c3d4$d3c2b1a09f8e7d6c5b4a39281706f5e4", "scrypt$16384$8$1$7e8f90a1b2c3d4e5$c2b1a09f8e7d6c5b4a39281706f5e4d3", "scrypt$16384$8$1$8f90a1b2c3d4e5f6$b1a09f8e7d6c5b4a39281706f5e4d3c2"]'::jsonb, 0)
ON CONFLICT (user_id) DO NOTHING;

-- 3. OTP Challenges & AES-256-GCM Encrypted MFA Contacts (5-minute expiry, HMAC-SHA256 digests)
INSERT INTO bantai_private.email_mfa (
  user_id, enrolled_email_ciphertext, pending_email_ciphertext, purpose, digest, sent_at, expires_at, attempts
) VALUES
  ('10000000-0000-4000-8000-000000000001', 'v1:aes256gcm:7f91a2c4b8e0d1f3a5c7e901:4c2d8e91f0a3b7c6d5e4f3a2b1c0d9e8f7a6b5c4:91a2b3c4d5e6f708192a3b4c5d6e7f80', NULL, 'login',
   'hmac_sha256:9b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c', '2026-11-25 10:00:00+08', '2026-11-25 10:05:00+08', 0),
  ('10000000-0000-4000-8000-000000000002', 'v1:aes256gcm:8a02b3d5c9f1e204b6d8fa12:5d3e9fa201b4c8d7e6f504b3c2d1e0f908b7c6d5:a2b3c4d5e6f708192a3b4c5d6e7f8091', NULL, 'login',
   'hmac_sha256:8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', '2026-11-25 10:12:00+08', '2026-11-25 10:17:00+08', 1),
  ('10000000-0000-4000-8000-000000000003', 'v1:aes256gcm:9b13c4e6da02f315c7e90b23:6e4fa0b312c5d9e8f70615c4d3e2f10a19c8d7e6:b3c4d5e6f708192a3b4c5d6e7f8091a2', NULL, 'reset',
   'hmac_sha256:79fa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a', '2026-11-25 11:00:00+08', '2026-11-25 11:05:00+08', 0),
  ('10000000-0000-4000-8000-000000000004', 'v1:aes256gcm:ac24d5f7eb130426d8fa1c34:7f50b1c423d6eaf9081726d5e4f3021b2ad9e8f7:c4d5e6f708192a3b4c5d6e7f8091a2b3', NULL, 'login',
   NULL, '2026-11-25 09:30:00+08', '2026-11-25 09:35:00+08', 3),
  ('10000000-0000-4000-8000-000000000005', 'v1:aes256gcm:bd35e608fc241537e90b2d45:8061c2d534e7fb0a192837e6f504132c3beaf908:d5e6f708192a3b4c5d6e7f8091a2b3c4', NULL, 'register',
   'hmac_sha256:68e9fa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f', '2026-11-25 14:00:00+08', '2026-11-25 14:05:00+08', 0)
ON CONFLICT (user_id) DO NOTHING;

-- 4. Activity Log — Append-Only Security Events (12 sample events across core flows)
INSERT INTO public.security_events (
  category, event_class, event_source, severity, action, outcome, actor_id, source_ip, http_status, route, request_id, metadata, occurred_at
) VALUES
  ('auth', 'security', 'auth', 'low', 'REGISTERED', 'succeeded', '10000000-0000-4000-8000-000000000002', '203.0.113.10', 204, '/auth/register', 'req-demo-001', '{"username_typed":"jdelacruz","user_agent":"Mozilla/5.0 (Windows NT 10.0)"}', '2026-11-24 09:00:00+08'),
  ('auth', 'security', 'auth', 'low', 'ACCOUNT_VERIFIED', 'succeeded', '10000000-0000-4000-8000-000000000002', '203.0.113.10', 200, '/auth/verify', 'req-demo-002', '{"username_typed":"jdelacruz"}', '2026-11-24 09:02:00+08'),
  ('auth', 'security', 'auth', 'low', 'OTP_SENT', 'succeeded', '10000000-0000-4000-8000-000000000002', '203.0.113.10', 200, '/auth/email-mfa/send', 'req-demo-003', '{"purpose":"login"}', '2026-11-24 09:05:00+08'),
  ('auth', 'security', 'auth', 'low', 'LOGIN_SUCCESS', 'succeeded', '10000000-0000-4000-8000-000000000002', '203.0.113.10', 200, '/auth/login', 'req-demo-004', '{"username_typed":"jdelacruz","user_agent":"Mozilla/5.0 (Windows NT 10.0)"}', '2026-11-24 09:06:00+08'),
  ('auth', 'security', 'auth', 'low', 'LOGIN_FAILED', 'flagged', '10000000-0000-4000-8000-000000000003', '198.51.100.45', 401, '/auth/login', 'req-demo-005', '{"username_typed":"mreyes2026","user_agent":"Mozilla/5.0 (Linux)"}', '2026-11-25 13:10:00+08'),
  ('auth', 'security', 'database', 'medium', 'LOCKOUT_TIER_1', 'blocked', '10000000-0000-4000-8000-000000000003', '198.51.100.45', 429, '/auth/login', 'req-demo-006', '{"failures":3,"lockout_seconds":15}', '2026-11-25 13:11:00+08'),
  ('auth', 'security', 'auth', 'low', 'ALERT_EMAIL_SENT', 'succeeded', '10000000-0000-4000-8000-000000000003', '198.51.100.45', 200, '/auth/login', 'req-demo-007', '{"tier":1,"failures":3}', '2026-11-25 13:11:02+08'),
  ('auth', 'security', 'auth', 'medium', 'OTP_FAILED', 'flagged', '10000000-0000-4000-8000-000000000004', '198.51.100.77', 400, '/auth/email-mfa/verify', 'req-demo-008', '{"attempts":3}', '2026-11-25 13:20:00+08'),
  ('auth', 'security', 'auth', 'high', 'IP_BLOCKED', 'blocked', NULL, '198.51.100.99', 429, '/auth/login', 'req-demo-009', '{"failures":10,"block_seconds":600}', '2026-11-25 13:30:00+08'),
  ('auth', 'security', 'auth', 'low', 'PASSWORD_CHANGED', 'succeeded', '10000000-0000-4000-8000-000000000003', '203.0.113.12', 200, '/auth/recovery-questions/reset', 'req-demo-010', '{"purpose":"reset"}', '2026-11-25 14:05:00+08'),
  ('access_control', 'security', 'api', 'medium', 'ADMIN_ACCESS_DENIED', 'denied', '10000000-0000-4000-8000-000000000002', '203.0.113.10', 403, '/admin/overview', 'req-demo-011', '{"username_typed":"jdelacruz"}', '2026-11-25 14:15:00+08'),
  ('access_control', 'security', 'api', 'low', 'ADMIN_VIEWED_DASHBOARD', 'flagged', '10000000-0000-4000-8000-000000000001', '203.0.113.1', 204, '/admin/security/dashboard-entry', 'req-demo-012', '{"username_typed":"secadmin01"}', '2026-11-25 14:20:00+08');

-- 5. Security Flags (5 findings from CLI monitor covering all 4 detection patterns)
INSERT INTO bantai_private.security_monitor_flags (pattern, target, flag_day, detected_at, occurrences) VALUES
  ('ip_threshold', '198.51.100.99', '2026-11-25', '2026-11-25 13:45:00+08', 11),
  ('account_targeted', 'jdelacruz', '2026-11-25', '2026-11-25 13:45:00+08', 3),
  ('otp_guessing', '10000000-0000-4000-8000-000000000004', '2026-11-25', '2026-11-25 13:45:00+08', 5),
  ('off_hours_login', '10000000-0000-4000-8000-000000000005', '2026-11-25', '2026-11-25 02:30:00+08', 1),
  ('ip_threshold', '198.51.100.45', '2026-11-24', '2026-11-24 18:15:00+08', 10)
ON CONFLICT (pattern, target, flag_day) DO NOTHING;

-- 6. Password History (last 3 salted hashes per user — 7 records across 5 users)
INSERT INTO bantai_private.password_history (user_id, version, verifier, created_at) VALUES
  ('10000000-0000-4000-8000-000000000001', 1, 'scrypt$16384$8$1$1122334455667788$aa11bb22cc33dd44ee55ff6600112233', '2026-11-01 08:00:00+08'),
  ('10000000-0000-4000-8000-000000000002', 1, 'scrypt$16384$8$1$2233445566778899$bb22cc33dd44ee55ff660011223344aa', '2026-11-02 09:15:00+08'),
  ('10000000-0000-4000-8000-000000000002', 2, 'scrypt$16384$8$1$33445566778899aa$cc33dd44ee55ff660011223344aabb22', '2026-11-12 10:00:00+08'),
  ('10000000-0000-4000-8000-000000000003', 1, 'scrypt$16384$8$1$445566778899aabb$dd44ee55ff660011223344aabb22cc33', '2026-11-03 10:30:00+08'),
  ('10000000-0000-4000-8000-000000000003', 2, 'scrypt$16384$8$1$5566778899aabbcc$ee55ff660011223344aabb22cc33dd44', '2026-11-25 14:05:00+08'),
  ('10000000-0000-4000-8000-000000000004', 1, 'scrypt$16384$8$1$66778899aabbccdd$ff660011223344aabb22cc33dd44ee55', '2026-11-04 14:20:00+08'),
  ('10000000-0000-4000-8000-000000000005', 1, 'scrypt$16384$8$1$778899aabbccddee$0011223344aabb22cc33dd44ee55ff66', '2026-11-05 16:45:00+08')
ON CONFLICT (user_id, version) DO NOTHING;

-- 7. IP Blocks (5 records in public.source_restrictions)
INSERT INTO public.source_restrictions (
  source_ip, status, reason, risk_score, attempts_count, auto_triggered, expires_at, updated_at
) VALUES
  ('198.51.100.99', 'restricted', 'Credential failure threshold (10 failures in 10 minutes)', 85, 11, true, '2026-11-25 13:40:00+08', '2026-11-25 13:30:00+08'),
  ('198.51.100.45', 'cleared', 'Credential failure threshold (10 failures in 10 minutes)', 72, 10, true, '2026-11-24 18:10:00+08', '2026-11-24 18:11:00+08'),
  ('198.51.100.77', 'monitoring', 'Elevated failed request frequency', 45, 6, true, NULL, '2026-11-25 13:20:00+08'),
  ('192.0.2.150', 'restricted', 'Automated brute-force cooldown across multiple accounts', 90, 14, true, '2026-11-25 15:00:00+08', '2026-11-25 14:50:00+08'),
  ('192.0.2.201', 'cleared', 'Credential failure threshold expired', 60, 10, true, '2026-11-23 22:10:00+08', '2026-11-23 22:15:00+08')
ON CONFLICT (source_ip) DO NOTHING;

COMMIT;
