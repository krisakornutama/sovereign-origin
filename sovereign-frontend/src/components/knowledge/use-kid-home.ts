"use client";
// ── State + handlers ของ "หน้าที่ของลูก" (งานบ้าน/บิล/กระเป๋าเงิน/ถัง/หุ้น/คูปอง/audit) ──
// ย้ายมาจาก src/pages/knowledge.tsx verbatim — logic เดิมทั้งหมด ไม่แก้ behavior
import { useState, useEffect, useCallback, Dispatch, SetStateAction } from 'react';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { authFetch } from '../../lib/apiFetch';
import { KidAuditRow, KidCoupon, KidHome, KidStock, WEEKDAY_LABELS } from './knowledge-types';

interface UseKidHomeParams {
  activeKidId: string | null;
  showKidHome: boolean;
  isHydrated: boolean;
  isAuthenticated: boolean;
  setMessage: Dispatch<SetStateAction<string>>;
  setTeachError: Dispatch<SetStateAction<string>>;
}

export function useKidHome({ activeKidId, showKidHome, isHydrated, isAuthenticated, setMessage, setTeachError }: UseKidHomeParams) {
  const t = useLanguageStore((s) => s.t);

  const [kidHome, setKidHome] = useState<KidHome | null>(null);
  const [homeLoading, setHomeLoading] = useState(false);
  const [choreForm, setChoreForm] = useState<{ title: string; reward: string; emoji: string }>({ title: '', reward: '10', emoji: '🧹' });
  const [billForm, setBillForm] = useState<{ title: string; amount: string; emoji: string; period: string }>({ title: '', amount: '20', emoji: '💡', period: 'one-time' });
  const [walletAmount, setWalletAmount] = useState('');
  const [walletNote, setWalletNote] = useState('');
  const [couponForm, setCouponForm] = useState<{ title: string; cost: string; emoji: string }>({ title: '', cost: '50', emoji: '🎮' });
  const [allowanceForm, setAllowanceForm] = useState<{ day: string; amount: string }>({ day: '0', amount: '20' });
  const [piggyForm, setPiggyForm] = useState<{ amount: string; note: string }>({ amount: '', note: '' });
  const [goalForm, setGoalForm] = useState<{ amount: string }>({ amount: '100' });
  const [pinForm, setPinForm] = useState('');
  const [choreRepeat, setChoreRepeat] = useState<'none' | 'daily'>('none');
  const [targetForm, setTargetForm] = useState<{ title: string; amount: string }>({ title: '', amount: '500' });
  const [stocks, setStocks] = useState<KidStock[]>([]);
  const [stockForm, setStockForm] = useState<{ symbol: string; units: string }>({ symbol: 'FARM', units: '1' });
  const [audit, setAudit] = useState<KidAuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [policyText, setPolicyText] = useState('');
  const [savingTip, setSavingTip] = useState(false);
  const [depositForm, setDepositForm] = useState<{ amount: string; note: string }>({ amount: '', note: '' });
  const [targetPctForm, setTargetPctForm] = useState<{ pct: string }>({ pct: '2' });

  // ── หน้าที่ของลูก — โหลดงานบ้าน/บิล/กระเป๋าเงินของเด็กที่เลือก ──
  const loadKidHome = useCallback(async (kidId: string) => {
    setHomeLoading(true);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${kidId}/home`);
      if (!res.ok) return;
      setKidHome(await res.json());
    } catch {
      setKidHome(null);
    } finally {
      setHomeLoading(false);
    }
  }, []);

  // ── งานบ้าน ──
  const addChoreUI = async () => {
    if (!activeKidId) return;
    const title = choreForm.title.trim();
    if (!title) {
      setTeachError(t('knowledge.errors.choreTitleRequired', 'ต้องใส่ชื่องานบ้านก่อน — เช่น "กวาดบ้าน"'));
      return;
    }
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/chores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, reward: Math.max(1, Number(choreForm.reward) || 1), emoji: choreForm.emoji, repeat: choreRepeat }),
      });
      if (!res.ok) throw new Error(t('knowledge.errors.choreAddFailed', 'เพิ่มงานไม่สำเร็จ'));
      setChoreForm({ title: '', reward: '10', emoji: choreForm.emoji });
      setChoreRepeat('none');
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.choreAddFailed', 'เพิ่มงานไม่สำเร็จ'));
    }
  };

  // ขอ PIN ของลูก (ถ้ามี) — คืน null เมื่อผู้ใช้ยกเลิก
  const promptKidPin = (): string | null => {
    if (!kidHome?.kid.has_pin) return '';
    const pin = window.prompt(t('knowledge.pinPrompt', '{name} ตั้ง PIN ไว้ — กรอกรหัสลับเพื่อยืนยัน', { name: kidHome.kid.name }));
    return pin === null ? null : pin.trim();
  };

  const completeChoreUI = async (choreId: string) => {
    if (!activeKidId) return;
    const pin = promptKidPin();
    if (pin === null) return; // ผู้ใช้ยกเลิก
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/chores/${choreId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.choreCompleteFailed', 'ทำไมสำเร็จ'));
      setMessage(t('knowledge.choreDone', 'งานเสร็จแล้ว — +{reward} บาท เข้ากระเป๋าเงิน', { reward: data.reward }));
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.choreCompleteFailed', 'ทำไมสำเร็จ'));
    }
  };

  const reopenChoreUI = async (choreId: string) => {
    if (!activeKidId) return;
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/chores/${choreId}/reopen`, { method: 'POST' });
      loadKidHome(activeKidId);
    } catch {
      setTeachError(t('knowledge.errors.choreReopenFailed', 'เปิดงานใหม่ไม่สำเร็จ'));
    }
  };

  const deleteChoreUI = async (choreId: string) => {
    if (!activeKidId || !confirm(t('knowledge.deleteChoreConfirm', 'ลบงานนี้?'))) return;
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/chores/${choreId}`, { method: 'DELETE' });
      loadKidHome(activeKidId);
    } catch {
      setTeachError(t('knowledge.errors.choreDeleteFailed', 'ลบงานไม่สำเร็จ'));
    }
  };

  // ── บิล ──
  const addBillUI = async () => {
    if (!activeKidId) return;
    const title = billForm.title.trim();
    if (!title) {
      setTeachError(t('knowledge.errors.billTitleRequired', 'ต้องใส่ชื่อบิลก่อน — เช่น "ค่าไฟ" "ค่าน้ำ" "ค่าห้อง"'));
      return;
    }
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, amount: Math.max(1, Number(billForm.amount) || 1), emoji: billForm.emoji, period: billForm.period }),
      });
      if (!res.ok) throw new Error(t('knowledge.errors.billAddFailed', 'เพิ่มบิลไม่สำเร็จ'));
      setBillForm({ title: '', amount: '20', emoji: billForm.emoji, period: billForm.period });
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.billAddFailed', 'เพิ่มบิลไม่สำเร็จ'));
    }
  };

  const payBillUI = async (billId: string) => {
    if (!activeKidId) return;
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/bills/${billId}/pay`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.billPayFailed', 'จ่ายไมสำเร็จ'));
      setMessage(t('knowledge.billPaid', 'จ่ายบิลแล้ว — ตัด {amount} บาทจากกระเป๋าเงิน', { amount: data.amount }));
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.billPayFailed', 'จ่ายไมสำเร็จ'));
    }
  };

  const deleteBillUI = async (billId: string) => {
    if (!activeKidId || !confirm(t('knowledge.deleteBillConfirm', 'ลบบิลนี้?'))) return;
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/bills/${billId}`, { method: 'DELETE' });
      loadKidHome(activeKidId);
    } catch {
      setTeachError(t('knowledge.errors.billDeleteFailed', 'ลบบิลไม่สำเร็จ'));
    }
  };

  // ── กระเป๋าเงิน — ผู้ใหญ่เติม/หักเงิน ──
  const adjustWalletUI = async (sign: 1 | -1) => {
    if (!activeKidId) return;
    const amt = Number(walletAmount);
    if (!amt || amt <= 0) {
      setTeachError(t('knowledge.errors.walletAmountRequired', 'ใส่จำนวนเงินก่อน (บาท)'));
      return;
    }
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/wallet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: sign * amt, note: walletNote.trim() || undefined }),
      });
      if (!res.ok) throw new Error(t('knowledge.errors.walletAdjustFailed', 'ปรับยอดไม่สำเร็จ'));
      setWalletAmount('');
      setWalletNote('');
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.walletAdjustFailed', 'ปรับยอดไม่สำเร็จ'));
    }
  };

  // ── ค่าขนมรายสัปดาห์ ──
  const setAllowanceUI = async () => {
    if (!activeKidId) return;
    const amount = Number(allowanceForm.amount);
    const day = Number(allowanceForm.day);
    if (!amount || amount <= 0) {
      setTeachError(t('knowledge.errors.allowanceRequired', 'ต้องใส่จำนวนเงินค่าขนม (บาท/สัปดาห์)'));
      return;
    }
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/allowance`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day, amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.allowanceSetFailed', 'ตั้งค่าไม่สำเร็จ'));
      setMessage(t('knowledge.allowanceSet', 'ค่าขนมรายสัปดาห์: ทุกวัน{day} {amount} บาท — ระบบจ่ายให้อัตโนมัติ', { day: t(`knowledge.weekday.${day}`, WEEKDAY_LABELS[day]), amount }));
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.allowanceSetFailed', 'ตั้งค่าไม่สำเร็จ'));
    }
  };

  // ── คูปองรางวัล ──
  const addCouponUI = async () => {
    if (!activeKidId) return;
    const title = couponForm.title.trim();
    if (!title) {
      setTeachError(t('knowledge.errors.couponTitleRequired', 'ต้องใส่ชื่อรางวัลก่อน — เช่น "เล่นเกม 30 นาที"'));
      return;
    }
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/coupons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, cost: Math.max(1, Number(couponForm.cost) || 1), emoji: couponForm.emoji }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.couponAddFailed', 'เพิ่มคูปองไม่สำเร็จ'));
      setMessage(t('knowledge.couponAdded', 'เพิ่มคูปอง "{title}" แล้ว', { title }));
      setCouponForm({ title: '', cost: couponForm.cost, emoji: couponForm.emoji });
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.couponAddFailed', 'เพิ่มคูปองไม่สำเร็จ'));
    }
  };

  const redeemCouponUI = async (coupon: KidCoupon) => {
    if (!activeKidId) return;
    const pin = promptKidPin();
    if (pin === null) return; // ผู้ใช้ยกเลิก
    if (!confirm(t('knowledge.redeemConfirm', 'ให้ {name} แลกคูปอง "{title}" ด้วย {cost} คะแนน?', { name: kidHome?.kid.name || t('knowledge.theKid', 'ลูก'), title: coupon.title, cost: coupon.cost }))) return;
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/coupons/${coupon.id}/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.redeemFailed', 'แลกไม่สำเร็จ'));
      setMessage(t('knowledge.couponRedeemed', 'แลกคูปอง "{title}" แล้ว — หัก {cost} คะแนน', { title: coupon.title, cost: coupon.cost }));
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.redeemFailed', 'แลกไม่สำเร็จ'));
    }
  };

  const deleteCouponUI = async (coupon: KidCoupon) => {
    if (!activeKidId || !confirm(t('knowledge.deleteCouponConfirm', 'ลบคูปอง "{title}"?', { title: coupon.title }))) return;
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/coupons/${coupon.id}`, { method: 'DELETE' });
      loadKidHome(activeKidId);
    } catch {
      setTeachError(t('knowledge.errors.couponDeleteFailed', 'ลบคูปองไม่สำเร็จ'));
    }
  };

  // ── ถังสะสมแต้ม + เป้าหมายออมรายเดือน ──
  const setSavingsGoalUI = async () => {
    if (!activeKidId) return;
    const goal = Math.max(0, Number(goalForm.amount) || 0);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/savings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.goalSetFailed', 'ตั้งเป้าหมายไม่สำเร็จ'));
      setMessage(goal > 0 ? t('knowledge.goalSet', 'ตั้งเป้าหมายออม {n} บาท/เดือน แล้ว', { n: goal }) : t('knowledge.goalClosed', 'ปิดเป้าหมายออมแล้ว'));
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.goalSetFailed', 'ตั้งเป้าหมายไม่สำเร็จ'));
    }
  };

  const piggyTransferUI = async (sign: 1 | -1) => {
    if (!activeKidId) return;
    const amt = Number(piggyForm.amount);
    if (!amt || amt <= 0) {
      setTeachError(t('knowledge.errors.piggyAmountRequired', 'ใส่จำนวนเหรียญก่อน (บาท)'));
      return;
    }
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/piggy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: sign * amt, note: piggyForm.note.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.piggyFailed', 'ย้ายเหรียญไม่สำเร็จ'));
      setMessage(sign > 0 ? t('knowledge.piggyDepositedMsg', 'ฝาก {n} บาท เข้าถังสะสมแต้มแล้ว', { n: amt }) : t('knowledge.piggyWithdrawnMsg', 'ถอน {n} บาท จากถังแล้ว', { n: amt }));
      setPiggyForm({ amount: '', note: '' });
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.piggyFailed', 'ย้ายเหรียญไม่สำเร็จ'));
    }
  };

  // ── PIN ของลูก ──
  const setPinUI = async () => {
    if (!activeKidId) return;
    const pin = pinForm.trim();
    if (pin && !/^\d{4,6}$/.test(pin)) {
      setTeachError(t('knowledge.errors.pinInvalid', 'PIN ต้องเป็นตัวเลข 4-6 หลัก'));
      return;
    }
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/pin`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.pinSetFailed', 'ตั้ง PIN ไม่สำเร็จ'));
      setMessage(pin ? t('knowledge.pinSetMsg', 'ตั้ง PIN ให้ {name} แล้ว (ต้องกรอกก่อนทำงานเสร็จ/แลกคูปอง)', { name: kidHome?.kid.name || t('knowledge.theKid', 'ลูก') }) : t('knowledge.pinCleared', 'ล้าง PIN แล้ว'));
      setPinForm('');
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.pinSetFailed', 'ตั้ง PIN ไม่สำเร็จ'));
    }
  };

  // ── เป้าหมายถังระยะยาว ──
  const setPiggyTargetUI = async () => {
    if (!activeKidId) return;
    const amount = Math.max(0, Number(targetForm.amount) || 0);
    const title = targetForm.title.trim();
    if (amount > 0 && !title) {
      setTeachError(t('knowledge.errors.targetTitleRequired', 'ต้องใส่ชื่อเป้าหมายก่อน — เช่น "ซื้อจักรยาน"'));
      return;
    }
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/piggy-target`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.goalSetFailed', 'ตั้งเป้าหมายไม่สำเร็จ'));
      setMessage(amount > 0 ? t('knowledge.targetSet', 'ตั้งเป้าหมาย "{title}" {amount}฿ แล้ว', { title, amount }) : t('knowledge.targetCleared', 'ล้างเป้าหมายระยะยาวแล้ว'));
      setTargetForm({ title: '', amount: '500' });
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.goalSetFailed', 'ตั้งเป้าหมายไม่สำเร็จ'));
    }
  };

  // ── หุ้นจำลองของบ้าน ──
  const loadStocks = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/stocks`);
      if (!res.ok) return;
      const data = await res.json();
      setStocks(data.stocks || []);
    } catch {
      // เงียบ
    }
  }, []);

  useEffect(() => {
    if (isHydrated && isAuthenticated) loadStocks();
  }, [isHydrated, isAuthenticated, loadStocks]);

  const buyStockUI = async () => {
    if (!activeKidId) return;
    const units = Number(stockForm.units);
    if (!units || units <= 0) {
      setTeachError(t('knowledge.errors.stockUnitsRequired', 'ใส่จำนวนหน่วยหุ้นก่อน'));
      return;
    }
    const item = stocks.find((s) => s.symbol === stockForm.symbol);
    const cost = Math.round(units * (item?.price ?? 0));
    if (cost > (kidHome?.balance ?? 0)) {
      setTeachError(t('knowledge.errors.noMoneyStock', 'เงินไม่พอซื้อ — ต้องใช้ {cost}฿ แต่มี {balance}฿ ทำงานบ้านก่อนนะ', { cost, balance: kidHome?.balance ?? 0 }));
      return;
    }
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/stocks/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: stockForm.symbol, units }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.stockBuyFailed', 'ซื้อไม่สำเร็จ'));
      setMessage(t('knowledge.stockBought', 'ซื้อหุ้น {units} หน่วย @ {price}฿ แล้ว', { units, price: data.price }));
      loadKidHome(activeKidId);
      loadAudit();
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.stockBuyFailed', 'ซื้อไม่สำเร็จ'));
    }
  };

  const sellStockUI = async (symbol: string, units: number) => {
    if (!activeKidId) return;
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/stocks/sell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, units }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.stockSellFailed', 'ขายไม่สำเร็จ'));
      setMessage(t('knowledge.stockSold', 'ขายหุ้น {units} หน่วย @ {price}฿ แล้ว', { units, price: data.price }));
      loadKidHome(activeKidId);
      loadAudit();
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.stockSellFailed', 'ขายไม่สำเร็จ'));
    }
  };

  // ── โหมดเงินจริง/จำลอง + นโยบายลงทุนของพ่อแม่ ──
  const setMoneyModeUI = async (mode: 'play' | 'real') => {
    if (!activeKidId) return;
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/money-mode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.modeFailed', 'เปลี่ยนโหมดไม่สำเร็จ'));
      setMessage(mode === 'real' ? t('knowledge.modeReal', 'เปลี่ยนเป็นเงินจริง — เงินที่พ่อแม่มอบหมายให้ลูกบริหารและลงทุน') : t('knowledge.modePlay', 'เปลี่ยนเป็นเงินจำลอง — หัดเล่น'));
      loadKidHome(activeKidId);
      loadAudit();
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.modeFailed', 'เปลี่ยนโหมดไม่สำเร็จ'));
    }
  };

  const setInvestPolicyUI = async () => {
    if (!activeKidId) return;
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/invest-policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: policyText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.policyFailed', 'ตั้งนโยบายไม่สำเร็จ'));
      setMessage(t('knowledge.policySaved', 'บันทึกนโยบายลงทุนของบ้านแล้ว'));
      loadKidHome(activeKidId);
      loadAudit();
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.policyFailed', 'ตั้งนโยบายไม่สำเร็จ'));
    }
  };

  // ── พ่อแม่เติมเงินจริงเข้าพอร์ต + เป้าหมายผลตอบแทน ──
  const addDepositUI = async () => {
    if (!activeKidId) return;
    const amount = Number(depositForm.amount);
    if (!amount || amount <= 0) { setTeachError(t('knowledge.errors.depositRequired', 'ใส่จำนวนเงินที่ต้องการฝากเข้าพอร์ต')); return; }
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/portfolio-deposits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, note: depositForm.note || t('knowledge.home.realDepositNote', 'เงินจริงเข้าพอร์ต') }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.depositFailed', 'ฝากไม่สำเร็จ'));
      setMessage(t('knowledge.realDeposited', 'พ่อแม่เติมเงินจริงเข้าพอร์ต +{amount}฿ แล้ว', { amount }));
      setDepositForm({ amount: '', note: '' });
      loadKidHome(activeKidId);
      loadAudit();
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.depositFailed2', 'ฝากเงินไม่สำเร็จ'));
    }
  };

  const setTargetUI = async () => {
    if (!activeKidId) return;
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/invest-target`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pct: Number(targetPctForm.pct) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.investTargetFailed', 'ตั้งเป้าหมายไม่สำเร็จ'));
      setMessage(t('knowledge.targetPctSet', 'ตั้งเป้าหมายผลตอบแทนรายเดือนแล้ว'));
      loadKidHome(activeKidId);
      loadAudit();
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.investTargetFailed', 'ตั้งเป้าหมายไม่สำเร็จ'));
    }
  };

  // ── Audit log ของลูก ──
  const loadAudit = useCallback(async () => {
    if (!activeKidId) return;
    setAuditLoading(true);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/audit`);
      if (!res.ok) return;
      const data = await res.json();
      setAudit(data.logs || []);
    } catch {
      // เงียบ
    } finally {
      setAuditLoading(false);
    }
  }, [activeKidId]);

  useEffect(() => {
    if (activeKidId && showKidHome) loadAudit();
  }, [activeKidId, showKidHome, loadAudit, kidHome]);

  return {
    kidHome, setKidHome, homeLoading, loadKidHome,
    choreForm, setChoreForm, choreRepeat, setChoreRepeat, addChoreUI, completeChoreUI, reopenChoreUI, deleteChoreUI,
    billForm, setBillForm, addBillUI, payBillUI, deleteBillUI,
    allowanceForm, setAllowanceForm, setAllowanceUI,
    piggyForm, setPiggyForm, piggyTransferUI, goalForm, setGoalForm, setSavingsGoalUI,
    targetForm, setTargetForm, setPiggyTargetUI,
    pinForm, setPinForm, setPinUI,
    stocks, stockForm, setStockForm, buyStockUI, sellStockUI,
    targetPctForm, setTargetPctForm, setTargetUI, depositForm, setDepositForm, addDepositUI,
    audit, auditLoading,
    couponForm, setCouponForm, addCouponUI, redeemCouponUI, deleteCouponUI,
    walletAmount, setWalletAmount, walletNote, setWalletNote, adjustWalletUI,
    policyText, setPolicyText, setMoneyModeUI, setInvestPolicyUI,
  };
}
