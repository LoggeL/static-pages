import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  BookOpen,
  Briefcase,
  CheckCircle2,
  RotateCcw,
  Users,
  XCircle,
} from 'lucide-react';
import { CaseOption, CaseStudy } from '../../types/curriculum';

interface InteractiveCaseStudyProps {
  caseStudy: CaseStudy;
  isCompleted: boolean;
  onComplete: () => void;
}

const QUALITY_STYLES: Record<
  CaseOption['quality'],
  { label: string; box: string; icon: React.FC<{ className?: string }> }
> = {
  optimal: {
    label: 'Professionell optimal',
    box: 'border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-100',
    icon: CheckCircle2,
  },
  teilweise: {
    label: 'Teilweise zielführend',
    box: 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100',
    icon: AlertTriangle,
  },
  problematisch: {
    label: 'Fachlich problematisch',
    box: 'border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-100',
    icon: XCircle,
  },
};

export const InteractiveCaseStudy: React.FC<InteractiveCaseStudyProps> = ({
  caseStudy,
  isCompleted,
  onComplete,
}) => {
  const [selectedOptions, setSelectedOptions] = useState<Record<number, number>>({});
  const steps = caseStudy.steps;
  const answeredCount = Object.keys(selectedOptions).length;
  const allAnswered = steps.length > 0 && answeredCount === steps.length;

  useEffect(() => {
    if (allAnswered && !isCompleted) {
      onComplete();
    }
  }, [allAnswered, isCompleted, onComplete]);

  const optimalCount = steps.reduce((acc, st, idx) => {
    const chosen = selectedOptions[idx];
    if (chosen !== undefined && st.options[chosen]?.quality === 'optimal') {
      return acc + 1;
    }
    return acc;
  }, 0);

  return (
    <div className="space-y-5">
      {/* Fall-Header */}
      <div className="rounded-3xl border border-amber-200/80 bg-gradient-to-br from-amber-50/90 to-paper-100 p-5 shadow-sm dark:border-amber-900/50 dark:from-amber-950/30 dark:to-ink-800 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-600 px-3 py-1 text-xs font-bold text-white">
            <Briefcase className="h-3.5 w-3.5" />
            Praxis-Fallbeispiel
          </span>
          {(isCompleted || allAnswered) && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Bearbeitet & gespeichert
            </span>
          )}
        </div>

        <h3 className="mt-3 font-serif text-xl font-bold text-slate-900 dark:text-white">
          {caseStudy.title}
        </h3>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/80 px-2.5 py-1 font-semibold text-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
            <Briefcase className="h-3.5 w-3.5 text-amber-600" />
            Setting: {caseStudy.setting}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/80 px-2.5 py-1 font-semibold text-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
            <Users className="h-3.5 w-3.5 text-teal-600" />
            Zielgruppe: {caseStudy.ageGroup}
          </span>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          {caseStudy.context}
        </p>
      </div>

      {/* Entscheidungsschritte */}
      {steps.map((step, stepIdx) => {
        const chosenIdx = selectedOptions[stepIdx];
        const chosenOpt = chosenIdx !== undefined ? step.options[chosenIdx] : null;

        return (
          <div
            key={stepIdx}
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-ink-800 sm:p-6"
          >
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-600 text-white">
                {stepIdx + 1}
              </span>
              Handlungsschritt {stepIdx + 1} von {steps.length}
            </div>

            <div className="mt-3 rounded-2xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-800 dark:bg-slate-900/70 dark:text-slate-200">
              {step.situation}
            </div>

            <p className="mt-4 text-sm font-bold text-slate-900 dark:text-white">
              {step.prompt}
            </p>

            <div className="mt-3 space-y-2.5">
              {step.options.map((opt, optIdx) => {
                const isSelected = chosenIdx === optIdx;
                const style = QUALITY_STYLES[opt.quality];
                return (
                  <button
                    key={optIdx}
                    type="button"
                    onClick={() =>
                      setSelectedOptions((prev) => ({ ...prev, [stepIdx]: optIdx }))
                    }
                    className={`w-full rounded-2xl border p-3.5 text-left text-sm transition ${
                      isSelected
                        ? `${style.box} ring-2 ring-offset-1 ring-slate-400 dark:ring-offset-ink-800`
                        : 'border-slate-200 bg-white text-slate-800 hover:border-teal-400 hover:bg-teal-50/40 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200 dark:hover:border-teal-600'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          isSelected
                            ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {String.fromCharCode(65 + optIdx)}
                      </span>
                      <span className="leading-relaxed">{opt.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <AnimatePresence>
              {chosenOpt && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`mt-4 rounded-2xl border p-4 ${
                    QUALITY_STYLES[chosenOpt.quality].box
                  }`}
                >
                  {(() => {
                    const st = QUALITY_STYLES[chosenOpt.quality];
                    const Icon = st.icon;
                    return (
                      <>
                        <div className="flex items-center gap-2 text-sm font-bold">
                          <Icon className="h-4 w-4 shrink-0" />
                          {st.label}
                        </div>
                        <p className="mt-1.5 text-sm leading-relaxed">
                          {chosenOpt.feedback}
                        </p>
                        <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-white/75 px-2.5 py-1 text-xs font-semibold text-slate-800 dark:bg-slate-900/70 dark:text-slate-200">
                          <BookOpen className="h-3.5 w-3.5 text-teal-600" />
                          Theorie-/Lehrplanbezug: {chosenOpt.theoryLink}
                        </div>
                      </>
                    );
                  })()}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      {/* Zusammenfassung & Reset */}
      {allAnswered && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/40">
          <div>
            <div className="text-sm font-bold text-emerald-900 dark:text-emerald-100">
              Fallanalyse abgeschlossen: {optimalCount} von {steps.length} Schritten optimal gelöst
            </div>
            <div className="text-xs text-emerald-800/80 dark:text-emerald-200/80">
              Du kannst oben jederzeit alternative Handlungsoptionen testen und vergleichen.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSelectedOptions({})}
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-slate-900 dark:text-emerald-200"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Neu durchspielen
          </button>
        </div>
      )}
    </div>
  );
};
