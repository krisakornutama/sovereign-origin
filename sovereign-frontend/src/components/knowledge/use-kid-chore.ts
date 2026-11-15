"use client";
// ── Hook: งานบ้าน + PIN ของลูก (เพิ่ม/ทำเสร็จ/เปิดใหม่/ลบ งานบ้าน + ตั้ง/ล้าง PIN + ถาม PIN ยืนยัน) ──
// ย้ายจาก use-kid-home.ts ตามเดิมทุกบรรทัด (FE-004) — ห้ามแก้ behavior
// (promptKidPin ถูกใช้ร่วมกับคูปอง — hook use-kid-money.ts รับผ่าน param)
import { useState, Dispatch, SetStateAction } from 'react';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { authFetch } from '../../lib/apiFetch';
import { KidHome } from './knowledge-types';

interface UseKidChoreParams {
  activeKidId: string | null;
  kidHome: KidHome | null;
  setMessage: Dispatch<SetStateAction<string>>;
  setTeachError: Dispatch<SetStateAction<string>>;
  loadKidHome: (kidId: string) => void;
}

export function useKidChore({ activeKidId, kidHome, setMessage, setTeachError, loadKidHome }: UseKidChoreParams) {
  const t = useLanguageStore((s) => s.t);

  const [choreForm, setChoreForm] = useState<{ title: string; reward: string; emoji: string }>({ title: '', reward: '10', emoji: '🧹' });
  const [choreRepeat, setChoreRepeat] = useState<'none' | 'daily'>('none');
  const [pinForm, setPinForm] = useState('');

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

  return {
    choreForm, setChoreForm, choreRepeat, setChoreRepeat, addChoreUI, completeChoreUI, reopenChoreUI, deleteChoreUI,
    pinForm, setPinForm, setPinUI, promptKidPin,
  };
}
