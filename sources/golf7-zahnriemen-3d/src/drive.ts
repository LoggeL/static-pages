// The pitch line is shared by the 3D belt, the schematic, the wheels and the exercise.
export const TAU = Math.PI * 2;
export const CRANK_RADIUS = 0.292;
export const CRANK_TEETH = 26;

export const wheels = [
  {
    id: 'crank',
    name: 'Kurbelwelle',
    x: 0,
    y: -1.258,
    r: CRANK_RADIUS,
    wrap: -1,
    teeth: CRANK_TEETH,
    detail:
      'Das kleine Zahnrad unten treibt den Zahnriemen an. Zwei Umdrehungen der Kurbelwelle (720°) ergeben eine Umdrehung der Nockenwelle (360°).',
  },
  {
    id: 'lower',
    name: 'Untere Umlenkrolle',
    x: -0.34,
    y: -0.55,
    r: 0.143,
    wrap: 1,
    teeth: 0,
    detail:
      'Die untere Rolle führt den glatten Riemenrücken auf dem Weg vom Kurbelwellenrad zur Spannrolle und beruhigt das Zugtrum.',
  },
  {
    id: 'tensioner',
    name: 'Spannrolle',
    x: -0.48,
    y: 0.34,
    r: 0.25,
    wrap: 1,
    teeth: 0,
    detail:
      'Über den Exzenter wird die Riemenspannung eingestellt. Der orange Zeiger muss mittig im Referenzfenster der Grundplatte stehen.',
  },
  {
    id: 'cam',
    name: 'Nockenwelle',
    x: -0.67,
    y: 1.19,
    r: CRANK_RADIUS * 2,
    wrap: -1,
    teeth: CRANK_TEETH * 2,
    detail:
      'Das Nockenwellenrad dreht mit halber Kurbelwellendrehzahl (2:1). So öffnen und schließen Ein- und Auslassventile phasengenau.',
  },
  {
    id: 'upper',
    name: 'Obere Umlenkrolle',
    x: 0.37,
    y: 1.71,
    r: 0.145,
    wrap: 1,
    teeth: 0,
    detail:
      'Zwischen Nockenwelle und Hochdruckpumpe lenkt die obere Rolle den Riemen um und vergrößert den Umschlingungswinkel beider Zahnräder.',
  },
  {
    id: 'pump',
    name: 'Hochdruckpumpe',
    x: 1.08,
    y: 1.22,
    r: CRANK_RADIUS,
    wrap: -1,
    teeth: CRANK_TEETH,
    detail:
      'Der Zahnriemen treibt die Hochdruckpumpe für das Common-Rail-System an. In der Übung steckst du auch dieses Rad an seiner Bezugsmarke ab.',
  },
  {
    id: 'water',
    name: 'Kühlmittelpumpe',
    x: 0.55,
    y: -0.02,
    r: 0.245,
    wrap: 1,
    teeth: 0,
    detail:
      'Auf der Rücklaufseite treibt der glatte Riemenrücken die Kühlmittelpumpe an. Sie fördert das Kühlmittel durch Block und Kühler.',
  },
] as const;

export type Wheel = (typeof wheels)[number];
export type WheelId = Wheel['id'];
export type PartId = WheelId | 'belt';
export type View = 'perspective' | 'front' | 'car';

export const parts = [
  {
    id: 'belt',
    name: 'Zahnriemen',
    detail:
      'Die Zähne greifen in die Räder von Kurbelwelle, Nockenwelle und Hochdruckpumpe. Der glatte Riemenrücken läuft über die Kühlmittelpumpe und die Rollen.',
  },
  ...(['cam', 'crank', 'pump', 'water', 'tensioner', 'upper', 'lower'] as const).map((id) =>
    wheels.find((w) => w.id === id)!,
  ),
] as const;

export const wrapDistance = (n: number, length: number) => ((n % length) + length) % length;

function tangent(a: Wheel, b: Wheel) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const k = (a.wrap * a.r - b.wrap * b.r) / d;
  const h = Math.sqrt(1 - k * k);
  const nx = (k * dx + h * dy) / d,
    ny = (k * dy - h * dx) / d;
  return {
    a: Math.atan2(a.wrap * ny, a.wrap * nx),
    b: Math.atan2(b.wrap * ny, b.wrap * nx),
    length: d * h,
  };
}

const tangents = wheels.map((w, i) => tangent(w, wheels[(i + 1) % wheels.length]));
let length = 0;
export const sections = wheels.map((w, i) => {
  const incoming = tangents[(i + wheels.length - 1) % wheels.length].b;
  const outgoing = tangents[i].a;
  const start = length;
  const arc = wrapDistance((outgoing - incoming) * w.wrap, TAU) * w.r;
  length += arc + tangents[i].length;
  return { wheel: w, start, arc, end: length, incoming, outgoing };
});

export const loopLength = length;
export const BELT_TEETH = Math.round(loopLength / ((TAU * CRANK_RADIUS) / CRANK_TEETH));
export const toothPitch = loopLength / BELT_TEETH;

// Coordinates, unit tangent and outward normal at an exact distance around the loop.
export function pointOnBelt(distance: number) {
  const s = wrapDistance(distance, loopLength);
  const section = sections.find((p) => s < p.end) ?? sections[0];
  const { wheel: w, start, arc, incoming, outgoing } = section;
  const delta = s - start;
  const angle = delta <= arc ? incoming + (w.wrap * delta) / w.r : outgoing;
  const tx = -w.wrap * Math.sin(angle),
    ty = w.wrap * Math.cos(angle);
  const straight = Math.max(0, delta - arc);
  return {
    x: w.x + w.r * Math.cos(angle) + tx * straight,
    y: w.y + w.r * Math.sin(angle) + ty * straight,
    tx,
    ty,
    nx: -ty,
    ny: tx,
  };
}

// Compute exact initial tooth-mesh phase for a toothed sprocket so gear valleys align with belt teeth at OT (0° / 720°).
export function gearMeshPhase(wheelId: WheelId): number {
  const sec = sections.find((s) => s.wheel.id === wheelId);
  if (!sec || !sec.wheel.teeth) return 0;
  const nearestToothDist = Math.round(sec.start / toothPitch) * toothPitch;
  return sec.incoming + (sec.wheel.wrap * (nearestToothDist - sec.start)) / sec.wheel.r;
}

export const lockable: readonly WheelId[] = ['crank', 'cam', 'pump'];

export interface VisualState {
  angle: number; // crankshaft degrees, clockwise viewed from the timing side
  selected: PartId;
  neon: boolean;
  cover: boolean;
  belt: boolean;
  routing: number; // completed wheel contacts while laying the replacement (0..wheels.length)
  routingActive: boolean; // true during Step 5 (belt laying), shows guide track & next target
  locks: readonly WheelId[];
  tension: number;
  otAligned: boolean;
}

export const wheelRotation = (wheel: Wheel, degrees: number) =>
  (((wheel.wrap * degrees * Math.PI) / 180) * CRANK_RADIUS) / wheel.r;

export const isAtOT = (degrees: number, tolerance = 4) => {
  const d = wrapDistance(degrees, 720);
  return d <= tolerance || d >= 720 - tolerance;
};
