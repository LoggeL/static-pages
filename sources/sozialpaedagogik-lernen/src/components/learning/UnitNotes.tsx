import React, { useEffect, useState } from 'react';
import { CheckCircle2, ClipboardList, PenLine, Plus } from 'lucide-react';

interface UnitNotesProps {
  unitId: string;
  initialNote: string;
  selfLearningTasks: string[];
  onSaveNote: (text: string) => void;
}

export const UnitNotes: React.FC<UnitNotesProps> = ({
  unitId,
  initialNote,
  selfLearningTasks,
  onSaveNote,
}) => {
  const [text, setText] = useState(initialNote);
  const [savedLabel, setSavedLabel] = useState(false);

  useEffect(() => {
    setText(initialNote);
  }, [unitId, initialNote]);

  const handleChange = (val: string) => {
    setText(val);
    onSaveNote(val);
    setSavedLabel(true);
  };

  useEffect(() => {
    if (!savedLabel) return;
    const t = window.setTimeout(() => setSavedLabel(false), 1800);
    return () => window.clearTimeout(t);
  }, [savedLabel]);

  const insertTaskPrompt = (task: string) => {
    const prefix = text.trim() ? `${text.trim()}\n\n` : '';
    const next = `${prefix}## Selbstlernaufgabe: ${task}\n- Meine Beobachtung / Erkenntnis: `;
    handleChange(next);
  };

  return (
    <div className="space-y-5">
      {/* Anregungen für Selbstlernzeiten & Theorie-Praxis-Verzahnung */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-ink-800 sm:p-6">
        <div className="flex items-center gap-2 text-sm font-bold text-teal-700 dark:text-teal-300">
          <ClipboardList className="h-4 w-4" />
          Selbstlernzeit & Theorie-Praxis-Verzahnung (Lehrplan RLP)
        </div>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          Klicke auf eine Aufgabe, um sie direkt als Reflexionsvorlage in dein Lernjournal zu übernehmen.
        </p>

        <div className="mt-3 space-y-2">
          {selfLearningTasks.map((task, idx) => (
            <div
              key={idx}
              className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 text-sm dark:border-slate-700/70 dark:bg-slate-900/50"
            >
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-600 text-[11px] font-bold text-white">
                  {idx + 1}
                </span>
                <span className="leading-relaxed text-slate-800 dark:text-slate-200">
                  {task}
                </span>
              </div>
              <button
                type="button"
                onClick={() => insertTaskPrompt(task)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-teal-300 bg-white px-2.5 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-50 dark:border-teal-800 dark:bg-slate-800 dark:text-teal-300"
              >
                <Plus className="h-3.5 w-3.5" /> Ins Journal
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Persönliches Lernjournal */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-ink-800 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <PenLine className="h-4 w-4 text-amber-600" />
            <h3 className="font-serif text-lg font-bold text-slate-900 dark:text-white">
              Dein persönliches Lern- & Praxisjournal
            </h3>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {savedLabel ? 'Gerade im localStorage gespeichert' : 'Automatische Speicherung aktiv'}
          </span>
        </div>

        <textarea
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          rows={9}
          placeholder="Notiere hier eigene Praxisbeispiele aus deiner Einrichtung, offene Fragen für die Lerngruppe oder Stichpunkte zur Prüfungsvorbereitung..."
          className="mt-3 w-full rounded-2xl border border-slate-200 bg-paper-50 p-4 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </div>
    </div>
  );
};
