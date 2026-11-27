import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Award,
  Briefcase,
  CheckCircle2,
  Filter,
  Play,
  RotateCcw,
  ShieldAlert,
  Shuffle,
  XCircle,
} from 'lucide-react';
import { ALL_UNITS } from '../data/units';
import { CURRICULUM_MODULES, MODULES_BY_CODE } from '../data/modules';
import { useProgress } from '../context/ProgressContext';
import { getOrderedModulesForLearningPath } from '../lib/learning';
import {
  buildExamQuestionBank,
  filterExamQuestions,
  getWeakCoreUnitIds,
  isExamAnswerCorrect,
  selectBalancedExamQuestions,
  type ExamFocus,
  type ExamMode,
  type ExamQuestion,
} from '../lib/exam';

const WRITTEN_EXAM_MODULES = ['S-SP-2', 'S-SP-3', 'S-SP-4'] as const;

export const ExamTrainerPage: React.FC = () => {
  const { progress } = useProgress();
  const [mode, setMode] = useState<ExamMode>('abschluss');
  const [focus, setFocus] = useState<ExamFocus>('alle');
  const [examModules, setExamModules] = useState<string[]>(['S-SP-2', 'S-SP-4']);
  const [selectedModules, setSelectedModules] = useState<string[]>(['S-SP-2', 'S-SP-3']);
  const [questionCount, setQuestionCount] = useState(20);

  const [sessionQuestions, setSessionQuestions] = useState<ExamQuestion[] | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number[]>>({});
  const [finished, setFinished] = useState(false);

  const { coreModules } = useMemo(
    () => getOrderedModulesForLearningPath(CURRICULUM_MODULES),
    []
  );

  const allExamQuestions = useMemo<ExamQuestion[]>(
    () => buildExamQuestionBank(ALL_UNITS, false),
    []
  );

  const weakUnitIds = useMemo(
    () => getWeakCoreUnitIds(ALL_UNITS, progress),
    [progress]
  );

  const filteredPool = useMemo(
    () =>
      filterExamQuestions(allExamQuestions, {
        mode,
        examModules,
        selectedModules,
        weakUnitIds,
        focus,
      }),
    [allExamQuestions, mode, examModules, selectedModules, weakUnitIds, focus]
  );

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
    if (!filteredPool.length) return;
    const picked = selectBalancedExamQuestions(filteredPool, questionCount);
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
      isExamAnswerCorrect(q, answers[q.id] ?? [])
    ).length;
    const pct = Math.round((correctTotal / sessionQuestions.length) * 100);

    const byModule: Record<string, { ok: number; total: number }> = {};
    for (const q of sessionQuestions) {
      if (!byModule[q.moduleCode]) byModule[q.moduleCode] = { ok: 0, total: 0 };
      byModule[q.moduleCode].total++;
      if (isExamAnswerCorrect(q, answers[q.id] ?? [])) byModule[q.moduleCode].ok++;
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
              ? 'Starke Leistung! Du wendest das Fachwissen sicher oberhalb der 70-%-Marke an.'
              : 'Nutze die Detailauswertung unten, um gezielt Fachthemen und Fallbeispiele zu vertiefen.'}
          </p>

          <div className="mt-5 flex flex-wrap justify-center gap-3">
            {Object.entries(byModule).map(([code, stat]) => {
              const modMeta = MODULES_BY_CODE[code];
              return (
                <div
                  key={code}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                >
                  <div className="font-bold text-slate-900 dark:text-white">
                    {code}
                    {modMeta ? ` · ${modMeta.shortTitle}` : ''}
                  </div>
                  <div className="text-slate-600 dark:text-slate-400">
                    {stat.ok}/{stat.total} ({Math.round((stat.ok / stat.total) * 100)} %)
                  </div>
                </div>
              );
            })}
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
              <RotateCcw className="h-4 w-4" /> Neue Runde starten
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {sessionQuestions.map((q, i) => {
            const chosen = answers[q.id] ?? [];
            const ok = isExamAnswerCorrect(q, chosen);
            return (
              <div
                key={q.id}
                className={`rounded-2xl border p-4 text-sm ${
                  ok
                    ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/60 dark:bg-emerald-950/20'
                    : 'border-rose-200 bg-rose-50/50 dark:border-rose-900/60 dark:bg-rose-950/20'
                }`}
              >
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                  <div className="flex items-start gap-2">
                    {ok ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
                        {q.moduleCode} · Einheit {q.unitNumber}: {q.unitTitle}
                      </div>
                      <div className="mt-0.5 font-bold text-slate-900 dark:text-white">
                        {i + 1}. {q.question}
                      </div>
                      {!ok && (
                        <div className="mt-1 text-xs text-rose-800 dark:text-rose-200">
                          <strong>Deine Wahl:</strong>{' '}
                          {chosen.length > 0
                            ? chosen.map((idx) => q.options[idx]).join(' | ')
                            : 'Nicht beantwortet'}
                        </div>
                      )}
                      <div className="mt-1 text-xs text-slate-700 dark:text-slate-300">
                        <strong>Richtig:</strong>{' '}
                        {q.correctIndices.map((idx) => q.options[idx]).join(' | ')}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                        {q.explanation}
                      </p>
                    </div>
                  </div>
                  <Link
                    to={`/einheit/${q.unitId}`}
                    className="shrink-0 self-start text-xs font-bold text-teal-700 hover:underline dark:text-teal-300"
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

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-ink-800 sm:p-6">
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300">
            <span>
              {q.type === 'multi'
                ? 'Mehrfachauswahl (mehrere Antworten)'
                : q.type === 'case'
                ? 'Fallbezogene Prüfungsfrage'
                : 'Single-Choice'}
            </span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span className="normal-case font-semibold text-slate-500 dark:text-slate-400">
              {q.unitTitle}
            </span>
          </div>
          <h2 className="mt-2 text-base font-bold leading-snug text-slate-900 dark:text-white sm:text-lg">
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
                  <span className="min-w-0 flex-1 break-words leading-relaxed">{opt}</span>
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
                Prüfung abgeben &amp; auswerten ✓
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-ink-800 sm:p-6">
        <div className="inline-flex items-center gap-2 rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-800 dark:bg-rose-950/60 dark:text-rose-200">
          <Award className="h-3.5 w-3.5" />
          Fachlicher Prüfungstrainer · {allExamQuestions.length} Fach- &amp; Fallfragen
        </div>
        <h1 className="mt-2 font-serif text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">
          Prüfungssimulation &amp; Fallanwendung
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
          Trainiere gezielt sozialpädagogisches Fachwissen, Rechtsgrundlagen und pädagogische Fallentscheidungen aus den Fachmodulen — ohne Auswendiglernen von Stundentafel-Zahlen oder Lehrplan-Seitenzahlen.
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
              2 gewählte Kernmodule (Beziehung, Diversität oder Bildungsbereiche).
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
              Beliebige Fachmodule gezielt kombinieren und üben.
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
            <div className="mt-2 text-sm font-bold">Fach-Mix</div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Ausgewogener Mix aus allen 13 fachlichen Lernmodulen.
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
              {weakUnitIds.size} fachliche Einheiten ohne bestandenes Quiz gezielt üben.
            </p>
          </button>
        </div>

        {/* Modus-Konfiguration */}
        <div className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-900/40">
          {mode === 'abschluss' && (
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                Wähle bis zu 2 schriftliche Prüfungsmodule:
              </div>
              <div className="flex flex-wrap gap-2">
                {WRITTEN_EXAM_MODULES.map((code) => {
                  const active = examModules.includes(code);
                  const mod = MODULES_BY_CODE[code];
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggleExamChoice(code)}
                      className={`rounded-xl border px-3.5 py-2 text-xs font-bold transition ${
                        active
                          ? 'border-rose-600 bg-rose-600 text-white'
                          : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {code} · {mod?.shortTitle ?? code}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {mode === 'module' && (
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                Fachmodule auswählen:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {coreModules.map((m) => {
                  const active = selectedModules.includes(m.code);
                  return (
                    <button
                      key={m.code}
                      type="button"
                      onClick={() => toggleCustomMod(m.code)}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                        active
                          ? 'border-teal-600 bg-teal-600 text-white'
                          : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {m.code} · {m.shortTitle}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Inhaltlicher Schwerpunkt */}
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200/80 pt-3 dark:border-slate-700/80">
            <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-700 dark:text-slate-200">
              <Briefcase className="h-3.5 w-3.5 text-teal-600" /> Schwerpunkt:
            </span>
            {(
              [
                { id: 'alle', label: 'Alle Fachfragen (ausgewogen)' },
                { id: 'case', label: 'Nur Praxisfälle' },
                { id: 'pruefung', label: 'Prüfungsniveau & Fälle' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFocus(opt.id)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  focus === opt.id
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 pt-3 dark:border-slate-700/80">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
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
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                ({filteredPool.length} passende Fragen im Pool)
              </span>
            </div>

            <button
              type="button"
              onClick={startSession}
              disabled={filteredPool.length === 0}
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
