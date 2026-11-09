"use client";

// ─────────────────────────────────────────────────────────────
//  /changelog — ประวัติการพัฒนา (เห็นได้ในแอป ไม่ต้องเปิด markdown)
//
//  ข้อมูลมาจาก sovereign-frontend/src/data/changelog.json ซึ่ง generate
//  จาก CHANGELOG.md ที่ root ด้วย tools/gen-changelog-data.mjs
//  (Docker build context ของ frontend คือ sovereign-frontend เท่านั้น
//   จึงต้องมี JSON อยู่ในโฟลเดอร์นี้ — เทสต์ --check กันข้อมูลค้างเก่า)
// ─────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import { useLanguageStore } from '../stores/useLanguageStore';
import changelogData from '../data/changelog.json';

type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'note'; text: string }
  | { type: 'subheading'; text: string };

type Section = { title: string; blocks: Block[] };

type Version = {
  version: string;
  dateISO: string;
  dateLabel: string;
  released: boolean;
  ref: string;
  summary: Block[];
  sections: Section[];
};

type ChangelogData = {
  generatedFrom: string;
  generatedBy: string;
  currentVersion: string;
  versions: Version[];
  notes: Block[];
};

const data = changelogData as unknown as ChangelogData;

/** '1.2.0' (package.json) เทียบกับ tag 'v1.2.0' ใน CHANGELOG */
function isCurrentVersion(version: string) {
  return version.replace(/^v/, '') === data.currentVersion;
}

function BlockView({ block }: { block: Block }) {
  if (block.type === 'subheading') {
    return <h4 className="pt-1 text-xs font-semibold tracking-wide text-gray-200">{block.text}</h4>;
  }

  if (block.type === 'note') {
    return (
      <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
        {block.text}
      </div>
    );
  }

  if (block.type === 'paragraph') {
    return <p className="text-sm leading-relaxed text-gray-300">{block.text}</p>;
  }

  if (block.type === 'table') {
    return (
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-gray-900/60">
              {block.headers.map((h, i) => (
                <th key={i} className="border-b border-gray-800 px-3 py-2 text-left font-medium text-gray-400">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r} className="align-top">
                {row.map((cell, c) => (
                  <td key={c} className="border-b border-gray-800/60 px-3 py-2 leading-relaxed text-gray-300">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <ul className="space-y-1.5 text-sm leading-relaxed text-gray-300">
      {block.items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden="true" className="mt-[3px] text-emerald-400">
            •
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function BlockList({ blocks }: { blocks: Block[] }) {
  if (!blocks.length) return null;
  return (
    <div className="space-y-2.5">
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </div>
  );
}

function StatusBadge({ released, current, releasedLabel, unreleasedLabel, currentLabel }: {
  released: boolean;
  current: boolean;
  releasedLabel: string;
  unreleasedLabel: string;
  currentLabel: string;
}) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {current && (
        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
          {currentLabel}
        </span>
      )}
      <span
        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
          released
            ? 'border-gray-600/60 bg-gray-800/60 text-gray-300'
            : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
        }`}
      >
        {released ? releasedLabel : unreleasedLabel}
      </span>
    </span>
  );
}

export default function ChangelogPage() {
  const t = useLanguageStore((s) => s.t);
  const [filter, setFilter] = useState('all');

  const versions = useMemo(
    () => (filter === 'all' ? data.versions : data.versions.filter((v) => v.version === filter)),
    [filter],
  );

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-4xl mx-auto w-full">
          <PageHeader
            eyebrow={t('changelog.eyebrow', 'ระบบ')}
            title={t('changelog.title', 'ประวัติการพัฒนา')}
            subtitle={t('changelog.subtitle', 'ทุกเวอร์ชันที่ปล่อยแล้ว พร้อมสิ่งที่เพิ่ม แก้ และปรับในแต่ละรุ่น')}
            icon={<Icon name="book" size={18} />}
            theme="system"
            actions={
              <span className="rounded-full border border-gray-700 bg-gray-900/60 px-3 py-1 text-xs text-gray-400">
                {data.versions.length} {t('changelog.versionLabel', 'เวอร์ชัน')}
              </span>
            }
          />

          {/* ตัวกรองเวอร์ชัน */}
          <div className="flex flex-wrap gap-2 text-sm">
            <button
              type="button"
              aria-pressed={filter === 'all'}
              onClick={() => setFilter('all')}
              className={`rounded-lg border px-3 py-1.5 transition-colors ${
                filter === 'all'
                  ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200'
                  : 'border-gray-700 text-gray-400 hover:bg-gray-800/40'
              }`}
            >
              {t('changelog.allVersions', 'ทุกเวอร์ชัน')}
            </button>
            {data.versions.map((v) => (
              <button
                key={v.version}
                type="button"
                aria-pressed={filter === v.version}
                onClick={() => setFilter(v.version)}
                className={`rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors ${
                  filter === v.version
                    ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200'
                    : 'border-gray-700 text-gray-400 hover:bg-gray-800/40'
                }`}
              >
                {v.version}
              </button>
            ))}
          </div>

          {versions.length === 0 && (
            <div className="card p-6 text-center text-sm text-gray-400">
              {t('changelog.emptyFilter', 'ไม่พบเวอร์ชันที่เลือก')}
            </div>
          )}

          {versions.map((v) => (
            <section key={v.version} className="card space-y-4 p-4">
              <header className="flex flex-wrap items-center gap-2 border-b border-gray-800 pb-3">
                <h2 className="text-lg font-semibold text-gray-50">{v.version}</h2>
                {v.dateLabel && <span className="text-xs text-gray-400">{v.dateLabel}</span>}
                <StatusBadge
                  released={v.released}
                  current={isCurrentVersion(v.version)}
                  releasedLabel={t('changelog.released', 'ปล่อยแล้ว')}
                  unreleasedLabel={t('changelog.unreleased', 'กำลังพัฒนา')}
                  currentLabel={t('changelog.current', 'เวอร์ชันปัจจุบัน')}
                />
                {v.ref && (
                  <span className="ml-auto rounded bg-gray-900 px-2 py-0.5 font-mono text-[10px] text-gray-500">
                    {v.ref}
                  </span>
                )}
              </header>

              <BlockList blocks={v.summary} />

              {v.sections.map((section, i) => (
                <section key={i} className="space-y-2">
                  <h3 className="text-sm font-semibold text-emerald-300">{section.title}</h3>
                  <BlockList blocks={section.blocks} />
                </section>
              ))}
            </section>
          ))}

          {data.notes.length > 0 && (
            <section className="card space-y-3 p-4">
              <h2 className="text-sm font-semibold text-gray-200 glow-text">
                {t('changelog.notesTitle', 'หมายเหตุ')}
              </h2>
              <BlockList blocks={data.notes} />
            </section>
          )}

          <p className="pb-2 text-[11px] leading-relaxed text-gray-500">
            {t('changelog.generatedBy', 'ข้อมูลนี้สร้างจาก')} <code>{data.generatedFrom}</code> ·{' '}
            <code>{data.generatedBy}</code>
          </p>
        </main>
      </div>
    </div>
  );
}
