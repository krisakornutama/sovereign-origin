"use client";
// components/ecosystem/studio/PostHistory.tsx
// ────────────────────────────────────────────────────────────────────────────
// ประวัติการโพสต์ของ Social Studio — "งานที่ทำแล้ว" ไม่ใช่ร่าง
//
// ทำไมต้องมี:
//   เจ้าของโพสต์หลายแพลตฟอร์ม แล้วจำไม่ได้ว่าแพลตฟอร์มไหนทำแล้ว/ยังไม่ได้ทำ
//   ⇒ กดโพสต์ซ้ำ (YouTube กินโควตาฟรี ~6 คลิป/วัน) หรือลืมปลายทางไปเลย
//
// เก็บใน DB (ไม่ใช่ localStorage) เพื่อให้ข้ามเครื่องได้และไม่หายเมื่อล้างเบราว์เซอร์
// ⚠ ที่นี่ไม่แสดง/ไม่เก็บรหัสผ่านของบัญชีใด ๆ
// ────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react';

import { openExternal } from '../../../lib/openExternal';
import {
  deleteSocialPost,
  listSocialPosts,
  updateSocialPostTarget,
} from './social-history-client';
import type {
  SocialPlatformKey,
  SocialPost,
  SocialTargetStatus,
} from './social-history-client';
import { Alert, BTN_GHOST, BTN_GOOD, Card, Hint, INPUT_CLS } from './ui';

const PLATFORM_META: Record<SocialPlatformKey, { label: string; emoji: string }> = {
  youtube: { label: 'YouTube', emoji: '▶️' },
  facebook: { label: 'Facebook', emoji: '📘' },
  instagram: { label: 'Instagram', emoji: '📸' },
  tiktok: { label: 'TikTok', emoji: '🎵' },
};

const STATUS_META: Record<SocialTargetStatus, { label: string; cls: string }> = {
  pending: { label: 'รอโพสต์', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-200' },
  posted: { label: 'โพสต์แล้ว', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' },
  skipped: { label: 'ข้าม', cls: 'border-slate-500/40 bg-slate-500/10 text-gray-300' },
};

function platformMeta(platform: string) {
  return PLATFORM_META[platform as SocialPlatformKey] ?? { label: platform, emoji: '🌐' };
}

function dateLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
}

export default function PostHistory() {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  // ลิงก์ที่พิมพ์ค้างไว้ต่อ target — key = postId:platform (ไม่ถูกส่งจนกด "โพสต์แล้ว")
  const [links, setLinks] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      setPosts(await listSocialPosts(20));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'โหลดประวัติไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const targetKey = (postId: string, platform: string) => `${postId}:${platform}`;

  const setTarget = useCallback(
    async (post: SocialPost, platform: SocialPlatformKey, status: SocialTargetStatus) => {
      const key = targetKey(post.id, platform);
      const rawLink = String(links[key] || '').trim();
      if (status === 'posted' && rawLink && !/^https?:\/\//i.test(rawLink)) {
        setErr('ลิงก์โพสต์ต้องขึ้นต้นด้วย http:// หรือ https://');
        return;
      }
      setBusy(key);
      setErr('');
      setMsg('');
      try {
        const updated = await updateSocialPostTarget(post.id, platform, {
          status,
          ...(rawLink ? { externalUrl: rawLink } : {}),
        });
        setPosts((list) => list.map((p) => (p.id === updated.id ? updated : p)));
        setMsg(
          status === 'posted'
            ? `บันทึกว่าโพสต์ ${platformMeta(platform).label} แล้ว`
            : status === 'skipped'
              ? `ทำเครื่องหมายข้าม ${platformMeta(platform).label} แล้ว`
              : `ตั้ง ${platformMeta(platform).label} กลับเป็นรอโพสต์`,
        );
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'อัปเดตสถานะไม่สำเร็จ');
      } finally {
        setBusy('');
      }
    },
    [links],
  );

  const remove = useCallback(async (post: SocialPost) => {
    if (!window.confirm('ลบประวัตินี้ permanently? การลบไม่กระทบโพสต์จริงบนแพลตฟอร์ม')) return;
    setBusy(`delete:${post.id}`);
    setErr('');
    setMsg('');
    try {
      await deleteSocialPost(post.id);
      setPosts((list) => list.filter((p) => p.id !== post.id));
      setMsg('ลบประวัตินี้แล้ว');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'ลบประวัติไม่สำเร็จ');
    } finally {
      setBusy('');
    }
  }, []);

  const total = useMemo(() => posts.length, [posts]);

  return (
    <Card
      title="ประวัติการโพสต์"
      sub="บันทึกไว้ในฐานข้อมูล — ข้ามเครื่องได้ ไม่หายเมื่อล้างเบราว์เซอร์"
      right={
        <button type="button" className={BTN_GHOST} onClick={() => void load()} disabled={loading}>
          {loading ? 'กำลังโหลด…' : 'รีเฟรช'}
        </button>
      }
    >
      {err && <Alert kind="error">{err}</Alert>}
      {msg && <Alert kind="ok">{msg}</Alert>}

      {loading && posts.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">กำลังโหลดประวัติ…</p>
      ) : total === 0 ? (
        <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-6 text-center">
          <p className="text-sm text-gray-300">ยังไม่มีประวัติการโพสต์</p>
          <p className="mt-1 text-xs text-gray-500">
            ไปที่แท็บ “โพสต์ข้อความ” หรือ “ลงคลิปวิดีโอ” แล้วกด “บันทึกงานนี้ลงประวัติ”
            เพื่อเก็บไว้ติดตามว่าทำแพลตฟอร์มไหนแล้ว
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <article key={post.id} className="rounded-xl border border-slate-700 bg-slate-800/40 p-3">
              <header className="flex flex-wrap items-start gap-2">
                <span className="text-lg" aria-hidden>
                  {post.kind === 'clip' ? '🎬' : '📝'}
                </span>
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-semibold text-gray-100">
                    {post.title || (post.kind === 'clip' ? 'งานลงคลิป' : 'โพสต์ข้อความ')}
                  </h4>
                  <p className="text-[11px] text-gray-500">
                    {dateLabel(post.createdAt)}
                    {post.videoName ? ` · ${post.videoName}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-rose-500/40 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
                  onClick={() => void remove(post)}
                  disabled={busy === `delete:${post.id}`}
                >
                  ลบ
                </button>
              </header>

              {post.body && (
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-300">
                  {post.body}
                </p>
              )}
              {post.link && (
                <button
                  type="button"
                  className="mt-1 break-all text-left text-[11px] text-cyan-300 hover:underline"
                  onClick={() => void openExternal(post.link as string)}
                >
                  {post.link}
                </button>
              )}

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {post.targets.map((target) => {
                  const meta = platformMeta(target.platform);
                  const status = STATUS_META[target.status] ?? STATUS_META.pending;
                  const key = targetKey(post.id, target.platform);
                  const working = busy === key;
                  return (
                    <div key={target.platform} className="rounded-lg border border-slate-700 bg-slate-900/50 p-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm">{meta.emoji}</span>
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-200">
                          {meta.label}
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] ${status.cls}`}>
                          {status.label}
                        </span>
                      </div>

                      {target.postedAt && (
                        <p className="mt-1 text-[10px] text-gray-500">เมื่อ {dateLabel(target.postedAt)}</p>
                      )}
                      {target.externalUrl && (
                        <button
                          type="button"
                          className="mt-1 block break-all text-left text-[10px] text-cyan-300 hover:underline"
                          onClick={() => void openExternal(target.externalUrl as string)}
                        >
                          เปิดลิงก์โพสต์
                        </button>
                      )}

                      {target.status !== 'posted' && (
                        <div className="mt-2 space-y-1.5">
                          <input
                            className={`${INPUT_CLS} !py-1 !text-[11px]`}
                            value={links[key] || ''}
                            onChange={(e) => setLinks((m) => ({ ...m, [key]: e.target.value }))}
                            placeholder="ลิงก์โพสต์ (ไม่บังคับ)"
                            inputMode="url"
                          />
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              className={`${BTN_GOOD} !px-2 !py-1 !text-[11px]`}
                              onClick={() => void setTarget(post, target.platform, 'posted')}
                              disabled={working}
                            >
                              {working ? 'กำลังบันทึก…' : 'โพสต์แล้ว'}
                            </button>
                            <button
                              type="button"
                              className={`${BTN_GHOST} !px-2 !py-1 !text-[11px]`}
                              onClick={() => void setTarget(post, target.platform, 'skipped')}
                              disabled={working}
                            >
                              ข้าม
                            </button>
                          </div>
                        </div>
                      )}

                      {target.status === 'posted' && (
                        <button
                          type="button"
                          className={`${BTN_GHOST} mt-2 !px-2 !py-1 !text-[10px]`}
                          onClick={() => void setTarget(post, target.platform, 'pending')}
                          disabled={working}
                        >
                          ตั้งกลับเป็นรอโพสต์
                        </button>
                      )}
                      {target.status === 'skipped' && (
                        <button
                          type="button"
                          className={`${BTN_GHOST} mt-2 !px-2 !py-1 !text-[10px]`}
                          onClick={() => void setTarget(post, target.platform, 'pending')}
                          disabled={working}
                        >
                          ตั้งกลับเป็นรอโพสต์
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      )}

      <Hint>
        “โพสต์แล้ว” ในที่นี้คือบันทึกของแอป ไม่ได้ยืนยันแทนแพลตฟอร์ม — กดเมื่อคุณโพสต์จริงแล้วเท่านั้น
        ถ้าลบประวัตินี้ โพสต์บนแพลตฟอร์มยังอยู่ครบ
      </Hint>
    </Card>
  );
}
