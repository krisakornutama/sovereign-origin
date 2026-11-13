"use client";
// ── Hook: หุ้นจำลองของบ้าน + โหมดเงินจริง/จำลอง + นโยบายลงทุน + พอร์ตเงินจริง + audit log ──
// ย้ายจาก use-kid-home.ts ตามเดิมทุกบรรทัด (FE-004) — ห้ามแก้ behavior
// (จัดก้อนเดียวกันเพราะ buy/sell หุ้นและเปลี่ยนโหมด/ตั้งเป้าทุกตัวเรียก loadAudit ร่วมกัน)
import { useState, useEffect, useCallback, Dispatch, SetStateAction } from 'react';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { authFetch } from '../../lib/apiFetch';
import { KidAuditRow, KidHome, KidStock } from './knowledge-types';

interface UseKidInvestParams {
  activeKidId: string | null;
  kidHome: KidHome | null;
  showKidHome: boolean;
  isHydrated: boolean;
  isAuthenticated: boolean;
  setMessage: Dispatch<SetStateAction<string>>;
  setTeachError: Dispatch<SetStateAction<string>>;
  loadKidHome: (kidId: string) => void;
}

export function useKidInvest({ activeKidId, kidHome, showKidHome, isHydrated, isAuthenticated, setMessage, setTeachError, loadKidHome }: UseKidInvestParams) {
  const t = useLanguageStore((s) => s.t);

  const [stocks, setStocks] = useState<KidStock[]>([]);
  const [stockForm, setStockForm] = useState<{ symbol: string; units: string }>({ symbol: 'FARM', units: '1' });
  const [audit, setAudit] = useState<KidAuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [policyText, setPolicyText] = useState('');
  const [depositForm, setDepositForm] = useState<{ amount: string; note: string }>({ amount: '', note: '' });
  const [targetPctForm, setTargetPctForm] = useState<{ pct: string }>({ pct: '2' });

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
    stocks, stockForm, setStockForm, buyStockUI, sellStockUI,
    targetPctForm, setTargetPctForm, setTargetUI, depositForm, setDepositForm, addDepositUI,
    audit, auditLoading,
    policyText, setPolicyText, setMoneyModeUI, setInvestPolicyUI,
  };
}
