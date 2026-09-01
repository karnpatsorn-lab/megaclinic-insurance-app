// Ad hoc data-correction endpoint for HR. The initial notify_in/notify_out
// flags were derived by a 90-day "grandfather window" heuristic at import
// time (utils/importSeedData.js), which turned out to have a real bug: a
// resignation older than 90 days gets silently treated as "already handled"
// even when it was never actually reported to the insurer. HR's own manual
// tracking sheets (checklists, batch-submission history) are the real
// source of truth, so this endpoint lets HR resync specific emp_ids against
// that ground truth whenever they re-audit — this is expected to be used
// more than once, not just for the initial 2026-08-31 correction.
const express = require('express');
const pool = require('../db/pool');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();

router.post('/correct-notify-status', requireAdmin, async (req, res) => {
  const { notifyInDone = [], notifyOutPending = [], statusOverride = [] } = req.body || {};
  if (!Array.isArray(notifyInDone) || !Array.isArray(notifyOutPending) || !Array.isArray(statusOverride)) {
    return res.status(400).json({ error: 'notifyInDone, notifyOutPending, statusOverride ต้องเป็น array' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let notifyInCount = 0;
    if (notifyInDone.length) {
      const result = await client.query(
        `UPDATE employees SET notify_in = TRUE, notified_in_done = COALESCE(notified_in_done, now()), updated_at = now()
         WHERE emp_id = ANY($1) RETURNING emp_id`,
        [notifyInDone]
      );
      notifyInCount = result.rowCount;
    }

    let notifyOutCount = 0;
    if (notifyOutPending.length) {
      const result = await client.query(
        `UPDATE employees SET notify_out = FALSE, notified_out_done = NULL, updated_at = now()
         WHERE emp_id = ANY($1) RETURNING emp_id`,
        [notifyOutPending]
      );
      notifyOutCount = result.rowCount;
    }

    let statusCount = 0;
    for (const item of statusOverride) {
      const { empId, status } = item || {};
      if (!empId || !['ON', 'OFF'].includes(status)) continue;
      const result = await client.query(
        `UPDATE employees SET status = $2, updated_at = now() WHERE emp_id = $1 RETURNING emp_id`,
        [empId, status]
      );
      statusCount += result.rowCount;
    }

    await client.query(
      `INSERT INTO activity_log (actor, action, detail) VALUES ($1, 'notify_status_correction', $2)`,
      [
        req.session.adminUser.username,
        JSON.stringify({ notifyInDone, notifyOutPending, statusOverride }),
      ]
    );

    await client.query('COMMIT');
    res.json({ ok: true, notifyInCount, notifyOutCount, statusCount });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message || 'แก้ไขข้อมูลไม่สำเร็จ' });
  } finally {
    client.release();
  }
});

module.exports = router;
