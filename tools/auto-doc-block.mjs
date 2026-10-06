// ────────────────────────────────────────────────────────────────────────────
// auto-doc-block.mjs — เขียนทับบล็อก <!-- auto:begin --> … <!-- auto:end -->
//
// ใช้โดย: tools/gen-module-docs.mjs · คุมโดย: tools/test/genModuleDocs.test.mjs
//
// กติกา (มาจากบั๊กจริงที่เกิดแล้ว):
//   · จำ marker ได้ทั้งรูปเป๊ะ `<!-- auto:begin -->` และรูป suffixed
//     `<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง … -->` ที่ไฟล์จริงใช้อยู่
//     (โค้ดเดิมเช็ครูปเป๊ะอย่างเดียว → ไม่เคย match → ทุกรัน append ลงท้าย
//      → บล็อกซ้ำงอกไม่รู้จบ เจอจริง 2-3 ชุด/ไฟล์)
//   · เขียนทับ "บล็อกแรก" ด้วยเนื้อหาใหม่ แล้ว "ลบบล็อกซ้ำ" ที่เหลือทิ้ง
//     (ของซ้ำจากรอบที่ append ผิดต้องหายไปด้วย ไม่งั้นไม่หายสักที)
//   · เนื้อหาเขียนมือก่อน/หลัง/ระหว่างบล็อก = ห้ามแตะ
//   · ไม่มี marker เลย = คืน null → ผู้เรียก (gen) ตัดสินใจเองว่าจะ append
// ────────────────────────────────────────────────────────────────────────────

/** รูป marker จริงในไฟล์: `<!-- auto:begin` ตามด้วยอะไรก็ได้จนจบ tag (ไม่มี --> ซ้อน) */
const BLOCK_RE = () => /<!-- auto:begin[\s\S]*?<!-- auto:end -->/g;

/**
 * @param {string} cur เนื้อหาไฟล์ .md ปัจจุบัน
 * @param {string} block บล็อก auto ใหม่ (begin … end ครบ)
 * @returns {string|null} เนื้อหาใหม่ หรือ null ถ้าไม่มี marker เลย
 */
export function applyAutoBlock(cur, block) {
  if (!BLOCK_RE().test(cur)) return null;
  let first = true;
  let removedDup = false;
  const next = cur.replace(BLOCK_RE(), (m) => {
    if (first) { first = false; return block; }
    removedDup = true;
    return '';
  });
  // ตอนลบบล็อกซ้ำจะเหลือช่องว่างลอย ๆ — เก็บให้เหลือบรรทัดว่างไม่เกิน 1 (เฉพาะจุดที่ลบ)
  return removedDup ? next.replace(/\n{3,}/g, '\n\n') : next;
}
