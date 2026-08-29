"use client";
import { ReactNode } from 'react';
import Sidebar from './Sidebar';
import PageHeader from '../ui/PageHeader';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLanguageStore } from '../../stores/useLanguageStore';

export default function AuthenticatedPageLayout({ title, eyebrow, subtitle, icon, actions, children }: { title: string; eyebrow?: string; subtitle?: string; icon?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const { isHydrated, isAuthenticated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  if (!isHydrated) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">{t('common.loading', 'กำลังโหลด...')}</div>;
  if (!isAuthenticated) return <div className="text-white p-8">{t('common.unauthorized', 'Unauthorized')}</div>;
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} icon={icon} actions={actions} />
        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-7xl mx-auto w-full">{children}</main>
      </div>
    </div>
  );
}
