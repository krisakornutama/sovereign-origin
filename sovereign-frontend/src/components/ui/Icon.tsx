"use client";

// ─────────────────────────────────────────────────────────────
//  Icon — ชุดไอคอนเส้นบาง (stroke) 24x24 สำหรับทั้งแอป
//  ใช้แทน emoji ในส่วน UI เพื่อให้ดูเป็นระบบเดียวกัน
//  ใช้งาน: <Icon name="dashboard" size={16} className="text-gray-400" />
// ─────────────────────────────────────────────────────────────
import React from 'react';

const ICONS: Record<string, React.ReactNode> = {
  // ── นำทาง ──
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  sensors: (
    <>
      <circle cx="5" cy="5" r="2" />
      <circle cx="19" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <line x1="6.5" y1="6.5" x2="10.5" y2="10.5" />
      <line x1="17.5" y1="6.5" x2="13.5" y2="10.5" />
      <line x1="12" y1="14" x2="12" y2="19" />
      <line x1="8" y1="21" x2="16" y2="21" />
    </>
  ),
  energy: (
    <path d="M13 2 L5 13 h6 l-1 9 8-11 h-6 l1-9z" />
  ),
  predictive: (
    <>
      <path d="M4 20 L10 12 L14 15 L20 6" />
      <circle cx="4" cy="20" r="1.5" />
      <circle cx="10" cy="12" r="1.5" />
      <circle cx="14" cy="15" r="1.5" />
      <circle cx="20" cy="6" r="1.5" />
    </>
  ),
  relay: (
    <>
      <rect x="2" y="8" width="6" height="8" rx="1.5" />
      <rect x="16" y="8" width="6" height="8" rx="1.5" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </>
  ),
  automation: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </>
  ),
  ota: (
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.3" />
      <path d="M21 3v6h-6" />
    </>
  ),
  security: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  'ai-agent': (
    <>
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <circle cx="9.5" cy="13.5" r="1.3" />
      <circle cx="14.5" cy="13.5" r="1.3" />
      <path d="M9 17c1.8 1 4.2 1 6 0" />
      <path d="M12 2v2M7 3l1.5 2M17 3l-1.5 2" />
    </>
  ),
  ai: (
    <>
      <path d="M12 3a2.5 2.5 0 0 1 2.5 2.5c.8 0 1.4.6 1.5 1.3.9.4 1.4 1.3 1.2 2.2.3.8 0 1.6-.7 2 0 .9-.5 1.6-1.3 1.8 0 1-.8 1.7-1.7 1.7H12c-.9 0-1.7-.7-1.7-1.7 0-.9.7-1.7 1.7-1.7" />
      <path d="M9.5 13c-1 0-1.8-.7-1.8-1.7 0-.8.5-1.4 1.3-1.6-.2-.7.1-1.4.8-1.8" />
      <circle cx="9.5" cy="14.8" r="0.5" />
      <path d="M12 8.5v.01M8 10v.01M16 10v.01" />
    </>
  ),
  vision: (
    <>
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  property: (
    <>
      <path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  alerts: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </>
  ),
  risk: (
    <>
      <path d="M4 4h16v16H4z" rx="2" />
      <path d="M8 8h8M8 12h5M8 16h8" />
    </>
  ),
  governance: (
    <>
      <path d="M3 21h18M4 21l1-9M20 21l-1-9" />
      <path d="M12 3L3 9h18L12 3z" />
      <path d="M12 21v-7" />
    </>
  ),
  infrastructure: (
    <>
      <rect x="3" y="4" width="8" height="5" rx="1.5" />
      <rect x="13" y="4" width="8" height="5" rx="1.5" />
      <rect x="3" y="14" width="8" height="5" rx="1.5" />
      <rect x="13" y="14" width="8" height="5" rx="1.5" />
      <circle cx="9" cy="16.5" r="0.8" />
      <circle cx="19" cy="6.5" r="0.8" />
    </>
  ),
  health: (
    <>
      <path d="M12 20s-7-4.5-7-10a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 21 10c0 5.5-7 10-7 10z" />
      <path d="M7.5 11h3l1.5-3 2 5 1.5-2h1.5" />
    </>
  ),
  inventory: (
    <>
      <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </>
  ),
  farm: (
    <>
      <path d="M12 22v-8" />
      <path d="M12 14c-4 0-6.5-2.5-6.5-6.5 4 0 6.5 2.5 6.5 6.5z" />
      <path d="M12 14c4 0 6.5-2.5 6.5-6.5-4 0-6.5 2.5-6.5 6.5z" />
      <path d="M12 10c-2 0-3.5-1.5-3.5-4 2 0 3.5 1.5 3.5 4z" />
      <path d="M12 10c2 0 3.5-1.5 3.5-4-2 0-3.5 1.5-3.5 4z" />
    </>
  ),
  portfolio: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M3 11h18" />
      <circle cx="6.5" cy="14.5" r="0.8" />
      <circle cx="9.5" cy="14.5" r="0.8" />
      <circle cx="12.5" cy="14.5" r="0.8" />
    </>
  ),
  knowledge: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21V5.5z" />
      <path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20" />
      <path d="M8.5 8h7M8.5 11.5h7" />
    </>
  ),
  healing: (
    <>
      <path d="M12 4.5c-2.5-3-7-2-7 2 0 5 7 9 7 9s7-4 7-9c0-4-4.5-5-7-2z" />
      <path d="M12 15v4M9 21h6" />
    </>
  ),
  lifestyle: (
    <>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  reports: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h5" />
    </>
  ),
  password: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l7-7M15 8l2 2M13 6l2 2" />
    </>
  ),
  system: (
    <>
      <path d="M12 20v-4" />
      <path d="M12 8V4" />
      <path d="M4 12h4" />
      <path d="M16 12h4" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M8.5 8.5L6 6M15.5 15.5L18 18M15.5 8.5L18 6M8.5 15.5L6 18" />
    </>
  ),
  backup: (
    <>
      <path d="M4 7V4h16v3" />
      <path d="M4 7a8 8 0 0 0 16 0" />
      <path d="M12 4v12M12 16l-3-3M12 16l3-3" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4.5-6.2" />
    </>
  ),
  audit: (
    <>
      <path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
      <path d="M14 2v4h4" />
      <path d="M8 11h8M8 15h5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
    </>
  ),

  // ── การกระทำ/สถานะ ──
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </>
  ),
  home: (
    <>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9 21v-6h6v6" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.3" />
      <path d="M21 3v6h-6" />
    </>
  ),
  play: <path d="M7 4l13 8-13 8V4z" />,
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M4 12.5l5 5L20 6.5" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'arrow-left': <path d="M19 12H5M11 18l-6-6 6-6" />,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  'arrow-up-right': <path d="M7 17L17 7M8 7h9v9" />,
  edit: (
    <>
      <path d="M4 20h4L20 8l-4-4L4 16v4z" />
      <path d="M13.5 6.5l4 4" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7c1.3 0 2.5-.3 3.6-.7" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M4 21h16" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V3M7 8l5-5 5 5" />
      <path d="M4 21h16" />
    </>
  ),
  save: (
    <>
      <path d="M5 3h12l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M8 3v5h7V3" />
      <rect x="7" y="12" width="10" height="7" />
    </>
  ),
  folder: (
    <>
      <path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" />
    </>
  ),
  'folder-open': (
    <>
      <path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v2H6l-3 8V6z" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
      <path d="M14 2v6h6" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3M13 15h4" />
    </>
  ),
  note: (
    <>
      <path d="M4 3h16v14l-5 4H4V3z" />
      <path d="M15 21v-4h5" />
      <path d="M8 8h8M8 12h6" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 15l-5-5-9 9" />
    </>
  ),
  send: (
    <>
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" />
      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
    </>
  ),
  battery: (
    <>
      <rect x="2" y="8" width="16" height="8" rx="1.5" />
      <path d="M22 11v2" />
      <rect x="4" y="10.5" width="6" height="3" rx="0.5" />
    </>
  ),
  droplet: <path d="M12 3s6 6.5 6 11a6 6 0 1 1-12 0c0-4.5 6-11 6-11z" />,
  thermometer: (
    <>
      <path d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0z" />
      <path d="M12 9v6" />
    </>
  ),
  wind: (
    <>
      <path d="M3 8h9a3 3 0 1 0-3-3" />
      <path d="M3 12h13a3 3 0 1 1-3 3" />
      <path d="M3 16h5" />
    </>
  ),
  gauge: (
    <>
      <path d="M4 14a8 8 0 1 1 16 0" />
      <path d="M12 14l4-5" />
      <path d="M2 20h20" />
    </>
  ),
  wifi: (
    <>
      <path d="M2 9a15 15 0 0 1 20 0" />
      <path d="M5 13a10 10 0 0 1 14 0" />
      <path d="M8.5 16.5a5 5 0 0 1 7 0" />
      <circle cx="12" cy="20" r="1" />
    </>
  ),
  zap: <path d="M13 2L5 13h6l-1 9 8-11h-6l1-9z" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.5-1.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
    </>
  ),
  'alert-triangle': (
    <>
      <path d="M12 4L22 20H2L12 4z" />
      <path d="M12 10v4M12 17.5v.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5v.01" />
    </>
  ),
  'x-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  filter: (
    <>
      <path d="M3 5h18l-7 8v5l-4 3v-8L3 5z" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  'map-pin': (
    <>
      <path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  cpu: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="10" y="10" width="4" height="4" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </>
  ),
  star: (
    <>
      <path d="M12 3l2.6 5.6 6.1.7-4.6 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.3 9.3l6.1-.7L12 3z" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M15 9.5c-.6-.8-1.7-1.2-3-1.2-1.7 0-3 .8-3 2s1.1 1.9 3 2.3c1.9.4 3 1.1 3 2.3s-1.3 2-3 2c-1.3 0-2.4-.4-3-1.2" />
    </>
  ),
  'trending-up': (
    <>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </>
  ),
  'trending-down': (
    <>
      <path d="M3 7l6 6 4-4 8 8" />
      <path d="M15 17h6v-6" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 12l9 5 9-5" />
      <path d="M3 16l9 5 9-5" />
    </>
  ),
  code: (
    <>
      <path d="M8 6l-6 6 6 6M16 6l6 6-6 6" />
    </>
  ),
  package: (
    <>
      <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
      <path d="M12 13l-4.5-2.5M16.5 10.5L12 13" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </>
  ),
  logout: (
    <>
      <path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 12h11M17 8l4 4-4 4" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M16 7l2 2M13 10l2 2" />
    </>
  ),
  drag: (
    <>
      <circle cx="9" cy="6" r="1" />
      <circle cx="15" cy="6" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="9" cy="18" r="1" />
      <circle cx="15" cy="18" r="1" />
    </>
  ),
  crown: (
    <>
      <path d="M3 7l4 4 5-6 5 6 4-4v11H3V7z" />
      <path d="M3 18h18" />
    </>
  ),
  'graduation-cap': (
    <>
      <path d="M22 10L12 5 2 10l10 5 10-5z" />
      <path d="M6 12.5V16c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-3.5" />
      <path d="M22 10v6" />
    </>
  ),
  'heart-pulse': (
    <>
      <path d="M12 20s-7-4.5-7-10a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 21 10c0 5.5-7 10-7 10z" />
      <path d="M3.5 12h3l1.5-2.5L11 15l2-4 1.5 1H20" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21V5.5z" />
      <path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20" />
    </>
  ),
  scroll: (
    <>
      <path d="M6 2h12v14a2 2 0 0 1-2 2H7a3 3 0 0 1-3-3V5a3 3 0 0 1 2-2.8V2z" />
      <path d="M6 18v2a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-6" />
      <path d="M9 7h6M9 11h6" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5.5" rx="8" ry="2.5" />
      <path d="M4 5.5v13c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-13" />
      <path d="M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5" />
    </>
  ),
  recycle: (
    <>
      <path d="M7 19l-2-2 2-2M17 5l2 2-2 2M17 19l2-2-2-2M7 5l-2 2 2 2" />
      <path d="M7 8h5l-1-2 4 4-4 4 1-2H7M17 16h-5l1 2-4-4 4-4-1 2h5" />
    </>
  ),
  flower: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5a4.5 4.5 0 0 1 2.6 3.8A4.5 4.5 0 0 1 12 10.5a4.5 4.5 0 0 1-2.6-4.2A4.5 4.5 0 0 1 12 2.5zM12 13.5a4.5 4.5 0 0 1 2.6 4.2A4.5 4.5 0 0 1 12 21.5a4.5 4.5 0 0 1-2.6-4.2A4.5 4.5 0 0 1 12 13.5zM2.5 12a4.5 4.5 0 0 1 3.8-2.6A4.5 4.5 0 0 1 10.5 12a4.5 4.5 0 0 1-4.2 2.6A4.5 4.5 0 0 1 2.5 12zM13.5 12a4.5 4.5 0 0 1 4.2-2.6A4.5 4.5 0 0 1 21.5 12a4.5 4.5 0 0 1-3.8 2.6A4.5 4.5 0 0 1 13.5 12z" />
    </>
  ),
};

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 16,
  className = '',
  strokeWidth = 1.8,
  style,
}: {
  name: string;
  size?: number;
  className?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name] ?? <circle cx="12" cy="12" r="9" />}
    </svg>
  );
}

export default Icon;