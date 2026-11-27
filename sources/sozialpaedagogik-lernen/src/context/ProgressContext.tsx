import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ProgressState } from '../types/curriculum';
import {
  computeNextQuizResultEntry,
  createDefaultProgress,
  importProgressJson,
  loadProgress,
  saveProgress,
  touchStreak,
} from '../lib/storage';

interface ProgressContextValue {
  progress: ProgressState;
  toggleUnitComplete: (unitId: string) => void;
  markSectionRead: (unitId: string, sectionIdx: number) => void;
  saveQuizResult: (
    unitId: string,
    score: number,
    total: number,
    answers: Record<string, number[]>
  ) => void;
  toggleFlashcardMastery: (unitId: string, cardIdx: number, mastered?: boolean) => void;
  markCaseStudyComplete: (unitId: string) => void;
  toggleBookmark: (unitId: string) => void;
  saveNote: (unitId: string, text: string) => void;
  setLastVisitedUnit: (unitId: string) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setOrgForm: (orgForm: 'vz' | 'bb') => void;
  importState: (jsonStr: string) => void;
  resetAllProgress: () => void;
}

const ProgressContext = createContext<ProgressContextValue | null>(null);

export const ProgressProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [progress, setProgress] = useState<ProgressState>(() => loadProgress());

  useEffect(() => {
    saveProgress(progress);
  }, [progress]);

  useEffect(() => {
    const isDark = progress.preferences.theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
  }, [progress.preferences.theme]);

  const toggleUnitComplete = useCallback((unitId: string) => {
    setProgress((prev) => {
      const nextCompleted = { ...prev.completedUnits };
      nextCompleted[unitId] = !nextCompleted[unitId];
      return touchStreak({
        ...prev,
        completedUnits: nextCompleted,
      });
    });
  }, []);

  const markSectionRead = useCallback((unitId: string, sectionIdx: number) => {
    if (!Number.isInteger(sectionIdx) || sectionIdx < 0) return;
    setProgress((prev) => {
      const existing = prev.sectionsRead[unitId] ?? [];
      if (existing.includes(sectionIdx)) return prev;
      return touchStreak({
        ...prev,
        sectionsRead: {
          ...prev.sectionsRead,
          [unitId]: [...existing, sectionIdx].sort((a, b) => a - b),
        },
      });
    });
  }, []);

  const saveQuizResult = useCallback(
    (unitId: string, score: number, total: number, answers: Record<string, number[]>) => {
      setProgress((prev) => {
        const prevEntry = prev.quizResults[unitId];
        const nextEntry = computeNextQuizResultEntry(prevEntry, score, total, answers);
        const passedNow = total > 0 && score / total >= 0.7;
        const nextCompleted = { ...prev.completedUnits };
        if (passedNow) {
          nextCompleted[unitId] = true;
        }
        return touchStreak({
          ...prev,
          completedUnits: nextCompleted,
          quizResults: {
            ...prev.quizResults,
            [unitId]: nextEntry,
          },
        });
      });
    },
    []
  );

  const toggleFlashcardMastery = useCallback(
    (unitId: string, cardIdx: number, mastered?: boolean) => {
      if (!Number.isInteger(cardIdx) || cardIdx < 0) return;
      setProgress((prev) => {
        const current = [...(prev.flashcardMastery[unitId] ?? [])];
        while (current.length <= cardIdx) current.push(false);
        current[cardIdx] = mastered !== undefined ? mastered : !current[cardIdx];
        return touchStreak({
          ...prev,
          flashcardMastery: {
            ...prev.flashcardMastery,
            [unitId]: current,
          },
        });
      });
    },
    []
  );

  const markCaseStudyComplete = useCallback((unitId: string) => {
    setProgress((prev) => {
      if (prev.caseStudyCompleted[unitId]) return prev;
      return touchStreak({
        ...prev,
        caseStudyCompleted: {
          ...prev.caseStudyCompleted,
          [unitId]: true,
        },
      });
    });
  }, []);

  const toggleBookmark = useCallback((unitId: string) => {
    setProgress((prev) => {
      const exists = prev.bookmarks.includes(unitId);
      const nextBookmarks = exists
        ? prev.bookmarks.filter((id) => id !== unitId)
        : [...prev.bookmarks, unitId];
      return {
        ...prev,
        bookmarks: nextBookmarks,
      };
    });
  }, []);

  const saveNote = useCallback((unitId: string, text: string) => {
    setProgress((prev) => ({
      ...prev,
      notes: {
        ...prev.notes,
        [unitId]: text,
      },
    }));
  }, []);

  const setLastVisitedUnit = useCallback((unitId: string) => {
    setProgress((prev) => {
      if (prev.lastVisitedUnitId === unitId) return prev;
      return {
        ...prev,
        lastVisitedUnitId: unitId,
      };
    });
  }, []);

  const setTheme = useCallback((theme: 'light' | 'dark') => {
    setProgress((prev) => ({
      ...prev,
      preferences: {
        ...prev.preferences,
        theme,
      },
    }));
  }, []);

  const setOrgForm = useCallback((orgForm: 'vz' | 'bb') => {
    setProgress((prev) => ({
      ...prev,
      preferences: {
        ...prev.preferences,
        orgForm,
      },
    }));
  }, []);

  const importState = useCallback((jsonStr: string) => {
    const imported = importProgressJson(jsonStr);
    setProgress(imported);
  }, []);

  const resetAllProgress = useCallback(() => {
    setProgress(createDefaultProgress());
  }, []);

  return (
    <ProgressContext.Provider
      value={{
        progress,
        toggleUnitComplete,
        markSectionRead,
        saveQuizResult,
        toggleFlashcardMastery,
        markCaseStudyComplete,
        toggleBookmark,
        saveNote,
        setLastVisitedUnit,
        setTheme,
        setOrgForm,
        importState,
        resetAllProgress,
      }}
    >
      {children}
    </ProgressContext.Provider>
  );
};

export function useProgress(): ProgressContextValue {
  const ctx = useContext(ProgressContext);
  if (!ctx) {
    throw new Error('useProgress muss innerhalb eines ProgressProvider verwendet werden.');
  }
  return ctx;
}
