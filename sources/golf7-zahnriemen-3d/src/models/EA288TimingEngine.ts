import * as THREE from 'three';
import {
  BELT_TEETH,
  CRANK_RADIUS,
  TAU,
  gearMeshPhase,
  isAtOT,
  lockable,
  loopLength,
  pointOnBelt,
  sections,
  toothPitch,
  wheelRotation,
  wheels,
} from '../drive';
import type { Wheel } from '../drive';
import { extractNode, getSharedModelUrl, loadGLB } from '../engine/AssetLoader';
import type { InteractableId, LockableWheelId, TimingWheelId } from '../types';

export type TimingBeltVisualState = 'old' | 'none' | 'routing' | 'new_slack' | 'new_tensioned';

interface WheelAssembly {
  spec: Wheel;
  pivot: THREE.Group;
  spinner: THREE.Group;
  fixedPointer?: THREE.Mesh;
  rotatingMarkMeshes: THREE.Mesh[];
  hitRoot: THREE.Object3D;
}

interface CoverBoltRecord {
  id: 'timingCoverBolt_0' | 'timingCoverBolt_1';
  root: THREE.Group;
  spinGroup: THREE.Group;
  restLocalPos: THREE.Vector3;
  progress: number;
  target: number;
  materials: THREE.MeshStandardMaterial[];
}

// Exact mounting transform on the right timing face of EA288_CoreBlock inside the Golf VII
// +z_local -> +X (outward toward right wheel well), +y_local -> +Y (up), +x_local -> -Z (toward front bumper)
const TIMING_ORIGIN = new THREE.Vector3(0.440, 0.505, -1.350);
const TIMING_SCALE = 0.122;

const SEGMENTS = 520;
const BELT_BACK_Z = -0.135;
const BELT_FRONT_Z = 0.145;
const BELT_THICK = 0.043;

// Locking bore angles on crank, cam, pump (cleanly between lightening holes)
const LOCK_ANGLES: Record<LockableWheelId, number> = {
  crank: 0.56,
  cam: 0.50,
  pump: 0.56,
};

const WHEEL_TO_INTERACTABLE: Record<TimingWheelId, InteractableId> = {
  crank: 'wheel_crank',
  lower: 'wheel_lower',
  tensioner: 'wheel_tensioner',
  cam: 'wheel_cam',
  upper: 'wheel_upper',
  pump: 'wheel_pump',
  water: 'wheel_water',
};

const LOCK_TO_INTERACTABLE: Record<LockableWheelId, InteractableId> = {
  crank: 'lockPin_crank',
  cam: 'lockPin_cam',
  pump: 'lockPin_pump',
};

function tagInteractable(root: THREE.Object3D, id: InteractableId): void {
  root.userData.interactableId = id;
  root.traverse((child) => {
    child.userData.interactableId = id;
  });
}

function gearShape(w: Wheel): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i < w.teeth; i++) {
    for (const [j, raised] of [
      [0.0, 0],
      [0.18, 0],
      [0.3, 1],
      [0.7, 1],
      [0.82, 0],
    ] as const) {
      const a = (TAU * (i + j)) / w.teeth;
      const r = w.r - (raised ? 0.005 : 0.03);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
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

function buildPointerGeometry(): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.056, 0.098);
  s.lineTo(0, 0);
  s.lineTo(0.056, 0.098);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, {
    depth: 0.028,
    bevelEnabled: true,
    bevelSize: 0.004,
    bevelThickness: 0.004,
    bevelSegments: 1,
  });
}

function buildBeltStripGeometry(
  inner: number,
  outer: number,
  back: number,
  front: number
): THREE.BufferGeometry {
  const pos: number[] = [];
  const norm: number[] = [];
  const indices: number[] = [];

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
      indices.push(a0, b0, a1, b0, b1, a1);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setIndex(indices);
  return g;
}

function buildToothGeometry(): THREE.BufferGeometry {
  const t = new THREE.Shape();
  t.moveTo(-toothPitch * 0.32, 0.006);
  t.lineTo(toothPitch * 0.32, 0.006);
  t.lineTo(toothPitch * 0.19, -0.025);
  t.lineTo(-toothPitch * 0.19, -0.025);
  t.closePath();
  const g = new THREE.ExtrudeGeometry(t, { depth: 0.272, bevelEnabled: false });
  return g.translate(0, 0, -0.136);
}

function buildCoverShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.42, -1.56);
  s.quadraticCurveTo(0, -1.78, 0.42, -1.48);
  s.lineTo(0.92, -0.14);
  s.lineTo(1.50, 1.06);
  s.quadraticCurveTo(1.66, 1.72, 0.98, 1.82);
  s.lineTo(-0.56, 2.00);
  s.quadraticCurveTo(-1.52, 2.02, -1.42, 1.06);
  s.lineTo(-0.74, -0.44);
  s.closePath();
  return s;
}

/**
 * Complete installed VW Golf 7 1.6 TDI (EA288) engine block (`ea288_engine.glb`)
 * paired with the analytical 7-wheel toothed timing-belt drive (Steuertrieb)
 * mounted accurately inside the Golf 7 engine bay & right wheel arch.
 */
export class EA288TimingEngine {
  public readonly group = new THREE.Group();

  private readonly engineCoreGroup = new THREE.Group();
  private readonly engineBayGroup = new THREE.Group();
  private readonly timingDriveRoot = new THREE.Group();

  // 7 timing-drive wheel assemblies
  private readonly wheelAssemblies = new Map<TimingWheelId, WheelAssembly>();
  private readonly tensionerNutGroup = new THREE.Group();

  // Locking pins (crank, cam, pump)
  private readonly lockPinGroups = new Map<LockableWheelId, THREE.Group>();

  // Eccentric tensioner reference window & pivoting indicator needle
  private readonly gaugePivot = new THREE.Group();
  private readonly gaugeNeedleMesh: THREE.Mesh;

  // Belt visual meshes (old vs new, progressive routing + teeth + cyan guide)
  private readonly beltGroup = new THREE.Group();
  private readonly beltCarcassMesh: THREE.Mesh;
  private readonly beltCordTrimMesh: THREE.Mesh;
  private readonly beltCarcassGeo: THREE.BufferGeometry;
  private readonly beltCordTrimGeo: THREE.BufferGeometry;
  private readonly teethInstanced: THREE.InstancedMesh;
  private readonly capStart: THREE.Mesh;
  private readonly capEnd: THREE.Mesh;
  private readonly guideDashes: THREE.InstancedMesh;
  private readonly targetRing: THREE.Mesh;
  private readonly newBeltSlotHitMesh: THREE.Mesh;

  // Removable timing belt cover + 2 Torx bolts + cyan reassembly ghost slot
  private readonly timingCoverGroup = new THREE.Group();
  private readonly timingCoverMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly timingCoverSlotGroup = new THREE.Group();
  private readonly coverBolts: CoverBoltRecord[] = [];
  private coverProgress = 0;
  private coverTarget = 0;

  // Materials
  private readonly oldBeltCarcassMat: THREE.MeshStandardMaterial;
  private readonly oldBeltToothMat: THREE.MeshStandardMaterial;
  private readonly newBeltCarcassMat: THREE.MeshStandardMaterial;
  private readonly newBeltToothMat: THREE.MeshStandardMaterial;
  private readonly cordTrimOldMat: THREE.MeshStandardMaterial;
  private readonly cordTrimNewMat: THREE.MeshStandardMaterial;
  private readonly otAmberMat: THREE.MeshStandardMaterial;
  private readonly otEmeraldMat: THREE.MeshStandardMaterial;
  private readonly guideCyanMat: THREE.MeshStandardMaterial;
  private readonly ghostCoverMat: THREE.MeshStandardMaterial;

  // Dynamic mechanical state
  private crankAngleDeg = 635;
  private tensionNormalized = 0.50;
  private beltState: TimingBeltVisualState = 'old';
  private routingNodes: TimingWheelId[] = [];
  private lockedShafts = new Set<LockableWheelId>();

  private engineRunning = false;
  private engineRpm = 820;
  private animClock = 0;

  // Manual 720-degree hand crank animation
  private manualCrankAnim: {
    active: boolean;
    elapsed: number;
    duration: number;
    startDeg: number;
    totalDeg: number;
    onDone?: () => void;
  } = { active: false, elapsed: 0, duration: 2.2, startDeg: 0, totalDeg: 720 };

  // Individual roller hand-spin check animation (water pump, upper/lower idlers)
  private rollerSpinAnims = new Map<TimingWheelId, { elapsed: number; duration: number; extraRad: number }>();

  private readonly poseObj = new THREE.Object3D();
  private readonly disposableGeos: THREE.BufferGeometry[] = [];
  private readonly disposableMats: THREE.Material[] = [];

  constructor() {
    this.group.name = 'EA288TimingEngine';
    this.engineCoreGroup.name = 'EA288EngineCore';
    this.engineBayGroup.name = 'EA288EngineBayVisuals';
    this.group.add(this.engineCoreGroup);
    this.engineCoreGroup.add(this.engineBayGroup);

    // Mount timing drive cleanly on the right timing face of the installed EA288 engine
    this.timingDriveRoot.name = 'EA288TimingDriveRoot';
    this.timingDriveRoot.position.copy(TIMING_ORIGIN);
    this.timingDriveRoot.rotation.y = Math.PI / 2;
    this.timingDriveRoot.scale.setScalar(TIMING_SCALE);
    this.engineCoreGroup.add(this.timingDriveRoot);

    // Materials (VW Digital Cockpit PBR palette)
    this.oldBeltCarcassMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x322d28, roughness: 0.90, metalness: 0.04 })
    );
    this.oldBeltToothMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x26221e, roughness: 0.88, metalness: 0.05 })
    );
    this.newBeltCarcassMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x16191e, roughness: 0.66, metalness: 0.06 })
    );
    this.newBeltToothMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x1f252b, roughness: 0.62, metalness: 0.08 })
    );
    this.cordTrimOldMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x4b433b, roughness: 0.78, metalness: 0.1 })
    );
    this.cordTrimNewMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.45, metalness: 0.12 })
    );
    this.otAmberMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xb45309,
        emissiveIntensity: 0.55,
        roughness: 0.32,
        metalness: 0.15,
      })
    );
    this.otEmeraldMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x059669,
        emissiveIntensity: 0.85,
        roughness: 0.25,
        metalness: 0.12,
      })
    );
    this.guideCyanMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
      })
    );
    this.ghostCoverMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.7,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
      })
    );

    // 1. Procedural engine bay fallback block (replaced cleanly when ea288_engine.glb loads)
    this.buildFallbackEngineBlock();

    // 2. Machined rear timing backplate separating the 7-wheel drive cleanly from the engine core
    this.buildTimingBackplate();

    // 3. Build all 7 wheels/rollers + OT marks/pointers + locking pins + tensioner nut
    const sharedPointerGeo = this.trackGeo(buildPointerGeometry());
    for (const w of wheels) {
      const asm = this.buildWheelAssembly(w, sharedPointerGeo);
      this.wheelAssemblies.set(w.id as TimingWheelId, asm);
      this.timingDriveRoot.add(asm.pivot);

      if (lockable.includes(w.id)) {
        const lid = w.id as LockableWheelId;
        const pin = this.buildLockingPin(w, lid);
        this.lockPinGroups.set(lid, pin);
        this.timingDriveRoot.add(pin);
      }
    }

    // 4. Eccentric tensioner reference window (Referenzfenster) & indicator needle
    this.gaugeNeedleMesh = this.buildTensionerReferenceGauge();

    // 5. Analytical toothed timing belt (carcass + cord trim + instanced teeth + routing guide)
    this.beltCarcassGeo = this.trackGeo(
      buildBeltStripGeometry(0, BELT_THICK, BELT_BACK_Z, BELT_FRONT_Z)
    );
    this.beltCordTrimGeo = this.trackGeo(
      buildBeltStripGeometry(0.015, 0.031, BELT_FRONT_Z - 0.002, BELT_FRONT_Z + 0.004)
    );
    this.beltCarcassMesh = new THREE.Mesh(this.beltCarcassGeo, this.oldBeltCarcassMat);
    this.beltCarcassMesh.castShadow = true;
    this.beltCarcassMesh.receiveShadow = true;
    this.beltCordTrimMesh = new THREE.Mesh(this.beltCordTrimGeo, this.cordTrimOldMat);

    const toothGeo = this.trackGeo(buildToothGeometry());
    this.teethInstanced = new THREE.InstancedMesh(toothGeo, this.oldBeltToothMat, BELT_TEETH);
    this.teethInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.teethInstanced.frustumCulled = false;

    const capGeo = this.trackGeo(new THREE.BoxGeometry(0.014, BELT_THICK, BELT_FRONT_Z - BELT_BACK_Z));
    this.capStart = new THREE.Mesh(capGeo, this.cordTrimNewMat);
    this.capEnd = new THREE.Mesh(capGeo, this.cordTrimNewMat);

    this.beltGroup.add(
      this.beltCarcassMesh,
      this.beltCordTrimMesh,
      this.teethInstanced,
      this.capStart,
      this.capEnd
    );
    tagInteractable(this.beltGroup, 'oldTimingBelt');
    this.timingDriveRoot.add(this.beltGroup);

    // Translucent hit strip for clicking the belt path while routing
    this.newBeltSlotHitMesh = new THREE.Mesh(
      this.beltCarcassGeo,
      this.trackMat(
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          colorWrite: false,
          depthWrite: false,
        })
      )
    );
    tagInteractable(this.newBeltSlotHitMesh, 'newTimingBeltSlot');
    this.timingDriveRoot.add(this.newBeltSlotHitMesh);

    // Cyan guide dashes & target ring for Step 9 belt laying
    this.guideDashes = new THREE.InstancedMesh(
      this.trackGeo(new THREE.BoxGeometry(toothPitch * 1.12, 0.028, 0.020)),
      this.guideCyanMat,
      54
    );
    this.guideDashes.frustumCulled = false;
    this.guideDashes.raycast = () => {};
    this.timingDriveRoot.add(this.guideDashes);

    this.targetRing = new THREE.Mesh(
      this.trackGeo(new THREE.TorusGeometry(1, 0.022, 10, 64)),
      this.guideCyanMat
    );
    this.targetRing.raycast = () => {};
    this.timingDriveRoot.add(this.targetRing);

    // 6. Interactive Timing Belt Cover + 2 Torx T25 Fasteners + Reassembly Ghost Slot
    this.buildTimingCoverAndBolts();

    this.applyTimingVisuals();
    this.applyCoverTransform();
  }

  private trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.disposableGeos.push(g);
    return g;
  }

  private trackMat<T extends THREE.Material>(m: T): T {
    this.disposableMats.push(m);
    return m;
  }

  // =========================================================================
  // Construction Helpers
  // =========================================================================

  private buildFallbackEngineBlock(): void {
    const darkCast = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x3b414a, metalness: 0.68, roughness: 0.56 })
    );
    const aluMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.76, roughness: 0.42 })
    );
    const plasticMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x1b1e24, metalness: 0.06, roughness: 0.64 })
    );

    const sump = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.64, 0.13, 0.34)), darkCast);
    sump.position.set(0.02, 0.285, -1.32);
    const block = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.68, 0.24, 0.32)), darkCast);
    block.position.set(0.02, 0.45, -1.32);
    const head = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.68, 0.12, 0.34)), aluMat);
    head.position.set(0.02, 0.635, -1.32);
    const valveCover = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.62, 0.052, 0.30)),
      plasticMat
    );
    valveCover.position.set(0.02, 0.72, -1.32);
    this.engineBayGroup.add(sump, block, head, valveCover);
  }

  private buildTimingBackplate(): void {
    const backplateMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x262d36,
        metalness: 0.58,
        roughness: 0.52,
      })
    );
    const plateShape = buildCoverShape();
    const plateGeo = this.trackGeo(
      new THREE.ExtrudeGeometry(plateShape, {
        depth: 0.06,
        bevelEnabled: true,
        bevelSize: 0.015,
        bevelThickness: 0.015,
        bevelSegments: 1,
      })
    );
    const backplate = new THREE.Mesh(plateGeo, backplateMat);
    backplate.position.z = -0.22;
    backplate.receiveShadow = true;
    this.timingDriveRoot.add(backplate);
  }

  private buildWheelAssembly(w: Wheel, sharedPointerGeo: THREE.BufferGeometry): WheelAssembly {
    const id = w.id as TimingWheelId;
    const interactableId = WHEEL_TO_INTERACTABLE[id];

    // Per-wheel cloned PBR materials so hover highlight isolates cleanly to ONE wheel!
    const steelMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x97a6b3, roughness: 0.32, metalness: 0.82 })
    );
    const darkSteelMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x3b4652, roughness: 0.46, metalness: 0.72 })
    );
    const brightMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xd6e0ea, roughness: 0.22, metalness: 0.90 })
    );
    const bearingMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x222a33, roughness: 0.52, metalness: 0.62 })
    );

    const pivot = new THREE.Group();
    pivot.position.set(w.x, w.y, 0);
    const spinner = new THREE.Group();
    pivot.add(spinner);

    const addDisc = (
      parent: THREE.Object3D,
      x: number,
      y: number,
      z: number,
      radius: number,
      depth: number,
      mat: THREE.Material,
      sides = 36
    ) => {
      const m = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(radius, radius, depth, sides)), mat);
      m.rotation.x = Math.PI / 2;
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    const addRing = (
      parent: THREE.Object3D,
      radius: number,
      thickness: number,
      z: number,
      mat: THREE.Material
    ) => {
      const m = new THREE.Mesh(this.trackGeo(new THREE.TorusGeometry(radius, thickness, 10, 48)), mat);
      m.position.z = z;
      parent.add(m);
      return m;
    };

    // Rear mounting hub boss seated into backplate
    addDisc(pivot, 0, 0, -0.17, w.r * 0.76, 0.16, darkSteelMat, 28);

    if (w.teeth) {
      const toothGroup = new THREE.Group();
      toothGroup.rotation.z = gearMeshPhase(id);
      const gearGeo = this.trackGeo(
        new THREE.ExtrudeGeometry(gearShape(w), {
          depth: 0.236,
          bevelEnabled: true,
          bevelSize: 0.003,
          bevelThickness: 0.003,
          bevelSegments: 1,
          curveSegments: 5,
        })
      );
      const face = new THREE.Mesh(gearGeo, [steelMat, darkSteelMat]);
      face.position.z = -0.118;
      face.castShadow = true;
      face.receiveShadow = true;
      toothGroup.add(face);
      spinner.add(toothGroup);

      addRing(spinner, w.r * 0.86, 0.010, 0.125, brightMat);
      addRing(spinner, w.r * 0.37, 0.014, 0.136, darkSteelMat);
      addDisc(spinner, 0, 0, 0.132, w.r * 0.34, 0.056, darkSteelMat, 24);

      if (id === 'cam') {
        // Three slotted adjustment bolts characteristic of the EA288 camshaft hub
        for (let j = 0; j < 3; j++) {
          const a = (j * TAU) / 3 + 0.18;
          addDisc(
            spinner,
            Math.cos(a) * w.r * 0.35,
            Math.sin(a) * w.r * 0.35,
            0.156,
            0.036,
            0.052,
            brightMat,
            6
          );
        }
      }
    } else {
      // Smooth idler / tensioner / water pump roller contacting smooth belt back
      const r = w.r - BELT_THICK;
      addDisc(spinner, 0, 0, 0, r, 0.252, id === 'water' ? bearingMat : steelMat, 36);
      addDisc(spinner, 0, 0, 0.132, r * 0.86, 0.024, darkSteelMat, 28);
      addRing(spinner, r * 0.76, 0.010, 0.148, brightMat);
      addRing(spinner, r * 0.45, 0.014, 0.150, bearingMat);

      // Subtle silver rotation index dot so hand-spin bearing checks are visibly clear
      const spinDot = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.022, r * 0.42, 0.016)),
        brightMat
      );
      spinDot.position.set(0, r * 0.56, 0.154);
      spinner.add(spinDot);
    }

    // Center shaft bolt (tensioner gets its own dedicated interactable nut group too!)
    if (id === 'tensioner') {
      this.tensionerNutGroup.position.set(w.x, w.y, 0.175);
      const nutFlange = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.095, 0.095, 0.028, 18)),
        brightMat.clone()
      );
      nutFlange.rotation.x = Math.PI / 2;
      const nutHex = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.068, 0.068, 0.052, 6)),
        brightMat.clone()
      );
      nutHex.rotation.x = Math.PI / 2;
      nutHex.position.z = 0.022;
      const nutHit = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.115, 0.115, 0.11, 16)),
        this.trackMat(
          new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            colorWrite: false,
            depthWrite: false,
          })
        )
      );
      nutHit.rotation.x = Math.PI / 2;
      nutHit.position.z = 0.02;
      this.tensionerNutGroup.add(nutFlange, nutHex, nutHit);
      tagInteractable(this.tensionerNutGroup, 'tensionerNut');
      this.timingDriveRoot.add(this.tensionerNutGroup);
    } else {
      addDisc(spinner, 0, 0, 0.160, w.r * 0.24, 0.044, brightMat, 6);
      addDisc(spinner, 0, 0, 0.186, w.r * 0.11, 0.018, darkSteelMat, 6);
    }

    // OT reference marks + fixed housing pointers + machined locking bore collars on KW, NW, HDP
    let fixedPointer: THREE.Mesh | undefined;
    const rotatingMarkMeshes: THREE.Mesh[] = [];
    if (lockable.includes(id)) {
      const lid = id as LockableWheelId;
      const markBar = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.032, w.r * 0.25, 0.024)),
        this.otAmberMat
      );
      markBar.position.set(0, w.r * 0.80, 0.155);
      spinner.add(markBar);
      rotatingMarkMeshes.push(markBar);

      const rimNotch = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.026, 0.052, 0.022)),
        this.otAmberMat
      );
      rimNotch.position.set(0, w.r * 0.94, 0.162);
      spinner.add(rimNotch);
      rotatingMarkMeshes.push(rimNotch);

      // Fixed housing bracket + sculpted 3D OT reference pointer directly above 12 o'clock
      const bracket = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.13, 0.056, 0.048)),
        darkSteelMat
      );
      bracket.position.set(0, w.r + 0.152, 0.145);
      pivot.add(bracket);

      fixedPointer = new THREE.Mesh(sharedPointerGeo, this.otAmberMat);
      fixedPointer.position.set(0, w.r + 0.072, 0.156);
      pivot.add(fixedPointer);

      // Machined locking bore collar on sprocket face
      const la = LOCK_ANGLES[lid];
      const lr = w.r * 0.52;
      const lx = Math.cos(la) * lr;
      const ly = Math.sin(la) * lr;
      addDisc(spinner, lx, ly, 0.144, 0.052, 0.032, brightMat, 18);
      addDisc(spinner, lx, ly, 0.156, 0.034, 0.026, bearingMat, 16);
    }

    // Generous invisible raycast hitbox (especially helpful on compact upper/lower idlers)
    const hitRadius = Math.max(w.r + 0.07, 0.24);
    const hitMesh = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(hitRadius, hitRadius, 0.34, 20)),
      this.trackMat(
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          colorWrite: false,
          depthWrite: false,
        })
      )
    );
    hitMesh.rotation.x = Math.PI / 2;
    hitMesh.position.z = 0.04;
    pivot.add(hitMesh);

    tagInteractable(pivot, interactableId);
    return { spec: w, pivot, spinner, fixedPointer, rotatingMarkMeshes, hitRoot: pivot };
  }

  private buildLockingPin(w: Wheel, id: LockableWheelId): THREE.Group {
    const la = LOCK_ANGLES[id];
    const lr = w.r * 0.52;

    const pin = new THREE.Group();
    pin.position.set(w.x + Math.cos(la) * lr, w.y + Math.sin(la) * lr, 0.14);

    const steelMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xd0d8e2, metalness: 0.90, roughness: 0.22 })
    );
    const collarMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.78, roughness: 0.34 })
    );
    const redAnodizedMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xdc2626, metalness: 0.68, roughness: 0.28 })
    );

    const shank = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.030, 0.030, 0.32, 16)),
      steelMat
    );
    shank.rotation.x = Math.PI / 2;
    shank.position.z = 0.14;
    pin.add(shank);

    const collar = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.048, 0.048, 0.034, 18)),
      collarMat
    );
    collar.rotation.x = Math.PI / 2;
    collar.position.z = 0.04;
    pin.add(collar);

    // Knurled red-anodized workshop locking handle (matches original T10060A aesthetic)
    const handle = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.054, 0.054, 0.17, 18)),
      redAnodizedMat
    );
    handle.rotation.z = Math.PI / 2;
    handle.position.set(0.045, 0, 0.30);
    pin.add(handle);

    const hit = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.11, 0.11, 0.38, 14)),
      this.trackMat(
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          colorWrite: false,
          depthWrite: false,
        })
      )
    );
    hit.rotation.x = Math.PI / 2;
    hit.position.z = 0.19;
    pin.add(hit);

    tagInteractable(pin, LOCK_TO_INTERACTABLE[id]);
    pin.visible = false;
    return pin;
  }

  private buildTensionerReferenceGauge(): THREE.Mesh {
    const tw = wheels.find((w) => w.id === 'tensioner')!;
    const brightMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xd8e2ec, metalness: 0.88, roughness: 0.22 })
    );
    const slotDarkMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.35, roughness: 0.82 })
    );
    const darkSteelMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.78, roughness: 0.38 })
    );

    // U-shaped slotted reference window bracket directly above tensioner hub
    const refBase = new THREE.Group();
    refBase.position.set(tw.x, tw.y, 0.176);

    const addBox = (
      parent: THREE.Object3D,
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      mat: THREE.Material
    ) => {
      const m = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(w, h, d)), mat);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };

    addBox(refBase, -0.062, 0.265, 0.012, 0.056, 0.058, 0.024, brightMat);
    addBox(refBase, +0.062, 0.265, 0.012, 0.056, 0.058, 0.024, brightMat);
    addBox(refBase, 0, 0.304, 0.012, 0.180, 0.028, 0.024, brightMat);
    addBox(refBase, 0, 0.265, 0.004, 0.066, 0.052, 0.012, slotDarkMat);
    addBox(refBase, 0, 0.292, 0.024, 0.018, 0.028, 0.014, this.otEmeraldMat);
    tagInteractable(refBase, 'wheel_tensioner');
    this.timingDriveRoot.add(refBase);

    // Pivoting eccentric tensioner indicator needle
    this.gaugePivot.position.set(tw.x, tw.y, 0.194);
    const hub = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.052, 0.052, 0.026, 20)),
      darkSteelMat
    );
    hub.rotation.x = Math.PI / 2;
    this.gaugePivot.add(hub);

    const needle = addBox(this.gaugePivot, 0, 0.148, 0.010, 0.026, 0.245, 0.020, this.otAmberMat);
    tagInteractable(this.gaugePivot, 'wheel_tensioner');
    this.timingDriveRoot.add(this.gaugePivot);
    return needle;
  }

  private buildTimingCoverAndBolts(): void {
    const coverMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x1c2128,
        roughness: 0.66,
        metalness: 0.10,
      })
    );
    const coverTrimMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x2c3440,
        roughness: 0.56,
        metalness: 0.18,
      })
    );
    this.timingCoverMaterials.push(coverMat, coverTrimMat);

    const coverShape = buildCoverShape();
    const coverGeo = this.trackGeo(
      new THREE.ExtrudeGeometry(coverShape, {
        depth: 0.11,
        bevelEnabled: true,
        bevelSize: 0.032,
        bevelThickness: 0.028,
        bevelSegments: 2,
      })
    );

    const mainMesh = new THREE.Mesh(coverGeo, coverMat);
    mainMesh.castShadow = true;
    mainMesh.receiveShadow = true;
    this.timingCoverGroup.add(mainMesh);

    // Molded EA288 acoustic stiffening ribs & cam bulge ring on cover face
    const camRing = new THREE.Mesh(
      this.trackGeo(new THREE.TorusGeometry(0.60, 0.032, 10, 36)),
      coverTrimMat
    );
    camRing.position.set(-0.67, 1.19, 0.135);
    this.timingCoverGroup.add(camRing);

    const pumpRing = new THREE.Mesh(
      this.trackGeo(new THREE.TorusGeometry(0.34, 0.024, 8, 28)),
      coverTrimMat
    );
    pumpRing.position.set(1.08, 1.22, 0.135);
    this.timingCoverGroup.add(pumpRing);

    for (const ry of [-0.65, -0.20, 0.25, 0.70]) {
      const rib = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.95, 0.045, 0.024)), coverTrimMat);
      rib.position.set(0.08, ry, 0.138);
      this.timingCoverGroup.add(rib);
    }

    this.timingCoverGroup.position.set(0, 0, 0.21);
    tagInteractable(this.timingCoverGroup, 'timingCover');
    this.timingDriveRoot.add(this.timingCoverGroup);

    // Translucent cyan ghost slot for Step 13 timing cover reinstallation
    const ghostMesh = new THREE.Mesh(coverGeo, this.ghostCoverMat);
    this.timingCoverSlotGroup.add(ghostMesh);
    this.timingCoverSlotGroup.position.set(0, 0, 0.21);
    this.timingCoverSlotGroup.visible = false;
    tagInteractable(this.timingCoverSlotGroup, 'timingCoverSlot');
    this.timingDriveRoot.add(this.timingCoverSlotGroup);

    // 2 clickable Torx T25 timing-cover fastening bolts
    const boltPositions: Array<{ id: 'timingCoverBolt_0' | 'timingCoverBolt_1'; pos: [number, number, number] }> = [
      { id: 'timingCoverBolt_0', pos: [0.35, 1.56, 0.35] },
      { id: 'timingCoverBolt_1', pos: [0.16, -1.16, 0.35] },
    ];

    for (const spec of boltPositions) {
      const root = new THREE.Group();
      const restLocalPos = new THREE.Vector3(...spec.pos);
      root.position.copy(restLocalPos);

      const spinGroup = new THREE.Group();
      root.add(spinGroup);

      const boltMat = this.trackMat(
        new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.88, roughness: 0.24 })
      );
      const darkStarMat = this.trackMat(
        new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.4, roughness: 0.7 })
      );

      const washer = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.115, 0.115, 0.025, 18)),
        boltMat
      );
      washer.rotation.x = Math.PI / 2;
      const head = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.082, 0.082, 0.065, 6)),
        boltMat
      );
      head.rotation.x = Math.PI / 2;
      head.position.z = 0.036;
      const star = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.042, 0.042, 0.02, 6)),
        darkStarMat
      );
      star.rotation.x = Math.PI / 2;
      star.position.z = 0.066;

      const hit = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.20, 0.20, 0.18, 14)),
        this.trackMat(
          new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            colorWrite: false,
            depthWrite: false,
          })
        )
      );
      hit.rotation.x = Math.PI / 2;
      hit.position.z = 0.04;

      spinGroup.add(washer, head, star, hit);
      tagInteractable(root, spec.id);
      this.timingDriveRoot.add(root);

      this.coverBolts.push({
        id: spec.id,
        root,
        spinGroup,
        restLocalPos,
        progress: 0,
        target: 0,
        materials: [boltMat, darkStarMat],
      });
    }
  }

  // =========================================================================
  // Public API
  // =========================================================================

  public async loadBlenderModel(): Promise<void> {
    const glb = await loadGLB(getSharedModelUrl('ea288_engine.glb'));
    const coreBlock = extractNode(glb, 'EA288_CoreBlock', false);
    if (coreBlock) {
      this.engineBayGroup.clear();
      this.engineBayGroup.add(coreBlock);
    }
  }

  public setTimingCoverBoltRemoved(index: number, removed: boolean, instant = false): void {
    const bolt = this.coverBolts[index];
    if (!bolt) return;
    bolt.target = removed ? 1 : 0;
    bolt.root.userData.ignoreRaycast = removed;
    if (instant) {
      bolt.progress = bolt.target;
      this.applyCoverBoltTransform(bolt);
    }
  }

  public setTimingCoverRemoved(removed: boolean, instant = false): void {
    this.coverTarget = removed ? 1 : 0;
    this.timingCoverGroup.userData.ignoreRaycast = removed;
    if (instant) {
      this.coverProgress = this.coverTarget;
      this.applyCoverTransform();
    }
  }

  public setTimingCoverSlotVisible(visible: boolean): void {
    this.timingCoverSlotGroup.visible = visible;
  }

  public setCrankAngle(degrees: number): void {
    this.crankAngleDeg = degrees;
    this.applyTimingVisuals();
  }

  public getCrankAngle(): number {
    return this.crankAngleDeg;
  }

  public setTension(normalized: number): void {
    this.tensionNormalized = Math.max(0, Math.min(1, normalized));
    this.applyTimingVisuals();
  }

  public setLockedShafts(shafts: readonly LockableWheelId[]): void {
    this.lockedShafts = new Set(shafts);
    for (const [id, pin] of this.lockPinGroups) {
      pin.visible = this.lockedShafts.has(id);
    }
  }

  public setBeltState(state: TimingBeltVisualState): void {
    this.beltState = state;
    const isOld = state === 'old';
    this.beltCarcassMesh.material = isOld ? this.oldBeltCarcassMat : this.newBeltCarcassMat;
    this.beltCordTrimMesh.material = isOld ? this.cordTrimOldMat : this.cordTrimNewMat;
    this.teethInstanced.material = isOld ? this.oldBeltToothMat : this.newBeltToothMat;
    this.applyTimingVisuals();
  }

  public setRoutingProgress(nodes: readonly TimingWheelId[]): void {
    this.routingNodes = [...nodes];
    this.applyTimingVisuals();
  }

  public setEngineRunning(running: boolean, rpm = 820): void {
    this.engineRunning = running;
    this.engineRpm = rpm;
    if (!running) {
      this.engineCoreGroup.position.set(0, 0, 0);
      this.engineCoreGroup.rotation.set(0, 0, 0);
    }
  }

  public triggerManualCrank720(onDone?: () => void): void {
    this.manualCrankAnim = {
      active: true,
      elapsed: 0,
      duration: 2.3,
      startDeg: this.crankAngleDeg,
      totalDeg: 720,
      onDone,
    };
  }

  public triggerRollerSpinCheck(id: TimingWheelId): void {
    const prev = this.rollerSpinAnims.get(id);
    this.rollerSpinAnims.set(id, {
      elapsed: 0,
      duration: 0.95,
      extraRad: prev?.extraRad ?? 0,
    });
  }

  public getWheelWorldPos(id: TimingWheelId): THREE.Vector3 {
    this.group.updateMatrixWorld(true);
    const asm = this.wheelAssemblies.get(id)!;
    const out = new THREE.Vector3();
    asm.pivot.getWorldPosition(out);
    out.x += 0.022;
    return out;
  }

  /**
   * Computes a world-space point directly on the visible front surface (+z = BELT_FRONT_Z)
   * of an analytical straight timing-belt span (`sections[sectionIndex]`), centered across
   * the belt thickness along the outward normal `(nx, ny)`.
   */
  private getBeltSpanFrontWorldPos(sectionIndex: number, spanFraction = 0.5): THREE.Vector3 {
    this.group.updateMatrixWorld(true);
    const sec = sections[Math.max(0, Math.min(sections.length - 1, sectionIndex))];
    const straightStart = sec.start + sec.arc;
    const straightLen = Math.max(0, sec.end - straightStart);
    const dist = straightStart + straightLen * spanFraction;
    const p = pointOnBelt(dist);
    const localPos = new THREE.Vector3(
      p.x + p.nx * (BELT_THICK * 0.5),
      p.y + p.ny * (BELT_THICK * 0.5),
      BELT_FRONT_Z
    );
    return this.timingDriveRoot.localToWorld(localPos);
  }

  public update(dt: number): void {
    const safeDt = Math.min(dt, 0.05);
    this.animClock += safeDt;

    // 1. Animate timing cover & its 2 Torx bolts
    const nextCover = this.stepProgress(this.coverProgress, this.coverTarget, safeDt, 2.3);
    if (nextCover !== null) {
      this.coverProgress = nextCover;
      this.applyCoverTransform();
    }
    for (const bolt of this.coverBolts) {
      const nextB = this.stepProgress(bolt.progress, bolt.target, safeDt, 4.4);
      if (nextB !== null) {
        bolt.progress = nextB;
        this.applyCoverBoltTransform(bolt);
      }
    }

    // 2. Pulse cyan guide & ghost slot opacities cleanly
    if (this.beltState === 'routing') {
      this.guideCyanMat.opacity = 0.42 + 0.24 * Math.sin(this.animClock * 4.5);
    }
    if (this.timingCoverSlotGroup.visible) {
      this.ghostCoverMat.opacity = 0.24 + 0.14 * Math.sin(this.animClock * 4.2);
    }

    // 3. Diesel idle kinematics + subtle 0.4 mm 4-cylinder engine block vibration
    if (this.engineRunning) {
      // Visually readable steady timing-belt motion during 820 RPM idle
      const degPerSec = 340;
      this.crankAngleDeg += degPerSec * safeDt;
      this.applyTimingVisuals();

      const fireFreq = (this.engineRpm / 60) * 2 * Math.PI * 2;
      const vib = 0.0004;
      this.engineCoreGroup.position.set(
        Math.sin(this.animClock * fireFreq * 1.1) * vib * 0.6,
        Math.sin(this.animClock * fireFreq) * vib,
        Math.cos(this.animClock * fireFreq * 0.5) * vib * 0.5
      );
      this.engineCoreGroup.rotation.z = Math.sin(this.animClock * fireFreq) * 0.0009;
    }

    // 4. Smooth 720-degree manual crankshaft hand-check animation
    if (this.manualCrankAnim.active) {
      this.manualCrankAnim.elapsed += safeDt;
      const t = Math.min(1, this.manualCrankAnim.elapsed / this.manualCrankAnim.duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.crankAngleDeg = this.manualCrankAnim.startDeg + this.manualCrankAnim.totalDeg * eased;
      this.applyTimingVisuals();

      if (t >= 1) {
        this.crankAngleDeg = 720;
        this.manualCrankAnim.active = false;
        this.applyTimingVisuals();
        const cb = this.manualCrankAnim.onDone;
        this.manualCrankAnim.onDone = undefined;
        cb?.();
      }
    }

    // 5. Individual hand-spin bearing checks for rollers (when belt is off)
    if (this.rollerSpinAnims.size > 0) {
      let anyUpdated = false;
      for (const [id, anim] of this.rollerSpinAnims.entries()) {
        anim.elapsed += safeDt;
        const t = Math.min(1, anim.elapsed / anim.duration);
        const speedDecay = (1 - t) * (1 - t);
        anim.extraRad += 24 * speedDecay * safeDt;
        anyUpdated = true;
        if (t >= 1) {
          this.rollerSpinAnims.delete(id);
        }
      }
      if (anyUpdated) {
        this.applyTimingVisuals();
      }
    }
  }

  public getInteractables(): THREE.Object3D[] {
    const list: THREE.Object3D[] = [
      this.timingCoverGroup,
      this.timingCoverSlotGroup,
      ...this.coverBolts.map((b) => b.root),
      this.tensionerNutGroup,
    ];

    for (const asm of this.wheelAssemblies.values()) {
      list.push(asm.hitRoot);
    }
    for (const pin of this.lockPinGroups.values()) {
      if (pin.visible) list.push(pin);
    }
    if (this.beltState === 'old') {
      list.push(this.beltGroup);
    } else if (this.beltState === 'routing') {
      list.push(this.newBeltSlotHitMesh);
    }
    return list;
  }

  public getPartWorldPos(id: InteractableId): THREE.Vector3 | null {
    this.group.updateMatrixWorld(true);
    const out = new THREE.Vector3();

    switch (id) {
      case 'timingCoverBolt_0':
        this.coverBolts[0].root.getWorldPosition(out);
        return out;
      case 'timingCoverBolt_1':
        this.coverBolts[1].root.getWorldPosition(out);
        return out;
      case 'timingCover':
      case 'timingCoverSlot':
        return this.timingDriveRoot.localToWorld(new THREE.Vector3(0.05, 0.25, 0.34));
      case 'oldTimingBelt':
        return this.getBeltSpanFrontWorldPos(5, 0.5);
      case 'newTimingBeltSlot': {
        const nextSecIdx =
          this.routingNodes.length > 0 && this.routingNodes.length < sections.length
            ? this.routingNodes.length - 1
            : 5;
        return this.getBeltSpanFrontWorldPos(nextSecIdx, 0.5);
      }
      case 'tensionerNut':
        this.tensionerNutGroup.getWorldPosition(out);
        out.x += 0.015;
        return out;
      case 'lockPin_crank':
      case 'lockPin_cam':
      case 'lockPin_pump': {
        const lid = id.replace('lockPin_', '') as LockableWheelId;
        const pin = this.lockPinGroups.get(lid);
        if (!pin) return null;
        pin.getWorldPosition(out);
        out.x += 0.025;
        return out;
      }
      case 'wheel_crank':
      case 'wheel_lower':
      case 'wheel_tensioner':
      case 'wheel_cam':
      case 'wheel_upper':
      case 'wheel_pump':
      case 'wheel_water': {
        const wid = id.replace('wheel_', '') as TimingWheelId;
        return this.getWheelWorldPos(wid);
      }
      default:
        return null;
    }
  }

  public dispose(): void {
    for (const geo of this.disposableGeos) geo.dispose();
    for (const mat of this.disposableMats) mat.dispose();
  }

  // =========================================================================
  // Internal Visual Synchronization
  // =========================================================================

  private applyTimingVisuals(): void {
    const otOk = isAtOT(this.crankAngleDeg, 4);
    const distance = ((this.crankAngleDeg * Math.PI) / 180) * CRANK_RADIUS;

    // 1. Update all 7 wheel rotations & OT pointer colors
    for (const w of wheels) {
      const id = w.id as TimingWheelId;
      const asm = this.wheelAssemblies.get(id)!;
      const extraSpin = this.rollerSpinAnims.get(id)?.extraRad ?? 0;
      asm.spinner.rotation.z = wheelRotation(w, this.crankAngleDeg) + extraSpin;

      if (asm.fixedPointer) {
        asm.fixedPointer.material = otOk ? this.otEmeraldMat : this.otAmberMat;
      }
      for (const m of asm.rotatingMarkMeshes) {
        m.material = otOk ? this.otEmeraldMat : this.otAmberMat;
      }
    }

    // 2. Update eccentric tensioner needle angle & emerald alignment state
    this.gaugePivot.rotation.z = (0.5 - this.tensionNormalized) * 1.9;
    const tensionAligned = Math.abs(this.tensionNormalized - 0.5) <= 0.04;
    this.gaugeNeedleMesh.material = tensionAligned ? this.otEmeraldMat : this.otAmberMat;

    // 3. Update belt visibility, partial routing span, tooth meshing, and cyan guide dashes
    const hasFullBelt =
      this.beltState === 'old' ||
      this.beltState === 'new_slack' ||
      this.beltState === 'new_tensioned';
    const routingCount = this.beltState === 'routing' ? this.routingNodes.length : 0;
    const coveredLength = hasFullBelt
      ? loopLength
      : routingCount > 0
        ? sections[Math.min(routingCount, sections.length) - 1].end
        : 0;
    const fraction = coveredLength / loopLength;
    const isPartial = fraction > 0 && fraction < 0.999;

    this.beltGroup.visible = fraction > 0;
    this.newBeltSlotHitMesh.visible = this.beltState === 'routing';

    const showRoutingGuides = this.beltState === 'routing' && routingCount < wheels.length;
    this.guideDashes.visible = showRoutingGuides;
    this.targetRing.visible = showRoutingGuides;

    if (showRoutingGuides) {
      const remainingStart = coveredLength;
      const remainingLen = Math.max(0.01, loopLength - remainingStart);
      const count = Math.min(54, Math.max(8, Math.round(remainingLen / 0.20)));
      this.guideDashes.count = count;
      for (let i = 0; i < count; i++) {
        const sd = remainingStart + ((i + 0.5) / count) * remainingLen;
        this.placeBeltInstance(this.guideDashes, i, sd, BELT_THICK * 0.5, BELT_FRONT_Z + 0.018);
      }
      this.guideDashes.instanceMatrix.needsUpdate = true;

      const nextWheel = wheels[routingCount];
      this.targetRing.position.set(nextWheel.x, nextWheel.y, 0.21);
      this.targetRing.scale.setScalar(nextWheel.r + 0.072);
    }

    if (fraction <= 0) return;

    const segCount = fraction >= 0.999 ? SEGMENTS : Math.max(1, Math.round(SEGMENTS * fraction));
    this.beltCarcassGeo.setDrawRange(0, segCount * 24);
    this.beltCordTrimGeo.setDrawRange(0, segCount * 24);

    this.capStart.visible = isPartial;
    this.capEnd.visible = isPartial;
    if (isPartial) {
      this.placeCap(this.capStart, 0);
      this.placeCap(this.capEnd, (segCount / SEGMENTS) * loopLength);
    }

    if (!isPartial) {
      this.teethInstanced.count = BELT_TEETH;
      for (let i = 0; i < BELT_TEETH; i++) {
        this.placeBeltInstance(this.teethInstanced, i, i * toothPitch + distance, 0, 0);
      }
    } else {
      const actualEnd = (segCount / SEGMENTS) * loopLength;
      const phase = ((distance % toothPitch) + toothPitch) % toothPitch;
      let count = 0;
      for (
        let sPos = phase;
        sPos <= actualEnd - toothPitch * 0.2 && count < BELT_TEETH;
        sPos += toothPitch
      ) {
        if (sPos >= toothPitch * 0.15) {
          this.placeBeltInstance(this.teethInstanced, count++, sPos, 0, 0);
        }
      }
      this.teethInstanced.count = count;
    }
    this.teethInstanced.instanceMatrix.needsUpdate = true;
  }

  private placeCap(mesh: THREE.Mesh, dist: number): void {
    const p = pointOnBelt(dist);
    mesh.position.set(
      p.x + p.nx * (BELT_THICK * 0.5),
      p.y + p.ny * (BELT_THICK * 0.5),
      (BELT_BACK_Z + BELT_FRONT_Z) * 0.5
    );
    mesh.rotation.set(0, 0, Math.atan2(p.ty, p.tx));
  }

  private placeBeltInstance(
    mesh: THREE.InstancedMesh,
    i: number,
    distance: number,
    normal: number,
    z: number
  ): void {
    const p = pointOnBelt(distance);
    this.poseObj.position.set(p.x + p.nx * normal, p.y + p.ny * normal, z);
    this.poseObj.rotation.set(0, 0, Math.atan2(p.ty, p.tx));
    this.poseObj.updateMatrix();
    mesh.setMatrixAt(i, this.poseObj.matrix);
  }

  private stepProgress(current: number, target: number, dt: number, speed: number): number | null {
    if (Math.abs(current - target) < 0.0005) {
      return current === target ? null : target;
    }
    const dir = target > current ? 1 : -1;
    const next = current + dir * speed * dt;
    if ((dir > 0 && next >= target) || (dir < 0 && next <= target)) {
      return target;
    }
    return next;
  }

  private easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  private applyCoverTransform(): void {
    const t = this.coverProgress;
    if (t >= 0.999) {
      this.timingCoverGroup.visible = false;
      return;
    }
    this.timingCoverGroup.visible = true;

    const pullT = Math.min(1, t / 0.6);
    const fadeT = Math.max(0, (t - 0.6) / 0.4);
    const ePull = this.easeInOut(pullT);

    this.timingCoverGroup.position.set(ePull * 0.15, ePull * 0.25, 0.21 + ePull * 1.45);
    this.timingCoverGroup.rotation.set(0, ePull * 0.14, -ePull * 0.08);

    const alpha = 1 - fadeT;
    const isTransparent = alpha < 0.99;
    for (const mat of this.timingCoverMaterials) {
      mat.transparent = isTransparent;
      mat.opacity = alpha;
      mat.depthWrite = !isTransparent;
    }
  }

  private applyCoverBoltTransform(bolt: CoverBoltRecord): void {
    const t = bolt.progress;
    if (t >= 0.999) {
      bolt.root.visible = false;
      return;
    }
    bolt.root.visible = true;

    const slideT = Math.min(1, t / 0.72);
    const fadeT = Math.max(0, (t - 0.72) / 0.28);
    const eSlide = this.easeInOut(slideT);

    bolt.root.position.set(
      bolt.restLocalPos.x,
      bolt.restLocalPos.y,
      bolt.restLocalPos.z + eSlide * 0.58
    );
    bolt.spinGroup.rotation.z = -eSlide * 16;

    const alpha = 1 - fadeT;
    const isTransparent = alpha < 0.99;
    for (const mat of bolt.materials) {
      mat.transparent = isTransparent;
      mat.opacity = alpha;
      mat.depthWrite = !isTransparent;
    }
  }
}
