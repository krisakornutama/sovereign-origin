# LICENSE — ขายเองได้ด้วยไลเซนส์ออฟไลน์

> สถานะ 9 พ.ย. 69: **มีระบบแล้ว (v1)** — `sovereign-os/core-api/src/services/license.service.ts`
> + CLI เจ้าของ `tools/license/issue.mjs` + เทสต์ใน `npm run test:tools`
> เดิม `docs/SELL-SOURCE-CODE-AGENT-PROMPT.md` §2 ระบุว่า "ไม่มีแม้แต่บรรทัดเดียว" — ตอนนี้มีแล้ว

## 1. หลักคิด: ทำไมต้องออฟไลน์

สินค้านี้ขายให้คน **ติดตั้งในบ้าน/ร้านของตัวเอง** และโฆษณาว่า *zero-cloud-by-default*
ถ้าการตรวจสิทธิ์ต้องต่อเน็ต ก็ขัดกับคำโฆษณาข้อแรกของตัวเอง

→ ไลเซนส์จึงเป็น **ไฟล์ที่เซ็นด้วย Ed25519** ซึ่งเครื่องลูกค้าตรวจได้เองโดยไม่ต้องมีเซิร์ฟเวอร์ของเรา

## 2. รูปแบบ token

```
base64url(payloadJson) "." base64url(ed25519_signature_of_payloadSegment)
```

payload (v1):

```json
{
  "v": 1,
  "id": "lic_ab12cd34",
  "licensee": "ร้านตัวอย่าง",
  "tier": "business",
  "features": ["/business", "/inventory", "/treasury"],
  "issuedAt": "2026-11-09T00:00:00.000Z",
  "expiresAt": "2027-11-09T00:00:00.000Z",
  "maxMachines": 2,
  "machineHashes": ["<sha256 ของ machine id>", "..."]
}
```

- `expiresAt: null` = ซื้อขาด
- `machineHashes: []` = ไม่ผูกเครื่อง (ใช้ได้ทุกเครื่อง — เหมาะกับ tier ถูกสุด)
- `features: ["*"]` = ทุกฟีเจอร์ใน tier
- ลงนามบน **ตัวอักษรของ segment** ตรง ๆ → ไม่มีปัญหา canonical JSON

## 3. วิธีใช้ (เจ้าของ)

```bash
# 1) สร้างคู่คีย์ครั้งเดียว — เก็บ private key นอก repo เสมอ
node -e "const c=require('node:crypto');const{privateKey,publicKey}=c.generateKeyPairSync('ed25519');require('node:fs').writeFileSync('license-priv.pem',privateKey.export({type:'pkcs8',format:'pem'}));require('node:fs').writeFileSync('license-pub.pem',publicKey.export({type:'spki',format:'pem'}))"

# 2) machine id ของเครื่องลูกค้า (ลูกค้ารันเอง หรือเราขอ hostname มา)
node tools/license/issue.mjs machine-id --raw "customer-laptop-01"

# 3) ออกไลเซนส์ (token ออกทาง stdout — ส่งให้ลูกค้าทางอีเมล/ไฟล์)
node tools/license/issue.mjs issue --key license-priv.pem \
  --licensee "ร้านตัวอย่าง" --tier business \
  --features /business,/inventory,/treasury \
  --machines <machine-id> --days 365 --out license.txt

# 4) ตรวจก่อนส่ง (ต้อง exit 0)
node tools/license/issue.mjs verify --token @license.txt --public-key license-pub.pem --machine <machine-id>
```

ฝั่งลูกค้า: ใส่ค่าใน `.env`

```
SOVEREIGN_LICENSE=<token>
SOVEREIGN_LICENSE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
```

แล้วแอปเรียก `licenseStatusFromEnv(process.env, machineId)` ได้เลย (คืน `null` = ยังไม่ตั้งไลเซนส์)

## 4. ท่อขายเอง (ไม่ต้องมีคนเฝ้า)

```
Lemon Squeezy / Gumroad (MoR)
   └─ order_created → webhook (หรืออีเมลแจ้งเจ้าของ)
        └─ ออกไลเซนส์ด้วย CLI (ครั้งละไม่กี่วินาที)
             └─ ส่ง token + ไฟล์ติดตั้งให้ผู้ซื้อ
                  └─ ผู้ซื้อติดตั้ง + ใส่ .env → แอปตรวจเอง (ออฟไลน์)
```

สิ่งที่ยังไม่มีโดยเจตนา: **license server / activation API** — เพราะจะทำให้สินค้าต้องพึ่ง cloud
ของเราเอง ซึ่งขัดกับจุดขาย · ถ้าอนาคตต้องการ self-service 100% ให้เพิ่ม webhook service
แยก (ตาม `docs/SELL-SOURCE-CODE-AGENT-PROMPT.md` Phase 3) ไม่ใช่ฝังใน core-api

## 5. Threat model (ซื่อตรง)

| ทำได้ | ทำไม่ได้ |
|---|---|
| กันการแก้ payload (tier/features/วันหมดอายุ) เพราะลายเซ็นพัง | กันการก็อป token ไปใช้บนเครื่องที่ hash ตรง (ต้องมี machineHashes) |
| ผูกกับเครื่องผ่าน hash ของ machine id | กัน VM clone ที่ machine id เดียวกัน (ยอมรับ — ต้นทุนต่ำกว่า) |
| หมดอายุแล้วตัดสิทธิ์ทันที | revoke แบบออนไลน์ทันที (ใช้ "อายุสั้น + ต่ออายุ" แทน) |
| ตรวจได้โดยไม่ต้องมีเน็ต | กันการ crack binary (ซอร์สโค้ดขายแล้ว — ยอมรับตาม §7 ของเอกสารขาย) |

**ผลบังคับด้านราคา:** ไลเซนส์แบบ "ซื้อขาด" ต้องคิดราคาสูงพอที่จะไม่ต้องตามเก็บ และควรมี
`maxMachines` ชัดเจนตั้งแต่ใบแรก

## 6. Tier ที่แนะนำ (ยังไม่ล็อกราคา — เจ้าของตัดสิน)

| tier | features | การผูกเครื่อง | เหมาะกับ |
|---|---|---|---|
| `home` | `/dashboard`, `/sensors`, `/alerts`, `/energy` | 1 เครื่อง | บ้านหลังเดียว |
| `business` | + `/business`, `/inventory`, `/treasury`, `/reports` | 1–3 เครื่อง | ร้าน/ฟาร์ม |
| `pro` | `*` | ต่อรองรายราย | หลายสาขา/ตัวแทน |

## 7. Runbook

| สถานการณ์ | ทำอะไร |
|---|---|
| ลูกค้าเปลี่ยนเครื่อง | ออกใบใหม่ด้วย machine id ใหม่ (`--id` เดิมได้) แล้วเพิกถอนใบเก่าด้วยการไม่ออกต่อ |
| คีย์รั่ว (private key หลุด) | สร้างคู่ใหม่ → ออกไลเซนส์ใหม่ทั้งฟลีต → เปลี่ยน `SOVEREIGN_LICENSE_PUBLIC_KEY` (คีย์เก่าหมดอายุตามรอบ) |
| ตรวจว่า token ใช้ได้จริง | `verify` ด้วย public key + machine id เดียวกัน (exit 0) |
| ต้องการให้หมดอายุเร็วขึ้น | ออกใหม่ด้วย `--days` น้อยลง (ใบเก่าตายเองตามวัน) |

> ห้าม commit `license-priv.pem` · ห้ามพิมพ์ private key ลงแชท/ล็อก · ห้ามใส่ private key ใน CI

## 8. การบังคับสิทธิ์ในแอป (ต่อเข้า API แล้ว 9 พ.ย. 69)

| ชิ้นส่วน | ที่อยู่ |
|---|---|
| สถานะไลเซนส์ | `GET /api/license` (ต้อง login) → `{mode, configured, valid, reason, tier, features, expiresAt, daysLeft, licensee, licenseId, machineBound, expiringSoon}` |
| middleware | `licenseGuard('/reports')` ต่อจาก `featureGuard` ใน `routes.ts` — ใช้ที่ `/api/reports`, `/api/inventory` (+ waste) |
| UI | การ์ดในหน้า `/system` (โหมด · tier · วันหมดอายุ · เหลือกี่วัน) |

**กติกา CE (สำคัญ):** ยังไม่ตั้งไลเซนส์ **หรือ** ไลเซนส์ไม่ผ่าน (หมดอายุ / ผิดเครื่อง / ลายเซ็นพัง / ไม่มี public key)
= ปล่อยผ่านทุกฟีเจอร์ เพราะเครื่องนี้เป็นของลูกค้าและข้อมูลเป็นของเขา — ไลเซนส์หมดอายุต้องไม่ล็อกเอาต์

บังคับสิทธิ์เฉพาะเมื่อ **ไลเซนส์ผ่าน** เท่านั้น: ฟีเจอร์นอก `features` → `403 { code: 'LICENSE_FEATURE_NOT_ENTITLED' }`
ที่ middleware (ไม่ใช่ซ่อนเมนู) · `features: ["*"]` = ทุกฟีเจอร์

`GET /api/license` ไม่คืน token, public key หรือ machine hash และตอบ `Cache-Control: no-store`
(มีเทสต์ `tests/licenseGate.test.ts` ล็อกไว้ 11 เคส: CE / ผ่าน / หมดอายุ / ผิดเครื่อง / ลายเซ็นพัง / wildcard / 401)
