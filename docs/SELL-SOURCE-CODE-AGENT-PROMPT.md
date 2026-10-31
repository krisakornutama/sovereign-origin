# ชุด prompt ส่งงานเอเจนต์ — ขาย Source Code ให้ตลาดโลก

> **ไฟล์นี้คืออะไร:** คำสั่งสำเร็จรูปสำหรับยื่นให้เอเจนต์บน platform อื่น (Claude Code · Codex · Cursor · Devin · Gemini CLI)
> เพื่อผลิต "สินค้าซอฟต์แวร์ที่ขายได้จริง" บน repo GitHub **ใหม่** — ไม่ใช่ repo นี้
>
> **ตรวจสถานะ platform ล่าสุด:** 31/10/69 (ดู §1) · ถ้าเกิน 30 วันให้ตรวจซ้ำก่อนใช้
>
> **กติกาการใช้:** copy ทีละบล็อก → วางในเอเจนต์ → แนบไฟล์/ลิงก์ตามที่บล็อกนั้นระบุ
> **ห้าม** วาง secret ลงใน prompt เด็ดขาด — เอเจนต์ต้องอ่านจาก `.env` ที่ gitignore ไว้เท่านั้น

---

## §1 สถานะ platform ของเจ้าของ (ตรวจจากเครื่องจริง 31/10/69)

| Platform | สถานะ | หลักฐานที่ตรวจ | ต้องทำอะไรต่อ |
|---|---|---|---|
| **GitHub** `krisakornutama` | ✅ มีแล้ว | `gh auth status` = logged in · scopes `repo`, `admin:repo_hook`, `delete_repo` | สร้าง repo ใหม่ + ออก **fine-grained PAT** สำหรับเอเจนต์ (ห้ามให้ token ตัวนี้) |
| **Stripe** | ✅ มีแล้ว (live) | `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` (`whsec_…` 38 ตัว) ตั้งใน `sovereign-os/infra/.env` · บัญชีผูก THB → KRUNG THAI •••6505 | ยังไม่ต้องใช้กับสินค้านี้ (ถ้าเลือก MoR) · `STRIPE_LIVE_ENABLED` ยังไม่ตั้ง = ปิดรับเงินจริง |
| **Telegram** | ✅ มีแล้ว | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | ใช้เป็นช่องแจ้งเตือนออเดอร์/ใบเชิญล้มเหลว |
| **Cloudflare** | ✅ มีแล้ว | `CLOUDFLARED_TOKEN` | **ไม่ต้องใช้** — โปรเจ็กต์นี้เป็น desktop-only คุยกับ `127.0.0.1:3001` |
| **Docker + PostgreSQL/TimescaleDB** | ✅ มีแล้ว | container `sovereign-db` + `sovereign-core-api` | ใช้ทดสอบชุดติดตั้ง |
| **Lemon Squeezy (MoR)** | ❌ **ยังไม่มี** | ไม่มี key/env ใด ๆ ในเครื่อง · ไม่มี mention ใน docs | **สมัคร** + ยืนยันตัวตน + ผูกบัญชีรับเงิน |
| **อีเมลธุรกรรม (SMTP)** | ❌ ยังไม่มี | ไม่มี `SMTP_*` ใน `.env` | ใช้ receipt email ของ Lemon Squeezy แทนได้ · ค่อยเพิ่มถ้าต้องส่งเอง |
| **ที่ปรึกษาบัญชี/ภาษี** | ❌ ยังไม่มี | — | ต้องมีก่อนรายได้ถึงเกณฑ์ (ดู §7) |

**สรุป:** เหลือ "ช่องทางขาย" เดียวที่ต้องสมัครจริง ๆ คือ **Lemon Squeezy** — ที่เหลือมีพร้อมแล้ว

---

## §2 สิ่งที่มีจริง vs ไม่มีจริง (ห้ามให้เอเจนต์เดา)

| หัวข้อ | ของจริง |
|---|---|
| โค้ดที่ทดสอบแล้ว | ✅ มี · `npm run verify` เป็นด่านเดียวที่ครอบ arch-gate + frontend gate + backend build/test + frontend typecheck/build |
| Stack จริง | Next.js **16.3** (Pages Router + Turbopack) · Express **4.22** · PostgreSQL + TimescaleDB · Prisma · Electron · Docker Compose |
| Stack ที่ **ไม่มี** | ❌ NestJS · ❌ Next.js 14 · ❌ Kubernetes · ❌ multi-tenant SaaS · ❌ พึ่งคลาวด์ |
| หน้าร้าน / landing page | ❌ ไม่มีใน repo นี้ (ถอดออก 13/10/69 — 53 หน้าเป็นหลังบ้านทั้งหมด) |
| `/api/shop` · `/api/software` | ❌ ไม่ mount แล้ว |
| ระบบ license / activation / download | ❌ **ไม่มีแม้แต่บรรทัดเดียว** (grep = 0) |
| Stripe payments module | ✅ มี (Checkout THB + webhook + สลิป + reconcile) แต่ไม่มีหน้าร้านให้เรียก |
| แคตตาล็อกดิจิทัล 4 ชุด | ⚠️ มีใน**โค้ด seed** (`SW-TAX-CORE` 1,900 · `SW-BIZ-OS` 11,900 · `SW-IOT-FW` 2,500 · `SW-ARCH-BOOK` 1,290) แต่ **ยังไม่เกิดใน DB** — ไม่มีธุรกิจ `SOFTWARE_PROJECT` สักราย |

> **ผลบังคับ:** เอเจนต์ต้องสร้าง "สินค้า" และ "ท่อ" ใหม่ทั้งหมด — ห้ามเขียน prompt ว่า "มีอยู่แล้ว"

---

## §3 MASTER PROMPT (วางบล็อกนี้ในเอเจนต์ตัวหลัก)

````text
# ROLE
You are the release engineer who turns a private, tested codebase into a commercially
sellable source-code product. You work alone, you verify everything, and you never guess.

# PRODUCT FACTS — do not embellish
- Name: Sovereign OS
- What it is: a self-hosted business operating system for small businesses
  (POS, inventory, farm/livestock, energy, treasury, traceability, fleet control)
  with an Electron desktop client and a Node API.
- Verified stack: Next.js 16.3 (Pages Router, Turbopack) · Express 4.22 ·
  PostgreSQL + TimescaleDB · Prisma · Electron · Docker Compose.
- NOT in the product: NestJS, Next.js 14, Kubernetes, multi-tenant SaaS, cloud dependency.
- Quality gates that actually exist:
  `npm run verify` (arch gate + frontend gate + backend build/test + frontend typecheck/build),
  `npm run test:db` (real Postgres), `npm run e2e` (Playwright),
  `npm run test:tools`, and `npm test` inside `sovereign-os/core-api`.
- Every claim on the sales page must be reproducible by the buyer from the delivered repo.
  If you cannot run it, do not claim it.

# HARD RULES
1. Never work in, push to, or copy the git history of the origin repository.
   The origin is read-only input. All production work happens in the NEW repo.
2. Never print, echo, commit, or transmit a secret. Secrets live only in gitignored `.env`
   files. If you find a secret in a file you are about to publish: stop and report it.
3. Every behavior you add ships with a test that failed before your change.
   Report the red exit code and the green exit code.
4. Ask before: setting prices, changing what a license grants, publishing anything public,
   deleting files, or emailing a real customer.
5. No placeholders in the final deliverable: no TODO, no fake screenshots,
   no invented testimonials, no invented customer counts.
6. Small commits, each message stating the behavior change.

# PHASE 0 — Bootstrap the commercial repo
Create a NEW private repository `<owner>/sovereign-os-commercial` and export a clean tree:
  - Copy source WITHOUT `.git`, `node_modules`, `backups/`, `logs/`, `.freebuff/`, `dist*/`.
  - Remove internal documents: `QUEUE.md`, `STATUS.md`, `AGENTS.md`,
    `docs/ops-runbook.md`, `docs/PROJECT-ANALYSIS-*`, `docs/B2B-READINESS-*`.
  - Remove every key material: `tools/agent-pack/keys/`, any `*.pem`, `*.key`.
  - Keep `.env.example`, never `.env`.
  - Rewrite `README.md` for a buyer, not for the original author.
Acceptance:
  - Fresh clone → `npm ci` → `npm run verify` exits 0.
  - `git grep -nE 'sk_live_|whsec_|ghp_|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY'` returns nothing.
  - `git log --oneline` is a curated history (1 commit or a clean squash series).

# PHASE 1 — Package the product
Build `dist/sovereign-os-<version>.zip` containing: `INSTALL.cmd`, `README.md`,
`LICENSE`, `.env.example`, `docs/INSTALL.md`, `SUPPORT.txt` template.
Acceptance:
  - Install on a clean Windows 11 VM with no Node and no Docker preinstalled.
  - The installer either installs prerequisites or fails with an actionable message.
  - After install: machine heartbeat is visible in the hub, and the desktop app boots.
  - Uninstall removes services, scheduled tasks, and shortcuts with no leftovers.

# PHASE 2 — Lemon Squeezy store
Create the store, product(s) and variants. Enable license keys on the product.
Upload the ZIP as the product file (fallback delivery).
Add a required checkout custom field `github_username`.
Configure one webhook subscribing to: `order_created`, `license_key_created`, `order_refunded`.
API facts to use (verify against docs before coding):
  - REST base `https://api.lemonsqueezy.com/v1/`
    headers: `Authorization: Bearer <key>`, `Accept: application/vnd.api+json`.
  - License API base `https://api.lemonsqueezy.com/v1/licenses/`
    (`validate` / `activate` / `deactivate`), `Content-Type: application/x-www-form-urlencoded`,
    `Accept: application/json`.
  - Webhook signature: header `X-Signature` = HMAC-SHA256 **hex** of the raw request body,
    compared with `crypto.timingSafeEqual`.
Acceptance:
  - Test-mode purchase → license key issued → webhook delivered with 2xx →
    buyer receives one email containing the key and the download link.

# PHASE 3 — Delivery automation
Build a small service with `POST /webhooks/lemonsqueezy`:
  - Read the RAW body before any JSON parser runs.
  - Verify `X-Signature`; on failure return 401 and log without payload secrets.
  - Idempotency key = `(order_id, event_name)`; replays must not duplicate side effects.
  - `order_created`: read `meta.custom_data.github_username`, then
    `PUT /repos/{owner}/{repo}/collaborators/{username}` with `{"permission":"pull"}`.
    Handle 201 (invited), 204 (already a collaborator), 404 (unknown user → queue manual follow-up).
  - `order_refunded`: `DELETE /repos/{owner}/{repo}/collaborators/{username}`.
  - Retry with backoff, persist failures, never lose an order.
Acceptance (write these as tests):
  - Valid signature → 200 and exactly one invite after replaying the same event 3 times.
  - Tampered body → 401.
  - Unknown variant → 422 plus an alert.
  - GitHub 404 → order queued for manual follow-up, buyer still gets the ZIP.

# PHASE 4 — Landing page
Sections, in this order: one-line promise → who it is for → what is inside (module list)
→ proof (quality gates table with the real commands and their real output)
→ install in 3 steps → license comparison → FAQ (updates, refunds, GitHub access, no-cloud)
→ buy CTA.
Forbidden: the words "open source", any internal hostname, any link to the origin repo,
any number you did not measure.
Acceptance: every claim is traceable to a file or command in the delivered repo.

# PHASE 5 — Launch checklist
1. Buy with a real card in live mode, then refund it.
2. Confirm email deliverability and that the license validates from a clean machine.
3. Confirm revocation works (refund removes repo access).
4. Write a one-page runbook: how to refund, revoke, resend, and rotate the webhook secret.

# REPORT FORMAT
For each phase return: what changed · files touched · commands run with exit codes ·
evidence (URL or screenshot path) · open questions.

# STOP CONDITIONS
Stop and ask if: a secret would be published, a price or license decision is needed,
a test cannot be made to pass, or buyer data would leave its jurisdiction without a lawful basis.
````

---

## §4 แบ่งงานให้เอเจนต์แต่ละตัว (ใครทำอะไร)

| เอเจนต์ | งาน | Platform ที่ต้องแตะ | Credential ที่ต้องมี |
|---|---|---|---|
| **A — Repo/Sanitize** | Phase 0–1 | GitHub | fine-grained PAT: Contents RW + Administration RW (เฉพาะ repo ใหม่) |
| **B — Delivery** | Phase 3 | Lemon Squeezy + GitHub | LS API key (read) · webhook signing secret · PAT เดียวกับ A |
| **C — Landing** | Phase 4 | ไม่ต้องแตะ platform | ไม่ต้องมี (รับข้อความ/ไฟล์เท่านั้น) |
| **D — Red-team** | ตรวจ Phase 3–4 | test mode | LS test key + บัญชี GitHub ทดสอบ |
| **มนุษย์ (คุณ)** | Phase 2 + ราคา + license scope + ภาษี | Lemon Squeezy dashboard | รหัสผ่าน/2FA ของคุณเท่านั้น |

> **ห้ามให้เอเจนต์ถือ token `ghp_…` ตัวที่ล็อกอินอยู่ตอนนี้** — มันมี scope `delete_repo`
> ออก PAT ใหม่แบบ fine-grained ที่จำกัด repo เดียวและมีวันหมดอายุ

---

## §5 Sub-prompt สำเร็จรูป (สั้น ใช้แยกตัว)

### 5.1 เอเจนต์ A — ทำ repo สินค้าให้สะอาด

```text
Read the master prompt in docs/SELL-SOURCE-CODE-AGENT-PROMPT.md §3 and execute PHASE 0
and PHASE 1 only.

Input: the local path of the origin repository (read-only).
Output: a new private GitHub repo `<owner>/sovereign-os-commercial` plus a release ZIP.

Before you start, print the exact list of files you will exclude and wait for my approval.
After you finish, print: the exclude list you used, the secret-scan command and its output,
`git log --oneline`, and the result of `npm ci && npm run verify` on a fresh clone.
Do not touch anything else.
```

### 5.2 เอเจนต์ B — ทำท่อจัดส่งอัตโนมัติ

```text
Read the master prompt in docs/SELL-SOURCE-CODE-AGENT-PROMPT.md §3 and execute PHASE 3 only.

Context: the Lemon Squeezy product already exists and the webhook already points at my endpoint.
Deliver: the webhook service, its tests, and a `.env.example`.
Write the signature test first and show me it failing before you implement verification.
Do not invent endpoint paths: use exactly the ones in the master prompt.
Report every HTTP status your service can return and why.
```

### 5.3 เอเจนต์ C — เขียน landing page

```text
Read the master prompt in docs/SELL-SOURCE-CODE-AGENT-PROMPT.md §3, PHASE 4.

You have no access to the codebase. Use only the facts listed in "PRODUCT FACTS".
Write: headline, subhead, who-it-is-for, module list, proof table, 3-step install,
license comparison table, 8 FAQs, CTA copy.
For every factual sentence, add an inline comment naming the file or command that proves it.
If a fact is missing, write `[NEEDS OWNER INPUT: <question>]` instead of guessing.
```

### 5.4 เอเจนต์ D — จู่โจมท่อจัดส่ง

```text
You are a red-team reviewer. You did not write this code.

Target: the Lemon Squeezy webhook service in this repo.
Try to break it with: replayed events, out-of-order events, tampered signature,
missing custom_data, unicode GitHub usernames, refund before order, and a 10x burst.
For each attempt report: input, expected behavior, actual behavior, severity, and a failing test
that reproduces it. Do not fix anything — only report.
```

---

## §6 ข้อมูลที่ต้องเตรียมก่อนเริ่ม (มนุษย์เท่านั้น)

- [ ] ชื่อร้าน + อีเมล support + นโยบายคืนเงิน (Lemon Squeezy บังคับกรอก)
- [ ] ยืนยันตัวตนร้าน (KYC) + ผูกบัญชีรับเงิน + แบบฟอร์มภาษี W-8BEN
- [ ] ตัดสินใจ: ขาย **4 ชิ้นแยก** หรือ **3 tier ของชิ้นเดียว** (แคตตาล็อกจริงเป็น 4 ชิ้นคนละเรื่อง)
- [ ] ตัดสินใจ: ราคา USD หรือ THB (แคตตาล็อกเดิมเป็น THB 1,900 / 11,900 / 2,500 / 1,290)
- [ ] ตัดสินใจ: license ให้อะไร — ใช้ได้กี่เครื่อง · ขายต่อได้ไหม · รวมอัปเดตกี่เดือน
- [ ] ตัดสินใจ: ซื้อแล้วได้ ZIP อย่างเดียว หรือได้ invite เข้า private repo (ได้อัปเดตต่อ)
- [ ] เตรียมบัญชี GitHub ทดสอบ 1 ตัว สำหรับยิงเทสต์ invite/revoke

---

## §7 ข้อห้ามและความเสี่ยงที่ต้องรู้ก่อนขาย

1. **ห้ามใช้ repo นี้เป็นสินค้า** — มี `.env` จริง, ประวัติ commit ภายใน, `QUEUE.md`/`ops-runbook.md` ที่ระบุ LAN/IP/โดเมน/ขั้นตอนภายใน
2. **ห้ามให้เอเจนต์เห็น secret** — แม้แต่ใน prompt ที่ "จะลบทีหลัง"
3. **MoR จบภาษีปลายทางให้ แต่ไม่จบภาษีไทย** — รายได้โอนเข้าไทยยังต้องยื่น ภ.ง.ด.90/91 และจด VAT เมื่อเกิน 1.8 ล้านบาท/ปี
4. **ซื้อแล้วคัดลอกต่อได้** — source code ขายแล้วเอากลับไม่ได้ ต้องยอมรับหรือใช้ license แบบผูกเครื่อง/activation (ซึ่ง **ยังไม่มีโค้ด**)
5. **ลูกค้าที่ไม่มี GitHub** — ต้องมี ZIP fallback เสมอ ไม่งั้นเสียเงินฟรี
6. **อย่าโฆษณา stack ผิด** — Next.js 16.3 ไม่ใช่ 14 · Express ไม่ใช่ NestJS · เขียนผิดแล้วลูกค้านักพัฒนาจับได้ทันที

---

## §8 Definition of Done (ติ๊กก่อนประกาศขาย)

- [ ] repo ใหม่: fresh clone → `npm ci && npm run verify` = exit 0
- [ ] secret scan = 0 ผล
- [ ] ติดตั้งบนเครื่องเปล่าได้จริง + uninstall สะอาด
- [ ] ซื้อจริง 1 ครั้ง → ได้ key + invite + ZIP ภายใน 60 วินาที
- [ ] replay webhook 3 ครั้ง → invite ยังมีใบเดียว
- [ ] refund → access ถูกถอนจริง
- [ ] landing page: ทุกประโยคมีหลักฐานอ้างอิง
- [ ] runbook 1 หน้า (refund / revoke / resend / rotate secret)
- [ ] ที่ปรึกษาบัญชีรับทราบโครงรายได้แล้ว
