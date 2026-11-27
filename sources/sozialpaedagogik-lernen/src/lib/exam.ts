import type { LearningUnit, ProgressState, QuizQuestion } from '../types/curriculum.ts';
import { isOrientationUnit } from './learning.ts';
import { getCurrentQuizResult } from './storage.ts';

export type ExamMode = 'abschluss' | 'module' | 'zufall' | 'schwaechen';
export type ExamFocus = 'alle' | 'case' | 'pruefung';

export interface ExamQuestion extends QuizQuestion {
  unitId: string;
  unitNumber: number;
  unitTitle: string;
  moduleCode: string;
}

const META_CURRICULUM_PATTERNS: RegExp[] = [
  /\bFußnote\s*\d+\b/i,
  /\bFn\.\s*\d+\b/i,
  /\bPDF-?Seiten?\b/i,
  /\bSeitenzahl(en)?\s+(im|des)\s+Lehrplans?\b/i,
  /\bWie\s+viele\s+(Pflicht-?|Unterrichts-?)?Stunden\b/i,
  /\bTeilungsstunden\b/i,
  /\bLernbaustein\s*\d+\b/i,
  /\bStundentafel\b.*\b(2\.?400|1\.?800|800|480|360|240)\b/i,
  /\bWie\s+viele\s+schriftliche\s+Prüfungsmodule\b/i,
  /\bModulcode\b/i,
];

/**
 * Filtert Fragen heraus, die reines Lehrplan-/Stundentafel-Auswendiglernen
 * (Seitenzahlen, Fußnoten, Stundenzahlen, Modulcodes) abfragen.
 */
export function isMetaCurriculumQuestion(question: Pick<QuizQuestion, 'question' | 'explanation' | 'options'>): boolean {
  const hay = [question.question, question.explanation, ...question.options].join(' ');
  return META_CURRICULUM_PATTERNS.some((pattern) => pattern.test(hay));
}

/**
 * Erstellt den fachlichen Fragenpool für den Prüfungstrainer.
 * Standardmäßig werden reine Orientierungseinheiten (01–03 / LEITLINIEN)
 * sowie etwaige Lehrplan-Metafragen ausgeschlossen.
 */
export function buildExamQuestionBank(
  units: LearningUnit[],
  includeOrientation = false
): ExamQuestion[] {
  return units
    .filter((u) => includeOrientation || !isOrientationUnit(u))
    .flatMap((u) =>
      u.quiz
        .filter((q) => !isMetaCurriculumQuestion(q))
        .map((q) => ({
          ...q,
          id: `${u.id}__${q.id}`,
          unitId: u.id,
          unitNumber: u.number,
          unitTitle: u.title,
          moduleCode: u.moduleCode,
        }))
    );
}

/**
 * Liefert fachliche Einheiten ohne bestandenes *aktuelles* Quiz
 * (veraltete Quizstände mit alten Fragen-IDs zählen bewusst als noch zu üben).
 */
export function getWeakCoreUnitIds(
  units: LearningUnit[],
  state: ProgressState
): Set<string> {
  return new Set(
    units
      .filter((u) => !isOrientationUnit(u))
      .filter((u) => !getCurrentQuizResult(u, state)?.passed)
      .map((u) => u.id)
  );
}

export interface ExamFilterOptions {
  mode: ExamMode;
  examModules: string[];
  selectedModules: string[];
  weakUnitIds: Set<string>;
  focus: ExamFocus;
}

export function filterExamQuestions(
  bank: ExamQuestion[],
  options: ExamFilterOptions
): ExamQuestion[] {
  let pool: ExamQuestion[];

  if (options.mode === 'abschluss') {
    pool = bank.filter((q) => options.examModules.includes(q.moduleCode));
  } else if (options.mode === 'module') {
    pool = bank.filter((q) => options.selectedModules.includes(q.moduleCode));
  } else if (options.mode === 'schwaechen') {
    pool = bank.filter((q) => options.weakUnitIds.has(q.unitId));
  } else {
    pool = bank;
  }

  if (options.focus === 'case') {
    pool = pool.filter((q) => q.type === 'case');
  } else if (options.focus === 'pruefung') {
    pool = pool.filter((q) => q.difficulty === 'pruefung' || q.type === 'case');
  }

  return pool;
}

function shuffleWithRng<T>(arr: T[], rng: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Wählt eine ausgewogene Prüfungsrunde aus:
 * - balanciert Module im Pool (Round-Robin über gemischte Modul-Buckets),
 * - priorisiert innerhalb der Buckets Fall- & Prüfungsfragen leicht stärker,
 *   damit Prüfungsrunden praxisnah bleiben.
 */
export function selectBalancedExamQuestions(
  pool: ExamQuestion[],
  count: number,
  rng: () => number = Math.random
): ExamQuestion[] {
  if (pool.length === 0 || count <= 0) return [];
  const target = Math.min(count, pool.length);

  const byModule = new Map<string, ExamQuestion[]>();
  for (const q of pool) {
    const list = byModule.get(q.moduleCode) ?? [];
    list.push(q);
    byModule.set(q.moduleCode, list);
  }

  const buckets = shuffleWithRng(Array.from(byModule.values()), rng).map((bucket) => {
    const priority = shuffleWithRng(
      bucket.filter((q) => q.type === 'case' || q.difficulty === 'pruefung'),
      rng
    );
    const rest = shuffleWithRng(
      bucket.filter((q) => q.type !== 'case' && q.difficulty !== 'pruefung'),
      rng
    );
    // Mische 2:1 zugunsten von Fall-/Prüfungsfragen, ohne Basiswissen auszuschließen
    const merged: ExamQuestion[] = [];
    let pi = 0;
    let ri = 0;
    while (pi < priority.length || ri < rest.length) {
      if (pi < priority.length) merged.push(priority[pi++]);
      if (pi < priority.length) merged.push(priority[pi++]);
      if (ri < rest.length) merged.push(rest[ri++]);
    }
    return merged;
  });

  const picked: ExamQuestion[] = [];
  let round = 0;
  while (picked.length < target) {
    let addedInRound = false;
    for (const bucket of buckets) {
      if (round < bucket.length && picked.length < target) {
        picked.push(bucket[round]);
        addedInRound = true;
      }
    }
    if (!addedInRound) break;
    round++;
  }

  return shuffleWithRng(picked, rng);
}

export function isExamAnswerCorrect(
  q: Pick<QuizQuestion, 'correctIndices'>,
  selected: number[]
): boolean {
  if (selected.length !== q.correctIndices.length) return false;
  const a = [...selected].sort((x, y) => x - y);
  const b = [...q.correctIndices].sort((x, y) => x - y);
  return a.every((v, i) => v === b[i]);
}
