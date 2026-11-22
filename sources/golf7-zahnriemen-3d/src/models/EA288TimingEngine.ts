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
import { OIL_CUTAWAY_LAYER } from '../engine/SceneManager';
import type {
  InteractableId,
  LockableWheelId,
  TimingWheelId,
  VwBeltLayStationId,
} from '../types';

export type TimingBeltVisualState = 'old' | 'none' | 'routing' | 'new_slack' | 'new_tensioned';

interface WheelAssembly {
  spec: Wheel;
  pivot: THREE.Group;
  spinner: THREE.Group;
  /** Independent outer toothed rim for adjustable cam & HDP sprockets (Langlöcher!) */
  outerRimGroup?: THREE.Group;
  fixedPointer?: THREE.Mesh;
  rotatingMarkMeshes: THREE.Mesh[];
  hitRoot: THREE.Object3D;
}

// Flush right timing face of EA288_CoreBlock inside the Golf VII:
// +z_local -> +X (outward toward right wheel well), +y_local -> +Y (up), +x_local -> -Z (toward front bumper).
// Keeping TIMING_ORIGIN.x = 0.412 ensures timing covers, engine support, vibration damper & poly-V auxiliary drive
// ALL fit strictly inboard of the wheel arch liner (X = 0.505)!
const TIMING_ORIGIN = new THREE.Vector3(0.412, 0.505, -1.350);
const TIMING_SCALE = 0.122;

const SEGMENTS = 520;
const BELT_BACK_Z = -0.110;
const BELT_FRONT_Z = 0.130;
const BELT_THICK = 0.043;

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

/** Maps VW Rep.-Gr. 15 S. 118 primary laying stations (1..5) to the cumulative section index in `drive.ts`. */
const VW_STATION_TO_SECTION_END: Record<VwBeltLayStationId, number> = {
  crank: 0, // covers crank arc
  tensioner: 2, // covers crank -> lower idler -> tensioner
  cam: 3, // covers up to cam
  pump: 5, // covers cam -> upper idler -> HDP
  water: 6, // completes full closed loop via water pump last!
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
  const holes = w.id === 'cam' ? 6 : 5;
  for (let i = 0; i < holes; i++) {
    const a = (TAU * i) / holes + 0.22;
    const hole = new THREE.Path();
    hole.absarc(w.r * 0.62 * Math.cos(a), w.r * 0.62 * Math.sin(a), w.r * 0.135, 0, TAU, true);
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
    depth: 0.026,
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
  const g = new THREE.ExtrudeGeometry(t, { depth: 0.228, bevelEnabled: false });
  return g.translate(0, 0, -0.114);
}

function buildFullBackplateShape(): THREE.Shape {
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

function buildUpperCoverShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-1.02, 0.20);
  s.lineTo(1.18, 0.28);
  s.lineTo(1.50, 1.06);
  s.quadraticCurveTo(1.66, 1.72, 0.98, 1.82);
  s.lineTo(-0.56, 2.00);
  s.quadraticCurveTo(-1.52, 2.02, -1.42, 1.06);
  s.closePath();
  return s;
}

function buildLowerCoverShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.44, -1.58);
  s.quadraticCurveTo(0, -1.78, 0.44, -1.50);
  s.lineTo(0.92, -0.14);
  s.lineTo(1.06, 0.28);
  s.lineTo(-0.96, 0.22);
  s.lineTo(-0.74, -0.44);
  s.closePath();
  return s;
}

/**
 * Complete installed VW Golf VII 1.6 TDI (EA288, MKB CLHA) engine assembly featuring:
 * - Authentic 7-wheel camshaft timing-belt drive (145 teeth, 25 mm) with physically accurate
 *   locking forks & bores (T10490 crankshaft stop + sealing flange bore, 3359 through cam follower fork
 *   into cylinder head, T10492 through HDP hub fork into ancillary bracket)
 * - Adjustable slotted cam & HDP hubs (Langlöcher), central fasteners & small cam fixing bolt
 * - Explicitly simulated Typ B eccentric tensioner (cast-recess lug, T10265 lock pin, base-plate tabs & pointer)
 * - Split upper & lower timing covers (captive collar bolt 12 Nm)
 * - Removable engine support bracket (Motorstütze, 3 bolts)
 * - Removable crankshaft vibration damper (4 outer bolts) & complete poly-V auxiliary belt drive
 *   (spring-arm tensioner + T10060 A lock pin + alternator + AC compressor)
 * - Dedicated lower-sump 3D cutaway showing the separate oil-bath toothed oil/vacuum pump belt (VW SSP 820433)
 */
export class EA288TimingEngine {
  public readonly group = new THREE.Group();

  private readonly engineCoreGroup = new THREE.Group();
  private readonly engineBayGroup = new THREE.Group();
  private readonly timingDriveRoot = new THREE.Group();

  // 7 timing-drive wheel assemblies + hub fasteners
  private readonly wheelAssemblies = new Map<TimingWheelId, WheelAssembly>();
  private readonly tensionerNutGroup = new THREE.Group();
  private readonly tensionerLockPinGroup = new THREE.Group();
  private readonly camCenterBoltGroup = new THREE.Group();
  private readonly camFixBoltGroup = new THREE.Group();
  private readonly pumpCenterNutGroup = new THREE.Group();

  // Physically accurate locking tools (T10490, 3359, T10492)
  private readonly lockPinGroups = new Map<LockableWheelId, THREE.Group>();

  // Eccentric tensioner (Typ B) base-plate reference window & pivoting indicator needle
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

  // Split Timing Covers (upper clipped cover + lower cover with 12 Nm captive collar bolt)
  private readonly upperCoverGroup = new THREE.Group();
  private readonly upperCoverMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly upperCoverSlotGroup = new THREE.Group();
  private upperCoverProgress = 0;
  private upperCoverTarget = 0;

  private readonly lowerCoverGroup = new THREE.Group();
  private readonly lowerCoverMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly lowerCoverSlotGroup = new THREE.Group();
  private lowerCoverProgress = 0;
  private lowerCoverTarget = 0;

  private readonly lowerCoverBoltGroup = new THREE.Group();
  private readonly lowerCoverBoltSpin = new THREE.Group();
  private readonly lowerCoverBoltMaterials: THREE.MeshStandardMaterial[] = [];
  private lowerCoverBoltProgress = 0;
  private lowerCoverBoltTarget = 0;

  // Engine Support Bracket (`Motorstütze`, 3 bolts, Rep.-Gr. 13 S. 53–54)
  private readonly engineSupportGroup = new THREE.Group();
  private readonly engineSupportMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly engineSupportSlotGroup = new THREE.Group();
  private engineSupportProgress = 0;
  private engineSupportTarget = 0;

  // Crankshaft Vibration Damper (`Schwingungsdämpfer`, 4 outer bolts, Rep.-Gr. 13 S. 53)
  private readonly crankDamperGroup = new THREE.Group();
  private readonly crankDamperSpin = new THREE.Group();
  private readonly crankDamperMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly crankDamperSlotGroup = new THREE.Group();
  private crankDamperProgress = 0;
  private crankDamperTarget = 0;

  // Poly-V Auxiliary Belt Drive (`Nebenantrieb`, Rep.-Gr. 13 S. 52)
  private readonly auxDriveGroup = new THREE.Group();
  private readonly auxAlternatorSpin = new THREE.Group();
  private readonly auxAcSpin = new THREE.Group();
  private readonly auxTensionerArmPivot = new THREE.Group();
  private readonly auxTensionerRollerSpin = new THREE.Group();
  private readonly auxLockPinGroup = new THREE.Group();
  private readonly auxBeltGroup = new THREE.Group();
  private readonly auxBeltSlotGroup = new THREE.Group();
  private auxTensionerSwingDeg = 0;
  private auxPinned = false;
  private auxBeltRemoved = false;

  // Separate Oil-Bath Toothed Oil/Vacuum Pump Belt (`Ölpumpen-Zahnriemen`, VW SSP 820433 S. 12/16)
  private readonly oilPumpSystemGroup = new THREE.Group();
  private readonly oilSumpWallMat: THREE.MeshStandardMaterial;
  private readonly oilCrankGearSpin = new THREE.Group();
  private readonly oilPumpWheelSpin = new THREE.Group();
  private readonly oilBeltCurve: THREE.CatmullRomCurve3;
  private readonly oilBeltTeeth: THREE.InstancedMesh;
  private readonly oilBeltHitGroup = new THREE.Group();
  private oilSumpCutawayActive = false;

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
  private readonly ghostCyanMat: THREE.MeshStandardMaterial;

  // Dynamic mechanical state
  private crankAngleDeg = 635;
  private tensionNormalized = 0.50;
  private beltState: TimingBeltVisualState = 'old';
  private routingStations: VwBeltLayStationId[] = [];
  private lockedShafts = new Set<LockableWheelId>();
  private tensionerPinnedTypeB = false;
  private camSprocketSlackOffsetRad = 0;
  private pumpSprocketSlackOffsetRad = 0;

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
    endDeg: number;
    onDone?: () => void;
  } = { active: false, elapsed: 0, duration: 2.2, startDeg: 0, totalDeg: 720, endDeg: 720 };

  // Individual roller hand-spin check animation
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
    this.ghostCyanMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.72,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
      })
    );
    this.oilSumpWallMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x222730,
        metalness: 0.55,
        roughness: 0.52,
        transparent: false,
        opacity: 1,
      })
    );

    // 1. Procedural engine bay fallback block (replaced cleanly when ea288_engine.glb loads)
    this.buildFallbackEngineBlock();

    // 2. Machined rear timing backplate + engine lifting eye for VW 10-222 A shackle
    this.buildTimingBackplateAndLiftingEye();

    // 3. Build all 7 wheels/rollers + physically accurate locking forks/bores + hub bolts
    const sharedPointerGeo = this.trackGeo(buildPointerGeometry());
    for (const w of wheels) {
      const asm = this.buildWheelAssembly(w, sharedPointerGeo);
      this.wheelAssemblies.set(w.id as TimingWheelId, asm);
      this.timingDriveRoot.add(asm.pivot);

      if (lockable.includes(w.id)) {
        const lid = w.id as LockableWheelId;
        const pin = this.buildPhysicalLockTool(w, lid);
        this.lockPinGroups.set(lid, pin);
        this.timingDriveRoot.add(pin);
      }
    }

    // 4. Typ B Eccentric tensioner cast-recess lug, base-plate tabs, pointer & T10265 lock pin
    this.gaugeNeedleMesh = this.buildTensionerTypeBDetails();

    // 5. Analytical 145-tooth camshaft timing belt
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

    // 6. Split Upper & Lower Timing Covers + 12 Nm Captive Collar Bolt
    this.buildSplitTimingCovers();

    // 7. Cast Aluminum Engine Support Bracket (`Motorstütze`, 3 bolts)
    this.buildEngineSupportBracket();

    // 8. Crankshaft Vibration Damper (4 outer bolts) + Auxiliary Poly-V Serpentine Belt Drive
    this.buildCrankDamperAndAuxDrive();

    // 9. Separate Oil-Bath Toothed Oil/Vacuum Pump Belt (VW SSP 820433 S. 12/16, lower sump cutaway)
    const oilBuilt = this.buildOilPumpWetBeltAssembly();
    this.oilBeltCurve = oilBuilt.beltCurve;
    this.oilBeltTeeth = oilBuilt.teethInstanced;

    this.applyTimingVisuals();
    this.applyUpperCoverTransform();
    this.applyLowerCoverTransform();
    this.applyLowerCoverBoltTransform();
    this.applyEngineSupportTransform();
    this.applyCrankDamperTransform();
    this.applyAuxDriveVisuals();
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

    const sump = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.60, 0.12, 0.32)), darkCast);
    sump.position.set(-0.02, 0.28, -1.32);
    const block = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.64, 0.24, 0.30)), darkCast);
    block.position.set(0.0, 0.45, -1.32);
    const head = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.64, 0.12, 0.32)), aluMat);
    head.position.set(0.0, 0.635, -1.32);
    const valveCover = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.58, 0.052, 0.28)),
      plasticMat
    );
    valveCover.position.set(0.0, 0.72, -1.32);
    this.engineBayGroup.add(sump, block, head, valveCover);
  }

  private buildTimingBackplateAndLiftingEye(): void {
    const backplateMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x262d36,
        metalness: 0.58,
        roughness: 0.52,
      })
    );
    const plateShape = buildFullBackplateShape();
    const plateGeo = this.trackGeo(
      new THREE.ExtrudeGeometry(plateShape, {
        depth: 0.055,
        bevelEnabled: true,
        bevelSize: 0.014,
        bevelThickness: 0.014,
        bevelSegments: 1,
      })
    );
    const backplate = new THREE.Mesh(plateGeo, backplateMat);
    backplate.position.z = -0.18;
    backplate.receiveShadow = true;
    this.timingDriveRoot.add(backplate);

    // Steel engine lifting eye on top of cylinder head (engaged by VW 10-222 A /12 shackle!)
    const eyeMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.32 })
    );
    const liftingEye = new THREE.Mesh(this.trackGeo(new THREE.TorusGeometry(0.020, 0.0055, 8, 18)), eyeMat);
    liftingEye.position.set(0.26, 0.745, -1.32);
    this.engineCoreGroup.add(liftingEye);
  }

  private buildWheelAssembly(w: Wheel, sharedPointerGeo: THREE.BufferGeometry): WheelAssembly {
    const id = w.id as TimingWheelId;
    const interactableId = WHEEL_TO_INTERACTABLE[id];

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
    const boreDarkMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x0b1120, roughness: 0.75, metalness: 0.3 })
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

    // Rear mounting boss seated into backplate
    addDisc(pivot, 0, 0, -0.14, w.r * 0.74, 0.12, darkSteelMat, 28);

    let outerRimGroup: THREE.Group | undefined;

    if (w.teeth) {
      const rimTarget = id === 'cam' || id === 'pump' ? new THREE.Group() : spinner;
      if (rimTarget !== spinner) {
        outerRimGroup = rimTarget;
        spinner.add(outerRimGroup);
      }

      const toothGroup = new THREE.Group();
      toothGroup.rotation.z = gearMeshPhase(id);
      const gearGeo = this.trackGeo(
        new THREE.ExtrudeGeometry(gearShape(w), {
          depth: 0.21,
          bevelEnabled: true,
          bevelSize: 0.003,
          bevelThickness: 0.003,
          bevelSegments: 1,
          curveSegments: 5,
        })
      );
      const face = new THREE.Mesh(gearGeo, [steelMat, darkSteelMat]);
      face.position.z = -0.105;
      face.castShadow = true;
      face.receiveShadow = true;
      toothGroup.add(face);
      rimTarget.add(toothGroup);

      addRing(rimTarget, w.r * 0.86, 0.010, 0.112, brightMat);
      addRing(spinner, w.r * 0.36, 0.013, 0.122, darkSteelMat);
      addDisc(spinner, 0, 0, 0.118, w.r * 0.33, 0.048, darkSteelMat, 24);

      if (id === 'cam') {
        // Real EA288 camshaft locating arm ("Mitnehmer / Stellarm") with U-fork at ~7:30 o'clock
        // plus machined locking bore directly behind it in cylinder head (matches REPXPERT 05:23!)
        const forkAngle = -2.35; // ~7:30 o'clock (lower-left quadrant, matching REPXPERT video)
        const forkRadius = w.r * 0.44;
        const fx = Math.cos(forkAngle) * forkRadius;
        const fy = Math.sin(forkAngle) * forkRadius;

        // Cylinder-head locking bore on static backplate behind the cam sprocket
        addDisc(pivot, fx, fy, -0.115, 0.068, 0.04, brightMat, 18);
        addDisc(pivot, fx, fy, -0.102, 0.040, 0.04, boreDarkMat, 16);

        // Follower fork ("Mitnehmer-Gabel") rotating with the inner camshaft hub
        const forkArm = new THREE.Mesh(
          this.trackGeo(new THREE.BoxGeometry(0.11, 0.045, 0.036)),
          brightMat
        );
        forkArm.position.set(fx * 0.72, fy * 0.72, 0.128);
        forkArm.rotation.z = forkAngle;
        spinner.add(forkArm);

        for (const perp of [-0.042, 0.042]) {
          const prong = new THREE.Mesh(
            this.trackGeo(new THREE.BoxGeometry(0.08, 0.022, 0.034)),
            brightMat
          );
          prong.position.set(
            fx - Math.sin(forkAngle) * perp,
            fy + Math.cos(forkAngle) * perp,
            0.128
          );
          prong.rotation.z = forkAngle;
          spinner.add(prong);
        }

        // Visible elongated adjustment slots ("Langlöcher") on the adjustable outer sprocket
        for (let j = 0; j < 3; j++) {
          const a = (j * TAU) / 3 + 0.35;
          const slot = new THREE.Mesh(
            this.trackGeo(new THREE.BoxGeometry(0.115, 0.042, 0.016)),
            boreDarkMat
          );
          slot.position.set(Math.cos(a) * w.r * 0.40, Math.sin(a) * w.r * 0.40, 0.118);
          slot.rotation.z = a + Math.PI / 2;
          rimTarget.add(slot);
        }

        // Dedicated clickable central camshaft bolt (`camCenterBolt`: 20 Nm pre -> 100 Nm final)
        this.camCenterBoltGroup.position.set(w.x, w.y, 0.145);
        const camHex = new THREE.Mesh(
          this.trackGeo(new THREE.CylinderGeometry(0.105, 0.105, 0.056, 6)),
          brightMat.clone()
        );
        camHex.rotation.x = Math.PI / 2;
        const camWasher = new THREE.Mesh(
          this.trackGeo(new THREE.CylinderGeometry(0.142, 0.142, 0.022, 20)),
          darkSteelMat.clone()
        );
        camWasher.rotation.x = Math.PI / 2;
        camWasher.position.z = -0.018;
        const camBoltHit = new THREE.Mesh(
          this.trackGeo(new THREE.CylinderGeometry(0.165, 0.165, 0.14, 16)),
          this.trackMat(
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false })
          )
        );
        camBoltHit.rotation.x = Math.PI / 2;
        camBoltHit.position.z = 0.02;
        this.camCenterBoltGroup.add(camWasher, camHex, camBoltHit);
        tagInteractable(this.camCenterBoltGroup, 'camCenterBolt');
        this.timingDriveRoot.add(this.camCenterBoltGroup);

        // Dedicated clickable small cam fixing bolt (`camFixBolt`: 1/2 turn loosen -> 9 Nm final)
        const fixA = 0.35;
        this.camFixBoltGroup.position.set(
          w.x + Math.cos(fixA) * w.r * 0.40,
          w.y + Math.sin(fixA) * w.r * 0.40,
          0.145
        );
        const fixHead = new THREE.Mesh(
          this.trackGeo(new THREE.CylinderGeometry(0.052, 0.052, 0.048, 8)),
          this.trackMat(new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.78, roughness: 0.26 }))
        );
        fixHead.rotation.x = Math.PI / 2;
        const fixHit = new THREE.Mesh(
          this.trackGeo(new THREE.CylinderGeometry(0.11, 0.11, 0.12, 14)),
          this.trackMat(
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false })
          )
        );
        fixHit.rotation.x = Math.PI / 2;
        this.camFixBoltGroup.add(fixHead, fixHit);
        tagInteractable(this.camFixBoltGroup, 'camFixBolt');
        this.timingDriveRoot.add(this.camFixBoltGroup);
      } else if (id === 'pump') {
        // Real EA288 HDP hub fork at 9 o'clock + ancillary bracket locking bore behind it (REPXPERT 01:19!)
        const pForkAngle = Math.PI; // 9 o'clock facing left toward bracket bore
        const pForkR = w.r * 0.64;
        const px = Math.cos(pForkAngle) * pForkR;
        const py = Math.sin(pForkAngle) * pForkR;

        // Ancillary bracket bore behind HDP hub
        addDisc(pivot, px, py, -0.115, 0.058, 0.04, brightMat, 16);
        addDisc(pivot, px, py, -0.102, 0.036, 0.04, boreDarkMat, 16);

        // Hub U-fork on HDP inner hub
        for (const pyOff of [-0.036, 0.036]) {
          const prong = new THREE.Mesh(
            this.trackGeo(new THREE.BoxGeometry(0.085, 0.020, 0.030)),
            brightMat
          );
          prong.position.set(px, py + pyOff, 0.125);
          spinner.add(prong);
        }

        // Dedicated clickable HDP central nut (`pumpCenterNut`: ~90° loosen, 20 Nm pre -> 95 Nm final)
        this.pumpCenterNutGroup.position.set(w.x, w.y, 0.145);
        const pumpHex = new THREE.Mesh(
          this.trackGeo(new THREE.CylinderGeometry(0.088, 0.088, 0.052, 6)),
          brightMat.clone()
        );
        pumpHex.rotation.x = Math.PI / 2;
        const pumpFlange = new THREE.Mesh(
          this.trackGeo(new THREE.CylinderGeometry(0.118, 0.118, 0.020, 18)),
          darkSteelMat.clone()
        );
        pumpFlange.rotation.x = Math.PI / 2;
        pumpFlange.position.z = -0.016;
        const pumpHit = new THREE.Mesh(
          this.trackGeo(new THREE.CylinderGeometry(0.145, 0.145, 0.13, 16)),
          this.trackMat(
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false })
          )
        );
        pumpHit.rotation.x = Math.PI / 2;
        pumpHit.position.z = 0.02;
        this.pumpCenterNutGroup.add(pumpFlange, pumpHex, pumpHit);
        tagInteractable(this.pumpCenterNutGroup, 'pumpCenterNut');
        this.timingDriveRoot.add(this.pumpCenterNutGroup);
      } else if (id === 'crank') {
        // Crankshaft center bolt + 2 threaded holes for T10490 + sealing flange locking bore below-right
        addDisc(spinner, 0, 0, 0.145, w.r * 0.28, 0.044, brightMat, 12);
        // Alignment lug on crank sprocket (for vibration damper index hole!)
        const crankLug = new THREE.Mesh(
          this.trackGeo(new THREE.CylinderGeometry(0.026, 0.026, 0.036, 12)),
          this.otAmberMat
        );
        crankLug.rotation.x = Math.PI / 2;
        crankLug.position.set(0, w.r * 0.56, 0.135);
        spinner.add(crankLug);

        // Two dowel holes in crank sprocket for T10490
        for (const a of [0.35, -0.55]) {
          addDisc(spinner, Math.cos(a) * w.r * 0.58, Math.sin(a) * w.r * 0.58, 0.125, 0.032, 0.02, boreDarkMat, 12);
        }
        // Sealing-flange locking bore on static backplate engaged by T10490 stop pin
        addDisc(pivot, w.r * 0.92, -w.r * 0.72, -0.105, 0.056, 0.036, brightMat, 16);
        addDisc(pivot, w.r * 0.92, -w.r * 0.72, -0.095, 0.034, 0.036, boreDarkMat, 16);
      }
    } else {
      // Smooth idler / tensioner / water pump roller contacting smooth belt back
      const r = w.r - BELT_THICK;
      addDisc(spinner, 0, 0, 0, r, 0.236, id === 'water' ? bearingMat : steelMat, 36);
      addDisc(spinner, 0, 0, 0.122, r * 0.86, 0.022, darkSteelMat, 28);
      if (id === 'tensioner') {
        // Blue inner bearing seal ring characteristic of INA/VW EA288 Typ B tensioner (REPXPERT 04:44!)
        const blueSealMat = this.trackMat(
          new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.42, metalness: 0.18 })
        );
        addRing(spinner, r * 0.68, 0.018, 0.136, blueSealMat);
      } else {
        addRing(spinner, r * 0.76, 0.010, 0.136, brightMat);
      }
      addRing(spinner, r * 0.45, 0.014, 0.138, bearingMat);

      const spinDot = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.022, r * 0.42, 0.016)),
        brightMat
      );
      spinDot.position.set(0, r * 0.56, 0.142);
      spinner.add(spinDot);

      if (id === 'tensioner') {
        this.tensionerNutGroup.position.set(w.x, w.y, 0.162);
        const nutFlange = new THREE.Mesh(
          this.trackGeo(new THREE.CylinderGeometry(0.092, 0.092, 0.026, 18)),
          brightMat.clone()
        );
        nutFlange.rotation.x = Math.PI / 2;
        const nutHex = new THREE.Mesh(
          this.trackGeo(new THREE.CylinderGeometry(0.066, 0.066, 0.048, 6)),
          brightMat.clone()
        );
        nutHex.rotation.x = Math.PI / 2;
        nutHex.position.z = 0.020;
        const nutHit = new THREE.Mesh(
          this.trackGeo(new THREE.CylinderGeometry(0.115, 0.115, 0.11, 16)),
          this.trackMat(
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false })
          )
        );
        nutHit.rotation.x = Math.PI / 2;
        nutHit.position.z = 0.02;
        this.tensionerNutGroup.add(nutFlange, nutHex, nutHit);
        tagInteractable(this.tensionerNutGroup, 'tensionerNut');
        this.timingDriveRoot.add(this.tensionerNutGroup);
      } else {
        addDisc(spinner, 0, 0, 0.148, w.r * 0.24, 0.040, brightMat, 6);
      }
    }

    // Subtle OT index ticks on lockable sprockets + pointers
    let fixedPointer: THREE.Mesh | undefined;
    const rotatingMarkMeshes: THREE.Mesh[] = [];
    if (lockable.includes(id)) {
      const markBar = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.028, w.r * 0.22, 0.022)),
        this.otAmberMat
      );
      markBar.position.set(0, w.r * 0.80, 0.142);
      spinner.add(markBar);
      rotatingMarkMeshes.push(markBar);

      const bracket = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.12, 0.052, 0.042)),
        darkSteelMat
      );
      bracket.position.set(0, w.r + 0.145, 0.132);
      pivot.add(bracket);

      fixedPointer = new THREE.Mesh(sharedPointerGeo, this.otAmberMat);
      fixedPointer.position.set(0, w.r + 0.070, 0.142);
      pivot.add(fixedPointer);
    }

    const hitRadius = Math.max(w.r + 0.065, 0.24);
    const hitMesh = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(hitRadius, hitRadius, 0.30, 20)),
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
    hitMesh.position.z = 0.02;
    pivot.add(hitMesh);

    tagInteractable(pivot, interactableId);
    return { spec: w, pivot, spinner, outerRimGroup, fixedPointer, rotatingMarkMeshes, hitRoot: pivot };
  }

  /**
   * Builds physically faithful VW locking tools matching the real engagement geometry:
   * - T10490: curved crankshaft stop bracket engaging crank sprocket holes + sealing-flange bore
   * - 3359: stepped locking pin passing through camshaft follower fork into cylinder-head bore
   * - T10492: stepped locking pin passing through HDP hub fork into ancillary-bracket bore
   */
  private buildPhysicalLockTool(w: Wheel, id: LockableWheelId): THREE.Group {
    const tool = new THREE.Group();
    const steelMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xd0d8e2, metalness: 0.90, roughness: 0.22 })
    );
    const bodyMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.78, roughness: 0.32 })
    );
    const redMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xdc2626, metalness: 0.65, roughness: 0.28 })
    );

    if (id === 'crank') {
      // VW T10490 Crankshaft Stop: crescent flange over sprocket + sealing-flange locking pin!
      tool.position.set(w.x, w.y, 0.16);
      const plate = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.36, 0.34, 0.045)), bodyMat);
      plate.position.set(0.18, -0.12, 0.04);
      plate.rotation.z = -0.38;
      tool.add(plate);

      // 2 sprocket engagement studs
      for (const a of [0.35, -0.55]) {
        const stud = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(0.028, 0.028, 0.14, 14)), steelMat);
        stud.rotation.x = Math.PI / 2;
        stud.position.set(Math.cos(a) * w.r * 0.58, Math.sin(a) * w.r * 0.58, -0.02);
        tool.add(stud);
      }

      // Sealing flange locking dowel + red T-pull knob
      const dowel = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(0.032, 0.032, 0.34, 14)), steelMat);
      dowel.rotation.x = Math.PI / 2;
      dowel.position.set(w.r * 0.92, -w.r * 0.72, -0.06);
      const knob = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(0.062, 0.062, 0.11, 16)), redMat);
      knob.rotation.x = Math.PI / 2;
      knob.position.set(w.r * 0.92, -w.r * 0.72, 0.16);
      tool.add(dowel, knob);

      const hit = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.46, 0.44, 0.34)),
        this.trackMat(
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false })
        )
      );
      hit.position.set(0.18, -0.14, 0.08);
      tool.add(hit);
    } else {
      // 3359 (cam at ~7:30 fork) or T10492 (pump at 9:00 fork) passing through fork into rear bore!
      const angle = id === 'cam' ? -2.35 : Math.PI;
      const radius = id === 'cam' ? w.r * 0.44 : w.r * 0.64;
      tool.position.set(w.x + Math.cos(angle) * radius, w.y + Math.sin(angle) * radius, 0.02);

      // Long precision shaft extending from rear bore (-0.14) through fork (+0.12) to outer handle (+0.32)
      const shank = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(0.032, 0.032, 0.46, 16)), steelMat);
      shank.rotation.x = Math.PI / 2;
      shank.position.z = 0.09;
      const collar = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(0.052, 0.052, 0.04, 18)), bodyMat);
      collar.rotation.x = Math.PI / 2;
      collar.position.z = 0.17;
      const knurledHead = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.058, 0.058, 0.14, 18)),
        redMat
      );
      knurledHead.rotation.x = Math.PI / 2;
      knurledHead.position.z = 0.31;
      tool.add(shank, collar, knurledHead);

      const hit = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.12, 0.12, 0.48, 14)),
        this.trackMat(
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false })
        )
      );
      hit.rotation.x = Math.PI / 2;
      hit.position.z = 0.22;
      tool.add(hit);
    }

    tagInteractable(tool, LOCK_TO_INTERACTABLE[id]);
    tool.visible = false;
    return tool;
  }

  /**
   * Builds the explicitly simulated Typ B eccentric tensioner details:
   * - Metal positioning lug ("Sitzzunge") engaged in cast recess ("Gussnut") at 9 o'clock (REPXPERT 04:44!)
   * - U-shaped slotted base-plate tabs & pivoting pointer
   * - Clickable Typ B locking pin `T10265` (`tensionerLockPin`)
   */
  private buildTensionerTypeBDetails(): THREE.Mesh {
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
    const pinRedMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.65, roughness: 0.28 })
    );

    const refBase = new THREE.Group();
    refBase.position.set(tw.x, tw.y, 0.162);

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

    // Cast recess ("Gussnut") + metal lug ("Sitzzunge") on the 9 o'clock backplate side
    addBox(refBase, -0.34, 0.04, -0.24, 0.16, 0.11, 0.06, darkSteelMat);
    addBox(refBase, -0.29, 0.04, -0.22, 0.14, 0.045, 0.04, brightMat);

    // Base-plate tabs (-1- and -3-) framing the center gap for indicator (-2-)
    addBox(refBase, -0.064, 0.260, 0.010, 0.056, 0.060, 0.024, brightMat);
    addBox(refBase, +0.064, 0.260, 0.010, 0.056, 0.060, 0.024, brightMat);
    addBox(refBase, 0, 0.300, 0.010, 0.184, 0.028, 0.024, brightMat);
    addBox(refBase, 0, 0.260, 0.002, 0.068, 0.054, 0.012, slotDarkMat);
    addBox(refBase, 0, 0.288, 0.022, 0.018, 0.028, 0.014, this.otEmeraldMat);
    tagInteractable(refBase, 'wheel_tensioner');
    this.timingDriveRoot.add(refBase);

    // Pivoting indicator needle
    this.gaugePivot.position.set(tw.x, tw.y, 0.180);
    const hub = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.050, 0.050, 0.024, 20)),
      darkSteelMat
    );
    hub.rotation.x = Math.PI / 2;
    this.gaugePivot.add(hub);

    const needle = addBox(this.gaugePivot, 0, 0.144, 0.010, 0.026, 0.240, 0.020, this.otAmberMat);
    tagInteractable(this.gaugePivot, 'wheel_tensioner');
    this.timingDriveRoot.add(this.gaugePivot);

    // Clickable Typ B locking pin `T10265` seated in the lower-right bore of the tensioner hub
    this.tensionerLockPinGroup.position.set(tw.x + 0.10, tw.y - 0.11, 0.19);
    const tPinShaft = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.24, 14)),
      brightMat
    );
    tPinShaft.rotation.x = Math.PI / 2;
    const tPinHead = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.048, 0.048, 0.08, 16)),
      pinRedMat
    );
    tPinHead.rotation.x = Math.PI / 2;
    tPinHead.position.z = 0.13;
    const tPinHit = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.11, 0.11, 0.30, 14)),
      this.trackMat(
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false })
      )
    );
    tPinHit.rotation.x = Math.PI / 2;
    tPinHit.position.z = 0.10;
    this.tensionerLockPinGroup.add(tPinShaft, tPinHead, tPinHit);
    tagInteractable(this.tensionerLockPinGroup, 'tensionerLockPin');
    this.tensionerLockPinGroup.visible = false;
    this.timingDriveRoot.add(this.tensionerLockPinGroup);

    return needle;
  }

  private buildSplitTimingCovers(): void {
    const coverMatUpper = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x1c2128, roughness: 0.66, metalness: 0.10 })
    );
    const trimMatUpper = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x2c3440, roughness: 0.56, metalness: 0.18 })
    );
    this.upperCoverMaterials.push(coverMatUpper, trimMatUpper);

    const upperGeo = this.trackGeo(
      new THREE.ExtrudeGeometry(buildUpperCoverShape(), {
        depth: 0.095,
        bevelEnabled: true,
        bevelSize: 0.024,
        bevelThickness: 0.022,
        bevelSegments: 2,
      })
    );
    const upperMesh = new THREE.Mesh(upperGeo, coverMatUpper);
    upperMesh.castShadow = true;
    upperMesh.receiveShadow = true;
    this.upperCoverGroup.add(upperMesh);

    // Molded cam/HDP rings & snap-clip catches on upper cover
    const camRing = new THREE.Mesh(this.trackGeo(new THREE.TorusGeometry(0.58, 0.030, 10, 32)), trimMatUpper);
    camRing.position.set(-0.67, 1.19, 0.115);
    const pumpRing = new THREE.Mesh(this.trackGeo(new THREE.TorusGeometry(0.32, 0.024, 8, 24)), trimMatUpper);
    pumpRing.position.set(1.08, 1.22, 0.115);
    // Twin side snap latches ("Rastnasen")
    for (const lx of [-1.28, 1.36]) {
      const clip = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.11, 0.16, 0.05)), trimMatUpper);
      clip.position.set(lx, 1.05, 0.07);
      this.upperCoverGroup.add(clip);
    }
    this.upperCoverGroup.add(camRing, pumpRing);
    this.upperCoverGroup.position.set(0, 0, 0.165);
    tagInteractable(this.upperCoverGroup, 'upperTimingCover');
    this.timingDriveRoot.add(this.upperCoverGroup);

    const upperGhost = new THREE.Mesh(upperGeo, this.ghostCyanMat);
    this.upperCoverSlotGroup.add(upperGhost);
    this.upperCoverSlotGroup.position.set(0, 0, 0.165);
    this.upperCoverSlotGroup.visible = false;
    tagInteractable(this.upperCoverSlotGroup, 'upperTimingCoverSlot');
    this.timingDriveRoot.add(this.upperCoverSlotGroup);

    // Lower timing belt cover (`lowerTimingCover`, separate from upper!)
    const coverMatLower = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x1a1f26, roughness: 0.68, metalness: 0.10 })
    );
    const trimMatLower = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x2b333f, roughness: 0.56, metalness: 0.18 })
    );
    this.lowerCoverMaterials.push(coverMatLower, trimMatLower);

    const lowerGeo = this.trackGeo(
      new THREE.ExtrudeGeometry(buildLowerCoverShape(), {
        depth: 0.095,
        bevelEnabled: true,
        bevelSize: 0.022,
        bevelThickness: 0.020,
        bevelSegments: 2,
      })
    );
    const lowerMesh = new THREE.Mesh(lowerGeo, coverMatLower);
    lowerMesh.castShadow = true;
    lowerMesh.receiveShadow = true;
    this.lowerCoverGroup.add(lowerMesh);

    for (const ry of [-0.62, -0.22]) {
      const rib = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.92, 0.042, 0.022)), trimMatLower);
      rib.position.set(0.05, ry, 0.112);
      this.lowerCoverGroup.add(rib);
    }
    this.lowerCoverGroup.position.set(0, 0, 0.165);
    tagInteractable(this.lowerCoverGroup, 'lowerTimingCover');
    this.timingDriveRoot.add(this.lowerCoverGroup);

    const lowerGhost = new THREE.Mesh(lowerGeo, this.ghostCyanMat);
    this.lowerCoverSlotGroup.add(lowerGhost);
    this.lowerCoverSlotGroup.position.set(0, 0, 0.165);
    this.lowerCoverSlotGroup.visible = false;
    tagInteractable(this.lowerCoverSlotGroup, 'lowerTimingCoverSlot');
    this.timingDriveRoot.add(this.lowerCoverSlotGroup);

    // Captive collar bolt (`lowerCoverBolt`: 12 Nm, Rep.-Gr. 15 S. 105/111)
    this.lowerCoverBoltGroup.position.set(0.28, -0.82, 0.285);
    this.lowerCoverBoltGroup.add(this.lowerCoverBoltSpin);
    const boltMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.88, roughness: 0.24 })
    );
    const starMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.4, roughness: 0.7 })
    );
    this.lowerCoverBoltMaterials.push(boltMat, starMat);
    const washer = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(0.115, 0.115, 0.026, 18)), boltMat);
    washer.rotation.x = Math.PI / 2;
    const head = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(0.080, 0.080, 0.062, 6)), boltMat);
    head.rotation.x = Math.PI / 2;
    head.position.z = 0.036;
    const star = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(0.042, 0.042, 0.02, 6)), starMat);
    star.rotation.x = Math.PI / 2;
    star.position.z = 0.064;
    const bHit = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.22, 0.22, 0.20, 14)),
      this.trackMat(
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false })
      )
    );
    bHit.rotation.x = Math.PI / 2;
    bHit.position.z = 0.04;
    this.lowerCoverBoltSpin.add(washer, head, star, bHit);
    tagInteractable(this.lowerCoverBoltGroup, 'lowerCoverBolt');
    this.timingDriveRoot.add(this.lowerCoverBoltGroup);
  }

  /**
   * Builds the cast-aluminum Engine Support (`Motorstütze`, Rep.-Gr. 13 S. 53–54)
   * bolted across the mid timing face with 3 bolts (staged 7 Nm -> 40 Nm -> +180°).
   */
  private buildEngineSupportBracket(): void {
    const buildBody = (parent: THREE.Group, isGhost: boolean) => {
      const castMat = isGhost
        ? this.ghostCyanMat
        : this.trackMat(new THREE.MeshStandardMaterial({ color: 0xaab4c0, metalness: 0.78, roughness: 0.36 }));
      const boltMat = isGhost
        ? this.ghostCyanMat
        : this.trackMat(new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.90, roughness: 0.20 }));
      if (!isGhost) {
        this.engineSupportMaterials.push(castMat, boltMat);
      }

      // Main triangular cast aluminum engine-support web bridging block to right engine mount
      const web = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(1.18, 0.56, 0.14)), castMat);
      web.position.set(-0.08, 0.32, 0.34);
      web.castShadow = !isGhost;
      const topBoss = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.84, 0.18, 0.24)), castMat);
      topBoss.position.set(0.02, 0.62, 0.42);
      parent.add(web, topBoss);

      // 3 Mounting bolts (1, 2, 3 — Bolt 2 inserted into bracket before seating!)
      for (const [bx, by] of [
        [-0.48, 0.18],
        [0.02, 0.44],
        [0.36, 0.18],
      ] as const) {
        const b = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(0.068, 0.068, 0.085, 6)), boltMat);
        b.rotation.x = Math.PI / 2;
        b.position.set(bx, by, 0.43);
        parent.add(b);
      }
    };

    buildBody(this.engineSupportGroup, false);
    tagInteractable(this.engineSupportGroup, 'engineSupport');
    this.timingDriveRoot.add(this.engineSupportGroup);

    buildBody(this.engineSupportSlotGroup, true);
    this.engineSupportSlotGroup.visible = false;
    tagInteractable(this.engineSupportSlotGroup, 'engineSupportSlot');
    this.timingDriveRoot.add(this.engineSupportSlotGroup);
  }

  /**
   * Builds the Crankshaft Vibration Damper (4 outer bolts, 10 Nm + 90°) and the
   * complete Auxiliary Poly-V Serpentine Belt Drive (Alternator, AC Compressor,
   * pivoting Spring-Arm Tensioner + locking pin T10060 A, 6PK belt).
   * Fits strictly inside X < 0.495 so it never intersects the wheel arch liner!
   */
  private buildCrankDamperAndAuxDrive(): void {
    const cw = wheels.find((w) => w.id === 'crank')!;
    const darkMetal = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x2d333c, metalness: 0.72, roughness: 0.42 })
    );
    const aluMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x9fa9b5, metalness: 0.78, roughness: 0.36 })
    );
    const brightMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xdce4ee, metalness: 0.90, roughness: 0.20 })
    );
    const rubberMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x16191f, metalness: 0.06, roughness: 0.84 })
    );
    const redPinMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xdc2626, metalness: 0.65, roughness: 0.28 })
    );

    // 1. Removable Crankshaft Vibration Damper (`crankDamper` & `crankDamperSlot`)
    const damperZ = 0.42;
    this.crankDamperGroup.position.set(cw.x, cw.y, damperZ);
    this.crankDamperGroup.add(this.crankDamperSpin);

    const buildDamperMesh = (parent: THREE.Group, isGhost: boolean) => {
      const outerMat = isGhost ? this.ghostCyanMat : darkMetal.clone();
      const elastMat = isGhost ? this.ghostCyanMat : rubberMat.clone();
      const boltMat = isGhost ? this.ghostCyanMat : brightMat.clone();
      if (!isGhost) {
        this.crankDamperMaterials.push(outerMat, elastMat, boltMat);
      }

      const outerDrum = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.46, 0.46, 0.16, 32)),
        outerMat
      );
      outerDrum.rotation.x = Math.PI / 2;
      outerDrum.castShadow = !isGhost;
      const elastomerRing = new THREE.Mesh(
        this.trackGeo(new THREE.TorusGeometry(0.35, 0.036, 8, 28)),
        elastMat
      );
      elastomerRing.position.z = 0.078;
      const hubPlate = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 24)),
        outerMat
      );
      hubPlate.rotation.x = Math.PI / 2;
      hubPlate.position.z = 0.072;
      parent.add(outerDrum, elastomerRing, hubPlate);

      // 4 outer M10 multi-spline mounting bolts (10 Nm + 90°, separate from central crank bolt!)
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        const b = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(0.044, 0.044, 0.055, 8)), boltMat);
        b.rotation.x = Math.PI / 2;
        b.position.set(Math.cos(a) * 0.175, Math.sin(a) * 0.175, 0.098);
        parent.add(b);
      }

      // Alignment index hole marking (goes over crank sprocket lug!)
      const indexDot = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.026, 0.026, 0.02, 12)),
        isGhost ? this.ghostCyanMat : this.otAmberMat
      );
      indexDot.rotation.x = Math.PI / 2;
      indexDot.position.set(0, 0.21, 0.098);
      parent.add(indexDot);
    };

    buildDamperMesh(this.crankDamperSpin, false);
    tagInteractable(this.crankDamperGroup, 'crankDamper');
    this.timingDriveRoot.add(this.crankDamperGroup);

    this.crankDamperSlotGroup.position.set(cw.x, cw.y, damperZ);
    buildDamperMesh(this.crankDamperSlotGroup, true);
    this.crankDamperSlotGroup.visible = false;
    tagInteractable(this.crankDamperSlotGroup, 'crankDamperSlot');
    this.timingDriveRoot.add(this.crankDamperSlotGroup);

    // 2. Auxiliary Poly-V Belt Drive (`auxDriveGroup`, coaxial plane z = damperZ)
    this.timingDriveRoot.add(this.auxDriveGroup);

    const altPos = { x: 1.42, y: -0.18, r: 0.25 };
    const acPos = { x: 1.38, y: -1.14, r: 0.38 };
    const tensPivotPos = { x: 0.72, y: -0.78 };

    // Alternator housing + pulley
    const altHousing = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.38, 0.38, 0.42, 20)),
      aluMat
    );
    altHousing.rotation.x = Math.PI / 2;
    altHousing.position.set(altPos.x, altPos.y, 0.06);
    this.auxAlternatorSpin.position.set(altPos.x, altPos.y, damperZ);
    const altPulley = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(altPos.r, altPos.r, 0.14, 24)),
      darkMetal
    );
    altPulley.rotation.x = Math.PI / 2;
    const altNut = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 6)),
      brightMat
    );
    altNut.rotation.x = Math.PI / 2;
    altNut.position.z = 0.08;
    this.auxAlternatorSpin.add(altPulley, altNut);
    this.auxDriveGroup.add(altHousing, this.auxAlternatorSpin);

    // AC Compressor housing + clutch pulley
    const acHousing = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.42, 0.42, 0.46, 20)),
      aluMat
    );
    acHousing.rotation.x = Math.PI / 2;
    acHousing.position.set(acPos.x, acPos.y, 0.05);
    this.auxAcSpin.position.set(acPos.x, acPos.y, damperZ);
    const acPulley = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(acPos.r, acPos.r, 0.15, 28)),
      darkMetal
    );
    acPulley.rotation.x = Math.PI / 2;
    const acClutch = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(acPos.r * 0.62, acPos.r * 0.62, 0.04, 18)),
      brightMat
    );
    acClutch.rotation.x = Math.PI / 2;
    acClutch.position.z = 0.085;
    this.auxAcSpin.add(acPulley, acClutch);
    this.auxDriveGroup.add(acHousing, this.auxAcSpin);

    // Pivoting Spring-Arm Auxiliary Tensioner (`auxTensioner`, SW 16 hex boss in vehicle example, T10060 A bore!)
    const tensHousing = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.20, 0.22, 0.18, 20)),
      aluMat
    );
    tensHousing.rotation.x = Math.PI / 2;
    tensHousing.position.set(tensPivotPos.x, tensPivotPos.y, 0.24);
    this.auxDriveGroup.add(tensHousing);

    this.auxTensionerArmPivot.position.set(tensPivotPos.x, tensPivotPos.y, damperZ);
    const armBar = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.44, 0.15, 0.075)), aluMat.clone());
    armBar.position.set(0.14, 0.14, 0.02);
    armBar.rotation.z = 0.72;
    // Molded hex boss on tensioner arm for ring spanner (SW 16 in Golf 7 example)
    const wrenchBoss = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.092, 0.092, 0.068, 6)),
      brightMat.clone()
    );
    wrenchBoss.rotation.x = Math.PI / 2;
    wrenchBoss.position.set(0.0, 0.0, 0.095);

    this.auxTensionerRollerSpin.position.set(0.25, 0.24, 0.0);
    const tensRoller = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.21, 0.21, 0.14, 24)),
      darkMetal.clone()
    );
    tensRoller.rotation.x = Math.PI / 2;
    const tensCap = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.072, 0.072, 0.04, 14)),
      brightMat.clone()
    );
    tensCap.rotation.x = Math.PI / 2;
    tensCap.position.z = 0.075;
    this.auxTensionerRollerSpin.add(tensRoller, tensCap);

    const auxTensHit = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 16)),
      this.trackMat(
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false })
      )
    );
    auxTensHit.rotation.x = Math.PI / 2;
    auxTensHit.position.set(0.12, 0.12, 0.04);

    this.auxTensionerArmPivot.add(armBar, wrenchBoss, this.auxTensionerRollerSpin, auxTensHit);
    tagInteractable(this.auxTensionerArmPivot, 'auxTensioner');
    this.auxDriveGroup.add(this.auxTensionerArmPivot);

    // Clickable Locking Pin `T10060 A` on the spring-arm tensioner (`auxLockPin`)
    this.auxLockPinGroup.position.set(tensPivotPos.x - 0.12, tensPivotPos.y - 0.14, damperZ + 0.06);
    const auxPinShank = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.024, 0.024, 0.26, 14)),
      brightMat
    );
    auxPinShank.rotation.x = Math.PI / 2;
    const auxPinHandle = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.052, 0.052, 0.13, 16)),
      redPinMat
    );
    auxPinHandle.rotation.z = Math.PI / 2;
    auxPinHandle.position.set(0.04, 0, 0.14);
    const auxPinHit = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.14, 0.14, 0.30, 14)),
      this.trackMat(
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false })
      )
    );
    auxPinHit.rotation.x = Math.PI / 2;
    auxPinHit.position.z = 0.08;
    this.auxLockPinGroup.add(auxPinShank, auxPinHandle, auxPinHit);
    tagInteractable(this.auxLockPinGroup, 'auxLockPin');
    this.auxLockPinGroup.visible = false;
    this.auxDriveGroup.add(this.auxLockPinGroup);

    // 6PK Poly-V Serpentine Belt looping around Vibration Damper -> Tensioner -> Alternator -> AC Compressor
    const auxBeltPts = [
      new THREE.Vector3(cw.x - 0.44, cw.y - 0.12, damperZ),
      new THREE.Vector3(cw.x - 0.32, cw.y + 0.38, damperZ),
      new THREE.Vector3(tensPivotPos.x + 0.18, tensPivotPos.y + 0.42, damperZ),
      new THREE.Vector3(altPos.x - 0.08, altPos.y + altPos.r + 0.03, damperZ),
      new THREE.Vector3(altPos.x + altPos.r + 0.03, altPos.y - 0.06, damperZ),
      new THREE.Vector3(acPos.x + acPos.r + 0.03, acPos.y - 0.06, damperZ),
      new THREE.Vector3(acPos.x + 0.06, acPos.y - acPos.r - 0.03, damperZ),
      new THREE.Vector3(cw.x + 0.12, cw.y - 0.47, damperZ),
    ];
    const auxBeltCurve = new THREE.CatmullRomCurve3(auxBeltPts, true, 'catmullrom', 0.25);

    const buildAuxBeltLoop = (parent: THREE.Group, isGhost: boolean) => {
      const mat = isGhost
        ? this.ghostCyanMat
        : this.trackMat(new THREE.MeshStandardMaterial({ color: 0x1c2026, roughness: 0.80, metalness: 0.06 }));
      const beltTube = new THREE.Mesh(this.trackGeo(new THREE.TubeGeometry(auxBeltCurve, 72, 0.048, 8, true)), mat);
      beltTube.scale.set(1, 1, 1.55);
      beltTube.position.z = damperZ * (1 - 1.55);
      beltTube.castShadow = !isGhost;
      parent.add(beltTube);
    };

    buildAuxBeltLoop(this.auxBeltGroup, false);
    // Store exact front-span anchor point on the open crank->tensioner belt span (clear of tensioner hitbox)
    this.auxBeltGroup.userData.anchorLocal = auxBeltCurve.getPointAt(0.11);
    tagInteractable(this.auxBeltGroup, 'auxBelt');
    this.auxDriveGroup.add(this.auxBeltGroup);

    buildAuxBeltLoop(this.auxBeltSlotGroup, true);
    this.auxBeltSlotGroup.userData.anchorLocal = auxBeltCurve.getPointAt(0.11);
    this.auxBeltSlotGroup.visible = false;
    tagInteractable(this.auxBeltSlotGroup, 'auxBeltSlot');
    this.auxDriveGroup.add(this.auxBeltSlotGroup);
  }

  /**
   * Builds the separate EA288 Oil-Bath Toothed Oil/Vacuum Pump Belt inside the lower crankcase/sump
   * directly behind the front sealing flange (VW SSP 820433 printed p. 12 / PDF p. 16, Fig. S514_009).
   * Fixed center-distance belt tension — NO adjustable tensioner!
   */
  private buildOilPumpWetBeltAssembly(): {
    beltCurve: THREE.CatmullRomCurve3;
    teethInstanced: THREE.InstancedMesh;
  } {
    this.oilPumpSystemGroup.name = 'EA288OilPumpWetBelt';
    // Placed directly inboard (-z_local = -X in world) behind the crankshaft sealing flange!
    this.oilPumpSystemGroup.position.set(0, -1.258, -0.58);
    this.timingDriveRoot.add(this.oilPumpSystemGroup);

    const aluMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xb0bac6, metalness: 0.72, roughness: 0.34 })
    );
    const castBlockMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x262e3a, metalness: 0.56, roughness: 0.55 })
    );
    const steelMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x768599, metalness: 0.82, roughness: 0.28 })
    );
    const oilBeltMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x15181f, metalness: 0.14, roughness: 0.42 })
    );
    const oilBathMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xb45309,
        emissiveIntensity: 0.42,
        transparent: true,
        opacity: 0.42,
        roughness: 0.15,
        metalness: 0.12,
        depthWrite: false,
      })
    );
    const cutRimRedMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0x991b1b,
        emissiveIntensity: 0.50,
        roughness: 0.35,
      })
    );

    // Machined lower crankcase cutaway chamber behind the oil-bath belt (clearly visible in isolated Layer 2 view!)
    const rearCastBackwall = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(1.52, 1.72, 0.22)),
      castBlockMat
    );
    rearCastBackwall.position.set(0.12, -0.34, -0.34);
    this.oilPumpSystemGroup.add(rearCastBackwall);

    // Upper sealing flange collar & bottom oil pan cutaway trough
    const flangeCollar = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(1.54, 0.14, 0.46)),
      aluMat
    );
    flangeCollar.position.set(0.12, 0.46, -0.10);
    const sumpPanFloor = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(1.54, 0.14, 0.52)),
      castBlockMat
    );
    sumpPanFloor.position.set(0.12, -1.14, -0.06);
    const sideWallLeft = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.12, 1.68, 0.48)),
      castBlockMat
    );
    sideWallLeft.position.set(-0.60, -0.34, -0.08);
    const sideWallRight = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.12, 1.68, 0.48)),
      castBlockMat
    );
    sideWallRight.position.set(0.84, -0.34, -0.08);
    this.oilPumpSystemGroup.add(flangeCollar, sumpPanFloor, sideWallLeft, sideWallRight);

    // Red SSP 820433 cutaway cross-section border frame around the open sump cavity
    const rimTop = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(1.54, 0.045, 0.045)), cutRimRedMat);
    rimTop.position.set(0.12, 0.50, 0.14);
    const rimBot = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(1.54, 0.045, 0.045)), cutRimRedMat);
    rimBot.position.set(0.12, -1.18, 0.18);
    const rimL = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.045, 1.72, 0.045)), cutRimRedMat);
    rimL.position.set(-0.64, -0.34, 0.16);
    const rimR = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.045, 1.72, 0.045)), cutRimRedMat);
    rimR.position.set(0.88, -0.34, 0.16);
    this.oilPumpSystemGroup.add(rimTop, rimBot, rimL, rimR);

    // Translucent golden-amber engine oil bath submerging the lower pump wheel & toothed wet belt
    const oilPool = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(1.32, 0.62, 0.34)), oilBathMat);
    oilPool.position.set(0.12, -0.76, -0.02);
    this.oilPumpSystemGroup.add(oilPool);

    // 1. Inner crankshaft oil-pump toothed drive gear (top, coaxial with crankshaft!)
    this.oilCrankGearSpin.position.set(0, 0, 0);
    const crankOilGear = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.21, 0.21, 0.16, 22)),
      steelMat
    );
    crankOilGear.rotation.x = Math.PI / 2;
    const crankOilBoss = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.11, 0.11, 0.20, 14)),
      aluMat
    );
    crankOilBoss.rotation.x = Math.PI / 2;
    this.oilCrankGearSpin.add(crankOilGear, crankOilBoss);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU;
      const tooth = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.028, 0.042, 0.155)), steelMat);
      tooth.position.set(Math.cos(a) * 0.215, Math.sin(a) * 0.215, 0);
      tooth.rotation.z = a;
      this.oilCrankGearSpin.add(tooth);
    }
    this.oilPumpSystemGroup.add(this.oilCrankGearSpin);

    // 2. Combined Oil & Vacuum Pump housing + toothed drive wheel below crankshaft (S514_009 geometry!)
    const pumpPos = { x: 0.28, y: -0.68 };
    const pumpHousing = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.52, 0.38, 0.38)),
      aluMat
    );
    pumpHousing.position.set(pumpPos.x - 0.18, pumpPos.y, -0.22);
    const suctionPipe = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.075, 0.115, 0.38, 14)),
      steelMat
    );
    suctionPipe.rotation.z = 0.68;
    suctionPipe.position.set(pumpPos.x - 0.42, pumpPos.y - 0.18, -0.14);
    // N428 oil pressure regulation valve detail above sump
    const n428Valve = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.062, 0.062, 0.22, 12)),
      this.trackMat(new THREE.MeshStandardMaterial({ color: 0x0ea5e9, metalness: 0.48, roughness: 0.30 }))
    );
    n428Valve.rotation.z = Math.PI / 2;
    n428Valve.position.set(-0.36, -0.20, -0.02);
    this.oilPumpSystemGroup.add(pumpHousing, suctionPipe, n428Valve);

    this.oilPumpWheelSpin.position.set(pumpPos.x, pumpPos.y, 0);
    const pumpWheel = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.24, 0.24, 0.16, 24)),
      steelMat
    );
    pumpWheel.rotation.x = Math.PI / 2;
    const pumpCenter = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.09, 0.09, 0.20, 6)),
      aluMat
    );
    pumpCenter.rotation.x = Math.PI / 2;
    this.oilPumpWheelSpin.add(pumpWheel, pumpCenter);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU;
      const tooth = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.028, 0.042, 0.155)), steelMat);
      tooth.position.set(Math.cos(a) * 0.245, Math.sin(a) * 0.245, 0);
      tooth.rotation.z = a;
      this.oilPumpWheelSpin.add(tooth);
    }
    this.oilPumpSystemGroup.add(this.oilPumpWheelSpin);

    // 3. Short black toothed oil-bath belt running directly in oil (fixed center distance — NO tensioner!)
    const beltPts = [
      new THREE.Vector3(-0.23, 0.04, 0),
      new THREE.Vector3(0.0, 0.24, 0),
      new THREE.Vector3(0.22, 0.05, 0),
      new THREE.Vector3(pumpPos.x + 0.26, pumpPos.y + 0.02, 0),
      new THREE.Vector3(pumpPos.x + 0.04, pumpPos.y - 0.26, 0),
      new THREE.Vector3(pumpPos.x - 0.24, pumpPos.y - 0.06, 0),
    ];
    const beltCurve = new THREE.CatmullRomCurve3(beltPts, true, 'catmullrom', 0.22);
    const beltBand = new THREE.Mesh(
      this.trackGeo(new THREE.TubeGeometry(beltCurve, 56, 0.032, 8, true)),
      oilBeltMat
    );
    beltBand.scale.set(1, 1, 2.3);
    this.oilPumpSystemGroup.add(beltBand);

    // Instanced teeth around the wet oil-pump belt
    const toothCount = 34;
    const teethInstanced = new THREE.InstancedMesh(
      this.trackGeo(new THREE.BoxGeometry(0.038, 0.024, 0.145)),
      oilBeltMat,
      toothCount
    );
    teethInstanced.frustumCulled = false;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < toothCount; i++) {
      const u = i / toothCount;
      const pt = beltCurve.getPointAt(u);
      const tan = beltCurve.getTangentAt(u);
      dummy.position.copy(pt);
      dummy.rotation.set(0, 0, Math.atan2(tan.y, tan.x));
      dummy.updateMatrix();
      teethInstanced.setMatrixAt(i, dummy.matrix);
    }
    teethInstanced.instanceMatrix.needsUpdate = true;
    this.oilPumpSystemGroup.add(teethInstanced);

    // Clickable hotspot in isolated oil-sump cutaway view (`oilPumpBelt`)
    const oilHit = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(1.10, 1.28, 0.34)),
      this.trackMat(
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false })
      )
    );
    oilHit.position.set(0.14, -0.34, 0.14);
    this.oilBeltHitGroup.add(oilHit);
    tagInteractable(this.oilBeltHitGroup, 'oilPumpBelt');
    this.oilPumpSystemGroup.add(this.oilBeltHitGroup);

    // Assign entire oil-sump cutaway diorama exclusively to OIL_CUTAWAY_LAYER!
    this.oilPumpSystemGroup.traverse((obj) => {
      obj.layers.set(OIL_CUTAWAY_LAYER);
    });

    this.setOilSumpCutaway(false);
    return { beltCurve, teethInstanced };
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

  public setUpperTimingCoverRemoved(removed: boolean, instant = false): void {
    this.upperCoverTarget = removed ? 1 : 0;
    this.upperCoverGroup.userData.ignoreRaycast = removed;
    if (instant) {
      this.upperCoverProgress = this.upperCoverTarget;
      this.applyUpperCoverTransform();
    }
  }

  public setUpperTimingCoverSlotVisible(visible: boolean): void {
    this.upperCoverSlotGroup.visible = visible;
  }

  public setLowerCoverBoltRemoved(removed: boolean, instant = false): void {
    this.lowerCoverBoltTarget = removed ? 1 : 0;
    this.lowerCoverBoltGroup.userData.ignoreRaycast = removed;
    if (instant) {
      this.lowerCoverBoltProgress = this.lowerCoverBoltTarget;
      this.applyLowerCoverBoltTransform();
    }
  }

  public setLowerTimingCoverRemoved(removed: boolean, instant = false): void {
    this.lowerCoverTarget = removed ? 1 : 0;
    this.lowerCoverGroup.userData.ignoreRaycast = removed;
    if (instant) {
      this.lowerCoverProgress = this.lowerCoverTarget;
      this.applyLowerCoverTransform();
    }
  }

  public setLowerTimingCoverSlotVisible(visible: boolean): void {
    this.lowerCoverSlotGroup.visible = visible;
  }

  public setEngineSupportRemoved(removed: boolean, instant = false): void {
    this.engineSupportTarget = removed ? 1 : 0;
    this.engineSupportGroup.userData.ignoreRaycast = removed;
    if (instant) {
      this.engineSupportProgress = this.engineSupportTarget;
      this.applyEngineSupportTransform();
    }
  }

  public setEngineSupportSlotVisible(visible: boolean): void {
    this.engineSupportSlotGroup.visible = visible;
  }

  public setCrankDamperRemoved(removed: boolean, instant = false): void {
    this.crankDamperTarget = removed ? 1 : 0;
    this.crankDamperGroup.userData.ignoreRaycast = removed;
    if (instant) {
      this.crankDamperProgress = this.crankDamperTarget;
      this.applyCrankDamperTransform();
    }
  }

  public setCrankDamperSlotVisible(visible: boolean): void {
    this.crankDamperSlotGroup.visible = visible;
  }

  public setAuxTensionerState(swingDeg: number, pinned: boolean): void {
    this.auxTensionerSwingDeg = swingDeg;
    this.auxPinned = pinned;
    this.applyAuxDriveVisuals();
  }

  public setAuxBeltRemoved(removed: boolean, showSlot = false): void {
    this.auxBeltRemoved = removed;
    this.auxBeltGroup.visible = !removed;
    this.auxBeltGroup.userData.ignoreRaycast = removed;
    this.auxBeltSlotGroup.visible = removed && showSlot;
  }

  public setOilSumpCutaway(active: boolean): void {
    this.oilSumpCutawayActive = active;
    this.oilPumpSystemGroup.visible = active;
    this.oilSumpWallMat.transparent = active;
    this.oilSumpWallMat.opacity = active ? 0.16 : 0.96;
    this.oilSumpWallMat.depthWrite = !active;
    this.oilSumpWallMat.color.setHex(active ? 0x38bdf8 : 0x222730);
    this.oilBeltHitGroup.visible = active;
    this.oilBeltHitGroup.userData.ignoreRaycast = !active;
  }

  public getOilSumpCutawayRoot(): THREE.Group {
    return this.oilPumpSystemGroup;
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

  public setTensionerPinnedTypeB(pinned: boolean): void {
    this.tensionerPinnedTypeB = pinned;
    this.tensionerLockPinGroup.visible = pinned;
    this.tensionerLockPinGroup.userData.ignoreRaycast = !pinned;
  }

  public isTensionerPinnedTypeB(): boolean {
    return this.tensionerPinnedTypeB;
  }

  public setHubSprocketSlackOffset(camOffsetDeg: number, pumpOffsetDeg: number): void {
    this.camSprocketSlackOffsetRad = (camOffsetDeg * Math.PI) / 180;
    this.pumpSprocketSlackOffsetRad = (pumpOffsetDeg * Math.PI) / 180;
    this.applyTimingVisuals();
  }

  public setLockedShafts(shafts: readonly LockableWheelId[]): void {
    this.lockedShafts = new Set(shafts);
    for (const [id, pin] of this.lockPinGroups) {
      const vis = this.lockedShafts.has(id);
      pin.visible = vis;
      pin.userData.ignoreRaycast = !vis;
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

  public setRoutingStations(stations: readonly VwBeltLayStationId[]): void {
    this.routingStations = [...stations];
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

  public triggerManualCrank720(endDeg = 720, onDone?: () => void, duration = 1.25): void {
    const start = this.crankAngleDeg;
    const total = endDeg === 720 ? 720 : 708; // "2 turns to just before OT" -> 708°!
    this.manualCrankAnim = {
      active: true,
      elapsed: 0,
      duration,
      startDeg: start,
      totalDeg: total,
      endDeg,
      onDone,
    };
  }

  public isManualCrankAnimating(): boolean {
    return this.manualCrankAnim.active;
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
   * of an analytical straight timing-belt span (`sections[sectionIndex]`).
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

    const nextUpper = this.stepProgress(this.upperCoverProgress, this.upperCoverTarget, safeDt, 2.5);
    if (nextUpper !== null) {
      this.upperCoverProgress = nextUpper;
      this.applyUpperCoverTransform();
    }

    const nextLower = this.stepProgress(this.lowerCoverProgress, this.lowerCoverTarget, safeDt, 2.4);
    if (nextLower !== null) {
      this.lowerCoverProgress = nextLower;
      this.applyLowerCoverTransform();
    }

    const nextLowerBolt = this.stepProgress(this.lowerCoverBoltProgress, this.lowerCoverBoltTarget, safeDt, 4.4);
    if (nextLowerBolt !== null) {
      this.lowerCoverBoltProgress = nextLowerBolt;
      this.applyLowerCoverBoltTransform();
    }

    const nextSupport = this.stepProgress(this.engineSupportProgress, this.engineSupportTarget, safeDt, 2.3);
    if (nextSupport !== null) {
      this.engineSupportProgress = nextSupport;
      this.applyEngineSupportTransform();
    }

    const nextDamper = this.stepProgress(this.crankDamperProgress, this.crankDamperTarget, safeDt, 2.5);
    if (nextDamper !== null) {
      this.crankDamperProgress = nextDamper;
      this.applyCrankDamperTransform();
    }

    if (this.beltState === 'routing') {
      this.guideCyanMat.opacity = 0.42 + 0.24 * Math.sin(this.animClock * 4.5);
    }
    this.ghostCyanMat.opacity = 0.24 + 0.14 * Math.sin(this.animClock * 4.2);

    if (this.engineRunning) {
      const degPerSec = 340;
      this.crankAngleDeg += degPerSec * safeDt;
      this.applyTimingVisuals();

      // Rotate auxiliary pulleys cleanly during diesel idle
      if (!this.auxBeltRemoved) {
        const auxRad = ((degPerSec * safeDt) * Math.PI) / 180;
        this.crankDamperSpin.rotation.z -= auxRad;
        this.auxAlternatorSpin.rotation.z -= auxRad * 1.85;
        this.auxAcSpin.rotation.z -= auxRad * 1.2;
        this.auxTensionerRollerSpin.rotation.z += auxRad * 2.1;
      }

      const fireFreq = (this.engineRpm / 60) * 2 * Math.PI * 2;
      const vib = 0.0004;
      this.engineCoreGroup.position.set(
        Math.sin(this.animClock * fireFreq * 1.1) * vib * 0.6,
        Math.sin(this.animClock * fireFreq) * vib,
        Math.cos(this.animClock * fireFreq * 0.5) * vib * 0.5
      );
      this.engineCoreGroup.rotation.z = Math.sin(this.animClock * fireFreq) * 0.0009;
    }

    if (this.manualCrankAnim.active) {
      this.manualCrankAnim.elapsed += safeDt;
      const t = Math.min(1, this.manualCrankAnim.elapsed / this.manualCrankAnim.duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.crankAngleDeg = this.manualCrankAnim.startDeg + this.manualCrankAnim.totalDeg * eased;
      this.applyTimingVisuals();

      if (t >= 1) {
        this.crankAngleDeg = this.manualCrankAnim.endDeg;
        this.manualCrankAnim.active = false;
        this.applyTimingVisuals();
        const cb = this.manualCrankAnim.onDone;
        this.manualCrankAnim.onDone = undefined;
        cb?.();
      }
    }

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
      this.upperCoverGroup,
      this.upperCoverSlotGroup,
      this.lowerCoverGroup,
      this.lowerCoverSlotGroup,
      this.lowerCoverBoltGroup,
      this.engineSupportGroup,
      this.engineSupportSlotGroup,
      this.crankDamperGroup,
      this.crankDamperSlotGroup,
      this.auxTensionerArmPivot,
      this.auxBeltGroup,
      this.auxBeltSlotGroup,
      this.tensionerNutGroup,
      this.camCenterBoltGroup,
      this.camFixBoltGroup,
      this.pumpCenterNutGroup,
    ];

    if (this.auxLockPinGroup.visible) list.push(this.auxLockPinGroup);
    if (this.tensionerLockPinGroup.visible) list.push(this.tensionerLockPinGroup);
    if (this.oilSumpCutawayActive) list.push(this.oilBeltHitGroup);

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
      case 'upperTimingCover':
      case 'upperTimingCoverSlot':
        return this.timingDriveRoot.localToWorld(new THREE.Vector3(0.10, 1.15, 0.28));
      case 'lowerTimingCover':
      case 'lowerTimingCoverSlot':
        return this.timingDriveRoot.localToWorld(new THREE.Vector3(0.04, -0.55, 0.28));
      case 'lowerCoverBolt':
        this.lowerCoverBoltGroup.getWorldPosition(out);
        return out;
      case 'engineSupport':
      case 'engineSupportSlot':
        return this.timingDriveRoot.localToWorld(new THREE.Vector3(-0.04, 0.36, 0.44));
      case 'crankDamper':
        this.crankDamperGroup.getWorldPosition(out);
        out.x += 0.025;
        return out;
      case 'crankDamperSlot':
        this.crankDamperSlotGroup.getWorldPosition(out);
        out.x += 0.025;
        return out;
      case 'auxTensioner':
        this.auxTensionerArmPivot.getWorldPosition(out);
        out.x += 0.022;
        return out;
      case 'auxLockPin':
        this.auxLockPinGroup.getWorldPosition(out);
        out.x += 0.02;
        return out;
      case 'auxBelt':
      case 'auxBeltSlot': {
        const pt = (this.auxBeltGroup.userData.anchorLocal as THREE.Vector3 | undefined)?.clone()
          ?? new THREE.Vector3(0.45, -0.60, 0.43);
        return this.timingDriveRoot.localToWorld(pt);
      }
      case 'oilPumpBelt':
        return this.timingDriveRoot.localToWorld(new THREE.Vector3(0.14, -1.60, -0.42));
      case 'oldTimingBelt':
        return this.getBeltSpanFrontWorldPos(5, 0.5);
      case 'newTimingBeltSlot': {
        const lastStation = this.routingStations[this.routingStations.length - 1];
        const secIdx = lastStation ? VW_STATION_TO_SECTION_END[lastStation] : 5;
        return this.getBeltSpanFrontWorldPos(secIdx, 0.5);
      }
      case 'tensionerNut':
        this.tensionerNutGroup.getWorldPosition(out);
        out.x += 0.015;
        return out;
      case 'tensionerLockPin':
        this.tensionerLockPinGroup.getWorldPosition(out);
        out.x += 0.020;
        return out;
      case 'camCenterBolt':
        this.camCenterBoltGroup.getWorldPosition(out);
        out.x += 0.018;
        return out;
      case 'camFixBolt':
        this.camFixBoltGroup.getWorldPosition(out);
        out.x += 0.018;
        return out;
      case 'pumpCenterNut':
        this.pumpCenterNutGroup.getWorldPosition(out);
        out.x += 0.018;
        return out;
      case 'lockPin_crank':
      case 'lockPin_cam':
      case 'lockPin_pump': {
        const lid = id.replace('lockPin_', '') as LockableWheelId;
        const pin = this.lockPinGroups.get(lid);
        if (!pin) return null;
        pin.getWorldPosition(out);
        out.x += 0.028;
        return out;
      }
      case 'wheel_cam': {
        const w = wheels.find((wh) => wh.id === 'cam')!;
        // Anchor directly on the lower-left locking fork / outer sprocket rim (clear of camCenterBolt & camFixBolt)
        return this.timingDriveRoot.localToWorld(new THREE.Vector3(w.x - 0.34, w.y - 0.30, 0.14));
      }
      case 'wheel_pump': {
        const w = wheels.find((wh) => wh.id === 'pump')!;
        // Anchor on the left locking fork / outer sprocket rim (clear of pumpCenterNut)
        return this.timingDriveRoot.localToWorld(new THREE.Vector3(w.x - 0.24, w.y - 0.08, 0.14));
      }
      case 'wheel_tensioner': {
        const w = wheels.find((wh) => wh.id === 'tensioner')!;
        // Anchor on the outer roller rim clear of tensionerNut & T10265 pin
        return this.timingDriveRoot.localToWorld(new THREE.Vector3(w.x - 0.16, w.y + 0.12, 0.13));
      }
      case 'wheel_crank': {
        const w = wheels.find((wh) => wh.id === 'crank')!;
        // Anchor on upper-left gear teeth clear of T10490 stop
        return this.timingDriveRoot.localToWorld(new THREE.Vector3(w.x - 0.12, w.y + 0.16, 0.13));
      }
      case 'wheel_lower':
      case 'wheel_upper':
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

      if (asm.outerRimGroup) {
        asm.outerRimGroup.rotation.z =
          id === 'cam' ? this.camSprocketSlackOffsetRad : this.pumpSprocketSlackOffsetRad;
      }

      if (asm.fixedPointer) {
        asm.fixedPointer.material = otOk ? this.otEmeraldMat : this.otAmberMat;
      }
      for (const m of asm.rotatingMarkMeshes) {
        m.material = otOk ? this.otEmeraldMat : this.otAmberMat;
      }
    }

    // Rotate separate oil-pump wet belt sprockets & toothed belt synchronously with crankshaft!
    const crankRad = -(this.crankAngleDeg * Math.PI) / 180;
    this.oilCrankGearSpin.rotation.z = crankRad;
    this.oilPumpWheelSpin.rotation.z = crankRad * (0.21 / 0.24);
    const oilBeltPhase = (((this.crankAngleDeg / 360) * 0.56) % 1 + 1) % 1;
    const oilToothCount = this.oilBeltTeeth.count;
    for (let i = 0; i < oilToothCount; i++) {
      const u = (i / oilToothCount + oilBeltPhase) % 1;
      const pt = this.oilBeltCurve.getPointAt(u);
      const tan = this.oilBeltCurve.getTangentAt(u);
      this.poseObj.position.copy(pt);
      this.poseObj.rotation.set(0, 0, Math.atan2(tan.y, tan.x));
      this.poseObj.updateMatrix();
      this.oilBeltTeeth.setMatrixAt(i, this.poseObj.matrix);
    }
    this.oilBeltTeeth.instanceMatrix.needsUpdate = true;

    // 2. Update eccentric tensioner needle angle & emerald alignment state
    this.gaugePivot.rotation.z = (0.5 - this.tensionNormalized) * 1.9;
    const tensionAligned = Math.abs(this.tensionNormalized - 0.5) <= 0.04;
    this.gaugeNeedleMesh.material = tensionAligned ? this.otEmeraldMat : this.otAmberMat;

    // 3. Update belt visibility, VW 5-station progressive routing span, tooth meshing, and cyan guide dashes
    const hasFullBelt =
      this.beltState === 'old' ||
      this.beltState === 'new_slack' ||
      this.beltState === 'new_tensioned';
    const lastStation =
      this.beltState === 'routing' && this.routingStations.length > 0
        ? this.routingStations[this.routingStations.length - 1]
        : null;
    const coveredLength = hasFullBelt
      ? loopLength
      : lastStation
        ? sections[VW_STATION_TO_SECTION_END[lastStation]].end
        : 0;
    const fraction = coveredLength / loopLength;
    const isPartial = fraction > 0 && fraction < 0.999;

    this.beltGroup.visible = fraction > 0;
    this.newBeltSlotHitMesh.visible = this.beltState === 'routing';

    const vwOrder: VwBeltLayStationId[] = ['crank', 'tensioner', 'cam', 'pump', 'water'];
    const nextStationId =
      this.beltState === 'routing' && this.routingStations.length < vwOrder.length
        ? vwOrder[this.routingStations.length]
        : null;
    const showRoutingGuides = nextStationId !== null;
    this.guideDashes.visible = showRoutingGuides;
    this.targetRing.visible = showRoutingGuides;

    if (showRoutingGuides && nextStationId) {
      const remainingStart = coveredLength;
      const remainingLen = Math.max(0.01, loopLength - remainingStart);
      const count = Math.min(54, Math.max(8, Math.round(remainingLen / 0.20)));
      this.guideDashes.count = count;
      for (let i = 0; i < count; i++) {
        const sd = remainingStart + ((i + 0.5) / count) * remainingLen;
        this.placeBeltInstance(this.guideDashes, i, sd, BELT_THICK * 0.5, BELT_FRONT_Z + 0.018);
      }
      this.guideDashes.instanceMatrix.needsUpdate = true;

      const nextWheel = wheels.find((w) => w.id === nextStationId)!;
      this.targetRing.position.set(nextWheel.x, nextWheel.y, 0.20);
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

  private applyAuxDriveVisuals(): void {
    // Swinging spring-arm CCW relieves belt tension so T10060 A slides into bore
    this.auxTensionerArmPivot.rotation.z = (this.auxTensionerSwingDeg * Math.PI) / 180;
    this.auxLockPinGroup.visible = this.auxPinned;
    this.auxLockPinGroup.userData.ignoreRaycast = !this.auxPinned;
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

  private applyUpperCoverTransform(): void {
    const t = this.upperCoverProgress;
    if (t >= 0.999) {
      this.upperCoverGroup.visible = false;
      return;
    }
    this.upperCoverGroup.visible = true;
    const pullT = Math.min(1, t / 0.62);
    const fadeT = Math.max(0, (t - 0.62) / 0.38);
    const e = this.easeInOut(pullT);
    this.upperCoverGroup.position.set(0, e * 1.15, 0.165 + e * 0.55);
    this.upperCoverGroup.rotation.set(-e * 0.12, 0, 0);
    const alpha = 1 - fadeT;
    for (const m of this.upperCoverMaterials) {
      m.transparent = alpha < 0.99;
      m.opacity = alpha;
      m.depthWrite = alpha >= 0.99;
    }
  }

  private applyLowerCoverTransform(): void {
    const t = this.lowerCoverProgress;
    if (t >= 0.999) {
      this.lowerCoverGroup.visible = false;
      return;
    }
    this.lowerCoverGroup.visible = true;
    const pullT = Math.min(1, t / 0.62);
    const fadeT = Math.max(0, (t - 0.62) / 0.38);
    const e = this.easeInOut(pullT);
    this.lowerCoverGroup.position.set(0, -e * 0.45, 0.165 + e * 1.25);
    const alpha = 1 - fadeT;
    for (const m of this.lowerCoverMaterials) {
      m.transparent = alpha < 0.99;
      m.opacity = alpha;
      m.depthWrite = alpha >= 0.99;
    }
  }

  private applyLowerCoverBoltTransform(): void {
    const t = this.lowerCoverBoltProgress;
    if (t >= 0.999) {
      this.lowerCoverBoltGroup.visible = false;
      return;
    }
    this.lowerCoverBoltGroup.visible = true;
    const slideT = Math.min(1, t / 0.72);
    const fadeT = Math.max(0, (t - 0.72) / 0.28);
    const e = this.easeInOut(slideT);
    this.lowerCoverBoltGroup.position.set(0.28, -0.82, 0.285 + e * 0.58);
    this.lowerCoverBoltSpin.rotation.z = -e * 16;
    const alpha = 1 - fadeT;
    for (const m of this.lowerCoverBoltMaterials) {
      m.transparent = alpha < 0.99;
      m.opacity = alpha;
      m.depthWrite = alpha >= 0.99;
    }
  }

  private applyEngineSupportTransform(): void {
    const t = this.engineSupportProgress;
    if (t >= 0.999) {
      this.engineSupportGroup.visible = false;
      return;
    }
    this.engineSupportGroup.visible = true;
    const pullT = Math.min(1, t / 0.65);
    const fadeT = Math.max(0, (t - 0.65) / 0.35);
    const e = this.easeInOut(pullT);
    this.engineSupportGroup.position.set(0, e * 1.35, e * 0.75);
    const alpha = 1 - fadeT;
    for (const m of this.engineSupportMaterials) {
      m.transparent = alpha < 0.99;
      m.opacity = alpha;
      m.depthWrite = alpha >= 0.99;
    }
  }

  private applyCrankDamperTransform(): void {
    const cw = wheels.find((w) => w.id === 'crank')!;
    const t = this.crankDamperProgress;
    if (t >= 0.999) {
      this.crankDamperGroup.visible = false;
      return;
    }
    this.crankDamperGroup.visible = true;
    const pullT = Math.min(1, t / 0.65);
    const fadeT = Math.max(0, (t - 0.65) / 0.35);
    const e = this.easeInOut(pullT);
    this.crankDamperGroup.position.set(cw.x, cw.y - e * 0.22, 0.42 + e * 1.35);
    const alpha = 1 - fadeT;
    for (const m of this.crankDamperMaterials) {
      m.transparent = alpha < 0.99;
      m.opacity = alpha;
      m.depthWrite = alpha >= 0.99;
    }
  }
}
