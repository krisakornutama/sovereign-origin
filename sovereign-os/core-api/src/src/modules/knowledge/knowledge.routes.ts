// src/modules/knowledge/knowledge.routes.ts
// ─────────────────────────────────────────────────────────────────────────────
// Knowledge Base 2.0 — คลังความรู้ที่เก็บได้ทุกอย่าง:
//   LINK (ลิงก์ทั่วไป) / VIDEO (YouTube ฯลฯ) / PDF / TXT / WEBPAGE / NOTE
// เอาไว้รวมข้อมูลจากหลายแหล่ง (เว็บ ไฟล์ ลิงก์ คลิป) → ใช้ค้นหา (semantic search)
// และเป็นฐานความรู้สำหรับสอนลูกหลานในอนาคต
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import axios from 'axios';
import { authenticate } from '../../middleware/auth.middleware';
import { prisma } from '../../lib/prisma';
import { hashEngine } from '../../services/hash-engine.service';
import { knowledgeDir, uploadsDir } from '../../services/knowledge-dir.service';

const router = Router();

const KNOWLEDGE_DIR = knowledgeDir();
const UPLOAD_DIR = uploadsDir();

export const KNOWLEDGE_TYPES = ['LINK', 'VIDEO', 'PDF', 'TXT', 'WEBPAGE', 'NOTE'] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

function ensureDirs(): void {
  if (!fs.existsSync(KNOWLEDGE_DIR)) fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// อัปโหลดไฟล์ → knowledge/uploads (เฉพาะ PDF/TXT/MD — กันไฟล์อันตราย)
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDirs();
      cb(null, UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
      const safe = (file.originalname || 'file').replace(/[^\w.\- ]+/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (['.pdf', '.txt', '.md', '.markdown'].includes(ext)) cb(null, true);
    else cb(new Error('รองรับเฉพาะไฟล์ .pdf / .txt / .md เท่านั้น'));
  },
});

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean).slice(0, 20);
  if (typeof raw === 'string') {
    return raw
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20);
  }
  return [];
}

function validateType(type: unknown): KnowledgeType | null {
  const t = String(type || '').toUpperCase();
  return (KNOWLEDGE_TYPES as readonly string[]).includes(t) ? (t as KnowledgeType) : null;
}

/** สกัดข้อความจาก HTML คร่าว ๆ (ไม่ต้อง dependency) — ตัด tag/script/style */
export function htmlToText(html: string): string {
  return (html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** สกัด title จาก HTML (<title> หรือ og:title) */
export function htmlTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) return og[1].trim();
  const og2 = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  if (og2) return og2[1].trim();
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return title ? title[1].trim() : '';
}

// ── CRUD ──

// GET /api/knowledge/items?type= — รายการทั้งหมด (ไม่รวม content ตัวเต็ม — ดึงทีละตัว)
router.get('/items', authenticate, async (req, res) => {
  try {
    const type = validateType(req.query.type);
    const where = type ? { type } : {};
    const rows = await prisma.knowledgeItem.findMany({
      where,
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        type: true,
        title: true,
        url: true,
        file_path: true,
        tags: true,
        notes: true,
        created_at: true,
        updated_at: true,
        content: true,
      },
    });
    res.json(
      rows.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        url: r.url,
        file_path: r.file_path,
        tags: (r.tags as string[]) || [],
        notes: r.notes,
        created_at: r.created_at,
        updated_at: r.updated_at,
        // ส่ง preview สั้น ๆ ไปในลิสต์ — ตัวเต็มไปใน /items/:id
        preview: r.content ? r.content.slice(0, 200) : null,
      }))
    );
  } catch (err) {
    console.error('Knowledge list error:', err);
    res.status(500).json({ error: 'Failed to list knowledge items' });
  }
});

// GET /api/knowledge/items/:id — เนื้อหาเต็ม
router.get('/items/:id', authenticate, async (req, res) => {
  try {
    const row = await prisma.knowledgeItem.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Item not found' });
    res.json({
      id: row.id,
      type: row.type,
      title: row.title,
      url: row.url,
      content: row.content,
      file_path: row.file_path,
      tags: (row.tags as string[]) || [],
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load item' });
  }
});

// POST /api/knowledge/items — สร้างรายการ (ลิงก์/วิดีโอ/ข้อความ/บันทึก)
router.post('/items', authenticate, async (req, res) => {
  try {
    const { type, title, url, content, notes } = req.body || {};
    const t = validateType(type);
    if (!t) return res.status(400).json({ error: `invalid type (${KNOWLEDGE_TYPES.join('|')})` });
    const name = String(title || '').trim();
    if (!name) return res.status(400).json({ error: 'title is required' });
    const row = await prisma.knowledgeItem.create({
      data: {
        type: t,
        title: name,
        url: url ? String(url).trim() : null,
        content: content ? String(content) : null,
        tags: parseTags(req.body?.tags) as unknown as object,
        notes: notes ? String(notes) : null,
      },
    });
    res.status(201).json({ success: true, item: row });
  } catch (err) {
    console.error('Knowledge create error:', err);
    res.status(500).json({ error: 'Failed to create item' });
  }
});

// PUT /api/knowledge/items/:id — แก้ไข
router.put('/items/:id', authenticate, async (req, res) => {
  try {
    const existing = await prisma.knowledgeItem.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Item not found' });
    const { title, url, content, notes, type } = req.body || {};
    const data: Record<string, unknown> = {};
    if (typeof title === 'string' && title.trim()) data.title = title.trim();
    if (typeof url === 'string') data.url = url.trim() || null;
    if (typeof content === 'string') data.content = content;
    if (typeof notes === 'string') data.notes = notes || null;
    if (req.body?.tags !== undefined) data.tags = parseTags(req.body.tags) as unknown as object;
    if (type !== undefined) {
      const t = validateType(type);
      if (!t) return res.status(400).json({ error: 'invalid type' });
      data.type = t;
    }
    const row = await prisma.knowledgeItem.update({ where: { id: req.params.id }, data });
    res.json({ success: true, item: row });
  } catch (err) {
    console.error('Knowledge update error:', err);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

// DELETE /api/knowledge/items/:id — ลบ (รวมไฟล์อัปโหลด)
router.delete('/items/:id', authenticate, async (req, res) => {
  try {
    const existing = await prisma.knowledgeItem.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Item not found' });
    if (existing.file_path) {
      try {
        fs.unlinkSync(path.join(KNOWLEDGE_DIR, existing.file_path));
      } catch {
        /* ไฟล์อาจหายแล้ว */
      }
    }
    await prisma.knowledgeItem.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error('Knowledge delete error:', err);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// ── Import จาก URL — ดึงหน้าเว็บ → สกัดข้อความ → เก็บเป็น WEBPAGE ──

// POST /api/knowledge/import { url, title?, tags?, notes? }
router.post('/import', authenticate, async (req, res) => {
  try {
    const url = String(req.body?.url || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'url ต้องขึ้นต้นด้วย http(s)://' });
    }
    const fetched = await axios.get(url, {
      timeout: 20000,
      responseType: 'text',
      maxRedirects: 5,
      headers: { 'User-Agent': 'Mozilla/5.0 (sovereign-os/1.0; knowledge-importer)' },
    });
    const html = String(fetched.data || '');
    const text = htmlToText(html);
    const title = String(req.body?.title || '').trim() || htmlTitle(html) || url;
    const row = await prisma.knowledgeItem.create({
      data: {
        type: 'WEBPAGE',
        title: title.slice(0, 300),
        url,
        content: text.slice(0, 200000),
        tags: parseTags(req.body?.tags) as unknown as object,
        notes: req.body?.notes ? String(req.body.notes) : null,
      },
    });
    res.status(201).json({
      success: true,
      item: row,
      extractedChars: text.length,
      note: text.length === 0 ? 'ไม่สามารถสกัดข้อความจากหน้านี้ได้ (อาจเป็น JavaScript-only) — บันทึกเป็นลิงก์ไว้ก่อน' : undefined,
    });
  } catch (err: any) {
    console.error('Knowledge import error:', err?.message || err);
    res.status(500).json({ error: `นำเข้าจาก URL ไม่สำเร็จ (${err?.code || err?.message || 'network error'})` });
  }
});

// ── Upload ไฟล์ PDF / TXT ──

// POST /api/knowledge/upload (multipart: file + title?, tags?, notes?)
router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ error: 'file is required (.pdf / .txt / .md)' });

    // Lite AV: SHA-256 scan (MIME magic bytes + EICAR + Threat Intel FILE) ก่อนบันทึก
    const buf = fs.readFileSync(file.path);
    const av = await hashEngine.scanBuffer(buf, { originalName: file.originalname });
    if (!av.ok) {
      fs.unlinkSync(file.path); // ลบทิ้ง — ต้นฉบับไปอยู่ quarantine แล้ว
      return res.status(403).json({
        error: `ไฟล์ถูกปฏิเสธ: ${av.error} (sha256: ${av.hash?.slice(0, 12)}…)`,
        verdict: av.verdict,
        hash: av.hash,
        quarantinedTo: av.quarantinedTo,
      });
    }

    const ext = path.extname(file.filename).toLowerCase();
    const isPdf = ext === '.pdf';
    const relPath = path.join('uploads', file.filename);

    let content = '';
    if (isPdf) {
      try {
        // lazy import — pdf-parse โหลด pdf.js ตอนเรียกจริง (กันหน่วงตอน start)
        const pdfParse = (await import('pdf-parse')).default;
        const data = await pdfParse(buf);
        content = String(data.text || '').slice(0, 500000);
      } catch (err) {
        console.error('PDF parse failed:', err);
        content = ''; // เก็บไฟล์ไว้ก่อน — ผู้ใช้เพิ่มบันทึกเองได้
      }
    } else {
      content = buf.toString('utf-8').slice(0, 500000);
    }

    const fallbackTitle = (file.originalname || 'file').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    const title = String(req.body?.title || '').trim() || fallbackTitle;

    const row = await prisma.knowledgeItem.create({
      data: {
        type: isPdf ? 'PDF' : 'TXT',
        title: title.slice(0, 300),
        content: content || null,
        file_path: relPath,
        tags: parseTags(req.body?.tags) as unknown as object,
        notes: req.body?.notes ? String(req.body.notes) : null,
      },
    });
    res.status(201).json({
      success: true,
      item: row,
      extractedChars: content.length,
      note: isPdf && content.length === 0 ? 'อ่านข้อความจาก PDF ไม่ได้ (อาจเป็นภาพสแกน) — บันทึกไฟล์ไว้แล้ว ใส่หมายเหตุเพิ่มได้' : undefined,
    });
  } catch (err) {
    console.error('Knowledge upload error:', err);
    res.status(500).json({ error: 'อัปโหลดไฟล์ไม่สำเร็จ' });
  }
});

// GET /api/knowledge/uploads/:file — เปิดไฟล์ที่อัปโหลด (PDF view ในเบราว์เซอร์)
router.get('/uploads/:file', authenticate, (req, res) => {
  try {
    const name = req.params.file;
    const root = path.resolve(KNOWLEDGE_DIR);
    const resolved = path.resolve(root, 'uploads', name);
    if (!resolved.startsWith(root + path.sep) || !fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.sendFile(resolved);
  } catch {
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

export default router;
