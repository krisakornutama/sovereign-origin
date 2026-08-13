export default function WaterLevelBar({ value }: { value: number }) {
    const safeValue = Math.min(100, Math.max(0, value));
    return (
      <div className="flex flex-col items-center">
        <div className="text-3xl font-bold text-cyan-400">{safeValue.toFixed(0)}<span className="text-sm ml-1">%</span></div>
        <div className="w-8 h-24 bg-gray-700 rounded-full mt-2 overflow-hidden relative">
          <div className="absolute bottom-0 w-full bg-cyan-500 transition-all duration-500 rounded-full" style={{ height: `${safeValue}%` }} />
        </div>
        <span className="text-xs text-gray-400 mt-1">น้ำ</span>
      </div>
    );
  }