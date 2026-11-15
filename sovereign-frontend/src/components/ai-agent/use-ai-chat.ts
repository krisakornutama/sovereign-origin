// ── แชท AI: ประวัติ + ส่งข้อความ + แนบรูป ──
// ย้ายจาก pages/ai-agent.tsx ตามเดิมทุกบรรทัด (FE-005) — ห้ามแก้พฤติกรรม
import { useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '../../lib/apiFetch';
import { withMbti } from '../../lib/mbtiAi';
import { useAiChatHistory } from '../../lib/useAiChatHistory';
import { useLanguageStore } from '../../stores/useLanguageStore';
import type { ChatMsg } from '../../lib/ai-agent-types';

export function useAiChat(isHydrated: boolean, isAuthenticated: boolean) {
  const t = useLanguageStore((s) => s.t);

  // B4: ประวัติแชทใช้ hook กลาง useAiChatHistory (เจ้าของเดียวกับ AiChatPanel บน dashboard)
  // หน้านี้โหลดหลัง auth พร้อม (enabled = isHydrated && isAuthenticated) และข้อความมี created_at แนบ
  const aiHistory = useAiChatHistory(50, isHydrated && isAuthenticated);
  const chatMsgs: ChatMsg[] = useMemo(
    () => aiHistory.messages.map((m, i) => ({ id: m.id ?? `h-${i}`, role: m.role === 'user' ? 'user' : 'assistant', content: m.content, created_at: new Date().toISOString() })),
    [aiHistory.messages]
  );
  const chatLoaded = aiHistory.loaded;
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [chatImage, setChatImage] = useState<string | null>(null); // base64 รูปในแชท (ถ้ามี)

  const fileToBase64 = (file: File, cb: (b64: string) => void) => {
    const reader = new FileReader();
    reader.onload = () => cb(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  // เลื่อนลงล่างสุดอัตโนมัติเมื่อมีข้อความใหม่
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [chatMsgs.length, chatLoading]);

  const sendChat = async () => {
    const text = chatInput.trim();
    if ((!text && !chatImage) || chatLoading) return;
    setChatInput('');
    setChatError('');
    aiHistory.appendLocal({ role: 'user', content: chatImage ? `[รูปภาพ] ${text}` : text });
    setChatLoading(true);
    const imageBase64 = chatImage || undefined;
    setChatImage(null);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withMbti({ message: text || 'ดูรูปภาพนี้ให้หน่อย', imageBase64 })),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        aiHistory.appendLocal({ role: 'ai', content: data.reply || t('aiAgent.chat.noReply', '(ไม่มีคำตอบ)') });
      } else {
        setChatError(data.error || `API error ${res.status}`);
      }
    } catch (err) {
      setChatError(t('aiAgent.coreApiError', 'เชื่อมต่อ Core API ไม่ได้'));
    } finally {
      setChatLoading(false);
    }
  };

  return {
    chatMsgs,
    chatLoaded,
    chatInput,
    setChatInput,
    chatLoading,
    chatError,
    chatImage,
    setChatImage,
    chatEndRef,
    fileToBase64,
    sendChat,
  };
}
