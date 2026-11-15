"use client";
// ── State + handlers ของ "AI สอนลูก" (สร้างบทเรียน / เก็บในคลัง / เปิดบทเรียนเก่า / ทำแบบทดสอบ / บันทึกคะแนนอัตโนมัติ) ──
// ย้ายมาจาก src/pages/knowledge.tsx verbatim — logic เดิมทั้งหมด ไม่แก้ behavior (FE-002)
// ตาม precedent ของ use-kid-home.ts (กลุ่มเดียวกัน)
import { useState, useEffect, useCallback, useRef, Dispatch, SetStateAction } from 'react';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { authFetch } from '../../lib/apiFetch';
import { KnowledgeItem, LESSON_TAG, TeachLesson } from './knowledge-types';

interface UseTeachParams {
  isHydrated: boolean;
  isAuthenticated: boolean;
  token: string | null;
  setMessage: Dispatch<SetStateAction<string>>;
  openItem: (item: KnowledgeItem) => void;
  activeKidId: string | null;
  loadKidProgress: (kidId: string) => void;
}

export function useTeach({ isHydrated, isAuthenticated, token, setMessage, openItem, activeKidId, loadKidProgress }: UseTeachParams) {
  const t = useLanguageStore((s) => s.t);

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
  const kidRecordedRef = useRef<string | null>(null); // กันบันทึกคะแนนซ้ำ

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
    loadOllamaModels();
  }, [isHydrated, isAuthenticated, token, loadOllamaModels]);

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

  return {
    teachTopic, setTeachTopic, teachAge, setTeachAge, teachQuizCount, setTeachQuizCount,
    teachModel, setTeachModel, ollamaModels, teaching, teachError, setTeachError,
    lesson, setLesson, lessonUsedKnowledge, savedLessons, lessonSaving, quizAnswers,
    runTeachGenerate, saveGeneratedLesson, openSavedLesson, pickQuizOption, resetQuiz,
  };
}
