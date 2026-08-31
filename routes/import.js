// One-time (idempotent) endpoint that lets HR admin load the real employee
// data directly into this deployed database, over an authenticated HTTPS
// request — never through git. The two source JSON files (national ID
// cards, phone numbers, bank accounts) never leave a private machine except
// as the POST body of this call, sent straight to this server.
const express = require('express');
const pool = require('../db/pool');
const requireAdmin = require('../middleware/requireAdmin');
const { resolvePlan } = require('../utils/plan');
const { importSeedData } = require('../utils/importSeedData');

const router = express.Router();

router.post('/import-seed-data', requireAdmin, async (req, res) => {
  const { dataemp, insurance } = req.body || {};
  if (!Array.isArray(dataemp) || !Array.isArray(insurance)) {
    return res.status(400).json({ error: 'ต้องส่ง dataemp และ insurance เป็น array ใน body' });
  }
  try {
    const result = await importSeedData(pool, { dataemp, insurance }, { resolvePlan });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'นำเข้าข้อมูลไม่สำเร็จ' });
  }
});

module.exports = router;
