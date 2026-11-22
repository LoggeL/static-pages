import * as THREE from 'three';
import {
  clearVisualChildren,
  extractNode,
  loadGLB,
  tagSubtreeInteractable,
} from '../engine/AssetLoader';
import type { InteractableId } from '../types';

interface PaintMaterialRecord {
  material: THREE.MeshStandardMaterial;
  baseColor: THREE.Color;
  baseMetalness: number;
  baseRoughness: number;
  baseClearcoat: number;
  isInteractable: boolean;
}

interface ScrewRecord {
  id: InteractableId;
  root: THREE.Group;
  spinGroup: THREE.Group;
  restPos: THREE.Vector3;
  pullDir: THREE.Vector3;
  progress: number;
  target: number;
  materials: THREE.MeshStandardMaterial[];
  usesWorldAxisSpin?: boolean;
}

interface StrutPair {
  baseAnchor: THREE.Vector3;
  hoodLocalAnchor: THREE.Vector3;
  cylinder: THREE.Mesh;
  rod: THREE.Mesh;
}

const PACIFIC_BLUE = new THREE.Color(0x1e4c92);
const XRAY_BLUE = new THREE.Color(0x3898ff);

const FRONT_AXLE_Z = -1.32;
const REAR_AXLE_Z = 1.31;
const WHEEL_CENTER_X = 0.76;
const WHEEL_CENTER_Y = 0.317;
const TIRE_RADIUS = 0.317;
const HUB_FACE_X = 0.69;
const BOLT_CIRCLE_RADIUS = 0.056;
const HOOD_HINGE_Y = 0.94;
const HOOD_HINGE_Z = -0.82;
const HOOD_OPEN_RAD = (52 * Math.PI) / 180;

const WHEEL_RACK_WORLD_X = 2.35;
const WHEEL_RACK_WORLD_Z = -0.35;

/**
 * Procedural 3D model of the VW Golf 7 Mk7 (1.6 TDI) in metallic blue.
 * Implements the exact coordinate contract with a truly hollow front-right wheel arch cutout
 * (X in [+0.45, +0.84], Y in [0.16, 0.78], Z in [-1.72, -0.92]) exposing X = +0.44 unobstructed.
 */
export class Golf7Model {
  public readonly group = new THREE.Group();

  private readonly staticBodyGroup = new THREE.Group();
  private readonly staticSuspGroup = new THREE.Group();
  private readonly hubGroup = new THREE.Group();

  private readonly interactables: THREE.Object3D[] = [];
  private readonly partAnchors = new Map<InteractableId, THREE.Object3D>();
  private readonly exteriorPaintMaterials: PaintMaterialRecord[] = [];
  private readonly suspensionXrayMaterials: THREE.MeshStandardMaterial[] = [];

  private readonly hoodGroup = new THREE.Group();
  private readonly hoodStruts: StrutPair[] = [];
  private hoodProgress = 0;
  private hoodTarget = 0;

  private readonly engineCoverGroup = new THREE.Group();
  private readonly engineCoverMaterials: THREE.MeshStandardMaterial[] = [];
  private engineCoverProgress = 0;
  private engineCoverTarget = 0;

  private readonly lugBolts: ScrewRecord[] = [];
  private readonly linerScrews: ScrewRecord[] = [];

  private readonly frontRightWheelGroup = new THREE.Group();
  private readonly frontRightWheelMaterials: THREE.MeshStandardMaterial[] = [];
  private wheelProgress = 0;
  private wheelTarget = 0;
  private storedOffLiftY = 0;

  private readonly wheelLinerGroup = new THREE.Group();
  private readonly wheelLinerMaterials: THREE.MeshStandardMaterial[] = [];
  private linerProgress = 0;
  private linerTarget = 0;

  private readonly wheelLinerSlotGroup = new THREE.Group();

  private xrayBlend = 0;
  private xrayTarget = 0;

  // Reusable temporaries to avoid per-frame allocations
  private readonly upY = new THREE.Vector3(0, 1, 0);
  private readonly tmpVecA = new THREE.Vector3();
  private readonly tmpVecB = new THREE.Vector3();
  private readonly tmpVecC = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();

  constructor() {
    this.group.name = 'VW_Golf7_Mk7';
    this.staticBodyGroup.name = 'StaticBodyRoot';
    this.staticSuspGroup.name = 'StaticSuspRoot';
    this.group.add(this.staticBodyGroup, this.staticSuspGroup);

    const sharedTextures = {
      vwBadge: this.createVwBadgeTexture(),
      tdiPlaque: this.createTdiPlaqueTexture(),
      plate: this.createLicensePlateTexture(),
      tireTread: this.createTireTreadTexture(),
      rotorMachined: this.createRotorTexture(),
      honeycomb: this.createHoneycombTexture(),
    };

    this.buildBodyShell(sharedTextures);
    this.buildEngineBaySurround();
    this.buildHood(sharedTextures.vwBadge);
    this.buildEngineCover(sharedTextures.tdiPlaque);
    this.buildStaticWheelsAndBrakes(sharedTextures);
    this.buildFrontRightSuspensionAndHub(sharedTextures.rotorMachined);
    this.buildFrontRightWheelAndLugBolts(sharedTextures);
    this.buildWheelLinerAndScrews();
    this.buildWheelLinerGhostSlot();
  }

  public async loadBlenderModel(): Promise<void> {
    const glb = await loadGLB('./models/golf7.glb');

    this.exteriorPaintMaterials.length = 0;
    this.suspensionXrayMaterials.length = 0;

    // 1. Body Shell (paint, glass, lights, interior, bay surround, 3 static wheels)
    const bodyShell = extractNode(glb, 'Golf7_BodyShell', false);
    if (bodyShell) {
      this.staticBodyGroup.clear();
      this.staticBodyGroup.add(bodyShell);
      bodyShell.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if (mat instanceof THREE.MeshStandardMaterial && mat.name.startsWith('Golf7_Paint')) {
            if (!this.exteriorPaintMaterials.some((r) => r.material === mat)) {
              this.exteriorPaintMaterials.push({
                material: mat,
                baseColor: mat.color.clone(),
                baseMetalness: mat.metalness,
                baseRoughness: mat.roughness,
                baseClearcoat: mat instanceof THREE.MeshPhysicalMaterial ? mat.clearcoat : 0,
                isInteractable: false,
              });
            }
          }
        }
      });
    }

    // 2. Hood Pivot (clone Golf7_Paint so hover highlight on hood stays isolated)
    const hoodNode = extractNode(glb, 'Golf7_HoodPivot', true);
    if (hoodNode) {
      clearVisualChildren(this.hoodGroup);
      hoodNode.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const cloneMat = (m: THREE.Material) => {
          const c = m.clone();
          if (c instanceof THREE.MeshStandardMaterial && m.name.startsWith('Golf7_Paint')) {
            this.exteriorPaintMaterials.push({
              material: c,
              baseColor: c.color.clone(),
              baseMetalness: c.metalness,
              baseRoughness: c.roughness,
              baseClearcoat: c instanceof THREE.MeshPhysicalMaterial ? c.clearcoat : 0,
              isInteractable: true,
            });
          }
          return c;
        };
        obj.material = Array.isArray(obj.material)
          ? obj.material.map(cloneMat)
          : cloneMat(obj.material);
      });
      this.hoodGroup.add(hoodNode);
      tagSubtreeInteractable(this.hoodGroup, 'hood');
      this.applyHoodTransform();
    }

    // 3. Engine Cover
    const coverNode = extractNode(glb, 'Golf7_EngineCover', true);
    if (coverNode) {
      clearVisualChildren(this.engineCoverGroup);
      this.engineCoverMaterials.length = 0;
      this.collectAndCloneMaterials(coverNode, this.engineCoverMaterials);
      this.engineCoverGroup.add(coverNode);
      tagSubtreeInteractable(this.engineCoverGroup, 'engineCover');
      this.applyEngineCoverTransform();
    }

    // 4. Front-Right Suspension & Wheel Hub (also included in X-Ray mode!)
    const suspNode = extractNode(glb, 'Golf7_FrontRightSuspension', false);
    if (suspNode) {
      this.staticSuspGroup.clear();
      this.staticSuspGroup.add(suspNode);
      this.collectAndCloneMaterials(suspNode, this.suspensionXrayMaterials);
    }

    const hubNode = extractNode(glb, 'Golf7_WheelHub', true);
    if (hubNode) {
      clearVisualChildren(this.hubGroup);
      this.collectAndCloneMaterials(hubNode, this.suspensionXrayMaterials);
      this.hubGroup.add(hubNode);
      tagSubtreeInteractable(this.hubGroup, 'wheelHub');
    }

    // 5. Front-Right Wheel & 5 Lug Bolts
    const wheelNode = extractNode(glb, 'Golf7_FrontRightWheel', true);
    if (wheelNode) {
      clearVisualChildren(this.frontRightWheelGroup);
      this.frontRightWheelMaterials.length = 0;
      this.collectAndCloneMaterials(wheelNode, this.frontRightWheelMaterials);
      this.frontRightWheelGroup.add(wheelNode);
      tagSubtreeInteractable(this.frontRightWheelGroup, 'frontRightWheel');
      this.applyFrontRightWheelTransform();
    }

    for (let i = 0; i < this.lugBolts.length; i++) {
      const bolt = this.lugBolts[i];
      const boltNode = extractNode(glb, `Golf7_LugBolt_${i}`, true);
      if (boltNode) {
        clearVisualChildren(bolt.spinGroup);
        bolt.materials.length = 0;
        this.collectAndCloneMaterials(boltNode, bolt.materials);
        bolt.spinGroup.add(boltNode);
        tagSubtreeInteractable(bolt.root, bolt.id);
        this.applyScrewTransform(bolt, 0.14, 18);
      }
    }

    // 6. Wheel Arch Liner & 6 Torx T25 Screws
    const linerNode = extractNode(glb, 'Golf7_WheelLiner', true);
    if (linerNode) {
      clearVisualChildren(this.wheelLinerGroup);
      this.wheelLinerMaterials.length = 0;
      this.collectAndCloneMaterials(linerNode, this.wheelLinerMaterials);
      this.wheelLinerGroup.add(linerNode);
      tagSubtreeInteractable(this.wheelLinerGroup, 'wheelLiner');
      this.applyLinerTransform();
    }

    for (let i = 0; i < this.linerScrews.length; i++) {
      const screw = this.linerScrews[i];
      const screwNode = extractNode(glb, `Golf7_LinerScrew_${i}`, true);
      if (screwNode) {
        clearVisualChildren(screw.spinGroup);
        screw.root.quaternion.identity();
        screw.spinGroup.rotation.set(0, 0, 0);
        screw.usesWorldAxisSpin = true;
        screw.materials.length = 0;
        this.collectAndCloneMaterials(screwNode, screw.materials);
        screw.spinGroup.add(screwNode);
        tagSubtreeInteractable(screw.root, screw.id);
        this.applyScrewTransform(screw, 0.075, 16);
      }
    }

    this.refreshInteractables();
    this.applyXRayBlend();
  }

  private collectAndCloneMaterials(
    root: THREE.Object3D,
    outList: THREE.MeshStandardMaterial[]
  ): void {
    const cache = new Map<THREE.Material, THREE.Material>();
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mapOne = (m: THREE.Material): THREE.Material => {
        const existing = cache.get(m);
        if (existing) return existing;
        const cloned = m.clone();
        cache.set(m, cloned);
        if (cloned instanceof THREE.MeshStandardMaterial) {
          outList.push(cloned);
        }
        return cloned;
      };
      obj.material = Array.isArray(obj.material) ? obj.material.map(mapOne) : mapOne(obj.material);
    });
  }

  private refreshInteractables(): void {
    this.interactables.length = 0;
    const roots: THREE.Object3D[] = [
      this.hoodGroup,
      this.engineCoverGroup,
      this.hubGroup,
      this.frontRightWheelGroup,
      this.wheelLinerGroup,
      this.wheelLinerSlotGroup,
      ...this.lugBolts.map((b) => b.root),
      ...this.linerScrews.map((s) => s.root),
    ];
    for (const r of roots) {
      r.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.userData?.interactableId) {
          this.interactables.push(obj);
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  public setHoodOpen(open: boolean, instant = false): void {
    this.hoodTarget = open ? 1 : 0;
    if (instant) {
      this.hoodProgress = this.hoodTarget;
      this.applyHoodTransform();
    }
  }

  public setEngineCoverRemoved(removed: boolean, instant = false): void {
    this.engineCoverTarget = removed ? 1 : 0;
    if (instant) {
      this.engineCoverProgress = this.engineCoverTarget;
      this.applyEngineCoverTransform();
    }
  }

  public setLugBoltRemoved(index: number, removed: boolean, instant = false): void {
    const bolt = this.lugBolts[index];
    if (!bolt) return;
    bolt.target = removed ? 1 : 0;
    if (instant) {
      bolt.progress = bolt.target;
      this.applyScrewTransform(bolt, 0.14, 18);
    }
  }

  public setWheelRemoved(removed: boolean, instant = false): void {
    this.wheelTarget = removed ? 1 : 0;
    if (instant) {
      this.wheelProgress = this.wheelTarget;
      this.applyFrontRightWheelTransform();
    }
  }

  public setLinerScrewRemoved(index: number, removed: boolean, instant = false): void {
    const screw = this.linerScrews[index];
    if (!screw) return;
    screw.target = removed ? 1 : 0;
    if (instant) {
      screw.progress = screw.target;
      this.applyScrewTransform(screw, 0.075, 16);
    }
  }

  public setLinerRemoved(removed: boolean, instant = false): void {
    this.linerTarget = removed ? 1 : 0;
    if (instant) {
      this.linerProgress = this.linerTarget;
      this.applyLinerTransform();
    }
  }

  public setXRay(enabled: boolean): void {
    this.xrayTarget = enabled ? 1 : 0;
  }

  public setGhostSlotVisible(id: 'wheelLinerSlot', visible: boolean): void {
    if (id === 'wheelLinerSlot') {
      this.wheelLinerSlotGroup.visible = visible;
    }
  }

  public setStoredOffLiftY(liftY: number): void {
    this.storedOffLiftY = liftY;
    if (this.wheelProgress > 0.35) {
      this.applyFrontRightWheelTransform();
    }
  }

  public update(dt: number): void {
    const clampedDt = Math.min(dt, 0.05);

    const nextHood = this.stepProgress(this.hoodProgress, this.hoodTarget, clampedDt, 2.2);
    if (nextHood !== null) {
      this.hoodProgress = nextHood;
      this.applyHoodTransform();
    }

    const nextCover = this.stepProgress(this.engineCoverProgress, this.engineCoverTarget, clampedDt, 2.4);
    if (nextCover !== null) {
      this.engineCoverProgress = nextCover;
      this.applyEngineCoverTransform();
    }

    for (const bolt of this.lugBolts) {
      const next = this.stepProgress(bolt.progress, bolt.target, clampedDt, 4.2);
      if (next !== null) {
        bolt.progress = next;
        this.applyScrewTransform(bolt, 0.14, 18);
      }
    }

    const nextWheel = this.stepProgress(this.wheelProgress, this.wheelTarget, clampedDt, 1.5);
    if (nextWheel !== null) {
      this.wheelProgress = nextWheel;
      this.applyFrontRightWheelTransform();
    }

    for (const screw of this.linerScrews) {
      const next = this.stepProgress(screw.progress, screw.target, clampedDt, 4.6);
      if (next !== null) {
        screw.progress = next;
        this.applyScrewTransform(screw, 0.075, 16);
      }
    }

    const nextLiner = this.stepProgress(this.linerProgress, this.linerTarget, clampedDt, 2.1);
    if (nextLiner !== null) {
      this.linerProgress = nextLiner;
      this.applyLinerTransform();
    }

    const nextXray = this.stepProgress(this.xrayBlend, this.xrayTarget, clampedDt, 3.6);
    if (nextXray !== null) {
      this.xrayBlend = nextXray;
      this.applyXRayBlend();
    }
  }

  public getInteractables(): THREE.Object3D[] {
    return this.interactables;
  }

  public getPartWorldPos(id: InteractableId): THREE.Vector3 | null {
    const anchor = this.partAnchors.get(id);
    if (!anchor) return null;
    this.group.updateMatrixWorld(true);
    return anchor.getWorldPosition(new THREE.Vector3());
  }

  // ---------------------------------------------------------------------------
  // Animation Helpers
  // ---------------------------------------------------------------------------

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

  private applyHoodTransform(): void {
    const eased = this.easeInOut(this.hoodProgress);
    this.hoodGroup.rotation.x = eased * HOOD_OPEN_RAD;
    this.hoodGroup.updateMatrixWorld(true);

    for (const strut of this.hoodStruts) {
      // Compute upper anchor in rootGroup local space using hoodGroup rotation around X
      const cosA = Math.cos(this.hoodGroup.rotation.x);
      const sinA = Math.sin(this.hoodGroup.rotation.x);
      const ly = strut.hoodLocalAnchor.y;
      const lz = strut.hoodLocalAnchor.z;
      this.tmpVecA.set(
        strut.hoodLocalAnchor.x,
        HOOD_HINGE_Y + ly * cosA - lz * sinA,
        HOOD_HINGE_Z + ly * sinA + lz * cosA
      );
      this.tmpVecB.copy(strut.baseAnchor);

      const dist = this.tmpVecA.distanceTo(this.tmpVecB);
      this.tmpVecC.copy(this.tmpVecA).sub(this.tmpVecB).normalize();

      // Orient cylinder from baseAnchor toward hoodAnchor
      strut.cylinder.position.copy(this.tmpVecB).addScaledVector(this.tmpVecC, 0.105);
      strut.cylinder.quaternion.setFromUnitVectors(this.upY, this.tmpVecC);

      // Chrome piston rod spans from midpoint to upper ball stud
      const rodLen = Math.max(0.06, dist - 0.14);
      strut.rod.scale.set(1, rodLen / 0.22, 1);
      strut.rod.position.copy(this.tmpVecA).addScaledVector(this.tmpVecC, -rodLen * 0.5);
      strut.rod.quaternion.copy(strut.cylinder.quaternion);
    }
  }

  private applyEngineCoverTransform(): void {
    const t = this.engineCoverProgress;
    if (t >= 0.999) {
      this.engineCoverGroup.visible = false;
      return;
    }
    this.engineCoverGroup.visible = true;

    // Phase 1 (0..0.4): lift straight up off rubber pins; Phase 2 (0.4..1): glide upward & fade out
    const liftT = Math.min(1, t / 0.4);
    const moveT = Math.max(0, (t - 0.4) / 0.6);
    const eLift = this.easeInOut(liftT);
    const eMove = this.easeInOut(moveT);

    this.engineCoverGroup.position.set(
      0.02 - eMove * 0.42,
      0.77 + eLift * 0.22 + eMove * 0.28,
      -1.32 - eMove * 0.18
    );
    this.engineCoverGroup.rotation.set(eMove * 0.12, eMove * 0.22, eMove * 0.18);

    const alpha = 1 - eMove;
    const isTransparent = alpha < 0.99;
    for (const mat of this.engineCoverMaterials) {
      mat.transparent = isTransparent;
      mat.opacity = alpha;
      mat.depthWrite = !isTransparent;
    }
  }

  private applyScrewTransform(screw: ScrewRecord, pullDistance: number, totalRotRad: number): void {
    const t = screw.progress;
    if (t >= 0.999) {
      screw.root.visible = false;
      return;
    }
    screw.root.visible = true;

    const slideT = Math.min(1, t / 0.72);
    const fadeT = Math.max(0, (t - 0.72) / 0.28);
    const eSlide = this.easeInOut(slideT);

    screw.root.position.copy(screw.restPos).addScaledVector(screw.pullDir, eSlide * pullDistance);
    if (screw.usesWorldAxisSpin) {
      screw.spinGroup.setRotationFromAxisAngle(screw.pullDir, -eSlide * totalRotRad);
    } else {
      screw.spinGroup.rotation.x = -eSlide * totalRotRad;
    }

    const alpha = 1 - fadeT;
    const isTransparent = alpha < 0.99;
    for (const mat of screw.materials) {
      mat.transparent = isTransparent;
      mat.opacity = alpha;
      mat.depthWrite = !isTransparent;
    }
  }

  private applyFrontRightWheelTransform(): void {
    const t = this.wheelProgress;
    if (t <= 0.0001) {
      this.frontRightWheelGroup.position.set(WHEEL_CENTER_X, WHEEL_CENTER_Y, FRONT_AXLE_Z);
      this.frontRightWheelGroup.rotation.set(0, 0, 0);
      return;
    }

    // Phase 1 (0..0.35): pull straight out along +X off the hub spigot
    // Phase 2 (0.35..1): arc smoothly to resting spot beside the tire rack, grounded on floor
    if (t <= 0.35) {
      const p = this.easeInOut(t / 0.35);
      this.frontRightWheelGroup.position.set(
        WHEEL_CENTER_X + p * 0.44,
        WHEEL_CENTER_Y + Math.sin(p * Math.PI) * 0.02,
        FRONT_AXLE_Z
      );
      this.frontRightWheelGroup.rotation.set(0, 0, 0);
    } else {
      const p = this.easeInOut((t - 0.35) / 0.65);
      const startX = WHEEL_CENTER_X + 0.44;
      const startY = WHEEL_CENTER_Y;
      const endY = TIRE_RADIUS - this.storedOffLiftY;

      // Quadratic Bezier arc clearing the right lift column cleanly
      const ctrlX = 2.08;
      const ctrlY = Math.max(startY, endY) + 0.16;
      const ctrlZ = -0.96;

      const inv = 1 - p;
      const x = inv * inv * startX + 2 * inv * p * ctrlX + p * p * WHEEL_RACK_WORLD_X;
      const y = inv * inv * startY + 2 * inv * p * ctrlY + p * p * endY;
      const z = inv * inv * FRONT_AXLE_Z + 2 * inv * p * ctrlZ + p * p * WHEEL_RACK_WORLD_Z;

      this.frontRightWheelGroup.position.set(x, y, z);
      this.frontRightWheelGroup.rotation.set(0, -p * 0.32, 0);
    }
  }

  private applyLinerTransform(): void {
    const t = this.linerProgress;
    if (t >= 0.999) {
      this.wheelLinerGroup.visible = false;
      return;
    }
    this.wheelLinerGroup.visible = true;

    const pullT = Math.min(1, t / 0.65);
    const fadeT = Math.max(0, (t - 0.65) / 0.35);
    const ePull = this.easeInOut(pullT);

    this.wheelLinerGroup.position.set(ePull * 0.48, -ePull * 0.10, ePull * 0.04);
    this.wheelLinerGroup.rotation.set(0, ePull * 0.14, -ePull * 0.08);

    const alpha = 1 - fadeT;
    const isTransparent = alpha < 0.99;
    for (const mat of this.wheelLinerMaterials) {
      mat.transparent = isTransparent;
      mat.opacity = alpha;
      mat.depthWrite = !isTransparent;
    }
  }

  private applyXRayBlend(): void {
    const b = this.xrayBlend;
    const transparent = b > 0.005;

    for (const rec of this.exteriorPaintMaterials) {
      const m = rec.material;
      this.tmpColor.copy(rec.baseColor).lerp(XRAY_BLUE, b);
      m.color.copy(this.tmpColor);
      m.transparent = transparent;
      m.depthWrite = !transparent;
      m.opacity = 1 - 0.80 * b;
      m.metalness = rec.baseMetalness * (1 - b) + 0.12 * b;
      m.roughness = rec.baseRoughness * (1 - b) + 0.10 * b;
      if (m instanceof THREE.MeshPhysicalMaterial) {
        m.clearcoat = rec.baseClearcoat * (1 - b) + 0.45 * b;
      }

      if (!rec.isInteractable) {
        m.emissive.setHex(0x0b4a6e);
        m.emissiveIntensity = 0.25 * b;
      }
    }

    for (const m of this.suspensionXrayMaterials) {
      m.transparent = transparent;
      m.depthWrite = !transparent;
      m.opacity = 1 - 0.84 * b;
    }
  }

  // ---------------------------------------------------------------------------
  // Body Shell Construction (Sculpted Panels with Real Hollow Wheel Arches)
  // ---------------------------------------------------------------------------

  private createPaintMaterial(isInteractable = false): THREE.MeshPhysicalMaterial {
    const mat = new THREE.MeshPhysicalMaterial({
      color: PACIFIC_BLUE.clone(),
      metalness: 0.62,
      roughness: 0.24,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
    });
    this.exteriorPaintMaterials.push({
      material: mat,
      baseColor: PACIFIC_BLUE.clone(),
      baseMetalness: 0.62,
      baseRoughness: 0.24,
      baseClearcoat: 1.0,
      isInteractable,
    });
    return mat;
  }

  /**
   * Computes the lower Y boundary of the car side profile, carving exact semicircular + vertical-drop
   * wheel arch cutouts at front (Z = -1.32) and rear (Z = +1.31) so X in [+0.45, +0.84] is genuinely hollow.
   */
  private sampleSideBottomY(z: number): number {
    const archHalfZ = 0.395;
    const archCrownY = 0.742;
    const archSpringY = 0.32;

    for (const axleZ of [FRONT_AXLE_Z, REAR_AXLE_Z]) {
      const dz = z - axleZ;
      if (Math.abs(dz) < archHalfZ) {
        const u = dz / archHalfZ;
        const arc = Math.sqrt(Math.max(0, 1 - u * u));
        return archSpringY + (archCrownY - archSpringY) * arc;
      }
    }

    if (z < -1.72) {
      const t = Math.min(1, (-1.72 - z) / 0.40);
      return 0.17 + t * 0.05;
    }
    if (z > 1.72) {
      const t = Math.min(1, (z - 1.72) / 0.40);
      return 0.175 + t * 0.095;
    }
    return 0.16;
  }

  /**
   * Computes outer X half-width of the Golf 7 Mk7 body flank with realistic nose/tail taper,
   * tornado shoulder crease, lower door sculpt, and wheel-arch fender flares.
   */
  private sampleSideOuterX(z: number, y: number, yTop: number): number {
    let baseWidth = 0.858;
    if (z < -1.68) {
      const t = Math.min(1, (-1.68 - z) / 0.44);
      baseWidth = 0.858 - 0.17 * t * t;
    } else if (z > 1.65) {
      const t = Math.min(1, (z - 1.65) / 0.47);
      baseWidth = 0.858 - 0.13 * t * t;
    }

    // Subtle wheel-arch eyebrow flare around both wheel cutouts
    for (const axleZ of [FRONT_AXLE_Z, REAR_AXLE_Z]) {
      const dz = Math.abs(z - axleZ);
      if (dz < 0.47 && y < 0.84) {
        const flare = Math.cos((dz / 0.47) * (Math.PI * 0.5));
        const vertWeight = Math.max(0, 1 - Math.abs(y - 0.56) / 0.28);
        baseWidth += 0.024 * flare * vertWeight;
      }
    }

    // Vertical cross-section: rocker tuck -> lower sculpt -> Mk7 shoulder line -> window tumblehome
    const shoulderY = 0.81 + ((z + 2.0) / 4.0) * 0.06;
    if (y < 0.24) {
      const tuck = (0.24 - y) / 0.08;
      return baseWidth - 0.025 * Math.min(1, tuck);
    }
    if (y < 0.48) {
      const mid = Math.sin(((y - 0.24) / 0.24) * Math.PI);
      return baseWidth - 0.018 * mid;
    }
    if (y <= shoulderY) {
      const p = (y - 0.48) / Math.max(0.05, shoulderY - 0.48);
      return baseWidth + 0.008 * p;
    }

    // Above shoulder crease: clean tumblehome inward toward beltline / C-pillar
    const span = Math.max(0.06, yTop - shoulderY);
    const tTop = Math.min(1, (y - shoulderY) / span);
    return baseWidth + 0.008 - tTop * (yTop > 1.15 ? 0.23 : 0.095);
  }

  /**
   * Builds a solid closed-edge sheet-metal skin mesh between zSamples along [yBottom(z)..yTop(z)]
   * with an authentic rolled sheet-metal return lip (thickness ~0.045m) along top and bottom boundaries.
   */
  private buildSculptedBodySidePanel(
    side: 1 | -1,
    zSamples: number[],
    getTopY: (z: number) => number,
    mat: THREE.Material
  ): THREE.Mesh {
    const vSteps = 9;
    const cols = zSamples.length;
    const lipThickness = 0.045;

    // Cross-section rows per column:
    // 0: inner bottom lip, 1..vSteps: outer skin bottom->top, vSteps+1: inner top lip
    const rowsPerCol = vSteps + 2;
    const positions: number[] = [];
    const indices: number[] = [];

    for (let c = 0; c < cols; c++) {
      const z = zSamples[c];
      const yBot = this.sampleSideBottomY(z);
      const yTop = Math.max(yBot + 0.03, getTopY(z));

      const xBot = this.sampleSideOuterX(z, yBot, yTop);
      const xTop = this.sampleSideOuterX(z, yTop, yTop);

      // Row 0: inner return lip at bottom/wheel-arch edge
      positions.push(side * (xBot - lipThickness), yBot, z);

      // Rows 1..vSteps: outer body contour with crisp shoulder break
      for (let r = 0; r < vSteps; r++) {
        const frac = r / (vSteps - 1);
        const y = yBot + (yTop - yBot) * frac;
        const x = this.sampleSideOuterX(z, y, yTop);
        positions.push(side * x, y, z);
      }

      // Row vSteps+1: inner return lip at top edge
      positions.push(side * (xTop - lipThickness), yTop, z);
    }

    for (let c = 0; c < cols - 1; c++) {
      for (let r = 0; r < rowsPerCol - 1; r++) {
        const a = c * rowsPerCol + r;
        const b = (c + 1) * rowsPerCol + r;
        const d = (c + 1) * rowsPerCol + (r + 1);
        const e = c * rowsPerCol + (r + 1);

        if (side === 1) {
          indices.push(a, d, b, a, e, d);
        } else {
          indices.push(a, b, d, a, d, e);
        }
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    // Use DoubleSide so inner wheel-well overhang lip looks solid without filling the cutout
    const doubleSideMat = mat;
    const mesh = new THREE.Mesh(geom, doubleSideMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildBodyShell(textures: {
    vwBadge: THREE.CanvasTexture;
    plate: THREE.CanvasTexture;
    honeycomb: THREE.CanvasTexture;
  }): void {
    const bodyGroup = new THREE.Group();
    bodyGroup.name = 'BodyShell';
    this.staticBodyGroup.add(bodyGroup);

    const paintMat = this.createPaintMaterial(false);
    paintMat.side = THREE.DoubleSide;

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x0b1118,
      metalness: 0.12,
      roughness: 0.05,
      opacity: 0.86,
      transparent: true,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      side: THREE.DoubleSide,
    });

    const glossBlackMat = new THREE.MeshStandardMaterial({
      color: 0x111419,
      metalness: 0.36,
      roughness: 0.24,
    });

    const matteTrimMat = new THREE.MeshStandardMaterial({
      color: 0x181b20,
      metalness: 0.08,
      roughness: 0.72,
    });

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xe6ebf2,
      metalness: 0.94,
      roughness: 0.12,
    });

    const drlMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      emissive: 0xe2f2ff,
      emissiveIntensity: 1.8,
      roughness: 0.15,
    });

    const tailRedMat = new THREE.MeshStandardMaterial({
      color: 0x991b1b,
      emissive: 0xdc2626,
      emissiveIntensity: 0.85,
      roughness: 0.2,
    });

    // 1. Front Fenders (Left & Right) with true hollow arch cutout Z in [-1.715, -0.925]
    const frontFenderZ = this.buildDenseZSamples(-2.02, -0.82, [
      -1.73, -1.715, -1.68, -1.62, -1.53, -1.43, -1.32, -1.21, -1.11, -1.02, -0.96, -0.925, -0.91,
    ]);
    const getFrontFenderTopY = (z: number): number => {
      const t = (z - -2.02) / (-0.82 - -2.02);
      return 0.64 + 0.295 * Math.pow(t, 0.88);
    };

    // 2. Doors + Rear Quarter + Rear Fender (Z = -0.82 .. +1.98) with hollow rear arch cutout
    const bodySideZ = this.buildDenseZSamples(-0.82, 1.98, [
      0.06, 0.88, 0.915, 0.95, 1.02, 1.12, 1.22, 1.31, 1.40, 1.50, 1.60, 1.67, 1.705, 1.72, 1.84,
    ]);
    const getBodySideTopY = (z: number): number => {
      if (z <= 0.95) {
        const t = (z - -0.82) / (0.95 - -0.82);
        return 0.935 + t * 0.055;
      }
      if (z <= 1.48) {
        // Iconic Golf 7 swept C-pillar shoulder rising up to roof spoiler
        const t = (z - 0.95) / (1.48 - 0.95);
        const smooth = t * t * (3 - 2 * t);
        return 0.99 + smooth * 0.40;
      }
      // Rear hatch wrap tapering down toward tailgate & taillight corner
      const t = (z - 1.48) / (1.98 - 1.48);
      return 1.39 - t * 0.44;
    };

    for (const side of [1, -1] as const) {
      bodyGroup.add(this.buildSculptedBodySidePanel(side, frontFenderZ, getFrontFenderTopY, paintMat));
      bodyGroup.add(this.buildSculptedBodySidePanel(side, bodySideZ, getBodySideTopY, paintMat));

      // Black lower rocker molding skirt (stops strictly behind front wheel well Z = -0.915!)
      const rocker = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.065, 1.80), matteTrimMat);
      rocker.position.set(side * 0.835, 0.165, 0.0);
      bodyGroup.add(rocker);

      // Flush body-coloured door handles (front & rear doors)
      for (const hz of [-0.06, 0.72]) {
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.026, 0.145), paintMat);
        handle.position.set(side * 0.865, hz < 0 ? 0.835 : 0.855, hz);
        bodyGroup.add(handle);
      }

      // Gloss black door shutline accent strips
      for (const sz of [-0.82, 0.06, 0.86]) {
        const seam = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.68, 0.006), glossBlackMat);
        seam.position.set(side * 0.858, 0.56, sz);
        bodyGroup.add(seam);
      }

      // Sculpted A-pillar, B-pillar & cabin side glass
      this.buildGreenhouseSide(bodyGroup, side, paintMat, glossBlackMat, glassMat);

      // Side mirror with LED turn indicator strip
      this.buildSideMirror(bodyGroup, side, paintMat, glossBlackMat, drlMat);
    }

    // 3. Roof & Roof Spoiler
    this.buildRoofAndGreenhouse(bodyGroup, paintMat, glossBlackMat, glassMat);

    // 4. Front Bumper Fascia, Mk7 Grille, VW Badge, Headlights & Lower Honeycomb Air Dam
    this.buildFrontFascia(
      bodyGroup,
      paintMat,
      glossBlackMat,
      matteTrimMat,
      chromeMat,
      drlMat,
      glassMat,
      textures
    );

    // 5. Rear Hatch, Taillights, Diffuser & Dual TDI Exhaust Pipes
    this.buildRearFascia(
      bodyGroup,
      paintMat,
      glossBlackMat,
      matteTrimMat,
      chromeMat,
      tailRedMat,
      glassMat,
      textures
    );

    // 6. Underbody Floor Tray & Simple Cabin Silhouette (strictly behind front wheel well Z >= -0.90)
    const floorPan = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.04, 2.86), matteTrimMat);
    floorPan.position.set(0, 0.175, 0.53);
    floorPan.receiveShadow = true;
    bodyGroup.add(floorPan);

    // Lift jacking pinch-weld rails along left/right sills (between axles)
    for (const side of [1, -1] as const) {
      const pinch = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 1.56), matteTrimMat);
      pinch.position.set(side * 0.68, 0.155, 0.0);
      bodyGroup.add(pinch);
    }

    this.buildSimpleCabinInterior(bodyGroup, matteTrimMat);
  }

  private buildDenseZSamples(start: number, end: number, extras: number[]): number[] {
    const set = new Set<number>([start, end]);
    const steps = 16;
    for (let i = 1; i < steps; i++) {
      set.add(Number((start + ((end - start) * i) / steps).toFixed(4)));
    }
    for (const e of extras) {
      if (e >= start && e <= end) set.add(e);
    }
    return Array.from(set).sort((a, b) => a - b);
  }

  private buildGreenhouseSide(
    parent: THREE.Group,
    side: 1 | -1,
    paintMat: THREE.Material,
    glossBlackMat: THREE.Material,
    glassMat: THREE.Material
  ): void {
    // Side window polygon in ZY plane
    const winShape = new THREE.Shape();
    winShape.moveTo(-0.78, 0.94);
    winShape.lineTo(-0.20, 1.40);
    winShape.lineTo(0.86, 1.41);
    winShape.lineTo(1.28, 1.36);
    winShape.lineTo(1.06, 1.00);
    winShape.lineTo(0.06, 0.96);
    winShape.closePath();

    const winGeom = new THREE.ShapeGeometry(winShape);
    const pos = winGeom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getX(i);
      const y = pos.getY(i);
      const t = Math.max(0, Math.min(1, (y - 0.94) / 0.47));
      const x = side * (0.76 - t * 0.16);
      pos.setXYZ(i, x, y, z);
    }
    winGeom.computeVertexNormals();
    const winMesh = new THREE.Mesh(winGeom, glassMat);
    parent.add(winMesh);

    // Gloss black B-pillar applique
    const bPillar = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.45, 0.115), glossBlackMat);
    bPillar.position.set(side * 0.695, 1.185, 0.08);
    bPillar.rotation.z = side * 0.34;
    parent.add(bPillar);

    // Body-coloured A-pillar strip running from hood hinge up to roof front edge
    const aPillarLen = Math.hypot(-0.21 - -0.82, 1.425 - 0.935);
    const aPillar = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.052, aPillarLen), paintMat);
    aPillar.position.set(side * 0.685, (0.935 + 1.425) * 0.5, (-0.82 + -0.21) * 0.5);
    aPillar.rotation.x = Math.atan2(1.425 - 0.935, -0.21 - -0.82);
    aPillar.rotation.y = side * -0.17;
    parent.add(aPillar);
  }

  private buildSideMirror(
    parent: THREE.Group,
    side: 1 | -1,
    paintMat: THREE.Material,
    glossBlackMat: THREE.Material,
    drlMat: THREE.Material
  ): void {
    const mirrorGroup = new THREE.Group();
    mirrorGroup.position.set(side * 0.80, 0.96, -0.64);

    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.036, 0.07), glossBlackMat);
    stalk.position.set(side * 0.04, -0.015, 0);
    stalk.rotation.z = side * 0.25;
    mirrorGroup.add(stalk);

    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.095, 0.105), paintMat);
    shell.position.set(side * 0.11, 0.01, 0.02);
    shell.rotation.y = side * -0.18;
    mirrorGroup.add(shell);

    const signal = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.012, 0.018), drlMat);
    signal.position.set(side * 0.115, 0.004, -0.032);
    signal.rotation.y = side * -0.18;
    mirrorGroup.add(signal);

    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.115, 0.075),
      new THREE.MeshStandardMaterial({ color: 0x9fb3c8, metalness: 0.92, roughness: 0.08 })
    );
    glass.position.set(side * 0.11, 0.01, 0.074);
    glass.rotation.y = side * -0.18;
    mirrorGroup.add(glass);

    parent.add(mirrorGroup);
  }

  private buildRoofAndGreenhouse(
    parent: THREE.Group,
    paintMat: THREE.Material,
    glossBlackMat: THREE.Material,
    glassMat: THREE.Material
  ): void {
    // Swept Golf 7 cambered roof panel
    const zSteps = 12;
    const xSteps = 8;
    const positions: number[] = [];
    const indices: number[] = [];

    for (let iz = 0; iz <= zSteps; iz++) {
      const tz = iz / zSteps;
      const z = -0.22 + tz * (1.46 - -0.22);
      const halfW = 0.61 - tz * 0.03 + Math.sin(tz * Math.PI) * 0.02;
      const centerY = 1.43 + Math.sin(tz * Math.PI * 0.85) * 0.032 - tz * 0.035;

      for (let ix = 0; ix <= xSteps; ix++) {
        const tx = (ix / xSteps) * 2 - 1;
        const x = tx * halfW;
        const camber = (1 - tx * tx) * 0.018;
        positions.push(x, centerY + camber, z);
      }
    }

    const rowLen = xSteps + 1;
    for (let iz = 0; iz < zSteps; iz++) {
      for (let ix = 0; ix < xSteps; ix++) {
        const a = iz * rowLen + ix;
        const b = (iz + 1) * rowLen + ix;
        const c = (iz + 1) * rowLen + (ix + 1);
        const d = iz * rowLen + (ix + 1);
        indices.push(a, b, c, a, c, d);
      }
    }

    const roofGeom = new THREE.BufferGeometry();
    roofGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    roofGeom.setIndex(indices);
    roofGeom.computeVertexNormals();
    const roofMesh = new THREE.Mesh(roofGeom, paintMat);
    roofMesh.castShadow = true;
    parent.add(roofMesh);

    // Shark-fin antenna
    const finShape = new THREE.Shape();
    finShape.moveTo(-0.075, 0);
    finShape.lineTo(0.065, 0);
    finShape.lineTo(0.052, 0.055);
    finShape.quadraticCurveTo(0.0, 0.048, -0.075, 0);
    const finGeom = new THREE.ExtrudeGeometry(finShape, { depth: 0.024, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004 });
    finGeom.rotateY(Math.PI / 2);
    finGeom.translate(-0.012, 1.435, 1.06);
    parent.add(new THREE.Mesh(finGeom, glossBlackMat));

    // Front Windshield (curved plane)
    const wsGeom = new THREE.PlaneGeometry(1.32, 0.79, 8, 2);
    const wsPos = wsGeom.attributes.position;
    for (let i = 0; i < wsPos.count; i++) {
      const lx = wsPos.getX(i);
      const ly = wsPos.getY(i);
      const fracY = (ly + 0.395) / 0.79; // 0 = cowl, 1 = roof header
      const x = lx * (1.0 - fracY * 0.12);
      const z = -0.82 + fracY * 0.60 + (lx * lx) * 0.08;
      const y = 0.94 + fracY * 0.49;
      wsPos.setXYZ(i, x, y, z);
    }
    wsGeom.computeVertexNormals();
    parent.add(new THREE.Mesh(wsGeom, glassMat));

    // Black plenum cowl + twin wiper arms
    const cowl = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.045, 0.14), glossBlackMat);
    cowl.position.set(0, 0.92, -0.84);
    parent.add(cowl);

    for (const wx of [-0.26, 0.18]) {
      const wiper = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.014, 0.022), glossBlackMat);
      wiper.position.set(wx, 0.945, -0.80);
      wiper.rotation.y = 0.08;
      parent.add(wiper);
    }

    // Rear Roof Spoiler + Gloss Black Side Aero Blades
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.20, 0.042, 0.17), paintMat);
    spoiler.position.set(0, 1.40, 1.48);
    spoiler.rotation.x = 0.08;
    spoiler.castShadow = true;
    parent.add(spoiler);

    for (const side of [1, -1] as const) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.24, 0.09), glossBlackMat);
      blade.position.set(side * 0.595, 1.28, 1.56);
      blade.rotation.x = -0.58;
      parent.add(blade);
    }

    // Rear Hatch Glass
    const rearGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.16, 0.50), glassMat);
    rearGlass.position.set(0, 1.21, 1.69);
    rearGlass.rotation.x = 0.85;
    parent.add(rearGlass);
  }

  private buildFrontFascia(
    parent: THREE.Group,
    paintMat: THREE.Material,
    glossBlackMat: THREE.Material,
    matteTrimMat: THREE.Material,
    chromeMat: THREE.Material,
    drlMat: THREE.Material,
    glassMat: THREE.Material,
    textures: { vwBadge: THREE.CanvasTexture; plate: THREE.CanvasTexture; honeycomb: THREE.CanvasTexture }
  ): void {
    // Curved front bumper fascia spanning Z = -2.12 .. -1.72 (stops ahead of front wheel well!)
    const bumperGroup = new THREE.Group();
    parent.add(bumperGroup);

    // Sculpted upper & lower bumper crossmember skin
    const segs = 16;
    const rows = 5;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let r = 0; r < rows; r++) {
      const fy = r / (rows - 1);
      const y = 0.18 + fy * 0.48; // 0.18 .. 0.66
      const zPush = Math.sin(fy * Math.PI * 0.75) * 0.05;
      for (let s = 0; s <= segs; s++) {
        const fx = (s / segs) * 2 - 1;
        const x = fx * 0.84;
        const z = -2.115 + 0.34 * fx * fx - zPush * (1 - fx * fx);
        pos.push(x, y, z);
      }
    }
    const stride = segs + 1;
    for (let r = 0; r < rows - 1; r++) {
      for (let s = 0; s < segs; s++) {
        const a = r * stride + s;
        const b = (r + 1) * stride + s;
        const c = (r + 1) * stride + (s + 1);
        const d = r * stride + (s + 1);
        idx.push(a, b, c, a, c, d);
      }
    }
    const bumperGeom = new THREE.BufferGeometry();
    bumperGeom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    bumperGeom.setIndex(idx);
    bumperGeom.computeVertexNormals();
    const bumperMesh = new THREE.Mesh(bumperGeom, paintMat);
    bumperMesh.castShadow = true;
    bumperGroup.add(bumperMesh);

    // Lower matte black chin splitter
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.032, 0.14), matteTrimMat);
    splitter.position.set(0, 0.17, -2.02);
    bumperGroup.add(splitter);

    // Lower trapezoidal honeycomb air dam
    const lowerGrilleMat = new THREE.MeshStandardMaterial({
      map: textures.honeycomb,
      color: 0x22262d,
      roughness: 0.7,
    });
    const lowerGrille = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.19, 0.05), lowerGrilleMat);
    lowerGrille.position.set(0, 0.30, -2.09);
    bumperGroup.add(lowerGrille);

    // Left and right body-coloured bumper foglight fins
    for (const side of [1, -1] as const) {
      const fogHousing = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.06), glossBlackMat);
      fogHousing.position.set(side * 0.61, 0.31, -2.01);
      fogHousing.rotation.y = side * -0.34;
      bumperGroup.add(fogHousing);

      const strake = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.022, 0.07), paintMat);
      strake.position.set(side * 0.61, 0.31, -2.015);
      strake.rotation.y = side * -0.34;
      bumperGroup.add(strake);
    }

    // Upper Mk7 Grille + Signature Chrome Bar + VW Emblem
    const grilleBacking = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.115, 0.05), glossBlackMat);
    grilleBacking.position.set(0, 0.615, -2.09);
    bumperGroup.add(grilleBacking);

    const grilleChromeBar = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.016, 0.058), chromeMat);
    grilleChromeBar.position.set(0, 0.585, -2.095);
    bumperGroup.add(grilleChromeBar);

    // VW Emblem Ring + Badge
    const badgeOuter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.064, 0.064, 0.024, 32),
      chromeMat
    );
    badgeOuter.rotation.x = Math.PI / 2;
    badgeOuter.position.set(0, 0.625, -2.115);
    bumperGroup.add(badgeOuter);

    const badgeFace = new THREE.Mesh(
      new THREE.CircleGeometry(0.058, 32),
      new THREE.MeshStandardMaterial({ map: textures.vwBadge, metalness: 0.4, roughness: 0.25 })
    );
    badgeFace.rotation.y = Math.PI;
    badgeFace.position.set(0, 0.625, -2.129);
    bumperGroup.add(badgeFace);

    // Front License Plate
    const frontPlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.50, 0.11, 0.012),
      new THREE.MeshStandardMaterial({ map: textures.plate, roughness: 0.35 })
    );
    frontPlate.rotation.y = Math.PI;
    frontPlate.position.set(0, 0.45, -2.145);
    bumperGroup.add(frontPlate);

    // Sharp Mk7 Bi-Xenon / U-LED Headlights (left & right)
    for (const side of [1, -1] as const) {
      const hlGroup = new THREE.Group();
      hlGroup.position.set(side * 0.60, 0.615, -1.99);
      hlGroup.rotation.y = side * -0.32;

      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.125, 0.14), glossBlackMat);
      hlGroup.add(housing);

      // Twin projector optics
      for (const px of [-0.075, 0.065]) {
        const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.038, 0.04, 20), chromeMat);
        bezel.rotation.x = Math.PI / 2;
        bezel.position.set(px, 0.008, -0.045);
        hlGroup.add(bezel);

        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.024, 14, 14), drlMat);
        bulb.position.set(px, 0.008, -0.055);
        hlGroup.add(bulb);
      }

      // Signature Mk7 Double-U LED Daytime Running Light strips
      for (const ux of [-0.075, 0.065]) {
        const uCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(ux - 0.045, 0.015, -0.062),
          new THREE.Vector3(ux - 0.042, -0.038, -0.062),
          new THREE.Vector3(ux, -0.045, -0.062),
          new THREE.Vector3(ux + 0.042, -0.038, -0.062),
          new THREE.Vector3(ux + 0.045, 0.015, -0.062),
        ]);
        const uTube = new THREE.Mesh(new THREE.TubeGeometry(uCurve, 18, 0.005, 8, false), drlMat);
        hlGroup.add(uTube);
      }

      // Chrome eyebrow linking grille chrome strip across headlight
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.011, 0.018), chromeMat);
      brow.position.set(0, -0.044, -0.066);
      hlGroup.add(brow);

      // Clear polycarbonate outer lens
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.325, 0.13, 0.025), glassMat);
      lens.position.set(0, 0, -0.068);
      hlGroup.add(lens);

      bumperGroup.add(hlGroup);
    }
  }

  private buildRearFascia(
    parent: THREE.Group,
    paintMat: THREE.Material,
    glossBlackMat: THREE.Material,
    matteTrimMat: THREE.Material,
    chromeMat: THREE.Material,
    tailRedMat: THREE.Material,
    glassMat: THREE.Material,
    textures: { vwBadge: THREE.CanvasTexture; plate: THREE.CanvasTexture }
  ): void {
    const rearGroup = new THREE.Group();
    parent.add(rearGroup);

    // Tailgate upper & lower panels
    const hatchUpper = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.38, 0.12), paintMat);
    hatchUpper.position.set(0, 0.84, 1.98);
    hatchUpper.rotation.x = -0.26;
    hatchUpper.castShadow = true;
    rearGroup.add(hatchUpper);

    const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.34, 0.22), paintMat);
    rearBumper.position.set(0, 0.44, 2.00);
    rearBumper.castShadow = true;
    rearGroup.add(rearBumper);

    // Rear Hatch VW Badge
    const badgeOuter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.056, 0.056, 0.02, 28),
      chromeMat
    );
    badgeOuter.rotation.x = Math.PI / 2;
    badgeOuter.position.set(0, 0.88, 2.04);
    rearGroup.add(badgeOuter);

    const badgeFace = new THREE.Mesh(
      new THREE.CircleGeometry(0.05, 28),
      new THREE.MeshStandardMaterial({ map: textures.vwBadge, metalness: 0.4, roughness: 0.25 })
    );
    badgeFace.position.set(0, 0.88, 2.052);
    rearGroup.add(badgeFace);

    // Rear License Plate
    const rearPlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.50, 0.11, 0.012),
      new THREE.MeshStandardMaterial({ map: textures.plate, roughness: 0.35 })
    );
    rearPlate.position.set(0, 0.47, 2.116);
    rearGroup.add(rearPlate);

    // Angular Mk7 LED Taillights
    for (const side of [1, -1] as const) {
      const tlGroup = new THREE.Group();
      tlGroup.position.set(side * 0.54, 0.86, 1.99);
      tlGroup.rotation.y = side * 0.18;

      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.145, 0.09), tailRedMat);
      tlGroup.add(lens);

      const whiteBar = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.024, 0.095),
        new THREE.MeshStandardMaterial({ color: 0xf1f5f9, emissive: 0xffffff, emissiveIntensity: 0.3 })
      );
      whiteBar.position.set(side * -0.04, -0.02, 0.005);
      tlGroup.add(whiteBar);

      rearGroup.add(tlGroup);

      // Rear bumper red reflector
      const refl = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.026, 0.02), tailRedMat);
      refl.position.set(side * 0.58, 0.30, 2.11);
      rearGroup.add(refl);
    }

    // Rear Wiper
    const rearWiper = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.014, 0.018), glossBlackMat);
    rearWiper.position.set(0.11, 1.03, 1.93);
    rearWiper.rotation.x = 0.85;
    rearGroup.add(rearWiper);

    // Matte Black Rear Diffuser & Twin TDI Exhaust Tips (Left Side)
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.12, 0.10), matteTrimMat);
    diffuser.position.set(0, 0.23, 2.07);
    rearGroup.add(diffuser);

    for (const ex of [-0.52, -0.43]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.14, 20), chromeMat);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(ex, 0.21, 2.09);
      rearGroup.add(pipe);

      const bore = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, 0.04, 16),
        glossBlackMat
      );
      bore.rotation.x = Math.PI / 2;
      bore.position.set(ex, 0.21, 2.145);
      rearGroup.add(bore);
    }

    // Keep glassMat referenced for rear lamp specular cover
    const centerStop = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.02, 0.02), glassMat);
    centerStop.position.set(0, 1.385, 1.56);
    rearGroup.add(centerStop);
  }

  private buildSimpleCabinInterior(parent: THREE.Group, matteTrimMat: THREE.Material): void {
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x1e2229, roughness: 0.85 });

    // Dashboard cowl & steering wheel on driver side (-X)
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.22, 0.42), matteTrimMat);
    dash.position.set(0, 0.78, -0.60);
    parent.add(dash);

    const steeringWheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 10, 24), seatMat);
    steeringWheel.position.set(-0.34, 0.88, -0.35);
    steeringWheel.rotation.x = -0.35;
    parent.add(steeringWheel);

    // Front seats + rear bench
    for (const sx of [-0.34, 0.34]) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.48), seatMat);
      base.position.set(sx, 0.40, -0.05);
      parent.add(base);

      const back = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.56, 0.14), seatMat);
      back.position.set(sx, 0.70, 0.18);
      back.rotation.x = -0.18;
      parent.add(back);

      const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.16, 0.10), seatMat);
      headrest.position.set(sx, 1.06, 0.22);
      parent.add(headrest);
    }

    const rearBench = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.22, 0.48), seatMat);
    rearBench.position.set(0, 0.45, 0.78);
    parent.add(rearBench);

    const rearBack = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.50, 0.14), seatMat);
    rearBack.position.set(0, 0.76, 1.02);
    rearBack.rotation.x = -0.22;
    parent.add(rearBack);
  }

  // ---------------------------------------------------------------------------
  // Engine Bay Surround (Strictly Clear of Front-Right Wheel Arch Cavity!)
  // ---------------------------------------------------------------------------

  private buildEngineBaySurround(): void {
    const bayGroup = new THREE.Group();
    bayGroup.name = 'EngineBaySurround';
    this.staticBodyGroup.add(bayGroup);

    const baySteelMat = new THREE.MeshStandardMaterial({
      color: 0x20242b,
      metalness: 0.45,
      roughness: 0.55,
    });
    const plasticMat = new THREE.MeshStandardMaterial({
      color: 0x15181d,
      metalness: 0.08,
      roughness: 0.74,
    });
    const coolantBottleMat = new THREE.MeshPhysicalMaterial({
      color: 0xf4e8ee,
      roughness: 0.25,
      transparent: true,
      opacity: 0.72,
    });
    const coolantFluidMat = new THREE.MeshStandardMaterial({
      color: 0xec4899,
      roughness: 0.3,
    });

    // Firewall behind engine (Z = -0.82, completely behind front wheel arch Z = -0.92)
    const firewall = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.58, 0.08), baySteelMat);
    firewall.position.set(0, 0.62, -0.82);
    bayGroup.add(firewall);

    // Front radiator slam panel & radiator fan core (Z <= -1.78, completely ahead of wheel arch Z = -1.72!)
    const slamPanel = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.08, 0.12), plasticMat);
    slamPanel.position.set(0, 0.68, -1.86);
    bayGroup.add(slamPanel);

    const radiatorCore = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.38, 0.06), baySteelMat);
    radiatorCore.position.set(-0.04, 0.44, -1.84);
    bayGroup.add(radiatorCore);

    // Right-side upper fender apron rail (Y >= 0.79, strictly above cavity Y = 0.78)
    const rightApronRail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.045, 0.96), baySteelMat);
    rightApronRail.position.set(0.68, 0.85, -1.32);
    rightApronRail.rotation.x = -0.16;
    bayGroup.add(rightApronRail);

    // Right MacPherson strut top tower dome (Y = 0.78 .. 0.83)
    const rightStrutDome = new THREE.Mesh(
      new THREE.CylinderGeometry(0.095, 0.11, 0.06, 20),
      baySteelMat
    );
    rightStrutDome.position.set(0.56, 0.80, FRONT_AXLE_Z);
    bayGroup.add(rightStrutDome);

    // Left-side engine bay components (-X side: Battery, Airbox, Coolant Expansion Sphere, Strut Dome)
    const leftApron = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.34, 0.98), baySteelMat);
    leftApron.position.set(-0.62, 0.65, -1.32);
    bayGroup.add(leftApron);

    const batteryBox = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.21, 0.28), plasticMat);
    batteryBox.position.set(-0.46, 0.64, -1.16);
    bayGroup.add(batteryBox);

    const airFilterBox = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.30), plasticMat);
    airFilterBox.position.set(-0.45, 0.63, -1.52);
    bayGroup.add(airFilterBox);

    // Iconic Golf 7 G13 pink coolant expansion sphere on rear-right/left firewall edge (-X side)
    const coolantOrb = new THREE.Mesh(new THREE.SphereGeometry(0.095, 18, 16), coolantBottleMat);
    coolantOrb.position.set(-0.46, 0.77, -0.96);
    bayGroup.add(coolantOrb);

    const coolantFluid = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 12), coolantFluidMat);
    coolantFluid.scale.set(1, 0.65, 1);
    coolantFluid.position.set(-0.46, 0.75, -0.96);
    bayGroup.add(coolantFluid);

    const coolantCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 0.024, 16),
      new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.4 })
    );
    coolantCap.position.set(-0.46, 0.865, -0.96);
    bayGroup.add(coolantCap);
  }

  // ---------------------------------------------------------------------------
  // Openable Motorhaube (`hood`) + Twin Gas Struts
  // ---------------------------------------------------------------------------

  private buildHood(vwBadgeTex: THREE.CanvasTexture): void {
    this.hoodGroup.name = 'Hood';
    this.hoodGroup.position.set(0, HOOD_HINGE_Y, HOOD_HINGE_Z);
    this.group.add(this.hoodGroup);

    const hoodPaintMat = this.createPaintMaterial(true);
    hoodPaintMat.side = THREE.DoubleSide;

    const innerRibMat = new THREE.MeshStandardMaterial({
      color: 0x1b1e24,
      metalness: 0.32,
      roughness: 0.62,
    });

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.92,
      roughness: 0.14,
    });

    // Sculpted Mk7 hood surface in local coords relative to hinge (0, 0.94, -0.82)
    // Z_local goes from 0 (windshield edge) to -1.24 (nose lip at Z = -2.06)
    const zSteps = 12;
    const xSteps = 12;
    const positions: number[] = [];
    const indices: number[] = [];

    for (let iz = 0; iz <= zSteps; iz++) {
      const tz = iz / zSteps; // 0 at hinge, 1 at nose tip
      const lz = -tz * 1.24;
      const halfW = 0.735 - Math.pow(tz, 1.3) * 0.11;
      const slopeY = -tz * 0.255 - tz * tz * 0.03;

      for (let ix = 0; ix <= xSteps; ix++) {
        const fx = (ix / xSteps) * 2 - 1;
        const lx = fx * halfW;
        const crown = (1 - fx * fx) * 0.032 * (1 - tz * 0.25);
        // Signature Golf 7 twin V-creases radiating forward from A-pillars toward grille
        const creaseDist = Math.abs(Math.abs(fx) - (0.72 - tz * 0.24));
        const vCrease = creaseDist < 0.09 ? (1 - creaseDist / 0.09) * 0.011 : 0;
        positions.push(lx, slopeY + crown + vCrease, lz);
      }
    }

    const rowLen = xSteps + 1;
    for (let iz = 0; iz < zSteps; iz++) {
      for (let ix = 0; ix < xSteps; ix++) {
        const a = iz * rowLen + ix;
        const b = (iz + 1) * rowLen + ix;
        const c = (iz + 1) * rowLen + (ix + 1);
        const d = iz * rowLen + (ix + 1);
        indices.push(a, d, c, a, c, b);
      }
    }

    const hoodGeom = new THREE.BufferGeometry();
    hoodGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    hoodGeom.setIndex(indices);
    hoodGeom.computeVertexNormals();

    const hoodSkin = new THREE.Mesh(hoodGeom, hoodPaintMat);
    hoodSkin.castShadow = true;
    hoodSkin.receiveShadow = true;
    this.hoodGroup.add(hoodSkin);

    // Underside sound-deadening blanket & stamped dark structural X-ribs
    const underPad = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.014, 0.96), innerRibMat);
    underPad.position.set(0, -0.115, -0.58);
    underPad.rotation.x = 0.22;
    this.hoodGroup.add(underPad);

    for (const side of [1, -1] as const) {
      const sideBeam = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.025, 1.12), innerRibMat);
      sideBeam.position.set(side * 0.62, -0.115, -0.58);
      sideBeam.rotation.x = 0.22;
      sideBeam.rotation.y = side * -0.07;
      this.hoodGroup.add(sideBeam);

      const diagRib = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.88), innerRibMat);
      diagRib.position.set(side * 0.26, -0.12, -0.56);
      diagRib.rotation.x = 0.22;
      diagRib.rotation.y = side * 0.42;
      this.hoodGroup.add(diagRib);
    }

    // Hood front striker latch U-loop
    const striker = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 8, 16, Math.PI), chromeMat);
    striker.position.set(0, -0.285, -1.16);
    striker.rotation.x = Math.PI;
    this.hoodGroup.add(striker);

    // Keep vwBadgeTex clean / subtle inner VW service decal on underside
    const serviceSticker = new THREE.Mesh(
      new THREE.CircleGeometry(0.032, 20),
      new THREE.MeshStandardMaterial({ map: vwBadgeTex, roughness: 0.4 })
    );
    serviceSticker.position.set(-0.32, -0.22, -0.96);
    serviceSticker.rotation.x = Math.PI / 2 + 0.22;
    this.hoodGroup.add(serviceSticker);

    // Anchor at front center grab lip for guide arrow / tool focus
    const hoodAnchor = new THREE.Object3D();
    hoodAnchor.position.set(0, -0.25, -1.18);
    hoodAnchor.userData.preserveOnHydrate = true;
    this.hoodGroup.add(hoodAnchor);
    this.partAnchors.set('hood', hoodAnchor);

    // Twin hydraulic gas struts (attached in rootGroup space, updated in applyHoodTransform)
    const strutCylMat = new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.45 });
    for (const side of [1, -1] as const) {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.21, 10), strutCylMat);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.22, 10), chromeMat);
      this.group.add(cyl, rod);
      this.hoodStruts.push({
        baseAnchor: new THREE.Vector3(side * 0.65, 0.85, -1.04),
        hoodLocalAnchor: new THREE.Vector3(side * 0.64, -0.095, -0.58),
        cylinder: cyl,
        rod,
      });
    }

    this.tagInteractable(this.hoodGroup, 'hood');
    this.applyHoodTransform();
  }

  // ---------------------------------------------------------------------------
  // Removable TDI Engine Cover (`engineCover`)
  // ---------------------------------------------------------------------------

  private buildEngineCover(tdiPlaqueTex: THREE.CanvasTexture): void {
    this.engineCoverGroup.name = 'EngineCover';
    this.engineCoverGroup.position.set(0.02, 0.77, -1.32);
    this.group.add(this.engineCoverGroup);

    const plasticMat = new THREE.MeshStandardMaterial({
      color: 0x1c2026,
      metalness: 0.14,
      roughness: 0.62,
    });
    const silverTrimMat = new THREE.MeshStandardMaterial({
      color: 0xbac2cc,
      metalness: 0.78,
      roughness: 0.26,
    });
    const plaqueMat = new THREE.MeshStandardMaterial({
      map: tdiPlaqueTex,
      metalness: 0.35,
      roughness: 0.32,
    });
    const capMat = new THREE.MeshStandardMaterial({
      color: 0x111317,
      roughness: 0.48,
    });

    this.engineCoverMaterials.push(plasticMat, silverTrimMat, plaqueMat, capMat);

    // Main sculpted acoustic cover shell
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.048, 0.42), plasticMat);
    base.castShadow = true;
    base.receiveShadow = true;
    this.engineCoverGroup.add(base);

    // Molded longitudinal acoustic ribs
    for (const rx of [-0.15, -0.05, 0.05, 0.15]) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.018, 0.36), plasticMat);
      rib.position.set(rx, 0.028, 0.01);
      this.engineCoverGroup.add(rib);
    }

    // Brushed silver diagonal EA288 accent strip
    const accent = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.012, 0.055), silverTrimMat);
    accent.position.set(0, 0.032, -0.08);
    accent.rotation.y = 0.22;
    this.engineCoverGroup.add(accent);

    // TDI + VW Logo Plaque
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.105), plaqueMat);
    plaque.rotation.x = -Math.PI / 2;
    plaque.position.set(0.05, 0.039, 0.055);
    this.engineCoverGroup.add(plaque);

    // Oil filler cap collar & cap cutout on front-left corner
    const oilCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.044, 0.024, 20), plasticMat);
    oilCollar.position.set(-0.15, 0.028, -0.12);
    this.engineCoverGroup.add(oilCollar);

    const oilCap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.024, 16), capMat);
    oilCap.position.set(-0.15, 0.036, -0.12);
    this.engineCoverGroup.add(oilCap);

    this.partAnchors.set('engineCover', this.engineCoverGroup);
    this.tagInteractable(this.engineCoverGroup, 'engineCover');
  }

  // ---------------------------------------------------------------------------
  // Wheels & Brakes
  // ---------------------------------------------------------------------------

  private createWheelMeshSet(
    textures: { vwBadge: THREE.CanvasTexture; tireTread: THREE.CanvasTexture },
    includeLugBolts: boolean
  ): { group: THREE.Group; materials: THREE.MeshStandardMaterial[] } {
    const wheel = new THREE.Group();

    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x1b1e23,
      map: textures.tireTread,
      bumpMap: textures.tireTread,
      bumpScale: 0.004,
      roughness: 0.84,
      metalness: 0.04,
    });
    const alloyMat = new THREE.MeshStandardMaterial({
      color: 0xd4dae2,
      metalness: 0.88,
      roughness: 0.22,
    });
    const pocketMat = new THREE.MeshStandardMaterial({
      color: 0x262a31,
      metalness: 0.58,
      roughness: 0.36,
    });
    const badgeMat = new THREE.MeshStandardMaterial({
      map: textures.vwBadge,
      metalness: 0.45,
      roughness: 0.28,
    });
    const boltMat = new THREE.MeshStandardMaterial({
      color: 0xd8dfe8,
      metalness: 0.92,
      roughness: 0.16,
    });

    // Tire profile revolved around Y, then rotated so axle axis is X
    // Wheel center is X = +0.76, hub mounting plane is X = +0.69 (local -0.07)
    const tireProfile = [
      new THREE.Vector2(0.214, -0.098),
      new THREE.Vector2(0.296, -0.105),
      new THREE.Vector2(0.317, -0.088),
      new THREE.Vector2(0.317, 0.088),
      new THREE.Vector2(0.296, 0.105),
      new THREE.Vector2(0.214, 0.098),
      new THREE.Vector2(0.214, -0.098),
    ];
    const tireGeom = new THREE.LatheGeometry(tireProfile, 40);
    tireGeom.rotateZ(-Math.PI / 2);
    const tireMesh = new THREE.Mesh(tireGeom, tireMat);
    tireMesh.castShadow = true;
    tireMesh.receiveShadow = true;
    wheel.add(tireMesh);

    // Alloy outer lip & inner barrel
    const barrelProfile = [
      new THREE.Vector2(0.214, -0.095),
      new THREE.Vector2(0.216, 0.095),
      new THREE.Vector2(0.200, 0.095),
      new THREE.Vector2(0.184, 0.042),
      new THREE.Vector2(0.184, -0.085),
      new THREE.Vector2(0.200, -0.095),
    ];
    const barrelGeom = new THREE.LatheGeometry(barrelProfile, 36);
    barrelGeom.rotateZ(-Math.PI / 2);
    wheel.add(new THREE.Mesh(barrelGeom, alloyMat));

    // Anthracite inner spoke pocket backing ring
    const pocketRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.195, 0.195, 0.022, 32),
      pocketMat
    );
    pocketRing.rotation.z = Math.PI / 2;
    pocketRing.position.x = 0.015;
    wheel.add(pocketRing);

    // Center hub boss (inner face sits at local X = -0.070 -> world X = 0.69!)
    const hubBoss = new THREE.Mesh(
      new THREE.CylinderGeometry(0.078, 0.082, 0.105, 24),
      alloyMat
    );
    hubBoss.rotation.z = Math.PI / 2;
    hubBoss.position.x = -0.018;
    wheel.add(hubBoss);

    // 5 VW "Dijon" twin-spoke alloy spokes
    for (let i = 0; i < 5; i++) {
      const baseAngle = (i * 2 * Math.PI) / 5;
      for (const offset of [-0.14, 0.14]) {
        const a = baseAngle + offset;
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.132, 0.021), alloyMat);
        const rMid = 0.138;
        spoke.position.set(0.052, Math.sin(a) * rMid, Math.cos(a) * rMid);
        spoke.rotation.x = -a;
        spoke.rotation.y = offset > 0 ? 0.12 : -0.12;
        spoke.rotation.z = -0.14;
        wheel.add(spoke);
      }
    }

    // Center VW Emblem Cap
    const centerCap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.014, 24), badgeMat);
    centerCap.rotation.z = -Math.PI / 2;
    centerCap.position.x = 0.052;
    wheel.add(centerCap);

    // 5 Lug Pockets (and static lug bolts for non-removable wheels)
    for (let i = 0; i < 5; i++) {
      const a = (i * 2 * Math.PI) / 5 + Math.PI / 10;
      const ly = Math.sin(a) * BOLT_CIRCLE_RADIUS;
      const lz = Math.cos(a) * BOLT_CIRCLE_RADIUS;

      const pocket = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, 0.018, 12),
        pocketMat
      );
      pocket.rotation.z = Math.PI / 2;
      pocket.position.set(0.036, ly, lz);
      wheel.add(pocket);

      if (includeLugBolts) {
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.010, 0.018, 6), boltMat);
        bolt.rotation.z = Math.PI / 2;
        bolt.position.set(0.044, ly, lz);
        wheel.add(bolt);
      }
    }

    return {
      group: wheel,
      materials: [tireMat, alloyMat, pocketMat, badgeMat, boltMat],
    };
  }

  private buildStaticWheelsAndBrakes(textures: {
    vwBadge: THREE.CanvasTexture;
    tireTread: THREE.CanvasTexture;
    rotorMachined: THREE.CanvasTexture;
  }): void {
    const rotorMat = new THREE.MeshStandardMaterial({
      map: textures.rotorMachined,
      color: 0xc2c9d2,
      metalness: 0.85,
      roughness: 0.28,
    });
    const caliperMat = new THREE.MeshStandardMaterial({
      color: 0x6b7280,
      metalness: 0.55,
      roughness: 0.45,
    });

    const placements: Array<{ x: number; z: number; flipLeft: boolean }> = [
      { x: -WHEEL_CENTER_X, z: FRONT_AXLE_Z, flipLeft: true },
      { x: -WHEEL_CENTER_X, z: REAR_AXLE_Z, flipLeft: true },
      { x: WHEEL_CENTER_X, z: REAR_AXLE_Z, flipLeft: false },
    ];

    for (const p of placements) {
      const { group } = this.createWheelMeshSet(textures, true);
      group.position.set(p.x, WHEEL_CENTER_Y, p.z);
      if (p.flipLeft) {
        group.rotation.y = Math.PI;
      }
      this.staticBodyGroup.add(group);

      // Backing brake disc + caliper behind each static wheel
      const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.148, 0.148, 0.022, 28), rotorMat);
      rotor.rotation.z = Math.PI / 2;
      rotor.position.set(p.x + (p.flipLeft ? 0.085 : -0.085), WHEEL_CENTER_Y, p.z);
      this.staticBodyGroup.add(rotor);

      const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.115, 0.082), caliperMat);
      caliper.position.set(p.x + (p.flipLeft ? 0.085 : -0.085), WHEEL_CENTER_Y + 0.02, p.z + 0.115);
      this.staticBodyGroup.add(caliper);
    }
  }

  // ---------------------------------------------------------------------------
  // Front-Right Wheel Well Suspension, Brake Rotor/Caliper & Wheel Hub
  // ---------------------------------------------------------------------------

  private buildFrontRightSuspensionAndHub(rotorTex: THREE.CanvasTexture): void {
    const suspGroup = new THREE.Group();
    suspGroup.name = 'FrontRightSuspension';
    this.staticSuspGroup.add(suspGroup);

    const ironMat = new THREE.MeshStandardMaterial({
      color: 0x3b4048,
      metalness: 0.65,
      roughness: 0.52,
    });
    const rotorFrictionMat = new THREE.MeshStandardMaterial({
      map: rotorTex,
      color: 0xd0d6de,
      metalness: 0.88,
      roughness: 0.24,
    });
    const caliperMat = new THREE.MeshStandardMaterial({
      color: 0x767f8b,
      metalness: 0.52,
      roughness: 0.44,
    });
    const blackGlossMat = new THREE.MeshStandardMaterial({
      color: 0x15181e,
      metalness: 0.45,
      roughness: 0.26,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xe5eaf0,
      metalness: 0.94,
      roughness: 0.12,
    });

    // 1. Vented Machined Brake Rotor (R = 0.155 m, centered at X = 0.672, Y = 0.317, Z = -1.32)
    const rotorHat = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.084, 0.028, 28), ironMat);
    rotorHat.rotation.z = Math.PI / 2;
    rotorHat.position.set(0.675, WHEEL_CENTER_Y, FRONT_AXLE_Z);
    suspGroup.add(rotorHat);

    for (const sideX of [0.663, 0.677]) {
      const frictionDisc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.155, 0.155, 0.008, 36),
        rotorFrictionMat
      );
      frictionDisc.rotation.z = Math.PI / 2;
      frictionDisc.position.set(sideX, WHEEL_CENTER_Y, FRONT_AXLE_Z);
      suspGroup.add(frictionDisc);
    }

    // Vented internal cooling vanes visible along rotor rim
    for (let i = 0; i < 18; i++) {
      const a = (i * 2 * Math.PI) / 18;
      const vane = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.032, 0.004), ironMat);
      vane.position.set(
        0.670,
        WHEEL_CENTER_Y + Math.sin(a) * 0.138,
        FRONT_AXLE_Z + Math.cos(a) * 0.138
      );
      vane.rotation.x = -a;
      suspGroup.add(vane);
    }

    // 2. Cast Grey Brake Caliper (straddling rear edge of rotor at Z = -1.19)
    const caliperBody = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.135, 0.088), caliperMat);
    caliperBody.position.set(0.674, WHEEL_CENTER_Y + 0.015, -1.19);
    caliperBody.castShadow = true;
    suspGroup.add(caliperBody);

    const caliperBridge = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.08, 0.055), caliperMat);
    caliperBridge.position.set(0.692, WHEEL_CENTER_Y + 0.015, -1.19);
    suspGroup.add(caliperBridge);

    // Rubber brake flex hose curving neatly rearward & inward
    const hoseCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.65, WHEEL_CENTER_Y + 0.06, -1.16),
      new THREE.Vector3(0.58, WHEEL_CENTER_Y + 0.14, -1.10),
      new THREE.Vector3(0.52, WHEEL_CENTER_Y + 0.24, -1.04),
    ]);
    const brakeHose = new THREE.Mesh(
      new THREE.TubeGeometry(hoseCurve, 12, 0.006, 8, false),
      blackGlossMat
    );
    suspGroup.add(brakeHose);

    // 3. Clickable Wheel Hub Face (`wheelHub`, X = +0.69) with 5 threaded lug bores at R = 0.056m
    const hubGroup = this.hubGroup;
    hubGroup.name = 'WheelHub';
    hubGroup.position.set(HUB_FACE_X, WHEEL_CENTER_Y, FRONT_AXLE_Z);
    this.group.add(hubGroup);

    const hubMat = new THREE.MeshStandardMaterial({
      color: 0xbcc4ce,
      metalness: 0.86,
      roughness: 0.26,
    });
    const boreMat = new THREE.MeshStandardMaterial({
      color: 0x1e2228,
      metalness: 0.6,
      roughness: 0.5,
    });

    const hubFlange = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.012, 28), hubMat);
    hubFlange.rotation.z = Math.PI / 2;
    hubFlange.position.x = -0.004;
    hubGroup.add(hubFlange);

    const hubSpigot = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.029, 0.024, 24), hubMat);
    hubSpigot.rotation.z = Math.PI / 2;
    hubSpigot.position.x = 0.006;
    hubGroup.add(hubSpigot);

    for (let i = 0; i < 5; i++) {
      const a = (i * 2 * Math.PI) / 5 + Math.PI / 10;
      const bore = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.014, 12), boreMat);
      bore.rotation.z = Math.PI / 2;
      bore.position.set(-0.002, Math.sin(a) * BOLT_CIRCLE_RADIUS, Math.cos(a) * BOLT_CIRCLE_RADIUS);
      hubGroup.add(bore);
    }

    this.partAnchors.set('wheelHub', hubGroup);
    this.tagInteractable(hubGroup, 'wheelHub');

    // 4. MacPherson Strut (X = 0.56, Y = 0.38 .. 0.78, Z = -1.32) + Helical Coil Spring
    const strutDamper = new THREE.Mesh(
      new THREE.CylinderGeometry(0.023, 0.023, 0.24, 16),
      blackGlossMat
    );
    strutDamper.position.set(0.56, 0.49, FRONT_AXLE_Z);
    strutDamper.rotation.z = 0.11;
    suspGroup.add(strutDamper);

    const strutRod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.011, 0.20, 14),
      chromeMat
    );
    strutRod.position.set(0.555, 0.65, FRONT_AXLE_Z);
    strutRod.rotation.z = 0.11;
    suspGroup.add(strutRod);

    // Spring perches
    const lowerPerch = new THREE.Mesh(
      new THREE.CylinderGeometry(0.048, 0.032, 0.018, 18),
      blackGlossMat
    );
    lowerPerch.position.set(0.562, 0.46, FRONT_AXLE_Z);
    lowerPerch.rotation.z = 0.11;
    suspGroup.add(lowerPerch);

    const upperPerch = new THREE.Mesh(
      new THREE.CylinderGeometry(0.052, 0.048, 0.024, 18),
      blackGlossMat
    );
    upperPerch.position.set(0.552, 0.745, FRONT_AXLE_Z);
    suspGroup.add(upperPerch);

    // Gloss-black helical coil spring via TubeGeometry
    const coilPts: THREE.Vector3[] = [];
    const turns = 5.5;
    const totalPts = 72;
    for (let i = 0; i <= totalPts; i++) {
      const f = i / totalPts;
      const theta = f * turns * Math.PI * 2;
      const r = 0.042;
      const cy = 0.47 + f * 0.265;
      const cx = 0.56 - (cy - 0.47) * 0.05;
      coilPts.push(new THREE.Vector3(cx + Math.cos(theta) * r, cy, FRONT_AXLE_Z + Math.sin(theta) * r));
    }
    const coilCurve = new THREE.CatmullRomCurve3(coilPts);
    const coilSpring = new THREE.Mesh(
      new THREE.TubeGeometry(coilCurve, 80, 0.0062, 8, false),
      blackGlossMat
    );
    coilSpring.castShadow = true;
    suspGroup.add(coilSpring);

    // Steering knuckle connecting hub (0.65, 0.317, -1.32) to strut base & lower ball joint
    const knuckleBody = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.13, 0.085), ironMat);
    knuckleBody.position.set(0.625, 0.32, FRONT_AXLE_Z);
    suspGroup.add(knuckleBody);

    const strutClamp = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.045, 0.05), ironMat);
    strutClamp.position.set(0.585, 0.38, FRONT_AXLE_Z);
    strutClamp.rotation.z = -0.55;
    suspGroup.add(strutClamp);

    // 5. Lower Control Arm (Querlenker, stays cleanly low around Y = 0.20)
    const armFrontLeg = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.026, 0.046), blackGlossMat);
    armFrontLeg.position.set(0.46, 0.205, -1.33);
    armFrontLeg.rotation.y = -0.14;
    suspGroup.add(armFrontLeg);

    const armRearLeg = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.026, 0.046), blackGlossMat);
    armRearLeg.position.set(0.46, 0.205, -1.18);
    armRearLeg.rotation.y = 0.85;
    suspGroup.add(armRearLeg);

    // 6. Sway Bar Link (Koppelstange)
    const swayLink = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.23, 10), chromeMat);
    swayLink.position.set(0.58, 0.33, -1.24);
    swayLink.rotation.x = 0.14;
    suspGroup.add(swayLink);

    // 7. CV Half-shaft (routed slightly rearward at Z = -1.22 -> -1.32 so crank pulley at X=0.44 stays open)
    const shaftStart = new THREE.Vector3(0.30, 0.29, -1.22);
    const shaftEnd = new THREE.Vector3(0.64, WHEEL_CENTER_Y, FRONT_AXLE_Z);
    const shaftDir = new THREE.Vector3().subVectors(shaftEnd, shaftStart);
    const shaftLen = shaftDir.length();
    const cvShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, shaftLen, 14),
      blackGlossMat
    );
    cvShaft.position.copy(shaftStart).addScaledVector(shaftDir, 0.5);
    cvShaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), shaftDir.clone().normalize());
    suspGroup.add(cvShaft);

    const cvBoot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.036, 0.022, 0.075, 16),
      blackGlossMat
    );
    cvBoot.position.set(0.60, WHEEL_CENTER_Y - 0.005, -1.305);
    cvBoot.quaternion.copy(cvShaft.quaternion);
    suspGroup.add(cvBoot);
  }

  // ---------------------------------------------------------------------------
  // Removable Front-Right Wheel + 5 Individual 17mm Hex Lug Bolts
  // ---------------------------------------------------------------------------

  private buildFrontRightWheelAndLugBolts(textures: {
    vwBadge: THREE.CanvasTexture;
    tireTread: THREE.CanvasTexture;
  }): void {
    const { group: wheelMeshGroup, materials } = this.createWheelMeshSet(textures, false);
    this.frontRightWheelGroup.name = 'FrontRightWheel';
    this.frontRightWheelGroup.position.set(WHEEL_CENTER_X, WHEEL_CENTER_Y, FRONT_AXLE_Z);
    this.frontRightWheelGroup.add(wheelMeshGroup);
    this.frontRightWheelMaterials.push(...materials);
    this.group.add(this.frontRightWheelGroup);

    this.partAnchors.set('frontRightWheel', this.frontRightWheelGroup);
    this.tagInteractable(this.frontRightWheelGroup, 'frontRightWheel');

    const hitboxMat = new THREE.MeshStandardMaterial({
      colorWrite: false,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    });

    // 5 Individual 17mm Chrome Hex Lug Bolts (`lugBolt_0` .. `lugBolt_4`)
    for (let i = 0; i < 5; i++) {
      const id = `lugBolt_${i}` as InteractableId;
      const a = (i * 2 * Math.PI) / 5 + Math.PI / 10;
      const y = WHEEL_CENTER_Y + Math.sin(a) * BOLT_CIRCLE_RADIUS;
      const z = FRONT_AXLE_Z + Math.cos(a) * BOLT_CIRCLE_RADIUS;
      const restPos = new THREE.Vector3(0.796, y, z);

      const root = new THREE.Group();
      root.name = id;
      root.position.copy(restPos);
      this.group.add(root);

      const spinGroup = new THREE.Group();
      root.add(spinGroup);

      const boltChromeMat = new THREE.MeshStandardMaterial({
        color: 0xe3e8ef,
        metalness: 0.93,
        roughness: 0.14,
      });
      const boltThreadMat = new THREE.MeshStandardMaterial({
        color: 0x6b7280,
        metalness: 0.78,
        roughness: 0.36,
      });

      // 17mm Hex head (circumscribed radius 0.011m)
      const hexHead = new THREE.Mesh(
        new THREE.CylinderGeometry(0.011, 0.011, 0.018, 6),
        boltChromeMat
      );
      hexHead.rotation.z = Math.PI / 2;
      hexHead.position.x = 0.008;
      spinGroup.add(hexHead);

      // Conical seat flange
      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0125, 0.008, 0.008, 16),
        boltChromeMat
      );
      collar.rotation.z = Math.PI / 2;
      collar.position.x = -0.004;
      spinGroup.add(collar);

      // M14 threaded shank extending toward hub
      const shank = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0065, 0.0065, 0.028, 12),
        boltThreadMat
      );
      shank.rotation.z = Math.PI / 2;
      shank.position.x = -0.022;
      spinGroup.add(shank);

      // Generous invisible raycast cylinder for comfortable clicking
      const hitbox = new THREE.Mesh(
        new THREE.CylinderGeometry(0.024, 0.024, 0.042, 12),
        hitboxMat.clone()
      );
      hitbox.rotation.z = Math.PI / 2;
      hitbox.position.x = 0.006;
      root.add(hitbox);

      this.partAnchors.set(id, root);
      this.tagInteractable(root, id);

      this.lugBolts.push({
        id,
        root,
        spinGroup,
        restPos,
        pullDir: new THREE.Vector3(1, 0, 0),
        progress: 0,
        target: 0,
        materials: [boltChromeMat, boltThreadMat],
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Removable Front-Right Wheel Arch Liner (`wheelLiner`) + 6 Torx T25 Screws
  // ---------------------------------------------------------------------------

  private buildWheelArchLinerGeometry(innerWallX: number, outerWallX: number, radius: number): THREE.BufferGeometry {
    // Creates a realistic Golf 7 wheel arch liner consisting of:
    // 1. Curved arch tunnel spanning front (-1.69) over top (-1.32) to rear (-0.95)
    // 2. Inner vertical engine-bay splash shield wall covering Z = -1.66 .. -0.98, Y = 0.21 .. 0.69
    const positions: number[] = [];
    const indices: number[] = [];

    const arcSteps = 28;
    const startAngle = Math.PI + 0.22; // front-lower arch edge
    const endAngle = -0.22; // rear-lower arch edge

    // Arch tunnel strip
    for (let i = 0; i <= arcSteps; i++) {
      const f = i / arcSteps;
      const a = startAngle + (endAngle - startAngle) * f;
      const z = FRONT_AXLE_Z + Math.cos(a) * radius;
      const y = WHEEL_CENTER_Y + Math.sin(a) * (radius + 0.015);
      positions.push(innerWallX, y, z);
      positions.push(outerWallX, y, z);
    }

    for (let i = 0; i < arcSteps; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, d, a, d, b);
    }

    // Inner engine-side splash wall panel (genuinely conceals the belt at X = +0.44 until removed!)
    const wallBase = positions.length / 3;
    const zCols = 14;
    const yRows = 8;
    for (let iz = 0; iz <= zCols; iz++) {
      const fz = iz / zCols;
      const z = -1.67 + fz * ( -0.97 - -1.67 );
      const dz = z - FRONT_AXLE_Z;
      const maxArcY =
        Math.abs(dz) < radius
          ? WHEEL_CENTER_Y + Math.sqrt(Math.max(0, radius * radius - dz * dz)) + 0.01
          : 0.25;
      const minY = 0.21;

      for (let iy = 0; iy <= yRows; iy++) {
        const fy = iy / yRows;
        const y = minY + fy * Math.max(0.05, maxArcY - minY);
        // Subtle molded rib contour around X = 0.505 .. 0.54
        const ribBulge = Math.sin(fz * Math.PI * 5) * 0.008 + (1 - Math.abs(fz - 0.5) * 1.4) * 0.015;
        const x = innerWallX + Math.max(0, ribBulge);
        positions.push(x, y, z);
      }
    }

    const wallStride = yRows + 1;
    for (let iz = 0; iz < zCols; iz++) {
      for (let iy = 0; iy < yRows; iy++) {
        const a = wallBase + iz * wallStride + iy;
        const b = wallBase + (iz + 1) * wallStride + iy;
        const c = wallBase + (iz + 1) * wallStride + (iy + 1);
        const d = wallBase + iz * wallStride + (iy + 1);
        indices.push(a, c, b, a, d, c);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    return geom;
  }

  private buildWheelLinerAndScrews(): void {
    this.wheelLinerGroup.name = 'WheelLiner';
    this.group.add(this.wheelLinerGroup);

    const linerMat = new THREE.MeshStandardMaterial({
      color: 0x16181c,
      metalness: 0.06,
      roughness: 0.82,
      side: THREE.DoubleSide,
    });
    this.wheelLinerMaterials.push(linerMat);

    const linerGeom = this.buildWheelArchLinerGeometry(0.505, 0.78, 0.378);
    const linerMesh = new THREE.Mesh(linerGeom, linerMat);
    linerMesh.castShadow = true;
    linerMesh.receiveShadow = true;
    this.wheelLinerGroup.add(linerMesh);

    const linerAnchor = new THREE.Object3D();
    linerAnchor.position.set(0.56, 0.44, FRONT_AXLE_Z);
    linerAnchor.userData.preserveOnHydrate = true;
    this.wheelLinerGroup.add(linerAnchor);
    this.partAnchors.set('wheelLiner', linerAnchor);
    this.tagInteractable(this.wheelLinerGroup, 'wheelLiner');

    // 6 Individual Torx T25 Screws (`linerScrew_0` .. `linerScrew_5`)
    const screwSpecs: Array<{ pos: [number, number, number]; dir: [number, number, number] }> = [
      { pos: [0.69, 0.24, -1.63], dir: [0.6, 0.1, 0.78] },
      { pos: [0.68, 0.56, -1.58], dir: [0.6, -0.5, 0.62] },
      { pos: [0.68, 0.67, -1.32], dir: [0.55, -0.83, 0] },
      { pos: [0.68, 0.56, -1.06], dir: [0.6, -0.5, -0.62] },
      { pos: [0.69, 0.24, -1.01], dir: [0.6, 0.1, -0.78] },
      { pos: [0.525, 0.44, -1.49], dir: [1, 0, 0] },
    ];

    const hitboxMat = new THREE.MeshStandardMaterial({
      colorWrite: false,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    });

    for (let i = 0; i < screwSpecs.length; i++) {
      const id = `linerScrew_${i}` as InteractableId;
      const spec = screwSpecs[i];
      const restPos = new THREE.Vector3(...spec.pos);
      const pullDir = new THREE.Vector3(...spec.dir).normalize();

      const root = new THREE.Group();
      root.name = id;
      root.position.copy(restPos);
      // Align local +X along pullDir
      root.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), pullDir);
      this.group.add(root);

      const spinGroup = new THREE.Group();
      root.add(spinGroup);

      const screwMat = new THREE.MeshStandardMaterial({
        color: 0xc5ccd4,
        metalness: 0.88,
        roughness: 0.24,
      });
      const starRecessMat = new THREE.MeshStandardMaterial({
        color: 0x1c2026,
        metalness: 0.5,
        roughness: 0.55,
      });

      const washer = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.003, 18), screwMat);
      washer.rotation.z = Math.PI / 2;
      washer.position.x = 0.002;
      spinGroup.add(washer);

      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.008, 0.008, 14), screwMat);
      head.rotation.z = Math.PI / 2;
      head.position.x = 0.007;
      spinGroup.add(head);

      const torxStar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.004, 0.004, 0.004, 6),
        starRecessMat
      );
      torxStar.rotation.z = Math.PI / 2;
      torxStar.position.x = 0.010;
      spinGroup.add(torxStar);

      const hitbox = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 10, 8),
        hitboxMat.clone()
      );
      root.add(hitbox);

      this.partAnchors.set(id, root);
      this.tagInteractable(root, id);

      this.linerScrews.push({
        id,
        root,
        spinGroup,
        restPos,
        pullDir,
        progress: 0,
        target: 0,
        materials: [screwMat, starRecessMat],
      });
    }
  }

  private buildWheelLinerGhostSlot(): void {
    this.wheelLinerSlotGroup.name = 'WheelLinerSlot';
    this.wheelLinerSlotGroup.visible = false;
    this.group.add(this.wheelLinerSlotGroup);

    const ghostGeom = this.buildWheelArchLinerGeometry(0.506, 0.778, 0.376);
    const ghostMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: 0x0891b2,
      emissiveIntensity: 0.75,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ghostMesh = new THREE.Mesh(ghostGeom, ghostMat);
    this.wheelLinerSlotGroup.add(ghostMesh);

    const wireMat = new THREE.LineBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.85,
    });
    const wire = new THREE.LineSegments(new THREE.WireframeGeometry(ghostGeom), wireMat);
    this.wheelLinerSlotGroup.add(wire);

    const slotAnchor = new THREE.Object3D();
    slotAnchor.position.set(0.56, 0.44, FRONT_AXLE_Z);
    this.wheelLinerSlotGroup.add(slotAnchor);
    this.partAnchors.set('wheelLinerSlot', slotAnchor);
    this.tagInteractable(this.wheelLinerSlotGroup, 'wheelLinerSlot');
  }

  // ---------------------------------------------------------------------------
  // Recursive Interactable Tagging
  // ---------------------------------------------------------------------------

  private tagInteractable(root: THREE.Object3D, id: InteractableId): void {
    root.userData.interactableId = id;
    root.traverse((obj) => {
      obj.userData.interactableId = id;
      if (obj instanceof THREE.Mesh) {
        this.interactables.push(obj);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Procedural Canvas Textures
  // ---------------------------------------------------------------------------

  private createVwBadgeTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#0f1318';
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(128, 128, 108, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 17;

    // Upper V
    ctx.beginPath();
    ctx.moveTo(64, 54);
    ctx.lineTo(128, 134);
    ctx.lineTo(192, 54);
    ctx.stroke();

    // Lower W
    ctx.beginPath();
    ctx.moveTo(46, 86);
    ctx.lineTo(94, 204);
    ctx.lineTo(128, 146);
    ctx.lineTo(162, 204);
    ctx.lineTo(210, 86);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private createTdiPlaqueTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 224;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#1f242c';
    ctx.fillRect(0, 0, 512, 224);

    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, 496, 208);

    // Small VW roundel on left
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(92, 112, 56, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(58, 74);
    ctx.lineTo(92, 115);
    ctx.lineTo(126, 74);
    ctx.moveTo(48, 90);
    ctx.lineTo(74, 152);
    ctx.lineTo(92, 122);
    ctx.lineTo(110, 152);
    ctx.lineTo(136, 90);
    ctx.stroke();

    // Bold TDI text
    ctx.font = '900 108px "Inter", "Arial Black", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e5e7eb';
    ctx.fillText('TD', 196, 116);
    ctx.fillStyle = '#dc2626';
    ctx.fillText('I', 356, 116);

    ctx.font = '600 24px "Inter", sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('1.6 EA288', 200, 180);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private createLicensePlateTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 112;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 512, 112);

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 506, 106);

    // EU blue strip
    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(6, 6, 48, 100);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px Arial, sans-serif';
    ctx.fillText('D', 20, 88);

    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(30, 32, 14, 0, Math.PI * 2);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Registration text
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 64px "Arial Narrow", "Helvetica", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('WOB  MK 700', 74, 58);

    // Registration seal
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.arc(218, 42, 10, 0, Math.PI * 2);
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private createTireTreadTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#24272d';
    ctx.fillRect(0, 0, 256, 256);

    ctx.fillStyle = '#121417';
    // Circumferential grooves
    for (const gx of [70, 112, 144, 186]) {
      ctx.fillRect(gx, 0, 10, 256);
    }
    // Angled shoulder sipes
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#14161a';
    for (let y = -32; y < 288; y += 22) {
      ctx.beginPath();
      ctx.moveTo(16, y);
      ctx.lineTo(66, y + 14);
      ctx.moveTo(190, y + 14);
      ctx.lineTo(240, y);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 6);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private createRotorTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#cfd5dd';
    ctx.fillRect(0, 0, 256, 256);

    for (let r = 64; r < 126; r += 3) {
      ctx.strokeStyle = r % 6 === 0 ? '#aeb6c2' : '#e2e6ec';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(128, 128, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private createHoneycombTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#090b0e';
    ctx.fillRect(0, 0, 256, 128);

    ctx.strokeStyle = '#2c323b';
    ctx.lineWidth = 3;
    const r = 12;
    const dx = r * 1.5;
    const dy = r * Math.sqrt(3);
    for (let col = -1; col < 16; col++) {
      for (let row = -1; row < 8; row++) {
        const cx = col * dx;
        const cy = row * dy + (col % 2 === 0 ? 0 : dy / 2);
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3;
          const vx = cx + r * Math.cos(a);
          const vy = cy + r * Math.sin(a);
          if (k === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 1);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
}
