// =========================================================
// modules/inhalte.js – Neuigkeiten, Seiten & Fotos (Mediathek mit Kompression)
// Regeln & API: siehe CONVENTIONS.md
//
// Teile:
//   inhalte/common.js       Rechte-Helfer, Arbeitskopie/Veröffentlichen, Vorschau, Foto-Speicher (IndexedDB)
//   inhalte/editing.js      Autosave, Status-Kasten, Titelbild-Wahl
//   inhalte/neuigkeiten.js  #/admin/neuigkeiten, /neu, /:id
//   inhalte/seiten.js       #/admin/seiten, /:id   (feste Vorlagen)
//   inhalte/fotos.js        #/admin/fotos, /hochladen, /album/:id
//
// Grundsatz: Was auf der Website steht, ändert sich erst mit „Auf der Website zeigen“.
// Bei veröffentlichten Neuigkeiten/Seiten liegen Änderungen bis dahin in item.pending.
// =========================================================
import { db } from '../store.js';
import { formatDate } from '../ui.js';
import { registerHelp, registerSearchProvider } from '../admin.js';
import './inhalte/common.js';
import './inhalte/neuigkeiten.js';
import './inhalte/seiten.js';
import './inhalte/fotos.js';

/* ---------------- Hilfe („❓ Hilfe“) ---------------- */
registerHelp('/admin/neuigkeiten', { title: 'Neuigkeiten', steps: [
  'Auf „Neuigkeit schreiben“ tippen und eine Vorlage wählen – z. B. „Einladung zu einem Termin“.',
  'Text in eckigen Klammern wie „[Datum]“ durch Ihren eigenen ersetzen. Alles wird automatisch gespeichert.',
  'Mit „So sieht es auf der Website aus“ prüfen. Erst „Auf der Website zeigen“ macht die Neuigkeit öffentlich.',
  'Später etwas ändern? Die Website zeigt die alte Fassung, bis Sie „Änderungen auf der Website zeigen“ tippen.'] });
registerHelp('/admin/seiten', { title: 'Seiten der Website', steps: [
  'Seite antippen. Jede Seite hat eine feste Vorlage mit nummerierten Bereichen 1 bis 6.',
  'Rechts sehen Sie, wo welcher Bereich auf der Seite steht. Antippen springt zum Feld.',
  'Ihre Änderungen werden automatisch gespeichert – auf der Website erscheinen sie erst nach „Änderungen auf der Website zeigen“.',
  'Vertippt? „Änderungen verwerfen“ oder eine frühere Fassung zurückholen.'] });
registerHelp('/admin/fotos', { title: 'Fotos', steps: [
  'Auf „Fotos hochladen“ tippen – auf dem iPad öffnet sich die Fotosammlung. Mehrere Fotos auf einmal sind möglich.',
  'Die Fotos werden automatisch verkleinert: aus mehreren Megabyte werden wenige hundert Kilobyte.',
  'Unter jedem Foto fragen wir freundlich: „Was ist auf dem Bild zu sehen?“ – freiwillig.',
  'Alben erscheinen im „Rückblick“ auf der Website.'] });
registerHelp('/admin/fotos/hochladen', { title: 'Fotos hochladen', steps: [
  'Optional ein Album wählen (oben).',
  'Großen Knopf „Fotos auswählen“ antippen und die Fotos markieren.',
  'Warten, bis überall „✓ Fertig“ steht. Sie sehen, wie viel Platz gespart wurde.',
  'Wer mag, beschreibt kurz, was auf dem Bild zu sehen ist.'] });
registerHelp('/admin/fotos/album', { title: 'Album bearbeiten', steps: [
  'Name, Datum und ein paar Sätze eintragen – wird sofort gespeichert.',
  '„Als Titelbild“ bestimmt das Foto, das im Rückblick vorne zu sehen ist.',
  '„Aus dem Album nehmen“ löscht das Foto nicht – es bleibt bei allen Fotos.'] });

/* ---------------- Suche: Alben (Neuigkeiten/Seiten/Fotos sucht der Kern schon) ---------------- */
registerSearchProvider({ id: 'albums', label: 'Alben', permission: 'site.media.upload',
  search: q => db.all('albums').filter(a => [a.title, a.text].some(v => String(v || '').toLowerCase().includes(q)))
    .map(a => ({ icon: '🖼', title: a.title, sub: `Album · ${formatDate(a.date, 'monthYear')}`, href: `#/admin/fotos/album/${a.id}` })) });
