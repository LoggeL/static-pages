import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Award,
  Bookmark,
  CalendarClock,
  CheckCircle2,
  Clock,
  Compass,
  Filter,
  Flame,
  Layers,
  Play,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { ALL_UNITS } from '../data/units';
import {
  CROSS_CUTTING_THEMES,
  CURRICULUM_MODULES,
  MODULE_AREAS,
  type CurriculumModuleMeta,
} from '../data/modules';
import { useProgress } from '../context/ProgressContext';
import {
  getCurrentQuizResult,
  getModuleProgress,
  getOverallStats,
  getUnitCompletionStatus,
  getValidFlashcardMastery,
  hasStaleQuizResult,
} from '../lib/storage';
import {
  getFeaturedStarterUnits,
  getOrderedModulesForLearningPath,
  getPrimaryStarterUnit,
} from '../lib/learning';
import { ProgressRing } from '../components/learning/ProgressRing';
import type { CrossCuttingTag, LearningUnit, YearAllocation } from '../types/curriculum';

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
  const { unit: starterUnit, isResuming } = useMemo(
    () => getPrimaryStarterUnit(ALL_UNITS, progress),
    [progress]
  );
  const featuredUnits = useMemo(() => getFeaturedStarterUnits(ALL_UNITS), []);
  const { coreModules, orientationModules } = useMemo(
    () => getOrderedModulesForLearningPath(CURRICULUM_MODULES),
    []
  );

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

  const renderModuleSection = (mod: CurriculumModuleMeta, modUnits: LearningUnit[]) => {
    const modStats = getModuleProgress(mod.code, ALL_UNITS, progress);
    const areaMeta = MODULE_AREAS[mod.area];

    return (
      <section key={mod.code} className="space-y-4">
        {/* Modul-Header */}
        <div className="flex flex-col gap-3 border-b border-slate-200/80 pb-3 dark:border-slate-800 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-lg px-2.5 py-0.5 text-xs font-extrabold ${mod.badgeClass}`}>
                {mod.code}
              </span>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${areaMeta.accentBg} ${areaMeta.accentText} ${areaMeta.accentBorder}`}
              >
                {areaMeta.shortTitle}
              </span>
              {mod.examCandidate && (
                <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-bold text-rose-800 dark:bg-rose-950/60 dark:text-rose-200">
                  Abschlussprüfungs-Modul
                </span>
              )}
              {mod.hoursVzTz > 0 && (
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Themenbezug RLP: {mod.pdfPages}
                </span>
              )}
            </div>
            <h2 className="font-serif text-xl font-bold text-slate-900 dark:text-white">
              {mod.title}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">{mod.description}</p>
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
            const currentQuiz = getCurrentQuizResult(unit, progress);
            const staleQuiz = hasStaleQuizResult(unit, progress);
            const masteryArr = getValidFlashcardMastery(unit, progress);
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
                      aria-label={isBookmarked ? 'Lesezeichen entfernen' : 'Einheit merken'}
                      className={`rounded-lg p-1 transition ${
                        isBookmarked
                          ? 'text-amber-500'
                          : 'text-slate-300 hover:text-amber-400 dark:text-slate-600'
                      }`}
                    >
                      <Bookmark className={`h-4 w-4 ${isBookmarked ? 'fill-current' : ''}`} />
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

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                    {status === 'completed' ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Erledigt
                      </span>
                    ) : status === 'in_progress' ? (
                      <span className="text-amber-600 dark:text-amber-400">In Arbeit</span>
                    ) : (
                      <span className="text-slate-400">Offen</span>
                    )}
                    {currentQuiz && currentQuiz.total > 0 && (
                      <span className="rounded bg-teal-50 px-1.5 py-0.5 text-teal-800 dark:bg-teal-950/60 dark:text-teal-200">
                        Quiz {Math.round((currentQuiz.bestScore / currentQuiz.total) * 100)}%
                      </span>
                    )}
                    {staleQuiz && (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
                        Quiz neu
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
                    className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-teal-700 hover:underline dark:text-teal-300"
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
  };

  const visibleCoreSections = coreModules
    .map((mod) => ({
      mod,
      units: filteredUnits.filter((u) => u.moduleCode === mod.code),
    }))
    .filter((entry) => entry.units.length > 0);

  const visibleOrientationSections = orientationModules
    .map((mod) => ({
      mod,
      units: filteredUnits.filter((u) => u.moduleCode === mod.code),
    }))
    .filter((entry) => entry.units.length > 0);

  return (
    <div className="space-y-8">
      {/* Hero Banner */}
      <section className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white via-paper-50 to-teal-50/70 p-6 shadow-card dark:border-slate-800 dark:from-ink-800 dark:via-ink-800 dark:to-teal-950/35 sm:p-8">
        <div className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
          <div className="w-full min-w-0 max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-teal-100 px-3 py-1 text-xs font-bold text-teal-900 dark:bg-teal-900/60 dark:text-teal-200">
              <Sparkles className="h-3.5 w-3.5" />
              Fachschule Sozialpädagogik Rheinland-Pfalz
            </div>
            <h1 className="font-serif text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl lg:text-4xl">
              Sozialpädagogik lernen
            </h1>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300 sm:text-base">
              Die Fachmodule erklären pädagogische Konzepte anhand von Beispielen aus Kita, Hort und Jugendhilfe.
              Mit Fallaufgaben, Lernkarten und Quizfragen kannst du das Gelernte anwenden und wiederholen.
            </p>

            {starterUnit && (
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link
                  to={`/einheit/${starterUnit.id}`}
                  data-testid="primary-starter-cta"
                  className="inline-flex items-center gap-2 rounded-2xl bg-teal-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-teal-700"
                >
                  <Play className="h-4 w-4 shrink-0 fill-current" />
                  <span>
                    {isResuming ? 'Weiterlernen' : 'Direkt einsteigen'} · {starterUnit.title}
                  </span>
                </Link>
                <Link
                  to="/pruefung"
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <Award className="h-4 w-4 text-rose-500" />
                  Prüfungstrainer
                </Link>
                <Link
                  to="/stundentafel"
                  className="inline-flex items-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <CalendarClock className="h-4 w-4 text-amber-600" />
                  Stundentafel nachschlagen
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
              <div className="font-semibold text-emerald-700 dark:text-emerald-400">
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

      {/* 1-Klick Direkteinstieg in zentrale Fachthemen */}
      {activeFiltersCount === 0 && featuredUnits.length > 0 && (
        <section className="space-y-3" aria-label="Direkteinstieg Fachthemen">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="font-serif text-lg font-bold text-slate-900 dark:text-white sm:text-xl">
                Direkteinstieg in zentrale Fachthemen
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Ohne Umwege loslernen: vier zentrale Praxisthemen aus den sozialpädagogischen Kernmodulen.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {featuredUnits.map((unit) => {
              const modMeta = CURRICULUM_MODULES.find((m) => m.code === unit.moduleCode);
              return (
                <Link
                  key={unit.id}
                  to={`/einheit/${unit.id}`}
                  className="group flex flex-col justify-between rounded-2xl border border-teal-200/70 bg-white p-4 shadow-soft transition hover:-translate-y-0.5 hover:border-teal-400 hover:shadow-card dark:border-teal-900/60 dark:bg-ink-800 dark:hover:border-teal-600"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {modMeta && (
                        <span
                          className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${modMeta.badgeClass}`}
                        >
                          {modMeta.code}
                        </span>
                      )}
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        E{String(unit.number).padStart(2, '0')}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        {unit.estimatedMinutes} Min.
                      </span>
                    </div>
                    <h3 className="mt-2 font-serif text-base font-bold leading-snug text-slate-900 group-hover:text-teal-700 dark:text-white dark:group-hover:text-teal-300">
                      {unit.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      {unit.subtitle}
                    </p>
                  </div>
                  <div className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-teal-700 group-hover:underline dark:text-teal-300">
                    Direkt starten <ArrowRight className="h-3.5 w-3.5" />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Filter & Suche */}
      <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-soft dark:border-slate-800 dark:bg-ink-800 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:min-w-[220px] sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Suche nach Themen, Fachbegriffen, Gesetzen (§ 8a, Bindung, Sprachbildung...)"
              className="w-full rounded-xl border border-slate-200 bg-paper-50 py-2 pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>

          <select
            value={selectedModule}
            onChange={(e) => handleModuleChange(e.target.value)}
            aria-label="Lernmodul filtern"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="alle">Alle Module ({CURRICULUM_MODULES.length})</option>
            <optgroup label="Fachliche Lernmodule">
              {coreModules.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.code} — {m.shortTitle}
                </option>
              ))}
            </optgroup>
            <optgroup label="Orientierung & Nachschlagen">
              {orientationModules.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.code} — {m.shortTitle}
                </option>
              ))}
            </optgroup>
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

      {/* Einheiten nach fachlichen Modulen zuerst, Orientierung separat nachschlagbar */}
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
            Alle {ALL_UNITS.length} Einheiten anzeigen
          </button>
        </div>
      ) : (
        <div className="space-y-10">
          {/* Fachliche Module im Vordergrund */}
          {visibleCoreSections.length > 0 && (
            <div className="space-y-8">
              {visibleCoreSections.map(({ mod, units }) => renderModuleSection(mod, units))}
            </div>
          )}

          {/* Nachschlagbare Orientierung & Berufsgrundlagen */}
          {visibleOrientationSections.length > 0 && (
            <div className="space-y-6 rounded-3xl border border-amber-200/80 bg-amber-50/40 p-5 dark:border-amber-900/50 dark:bg-amber-950/15 sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                    <Compass className="h-4 w-4" />
                    Orientierung &amp; Nachschlagen
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Berufsauftrag, Tätigkeitsprofil und Querschnittsgrundlagen zum Nachschlagen — ergänzend zu den fachlichen Modulen oben.
                  </p>
                </div>
                <Link
                  to="/stundentafel"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3.5 py-2 text-xs font-bold text-amber-900 transition hover:bg-amber-50 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-200"
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  Stundentafel &amp; Ausbildungsrahmen
                </Link>
              </div>

              {visibleOrientationSections.map(({ mod, units }) =>
                renderModuleSection(mod, units)
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
