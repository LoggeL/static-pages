import { LearningUnit, ProgressState } from '../types/curriculum';

export const PROGRESS_STORAGE_KEY = 'sozpaed_lp_rlp_progress_v1';

export function getTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getYesterdayIsoDate(todayIso: string): string {
  const [y, m, d] = todayIso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
    dt.getDate()
  ).padStart(2, '0')}`;
}

export function createDefaultProgress(): ProgressState {
  return {
    version: 1,
    completedUnits: {},
    sectionsRead: {},
    quizResults: {},
    flashcardMastery: {},
    caseStudyCompleted: {},
    bookmarks: [],
    notes: {},
    studyStreak: {
      current: 0,
      longest: 0,
      lastDate: null,
    },
    lastVisitedUnitId: null,
    preferences: {
      theme: 'light',
      orgForm: 'vz',
    },
  };
}

export function mergeWithDefaults(partial: Partial<ProgressState> | null | undefined): ProgressState {
  const base = createDefaultProgress();
  if (!partial || typeof partial !== 'object') return base;
  return {
    version: 1,
    completedUnits:
      partial.completedUnits && typeof partial.completedUnits === 'object'
        ? partial.completedUnits
        : base.completedUnits,
    sectionsRead:
      partial.sectionsRead && typeof partial.sectionsRead === 'object'
        ? partial.sectionsRead
        : base.sectionsRead,
    quizResults:
      partial.quizResults && typeof partial.quizResults === 'object'
        ? partial.quizResults
        : base.quizResults,
    flashcardMastery:
      partial.flashcardMastery && typeof partial.flashcardMastery === 'object'
        ? partial.flashcardMastery
        : base.flashcardMastery,
    caseStudyCompleted:
      partial.caseStudyCompleted && typeof partial.caseStudyCompleted === 'object'
        ? partial.caseStudyCompleted
        : base.caseStudyCompleted,
    bookmarks: Array.isArray(partial.bookmarks) ? partial.bookmarks : base.bookmarks,
    notes: partial.notes && typeof partial.notes === 'object' ? partial.notes : base.notes,
    studyStreak: {
      current:
        typeof partial.studyStreak?.current === 'number' ? partial.studyStreak.current : 0,
      longest:
        typeof partial.studyStreak?.longest === 'number' ? partial.studyStreak.longest : 0,
      lastDate:
        typeof partial.studyStreak?.lastDate === 'string' ||
        partial.studyStreak?.lastDate === null
          ? partial.studyStreak.lastDate
          : null,
    },
    lastVisitedUnitId:
      typeof partial.lastVisitedUnitId === 'string' ? partial.lastVisitedUnitId : null,
    preferences: {
      theme: partial.preferences?.theme === 'dark' ? 'dark' : 'light',
      orgForm: partial.preferences?.orgForm === 'bb' ? 'bb' : 'vz',
    },
  };
}

export function loadProgress(): ProgressState {
  try {
    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return createDefaultProgress();
    const parsed = JSON.parse(raw) as Partial<ProgressState>;
    return mergeWithDefaults(parsed);
  } catch {
    return createDefaultProgress();
  }
}

export function saveProgress(state: ProgressState): void {
  try {
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignoriere Quota-Fehler im Private-Mode
  }
}

export function touchStreak(state: ProgressState): ProgressState {
  const today = getTodayIsoDate();
  const { lastDate, current, longest } = state.studyStreak;
  if (lastDate === today) {
    return state;
  }
  const yesterday = getYesterdayIsoDate(today);
  const nextCurrent = lastDate === yesterday ? current + 1 : 1;
  const nextLongest = Math.max(longest, nextCurrent);
  return {
    ...state,
    studyStreak: {
      current: nextCurrent,
      longest: nextLongest,
      lastDate: today,
    },
  };
}

export function exportProgressJson(state: ProgressState): string {
  return JSON.stringify(state, null, 2);
}

export function importProgressJson(raw: string): ProgressState {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) {
    throw new Error('Ungültiges Backup-Format (erwartet version: 1).');
  }
  return mergeWithDefaults(parsed as Partial<ProgressState>);
}

export type UnitCompletionStatus = 'not_started' | 'in_progress' | 'completed';

export function getUnitCompletionStatus(
  unit: LearningUnit,
  state: ProgressState
): UnitCompletionStatus {
  const quiz = state.quizResults[unit.id];
  if (state.completedUnits[unit.id] || quiz?.passed) {
    return 'completed';
  }
  const hasSections = (state.sectionsRead[unit.id]?.length ?? 0) > 0;
  const hasCards = (state.flashcardMastery[unit.id] ?? []).some(Boolean);
  const hasCase = Boolean(state.caseStudyCompleted[unit.id]);
  const hasNote = Boolean(state.notes[unit.id]?.trim());
  const hasAttempt = Boolean(quiz && quiz.attempts > 0);

  if (hasSections || hasCards || hasCase || hasNote || hasAttempt) {
    return 'in_progress';
  }
  return 'not_started';
}

export function getModuleProgress(
  moduleCode: string,
  units: LearningUnit[],
  state: ProgressState
) {
  const modUnits = units.filter((u) => u.moduleCode === moduleCode);
  const completed = modUnits.filter(
    (u) => getUnitCompletionStatus(u, state) === 'completed'
  ).length;
  const inProgress = modUnits.filter(
    (u) => getUnitCompletionStatus(u, state) === 'in_progress'
  ).length;
  const total = modUnits.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { total, completed, inProgress, percent };
}

export function getOverallStats(units: LearningUnit[], state: ProgressState) {
  let completedCount = 0;
  let inProgressCount = 0;
  let completedMinutes = 0;
  let totalMinutes = 0;

  for (const unit of units) {
    totalMinutes += unit.estimatedMinutes;
    const status = getUnitCompletionStatus(unit, state);
    if (status === 'completed') {
      completedCount++;
      completedMinutes += unit.estimatedMinutes;
    } else if (status === 'in_progress') {
      inProgressCount++;
    }
  }

  const quizEntries = Object.values(state.quizResults);
  const passedQuizzes = quizEntries.filter((q) => q.passed).length;
  const avgQuizPercent =
    quizEntries.length > 0
      ? Math.round(
          (quizEntries.reduce(
            (sum, q) => sum + (q.total > 0 ? q.bestScore / q.total : 0),
            0
          ) /
            quizEntries.length) *
            100
        )
      : 0;

  const totalFlashcards = units.reduce((acc, u) => acc + u.flashcards.length, 0);
  const masteredFlashcards = units.reduce((acc, u) => {
    const arr = state.flashcardMastery[u.id] ?? [];
    return acc + arr.filter(Boolean).length;
  }, 0);

  const completedCases = units.filter((u) => Boolean(state.caseStudyCompleted[u.id])).length;
  const overallPercent =
    units.length > 0 ? Math.round((completedCount / units.length) * 100) : 0;

  return {
    totalUnits: units.length,
    completedCount,
    inProgressCount,
    overallPercent,
    passedQuizzes,
    attemptedQuizzes: quizEntries.length,
    avgQuizPercent,
    totalFlashcards,
    masteredFlashcards,
    completedCases,
    completedMinutes,
    totalMinutes,
  };
}
