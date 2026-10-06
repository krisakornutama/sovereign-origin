import './setup-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'child_process';

// red-first (chunk 5): เดิมทั้ง tts.routes.ts และ tts.service.ts hardcode
// path `E:\My work\...\tools\tts_speak.py` — path นี้ไม่มีอยู่ใน image ⇒
// container spawn ไม่ได้/สคริปต์หาย → sendTelegramVoice คืน false ตลอดกาล
// และ spawn('python') ทั้งที่ container มีแค่ python3
//
// ลำดับที่ resolver ต้องเลือก: TTS_SCRIPT env → สคริปต์ใน image/project → legacy E:\

function loadRoutes(): any {
  // โหลดสด — require ค่าคงที่ของโมดูลใหม่จะคืน undefined จนกว่าจะแก้โค้ด (แดง)
  return require('../src/modules/tts/tts.routes');
}

const TMP_ROOT = path.resolve(process.cwd(), '.tmp-tts-resolver');

describe('tts — path resolver ของสคริปต์ (ใช้ร่วมกันระหว่าง routes กับ service)', () => {
  test('TTS_SCRIPT env มาก่อนเสมอ (ไม่สนไฟล์ใน image)', () => {
    const { resolveTtsScript } = loadRoutes();
    const p = resolveTtsScript({ TTS_SCRIPT: path.join(TMP_ROOT, 'custom.py') }, TMP_ROOT);
    assert.equal(p, path.join(TMP_ROOT, 'custom.py'), 'env ต้องชนะเสมอ');
  });

  test('ไม่มี env → ใช้สคริปต์ที่อยู่ใน image/project (cwd/tts/tts_speak.py)', () => {
    const { resolveTtsScript } = loadRoutes();
    const proj = path.join(TMP_ROOT, 'project');
    fs.mkdirSync(path.join(proj, 'tts'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'tts', 'tts_speak.py'), '# stub');
    try {
      const p = resolveTtsScript({}, proj);
      assert.equal(p, path.join(proj, 'tts', 'tts_speak.py'), 'ต้องเลือกสคริปต์ที่ COPY เข้า image');
    } finally {
      fs.rmSync(proj, { recursive: true, force: true });
    }
  });

  test('ไม่มีทั้งคู่ → fallback ไป legacy path ของ dev host', () => {
    const { resolveTtsScript, LEGACY_TTS_SCRIPT } = loadRoutes();
    const empty = path.join(TMP_ROOT, 'empty');
    fs.mkdirSync(empty, { recursive: true });
    try {
      const p = resolveTtsScript({}, empty);
      assert.equal(p, LEGACY_TTS_SCRIPT);
      assert.match(p, /tools.tts_speak\.py$/, 'legacy ต้องชี้สคริปต์เดิมของ dev host');
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  test('สคริปต์จริงอยู่ใน core-api แล้ว (ของที่ image จะ COPY ไปด้วย) — cwd = core-api', () => {
    const { resolveTtsScript } = loadRoutes();
    const p = resolveTtsScript({}, process.cwd());
    assert.equal(fs.existsSync(p), true, `ต้องเจอสคริปต์จริงที่ ${p} (ไม่ใช่ชี้ไป path ที่ไม่มีจริง)`);
  });

  test('pythonBinCandidates: PYTHON_BIN override · ปกติลอง python3 ก่อน python', () => {
    const { pythonBinCandidates } = loadRoutes();
    assert.deepEqual(pythonBinCandidates({ PYTHON_BIN: '/usr/bin/python3.12' }), ['/usr/bin/python3.12']);
    assert.deepEqual(pythonBinCandidates({}), ['python3', 'python'], 'container มีแค่ python3 · dev host มีแค่ python');
  });

  test('spawnPythonWithFallback start ตัวแรกที่มีจริงได้ (python3 → python)', async (t) => {
    const { spawnPythonWithFallback, pythonBinCandidates } = loadRoutes();
    // เครื่องที่ไม่มี python เลยก็ต้องไม่ค้าง — ข้ามอย่างมีเหตุผล (ไม่ใช่ swallow error)
    const hasPython = pythonBinCandidates({}).some(
      (bin: string) => spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0
    );
    if (!hasPython) return t.skip('เครื่องนี้ไม่มี python ตัวไหนเลย');

    const outcome = await new Promise<string>((resolve) => {
      spawnPythonWithFallback(['-c', 'print(1)'], {
        onChild: (child) => {
          child.kill();
          resolve('child');
        },
        onFail: (err) => resolve(`fail: ${err.message}`),
      });
      setTimeout(() => resolve('timeout'), 5000);
    });
    assert.equal(outcome, 'child', `ต้อง start python ได้จริง (ได้: ${outcome})`);
  });

  test('spawnPythonWithFallback รายงาน onFail เมื่อ PYTHON_BIN ชี้ไป binary ที่ไม่มี', async () => {
    const { spawnPythonWithFallback } = loadRoutes();
    const err: Error | null = await new Promise((resolve) => {
      spawnPythonWithFallback(['-c', 'print(1)'], {
        onFail: resolve,
      }, { PYTHON_BIN: path.join(TMP_ROOT, 'no-such-python-binary') });
      setTimeout(() => resolve(null), 3000);
    });
    assert.ok(err, 'ต้องรายงานความล้มเหลว ไม่ใช่หายเงียบ (ค้างไม่ตอบ = บั๊ก Express 4)');
  });
});

// พิสูจน์สคริปต์จริง — บั๊กที่จับที่นี่: เสียงเริ่มต้นเป็น en ทำให้ข้อความไทย
// ถูก synthesize เงียบ ๆ เป็นไฟล์ว่าง 0 ไบต์ (ทั้งที่ exit 0 ดูเหมือนสำเร็จ)
// ข้ามพร้อมเหตุผลเมื่อเครื่องไม่มี pyttsx3 — ไม่ใช่ swallow ให้ดูเขียวเทียม
describe('tts — สคริปต์จริงออกเสียงได้ (ไม่ใช่ 0 ไบต์)', () => {
  const script = path.resolve(process.cwd(), 'tts', 'tts_speak.py');
  const pyBin = ['python3', 'python'].find(
    (b) => spawnSync(b, ['--version'], { stdio: 'ignore' }).status === 0
  );
  const hasPyttsx3 = Boolean(
    pyBin && spawnSync(pyBin, ['-c', 'import pyttsx3'], { stdio: 'ignore' }).status === 0
  );
  const hasThaiVoice = (): boolean => {
    if (!pyBin) return false;
    const probe = spawnSync(
      pyBin,
      ['-c', "import pyttsx3; vs=pyttsx3.init().getProperty('voices'); print(any(str(getattr(v,'id','')).split('/')[-1].lower()=='th' or 'thai' in str(getattr(v,'name','')).lower() for v in vs))"],
      { timeout: 60_000 }
    );
    return probe.stdout?.toString().trim() === 'true';
  };

  test('ข้อความอังกฤษ → ได้ WAV จริง (RIFF) และ exit 0', (t) => {
    if (!hasPyttsx3) return t.skip('เครื่องนี้ไม่มี pyttsx3');
    const r = spawnSync(pyBin!, [script, 'hello world', '180'], { timeout: 60_000 });
    assert.equal(r.status, 0, `exit=${r.status} · stderr=${r.stderr?.toString().slice(0, 300)}`);
    assert.equal(r.stdout.subarray(0, 4).toString('latin1'), 'RIFF', 'ต้องเป็นไฟล์ WAV จริง');
    assert.ok(r.stdout.length > 1000, `ต้องได้เสียงจริง ไม่ใช่ 0 ไบต์ (ได้ ${r.stdout.length})`);
  });

  test('ข้อความไทย → ได้เสียงจริง ไม่ใช่ไฟล์ว่าง (ต้องเลือกเสียงไทยก่อน)', (t) => {
    if (!hasPyttsx3) return t.skip('เครื่องนี้ไม่มี pyttsx3');
    if (!hasThaiVoice()) return t.skip('เครื่องนี้ไม่มีเสียงไทยใน pyttsx3 (ต้องพิสูจน์ใน container ที่มี espeak-ng)');
    const r = spawnSync(pyBin!, [script, 'ทดสอบระบบเสียงแจ้งเตือน', '180'], { timeout: 60_000 });
    assert.equal(r.status, 0, `exit=${r.status} · stderr=${r.stderr?.toString().slice(0, 300)}`);
    assert.equal(r.stdout.subarray(0, 4).toString('latin1'), 'RIFF');
    assert.ok(r.stdout.length > 1000, `ข้อความไทยต้องได้เสียงจริง (ได้ ${r.stdout.length} ไบต์) — 0 ไบต์ = เลือกเสียงผิด`);
  });
});
