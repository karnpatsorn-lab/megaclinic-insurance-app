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

// HR adds/updates the one insurance relative directly on an employee's
// behalf — for cases where the employee reached 6 months but never used the
// self-service link themselves. Mirrors the self-service /relative logic,
// but as an admin action (no employee-side token, no 6-month gate — HR has
// full authority here) and logged with the admin's own username as actor.
router.post('/:empId/relative', requireAdmin, async (req, res) => {
  const { relative } = req.body || {};
  if (!relative || typeof relative !== 'object') {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });
  }
  const { firstName, lastName, nickname, idCard, nationality, relation, bankName, bankAccount, birthdate, phone } = relative;
  if (!firstName || !lastName) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อและนามสกุลญาติ' });
  }
  try {
    const empRes = await pool.query('SELECT emp_id FROM employees WHERE emp_id = $1', [req.params.empId]);
    if (empRes.rowCount === 0) return res.status(404).json({ error: 'ไม่พบข้อมูลพนักงาน' });

    const existing = await pool.query('SELECT id FROM relatives WHERE emp_id = $1', [req.params.empId]);
    let relRow;
    if (existing.rowCount > 0) {
      const upd = await pool.query(
        `UPDATE relatives SET title=$1, first_name=$2, last_name=$3, nickname=$4, id_card=$5, nationality=$6, relation=$7,
           bank_name=$8, bank_account=$9, birthdate=$10, phone=$11, date_filed=CURRENT_DATE, updated_at=now()
         WHERE emp_id = $12 RETURNING *`,
        [relative.title || null, firstName, lastName, nickname || null, idCard || null, nationality || 'ไทย', relation || null,
         bankName || null, bankAccount || null, birthdate || null, phone || null, req.params.empId]
      );
      relRow = upd.rows[0];
    } else {
      const ins = await pool.query(
        `INSERT INTO relatives (emp_id, title, first_name, last_name, nickname, id_card, nationality, relation, bank_name, bank_account, birthdate, phone, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'admin') RETURNING *`,
        [req.params.empId, relative.title || null, firstName, lastName, nickname || null, idCard || null, nationality || 'ไทย', relation || null,
         bankName || null, bankAccount || null, birthdate || null, phone || null]
      );
      relRow = ins.rows[0];
    }
    await pool.query(
      `INSERT INTO activity_log (emp_id, actor, action, detail) VALUES ($1, $2, 'relative_added_by_admin', $3)`,
      [req.params.empId, req.session.adminUser.username, JSON.stringify(relative)]
    );
    res.json({ ok: true, relative: relRow });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'บันทึกข้อมูลไม่สำเร็จ' });
  }
});

module.exports = router;
