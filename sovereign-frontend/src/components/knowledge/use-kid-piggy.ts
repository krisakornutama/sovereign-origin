"use client";
// ── Hook: ถังสะสมแต้ม + เป้าหมายออมรายเดือน + เป้าหมายถังระยะยาว ──
// ย้ายจาก use-kid-home.ts ตามเดิมทุกบรรทัด (FE-004) — ห้ามแก้ behavior
import { useState, Dispatch, SetStateAction } from 'react';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { authFetch } from '../../lib/apiFetch';

interface UseKidPiggyParams {
  activeKidId: string | null;
  setMessage: Dispatch<SetStateAction<string>>;
  setTeachError: Dispatch<SetStateAction<string>>;
  loadKidHome: (kidId: string) => void;
}

export function useKidPiggy({ activeKidId, setMessage, setTeachError, loadKidHome }: UseKidPiggyParams) {
  const t = useLanguageStore((s) => s.t);

  const [piggyForm, setPiggyForm] = useState<{ amount: string; note: string }>({ amount: '', note: '' });
  const [goalForm, setGoalForm] = useState<{ amount: string }>({ amount: '100' });
  const [targetForm, setTargetForm] = useState<{ title: string; amount: string }>({ title: '', amount: '500' });

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

  return {
    piggyForm, setPiggyForm, piggyTransferUI, goalForm, setGoalForm, setSavingsGoalUI,
    targetForm, setTargetForm, setPiggyTargetUI,
  };
}
