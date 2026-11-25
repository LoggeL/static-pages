export type VisualKind =
  | 'concept_map'
  | 'process_flow'
  | 'timeline'
  | 'comparison'
  | 'pyramid'
  | 'spectrum'
  | 'feature_grid'
  | 'dialogue';

export interface VisualItem {
  id: string;
  label: string;
  badge?: string;
  summary: string;
  detail: string;
  example?: string;
  metric?: string;
}

export interface VisualBlock {
  id: string;
  kind: VisualKind;
  title: string;
  subtitle: string;
  centerLabel?: string;
  leftPole?: string;
  rightPole?: string;
  isCycle?: boolean;
  items: VisualItem[];
}

export interface CaseOption {
  label: string;
  quality: 'optimal' | 'teilweise' | 'problematisch';
  feedback: string;
  theoryLink: string;
}

export interface CaseStep {
  situation: string;
  prompt: string;
  options: CaseOption[];
}

export interface CaseStudy {
  title: string;
  setting: string;
  ageGroup: string;
  context: string;
  steps: CaseStep[];
}

export interface TheorySection {
  heading: string;
  keyTakeaway: string;
  body: string;
  bulletPoints: string[];
  praxisTip: string;
}

export interface Flashcard {
  term: string;
  definition: string;
  example: string;
}

export interface QuizQuestion {
  id: string;
  type: 'single' | 'multi' | 'case';
  question: string;
  options: string[];
  correctIndices: number[];
  explanation: string;
  difficulty: 'basis' | 'vertiefung' | 'pruefung';
}

export type CrossCuttingTag =
  | 'Partizipation'
  | 'Inklusion'
  | 'Prävention'
  | 'Sprachbildung'
  | 'Übergänge'
  | 'Wertevermittlung'
  | 'Digitale Welt'
  | 'BNE';

export type ModuleArea = 'grundlagen' | 'fue' | 'sp-pflicht' | 'sp-wahlpflicht';

export type YearAllocation = '1. Jahr' | '2./3. Jahr' | '1.–3. Jahr';

export interface LearningUnit {
  id: string;
  number: number;
  moduleCode: string;
  moduleArea: ModuleArea;
  bildungsbereich?: string;
  title: string;
  subtitle: string;
  year: YearAllocation;
  estimatedMinutes: number;
  hoursRef: string;
  pdfPages: string;
  crossCuttingTags: CrossCuttingTag[];
  summary: string;
  learningGoals: string[];
  sections: TheorySection[];
  visualBlocks: VisualBlock[];
  caseStudy: CaseStudy;
  selfLearningTasks: string[];
  flashcards: Flashcard[];
  quiz: QuizQuestion[];
}

export interface QuizResultEntry {
  bestScore: number;
  lastScore: number;
  total: number;
  attempts: number;
  passed: boolean;
  lastAnswers: Record<string, number[]>;
  updatedAt: string;
}

export interface ProgressState {
  version: 1;
  completedUnits: Record<string, boolean>;
  sectionsRead: Record<string, number[]>;
  quizResults: Record<string, QuizResultEntry>;
  flashcardMastery: Record<string, boolean[]>;
  caseStudyCompleted: Record<string, boolean>;
  bookmarks: string[];
  notes: Record<string, string>;
  studyStreak: {
    current: number;
    longest: number;
    lastDate: string | null;
  };
  lastVisitedUnitId: string | null;
  preferences: {
    theme: 'light' | 'dark';
    orgForm: 'vz' | 'bb';
  };
}
