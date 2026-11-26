import './style.css';
import * as THREE from 'three';
import { TractorAudio } from './audio';
import { BenchmarkOverlay, type ReferencePoseOverride } from './benchmarkOverlay';
import { loadAllBuildings } from './buildings';
import { buildKindenheimBookmarks, CameraRig, isFormControlTarget } from './camera';
import { readTouchDriveInput } from './touchControls';
import { BuildingCollider } from './collision';
import { loadAllDatasetMetadata } from './dataLoader';
import { buildAgriculturalFields, type FieldsSystemResult } from './fields';
import { WeinleseTourGame } from './game';
import { LightingSystem } from './lighting';
import { RenderPipeline } from './postfx';
import {
  getGpuName,
  loadQualityChoice,
  resolveQuality,
  storeQualityChoice,
  type QualityChoice,
  type QualityLevel,
} from './renderQuality';
import { buildRecreationAreas, type RecreationSystemResult } from './recreation';
import { buildRoadNetwork } from './roads';
import { buildSceneryAndProps } from './scenery';
import { setTextureBudgetLevel, assertTextureDedupeConsistent } from './sharedAssets';
import { TerrainSystem } from './terrain';
import { PedestrianSystem } from './pedestrians'; // NPC pedestrians
import { TrafficSystem } from './traffic'; // NPC traffic
import { TractorController, type TractorInput, type TractorTelemetry } from './tractor';
import type { BenchmarkLayout, CameraBookmark, CameraMode, TimeOfDayPreset } from './types';
import { showFatal, UIController } from './ui';

interface KindenheimDebugApi {
  ready: boolean;
  bookmarks: CameraBookmark[];
  referenceShots: { id: string; title: string; file: string; source: string }[];
  setBookmark: (index: number, instant?: boolean) => void;
  setReferenceView: (idOrIndex: string | number, instant?: boolean) => boolean;
  setBenchmarkMode: (enabled: boolean, layout?: BenchmarkLayout) => void;
  setBenchmarkCleanCapture: (enabled: boolean) => void;
  setReferencePoseOverride: (refId: string, override: ReferencePoseOverride) => boolean;
  setCameraMode: (mode: CameraMode) => void;
  setTimeOfDay: (preset: TimeOfDayPreset) => void;
  flyTo: (pos: [number, number, number], target: [number, number, number], instant?: boolean, fovDeg?: number) => void;
  getTractorState: () => TractorTelemetry | null;
  teleportTractor: (x: number, z: number, headingRad: number) => void;
  driveFor: (throttle: number, steer: number, seconds: number, handbrake?: boolean) => TractorTelemetry | null;
  setTractorOptions: (opts: { lights?: boolean; beacon?: boolean; trailer?: boolean }) => void;
  getStatus: () => Record<string, unknown>;
  /** Terrain surface height (scene Y, metres) at world x/z — used by scripts/shot.mjs `agl` poses. */
  getTerrainHeight: (x: number, z: number) => number;
  /**
   * Raw three.js handles for headless inspection/debugging.
   * NOTE: `renderer.render(scene, camera)` draws the un-post-processed scene; use `renderNow()` for the real frame.
   */
  three: { scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer };
  /** Synchronously renders one complete frame (shadows, sky, post-processing) with all pending updates flushed. */
  renderNow: () => void;
  /** Moves the sun (degrees; elevation −6…78, compass azimuth) and re-runs the time-of-day contract. */
  setSunAngles: (elevationDeg: number, azimuthDeg: number) => void;
  /** Switches the render quality ('auto' | 'low' | 'medium' | 'high' | 'ultra'). */
  setQuality: (choice: QualityChoice) => QualityLevel;
  /** Lighting / pipeline state for tests: quality, internal resolution, nightFactor, shadow cascades. */
  getRenderInfo: () => Record<string, unknown>;
  /** Live lighting objects for look-development from the console / shot tool `eval`. */
  debug: { lighting: LightingSystem; pipeline: RenderPipeline; renderFrame: (dt: number, sync: boolean) => void };
  /** Milliseconds spent in each loading phase (performance.now() deltas), for load-time checks. */
  loadTimings: Record<string, number>;
}

/** Time-of-day contract implemented by the scene modules (see .gfx/BRIEF.md). */
interface TimeOfDayAware {
  setTimeOfDay?: (preset: TimeOfDayPreset, nightFactor: number) => void;
}

/** Quality contract implemented by the scene modules (see .gfx/review/FIXROUND.md). */
interface QualityAware {
  setQuality?: (level: QualityLevel) => void;
}

/**
 * Automatic tractor headlights follow the night factor with hysteresis (on from about sunset, off again once
 * the sun is clearly up), so slider drags around the threshold do not make them flicker.
 */
const AUTO_LIGHTS_ON_NIGHT = 0.5;
const AUTO_LIGHTS_OFF_NIGHT = 0.25;

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Every texture referenced by a material below `root` that already has pixel data. */
function collectSceneTextures(root: THREE.Object3D): THREE.Texture[] {
  const found = new Set<THREE.Texture>();
  const consider = (value: unknown): void => {
    const tex = value as THREE.Texture | null;
    if (!tex || tex.isTexture !== true) return;
    if ((tex as THREE.Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture) return;
    if (!tex.image) return;
    found.add(tex);
  };
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      for (const value of Object.values(mat)) consider(value);
      const uniforms = (mat as THREE.ShaderMaterial).uniforms;
      if (uniforms) {
        for (const u of Object.values(uniforms)) {
          const v = (u as THREE.IUniform | undefined)?.value;
          if (Array.isArray(v)) v.forEach(consider);
          else consider(v);
        }
      }
    }
  });
  return [...found];
}

interface NightGlowEntry {
  material: THREE.MeshStandardMaterial;
  baseIntensity: number;
}

const NIGHT_GLOW_NAME = /emissive|lamp/i;
const NIGHT_GLOW_COLOR = new THREE.Color(1.0, 0.8, 0.52);

/**
 * Finds materials named *Emissive* / *Lamp* below `root` so they can be faded in at night for modules that
 * do not implement `setTimeOfDay` themselves.
 */
function collectNightGlowMaterials(root: THREE.Object3D, into: Map<THREE.Material, NightGlowEntry>): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat || into.has(mat) || !NIGHT_GLOW_NAME.test(mat.name)) continue;
      const std = mat as THREE.MeshStandardMaterial;
      if (!(std.emissive instanceof THREE.Color)) continue;
      if (std.emissive.r + std.emissive.g + std.emissive.b < 1e-4) std.emissive.copy(NIGHT_GLOW_COLOR);
      into.set(mat, { material: std, baseIntensity: Math.max(std.emissiveIntensity ?? 1, 1) });
    }
  });
}

declare global {
  interface Window {
    __KINDENHEIM__?: KindenheimDebugApi;
  }
}

async function bootstrap(): Promise<void> {
  const loadTimings: Record<string, number> = {};
  let phaseStart = performance.now();
  const endPhase = (name: string): void => {
    const now = performance.now();
    loadTimings[name] = Math.round(now - phaseStart);
    phaseStart = now;
  };
  const canvas = document.getElementById('scene-canvas') as HTMLCanvasElement;

  // Anti-aliasing happens in the HDR pipeline (multisampled float target + supersampling/FXAA), so the
  // canvas itself needs no MSAA.
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Only used when something renders straight to the canvas without the pipeline (debug); the real
  // film response (AgX + grade) lives in src/postfx.ts.
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.22, 9500);

  let qualityChoice: QualityChoice = loadQualityChoice();
  let quality = resolveQuality(qualityChoice, renderer);
  console.info(`[Kindenheim 3D] GPU "${getGpuName(renderer)}" → quality "${quality.level}" (${qualityChoice})`);
  // Texture resolution is capped by quality while the GLBs load, so this has to be known before any of them.
  setTextureBudgetLevel(quality.level);

  const shadowQuality = (q: typeof quality) => ({
    mapSizes: q.shadowMapSizes,
    farRadius: q.shadowFarRadius,
    nearEveryNFrames: q.shadowNearEveryNFrames,
    nearIdleInterval: q.shadowNearIdleInterval,
    casterCullTexels: q.shadowCasterCullTexels,
  });

  const lighting = new LightingSystem(scene, renderer, quality.shadowMapSizes);
  lighting.shadows.setQuality(shadowQuality(quality));
  const pipeline = new RenderPipeline(renderer, scene, camera, lighting.sky, quality);
  pipeline.setSize(window.innerWidth, window.innerHeight);
  lighting.attachPipeline(pipeline);
  if (new URLSearchParams(window.location.search).get('drs') === '0') pipeline.dynamicResolution = false;

  // Window size and pixel ratio are followed from the very start (also while assets are still loading).
  // Target reallocation is debounced so dragging a window edge stays smooth; the camera follows at once.
  let resizeTimer = 0;
  const applyViewportSize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    pipeline.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(applyViewportSize, 110);
  });
  // moving the window to a monitor with another pixel density fires no resize event
  const watchPixelRatio = (): void => {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener(
      'change',
      () => {
        applyViewportSize();
        watchPixelRatio();
      },
      { once: true }
    );
  };
  watchPixelRatio();

  let contextLost = false;
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    contextLost = true;
    console.error('[Kindenheim 3D] WebGL context lost - rendering stopped.');
    showFatal('Die Grafikkarte hat die 3D-Ansicht beendet (WebGL-Kontext verloren). Bitte die Seite neu laden.');
  });
  const audio = new TractorAudio();

  let bookmarks: CameraBookmark[] = [];
  let terrain: TerrainSystem | null = null;
  let cameraRig: CameraRig | null = null;
  let roadGroup: THREE.Group | null = null;
  let benchmarkOverlay: BenchmarkOverlay | null = null;
  let tractor: TractorController | null = null;
  let tourGame: WeinleseTourGame | null = null;
  let recreationSystem: RecreationSystemResult | null = null;
  let cleanCaptureActive = false;
  let pedestrians: PedestrianSystem | null = null; // NPC pedestrians
  let traffic: TrafficSystem | null = null; // NPC traffic

  const heightAt = (x: number, z: number): number => (terrain ? terrain.getTerrainHeight(x, z) : 0);

  /**
   * Renders one complete frame. `sync` flushes every amortised update (environment map, outer shadow
   * cascades) so a screenshot taken right after a pose / time-of-day change is already final.
   */
  const renderFrame = (dt: number, sync: boolean): void => {
    if (contextLost) return;
    // near shadows only need re-rendering while something that casts them moves
    const dynamic = (tractor ? Math.abs(tractor.speedMps) > 0.03 : false) || (pedestrians !== null && pedestrians.castsNearShadows); // NPC pedestrians: walkers in the near cascade
    const npcTrafficDynamic = traffic !== null && traffic.hasMovingNearCasters; // NPC traffic: moving cars in the near cascade
    lighting.update(dt, camera, heightAt, sync, dynamic || npcTrafficDynamic);
    pipeline.render();
    lighting.shadows.endFrame();
  };
  const renderNow = (): void => renderFrame(0, true);

  // ── Time-of-day contract: every scene module may expose setTimeOfDay(preset, nightFactor) ──
  const timeOfDayTargets: TimeOfDayAware[] = [];
  const nightGlow = new Map<THREE.Material, NightGlowEntry>();
  let lastNightFactor = -1;
  let lastContractPreset: TimeOfDayPreset | null = null;
  /**
   * Headlight rule: they follow the time of day in both directions (on at dusk, off again by day) until the
   * player switches them with the light button / L key. From then on the switch is the player's for the rest
   * of the session. The beacon is not a darkness light; it stays wherever the player put it. The debug API's
   * setTractorOptions sets the state for a shot without taking the switch away from the automatic.
   */
  let headlightsManual = false;
  const syncAutoHeadlights = (nightFactor: number): void => {
    if (!tractor || headlightsManual) return;
    const want = nightFactor >= AUTO_LIGHTS_ON_NIGHT ? true : nightFactor <= AUTO_LIGHTS_OFF_NIGHT ? false : tractor.lightsOn;
    if (want === tractor.lightsOn) return;
    tractor.setOptions({ lights: want });
    ui.updateTractorHud(tractor.getTelemetry(), audio.muted);
  };
  const applyTimeOfDayContract = (force = false): void => {
    const nf = lighting.nightFactor;
    const preset = lighting.currentPreset;
    if (!force && preset === lastContractPreset && Math.abs(nf - lastNightFactor) < 0.004) return;
    lastNightFactor = nf;
    lastContractPreset = preset;
    // The recreation module fades its lights through setTimeOfDay(); the binary setDuskMode() is only a
    // fallback for a build of that module without the contract.
    if (recreationSystem && typeof (recreationSystem as TimeOfDayAware).setTimeOfDay !== 'function') {
      recreationSystem.setDuskMode(nf > 0.5);
    }
    for (const target of timeOfDayTargets) target.setTimeOfDay?.(preset, nf);
    for (const entry of nightGlow.values()) {
      entry.material.emissiveIntensity = entry.baseIntensity * 4.0 * nf;
    }
    syncAutoHeadlights(nf);
  };

  // ── Quality contract: every scene module may expose setQuality(level) ──
  const qualityTargets: QualityAware[] = [];
  const applyModuleQuality = (): void => {
    for (const target of qualityTargets) target.setQuality?.(quality.level);
    // modules may have changed LODs, instance counts or cast flags: take stock of the casters again
    scene.updateMatrixWorld(true);
    lighting.shadows.refreshCasters(scene);
  };

  const applyQuality = (choice: QualityChoice): QualityLevel => {
    qualityChoice = choice;
    storeQualityChoice(choice);
    quality = resolveQuality(choice, renderer);
    lighting.shadows.setQuality(shadowQuality(quality));
    pipeline.setQuality(quality);
    applyModuleQuality();
    ui.setQualityChoice(choice, quality.level);
    return quality.level;
  };

  /**
   * The one code path for a time-of-day preset (HUD buttons AND the debug API, so screenshots show what the
   * player sees): light, sliders, module contract and, through it, the automatic headlights.
   */
  const changeTimeOfDay = (preset: TimeOfDayPreset): void => {
    ui.setActiveTimeOfDay(preset);
    lighting.applyPreset(preset);
    ui.syncSunSliders(lighting.elevationDeg, lighting.azimuthDeg);
    applyTimeOfDayContract(true);
  };

  // Live driving keyboard state
  const driveKeys = new Set<string>();
  window.addEventListener('keydown', (e) => {
    if (isFormControlTarget(e.target)) return;
    driveKeys.add(e.code);
  });
  window.addEventListener('keyup', (e) => {
    driveKeys.delete(e.code);
  });
  window.addEventListener('blur', () => {
    driveKeys.clear();
    audio.setHorn(false);
  });

  const readDriveInput = (): TractorInput => {
    if (!cameraRig || cameraRig.mode === 'drone') {
      return { throttle: 0, steer: 0, handbrake: false };
    }
    let throttle = 0;
    if (driveKeys.has('KeyW') || driveKeys.has('ArrowUp')) throttle += 1;
    if (driveKeys.has('KeyS') || driveKeys.has('ArrowDown')) throttle -= 1;

    let steer = 0;
    if (driveKeys.has('KeyA') || driveKeys.has('ArrowLeft')) steer += 1;
    if (driveKeys.has('KeyD') || driveKeys.has('ArrowRight')) steer -= 1;

    // Phone / tablet: on-screen steering pad and pedals (src/touchControls.ts), added to the keyboard state.
    const touch = readTouchDriveInput();
    if (touch) {
      throttle = Math.max(-1, Math.min(1, throttle + touch.throttle));
      steer = Math.max(-1, Math.min(1, steer + touch.steer));
    }
    return { throttle, steer, handbrake: driveKeys.has('Space') || Boolean(touch?.handbrake) };
  };

  const alignToRefIndex = (idx: number, instant = false) => {
    const shot = benchmarkOverlay?.selectShot(idx);
    if (!shot || !cameraRig) return false;
    ui.displayActiveReference(shot, idx);
    ui.setActiveBookmark(-1);
    ui.setActiveCameraMode('drone');
    cameraRig.flyTo(shot.bookmark.position, shot.bookmark.target, instant ? 0 : 0.95, shot.bookmark.fovDeg);
    benchmarkOverlay?.updateVisibilityForCamera(camera.position);
    return true;
  };

  const ui = new UIController({
    onTimeOfDay: (preset) => {
      changeTimeOfDay(preset);
    },
    onCameraMode: (mode) => {
      cameraRig?.setMode(mode);
      if (mode !== 'drone' && benchmarkOverlay?.active) {
        ui.setBenchmarkMode(false);
        benchmarkOverlay.setActive(false);
      }
    },
    onBookmark: (index) => {
      const bm = bookmarks[index];
      if (!bm || !cameraRig) return;
      ui.setActiveCameraMode('drone');
      cameraRig.flyTo(bm.position, bm.target, 1.0, bm.fovDeg);
    },
    onToggleBenchmarkMode: (enabled) => {
      benchmarkOverlay?.setActive(enabled);
      if (enabled && cameraRig && cameraRig.mode !== 'drone') {
        ui.setActiveCameraMode('drone');
        cameraRig.setMode('drone');
      }
      benchmarkOverlay?.updateVisibilityForCamera(camera.position);
      if (enabled && cameraRig) {
        benchmarkOverlay?.renderMinimap(
          cameraRig.camera.position.x,
          cameraRig.camera.position.z,
          cameraRig.getLookYawForMap()
        );
      }
    },
    onBenchmarkLayout: (layout) => {
      if (benchmarkOverlay) {
        benchmarkOverlay.layout = layout;
        benchmarkOverlay.updateVisibilityForCamera(camera.position);
      }
    },
    onSelectReferenceShot: (idx) => {
      alignToRefIndex(idx, false);
    },
    onAlignToCurrentRef: () => {
      if (!benchmarkOverlay) return;
      alignToRefIndex(benchmarkOverlay.selectedIndex, false);
    },
    onSunAngles: (elev, azim) => {
      lighting.updateSunAngles(elev, azim, false);
      applyTimeOfDayContract();
    },
    onQuality: (choice) => {
      applyQuality(choice);
    },
    onWireframe: (enabled) => {
      terrain?.setWireframe(enabled);
    },
    onShadows: (enabled) => {
      lighting.setShadowsEnabled(enabled);
    },
    onRoadsToggle: (enabled) => {
      if (roadGroup) roadGroup.visible = enabled;
    },
    onPinsToggle: (enabled) => {
      benchmarkOverlay?.setPinsVisible(enabled);
    },
    onArrowToggle: (enabled) => {
      tourGame?.setArrowVisible(enabled);
    },
    onMinimapClick: (clientX, clientY) => {
      const worldXZ = benchmarkOverlay?.minimapClickToWorld(clientX, clientY);
      if (!worldXZ || !cameraRig) return;
      ui.setActiveCameraMode('drone');
      cameraRig.flyToWorldXZ(worldXZ[0], worldXZ[1], 95, 0.85);
    },
    onToggleLights: () => {
      if (!tractor) return;
      headlightsManual = true;
      tractor.setOptions({ lights: !tractor.lightsOn });
    },
    onToggleBeacon: () => {
      if (!tractor) return;
      tractor.setOptions({ beacon: !tractor.beaconOn });
    },
    onToggleTrailer: () => {
      if (!tractor) return;
      tractor.setOptions({ trailer: !tractor.trailerAttached });
    },
    onHornStart: () => audio.setHorn(true),
    onHornEnd: () => audio.setHorn(false),
    onToggleMute: () => audio.setMuted(!audio.muted),
    onResetTractor: () => {
      if (!tractor || !cameraRig) return;
      tractor.resetToHauptstrasse();
      if (cameraRig.mode === 'drone') {
        ui.setActiveCameraMode('chase');
        cameraRig.setMode('chase');
      } else {
        cameraRig.snapToCurrentMode();
      }
      ui.showToast('Traktor zurück auf Hauptstraße gesetzt');
    },
    onRestartTour: () => {
      if (!tourGame) return;
      tourGame.restart();
      ui.showToast('Pfälzer Weinlese-Tour neu gestartet!');
    },
  });

  ui.syncSunSliders(lighting.elevationDeg, lighting.azimuthDeg);
  ui.setQualityChoice(qualityChoice, quality.level);

  // 1. Load metadata, heightmap, OSM scene, Brave reference manifest & Blender manifests
  const dataset = await loadAllDatasetMetadata((stage, pct, text) => {
    ui.setLoadingProgress(stage, pct, text);
  });

  endPhase('metadata');
  // 2. Build real terrain mesh + orthophoto + close-range detail-splat shader
  terrain = new TerrainSystem(dataset.meta, dataset.heightmap);
  scene.add(terrain.mesh);

  cameraRig = new CameraRig(camera, canvas, terrain);

  ui.setLoadingProgress('orthophoto', 36, 'Lade DOP20-Luftbild & Bodentexturen…');
  await terrain.loadTextures(maxAnisotropy);
  ui.setImageryAttribution(terrain.imageryAttribution);

  endPhase('terrain');
  // 3. Build draped roads
  ui.setLoadingProgress('orthophoto', 48, 'Erstelle Straßennetz, Hauptstraße & Feldwege…');
  roadGroup = buildRoadNetwork(dataset.scene.roads, terrain, maxAnisotropy);
  scene.add(roadGroup);

  // 4. Load Blender 3D landmarks, village building chunks & Playable Tractor + Grape Trailer!
  ui.setLoadingProgress('buildings', 56, 'Lade 3D-Gebäude, Wahrzeichen & Pfälzer Traktor…');
  if (!(dataset.meta.mapSizeM > 0)) {
    throw new Error(`data/meta.json: mapSizeM must be a positive number, got ${String(dataset.meta.mapSizeM)}`);
  }
  const collider = new BuildingCollider(dataset.scene.buildings, dataset.meta.mapSizeM);
  tractor = new TractorController(terrain, collider, maxAnisotropy);
  // Kerb / sidewalk lift for every wheel contact (required by src/tractor.ts; provided by src/roads.ts).
  tractor.setSurfaceLiftSampler(roadGroup.userData.getSurfaceLift);

  const [buildingRes] = await Promise.all([
    loadAllBuildings(
      dataset.landmarksManifest,
      dataset.villageManifest,
      terrain,
      maxAnisotropy,
      (done, total, label) => {
        const pct = total > 0 ? 56 + (done / total) * 24 : 78;
        ui.setLoadingProgress('buildings', pct, label);
      }
    ),
    tractor.loadModels(dataset.tractorManifest),
  ]);
  scene.add(buildingRes.group);
  scene.add(tractor.group);
  // Landmark colliders (public/assets/models/landmarks/colliders.json): open estate yards, church terrace,
  // memorial. Must run before driving starts; the camera uses the same solids to stay out of walls.
  await collider.loadLandmarkColliders(dataset.landmarksManifest);
  collider.measureLandmarkSolidHeights(buildingRes.landmarks);
  cameraRig.setObstacles(collider, [...buildingRes.landmarks.values()].map((l) => l.object));

  endPhase('buildingsAndTractor');
  // Street View / aerial reference shots are shipped data: scenery and fields keep vegetation off their camera
  // spots and the comparison mode shows them. dataLoader fetches the manifest as optional (404 -> null), so the
  // requirement is enforced here, with the file named.
  if (!dataset.braveRefs) {
    throw new Error('Data: /data/references/brave/manifest.json is missing (HTTP 404 or an HTML fallback page)');
  }
  if (dataset.braveRefs.references.length === 0) {
    throw new Error('Data: /data/references/brave/manifest.json lists no usable reference shots');
  }
  const references = dataset.braveRefs.references;

  // 5. Populate Palatinate vineyards, trees, Ortsschilder, streetlamps, hay bales, barrels, fields & recreation areas
  ui.setLoadingProgress('scenery', 84, 'Pflanze Pfälzer Weinberge, Felder, Sport- & Spielplatz…');
  const [sceneryRes, fieldsRes, recreationRes] = await Promise.all([
    buildSceneryAndProps(
      dataset.scene,
      dataset.villageManifest,
      buildingRes.landmarks,
      terrain,
      maxAnisotropy,
      references
    ),
    buildAgriculturalFields(
      dataset.fieldsLayout,
      dataset.fieldsManifest,
      dataset.scene,
      terrain,
      maxAnisotropy,
      references
    ),
    buildRecreationAreas(terrain, collider, maxAnisotropy),
  ]);
  scene.add(sceneryRes.group);
  scene.add(fieldsRes.group);
  scene.add(recreationRes.group);
  recreationSystem = recreationRes;
  const fieldsSystem: FieldsSystemResult = fieldsRes;

  endPhase('sceneryFieldsRecreation');
  // 6. Initialize Pfälzer Weinlese-Tour checkpoints + Reality-vs-3D Benchmark overlay
  ui.setLoadingProgress('scenery', 94, 'Starte Pfälzer Weinlese-Tour & Vergleichs-Modus…');
  tourGame = new WeinleseTourGame(terrain);
  scene.add(tourGame.group);
  scene.add(tourGame.arrowGroup);

  benchmarkOverlay = new BenchmarkOverlay(terrain, references, ui.minimapCanvas);
  scene.add(benchmarkOverlay.group);
  const allShots = benchmarkOverlay.getShots();
  const heroShotIdx = allShots.findIndex((s) => s.ref.id === 'sv_kirche_full_west');
  if (heroShotIdx >= 0) benchmarkOverlay.selectShot(heroShotIdx);
  ui.populateReferenceShots(allShots);

  // 7. Build Drone bookmarks & start in DEFAULT 3rd-Person Chase Tractor Mode on Hauptstraße!
  bookmarks = buildKindenheimBookmarks(terrain, buildingRes.landmarks, sceneryRes);
  cameraRig.attachTractor(tractor);
  cameraRig.setMode('chase');
  ui.setActiveCameraMode('chase');

  // Lighting hand-over: haze reference level, horizon colour, quality + time-of-day contracts.
  pipeline.fog.groundY = terrain.getTerrainHeight(0, 0);
  scene.updateMatrixWorld(true);
  lighting.attachGround();
  // NPC pedestrians: villagers on the sidewalks, paths and squares (src/pedestrians.ts)
  ui.setLoadingProgress('scenery', 94.5, 'Dorfbewohner machen sich auf den Weg…');
  const pedestrianSystem = await PedestrianSystem.create({
    scene,
    sceneData: dataset.scene,
    terrain,
    roadGroup,
    collider,
    quality: quality.level,
  });
  scene.add(pedestrianSystem.group);
  qualityTargets.push(pedestrianSystem);
  timeOfDayTargets.push(pedestrianSystem);
  pedestrians = pedestrianSystem;
  endPhase('pedestrians');
  // NPC pedestrians (end)
  // NPC traffic: driving + parked cars on the OSM lane graph (src/traffic.ts); registers the tractor/trailer actors
  ui.setLoadingProgress('scenery', 95, 'Autos fahren los…');
  const trafficSystem = await TrafficSystem.create({
    roads: dataset.scene.roads,
    terrain,
    roadGroup,
    collider,
    tractor,
    maxAnisotropy,
  });
  scene.add(trafficSystem.group);
  qualityTargets.push(trafficSystem);
  timeOfDayTargets.push(trafficSystem);
  traffic = trafficSystem;
  endPhase('traffic');
  // NPC traffic (end)
  qualityTargets.push(
    buildingRes as QualityAware,
    sceneryRes as QualityAware,
    fieldsRes as QualityAware,
    recreationRes as QualityAware,
    tractor as QualityAware,
    terrain as QualityAware,
    roadGroup.userData as QualityAware
  );
  applyModuleQuality();
  const contractSystems: { system: TimeOfDayAware; root: THREE.Object3D | null; genericGlow: boolean }[] = [
    { system: buildingRes as TimeOfDayAware, root: buildingRes.group, genericGlow: true },
    { system: sceneryRes as TimeOfDayAware, root: sceneryRes.group, genericGlow: true },
    { system: fieldsRes as TimeOfDayAware, root: fieldsRes.group, genericGlow: true },
    { system: recreationRes as TimeOfDayAware, root: recreationRes.group, genericGlow: true },
    // The tractor has its own light switch (L / B keys); its lamps are never driven generically.
    { system: tractor as TimeOfDayAware, root: tractor.group, genericGlow: false },
    { system: terrain as TimeOfDayAware, root: terrain.mesh, genericGlow: true },
    { system: roadGroup.userData as TimeOfDayAware, root: roadGroup, genericGlow: true },
  ];
  for (const entry of contractSystems) {
    timeOfDayTargets.push(entry.system);
    // Modules without the contract still get glowing *Emissive* / *Lamp* materials at night.
    if (typeof entry.system.setTimeOfDay !== 'function' && entry.genericGlow && entry.root) {
      collectNightGlowMaterials(entry.root, nightGlow);
    }
  }
  applyTimeOfDayContract(true);

  // Initial HUD sync
  const bldgTotal = Math.max(
    dataset.meta.buildingCount ?? 0,
    (dataset.villageManifest?.buildingCount ?? 0) + buildingRes.landmarkCount,
    dataset.scene.buildings.length
  );
  const fieldsLabel = fieldsSystem.stats.parcelCount > 0 ? ` · ${fieldsSystem.stats.parcelCount} Felder` : ` · ${collider.polyCount} Kollider`;
  ui.setStatsText(
    `${bldgTotal} Gebäude · ${sceneryRes.stats.vineInstances.toLocaleString('de-DE')} Rebzeilen${fieldsLabel}`
  );
  ui.updateTractorHud(tractor.getTelemetry(), audio.muted);
  const initTour = tourGame.update(0, tractor.tractorRoot.position, 0, true);
  ui.updateTourHud(initTour);
  const initLatLon = terrain.worldToLatLon(tractor.x, tractor.z);
  ui.renderDriveMinimap(
    tractor.x,
    tractor.z,
    tractor.headingRad,
    initLatLon.lat,
    terrain.getAbsoluteElevation(tractor.x, tractor.z),
    tourGame.getCheckpoints(),
    tourGame.activeIndex,
    tourGame.completed,
    terrain.mapSizeM
  );

  // Expose full Playwright verification & gameplay automation hook
  const debugApi: KindenheimDebugApi = {
    ready: true,
    bookmarks,
    referenceShots: allShots.map((s) => ({
      id: s.ref.id,
      title: s.ref.title,
      file: s.ref.file,
      source: s.ref.source,
    })),
    setBookmark: (index: number, instant = true) => {
      const bm = bookmarks[index];
      if (!bm || !cameraRig) return;
      ui.setActiveBookmark(index);
      ui.setActiveCameraMode('drone');
      cameraRig.flyTo(bm.position, bm.target, instant ? 0 : 0.9, bm.fovDeg);
      benchmarkOverlay?.updateVisibilityForCamera(camera.position);
      renderNow();
    },
    setReferenceView: (idOrIndex: string | number, instant = true) => {
      if (!benchmarkOverlay) return false;
      const shots = benchmarkOverlay.getShots();
      const idx = typeof idOrIndex === 'number' ? idOrIndex : shots.findIndex((s) => s.ref.id === idOrIndex);
      if (idx < 0 || idx >= shots.length) return false;
      const ok = alignToRefIndex(idx, instant);
      if (ok && cameraRig) {
          benchmarkOverlay.updateVisibilityForCamera(camera.position);
        renderNow();
      }
      return ok;
    },
    setBenchmarkMode: (enabled: boolean, layout?: BenchmarkLayout) => {
      ui.setBenchmarkMode(enabled);
      benchmarkOverlay?.setActive(enabled);
      if (enabled && cameraRig && cameraRig.mode !== 'drone') {
        ui.setActiveCameraMode('drone');
        cameraRig.setMode('drone');
      }
      if (layout) {
        ui.setBenchmarkLayout(layout);
        if (benchmarkOverlay) benchmarkOverlay.layout = layout;
      }
      benchmarkOverlay?.updateVisibilityForCamera(camera.position);
      if (enabled && cameraRig) {
        benchmarkOverlay?.renderMinimap(
          cameraRig.camera.position.x,
          cameraRig.camera.position.z,
          cameraRig.getLookYawForMap()
        );
      }
      renderNow();
      if (ui.isDiffLayoutActive()) {
        ui.renderLiveDiffHeatmap(canvas);
      }
    },
    setBenchmarkCleanCapture: (enabled: boolean) => {
      cleanCaptureActive = enabled;
      ui.setCleanCaptureMode(enabled);
      if (tractor) tractor.group.visible = !enabled;
      if (tourGame) {
        tourGame.group.visible = !enabled;
        tourGame.arrowGroup.visible = !enabled && tourGame.arrowEnabled && !tourGame.completed;
      }
      if (benchmarkOverlay) {
        benchmarkOverlay.setPinsVisible(!enabled);
        benchmarkOverlay.updateVisibilityForCamera(camera.position);
      }
      lighting.setCloudsFrozen(enabled);
      pedestrians?.setHidden(enabled); // NPC pedestrians
      traffic?.setHidden(enabled); // NPC traffic
      // captures compare images: keep their resolution fixed
      pipeline.dynamicResolution = !enabled && new URLSearchParams(window.location.search).get('drs') !== '0';
      renderNow();
    },
    setReferencePoseOverride: (refId: string, override: ReferencePoseOverride) => {
      if (!benchmarkOverlay) return false;
      const updated = benchmarkOverlay.setPoseOverride(refId, override);
      if (!updated) return false;
      const idx = benchmarkOverlay.getShots().findIndex((s) => s.ref.id === refId);
      if (idx >= 0) alignToRefIndex(idx, true);
      renderNow();
      return true;
    },
    setCameraMode: (requested: CameraMode) => {
      // scripts/shot.mjs documents the cab camera as "cabin"; the rig calls it "cab"
      const mode: CameraMode = (requested as string) === 'cabin' ? 'cab' : requested;
      ui.setActiveCameraMode(mode);
      cameraRig?.setMode(mode);
      if (mode !== 'drone' && benchmarkOverlay?.active) {
        ui.setBenchmarkMode(false);
        benchmarkOverlay.setActive(false);
      }
      if (cameraRig) {
        }
      renderNow();
    },
    setTimeOfDay: (preset: TimeOfDayPreset) => {
      changeTimeOfDay(preset);
      renderNow();
    },
    flyTo: (pos, target, instant = true, fovDeg?: number) => {
      if (!cameraRig) return;
      ui.setActiveCameraMode('drone');
      cameraRig.flyTo(pos, target, instant ? 0 : 0.8, fovDeg);
      renderNow();
    },
    getTractorState: () => (tractor ? tractor.getTelemetry() : null),
    teleportTractor: (x: number, z: number, headingRad: number) => {
      if (!tractor || !cameraRig || !terrain || !tourGame) return;
      tractor.teleport(x, z, headingRad);
      cameraRig.snapToCurrentMode();
      ui.updateTractorHud(tractor.getTelemetry(), audio.muted);
      const snap = tourGame.update(0, tractor.tractorRoot.position, tractor.speedMps, cameraRig.mode === 'chase');
      ui.updateTourHud(snap);
      const ll = terrain.worldToLatLon(tractor.x, tractor.z);
      ui.renderDriveMinimap(
        tractor.x,
        tractor.z,
        tractor.headingRad,
        ll.lat,
        terrain.getAbsoluteElevation(tractor.x, tractor.z),
        tourGame.getCheckpoints(),
        tourGame.activeIndex,
        tourGame.completed,
        terrain.mapSizeM
      );
      renderNow();
    },
    driveFor: (throttle: number, steer: number, seconds: number, handbrake = false) => {
      if (!tractor || !cameraRig || !terrain || !tourGame) return null;
      const fixedDt = 1 / 60;
      const steps = Math.max(1, Math.round(seconds / fixedDt));
      const input: TractorInput = { throttle, steer, handbrake };
      for (let i = 0; i < steps; i++) {
        tractor.step(fixedDt, input, true);
        traffic?.update(fixedDt, camera); // NPC traffic
        pedestrians?.update(fixedDt, camera); // NPC pedestrians
        tourGame.update(fixedDt, tractor.tractorRoot.position, tractor.speedMps, cameraRig.mode === 'chase');
        recreationSystem?.update(fixedDt, tractor.tractorRoot.position, cleanCaptureActive, () => {
          audio.playCheckpointChime(false);
          ui.showToast('TOOOR für den TV 1920 Kindenheim! ⚽');
        });
      }
      cameraRig.snapToCurrentMode();
      const state = tractor.getTelemetry();
      ui.updateTractorHud(state, audio.muted);
      const snap = tourGame.update(0, tractor.tractorRoot.position, tractor.speedMps, cameraRig.mode === 'chase');
      ui.updateTourHud(snap);
      const ll = terrain.worldToLatLon(tractor.x, tractor.z);
      ui.renderDriveMinimap(
        tractor.x,
        tractor.z,
        tractor.headingRad,
        ll.lat,
        terrain.getAbsoluteElevation(tractor.x, tractor.z),
        tourGame.getCheckpoints(),
        tourGame.activeIndex,
        tourGame.completed,
        terrain.mapSizeM
      );
      renderNow();
      return state;
    },
    setTractorOptions: (opts) => {
      if (!tractor) return;
      tractor.setOptions(opts);
      ui.updateTractorHud(tractor.getTelemetry(), audio.muted);
      renderNow();
    },
    getTerrainHeight: (x: number, z: number) => {
      if (!terrain) throw new Error('getTerrainHeight called before terrain was built');
      return terrain.getTerrainHeight(x, z);
    },
    three: { scene, camera, renderer },
    renderNow,
    setSunAngles: (elevationDeg: number, azimuthDeg: number) => {
      lighting.updateSunAngles(elevationDeg, azimuthDeg, true);
      ui.syncSunSliders(lighting.elevationDeg, lighting.azimuthDeg);
      applyTimeOfDayContract();
      renderNow();
    },
    setQuality: (choice: QualityChoice) => {
      const level = applyQuality(choice);
      renderNow();
      return level;
    },
    debug: { lighting, pipeline, renderFrame },
    loadTimings,
    getRenderInfo: () => ({
      qualityChoice,
      qualityLevel: quality.level,
      gpu: getGpuName(renderer),
      pixelRatio: renderer.getPixelRatio(),
      internal: pipeline.internalSize,
      preset: lighting.currentPreset,
      sunElevationDeg: lighting.elevationDeg,
      sunAzimuthDeg: lighting.azimuthDeg,
      nightFactor: lighting.nightFactor,
      sunIntensity: lighting.sunLight.intensity,
      exposure: renderer.toneMappingExposure,
      shadows: lighting.shadows.getDebugInfo(),
      groundRadiance: lighting.groundRadiance.toArray(),
      nightGlowMaterials: nightGlow.size,
      info: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
    }),
    getStatus: () => ({
      ready: true,
      cameraMode: cameraRig?.mode,
      buildingCount: bldgTotal,
      colliderCount: collider.polyCount,
      landmarkCount: buildingRes.landmarkCount,
      villageChunkCount: buildingRes.villageChunkCount,
      roadCount: dataset.scene.roads.length,
      sceneryStats: sceneryRes.stats,
      fieldsStats: fieldsSystem.stats,
      recreationStats: recreationRes.stats,
      referenceCount: allShots.length,
      tractor: tractor?.getTelemetry() ?? null,
      tour: tourGame
        ? {
            activeIndex: tourGame.activeIndex,
            completed: tourGame.completed,
            drivenKm: tourGame.drivenMeters / 1000,
          }
        : null,
      meta: dataset.meta,
    }),
  };

  // 8. Warm-up while the loading overlay is still up, so the first visible frame does not stall:
  //    shader programs compile in parallel, textures go to the GPU in slices, then one hidden frame renders.
  endPhase('assembly');
  // Every GLB is loaded and de-duplicated by now: a name/pixel collision fails inside the loading overlay.
  assertTextureDedupeConsistent();
  ui.setLoadingProgress('scenery', 95, 'Kompiliere Shader…');
  await nextFrame();
  renderer.setRenderTarget(pipeline.sceneRenderTarget);
  await renderer.compileAsync(scene, camera);
  renderer.setRenderTarget(null);
  endPhase('compileShaders');

  const textures = collectSceneTextures(scene);
  for (let i = 0; i < textures.length; ) {
    const sliceStart = performance.now();
    while (i < textures.length && performance.now() - sliceStart < 12) {
      renderer.initTexture(textures[i]);
      i++;
    }
    ui.setLoadingProgress(
      'scenery',
      95 + (i / textures.length) * 4,
      `Lade Texturen in die Grafikkarte… ${i} / ${textures.length}`
    );
    await nextFrame();
  }
  endPhase('uploadTextures');
  // sky LUT, cloud panorama, image-based light and horizon colour: the biggest part of the first frame
  ui.setLoadingProgress('scenery', 99, 'Berechne Himmel, Wolken & Umgebungslicht…');
  await nextFrame();
  lighting.flush();
  endPhase('skyAndEnvironment');
  ui.setLoadingProgress('scenery', 99.5, 'Erstes Bild…');
  await nextFrame();
  renderNow();
  endPhase('firstFrame');

  // NPC pedestrians: window.__KINDENHEIM__.npc.pedestrians (merged with whatever else lives under `npc`)
  {
    const withNpc = debugApi as KindenheimDebugApi & { npc?: Record<string, unknown> };
    withNpc.npc = { ...withNpc.npc, pedestrians: { ...pedestrianSystem.debugApi(), camera } };
  }
  // NPC traffic: window.__KINDENHEIM__.npc.traffic (merged with whatever else lives under `npc`)
  {
    const withNpc = debugApi as KindenheimDebugApi & { npc?: Record<string, unknown> };
    withNpc.npc = { ...withNpc.npc, traffic: trafficSystem.debugApi(camera) };
  }
  window.__KINDENHEIM__ = debugApi;
  ui.hideLoadingOverlay();

  const clock = new THREE.Clock();
  let hudTimer = 0;
  let mapTimer = 0;
  let diffTimer = 0;
  let startupFrames = 0;

  function animate(): void {
    if (contextLost) return;
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    if (startupFrames < 4) loadTimings[`frame${startupFrames++}`] = Math.round(dt * 1000);
    pipeline.reportFrameTime(dt * 1000);

    if (tractor && cameraRig && terrain && tourGame) {
      const input = readDriveInput();
      tractor.step(dt, input, false);
      cameraRig.update(dt);

      fieldsSystem.update(cleanCaptureActive ? 0 : dt);
      recreationSystem?.update(dt, tractor.tractorRoot.position, cleanCaptureActive, () => {
        audio.playCheckpointChime(false);
        ui.showToast('TOOOR für den TV 1920 Kindenheim! ⚽');
      });
      pedestrians?.update(cleanCaptureActive ? 0 : dt, camera); // NPC pedestrians
      traffic?.update(cleanCaptureActive ? 0 : dt, camera); // NPC traffic

      // Synthesized Web Audio Diesel engine update
      audio.updateEngine(tractor.rpmNorm, Math.abs(input.throttle), cameraRig.mode !== 'drone');

      // Weinlese-Tour checkpoint update
      const tourSnap = tourGame.update(
        dt,
        tractor.tractorRoot.position,
        tractor.speedMps,
        !cleanCaptureActive && cameraRig.mode === 'chase'
      );
      if (tourSnap.justReachedName || tourSnap.justCompleted) {
        audio.playCheckpointChime(tourSnap.justCompleted);
        ui.updateTourHud(tourSnap);
      }

      hudTimer += dt;
      if (hudTimer >= 0.06) {
        hudTimer = 0;
        ui.updateTractorHud(tractor.getTelemetry(), audio.muted);
        ui.updateTourHud(tourSnap);
      }

      mapTimer += dt;
      if (mapTimer >= 0.08) {
        mapTimer = 0;
        if (benchmarkOverlay?.active) {
          benchmarkOverlay.updateVisibilityForCamera(camera.position);
          benchmarkOverlay.renderMinimap(camera.position.x, camera.position.z, cameraRig.getLookYawForMap());
        } else if (cameraRig.mode !== 'drone') {
          const ll = terrain.worldToLatLon(tractor.x, tractor.z);
          ui.renderDriveMinimap(
            tractor.x,
            tractor.z,
            tractor.headingRad,
            ll.lat,
            terrain.getAbsoluteElevation(tractor.x, tractor.z),
            tourGame.getCheckpoints(),
            tourGame.activeIndex,
            tourGame.completed,
            terrain.mapSizeM
          );
        }
      }
    }

    renderFrame(dt, false);

    if (ui.isDiffLayoutActive()) {
      diffTimer += dt;
      if (diffTimer >= 0.25) {
        diffTimer = 0;
        ui.renderLiveDiffHeatmap(canvas);
      }
    }
  }

  animate();
}

bootstrap().catch((err: unknown) => {
  // Fail loud: the cause goes to the console AND onto the loading overlay, and nothing keeps running.
  console.error('[Kindenheim 3D] Fatal initialization error:', err);
  showFatal(`Fehler beim Laden: ${err instanceof Error ? err.message : String(err)}`);
});
