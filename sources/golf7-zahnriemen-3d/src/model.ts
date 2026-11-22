import * as THREE from 'three';
import {
  BELT_TEETH,
  CRANK_RADIUS,
  TAU,
  gearMeshPhase,
  lockable,
  loopLength,
  pointOnBelt,
  sections,
  toothPitch,
  wheelRotation,
  wheels,
} from './drive';
import type { PartId, VisualState, Wheel, WheelId } from './drive';

const metal = (color: number, roughness = 0.36, metalness = 0.78) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

const steel = metal(0x8e9da0, 0.34, 0.8);
const darkSteel = metal(0x3a474b, 0.46, 0.72);
const bright = metal(0xcfd9da, 0.24, 0.88);
const bearing = metal(0x252e33, 0.5, 0.62);
const rubber = metal(0x212729, 0.86, 0.05);
const toothRubber = metal(0x2f383a, 0.74, 0.06);
const beltCord = metal(0x374143, 0.62, 0.12);
const indexPaint = new THREE.MeshStandardMaterial({
  color: 0xffa43b,
  roughness: 0.35,
  metalness: 0.15,
  emissive: 0x552400,
  emissiveIntensity: 0.45,
});
const indexAligned = new THREE.MeshStandardMaterial({
  color: 0xc0ff52,
  roughness: 0.3,
  metalness: 0.1,
  emissive: 0x4b7a10,
  emissiveIntensity: 0.7,
});
const lime = new THREE.MeshBasicMaterial({ color: 0xc0ff52, toneMapped: false });
const mint = new THREE.MeshBasicMaterial({ color: 0xc7fff2, toneMapped: false });
const guideMat = new THREE.MeshBasicMaterial({
  color: 0xbeee64,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  toneMapped: false,
});

const SEGMENTS = 640;
const BELT_BACK_Z = -0.145;
const BELT_FRONT_Z = 0.156;
const BELT_THICK = 0.043;

function disc(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  radius: number,
  depth: number,
  material: THREE.Material,
  sides = 48,
) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, depth, sides), material);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function ring(
  parent: THREE.Object3D,
  radius: number,
  thickness: number,
  z: number,
  mat: THREE.Material,
) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(radius, thickness, 10, 72), mat);
  m.position.z = z;
  parent.add(m);
  return m;
}
function box(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// Gear tooth profile with VALLEY centered cleanly at angle = 0 so gearMeshPhase() aligns belt teeth directly into valleys!
function gearShape(w: Wheel) {
  const shape = new THREE.Shape();
  for (let i = 0; i < w.teeth; i++) {
    // j in [0..1): valley around 0.0 ([-0.18..+0.18]), raised tooth plateau centered at 0.5 ([0.30..0.70])
    for (const [j, raised] of [
      [0.0, 0],
      [0.18, 0],
      [0.3, 1],
      [0.7, 1],
      [0.82, 0],
    ] as const) {
      const a = (TAU * (i + j)) / w.teeth;
      const r = w.r - (raised ? 0.005 : 0.03);
      const x = Math.cos(a) * r,
        y = Math.sin(a) * r;
      if (!i && !j) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
  }
  shape.closePath();
  const holes = w.id === 'cam' ? 8 : 5;
  for (let i = 0; i < holes; i++) {
    const a = (TAU * i) / holes + 0.14;
    const hole = new THREE.Path();
    hole.absarc(w.r * 0.6 * Math.cos(a), w.r * 0.6 * Math.sin(a), w.r * 0.145, 0, TAU, true);
    shape.holes.push(hole);
  }
  return shape;
}

function pointerGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.052, 0.092);
  s.lineTo(0, 0);
  s.lineTo(0.052, 0.092);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, {
    depth: 0.026,
    bevelEnabled: true,
    bevelSize: 0.004,
    bevelThickness: 0.004,
    bevelSegments: 1,
  });
}

const sharedPointerGeo = pointerGeometry();

// Lock pin target position relative to each lockable wheel center (cleanly between lightening holes!)
const LOCK_ANGLES: Record<string, number> = {
  crank: 0.56,
  cam: 0.5,
  pump: 0.56,
};

function buildWheel(w: Wheel) {
  const pivot = new THREE.Group();
  pivot.position.set(w.x, w.y, 0);
  pivot.userData.part = w.id;
  const spinner = new THREE.Group();
  pivot.add(spinner);

  // Rear mounting hub / housing boss
  disc(pivot, 0, 0, -0.19, w.r * 0.78, 0.2, darkSteel);

  if (w.teeth) {
    const toothGroup = new THREE.Group();
    toothGroup.rotation.z = gearMeshPhase(w.id);
    const face = new THREE.Mesh(
      new THREE.ExtrudeGeometry(gearShape(w), {
        depth: 0.246,
        bevelEnabled: true,
        bevelSize: 0.003,
        bevelThickness: 0.003,
        bevelSegments: 1,
        curveSegments: 6,
      }),
      [steel, darkSteel],
    );
    face.position.z = -0.123;
    toothGroup.add(face);
    spinner.add(toothGroup);

    ring(spinner, w.r * 0.86, 0.009, 0.128, bright);
    ring(spinner, w.r * 0.37, 0.013, 0.139, darkSteel);
    disc(spinner, 0, 0, 0.135, w.r * 0.34, 0.06, darkSteel);

    if (w.id === 'cam') {
      // Three slotted adjustment bolts characteristic of the EA288 camshaft hub
      for (let j = 0; j < 3; j++) {
        const a = (j * TAU) / 3 + 0.18;
        disc(
          spinner,
          Math.cos(a) * w.r * 0.35,
          Math.sin(a) * w.r * 0.35,
          0.158,
          0.032,
          0.05,
          bright,
          6,
        );
      }
    }
  } else {
    // Smooth idler / tensioner / water pump roller contacting the smooth belt back
    const r = w.r - BELT_THICK;
    disc(spinner, 0, 0, 0, r, 0.262, w.id === 'water' ? bearing : steel);
    disc(spinner, 0, 0, 0.137, r * 0.86, 0.025, darkSteel);
    ring(spinner, r * 0.76, 0.009, 0.154, bright);
    ring(spinner, r * 0.46, 0.014, 0.155, bearing);
  }

  // Center shaft bolt
  disc(spinner, 0, 0, 0.164, w.r * 0.23, 0.04, bright, 6);
  disc(spinner, 0, 0, 0.19, w.r * 0.1, 0.016, darkSteel, 6);

  // Reference marks (Bezugsmarken) + 3D fixed housing OT pointers + locking bore bushings on ALL 3 timed shafts!
  let fixedPointer: THREE.Mesh | undefined;
  if (lockable.includes(w.id)) {
    // Crisp high-visibility rotating timing bar at 12 o'clock on the sprocket front face
    box(spinner, 0, w.r * 0.82, 0.156, 0.028, w.r * 0.24, 0.02, indexPaint);
    // Small notch mark at exact outer rim
    box(spinner, 0, w.r * 0.94, 0.164, 0.022, 0.045, 0.018, indexPaint);

    // Fixed housing bracket + sculpted 3D OT reference pointer directly above 12 o'clock
    box(pivot, 0, w.r + 0.148, 0.145, 0.125, 0.055, 0.046, darkSteel);
    fixedPointer = new THREE.Mesh(sharedPointerGeo, indexPaint);
    fixedPointer.position.set(0, w.r + 0.072, 0.155);
    pivot.add(fixedPointer);

    // Machined locking bore collar (Absteckbohrung) on sprocket face matching exact locking pin location!
    const la = LOCK_ANGLES[w.id];
    const lr = w.r * 0.52;
    const lx = Math.cos(la) * lr,
      ly = Math.sin(la) * lr;
    disc(spinner, lx, ly, 0.146, 0.048, 0.03, bright, 20);
    disc(spinner, lx, ly, 0.156, 0.032, 0.024, bearing, 18);
  }

  return { pivot, spinner, fixedPointer };
}

/**
 * Builds a closed-section swept belt strip along pointOnBelt() with SPLIT per-face vertices
 * and MATHEMATICALLY VERIFIED OUTWARD CCW NORMALS (no DoubleSide hack, crisp edge shading!).
 * Each longitudinal segment uses 4 independent quads = 8 triangles = 24 indices.
 */
function strip(inner: number, outer: number, back: number, front: number) {
  const pos: number[] = [];
  const norm: number[] = [];
  const indices: number[] = [];

  // 4 separate faces with exact [nA, zA, nB, zB] so (pB - pA) x T points strictly OUTWARD:
  // 0: Back  (-Z): [inner, back]  -> [outer, back]  (+N x T = -Z)
  // 1: Outer (+N): [outer, back]  -> [outer, front] (+Z x T = +N)
  // 2: Front (+Z): [outer, front] -> [inner, front] (-N x T = +Z)
  // 3: Inner (-N): [inner, front] -> [inner, back]  (-Z x T = -N)
  const faces: ReadonlyArray<readonly [number, number, number, number]> = [
    [inner, back, outer, back],
    [outer, back, outer, front],
    [outer, front, inner, front],
    [inner, front, inner, back],
  ];

  for (let i = 0; i <= SEGMENTS; i++) {
    const p = pointOnBelt((loopLength * i) / SEGMENTS);
    const faceNormals: ReadonlyArray<readonly [number, number, number]> = [
      [0, 0, -1],
      [p.nx, p.ny, 0],
      [0, 0, 1],
      [-p.nx, -p.ny, 0],
    ];
    for (let f = 0; f < 4; f++) {
      const [nA, zA, nB, zB] = faces[f];
      const [fnx, fny, fnz] = faceNormals[f];
      pos.push(p.x + nA * p.nx, p.y + nA * p.ny, zA);
      norm.push(fnx, fny, fnz);
      pos.push(p.x + nB * p.nx, p.y + nB * p.ny, zB);
      norm.push(fnx, fny, fnz);
    }
    if (i === SEGMENTS) continue;
    const base = i * 8;
    const next = (i + 1) * 8;
    for (let f = 0; f < 4; f++) {
      const a0 = base + f * 2;
      const b0 = a0 + 1;
      const a1 = next + f * 2;
      const b1 = a1 + 1;
      // CCW outward winding: (a0, b0, a1), (b0, b1, a1)
      indices.push(a0, b0, a1, b0, b1, a1);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setIndex(indices);
  return g;
}

function toothGeometry() {
  const t = new THREE.Shape();
  t.moveTo(-toothPitch * 0.32, 0.006);
  t.lineTo(toothPitch * 0.32, 0.006);
  t.lineTo(toothPitch * 0.19, -0.025);
  t.lineTo(-toothPitch * 0.19, -0.025);
  t.closePath();
  const g = new THREE.ExtrudeGeometry(t, { depth: 0.288, bevelEnabled: false });
  return g.translate(0, 0, -0.141);
}

function coverGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.38, -1.5);
  s.quadraticCurveTo(0, -1.76, 0.39, -1.45);
  s.lineTo(0.88, -0.15);
  s.lineTo(1.48, 1.04);
  s.quadraticCurveTo(1.7, 1.72, 1.0, 1.78);
  s.lineTo(-0.54, 2.0);
  s.quadraticCurveTo(-1.55, 2.03, -1.43, 1.05);
  s.lineTo(-0.7, -0.4);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, {
    depth: 0.16,
    bevelEnabled: true,
    bevelSize: 0.035,
    bevelThickness: 0.032,
    bevelSegments: 2,
  });
}

export class DriveModel {
  readonly root = new THREE.Group();
  readonly wheelMeshes = new Map<WheelId, ReturnType<typeof buildWheel>>();
  private readonly belt = new THREE.Group();
  private readonly neon = new THREE.Group();
  private readonly cover = new THREE.Group();
  private readonly layers: THREE.BufferGeometry[] = [];
  private readonly teeth = new THREE.InstancedMesh(toothGeometry(), toothRubber, BELT_TEETH);
  private readonly dashes = new THREE.InstancedMesh(
    new THREE.BoxGeometry(toothPitch * 0.85, 0.015, 0.012),
    mint,
    15,
  );
  private readonly guideDashes = new THREE.InstancedMesh(
    new THREE.BoxGeometry(toothPitch * 1.15, 0.022, 0.014),
    guideMat,
    48,
  );
  private readonly capStart: THREE.Mesh;
  private readonly capEnd: THREE.Mesh;
  private readonly locks = new Map<WheelId, THREE.Group>();
  private readonly selection = new THREE.Mesh(new THREE.TorusGeometry(1, 0.013, 10, 96), mint);
  private readonly targetRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.018, 10, 96), lime);
  private readonly gauge = new THREE.Group();
  private readonly gaugeNeedle: THREE.Mesh;
  private readonly pose = new THREE.Object3D();

  constructor() {
    for (const w of wheels) {
      const wheel = buildWheel(w);
      this.wheelMeshes.set(w.id, wheel);
      this.root.add(wheel.pivot);

      if (lockable.includes(w.id)) {
        const la = LOCK_ANGLES[w.id];
        const lr = w.r * 0.52;
        const pin = new THREE.Group();
        pin.position.set(w.x + Math.cos(la) * lr, w.y + Math.sin(la) * lr, 0.14);
        // Steel locking pin shank seating directly into the machined locking bore
        disc(pin, 0, 0, 0.16, 0.029, 0.34, bright, 18);
        // Collar flange resting against the bore bushing
        disc(pin, 0, 0, 0.04, 0.046, 0.03, darkSteel, 18);
        // High-visibility orange T-handle grip on the locking tool
        box(pin, 0.045, 0, 0.34, 0.16, 0.056, 0.058, indexPaint);
        this.locks.set(w.id, pin);
        this.root.add(pin);
      }
    }

    // Crisp EA288 Tensioner Eccentric Reference Window (Referenzfenster) & Indicator Needle
    const tw = wheels.find((w) => w.id === 'tensioner')!;
    const refBase = new THREE.Group();
    refBase.position.set(tw.x, tw.y, 0.185);
    // U-shaped slotted reference bracket mounted above tensioner hub
    box(refBase, -0.056, 0.255, 0.012, 0.054, 0.052, 0.022, bright);
    box(refBase, +0.056, 0.255, 0.012, 0.054, 0.052, 0.022, bright);
    box(refBase, 0, 0.292, 0.012, 0.166, 0.026, 0.022, bright);
    // Dark recessed center slot with crisp lime target notch
    box(refBase, 0, 0.255, 0.004, 0.058, 0.048, 0.01, bearing);
    box(refBase, 0, 0.28, 0.022, 0.014, 0.022, 0.01, lime);
    this.root.add(refBase);

    // Rotating tensioner eccentric needle (swings into the center of the U-slot at tension = 0.50!)
    this.gauge.position.set(tw.x, tw.y, 0.205);
    disc(this.gauge, 0, 0, 0, 0.048, 0.024, darkSteel, 20);
    this.gaugeNeedle = box(this.gauge, 0, 0.142, 0.01, 0.022, 0.235, 0.018, indexPaint);
    this.root.add(this.gauge, this.belt, this.guideDashes, this.selection, this.targetRing);

    this.belt.userData.part = 'belt';
    this.belt.add(this.teeth, this.neon);
    this.teeth.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.teeth.frustumCulled = this.dashes.frustumCulled = this.guideDashes.frustumCulled = false;
    this.neon.add(this.dashes);

    // Solid end-caps sealing open ends during partial belt laying (Step 5)
    const capGeo = new THREE.BoxGeometry(0.014, BELT_THICK, BELT_FRONT_Z - BELT_BACK_Z);
    this.capStart = new THREE.Mesh(capGeo, beltCord);
    this.capEnd = new THREE.Mesh(capGeo, beltCord);
    this.belt.add(this.capStart, this.capEnd);

    const addStrip = (
      group: THREE.Group,
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
    ) => {
      this.layers.push(geometry);
      group.add(new THREE.Mesh(geometry, material));
    };

    // Main toothed belt carcass (proper outward normals — NO DoubleSide hack needed!)
    addStrip(this.belt, strip(0, BELT_THICK, BELT_BACK_Z, BELT_FRONT_Z), rubber);
    // Subtle fiber-cord edge trim on the front face of the belt
    addStrip(this.belt, strip(0.014, 0.03, BELT_FRONT_Z - 0.002, BELT_FRONT_Z + 0.001), beltCord);
    // Optional Neon trace & soft additive glow along belt outer face
    addStrip(this.neon, strip(0.012, 0.034, BELT_FRONT_Z + 0.002, BELT_FRONT_Z + 0.009), lime);
    for (const [width, opacity] of [
      [0.046, 0.2],
      [0.078, 0.07],
    ]) {
      const glow = new THREE.MeshBasicMaterial({
        color: 0xa1ff18,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      addStrip(
        this.neon,
        strip(0.022 - width, 0.022 + width, BELT_FRONT_Z + 0.01, BELT_FRONT_Z + 0.012),
        glow,
      );
    }

    // Timing belt cover (removed in Step 1)
    const coverMesh = new THREE.Mesh(coverGeometry(), metal(0x283034, 0.78, 0.14));
    this.cover.add(coverMesh);
    for (const [x, y] of [
      [-1.2, 1.37],
      [1.14, 1.48],
      [-0.58, 0.15],
      [0.08, -1.34],
    ]) {
      disc(this.cover, x, y, 0.18, 0.065, 0.035, darkSteel, 6);
    }
    this.cover.position.z = 0.27;
    this.cover.userData.part = 'cover';
    this.root.add(this.cover);
  }

  anchor(part: PartId) {
    if (part === 'belt') {
      const p = pointOnBelt(sections[5].end - 0.34);
      return new THREE.Vector3(p.x, p.y, BELT_FRONT_Z + 0.04);
    }
    const w = this.wheelMeshes.get(part)!.pivot.position;
    return new THREE.Vector3(w.x, w.y, 0.22);
  }

  update(s: VisualState) {
    const distance = ((s.angle * Math.PI) / 180) * CRANK_RADIUS;

    for (const w of wheels) {
      const entry = this.wheelMeshes.get(w.id)!;
      entry.spinner.rotation.z = wheelRotation(w, s.angle);
      if (entry.fixedPointer) {
        entry.fixedPointer.material = s.otAligned ? indexAligned : indexPaint;
      }
    }
    for (const [id, pin] of this.locks) pin.visible = s.locks.includes(id);

    this.cover.visible = s.cover;
    this.gauge.rotation.z = (0.5 - s.tension) * 1.9;
    this.gaugeNeedle.material = Math.abs(s.tension - 0.5) <= 0.04 ? indexAligned : indexPaint;

    const coveredLength = s.belt ? loopLength : s.routing ? sections[s.routing - 1].end : 0;
    const fraction = coveredLength / loopLength;
    const isPartial = fraction > 0 && fraction < 0.999;

    this.belt.visible = fraction > 0;
    this.neon.visible = s.neon;

    // Selection ring around active inspected/chosen part
    this.selection.visible = !s.cover && s.selected !== 'belt' && !s.routingActive;
    if (this.selection.visible && s.selected !== 'belt') {
      const w = wheels.find((w) => w.id === s.selected)!;
      this.selection.position.set(w.x, w.y, 0.215);
      this.selection.scale.setScalar(w.r + 0.052);
    }

    // During Step 5 (laying the new belt), show dashed guide path along remaining route + highlight ring on next wheel!
    this.guideDashes.visible = s.routingActive && s.routing < wheels.length;
    this.targetRing.visible = s.routingActive && s.routing < wheels.length;
    if (this.guideDashes.visible) {
      const remainingStart = coveredLength;
      const remainingLen = Math.max(0.01, loopLength - remainingStart);
      const count = Math.min(48, Math.max(6, Math.round(remainingLen / 0.22)));
      this.guideDashes.count = count;
      for (let i = 0; i < count; i++) {
        const sd = remainingStart + ((i + 0.5) / count) * remainingLen;
        this.placeInstance(this.guideDashes, i, sd, BELT_THICK * 0.5, BELT_FRONT_Z + 0.016);
      }
      this.guideDashes.instanceMatrix.needsUpdate = true;

      const nextWheel = wheels[s.routing];
      this.targetRing.position.set(nextWheel.x, nextWheel.y, 0.22);
      this.targetRing.scale.setScalar(nextWheel.r + 0.068);
    }

    if (!fraction) return;

    // Update strip draw range to exact laid segment length
    const segCount = fraction >= 0.999 ? SEGMENTS : Math.max(1, Math.round(SEGMENTS * fraction));
    for (const g of this.layers) g.setDrawRange(0, segCount * 24);

    // Solid end-caps at open ends of partially laid belt
    this.capStart.visible = isPartial;
    this.capEnd.visible = isPartial;
    if (isPartial) {
      this.placeCap(this.capStart, 0);
      this.placeCap(this.capEnd, (segCount / SEGMENTS) * loopLength);
    }

    // Place belt teeth strictly inside the laid span [0, actualEnd] while keeping exact tooth phase!
    if (!isPartial) {
      this.teeth.count = BELT_TEETH;
      for (let i = 0; i < BELT_TEETH; i++) {
        this.placeInstance(this.teeth, i, i * toothPitch + distance, 0, 0);
      }
    } else {
      const actualEnd = (segCount / SEGMENTS) * loopLength;
      // Wrap tooth phase modulo toothPitch so stationary teeth stay meshed inside gear valleys AND strictly within [0, actualEnd]!
      const phase = ((distance % toothPitch) + toothPitch) % toothPitch;
      let count = 0;
      for (
        let sPos = phase;
        sPos <= actualEnd - toothPitch * 0.2 && count < BELT_TEETH;
        sPos += toothPitch
      ) {
        if (sPos >= toothPitch * 0.15) {
          this.placeInstance(this.teeth, count++, sPos, 0, 0);
        }
      }
      this.teeth.count = count;
    }
    this.teeth.instanceMatrix.needsUpdate = true;

    this.dashes.visible = s.neon && !isPartial;
    if (this.dashes.visible) {
      for (let i = 0; i < this.dashes.count; i++) {
        this.placeInstance(
          this.dashes,
          i,
          (i * loopLength) / this.dashes.count + distance,
          0.022,
          BELT_FRONT_Z + 0.023,
        );
      }
      this.dashes.instanceMatrix.needsUpdate = true;
    }
  }

  private placeCap(mesh: THREE.Mesh, dist: number) {
    const p = pointOnBelt(dist);
    mesh.position.set(
      p.x + p.nx * (BELT_THICK * 0.5),
      p.y + p.ny * (BELT_THICK * 0.5),
      (BELT_BACK_Z + BELT_FRONT_Z) * 0.5,
    );
    mesh.rotation.set(0, 0, Math.atan2(p.ty, p.tx));
  }

  private placeInstance(
    mesh: THREE.InstancedMesh,
    i: number,
    distance: number,
    normal: number,
    z: number,
  ) {
    const p = pointOnBelt(distance);
    this.pose.position.set(p.x + p.nx * normal, p.y + p.ny * normal, z);
    this.pose.rotation.z = Math.atan2(p.ty, p.tx);
    this.pose.updateMatrix();
    mesh.setMatrixAt(i, this.pose.matrix);
  }
}
