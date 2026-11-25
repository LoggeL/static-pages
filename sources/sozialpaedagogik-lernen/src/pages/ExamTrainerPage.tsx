import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Award,
  CheckCircle2,
  Filter,
  Play,
  RotateCcw,
  ShieldAlert,
  Shuffle,
  XCircle,
} from 'lucide-react';
import { ALL_UNITS } from '../data/units';
import { CURRICULUM_MODULES } from '../data/modules';
import { useProgress } from '../context/ProgressContext';
import { QuizQuestion } from '../types/curriculum';

type ExamMode = 'abschluss' | 'module' | 'zufall' | 'schwaechen';

interface ExamQuestion extends QuizQuestion {
  unitId: string;
  unitNumber: number;
  unitTitle: string;
  moduleCode: string;
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function isCorrect(q: ExamQuestion, selected: number[]): boolean {
  if (selected.length !== q.correctIndices.length) return false;
  const a = [...selected].sort((x, y) => x - y);
  const b = [...q.correctIndices].sort((x, y) => x - y);
  return a.every((v, i) => v === b[i]);
}

export const ExamTrainerPage: React.FC = () => {
  const { progress } = useProgress();
  const [mode, setMode] = useState<ExamMode>('abschluss');
  const [examModules, setExamModules] = useState<string[]>(['S-SP-2', 'S-SP-4']);
  const [selectedModules, setSelectedModules] = useState<string[]>(['S-SP-1', 'S-SP-2']);
  const [questionCount, setQuestionCount] = useState(20);

  const [sessionQuestions, setSessionQuestions] = useState<ExamQuestion[] | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number[]>>({});
  const [finished, setFinished] = useState(false);

  const allExamQuestions = useMemo<ExamQuestion[]>(() => {
    return ALL_UNITS.flatMap((u) =>
      u.quiz.map((q) => ({
        ...q,
        id: `${u.id}__${q.id}`,
        unitId: u.id,
        unitNumber: u.number,
        unitTitle: u.title,
        moduleCode: u.moduleCode,
      }))
    );
  }, []);

  const weakUnitIds = useMemo(() => {
    return new Set(
      ALL_UNITS.filter((u) => !progress.quizResults[u.id]?.passed).map((u) => u.id)
    );
  }, [progress.quizResults]);

  const toggleExamChoice = (code: string) => {
    setExamModules((prev) => {
      if (prev.includes(code)) {
        return prev.length > 1 ? prev.filter((c) => c !== code) : prev;
      }
      if (prev.length >= 2) {
        return [prev[1], code];
      }
      return [...prev, code];
    });
  };

  const toggleCustomMod = (code: string) => {
    setSelectedModules((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const startSession = () => {
    let pool: ExamQuestion[] = [];
    if (mode === 'abschluss') {
      pool = allExamQuestions.filter((q) => examModules.includes(q.moduleCode));
    } else if (mode === 'module') {
      pool = allExamQuestions.filter((q) => selectedModules.includes(q.moduleCode));
    } else if (mode === 'schwaechen') {
      pool = allExamQuestions.filter((q) => weakUnitIds.has(q.unitId));
    } else {
      pool = allExamQuestions;
    }

    if (!pool.length) return;
    const picked = shuffleArray(pool).slice(0, Math.min(questionCount, pool.length));
    setSessionQuestions(picked);
    setCurrentIdx(0);
    setAnswers({});
    setFinished(false);
  };

  const toggleAnswer = (q: ExamQuestion, optIdx: number) => {
    setAnswers((prev) => {
      const cur = prev[q.id] ?? [];
      if (q.type === 'multi') {
        const next = cur.includes(optIdx)
          ? cur.filter((i) => i !== optIdx)
          : [...cur, optIdx];
        return { ...prev, [q.id]: next };
      }
      return { ...prev, [q.id]: [optIdx] };
    });
  };

  if (sessionQuestions && finished) {
    const correctTotal = sessionQuestions.filter((q) =>
      isCorrect(q, answers[q.id] ?? [])
    ).length;
    const pct = Math.round((correctTotal / sessionQuestions.length) * 100);

    // Aufschlüsselung nach Modul
    const byModule: Record<string, { ok: number; total: number }> = {};
    for (const q of sessionQuestions) {
      if (!byModule[q.moduleCode]) byModule[q.moduleCode] = { ok: 0, total: 0 };
      byModule[q.moduleCode].total++;
      if (isCorrect(q, answers[q.id] ?? [])) byModule[q.moduleCode].ok++;
    }

    return (
      <div className="space-y-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-card dark:border-slate-800 dark:bg-ink-800">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 dark:bg-teal-950/60">
            <Award className="h-8 w-8 text-teal-600" />
          </div>
          <h1 className="mt-3 font-serif text-2xl font-bold text-slate-900 dark:text-white">
            Prüfungsauswertung: {correctTotal} / {sessionQuestions.length} ({pct} %)
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {pct >= 70
              ? 'Starke Leistung! Du liegst sicher über der 70-%-Marke.'
              : 'Nutze die Detailauswertung unten, um gezielt Einheiten nachzuarbeiten.'}
          </p>

          <div className="mt-5 flex flex-wrap justify-center gap-3">
            {Object.entries(byModule).map(([code, stat]) => (
              <div
                key={code}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="font-bold text-slate-900 dark:text-white">{code}</div>
                <div className="text-slate-600 dark:text-slate-400">
                  {stat.ok}/{stat.total} ({Math.round((stat.ok / stat.total) * 100)} %)
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => setSessionQuestions(null)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <Filter className="h-4 w-4" /> Neuen Modus wählen
            </button>
            <button
              type="button"
              onClick={startSession}
              className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2 text-sm font-bold text-white"
            >
              <RotateCcw className="h-4 w-4" /> Neue Zufallsrunde starten
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {sessionQuestions.map((q, i) => {
            const ok = isCorrect(q, answers[q.id] ?? []);
            return (
              <div
                key={q.id}
                className={`rounded-2xl border p-4 text-sm ${
                  ok
                    ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/60 dark:bg-emerald-950/20'
                    : 'border-rose-200 bg-rose-50/50 dark:border-rose-900/60 dark:bg-rose-950/20'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    {ok ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                    )}
                    <div>
                      <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
                        {q.moduleCode} · Einheit {q.unitNumber}: {q.unitTitle}
                      </div>
                      <div className="mt-0.5 font-bold text-slate-900 dark:text-white">
                        {i + 1}. {q.question}
                      </div>
                      <div className="mt-1 text-xs text-slate-700 dark:text-slate-300">
                        <strong>Richtig:</strong>{' '}
                        {q.correctIndices.map((idx) => q.options[idx]).join(' | ')}
                      </div>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                        {q.explanation}
                      </p>
                    </div>
                  </div>
                  <Link
                    to={`/einheit/${q.unitId}`}
                    className="shrink-0 text-xs font-bold text-teal-700 hover:underline dark:text-teal-300"
                  >
                    Zur Einheit →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (sessionQuestions) {
    const q = sessionQuestions[currentIdx];
    const sel = answers[q.id] ?? [];
    const answeredCount = sessionQuestions.filter(
      (item) => (answers[item.id] ?? []).length > 0
    ).length;

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-ink-800">
          <div className="text-sm font-bold">
            Prüfungsfrage {currentIdx + 1} / {sessionQuestions.length}{' '}
            <span className="ml-2 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {q.moduleCode} · E{String(q.unitNumber).padStart(2, '0')}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSessionQuestions(null)}
            className="text-xs font-semibold text-slate-500 hover:underline"
          >
            Abbrechen
          </button>
        </div>

        <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div
            className="h-full bg-teal-600 transition-all"
            style={{
              width: `${Math.round(((currentIdx + 1) / sessionQuestions.length) * 100)}%`,
            }}
          />
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-ink-800">
          <div className="text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300">
            {q.type === 'multi'
              ? 'Mehrfachauswahl (mehrere Antworten)'
              : q.type === 'case'
              ? 'Fallbezogene Prüfungsfrage'
              : 'Single-Choice'}
          </div>
          <h2 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">
            {q.question}
          </h2>

          <div className="mt-4 space-y-2.5">
            {q.options.map((opt, idx) => {
              const active = sel.includes(idx);
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => toggleAnswer(q, idx)}
                  className={`flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left text-sm transition ${
                    active
                      ? 'border-teal-600 bg-teal-50 font-medium text-teal-950 ring-2 ring-teal-500/30 dark:border-teal-500 dark:bg-teal-950/50 dark:text-teal-100'
                      : 'border-slate-200 bg-white text-slate-800 hover:border-teal-300 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border text-xs font-bold ${
                      q.type === 'multi' ? 'rounded-md' : 'rounded-full'
                    } ${
                      active
                        ? 'border-teal-600 bg-teal-600 text-white'
                        : 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {String.fromCharCode(65 + idx)}
                  </span>
                  <span>{opt}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
            <button
              type="button"
              disabled={currentIdx === 0}
              onClick={() => setCurrentIdx(currentIdx - 1)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold disabled:opacity-40 dark:border-slate-700"
            >
              ← Zurück
            </button>

            <span className="text-xs text-slate-500">
              {answeredCount} von {sessionQuestions.length} beantwortet
            </span>

            {currentIdx < sessionQuestions.length - 1 ? (
              <button
                type="button"
                onClick={() => setCurrentIdx(currentIdx + 1)}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white dark:bg-white dark:text-slate-900"
              >
                Nächste Frage →
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setFinished(true)}
                className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700"
              >
                Prüfung abgeben & auswerten ✓
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-ink-800">
        <div className="inline-flex items-center gap-2 rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-800 dark:bg-rose-950/60 dark:text-rose-200">
          <Award className="h-3.5 w-3.5" />
          Übergreifender Prüfungstrainer · {allExamQuestions.length} Fragen verfügbar
        </div>
        <h1 className="mt-2 font-serif text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">
          Prüfungssimulation & Modultests
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Wähle ein Prüfungsformat — inklusive der offiziellen RLP-Abschlussprüfungskonstellation (2 aus S-SP-2, S-SP-3, S-SP-4).
        </p>

        {/* Modi */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <button
            type="button"
            onClick={() => setMode('abschluss')}
            className={`rounded-2xl border p-4 text-left transition ${
              mode === 'abschluss'
                ? 'border-rose-500 bg-rose-50/80 ring-2 ring-rose-500/20 dark:border-rose-600 dark:bg-rose-950/40'
                : 'border-slate-200 bg-paper-50 hover:border-rose-300 dark:border-slate-700 dark:bg-slate-900/40'
            }`}
          >
            <Award className="h-5 w-5 text-rose-600" />
            <div className="mt-2 text-sm font-bold">Abschlussprüfung</div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              2 gewählte Module aus S-SP-2, S-SP-3 oder S-SP-4 (gemäß Fn. 7).
            </p>
          </button>

          <button
            type="button"
            onClick={() => setMode('module')}
            className={`rounded-2xl border p-4 text-left transition ${
              mode === 'module'
                ? 'border-teal-500 bg-teal-50/80 ring-2 ring-teal-500/20 dark:border-teal-600 dark:bg-teal-950/40'
                : 'border-slate-200 bg-paper-50 hover:border-teal-300 dark:border-slate-700 dark:bg-slate-900/40'
            }`}
          >
            <Filter className="h-5 w-5 text-teal-600" />
            <div className="mt-2 text-sm font-bold">Modul-Training</div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Beliebige Lernmodule gezielt kombinieren.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setMode('zufall')}
            className={`rounded-2xl border p-4 text-left transition ${
              mode === 'zufall'
                ? 'border-indigo-500 bg-indigo-50/80 ring-2 ring-indigo-500/20 dark:border-indigo-600 dark:bg-indigo-950/40'
                : 'border-slate-200 bg-paper-50 hover:border-indigo-300 dark:border-slate-700 dark:bg-slate-900/40'
            }`}
          >
            <Shuffle className="h-5 w-5 text-indigo-600" />
            <div className="mt-2 text-sm font-bold">Zufalls-Mix</div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Gemischte Fragen quer durch alle 50 Einheiten.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setMode('schwaechen')}
            className={`rounded-2xl border p-4 text-left transition ${
              mode === 'schwaechen'
                ? 'border-amber-500 bg-amber-50/80 ring-2 ring-amber-500/20 dark:border-amber-600 dark:bg-amber-950/40'
                : 'border-slate-200 bg-paper-50 hover:border-amber-300 dark:border-slate-700 dark:bg-slate-900/40'
            }`}
          >
            <ShieldAlert className="h-5 w-5 text-amber-600" />
            <div className="mt-2 text-sm font-bold">Schwächen-Training</div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              {weakUnitIds.size} Einheiten ohne bestandenes Quiz üben.
            </p>
          </button>
        </div>

        {/* Modus-Konfiguration */}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-900/40">
          {mode === 'abschluss' && (
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                Wähle bis zu 2 Prüfungsmodule (S-SP-2, S-SP-3, S-SP-4):
              </div>
              <div className="flex flex-wrap gap-2">
                {['S-SP-2', 'S-SP-3', 'S-SP-4'].map((code) => {
                  const active = examModules.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggleExamChoice(code)}
                      className={`rounded-xl border px-4 py-2 text-xs font-bold transition ${
                        active
                          ? 'border-rose-600 bg-rose-600 text-white'
                          : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {code}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {mode === 'module' && (
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                Module auswählen:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {CURRICULUM_MODULES.map((m) => {
                  const active = selectedModules.includes(m.code);
                  return (
                    <button
                      key={m.code}
                      type="button"
                      onClick={() => toggleCustomMod(m.code)}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                        active
                          ? 'border-teal-600 bg-teal-600 text-white'
                          : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {m.code}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span>Fragenanzahl:</span>
              {[10, 20, 30].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setQuestionCount(n)}
                  className={`rounded-lg px-2.5 py-1 ${
                    questionCount === n
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                      : 'bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {n} Fragen
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={startSession}
              disabled={
                (mode === 'module' && selectedModules.length === 0) ||
                (mode === 'schwaechen' && weakUnitIds.size === 0)
              }
              className="inline-flex items-center gap-2 rounded-2xl bg-teal-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-teal-700 disabled:opacity-40"
            >
              <Play className="h-4 w-4 fill-current" />
              Prüfungstraining starten
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
