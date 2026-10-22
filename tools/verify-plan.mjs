// tools/verify-plan.mjs — นโยบาย build ของ quality gate (pure)
//
// บทเรียน 22/10/69: `npm run verify` สร้าง build ลง sovereign-frontend/.next
// แต่ production `next start` ที่เปิดค้างไว้ยังจำ build เก่าในหน่วยความจำ
// → HTML อ้าง _buildManifest.js/_ssgManifest.js ของ build เก่าที่ถูกลบ → 404
// → React hydrate ไม่ขึ้น → ค้างที่ "กำลังโหลด..." ทั้งระบบ
//
// กติกา:
//   - prod กำลังฟัง :3000 + ไม่ได้รัน e2e → build ลง .next-verify (prod ไม่ถูกแตะ)
//   - e2e ต้องใช้ build จริง + restart prod → คงพฤติกรรมเดิม (แตะ .next)
//   - ไม่มีใครฟัง / เป็น dev → ใช้ .next ตามเดิม
//   - จับชนิด server ไม่ได้ (null) → ถือเป็น prod เพื่อความปลอดภัย (ห้ามทับ)
export function shouldIsolateProdBuild({ e2e = false, listenerPid = 0, serverKind = null } = {}) {
  if (e2e) return false;
  if (!listenerPid) return false;
  return serverKind !== false;
}
