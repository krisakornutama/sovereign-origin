// ── Coding Agent: เทอร์มินัลล่าง (ย้ายจาก CodingIde.tsx verbatim — FE-007) ──
import { useEffect, useRef, useState } from 'react';
import { authFetch } from '../../../lib/apiFetch';
import { useLanguageStore } from '../../../stores/useLanguageStore';
import { API } from '../coding-ide-shared';

export function useCodingTerminal() {
  const t = useLanguageStore((s) => s.t);

  // ── เทอร์มินัลล่าง ──
  const [termOpen, setTermOpen] = useState(false);
  const [termCmd, setTermCmd] = useState('');
  const [termOut, setTermOut] = useState<string[]>([]);
  const [termBusy, setTermBusy] = useState(false);
  const termEndRef = useRef<HTMLDivElement>(null);

  const runTerm = async () => {
    const cmd = termCmd.trim();
    if (!cmd || termBusy) return;
    setTermBusy(true);
    setTermOut((p) => [...p, `> ${cmd}`]);
    try {
      const res = await authFetch(`${API}/api/coding/terminal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('aiAgent.coding.termFailed', 'รันคำสั่งไม่สำเร็จ'));
      setTermOut((p) => [...p, data.output]);
    } catch (errr: any) {
      setTermOut((p) => [...p, String(errr.message || errr)]);
    }
    setTermBusy(false);
    setTermCmd('');
  };

  // เลื่อนเทอร์มินัลล่างสุดทุกครั้งที่มี output ใหม่
  useEffect(() => {
    termEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [termOut]);

  return { termOpen, setTermOpen, termCmd, setTermCmd, termOut, termBusy, termEndRef, runTerm };
}
