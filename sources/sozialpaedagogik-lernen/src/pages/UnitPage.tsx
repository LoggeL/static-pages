import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpen,
  Briefcase,
  CheckCircle2,
  Clock,
  FileText,
  HelpCircle,
  Layers,
  Lightbulb,
  PenLine,
  Target,
} from 'lucide-react';
import { ALL_UNITS, UNITS_BY_ID } from '../data/units';
import { MODULES_BY_CODE } from '../data/modules';
import { useProgress } from '../context/ProgressContext';
import { getUnitCompletionStatus } from '../lib/storage';
import { VisualBlockRenderer } from '../components/visuals/VisualBlockRenderer';
import { InteractiveCaseStudy } from '../components/visuals/InteractiveCaseStudy';
import { FlashcardDeck } from '../components/learning/FlashcardDeck';
import { UnitQuiz } from '../components/learning/UnitQuiz';
import { UnitNotes } from '../components/learning/UnitNotes';

type UnitTab = 'wissen' | 'fall' | 'karten' | 'quiz' | 'notizen';

export const UnitPage: React.FC = () => {
  const { unitId } = useParams<{ unitId: string }>();
  const unit = unitId ? UNITS_BY_ID[unitId] : undefined;

  const {
    progress,
    toggleUnitComplete,
    markSectionRead,
    saveQuizResult,
    toggleFlashcardMastery,
    markCaseStudyComplete,
    toggleBookmark,
    saveNote,
    setLastVisitedUnit,
  } = useProgress();

  const [activeTab, setActiveTab] = useState<UnitTab>('wissen');

  useEffect(() => {
    if (unit) {
      setLastVisitedUnit(unit.id);
      setActiveTab('wissen');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [unit, setLastVisitedUnit]);

  if (!unit) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-ink-800">
        <h2 className="font-serif text-2xl font-bold">Lerneinheit nicht gefunden</h2>
        <Link
          to="/"
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-bold text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Zurück zur Übersicht
        </Link>
      </div>
    );
  }

  const modMeta = MODULES_BY_CODE[unit.moduleCode];
  const status = getUnitCompletionStatus(unit, progress);
  const isCompleted = status === 'completed';
  const isBookmarked = progress.bookmarks.includes(unit.id);
  const quizResult = progress.quizResults[unit.id];
  const mastery = progress.flashcardMastery[unit.id] ?? [];
  const masteredCount = unit.flashcards.filter((_, i) => Boolean(mastery[i])).length;
  const caseDone = Boolean(progress.caseStudyCompleted[unit.id]);
  const readSections = progress.sectionsRead[unit.id] ?? [];

  const unitIdx = ALL_UNITS.findIndex((u) => u.id === unit.id);
  const prevUnit = unitIdx > 0 ? ALL_UNITS[unitIdx - 1] : null;
  const nextUnit = unitIdx < ALL_UNITS.length - 1 ? ALL_UNITS[unitIdx + 1] : null;

  const tabs: Array<{
    id: UnitTab;
    label: string;
    badge?: string;
    icon: React.FC<{ className?: string }>;
  }> = [
    {
      id: 'wissen',
      label: 'Wissen & Visualisierungen',
      badge: `${unit.visualBlocks.length} Grafiken`,
      icon: BookOpen,
    },
    {
      id: 'fall',
      label: 'Praxis-Fallbeispiel',
      badge: caseDone ? '✓ Gelöst' : `${unit.caseStudy.steps.length} Schritte`,
      icon: Briefcase,
    },
    {
      id: 'karten',
      label: 'Lernkarten',
      badge: `${masteredCount}/${unit.flashcards.length}`,
      icon: Layers,
    },
    {
      id: 'quiz',
      label: 'Einheiten-Quiz',
      badge: quizResult
        ? `${Math.round((quizResult.bestScore / quizResult.total) * 100)}%`
        : `${unit.quiz.length} Fragen`,
      icon: HelpCircle,
    },
    {
      id: 'notizen',
      label: 'Selbstlernen & Notizen',
      badge: progress.notes[unit.id]?.trim() ? 'Notiz ✓' : undefined,
      icon: PenLine,
    },
  ];

  // Verzahne Theorie-Abschnitte und Visualisierungs-Blöcke
  const pairedCount = Math.max(unit.sections.length, unit.visualBlocks.length);

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link to="/" className="font-semibold hover:text-teal-600">
            Übersicht
          </Link>
          <span>/</span>
          <Link
            to={`/?modul=${encodeURIComponent(unit.moduleCode)}`}
            className="font-semibold hover:text-teal-600"
          >
            {unit.moduleCode}
          </Link>
          <span>/</span>
          <span className="font-bold text-slate-800 dark:text-slate-200">
            Einheit {unit.number}
          </span>
        </div>

        <span className="inline-flex items-center gap-1">
          <FileText className="h-3.5 w-3.5" /> Lehrplan PDF {unit.pdfPages}
        </span>
      </div>

      {/* Einheiten-Header */}
      <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-ink-800 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-extrabold text-white dark:bg-slate-100 dark:text-slate-900">
                Einheit {String(unit.number).padStart(2, '0')} / 50
              </span>
              {modMeta && (
                <span className={`rounded-lg px-2.5 py-1 text-xs font-bold ${modMeta.badgeClass}`}>
                  {unit.moduleCode} · {modMeta.shortTitle}
                </span>
              )}
              {unit.bildungsbereich && (
                <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-800 dark:bg-rose-950/60 dark:text-rose-200">
                  Bildungsbereich: {unit.bildungsbereich}
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {unit.year}
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                <Clock className="h-3.5 w-3.5" /> ca. {unit.estimatedMinutes} Min. · {unit.hoursRef}
              </span>
            </div>

            <h1 className="font-serif text-2xl font-bold leading-tight text-slate-900 dark:text-white sm:text-3xl">
              {unit.title}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 sm:text-base">
              {unit.subtitle}
            </p>
            <p className="max-w-3xl text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {unit.summary}
            </p>

            <div className="flex flex-wrap gap-1.5 pt-1">
              {unit.crossCuttingTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-paper-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  #{tag}
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => toggleBookmark(unit.id)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                isBookmarked
                  ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
              }`}
            >
              <Bookmark className={`h-4 w-4 ${isBookmarked ? 'fill-current' : ''}`} />
              {isBookmarked ? 'Gemerkt' : 'Merken'}
            </button>

            <button
              type="button"
              onClick={() => toggleUnitComplete(unit.id)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold shadow-sm transition ${
                isCompleted
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900'
              }`}
            >
              <CheckCircle2 className="h-4 w-4" />
              {isCompleted ? 'Abgeschlossen ✓' : 'Als erledigt markieren'}
            </button>
          </div>
        </div>
      </header>

      {/* Tab-Leiste */}
      <nav
        className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-soft dark:border-slate-800 dark:bg-ink-800"
        aria-label="Einheiten-Bereiche"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-bold transition sm:text-sm ${
                active
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
              {tab.badge && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    active
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Tab Content */}
      {activeTab === 'wissen' && (
        <div className="space-y-6">
          {/* Lernziele */}
          <section className="rounded-3xl border border-teal-200/80 bg-gradient-to-br from-teal-50/70 to-emerald-50/50 p-5 dark:border-teal-900/50 dark:from-teal-950/35 dark:to-emerald-950/20 sm:p-6">
            <div className="flex items-center gap-2 text-sm font-bold text-teal-900 dark:text-teal-200">
              <Target className="h-4 w-4 text-teal-600" />
              Kompetenz- & Lernziele dieser Einheit
            </div>
            <ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              {unit.learningGoals.map((goal, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 rounded-xl bg-white/80 p-3 text-sm text-slate-800 shadow-sm dark:bg-slate-900/60 dark:text-slate-200"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
                  <span>{goal}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Verzahnte Theorie-Abschnitte & Interaktive Visualisierungen */}
          {Array.from({ length: pairedCount }).map((_, idx) => {
            const sec = unit.sections[idx];
            const visual = unit.visualBlocks[idx];
            const secRead = readSections.includes(idx);

            return (
              <div key={idx} className="space-y-6">
                {sec && (
                  <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-ink-800 sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-teal-600 text-xs font-extrabold text-white">
                          {idx + 1}
                        </span>
                        <h2 className="font-serif text-xl font-bold text-slate-900 dark:text-white">
                          {sec.heading}
                        </h2>
                      </div>
                      <button
                        type="button"
                        onClick={() => markSectionRead(unit.id, idx)}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                          secRead
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200'
                            : 'bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {secRead ? 'Gelesen ✓' : 'Als gelesen markieren'}
                      </button>
                    </div>

                    {/* Merksatz */}
                    <div className="mt-3 rounded-2xl border-l-4 border-teal-500 bg-teal-50/70 px-4 py-3 text-sm font-semibold text-teal-950 dark:bg-teal-950/35 dark:text-teal-100">
                      Merksatz: {sec.keyTakeaway}
                    </div>

                    <p className="mt-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300 sm:text-base">
                      {sec.body}
                    </p>

                    <ul className="mt-3 space-y-1.5">
                      {sec.bulletPoints.map((bp, bIdx) => (
                        <li
                          key={bIdx}
                          className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300"
                        >
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
                          <span>{bp}</span>
                        </li>
                      ))}
                    </ul>

                    {sec.praxisTip && (
                      <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-amber-200/80 bg-amber-50/80 p-3.5 text-xs leading-relaxed text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100 sm:text-sm">
                        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                        <div>
                          <span className="font-bold">Praxis-Impuls: </span>
                          {sec.praxisTip}
                        </div>
                      </div>
                    )}
                  </article>
                )}

                {visual && <VisualBlockRenderer block={visual} />}
              </div>
            );
          })}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setActiveTab('fall')}
              className="inline-flex items-center gap-2 rounded-2xl bg-teal-600 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-teal-700"
            >
              Weiter zum Praxis-Fallbeispiel <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {activeTab === 'fall' && (
        <InteractiveCaseStudy
          caseStudy={unit.caseStudy}
          isCompleted={caseDone}
          onComplete={() => markCaseStudyComplete(unit.id)}
        />
      )}

      {activeTab === 'karten' && (
        <FlashcardDeck
          cards={unit.flashcards}
          mastery={mastery}
          onToggleMastery={(cardIdx, mastered) =>
            toggleFlashcardMastery(unit.id, cardIdx, mastered)
          }
        />
      )}

      {activeTab === 'quiz' && (
        <UnitQuiz
          questions={unit.quiz}
          savedResult={quizResult}
          onSaveResult={(score, total, answers) =>
            saveQuizResult(unit.id, score, total, answers)
          }
        />
      )}

      {activeTab === 'notizen' && (
        <UnitNotes
          unitId={unit.id}
          initialNote={progress.notes[unit.id] ?? ''}
          selfLearningTasks={unit.selfLearningTasks}
          onSaveNote={(txt) => saveNote(unit.id, txt)}
        />
      )}

      {/* Untere Einheiten-Navigation */}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5 dark:border-slate-800">
        {prevUnit ? (
          <Link
            to={`/einheit/${prevUnit.id}`}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-ink-800 dark:text-slate-200"
          >
            <ArrowLeft className="h-4 w-4" />
            E{String(prevUnit.number).padStart(2, '0')}: {prevUnit.title}
          </Link>
        ) : (
          <span />
        )}

        <Link
          to="/"
          className="text-xs font-bold text-slate-500 hover:text-teal-600 dark:text-slate-400"
        >
          Zur Modulübersicht
        </Link>

        {nextUnit ? (
          <Link
            to={`/einheit/${nextUnit.id}`}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900"
          >
            E{String(nextUnit.number).padStart(2, '0')}: {nextUnit.title}
            <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <span />
        )}
      </footer>
    </div>
  );
};
