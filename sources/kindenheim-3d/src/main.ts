import './style.css';
import * as THREE from 'three';
import { TractorAudio } from './audio';
import { BenchmarkOverlay, type ReferencePoseOverride } from './benchmarkOverlay';
import { loadAllBuildings } from './buildings';
import { buildKindenheimBookmarks, CameraRig } from './camera';
import { BuildingCollider } from './collision';
import { loadAllDatasetMetadata } from './dataLoader';
import { buildAgriculturalFields, type FieldsSystemResult } from './fields';
import { WeinleseTourGame } from './game';
import { LightingSystem } from './lighting';
import { buildRoadNetwork } from './roads';
import { buildSceneryAndProps } from './scenery';
import { TerrainSystem } from './terrain';
import { TractorController, type TractorInput, type TractorTelemetry } from './tractor';
import type { BenchmarkLayout, CameraBookmark, CameraMode, TimeOfDayPreset } from './types';
import { UIController } from './ui';

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
}

declare global {
  interface Window {
    __KINDENHEIM__?: KindenheimDebugApi;
  }
}

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('scene-canvas') as HTMLCanvasElement;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.96;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.22, 9500);

  const lighting = new LightingSystem(scene, renderer);
  const audio = new TractorAudio();

  let bookmarks: CameraBookmark[] = [];
  let terrain: TerrainSystem | null = null;
  let cameraRig: CameraRig | null = null;
  let roadGroup: THREE.Group | null = null;
  let benchmarkOverlay: BenchmarkOverlay | null = null;
  let tractor: TractorController | null = null;
  let tourGame: WeinleseTourGame | null = null;
  let cleanCaptureActive = false;

  // Live driving keyboard state
  const driveKeys = new Set<string>();
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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

    return {
      throttle,
      steer,
      handbrake: driveKeys.has('Space'),
    };
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
      lighting.applyPreset(preset);
      ui.syncSunSliders(lighting.elevationDeg, lighting.azimuthDeg);
      // Automatically switch headlights ON in Abenddämmerung for dramatic glow!
      if (preset === 'dusk' && tractor && !tractor.lightsOn) {
        tractor.setOptions({ lights: true, beacon: true });
      }
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

  // 1. Load metadata, heightmap, OSM scene, Brave reference manifest & Blender manifests
  const dataset = await loadAllDatasetMetadata((stage, pct, text) => {
    ui.setLoadingProgress(stage, pct, text);
  });

  // 2. Build real terrain mesh + orthophoto + close-range detail-splat shader
  terrain = new TerrainSystem(dataset.meta, dataset.heightmap);
  scene.add(terrain.mesh);

  cameraRig = new CameraRig(camera, canvas, terrain);

  ui.setLoadingProgress('orthophoto', 36, 'Lade DOP20-Luftbild & Bodentexturen…');
  await terrain.loadTextures(maxAnisotropy);

  // 3. Build draped roads
  ui.setLoadingProgress('orthophoto', 48, 'Erstelle Straßennetz, Hauptstraße & Feldwege…');
  roadGroup = buildRoadNetwork(dataset.scene.roads, terrain, maxAnisotropy);
  scene.add(roadGroup);

  // 4. Load Blender 3D landmarks, village building chunks & Playable Tractor + Grape Trailer!
  ui.setLoadingProgress('buildings', 56, 'Lade 3D-Gebäude, Wahrzeichen & Pfälzer Traktor…');
  const collider = new BuildingCollider(dataset.scene.buildings, dataset.meta.mapSizeM || 2048);
  tractor = new TractorController(terrain, collider, maxAnisotropy);

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

  // 5. Populate Palatinate vineyards, trees, Ortsschilder, streetlamps, hay bales, barrels & agricultural crop fields
  ui.setLoadingProgress('scenery', 84, 'Pflanze Pfälzer Weinberge, Felder, Bäume & Ortsdetails…');
  const [sceneryRes, fieldsRes] = await Promise.all([
    buildSceneryAndProps(
      dataset.scene,
      dataset.villageManifest,
      buildingRes.landmarks,
      terrain,
      maxAnisotropy,
      dataset.braveRefs?.references
    ),
    buildAgriculturalFields(
      dataset.fieldsLayout,
      dataset.fieldsManifest,
      dataset.scene,
      terrain,
      maxAnisotropy,
      dataset.braveRefs?.references
    ),
  ]);
  scene.add(sceneryRes.group);
  scene.add(fieldsRes.group);
  const fieldsSystem: FieldsSystemResult = fieldsRes;

  // 6. Initialize Pfälzer Weinlese-Tour checkpoints + Reality-vs-3D Benchmark overlay
  ui.setLoadingProgress('scenery', 94, 'Starte Pfälzer Weinlese-Tour & Vergleichs-Modus…');
  tourGame = new WeinleseTourGame(terrain);
  scene.add(tourGame.group);
  scene.add(tourGame.arrowGroup);

  benchmarkOverlay = new BenchmarkOverlay(terrain, dataset.braveRefs?.references ?? [], ui.minimapCanvas);
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
  lighting.updateShadowFocus(cameraRig.getFocusTarget(), cameraRig.getFocusDistance());

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
  window.__KINDENHEIM__ = {
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
      lighting.updateShadowFocus(cameraRig.getFocusTarget(), cameraRig.getFocusDistance());
      benchmarkOverlay?.updateVisibilityForCamera(camera.position);
      renderer.render(scene, camera);
    },
    setReferenceView: (idOrIndex: string | number, instant = true) => {
      if (!benchmarkOverlay) return false;
      const shots = benchmarkOverlay.getShots();
      const idx = typeof idOrIndex === 'number' ? idOrIndex : shots.findIndex((s) => s.ref.id === idOrIndex);
      if (idx < 0 || idx >= shots.length) return false;
      const ok = alignToRefIndex(idx, instant);
      if (ok && cameraRig) {
        lighting.updateShadowFocus(cameraRig.getFocusTarget(), cameraRig.getFocusDistance());
        benchmarkOverlay.updateVisibilityForCamera(camera.position);
        renderer.render(scene, camera);
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
      renderer.render(scene, camera);
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
      if (enabled) {
        lighting.skyMat.uniforms.uCloudTime.value = 12.0;
      }
      renderer.render(scene, camera);
    },
    setReferencePoseOverride: (refId: string, override: ReferencePoseOverride) => {
      if (!benchmarkOverlay) return false;
      const updated = benchmarkOverlay.setPoseOverride(refId, override);
      if (!updated) return false;
      const idx = benchmarkOverlay.getShots().findIndex((s) => s.ref.id === refId);
      if (idx >= 0) alignToRefIndex(idx, true);
      renderer.render(scene, camera);
      return true;
    },
    setCameraMode: (mode: CameraMode) => {
      ui.setActiveCameraMode(mode);
      cameraRig?.setMode(mode);
      if (mode !== 'drone' && benchmarkOverlay?.active) {
        ui.setBenchmarkMode(false);
        benchmarkOverlay.setActive(false);
      }
      if (cameraRig) {
        lighting.updateShadowFocus(cameraRig.getFocusTarget(), cameraRig.getFocusDistance());
      }
      renderer.render(scene, camera);
    },
    setTimeOfDay: (preset: TimeOfDayPreset) => {
      ui.setActiveTimeOfDay(preset);
      lighting.applyPreset(preset);
      ui.syncSunSliders(lighting.elevationDeg, lighting.azimuthDeg);
      renderer.render(scene, camera);
    },
    flyTo: (pos, target, instant = true, fovDeg?: number) => {
      if (!cameraRig) return;
      ui.setActiveCameraMode('drone');
      cameraRig.flyTo(pos, target, instant ? 0 : 0.8, fovDeg);
      lighting.updateShadowFocus(cameraRig.getFocusTarget(), cameraRig.getFocusDistance());
      renderer.render(scene, camera);
    },
    getTractorState: () => (tractor ? tractor.getTelemetry() : null),
    teleportTractor: (x: number, z: number, headingRad: number) => {
      if (!tractor || !cameraRig || !terrain || !tourGame) return;
      tractor.teleport(x, z, headingRad);
      cameraRig.snapToCurrentMode();
      lighting.updateShadowFocus(cameraRig.getFocusTarget(), cameraRig.getFocusDistance());
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
      renderer.render(scene, camera);
    },
    driveFor: (throttle: number, steer: number, seconds: number, handbrake = false) => {
      if (!tractor || !cameraRig || !terrain || !tourGame) return null;
      const fixedDt = 1 / 60;
      const steps = Math.max(1, Math.round(seconds / fixedDt));
      const input: TractorInput = { throttle, steer, handbrake };
      for (let i = 0; i < steps; i++) {
        tractor.step(fixedDt, input, true);
        tourGame.update(fixedDt, tractor.tractorRoot.position, tractor.speedMps, cameraRig.mode === 'chase');
      }
      cameraRig.snapToCurrentMode();
      lighting.updateShadowFocus(cameraRig.getFocusTarget(), cameraRig.getFocusDistance());
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
      renderer.render(scene, camera);
      return state;
    },
    setTractorOptions: (opts) => {
      if (!tractor) return;
      tractor.setOptions(opts);
      ui.updateTractorHud(tractor.getTelemetry(), audio.muted);
      renderer.render(scene, camera);
    },
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

  ui.hideLoadingOverlay();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();
  let hudTimer = 0;
  let mapTimer = 0;
  let diffTimer = 0;

  function animate(): void {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();

    if (tractor && cameraRig && terrain && tourGame) {
      const input = readDriveInput();
      tractor.step(dt, input, false);
      cameraRig.update(dt);

      const focus = cameraRig.getFocusTarget();
      lighting.updateShadowFocus(focus, cameraRig.getFocusDistance());
      lighting.updateClouds(cleanCaptureActive ? 0 : dt, camera.position);
      fieldsSystem.update(cleanCaptureActive ? 0 : dt);

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

    renderer.render(scene, camera);

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

bootstrap().catch((err) => {
  console.error('[Kindenheim 3D] Fatal initialization error:', err);
  const statusEl = document.getElementById('loading-status');
  if (statusEl) {
    statusEl.textContent = `Fehler beim Laden: ${String(err)}`;
  }
});
