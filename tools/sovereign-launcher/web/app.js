// Sovereign OS Launcher — UI logic (fetch ไปยัง Go backend 127.0.0.1:34700)
const $ = (s) => document.querySelector(s);

async function api(path, opts) {
  const r = await fetch(path, opts);
  return r.json();
}

// ── Pre-flight ──
async function refreshPreflight() {
  const p = await api('/api/preflight');
  const setDot = (id, ok, mid) => {
    const d = $(id);
    d.className = 'dot ' + (ok ? 'good' : mid ? 'mid' : 'bad');
    return ok;
  };
  const dk = p.docker;
  const dockerOk = setDot('#pfDocker', dk.installed && dk.running, dk.installed && !dk.running);
  $('#pfDockerTxt').textContent = dk.installed
    ? (dk.running ? dk.version.split(',')[0].trim() : 'ติดตั้งแล้ว แต่ Docker ยังไม่รัน!')
    : 'ยังไม่พบ Docker — ติดตั้ง Docker Desktop ก่อน';

  const ramOk = setDot('#pfRam', p.ram.ok);
  $('#pfRamTxt').textContent = `ว่าง ${(p.ram.freeMB / 1024).toFixed(1)} / ${(p.ram.totalMB / 1024).toFixed(1)} GB`
    + (p.ram.ok ? '' : ' — ต่ำกว่า 2GB ควรปิดแอปอื่น');

  const p3000 = p.ports['3000'], p3001 = p.ports['3001'];
  const portOk = setDot('#pfPorts', !p3001, !p3000);
  $('#pfPortsTxt').textContent = `3000: ${p3000 ? 'ถูกใช้' : 'ว่าง'} · 3001: ${p3001 ? 'ถูกใช้ (ระบบรันอยู่)' : 'ว่าง'}`;

  const healthOk = setDot('#pfHealth', p.health, p.envExists);
  $('#pfHealthTxt').textContent = p.health ? 'Sovereign OS รันปกติ' : (p.envExists ? 'ยังไม่รัน — กด Start ได้เลย' : 'ยังไม่ติดตั้ง — กด Start เพื่อสร้าง .env + รัน');
  return { dockerOk, ramOk, portOk, healthOk };
}

// ── Features ──
let featureList = [];
async function refreshFeatures() {
  const { features } = await api('/api/features');
  featureList = features;
  const box = $('#features');
  box.innerHTML = '';
  for (const f of features) {
    const el = document.createElement('label');
    el.className = 'feat' + (f.enabled ? '' : ' off');
    el.innerHTML = `
      <input type="checkbox" ${f.enabled ? 'checked' : ''} ${f.locked ? 'disabled' : ''}>
      <div>
        <b>${f.label}</b>
        ${f.locked ? '<span class="tag core">บังคับ</span>' : ''}
        <span class="tag ram">+${f.ramMB} MB</span>
        ${f.requiredRAM ? '<span class="tag ram">ต้องการ RAM ≥ ' + (f.requiredRAM / 1024).toFixed(0) + ' GB</span>' : ''}
        <small>${f.desc}</small>
      </div>`;
    el.onclick = (e) => {
      if (f.locked) return;
      const cb = el.querySelector('input');
      cb.checked = !cb.checked;
      el.classList.toggle('off', !cb.checked);
      saveFeatures();
    };
    box.appendChild(el);
  }
}

async function saveFeatures() {
  const checked = [...document.querySelectorAll('.feat input')]
    .map((cb, i) => ({ cb, f: featureList[i] }))
    .filter(({ cb, f }) => cb.checked || f.locked)
    .map(({ f }) => f.id);
  const r = await api('/api/features', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ features: checked }),
  });
  showResult(r.ok ? 'บันทึกการเลือกฟีเจอร์แล้ว ✓' : 'บันทึกล้มเหลว: ' + r.error, r.ok);
}

// ── Status / Control ──
async function refreshStatus() {
  const s = await api('/api/status');
  const pill = $('#statusPill');
  if (s.health) {
    pill.textContent = '● ระบบรันปกติ';
    pill.className = 'pill ok';
  } else if (s.envExists) {
    pill.textContent = '○ ยังไม่รัน';
    pill.className = 'pill warn';
  } else {
    pill.textContent = '○ ยังไม่ติดตั้ง';
    pill.className = 'pill bad';
  }
  const tb = $('#contTable tbody');
  tb.innerHTML = '';
  (s.containers || []).forEach((c) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${c.name}</td><td><span class="st ${c.state}">${c.state}</span></td><td>${c.status || ''}</td>`;
    tb.appendChild(tr);
  });
}

function showResult(msg, ok) {
  const r = $('#result');
  r.classList.remove('hidden');
  r.className = 'result ' + (ok ? 'ok' : 'err');
  r.textContent = msg;
  setTimeout(() => r.classList.add('hidden'), ok ? 5000 : 15000);
}

async function busy(btn, on) {
  btn.disabled = on;
  btn.textContent = on ? '…กำลังทำงาน' : btn.dataset.txt;
}

$('#btnStart').dataset.txt = $('#btnStart').textContent;
$('#btnStop').dataset.txt = $('#btnStop').textContent;

$('#btnStart').onclick = async () => {
  const b = $('#btnStart');
  await busy(b, true);
  showResult('กำลังเริ่มระบบ (ครั้งแรก ~2–10 นาที)…', true);
  const r = await api('/api/start', { method: 'POST' });
  await busy(b, false);
  if (r.ok) {
    showResult('เริ่มระบบสำเร็จ ✓' + (r.frontendSkipped ? '\n(พอร์ต 3000 ชน → ข้าม Dashboard ใช้เฉพาะ API)' : ''), true);
  } else {
    showResult('เริ่มระบบล้มเหลว:\n' + (r.output || r.error), false);
  }
  refreshPreflight(); refreshStatus();
};

$('#btnStop').onclick = async () => {
  const b = $('#btnStop');
  await busy(b, true);
  const r = await api('/api/stop', { method: 'POST' });
  await busy(b, false);
  showResult(r.ok ? 'หยุดระบบแล้ว ✓' : 'ล้มเหลว: ' + (r.error || r.output), r.ok);
  refreshPreflight(); refreshStatus();
};

$('#btnDash').onclick = async () => {
  const r = await api('/api/dashboard', { method: 'POST' });
  if (!r.ok) showResult('เปิด Dashboard ล้มเหลว', false);
};

$('#btnLogs').onclick = async () => {
  const r = await api('/api/logs?lines=200');
  const box = $('#logBox');
  box.classList.remove('hidden');
  box.textContent = r.logs || '(ไม่มี log — ระบบยังไม่รัน)';
  box.scrollTop = box.scrollHeight;
};

// ── boot ──
(async () => {
  refreshPreflight();
  refreshFeatures();
  refreshStatus();
  setInterval(() => { refreshStatus(); }, 5000);
})();
