"use client";
// ── พูดคุยอัตโนมัติ (wake word + ไมค์ + TTS) — ค่าอยู่ใน localStorage ของเครื่องนี้ ──
import { useState, useEffect } from 'react';
import { useLanguageStore } from '../../../stores/useLanguageStore';
import Icon from '../../ui/Icon';

export default function VoiceAutoSection() {
  const t = useLanguageStore((s) => s.t);
  const [enabled, setEnabled] = useState(false);
  const [wakeWord, setWakeWord] = useState('sovereign');
  const [micOk, setMicOk] = useState<'idle'|'ok'|'fail'>('idle');
  const [ttsVoice, setTtsVoice] = useState('piper');
  useEffect(() => {
    try {
      setEnabled(localStorage.getItem('voice:autoListen') === '1');
      const w = localStorage.getItem('voice:wakeWord');
      if (w) setWakeWord(w);
      const tv = localStorage.getItem('voice:ttsVoice');
      if (tv) setTtsVoice(tv);
    } catch {}
  }, []);
  const toggle = (v: boolean) => {
    setEnabled(v);
    try { localStorage.setItem('voice:autoListen', v ? '1' : '0'); } catch {}
  };
  const saveWake = (v: string) => {
    setWakeWord(v);
    try { localStorage.setItem('voice:wakeWord', v); } catch {}
  };
  const testMic = async () => {
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t=>t.stop()); setMicOk('ok'); setTimeout(()=>setMicOk('idle'),2000); } catch { setMicOk('fail'); setTimeout(()=>setMicOk('idle'),2000); }
  };
  const testTts = async () => {
    try { const { useTTS } = await import('../../../hooks/useTTS'); } catch {}
    try {
      const res = await fetch(`${localStorage.getItem('sovereign-api-url') || 'http://localhost:3001'}/api/tts/speak`, { method:'POST', headers:{'Content-Type':'application/json', 'Authorization': `Bearer ${localStorage.getItem('sovereign-token') || ''}`}, body: JSON.stringify({ text: 'ทดสอบเสียง สวัสดีครับ', rate: 180 }) });
      if (res.ok) { const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = new Audio(url); a.play(); }
    } catch {}
  };
  return (
    <section className="panel panel-cyan p-5 space-y-4">
      <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan flex items-center gap-2"><Icon name="mic" size={14} className="text-emerald-400" /> พูดคุยอัตโนมัติ</h2>
      <p className="text-xs text-gray-500">เปิดแล้วไมค์จะฟังต่อเนื่อง — พูดคำปลุก <b className="text-gray-300">{wakeWord}</b> หรือ <b className="text-gray-300">สวัสดี</b> แล้วตามด้วยคำสั่ง ระบบจัดการให้เลย ไม่ต้องกดปุ่มพูด</p>
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => toggle(!enabled)} className={enabled ? 'btn-primary' : 'btn-secondary'}>{enabled ? '✓ เปิดอยู่ — ฟังอัตโนมัติ' : 'เปิดพูดคุยอัตโนมัติ'}</button>
        {enabled && <span className="text-xs px-2 py-1 rounded-full bg-emerald-900/40 border border-emerald-700 text-emerald-300 animate-pulse">🎙️ ฟังต่อเนื่อง</span>}
        <input value={wakeWord} onChange={e => saveWake(e.target.value)} placeholder="คำปลุก เช่น sovereign" className="input text-sm w-40" />
        <button onClick={testMic} className="btn-secondary text-xs">{micOk==='ok'?'✓ ไมค์พร้อม':micOk==='fail'?'✗ ไมค์ไม่พร้อม':'ทดสอบไมค์'}</button>
        <button onClick={testTts} className="btn-secondary text-xs">ทดสอบเสียง</button>
        <select value={ttsVoice} onChange={e=>{ setTtsVoice(e.target.value); try{localStorage.setItem('voice:ttsVoice', e.target.value);}catch{}}} className="input text-xs w-28">
          <option value="piper">Piper ไทย</option>
          <option value="pyttsx3">pyttsx3</option>
        </select>
      </div>
      <div className="text-[11px] text-gray-600">ต้องใช้ <b>HTTPS / localhost</b> และอนุญาตไมค์ครั้งเดียว — ถ้าปิดแท็บแล้วเปิดใหม่ ต้องกดอนุญาตอีกครั้ง (เบราว์เซอร์จำกัด)</div>
    </section>
  );
}
