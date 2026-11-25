import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Award,
  Bookmark,
  CheckCircle2,
  Clock,
  Filter,
  Flame,
  Layers,
  Play,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { ALL_UNITS, UNITS_BY_ID } from '../data/units';
import {
  CROSS_CUTTING_THEMES,
  CURRICULUM_MODULES,
  MODULE_AREAS,
} from '../data/modules';
import { useProgress } from '../context/ProgressContext';
import {
  getModuleProgress,
  getOverallStats,
  getUnitCompletionStatus,
} from '../lib/storage';
import { ProgressRing } from '../components/learning/ProgressRing';
import { CrossCuttingTag, YearAllocation } from '../types/curriculum';

type StatusFilter = 'alle' | 'offen' | 'in_arbeit' | 'abgeschlossen' | 'gemerkt';

export const DashboardPage: React.FC = () => {
  const { progress, toggleBookmark } = useProgress();
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQuery] = useState('');
  const [selectedModule, setSelectedModule] = useState<string>(
    () => searchParams.get('modul') || 'alle'
  );
  const [selectedYear, setSelectedYear] = useState<'alle' | YearAllocation>('alle');
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('alle');
  const [selectedTag, setSelectedTag] = useState<'alle' | CrossCuttingTag>('alle');

  const stats = useMemo(() => getOverallStats(ALL_UNITS, progress), [progress]);
  const resumeUnit =
    (progress.lastVisitedUnitId && UNITS_BY_ID[progress.lastVisitedUnitId]) ||
    ALL_UNITS[0];

  const handleModuleChange = (code: string) => {
    setSelectedModule(code);
    if (code === 'alle') {
      searchParams.delete('modul');
      setSearchParams(searchParams, { replace: true });
    } else {
      setSearchParams({ modul: code }, { replace: true });
    }
  };

  const filteredUnits = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ALL_UNITS.filter((u) => {
      if (selectedModule !== 'alle' && u.moduleCode !== selectedModule) return false;
      if (selectedYear !== 'alle' && u.year !== selectedYear) return false;
      if (selectedTag !== 'alle' && !u.crossCuttingTags.includes(selectedTag))
        return false;

      const status = getUnitCompletionStatus(u, progress);
      if (selectedStatus === 'offen' && status !== 'not_started') return false;
      if (selectedStatus === 'in_arbeit' && status !== 'in_progress') return false;
      if (selectedStatus === 'abgeschlossen' && status !== 'completed') return false;
      if (selectedStatus === 'gemerkt' && !progress.bookmarks.includes(u.id))
        return false;

      if (q) {
        const hay = [
          u.title,
          u.subtitle,
          u.moduleCode,
          u.bildungsbereich ?? '',
          u.summary,
          ...u.flashcards.map((c) => c.term),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [query, selectedModule, selectedYear, selectedTag, selectedStatus, progress]);

  const activeFiltersCount =
    (selectedModule !== 'alle' ? 1 : 0) +
    (selectedYear !== 'alle' ? 1 : 0) +
    (selectedStatus !== 'alle' ? 1 : 0) +
    (selectedTag !== 'alle' ? 1 : 0) +
    (query.trim() ? 1 : 0);

  const resetFilters = () => {
    setQuery('');
    handleModuleChange('alle');
    setSelectedYear('alle');
    setSelectedStatus('alle');
    setSelectedTag('alle');
  };

  return (
    <div className="space-y-8">
      {/* Hero Banner */}
      <section className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white via-paper-50 to-teal-50/70 p-6 shadow-card dark:border-slate-800 dark:from-ink-800 dark:via-ink-800 dark:to-teal-950/35 sm:p-8">
        <div className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
          <div className="max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-teal-100 px-3 py-1 text-xs font-bold text-teal-900 dark:bg-teal-900/60 dark:text-teal-200">
              <Sparkles className="h-3.5 w-3.5" />
              Lehrplan Rheinland-Pfalz (25.09.2024) · Bachelor Professional in Sozialwesen
            </div>
            <h1 className="font-serif text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl lg:text-4xl">
              Dein interaktiver Lernbegleiter für die Fachschule Sozialpädagogik
            </h1>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300 sm:text-base">
              Alle <strong>50 Lerneinheiten</strong> decken den gesamten 60-seitigen Lehrplan ab — mit{' '}
              <strong>150 interaktiven Visualisierungen</strong>, realistischen Praxis-Fallbeispielen, Lernkarten und prüfungsnahen Quizzes mit automatischer Speicherung im{' '}
              <code className="rounded bg-slate-200/70 px-1.5 py-0.5 text-xs dark:bg-slate-800">
                localStorage
              </code>
              .
            </p>

            {resumeUnit && (
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link
                  to={`/einheit/${resumeUnit.id}`}
                  className="inline-flex items-center gap-2 rounded-2xl bg-teal-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-teal-700"
                >
                  <Play className="h-4 w-4 fill-current" />
                  {progress.lastVisitedUnitId ? 'Weiterlernen:' : 'Starten mit:'} E
                  {String(resumeUnit.number).padStart(2, '0')} · {resumeUnit.title}
                </Link>
                <Link
                  to="/pruefung"
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <Award className="h-4 w-4 text-rose-500" />
                  Prüfungstrainer öffnen
                </Link>
              </div>
            )}
          </div>

          <div className="flex items-center gap-5 self-center rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 lg:self-auto">
            <ProgressRing percent={stats.overallPercent} size={110} label="Gesamt" />
            <div className="space-y-1.5 text-xs">
              <div className="font-bold text-slate-900 dark:text-white">
                {stats.completedCount} von {stats.totalUnits} Einheiten
              </div>
              <div className="text-slate-600 dark:text-slate-400">
                {stats.inProgressCount} in Bearbeitung
              </div>
              <div className="text-slate-600 dark:text-slate-400">
                {stats.completedCases}/{stats.totalUnits} Fallbeispiele gelöst
              </div>
              <div className="text-emerald-700 font-semibold dark:text-emerald-400">
                {stats.completedMinutes} / {stats.totalMinutes} Min. absolviert
              </div>
            </div>
          </div>
        </div>

        {/* 4 KPI-Karten */}
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200/70 bg-white/85 p-4 dark:border-slate-700/70 dark:bg-slate-900/60">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Abgeschlossen
            </div>
            <div className="mt-1 text-2xl font-extrabold text-slate-900 dark:text-white">
              {stats.completedCount}{' '}
              <span className="text-sm font-medium text-slate-400">/ {stats.totalUnits}</span>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/70 bg-white/85 p-4 dark:border-slate-700/70 dark:bg-slate-900/60">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
              <Award className="h-4 w-4 text-teal-600" />
              Quiz-Durchschnitt
            </div>
            <div className="mt-1 text-2xl font-extrabold text-slate-900 dark:text-white">
              {stats.avgQuizPercent} %
              <span className="ml-1.5 text-xs font-medium text-slate-400">
                ({stats.passedQuizzes} bestanden)
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/70 bg-white/85 p-4 dark:border-slate-700/70 dark:bg-slate-900/60">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
              <Layers className="h-4 w-4 text-indigo-500" />
              Lernkarten gewusst
            </div>
            <div className="mt-1 text-2xl font-extrabold text-slate-900 dark:text-white">
              {stats.masteredFlashcards}{' '}
              <span className="text-sm font-medium text-slate-400">
                / {stats.totalFlashcards}
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/70 bg-white/85 p-4 dark:border-slate-700/70 dark:bg-slate-900/60">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
              <Flame className="h-4 w-4 text-amber-500" />
              Lern-Streak
            </div>
            <div className="mt-1 text-2xl font-extrabold text-slate-900 dark:text-white">
              {progress.studyStreak.current} Tage
              <span className="ml-1.5 text-xs font-medium text-slate-400">
                (Rekord: {progress.studyStreak.longest})
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Filter & Suche */}
      <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-soft dark:border-slate-800 dark:bg-ink-800 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Suche nach Themen, Fachbegriffen, Gesetzen (§ 8a, SGB VIII, KiTaG...)"
              className="w-full rounded-xl border border-slate-200 bg-paper-50 py-2 pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>

          <select
            value={selectedModule}
            onChange={(e) => handleModuleChange(e.target.value)}
            aria-label="Lernmodul filtern"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="alle">Alle Module (14)</option>
            {CURRICULUM_MODULES.map((m) => (
              <option key={m.code} value={m.code}>
                {m.code} — {m.shortTitle}
              </option>
            ))}
          </select>

          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value as 'alle' | YearAllocation)}
            aria-label="Ausbildungsjahr filtern"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="alle">Alle Ausbildungsjahre</option>
            <option value="1. Jahr">1. Ausbildungsjahr</option>
            <option value="2./3. Jahr">2./3. Ausbildungsjahr</option>
            <option value="1.–3. Jahr">1.–3. Jahr (übergreifend)</option>
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value as StatusFilter)}
            aria-label="Lernstatus filtern"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="alle">Alle Status</option>
            <option value="offen">Offen</option>
            <option value="in_arbeit">In Arbeit</option>
            <option value="abgeschlossen">Abgeschlossen</option>
            <option value="gemerkt">Gemerkt ★ ({progress.bookmarks.length})</option>
          </select>

          {activeFiltersCount > 0 && (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
            >
              <X className="h-3.5 w-3.5" /> Zurücksetzen ({filteredUnits.length})
            </button>
          )}
        </div>

        {/* Querschnittsthemen-Pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="mr-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Filter className="h-3.5 w-3.5" /> Querschnitt:
          </span>
          <button
            type="button"
            onClick={() => setSelectedTag('alle')}
            className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
              selectedTag === 'alle'
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            Alle
          </button>
          {CROSS_CUTTING_THEMES.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setSelectedTag(selectedTag === tag ? 'alle' : tag)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                selectedTag === tag
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </section>

      {/* Einheiten nach Modulen gruppiert */}
      {filteredUnits.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-ink-800">
          <p className="text-base font-bold text-slate-800 dark:text-slate-200">
            Keine Lerneinheiten passen zu den aktuellen Filtern.
          </p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-3 rounded-xl bg-teal-600 px-4 py-2 text-sm font-bold text-white"
          >
            Alle 50 Einheiten anzeigen
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {CURRICULUM_MODULES.map((mod) => {
            const modUnits = filteredUnits.filter((u) => u.moduleCode === mod.code);
            if (!modUnits.length) return null;
            const modStats = getModuleProgress(mod.code, ALL_UNITS, progress);
            const areaMeta = MODULE_AREAS[mod.area];

            return (
              <section key={mod.code} className="space-y-4">
                {/* Modul-Header */}
                <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200/80 pb-3 dark:border-slate-800">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-lg px-2.5 py-0.5 text-xs font-extrabold ${mod.badgeClass}`}>
                        {mod.code}
                      </span>
                      <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${areaMeta.accentBg} ${areaMeta.accentText} ${areaMeta.accentBorder}`}>
                        {areaMeta.shortTitle}
                      </span>
                      {mod.hoursVzTz > 0 && (
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          {mod.hoursVzTz} Std. · {mod.pdfPages}
                        </span>
                      )}
                      {mod.examCandidate && (
                        <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-bold text-rose-800 dark:bg-rose-950/60 dark:text-rose-200">
                          Abschlussprüfungs-Modul
                        </span>
                      )}
                    </div>
                    <h2 className="font-serif text-xl font-bold text-slate-900 dark:text-white">
                      {mod.title}
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      {mod.description}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="w-32">
                      <div className="mb-1 flex justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                        <span>Fortschritt</span>
                        <span>
                          {modStats.completed}/{modStats.total}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                        <div
                          className={`h-full rounded-full bg-gradient-to-r ${mod.colorClass}`}
                          style={{ width: `${modStats.percent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Einheiten-Grid */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {modUnits.map((unit) => {
                    const status = getUnitCompletionStatus(unit, progress);
                    const quiz = progress.quizResults[unit.id];
                    const masteryArr = progress.flashcardMastery[unit.id] ?? [];
                    const masteredCards = masteryArr.filter(Boolean).length;
                    const isBookmarked = progress.bookmarks.includes(unit.id);

                    return (
                      <div
                        key={unit.id}
                        className={`group flex flex-col justify-between rounded-2xl border bg-white p-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-card dark:bg-ink-800 ${
                          status === 'completed'
                            ? 'border-emerald-300/90 dark:border-emerald-800/80'
                            : 'border-slate-200/90 dark:border-slate-800'
                        }`}
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="rounded-lg bg-slate-900 px-2 py-0.5 text-xs font-extrabold text-white dark:bg-slate-100 dark:text-slate-900">
                                E{String(unit.number).padStart(2, '0')}
                              </span>
                              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                {unit.year}
                              </span>
                              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                                <Clock className="h-3 w-3" /> {unit.estimatedMinutes} Min.
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => toggleBookmark(unit.id)}
                              aria-label="Einheit merken"
                              className={`rounded-lg p-1 transition ${
                                isBookmarked
                                  ? 'text-amber-500'
                                  : 'text-slate-300 hover:text-amber-400 dark:text-slate-600'
                              }`}
                            >
                              <Bookmark
                                className={`h-4 w-4 ${isBookmarked ? 'fill-current' : ''}`}
                              />
                            </button>
                          </div>

                          <Link to={`/einheit/${unit.id}`} className="mt-2.5 block">
                            <h3 className="font-serif text-base font-bold leading-snug text-slate-900 group-hover:text-teal-700 dark:text-white dark:group-hover:text-teal-300">
                              {unit.title}
                            </h3>
                            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                              {unit.subtitle}
                            </p>
                          </Link>

                          <div className="mt-3 flex flex-wrap gap-1">
                            {unit.crossCuttingTags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full bg-paper-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
                          <div className="flex items-center gap-2 text-[11px] font-semibold">
                            {status === 'completed' ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Erledigt
                              </span>
                            ) : status === 'in_progress' ? (
                              <span className="text-amber-600 dark:text-amber-400">
                                In Arbeit
                              </span>
                            ) : (
                              <span className="text-slate-400">Offen</span>
                            )}
                            {quiz && (
                              <span className="rounded bg-teal-50 px-1.5 py-0.5 text-teal-800 dark:bg-teal-950/60 dark:text-teal-200">
                                Quiz {Math.round((quiz.bestScore / quiz.total) * 100)}%
                              </span>
                            )}
                            {masteredCards > 0 && (
                              <span className="text-slate-500 dark:text-slate-400">
                                {masteredCards}/{unit.flashcards.length} K.
                              </span>
                            )}
                          </div>

                          <Link
                            to={`/einheit/${unit.id}`}
                            className="inline-flex items-center gap-1 text-xs font-bold text-teal-700 hover:underline dark:text-teal-300"
                          >
                            Lernen <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};
