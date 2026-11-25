import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Award,
  CheckCircle2,
  HelpCircle,
  RefreshCw,
  RotateCcw,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { QuizQuestion, QuizResultEntry } from '../../types/curriculum';

interface UnitQuizProps {
  questions: QuizQuestion[];
  savedResult?: QuizResultEntry;
  onSaveResult: (
    score: number,
    total: number,
    answers: Record<string, number[]>
  ) => void;
}

const DIFF_LABELS: Record<QuizQuestion['difficulty'], { label: string; cls: string }> = {
  basis: {
    label: 'Basiswissen',
    cls: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200',
  },
  vertiefung: {
    label: 'Vertiefung',
    cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
  },
  pruefung: {
    label: 'Prüfungsniveau',
    cls: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200',
  },
};

const TYPE_LABELS: Record<QuizQuestion['type'], string> = {
  single: 'Single-Choice',
  multi: 'Mehrfachauswahl (mehrere Antworten richtig)',
  case: 'Fallbezogene Frage',
};

function isAnswerCorrect(q: QuizQuestion, selected: number[]): boolean {
  if (selected.length !== q.correctIndices.length) return false;
  const sortedSel = [...selected].sort((a, b) => a - b);
  const sortedCor = [...q.correctIndices].sort((a, b) => a - b);
  return sortedSel.every((v, idx) => v === sortedCor[idx]);
}

export const UnitQuiz: React.FC<UnitQuizProps> = ({
  questions,
  savedResult,
  onSaveResult,
}) => {
  const [questionPoolIds, setQuestionPoolIds] = useState<string[]>(() =>
    questions.map((q) => q.id)
  );
  const activeQuestions = useMemo(
    () => questions.filter((q) => questionPoolIds.includes(q.id)),
    [questions, questionPoolIds]
  );

  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedMap, setSelectedMap] = useState<Record<string, number[]>>({});
  const [checkedMap, setCheckedMap] = useState<Record<string, boolean>>({});
  const [finished, setFinished] = useState(false);

  const currentQ = activeQuestions[currentIdx] ?? activeQuestions[0];

  if (!questions.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-slate-800 dark:bg-ink-800 dark:text-slate-300">
        Für diese Einheit sind aktuell keine Quizfragen hinterlegt.
      </div>
    );
  }

  const toggleOption = (q: QuizQuestion, optIdx: number) => {
    if (checkedMap[q.id]) return;
    setSelectedMap((prev) => {
      const current = prev[q.id] ?? [];
      if (q.type === 'multi') {
        const next = current.includes(optIdx)
          ? current.filter((i) => i !== optIdx)
          : [...current, optIdx];
        return { ...prev, [q.id]: next };
      }
      return { ...prev, [q.id]: [optIdx] };
    });
  };

  const handleCheck = () => {
    if (!currentQ) return;
    const sel = selectedMap[currentQ.id] ?? [];
    if (!sel.length) return;
    setCheckedMap((prev) => ({ ...prev, [currentQ.id]: true }));
  };

  const handleFinish = () => {
    // Werte Gesamtdurchlauf nur wenn alle Fragen der Einheit gespielt wurden
    const score = activeQuestions.reduce((acc, q) => {
      const sel = selectedMap[q.id] ?? [];
      return acc + (isAnswerCorrect(q, sel) ? 1 : 0);
    }, 0);
    if (activeQuestions.length === questions.length) {
      onSaveResult(score, questions.length, selectedMap);
    }
    setFinished(true);
  };

  const startRetryAll = () => {
    setQuestionPoolIds(questions.map((q) => q.id));
    setCurrentIdx(0);
    setSelectedMap({});
    setCheckedMap({});
    setFinished(false);
  };

  const startRetryWrongOnly = () => {
    const wrongIds = activeQuestions
      .filter((q) => !isAnswerCorrect(q, selectedMap[q.id] ?? []))
      .map((q) => q.id);
    if (!wrongIds.length) {
      startRetryAll();
      return;
    }
    setQuestionPoolIds(wrongIds);
    setCurrentIdx(0);
    setSelectedMap({});
    setCheckedMap({});
    setFinished(false);
  };

  const currentSelected = currentQ ? selectedMap[currentQ.id] ?? [] : [];
  const isChecked = currentQ ? Boolean(checkedMap[currentQ.id]) : false;
  const isCurrentCorrect = currentQ
    ? isAnswerCorrect(currentQ, currentSelected)
    : false;

  const scoreNow = activeQuestions.reduce(
    (acc, q) => acc + (isAnswerCorrect(q, selectedMap[q.id] ?? []) ? 1 : 0),
    0
  );
  const percentNow =
    activeQuestions.length > 0
      ? Math.round((scoreNow / activeQuestions.length) * 100)
      : 0;
  const passedNow = percentNow >= 70;
  const wrongCount = activeQuestions.length - scoreNow;

  if (finished) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-soft dark:border-slate-800 dark:bg-ink-800"
      >
        <div
          className={`rounded-2xl border p-6 text-center ${
            passedNow
              ? 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 dark:border-emerald-800 dark:from-emerald-950/50 dark:to-teal-950/40'
              : 'border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 dark:border-amber-800 dark:from-amber-950/40 dark:to-orange-950/30'
          }`}
        >
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm dark:bg-slate-900">
            {passedNow ? (
              <Award className="h-8 w-8 text-emerald-600" />
            ) : (
              <Sparkles className="h-8 w-8 text-amber-600" />
            )}
          </div>
          <h3 className="mt-3 font-serif text-2xl font-bold text-slate-900 dark:text-white">
            {passedNow ? 'Quiz bestanden!' : 'Weiter üben lohnt sich!'}
          </h3>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
            Du hast <strong>{scoreNow}</strong> von{' '}
            <strong>{activeQuestions.length}</strong> Fragen richtig beantwortet (
            <strong>{percentNow} %</strong>). Bestehensgrenze: 70 %.
          </p>
          {savedResult && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/80 px-3.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
              Gespeicherter Bestwert: {savedResult.bestScore}/{savedResult.total} (
              {Math.round((savedResult.bestScore / savedResult.total) * 100)} %) · Versuche:{' '}
              {savedResult.attempts}
            </div>
          )}
        </div>

        {/* Review aller Antworten */}
        <div className="space-y-2.5">
          <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Detailauswertung
          </h4>
          {activeQuestions.map((q, i) => {
            const ok = isAnswerCorrect(q, selectedMap[q.id] ?? []);
            return (
              <div
                key={q.id}
                className={`rounded-2xl border p-3.5 text-sm ${
                  ok
                    ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/60 dark:bg-emerald-950/25'
                    : 'border-rose-200 bg-rose-50/50 dark:border-rose-900/60 dark:bg-rose-950/25'
                }`}
              >
                <div className="flex items-start gap-2">
                  {ok ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  )}
                  <div className="space-y-1">
                    <div className="font-semibold text-slate-900 dark:text-white">
                      {i + 1}. {q.question}
                    </div>
                    <div className="text-xs text-slate-700 dark:text-slate-300">
                      <span className="font-semibold">Richtige Antwort: </span>
                      {q.correctIndices.map((idx) => q.options[idx]).join(' | ')}
                    </div>
                    <div className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      {q.explanation}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {wrongCount > 0 && (
            <button
              type="button"
              onClick={startRetryWrongOnly}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200"
            >
              <RefreshCw className="h-4 w-4" />
              Nur Fehler wiederholen ({wrongCount})
            </button>
          )}
          <button
            type="button"
            onClick={startRetryAll}
            className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
          >
            <RotateCcw className="h-4 w-4" />
            Gesamtes Quiz neu starten
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Kopfzeile mit Bestwert & Fortschritt */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-ink-800">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
          <HelpCircle className="h-4 w-4 text-teal-600" />
          Frage {currentIdx + 1} von {activeQuestions.length}
        </div>

        <div className="flex items-center gap-3">
          {savedResult && (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              Bestwert: {savedResult.bestScore}/{savedResult.total} (
              {Math.round((savedResult.bestScore / savedResult.total) * 100)} %)
            </span>
          )}
        </div>
      </div>

      {/* Fortschrittsbalken */}
      <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 transition-all duration-300"
          style={{
            width: `${Math.round(((currentIdx + 1) / activeQuestions.length) * 100)}%`,
          }}
        />
      </div>

      {/* Fragen-Karte */}
      {currentQ && (
        <AnimatePresence mode="wait">
          <motion.div
            key={currentQ.id}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.18 }}
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-ink-800 sm:p-6"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  DIFF_LABELS[currentQ.difficulty].cls
                }`}
              >
                {DIFF_LABELS[currentQ.difficulty].label}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {TYPE_LABELS[currentQ.type]}
              </span>
            </div>

            <h3 className="mt-3 text-base font-bold leading-snug text-slate-900 dark:text-white sm:text-lg">
              {currentQ.question}
            </h3>

            <div className="mt-4 space-y-2.5">
              {currentQ.options.map((opt, optIdx) => {
                const isSelected = currentSelected.includes(optIdx);
                const isCorrectOpt = currentQ.correctIndices.includes(optIdx);

                let btnClass =
                  'border-slate-200 bg-white text-slate-800 hover:border-teal-400 hover:bg-teal-50/40 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200';
                if (!isChecked && isSelected) {
                  btnClass =
                    'border-teal-600 bg-teal-50 text-teal-950 ring-2 ring-teal-500/30 dark:border-teal-500 dark:bg-teal-950/50 dark:text-teal-100';
                } else if (isChecked) {
                  if (isCorrectOpt) {
                    btnClass =
                      'border-emerald-500 bg-emerald-50 text-emerald-950 dark:border-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-100';
                  } else if (isSelected && !isCorrectOpt) {
                    btnClass =
                      'border-rose-500 bg-rose-50 text-rose-950 dark:border-rose-600 dark:bg-rose-950/50 dark:text-rose-100';
                  } else {
                    btnClass =
                      'border-slate-200 bg-slate-50/60 text-slate-500 dark:border-slate-800 dark:bg-slate-900/30 dark:text-slate-500';
                  }
                }

                return (
                  <button
                    key={optIdx}
                    type="button"
                    disabled={isChecked}
                    onClick={() => toggleOption(currentQ, optIdx)}
                    className={`flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left text-sm transition ${btnClass}`}
                  >
                    <span
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border text-xs font-bold ${
                        currentQ.type === 'multi' ? 'rounded-md' : 'rounded-full'
                      } ${
                        isSelected
                          ? 'border-teal-600 bg-teal-600 text-white'
                          : 'border-slate-300 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {String.fromCharCode(65 + optIdx)}
                    </span>
                    <span className="flex-1 leading-relaxed">{opt}</span>
                    {isChecked && isCorrectOpt && (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                    )}
                    {isChecked && isSelected && !isCorrectOpt && (
                      <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Feedback nach Überprüfung */}
            <AnimatePresence>
              {isChecked && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`mt-4 rounded-2xl border p-4 text-sm ${
                    isCurrentCorrect
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100'
                      : 'border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100'
                  }`}
                >
                  <div className="font-bold">
                    {isCurrentCorrect ? 'Richtig beantwortet!' : 'Nicht ganz richtig'}
                  </div>
                  <p className="mt-1 leading-relaxed">{currentQ.explanation}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Aktionsbuttons */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
              <div className="flex gap-1.5">
                {activeQuestions.map((q, idx) => {
                  const done = Boolean(checkedMap[q.id]);
                  const ok = done && isAnswerCorrect(q, selectedMap[q.id] ?? []);
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => setCurrentIdx(idx)}
                      className={`h-2.5 w-6 rounded-full transition ${
                        idx === currentIdx
                          ? 'bg-slate-900 dark:bg-white'
                          : done
                          ? ok
                            ? 'bg-emerald-500'
                            : 'bg-rose-400'
                          : 'bg-slate-200 dark:bg-slate-700'
                      }`}
                      aria-label={`Zu Frage ${idx + 1}`}
                    />
                  );
                })}
              </div>

              {!isChecked ? (
                <button
                  type="button"
                  disabled={currentSelected.length === 0}
                  onClick={handleCheck}
                  className="rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Antwort prüfen
                </button>
              ) : currentIdx < activeQuestions.length - 1 ? (
                <button
                  type="button"
                  onClick={() => setCurrentIdx(currentIdx + 1)}
                  className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900"
                >
                  Nächste Frage →
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleFinish}
                  className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700"
                >
                  Quiz auswerten & speichern ✓
                </button>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
};
