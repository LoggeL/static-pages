import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Award, BookOpen, Clock, GraduationCap, Info } from 'lucide-react';
import { CURRICULUM_MODULES, STUNDENTAFEL_SUMMARY } from '../../data/modules';

type StundentafelMode = 'vz' | 'bb' | 'self';

export const StundentafelVisualizer: React.FC = () => {
  const [mode, setMode] = useState<StundentafelMode>('vz');
  const navigate = useNavigate();

  const timetableModules = CURRICULUM_MODULES.filter((m) => m.hoursVzTz > 0);

  return (
    <div className="space-y-6">
      {/* Modus-Umschalter */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-soft dark:border-slate-800 dark:bg-ink-800">
        <div>
          <h3 className="font-serif text-lg font-bold text-slate-900 dark:text-white">
            Interaktive Stundentafel (2.400 Unterrichtsstunden)
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Vergleiche Vollzeit/Teilzeit, berufsbegleitende Aufteilung (1. vs. 2./3. Jahr) und das Selbstlernzeit-Beispiel.
          </p>
        </div>

        <div className="inline-flex flex-wrap rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setMode('vz')}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              mode === 'vz'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Vollzeit / Teilzeit
          </button>
          <button
            type="button"
            onClick={() => setMode('bb')}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              mode === 'bb'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Berufsbegleitend (1. J vs. 2./3. J)
          </button>
          <button
            type="button"
            onClick={() => setMode('self')}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              mode === 'self'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Selbstlernzeiten (max. 20 %)
          </button>
        </div>
      </div>

      {/* Gestapelter Gesamtbalken */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-ink-800">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <span>Gesamtvolumen: {STUNDENTAFEL_SUMMARY.totalHours} Std.</span>
          <span>
            Davon {STUNDENTAFEL_SUMMARY.teilungsstunden} Teilungsstunden · bis zu{' '}
            {STUNDENTAFEL_SUMMARY.maxSelfLearningHours} Std. (20 %) Blended Learning
          </span>
        </div>

        <div className="mt-3 flex h-8 w-full overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-900">
          <div
            style={{ width: `${(360 / 2400) * 100}%` }}
            className="flex items-center justify-center bg-sky-500 text-[11px] font-bold text-white"
            title="Fachrichtungsübergreifend: 360 Std. (15 %)"
          >
            FÜ 360 h
          </div>
          <div
            style={{ width: `${(1800 / 2400) * 100}%` }}
            className="flex items-center justify-center bg-emerald-600 text-[11px] font-bold text-white"
            title="Sozialpädagogik Pflicht: 1.800 Std. (75 %)"
          >
            SP Pflicht 1.800 Std. (75 %)
          </div>
          <div
            style={{ width: `${(240 / 2400) * 100}%` }}
            className="flex items-center justify-center bg-violet-600 text-[11px] font-bold text-white"
            title="Wahlpflicht S-SP-9: 240 Std. (10 %)"
          >
            WP 240 h
          </div>
        </div>

        {/* Modul-Balken */}
        <div className="mt-6 space-y-3">
          {timetableModules.map((mod) => {
            const pctTotal = (mod.hoursVzTz / 680) * 100;
            const bbY1Pct = (mod.hoursBbYear1 / mod.hoursVzTz) * 100;
            const selfPct = (mod.selfLearningExample / mod.hoursVzTz) * 100;

            return (
              <div
                key={mod.code}
                className="group rounded-2xl border border-slate-100 bg-slate-50/70 p-3 transition hover:border-teal-300 hover:bg-white dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-teal-700"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/?modul=${encodeURIComponent(mod.code)}`)}
                      className={`rounded-lg px-2.5 py-0.5 text-xs font-bold transition hover:opacity-85 ${mod.badgeClass}`}
                    >
                      {mod.code}
                    </button>
                    <span className="text-sm font-bold text-slate-900 dark:text-white">
                      {mod.title}
                    </span>
                    {mod.examCandidate && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-950/70 dark:text-rose-200">
                        <Award className="h-3 w-3" /> Schriftl. Prüfungsmodul (2 aus 3)
                      </span>
                    )}
                    {mod.fhrCreditNote && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800 dark:bg-sky-950/70 dark:text-sky-200">
                        <GraduationCap className="h-3 w-3" /> FHR-Anrechnung
                      </span>
                    )}
                  </div>

                  <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                    {mode === 'vz' && `${mod.hoursVzTz} Std.`}
                    {mode === 'bb' &&
                      `1. J: ${mod.hoursBbYear1} h · 2./3. J: ${mod.hoursBbYear23} h (Σ ${mod.hoursVzTz} h)`}
                    {mode === 'self' &&
                      `Präsenz: ${mod.inClassroomExample} h · Selbstlernen: ${mod.selfLearningExample} h`}
                  </div>
                </div>

                {/* Balken proportional zum Maximum 680 Std. */}
                <div className="mt-2 h-3.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                  <div
                    className="flex h-full overflow-hidden rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(8, pctTotal)}%` }}
                  >
                    {mode === 'vz' && (
                      <div
                        className={`h-full w-full bg-gradient-to-r ${mod.colorClass}`}
                      />
                    )}
                    {mode === 'bb' && (
                      <>
                        <div
                          style={{ width: `${bbY1Pct}%` }}
                          className="h-full bg-amber-500"
                          title={`1. Jahr: ${mod.hoursBbYear1} Std.`}
                        />
                        <div
                          style={{ width: `${100 - bbY1Pct}%` }}
                          className="h-full bg-teal-600"
                          title={`2./3. Jahr: ${mod.hoursBbYear23} Std.`}
                        />
                      </>
                    )}
                    {mode === 'self' && (
                      <>
                        <div
                          style={{ width: `${100 - selfPct}%` }}
                          className="h-full bg-slate-700 dark:bg-slate-400"
                          title={`Ortsgebundene Lernzeit: ${mod.inClassroomExample} Std.`}
                        />
                        <div
                          style={{ width: `${selfPct}%` }}
                          className="h-full bg-emerald-500"
                          title={`Selbstlernzeit: ${mod.selfLearningExample} Std.`}
                        />
                      </>
                    )}
                  </div>
                </div>

                {(mod.counselingHours || mod.integrationNote || mod.fhrCreditNote) && (
                  <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                    {mod.counselingHours && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" /> inkl. {mod.counselingHours} Std. Beratung/Supervision
                      </span>
                    )}
                    {mod.integrationNote && (
                      <span className="inline-flex items-center gap-1">
                        <Info className="h-3 w-3" /> {mod.integrationNote}
                      </span>
                    )}
                    {mod.fhrCreditNote && (
                      <span className="inline-flex items-center gap-1">
                        <BookOpen className="h-3 w-3" /> {mod.fhrCreditNote}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Legende für BB / Selbstlernzeiten */}
        {mode === 'bb' && (
          <div className="mt-4 flex flex-wrap gap-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <span className="h-3 w-3 rounded-sm bg-amber-500" />
              1. Jahr (800 Std.): auf Antrag anrechenbar bei abgeschlossener Sozialassistenz-Erstausbildung (Quereinstieg ins 2. Jahr)
            </span>
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <span className="h-3 w-3 rounded-sm bg-teal-600" />
              2./3. Jahr (1.600 Std.): Pflichtanteil für alle berufsbegleitend Lernenden
            </span>
          </div>
        )}
        {mode === 'self' && (
          <div className="mt-4 flex flex-wrap gap-4 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <span className="h-3 w-3 rounded-sm bg-slate-700 dark:bg-slate-400" />
              Ortsgebundene Lernzeit (Beispiel: 1.920 Std.)
            </span>
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <span className="h-3 w-3 rounded-sm bg-emerald-500" />
              Betreute Selbstlernzeit / Blended Learning (Beispiel: 480 Std. = max. 20 %)
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
