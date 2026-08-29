"use client";
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../stores/useAuthStore';
import { useLanguageStore } from '../stores/useLanguageStore';
import { authFetch } from '../lib/apiFetch';
import { api, asArray, asObject } from '../lib/apiClient';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import AddDataPanel from '../components/knowledge/AddDataPanel';
import TypeFilterPanel from '../components/knowledge/TypeFilterPanel';
import SemanticSearchPanel from '../components/knowledge/SemanticSearchPanel';
import TeachCard from '../components/knowledge/TeachCard';
import ManualFilesPanel from '../components/knowledge/ManualFilesPanel';
import ProgressPanel from '../components/knowledge/ProgressPanel';
import AllowanceHistoryPanel from '../components/knowledge/AllowanceHistoryPanel';
import CurriculumPanel from '../components/knowledge/CurriculumPanel';
import KidHomePanel from '../components/knowledge/KidHomePanel';
import LessonPanel from '../components/knowledge/LessonPanel';
import SearchResultsPanel from '../components/knowledge/SearchResultsPanel';
import KnowledgeList from '../components/knowledge/KnowledgeList';
import ItemDetailPanel from '../components/knowledge/ItemDetailPanel';
import { useKidHome } from '../components/knowledge/use-kid-home';
import {
  ACTIVE_KID_KEY, LESSON_TAG,
  AllowanceHistoryKid, CurriculumOverview, ItemType, KidProfile, KidProgressRow, KidStats, KnowledgeItem, TeachLesson,
  videoEmbedUrl,
} from '../components/knowledge/knowledge-types';

export default function KnowledgePage() {
  const { user, isAuthenticated, token, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const isSuperadmin = user?.role === 'SUPERADMIN';

  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [typeFilter, setTypeFilter] = useState<ItemType | 'ALL'>('ALL');
  const [selected, setSelected] = useState<KnowledgeItem | null>(null);
  const [detail, setDetail] = useState<KnowledgeItem | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // เพิ่ม / นำเข้า / อัปโหลด
  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<'manual' | 'import' | 'upload'>('manual');
  const [addForm, setAddForm] = useState<{ type: ItemType; title: string; url: string; content: string; tags: string; notes: string }>({
    type: 'LINK', title: '', url: '', content: '', tags: '', notes: '',
  });
  const [importing, setImporting] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importTitle, setImportTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ค้นหา
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [indexInfo, setIndexInfo] = useState<{ files: number; chunks: number; model: string } | null>(null);

  // ไฟล์คู่มือ (legacy)
  const [manualFiles, setManualFiles] = useState<string[]>([]);
  const [manualFile, setManualFile] = useState('');
  const [manualContent, setManualContent] = useState('');

  // ── AI สอนลูก ──
  const [teachTopic, setTeachTopic] = useState('');
  const [teachAge, setTeachAge] = useState('6-8');
  const [teachQuizCount, setTeachQuizCount] = useState(3); // จำนวนข้อแบบทดสอบ (1-10)
  const [teachModel, setTeachModel] = useState(''); // '' = โมเดลเริ่มต้นของระบบ
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [teaching, setTeaching] = useState(false);
  const [teachError, setTeachError] = useState('');
  const [lesson, setLesson] = useState<TeachLesson | null>(null);
  const [lessonUsedKnowledge, setLessonUsedKnowledge] = useState(false);
  const [savedLessons, setSavedLessons] = useState<KnowledgeItem[]>([]);
  const [lessonSaving, setLessonSaving] = useState(false);
  // สถานะทำแบบทดสอบ: quizAnswers[i] = ตัวเลือกที่เลือก (-1 = ยังไม่ได้ตอบ)
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);

  // ── โปรไฟล์เด็ก ──
  const [kids, setKids] = useState<KidProfile[]>([]);
  const [activeKidId, setActiveKidId] = useState<string | null>(null);
  const [kidStats, setKidStats] = useState<Record<string, KidStats>>({});
  const [kidProgress, setKidProgress] = useState<KidProgressRow[]>([]);
  const [showAddKid, setShowAddKid] = useState(false);
  const [kidForm, setKidForm] = useState<{ name: string; age: string; emoji: string }>({ name: '', age: '', emoji: '🧒' });
  const kidRecordedRef = useRef<string | null>(null); // กันบันทึกคะแนนซ้ำ

  // ── หน้าที่ของลูก — งานบ้าน / บิล / กระเป๋าเงิน (state + handlers ทั้งหมดอยู่ใน hook) ──
  const [showKidHome, setShowKidHome] = useState(false);
  const home = useKidHome({ activeKidId, showKidHome, isHydrated, isAuthenticated, setMessage, setTeachError });
  const { kidHome, setKidHome, loadKidHome } = home;

  // ── ประวัติค่าขนมทุกคน ──
  const [showAllowanceHistory, setShowAllowanceHistory] = useState(false);
  const [allowanceHistory, setAllowanceHistory] = useState<AllowanceHistoryKid[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

// ── สรุปความคืบหน้าทุกคน + กราฟคะแนนตามเวลา ──
  const [showProgress, setShowProgress] = useState(false);
  const [allProgress, setAllProgress] = useState<Record<string, KidProgressRow[]>>({});
  const [progressLoading, setProgressLoading] = useState(false);

  // ── Sovereign Curriculum — หลักสูตรสร้างยอดคน (โฮมสคูล) ──
  const [showCurriculum, setShowCurriculum] = useState(false);
  const [curriculum, setCurriculum] = useState<CurriculumOverview | null>(null);
  const [curTrackFilter, setCurTrackFilter] = useState<string | null>(null);
  const [recordForm, setRecordForm] = useState<{ itemId: string; title: string; score: string; total: string } | null>(null);
  const [curBusy, setCurBusy] = useState(false);

  const loadItems = useCallback(async () => {
    try {
      setItems(await api.getArray<KnowledgeItem>('/api/knowledge/items', typeFilter === 'ALL' ? undefined : { type: typeFilter }));
      setError('');
    } catch (err) {
      setError(t('knowledge.loadError', 'โหลดคลังความรู้ไม่สำเร็จ — ตรวจว่า Backend เปิดอยู่'));
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  const loadManualFiles = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/files`);
      if (res.ok) setManualFiles((await res.json()).files || []);
    } catch {
      // เงียบ
    }
  }, []);

  const loadIndexStatus = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/index/status`);
      if (res.ok) setIndexInfo(asObject(await res.json()));
    } catch {
      // backend ไม่มี semantic module → ข้าม
    }
  }, []);

  // โมเดล Ollama ที่เลือกได้สำหรับสร้างบทเรียน
  const loadOllamaModels = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/models`);
      if (!res.ok) return;
      const data = await res.json();
      const models = (data.models || []).filter((m: string) => !m.startsWith('nomic-embed')); // เอา embedding model ออก
      setOllamaModels(models);
    } catch {
      // เงียบ — ใช้โมเดลเริ่มต้นของระบบ
    }
  }, []);

  useEffect(() => {
    if (!isHydrated || !isAuthenticated || !token) return;
    loadItems();
    loadManualFiles();
    loadIndexStatus();
    loadOllamaModels();
  }, [isHydrated, isAuthenticated, token, loadItems, loadManualFiles, loadIndexStatus, loadOllamaModels]);

  const openItem = async (item: KnowledgeItem) => {
    setSelected(item);
    setDetail(null);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/items/${item.id}`);
      if (res.ok) {
        const data = await res.json();
        setDetail(data);
        setSelected(data);
      }
    } catch {
      setDetail(item);
    }
  };

  const parseTags = (raw: string): string[] => raw.split(',').map((x) => x.trim()).filter(Boolean);

  const createItem = async () => {
    if (!addForm.title.trim()) {
      setError(t('knowledge.errors.titleRequired', 'กรุณากรอกชื่อ/หัวข้อ'));
      return;
    }
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: addForm.type,
          title: addForm.title.trim(),
          url: addForm.url.trim() || undefined,
          content: addForm.content,
          tags: parseTags(addForm.tags),
          notes: addForm.notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.createFailed', 'สร้างไม่สำเร็จ'));
      setMessage(t('knowledge.added', 'เพิ่ม "{title}" แล้ว', { title: data.item.title }));
      setAddForm({ type: 'LINK', title: '', url: '', content: '', tags: '', notes: '' });
      setShowAdd(false);
      loadItems();
    } catch (err: any) {
      setError(err.message || t('knowledge.errors.createFailed', 'สร้างไม่สำเร็จ'));
    }
  };

  const importFromUrl = async () => {
    const url = importUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      setError(t('knowledge.errors.urlInvalid', 'URL ต้องขึ้นต้นด้วย http(s)://'));
      return;
    }
    setImporting(true);
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, title: importTitle.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.importFailed', 'นำเข้าไม่สำเร็จ'));
      setMessage(t('knowledge.imported', 'นำเข้าสำเร็จ: "{title}" (สกัดข้อความ {n} ตัวอักษร)', { title: data.item.title, n: data.extractedChars ?? 0 }));
      setImportUrl('');
      setImportTitle('');
      setShowAdd(false);
      loadItems();
    } catch (err: any) {
      setError(err.message || t('knowledge.errors.importFailed', 'นำเข้าไม่สำเร็จ'));
    } finally {
      setImporting(false);
    }
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    setError('');
    const form = new FormData();
    form.append('file', file);
    form.append('tags', '');
    form.append('notes', '');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/upload`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.uploadFailed', 'อัปโหลดไม่สำเร็จ'));
      setMessage(`${t('knowledge.uploaded', 'อัปโหลด "{title}" แล้ว', { title: data.item.title })}${data.extractedChars ? t('knowledge.uploadedExtract', ' (สกัดข้อความ {n} ตัวอักษร)', { n: data.extractedChars }) : ''}`);
      setShowAdd(false);
      loadItems();
    } catch (err: any) {
      setError(err.message || t('knowledge.errors.uploadFailed', 'อัปโหลดไม่สำเร็จ'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const deleteItem = async (item: KnowledgeItem) => {
    if (!confirm(t('knowledge.deleteConfirm', 'ลบ "{title}" จากคลังความรู้?', { title: item.title }))) return;
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/items/${item.id}`, { method: 'DELETE' });
      setMessage(t('knowledge.deleted', 'ลบ "{title}" แล้ว', { title: item.title }));
      if (selected?.id === item.id) setSelected(null);
      loadItems();
    } catch {
      setError(t('knowledge.errors.deleteFailed', 'ลบไม่สำเร็จ'));
    }
  };

  const runSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery.trim(), top_k: 8 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.searchFailed', 'ค้นหาไม่สำเร็จ'));
      setSearchResults(data.results || []);
    } catch (err: any) {
      setError(err.message || t('knowledge.errors.searchFailed', 'ค้นหาไม่สำเร็จ'));
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const rebuildIndex = async () => {
    if (!confirm(t('knowledge.rebuildConfirm', 'สร้าง index ใหม่ (embed ไฟล์คู่มือ + รายการในคลังความรู้)? อาจใช้เวลาสักครู่'))) return;
    setError('');
    setMessage('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/index`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.indexFailed', 'สร้าง index ไม่สำเร็จ'));
      setMessage(t('knowledge.indexed', 'สร้าง index สำเร็จ: {chunks} chunks จาก {files} รายการ', { chunks: data.chunks, files: data.files }));
      loadIndexStatus();
    } catch (err: any) {
      setError(err.message || t('knowledge.errors.indexNoOllama', 'สร้าง index ไม่สำเร็จ (ต้องมี Ollama + embedding model)'));
    }
  };

  const openManual = async (file: string) => {
    setManualFile(file);
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/file/${file}`);
      if (!res.ok) throw new Error('File not found');
      setManualContent((await res.json()).content || '');
    } catch {
      setError(t('knowledge.errors.fileLoad', 'ไม่สามารถโหลดไฟล์ {file} ได้', { file }));
      setManualContent('');
    }
  };

  const saveManual = async () => {
    if (!manualFile) return;
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/file/${manualFile}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: manualContent }),
      });
      setMessage(t('knowledge.manualSaved', 'บันทึกคู่มือสำเร็จ'));
    } catch {
      setError(t('knowledge.manualSaveFailed', 'ไม่สามารถบันทึกไฟล์ได้'));
    }
  };

  // เปิดผลค้นหา — 📚 prefix = knowledge item, อื่น = ไฟล์คู่มือ
  const openSearchResult = (r: any) => {
    if (r.file && r.file.startsWith('📚 ')) {
      const m = r.file.match(/\[([0-9a-f-]{36})\]/);
      if (m) {
        const item = items.find((i) => i.id === m[1]);
        if (item) {
          openItem(item);
          setSearchResults(null);
          return;
        }
      }
    }
    openManual(r.file);
    setSearchResults(null);
  };

  // ── AI สอนลูก ──

  // โหลดบทเรียนที่เคยเก็บไว้ (NOTE + แท็ก "บทเรียน")
  const loadSavedLessons = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/items`);
      if (!res.ok) return;
      const all = (await res.json()) as KnowledgeItem[];
      setSavedLessons(all.filter((i) => (i.tags || []).includes(LESSON_TAG)));
    } catch {
      // เงียบ — ยังเปิดใช้งานโหมดอื่นได้
    }
  }, []);

  useEffect(() => {
    if (isHydrated && isAuthenticated) loadSavedLessons();
  }, [isHydrated, isAuthenticated, loadSavedLessons]);

  // เรียก AI สร้างบทเรียน (ผู้ใหญ่เลือกหัวข้อ + ระดับอายุ)
  const runTeachGenerate = async () => {
    const topic = teachTopic.trim();
    if (!topic) {
      setTeachError(t('knowledge.errors.topicRequired', 'กรุณากรอกหัวข้อที่อยากให้ AI สอนลูก — เช่น "น้ำ", "ระบบสุริยะ", "การเอาตัวรอดจากน้ำท่วม"'));
      return;
    }
    setTeaching(true);
    setTeachError('');
    setLesson(null);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, ageRange: teachAge, quizCount: teachQuizCount, model: teachModel || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.lessonFailed', 'สร้างบทเรียนไม่สำเร็จ'));
      setLesson(data.lesson);
      setLessonUsedKnowledge(!!data.usedKnowledge);
      setQuizAnswers(data.lesson.quiz ? data.lesson.quiz.map(() => -1) : []);
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.lessonNoOllama', 'สร้างบทเรียนไม่สำเร็จ — ตรวจว่า Ollama เปิดอยู่'));
      setLesson(null);
    } finally {
      setTeaching(false);
    }
  };

  // เก็บบทเรียนนี้ไว้ในคลังความรู้
  const saveGeneratedLesson = async () => {
    if (!lesson || lessonSaving) return;
    setLessonSaving(true);
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lesson }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.saveFailed', 'บันทึกไม่สำเร็จ'));
      setMessage(t('knowledge.lessonSaved', 'เก็บบทเรียน "{title}" ไว้ในคลังความรู้แล้ว', { title: lesson.title }));
      loadSavedLessons();
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.saveFailed', 'บันทึกไม่สำเร็จ'));
    } finally {
      setLessonSaving(false);
    }
  };

  // เปิดบทเรียนที่เคยเก็บไว้ — ใช้ notes (JSON) เพื่อเล่นแบบทดสอบแบบอินเทอร์แอคทีฟ
  const openSavedLesson = (item: KnowledgeItem) => {
    try {
      const parsed = JSON.parse(item.notes || '');
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.quiz)) {
        setLesson(parsed as TeachLesson);
        setLessonUsedKnowledge(false);
        setQuizAnswers(parsed.quiz.map(() => -1));
        setTeachError('');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
    } catch {
      // notes ไม่ใช่ JSON — เปิดเป็น NOTE ธรรมดา
    }
    openItem(item);
  };

  const pickQuizOption = (qi: number, oi: number) => {
    if (quizAnswers[qi] >= 0) return; // ตอบแล้ว — ล็อกคำตอบ
    setQuizAnswers((prev) => prev.map((a, i) => (i === qi ? oi : a)));
  };

  const resetQuiz = () => setQuizAnswers((prev) => prev.map(() => -1));

  // ── โปรไฟล์เด็ก ──

  const loadKids = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids`);
      if (!res.ok) return;
      const data = await res.json();
      setKids(data.kids || []);
      // คืนค่าโปรไฟล์ที่เลือกไว้ (localStorage) ถ้ายังมีอยู่
      const saved = localStorage.getItem(ACTIVE_KID_KEY);
      const stillExists = saved && (data.kids || []).some((k: KidProfile) => k.id === saved);
      setActiveKidId(stillExists ? saved : (data.kids?.[0]?.id ?? null));
    } catch {
      // backend ยังไม่มีโมดูลนี้ → ข้าม
    }
  }, []);

const loadKidProgress = useCallback(async (kidId: string) => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${kidId}/progress`);
      if (!res.ok) return;
      const data = await res.json();
      setKidProgress(data.progress || []);
      setKidStats((prev) => ({ ...prev, [kidId]: data.stats }));
    } catch {
      // เงียบ
    }
  }, []);

  const loadCurriculum = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/curriculum`);
      if (!res.ok) return;
      const data = await res.json();
      setCurriculum(data);
      setCurTrackFilter((f) => f || data.tracks?.[0]?.id || null);
    } catch {
      // เงียบ — โมดูลหลักสูตรยังไม่มี
    }
  }, []);

  const recordCurriculum = async () => {
    if (!recordForm || !activeKidId) return;
    setCurBusy(true);
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/curriculum/items/${recordForm.itemId}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kidId: activeKidId,
          score: Number(recordForm.score) || 0,
          total: Number(recordForm.total) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'บันทึกเรียนจบไม่สำเร็จ');
      setMessage(data.certificate ? `🎓 ${data.certificate.title}` : t('knowledge.curriculum.recorded', 'บันทึกเรียนจบหลักสูตรแล้ว'));
      setRecordForm(null);
      loadCurriculum();
      if (activeKidId) loadKidProgress(activeKidId);
    } catch (err: any) {
      setError(err.message || 'บันทึกเรียนจบไม่สำเร็จ');
    } finally {
      setCurBusy(false);
    }
  };

  useEffect(() => {
    if (isHydrated && isAuthenticated) loadKids();
  }, [isHydrated, isAuthenticated, loadKids]);

  useEffect(() => {
    if (activeKidId) {
      localStorage.setItem(ACTIVE_KID_KEY, activeKidId);
      loadKidProgress(activeKidId);
    } else {
      setKidProgress([]);
      setKidHome(null);
    }
  }, [activeKidId, loadKidProgress]);

  const createKidUI = async () => {
    const name = kidForm.name.trim();
    if (!name) {
      setTeachError(t('knowledge.errors.kidNameRequired', 'ต้องใส่ชื่อเด็กก่อน'));
      return;
    }
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, age: kidForm.age ? Number(kidForm.age) : undefined, emoji: kidForm.emoji }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.addFailed', 'เพิ่มไม่สำเร็จ'));
      setMessage(t('knowledge.kidAdded', 'เพิ่มโปรไฟล์ "{name}" แล้ว', { name }));
      setKidForm({ name: '', age: '', emoji: '🧒' });
      setShowAddKid(false);
      await loadKids();
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.kidAddFailed', 'เพิ่มโปรไฟล์ไม่สำเร็จ'));
    }
  };

  const deleteKidUI = async (kid: KidProfile) => {
    if (!confirm(t('knowledge.deleteKidConfirm', 'ลบโปรไฟล์ "{name}" (รวมประวัติคะแนน)?', { name: kid.name }))) return;
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${kid.id}`, { method: 'DELETE' });
      if (activeKidId === kid.id) {
        localStorage.removeItem(ACTIVE_KID_KEY);
        setActiveKidId(null);
      }
      setKidStats((prev) => { const next = { ...prev }; delete next[kid.id]; return next; });
      await loadKids();
} catch {
      setTeachError(t('knowledge.errors.historyLoadFailed', 'โหลดประวัติไม่สำเร็จ'));
    }
  };

  // เมื่อทำแบบทดสอบเสร็จครบทุกข้อ (และมีโปรไฟล์เด็กที่เลือก) → บันทึกคะแนนอัตโนมัติ
  useEffect(() => {
    if (!lesson || !activeKidId || lesson.quiz.length === 0) return;
    const allAnswered = quizAnswers.every((a) => a >= 0);
    if (!allAnswered) return;
    const score = lesson.quiz.filter((_, i) => quizAnswers[i] === lesson.quiz[i].answer).length;
    const signature = `${lesson.title}|${score}/${lesson.quiz.length}`;
    if (kidRecordedRef.current === signature) return;
    kidRecordedRef.current = signature;
    authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lessonTitle: lesson.title,
        score,
        total: lesson.quiz.length,
        lessonItemId: null,
      }),
    })
      .then((res) => (res.ok ? loadKidProgress(activeKidId) : null))
      .catch(() => { kidRecordedRef.current = null; });
  }, [lesson, activeKidId, quizAnswers, loadKidProgress]);

  // ── ประวัติค่าขนมทุกคน + จ่ายย้อนหลัง ──
  const loadAllowanceHistory = useCallback(async () => {
    setHistoryLoading(true);
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/allowance/history`);
      if (!res.ok) throw new Error(t('knowledge.errors.historyLoadFailed', 'โหลดประวัติไม่สำเร็จ'));
      const data = await res.json();
      setAllowanceHistory(data.kids || []);
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.historyLoadFailed', 'โหลดประวัติไม่สำเร็จ'));
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const payAllowanceNowUI = async (kidId: string, kidName: string) => {
    if (!confirm(t('knowledge.payBackConfirm', 'จ่ายค่าขนมย้อนหลังให้ {name} ตอนนี้? (ระบบจะจ่ายเฉพาะรอบที่ยังไม่ได้จ่าย)', { name: kidName }))) return;
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${kidId}/allowance/pay-now`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('knowledge.errors.payFailed', 'จ่ายไม่สำเร็จ'));
      setMessage(data.paid ? t('knowledge.paidBack', 'จ่ายค่าขนมย้อนหลัง {amount} บาท ให้ {name} แล้ว', { amount: data.amount, name: kidName }) : t('knowledge.alreadyPaid', '{name} จ่ายครบสัปดาห์นี้แล้ว — ไม่ต้องจ่ายซ้ำ', { name: kidName }));
      loadAllowanceHistory();
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.payFailed', 'จ่ายไม่สำเร็จ'));
    }
  };

  // ── สรุปความคืบหน้าทุกคน — ดึงคะแนนตามเวลาเพื่อวาดกราฟ ──
  const loadAllProgress = useCallback(async () => {
    if (progressLoading) return;
    setProgressLoading(true);
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids`);
      if (!res.ok) throw new Error(t('knowledge.errors.kidsLoadFailed', 'โหลดโปรไฟล์ไม่สำเร็จ'));
      const { kids: kidList } = await res.json();
      const rows = await Promise.all(
        (kidList as KidProfile[]).map(async (k) => {
          try {
            const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${k.id}/progress`);
            if (!r.ok) return [k.id, []] as const;
            const d = await r.json();
            return [k.id, (d.progress || []).slice().reverse()] as const; // เรียงตามเวลา (เก่า→ใหม่)
          } catch {
            return [k.id, []] as const;
          }
        })
      );
      setAllProgress(Object.fromEntries(rows));
    } catch (err: any) {
      setTeachError(err.message || t('knowledge.errors.progressLoadFailed', 'โหลดความคืบหน้าไม่สำเร็จ'));
    } finally {
      setProgressLoading(false);
    }
  }, [progressLoading]);

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">{t('knowledge.unauthorized', 'Unauthorized')}</div>;
  }

  const filtered = typeFilter === 'ALL' ? items : items.filter((i) => i.type === typeFilter);
  const embed = detail?.url ? videoEmbedUrl(detail.url) : null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader
          eyebrow={t('knowledge.eyebrow', 'ชีวิต & การเงิน')}
          title="SOVEREIGN OS" icon={<Icon name="knowledge" size={18} />}
          subtitle={t('knowledge.subtitle', 'Knowledge Base — เก็บทุกอย่างไว้ในที่เดียว')} actions={<div className="flex items-center gap-3">
            <button
              onClick={() => { setShowAdd(!showAdd); setError(''); }}
              className="btn-primary"
            >
              <Icon name="plus" size={14} /> {t('knowledge.addItem', 'เพิ่มข้อมูล')}
            </button>
            <Link href="/dashboard" scroll={false} className="text-sm text-sky-400 hover:underline">{t('knowledge.backDashboard', '← กลับ Dashboard')}</Link>
          </div>}
        />

        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-7xl mx-auto w-full flex gap-6 w-full items-start">
          {/* ── ซ้าย: ตัวกรอง + ค้นหา + คู่มือ ── */}
          <div className="w-72 shrink-0 space-y-4">
            {/* เพิ่มข้อมูล */}
            {showAdd && (
              <AddDataPanel
                addMode={addMode} setAddMode={setAddMode}
                addForm={addForm} setAddForm={setAddForm}
                importUrl={importUrl} setImportUrl={setImportUrl}
                importTitle={importTitle} setImportTitle={setImportTitle}
                importing={importing} createItem={createItem} importFromUrl={importFromUrl}
                uploading={uploading} uploadFile={uploadFile} fileRef={fileRef}
              />
            )}

            {/* กรองตามประเภท */}
            <TypeFilterPanel typeFilter={typeFilter} setTypeFilter={setTypeFilter} items={items} />

            {/* ค้นหาความหมาย */}
            <SemanticSearchPanel
              searchQuery={searchQuery} setSearchQuery={setSearchQuery}
              runSearch={runSearch} searching={searching}
              indexInfo={indexInfo} isSuperadmin={isSuperadmin} rebuildIndex={rebuildIndex}
            />

            {/* AI สอนลูก — ผู้ใหญ่เลือกหัวข้อ/ระดับอายุ → สร้างบทเรียน + แบบทดสอบจากคลังความรู้ */}
            <TeachCard
              teachTopic={teachTopic} setTeachTopic={setTeachTopic}
              teachAge={teachAge} setTeachAge={setTeachAge}
              teachQuizCount={teachQuizCount} setTeachQuizCount={setTeachQuizCount}
              teachModel={teachModel} setTeachModel={setTeachModel}
              ollamaModels={ollamaModels} teaching={teaching}
              teachError={teachError} setTeachError={setTeachError}
              runTeachGenerate={runTeachGenerate} items={items}
              showAddKid={showAddKid} setShowAddKid={setShowAddKid}
              kidForm={kidForm} setKidForm={setKidForm} createKidUI={createKidUI}
              kids={kids} kidStats={kidStats} activeKidId={activeKidId} setActiveKidId={setActiveKidId} deleteKidUI={deleteKidUI}
              showKidHome={showKidHome} setShowKidHome={setShowKidHome}
              kidHome={kidHome} loadKidHome={loadKidHome}
              showProgress={showProgress} setShowProgress={setShowProgress}
              allProgress={allProgress} loadAllProgress={loadAllProgress}
              showAllowanceHistory={showAllowanceHistory} setShowAllowanceHistory={setShowAllowanceHistory}
              allowanceHistory={allowanceHistory} loadAllowanceHistory={loadAllowanceHistory}
              showCurriculum={showCurriculum} setShowCurriculum={setShowCurriculum}
              curriculum={curriculum} loadCurriculum={loadCurriculum}
              kidProgress={kidProgress} savedLessons={savedLessons} openSavedLesson={openSavedLesson}
            />

            {/* ไฟล์คู่มือ (legacy) */}
            <ManualFilesPanel
              manualFiles={manualFiles} manualFile={manualFile} openManual={openManual}
              manualContent={manualContent} setManualContent={setManualContent} saveManual={saveManual}
            />
          </div>

          {/* ── ขวา: รายการ + ตัวแสดงผล ── */}
          <div className="flex-1 min-w-0 space-y-4">
            {message && <div className="p-3 rounded text-sm bg-emerald-500/10 text-emerald-300 border border-emerald-500/40">{message}</div>}
            {error && <div className="p-3 rounded text-sm bg-red-500/10 text-red-400 border border-red-500/40">{error}</div>}

            {/* ── สรุปความคืบหน้าของลูกทุกคน — กราฟคะแนนตามเวลา ── */}
            {showProgress && (
              <ProgressPanel progressLoading={progressLoading} kids={kids} kidStats={kidStats} allProgress={allProgress} />
            )}

            {/* ── ประวัติค่าขนมทุกคน + จ่ายย้อนหลัง ── */}
            {showAllowanceHistory && (
              <AllowanceHistoryPanel
                loadAllowanceHistory={loadAllowanceHistory} historyLoading={historyLoading}
                allowanceHistory={allowanceHistory} payAllowanceNowUI={payAllowanceNowUI}
              />
            )}

            {/* ── Sovereign Curriculum — หลักสูตรสร้างยอดคน (โฮมสคูล) ── */}
            {showCurriculum && (
              <CurriculumPanel
                curriculum={curriculum} activeKidId={activeKidId} setActiveKidId={setActiveKidId}
                curTrackFilter={curTrackFilter} setCurTrackFilter={setCurTrackFilter}
                recordForm={recordForm} setRecordForm={setRecordForm}
                recordCurriculum={recordCurriculum} curBusy={curBusy}
                setTeachTopic={setTeachTopic} setTeachError={setTeachError}
              />
            )}

            {/* ── หน้าที่ของลูก — งานบ้าน / บิล / กระเป๋าเงิน ── */}
            {showKidHome && activeKidId && (
              <KidHomePanel
                {...home}
                setTeachError={setTeachError}
                setTeachTopic={setTeachTopic}
                setShowKidHome={setShowKidHome}
              />
            )}

            {/* ── บทเรียน AI สอนลูก ── */}
            {lesson && (
              <LessonPanel
                lesson={lesson} teachAge={teachAge}
                lessonSaving={lessonSaving} saveGeneratedLesson={saveGeneratedLesson}
                setLesson={setLesson} setTeachError={setTeachError}
                lessonUsedKnowledge={lessonUsedKnowledge}
                quizAnswers={quizAnswers} pickQuizOption={pickQuizOption} resetQuiz={resetQuiz}
                activeKidId={activeKidId} kids={kids}
              />
            )}

            {/* ผลค้นหา */}
            {searchResults !== null && (
              <SearchResultsPanel searchResults={searchResults} setSearchResults={setSearchResults} openSearchResult={openSearchResult} />
            )}

            {/* รายการคลังความรู้ */}
            <KnowledgeList loading={loading} filtered={filtered} selected={selected} openItem={openItem} deleteItem={deleteItem} />

            {/* ตัวแสดงผลละเอียด */}
            {selected && (
              <ItemDetailPanel selected={selected} embed={embed} setSelected={setSelected} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
