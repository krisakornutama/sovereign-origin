"use client";
import { useState } from 'react';

type AccentColor = 'emerald' | 'cyan' | 'amber' | 'red' | 'violet' | 'blue';

type HoverCardProps = {
  /** Icon emoji or text shown on the front face */
  icon?: string;
  /** Title of the card */
  title: string;
  /** Primary metric/value shown on the front face */
  metric?: string | number;
  /** Unit for the metric */
  unit?: string;
  /** Detailed content rendered on the back face */
  detail?: React.ReactNode;
  /** Additional actions/buttons on the back face */
  actions?: React.ReactNode;
  /** Accent color theme */
  accent?: AccentColor;
  /** Card width class */
  width?: string;
  /** If true, expands downward instead of flipping */
  expand?: boolean;
  /** Status indicator color */
  status?: 'online' | 'offline' | 'warning' | 'critical';
  /** Extra class names for the card container */
  className?: string;
};

function StatusDot({ status }: { status: HoverCardProps['status'] }) {
  if (!status) return null;
  const colors: Record<string, string> = {
    online: 'bg-emerald-400 shadow-emerald-400/60',
    offline: 'bg-gray-500 shadow-gray-500/60',
    warning: 'bg-amber-400 shadow-amber-400/60',
    critical: 'bg-red-400 shadow-red-400/60',
  };
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${colors[status]}`} />
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${colors[status]}`} />
    </span>
  );
}

const ACCENT_CLASSES: Record<AccentColor, {
  text: string;
  borderHover: string;
  glow: string;
  borderBack: string;
}> = {
  emerald: {
    text: 'text-emerald-400',
    borderHover: 'group-hover:border-emerald-500/40',
    glow: 'group-hover:shadow-emerald-500/20',
    borderBack: 'border-emerald-500/40',
  },
  cyan: {
    text: 'text-cyan-400',
    borderHover: 'group-hover:border-cyan-500/40',
    glow: 'group-hover:shadow-cyan-500/20',
    borderBack: 'border-cyan-500/40',
  },
  amber: {
    text: 'text-amber-400',
    borderHover: 'group-hover:border-amber-500/40',
    glow: 'group-hover:shadow-amber-500/20',
    borderBack: 'border-amber-500/40',
  },
  red: {
    text: 'text-red-400',
    borderHover: 'group-hover:border-red-500/40',
    glow: 'group-hover:shadow-red-500/20',
    borderBack: 'border-red-500/40',
  },
  violet: {
    text: 'text-violet-400',
    borderHover: 'group-hover:border-violet-500/40',
    glow: 'group-hover:shadow-violet-500/20',
    borderBack: 'border-violet-500/40',
  },
  blue: {
    text: 'text-blue-400',
    borderHover: 'group-hover:border-blue-500/40',
    glow: 'group-hover:shadow-blue-500/20',
    borderBack: 'border-blue-500/40',
  },
};

export default function HoverCard({
  icon,
  title,
  metric,
  unit,
  detail,
  actions,
  accent = 'emerald',
  width = 'w-64',
  expand = false,
  status,
  className = '',
}: HoverCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const accentClasses = ACCENT_CLASSES[accent];

  if (expand) {
    return (
      <div
        className={`relative ${width} group ${className}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Front face */}
        <div
          className={`
            card rounded-2xl border border-gray-700/60 bg-gray-900/80 backdrop-blur-sm
            p-4 transition-all duration-300 ease-out
            group-hover:border-gray-600 group-hover:shadow-lg group-hover:shadow-gray-900/40
            ${isHovered ? 'rounded-b-none' : ''}
          `}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {icon && <span className="text-xl">{icon}</span>}
              <div>
                <h3 className="text-sm font-semibold text-gray-200 leading-tight">{title}</h3>
                {metric !== undefined && (
                  <p className={`text-lg font-bold mono mt-0.5 ${accentClasses.text}`}>
                    {metric}
                    {unit && <span className="text-xs text-gray-500 ml-1 font-normal">{unit}</span>}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusDot status={status} />
              <svg
                className={`w-4 h-4 text-gray-500 transition-transform duration-300 ${isHovered ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </div>

        {/* Expandable detail panel */}
        <div
          className={`
            overflow-hidden transition-all duration-300 ease-out
            ${isHovered ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}
          `}
        >
          <div className="card rounded-b-2xl rounded-t-none border-t-0 border border-gray-700/60 bg-gray-900/90 backdrop-blur-sm p-4">
            {detail && <div className="text-sm text-gray-300 mb-3">{detail}</div>}
            {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
          </div>
        </div>
      </div>
    );
  }

  // Flip card variant
  return (
    <div
      className={`relative ${width} group ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{ perspective: '1200px' }}
    >
      <div
        className={`
          relative w-full transition-transform duration-500 ease-out
          ${isHovered ? 'rotate-y-180' : ''}
        `}
        style={{ transformStyle: 'preserve-3d' }}
      >
        {/* Front face */}
        <div
          className={`
            card rounded-2xl border border-gray-700/60 bg-gray-900/80 backdrop-blur-sm
            p-4 transition-all duration-300 ease-out
            ${accentClasses.borderHover} ${accentClasses.glow}
            ${isHovered ? 'opacity-0 pointer-events-none' : 'opacity-100'}
          `}
          style={{ backfaceVisibility: 'hidden' }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {icon && <span className="text-xl">{icon}</span>}
              <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
            </div>
            <StatusDot status={status} />
          </div>
          {metric !== undefined && (
            <p className={`text-2xl font-bold mono ${accentClasses.text}`}>
              {metric}
              {unit && <span className="text-xs text-gray-500 ml-1.5 font-normal">{unit}</span>}
            </p>
          )}
          <div className="mt-2 flex items-center gap-1 text-[10px] text-gray-500">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Hover to reveal details</span>
          </div>
        </div>

        {/* Back face */}
        <div
          className={`
            absolute inset-0 card rounded-2xl ${accentClasses.borderBack} bg-gray-900/90 backdrop-blur-md
            p-4 transition-all duration-300
            ${isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'}
          `}
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {icon && <span className="text-xl">{icon}</span>}
              <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
            </div>
            <StatusDot status={status} />
          </div>

          {metric !== undefined && (
            <div className={`text-3xl font-bold mono mb-1 ${accentClasses.text}`}>
              {metric}
              {unit && <span className="text-sm text-gray-500 ml-1.5 font-normal">{unit}</span>}
            </div>
          )}

          {detail && (
            <div className="text-sm text-gray-300 mb-3 leading-relaxed">{detail}</div>
          )}

          {actions && (
            <div className="flex flex-wrap gap-2 mt-auto pt-2 border-t border-gray-700/50">
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
