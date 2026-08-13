"use client";
import { useState, useRef, useCallback } from 'react';
import { authFetch } from '../../lib/apiFetch';

interface VoiceInputProps {
  onResult: (text: string) => void;
  onListeningChange?: (isListening: boolean) => void;
}

// Web Speech API (Chrome/Edge) — รู้จำเสียงภาษาไทยในเบราว์เซอร์ ไม่ต้องพึ่ง backend
// ถ้าไม่มี → fallback ไป whisper backend (สำหรับเครื่องที่ตั้ง whisper ไว้เอง)
type SpeechRecognitionLike = any;

export default function VoiceInput({ onResult, onListeningChange }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const hasWebSpeech =
    typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  // ── วิธีหลัก: Web Speech API (ทำงานในเบราว์เซอร์ ฟรี ไม่ต้อง backend) ──
  const startWebSpeech = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SR();
    recognitionRef.current = recognition;

    recognition.lang = 'th-TH';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      onListeningChange?.(true);
    };

    recognition.onresult = (event: any) => {
      const text = event.results?.[0]?.[0]?.transcript?.trim();
      if (text) {
        onResult(text);
      } else {
        setError('ไม่ได้ยินเสียง กรุณาลองใหม่');
      }
    };

    recognition.onerror = (event: any) => {
      // not-allowed → ผู้ใช้กดปฏิเสธไมค์; no-speech → เงียบเกินไป
      setError(
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'กรุณาอนุญาตการเข้าถึงไมโครโฟน'
          : event.error === 'no-speech'
          ? 'ไม่ได้ยินเสียง กรุณาลองใหม่'
          : 'ฟังเสียงไม่สำเร็จ กรุณาลองใหม่'
      );
      setIsListening(false);
      onListeningChange?.(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      onListeningChange?.(false);
    };

    try {
      recognition.start();
    } catch {
      setError('ฟังเสียงไม่สำเร็จ กรุณาลองใหม่');
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
            setError('ไม่ได้ยินเสียง กรุณาลองใหม่');
          }
        } catch {
          setError('ส่งข้อมูลไม่สำเร็จ');
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
      setError('กรุณาอนุญาตการเข้าถึงไมโครโฟน');
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

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onClick={isListening ? stopListening : startListening}
        className={`p-2.5 rounded-full transition-all duration-300 ${
          isListening
            ? 'bg-red-600 animate-pulse shadow-lg shadow-red-500/50 scale-110'
            : 'bg-gray-700 hover:bg-gray-600 hover:scale-105'
        }`}
        title={isListening ? 'กำลังฟัง... คลิกเพื่อหยุด' : 'กดเพื่อพูด'}
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
        <span className="ml-2 text-xs text-red-400 animate-pulse hidden sm:inline">
          กำลังฟัง...
        </span>
      )}

      {error && (
        <div className="absolute top-full mt-2 left-0 bg-red-900/90 text-red-300 text-xs px-3 py-1.5 rounded-lg whitespace-nowrap z-50">
          {error}
        </div>
      )}
    </div>
  );
}