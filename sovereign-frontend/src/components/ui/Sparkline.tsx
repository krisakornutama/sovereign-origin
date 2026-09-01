"use client";
import { useMemo } from 'react';

type SparklineProps = {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
};

export default function Sparkline({ data, width = 120, height = 40, color = '#10b981', fill = true }: SparklineProps) {
  const { line, area } = useMemo(() => {
    if (!data.length) return { line: '', area: '' };
    if (data.length===1) { const y = height - ((data[0] - Math.min(...data)) / 1) * (height - 4) - 2; const p=`${width/2},${y}`; return { line: `M${p} L${p}`, area: `M${width/2},${height} L${p} L${width/2},${height} Z` }; }
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const step = width / (data.length - 1);
    const points = data.map((v, i) => `${i * step},${height - ((v - min) / range) * (height - 4) - 2}`);
    const line = 'M' + points.join(' L');
    const area = `M0,${height} L${points.join(' L')} L${width},${height} Z`;
    return { line, area };
  }, [data, width, height]);

  if (!line) return null;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      {fill && area && (
        <path
          d={area}
          fill={color}
          fillOpacity="0.15"
          stroke="none"
        />
      )}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="sparkline-path"
      />
    </svg>
  );
}
