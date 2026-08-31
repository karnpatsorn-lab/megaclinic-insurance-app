const express = require('express');
const pool = require('../db/pool');
const { computeEligibility } = require('../utils/eligibility');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();

router.get('/', requireAdmin, async (req, res) => {
  try {
    const empRes = await pool.query('SELECT * FROM employees');
    const relRes = await pool.query('SELECT emp_id FROM relatives');
    const relSet = new Set(relRes.rows.map((r) => r.emp_id));

    const today = new Date();
    let needsEnroll = [];
    let needsExit = [];
    let needsRelativeReminder = [];
    let upcoming4m = [];
    let upcoming6m = [];

    for (const emp of empRes.rows) {
      const elig = computeEligibility(emp, today);
      if (elig.needsEnrollNotice) needsEnroll.push({ emp, elig });
      if (elig.needsExitNotice) needsExit.push({ emp, elig });
      if (elig.canAddRelative && !relSet.has(emp.emp_id)) {
        needsRelativeReminder.push({ emp, elig });
      }
      if (!elig.isResigned && elig.daysUntil4m !== null && elig.daysUntil4m > 0 && elig.daysUntil4m <= 30) {
        upcoming4m.push({ emp, elig });
      }
      if (!elig.isResigned && elig.daysUntil6m !== null && elig.daysUntil6m > 0 && elig.daysUntil6m <= 30) {
        upcoming6m.push({ emp, elig });
      }
    }

    const activeCount = empRes.rows.filter((e) => e.status === 'ON').length;

    res.json({
      asOf: today.toISOString().slice(0, 10),
      kpi: {
        totalActive: activeCount,
        needsEnrollCount: needsEnroll.length,
        needsExitCount: needsExit.length,
        needsRelativeReminderCount: needsRelativeReminder.length,
        upcoming4mCount: upcoming4m.length,
        upcoming6mCount: upcoming6m.length,
      },
      needsEnroll: needsEnroll.map(fmt),
      needsExit: needsExit.map(fmt),
      needsRelativeReminder: needsRelativeReminder.map(fmt),
      upcoming4m: upcoming4m.map(fmt),
      upcoming6m: upcoming6m.map(fmt),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดข้อมูลแดชบอร์ดไม่สำเร็จ' });
  }
});

function fmt({ emp, elig }) {
  return {
    empId: emp.emp_id,
    name: `${emp.title_th || ''}${emp.first_th || ''} ${emp.last_th || ''}`.trim(),
    nickname: emp.nickname,
    department: emp.department,
    position: emp.position,
    plan: emp.plan,
    ...elig,
  };
}

module.exports = router;
