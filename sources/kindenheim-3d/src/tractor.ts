import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BuildingCollider } from './collision';
import { getBridgeDeckSurfaceHeight } from './roads';
import type { TerrainSystem } from './terrain';
import type { TractorManifest } from './types';

export interface TractorInput {
  throttle: number; // -1..+1 (W/Up = +1, S/Down = -1)
  steer: number;    // -1..+1 (A/Left = +1, D/Right = -1)
  handbrake: boolean;
}

export interface TractorTelemetry {
  x: number;
  y: number;
  z: number;
  headingRad: number;
  speedMps: number;
  speedKmh: number;
  steerAngleRad: number;
  frontWheelSpinRad: number;
  rearWheelSpinRad: number;
  gear: string;
  rpm: number;
  rpmNorm: number;
  lightsOn: boolean;
  beaconOn: boolean;
  trailerAttached: boolean;
  trailerX: number;
  trailerZ: number;
  trailerYawRad: number;
  colliding: boolean;
  usingBlenderModels: boolean;
}

// Verified straight stretch of Hauptstraße in Kindenheim village center facing ENE toward Martinskirche & Rathaus!
export const TRACTOR_DEFAULT_SPAWN = {
  x: -67.13,
  z: -36.61,
  headingRad: 1.943,
};

interface ParticleSlot {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  age: number;
  life: number;
  baseScale: number;
  maxScale: number;
  active: boolean;
}

function createSoftGlowTexture(innerHex: string, outerRgba: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, innerHex);
  g.addColorStop(0.35, outerRgba);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function findNodeByName(root: THREE.Object3D, exact: string, fallbackSubstr?: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  const exactLower = exact.toLowerCase();
  const subLower = fallbackSubstr?.toLowerCase();
  root.traverse((obj) => {
    if (found) return;
    if (obj.name.toLowerCase() === exactLower) {
      found = obj;
    }
  });
  if (!found && subLower) {
    root.traverse((obj) => {
      if (found) return;
      if (obj.name.toLowerCase().includes(subLower)) {
        found = obj;
      }
    });
  }
  return found;
}

function wrapSteerPivot(wheelObj: THREE.Object3D | null): THREE.Group | null {
  if (!wheelObj || !wheelObj.parent) return null;
  const parent = wheelObj.parent;
  const pivot = new THREE.Group();
  pivot.name = `${wheelObj.name}_SteerPivot`;
  pivot.position.copy(wheelObj.position);
  wheelObj.position.set(0, 0, 0);
  parent.add(pivot);
  pivot.add(wheelObj);
  return pivot;
}

function createPlaceholderTractor(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'PlaceholderTractor';

  const greenMat = new THREE.MeshStandardMaterial({ color: 0x2f7d32, roughness: 0.35, metalness: 0.25 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x222629, roughness: 0.65, metalness: 0.3 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.9, metalness: 0.05 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xe6b822, roughness: 0.35, metalness: 0.4 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xb8d8e8,
    transparent: true,
    opacity: 0.18,
    roughness: 0.1,
    metalness: 0.2,
    depthWrite: false,
  });

  const chassis = new THREE.Group();
  chassis.name = 'Chassis';
  root.add(chassis);

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.8, 3.6), darkMat);
  body.position.set(0, 1.0, 0.1);
  body.castShadow = true;
  chassis.add(body);

  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.72, 2.05), greenMat);
  hood.position.set(0, 1.58, 1.05);
  hood.castShadow = true;
  chassis.add(hood);

  // Cab pillars + roof (clear sightline for 1st-person view)
  const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.12, 1.55), greenMat);
  cabRoof.position.set(0, 2.86, -0.45);
  cabRoof.castShadow = true;
  chassis.add(cabRoof);

  for (const sx of [-0.7, 0.7]) {
    for (const sz of [-1.15, 0.25]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.45, 0.08), darkMat);
      pillar.position.set(sx, 2.15, sz);
      chassis.add(pillar);
    }
  }
  const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 1.2), glassMat);
  windshield.position.set(0, 2.2, 0.28);
  chassis.add(windshield);

  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.65, 10), darkMat);
  exhaust.position.set(-0.68, 2.0, 0.85);
  chassis.add(exhaust);

  const makeWheel = (name: string, x: number, y: number, z: number, r: number, w: number) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 20), tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    g.add(tire);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.56, r * 0.56, w + 0.03, 12), rimMat);
    rim.rotation.z = Math.PI / 2;
    g.add(rim);
    root.add(g);
  };

  makeWheel('Wheel_FL', 0.96, 0.58, 1.38, 0.58, 0.42);
  makeWheel('Wheel_FR', -0.96, 0.58, 1.38, 0.58, 0.42);
  makeWheel('Wheel_RL', 1.02, 0.88, -1.08, 0.88, 0.58);
  makeWheel('Wheel_RR', -1.02, 0.88, -1.08, 0.88, 0.58);

  const steeringWheel = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 8, 20), darkMat);
  steeringWheel.name = 'SteeringWheel';
  steeringWheel.position.set(0, 1.88, 0.02);
  steeringWheel.rotation.x = Math.PI * 0.35;
  root.add(steeringWheel);

  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.1, 0.2, 12),
    new THREE.MeshStandardMaterial({ color: 0xff8c14, emissive: 0xff6a00, emissiveIntensity: 0.9 })
  );
  beacon.name = 'Beacon';
  beacon.position.set(0, 3.0, -0.3);
  root.add(beacon);

  const headlights = new THREE.Group();
  headlights.name = 'Headlights';
  const hlMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0c8, emissiveIntensity: 1.0 });
  for (const hx of [-0.45, 0.45]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.06), hlMat);
    lamp.position.set(hx, 1.4, 2.08);
    headlights.add(lamp);
  }
  root.add(headlights);

  const taillights = new THREE.Group();
  taillights.name = 'Taillights';
  const tlMat = new THREE.MeshStandardMaterial({ color: 0xcc1818, emissive: 0xff1818, emissiveIntensity: 0.6 });
  for (const tx of [-0.88, 0.88]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.06), tlMat);
    lamp.position.set(tx, 1.5, -1.68);
    taillights.add(lamp);
  }
  root.add(taillights);

  return root;
}

function createPlaceholderTrailer(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'PlaceholderTrailer';
  const bedMat = new THREE.MeshStandardMaterial({ color: 0x33692e, roughness: 0.5, metalness: 0.3 });
  const grapeMat = new THREE.MeshStandardMaterial({ color: 0x3c1f4a, roughness: 0.72, metalness: 0.05 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x454a4f, roughness: 0.55, metalness: 0.5 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd93829, roughness: 0.4 });

  const bed = new THREE.Mesh(new THREE.BoxGeometry(2.05, 1.05, 3.5), bedMat);
  bed.position.set(0, 1.32, -0.35);
  bed.castShadow = true;
  bed.receiveShadow = true;
  root.add(bed);

  const grapes = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.42, 3.3), grapeMat);
  grapes.position.set(0, 1.85, -0.35);
  grapes.castShadow = true;
  root.add(grapes);

  const towBar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 1.25), steelMat);
  towBar.position.set(0, 0.62, 1.82);
  root.add(towBar);

  for (const [name, x] of [
    ['Wheel_L', 0.98],
    ['Wheel_R', -0.98],
  ] as const) {
    const wg = new THREE.Group();
    wg.name = name;
    wg.position.set(x, 0.48, -0.45);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.38, 18), tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    wg.add(tire);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.4, 10), rimMat);
    rim.rotation.z = Math.PI / 2;
    wg.add(rim);
    root.add(wg);
  }
  return root;
}

export class TractorController {
  public readonly group = new THREE.Group();
  public readonly tractorRoot = new THREE.Group();
  public readonly trailerRoot = new THREE.Group();

  private readonly terrain: TerrainSystem;
  private readonly collider: BuildingCollider;
  private readonly maxAnisotropy: number;

  // Manifest dimensions (updated cleanly from manifest.json when present)
  private frontWheelRadius = 0.58;
  private rearWheelRadius = 0.88;
  private wheelFLPos = new THREE.Vector3(0.95, 0.58, 1.38);
  private wheelFRPos = new THREE.Vector3(-0.95, 0.58, 1.38);
  private wheelRLPos = new THREE.Vector3(1.02, 0.88, -1.08);
  private wheelRRPos = new THREE.Vector3(-1.02, 0.88, -1.08);
  public cabCameraOffset = new THREE.Vector3(0, 2.28, -0.35);
  private exhaustTipOffset = new THREE.Vector3(-0.68, 2.82, 0.85);
  private beaconOffset = new THREE.Vector3(0, 3.02, -0.3);
  private headlightOffsets: THREE.Vector3[] = [
    new THREE.Vector3(0.45, 1.4, 2.1),
    new THREE.Vector3(-0.45, 1.4, 2.1),
  ];
  private rearHitchOffset = new THREE.Vector3(0, 0.62, -2.05);
  private trailerHitchOffset = new THREE.Vector3(0, 0.62, 2.35);
  private trailerWheelRadius = 0.48;
  private trailerAxleOffsetZ = -0.45;
  private wheelbase = 2.46;
  private trackWidth = 1.96;

  // Animated node references
  private pivotFL: THREE.Group | null = null;
  private pivotFR: THREE.Group | null = null;
  private wheelFL: THREE.Object3D | null = null;
  private wheelFR: THREE.Object3D | null = null;
  private wheelRL: THREE.Object3D | null = null;
  private wheelRR: THREE.Object3D | null = null;
  private steeringWheel: THREE.Object3D | null = null;
  private steeringWheelBaseRot = new THREE.Euler();
  private beaconNode: THREE.Object3D | null = null;
  private headlightMats: THREE.MeshStandardMaterial[] = [];
  private taillightMats: THREE.MeshStandardMaterial[] = [];
  private beaconMats: THREE.MeshStandardMaterial[] = [];
  private trailerWheels: THREE.Object3D[] = [];

  // Dynamic lights
  private spotLights: THREE.SpotLight[] = [];
  private headlightGlows: THREE.Sprite[] = [];
  private beaconLight: THREE.PointLight | null = null;
  private beaconGlow: THREE.Sprite | null = null;

  // Particle pools (exhaust smoke + dirt tire dust)
  private readonly particleGroup = new THREE.Group();
  private readonly smokePool: ParticleSlot[] = [];
  private readonly dustPool: ParticleSlot[] = [];
  private smokeTimer = 0;
  private dustTimer = 0;

  // Kinematic & physical state
  public x = TRACTOR_DEFAULT_SPAWN.x;
  public y = 0;
  public z = TRACTOR_DEFAULT_SPAWN.z;
  public headingRad = TRACTOR_DEFAULT_SPAWN.headingRad;
  public pitchRad = 0;
  public rollRad = 0;
  public speedMps = 0;
  public steerAngleRad = 0;
  public frontWheelSpinRad = 0;
  public rearWheelSpinRad = 0;
  public trailerWheelSpinRad = 0;
  public rpm = 850;
  public rpmNorm = 0;
  public gear = 'N';
  public colliding = false;

  // Trailer state
  public trailerAttached = true;
  public trailerX = 0;
  public trailerY = 0;
  public trailerZ = 0;
  public trailerYawRad = TRACTOR_DEFAULT_SPAWN.headingRad;
  public trailerPitchRad = 0;
  public trailerRollRad = 0;
  private trailerAxleWorld = new THREE.Vector3();

  // Toggles
  public lightsOn = false;
  public beaconOn = true;
  public usingBlenderModels = false;
  private beaconPhase = 0;

  constructor(terrain: TerrainSystem, collider: BuildingCollider, maxAnisotropy: number) {
    this.terrain = terrain;
    this.collider = collider;
    this.maxAnisotropy = maxAnisotropy;

    this.group.name = 'TractorGameSystem';
    this.tractorRoot.name = 'TractorRoot';
    this.tractorRoot.rotation.order = 'YXZ';
    this.trailerRoot.name = 'TrailerRoot';
    this.trailerRoot.rotation.order = 'YXZ';
    this.particleGroup.name = 'TractorParticles';

    this.group.add(this.tractorRoot, this.trailerRoot, this.particleGroup);
    this.initParticlePools();
  }

  public async loadModels(manifest: TractorManifest | null): Promise<void> {
    if (manifest) {
      if (typeof manifest.frontWheelRadius === 'number') this.frontWheelRadius = manifest.frontWheelRadius;
      if (typeof manifest.rearWheelRadius === 'number') this.rearWheelRadius = manifest.rearWheelRadius;
      if (manifest.wheelPositions?.FL) this.wheelFLPos.set(...manifest.wheelPositions.FL);
      if (manifest.wheelPositions?.FR) this.wheelFRPos.set(...manifest.wheelPositions.FR);
      if (manifest.wheelPositions?.RL) this.wheelRLPos.set(...manifest.wheelPositions.RL);
      if (manifest.wheelPositions?.RR) this.wheelRRPos.set(...manifest.wheelPositions.RR);
      if (manifest.cabCameraOffset) this.cabCameraOffset.set(...manifest.cabCameraOffset);
      if (manifest.exhaustTipOffset) this.exhaustTipOffset.set(...manifest.exhaustTipOffset);
      if (manifest.beaconOffset) this.beaconOffset.set(...manifest.beaconOffset);
      if (Array.isArray(manifest.headlightOffsets) && manifest.headlightOffsets.length > 0) {
        this.headlightOffsets = manifest.headlightOffsets.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
      }
      if (manifest.rearHitchOffset) this.rearHitchOffset.set(...manifest.rearHitchOffset);
      if (manifest.trailerHitchOffset) this.trailerHitchOffset.set(...manifest.trailerHitchOffset);
      if (typeof manifest.trailerWheelRadius === 'number') this.trailerWheelRadius = manifest.trailerWheelRadius;
      if (typeof manifest.trailerAxleOffsetZ === 'number') this.trailerAxleOffsetZ = manifest.trailerAxleOffsetZ;

      this.wheelbase = Math.max(1.5, Math.abs(this.wheelFLPos.z - this.wheelRLPos.z));
      this.trackWidth = Math.max(1.2, Math.abs(this.wheelFLPos.x - this.wheelFRPos.x));
    }

    const loader = new GLTFLoader();
    let tractorScene: THREE.Object3D | null = null;
    let trailerScene: THREE.Object3D | null = null;

    if (manifest?.tractorGlb) {
      try {
        const gltf = await loader.loadAsync(manifest.tractorGlb);
        tractorScene = gltf.scene;
        this.usingBlenderModels = true;
      } catch (err) {
        console.warn('[tractor] Falling back to placeholder tractor:', err);
      }
    }
    if (manifest?.trailerGlb) {
      try {
        const gltf = await loader.loadAsync(manifest.trailerGlb);
        trailerScene = gltf.scene;
      } catch (err) {
        console.warn('[tractor] Falling back to placeholder trailer:', err);
      }
    }

    this.mountTractorModel(tractorScene ?? createPlaceholderTractor());
    this.mountTrailerModel(trailerScene ?? createPlaceholderTrailer());
    this.setupVehicleLights();
    this.resetToHauptstrasse();
  }

  private tuneMaterials(root: THREE.Object3D): void {
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshPhysicalMaterial) {
          m.envMapIntensity = 0.85;
          if (m.map) m.map.anisotropy = Math.min(8, this.maxAnisotropy);
          if (m.transparent && m.opacity < 0.5) {
            obj.castShadow = false;
            m.depthWrite = false;
          }
        }
      }
    });
  }

  private mountTractorModel(model: THREE.Object3D): void {
    this.tractorRoot.clear();
    this.tuneMaterials(model);
    this.tractorRoot.add(model);

    this.wheelFL = findNodeByName(model, 'Wheel_FL', 'wheel_fl');
    this.wheelFR = findNodeByName(model, 'Wheel_FR', 'wheel_fr');
    this.wheelRL = findNodeByName(model, 'Wheel_RL', 'wheel_rl');
    this.wheelRR = findNodeByName(model, 'Wheel_RR', 'wheel_rr');

    this.pivotFL = wrapSteerPivot(this.wheelFL);
    this.pivotFR = wrapSteerPivot(this.wheelFR);

    this.steeringWheel = findNodeByName(model, 'SteeringWheel', 'steering');
    if (this.steeringWheel) {
      this.steeringWheelBaseRot.copy(this.steeringWheel.rotation);
    }

    this.beaconNode = findNodeByName(model, 'Beacon', 'beacon');
    this.beaconMats = [];
    if (this.beaconNode) {
      this.beaconNode.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m instanceof THREE.MeshStandardMaterial && m.name.toLowerCase().includes('amber')) {
              this.beaconMats.push(m);
            }
          }
        }
      });
    }

    this.headlightMats = [];
    const hlObj = findNodeByName(model, 'Headlights', 'headlight');
    if (hlObj) {
      hlObj.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m instanceof THREE.MeshStandardMaterial) this.headlightMats.push(m);
          }
        }
      });
    }

    this.taillightMats = [];
    const tlObj = findNodeByName(model, 'Taillights', 'taillight');
    if (tlObj) {
      tlObj.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m instanceof THREE.MeshStandardMaterial) this.taillightMats.push(m);
          }
        }
      });
    }
  }

  private mountTrailerModel(model: THREE.Object3D): void {
    this.trailerRoot.clear();
    this.tuneMaterials(model);
    this.trailerRoot.add(model);

    this.trailerWheels = [];
    model.traverse((obj) => {
      const n = obj.name.toLowerCase();
      if (n.startsWith('wheel_')) {
        this.trailerWheels.push(obj);
      }
      if (obj instanceof THREE.Mesh) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (m instanceof THREE.MeshStandardMaterial && m.name.toLowerCase().includes('taillight')) {
            this.taillightMats.push(m);
          }
        }
      }
    });
  }

  private setupVehicleLights(): void {
    this.spotLights = [];
    this.headlightGlows = [];

    const hlGlowTex = createSoftGlowTexture('rgba(255,250,220,0.95)', 'rgba(255,235,175,0.42)');
    for (const off of this.headlightOffsets) {
      const spot = new THREE.SpotLight(0xfff1cc, 0, 105, 0.64, 0.52, 1.2);
      spot.position.copy(off);
      spot.castShadow = false;

      const target = new THREE.Object3D();
      target.position.set(off.x * 1.15, 0.1, off.z + 22);
      this.tractorRoot.add(target);
      spot.target = target;
      this.tractorRoot.add(spot);
      this.spotLights.push(spot);

      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: hlGlowTex,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0,
        })
      );
      glow.position.set(off.x, off.y, off.z + 0.08);
      glow.scale.set(0.75, 0.75, 1);
      this.tractorRoot.add(glow);
      this.headlightGlows.push(glow);
    }

    // Amber Rundumleuchte beacon light + glow sprite
    const amberTex = createSoftGlowTexture('rgba(255,210,90,1.0)', 'rgba(255,130,15,0.55)');
    this.beaconLight = new THREE.PointLight(0xff8c14, 0, 26, 1.7);
    this.beaconLight.position.set(this.beaconOffset.x, this.beaconOffset.y + 0.16, this.beaconOffset.z);
    this.tractorRoot.add(this.beaconLight);

    this.beaconGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: amberTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.9,
      })
    );
    this.beaconGlow.position.set(this.beaconOffset.x, this.beaconOffset.y + 0.12, this.beaconOffset.z);
    this.beaconGlow.scale.set(0.9, 0.9, 1);
    this.tractorRoot.add(this.beaconGlow);

    this.applyLightVisuals(false);
  }

  private initParticlePools(): void {
    const smokeTex = createSoftGlowTexture('rgba(80,82,84,0.48)', 'rgba(110,112,115,0.22)');
    const dustTex = createSoftGlowTexture('rgba(176,154,116,0.45)', 'rgba(164,142,106,0.18)');

    for (let i = 0; i < 20; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0, depthWrite: false })
      );
      sprite.visible = false;
      this.particleGroup.add(sprite);
      this.smokePool.push({
        sprite,
        vel: new THREE.Vector3(),
        age: 0,
        life: 1,
        baseScale: 0.25,
        maxScale: 1.2,
        active: false,
      });
    }

    for (let i = 0; i < 16; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: dustTex, transparent: true, opacity: 0, depthWrite: false })
      );
      sprite.visible = false;
      this.particleGroup.add(sprite);
      this.dustPool.push({
        sprite,
        vel: new THREE.Vector3(),
        age: 0,
        life: 1,
        baseScale: 0.45,
        maxScale: 1.8,
        active: false,
      });
    }
  }

  private sampleSurfaceY(x: number, z: number): number {
    // Draped roads sit ~0.07–0.11m above raw terrain height; span smoothly over the Kinderbach bridge deck too!
    const bridgeH = getBridgeDeckSurfaceHeight(x, z, this.terrain);
    const baseH = bridgeH !== null ? bridgeH : this.terrain.getTerrainHeight(x, z);
    return baseH + 0.06;
  }

  public resetToHauptstrasse(): void {
    this.teleport(TRACTOR_DEFAULT_SPAWN.x, TRACTOR_DEFAULT_SPAWN.z, TRACTOR_DEFAULT_SPAWN.headingRad);
  }

  public teleport(x: number, z: number, headingRad: number): void {
    this.x = THREE.MathUtils.clamp(x, -this.terrain.halfSizeM + 14, this.terrain.halfSizeM - 14);
    this.z = THREE.MathUtils.clamp(z, -this.terrain.halfSizeM + 14, this.terrain.halfSizeM - 14);
    this.headingRad = headingRad;
    this.speedMps = 0;
    this.steerAngleRad = 0;
    this.colliding = false;

    this.conformChassisToTerrain(1.0);

    // Place trailer aligned straight behind rear hitch
    this.tractorRoot.updateMatrixWorld(true);
    const hitchWorld = this.rearHitchOffset.clone().applyMatrix4(this.tractorRoot.matrixWorld);
    const fwdX = Math.sin(this.headingRad);
    const fwdZ = Math.cos(this.headingRad);
    const hitchToAxle = Math.max(1.8, this.trailerHitchOffset.z - this.trailerAxleOffsetZ);

    this.trailerYawRad = this.headingRad;
    this.trailerAxleWorld.set(hitchWorld.x - fwdX * hitchToAxle, hitchWorld.y, hitchWorld.z - fwdZ * hitchToAxle);
    this.updateTrailerKinematics(0, 1.0);
  }

  public setOptions(opts: { lights?: boolean; beacon?: boolean; trailer?: boolean }): void {
    if (typeof opts.lights === 'boolean') this.lightsOn = opts.lights;
    if (typeof opts.beacon === 'boolean') this.beaconOn = opts.beacon;
    if (typeof opts.trailer === 'boolean') {
      const reattaching = !this.trailerAttached && opts.trailer;
      this.trailerAttached = opts.trailer;
      this.trailerRoot.visible = this.trailerAttached;
      if (reattaching) {
        this.tractorRoot.updateMatrixWorld(true);
        const hitchWorld = this.rearHitchOffset.clone().applyMatrix4(this.tractorRoot.matrixWorld);
        const fwdX = Math.sin(this.headingRad);
        const fwdZ = Math.cos(this.headingRad);
        const hitchToAxle = Math.max(1.8, this.trailerHitchOffset.z - this.trailerAxleOffsetZ);
        this.trailerYawRad = this.headingRad;
        this.trailerAxleWorld.set(hitchWorld.x - fwdX * hitchToAxle, hitchWorld.y, hitchWorld.z - fwdZ * hitchToAxle);
        this.updateTrailerKinematics(0, 1.0);
      }
    }
    this.applyLightVisuals(false);
  }

  private applyLightVisuals(isBraking: boolean): void {
    const spotIntensity = this.lightsOn ? 98 : 0;
    for (const s of this.spotLights) {
      s.intensity = spotIntensity;
    }
    for (const g of this.headlightGlows) {
      (g.material as THREE.SpriteMaterial).opacity = this.lightsOn ? 0.85 : 0;
    }
    for (const m of this.headlightMats) {
      m.emissive.setHex(0xfff0c4);
      m.emissiveIntensity = this.lightsOn ? 2.6 : 0.08;
    }
    for (const m of this.taillightMats) {
      m.emissive.setHex(0xff1e10);
      m.emissiveIntensity = isBraking ? 2.8 : this.lightsOn ? 1.15 : 0.2;
    }
  }

  private conformChassisToTerrain(smoothAlpha: number): void {
    const cosH = Math.cos(this.headingRad);
    const sinH = Math.sin(this.headingRad);

    const worldOf = (local: THREE.Vector3): [number, number] => [
      this.x + local.x * cosH + local.z * sinH,
      this.z - local.x * sinH + local.z * cosH,
    ];

    const [flX, flZ] = worldOf(this.wheelFLPos);
    const [frX, frZ] = worldOf(this.wheelFRPos);
    const [rlX, rlZ] = worldOf(this.wheelRLPos);
    const [rrX, rrZ] = worldOf(this.wheelRRPos);

    const hFL = this.sampleSurfaceY(flX, flZ);
    const hFR = this.sampleSurfaceY(frX, frZ);
    const hRL = this.sampleSurfaceY(rlX, rlZ);
    const hRR = this.sampleSurfaceY(rrX, rrZ);

    const targetY = (hFL + hFR + hRL + hRR) * 0.25;
    const targetPitch = Math.atan2((hFL + hFR) * 0.5 - (hRL + hRR) * 0.5, this.wheelbase);
    const targetRoll = Math.atan2((hFL + hRL) * 0.5 - (hFR + hRR) * 0.5, this.trackWidth);

    this.y = THREE.MathUtils.lerp(this.y, targetY, smoothAlpha);
    this.pitchRad = THREE.MathUtils.lerp(this.pitchRad, THREE.MathUtils.clamp(targetPitch, -0.45, 0.45), smoothAlpha);
    this.rollRad = THREE.MathUtils.lerp(this.rollRad, THREE.MathUtils.clamp(targetRoll, -0.35, 0.35), smoothAlpha);

    this.tractorRoot.position.set(this.x, this.y, this.z);
    // Forward +Z tilted UP (+Y) when front higher => rotation.x = -pitchRad; Left +X tilted UP => rotation.z = +rollRad
    this.tractorRoot.rotation.set(-this.pitchRad, this.headingRad, this.rollRad);
  }

  private updateTrailerKinematics(forwardDeltaM: number, smoothAlpha: number): void {
    this.trailerRoot.visible = this.trailerAttached;
    if (!this.trailerAttached) return;

    this.tractorRoot.updateMatrixWorld(true);
    const hitchWorld = this.rearHitchOffset.clone().applyMatrix4(this.tractorRoot.matrixWorld);
    const hitchToAxle = Math.max(1.8, this.trailerHitchOffset.z - this.trailerAxleOffsetZ);

    const dx = hitchWorld.x - this.trailerAxleWorld.x;
    const dz = hitchWorld.z - this.trailerAxleWorld.z;
    const dist = Math.hypot(dx, dz);

    if (dist > 0.01) {
      let desiredYaw = Math.atan2(dx, dz);
      // Clamp jackknife angle relative to tractor heading to ±72°
      let rel = Math.atan2(Math.sin(desiredYaw - this.headingRad), Math.cos(desiredYaw - this.headingRad));
      rel = THREE.MathUtils.clamp(rel, -1.25, 1.25);
      desiredYaw = this.headingRad + rel;
      this.trailerYawRad = desiredYaw;
    }

    const fwdX = Math.sin(this.trailerYawRad);
    const fwdZ = Math.cos(this.trailerYawRad);

    // Lock trailer front hitch eye directly onto tractor rear hitch pin!
    this.trailerX = hitchWorld.x - fwdX * this.trailerHitchOffset.z;
    this.trailerZ = hitchWorld.z - fwdZ * this.trailerHitchOffset.z;
    this.trailerAxleWorld.set(
      this.trailerX + fwdX * this.trailerAxleOffsetZ,
      hitchWorld.y,
      this.trailerZ + fwdZ * this.trailerAxleOffsetZ
    );

    // Sample terrain under trailer left/right wheels & front hitch for smooth slope draping
    const leftX = Math.cos(this.trailerYawRad);
    const leftZ = -Math.sin(this.trailerYawRad);
    const axleL = this.sampleSurfaceY(this.trailerAxleWorld.x + leftX * 0.95, this.trailerAxleWorld.z + leftZ * 0.95);
    const axleR = this.sampleSurfaceY(this.trailerAxleWorld.x - leftX * 0.95, this.trailerAxleWorld.z - leftZ * 0.95);
    const axleAvg = (axleL + axleR) * 0.5;
    const hitchGround = hitchWorld.y - this.trailerHitchOffset.y;

    const targetPitch = Math.atan2(hitchGround - axleAvg, hitchToAxle);
    const targetRoll = Math.atan2(axleL - axleR, 1.9);
    const targetY = axleAvg + (hitchGround - axleAvg) * (-this.trailerAxleOffsetZ / hitchToAxle);

    this.trailerY = THREE.MathUtils.lerp(this.trailerY || targetY, targetY, smoothAlpha);
    this.trailerPitchRad = THREE.MathUtils.lerp(this.trailerPitchRad, THREE.MathUtils.clamp(targetPitch, -0.4, 0.4), smoothAlpha);
    this.trailerRollRad = THREE.MathUtils.lerp(this.trailerRollRad, THREE.MathUtils.clamp(targetRoll, -0.32, 0.32), smoothAlpha);

    this.trailerRoot.position.set(this.trailerX, this.trailerY, this.trailerZ);
    this.trailerRoot.rotation.set(-this.trailerPitchRad, this.trailerYawRad, this.trailerRollRad);

    // Spin trailer wheels
    this.trailerWheelSpinRad += forwardDeltaM / Math.max(0.25, this.trailerWheelRadius);
    for (const w of this.trailerWheels) {
      w.rotation.x = this.trailerWheelSpinRad;
    }
  }

  private updateParticles(dt: number, throttleLoad: number): void {
    // 1. Exhaust smoke from exhaustTipOffset
    const smokeRate = 0.22 - throttleLoad * 0.13;
    this.smokeTimer += dt;
    if (this.smokeTimer >= smokeRate) {
      this.smokeTimer = 0;
      const slot = this.smokePool.find((p) => !p.active);
      if (slot) {
        this.tractorRoot.updateMatrixWorld(true);
        const worldTip = this.exhaustTipOffset.clone().applyMatrix4(this.tractorRoot.matrixWorld);
        slot.active = true;
        slot.age = 0;
        slot.life = 0.9 + Math.random() * 0.55;
        slot.baseScale = 0.22 + throttleLoad * 0.16;
        slot.maxScale = 0.95 + throttleLoad * 0.65;
        slot.sprite.position.copy(worldTip);
        slot.vel.set((Math.random() - 0.5) * 0.4, 1.45 + throttleLoad * 1.1, (Math.random() - 0.5) * 0.4);
        slot.sprite.visible = true;
      }
    }

    // 2. Subtle tire dust when rolling fast (> 3.2 m/s)
    const absSpeed = Math.abs(this.speedMps);
    if (absSpeed > 3.2) {
      this.dustTimer += dt;
      if (this.dustTimer >= 0.09) {
        this.dustTimer = 0;
        const slot = this.dustPool.find((p) => !p.active);
        if (slot) {
          this.tractorRoot.updateMatrixWorld(true);
          const side = Math.random() > 0.5 ? this.wheelRLPos : this.wheelRRPos;
          const worldWheel = new THREE.Vector3(side.x, 0.22, side.z - 0.4).applyMatrix4(this.tractorRoot.matrixWorld);
          slot.active = true;
          slot.age = 0;
          slot.life = 0.65 + Math.random() * 0.35;
          slot.baseScale = 0.42;
          slot.maxScale = 1.55;
          slot.sprite.position.copy(worldWheel);
          slot.vel.set((Math.random() - 0.5) * 0.8, 0.65 + Math.random() * 0.45, (Math.random() - 0.5) * 0.8);
          slot.sprite.visible = true;
        }
      }
    }

    const advancePool = (pool: ParticleSlot[], maxOpacity: number) => {
      for (const p of pool) {
        if (!p.active) continue;
        p.age += dt;
        if (p.age >= p.life) {
          p.active = false;
          p.sprite.visible = false;
          continue;
        }
        const t = p.age / p.life;
        p.sprite.position.addScaledVector(p.vel, dt);
        const s = THREE.MathUtils.lerp(p.baseScale, p.maxScale, t);
        p.sprite.scale.set(s, s, 1);
        (p.sprite.material as THREE.SpriteMaterial).opacity = Math.sin(t * Math.PI) * maxOpacity;
      }
    };

    advancePool(this.smokePool, 0.24 + throttleLoad * 0.16);
    advancePool(this.dustPool, 0.22);
  }

  public step(dt: number, input: TractorInput, snapTerrain = false): void {
    const safeDt = Math.min(Math.max(dt, 0.0001), 0.06);

    // 1. Speed-dependent Ackermann steering (responsive at low speed, stable at 40 km/h)
    const speedFactor = THREE.MathUtils.clamp(Math.abs(this.speedMps) / 11.1, 0, 1);
    const maxSteer = THREE.MathUtils.lerp(0.56, 0.26, speedFactor * 0.85);
    const targetSteer = input.steer * maxSteer;
    const steerRate = Math.abs(input.steer) > 0.05 ? 4.4 : 5.8;
    this.steerAngleRad = THREE.MathUtils.lerp(this.steerAngleRad, targetSteer, Math.min(1, safeDt * steerRate));

    // 2. Longitudinal acceleration, engine braking, reverse & real hill-grade gravity torque!
    const maxForwardMps = 40 / 3.6; // 40 km/h (~11.11 m/s)
    const maxReverseMps = 15 / 3.6; // 15 km/h (~4.17 m/s)
    const gravityAccel = -9.81 * Math.sin(this.pitchRad) * 0.42;

    let accel = gravityAccel;
    let isBraking = false;

    if (input.handbrake) {
      isBraking = true;
      const brakeDecel = 13.5 * safeDt;
      if (Math.abs(this.speedMps) <= brakeDecel) {
        this.speedMps = 0;
      } else {
        this.speedMps -= Math.sign(this.speedMps) * brakeDecel;
      }
    } else if (input.throttle > 0.05) {
      if (this.speedMps < -0.35) {
        // Braking from reverse
        accel += 12.0;
        isBraking = true;
      } else {
        // Agricultural high-torque low-end pull, smooth top-speed governor at 40 km/h
        const torqueCurve = 1.0 - Math.pow(Math.max(0, this.speedMps) / maxForwardMps, 1.65);
        accel += 5.4 * Math.max(0.05, torqueCurve) * input.throttle;
      }
    } else if (input.throttle < -0.05) {
      if (this.speedMps > 0.35) {
        // Service braking from forward
        accel -= 11.5;
        isBraking = true;
      } else {
        const revCurve = 1.0 - Math.pow(Math.max(0, -this.speedMps) / maxReverseMps, 1.5);
        accel += 4.2 * Math.max(0.05, revCurve) * input.throttle;
      }
    } else {
      // Natural diesel engine braking + rolling drag
      const drag = Math.sign(this.speedMps) * (1.85 + Math.abs(this.speedMps) * 0.14);
      if (Math.abs(this.speedMps) < 0.18 && Math.abs(gravityAccel) < 0.6) {
        this.speedMps = 0;
        accel = 0;
      } else {
        accel -= drag;
      }
    }

    if (!input.handbrake) {
      this.speedMps = THREE.MathUtils.clamp(this.speedMps + accel * safeDt, -maxReverseMps, maxForwardMps);
    }

    // 3. Bicycle kinematics position & heading update
    const forwardDist = this.speedMps * safeDt;
    if (Math.abs(forwardDist) > 1e-6) {
      const yawRate = (this.speedMps / this.wheelbase) * Math.tan(this.steerAngleRad);
      this.headingRad += yawRate * safeDt;
      this.x += Math.sin(this.headingRad) * forwardDist;
      this.z += Math.cos(this.headingRad) * forwardDist;
    }

    // 4. 2-circle capsule building & world-border collision detection!
    const sinH = Math.sin(this.headingRad);
    const cosH = Math.cos(this.headingRad);
    const frontOffset = 1.25;
    const rearOffset = -1.1;
    const radius = 1.28;

    const hitF = this.collider.resolveCircle(this.x + sinH * frontOffset, this.z + cosH * frontOffset, radius);
    const hitR = this.collider.resolveCircle(this.x + sinH * rearOffset, this.z + cosH * rearOffset, radius);

    this.colliding = hitF.hit || hitR.hit;
    if (this.colliding) {
      const pushX = hitF.pushX + hitR.pushX;
      const pushZ = hitF.pushZ + hitR.pushZ;
      this.x += pushX;
      this.z += pushZ;

      const nX = hitF.normalX + hitR.normalX;
      const nZ = hitF.normalZ + hitR.normalZ;
      const nLen = Math.hypot(nX, nZ);
      if (nLen > 1e-4) {
        const unX = nX / nLen;
        const unZ = nZ / nLen;
        const vx = sinH * this.speedMps;
        const vz = cosH * this.speedMps;
        const vn = vx * unX + vz * unZ;
        if (vn < 0) {
          // Slide cleanly along wall tangent & dampen impact speed (gentle rebound feel)
          const tangentDot = Math.abs(sinH * -unZ + cosH * unX);
          this.speedMps *= Math.max(0.15, tangentDot * 0.72);
          if (Math.abs(this.speedMps) < 0.6) this.speedMps *= -0.15;
        }
      }
    }

    // 5. Conform 4 wheels onto terrain + update articulated trailer
    const smoothAlpha = snapTerrain ? 1.0 : Math.min(1, safeDt * 14);
    this.conformChassisToTerrain(smoothAlpha);
    this.updateTrailerKinematics(forwardDist, smoothAlpha);

    // 6. Animate spinning & steering wheels + interior steering wheel
    this.frontWheelSpinRad += forwardDist / Math.max(0.25, this.frontWheelRadius);
    this.rearWheelSpinRad += forwardDist / Math.max(0.35, this.rearWheelRadius);

    if (this.pivotFL) this.pivotFL.rotation.y = this.steerAngleRad;
    if (this.pivotFR) this.pivotFR.rotation.y = this.steerAngleRad;
    if (this.wheelFL) this.wheelFL.rotation.x = this.frontWheelSpinRad;
    if (this.wheelFR) this.wheelFR.rotation.x = this.frontWheelSpinRad;
    if (this.wheelRL) this.wheelRL.rotation.x = this.rearWheelSpinRad;
    if (this.wheelRR) this.wheelRR.rotation.x = this.rearWheelSpinRad;

    if (this.steeringWheel) {
      // Looking forward (+Z), counter-clockwise (turning LEFT, steerAngleRad > 0) is negative rotation around +Z!
      this.steeringWheel.rotation.set(
        this.steeringWheelBaseRot.x,
        this.steeringWheelBaseRot.y,
        this.steeringWheelBaseRot.z - this.steerAngleRad * 2.6
      );
    }

    // 7. Gearbox, RPM & pulsing amber Rundumleuchte beacon
    const kmh = Math.abs(this.speedMps) * 3.6;
    if (Math.abs(this.speedMps) < 0.25 && Math.abs(input.throttle) < 0.05) {
      this.gear = 'N';
      this.rpmNorm = THREE.MathUtils.lerp(this.rpmNorm, 0.05, safeDt * 5);
    } else if (this.speedMps < -0.15) {
      this.gear = 'R';
      this.rpmNorm = THREE.MathUtils.lerp(this.rpmNorm, THREE.MathUtils.clamp(kmh / 15, 0.15, 0.95), safeDt * 6);
    } else {
      let gNum = 1;
      let bandMin = 0;
      let bandMax = 10;
      if (kmh > 28) {
        gNum = 4;
        bandMin = 24;
        bandMax = 41;
      } else if (kmh > 17) {
        gNum = 3;
        bandMin = 14;
        bandMax = 29;
      } else if (kmh > 8.5) {
        gNum = 2;
        bandMin = 7;
        bandMax = 18;
      }
      this.gear = String(gNum);
      const gearRatio = THREE.MathUtils.clamp((kmh - bandMin) / (bandMax - bandMin), 0.12, 1.0);
      const loadBump = Math.abs(input.throttle) * 0.14;
      this.rpmNorm = THREE.MathUtils.lerp(this.rpmNorm, THREE.MathUtils.clamp(gearRatio + loadBump, 0.1, 1.0), safeDt * 7);
    }
    this.rpm = Math.round(850 + this.rpmNorm * 1550);

    // Beacon animation
    this.beaconPhase += safeDt * 9.5;
    if (this.beaconOn) {
      if (this.beaconNode) this.beaconNode.rotation.y = this.beaconPhase;
      const pulse = 0.55 + 0.45 * Math.sin(this.beaconPhase * 2.0);
      if (this.beaconLight) this.beaconLight.intensity = 10 + pulse * 16;
      if (this.beaconGlow) {
        (this.beaconGlow.material as THREE.SpriteMaterial).opacity = 0.55 + pulse * 0.45;
        const s = 0.72 + pulse * 0.35;
        this.beaconGlow.scale.set(s, s, 1);
      }
      for (const m of this.beaconMats) {
        m.emissive.setHex(0xff7d00);
        m.emissiveIntensity = 1.4 + pulse * 1.8;
      }
    } else {
      if (this.beaconLight) this.beaconLight.intensity = 0;
      if (this.beaconGlow) (this.beaconGlow.material as THREE.SpriteMaterial).opacity = 0;
      for (const m of this.beaconMats) {
        m.emissiveIntensity = 0.05;
      }
    }

    this.applyLightVisuals(isBraking);
    this.updateParticles(safeDt, Math.abs(input.throttle));
  }

  public getTelemetry(): TractorTelemetry {
    return {
      x: this.x,
      y: this.y,
      z: this.z,
      headingRad: this.headingRad,
      speedMps: this.speedMps,
      speedKmh: Math.abs(this.speedMps) * 3.6,
      steerAngleRad: this.steerAngleRad,
      frontWheelSpinRad: this.frontWheelSpinRad,
      rearWheelSpinRad: this.rearWheelSpinRad,
      gear: this.gear,
      rpm: this.rpm,
      rpmNorm: this.rpmNorm,
      lightsOn: this.lightsOn,
      beaconOn: this.beaconOn,
      trailerAttached: this.trailerAttached,
      trailerX: this.trailerX,
      trailerZ: this.trailerZ,
      trailerYawRad: this.trailerYawRad,
      colliding: this.colliding,
      usingBlenderModels: this.usingBlenderModels,
    };
  }
}
