import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { LoadedLandmarkInfo } from './buildings';
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
  private lastPointerX = 0;
  private lastPointerY = 0;
  private chaseLookTarget = new THREE.Vector3();

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

  private bindInputEvents(): void {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.isDraggingLook = false;
    });

    this.domElement.addEventListener('pointerdown', (e) => {
      if (this.mode === 'drone') return;
      if (e.button !== 0 && e.button !== 2) return;
      this.isDraggingLook = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.isDraggingLook || this.mode === 'drone') return;
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

    window.addEventListener('pointerup', () => {
      this.isDraggingLook = false;
    });

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

  private updateChaseCamera(smoothAlpha: number, dt: number): void {
    if (!this.tractor) return;

    // Auto-recenter gently behind the tractor when driving forward without dragging
    if (!this.isDraggingLook && Math.abs(this.tractor.speedMps) > 0.7 && dt > 0) {
      this.chaseOrbitYaw = THREE.MathUtils.lerp(this.chaseOrbitYaw, 0, Math.min(1, dt * 1.8));
      this.chaseOrbitPitch = THREE.MathUtils.lerp(this.chaseOrbitPitch, 0.22, Math.min(1, dt * 1.2));
    }

    const totalYaw = this.tractor.headingRad + this.chaseOrbitYaw;
    const dist = this.tractor.trailerAttached ? Math.max(this.chaseDistance, 11.4) : this.chaseDistance;
    const horizDist = dist * Math.cos(this.chaseOrbitPitch);
    const heightOff = 2.0 + dist * Math.sin(this.chaseOrbitPitch);

    // Behind the tractor (-forward)
    const camX = this.tractor.x - Math.sin(totalYaw) * horizDist;
    const camZ = this.tractor.z - Math.cos(totalYaw) * horizDist;
    const groundAtCam = this.terrain.getTerrainHeight(camX, camZ);
    const camY = Math.max(this.tractor.y + heightOff, groundAtCam + 1.8);

    // Look slightly ahead of tractor hood so the road, church spire & checkpoints fill the upper frame!
    const lookAhead = 5.5;
    const lookX = this.tractor.x + Math.sin(this.tractor.headingRad) * lookAhead;
    const lookZ = this.tractor.z + Math.cos(this.tractor.headingRad) * lookAhead;
    const lookY = this.tractor.y + 2.45;

    this.tmpDesiredPos.set(camX, camY, camZ);
    this.tmpDesiredLook.set(lookX, lookY, lookZ);

    if (smoothAlpha >= 0.99) {
      this.camera.position.copy(this.tmpDesiredPos);
      this.chaseLookTarget.copy(this.tmpDesiredLook);
    } else {
      this.camera.position.lerp(this.tmpDesiredPos, smoothAlpha);
      this.chaseLookTarget.lerp(this.tmpDesiredLook, Math.min(1, smoothAlpha * 1.3));
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
