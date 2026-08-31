const express = require('express');
const pool = require('../db/pool');
const { computeEligibility } = require('../utils/eligibility');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();

router.get('/', requireAdmin, async (req, res) => {
  try {
    const { q, status } = req.query;
    let sql = 'SELECT * FROM employees';
    const params = [];
    const clauses = [];
    if (status) {
      params.push(status);
      clauses.push(`status = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      const idx = params.length;
      clauses.push(
        `(first_th ILIKE $${idx} OR last_th ILIKE $${idx} OR nickname ILIKE $${idx} OR emp_id ILIKE $${idx} OR id_card ILIKE $${idx})`
      );
    }
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY start_date DESC NULLS LAST';

    const empRes = await pool.query(sql, params);
    const empIds = empRes.rows.map((r) => r.emp_id);
    const relRes = empIds.length
      ? await pool.query('SELECT * FROM relatives WHERE emp_id = ANY($1)', [empIds])
      : { rows: [] };
    const relByEmp = new Map();
    for (const r of relRes.rows) relByEmp.set(r.emp_id, r);

    const today = new Date();
    const rows = empRes.rows.map((emp) => {
      const elig = computeEligibility(emp, today);
      return {
        empId: emp.emp_id,
        name: `${emp.title_th || ''}${emp.first_th || ''} ${emp.last_th || ''}`.trim(),
        nickname: emp.nickname,
        department: emp.department,
        position: emp.position,
        status: emp.status,
        plan: emp.plan,
        startDate: emp.start_date,
        relative: relByEmp.get(emp.emp_id) || null,
        ...elig,
      };
    });

    res.json({ rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดรายชื่อพนักงานไม่สำเร็จ' });
  }
});

router.get('/:empId', requireAdmin, async (req, res) => {
  try {
    const empRes = await pool.query('SELECT * FROM employees WHERE emp_id = $1', [req.params.empId]);
    if (empRes.rowCount === 0) return res.status(404).json({ error: 'ไม่พบพนักงาน' });
    const relRes = await pool.query('SELECT * FROM relatives WHERE emp_id = $1', [req.params.empId]);
    const emp = empRes.rows[0];
    const elig = computeEligibility(emp);
    res.json({ employee: emp, relatives: relRes.rows, eligibility: elig });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดข้อมูลไม่สำเร็จ' });
  }
});

// One-time cleanup helper for go-live: HR's real notification history lives
// in years of manually-sent email batches that this system has no record of.
// Rather than guess, HR can explicitly acknowledge a specific case as
// "already handled before this system existed" so it stops showing as
// pending. This is intentionally a manual, per-person action with a log
// entry — not an automatic bulk-clear.
router.post('/:empId/acknowledge', requireAdmin, async (req, res) => {
  const { field } = req.body || {};
  if (!['notify_in', 'notify_out'].includes(field)) {
    return res.status(400).json({ error: 'field ต้องเป็น notify_in หรือ notify_out' });
  }
  try {
    const col = field === 'notify_in' ? 'notified_in_done' : 'notified_out_done';
    const result = await pool.query(
      `UPDATE employees SET ${field} = TRUE, ${col} = now(), updated_at = now() WHERE emp_id = $1 RETURNING *`,
      [req.params.empId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'ไม่พบพนักงาน' });
    await pool.query(
      `INSERT INTO activity_log (emp_id, actor, action, detail) VALUES ($1, $2, 'manual_acknowledge', $3)`,
      [req.params.empId, req.session.adminUser.username, JSON.stringify({ field })]
    );
    res.json({ ok: true, employee: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'บันทึกไม่สำเร็จ' });
  }
});

module.exports = router;
