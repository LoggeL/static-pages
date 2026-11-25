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
    subtitle: 'Burgweg · Steillage über Kindenheim',
    x: 250.4,
    z: -259.0,
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
    x: 499.9,
    z: 43.7,
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

function createCheckpointLabelSprite(num: number, title: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 440;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgba(14, 20, 16, 0.9)';
  ctx.strokeStyle = '#f2c14e';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(6, 6, 428, 84, 16);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f2c14e';
  ctx.beginPath();
  ctx.roundRect(14, 15, 58, 66, 12);
  ctx.fill();

  ctx.fillStyle = '#121814';
  ctx.font = '800 32px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), 43, 49);

  ctx.fillStyle = '#f7f8f4';
  ctx.font = '700 22px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(title, 84, 38);

  ctx.fillStyle = '#f2c14e';
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.fillText('PFÄLZER WEINLESE-TOUR', 84, 65);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(6.4, 1.4, 1);
  return sprite;
}

export class WeinleseTourGame {
  public readonly group = new THREE.Group();
  public readonly arrowGroup = new THREE.Group();

  private readonly terrain: TerrainSystem;
  private readonly checkpoints = WEINLESE_CHECKPOINTS;
  private readonly checkpointNodes: {
    group: THREE.Group;
    ring: THREE.Mesh;
    beam: THREE.Mesh;
    sprite: THREE.Sprite;
  }[] = [];

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
    const torusMat = new THREE.MeshStandardMaterial({
      color: 0xffca48,
      emissive: 0xffa81c,
      emissiveIntensity: 1.4,
      roughness: 0.25,
      metalness: 0.55,
      transparent: true,
      opacity: 0.92,
    });

    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffd25c,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    for (const cp of this.checkpoints) {
      const g = new THREE.Group();
      const gy = this.terrain.getTerrainHeight(cp.x, cp.z);
      g.position.set(cp.x, gy, cp.z);

      const ringGeo = new THREE.TorusGeometry(Math.min(6.2, cp.radiusM * 0.62), 0.24, 12, 40);
      ringGeo.rotateX(Math.PI / 2);
      const ring = new THREE.Mesh(ringGeo, torusMat.clone());
      ring.position.y = 0.55;
      g.add(ring);

      const beamGeo = new THREE.CylinderGeometry(Math.min(5.2, cp.radiusM * 0.52), Math.min(5.6, cp.radiusM * 0.56), 5.8, 28, 1, true);
      const beam = new THREE.Mesh(beamGeo, beamMat.clone());
      beam.position.y = 3.0;
      g.add(beam);

      const sprite = createCheckpointLabelSprite(cp.id, cp.name);
      sprite.position.y = 6.6;
      g.add(sprite);

      this.group.add(g);
      this.checkpointNodes.push({ group: g, ring, beam, sprite });
    }
  }

  private buildGuideArrow(): void {
    // Sleek floating golden 3D chevron arrow pointing along +Z toward next checkpoint
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffcf52,
      emissive: 0xe69818,
      emissiveIntensity: 0.85,
      roughness: 0.3,
      metalness: 0.45,
    });

    const headGeo = new THREE.ConeGeometry(0.42, 0.92, 4);
    headGeo.rotateX(Math.PI / 2);
    const head = new THREE.Mesh(headGeo, mat);
    head.position.z = 0.48;

    const shaftGeo = new THREE.BoxGeometry(0.24, 0.16, 0.72);
    const shaft = new THREE.Mesh(shaftGeo, mat);
    shaft.position.z = -0.22;

    this.arrowGroup.add(head, shaft);
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

      // Animate active checkpoint glow & hover
      const node = this.checkpointNodes[this.activeIndex];
      if (node) {
        node.ring.position.y = 0.55 + Math.sin(this.animTime * 2.8) * 0.22;
        node.ring.rotation.z = this.animTime * 0.9;
        const beamMat = node.beam.material as THREE.MeshBasicMaterial;
        beamMat.opacity = 0.16 + Math.sin(this.animTime * 3.2) * 0.06;
        node.sprite.position.y = 6.6 + Math.sin(this.animTime * 2.0) * 0.24;
      }

      // Position & orient subtle floating guide arrow above tractor roof
      this.arrowGroup.visible = this.arrowEnabled && showArrowInView && distanceToNextM > 10;
      if (this.arrowGroup.visible) {
        this.arrowGroup.position.set(
          tractorPos.x,
          tractorPos.y + 4.35 + Math.sin(this.animTime * 3.6) * 0.14,
          tractorPos.z
        );
        this.arrowGroup.rotation.set(0, Math.atan2(dx, dz), 0);
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
