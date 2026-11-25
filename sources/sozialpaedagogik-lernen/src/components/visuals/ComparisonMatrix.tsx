import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Columns, LayoutGrid, Lightbulb } from 'lucide-react';
import { VisualBlock } from '../../types/curriculum';

const CARD_ACCENTS = [
  'border-t-sky-500',
  'border-t-emerald-500',
  'border-t-amber-500',
  'border-t-violet-500',
  'border-t-rose-500',
  'border-t-teal-500',
];

export const ComparisonMatrix: React.FC<{ block: VisualBlock }> = ({ block }) => {
  const items = block.items;
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const visibleItems =
    selectedIds.length > 0
      ? items.filter((it, idx) => selectedIds.includes(it.id || String(idx)))
      : items;

  const toggleFilter = (key: string) => {
    setSelectedIds((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedIds([])}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              selectedIds.length === 0
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            Alle ({items.length})
          </button>
          {items.map((item, idx) => {
            const key = item.id || String(idx);
            const active = selectedIds.includes(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleFilter(key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  active
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setViewMode('cards')}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
              viewMode === 'cards'
                ? 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Karten
          </button>
          <button
            type="button"
            onClick={() => setViewMode('table')}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
              viewMode === 'table'
                ? 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            <Columns className="h-3.5 w-3.5" /> Matrix
          </button>
        </div>
      </div>

      {viewMode === 'cards' ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {visibleItems.map((item, idx) => (
            <motion.div
              key={item.id || idx}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex flex-col justify-between rounded-2xl border border-t-4 border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700/80 dark:bg-ink-800 ${
                CARD_ACCENTS[idx % CARD_ACCENTS.length]
              }`}
            >
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-base font-bold text-slate-900 dark:text-white">
                    {item.label}
                  </h4>
                  {item.badge && (
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                      {item.badge}
                    </span>
                  )}
                </div>
                {item.metric && (
                  <div className="mt-2 inline-block rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                    {item.metric}
                  </div>
                )}
                <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {item.summary}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {item.detail}
                </p>
              </div>
              {item.example && (
                <div className="mt-3 flex items-start gap-2 rounded-xl bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
                  <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <span>{item.example}</span>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-ink-800">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Ansatz / Aspekt</th>
                <th className="px-4 py-3">Einordnung</th>
                <th className="px-4 py-3">Kernmerkmal & Erläuterung</th>
                <th className="px-4 py-3">Praxisbeispiel</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {visibleItems.map((item, idx) => (
                <tr key={item.id || idx} className="align-top hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">
                    {item.label}
                    {item.metric && (
                      <div className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                        {item.metric}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                      {item.badge || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                    <div className="font-semibold">{item.summary}</div>
                    <div className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      {item.detail}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    {item.example || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
