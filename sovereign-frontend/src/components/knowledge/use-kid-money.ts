"use client";
// ── Hook: บิล + กระเป๋าเงิน + ค่าขนมรายสัปดาห์ + คูปองรางวัล ──
// ย้ายจาก use-kid-home.ts ตามเดิมทุกบรรทัด (FE-004) — ห้ามแก้ behavior
// (redeemCouponUI ยืม promptKidPin จาก use-kid-chore.ts ผ่าน param)
import { useState, Dispatch, SetStateAction } from 'react';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { authFetch } from '../../lib/apiFetch';
import { KidCoupon, KidHome, WEEKDAY_LABELS } from './knowledge-types';

interface UseKidMoneyParams {
  activeKidId: string | null;
  kidHome: KidHome | null;
  promptKidPin: () => string | null;
  setMessage: Dispatch<SetStateAction<string>>;
  setTeachError: Dispatch<SetStateAction<string>>;
  loadKidHome: (kidId: string) => void;
}

export function useKidMoney({ activeKidId, kidHome, promptKidPin, setMessage, setTeachError, loadKidHome }: UseKidMoneyParams) {
  const t = useLanguageStore((s) => s.t);

  const [billForm, setBillForm] = useState<{ title: string; amount: string; emoji: string; period: string }>({ title: '', amount: '20', emoji: '💡', period: 'one-time' });
  const [walletAmount, setWalletAmount] = useState('');
  const [walletNote, setWalletNote] = useState('');
  const [allowanceForm, setAllowanceForm] = useState<{ day: string; amount: string }>({ day: '0', amount: '20' });
  const [couponForm, setCouponForm] = useState<{ title: string; cost: string; emoji: string }>({ title: '', cost: '50', emoji: '🎮' });

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

  return {
    billForm, setBillForm, addBillUI, payBillUI, deleteBillUI,
    allowanceForm, setAllowanceForm, setAllowanceUI,
    walletAmount, setWalletAmount, walletNote, setWalletNote, adjustWalletUI,
    couponForm, setCouponForm, addCouponUI, redeemCouponUI, deleteCouponUI,
  };
}
