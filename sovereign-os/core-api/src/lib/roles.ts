// แหล่งความจริงเดี่ยวของ role ที่ใช้สั่งงาน (RBAC)
//
// ทำไมต้องมี: ก่อนหน้านี้ชุด ['SUPERADMIN','NODE_ADMIN','OPERATOR'] ถูกประกาศซ้ำ
// 14 ที่ (โมดูล 11 + service 1 + เทสต์ 2) และมี requireRole('SUPERADMIN')
// เขียนสด 128 จุด ⇒ เพิ่ม/ถอด role ทีต้องไล่แก้ทั้งระบบ และพลาดง่ายจนมีช่อง
// (เคสจริง SEC-047/048: device PUT ใช้ role ผิดชุด, actuation เปิดให้ SITE_ADMIN)
//
// กติกา: โมดูล **ห้าม** ประกาศ role array เอง — ใช้ค่าจากไฟล์นี้ (มี static test
// `tests/roleSourceOfTruth.test.ts` คอยจับ) ถ้าต้องชุดใหม่ ให้เพิ่มที่นี่ที่เดียว
// พร้อมเหตุผลว่าใครควรมีสิทธิ์

/** ทุก role ที่มีในระบบ (ตรงกับ Prisma enum Role) */
export const ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'SITE_ADMIN', 'OPERATOR', 'SYSTEM_AI', 'KID'] as const;

export type Role = (typeof ROLES)[number];

/** ระดับองค์กร — เห็นทุก node/ทุกสาขา (ใช้กับ firewall, device สร้าง/ลบ, clone) */
export const SUPERADMIN_ONLY = ['SUPERADMIN'] as const;

/** ผู้ดูแลระดับ node — ไม่เห็นข้าม node แต่เห็นทุกสาขาใน node ตัวเอง */
export const ADMIN_ROLES = ['SUPERADMIN', 'NODE_ADMIN'] as const;

/** เขียนข้อมูลธุรกิจ (ฟาร์ม/สต็อก/พลังงาน/ปศุสัตว์ ฯลฯ) — OPERATOR ทำได้ */
export const WRITE_ROLES = [...ADMIN_ROLES, 'OPERATOR'] as const;

/** เขียนข้อมูลระดับสาขา — SITE_ADMIN เห็น/แก้เฉพาะ assigned_site_id ของตัวเอง */
export const SITE_WRITE_ROLES = [...ADMIN_ROLES, 'SITE_ADMIN', 'OPERATOR'] as const;

/**
 * role ที่ "มอบให้ผู้ใช้คนอื่นได้" ผ่าน /api/users และคำเชิญ
 * ไม่รวม SYSTEM_AI/KID โดยเจตนา — เชิญ SYSTEM_AI เข้ามาคือให้ AI มี token
 * และ KID ถูกสร้างผ่าน flow ผู้ปกครองเท่านั้น
 */
export const ASSIGNABLE_ROLES: readonly string[] = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR', 'SYSTEM_AI', 'SITE_ADMIN'];
