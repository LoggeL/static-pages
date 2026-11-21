import type { CameraPresetDefinition, StepDefinition, ToolDefinition } from '../types';

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    id: 'hand',
    hotkey: '1',
    name: 'Montagehandschuhe / Hand',
    shortName: 'Hand',
    spec: 'Demontage & Prüfung',
  },
  {
    id: 'impact17',
    hotkey: '2',
    name: 'Schlagschrauber SW 17',
    shortName: 'SW 17',
    spec: 'Radschrauben 17 mm',
  },
  {
    id: 'torx25',
    hotkey: '3',
    name: 'Torx-Schraubendreher T25',
    shortName: 'Torx T25',
    spec: 'Radhausschale',
  },
  {
    id: 'wrench16',
    hotkey: '4',
    name: 'Ringschlüssel SW 16',
    shortName: 'SW 16',
    spec: 'Spannrolle entspannen',
  },
  {
    id: 'pinT10060A',
    hotkey: '5',
    name: 'Absteckstift T10060A',
    shortName: 'T10060A',
    spec: '4 mm Arretierdorn',
  },
  {
    id: 'ratchet13',
    hotkey: '6',
    name: 'Knarre 13 mm / Vielzahn',
    shortName: 'Knarre 13',
    spec: 'Spanner & Kurbelwelle',
  },
  {
    id: 'torqueWrench',
    hotkey: '7',
    name: 'Drehmomentschlüssel',
    shortName: 'Nm-Schlüssel',
    spec: '40 Nm / 120 Nm',
  },
  {
    id: 'newParts',
    hotkey: '8',
    name: 'Neuteile-Satz (6PK1025)',
    shortName: 'Neuteile',
    spec: 'Conti 6PK1025 + 04L903315',
  },
];

export const CAMERA_PRESETS: CameraPresetDefinition[] = [
  { id: 'overview', hotkey: 'Q', label: 'Werkstatt' },
  { id: 'engineTop', hotkey: 'W', label: 'Motor' },
  { id: 'wheelWell', hotkey: 'E', label: 'Radhaus' },
  { id: 'beltClose', hotkey: 'R', label: 'Riemen' },
  { id: 'tensionerMacro', hotkey: 'T', label: 'Spanner' },
];

export const REPAIR_STEPS: StepDefinition[] = [
  {
    index: 0,
    id: 'prep_lift',
    title: 'Motorhaube öffnen & Hebebühne hochfahren',
    subtitle: 'Schritt 1 von 12 • Fahrzeugvorbereitung',
    description:
      'Öffne zuerst die Motorhaube des Golf 7 und fahre anschließend das Fahrzeug über die grüne Steuerungstaste an der rechten Hebebühnensäule auf Arbeitshöhe.',
    whyTip:
      'Bei geöffneter Motorhaube prüfst du später auch den oberen Motorraum, während die Zweisäulen-Hebebühne freien Zugang zum rechten Radhaus und der Kurbelwellen-Riemenscheibe schafft.',
    requiredTools: ['hand'],
    cameraPreset: 'overview',
    subObjectives: [
      { id: 'open_hood', label: 'Motorhaube entriegeln und öffnen' },
      { id: 'raise_lift', label: 'Hebebühne auf Arbeitshöhe (0,88 m) hochfahren' },
    ],
  },
  {
    index: 1,
    id: 'engine_cover',
    title: 'TDI-Motorabdeckung abnehmen',
    subtitle: 'Schritt 2 von 12 • Zugänglichkeit Motorraum',
    description:
      'Ziehe die obere TDI-Designabdeckung senkrecht aus den vier Gummilagerzapfen ab, um freien Blick auf Lichtmaschine und Zahnriemenabdeckung zu erhalten.',
    whyTip:
      'Die EA288-Motorabdeckung ist nur gesteckt (keine Schrauben). Durch das Abnehmen sieht man von oben exakt, ob der Keilrippenriemen sauber auf der Generator-Freilaufscheibe läuft.',
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
    subtitle: 'Schritt 3 von 12 • Zugang Beifahrerseite',
    description:
      'Löse alle 5 Radschrauben mit dem Schlagschrauber SW 17 und nimm anschließend das rechte Vorderrad mit der Hand ab (wird automatisch auf dem Reifenständer abgelegt).',
    whyTip:
      'Der Keilrippenriemen sitzt beim quer eingebauten EA288 1.6 TDI an der rechten Stirnseite des Motors — der direkte Arbeitszugang erfolgt ausschließlich über das rechte Radhaus.',
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
    subtitle: 'Schritt 4 von 12 • Spritzschutz entfernen',
    description:
      'Schraube alle 6 Torx-T25-Befestigungsschrauben heraus und entnimm den vorderen/unteren Kunststoff-Spritzschutz aus dem Radhaus.',
    whyTip:
      'Erst nach Demontage der Radhausschale liegen Kurbelwellen-Schwingungsdämpfer, Klimakompressor und die automatische Spannrolle 04L 903 315 komplett frei.',
    requiredTools: ['torx25', 'hand'],
    cameraPreset: 'wheelWell',
    subObjectives: [
      { id: 'unscrew_liner_0', label: 'Torx-Schraube T25 #1 herausdrehen' },
      { id: 'unscrew_liner_1', label: 'Torx-Schraube T25 #2 herausdrehen' },
      { id: 'unscrew_liner_2', label: 'Torx-Schraube T25 #3 herausdrehen' },
      { id: 'unscrew_liner_3', label: 'Torx-Schraube T25 #4 herausdrehen' },
      { id: 'unscrew_liner_4', label: 'Torx-Schraube T25 #5 herausdrehen' },
      { id: 'unscrew_liner_5', label: 'Torx-Schraube T25 #6 herausdrehen' },
      { id: 'take_off_liner', label: 'Radhausschale (Spritzschutz) herausnehmen' },
    ],
  },
  {
    index: 4,
    id: 'inspect_belt',
    title: 'Riemenverlauf dokumentieren & Verschleiß prüfen',
    subtitle: 'Schritt 5 von 12 • Diagnose vor Demontage',
    description:
      'Klicke den alten Keilrippenriemen mit der Hand an, um den exakten Riemenverlauf (Kurbelwelle → Klimakompressor → Generator → Spannrolle) als Schema freizuschalten und Risse/Ausfransungen zu prüfen.',
    whyTip:
      'Vor jedem Ausbau ein Foto oder Schema anlegen! Beim 1.6 TDI greifen die 6 Rippen auf Kurbelwelle, Klima und Generator, während die glatte Rückseite über die Spannrolle läuft.',
    requiredTools: ['hand'],
    cameraPreset: 'beltClose',
    subObjectives: [
      { id: 'document_belt', label: 'Alten Keilrippenriemen inspizieren & Schema speichern' },
    ],
  },
  {
    index: 5,
    id: 'lock_tensioner',
    title: 'Spannrolle entspannen & mit T10060A arretieren',
    subtitle: 'Schritt 6 von 12 • Federspannung sichern',
    description:
      'Setze den Ringschlüssel SW 16 am Sechskantansatz der Spannrolle an, drücke ihn im Uhrzeigersinn (~35°) bis die 4-mm-Bohrungen fluchten und stecke dann den Absteckstift T10060A ein.',
    whyTip:
      'Die starke Torsionsfeder der automatischen Spannrolle hält den 6PK1025 unter hoher Vorspannung. Nur mit T10060A im fluchtenden Loch bleibt der Spanner sicher im entspannten Zustand blockiert.',
    requiredTools: ['wrench16', 'pinT10060A'],
    cameraPreset: 'tensionerMacro',
    subObjectives: [
      { id: 'rotate_tensioner', label: 'Spanner mit SW 16 im Uhrzeigersinn bis ins grüne Fenster drehen' },
      { id: 'insert_pin', label: 'Absteckstift T10060A in die fluchtende Bohrung stecken' },
    ],
  },
  {
    index: 6,
    id: 'remove_old_belt',
    title: 'Alten Keilrippenriemen abnehmen & Lager prüfen',
    subtitle: 'Schritt 7 von 12 • Aggregatetrieb-Check',
    description:
      'Nimm den entspannten Alt-Riemen ab und drehe danach die Riemenscheiben von Generator (Freilauf) und Klimakompressor von Hand auf spielfreien, geräuschlosen Lauf.',
    whyTip:
      'Ein schwergängiger Generator-Freilauf (OAP) oder ein raues Lager am Klimakompressor zerstört auch einen brandneuen Riemen innerhalb weniger Wochen durch Riemenflattern.',
    requiredTools: ['hand'],
    cameraPreset: 'beltClose',
    subObjectives: [
      { id: 'take_old_belt', label: 'Alten Keilrippenriemen von den Scheiben abnehmen' },
      { id: 'spin_alternator', label: 'Generator-Freilaufscheibe von Hand prüfen' },
      { id: 'spin_ac', label: 'Klimakompressor-Riemenscheibe von Hand prüfen' },
    ],
  },
  {
    index: 7,
    id: 'replace_tensioner',
    title: 'Spannrolle (04L 903 315) erneuern — 40 Nm',
    subtitle: 'Schritt 8 von 12 • Spannelement tauschen',
    description:
      'Löse die zentrale M10-Befestigungsschraube mit der 13-mm-Knarre, montiere die neue Spannrolle 04L 903 315 aus dem Neuteile-Satz und ziehe die neue Schraube exakt mit 40 Nm an.',
    whyTip:
      'Der Zentrierstift auf der Rückseite muss plan in die Block-Passbohrung greifen. Das korrekte Anzugsmoment im Aluminium-Aggregateträger beträgt 40 Nm (neue Schraube mitverwenden).',
    requiredTools: ['ratchet13', 'newParts', 'torqueWrench'],
    torqueSpec: '40 Nm',
    cameraPreset: 'tensionerMacro',
    subObjectives: [
      { id: 'unbolt_old_tensioner', label: 'M10-Schraube lösen & alte Spannrolle abnehmen' },
      { id: 'mount_new_tensioner', label: 'Neue Spannrolle 04L 903 315 passgenau ansetzen' },
      { id: 'torque_new_tensioner', label: 'Befestigungsschraube exakt mit 40 Nm anziehen' },
    ],
  },
  {
    index: 8,
    id: 'install_new_belt',
    title: 'Neuen Keilrippenriemen (6PK1025) auflegen',
    subtitle: 'Schritt 9 von 12 • Präzise Riemenführung',
    description:
      'Wähle den Neuteile-Satz (6PK1025) und fädle den Riemen exakt in dieser Reihenfolge auf alle Scheiben: 1. Kurbelwelle → 2. Klimakompressor → 3. Lichtmaschine → 4. Spannrolle (glatte Rückseite).',
    whyTip:
      'Immer zuerst die profilierten Rillenscheiben sauber ausrichten — keine der 6 Rippen darf neben der Nut sitzen! Als letztes wird der Riemen über die glatte Spannrolle geschoben.',
    requiredTools: ['newParts'],
    cameraPreset: 'beltClose',
    subObjectives: [
      { id: 'route_crank', label: '1. Riemen auf Kurbelwellen-Riemenscheibe auflegen' },
      { id: 'route_ac', label: '2. Riemen um Klimakompressor führen' },
      { id: 'route_alternator', label: '3. Riemen über Lichtmaschine (Generator) legen' },
      { id: 'route_tensioner', label: '4. Riemenrücken zuletzt auf Spannrolle auflegen' },
    ],
  },
  {
    index: 9,
    id: 'release_tensioner',
    title: 'Arretierstift T10060A ziehen & Riemen spannen',
    subtitle: 'Schritt 10 von 12 • Vorspannung aktivieren',
    description:
      'Entlaste die neue Spannrolle minimal mit dem Ringschlüssel SW 16, ziehe den Sicherungsstift T10060A heraus und lasse die Rolle kontrolliert auf den neuen 6PK1025 zurückgleiten.',
    whyTip:
      'Die Spannrolle darf niemals unkontrolliert zurückschnellen! Durch leichtes Gegenhalten mit dem SW-16-Schlüssel lässt sich der Arretierdorn spannungsfrei entfernen und die Feder gleichmäßig entlasten.',
    requiredTools: ['wrench16', 'pinT10060A'],
    cameraPreset: 'tensionerMacro',
    subObjectives: [
      { id: 'hold_for_pin_pull', label: 'Spannrolle mit SW 16 leicht gegenhalten & Stift entlasten' },
      { id: 'pull_pin', label: 'Absteckstift T10060A herausziehen' },
      { id: 'release_slowly', label: 'Spannarm kontrolliert bis Anschlag auf den Riemen führen' },
    ],
  },
  {
    index: 10,
    id: 'test_run',
    title: 'Handdurchdrehen (720°) & Motor-Probelauf',
    subtitle: 'Schritt 11 von 12 • Funktionskontrolle',
    description:
      'Drehe die Kurbelwelle mit der Knarre von Hand zweimal (720°) im Uhrzeigersinn durch, um den perfekten Rillensitz zu prüfen. Starte danach den 1.6 TDI im Leerlauf und kontrolliere den Riemenlauf.',
    whyTip:
      'Das zweimalige Durchdrehen von Hand zeigt sofort, ob eine Rippe verrutscht ist, bevor der Anlasser Kraft aufbringt. Im Leerlauf muss der 6PK1025 absolut ruhig ohne Seitenschlag laufen.',
    requiredTools: ['ratchet13', 'hand'],
    cameraPreset: 'beltClose',
    subObjectives: [
      { id: 'manual_crank_720', label: 'Kurbelwelle 2× von Hand durchdrehen (720°)' },
      { id: 'engine_idle_check', label: '1.6 TDI starten & ruhigen Riemenlauf prüfen' },
    ],
  },
  {
    index: 11,
    id: 'reassemble',
    title: 'Endmontage & Abschlusskontrolle (Rad 120 Nm)',
    subtitle: 'Schritt 12 von 12 • Übergabefertig machen',
    description:
      'Baue Radhausschale (inkl. 6× Torx T25) und Vorderrad ein, ziehe die 5 Radschrauben mit 120 Nm an, setze Motorabdeckung & Haube auf und fahre die Hebebühne herunter.',
    whyTip:
      'Radschrauben beim Golf 7 immer über Kreuz mit kalibriertem Drehmomentschlüssel auf 120 Nm anziehen — und nach 50 km Fahrt nochmals kontrollieren.',
    requiredTools: ['hand', 'torx25', 'torqueWrench'],
    torqueSpec: '120 Nm',
    cameraPreset: 'wheelWell',
    subObjectives: [
      { id: 'reinstall_liner', label: 'Radhausschale einsetzen & 6× T25 festschrauben' },
      { id: 'reinstall_wheel', label: 'Vorderrad auf Radnabe aufsetzen' },
      { id: 'torque_wheel_bolts', label: '5 Radschrauben mit 120 Nm über Kreuz festziehen' },
      { id: 'reinstall_cover_hood', label: 'TDI-Motorabdeckung & Motorhaube schließen' },
      { id: 'lower_lift', label: 'Hebebühne komplett ablassen (gelber Abwärts-Taster)' },
    ],
  },
];
