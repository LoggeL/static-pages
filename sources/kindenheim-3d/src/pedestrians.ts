/**
 * NPC pedestrians: villagers who walk around Kindenheim (contract: .gfx/NPC_BRIEF.md).
 *
 * - Figures: public/assets/models/people/people.glb (blender/people/build_people.py), 10 villager models + a dog,
 *   LOD0 / LOD1 each, skinned to shared skeletons. Per-instance height, girth and palette colours.
 * - Animation: src/pedestriansAnim.ts bakes walk / idle / chat cycles into a bone-matrix texture; one
 *   InstancedMesh per model and LOD draws every visible villager of that model. The walk phase advances by the
 *   distance actually covered, so the planted foot never slides.
 * - Walking: src/pedestriansGraph.ts (sidewalks, road edges, footpaths, field tracks, crossings, doors, squares).
 * - Interaction: every villager and dog is an ActorBody in src/actors.ts; they keep apart from each other, stop and
 *   step aside for the tractor / cars, cross streets only when the lane is clear and never leave walkable ground.
 * - Time of day: fewer people towards dusk, nobody in the fields at night. Despawn / respawn only out of view.
 */
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { queryActors, registerActor, type ActorBody } from './actors';
import type { BuildingCollider } from './collision';
import {
  AnimBank,
  CHAT_FRAMES,
  CHAT_LOOP_S,
  createPedMaterials,
  IDLE_FRAMES,
  IDLE_LOOP_S,
  packHex,
  Rig,
  WALK_FRAMES,
  type AnimSpec,
  type BoneDef,
  type PedMaterials,
} from './pedestriansAnim';
import { buildWalkGraph, resolveStatic, type Destination, type GatherSpot, type WalkGraph } from './pedestriansGraph';
import { getBridgeDeckSurfaceHeight } from './roads';
import { dedupeModelTextures } from './sharedAssets';
import type { TerrainSystem } from './terrain';
import type { QualityLevel } from './renderQuality';
import type { SceneData, TimeOfDayPreset } from './types';
import { resolveAssetUrl } from './url';

const MANIFEST_URL = 'assets/models/people/manifest.json';
const SLOT_NAMES = ['skin', 'hair', 'top', 'bottom', 'shoes', 'accA', 'accB', 'accC'] as const;

interface ManifestModel {
  name: string;
  label: string;
  sex: 'm' | 'f';
  lod0: string;
  lod1: string;
  triangles: [number, number];
  anim: AnimSpec;
  scale: [number, number];
  palettes: Record<string, string[]>;
  link: Record<string, string>;
  dog: boolean;
  elderly: boolean;
}

interface PeopleManifest {
  version: number;
  glb: string;
  skeleton: BoneDef[];
  dogSkeleton: BoneDef[];
  slotEncoding: { scale: number; dynamicSlots: number };
  models: ManifestModel[];
  dog: Omit<ManifestModel, 'sex' | 'link' | 'dog' | 'elderly' | 'label'> & { name: string };
}

/** Per quality level: population, LOD and shadow distances, leash. */
const QUALITY: Record<QualityLevel, { people: number; groups: number; lod0: number; maxDist: number; shadowDist: number; leash: boolean }> = {
  low: { people: 14, groups: 1, lod0: 11, maxDist: 120, shadowDist: 0, leash: false },
  medium: { people: 24, groups: 2, lod0: 24, maxDist: 170, shadowDist: 22, leash: true },
  high: { people: 34, groups: 3, lod0: 36, maxDist: 220, shadowDist: 32, leash: true },
  ultra: { people: 44, groups: 4, lod0: 52, maxDist: 270, shadowDist: 42, leash: true },
};
const MAX_AGENTS = 64;
const MAX_DOGS = 8;

type AgentState = 'walk' | 'dwell' | 'wait' | 'yield' | 'chat';

interface Dog {
  body: ActorBody;
  x: number;
  z: number;
  y: number;
  heading: number;
  speed: number;
  phase: number;
  idlePhase: number;
  blend: number;
  sniff: boolean;
  scale: number;
  colors: Float32Array;
  visible: boolean;
  dist: number;
}

interface Agent {
  index: number;
  active: boolean;
  model: number;
  scale: number;
  girth: number;
  colors: Float32Array;
  body: ActorBody;
  /** simulated ground position, rendered height, heading */
  x: number;
  z: number;
  y: number;
  heading: number;
  speed: number;
  cruise: number;
  /** distance moved this frame (drives the walk phase) */
  moved: number;
  phase: number;
  idlePhase: number;
  idleChat: boolean;
  blend: number;
  state: AgentState;
  timer: number;
  /** polyline of the current route (x, z pairs) with the graph node at each point (-1 for the start point) */
  route: number[];
  routeNodes: number[];
  /** cumulative distance at each route point */
  routeCum: number[];
  along: number;
  lane: number;
  lateral: number;
  lateralTarget: number;
  dest: Destination | null;
  spot: GatherSpot | null;
  faceHeading: number | null;
  /** step-aside target while yielding to a vehicle */
  yieldX: number;
  yieldZ: number;
  clearFor: number;
  /** seconds without progress while walking / waiting at a kerb (re-plans, never stands forever) */
  stuck: number;
  waited: number;
  /** seconds spent in the walk state at (almost) zero speed - drives the deadlock escalation */
  slowFor: number;
  slowReplanned: boolean;
  /** until this time the villager ignores other villagers (last-resort escape from a jam; counted in stats) */
  ghostUntil: number;
  /** crossings found blocked by a standing vehicle: avoided when routing until `avoidUntil` */
  avoid: Set<number>;
  avoidUntil: number;
  /** index of the route point that starts a crossing we are allowed onto */
  crossingOk: number;
  dog: Dog | null;
  visible: boolean;
  dist: number;
  lastNode: number;
}

interface ModelRuntime {
  def: ManifestModel;
  lod: THREE.InstancedMesh[];
  attrs: { animA: THREE.InstancedBufferAttribute; animB: THREE.InstancedBufferAttribute; colA: THREE.InstancedBufferAttribute; colB: THREE.InstancedBufferAttribute }[];
  rowBase: number;
  stride: number;
  shadowCount: number;
  weight: number;
}

export interface PedestrianSystemDeps {
  scene: THREE.Scene;
  sceneData: SceneData;
  terrain: TerrainSystem;
  roadGroup: THREE.Group;
  collider: BuildingCollider;
  quality: QualityLevel;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
function pick<T>(list: readonly T[]): T {
  if (list.length === 0) throw new Error('[pedestrians] pick from an empty list');
  return list[Math.floor(Math.random() * list.length)];
}
function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function turnTowards(cur: number, target: number, maxStep: number): number {
  const d = wrapAngle(target - cur);
  return wrapAngle(cur + Math.max(-maxStep, Math.min(maxStep, d)));
}

async function fetchJson(url: string): Promise<unknown> {
  const resolved = resolveAssetUrl(url);
  let res: Response;
  try {
    res = await fetch(resolved);
  } catch (err) {
    throw new Error(`[pedestrians] network error while loading ${resolved}: ${(err as Error).message}`);
  }
  if (!res.ok) throw new Error(`[pedestrians] ${resolved} answered HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`[pedestrians] ${resolved} is not valid JSON (starts with "${text.slice(0, 40)}")`);
  }
}

function validateManifest(raw: unknown, url: string): PeopleManifest {
  const m = raw as PeopleManifest;
  if (!m || typeof m !== 'object' || m.version !== 1) throw new Error(`[pedestrians] ${url}: unsupported manifest (version ${String(m?.version)})`);
  if (!m.glb || !Array.isArray(m.models) || m.models.length === 0) throw new Error(`[pedestrians] ${url}: no glb / models`);
  if (!Array.isArray(m.skeleton) || !Array.isArray(m.dogSkeleton)) throw new Error(`[pedestrians] ${url}: skeletons missing`);
  if (m.slotEncoding?.scale !== 15 || m.slotEncoding?.dynamicSlots !== 8) {
    throw new Error(`[pedestrians] ${url}: slot encoding ${JSON.stringify(m.slotEncoding)} does not match the runtime (scale 15, 8 slots)`);
  }
  for (const mod of [...m.models, m.dog]) {
    if (!mod.lod0 || !mod.lod1) throw new Error(`[pedestrians] ${url}: model "${mod.name}" lacks lod0 / lod1 node names`);
    if (!mod.anim || !(mod.anim.stride > 0)) throw new Error(`[pedestrians] ${url}: model "${mod.name}" lacks a gait stride`);
    if (!Array.isArray(mod.scale) || mod.scale.length !== 2) throw new Error(`[pedestrians] ${url}: model "${mod.name}" lacks a scale range`);
    for (const [slot, list] of Object.entries(mod.palettes)) {
      if (!SLOT_NAMES.includes(slot as (typeof SLOT_NAMES)[number])) throw new Error(`[pedestrians] ${url}: model "${mod.name}" palette for unknown slot "${slot}"`);
      if (!Array.isArray(list) || list.length === 0) throw new Error(`[pedestrians] ${url}: model "${mod.name}" has an empty palette for "${slot}"`);
      list.forEach(packHex);
    }
  }
  return m;
}

/**
 * Converts a loaded skinned mesh into the instancing geometry: canonical bone indices, colour slot + shade.
 * Fails loudly when the GLB does not match the manifest skeleton.
 */
function prepareGeometry(mesh: THREE.SkinnedMesh, rig: Rig, label: string): THREE.BufferGeometry {
  const geo = mesh.geometry;
  const need = ['position', 'normal', 'color', 'skinIndex', 'skinWeight'];
  for (const a of need) {
    if (!geo.getAttribute(a)) throw new Error(`[pedestrians] ${label}: GLB mesh "${mesh.name}" has no "${a}" attribute`);
  }
  const skel = mesh.skeleton;
  if (!skel) throw new Error(`[pedestrians] ${label}: GLB mesh "${mesh.name}" is not skinned`);
  const remap = skel.bones.map((b) => rig.idx(b.name));
  // the GLB bind pose must be the manifest skeleton (the bake assumes those bone heads)
  skel.boneInverses.forEach((inv, i) => {
    const head = new THREE.Vector3().setFromMatrixPosition(inv.clone().invert());
    const want = rig.head[remap[i]];
    if (head.distanceTo(want) > 0.01) {
      throw new Error(
        `[pedestrians] ${label}: bone "${skel.bones[i].name}" binds at ${head.toArray().map((v) => v.toFixed(3))} but the manifest says ${want
          .toArray()
          .map((v) => v.toFixed(3))}`
      );
    }
  });
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  const col = geo.getAttribute('color');
  const n = si.count;
  const bones = new Float32Array(n * 4);
  const weights = new Float32Array(n * 4);
  const slot = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    let wsum = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      const b = si.getComponent(i, k);
      bones[i * 4 + k] = w > 0 ? remap[b] : 0;
      weights[i * 4 + k] = w;
      wsum += w;
    }
    if (Math.abs(wsum - 1) > 0.02) throw new Error(`[pedestrians] ${label}: vertex ${i} skin weights sum to ${wsum.toFixed(3)}`);
    const r = col.getX(i) * 15;
    const s = Math.round(r);
    if (Math.abs(r - s) > 0.06 || s < 0 || s > 15) {
      throw new Error(`[pedestrians] ${label}: vertex ${i} colour slot ${r.toFixed(3)} is not an integer (vertex colours were colour-converted?)`);
    }
    slot[i * 2] = s;
    slot[i * 2 + 1] = THREE.MathUtils.clamp(col.getY(i), 0.3, 1);
  }
  const out = new THREE.BufferGeometry();
  out.setIndex(geo.getIndex());
  out.setAttribute('position', geo.getAttribute('position'));
  out.setAttribute('normal', geo.getAttribute('normal'));
  out.setAttribute('pedBones', new THREE.BufferAttribute(bones, 4));
  out.setAttribute('pedWeights', new THREE.BufferAttribute(weights, 4));
  out.setAttribute('pedSlot', new THREE.BufferAttribute(slot, 2));
  out.computeBoundingSphere();
  return out;
}

export class PedestrianSystem {
  public readonly group = new THREE.Group();
  public readonly graph: WalkGraph;
  private readonly deps: PedestrianSystemDeps;
  private readonly bank: AnimBank;
  private readonly materials: PedMaterials;
  private readonly models: ModelRuntime[];
  private readonly dogModel: ModelRuntime;
  private readonly humanRig: Rig;
  private readonly dogRig: Rig;
  private readonly agents: Agent[] = [];
  private readonly dogs: Dog[] = [];
  private readonly leash: THREE.InstancedMesh;
  private readonly surfaceLift: (x: number, z: number) => number;
  private level: QualityLevel;
  private nightFactor = 0;
  private preset: TimeOfDayPreset = 'golden';
  private hidden = false;
  private frozen = false;
  private populationOverride: number | null = null;
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private camX = 0;
  private camZ = 0;
  private camH = 0;
  private hadCamera = false;
  private spawnClock = 0;
  private readonly near: ActorBody[] = [];
  private readonly nodeTmp: number[] = [];
  private cascade0Camera: THREE.Camera | null = null;
  private readonly cpu = { last: 0, avg: 0, max: 0 };
  private readonly groups: { spot: GatherSpot; members: Agent[]; until: number }[] = [];
  /** pedestrian actor body -> the villager it belongs to (a dog's body maps to its walker) */
  private readonly bodyOwner = new Map<ActorBody, { agent: Agent; dog: boolean }>();
  /** deadlock escalations since load: re-plans after 5 s at a standstill, ghost passes after 10 s */
  private readonly jam = { replans: 0, ghosts: 0, despawns: 0 };
  private time = 0;
  private readonly nodeWeight: Float32Array;

  private constructor(
    deps: PedestrianSystemDeps,
    graph: WalkGraph,
    bank: AnimBank,
    materials: PedMaterials,
    models: ModelRuntime[],
    dogModel: ModelRuntime,
    humanRig: Rig,
    dogRig: Rig
  ) {
    this.deps = deps;
    this.graph = graph;
    this.bank = bank;
    this.materials = materials;
    this.models = models;
    this.dogModel = dogModel;
    this.humanRig = humanRig;
    this.dogRig = dogRig;
    this.level = deps.quality;
    const lift = deps.roadGroup.userData.getSurfaceLift as ((x: number, z: number) => number) | undefined;
    if (typeof lift !== 'function') throw new Error('[pedestrians] roadGroup.userData.getSurfaceLift is missing (src/roads.ts)');
    this.surfaceLift = lift;
    this.group.name = 'NPC_Pedestrians';
    for (const m of [...models, dogModel]) for (const mesh of m.lod) this.group.add(mesh);

    // leash: a thin dark cord, one instance per dog
    const leashGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 5, 1, true).translate(0, 0.5, 0);
    const leashMat = new THREE.MeshStandardMaterial({ color: 0x2a1c18, roughness: 0.6, name: 'PedestrianLeash' });
    this.leash = new THREE.InstancedMesh(leashGeo, leashMat, MAX_DOGS);
    this.leash.name = 'NPC_Pedestrians_Leash';
    this.leash.frustumCulled = false;
    this.leash.count = 0;
    this.leash.visible = false;
    this.group.add(this.leash);

    for (let i = 0; i < MAX_DOGS; i++) {
      const body = registerActor({ id: `ped:dog:${i}`, kind: 'pedestrian', x: 0, z: 0, heading: 0, halfLength: 0.38, halfWidth: 0.14, speed: 0, active: false });
      this.dogs.push({ body, x: 0, z: 0, y: 0, heading: 0, speed: 0, phase: 0, idlePhase: 0, blend: 1, sniff: false, scale: 1, colors: new Float32Array(8), visible: false, dist: 0 });
    }
    for (let i = 0; i < MAX_AGENTS; i++) {
      const body = registerActor({ id: `ped:${i}`, kind: 'pedestrian', x: 0, z: 0, heading: 0, halfLength: 0.2, halfWidth: 0.27, speed: 0, active: false });
      this.agents.push({
        index: i,
        active: false,
        model: 0,
        scale: 1,
        girth: 1,
        colors: new Float32Array(8),
        body,
        x: 0,
        z: 0,
        y: 0,
        heading: 0,
        speed: 0,
        cruise: 1.2,
        moved: 0,
        phase: 0,
        idlePhase: 0,
        idleChat: false,
        blend: 1,
        state: 'dwell',
        timer: 0,
        route: [],
        routeNodes: [],
        routeCum: [],
        along: 0,
        lane: 0,
        lateral: 0,
        lateralTarget: 0,
        dest: null,
        spot: null,
        faceHeading: null,
        yieldX: 0,
        yieldZ: 0,
        clearFor: 0,
        stuck: 0,
        waited: 0,
        slowFor: 0,
        slowReplanned: false,
        ghostUntil: 0,
        avoid: new Set<number>(),
        avoidUntil: 0,
        crossingOk: -1,
        dog: null,
        visible: false,
        dist: 0,
        lastNode: -1,
      });
    }
    for (const a of this.agents) this.bodyOwner.set(a.body, { agent: a, dog: false });
    const cascade0 = deps.scene.getObjectByName('KH_SunCascade0') as THREE.DirectionalLight | undefined;
    if (!cascade0 || !cascade0.isDirectionalLight) {
      throw new Error('[pedestrians] the near sun-shadow cascade "KH_SunCascade0" (src/renderShadows.ts) is not in the scene');
    }
    this.cascade0Camera = cascade0.shadow.camera;
    // where villagers turn up: the Hauptstrasse sidewalks and footpaths far more often than field tracks
    this.nodeWeight = new Float32Array(graph.nodes.length);
    graph.nodes.forEach((n, i) => {
      let w = n.field ? 0.25 : 1;
      for (const e of n.edges) {
        const k = graph.edges[e].kind;
        if (k === 'sidewalk') w = Math.max(w, 4);
        else if (k === 'path') w = Math.max(w, 1.5);
      }
      this.nodeWeight[i] = w;
    });
    this.applyQuality();
  }

  public static async create(deps: PedestrianSystemDeps): Promise<PedestrianSystem> {
    const manifest = validateManifest(await fetchJson(MANIFEST_URL), MANIFEST_URL);
    const glbUrl = resolveAssetUrl(`assets/models/people/${manifest.glb}`);
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(resolveAssetUrl('assets/models/village/draco/'));
    loader.setDRACOLoader(draco);
    let gltf;
    try {
      gltf = await loader.loadAsync(glbUrl);
    } catch (err) {
      throw new Error(`[pedestrians] could not load ${glbUrl}: ${(err as Error).message}`);
    } finally {
      draco.dispose();
    }
    dedupeModelTextures(gltf.scene, glbUrl);
    gltf.scene.updateMatrixWorld(true);

    const humanRig = new Rig(manifest.skeleton, 'villager skeleton');
    const dogRig = new Rig(manifest.dogSkeleton, 'dog skeleton');
    const bank = new AnimBank([
      ...manifest.models.map((m) => ({ key: m.name, rig: humanRig, anim: m.anim })),
      { key: 'dog', rig: dogRig, anim: { ...manifest.dog.anim, style: 'dog' as const } },
    ]);
    const materials = createPedMaterials(bank);

    const findMesh = (name: string): THREE.SkinnedMesh => {
      const obj = gltf.scene.getObjectByName(name) as THREE.SkinnedMesh | undefined;
      if (!obj || !obj.isSkinnedMesh) throw new Error(`[pedestrians] ${glbUrl} has no skinned mesh "${name}"`);
      return obj;
    };
    const makeRuntime = (def: ManifestModel, rig: Rig, key: string, weight: number): ModelRuntime => {
      const lod: THREE.InstancedMesh[] = [];
      const attrs: ModelRuntime['attrs'] = [];
      [def.lod0, def.lod1].forEach((nodeName, li) => {
        const geo = prepareGeometry(findMesh(nodeName), rig, `${def.name} LOD${li}`);
        const cap = key === 'dog' ? MAX_DOGS : MAX_AGENTS;
        const mk = (): THREE.InstancedBufferAttribute => new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
        const a = { animA: mk(), animB: mk(), colA: mk(), colB: mk() };
        geo.setAttribute('pedAnimA', a.animA);
        geo.setAttribute('pedAnimB', a.animB);
        geo.setAttribute('pedColA', a.colA);
        geo.setAttribute('pedColB', a.colB);
        const mesh = new THREE.InstancedMesh(geo, materials.color, cap);
        mesh.name = `NPC_Pedestrians_${def.name}_LOD${li}`;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.count = 0;
        mesh.visible = false;
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.customDepthMaterial = materials.depth;
        lod.push(mesh);
        attrs.push(a);
      });
      const set = bank.set(key);
      return { def, lod, attrs, rowBase: set.rowBase, stride: set.stride, shadowCount: 0, weight };
    };
    const weights: Record<string, number> = {
      vintner_bucket: 0.9,
      vintner_overall: 0.8,
      elder_man: 1.2,
      elder_woman: 1.3,
      shopper_woman: 1.2,
      casual_man: 1.0,
      coat_woman: 1.0,
      dog_walker: 0.8,
      young_man: 0.7,
      heavy_man: 0.9,
    };
    const models = manifest.models.map((m) => makeRuntime(m, humanRig, m.name, weights[m.name] ?? 1));
    const dogDef: ManifestModel = { ...manifest.dog, label: 'Hund', sex: 'm', link: {}, dog: false, elderly: false } as ManifestModel;
    const dogModel = makeRuntime(dogDef, dogRig, 'dog', 0);

    const graph = buildWalkGraph({
      roads: deps.sceneData.roads,
      buildings: deps.sceneData.buildings,
      landuse: deps.sceneData.landuse,
      waterways: deps.sceneData.waterways ?? [],
      collider: deps.collider,
      surfaceLift: deps.roadGroup.userData.getSurfaceLift,
    });
    console.info(`[pedestrians] walk graph ${JSON.stringify(graph.stats)}`);
    return new PedestrianSystem(deps, graph, bank, materials, models, dogModel, humanRig, dogRig);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // contracts
  // ---------------------------------------------------------------------------------------------------------------

  public setQuality(level: QualityLevel): void {
    if (!QUALITY[level]) throw new Error(`[pedestrians] unknown quality level "${level}"`);
    this.level = level;
    this.applyQuality();
  }

  private applyQuality(): void {
    const q = QUALITY[this.level];
    for (const m of this.models) m.lod[0].castShadow = q.shadowDist > 0;
    this.dogModel.lod[0].castShadow = q.shadowDist > 0;
    const self = this;
    for (const m of [...this.models, this.dogModel]) {
      const mesh = m.lod[0];
      let saved = 0;
      // shadows: only the near cascade, only the nearest villagers (instances are sorted near-first)
      mesh.onBeforeShadow = function (_r, _o, _c, shadowCamera) {
        saved = mesh.count;
        mesh.count = shadowCamera === self.cascade0Camera ? Math.min(m.shadowCount, saved) : 0;
      };
      mesh.onAfterShadow = function () {
        mesh.count = saved;
      };
    }
  }

  /** Villagers stand in the near shadow cascade: it must be re-rendered every frame (see renderFrame in main.ts). */
  public get castsNearShadows(): boolean {
    if (this.hidden || QUALITY[this.level].shadowDist <= 0) return false;
    for (const m of this.models) if (m.shadowCount > 0) return true;
    return this.dogModel.shadowCount > 0;
  }

  public setTimeOfDay(preset: TimeOfDayPreset, nightFactor: number): void {
    if (!Number.isFinite(nightFactor)) throw new Error(`[pedestrians] setTimeOfDay: invalid nightFactor ${nightFactor}`);
    this.preset = preset;
    this.nightFactor = nightFactor;
  }

  /** Benchmark clean capture: nobody is drawn and nobody blocks the tractor. */
  public setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.group.visible = !hidden;
    this.syncBodies();
  }

  private get night(): boolean {
    return this.nightFactor > 0.6;
  }

  private targetPopulation(): number {
    if (this.populationOverride !== null) return this.populationOverride;
    const base = QUALITY[this.level].people;
    let f = 1 - 0.82 * THREE.MathUtils.smoothstep(this.nightFactor, 0.15, 0.95);
    if (this.preset === 'morning') f *= 0.85;
    return Math.max(2, Math.round(base * f));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // per frame
  // ---------------------------------------------------------------------------------------------------------------

  public update(dt: number, camera: THREE.PerspectiveCamera): void {
    const t0 = performance.now();
    camera.updateMatrixWorld();
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const cx = camera.position.x;
    const cz = camera.position.z;
    const jumped = !this.hadCamera || Math.hypot(cx - this.camX, cz - this.camZ) > 120;
    this.camX = cx;
    this.camZ = cz;
    this.camH = Math.max(0, camera.position.y - this.deps.terrain.getTerrainHeight(THREE.MathUtils.clamp(cx, -1020, 1020), THREE.MathUtils.clamp(cz, -1020, 1020)));
    this.hadCamera = true;

    if (!this.frozen && !this.hidden) {
      const step = Math.min(dt, 0.1);
      this.time += step;
      if (jumped) this.repopulate();
      else this.populate(step);
      for (const a of this.agents) if (a.active) this.updateAgent(a, step);
      this.updateGroups();
    }
    this.syncBodies();
    if (!this.hidden) this.render(camera);
    const ms = performance.now() - t0;
    this.cpu.last = ms;
    this.cpu.avg = this.cpu.avg * 0.95 + ms * 0.05;
    this.cpu.max = Math.max(this.cpu.max * 0.995, ms);
  }

  private spawnRadius(): number {
    return THREE.MathUtils.clamp(170 + this.camH * 0.6, 170, 420);
  }

  private visibleAt(x: number, y: number, z: number): boolean {
    tmpP.set(x, y + 0.9, z);
    const d = Math.hypot(x - this.camX, z - this.camZ);
    if (d > QUALITY[this.level].maxDist + 10) return false;
    return this.frustum.containsPoint(tmpP) || this.frustum.intersectsSphere(new THREE.Sphere(tmpP, 1.2));
  }

  private activeCount(): number {
    let n = 0;
    for (const a of this.agents) if (a.active) n++;
    return n;
  }

  private repopulate(): void {
    for (const g of this.groups) for (const m of g.members) this.despawn(m);
    this.groups.length = 0;
    for (const a of this.agents) if (a.active) this.despawn(a);
    const target = this.targetPopulation();
    this.spawnGroups(true);
    let tries = 0;
    while (this.activeCount() < target && tries++ < target * 6) this.spawnWalker(true);
  }

  private populate(dt: number): void {
    this.spawnClock -= dt;
    const R = this.spawnRadius();
    const night = this.night;
    // despawn: far away, or wrong place at night - only when nobody sees it
    for (const a of this.agents) {
      if (!a.active || a.visible || a.spot) continue;
      const far = a.dist > R + 60;
      const fieldAtNight = night && a.lastNode >= 0 && this.graph.nodes[a.lastNode].field;
      if (far || fieldAtNight) this.despawn(a);
    }
    // nightfall: whoever is still out in the vineyards (or heading there) in plain view walks back to the village
    if (night) {
      for (const a of this.agents) {
        if (!a.active || a.spot || a.state === 'yield') continue;
        if (a.state === 'walk' && a.dest !== null && a.dest.kind === 'door') continue; // already on the way home
        const inField = a.lastNode >= 0 && this.graph.nodes[a.lastNode].field;
        const fieldBound = a.dest !== null && a.dest.kind === 'vineyard';
        if (inField || fieldBound) this.sendHome(a);
      }
    }
    if (this.spawnClock > 0) return;
    this.spawnClock = 0.25;
    const target = this.targetPopulation();
    const active = this.activeCount();
    if (active > target) {
      // too many (evening falls): the farthest unseen walker goes home
      let worst: Agent | null = null;
      for (const a of this.agents) if (a.active && !a.visible && !a.spot && (!worst || a.dist > worst.dist)) worst = a;
      if (worst) this.despawn(worst);
    } else if (active < target) {
      this.spawnWalker(false);
    }
    this.spawnGroups(false);
  }

  private spawnGroups(initial: boolean): void {
    const want = Math.max(0, Math.round(QUALITY[this.level].groups * (1 - 0.7 * THREE.MathUtils.smoothstep(this.nightFactor, 0.2, 0.9))));
    if (this.groups.length >= want || this.populationOverride !== null) return;
    const R = this.spawnRadius();
    const spots = this.graph.spots.filter(
      (s) => !this.groups.some((g) => g.spot === s) && Math.hypot(s.x - this.camX, s.z - this.camZ) < R && (initial || !this.visibleAt(s.x, this.groundY(s.x, s.z), s.z))
    );
    if (spots.length === 0) return;
    const spot = pick(spots);
    const n = Math.random() < 0.5 ? 2 : 3;
    const members: Agent[] = [];
    const a0 = Math.random() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const ang = a0 + (k / n) * Math.PI * 2 + rand(-0.25, 0.25);
      const r = rand(0.65, 0.85);
      const x = spot.x + Math.sin(ang) * r;
      const z = spot.z + Math.cos(ang) * r;
      if (resolveStatic(this.deps.collider, x, z, 0.3).hit) continue;
      if (this.agents.some((m) => m.active && Math.hypot(m.x - x, m.z - z) < 0.75)) continue;
      const agent = this.allocAgent(false);
      if (!agent) break;
      agent.x = x;
      agent.z = z;
      agent.y = this.groundY(x, z);
      agent.heading = Math.atan2(spot.x - x, spot.z - z);
      agent.faceHeading = agent.heading;
      agent.state = 'chat';
      agent.spot = spot;
      agent.idleChat = Math.random() < 0.7;
      agent.idlePhase = Math.random();
      agent.blend = 1;
      agent.lastNode = spot.node;
      members.push(agent);
    }
    if (members.length < 2) {
      for (const m of members) this.despawn(m);
      return;
    }
    this.groups.push({ spot, members, until: this.time + rand(45, 160) });
  }

  private updateGroups(): void {
    for (let i = this.groups.length - 1; i >= 0; i--) {
      const g = this.groups[i];
      g.members = g.members.filter((m) => m.active && m.spot === g.spot);
      if (g.members.length < 2 || this.time > g.until) {
        // the group breaks up: everyone walks off to somewhere
        for (const m of g.members) {
          m.spot = null;
          m.state = 'dwell';
          m.timer = rand(0, 3);
        }
        this.groups.splice(i, 1);
        continue;
      }
      // speakers take turns
      for (const m of g.members) {
        if (Math.random() < 0.004) m.idleChat = !m.idleChat;
      }
    }
  }

  private allocAgent(withDog: boolean): Agent | null {
    const agent = this.agents.find((a) => !a.active);
    if (!agent) return null;
    const candidates = this.models.map((m, i) => ({ m, i })).filter(({ m }) => (withDog ? m.def.dog : !m.def.dog || this.freeDog() !== null));
    let total = 0;
    for (const c of candidates) total += c.m.weight;
    let r = Math.random() * total;
    let modelIdx = candidates[0].i;
    for (const c of candidates) {
      r -= c.m.weight;
      if (r <= 0) {
        modelIdx = c.i;
        break;
      }
    }
    const def = this.models[modelIdx].def;
    agent.model = modelIdx;
    agent.active = true;
    agent.scale = rand(def.scale[0], def.scale[1]);
    agent.girth = rand(0.95, 1.07);
    this.pickColors(def, agent.colors);
    const sp = def.anim.speed ?? [1.1, 1.4];
    agent.cruise = rand(sp[0], sp[1]);
    agent.speed = 0;
    agent.phase = Math.random();
    agent.idlePhase = Math.random();
    agent.idleChat = false;
    agent.blend = 1;
    agent.state = 'dwell';
    agent.timer = 0;
    agent.route.length = 0;
    agent.routeNodes.length = 0;
    agent.routeCum.length = 0;
    agent.along = 0;
    agent.lane = rand(-0.08, 0.22);
    agent.lateral = agent.lane;
    agent.lateralTarget = agent.lane;
    agent.dest = null;
    agent.spot = null;
    agent.faceHeading = null;
    agent.clearFor = 0;
    agent.stuck = 0;
    agent.waited = 0;
    agent.slowFor = 0;
    agent.slowReplanned = false;
    agent.ghostUntil = 0;
    agent.avoid.clear();
    agent.avoidUntil = 0;
    agent.crossingOk = -1;
    agent.visible = false;
    agent.dog = null;
    if (def.dog) {
      const dog = this.freeDog();
      if (dog) {
        agent.dog = dog;
        dog.scale = rand(this.dogModel.def.scale[0], this.dogModel.def.scale[1]);
        this.pickColors(this.dogModel.def, dog.colors);
        dog.phase = Math.random();
        dog.idlePhase = Math.random();
        dog.blend = 1;
        dog.speed = 0;
        dog.sniff = false;
        dog.body.active = true;
      }
    }
    return agent;
  }

  private freeDog(): Dog | null {
    return this.dogs.find((d) => !this.agents.some((a) => a.active && a.dog === d)) ?? null;
  }

  private pickColors(def: ManifestModel, out: Float32Array): void {
    const chosen: Record<string, number> = {};
    SLOT_NAMES.forEach((slot, i) => {
      const linked = def.link?.[slot];
      if (linked !== undefined) return;
      const list = def.palettes[slot] ?? ['#2a2a2a'];
      const idx = Math.floor(Math.random() * list.length);
      chosen[slot] = idx;
      out[i] = packHex(list[idx]);
    });
    SLOT_NAMES.forEach((slot, i) => {
      const linked = def.link?.[slot];
      if (linked === undefined) return;
      const src = SLOT_NAMES.indexOf(linked as (typeof SLOT_NAMES)[number]);
      if (src < 0) throw new Error(`[pedestrians] model "${def.name}" links slot "${slot}" to unknown slot "${linked}"`);
      out[i] = out[src];
    });
  }

  private despawn(a: Agent): void {
    a.active = false;
    a.visible = false;
    a.spot = null;
    if (a.dog) {
      a.dog.body.active = false;
      a.dog.visible = false;
      a.dog = null;
    }
  }

  private groundY(x: number, z: number): number {
    const t = this.deps.terrain;
    let h = t.getRenderedSurfaceHeight(x, z);
    const bridge = getBridgeDeckSurfaceHeight(x, z, t);
    if (bridge !== null && bridge > h) h = bridge;
    return h + this.surfaceLift(x, z);
  }

  /** Spawns one walker somewhere out of view (or anywhere when `anywhere`). */
  private spawnWalker(anywhere: boolean): boolean {
    const R = this.spawnRadius();
    const night = this.night;
    const g = this.graph;
    g.nodesNear(this.camX, this.camZ, R, this.nodeTmp);
    if (this.nodeTmp.length === 0) return false;
    for (let attempt = 0; attempt < 12; attempt++) {
      // best of a few random nodes: favour sidewalks / paths and the camera's surroundings
      let ni = -1;
      let best = -1;
      for (let k = 0; k < 4; k++) {
        const c = this.nodeTmp[Math.floor(Math.random() * this.nodeTmp.length)];
        const cn = g.nodes[c];
        const score = this.nodeWeight[c] * Math.random() / (1 + Math.hypot(cn.x - this.camX, cn.z - this.camZ) / 70);
        if (score > best) {
          best = score;
          ni = c;
        }
      }
      const n = g.nodes[ni];
      if (night && n.field) continue;
      const d = Math.hypot(n.x - this.camX, n.z - this.camZ);
      if (!anywhere && d < 35) continue;
      const y = this.groundY(n.x, n.z);
      if (!anywhere && this.visibleAt(n.x, y, n.z)) continue;
      if (this.agents.some((a) => a.active && Math.hypot(a.x - n.x, a.z - n.z) < 2.5)) continue;
      const wantDog = Math.random() < 0.12 && this.freeDog() !== null;
      const agent = this.allocAgent(wantDog);
      if (!agent) return false;
      agent.x = n.x;
      agent.z = n.z;
      agent.y = y;
      agent.lastNode = ni;
      agent.heading = Math.random() * Math.PI * 2;
      if (!this.planRoute(agent, ni)) {
        this.despawn(agent);
        continue;
      }
      // already walking when it appears
      agent.state = 'walk';
      agent.speed = agent.cruise;
      agent.blend = 0;
      const t = this.routeTangent(agent, 0);
      agent.heading = Math.atan2(t[0], t[1]);
      if (agent.dog) this.placeDog(agent, true);
      return true;
    }
    return false;
  }

  /** Picks a destination and computes the route from graph node `from`. */
  private planRoute(a: Agent, from: number): boolean {
    const g = this.graph;
    const night = this.night;
    const def = this.models[a.model].def;
    for (let attempt = 0; attempt < 6; attempt++) {
      const r = Math.random();
      let candidates: Destination[];
      if (r < 0.42) candidates = g.destinations.filter((d) => d.kind === 'door');
      else if (r < 0.55) candidates = g.destinations.filter((d) => d.kind === 'bakery');
      else if (r < 0.66) candidates = g.destinations.filter((d) => d.kind === 'church' || d.kind === 'rathaus');
      else if (r < 0.74 && !night) candidates = g.destinations.filter((d) => d.kind === 'playground' || d.kind === 'pitch');
      else if (r < 0.84 && !night && !def.elderly) candidates = g.destinations.filter((d) => d.kind === 'vineyard');
      else candidates = [];
      let target: number;
      let dest: Destination | null = null;
      const fromNode = g.nodes[from];
      const reach = def.elderly ? 260 : 420;
      const near = candidates.filter((d) => {
        const n = g.nodes[d.node];
        return Math.hypot(n.x - fromNode.x, n.z - fromNode.z) < reach && d.node !== from;
      });
      if (near.length > 0) {
        dest = pick(near);
        target = dest.node;
      } else {
        // a stroll to some node 60-250 m away
        g.nodesNear(fromNode.x, fromNode.z, 250, this.nodeTmp);
        const far = this.nodeTmp.filter((i) => {
          const n = g.nodes[i];
          return !(night && n.field) && Math.hypot(n.x - fromNode.x, n.z - fromNode.z) > 60;
        });
        if (far.length === 0) continue;
        target = pick(far);
      }
      if (a.avoid.size > 0 && this.time > a.avoidUntil) a.avoid.clear();
      const path = g.findPath(from, target, night, 6000, a.avoid.size > 0 ? a.avoid : undefined);
      if (!path || path.length < 2) continue;
      a.dest = dest;
      this.setRoute(a, path);
      return true;
    }
    return false;
  }

  private setRoute(a: Agent, path: number[]): void {
    const g = this.graph;
    a.route.length = 0;
    a.routeNodes.length = 0;
    a.routeCum.length = 0;
    // start at the agent's own position when it is off the first node
    const first = g.nodes[path[0]];
    if (Math.hypot(first.x - a.x, first.z - a.z) > 0.3) {
      a.route.push(a.x, a.z);
      a.routeNodes.push(-1);
    }
    for (const id of path) {
      const n = g.nodes[id];
      a.route.push(n.x, n.z);
      a.routeNodes.push(id);
    }
    let cum = 0;
    a.routeCum.push(0);
    for (let i = 1; i < a.routeNodes.length; i++) {
      cum += Math.hypot(a.route[i * 2] - a.route[i * 2 - 2], a.route[i * 2 + 1] - a.route[i * 2 - 1]);
      a.routeCum.push(cum);
    }
    a.along = 0;
    a.crossingOk = -1;
    a.lateral = 0;
  }

  private routeIndexAt(a: Agent, along: number): number {
    const cum = a.routeCum;
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < along) i++;
    return i;
  }

  private routePoint(a: Agent, along: number, out: [number, number]): [number, number] {
    const i = this.routeIndexAt(a, along);
    const len = a.routeCum[i + 1] - a.routeCum[i];
    const t = len > 1e-6 ? THREE.MathUtils.clamp((along - a.routeCum[i]) / len, 0, 1) : 0;
    out[0] = a.route[i * 2] + (a.route[i * 2 + 2] - a.route[i * 2]) * t;
    out[1] = a.route[i * 2 + 1] + (a.route[i * 2 + 3] - a.route[i * 2 + 1]) * t;
    return out;
  }

  private routeTangent(a: Agent, along: number): [number, number] {
    const i = this.routeIndexAt(a, along);
    const dx = a.route[i * 2 + 2] - a.route[i * 2];
    const dz = a.route[i * 2 + 3] - a.route[i * 2 + 1];
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  }

  /** Corridor half-width of the route segment at `along` (lateral freedom for passing). */
  private routeLat(a: Agent, along: number): number {
    const i = this.routeIndexAt(a, along);
    const n0 = a.routeNodes[i];
    const n1 = a.routeNodes[i + 1];
    if (n0 < 0 || n1 < 0) return 0.3;
    const e = this.graph.edgeBetween(n0, n1);
    return e >= 0 ? this.graph.edges[e].lat : 0.3;
  }

  private readonly rp: [number, number] = [0, 0];

  // ---------------------------------------------------------------------------------------------------------------
  // agent behaviour
  // ---------------------------------------------------------------------------------------------------------------

  private updateAgent(a: Agent, dt: number): void {
    const def = this.models[a.model].def;
    a.dist = Math.hypot(a.x - this.camX, a.z - this.camZ);
    const threat = this.vehicleThreat(a);
    if (threat && a.state !== 'chat') {
      if (a.state !== 'yield') this.beginYield(a, threat);
      a.clearFor = 0;
    }
    let desiredSpeed = 0;
    switch (a.state) {
      case 'chat': {
        desiredSpeed = 0;
        if (a.faceHeading !== null) a.heading = turnTowards(a.heading, a.faceHeading, dt * 2);
        break;
      }
      case 'yield': {
        if (!threat) a.clearFor += dt;
        a.waited += dt;
        // a vehicle that crawls beside us for ages: carry on (re-checked next frame)
        if (a.waited > 20) a.clearFor = 2;
        // move to the step-aside spot, then wait facing the vehicle
        const dx = a.yieldX - a.x;
        const dz = a.yieldZ - a.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.05) {
          const v = Math.min(1.3, d * 3);
          const s = Math.min(d, v * dt);
          this.tryMove(a, (dx / d) * s, (dz / d) * s);
          desiredSpeed = v;
          a.heading = turnTowards(a.heading, Math.atan2(dx, dz), dt * 5);
        } else if (a.faceHeading !== null) {
          a.heading = turnTowards(a.heading, a.faceHeading, dt * 3);
        }
        if (a.clearFor > 1.6) {
          a.state = a.route.length > 0 && a.along < a.routeCum[a.routeCum.length - 1] ? 'walk' : 'dwell';
          a.faceHeading = null;
          a.timer = 0;
        }
        break;
      }
      case 'dwell': {
        a.timer -= dt;
        if (a.faceHeading !== null) a.heading = turnTowards(a.heading, a.faceHeading, dt * 3);
        if (a.timer <= 0) {
          // at a door nobody watches: the villager goes inside
          if (a.dest && (a.dest.kind === 'door' || a.dest.kind === 'bakery' || a.dest.kind === 'church' || a.dest.kind === 'rathaus') && !a.visible && Math.random() < 0.6) {
            this.despawn(a);
            return;
          }
          const from = a.lastNode >= 0 ? a.lastNode : this.graph.nearestNode(a.x, a.z, 30);
          if (from < 0 || !this.planRoute(a, from)) {
            a.timer = 2;
            break;
          }
          // join a gathering when the walk leads past a spot
          a.state = 'walk';
          a.faceHeading = null;
        }
        break;
      }
      case 'wait': {
        a.timer -= dt;
        a.waited += dt;
        if (a.waited > 40) {
          // the lane never clears (a vehicle parked across the crossing): go somewhere else
          a.waited = 0;
          this.replan(a);
          break;
        }
        if (a.faceHeading !== null) a.heading = turnTowards(a.heading, a.faceHeading, dt * 3);
        if (a.timer <= 0) {
          a.timer = 0.4;
          const idx = this.routeIndexAt(a, a.along + 0.3);
          const cs = this.segmentIsCrossing(a, idx) ? this.crossingState(a, idx) : 'clear';
          if (cs === 'blocked') {
            this.avoidCrossing(a, idx);
            break;
          }
          if (cs === 'clear') {
            a.crossingOk = idx;
            a.waited = 0;
            a.state = 'walk';
            a.faceHeading = null;
          }
        }
        break;
      }
      case 'walk': {
        desiredSpeed = this.walkStep(a, dt);
        if (a.stuck > 6) {
          a.stuck = 0;
          if (!a.visible && a.dist > 25) {
            this.despawn(a);
            return;
          }
          this.replan(a);
        }
        break;
      }
    }
    // deadlock escalation: nobody stands still in the walk state for long
    if (a.active && a.state === 'walk' && a.speed < 0.05) {
      a.slowFor += dt;
      if (a.slowFor > 5 && !a.slowReplanned) {
        a.slowReplanned = true;
        this.jam.replans++;
        this.logJam(a, 'replan');
        this.replan(a);
      } else if (a.slowFor > 10 && this.time >= a.ghostUntil) {
        if (!a.visible && a.dist > 20) {
          // still jammed and nobody looks: the villager goes home
          this.jam.despawns++;
          this.logJam(a, 'despawn');
          this.despawn(a);
          return;
        }
        // still jammed in plain view (a passage too narrow to pass): this one walks through for a moment
        a.ghostUntil = this.time + 4;
        a.slowFor = 5.01;
        a.lateral = 0;
        a.lateralTarget = 0;
        this.jam.ghosts++;
        this.logJam(a, 'ghost');
      }
    } else {
      a.slowFor = 0;
      a.slowReplanned = false;
    }
    if (!a.active) return;
    // speed ramps (no instant starts / stops) and the walk/idle blend follow the motion
    const accel = desiredSpeed > a.speed ? 2.2 : 3.5;
    a.speed += THREE.MathUtils.clamp(desiredSpeed - a.speed, -accel * dt, accel * dt);
    const moving = a.moved > 1e-4 || a.speed > 0.08;
    a.blend = THREE.MathUtils.clamp(a.blend + (moving ? -dt / 0.3 : dt / 0.35), 0, 1);
    // gait phase from the distance actually covered (feet stay planted)
    const stride = this.models[a.model].stride * a.scale;
    a.phase = (a.phase + a.moved / stride) % 1;
    a.idlePhase = (a.idlePhase + dt / (a.idleChat ? CHAT_LOOP_S : IDLE_LOOP_S)) % 1;
    a.moved = 0;
    // ground height with a quick filter (kerb steps read as a step, not a jump)
    const gy = this.groundY(a.x, a.z);
    a.y += (gy - a.y) * Math.min(1, dt * 14);
    if (Math.abs(gy - a.y) > 0.5) a.y = gy;
    a.visible = this.visibleAt(a.x, a.y, a.z);
    if (a.dog) this.updateDog(a, dt);
    void def;
  }

  /** Recent deadlock escalations with what stood around (debug API `jams`). */
  private readonly jamLog: Record<string, unknown>[] = [];
  private logJam(a: Agent, kind: string): void {
    queryActors(a.x, a.z, 2.5, this.near, a.body.id);
    const around = this.near.map((b) => {
      if (b.kind !== 'pedestrian') return { id: b.id, kind: b.kind, speed: +b.speed.toFixed(2), d: +Math.hypot(b.x - a.x, b.z - a.z).toFixed(2) };
      const o = this.ownerOf(b);
      return { id: b.id, dog: o.dog, state: o.agent.state, speed: +b.speed.toFixed(2), d: +Math.hypot(b.x - a.x, b.z - a.z).toFixed(2), heading: +b.heading.toFixed(2) };
    });
    this.jamLog.push({ t: +this.time.toFixed(1), kind, i: a.index, x: +a.x.toFixed(2), z: +a.z.toFixed(2), heading: +a.heading.toFixed(2), stuck: +a.stuck.toFixed(1), around });
    if (this.jamLog.length > 60) this.jamLog.shift();
  }

  /** The villager a pedestrian body belongs to; fails loudly for foreign pedestrian bodies. */
  private ownerOf(b: ActorBody): { agent: Agent; dog: boolean } {
    const own = this.bodyOwner.get(b);
    if (own) return own;
    for (const a of this.agents) {
      if (a.active && a.dog && a.dog.body === b) return { agent: a, dog: true };
    }
    throw new Error(`[pedestrians] pedestrian body "${b.id}" belongs to no active villager or dog of this system`);
  }

  /** Night: route to the nearest house door; field edges may be used to get out of the vineyards. */
  private sendHome(a: Agent): void {
    const from = a.lastNode >= 0 ? a.lastNode : this.graph.nearestNode(a.x, a.z, 30);
    if (from < 0) {
      if (!a.visible) this.despawn(a);
      return;
    }
    const fn = this.graph.nodes[from];
    const doors = this.graph.destinations
      .filter((d) => d.kind === 'door')
      .map((d) => ({ d, dist: Math.hypot(this.graph.nodes[d.node].x - fn.x, this.graph.nodes[d.node].z - fn.z) }))
      .sort((p, q) => p.dist - q.dist)
      .slice(0, 4);
    for (const { d } of doors) {
      const path = this.graph.findPath(from, d.node, false);
      if (!path || path.length < 2) continue;
      a.dest = d;
      this.setRoute(a, path);
      a.state = 'walk';
      a.faceHeading = null;
      return;
    }
    // no way home from here: leave the moment nobody looks
    if (!a.visible) this.despawn(a);
  }

  /** A standing vehicle sits on the crossing ahead: route around it (that crossing is avoided for a minute). */
  private avoidCrossing(a: Agent, k: number): void {
    const e = this.graph.edgeBetween(a.routeNodes[k], a.routeNodes[k + 1]);
    if (e < 0) throw new Error(`[pedestrians] avoidCrossing: route segment ${k} of villager ${a.index} is not a graph edge`);
    a.avoid.add(e);
    a.avoidUntil = this.time + 60;
    a.waited = 0;
    this.replan(a);
  }

  /** A fresh destination from where the villager stands (blocked way, endless wait). */
  private replan(a: Agent): void {
    // whoever re-plans also gives up on joining a group
    a.spot = null;
    const from = this.graph.nearestNode(a.x, a.z, 30);
    if (from >= 0 && this.planRoute(a, from)) {
      a.state = 'walk';
      a.faceHeading = null;
      return;
    }
    a.state = 'dwell';
    a.dest = null;
    a.timer = 3;
  }

  /** Walking along the route; returns the speed it wants. */
  private walkStep(a: Agent, dt: number): number {
    const total = a.routeCum[a.routeCum.length - 1];
    if (a.route.length === 0 || a.along >= total - 0.05) {
      this.arrive(a);
      return 0;
    }
    // joining a group: once at the circle, take the place we are at
    if (a.spot && Math.hypot(a.spot.x - a.x, a.spot.z - a.z) < 1.35) {
      this.arrive(a);
      return 0;
    }
    // the last metre to a spot somebody already stands on: stop here instead of queueing behind them
    if (total - a.along < 1.6) {
      const ex = a.route[a.route.length - 2];
      const ez = a.route[a.route.length - 1];
      queryActors(ex, ez, 0.8, this.near, a.body.id);
      for (const b of this.near) {
        if (b.kind === 'pedestrian' && Math.abs(b.speed) < 0.15 && !(a.dog && b === a.dog.body)) {
          this.arrive(a);
          return 0;
        }
      }
    }
    // a crossing ahead? wait at the kerb until the lane is clear
    const idx = this.routeIndexAt(a, a.along);
    const nextIdx = Math.min(idx + 1, a.routeNodes.length - 2);
    for (const k of [idx, nextIdx]) {
      if (k === a.crossingOk) continue;
      if (!this.segmentIsCrossing(a, k)) continue;
      const startAlong = a.routeCum[k];
      // somebody already waits at this kerb: queue up a little earlier, beside / behind them
      let reach = 1.0;
      if (startAlong - a.along < 2.6) {
        queryActors(a.route[k * 2], a.route[k * 2 + 1], 1.3, this.near, a.body.id);
        for (const b of this.near) {
          if (b.kind === 'pedestrian' && !this.ownerOf(b).dog && this.ownerOf(b).agent.state === 'wait') reach = 2.4;
        }
      }
      if (a.along <= startAlong + 0.2 && startAlong - a.along < reach) {
        const cs = this.crossingState(a, k);
        if (cs === 'clear') {
          a.crossingOk = k;
        } else if (cs === 'blocked') {
          this.avoidCrossing(a, k);
          return 0;
        } else {
          a.state = 'wait';
          a.timer = 0.4;
          const t = this.routeTangent(a, startAlong + 0.1);
          a.faceHeading = Math.atan2(t[0], t[1]);
          return 0;
        }
      }
    }
    // keep apart from other walkers: pass oncoming people on the right, overtake slow ones on the left
    const lat = this.routeLat(a, a.along);
    const tan = this.routeTangent(a, a.along);
    const fx = tan[0];
    const fz = tan[1];
    const rx = -fz;
    const rz = fx;
    let speedCap = a.cruise;
    a.lateralTarget = a.lane;
    let latMin = -lat;
    let latMax = lat;
    const ghost = this.time < a.ghostUntil;
    // Other villagers / dogs. Rules (deadlock-free by construction):
    //  - someone coming towards us (by heading, whatever their speed): both keep right;
    //  - someone ahead going our way and walking at least as fast: follow at their pace;
    //  - anyone else ahead (standing, slower, crossing our path): pass them on the left;
    //  - too close: slow down by distance; never copy the speed of someone who is not walking our way;
    //  - both in each other's way: only the lower-priority villager (higher index) stops, the other creeps on;
    //  - the hard spacing in tryMove() keeps bodies apart, a standstill escalates (re-plan, then ghost pass).
    if (!ghost) {
      queryActors(a.x, a.z, 3.2, this.near, a.body.id);
      for (const b of this.near) {
        if (b.kind !== 'pedestrian' || (a.dog && b === a.dog.body)) continue;
        const owner = this.ownerOf(b);
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const ahead = dx * fx + dz * fz;
        const side = dx * rx + dz * rz;
        const d = Math.hypot(dx, dz);
        if (ahead < -0.2 || ahead > 3.0) continue;
        const bfx = Math.sin(b.heading);
        const bfz = Math.cos(b.heading);
        const align = bfx * fx + bfz * fz;
        const opposing = align < -0.3;
        const otherWalks = !owner.dog && owner.agent.state === 'walk';
        const sameWayMoving = otherWalks && align > 0.5 && b.speed > 0.25;
        const bLat = a.lateral + side;
        if (Math.abs(bLat - a.lateralTarget) < 0.8) {
          if (opposing) {
            a.lateralTarget = Math.max(a.lateralTarget, bLat + 0.8);
            latMax = Math.max(latMax, Math.min(bLat + 0.8, lat + 0.9));
          } else if (!(sameWayMoving && b.speed >= a.cruise * 0.85)) {
            a.lateralTarget = Math.min(a.lateralTarget, bLat - 0.8);
            latMin = Math.min(latMin, Math.max(bLat - 0.8, -lat - 0.9));
          }
        }
        if (ahead > 0.05 && Math.abs(side) < 0.6 && d < 1.6) {
          if (sameWayMoving) {
            speedCap = Math.min(speedCap, Math.max(b.speed, (d - 0.7) * 1.5));
          } else {
            let cap = Math.max(0, (d - 0.65) * 1.2);
            if (otherWalks) {
              // am I in their way too? (from their heading)
              const bAhead = -dx * bfx - dz * bfz;
              const bSide = -dx * bfz + dz * bfx;
              if (bAhead > 0.05 && Math.abs(bSide) < 0.6) cap = a.index > owner.agent.index ? 0 : Math.max(cap, 0.3);
            }
            speedCap = Math.min(speedCap, cap);
          }
        }
      }
    }
    // standing vehicles on the way (parked cars on the road edge, the parked tractor): walk around them
    queryActors(a.x + fx * 3, a.z + fz * 3, 5, this.near, a.body.id);
    for (const b of this.near) {
      if (b.kind === 'pedestrian' || Math.abs(b.speed) > 0.3) continue;
      // the box corners in my path frame
      const bfx = Math.sin(b.heading);
      const bfz = Math.cos(b.heading);
      let aMin = Infinity;
      let aMax = -Infinity;
      let sMin = Infinity;
      let sMax = -Infinity;
      for (const [cu, cv] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        const cx = b.x + bfx * b.halfLength * cu + bfz * b.halfWidth * cv - a.x;
        const cz = b.z + bfz * b.halfLength * cu - bfx * b.halfWidth * cv - a.z;
        const al = cx * fx + cz * fz;
        const sd = cx * rx + cz * rz + a.lateral;
        aMin = Math.min(aMin, al);
        aMax = Math.max(aMax, al);
        sMin = Math.min(sMin, sd);
        sMax = Math.max(sMax, sd);
      }
      if (aMax < -0.3 || aMin > 5) continue;
      if (a.lateralTarget > sMin - 0.45 && a.lateralTarget < sMax + 0.45) {
        // pass on the side that needs the smaller detour
        const left = sMin - 0.5;
        const right = sMax + 0.5;
        if (Math.abs(right - a.lateral) <= Math.abs(left - a.lateral)) {
          a.lateralTarget = right;
          latMax = Math.max(latMax, right);
        } else {
          a.lateralTarget = left;
          latMin = Math.min(latMin, left);
        }
      }
    }
    a.lateralTarget = THREE.MathUtils.clamp(a.lateralTarget, Math.max(latMin, -3.5), Math.min(latMax, 3.5));
    a.lateral += THREE.MathUtils.clamp(a.lateralTarget - a.lateral, -0.8 * dt, 0.8 * dt);
    const v = Math.min(a.speed + 2.2 * dt, speedCap);
    // advance along the route and follow the (offset) route point
    const nextAlong = Math.min(total, a.along + Math.max(0, v) * dt);
    const p = this.routePoint(a, nextAlong + 0.6, this.rp);
    const t2 = this.routeTangent(a, nextAlong + 0.6);
    const tx = p[0] + -t2[1] * a.lateral;
    const tz = p[1] + t2[0] * a.lateral;
    let mx = tx - a.x;
    let mz = tz - a.z;
    const md = Math.hypot(mx, mz);
    const stepLen = Math.max(0, v) * dt;
    let fwdX = 0;
    let fwdZ = 0;
    if (md > 1e-5) {
      const sl = Math.min(md, stepLen * (md > 0.9 ? 1.15 : 1));
      fwdX = (mx / md) * sl;
      fwdZ = (mz / md) * sl;
    }
    // stepping aside works at a standstill too (the carrot only steers while moving)
    let sideX = 0;
    let sideZ = 0;
    if (v < 0.5) {
      const q = this.routePoint(a, a.along, this.rp);
      const tq = this.routeTangent(a, a.along);
      const latNow = (a.x - q[0]) * -tq[1] + (a.z - q[1]) * tq[0];
      const corr = THREE.MathUtils.clamp(a.lateral - latNow, -0.7 * dt, 0.7 * dt);
      sideX = -tq[1] * corr;
      sideZ = tq[0] * corr;
    }
    // last try: straight back towards the route's centre line (an offset that rubs along a wall)
    const qc = this.routePoint(a, nextAlong, this.rp);
    let cx2 = qc[0] - a.x;
    let cz2 = qc[1] - a.z;
    const cl = Math.hypot(cx2, cz2);
    if (cl > 1e-5) {
      const sl = Math.min(cl, Math.max(stepLen, 0.5 * dt));
      cx2 = (cx2 / cl) * sl;
      cz2 = (cz2 / cl) * sl;
    }
    const tries: [number, number, boolean][] = [
      [fwdX + sideX, fwdZ + sideZ, true],
      [sideX, sideZ, false],
      [fwdX, fwdZ, true],
      [cx2, cz2, false],
    ];
    let movedOk = false;
    let advanced = false;
    for (const [tx2, tz2, fwd] of tries) {
      if (Math.hypot(tx2, tz2) < 1e-6) continue;
      if (this.tryMove(a, tx2, tz2, !ghost)) {
        movedOk = true;
        advanced = fwd;
        const fl = Math.hypot(fwdX, fwdZ);
        if (fwd && fl > 0.5 * dt * 0.1 && md > 0.05) a.heading = turnTowards(a.heading, Math.atan2(fwdX, fwdZ), dt * 4.5);
        break;
      }
    }
    if (movedOk) {
      if (advanced) a.along = nextAlong;
      a.stuck = Math.max(0, a.stuck - dt);
    } else if (stepLen > 1e-6) {
      // blocked by a vehicle body, a wall or a villager: wait a moment (escalates in updateAgent)
      a.stuck += dt;
      return 0;
    } else if (md <= 1e-5) {
      a.along = nextAlong;
    }
    const ri = this.routeIndexAt(a, a.along);
    const node = a.routeNodes[Math.min(ri + 1, a.routeNodes.length - 1)];
    if (node >= 0 && a.along >= a.routeCum[Math.min(ri + 1, a.routeCum.length - 1)] - 0.6) a.lastNode = node;
    else if (a.routeNodes[ri] >= 0) a.lastNode = a.routeNodes[ri];
    return v;
  }

  private segmentIsCrossing(a: Agent, k: number): boolean {
    const n0 = a.routeNodes[k];
    const n1 = a.routeNodes[k + 1];
    if (n0 === undefined || n1 === undefined || n0 < 0 || n1 < 0) return false;
    const e = this.graph.edgeBetween(n0, n1);
    return e >= 0 && this.graph.edges[e].crossing;
  }

  /** No vehicle near the crossing, none that would get there before we are across. */
  /**
   * 'clear', 'traffic' (a vehicle is coming - wait at the kerb) or 'blocked' (a standing vehicle sits on the crossing -
   * waiting would be endless, take another way).
   */
  private crossingState(a: Agent, k: number): 'clear' | 'traffic' | 'blocked' {
    const ax = a.route[k * 2];
    const az = a.route[k * 2 + 1];
    const bx = a.route[k * 2 + 2];
    const bz = a.route[k * 2 + 3];
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const len = Math.hypot(bx - ax, bz - az);
    const crossT = len / Math.max(a.cruise, 0.8) + 2.5;
    queryActors(mx, mz, 45, this.near);
    for (const b of this.near) {
      if (b.kind === 'pedestrian') continue;
      const sp = Math.abs(b.speed);
      if (sp < 0.3) {
        // standing: only in the way when the crossing line runs into its box
        for (let s = 0; s <= 8; s++) {
          if (insideBox(b, ax + ((bx - ax) * s) / 8, az + ((bz - az) * s) / 8, 0.6)) return 'blocked';
        }
        continue;
      }
      // moving and already at the crossing
      if (Math.hypot(b.x - mx, b.z - mz) < len / 2 + Math.hypot(b.halfLength, b.halfWidth) + 2.5) return 'traffic';
      const dirSign = b.speed >= 0 ? 1 : -1;
      const fx = Math.sin(b.heading) * dirSign;
      const fz = Math.cos(b.heading) * dirSign;
      const toX = mx - b.x;
      const toZ = mz - b.z;
      const along = toX * fx + toZ * fz;
      if (along < -b.halfLength) continue;
      const lateral = Math.abs(toX * fz - toZ * fx);
      if (lateral > len / 2 + b.halfWidth + 3) continue;
      if ((along - b.halfLength) / sp < crossT) return 'traffic';
    }
    return 'clear';
  }

  private arrive(a: Agent): void {
    const dest = a.dest;
    a.state = 'dwell';
    a.route.length = 0;
    a.routeNodes.length = 0;
    a.routeCum.length = 0;
    if (dest) {
      a.faceHeading = dest.facing;
      a.lastNode = dest.node;
      const long = dest.kind === 'playground' || dest.kind === 'pitch' || dest.kind === 'vineyard';
      a.timer = long ? rand(12, 40) : rand(3, 9);
      a.idleChat = long && Math.random() < 0.3;
    } else {
      a.faceHeading = null;
      a.timer = rand(0.5, 4);
    }
    if (a.spot) {
      // reached the gathering: chat facing its centre
      a.state = 'chat';
      a.faceHeading = Math.atan2(a.spot.x - a.x, a.spot.z - a.z);
      a.idleChat = Math.random() < 0.6;
      return;
    }
    // a gathering nearby with a free place in the circle: join in
    for (const g of this.groups) {
      if (g.members.length >= 4) continue;
      if (Math.hypot(g.spot.x - a.x, g.spot.z - a.z) > 14) continue;
      if (Math.random() > 0.5) continue;
      const path = this.graph.findPath(a.lastNode >= 0 ? a.lastNode : g.spot.node, g.spot.node, this.night);
      if (!path || path.length < 2) continue;
      // walk up to the network node the spot hangs off, then straight to a free place in the circle
      path.pop();
      const last = this.graph.nodes[path[path.length - 1]];
      const slot = this.freeSlot(g.spot, g.members, last.x, last.z);
      if (!slot) continue;
      this.setRoute(a, path);
      const lx = a.route[a.route.length - 2];
      const lz = a.route[a.route.length - 1];
      a.route.push(slot[0], slot[1]);
      a.routeNodes.push(-1);
      a.routeCum.push(a.routeCum[a.routeCum.length - 1] + Math.hypot(slot[0] - lx, slot[1] - lz));
      a.state = 'walk';
      a.dest = null;
      a.spot = g.spot;
      g.members.push(a);
      return;
    }
  }

  /** A free place (0.95 m from the centre, nobody within 0.8 m) in a group's circle, nearest to (fromX, fromZ). */
  private freeSlot(spot: GatherSpot, members: Agent[], fromX: number, fromZ: number): [number, number] | null {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * Math.PI * 2;
      const x = spot.x + Math.sin(ang) * 0.95;
      const z = spot.z + Math.cos(ang) * 0.95;
      if (members.some((m) => m.active && Math.hypot(m.x - x, m.z - z) < 0.8)) continue;
      if (this.agents.some((m) => m.active && Math.hypot(m.x - x, m.z - z) < 0.7)) continue;
      if (resolveStatic(this.deps.collider, x, z, 0.3).hit) continue;
      const d = Math.hypot(x - fromX, z - fromZ);
      if (d < bestD) {
        bestD = d;
        best = [x, z];
      }
    }
    return best;
  }

  /**
   * Moves by (dx, dz) unless that walks into a wall, a ditch or a vehicle. Small wall contacts slide along.
   */
  private tryMove(a: Agent, dx: number, dz: number, spacing = true): boolean {
    const nx = a.x + dx;
    const nz = a.z + dz;
    // other villagers / dogs: never closer than a body width (moving away is always allowed)
    if (spacing) {
      queryActors(nx, nz, 0.8, this.near, a.body.id);
      for (const b of this.near) {
        if (b.kind !== 'pedestrian' || (a.dog && b === a.dog.body)) continue;
        const min = this.ownerOf(b).dog ? 0.42 : 0.55;
        const dNew = Math.hypot(b.x - nx, b.z - nz);
        if (dNew < min && dNew < Math.hypot(b.x - a.x, b.z - a.z)) return false;
      }
    }
    // vehicles (never walk into a car or the tractor)
    queryActors(nx, nz, 1.2, this.near, a.body.id);
    for (const b of this.near) {
      if (b.kind === 'pedestrian') continue;
      if (insideBox(b, nx, nz, 0.45)) {
        if (!insideBox(b, a.x, a.z, 0.45)) return false;
        // already overlapping (a vehicle pushed into us): only allow moves that leave the box
        if (boxDistance(b, nx, nz) <= boxDistance(b, a.x, a.z)) return false;
      }
    }
    const hit = resolveStatic(this.deps.collider, nx, nz, 0.25);
    if (hit.hit) {
      const px = nx + hit.pushX;
      const pz = nz + hit.pushZ;
      if (Math.hypot(hit.pushX, hit.pushZ) > 0.3) return false;
      a.moved += Math.hypot(px - a.x, pz - a.z);
      a.x = px;
      a.z = pz;
      return true;
    }
    a.moved += Math.hypot(dx, dz);
    a.x = nx;
    a.z = nz;
    return true;
  }

  /** A vehicle about to pass through where we stand / walk. */
  private vehicleThreat(a: Agent): ActorBody | null {
    queryActors(a.x, a.z, 16, this.near, a.body.id);
    let worst: ActorBody | null = null;
    let worstT = Infinity;
    for (const b of this.near) {
      if (b.kind === 'pedestrian') continue;
      // a standing vehicle is an obstacle (walked around), not a threat
      if (Math.abs(b.speed) < 0.3) continue;
      const fx = Math.sin(b.heading);
      const fz = Math.cos(b.heading);
      const dx = a.x - b.x;
      const dz = a.z - b.z;
      const along = dx * fx + dz * fz;
      const side = Math.abs(dx * fz - dz * fx);
      // closer than ~1.3 m of clearance to a passing vehicle: stop and make room
      if (side > b.halfWidth + 1.55) continue;
      const sp = b.speed;
      const close = Math.abs(along) < b.halfLength + 1.0;
      let t: number;
      if (close) t = 0;
      else if (sp > 0.25 && along > 0) t = (along - b.halfLength) / sp;
      else if (sp < -0.25 && along < 0) t = (-along - b.halfLength) / -sp;
      else continue;
      if (t < 3.2 && t < worstT) {
        worstT = t;
        worst = b;
      }
    }
    return worst;
  }

  private beginYield(a: Agent, v: ActorBody): void {
    a.state = 'yield';
    a.waited = 0;
    a.clearFor = 0;
    const fx = Math.sin(v.heading);
    const fz = Math.cos(v.heading);
    // which side of the vehicle's path are we on
    const dx = a.x - v.x;
    const dz = a.z - v.z;
    const sideSign = dx * fz - dz * fx >= 0 ? 1 : -1;
    const perpX = fz * sideSign;
    const perpZ = -fx * sideSign;
    const sideNow = Math.abs(dx * fz - dz * fx);
    const need = Math.max(0, v.halfWidth + 1.6 - sideNow);
    const candidates: [number, number][] = [];
    const node = a.lastNode >= 0 ? this.graph.nodes[a.lastNode] : null;
    if (node && node.room > 0 && node.awayX * perpX + node.awayZ * perpZ > 0.3) {
      const s = Math.min(Math.max(need, 0.4), node.room + 0.4);
      candidates.push([a.x + node.awayX * s, a.z + node.awayZ * s]);
    }
    for (const s of [need, need * 0.6, 0.5]) candidates.push([a.x + perpX * Math.max(s, 0.35), a.z + perpZ * Math.max(s, 0.35)]);
    a.yieldX = a.x;
    a.yieldZ = a.z;
    for (const [x, z] of candidates) {
      if (resolveStatic(this.deps.collider, x, z, 0.28).hit) continue;
      if (insideBox(v, x, z, 0.6)) continue;
      a.yieldX = x;
      a.yieldZ = z;
      break;
    }
    a.faceHeading = Math.atan2(v.x - a.yieldX, v.z - a.yieldZ);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // dog
  // ---------------------------------------------------------------------------------------------------------------

  /** Where the dog wants to be: on the walker's left (leash hand), else right, else heeling behind - never in a wall. */
  private dogSpot(a: Agent, ahead: number, out: [number, number]): [number, number] {
    const fx = Math.sin(a.heading);
    const fz = Math.cos(a.heading);
    // left of the walker = -right = (fz, -fx)
    const cands: [number, number][] = [
      [a.x + fz * 0.75 + fx * ahead, a.z - fx * 0.75 + fz * ahead],
      [a.x - fz * 0.75 + fx * ahead, a.z + fx * 0.75 + fz * ahead],
      [a.x - fx * 0.85, a.z - fz * 0.85],
    ];
    for (const [x, z] of cands) {
      if (!resolveStatic(this.deps.collider, x, z, 0.25).hit) {
        out[0] = x;
        out[1] = z;
        return out;
      }
    }
    // squeezed in (narrow alley): right at the walker's heels
    out[0] = a.x - fx * 0.45;
    out[1] = a.z - fz * 0.45;
    return out;
  }

  private readonly dogTmp: [number, number] = [0, 0];

  private placeDog(a: Agent, snap: boolean): void {
    const dog = a.dog!;
    if (!snap) return;
    const [tx, tz] = this.dogSpot(a, 0.55, this.dogTmp);
    dog.x = tx;
    dog.z = tz;
    dog.heading = a.heading;
    dog.y = this.groundY(tx, tz);
  }

  private updateDog(a: Agent, dt: number): void {
    const dog = a.dog!;
    const walking = a.speed > 0.15;
    const ahead = walking ? 0.6 : 0.2;
    const [tx, tz] = this.dogSpot(a, ahead, this.dogTmp);
    const dx = tx - dog.x;
    const dz = tz - dog.z;
    const d = Math.hypot(dx, dz);
    const want = d < 0.12 ? 0 : Math.min(a.speed * 1.25 + 0.4, d * 2.2);
    dog.speed += THREE.MathUtils.clamp(want - dog.speed, -4 * dt, 3 * dt);
    let moved = 0;
    if (d > 1e-4 && dog.speed > 0.01) {
      const s = Math.min(d, dog.speed * dt);
      let nx = dog.x + (dx / d) * s;
      let nz = dog.z + (dz / d) * s;
      const hit = resolveStatic(this.deps.collider, nx, nz, 0.2);
      if (hit.hit) {
        nx += hit.pushX;
        nz += hit.pushZ;
      }
      let blocked = false;
      queryActors(nx, nz, 1.2, this.near, dog.body.id);
      for (const b of this.near) if (b.kind !== 'pedestrian' && insideBox(b, nx, nz, 0.35)) blocked = true;
      if (!blocked) {
        moved = Math.hypot(nx - dog.x, nz - dog.z);
        dog.x = nx;
        dog.z = nz;
        if (moved > 0.002) dog.heading = turnTowards(dog.heading, Math.atan2(dx, dz), dt * 6);
      }
    }
    if (moved < 0.002) dog.heading = turnTowards(dog.heading, a.heading, dt * 1.5);
    if (d > 6) this.placeDog(a, true);
    dog.phase = (dog.phase + moved / (this.dogModel.stride * dog.scale)) % 1;
    dog.blend = THREE.MathUtils.clamp(dog.blend + (moved > 0.002 ? -dt / 0.25 : dt / 0.35), 0, 1);
    if (dog.blend > 0.99 && Math.random() < dt * 0.15) dog.sniff = !dog.sniff;
    dog.idlePhase = (dog.idlePhase + dt / (dog.sniff ? CHAT_LOOP_S : IDLE_LOOP_S)) % 1;
    const gy = this.groundY(dog.x, dog.z);
    dog.y += (gy - dog.y) * Math.min(1, dt * 14);
    if (Math.abs(gy - dog.y) > 0.5) dog.y = gy;
    dog.dist = Math.hypot(dog.x - this.camX, dog.z - this.camZ);
    dog.visible = this.visibleAt(dog.x, dog.y, dog.z);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // actors + rendering
  // ---------------------------------------------------------------------------------------------------------------

  private syncBodies(): void {
    for (const a of this.agents) {
      const b = a.body;
      b.active = a.active && !this.hidden;
      b.x = a.x;
      b.z = a.z;
      b.heading = a.heading;
      b.speed = a.speed;
      if (a.dog) {
        const d = a.dog.body;
        d.active = a.active && !this.hidden;
        d.x = a.dog.x;
        d.z = a.dog.z;
        d.heading = a.dog.heading;
        d.speed = a.dog.speed;
      }
    }
    for (const d of this.dogs) if (!this.agents.some((a) => a.active && a.dog === d)) d.body.active = false;
  }

  private readonly lists: { agent: Agent | Dog; d: number }[][][] = [];

  private render(camera: THREE.PerspectiveCamera): void {
    void camera;
    const q = QUALITY[this.level];
    const all = [...this.models, this.dogModel];
    while (this.lists.length < all.length) this.lists.push([[], []]);
    for (const l of this.lists) {
      l[0].length = 0;
      l[1].length = 0;
    }
    const dogIdx = all.length - 1;
    for (const a of this.agents) {
      if (!a.active) continue;
      if (a.visible && a.dist < q.maxDist) this.lists[a.model][a.dist < q.lod0 ? 0 : 1].push({ agent: a, d: a.dist });
      const dog = a.dog;
      if (dog && dog.visible && dog.dist < q.maxDist * 0.8) this.lists[dogIdx][dog.dist < q.lod0 ? 0 : 1].push({ agent: dog, d: dog.dist });
    }
    all.forEach((m, mi) => {
      for (let li = 0; li < 2; li++) {
        const list = this.lists[mi][li];
        const mesh = m.lod[li];
        if (li === 0) list.sort((p, r) => p.d - r.d);
        const at = m.attrs[li];
        let shadow = 0;
        list.forEach((entry, k) => {
          const isDog = mi === dogIdx;
          const it = entry.agent;
          if (li === 0 && entry.d < q.shadowDist) shadow = k + 1;
          let scale: number;
          let girth: number;
          let phase: number;
          let idlePhase: number;
          let chat: boolean;
          let blend: number;
          if (isDog) {
            const dg = it as Dog;
            scale = dg.scale;
            girth = 1;
            phase = dg.phase;
            idlePhase = dg.idlePhase;
            chat = dg.sniff;
            blend = dg.blend;
          } else {
            const ag = it as Agent;
            scale = ag.scale;
            girth = ag.girth;
            phase = ag.phase;
            idlePhase = ag.idlePhase;
            chat = ag.idleChat;
            blend = ag.blend;
          }
          tmpQ.setFromAxisAngle(UP, it.heading);
          tmpS.set(scale * girth, scale, scale * girth);
          tmpP.set(it.x, it.y, it.z);
          tmpM.compose(tmpP, tmpQ, tmpS);
          mesh.setMatrixAt(k, tmpM);
          const wf = phase * WALK_FRAMES;
          const w0 = Math.floor(wf) % WALK_FRAMES;
          const idleFrames = chat ? CHAT_FRAMES : IDLE_FRAMES;
          const idleOff = chat ? WALK_FRAMES + IDLE_FRAMES : WALK_FRAMES;
          const f = idlePhase * idleFrames;
          const i0 = Math.floor(f) % idleFrames;
          at.animA.setXYZW(k, m.rowBase + w0, m.rowBase + ((w0 + 1) % WALK_FRAMES), wf - Math.floor(wf), blend);
          at.animB.setXYZW(k, m.rowBase + idleOff + i0, m.rowBase + idleOff + ((i0 + 1) % idleFrames), f - Math.floor(f), 0);
          const c = it.colors;
          at.colA.setXYZW(k, c[0], c[1], c[2], c[3]);
          at.colB.setXYZW(k, c[4], c[5], c[6], c[7]);
        });
        mesh.count = list.length;
        mesh.visible = list.length > 0;
        if (li === 0) m.shadowCount = shadow;
        if (list.length > 0) {
          mesh.instanceMatrix.needsUpdate = true;
          at.animA.needsUpdate = true;
          at.animB.needsUpdate = true;
          at.colA.needsUpdate = true;
          at.colB.needsUpdate = true;
        }
      }
    });
    this.renderLeashes(q.leash);
  }

  private readonly handRest = new THREE.Vector3();
  private readonly collarRest = new THREE.Vector3(0, 0.615, 0.315);

  private renderLeashes(enabled: boolean): void {
    let k = 0;
    if (enabled) {
      const handBone = this.humanRig.idx('hand_L');
      const neckBone = this.dogRig.idx('d_neck');
      this.handRest.copy(this.humanRig.head[handBone]).add(tmpV.set(-0.004, -0.085, 0.012));
      for (const a of this.agents) {
        if (!a.active || !a.dog || !a.visible || a.dist > 60 || k >= MAX_DOGS) continue;
        const m = this.models[a.model];
        const hand = this.animPoint(m, a.phase, a.idlePhase, a.idleChat, a.blend, handBone, this.handRest, tmpP);
        hand.multiply(tmpS.set(a.scale * a.girth, a.scale, a.scale * a.girth)).applyAxisAngle(UP, a.heading).add(tmpV.set(a.x, a.y, a.z));
        const handW = hand.clone();
        const dg = a.dog;
        const collar = this.animPoint(this.dogModel, dg.phase, dg.idlePhase, dg.sniff, dg.blend, neckBone, this.collarRest, tmpP);
        collar.multiplyScalar(dg.scale).applyAxisAngle(UP, dg.heading).add(tmpV.set(dg.x, dg.y, dg.z));
        const dir = tmpV.subVectors(collar, handW);
        const len = dir.length();
        if (len < 0.05) continue;
        tmpQ.setFromUnitVectors(UP, dir.multiplyScalar(1 / len));
        tmpM.compose(handW, tmpQ, tmpS.set(1, len, 1));
        this.leash.setMatrixAt(k++, tmpM);
      }
    }
    this.leash.count = k;
    this.leash.visible = k > 0;
    if (k > 0) this.leash.instanceMatrix.needsUpdate = true;
  }

  private animPoint(m: ModelRuntime, phase: number, idlePhase: number, chat: boolean, blend: number, bone: number, rest: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const wf = phase * WALK_FRAMES;
    const w0 = Math.floor(wf) % WALK_FRAMES;
    const idleFrames = chat ? CHAT_FRAMES : IDLE_FRAMES;
    const idleOff = chat ? WALK_FRAMES + IDLE_FRAMES : WALK_FRAMES;
    const f = idlePhase * idleFrames;
    const i0 = Math.floor(f) % idleFrames;
    return this.bank.transformPoint(
      bone,
      m.rowBase + w0,
      m.rowBase + ((w0 + 1) % WALK_FRAMES),
      wf - Math.floor(wf),
      m.rowBase + idleOff + i0,
      m.rowBase + idleOff + ((i0 + 1) % idleFrames),
      f - Math.floor(f),
      blend,
      rest,
      out
    );
  }

  public dispose(): void {
    for (const a of this.agents) a.body.active = false;
    for (const d of this.dogs) d.body.active = false;
    for (const m of [...this.models, this.dogModel]) for (const mesh of m.lod) mesh.geometry.dispose();
    this.materials.color.dispose();
    this.materials.depth.dispose();
    this.leash.geometry.dispose();
    (this.leash.material as THREE.Material).dispose();
    this.group.removeFromParent();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // debug API (window.__KINDENHEIM__.npc.pedestrians)
  // ---------------------------------------------------------------------------------------------------------------

  public debugApi(): Record<string, unknown> {
    return {
      counts: () => {
        const states: Record<string, number> = {};
        let dogs = 0;
        for (const a of this.agents) {
          if (!a.active) continue;
          states[a.state] = (states[a.state] ?? 0) + 1;
          if (a.dog) dogs++;
        }
        let drawCalls = 0;
        let triangles = 0;
        for (const m of [...this.models, this.dogModel]) {
          m.lod.forEach((mesh, li) => {
            if (!mesh.visible) return;
            drawCalls++;
            triangles += m.def.triangles[li] * mesh.count;
          });
        }
        return {
          active: this.activeCount(),
          target: this.targetPopulation(),
          visible: this.agents.filter((a) => a.active && a.visible).length,
          groups: this.groups.length,
          dogs,
          states,
          drawCalls,
          triangles,
          leashes: this.leash.count,
          quality: this.level,
          jam: { ...this.jam },
          cpuMs: { last: +this.cpu.last.toFixed(3), avg: +this.cpu.avg.toFixed(3), max: +this.cpu.max.toFixed(3) },
          graph: this.graph.stats,
        };
      },
      jams: () => [...this.jamLog],
      freeze: () => {
        this.frozen = true;
      },
      unfreeze: () => {
        this.frozen = false;
      },
      /** Fixed-step simulation (seconds), e.g. to advance a scene between screenshots deterministically. */
      step: (seconds: number, camera: THREE.PerspectiveCamera) => {
        const wasFrozen = this.frozen;
        this.frozen = false;
        const n = Math.max(1, Math.round(seconds * 30));
        for (let i = 0; i < n; i++) this.update(1 / 30, camera);
        this.frozen = wasFrozen;
      },
      setPopulation: (n: number | null) => {
        this.populationOverride = n === null ? null : Math.max(0, Math.min(MAX_AGENTS, Math.round(n)));
      },
      /** Spawns `count` walkers on the nearest walkable nodes around (x, z), heading to random destinations. */
      spawnAt: (x: number, z: number, count = 1, opts: { model?: string; dog?: boolean; standing?: boolean } = {}) => {
        const spawned: number[] = [];
        this.graph.nodesNear(x, z, 25, this.nodeTmp);
        const nodes = this.nodeTmp
          .filter((i) => !(this.night && this.graph.nodes[i].field))
          .sort((p, r) => Math.hypot(this.graph.nodes[p].x - x, this.graph.nodes[p].z - z) - Math.hypot(this.graph.nodes[r].x - x, this.graph.nodes[r].z - z));
        for (const ni of nodes) {
          if (spawned.length >= count) break;
          const n = this.graph.nodes[ni];
          if (this.agents.some((a) => a.active && Math.hypot(a.x - n.x, a.z - n.z) < 1.6)) continue;
          const agent = this.allocAgent(Boolean(opts.dog));
          if (!agent) break;
          if (opts.model) {
            const mi = this.models.findIndex((m) => m.def.name === opts.model);
            if (mi < 0) throw new Error(`[pedestrians] spawnAt: no model "${opts.model}"`);
            agent.model = mi;
            this.pickColors(this.models[mi].def, agent.colors);
            if (!this.models[mi].def.dog && agent.dog) {
              agent.dog.body.active = false;
              agent.dog.visible = false;
              agent.dog = null;
            }
          }
          agent.x = n.x;
          agent.z = n.z;
          agent.y = this.groundY(n.x, n.z);
          agent.lastNode = ni;
          if (!opts.standing && this.planRoute(agent, ni)) {
            agent.state = 'walk';
            const t = this.routeTangent(agent, 0);
            agent.heading = Math.atan2(t[0], t[1]);
          } else {
            agent.state = 'dwell';
            agent.timer = 1e9;
          }
          if (agent.dog) this.placeDog(agent, true);
          agent.dist = Math.hypot(agent.x - this.camX, agent.z - this.camZ);
          agent.visible = this.visibleAt(agent.x, agent.y, agent.z);
          if (agent.dog) {
            agent.dog.dist = Math.hypot(agent.dog.x - this.camX, agent.dog.z - this.camZ);
            agent.dog.visible = this.visibleAt(agent.dog.x, agent.dog.y, agent.dog.z);
          }
          spawned.push(agent.index);
        }
        return spawned;
      },
      clear: () => {
        for (const g of this.groups) for (const m of g.members) this.despawn(m);
        this.groups.length = 0;
        for (const a of this.agents) if (a.active) this.despawn(a);
      },
      agents: () =>
        this.agents
          .filter((a) => a.active)
          .map((a) => ({
            i: a.index,
            model: this.models[a.model].def.name,
            state: a.state,
            x: +a.x.toFixed(2),
            z: +a.z.toFixed(2),
            y: +a.y.toFixed(2),
            heading: +a.heading.toFixed(2),
            speed: +a.speed.toFixed(2),
            dist: +a.dist.toFixed(1),
            visible: a.visible,
            slowFor: +a.slowFor.toFixed(1),
            dest: a.dest?.kind ?? (a.spot ? 'group' : null),
            dog: a.dog ? { x: +a.dog.x.toFixed(2), z: +a.dog.z.toFixed(2) } : null,
          })),
      /** Smallest gap (m) between any villager / dog and any vehicle body (negative = overlapping), and between villagers. */
      clearance: () => {
        let vehicle = Infinity;
        let people = Infinity;
        let worst: Record<string, unknown> | null = null;
        let worstPeople: Record<string, unknown> | null = null;
        const near: ActorBody[] = [];
        for (const a of this.agents) {
          if (!a.active) continue;
          queryActors(a.x, a.z, 12, near, a.body.id);
          for (const b of near) {
            if (b.kind === 'pedestrian') {
              if (a.dog && b === a.dog.body) continue;
              if (b.id.startsWith('ped:dog')) continue;
              const dd = Math.hypot(b.x - a.x, b.z - a.z);
              if (dd < people) {
                people = dd;
                const o = this.ownerOf(b).agent;
                worstPeople = { a: a.index, aState: a.state, aGhost: this.time < a.ghostUntil, b: o.index, bState: o.state, bGhost: this.time < o.ghostUntil, x: +a.x.toFixed(2), z: +a.z.toFixed(2) };
              }
              continue;
            }
            const d = boxDistance(b, a.x, a.z) - 0.25;
            if (d < vehicle) {
              vehicle = d;
              worst = { ped: a.index, state: a.state, actor: b.id, speed: +b.speed.toFixed(2), x: +a.x.toFixed(2), z: +a.z.toFixed(2) };
            }
          }
        }
        return { vehicle: +vehicle.toFixed(3), people: +people.toFixed(3), worst, worstPeople };
      },
      graphDump: () => ({
        nodes: this.graph.nodes.map((n) => [+n.x.toFixed(2), +n.z.toFixed(2), n.field ? 1 : 0, +n.awayX.toFixed(2), +n.awayZ.toFixed(2)]),
        edges: this.graph.edges.map((e) => [e.a, e.b, e.crossing ? 1 : 0, e.kind]),
        destinations: this.graph.destinations.map((d) => [d.kind, d.node]),
        spots: this.graph.spots.map((s) => [s.label, +s.x.toFixed(2), +s.z.toFixed(2)]),
      }),
    };
  }
}

function insideBox(b: ActorBody, x: number, z: number, margin: number): boolean {
  const fx = Math.sin(b.heading);
  const fz = Math.cos(b.heading);
  const dx = x - b.x;
  const dz = z - b.z;
  const along = dx * fx + dz * fz;
  const side = dx * fz - dz * fx;
  return Math.abs(along) < b.halfLength + margin && Math.abs(side) < b.halfWidth + margin;
}

function boxDistance(b: ActorBody, x: number, z: number): number {
  const fx = Math.sin(b.heading);
  const fz = Math.cos(b.heading);
  const dx = x - b.x;
  const dz = z - b.z;
  const along = Math.abs(dx * fx + dz * fz) - b.halfLength;
  const side = Math.abs(dx * fz - dz * fx) - b.halfWidth;
  return Math.max(along, side);
}
