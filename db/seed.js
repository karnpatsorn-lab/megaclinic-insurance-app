require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('./pool');
const { resolvePlan } = require('../utils/plan');

function n(v) {
  // normalize numbers/blank-ish values coming from the source spreadsheets
  if (v === undefined || v === null || v === '') return null;
  return String(v).trim() === '' ? null : v;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dt(v) {
  // dates only: reject Excel error strings (#VALUE!, #N/A, ...) and anything
  // that isn't a clean ISO date rather than letting Postgres reject the whole batch
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  return ISO_DATE_RE.test(s) ? s : null;
}

// The source spreadsheet's own notify_in/notify_out columns are unusable —
// every single one of the 398 records has them set to False, so they can't
// tell us who is actually already enrolled/exited. We derive real signal
// instead:
//  - "already enrolled" = has an insurance_member_id in the ประกันกลุ่ม sheet
//    (verified: matches exactly the recently-hired staff still missing one).
//  - "already exited" = notified_out_done is on file, OR the resignation is
//    older than the grandfather window below. HR has been doing this
//    process manually for 7 years; we don't want the first day of the new
//    system to dump hundreds of years-old resignations on her as "pending".
//    Only recent resignations (within one full quarter, well past her
//    monthly cadence) surface as real, actionable backlog.
const GRANDFATHER_DAYS = 90;

function isRecentEnough(dateStr, today) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const days = (today - d) / (24 * 60 * 60 * 1000);
  return days <= GRANDFATHER_DAYS;
}

function computeNotifyIn(ins) {
  return !!(ins && ins.insurance_member_id);
}

function computeNotifyOut(e, ins, today) {
  if (e.status !== 'OFF') return false; // not resigned, nothing to notify
  if (ins && ins.notified_out_done) return true; // explicitly on file as done
  const effDate = dt(e.resign_eff) || dt(e.resign_last_working) || dt(e.resign_round);
  // Unknown/old resignations are assumed already handled (grandfathered in);
  // only ones inside the recent window are surfaced as still-pending.
  return !isRecentEnough(effDate, today);
}

function str(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

async function loadJson(file) {
  const raw = fs.readFileSync(path.join(__dirname, file), 'utf-8');
  return JSON.parse(raw);
}

async function ensureAdmin(client) {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.log('ADMIN_PASSWORD not set — skipping admin bootstrap (create one manually with db/create-admin.js).');
    return;
  }
  const existing = await client.query('SELECT 1 FROM admin_users WHERE username = $1', [username]);
  if (existing.rowCount > 0) return;
  const hash = await bcrypt.hash(password, 10);
  await client.query(
    `INSERT INTO admin_users (username, password_hash, display_name) VALUES ($1, $2, $3)`,
    [username, hash, process.env.ADMIN_DISPLAY_NAME || 'HR Admin']
  );
  console.log(`Bootstrapped admin user '${username}'.`);
}

function seedFilesPresent() {
  return (
    fs.existsSync(path.join(__dirname, 'dataemp_seed.json')) &&
    fs.existsSync(path.join(__dirname, 'insurance_seed.json'))
  );
}

async function seed() {
  const preCheck = await pool.query('SELECT COUNT(*)::int AS c FROM employees');
  if (preCheck.rows[0].c > 0) {
    console.log(`employees table already has ${preCheck.rows[0].c} rows — skipping data import (safe to re-run, this only happens once).`);
    const client = await pool.connect();
    try {
      await ensureAdmin(client);
    } finally {
      client.release();
      await pool.end();
    }
    return;
  }

  // The real employee PII (national ID cards, phone numbers, bank accounts)
  // is never committed to git, so these two files won't exist in a fresh
  // deploy checked out from the repo (e.g. on Railway). In that case, just
  // bootstrap the HR admin login and leave the real data to be loaded
  // directly against the production database via a separate, non-git path.
  if (!seedFilesPresent()) {
    console.log('Seed data files not found (expected on a fresh deploy — real employee data is loaded separately, not via git). Skipping data import.');
    const client = await pool.connect();
    try {
      await ensureAdmin(client);
    } finally {
      client.release();
      await pool.end();
    }
    return;
  }

  const dataemp = await loadJson('dataemp_seed.json');
  const insurance = await loadJson('insurance_seed.json');

  const insByEmpId = new Map();
  for (const r of insurance) {
    insByEmpId.set(str(r.emp_id), r);
  }
  const dataempIds = new Set(dataemp.map((r) => str(r.emp_id)));

  const client = await pool.connect();
  const today = new Date();
  try {
    await client.query('BEGIN');

    let empCount = 0;
    for (const e of dataemp) {
      const empId = str(e.emp_id);
      if (!empId) continue;
      const ins = insByEmpId.get(empId) || {};

      await client.query(
        `INSERT INTO employees (
          emp_id, status, emp_type, clinic_hq, branch, nickname,
          title_th, first_th, last_th, title_en, first_en, last_en,
          start_date, probation_119, resign_round, resign_last_working, resign_eff,
          position, level_label, level, division, department, line,
          birthdate, id_card, phone, email, status_resign, plan,
          bank_name, bank_account,
          insurance_member_id, f_code, notify_in_due, notify_relative_due,
          notified_in_done, notified_relative_in_done, notified_out_done, notified_relative_out_done,
          notify_in, notify_out, remark
        ) VALUES (
          $1,$2,$3,$4,$5,$6,
          $7,$8,$9,$10,$11,$12,
          $13,$14,$15,$16,$17,
          $18,$19,$20,$21,$22,$23,
          $24,$25,$26,$27,$28,$29,
          $30,$31,
          $32,$33,$34,$35,
          $36,$37,$38,$39,
          $40,$41,$42
        )
        ON CONFLICT (emp_id) DO UPDATE SET
          status = EXCLUDED.status,
          resign_round = EXCLUDED.resign_round,
          resign_last_working = EXCLUDED.resign_last_working,
          resign_eff = EXCLUDED.resign_eff,
          status_resign = EXCLUDED.status_resign,
          notify_in = EXCLUDED.notify_in,
          notify_out = EXCLUDED.notify_out,
          updated_at = now()
        `,
        [
          empId, str(e.status), str(e.emp_type), str(e.clinic_hq), str(e.branch), str(e.nickname),
          str(e.title_th), str(e.first_th), str(e.last_th), str(e.title_en), str(e.first_en), str(e.last_en),
          dt(e.start_date), dt(e.probation_119), dt(e.resign_round), dt(e.resign_last_working), dt(e.resign_eff),
          str(e.position), str(e.level_label), n(ins.level) || null, str(e.division), str(e.department), str(e.line),
          dt(e.birthdate), str(e.id_card), str(e.phone), str(e.email), str(e.status_resign),
          resolvePlan({ plan: e.plan, position: e.position, level: n(ins.level), level_label: e.level_label }),
          str(ins.bank_name), str(ins.bank_account || ins.bank_account2),
          str(ins.insurance_member_id), str(ins.f_code), dt(ins.notify_in_due), dt(ins.notify_relative_due),
          dt(ins.notified_in_done), dt(ins.notified_relative_in_done), dt(ins.notified_out_done), dt(ins.notified_relative_out_done),
          computeNotifyIn(ins), computeNotifyOut(e, ins, today), str(ins.remark),
        ]
      );
      empCount++;
    }

    // Any insurance records for emp_ids not present in dataemp (rare, but be safe)
    for (const ins of insurance) {
      const empId = str(ins.emp_id);
      if (!empId || dataempIds.has(empId)) continue;
      const existsRes = await client.query('SELECT 1 FROM employees WHERE emp_id=$1', [empId]);
      if (existsRes.rowCount === 0) {
        await client.query(
          `INSERT INTO employees (emp_id, first_th, last_th, position, level, department, id_card, phone, email,
             plan, bank_name, bank_account, insurance_member_id, f_code, notify_in_due, notify_relative_due, remark, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'UNKNOWN')
           ON CONFLICT (emp_id) DO NOTHING`,
          [empId, str(ins.first_th), str(ins.last_th), str(ins.position), n(ins.level), str(ins.department),
           str(ins.id_card), str(ins.phone), str(ins.email),
           resolvePlan({ plan: ins.plan, position: ins.position, level: n(ins.level), level_label: ins.level_label }),
           str(ins.bank_name), str(ins.bank_account),
           str(ins.insurance_member_id), str(ins.f_code), dt(ins.notify_in_due), dt(ins.notify_relative_due), str(ins.remark)]
        );
        empCount++;
      }
    }

    // Relatives already on file in the insurance sheet
    let relCount = 0;
    for (const ins of insurance) {
      const empId = str(ins.emp_id);
      const firstName = str(ins.relative_first);
      const lastName = str(ins.relative_last);
      if (!empId || !firstName || firstName === 'ไม่ต้อง') continue;

      await client.query(
        `INSERT INTO relatives (emp_id, title, first_name, last_name, id_card, relation, bank_name, bank_account, birthdate, phone, date_filed, source, notify_in_done)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, COALESCE($11, CURRENT_DATE), 'imported', $12)`,
        [
          empId, str(ins.relative_title), firstName, lastName, str(ins.relative_id_card), null,
          str(ins.bank_name), str(ins.relative_bank_acc_maybe), dt(ins.relative_birthdate), str(ins.relative_phone),
          dt(ins.notify_relative_due), dt(ins.notified_relative_in_done),
        ]
      );
      relCount++;
    }

    await ensureAdmin(client);

    await client.query('COMMIT');
    console.log(`Seed complete: ${empCount} employees upserted, ${relCount} relatives imported.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
