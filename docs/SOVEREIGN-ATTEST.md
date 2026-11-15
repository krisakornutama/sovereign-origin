# SOVEREIGN-ATTEST — ใบรับรองที่เซ็นแล้วและ provenance ของ artifact

> สถานะ: M1 ส่งมอบแล้ว (2026-11-15) · package แยก repo แต่เป็นส่วนหนึ่งของ Sovereign OS
> Repo: <https://github.com/krisakornutama/sovereign-attest> · คิวงาน: [`LIVING-QUEUE.md`](./LIVING-QUEUE.md) §2.2

## ทำไมต้องมี

`sovereign-vault` พิสูจน์ได้ว่า blob ไม่ถูกแก้และ store ไม่ถูกย้อนศร แต่ไม่ได้ตอบคำถามว่า
"ไฟล์นี้คืออะไร ใครรับรอง และรับรองต่อกันมาอย่างไร" — ซึ่งเป็นคำถามที่ต้องตอบให้ได้ก่อนระบบจะโหลด
module หรือปล่อย release ออกไปโดยไม่ต้องเชื่อ cloud ใด ๆ

`sovereign-attest` ตอบด้วย **receipt ที่เซ็นด้วย Ed25519** ต่อ artifact หนึ่งชิ้น:

- **Canonical body** — JSON เรียง key, ไม่มีช่องว่าง, normalize เลข ⇒ ผู้เซ็นและผู้ตรวจ hash ไบต์เดียวกันเสมอ
  `id` = SHA-256 ของ body จึงใช้เป็น path ใน vault ได้ตรง ๆ
- **Chain ต่อ artifact** — `prev` ชี้ receipt ก่อนหน้าของ artifact เดียวกัน ⇒ เขียนประวัติใหม่ต้องมีกุญแจส่วนตัว
- **Standalone** — receipt พก public key ของตัวเองมาด้วย การตรวจจึงไม่ต้องมี vault, registry หรือเน็ต
  ความเชื่อถือมาจากการ **pin กุญแจ** ไม่ใช่จากที่ที่เจอไฟล์
- **ปฏิเสธของปลอมได้จริง** — body ที่ถูกแก้, `id` ที่ไม่ตรง, ลายเซ็นของกุญแจอื่น, และใบที่เซ็นด้วยกุญแจ
  ที่ผู้ตรวจไม่ได้ pin ถูกปฏิเสธพร้อม error code ที่แยกได้

## ทำไมกุญแจอยู่ใน vault

| คุณสมบัติ | vault ให้อะไร |
| --- | --- |
| ความลับ | key blob ถูกผนึก AES-256-GCM — ขโมยโฟลเดอร์ store ไปก็ไม่ได้ private key (พิสูจน์ด้วยเทสต์ที่สแกน blob ดิบ) |
| กันการสลับกุญแจ | vault root hash ทุก entry ⇒ สลับ key blob = root เปลี่ยน = ขัดกับ anchor ที่บันทึกไว้แล้ว |
| กัน GC กินข้อมูล | keys/receipts/heads เป็น entry ใน index ⇒ `pruneOrphans()` (VAULT-009) ลบเฉพาะ blob ที่ไม่มีใครอ้าง — เทสต์ยืนยันว่า prune คืน `[]` |
| กู้ภัย | กุญแจไปกับข้อมูลที่มันรับรอง — restore vault แล้วเซ็นต่อได้ทันที |

**ลำดับการเขียนกัน crash**: เขียน receipt ก่อน แล้วจึงเลื่อน head ⇒ ถ้าตายกลางทางจะเหลือ receipt ที่ยังไม่มีใครชี้
(ตรวจได้ ไม่มีอันตราย) ไม่ใช่ head ที่ชี้ไปที่ว่าง

## การใช้

```ts
import { Attest } from 'sovereign-attest';
import { BlobAnchorLog, FileBlobStore, Vault } from 'sovereign-vault';

const vault = await Vault.open({ store: new FileBlobStore('./data/vault'), masterKey, expectedRoot });
const attest = await Attest.open({ vault, keyId: 'release' });

await attest.record({
  action: 'artifact.built', actor: 'ci',
  artifact: { name: 'sovereign-os-1.3.10.exe', bytes }, storeArtifact: true,
});
const receipt = await attest.record({
  action: 'artifact.shipped', actor: 'release-bot',
  artifact: { name: 'sovereign-os-1.3.10.exe', bytes }, meta: { tag: 'v1.3.10' },
});

await attest.provenance(receipt.body.artifact.sha256);   // เก่า → ใหม่ พร้อมตรวจทุกใบ
await attest.anchor(new BlobAnchorLog(new FileBlobStore('./data/anchors')));
```

ฝั่งผู้ตรวจ (ไม่ต้องมี vault):

```ts
import { openReceipt } from 'sovereign-attest';
const body = openReceipt(receiptFromARegistry, { publicKey: pinnedReleaseKey });
```

## คุณภาพ

- 47 tests · coverage 96.01 statements / 92.77 branches / 98.18 functions / 95.85 lines (gate 90/80/90/90)
- lint (type-aware), typecheck, prettier, build, `npm run example` ผ่าน; CI Node 20 + 22 (builds `sovereign-vault` sibling ก่อน `npm ci`)
- entrypoint: `dist/index.js` + `.d.ts`

## ข้อจำกัดที่ยังเปิด (ต้องคงไว้ในเอกสาร)

- **writer เดียวต่อ vault** — head ต่อ artifact ถูกเลื่อนแบบไม่มี lock; multi-writer sequencing ยังไม่แก้
- **ไม่มี revocation list** — `action: 'artifact.revoked'` chain ได้ แต่ไม่มีอะไรบังคับว่า "ใบก่อนหน้า revocation ใช้ไม่ได้"
- **anchor ยังเป็น checkpoint ที่เรียกเอง** — การเผยแพร่ root ไปยังพยานที่ผู้โจมตีแก้ไม่ได้เป็นงานของผู้ปฏิบัติการ
- **artifact เก็บใน vault เฉพาะเมื่อสั่ง** — ไฟล์ใหญ่ควรอ้างด้วย digest เท่านั้น
- **ยังไม่มีพิธี rotation ที่เซ็นรับรอง** — เปิดด้วย `keyId` ใหม่ได้และ `trustedKeys` รับหลายกุญแจ แต่ยังไม่มี signed rotation statement
- **ยังไม่มีการ gate การโหลด module** — M1 ครอบ provenance ของ artifact; ด่านโหลด module/TPM ตาม `ROADMAP_2036.md` §5.2 ยังเป็นงานถัดไป

## Provenance ของ release จริง (ATTEST-002)

`release.yml` แนบ `SHA256SUMS.txt` ไปกับไฟล์ติดตั้งบนหน้า Release เดียวกัน — ถ้าบัญชี GitHub
ถูกยึด ผู้โจมตีเปลี่ยนทั้งไฟล์และ checksum พร้อมกันได้ checksum จึงกันได้แค่ไฟล์เสีย ไม่กันการปลอม
`tools/attest-release.mjs` ปิดช่องนั้นด้วยใบรับรองที่เซ็นด้วยกุญแจใน vault และ **ผู้ใช้ตรวจได้เองแบบ offline**

### เซ็น (เครื่องเจ้าของ หรือ CI ที่เปิดสวิตช์แล้ว)

```bash
# กุญแจ master 32 ไบต์ (base64) — ห้าม commit; state dir เก็บ vault + anchor log
ATTEST_MASTER_KEY=<base64> node tools/attest-release.mjs --sign   --dir=release-assets --tag=v1.3.11   --previous=<attestation ของรุ่นก่อน>        # ไม่ใส่ก็ได้ = เริ่ม chain ใหม่
node tools/attest-release.mjs --verify release-assets/sovereign-attest.json
```

ผลลัพธ์คือ `release-assets/sovereign-attest.json`: receipt ต่อไฟล์ (name/sha256/size), chain `prev`,
fingerprint ของกุญแจ, vault root และ anchor entry ของรอบนั้น ไฟล์นี้ขึ้น Release ไปพร้อม artifact
เพราะ workflow อัปโหลด `release-assets/*`

### ตรวจ (ผู้ใช้ปลายทาง)

```bash
node tools/attest-release.mjs --verify sovereign-attest.json   --fingerprint=<fingerprint ที่ประกาศไว้ในหน้า release/README>
```

ตัวตรวจใช้ `node:crypto` ล้วน ไม่ต้องติดตั้งอะไรและไม่ต้องต่อเน็ต: ตรวจ hash ของ body, ลายเซ็น Ed25519,
การ chain ต่อ artifact, digest ของไฟล์ที่อ้าง และ fingerprint ที่ pin — แก้ digest ในเอกสาร
หรือสลับใบใน chain จะได้ exit 1 พร้อมเหตุผล (พิสูจน์ใน `tools/test/attest-release.test.mjs`)

### เปิดใช้บน CI

release workflow มีขั้นเซ็นอยู่แล้วแต่ **ปิดโดยปริยาย** — ต้องตั้ง:
- repo variable `ATTEST_ENABLED=true`
- secret `ATTEST_MASTER_KEY` (base64 ของ 32 ไบต์)

ขั้นนี้จะ clone + build `sovereign-vault`/`sovereign-attest` เป็น sibling, ดึง `sovereign-attest.json`
ของ release ล่าสุดมาเป็น `--previous` (ต่อ chain ข้ามรุ่น) แล้วเซ็น + ตรวจซ้ำก่อนอัปโหลด
ไม่ตั้ง variable = ไม่มีใบรับรอง (ดีกว่าใบรับรองที่เซ็นด้วยกุญแจปลอม)

### ข้อจำกัดที่ต้องรู้

- **กุญแจเปลี่ยน = chain ขาด** — ตัวตรวจจะบอกว่า receipt ถูกเซ็นด้วยกุญแจคนละตัวกับ fingerprint ของรุ่นนั้น;
  การ rotate ต้องมี signed rotation statement (ยังไม่มี — อยู่ในข้อจำกัด M1 ด้านบน)
- **fingerprint ต้องประกาศนอกช่องทางเดียวกัน** — ถ้าประกาศไว้ในหน้า Release เดียวกับไฟล์ ผู้โจมตีที่ยึดบัญชีก็แก้ได้
  (ทางที่ถูกคือ README เว็บไซต์ หรือกระดาษในตู้เซฟ)
- **ยังไม่มี revocation** และยังไม่ผูกกับ transparency log — anchor root ในเอกสารพิสูจน์เฉพาะสถานะของรอบนั้น
