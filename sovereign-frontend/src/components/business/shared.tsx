import { useState } from 'react';
import Icon from '../ui/Icon';

// ── ค่าคงที่ + interfaces + badges ใช้ร่วมของโมดูล business (แยกจาก BusinessWorkspace — phase 3 ลดหนี้ไฟล์ยักษ์) ──

export const POSITION_LABELS: Record<string, string> = {
  OWNER: 'เจ้าของ',
  MANAGER: 'ผู้จัดการ',
  SALES: 'ฝ่ายขาย',
  TECHNICIAN: 'ช่างติดตั้ง',
  STOCK_KEEPER: 'ฝ่ายคลัง',
  ACCOUNTANT: 'ฝ่ายบัญชี',
  VIEWER: 'ผู้ดู',
};

export const POSITION_RANK: Record<string, number> = { OWNER: 0, MANAGER: 1, SALES: 2, TECHNICIAN: 3, STOCK_KEEPER: 3, ACCOUNTANT: 3, VIEWER: 6 };

export type Tab = 'overview' | 'products' | 'customers' | 'orders' | 'installations' | 'finance' | 'tax' | 'agents' | 'team' | 'shop';

export const TABS: Array<{ key: Tab; label: string; minRank: number }> = [
  { key: 'overview', label: 'ภาพรวม', minRank: 6 },
  { key: 'products', label: 'สินค้า', minRank: 6 },
  { key: 'customers', label: 'ลูกค้า', minRank: 6 },
  { key: 'orders', label: 'ออเดอร์', minRank: 6 },
  { key: 'installations', label: 'ติดตั้ง', minRank: 6 },
  { key: 'finance', label: 'การเงิน', minRank: 3 },
  { key: 'tax', label: 'ภาษี', minRank: 3 },
  { key: 'agents', label: 'ผู้ช่วย AI', minRank: 6 },
  { key: 'team', label: 'ทีม', minRank: 6 },
  { key: 'shop', label: 'หน้าร้าน', minRank: 1 },
];

export interface Business {
  id: string;
  name: string;
  bizType: string;
  vatRate: number;
  members: Array<{ id: string; userId: string; position: string; user?: { username: string } }>;
}
export interface Product { id: string; sku: string; name: string; category: string; specs?: string; costPrice: number; salePrice: number; stockQty: number; reorderPoint: number; warrantyMonths: number; isActive: boolean; }
export interface Customer { id: string; name: string; phone?: string; lineId?: string; address?: string; channel: string; }
export interface OrderLine { id: string; productId: string; qty: number; unitPrice: number; unitCost: number; product?: { name: string; sku: string }; }
export interface Order { id: string; orderNo: string; status: string; channel: string; subtotal: number; vat: number; total: number; paidAmount: number; customer?: { name: string } | null; lines: OrderLine[]; createdAt: string; payments?: Array<{ amount: number; method: string; whtAmount: number; paidAt: string; reference?: string | null }>; }
export interface Installation { id: string; title: string; status: string; scheduledAt?: string; note?: string; order?: { orderNo: string } | null; }
export interface LedgerEntry { id: string; type: string; category: string; amount: number; note?: string; createdAt: string; }
export interface Summary { income: number; expense: number; profit: number; revenue: number; cost: number; grossProfit: number; topProducts: Array<{ name: string; qty: number; profit: number }>; lowStock: Product[]; openOrders: number; todayInstallations: number; }
export interface Agent { id: string; key: string; name: string; emoji: string; enabled: boolean; latestJob?: { id: string; status: string; prompt: string; result?: string; error?: string } | null; }
export interface ShopSettings { shopOpen: boolean; shopName: string; promptPayMasked: string; promptPaySet: boolean; taxId: string; address: string; shopInCommunity?: boolean; }

export const baht = (n: number) => `${Number(n ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })} ฿`;
export const STATUS_TH: Record<string, string> = { QUOTE: 'ใบเสนอราคา', ORDERED: 'รอชำระ', PAID: 'ชำระแล้ว', DELIVERED: 'ส่งแล้ว', CANCELLED: 'ยกเลิก', TODO: 'รอทำ', IN_PROGRESS: 'กำลังทำ', DONE: 'เสร็จ' };
export const STATUS_CLS: Record<string, string> = { QUOTE: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30', ORDERED: 'bg-amber-500/15 text-amber-300 border-amber-500/30', PAID: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', DELIVERED: 'bg-sky-500/15 text-sky-300 border-sky-500/30', CANCELLED: 'bg-rose-500/15 text-rose-300 border-rose-500/30', TODO: 'bg-slate-500/15 text-slate-300 border-slate-500/30', IN_PROGRESS: 'bg-amber-500/15 text-amber-300 border-amber-500/30', DONE: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' };

export function StatusBadge({ status }: { status: string }) {
  return <span className={`px-2 py-0.5 rounded-full text-[11px] border ${STATUS_CLS[status] ?? 'bg-slate-500/15 text-slate-300 border-slate-500/30'}`}>{STATUS_TH[status] ?? status}</span>;
}

// เฟส 4: ป้ายสถานะจัดส่ง (ร้านส่งเอง) — แสดงข้างสถานะออเดอร์
export const SHIPPING_TH: Record<string, string> = { PREPARING: 'กำลังเตรียมส่ง', SHIPPED: 'จัดส่งแล้ว', DELIVERED: 'ถึงผู้รับแล้ว' };
export const SHIPPING_CLS: Record<string, string> = { PREPARING: 'bg-amber-500/15 text-amber-300 border-amber-500/30', SHIPPED: 'bg-sky-500/15 text-sky-300 border-sky-500/30', DELIVERED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' };
export function ShippingBadge({ status }: { status: string }) {
  return <span className={`px-2 py-0.5 rounded-full text-[11px] border ${SHIPPING_CLS[status] ?? 'bg-slate-500/15 text-slate-300 border-slate-500/30'}`}>{SHIPPING_TH[status] ?? status}</span>;
}

