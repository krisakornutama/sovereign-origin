// src/hub-control.mjs — adapter ฝั่ง runner สำหรับช่องควบคุมระยะไกล
//
// ทำไมต้องแยกออกมาเป็นไฟล์ของตัวเอง (เดิมเป็นออบเจ็กต์ใน main.mjs):
//   สองครึ่งของช่องนี้ (HUB กับ runner) ถูกเทสต์แยกกันคนละชุด ⇒ ไม่มีอะไรพิสูจน์ว่า
//   "รูปแบบคำขอ" ที่ runner ส่ง ตรงกับที่ route ฝั่ง HUB อ่านจริง
//   พอแยกมาเป็นฟังก์ชันที่ inject fetch ได้ ก็เทสต์ยิง HTTP จริงแล้วตรวจ body/header ได้
//   (ช่องนี้พังเงียบ: HUB ตอบ 400 แล้วผู้ใช้เห็นแค่ \"คำสั่งไม่ทำงาน\")
//
// สัญญาที่ route ฝั่ง HUB คาด (ดู modules/machine-control/machine-control.routes.ts):
//   POST /next    header x-machine-token · body { waitMs }        → { command }
//   POST /frame   header x-machine-token · body { data, mime, width, height }
//   POST /result  header x-machine-token · body { commandId, ok, result, error }

/** ยิง JSON ไป HUB แล้วคืน object — throw เมื่อไม่ ok (ผู้เรียกเป็นคนตัดสินใจว่าจะทำอะไรต่อ) */
async function postJson({ hubUrl, token, path, body, fetchImpl }) {
  const res = await fetchImpl(`${hubUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-machine-token': token },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${path} -> HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return await res.json();
}

/**
 * สร้างไคลเอนต์ของช่องควบคุม
 * @param {{ hubUrl: string, token: string, fetchImpl?: typeof fetch }} opts
 */
export function createControlHub({ hubUrl, token, fetchImpl = fetch }) {
  const base = String(hubUrl ?? '').replace(/\/$/, '');

  return {
    /** long-poll รอคำสั่ง — คืน null เมื่อครบเวลา (ไม่ใช่ error) */
    async nextCommand(waitMs) {
      const out = await postJson({ hubUrl: base, token, path: '/api/machine-control/next', body: { waitMs }, fetchImpl });
      return out?.command ?? null;
    },

    /** ส่งภาพหน้าจอ 1 เฟรม (base64 ใน JSON — เฟรมวิ่งถี่ จึงเลี่ยง overhead ของ multipart) */
    async sendFrame(frame) {
      return await postJson({
        hubUrl: base,
        token,
        path: '/api/machine-control/frame',
        body: {
          data: Buffer.isBuffer(frame?.buffer) ? frame.buffer.toString('base64') : String(frame?.buffer ?? ''),
          mime: frame?.mime || 'image/jpeg',
          width: frame?.width ?? null,
          height: frame?.height ?? null,
        },
        fetchImpl,
      });
    },

    /** รายงานผลของคำสั่ง — ต้องเรียกทุกครั้งแม้ล้มเหลว ไม่งั้นผู้ใช้รอจน timeout */
    async reportResult(commandId, outcome) {
      return await postJson({
        hubUrl: base,
        token,
        path: '/api/machine-control/result',
        body: {
          commandId,
          ok: outcome?.ok !== false,
          result: outcome?.ok === false ? null : outcome?.result ?? outcome ?? null,
          error: outcome?.ok === false ? String(outcome?.error || 'ไม่ทราบสาเหตุ') : null,
        },
        fetchImpl,
      });
    },
  };
}
