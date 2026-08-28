"use client";
import { useCallback, useRef, useState } from 'react';
import { authFetch } from '../lib/apiFetch';

export function useTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const speak = useCallback(async (opts: { text: string; rate?: number }) => {
    if (!opts.text?.trim()) return;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController(); abortRef.current = ac;
    setIsSpeaking(true); setError(null);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/tts/speak`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: opts.text, rate: opts.rate || 180 }),
        signal: ac.signal,
      } as any);
      if (!res.ok) { const j = await res.json().catch(()=>({error:'TTS failed'})); throw new Error(j.error || `TTS ${res.status}`); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url); audioRef.current = audio;
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => { URL.revokeObjectURL(url); setIsSpeaking(false); resolve(); };
        audio.onerror = () => { URL.revokeObjectURL(url); setIsSpeaking(false); reject(new Error('Audio playback failed')); };
        audio.play().catch(reject);
      });
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      setError(e.message); setIsSpeaking(false); throw e;
    }
  }, []);

  const stop = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
    setIsSpeaking(false);
  }, []);

  return { speak, stop, isSpeaking, error };
}
