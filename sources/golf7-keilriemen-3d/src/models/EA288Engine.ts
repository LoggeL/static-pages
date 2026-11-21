import * as THREE from 'three';
import {
  clearVisualChildren,
  extractNode,
  loadGLB,
  tagSubtreeInteractable,
} from '../engine/AssetLoader';
import type { BeltPulleyNode, InteractableId } from '../types';

export type BeltVisualState = 'old' | 'none' | 'routing' | 'new_slack' | 'new_tensioned';
export type TensionerVisualState = 'old' | 'removed' | 'new';

interface PulleySpec {
  id: BeltPulleyNode;
  u: number;
  v: number;
  radius: number;
  wrapDir: 1 | -1;
}

interface TangentResult {
  a1: number;
  a2: number;
}

interface PathSample {
  u: number;
  v: number;
  tu: number;
  tv: number;
  nu: number;
  nv: number;
  arcLen: number;
}

interface BuiltPath {
  samples: PathSample[];
  totalLen: number;
  spanRanges: { startIdx: number; endIdx: number }[];
  arcRanges: { startIdx: number; endIdx: number }[];
}

const DRIVE_PLANE_X = 0.44;
const DRIVE_CENTER_Y = 0.45;
const DRIVE_CENTER_Z = -1.32;

const BELT_WIDTH = 0.0214;
const BELT_THICKNESS = 0.005;
const HALF_THICKNESS = BELT_THICKNESS * 0.5;

const TENSIONER_PIVOT = { u: 0.059, v: 0.095 };
const TENSIONER_ARM_LEN = 0.085;
const THETA_TIGHT = (-125 * Math.PI) / 180;
const THETA_LOOSE = (-160 * Math.PI) / 180;

// Local polar placement of arm features relative to pivot P & arm direction theta
const HEX_ARM_RADIUS = 0.066;
const HEX_ARM_OFFSET_ANGLE = (-12 * Math.PI) / 180;
const PIN_ARM_RADIUS = 0.042;
const PIN_ARM_OFFSET_ANGLE = (-35 * Math.PI) / 180;
const PIN_STATIONARY_WORLD_ANGLE = THETA_LOOSE + PIN_ARM_OFFSET_ANGLE; // -195 deg (+165 deg)

const PULLEY_SPECS: Record<BeltPulleyNode, PulleySpec> = {
  crank: { id: 'crank', u: -0.05, v: -0.11, radius: 0.08, wrapDir: 1 },
  ac: { id: 'ac', u: 0.165, v: -0.095, radius: 0.062, wrapDir: 1 },
  alternator: { id: 'alternator', u: 0.125, v: 0.135, radius: 0.036, wrapDir: 1 },
  tensioner: {
    id: 'tensioner',
    u: TENSIONER_PIVOT.u + TENSIONER_ARM_LEN * Math.cos(THETA_TIGHT),
    v: TENSIONER_PIVOT.v + TENSIONER_ARM_LEN * Math.sin(THETA_TIGHT),
    radius: 0.034,
    wrapDir: -1,
  },
};

const LOOP_ORDER: BeltPulleyNode[] = ['crank', 'ac', 'alternator', 'tensioner'];

function uvToLocal(u: number, v: number, xOffset = 0): THREE.Vector3 {
  return new THREE.Vector3(DRIVE_PLANE_X + xOffset, DRIVE_CENTER_Y + v, DRIVE_CENTER_Z - u);
}

function tagInteractable(root: THREE.Object3D, id: InteractableId): void {
  root.userData.interactableId = id;
  root.traverse((child) => {
    child.userData.interactableId = id;
  });
}

function solveTangent(
  c1: { u: number; v: number; r: number; dir: 1 | -1 },
  c2: { u: number; v: number; r: number; dir: 1 | -1 }
): TangentResult {
  const dx = c2.u - c1.u;
  const dv = c2.v - c1.v;
  const d = Math.max(1e-5, Math.hypot(dx, dv));
  const base = Math.atan2(dv, dx);

  if (c1.dir === c2.dir) {
    const ratio = Math.max(-0.999, Math.min(0.999, (c1.r - c2.r) / d));
    const alpha = base - c1.dir * (Math.PI / 2 - Math.asin(ratio));
    return { a1: alpha, a2: alpha };
  }

  const ratio = Math.max(-0.999, Math.min(0.999, (c1.r + c2.r) / d));
  const a1 = base - c1.dir * Math.acos(ratio);
  const a2 = a1 + Math.PI;
  return { a1, a2 };
}

function normalizeArcSweep(startAngle: number, endAngle: number, dir: 1 | -1): number {
  const TWO_PI = Math.PI * 2;
  if (dir === 1) {
    return (((endAngle - startAngle) % TWO_PI) + TWO_PI) % TWO_PI;
  }
  return -((((startAngle - endAngle) % TWO_PI) + TWO_PI) % TWO_PI);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function createCastAluminumTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#9aa2ab';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4200; i++) {
      const x = (i * 73) % 256;
      const y = (i * 137 + Math.floor(i / 256) * 29) % 256;
      const shade = 132 + ((i * 19) % 44);
      ctx.fillStyle = `rgb(${shade},${shade + 3},${shade + 7})`;
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.strokeStyle = 'rgba(65,72,80,0.16)';
    ctx.lineWidth = 1;
    for (let y = 8; y < 256; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(256, y);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createHeatShieldTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#aeb6bf';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 8; y < 256; y += 16) {
      for (let x = 8; x < 256; x += 16) {
        const offsetX = (y / 16) % 2 === 0 ? 0 : 8;
        const grad = ctx.createRadialGradient(x + offsetX - 1, y - 1, 1, x + offsetX, y, 6);
        grad.addColorStop(0, '#eef2f6');
        grad.addColorStop(0.55, '#9ea7b0');
        grad.addColorStop(1, '#7c858e');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x + offsetX, y, 5.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createNewBeltTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#181a1f';
    ctx.fillRect(0, 0, 1024, 256);

    // Subtle fabric cord backing grain along belt circumference
    for (let y = 0; y < 256; y += 4) {
      ctx.fillStyle = y % 8 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, y, 1024, 2);
    }

    // Diagonal ply weave hint
    ctx.strokeStyle = 'rgba(55,62,72,0.22)';
    ctx.lineWidth = 1;
    for (let x = -256; x < 1280; x += 14) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 64, 256);
      ctx.stroke();
    }

    // Crisp OEM Continental 6PK1025 markings along smooth outer back
    ctx.fillStyle = '#e5e7eb';
    ctx.font = 'bold 26px monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText('CONTITECH  6PK1025   ▶   04L 260 849 G   ▶', 36, 98);
    ctx.fillText('CONTITECH  6PK1025   ▶   04L 260 849 G   ▶', 548, 98);

    ctx.fillStyle = '#9ca3af';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('VW AG  •  EA288 1.6 TDI  •  EPDM', 86, 152);
    ctx.fillText('VW AG  •  EA288 1.6 TDI  •  EPDM', 598, 152);

    // Bright rib-side guide stripes for crisp rotation perception
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(220, 42, 16, 14);
    ctx.fillRect(732, 42, 16, 14);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function createOldBeltTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#292420';
    ctx.fillRect(0, 0, 1024, 256);

    // Dry dust and brownish glazing
    for (let i = 0; i < 60; i++) {
      const x = (i * 97) % 1024;
      const y = (i * 53) % 256;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(92,76,60,0.22)' : 'rgba(20,18,16,0.35)';
      ctx.fillRect(x, y, 48, 18);
    }

    // Faded markings
    ctx.fillStyle = 'rgba(170,162,150,0.28)';
    ctx.font = 'bold 24px monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText('...6PK1025...  04L 260 ...', 60, 110);
    ctx.fillText('...6PK1025...  04L 260 ...', 580, 110);

    // Transverse fatigue cracks across rubber
    ctx.strokeStyle = '#120f0d';
    ctx.lineWidth = 2.5;
    for (let x = 24; x < 1024; x += 38) {
      ctx.beginPath();
      ctx.moveTo(x, 12);
      ctx.lineTo(x + ((x % 3) - 1) * 5, 244);
      ctx.stroke();
    }

    // Frayed border threads
    ctx.fillStyle = '#4e4236';
    for (let x = 0; x < 1024; x += 18) {
      ctx.fillRect(x, 0, 8, 9);
      ctx.fillRect(x + 7, 246, 9, 10);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createBatteryLabelTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#14171c';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(10, 12, 236, 30);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('VARTA AGM  12V 68Ah', 22, 33);
    ctx.fillStyle = '#d1d5db';
    ctx.font = '14px monospace';
    ctx.fillText('680A (EN)  •  VW 000 915 105', 18, 72);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(18, 92, 62, 20);
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('EFB / AGM', 22, 106);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Complete VW Golf 7 1.6 TDI (EA288) engine bay, analytical 6PK1025 serpentine
 * belt generator, and interactive auxiliary drive assembly.
 */
export class EA288Engine {
  public readonly group: THREE.Group;

  // Dynamic engine sub-group for subtle diesel idle vibration
  private readonly engineCoreGroup: THREE.Group;
  private readonly engineBayGroup: THREE.Group;

  // Pulley rotating groups (rotated around X axis; +X rotation = CCW in (u,v) plane)
  private readonly crankSpinGroup: THREE.Group;
  private readonly crankBoltGroup: THREE.Group;
  private readonly acMountGroup: THREE.Group;
  private readonly acSpinGroup: THREE.Group;
  private readonly alternatorMountGroup: THREE.Group;
  private readonly alternatorSpinGroup: THREE.Group;
  private readonly tensionerRollerSpinGroup: THREE.Group;

  // Tensioner assembly
  private readonly tensionerRootGroup: THREE.Group;
  private readonly tensionerHousingGroup: THREE.Group;
  private readonly tensionerArmGroup: THREE.Group;
  private readonly tensionerHexGroup: THREE.Group;
  private readonly tensionerPinHoleGroup: THREE.Group;
  private readonly tensionerStationaryHoleRing: THREE.Mesh;
  private readonly tensionerMovingHoleRing: THREE.Mesh;
  private readonly tensionerBoltGroup: THREE.Group;
  private readonly tensionerPinMesh: THREE.Group;
  private readonly tensionerMountSlotGroup: THREE.Group;

  // Belt & routing meshes
  private readonly oldBeltMesh: THREE.Mesh;
  private readonly newBeltMesh: THREE.Mesh;
  private readonly newBeltGhostMesh: THREE.Mesh;
  private readonly routingHighlightGroup: THREE.Group;

  // Textures & materials
  private readonly newBeltTexture: THREE.CanvasTexture;
  private readonly oldBeltTexture: THREE.CanvasTexture;
  private readonly oldTensionerMat: THREE.MeshStandardMaterial;
  private readonly newTensionerMat: THREE.MeshStandardMaterial;
  private readonly tensionerBoltMat: THREE.MeshStandardMaterial;
  private readonly tensionerRollerMat: THREE.MeshStandardMaterial;
  private readonly pinAlignedRingMat: THREE.MeshStandardMaterial;
  private readonly ghostSlotMat: THREE.MeshStandardMaterial;
  private readonly mountSlotMat: THREE.MeshStandardMaterial;

  // Blender tensioner material references for old/new visual swap
  private readonly blenderTensionerCastMats: THREE.MeshStandardMaterial[] = [];
  private readonly blenderTensionerRollerMats: THREE.MeshStandardMaterial[] = [];
  private readonly blenderTensionerBoltMats: THREE.MeshStandardMaterial[] = [];

  // Interactable root objects
  private readonly interactableCrank: THREE.Object3D;
  private readonly interactableCrankBolt: THREE.Object3D;
  private readonly interactableAc: THREE.Object3D;
  private readonly interactableAlternator: THREE.Object3D;
  private readonly interactableTensionerRoller: THREE.Object3D;
  private readonly interactableTensionerHex: THREE.Object3D;
  private readonly interactableTensionerPinHole: THREE.Object3D;
  private readonly interactableTensionerBolt: THREE.Object3D;
  private readonly interactableMountSlot: THREE.Object3D;
  private readonly interactableOldBelt: THREE.Object3D;
  private readonly interactableNewBeltSlot: THREE.Object3D;

  // State
  private beltState: BeltVisualState = 'old';
  private tensionerState: TensionerVisualState = 'old';
  private tensionerProgress = 0;
  private pinInserted = false;
  private routingNodes: BeltPulleyNode[] = [];

  private engineRunning = false;
  private engineRpm = 820;
  private currentBeltLength = 1.153;
  private beltTravelDistance = 0;

  // Temporary animations
  private manualCrankAnim: {
    active: boolean;
    elapsed: number;
    duration: number;
    totalAngle: number;
    lastAngle: number;
  } = { active: false, elapsed: 0, duration: 1.8, totalAngle: 0, lastAngle: 0 };

  private pulleySpinAnim: {
    active: boolean;
    pulley: 'alternator' | 'ac';
    elapsed: number;
    duration: number;
  } = { active: false, pulley: 'alternator', elapsed: 0, duration: 1.0 };

  private animClock = 0;
  private readonly disposableTextures: THREE.Texture[] = [];
  private readonly disposableGeometries: THREE.BufferGeometry[] = [];
  private readonly disposableMaterials: THREE.Material[] = [];

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'EA288Engine';

    this.engineCoreGroup = new THREE.Group();
    this.engineCoreGroup.name = 'EA288EngineCore';
    this.group.add(this.engineCoreGroup);

    this.engineBayGroup = new THREE.Group();
    this.engineBayGroup.name = 'EA288EngineBayVisuals';

    const castAluTex = createCastAluminumTexture();
    const heatShieldTex = createHeatShieldTexture();
    this.newBeltTexture = createNewBeltTexture();
    this.oldBeltTexture = createOldBeltTexture();
    const batteryLabelTex = createBatteryLabelTexture();
    this.disposableTextures.push(
      castAluTex,
      heatShieldTex,
      this.newBeltTexture,
      this.oldBeltTexture,
      batteryLabelTex
    );

    // Core shared-look materials (each interactable gets its own material instance)
    this.oldTensionerMat = new THREE.MeshStandardMaterial({
      color: 0x7e8389,
      map: castAluTex,
      metalness: 0.65,
      roughness: 0.56,
    });
    this.newTensionerMat = new THREE.MeshStandardMaterial({
      color: 0xd0d7e0,
      map: castAluTex,
      metalness: 0.78,
      roughness: 0.28,
    });
    this.tensionerBoltMat = new THREE.MeshStandardMaterial({
      color: 0x9fa8b2,
      metalness: 0.86,
      roughness: 0.28,
    });
    this.tensionerRollerMat = new THREE.MeshStandardMaterial({
      color: 0xc8d0da,
      metalness: 0.9,
      roughness: 0.2,
    });
    this.pinAlignedRingMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      emissive: 0x000000,
      metalness: 0.82,
      roughness: 0.28,
    });
    this.ghostSlotMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: 0x0891b2,
      emissiveIntensity: 0.65,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });
    this.mountSlotMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.75,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    this.disposableMaterials.push(
      this.oldTensionerMat,
      this.newTensionerMat,
      this.tensionerBoltMat,
      this.tensionerRollerMat,
      this.pinAlignedRingMat,
      this.ghostSlotMat,
      this.mountSlotMat
    );

    // 1. Build surrounding EA288 1.6 TDI engine bay hardware and isolate in engineBayGroup
    this.buildEngineBay(castAluTex, heatShieldTex, batteryLabelTex);
    while (this.engineCoreGroup.children.length > 0) {
      this.engineBayGroup.add(this.engineCoreGroup.children[0]);
    }
    this.engineCoreGroup.add(this.engineBayGroup);

    // 2. Build pulleys & crank bolt
    const crankResult = this.buildCrankPulley();
    this.crankSpinGroup = crankResult.spinGroup;
    this.crankBoltGroup = crankResult.boltGroup;
    this.interactableCrank = crankResult.pulleyHitRoot;
    this.interactableCrankBolt = crankResult.boltHitRoot;

    const acResult = this.buildAcPulley(castAluTex);
    this.acMountGroup = acResult.mountGroup;
    this.acSpinGroup = acResult.spinGroup;
    this.interactableAc = acResult.hitRoot;

    const altResult = this.buildAlternatorPulley(castAluTex);
    this.alternatorMountGroup = altResult.mountGroup;
    this.alternatorSpinGroup = altResult.spinGroup;
    this.interactableAlternator = altResult.hitRoot;

    // 3. Build Spannrolle 04L 903 315 + T10060A pin + Ghost mount slot
    const tensResult = this.buildTensionerAssembly();
    this.tensionerRootGroup = tensResult.rootGroup;
    this.tensionerHousingGroup = tensResult.housingGroup;
    this.tensionerArmGroup = tensResult.armGroup;
    this.tensionerRollerSpinGroup = tensResult.rollerSpinGroup;
    this.tensionerHexGroup = tensResult.hexGroup;
    this.tensionerPinHoleGroup = tensResult.pinHoleGroup;
    this.tensionerStationaryHoleRing = tensResult.stationaryHoleRing;
    this.tensionerMovingHoleRing = tensResult.movingHoleRing;
    this.tensionerBoltGroup = tensResult.boltGroup;
    this.tensionerPinMesh = tensResult.pinMesh;
    this.tensionerMountSlotGroup = tensResult.mountSlotGroup;

    this.interactableTensionerRoller = tensResult.rollerHitRoot;
    this.interactableTensionerHex = tensResult.hexHitRoot;
    this.interactableTensionerPinHole = tensResult.pinHoleHitRoot;
    this.interactableTensionerBolt = tensResult.boltHitRoot;
    this.interactableMountSlot = tensResult.mountSlotHitRoot;

    // 4. Build analytical 6PK1025 belt meshes + routing visualizer
    const oldBeltMat = new THREE.MeshStandardMaterial({
      map: this.oldBeltTexture,
      color: 0xd4cfc8,
      roughness: 0.88,
      metalness: 0.04,
    });
    const newBeltMat = new THREE.MeshStandardMaterial({
      map: this.newBeltTexture,
      color: 0xffffff,
      roughness: 0.56,
      metalness: 0.08,
    });
    this.disposableMaterials.push(oldBeltMat, newBeltMat);

    this.oldBeltMesh = new THREE.Mesh(new THREE.BufferGeometry(), oldBeltMat);
    this.oldBeltMesh.castShadow = true;
    this.oldBeltMesh.receiveShadow = true;
    tagInteractable(this.oldBeltMesh, 'oldBelt');
    this.interactableOldBelt = this.oldBeltMesh;

    this.newBeltMesh = new THREE.Mesh(new THREE.BufferGeometry(), newBeltMat);
    this.newBeltMesh.castShadow = true;
    this.newBeltMesh.receiveShadow = true;

    this.newBeltGhostMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.ghostSlotMat);
    tagInteractable(this.newBeltGhostMesh, 'newBeltSlot');
    this.interactableNewBeltSlot = this.newBeltGhostMesh;

    this.routingHighlightGroup = new THREE.Group();
    this.routingHighlightGroup.name = 'BeltRoutingHighlights';

    this.engineCoreGroup.add(
      this.oldBeltMesh,
      this.newBeltMesh,
      this.newBeltGhostMesh,
      this.routingHighlightGroup
    );

    // Initialize visual state
    this.applyTensionerTransform();
    this.rebuildBeltGeometries();
    this.syncVisibilityState();
  }

  private trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.disposableGeometries.push(g);
    return g;
  }

  private trackMat<T extends THREE.Material>(m: T): T {
    this.disposableMaterials.push(m);
    return m;
  }

  private buildEngineBay(
    castAluTex: THREE.CanvasTexture,
    heatShieldTex: THREE.CanvasTexture,
    batteryLabelTex: THREE.CanvasTexture
  ): void {
    const aluMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x9aa3ad,
        map: castAluTex,
        metalness: 0.72,
        roughness: 0.44,
      })
    );
    const darkCastMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x4b525c,
        map: castAluTex,
        metalness: 0.68,
        roughness: 0.58,
      })
    );
    const plasticMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x1b1e24,
        metalness: 0.08,
        roughness: 0.68,
      })
    );
    const matteRubberMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x15171b,
        metalness: 0.04,
        roughness: 0.85,
      })
    );
    const steelMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xc2cad3,
        metalness: 0.88,
        roughness: 0.26,
      })
    );
    const heatShieldMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xcbd2d9,
        map: heatShieldTex,
        metalness: 0.85,
        roughness: 0.34,
      })
    );

    // --- Engine Block & Sump (X in [-0.42, +0.42], Y in [0.22, 0.76], Z in [-1.62, -1.02]) ---
    const sump = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.68, 0.13, 0.36)), darkCastMat);
    sump.position.set(0.02, 0.285, -1.32);
    sump.castShadow = true;
    sump.receiveShadow = true;
    this.engineCoreGroup.add(sump);

    // Sump cooling fins
    for (let i = -3; i <= 3; i++) {
      const fin = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.64, 0.012, 0.014)),
        darkCastMat
      );
      fin.position.set(0.02, 0.222, -1.32 + i * 0.046);
      this.engineCoreGroup.add(fin);
    }

    const block = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.7, 0.25, 0.34)), darkCastMat);
    block.position.set(0.03, 0.45, -1.32);
    block.castShadow = true;
    block.receiveShadow = true;
    this.engineCoreGroup.add(block);

    // Cylinder head (cast aluminum)
    const cylHead = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.72, 0.13, 0.36)), aluMat);
    cylHead.position.set(0.03, 0.635, -1.32);
    cylHead.castShadow = true;
    this.engineCoreGroup.add(cylHead);

    // Valve cover / camshaft carrier (black glass-fiber polyamide)
    const valveCover = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.66, 0.058, 0.31)),
      plasticMat
    );
    valveCover.position.set(0.02, 0.725, -1.32);
    valveCover.castShadow = true;
    this.engineCoreGroup.add(valveCover);

    // Common-rail fuel rail & 4 injectors
    const fuelRail = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.016, 0.016, 0.52, 16)),
      steelMat
    );
    fuelRail.rotation.z = Math.PI / 2;
    fuelRail.position.set(0.03, 0.75, -1.41);
    this.engineCoreGroup.add(fuelRail);

    for (let i = 0; i < 4; i++) {
      const ix = -0.17 + i * 0.13;
      const injector = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.015, 0.015, 0.055, 12)),
        plasticMat
      );
      injector.position.set(ix, 0.752, -1.32);
      this.engineCoreGroup.add(injector);

      const line = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.004, 0.004, 0.095, 8)),
        steelMat
      );
      line.rotation.x = Math.PI / 2;
      line.position.set(ix, 0.754, -1.365);
      this.engineCoreGroup.add(line);
    }

    // Oil filler cap & yellow dipstick
    const oilCap = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.032, 0.032, 0.024, 18)),
      plasticMat
    );
    oilCap.position.set(-0.22, 0.76, -1.42);
    this.engineCoreGroup.add(oilCap);

    const yellowMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.45, metalness: 0.05 })
    );
    const dipstickRing = new THREE.Mesh(
      this.trackGeo(new THREE.TorusGeometry(0.016, 0.0045, 8, 20)),
      yellowMat
    );
    dipstickRing.position.set(-0.04, 0.735, -1.53);
    this.engineCoreGroup.add(dipstickRing);
    const dipstickTube = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.005, 0.005, 0.28, 10)),
      plasticMat
    );
    dipstickTube.position.set(-0.04, 0.58, -1.52);
    this.engineCoreGroup.add(dipstickTube);

    // Upper & lower timing-belt cover (right side of engine at X <= 0.422, right behind accessory plane!)
    const timingCoverBody = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.048, 0.37, 0.22)),
      plasticMat
    );
    timingCoverBody.position.set(0.398, 0.515, -1.32);
    timingCoverBody.castShadow = true;
    this.engineCoreGroup.add(timingCoverBody);

    const camGearBulge = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.088, 0.092, 0.048, 24)),
      plasticMat
    );
    camGearBulge.rotation.z = Math.PI / 2;
    camGearBulge.position.set(0.398, 0.67, -1.32);
    this.engineCoreGroup.add(camGearBulge);

    // Accessory bracket cast onto +X end of block supporting tensioner/alternator/AC
    const accessoryBracket = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.042, 0.34, 0.34)),
      aluMat
    );
    accessoryBracket.position.set(0.388, 0.48, -1.36);
    this.engineCoreGroup.add(accessoryBracket);

    // Dark intake manifold (front side of cylinder head, Z ~ -1.53)
    const intakePlenum = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.055, 0.055, 0.56, 16)),
      plasticMat
    );
    intakePlenum.rotation.z = Math.PI / 2;
    intakePlenum.position.set(0.02, 0.62, -1.54);
    this.engineCoreGroup.add(intakePlenum);
    for (let i = 0; i < 4; i++) {
      const runner = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.026, 0.028, 0.1, 12)),
        plasticMat
      );
      runner.rotation.x = Math.PI / 2.2;
      runner.position.set(-0.17 + i * 0.13, 0.63, -1.49);
      this.engineCoreGroup.add(runner);
    }

    // Turbocharger & DPF metallic heat shield (rear of block, Z ~ -1.10)
    const heatShield = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.11, 0.11, 0.42, 16, 1, false, 0, Math.PI)),
      heatShieldMat
    );
    heatShield.rotation.z = Math.PI / 2;
    heatShield.rotation.x = -Math.PI / 4;
    heatShield.position.set(0.02, 0.59, -1.10);
    this.engineCoreGroup.add(heatShield);

    const dpfCanister = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.082, 0.082, 0.28, 18)),
      steelMat
    );
    dpfCanister.rotation.x = 0.22;
    dpfCanister.position.set(0.08, 0.44, -1.07);
    this.engineCoreGroup.add(dpfCanister);

    // Gearbox housing (driver side X < -0.32)
    const gearbox = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.15, 0.13, 0.34, 18)),
      aluMat
    );
    gearbox.rotation.z = Math.PI / 2;
    gearbox.position.set(-0.46, 0.41, -1.32);
    gearbox.castShadow = true;
    this.engineCoreGroup.add(gearbox);

    // Pink G13 Coolant expansion reservoir (X = -0.35, Y = 0.72, Z = -1.05)
    const coolantGroup = new THREE.Group();
    coolantGroup.position.set(-0.35, 0.72, -1.05);
    const tankShellMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xf1f5f9,
        transparent: true,
        opacity: 0.52,
        roughness: 0.25,
        metalness: 0.05,
      })
    );
    const g13LiquidMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xec4899,
        emissive: 0xbe185d,
        emissiveIntensity: 0.18,
        roughness: 0.2,
      })
    );
    const tankSphere = new THREE.Mesh(
      this.trackGeo(new THREE.SphereGeometry(0.082, 20, 16)),
      tankShellMat
    );
    tankSphere.scale.set(1, 0.9, 1);
    const g13Fluid = new THREE.Mesh(
      this.trackGeo(new THREE.SphereGeometry(0.072, 16, 12, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65)),
      g13LiquidMat
    );
    g13Fluid.position.y = -0.008;
    const coolantCap = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.032, 0.034, 0.025, 16)),
      plasticMat
    );
    coolantCap.position.y = 0.078;
    coolantGroup.add(g13Fluid, tankSphere, coolantCap);
    this.engineCoreGroup.add(coolantGroup);

    // Air filter box (X = -0.38, Y = 0.68, Z = -1.55) + corrugated intake hose
    const airbox = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.24, 0.17, 0.22)),
      plasticMat
    );
    airbox.position.set(-0.38, 0.66, -1.55);
    airbox.castShadow = true;
    this.engineCoreGroup.add(airbox);

    const intakeHose = new THREE.Mesh(
      this.trackGeo(new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.28, 0.69, -1.50),
          new THREE.Vector3(-0.18, 0.71, -1.26),
          new THREE.Vector3(-0.06, 0.62, -1.14),
        ]),
        16,
        0.028,
        12,
        false
      )),
      matteRubberMat
    );
    this.engineCoreGroup.add(intakeHose);

    // 12V AGM Battery (mounted on tray at X = -0.43, Y = 0.59, Z = -1.30)
    const batteryGroup = new THREE.Group();
    batteryGroup.position.set(-0.43, 0.59, -1.3);
    const battCase = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.21, 0.17, 0.17)),
      plasticMat
    );
    const battLabelMat = this.trackMat(
      new THREE.MeshStandardMaterial({ map: batteryLabelTex, roughness: 0.45 })
    );
    const battLabel = new THREE.Mesh(
      this.trackGeo(new THREE.PlaneGeometry(0.16, 0.08)),
      battLabelMat
    );
    battLabel.rotation.x = -Math.PI / 2;
    battLabel.position.set(0, 0.086, 0);
    const posTerm = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.011, 0.011, 0.024, 12)),
      steelMat
    );
    posTerm.position.set(0.075, 0.095, -0.055);
    const redCap = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.036, 0.018, 0.032)),
      this.trackMat(new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.5 }))
    );
    redCap.position.set(0.075, 0.104, -0.055);
    const negTerm = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.011, 0.011, 0.024, 12)),
      steelMat
    );
    negTerm.position.set(0.075, 0.095, 0.055);
    batteryGroup.add(battCase, battLabel, posTerm, redCap, negTerm);
    this.engineCoreGroup.add(batteryGroup);

    // Front radiator core & twin fan shroud at Z = -1.82
    const radGroup = new THREE.Group();
    radGroup.position.set(0, 0.48, -1.82);
    const radFrame = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.84, 0.42, 0.042)),
      plasticMat
    );
    const radCoreMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x6b7280,
        metalness: 0.76,
        roughness: 0.42,
      })
    );
    const radCore = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.76, 0.36, 0.046)),
      radCoreMat
    );
    radGroup.add(radFrame, radCore);

    for (const fx of [-0.19, 0.19]) {
      const shroudRing = new THREE.Mesh(
        this.trackGeo(new THREE.TorusGeometry(0.145, 0.014, 10, 28)),
        plasticMat
      );
      shroudRing.position.set(fx, 0, 0.028);
      radGroup.add(shroudRing);
      for (let b = 0; b < 7; b++) {
        const blade = new THREE.Mesh(
          this.trackGeo(new THREE.BoxGeometry(0.028, 0.12, 0.008)),
          plasticMat
        );
        const ang = (b * Math.PI * 2) / 7;
        blade.position.set(fx + Math.cos(ang) * 0.068, Math.sin(ang) * 0.068, 0.024);
        blade.rotation.z = ang + 0.45;
        blade.rotation.y = 0.35;
        radGroup.add(blade);
      }
    }
    this.engineCoreGroup.add(radGroup);

    // Upper & lower radiator coolant hoses
    const upperHose = new THREE.Mesh(
      this.trackGeo(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3([
            new THREE.Vector3(-0.24, 0.62, -1.48),
            new THREE.Vector3(-0.34, 0.62, -1.66),
            new THREE.Vector3(-0.34, 0.62, -1.80),
          ]),
          14,
          0.02,
          10,
          false
        )
      ),
      matteRubberMat
    );
    const lowerHose = new THREE.Mesh(
      this.trackGeo(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3([
            new THREE.Vector3(0.26, 0.36, -1.45),
            new THREE.Vector3(0.32, 0.32, -1.64),
            new THREE.Vector3(0.34, 0.31, -1.80),
          ]),
          14,
          0.02,
          10,
          false
        )
      ),
      matteRubberMat
    );
    this.engineCoreGroup.add(upperHose, lowerHose);
  }

  private buildGroovedPulleyDrum(
    radius: number,
    width: number,
    mat: THREE.Material
  ): THREE.Group {
    const drum = new THREE.Group();
    const body = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(radius - 0.001, radius - 0.001, width, 36)),
      mat
    );
    body.rotation.z = Math.PI / 2;
    drum.add(body);

    // Outer & inner rim flanges
    for (const side of [-1, 1]) {
      const flange = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(radius + 0.003, radius + 0.003, 0.0024, 36)),
        mat
      );
      flange.rotation.z = Math.PI / 2;
      flange.position.x = side * (width * 0.5 + 0.0012);
      drum.add(flange);
    }

    // 6 fine V-rib rings around the pulley drum
    for (let i = 0; i < 6; i++) {
      const xPos = -0.0085 + i * 0.0034;
      const rib = new THREE.Mesh(
        this.trackGeo(new THREE.TorusGeometry(radius, 0.0009, 6, 36)),
        mat
      );
      rib.rotation.y = Math.PI / 2;
      rib.position.x = xPos;
      drum.add(rib);
    }
    return drum;
  }

  private buildCrankPulley(): {
    spinGroup: THREE.Group;
    boltGroup: THREE.Group;
    pulleyHitRoot: THREE.Object3D;
    boltHitRoot: THREE.Object3D;
  } {
    const spec = PULLEY_SPECS.crank;
    const mount = new THREE.Group();
    mount.position.copy(uvToLocal(spec.u, spec.v, 0));
    this.engineCoreGroup.add(mount);

    const spinGroup = new THREE.Group();
    mount.add(spinGroup);

    const damperMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x2c3138,
        metalness: 0.72,
        roughness: 0.36,
      })
    );
    const rubberDamperMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x15171a,
        metalness: 0.08,
        roughness: 0.85,
      })
    );
    const boltSteelMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xd1d8e0,
        metalness: 0.9,
        roughness: 0.24,
      })
    );

    const drum = this.buildGroovedPulleyDrum(spec.radius, 0.025, damperMat);
    spinGroup.add(drum);

    // Harmonic elastomer ring on +X face
    const damperRing = new THREE.Mesh(
      this.trackGeo(new THREE.TorusGeometry(0.056, 0.008, 12, 36)),
      rubberDamperMat
    );
    damperRing.rotation.y = Math.PI / 2;
    damperRing.position.x = 0.011;
    spinGroup.add(damperRing);

    // Machined center hub plate
    const hubPlate = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.044, 0.044, 0.018, 28)),
      damperMat
    );
    hubPlate.rotation.z = Math.PI / 2;
    hubPlate.position.x = 0.007;
    spinGroup.add(hubPlate);

    // 4 Allen bolts + TDC index notch so rotation is unmistakable
    for (let i = 0; i < 4; i++) {
      const ang = (i * Math.PI) / 2 + Math.PI / 4;
      const allen = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.006, 0.006, 0.009, 10)),
        boltSteelMat
      );
      allen.rotation.z = Math.PI / 2;
      allen.position.set(0.017, Math.sin(ang) * 0.032, -Math.cos(ang) * 0.032);
      spinGroup.add(allen);
    }

    const timingNotch = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.006, 0.012, 0.005)),
      this.trackMat(new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.4 }))
    );
    timingNotch.position.set(0.015, 0.072, 0);
    spinGroup.add(timingNotch);

    // Hit mesh for crank pulley rim (leaving center clear for crankBolt)
    const pulleyHitRing = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(spec.radius + 0.006, spec.radius + 0.006, 0.028, 24)),
      this.trackMat(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false }))
    );
    pulleyHitRing.rotation.z = Math.PI / 2;
    spinGroup.add(pulleyHitRing);
    tagInteractable(spinGroup, 'pulley_crank');

    // Central 12-point Crankshaft Bolt (sibling on mount so hover highlighting stays isolated)
    const boltGroup = new THREE.Group();
    mount.add(boltGroup);
    const crankBoltMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xd8dee6,
        metalness: 0.9,
        roughness: 0.22,
      })
    );
    const boltWasher = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.02, 0.02, 0.006, 20)),
      crankBoltMat
    );
    boltWasher.rotation.z = Math.PI / 2;
    boltWasher.position.x = 0.017;

    const boltHead12Pt = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.016, 12)),
      crankBoltMat
    );
    boltHead12Pt.rotation.z = Math.PI / 2;
    boltHead12Pt.position.x = 0.024;

    const boltPaintMark = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.004, 0.022, 0.004)),
      this.trackMat(new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.4 }))
    );
    boltPaintMark.position.set(0.032, 0.004, 0);

    const boltHit = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.024, 0.024, 0.028, 16)),
      this.trackMat(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false }))
    );
    boltHit.rotation.z = Math.PI / 2;
    boltHit.position.x = 0.025;

    boltGroup.add(boltWasher, boltHead12Pt, boltPaintMark, boltHit);
    tagInteractable(boltGroup, 'crankBolt');

    return {
      spinGroup,
      boltGroup,
      pulleyHitRoot: spinGroup,
      boltHitRoot: boltGroup,
    };
  }

  private buildAcPulley(castAluTex: THREE.CanvasTexture): {
    mountGroup: THREE.Group;
    spinGroup: THREE.Group;
    hitRoot: THREE.Object3D;
  } {
    const spec = PULLEY_SPECS.ac;
    const mount = new THREE.Group();
    mount.position.copy(uvToLocal(spec.u, spec.v, 0));
    this.engineCoreGroup.add(mount);

    // Stationary ribbed AC compressor body inboard (X <= -0.028 relative to 0.44)
    const housingMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x8f98a3,
        map: castAluTex,
        metalness: 0.72,
        roughness: 0.45,
      })
    );
    const body = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.056, 0.058, 0.175, 22)),
      housingMat
    );
    body.rotation.z = Math.PI / 2;
    body.position.x = -0.115;
    mount.add(body);

    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(
        this.trackGeo(new THREE.TorusGeometry(0.057, 0.0035, 6, 22)),
        housingMat
      );
      fin.rotation.y = Math.PI / 2;
      fin.position.x = -0.165 + i * 0.036;
      mount.add(fin);
    }

    // Spinning AC clutch pulley
    const spinGroup = new THREE.Group();
    spinGroup.userData.preserveOnHydrate = true;
    mount.add(spinGroup);

    const pulleyMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x262a30,
        metalness: 0.76,
        roughness: 0.34,
      })
    );
    const clutchPlateMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x9aa4b0,
        metalness: 0.85,
        roughness: 0.28,
      })
    );

    const drum = this.buildGroovedPulleyDrum(spec.radius, 0.025, pulleyMat);
    spinGroup.add(drum);

    // Electromagnetic clutch tri-lobe disc on +X face
    const clutchRing = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.048, 0.048, 0.008, 24)),
      clutchPlateMat
    );
    clutchRing.rotation.z = Math.PI / 2;
    clutchRing.position.x = 0.015;
    spinGroup.add(clutchRing);

    for (let i = 0; i < 3; i++) {
      const ang = (i * Math.PI * 2) / 3;
      const lobe = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.008, 0.018, 0.036)),
        pulleyMat
      );
      lobe.position.set(0.019, Math.sin(ang) * 0.026, -Math.cos(ang) * 0.026);
      lobe.rotation.x = ang;
      spinGroup.add(lobe);
    }

    const centerNut = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 6)),
      clutchPlateMat
    );
    centerNut.rotation.z = Math.PI / 2;
    centerNut.position.x = 0.022;
    spinGroup.add(centerNut);

    const hitMesh = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(spec.radius + 0.006, spec.radius + 0.006, 0.038, 22)),
      this.trackMat(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false }))
    );
    hitMesh.rotation.z = Math.PI / 2;
    hitMesh.position.x = 0.005;
    spinGroup.add(hitMesh);
    tagInteractable(spinGroup, 'pulley_ac');

    return { mountGroup: mount, spinGroup, hitRoot: spinGroup };
  }

  private buildAlternatorPulley(castAluTex: THREE.CanvasTexture): {
    mountGroup: THREE.Group;
    spinGroup: THREE.Group;
    hitRoot: THREE.Object3D;
  } {
    const spec = PULLEY_SPECS.alternator;
    const mount = new THREE.Group();
    mount.position.copy(uvToLocal(spec.u, spec.v, 0));
    this.engineCoreGroup.add(mount);

    // Vented cast aluminum alternator housing inboard (X in [-0.18, -0.028])
    const housingMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xaab3bd,
        map: castAluTex,
        metalness: 0.78,
        roughness: 0.36,
      })
    );
    const copperMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xb45309,
        metalness: 0.85,
        roughness: 0.28,
      })
    );
    const rearCapMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x16181d,
        roughness: 0.72,
        metalness: 0.06,
      })
    );

    const frontCase = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.062, 0.066, 0.068, 22)),
      housingMat
    );
    frontCase.rotation.z = Math.PI / 2;
    frontCase.position.x = -0.068;
    mount.add(frontCase);

    // Visible copper stator core between front & rear housing halves
    const stator = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.056, 0.056, 0.028, 24)),
      copperMat
    );
    stator.rotation.z = Math.PI / 2;
    stator.position.x = -0.108;
    mount.add(stator);

    // Axial struts bridging over copper stator
    for (let i = 0; i < 6; i++) {
      const ang = (i * Math.PI) / 3;
      const strut = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.036, 0.012, 0.012)),
        housingMat
      );
      strut.position.set(-0.108, Math.sin(ang) * 0.06, -Math.cos(ang) * 0.06);
      mount.add(strut);
    }

    const rearCase = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.064, 0.058, 0.065, 22)),
      rearCapMat
    );
    rearCase.rotation.z = Math.PI / 2;
    rearCase.position.x = -0.15;
    mount.add(rearCase);

    // Mounting ears tying alternator into engine block
    const ear = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.09, 0.04, 0.05)),
      housingMat
    );
    ear.position.set(-0.09, -0.068, 0);
    mount.add(ear);

    // Spinning Overrunning Alternator Pulley (OAP) at X = 0.44
    const spinGroup = new THREE.Group();
    spinGroup.userData.preserveOnHydrate = true;
    mount.add(spinGroup);

    const oapMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x3b424d,
        metalness: 0.88,
        roughness: 0.24,
      })
    );
    const drum = this.buildGroovedPulleyDrum(spec.radius, 0.025, oapMat);
    spinGroup.add(drum);

    // Black plastic dust cap on front of OAP + radial silver index notch for spin feedback
    const oapCap = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.007, 18)),
      rearCapMat
    );
    oapCap.rotation.z = Math.PI / 2;
    oapCap.position.x = 0.015;
    spinGroup.add(oapCap);

    const spinMarker = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.005, 0.018, 0.005)),
      this.trackMat(new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3, metalness: 0.8 }))
    );
    spinMarker.position.set(0.017, 0.025, 0);
    spinGroup.add(spinMarker);

    const hitMesh = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(spec.radius + 0.008, spec.radius + 0.008, 0.036, 20)),
      this.trackMat(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false }))
    );
    hitMesh.rotation.z = Math.PI / 2;
    hitMesh.position.x = 0.004;
    spinGroup.add(hitMesh);
    tagInteractable(spinGroup, 'pulley_alternator');

    return { mountGroup: mount, spinGroup, hitRoot: spinGroup };
  }

  private buildTensionerAssembly(): {
    rootGroup: THREE.Group;
    housingGroup: THREE.Group;
    armGroup: THREE.Group;
    rollerSpinGroup: THREE.Group;
    hexGroup: THREE.Group;
    pinHoleGroup: THREE.Group;
    stationaryHoleRing: THREE.Mesh;
    movingHoleRing: THREE.Mesh;
    boltGroup: THREE.Group;
    pinMesh: THREE.Group;
    mountSlotGroup: THREE.Group;
    rollerHitRoot: THREE.Object3D;
    hexHitRoot: THREE.Object3D;
    pinHoleHitRoot: THREE.Object3D;
    boltHitRoot: THREE.Object3D;
    mountSlotHitRoot: THREE.Object3D;
  } {
    const rootGroup = new THREE.Group();
    rootGroup.position.copy(uvToLocal(TENSIONER_PIVOT.u, TENSIONER_PIVOT.v, 0));
    this.engineCoreGroup.add(rootGroup);

    // 1. Stationary spring housing mounted inboard at X = 0.408 (xOffset = -0.032)
    const housingGroup = new THREE.Group();
    rootGroup.add(housingGroup);

    const springCup = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.029, 0.031, 0.028, 24)),
      this.oldTensionerMat
    );
    springCup.rotation.z = Math.PI / 2;
    springCup.position.x = -0.032; // X = 0.408
    housingGroup.add(springCup);

    // Stationary backplate flange extending to the 4mm alignment bore
    const backPlateBridge = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.009, 0.022, 0.048)),
      this.oldTensionerMat
    );
    backPlateBridge.position.set(
      -0.032,
      Math.sin(PIN_STATIONARY_WORLD_ANGLE) * (PIN_ARM_RADIUS * 0.55),
      -Math.cos(PIN_STATIONARY_WORLD_ANGLE) * (PIN_ARM_RADIUS * 0.55)
    );
    backPlateBridge.rotation.x = PIN_STATIONARY_WORLD_ANGLE;
    housingGroup.add(backPlateBridge);

    const stationaryHolePos = new THREE.Vector3(
      -0.032,
      Math.sin(PIN_STATIONARY_WORLD_ANGLE) * PIN_ARM_RADIUS,
      -Math.cos(PIN_STATIONARY_WORLD_ANGLE) * PIN_ARM_RADIUS
    );
    const stationaryHoleRing = new THREE.Mesh(
      this.trackGeo(new THREE.TorusGeometry(0.0042, 0.0022, 10, 20)),
      this.pinAlignedRingMat
    );
    stationaryHoleRing.rotation.y = Math.PI / 2;
    stationaryHoleRing.position.copy(stationaryHolePos).setX(-0.027);
    stationaryHoleRing.userData.preserveOnHydrate = true;
    housingGroup.add(stationaryHoleRing);

    const darkBoreMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.9 })
    );
    const stationaryBore = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.0025, 0.0025, 0.012, 12)),
      darkBoreMat
    );
    stationaryBore.rotation.z = Math.PI / 2;
    stationaryBore.position.copy(stationaryHolePos).setX(-0.032);
    housingGroup.add(stationaryBore);

    // 2. Central M10 Mounting Bolt (tensionerBolt)
    const boltGroup = new THREE.Group();
    rootGroup.add(boltGroup);
    const boltFlange = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.012, 0.012, 0.004, 18)),
      this.tensionerBoltMat
    );
    boltFlange.rotation.z = Math.PI / 2;
    boltFlange.position.x = -0.018;
    const boltHex = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.0085, 0.0085, 0.009, 6)),
      this.tensionerBoltMat
    );
    boltHex.rotation.z = Math.PI / 2;
    boltHex.position.x = -0.013;
    const boltHit = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.017, 0.017, 0.024, 14)),
      this.trackMat(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false }))
    );
    boltHit.rotation.z = Math.PI / 2;
    boltHit.position.x = -0.016;
    boltGroup.add(boltFlange, boltHex, boltHit);
    tagInteractable(boltGroup, 'tensionerBolt');

    // 3. Pivoting Swing Arm (rotates around X axis at P)
    const armGroup = new THREE.Group();
    rootGroup.add(armGroup);

    // Main arm beam from P (0,0) along +u_local to L = 0.085 (inboard at xOffset = -0.021)
    const armBeam = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.014, 0.024, TENSIONER_ARM_LEN)),
      this.oldTensionerMat
    );
    armBeam.position.set(-0.021, 0, -TENSIONER_ARM_LEN * 0.5);
    armGroup.add(armBeam);

    // Smooth flanged roller (pulley_tensioner) at tip (u_local = L = 0.085, xOffset = 0 -> X = 0.44)
    const rollerSpinGroup = new THREE.Group();
    rollerSpinGroup.position.set(0, 0, -TENSIONER_ARM_LEN);
    rollerSpinGroup.userData.preserveOnHydrate = true;
    armGroup.add(rollerSpinGroup);

    const rollerRadius = PULLEY_SPECS.tensioner.radius;
    const rollerBody = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(rollerRadius, rollerRadius, 0.024, 32)),
      this.tensionerRollerMat
    );
    rollerBody.rotation.z = Math.PI / 2;
    rollerSpinGroup.add(rollerBody);

    for (const side of [-1, 1]) {
      const flange = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(rollerRadius + 0.0032, rollerRadius + 0.0032, 0.0022, 32)),
        this.tensionerRollerMat
      );
      flange.rotation.z = Math.PI / 2;
      flange.position.x = side * 0.0125;
      rollerSpinGroup.add(flange);
    }

    const bearingDustCap = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.017, 0.017, 0.027, 20)),
      this.trackMat(new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.65 }))
    );
    bearingDustCap.rotation.z = Math.PI / 2;
    rollerSpinGroup.add(bearingDustCap);

    // Subtle rotation indicator dots on dust cap so CW roller spin is crystal clear
    for (let i = 0; i < 3; i++) {
      const ang = (i * Math.PI * 2) / 3;
      const dot = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.0022, 0.0022, 0.004, 8)),
        this.tensionerRollerMat
      );
      dot.rotation.z = Math.PI / 2;
      dot.position.set(0.013, Math.sin(ang) * 0.011, -Math.cos(ang) * 0.011);
      rollerSpinGroup.add(dot);
    }

    const rollerHit = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(rollerRadius + 0.006, rollerRadius + 0.006, 0.032, 20)),
      this.trackMat(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false }))
    );
    rollerHit.rotation.z = Math.PI / 2;
    rollerSpinGroup.add(rollerHit);
    tagInteractable(rollerSpinGroup, 'pulley_tensioner');

    // 4. Prominent 16mm Cast Hex Boss (tensionerHex) protruding on arm ear
    const hexGroup = new THREE.Group();
    const hexLocalU = HEX_ARM_RADIUS * Math.cos(HEX_ARM_OFFSET_ANGLE);
    const hexLocalV = HEX_ARM_RADIUS * Math.sin(HEX_ARM_OFFSET_ANGLE);
    hexGroup.position.set(0.008, hexLocalV, -hexLocalU); // +X face ~ 0.448..0.456
    hexGroup.userData.preserveOnHydrate = true;
    armGroup.add(hexGroup);

    const hexWeb = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.012, 0.022, 0.022)),
      this.oldTensionerMat
    );
    hexWeb.position.x = -0.022;
    hexGroup.add(hexWeb);

    // 16mm AF hex cylinder (circumradius ~ 0.0105 m for strong readability)
    const hexBoss = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.0105, 0.0112, 0.016, 6)),
      this.oldTensionerMat
    );
    hexBoss.rotation.z = Math.PI / 2;
    hexGroup.add(hexBoss);

    const hexHit = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.018, 0.018, 0.028, 12)),
      this.trackMat(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false }))
    );
    hexHit.rotation.z = Math.PI / 2;
    hexGroup.add(hexHit);
    tagInteractable(hexGroup, 'tensionerHex');

    // 5. Moving 4mm Pin-Hole Boss (tensionerPinHole) on arm
    const pinHoleGroup = new THREE.Group();
    const pinLocalU = PIN_ARM_RADIUS * Math.cos(PIN_ARM_OFFSET_ANGLE);
    const pinLocalV = PIN_ARM_RADIUS * Math.sin(PIN_ARM_OFFSET_ANGLE);
    pinHoleGroup.position.set(-0.02, pinLocalV, -pinLocalU); // xOffset = -0.02 (just in front of stationary -0.027)
    pinHoleGroup.userData.preserveOnHydrate = true;
    armGroup.add(pinHoleGroup);

    const pinLug = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.0085, 0.009, 0.01, 16)),
      this.oldTensionerMat
    );
    pinLug.rotation.z = Math.PI / 2;
    pinHoleGroup.add(pinLug);

    const movingHoleRing = new THREE.Mesh(
      this.trackGeo(new THREE.TorusGeometry(0.0042, 0.0022, 10, 20)),
      this.pinAlignedRingMat
    );
    movingHoleRing.rotation.y = Math.PI / 2;
    movingHoleRing.position.x = 0.0045;
    movingHoleRing.userData.preserveOnHydrate = true;
    pinHoleGroup.add(movingHoleRing);

    const movingBore = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.0025, 0.0025, 0.012, 12)),
      darkBoreMat
    );
    movingBore.rotation.z = Math.PI / 2;
    pinHoleGroup.add(movingBore);

    const pinHoleHit = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.015, 0.015, 0.028, 12)),
      this.trackMat(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false }))
    );
    pinHoleHit.rotation.z = Math.PI / 2;
    pinHoleHit.position.x = 0.006;
    pinHoleGroup.add(pinHoleHit);
    tagInteractable(pinHoleGroup, 'tensionerPinHole');

    // 6. Visual T10060A Locking Pin Mesh (inserted at stationary bore along -X)
    const pinMesh = new THREE.Group();
    pinMesh.position.copy(stationaryHolePos).setX(0);
    rootGroup.add(pinMesh);

    const steelPinMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.92, roughness: 0.18 })
    );
    const redKnurlMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xdc2626, metalness: 0.35, roughness: 0.42 })
    );
    const dowelShaft = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.0022, 0.0022, 0.056, 12)),
      steelPinMat
    );
    dowelShaft.rotation.z = Math.PI / 2;
    dowelShaft.position.x = -0.012;
    const redHandle = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.007, 0.007, 0.026, 16)),
      redKnurlMat
    );
    redHandle.rotation.z = Math.PI / 2;
    redHandle.position.x = 0.026;
    const tBar = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.004, 0.004, 0.036, 12)),
      redKnurlMat
    );
    tBar.position.x = 0.038;
    const pinHit = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.015, 0.015, 0.055, 12)),
      this.trackMat(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false }))
    );
    pinHit.rotation.z = Math.PI / 2;
    pinHit.position.x = 0.018;
    pinMesh.add(dowelShaft, redHandle, tBar, pinHit);
    tagInteractable(pinMesh, 'tensionerPinHole');
    pinMesh.visible = false;

    // 7. Cyan Ghost Slot (tensionerMountSlot) shown when tensioner is removed in Step 8
    const mountSlotGroup = new THREE.Group();
    rootGroup.add(mountSlotGroup);

    const ghostCup = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.03, 0.03, 0.028, 22)),
      this.mountSlotMat
    );
    ghostCup.rotation.z = Math.PI / 2;
    ghostCup.position.x = -0.032;

    const ghostArm = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.014, 0.024, TENSIONER_ARM_LEN)),
      this.mountSlotMat
    );
    ghostArm.position.set(-0.021, 0, -TENSIONER_ARM_LEN * 0.5);
    ghostArm.rotation.x = THETA_LOOSE;

    const ghostRoller = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(rollerRadius, rollerRadius, 0.024, 24)),
      this.mountSlotMat
    );
    ghostRoller.rotation.z = Math.PI / 2;
    ghostRoller.position.set(
      0,
      Math.sin(THETA_LOOSE) * TENSIONER_ARM_LEN,
      -Math.cos(THETA_LOOSE) * TENSIONER_ARM_LEN
    );

    const ghostRing = new THREE.Mesh(
      this.trackGeo(new THREE.TorusGeometry(0.036, 0.0035, 10, 28)),
      this.mountSlotMat
    );
    ghostRing.rotation.y = Math.PI / 2;
    ghostRing.position.x = -0.012;

    const mountSlotHit = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 16)),
      this.trackMat(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false }))
    );
    mountSlotHit.rotation.z = Math.PI / 2;
    mountSlotHit.position.x = -0.015;

    mountSlotGroup.add(ghostCup, ghostArm, ghostRoller, ghostRing, mountSlotHit);
    tagInteractable(mountSlotGroup, 'tensionerMountSlot');
    mountSlotGroup.visible = false;

    return {
      rootGroup,
      housingGroup,
      armGroup,
      rollerSpinGroup,
      hexGroup,
      pinHoleGroup,
      stationaryHoleRing,
      movingHoleRing,
      boltGroup,
      pinMesh,
      mountSlotGroup,
      rollerHitRoot: rollerSpinGroup,
      hexHitRoot: hexGroup,
      pinHoleHitRoot: pinHoleGroup,
      boltHitRoot: boltGroup,
      mountSlotHitRoot: mountSlotGroup,
    };
  }

  private getTensionerAngle(): number {
    return THETA_TIGHT + (THETA_LOOSE - THETA_TIGHT) * this.tensionerProgress;
  }

  private getActivePitchCircles(): { u: number; v: number; r: number; dir: 1 | -1 }[] {
    const theta = this.getTensionerAngle();
    const tensU = TENSIONER_PIVOT.u + TENSIONER_ARM_LEN * Math.cos(theta);
    const tensV = TENSIONER_PIVOT.v + TENSIONER_ARM_LEN * Math.sin(theta);

    return LOOP_ORDER.map((id) => {
      const spec = PULLEY_SPECS[id];
      if (id === 'tensioner') {
        return { u: tensU, v: tensV, r: spec.radius + HALF_THICKNESS, dir: spec.wrapDir };
      }
      return { u: spec.u, v: spec.v, r: spec.radius + HALF_THICKNESS, dir: spec.wrapDir };
    });
  }

  private computeAnalyticalBeltPath(applySlackSag: boolean): BuiltPath {
    const circles = this.getActivePitchCircles();
    const tangents: TangentResult[] = [];
    for (let i = 0; i < 4; i++) {
      tangents.push(solveTangent(circles[i], circles[(i + 1) % 4]));
    }

    const rawPoints: { u: number; v: number; segKind: 'arc' | 'span'; segIdx: number }[] = [];
    const spanRanges: { startIdx: number; endIdx: number }[] = [];
    const arcRanges: { startIdx: number; endIdx: number }[] = [];

    const N_ARC = 18;
    const N_SPAN = 14;
    const sagAmount =
      applySlackSag && this.tensionerProgress > 0.7
        ? 0.004 * smoothstep(0.7, 1.0, this.tensionerProgress)
        : 0;

    for (let i = 0; i < 4; i++) {
      const c = circles[i];
      const nextC = circles[(i + 1) % 4];
      const prevT = tangents[(i + 3) % 4];
      const nextT = tangents[i];

      // Arc around pulley i
      const arcStartIdx = rawPoints.length;
      const startAngle = prevT.a2;
      const delta = normalizeArcSweep(startAngle, nextT.a1, c.dir);
      for (let s = 0; s < N_ARC; s++) {
        const ang = startAngle + (delta * s) / N_ARC;
        rawPoints.push({
          u: c.u + c.r * Math.cos(ang),
          v: c.v + c.r * Math.sin(ang),
          segKind: 'arc',
          segIdx: i,
        });
      }
      arcRanges.push({ startIdx: arcStartIdx, endIdx: rawPoints.length });

      // Straight span from pulley i -> pulley (i + 1) % 4
      const spanStartIdx = rawPoints.length;
      const p1u = c.u + c.r * Math.cos(nextT.a1);
      const p1v = c.v + c.r * Math.sin(nextT.a1);
      const p2u = nextC.u + nextC.r * Math.cos(nextT.a2);
      const p2v = nextC.v + nextC.r * Math.sin(nextT.a2);

      // Gentle ~4 mm slack sag on the upper-left spans (span 2: alt->tens, span 3: tens->crank)
      const spanSag = i === 2 || i === 3 ? sagAmount : 0;

      for (let s = 0; s < N_SPAN; s++) {
        const t = s / N_SPAN;
        const droop = spanSag > 0 ? Math.sin(Math.PI * t) * spanSag : 0;
        rawPoints.push({
          u: p1u + (p2u - p1u) * t,
          v: p1v + (p2v - p1v) * t - droop,
          segKind: 'span',
          segIdx: i,
        });
      }
      spanRanges.push({ startIdx: spanStartIdx, endIdx: rawPoints.length });
    }

    // Close the loop seamlessly by duplicating point 0 at the end
    const count = rawPoints.length;
    const samples: PathSample[] = [];
    let arcLen = 0;

    for (let i = 0; i <= count; i++) {
      const curr = rawPoints[i % count];
      const prev = rawPoints[(i - 1 + count) % count];
      const next = rawPoints[(i + 1) % count];

      if (i > 0) {
        arcLen += Math.hypot(curr.u - prev.u, curr.v - prev.v);
      }

      const du = next.u - prev.u;
      const dv = next.v - prev.v;
      const len = Math.max(1e-6, Math.hypot(du, dv));
      const tu = du / len;
      const tv = dv / len;
      // Right-hand outward normal pointing to smooth outer back of belt
      const nu = tv;
      const nv = -tu;

      samples.push({ u: curr.u, v: curr.v, tu, tv, nu, nv, arcLen });
    }

    return { samples, totalLen: arcLen, spanRanges, arcRanges };
  }

  /**
   * Generates a watertight closed 3D extruded multi-ribbed 6PK belt geometry
   * with smooth outer back (+HALF_THICKNESS) and 6 V-rib ridges on the inner
   * pulley-facing surface (-HALF_THICKNESS).
   */
  private buildRibbedBeltGeometry(path: BuiltPath): THREE.BufferGeometry {
    // 2D cross-section profile (xOffset along X, nOffset along outward normal N_outer)
    // Ordered counter-clockwise around the cross-section in (x, n) space
    const halfW = BELT_WIDTH * 0.5; // 0.0107
    const outerN = HALF_THICKNESS; // +0.0025
    const bevelN = HALF_THICKNESS * 0.72; // +0.0018
    const bevelX = halfW - 0.0007;
    const rootN = -0.0006;
    const tipN = -HALF_THICKNESS; // -0.0025

    const profile: { x: number; n: number }[] = [
      { x: bevelX, n: outerN },
      { x: -bevelX, n: outerN },
      { x: -halfW, n: bevelN },
      { x: -halfW, n: rootN },
    ];

    // 6 V-ribs running across [-0.0099, +0.0099]
    const ribStart = -0.0099;
    const ribPitch = 0.0198 / 6;
    for (let r = 0; r < 6; r++) {
      const leftX = ribStart + r * ribPitch;
      const midX = leftX + ribPitch * 0.5;
      const rightX = leftX + ribPitch;
      profile.push({ x: leftX + 0.0003, n: rootN });
      profile.push({ x: midX - 0.00025, n: tipN });
      profile.push({ x: midX + 0.00025, n: tipN });
      if (r < 5) {
        profile.push({ x: rightX - 0.0003, n: rootN });
      }
    }

    profile.push({ x: halfW, n: rootN });
    profile.push({ x: halfW, n: bevelN });

    const ringLen = path.samples.length;
    const profLen = profile.length;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    // Precompute 2D profile segment normals in (x, n) space for crisp V-rib shading
    for (let j = 0; j < profLen; j++) {
      const pA = profile[j];
      const pB = profile[(j + 1) % profLen];
      const dx = pB.x - pA.x;
      const dn = pB.n - pA.n;
      const segLen = Math.max(1e-7, Math.hypot(dx, dn));
      // Outward 2D normal in (x, n) for CCW profile: (-dn, dx) or (dn, -dx)
      // Top segment (bevelX -> -bevelX at outerN): dx < 0, dn = 0 -> normal must be (0, +1) -> (-dn, -dx)!
      // Verify: (0, -(-2*bevelX)) = (0, +positive) -> points outward (+n)!
      // Left edge (-halfW, bevelN -> rootN): dx = 0, dn < 0 -> (-dn, -dx) = (+positive, 0)? Wait:
      // Wait: if top goes +X to -X (CCW around origin), then left edge goes +N to -N, outward is -X = (+dn, -dx)!
      // Let's check: top: dx < 0, dn = 0 -> (+0, -(-)) = (0, +)! Left: dx = 0, dn < 0 -> (dn, -0) = (-, 0)!
      // Bottom: dx > 0, dn = 0 -> (0, -(+)) = (0, -)! Right: dx = 0, dn > 0 -> (+, 0)!
      // Exact outward 2D normal is (dn / segLen, -dx / segLen)!
      const profNx = dn / segLen;
      const profNn = -dx / segLen;

      // Map profile arc position to V UV in [0, 1]
      const vA = (pA.x + halfW) / BELT_WIDTH;
      const vB = (pB.x + halfW) / BELT_WIDTH;

      const baseVert = (positions.length / 3);
      for (let k = 0; k < ringLen; k++) {
        const s = path.samples[k];
        const uCoord = (s.arcLen / Math.max(1e-5, path.totalLen)) * 3;

        // Point A
        const p3A = uvToLocal(s.u + s.nu * pA.n, s.v + s.nv * pA.n, pA.x);
        // Point B
        const p3B = uvToLocal(s.u + s.nu * pB.n, s.v + s.nv * pB.n, pB.x);

        // 3D normal combining profNx along +X and profNn along N_outer (in (u,v) -> (0, nv, -nu))
        const nx = profNx;
        const ny = profNn * s.nv;
        const nz = profNn * -s.nu;
        const nLen = Math.max(1e-6, Math.hypot(nx, ny, nz));

        positions.push(p3A.x, p3A.y, p3A.z);
        normals.push(nx / nLen, ny / nLen, nz / nLen);
        uvs.push(uCoord, vA);

        positions.push(p3B.x, p3B.y, p3B.z);
        normals.push(nx / nLen, ny / nLen, nz / nLen);
        uvs.push(uCoord, vB);
      }

      for (let k = 0; k < ringLen - 1; k++) {
        const i0 = baseVert + k * 2;
        const i1 = i0 + 1;
        const i2 = i0 + 2;
        const i3 = i0 + 3;
        indices.push(i0, i1, i2);
        indices.push(i1, i3, i2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    return geo;
  }

  private buildSimpleRibbonGeometry(path: BuiltPath): THREE.BufferGeometry {
    const halfW = BELT_WIDTH * 0.52;
    const outerN = HALF_THICKNESS * 1.1;
    const innerN = -HALF_THICKNESS * 1.1;
    const profile = [
      { x: halfW, n: outerN },
      { x: -halfW, n: outerN },
      { x: -halfW, n: innerN },
      { x: halfW, n: innerN },
    ];
    const ringLen = path.samples.length;
    const positions: number[] = [];
    const indices: number[] = [];

    for (let k = 0; k < ringLen; k++) {
      const s = path.samples[k];
      for (let j = 0; j < 4; j++) {
        const p = profile[j];
        const pt = uvToLocal(s.u + s.nu * p.n, s.v + s.nv * p.n, p.x);
        positions.push(pt.x, pt.y, pt.z);
      }
    }

    for (let k = 0; k < ringLen - 1; k++) {
      const a = k * 4;
      const b = (k + 1) * 4;
      for (let j = 0; j < 4; j++) {
        const jNext = (j + 1) % 4;
        indices.push(a + j, a + jNext, b + j);
        indices.push(a + jNext, b + jNext, b + j);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }

  private rebuildBeltGeometries(): void {
    const applySlack = this.beltState === 'old' || this.beltState === 'new_slack';
    const path = this.computeAnalyticalBeltPath(applySlack);
    this.currentBeltLength = Math.max(0.5, path.totalLen);

    const newGeo = this.buildRibbedBeltGeometry(path);
    const oldGeo = this.buildRibbedBeltGeometry(path);
    const ghostGeo = this.buildSimpleRibbonGeometry(path);

    this.newBeltMesh.geometry.dispose();
    this.newBeltMesh.geometry = newGeo;

    this.oldBeltMesh.geometry.dispose();
    this.oldBeltMesh.geometry = oldGeo;

    this.newBeltGhostMesh.geometry.dispose();
    this.newBeltGhostMesh.geometry = ghostGeo;

    if (this.beltState === 'routing') {
      this.rebuildRoutingHighlights(path);
    }
  }

  private rebuildRoutingHighlights(path: BuiltPath): void {
    while (this.routingHighlightGroup.children.length > 0) {
      const child = this.routingHighlightGroup.children[0] as THREE.Mesh;
      this.routingHighlightGroup.remove(child);
      child.geometry.dispose();
      if (child.material instanceof THREE.Material) {
        child.material.dispose();
      }
    }

    if (this.routingNodes.length === 0) return;

    const greenMat = new THREE.MeshStandardMaterial({
      color: 0x22c55e,
      emissive: 0x16a34a,
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });

    const addTubeForRange = (startIdx: number, endIdx: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = startIdx; i <= endIdx && i < path.samples.length; i++) {
        const s = path.samples[i];
        pts.push(uvToLocal(s.u + s.nu * 0.002, s.v + s.nv * 0.002, 0));
      }
      if (pts.length < 2) return;
      const tubeGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.0055, 8, false);
      const mesh = new THREE.Mesh(tubeGeo, greenMat.clone());
      this.routingHighlightGroup.add(mesh);
    };

    // Highlight wrap arcs around routed nodes & spans between consecutive nodes
    for (let i = 0; i < this.routingNodes.length; i++) {
      const node = this.routingNodes[i];
      const loopIdx = LOOP_ORDER.indexOf(node);
      if (loopIdx >= 0) {
        const arc = path.arcRanges[loopIdx];
        addTubeForRange(arc.startIdx, arc.endIdx);
      }
      if (i > 0) {
        const prevIdx = LOOP_ORDER.indexOf(this.routingNodes[i - 1]);
        if (prevIdx >= 0 && (prevIdx + 1) % 4 === loopIdx) {
          const span = path.spanRanges[prevIdx];
          addTubeForRange(span.startIdx, span.endIdx);
        }
      }
    }

    // Also show closing span if all 4 nodes are routed
    if (
      this.routingNodes.length === 4 &&
      this.routingNodes[0] === 'crank' &&
      this.routingNodes[3] === 'tensioner'
    ) {
      const span = path.spanRanges[3];
      addTubeForRange(span.startIdx, span.endIdx);
    }

    greenMat.dispose();
  }

  private applyTensionerTransform(): void {
    const theta = this.getTensionerAngle();
    this.tensionerArmGroup.rotation.x = theta;

    // Highlight 4mm alignment rings bright emerald when within [0.80, 1.00]
    const aligned = this.tensionerProgress >= 0.8;
    if (aligned) {
      this.pinAlignedRingMat.color.setHex(0x22c55e);
      this.pinAlignedRingMat.emissive.setHex(0x16a34a);
      this.pinAlignedRingMat.emissiveIntensity = 0.85;
    } else {
      this.pinAlignedRingMat.color.setHex(0x94a3b8);
      this.pinAlignedRingMat.emissive.setHex(0x000000);
      this.pinAlignedRingMat.emissiveIntensity = 0;
    }

    // Keep reference to rings used (strict noUnusedLocals compliance)
    this.tensionerStationaryHoleRing.visible = this.tensionerState !== 'removed';
    this.tensionerMovingHoleRing.visible = this.tensionerState !== 'removed';
  }

  private syncVisibilityState(): void {
    this.oldBeltMesh.visible = this.beltState === 'old';
    this.newBeltMesh.visible =
      this.beltState === 'new_slack' || this.beltState === 'new_tensioned';
    this.newBeltGhostMesh.visible = this.beltState === 'routing';
    this.routingHighlightGroup.visible = this.beltState === 'routing';

    const mounted = this.tensionerState !== 'removed';
    this.tensionerHousingGroup.visible = mounted;
    this.tensionerArmGroup.visible = mounted;
    this.tensionerBoltGroup.visible = mounted;
    this.tensionerPinMesh.visible = mounted && this.pinInserted;
    this.tensionerMountSlotGroup.visible = this.tensionerState === 'removed';
  }

  private advanceKinematicsByBeltDistance(ds: number): void {
    this.beltTravelDistance += ds;
    const uvDelta = -(this.beltTravelDistance / this.currentBeltLength) * 3;
    this.newBeltTexture.offset.x = uvDelta;
    this.oldBeltTexture.offset.x = uvDelta;

    // ω_i = wrapDir_i * (ds / R_i) -> crank/ac/alternator rotate CCW (+X), tensioner rotates CW (-X)
    this.crankSpinGroup.rotation.x += PULLEY_SPECS.crank.wrapDir * (ds / PULLEY_SPECS.crank.radius);
    this.crankBoltGroup.rotation.x = this.crankSpinGroup.rotation.x;
    this.acSpinGroup.rotation.x += PULLEY_SPECS.ac.wrapDir * (ds / PULLEY_SPECS.ac.radius);
    this.alternatorSpinGroup.rotation.x +=
      PULLEY_SPECS.alternator.wrapDir * (ds / PULLEY_SPECS.alternator.radius);
    this.tensionerRollerSpinGroup.rotation.x +=
      PULLEY_SPECS.tensioner.wrapDir * (ds / PULLEY_SPECS.tensioner.radius);
  }

  // =========================================================================
  // PUBLIC API
  // =========================================================================

  public async loadBlenderModel(): Promise<void> {
    const glb = await loadGLB('./models/ea288_engine.glb');

    this.blenderTensionerCastMats.length = 0;
    this.blenderTensionerRollerMats.length = 0;
    this.blenderTensionerBoltMats.length = 0;

    // 1. Engine Core Block (sump, block, 16V head, common rail, injectors, turbo, DPF, timing cover)
    const coreBlock = extractNode(glb, 'EA288_CoreBlock', false);
    if (coreBlock) {
      this.engineBayGroup.clear();
      this.engineBayGroup.add(coreBlock);
    }

    // 2. Crankshaft Pulley & Central 12-Point Bolt
    const crankPulley = extractNode(glb, 'EA288_PulleyCrank', true);
    if (crankPulley) {
      clearVisualChildren(this.crankSpinGroup);
      this.cloneObjectMaterials(crankPulley);
      this.crankSpinGroup.add(crankPulley);
      tagSubtreeInteractable(this.crankSpinGroup, 'pulley_crank');
    }

    const crankBolt = extractNode(glb, 'EA288_CrankBolt', true);
    if (crankBolt) {
      clearVisualChildren(this.crankBoltGroup);
      this.cloneObjectMaterials(crankBolt);
      this.crankBoltGroup.add(crankBolt);
      tagSubtreeInteractable(this.crankBoltGroup, 'crankBolt');
    }

    // 3. A/C Compressor Housing & Pulley
    const acBody = extractNode(glb, 'EA288_ACBody', true);
    if (acBody) {
      clearVisualChildren(this.acMountGroup);
      this.acMountGroup.add(acBody);
    }

    const acPulley = extractNode(glb, 'EA288_PulleyAC', true);
    if (acPulley) {
      clearVisualChildren(this.acSpinGroup);
      this.cloneObjectMaterials(acPulley);
      this.acSpinGroup.add(acPulley);
      tagSubtreeInteractable(this.acSpinGroup, 'pulley_ac');
    }

    // 4. Alternator Housing & OAP Pulley
    const altBody = extractNode(glb, 'EA288_AlternatorBody', true);
    if (altBody) {
      clearVisualChildren(this.alternatorMountGroup);
      this.alternatorMountGroup.add(altBody);
    }

    const altPulley = extractNode(glb, 'EA288_PulleyAlternator', true);
    if (altPulley) {
      clearVisualChildren(this.alternatorSpinGroup);
      this.cloneObjectMaterials(altPulley);
      this.alternatorSpinGroup.add(altPulley);
      tagSubtreeInteractable(this.alternatorSpinGroup, 'pulley_alternator');
    }

    // 5. Tensioner Assembly (extract child nodes off EA288_TensionerArm FIRST before attaching arm!)
    const tensRoller = extractNode(glb, 'EA288_TensionerRoller', true);
    const tensHex = extractNode(glb, 'EA288_TensionerHex', true);
    const tensPinHole = extractNode(glb, 'EA288_TensionerPinHole', true);
    const tensArm = extractNode(glb, 'EA288_TensionerArm', true);
    const tensHousing = extractNode(glb, 'EA288_TensionerHousing', true);
    const tensBolt = extractNode(glb, 'EA288_TensionerBolt', true);
    const tensPin = extractNode(glb, 'EA288_TensionerPin', true);

    if (tensHousing) {
      clearVisualChildren(this.tensionerHousingGroup);
      this.cloneAndTrackTensionerMaterials(tensHousing);
      this.tensionerHousingGroup.add(tensHousing);
    }

    if (tensBolt) {
      clearVisualChildren(this.tensionerBoltGroup);
      this.cloneAndTrackTensionerMaterials(tensBolt);
      this.tensionerBoltGroup.add(tensBolt);
      tagSubtreeInteractable(this.tensionerBoltGroup, 'tensionerBolt');
    }

    if (tensArm) {
      clearVisualChildren(this.tensionerArmGroup);
      this.cloneAndTrackTensionerMaterials(tensArm);
      this.tensionerArmGroup.add(tensArm);
    }

    if (tensRoller) {
      clearVisualChildren(this.tensionerRollerSpinGroup);
      this.cloneAndTrackTensionerMaterials(tensRoller);
      this.tensionerRollerSpinGroup.add(tensRoller);
      tagSubtreeInteractable(this.tensionerRollerSpinGroup, 'pulley_tensioner');
    }

    if (tensHex) {
      clearVisualChildren(this.tensionerHexGroup);
      this.cloneAndTrackTensionerMaterials(tensHex);
      this.tensionerHexGroup.add(tensHex);
      tagSubtreeInteractable(this.tensionerHexGroup, 'tensionerHex');
    }

    if (tensPinHole) {
      clearVisualChildren(this.tensionerPinHoleGroup);
      this.cloneAndTrackTensionerMaterials(tensPinHole);
      this.tensionerPinHoleGroup.add(tensPinHole);
      tagSubtreeInteractable(this.tensionerPinHoleGroup, 'tensionerPinHole');
    }

    if (tensPin) {
      clearVisualChildren(this.tensionerPinMesh);
      this.cloneObjectMaterials(tensPin);
      this.tensionerPinMesh.add(tensPin);
      tagSubtreeInteractable(this.tensionerPinMesh, 'tensionerPinHole');
    }

    this.setTensionerState(this.tensionerState);
  }

  private cloneObjectMaterials(root: THREE.Object3D): void {
    const cache = new Map<THREE.Material, THREE.Material>();
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mapOne = (m: THREE.Material): THREE.Material => {
        const hit = cache.get(m);
        if (hit) return hit;
        const c = m.clone();
        cache.set(m, c);
        return c;
      };
      obj.material = Array.isArray(obj.material) ? obj.material.map(mapOne) : mapOne(obj.material);
    });
  }

  private cloneAndTrackTensionerMaterials(root: THREE.Object3D): void {
    const cache = new Map<THREE.Material, THREE.Material>();
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mapOne = (m: THREE.Material): THREE.Material => {
        const hit = cache.get(m);
        if (hit) return hit;
        const c = m.clone();
        cache.set(m, c);
        if (c instanceof THREE.MeshStandardMaterial) {
          if (m.name.includes('Tensioner_Roller')) {
            this.blenderTensionerRollerMats.push(c);
          } else if (m.name.includes('Tensioner_Bolt')) {
            this.blenderTensionerBoltMats.push(c);
          } else if (m.name.includes('Tensioner_Old') || m.name.includes('Cast')) {
            this.blenderTensionerCastMats.push(c);
          }
        }
        return c;
      };
      obj.material = Array.isArray(obj.material) ? obj.material.map(mapOne) : mapOne(obj.material);
    });
  }

  public setBeltState(state: BeltVisualState): void {
    if (this.beltState === state) return;
    this.beltState = state;
    this.rebuildBeltGeometries();
    this.syncVisibilityState();
  }

  public setRoutingProgress(nodes: BeltPulleyNode[]): void {
    this.routingNodes = [...nodes];
    if (this.beltState === 'routing') {
      const path = this.computeAnalyticalBeltPath(false);
      this.rebuildRoutingHighlights(path);
    }
  }

  public setTensionerProgress(progress: number): void {
    const clamped = Math.max(0, Math.min(1, progress));
    if (Math.abs(clamped - this.tensionerProgress) < 1e-4) return;
    this.tensionerProgress = clamped;
    this.applyTensionerTransform();
    this.rebuildBeltGeometries();
  }

  public setPinInserted(inserted: boolean): void {
    this.pinInserted = inserted;
    this.syncVisibilityState();
  }

  public setTensionerState(state: TensionerVisualState): void {
    this.tensionerState = state;
    const mat = state === 'new' ? this.newTensionerMat : this.oldTensionerMat;
    this.tensionerHousingGroup.traverse((obj) => {
      if (
        obj instanceof THREE.Mesh &&
        obj !== this.tensionerStationaryHoleRing &&
        obj.material !== this.pinAlignedRingMat &&
        (obj.material === this.oldTensionerMat || obj.material === this.newTensionerMat)
      ) {
        obj.material = mat;
      }
    });
    this.tensionerArmGroup.traverse((obj) => {
      if (
        obj instanceof THREE.Mesh &&
        (obj.material === this.oldTensionerMat || obj.material === this.newTensionerMat)
      ) {
        obj.material = mat;
      }
    });
    this.tensionerRollerMat.color.setHex(state === 'new' ? 0xdbe3ec : 0x9aa2ab);
    this.tensionerBoltMat.color.setHex(state === 'new' ? 0xe2e8f0 : 0x87909b);

    for (const m of this.blenderTensionerCastMats) {
      m.color.setHex(state === 'new' ? 0xd0d7e0 : 0x7e8389);
      m.metalness = state === 'new' ? 0.80 : 0.65;
      m.roughness = state === 'new' ? 0.26 : 0.54;
    }
    for (const m of this.blenderTensionerRollerMats) {
      m.color.setHex(state === 'new' ? 0xdbe3ec : 0x9aa2ab);
    }
    for (const m of this.blenderTensionerBoltMats) {
      m.color.setHex(state === 'new' ? 0xe2e8f0 : 0x87909b);
    }

    this.syncVisibilityState();
    this.applyTensionerTransform();
  }

  public getTensionerHexTransform(): {
    pos: THREE.Vector3;
    quat: THREE.Quaternion;
    angleRad: number;
  } {
    this.group.updateMatrixWorld(true);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    this.tensionerHexGroup.getWorldPosition(pos);
    this.tensionerHexGroup.getWorldQuaternion(quat);
    return {
      pos,
      quat,
      angleRad: this.getTensionerAngle(),
    };
  }

  public setEngineRunning(running: boolean, rpm = 820): void {
    this.engineRunning = running;
    this.engineRpm = rpm;
    if (!running) {
      this.engineCoreGroup.position.set(0, 0, 0);
      this.engineCoreGroup.rotation.set(0, 0, 0);
    }
  }

  public triggerManualCrank(turns = 2): void {
    this.manualCrankAnim = {
      active: true,
      elapsed: 0,
      duration: 1.8,
      totalAngle: -Math.PI * 2 * turns, // Clockwise manual rotation of crankshaft
      lastAngle: 0,
    };
  }

  public triggerPulleySpinCheck(pulley: 'alternator' | 'ac'): void {
    this.pulleySpinAnim = {
      active: true,
      pulley,
      elapsed: 0,
      duration: 1.0,
    };
  }

  public update(dt: number): void {
    const safeDt = Math.min(dt, 0.05);
    this.animClock += safeDt;

    // 1. Pulse cyan ghost silhouettes smoothly
    if (this.beltState === 'routing') {
      this.ghostSlotMat.opacity = 0.28 + 0.14 * Math.sin(this.animClock * 4.2);
    }
    if (this.tensionerState === 'removed') {
      this.mountSlotMat.opacity = 0.3 + 0.16 * Math.sin(this.animClock * 4.2);
    }

    // 2. Engine running kinematics & subtle 4-cylinder diesel idle vibration (0.4 mm)
    if (this.engineRunning) {
      const omegaCrank = (this.engineRpm / 60) * Math.PI * 2;
      // Scale visual belt surface speed slightly for crisp browser frame readability without strobing
      const vBelt = omegaCrank * PULLEY_SPECS.crank.radius * 0.32;
      this.advanceKinematicsByBeltDistance(vBelt * safeDt);

      const fireFreq = (this.engineRpm / 60) * 2 * Math.PI * 2;
      const vib = 0.0004;
      this.engineCoreGroup.position.set(
        Math.sin(this.animClock * fireFreq * 1.1) * vib * 0.6,
        Math.sin(this.animClock * fireFreq) * vib,
        Math.cos(this.animClock * fireFreq * 0.5) * vib * 0.5
      );
      this.engineCoreGroup.rotation.z = Math.sin(this.animClock * fireFreq) * 0.0009;
    }

    // 3. Smooth 720-deg manual cranking animation
    if (this.manualCrankAnim.active) {
      this.manualCrankAnim.elapsed += safeDt;
      const t = Math.min(1, this.manualCrankAnim.elapsed / this.manualCrankAnim.duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const targetAngle = this.manualCrankAnim.totalAngle * eased;
      const dAngle = targetAngle - this.manualCrankAnim.lastAngle;
      this.manualCrankAnim.lastAngle = targetAngle;

      // Mechanically couple belt & all pulleys to crank angle change
      const ds = dAngle * PULLEY_SPECS.crank.radius * PULLEY_SPECS.crank.wrapDir;
      this.advanceKinematicsByBeltDistance(ds);

      if (t >= 1) {
        this.manualCrankAnim.active = false;
      }
    }

    // 4. Individual freewheel / bearing hand spin check
    if (this.pulleySpinAnim.active) {
      this.pulleySpinAnim.elapsed += safeDt;
      const t = Math.min(1, this.pulleySpinAnim.elapsed / this.pulleySpinAnim.duration);
      const speedDecay = (1 - t) * (1 - t);
      const omega = 28 * speedDecay;
      if (this.pulleySpinAnim.pulley === 'alternator') {
        this.alternatorSpinGroup.rotation.x += omega * safeDt;
      } else {
        this.acSpinGroup.rotation.x += omega * safeDt;
      }
      if (t >= 1) {
        this.pulleySpinAnim.active = false;
      }
    }
  }

  public getInteractables(): THREE.Object3D[] {
    const list: THREE.Object3D[] = [
      this.interactableCrankBolt,
      this.interactableCrank,
      this.interactableAc,
      this.interactableAlternator,
    ];

    if (this.tensionerState === 'removed') {
      list.push(this.interactableMountSlot);
    } else {
      list.push(
        this.interactableTensionerHex,
        this.interactableTensionerPinHole,
        this.interactableTensionerBolt,
        this.interactableTensionerRoller
      );
    }

    if (this.beltState === 'old') {
      list.push(this.interactableOldBelt);
    } else if (this.beltState === 'routing') {
      list.push(this.interactableNewBeltSlot);
    }

    return list;
  }

  public getPartWorldPos(id: InteractableId): THREE.Vector3 | null {
    this.group.updateMatrixWorld(true);
    const out = new THREE.Vector3();

    switch (id) {
      case 'pulley_crank':
        this.interactableCrank.getWorldPosition(out);
        return out;
      case 'crankBolt':
        this.crankBoltGroup.getWorldPosition(out);
        out.x += 0.024;
        return out;
      case 'pulley_ac':
        this.interactableAc.getWorldPosition(out);
        return out;
      case 'pulley_alternator':
        this.interactableAlternator.getWorldPosition(out);
        return out;
      case 'pulley_tensioner':
        this.tensionerRollerSpinGroup.getWorldPosition(out);
        return out;
      case 'tensionerHex':
        this.tensionerHexGroup.getWorldPosition(out);
        return out;
      case 'tensionerPinHole':
        if (this.pinInserted) {
          this.tensionerPinMesh.getWorldPosition(out);
        } else {
          this.tensionerPinHoleGroup.getWorldPosition(out);
        }
        return out;
      case 'tensionerBolt':
        this.tensionerBoltGroup.getWorldPosition(out);
        out.x -= 0.014;
        return out;
      case 'tensionerMountSlot':
        this.tensionerMountSlotGroup.getWorldPosition(out);
        return out;
      case 'oldBelt':
        return this.group.localToWorld(uvToLocal(0.06, -0.02, 0));
      case 'newBeltSlot':
        return this.group.localToWorld(uvToLocal(0.06, -0.02, 0));
      default:
        return null;
    }
  }

  public dispose(): void {
    for (const tex of this.disposableTextures) {
      tex.dispose();
    }
    for (const mat of this.disposableMaterials) {
      mat.dispose();
    }
    for (const geo of this.disposableGeometries) {
      geo.dispose();
    }
    this.oldBeltMesh.geometry.dispose();
    this.newBeltMesh.geometry.dispose();
    this.newBeltGhostMesh.geometry.dispose();
    // Clean any routing highlight meshes
    while (this.routingHighlightGroup.children.length > 0) {
      const child = this.routingHighlightGroup.children[0] as THREE.Mesh;
      this.routingHighlightGroup.remove(child);
      child.geometry.dispose();
      if (child.material instanceof THREE.Material) {
        child.material.dispose();
      }
    }
    // Note: Tensioner root & bolt references stay cleanly managed
    void this.tensionerRootGroup;
    void this.interactableTensionerRoller;
    void this.interactableTensionerHex;
    void this.interactableTensionerPinHole;
    void this.interactableTensionerBolt;
  }
}
