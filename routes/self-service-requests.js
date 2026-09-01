// HR review queue for employee self-service submissions (profile edits and
// family/leave-roster updates). Nothing an employee submits through
// self-service ever touches employees/family_members directly — it lands
// here as 'pending' and only takes effect once HR approves it.
const express = require('express');
const pool = require('../db/pool');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();

router.get('/self-service-requests', requireAdmin, async (req, res) => {
  const status = req.query.status || 'pending';
  try {
    const result = await pool.query(
      `SELECT r.*, e.first_th, e.last_th, e.nickname AS current_nickname, e.department
       FROM self_service_requests r
       JOIN employees e ON e.emp_id = r.emp_id
       WHERE r.status = $1
       ORDER BY r.created_at ASC`,
      [status]
    );
    res.json({ requests: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดคำขอไม่สำเร็จ' });
  }
});

router.post('/self-service-requests/:id/approve', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reqRes = await client.query('SELECT * FROM self_service_requests WHERE id = $1 FOR UPDATE', [req.params.id]);
    const request = reqRes.rows[0];
    if (!request) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'ไม่พบคำขอนี้' });
    }
    if (request.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'คำขอนี้ถูกดำเนินการไปแล้ว' });
    }

    if (request.kind === 'profile') {
      const p = request.payload;
      const sets = [];
      const params = [request.emp_id];
      const map = { nickname: 'nickname', phone: 'phone', currentAddress: 'current_address', personalEmail: 'personal_email' };
      for (const [key, col] of Object.entries(map)) {
        if (Object.prototype.hasOwnProperty.call(p, key)) {
          params.push(p[key]);
          sets.push(`${col} = $${params.length}`);
        }
      }
      if (sets.length) {
        await client.query(`UPDATE employees SET ${sets.join(', ')}, updated_at = now() WHERE emp_id = $1`, params);
      }
    } else if (request.kind === 'family_members') {
      const members = (request.payload && request.payload.members) || [];
      await client.query('DELETE FROM family_members WHERE emp_id = $1', [request.emp_id]);
      let slot = 1;
      for (const m of members.slice(0, 6)) {
        await client.query(
          `INSERT INTO family_members (emp_id, slot, title, first_name, last_name, nickname, relation, phone)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [request.emp_id, slot++, m.title || null, m.firstName, m.lastName, m.nickname || null, m.relation || null, m.phone || null]
        );
      }
    } else {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `ไม่รู้จักประเภทคำขอ: ${request.kind}` });
    }

    await client.query(
      `UPDATE self_service_requests SET status = 'approved', reviewed_by = $2, reviewed_at = now() WHERE id = $1`,
      [request.id, req.session.adminUser.username]
    );
    await client.query(
      `INSERT INTO activity_log (emp_id, actor, action, detail) VALUES ($1, $2, 'self_service_request_approved', $3)`,
      [request.emp_id, req.session.adminUser.username, JSON.stringify({ requestId: request.id, kind: request.kind })]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message || 'อนุมัติไม่สำเร็จ' });
  } finally {
    client.release();
  }
});

router.post('/self-service-requests/:id/reject', requireAdmin, async (req, res) => {
  const { note } = req.body || {};
  try {
    const result = await pool.query(
      `UPDATE self_service_requests SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_note = $3
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [req.params.id, req.session.adminUser.username, note || null]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'ไม่พบคำขอนี้ หรือถูกดำเนินการไปแล้ว' });
    await pool.query(
      `INSERT INTO activity_log (emp_id, actor, action, detail) VALUES ($1, $2, 'self_service_request_rejected', $3)`,
      [result.rows[0].emp_id, req.session.adminUser.username, JSON.stringify({ requestId: result.rows[0].id, note })]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ปฏิเสธคำขอไม่สำเร็จ' });
  }
});

module.exports = router;
