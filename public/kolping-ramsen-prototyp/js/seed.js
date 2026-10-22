// =========================================================
// Beispieldaten (Seed) für den Prototyp.
// Öffentliche Inhalte stammen sinngemäß von kolping-ramsen.de
// (Joomla-Export), bereinigt. Personen sind frei erfunden bzw.
// durch Platzhalter ersetzt. Termine auf Herbst 2026 – Frühjahr
// 2027 verschoben. „Heute“ im Prototyp: 22.10.2026.
// =========================================================

export const SEED_VERSION = 4;

const T = (d, h = 10, m = 0) => `${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;

/* ---------------- Rollen & Rechte ---------------- */
export const PERMISSIONS = [
  { id: 'site.news.edit',     group: 'Website',   label: 'Neuigkeiten schreiben und ändern' },
  { id: 'site.pages.edit',    group: 'Website',   label: 'Seiten der Website ändern' },
  { id: 'site.events.edit',   group: 'Website',   label: 'Termine eintragen und ändern' },
  { id: 'site.media.upload',  group: 'Website',   label: 'Fotos hochladen (Mediathek & Rückblick)' },
  { id: 'members.view',       group: 'Mitglieder', label: 'Mitgliederbereich ansehen' },
  { id: 'files.view',         group: 'Ablage',    label: 'Dateiablage öffnen' },
  { id: 'files.board',        group: 'Ablage',    label: 'Ordner „Nur Vorstand“ sehen' },
  { id: 'files.upload',       group: 'Ablage',    label: 'Dateien ablegen und Ordner anlegen' },
  { id: 'files.delete',       group: 'Ablage',    label: 'Dateien in den Papierkorb legen' },
  { id: 'protocols.view',     group: 'Protokolle', label: 'Protokolle lesen' },
  { id: 'protocols.edit',     group: 'Protokolle', label: 'Protokolle schreiben (auch gemeinsam)' },
  { id: 'protocols.approve',  group: 'Protokolle', label: 'Protokoll als „geprüft“ abschließen' },
  { id: 'mail.send',          group: 'Verwaltung', label: 'Rundmail an Mitglieder senden (im Prototyp: bei Terminabsagen)' },
  { id: 'users.manage',       group: 'Verwaltung', label: 'Benutzer einladen, Rollen vergeben' },
  { id: 'audit.view',         group: 'Verwaltung', label: 'Änderungsprotokoll einsehen' },
  { id: 'trash.purge',        group: 'Verwaltung', label: 'Endgültig löschen (Papierkorb leeren)' },
  { id: 'settings.manage',    group: 'Verwaltung', label: 'Technik & Einstellungen (kommt im echten System)' },
];

export const ROLES = [
  {
    id: 'admin', label: 'Administrator', short: 'Admin', color: '#1e3a8a',
    description: 'Technische Betreuung. Darf alles – auch Benutzer verwalten und endgültig löschen.',
    permissions: PERMISSIONS.map(p => p.id),
  },
  {
    id: 'vorstand', label: 'Vorstand', short: 'Vorstand', color: '#7c2d12',
    description: 'Leitungsteam & Schriftführung: Dateiablage, Protokolle, Termine, Rundmails.',
    permissions: ['site.events.edit', 'members.view', 'files.view', 'files.board', 'files.upload', 'files.delete',
      'protocols.view', 'protocols.edit', 'protocols.approve', 'mail.send'],
  },
  {
    id: 'redakteur', label: 'Redakteurin / Redakteur', short: 'Redaktion', color: '#14532d',
    description: 'Pflegt die Website: Neuigkeiten, Seiten, Termine und Fotos. Keine Dateiablage.',
    permissions: ['site.news.edit', 'site.pages.edit', 'site.events.edit', 'site.media.upload', 'members.view'],
  },
  {
    id: 'mitglied', label: 'Mitglied', short: 'Mitglied', color: '#57534e',
    description: 'Sieht den Mitgliederbereich mit freigegebenen Dokumenten und Mitglieder-Terminen.',
    permissions: ['members.view'],
  },
];

/* ---------------- Benutzer (frei erfunden) ---------------- */
const users = [
  { id: 'u-stefan', name: 'Stefan Beispiel', firstName: 'Stefan', email: 'stefan.beispiel@example.org', roleId: 'admin',
    title: 'Technischer Admin', initials: 'SB', color: '#1e3a8a', active: true, lastLogin: T('2026-10-21', 20, 14), createdAt: T('2026-09-01') },
  { id: 'u-klaus', name: 'Klaus Muster', firstName: 'Klaus', email: 'klaus.muster@example.org', roleId: 'vorstand',
    title: 'Schriftführer im Vorstand', initials: 'KM', color: '#9a3412', active: true, lastLogin: T('2026-10-20', 19, 2), createdAt: T('2026-09-02') },
  { id: 'u-maria', name: 'Maria Probe', firstName: 'Maria', email: 'maria.probe@example.org', roleId: 'redakteur',
    title: 'Pflegt die Website (72 Jahre)', roleTitle: 'Redakteurin', initials: 'MP', color: '#166534', active: true, lastLogin: T('2026-10-19', 10, 31), createdAt: T('2026-09-02') },
  { id: 'u-hans', name: 'Hans Gast', firstName: 'Hans', email: 'hans.gast@example.org', roleId: 'mitglied',
    title: 'Mitglied seit 1987', initials: 'HG', color: '#57534e', active: true, lastLogin: T('2026-10-11', 9, 5), createdAt: T('2026-09-10') },
];

/* ---------------- Termin-Kategorien ---------------- */
export const EVENT_CATEGORIES = [
  { id: 'verein',   label: 'Verein & Geselligkeit', color: '#eb6800' },
  { id: 'glaube',   label: 'Glaube & Gottesdienst', color: '#6d28d9' },
  { id: 'kapelle',  label: 'Kolpingskapelle',       color: '#1d4ed8' },
  { id: 'theater',  label: 'Theater',               color: '#be123c' },
  { id: 'jugend',   label: 'Jugend',                color: '#0f766e' },
  { id: 'familie',  label: 'Familienkreis',         color: '#15803d' },
  { id: 'vorstand', label: 'Vorstand (intern)',     color: '#7c2d12' },
];

/* ---------------- Termine ---------------- */
let ev = 0;
const E = (date, title, o = {}) => ({
  id: 'e-' + (++ev), title, date, endDate: o.end || null, time: o.time || null, endTime: o.endTime || null,
  location: o.loc || 'Pfarrheim', category: o.cat || 'verein', visibility: o.vis || 'public',
  description: o.desc || '', image: o.img || null, status: 'published',
  createdBy: 'u-maria', createdAt: T('2026-09-15'), updatedAt: T('2026-09-15'),
});
const events = [
  E('2026-09-26', 'Krimidinner', { time: '19:00', cat: 'jugend', desc: '<p>Spannender Abend mit Menü – vorbereitet von unserer Jugend.</p>' }),
  E('2026-10-02', 'Rosenkranzandacht mit Zwiebelkuchen & neuem Wein', { time: '19:00', loc: 'Pfarrkirche & Pfarrheim', cat: 'glaube', img: 'rosenkranz', desc: '<p>Nach der Andacht treffen wir uns im Pfarrheim bei Zwiebelkuchen und neuem Wein.</p>' }),
  E('2026-10-14', 'Vorstandssitzung', { time: '19:30', cat: 'vorstand', vis: 'board', loc: 'Pfarrheim, Gruppenraum', desc: '<p>Tagesordnung siehe Ablage › Vorstand.</p>' }),
  E('2026-10-17', 'Oktoberfest auf der Kolpingwiese', { time: '17:00', loc: 'Kolpingwiese', cat: 'kapelle', img: 'wiesenfest-kapelle', desc: '<p>Mit Blasmusik der Kolpingskapelle und Bewirtung durch die Jugend.</p>' }),
  E('2026-10-24', 'Herbstwanderung', { time: '09:15', loc: 'Treffpunkt Parkplatz Bahnhofstraße', cat: 'verein', img: 'kloster-sion', desc: '<p>Gemütliche Wanderung durch den herbstlichen Stumpfwald, ca. 12 km mit Einkehr. Festes Schuhwerk mitbringen!</p>' }),
  E('2026-10-25', 'Kürbisse schnitzen', { time: '14:00', cat: 'familie', img: 'kuerbis-1', desc: '<p>Für Familien mit Kindern – Familienkreis „Next Generation“. Kürbisse und Werkzeug sind da, anschließend gibt es Kürbissuppe.</p>' }),
  E('2026-11-07', 'Lieblings-Weinprobe', { time: '19:00', cat: 'verein', img: 'gedenktag', desc: '<p>Alle bringen ihren Lieblingswein mit und erzählen, warum gerade dieser es ist. Für Brot und Käse ist gesorgt.</p>' }),
  E('2026-11-12', 'Vorstandssitzung', { time: '19:30', cat: 'vorstand', vis: 'board', loc: 'Pfarrheim, Gruppenraum' }),
  E('2026-11-21', 'Diözesan-Ehrung', { time: '15:00', loc: 'Heßheim', cat: 'verein' }),
  E('2026-11-28', 'Arbeitseinsatz: Wir machen unser Gelände winterfest', { time: '09:00', loc: 'Pfarrheim & Kolpingwiese', cat: 'verein', img: 'arbeitseinsatz', desc: '<p>Laub, Hecken, Dachrinnen – viele Hände, schnelles Ende. Danach gemeinsames Mittagessen.</p>' }),
  E('2026-11-29', 'Musikalische Adventsandacht', { time: '18:00', loc: 'Ev. Kirche Ramsen', cat: 'kapelle' }),
  E('2026-12-06', 'Kolpinggedenktag', { time: '09:00', loc: 'Pfarrkirche & Pfarrheim', cat: 'glaube', img: 'gedenktag', desc: '<p>Heilige Messe, musikalisch begleitet von der Kolpingskapelle. Anschließend Kaffeetafel und Aufnahme neuer Mitglieder im Pfarrheim.</p>' }),
  E('2026-12-13', 'Plätzchen backen', { time: '14:00', cat: 'familie', desc: '<p>Weihnachtsbäckerei für Groß und Klein (Next Generation).</p>' }),
  E('2026-12-20', 'Adventsfeier', { time: '17:00', loc: 'Kolpingwiese', cat: 'verein' }),
  E('2026-12-26', 'Kreativtheater im Pfarrheim', { end: '2026-12-27', time: '19:00', cat: 'theater', img: 'theater-szene', desc: '<p>Das Winterstück unserer Theatergruppe auf der Kreativbühne im Pfarrheim.</p>' }),
  E('2026-12-28', 'Winterwanderung in unserer Region', { time: '10:00', loc: 'Treffpunkt Pfarrheim', cat: 'verein' }),
  E('2027-01-09', 'Kartenvorverkauf Prunksitzung', { time: '13:00', endTime: '15:00', cat: 'verein', img: 'prunksitzung-elferrat' }),
  E('2027-01-13', 'Vorstandssitzung', { time: '19:30', cat: 'vorstand', vis: 'board', loc: 'Pfarrheim, Gruppenraum' }),
  E('2027-02-06', 'Prunksitzung', { time: '20:11', loc: 'Eistalhalle', cat: 'verein', img: 'prunksitzung-saal', desc: '<p>Die große Ramser Prunksitzung mit Elferrat, Garde, Bütt und der Kolpingskapelle.</p>' }),
  E('2027-02-13', 'Fastnachtsfeier für Kinder', { time: '14:00', cat: 'familie', img: 'kinderfasching' }),
  E('2027-03-06', 'Black Orange Party', { time: '19:00', cat: 'jugend', img: 'blackorange' }),
  E('2027-03-14', 'Bezirks-Friedensgebet', { time: '15:00', loc: 'Grünstadt, am Kolpingkreuz', cat: 'glaube' }),
  E('2027-03-18', 'Mitgliederversammlung', { time: '20:00', cat: 'verein', vis: 'members', desc: '<p>Die Einladung mit Tagesordnung liegt im Mitgliederbereich.</p>' }),
  E('2027-03-21', 'Frühjahrskonzert der Kolpingskapelle', { time: '15:00', loc: 'Eistalhalle', cat: 'kapelle', img: 'kapelle-konzert' }),
  E('2027-04-18', '„Kennst du deine Heimat“: Kloster Sion', { time: '14:00', loc: 'Parkplatz Bahnhofstraße', cat: 'verein', img: 'kloster-sion' }),
  E('2027-05-02', 'Kolpinggedenktag im Mai', { time: '09:00', loc: 'Pfarrkirche & Pfarrheim', cat: 'glaube' }),
];

/* ---------------- Neuigkeiten ---------------- */
const news = [
  { id: 'n-1', slug: 'lieblings-weinprobe-2026', title: 'Lieblings-Weinprobe am 7. November', date: '2026-10-14',
    teaser: 'Bringen Sie Ihren Lieblingswein mit – und erzählen Sie uns, warum gerade dieser!',
    body: '<p>Nach dem schönen Abend im letzten Jahr laden wir wieder zur <strong>Lieblings-Weinprobe</strong> ins Pfarrheim ein.</p><p>So funktioniert es: Jede und jeder bringt eine Flasche Lieblingswein mit. Reihum stellen wir die Weine vor und erzählen, was uns damit verbindet. Für Brot, Käse und Wasser ist gesorgt.</p><ul><li>Samstag, 7. November 2026, 19 Uhr</li><li>Pfarrheim Ramsen, Klosterhof 7</li><li>Kostenbeitrag: 5 €</li></ul>',
    image: 'gedenktag', status: 'published', author: 'u-maria', createdAt: T('2026-10-14', 9), updatedAt: T('2026-10-14', 9) },
  { id: 'n-2', slug: 'creepshow-rueckblick', title: '10 Jahre Open-Air-Theater: „Creepshow“ begeistert', date: '2026-09-04',
    teaser: 'Vier ausverkaufte Abende auf der Kolpingwiese – unsere Theatergruppe hat zum Jubiläum alles gegeben.',
    body: '<p>Zehn Jahre ist es her, dass unsere Theatergruppe zum ersten Mal unter freiem Himmel gespielt hat. Zum Jubiläum gab es mit <strong>„Creepshow“</strong> ein schaurig-schönes, selbst geschriebenes Stück.</p><p>Bühnenbau, Technik und Kostüme entstanden wie immer komplett in Eigenleistung. Danke an alle Helferinnen und Helfer – und an unser Publikum!</p><p>Mehr Fotos gibt es auf der Website der Theatergruppe.</p>',
    image: 'theater-nacht', status: 'published', author: 'u-maria', createdAt: T('2026-09-04', 11), updatedAt: T('2026-09-04', 11) },
  { id: 'n-3', slug: 'tintenpatronen-sammelaktion', title: 'Tintenpatronen-Sammelaktion geht weiter', date: '2026-08-12',
    teaser: 'Leere Druckerpatronen mit Druckkopf? Bitte nicht wegwerfen – wir sammeln für den guten Zweck.',
    body: '<p>Wir sammeln weiterhin <strong>leere Tintenpatronen mit Druckkopf</strong>. Der Erlös kommt der Kolpingsfamilie und ihren sozialen Projekten zugute.</p><p>Die Sammelkiste steht im Eingang des Pfarrheims. Toner-Kartuschen können wir leider nicht annehmen.</p>',
    image: null, icon: '♻️', status: 'published', author: 'u-maria', createdAt: T('2026-08-12'), updatedAt: T('2026-08-12') },
  { id: 'n-4', slug: 'jugend-engagement-preis', title: 'Jugend-Engagement-Preis für unser Open-Air-Theater', date: '2026-02-27',
    teaser: 'Der Ministerpräsident von Rheinland-Pfalz zeichnete unsere Theatergruppe in Mainz aus.',
    body: '<p>Große Ehre für die Kolpingsfamilie: Unser <strong>Kolping Open-Air-Theater</strong> hat den Jugend-Engagement-Preis Rheinland-Pfalz 2025/2026 in den Kategorien „Demokratie“ und „Partizipation/gesellschaftliche Teilhabe“ erhalten.</p><p>Das Kolpingtheater Ramsen besteht aus rund 30 Jugendlichen und jungen Erwachsenen zwischen 13 und 31 Jahren, die jedes Jahr ein eigenes Theaterstück entwickeln und aufführen. Besonders ist, dass alle Stücke von der Gruppe selbst geschrieben werden – und auch Bühnenbau, Technik und Kostüme vollständig in Eigenleistung entstehen.</p>',
    image: 'engagementpreis', status: 'published', author: 'u-maria', createdAt: T('2026-02-27'), updatedAt: T('2026-02-27') },
  { id: 'n-5', slug: 'kennst-du-deine-heimat-kloster-sion', title: '„Kennst du deine Heimat“: Kloster Sion', date: '2026-03-23',
    teaser: 'Wir besichtigen das Kloster Sion bei Mauchenheim – mit fachkundiger Führung.',
    body: '<p>In unserer Reihe <strong>„Kennst du deine Heimat“</strong> besichtigen wir das Kloster Sion bei Mauchenheim.</p><p>Abfahrt ist in Ramsen am Parkplatz Bahnhofstraße. Wir fahren nach Orbis an die Selzquelle, stellen dort die Autos ab und wandern zum Kloster. Ein ortskundiger Führer erzählt Interessantes über die Geschichte der Anlage.</p>',
    image: 'kloster-sion', status: 'published', author: 'u-maria', createdAt: T('2026-03-23'), updatedAt: T('2026-03-23') },
  { id: 'n-6', slug: 'altkleidersammlung', title: 'Altkleider-Container am Kirchenparkplatz', date: '2026-01-15',
    teaser: 'Gut erhaltene Kleidung und Schuhe helfen Menschen in Not – und schonen die Umwelt.',
    body: '<p>Die Sammelbehälter stehen auf dem Parkplatz der Kirche, gegenüber dem Kindergarten. Sie werden wöchentlich geleert.</p><p>Gesammelt werden <strong>tragfähige Kleidung und Schuhe</strong>. Mit den Erlösen helfen wir Menschen in Not und Kolpingsfamilien vor Ort und weltweit.</p><p>Ohne Altkleidersammlung würden in Deutschland jährlich über eine Million Tonnen Textilien im Restmüll landen. Altkleider sammeln schont Boden, Wasser und Luft.</p>',
    image: 'altkleider', status: 'published', author: 'u-maria', createdAt: T('2026-01-15'), updatedAt: T('2026-01-15') },
  { id: 'n-7', slug: 'plaetzchen-backen-2026', title: 'Plätzchen backen mit „Next Generation“', date: '2026-10-21',
    teaser: 'Am 13. Dezember wird das Pfarrheim zur Weihnachtsbäckerei.',
    body: '<p>Entwurf – Text folgt noch. Anmeldung bei der Leitung des Familienkreises.</p>',
    image: 'kuerbis-2', status: 'draft', author: 'u-maria', createdAt: T('2026-10-21', 16), updatedAt: T('2026-10-21', 16, 40) },
];

/* ---------------- Seiten (Verein, Vereinsbereiche, Rechtliches) ---------------- */
const P = (section, slug, title, o) => ({
  id: 'p-' + slug, slug, section, title, kicker: o.kicker || '', intro: o.intro || '', body: o.body || '',
  image: o.image || null, order: o.order || 0, status: 'published', external: o.external || null,
  updatedBy: 'u-maria', updatedAt: o.updatedAt || T('2026-09-20'), createdAt: T('2026-09-01'),
});
const pages = [
  P('verein', 'ueber-uns', 'Über uns', { order: 1, image: 'kapelle-gruppe', kicker: 'Seit 1953',
    intro: 'Die Kolpingsfamilie Ramsen wurde am 29. April 1953 gegründet. Heute sind wir über 300 Mitglieder – in einem Dorf mit rund 1.850 Einwohnern.',
    body: '<p>Wir gehören zum Bezirk Grünstadt-Frankenthal und damit zum Kolpingwerk Diözesanverband Speyer. Unser Zuhause ist das große <a href="#/verein/pfarrheim">Pfarrheim</a> – früher die mittelalterliche Zehntscheune des Klosters Ramosa, seit 1978 von der Kolpingsfamilie in Eigenleistung umgebaut und renoviert. Im Ort heißt es einfach „Kolpingheim“.</p><p>Daneben haben wir ab den 90er-Jahren eine große Wiese angelegt. Hier finden die Veranstaltungen im Freien statt: einmal im Monat Boule auf dem eigenen Bouleplatz, Ende August das Open-Air-Theater unserer Theatergruppe.</p><h2>Ein dichtes Jahresprogramm</h2><ul><li>Gottesdienste auf Orts- und Bezirksebene, Kolpinggedenktage, Maiandacht und Rosenkranzgebet</li><li>Wanderungen und Fahrten, „Kennst du deine Heimat“</li><li>die Prunksitzung in der Eistalhalle</li><li>das generationenübergreifende Familienzeltlager in den Sommerferien</li><li>Zwiebelkuchen mit neuem Wein, Maibowle, Weinprobe</li><li>Bildungsabende zu religiösen, geografischen, gesundheitlichen und rechtlichen Themen</li></ul><h2>Unsere Gruppen</h2><p>Die <a href="#/bereiche/kolpingskapelle">Kolpingskapelle</a> (gegründet 1955) probt jeden Freitag. Die <a href="#/bereiche/theater">Theatergruppe</a> ab 14 Jahren trifft sich mittwochs. Dazu kommen <a href="#/bereiche/jugend">Jugend</a>, Garde- und Showtanz sowie die <a href="#/bereiche/familienkreis">Familienkreise</a> 1 und „Next Generation“.</p>' }),
  P('verein', 'pfarrheim', 'Unser Pfarrheim', { order: 2, image: 'pfarrheim', kicker: 'Klosterhof 7',
    intro: 'Vom Kloster „Ramosa“ über die Zehntscheune bis zum lebendigen Vereinsheim: ein Haus mit über 500 Jahren Geschichte.',
    body: '<h2>Zeitleiste</h2><ul class="timeline"><li><b>1146 – 1494</b> Kloster „Ramosa“</li><li><b>1494 – 1793</b> Zehntscheune des Klosters, bischöfliches Klostergut (Worms), Tagungsort des „Stumpfwaldgerichts“</li><li><b>1793</b> Enteignung durch den französischen Staat</li><li><b>1814 – 1828</b> Eigentum des Königreichs Bayern</li><li><b>1828</b> Versteigerung an Private, mehrere Besitzerwechsel</li><li><b>1894</b> Vermächtnis an die katholische Kultusgemeinde</li><li><b>1912</b> Schwesternhaus der Armen Schulschwestern: Krankenpflege, Kinderbewahranstalt, Handarbeitsschule</li><li><b>1977</b> Die letzten Schwestern verlassen Ramsen</li><li><b>1980</b> Einweihung des Pfarrheims nach Umbau in Eigenleistung durch die Kolpingsfamilie</li></ul><h2>Räume</h2><p>Großer Versammlungsraum, Bühne und Saal, Jugendraum und Außengelände – alles von der Kolpingsfamilie ausgebaut, renoviert und angelegt. Mitglieder erhalten einen Preisnachlass auf die Saalmiete.</p><p><strong>Adresse:</strong> Klosterhof 7, 67305 Ramsen</p>' }),
  P('verein', 'geschichte', 'Vereinsgeschichte', { order: 3, image: 'gedenktag', kicker: 'Chronik',
    intro: 'Gegründet auf Einladung des damaligen Pfarrers im Pfarrsaal des Schwesternhauses – am 29. April 1953.',
    body: '<ul class="timeline"><li><b>29.04.1953</b> Gründungsversammlung im Pfarrsaal des Schwesternhauses, Klosterhof 7</li><li><b>06.12.1953</b> Aufnahme der ersten Gründungsmitglieder</li><li><b>16.03.1955</b> Gründung der Kolpingskapelle</li><li><b>seit 1964</b> Die Kapelle spielt bei jeder Prunksitzung</li><li><b>1977</b> Erstes Familien-Wochenendzeltlager</li><li><b>1978 – 1980</b> Umbau des Pfarrheims in Eigenleistung</li><li><b>2009</b> Gründung der Jugendgruppe</li><li><b>2016</b> Erstes Open-Air-Theater auf der Kolpingwiese</li><li><b>2026</b> Jugend-Engagement-Preis Rheinland-Pfalz</li></ul><p class="muted">Die vollständige Liste aller Präsides, Vorsitzenden und Gründungsmitglieder pflegt die Redaktion im neuen System als eigene Seite.</p>' }),
  P('verein', 'adolph-kolping', 'Adolph Kolping', { order: 4, kicker: '1813 – 1865',
    intro: 'Vom Schuhmachergesellen zum Gesellenvater: Wer war der Mann, nach dem wir uns benennen?',
    body: '<p>Adolph Kolping wurde am 8. Dezember 1813 in Kerpen bei Köln als viertes Kind eines Schäfers geboren. Nach der Volksschule erlernte er das Schuhmacherhandwerk und arbeitete zehn Jahre in diesem Beruf. Mit 23 Jahren wagte er den entscheidenden Schritt: Er wurde wieder Schüler am Marzellengymnasium in Köln, studierte Theologie in München und Bonn und empfing 1845 die Priesterweihe.</p><p>Als Kaplan in Elberfeld lernte er den katholischen Gesellenverein kennen und wurde 1847 dessen Präses. 1849 gründete er in Köln den Kölner Gesellenverein – die Keimzelle des heutigen Kolpingwerks.</p><ul class="timeline"><li><b>08.12.1813</b> Geburt in Kerpen</li><li><b>1826 – 1837</b> Lehre und Gesellenzeit als Schuhmacher</li><li><b>13.04.1845</b> Priesterweihe in der Minoritenkirche Köln</li><li><b>06.05.1849</b> Gründung des Kölner Gesellenvereins</li><li><b>04.12.1865</b> Todestag</li><li><b>27.10.1991</b> Seligsprechung in Rom</li></ul>' }),
  P('verein', 'vorstand', 'Vorstand & Ansprechpartner', { order: 5, kicker: 'Leitungsteam',
    intro: 'Unser Leitungsteam und die Verantwortlichen der einzelnen Gruppen.',
    body: '<p class="placeholder-note">Im Prototyp stehen hier bewusst Platzhalter statt echter Namen und Telefonnummern.</p><h2>Leitungsteam</h2><ul><li>Name Platzhalter – Teamsprecher</li><li>Name Platzhalter – Organisatorisches</li><li>Name Platzhalter – Familienkreis 1</li></ul><h2>Weitere Ämter</h2><ul><li>Präses: Pfarrer der Pfarrei (Platzhalter)</li><li>Schriftführung, Protokollführung, Kasse, Heimverwaltung, Mitgliederverwaltung: je Name Platzhalter</li><li>Vertreter der Gruppen: Kapelle, Familienkreise, Theatergruppe, Jugend</li></ul><p>Allgemeiner Kontakt: <a href="#/kontakt">Kontaktformular</a> oder kolping-ramsen@gmx.de</p>' }),
  P('verein', 'mitglied-werden', 'Mitglied werden', { order: 6, image: 'gedenktag', kicker: 'Sei dabei!',
    intro: 'Wir suchen Menschen, die bereit sind, sich zu engagieren und einzubringen.',
    body: '<p>Kolpingmitglieder profitieren von der Gemeinschaft engagierter Menschen – als Weg-, Glaubens-, Bildungs- und Aktionsgemeinschaft. Dazu kommen handfeste Vorteile:</p><ul><li>Kostenlose Zusendung des Kolpingmagazins</li><li>Kostenfreie Unfallversicherung bei Kolping-Veranstaltungen</li><li>Rabatte in Kolping-Hotels und Ferienstätten</li><li>Preisnachlass auf die Miete im Pfarrheim Ramsen</li><li>Kostenloser Ehrenamtsnachweis für Bewerbungen</li><li>Jubiläumsgutscheine bei 25, 50 und 75 Jahren Mitgliedschaft</li></ul><h2>So geht’s</h2><p>Mitgliedsantrag (Einzel- oder Familienmitgliedschaft) und SEPA-Lastschriftmandat ausfüllen und im Pfarrheim abgeben. Die Formulare liegen in der öffentlichen Ablage.</p>' }),

  P('bereiche', 'kolpingskapelle', 'Kolpingskapelle', { order: 1, image: 'kapelle-konzert', kicker: 'Seit 1955',
    intro: 'Blasmusik mit Herz: Die Kolpingskapelle probt jeden Freitag ab 19 Uhr im Pfarrheim.',
    body: '<p>Gegründet am 16. März 1955, spielt die Kapelle seit 1964 bei jeder Prunksitzung, begleitet Gottesdienste und Kolpinggedenktage und sorgt beim Wiesenfest für volle Zelte.</p><h2>Meilensteine</h2><ul class="timeline"><li><b>1965</b> 10-jähriges Jubiläum</li><li><b>1973</b> Anschaffung der Pfälzisch-Westrichen Tracht</li><li><b>1999</b> Neue Trachten-Uniform</li><li><b>2006</b> Jubiläumskonzert „Eine musikalische Reise durch die Zeit“</li><li><b>2010</b> Kerweumzug gemeinsam mit der Feldmusik Schwyz</li><li><b>2026</b> Frühjahrskonzert in der Eistalhalle – Ehrung für 70 Jahre Musizieren</li></ul><p><strong>Neue Musikerinnen und Musiker sind herzlich willkommen!</strong> Einfach freitags vorbeikommen.</p>' }),
  P('bereiche', 'theater', 'Theatergruppe', { order: 2, image: 'theater-ensemble', kicker: 'Open-Air & Kreativbühne',
    external: { url: 'https://kolpingtheater-ramsen.de/', label: 'Zur Website des Kolpingtheaters' },
    intro: 'Rund 30 Jugendliche und junge Erwachsene schreiben, bauen und spielen jedes Jahr ihr eigenes Stück.',
    body: '<p>Die Vorstellungen finden traditionell Ende August auf der Kolpingwiese neben dem Pfarrheim statt, im Winter zusätzlich auf der Kreativbühne im Pfarrheim. Alle Stücke schreibt die Gruppe selbst – Bühnenbau, Technik und Kostüme entstehen in Eigenleistung.</p><p>2026 erhielt die Gruppe den <a href="#/aktuelles/jugend-engagement-preis">Jugend-Engagement-Preis Rheinland-Pfalz</a>.</p><h2>Produktionen</h2><ul class="timeline"><li><b>2016</b> Die Geschichte der Black Swan</li><li><b>2019</b> Dystopia</li><li><b>2022</b> Goldfieber</li><li><b>2023</b> Traum von Freiheit · Sagenhaft</li><li><b>2024</b> Nexus · Eine höllische Herausforderung</li><li><b>2025</b> Anno 1146 · Schicksalsfäden</li><li><b>2026</b> Creepshow</li></ul><p>Proben: mittwochs, ab 14 Jahren. Mitmachen? Ob Schauspiel, Technik oder Organisation – es ist Platz für alle, die Theater lieben.</p>' }),
  P('bereiche', 'jugend', 'Jugend', { order: 3, image: 'engagementpreis', kicker: 'Ab 13 Jahren',
    intro: 'Black Orange Party, Krimidinner, Poolparty und Ferienbetreuung – unsere Jugend ist kreativ und laut.',
    body: '<p>Seit der Gründung 2009 mit rund zehn Kindern ist die Jugendgruppe stetig gewachsen. Heute organisiert sie eigene Veranstaltungen, hilft beim Wiesenfest und Oktoberfest mit und stellt den Großteil der Theatergruppe.</p><p>Ansprechpartner: zwei Jugendvertreter im Vorstand (Kontakt über das <a href="#/kontakt">Kontaktformular</a>).</p>' }),
  P('bereiche', 'familienkreis', 'Familienkreise', { order: 4, image: 'kuerbis-1', kicker: 'Für Familien',
    intro: 'Familienkreis 1 und „Next Generation“ bieten in loser Folge Aktionen für Eltern und Kinder.',
    body: '<p>Kürbisschnitzen mit Kürbissuppe, Ostereier basteln, Kinderfastnacht, Plätzchen backen oder ein Ausflug ins Planetarium Mannheim: Beim Familienkreis „Next Generation“ ist immer etwas los.</p><p>Neue Familien sind jederzeit willkommen – die nächsten Termine stehen im <a href="#/termine?kat=familie">Kalender</a>.</p>' }),
  P('bereiche', 'zeltlager', 'Familienzeltlager', { order: 5, image: 'planetarium', kicker: 'Seit 1977',
    intro: 'Eine Woche Zelte, Lagerfeuer und Gemeinschaft über alle Generationen – jedes Jahr in den Sommerferien.',
    body: '<p>1977 fand das erste Familien-Wochenendzeltlager am Forsthaus „Steigerhof“ bei Bann statt. Seitdem geht es fast jedes Jahr in die Pfalz, ins Saarland oder an die Mosel – nach Hauenstein, Geiselberg, Dahn, an den Bostalsee oder zuletzt nach Niederschlettenbach.</p><p>Das Zeltlager ist generationenübergreifend: Großeltern, Eltern und Kinder verbringen eine Woche zusammen.</p>' }),
  P('bereiche', 'wandern-bildung', 'Wandern, Boule & Bildung', { order: 6, image: 'kloster-sion', kicker: 'Für Junggebliebene',
    intro: 'Wanderungen, „Kennst du deine Heimat“, Boule auf der Kolpingwiese und Bildungsabende.',
    body: '<p>Einmal im Monat wird auf dem eigenen Bouleplatz gespielt. Dazu kommen Herbst- und Winterwanderungen, Ausflüge in der Reihe „Kennst du deine Heimat“ sowie zwei bis drei Bildungsabende im Jahr zu religiösen, geografischen, gesundheitlichen oder rechtlichen Themen.</p>' }),

  P('static', 'impressum', 'Impressum', { order: 1,
    body: '<p class="placeholder-note">Platzhalter – im echten System pflegt die Redaktion diesen Text.</p><p><strong>Kolpingsfamilie Ramsen</strong><br>Pfarrheim, Klosterhof 7<br>67305 Ramsen<br>E-Mail: kolping-ramsen@gmx.de</p><p>Vertreten durch das Leitungsteam (Namen im Prototyp ausgeblendet).</p><p>Haftungshinweis: Für die Inhalte externer Links übernehmen wir keine Verantwortung.</p>' }),
  P('static', 'datenschutz', 'Datenschutz', { order: 2,
    body: '<p class="placeholder-note">Platzhalter – die vollständige Datenschutzerklärung wird übernommen.</p><p>Diese Website verwendet keine Tracking-Cookies und keine externen Dienste. Beim Kontaktformular werden Ihre Angaben nur zur Beantwortung Ihrer Anfrage genutzt. E-Mails versendet das System über den Dienst Resend (Server in der EU).</p>' }),
];

/* ---------------- Medien (Bilder) – von seed-media generiert ---------------- */
const MEDIA = [
  {"id": "ramsen","src": "img/ramsen.webp","thumb": "img/ramsen-s.webp","width": 1600,"height": 1200,"size": 239094,"thumbSize": 25116,"originalSize": 994722,"originalName": "ramsen-scenic.jpg","alt": "Blick über Ramsen mit Kirche im Frühling","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-10T10:00:00"},
  {"id": "pfarrheim","src": "img/pfarrheim.webp","thumb": "img/pfarrheim-s.webp","width": 1024,"height": 553,"size": 52504,"thumbSize": 16920,"originalSize": 140505,"originalName": "pfarrheim.jpg","alt": "Das Pfarrheim am Klosterhof 7","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-11T10:00:00"},
  {"id": "kapelle-gruppe","src": "img/kapelle-gruppe.webp","thumb": "img/kapelle-gruppe-s.webp","width": 1598,"height": 726,"size": 191946,"thumbSize": 38788,"originalSize": 241623,"originalName": "Konzert_2026_16.jpeg","alt": "Die Kolpingskapelle Ramsen vor der Kirche","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-12T10:00:00"},
  {"id": "kapelle-konzert","src": "img/kapelle-konzert.webp","thumb": "img/kapelle-konzert-s.webp","width": 1100,"height": 825,"size": 111256,"thumbSize": 36556,"originalSize": 353240,"originalName": "Konzert_2026_02.jpeg","alt": "Frühjahrskonzert der Kolpingskapelle in der Eistalhalle","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-13T10:00:00"},
  {"id": "kapelle-saal","src": "img/kapelle-saal.webp","thumb": "img/kapelle-saal-s.webp","width": 1100,"height": 825,"size": 95910,"thumbSize": 33414,"originalSize": 302863,"originalName": "Konzert_2026_19.jpeg","alt": "Voller Saal beim Frühjahrskonzert","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-14T10:00:00"},
  {"id": "kapelle-ehrung","src": "img/kapelle-ehrung.webp","thumb": "img/kapelle-ehrung-s.webp","width": 1100,"height": 825,"size": 77532,"thumbSize": 26168,"originalSize": 346637,"originalName": "Konzert_2026_20.jpeg","alt": "Ehrung beim Frühjahrskonzert","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-15T10:00:00"},
  {"id": "wiesenfest-kapelle","src": "img/wiesenfest-kapelle.webp","thumb": "img/wiesenfest-kapelle-s.webp","width": 1500,"height": 1125,"size": 176868,"thumbSize": 34424,"originalSize": 342877,"originalName": "Wiesenfest25_01.jpg","alt": "Die Kolpingskapelle spielt beim Wiesenfest im Festzelt","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-16T10:00:00"},
  {"id": "wiesenfest-zelt","src": "img/wiesenfest-zelt.webp","thumb": "img/wiesenfest-zelt-s.webp","width": 1100,"height": 825,"size": 87496,"thumbSize": 28252,"originalSize": 295108,"originalName": "Wiesenfest25_02.jpg","alt": "Gut gefülltes Festzelt beim Wiesenfest","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-17T10:00:00"},
  {"id": "wiesenfest-helfer","src": "img/wiesenfest-helfer.webp","thumb": "img/wiesenfest-helfer-s.webp","width": 1100,"height": 825,"size": 72356,"thumbSize": 23812,"originalSize": 274300,"originalName": "Wiesenfest25_04.jpg","alt": "Viele Helfer in der Küche beim Wiesenfest","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-18T10:00:00"},
  {"id": "kerwe-umzug","src": "img/kerwe-umzug.webp","thumb": "img/kerwe-umzug-s.webp","width": 1500,"height": 1125,"size": 181504,"thumbSize": 27980,"originalSize": 336578,"originalName": "Kerwe_2025_01.jpg","alt": "Die Kolpingsfamilie beim Ramser Kerweumzug","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-10T10:00:00"},
  {"id": "kerwe-kuehe","src": "img/kerwe-kuehe.webp","thumb": "img/kerwe-kuehe-s.webp","width": 825,"height": 1100,"size": 81612,"thumbSize": 23474,"originalSize": 481552,"originalName": "Kerwe_2025_02.jpg","alt": "Verkleidete Kühe beim Kerweumzug","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-11T10:00:00"},
  {"id": "kerwe-gruppe","src": "img/kerwe-gruppe.webp","thumb": "img/kerwe-gruppe-s.webp","width": 825,"height": 1100,"size": 72576,"thumbSize": 22210,"originalSize": 442876,"originalName": "Kerwe_2025_03.jpg","alt": "Ritter und Burgfräulein beim Kerweumzug","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-12T10:00:00"},
  {"id": "saal","src": "img/saal.webp","thumb": "img/saal-s.webp","width": 1100,"height": 879,"size": 51018,"thumbSize": 17188,"originalSize": 542984,"originalName": "P3161030.JPG","alt": "Der große Saal im Pfarrheim mit Bühne","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-13T10:00:00"},
  {"id": "gruppenraum","src": "img/gruppenraum.webp","thumb": "img/gruppenraum-s.webp","width": 1100,"height": 879,"size": 49710,"thumbSize": 16974,"originalSize": 556547,"originalName": "P3161022.JPG","alt": "Der Gruppenraum im Pfarrheim","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-14T10:00:00"},
  {"id": "kolpingwiese","src": "img/kolpingwiese.webp","thumb": "img/kolpingwiese-s.webp","width": 1100,"height": 879,"size": 114036,"thumbSize": 31618,"originalSize": 518174,"originalName": "P3161028.JPG","alt": "Außengelände und Kolpingwiese am Pfarrheim","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-15T10:00:00"},
  {"id": "engagementpreis","src": "img/engagementpreis.webp","thumb": "img/engagementpreis-s.webp","width": 1400,"height": 933,"size": 79258,"thumbSize": 18568,"originalSize": 428796,"originalName": "image.jpg","alt": "Verleihung des Jugend-Engagement-Preises in Mainz","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-16T10:00:00"},
  {"id": "theater-ensemble","src": "img/theater-ensemble.webp","thumb": "img/theater-ensemble-s.webp","width": 1500,"height": 1000,"size": 137784,"thumbSize": 29598,"originalSize": 289425,"originalName": "Theater2025_03.jpg","alt": "Das Ensemble des Open-Air-Theaters beim Schlussapplaus","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-17T10:00:00"},
  {"id": "theater-szene","src": "img/theater-szene.webp","thumb": "img/theater-szene-s.webp","width": 1100,"height": 733,"size": 62436,"thumbSize": 23800,"originalSize": 213395,"originalName": "Theater2025_01.jpg","alt": "Szene aus dem Theaterstück","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-18T10:00:00"},
  {"id": "theater-wald","src": "img/theater-wald.webp","thumb": "img/theater-wald-s.webp","width": 1100,"height": 733,"size": 70930,"thumbSize": 28672,"originalSize": 244848,"originalName": "Theather2025_00.jpg","alt": "Theaterszene im Wald-Bühnenbild","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-10T10:00:00"},
  {"id": "theater-nacht","src": "img/theater-nacht.webp","thumb": "img/theater-nacht-s.webp","width": 1500,"height": 527,"size": 49872,"thumbSize": 21784,"originalSize": 105963,"originalName": "Theater2025_02.jpg","alt": "Open-Air-Theater bei Nacht auf der Kolpingwiese","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-11T10:00:00"},
  {"id": "prunksitzung-elferrat","src": "img/prunksitzung-elferrat.webp","thumb": "img/prunksitzung-elferrat-s.webp","width": 1500,"height": 1000,"size": 164700,"thumbSize": 34376,"originalSize": 702654,"originalName": "Prunksitzung25_01.jpeg","alt": "Der Elferrat bei der Prunksitzung","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-12T10:00:00"},
  {"id": "prunksitzung-garde","src": "img/prunksitzung-garde.webp","thumb": "img/prunksitzung-garde-s.webp","width": 1100,"height": 733,"size": 51182,"thumbSize": 18306,"originalSize": 372789,"originalName": "Prunksitzung25_02.jpeg","alt": "Die Jugendgarde tanzt bei der Prunksitzung","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-13T10:00:00"},
  {"id": "prunksitzung-saal","src": "img/prunksitzung-saal.webp","thumb": "img/prunksitzung-saal-s.webp","width": 1600,"height": 1200,"size": 135522,"thumbSize": 27832,"originalSize": 741657,"originalName": "Prunksitzung2024_01.jpg","alt": "Geschmückter Saal bei der Prunksitzung","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-14T10:00:00"},
  {"id": "prunksitzung-kapelle","src": "img/prunksitzung-kapelle.webp","thumb": "img/prunksitzung-kapelle-s.webp","width": 1100,"height": 733,"size": 78620,"thumbSize": 28804,"originalSize": 492122,"originalName": "Prunksitzung25_23.jpeg","alt": "Die Kolpingskapelle bei der Prunksitzung","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-15T10:00:00"},
  {"id": "prunksitzung-buett","src": "img/prunksitzung-buett.webp","thumb": "img/prunksitzung-buett-s.webp","width": 1100,"height": 733,"size": 54408,"thumbSize": 21446,"originalSize": 419911,"originalName": "Prunksitzung25_14.jpeg","alt": "Vortrag in der Bütt mit Gitarre","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-16T10:00:00"},
  {"id": "kuerbis-1","src": "img/kuerbis-1.webp","thumb": "img/kuerbis-1-s.webp","width": 1100,"height": 825,"size": 120174,"thumbSize": 37388,"originalSize": 320918,"originalName": "K-rbisschnitzen_012.jpg","alt": "Kinder schnitzen Kürbisse im Pfarrheim","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-17T10:00:00"},
  {"id": "kuerbis-2","src": "img/kuerbis-2.webp","thumb": "img/kuerbis-2-s.webp","width": 1100,"height": 825,"size": 86092,"thumbSize": 30518,"originalSize": 262377,"originalName": "K-rbisschnitzen_019.jpg","alt": "Familien beim Kürbisschnitzen","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-18T10:00:00"},
  {"id": "kinderfasching","src": "img/kinderfasching.webp","thumb": "img/kinderfasching-s.webp","width": 1100,"height": 825,"size": 58652,"thumbSize": 20804,"originalSize": 293774,"originalName": "Kinderfaschingsparty02.jpeg","alt": "Kinder basteln bei der Fastnachtsfeier","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-10T10:00:00"},
  {"id": "planetarium","src": "img/planetarium.webp","thumb": "img/planetarium-s.webp","width": 1100,"height": 825,"size": 105718,"thumbSize": 32480,"originalSize": 342948,"originalName": "Planetarium_01.jpg","alt": "Familienkreis „Next Generation“ im Planetarium Mannheim","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-11T10:00:00"},
  {"id": "gedenktag","src": "img/gedenktag.webp","thumb": "img/gedenktag-s.webp","width": 1100,"height": 825,"size": 92632,"thumbSize": 31946,"originalSize": 319272,"originalName": "Kolpinggedenktag2025_12.jpg","alt": "Kaffeetafel beim Kolpinggedenktag im Pfarrheim","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-12T10:00:00"},
  {"id": "arbeitseinsatz","src": "img/arbeitseinsatz.webp","thumb": "img/arbeitseinsatz-s.webp","width": 1100,"height": 825,"size": 140742,"thumbSize": 31316,"originalSize": 429390,"originalName": "Arbeitseinsatz25.jpg","alt": "Das Gelände nach dem Arbeitseinsatz","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-13T10:00:00"},
  {"id": "rosenkranz","src": "img/rosenkranz.webp","thumb": "img/rosenkranz-s.webp","width": 825,"height": 1100,"size": 71200,"thumbSize": 22126,"originalSize": 273716,"originalName": "Rosenkranz_Dirmstein_1.jpg","alt": "Gestaltete Mitte beim Bezirksrosenkranz","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-14T10:00:00"},
  {"id": "blackorange","src": "img/blackorange.webp","thumb": "img/blackorange-s.webp","width": 1100,"height": 825,"size": 32382,"thumbSize": 13166,"originalSize": 155239,"originalName": "BlackOrange25_01.jpg","alt": "Black Orange Party der Jugend","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-15T10:00:00"},
  {"id": "kloster-sion","src": "img/kloster-sion.webp","thumb": "img/kloster-sion-s.webp","width": 1100,"height": 649,"size": 124514,"thumbSize": 32390,"originalSize": 382420,"originalName": "Kloster-Sion-Mauchenheim-restaurierte_Klostermauer_6.jpg","alt": "Restaurierte Klostermauer am Kloster Sion","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-16T10:00:00"},
  {"id": "altkleider","src": "img/altkleider.webp","thumb": "img/altkleider-s.webp","width": 1000,"height": 889,"size": 49728,"thumbSize": 23614,"originalSize": 383910,"originalName": "Kleidercontainer.jpg","alt": "Altkleider-Container der Kolpingsfamilie","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-17T10:00:00"},
  {"id": "tintenpatronen","src": "img/tintenpatronen.webp","thumb": "img/tintenpatronen-s.webp","width": 638,"height": 900,"size": 55928,"thumbSize": 29358,"originalSize": 317090,"originalName": "Tintenpatronen_sammeln.jpg","alt": "Plakat zur Tintenpatronen-Sammelaktion","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-18T10:00:00"},
  {"id": "champagne","src": "img/champagne.webp","thumb": "img/champagne-s.webp","width": 1100,"height": 825,"size": 154126,"thumbSize": 38130,"originalSize": 569749,"originalName": "Champagne_08.jpg","alt": "Flusslandschaft auf der Bildungsreise in die Champagne","type": "image/webp","uploadedBy": "u-maria","createdAt": "2026-09-10T10:00:00"}];

/* ---------------- Alben (Rückblick / Galerie) ---------------- */
const albums = [
  { id: 'a-prunksitzung-2026', title: 'Prunksitzung 2026', date: '2026-02-07', cover: 'prunksitzung-elferrat',
    text: 'Elferrat, Garde, Bütt und Männerballett: Die Prunksitzung in der Eistalhalle war wieder ausverkauft. Musikalisch begleitet von der Kolpingskapelle.',
    media: ['prunksitzung-elferrat', 'prunksitzung-garde', 'prunksitzung-buett', 'prunksitzung-kapelle', 'prunksitzung-saal'] },
  { id: 'a-konzert-2026', title: 'Frühjahrskonzert 2026', date: '2026-03-22', cover: 'kapelle-konzert',
    text: 'Volle Eistalhalle beim Konzert der Kolpingskapelle – mit einer Ehrung für 70 Jahre Musizieren.',
    media: ['kapelle-konzert', 'kapelle-saal', 'kapelle-ehrung', 'kapelle-gruppe'] },
  { id: 'a-theater-2026', title: 'Open-Air-Theater', date: '2026-08-21', cover: 'theater-ensemble',
    text: 'Unsere Theatergruppe auf der Kolpingwiese – mehr Fotos auf kolpingtheater-ramsen.de.',
    media: ['theater-ensemble', 'theater-szene', 'theater-wald', 'theater-nacht', 'engagementpreis'] },
  { id: 'a-wiesenfest-2025', title: 'Wiesenfest & Oktoberfest', date: '2025-10-18', cover: 'wiesenfest-kapelle',
    text: 'Gute Stimmung durch die Blaskapelle, ein gut gefülltes Festzelt und viele Helfer für die gute Sache.',
    media: ['wiesenfest-kapelle', 'wiesenfest-zelt', 'wiesenfest-helfer'] },
  { id: 'a-kerwe-2025', title: 'Ramser Kerwe 2025', date: '2025-09-14', cover: 'kerwe-umzug',
    text: 'Die Kolpingsfamilie beim Kerweumzug – mit Kühen, Rittern und viel Musik.',
    media: ['kerwe-umzug', 'kerwe-kuehe', 'kerwe-gruppe'] },
  { id: 'a-familie-2025', title: 'Familienkreis „Next Generation“', date: '2025-10-26', cover: 'kuerbis-1',
    text: 'Kürbisschnitzen mit anschließender Kürbissuppe, Kinderfastnacht und Planetarium.',
    media: ['kuerbis-1', 'kuerbis-2', 'kinderfasching', 'planetarium'] },
  { id: 'a-gedenktag-2025', title: 'Kolpinggedenktag & Arbeitseinsatz', date: '2025-12-07', cover: 'gedenktag',
    text: 'Messe mit der Blaskapelle, Kaffeetafel im Pfarrheim und die Aufnahme von 49 neuen Mitgliedern. Dazu: 18 Helfer machten das Gelände winterfest.',
    media: ['gedenktag', 'arbeitseinsatz', 'rosenkranz', 'kolpingwiese'] },
  { id: 'a-pfarrheim', title: 'Unser Pfarrheim', date: '2025-03-16', cover: 'saal',
    text: 'Saal, Gruppenraum und Außengelände – alles in Eigenleistung ausgebaut.',
    media: ['pfarrheim', 'saal', 'gruppenraum', 'kolpingwiese'] },
];

/* ---------------- Dateiablage ---------------- */
// visibility nur an obersten Ordnern; Unterordner erben (parentId).
const folders = [
  { id: 'f-vorstand', name: 'Vorstand', parentId: null, visibility: 'board', icon: '🔒', createdBy: 'u-stefan', createdAt: T('2026-09-01') },
  { id: 'f-prot-2025', name: 'Protokolle 2025', parentId: 'f-vorstand', createdBy: 'u-klaus', createdAt: T('2026-09-03') },
  { id: 'f-prot-2026', name: 'Protokolle 2026', parentId: 'f-vorstand', createdBy: 'u-klaus', createdAt: T('2026-09-03') },
  { id: 'f-finanzen', name: 'Finanzen', parentId: 'f-vorstand', createdBy: 'u-klaus', createdAt: T('2026-09-03') },
  { id: 'f-mitglieder', name: 'Mitglieder', parentId: null, visibility: 'members', icon: '👥', createdBy: 'u-stefan', createdAt: T('2026-09-01') },
  { id: 'f-satzung', name: 'Satzung & Einladungen', parentId: 'f-mitglieder', createdBy: 'u-klaus', createdAt: T('2026-09-03') },
  { id: 'f-oeffentlich', name: 'Öffentlich', parentId: null, visibility: 'public', icon: '🌐', createdBy: 'u-stefan', createdAt: T('2026-09-01') },
  { id: 'f-flyer', name: 'Flyer & Formulare', parentId: 'f-oeffentlich', createdBy: 'u-klaus', createdAt: T('2026-09-03') },
];
let fi = 0;
const F = (folderId, name, size, o = {}) => ({
  id: 'd-' + (++fi), folderId, name, type: o.type || (name.split('.').pop() || 'pdf').toLowerCase(), size,
  originalSize: o.originalSize || null, protocolId: o.protocolId || null, note: o.note || '',
  uploadedBy: o.by || 'u-klaus', createdAt: o.at || T('2026-09-20'), updatedAt: o.at || T('2026-09-20'),
});
const files = [
  F('f-prot-2025', 'Vorstandssitzung 2025-11-13.pdf', 188416, { at: T('2025-11-20') }),
  F('f-prot-2025', 'Vorstandssitzung 2025-09-11.pdf', 165888, { at: T('2025-09-18') }),
  F('f-prot-2026', 'Mitgliederversammlung 2026-03-19.pdf', 253952, { at: T('2026-03-26'), protocolId: 'pr-3' }),
  F('f-prot-2026', 'Vorstandssitzung 2026-09-09', 0, { type: 'protocol', protocolId: 'pr-2', at: T('2026-09-12') }),
  F('f-prot-2026', 'Vorstandssitzung 2026-10-14 (Entwurf)', 0, { type: 'protocol', protocolId: 'pr-1', at: T('2026-10-14', 21) }),
  F('f-finanzen', 'Kassenbericht 2025.xlsx', 49152, { at: T('2026-02-10') }),
  F('f-finanzen', 'Beitragsliste 2026.xlsx', 62464, { at: T('2026-01-08') }),
  F('f-finanzen', 'Foto Kassenbuch.webp', 186368, { type: 'image', originalSize: 4404019, at: T('2026-10-02'), note: 'Vom Handy fotografiert, automatisch verkleinert' }),
  F('f-satzung', 'Satzung der Kolpingsfamilie Ramsen.pdf', 319488, { at: T('2026-09-05') }),
  F('f-satzung', 'Einladung Mitgliederversammlung 2027.pdf', 98304, { at: T('2026-10-18') }),
  F('f-satzung', 'Beitragsordnung (Beschluss 2023).pdf', 75776, { at: T('2026-09-05') }),
  F('f-mitglieder', 'Rundschreiben Herbst 2026.pdf', 421888, { at: T('2026-10-01') }),
  F('f-flyer', 'Mitgliedsantrag Einzelmitglied.pdf', 419840, { by: 'u-stefan', at: T('2026-09-05') }),
  F('f-flyer', 'Mitgliedsantrag Familie.pdf', 436224, { by: 'u-stefan', at: T('2026-09-05') }),
  F('f-flyer', 'SEPA-Lastschriftmandat.pdf', 131072, { by: 'u-stefan', at: T('2026-09-05') }),
  F('f-flyer', 'Plakat Lieblings-Weinprobe.pdf', 1153434, { at: T('2026-10-12') }),
];

/* ---------------- Protokolle ---------------- */
const protocolBody = (o) => `
<h2>Vorstandssitzung am ${o.datum}</h2>
<p><strong>Ort:</strong> Pfarrheim, Gruppenraum · <strong>Beginn:</strong> 19:30 Uhr · <strong>Ende:</strong> ${o.ende}</p>
<p><strong>Anwesend:</strong> ${o.anwesend}</p>
<p><strong>Protokoll:</strong> Klaus Muster</p>
<h3>TOP 1 – Begrüßung und Genehmigung des letzten Protokolls</h3>
<p>${o.top1}</p>
<h3>TOP 2 – ${o.top2t}</h3>
<p>${o.top2}</p>
<h3>TOP 3 – ${o.top3t}</h3>
<p>${o.top3}</p>
<h3>Beschlüsse</h3>
<ul>${o.beschluesse.map(b => `<li>${b}</li>`).join('')}</ul>
<h3>Verschiedenes</h3>
<p>${o.versch}</p>`;

const protocols = [
  { id: 'pr-1', title: 'Vorstandssitzung 14.10.2026', date: '2026-10-14', kind: 'vorstand', folderId: 'f-prot-2026', fileId: 'd-5',
    status: 'draft', author: 'u-klaus', editors: ['u-klaus', 'u-stefan'],
    attendees: ['Klaus Muster', 'Stefan Beispiel', 'Teamsprecher (Platzhalter)', 'Kasse (Platzhalter)', 'Vertretung Jugend (Platzhalter)'],
    body: protocolBody({ datum: '14. Oktober 2026', ende: '21:15 Uhr', anwesend: '7 von 9 Vorstandsmitgliedern (Liste siehe oben)',
      top1: 'Der Teamsprecher begrüßt die Anwesenden. Das Protokoll vom 9. September wird ohne Änderungen genehmigt.',
      top2t: 'Lieblings-Weinprobe am 7. November', top2: 'Anmeldungen bisher: 34. Brot und Käse besorgt das Leitungsteam. Der Saal wird am Freitagabend gestellt.',
      top3t: 'Neue Website', top3: 'Der Prototyp für die neue Website wurde vorgestellt. Offene Fragen: Wer bekommt welche Rechte? Wer schreibt künftig die Neuigkeiten?',
      beschluesse: ['Kostenbeitrag Weinprobe: 5 € (einstimmig)', 'Arbeitseinsatz am 28.11. findet statt'],
      versch: '…' }),
    createdAt: T('2026-10-14', 19, 35), updatedAt: T('2026-10-14', 21, 20), updatedBy: 'u-klaus',
    versions: [{ at: T('2026-10-14', 20, 10), by: 'u-klaus', label: 'Zwischenstand während der Sitzung' }] },
  { id: 'pr-2', title: 'Vorstandssitzung 09.09.2026', date: '2026-09-09', kind: 'vorstand', folderId: 'f-prot-2026', fileId: 'd-4',
    status: 'final', author: 'u-klaus', editors: ['u-klaus'], approvedBy: 'u-klaus', approvedAt: T('2026-09-12', 10),
    attendees: ['Klaus Muster', 'Stefan Beispiel', 'Teamsprecher (Platzhalter)', 'Kasse (Platzhalter)'],
    body: protocolBody({ datum: '9. September 2026', ende: '21:40 Uhr', anwesend: '8 von 9 Vorstandsmitgliedern',
      top1: 'Begrüßung, Protokoll vom 8. Juli genehmigt.',
      top2t: 'Rückblick Open-Air-Theater', top2: 'Vier Vorstellungen, alle ausverkauft. Dank an die Theatergruppe und alle Helfer.',
      top3t: 'Herbstprogramm', top3: 'Rosenkranzandacht (2.10.), Oktoberfest (17.10.), Herbstwanderung (24.10.) und Weinprobe (7.11.) sind geplant.',
      beschluesse: ['Anschaffung von zwei Pavillons für die Kolpingwiese (bis 600 €)', 'Neue Website: Angebot für Prototyp einholen'],
      versch: 'Nächste Sitzung am 14. Oktober.' }),
    createdAt: T('2026-09-09', 19, 30), updatedAt: T('2026-09-12', 10), updatedBy: 'u-klaus', versions: [] },
  { id: 'pr-3', title: 'Mitgliederversammlung 19.03.2026', date: '2026-03-19', kind: 'mitgliederversammlung', folderId: 'f-prot-2026', fileId: 'd-3',
    status: 'final', author: 'u-klaus', editors: ['u-klaus'], approvedBy: 'u-klaus', approvedAt: T('2026-03-26'),
    attendees: ['62 Mitglieder laut Anwesenheitsliste'],
    body: '<h2>Mitgliederversammlung am 19. März 2026</h2><p><strong>Ort:</strong> Pfarrheim · <strong>Beginn:</strong> 20:00 Uhr</p><h3>TOP 1 – Bericht des Leitungsteams</h3><p>Rückblick auf ein volles Jahr mit Prunksitzung, Theater, Zeltlager und 49 Neuaufnahmen beim Kolpinggedenktag.</p><h3>TOP 2 – Kassenbericht</h3><p>Die Kasse wurde geprüft und ohne Beanstandungen bestätigt.</p><h3>TOP 3 – Entlastung</h3><p>Der Vorstand wurde einstimmig entlastet.</p><h3>Beschlüsse</h3><ul><li>Entlastung des Vorstands (einstimmig)</li><li>Mitgliedsbeiträge bleiben unverändert</li></ul>',
    createdAt: T('2026-03-19', 20), updatedAt: T('2026-03-26'), updatedBy: 'u-klaus', versions: [] },
];

/* ---------------- Änderungsprotokoll (Audit) ---------------- */
let au = 0;
const A = (at, userId, action, target, details = '') => ({ id: 'l-' + (++au), at, userId, action, target, details });
const audit = [
  A(T('2026-10-21', 20, 14), 'u-stefan', 'user.login', 'Stefan Beispiel', 'Anmelde-Link per E-Mail'),
  A(T('2026-10-21', 16, 40), 'u-maria', 'news.update', 'Neuigkeit „Plätzchen backen mit „Next Generation““', 'Entwurf gespeichert'),
  A(T('2026-10-20', 19, 2), 'u-klaus', 'user.login', 'Klaus Muster', 'Anmelde-Link per E-Mail'),
  A(T('2026-10-18', 11, 5), 'u-klaus', 'file.upload', 'Einladung Mitgliederversammlung 2027.pdf', 'Ordner Mitglieder › Satzung & Einladungen'),
  A(T('2026-10-14', 21, 20), 'u-klaus', 'protocol.update', 'Protokoll „Vorstandssitzung 14.10.2026“', 'Automatisch gespeichert'),
  A(T('2026-10-14', 9, 0), 'u-maria', 'news.publish', 'Neuigkeit „Lieblings-Weinprobe am 7. November“', 'Auf der Website gezeigt'),
  A(T('2026-10-12', 18, 30), 'u-klaus', 'file.upload', 'Plakat Lieblings-Weinprobe.pdf', 'Ordner Öffentlich › Flyer & Formulare'),
  A(T('2026-10-02', 17, 45), 'u-klaus', 'file.upload', 'Foto Kassenbuch.webp', '4,2 MB → 182 KB verkleinert'),
  A(T('2026-09-20', 10, 12), 'u-maria', 'page.update', 'Seite „Über uns“', ''),
  A(T('2026-09-15', 15, 3), 'u-maria', 'event.create', '26 Termine importiert', 'aus der alten Website'),
  A(T('2026-09-10', 12, 0), 'u-stefan', 'user.invite', 'Hans Gast', 'Rolle: Mitglied'),
  A(T('2026-09-02', 9, 30), 'u-stefan', 'user.invite', 'Maria Probe', 'Rolle: Redakteurin'),
  A(T('2026-09-02', 9, 28), 'u-stefan', 'user.invite', 'Klaus Muster', 'Rolle: Vorstand'),
];

/* ---------------- Postausgang (Mail-Vorschauen) ---------------- */
const mails = [];

/** Liefert eine frische, tief kopierte Datenbank (Seed-Konstanten bleiben unverändert). */
export function buildSeed() {
  return JSON.parse(JSON.stringify({
    version: SEED_VERSION,
    roles: ROLES.map(r => ({ ...r, permissions: [...r.permissions] })),
    users, events, news, pages, albums, folders, files, protocols, audit, mails,
    media: MEDIA.map(m => ({ ...m })),
    eventCategories: EVENT_CATEGORIES,
  }));
}
