"use client";
import { useState, useEffect } from 'react';
import Head from 'next/head';
import { fetchJsonObject } from '../lib/fetchJson';
import { getApiUrl } from '../lib/config';
import { FeedbackButton } from '../components/public/FeedbackButton';
import { trackPageView } from '../lib/visitorTrack';
import { useLanguageStore } from '../stores/useLanguageStore';

// ────────────────────────────────────────────────────────────────────────────
// /community — เฟส 4: catalog กลางชุมชน (ไม่ต้อง login)
//  รวมสินค้าจากทุกร้านที่ "เข้าร่วมเอง" (opt-in ผ่านหน้าตั้งค่าร้าน) — ผู้ซื้อเห็นรวมกัน
//  โชว์เฉพาะข้อมูลที่ร้านเปิดเผยแล้ว: ชื่อร้าน/ชื่อสินค้า/หมวด/สเปค/ราคาขาย/รับประกัน/สต็อกพอ-ไม่พอ
//  ต้นทุน ราคาทุน จำนวนสต็อกจริง ออเดอร์ส่วนตัว ไม่มีทางโผล่ (server ตัดทิ้งตั้งแต่ต้น)
//  กดสินค้า → ไปหน้าร้านต้นทาง /shop?id=<businessId> เพื่อสั่งซื้อ
// ────────────────────────────────────────────────────────────────────────────

interface CommunityProduct { id: string; name: string; category?: string | null; specs?: string | null; salePrice: number; warrantyMonths: number; inStock: boolean; }
interface CommunityShop { id: string; name: string; productCount: number; products: CommunityProduct[]; }
interface Catalog { shops: CommunityShop[]; generatedAt: string; }

const API = `${getApiUrl()}/api/shop/community`;
const baht = (n: number) => `${Number(n ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })} ฿`;

export default function CommunityPage() {
  const t = useLanguageStore((s) => s.t);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState(''); // อ่าน q หลัง mount กัน hydration mismatch

  useEffect(() => {
    trackPageView('/community'); // P10: สถิติการเยือน (cookieless)
    fetchJsonObject<Catalog>(API)
      .then((d) => setCatalog(d))
      .catch((e) => setErr(e.message || t('community.loadFailed', 'โหลดไม่สำเร็จ')));
    const p = new URLSearchParams(window.location.search).get('q');
    if (p) { setQuery(p); setQ(p); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const needle = query.trim().toLowerCase();
  const shops = (catalog?.shops ?? [])
    .map((s) => ({
      ...s,
      products: needle
        ? s.products.filter((p) => `${p.name} ${p.category ?? ''} ${p.specs ?? ''}`.toLowerCase().includes(needle))
        : s.products,
    }))
    .filter((s) => s.products.length > 0);

  const totalProducts = shops.reduce((sum, s) => sum + s.products.length, 0);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Head><title>{t('community.title', '🏪 Catalog กลางชุมชน')} — Sovereign OS</title><meta name="robots" content="noindex" /></Head>
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <header className="space-y-1">
          <h1 className="font-ledger text-2xl">{t('community.title', '🏪 Catalog กลางชุมชน')}</h1>
          <p className="text-sm text-slate-400">{t('community.subtitle', 'สินค้าจากร้านชุมชนที่เข้าร่วมเอง — กดสินค้าเพื่อไปสั่งซื้อที่หน้าร้านต้นทาง')}</p>
        </header>

        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('community.searchPlaceholder', 'ค้นหาสินค้า/หมวด…')}
            className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm" aria-label={t('community.search', 'ค้นหา')} />
          <button onClick={() => setQuery(q)} className="px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-sm font-medium">{t('community.search', 'ค้นหา')}</button>
        </div>

        {err && <div className="text-sm text-rose-400">{err}</div>}
        {!catalog && !err && <div className="text-sm text-slate-500">{t('community.loading', 'กำลังโหลด…')}</div>}
        {catalog && shops.length === 0 && (
          <div className="text-sm text-slate-500 border border-slate-800 rounded-lg p-6 text-center">
            {needle ? t('community.emptySearch', 'ไม่พบสินค้าที่ตรงกับ "{q}"').replace('{q}', query) : t('community.empty', 'ยังไม่มีร้านเข้าร่วม catalog กลาง — ร้านเปิดเองได้จากหน้าตั้งค่าร้าน')}
          </div>
        )}

        {catalog && shops.length > 0 && (
          <div className="text-xs text-slate-500">
            {t('community.summary', '{shops} ร้าน · {products} รายการ').replace('{shops}', String(shops.length)).replace('{products}', String(totalProducts))}
          </div>
        )}

        {shops.map((shop) => (
          <section key={shop.id} className="border border-slate-800 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-slate-900/60">
              <h2 className="font-semibold text-cyan-300">{shop.name}</h2>
              <a href={`/shop?id=${shop.id}`} className="text-xs text-cyan-400 hover:underline">{t('community.visitShop', 'เข้าร้านนี้ →')}</a>
            </div>
            <ul className="divide-y divide-slate-800/60">
              {shop.products.map((p) => (
                <li key={p.id}>
                  <a href={`/shop?id=${shop.id}`} className="flex flex-wrap items-center gap-2 px-4 py-2.5 hover:bg-slate-900/60 text-sm">
                    <span className="font-medium">{p.name}</span>
                    {p.category && <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">{p.category}</span>}
                    {p.specs && <span className="text-[11px] text-slate-500">{p.specs}</span>}
                    <span className="ml-auto font-mono">{baht(p.salePrice)}</span>
                    <span className={`text-[11px] ${p.inStock ? 'text-emerald-400' : 'text-slate-500'}`}>{p.inStock ? t('community.inStock', 'มีสินค้า') : t('community.outOfStock', 'สินค้าหมด')}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <footer className="text-[11px] text-slate-600 pt-4 border-t border-slate-900 space-y-1">
          <div>{t('community.footer', 'ร้านเข้าร่วม/ถอนตัวเองได้จากหน้าตั้งค่าร้าน — ระบบโชว์เฉพาะข้อมูลที่ร้านเปิดเผยเท่านั้น')}</div>
          <div>Powered by Sovereign OS · <a href="/demo" className="hover:text-slate-400 underline underline-offset-2">ลองเล่นเดโม่</a></div>
        </footer>
      </main>
      <FeedbackButton page="/community" />
    </div>
  );
}
