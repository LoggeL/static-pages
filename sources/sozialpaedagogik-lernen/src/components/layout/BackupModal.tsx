import React, { useState } from 'react';
import { Download, RotateCcw, Upload, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { useProgress } from '../../context/ProgressContext';
import { exportProgressJson } from '../../lib/storage';

interface BackupModalProps {
  open: boolean;
  onClose: () => void;
}

export const BackupModal: React.FC<BackupModalProps> = ({ open, onClose }) => {
  const { progress, importState, resetAllProgress } = useProgress();
  const [importText, setImportText] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  if (!open) return null;

  const handleDownload = () => {
    const json = exportProgressJson(progress);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sozialpaedagogik-fortschritt-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setFeedback({ ok: true, msg: 'Backup-Datei heruntergeladen.' });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        try {
          importState(reader.result);
          setFeedback({ ok: true, msg: 'Fortschritt erfolgreich wiederhergestellt!' });
        } catch (err) {
          setFeedback({
            ok: false,
            msg: err instanceof Error ? err.message : 'Import fehlgeschlagen.',
          });
        }
      }
    };
    reader.readAsText(file);
  };

  const handleImportText = () => {
    try {
      importState(importText);
      setImportText('');
      setFeedback({ ok: true, msg: 'JSON-Fortschritt erfolgreich importiert!' });
    } catch (err) {
      setFeedback({
        ok: false,
        msg: err instanceof Error ? err.message : 'Ungültiges JSON.',
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-ink-800">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-xl font-bold text-slate-900 dark:text-white">
            Lernfortschritt sichern & verwalten
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
            aria-label="Schließen"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Dein Fortschritt (abgeschlossene Einheiten, Quiz-Bestwerte, Lernkarten, Notizen und Streak) wird automatisch im <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">localStorage</code> gespeichert.
        </p>

        {feedback && (
          <div
            className={`mt-3 flex items-center gap-2 rounded-xl border p-3 text-xs font-semibold ${
              feedback.ok
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
                : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200'
            }`}
          >
            {feedback.ok ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            {feedback.msg}
          </div>
        )}

        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-teal-700"
            >
              <Download className="h-4 w-4" />
              Als JSON exportieren
            </button>

            <label className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              <Upload className="h-4 w-4" />
              Datei importieren
              <input
                type="file"
                accept="application/json"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          <div className="border-t border-slate-100 pt-4 dark:border-slate-700">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              Oder JSON direkt einfügen:
            </label>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={3}
              placeholder='{"version": 1, ...}'
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-mono text-xs text-slate-800 focus:border-teal-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            />
            {importText.trim() && (
              <button
                type="button"
                onClick={handleImportText}
                className="mt-2 rounded-xl bg-slate-900 px-3.5 py-1.5 text-xs font-bold text-white dark:bg-white dark:text-slate-900"
              >
                JSON importieren
              </button>
            )}
          </div>

          <div className="border-t border-slate-100 pt-4 dark:border-slate-700">
            {!confirmReset ? (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 hover:underline dark:text-rose-400"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Gesamten Fortschritt zurücksetzen
              </button>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-rose-50 p-3 dark:bg-rose-950/40">
                <span className="text-xs font-semibold text-rose-800 dark:text-rose-200">
                  Wirklich alle Quizze, Notizen & Lernkarten löschen?
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmReset(false)}
                    className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    Abbrechen
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetAllProgress();
                      setConfirmReset(false);
                      setFeedback({ ok: true, msg: 'Fortschritt zurückgesetzt.' });
                    }}
                    className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-bold text-white"
                  >
                    Endgültig löschen
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
