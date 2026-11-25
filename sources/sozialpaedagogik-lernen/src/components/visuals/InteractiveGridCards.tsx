import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronDown, ChevronUp, Lightbulb, Sparkles } from 'lucide-react';
import { VisualBlock } from '../../types/curriculum';

const GRID_PALETTES = [
  { border: 'border-t-emerald-500', badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200' },
  { border: 'border-t-sky-500', badge: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200' },
  { border: 'border-t-amber-500', badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200' },
  { border: 'border-t-violet-500', badge: 'bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200' },
  { border: 'border-t-rose-500', badge: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200' },
  { border: 'border-t-teal-500', badge: 'bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-200' },
];

export const InteractiveGridCards: React.FC<{ block: VisualBlock }> = ({ block }) => {
  const items = block.items;
  const [expanded, setExpanded] = useState<Record<number, boolean>>({ 0: true });
  const [understood, setUnderstood] = useState<Record<number, boolean>>({});

  const understoodCount = items.filter((_, i) => understood[i]).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>Klicke auf eine Karte für Detailwissen & Praxisbeispiel</span>
        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
          {understoodCount}/{items.length} verinnerlicht
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((item, idx) => {
          const palette = GRID_PALETTES[idx % GRID_PALETTES.length];
          const isOpen = Boolean(expanded[idx]);
          const isChecked = Boolean(understood[idx]);

          return (
            <div
              key={item.id || idx}
              className={`rounded-2xl border border-t-4 border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md dark:border-slate-700/80 dark:bg-ink-800 ${palette.border}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {item.badge && (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${palette.badge}`}>
                        {item.badge}
                      </span>
                    )}
                    {item.metric && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        <Sparkles className="h-3 w-3" /> {item.metric}
                      </span>
                    )}
                  </div>
                  <h4 className="mt-1.5 text-sm font-bold text-slate-900 dark:text-white sm:text-base">
                    {item.label}
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setUnderstood((prev) => ({ ...prev, [idx]: !prev[idx] }))
                  }
                  title="Als verstanden abhaken"
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition ${
                    isChecked
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : 'border-slate-300 text-slate-400 hover:border-emerald-400 hover:text-emerald-500 dark:border-slate-600'
                  }`}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </div>

              <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                {item.summary}
              </p>

              <button
                type="button"
                onClick={() =>
                  setExpanded((prev) => ({ ...prev, [idx]: !prev[idx] }))
                }
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300"
              >
                {isOpen ? (
                  <>
                    Weniger anzeigen <ChevronUp className="h-3.5 w-3.5" />
                  </>
                ) : (
                  <>
                    Details & Praxisbeispiel <ChevronDown className="h-3.5 w-3.5" />
                  </>
                )}
              </button>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <p className="mt-2.5 border-t border-slate-100 pt-2.5 text-xs leading-relaxed text-slate-600 dark:border-slate-700/70 dark:text-slate-300 sm:text-sm">
                      {item.detail}
                    </p>
                    {item.example && (
                      <div className="mt-2.5 flex items-start gap-2 rounded-xl bg-amber-50/75 p-2.5 text-xs leading-relaxed text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
                        <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                        <span>{item.example}</span>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
};
