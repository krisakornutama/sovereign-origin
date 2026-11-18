# UX/UI PLAN — แผนออกแบบระบบหน้าจอ Sovereign OS

> ที่มา: คำสั่งเจ้าของ 2026-11-15 ("พัฒนา UX/UI โดยอาจนำเข้า repo จาก GitHub ที่ได้รับความนิยมมาพัฒนาเพื่อความง่ายและชำนาญ") · คิว: `UX-001`
> กติกาที่ผูกอยู่: `docs/LIVING-QUEUE.md` §1 ข้อ 8 (HOST-SAFE) + ข้อ 9 (แกนงาน) และ `AGENTS.md` ข้อ 1–8

---

## 1. ของจริงในโค้ดตอนนี้ (ฐานที่ต้องไม่พัง)

| ชั้น | ของจริง | ข้อจำกัดที่ด่านตรวจบังคับ |
|---|---|---|
| Framework | Next.js 16 (Pages Router + Turbopack), React 18 | — |
| Styling | TailwindCSS 3.4 + `src/styles/globals.css` (1,129 บรรทัด, design token ทั้งหมด) | ไฟล์นี้เป็น **critical** — ห้ามแก้เว้นแต่เจ้าของสั่ง |
| Primitives | `src/components/ui/*` 15 ตัว (`PageHeader`, `SectionCard`, `StatCard`, `StatusPill`, `EmptyState`, `ErrorNotice`, `SkeletonCard`, `SectionTabs`, `Sparkline`, `QuickDeck`, `HoverCard`, `ConfirmDialog`, `Icon`, `LanguageToggle`, `SectionCard`) | components ≤ 400 บรรทัด |
| Layout | `<Sidebar />` ทุกหน้า · เมนูมาจาก `src/lib/navigation.ts` (critical) | ทุกหน้าใน `src/pages/` ต้องมี Sidebar |
| i18n | `useLanguageStore` + `t('key','fallback')` (th/en) | ห้าม hardcode ข้อความที่ยังไม่มีคีย์ |
| Pages | 56 ไฟล์ใน `src/pages/` (dashboard ถูกแยก component แล้วด้วย IDEA-011/012/013) | pages ≤ 800 บรรทัด (baseline exact-string) |
| Gates | `tools/frontend-gate.mjs` (import-layers, line budget, Sidebar), `tools/arch-gate.mjs` | ต้องผ่านทั้งคู่ |

**สรุป:** เราไม่ต้องเริ่มจากศูนย์ — primitives + token มีอยู่แล้ว ช่องว่างคือ *ความสม่ำเสมอ* (แต่ละหน้าเขียน pattern ของตัวเอง) และ *สถานะจริง* (บาง component ยังมีค่า fallback แต่ง)

---

## 2. วิธี "นำ repo GitHub ยอดนิยมมาใช้" อย่างปลอดภัย

### 2.1 กติกาการนำเข้า (ห้ามละเมิด)

1. **ใช้เป็นต้นแบบโค้ด ไม่ยกทั้งแอป** — คัดเฉพาะ pattern ของ component แล้วเขียนใหม่ให้เข้ากับ token เดิม (`globals.css`)
2. **ตรวจ license ก่อนทุกครั้ง** — รับ MIT / Apache-2.0 / ISC · หลีกเลี่ยง NC / ND / "commons clause" · บันทึกชื่อ repo + license + commit ที่อ้างอิงลงใน entry คิว
3. **ห้ามเพิ่ม dependency ใหม่เอง** — `package.json` เป็นไฟล์ critical (AGENTS ข้อ 4) ต้องขอเจ้าของก่อนทุกครั้ง ⇒ แผนนี้จึงเลือกแนวทาง **copy-in component** (เหมือน shadcn/ui) ที่ใช้แค่ React + Tailwind ที่มีอยู่
4. **ห้ามแตะ OS/Network** — งาน UI ต้องไม่แตะ proxy/firewall/registry (ด่าน `tools/security/host-network-guard.mjs` บังคับอยู่แล้ว)

### 2.2 ผู้สมัครต้นแบบ (ต้องยืนยัน license ณ commit ที่จะใช้)

| Repo | จุดที่อยากได้ | License (ต้องยืนยันก่อนใช้) | ใช้แบบไหน |
|---|---|---|---|
| `shadcn-ui/ui` | โครงสร้าง component + variant pattern (`cva`-less custom), a11y attributes | MIT | pattern ของ `Card/Button/Badge/Tabs/Field` |
| `tremorlabs/tremor` | การ์ดสถิติ + กราฟ + สถานะสีแบบ dashboard | Apache-2.0 | layout การ์ด KPI/chart shell (ไม่ยก chart lib) |
| `tailwindlabs/tailwindcss` + Tailwind UI patterns | spacing scale, focus ring, dark surface | MIT (framework) / commercial (UI kit) | ใช้เฉพาะ pattern ที่ MIT |
| `lucide-icons/lucide` | ชุดไอคอนสม่ำเสมอ | ISC | เราใช้ `components/ui/Icon.tsx` อยู่แล้ว — แมปชื่อไอคอนให้ตรง |
| `radix-ui/primitives` | a11y ของ dialog/tabs/tooltip | MIT | **อ่านเป็น reference เท่านั้น** (เพิ่ม dep ไม่ได้) |

> ทุกครั้งที่เริ่มใช้ repo ใดจริง ให้เพิ่มบรรทัดใน `UX-001` หลักฐานว่า "repo@commit · license · ไฟล์ที่ได้แรงบันดาลใจ"

---

## 3. ช่องว่างที่ต้องปิด (audit)

| # | ปัญหา | หลักฐาน | ผลกระทบ |
|---|---|---|---|
| U1 | แต่ละหน้าเขียน layout/การ์ดเอง ทำให้ spacing/หัวข้อไม่ตรงกัน | 56 pages ใช้ pattern ต่างกัน | ผู้ใช้สับสน, งานแก้ซ้ำ |
| U2 | สถานะ (ok/warn/err/off) แสดงหลายแบบ | `StatusPill` มีอยู่แต่ไม่ได้ใช้ทุกหน้า | อ่านสถานะผิด |
| U3 | Loading/empty/error ยังต่างกันรายหน้า | มี `SkeletonCard`/`EmptyState`/`ErrorNotice` แต่ใช้ไม่ครบ | หน้าเงียบ/ค้างดูเหมือนระบบพัง |
| U4 | ข้อความ i18n บางจุด hardcode | ต้องมีคีย์ th/en ครบ | ภาษาอังกฤษเจอไทยปน |
| U5 | ตาราง/ฟอร์มยังไม่มี primitive กลาง | `settings`, `users`, `audit` เขียนเอง | inconsistency + เสี่ยง a11y |
| U6 | a11y: focus ring/contrast/label บางหน้าไม่ครบ | ไม่มีด่านตรวจ | ใช้งานด้วยคีย์บอร์ด/เครื่องอ่านจอลำบาก |

---

## 4. สถาปัตยกรรม UI ที่จะไปให้ถึง (ไม่แตะ critical files)

```
src/components/ui/            ← ขยายของเดิม (ไม่สร้างระบบใหม่)
  primitives ที่มีอยู่ 15 ตัว
  + Field.tsx        ฟอร์ม 1 แถว: label + hint + error + aria-describedby
  + DataTable.tsx    ตารางเบา ๆ: sort/page ได้ ไม่เพิ่ม dep
  + StatusDot.tsx    จุดสถานะ + label (รวมรูปแบบ ok/warn/err/off)
  + PageState.tsx    รวม Skeleton / Empty / Error เป็นตัวเดียว (เลือกโหมด)
src/components/<domain>/      ← composition ต่อโดเมน (เดิม)
src/pages/*.tsx               ← หน้าเป็น "ประกอบ" เท่านั้น ไม่มี logic ซ้ำ
```

**หลักการ:** primitive ไม่รู้จัก API · หน้าไม่รู้จัก style ดิบ (ใช้ token) · ทุกสถานะต้องมี 4 หน้าตา: loading / empty / error / data

---

## 5. ลำดับส่งมอบ (slices) + เกณฑ์ปิดงาน

### Slice 1 — UI kit ให้ครบ (ปิด U2/U3/U5)
- เพิ่ม `Field`, `DataTable`, `StatusDot`, `PageState` (+ stories/ตัวอย่างในหน้า `hover-cards` ที่มีอยู่แล้ว)
- ใช้ `StatusPill`/`PageState` แทนโค้ดซ้ำใน 3 หน้าที่แตะ
- **เกณฑ์ปิด:** `npm run typecheck` + `npm run build` ที่ MAIN ผ่าน · `tools/frontend-gate.mjs` ผ่าน (budget) · `node tools/host-smoke.mjs` เขียว · ไม่มี dep ใหม่

### Slice 2 — 3 หน้าที่ใช้บ่อยสุด (dashboard / security / farm)
- dashboard: จัดลำดับการ์ด KPI → กราฟ → ตารางล่าสุด, ใช้ `PageState` แทน fallback เงียบ
- security: รวม panel ให้เป็น flow เดียว (สถานะ → เหตุการณ์ → การกระทำ), ใช้ `StatusDot`
- farm: ตาราง/ฟอร์มใช้ `DataTable` + `Field`
- **เกณฑ์ปิด:** แต่ละหน้า ≤ 800 บรรทัด (แยก component ถ้าจำเป็น) · Sidebar ยังอยู่ · ข้อความ th/en ครบ · ภาพก่อน/หลังแนบใน entry

### Slice 3 — a11y + ความสม่ำเสมอ (ปิด U1/U4/U6)
- โฟกัสรีง/คอนทราสต์/`aria-label` ครบ, ปุ่มไอคอนทุกตัวมีชื่อ, ฟอร์มผูก label
- สแกนคีย์ i18n ที่ขาด (`t()` fallback) แล้วเติม th/en
- **เกณฑ์ปิด:** ตรวจด้วยคีย์บอร์ดไล่ 3 หน้าหลักได้ครบ · ไม่มีข้อความ hardcode ใน 3 หน้า · `frontend-gate` + smoke เขียว

---

## 6. ด่านกันถอยหลัง (ต้องมีก่อน merge ทุก slice)

| ด่าน | คำสั่ง | เกณฑ์ |
|---|---|---|
| HOST-SAFE | `node tools/security/host-network-guard.mjs` | 0 hit |
| ใช้งานได้ปกติ | `node tools/host-smoke.mjs` | exit 0 (API/DB/เว็บ/container/task) |
| โครงสร้าง UI | `node tools/frontend-gate.mjs` | ผ่าน (Sidebar + budget + import-layers) |
| คุณภาพรวม | `npm run verify` (ที่ MAIN) | 6/6 |

> งาน UI **ห้าม** ทำให้ `host-smoke` แดง — ถ้าแตะ frontend build ให้รัน smoke หลัง build เสมอ (กฎ HOST-002)

---

## 7. สิ่งที่ *ไม่* ทำในแผนนี้

- ไม่เปลี่ยน design token ใน `globals.css` (critical) — ถ้าจำเป็นต้องมี proposal แยกให้เจ้าของอนุมัติ
- ไม่แตะ `_app.tsx` / `_document.tsx` / `navigation.ts` / stores
- ไม่เพิ่ม dependency (chart lib, UI kit, icon package) ก่อนได้รับอนุญาต
- ไม่แตะระบบเน็ต/พร็อกซี/ไฟร์วอลล์ของเครื่อง (ด่าน HOST-SAFE)
