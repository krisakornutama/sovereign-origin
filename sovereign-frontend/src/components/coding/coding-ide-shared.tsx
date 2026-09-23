"use client";
// coding-ide-shared.tsx — ค่าคงที่ + CodeView ของ CodingIde (แยกจาก CodingIde.tsx — phase 4 ลดหนี้ไฟล์ยักษ์)

export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export const EFFORT_LEVELS = [
  { key: '', label: 'อัตโนมัติ' },
  { key: 'low', label: 'น้อย' },
  { key: 'medium', label: 'ปานกลาง' },
  { key: 'high', label: 'มาก' },
  { key: 'full', label: 'เต็ม' },
];
export const AUTONOMY_LEVELS = [
  { key: '', label: 'ตามค่าเริ่มต้น' },
  { key: 'manual', label: 'ทำตามสั่ง' },
  { key: 'semi', label: 'กึ่งอัตโนมัติ' },
  { key: 'auto', label: 'คิดเอง/ทำเอง' },
];

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  mtime: string;
}

// มุมมองโค้ดแบบมีเลขบรรทัด
export function CodeView({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <div className="flex font-mono text-[11px] leading-relaxed overflow-x-auto bg-gray-950/60 border border-gray-800 rounded-lg">
      <div className="text-right select-none text-gray-600 border-r border-gray-800 py-2 shrink-0 bg-gray-950/60">
        {lines.map((_, i) => (
          <div key={i} className="px-2 leading-relaxed">{i + 1}</div>
        ))}
      </div>
      <pre className="flex-1 px-3 py-2 text-gray-300 whitespace-pre min-w-0 leading-relaxed">{content}</pre>
    </div>
  );
}
