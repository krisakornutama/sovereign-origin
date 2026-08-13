"use client";

import { useCallback, useEffect, useState } from 'react';

export function useSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(null);

  const loadVoices = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const availableVoices = window.speechSynthesis.getVoices();
    if (!availableVoices || availableVoices.length === 0) return;

    setVoices(availableVoices);

    // คัดกรองเฉพาะเสียงภาษาไทย
    const thaiVoices = availableVoices.filter((v) =>
      v.lang.toLowerCase().includes('th')
    );

    if (thaiVoices.length > 0) {
      const preferredVoice =
        thaiVoices.find(
          (v) =>
            v.name.includes('Google') ||
            v.name.includes('Natural') ||
            v.name.includes('Premwadee') ||
            v.name.includes('Niwat')
        ) || thaiVoices[0];

      setSelectedVoice(preferredVoice);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, [loadVoices]);

  const speak = useCallback(
    (text: string) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        console.warn('SpeechSynthesis not supported');
        return;
      }

      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'th-TH'; // กำหนดภาษามาตรฐานภาษาไทย
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      // 📍 หากพบเสียงภาษาไทยค่อยยัดใส่ ถ้าไม่พบให้ปล่อย null เพื่อใช้เสียงพื้นฐานของระบบ
      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      window.speechSynthesis.speak(utterance);
    },
    [selectedVoice]
  );

  const stopSpeaking = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);

  const toggleAutoSpeak = useCallback(() => {
    setAutoSpeak((prev) => !prev);
  }, []);

  return {
    speak,
    stopSpeaking,
    isSpeaking,
    autoSpeak,
    toggleAutoSpeak,
    voices,
    selectedVoice,
    setSelectedVoice,
    hasThaiVoice: voices.some((v) => v.lang.toLowerCase().includes('th')),
  };
}