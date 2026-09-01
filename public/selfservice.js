const root = document.getElementById('step-root');
let state = { token: null, employee: null, eligibility: null, existingRelative: null, familyMembers: [], pendingRequests: [] };

function setDot(n) {
  [1, 2].forEach((i) => document.getElementById(`dot-${i}`).classList.toggle('active', i <= n));
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

function pendingBadge(kind) {
  const p = state.pendingRequests.find((r) => r.kind === kind);
  return p ? '<div class="muted" style="margin-top:6px;">⏳ ส่งคำขอไว้แล้วเมื่อ ' + fmtDate(p.created_at) + ' — รอฝ่ายบุคคลตรวจสอบ</div>' : '';
}

function renderStep2() {
  setDot(2);
  const { employee, eligibility } = state;

  if (eligibility.isResigned) {
    root.innerHTML = `
      <div class="card" style="box-shadow:none;padding:0;">
        <p>สวัสดีคุณ <strong>${employee.name}</strong></p>
        <p class="muted">ระบบพบว่าท่านได้พ้นสภาพพนักงานแล้ว จึงไม่สามารถแจ้ง/แก้ไขข้อมูลผ่านหน้านี้ได้ หากคิดว่าข้อมูลนี้ไม่ถูกต้อง กรุณาติดต่อฝ่ายบุคคล</p>
      </div>
    `;
    return;
  }

  root.innerHTML = `
    <p>สวัสดีคุณ <strong>${employee.name}</strong> 👋</p>

    <div class="card" style="box-shadow:none;padding:0;margin-top:20px;">
      <h3 style="margin-bottom:4px;">ข้อมูลส่วนตัว</h3>
      <p class="muted" style="margin-top:0;">แก้ไขแล้วฝ่ายบุคคลจะตรวจสอบก่อนบันทึกเข้าระบบ</p>
      <form id="profile-form">
        <div class="field-row">
          <div class="field"><label>ชื่อเล่น</label><input type="text" id="p-nickname" value="${employee.nickname || ''}"></div>
          <div class="field"><label>เบอร์โทรติดต่อ</label><input type="text" id="p-phone" value="${employee.phone || ''}"></div>
        </div>
        <div class="field"><label>ที่อยู่ปัจจุบัน</label><input type="text" id="p-address" value="${employee.currentAddress || ''}"></div>
        <div class="field"><label>อีเมลส่วนตัว (ที่ติดต่อได้)</label><input type="email" id="p-email" value="${employee.personalEmail || ''}"></div>
        <button class="btn btn-brand" type="submit" style="width:100%;">บันทึกข้อมูลส่วนตัว</button>
        <div class="error-text" id="profile-error"></div>
      </form>
      ${pendingBadge('profile')}
    </div>

    <div class="card" style="box-shadow:none;padding:0;margin-top:28px;">
      <h3 style="margin-bottom:4px;">รายชื่อญาติสำหรับลากิจ (สูงสุด 6 คน)</h3>
      <p class="muted" style="margin-top:0;">ใช้สำหรับกรณีลากิจฉุกเฉิน ไม่เกี่ยวกับสิทธิ์ประกันกลุ่ม</p>
      <div id="family-rows"></div>
      <button type="button" class="btn btn-ghost" id="add-family-row" style="margin-top:8px;">+ เพิ่มรายชื่อ</button>
      <button class="btn btn-brand" id="save-family-btn" type="button" style="width:100%;margin-top:12px;">บันทึกรายชื่อญาติ</button>
      <div class="error-text" id="family-error"></div>
      ${pendingBadge('family_members')}
    </div>

    <div class="card" style="box-shadow:none;padding:0;margin-top:28px;" id="relative-section"></div>
  `;

  wireProfileForm();
  wireFamilyRows();
  renderRelativeSection();
}

function wireProfileForm() {
  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const profile = {
      nickname: document.getElementById('p-nickname').value.trim(),
      phone: document.getElementById('p-phone').value.trim(),
      currentAddress: document.getElementById('p-address').value.trim(),
      personalEmail: document.getElementById('p-email').value.trim(),
    };
    try {
      const res = await fetch('/api/self-service/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empId: state.employee.empId, token: state.token, profile }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      document.getElementById('profile-error').textContent = '';
      document.getElementById('profile-error').style.color = 'green';
      document.getElementById('profile-error').textContent = 'ส่งคำขอแก้ไขแล้ว รอฝ่ายบุคคลตรวจสอบ ✓';
    } catch (err) {
      document.getElementById('profile-error').textContent = err.message;
    }
  });
}

let familyRowCount = 0;

function familyRowHtml(m = {}) {
  const idx = familyRowCount++;
  return `
    <div class="field-row family-row" data-idx="${idx}" style="align-items:flex-end;">
      <div class="field"><label>ชื่อ</label><input type="text" class="f-first" value="${m.first_name || ''}"></div>
      <div class="field"><label>นามสกุล</label><input type="text" class="f-last" value="${m.last_name || ''}"></div>
      <div class="field"><label>ความสัมพันธ์</label>
        <select class="f-relation">
          ${['บิดา', 'มารดา', 'คู่สมรส', 'บุตร', 'พี่น้อง', 'อื่นๆ'].map((x) => `<option ${m.relation === x ? 'selected' : ''}>${x}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>เบอร์โทร</label><input type="text" class="f-phone" value="${m.phone || ''}"></div>
      <button type="button" class="btn btn-ghost remove-family-row" title="ลบ">✕</button>
    </div>
  `;
}

function wireFamilyRows() {
  const container = document.getElementById('family-rows');
  const existing = state.familyMembers && state.familyMembers.length ? state.familyMembers : [{}];
  familyRowCount = 0;
  container.innerHTML = existing.slice(0, 6).map(familyRowHtml).join('');

  container.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-family-row')) {
      e.target.closest('.family-row').remove();
    }
  });

  document.getElementById('add-family-row').addEventListener('click', () => {
    if (container.querySelectorAll('.family-row').length >= 6) {
      document.getElementById('family-error').textContent = 'กรอกญาติได้สูงสุด 6 คน';
      return;
    }
    container.insertAdjacentHTML('beforeend', familyRowHtml());
  });

  document.getElementById('save-family-btn').addEventListener('click', async () => {
    const rows = Array.from(container.querySelectorAll('.family-row')).map((row) => ({
      firstName: row.querySelector('.f-first').value.trim(),
      lastName: row.querySelector('.f-last').value.trim(),
      relation: row.querySelector('.f-relation').value,
      phone: row.querySelector('.f-phone').value.trim(),
    })).filter((m) => m.firstName && m.lastName);

    if (!rows.length) {
      document.getElementById('family-error').textContent = 'กรุณากรอกชื่อ-นามสกุลอย่างน้อย 1 คน';
      return;
    }
    try {
      const res = await fetch('/api/self-service/family-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empId: state.employee.empId, token: state.token, members: rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const errEl = document.getElementById('family-error');
      errEl.style.color = 'green';
      errEl.textContent = 'ส่งคำขอแก้ไขแล้ว รอฝ่ายบุคคลตรวจสอบ ✓';
    } catch (err) {
      document.getElementById('family-error').textContent = err.message;
    }
  });
}

function renderRelativeSection() {
  const { eligibility, existingRelative } = state;
  const sectionEl = document.getElementById('relative-section');

  if (!eligibility.canAddRelative) {
    sectionEl.innerHTML = `
      <h3 style="margin-bottom:4px;">แจ้งญาติเข้าประกันกลุ่ม</h3>
      <p>ท่านจะสามารถเพิ่มญาติ 1 คนเข้าประกันกลุ่มได้ เมื่ออายุงานครบ 6 เดือน</p>
      <div class="milestone-card" style="margin-top:12px;">
        <div class="badge-time">ครบ 6 เดือน</div>
        <div class="date">${fmtDate(eligibility.eligible6mDate)}</div>
        <div class="desc">อีก ${eligibility.daysUntil6m ?? '-'} วัน</div>
      </div>
      <p class="muted" style="margin-top:16px;">กรุณากลับมาแจ้งอีกครั้งเมื่อถึงวันดังกล่าว</p>
    `;
    return;
  }

  const r = existingRelative || {};
  sectionEl.innerHTML = `
    <h3 style="margin-bottom:4px;">แจ้งญาติเข้าประกันกลุ่ม</h3>
    <p class="muted" style="margin-top:0;">ยินดีด้วย! ท่านครบอายุงาน 6 เดือนแล้ว 🎉 ${existingRelative ? 'ท่านเคยแจ้งข้อมูลไว้แล้ว สามารถแก้ไขด้านล่างได้ (มีผลทันที)' : 'กรอกข้อมูลญาติ 1 ท่านที่ต้องการเพิ่มในประกันกลุ่ม'}</p>
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
        <div class="field"><label>ชื่อเล่นญาติ</label><input type="text" id="r-nickname" value="${r.nickname || ''}"></div>
        <div class="field"><label>สัญชาติ</label><input type="text" id="r-nationality" value="${r.nationality || 'ไทย'}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>ชื่อญาติ</label><input type="text" id="r-first" value="${r.first_name || ''}" required></div>
        <div class="field"><label>นามสกุลญาติ</label><input type="text" id="r-last" value="${r.last_name || ''}" required></div>
      </div>
      <div class="field-row">
        <div class="field"><label>เลขบัตรประชาชน</label><input type="text" id="r-idcard" value="${r.id_card || ''}"></div>
        <div class="field"><label>วันเกิด</label><input type="date" id="r-birthdate" value="${r.birthdate ? String(r.birthdate).slice(0,10) : ''}"></div>
      </div>
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
      nickname: document.getElementById('r-nickname').value.trim(),
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
      const errEl = document.getElementById('rel-error');
      errEl.style.color = 'green';
      errEl.textContent = 'บันทึกข้อมูลญาติเรียบร้อยแล้ว ✓ ฝ่ายบุคคลจะดำเนินการแจ้งบริษัทประกันให้ท่านต่อไป';
    } catch (err) {
      document.getElementById('rel-error').textContent = err.message;
    }
  });
}

renderStep1();
