import * as THREE from 'three';
import type { TerrainSystem } from './terrain';
import type { BenchmarkLayout, BraveReferenceEntry, CameraBookmark } from './types';
import { resolveAssetUrl } from './url';

export interface ReferencePoseOverride {
  dx?: number;
  dy?: number;
  dz?: number;
  dHeadingDeg?: number;
  dPitchDeg?: number;
  fovDeg?: number;
}

/**
 * Per-shot camera alignment calibration overrides (leaves data/references/brave/manifest.json untouched!).
 * Round 2 precision calibration dialed directly from iter1 15-shot Sobel Edge_Corr & visual diff strips.
 */
export const REF_POSE_OVERRIDES: Record<string, ReferencePoseOverride> = {
  // Aerial satellite shots (locked to Google Maps zoom spans & 72px left sidebar)
  aerial_overview_village: { dx: -15, dy: 25 },
  aerial_center_church_roofs: { dx: -36, dz: 35, dy: 145 },
  aerial_north_vineyards: { dx: 35, dz: 10, dy: -15 },

  // Street View shots (Round 2 sub-degree pose calibration from iter1 diff strips!)
  sv_kirche_full_west: { dx: -5.2, dz: 2.6, dHeadingDeg: 3.0, dPitchDeg: -1.5, fovDeg: 78 },
  sv_kirche_front_detail: { dHeadingDeg: -1.0, dPitchDeg: -2.0 },
  sv_kirche_east_angle: { dHeadingDeg: -6.0, dPitchDeg: -0.5 },
  sv_rathaus_ortsmitte: { dx: 0.4, dz: -0.6, dHeadingDeg: 2.5, dPitchDeg: 1.5, fovDeg: 72 },
  sv_hauptstrasse_west_weingueter: { dHeadingDeg: 0.5, dPitchDeg: -0.6 },
  sv_hauptstrasse_center_east: { dHeadingDeg: 0.0, dPitchDeg: -0.4 },
  sv_weingut_kreutzenberger: { dHeadingDeg: -2.2, dPitchDeg: 0.2 },
  sv_side_street_neugasse: { dHeadingDeg: 2.5, dPitchDeg: 0.5 },
  sv_side_street_burgweg: { dHeadingDeg: 4.5, dPitchDeg: -1.0 },
  sv_vineyard_edge_east: { dHeadingDeg: 0.4, dPitchDeg: 0.0 },
  sv_vineyard_edge_west: { dHeadingDeg: -1.4, dPitchDeg: 0.0 },
  sv_vineyard_hills_west: { dHeadingDeg: -2.2, dPitchDeg: 0.8, fovDeg: 66 },
};

export interface ResolvedReferenceShot {
  ref: BraveReferenceEntry;
  worldX: number;
  worldY: number;
  worldZ: number;
  bookmark: CameraBookmark;
}

export class BenchmarkOverlay {
  public readonly group: THREE.Group;
  private readonly markersGroup: THREE.Group;
  private readonly terrain: TerrainSystem;
  private readonly rawReferences: BraveReferenceEntry[];
  private readonly shots: ResolvedReferenceShot[] = [];
  private readonly mapCanvas: HTMLCanvasElement | null;
  private readonly mapCtx: CanvasRenderingContext2D | null;
  private orthoImg: HTMLImageElement | null = null;

  public active = false;
  public layout: BenchmarkLayout = 'pip';
  public selectedIndex = 0;
  private pinsUserEnabled = true;

  constructor(
    terrain: TerrainSystem,
    references: BraveReferenceEntry[],
    mapCanvas: HTMLCanvasElement | null
  ) {
    this.terrain = terrain;
    this.rawReferences = references;
    this.mapCanvas = mapCanvas;
    this.mapCtx = mapCanvas ? mapCanvas.getContext('2d') : null;

    this.group = new THREE.Group();
    this.group.name = 'BenchmarkOverlay';
    this.group.visible = false;

    this.markersGroup = new THREE.Group();
    this.markersGroup.name = 'ReferenceCameraPins';
    this.group.add(this.markersGroup);

    this.rebuildShots();
    this.build3DCameraPins();
    this.loadMapBackground();
  }

  public getShots(): ResolvedReferenceShot[] {
    return this.shots;
  }

  public getSelectedShot(): ResolvedReferenceShot | null {
    return this.shots[this.selectedIndex] ?? null;
  }

  public setPoseOverride(refId: string, override: ReferencePoseOverride): ResolvedReferenceShot | null {
    REF_POSE_OVERRIDES[refId] = { ...(REF_POSE_OVERRIDES[refId] ?? {}), ...override };
    this.rebuildShots();
    return this.shots.find((s) => s.ref.id === refId) ?? null;
  }

  private latLonToWorldXZ(lat: number, lon: number): [number, number] {
    const [x, z] = this.terrain.latLonToWorldXZ(lat, lon);
    return [
      THREE.MathUtils.clamp(x, -this.terrain.halfSizeM + 10, this.terrain.halfSizeM - 10),
      THREE.MathUtils.clamp(z, -this.terrain.halfSizeM + 10, this.terrain.halfSizeM - 10),
    ];
  }

  private rebuildShots(): void {
    this.shots.length = 0;
    for (let i = 0; i < this.rawReferences.length; i++) {
      const ref = this.rawReferences[i];
      const ov = REF_POSE_OVERRIDES[ref.id] ?? {};
      const [baseX, baseZ] =
        typeof ref.localX === 'number' && typeof ref.localZ === 'number'
          ? [ref.localX, ref.localZ]
          : this.latLonToWorldXZ(ref.lat, ref.lon);

      const wx = THREE.MathUtils.clamp(baseX + (ov.dx ?? 0), -this.terrain.halfSizeM + 10, this.terrain.halfSizeM - 10);
      const wz = THREE.MathUtils.clamp(baseZ + (ov.dz ?? 0), -this.terrain.halfSizeM + 10, this.terrain.halfSizeM - 10);
      const groundY = this.terrain.getTerrainHeight(wx, wz);
      const camH = (Number.isFinite(ref.cameraHeightM) ? Math.max(1.6, ref.cameraHeightM) : 2.5) + (ov.dy ?? 0);
      const wy = groundY + camH;

      const isAerial =
        camH > 22 ||
        ref.source.toLowerCase().includes('maps') ||
        ref.source.toLowerCase().includes('satellite');

      const headingDeg = (ref.headingDeg || 0) + (ov.dHeadingDeg ?? 0);
      const pitchDeg = (ref.pitchDeg ?? -3) + (ov.dPitchDeg ?? 0);

      const hRad = THREE.MathUtils.degToRad(headingDeg);
      // Use -89.85° for nadir satellite views so ground center doesn't drift 28m North while avoiding OrbitControls gimbal lock
      const pRad = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(pitchDeg, -89.85, 45));
      const cosP = Math.cos(pRad);
      const dirX = Math.sin(hRad) * cosP;
      const dirY = Math.sin(pRad);
      const dirZ = -Math.cos(hRad) * cosP;

      const targetDist = isAerial ? Math.max(80, camH * 0.95) : 34;

      const tx = wx + dirX * targetDist;
      const ty = wy + dirY * targetDist;
      const tz = wz + dirZ * targetDist;

      let verticalFov = isAerial ? 48 : 72;
      if (typeof ov.fovDeg === 'number' && ov.fovDeg > 20) {
        verticalFov = THREE.MathUtils.clamp(ov.fovDeg, 30, 82);
      } else if (typeof ref.fovDeg === 'number' && ref.fovDeg > 20) {
        if (!isAerial) {
          verticalFov = THREE.MathUtils.clamp(ref.fovDeg * 0.84, 58, 78);
        } else {
          verticalFov = THREE.MathUtils.clamp(ref.fovDeg, 36, 68);
        }
      }

      this.shots.push({
        ref,
        worldX: wx,
        worldY: wy,
        worldZ: wz,
        bookmark: {
          id: `ref_${ref.id}`,
          label: ref.title,
          position: [wx, wy, wz],
          target: [tx, ty, tz],
          fovDeg: verticalFov,
          refId: ref.id,
        },
      });
    }
  }

  private createPinSprite(indexNum: number, title: string, isAerial: boolean): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 80;
    const ctx = canvas.getContext('2d')!;

    const accent = isAerial ? '#6de3ff' : '#e7b95a';
    ctx.fillStyle = 'rgba(14, 20, 17, 0.88)';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.roundRect(6, 6, 244, 68, 16);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(14, 14, 46, 52, 10);
    ctx.fill();

    ctx.fillStyle = '#111814';
    ctx.font = '800 24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`R${indexNum}`, 37, 41);

    ctx.fillStyle = '#f3f5f1';
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.textAlign = 'left';
    const shortTitle = title.length > 17 ? title.slice(0, 16) + '…' : title;
    ctx.fillText(shortTitle, 70, 32);

    ctx.fillStyle = '#a9b5ae';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillText(isAerial ? 'Luftbild-Ref' : 'Street View', 70, 54);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false })
    );
    sprite.scale.set(12, 3.8, 1);
    return sprite;
  }

  private build3DCameraPins(): void {
    const poleGeo = new THREE.CylinderGeometry(0.14, 0.14, 5, 8);
    const poleMat = new THREE.MeshBasicMaterial({ color: 0xe7b95a, transparent: true, opacity: 0.78 });

    this.shots.forEach((shot, i) => {
      const groundY = this.terrain.getTerrainHeight(shot.worldX, shot.worldZ);
      const isAerial = shot.ref.cameraHeightM > 22;

      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(shot.worldX, groundY + 2.5, shot.worldZ);
      this.markersGroup.add(pole);

      const sprite = this.createPinSprite(i + 1, shot.ref.title, isAerial);
      sprite.position.set(shot.worldX, groundY + 7.2, shot.worldZ);
      this.markersGroup.add(sprite);
    });
  }

  private loadMapBackground(): void {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.orthoImg = img;
      if (this.active) this.renderMinimap(0, 0, 0);
    };
    img.src = resolveAssetUrl('data/terrain/orthophoto.jpg');
  }

  public setActive(enabled: boolean): void {
    this.active = enabled;
    this.group.visible = enabled;
  }

  public setPinsVisible(visible: boolean): void {
    this.pinsUserEnabled = visible;
    this.markersGroup.visible = visible;
  }

  public updateVisibilityForCamera(camPos: THREE.Vector3): void {
    if (!this.active) {
      this.markersGroup.visible = false;
      return;
    }
    const groundY = this.terrain.getTerrainHeight(camPos.x, camPos.z);
    const heightAboveGround = camPos.y - groundY;
    const allowInLayout = this.layout === 'pip';
    this.markersGroup.visible = this.pinsUserEnabled && allowInLayout && heightAboveGround >= 45;
  }

  public selectShot(index: number): ResolvedReferenceShot | null {
    if (this.shots.length === 0) return null;
    this.selectedIndex = THREE.MathUtils.clamp(index, 0, this.shots.length - 1);
    return this.shots[this.selectedIndex];
  }

  public renderMinimap(camX: number, camZ: number, lookYawRad: number): void {
    if (!this.mapCanvas || !this.mapCtx) return;
    const ctx = this.mapCtx;
    const w = this.mapCanvas.width;
    const h = this.mapCanvas.height;

    const viewSpanM = Math.min(this.terrain.mapSizeM, 1100);
    const halfView = viewSpanM * 0.5;
    const toPx = (x: number, z: number): [number, number] => [
      ((x + halfView) / viewSpanM) * w,
      ((z + halfView) / viewSpanM) * h,
    ];

    ctx.clearRect(0, 0, w, h);

    if (this.orthoImg) {
      const fullSpan = this.terrain.mapSizeM;
      const frac = viewSpanM / fullSpan;
      const srcSize = this.orthoImg.width * frac;
      const srcOff = (this.orthoImg.width - srcSize) * 0.5;
      ctx.drawImage(this.orthoImg, srcOff, srcOff, srcSize, srcSize, 0, 0, w, h);
      ctx.fillStyle = 'rgba(10, 16, 13, 0.22)';
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = '#18221c';
      ctx.fillRect(0, 0, w, h);
    }

    this.shots.forEach((shot, i) => {
      const [px, py] = toPx(shot.worldX, shot.worldZ);
      const isSelected = i === this.selectedIndex;
      const hRad = THREE.MathUtils.degToRad(shot.ref.headingDeg || 0);

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(hRad);
      ctx.fillStyle = isSelected ? 'rgba(231, 185, 90, 0.42)' : 'rgba(109, 227, 255, 0.22)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-10, -22);
      ctx.lineTo(10, -22);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = isSelected ? '#e7b95a' : '#16201a';
      ctx.strokeStyle = isSelected ? '#ffffff' : '#6de3ff';
      ctx.lineWidth = isSelected ? 2 : 1.5;
      ctx.beginPath();
      ctx.arc(px, py, isSelected ? 9 : 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isSelected ? '#111814' : '#ffffff';
      ctx.font = '800 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), px, py + 0.5);
    });

    const [cx, cy] = toPx(camX, camZ);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(lookYawRad);
    ctx.fillStyle = 'rgba(82, 201, 128, 0.34)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-11, -24);
    ctx.lineTo(11, -24);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#52c980';
    ctx.strokeStyle = '#0e1511';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  public minimapClickToWorld(clientX: number, clientY: number): [number, number] | null {
    if (!this.mapCanvas) return null;
    const rect = this.mapCanvas.getBoundingClientRect();
    const nx = THREE.MathUtils.clamp((clientX - rect.left) / rect.width, 0, 1);
    const ny = THREE.MathUtils.clamp((clientY - rect.top) / rect.height, 0, 1);
    const viewSpanM = Math.min(this.terrain.mapSizeM, 1100);
    const halfView = viewSpanM * 0.5;
    return [nx * viewSpanM - halfView, ny * viewSpanM - halfView];
  }
}
