import React from 'react';
import {
  Clock,
  Columns,
  GitBranch,
  Layers,
  LayoutGrid,
  MessagesSquare,
  Network,
  Scale,
} from 'lucide-react';
import { VisualBlock, VisualKind } from '../../types/curriculum';
import { InteractiveConceptMap } from './InteractiveConceptMap';
import { ProcessFlowDiagram } from './ProcessFlowDiagram';
import { StageTimeline } from './StageTimeline';
import { ComparisonMatrix } from './ComparisonMatrix';
import { LayeredPyramid } from './LayeredPyramid';
import { BalanceSpectrum } from './BalanceSpectrum';
import { InteractiveGridCards } from './InteractiveGridCards';
import { DialogueSimulator } from './DialogueSimulator';

const KIND_META: Record<
  VisualKind,
  { label: string; icon: React.FC<{ className?: string }>; badgeClass: string }
> = {
  concept_map: {
    label: 'Interaktive Mindmap',
    icon: Network,
    badgeClass: 'bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-200',
  },
  process_flow: {
    label: 'Prozess & Ablauf',
    icon: GitBranch,
    badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
  },
  timeline: {
    label: 'Entwicklungs-Zeitstrahl',
    icon: Clock,
    badgeClass: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200',
  },
  comparison: {
    label: 'Vergleichsmatrix',
    icon: Columns,
    badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
  },
  pyramid: {
    label: 'Stufenmodell',
    icon: Layers,
    badgeClass: 'bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200',
  },
  spectrum: {
    label: 'Spannungsfeld-Waage',
    icon: Scale,
    badgeClass: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200',
  },
  feature_grid: {
    label: 'Struktur-Übersicht',
    icon: LayoutGrid,
    badgeClass: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200',
  },
  dialogue: {
    label: 'Dialog-Simulator',
    icon: MessagesSquare,
    badgeClass: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/60 dark:text-cyan-200',
  },
};

export const VisualBlockRenderer: React.FC<{ block: VisualBlock }> = ({ block }) => {
  const meta = KIND_META[block.kind] ?? KIND_META.feature_grid;
  const Icon = meta.icon;

  const renderVisual = () => {
    switch (block.kind) {
      case 'concept_map':
        return <InteractiveConceptMap block={block} />;
      case 'process_flow':
        return <ProcessFlowDiagram block={block} />;
      case 'timeline':
        return <StageTimeline block={block} />;
      case 'comparison':
        return <ComparisonMatrix block={block} />;
      case 'pyramid':
        return <LayeredPyramid block={block} />;
      case 'spectrum':
        return <BalanceSpectrum block={block} />;
      case 'dialogue':
        return <DialogueSimulator block={block} />;
      case 'feature_grid':
      default:
        return <InteractiveGridCards block={block} />;
    }
  };

  return (
    <section className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-ink-800 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${meta.badgeClass}`}
          >
            <Icon className="h-3.5 w-3.5" />
            {block.kind === 'process_flow' && block.isCycle
              ? 'Interaktiver Kreislauf'
              : meta.label}
          </span>
          <h3 className="mt-2 font-serif text-xl font-bold text-slate-900 dark:text-white">
            {block.title}
          </h3>
          {block.subtitle && (
            <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
              {block.subtitle}
            </p>
          )}
        </div>
      </div>

      {renderVisual()}
    </section>
  );
};
