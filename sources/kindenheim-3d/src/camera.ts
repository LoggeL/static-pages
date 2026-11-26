import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { LoadedLandmarkInfo } from './buildings';
import type { BuildingCollider } from './collision';
import type { SceneryResult } from './scenery';
import type { TerrainSystem } from './terrain';
import type { TractorController } from './tractor';
import type { CameraBookmark, CameraMode } from './types';

function findLandmark(
  landmarks: Map<string, LoadedLandmarkInfo>,
  ...keywords: string[]
): LoadedLandmarkInfo | null {
  for (const [k, info] of landmarks.entries()) {
    const combined = `${k} ${info.name}`.toLowerCase();
    for (const kw of keywords) {
      if (combined.includes(kw)) return info;
    }
  }
  return null;
}

export function buildKindenheimBookmarks(
  terrain: TerrainSystem,
  landmarks: Map<string, LoadedLandmarkInfo>,
  scenery: SceneryResult
): CameraBookmark[] {
  const church = findLandmark(landmarks, 'kirche', 'church');
  const rathaus = findLandmark(landmarks, 'rathaus', 'gemeinde');

  const centerX = church ? church.position.x + 35 : 10;
  const centerZ = church ? church.position.z - 5 : -80;
  const centerY = terrain.getTerrainHeight(centerX, centerZ);

  const ovCamX = centerX + 165;
  const ovCamZ = centerZ + 235;
  const ovCamY = terrain.getTerrainHeight(ovCamX, ovCamZ) + 108;

  const chX = church?.position.x ?? -31;
  const chZ = church?.position.z ?? -72;
  const chY = terrain.getTerrainHeight(chX, chZ);
  const chCamX = 14;
  const chCamZ = -18;
  const chCamY = terrain.getTerrainHeight(chCamX, chCamZ) + 30;

  const hsCamX = 79.42;
  const hsCamZ = -79.24;
  const hsCamY = terrain.getTerrainHeight(hsCamX, hsCamZ) + 3.8;
  const hsTargetX = hsCamX - 42;
  const hsTargetZ = hsCamZ + 13.5;
  const hsTargetY = terrain.getTerrainHeight(hsTargetX, hsTargetZ) + 6.5;

  const vX = scenery.vineyardShowcasePoint?.[0] ?? 590;
  const vZ = scenery.vineyardShowcasePoint?.[1] ?? -235;
  const vY = terrain.getTerrainHeight(vX, vZ);
  const toCenterX = chX - vX;
  const toCenterZ = chZ - vZ;
  const toCenterLen = Math.hypot(toCenterX, toCenterZ) || 1;
  const vCamX = vX - (toCenterX / toCenterLen) * 28;
  const vCamZ = vZ - (toCenterZ / toCenterLen) * 28;
  const vCamY = terrain.getTerrainHeight(vCamX, vCamZ) + 11.5;
  const vTargetX = vX + (toCenterX / toCenterLen) * 95;
  const vTargetZ = vZ + (toCenterZ / toCenterLen) * 95;
  const vTargetY = terrain.getTerrainHeight(vTargetX, vTargetZ) + 6.0;

  const stCamX = -58.7;
  const stCamZ = -41.8;
  const stCamY = terrain.getTerrainHeight(stCamX, stCamZ) + 2.5;
  const stTargetX = rathaus ? (chX + rathaus.position.x) * 0.5 : -28;
  const stTargetZ = rathaus ? (chZ + rathaus.position.z) * 0.5 : -62;
  const stTargetY = terrain.getTerrainHeight(stTargetX, stTargetZ) + 14.5;

  const spCamX = 122.0;
  const spCamZ = -295.0;
  const spCamY = terrain.getTerrainHeight(spCamX, spCamZ) + 25.5;
  const spTargetX = 52.0;
  const spTargetZ = -322.0;
  const spTargetY = terrain.getTerrainHeight(spTargetX, spTargetZ) + 1.5;

  const plCamX = 65.0;
  const plCamZ = -224.0;
  const plCamY = terrain.getTerrainHeight(plCamX, plCamZ) + 11.5;
  const plTargetX = 75.0;
  const plTargetZ = -254.0;
  const plTargetY = terrain.getTerrainHeight(plTargetX, plTargetZ) + 1.5;

  return [
    {
      id: 'overview',
      label: 'Übersicht Kindenheim',
      position: [ovCamX, ovCamY, ovCamZ],
      target: [centerX, centerY + 8, centerZ],
      fovDeg: 46,
    },
    {
      id: 'church',
      label: 'Evangelische Kirche',
      position: [chCamX, chCamY, chCamZ],
      target: [-31, chY + 19, -68],
      fovDeg: 52,
    },
    {
      id: 'hauptstrasse',
      label: 'Hauptstraße & Weingüter',
      position: [hsCamX, hsCamY, hsCamZ],
      target: [hsTargetX, hsTargetY, hsTargetZ],
      fovDeg: 52,
    },
    {
      id: 'vineyards',
      label: 'Weinberge (Pfalz)',
      position: [vCamX, Math.max(vCamY, vY + 12), vCamZ],
      target: [vTargetX, vTargetY, vTargetZ],
      fovDeg: 48,
    },
    {
      id: 'street',
      label: 'Straßenansicht (2,5 m)',
      position: [stCamX, stCamY, stCamZ],
      target: [stTargetX, stTargetY, stTargetZ],
      fovDeg: 58,
    },
    {
      id: 'sportplatz',
      label: 'Fußballplatz',
      position: [spCamX, spCamY, spCamZ],
      target: [spTargetX, spTargetY, spTargetZ],
      fovDeg: 52,
    },
    {
      id: 'spielplatz',
      label: 'Spielplatz',
      position: [plCamX, plCamY, plCamZ],
      target: [plTargetX, plTargetY, plTargetZ],
      fovDeg: 52,
    },
  ];
}

/**
 * Chase-camera obstacle avoidance (a game-style spring arm). The boom from the tractor to the camera is swept
 * against the collider polygons (treated as prisms up to each obstacle's top) and, near hero landmarks,
 * against their meshes (archways, door lintels). Blocked:
 *  1. a low obstacle (fence, wall, shed) that a moderately steeper boom clears at almost full length → tilt;
 *  2. a tall one (a house right behind the tractor) → the boom shortens first, and only once it is shorter
 *     than CHASE_COMFORT_DIST_M does it tilt, continuously, up to CHASE_MAX_PITCH_RAD (≈41°);
 *  3. only when even the capped tilt leaves less than CHASE_SHORT_DIST_M (wall a metre or two behind the
 *     tractor) does it go steeper, up to CHASE_EMERGENCY_PITCH_RAD: the camera then rises above the cab
 *     instead of sitting on its roof.
 * The VIEW never follows the boom down: the camera keeps looking ahead of the tractor (≤ ~30° down even on the
 * emergency boom), so the road and the checkpoint stay in frame. Everything is eased (tilt up ~0.25 s, back
 * down ~0.6 s); only the hard distance limit acts at once, so the camera is never placed inside a wall.
 */
const CHASE_PIVOT_HEIGHT_M = 2.0;
/** Horizontal clearance kept between the boom and walls (covers roof overhangs and the near plane). */
const CHASE_CLEAR_RADIUS_M = 0.9;
/** Vertical clearance kept above an obstacle the boom passes over. */
const CHASE_CLEAR_ABOVE_M = 0.6;
const CHASE_PROFILE_STEP_M = 0.3;
/** Steepest boom in normal play (≈41°): the road ahead stays in view. */
const CHASE_MAX_PITCH_RAD = 0.72;
/** Last resort when no boom of CHASE_MIN_DIST_M fits under the normal cap (≈60°). */
const CHASE_EMERGENCY_PITCH_RAD = 1.08;
const CHASE_PITCH_CANDIDATES = 8;
/** A tilt candidate clears a low obstacle once it keeps this fraction of the wanted distance. */
const CHASE_KEEP_FRACTION = 0.8;
/** Behind a tall obstacle the boom shortens down to this length before it starts to tilt. */
const CHASE_COMFORT_DIST_M = 5.2;
/** Shorter than this at the normal cap, the boom may go steeper (emergency) to keep its length. */
const CHASE_SHORT_DIST_M = 4.8;
const CHASE_MIN_DIST_M = 2.4;
/** Easing rates (1/s) of the boom tilt: up fast enough to clear a corner, back down gently. */
const CHASE_PITCH_UP_RATE = 4.0;
const CHASE_PITCH_DOWN_RATE = 1.6;
/** Distance kept in front of a landmark surface hit by the boom ray. */
const CHASE_MESH_MARGIN_M = 0.55;
/** The solver also checks where the boom will be this many seconds ahead at the current turn rate. */
const CHASE_LOOKAHEAD_S = 0.6;

interface ChaseOccluder {
  object: THREE.Object3D;
  sphere: THREE.Sphere;
}

/** True for form controls that must keep their own keyboard handling (typing, arrow keys, type-ahead). */
export function isFormControlTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

interface FlightState {
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  startTarget: THREE.Vector3;
  endTarget: THREE.Vector3;
  startFov: number;
  endFov: number;
  elapsed: number;
  duration: number;
}

export class CameraRig {
  public readonly camera: THREE.PerspectiveCamera;
  public readonly controls: OrbitControls;
  public mode: CameraMode = 'chase';

  private readonly terrain: TerrainSystem;
  private readonly domElement: HTMLElement;
  private readonly keys = new Set<string>();
  private tractor: TractorController | null = null;
  private flight: FlightState | null = null;

  // 3rd-person Chase camera state
  private chaseOrbitYaw = 0;
  private chaseOrbitPitch = 0.23;
  private chaseDistance = 10.2;
  private isDraggingLook = false;
  /** Pointer that started the look-drag on the canvas (other fingers may be on the touch driving controls). */
  private lookPointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private chaseLookTarget = new THREE.Vector3();

  // Chase-camera obstacle avoidance state (see CHASE_* constants)
  private collider: BuildingCollider | null = null;
  private chaseOccluders: ChaseOccluder[] = [];
  private readonly chaseRaycaster = new THREE.Raycaster();
  private readonly chaseRayHits: THREE.Intersection[] = [];
  /** Obstacle profiles under the boom: [0] current yaw, [1] and [2] where the boom will be in a moment. */
  private readonly chaseProfiles = [new Float32Array(128), new Float32Array(128), new Float32Array(128)];
  private readonly chaseProfileDirs = [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()];
  private chaseProfileCount = 0;
  private chaseProfilesUsed = 1;
  private chasePrevYaw: number | null = null;
  private chaseYawRate = 0;
  private chaseBoomPitch = 0.22;
  private chaseBoomDist = 10.2;
  private readonly tmpPivot = new THREE.Vector3();
  private readonly tmpBoomDir = new THREE.Vector3();
  private readonly groundHeightAt = (x: number, z: number): number => this.terrain.getTerrainHeight(x, z);

  // 1st-person Cab look-around offsets
  private cabLookYaw = 0;
  private cabLookPitch = -0.05;

  private readonly tmpForward = new THREE.Vector3();
  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpMove = new THREE.Vector3();
  private readonly tmpDesiredPos = new THREE.Vector3();
  private readonly tmpDesiredLook = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement, terrain: TerrainSystem) {
    this.camera = camera;
    this.domElement = domElement;
    this.terrain = terrain;

    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 1350;
    this.controls.maxPolarAngle = Math.PI * 0.72;
    this.controls.rotateSpeed = 0.72;
    this.controls.panSpeed = 0.85;
    this.controls.enabled = false; // Default starts in 'chase' tractor mode

    this.controls.addEventListener('start', () => {
      this.flight = null;
    });

    this.bindInputEvents();
  }

  public attachTractor(tractor: TractorController): void {
    this.tractor = tractor;
    this.snapToCurrentMode();
  }

  /**
   * Gives the chase camera the world's obstacles so it never ends up inside a house: `collider` holds the
   * building / landmark-solid polygons with their heights; `landmarkObjects` (optional) are the hero landmark
   * models, ray-tested for overhead geometry that polygons cannot describe (archways, door lintels).
   */
  public setObstacles(collider: BuildingCollider, landmarkObjects: Iterable<THREE.Object3D> = []): void {
    this.collider = collider;
    this.chaseOccluders = [];
    const box = new THREE.Box3();
    for (const object of landmarkObjects) {
      object.updateWorldMatrix(true, true);
      box.setFromObject(object);
      if (box.isEmpty()) throw new Error(`[camera] setObstacles: landmark "${object.name}" has no geometry`);
      this.chaseOccluders.push({ object, sphere: box.getBoundingSphere(new THREE.Sphere()) });
    }
    this.snapToCurrentMode();
  }

  private bindInputEvents(): void {
    window.addEventListener('keydown', (e) => {
      if (isFormControlTarget(e.target)) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.isDraggingLook = false;
      this.lookPointerId = null;
    });

    this.domElement.addEventListener('pointerdown', (e) => {
      if (this.mode === 'drone') return;
      if (e.button !== 0 && e.button !== 2) return;
      if (this.isDraggingLook) return; // a second finger on the canvas does not take over the look-drag
      this.isDraggingLook = true;
      this.lookPointerId = e.pointerId;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.isDraggingLook || this.mode === 'drone') return;
      if (e.pointerId !== this.lookPointerId) return;
      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;

      if (this.mode === 'chase') {
        this.chaseOrbitYaw -= dx * 0.005;
        this.chaseOrbitPitch = THREE.MathUtils.clamp(this.chaseOrbitPitch + dy * 0.004, 0.06, 0.78);
      } else if (this.mode === 'cab') {
        this.cabLookYaw = THREE.MathUtils.clamp(this.cabLookYaw - dx * 0.0045, -1.25, 1.25);
        this.cabLookPitch = THREE.MathUtils.clamp(this.cabLookPitch - dy * 0.0038, -0.45, 0.45);
      }
    });

    const endLookDrag = (e: PointerEvent): void => {
      if (e.pointerId !== this.lookPointerId) return;
      this.isDraggingLook = false;
      this.lookPointerId = null;
    };
    window.addEventListener('pointerup', endLookDrag);
    window.addEventListener('pointercancel', endLookDrag);

    this.domElement.addEventListener(
      'wheel',
      (e) => {
        if (this.mode !== 'chase') return;
        this.chaseDistance = THREE.MathUtils.clamp(this.chaseDistance + e.deltaY * 0.008, 6.2, 20.0);
      },
      { passive: true }
    );
  }

  public setMode(newMode: CameraMode): void {
    this.flight = null;
    this.mode = newMode;

    if (newMode === 'drone') {
      this.controls.enabled = true;
      this.camera.fov = 48;
      this.camera.updateProjectionMatrix();
      if (this.tractor) {
        const tx = this.tractor.x;
        const tz = this.tractor.z;
        const ty = this.tractor.y;
        this.controls.target.set(tx, ty + 3, tz);
        this.camera.position.set(tx - 24, ty + 18, tz + 24);
      }
      this.controls.update();
    } else if (newMode === 'chase') {
      this.controls.enabled = false;
      this.chaseOrbitYaw = 0;
      this.chaseOrbitPitch = 0.22;
      this.camera.fov = 52;
      this.camera.updateProjectionMatrix();
      this.snapToCurrentMode();
    } else if (newMode === 'cab') {
      this.controls.enabled = false;
      this.cabLookYaw = 0;
      this.cabLookPitch = -0.05;
      this.camera.fov = 64;
      this.camera.updateProjectionMatrix();
      this.snapToCurrentMode();
    }
  }

  public snapToCurrentMode(): void {
    if (!this.tractor) return;
    if (this.mode === 'chase') {
      this.updateChaseCamera(1.0, 0);
    } else if (this.mode === 'cab') {
      this.updateCabCamera();
    }
  }

  public flyTo(
    pos: [number, number, number],
    target: [number, number, number],
    durationSec = 1.0,
    fovDeg?: number
  ): void {
    if (this.mode !== 'drone') {
      this.mode = 'drone';
      this.controls.enabled = true;
    }
    const endPos = new THREE.Vector3(pos[0], pos[1], pos[2]);
    const endTarget = new THREE.Vector3(target[0], target[1], target[2]);
    endPos.y = Math.max(endPos.y, this.terrain.getTerrainHeight(endPos.x, endPos.z) + 1.8);
    const endFov = fovDeg ?? 48;

    if (durationSec <= 0.01) {
      this.flight = null;
      this.camera.position.copy(endPos);
      this.controls.target.copy(endTarget);
      this.camera.fov = endFov;
      this.camera.updateProjectionMatrix();
      this.controls.update();
      return;
    }

    this.flight = {
      startPos: this.camera.position.clone(),
      endPos,
      startTarget: this.controls.target.clone(),
      endTarget,
      startFov: this.camera.fov,
      endFov,
      elapsed: 0,
      duration: durationSec,
    };
  }

  public flyToWorldXZ(x: number, z: number, heightOffset = 95, durationSec = 0.85): void {
    const clampedX = THREE.MathUtils.clamp(x, -this.terrain.halfSizeM + 20, this.terrain.halfSizeM - 20);
    const clampedZ = THREE.MathUtils.clamp(z, -this.terrain.halfSizeM + 20, this.terrain.halfSizeM - 20);
    const ty = this.terrain.getTerrainHeight(clampedX, clampedZ);
    this.flyTo(
      [clampedX + heightOffset * 0.6, ty + heightOffset, clampedZ + heightOffset * 0.68],
      [clampedX, ty + 4, clampedZ],
      durationSec,
      48
    );
  }

  /**
   * Samples obstacle profile `slot`: highest obstacle top every CHASE_PROFILE_STEP_M along the horizontal
   * direction `yaw + π` (behind the tractor) from the pivot, out to `reachM`.
   */
  private sampleChaseProfile(slot: number, pivotX: number, pivotZ: number, yaw: number, reachM: number): void {
    const collider = this.collider!;
    const tops = this.chaseProfiles[slot];
    const dir = this.chaseProfileDirs[slot].set(-Math.sin(yaw), -Math.cos(yaw));
    const count = Math.min(tops.length, Math.ceil(reachM / CHASE_PROFILE_STEP_M) + 2);
    for (let i = 0; i < count; i++) {
      const s = i * CHASE_PROFILE_STEP_M;
      tops[i] = collider.obstacleTopAt(pivotX + dir.x * s, pivotZ + dir.y * s, CHASE_CLEAR_RADIUS_M, this.groundHeightAt);
    }
    this.chaseProfileCount = count;
  }

  /**
   * Longest clear boom length (≤ wantDist) at `pitch` over profile `slot`. With `refine`, the blocking
   * edge is located to a few centimetres (so the result changes smoothly while the tractor moves).
   */
  private clearChaseDistance(
    slot: number,
    pivotX: number,
    pivotY: number,
    pivotZ: number,
    pitch: number,
    wantDist: number,
    refine: boolean
  ): number {
    const tops = this.chaseProfiles[slot];
    const dir = this.chaseProfileDirs[slot];
    const tanP = Math.tan(pitch);
    const cosP = Math.cos(pitch);
    const reach = wantDist * cosP;
    const blockedAt = (s: number, top: number): boolean => pivotY + s * tanP < top + CHASE_CLEAR_ABOVE_M;

    for (let i = 0; i < this.chaseProfileCount; i++) {
      const s = i * CHASE_PROFILE_STEP_M;
      if (s > reach + CHASE_CLEAR_RADIUS_M) break;
      if (!blockedAt(s, tops[i])) continue;
      if (i === 0) return 0;
      let lo = s - CHASE_PROFILE_STEP_M; // clear
      if (refine) {
        let hi = s; // blocked
        for (let k = 0; k < 5; k++) {
          const mid = (lo + hi) * 0.5;
          const top = this.collider!.obstacleTopAt(
            pivotX + dir.x * mid,
            pivotZ + dir.y * mid,
            CHASE_CLEAR_RADIUS_M,
            this.groundHeightAt
          );
          if (blockedAt(mid, top)) hi = mid;
          else lo = mid;
        }
      }
      return Math.min(wantDist, lo / cosP);
    }
    return wantDist;
  }

  /** Clear boom length at `pitch` for the current yaw and the yaws the boom is about to sweep through. */
  private clearChaseDistanceAhead(pivotX: number, pivotY: number, pivotZ: number, pitch: number, wantDist: number): number {
    let d = wantDist;
    for (let slot = 0; slot < this.chaseProfilesUsed; slot++) {
      d = Math.min(d, this.clearChaseDistance(slot, pivotX, pivotY, pivotZ, pitch, wantDist, false));
    }
    return d;
  }

  /** Nearest landmark surface along the boom (or Infinity), so the camera stops under an arch or lintel. */
  private landmarkHitDistance(pivot: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
    let nearest = Infinity;
    for (const occ of this.chaseOccluders) {
      const reach = occ.sphere.radius + maxDist;
      if (occ.sphere.center.distanceToSquared(pivot) > reach * reach) continue;
      this.chaseRaycaster.set(pivot, dir);
      this.chaseRaycaster.near = 0;
      this.chaseRaycaster.far = maxDist;
      this.chaseRayHits.length = 0;
      this.chaseRaycaster.intersectObject(occ.object, true, this.chaseRayHits);
      for (const hit of this.chaseRayHits) {
        if (hit.distance < nearest) nearest = hit.distance;
      }
    }
    return nearest;
  }

  private updateChaseCamera(smoothAlpha: number, dt: number): void {
    if (!this.tractor) return;
    const snap = smoothAlpha >= 0.99;

    // Auto-recenter gently behind the tractor when driving forward without dragging
    if (!this.isDraggingLook && Math.abs(this.tractor.speedMps) > 0.7 && dt > 0) {
      this.chaseOrbitYaw = THREE.MathUtils.lerp(this.chaseOrbitYaw, 0, Math.min(1, dt * 1.8));
      this.chaseOrbitPitch = THREE.MathUtils.lerp(this.chaseOrbitPitch, 0.22, Math.min(1, dt * 1.2));
    }

    const totalYaw = this.tractor.headingRad + this.chaseOrbitYaw;
    const wantDist = this.tractor.trailerAttached ? Math.max(this.chaseDistance, 11.4) : this.chaseDistance;
    const wantPitch = this.chaseOrbitPitch;

    // Boom: from a pivot above the tractor backwards (-forward) and up
    const dirX = -Math.sin(totalYaw);
    const dirZ = -Math.cos(totalYaw);
    const pivotX = this.tractor.x;
    const pivotY = this.tractor.y + CHASE_PIVOT_HEIGHT_M;
    const pivotZ = this.tractor.z;

    let pitch = wantPitch;
    let dist = wantDist;
    let clamped = false;

    if (this.collider) {
      // How fast the boom swings round (tractor turning or the player orbiting): the solver also looks at
      // where the boom will be in a moment, so it tilts up before a house corner cuts into it.
      if (snap || dt <= 0 || this.chasePrevYaw === null) {
        this.chaseYawRate = 0;
      } else {
        const dYaw = Math.atan2(Math.sin(totalYaw - this.chasePrevYaw), Math.cos(totalYaw - this.chasePrevYaw));
        this.chaseYawRate += (dYaw / dt - this.chaseYawRate) * Math.min(1, dt * 8);
      }
      this.chasePrevYaw = totalYaw;
      const yawAhead = THREE.MathUtils.clamp(this.chaseYawRate * CHASE_LOOKAHEAD_S, -0.7, 0.7);

      const reach = wantDist * Math.cos(wantPitch);
      this.sampleChaseProfile(0, pivotX, pivotZ, totalYaw, reach);
      this.chaseProfilesUsed = 1;
      if (Math.abs(yawAhead) > 0.03) {
        this.sampleChaseProfile(1, pivotX, pivotZ, totalYaw + yawAhead * 0.5, reach);
        this.sampleChaseProfile(2, pivotX, pivotZ, totalYaw + yawAhead, reach);
        this.chaseProfilesUsed = 3;
      }

      // 1. Where the boom would like to be (see the CHASE_* comment above for the order of preference).
      const cap = Math.max(wantPitch, CHASE_MAX_PITCH_RAD);
      const keepDist = wantDist * CHASE_KEEP_FRACTION;
      const straightDist = this.clearChaseDistanceAhead(pivotX, pivotY, pivotZ, wantPitch, wantDist);
      let targetPitch = wantPitch;
      let targetDist = straightDist;
      if (straightDist < keepDist) {
        // (a) low obstacle: the lowest moderate tilt that keeps almost the full length
        let cleared = false;
        for (let k = 1; k <= CHASE_PITCH_CANDIDATES && cap > wantPitch; k++) {
          const p = wantPitch + ((cap - wantPitch) * k) / CHASE_PITCH_CANDIDATES;
          const d = this.clearChaseDistanceAhead(pivotX, pivotY, pivotZ, p, wantDist);
          if (d >= keepDist) {
            targetPitch = p;
            targetDist = d;
            cleared = true;
            break;
          }
        }
        if (!cleared) {
          // (b) tall obstacle: shorten first; tilt grows continuously as the boom gets shorter than comfortable
          const shortness = THREE.MathUtils.clamp(
            (CHASE_COMFORT_DIST_M - straightDist) / (CHASE_COMFORT_DIST_M - CHASE_MIN_DIST_M),
            0,
            1
          );
          targetPitch = THREE.MathUtils.lerp(wantPitch, cap, shortness * shortness * (3 - 2 * shortness));
          targetDist = Math.max(
            straightDist,
            this.clearChaseDistanceAhead(pivotX, pivotY, pivotZ, targetPitch, wantDist)
          );
          // (c) no usable boom even at the cap: steeper, but only as far as needed
          if (targetDist < CHASE_SHORT_DIST_M) {
            for (let k = 1; k <= CHASE_PITCH_CANDIDATES; k++) {
              const p = cap + ((CHASE_EMERGENCY_PITCH_RAD - cap) * k) / CHASE_PITCH_CANDIDATES;
              const d = this.clearChaseDistanceAhead(pivotX, pivotY, pivotZ, p, wantDist);
              if (d > targetDist + 1e-3) {
                targetPitch = p;
                targetDist = d;
              }
              if (d >= CHASE_SHORT_DIST_M) break;
            }
          }
        }
      }

      // 2. Ease towards it: tilt up briskly, settle back slowly (no pumping while passing house corners).
      if (snap || dt <= 0) {
        this.chaseBoomPitch = targetPitch;
        this.chaseBoomDist = targetDist;
      } else {
        const pitchRate = this.isDraggingLook
          ? 18
          : targetPitch > this.chaseBoomPitch
            ? CHASE_PITCH_UP_RATE
            : CHASE_PITCH_DOWN_RATE;
        this.chaseBoomPitch += (targetPitch - this.chaseBoomPitch) * Math.min(1, dt * pitchRate);
        const distRate = targetDist < this.chaseBoomDist ? 10 : 2.4;
        this.chaseBoomDist += (targetDist - this.chaseBoomDist) * Math.min(1, dt * distRate);
      }

      // 3. Hard limit at the tilt actually used this frame: the camera is never placed inside an obstacle.
      const hardDist = this.clearChaseDistance(0, pivotX, pivotY, pivotZ, this.chaseBoomPitch, wantDist, true);
      if (hardDist < this.chaseBoomDist) {
        this.chaseBoomDist = hardDist;
        clamped = true;
      }
      pitch = this.chaseBoomPitch;
      dist = this.chaseBoomDist;

      // 4. Overhead landmark geometry (archway, hall door lintel) that the polygons do not describe.
      if (this.chaseOccluders.length > 0) {
        this.tmpPivot.set(pivotX, pivotY, pivotZ);
        this.tmpBoomDir.set(dirX * Math.cos(pitch), Math.sin(pitch), dirZ * Math.cos(pitch));
        const hit = this.landmarkHitDistance(this.tmpPivot, this.tmpBoomDir, dist + CHASE_MESH_MARGIN_M);
        if (hit - CHASE_MESH_MARGIN_M < dist) {
          dist = hit - CHASE_MESH_MARGIN_M;
          this.chaseBoomDist = dist;
          clamped = true;
        }
      }
      dist = Math.max(CHASE_MIN_DIST_M, dist);
    }

    const horizDist = dist * Math.cos(pitch);
    const camX = pivotX + dirX * horizDist;
    const camZ = pivotZ + dirZ * horizDist;
    const groundAtCam = this.terrain.getTerrainHeight(camX, camZ);
    const camY = Math.max(pivotY + dist * Math.sin(pitch), groundAtCam + 1.8);

    // Look slightly ahead of tractor hood so the road, church spire & checkpoints fill the upper frame.
    // A steeper boom (tilted up behind a house) lowers the aim point a little so the tractor stays in the
    // lower frame, but the aim stays AHEAD of the tractor: the view never turns into a top-down shot.
    const steep = THREE.MathUtils.smoothstep(pitch, 0.4, CHASE_EMERGENCY_PITCH_RAD);
    const lookAhead = THREE.MathUtils.lerp(5.5, 6.0, steep);
    const lookX = this.tractor.x + Math.sin(this.tractor.headingRad) * lookAhead;
    const lookZ = this.tractor.z + Math.cos(this.tractor.headingRad) * lookAhead;
    const lookY = this.tractor.y + THREE.MathUtils.lerp(2.45, 1.2, steep);

    this.tmpDesiredPos.set(camX, camY, camZ);
    this.tmpDesiredLook.set(lookX, lookY, lookZ);

    if (snap) {
      this.camera.position.copy(this.tmpDesiredPos);
      this.chaseLookTarget.copy(this.tmpDesiredLook);
    } else {
      this.camera.position.lerp(this.tmpDesiredPos, smoothAlpha);
      this.chaseLookTarget.lerp(this.tmpDesiredLook, Math.min(1, smoothAlpha * 1.3));
      // The eased position lags behind the solved one; where that lag would cut through an obstacle
      // (the tractor swung round a house corner) the camera goes straight to the solved position.
      if (this.collider) {
        const p = this.camera.position;
        if (clamped) {
          // Shortened boom: the eased camera may trail sideways, but never further out than the clear length.
          this.tmpPivot.set(pivotX, pivotY, pivotZ);
          const lagDist = p.distanceTo(this.tmpPivot);
          if (lagDist > dist) p.sub(this.tmpPivot).multiplyScalar(dist / lagDist).add(this.tmpPivot);
        }
        const lagTop = this.collider.obstacleTopAt(p.x, p.z, CHASE_CLEAR_RADIUS_M * 0.6, this.groundHeightAt);
        if (p.y < lagTop + CHASE_CLEAR_ABOVE_M * 0.5) p.copy(this.tmpDesiredPos);
      }
    }
    this.camera.lookAt(this.chaseLookTarget);
  }

  private updateCabCamera(): void {
    if (!this.tractor) return;
    this.tractor.tractorRoot.updateMatrixWorld(true);

    const eyeWorld = this.tractor.cabCameraOffset.clone().applyMatrix4(this.tractor.tractorRoot.matrixWorld);
    this.camera.position.copy(eyeWorld);

    // Build cab-space look direction looking forward (+Z) with optional mouse look-around
    const localLookDir = new THREE.Vector3(
      Math.sin(this.cabLookYaw) * Math.cos(this.cabLookPitch),
      Math.sin(this.cabLookPitch),
      Math.cos(this.cabLookYaw) * Math.cos(this.cabLookPitch)
    );
    const lookPoint = this.tractor.cabCameraOffset.clone().addScaledVector(localLookDir, 30);
    lookPoint.applyMatrix4(this.tractor.tractorRoot.matrixWorld);
    this.camera.lookAt(lookPoint);
  }

  public getFocusTarget(): THREE.Vector3 {
    if (this.mode !== 'drone' && this.tractor) {
      return this.tractor.tractorRoot.position;
    }
    return this.controls.target;
  }

  public getFocusDistance(): number {
    if (this.mode !== 'drone') return 140;
    return this.camera.position.distanceTo(this.controls.target);
  }

  public getLookYawForMap(): number {
    this.camera.getWorldDirection(this.tmpForward);
    return Math.atan2(this.tmpForward.x, -this.tmpForward.z);
  }

  public update(dt: number): void {
    const safeDt = Math.min(dt, 0.08);
    const bound = this.terrain.halfSizeM - 16;

    if (this.mode === 'chase') {
      this.updateChaseCamera(Math.min(1, safeDt * 7.5), safeDt);
      return;
    }

    if (this.mode === 'cab') {
      if (!this.isDraggingLook && this.tractor && Math.abs(this.tractor.speedMps) > 0.8) {
        this.cabLookYaw = THREE.MathUtils.lerp(this.cabLookYaw, 0, Math.min(1, safeDt * 2.2));
        this.cabLookPitch = THREE.MathUtils.lerp(this.cabLookPitch, -0.05, Math.min(1, safeDt * 1.8));
      }
      this.updateCabCamera();
      return;
    }

    // Drone / Benchmark mode
    if (this.flight) {
      this.flight.elapsed += safeDt;
      const t = Math.min(1, this.flight.elapsed / this.flight.duration);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.camera.position.lerpVectors(this.flight.startPos, this.flight.endPos, ease);
      this.controls.target.lerpVectors(this.flight.startTarget, this.flight.endTarget, ease);
      this.camera.fov = THREE.MathUtils.lerp(this.flight.startFov, this.flight.endFov, ease);
      this.camera.updateProjectionMatrix();
      if (t >= 1) this.flight = null;
      this.controls.update();
      return;
    }

    const hasMoveKey =
      this.keys.has('KeyW') ||
      this.keys.has('KeyS') ||
      this.keys.has('KeyA') ||
      this.keys.has('KeyD') ||
      this.keys.has('ArrowUp') ||
      this.keys.has('ArrowDown') ||
      this.keys.has('ArrowLeft') ||
      this.keys.has('ArrowRight');

    if (hasMoveKey) {
      const dist = this.camera.position.distanceTo(this.controls.target);
      const panSpeed =
        THREE.MathUtils.clamp(dist * 0.48, 16, 220) *
        (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 2.2 : 1.0);
      this.camera.getWorldDirection(this.tmpForward);
      this.tmpForward.y = 0;
      if (this.tmpForward.lengthSq() > 1e-6) this.tmpForward.normalize();
      this.tmpRight.crossVectors(this.tmpForward, THREE.Object3D.DEFAULT_UP).normalize();

      this.tmpMove.set(0, 0, 0);
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.tmpMove.add(this.tmpForward);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.tmpMove.sub(this.tmpForward);
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.tmpMove.add(this.tmpRight);
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.tmpMove.sub(this.tmpRight);

      if (this.tmpMove.lengthSq() > 0) {
        this.tmpMove.normalize().multiplyScalar(panSpeed * safeDt);
        this.camera.position.add(this.tmpMove);
        this.controls.target.add(this.tmpMove);
      }
    }

    this.controls.target.x = THREE.MathUtils.clamp(this.controls.target.x, -bound, bound);
    this.controls.target.z = THREE.MathUtils.clamp(this.controls.target.z, -bound, bound);
    this.controls.update();

    const groundY = this.terrain.getTerrainHeight(this.camera.position.x, this.camera.position.z);
    if (this.camera.position.y < groundY + 1.8) {
      this.camera.position.y = groundY + 1.8;
    }
  }
}
