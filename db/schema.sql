-- Mega Clinic Group Insurance Tracker — schema
-- Employees table combines HR master data (DataEmployee sheet) with
-- insurance-specific fields (ประกันกลุ่ม sheet) keyed by emp_id.

CREATE TABLE IF NOT EXISTS employees (
  emp_id              TEXT PRIMARY KEY,
  status              TEXT,             -- 'ON' | 'OFF'
  emp_type            TEXT,
  clinic_hq           TEXT,
  branch              TEXT,
  nickname            TEXT,
  title_th            TEXT,
  first_th            TEXT,
  last_th             TEXT,
  title_en            TEXT,
  first_en            TEXT,
  last_en             TEXT,
  start_date          DATE,
  probation_119       DATE,             -- ~4 months from start; insurance eligibility date
  resign_round        DATE,
  resign_last_working DATE,
  resign_eff          DATE,
  position            TEXT,
  level_label         TEXT,
  level               INTEGER,
  division            TEXT,
  department          TEXT,
  line                TEXT,
  birthdate           DATE,
  id_card             TEXT,
  phone               TEXT,
  email               TEXT,
  status_resign       TEXT,             -- 'Current' | 'Resigned'
  plan                TEXT,             -- Plan2 - Plan5
  bank_name           TEXT,
  bank_account        TEXT,

  -- fields an employee can propose changes to via self-service (applied only
  -- after HR approves — see self_service_requests below)
  current_address     TEXT,
  personal_email      TEXT,

  -- insurance sheet fields
  insurance_member_id TEXT,
  f_code              TEXT,
  notify_in_due       DATE,
  notify_relative_due DATE,
  notified_in_done       TIMESTAMPTZ,
  notified_relative_in_done TIMESTAMPTZ,
  notified_out_done      TIMESTAMPTZ,
  notified_relative_out_done TIMESTAMPTZ,
  notify_in           BOOLEAN DEFAULT FALSE,  -- enrollment notice already sent to insurer
  notify_out          BOOLEAN DEFAULT FALSE,  -- exit notice already sent to insurer
  remark              TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_start_date ON employees(start_date);

-- employees/relatives already existed before these columns were added, so
-- CREATE TABLE IF NOT EXISTS above is a no-op on a live database — these
-- ALTERs are what actually bring an existing table up to date.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS current_address TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS personal_email TEXT;

-- The one relative registered for group insurance once an employee reaches
-- 6 months' tenure (policy allows 1). Kept separate from family_members
-- below, which is a simple contact roster for HR leave purposes and has no
-- insurance-specific fields.
CREATE TABLE IF NOT EXISTS relatives (
  id              SERIAL PRIMARY KEY,
  emp_id          TEXT NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
  title           TEXT,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  nickname        TEXT,
  id_card         TEXT,
  nationality     TEXT DEFAULT 'ไทย',
  relation        TEXT,             -- บิดา/มารดา/คู่สมรส/บุตร
  bank_name       TEXT,
  bank_account    TEXT,
  birthdate       DATE,
  phone           TEXT,
  date_filed      DATE NOT NULL DEFAULT CURRENT_DATE,
  source          TEXT NOT NULL DEFAULT 'self_service', -- 'imported' | 'self_service' | 'admin'
  notify_in_done  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE relatives ADD COLUMN IF NOT EXISTS nickname TEXT;

CREATE INDEX IF NOT EXISTS idx_relatives_emp_id ON relatives(emp_id);

-- General family/emergency-contact roster for HR leave purposes (ลากิจ) —
-- up to 6 per employee, lighter-weight than the insurance relative above
-- (no bank/insurance fields). An employee's whole list is replaced as a set
-- each time they resubmit via self-service.
CREATE TABLE IF NOT EXISTS family_members (
  id              SERIAL PRIMARY KEY,
  emp_id          TEXT NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
  slot            INTEGER NOT NULL,        -- 1-6, display/order only
  title           TEXT,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  nickname        TEXT,
  relation        TEXT,             -- บิดา/มารดา/คู่สมรส/บุตร/พี่น้อง/อื่นๆ
  phone           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (emp_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_family_members_emp_id ON family_members(emp_id);

-- Self-submitted changes an employee makes to their own core profile data
-- (address, personal email, phone, nickname) sit here as pending until HR
-- reviews and approves them — never applied straight to employees.
CREATE TABLE IF NOT EXISTS self_service_requests (
  id            SERIAL PRIMARY KEY,
  emp_id        TEXT NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,        -- 'profile' | 'family_members'
  payload       JSONB NOT NULL,       -- proposed new values
  status        TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  reviewed_by   TEXT,
  reviewed_at   TIMESTAMPTZ,
  review_note   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ssr_status ON self_service_requests(status);
CREATE INDEX IF NOT EXISTS idx_ssr_emp_id ON self_service_requests(emp_id);

-- Notification batches: draft -> confirmed(sent). Nothing is considered
-- "sent to insurer" until HR explicitly confirms, so a generated export
-- never silently marks people as done.
CREATE TABLE IF NOT EXISTS notification_batches (
  id           SERIAL PRIMARY KEY,
  batch_type   TEXT NOT NULL,         -- 'enroll' | 'exit'
  batch_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  status       TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'sent'
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS notification_batch_items (
  id           SERIAL PRIMARY KEY,
  batch_id     INTEGER NOT NULL REFERENCES notification_batches(id) ON DELETE CASCADE,
  emp_id       TEXT NOT NULL REFERENCES employees(emp_id),
  relative_id  INTEGER REFERENCES relatives(id),
  item_type    TEXT NOT NULL,        -- 'employee_enroll' | 'employee_exit' | 'relative_enroll'
  notes        TEXT
);

CREATE INDEX IF NOT EXISTS idx_batch_items_batch ON notification_batch_items(batch_id);

-- HR admin accounts (session login). Employees never get an account here;
-- they authenticate per-request via emp_id + last 4 of id_card.
CREATE TABLE IF NOT EXISTS admin_users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- express-session store (connect-pg-simple expects this exact shape)
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default" PRIMARY KEY,
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- Simple audit trail for self-service changes (helps HR see who touched what)
CREATE TABLE IF NOT EXISTS activity_log (
  id          SERIAL PRIMARY KEY,
  emp_id      TEXT,
  actor       TEXT,          -- 'self_service' | admin username
  action      TEXT NOT NULL, -- e.g. 'relative_submitted', 'relative_updated', 'batch_confirmed'
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
