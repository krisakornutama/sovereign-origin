"use client";
import { useState, useCallback } from 'react';
import { authFetch } from '../../lib/apiFetch';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { useAuthStore } from '../../stores/useAuthStore';
import VoiceInput from './VoiceInput';
import Icon from '../ui/Icon';
import { useTTS } from '../../hooks/useTTS';

interface VoiceCommandResult {
  intent: string;
  entities: Record<string, any>;
  confidence: number;
  action?: { endpoint: string; method: string; payload: any };
  originalText: string;
  isQuery?: boolean;
  queryResult?: any;
}

interface PendingAction {
  intent: string;
  description: string;
  execute: (token?: string) => Promise<void>;
}

export default function VoiceCommand({ onActionComplete }: { onActionComplete?: (result: VoiceCommandResult) => void }) {
  const t = useLanguageStore((s) => s.t);
  const { speak } = useTTS();
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<VoiceCommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingAction | null>(null);
  const [transcript, setTranscript] = useState('');
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [wakeEnabled, setWakeEnabled] = useState(() => { try { return localStorage.getItem('voice:autoListen') === '1'; } catch { return false; } });
  const [history, setHistory] = useState<VoiceCommandResult[]>(() => {
    try { return JSON.parse(localStorage.getItem('voice_history') || '[]'); } catch { return []; }
  });

  const pushHistory = useCallback((r: VoiceCommandResult) => {
    setHistory(h => {
      const nh = [r, ...h].slice(0, 20);
      try { localStorage.setItem('voice_history', JSON.stringify(nh)); } catch {}
      try { authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ai/voice-history`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text: r.originalText, intent: r.intent, entities: r.entities }) }).catch(()=>{}); } catch {}
      return nh;
    });
  }, []);

  const speakResponse = useCallback(async (text: string) => {
    if (!ttsEnabled || !text?.trim()) return;
    try { await speak({ text, rate: 180 }); } catch (e: any) { console.warn('TTS failed:', e.message); }
  }, [ttsEnabled, speak]);

  const handleVoiceResult = useCallback(async (text: string) => {
    setTranscript(text);
    setError(null);
    setIsProcessing(true);
    try {
      const isQuery = /^(เช็ค|เช็คว่า|สถานะ|ค่า|ดู|ข้อมูล)/.test(text.trim().toLowerCase()) || text.trim().endsWith('ไหม') || text.trim().endsWith('?');
      let url = `${process.env.NEXT_PUBLIC_API_URL}/api/ai/${isQuery ? 'voice-query' : 'voice-command'}`;
      if (isQuery) url += `?text=${encodeURIComponent(text)}`;
      const res = await authFetch(url, {
        method: isQuery ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: !isQuery ? JSON.stringify({ text }) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to parse voice command');
      const result: VoiceCommandResult = {
        intent: data.intent,
        entities: data.entities,
        confidence: data.confidence,
        action: data.action,
        originalText: data.originalText,
        isQuery: data.isQuery,
        queryResult: data.queryResult,
      };
      setLastResult(result); pushHistory(result);
      try { window.dispatchEvent(new CustomEvent('sovereign:voice', { detail: result })); } catch {}
      const autoFillIntents = new Set(['inventory_add','inventory_remove','farm_plant','farm_harvest','health_bp','health_weight','health_sugar','restaurant_order']);
      if (autoFillIntents.has(result.intent)) { try { window.dispatchEvent(new CustomEvent('sovereign:voice-prefill', { detail: result })); } catch {} }
      let responseText = '';
      if (isQuery) {
        if (data.queryResult?.metric) responseText = `${data.queryResult.metric} คือ ${data.queryResult.value} ${data.queryResult.unit || ''}`;
        else if (data.queryResult?.count != null) responseText = `พบ ${data.queryResult.count} คน`;
        else if (data.queryResult?.total != null) responseText = `รวม ${data.queryResult.total} รายการ`;
        else if (data.queryResult?.recent) responseText = `พบ ${data.queryResult.recent.length} รายการล่าสุด`;
        else if (data.queryResult?.relays) responseText = `พบรีเลย์ ${data.queryResult.relays.length} ตัว`;
        else if (data.queryResult?.totalValue) responseText = `มูลค่ารวม ${data.queryResult.totalValue} ดอลลาร์`;
        else if (data.queryResult?.uptime) responseText = `ระบบทำงานมาแล้ว ${data.queryResult.uptime}`;
        else responseText = 'ดึงข้อมูลสำเร็จ';
        await speakResponse(responseText);
      } else {
        if (result.confidence >= 0.7 && result.action) {
          const desc = buildDescription(result.intent, result.entities);
          responseText = `กำลัง${desc} กรุณายืนยัน`;
          await speakResponse(responseText);
          setPendingConfirm({
            intent: result.intent,
            description: desc,
            execute: async (token?: string) => {
              const tk = token || useAuthStore.getState().token;
              await executeAction(result.action!, tk);
              onActionComplete?.(result);
              await speakResponse(`ทำ${desc}เสร็จแล้ว`);
            },
          });
        } else if (result.confidence < 0.7) {
          setError(t('voiceCommand.lowConfidence', 'ไม่เข้าใจชัดเจน โปรดพูดชัดเจนขึ้น'));
          await speakResponse('ไม่เข้าใจชัดเจน โปรดพูดชัดเจนขึ้น');
        }
      }
    } catch (err: any) {
      setError(err.message);
      await speakResponse(`เกิดข้อผิดพลาด ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [t, speakResponse, onActionComplete]);

  // wake word: ถ้าเปิด จะฟังต่อเนื่องและกรองเฉพาะที่มีคำว่า sovereign/สวัสดี
  const handleWakeResult = useCallback((text: string) => {
    const low = text.toLowerCase();
    if (wakeEnabled && !/(sovereign|สวัสดี|หวัดดี)/.test(low)) return;
    const cleaned = text.replace(/(sovereign|สวัสดี|หวัดดี)/gi, '').trim() || text;
    handleVoiceResult(cleaned);
  }, [wakeEnabled, handleVoiceResult]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <VoiceInput onResult={wakeEnabled ? handleWakeResult : handleVoiceResult} onListeningChange={() => {}} autoListen={wakeEnabled} />
        <button onClick={() => setTtsEnabled(!ttsEnabled)} className={`p-2.5 rounded-full transition-all ${ttsEnabled ? 'bg-emerald-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`} title={ttsEnabled ? t('voiceCommand.ttsOn', 'เปิด TTS') : t('voiceCommand.ttsOff', 'ปิด TTS')}>
          <Icon name={ttsEnabled ? 'volume-2' : 'volume-x'} size={18} />
        </button>
        <button onClick={() => { const v = !wakeEnabled; setWakeEnabled(v); try { localStorage.setItem('voice:autoListen', v ? '1' : '0'); } catch {} }} className={`px-3 py-2 rounded-full text-xs font-bold border ${wakeEnabled ? 'bg-sky-600 border-sky-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400'}`} title="ฟังต่อเนื่องด้วย wake word sovereign/สวัสดี">
          {wakeEnabled ? '🎙️ Wake ON' : '💤 Wake OFF'}
        </button>
        {history.length > 0 && <span className="text-[11px] text-gray-500">{history.length} ครั้ง</span>}
      </div>
      {transcript && <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 text-sm"><div className="text-xs text-gray-400 mb-1">{t('voiceCommand.heard', 'ได้ยิน:')}</div><div className="text-white">{transcript}</div></div>}
      {isProcessing && <div className="flex items-center gap-2 text-sm text-sky-400"><div className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" /><span>{t('voiceCommand.processing', 'กำลังประมวลผล...')}</span></div>}
      {error && <div className="bg-rose-950/50 border border-rose-700 rounded-lg p-3 text-sm text-rose-300">{error}</div>}
      {pendingConfirm && (
        <div className="bg-amber-950/50 border border-amber-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2"><Icon name="mic" size={16} className="text-amber-400" /><span className="font-bold text-amber-300">{t('voiceCommand.confirmTitle', 'ยืนยันการดำเนินการ')}</span></div>
          <p className="text-sm text-amber-200 mb-3">{pendingConfirm.description}</p>
          <div className="flex gap-2">
            <button onClick={async () => { const token = useAuthStore.getState().token; await pendingConfirm.execute(token); setPendingConfirm(null); setTranscript(''); }} className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm font-bold">{t('voiceCommand.confirm', 'ตกลง ดำเนินการ')}</button>
            <button onClick={() => setPendingConfirm(null)} className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-bold">{t('voiceCommand.cancel', 'ยกเลิก')}</button>
          </div>
        </div>
      )}
      {lastResult && !pendingConfirm && (
        <div className="bg-emerald-950/30 border border-emerald-700/50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2"><Icon name="check" size={16} className="text-emerald-400" /><span className="font-bold text-emerald-300">{t('voiceCommand.completed', 'เสร็จสิ้น')}</span><span className="text-xs text-gray-500">({lastResult.intent})</span></div>
          <div className="text-xs text-gray-400">{lastResult.originalText}</div>
          {lastResult.isQuery && lastResult.queryResult && <div className="mt-2 p-2 bg-gray-800/50 rounded text-xs text-sky-300"><div className="font-bold text-sky-400 mb-1">ผลลัพธ์:</div><pre className="text-[10px] overflow-auto max-h-40">{JSON.stringify(lastResult.queryResult, null, 2).slice(0, 500)}</pre></div>}
          <div className="text-[11px] text-gray-500 mt-1">Entities: {JSON.stringify(lastResult.entities).slice(0, 100)}</div>
        </div>
      )}
      {history.length > 0 && (
        <details className="bg-gray-900/40 border border-gray-800 rounded-lg p-2">
          <summary className="text-xs font-bold text-gray-400 cursor-pointer">ประวัติ {history.length} คำสั่ง</summary>
          <div className="mt-2 space-y-1 max-h-40 overflow-auto">
            {history.map((h, i) => <div key={i} className="text-[11px] flex justify-between bg-gray-800/50 rounded px-2 py-1"><span className="text-gray-300 truncate">{h.originalText}</span><span className="text-gray-500 ml-2">{h.intent}</span></div>)}
          </div>
          <button onClick={() => { setHistory([]); try { localStorage.removeItem('voice_history'); } catch {} }} className="mt-2 text-[11px] text-red-400 hover:underline">ล้างประวัติ</button>
        </details>
      )}
    </div>
  );
}

function buildDescription(intent: string, entities: Record<string, any>): string {
  const labels: Record<string, string> = {
    inventory_add: 'เพิ่มของเข้าคลัง', inventory_remove: 'นำของออกจากคลัง', farm_harvest: 'เก็บเกี่ยว', farm_plant: 'ปลูกพืช',
    health_bp: 'บันทึกความดัน', health_weight: 'บันทึกน้ำหนัก', health_sugar: 'บันทึกน้ำตาล',
    restaurant_order: 'สั่งอาหาร', restaurant_pay: 'จ่ายบิล', sensor_check: 'เช็คเซ็นเซอร์', system_status: 'เช็คสถานะระบบ',
    kids_chore: 'งานบ้านลูก', kids_bill: 'บิลลูก', kids_allowance: 'ค่าขนม', kids_coupon: 'คูปอง', kids_lesson: 'บทเรียน', kids_portfolio: 'พอร์ตลูก',
    relay_control: 'ควบคุมรีเลย์', energy_status: 'สถานะพลังงาน',
  };
  const label = labels[intent] || intent;
  const parts: string[] = [];
  if (entities.item) parts.push(`${entities.item}`);
  if (entities.crop) parts.push(`พืช: ${entities.crop}`);
  if (entities.menu) parts.push(`เมนู: ${entities.menu}`);
  if (entities.quantity != null) parts.push(`${entities.quantity}${entities.unit ? ' ' + entities.unit : ''}`);
  if (entities.systolic != null) parts.push(`BP ${entities.systolic}/${entities.diastolic}`);
  if (entities.value != null) parts.push(`ค่า ${entities.value}`);
  if (entities.table) parts.push(`โต๊ะ ${entities.table}`);
  if (entities.payment) parts.push(`จ่าย ${entities.payment === 'promptpay' ? 'PromptPay' : 'เงินสด'}`);
  if (entities.kidName) parts.push(`ลูก: ${entities.kidName}`);
  if (entities.relayId) parts.push(`รีเลย์ ${entities.relayId} ${entities.relayAction || ''}`);
  return `${label}: ${parts.join(' · ') || '—'}`;
}

async function executeAction(action: { endpoint: string; method: string; payload: any }, token?: string) {
  const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}${action.endpoint}`, {
    method: action.method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(action.payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Action failed');
  return data;
}
