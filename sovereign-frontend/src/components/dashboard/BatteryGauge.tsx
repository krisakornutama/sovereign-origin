import Icon from '../ui/Icon';
import { useLanguageStore } from '../../stores/useLanguageStore';

export default function BatteryGauge({ value, critical }: { value: number; critical?: boolean }) {
    const t = useLanguageStore((s) => s.t);
    const safeValue = Math.min(100, Math.max(0, value));
    const barColor = critical ? 'bg-rose-500' : safeValue > 50 ? 'bg-emerald-500' : 'bg-amber-500';
    return (
      <div className="flex flex-col items-center">
        <div className="text-3xl font-bold text-white">{safeValue.toFixed(0)}<span className="text-sm ml-1">%</span></div>
        <div className="w-full bg-gray-700 h-3 rounded-full mt-2 overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${safeValue}%` }} />
        </div>
        {critical && <span className="text-xs text-rose-400 mt-1 animate-pulse flex items-center gap-1"><Icon name="alert-triangle" size={11} /> {t('common.batteryVeryLow', 'ต่ำมาก')}</span>}
      </div>
    );
  }