require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('./pool');
const { resolvePlan } = require('../utils/plan');
const { importSeedData } = require('../utils/importSeedData');

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

  try {
    const { empCount, relCount } = await importSeedData(pool, { dataemp, insurance }, { resolvePlan });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await ensureAdmin(client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    console.log(`Seed complete: ${empCount} employees upserted, ${relCount} relatives imported.`);
  } finally {
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
