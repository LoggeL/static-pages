import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VALIDATOR_PATH = path.join(ROOT, 'scripts', 'validate_units.py');

function runValidatorCheck(unitData: Record<string, unknown>, specData: Record<string, unknown>): string[] {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sozpaed-val-'));
  try {
    const unitPath = path.join(tmpDir, `${String(specData.id)}.json`);
    fs.writeFileSync(unitPath, JSON.stringify(unitData, null, 2), 'utf-8');
    const pyCode = `
import importlib.util, json, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("validate_units", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
errs, _ = mod.validate_unit(json.loads(sys.argv[2]), Path(sys.argv[3]))
print(json.dumps(errs, ensure_ascii=False))
`;
    const stdout = execFileSync(
      'python3',
      ['-c', pyCode, VALIDATOR_PATH, JSON.stringify(specData), unitPath],
      { encoding: 'utf-8' }
    );
    return JSON.parse(stdout) as string[];
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function makeValidUnit() {
  const spec = {
    id: '15-sp2-bindung-beziehung-erziehungsstile',
    number: 15,
    moduleCode: 'S-SP-2',
    moduleArea: 'sp-pflicht',
  };
  const unit = {
    ...spec,
    unitRole: 'core',
    curriculumRef: 'S-SP-2 · Pädagogische Beziehungen gestalten (Lehrplan RLP 2024)',
    title: 'Bindung, Eingewöhnung & Beziehung',
    subtitle: 'Feinfühligkeit, Beobachtung und professionelle Beziehungsgestaltung',
    year: '1. Jahr',
    estimatedMinutes: 25,
    hoursRef: '240 Std. (Teil 1/6)',
    pdfPages: 'S. 22–23',
    crossCuttingTags: ['Inklusion', 'Wertevermittlung'],
    summary: 'Ausführliche fachliche Zusammenfassung zu Bindung, Feinfühligkeit und Eingewöhnung.',
    learningGoals: [
      'Ich kann Beobachtung und Deutung beim Übergang klar trennen.',
      'Ich kann das Konzept der Feinfühligkeit nach Ainsworth erläutern.',
      'Ich kann professionelle Nähe-Distanz-Balance im Alltag begründen.',
    ],
    sections: [1, 2, 3].map((n) => ({
      heading: `Abschnitt ${n}`,
      keyTakeaway: `Merksatz ${n}`,
      body: `Ausführlicher Fachtext zu Abschnitt ${n} für die pädagogische Praxis.`,
      bulletPoints: ['Punkt A', 'Punkt B'],
      praxisTip: `Praxis-Impuls ${n}`,
    })),
    visualBlocks: ['timeline', 'comparison', 'spectrum'].map((kind, i) => ({
      id: `vis-${i + 1}`,
      kind,
      title: `Visual ${i + 1}`,
      subtitle: `Untertitel ${i + 1}`,
      items: [1, 2, 3].map((j) => ({
        id: `it-${j}`,
        label: `Eintrag ${j}`,
        summary: `Kurz ${j}`,
        detail: `Detail ${j}`,
      })),
    })),
    caseStudy: {
      title: 'Ankommen in der Krippe',
      setting: 'Krippe',
      ageGroup: '1–2 Jahre',
      context: 'Kontext zur Eingewöhnung in der Krippe.',
      steps: [1, 2].map((s) => ({
        situation: `Situation ${s}`,
        prompt: `Handlungsfrage ${s}`,
        options: [
          { label: 'Option Optimal', quality: 'optimal', feedback: 'Begründung', theoryLink: 'Feinfühligkeit' },
          { label: 'Option Teilweise', quality: 'teilweise', feedback: 'Begründung', theoryLink: 'Beziehung' },
          { label: 'Option Problematisch', quality: 'problematisch', feedback: 'Begründung', theoryLink: 'Abgrenzung' },
        ],
      })),
    },
    selfLearningTasks: [
      'Beobachte eine Ankommenssituation und trenne Beschreibung und Hypothese.',
      'Reflektiere dein eigenes Nähe-Distanz-Verhalten anhand eines Praxisbeispiels.',
    ],
    flashcards: [1, 2, 3, 4, 5].map((n) => ({
      term: `Fachbegriff ${n}`,
      definition: `Fachlich präzise Definition ${n}.`,
      example: `Konkretes Praxisbeispiel ${n}.`,
    })),
    quiz: [1, 2, 3, 4, 5, 6].map((n) => ({
      id: `v2-q${n}`,
      type: n % 3 === 0 ? 'case' : n % 3 === 1 ? 'single' : 'multi',
      difficulty: n % 3 === 0 ? 'pruefung' : n % 3 === 1 ? 'basis' : 'vertiefung',
      question: `Fachfrage ${n} zur professionellen Beziehungsgestaltung?`,
      options: ['Antwort A', 'Antwort B', 'Antwort C', 'Antwort D'],
      correctIndices: n % 3 === 2 ? [0, 2] : [1],
      explanation: 'Nachvollziehbare fachliche Erklärung zur korrekten Antwort.',
    })),
    sources: [
      {
        title: 'SGB VIII § 22 – Grundsätze der Förderung',
        url: 'https://www.gesetze-im-internet.de/sgb_8/__22.html',
        publisher: 'BMJ',
        note: 'Gesetzlicher Förderauftrag',
      },
      {
        title: 'Kita-Portal Rheinland-Pfalz',
        url: 'https://kita.rlp.de/',
        publisher: 'Ministerium für Bildung RLP',
      },
    ],
  };
  return { spec, unit };
}

test('validate_units.py akzeptiert eine vollständige, valide v2-Einheit', () => {
  const { spec, unit } = makeValidUnit();
  const errors = runValidatorCheck(unit, spec);
  assert.deepEqual(errors, []);
});

test('validate_units.py lehnt fehlende Quellen, unsichere URLs, alte Quiz-IDs und Lehrplan-Trivia ab', () => {
  const { spec, unit } = makeValidUnit();
  unit.sources = [
    { title: 'Nur eine HTTP-Quelle', url: 'http://example.com/test', publisher: 'Test' },
  ];
  unit.quiz[0].id = 'q1';
  unit.quiz[1].question = 'Wie viele Unterrichtsstunden regelt Fußnote 7 der Stundentafel?';

  const errors = runValidatorCheck(unit, spec);
  assert.ok(errors.some((e) => e.includes('sources < 2')), `Expected sources < 2 error, got: ${errors.join('; ')}`);
  assert.ok(errors.some((e) => e.includes('v2-q1')), `Expected quiz ID schema error, got: ${errors.join('; ')}`);
  assert.ok(errors.some((e) => e.includes('Lehrplan-Meta-Abfrage')), `Expected meta-trivia error, got: ${errors.join('; ')}`);

  // Auch unsichere http:// URL bei >= 2 Quellen wird abgelehnt
  const { spec: spec2, unit: unit2 } = makeValidUnit();
  unit2.sources[1].url = 'http://kita.rlp.de/';
  const errors2 = runValidatorCheck(unit2, spec2);
  assert.ok(errors2.some((e) => e.includes('https://')), `Expected https:// error, got: ${errors2.join('; ')}`);
});
