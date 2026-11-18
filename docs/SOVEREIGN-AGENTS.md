# SOVEREIGN-AGENTS — ด่าน action ของ agent ที่ต้องมีใบรับรองก่อนแตะข้อมูล

> สถานะ: M1 ส่งมอบแล้ว (2026-11-18) · package แยก repo แต่เป็นส่วนหนึ่งของ Sovereign OS
> Repo: <https://github.com/krisakornutama/sovereign-agents> · คิวงาน: [`LIVING-QUEUE.md`](./LIVING-QUEUE.md) §2.2

## ทำไมต้องมี

`sovereign-attest` พิสูจน์ได้ว่า "ไฟล์นี้ถูกอ้างอะไร ใครรับรอง" และ `sovereign-vault` พิสูจน์ได้ว่า
"ข้อมูลไม่ถูกแก้ ไม่ถูกย้อนศร" — แต่ทั้งสองตัวยังไม่ตอบคำถามที่สำคัญที่สุดเมื่อมี **agent** ลงมือแทนคน:

- agent เรียก action ไหนไปแล้วบ้าง ใครสั่ง และสั่งด้วยสิทธิ์อะไร
- ถ้า handler พังกลางทาง มีหลักฐานว่า "เริ่มทำแล้ว" หรือไม่
- denial (ปฏิเสธเพราะไม่มีสิทธิ์) ถูกบันทึกไหม หรือหายเงียบ
- หลักฐานจะไม่กลายเป็นที่รั่วของข้อมูลที่ agent แตะหรือเปล่า

`sovereign-agents` ตอบด้วยการบังคับลำดับเดียว: **ใบรับรองก่อน ผลข้างเคียงทีหลัง** ทุก action ต้องผ่าน
`AgentGate.run()` ซึ่ง

1. ตรวจสิทธิ์ของ principal (deny-by-default จาก registry)
2. **ผนึก receipt `agent.action.requested` ลง vault ให้สำเร็จก่อน**
3. จึงเรียก handler
4. แล้วผนึก `agent.action.completed` หรือ `agent.action.failed` ปิดท้าย

ถ้าข้อ 2 ไม่สำเร็จ handler จะไม่ถูกเรียกเลย (fail closed) — ไม่มี action ที่ไม่มีหลักฐาน

## หลักประกันที่บังคับด้วยเทสต์

| หลักประกัน | กลไก |
| --- | --- |
| **Deny-by-default** | allow-list คือ registry เท่านั้น action ที่ไม่รู้จักถูกปฏิเสธ **และ** มี receipt `agent.action.denied`; handler ไม่ถูกเรียก |
| **Receipt ก่อนข้อมูล** | `requested` ถูกผนึกและเขียนลง vault ก่อนบรรทัดที่เรียก handler — เขียนไม่ได้ = `receipt-required` และไม่รัน |
| **หลักฐานของ denial** | ขาด scope แล้ว receipt บันทึกชื่อ scope ที่ขาด ⇒ การเปลี่ยน policy ตรวจย้อนได้ |
| **Data minimisation** | args และผลลัพธ์เก็บ **เฉพาะ SHA-256 digest** — ไม่มี plaintext, ไม่มี secret/PII ลง vault ⇒ receipt เผยแพร่ได้ |
| **หนึ่ง chain ต่อ actor** | stream = `sha256(canonical({ kind: 'sovereign-agents/actor', v: 1, id }))` และ `run()` จัดคิวต่อ actor ⇒ เรียกพร้อมกันไม่ทำให้ chain แตก |
| **กันแก้/กันลบ** | receipt เซ็นด้วยกุญแจใน vault; แก้ body, ลบใบกลาง chain, หรือเอาใบของ vault อื่นมาเสียบ = ตรวจไม่ผ่าน |
| **กันย้อนศร** | `anchor()` ฝาก vault root ไว้ใน append-only log; `checkAnchor()` พังทันทีเมื่อประวัติถูกตัดทอน |
| **ตรวจที่อื่นได้** | `verify(receipt)` / `verifyHistory(actor)` ทำงานจาก receipt + กุญแจที่ pin ไว้เท่านั้น |

**สัญญาณความล้มเหลวเป็นส่วนหนึ่งของ API**: handler ที่ throw จะกลายเป็น `handler-failed`
**หลังจาก**มี receipt `failed` แล้ว และ `cause` เดิมถูกเก็บไว้ให้ผู้เรียก — แต่ลงใน receipt แค่ *รหัส*
ข้อผิดพลาด (`error` หรือ code ที่ผ่าน `^[A-Za-z0-9._-]{1,64}$`) ไม่ใช่ข้อความ ซึ่งอาจพา secret ไปด้วย

## ใบรับรองหน้าตาอย่างไร

```json
{
  "action": "agent.action.requested",
  "actor": "agent:planner",
  "artifact": { "name": "agent-action:agent:planner", "sha256": "<digest ของ stream>" },
  "at": 1731400000000,
  "prev": "<id ของ receipt ก่อนหน้าของ actor นี้>",
  "meta": {
    "action": "notes.create",
    "request": "<sha256 ของ args แบบ canonical>",
    "mutating": "true",
    "scopes": "notes:write"
  }
}
```

`sovereign-attest` ห่อ body นี้ด้วยลายเซ็น Ed25519 อีกชั้น; `id` = SHA-256 ของ canonical body
จึงใช้เป็น path ใน vault ได้ตรง ๆ — สองเครื่องเทียบประวัติกันได้โดยไม่ต้องส่งข้อมูลที่ agent แตะ

## การใช้

```ts
import { MemoryBlobStore, Vault, randomBytes } from 'sovereign-vault';
import { AgentGate, AgentsError } from 'sovereign-agents';

const vault = await Vault.open({ store: new MemoryBlobStore(), masterKey: randomBytes(32) });
const gate = await AgentGate.open({ vault, keyId: 'agent-gate' });

gate.register<{ text: string }>(
  'notes.create',
  async (args, context) => {
    // ณ จุดนี้ receipt มีอยู่บนดิสก์แล้ว (context.receiptId)
    return notes.insert(args.text);
  },
  { scopes: ['notes:write'], mutating: true, description: 'Create one note' }
);

const planner = { id: 'agent:planner', scopes: ['notes:write'] };
const { value, receipts } = await gate.run(planner, 'notes.create', { text: 'self-hosted' });

const report = await gate.verifyHistory(planner.id); // ตรวจทุก signature + prev link
```

ลงทะเบียนซ้ำชื่อเดิม = โยน error ไม่ใช่ทับเงียบ ๆ และ `gate.actions()` คือ allow-list ทั้งหมดที่ gate นี้ยอมทำ

## ฝั่งผู้ตรวจ (ไม่ต้องมี gate)

```ts
const report = await gate.verifyHistory('agent:planner');  // เก่า → ใหม่, ตรวจทุกใบ
const body = gate.verify(receiptFromTheWire);              // ตรวจใบเดียวด้วยกุญแจที่ pin ไว้
await gate.anchor(anchorLog);                              // ฝาก root ไว้กันย้อนศร
await gate.checkAnchor(anchorLog);                         // ประวัติถูกตัด = พังตรงนี้
```

## คุณภาพ

- 41 tests · coverage 99.31 statements / 94.84 branches / 96.96 functions / 99.28 lines (gate 90/80/90/90)
- red-first: ย้าย handler ไปก่อนการผนึก receipt ⇒ เทสต์แดง 4 ใบ (`exit 1`) → คืนไฟล์ ⇒ 41/41 เขียว (`exit 0`)
- lint (type-aware), typecheck, prettier, build, `npm run example` ผ่าน; CI Node 20 + 22
  (clone + build `sovereign-vault` และ `sovereign-attest` เป็น sibling ก่อน `npm ci`)
- entrypoint: `dist/index.js` + `.d.ts`

## ข้อจำกัดที่ยังเปิด (ต้องคงไว้ในเอกสาร)

- **writer เดียวต่อ vault** — gate จัดลำดับ chain *ภายใน process เดียว*; สอง process เขียน vault เดียวกัน
  ยังสลับ head กันได้ ⇒ multi-writer sequencing เป็นงานของ `sovereign-fabric` (`FABRIC-001`)
- **policy คงที่** — scope ประกาศตอน `register()`; การมอบอำนาจแบบมีวันหมดอายุ/ต่อ tenant
  ต้องมีแหล่ง policy ที่ถูก receipt เองด้วย
- **เป็นหลักฐาน ไม่ใช่การป้องกัน** — gate พิสูจน์ว่าอะไรวิ่ง; module ที่แตะข้อมูลต้องเข้าถึงได้ทาง gate เท่านั้น
  หลักประกันจึงจะจริง — นี่เป็นกติกาสถาปัตยกรรม ไม่ใช่คุณสมบัติของ library
- **กันย้อนศรต้องมี anchor** — ต้องเรียก `anchor()` ฝาก root ไว้ที่ที่ผู้โจมตีแก้ไม่ได้; ถ้าอยู่ใน vault เดียวกัน
  การตัดท้ายประวัติจะดูเป็นประวัติที่สั้นแต่ถูกต้อง
- **digest ไม่ใช่เนื้อข้อมูล** — receipt พิสูจน์ว่า *คำขอไหน* วิ่ง ไม่ได้เก็บว่าข้างในคืออะไร ⇒ จะ replay ต้องได้ข้อมูลจากที่อื่น
- **กุญแจถูกยึด = chain กู้ไม่ได้** — ต้อง rotate (rotation statement ของ `sovereign-attest`) และประกาศกุญแจใหม่;
  ใบที่เซ็นด้วยกุญแจที่ถูกขโมยยังใช้ได้สำหรับผู้ที่ยังเชื่อกุญแจนั้น
