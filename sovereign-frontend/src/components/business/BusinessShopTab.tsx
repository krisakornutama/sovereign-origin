import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { authFetch } from '../../lib/apiFetch';
import { fetchJsonObject } from '../../lib/fetchJson';
import { getApiUrl } from '../../lib/config';
import Icon from '../ui/Icon';
import type { ShopSettings } from './shared';

// ── แท็บร้านค้าชุมชน (แยกจาก BusinessWorkspace — phase 3) ──
export function BusinessShopTab({ bizId, bizName, canManage, base, setNotice, refreshBiz }: { bizId: string; bizName: string; canManage: boolean; base: string; setNotice: (n: { ok: boolean; text: string } | null) => void; refreshBiz?: () => void }) {
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [shopName, setShopName] = useState('');
  const [promptPay, setPromptPay] = useState('');
  const [taxId, setTaxId] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const s = await fetchJsonObject<ShopSettings>(`${base}/shop`);
    if (s) {
      setSettings(s);
      setShopName(s.shopName ?? '');
      setTaxId(s.taxId ?? '');
      setAddress(s.address ?? '');
    }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  // P18 — ปุ่มทดสอบ Telegram: ยิงข้อความทดสอบด้วย endpoint ที่ระบบแจ้งเตือนใช้จริง (SUPERADMIN เท่านั้น)
  const [tgBusy, setTgBusy] = useState(false);
  async function testTelegram() {
    setTgBusy(true);
    try {
      const r = await fetch(`${getApiUrl()}/api/telegram/test`, { method: 'POST', headers: { Authorization: `Bearer ${useAuthStore.getState().token}` } });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.success) throw new Error(d?.error ?? `HTTP ${r.status}`);
      setNotice({ ok: true, text: 'ยิง Telegram แล้ว — เช็คข้อความ "Sovereign Alert — test message" บนมือถือ' });
    } catch (e: any) {
      setNotice({ ok: false, text: `ทดสอบไม่สำเร็จ: ${e.message}` });
    } finally {
      setTgBusy(false);
    }
  }

  async function save(payload: any, okText: string) {
    setBusy(true);
    try {
      const data = await (await fetch(`${base}/shop`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${useAuthStore.getState().token}` },
        body: JSON.stringify(payload),
      })).json();
      if (data?.error) throw new Error(data.error);
      setSettings(data);
      setShopName(data.shopName ?? '');
      setPromptPay('');
      setTaxId(data.taxId ?? '');
      setAddress(data.address ?? '');
      refreshBiz?.();
      setNotice({ ok: true, text: okText });
    } catch (e: any) {
      setNotice({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const publicUrl = typeof window !== 'undefined' ? `${window.location.origin}/shop?id=${bizId}` : '';

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div className="text-sm font-semibold">🏪 หน้าร้านสาธารณะ</div>
        <p className="text-xs text-slate-400">
          เปิดร้านแล้วลูกค้าทั่วไปเข้า /shop ดูสินค้าและสั่งซื้อได้โดยไม่ต้อง login — ออเดอร์จะโผล่ที่แท็บออเดอร์ (สถานะ “ใบเสนอราคา” เลข S…)
          กด “ยืนยัน (หักสต็อก)” ตามปกติ ลูกค้าเช็คสถานะ/แจ้งชำระเงินผ่านลิงก์ลับของออเดอร์
        </p>
        {!canManage ? (
          <div className="text-sm text-slate-500">ต้องเป็นผู้จัดการขึ้นไปจึงตั้งค่าหน้าร้านได้</div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={settings?.shopOpen ?? false} disabled={busy}
                  onChange={(e) => save({ shopOpen: e.target.checked }, e.target.checked ? 'เปิดร้านแล้ว — ลูกค้าเข้า /shop ได้' : 'ปิดร้านแล้ว — /shop จะขึ้นว่าไม่พบร้าน')}
                  className="w-4 h-4" />
                <span>เปิดร้านให้ลูกค้าเข้าชม/สั่งซื้อ</span>
              </label>
              {settings?.shopOpen && (
                <a href={`/shop?id=${bizId}`} target="_blank" rel="noreferrer" className="text-xs text-cyan-400 hover:underline">เปิดหน้าร้านดู →</a>
              )}
            </div>
            {settings?.shopOpen && (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={settings?.shopInCommunity ?? false} disabled={busy}
                    onChange={(e) => save({ shopInCommunity: e.target.checked }, e.target.checked ? 'ร้านเข้าร่วม catalog กลางชุมชนแล้ว — เห็นที่ /community' : 'ถอนร้านจาก catalog กลางชุมชนแล้ว')}
                    className="w-4 h-4" />
                  <span>รวมร้านเข้า catalog กลางชุมชน (/community — โชว์เฉพาะชื่อสินค้า/ราคาขาย ไม่มีต้นทุน)</span>
                </label>
                {settings?.shopInCommunity && (
                  <a href="/community" target="_blank" rel="noreferrer" className="text-xs text-lime-400 hover:underline">ดู catalog กลาง →</a>
                )}
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1" htmlFor="shop-name-input">ชื่อร้านบนหน้าเว็บ (ว่าง = ใช้ชื่อธุรกิจ)</label>
                <input id="shop-name-input" value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder={bizName}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1" htmlFor="shop-pp-input">
                  PromptPay (เบอร์ 10 หลัก หรือเลขบัตร 13 หลัก){settings?.promptPaySet ? ` — ตั้งแล้ว ${settings.promptPayMasked}` : ''}
                </label>
                <input id="shop-pp-input" value={promptPay} onChange={(e) => setPromptPay(e.target.value)} placeholder="08XXXXXXXX"
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1" htmlFor="shop-taxid-input">เลขประจำตัวผู้เสียภาษี 13 หลัก (พิมพ์บนใบกำกับภาษี)</label>
                <input id="shop-taxid-input" value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="ไม่กรอก = ช่องว่างบนเอกสาร"
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1" htmlFor="shop-address-input">ที่อยู่ร้าน (พิมพ์บนใบกำกับภาษี)</label>
              <input id="shop-address-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="เลขที่ ซอย ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด"
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => save({ shopName: shopName.trim(), taxId: taxId.trim(), address: address.trim(), ...(promptPay.trim() ? { shopPromptPay: promptPay.trim() } : {}) }, 'บันทึกการตั้งค่าร้านแล้ว')}
                disabled={busy} className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-medium disabled:opacity-40">บันทึก</button>
              {settings?.promptPaySet && (
                <button onClick={() => save({ shopPromptPay: '' }, 'ลบ PromptPay แล้ว — QR จะถูกปิด')}
                  disabled={busy} className="px-3 py-1.5 rounded-lg border border-rose-500/40 text-rose-300 text-xs hover:bg-rose-500/10">ลบ PromptPay</button>
              )}
            </div>
            {settings?.shopOpen && (
              <div className="text-[11px] text-slate-500 break-all">ลิงก์ร้าน: {publicUrl} — ส่งให้ลูกค้าผ่าน LINE/Facebook ได้เลย</div>
            )}
            <div className="flex items-center gap-2">
              <button onClick={testTelegram}
                disabled={tgBusy || !canManage}
                className="px-3 py-1.5 rounded-lg border border-cyan-500/40 text-cyan-300 text-xs hover:bg-cyan-500/10 disabled:opacity-40"
                title="ยิงข้อความทดสอบเข้า Telegram ของคุณทันที — ไม่ต้องรอลูกค้าแจ้งชำระจริง">
                {tgBusy ? 'กำลังส่ง…' : '🔔 ทดสอบ Telegram'}
              </button>
              <span className="text-[11px] text-slate-500">ทดสอบยิง Telegram ของคุณเอง — ถ้ามือถือเด้ง = ระบบแจ้งชำระ/บิลพร้อมใช้</span>
            </div>
          </>
        )}
      </div>
      {settings?.shopOpen && (
        <div className="card p-3 text-xs text-slate-400">
          <div className="font-semibold text-slate-300 mb-1">วงจรออเดอร์จากหน้าร้าน</div>
          ลูกค้าสั่ง → ได้เลขที่ S… + ลิงก์ลับเช็คสถานะ (แสดงให้ลูกค้าทันที) → คุณกด “ยืนยัน (หักสต็อก)” ที่แท็บออเดอร์ →
          ลูกค้าแจ้งชำระ (บันทึกเป็น PROMPTPAY/รอตรวจ) → คุณตรวจเงินเข้าแล้วกด “รับชำระ” → PAID → ส่งของตามปกติ
        </div>
      )}
    </div>
  );
}


