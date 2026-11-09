# OFFLINE QUEUE — User Namespace (แผน Sprint ต่อจาก PR #53)

> แผนฉบับเทคนิค — อ้างอิงโค้ดจริงบน main `36d3a3d` · สถานะ: **โครงร่าง รอเจ้าของอนุมัติขอบเขต sprint หน้า**
> งานระยะ 3 (PR #53: user-namespaced read cache + logout purge + Network Indicator) ปิดสมบูรณ์แล้ว — เอกสารนี้วางแผนรอบถัดไป สำหรับ `offlineQueue` (write queue) ซึ่งยังใช้ IDB object store เดียวร่วมกัน

---

## 1. ที่มา — ความเสี่ยง Cross-user Mutation (พิสูจน์จากโค้ด 6 จุด)

เหตุการณ์: User A ทำงานขณะออฟไลน์ → POST/PUT/PATCH/DELETE same-origin ถูกใส่คิวอัตโนมัติ → หลังจากนั้น User B (หรือ A เข้าใหม่) ในเบราว์เซอร์ตัวเดิม trigger flush → **คิวของ A ถูกส่งด้วย token ของ B** เพราะทุก action รวมกันในหนึ่ง store: `DB_NAME='sovereign-offline'`, `STORE='actions'` (`src/lib/offlineQueue.ts`)

| # | จุดที่รั่ว | โค้ดเดิม (บรรทัด) | ความเสีย |
|---|---|---|---|
| 1 | fetch interceptor ใส่คิวขณะออฟไลน์ | `initOfflineQueue` (200-217) | action ใหม่ไม่ติดเจ้าของ — ใครก็ flush ได้ |
| 2 | flush ทั้งหมด | `flushQueue()` (228+) | คิวของ A โดนส่งใต้ token ของ B |
| 3 | flush รายการเดียว | `flushAction(id)` (100-120) | เรียก id ตรง ๆ = flush ของใครก็ได้ |
| 4 | badge/counter | `countQueued()` + `notify()` (72-78, 140-143) | B เห็นจำนวนคิวค้างของ A บน header ทุกหน้า |
| 5 | หน้าจัดการคิว | `listQueued()` (81-87) + `pages/settings.tsx` (180/209/225) | B เห็นเนื้อหา (url/method/ชิ้นส่วนของ body) ของคิวที่ A ค้างไว้ |
| 6 | ลบรายการแบบตั้งใจ | `removeQueued(id)` (90-97) | B ลบคิวของ A ทิ้งได้ (แค่รู้ id) |

## 2. เจตนา / หลักคิด

**หลัก 1 — คิว ≠ แคช:** แคชอ่าน re-fetch ใหม่ได้เสมอ (disposable → ลบตอน logout ได้ตามงาน #53) แต่คิวเขียนคือ **เจตนาขยับข้อมูลของผู้ใช้** ที่สร้างคืนไม่ได้ — **ข้อห้ามใช้กลยุทธ์ "logout ล้างคิว"**
> พฤติกรรมเป้าหมาย: A คิว 10 รายการขณะออฟไลน์ → ออกจากระบบ → กลับเข้าใหม่ → คิว 10 รายการต้องถูก flush ครบตามเดิม (ข้อมูลไม่ให้หายระหว่างเหตุการณ์ออกจากระบบ)

**หลัก 2 — Ownership ตัดสินด้วย id ที่ติดตั้งแต่ต้น:** ทุก action ระบุเจ้าของตั้งแต่ขั้น enqueue และ flush (ทั้ง 3 เส้นทาง) กรองอย่างเคร่งครัดด้วย `action.userId === userId ของ session ปัจจุบัน`

**หลัก 3 — Dormant แทน Destructive:** สิ่งที่ตัดสินของเจ้าของไม่ได้ ต้องถูกถือไว้ในสถานะพัก (ไม่ flush · ไม่แสดง · ไม่ลบ) ไม่ใช่เดาผิดแล้วยักย้าย

**หลัก 4 — FIFO ต่อเจ้าของ:** การกรองห้ามพลิกลำดับ — คง sort แบบเดิม (queuedAt เก่าไปใหม่)

## 3. ขอบเขต

### P0 (sprint หน้า — ครอบคลุมตาราง §1 ทั้ง 6 จุด)
- stamp `userId` + filter ครบ 6 จุด · badge + หน้า settings แสดงเฉพาะของ session ปัจจุบัน

### P1 (รอบต่อจากนั้น — รอเจ้าของพิจารณาก่อนลงมือ)
- **Retention sweep** — คิวเก่าเกินอายุ (เสนอ 30 วัน) → drop · ต้องมี summary/audit ให้เห็นว่า action ใดหมดอายุไป (กันการลบเงียบโดยคนใช้ไม่รู้ตัว)
- **4xx policy** — 4xx = ล้มเหลวถาวร → drop (หยุด retry ที่ไม่มีวันสำเร็จ) · 5xx/network ยัง retry ตามเดิม
- **Authorization refresh** — action ของตัวเองที่ติด token เก่าหมดอายุ → เปลี่ยนเป็น token ปัจจุบันเท่านั้นถ้า stamp ตรงกัน

## 4. การออกแบบ

### 4.1 ไฟล์ใหม่ (pure — ทดสอบบน Node ได้เต็มรูปทรง ไม่พึ่ง IDB/window)
`sovereign-frontend/src/lib/offline/queue-namespace.ts` (แพตเทิร์นเดียวกับ `logout-purge.ts` รอบ #53)

```ts
export type QueueUserId = string | null;   // null = ยังไม่ล็อกอิน (anonymous)

export interface QueuedAction {
  // ...fields เดิมทุกอย่าง (id/url/method/headers/body/queuedAt)...
  userId?: string | null;
}

/** stamp ตอน enqueue — ส่ง null ได้ (anonymous ของจริง) */
export function stampUserId(action, userId: QueueUserId): QueuedAction;

/** กรองคิวให้เฉพาะเจ้าของปัจจุบัน — core ของ guard
 *  - action.userId === userId      → ผ่าน
 *  - action.userId === undefined   → legacy (ไม่มี stamp) → ไม่ผ่าน (สถานะพัก)
 *  - action.userId === null        → anonymous → ผ่าน เฉพาะ userId ปัจจุบัน === null
 *  - กรณีอื่น                       → ไม่ผ่าน (ของ user อื่น)
 */
export function ownQueuedActions(all: QueuedAction[], userId: QueueUserId): QueuedAction[];

/** P1: คืนชุดคิวที่เกินอายุที่กำหนด */
export function expiredQueuedActions(all: QueuedAction[], now: number, maxAgeMs: number): QueuedAction[];
```

### 4.2 แก้ `src/lib/offlineQueue.ts` (additive — ไม่ลบ/ไม่เปลี่ยน signature เดิม)
1. `QueuedAction` — เพิ่ม optional field `userId?: string | null`
2. **Enqueue** (interceptor, บรรทัด 202-208): stamp ด้วย `useAuthStore.getState().user?.id ?? null` — อ่านสดทุกครั้ง (แพตเทิร์นตรงกับ `apiFetch.ts` บรรทัด 13/40 · ยืนยันแล้วว่าไม่มี import cycle เพราะ useAuthStore ไม่ import offlineQueue)
3. **flushQueue()**: `getAllActions()` → `ownQueuedActions(all, currentUser)` → ส่งเฉพาะของ session ปัจจุบัน · return = จำนวนที่สำเร็จ (2xx) ของเจ้าของปัจจุบัน
4. **flushAction(id)**: หลัง find ต้องเช็ค belongs ก่อนส่ง ทุกครั้ง (กันหน้า settings ที่เกาะ state ล้าเก่าจาก session ก่อนหน้า เช่นไม่ได้ refresh หน้าหลังสลับบัญชี)
5. **countQueued(userId?)**: เพิ่ม optional param (default `undefined` = รวมทั้งหมด = เข้ากันได้กับ caller เดิม); ภายใน `notify()` ส่ง current user เสมอ → **badge แสดงเฉพาะของ session ปัจจุบัน**
6. **listQueued(userId?)**: optional param; `settings.tsx` เปลี่ยนจุดเรียกเดียวเป็น `listQueued(currentUserId)`
7. **removeQueued(id)**: ลบได้เฉพาะ action ที่ belongs กับ current user (ของ user อื่น = ละเว้นเงียบ ๆ ตามหลัก Dormant)

### 4.3 DB ไม่ต้อง migration
เพิ่มเป็น **optional field** ของ record ไม่สร้าง index/store ใหม่ — ใช้ `getAll()` + filter JS ซึ่งพอสมรรถนะ (คิวมีจำนวนน้อยตามธรรมชาติ) → **DB version ยังเป็น 1, `onupgradeneeded` ไม่แตะ** เก่า IDB ของทุกเครื่องที่ deploy อยู่ไม่โดนแตะ

### 4.4 ไม่แตะ (ยืนยันแล้วว่างานชุดนี้ไม่กระทบ)
- `useOfflineSync` · `PageHeader` · `NetworkIndicator` · logout-purge — ได้รับผลทางอ้อมเฉพาะผ่าน `notify()`/badge count ที่ `countQueued(userId)` จัดการเอง
- headers ที่ถ่ายทั้งชิ้นมาตอน enqueue (รวม Authorization ของเจ้าของ) คงตามเดิม — ไม่ swap token ใน P0 (เลื่อนเรื่องนี้ไป P1)

## 5. Invariants (แปลงเป็นเทสต์ต้องครบทุกตัว)

- **I1** flush (flushQueue / flushAction / flushSelected) ส่ง request เฉพาะของเจ้าของ session ปัจจุบัน
- **I2** logout / หมดอายุ 401 → คิวของคนนั้น **ยังอยู่ครบทุกรายการ** (ห้ามลบ · ห้ามลดจำนวน)
- **I3** badge + หน้า settings แสดงและลบได้ เฉพาะของ session ปัจจุบัน
- **I4** ลำดับ FIFO ต่อเจ้าของ ไม่พลิก
- **I5** action ไม่มี stamp (legacy เก่าก่อน deploy) = อยู่ในสถานะพัก — ไม่ auto-flush (รอ P1 retention ตัดสิน)
- **I6** สลับบัญชี (session เปลี่ยน) → namespace ที่เข้าถึงต่างกัน — ไม่มีทางผสมข้ามบัญชี

## 6. Test Cases (red-first)

**ไฟล์เทสต์:** `sovereign-frontend/src/lib/offline/queue-namespace.test.ts`
**wrapper:** `tools/test/frontend-queue-namespace.test.mjs` — auto คลุมผ่าน `test:tools` และ `npm run verify` (แพตเทิร์นเดิม)
ทุกเคสทดสอบ **pure function เท่านั้น** (ไม่พึ่ง IDB/window — จำแนกตามเล่ม logout-purge ที่ผ่านแล้วรอบ #53)
**แดงที่ต้องเห็นก่อน implement:** T1-T7 ล้มตั้งแต่ import ด้วย `Cannot find module './queue-namespace'` — exit 1

| เคส | สิ่งที่ทดสอบ | ครอบ |
|---|---|---|
| T1 | stampUserId: action ที่คืนมี field `userId` ตามค่าที่ส่ง · null → `userId: null` (anonymous) | — |
| T2 | ownQueuedActions: ผสม [A, B, anon, legacy] + current=A → คืนเฉพาะ A ตามลำดับเดิม | I1, I4 |
| T3 | ownQueuedActions: current=null (anonymous) → คืนเฉพาะ action ที่ `userId===null` — ไม่มีทางได้ของ user อื่น | I1 |
| T4 | legacy (`userId` undefined) ไม่ผ่านการกรองใน **ทุก** กรณี | I5 |
| T5 | สลับบัญชี: current=B หลัง current=A → ชุดที่ได้ไม่มีของ A | I6 |
| T6 | FIFO ต่อเจ้าของ — ลำดับ queuedAt คงเดิม | I4 |
| T7 | I2 (logout ไม่ลบคิว): run attachOfflinePurge ผ่าน store fake + transition logout → พิสูจน์ว่าผลของ ownQueuedActions ไม่เปลี่ยน (ของ A ครบเหมือนก่อน) | I2 |

ขั้นตอน red-first (ตามกติกา AGENTS ข้อ 8):
1. branch `ai/queue-namespace` ตั้งจาก main
2. เขียนเทสต์ T1-T7 → ต้องเห็น exit 1 + `Cannot find module './queue-namespace'` ก่อนเขียนโค้ดจริง
3. implement pure → เทสต์เขียว → `npm run verify` ผ่าน 6/6 → PR → CI เขียว → squash merge ผ่าน REST API → ลบ branch สองข้าง
4. regen CHANGELOG/STATUS → docs commit ตรง main (แพตเทิร์นเดิม)

## 7. Manual check บน production (ตบท้าย)

- A ออฟไลน์ใส่คิว → logout → B login → **badge ของ B ต้องไม่แสดงจำนวนคิวของ A** · หน้า settings ของ B ไม่แสดงรายการของ A → B กด syncAll/ลบ ไม่มีผลต่อคิวของ A → A กลับมา login → badge = จำนวนรายการเดิมที่ A ค้าง · flush ด้วยตัวเองได้ครบ
- การทดสอบกลุ่ม settings.tsx: รายการ (list) และปุ่ม sync/ลบให้ทำงานได้เท่าของตัวเองเท่านั้น — การเลือกทั้งหน้า (select all) ก็ผ่านกับดักเดียวกันที่ flushAction ซึ่งเป็นจุดตัดกลางของทุกเส้นทางที่เข้าถึงคิวด้วย id ตรง ๆ

## 8. ขั้นตอนการนำไปใช้ (ตามกติกา AGENTS)

```
1. backup commit ก่อนแก้ตามปกติ (tree สะอาดอยู่แล้ว = ไม่มีของให้สูญหาย)
2. git checkout -b ai/queue-namespace
3. red: queue-namespace.test.ts (T1-T7) → exit 1 พิสูจน์ก่อนโค้ดจริง
4. เขียว: queue-namespace.ts (pure) + offlineQueue.ts wiring + settings.tsx จุดเดียว
5. npm run verify ผ่าน 6/6
6. commit → push → PR → CI 10/10 → squash ผ่าน REST API → ลบ branch สองข้าง
7. regen changelog/status → docs commit ตรง main
8. รายงานผล + ข้อเสนอ P1 ขึ้นคิวต่อ
```
