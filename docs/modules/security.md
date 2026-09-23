# โมดูล security

## เจตนา

_(เจ้าของโมดูลเติม — 1–3 บรรทัด: โมดูลนี้มีอยู่เพื่ออะไร ใครใช้)_

## ข้อห้าม / ระวัง

_(เจ้าของโมดูลเติม — อะไรที่ห้ามแตะ/ต้องระวังเป็นพิเศษ)_
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`firewall_config` · `firewall_rules` · `threat_intel_items`

### Routes
- `security/nextgen.routes.ts` (365 บรรทัด)
- `security/security.routes.ts` (315 บรรทัด)

### Endpoints (จาก router)
```
GET /status
GET /intel
GET /intel/stats
POST /intel
PUT /intel/:id/toggle
DELETE /intel/:id
POST /intel/update-feeds
POST /intel/check
GET /dns/stats
GET /dns/top-blocked
GET /dns/clients
GET /dns/queries
POST /dns/block
POST /dns/allow
GET /ids/alerts
GET /av/status
POST /av/scan
GET /apps
PUT /apps/:id
PUT /apps/category/:category
POST /apps/custom
DELETE /apps/custom
GET /apps/blocklist
POST /apps/sync-pihole
GET /network/devices
GET /ai/last
POST /ai/analyze
GET /kill-switch
PUT /kill-switch
GET /first-responder
PUT /first-responder
GET /reality
POST /reality/correct
GET /drill
POST /drill
GET /time-consensus
POST /time-consensus/check
GET /connections
GET /firewall
GET /firewall/blocks
… อีก 15 เส้น
```

### Services ที่ทำงานให้โมดูลนี้
`firewall-engine.service` · `hash-engine.service` · `ids-reader.service` · `threat-detection.service` · `threat-intel.service`

<!-- auto:end -->
