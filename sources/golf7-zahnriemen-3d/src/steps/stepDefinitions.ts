import type { CameraPresetDefinition, StepDefinition, ToolDefinition } from '../types';

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    id: 'hand',
    hotkey: '1',
    name: 'Montagehandschuhe / Hand',
    shortName: 'Hand',
    spec: 'Demontage & Sichtprüfung',
  },
  {
    id: 'impact17',
    hotkey: '2',
    name: 'Schlagschrauber SW 17',
    shortName: 'SW 17',
    spec: 'Radschrauben lösen',
  },
  {
    id: 'torx25',
    hotkey: '3',
    name: 'Torx-Schraubendreher T25',
    shortName: 'Torx T25',
    spec: 'Radhaus & Abdeckung',
  },
  {
    id: 'crankWrench',
    hotkey: '4',
    name: 'Kurbelwellen-Schlüssel / Knarre',
    shortName: 'KW-Knarre',
    spec: 'OT finden & 720° drehen',
  },
  {
    id: 'lockingPins',
    hotkey: '5',
    name: 'Absteckdorn-Satz (OT)',
    shortName: 'Absteckdorne',
    spec: 'KW / NW / HDP sichern',
  },
  {
    id: 'eccentricKey',
    hotkey: '6',
    name: 'Exzenter-Spannschlüssel',
    shortName: 'Exzenter',
    spec: 'Spannzeiger einstellen',
  },
  {
    id: 'torqueWrench',
    hotkey: '7',
    name: 'Drehmomentschlüssel',
    shortName: 'Drehmoment',
    spec: 'Anzug nach RLF',
  },
  {
    id: 'newTimingBelt',
    hotkey: '8',
    name: 'Neuer Zahnriemen-Satz',
    shortName: 'Zahnriemen',
    spec: 'EA288 Steuertrieb (7 St.)',
  },
];

export const CAMERA_PRESETS: CameraPresetDefinition[] = [
  { id: 'overview', hotkey: 'Q', label: 'Werkstatt' },
  { id: 'engineTop', hotkey: 'W', label: 'Motor' },
  { id: 'wheelWell', hotkey: 'E', label: 'Radhaus' },
  { id: 'timingClose', hotkey: 'R', label: 'Steuertrieb' },
  { id: 'tensionerMacro', hotkey: 'T', label: 'Spanner' },
];

export const REPAIR_STEPS: StepDefinition[] = [
  {
    index: 0,
    id: 'prep_lift',
    title: 'Motorhaube öffnen & Hebebühne hochfahren',
    subtitle: 'Schritt 1 von 13 • Fahrzeugvorbereitung',
    description:
      'Öffne zuerst die Motorhaube des Golf VII und fahre anschließend das Fahrzeug über den grünen Aufwärts-Taster an der rechten Hebebühnensäule auf Arbeitshöhe.',
    whyTip:
      'Für den Zahnriemenwechsel am quer eingebauten EA288 1.6 TDI brauchst du Zugang von oben (Motorraum/Nockenwelle) und seitlich über das rechte Radhaus zur Kurbelwelle. Hinweis: Diese 3D-Werkstatt bildet den Ablauf als Übungsmodell vereinfacht ab — am realen Fahrzeug gelten stets der VW-Reparaturleitfaden und vorgeschriebene Sonderwerkzeuge.',
    requiredTools: ['hand'],
    cameraPreset: 'overview',
    subObjectives: [
      { id: 'open_hood', label: 'Motorhaube entriegeln und öffnen' },
      { id: 'raise_lift', label: 'Hebebühne auf Arbeitshöhe hochfahren' },
    ],
  },
  {
    index: 1,
    id: 'engine_cover',
    title: 'TDI-Motorabdeckung abnehmen',
    subtitle: 'Schritt 2 von 13 • Zugang Motorraum oben',
    description:
      'Ziehe die obere TDI-Akustikabdeckung senkrecht aus den Gummilagerzapfen nach oben ab, um freien Einblick auf Zylinderkopf, Kraftstoff-Hochdruckpumpe und die obere Zahnriemenabdeckung zu schaffen.',
    whyTip:
      'Die Motorabdeckung ist gesteckt und gibt nach dem Abnehmen den oberen Bereich des Steuertriebs auf der Beifahrerseite frei.',
    requiredTools: ['hand'],
    cameraPreset: 'engineTop',
    subObjectives: [
      { id: 'remove_cover', label: 'TDI-Motorabdeckung nach oben abziehen' },
    ],
  },
  {
    index: 2,
    id: 'remove_wheel',
    title: 'Vorderrad rechts demontieren',
    subtitle: 'Schritt 3 von 13 • Zugang Beifahrerseite',
    description:
      'Löse alle 5 Radschrauben mit dem Schlagschrauber SW 17 und nimm anschließend das rechte Vorderrad mit der Hand ab (wird auf dem Reifenständer abgelegt).',
    whyTip:
      'Der gesamte EA288-Steuertrieb sitzt an der rechten Stirnseite des Motors — über das rechte Radhaus erreichst du Kurbelwellenrad, Umlenkrollen, Wasserpumpe und Spannrolle direkt.',
    requiredTools: ['impact17', 'hand'],
    cameraPreset: 'wheelWell',
    subObjectives: [
      { id: 'unbolt_lug_0', label: 'Radschraube 1 (SW 17) lösen' },
      { id: 'unbolt_lug_1', label: 'Radschraube 2 (SW 17) lösen' },
      { id: 'unbolt_lug_2', label: 'Radschraube 3 (SW 17) lösen' },
      { id: 'unbolt_lug_3', label: 'Radschraube 4 (SW 17) lösen' },
      { id: 'unbolt_lug_4', label: 'Radschraube 5 (SW 17) lösen' },
      { id: 'take_off_wheel', label: 'Vorderrad rechts von der Radnabe abnehmen' },
    ],
  },
  {
    index: 3,
    id: 'remove_liner',
    title: 'Radhausschale vorne rechts ausbauen',
    subtitle: 'Schritt 4 von 13 • Spritzschutz entfernen',
    description:
      'Schraube alle 6 Torx-T25-Befestigungsschrauben heraus und entnimm die Radhausschale, um den direkten Arbeitsraum vor der Zahnriemenabdeckung freizulegen.',
    whyTip:
      'Erst nach dem Entfernen der Radhausschale hast du freie Sicht auf die komplette Stirnseite des EA288-Steuertriebs.',
    requiredTools: ['torx25', 'hand'],
    cameraPreset: 'wheelWell',
    subObjectives: [
      { id: 'unscrew_liner_0', label: 'Torx-Schraube T25 #1 herausdrehen' },
      { id: 'unscrew_liner_1', label: 'Torx-Schraube T25 #2 herausdrehen' },
      { id: 'unscrew_liner_2', label: 'Torx-Schraube T25 #3 herausdrehen' },
      { id: 'unscrew_liner_3', label: 'Torx-Schraube T25 #4 herausdrehen' },
      { id: 'unscrew_liner_4', label: 'Torx-Schraube T25 #5 herausdrehen' },
      { id: 'unscrew_liner_5', label: 'Torx-Schraube T25 #6 herausdrehen' },
      { id: 'take_off_liner', label: 'Radhausschale aus dem Radhaus nehmen' },
    ],
  },
  {
    index: 4,
    id: 'open_timing_cover',
    title: 'Zahnriemenabdeckung abnehmen & Steuertrieb prüfen',
    subtitle: 'Schritt 5 von 13 • Steuertrieb freilegen',
    description:
      'Löse die beiden Befestigungen der Zahnriemenabdeckung mit Torx T25, nimm die Abdeckung von Hand ab und inspiziere danach den alten Zahnriemen, um das 7-Stationen-Schema freizuschalten.',
    whyTip:
      'Der Zahnriemen koppelt Kurbelwelle, Nockenwelle (2:1) und Hochdruckpumpe formschlüssig über Zähne; über den glatten Rücken werden Kühlmittelpumpe, Umlenkrollen und Spannrolle angetrieben.',
    requiredTools: ['torx25', 'hand'],
    cameraPreset: 'timingClose',
    subObjectives: [
      { id: 'unbolt_timing_cover_0', label: 'Obere Befestigung der Zahnriemenabdeckung lösen (T25)' },
      { id: 'unbolt_timing_cover_1', label: 'Untere Befestigung der Zahnriemenabdeckung lösen (T25)' },
      { id: 'remove_timing_cover', label: 'Zahnriemenabdeckung abnehmen' },
      { id: 'inspect_timing_belt', label: 'Alten Zahnriemen prüfen & 7-Stationen-Schema speichern' },
    ],
  },
  {
    index: 5,
    id: 'find_ot',
    title: 'Kurbelwelle auf OT (720°) drehen',
    subtitle: 'Schritt 6 von 13 • Steuerzeiten-Ausgangsstellung',
    description:
      'Setze den Kurbelwellen-Schlüssel am Kurbelwellenrad an und drehe den Motor im Uhrzeigersinn, bis alle drei orangefarbenen Bezugsmarken an Kurbelwelle, Nockenwelle und Hochdruckpumpe exakt unter ihren festen Zeigern fluchten (OT).',
    whyTip:
      'Zwei Kurbelwellenumdrehungen (720°) entsprechen genau einer Nockenwellenumdrehung (360°). Nur im oberen Totpunkt (OT) stehen alle drei Absteckbohrungen gleichzeitig in Position.',
    requiredTools: ['crankWrench'],
    specBadge: 'OT • 720° KW',
    cameraPreset: 'timingClose',
    subObjectives: [
      { id: 'align_ot', label: 'Kurbelwelle im Uhrzeigersinn auf OT (720°) ausrichten' },
    ],
  },
  {
    index: 6,
    id: 'lock_shafts',
    title: 'Kurbelwelle, Nockenwelle & Hochdruckpumpe arretieren',
    subtitle: 'Schritt 7 von 13 • Steuerzeiten formschlüssig sichern',
    description:
      'Wähle den Absteckdorn-Satz und stecke Kurbelwelle, Nockenwelle und Hochdruckpumpe nacheinander in ihrer OT-Stellung fest, damit sich keine Welle beim Abnehmen des Riemens verdreht.',
    whyTip:
      'Beim Dieselmotor (EA288) liegen die Ventilfedern unter hoher Vorspannung. Ohne gesetzte Arretierdorne kann die Nockenwelle sofort wegschnappen und die Steuerzeiten verstellen.',
    requiredTools: ['lockingPins'],
    specBadge: '3× Arretierung',
    cameraPreset: 'timingClose',
    subObjectives: [
      { id: 'lock_crank', label: 'Kurbelwellenrad in OT-Stellung arretieren' },
      { id: 'lock_cam', label: 'Nockenwellenrad mit Absteckdorn sichern' },
      { id: 'lock_pump', label: 'Hochdruckpumpenrad mit Absteckdorn sichern' },
    ],
  },
  {
    index: 7,
    id: 'remove_old_belt',
    title: 'Spannrolle lösen, alten Zahnriemen abnehmen & Rollen prüfen',
    subtitle: 'Schritt 8 von 13 • Demontage & Lagercheck',
    description:
      'Entlaste die Exzenter-Spannrolle mit dem Exzenter-Schlüssel, hebe danach den entspannten alten Zahnriemen mit der Hand ab und prüfe Kühlmittelpumpe sowie beide Umlenkrollen auf spielfreien Lauf.',
    whyTip:
      'Bei jedem Zahnriemenwechsel werden Spannrolle, Umlenkrollen und die über den Zahnriemen angetriebene Kühlmittelpumpe sorgfältig auf Geräusche, Spiel und Dichtheit geprüft bzw. im Satz ersetzt.',
    requiredTools: ['eccentricKey', 'hand'],
    cameraPreset: 'timingClose',
    subObjectives: [
      { id: 'release_old_tensioner', label: 'Exzenter-Spannrolle entlasten' },
      { id: 'take_old_timing_belt', label: 'Alten Zahnriemen von den Rädern abnehmen' },
      { id: 'check_water_pump', label: 'Kühlmittelpumpe von Hand auf leichten Lauf prüfen' },
      { id: 'check_idlers', label: 'Obere & untere Umlenkrolle auf Lagerlauf prüfen' },
    ],
  },
  {
    index: 8,
    id: 'install_new_belt',
    title: 'Neuen Zahnriemen auflegen (7 Stationen)',
    subtitle: 'Schritt 9 von 13 • Formschlüssige Riemenführung',
    description:
      'Wähle den neuen Zahnriemen-Satz und führe den Riemen beginnend an der Kurbelwelle exakt entlang der blauen Führungsspur über alle 7 Räder und Rollen.',
    whyTip:
      'Beginne am Kurbelwellenrad und halte das Zugtrum über die Umlenk- und Spannrolle zur Nockenwelle straff, damit die Zähne ohne Versatz sauber in alle Zahnlücken greifen.',
    requiredTools: ['newTimingBelt'],
    specBadge: '7 Stationen',
    cameraPreset: 'timingClose',
    subObjectives: [
      { id: 'route_crank', label: '1. Zahnriemen am Kurbelwellenrad ansetzen' },
      { id: 'route_lower', label: '2. Riemenrücken über untere Umlenkrolle führen' },
      { id: 'route_tensioner', label: '3. Riemenrücken an Exzenter-Spannrolle anlegen' },
      { id: 'route_cam', label: '4. Verzahnung auf Nockenwellenrad (2:1) auflegen' },
      { id: 'route_upper', label: '5. Riemen über obere Umlenkrolle umlenken' },
      { id: 'route_pump', label: '6. Verzahnung auf Hochdruckpumpenrad auflegen' },
      { id: 'route_water', label: '7. Riemenrücken über Kühlmittelpumpe schließen' },
    ],
  },
  {
    index: 9,
    id: 'set_tension',
    title: 'Spannzeiger im Referenzfenster einstellen & sichern',
    subtitle: 'Schritt 10 von 13 • Riemenspannung einstellen',
    description:
      'Drehe den Exzenter der Spannrolle mit dem Exzenter-Schlüssel, bis der orange Zeiger exakt mittig im Referenzfenster steht (grün). Ziehe anschließend die Befestigung mit dem Drehmomentschlüssel im Sollbereich (nach RLF) an.',
    whyTip:
      'Zu geringe Spannung begünstigt Zahnübersprung, zu hohe Spannung überlastet Wasserpumpen- und Rollenlager. Der Zeiger wird stets von der entspannten Seite aus mittig in das Fenster geführt.',
    requiredTools: ['eccentricKey', 'torqueWrench'],
    specBadge: 'Zeiger Mitte • RLF',
    cameraPreset: 'tensionerMacro',
    subObjectives: [
      { id: 'align_tension_pointer', label: 'Exzenter drehen bis Spannzeiger mittig im Referenzfenster steht' },
      { id: 'torque_tensioner_nut', label: 'Spannrollen-Befestigung mit Drehmomentschlüssel (Sollbereich RLF) anziehen' },
    ],
  },
  {
    index: 10,
    id: 'remove_locks',
    title: 'Alle 3 Arretierdorne ziehen',
    subtitle: 'Schritt 11 von 13 • Wellen vor Durchdrehen freigeben',
    description:
      'Der neue Zahnriemen liegt sauber auf und ist korrekt gespannt. Ziehe jetzt alle drei Absteckdorne an Kurbelwelle, Nockenwelle und Hochdruckpumpe wieder heraus.',
    whyTip:
      'Vor dem Durchdrehen von Hand müssen ausnahmslos alle Arretierwerkzeuge entfernt werden — ein vergessener Dorn blockiert die Welle und beschädigt Nabe oder Gehäuse.',
    requiredTools: ['lockingPins'],
    cameraPreset: 'timingClose',
    subObjectives: [
      { id: 'unlock_crank', label: 'Absteckdorn Kurbelwelle herausziehen' },
      { id: 'unlock_cam', label: 'Absteckdorn Nockenwelle herausziehen' },
      { id: 'unlock_pump', label: 'Absteckdorn Hochdruckpumpe herausziehen' },
    ],
  },
  {
    index: 11,
    id: 'check_timing_run',
    title: '720° von Hand durchdrehen, OT prüfen & Probelauf',
    subtitle: 'Schritt 12 von 13 • Steuerzeiten- & Funktionskontrolle',
    description:
      'Drehe die Kurbelwelle mit der KW-Knarre zweimal komplett (720° KW = 360° NW) im Uhrzeigersinn durch, prüfe OT-Markierungen & Spannzeiger per Klick und starte danach den 1.6 TDI Probelauf.',
    whyTip:
      'Durch zwei volle Kurbelwellenumdrehungen setzt sich der neue Zahnriemen gleichmäßig in allen Verzahnungstälern. Fluchten alle drei OT-Marken und der Spannzeiger erneut exakt, passen die Steuerzeiten.',
    requiredTools: ['crankWrench', 'hand'],
    specBadge: '720° Prüfung',
    cameraPreset: 'timingClose',
    subObjectives: [
      { id: 'manual_crank_720', label: 'Kurbelwelle 2× (720°) von Hand durchdrehen' },
      { id: 'verify_ot_and_pointer', label: 'OT-Marken & Spannzeiger im Referenzfenster bestätigen' },
      { id: 'engine_idle_check', label: '1.6 TDI Probelauf starten & ruhigen Riemenlauf prüfen' },
    ],
  },
  {
    index: 12,
    id: 'reassemble',
    title: 'Rückbau & Übergabekontrolle',
    subtitle: 'Schritt 13 von 13 • Fahrzeug wiederherstellen',
    description:
      'Montiere Zahnriemenabdeckung, Radhausschale (6× T25) und Vorderrad, ziehe die 5 Radschrauben über Kreuz mit dem Drehmomentschlüssel (Sollbereich RLF) an, schließe Motorabdeckung & Haube und lasse die Hebebühne ab.',
    whyTip:
      'Die Zahnriemenabdeckung schützt den Steuertrieb vor Schmutz und Steinschlag. Radschrauben immer über Kreuz nach Herstellervorgabe anziehen und nach der ersten Fahrt nachkontrollieren.',
    requiredTools: ['hand', 'torx25', 'torqueWrench'],
    specBadge: 'Rückbau • RLF',
    cameraPreset: 'timingClose',
    subObjectives: [
      { id: 'reinstall_timing_cover', label: 'Zahnriemenabdeckung ansetzen & befestigen (T25)' },
      { id: 'reinstall_liner', label: 'Radhausschale einsetzen & 6× T25 verschrauben' },
      { id: 'reinstall_wheel', label: 'Vorderrad rechts auf Radnabe aufsetzen' },
      { id: 'torque_wheel_bolts', label: '5 Radschrauben über Kreuz im Sollbereich (RLF) anziehen' },
      { id: 'reinstall_cover_hood', label: 'TDI-Motorabdeckung & Motorhaube schließen' },
      { id: 'lower_lift', label: 'Hebebühne komplett ablassen (gelber Abwärts-Taster)' },
    ],
  },
];
