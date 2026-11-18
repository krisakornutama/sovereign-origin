"use client";

import SkeletonCard from './SkeletonCard';
import EmptyState from './EmptyState';
import ErrorNotice from './ErrorNotice';

/**
 * PageState — สถานะของส่วนหนึ่งของหน้า ในตัวเดียว: loading / empty / error / ready
 *
 * ทำไมต้องมี: เดิมแต่ละหน้าเลือกเองว่าจะโชว์อะไรตอนโหลด/ว่าง/พัง ทำให้บางหน้า
 * เงียบสนิท (ผู้ใช้คิดว่าแอปตาย) หรือโชว์ error ดิบที่ไม่บอกทางแก้
 *
 * กติกา 4 หน้าตาที่ต้องมีเสมอ: loading → empty → error → data
 * ใช้:
 *   <PageState mode={loading ? 'loading' : error ? 'error' : rows.length ? 'ready' : 'empty'}
 *              error={error} onRetry={load} emptyTitle={t('...')}>
 *     ...เนื้อหาจริง...
 *   </PageState>
 */
export type PageStateMode = 'loading' | 'empty' | 'error' | 'ready';

export default function PageState({
  mode,
  error,
  onRetry,
  loadingLines = 3,
  emptyTitle = '—',
  emptyDescription,
  emptyAction,
  emptyIcon,
  className = '',
  children,
}: {
  mode: PageStateMode;
  /** อะไรก็ได้ที่จับได้จาก fetch/try-catch (ส่งต่อให้ ErrorNotice) */
  error?: unknown;
  onRetry?: () => void;
  loadingLines?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  emptyIcon?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  if (mode === 'loading') {
    return (
      <div className={className}>
        <SkeletonCard lines={loadingLines} />
      </div>
    );
  }

  if (mode === 'error') {
    return <ErrorNotice error={error ?? new Error('unknown')} onRetry={onRetry} className={className} />;
  }

  if (mode === 'empty') {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  return <>{children}</>;
}
