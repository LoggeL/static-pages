import test from 'node:test';
import assert from 'node:assert/strict';
import type { LearningUnit, ProgressState, QuizQuestion } from '../src/types/curriculum.ts';
import {
  PROGRESS_STORAGE_KEY,
  computeNextQuizResultEntry,
  createDefaultProgress,
  exportProgressJson,
  getCurrentQuizResult,
  getMatchingQuizAnswers,
  getModuleProgress,
  getOverallStats,
  getUnitCompletionStatus,
  getValidFlashcardMastery,
  getValidReadSections,
  hasStaleQuizResult,
  importProgressJson,
  isQuizResultStale,
  mergeWithDefaults,
  touchStreak,
} from '../src/lib/storage.ts';
import {
  DEFAULT_PRIMARY_STARTER_ID,
  buildUnitHashLink,
  getCurriculumReferenceLabel,
  getFeaturedStarterUnits,
  getOrderedModulesForLearningPath,
  getPrimaryStarterUnit,
  getSafeExternalUrl,
  getSourceHostname,
  isOrientationUnit,
} from '../src/lib/learning.ts';
import {
  buildExamQuestionBank,
  filterExamQuestions,
  getWeakCoreUnitIds,
  isExamAnswerCorrect,
  isMetaCurriculumQuestion,
  selectBalancedExamQuestions,
} from '../src/lib/exam.ts';
import { CURRICULUM_MODULES } from '../src/data/modules.ts';

function makeQuiz(prefix: string, count = 6): QuizQuestion[] {
  return Array.from({ length: count }, (_, idx) => ({
    id: `${prefix}${idx + 1}`,
    type: idx % 3 === 0 ? 'case' : idx % 3 === 1 ? 'multi' : 'single',
    question: `Fachfrage ${idx + 1} zur sozialpädagogischen Praxis`,
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    correctIndices: idx % 3 === 1 ? [0, 2] : [1],
    explanation: 'Ausführliche fachliche Begründung anhand des Praxisbeispiels.',
    difficulty: idx % 3 === 0 ? 'pruefung' : idx % 3 === 1 ? 'vertiefung' : 'basis',
  }));
}

function makeUnit(overrides: Partial<LearningUnit> & Pick<LearningUnit, 'id' | 'number' | 'moduleCode' | 'moduleArea'>): LearningUnit {
  return {
    title: `Einheit ${overrides.number}`,
    subtitle: 'Fachlicher Untertitel',
    year: '1. Jahr',
    estimatedMinutes: 25,
    hoursRef: '240 Std.',
    pdfPages: 'S. 22–23',
    crossCuttingTags: ['Partizipation'],
    summary: 'Ausführliche Zusammenfassung der Lerneinheit für die Praxis.',
    learningGoals: ['Ziel 1', 'Ziel 2', 'Ziel 3'],
    sections: [
      { heading: 'A1', keyTakeaway: 'K1', body: 'B1', bulletPoints: ['P1', 'P2'], praxisTip: 'T1' },
      { heading: 'A2', keyTakeaway: 'K2', body: 'B2', bulletPoints: ['P1', 'P2'], praxisTip: 'T2' },
      { heading: 'A3', keyTakeaway: 'K3', body: 'B3', bulletPoints: ['P1', 'P2'], praxisTip: 'T3' },
    ],
    visualBlocks: [],
    caseStudy: {
      title: 'Fallbeispiel',
      setting: 'Kita',
      ageGroup: '3–6 Jahre',
      context: 'Kontext',
      steps: [],
    },
    selfLearningTasks: ['Aufgabe 1', 'Aufgabe 2'],
    flashcards: [
      { term: 'Begriff 1', definition: 'Def 1', example: 'Ex 1' },
      { term: 'Begriff 2', definition: 'Def 2', example: 'Ex 2' },
      { term: 'Begriff 3', definition: 'Def 3', example: 'Ex 3' },
      { term: 'Begriff 4', definition: 'Def 4', example: 'Ex 4' },
      { term: 'Begriff 5', definition: 'Def 5', example: 'Ex 5' },
    ],
    quiz: makeQuiz('v2-q', 6),
    sources: [
      {
        title: 'SGB VIII § 8a',
        url: 'https://www.gesetze-im-internet.de/sgb_8/__8a.html',
        publisher: 'BMJ',
      },
      {
        title: 'Kita-Portal RLP',
        url: 'https://kita.rlp.de/',
        publisher: 'Land RLP',
      },
    ],
    ...overrides,
  };
}

const SAMPLE_UNITS: LearningUnit[] = [
  makeUnit({
    id: '01-bildungsauftrag-recht',
    number: 1,
    moduleCode: 'LEITLINIEN',
    moduleArea: 'grundlagen',
    unitRole: 'orientation',
    title: 'Bildungsauftrag & Rahmen',
  }),
  makeUnit({
    id: '15-sp2-bindung-beziehung-erziehungsstile',
    number: 15,
    moduleCode: 'S-SP-2',
    moduleArea: 'sp-pflicht',
    unitRole: 'core',
    title: 'Bindung & Beziehung',
  }),
  makeUnit({
    id: '23-sp3-wahrnehmung-beobachtung-doku',
    number: 23,
    moduleCode: 'S-SP-3',
    moduleArea: 'sp-pflicht',
    unitRole: 'core',
    title: 'Wahrnehmung, Beobachtung & Dokumentation',
  }),
  makeUnit({
    id: '33-sp4-sprache-literacy',
    number: 33,
    moduleCode: 'S-SP-4',
    moduleArea: 'sp-pflicht',
    unitRole: 'core',
    title: 'Sprache & Literacy',
  }),
  makeUnit({
    id: '39-sp5-kindesschutz-8a-schutzkonzepte',
    number: 39,
    moduleCode: 'S-SP-5',
    moduleArea: 'sp-pflicht',
    unitRole: 'core',
    title: 'Kinderschutz & § 8a SGB VIII',
  }),
];

test('Storage-Key und Export/Import Version 1 bleiben stabil und erhalten Notizen & Lesezeichen', () => {
  assert.equal(PROGRESS_STORAGE_KEY, 'sozpaed_lp_rlp_progress_v1');

  const legacyState: ProgressState = {
    ...createDefaultProgress(),
    bookmarks: ['15-sp2-bindung-beziehung-erziehungsstile', '39-sp5-kindesschutz-8a-schutzkonzepte'],
    notes: {
      '15-sp2-bindung-beziehung-erziehungsstile': 'Wichtig: Beobachtung strikt von Deutung trennen!',
    },
    caseStudyCompleted: {
      '15-sp2-bindung-beziehung-erziehungsstile': true,
    },
    quizResults: {
      '15-sp2-bindung-beziehung-erziehungsstile': {
        bestScore: 5,
        lastScore: 5,
        total: 6,
        attempts: 2,
        passed: true,
        lastAnswers: { q1: [1], q2: [0, 1], q3: [1], q4: [1], q5: [0, 2], q6: [1] },
        updatedAt: '2026-01-10T12:00:00.000Z',
      },
    },
    lastVisitedUnitId: '15-sp2-bindung-beziehung-erziehungsstile',
    preferences: { theme: 'dark', orgForm: 'bb' },
  };

  const exported = exportProgressJson(legacyState);
  const reimported = importProgressJson(exported);

  assert.equal(reimported.version, 1);
  assert.deepEqual(reimported.bookmarks, legacyState.bookmarks);
  assert.equal(
    reimported.notes['15-sp2-bindung-beziehung-erziehungsstile'],
    'Wichtig: Beobachtung strikt von Deutung trennen!'
  );
  assert.equal(reimported.caseStudyCompleted['15-sp2-bindung-beziehung-erziehungsstile'], true);
  assert.equal(reimported.preferences.theme, 'dark');
  assert.equal(reimported.preferences.orgForm, 'bb');

  assert.throws(() => importProgressJson('{"version": 2}'), /version: 1/);
  assert.throws(() => importProgressJson('not json'));
});

test('Alte Quiz-Antworten (q1..q6) werden bei v2-Fragen als veraltet erkannt und nie als Bewertung übernommen', () => {
  const unit15 = SAMPLE_UNITS[1];
  const staleProgress: ProgressState = mergeWithDefaults({
    version: 1,
    bookmarks: [unit15.id],
    notes: { [unit15.id]: 'Eigene Praxisnotiz bleibt erhalten' },
    quizResults: {
      [unit15.id]: {
        bestScore: 6,
        lastScore: 6,
        total: 6,
        attempts: 2,
        passed: true,
        lastAnswers: {
          q1: [1],
          q2: [0, 2],
          q3: [1],
          q4: [1],
          q5: [0, 2],
          q6: [1],
        },
        updatedAt: '2026-02-01T10:00:00.000Z',
      },
    },
  });

  const saved = staleProgress.quizResults[unit15.id];
  assert.equal(isQuizResultStale(unit15.quiz, saved), true);
  assert.deepEqual(getMatchingQuizAnswers(unit15.quiz, saved), {});
  assert.equal(getCurrentQuizResult(unit15, staleProgress), undefined);
  assert.equal(hasStaleQuizResult(unit15, staleProgress), true);

  // Veralteter Quiz-Pass darf Einheit nicht fälschlich als aktuell bestanden/erledigt werten
  assert.equal(getUnitCompletionStatus(unit15, staleProgress), 'in_progress');
  // Notizen & Lesezeichen bleiben unberührt
  assert.equal(staleProgress.notes[unit15.id], 'Eigene Praxisnotiz bleibt erhalten');
  assert.deepEqual(staleProgress.bookmarks, [unit15.id]);

  // Gesamtstatistik zählt veraltetes Quiz nicht als aktuelles Ergebnis
  const stats = getOverallStats(SAMPLE_UNITS, staleProgress);
  assert.equal(stats.passedQuizzes, 0);
  assert.equal(stats.attemptedQuizzes, 0);
  assert.equal(stats.staleQuizCount, 1);

  // Neues Speichern auf v2-IDs erbt NICHT den alten Bestwert 6/6 oder passed=true
  const v2Answers = {
    'v2-q1': [0],
    'v2-q2': [0],
    'v2-q3': [0],
    'v2-q4': [1],
    'v2-q5': [0, 2],
    'v2-q6': [1],
  };
  const firstV2Entry = computeNextQuizResultEntry(saved, 3, 6, v2Answers, '2026-11-27T05:00:00.000Z');
  assert.equal(firstV2Entry.bestScore, 3);
  assert.equal(firstV2Entry.attempts, 1);
  assert.equal(firstV2Entry.passed, false);

  // Zweiter Versuch mit denselben v2-IDs akkumuliert Bestwert und Versuche korrekt
  const secondV2Entry = computeNextQuizResultEntry(
    firstV2Entry,
    5,
    6,
    v2Answers,
    '2026-11-27T05:05:00.000Z'
  );
  assert.equal(secondV2Entry.bestScore, 5);
  assert.equal(secondV2Entry.attempts, 2);
  assert.equal(secondV2Entry.passed, true);

  const updatedProgress: ProgressState = {
    ...staleProgress,
    quizResults: { [unit15.id]: secondV2Entry },
  };
  assert.equal(isQuizResultStale(unit15.quiz, secondV2Entry), false);
  assert.equal(getCurrentQuizResult(unit15, updatedProgress)?.bestScore, 5);
  assert.equal(getUnitCompletionStatus(unit15, updatedProgress), 'completed');
});

test('sectionsRead und flashcardMastery sind robust gegen Out-of-bounds-Indizes und Längenänderungen', () => {
  const unit15 = SAMPLE_UNITS[1]; // 3 sections, 5 flashcards
  const dirtyState = mergeWithDefaults({
    version: 1,
    sectionsRead: {
      [unit15.id]: [-2, 0, 2, 2, 9, 99],
    },
    flashcardMastery: {
      [unit15.id]: [true, false, true, false, true, true, true, true],
    },
  });

  assert.deepEqual(getValidReadSections(unit15, dirtyState), [0, 2]);
  const mastery = getValidFlashcardMastery(unit15, dirtyState);
  assert.equal(mastery.length, 5);
  assert.deepEqual(mastery, [true, false, true, false, true]);

  const stats = getOverallStats([unit15], dirtyState);
  assert.equal(stats.masteredFlashcards, 3);
  assert.equal(stats.totalFlashcards, 5);

  const modProg = getModuleProgress('S-SP-2', SAMPLE_UNITS, dirtyState);
  assert.equal(modProg.inProgress, 1);
  assert.equal(modProg.completed, 0);
});

test('touchStreak zählt aufeinanderfolgende Tage korrekt hoch und setzt bei Lücke zurück', () => {
  const fresh = createDefaultProgress();
  const day1 = touchStreak(fresh, '2026-11-25');
  assert.equal(day1.studyStreak.current, 1);
  assert.equal(day1.studyStreak.longest, 1);

  const sameDay = touchStreak(day1, '2026-11-25');
  assert.equal(sameDay.studyStreak.current, 1);

  const day2 = touchStreak(sameDay, '2026-11-26');
  assert.equal(day2.studyStreak.current, 2);
  assert.equal(day2.studyStreak.longest, 2);

  const afterGap = touchStreak(day2, '2026-11-29');
  assert.equal(afterGap.studyStreak.current, 1);
  assert.equal(afterGap.studyStreak.longest, 2);
});

test('Frischer Einstieg führt direkt zu einer fachlichen Einheit (nicht 01/LEITLINIEN) und ordnet Fachmodule voran', () => {
  const fresh = createDefaultProgress();
  const primary = getPrimaryStarterUnit(SAMPLE_UNITS, fresh);

  assert.equal(primary.isResuming, false);
  assert.equal(primary.unit?.id, DEFAULT_PRIMARY_STARTER_ID);
  assert.equal(isOrientationUnit(primary.unit!), false);

  // Rückkehrer mit gespeicherter fachlicher Einheit landen wieder dort
  const returning = getPrimaryStarterUnit(SAMPLE_UNITS, {
    ...fresh,
    lastVisitedUnitId: '23-sp3-wahrnehmung-beobachtung-doku',
  });
  assert.equal(returning.isResuming, true);
  assert.equal(returning.unit?.id, '23-sp3-wahrnehmung-beobachtung-doku');

  // Rückkehrfall v1-Profil (Lena): lastVisitedUnitId auf Orientierungseinheit 01-bildungsauftrag-recht
  // inkl. Notiz und Lesezeichen -> Haupt-CTA führt zum Facheinstieg (E15), Daten auf E01 bleiben erhalten!
  const lenaProfile = mergeWithDefaults({
    version: 1,
    lastVisitedUnitId: '01-bildungsauftrag-recht',
    bookmarks: ['01-bildungsauftrag-recht'],
    notes: { '01-bildungsauftrag-recht': 'Meine Orientierungsnotiz zu § 22 SGB VIII' },
  });
  const lenaStarter = getPrimaryStarterUnit(SAMPLE_UNITS, lenaProfile);
  assert.equal(lenaStarter.isResuming, false);
  assert.equal(lenaStarter.unit?.id, DEFAULT_PRIMARY_STARTER_ID);
  assert.equal(isOrientationUnit(lenaStarter.unit!), false);
  assert.equal(
    lenaProfile.notes['01-bildungsauftrag-recht'],
    'Meine Orientierungsnotiz zu § 22 SGB VIII'
  );
  assert.deepEqual(lenaProfile.bookmarks, ['01-bildungsauftrag-recht']);
  assert.equal(
    getUnitCompletionStatus(SAMPLE_UNITS[0], lenaProfile),
    'in_progress'
  );

  // Unbekannte lastVisitedUnitId fällt sauber auf fachlichen Starter zurück
  const invalidResume = getPrimaryStarterUnit(SAMPLE_UNITS, {
    ...fresh,
    lastVisitedUnitId: 'nicht-vorhandene-einheit',
  });
  assert.equal(invalidResume.isResuming, false);
  assert.equal(invalidResume.unit?.id, DEFAULT_PRIMARY_STARTER_ID);

  // 4 kuratierte Direkteinstiegskarten enthalten keine Orientierungseinheit
  const featured = getFeaturedStarterUnits(SAMPLE_UNITS);
  assert.equal(featured.length, 4);
  assert.ok(featured.every((u) => !isOrientationUnit(u)));

  // Lernpfad-Modulreihenfolge: Fachmodule zuerst, LEITLINIEN separat in orientationModules
  const { coreModules, orientationModules } = getOrderedModulesForLearningPath(CURRICULUM_MODULES);
  assert.equal(coreModules[0].code, 'S-SP-1');
  assert.ok(coreModules.every((m) => m.code !== 'LEITLINIEN'));
  assert.deepEqual(
    orientationModules.map((m) => m.code),
    ['LEITLINIEN']
  );

  // Deep-Links & URL-Sicherheit
  assert.equal(
    buildUnitHashLink('15-sp2-bindung-beziehung-erziehungsstile'),
    '#/einheit/15-sp2-bindung-beziehung-erziehungsstile'
  );
  assert.equal(getSafeExternalUrl('https://kita.rlp.de/test'), 'https://kita.rlp.de/test');
  assert.equal(getSafeExternalUrl('javascript:alert(1)'), null);
  assert.equal(getSourceHostname('https://www.gesetze-im-internet.de/sgb_8/__8a.html'), 'gesetze-im-internet.de');
  assert.match(
    getCurriculumReferenceLabel(SAMPLE_UNITS[1], 'Pädagogische Beziehungen'),
    /S-SP-2.*Lehrplan RLP 2024/
  );
});

test('Prüfungstrainer schließt Orientierungseinheiten und Lehrplan-Trivia aus und gewichtet sauber', () => {
  const unitWithTrivia = makeUnit({
    id: '09-fue3-kinder-jugendrecht-aufsicht',
    number: 9,
    moduleCode: 'S-FÜ-3',
    moduleArea: 'fue',
    unitRole: 'core',
    quiz: [
      {
        id: 'v2-q1',
        type: 'case',
        question: 'Welche Pflicht ergibt sich aus § 832 BGB für die Aufsichtspflicht in der Kita?',
        options: ['A', 'B', 'C', 'D'],
        correctIndices: [1],
        explanation: 'Aufsichtspflicht bemisst sich nach Alter, Reife und Situation.',
        difficulty: 'pruefung',
      },
      {
        id: 'v2-q2',
        type: 'single',
        question: 'Wie viele Unterrichtsstunden umfasst die Stundentafel gemäß Fußnote 7?',
        options: ['1800', '2400', '800', '360'],
        correctIndices: [1],
        explanation: 'Fußnote 7 der Stundentafel.',
        difficulty: 'basis',
      },
    ],
  });

  assert.equal(isMetaCurriculumQuestion(unitWithTrivia.quiz[0]), false);
  assert.equal(isMetaCurriculumQuestion(unitWithTrivia.quiz[1]), true);

  const bank = buildExamQuestionBank([...SAMPLE_UNITS, unitWithTrivia], false);
  // Keine LEITLINIEN-Fragen und keine Trivia-Fragen im Pool
  assert.ok(bank.every((q) => q.moduleCode !== 'LEITLINIEN'));
  assert.ok(bank.every((q) => !isMetaCurriculumQuestion(q)));
  assert.ok(bank.some((q) => q.unitId === '09-fue3-kinder-jugendrecht-aufsicht'));

  // Schwächen-Training erkennt Einheiten mit veraltetem Quiz weiterhin als schwach
  const staleProgress = mergeWithDefaults({
    version: 1,
    quizResults: {
      '15-sp2-bindung-beziehung-erziehungsstile': {
        bestScore: 6,
        lastScore: 6,
        total: 6,
        attempts: 1,
        passed: true,
        lastAnswers: { q1: [1], q2: [0], q3: [1], q4: [1], q5: [0], q6: [1] },
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      '23-sp3-wahrnehmung-beobachtung-doku': {
        bestScore: 6,
        lastScore: 6,
        total: 6,
        attempts: 1,
        passed: true,
        lastAnswers: {
          'v2-q1': [1],
          'v2-q2': [0, 2],
          'v2-q3': [1],
          'v2-q4': [1],
          'v2-q5': [0, 2],
          'v2-q6': [1],
        },
        updatedAt: '2026-11-27T04:00:00.000Z',
      },
    },
  });

  const weakIds = getWeakCoreUnitIds(SAMPLE_UNITS, staleProgress);
  assert.equal(weakIds.has('01-bildungsauftrag-recht'), false); // Orientierung ausgeschlossen
  assert.equal(weakIds.has('15-sp2-bindung-beziehung-erziehungsstile'), true); // Stale -> schwach
  assert.equal(weakIds.has('23-sp3-wahrnehmung-beobachtung-doku'), false); // Aktuell bestanden

  // Fokus-Filter "case" liefert ausschließlich Fallfragen
  const caseOnly = filterExamQuestions(bank, {
    mode: 'abschluss',
    examModules: ['S-SP-2', 'S-SP-3'],
    selectedModules: [],
    weakUnitIds: weakIds,
    focus: 'case',
  });
  assert.ok(caseOnly.length > 0);
  assert.ok(caseOnly.every((q) => q.type === 'case'));
  assert.ok(caseOnly.every((q) => q.moduleCode === 'S-SP-2' || q.moduleCode === 'S-SP-3'));

  // Ausgewogene Auswahl aus 2 Modulen enthält Fragen aus beiden Modulen ohne Duplikate
  const abschlussPool = filterExamQuestions(bank, {
    mode: 'abschluss',
    examModules: ['S-SP-2', 'S-SP-3'],
    selectedModules: [],
    weakUnitIds: weakIds,
    focus: 'alle',
  });
  const picked = selectBalancedExamQuestions(abschlussPool, 6, () => 0.42);
  assert.equal(picked.length, 6);
  assert.equal(new Set(picked.map((q) => q.id)).size, 6);
  assert.ok(picked.some((q) => q.moduleCode === 'S-SP-2'));
  assert.ok(picked.some((q) => q.moduleCode === 'S-SP-3'));

  // Antworten-Check unabhängig von Auswahlreihenfolge
  assert.equal(isExamAnswerCorrect({ correctIndices: [0, 2] }, [2, 0]), true);
  assert.equal(isExamAnswerCorrect({ correctIndices: [0, 2] }, [0]), false);
});
