import { ModuleArea } from '../types/curriculum';

export interface ModuleAreaMeta {
  id: ModuleArea;
  title: string;
  shortTitle: string;
  description: string;
  accentBg: string;
  accentText: string;
  accentBorder: string;
  dotColor: string;
}

export interface CurriculumModuleMeta {
  code: string;
  title: string;
  shortTitle: string;
  area: ModuleArea;
  hoursVzTz: number;
  hoursBbYear1: number;
  hoursBbYear23: number;
  selfLearningExample: number;
  inClassroomExample: number;
  examCandidate?: boolean;
  counselingHours?: number;
  integrationNote?: string;
  fhrCreditNote?: string;
  description: string;
  colorClass: string;
  badgeClass: string;
  pdfPages: string;
}

export const MODULE_AREAS: Record<ModuleArea, ModuleAreaMeta> = {
  grundlagen: {
    id: 'grundlagen',
    title: 'Kapitel 1–3: Vorgaben, Leitlinien & Didaktik',
    shortTitle: 'Leitlinien & Rahmen',
    description:
      'Bildungsauftrag, Bachelor Professional in Sozialwesen, Stundentafel (2.400 Std.), Kompetenzmodell, BNE, Digitale Welt und ko-konstruktive Didaktik.',
    accentBg: 'bg-amber-50 dark:bg-amber-950/35',
    accentText: 'text-amber-800 dark:text-amber-300',
    accentBorder: 'border-amber-200 dark:border-amber-800/60',
    dotColor: 'bg-amber-500',
  },
  fue: {
    id: 'fue',
    title: 'I. Fachrichtungsübergreifender Lernbereich (S-FÜ)',
    shortTitle: 'Fachrichtungsübergreifend',
    description:
      '360 Pflichtstunden in Kommunikation, Fremdsprache (B2), Gesellschaft/Recht sowie Naturwissenschaft, Mathematik & IT-Grundlagen.',
    accentBg: 'bg-sky-50 dark:bg-sky-950/35',
    accentText: 'text-sky-800 dark:text-sky-300',
    accentBorder: 'border-sky-200 dark:border-sky-800/60',
    dotColor: 'bg-sky-500',
  },
  'sp-pflicht': {
    id: 'sp-pflicht',
    title: 'II.A Fachrichtungsbezogener Pflichtbereich (S-SP-1 bis 8)',
    shortTitle: 'Sozialpädagogik Pflicht',
    description:
      '1.800 Pflichtstunden Kernkompetenzen: Berufliche Identität, Beziehungen & Gruppen, Diversität & Inklusion, 9 Bildungsbereiche, Eltern/Übergänge, Team/Netzwerke, Religion/Ethik & Berufspraktikum.',
    accentBg: 'bg-emerald-50 dark:bg-emerald-950/35',
    accentText: 'text-emerald-800 dark:text-emerald-300',
    accentBorder: 'border-emerald-200 dark:border-emerald-800/60',
    dotColor: 'bg-emerald-500',
  },
  'sp-wahlpflicht': {
    id: 'sp-wahlpflicht',
    title: 'II.B Wahlpflichtbereich (S-SP-9)',
    shortTitle: 'Wahlpflicht & Vertiefung',
    description:
      '240 Stunden Schwerpunktbildung in einem Bildungsbereich/Querschnittsthema (mind. 80 Std.) sowie einem Arbeitsfeld bzw. einer Zielgruppe (mind. 80 Std.).',
    accentBg: 'bg-violet-50 dark:bg-violet-950/35',
    accentText: 'text-violet-800 dark:text-violet-300',
    accentBorder: 'border-violet-200 dark:border-violet-800/60',
    dotColor: 'bg-violet-500',
  },
};

export const CURRICULUM_MODULES: CurriculumModuleMeta[] = [
  {
    code: 'LEITLINIEN',
    title: 'Rahmenvorgaben, Leitlinien & Didaktische Konzeption',
    shortTitle: 'Leitlinien & Didaktik',
    area: 'grundlagen',
    hoursVzTz: 0,
    hoursBbYear1: 0,
    hoursBbYear23: 0,
    selfLearningExample: 0,
    inClassroomExample: 0,
    description:
      'Rechtlicher Rahmen, Bachelor Professional in Sozialwesen, Stundentafel, Tätigkeitsprofil (0–27 J.), BNE, Digitale Welt und Selbstlernzeiten.',
    colorClass: 'from-amber-500 to-orange-600',
    badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
    pdfPages: 'S. I–15',
  },
  {
    code: 'S-FÜ-1',
    title: 'In beruflichen Situationen professionell kommunizieren',
    shortTitle: 'Berufl. Kommunikation',
    area: 'fue',
    hoursVzTz: 80,
    hoursBbYear1: 40,
    hoursBbYear23: 40,
    selfLearningExample: 0,
    inClassroomExample: 80,
    fhrCreditNote: 'Anrechenbar auf FHR Deutsch (Lernbaustein 2 A)',
    description:
      'Mündliches & schriftliches Sprachhandeln, Berichte/Portfolios, wissenschaftliches Arbeiten, Kongruenz und Textinterpretation.',
    colorClass: 'from-sky-500 to-blue-600',
    badgeClass: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
    pdfPages: 'S. 16',
  },
  {
    code: 'S-FÜ-2',
    title: 'In einer Fremdsprache berufsbezogen kommunizieren',
    shortTitle: 'Fremdsprache (B2)',
    area: 'fue',
    hoursVzTz: 80,
    hoursBbYear1: 0,
    hoursBbYear23: 80,
    selfLearningExample: 0,
    inClassroomExample: 80,
    fhrCreditNote: 'Zielniveau GER B2; anrechenbar auf FHR 1. Fremdsprache (Lernbaustein 3)',
    description:
      'Berufstypische fremdsprachige Gesprächssituationen, Gebrauchs-/Sachtexte und Sprachmittlung auf Zielniveau GER B2.',
    colorClass: 'from-cyan-500 to-teal-600',
    badgeClass: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-200',
    pdfPages: 'S. 17',
  },
  {
    code: 'S-FÜ-3',
    title: 'Gesellschaftspolitische und rechtliche Rahmenbedingungen berücksichtigen',
    shortTitle: 'Gesellschaft & Recht',
    area: 'fue',
    hoursVzTz: 120,
    hoursBbYear1: 40,
    hoursBbYear23: 80,
    selfLearningExample: 40,
    inClassroomExample: 80,
    fhrCreditNote: 'Anrechenbar auf FHR Sozialkunde (Lernbaustein 4 und 5)',
    description:
      'Demokratiebildung, Menschenrechte, Arbeits- & Tarifrecht, Aufsichtspflicht, elterliche Sorge, SGB VIII und KiTaG RLP.',
    colorClass: 'from-indigo-500 to-blue-700',
    badgeClass: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200',
    pdfPages: 'S. 18',
  },
  {
    code: 'S-FÜ-4',
    title: 'Naturwissenschaftliche, mathematische und technische Grundlagen nutzen',
    shortTitle: 'NaWi, Mathe & IT',
    area: 'fue',
    hoursVzTz: 80,
    hoursBbYear1: 40,
    hoursBbYear23: 40,
    selfLearningExample: 0,
    inClassroomExample: 80,
    description:
      'Digitale Kompetenzen, Datenschutz & Urheberrecht, Kostenkalkulation, Kinderkrankheiten, Gesunderhaltung und Alltagsphänomene.',
    colorClass: 'from-blue-500 to-cyan-600',
    badgeClass: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200',
    pdfPages: 'S. 19',
  },
  {
    code: 'S-SP-1',
    title: 'Berufliche Identität und professionelle Perspektiven weiterentwickeln',
    shortTitle: 'Berufliche Identität',
    area: 'sp-pflicht',
    hoursVzTz: 160,
    hoursBbYear1: 100,
    hoursBbYear23: 60,
    selfLearningExample: 40,
    inClassroomExample: 120,
    counselingHours: 40,
    description:
      'Reflexion von Biografie, Rolle und Werten, Nähe & Distanz, Feedback, Psychohygiene, Burnout-Prävention und Supervision (inkl. 40 Std. Beratung).',
    colorClass: 'from-teal-500 to-emerald-600',
    badgeClass: 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200',
    pdfPages: 'S. 20–21',
  },
  {
    code: 'S-SP-2',
    title: 'Pädagogische Beziehungen gestalten und mit Gruppen pädagogisch arbeiten',
    shortTitle: 'Beziehung & Gruppen',
    area: 'sp-pflicht',
    hoursVzTz: 240,
    hoursBbYear1: 80,
    hoursBbYear23: 160,
    selfLearningExample: 80,
    inClassroomExample: 160,
    examCandidate: true,
    description:
      'Partizipation, Bindungstheorie, Erziehungsstile, Gruppendynamik & Soziogramm, Kinderrechte, GFK, Konzepte, Deeskalation & No Blame Approach.',
    colorClass: 'from-emerald-500 to-green-600',
    badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
    pdfPages: 'S. 22–23',
  },
  {
    code: 'S-SP-3',
    title: 'Lebenswelten und Diversität wahrnehmen, verstehen und Inklusion fördern',
    shortTitle: 'Diversität & Inklusion',
    area: 'sp-pflicht',
    hoursVzTz: 240,
    hoursBbYear1: 80,
    hoursBbYear23: 160,
    selfLearningExample: 80,
    inClassroomExample: 160,
    examCandidate: true,
    integrationNote: 'Ca. 10 Std. aus S-SP-7a/b/c integrierbar',
    description:
      'Anti-Stigmatisierung, UN-BRK, kulturelle & geschlechtliche Vielfalt, wertfreie Beobachtung, Entwicklungstheorien, Resilienz & Teilhabeplanung (BTHG).',
    colorClass: 'from-green-500 to-teal-600',
    badgeClass: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200',
    pdfPages: 'S. 24–25',
  },
  {
    code: 'S-SP-4',
    title: 'Sozialpädagogische Bildungsarbeit in den Bildungsbereichen gestalten',
    shortTitle: 'Bildungsbereiche',
    area: 'sp-pflicht',
    hoursVzTz: 680,
    hoursBbYear1: 340,
    hoursBbYear23: 340,
    selfLearningExample: 120,
    inClassroomExample: 560,
    examCandidate: true,
    integrationNote: 'Ca. 30 Std. aus S-SP-7a/b/c integrierbar',
    description:
      'Ko-Konstruktion, Spielpädagogik, Lerngeschichten, Raum als 3. Erzieher sowie alle 9 Bildungsbereiche (Bewegung, Gesundheit, Kunst, Sexualität, Sprache, Medien, NaWi, Mathe, Technik).',
    colorClass: 'from-rose-500 to-orange-500',
    badgeClass: 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200',
    pdfPages: 'S. 26–36',
  },
  {
    code: 'S-SP-5',
    title: 'Erziehungs- und Bildungspartnerschaften gestalten & Übergänge unterstützen',
    shortTitle: 'Eltern & Übergänge',
    area: 'sp-pflicht',
    hoursVzTz: 120,
    hoursBbYear1: 0,
    hoursBbYear23: 120,
    selfLearningExample: 40,
    inClassroomExample: 80,
    description:
      'Makro-/Mikrotransitionen, Kinderschutz (§ 8a SGB VIII) & Schutzkonzepte, kultursensible Elternarbeit, Genogramm, Entwicklungsgespräche & Familienbildung.',
    colorClass: 'from-pink-500 to-rose-600',
    badgeClass: 'bg-pink-100 text-pink-800 dark:bg-pink-900/50 dark:text-pink-200',
    pdfPages: 'S. 37–38',
  },
  {
    code: 'S-SP-6',
    title: 'Institution und Team entwickeln sowie in Netzwerken kooperieren',
    shortTitle: 'Team & Institution',
    area: 'sp-pflicht',
    hoursVzTz: 80,
    hoursBbYear1: 0,
    hoursBbYear23: 80,
    selfLearningExample: 0,
    inClassroomExample: 80,
    description:
      'Qualitäts- & Beschwerdemanagement, Konzeptionsentwicklung, multiprofessionelle Teams, Träger-/Finanzierungsstrukturen, Sozialraumanalyse & Öffentlichkeitsarbeit.',
    colorClass: 'from-slate-600 to-zinc-700',
    badgeClass: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
    pdfPages: 'S. 39–40',
  },
  {
    code: 'S-SP-7',
    title: 'Prozesse religiöser (7a/7b) oder ethisch-philosophischer Bildung (7c)',
    shortTitle: 'Religion & Ethik',
    area: 'sp-pflicht',
    hoursVzTz: 120,
    hoursBbYear1: 0,
    hoursBbYear23: 120,
    selfLearningExample: 40,
    inClassroomExample: 80,
    integrationNote: 'Wahlweise Ev. (7a), Kath. (7b) oder Ethik/Philosophie (7c)',
    description:
      'Sinnfragen, Gottesbild & Kirchenjahr, Theologisieren bzw. Philosophieren mit Kindern (Kant), Wertebildung, Krisenbegleitung & Schutz vor Fanatismus.',
    colorClass: 'from-amber-600 to-yellow-600',
    badgeClass: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-900/50 dark:text-yellow-200',
    pdfPages: 'S. 41–46',
  },
  {
    code: 'S-SP-8',
    title: 'Fachpraktische Kompetenzen im Berufspraktikum & Abschlussprojekt',
    shortTitle: 'Berufspraktikum',
    area: 'sp-pflicht',
    hoursVzTz: 160,
    hoursBbYear1: 0,
    hoursBbYear23: 160,
    selfLearningExample: 40,
    inClassroomExample: 120,
    description:
      'Monatliche Praxis-AG, Ausbildungsplan, kollegiale Fallberatung, Projektdurchführung, Projektjournal und fachliche Präsentation im Kolloquium.',
    colorClass: 'from-orange-500 to-red-600',
    badgeClass: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200',
    pdfPages: 'S. 47',
  },
  {
    code: 'S-SP-9',
    title: 'Wahlpflicht: Vertiefung Bildungsbereich/Querschnitt & Arbeitsfeld',
    shortTitle: 'Wahlpflicht-Vertiefung',
    area: 'sp-wahlpflicht',
    hoursVzTz: 240,
    hoursBbYear1: 80,
    hoursBbYear23: 160,
    selfLearningExample: 0,
    inClassroomExample: 240,
    description:
      'Individuelle Profilbildung: je mind. 80 Std. Vertiefung in einem Bildungsbereich/Querschnittsthema sowie in einem Arbeitsfeld/einer Zielgruppe inkl. Praktikum.',
    colorClass: 'from-violet-500 to-purple-700',
    badgeClass: 'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200',
    pdfPages: 'S. 48–49',
  },
];

export const MODULES_BY_CODE: Record<string, CurriculumModuleMeta> = Object.fromEntries(
  CURRICULUM_MODULES.map((m) => [m.code, m])
);

export const CROSS_CUTTING_THEMES = [
  'Partizipation',
  'Inklusion',
  'Prävention',
  'Sprachbildung',
  'Übergänge',
  'Wertevermittlung',
  'Digitale Welt',
  'BNE',
] as const;

export const STUNDENTAFEL_SUMMARY = {
  totalHours: 2400,
  fueTotal: 360,
  spPflichtTotal: 1800,
  spWahlpflichtTotal: 240,
  maxSelfLearningHours: 480,
  maxSelfLearningPercent: 20,
  inClassroomExampleTotal: 1920,
  teilungsstunden: 360,
  bbYear1Total: 800,
  bbYear23Total: 1600,
};
