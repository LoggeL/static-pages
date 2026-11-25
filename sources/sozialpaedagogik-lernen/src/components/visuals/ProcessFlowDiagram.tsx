import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, ChevronLeft, ChevronRight, Lightbulb, RotateCw } from 'lucide-react';
import { VisualBlock } from '../../types/curriculum';

export const ProcessFlowDiagram: React.FC<{ block: VisualBlock }> = ({ block }) => {
  const items = block.items;
  const [activeIdx, setActiveIdx] = useState(0);
  const current = items[activeIdx] ?? items[0];

  if (!items.length) return null;

  const isCycle = Boolean(block.isCycle);

  return (
    <div className="space-y-4">
      {isCycle ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700/70 dark:bg-slate-900/50">
          <div className="grid grid-cols-1 items-center gap-4 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <svg viewBox="0 0 380 320" className="mx-auto h-auto w-full max-w-[360px]">
                <defs>
                  <marker
                    id={`arrow-${block.id}`}
                    markerWidth="8"
                    markerHeight="8"
                    refX="6"
                    refY="3"
                    orient="auto"
                  >
                    <path d="M0,0 L0,6 L7,3 z" fill="#0d9488" />
                  </marker>
                </defs>
                <circle
                  cx={190}
                  cy={160}
                  r={104}
                  fill="none"
                  stroke="#99f6e4"
                  strokeWidth={6}
                  className="dark:stroke-teal-900/60"
                />
                <circle
                  cx={190}
                  cy={160}
                  r={104}
                  fill="none"
                  stroke="#0d9488"
                  strokeWidth={2}
                  strokeDasharray="6 6"
                />
                <g>
                  <circle
                    cx={190}
                    cy={160}
                    r={42}
                    fill="#0f766e"
                    className="dark:fill-teal-800"
                  />
                  <text
                    x={190}
                    y={156}
                    textAnchor="middle"
                    className="fill-white text-[11px] font-bold"
                  >
                    Kreislauf
                  </text>
                  <text
                    x={190}
                    y={172}
                    textAnchor="middle"
                    className="fill-teal-100 text-[10px]"
                  >
                    Schritt {activeIdx + 1}/{items.length}
                  </text>
                </g>

                {items.map((item, idx) => {
                  const angle = -Math.PI / 2 + (idx * 2 * Math.PI) / items.length;
                  const nx = 190 + Math.cos(angle) * 104;
                  const ny = 160 + Math.sin(angle) * 104;
                  const isActive = idx === activeIdx;

                  const nextAngle =
                    -Math.PI / 2 + (((idx + 1) % items.length) * 2 * Math.PI) / items.length;
                  const midAngle =
                    angle +
                    ((nextAngle - angle + 2 * Math.PI) % (2 * Math.PI)) * 0.5;
                  const ax1 = 190 + Math.cos(midAngle - 0.14) * 104;
                  const ay1 = 160 + Math.sin(midAngle - 0.14) * 104;
                  const ax2 = 190 + Math.cos(midAngle + 0.14) * 104;
                  const ay2 = 160 + Math.sin(midAngle + 0.14) * 104;

                  return (
                    <g key={item.id || idx}>
                      <line
                        x1={ax1}
                        y1={ay1}
                        x2={ax2}
                        y2={ay2}
                        stroke="#0d9488"
                        strokeWidth={2}
                        markerEnd={`url(#arrow-${block.id})`}
                      />
                      <g
                        onClick={() => setActiveIdx(idx)}
                        className="cursor-pointer"
                      >
                        <circle
                          cx={nx}
                          cy={ny}
                          r={isActive ? 25 : 21}
                          fill={isActive ? '#0d9488' : '#ffffff'}
                          stroke="#0d9488"
                          strokeWidth={isActive ? 3 : 2}
                          className="transition-all duration-200 dark:fill-slate-800"
                          style={isActive ? { fill: '#0d9488' } : undefined}
                        />
                        <text
                          x={nx}
                          y={ny + 1}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          className={`text-[12px] font-bold ${
                            isActive ? 'fill-white' : 'fill-teal-800 dark:fill-teal-200'
                          }`}
                        >
                          {idx + 1}
                        </text>
                      </g>
                    </g>
                  );
                })}
              </svg>
            </div>

            <div className="space-y-2 lg:col-span-6">
              {items.map((item, idx) => {
                const isActive = idx === activeIdx;
                return (
                  <button
                    key={item.id || idx}
                    type="button"
                    onClick={() => setActiveIdx(idx)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                      isActive
                        ? 'border-teal-500 bg-teal-50 shadow-sm dark:border-teal-500 dark:bg-teal-950/50'
                        : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70'
                    }`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        isActive
                          ? 'bg-teal-600 text-white'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {item.label}
                      </div>
                      {item.badge && (
                        <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                          {item.badge}
                        </div>
                      )}
                    </div>
                    <RotateCw className="h-3.5 w-3.5 shrink-0 text-teal-500 opacity-60" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700/70 dark:bg-slate-900/50">
          {/* Linearer Ablauf */}
          <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
            {items.map((item, idx) => {
              const isActive = idx === activeIdx;
              const isPast = idx < activeIdx;
              return (
                <React.Fragment key={item.id || idx}>
                  <button
                    type="button"
                    onClick={() => setActiveIdx(idx)}
                    className={`group flex flex-1 flex-col justify-between rounded-xl border p-3 text-left transition ${
                      isActive
                        ? 'border-teal-500 bg-teal-600 text-white shadow-md'
                        : isPast
                        ? 'border-teal-200 bg-teal-50/80 text-teal-950 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-100'
                        : 'border-slate-200 bg-white text-slate-800 hover:border-teal-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                          isActive
                            ? 'bg-white text-teal-700'
                            : isPast
                            ? 'bg-teal-600 text-white'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {idx + 1}
                      </span>
                      {item.badge && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            isActive
                              ? 'bg-white/20 text-white'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 text-xs font-bold leading-snug sm:text-sm">
                      {item.label}
                    </div>
                  </button>
                  {idx < items.length - 1 && (
                    <div className="hidden items-center justify-center md:flex">
                      <ArrowRight
                        className={`h-4 w-4 ${
                          idx < activeIdx ? 'text-teal-600' : 'text-slate-400'
                        }`}
                      />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* Schritt-Inspektor */}
      {current && (
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id || activeIdx}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="rounded-2xl border border-teal-200 bg-white p-4 shadow-sm dark:border-teal-900/60 dark:bg-ink-800"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-teal-600 px-2.5 py-1 text-xs font-bold text-white">
                  Schritt {activeIdx + 1} von {items.length}
                </span>
                <h4 className="text-base font-bold text-slate-900 dark:text-white">
                  {current.label}
                </h4>
              </div>
              {current.metric && (
                <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-800 dark:bg-teal-950/60 dark:text-teal-200">
                  {current.metric}
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
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50/80 p-3 text-xs leading-relaxed text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <div>
                  <span className="font-semibold">Praxisumsetzung: </span>
                  {current.example}
                </div>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-700/60">
              <button
                type="button"
                disabled={!isCycle && activeIdx === 0}
                onClick={() =>
                  setActiveIdx((activeIdx - 1 + items.length) % items.length)
                }
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Zurück
              </button>
              <div className="flex gap-1.5">
                {items.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Schritt ${i + 1}`}
                    onClick={() => setActiveIdx(i)}
                    className={`h-2 rounded-full transition-all ${
                      i === activeIdx ? 'w-6 bg-teal-600' : 'w-2 bg-slate-300 dark:bg-slate-600'
                    }`}
                  />
                ))}
              </div>
              <button
                type="button"
                disabled={!isCycle && activeIdx === items.length - 1}
                onClick={() => setActiveIdx((activeIdx + 1) % items.length)}
                className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-700 disabled:opacity-40"
              >
                Weiter <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
};
