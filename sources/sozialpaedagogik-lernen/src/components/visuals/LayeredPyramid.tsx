import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, Lightbulb } from 'lucide-react';
import { VisualBlock } from '../../types/curriculum';

const LAYER_COLORS = [
  '#0f766e',
  '#0d9488',
  '#14b8a6',
  '#0284c7',
  '#4f46e5',
  '#7c3aed',
];

export const LayeredPyramid: React.FC<{ block: VisualBlock }> = ({ block }) => {
  // items[0] = Fundament (unten), items[last] = Spitze (oben)
  const items = block.items.slice(0, 6);
  const [activeIdx, setActiveIdx] = useState(0);
  const current = items[activeIdx] ?? items[0];

  if (!items.length) return null;

  const n = items.length;
  const totalH = 290;
  const topY = 18;
  const layerH = totalH / n;
  const centerX = 270;
  const maxHalfW = 240;
  const minHalfW = 55;

  // Render von oben (i = n - 1) nach unten (i = 0)
  const layers = [...items].map((item, idx) => {
    const revIdx = n - 1 - idx; // 0 = Spitze, n-1 = Fundament
    const y1 = topY + revIdx * layerH;
    const y2 = y1 + layerH - 4;
    const wTop = minHalfW + ((maxHalfW - minHalfW) * revIdx) / n;
    const wBot = minHalfW + ((maxHalfW - minHalfW) * (revIdx + 1)) / n;
    const points = `${centerX - wTop},${y1} ${centerX + wTop},${y1} ${
      centerX + wBot
    },${y2} ${centerX - wBot},${y2}`;
    return {
      item,
      idx,
      yMid: (y1 + y2) / 2,
      points,
      color: LAYER_COLORS[idx % LAYER_COLORS.length],
    };
  });

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700/70 dark:bg-slate-900/50 lg:col-span-6">
        <svg viewBox="0 0 540 325" className="mx-auto h-auto w-full max-w-[500px] select-none">
          {layers.map(({ item, idx, yMid, points, color }) => {
            const isActive = idx === activeIdx;
            const shortLabel =
              item.label.length > 26 ? item.label.slice(0, 24) + '…' : item.label;
            return (
              <g
                key={item.id || idx}
                onClick={() => setActiveIdx(idx)}
                className="cursor-pointer"
              >
                <polygon
                  points={points}
                  fill={color}
                  fillOpacity={isActive ? 1 : 0.65}
                  stroke={isActive ? '#0f172a' : '#ffffff'}
                  strokeWidth={isActive ? 2.5 : 1.5}
                  className="transition-all duration-200 hover:fill-opacity-90 dark:stroke-slate-900"
                />
                <text
                  x={centerX}
                  y={yMid + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="pointer-events-none fill-white text-[12px] font-bold drop-shadow-sm"
                >
                  {idx + 1}. {shortLabel}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="mt-1 flex justify-between px-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
          <span>Fundament: Ebene 1</span>
          <span>Spitze: Ebene {n}</span>
        </div>
      </div>

      <div className="space-y-3 lg:col-span-6">
        <div className="flex flex-wrap gap-1.5">
          {items.map((item, idx) => (
            <button
              key={item.id || idx}
              type="button"
              onClick={() => setActiveIdx(idx)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                idx === activeIdx
                  ? 'text-white shadow-sm'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
              }`}
              style={
                idx === activeIdx
                  ? { backgroundColor: LAYER_COLORS[idx % LAYER_COLORS.length] }
                  : undefined
              }
            >
              Ebene {idx + 1}
            </button>
          ))}
        </div>

        {current && (
          <AnimatePresence mode="wait">
            <motion.div
              key={current.id || activeIdx}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-ink-800"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-teal-600" />
                  <h4 className="text-base font-bold text-slate-900 dark:text-white">
                    {current.label}
                  </h4>
                </div>
                {current.badge && (
                  <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-800 dark:bg-teal-950/60 dark:text-teal-200">
                    {current.badge}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                {current.summary}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {current.detail}
              </p>
              {current.example && (
                <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50/70 p-3 text-xs leading-relaxed text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
                  <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <div>
                    <span className="font-semibold">Praxisbeispiel: </span>
                    {current.example}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
};
