const express = require('express');
const ExcelJS = require('exceljs');
const pool = require('../db/pool');
const { computeEligibility } = require('../utils/eligibility');
const { resolvePlan } = require('../utils/plan');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();

const POLICY_NO = process.env.POLICY_NO || '14048-108-260003193';
const COMPANY_NAME = process.env.INSURER_COMPANY_NAME || 'บริษัท เมกะคลินิค จำกัด';
const BROKER_LINE1 = 'บริษัท ซันเดย์ อินส์ จำกัด Sunday Ins Co,. Ltd.  Broker license no: ว00007/2561  **รับประกันโดย บริษัท ซันเดย์ ประกันภัย (ประเทศไทย) จำกัด ( มหาชน )/ Insure BY Sunday Insurance ( Thailand )';
const BROKER_LINE2 = 'Customer Service : 02-026-3355';
const BROKER_LINE3 = 'E-mail : ebservice@easysunday.com';

const HEADER_EN = ['No', 'Add in', 'Change Plan', 'Delete', 'Effective Date', 'firstName', 'lastName', 'sex', 'nationality', 'maritalStatus', 'dateOfBirth', 'identificationNumber', 'email', 'position', 'phoneNumber', 'employeeNumber', 'tierName', 'bankName', 'bankAccountName', 'bankAccountNumber', 'remark'];
const HEADER_TH = ['ลำดับ', 'แจ้งเข้า', 'เปลี่ยนแปลงแผน', 'แจ้งออก', 'วันที่มีผลบังคับ', 'ชื่อ', 'นามสกุล', 'เพศ', 'สัญชาติ', 'สถานะภาพ', 'วว/ดด/คศ', 'หมายเลข ปชช', 'อีเมล์', 'ตำแหน่ง', 'เบอร์โทร', 'หมายเลขพนักงาน', 'ระดับ', 'ธนาคาร', 'หมายเลขบัญชี', 'ชื่อบัญชีธนาคาร', 'หมายเหตุ'];
const COL_WIDTHS = [5, 9, 9, 9, 13, 14, 16, 6, 9, 10, 12, 16, 24, 22, 12, 12, 9, 18, 20, 15, 14];

function sexOf(titleTh) {
  return titleTh === 'นาย' ? 'ช' : 'ญ';
}

function planCode(plan) {
  const n = parseInt(plan, 10);
  if (!n || isNaN(n)) return null;
  return String(n).padStart(3, '0');
}

function fmtDateTH(d) {
  if (!d) return '';
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
}

function writeHeaderBlock(ws, dateLabel) {
  ws.getCell('S1').value = 'วันที่/Date :';
  ws.getCell('T1').value = dateLabel;
  ws.getCell('S2').value = 'หมายเลขกรมธรรม์ /Policy no :';
  ws.getCell('T2').value = POLICY_NO;
  ws.getCell('R3').value = 'ชื่อบริษัท/Company name : ';
  ws.getCell('S3').value = COMPANY_NAME;
  ws.getCell('A4').value = BROKER_LINE1;
  ws.getCell('A5').value = BROKER_LINE2;
  ws.getCell('A6').value = BROKER_LINE3;
  ws.getCell('F8').value = 'แบบฟอร์มรายงานการแจ้งเข้า / แจ้งออก และโอนย้ายเปลี่ยนแปลงสมาชิก';
  ws.getCell('F8').font = { bold: true };
  ws.getCell('F9').value = 'Addjustment / Deletion/ Transfer / Upgrade Member ';
  const headEn = ws.getRow(10);
  headEn.values = HEADER_EN;
  headEn.font = { bold: true };
  const headTh = ws.getRow(11);
  headTh.values = HEADER_TH;
  headTh.font = { bold: true };
  ws.columns = COL_WIDTHS.map((w) => ({ width: w }));
}

function addEnrollRow(ws, rowIdx, no, emp, remark) {
  const row = ws.getRow(rowIdx);
  row.values = [
    no, 'x', null, null, fmtDateTH(new Date()),
    emp.first_th, emp.last_th, sexOf(emp.title_th), 'ไทย', null,
    fmtDateTH(emp.birthdate), emp.id_card, emp.email, emp.position, emp.phone,
    emp.emp_id, planCode(resolvePlan(emp)), emp.bank_name || null, null, emp.bank_account || null, remark,
  ];
}

function addExitRow(ws, rowIdx, no, emp, remark) {
  const row = ws.getRow(rowIdx);
  row.values = [
    no, null, null, 'x', fmtDateTH(emp.resign_eff || emp.resign_last_working),
    emp.first_th, emp.last_th, sexOf(emp.title_th), 'ไทย', null,
    fmtDateTH(emp.birthdate), emp.id_card, emp.email, emp.position, emp.phone,
    emp.emp_id, planCode(resolvePlan(emp)), emp.bank_name || null, null, emp.bank_account || null, remark,
  ];
}

function addRelativeRow(ws, rowIdx, no, emp, rel, remark) {
  const row = ws.getRow(rowIdx);
  row.values = [
    no, 'x', null, null, fmtDateTH(new Date()),
    rel.first_name, rel.last_name, rel.title === 'นาย' ? 'ช' : 'ญ', rel.nationality || 'ไทย', null,
    fmtDateTH(rel.birthdate), rel.id_card, null, `ญาติ - ${emp.first_th} ${emp.last_th}`, rel.phone,
    emp.emp_id, '001', rel.bank_name || null, null, rel.bank_account || null, remark,
  ];
}

// Build eligibility snapshots for every employee (small dataset, fine in memory)
async function loadCandidates() {
  const empRes = await pool.query('SELECT * FROM employees');
  const relRes = await pool.query('SELECT * FROM relatives');
  const relByEmp = new Map(relRes.rows.map((r) => [r.emp_id, r]));
  const today = new Date();

  const enroll = [];
  const exit = [];
  const relatives = [];

  for (const emp of empRes.rows) {
    const elig = computeEligibility(emp, today);
    if (elig.needsEnrollNotice) enroll.push({ emp, elig });
    if (elig.needsExitNotice) exit.push({ emp, elig });
    const rel = relByEmp.get(emp.emp_id);
    if (elig.canAddRelative && rel && !rel.notify_in_done) {
      relatives.push({ emp, elig, rel });
    }
  }
  return { enroll, exit, relatives };
}

router.get('/preview', requireAdmin, async (req, res) => {
  try {
    const { enroll, exit, relatives } = await loadCandidates();
    const fmt = ({ emp, elig }) => ({
      empId: emp.emp_id,
      name: `${emp.title_th || ''}${emp.first_th || ''} ${emp.last_th || ''}`.trim(),
      department: emp.department,
      missingBank: !emp.bank_account || !emp.bank_name,
      ...elig,
    });
    res.json({
      enroll: enroll.map(fmt),
      exit: exit.map(fmt),
      relatives: relatives.map(({ emp, elig, rel }) => ({
        ...fmt({ emp, elig }),
        relativeName: `${rel.first_name} ${rel.last_name}`,
        relativeMissingBank: !rel.bank_account || !rel.bank_name,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดรายการไม่สำเร็จ' });
  }
});

// Generates the ready-to-send workbook AND records a draft batch (so it can
// be confirmed later). Nothing is marked "sent" until /confirm is called.
router.post('/generate', requireAdmin, async (req, res) => {
  const { enrollEmpIds = [], exitEmpIds = [], relativeEmpIds = [] } = req.body || {};
  const client = await pool.connect();
  try {
    const { enroll, exit, relatives } = await loadCandidates();
    const enrollSelected = enroll.filter((r) => enrollEmpIds.includes(r.emp.emp_id));
    const exitSelected = exit.filter((r) => exitEmpIds.includes(r.emp.emp_id));
    const relativeSelected = relatives.filter((r) => relativeEmpIds.includes(r.emp.emp_id));

    if (!enrollSelected.length && !exitSelected.length && !relativeSelected.length) {
      return res.status(400).json({ error: 'ไม่มีรายการที่เลือกไว้สำหรับสร้างไฟล์' });
    }

    await client.query('BEGIN');
    const batchRes = await client.query(
      `INSERT INTO notification_batches (batch_type, created_by) VALUES ($1, $2) RETURNING *`,
      [[enrollSelected.length && 'enroll', exitSelected.length && 'exit', relativeSelected.length && 'relative'].filter(Boolean).join('+'),
       req.session.adminUser.username]
    );
    const batch = batchRes.rows[0];

    for (const { emp } of enrollSelected) {
      await client.query(
        `INSERT INTO notification_batch_items (batch_id, emp_id, item_type) VALUES ($1,$2,'employee_enroll')`,
        [batch.id, emp.emp_id]
      );
    }
    for (const { emp } of exitSelected) {
      await client.query(
        `INSERT INTO notification_batch_items (batch_id, emp_id, item_type) VALUES ($1,$2,'employee_exit')`,
        [batch.id, emp.emp_id]
      );
    }
    for (const { emp, rel } of relativeSelected) {
      await client.query(
        `INSERT INTO notification_batch_items (batch_id, emp_id, relative_id, item_type) VALUES ($1,$2,$3,'relative_enroll')`,
        [batch.id, emp.emp_id, rel.id]
      );
    }
    await client.query('COMMIT');

    const workbook = buildWorkbook({ enrollSelected, exitSelected, relativeSelected, batchDate: batch.batch_date });
    const buf = await workbook.xlsx.writeBuffer();

    const dateLabel = new Date().toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="batch-${batch.id}-${dateLabel}.xlsx"`);
    res.setHeader('X-Batch-Id', String(batch.id));
    res.send(Buffer.from(buf));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'สร้างไฟล์ไม่สำเร็จ' });
  } finally {
    client.release();
  }
});

function sheetSafeDateLabel(d) {
  // Excel worksheet names can't contain / \ : * ? [ ] — use dots instead,
  // matching the original manual template's "27.8.69" style naming.
  const dt = new Date(d);
  const buddhistYear2 = String((dt.getFullYear() + 543) % 100).padStart(2, '0');
  return `${dt.getDate()}.${dt.getMonth() + 1}.${buddhistYear2}`;
}

function buildWorkbook({ enrollSelected, exitSelected, relativeSelected, batchDate }) {
  const workbook = new ExcelJS.Workbook();
  const dateLabel = new Date(batchDate).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const sheetDateLabel = sheetSafeDateLabel(batchDate);

  const cover = workbook.addWorksheet('อ่านก่อนส่ง');
  cover.getColumn(1).width = 100;
  const total = enrollSelected.length + exitSelected.length + relativeSelected.length;
  cover.addRow([`สรุปรายการที่พร้อมส่งให้บริษัทประกัน — สร้างเมื่อ ${dateLabel} — รวม ${total} รายการ`]);
  cover.addRow([]);
  if (enrollSelected.length) cover.addRow([`แจ้งเข้า ${enrollSelected.length} คน: ${enrollSelected.map((r) => `${r.emp.first_th} ${r.emp.last_th}`).join(', ')}`]);
  if (exitSelected.length) cover.addRow([`แจ้งออก ${exitSelected.length} คน: ${exitSelected.map((r) => `${r.emp.first_th} ${r.emp.last_th}`).join(', ')}`]);
  if (relativeSelected.length) cover.addRow([`แจ้งเพิ่มญาติ ${relativeSelected.length} คน: ${relativeSelected.map((r) => `${r.rel.first_name} ${r.rel.last_name} (ญาติของ ${r.emp.first_th} ${r.emp.last_th})`).join(', ')}`]);
  cover.addRow([]);
  cover.addRow(['กรุณาตรวจทานอีกครั้งก่อนส่ง โดยเฉพาะรายการที่ระบุว่าข้อมูลธนาคารไม่ครบ']);

  if (enrollSelected.length || relativeSelected.length) {
    const ws = workbook.addWorksheet(`แจ้งเข้า ${sheetDateLabel}`);
    writeHeaderBlock(ws, dateLabel);
    let rowIdx = 12;
    let no = 1;
    for (const { emp, elig } of enrollSelected) {
      const remark = `อายุงานครบ 4 เดือน (เริ่มงาน ${fmtDateTH(emp.start_date)})${!emp.bank_account ? ' — ต้องกรอกข้อมูลธนาคารเพิ่มก่อนส่ง' : ''}`;
      addEnrollRow(ws, rowIdx++, no++, emp, remark);
    }
    for (const { emp, rel } of relativeSelected) {
      const remark = `เพิ่มญาติในประกัน (อายุงานครบ 6 เดือน)${!rel.bank_account ? ' — ต้องกรอกข้อมูลธนาคารเพิ่มก่อนส่ง' : ''}`;
      addRelativeRow(ws, rowIdx++, no++, emp, rel, remark);
    }
  }

  if (exitSelected.length) {
    const ws = workbook.addWorksheet(`แจ้งออก ${sheetDateLabel}`);
    writeHeaderBlock(ws, dateLabel);
    let rowIdx = 12;
    let no = 1;
    for (const { emp } of exitSelected) {
      const remark = `ลาออก (Last working ${fmtDateTH(emp.resign_last_working)})${!emp.bank_account ? ' — ไม่มีข้อมูลธนาคาร' : ''}`;
      addExitRow(ws, rowIdx++, no++, emp, remark);
    }
  }

  return workbook;
}

// Confirm a batch = HR has actually emailed/sent it to the insurer.
// This is the only action that flips notify_in/notify_out flags, so a
// generated-but-unsent file can never silently look "already handled".
router.post('/:batchId/confirm', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const batchRes = await client.query('SELECT * FROM notification_batches WHERE id = $1 FOR UPDATE', [req.params.batchId]);
    const batch = batchRes.rows[0];
    if (!batch) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'ไม่พบชุดข้อมูลนี้' });
    }
    if (batch.status === 'sent') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'ชุดนี้ถูกยืนยันว่าส่งแล้วก่อนหน้านี้' });
    }

    const itemsRes = await client.query('SELECT * FROM notification_batch_items WHERE batch_id = $1', [batch.id]);
    for (const item of itemsRes.rows) {
      if (item.item_type === 'employee_enroll') {
        await client.query(`UPDATE employees SET notify_in = TRUE, notified_in_done = now(), updated_at = now() WHERE emp_id = $1`, [item.emp_id]);
      } else if (item.item_type === 'employee_exit') {
        await client.query(`UPDATE employees SET notify_out = TRUE, notified_out_done = now(), updated_at = now() WHERE emp_id = $1`, [item.emp_id]);
      } else if (item.item_type === 'relative_enroll' && item.relative_id) {
        await client.query(`UPDATE relatives SET notify_in_done = now() WHERE id = $1`, [item.relative_id]);
      }
    }
    await client.query(`UPDATE notification_batches SET status = 'sent', sent_at = now() WHERE id = $1`, [batch.id]);
    await client.query(
      `INSERT INTO activity_log (actor, action, detail) VALUES ($1, 'batch_confirmed', $2)`,
      [req.session.adminUser.username, JSON.stringify({ batchId: batch.id, itemCount: itemsRes.rowCount })]
    );
    await client.query('COMMIT');
    res.json({ ok: true, batchId: batch.id, itemCount: itemsRes.rowCount });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'ยืนยันการส่งไม่สำเร็จ' });
  } finally {
    client.release();
  }
});

router.get('/batches', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*, COUNT(i.id) AS item_count FROM notification_batches b
       LEFT JOIN notification_batch_items i ON i.batch_id = b.id
       GROUP BY b.id ORDER BY b.created_at DESC LIMIT 50`
    );
    res.json({ batches: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดประวัติไม่สำเร็จ' });
  }
});

module.exports = router;
