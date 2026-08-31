const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
  return data;
}

function showLogin() {
  $('#login-screen').style.display = 'flex';
  $('#app-shell').style.display = 'none';
}

function showApp(user) {
  $('#login-screen').style.display = 'none';
  $('#app-shell').style.display = 'flex';
  $('#whoami').textContent = `👤 ${user.displayName || user.username}`;
}

async function init() {
  try {
    const { user } = await api('/api/admin/me');
    if (user) {
      showApp(user);
      navigate('dashboard');
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    const { user } = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('#login-username').value.trim(),
        password: $('#login-password').value,
      }),
    });
    showApp(user);
    navigate('dashboard');
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' });
  showLogin();
});

$$('.nav-item[data-view]').forEach((el) => {
  el.addEventListener('click', () => navigate(el.dataset.view));
});

function setActiveNav(view) {
  $$('.nav-item[data-view]').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
}

async function navigate(view) {
  setActiveNav(view);
  const root = $('#view-root');
  root.innerHTML = '<p class="muted">กำลังโหลด...</p>';
  try {
    if (view === 'dashboard') await renderDashboard(root);
    else if (view === 'roster') await renderRoster(root);
    else if (view === 'export') await renderExport(root);
  } catch (err) {
    root.innerHTML = `<p class="error-text">${err.message}</p>`;
  }
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' });
}

function personLine(p) {
  return `<div><strong>${p.name || ''}</strong> <span class="muted">${p.nickname ? '(' + p.nickname + ')' : ''}</span><br><span class="muted">${p.department || ''} · ${p.position || ''}</span></div>`;
}

// ---------- Dashboard ----------
async function renderDashboard(root) {
  const data = await api('/api/dashboard');
  const k = data.kpi;
  root.innerHTML = `
    <div class="topbar"><h1>แดชบอร์ด</h1><span class="muted">ข้อมูล ณ ${fmtDate(data.asOf)}</span></div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="num">${k.needsEnrollCount}</div><div class="label">รอแจ้งเข้าประกัน (ครบ 4 เดือนแล้ว)</div></div>
      <div class="kpi-card crit"><div class="num">${k.needsExitCount}</div><div class="label">รอแจ้งออกประกัน</div></div>
      <div class="kpi-card teal"><div class="num">${k.needsRelativeReminderCount}</div><div class="label">ครบ 6 เดือน ยังไม่แจ้งญาติ</div></div>
      <div class="kpi-card warn"><div class="num">${k.upcoming4mCount}</div><div class="label">จะครบ 4 เดือนใน 30 วัน</div></div>
      <div class="kpi-card info"><div class="num">${k.upcoming6mCount}</div><div class="label">จะครบ 6 เดือนใน 30 วัน</div></div>
      <div class="kpi-card" style="border-top-color:var(--ink-dim);"><div class="num">${k.totalActive}</div><div class="label">พนักงานที่ยังทำงานอยู่</div></div>
    </div>

    ${listCard('ต้องแจ้งเข้าประกัน', data.needsEnroll, (p) => `ครบ 4 เดือนเมื่อ ${fmtDate(p.eligible4mDate)}`, 'ok')}
    ${listCard('ต้องแจ้งออกประกัน', data.needsExit, (p) => `ลาออกมีผล ${fmtDate(p.resignEff)}`, 'crit')}
    ${listCard('ครบ 6 เดือน ยังไม่แจ้งญาติ', data.needsRelativeReminder, (p) => `ครบ 6 เดือนเมื่อ ${fmtDate(p.eligible6mDate)}`, 'warn')}
  `;
}

function listCard(title, items, subLine, tone) {
  if (!items.length) return `<div class="card"><h3>${title}</h3><p class="muted">ไม่มีรายการ 🎉</p></div>`;
  const badge = { ok: 'badge-ok', crit: 'badge-crit', warn: 'badge-warn' }[tone] || 'badge-info';
  return `<div class="card"><h3>${title} <span class="badge ${badge}">${items.length}</span></h3>
    <div class="milestone-rail">
      ${items.map((p) => `
        <div class="milestone-card">
          <div class="badge-time">${p.empId}</div>
          <div class="date">${p.name}</div>
          <div class="desc">${subLine(p)}</div>
        </div>
      `).join('')}
    </div>
  </div>`;
}

// ---------- Roster ----------
async function renderRoster(root) {
  root.innerHTML = `
    <div class="topbar"><h1>รายชื่อพนักงาน</h1></div>
    <div class="card">
      <div class="field">
        <input type="text" id="roster-search" placeholder="ค้นหาชื่อ, รหัสพนักงาน, เลขบัตรประชาชน...">
      </div>
      <div id="roster-table-wrap"><p class="muted">กำลังโหลด...</p></div>
    </div>
  `;
  const search = $('#roster-search');
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => loadRosterTable(search.value), 300);
  });
  await loadRosterTable('');
}

async function loadRosterTable(q) {
  const wrap = $('#roster-table-wrap');
  const data = await api(`/api/roster?q=${encodeURIComponent(q)}`);
  if (!data.rows.length) {
    wrap.innerHTML = '<p class="muted">ไม่พบข้อมูล</p>';
    return;
  }
  wrap.innerHTML = `
    <p class="muted" style="margin-top:0;">หากพบรายการที่จริงๆ ได้แจ้งบริษัทประกันไปแล้วก่อนหน้านี้ (ก่อนเริ่มใช้ระบบนี้) สามารถกด "ทำเครื่องหมายว่าดำเนินการแล้ว" เพื่อไม่ให้ค้างในระบบได้</p>
    <table>
      <thead><tr><th>รหัส</th><th>ชื่อ-สกุล</th><th>แผนก</th><th>สถานะ</th><th>4 เดือน</th><th>6 เดือน / ญาติ</th></tr></thead>
      <tbody>
        ${data.rows.map(rosterRow).join('')}
      </tbody>
    </table>
  `;
}

async function acknowledgeField(empId, field) {
  if (!confirm('ยืนยันว่ารายการนี้ดำเนินการ (แจ้งบริษัทประกัน) เรียบร้อยแล้วจริง?')) return;
  try {
    await api(`/api/roster/${empId}/acknowledge`, { method: 'POST', body: JSON.stringify({ field }) });
    await loadRosterTable($('#roster-search').value);
  } catch (err) {
    alert(err.message);
  }
}
window.acknowledgeField = acknowledgeField;

function rosterRow(p) {
  let statusBadge;
  if (p.isResigned) {
    statusBadge = p.needsExitNotice
      ? `<span class="badge badge-crit">รอแจ้งออก</span> <button class="btn btn-ghost" style="padding:2px 8px;font-size:11px;" onclick="acknowledgeField('${p.empId}','notify_out')">แจ้งแล้ว</button>`
      : `<span class="badge badge-ok">แจ้งออกแล้ว</span>`;
  } else {
    statusBadge = `<span class="badge badge-info">ทำงานอยู่</span>`;
  }

  let m4;
  if (p.isResigned) m4 = '—';
  else if (p.needsEnrollNotice) m4 = `<span class="badge badge-warn">รอแจ้งเข้า</span> <button class="btn btn-ghost" style="padding:2px 8px;font-size:11px;" onclick="acknowledgeField('${p.empId}','notify_in')">แจ้งแล้ว</button>`;
  else if (p.reached4m) m4 = `<span class="badge badge-ok">แจ้งแล้ว</span>`;
  else m4 = `<span class="muted">อีก ${p.daysUntil4m} วัน</span>`;

  let m6;
  if (p.isResigned) m6 = '—';
  else if (p.relative) m6 = `<span class="badge badge-ok">มีญาติแล้ว</span>`;
  else if (p.canAddRelative) m6 = `<span class="badge badge-warn">ยังไม่แจ้งญาติ</span>`;
  else m6 = `<span class="muted">อีก ${p.daysUntil6m ?? '-'} วัน</span>`;

  return `<tr>
    <td class="mono">${p.empId}</td>
    <td>${p.name}${p.nickname ? ' <span class="muted">(' + p.nickname + ')</span>' : ''}<br><span class="muted">${p.department || ''}</span></td>
    <td>${p.department || '—'}</td>
    <td>${statusBadge}</td>
    <td>${m4}</td>
    <td>${m6}</td>
  </tr>`;
}

// ---------- Export ----------
let exportPreviewCache = null;

async function renderExport(root) {
  root.innerHTML = `
    <div class="topbar"><h1>ส่งออกไฟล์ประกัน</h1></div>
    <div class="card">
      <h3>เลือกรายการที่จะสร้างไฟล์ส่งบริษัทประกัน</h3>
      <div id="export-lists"><p class="muted">กำลังโหลด...</p></div>
      <button class="btn btn-brand" id="generate-btn" style="margin-top:16px;">สร้างไฟล์ Excel</button>
      <div id="generate-result" style="margin-top:14px;"></div>
    </div>
    <div class="card">
      <h3>ประวัติชุดที่สร้างไว้</h3>
      <div id="batch-history"><p class="muted">กำลังโหลด...</p></div>
    </div>
  `;
  exportPreviewCache = await api('/api/export/preview');
  renderExportLists();
  $('#generate-btn').addEventListener('click', doGenerate);
  await renderBatchHistory();
}

function renderExportLists() {
  const { enroll, exit, relatives } = exportPreviewCache;
  const section = (title, items, prefix) => {
    if (!items.length) return `<p class="muted">${title}: ไม่มีรายการ</p>`;
    return `<div style="margin-bottom:16px;">
      <strong>${title} (${items.length})</strong>
      ${items.map((p) => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--hairline);">
          <input type="checkbox" class="${prefix}-check" value="${p.empId}" checked>
          <div style="flex:1;">${p.name || p.relativeName} <span class="muted">${p.empId}</span>${p.missingBank || p.relativeMissingBank ? ' <span class="badge badge-warn">ไม่มีข้อมูลธนาคาร</span>' : ''}</div>
        </div>
      `).join('')}
    </div>`;
  };
  $('#export-lists').innerHTML =
    section('แจ้งเข้าประกัน', enroll, 'enroll') +
    section('แจ้งออกประกัน', exit, 'exit') +
    section('แจ้งเพิ่มญาติ', relatives, 'relative');
}

async function doGenerate() {
  const enrollEmpIds = $$('.enroll-check:checked').map((c) => c.value);
  const exitEmpIds = $$('.exit-check:checked').map((c) => c.value);
  const relativeEmpIds = $$('.relative-check:checked').map((c) => c.value);
  const resultEl = $('#generate-result');
  resultEl.innerHTML = '<p class="muted">กำลังสร้างไฟล์...</p>';
  try {
    const res = await fetch('/api/export/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ enrollEmpIds, exitEmpIds, relativeEmpIds }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'สร้างไฟล์ไม่สำเร็จ');
    }
    const batchId = res.headers.get('X-Batch-Id');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `แจ้งเข้าออกประกัน-batch-${batchId}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    resultEl.innerHTML = `
      <div class="success-box">
        ดาวน์โหลดไฟล์แล้ว (ชุดที่ #${batchId})<br>
        <span style="font-weight:400;">เมื่อส่งอีเมลให้บริษัทประกันเรียบร้อยแล้ว กดยืนยันด้านล่างเพื่ออัปเดตสถานะ</span>
      </div>
      <button class="btn btn-brand" style="margin-top:10px;" onclick="confirmBatch(${batchId})">ยืนยันว่าส่งแล้ว</button>
    `;
  } catch (err) {
    resultEl.innerHTML = `<p class="error-text">${err.message}</p>`;
  }
}

async function confirmBatch(batchId) {
  if (!confirm('ยืนยันว่าได้ส่งไฟล์นี้ให้บริษัทประกันแล้วใช่หรือไม่? ระบบจะทำเครื่องหมายรายการเหล่านี้ว่าดำเนินการแล้ว')) return;
  try {
    await api(`/api/export/${batchId}/confirm`, { method: 'POST' });
    $('#generate-result').innerHTML = '<div class="success-box">ยืนยันเรียบร้อยแล้ว ✓</div>';
    exportPreviewCache = await api('/api/export/preview');
    renderExportLists();
    await renderBatchHistory();
  } catch (err) {
    alert(err.message);
  }
}
window.confirmBatch = confirmBatch;

async function renderBatchHistory() {
  const { batches } = await api('/api/export/batches');
  const el = $('#batch-history');
  if (!batches.length) {
    el.innerHTML = '<p class="muted">ยังไม่มีประวัติ</p>';
    return;
  }
  el.innerHTML = `<table>
    <thead><tr><th>#</th><th>ประเภท</th><th>วันที่สร้าง</th><th>จำนวน</th><th>สถานะ</th></tr></thead>
    <tbody>
      ${batches.map((b) => `
        <tr>
          <td>${b.id}</td>
          <td>${b.batch_type}</td>
          <td>${fmtDate(b.created_at)}</td>
          <td>${b.item_count}</td>
          <td>${b.status === 'sent' ? '<span class="badge badge-ok">ส่งแล้ว</span>' : `<span class="badge badge-warn">ฉบับร่าง</span> <button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;" onclick="confirmBatch(${b.id})">ยืนยันส่งแล้ว</button>`}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>`;
}

init();
