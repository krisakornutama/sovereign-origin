"use client";
import { useState, useRef, useCallback, useEffect } from 'react';
import { authFetch } from '../../lib/apiFetch';
import { useLanguageStore } from '../../stores/useLanguageStore';

interface VoiceInputProps {
  onResult: (text: string) => void;
  onListeningChange?: (isListening: boolean) => void;
  autoListen?: boolean;
}

// Web Speech API (Chrome/Edge) — รู้จำเสียงภาษาไทยในเบราว์เซอร์ ไม่ต้องพึ่ง backend
// ถ้าไม่มี → fallback ไป whisper backend (สำหรับเครื่องที่ตั้ง whisper ไว้เอง)
type SpeechRecognitionLike = any;

export default function VoiceInput({ onResult, onListeningChange, autoListen }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const t = useLanguageStore((s) => s.t);
  const autoListenRef = useRef(autoListen);
  autoListenRef.current = autoListen;

  const hasWebSpeech =
    typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  // ── วิธีหลัก: Web Speech API (ทำงานในเบราว์เซอร์ ฟรี ไม่ต้อง backend) ──
  const startWebSpeech = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SR();
    recognitionRef.current = recognition;

    recognition.lang = 'th-TH';
    recognition.continuous = !!autoListenRef.current;
    recognition.interimResults = !!autoListenRef.current;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      onListeningChange?.(true);
    };

    recognition.onresult = (event: any) => {
      let text = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) text += event.results[i][0].transcript + ' ';
      }
      text = text.trim() || event.results?.[0]?.[0]?.transcript?.trim() || '';
      if (text) {
        onResult(text);
        if (autoListenRef.current) {
          // continuous mode keeps listening, don't stop
          return;
        }
      } else {
        setError(t('dashboard.voiceInput.noHear', 'ไม่ได้ยินเสียง กรุณาลองใหม่'));
      }
    };

    recognition.onerror = (event: any) => {
      // not-allowed → ผู้ใช้กดปฏิเสธไมค์; no-speech → เงียบเกินไป
      setError(
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? t('dashboard.voiceInput.micPermission', 'กรุณาอนุญาตการเข้าถึงไมโครโฟน')
          : event.error === 'no-speech'
          ? t('dashboard.voiceInput.noHear', 'ไม่ได้ยินเสียง กรุณาลองใหม่')
          : t('dashboard.voiceInput.listenFailed', 'ฟังเสียงไม่สำเร็จ กรุณาลองใหม่')
      );
      setIsListening(false);
      onListeningChange?.(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      onListeningChange?.(false);
      if (autoListenRef.current) {
        try { setTimeout(() => recognition.start(), 400); } catch {}
      }
    };

    try {
      recognition.start();
    } catch {
      setError(t('dashboard.voiceInput.listenFailed', 'ฟังเสียงไม่สำเร็จ กรุณาลองใหม่'));
      setIsListening(false);
      onListeningChange?.(false);
    }
  }, [onResult, onListeningChange]);

  const stopWebSpeech = useCallback(() => {
    recognitionRef.current?.stop?.();
    setIsListening(false);
    onListeningChange?.(false);
  }, [onListeningChange]);

  // ── fallback: whisper backend (MediaRecorder → POST /api/whisper/transcribe) ──
  const startWhisper = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      const chunks: BlobPart[] = [];

      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/wav' });
        const formData = new FormData();
        formData.append('audio', blob, 'recording.wav');
        formData.append('language', 'th');

        try {
          const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/whisper/transcribe`, {
            method: 'POST',
            body: formData,
          });
          const data = await res.json();
          if (data.text?.trim()) {
            onResult(data.text.trim());
          } else {
            setError(t('dashboard.voiceInput.noHear', 'ไม่ได้ยินเสียง กรุณาลองใหม่'));
          }
        } catch {
          setError(t('dashboard.voiceInput.sendFailed', 'ส่งข้อมูลไม่สำเร็จ'));
        }

        stream.getTracks().forEach((t) => t.stop());
        setIsListening(false);
        onListeningChange?.(false);
      };

      mediaRecorder.start();
      setIsListening(true);
      onListeningChange?.(true);

      setTimeout(() => {
        if (mediaRecorder.state === 'recording') mediaRecorder.stop();
      }, 5000);
    } catch {
      setError(t('dashboard.voiceInput.micPermission', 'กรุณาอนุญาตการเข้าถึงไมโครโฟน'));
    }
  }, [onResult, onListeningChange]);

  const startListening = useCallback(() => {
    setError(null);
    if (hasWebSpeech) startWebSpeech();
    else startWhisper();
  }, [hasWebSpeech, startWebSpeech, startWhisper]);

  const stopListening = useCallback(() => {
    if (hasWebSpeech) stopWebSpeech();
    else if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setIsListening(false);
    onListeningChange?.(false);
  }, [hasWebSpeech, stopWebSpeech, onListeningChange]);

  useEffect(() => {
    if (autoListen && hasWebSpeech && !isListening) {
      const t = setTimeout(() => startWebSpeech(), 500);
      return () => clearTimeout(t);
    }
    if (!autoListen && isListening) {
      stopWebSpeech();
    }
  }, [autoListen, hasWebSpeech, isListening]);

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onClick={isListening ? stopListening : startListening}
        className={`p-2.5 rounded-full transition-all duration-300 ${
          isListening
            ? 'bg-rose-600 animate-pulse'
            : 'bg-gray-700 hover:bg-gray-600'
        }`}
        title={isListening ? t('dashboard.voiceInput.titleListening', 'กำลังฟัง... คลิกเพื่อหยุด') : t('dashboard.voiceInput.titleSpeak', 'กดเพื่อพูด')}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8h-1a6 6 0 01-12 0H3a7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {isListening && (
        <span className="ml-2 text-xs text-rose-400 animate-pulse hidden sm:inline">
          {t('dashboard.voiceInput.listening', 'กำลังฟัง...')}
        </span>
      )}

      {error && (
        <div className="absolute top-full mt-2 left-0 bg-rose-950/90 text-rose-300 text-xs px-3 py-1.5 rounded-lg whitespace-nowrap z-50">
          {error}
        </div>
      )}
    </div>
  );
}