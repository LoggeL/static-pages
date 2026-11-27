import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Award,
  BookOpen,
  CheckCircle2,
  FileText,
  GraduationCap,
  Info,
} from 'lucide-react';
import { StundentafelVisualizer } from '../components/curriculum/StundentafelVisualizer';
import { DEFAULT_PRIMARY_STARTER_ID } from '../lib/learning';

const FOOTNOTES = [
  {
    nr: 'Fn. 1, 3, 4, 5',
    title: 'Anrechnung auf die Fachhochschulreifeprüfung (FHR)',
    text: 'S-FÜ-1 kann als Lernbaustein 2 (A) Deutsch, S-FÜ-2 (Zielniveau GER B2) als Lernbaustein 3 (1. Fremdsprache) und S-FÜ-3 als Lernbaustein 4 und 5 Sozialkunde auf Antrag im Qualifizierungspass bescheinigt werden.',
  },
  {
    nr: 'Fn. 2',
    title: 'Quereinstieg aus der Sozialassistenz (Berufsbegleitend)',
    text: 'In der berufsbegleitenden Form umfassen die Pflichtmodule im 1. Jahr exakt 800 Unterrichtsstunden. Diese können auf Antrag durch eine abgeschlossene einschlägige Erstausbildung als Sozialassistent/-in angerechnet werden (Quereinstieg ins 2. Jahr).',
  },
  {
    nr: 'Fn. 6',
    title: 'Beratung & Reflexion in S-SP-1',
    text: 'Von den 160 Unterrichtsstunden in S-SP-1 stehen 40 Stunden ausdrücklich für Beratung durch Lehrkräfte, Intervisionsgruppen und Kollegiale Fallberatung zur Verfügung.',
  },
  {
    nr: 'Fn. 7',
    title: 'Schriftliche Abschlussprüfung',
    text: 'Aus den drei Kernmodulen S-SP-2, S-SP-3 und S-SP-4 wählt die Fachschule vor Beginn des Bildungsgangs zwei Module für die schriftliche Abschlussprüfung aus.',
  },
  {
    nr: 'Fn. 8',
    title: 'Berufspraktikum & Praxis-AG (S-SP-8)',
    text: 'Begleitet das Berufspraktikum (160 Std.). Praktikantinnen und Praktikanten nehmen mindestens monatlich (außerhalb der Ferien) an einer von der Fachschule durchgeführten Arbeitsgemeinschaft bei Entgeltfortzahlung teil.',
  },
  {
    nr: 'Fn. 9',
    title: 'Wahlpflichtbereich (S-SP-9)',
    text: 'Insgesamt 240 Std. zur individuellen Profilbildung: Vertiefung in einem Bildungsbereich/Querschnittsthema (mind. 80 Std.) sowie einem Arbeitsfeld/einer Zielgruppe (mind. 80 Std.) mit passendem Praktikum.',
  },
  {
    nr: 'Fn. 10 & 11',
    title: 'Teilungsstunden & Selbstlernzeiten (Blended Learning)',
    text: 'Insgesamt stehen 360 Teilungsstunden für Kleingruppen zur Verfügung. Bis zu 20 % der Pflichtstunden (480 Std.) dürfen als betreute andere Lernformen (z. B. digitale Selbstlernzeiten) organisiert werden.',
  },
];

export const StundentafelPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-ink-800 sm:p-6">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <a
            href="https://bildung.rlp.de/fileadmin/user_upload/bbs/Informationen_und_Materialien/Lehrplaene/Fachschule/Sozialwesen/2024-09-25_LP_FS_Sozialpaedagogik.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900 hover:underline dark:bg-amber-900/50 dark:text-amber-200"
          >
            <FileText className="h-3.5 w-3.5" />
            Amtlicher Lehrplan RLP (PDF)
          </a>
          <Link
            to={`/einheit/${DEFAULT_PRIMARY_STARTER_ID}`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-teal-700"
          >
            Direkt zu den Fachmodulen <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <h1 className="mt-3 font-serif text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">
          Stundentafel, Organisationsformen &amp; Prüfungsstruktur
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Hier findest du die Stundentafel und die Prüfungsstruktur für Vollzeit, Teilzeit und die berufsbegleitende Ausbildung.
          Der Abschluss führt zur Berufsbezeichnung{' '}
          <strong>„Staatlich anerkannte Erzieherin / Staatlich anerkannter Erzieher“</strong> mit dem Zusatz{' '}
          <strong>„Bachelor Professional in Sozialwesen“</strong>.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200/80 bg-paper-50 p-4 dark:border-slate-700 dark:bg-slate-900/50">
            <div className="flex items-center gap-2 text-xs font-bold text-teal-700 dark:text-teal-300">
              <Award className="h-4 w-4" /> Qualifikationsniveau
            </div>
            <div className="mt-1 text-sm font-bold">Bachelor Professional in Sozialwesen</div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Der Deutsche Qualifikationsrahmen ordnet diese berufliche Qualifikation dem Niveau 6 zu.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-paper-50 p-4 dark:border-slate-700 dark:bg-slate-900/50">
            <div className="flex items-center gap-2 text-xs font-bold text-sky-700 dark:text-sky-300">
              <BookOpen className="h-4 w-4" /> KMK-Basis
            </div>
            <div className="mt-1 text-sm font-bold">Rahmenlehrplan vom 18.06.2020</div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Länderübergreifend abgestimmte, kompetenzorientierte Ausbildung für Arbeitsfelder mit jungen Menschen bis 27 Jahre (§ 7 SGB VIII).
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-paper-50 p-4 dark:border-slate-700 dark:bg-slate-900/50">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" /> 8 Querschnittsthemen
            </div>
            <div className="mt-1 text-sm font-bold">Verbindlich in allen Feldern</div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Partizipation, Inklusion, Prävention, Sprachbildung, Übergänge, Wertevermittlung, Digitale Welt und BNE.
            </p>
          </div>
        </div>
      </section>

      <StundentafelVisualizer />

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-ink-800 sm:p-6">
        <div className="flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-teal-600" />
          <h2 className="font-serif text-xl font-bold text-slate-900 dark:text-white">
            Wichtige organisatorische Regelungen aus dem Lehrplan (S. 3 &amp; 5)
          </h2>
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <Info className="h-3.5 w-3.5 shrink-0" />
          Zum Nachschlagen für Anrechnung, Prüfungsmodule, Praxis-AG und Wahlpflichtbereich.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {FOOTNOTES.map((fn) => (
            <div
              key={fn.nr}
              className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-slate-700/70 dark:bg-slate-900/50"
            >
              <span className="rounded-md bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-800 dark:bg-teal-900/60 dark:text-teal-200">
                {fn.nr}
              </span>
              <h3 className="mt-1.5 text-sm font-bold text-slate-900 dark:text-white">
                {fn.title}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {fn.text}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
