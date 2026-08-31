const root = document.getElementById('step-root');
let state = { token: null, employee: null, eligibility: null, existingRelative: null };

function setDot(n) {
  [1, 2, 3].forEach((i) => document.getElementById(`dot-${i}`).classList.toggle('active', i <= n));
}

function renderStep1(errorMsg) {
  setDot(1);
  root.innerHTML = `
    <p class="muted">กรอกรหัสพนักงานและเลขบัตรประชาชน 4 ตัวท้าย เพื่อยืนยันตัวตน</p>
    <form id="verify-form">
      <div class="field">
        <label>รหัสพนักงาน</label>
        <input type="text" id="emp-id" required>
      </div>
      <div class="field">
        <label>เลขบัตรประชาชน 4 ตัวท้าย</label>
        <input type="text" id="id-last4" maxlength="4" pattern="[0-9]{4}" required>
      </div>
      <button class="btn btn-brand" type="submit" style="width:100%;">ยืนยันตัวตน</button>
      ${errorMsg ? `<div class="error-text">${errorMsg}</div>` : ''}
    </form>
  `;
  document.getElementById('verify-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const empId = document.getElementById('emp-id').value.trim();
    const idLast4 = document.getElementById('id-last4').value.trim();
    try {
      const res = await fetch('/api/self-service/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empId, idLast4 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      state = { ...state, ...data };
      renderStep2();
    } catch (err) {
      renderStep1(err.message);
    }
  });
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'long', year: 'numeric' });
}

function renderStep2() {
  setDot(2);
  const { employee, eligibility, existingRelative } = state;

  if (eligibility.isResigned) {
    root.innerHTML = `
      <div class="card" style="box-shadow:none;padding:0;">
        <p>สวัสดีคุณ <strong>${employee.name}</strong></p>
        <p class="muted">ระบบพบว่าท่านได้พ้นสภาพพนักงานแล้ว จึงไม่สามารถแจ้งข้อมูลญาติเข้าประกันได้ หากคิดว่าข้อมูลนี้ไม่ถูกต้อง กรุณาติดต่อฝ่ายบุคคล</p>
      </div>
    `;
    return;
  }

  if (!eligibility.canAddRelative) {
    root.innerHTML = `
      <div class="card" style="box-shadow:none;padding:0;">
        <p>สวัสดีคุณ <strong>${employee.name}</strong> 👋</p>
        <p>ท่านจะสามารถเพิ่มญาติ 1 คนเข้าประกันกลุ่มได้ เมื่ออายุงานครบ 6 เดือน</p>
        <div class="milestone-card" style="margin-top:12px;">
          <div class="badge-time">ครบ 6 เดือน</div>
          <div class="date">${fmtDate(eligibility.eligible6mDate)}</div>
          <div class="desc">อีก ${eligibility.daysUntil6m ?? '-'} วัน</div>
        </div>
        <p class="muted" style="margin-top:16px;">กรุณากลับมาแจ้งอีกครั้งเมื่อถึงวันดังกล่าว</p>
      </div>
    `;
    return;
  }

  const r = existingRelative || {};
  root.innerHTML = `
    <p>สวัสดีคุณ <strong>${employee.name}</strong> — ยินดีด้วย! ท่านครบอายุงาน 6 เดือนแล้ว 🎉</p>
    ${existingRelative ? '<p class="muted">ท่านเคยแจ้งข้อมูลญาติไว้แล้ว สามารถแก้ไขข้อมูลด้านล่างได้</p>' : '<p class="muted">กรอกข้อมูลญาติ 1 ท่านที่ต้องการเพิ่มในประกันกลุ่ม</p>'}
    <form id="relative-form">
      <div class="field-row">
        <div class="field">
          <label>คำนำหน้า</label>
          <select id="r-title">
            <option value="นาย" ${r.title === 'นาย' ? 'selected' : ''}>นาย</option>
            <option value="นาง" ${r.title === 'นาง' ? 'selected' : ''}>นาง</option>
            <option value="นางสาว" ${r.title === 'นางสาว' || !r.title ? 'selected' : ''}>นางสาว</option>
          </select>
        </div>
        <div class="field">
          <label>ความสัมพันธ์</label>
          <select id="r-relation">
            ${['คู่สมรส', 'บุตร', 'บิดา', 'มารดา'].map((x) => `<option ${r.relation === x ? 'selected' : ''}>${x}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>ชื่อญาติ</label><input type="text" id="r-first" value="${r.first_name || ''}" required></div>
        <div class="field"><label>นามสกุลญาติ</label><input type="text" id="r-last" value="${r.last_name || ''}" required></div>
      </div>
      <div class="field-row">
        <div class="field"><label>เลขบัตรประชาชน</label><input type="text" id="r-idcard" value="${r.id_card || ''}"></div>
        <div class="field"><label>สัญชาติ</label><input type="text" id="r-nationality" value="${r.nationality || 'ไทย'}"></div>
      </div>
      <div class="field"><label>วันเกิด</label><input type="date" id="r-birthdate" value="${r.birthdate ? String(r.birthdate).slice(0,10) : ''}"></div>
      <div class="field-row">
        <div class="field"><label>ธนาคาร</label><input type="text" id="r-bankname" value="${r.bank_name || ''}"></div>
        <div class="field"><label>เลขบัญชี</label><input type="text" id="r-bankaccount" value="${r.bank_account || ''}"></div>
      </div>
      <div class="field"><label>เบอร์โทรญาติ</label><input type="text" id="r-phone" value="${r.phone || ''}"></div>
      <button class="btn btn-brand" type="submit" style="width:100%;">บันทึกข้อมูลญาติ</button>
      <div class="error-text" id="rel-error"></div>
    </form>
  `;

  document.getElementById('relative-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const relative = {
      title: document.getElementById('r-title').value,
      relation: document.getElementById('r-relation').value,
      firstName: document.getElementById('r-first').value.trim(),
      lastName: document.getElementById('r-last').value.trim(),
      idCard: document.getElementById('r-idcard').value.trim(),
      nationality: document.getElementById('r-nationality').value.trim() || 'ไทย',
      birthdate: document.getElementById('r-birthdate').value || null,
      bankName: document.getElementById('r-bankname').value.trim(),
      bankAccount: document.getElementById('r-bankaccount').value.trim(),
      phone: document.getElementById('r-phone').value.trim(),
    };
    try {
      const res = await fetch('/api/self-service/relative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empId: state.employee.empId, token: state.token, relative }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      renderStep3();
    } catch (err) {
      document.getElementById('rel-error').textContent = err.message;
    }
  });
}

function renderStep3() {
  setDot(3);
  root.innerHTML = `
    <div class="success-box">
      บันทึกข้อมูลญาติเรียบร้อยแล้ว ✓<br>
      <span style="font-weight:400;">ฝ่ายบุคคลจะดำเนินการแจ้งบริษัทประกันให้ท่านต่อไป</span>
    </div>
    <p class="muted" style="margin-top:16px;">หากต้องการแก้ไขข้อมูล สามารถกลับเข้ามาแจ้งใหม่ได้ทุกเมื่อ</p>
  `;
}

renderStep1();
