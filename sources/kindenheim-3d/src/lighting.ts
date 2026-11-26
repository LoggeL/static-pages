import * as THREE from 'three';
import type { RenderPipeline } from './postfx';
import { CascadedSunShadows } from './renderShadows';
import { atmosphereTransmittance, EDGE_BINS, OBSERVER_ALT_KM, SkyAtmosphere, type SkyAtmosphereState } from './skyAtmosphere';
import type { TimeOfDayPreset } from './types';

/**
 * Sun, sky, image-based lighting and the per-time-of-day "camera" (exposure + grade).
 *
 * Everything is derived from one physical model: the sky LUT, the directional sun colour (solar irradiance
 * after atmospheric extinction), the cloud lighting, the PMREM environment and the aerial perspective all
 * use the same sun direction and haze amount. An exposure-normalisation factor (a virtual camera's
 * auto-exposure) keeps scene-referred values in a stable range so that `toneMappingExposure` stays ≈ 1 and
 * emissive materials authored by other modules read the same at every time of day.
 */

interface LightingPresetConfig {
  elevationDeg: number;
  azimuthDeg: number;
  /** Mie (haze) scattering per km at ground level. */
  miePerKm: number;
  /** Extra low-lying ground mist (extinction per km) and its scale height. */
  mistPerKm: number;
  mistHeightM: number;
  cloudCoverage: number;
  cloudDensity: number;
  cirrus: number;
  /** Film look. */
  contrast: number;
  saturation: number;
  whiteBalance: [number, number, number];
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  exposure: number;
  bloom: number;
}

/**
 * The look every preset converges to once the sun is below the horizon (also when the sun slider is dragged
 * down from "noon"). A camera whose white balance has partly adapted to the blue sky light: the ground is a
 * dull blue-grey of about the same hue as the walls, and only lamps and windows are warm.
 */
/** AgX-space toe lift at full twilight (≈ +7 sRGB levels on pure black, less on mid tones). */
const TWILIGHT_BLACK_LIFT = 0.06;

const TWILIGHT_GRADE = {
  contrast: 1.12,
  saturation: 0.94,
  whiteBalance: [1.03, 1.0, 0.95] as [number, number, number],
  shadowTint: [1.0, 1.0, 1.0] as [number, number, number],
  highlightTint: [1.02, 1.0, 0.98] as [number, number, number],
  bloom: 0.09,
};

const PRESETS: Record<TimeOfDayPreset, LightingPresetConfig> = {
  morning: {
    elevationDeg: 19,
    azimuthDeg: 104,
    miePerKm: 0.085,
    mistPerKm: 0.13,
    mistHeightM: 45,
    cloudCoverage: 0.25,
    cloudDensity: 0.9,
    cirrus: 0.45,
    contrast: 1.12,
    saturation: 1.14,
    whiteBalance: [0.985, 1.0, 1.035],
    shadowTint: [0.985, 1.0, 1.02],
    highlightTint: [1.01, 1.0, 0.985],
    exposure: 1.0,
    bloom: 0.05,
  },
  noon: {
    // High summer sun, clear continental air (≈ 60 km visibility), fair-weather cumulus.
    elevationDeg: 54,
    azimuthDeg: 162,
    miePerKm: 0.05,
    mistPerKm: 0,
    mistHeightM: 60,
    cloudCoverage: 0.29,
    cloudDensity: 1.0,
    cirrus: 0.3,
    contrast: 1.16,
    saturation: 1.18,
    whiteBalance: [1.0, 1.0, 1.0],
    shadowTint: [1.0, 1.0, 1.0],
    highlightTint: [1.0, 1.0, 1.0],
    exposure: 1.0,
    bloom: 0.04,
  },
  golden: {
    // Golden hour proper: a low sun whose warmth is kept by the (daylight) white balance.
    elevationDeg: 8,
    azimuthDeg: 248,
    miePerKm: 0.062,
    mistPerKm: 0.04,
    mistHeightM: 80,
    cloudCoverage: 0.3,
    cloudDensity: 0.95,
    cirrus: 0.5,
    contrast: 1.16,
    saturation: 1.16,
    whiteBalance: [0.975, 1.0, 1.05],
    shadowTint: [0.98, 1.0, 1.03],
    highlightTint: [1.015, 1.0, 0.98],
    exposure: 1.0,
    bloom: 0.065,
  },
  dusk: {
    // Blue hour: the sun is 3° below the horizon, the scene is lit by the twilight sky only.
    elevationDeg: -3,
    azimuthDeg: 262,
    miePerKm: 0.07,
    mistPerKm: 0.08,
    mistHeightM: 60,
    cloudCoverage: 0.3,
    cloudDensity: 0.9,
    cirrus: 0.7,
    contrast: TWILIGHT_GRADE.contrast,
    saturation: TWILIGHT_GRADE.saturation,
    whiteBalance: TWILIGHT_GRADE.whiteBalance,
    shadowTint: TWILIGHT_GRADE.shadowTint,
    highlightTint: TWILIGHT_GRADE.highlightTint,
    exposure: 1.0,
    bloom: TWILIGHT_GRADE.bloom,
  },
};

export const SUN_ELEVATION_MIN_DEG = -6;
export const SUN_ELEVATION_MAX_DEG = 78;

/** Solar spectrum at the top of the atmosphere in linear sRGB (slightly warm against D65). */
const SOLAR_COLOR = new THREE.Vector3(1.0, 0.975, 0.945);

/**
 * Virtual-camera exposure as a function of sun elevation: multiplies the solar irradiance so that sunlit
 * surfaces keep roughly the same scene-referred brightness from noon to sunset. Below the horizon the camera
 * deliberately stops following: the sky model loses about a factor of ten per 3.7° while this table only
 * gives back a part of it, so the scene really gets dark and fixed-brightness artificial light (lamps,
 * windows, headlights) takes over.
 */
const EXPOSURE_NORMALISATION: [number, number][] = [
  [-6, 330],
  [-4.5, 200],
  [-3, 105],
  [-1.5, 80],
  [0, 62],
  [2, 38],
  [4, 25],
  [6, 18.5],
  [9, 14],
  [13, 11.2],
  [20, 9.2],
  [30, 8.1],
  [45, 7.5],
  [90, 7.2],
];

function exposureNormalisation(elevationDeg: number): number {
  const t = EXPOSURE_NORMALISATION;
  if (elevationDeg <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (elevationDeg <= t[i][0]) {
      const f = (elevationDeg - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
      // interpolate in log space (stops)
      return Math.exp(THREE.MathUtils.lerp(Math.log(t[i - 1][1]), Math.log(t[i][1]), f));
    }
  }
  return t[t.length - 1][1];
}

/** 0 in daylight → 1 at the dusk preset (sun 3° below the horizon). Street lamps come on around sunset. */
export function computeNightFactor(elevationDeg: number): number {
  return 1 - THREE.MathUtils.smoothstep(elevationDeg, -3, 6.5);
}

const lerp3 = (a: [number, number, number], b: [number, number, number], t: number, out: THREE.Vector3): THREE.Vector3 =>
  out.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);

const TMP = new THREE.Vector3();

/** Name of the low-resolution outer terrain ring built by the terrain module (optional). */
const FAR_TERRAIN_NAME = 'KindenheimTerrainFar';
const TERRAIN_NAME = 'KindenheimTerrain';
/** Layer on which the ground-colour probe sees only the terrain it measures. */
const PROBE_LAYER = 30;
const PROBE_SIZE = 32;

function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) return sign * Math.pow(2, -14) * (mant / 1024);
  if (exp === 31) return mant ? Number.NaN : sign * Infinity;
  return sign * Math.pow(2, exp - 15) * (1 + mant / 1024);
}

export class LightingSystem {
  public readonly sky: SkyAtmosphere;
  public readonly shadows: CascadedSunShadows;
  public readonly skyMesh: THREE.Mesh;
  public readonly skyMat: THREE.ShaderMaterial;
  public readonly sunLight: THREE.DirectionalLight;

  public currentPreset: TimeOfDayPreset = 'golden';
  public elevationDeg = PRESETS.golden.elevationDeg;
  public azimuthDeg = PRESETS.golden.azimuthDeg;
  /** 0 = daylight … 1 = blue hour. Part of the time-of-day contract (see .gfx/BRIEF.md). */
  public nightFactor = 0;

  private readonly scene: THREE.Scene;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly pmrem: THREE.PMREMGenerator;
  private pipeline: RenderPipeline | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envDirty = true;
  private envAge = 1e9;
  private readonly sunDir = new THREE.Vector3();
  private readonly lightDir = new THREE.Vector3();
  private readonly skyState: SkyAtmosphereState;
  private cloudsFrozen = false;
  private shadowsEnabled = true;

  // ground-colour probe (see attachGround)
  private probeObject: THREE.Object3D | null = null;
  private probeTarget: THREE.WebGLRenderTarget | null = null;
  private readonly probeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  private probeDirty = false;
  private readonly probeResult = new THREE.Vector3();

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, shadowMapSizes: number[]) {
    this.scene = scene;
    this.renderer = renderer;
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.sky = new SkyAtmosphere(renderer);
    this.skyMesh = this.sky.mesh;
    this.skyMat = this.sky.material;
    scene.add(this.skyMesh);

    // Lighting is fully image based + sun: no scene fog (aerial perspective is a post pass), no hemisphere fill.
    scene.fog = null;
    scene.background = null;
    scene.environmentIntensity = 1.0;

    this.shadows = new CascadedSunShadows(scene, shadowMapSizes);
    this.sunLight = this.shadows.sunLight;
    // the sun also lights the ground-colour probe
    for (const light of this.shadows.lights) light.layers.enable(PROBE_LAYER);

    this.skyState = {
      sunDir: this.sunDir,
      sunIrradiance: new THREE.Vector3(1, 1, 1),
      miePerKm: 0.05,
      mieG: 0.78,
      ozone: 1.0,
      multiScatter: 0.6,
      groundAlbedo: new THREE.Vector3(0.2, 0.2, 0.12),
      cloudCoverage: 0.5,
      cloudDensity: 1,
      cirrus: 0.3,
    };

    this.applyPreset('golden');
  }

  /** The post pipeline receives haze + grade settings; attach it once it exists. */
  public attachPipeline(pipeline: RenderPipeline): void {
    this.pipeline = pipeline;
    this.applyState();
  }

  /**
   * Call once the terrain is in the scene. The world beyond the modelled terrain is drawn by the sky dome as
   * an endless hazy plain; its colour is MEASURED from the outermost real ground (the far terrain ring if
   * the terrain module built one, else the terrain itself) under the current light, so it matches at every
   * time of day. The outer edge of that ground is dissolved into the plain by the post pipeline.
   */
  public attachGround(): void {
    const far = this.scene.getObjectByName(FAR_TERRAIN_NAME) ?? null;
    const near = this.scene.getObjectByName(TERRAIN_NAME) ?? null;
    const target = far ?? near;
    if (!target) {
      throw new Error(
        `[Lighting] attachGround: neither "${FAR_TERRAIN_NAME}" nor "${TERRAIN_NAME}" exists in the scene - ` +
          'the terrain must be added before the lighting can match the horizon to it.'
      );
    }
    target.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) throw new Error(`[Lighting] attachGround: "${target.name}" has no geometry to measure.`);
    const halfX = Math.min(Math.abs(box.min.x), Math.abs(box.max.x));
    const halfZ = Math.min(Math.abs(box.min.z), Math.abs(box.max.z));
    const half = Math.min(halfX, halfZ);
    if (!(half > 100)) {
      throw new Error(`[Lighting] attachGround: "${target.name}" is not centred on the map (half extent ${half} m).`);
    }
    target.traverse((o) => o.layers.enable(PROBE_LAYER));
    this.probeObject = target;
    this.probeCamera.left = -half;
    this.probeCamera.right = half;
    this.probeCamera.top = half;
    this.probeCamera.bottom = -half;
    this.probeCamera.near = 1;
    this.probeCamera.far = box.max.y - box.min.y + 400;
    this.probeCamera.position.set(0, box.max.y + 200, 0);
    this.probeCamera.up.set(0, 0, -1);
    this.probeCamera.lookAt(0, box.min.y, 0);
    this.probeCamera.updateProjectionMatrix();
    this.probeCamera.updateMatrixWorld(true);
    this.probeCamera.layers.set(PROBE_LAYER);
    this.probeTarget = new THREE.WebGLRenderTarget(PROBE_SIZE, PROBE_SIZE, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    // The last stretch of real ground fades into the plain: no ruler-straight edge at any haze level. The far
    // ring is round (terrain.ts relaxes it into a circle), the map itself is square.
    this.sky.setWorldEdge(half * (far ? 0.8 : 0.86), half * 0.985, far !== null);
    // The land beyond continues from the height of the outermost ground in every direction.
    const edge = LightingSystem.outerEdgeHeights(target, far !== null);
    if (far) {
      const photo = far.userData.outerPhoto as THREE.Texture | undefined;
      const side = far.userData.outerPhotoSideM as number | undefined;
      if (!photo || !(side && side > 0)) {
        throw new Error(`[Lighting] attachGround: "${FAR_TERRAIN_NAME}" carries no outerPhoto / outerPhotoSideM (terrain.ts buildFarRing).`);
      }
      this.sky.setOuterGround(photo, side, edge.radius, edge.heights);
    } else {
      this.sky.setOuterGround(null, 0, edge.radius, edge.heights);
    }
    console.info(
      `[Lighting] horizon matched to "${target.name}" (half extent ${Math.round(half)} m)` +
        (far ? '' : ' - no far terrain ring found, fading the map edge itself')
    );
    this.probeDirty = true;
  }

  /**
   * Height (world Y) of the outermost ground ring of `target` in EDGE_BINS azimuth bins, and its radius. For the
   * round far ring this is its last vertex loop; for the square map, the vertices on its border.
   */
  private static outerEdgeHeights(target: THREE.Object3D, round: boolean): { radius: number; heights: number[] } {
    const pts: THREE.Vector3[] = [];
    let maxR = 0;
    const v = new THREE.Vector3();
    target.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const pos = mesh.isMesh ? (mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined) : undefined;
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        const r = round ? Math.hypot(v.x, v.z) : Math.max(Math.abs(v.x), Math.abs(v.z));
        if (r > maxR * 0.97) pts.push(v.clone());
        maxR = Math.max(maxR, r);
      }
    });
    const sum = new Array<number>(EDGE_BINS).fill(0);
    const cnt = new Array<number>(EDGE_BINS).fill(0);
    for (const p of pts) {
      const r = round ? Math.hypot(p.x, p.z) : Math.max(Math.abs(p.x), Math.abs(p.z));
      if (r < maxR * 0.995) continue;
      const a = (Math.atan2(p.z, p.x) / (2 * Math.PI) + 0.5) * EDGE_BINS;
      const bin = Math.min(EDGE_BINS - 1, Math.max(0, Math.floor(a)));
      sum[bin] += p.y;
      cnt[bin]++;
    }
    const empty = cnt.findIndex((n) => n === 0);
    if (empty >= 0) {
      throw new Error(
        `[Lighting] attachGround: "${target.name}" has no edge vertex in azimuth bin ${empty}/${EDGE_BINS} (edge radius ${Math.round(maxR)} m) - cannot continue the land beyond it.`
      );
    }
    return { radius: maxR, heights: sum.map((h, i) => h / cnt[i]) };
  }

  /** Renders the probed ground from straight above under the current light and averages its radiance. */
  /** Returns true when the measured radiance changed by more than 2 % (the environment map must follow). */
  private measureGround(): boolean {
    const target = this.probeTarget;
    if (!target || !this.probeObject) return false;
    const renderer = this.renderer;
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevAutoClear = renderer.autoClear;
    // No shadow map may be (re)rendered through this camera: it only sees the probed ground.
    const shadowMap = renderer.shadowMap;
    const prevShadowAuto = shadowMap.autoUpdate;
    const prevShadowNeeds = shadowMap.needsUpdate;
    shadowMap.autoUpdate = false;
    shadowMap.needsUpdate = false;
    // The cascades only re-aim their lights when they next re-render (shadows.update). A probe taken right
    // after a sun change (preset flush) must already see the NEW sun direction, or the horizon and the
    // environment's ground keep the colour of the previous time of day.
    const saved = this.shadows.lights.map((l) => l.position.clone());
    for (const l of this.shadows.lights) {
      const d = Math.max(l.position.distanceTo(l.target.position), 100);
      l.position.copy(l.target.position).addScaledVector(this.lightDir, d);
      l.updateMatrixWorld();
    }
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    renderer.render(this.scene, this.probeCamera);
    this.shadows.lights.forEach((l, i) => {
      l.position.copy(saved[i]);
      l.updateMatrixWorld();
    });
    shadowMap.autoUpdate = prevShadowAuto;
    shadowMap.needsUpdate = prevShadowNeeds;
    const buf = new Uint16Array(PROBE_SIZE * PROBE_SIZE * 4);
    renderer.readRenderTargetPixels(target, 0, 0, PROBE_SIZE, PROBE_SIZE, buf);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = prevAutoClear;

    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < buf.length; i += 4) {
      if (halfToFloat(buf[i + 3]) < 0.5) continue; // hole / outside the ground
      const pr = halfToFloat(buf[i]);
      const pg = halfToFloat(buf[i + 1]);
      const pb = halfToFloat(buf[i + 2]);
      if (!Number.isFinite(pr + pg + pb)) continue;
      r += pr;
      g += pg;
      b += pb;
      n++;
    }
    if (n < 16) {
      throw new Error(
        `[Lighting] ground probe saw only ${n} lit texels of "${this.probeObject.name}" - cannot match the horizon colour.`
      );
    }
    const prev = this.probeResult.clone();
    this.probeResult.set(r / n, g / n, b / n);
    this.sky.setPlainRadiance(this.probeResult);
    this.probeDirty = false;
    const scale = Math.max(prev.x, prev.y, prev.z, this.probeResult.x, this.probeResult.y, this.probeResult.z, 1e-6);
    return prev.distanceTo(this.probeResult) / scale > 0.02;
  }

  /** Mean radiance of the outer ground under the current light (after `attachGround`), for diagnostics. */
  public get groundRadiance(): THREE.Vector3 {
    return this.probeResult;
  }

  public applyPreset(preset: TimeOfDayPreset): void {
    this.currentPreset = preset;
    const cfg = PRESETS[preset];
    this.updateSunAngles(cfg.elevationDeg, cfg.azimuthDeg, true);
  }

  /**
   * Moves the sun. The sky LUT, light colours, haze and grade update immediately. With `flush` the cloud
   * panorama, the environment map and the horizon colour are brought up to date before returning (preset
   * changes, screenshots); otherwise they catch up over the next frames (dragging the sun slider).
   */
  public updateSunAngles(elevationDeg: number, azimuthDeg: number, flush = false): void {
    this.elevationDeg = THREE.MathUtils.clamp(elevationDeg, SUN_ELEVATION_MIN_DEG, SUN_ELEVATION_MAX_DEG);
    this.azimuthDeg = ((azimuthDeg % 360) + 360) % 360;
    this.applyState();
    if (flush) this.flush();
  }

  /** Brings clouds, image-based lighting and the horizon colour up to date right now. */
  public flush(): void {
    if (this.sky.cloudsStale) {
      this.sky.updateClouds(true);
      this.envDirty = true;
    }
    if (this.envDirty) this.rebuildEnvironmentMap();
    // The environment's lower hemisphere IS the measured ground: when the measurement moved, the environment
    // has to be rebuilt with it - otherwise twilight is lit from below by the previous preset's sunlit ground.
    if (this.probeDirty && this.measureGround()) this.rebuildEnvironmentMap();
  }

  private static direction(elevationDeg: number, azimuthDeg: number, out: THREE.Vector3): THREE.Vector3 {
    // Compass azimuth: 0° = North (−Z), 90° = East (+X), 180° = South (+Z), 270° = West (−X)
    const e = THREE.MathUtils.degToRad(elevationDeg);
    const a = THREE.MathUtils.degToRad(azimuthDeg);
    return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
  }

  private applyState(): void {
    const cfg = PRESETS[this.currentPreset];
    const elev = this.elevationDeg;
    LightingSystem.direction(elev, this.azimuthDeg, this.sunDir);
    // 0 while the sun is up, 1 in deep twilight - independent of which preset the slider started from
    const twilight = 1 - THREE.MathUtils.smoothstep(elev, -3, 2.5);

    const s = this.skyState;
    s.miePerKm = cfg.miePerKm;
    // Fair-weather cumulus dissolve after sunset; what is left would only be dark blots on the afterglow.
    s.cloudCoverage = cfg.cloudCoverage * (1 - 0.75 * THREE.MathUtils.smoothstep(-elev, -1.5, 4));
    s.cloudDensity = cfg.cloudDensity;
    s.cirrus = cfg.cirrus;
    s.sunIrradiance.copy(SOLAR_COLOR).multiplyScalar(exposureNormalisation(elev));
    this.sky.update(s);

    // Direct sun: solar irradiance after extinction. Its direction is kept ≥ 2.5° above the horizon so the
    // shadow cascades stay well conditioned while the light itself fades out through the atmosphere.
    const E = atmosphereTransmittance(OBSERVER_ALT_KM, this.sunDir.y, s.miePerKm, s.ozone).multiply(s.sunIrradiance);
    const intensity = Math.max(E.x, E.y, E.z);
    const active = intensity > 0.02;
    const color = new THREE.Color(1, 1, 1);
    if (active) color.setRGB(E.x / intensity, E.y / intensity, E.z / intensity);
    LightingSystem.direction(Math.max(elev, 2.5), this.azimuthDeg, this.lightDir);
    this.shadows.setSun(this.lightDir, color, active ? intensity : 0, active);

    this.nightFactor = computeNightFactor(elev);

    if (this.pipeline) {
      const fog = this.pipeline.fog;
      fog.mieExtPerM = s.miePerKm * 1.11e-3;
      fog.mistExtPerM = cfg.mistPerKm * 1e-3;
      fog.mistHeightM = cfg.mistHeightM;
      const g = this.pipeline.grade;
      const tw = TWILIGHT_GRADE;
      g.contrast = THREE.MathUtils.lerp(cfg.contrast, tw.contrast, twilight);
      g.saturation = THREE.MathUtils.lerp(cfg.saturation, tw.saturation, twilight);
      g.bloom = THREE.MathUtils.lerp(cfg.bloom, tw.bloom, twilight);
      // Twilight: lift the toe so dark asphalt stays readable next to plaster walls (neutral - no blue cast).
      g.blackLift = TWILIGHT_BLACK_LIFT * twilight;
      // Low sun: the preset's warm/cool balance applies fully; when the user drags the sun high it relaxes,
      // and below the horizon every preset converges to the twilight balance.
      const neutral: [number, number, number] = [1, 1, 1];
      const wbAmount = cfg.elevationDeg < 25 ? 1 - THREE.MathUtils.smoothstep(elev, 25, 45) : 1;
      lerp3(neutral, cfg.whiteBalance, wbAmount, g.whiteBalance);
      g.whiteBalance.lerp(TMP.set(...tw.whiteBalance), twilight);
      g.shadowTint.set(...cfg.shadowTint).lerp(TMP.set(...tw.shadowTint), twilight);
      g.highlightTint.set(...cfg.highlightTint).lerp(TMP.set(...tw.highlightTint), twilight);
    }
    this.renderer.toneMappingExposure = cfg.exposure;

    this.envDirty = true;
    this.probeDirty = this.probeObject !== null;
  }

  public rebuildEnvironmentMap(): void {
    const prevEnv = this.envRT;
    this.envRT = this.sky.buildEnvironment(this.pmrem);
    this.scene.environment = this.envRT.texture;
    if (prevEnv) prevEnv.dispose();
    this.envDirty = false;
    this.envAge = 0;
  }

  /** Clean-capture mode: stop the wind and put the clouds into a reproducible position. */
  public setCloudsFrozen(frozen: boolean): void {
    this.cloudsFrozen = frozen;
    if (frozen && this.sky.time !== 12.0) {
      this.sky.time = 12.0;
      this.sky.updateClouds(true);
      this.envDirty = true;
    }
  }

  /**
   * Per-frame update.
   * @param heightAt  terrain height lookup used to place the shadow cascades on the ground
   * @param sync      true for synchronous debug/screenshot renders: flush every pending update now
   * @param dynamic   true while something that casts a near shadow is moving (tractor driving)
   */
  public update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    heightAt: (x: number, z: number) => number,
    sync = false,
    dynamic = true
  ): void {
    if (!this.cloudsFrozen) this.sky.time += dt;
    this.envAge += dt;
    if (sync) {
      this.flush();
    } else {
      // clouds first (they are part of the environment), then the environment, then the horizon colour
      if (this.sky.updateClouds(false)) this.envDirty = true;
      if (this.envDirty && this.envAge > 0.15) this.rebuildEnvironmentMap();
      else if (this.probeDirty && !this.envDirty && !this.sky.cloudsStale && this.measureGround()) this.envDirty = true;
      // Slowly drifting clouds change the ambient light a little: refresh the environment now and then.
      if (!this.cloudsFrozen && this.envAge > 20) this.rebuildEnvironmentMap();
    }
    this.shadows.update(camera, heightAt, dt, sync, dynamic);
  }

  /** Switches sun shadows without changing the light set, so no shader is recompiled. */
  public setShadowsEnabled(enabled: boolean): void {
    this.shadowsEnabled = enabled;
    this.shadows.setEnabled(enabled);
  }

  public get shadowsOn(): boolean {
    return this.shadowsEnabled;
  }
}

