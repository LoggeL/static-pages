import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Lightbulb, ChevronRight } from 'lucide-react';
import { VisualBlock } from '../../types/curriculum';

const NODE_COLORS = [
  { fill: '#0ea5e9', soft: 'bg-sky-50 border-sky-200 text-sky-900 dark:bg-sky-950/50 dark:border-sky-800 dark:text-sky-100' },
  { fill: '#10b981', soft: 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/50 dark:border-emerald-800 dark:text-emerald-100' },
  { fill: '#f59e0b', soft: 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/50 dark:border-amber-800 dark:text-amber-100' },
  { fill: '#8b5cf6', soft: 'bg-violet-50 border-violet-200 text-violet-900 dark:bg-violet-950/50 dark:border-violet-800 dark:text-violet-100' },
  { fill: '#f43f5e', soft: 'bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/50 dark:border-rose-800 dark:text-rose-100' },
  { fill: '#14b8a6', soft: 'bg-teal-50 border-teal-200 text-teal-900 dark:bg-teal-950/50 dark:border-teal-800 dark:text-teal-100' },
];

function wrapLabel(text: string, maxLen = 16): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length <= maxLen) {
      current = (current + ' ' + word).trim();
    } else {
      if (current) lines.push(current);
      current = word.length > maxLen ? word.slice(0, maxLen - 1) + '…' : word;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

export const InteractiveConceptMap: React.FC<{ block: VisualBlock }> = ({ block }) => {
  const items = block.items.slice(0, 6);
  const [activeIdx, setActiveIdx] = useState(0);
  const activeItem = items[activeIdx] ?? items[0];

  const cx = 340;
  const cy = 205;
  const rx = 215;
  const ry = 138;

  const nodes = items.map((item, idx) => {
    const angle = -Math.PI / 2 + (idx * 2 * Math.PI) / items.length;
    const x = cx + Math.cos(angle) * rx;
    const y = cy + Math.sin(angle) * ry;
    return { item, idx, x, y, color: NODE_COLORS[idx % NODE_COLORS.length] };
  });

  const centerLines = wrapLabel(block.centerLabel || block.title, 18);

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50 to-paper-100/70 p-3 dark:border-slate-700/70 dark:from-slate-900/70 dark:to-ink-800">
        <svg
          viewBox="0 0 680 410"
          className="mx-auto h-auto w-full max-w-[680px] select-none"
          role="img"
          aria-label={block.title}
        >
          <defs>
            <radialGradient id={`center-grad-${block.id}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0f766e" />
              <stop offset="100%" stopColor="#115e59" />
            </radialGradient>
          </defs>

          {/* Verbindungslinien */}
          {nodes.map(({ idx, x, y, color }) => {
            const isActive = idx === activeIdx;
            const mx = (cx + x) / 2;
            const my = (cy + y) / 2 + (x > cx ? -16 : 16);
            return (
              <g key={`edge-${idx}`}>
                <path
                  d={`M ${cx} ${cy} Q ${mx} ${my} ${x} ${y}`}
                  fill="none"
                  stroke={isActive ? color.fill : '#94a3b8'}
                  strokeWidth={isActive ? 3.5 : 1.75}
                  strokeOpacity={isActive ? 0.95 : 0.4}
                  strokeDasharray={isActive ? undefined : '5 4'}
                  className="transition-all duration-300"
                />
              </g>
            );
          })}

          {/* Zentraler Kernknoten */}
          <g>
            <circle
              cx={cx}
              cy={cy}
              r={68}
              fill={`url(#center-grad-${block.id})`}
              className="drop-shadow-md"
            />
            <circle
              cx={cx}
              cy={cy}
              r={74}
              fill="none"
              stroke="#14b8a6"
              strokeOpacity={0.3}
              strokeWidth={2}
            />
            <text
              x={cx}
              y={cy - (centerLines.length - 1) * 8}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-white text-[13px] font-bold"
            >
              {centerLines.map((line, lIdx) => (
                <tspan key={lIdx} x={cx} dy={lIdx === 0 ? 0 : 17}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>

          {/* Äußere Konzeptknoten */}
          {nodes.map(({ item, idx, x, y, color }) => {
            const isActive = idx === activeIdx;
            const lines = wrapLabel(item.label, 16);
            return (
              <g
                key={item.id || idx}
                onClick={() => setActiveIdx(idx)}
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveIdx(idx);
                  }
                }}
              >
                {isActive && (
                  <circle
                    cx={x}
                    cy={y}
                    r={56}
                    fill={color.fill}
                    fillOpacity={0.14}
                  />
                )}
                <rect
                  x={x - 74}
                  y={y - 36}
                  width={148}
                  height={72}
                  rx={16}
                  fill={isActive ? color.fill : 'white'}
                  stroke={color.fill}
                  strokeWidth={isActive ? 2.5 : 1.75}
                  className="transition-all duration-200 dark:fill-slate-800"
                  style={isActive ? { fill: color.fill } : undefined}
                />
                <text
                  x={x}
                  y={y - (lines.length - 1) * 7}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className={`text-[12px] font-semibold transition-colors ${
                    isActive ? 'fill-white' : 'fill-slate-800 dark:fill-slate-100'
                  }`}
                >
                  {lines.map((line, lIdx) => (
                    <tspan key={lIdx} x={x} dy={lIdx === 0 ? 0 : 15}>
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Mobile/Quick Pills */}
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {nodes.map(({ item, idx, color }) => (
            <button
              key={item.id || idx}
              type="button"
              onClick={() => setActiveIdx(idx)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                idx === activeIdx
                  ? 'border-transparent text-white shadow-sm'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
              }`}
              style={idx === activeIdx ? { backgroundColor: color.fill } : undefined}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: idx === activeIdx ? '#fff' : color.fill }}
              />
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Detailkarte zum ausgewählten Knoten */}
      {activeItem && (
        <AnimatePresence mode="wait">
          <motion.div
            key={activeItem.id || activeIdx}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className={`rounded-2xl border p-4 shadow-sm ${
              NODE_COLORS[activeIdx % NODE_COLORS.length].soft
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {activeItem.badge && (
                  <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-xs font-semibold text-slate-800 dark:bg-slate-900/60 dark:text-slate-200">
                    {activeItem.badge}
                  </span>
                )}
                <h4 className="text-base font-bold">{activeItem.label}</h4>
              </div>
              {activeItem.metric && (
                <span className="inline-flex items-center gap-1 rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-medium dark:bg-white/10">
                  <Sparkles className="h-3 w-3" />
                  {activeItem.metric}
                </span>
              )}
            </div>
            <p className="mt-2 text-sm font-medium">{activeItem.summary}</p>
            <p className="mt-1.5 text-sm leading-relaxed opacity-90">{activeItem.detail}</p>
            {activeItem.example && (
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-white/75 p-3 text-xs leading-relaxed text-slate-800 dark:bg-slate-900/60 dark:text-slate-200">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <div>
                  <span className="font-semibold">Praxisbeispiel: </span>
                  {activeItem.example}
                </div>
              </div>
            )}
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setActiveIdx((activeIdx + 1) % items.length)}
                className="inline-flex items-center gap-1 text-xs font-semibold underline-offset-2 hover:underline"
              >
                Nächster Aspekt <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
};
