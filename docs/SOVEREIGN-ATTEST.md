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
- **rotation statement ยังต้องส่งต่อเอง** — `attest.rotate()` เซ็นใบรับรองกุญแจใหม่แล้ว (ตั้งแต่ v0.2.0 · ATTEST-003)
  แต่ผู้ตรวจจะยอมรับ receipt ของกุญแจใหม่ก็ต่อเมื่อได้ใบนั้นไปด้วย (`provenance({ rotations })` / `--rotation`);
  ยังไม่มีช่องทางเผยแพร่ใบรับรองอัตโนมัติ
- **ยังไม่มีการ gate การโหลด module** — M1 ครอบ provenance ของ artifact; ด่านโหลด module/TPM ตาม `ROADMAP_2036.md` §5.2 ยังเป็นงานถัดไป

## Provenance ของ release จริง (ATTEST-002)

`release.yml` แนบ `SHA256SUMS.txt` ไปกับไฟล์ติดตั้งบนหน้า Release เดียวกัน — ถ้าบัญชี GitHub
ถูกยึด ผู้โจมตีเปลี่ยนทั้งไฟล์และ checksum พร้อมกันได้ checksum จึงกันได้แค่ไฟล์เสีย ไม่กันการปลอม
`tools/attest-release.mjs` ปิดช่องนั้นด้วยใบรับรองที่เซ็นด้วยกุญแจใน vault และ **ผู้ใช้ตรวจได้เองแบบ offline**

### เซ็น (เครื่องเจ้าของ หรือ CI ที่เปิดสวิตช์แล้ว)

```bash
# กุญแจเซ็น: PEM ของกุญแจ release (อยู่นอก repo: E: DocumentsSoverignPinHead.secrets)
node tools/attest-release.mjs --sign --dir=release-assets --tag=v1.3.11   --signing-key-file=../.secrets/attest-release-key.pem   --previous=<attestation ของรุ่นก่อน>        # ไม่ใส่ก็ได้ = เริ่ม chain ใหม่
node tools/attest-release.mjs --verify release-assets/sovereign-attest.json   --fingerprint=1afcc7d951d822a7dfe384d89209aed2
```

ผลลัพธ์คือ `release-assets/sovereign-attest.json`: receipt ต่อไฟล์ (name/sha256/size), chain `prev`,
fingerprint ของกุญแจ, vault root และ anchor entry ของรอบนั้น ไฟล์นี้ขึ้น Release ไปพร้อม artifact
เพราะ workflow อัปโหลด `release-assets/*`

### ตรวจ (ผู้ใช้ปลายทาง)

```bash
node tools/attest-release.mjs --verify sovereign-attest.json   --fingerprint=<fingerprint ที่ประกาศไว้ที่ portfolio/release-verify.html>
```

ตัวตรวจใช้ `node:crypto` ล้วน ไม่ต้องติดตั้งอะไรและไม่ต้องต่อเน็ต: ตรวจ hash ของ body, ลายเซ็น Ed25519,
การ chain ต่อ artifact, digest ของไฟล์ที่อ้าง และ fingerprint ที่ pin — แก้ digest ในเอกสาร
หรือสลับใบใน chain จะได้ exit 1 พร้อมเหตุผล (พิสูจน์ใน `tools/test/attest-release.test.mjs`)

### เปิดใช้บน CI

release workflow มีขั้นเซ็นอยู่แล้วแต่ **ปิดโดยปริยาย** — ต้องตั้ง:
- repo variable `ATTEST_ENABLED=true`
- secret `ATTEST_SIGNING_KEY` (base64 ของ PEM private key) — ตั้งไว้แล้ว 2026-11-15

CI ไม่มี state ของ vault ข้ามรอบ จึงส่งกุญแจเข้ามาเป็น secret แล้ว `--sign` import เข้า vault
ของรอบนั้น (vault ยังผนึกด้วย master key สุ่มต่อรอบ) ⇒ fingerprint คงที่และ chain ต่อด้วย
`--previous` ตัวตนกุญแจจึงไม่ผูกกับดิสก์ของ runner

ขั้นนี้จะ clone + build `sovereign-vault`/`sovereign-attest` เป็น sibling, ดึง `sovereign-attest.json`
ของ release ล่าสุดมาเป็น `--previous` (ต่อ chain ข้ามรุ่น) แล้วเซ็น + ตรวจซ้ำก่อนอัปโหลด
ไม่ตั้ง variable = ไม่มีใบรับรอง (ดีกว่าใบรับรองที่เซ็นด้วยกุญแจปลอม)

### ปล่อย release: แนบใบรับรอง + ประกาศ fingerprint อัตโนมัติ

- `sovereign-attest.json` ถูกเขียนลง `release-assets/` และขึ้น Release ไปพร้อมไฟล์ติดตั้ง
  (workflow ยืนยันด้วย `test -f` ไม่พึ่ง glob เงียบ ๆ)
- หลังเซ็นมีขั้นตรวจเพิ่ม: `--pin-key=docs/keys/attest-release.pub.pem --dir=release-assets`
  ⇒ ถ้า fingerprint ไม่ตรงกุญแจที่ pin ไว้ หรือไบต์ไม่ตรงเอกสาร งานจะแดงก่อน publish
- `tools/attest/release-notes.mjs` เขียนประกาศ fingerprint + คำสั่งตรวจ แล้ว workflow
  ต่อท้ายใน release notes ด้วย `gh release edit --notes-file` **หลัง** publish
  (ไม่พึ่งว่าตัว publish จะ merge body กับ notes ที่ GitHub สร้างให้อย่างไร)
- ถ้าสวิตช์ปิดอยู่ notes จะบอกตรง ๆ ว่า "ไม่มีใบรับรอง" — ไม่ปล่อยให้คนอ่านเดาว่ามี

ซ้อมก่อนปล่อยจริง (ไม่แตะ secret ไม่ปล่อยอะไร):

```bash
npm run release:dry-run
# หรือสั่งจาก GitHub: Actions → Release Desktop → Run workflow → dry_run = true
```

dry-run อยู่ใน `.github/workflows/release-dry-run.yml` (ไฟล์แยก เพราะ `release.yml` เรียกด้วย
ตรวจว่าใบรับรองอยู่ในชุดที่จะแนบ, คำสั่งใน notes รันได้จริง, และข้อความตอนปิดสวิตช์ถูกต้อง

### กุญแจ release ที่ประกาศแล้ว

```
keyId:       release
fingerprint: 1afcc7d951d822a7dfe384d89209aed2
```

public key อยู่ใน repo นี้ที่ [`docs/keys/attest-release.pub.pem`](./keys/attest-release.pub.pem)
(private key ไม่เคยเข้า repo: เก็บที่ `.secrets/` ของเครื่องเจ้าของ + GitHub secret)

**ประกาศสาธารณะ (ช่องทางที่สอง):** <https://sovereignoriginshop.dpdns.org/release-verify.html>
— หน้านั้นอยู่นอก GitHub เก็บโค้ด มี fingerprint เดียวกันและคำสั่งตรวจที่ผู้ใช้คัดลอกไปรันได้เลย
(เป็นช่องทางที่ผู้ใช้ทั่วไปเปิดดูได้; ถ้าจะให้กันได้จริงระดับกายภาพ ควรมีสำเนาบนกระดาษในตู้เซฟด้วย)
ผู้ใช้ที่ไม่มี repo ให้โหลดตัวตรวจสองไฟล์ (`tools/attest-release.mjs` + `tools/attest/document.mjs`)
ตามที่หน้าเว็บบอก แล้วรันตรวจไฟล์ที่ดาวน์โหลดได้ทันที

### Build provenance: ไบต์ที่เซ็นสร้างมาจาก commit ไหน

ใบรับรองบอกได้ว่า "ไบต์ชุดนี้เซ็นด้วยกุญแจของเจ้าของ" แต่ไม่ได้บอกว่าไบต์นั้นมาจากโค้ดชุดไหน
รอบที่ปล่อยจึงผนึก digest ของ `build manifest` ไว้ใน `meta.buildDigest` (พร้อม commit ใน
`meta.buildCommit`) ของ receipt ทุกใบ — sovereign-attest รับ meta เฉพาะ string/ตัวเลข จึงเก็บ
เป็น digest ไม่ใช่ก้อน JSON (อยู่ใน body ที่ถูกเซ็น ⇒ แก้ไม่ได้โดยไม่ทำให้ลายเซ็นขาด) และเขียน
manifest ที่อ่านได้ไว้ที่ `doc.build` ซึ่งตัวตรวจจะคำนวณ digest ซ้ำแล้วเทียบกับที่ผนึกไว้ทุกครั้ง

manifest บรรจุ: commit SHA + ref + dirty · toolchain (node/npm/platform) · sha256 และขนาดของ
ไฟล์ที่ใช้สร้าง (lockfile ของ frontend/core-api, `package.json` ทั้งสอง, `tools/build-desktop.mjs`,
`tools/stage-release.mjs`, `tools/release-build.mjs`, `tools/attest-release.mjs`,
`tools/attest/document.mjs`, `.github/workflows/release.yml`) — ไฟล์ที่ควรมีแต่หายไปถูกบันทึกใน
`missing` ไม่ใช่หายเงียบ · digest = sha256 ของ canonical JSON ของ manifest เอง

```bash
# ดู manifest ของ repo ที่กำลังยืนอยู่ (ไม่ต้องมีกุญแจ)
node tools/attest/build-manifest.mjs --tag=v1.3.11 --out=build-manifest.json

# เซ็นพร้อมผนึก provenance (CI ใช้ไฟล์ที่เขียนไว้; หรือ --provenance เพื่อเก็บสด)
node tools/attest-release.mjs --sign --dir=release-assets --tag=v1.3.11 \
  --build-manifest=build-manifest.json

# ตรวจ: ต้องมั่นใจว่าไบต์มาจาก commit ที่โหลดมาตรวจพอดี
node tools/attest-release.mjs --verify sovereign-attest.json \
  --fingerprint=1afcc7d951d822a7dfe384d89209aed2 --dir=. --build-commit=<sha>
```

ตัวตรวจปฏิเสธเมื่อ: digest ของ manifest ไม่ตรงกับเนื้อหา (ถูกแก้หลังเซ็น) · manifest ในเอกสาร
ไม่ใช่ใบเดียวกับที่ผนึกไว้ในใบที่เซ็น · เอกสารอ้าง manifest แต่ไม่มีใบที่เซ็นแล้วผนึกมัน (หรือกลับกัน) ·
`--build-commit` ไม่ตรงกับ commit ใน manifest · manifest มาจาก working tree ที่สะกปรก (dirty)

**ขอบเขตที่ยังไม่ครอบ:** ยังไม่พิสูจน์ว่า build ซ้ำได้ 100% (reproducible build) — manifest คือ
บันทึกที่ตรวจย้อนได้ว่าเครื่องปล่อยใช้ input อะไร ผู้ตรวจที่อยากพิสูจน์ต่อให้ checkout commit นั้น
แล้วเทียบแฮชของ input กับ manifest

### Rotation: เปลี่ยนกุญแจโดยไม่ทำให้ประวัติขาด

กุญแจเก่าเซ็นใบรับรองกุญแจใหม่ (`sealRotation`) — ใบนี้คือหลักฐานว่า "การเปลี่ยนกุญแจเป็นเจตนาของเจ้าของ"
ไม่ใช่ผู้บุกรุกเซ็นแทน ถ้าไม่มีใบนี้ ผู้ตรวจจะปฏิเสธ receipt ของกุญแจใหม่อย่างถูกต้อง

```ts
import { Attest } from 'sovereign-attest';
const statement = await attest.rotate('release-2027');   // กุญแจเก่า endorse กุญแจใหม่
await attest.provenance(digest, { trustedKeys: { release: oldPublic }, rotations: [statement] });
```

ฝั่ง release tool:

```bash
node tools/attest-release.mjs --sign --dir=release-assets --tag=v1.4.0   --signing-key-file=../.secrets/attest-release-2027.pem   --previous=.attest-prev/sovereign-attest.json   --rotation=../.secrets/rotation-release-2027.json
```

เอกสารที่ได้จะมี `rotations` ฝังอยู่ และตัวตรวจจะยอมรับ receipt รุ่นก่อนที่เซ็นด้วยกุญแจเก่า
โดยเริ่มจาก fingerprint ที่ pin ไว้แล้วเดินถอยหลังตามใบ endorsement — กุญแจแปลกปลอมไม่สามารถ
bootstrap ตัวเองเข้า set ได้ เพราะใบต้องเซ็นด้วยกุญแจที่เชื่ออยู่แล้วเท่านั้น

### เพิกถอน artifact (revoked / restored)

```ts
await attest.revoke({
  artifact: { name: 'app.exe', bytes },
  actor: 'security',
  reason: 'กุญแจบิลด์รั่ว',
  revokedAt: Date.parse('2026-11-01T00:00:00Z'), // มีผลย้อนหลังตั้งแต่เมื่อไร (ไม่ระบุ = ทันที)
});
await attest.revocation(sha256);   // { revoked: true, receipt }
await attest.restore({ artifact: { name: 'app.exe', bytes }, actor: 'owner' });
```

การเพิกถอนเป็น receipt ปกติ ⇒ เซ็น, ต่อ chain, อยู่ใน anchor และตรวจได้ offline; ตัวตรวจ release
ปฏิเสธเอกสารที่ chain มีการเพิกถอน (`artifact.revoked`) เว้นแต่สั่ง `--allow-revoked` โดยเจตนา
และ restore ใหม่กว่าจะยกเลิกให้เองโดยอัตโนมัติ (สถานะล่าสุดชนะ)

`revokedAt` คือวันที่มีผล: เพิกถอนจะครอบเฉพาะ receipt ที่เซ็น**ก่อนหรือเท่ากับ**วันนั้น
(ของที่ปล่อยหลังจากนั้นคือบิลด์ใหม่ ไม่ใช่ของที่ถูกเพิกถอน) — ตัวตรวจอ่าน `meta.revokedAt`
แล้วเทียบกับ `at` ของ receipt ที่เซ็น artifact นั้น และพิมพ์วันที่ทั้งสองฝั่งในข้อความที่ปฏิเสธ

ฝั่ง CLI (ใช้กุญแจเดียวกับตอนเซ็น และต้องอ้างเอกสารรุ่นเดิม):

```bash
# เพิกถอน: ใบใหม่ต่อจาก chain เดิม ⇒ ตัวตรวจทุกรุ่นปฏิเสธบิลด์นี้
node tools/attest-release.mjs --revoke --dir=release-assets --tag=v1.3.11 
  --reason="กุญแจบิลด์รั่ว" --previous=release-assets/sovereign-attest.json \
  --revoked-at=2026-11-01T00:00:00Z   # ไม่ระบุ = มีผลทันที

# คืนสถานะ (เมื่อตรวจแล้วไม่พบปัญหา) — ไม่ต้องเขียนประวัติทับ
node tools/attest-release.mjs --restore --dir=release-assets --tag=v1.3.11 
  --previous=release-assets/sovereign-attest.json
```

### ตรวจไฟล์ที่ดาวน์โหลดมา (ไม่ใช่แค่อ่านเอกสาร)

```bash
# --dir  ⇒ แฮชไฟล์จริงในโฟลเดอร์เทียบกับที่เซ็นไว้ (ขนาด + sha256)
# --pin-key ⇒ เทียบกับ public key ที่ commit ไว้ แทนการพิมพ์ fingerprint เอง
node tools/attest-release.mjs --verify sovereign-attest.json \
  --pin-key=docs/keys/attest-release.pub.pem --dir=.
```

ไฟล์ที่อยู่ในโฟลเดอร์แต่ไม่ได้ถูกเซ็นจะถูกรายงานแยก (`ไม่ถูกเซ็น`) — ไม่ทำให้ตรวจไม่ผ่าน
แต่ควรถามว่ามันมาจากไหน; ไฟล์ที่หาย/ถูกแก้/ขนาดเปลี่ยน ถือว่าไม่ผ่านทันที

CI ตรวจซ้ำเองทุกครั้งที่ปล่อย release (`.github/workflows/attest-verify.yml`):
ดาวน์โหลดไฟล์ที่แจกจริง แล้วรันคำสั่งข้างบน ⇒ ถ้าไบต์ที่ผู้ใช้โหลดไม่ตรงกับที่เซ็น งานจะแดง

### ข้อจำกัดที่ต้องรู้

- **กุญแจเปลี่ยน = chain ขาด** — ตัวตรวจจะบอกว่า receipt ถูกเซ็นด้วยกุญแจคนละตัวกับ fingerprint ของรุ่นนั้น;
  การ rotate ต้องมี signed rotation statement (ยังไม่มี — อยู่ในข้อจำกัด M1 ด้านบน)
- **fingerprint ต้องประกาศนอกช่องทางเดียวกัน** — ถ้าประกาศไว้ในหน้า Release เดียวกับไฟล์ ผู้โจมตีที่ยึดบัญชีก็แก้ได้ ตอนนี้ประกาศไว้ที่ <https://sovereignoriginshop.dpdns.org/release-verify.html> (คนละที่เก็บโค้ด) แต่ทั้งสองที่ยังเป็นบัญชีเดียวกัน — สำเนาบนกระดาษ/ช่องทางที่สามยังคงจำเป็น
  (ทางที่ถูกคือ README เว็บไซต์ หรือกระดาษในตู้เซฟ)
- **ยังไม่มี revocation** และยังไม่ผูกกับ transparency log — anchor root ในเอกสารพิสูจน์เฉพาะสถานะของรอบนั้น
