# SOVEREIGN-VAULT — ชั้นเก็บข้อมูลเข้ารหัสของ Sovereign OS

> สถานะ: M1 + M2 ส่งมอบแล้ว (2026-11-10) · package แยก repo แต่เป็นส่วนหนึ่งของ Sovereign OS
> Repo: <https://github.com/krisakornutama/sovereign-vault> · คิวงาน: [`LIVING-QUEUE.md`](./LIVING-QUEUE.md) §2.1

## ทำไมต้องมี

`sovereign-rule-engine` เก็บ Merkle store และ CRDT register ไว้ในหน่วยความจำ และ sync แบบ 2 peer
โดยไม่มี cloud — จึงต้องการที่เก็บถาวรที่ (1) เข้ารหัสก่อนแตะดิสก์ (2) ตรวจจับการแก้ไขได้
(3) ทำงานได้บนเครื่องราคาถูกที่ไม่มีการเชื่อมต่อ และ (4) ไม่ผูกกับผู้ให้บริการรายใด

`sovereign-vault` ตอบสี่ข้อนั้นด้วย WebCrypto ล้วน ไม่มี runtime dependency:

- **AES-256-GCM ต่อ object** — กุญแจต่อ object มาจาก HKDF-SHA256(masterKey, salt สุ่ม)
- **AAD ผูกบริบท** — header ทั้งก้อน ‖ ชื่อ key ตรรกะ ⇒ แก้ header, สลับ blob ข้าม key, ตัดทอน = decrypt ไม่ผ่าน
- **Index เข้ารหัสแยก** — hash + size ของ plaintext ถูกตรวจซ้ำกับ index ⇒ blob ที่ decrypt ผ่านแต่ไม่ตรงรายการก็ยังถูกปฏิเสธ
- **เขียนแบบ serialize** — `put`/`delete` ที่ interleave กันไม่ทำให้ blob กับ index หลุดจากกัน

## Rollback: สิ่งที่ integrity อย่างเดียวจับไม่ได้

การแก้ blob ทีละไฟล์ถูกจับได้ แต่ "ก๊อป store เก่าทั้งชุดกลับมา" ยังผ่านทุกการตรวจ เพราะทุก blob
ในชุดเก่ายัง authentic ครบ M2 จึงเพิ่มสองพยาน:

1. **`AnchorLog`** — log แบบ append-only ที่เก็บ root ของ index ต่อกันด้วย hash chain
   (`MemoryAnchorLog` สำหรับเทสต์, `BlobAnchorLog` เขียนลง `BlobStore` ใดก็ได้ — ควรเป็นคนละที่กับ vault)
2. **`expectedRoot`** — root ที่ผู้เรียกล่าสุดเก็บไว้นอก vault (keychain/config sync) ใช้เป็น pin

`vault.verifyAnchor(log)` และ `Vault.open({ expectedRoot })` จะโยน `VaultRollbackError`
เมื่อ store ถอยหลัง ทุก entry ใน chain ตรวจได้ว่าไม่มีใครแทรก/ลบ/สลับ และ pin ทำให้แม้การเขียน
anchor log ใหม่ทั้งชุดก็ไม่ผ่าน

## การต่อกับ rule engine

```ts
import { BlobAnchorLog, FileBlobStore, Vault, loadSnapshot, saveSnapshot } from 'sovereign-vault';

const vault = await Vault.open({
  store: new FileBlobStore('./data/vault'),
  masterKey,                     // จาก keychain/ไฟล์นอก vault
  expectedRoot: lastKnownRoot,   // pin จากรอบก่อน
});

const anchors = new BlobAnchorLog(new FileBlobStore('./data/anchors'));
await vault.verifyAnchor(anchors);       // ปิดระบบถ้า store ถอยหลัง

const state = await loadSnapshot(vault, 'rule-engine/crdt'); // boot
// ... หลัง sync round / CRDT change ...
await saveSnapshot(vault, 'rule-engine/crdt', { version: 1, entries });
await vault.anchorNow(anchors);          // checkpoint (nightly หรือตอนปิดเครื่อง)
```

## คุณภาพ

- 64 tests · coverage 98.84 statements / 97.98 branches / 98.78 functions / 99.38 lines (gate 90/80/90/90)
- lint (type-aware), typecheck, prettier, build ผ่าน; CI รัน Node 20 + 22
- entrypoint: `dist/index.js` + `.d.ts` (`npm run build`)

## ข้อจำกัดที่ยังเปิด (ต้องคงไว้ในเอกสาร)

- anchor เป็น **checkpoint ที่เรียกเอง** ไม่ได้ append ทุก `put` — ข้อมูลหลัง checkpoint ล่าสุดกันได้แค่ integrity
- ถ้าไม่มี anchor หรือ pin ที่เก็บนอก vault จะแยก backup เก่าออกจาก store ที่ถูกล้างไม่ได้
- master key เดียวต่อ vault; group key/rotation ยังเป็น M3 (VAULT-006)
- ยังไม่มี compression, dedupe, GC หรือ streaming สำหรับไฟล์ใหญ่ (IDEA-001, VAULT-008)
