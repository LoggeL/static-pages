import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  RotateCw,
  Shuffle,
} from 'lucide-react';
import type { Flashcard } from '../../types/curriculum';

interface FlashcardDeckProps {
  cards: Flashcard[];
  mastery: boolean[];
  onToggleMastery: (cardIndex: number, mastered: boolean) => void;
}

export const FlashcardDeck: React.FC<FlashcardDeckProps> = ({
  cards,
  mastery,
  onToggleMastery,
}) => {
  const [order, setOrder] = useState<number[]>(() => cards.map((_, i) => i));
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    setOrder(cards.map((_, i) => i));
    setPos(0);
    setFlipped(false);
  }, [cards]);

  const cardIndex = order[pos] ?? 0;
  const card = cards[cardIndex];
  const masteredCount = cards.filter((_, idx) => Boolean(mastery[idx])).length;

  const goPrev = useCallback(() => {
    if (!order.length) return;
    setFlipped(false);
    setPos((p) => (p - 1 + order.length) % order.length);
  }, [order.length]);

  const goNext = useCallback(() => {
    if (!order.length) return;
    setFlipped(false);
    setPos((p) => (p + 1) % order.length);
  }, [order.length]);

  const handleShuffle = () => {
    const next = [...order];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    setOrder(next);
    setPos(0);
    setFlipped(false);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === 'ArrowRight') {
        goNext();
      } else if (e.key === 'ArrowLeft') {
        goPrev();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goNext, goPrev]);

  if (!card) return null;

  const isMastered = Boolean(mastery[cardIndex]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
          <span>
            Karte {pos + 1} von {cards.length}
          </span>
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
            {masteredCount}/{cards.length} gewusst
          </span>
        </div>

        <button
          type="button"
          onClick={handleShuffle}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <Shuffle className="h-3.5 w-3.5" /> Mischen
        </button>
      </div>

      {/* 3D Flipcard (Grid-Stack verhindert Abschneiden auf schmalen Displays) */}
      <div
        className="perspective-1000 cursor-pointer select-none"
        onClick={() => setFlipped((f) => !f)}
        role="button"
        tabIndex={0}
        aria-pressed={flipped}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setFlipped((f) => !f);
        }}
      >
        <div
          className={`preserve-3d relative grid min-h-[260px] w-full transition-transform duration-500 ${
            flipped ? 'rotate-y-180' : ''
          }`}
        >
          {/* Vorderseite */}
          <div className="backface-hidden col-start-1 row-start-1 flex flex-col items-center justify-center rounded-3xl border border-slate-200 bg-gradient-to-br from-white to-paper-100 p-6 text-center shadow-card dark:border-slate-700 dark:from-ink-800 dark:to-slate-900">
            <span className="rounded-full bg-teal-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-teal-800 dark:bg-teal-900/60 dark:text-teal-200">
              Fachbegriff
            </span>
            <h3 className="mt-4 break-words font-serif text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">
              {card.term}
            </h3>
            <p className="mt-4 text-xs font-medium text-slate-500 dark:text-slate-400">
              Klicken oder Leertaste drücken zum Umdrehen
            </p>
          </div>

          {/* Rückseite */}
          <div className="backface-hidden rotate-y-180 col-start-1 row-start-1 flex flex-col justify-between rounded-3xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-5 shadow-card dark:border-teal-800 dark:from-teal-950/60 dark:to-ink-800 sm:p-6">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300">
                  {card.term}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Definition &amp; Praxis
                </span>
              </div>
              <p className="mt-3 text-sm font-medium leading-relaxed text-slate-900 dark:text-white sm:text-base">
                {card.definition}
              </p>
            </div>

            {card.example && (
              <div className="mt-4 flex items-start gap-2 rounded-2xl bg-white/90 p-3 text-xs leading-relaxed text-slate-700 shadow-sm dark:bg-slate-900/75 dark:text-slate-200">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <div>
                  <span className="font-semibold">Praxisbeispiel: </span>
                  {card.example}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Steuerung */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={goPrev}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <ChevronLeft className="h-4 w-4" /> Vorherige
          </button>
          <button
            type="button"
            onClick={goNext}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            Nächste <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              onToggleMastery(cardIndex, false);
              goNext();
            }}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-bold transition ${
              !isMastered
                ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            <RotateCw className="h-3.5 w-3.5" /> Nochmal üben
          </button>
          <button
            type="button"
            onClick={() => {
              onToggleMastery(cardIndex, true);
              goNext();
            }}
            className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition ${
              isMastered
                ? 'bg-emerald-600 text-white'
                : 'bg-emerald-500 text-white hover:bg-emerald-600'
            }`}
          >
            <Check className="h-3.5 w-3.5" /> Gewusst ✓
          </button>
        </div>
      </div>

      {/* Karten-Punkte */}
      <div className="flex flex-wrap justify-center gap-1.5 pt-1">
        {order.map((origIdx, i) => (
          <button
            key={origIdx}
            type="button"
            onClick={() => {
              setFlipped(false);
              setPos(i);
            }}
            aria-label={`Karte ${i + 1}`}
            className={`h-2.5 rounded-full transition-all ${
              i === pos
                ? 'w-7 bg-slate-900 dark:bg-white'
                : mastery[origIdx]
                ? 'w-2.5 bg-emerald-500'
                : 'w-2.5 bg-slate-300 dark:bg-slate-700'
            }`}
          />
        ))}
      </div>
    </div>
  );
};
