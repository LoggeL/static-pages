// =========================================================
// modules/benutzer/technik.js – Infoseite „So funktioniert das System“
// Wird in der Verwaltung (#/admin/technik) und öffentlich
// (#/so-funktionierts) gezeigt. Zielgruppe: Vorstand / Julian.
// =========================================================
import { h, button, pageHeader } from '../../ui.js';
import { roles, can, currentUser, hasAdminAccess } from '../../auth.js';

const FACTS = [
  { icon: '🛠', title: 'Eigenbau statt Joomla', text: 'Genau zugeschnitten auf den Verein – nur die Knöpfe, die wirklich gebraucht werden. Keine Plugins, keine Update-Sorgen.' },
  { icon: '💶', title: 'ca. 4–5 € im Monat', text: 'Ein einziger kleiner Server (VPS) reicht für Website, Verwaltung, Ablage und Fotos.' },
  { icon: '🇩🇪', title: 'Server in Deutschland', text: 'Alle Daten liegen bei einem deutschen Anbieter – passend zur DSGVO, mit Vertrag zur Auftragsverarbeitung.' },
  { icon: '🔑', title: 'Kein Passwort nötig', text: 'Anmelden per Link in der E-Mail. Man bleibt auf dem eigenen Tablet 180 Tage angemeldet.' },
];

const COMPARE = [
  ['Wo die Daten liegen', 'Nur in diesem Browser (localStorage). Mit „Demo zurücksetzen“ ist alles wieder wie am Anfang.', 'In einer Datenbank-Datei (SQLite) auf dem Server – für alle gleich, mit täglicher Sicherung.'],
  ['E-Mails', 'Werden nur als Vorschau gezeigt („Diese E-Mail würde verschickt“).', 'Gehen wirklich raus – über Resend, Absender noreply@kolping-ramsen.de.'],
  ['Anmelden', 'Person antippen, Vorschau-Mail, grüner Knopf.', 'E-Mail-Adresse eingeben, echter Link (30 Minuten gültig, nur einmal benutzbar).'],
  ['Rollen wechseln', 'Leiste „Demo: Rolle wechseln“ oben – nur zum Vorführen.', 'Gibt es nicht. Jede Person hat ihren eigenen Zugang.'],
  ['Rechte prüfen', 'Im Browser – zeigt, wie es sich anfühlt.', 'Auf dem Server bei jeder Anfrage: Seiten, Suche, Downloads, Direktlinks.'],
  ['Fotos verkleinern', 'Echt: Der Browser verkleinert auf 1600 Pixel (WebP).', 'Genauso – plus Nachbearbeitung auf dem Server; Standortdaten (GPS) werden entfernt.'],
  ['Gemeinsam Protokoll schreiben', 'Simuliert: „Klaus schreibt gerade …“ ist vorgespielt.', 'Echt live: Mehrere Personen schreiben gleichzeitig, jede mit eigenem farbigem Cursor.'],
  ['Kalender-Abo', 'Termine als Datei herunterladen.', 'Feste Abo-Adresse – neue Termine erscheinen von selbst im Handy-Kalender.'],
];

const COSTS = [
  ['Kleiner Server (VPS) in Deutschland', 'ca. 4–5 €'],
  ['Speicher für Sicherungskopien (anderer Standort)', 'ca. 1 €'],
  ['E-Mail-Versand über Resend', '0 € (bis 3.000 E-Mails im Monat kostenlos)'],
  ['Webadresse kolping-ramsen.de', 'besteht schon'],
];

function section(title, kicker, ...kids) {
  return h('section', { class: 'benutzer-tech__section' },
    kicker ? h('p', { class: 'benutzer-tech__kicker' }, kicker) : null,
    h('h2', {}, title), ...kids);
}

function diagram() {
  const box = (cls, icon, title, lines) => h('div', { class: `benutzer-arch__box ${cls}` },
    h('div', { class: 'benutzer-arch__title' }, h('span', { 'aria-hidden': 'true' }, icon, ' '), title),
    lines ? h('ul', {}, lines.map(l => h('li', {}, l))) : null);
  const arrow = (label) => h('div', { class: 'benutzer-arch__arrow', 'aria-hidden': 'true' }, h('span', {}, label));
  return h('figure', { class: 'benutzer-arch' },
    h('div', { class: 'benutzer-arch__row' },
      box('benutzer-arch__box--client', '📱', 'Tablet, Laptop oder Handy', ['Website ansehen', 'Verwaltung im Browser – keine App nötig']),
      arrow('sicher verschlüsselt (HTTPS)'),
      box('benutzer-arch__box--server', '🖥', 'Ein kleiner Server in Deutschland', [
        'Website & Verwaltung (eine einzige Anwendung)',
        'Datenbank: SQLite – eine Datei, kein Datenbank-Server',
        'Fotos & Dateien – beim Hochladen verkleinert',
        'Live-Mitschreiben bei Protokollen',
      ])),
    h('div', { class: 'benutzer-arch__row benutzer-arch__row--side' },
      box('benutzer-arch__box--ext', '✉️', 'Resend', ['verschickt Anmelde-Links, Einladungen, Passwort-Links']),
      box('benutzer-arch__box--ext', '💾', 'Sicherungskopie', ['jede Nacht, verschlüsselt', 'an einem anderen Ort'])),
    h('figcaption', { class: 'muted' }, 'Bild: So hängen die Teile zusammen. Alles außer dem E-Mail-Versand läuft auf einem einzigen kleinen Server.'));
}

/**
 * Baut die Infoseite in el.
 * mode: 'admin' (in der Verwaltung) | 'public' (öffentliche Seite, z. B. aus dem Rundgang verlinkt)
 */
export function technikPage(el, { mode = 'admin', roleAreas = [], areaStatus = () => 'no', rolePlain = r => r.description } = {}) {
  const order = ['admin', 'vorstand', 'redakteur', 'mitglied'];
  const roleList = roles().slice().sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const loggedIn = !!currentUser();

  const content = h('div', { class: 'benutzer-tech' },
    h('div', { class: 'benutzer-tech__facts' }, FACTS.map(f => h('article', { class: 'benutzer-tech__fact' },
      h('span', { class: 'benutzer-tech__fact-icon', 'aria-hidden': 'true' }, f.icon),
      h('h3', {}, f.title), h('p', {}, f.text)))),

    section('So ist es aufgebaut', 'Technik in einem Bild',
      diagram(),
      h('p', {}, 'Statt eines großen Baukastens wie Joomla oder WordPress gibt es ein schlankes, eigenes Programm. Es macht nur das, was der Verein braucht: Website, Termine, Neuigkeiten, Fotos, Ablage für den Vorstand und Protokolle. Weniger Teile heißt: weniger, was kaputtgehen kann, und weniger Angriffsfläche.'),
      h('p', {}, 'Die Daten liegen in ', h('b', {}, 'SQLite'), ' – einer einzigen Datenbank-Datei. Das reicht für einen Verein locker aus, braucht kaum Arbeitsspeicher und lässt sich mit einem Handgriff sichern.')),

    section('Rollen & Rechte', 'Wer darf was?',
      h('p', {}, 'Jede Person hat genau eine Rolle. Eine Rolle ist ein Bündel von Rechten, zum Beispiel „Termine eintragen“ oder „Ablage öffnen“. Eine einzige Prüf-Funktion entscheidet überall, was angezeigt wird – im echten System prüft zusätzlich der Server jede Anfrage.'),
      h('div', { class: 'benutzer-tech__roles' }, roleList.map(r => h('article', { class: 'benutzer-tech__role', style: { '--rc': r.color } },
        h('h3', {}, r.label),
        h('p', {}, rolePlain(r)),
        h('p', { class: 'benutzer-tech__role-yes' }, h('b', {}, '✓ '), roleAreas.filter(a => areaStatus(r, a) !== 'no').map(a => a.label).join(' · ') || '—')))),
      h('div', { class: 'benutzer-tech__callout' },
        h('span', { 'aria-hidden': 'true' }, '🔒'),
        h('p', {}, h('b', {}, 'Wichtig: '), 'Redakteure (z. B. wer die Website pflegt) sehen die Dateiablage des Vorstands gar nicht – kein Menüpunkt, keine Treffer in der Suche, nicht im Foto-Auswahldialog, und ein Direktlink zeigt nur „Kein Zugriff“. Jeder Ordner trägt ein Schild: „🌐 Öffentlich“, „👥 Alle Mitglieder“ oder „🔒 Nur Vorstand“; Unterordner erben es.'))),

    section('Fotos brauchen wenig Platz', 'Bilder',
      h('p', {}, 'Ein Handyfoto hat heute oft 3–5 MB. Beim Hochladen wird es automatisch auf höchstens 1600 Pixel Breite verkleinert und im modernen WebP-Format gespeichert. Auf dem Bildschirm sieht man keinen Unterschied.'),
      h('div', { class: 'benutzer-tech__numbers' },
        h('div', {}, h('b', {}, '4,2 MB → 310 KB'), h('span', {}, 'ein typisches Handyfoto (−93 %)')),
        h('div', {}, h('b', {}, 'ca. 0,3 GB'), h('span', {}, 'für 1.000 Fotos')),
        h('div', {}, h('b', {}, 'ohne GPS'), h('span', {}, 'Standortdaten werden entfernt'))),
      loggedIn && can('site.media.upload') ? button({ label: 'Selbst ausprobieren: Foto hochladen', icon: '📷', href: '#/admin/fotos/hochladen' }) : null),

    section('E-Mails über Resend', 'Post vom System',
      h('p', {}, 'Für Einladungen, Anmelde-Links und Passwort-Links nutzt das System den Versanddienst ', h('b', {}, 'Resend'),
        '. Die E-Mails kommen von noreply@kolping-ramsen.de und sind digital signiert (SPF/DKIM), damit sie nicht im Spam landen. Bis 3.000 E-Mails im Monat ist das kostenlos – für einen Verein mehr als genug.'),
      h('p', {}, 'Im Prototyp wird nichts verschickt: Jede E-Mail erscheint als Vorschau und im „Postausgang“.')),

    section('Sicherheit, Datenschutz & Sicherungskopien', 'Damit nichts verloren geht',
      h('ul', { class: 'benutzer-tech__checks' },
        h('li', {}, h('b', {}, 'Server in Deutschland'), ' – mit Vertrag zur Auftragsverarbeitung (DSGVO).'),
        h('li', {}, h('b', {}, 'Jede Nacht eine Sicherungskopie'), ' – verschlüsselt, an einem anderen Ort. 30 Tage täglich und 12 Monate monatlich aufbewahrt.'),
        h('li', {}, h('b', {}, 'Papierkorb statt Weg-ist-weg'), ' – Gelöschtes bleibt 30 Tage, Protokolle und Seiten haben einen Versionsverlauf.'),
        h('li', {}, h('b', {}, 'Änderungsprotokoll'), ' – wer hat wann was gemacht, auch abgewiesene Zugriffe.'),
        h('li', {}, h('b', {}, 'Ablage-Dateien sind nie öffentlich'), ' – Downloads gibt es nur nach Rechteprüfung, nicht über erratbare Adressen.'),
        h('li', {}, h('b', {}, 'Geräte abmelden'), ' – geht ein Tablet verloren, meldet der Administrator es mit einem Klick ab.'))),

    section('Was kostet das?', 'Laufende Kosten pro Monat',
      h('div', { class: 'benutzer-matrix-wrap' }, h('table', { class: 'benutzer-tech__costs' },
        h('caption', { class: 'sr-only' }, 'Laufende Kosten pro Monat'),
        h('tbody', {}, COSTS.map(([a, b]) => h('tr', {}, h('th', { scope: 'row' }, a), h('td', {}, b))),
          h('tr', { class: 'benutzer-tech__total' }, h('th', { scope: 'row' }, 'Zusammen'), h('td', {}, 'ca. 5–6 € im Monat')))))),

    section('Prototyp oder echtes System?', 'Was Sie hier sehen',
      h('div', { class: 'benutzer-matrix-wrap' }, h('table', { class: 'benutzer-tech__compare' },
        h('caption', { class: 'sr-only' }, 'Vergleich Prototyp und echtes System'),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Thema'), h('th', { scope: 'col' }, '🎭 Im Prototyp (heute)'), h('th', { scope: 'col' }, '✅ Im echten System'))),
        h('tbody', {}, COMPARE.map(([t, a, b]) => h('tr', {}, h('th', { scope: 'row' }, t), h('td', {}, a), h('td', {}, b))))))),

    section('Wie geht es weiter?', 'Vorschlag',
      h('ol', { class: 'benutzer-tech__steps' },
        h('li', {}, h('b', {}, 'Rückmeldung zum Prototyp'), ' – was fehlt, was ist zu viel, welche Rollen braucht der Verein wirklich?'),
        h('li', {}, h('b', {}, 'Bauen & Inhalte übernehmen'), ' – Texte, Termine und Fotos der alten Website werden übernommen.'),
        h('li', {}, h('b', {}, 'Einweisung'), ' – ein Nachmittag im Pfarrheim, dazu eine gedruckte Anleitung mit Bildern.'),
        h('li', {}, h('b', {}, 'Umstellen'), ' – die Adresse kolping-ramsen.de zeigt auf das neue System, die alte Joomla-Seite wird abgeschaltet.'))));

  if (mode === 'public') {
    el.replaceChildren(
      h('header', { class: 'page-hero' }, h('div', { class: 'container page-hero__inner' },
        h('p', { class: 'kicker' }, 'Für den Vorstand · Klickbarer Prototyp'),
        h('h1', { class: 'page-hero__title' }, 'So funktioniert das neue System'),
        h('p', { class: 'page-hero__intro' }, 'Neue Website, einfache Verwaltung, Ablage für den Vorstand – was dahintersteckt, was es kostet und was der Prototyp schon zeigt.'))),
      h('section', { class: 'section section--tight' }, h('div', { class: 'container benutzer-tech-public' },
        content,
        h('div', { class: 'cluster benutzer-tech__cta' },
          button({ label: loggedIn && hasAdminAccess() ? 'Zur Verwaltung' : 'Verwaltung ausprobieren', icon: '🔑', variant: 'primary', size: 'lg', href: '#/admin' }),
          button({ label: 'Zur Startseite', icon: '🏠', size: 'lg', href: '#/' })))));
  } else {
    el.replaceChildren(h('div', { class: 'admin-page benutzer-page' },
      pageHeader({ title: 'So funktioniert’s', intro: 'Die Technik hinter dem neuen System – kurz erklärt. Für die tägliche Arbeit müssen Sie davon nichts wissen.',
        actions: [button({ label: 'Als öffentliche Seite öffnen', icon: '🌐', href: '#/so-funktionierts' })] }),
      content));
  }
}
