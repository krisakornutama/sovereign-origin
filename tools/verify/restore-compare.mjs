// restore-compare.mjs — ตรรกะเทียบจำนวนแถวระหว่าง DB จริงกับ DB ที่กู้จาก backup
//
// แยกออกมาเป็น pure function เพื่อให้เทสต์ได้โดยไม่ต้องมี docker/DB
// (พฤติกรรมที่ต้องล็อก: แถวต่างกันสองทางเป็นเรื่องปกติของ dump ที่เป็น snapshot
//  — dump เก่ากว่า = จริงมีมากกว่า · มีการลบหลังถ่าย backup = dump มีมากกว่า)

/**
 * เทียบจำนวนแถวต่อตาราง
 *
 * @param {Map<string, number>} live     ตาราง+จำนวนแถวของฐานจริง
 * @param {Map<string, number>} restored ตาราง+จำนวนแถวของฐานที่กู้จาก dump
 * @returns {{
 *   missing: string[],
 *   moreInLive: Array<{ table: string, live: number, restored: number }>,
 *   moreInRestore: Array<{ table: string, live: number, restored: number }>,
 * }}
 *   missing       = ฐานจริงมีตาราง แต่กู้ไม่ได้ → ผิดปกติ
 *   moreInLive    = dump เก่ากว่าเวลาถ่าย → ปกติ
 *   moreInRestore = มีการลบแถวหลังถ่าย backup → ปกติ (เช่นล้าง setting override)
 */
export function compareTableCounts(live, restored) {
  const missing = [...live.keys()].filter((t) => !restored.has(t));
  const moreInLive = [];
  const moreInRestore = [];
  for (const [table, restoredCount] of restored) {
    if (!live.has(table)) continue;
    const liveCount = live.get(table);
    if (restoredCount > liveCount) moreInRestore.push({ table, live: liveCount, restored: restoredCount });
    else if (restoredCount < liveCount) moreInLive.push({ table, live: liveCount, restored: restoredCount });
  }
  return { missing, moreInLive, moreInRestore };
}
