import * as THREE from 'three';
import type { TerrainSystem } from './terrain';

export interface TourCheckpoint {
  id: number;
  name: string;
  subtitle: string;
  x: number;
  z: number;
  radiusM: number;
}

export interface TourStateSnapshot {
  activeIndex: number;
  total: number;
  completed: boolean;
  currentCheckpoint: TourCheckpoint | null;
  distanceToNextM: number;
  elapsedSec: number;
  drivenKm: number;
  justReachedName: string | null;
  justCompleted: boolean;
}

export const WEINLESE_CHECKPOINTS: TourCheckpoint[] = [
  {
    id: 1,
    name: 'Rathaus & Martinskirche',
    subtitle: 'Hauptstraße · Historische Ortsmitte',
    x: -27.6,
    z: -52.0,
    radiusM: 9.5,
  },
  {
    id: 2,
    name: 'Weingut Raspfambert',
    subtitle: 'Hauptstraße 44 · Pfälzer Hofreite',
    x: 77.0,
    z: -78.3,
    radiusM: 9.5,
  },
  {
    id: 3,
    name: 'Weinberge Nordhang',
    subtitle: 'Feldweg zwischen den Rebzeilen · über dem Burgweg',
    // On the field track between the vine rows (way/1459204107), not at the Burgweg junction below
    x: 320.0,
    z: -298.0,
    radiusM: 11.0,
  },
  {
    id: 4,
    name: 'Winzerhof Hauptstraße 107',
    subtitle: 'Westlicher Ortsrand · Fachwerk-Scheune',
    x: -429.1,
    z: 108.0,
    radiusM: 11.5,
  },
  {
    id: 5,
    name: 'Landwirtschaftliche Halle',
    subtitle: 'Raiffeisenstraße 16 · Maschinenhof',
    // In the yard in front of the hall's west gable with the open drive-in door (agri_halle colliders.json)
    x: 472.0,
    z: -6.4,
    radiusM: 12.0,
  },
  {
    id: 6,
    name: 'Ortsschild Kindenheim Ost',
    subtitle: 'L 450 · Ziel zwischen den Weinbergen',
    x: 564.5,
    z: -243.1,
    radiusM: 11.5,
  },
];

/** Height of the light column above the ground and of the label that floats on it. */
const BEAM_HEIGHT_M = 46;
const LABEL_HEIGHT_M = 9.5;
/**
 * Label height as a fraction of "one unit at distance 1" (sprite without size attenuation): with the 52°
 * chase camera this is ≈ 5 % of the viewport height, so the label reads the same at 10 m and at 600 m.
 */
const LABEL_SCREEN_HEIGHT = 0.05;
const LABEL_ASPECT = 560 / 120;

function createCheckpointLabelSprite(num: number, title: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 560;
  canvas.height = 120;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('[tour] 2D canvas context unavailable for the checkpoint label');

  // Dark pill with a hairline gold border: readable on bright sky and on dark roofs alike
  ctx.fillStyle = 'rgba(16, 22, 18, 0.88)';
  ctx.strokeStyle = 'rgba(244, 205, 110, 0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(5, 5, 550, 110, 55);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f2c14e';
  ctx.beginPath();
  ctx.arc(60, 60, 40, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#141a15';
  ctx.font = '800 46px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), 60, 63);

  // Title: shrink until it fits the pill
  ctx.fillStyle = '#f7f8f4';
  ctx.textAlign = 'left';
  let fontPx = 40;
  do {
    ctx.font = `700 ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    fontPx -= 2;
  } while (ctx.measureText(title).width > 412 && fontPx > 20);
  ctx.fillText(title, 116, 62);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // No size attenuation and no depth test: a waypoint label that stays legible from any distance and is
  // not swallowed by the house it stands behind.
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
    toneMapped: false,
    fog: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(LABEL_SCREEN_HEIGHT * LABEL_ASPECT, LABEL_SCREEN_HEIGHT, 1);
  sprite.renderOrder = 50;
  return sprite;
}

/**
 * Soft light column: additive, brightest along its axis, fading to nothing at the silhouette and towards
 * the top. Unlike a tinted glass cylinder it adds a little light and never recolours what stands inside.
 */
function createBeamMaterial(strength: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(1.0, 0.74, 0.28) },
      uStrength: { value: strength },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying float vHeight;
      varying vec3 vNormalView;
      varying vec3 vToEye;
      void main() {
        vHeight = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vToEye = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      uniform float uTime;
      varying float vHeight;
      varying vec3 vNormalView;
      varying vec3 vToEye;
      void main() {
        float facing = abs(dot(normalize(vNormalView), normalize(vToEye)));
        float core = pow(facing, 2.2);
        float rise = pow(1.0 - vHeight, 2.4) * smoothstep(0.0, 0.03, vHeight);
        float drift = 0.88 + 0.12 * sin(vHeight * 55.0 - uTime * 2.2);
        gl_FragColor = vec4(uColor * (core * rise * drift * uStrength), 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
}

/**
 * Soft ring draped on the terrain at the capture radius (vertex alpha: 0 at both rims, 1 in the middle).
 * Vertices are in world space relative to the checkpoint origin on the ground.
 */
function createGroundRingGeometry(
  terrain: TerrainSystem,
  cx: number,
  cz: number,
  baseY: number,
  radiusM: number,
  halfWidthM: number
): THREE.BufferGeometry {
  const segments = 72;
  const radii = [radiusM - halfWidthM, radiusM, radiusM + halfWidthM];
  const alphas = [0, 1, 0];
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    for (let r = 0; r < 3; r++) {
      const x = Math.cos(a) * radii[r];
      const z = Math.sin(a) * radii[r];
      positions.push(x, terrain.getTerrainHeight(cx + x, cz + z) - baseY + 0.16, z);
      colors.push(alphas[r], alphas[r], alphas[r]);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let r = 0; r < 2; r++) {
      const a = i * 3 + r;
      const b = (i + 1) * 3 + r;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}

export class WeinleseTourGame {
  public readonly group = new THREE.Group();
  public readonly arrowGroup = new THREE.Group();

  private readonly terrain: TerrainSystem;
  private readonly checkpoints = WEINLESE_CHECKPOINTS;
  private readonly checkpointNodes: {
    group: THREE.Group;
    ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    beams: THREE.ShaderMaterial[];
    sprite: THREE.Sprite;
  }[] = [];
  private arrowMaterial: THREE.MeshBasicMaterial | null = null;

  public activeIndex = 0;
  public completed = false;
  public elapsedSec = 0;
  public drivenMeters = 0;
  public arrowEnabled = true;

  private tourTimerStarted = false;
  private prevX: number | null = null;
  private prevZ: number | null = null;
  private animTime = 0;

  constructor(terrain: TerrainSystem) {
    this.terrain = terrain;
    this.group.name = 'WeinleseTourCheckpoints';
    this.arrowGroup.name = 'TractorGuideArrow';

    this.buildCheckpointMeshes();
    this.buildGuideArrow();
    this.syncCheckpointVisibility();
  }

  private buildCheckpointMeshes(): void {
    for (const cp of this.checkpoints) {
      const g = new THREE.Group();
      const gy = this.terrain.getTerrainHeight(cp.x, cp.z);
      g.position.set(cp.x, gy, cp.z);

      // Capture area: a soft ring lying on the ground at the radius that counts as "reached"
      const ring = new THREE.Mesh(
        createGroundRingGeometry(this.terrain, cp.x, cp.z, gy, cp.radiusM * 0.72, 0.85),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(1.0, 0.72, 0.24),
          vertexColors: true,
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
          toneMapped: false,
        })
      );
      ring.renderOrder = 4;
      g.add(ring);

      // Light column: a wide faint halo around a slim bright core, both fading out towards the top
      const haloMat = createBeamMaterial(0.2);
      const halo = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.3, BEAM_HEIGHT_M, 40, 1, true), haloMat);
      halo.position.y = BEAM_HEIGHT_M * 0.5;
      const coreMat = createBeamMaterial(0.62);
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.5, BEAM_HEIGHT_M, 24, 1, true), coreMat);
      core.position.y = BEAM_HEIGHT_M * 0.5;
      halo.renderOrder = 5;
      core.renderOrder = 6;
      g.add(halo, core);

      const sprite = createCheckpointLabelSprite(cp.id, cp.name);
      sprite.position.y = LABEL_HEIGHT_M;
      g.add(sprite);

      this.group.add(g);
      this.checkpointNodes.push({ group: g, ring, beams: [haloMat, coreMat], sprite });
    }
  }

  private buildGuideArrow(): void {
    // Flat double chevron ("»") pointing along +Z towards the next checkpoint. Unlit and slightly
    // translucent, so it reads as a quiet HUD hint over the cab instead of a lump of gold metal.
    const chevron = new THREE.Shape();
    const half = 0.46; // half width
    const len = 0.42; // tip length
    const thick = 0.17; // stroke thickness along the pointing axis
    chevron.moveTo(0, len);
    chevron.lineTo(half, 0);
    chevron.lineTo(half, -thick);
    chevron.lineTo(0, len - thick - 0.02);
    chevron.lineTo(-half, -thick);
    chevron.lineTo(-half, 0);
    chevron.closePath();

    const geo = new THREE.ShapeGeometry(chevron);
    // Shape XY → lie flat (XZ) with +Y of the shape pointing along +Z
    geo.rotateX(Math.PI / 2);

    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.0, 0.8, 0.36),
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.arrowMaterial = mat;

    const front = new THREE.Mesh(geo, mat);
    front.position.z = 0.3;
    const back = new THREE.Mesh(geo, mat);
    back.position.z = -0.14;
    back.scale.setScalar(0.82);
    // Tilted so the chevrons are seen as arrows from the chase camera behind and above the tractor
    const tilt = new THREE.Group();
    tilt.rotation.x = -0.5;
    tilt.add(front, back);
    this.arrowGroup.add(tilt);
    this.arrowGroup.renderOrder = 7;
  }

  private syncCheckpointVisibility(): void {
    this.checkpointNodes.forEach((node, idx) => {
      node.group.visible = !this.completed && idx === this.activeIndex;
    });
  }

  public getCheckpoints(): TourCheckpoint[] {
    return this.checkpoints;
  }

  public getActiveCheckpoint(): TourCheckpoint | null {
    if (this.completed) return null;
    return this.checkpoints[this.activeIndex] ?? null;
  }

  public restart(): void {
    this.activeIndex = 0;
    this.completed = false;
    this.elapsedSec = 0;
    this.tourTimerStarted = false;
    this.syncCheckpointVisibility();
  }

  public setArrowVisible(visible: boolean): void {
    this.arrowEnabled = visible;
    this.arrowGroup.visible = visible && !this.completed;
  }

  public update(dt: number, tractorPos: THREE.Vector3, tractorSpeedMps: number, showArrowInView: boolean): TourStateSnapshot {
    this.animTime += dt;

    if (this.prevX !== null && this.prevZ !== null) {
      const stepDist = Math.hypot(tractorPos.x - this.prevX, tractorPos.z - this.prevZ);
      if (stepDist < 15) {
        this.drivenMeters += stepDist;
      }
    }
    this.prevX = tractorPos.x;
    this.prevZ = tractorPos.z;

    if (!this.tourTimerStarted && Math.abs(tractorSpeedMps) > 0.4) {
      this.tourTimerStarted = true;
    }
    if (this.tourTimerStarted && !this.completed) {
      this.elapsedSec += dt;
    }

    let justReachedName: string | null = null;
    let justCompleted = false;
    let distanceToNextM = 0;

    const activeCp = this.getActiveCheckpoint();
    if (activeCp) {
      const dx = activeCp.x - tractorPos.x;
      const dz = activeCp.z - tractorPos.z;
      distanceToNextM = Math.hypot(dx, dz);

      // Animate the active checkpoint: slow breathing of the ring, drifting shimmer in the column
      const node = this.checkpointNodes[this.activeIndex];
      if (node) {
        const breathe = 0.5 + 0.5 * Math.sin(this.animTime * 2.1);
        node.ring.material.opacity = 0.34 + 0.22 * breathe;
        for (const beam of node.beams) beam.uniforms.uTime.value = this.animTime;
        node.sprite.position.y = LABEL_HEIGHT_M + Math.sin(this.animTime * 1.4) * 0.18;
      }

      // Guide chevrons above the cab roof, fading in beyond the checkpoint's own ring
      this.arrowGroup.visible = this.arrowEnabled && showArrowInView && distanceToNextM > 10;
      if (this.arrowGroup.visible) {
        this.arrowGroup.position.set(
          tractorPos.x,
          tractorPos.y + 4.1 + Math.sin(this.animTime * 2.6) * 0.07,
          tractorPos.z
        );
        this.arrowGroup.rotation.set(0, Math.atan2(dx, dz), 0);
        if (this.arrowMaterial) {
          const fadeIn = THREE.MathUtils.smoothstep(distanceToNextM, 10, 22);
          this.arrowMaterial.opacity = (0.74 + 0.16 * Math.sin(this.animTime * 2.6)) * fadeIn;
        }
      }

      // Check checkpoint capture!
      if (distanceToNextM <= activeCp.radiusM) {
        justReachedName = activeCp.name;
        this.activeIndex++;
        if (this.activeIndex >= this.checkpoints.length) {
          this.completed = true;
          justCompleted = true;
          this.arrowGroup.visible = false;
        }
        this.syncCheckpointVisibility();
      }
    } else {
      this.arrowGroup.visible = false;
    }

    return {
      activeIndex: this.activeIndex,
      total: this.checkpoints.length,
      completed: this.completed,
      currentCheckpoint: this.getActiveCheckpoint(),
      distanceToNextM,
      elapsedSec: this.elapsedSec,
      drivenKm: this.drivenMeters / 1000,
      justReachedName,
      justCompleted,
    };
  }
}
