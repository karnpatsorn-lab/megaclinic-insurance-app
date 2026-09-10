// Consolidated "งานที่ต้องทำ" (Things To Do) view — merges every category of
// pending work (needs-enroll, needs-exit, needs-relative-reminder, pending
// self-service requests) into one prioritized, per-person list. Built per
// Nan's request for something easier to scan than the old scattered table:
// "เป็นกล่องเด้งมาว่าคนนี้แจ้งยังๆๆๆ" — one box per person, listing exactly
// what's outstanding for them.
const express = require('express');
const pool = require('../db/pool');
const { computeEligibility } = require('../utils/eligibility');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();

const TASK_LABELS = {
  exit: 'ต้องแจ้งออกประกัน',
  enroll: 'ต้องแจ้งเข้าประกัน (ครบ 4 เดือน)',
  relative: 'ครบ 6 เดือน ยังไม่แจ้งญาติ',
  request_profile: 'คำขอแก้ไขข้อมูลส่วนตัว รอตรวจสอบ',
  request_family: 'คำขอแก้ไขรายชื่อญาติ (ลากิจ) รอตรวจสอบ',
};

// Lower number = shown first / more urgent.
const TASK_PRIORITY = { exit: 1, enroll: 2, request_profile: 3, request_family: 3, relative: 4 };

router.get('/', requireAdmin, async (req, res) => {
  try {
    const empRes = await pool.query('SELECT * FROM employees');
    const relRes = await pool.query('SELECT emp_id FROM relatives');
    const relSet = new Set(relRes.rows.map((r) => r.emp_id));
    const reqRes = await pool.query(
      `SELECT r.*, e.first_th, e.last_th, e.nickname AS current_nickname, e.department
       FROM self_service_requests r
       JOIN employees e ON e.emp_id = r.emp_id
       WHERE r.status = 'pending'
       ORDER BY r.created_at ASC`
    );

    const today = new Date();
    const peopleMap = new Map();

    function ensurePerson(empId, seed) {
      if (!peopleMap.has(empId)) {
        peopleMap.set(empId, { empId, tasks: [], ...seed });
      }
      return peopleMap.get(empId);
    }

    for (const emp of empRes.rows) {
      const elig = computeEligibility(emp, today);
      const seed = {
        name: `${emp.title_th || ''}${emp.first_th || ''} ${emp.last_th || ''}`.trim(),
        nickname: emp.nickname,
        department: emp.department,
      };

      if (elig.needsExitNotice) {
        ensurePerson(emp.emp_id, seed).tasks.push({
          type: 'exit',
          label: TASK_LABELS.exit,
          detail: `ลาออกมีผล ${elig.resignEff || '-'}`,
          action: { kind: 'acknowledge', field: 'notify_out', empId: emp.emp_id },
        });
      }
      if (elig.needsEnrollNotice) {
        ensurePerson(emp.emp_id, seed).tasks.push({
          type: 'enroll',
          label: TASK_LABELS.enroll,
          detail: `ครบ 4 เดือนเมื่อ ${elig.eligible4mDate || '-'}`,
          action: { kind: 'acknowledge', field: 'notify_in', empId: emp.emp_id },
        });
      }
      if (elig.canAddRelative && !relSet.has(emp.emp_id)) {
        ensurePerson(emp.emp_id, seed).tasks.push({
          type: 'relative',
          label: TASK_LABELS.relative,
          detail: `ครบ 6 เดือนเมื่อ ${elig.eligible6mDate || '-'} — รอพนักงานแจ้งข้อมูลญาติเอง`,
          action: null,
        });
      }
    }

    for (const r of reqRes.rows) {
      const type = r.kind === 'profile' ? 'request_profile' : 'request_family';
      const person = ensurePerson(r.emp_id, {
        name: `${r.first_th || ''} ${r.last_th || ''}`.trim(),
        nickname: r.current_nickname,
        department: r.department,
      });
      person.tasks.push({
        type,
        label: TASK_LABELS[type],
        detail:
          r.kind === 'profile'
            ? Object.keys(r.payload || {}).length + ' ช่องข้อมูลที่ขอแก้ไข'
            : `เสนอรายชื่อญาติ ${(r.payload.members || []).length} คน`,
        requestId: r.id,
        kind: r.kind,
        payload: r.payload,
        createdAt: r.created_at,
        action: { kind: 'review_request', requestId: r.id },
      });
    }

    const people = Array.from(peopleMap.values()).map((p) => {
      p.tasks.sort((a, b) => TASK_PRIORITY[a.type] - TASK_PRIORITY[b.type]);
      p.topPriority = Math.min(...p.tasks.map((t) => TASK_PRIORITY[t.type]));
      return p;
    });
    people.sort((a, b) => a.topPriority - b.topPriority || a.empId.localeCompare(b.empId));

    const counts = { exit: 0, enroll: 0, relative: 0, request_profile: 0, request_family: 0 };
    for (const p of people) {
      for (const t of p.tasks) counts[t.type] = (counts[t.type] || 0) + 1;
    }
    const totalTasks = Object.values(counts).reduce((a, b) => a + b, 0);

    res.json({
      asOf: today.toISOString().slice(0, 10),
      people,
      counts,
      totalTasks,
      totalPeople: people.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดงานที่ต้องทำไม่สำเร็จ' });
  }
});

module.exports = router;
