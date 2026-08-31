const express = require('express');
const pool = require('../db/pool');
const { computeEligibility } = require('../utils/eligibility');
const verifyToken = require('../utils/verifyToken');

const router = express.Router();

function last4(idCard) {
  if (!idCard) return '';
  const digits = String(idCard).replace(/\D/g, '');
  return digits.slice(-4);
}

// A national ID's last 4 digits is only 10,000 combinations, so without any
// throttling someone who knows (or guesses) a coworker's emp_id could brute
// force it. This is a lightweight in-memory limiter — good enough for a
// single-instance internal tool for ~300 staff, not a public API.
const attempts = new Map(); // key `${ip}:${empId}` -> { count, resetAt }
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now > rec.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_ATTEMPTS;
}

// Step 1: identity check with emp_id + last 4 digits of national ID card.
// No account/password needed. Rate limiting is intentionally simple since
// the audience is a known ~300-person staff list, not the public internet.
router.post('/verify', async (req, res) => {
  const { empId, idLast4 } = req.body || {};
  if (!empId || !idLast4) {
    return res.status(400).json({ error: 'กรุณากรอกรหัสพนักงานและเลขบัตรประชาชน 4 ตัวท้าย' });
  }

  const limitKey = `${req.ip}:${String(empId).trim()}`;
  if (isRateLimited(limitKey)) {
    return res.status(429).json({ error: 'ลองยืนยันตัวตนบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่ หรือติดต่อฝ่ายบุคคล' });
  }

  try {
    const result = await pool.query('SELECT * FROM employees WHERE emp_id = $1', [String(empId).trim()]);
    const emp = result.rows[0];
    if (!emp || last4(emp.id_card) !== String(idLast4).trim()) {
      return res.status(401).json({ error: 'ไม่พบข้อมูล กรุณาตรวจสอบรหัสพนักงานและเลขบัตรประชาชนอีกครั้ง' });
    }

    const elig = computeEligibility(emp);
    const relRes = await pool.query('SELECT * FROM relatives WHERE emp_id = $1', [emp.emp_id]);

    res.json({
      token: verifyToken.sign(emp.emp_id),
      employee: {
        empId: emp.emp_id,
        name: `${emp.title_th || ''}${emp.first_th || ''} ${emp.last_th || ''}`.trim(),
        nickname: emp.nickname,
        department: emp.department,
        position: emp.position,
        startDate: emp.start_date,
        plan: emp.plan,
      },
      eligibility: elig,
      existingRelative: relRes.rows[0] || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ' });
  }
});

// Step 2: submit (or update) relative info. Requires the token from /verify.
router.post('/relative', async (req, res) => {
  const { empId, token, relative } = req.body || {};
  if (!empId || !token || !relative) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });
  }
  if (!verifyToken.verify(token, String(empId).trim())) {
    return res.status(401).json({ error: 'เซสชันหมดอายุ กรุณายืนยันตัวตนใหม่อีกครั้ง' });
  }

  const { firstName, lastName, idCard, nationality, relation, bankName, bankAccount, birthdate, phone } = relative;
  if (!firstName || !lastName) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อและนามสกุลญาติ' });
  }

  try {
    const empRes = await pool.query('SELECT * FROM employees WHERE emp_id = $1', [empId]);
    const emp = empRes.rows[0];
    if (!emp) return res.status(404).json({ error: 'ไม่พบข้อมูลพนักงาน' });

    const elig = computeEligibility(emp);
    if (!elig.canAddRelative) {
      return res.status(403).json({ error: 'ยังไม่ครบอายุงาน 6 เดือน จึงยังไม่สามารถเพิ่มญาติในประกันได้' });
    }

    const existing = await pool.query('SELECT id FROM relatives WHERE emp_id = $1', [empId]);
    let relRow;
    if (existing.rowCount > 0) {
      const upd = await pool.query(
        `UPDATE relatives SET title=$1, first_name=$2, last_name=$3, id_card=$4, nationality=$5, relation=$6,
           bank_name=$7, bank_account=$8, birthdate=$9, phone=$10, date_filed=CURRENT_DATE, updated_at=now()
         WHERE emp_id = $11 RETURNING *`,
        [relative.title || null, firstName, lastName, idCard || null, nationality || 'ไทย', relation || null,
         bankName || null, bankAccount || null, birthdate || null, phone || null, empId]
      );
      relRow = upd.rows[0];
      await pool.query(
        `INSERT INTO activity_log (emp_id, actor, action, detail) VALUES ($1, 'self_service', 'relative_updated', $2)`,
        [empId, JSON.stringify(relative)]
      );
    } else {
      const ins = await pool.query(
        `INSERT INTO relatives (emp_id, title, first_name, last_name, id_card, nationality, relation, bank_name, bank_account, birthdate, phone, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'self_service') RETURNING *`,
        [empId, relative.title || null, firstName, lastName, idCard || null, nationality || 'ไทย', relation || null,
         bankName || null, bankAccount || null, birthdate || null, phone || null]
      );
      relRow = ins.rows[0];
      await pool.query(
        `INSERT INTO activity_log (emp_id, actor, action, detail) VALUES ($1, 'self_service', 'relative_submitted', $2)`,
        [empId, JSON.stringify(relative)]
      );
    }

    res.json({ ok: true, relative: relRow });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'บันทึกข้อมูลไม่สำเร็จ' });
  }
});

module.exports = router;
