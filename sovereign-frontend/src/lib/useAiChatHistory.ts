"use client";
import { useState, useEffect, useCallback, useRef } from 'react';
import { authFetch } from './apiFetch';
import { asArray } from './fetchJson';

// ─────────────────────────────────────────────────────────────
// useAiChatHistory — เจ้าของเดียวของ Conversational Memory ฝั่ง client
// (เดิม AiChatPanel กับหน้า ai-agent เขียนโหลด/ล้างประวัติซ้ำกัน 2 ที่
//  และเคยเพี้ยนพฤติกรรมต่างกัน — hook นี้รวมเป็นจุดเดียว)
//
// รูปร่างข้อความกลาง: { id?, role: 'user' | 'ai' | 'assistant', content }
// - backend จริง /api/ai/history ส่ง role 'assistant' — AiChatPanel แปลงเป็น 'ai'
// - mock (:3101) ส่งตามที่เราเขียน ('user'/'assistant')
// ─────────────────────────────────────────────────────────────

export interface AiChatMessage {
  id?: string;
  role: 'user' | 'ai';
  content: string;
}

interface RawHistoryItem {
  id?: string;
  role?: string;
  content?: string;
}

export function useAiChatHistory(limit = 50, enabled = true) {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [loaded, setLoaded] = useState(!enabled); // enabled=false → ถือว่าโหลดแล้ว (โหมดเงียบ)
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ai/history?limit=${limit}`);
      if (!res.ok) return;
      const body = await res.json();
      const list = asArray<RawHistoryItem>(body.history ?? body);
      const mapped: AiChatMessage[] = list
        .filter((m) => typeof m?.content === 'string')
        .map((m) => ({ id: m.id, role: m.role === 'user' ? 'user' : 'ai', content: String(m.content) }));
      if (aliveRef.current) setMessages(mapped);
    } catch {
      // offline — เริ่มด้วยประวัติว่าง (พฤติกรรมเดิม)
    } finally {
      if (aliveRef.current) setLoaded(true);
    }
  }, [limit, enabled]);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  const appendLocal = useCallback((msg: AiChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const clearServer = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ai/history`, { method: 'DELETE' });
      if (!res.ok) return false;
      if (aliveRef.current) setMessages([]);
      return true;
    } catch {
      return false;
    }
  }, []);

  return { messages, setMessages, loaded, reload: load, appendLocal, clearServer };
}
