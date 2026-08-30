"use client";
import Icon from './Icon';
export default function ConfirmDialog({ open, title, children, onConfirm, onCancel }: { open: boolean; title: string; children: React.ReactNode; onConfirm: () => void; onCancel: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 max-w-md w-full space-y-4">
        <h3 className="font-bold flex items-center gap-2"><Icon name="alert-triangle" size={16} className="text-amber-400" />{title}</h3>
        <div className="text-sm text-gray-300">{children}</div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="btn-secondary">ยกเลิก</button>
          <button onClick={onConfirm} className="btn-primary">ยืนยัน</button>
        </div>
      </div>
    </div>
  );
}
