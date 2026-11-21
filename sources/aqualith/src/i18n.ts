import type { Lang } from './types.ts';

const STRINGS = {
  de: {
    gameTitle: 'AQUALITH',
    gameSubtitle: 'Meister der Lebenden Flut',
    titleTagline: 'Forme Gezeiten, Eisbrücken und Strudel durch uralte versunkene Heiligtümer.',
    startCampaign: 'Kampagne starten',
    continueCampaign: 'Kampagne fortsetzen',
    openSandbox: 'Gezeiten-Labor',
    selectChapter: 'Kapitel wählen',
    closeMenu: 'Schließen',
    backToMenu: 'Menü',

    // Tools
    toolSurge: 'Flutstoß',
    toolSurgeDesc: 'Ziehen, um Wellen und Strömungen zu schleudern [1]',
    toolIce: 'Eisform',
    toolIceDesc: 'LMB malt Eisdämme & Rampen · RMB schmilzt Eis [2]',
    toolVortex: 'Strudel-Kanone',
    toolVortexDesc: 'Gedrückt halten zum Bündeln · loslassen für Wasserstoß [3]',
    toolShatter: 'Eis sprengen',
    toolShatterDesc: 'Alle Eisbarrieren gleichzeitig zertrümmern [Leertaste]',
    toolPour: 'Wasserquelle',
    toolPourDesc: 'Wasser direkt aus dem Nichts gießen',
    toolDrain: 'Sog-Abfluss',
    toolDrainDesc: 'Wasser lokal absaugen',
    toolRock: 'Basalt-Meißel',
    toolRockDesc: 'LMB baut Fels · RMB trägt Fels ab',

    // Sandbox actions
    sbTsunami: 'Tsunami!',
    sbSpouts: 'Quellen',
    sbTurbine: '+ Turbine',
    sbArk: '+ Arche',
    sbMagma: '+ Magma',
    sbWall: '+ Bruchwand',
    sbMine: '+ Mine',
    sbSeesaw: '+ Wippe',
    sbClearWater: 'Becken leeren',

    // Controls & HUD
    hintLabel: 'Hinweis',
    slowMo: 'Zeitlupe',
    reset: 'Neustart',
    mute: 'Ton',
    qualityHigh: 'Hoch',
    qualityUltra: 'Ultra',
    frostGauge: 'Eis-Vorrat',
    waterParticles: 'Tropfen',
    chapterPrefix: 'Kapitel',
    parTimeLabel: 'Par-Zeit',
    bestTimeLabel: 'Bestzeit',
    starsLabel: 'Sterne',
    lockedLabel: 'Freigeschaltet',

    // Victory Modal
    victoryTitle: 'Heiligtum Erweckt!',
    victorySubtitle: 'Die Strömung fließt im Einklang mit dem Stein.',
    victoryTime: 'Zeit',
    victoryPar: 'Zielzeit',
    nextChapter: 'Nächstes Kapitel',
    replayChapter: 'Nochmal spielen',
    campaignComplete: 'Alle 7 Heiligtümer gemeistert!',
    enterSandbox: 'Ins Gezeiten-Labor',

    // Objectives
    objTurbines: 'Hydro-Turbinen laden',
    objRelics: 'Relikt-Archen zum Altar geleiten',
    objWalls: 'Brüchige Dämme sprengen',
    objMagma: 'Magmaschlot zu Obsidian löschen',
    objCisterns: 'Gegengewicht-Zisternen füllen',
    objRelays: 'Hydro-Relais unter Strom setzen',
    objMines: 'Hydro-Minen an Bruchwänden zünden',
    objSandbox: 'Freies Experimentieren mit Wasser, Eis & Mechanik',

    // Levels
    'lvl.demo.title': 'Kaskade des Erwachens',
    'lvl.demo.sub': 'Lebende Wassersimulation',
    'lvl.demo.hint': 'Starte die Kampagne oder experimentiere im Gezeiten-Labor.',

    'lvl.1.title': 'Der Erste Überlauf',
    'lvl.1.sub': 'Umlenkventil, Flutstoß & Eisrampe',
    'lvl.1.hint': 'Klicke auf die goldene Weiche [Klick], um den Strom umzuleiten, und schleudere Wellen [1] oder baue eine Eisrampe [2] zur Turbine.',

    'lvl.2.title': 'Die Hydro-Brücke',
    'lvl.2.sub': 'Wasserleitfähigkeit & Schleusentor',
    'lvl.2.hint': 'Drehe das Ventil, damit Wasser die beiden Kupferelektroden verbindet — der Lichtbogen öffnet das Tor für die Arche!',

    'lvl.3.title': 'Die Wippen-Mine',
    'lvl.3.sub': 'Hydraulische Wippe & Hydro-Mine',
    'lvl.3.hint': 'Leite den Strom auf den linken Wippenarm: Die Hydro-Mine rollt in die Flut und sprengt beide Bruchwände!',

    'lvl.4.title': 'Siphon-Portale',
    'lvl.4.sub': 'Hydro-Portale & Doppel-Turbine',
    'lvl.4.hint': 'Schleudere Wasser ins Bernstein-Portal — oben schießt der Strahl heraus! Lenke ihn per Mittel-Ventil auf beide Turbinen.',

    'lvl.5.title': 'Obsidian & Dampf-Aufzug',
    'lvl.5.sub': 'Magma-Brücke & Auftriebs-Geysir',
    'lvl.5.hint': 'Drehe zuerst die Weiche zum Löschen der unteren Magma-Brücke. Rechts erzeugt leichtes Wasser Dampf, der die Kugel hebt!',

    'lvl.6.title': 'Das Geysir-Katapult',
    'lvl.6.sub': 'Relais-Strom, Druckgeysir & Mine',
    'lvl.6.hint': 'Schalte das Relais mit Wasser ein, sodass der Geysir die Mine auf die Wippe katapultiert und das Tor für die Arche sprengt!',

    'lvl.7.title': 'Die Große Zitadelle',
    'lvl.7.sub': 'Meisterprüfung aller Elemente',
    'lvl.7.hint': 'Weichen drehen, Portal speisen, Damm-Mine zünden, Relais schließen und die Kronen-Arche ins Heiligtum tragen!',

    'lvl.sb.title': 'Gezeiten-Labor',
    'lvl.sb.sub': 'Freie Physik-Sandbox',
    'lvl.sb.hint': 'Erschaffe Tsunamis, Portale, Wippen, Minen, Eis-Aquädukte und Magma-Geysire nach Belieben.',

    tutorialDrag: 'Klicke das Ventil & schleudere Wasser!',
    valveClickHint: 'Klicken zum Umschalten',
    slowMoBadge: 'ZEITLUPE 0.35×',
  },
  en: {
    gameTitle: 'AQUALITH',
    gameSubtitle: 'Master of the Living Tide',
    titleTagline: 'Sculpt tides, ice aqueducts, and hydro-vortices across ancient sunken sanctuaries.',
    startCampaign: 'Start Campaign',
    continueCampaign: 'Continue Campaign',
    openSandbox: 'Tide Lab',
    selectChapter: 'Select Chapter',
    closeMenu: 'Close',
    backToMenu: 'Menu',

    toolSurge: 'Surge',
    toolSurgeDesc: 'Drag through water to whip waves & currents [1]',
    toolIce: 'Ice Sculpt',
    toolIceDesc: 'LMB paints ice dams & ramps · RMB melts ice [2]',
    toolVortex: 'Vortex Cannon',
    toolVortexDesc: 'Hold to gather water · release for hydro-blast [3]',
    toolShatter: 'Shatter Ice',
    toolShatterDesc: 'Detonate all ice barriers at once [Space]',
    toolPour: 'Pour Water',
    toolPourDesc: 'Pour fresh water directly at cursor',
    toolDrain: 'Vacuum Drain',
    toolDrainDesc: 'Remove water locally',
    toolRock: 'Basalt Chisel',
    toolRockDesc: 'LMB sculpts stone · RMB carves stone',

    sbTsunami: 'Tsunami!',
    sbSpouts: 'Spouts',
    sbTurbine: '+ Turbine',
    sbArk: '+ Ark',
    sbMagma: '+ Magma',
    sbWall: '+ Cracked Wall',
    sbMine: '+ Mine',
    sbSeesaw: '+ Seesaw',
    sbClearWater: 'Drain Basin',

    hintLabel: 'Hint',
    slowMo: 'Slow-Mo',
    reset: 'Reset',
    mute: 'Audio',
    qualityHigh: 'High',
    qualityUltra: 'Ultra',
    frostGauge: 'Frost Budget',
    waterParticles: 'Droplets',
    chapterPrefix: 'Chapter',
    parTimeLabel: 'Par Time',
    bestTimeLabel: 'Best',
    starsLabel: 'Stars',
    lockedLabel: 'Unlocked',

    victoryTitle: 'Sanctuary Awakened!',
    victorySubtitle: 'The living current flows in harmony with the stone.',
    victoryTime: 'Time',
    victoryPar: 'Par',
    nextChapter: 'Next Chapter',
    replayChapter: 'Replay',
    campaignComplete: 'All 7 Sanctuaries Mastered!',
    enterSandbox: 'Enter Tide Lab',

    objTurbines: 'Charge Hydro-Turbines',
    objRelics: 'Float Relic Arks to Altar',
    objWalls: 'Blast Cracked Dams',
    objMagma: 'Quench Magma Seal into Obsidian',
    objCisterns: 'Fill Counterweight Cisterns',
    objRelays: 'Bridge Live Hydro-Relays',
    objMines: 'Detonate Hydro-Mines on Walls',
    objSandbox: 'Experiment freely with water, ice & hydraulics',

    'lvl.demo.title': 'Cascade of Awakening',
    'lvl.demo.sub': 'Live Fluid Simulation',
    'lvl.demo.hint': 'Start the campaign or experiment freely in Tide Lab.',

    'lvl.1.title': 'The First Spillway',
    'lvl.1.sub': 'Diverter Valve, Surge & Ice Ramp',
    'lvl.1.hint': 'Click the brass diverter valve to redirect the stream, then whip waves [1] or build an Ice ramp [2] onto the turbine.',

    'lvl.2.title': 'The Hydro Bridge',
    'lvl.2.sub': 'Water Conductivity & Sluice Lock',
    'lvl.2.hint': 'Flip the valve so water bridges both copper electrodes — the electric arc opens the bronze gate for the Ark!',

    'lvl.3.title': 'The Seesaw Mine',
    'lvl.3.sub': 'Hydraulic Seesaw & Buoyant Mine',
    'lvl.3.hint': 'Pour water onto the left seesaw arm to roll the Hydro-Mine into the torrent and blast both cracked walls!',

    'lvl.4.title': 'Siphon Portals',
    'lvl.4.sub': 'Hydro-Portals & Twin Turbines',
    'lvl.4.hint': 'Feed the Amber Portal in the basin — a roaring jet erupts overhead! Aim it across both turbines with the center valve.',

    'lvl.5.title': 'Obsidian & Steam Lift',
    'lvl.5.sub': 'Magma Bridge & Buoyant Geyser',
    'lvl.5.hint': 'Flip the left valve to quench the lower magma bridge into obsidian, then feed light water on the right for steam lift!',

    'lvl.6.title': 'The Geyser Catapult',
    'lvl.6.sub': 'Hydro-Relay, Pressure Jet & Mine',
    'lvl.6.hint': 'Bridge the Hydro-Relay to fire the Geyser Pump, launching the Mine onto the high seesaw to shatter the vault!',

    'lvl.7.title': 'The Grand Citadel',
    'lvl.7.sub': 'Master Trial of Every Element',
    'lvl.7.hint': 'Flip valves, feed the portal, launch the dam mine, bridge the relay, and ride the Crown Ark to the Sanctuary!',

    'lvl.sb.title': 'Tide Lab',
    'lvl.sb.sub': 'Free Physics Sandbox',
    'lvl.sb.hint': 'Play freely with tsunamis, portals, seesaws, hydro-mines, ice aqueducts, and magma geysers.',

    tutorialDrag: 'Click the valve & surge the wave!',
    valveClickHint: 'Click to toggle',
    slowMoBadge: 'SLOW-MO 0.35×',
  },
} as const;

export type I18nKey = keyof typeof STRINGS.de;

export function t(lang: Lang, key: string): string {
  const dict = STRINGS[lang] as Record<string, string>;
  const fallback = STRINGS.en as Record<string, string>;
  return dict[key] ?? fallback[key] ?? key;
}
