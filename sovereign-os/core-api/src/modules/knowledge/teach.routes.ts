// src/modules/knowledge/teach.routes.ts
// ─────────────────────────────────────────────────────────────────────────────
// AI สอนลูก — โหมดในคลังความรู้:
//   POST /api/knowledge/teach/generate { topic, ageRange? } → บทเรียน + แบบทดสอบ
//   POST /api/knowledge/teach/save { lesson } → เก็บเป็น NOTE ในคลังความรู้
// ใช้ข้อมูลในคลังความรู้ (RAG) + Ollama — offline 100%
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import {
  AGE_RANGES,
  generateLesson,
  normalizeLesson,
  saveLesson,
  createKid,
  updateKid,
  listKids,
  deleteKid,
  recordLessonProgress,
  kidStats,
  addChore,
  deleteChore,
  completeChore,
  reopenChore,
  addBill,
  deleteBill,
  payBill,
  addWalletMoney,
  kidHome,
  dashboardSummary,
  listOllamaModels,
  setAllowance,
  payWeeklyAllowances,
  payAllowanceNow,
  allowanceHistory,
  addCoupon,
  deleteCoupon,
  redeemCoupon,
  weeklyReport,
  setSavingsGoal,
  piggyTransfer,
  setKidPin,
  buildDailySummary,
  formatDailySummary,
  setPiggyTarget,
  STOCK_CATALOG,
  stockPrice,
  buyStock,
  sellStock,
  stockPortfolio,
  kidAuditLog,
  listCertificates,
  recordPortfolioSnapshot,
  portfolioHistory,
  setKidMoneyMode,
  setInvestPolicy,
  addPortfolioDeposit,
  portfolioDeposits,
  portfolioPerformance,
  setInvestTargetPct,
} from '../../services/teach-kids.service';
import { prisma } from '../../services/teach-kids.service';

const router = Router();

// POST /api/knowledge/teach/generate { topic, ageRange? }
router.post('/teach/generate', authenticate, async (req, res) => {
  try {
    const topic = String(req.body?.topic || '').trim();
    if (!topic) {
      return res.status(400).json({ error: 'topic ต้องไม่ว่าง — เช่น "น้ำ", "ระบบโซลาร์", "การเอาตัวรอดจากน้ำท่วม"' });
    }
    const ageRange = String(req.body?.ageRange || '6-8');
    if (!AGE_RANGES.some((a) => a.id === ageRange)) {
      return res.status(400).json({ error: `ageRange ต้องเป็น ${AGE_RANGES.map((a) => a.id).join(' | ')}` });
    }
    const quizCount = Number(req.body?.quizCount);
    const model = String(req.body?.model || '').trim();
    const { lesson, usedKnowledge } = await generateLesson(
      topic,
      ageRange,
      {},
      {
        quizCount: Number.isFinite(quizCount) && quizCount >= 1 && quizCount <= 10 ? Math.floor(quizCount) : undefined,
        model: model || undefined,
      }
    );
    res.json({ lesson, usedKnowledge });
  } catch (err: any) {
    console.error('Teach generate error:', err?.message || err);
    const msg = String(err?.message || '');
    const isOllamaDown = /empty ollama response|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|connect/i.test(msg);
    res.status(500).json({
      error: isOllamaDown
        ? 'AI (Ollama) ไม่ตอบกลับ — ตรวจว่า Ollama เปิดอยู่ (localhost:11434) และมีโมเดล AI_MODEL'
        : `สร้างบทเรียนไม่สำเร็จ: ${msg || 'unknown error'}`,
    });
  }
});

// POST /api/knowledge/teach/save { lesson } — เก็บบทเรียนเป็น NOTE ในคลังความรู้
router.post('/teach/save', authenticate, async (req, res) => {
  try {
    const lesson = normalizeLesson(req.body?.lesson);
    if (!lesson || (lesson.sections.length === 0 && lesson.quiz.length === 0)) {
      return res.status(400).json({ error: 'lesson ใช้ไม่ได้ — ต้องมี sections หรือ quiz อย่างน้อยหนึ่งอย่าง' });
    }
    const saved = await saveLesson(lesson);
    res.status(201).json({ success: true, itemId: saved.id });
  } catch (err) {
    console.error('Teach save error:', err);
    res.status(500).json({ error: 'บันทึกบทเรียนไม่สำเร็จ' });
  }
});

// GET /api/knowledge/teach/models — โมเดล Ollama ที่เลือกได้
router.get('/teach/models', authenticate, async (_req, res) => {
  try {
    res.json({ models: await listOllamaModels() });
  } catch (err) {
    res.status(500).json({ error: 'โหลดโมเดลไม่สำเร็จ' });
  }
});

// GET /api/knowledge/teach/dashboard — สรุปทุกคนสำหรับหน้า Dashboard
router.get('/teach/dashboard', authenticate, async (_req, res) => {
  try {
    res.json({ kids: await dashboardSummary() });
  } catch (err) {
    console.error('Teach dashboard error:', err);
    res.status(500).json({ error: 'โหลดสรุปไม่สำเร็จ' });
  }
});

// GET /api/knowledge/teach/report/weekly — รายงาน 7 วันสำหรับส่งออก PDF
router.get('/teach/report/weekly', authenticate, async (_req, res) => {
  try {
    res.json({ kids: await weeklyReport(7), generatedAt: new Date() });
  } catch (err) {
    console.error('Teach weekly report error:', err);
    res.status(500).json({ error: 'สร้างรายงานไม่สำเร็จ' });
  }
});

// ── ถังสะสมแต้ม / เป้าหมายออม / PIN ──

// PUT /api/knowledge/teach/kids/:id/savings { goal } — เป้าหมายออมรายเดือน (0 = ปิด)
router.put('/teach/kids/:id/savings', authenticate, async (req, res) => {
  try {
    const saved = await setSavingsGoal(req.params.id, Number(req.body?.goal));
    res.json({ success: true, savings_goal: saved.goal });
  } catch (err: any) {
    const msg = String(err?.message || '');
    const notFound = /kid not found/i.test(msg);
    res.status(notFound ? 404 : 400).json({ error: notFound ? 'ไม่พบโปรไฟล์เด็ก' : `ตั้งเป้าหมายไม่สำเร็จ: ${msg}` });
  }
});

// POST /api/knowledge/teach/kids/:id/piggy { amount, note? } — ฝาก (+)/ถอน (-) เหรียญเข้าถัง
router.post('/teach/kids/:id/piggy', authenticate, async (req, res) => {
  try {
    const { amount, note } = req.body || {};
    const result = await piggyTransfer(req.params.id, Number(amount), note);
    res.json({ success: true, piggy: result });
  } catch (err: any) {
    const msg = String(err?.message || '');
    const notFound = /kid not found/i.test(msg);
    const enough = /not enough/i.test(msg);
    res.status(notFound ? 404 : 400).json({
      error: notFound ? 'ไม่พบโปรไฟล์เด็ก' : enough ? 'เหรียญไม่พอ (กระเป๋าเงินหรือกระปุก)' : `ย้ายเหรียญไม่สำเร็จ: ${msg}`,
    });
  }
});

// PUT /api/knowledge/teach/kids/:id/pin { pin } — ตั้ง/เปลี่ยน/ล้าง PIN ของลูก (4-6 หลัก)
router.put('/teach/kids/:id/pin', authenticate, async (req, res) => {
  try {
    const result = await setKidPin(req.params.id, String(req.body?.pin ?? ''));
    res.json({ success: true, has_pin: result.has_pin });
  } catch (err: any) {
    const msg = String(err?.message || '');
    const notFound = /kid not found/i.test(msg);
    res.status(notFound ? 404 : 400).json({ error: notFound ? 'ไม่พบโปรไฟล์เด็ก' : msg });
  }
});

// GET /api/knowledge/teach/allowance/history — ประวัติค่าขนมของทุกคน
router.get('/teach/allowance/history', authenticate, async (_req, res) => {
  try {
    res.json({ kids: await allowanceHistory() });
  } catch (err) {
    console.error('Allowance history error:', err);
    res.status(500).json({ error: 'โหลดประวัติค่าขนมไม่สำเร็จ' });
  }
});

// POST /api/knowledge/teach/kids/:id/allowance/pay-now — จ่ายย้อนหลังด้วยมือ (worker พลาด)
router.post('/teach/kids/:id/allowance/pay-now', authenticate, async (req, res) => {
  try {
    const result = await payAllowanceNow(req.params.id);
    res.json(result);
  } catch (err: any) {
    const msg = String(err?.message || '');
    const notFound = /kid not found/i.test(msg);
    res.status(notFound ? 404 : 500).json({ error: notFound ? 'ไม่พบโปรไฟล์เด็ก' : `จ่ายค่าขนมไม่สำเร็จ: ${msg}` });
  }
});

// ── สรุปประจำวัน / หุ้นจำลอง / เป้าหมายถังระยะยาว / audit log ──

// GET /api/knowledge/teach/daily-summary — สรุป 24 ชม. ของทุกคน (ใช้แสดง/ส่ง Telegram)
router.get('/teach/daily-summary', authenticate, async (_req, res) => {
  try {
    const s = await buildDailySummary();
    res.json({ kids: s.kids, generatedAt: s.generatedAt, text: formatDailySummary(s) });
  } catch (err) {
    console.error('Daily summary error:', err);
    res.status(500).json({ error: 'สร้างสรุปไม่สำเร็จ' });
  }
});

// GET /api/knowledge/teach/stocks — รายการหุ้นจำลอง + ราคาวันนี้
router.get('/teach/stocks', authenticate, async (_req, res) => {
  res.json({
    stocks: STOCK_CATALOG.map((s) => ({ ...s, price: stockPrice(s.symbol) })),
    date: new Date(),
  });
});

// POST /api/knowledge/teach/kids/:id/stocks/buy { symbol, units } — ลูกซื้อหุ้น
router.post('/teach/kids/:id/stocks/buy', authenticate, async (req, res) => {
  try {
    const result = await buyStock(req.params.id, String(req.body?.symbol || ''), Number(req.body?.units));
    res.json({ success: true, ...result });
  } catch (err: any) {
    const msg = String(err?.message || '');
    const notFound = /kid not found/i.test(msg);
    const enough = /not enough/i.test(msg);
    res.status(notFound ? 404 : 400).json({
      error: notFound ? 'ไม่พบโปรไฟล์เด็ก' : enough ? 'เงินในกระเป๋าไม่พอซื้อ' : `ซื้อหุ้นไม่สำเร็จ: ${msg}`,
    });
  }
});

// POST /api/knowledge/teach/kids/:id/stocks/sell { symbol, units } — ลูกขายหุ้น
router.post('/teach/kids/:id/stocks/sell', authenticate, async (req, res) => {
  try {
    const result = await sellStock(req.params.id, String(req.body?.symbol || ''), Number(req.body?.units));
    res.json({ success: true, ...result });
  } catch (err: any) {
    const msg = String(err?.message || '');
    const notFound = /kid not found/i.test(msg);
    const units = /not enough units/i.test(msg);
    res.status(notFound ? 404 : 400).json({
      error: notFound ? 'ไม่พบโปรไฟล์เด็ก' : units ? 'หน่วยหุ้นไม่พอขาย' : `ขายหุ้นไม่สำเร็จ: ${msg}`,
    });
  }
});

// PUT /api/knowledge/teach/kids/:id/piggy-target { title, amount } — เป้าหมายระยะยาวของถัง
router.put('/teach/kids/:id/piggy-target', authenticate, async (req, res) => {
  try {
    const saved = await setPiggyTarget(req.params.id, { title: String(req.body?.title ?? ''), amount: Number(req.body?.amount) });
    res.json({ success: true, piggy_target: saved });
  } catch (err: any) {
    const msg = String(err?.message || '');
    const notFound = /kid not found/i.test(msg);
    res.status(notFound ? 404 : 400).json({ error: notFound ? 'ไม่พบโปรไฟล์เด็ก' : `ตั้งเป้าหมายไม่สำเร็จ: ${msg}` });
  }
});

// GET /api/knowledge/teach/kids/:id/audit — ประวัติการใช้งานของลูก (แลกคูปอง/PIN/ทำงาน/บิล/หุ้น)
router.get('/teach/kids/:id/audit', authenticate, async (req, res) => {
  try {
    res.json({ logs: await kidAuditLog(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: 'โหลดประวัติไม่สำเร็จ' });
  }
});

// ── ค่าขนมรายสัปดาห์ + คูปองรางวัล ──

// PUT /api/knowledge/teach/kids/:id/allowance { day, amount } — ตั้งค่าขนมรายสัปดาห์
router.put('/teach/kids/:id/allowance', authenticate, async (req, res) => {
  try {
    const saved = await setAllowance(req.params.id, { day: Number(req.body?.day), amount: Number(req.body?.amount) });
    res.json({ success: true, allowance: saved });
  } catch (err: any) {
    const msg = String(err?.message || '');
    const notFound = /kid not found/i.test(msg);
    res.status(notFound ? 404 : 400).json({
      error: notFound ? 'ไม่พบโปรไฟล์เด็ก' : `ตั้งค่าขนมไม่สำเร็จ: ${msg}`,
    });
  }
});

// POST /api/knowledge/teach/kids/:id/coupons { title, cost, emoji? } — ผู้ใหญ่สร้างคูปองรางวัล
router.post('/teach/kids/:id/coupons', authenticate, async (req, res) => {
  try {
    const { title, cost, emoji } = req.body || {};
    const coupon = await addCoupon(req.params.id, { title, cost, emoji });
    res.status(201).json({ success: true, coupon });
  } catch (err: any) {
    const msg = String(err?.message || '');
    const notFound = /kid not found/i.test(msg);
    res.status(notFound ? 404 : 400).json({ error: notFound ? 'ไม่พบโปรไฟล์เด็ก' : `เพิ่มคูปองไม่สำเร็จ: ${msg}` });
  }
});

// POST /api/knowledge/teach/kids/:id/coupons/:couponId/redeem — ลูกแลกคูปอง (หักคะแนน)
router.post('/teach/kids/:id/coupons/:couponId/redeem', authenticate, async (req, res) => {
  try {
    const redeemed = await redeemCoupon(req.params.id, req.params.couponId, String(req.body?.pin ?? ''));
    res.json({ success: true, redeemed });
  } catch (err: any) {
    const msg = String(err?.message || '');
    const notFound = /coupon not found/i.test(msg);
    const enough = /not enough balance/i.test(msg);
    const pinBad = /PIN/i.test(msg);
    res.status(notFound ? 404 : pinBad ? 403 : 400).json({
      error: notFound ? 'ไม่พบคูปองนี้' : pinBad ? msg : enough ? 'คะแนนไม่พอแลก — ทำงานบ้านก่อนนะ' : `แลกคูปองไม่สำเร็จ: ${msg}`,
    });
  }
});

// DELETE /api/knowledge/teach/kids/:id/coupons/:couponId — ลบคูปอง
router.delete('/teach/kids/:id/coupons/:couponId', authenticate, async (req, res) => {
  try {
    await deleteCoupon(req.params.id, req.params.couponId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'ลบคูปองไม่สำเร็จ' });
  }
});

// ── หน้าที่ของลูก: งานบ้าน / บิล / กระเป๋าเงิน ──

// GET /api/knowledge/teach/kids/:id/home — ภาพรวม (งานบ้าน + บิล + ยอดเงิน + ประวัติ)
router.get('/teach/kids/:id/home', authenticate, async (req, res) => {
  try {
    res.json(await kidHome(req.params.id));
  } catch (err: any) {
    const notFound = /kid not found/i.test(String(err?.message || ''));
    res.status(notFound ? 404 : 500).json({ error: notFound ? 'ไม่พบโปรไฟล์เด็ก' : 'โหลดหน้าบ้านไม่สำเร็จ' });
  }
});

// งานบ้าน
router.post('/teach/kids/:id/chores', authenticate, async (req, res) => {
  try {
    const { title, reward, emoji, repeat } = req.body || {};
    if (!String(title || '').trim()) return res.status(400).json({ error: 'ต้องใส่ชื่องาน (เช่น กวาดบ้าน)' });
    if (Number(reward) <= 0) return res.status(400).json({ error: 'ค่าตอบแทนต้องมากกว่า 0 บาท' });
    const chore = await addChore(req.params.id, { title, reward: Number(reward), emoji, repeat });
    res.status(201).json({ success: true, chore });
  } catch (err: any) {
    console.error('Add chore error:', err);
    const notFound = /kid not found/i.test(String(err?.message || ''));
    res.status(notFound ? 404 : 500).json({ error: notFound ? 'ไม่พบโปรไฟล์เด็ก' : 'เพิ่มงานไม่สำเร็จ' });
  }
});

router.delete('/teach/kids/:id/chores/:choreId', authenticate, async (req, res) => {
  try {
    await deleteChore(req.params.id, req.params.choreId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'ลบงานไม่สำเร็จ' });
  }
});

router.post('/teach/kids/:id/chores/:choreId/complete', authenticate, async (req, res) => {
  try {
    const done = await completeChore(req.params.id, req.params.choreId, String(req.body?.pin ?? ''));
    res.json({ success: true, reward: done.reward });
  } catch (err: any) {
    const msg = String(err?.message || '');
    const notFound = /chore not found|kid not found/i.test(msg);
    const pinBad = /PIN/i.test(msg);
    res.status(notFound ? 404 : pinBad ? 403 : 500).json({
      error: notFound ? 'ไม่พบงานนี้' : pinBad ? msg : 'บันทึกงานไม่สำเร็จ',
    });
  }
});

router.post('/teach/kids/:id/chores/:choreId/reopen', authenticate, async (req, res) => {
  try {
    await reopenChore(req.params.id, req.params.choreId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'เปิดงานใหม่ไม่สำเร็จ' });
  }
});

// บิล (ค่าไฟ / ค่าน้ำ / ค่าห้อง)
router.post('/teach/kids/:id/bills', authenticate, async (req, res) => {
  try {
    const { title, amount, emoji, period } = req.body || {};
    if (!String(title || '').trim()) return res.status(400).json({ error: 'ต้องใส่ชื่อบิล (เช่น ค่าไฟ, ค่าน้ำ, ค่าห้อง)' });
    if (Number(amount) <= 0) return res.status(400).json({ error: 'จำนวนเงินต้องมากกว่า 0' });
    const bill = await addBill(req.params.id, { title, amount: Number(amount), emoji, period });
    res.status(201).json({ success: true, bill });
  } catch (err: any) {
    const notFound = /kid not found/i.test(String(err?.message || ''));
    res.status(notFound ? 404 : 500).json({ error: notFound ? 'ไม่พบโปรไฟล์เด็ก' : 'เพิ่มบิลไม่สำเร็จ' });
  }
});

router.delete('/teach/kids/:id/bills/:billId', authenticate, async (req, res) => {
  try {
    await deleteBill(req.params.id, req.params.billId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'ลบบิลไม่สำเร็จ' });
  }
});

router.post('/teach/kids/:id/bills/:billId/pay', authenticate, async (req, res) => {
  try {
    const paid = await payBill(req.params.id, req.params.billId);
    res.json({ success: true, amount: paid.amount });
  } catch (err: any) {
    const notFound = /bill not found|kid not found/i.test(String(err?.message || ''));
    res.status(notFound ? 404 : 500).json({ error: notFound ? 'ไม่พบบิลนี้' : 'จ่ายบิลไม่สำเร็จ' });
  }
});

// กระเป๋าเงิน: ผู้ใหญ่เติม/หักเงิน { amount, note? }
router.post('/teach/kids/:id/wallet', authenticate, async (req, res) => {
  try {
    const { amount, note } = req.body || {};
    if (Number(amount) === 0) return res.status(400).json({ error: 'amount ต้องไม่เป็น 0' });
    const tx = await addWalletMoney(req.params.id, Number(amount), note);
    res.status(201).json({ success: true, txId: tx.id });
  } catch (err: any) {
    const notFound = /kid not found/i.test(String(err?.message || ''));
    res.status(notFound ? 404 : 500).json({ error: notFound ? 'ไม่พบโปรไฟล์เด็ก' : 'ปรับยอดเงินไม่สำเร็จ' });
  }
});

// ── โปรไฟล์เด็ก (AI สอนลูก) ──

// GET /api/knowledge/teach/kids — รายการโปรไฟล์เด็ก
router.get('/teach/kids', authenticate, async (_req, res) => {
  try {
    res.json({ kids: await listKids() });
  } catch (err) {
    console.error('List kids error:', err);
    res.status(500).json({ error: 'โหลดโปรไฟล์เด็กไม่สำเร็จ' });
  }
});

// POST /api/knowledge/teach/kids { name, age?, emoji?, color? }
router.post('/teach/kids', authenticate, async (req, res) => {
  try {
    const { name, age, emoji, color } = req.body || {};
    if (!String(name || '').trim()) {
      return res.status(400).json({ error: 'ต้องใส่ชื่อเด็ก (เช่น "น้องน้ำ")' });
    }
    const kid = await createKid({ name, age, emoji, color });
    res.status(201).json({ success: true, kid });
  } catch (err) {
    console.error('Create kid error:', err);
    res.status(500).json({ error: 'เพิ่มโปรไฟล์เด็กไม่สำเร็จ' });
  }
});

// PUT /api/knowledge/teach/kids/:id
router.put('/teach/kids/:id', authenticate, async (req, res) => {
  try {
    const { name, age, emoji, color } = req.body || {};
    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ error: 'ชื่อเด็กต้องไม่ว่าง' });
    }
    const kid = await updateKid(req.params.id, { name, age, emoji, color });
    res.json({ success: true, kid });
  } catch (err: any) {
    console.error('Update kid error:', err);
    const notFound = /not found|does not exist/i.test(String(err?.message || ''));
    res.status(notFound ? 404 : 500).json({ error: notFound ? 'ไม่พบโปรไฟล์เด็ก' : 'แก้ไขโปรไฟล์ไม่สำเร็จ' });
  }
});

// DELETE /api/knowledge/teach/kids/:id
router.delete('/teach/kids/:id', authenticate, async (req, res) => {
  try {
    await deleteKid(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete kid error:', err);
    res.status(500).json({ error: 'ลบโปรไฟล์เด็กไม่สำเร็จ' });
  }
});

// GET /api/knowledge/teach/kids/:id/certificates — เกียรติบัตรของลูก (เลื่อนระดับอัตโนมัติ)
router.get('/teach/kids/:id/certificates', authenticate, async (req, res) => {
  try {
    const certs = await listCertificates(req.params.id);
    res.json({ success: true, certificates: certs });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'โหลดเกียรติบัตรไม่สำเร็จ') });
  }
});

// GET /api/knowledge/teach/kids/:id/portfolio-history — กราฟมูลค่าพอร์ตหุ้นย้อนหลัง
router.get('/teach/kids/:id/portfolio-history', authenticate, async (req, res) => {
  try {
    const days = Math.min(365, Math.max(7, Number((req.query.days as string) || '60') || 60));
    const rows = await portfolioHistory(req.params.id, days);
    res.json({ success: true, history: rows });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'โหลดประวัติพอร์ตไม่สำเร็จ') });
  }
});

// POST /api/knowledge/teach/kids/:id/portfolio-snapshot — บันทึกมูลค่าพอร์ตวันนี้ (worker + ปุ่มมือ)
router.post('/teach/kids/:id/portfolio-snapshot', authenticate, async (req, res) => {
  try {
    await recordPortfolioSnapshot(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'บันทึก snapshot ไม่สำเร็จ') });
  }
});

// PUT /api/knowledge/teach/kids/:id/money-mode { mode } — play (จำลอง) | real (เงินจริง)
router.put('/teach/kids/:id/money-mode', authenticate, async (req, res) => {
  try {
    const { mode } = req.body || {};
    const saved = await setKidMoneyMode(req.params.id, String(mode));
    res.json({ success: true, ...saved });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'เปลี่ยนโหมดเงินไม่สำเร็จ') });
  }
});

// PUT /api/knowledge/teach/kids/:id/invest-policy { text } — นโยบายการลงทุนของพ่อแม่
router.put('/teach/kids/:id/invest-policy', authenticate, async (req, res) => {
  try {
    const { text } = req.body || {};
    const saved = await setInvestPolicy(req.params.id, String(text ?? ''));
    res.json({ success: true, ...saved });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'ตั้งนโยบายไม่สำเร็จ') });
  }
});

// POST /api/knowledge/teach/kids/:id/portfolio-deposits { amount, note? } — พ่อแม่เติมเงินจริงเข้าพอร์ต
router.post('/teach/kids/:id/portfolio-deposits', authenticate, async (req, res) => {
  try {
    const { amount, note } = req.body || {};
    const item = await addPortfolioDeposit(req.params.id, Number(amount), note);
    res.status(201).json({ success: true, deposit: item });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'ฝากเงินเข้าพอร์ตไม่สำเร็จ') });
  }
});

// GET /api/knowledge/teach/kids/:id/portfolio-deposits — ประวัติยอดฝาก
router.get('/teach/kids/:id/portfolio-deposits', authenticate, async (req, res) => {
  try {
    const rows = await portfolioDeposits(req.params.id);
    res.json({ success: true, deposits: rows });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'โหลดยอดฝากไม่สำเร็จ') });
  }
});

// GET /api/knowledge/teach/kids/:id/portfolio-performance — ผลตอบแทน vs ยอดฝาก + รายเดือน
router.get('/teach/kids/:id/portfolio-performance', authenticate, async (req, res) => {
  try {
    const perf = await portfolioPerformance(req.params.id);
    res.json({ success: true, ...perf });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'คำนวณผลตอบแทนไม่สำเร็จ') });
  }
});

// PUT /api/knowledge/teach/kids/:id/invest-target { pct } — เป้าหมายผลตอบแทนรายเดือน
router.put('/teach/kids/:id/invest-target', authenticate, async (req, res) => {
  try {
    const { pct } = req.body || {};
    const saved = await setInvestTargetPct(req.params.id, Number(pct));
    res.json({ success: true, ...saved });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'ตั้งเป้าหมายไม่สำเร็จ') });
  }
});

// GET /api/knowledge/teach/kids/:id/progress — บันทึกบทเรียนที่เรียนจบ + สถิติ
router.get('/teach/kids/:id/progress', authenticate, async (req, res) => {
  try {
    const [progress, stats] = await Promise.all([
      prisma.kidLessonProgress.findMany({
        where: { kid_id: req.params.id },
        orderBy: { completed_at: 'desc' },
        take: 100,
      }),
      kidStats(req.params.id),
    ]);
    res.json({ progress, stats });
  } catch (err) {
    console.error('Kid progress error:', err);
    res.status(500).json({ error: 'โหลดความคืบหน้าไม่สำเร็จ' });
  }
});

// POST /api/knowledge/teach/kids/:id/progress { lessonTitle, score, total, lessonItemId? }
router.post('/teach/kids/:id/progress', authenticate, async (req, res) => {
  try {
    const { lessonTitle, score, total, lessonItemId } = req.body || {};
    const saved = await recordLessonProgress(req.params.id, {
      lessonTitle: String(lessonTitle || ''),
      score: Number(score),
      total: Number(total),
      lessonItemId: lessonItemId ? String(lessonItemId) : null,
    });
    res.status(201).json({ success: true, progressId: saved.id });
  } catch (err: any) {
    console.error('Record progress error:', err);
    const msg = String(err?.message || '');
    if (/kid not found/i.test(msg)) return res.status(404).json({ error: 'ไม่พบโปรไฟล์เด็ก' });
    if (/total|lessonTitle/i.test(msg)) return res.status(400).json({ error: 'ข้อมูลคะแนนไม่ถูกต้อง' });
    res.status(500).json({ error: 'บันทึกความคืบหน้าไม่สำเร็จ' });
  }
});

export default router;
