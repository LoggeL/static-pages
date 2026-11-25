import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquareQuote, MessagesSquare, ChevronRight } from 'lucide-react';
import { VisualBlock } from '../../types/curriculum';

const BUBBLE_STYLES = [
  'bg-sky-50 border-sky-200 text-sky-950 dark:bg-sky-950/45 dark:border-sky-800 dark:text-sky-100',
  'bg-emerald-50 border-emerald-200 text-emerald-950 dark:bg-emerald-950/45 dark:border-emerald-800 dark:text-emerald-100',
  'bg-amber-50 border-amber-200 text-amber-950 dark:bg-amber-950/45 dark:border-amber-800 dark:text-amber-100',
  'bg-violet-50 border-violet-200 text-violet-950 dark:bg-violet-950/45 dark:border-violet-800 dark:text-violet-100',
  'bg-rose-50 border-rose-200 text-rose-950 dark:bg-rose-950/45 dark:border-rose-800 dark:text-rose-100',
];

export const DialogueSimulator: React.FC<{ block: VisualBlock }> = ({ block }) => {
  const items = block.items;
  const [activeIdx, setActiveIdx] = useState(0);
  const current = items[activeIdx] ?? items[0];

  if (!items.length) return null;

  return (
    <div className="space-y-4">
      {/* Gesprächs-/Perspektiven-Auswahl */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, idx) => {
          const isActive = idx === activeIdx;
          return (
            <button
              key={item.id || idx}
              type="button"
              onClick={() => setActiveIdx(idx)}
              className={`flex items-start gap-2.5 rounded-2xl border p-3 text-left transition ${
                isActive
                  ? 'border-sky-500 bg-sky-600 text-white shadow-md'
                  : 'border-slate-200 bg-white text-slate-800 hover:border-sky-300 dark:border-slate-700 dark:bg-ink-800 dark:text-slate-200'
              }`}
            >
              <div
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  isActive
                    ? 'bg-white text-sky-700'
                    : 'bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-200'
                }`}
              >
                {idx + 1}
              </div>
              <div className="min-w-0">
                {item.badge && (
                  <div
                    className={`text-[10px] font-bold uppercase tracking-wider ${
                      isActive ? 'text-sky-100' : 'text-sky-600 dark:text-sky-400'
                    }`}
                  >
                    {item.badge}
                  </div>
                )}
                <div className="text-sm font-bold leading-snug">{item.label}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Aktive Sprechblasen-Analyse */}
      {current && (
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id || activeIdx}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className={`rounded-2xl border p-4 shadow-sm ${
              BUBBLE_STYLES[activeIdx % BUBBLE_STYLES.length]
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MessagesSquare className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-wider opacity-75">
                  {current.badge || `Perspektive ${activeIdx + 1}`}
                </span>
              </div>
              {current.metric && (
                <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-xs font-semibold text-slate-800 dark:bg-slate-900/60 dark:text-slate-200">
                  {current.metric}
                </span>
              )}
            </div>

            <h4 className="mt-1.5 text-lg font-bold">{current.label}</h4>
            <p className="mt-1.5 text-sm font-medium">{current.summary}</p>
            <p className="mt-2 text-sm leading-relaxed opacity-90">{current.detail}</p>

            {current.example && (
              <div className="relative mt-4 rounded-2xl border border-white/60 bg-white/90 p-3.5 text-sm italic leading-relaxed text-slate-800 shadow-sm dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-100">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-bold not-italic text-sky-700 dark:text-sky-300">
                  <MessageSquareQuote className="h-4 w-4" />
                  Wörtliche Formulierungshilfe / Dialogbeispiel
                </div>
                „{current.example.replace(/^[„"]|[“"]$/g, '')}“
              </div>
            )}

            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setActiveIdx((activeIdx + 1) % items.length)}
                className="inline-flex items-center gap-1 text-xs font-bold hover:underline"
              >
                Nächste Gesprächsebene <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
};
