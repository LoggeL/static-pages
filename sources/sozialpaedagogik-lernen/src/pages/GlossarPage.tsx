import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookMarked, Check, Lightbulb, Search } from 'lucide-react';
import { ALL_FLASHCARDS } from '../data/units';
import { CURRICULUM_MODULES } from '../data/modules';
import { useProgress } from '../context/ProgressContext';

export const GlossarPage: React.FC = () => {
  const { progress, toggleFlashcardMastery } = useProgress();
  const [query, setQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState('alle');
  const [masteryFilter, setMasteryFilter] = useState<'alle' | 'gelernt' | 'offen'>('alle');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ALL_FLASHCARDS.filter((item) => {
      if (moduleFilter !== 'alle' && item.moduleCode !== moduleFilter) return false;
      const isMastered = Boolean(
        progress.flashcardMastery[item.unitId]?.[item.cardIndex]
      );
      if (masteryFilter === 'gelernt' && !isMastered) return false;
      if (masteryFilter === 'offen' && isMastered) return false;
      if (q) {
        const hay = `${item.term} ${item.definition} ${item.example} ${item.unitTitle}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => a.term.localeCompare(b.term, 'de'));
  }, [query, moduleFilter, masteryFilter, progress.flashcardMastery]);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-ink-800">
        <div className="inline-flex items-center gap-2 rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200">
          <BookMarked className="h-3.5 w-3.5" />
          Fachbegriffe-Glossar · {ALL_FLASHCARDS.length} Begriffe
        </div>
        <h1 className="mt-2 font-serif text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">
          Sozialpädagogisches Fachlexikon
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Durchsuche alle Lernkarten-Begriffe aus den 50 Lerneinheiten, hake gelernte Begriffe direkt ab oder springe in die passende Einheit.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Begriff, Definition oder Praxisbeispiel suchen..."
              className="w-full rounded-xl border border-slate-200 bg-paper-50 py-2 pl-9 pr-4 text-sm focus:border-teal-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>

          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            aria-label="Nach Modul filtern"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="alle">Alle Module</option>
            {CURRICULUM_MODULES.map((m) => (
              <option key={m.code} value={m.code}>
                {m.code} — {m.shortTitle}
              </option>
            ))}
          </select>

          <select
            value={masteryFilter}
            onChange={(e) =>
              setMasteryFilter(e.target.value as 'alle' | 'gelernt' | 'offen')
            }
            aria-label="Nach Lernstand filtern"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="alle">Alle Begriffe ({ALL_FLASHCARDS.length})</option>
            <option value="gelernt">Bereits gewusst</option>
            <option value="offen">Noch üben</option>
          </select>
        </div>
      </section>

      <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
        {filtered.length} Treffer angezeigt
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {filtered.map((card) => {
          const isMastered = Boolean(
            progress.flashcardMastery[card.unitId]?.[card.cardIndex]
          );
          return (
            <div
              key={`${card.unitId}-${card.cardIndex}`}
              className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-soft dark:border-slate-800 dark:bg-ink-800"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {card.moduleCode} · E{String(card.unitNumber).padStart(2, '0')}
                    </span>
                    <h3 className="mt-1.5 font-serif text-lg font-bold text-slate-900 dark:text-white">
                      {card.term}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      toggleFlashcardMastery(card.unitId, card.cardIndex, !isMastered)
                    }
                    title={isMastered ? 'Als offen markieren' : 'Als gewusst abhaken'}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition ${
                      isMastered
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-slate-300 text-slate-400 hover:border-emerald-400 dark:border-slate-600'
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                </div>

                <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  {card.definition}
                </p>
                {card.example && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50/75 p-2.5 text-xs leading-relaxed text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
                    <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span>{card.example}</span>
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 dark:border-slate-800">
                <span className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                  {card.unitTitle}
                </span>
                <Link
                  to={`/einheit/${card.unitId}`}
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-teal-700 hover:underline dark:text-teal-300"
                >
                  Zur Einheit <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
