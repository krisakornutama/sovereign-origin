# SLO / Observability — "พังแล้วต้องรู้ว่าพังตรงไหน"

> ที่มา: เจ้าของสั่ง 27/10/69 — *"นำระบบนี้ไปเปรียบเทียบกับระบบที่ดีที่สุดของโลก แล้วดึงข้อดีของเขามาปรับปรุง"*
> เลือกเส้นทาง **A: มองเห็นได้** ก่อน เพราะทุกอย่างที่เหลือวัดผลไม่ได้ถ้าไม่มีชั้นนี้
> สถานะ: โค้ด + เทสต์เสร็จแล้ว · **ยังไม่ restart production** (Cold Soak) → ยังไม่มีผลกับเครื่องที่รันอยู่

---

## 1. ปัญหาที่แก้

ก่อนหน้านี้ระบบมี watchdog (docker/frontend/nightly/backup) แต่ขาดสามอย่างพื้นฐานที่ระบบระดับโลกมีครบ:

| สิ่งที่ขาด | อาการจริงที่เคยเกิด | สิ่งที่ใส่เข้าไป |
|---|---|---|
| **request-id** | ผู้ใช้บอก "กดบันทึกแล้วพัง" — ไล่ log ไม่ได้ ต้องเดาจากเวลา | ทุกคำขอมีเลขประจำตัว วิ่งจากเบราว์เซอร์ → API → log |
| **access log แบบโครงสร้าง** | `console.log` กระจัดกระจาย grep ไม่ได้ | JSON 1 บรรทัดต่อ 1 คำขอ (ไม่มี query/header/body) |
| **/metrics** | ไม่มีตัวเลขให้กราฟ/เตือน → "พังแล้วค่อยรู้" | Prometheus text format + SLO/error budget ในเอกสารนี้ |

---

## 2. ของจริงในโค้ด

| ไฟล์ | หน้าที่ |
|---|---|
| `sovereign-os/core-api/src/lib/observability.ts` | `normalizeRequestId` · `accessLogRecord` · `MetricsRegistry` · `prometheusEscape` · `isMetricsAuthorized` (pure logic ทั้งหมด) |
| `sovereign-os/core-api/src/middleware/observability.middleware.ts` | `createObservability()` → `requestContext` + `metricsHandler` · instance กลาง `getObservability()` |
| `sovereign-os/core-api/src/server.ts` | `app.use(getObservability().requestContext)` — ต่อเป็นตัวแรก ๆ ก่อน body parser |
| `sovereign-os/core-api/src/routes.ts` | `GET /api/metrics` (ไม่ผ่าน `authenticate` — Prometheus ไม่มี user) |
| `sovereign-os/core-api/src/config/index.ts` | `config.observability.metricsToken` / `.tenantId` |
| `sovereign-os/core-api/src/middleware/error.middleware.ts` | error response พา `requestId` กลับไปให้ผู้ใช้ |
| `sovereign-frontend/src/lib/requestId.ts` + `apiFetch.ts` | ทุกคำขอจากหน้าเว็บแนบ `x-request-id` |
| เทสต์ | `tests/observability.test.ts` (19) · `tests/observabilityWiring.test.ts` (5) · `src/lib/requestId.test.ts` |

**ไม่เพิ่ม dependency ใหม่เลย** — ใช้ `node:crypto` + `process` เท่านั้น (ตรงกับข้อกำหนด free-first)

---

## 3. เปิดใช้ (เมื่อ Cold Soak จบ)

```bash
# 1) ตั้งค่าใน sovereign-os/infra/.env  — "เจ้าของเท่านั้นที่แก้ไฟล์นี้"
METRICS_TOKEN=<hex 32 bytes>
TENANT_ID=acme-hq          # เว้นว่าง = default
ACCESS_LOG=on              # off = หยุดเขียน access log (metrics ยังนับ)

# 2) ให้มีผล = ต้อง restart core-api (ค่าถูกอ่านตอนบูต)
docker restart sovereign-core-api

# 3) ทดสอบ
curl -s -H "x-metrics-token: $METRICS_TOKEN" http://127.0.0.1:3001/api/metrics | head
curl -si http://127.0.0.1:3001/api/metrics | head -1     # ต้องได้ 401 (ปิดโดยปริญญา)
```

> ⚠️ **ห้ามเปิด `/api/metrics` สู่อินเทอร์เน็ต** — ตัวเลขพวกนี้บอกโครงสร้างภายใน (route, ปริมาณ, สถานะ)
> ให้ scrape จาก `127.0.0.1` หรือในบ้านเท่านั้น · โซนสำเร็จรูปเป็น default-deny อยู่แล้ว จึงไม่ต้องเติม path นี้ใน WAF allowlist (เจตนา)

### Prometheus scrape (ตัวอย่าง — ยังไม่ติดตั้งในเครื่องนี้)

```yaml
scrape_configs:
  - job_name: sovereign-core
    scrape_interval: 30s
    metrics_path: /api/metrics
    authorization:
      credentials: <METRICS_TOKEN>     # ส่งเป็น Authorization: Bearer
    static_configs:
      - targets: ['127.0.0.1:3001']
        labels: { tenant: acme-hq }
```

---

## 4. ตัวเลขที่มีให้แล้ว

| Metric | ชนิด | label | ใช้ตอบคำถาม |
|---|---|---|---|
| `sovereign_http_requests_total` | counter | `method`, `route`, `status` | มี error เพิ่มไหม · route ไหนถูกเรียกบ่อย |
| `sovereign_http_request_duration_ms` | histogram | `method`, `route` | ช้าที่ route ไหน · p95 เท่าไร |
| `sovereign_up` | gauge | `tenant` | process ยังอยู่ไหม |
| `sovereign_process_resident_memory_bytes` | gauge | — | หน่วยความจำรั่วไหม |
| `sovereign_process_uptime_seconds` | gauge | — | เพิ่งรีสตาร์ทหรือเปล่า (uptime ต่ำผิดปกติ = crash loop) |

**`route` เป็น pattern ไม่ใช่ URL จริง** (`/api/users/:id` ไม่ใช่ `/api/users/abc123`) — กัน label ระเบิดจน Prometheus ตาย
**ไม่ log `/healthz` และ `/api/health`** (watchdog ยิงถี่มาก แต่ยังนับใน metrics ตามปกติ)

access log 1 บรรทัด (stdout) มีฟิลด์: `time, requestId, method, path, route, status, durationMs, tenant, userId`
— `path` ถูกตัด query string ทิ้งเสมอ (token ใน query คือรอยรั่วที่พบบ่อยที่สุด) และไม่มี header/cookie/body

---

## 5. SLO ที่ประกาศไว้ (เป้าที่ตกลงกันได้ ไม่ใช่ความฝัน)

ระบบนี้เป็น **single-node ในบ้าน/ร้าน** — SLO ต้องสะท้อนความจริง: ไฟดับ/เน็ตหลุดมีจริง และไม่มีทีม on-call ตอนตี 2

| SLI | ความหมาย | SLO (30 วัน) | วัดจาก |
|---|---|---|---|
| **Availability** | คำขอที่ไม่ใช่ 5xx (ไม่นับ 4xx — ความผิดของผู้เรียก) | **99.5%** | `1 - (5xx / total)` |
| **Latency** | p95 ของคำขอ API | **< 500 ms** (p99 < 1.5 s) | histogram |
| **Error budget** | เวลาที่ "ยอมให้พัง" | **~3 ชม. 36 นาที/เดือน** | 0.5% ของ 30 วัน |
| **Backup freshness** | สำเนา DB ล่าสุดไม่เก่ากว่า | **24 ชม.** (offsite ≤ 7 วัน) | `tools/verify/backup-restore-check.mjs` |
| **Restore drill** | กู้จาก backup ได้จริง | **ผ่านอย่างน้อย 1 ครั้ง/ไตรมาส** | runbook §PITR |
| **Fleet freshness** | เครื่องลูกที่ heartbeat ≤ 15 นาที | **≥ 90%** | `agent_machines.last_seen_at` |

> ตัวเลข 99.5% ตั้งใจให้ *ต่ำกว่า* 99.9% ของ SaaS เพราะเราไม่มีคนเฝ้า 24/7 — SLO ที่ทำไม่ได้จริงแย่กว่าไม่มี SLO
> ถ้าอนาคตขายเป็น product หลายราย (multi-tenant) ต้องแยก SLO ต่อผู้เช่า (label `tenant` มีรออยู่แล้ว)

### PromQL ที่ใช้จริง

```promql
# อัตรา 5xx (SLI availability)
sum(rate(sovereign_http_requests_total{status=~"5.."}[5m]))
  / sum(rate(sovereign_http_requests_total[5m]))

# error budget ที่เหลือ (%) ใน 30 วัน
100 * (1 - (
  sum(increase(sovereign_http_requests_total{status=~"5.."}[30d]))
  / sum(increase(sovereign_http_requests_total[30d]))
) / 0.005)

# p95 latency ต่อ route
histogram_quantile(0.95,
  sum by (route) (rate(sovereign_http_request_duration_ms_bucket[5m])))
```

---

## 6. Error budget policy (สำคัญกว่าตัวเลข)

| ใช้ budget ไป | ทำอะไร |
|---|---|
| < 50% | ทำงานปกติ — ปล่อยฟีเจอร์ใหม่ได้ |
| 50–100% | ลดความเสี่ยง: งด change ที่แตะ auth/payments/DB · ทบทวน alert ที่เงียบเกินไป |
| **> 100% (budget หมด)** | **หยุดฟีเจอร์ใหม่** → ทำ postmortem + แก้สาเหตุ + เพิ่มเทสต์กันซ้ำ จน budget กลับมาเป็นบวก |

**กติกาที่ผูกกับ AGENTS.md ข้อ 8**: ทุกครั้งที่ budget หมด ต้องมีเทสต์ที่ commit ไว้จับอาการนั้น (ไม่ใช่แค่ "แก้แล้วลองรันดู")

---

## 7. สิ่งที่ยังไม่มี (ตามลำดับที่ควรทำต่อ)

1. **ตัวเก็บ log/metrics** — ตอนนี้ log ออก stdout และ metrics อยู่ในหน่วยความจำ ⇒ รีสตาร์ท = ตัวเลขหาย
   ทางเลือกฟรี: Prometheus + Grafana ในเครื่อง (กิน RAM ~300–500 MB) หรือเก็บ JSON log แล้วสรุปด้วย `tools/`
   *ยังไม่ตัดสินใจ — ขึ้นกับสเปกเครื่อง HUB (ข้อ 12 ในคำถามที่ค้าง)*
2. **Trace ระดับ span** (OTel) — request-id ไล่ได้แล้ว แต่ยังไม่รู้ว่าคำขอนั้นใช้เวลาไปกับ DB/MQTT/AI เท่าไร
3. **DB latency + connection pool** — Prisma ยังไม่ถูกวัด (เพิ่มได้ด้วย middleware ของ Prisma, ไม่ต้องมี dependency ใหม่)
4. **Queue depth** (offline queue ฝั่งเว็บ, งาน agent, MQTT ค้าง) — จำเป็นมากเมื่อขายเป็น product
5. **Alert ต่อ SLO** — ตอนนี้ `tools/alerts.mjs` แจ้งเหตุการณ์ (disk/down/backup) แต่ยังไม่มีการเตือน "error budget กำลังหมด"
6. **Per-tenant isolation ของ metrics** — ตอนนี้เป็น `TENANT_ID` เดียวต่อโปรเซส (ถูกต้องสำหรับ 1 เครื่อง = 1 ลูกค้า)

---

## 8. ตรวจสอบโดยไม่แตะ production

```bash
cd sovereign-os/core-api
npx tsx --test tests/observability.test.ts          # 19 ผ่าน
npx tsx --test tests/observabilityWiring.test.ts    # 5 ผ่าน
npx tsc --noEmit                                    # 0 error

cd ../../sovereign-frontend
npx --prefix ../sovereign-os/core-api tsx src/lib/requestId.test.ts
npx tsc --noEmit
```

เทสต์ล็อกกติกาที่ "ห้ามพัง" ไว้แล้ว: id ที่ไม่ปลอดภัยต้องถูกแทน · log ห้ามมี query string · metrics ห้ามคายเมื่อไม่ตั้ง token · label ต้องเป็น route pattern
