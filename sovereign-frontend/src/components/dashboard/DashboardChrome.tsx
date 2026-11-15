// components/dashboard/DashboardChrome.tsx — โครง shell ของ widget บนหน้า Dashboard (ย้ายจาก pages/dashboard.tsx)
// (IDEA-011: ย้ายเพื่อลดขนาดหน้า — พฤติกรรมเหมือนเดิมทุกอย่าง)
import { useLanguageStore } from '../../stores/useLanguageStore';
import Icon from '../ui/Icon';

export function WidgetShell({
  title,
  editMode,
  hidden,
  onHide,
  dragHandle,
  onDragStart,
  onDragOver,
  onDrop,
  children,
  className = '',
}: {
  title: string;
  editMode: boolean;
  hidden?: boolean;
  onHide?: () => void;
  dragHandle?: boolean;
  onDragStart?: () => void;
  onDragOver?: () => void;
  onDrop?: () => void;
  children: any;
  className?: string;
}) {
  const t = useLanguageStore((s) => s.t);
  return (
    <div
      className={`${className} ${dragHandle ? 'cursor-grab active:cursor-grabbing' : ''} ${editMode ? 'ring-1 ring-emerald-500/20 rounded-2xl' : ''}`}
      draggable={dragHandle}
      onDragStart={onDragStart}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver?.();
      }}
      onDrop={onDrop}
    >
      {editMode && (
        <div className="flex items-center justify-between mb-1.5 px-1">
          <span className="text-[10px] tracking-widest text-emerald-300/60 font-mono flex items-center gap-1.5"><Icon name="drag" size={10} /> {title}</span>
          <button onClick={onHide} className="flex items-center gap-1 px-2 py-0.5 rounded bg-gray-800 border border-gray-700 hover:bg-gray-700 text-gray-300 text-[10px]">
            <Icon name={hidden ? 'eye' : 'eye-off'} size={10} />
            {hidden ? t('common.show', 'แสดง') : t('common.hide', 'ซ่อน')}
          </button>
        </div>
      )}
      <div className={hidden ? 'opacity-30 pointer-events-none select-none' : undefined}>{children}</div>
    </div>
  );
}
