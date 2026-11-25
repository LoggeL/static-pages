import React from 'react';
import { Award, BookOpen, CheckCircle2, GraduationCap, Info } from 'lucide-react';
import { StundentafelVisualizer } from '../components/curriculum/StundentafelVisualizer';

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
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-ink-800">
        <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900 dark:bg-amber-900/50 dark:text-amber-200">
          <GraduationCap className="h-3.5 w-3.5" />
          Kapitel 1 & 3 · Rechtliche & zeitliche Rahmenbedingungen
        </div>
        <h1 className="mt-2 font-serif text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">
          Stundentafel, Organisationsformen & Prüfungsstruktur
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Mit dem erfolgreichen Abschluss der Fachschule Sozialwesen (Fachrichtung Sozialpädagogik) wird die Berufsbezeichnung{' '}
          <strong>„Staatlich anerkannte Erzieherin / Staatlich anerkannter Erzieher“</strong> sowie der Titel{' '}
          <strong>„Bachelor Professional in Sozialwesen“</strong> (inkl. Berechtigung zum Studium an Hochschulen für angewandte Wissenschaften in RLP) verliehen.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200/80 bg-paper-50 p-4 dark:border-slate-700 dark:bg-slate-900/50">
            <div className="flex items-center gap-2 text-xs font-bold text-teal-700 dark:text-teal-300">
              <Award className="h-4 w-4" /> Gleichwertigkeits-Titel
            </div>
            <div className="mt-1 text-sm font-bold">Bachelor Professional in Sozialwesen</div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Verdeutlicht die Gleichwertigkeit der höheren beruflichen Ausbildung mit einem Hochschulabschluss (DQR-Niveau 6).
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

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft dark:border-slate-800 dark:bg-ink-800">
        <div className="flex items-center gap-2">
          <Info className="h-5 w-5 text-teal-600" />
          <h2 className="font-serif text-xl font-bold text-slate-900 dark:text-white">
            Wichtige Regelungen & Fußnoten aus dem Lehrplan (S. 3 & 5)
          </h2>
        </div>

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
