"use client";

import { useMemo, useState } from 'react';
import SkeletonCard from './SkeletonCard';
import EmptyState from './EmptyState';

/**
 * DataTable — ตารางเบา ๆ ที่ไม่ต้องเพิ่ม dependency
 *
 * ทำไมต้องมี: หน้า audit / users / settings เขียนตารางเองคนละแบบ (หัวตาราง,
 * การเรียง, สถานะว่าง ไม่เหมือนกัน) ตัวนี้รวมเป็นแบบเดียว + a11y ครบ
 *   - หัวตารางที่เรียงได้เป็น <button> จริง (กดด้วยคีย์บอร์ดได้) + aria-sort
 *   - loading → skeleton, ว่าง → EmptyState (ไม่ปล่อยจอโล่ง)
 *
 * ใช้:
 *   <DataTable
 *     rows={rows}
 *     getRowKey={(r) => r.id}
 *     loading={loading}
 *     emptyTitle={t('x.none', 'ยังไม่มีรายการ')}
 *     columns={[
 *       { key: 'name', header: 'ชื่อ', sortValue: (r) => r.name, render: (r) => r.name },
 *       { key: 'state', header: 'สถานะ', render: (r) => <StatusDot variant="ok" label={r.state} /> },
 *     ]}
 *   />
 */
export type Column<T> = {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  /** ค่าที่ใช้เรียง — ไม่ส่ง = คอลัมน์นี้เรียงไม่ได้ */
  sortValue?: (row: T) => string | number;
  align?: 'left' | 'right' | 'center';
  className?: string;
  headerClassName?: string;
};

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export default function DataTable<T>({
  columns,
  rows,
  getRowKey,
  loading = false,
  emptyTitle = '—',
  emptyDescription,
  emptyAction,
  initialSortKey,
  initialSortDir = 'asc',
  caption,
  maxHeightClass = 'max-h-[28rem]',
  className = '',
}: {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T, index: number) => string | number;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  initialSortKey?: string;
  initialSortDir?: 'asc' | 'desc';
  /** คำอธิบายตารางสำหรับ screen reader */
  caption?: string;
  maxHeightClass?: string;
  className?: string;
}) {
  const [sortKey, setSortKey] = useState<string | undefined>(initialSortKey);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialSortDir);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av === bv) return 0;
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'th');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, columns, sortKey, sortDir]);

  if (loading) return <SkeletonCard lines={4} className={className} />;
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  }

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir('asc');
  };

  return (
    <div className={`overflow-auto rounded-lg border border-gray-800/70 ${maxHeightClass} ${className}`}>
      <table className="w-full border-collapse text-xs">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur">
          <tr>
            {columns.map((c) => {
              const isSorted = sortKey === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={`px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-gray-400 border-b border-gray-800 ${ALIGN[c.align ?? 'left']} ${c.headerClassName ?? ''}`}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className="inline-flex items-center gap-1 hover:text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 rounded"
                    >
                      {c.header}
                      <span aria-hidden="true" className={isSorted ? 'text-emerald-400' : 'text-gray-600'}>
                        {isSorted ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={getRowKey(row, i)} className="border-b border-gray-800/50 last:border-0 hover:bg-gray-800/30">
              {columns.map((c) => (
                <td key={c.key} className={`px-3 py-2 align-top text-gray-300 ${ALIGN[c.align ?? 'left']} ${c.className ?? ''}`}>
                  {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
