"use client";
import { useState, useCallback } from 'react';
import { authFetch } from '../../lib/apiFetch';
import { useLanguageStore } from '../../stores/useLanguageStore';
import VoiceInput from './VoiceInput';
import Icon from '../ui/Icon';

interface VoiceCommandResult {
  intent: string;
  entities: Record<string, any>;
  confidence: number;
  action?: { endpoint: string; method: string; payload: any };
  originalText: string;
}

interface PendingAction {
  intent: string;
  description: string;
  execute: () => Promise<void>;
}

export default function VoiceCommand({ onActionComplete }: { onActionComplete?: (result: VoiceCommandResult) => void }) {
  const t = useLanguageStore((s) => s.t);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<VoiceCommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingAction | null>(null);
  const [transcript, setTranscript] = useState('');

  const handleVoiceResult = useCallback(async (text: string) => {
    setTranscript(text);
    setError(null);
    setIsProcessing(true);

    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ai/voice-command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to parse voice command');

      const result: VoiceCommandResult = {
        intent: data.intent,
        entities: data.entities,
        confidence: data.confidence,
        action: data.action,
        originalText: data.originalText,
      };

      setLastResult(result);

      // ถ้า confidence สูงพอ (≥0.7) และมี action → ขอ confirm แล้ว execute
      if (result.confidence >= 0.7 && result.action) {
        const desc = buildDescription(result.intent, result.entities);
        setPendingConfirm({
          intent: result.intent,
          description: desc,
          execute: async () => {
            await executeAction(result.action!);
            onActionComplete?.(result);
          },
        });
      } else {
        // confidence ต่ำ → บอกผู้ใช้ว่าไม่เข้าใจ
        setError(t('voiceCommand.lowConfidence', 'ไม่เข้าใจชัดเจน โปรดพูดชัดเจนขึ้น'));
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  return (
    <div className="space-y-3">
      {/* Voice Input Button */}
      <VoiceInput
        onResult={handleVoiceResult}
        onListeningChange={(isListening) => {}}
      />

      {/* Transcript Display */}
      {transcript && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 text-sm">
          <div className="text-xs text-gray-400 mb-1">{t('voiceCommand.heard', 'ได้ยิน:')}</div>
          <div className="text-white">{transcript}</div>
        </div>
      )}

      {/* Processing Indicator */}
      {isProcessing && (
        <div className="flex items-center gap-2 text-sm text-sky-400">
          <div className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
          <span>{t('voiceCommand.processing', 'กำลังประมวลผล...')}</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-rose-950/50 border border-rose-700 rounded-lg p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Confirm Dialog */}
      {pendingConfirm && (
        <div className="bg-amber-950/50 border border-amber-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Icon name="mic" size={16} className="text-amber-400" />
            <span className="font-bold text-amber-300">{t('voiceCommand.confirmTitle', 'ยืนยันการดำเนินการ')}</span>
          </div>
          <p className="text-sm text-amber-200 mb-3">{pendingConfirm.description}</p>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                await pendingConfirm.execute();
                setPendingConfirm(null);
                setTranscript('');
              }}
              className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm font-bold"
            >
              {t('voiceCommand.confirm', 'ตกลง ดำเนินการ')}
            </button>
            <button
              onClick={() => setPendingConfirm(null)}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-bold"
            >
              {t('voiceCommand.cancel', 'ยกเลิก')}
            </button>
          </div>
        </div>
      )}

      {/* Last Result Summary */}
      {lastResult && !pendingConfirm && (
        <div className="bg-emerald-950/30 border border-emerald-700/50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Icon name="check" size={16} className="text-emerald-400" />
            <span className="font-bold text-emerald-300">{t('voiceCommand.completed', 'เสร็จสิ้น')}</span>
            <span className="text-xs text-gray-500">({lastResult.intent})</span>
          </div>
          <div className="text-xs text-gray-400">
            {lastResult.originalText}
          </div>
          <div className="text-[11px] text-gray-500 mt-1">
            Entities: {JSON.stringify(lastResult.entities).slice(0, 100)}
          </div>
        </div>
      )}
    </div>
  );
}

function buildDescription(intent: string, entities: Record<string, any>): string {
  const labels: Record<string, string> = {
    inventory_add: 'เพิ่มของเข้าคลัง',
    inventory_remove: 'นำของออกจากคลัง',
    farm_harvest: 'เก็บเกี่ยว',
    farm_plant: 'ปลูกพืช',
    health_bp: 'บันทึกความดัน',
    health_weight: 'บันทึกน้ำหนัก',
    health_sugar: 'บันทึกน้ำตาล',
    restaurant_order: 'สั่งอาหาร',
    restaurant_pay: 'จ่ายบิล',
    sensor_check: 'เช็คเซ็นเซอร์',
    system_status: 'เช็คสถานะระบบ',
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

  return `${label}: ${parts.join(' · ') || '—'}`;
}

async function executeAction(action: { endpoint: string; method: string; payload: any }) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${action.endpoint}`, {
    method: action.method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action.payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Action failed');
  return data;
}