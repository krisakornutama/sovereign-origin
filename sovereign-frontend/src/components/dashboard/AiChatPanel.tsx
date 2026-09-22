"use client";
import { useState, useRef, useEffect, useCallback } from 'react';
import { useIsSuperadmin } from '../../lib/roles';
import Link from 'next/link';
import { authFetch } from '../../lib/apiFetch';
import { withMbti } from '../../lib/mbtiAi';
import { careToneFor, latestLocalResult } from '../../lib/mbtiData';
import { useAiChatHistory } from '../../lib/useAiChatHistory';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLanguageStore } from '../../stores/useLanguageStore';
import VoiceInput from './VoiceInput';
import Icon from '../ui/Icon';

interface ChatMessage {
  id?: string;
  role: 'user' | 'ai';
  content: string;
}

// ข้อความตอบที่บอกว่าต้องการอนุมัติ (มาจาก AiAgentService เมื่อ action ถูก queue)
function isApprovalReply(text: string): boolean {
  return /ต้องรอการอนุมัติ|รหัสคำขอ|api\/ai\/approvals/.test(text);
}

export default function AiChatPanel({ compact = false }: { compact?: boolean }) {
  const { user } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const isSuperadmin = useIsSuperadmin();

  // B4: ประวัติแชทมีเจ้าของเดียว — hook useAiChatHistory (เดิมเขียนโหลด/ล้างเอง ซ้ำกับหน้า ai-agent)
  const { messages, setMessages, appendLocal, clearServer } = useAiChatHistory(50);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // โทนหลวงพี่ปัจจุบัน — อ่านจากผล MBTI ล่าสุดใน localStorage (client-only, รอ hydrate)
  // ทำไม: ผู้ใช้ควรเห็นว่า AI กำลังปรับโทนตามอะไร — และเมื่อยังไม่เคยทำแบบทดสอบ ให้ชวนอย่างอ่อนโยน
  const [mbtiCode, setMbtiCode] = useState<string | null>(null);
  useEffect(() => {
    setMbtiCode(latestLocalResult()?.code ?? null);
  }, []);
  const careTone = careToneFor(mbtiCode);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const clearHistory = async () => {
    if (!window.confirm(t('dashboard.aiChat.clearHistoryConfirm', 'ล้างประวัติการสนทนาทั้งหมด? AI จะจำไม่ได้ว่าคุยอะไรไว้'))) return;
    await clearServer();
  };

  // จำนวนคำขออนุมัติที่รออยู่ (เฉพาะ SUPERADMIN — API นี้ต้องการ role สูงสุด)
  const loadPendingCount = useCallback(async () => {
    if (!isSuperadmin) return;
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ai/approvals`);
      if (!res.ok) return;
      const approvals = await res.json();
      setPendingCount(approvals.filter((a: any) => a.status === 'pending').length);
    } catch {
      // เงียบๆ — badge จะยังโชว์ค่าล่าสุดที่ได้
    }
  }, [isSuperadmin]);

  useEffect(() => {
    loadPendingCount();
    const interval = setInterval(loadPendingCount, 10000);
    return () => clearInterval(interval);
  }, [loadPendingCount]);

  // TTS: อ่านข้อความออกเสียง — ใช้ Web Speech API (ในเบราว์เซอร์) ก่อน เลือกเสียงไทยถ้ามี
  // fallback ไป backend TTS (สำหรับเครื่องที่ตั้ง tts_speak.py ไว้)
  const speakText = async (text: string) => {
    const speakViaBrowser = () => {
      if (!('speechSynthesis' in window)) return false;
      const voices = window.speechSynthesis.getVoices();
      const thaiVoice = voices.find((v) => v.lang?.toLowerCase().startsWith('th'));
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = thaiVoice?.lang || 'th-TH';
      if (thaiVoice) utterance.voice = thaiVoice;
      utterance.rate = 1;
      window.speechSynthesis.speak(utterance);
      return true;
    };

    if (speakViaBrowser()) return;

    // fallback: backend TTS
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/tts/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, rate: 180 }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      audio.play();
    } catch {
      // เงียบ — อย่างน้อยมีข้อความให้อ่าน
    }
  };

  const sendMessage = async (query?: string) => {
    const text = query || input;
    if (!text.trim() || isLoading) return;

    appendLocal({ role: 'user', content: text });
    setInput('');
    setIsLoading(true);

    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withMbti({ message: text })),
      });

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        // backend ตอบกลับแต่ล้มเหลว — แยกเคส AI offline (503) จากเคสอื่น
        const msg = res.status === 503
          ? t('dashboard.aiChat.aiOffline', '⚠️ AI ออฟไลน์ — ตรวจว่า Ollama เปิดอยู่ที่ :11434 หรือเปิดหน้า AI Agent เพื่อดูสถานะ')
          : `${t('dashboard.aiChat.apiError', 'เกิดข้อผิดพลาดจากเซิร์ฟเวอร์')} (${res.status})`;
        appendLocal({ role: 'ai', content: msg });
        return;
      }
      const reply = data.reply || t('dashboard.aiChat.processError', 'ไม่สามารถประมวลผลได้');

      appendLocal({ role: 'ai', content: reply });

      // ถ้า AI ขออนุมัติ → อัปเดต badge ทันที
      if (isApprovalReply(reply)) loadPendingCount();

      // Auto-speak
      if (autoSpeak) {
        setTimeout(() => speakText(reply), 300);
      }
    } catch (err) {
      // fetch ล้มเอง = ติดต่อ backend ไม่ได้เลย — บอกผู้ใช้ว่าต้องเช็คอะไร ไม่ใช่แค่ "เกิดข้อผิดพลาด"
      appendLocal({ role: 'ai', content: t('dashboard.aiChat.offlineHint', '⚠️ ติดต่อ Core API (:3001) ไม่ได้ — ตรวจว่า backend เปิดอยู่ หรือไปที่หน้า AI Agent เพื่อดูสถานะ') });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVoiceResult = (text: string) => {
    setInput(text);
    sendMessage(text);
  };

  // ปุ่มเร็ว — label ผ่าน i18n (key เชิงความหมาย), query เป็นข้อความจริงที่ยิง backend
  const quickQuestions = [
    { key: 'soilSalinity', label: t('dashboard.aiChat.quickQuestions.soilSalinity', 'เช็คดินเค็ม'), query: 'เช็คดินเค็ม' },
    { key: 'batteryStatus', label: t('dashboard.aiChat.quickQuestions.batteryStatus', 'สถานะแบตเตอรี่'), query: 'สถานะแบตเตอรี่' },
    { key: 'emergency', label: t('dashboard.aiChat.quickQuestions.emergency', 'Emergency'), query: 'Emergency Protocol' },
    { key: 'phase2', label: t('dashboard.aiChat.quickQuestions.phase2', 'แผน Phase 2'), query: 'แผน Phase 2' },
  ];

  return (
    <div className={`panel panel-glow flex flex-col ${compact ? 'h-[380px]' : 'h-[600px] lg:h-[700px]'}`}>
      {/* Header */}
      <div className="p-4 border-b border-gray-700 flex justify-between items-center">
        <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5 glow-text">
          <Icon name="ai" size={14} /> Sovereign AI
        </h3>
        <div className="flex items-center gap-2">
          {isSuperadmin && (
            <Link               href="/ai-agent" scroll={false}
              title={t('dashboard.aiChat.approvalsTitle', 'เปิดหน้าจัดการคำขออนุมัติของ AI agent')}
              className={`text-xs px-2.5 py-1 rounded-full border transition flex items-center gap-1 ${
                pendingCount > 0
                  ? 'bg-amber-600/20 border-amber-500 text-amber-300 animate-pulse'
                  : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'
              }`}
            >
              <Icon name="shield" size={11} /> {t('dashboard.aiChat.pendingApprovals', '{n} รออนุมัติ', { n: pendingCount })}
            </Link>
          )}
          <button
            onClick={() => setAutoSpeak(!autoSpeak)}
            className={`text-xs px-2 py-1 rounded-full border transition ${
              autoSpeak
                ? 'bg-emerald-600/20 border-emerald-500 text-emerald-400'
                : 'bg-gray-800 border-gray-600 text-gray-500'
            }`}
            title={autoSpeak ? t('dashboard.aiChat.muteSound', 'ปิดเสียง') : t('dashboard.aiChat.unmuteSound', 'เปิดเสียง')}
          >
            {autoSpeak ? t('common.on', 'ON') : t('common.off', 'OFF')}
          </button>
          <button
            onClick={clearHistory}
            title={t('dashboard.aiChat.clearHistoryTitle', 'ล้างประวัติการสนทนา')}
            className="text-xs px-2 py-1 rounded-full border bg-gray-800 border-gray-600 text-gray-500 hover:bg-red-900/30 hover:text-red-300 transition flex items-center"
          >
            <Icon name="trash" size={12} />
          </button>
        </div>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-gray-500 text-sm text-center py-8">
            {t('dashboard.aiChat.emptyHint', 'ถามอะไรเกี่ยวกับ Sovereign Hub ได้เลย...')}
          </div>
        )}
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] p-3 rounded-xl ${
                msg.role === 'user'
                  ? 'bg-blue-600/20 text-blue-300 rounded-br-sm'
                  : 'bg-gray-800/80 text-emerald-400 rounded-bl-sm border border-gray-700'
              }`}
            >
              <div className="text-xs opacity-75 mb-1 flex items-center gap-1">
                {msg.role === 'user' ? (
                  <><Icon name="users" size={11} /> {t('dashboard.aiChat.you', 'คุณ')}</>
                ) : (
                  <><Icon name="ai" size={11} /> AI</>
                )}
              </div>
              <div className="text-sm whitespace-pre-line">{msg.content}</div>
              {msg.role === 'ai' && (
                <div className="mt-2 flex items-center gap-3">
                  <button
                    onClick={() => speakText(msg.content)}
                    className="text-xs text-gray-500 hover:text-gray-300 transition"
                  >
                    {t('dashboard.aiChat.replay', 'อ่านซ้ำ')}
                  </button>
                  {isApprovalReply(msg.content) && (
                    <Link                       href="/ai-agent" scroll={false}
                      className="text-xs px-2.5 py-1 bg-amber-600/20 border border-amber-500 text-amber-300 rounded-lg hover:bg-amber-600/30 transition flex items-center gap-1"
                    >
                      <Icon name="shield" size={11} /> {t('dashboard.aiChat.goToAgent', 'ไปจัดการที่หน้า AI Agent →')}
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-800/80 text-emerald-400 rounded-bl-sm border border-gray-700 p-3 rounded-xl max-w-[85%]">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce delay-100" />
                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce delay-200" />
              </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* ชิปโทนหลวงพี่ — บอกผู้ใช้ว่า AI กำลังปรับโทนตามผล MBTI ล่าสุด (หรือชวนไปทำแบบทดสอบ) */}
      {mbtiCode && careTone && (
        <div className="px-4 pb-1 flex items-center gap-1.5 flex-wrap">
          <span
            data-testid="mbti-tone-chip"
            className="text-[10px] px-2 py-0.5 rounded-full bg-fuchsia-900/30 border border-fuchsia-700/60 text-fuchsia-300"
            title={`${careTone.tone} — ${careTone.insight ?? ''}`}
          >
            ✨ {mbtiCode} · {careTone.yakLabel}
          </span>
        </div>
      )}
      {!mbtiCode && (
        <div className="px-4 pb-1">
          <Link href="/mbti" className="text-[10px] text-gray-500 hover:text-fuchsia-300 transition">
            {t('dashboard.aiChat.mbtiInvite', '✨ ทำแบบทดสอบ MBTI แล้ว AI จะปรับโทนการดูแลให้เข้ากับคุณ →')}
          </Link>
        </div>
      )}

      {/* Quick Questions */}
      <div className="px-4 pb-2 flex gap-1.5 flex-wrap">
        {quickQuestions.map((q) => (
          <button
            key={q.key}
            onClick={() => sendMessage(q.query)}
            disabled={isLoading}
            className="text-xs px-2.5 py-1 bg-gray-800 hover:bg-gray-700 rounded-full transition disabled:opacity-50"
          >
            {q.label}
          </button>
        ))}
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-gray-700">
        <div className="flex gap-2 items-center">
          <VoiceInput onResult={handleVoiceResult} onListeningChange={setIsVoiceActive} />

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            className="flex-1 bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
            placeholder={isVoiceActive ? t('dashboard.aiChat.listening', 'กำลังฟังเสียง...') : t('dashboard.aiChat.placeholder', 'พิมพ์หรือกดไมค์เพื่อพูด...')}
            disabled={isLoading}
          />

          <button
            onClick={() => sendMessage()}
            aria-label={t('dashboard.aiChat.send', 'ส่งข้อความ')}
            disabled={isLoading || !input.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Icon name="send" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}