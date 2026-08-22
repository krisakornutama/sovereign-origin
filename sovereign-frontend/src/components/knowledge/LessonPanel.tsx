"use client";
// ── บทเรียน AI สอนลูก (เนื้อหา + แบบทดสอบอินเทอร์แอคทีฟ) — ย้าย JSX และ printLesson มาจาก src/pages/knowledge.tsx verbatim ──
import { Dispatch, SetStateAction } from 'react';
import { useLanguageStore } from '../../stores/useLanguageStore';
import Icon from '../ui/Icon';
import { KidProfile, TeachLesson, teachAgeLabel } from './knowledge-types';

interface LessonPanelProps {
  lesson: TeachLesson;
  teachAge: string;
  lessonSaving: boolean;
  saveGeneratedLesson: () => void;
  setLesson: Dispatch<SetStateAction<TeachLesson | null>>;
  setTeachError: Dispatch<SetStateAction<string>>;
  lessonUsedKnowledge: boolean;
  quizAnswers: number[];
  pickQuizOption: (qi: number, oi: number) => void;
  resetQuiz: () => void;
  activeKidId: string | null;
  kids: KidProfile[];
}

export default function LessonPanel({ lesson, teachAge, lessonSaving, saveGeneratedLesson, setLesson, setTeachError, lessonUsedKnowledge, quizAnswers, pickQuizOption, resetQuiz, activeKidId, kids }: LessonPanelProps) {
  const t = useLanguageStore((s) => s.t);

  // ── พิมพ์ / ส่งออก PDF บทเรียน ── เปิดหน้าต่างพิมพ์ของเบราว์เซอร์ (บันทึกเป็น PDF ได้)
  const printLesson = (l: TeachLesson) => {
    const ageLabel = t(`knowledge.age.${l.age_range || teachAge}`, teachAgeLabel(l.age_range || teachAge));
    const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const sections = l.sections.map((s) =>
      `<h3>${esc(s.heading)}</h3><p>${esc(s.content).replace(/\n/g, '<br/>')}</p>`
    ).join('');
    const points = l.key_points.length
      ? `<h2>${t('knowledge.lesson.keyPoints', 'จุดสำคัญที่ต้องจำ')}</h2><ul>${l.key_points.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>`
      : '';
    const quiz = l.quiz.map((q, i) => {
      const opts = q.options.map((o, j) => {
        const mark = j === q.answer ? t('knowledge.lesson.answer', ' ✓ (คำตอบ)') : '';
        return `<li>${esc(o)}${mark}</li>`;
      }).join('');
      return `<div class="q"><p><b>${i + 1}. ${esc(q.question)}</b></p><ol>${opts}</ol>${q.explanation ? `<p class="exp">${t('knowledge.lesson.explanation', 'เฉลย: {text}', { text: esc(q.explanation) })}</p>` : ''}</div>`;
    }).join('');

    const html = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8"/>
<title>${esc(l.title)} — ${t('knowledge.teach.title', 'AI สอนลูก')}</title>
<style>
  body { font-family: 'Leelawadee UI', 'Noto Sans Thai', Tahoma, sans-serif; color: #1f2937; max-width: 720px; margin: 32px auto; padding: 0 24px; line-height: 1.6; }
  h1 { font-size: 26px; color: #065f46; margin-bottom: 4px; }
  .meta { font-size: 13px; color: #6b7280; margin-bottom: 16px; }
  h2 { font-size: 18px; color: #065f46; border-bottom: 1px solid #d1d5db; padding-bottom: 4px; margin-top: 24px; }
  h3 { font-size: 15px; color: #065f46; margin-bottom: 4px; }
  p { margin: 4px 0 12px; }
  ul, ol { margin: 4px 0 12px 20px; }
  .q { margin-bottom: 16px; }
  .exp { color: #4b5563; font-size: 13px; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<h1>${esc(l.title)}</h1>
<div class="meta">${t('knowledge.lesson.byline', 'AI สอนลูก · {age}', { age: esc(ageLabel) })}</div>
${l.summary ? `<p>${esc(l.summary)}</p>` : ''}
${sections}
${points}
${quiz ? `<h2>${t('knowledge.lesson.quiz', 'แบบทดสอบ')}</h2>${quiz}` : ''}
${l.sources.length ? `<p style="font-size:11px;color:#9ca3af">${t('knowledge.lesson.sources', 'อ้างอิงจากคลังความรู้: {list}', { list: esc(l.sources.filter((s, i, a) => a.indexOf(s) === i).join(' · ')) })}</p>` : ''}
</body>
</html>`;

    const w = window.open('', '_blank', 'width=820,height=900');
    if (!w) {
      alert(t('knowledge.errors.popupBlocked', 'เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต popup แล้วลองใหม่'));
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="card panel-glow p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[10px] text-emerald-400 font-bold">{t('knowledge.lesson.byline', 'AI สอนลูก · {age}', { age: t(`knowledge.age.${lesson.age_range || teachAge}`, teachAgeLabel(lesson.age_range || teachAge)) })}</div>
          <h2 className="text-lg font-bold text-gray-100 glow-text mt-0.5">{lesson.title}</h2>
          {lesson.summary && <p className="text-sm text-gray-400 mt-1 leading-relaxed">{lesson.summary}</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => printLesson(lesson)} className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded">{t('knowledge.lesson.print', 'พิมพ์/PDF')}</button>
          {lessonSaving ? (
            <span className="text-xs px-2 py-1 bg-gray-700 rounded">{t('knowledge.lesson.saving', 'กำลังเก็บ...')}</span>
          ) : (
            <button onClick={saveGeneratedLesson} className="text-xs px-2 py-1 bg-emerald-600 hover:bg-emerald-500 rounded font-semibold">{t('knowledge.lesson.save', 'เก็บไว้ในคลังความรู้')}</button>
          )}
          <button
            onClick={() => { setLesson(null); setTeachError(''); }}
            className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded"
          >{t('knowledge.lesson.close', '✕ ปิด')}</button>
        </div>
      </div>

      {!lessonUsedKnowledge && (
        <div className="text-xs text-amber-300 bg-amber-500/15 border border-amber-500/40 rounded p-3 leading-relaxed">
          {t('knowledge.lesson.noKnowledge', 'ไม่พบข้อมูลในคลังความรู้ที่ตรงกับหัวข้อนี้ — AI สร้างบทเรียนจากความรู้ทั่วไป อยากได้บทเรียนจากข้อมูลที่เก็บไว้ เปลี่ยนหัวข้อ หรือเพิ่มข้อมูลในคลังความรู้ก่อน')}
        </div>
      )}

      {/* เนื้อหาบทเรียน */}
      {lesson.sections.length > 0 && (
        <div className="space-y-3">
          {lesson.sections.map((s, i) => (
            <div key={i} className="inset p-3">
              {s.heading && <h3 className="text-sm font-semibold text-gray-200 mb-1">{s.heading}</h3>}
              <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{s.content}</p>
            </div>
          ))}
        </div>
      )}

      {lesson.key_points.length > 0 && (
        <div className="inset p-3">
          <h3 className="text-sm font-semibold text-gray-200 mb-1">{t('knowledge.lesson.keyPoints', 'จุดสำคัญที่ต้องจำ')}</h3>
          <ul className="space-y-1">
            {lesson.key_points.map((k, i) => (
              <li key={i} className="text-sm text-gray-300 flex gap-2"><span className="text-emerald-400">•</span>{k}</li>
            ))}
          </ul>
        </div>
      )}

      {/* แบบทดสอบ */}
      {lesson.quiz.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-200">{t('knowledge.lesson.quiz', 'แบบทดสอบ')}</h3>
            <button onClick={resetQuiz} className="text-[11px] px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded inline-flex items-center gap-1"><Icon name="refresh" size={12} />{t('knowledge.lesson.retry', 'ทำใหม่')}</button>
          </div>
          {lesson.quiz.map((q, qi) => {
            const picked = quizAnswers[qi] ?? -1;
            const answeredQ = picked >= 0;
            const isCorrect = answeredQ && picked === q.answer;
            return (
              <div key={qi} className="inset p-3 space-y-2">
                <div className="text-sm font-semibold text-gray-100">
                  {qi + 1}. {q.question}
                  {answeredQ && <span className={`ml-2 text-xs ${isCorrect ? 'text-emerald-400' : 'text-red-400'}`}>{isCorrect ? t('knowledge.lesson.correct', '✔ ถูกต้อง!') : t('knowledge.lesson.wrong', '✘ ยังไม่ถูก')}</span>}
                </div>
                <div className="space-y-1">
                  {q.options.map((opt, oi) => {
                    let cls = 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500';
                    if (answeredQ) {
                      if (oi === q.answer) cls = 'bg-emerald-500/15 border-emerald-500/60 text-emerald-300';
                      else if (oi === picked) cls = 'bg-red-500/15 border-red-500/60 text-red-300';
                      else cls = 'bg-gray-800/50 border-gray-800 text-gray-500';
                    }
                    return (
                      <button
                        key={oi}
                        onClick={() => pickQuizOption(qi, oi)}
                        disabled={answeredQ}
                        className={`block w-full text-left px-3 py-1.5 rounded text-sm border transition ${cls} disabled:cursor-default`}
                      >
                        {answeredQ && oi === q.answer ? '✔ ' : answeredQ && oi === picked ? '✘ ' : `${oi + 1}. `}{opt}
                      </button>
                    );
                  })}
                </div>
                {answeredQ && q.explanation && (
                  <div className="text-xs text-gray-400 bg-gray-800/50 border border-gray-700 rounded p-2 leading-relaxed">{q.explanation}</div>
                )}
              </div>
            );
          })}
          {quizAnswers.every((a) => a >= 0) && lesson.quiz.length > 0 && (
            <div className="p-3 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-sm text-emerald-300">
              {t('knowledge.lesson.score', 'ได้ {score}/{total} คะแนน — {note}', {
                score: lesson.quiz.filter((_, i) => quizAnswers[i] === lesson.quiz[i].answer).length,
                total: lesson.quiz.length,
                note: lesson.quiz.filter((_, i) => quizAnswers[i] === lesson.quiz[i].answer).length === lesson.quiz.length ? t('knowledge.lesson.perfect', 'เก่งมาก! เรียนจบบทนี้แล้ว') : t('knowledge.lesson.retryHint', 'ลองทบทวนเนื้อหาด้านบนแล้วทำใหม่นะ'),
              })}
              {activeKidId && kids.find((k) => k.id === activeKidId) && t('knowledge.lesson.savedScore', ' — บันทึกคะแนนให้ {name} แล้ว', { name: kids.find((k) => k.id === activeKidId)!.name })}
            </div>
          )}
        </div>
      )}

      {/* แหล่งข้อมูลที่ใช้ */}
      {lesson.sources.length > 0 && (
        <div className="text-[10px] text-gray-600 leading-relaxed">
          {t('knowledge.lesson.sources', 'อ้างอิงจากคลังความรู้: {list}', { list: lesson.sources.filter((s, i, arr) => arr.indexOf(s) === i).join(' · ') })}
        </div>
      )}
    </div>
  );
}
