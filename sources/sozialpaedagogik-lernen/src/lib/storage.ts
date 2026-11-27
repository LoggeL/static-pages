import type {
  LearningUnit,
  ProgressState,
  QuizQuestion,
  QuizResultEntry,
} from '../types/curriculum.ts';

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

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

function sanitizeBooleanRecord(raw: unknown): Record<string, boolean> {
  if (!isPlainRecord(raw)) return {};
  const result: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'boolean') {
      result[k] = v;
    }
  }
  return result;
}

function sanitizeSectionsRead(raw: unknown): Record<string, number[]> {
  if (!isPlainRecord(raw)) return {};
  const result: Record<string, number[]> = {};
  for (const [unitId, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue;
    const cleaned = Array.from(
      new Set(
        list.filter(
          (n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0
        )
      )
    ).sort((a, b) => a - b);
    result[unitId] = cleaned;
  }
  return result;
}

function sanitizeFlashcardMastery(raw: unknown): Record<string, boolean[]> {
  if (!isPlainRecord(raw)) return {};
  const result: Record<string, boolean[]> = {};
  for (const [unitId, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue;
    result[unitId] = list.map((item) => Boolean(item));
  }
  return result;
}

function sanitizeNotes(raw: unknown): Record<string, string> {
  if (!isPlainRecord(raw)) return {};
  const result: Record<string, string> = {};
  for (const [unitId, note] of Object.entries(raw)) {
    if (typeof note === 'string') {
      result[unitId] = note;
    }
  }
  return result;
}

function sanitizeAnswerMap(raw: unknown): Record<string, number[]> {
  if (!isPlainRecord(raw)) return {};
  const result: Record<string, number[]> = {};
  for (const [qId, indices] of Object.entries(raw)) {
    if (!Array.isArray(indices)) continue;
    const cleaned = Array.from(
      new Set(
        indices.filter(
          (n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0
        )
      )
    ).sort((a, b) => a - b);
    result[qId] = cleaned;
  }
  return result;
}

function sanitizeQuizResults(raw: unknown): Record<string, QuizResultEntry> {
  if (!isPlainRecord(raw)) return {};
  const result: Record<string, QuizResultEntry> = {};
  for (const [unitId, entry] of Object.entries(raw)) {
    if (!isPlainRecord(entry)) continue;
    const total =
      typeof entry.total === 'number' && Number.isFinite(entry.total) && entry.total >= 0
        ? Math.floor(entry.total)
        : 0;
    const bestScore =
      typeof entry.bestScore === 'number' && Number.isFinite(entry.bestScore) && entry.bestScore >= 0
        ? Math.floor(entry.bestScore)
        : 0;
    const lastScore =
      typeof entry.lastScore === 'number' && Number.isFinite(entry.lastScore) && entry.lastScore >= 0
        ? Math.floor(entry.lastScore)
        : 0;
    const attempts =
      typeof entry.attempts === 'number' && Number.isFinite(entry.attempts) && entry.attempts >= 0
        ? Math.floor(entry.attempts)
        : 0;
    const passed = Boolean(entry.passed);
    const updatedAt =
      typeof entry.updatedAt === 'string' && entry.updatedAt.trim()
        ? entry.updatedAt
        : new Date(0).toISOString();
    result[unitId] = {
      bestScore,
      lastScore,
      total,
      attempts,
      passed,
      lastAnswers: sanitizeAnswerMap(entry.lastAnswers),
      updatedAt,
    };
  }
  return result;
}

export function mergeWithDefaults(partial: Partial<ProgressState> | null | undefined): ProgressState {
  const base = createDefaultProgress();
  if (!partial || typeof partial !== 'object') return base;
  const bookmarks = Array.isArray(partial.bookmarks)
    ? Array.from(
        new Set(
          partial.bookmarks.filter(
            (id): id is string => typeof id === 'string' && id.trim().length > 0
          )
        )
      )
    : base.bookmarks;

  const currentStreak =
    typeof partial.studyStreak?.current === 'number' &&
    Number.isFinite(partial.studyStreak.current) &&
    partial.studyStreak.current >= 0
      ? Math.floor(partial.studyStreak.current)
      : 0;
  const longestStreak =
    typeof partial.studyStreak?.longest === 'number' &&
    Number.isFinite(partial.studyStreak.longest) &&
    partial.studyStreak.longest >= 0
      ? Math.max(currentStreak, Math.floor(partial.studyStreak.longest))
      : currentStreak;

  return {
    version: 1,
    completedUnits: sanitizeBooleanRecord(partial.completedUnits),
    sectionsRead: sanitizeSectionsRead(partial.sectionsRead),
    quizResults: sanitizeQuizResults(partial.quizResults),
    flashcardMastery: sanitizeFlashcardMastery(partial.flashcardMastery),
    caseStudyCompleted: sanitizeBooleanRecord(partial.caseStudyCompleted),
    bookmarks,
    notes: sanitizeNotes(partial.notes),
    studyStreak: {
      current: currentStreak,
      longest: longestStreak,
      lastDate:
        typeof partial.studyStreak?.lastDate === 'string' ||
        partial.studyStreak?.lastDate === null
          ? partial.studyStreak.lastDate
          : null,
    },
    lastVisitedUnitId:
      typeof partial.lastVisitedUnitId === 'string' && partial.lastVisitedUnitId.trim()
        ? partial.lastVisitedUnitId
        : null,
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

export function touchStreak(state: ProgressState, todayOverride?: string): ProgressState {
  const today = todayOverride ?? getTodayIsoDate();
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

/**
 * Filtert gespeicherte Antworten strikt auf die aktuell gültigen Fragen-IDs
 * und gültigen Antwortoptionen. Alte IDs (z. B. q1..q6 bei v2-q1..v2-q6)
 * werden niemals zurückgegeben.
 */
export function getMatchingQuizAnswers(
  questions: QuizQuestion[],
  savedResult?: QuizResultEntry
): Record<string, number[]> {
  if (!savedResult || !isPlainRecord(savedResult.lastAnswers)) {
    return {};
  }
  const matched: Record<string, number[]> = {};
  for (const q of questions) {
    const rawAns = savedResult.lastAnswers[q.id];
    if (!Array.isArray(rawAns)) continue;
    const validIndices = Array.from(
      new Set(
        rawAns.filter(
          (idx) =>
            typeof idx === 'number' &&
            Number.isInteger(idx) &&
            idx >= 0 &&
            idx < q.options.length
        )
      )
    ).sort((a, b) => a - b);
    if (validIndices.length === rawAns.length && validIndices.length > 0) {
      matched[q.id] = validIndices;
    }
  }
  return matched;
}

/**
 * Erkennt zuverlässig, ob ein gespeicherter Quizstand zu veralteten oder
 * veränderten Fragen-IDs gehört (z. B. alte q1..q6-Antworten nach Update auf v2-q1..).
 */
export function isQuizResultStale(
  questions: QuizQuestion[],
  savedResult?: QuizResultEntry
): boolean {
  if (!savedResult) return false;
  if (questions.length === 0) return false;
  if (savedResult.total !== questions.length) return true;

  const savedKeys = isPlainRecord(savedResult.lastAnswers)
    ? Object.keys(savedResult.lastAnswers)
    : [];
  if (savedKeys.length !== questions.length) return true;

  const matching = getMatchingQuizAnswers(questions, savedResult);
  return Object.keys(matching).length !== questions.length;
}

export function getCurrentQuizResult(
  unit: LearningUnit,
  state: ProgressState
): QuizResultEntry | undefined {
  const entry = state.quizResults[unit.id];
  if (!entry) return undefined;
  return isQuizResultStale(unit.quiz, entry) ? undefined : entry;
}

export function hasStaleQuizResult(unit: LearningUnit, state: ProgressState): boolean {
  const entry = state.quizResults[unit.id];
  if (!entry) return false;
  return isQuizResultStale(unit.quiz, entry);
}

function haveSameAnswerKeys(
  prevAnswers: Record<string, number[]> | undefined,
  nextAnswers: Record<string, number[]>
): boolean {
  if (!prevAnswers || !isPlainRecord(prevAnswers)) return false;
  const prevKeys = Object.keys(prevAnswers);
  const nextKeys = Object.keys(nextAnswers);
  if (prevKeys.length === 0 || prevKeys.length !== nextKeys.length) return false;
  const prevSet = new Set(prevKeys);
  return nextKeys.every((k) => prevSet.has(k));
}

/**
 * Berechnet den nächsten QuizResultEntry. Wenn der vorherige Eintrag von einer
 * anderen Fragen-Generation stammt (z. B. q1..q6 vs. v2-q1..), werden alte
 * Bestwerte/Bestanden-Flags NICHT auf das neue Quiz übertragen.
 */
export function computeNextQuizResultEntry(
  prevEntry: QuizResultEntry | undefined,
  score: number,
  total: number,
  answers: Record<string, number[]>,
  nowIso: string = new Date().toISOString()
): QuizResultEntry {
  const passedNow = total > 0 && score / total >= 0.7;
  const compatibleWithPrev =
    Boolean(prevEntry) &&
    prevEntry!.total === total &&
    haveSameAnswerKeys(prevEntry!.lastAnswers, answers);

  if (!compatibleWithPrev || !prevEntry) {
    return {
      bestScore: score,
      lastScore: score,
      total,
      attempts: 1,
      passed: passedNow,
      lastAnswers: answers,
      updatedAt: nowIso,
    };
  }

  return {
    bestScore: Math.max(prevEntry.bestScore, score),
    lastScore: score,
    total,
    attempts: prevEntry.attempts + 1,
    passed: Boolean(prevEntry.passed || passedNow),
    lastAnswers: answers,
    updatedAt: nowIso,
  };
}

export function getValidReadSections(unit: LearningUnit, state: ProgressState): number[] {
  const raw = state.sectionsRead[unit.id];
  if (!Array.isArray(raw) || unit.sections.length === 0) return [];
  return Array.from(
    new Set(
      raw.filter(
        (idx) =>
          typeof idx === 'number' &&
          Number.isInteger(idx) &&
          idx >= 0 &&
          idx < unit.sections.length
      )
    )
  ).sort((a, b) => a - b);
}

export function getValidFlashcardMastery(unit: LearningUnit, state: ProgressState): boolean[] {
  const raw = state.flashcardMastery[unit.id];
  if (!Array.isArray(raw)) {
    return Array.from({ length: unit.flashcards.length }, () => false);
  }
  return unit.flashcards.map((_, idx) => Boolean(raw[idx]));
}

export type UnitCompletionStatus = 'not_started' | 'in_progress' | 'completed';

export function getUnitCompletionStatus(
  unit: LearningUnit,
  state: ProgressState
): UnitCompletionStatus {
  const currentQuiz = getCurrentQuizResult(unit, state);
  const staleQuiz = hasStaleQuizResult(unit, state);

  if (state.completedUnits[unit.id] || currentQuiz?.passed) {
    return 'completed';
  }
  const hasSections = getValidReadSections(unit, state).length > 0;
  const hasCards = getValidFlashcardMastery(unit, state).some(Boolean);
  const hasCase = Boolean(state.caseStudyCompleted[unit.id]);
  const hasNote = Boolean(state.notes[unit.id]?.trim());
  const hasAttempt = Boolean((currentQuiz && currentQuiz.attempts > 0) || staleQuiz);

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
  let passedQuizzes = 0;
  let attemptedQuizzes = 0;
  let quizRatioSum = 0;
  let staleQuizCount = 0;

  for (const unit of units) {
    totalMinutes += unit.estimatedMinutes;
    const status = getUnitCompletionStatus(unit, state);
    if (status === 'completed') {
      completedCount++;
      completedMinutes += unit.estimatedMinutes;
    } else if (status === 'in_progress') {
      inProgressCount++;
    }

    const currentQuiz = getCurrentQuizResult(unit, state);
    if (currentQuiz) {
      attemptedQuizzes++;
      if (currentQuiz.passed) passedQuizzes++;
      quizRatioSum += currentQuiz.total > 0 ? currentQuiz.bestScore / currentQuiz.total : 0;
    } else if (hasStaleQuizResult(unit, state)) {
      staleQuizCount++;
    }
  }

  const avgQuizPercent =
    attemptedQuizzes > 0 ? Math.round((quizRatioSum / attemptedQuizzes) * 100) : 0;

  const totalFlashcards = units.reduce((acc, u) => acc + u.flashcards.length, 0);
  const masteredFlashcards = units.reduce((acc, u) => {
    const arr = getValidFlashcardMastery(u, state);
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
    attemptedQuizzes,
    staleQuizCount,
    avgQuizPercent,
    totalFlashcards,
    masteredFlashcards,
    completedCases,
    completedMinutes,
    totalMinutes,
  };
}
