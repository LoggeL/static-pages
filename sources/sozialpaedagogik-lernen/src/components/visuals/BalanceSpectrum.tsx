import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Scale, Lightbulb } from 'lucide-react';
import { VisualBlock } from '../../types/curriculum';

export const BalanceSpectrum: React.FC<{ block: VisualBlock }> = ({ block }) => {
  const items = block.items;
  const midIdx = Math.floor((items.length - 1) / 2);
  const [activeIdx, setActiveIdx] = useState(midIdx);
  const current = items[activeIdx] ?? items[0];

  if (!items.length) return null;

  // Neigungswinkel zwischen -16° (ganz links) und +16° (ganz rechts)
  const norm =
    items.length > 1 ? (activeIdx / (items.length - 1)) * 2 - 1 : 0; // -1 .. +1
  const tiltDeg = norm * 14;

  const isBalanced =
    items.length >= 3 && Math.abs(norm) <= 0.35;

  const getToneClass = (idx: number) => {
    const n = items.length > 1 ? (idx / (items.length - 1)) * 2 - 1 : 0;
    if (Math.abs(n) <= 0.35) {
      return 'border-emerald-500 bg-emerald-50 text-emerald-950 dark:border-emerald-600 dark:bg-emerald-950/45 dark:text-emerald-100';
    }
    if (Math.abs(n) <= 0.75) {
      return 'border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-100';
    }
    return 'border-rose-400 bg-rose-50 text-rose-950 dark:border-rose-600 dark:bg-rose-950/40 dark:text-rose-100';
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 dark:border-slate-700 dark:from-slate-900/70 dark:to-ink-800">
        {/* Dynamische SVG-Waage */}
        <svg viewBox="0 0 460 165" className="mx-auto h-auto w-full max-w-[440px] select-none">
          {/* Sockel & Ständer */}
          <polygon
            points="210,148 250,148 236,120 224,120"
            fill="#64748b"
          />
          <rect x="226" y="48" width="8" height="74" rx="4" fill="#64748b" />
          <circle cx="230" cy="48" r="8" fill={isBalanced ? '#10b981' : '#f59e0b'} />

          {/* Kippender Waagebalken */}
          <g
            transform={`rotate(${tiltDeg} 230 48)`}
            style={{ transition: 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)' }}
          >
            <rect
              x="70"
              y="44"
              width="320"
              height="8"
              rx="4"
              fill={isBalanced ? '#059669' : '#475569'}
            />
            {/* Linke Schale */}
            <line x1="88" y1="52" x2="72" y2="92" stroke="#94a3b8" strokeWidth="2" />
            <line x1="88" y1="52" x2="104" y2="92" stroke="#94a3b8" strokeWidth="2" />
            <path d="M 62 92 Q 88 108 114 92 Z" fill="#f43f5e" fillOpacity="0.85" />
            {/* Rechte Schale */}
            <line x1="372" y1="52" x2="356" y2="92" stroke="#94a3b8" strokeWidth="2" />
            <line x1="372" y1="52" x2="388" y2="92" stroke="#94a3b8" strokeWidth="2" />
            <path d="M 346 92 Q 372 108 398 92 Z" fill="#0ea5e9" fillOpacity="0.85" />
          </g>

          <text
            x="88"
            y="134"
            textAnchor="middle"
            className="fill-rose-700 text-[11px] font-bold dark:fill-rose-300"
          >
            {(block.leftPole || 'Pol A').slice(0, 26)}
          </text>
          <text
            x="372"
            y="134"
            textAnchor="middle"
            className="fill-sky-700 text-[11px] font-bold dark:fill-sky-300"
          >
            {(block.rightPole || 'Pol B').slice(0, 26)}
          </text>
        </svg>

        {/* Pol-Labels & Schieberegler */}
        <div className="mt-2 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-rose-700 dark:text-rose-300">
              ← {block.leftPole || 'Linker Extrempol'}
            </span>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
              Professionelle Balance
            </span>
            <span className="text-sky-700 dark:text-sky-300">
              {block.rightPole || 'Rechter Extrempol'} →
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={Math.max(0, items.length - 1)}
            step={1}
            value={activeIdx}
            onChange={(e) => setActiveIdx(Number(e.target.value))}
            aria-label="Position im Spannungsfeld wählen"
            className="h-2.5 w-full cursor-pointer accent-emerald-600"
          />

          <div className="flex flex-wrap justify-between gap-1.5 pt-1">
            {items.map((item, idx) => (
              <button
                key={item.id || idx}
                type="button"
                onClick={() => setActiveIdx(idx)}
                className={`flex-1 min-w-[110px] rounded-xl border px-2.5 py-2 text-center text-xs font-semibold transition ${
                  idx === activeIdx
                    ? 'border-slate-900 bg-slate-900 text-white shadow-sm dark:border-white dark:bg-white dark:text-slate-900'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {current && (
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id || activeIdx}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className={`rounded-2xl border p-4 shadow-sm ${getToneClass(activeIdx)}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Scale className="h-4 w-4" />
                <h4 className="text-base font-bold">{current.label}</h4>
              </div>
              {current.badge && (
                <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-xs font-semibold text-slate-800 dark:bg-slate-900/60 dark:text-slate-200">
                  {current.badge}
                </span>
              )}
            </div>
            <p className="mt-2 text-sm font-medium">{current.summary}</p>
            <p className="mt-1.5 text-sm leading-relaxed opacity-90">{current.detail}</p>
            {current.example && (
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-white/75 p-3 text-xs leading-relaxed text-slate-800 dark:bg-slate-900/60 dark:text-slate-200">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <div>
                  <span className="font-semibold">Konsequenz / Beispiel: </span>
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
