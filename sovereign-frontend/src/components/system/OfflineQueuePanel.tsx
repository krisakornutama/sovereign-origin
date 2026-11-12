"use client";
// ─────────────────────────────────────────────────────────────
//  OfflineQueuePanel — ส่วน "คิว Offline" ของหน้า settings
//
//  แยกออกมาเพราะ settings.tsx ติดเพดาน 800 บรรทัดของ frontend-gate
//  ตรรกะเหมือนเดิมทุกอย่าง: แสดงเฉพาะคิวของ session ปัจจุบัน, sync ทีละ
//  รายการ/ทั้งหมด, ลบเฉพาะของตัวเอง — และแสดงผล retention sweep ล่าสุด
// ─────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react';
import { fmtLocale } from '../../lib/formatDate';
import {
  listQueued,
  removeQueued,
  currentQueueUserId,
  flushSelected,
  type QueuedAction,
} from '../../lib/offlineQueue';
import { useOfflineSync } from '../../hooks/useOfflineSync';
import { useLanguageStore } from '../../stores/useLanguageStore';
import Icon from '../ui/Icon';
import QueueRetentionNote from './QueueRetentionNote';

interface Props {
  /** แสดงข้อความสำเร็จที่แบนเนอร์บนสุดของหน้า settings (ไม่ใช่ของ panel เอง) */
  onMessage: (message: string) => void;
  /** แสดง error ที่แบนเนอร์บนสุดของหน้า settings */
  onError: (message: string) => void;
}

export default function OfflineQueuePanel({ onMessage, onError }: Props) {
  const t = useLanguageStore((s) => s.t);
  const { queuedCount, syncNow } = useOfflineSync();
  const [queuedItems, setQueuedItems] = useState<QueuedAction[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [queueBusy, setQueueBusy] = useState(false);

  const reloadQueue = async () => {
    // แสดงเฉพาะของ session ปัจจุบัน — ของคนอื่น/legacy อยู่ใน IDB แต่มองไม่เห็นจากหน้านี้
    const items = await listQueued(currentQueueUserId());
    setQueuedItems(items);
    setSelectedIds((prev) => new Set([...prev].filter((id) => items.some((q) => q.id === id))));
  };

  useEffect(() => {
    reloadQueue();
    // reload ทุกครั้งที่ badge เปลี่ยน (คิวถูกเพิ่ม/ลบจากที่อื่น)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedCount]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => (prev.size === queuedItems.length ? new Set() : new Set(queuedItems.map((q) => q.id!))));
  };

  const syncSelected = async () => {
    if (selectedIds.size === 0) return;
    setQueueBusy(true);
    onError('');
    try {
      const flushed = await flushSelected([...selectedIds]);
      const kept = selectedIds.size - flushed;
      onMessage(kept === 0 ? t('settings.queue.syncAllOk', 'sync สำเร็จทั้งหมด {n} รายการ', { n: flushed }) : t('settings.queue.syncPartial', 'sync สำเร็จ {n} รายการ (เหลือ {kept} ที่ยังไม่ได้)', { n: flushed, kept }));
      await reloadQueue();
    } catch (err) {
      console.error(err);
      onError(t('settings.queue.syncFailed', 'sync ไม่สำเร็จ'));
    } finally {
      setQueueBusy(false);
    }
  };

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(t('settings.queue.deleteConfirm', 'ลบ {n} รายการออกจากคิว? (จะไม่ถูกส่ง)', { n: selectedIds.size }))) return;
    setQueueBusy(true);
    for (const id of selectedIds) await removeQueued(id);
    onMessage(t('settings.queue.deleted', 'ลบ {n} รายการแล้ว', { n: selectedIds.size }));
    await reloadQueue();
    setQueueBusy(false);
  };

  const deleteOne = async (id: number) => {
    await removeQueued(id);
    onMessage(t('settings.queue.deletedOne', 'ลบรายการออกจากคิวแล้ว'));
    await reloadQueue();
  };

  return (
    <section className="panel panel-cyan p-5 space-y-4">
      <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('settings.queue.title', 'คิว Offline ({n})', { n: queuedItems.length })}</h2>
      <p className="text-xs text-gray-500">
        {t('settings.queue.desc', 'action ที่ค้างไว้ตอนออฟไลน์ (POST/PUT/PATCH/DELETE) — จะ sync อัตโนมัติเมื่อกลับ online หรือเลือกจัดการด้านล่าง · รายการที่ถูก server ปฏิเสธถาวร (4xx) จะถูกพักไว้ ไม่ลบ และไม่ถูกส่งซ้ำเอง')}
      </p>
      <QueueRetentionNote />
      {queuedItems.length === 0 ? (
        <div className="text-gray-500 text-sm text-center py-4">{t('settings.queue.empty', 'ไม่มี action ค้าง — คิวว่าง')}</div>
      ) : (
        <>
          <div className="overflow-x-auto border border-cyan-800/50 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-700 bg-gray-800/50">
                  <th className="py-2 px-3 w-8">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === queuedItems.length && queuedItems.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 accent-green-500"
                    />
                  </th>
                  <th className="py-2 pr-3 w-16">Method</th>
                  <th className="py-2 pr-3">URL</th>
                  <th className="py-2 pr-3 w-36">{t('common.time', 'เวลา')}</th>
                  <th className="py-2 pr-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {queuedItems.map((item) => (
                  <tr key={item.id} className="border-b border-gray-800">
                    <td className="py-2 px-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id!)}
                        onChange={() => toggleSelect(item.id!)}
                        className="w-4 h-4 accent-green-500"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          item.method === 'POST'
                            ? 'bg-green-900/50 text-green-300'
                            : item.method === 'PUT'
                              ? 'bg-blue-900/50 text-blue-300'
                              : item.method === 'DELETE'
                                ? 'bg-red-900/50 text-red-300'
                                : 'bg-amber-900/50 text-amber-300'
                        }`}
                      >
                        {item.method}
                      </span>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-gray-300 break-all">
                      {item.url}
                      {item.lastRejection && (
                        <div className="mt-1 text-[11px] text-amber-400 font-sans">
                          {t(
                            'settings.queue.rejected',
                            'ถูกปฏิเสธ ({status}) เมื่อ {when} — จะไม่ส่งซ้ำอัตโนมัติ (เลือกแล้วกด Sync เพื่อลองใหม่ หรือลบถ้าไม่ต้องการแล้ว)',
                            {
                              status: item.lastRejection.status,
                              when: new Date(item.lastRejection.at).toLocaleString(fmtLocale()),
                            }
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs text-gray-500">{new Date(item.queuedAt).toLocaleString(fmtLocale())}</td>
                    <td className="py-2 pr-3">
                      <button
                        onClick={() => deleteOne(item.id!)}
                        title={t('settings.queue.removeTitle', 'ลบออกจากคิว (ไม่ส่ง)')}
                        className="text-xs px-2 py-1 bg-red-900/50 border border-red-700 hover:bg-red-900 rounded"
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3 flex-wrap">
            <button
              onClick={syncSelected}
              disabled={queueBusy || selectedIds.size === 0}
              className="btn-primary"
            >
              {queueBusy ? t('settings.queue.syncing', 'กำลัง sync…') : t('settings.queue.syncSelected', 'Sync ที่เลือก ({n})', { n: selectedIds.size })}
            </button>
            <button
              onClick={deleteSelected}
              disabled={queueBusy || selectedIds.size === 0}
              className="btn-danger"
            >
              <Icon name="trash" size={14} />
              {t('settings.queue.deleteSelected', 'ลบที่เลือก')}
            </button>
            <button
              onClick={async () => {
                setQueueBusy(true);
                const flushed = await syncNow();
                onMessage(t('settings.queue.syncAllDone', 'sync ทั้งหมดสำเร็จ {n} รายการ', { n: flushed }));
                await reloadQueue();
                setQueueBusy(false);
              }}
              disabled={queueBusy || queuedItems.length === 0}
              className="btn-primary"
            >
              <Icon name="zap" size={14} />
              {t('settings.queue.syncAll', 'Sync ทั้งหมด')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
