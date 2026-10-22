// Crownward – alle spielersichtbaren Texte (Deutsch). Schlüssel aus der Simulation (offer.*, blocked.*)
// siehe docs/DESIGN.md §7. Platzhalter: {name} → vars.name.

export const DE: Record<string, string> = {
  // --- App / Titel ---
  'app.title': 'Crownward',
  'app.subtitle': 'Die erste Insel: Morgenrand',
  'app.tagline': 'Reite, sammle, baue – und halte die Nebelbrut bis zum Morgengrauen fern.',
  'app.footer': 'Ein eigenständiges Spiel · Version {version}',
  'app.loading': 'Die Insel erwacht …',
  'app.loadingPct': '{pct} %',
  'app.loadFailed': 'Einige Grafiken fehlen – das Spiel läuft mit Ersatzdarstellung.',
  'app.portraitTip': 'Tipp: Im Querformat siehst du mehr von der Insel.',

  // --- Hauptmenü ---
  'menu.continue': 'Fortsetzen',
  'menu.continueSub': 'Tag {day} · {slot} · {when}',
  'menu.newGame': 'Neues Spiel',
  'menu.newGameSub': 'Allein über die Insel reiten',
  'menu.coop': 'Koop-Spiel',
  'menu.coopSub': '2 Spieler, ein Bildschirm',
  'menu.coopNeedsKeys': 'Braucht Tastatur oder Gamepad für Spieler 2',
  'menu.controls': 'Steuerung',
  'menu.settings': 'Einstellungen',
  'menu.back': 'Zurück',

  // --- Pause ---
  'pause.title': 'Pause',
  'pause.resume': 'Fortsetzen',
  'pause.save': 'Speichern',
  'pause.load': 'Laden',
  'pause.settings': 'Einstellungen',
  'pause.controls': 'Steuerung',
  'pause.mainMenu': 'Hauptmenü',
  'pause.confirmMenu': 'Nicht gespeicherter Fortschritt geht verloren. Wirklich zum Hauptmenü?',
  'pause.confirmYes': 'Ja, zum Hauptmenü',
  'pause.confirmNo': 'Weiterspielen',
  'pause.noSave': 'Noch kein Speicherstand',
  'pause.lastSave': 'Speicherstand: Tag {day} · {when}',

  // --- Speichern / Laden ---
  'save.slot.slot1': 'Speicherplatz',
  'save.slot.auto': 'Autosave',
  'save.done': 'Spielstand gespeichert',
  'save.auto': 'Morgen-Autosave gesichert',
  'save.failed': 'Speichern fehlgeschlagen: {error}',
  'save.notPlaying': 'Nach Spielende kann nicht gespeichert werden',
  'save.noGame': 'Kein laufendes Spiel',
  'load.done': 'Spielstand geladen – Tag {day}',
  'load.missing': 'Kein Speicherstand vorhanden',
  'load.failed': 'Laden fehlgeschlagen: {error}',
  'load.blocked': '{slot}: {error}',
  'time.justNow': 'gerade eben',
  'time.minutes': 'vor {n} Min.',
  'time.today': 'heute, {time}',
  'time.date': '{date}, {time}',

  // --- Einstellungen ---
  'settings.title': 'Einstellungen',
  'settings.master': 'Gesamtlautstärke',
  'settings.music': 'Musik & Ambiente',
  'settings.sfx': 'Effekte',
  'settings.muted': 'Stumm (M)',
  'settings.forceTouch': 'Touch-Steuerung immer anzeigen',
  'settings.fullscreen': 'Vollbild umschalten',
  'settings.note': 'Einstellungen werden auf diesem Gerät gespeichert.',
  'settings.mutedOn': 'Ton aus',
  'settings.mutedOff': 'Ton an',

  // --- Hilfe ---
  'help.title': 'Steuerung & Ziel',
  'help.goalTitle': 'Ziel',
  'help.goal': 'Repariere das Schiff im Westen und lege ab.',
  'help.goalDetail':
    'Das Wrack liegt jenseits des westlichen Nebelrisses. Jede Reparaturstufe verlangt eine höhere Siedlungsstufe – baue zuerst dein Dorf aus. Ist das Schiff seetüchtig, halte die Münztaste davor, um in See zu stechen.',
  'help.solo': 'Einzelspiel',
  'help.coop': 'Koop (geteilter Bildschirm)',
  'help.p1': 'Spieler 1',
  'help.p2': 'Spieler 2',
  'help.general': 'Allgemein',
  'help.touch': 'Touch',
  'help.gamepad': 'Gamepad',
  'help.ride': 'Reiten',
  'help.sprint': 'Sprinten',
  'help.pay': 'Münzen zahlen (halten)',
  'help.drop': 'Münze fallen lassen (kurz, abseits von Bauwerken)',
  'help.pause': 'Pause',
  'help.helpKey': 'Hilfe',
  'help.mute': 'Ton an/aus',
  'help.quicksave': 'Schnellspeichern',
  'help.quickload': 'Schnellladen',
  'help.or': 'oder',
  'help.touchText': '◀ ▶ reiten · » sprinten · Münze halten zum Bezahlen · ❚❚ Pause',
  'help.gamepadText': 'Stick/Steuerkreuz reiten · A Münze · X/RB sprinten · Start Pause · Back Hilfe',
  'help.tipsTitle': 'Tipps',
  'help.tip1': 'Lass eine Münze vor einem Landstreicher fallen – hebt er sie auf, schließt er sich dir an.',
  'help.tip2':
    'Kaufe Werkzeuge an den Ständern. Freie Dorfbewohner holen sie sich und werden Bauleute, Bogenschützen oder Bauern.',
  'help.tip3': 'Bauleute errichten und reparieren Mauern. Bogenschützen verteidigen nachts die äußersten Mauern.',
  'help.tip4':
    'Nachts greift die Nebelbrut an – zuerst aus dem Osten, ab der zweiten Nacht von beiden Seiten. Wirst du ohne Münzen getroffen, fällt deine Krone – das Spiel ist verloren.',
  'help.tip5': 'Sprinten kostet Ausdauer. Bleibt dein Pferd stehen und grast, erholt es sich schneller.',
  'help.tip6': 'Truhen und Schreine in der Wildnis lohnen den Ausritt – sei vor Einbruch der Nacht zurück.',
  'help.close': 'Schließen',

  // --- HUD ---
  'hud.day': 'Tag {n}',
  'hud.night': 'Nacht {n}',
  'hud.phase.day': 'Tag',
  'hud.phase.dusk': 'Abend',
  'hud.phase.night': 'Nacht',
  'hud.phase.dawn': 'Morgengrauen',
  'hud.untilNight': 'Nacht in {t}',
  'hud.nightFalls': 'Die Nacht bricht herein',
  'hud.untilDawn': 'Morgen in {t}',
  'hud.dawn': 'Der Morgen graut',
  'hud.paleMoon': 'Fahlmond',
  'hud.coins': 'Münzen',
  'hud.purseFull': 'voll',
  'hud.stamina': 'Ausdauer',
  'hud.crown': 'Krone',
  'hud.crownLost': 'Krone verloren',
  'hud.unprotected': 'Ohne Münzen kostet ein Treffer die Krone!',
  'hud.objective': 'Schiff {n}/3',
  'hud.objectiveTitle': 'Ziel: Repariere das Schiff im Westen und lege ab',
  'hud.objectiveReady': 'Schiff bereit',
  'hud.player': 'Spieler {n}',
  'hud.pause': 'Pause',
  'hud.timeScale': 'Zeitraffer ×{n}',

  // --- Kontexthinweise ---
  'hint.hold.kb1': 'S halten',
  'hint.hold.kbSolo': 'S / ↓ halten',
  'hint.hold.kb2': '↓ halten',
  'hint.hold.touch': 'Münze halten',
  'hint.hold.pad': 'A halten',
  'hint.tap.kb1': 'S tippen',
  'hint.tap.kbSolo': 'S / ↓ tippen',
  'hint.tap.kb2': '↓ tippen',
  'hint.tap.touch': 'Münze tippen',
  'hint.tap.pad': 'A tippen',
  'hint.vagrant': 'Landstreicher',
  'hint.vagrantDetail': 'Münze hinwerfen – er schließt sich dir an',
  'hint.free': 'kostenlos',
  'hint.missing.one': 'Dir fehlt 1 Münze',
  'hint.missing': 'Dir fehlen {n} Münzen',
  'hint.paying': '{paid}/{cost}',
  'hint.intro.kb': 'A/D oder ←/→ reiten · Shift sprinten · S halten zum Bezahlen · H Hilfe',
  'hint.intro.touch': '◀ ▶ reiten · » sprinten · Münze halten zum Bezahlen',
  'hint.intro.pad': 'Stick reiten · X/RB sprinten · A halten zum Bezahlen · Back Hilfe',
  'hint.intro.coop': 'Spieler 1: {p1}   —   Spieler 2: {p2}',
  'hint.intro.coop.kb1': 'A/D · Shift links · S',
  'hint.intro.coop.kb2': '←/→ · Shift rechts · ↓',
  'hint.intro.coop.touch': '◀ ▶ · » · Münze',
  'hint.intro.coop.pad': 'Stick · X/RB · A',

  // --- Angebote (sim → ui, docs/DESIGN.md §7) ---
  'offer.upgradeTown.1': 'Unterstand errichten',
  'offer.upgradeTown.2': 'Langhaus errichten',
  'offer.upgradeTown.3': 'Feste errichten',
  'offer.buildWall.1': 'Pfahlwerk',
  'offer.upgradeWall.2': 'Holzpalisade',
  'offer.upgradeWall.3': 'Steinmauer',
  'offer.buildTower.1': 'Holzturm',
  'offer.upgradeTower.2': 'Steinturm',
  'offer.buildFarm': 'Feld anlegen',
  'offer.buyTool.hammer': 'Hammer für Bauleute',
  'offer.buyTool.bow': 'Bogen für Bogenschützen',
  'offer.buyTool.scythe': 'Sense für Bauern',
  'offer.openChest': 'Truhe öffnen',
  'offer.activateShrine.bow': 'Schrein des Bogens',
  'offer.activateShrine.hammer': 'Schrein des Hammers',
  'offer.repairShip.1': 'Schiffsrumpf flicken',
  'offer.repairShip.2': 'Mast aufrichten',
  'offer.repairShip.3': 'Segel setzen',
  'offer.embark': 'In See stechen',
  'offer.generic': 'Angebot',
  // Wirkung eines Angebots (Detailzeile vor den Kosten), nur wo der Name sie nicht verrät
  'effect.offer.activateShrine.bow': 'Bogenschützen schießen weiter und schneller',
  'effect.offer.activateShrine.hammer': 'Bauleute arbeiten schneller',
  'effect.offer.buildFarm': 'Bauern mit Sense ernten hier tagsüber Münzen',
  'blocked.building': 'Wird gerade gebaut',
  // Bau-Stand aus sim constructionStatus (warum ein Bau stillsteht)
  'blocked.building.working': 'Bauleute arbeiten daran',
  'blocked.building.noBuilders': 'Wartet auf Bauleute – kaufe einen Hammer',
  'blocked.building.waitingForDay': 'Bauleute beginnen bei Tagesanbruch',
  'blocked.building.queued': 'Bauleute sind noch anderswo beschäftigt',
  'blocked.town.1': 'Benötigt Siedlungsstufe 1',
  'blocked.town.2': 'Benötigt Siedlungsstufe 2',
  'blocked.town.3': 'Benötigt Siedlungsstufe 3',
  'blocked.stockFull': 'Ständer ist voll',
  'blocked.generic': 'Derzeit nicht möglich',

  // --- Stufen-/Bauwerksnamen ---
  'level.town.0': 'Lagerfeuer',
  'level.town.1': 'Unterstand',
  'level.town.2': 'Langhaus',
  'level.town.3': 'Feste',
  'level.wall.1': 'Pfahlwerk',
  'level.wall.2': 'Holzpalisade',
  'level.wall.3': 'Steinmauer',
  'level.tower.1': 'Holzturm',
  'level.tower.2': 'Steinturm',
  'level.farm.1': 'Feld',
  'level.ship.1': 'Rumpf geflickt',
  'level.ship.2': 'Mast aufgerichtet',
  'level.ship.3': 'Segel gesetzt',

  // --- Ereignis-Hinweise ---
  'toast.recruit': 'Ein Landstreicher schließt sich dir an',
  'toast.role.builder': 'Ein Bewohner greift zum Hammer',
  'toast.role.archer': 'Ein Bewohner greift zum Bogen',
  'toast.role.farmer': 'Ein Bewohner greift zur Sense',
  'toast.build.townCenter': 'Die Siedlung wächst: {name}',
  'toast.build.wall': 'Mauer fertig: {name}',
  'toast.build.tower': 'Turm fertig: {name}',
  'toast.build.farm': 'Ein Feld wurde angelegt',
  'toast.build.generic': 'Bau abgeschlossen',
  'toast.nightWarning': 'Die Nacht naht …',
  'toast.paleMoonWarning': 'Fahlmond! Eine starke Welle naht …',
  'toast.nightBegins': 'Nacht {n} beginnt',
  'toast.nightBeginsSub': 'Die Nebelbrut kommt von beiden Seiten',
  'toast.nightBeginsEast': 'Die Nebelbrut kommt aus dem Osten',
  'toast.nightBeginsWest': 'Die Nebelbrut kommt aus dem Westen',
  'toast.paleMoonSub': 'Fahlmond – die Nebelbrut ist zahlreicher',
  'toast.dayBreaks': 'Tag {n} bricht an',
  'toast.dayBreaksSub': 'Die Nebelbrut weicht dem Licht',
  'toast.dusk': 'Die Sonne sinkt – bring dein Volk in Sicherheit',
  'toast.dissolved': 'Die Nebelbrut zerfällt im Morgenlicht',
  'toast.chest': 'Truhe geöffnet: +{coins}',
  'toast.shrine.bow': 'Schrein des Bogens: Bogenschützen schießen weiter und schneller',
  'toast.shrine.hammer': 'Schrein des Hammers: Bauleute arbeiten schneller',
  'toast.wallDestroyed': 'Eine Mauer ist gefallen!',
  'toast.citizenLost': 'Ein Bewohner wurde getroffen und flieht',
  'toast.purseFull': 'Dein Beutel ist voll',
  'toast.ship.1': 'Das Schiff: Rumpf geflickt (1/3)',
  'toast.ship.2': 'Das Schiff: Mast aufgerichtet (2/3)',
  'toast.ship.3': 'Das Schiff ist seetüchtig! Stich in See',
  'toast.playerHit': 'Getroffen! −{coins}',
  'toast.playerHitCoop': 'Spieler {p} getroffen! −{coins}',
  'toast.crownLost': 'Die Krone ist verloren!',
  'toast.crownStolen': 'Die Nebelbrut flieht mit der Krone!',
  'toast.goal': 'Ziel: Repariere das Schiff im Westen und lege ab',
  'toast.welcome': 'Morgenrand',
  'toast.welcomeSub': 'Tag 1 – eine Krone, ein Pferd, ein paar Münzen',
  'toast.coopJoin': 'Koop: Spieler 2 reitet mit',
  'toast.timeScale': 'Zeitraffer ×{n}',

  // --- Spielende ---
  'end.victory': 'Sieg!',
  'end.victorySub': 'Das Schiff legt ab – Morgenrand liegt hinter euch.',
  'end.defeat': 'Die Krone ist gefallen',
  'end.defeatSub': 'Die Nebelbrut hat Morgenrand überrannt.',
  'end.defeatSub.outside': 'Draußen vor den Mauern hat dir die Nebelbrut die Krone entrissen.',
  'end.defeatSub.outsideCoop': 'Draußen vor den Mauern hat die Nebelbrut Spieler {n} die Krone entrissen.',
  'end.defeatSub.noWall': 'Ohne schützende Mauer hat dir die Nebelbrut die Krone entrissen.',
  'end.defeatSub.noWallCoop': 'Ohne schützende Mauer hat die Nebelbrut Spieler {n} die Krone entrissen.',
  'end.defeatSub.hit': 'Die Nebelbrut hat dir die Krone entrissen.',
  'end.defeatSub.hitCoop': 'Die Nebelbrut hat Spieler {n} die Krone entrissen.',
  'end.stats': 'Chronik',
  'end.days': 'Tage',
  'end.coinsCollected': 'Münzen gesammelt',
  'end.coinsSpent': 'Münzen ausgegeben',
  'end.enemiesSlain': 'Nebelbrut besiegt',
  'end.recruited': 'Bewohner angeworben',
  'end.wallsLost': 'Mauern verloren',
  'end.citizensLost': 'Bewohner verloren',
  'end.chestsOpened': 'Truhen geöffnet',
  'end.restart': 'Neu beginnen',
  'end.loadLast': 'Letzten Spielstand laden',
  'end.mainMenu': 'Hauptmenü',
};

/** Übersetzt einen Schlüssel; unbekannte Schlüssel fallen auf eine lesbare Ersatzbeschriftung zurück. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = DE[key];
  if (s === undefined) {
    if (key.startsWith('blocked.town.')) s = `Benötigt Siedlungsstufe ${key.slice('blocked.town.'.length)}`;
    else if (key.startsWith('blocked.')) s = DE['blocked.generic'];
    else if (key.startsWith('offer.')) s = DE['offer.generic'];
    else s = key;
    warnMissing(key);
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return s;
}

const warned = new Set<string>();
function warnMissing(key: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  if (import.meta.env.DEV) console.warn(`[i18n] fehlender Schlüssel: ${key}`);
}

/** Gibt es einen Text zu diesem Schlüssel? (ohne Warnung – für optionale Texte) */
export function hasText(key: string): boolean {
  return DE[key] !== undefined;
}

/** „1 Münze" / „n Münzen" */
export function coinsText(n: number): string {
  return n === 1 ? '1 Münze' : `${n} Münzen`;
}

/** Sekunden → „m:ss" */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Zeitpunkt eines Speicherstands relativ zu jetzt, deutsch formatiert. */
export function savedAtText(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (diffMin < 1) return t('time.justNow');
  if (diffMin < 60) return t('time.minutes', { n: diffMin });
  if (d.toDateString() === now.toDateString()) return t('time.today', { time });
  return t('time.date', { date: d.toLocaleDateString('de-DE'), time });
}
