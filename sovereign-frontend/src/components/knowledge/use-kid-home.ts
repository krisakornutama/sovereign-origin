"use client";
// ── Orchestrator: State + handlers ของ "หน้าที่ของลูก" (งานบ้าน/บิล/กระเป๋าเงิน/ถัง/หุ้น/คูปอง/audit) ──
// (FE-004) เดิมรวมอยู่ไฟล์เดียว 554 บรรทัด — แยก logic ตาม domain เป็น hook ย่อย:
//   งานบ้าน+PIN → use-kid-chore.ts · บิล+กระเป๋าเงิน+ค่าขนม+คูปอง → use-kid-money.ts
//   ถังสะสมแต้ม+เป้าหมาย → use-kid-piggy.ts · หุ้น+โหมดเงิน+พอร์ตเงินจริง+audit → use-kid-invest.ts
// logic ทั้งหมดย้าย verbatim — interface/return ครบชุดเดิม ผู้เรียกทุกตัวไม่ต้องแก้
import { useState, useCallback, Dispatch, SetStateAction } from 'react';
import { authFetch } from '../../lib/apiFetch';
import { KidHome } from './knowledge-types';
import { useKidChore } from './use-kid-chore';
import { useKidMoney } from './use-kid-money';
import { useKidPiggy } from './use-kid-piggy';
import { useKidInvest } from './use-kid-invest';

interface UseKidHomeParams {
  activeKidId: string | null;
  showKidHome: boolean;
  isHydrated: boolean;
  isAuthenticated: boolean;
  setMessage: Dispatch<SetStateAction<string>>;
  setTeachError: Dispatch<SetStateAction<string>>;
}

export function useKidHome({ activeKidId, showKidHome, isHydrated, isAuthenticated, setMessage, setTeachError }: UseKidHomeParams) {
  const [kidHome, setKidHome] = useState<KidHome | null>(null);
  const [homeLoading, setHomeLoading] = useState(false);

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

  // ── งานบ้าน + PIN (ย้ายไป use-kid-chore.ts — FE-004) ──
  const chore = useKidChore({ activeKidId, kidHome, setMessage, setTeachError, loadKidHome });

  // ── บิล + กระเป๋าเงิน + ค่าขนม + คูปอง (ย้ายไป use-kid-money.ts — FE-004) ──
  const money = useKidMoney({ activeKidId, kidHome, promptKidPin: chore.promptKidPin, setMessage, setTeachError, loadKidHome });

  // ── ถังสะสมแต้ม + เป้าหมาย (ย้ายไป use-kid-piggy.ts — FE-004) ──
  const piggy = useKidPiggy({ activeKidId, setMessage, setTeachError, loadKidHome });

  // ── หุ้น + โหมดเงิน + นโยบาย + พอร์ตเงินจริง + audit (ย้ายไป use-kid-invest.ts — FE-004) ──
  const invest = useKidInvest({ activeKidId, kidHome, showKidHome, isHydrated, isAuthenticated, setMessage, setTeachError, loadKidHome });

  // คืนค่ารวม — ชุด key เดิมครบทุกตัว (59) ตามที่ผู้เรียกเคยใช้
  return {
    kidHome, setKidHome, homeLoading, loadKidHome,
    choreForm: chore.choreForm, setChoreForm: chore.setChoreForm, choreRepeat: chore.choreRepeat, setChoreRepeat: chore.setChoreRepeat, addChoreUI: chore.addChoreUI, completeChoreUI: chore.completeChoreUI, reopenChoreUI: chore.reopenChoreUI, deleteChoreUI: chore.deleteChoreUI,
    billForm: money.billForm, setBillForm: money.setBillForm, addBillUI: money.addBillUI, payBillUI: money.payBillUI, deleteBillUI: money.deleteBillUI,
    allowanceForm: money.allowanceForm, setAllowanceForm: money.setAllowanceForm, setAllowanceUI: money.setAllowanceUI,
    piggyForm: piggy.piggyForm, setPiggyForm: piggy.setPiggyForm, piggyTransferUI: piggy.piggyTransferUI, goalForm: piggy.goalForm, setGoalForm: piggy.setGoalForm, setSavingsGoalUI: piggy.setSavingsGoalUI,
    targetForm: piggy.targetForm, setTargetForm: piggy.setTargetForm, setPiggyTargetUI: piggy.setPiggyTargetUI,
    pinForm: chore.pinForm, setPinForm: chore.setPinForm, setPinUI: chore.setPinUI,
    stocks: invest.stocks, stockForm: invest.stockForm, setStockForm: invest.setStockForm, buyStockUI: invest.buyStockUI, sellStockUI: invest.sellStockUI,
    targetPctForm: invest.targetPctForm, setTargetPctForm: invest.setTargetPctForm, setTargetUI: invest.setTargetUI, depositForm: invest.depositForm, setDepositForm: invest.setDepositForm, addDepositUI: invest.addDepositUI,
    audit: invest.audit, auditLoading: invest.auditLoading,
    couponForm: money.couponForm, setCouponForm: money.setCouponForm, addCouponUI: money.addCouponUI, redeemCouponUI: money.redeemCouponUI, deleteCouponUI: money.deleteCouponUI,
    walletAmount: money.walletAmount, setWalletAmount: money.setWalletAmount, walletNote: money.walletNote, setWalletNote: money.setWalletNote, adjustWalletUI: money.adjustWalletUI,
    policyText: invest.policyText, setPolicyText: invest.setPolicyText, setMoneyModeUI: invest.setMoneyModeUI, setInvestPolicyUI: invest.setInvestPolicyUI,
  };
}
