// src/single-instance.mjs — "runner มีได้ตัวเดียวต่อเครื่อง"
//
// ── ทำไมต้องมี ────────────────────────────────────────────────────────────────
// เจอจริงบนเครื่อง 2 (31/10/69): autostart ติดตั้งทั้ง Startup folder และ Scheduled Task
// ⇒ Windows เปิด runner สองโปรเซสตอนล็อกอิน ⇒ ทั้งคู่ long-poll
//   `/api/machine-control/next` พร้อมกัน ⇒ HUB ปลด poll เก่าด้วย null ทุกครั้งที่มี poll ใหม่
//   ⇒ วน ~22 requests/วินาทีตลอดเวลา (heartbeat ถี่เป็นสองเท่า, CPU/เน็ตเสียเปล่า)
//
// ── ทำไมใช้ port ไม่ใช้ไฟล์ lock ───────────────────────────────────────────────
// ไฟล์ lock ค้างเมื่อโปรเซสตายแบบไม่ทันลบ (ต้องมีคนไปลบมือ = เครื่องหลุดจาก HUB)
// แต่ OS คืน port ให้เองทันทีที่โปรเซสตาย ⇒ ไม่มีสถานะค้างให้กู้
//
// กติกา: bind ไม่ได้ด้วยเหตุอื่นที่ไม่ใช่ EADDRINUSE = **fail-open**
// (ห้ามกัน runner ไม่ให้ทำงานเพราะเรื่องที่ไม่เกี่ยวกับการเปิดซ้อน)
import net from 'node:net';

export const DEFAULT_LOCK_PORT = 49731;

/**
 * จองสิทธิ์เป็น runner ตัวเดียวของเครื่อง
 * @returns {Promise<{ok:boolean, reason?:string, server:import('node:net').Server|null, port:number}>}
 *   ok=false + reason='already-running' = มีตัวอื่นถืออยู่ → ผู้เรียกควรออกทันที (exit 0)
 */
export async function acquireSingleInstance({
  port = DEFAULT_LOCK_PORT,
  host = '127.0.0.1',
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const server = net.createServer();
    server.once('error', (err) => {
      const code = String(err?.code ?? 'unknown');
      if (code === 'EADDRINUSE') {
        done({ ok: false, reason: 'already-running', server: null, port });
        return;
      }
      // bind ไม่ได้ด้วยเหตุอื่น — ไม่ใช่เรื่องเปิดซ้อน จึงต้องปล่อยให้ runner ทำงานต่อ
      done({ ok: true, reason: `bind-failed:${code}`, server: null, port });
    });

    server.listen({ port, host, exclusive: true }, () => {
      // ไม่กันโปรเซสปิดตัว (runner มี timer ของตัวเอง) แต่ handle ยังถือ port ไว้จนโปรเซสตาย
      if (typeof server.unref === 'function') server.unref();
      done({ ok: true, server, port });
    });
  });
}
