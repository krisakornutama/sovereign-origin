// ── Coding IDE: เทอร์มินัลล่าง (ย่อ/ขยาย) (ย้ายจาก CodingIde.tsx verbatim — FE-007) ──
import { useLanguageStore } from '../../../stores/useLanguageStore';
import Icon from '../../ui/Icon';

interface Props {
  termOpen: boolean;
  setTermOpen: (v: boolean) => void;
  termOut: string[];
  termCmd: string;
  setTermCmd: (v: string) => void;
  runTerm: () => void;
  termBusy: boolean;
  termEndRef: any;
}

export default function CodingTerminal({
  termOpen, setTermOpen, termOut, termCmd, setTermCmd, runTerm, termBusy, termEndRef,
}: Props) {
  const t = useLanguageStore((s) => s.t);

  return (
      <section className="card panel-cyan overflow-hidden flex-none">
        <button
          onClick={() => setTermOpen(!termOpen)}
          className="w-full flex items-center gap-2 px-3 h-10 text-xs font-semibold text-gray-300 hover:bg-gray-800/50 transition"
          title={t('aiAgent.workspace.terminalTitle', 'เทอร์มินัล (รันคำสั่งในเครื่อง — cwd = โปรเจ็ก, กันคำสั่งอันตราย)')}
        >
          <Icon name="terminal" size={13} className="text-gray-400 shrink-0" />
          <span className="shrink-0">{t('aiAgent.coding.ide.terminalBar', 'เทอร์มินัล')}</span>
          <span className="flex-1 text-left font-mono text-[10px] text-gray-500 truncate min-w-0">
            {termOut.length > 0 ? termOut[termOut.length - 1] : t('aiAgent.workspace.terminalHint', '— พิมพ์คำสั่งด้านบน (PowerShell) —')}
          </span>
          <Icon name="chevron-down" size={12} className={`transition-transform shrink-0 ${termOpen ? 'rotate-180' : ''}`} />
        </button>
        {termOpen && (
          <div className="px-3 pb-3 space-y-2">
            <div className="flex gap-2">
              <input
                value={termCmd}
                onChange={(e) => setTermCmd(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runTerm()}
                placeholder={t('aiAgent.workspace.phCommand', 'เช่น git status หรือ dir')}
                className="input flex-1 font-mono"
              />
              <button
                onClick={runTerm}
                disabled={termBusy || !termCmd.trim()}
                className="btn-secondary"
              >
                {termBusy ? t('aiAgent.workspace.running', 'กำลังรัน...') : (
                  <>
                    <Icon name="play" size={13} />
                    {t('common.run', 'รัน')}
                  </>
                )}
              </button>
            </div>
            <div className="bg-black border border-gray-800 rounded-lg p-2 h-32 overflow-y-auto font-mono text-[11px] text-emerald-300 space-y-1 log-stream">
              {termOut.length === 0 && <p className="text-gray-600">{t('aiAgent.workspace.terminalHint', '— พิมพ์คำสั่งด้านบน (PowerShell) —')}</p>}
              {termOut.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
              ))}
              <div ref={termEndRef} />
            </div>
          </div>
        )}
      </section>
  );
}
