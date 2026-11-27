import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Lightbulb } from 'lucide-react';
import { VisualBlock } from '../../types/curriculum';

export const StageTimeline: React.FC<{ block: VisualBlock }> = ({ block }) => {
  const items = block.items;
  const [activeIdx, setActiveIdx] = useState(0);
  const current = items[activeIdx] ?? items[0];

  if (!items.length) return null;

  const progressPct =
    items.length > 1 ? Math.round((activeIdx / (items.length - 1)) * 100) : 100;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-indigo-50/60 via-white to-sky-50/60 p-4 dark:border-slate-700/70 dark:from-indigo-950/30 dark:via-ink-800 dark:to-sky-950/30">
        {/* Zeitstrahl-Knoten */}
        <div className="overflow-x-auto pb-1">
          <div
            className="relative pt-2"
            style={{ minWidth: items.length > 3 ? `${items.length * 105}px` : undefined }}
          >
            <div className="absolute left-4 right-4 top-6 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-sky-500 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>

            <div className="relative z-10 grid gap-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
              {items.map((item, idx) => {
                const isActive = idx === activeIdx;
                const isReached = idx <= activeIdx;
                return (
                  <button
                    key={item.id || idx}
                    type="button"
                    onClick={() => setActiveIdx(idx)}
                    className="group flex flex-col items-center text-center focus:outline-none"
                  >
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-xs font-bold transition-all ${
                        isActive
                          ? 'scale-110 border-indigo-600 bg-indigo-600 text-white shadow-md'
                          : isReached
                          ? 'border-indigo-400 bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200'
                          : 'border-slate-300 bg-white text-slate-500 group-hover:border-indigo-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {idx + 1}
                    </div>
                    {item.badge && (
                      <span className="mt-1.5 rounded-full bg-indigo-100/80 px-2 py-0.5 text-[10px] font-semibold text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200">
                        {item.badge}
                      </span>
                    )}
                    <span
                      className={`mt-1 line-clamp-2 text-[11px] font-semibold leading-tight sm:text-xs ${
                        isActive
                          ? 'text-indigo-700 dark:text-indigo-300'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Interaktiver Scrubber */}
        {items.length > 1 && (
          <div className="mt-4 flex items-center gap-3 px-2">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Phase erkunden:
            </span>
            <input
              type="range"
              min={0}
              max={items.length - 1}
              step={1}
              value={activeIdx}
              onChange={(e) => setActiveIdx(Number(e.target.value))}
              aria-label="Phase auf Zeitstrahl auswählen"
              className="h-2 flex-1 cursor-pointer accent-indigo-600"
            />
          </div>
        )}
      </div>

      {/* Phasen-Details */}
      {current && (
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id || activeIdx}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.2 }}
            className="rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm dark:border-indigo-900/60 dark:bg-ink-800"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <h4 className="text-base font-bold text-slate-900 dark:text-white">
                  {current.label}
                </h4>
              </div>
              <div className="flex items-center gap-2">
                {current.badge && (
                  <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200">
                    {current.badge}
                  </span>
                )}
                {current.metric && (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {current.metric}
                  </span>
                )}
              </div>
            </div>
            <p className="mt-2 text-sm font-medium text-slate-800 dark:text-slate-200">
              {current.summary}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {current.detail}
            </p>
            {current.example && (
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-indigo-50/70 p-3 text-xs leading-relaxed text-indigo-950 dark:bg-indigo-950/35 dark:text-indigo-100">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <div>
                  <span className="font-semibold">In der Praxis: </span>
                  {current.example}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
};
