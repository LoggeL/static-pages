# Klick-Prototyp Kolpingsfamilie Ramsen – Konventionen für Modul-Agenten

Statische Seite, **kein Build**, Vanilla-JS als ES-Module, Hash-Routing (`#/…`).
Läuft unter einem Unterpfad (`…/kolping-ramsen-prototyp/`) → **nur relative Pfade** (`img/x.webp`, `./js/…`), nie `/img/…`.
Keine externen Requests (keine CDNs, keine Fonts von außen). Sprache: Deutsch mit Umlauten. „Heute“ = 22.10.2026.

## 0. Die wichtigsten Regeln

1. **Jedes Modul ändert nur seine eigenen zwei Dateien**: `js/modules/<modul>.js` und `css/modules/<modul>.css`. Kern-Dateien (`app.js`, `store.js`, `auth.js`, `ui.js`, `admin.js`, `public.js`, `tour.js`, `seed.js`, `index.html`, `css/*.css`) **nicht anfassen**.
2. Fehlt eine Kern-Funktion → **lokal im Modul implementieren** (oder ein `export` aus einem Kern-Modul wiederverwenden).
3. Routen exakt wie in Abschnitt 6 (Rundgang, Dashboard-Kacheln, Suche und Menü verlinken dorthin). Zusätzliche Unterrouten sind erlaubt, aber nur unter dem eigenen Präfix.
4. Jede Route bekommt eine `permission` (Rechteprüfung im Router). Zusätzlich innerhalb der Seite mit `can()` Knöpfe/Bereiche ausblenden.
5. CSS-Klassen im Modul mit Präfix `.<modul>-…` (z. B. `.ablage-folder`, `.termine-form`). Allgemeine Kern-Klassen (Abschnitt 7) dürfen benutzt werden.
6. Senioren-UX (verbindlich, Details `../analyse-senior-ux.md`): Schrift ≥18px (kommt vom Layout), Klickflächen ≥48px, Kontrast ≥7:1, **keine Dropdown-Menüs/Hover-only/Icon-only**, Buttons immer Icon + Text, Alltagsdeutsch („Hochladen, Webadresse, Veröffentlichen/Auf der Website zeigen, Entwurf, Datei“ – nie „Upload, Slug, Publish, Asset“), Autosave sichtbar („✓ Gespeichert um 14:32 Uhr“ via `autosaveIndicator`), Löschen = Papierkorb + „Rückgängig“-Toast (kein Bestätigungsdialog, außer endgültig löschen), Fehler direkt am Feld (`field().setError`), tolerantes Datum/Uhrzeit (`parseDate`/`parseTime`), Vorschau „So sieht es auf der Website aus“, oben auf jeder Unterseite „← Zurück zur Übersicht“ (`pageHeader`), **genau ein** primärer Button pro Seite.
7. Jede schreibende Aktion → `log(action, target, details)` (Änderungsprotokoll).
8. Keine echten Personendaten. Nur die Demo-Personen (Stefan Beispiel, Klaus Muster, Maria Probe, Hans Gast) oder „Name Platzhalter“.
9. `node --check` auf die eigene Datei muss durchlaufen. Ein Laufzeitfehler im Modul legt dank `Promise.allSettled` nicht die ganze Seite lahm – soll aber natürlich nicht passieren.

## 1. Dateien

```
index.html               lädt CSS + js/public.js, js/admin.js, js/modules/*.js, js/tour.js, dann app.start()
CONVENTIONS.md           diese Datei
css/tokens.css           Farben, Abstände, Schriftgrößen (CSS-Variablen)
css/base.css             Reset, Buttons, Schilder, Felder, Toast, Modal, Editor, Mail-Vorschau, Demo-Band, Rundgang, Lightbox, Chips
css/public.css           öffentliche Website
css/admin.css            Verwaltungs-Rahmen, Login, Rollenleiste, Kacheln, Listen, Hinweise, Kein-Zugriff, Hilfe, Foto-Auswahl
css/modules/<m>.css      je Modul (Stub)
js/app.js                Router
js/store.js              Mock-DB (localStorage), Audit-Log, Helfer
js/seed.js               Beispieldaten, ROLES, PERMISSIONS, EVENT_CATEGORIES
js/auth.js               Anmeldung, can(), Rollen, Rollenwechsel, Login-Seite
js/ui.js                 UI-Bausteine, Datum, Bildkompression, Editor, Mail-Vorschau
js/ical.js               buildICS(events), downloadICS(events, filename)
js/public.js             öffentliche Seiten + Layouts 'public'/'bare'
js/admin.js              Admin-Layout, Übersicht, Suche, Papierkorb, Hilfe, Kein-Zugriff, Modul-Helfer
js/tour.js               Demo-Rundgang + Demo-Band-Knöpfe
js/modules/inhalte.js    Neuigkeiten, Seiten, Fotos/Mediathek       (Stub)
js/modules/ablage.js     Vorstands-Dateiablage                       (Stub)
js/modules/protokolle.js Protokoll-Editor + Live-Simulation          (Stub)
js/modules/termine.js    Kalender-Verwaltung + iCal                  (Stub)
js/modules/benutzer.js   Benutzer, Rollen-Matrix, Audit, Postausgang, Technik-Info (Stub)
img/                     WebP-Bilder (groß + „-s“ Vorschau), kolping-logo.svg, demo-handyfoto.jpg (4032×3024, 1,5 MB)
```

Import aus einem Modul immer relativ: `import { db, log } from '../store.js';`

## 2. app.js – Router

```js
registerRoute(pattern, render, opts)      // pattern ohne '#': '/admin/termine/:id'; statische Segmente schlagen :param
  // render(ctx) füllt ctx.el; darf Promise sein; darf Aufräumfunktion zurückgeben (wird beim Seitenwechsel aufgerufen → Timer/Intervalle stoppen!)
  // ctx = { el, params, query, path, full, setTitle(t), navigate(path) }
  // opts = { permission, layout, title }
  //   permission: 'files.view' | ['a','b'] (eins reicht) | '@user' (nur angemeldet) | undefined (öffentlich)
  //   layout: 'admin' (Standard bei /admin…) | 'public' | 'bare'
navigate('#/admin/termine')                // oder navigate('/admin/termine'); {replace:true} möglich
rerender()                                 // aktuelle Route neu zeichnen (z. B. nach Datenänderung)
currentPath()                              // '/admin/termine/e-3'
currentRoute()                             // { route, params, query, path, mode }
onRouteChange(fn)                          // → Abmeldefunktion
registerLayout(name, fn), setGuards({...}) // nur Kern
```
Query-Parameter: `#/termine?ansicht=monat` → `ctx.query.ansicht`.
Ohne Anmeldung → Login-Seite (danach zurück zur Ziel-Route). Ohne Recht → freundliche „Kein Zugriff“-Seite (+ Audit-Eintrag `access.denied`).

## 3. store.js – Daten

```js
import { db, log, uid, nowIso, prefsStore, mediaById, mediaUrl, userName, eventCategory, eventCategories,
         folderPath, folderVisibility, ACTION_LABELS, COLLECTIONS } from '../store.js';

db.all(coll, {withDeleted})   // nicht gelöschte Einträge (echte Objekte – nicht direkt mutieren!)
db.find(coll, id)             // auch gelöschte (für Rückgängig)
db.findBy(coll, fn) / db.where(coll, fn)
db.insert(coll, obj)          // id/createdAt/updatedAt werden ergänzt; neu kommt nach vorn; → item
db.update(coll, id, patch)    // flaches Merge, setzt updatedAt; → item
db.remove(coll, id, {by})     // Papierkorb (deletedAt/deletedBy)
db.restore(coll, id)          // aus Papierkorb zurück
db.purge(coll, id)            // endgültig (nur wenn can('trash.purge'))
db.trash()                    // [{coll, item}] aller gelöschten
db.seedIfMissing(coll, items) // Modul-eigene Zusatz-Beispieldaten (nur wenn id fehlt)
db.meta(key[, value])         // freier Key-Value-Speicher, Schlüssel mit Modul-Präfix: 'protokolle.xyz'
db.subscribe(fn)              // fn({type:'insert'|'update'|'remove'|'restore'|'purge'|'meta'|'reset'|'storage-full', coll, id, item}) → Abmelden
db.save(), db.reset(), db.memoryOnly, db.raw
log(action, target, details)  // Audit; action z. B. 'event.create' (Labels: ACTION_LABELS), target lesbar: 'Termin „Herbstwanderung“'
uid('e') → 'e-lq3k9x2a';  nowIso() → '2026-10-22T14:32:05' (lokal, ohne Zone)
prefsStore.get(key, fallback) / prefsStore.set(key, value)   // pro Gerät (Schriftgröße, Rundgang …)
folderVisibility(folderId) → 'public'|'members'|'board' (erbt vom obersten Ordner);  folderPath(id) → [Wurzel … Ordner]
```
localStorage-Schlüssel: `kolping-proto-db-v1` (DB), `kolping-proto-prefs-v1`, `kolping-proto-session`. Alles in try/catch; ist der Speicher voll, läuft die Demo im Speicher weiter (Toast kommt vom Kern).
Bilder als dataURL kosten viel localStorage → nur die verkleinerte Fassung speichern (macht `addPhotoFromFile`).

### Datenmodell (Sammlungen) mit Beispielen aus dem Seed

**users**
```js
{ id:'u-maria', name:'Maria Probe', firstName:'Maria', email:'maria.probe@example.org', roleId:'redakteur',
  title:'Pflegt die Website (72 Jahre)', initials:'MP', color:'#15803d', active:true, lastLogin:'2026-10-19T10:31:00', createdAt:'…' }
```
Weitere: `u-stefan` (admin), `u-klaus` (vorstand), `u-hans` (mitglied). Eingeladene, noch nicht angemeldete Personen: `active:true, invitedAt, lastLogin:null`; gesperrt: `active:false`.

**roles** – `{ id:'vorstand', label:'Vorstand', short:'Vorstand', color:'#7c2d12', description:'…', permissions:['site.events.edit', …] }`
Rollen: `admin`, `vorstand`, `redakteur`, `mitglied`. Rechte (PERMISSIONS aus seed.js, `{id, group, label}`):

| Recht | Admin | Vorstand | Redakteur | Mitglied |
|---|---|---|---|---|
| site.news.edit – Neuigkeiten | ✓ | – | ✓ | – |
| site.pages.edit – Seiten | ✓ | – | ✓ | – |
| site.events.edit – Termine | ✓ | ✓ | ✓ | – |
| site.media.upload – Fotos | ✓ | – | ✓ | – |
| members.view – Mitgliederbereich | ✓ | ✓ | ✓ | ✓ |
| files.view – Ablage öffnen | ✓ | ✓ | – | – |
| files.board – Ordner „Nur Vorstand“ | ✓ | ✓ | – | – |
| files.upload – Dateien/Ordner anlegen | ✓ | ✓ | – | – |
| files.delete – Dateien in Papierkorb | ✓ | ✓ | – | – |
| protocols.view / protocols.edit / protocols.approve | ✓ | ✓ | – | – |
| mail.send – Rundmail | ✓ | ✓ | – | – |
| users.manage – Benutzer & Rollen | ✓ | – | – | – |
| audit.view – Änderungsprotokoll | ✓ | – | – | – |
| trash.purge – endgültig löschen | ✓ | – | – | – |
| settings.manage – Technik | ✓ | – | – | – |

Rollen-Rechte darf das Benutzer-Modul ändern (`db.update('roles', id, {permissions})` + `log('role.update', …)`); `can()` liest live.

**events** (öffentliche Termine-Seite liest hieraus – Termine-Modul schreibt hierhin)
```js
{ id:'e-7', title:'Lieblings-Weinprobe', date:'2026-11-07', endDate:null, time:'19:00', endTime:null,
  location:'Pfarrheim', category:'verein', visibility:'public'|'members'|'board', description:'<p>…</p>',
  image:'saal' /* media-id oder null */, status:'published'|'draft', createdBy:'u-maria', createdAt, updatedAt }
```
Kategorien (`eventCategories()`): verein, glaube, kapelle, theater, jugend, familie, vorstand – `{id,label,color}`.
Öffentlich sichtbar: `status!=='draft'` und Sichtbarkeit erlaubt (`canSeeVisibility`). Detail-Link öffentlich: `#/termine/<id>`.

**news**
```js
{ id:'n-1', slug:'lieblings-weinprobe-2026', title:'…', date:'2026-10-14', teaser:'…', body:'<p>…</p>',
  image:'saal', status:'published'|'draft', author:'u-maria', createdAt, updatedAt }
```
Öffentlich: `#/aktuelles/<slug>`; Entwürfe sind für `site.news.edit` als Vorschau aufrufbar (gelbes Vorschau-Band).

**pages**
```js
{ id:'p-pfarrheim', slug:'pfarrheim', section:'verein'|'bereiche'|'static', title:'Unser Pfarrheim', kicker:'Klosterhof 7',
  intro:'…', body:'<h2>…</h2><ul class="timeline">…</ul>', image:'pfarrheim', order:2, status:'published'|'draft',
  external:{url,label}|null, updatedBy:'u-maria', updatedAt, createdAt }
```
Öffentlich: `#/verein/<slug>`, `#/bereiche/<slug>`, `#/impressum`, `#/datenschutz`. Body-HTML nur aus `sanitizeHTML`-Tags (p, h2, h3, strong, em, ul/ol/li, a, img, blockquote, br) – `ul.timeline` existiert im Seed und bleibt beim Bearbeiten evtl. als normale Liste erhalten (ok).

**media** (Website-Fotos – NIE Ablage-Dateien!)
```js
{ id:'kapelle-gruppe', src:'img/kapelle-gruppe.webp', thumb:'img/kapelle-gruppe-s.webp', width:1598, height:726,
  size:175046, thumbSize:18828, originalSize:241623, originalName:'Konzert_2026_16.jpeg', alt:'…', caption?, type:'image/webp',
  albumId?, uploadedBy:'u-maria', createdAt }
```
Neu hochgeladene: `src`/`thumb` sind dataURLs (siehe `addPhotoFromFile`).

**albums** (Rückblick/Galerie) – `{ id:'a-konzert-2026', title, date:'2026-03-22', cover:'kapelle-konzert', text, media:['kapelle-konzert', …] }` → öffentlich `#/rueckblick/<id>`.

**folders** (Ablage; Sichtbarkeit NUR am obersten Ordner, Unterordner erben)
```js
{ id:'f-vorstand', name:'Vorstand', parentId:null, visibility:'board', icon:'🔒', createdBy, createdAt }
{ id:'f-prot-2026', name:'Protokolle 2026', parentId:'f-vorstand', createdBy, createdAt }
```
Baum: Vorstand 🔒 › (Protokolle 2025, Protokolle 2026, Finanzen) · Mitglieder 👥 › (Satzung & Einladungen) · Öffentlich 🌐 › (Flyer & Formulare).

**files**
```js
{ id:'d-8', folderId:'f-finanzen', name:'Foto Kassenbuch.webp', type:'pdf'|'xlsx'|'docx'|'image'|'protocol'|…, size:186368,
  originalSize:4404019|null, protocolId:null|'pr-1', note:'', uploadedBy:'u-klaus', createdAt, updatedAt,
  dataUrl? /* nur bei echten Uploads im Prototyp, optional */ }
```
16 Beispieldateien. `type:'protocol'` = Verweis auf ein Online-Protokoll (`protocolId`, size 0). Öffentliche Seite zeigt Dateien aus `public`-Ordnern („Mitglied werden“) und `members`/`public` im Mitgliederbereich.

**protocols**
```js
{ id:'pr-1', title:'Vorstandssitzung 14.10.2026', date:'2026-10-14', kind:'vorstand'|'mitgliederversammlung',
  folderId:'f-prot-2026', fileId:'d-5', status:'draft'|'final', author:'u-klaus', editors:['u-klaus','u-stefan'],
  attendees:['Klaus Muster', …], body:'<h2>…</h2><h3>TOP 1 – …</h3>…', approvedBy?, approvedAt?,
  createdAt, updatedAt, updatedBy, versions:[{at, by, label, body?}] }
```
pr-1 (Entwurf, für die Live-Demo), pr-2 und pr-3 (abgeschlossen).

**audit** – `{ id:'l-1', at:'2026-10-21T20:14:00', userId:'u-stefan', action:'user.login', target:'Stefan Beispiel', details:'Anmelde-Link per E-Mail' }`
**mails** (Postausgang, von `sendMail`) – `{ id, to, toName, subject, kind:'magic-link'|'invite'|'reset'|'contact'|'rundmail', html, at, via:'Resend' }`

## 4. auth.js – Rechte & Anmeldung

```js
import { can, currentUser, currentRole, roleOf, roles, userCan, canSeeVisibility, hasAdminAccess, login, logout,
         onAuthChange, sendMagicLink, renderLogin, roleSwitcher, describeRole, permissionLabel, PERMISSIONS,
         toggleFontSize } from '../auth.js';
can('files.view')            // true/false für den angemeldeten Benutzer; can(['a','b']) = eins davon; '@user'
userCan(user, perm)          // für beliebige Person (Rollen-Matrix)
canSeeVisibility('board')    // 'public' immer; 'members' → members.view; 'board' → files.board
login(userId, {method:'magic-link'|'demo-switch'}), logout()
sendMagicLink(user, {onDone}) // Mail-Vorschau mit grünem Knopf → meldet an
```
Magic-Link/Einladung/Passwort-Reset immer über `sendMail` (ui.js) → Vorschau „Diese E-Mail würde verschickt“.

## 5. ui.js – Bausteine (alle liefern DOM-Elemente)

```js
import { h, html, raw, esc, frag, $, $$, debounce, slugify, button, tile, badge, visibilityBadge, VISIBILITY, toast, modal,
  confirmDialog, field, autosaveIndicator, parseDate, parseTime, formatDate, formatTime, formatDateTime, relativeTime,
  toISODate, fromISODate, todayISO, MONTHS, WEEKDAYS, formatBytes, compressImage, compressResult, sanitizeHTML, stripHTML,
  createEditor, pageHeader, emptyState, mailHTML, sendMail, showMailPreview, lightbox, downloadFile, fileIcon, avatar } from '../ui.js';
```
- `h(tag, attrs, ...kinder)` – `onclick: fn`, `class`, `style:{…,'--var':x}`, `dataset`, `html` (innerHTML), `true`-Attribute.
- `button({label, icon, variant:'primary'|'accent'|'ok'|'danger'|'danger-solid'|'secondary'|'ghost'|'light', size:'lg'|'sm', block, href, onClick, type, attrs, disabled})` – „Auf der Website zeigen“ = `variant:'ok'`.
- `tile({icon, title, text, href, color, badge, onClick})` – große Aufgaben-Kachel.
- `visibilityBadge('board', {long, large})` → „🔒 Nur Vorstand“ / `{long:true}` → „Sichtbar für: Nur Vorstand und Administrator“. `badge('Entwurf','draft'|'ok'|'info'|'neutral', icon)`.
- `toast(msg, {undo: fn, undoLabel, timeout, type:'ok'|'info'|'error', icon})` – mit `undo` 10 s „↶ Rückgängig“.
- `modal({title, body: Node|htmlString, actions:[{label, icon, variant, onClick(close)}], wide, onClose})` → `{el, body, close}`.
- `confirmDialog({title, text, confirmLabel})` → Promise<boolean> – **nur** für Endgültiges.
- `field({label, name, value, type:'text'|'email'|'url'|'date-text'|'time-text'|'textarea'|'select', hint, placeholder, required, optional, rows, options:[{value,label}], inputmode, autocomplete, attrs})` → `{el, input, value(), setValue(v), setError(msg), clearError(), setOk(msg)}`. Hinweis-Satz (`hint`) unter jedem Feld!
- `autosaveIndicator({initial})` → `{el, saving(), saved(date), error(msg), idle(text)}` → „✓ Gespeichert um 14:32 Uhr“.
- `parseDate('3.11.' | '3. November' | '03.11.2026' | 'morgen' | 'nächsten Samstag')` → 'YYYY-MM-DD'|null (ohne Jahr → nächstes passendes). `parseTime('19' | '19 Uhr' | '19:30' | 'halb 8 abends')` → 'HH:MM'|null.
- `formatDate(iso, 'long'|'medium'|'short'|'weekday'|'dayMonth'|'monthYear')`, `formatBytes(4404019)` → „4,2 MB“.
- `compressImage(file, {maxSize:1600, quality:0.75, type:'image/webp'})` → `{blob, dataUrl, type, name, before, after, width, height, originalWidth, originalHeight, savedPercent}` (Fallback JPEG). `compressResult(r)` → „vorher 4,2 MB → nachher 310 KB −93 %“.
- `createEditor(container, {value, toolbar:['heading','bold','list','link','image','undo'], placeholder, label, onChange(html), onImage(insert)})` → `{el, area, getHTML(), setHTML(), insertHTML(), focus(), destroy()}`. Feste beschriftete Leiste, Einfügen aus Word wird bereinigt. Für Bilder `onImage: insert => mediaPicker({onPick: m => insert({src: m.src, alt: m.alt})})` nutzen.
- `pageHeader({title, intro, back:{href,label}|null, actions:[Node], badge})` – Standard-Rücklink „← Zurück zur Übersicht“.
- `emptyState({icon, title, text, action})`.
- `sendMail({to, toName, subject, kind, heading, text(HTML), cta:{label, onClick}, footer, silent})` → legt in `mails` ab, loggt, zeigt Vorschau. `showMailPreview(mail)` zeigt eine gespeicherte Mail.
- `lightbox([{src, alt, caption}], start)`, `downloadFile(name, content|Blob, mime)`, `fileIcon(type)`, `avatar(user, {size})`.
- ical.js: `buildICS(events, {name})` → String, `downloadICS(events, filename)`.

## 6. admin.js – Rahmen & Modul-Helfer

```js
import { adminPlaceholder, mediaPicker, addPhotoFromFile, demoPhotoFile, trashItem, notice, registerHelp,
         registerSearchProvider, registerAdminNav, registerDashboardTile, forbiddenPage, showHelp,
         ADMIN_NAV, DASHBOARD_TILES, TRASH_TYPES, ADMIN_ANY } from '../admin.js';
```
- `trashItem(coll, id, label)` – in Papierkorb + Audit (`<typ>.delete`) + Toast mit „Rückgängig“. **So wird überall gelöscht.**
- `mediaPicker({title, onPick(media), allowUpload})` – Foto-Auswahl aus `media` (niemals Ablage-Dateien), optional neues Foto hochladen.
- `addPhotoFromFile(file, {alt, caption, albumId})` → `{media, result}` – verkleinert (1600 px WebP q0.75 + 560 px Vorschau), legt in `media` ab, loggt `media.upload` mit „vorher → nachher“.
- `demoPhotoFile()` → `File` „IMG_2041.JPG“ (4032×3024, im Browser auf ≈ 4 MB „echtes Handyfoto“ gebracht) – Knopf „Beispielfoto verwenden“ für Demos ohne eigene Fotos.
- `notice(content, 'info'|'ok'|'warn'|'calm'|'demo', icon)` – Hinweis-Kasten; `'demo'` = gestreifter „Hinweis für die Vorführung“.
- `registerHelp('/admin/termine', {title, steps:[…], text})` – Inhalt des „❓ Hilfe“-Knopfs (Standards für alle Bereiche sind schon da, Module dürfen überschreiben).
- `registerSearchProvider({id, label, permission, search(q)→[{icon,title,sub,href,thumb?}]})` – Standard-Quellen für events/news/pages/media/files/protocols/users existieren bereits mit Rechteprüfung.
- `window.__kolpingDirty = true|false` – warnt beim Schließen des Tabs vor ungespeicherten Änderungen.
- Menü (`ADMIN_NAV`) und Kacheln (`DASHBOARD_TILES`) sind zentral definiert; Module müssen dort nichts tun.

### Routen-Liste (Stubs registrieren sie bereits mit diesen Rechten)

| Modul | Route | Recht |
|---|---|---|
| Kern | `#/admin` (Übersicht/Kacheln) | @user |
| Kern | `#/admin/login` | – (bare) |
| Kern | `#/admin/suche?q=` | ADMIN_ANY |
| Kern | `#/admin/papierkorb` | eins von site.*/files.delete/protocols.edit/users.manage |
| inhalte | `#/admin/neuigkeiten`, `/neu`, `/:id` | site.news.edit |
| inhalte | `#/admin/seiten`, `/:id` | site.pages.edit |
| inhalte | `#/admin/fotos` (`?foto=<id>` hebt ein Foto hervor), `/hochladen`, `/album/:id` | site.media.upload |
| ablage | `#/admin/ablage`, `/:folderId` | files.view (+ files.board für 🔒-Ordner im Modul prüfen) |
| protokolle | `#/admin/protokolle` | protocols.view |
| protokolle | `#/admin/protokolle/neu` | protocols.edit |
| protokolle | `#/admin/protokolle/:id` (pr-1 = Live-Demo) | protocols.view (Bearbeiten nur mit protocols.edit, `status:'final'` = gesperrt) |
| termine | `#/admin/termine`, `/neu`, `/:id` | site.events.edit |
| benutzer | `#/admin/benutzer`, `/einladen`, `/:id` | users.manage |
| benutzer | `#/admin/rollen` (Rollen-Matrix) | users.manage |
| benutzer | `#/admin/aenderungen` (Audit-Log) | audit.view |
| benutzer | `#/admin/postausgang` (alle Mail-Vorschauen) | users.manage |
| benutzer | `#/admin/technik` („So funktioniert’s“: Mini-VPS, Resend, SQLite, Backups) | @user |

Öffentliche Routen (public.js): `#/`, `#/aktuelles`, `#/aktuelles/:slug`, `#/termine` (`?ansicht=monat`, `?abo=1`), `#/termine/:id`, `#/verein`, `#/verein/:slug`, `#/bereiche`, `#/bereiche/:slug`, `#/rueckblick`, `#/rueckblick/:id`, `#/kontakt`, `#/mitglieder` (members.view), `#/impressum`, `#/datenschutz`.

### Demo-Rundgang (tour.js) – diese Stellen müssen funktionieren
1 `#/` · 2 `#/termine` · 3 `#/admin` abgemeldet (Login) · 4 Maria `#/admin/termine/neu` · 5 Maria `#/termine` · 6 Maria `#/admin/fotos/hochladen` · 7 Klaus `#/admin/ablage` · 8 Klaus `#/admin/protokolle/pr-1` · 9 Maria `#/admin/ablage` (Kein Zugriff) · 10 Stefan `#/admin/rollen` + `#/admin/aenderungen`.

## 7. CSS

Tokens (`css/tokens.css`): `--brand #eb6800` (nur Flächen/Akzente), `--brand-strong #8a3800` (Text/Buttons auf Weiß, 7,9:1), `--brand-deep`, `--brand-soft`, `--ink-black`, `--bg`, `--surface`, `--surface-2`, `--text`, `--text-muted` (7,6:1), `--border`, `--border-strong`, `--ok`/`--ok-soft`, `--danger`/`--danger-soft`, `--info`/`--info-soft`, `--warn`/`--warn-soft`, `--vis-public|members|board` (+`-bg`), `--font-sans`, `--font-serif`, `--fs-admin` (18px, mit A+ 21px), `--fs-admin-small` (16px), `--sp-1…9`, `--radius-s|radius|radius-l`, `--shadow-1…3`, `--tap` 48px, `--tap-primary` 56px.
Im Admin `em` statt `px` für Schrift verwenden, damit „A+ Größere Schrift“ wirkt; nie unter 16px.

Kern-Klassen, die Module verwenden dürfen:
- Buttons/Schilder/Felder: `.btn` (+Varianten), `.badge`, `.field`, `.check` (große Checkbox-Zeile), `.chips`/`.chip[aria-pressed]` (Auswahl statt Dropdown!), `.cluster`, `.stack`, `.stack-lg`, `.spacer`, `.muted`, `.sr-only`.
- Admin: `.admin-page` (Seitencontainer, vertikaler Abstand), `.admin-card`, `.dash-box`, `.admin-list` > `.admin-row` (`__icon`, `__thumb`, `__date`, `__main`, `__sub`, `__actions`), `.notice--info|ok|warn|calm|demo`, `.form-grid` (`.form-grid--2` zweispaltig ab 820px), `.form-actions` (klebt unten), `.tile`, `.tile-grid-admin`, `.page-head`, `.empty-state`, `.autosave`, `.editor`, `.compress-result`, `.picker-grid`.
- Website: `.prose` (Fließtext), `.section`, `.container`, `.event-row`, `.news-card`, `.gallery`.

## 8. Testen
```
cd site && python3 -m http.server 8000   →  http://localhost:8000/#/admin
node --check js/modules/<modul>.js
```
Rolle schnell wechseln: Leiste „Demo: Rolle wechseln“ oben im Admin. Alles zurücksetzen: „↺ Demo zurücksetzen“ im schwarzen Band oder `__kolpingDb.reset()` in der Konsole.

## 9. Integration (nach den Modulen)
- `ui.js` merkt sich offene Dialoge; der Router schließt beim Seitenwechsel alle Dialoge, die älter als 250 ms sind (`closeStaleModals`). Ein Dialog, der direkt nach `navigate()` geöffnet wird, bleibt offen.
- Rundgang-Panel enthält den Link „So funktioniert das System“ (`.tour__info`) – kein Einhängen mehr aus `benutzer.js`.
- Handy (< 720 px): Verwaltungs-Kopf nicht klebend, Rollenleiste einzeilig waagrecht scrollbar, Menü nur auf der Übersicht (Unterseiten haben „← Zurück“).
- Klebende `.form-actions` lassen rechts 270 px frei für den Rundgang-Knopf; Toasts erscheinen dann oberhalb der Leiste.
- `demoPhotoFile()` erzeugt aus `img/demo-handyfoto.jpg` im Browser ein realistisches ~4 MB-Handyfoto (Sensorrauschen, JPEG q0.93).

## Nachträge (Review-Runde)

- `append/prepend/replaceChildren` sind in `ui.js` null-sicher gemacht (`null/undefined/false` werden übersprungen, sonst stünde „null“ im Text).
- `auth.onBeforeAuthChange(fn)`: läuft VOR jedem An-/Abmelden/Rollenwechsel, solange noch die bisherige Person angemeldet ist. `app.js` ruft dort die Aufräumfunktion der Seite auf (offene Eingaben werden der richtigen Person zugeschrieben), schließt Hinweise und Dialoge.
- `toast({undo})`: „Rückgängig“ gilt nur für die Person, die den Hinweis ausgelöst hat.
- `ADMIN_PERMS` (auth.js) ist die einzige Liste der Verwaltungsrechte; `folderAlive(id)` liegt in `store.js`.
- Platzhalter „[…]“ in Editoren werden gelb markiert; Antippen markiert sie ganz (`selectPlaceholderOnTap(input)` für Eingabefelder).
- `tour.js` misst die klebende Aktionsleiste (`--actions-h`, `body.has-actions`), damit Hinweise und Rundgang-Knopf nichts verdecken.
