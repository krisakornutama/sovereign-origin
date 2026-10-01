// P20 — เครดิตผู้ดูแลโครงการ (โชว์ท้ายหน้าสาธารณะทุกหน้า — ผูกตัวตนกับโดเมน ให้คนและ Google เชื่อมโยง)
export function FounderCredit({ className = '' }: { className?: string }) {
  return (
    <div className={`text-center text-[10px] text-gray-600 ${className}`}>
      Sovereign Origin · ดูแลโดย{' '}
      <a href="https://github.com/krisakornutama" target="_blank" rel="noopener noreferrer" className="hover:text-gray-400 underline underline-offset-2">กฤษกรณ์ อุตมะ</a>
    </div>
  );
}
