# OFFLINE QUEUE — Retention Sweep (P1① — งานต่อจาก P0 user namespace)

> แผนฉบับเทคนิค — อ้างอิงโค้ดจริงบน main `b5675aa` · สถานะ: **โครงร่าง รอเจ้าของอนุมัติก่อนลุยโค้ด**
> ตัดสินจากเจ้าของแล้ว 3 เรื่อง: **เพดานอายุ 30 วัน** · **บันทึก audit ใน IDB store ใหม่ (bump v1→v2)** · **ทริกเกอร์ = บูต + ครั้งแรกที่เปิดหน้า settings**
> P0 ปิดสมบูรณ์: PR #54 (merge `b5675aa`) — stamp/กรองเจ้าของครบ 6 จุด · legacy = Dormant · งานนี้คือขาจัดการกองพักตามสัญญาในข้อเสนอเดิม

---

## 1. ที่มา — กองคิวโอนไปข้างหน้าได้แต่ไม่มีขาท้าย (จากรอบ P0)

P0 ทำให้คิว sticky ตามเจ้าของ — ถูกต้องตามเจตนา (data intent ห้ามลบตอน logout) — แต่ยังไม่มีขาอายุ:
- คิวที่ flush ไม่เคยสำเร็จ (endpoint เลิกใช้ / payload ตายไปแล้ว) จะอยู่ตลอดไปและถูก retry ไม่รู้จบทุกครั้งกลับ online
- คิว **legacy** ที่เก่าก่อน deploy P0 (ไร้ stamp) อยู่ในสถานะ Dormant — มองไม่เห็นแม้แต่หน้า settings → ฝังใน IDB โดยไม่มีใครแตะซ้ำ

**ของใหม่ที่ห้ามพัง:** หลักคิด P0 ยังสูงสุด — คิว ≠ แคช · การลบครั้งแรกที่สุดเท่าที่จำเป็น · ลบแล้วต้องมีบันทึกตอบย้อนได้ (ไม่ใช่เงียบ)

## 2. เจตนา / หลักคิด

**หลัก 1 — Sweep ตามอายุ ไม่ใช่ตามความเชื่อ:** ตัดสินจาก `queuedAt` จริงของ record เป็นจำนวนเต็ม (แม้ legacy ไม่มี stamp ก็ตีอายุได้จาก field นี้ซึ่งมีมาแต่เดิม) — **ห้ามใช้การกรองทางอื่นมาตัดสินให้ลบ**

**หลัก 2 — เขียน audit ก่อนลบ เสมอ (write-ahead):** sweep แต่ละรอบต้องเขียนบันทึกลง store `audit` ให้เสร็จจริง **ก่อน** จึงสั่งลบ — ถ้าเขียนบันทึกล้ม → **ห้ามลบ** (R3) นี่คือด่านเสริม "ไม่ล้างเงียบ" ตามข้อสัญญา

**หลัก 3 — เกินเพดานเดียวกันสำหรับทุกกลุ่ม:** คิวของตัวเอง / ของคนอื่น / legacy — ตีอายุด้วยเกณฑ์เดียวกัน (30 วัน) ทุกกลุ่มเข้าชุดตัดพร้อมกัน (แต่ผู้ใช้เห็นผลผ่านบันทึก audit ไม่ใช่รายการใน UI)

**หลัก 4 — บันทึกก็ต้องมีขาท้าย:** store `audit` จำกัดตัวละ 50 รายการล่าสุด — เกินแคปตัดท้ายด้วยตัวเอง (การตัดบันทึกเก่าคือกลไก cap ของบันทึกเอง ไม่กระทบคิว)

## 3. ขอบเขต

### Sprint นี้ (P1①)
- รักร้องกำหนดเดิม: เกตเพดานอายุ 30 วันคำนวณจาก queuedAt · sweep เฉพาะอายุเกิน
- store `audit` ใหม่ (DB version 2) · sweep ลบ = เขียน audit สำเร็จก่อน (write-ahead)
- โชว์ผลล่าสุดในหน้า settings (บรรทัดเดียว — จำนวน + เวลา)
- ทริก: บูต (initOfflineQueue) + ครั้งแรกที่เปิดหน้า settings (debounce กันซ้ำ)

### ห้ามพัง (คงเดิมจาก P0)
- stamp/กรองทุกเส้นทาง · Dormant · ห้าม destructive purge ตอน logout — คงเงื่อนไขเดิมทุกจุด
- flush/notify/badge/settings แสดงเช็คเจ้าของตามเดิม — sweep ไม่สะสมข้ามสถานะ
- คิวที่ไม่เกินอายุ **แม้แต่รายการเดียว** ไม่เข้าชุดลบ (R1)

### อยู่รอ (P1②/P1③ ยังไม่แตะ)
- 4xx drop policy · Authorization refresh — ไม่ลากเข้ามาในงานนี้

## 4. การออกแบบ

### 4.1 ไฟล์ pure ใหม่แบบ pattern เดิม
`sovereign-frontend/src/lib/offline/queue-retention.ts` — pure ทดสอบบน Node ได้เต็มรูปทรงเหมือนรอบก่อน: **โมดูลนี้ห้าม touch IDB/window โดยตรง** ทุกฟังก์ชันรับข้อมูล clean แบบเดิมที่ queue-namespace ทำ:

```ts
import type { QueuedAction } from '../offlineQueue';

export const QUEUE_MAX_AGE_DAYS = 30;
export const AUDIT_CAP = 50;

export interface ActionRef { id: number; userId?: string | null; url: string; queuedAt: string; }

/** แบ่งชุดตามอายุ — ตัดสินจาก queuedAt เท่านั้น (R1/R2)
 *  removables = queuedAt ≤ now - maxAgeMs · kept = ที่เหลือไม่พลิกลำดับเดิม */
export function splitByAge(all: QueuedAction[], now: number, maxAgeMs: number): { removables: QueuedAction[]; kept: QueuedAction[] };

/** คอร์ดบันทึก audit ของรอบ sweep หนึ่งรอบลบชุดเดียวเขียนรายการเดียว */
export interface RetentionAuditRecord {
  id?: number;
  at: string;            // ISO เวลา sweep
  removedCount: number;
  removedRange: { oldestQueuedAt: string; newestQueuedAt: string } | null;
  removed: ActionRef[];  // รายชื่อเป๊ะ ๆ (id/userId/url/queuedAt เล็กพอ)
}

/** บันทึกก่อนลบ (write-ahead) — เขียนไม่สำเร็จ = throw ทันที · ไม่มีการลบตามคำสั่งขึ้นบรรทัดเดียว (R3) */
export async function recordAuditThenRemove(
  removableIds: number[],
  record: Omit<RetentionAuditRecord, 'id'>,
  auditStore: AuditStore,       // injection: put + list + trim เอง
  removeOne: (id: number) => Promise<void>  // injection: removeAction ของ offlineQueue
): Promise<number>;
```

**AuditStore interface** — shape เดียวกับหลักการ test double ของ `user-read-cache.test.ts`:
```ts
export interface AuditStore {
  put(record: RetentionAuditRecord): Promise<void>;
  list(): Promise<RetentionAuditRecord[]>;
}
```

### 4.2 แก้ `src/lib/offlineQueue.ts` (additive — คง signature เดิมทั้งหมด)
1. **`openDb`** — `indexedDB.open(DB_NAME, 2)` พร้อม `onupgradeneeded`: if-block ของ store `actions` คงเดิมครบ — **สร้าง store `audit` เพิ่มอีกชิ้น** `{ keyPath: 'id', autoIncrement: true }` — การเพิ่ม store ใหม่ตอน upgrade ไม่แตะข้อมูล store เดิมของเครื่องเก่า (IndexedDB ปฏิบัติตามเงื่อนไขตัวเดิมโดยตรง · เครื่องที่เคยเปิด v1 แล้วัก進งการ变更สิ่งแวดล้อมอัตโนมัติ)
2. **`getAuditStore`** — list/put ผ่าน transaction เหมือน getAllActions/getAllActions รอบเดิม (รักษา pattern `tx.oncomplete = () => db.close()` แบบเดียวกัน)
3. **`sweepExpiredQueue(): Promise<{ removed: number }>`** — ตัวห่อรวม:
   - `getAllActions()` (แนว flushQueue เดิม) → `splitByAge(all, Date.now(), QUEUE_MAX_AGE_DAYS)`
   - ถ้า removables ว่าง → return `{ removed: 0 }` **โดยไม่เขียนบันทึกเปล่า**
   - `recordAuditThenRemove(...)` — ผ่าน = ยิง `notify()` ให้ badge ถอดเช็คเอง (scope session ปัจจุบันโดยธรรมชาติ)
4. **ทริกเกอร์** — `initOfflineQueue()` เรียก `sweepExpiredQueue().catch(console.error)` ท้ายบล็อกการติดตั้ง interceptor (boot) · `pages/settings.tsx`: `useEffect` ครั้งแรก (mount) เรียกด้วย `flushThreshold` flag กันซ้ำ — โครง debounce: `let swept: boolean`

### 4.3 UI ที่รับผล (แรงเบา — บรรทัดเดียว)
- `settings.tsx` — เพิ่ม update block (แถว 180-240): บรรทัดใหม่จาก `listAudit()` — ข้อความ "เก็บกวาดคิวเกินอายุ 30 วัน · รอบเมื่อ <เวลา> · ลบ <จำนวน> รายการ" ผ่าน i18n `t('settings.queue.swept', fallback)`
- badge/settings/รายการคิวปกติไม่โดนแตะ — ผล sweep ติดตามได้เฉพาะบันทึก

### 4.4 ตัวเลขที่ซ้อนไว้ (จะไม่แก้ใระหว่างทำ)
- `QUEUE_MAX_AGE_DAYS = 30` · `AUDIT_CAP = 50` — เทสต์ผูกกับฝ่ายบันทึก เก็บ CAP บน 1 หลักคงทน เพราะเขียนเคสกันถ่ายเทสตาม plan

## 5. Invariants (แปลงเป็นเทสต์ต้องครบทุกตัว)

- **R1** อายุ < 30 วัน (ใหม่) ไม่เข้าชุดลบ — วันเป้ะ 30 วัน = ยังคงอยู่ (เกินเข้ม = > 30)
- **R2** คิวเก่า > 30 วัน ของทุกกลุ่ม (ตัวเอง/คนอื่น/legacy ไร้ stamp) เข้าชุดตัดทั้งหมด
- **R3** เขียน audit ล้ม = **ไม่มีการลบเกิดขึ้นใน actions store** (write-ahead แท้)
- **R4** audit สำเร็จ → record เดียว/รอบ · `removedCount` ตรงชุดที่ลบ · รายชื่อ id เป๊ะต้องตรงกันตามลำดับอายุ
- **R5** sweep ที่ removables ว่าง = ไม่เขียนบันทึก (ไม่เขียนรายการลบเปล่าให้ store โตเปล่า ๆ)
- **R6** `AUDIT_CAP = 50` · ตัดรายการเก่าทิ้งเกินเพดาน — ยัง **คงลำดับใหม่→เก่า** ของรายการที่เก็บ
- **R7** คิว "ที่เหลือ" (kept) ลำดับ FIFO คงเดิมรหัสรถเก็ต — เส้น P0 ทั้งหมดยังผ่าน เข้ากันได้

## 6. Test Cases (red-first)

**ไฟล์เทสต์:** `sovereign-frontend/src/lib/offline/queue-retention.test.ts`
**wrapper:** `tools/test/frontend-queue-retention.test.mjs` — auto คลุมผ่าน `test:tools` + `npm run verify` (แพตเทิร์นเดิม)
ทุกเคส = **pure + injection (MemoryAuditStore หลอก)** — ไม่พึ่ง IDB/window เหมือนรอบก่อนทั้งหมด
**แดงที่ต้องเห็นก่อน implement:** T1-T7 ล้มด้วย `Cannot find module './queue-retention'` — exit 1

| เคส | สิ่งที่ทดสอบ | ครอบ |
|---|---|---|
| T1 | splitByAge: 29 วัน = kept · 31 วัน = removables (ผ่านอายุ 0.5 วันพิสูจน์ขอบ) | R1 |
| T2 | ผสมกลุ่ม (ตัวเอง/คนอื่น/legacy) อายุเกิน → ทุกกลุ่มเข้า removables | R2 |
| T3 | recordAuditThenRemove: audit put ล้ม → **ไม่มี removeOne เรียกแม้แต่ครั้งเดียว** | R3 |
| T4 | recordAuditThenRemove: put สำเร็จ → removeOne ครบ ids เท่าที่ส่งตามลำดับ | R4 |
| T5 | record shape: at (ISO) · removedCount · removed[] — {id,userId,url,queuedAt} เป๊ะ | R4 |
| T6 | cap 50: ใส่ 55 แล้ว list = 50 รายการล่าสุด — ของเก่ากว่าเกณฑ์ cap ถูกตัดทิ้งไป เหลือเรียงลำดับตาม cap | R6 |
| T7 | เก็ตเดิมไม่พัง: split ไม่พลิกลำดับ kept + รายการ removables จังหวะอายุเส้นตรง | R5, R7 |

## 7. Manual check บน production (ตบท้าย)

- ถนนสาย normal: ใช้เครื่อง dev ตั้ง IDB ใส่ record อายุ 40 วัน (1 รายการ) + อายุ 1 วัน (3 รายการ) โปร่ง inspect (DevTools → IndexedDB `sovereign-offline` → `actions`) → reload หน้า → badge ลดลงอัตโนมัติ · DevTools ตาราง `audit` ต้องมีรายการเดียว (นับ 1)
- รายการที่ตรวจตามเส้น 7 (normal path): ใส่ record อายุ 40 วัน (1 รายการ) + อายุ 1 วัน (3 รายการ) ผ่าน DevTools → IndexedDB `sovereign-offline` → `actions` → reload หน้า → badge ลดลงอัตโนมัติ · store `audit` ต้องมีรายการเดียว (removedCount = 1) · คิวใหม่ 3 รายการคงอยู่จน flush ตามปกติ
- หน้า settings แสดงผล: "เก็บกวาดคิวเกินอายุ 30 วัน · ลบ 1 รายการ" — ปุ่ม sync/ลบปกติยังทำงานได้เหมือนเดิม

## 8. ขั้นตอนการนำไปใช้ (ตามกติกา AGENTS)

```
1. backup commit ก่อนแก้ (tree สะอาดหลัง docs commit)
2. git checkout -b ai/queue-retention
3. red: queue-retention.test.ts (T1-T7) → exit 1 พิสูจน์ก่อนโค้ดจริง
4. เขียว: queue-retention.ts (pure) + offlineQueue.ts (openDb v2 + sweepExpiredQueue + ทริกบูต) + settings.tsx (ทริก + บรรทัดผล)
5. npm run verify ผ่าน 6/6
6. commit → push → PR → CI เขียว → squash ผ่าน REST API → ลบ branch สองข้าง
7. regen changelog/status → docs commit ตรง main
8. รายงานผล + เสนอ P1② (4xx drop) ขึ้นคิวต่อ
```
