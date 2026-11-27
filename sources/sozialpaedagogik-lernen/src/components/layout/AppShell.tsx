import React, { useMemo, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  Award,
  BookMarked,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  Flame,
  GraduationCap,
  LayoutDashboard,
  Menu,
  Moon,
  Search,
  Sun,
  X,
} from 'lucide-react';
import { ALL_UNITS } from '../../data/units';
import { CURRICULUM_MODULES, type CurriculumModuleMeta } from '../../data/modules';
import { useProgress } from '../../context/ProgressContext';
import {
  getCurrentQuizResult,
  getModuleProgress,
  getOverallStats,
  getUnitCompletionStatus,
} from '../../lib/storage';
import { getOrderedModulesForLearningPath } from '../../lib/learning';
import { BackupModal } from './BackupModal';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { progress, setTheme } = useProgress();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [sidebarQuery, setSidebarQuery] = useState('');
  const [openModules, setOpenModules] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const m of CURRICULUM_MODULES) {
      init[m.code] = m.code === 'S-SP-2' || m.code === 'S-SP-3';
    }
    return init;
  });

  const stats = useMemo(() => getOverallStats(ALL_UNITS, progress), [progress]);
  const { coreModules, orientationModules } = useMemo(
    () => getOrderedModulesForLearningPath(CURRICULUM_MODULES),
    []
  );

  const unitsByModule = useMemo(() => {
    const q = sidebarQuery.trim().toLowerCase();
    const map: Record<string, typeof ALL_UNITS> = {};
    for (const mod of CURRICULUM_MODULES) {
      map[mod.code] = ALL_UNITS.filter(
        (u) =>
          u.moduleCode === mod.code &&
          (!q ||
            u.title.toLowerCase().includes(q) ||
            u.moduleCode.toLowerCase().includes(q) ||
            String(u.number).padStart(2, '0').includes(q))
      );
    }
    return map;
  }, [sidebarQuery]);

  const toggleMod = (code: string) => {
    setOpenModules((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition ${
      isActive
        ? 'bg-teal-600 text-white shadow-sm'
        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/80'
    }`;

  const renderSidebarModule = (mod: CurriculumModuleMeta) => {
    const modUnits = unitsByModule[mod.code] ?? [];
    if (sidebarQuery.trim() && modUnits.length === 0) return null;
    const modStats = getModuleProgress(mod.code, ALL_UNITS, progress);
    const isOpen = Boolean(sidebarQuery.trim()) || Boolean(openModules[mod.code]);

    return (
      <div
        key={mod.code}
        className="rounded-xl border border-slate-200/70 bg-white/70 dark:border-slate-800 dark:bg-slate-900/40"
      >
        <button
          type="button"
          onClick={() => toggleMod(mod.code)}
          className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${mod.badgeClass}`}>
                {mod.code}
              </span>
              <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                {modStats.completed}/{modStats.total}
              </span>
            </div>
            <div className="mt-0.5 truncate text-xs font-semibold text-slate-800 dark:text-slate-200">
              {mod.shortTitle}
            </div>
          </div>
          {isOpen ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          )}
        </button>

        {isOpen && (
          <div className="space-y-0.5 border-t border-slate-100 px-1.5 py-1.5 dark:border-slate-800">
            {modUnits.map((unit) => {
              const status = getUnitCompletionStatus(unit, progress);
              const isCurrent = location.pathname === `/einheit/${unit.id}`;
              const currentQuiz = getCurrentQuizResult(unit, progress);
              return (
                <Link
                  key={unit.id}
                  to={`/einheit/${unit.id}`}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition ${
                    isCurrent
                      ? 'bg-teal-50 font-bold text-teal-900 dark:bg-teal-950/60 dark:text-teal-200'
                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {status === 'completed' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                        status === 'in_progress'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {unit.number}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{unit.title}</span>
                  {currentQuiz && currentQuiz.total > 0 && (
                    <span className="shrink-0 text-[10px] font-semibold text-slate-400">
                      {Math.round((currentQuiz.bestScore / currentQuiz.total) * 100)}%
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-4 dark:border-slate-800">
        <Link
          to="/"
          onClick={() => setSidebarOpen(false)}
          className="flex items-center gap-2.5"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-600 to-emerald-600 text-white shadow-sm">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-extrabold leading-tight text-slate-900 dark:text-white">
              Sozialpädagogik
            </div>
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Fachmodule RLP · 50 Einheiten
            </div>
          </div>
        </Link>
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
          aria-label="Menü schließen"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Hauptnavigation: Fachliches Lernen zuerst, Orientierung klar nachgeordnet */}
      <div className="space-y-1 border-b border-slate-200/80 px-3 py-3 dark:border-slate-800">
        <NavLink to="/" end onClick={() => setSidebarOpen(false)} className={navLinkClass}>
          <LayoutDashboard className="h-4 w-4" />
          Fachmodule &amp; Übersicht
        </NavLink>
        <NavLink
          to="/pruefung"
          onClick={() => setSidebarOpen(false)}
          className={navLinkClass}
        >
          <Award className="h-4 w-4" />
          Prüfungstrainer
        </NavLink>
        <NavLink
          to="/glossar"
          onClick={() => setSidebarOpen(false)}
          className={navLinkClass}
        >
          <BookMarked className="h-4 w-4" />
          Fachbegriffe-Glossar
        </NavLink>
        <div className="pt-1.5">
          <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Nachschlagen &amp; Orientierung
          </div>
          <NavLink
            to="/stundentafel"
            onClick={() => setSidebarOpen(false)}
            className={navLinkClass}
          >
            <CalendarClock className="h-4 w-4" />
            Stundentafel &amp; Rahmen
          </NavLink>
        </div>
      </div>

      {/* Sidebar-Suche */}
      <div className="px-3 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={sidebarQuery}
            onChange={(e) => setSidebarQuery(e.target.value)}
            placeholder="Einheit suchen..."
            className="w-full rounded-xl border border-slate-200 bg-paper-50 py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          />
        </div>
      </div>

      {/* Modul-Akkordeons: Fachliche Module oben, Orientierung unten */}
      <div className="mt-2 flex-1 space-y-1.5 overflow-y-auto px-3 pb-4">
        {coreModules.map((mod) => renderSidebarModule(mod))}

        {orientationModules.some((m) => (unitsByModule[m.code]?.length ?? 0) > 0) && (
          <div className="pt-2">
            <div className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Orientierung &amp; Grundlagen
            </div>
            <div className="space-y-1.5">
              {orientationModules.map((mod) => renderSidebarModule(mod))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[#FAF8F5] text-slate-900 dark:bg-[#0F1419] dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="hidden w-72 shrink-0 border-r border-slate-200/80 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-ink-800/95 lg:sticky lg:top-0 lg:block lg:h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative z-10 h-full w-72 max-w-[85vw] bg-white shadow-2xl dark:bg-ink-800">
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-slate-200/80 bg-[#FAF8F5]/90 px-3 py-3 backdrop-blur-md dark:border-slate-800 dark:bg-[#0F1419]/90 sm:gap-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="shrink-0 rounded-xl border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-ink-800 dark:text-slate-200 lg:hidden"
              aria-label="Navigation öffnen"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="hidden min-w-0 items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 sm:flex">
              <BookOpen className="h-4 w-4 shrink-0 text-teal-600" />
              <span className="truncate">
                Fachschule Sozialpädagogik RLP · Fachmodule &amp; Praxiswissen
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {/* Gesamtfortschritt-Pill */}
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200 sm:px-3">
              <span>
                {stats.completedCount}/{stats.totalUnits}
              </span>
              <span className="hidden sm:inline">Einheiten</span>
              <span className="hidden text-emerald-600 dark:text-emerald-400 md:inline">
                ({stats.overallPercent} %)
              </span>
            </div>

            {/* Streak */}
            <div
              title={`Längste Serie: ${progress.studyStreak.longest} Tage`}
              className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200 sm:px-2.5"
            >
              <Flame className="h-3.5 w-3.5 text-amber-500" />
              <span>{progress.studyStreak.current}</span>
            </div>

            {/* Backup */}
            <button
              type="button"
              onClick={() => setBackupOpen(true)}
              title="Lernfortschritt sichern / importieren"
              aria-label="Lernfortschritt sichern oder importieren"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-ink-800 dark:text-slate-200"
            >
              <Database className="h-3.5 w-3.5 text-teal-600" />
              <span className="hidden md:inline">Speicher</span>
            </button>

            {/* Theme */}
            <button
              type="button"
              onClick={() =>
                setTheme(progress.preferences.theme === 'dark' ? 'light' : 'dark')
              }
              title="Hell/Dunkel umschalten"
              className="rounded-xl border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-ink-800 dark:text-slate-200"
              aria-label="Farbschema wechseln"
            >
              {progress.preferences.theme === 'dark' ? (
                <Sun className="h-4 w-4 text-amber-400" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
          </div>
        </header>

        {/* Page Body */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>

      <BackupModal open={backupOpen} onClose={() => setBackupOpen(false)} />
    </div>
  );
};
