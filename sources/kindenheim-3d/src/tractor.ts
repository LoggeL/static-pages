import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { BuildingCollider } from './collision';
import { getBridgeDeckSurfaceHeight } from './roads';
import { dedupeModelTextures } from './sharedAssets';
import type { TerrainSystem } from './terrain';
import type { TimeOfDayPreset, TractorManifest } from './types';

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
  /** Opacity multiplier (dark soot burst when the engine is loaded). */
  boost: number;
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

// ---------------------------------------------------------------------------
// Vehicle material hooks (visual only)
// ---------------------------------------------------------------------------

/** Dry loess dust / dried mud of the Pfalz vineyards (sRGB). */
const DIRT_COLOR = new THREE.Color(0x9a8667);
/** Worn edges: grey primer under paint, polished grey on plastic, bright steel on metal. */
const PAINT_WEAR_COLOR = new THREE.Color(0x8d8f8c);
const PLASTIC_WEAR_COLOR = new THREE.Color(0x4a4b4c);
const METAL_WEAR_COLOR = new THREE.Color(0xb9bbbd);

/** Largest tractor/trailer hitch angle before the tub would intersect the tractor's rear wheels (54°). */
const MAX_HITCH_ANGLE_RAD = 0.94;
/** Distance (m) a lamp's spot light sits in front of its emitting face so it never lights that face itself. */
const LAMP_SOURCE_CLEARANCE = 0.12;

const HOSE_SEGMENTS = 14;
const HOSE_SIDES = 6;

/** Only the big surfaces cast shadows; fasteners, prints, lenses and trim never show in the shadow map. */
const SHADOW_CASTER_RE = /paint|roof|chassis|plastic|tyre|galvan|frame|grapes|driver|interior_trim|exhaust|seat_leather/;

const DIRT_NOISE_GLSL = /* glsl */ `
  float khHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float khNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(khHash(i), khHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(khHash(i + vec3(0.0, 1.0, 0.0)), khHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(khHash(i + vec3(0.0, 0.0, 1.0)), khHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(khHash(i + vec3(0.0, 1.0, 1.0)), khHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z
    );
  }
`;

interface VehicleShaderOptions {
  /** 0..1 strength of the `_DIRT` vertex mask (dust / dried mud). */
  dirt: number;
  /** Thin dust film on upward facing surfaces (0 = none). */
  film: number;
  /** Baked AO / cavity / edge atlas of this GLB (sampled with the second UV set), or null. */
  bake: THREE.Texture | null;
  /** How strongly convex edges wear through: paint chips to primer, plastic polishes. */
  edgeWear: number;
  /** Colour revealed on worn edges. */
  wearColor: THREE.Color;
  /** Grime collecting in baked cavities. */
  grime: number;
  /**
   * Tyre carcass / lugs: (outer radius, deflection, rim radius, sidewall bulge) in metres. The vertex stage
   * presses a small contact patch flat and bulges the sidewall next to the ground (the wheel still rolls).
   */
  tyre?: THREE.Vector4;
  /** Driver figure: xyz = world position of the cab eye point, w = radius inside which the figure is not drawn. */
  hideNear?: THREE.Vector4;
}

/**
 * One hook for every opaque vehicle material:
 *  - `_DIRT` vertex attribute (written by the Blender build, strong at the bottom and on the tyres), broken
 *    up with object-space noise -> dry soil colour, rough, no metalness / clearcoat;
 *  - a thin dust film on everything that faces the sky;
 *  - the baked atlas (R = ambient occlusion, G = cavity, B = inverted convexity) on the second UV set ->
 *    contact shadows, grime in recesses, chipped / polished edges.
 */
function installVehicleShader(mat: THREE.MeshStandardMaterial, opt: VehicleShaderOptions): void {
  const useBake = opt.bake !== null;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uKhDirtColor = { value: DIRT_COLOR };
    shader.uniforms.uKhDirt = { value: new THREE.Vector4(opt.dirt, opt.film, opt.edgeWear, opt.grime) };
    shader.uniforms.uKhWearColor = { value: opt.wearColor };
    if (useBake) shader.uniforms.uKhBake = { value: opt.bake };
    if (opt.tyre) shader.uniforms.uKhTyre = { value: opt.tyre };
    if (opt.hideNear) shader.uniforms.uKhHideNear = { value: opt.hideNear };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float _dirt;
        varying float vKhDirt;
        varying vec3 vKhDirtPos;
        ${opt.tyre ? 'uniform vec4 uKhTyre;' : ''}
        ${useBake ? '#ifndef USE_UV1\nattribute vec2 uv1;\n#endif\nvarying vec2 vKhUv1;' : ''}`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vKhDirt = _dirt;
        vKhDirtPos = position;
        ${useBake ? 'vKhUv1 = uv1;' : ''}
        ${
          opt.tyre
            ? `{
          mat3 khRot = mat3(modelMatrix);
          vec3 khAxle = normalize(khRot * vec3(1.0, 0.0, 0.0));
          vec3 khDown = vec3(0.0, -1.0, 0.0);
          khDown = normalize(khDown - khAxle * dot(khDown, khAxle));
          vec3 khRel = khRot * transformed;                                   // hub-relative, world orientation
          float khBelow = dot(khRel, khDown);
          float khR = length(transformed.yz);
          vec3 khMove = vec3(0.0);
          float khDepth = khBelow - (uKhTyre.x - uKhTyre.y);
          if (khDepth > 0.0) khMove -= khDown * khDepth;                      // contact patch pressed flat
          float khNear = smoothstep(0.50 * uKhTyre.x, uKhTyre.x - uKhTyre.y, khBelow);
          float khWall = sin(3.14159 * clamp((khR - uKhTyre.z) / (uKhTyre.x - uKhTyre.z), 0.0, 1.0));
          khMove += khAxle * sign(transformed.x) * uKhTyre.w * khNear * khWall;   // sidewall bulge
          transformed += khMove * khRot;                                      // back to object space (rotation only)
        }`
            : ''
        }`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uKhDirtColor;
        uniform vec4 uKhDirt;
        uniform vec3 uKhWearColor;
        varying float vKhDirt;
        varying vec3 vKhDirtPos;
        ${useBake ? 'uniform sampler2D uKhBake;\nvarying vec2 vKhUv1;' : ''}
        ${opt.hideNear ? 'uniform vec4 uKhHideNear;' : ''}
        float gKhDirt;
        float gKhChip;
        float gKhGrime;
        float gKhAo;
        ${DIRT_NOISE_GLSL}`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        ${opt.hideNear ? 'if (distance(cameraPosition, uKhHideNear.xyz) < uKhHideNear.w) discard;' : ''}
        {
          float n1 = khNoise(vKhDirtPos * 5.0);
          float n2 = khNoise(vKhDirtPos * 13.0 + 7.3);
          float n3 = khNoise(vKhDirtPos * 31.0 + 2.1);
          float dn = n1 * 0.55 + n2 * 0.30 + n3 * 0.15;
          gKhAo = 1.0;
          gKhChip = 0.0;
          gKhGrime = 0.0;
          float cavity = 0.0;
          ${
            useBake
              ? `vec3 bake = texture2D(uKhBake, vKhUv1).rgb;
          gKhAo = bake.r;
          cavity = 1.0 - bake.g;
          float edge = smoothstep(0.80, 0.30, bake.b);
          // chips: only where the edge mask and a fine noise agree, so edges are nicked, not outlined
          gKhChip = uKhDirt.z * edge * smoothstep(0.42, 0.70, khNoise(vKhDirtPos * 61.0) * 0.55 + n3 * 0.45 + edge * 0.18);
          gKhGrime = uKhDirt.w * smoothstep(0.08, 0.75, cavity) * (0.55 + 0.75 * n2);
          diffuseColor.rgb = mix(diffuseColor.rgb, uKhWearColor, gKhChip);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.30 + vec3(0.020, 0.017, 0.013), clamp(gKhGrime, 0.0, 0.85));`
              : ''
          }
          float up = max(inverseTransformDirection(normalize(vNormal), viewMatrix).y, 0.0);
          float film = uKhDirt.y * up * up * (0.55 + 0.9 * n2);
          float dAmt = clamp(vKhDirt * uKhDirt.x * (1.0 + 0.6 * cavity), 0.0, 1.0);
          gKhDirt = smoothstep(0.28, 0.92, dAmt * (0.42 + 1.15 * dn) + dAmt * dAmt * 0.38);
          gKhDirt = clamp(max(gKhDirt, film), 0.0, 1.0);
          vec3 soil = uKhDirtColor * (0.74 + 0.46 * khNoise(vKhDirtPos * 17.0 + 4.7));
          diffuseColor.rgb = mix(diffuseColor.rgb, soil, gKhDirt * 0.88);
        }`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.95, max(gKhDirt, clamp(gKhGrime, 0.0, 1.0) * 0.6));
        roughnessFactor = mix(roughnessFactor, 0.55, gKhChip);`
      )
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - gKhDirt;')
      .replace(
        '#include <lights_physical_fragment>',
        '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= (1.0 - gKhDirt) * (1.0 - gKhChip);\n#endif'
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= gKhAo;
        reflectedLight.indirectSpecular *= mix(1.0, gKhAo, 0.9);
        reflectedLight.directDiffuse *= mix(1.0, gKhAo, 0.30);
        reflectedLight.directSpecular *= mix(1.0, gKhAo, 0.55);
        #ifdef USE_CLEARCOAT
          clearcoatSpecularIndirect *= mix(1.0, gKhAo, 0.9);
          clearcoatSpecularDirect *= mix(1.0, gKhAo, 0.55);
        #endif`
      );
  };
  mat.customProgramCacheKey = () => `kh-vehicle-${useBake ? 'bake' : 'plain'}-${opt.tyre ? 'tyre' : ''}-${opt.hideNear ? 'hide' : ''}`;
}

/**
 * Cab glass without transmission: dark alpha-blended panes whose opacity follows Fresnel and the
 * specular reflection, so the sky mirrors in the glass from outside while the interior stays visible.
 * The panes are double sided; their back faces (seen from the cab) get a separate, neutral model, see below.
 */
function installGlassShader(mat: THREE.MeshStandardMaterial): void {
  mat.premultipliedAlpha = true;
  // One pass with real double-sided rasterisation. In three's default two-pass mode for transparent
  // DoubleSide materials the back pass is drawn as BackSide with a flipped gl.frontFace, so gl_FrontFacing is
  // TRUE for the inner faces too: the cab view then ran the outside model (mirrored sky x 2.2..13) and got a
  // sepia veil at dusk. Single pass also saves one draw call per frame.
  mat.side = THREE.DoubleSide;
  mat.forceSinglePass = true;
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <opaque_fragment>',
        `if (gl_FrontFacing) {
          float khFres = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 4.0);
          // diffuseColor.a carries the dust map: clean in the wiper arc, dusty at the edges
          float khBody = mix(diffuseColor.a, 0.82, khFres);
          // real glass has F0 = 0.04; lift the mirrored sky so the panes read as glass without transmission
          vec3 khRefl = totalSpecular * (2.2 + 11.0 * khFres);
          float khReflA = clamp(dot(khRefl, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
          float khAlpha = clamp(khBody + khReflA * (1.0 - khBody), 0.0, 0.97);
          gl_FragColor = vec4((totalDiffuse + totalEmissiveRadiance) * khBody + khRefl, khAlpha);   // premultiplied
        } else {
          // From the driver's seat. The lit material terms above are the wrong side of the pane here: their
          // lighting uses the cab-facing normal, so they gather (and mirror) the open sky BEHIND the tractor,
          // which the cab roof and rear wall hide in reality. At dusk that is the sunset glow in the west, and it
          // laid a sepia veil over the whole view. What really reaches the eye through a used pane:
          //  - the outside scene, minus ~3 % neutral absorption / back reflection of the laminated glass;
          //  - a grey dust film that scatters the light falling on the pane from OUTSIDE (forward half-space),
          //    only where the wiper never reaches (map alpha above 0.29); neutral, luminance only;
          //  - the reflection of the dark interior trim, which is negligible and left out.
          float khFilm = max(diffuseColor.a - 0.29, 0.0) * 0.16;
          float khIrr = 0.0;
          #ifdef USE_ENVMAP
            khIrr = dot(getIBLIrradiance(-normal), vec3(0.2126, 0.7152, 0.0722));
          #endif
          vec3 khHaze = vec3(khIrr * 0.45 * RECIPROCAL_PI * khFilm);    // dust albedo 0.45, Lambertian
          gl_FragColor = vec4(khHaze, khFilm + 0.03 * (1.0 - khFilm));   // premultiplied
        }`
      )
      .replace('#include <premultiplied_alpha_fragment>', '');
  };
  mat.customProgramCacheKey = () => 'kh-vehicle-glass';
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

export class TractorController {
  public readonly group = new THREE.Group();
  public readonly tractorRoot = new THREE.Group();
  public readonly trailerRoot = new THREE.Group();

  private readonly terrain: TerrainSystem;
  /** Kerb / sidewalk lift above the terrain height (roadGroup.userData.getSurfaceLift), set by main.ts. */
  private surfaceLift: ((x: number, z: number) => number) | null = null;
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
  private taillightOffsets: THREE.Vector3[] = [];
  private trailerTaillightOffsets: THREE.Vector3[] = [];
  private workLightRearOffset: THREE.Vector3 | null = null;
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
  private displayMats: THREE.MeshStandardMaterial[] = [];
  private readonly matVariants = new Map<string, THREE.MeshStandardMaterial>();

  // Visual rig (all optional: only present in the Blender-built model)
  private frontAxle: THREE.Object3D | null = null;
  private tieRod: THREE.Object3D | null = null;
  private frontAxlePivot = new THREE.Vector3(0, 0.7, 1.42);
  private rigSteerArmEnds: THREE.Vector3[] = [];
  private rigDriverShoulders: THREE.Vector3[] = [];
  private rigDriverHandAngles: number[] = [];
  private steerArmLocal: THREE.Vector3[] = [];
  private tieRodRestLen = 1.44;
  private axleSwing = 0;
  private wheelGroundY: [number, number, number, number] = [0, 0, 0, 0];
  private steeringPivotNode: THREE.Object3D | null = null;
  private driverArms: { upper: THREE.Object3D; fore: THREE.Object3D; shoulder: THREE.Vector3; side: number; angle: number }[] = [];
  private driverSpec = { upperArm: 0.33, foreArm: 0.42, handRadius: 0.205, hideRadius: 1.3 };
  private readonly driverHideSphere = new THREE.Vector4(0, -1e6, 0, 0);
  private clusterLive: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; mat: THREE.MeshBasicMaterial } | null = null;
  private terminalLive: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; mat: THREE.MeshBasicMaterial } | null = null;
  private liveTimer = 0;
  private liveKey = '';
  private beamDecal: THREE.Mesh | null = null;
  private berryMesh: THREE.InstancedMesh | null = null;
  private berryTotal = 0;
  private hoseMesh: THREE.Mesh | null = null;
  private mirrorReflectors: Reflector[] = [];
  private mirrorFrame = 0;
  private readonly lastCameraPos = new THREE.Vector3(0, 1e6, 0);
  private hoseEnds: { tractor: THREE.Vector3; trailer: THREE.Vector3; rest: number; radius: number }[] = [];
  private readonly tmpE = new THREE.Vector3();
  private readonly tmpF = new THREE.Vector3();
  private lastThrottleLoad = 0;
  private qualityLevel: 'low' | 'medium' | 'high' | 'ultra' = 'high';
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpC = new THREE.Vector3();
  private readonly tmpD = new THREE.Vector3();
  private trailerWheels: THREE.Object3D[] = [];

  // Dynamic lights
  private spotLights: THREE.SpotLight[] = [];
  private headlightGlows: THREE.Sprite[] = [];
  private beaconLight: THREE.SpotLight | null = null;
  private beaconTarget: THREE.Object3D | null = null;
  private beaconGlow: THREE.Sprite | null = null;
  private workLightRear: THREE.SpotLight | null = null;
  private taillightGlows: THREE.Sprite[] = [];
  private trailerTaillightGlows: THREE.Sprite[] = [];

  // Time of day (0 = full daylight, 1 = darkest preset). Set through setTimeOfDay(); until the app calls
  // it the value is derived from the scene's sun elevation so dusk lighting never silently looks like noon.
  private nightFactor = 0;
  private timeOfDayExplicit = false;
  private sunLight: THREE.DirectionalLight | null = null;
  private readonly tmpSunDir = new THREE.Vector3();

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
    if (!this.surfaceLift) {
      throw new Error(
        '[tractor] loadModels() before setSurfaceLiftSampler(): wire roadGroup.userData.getSurfaceLift in src/main.ts first'
      );
    }
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
      if (Array.isArray(manifest.taillightOffsets)) {
        this.taillightOffsets = manifest.taillightOffsets.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
      }
      if (Array.isArray(manifest.trailerTaillightOffsets)) {
        this.trailerTaillightOffsets = manifest.trailerTaillightOffsets.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
      }
      if (manifest.workLightRearOffset) this.workLightRearOffset = new THREE.Vector3(...manifest.workLightRearOffset);
      if (manifest.frontAxlePivot) this.frontAxlePivot.set(...manifest.frontAxlePivot);
      if (Array.isArray(manifest.steerArmEnds)) {
        this.rigSteerArmEnds = manifest.steerArmEnds.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
      }
      if (manifest.driver) {
        this.rigDriverShoulders = manifest.driver.shoulders.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
        this.rigDriverHandAngles = manifest.driver.handAnglesDeg.slice();
        this.driverSpec = {
          upperArm: manifest.driver.upperArm,
          foreArm: manifest.driver.foreArm,
          handRadius: manifest.driver.handRadius,
          hideRadius: manifest.driver.hideRadius,
        };
      }
      if (manifest.rearHitchOffset) this.rearHitchOffset.set(...manifest.rearHitchOffset);
      if (manifest.trailerHitchOffset) this.trailerHitchOffset.set(...manifest.trailerHitchOffset);
      if (typeof manifest.trailerWheelRadius === 'number') this.trailerWheelRadius = manifest.trailerWheelRadius;
      if (typeof manifest.trailerAxleOffsetZ === 'number') this.trailerAxleOffsetZ = manifest.trailerAxleOffsetZ;

      this.wheelbase = Math.max(1.5, Math.abs(this.wheelFLPos.z - this.wheelRLPos.z));
      this.trackWidth = Math.max(1.2, Math.abs(this.wheelFLPos.x - this.wheelFRPos.x));
    }

    const loader = new GLTFLoader();
    // tractor.glb / trailer.glb are exported with EXT_meshopt_compression (keeps the hero vehicle < 10 MB)
    loader.setMeshoptDecoder(MeshoptDecoder);
    let tractorScene: THREE.Object3D;
    let trailerScene: THREE.Object3D;

    // Required assets: no placeholder vehicle. A missing manifest or GLB stops the boot with URL and cause.
    if (!manifest) {
      throw new Error('[tractor] vehicle manifest (assets/models/tractor/manifest.json) is missing or invalid');
    }
    if (!manifest.tractorGlb || !manifest.trailerGlb) {
      throw new Error('[tractor] vehicle manifest lists no tractorGlb / trailerGlb path');
    }
    const loadGlb = async (url: string): Promise<THREE.Object3D> => {
      try {
        const gltf = await loader.loadAsync(url);
        dedupeModelTextures(gltf.scene);
        return gltf.scene;
      } catch (err) {
        throw new Error(`[tractor] failed to load ${url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    tractorScene = await loadGlb(manifest.tractorGlb);
    trailerScene = await loadGlb(manifest.trailerGlb);
    this.usingBlenderModels = true;

    // Baked AO / cavity / edge atlases live next to the GLBs (see blender/tractor/bake_utils.py)
    const tractorBake = manifest.tractorBakeMap ? await this.loadBakeMap(manifest.tractorGlb, manifest.tractorBakeMap) : null;
    const trailerBake = manifest.trailerBakeMap ? await this.loadBakeMap(manifest.trailerGlb, manifest.trailerBakeMap) : null;

    this.mountTractorModel(tractorScene, tractorBake);
    this.mountTrailerModel(trailerScene, trailerBake);
    if (manifest.grapeBerriesBin) await this.loadGrapeBerries(manifest.trailerGlb, manifest.grapeBerriesBin);
    if (Array.isArray(manifest.hoseAnchors) && Array.isArray(manifest.trailerHoseAnchors)) {
      this.createHoses(manifest.hoseAnchors, manifest.trailerHoseAnchors);
    }
    if (Array.isArray(manifest.mirrors)) this.createMirrorReflectors(manifest.mirrors);
    this.setupVehicleLights();
    this.resetToHauptstrasse();
  }

  private async loadBakeMap(glbUrl: string, fileName: string): Promise<THREE.Texture> {
    const url = new URL(fileName, new URL(glbUrl, document.baseURI)).href;
    let tex: THREE.Texture;
    try {
      tex = await new THREE.TextureLoader().loadAsync(url);
    } catch (err) {
      throw new Error(`[tractor] manifest lists bake map "${fileName}" but ${url} could not be loaded: ${String(err)}`);
    }
    tex.flipY = false; // glTF UV convention, same as the textures embedded in the GLB
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = Math.min(4, this.maxAnisotropy);
    tex.needsUpdate = true;
    return tex;
  }

  private tuneMaterials(root: THREE.Object3D, bake: THREE.Texture | null): void {
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
      const geo = obj.geometry as THREE.BufferGeometry;
      const hasDirt = Boolean(geo.getAttribute('_dirt'));
      const meshBake = bake && geo.getAttribute('uv1') ? bake : null;
      const src = obj.material;
      if (Array.isArray(src) || !(src instanceof THREE.MeshStandardMaterial)) return;
      const name = src.name.toLowerCase();
      const isGlass = name.includes('glass') && !name.includes('mirror');
      const isDecal = name.includes('decal');
      const isLeaf = name.includes('leaf');
      const isLive = name.includes('live');
      obj.castShadow = SHADOW_CASTER_RE.test(name) && !isGlass && !isDecal && !isLive;
      obj.userData.khCastsShadow = obj.castShadow;

      // Tyres get one material variant per wheel size (the contact-patch deformation needs the radius)
      let tyre: THREE.Vector4 | undefined;
      let variant = '';
      if (name.includes('tyre')) {
        if (!geo.boundingBox) geo.computeBoundingBox();
        const bb = geo.boundingBox!;
        let wheelNode: THREE.Object3D | null = obj;
        while (wheelNode && !wheelNode.name.startsWith('Wheel_')) wheelNode = wheelNode.parent;
        if (wheelNode) {
          // every tyre mesh of one wheel shares the wheel's outer radius; the carcass alone is slightly smaller
          const radius = Math.max(bb.max.y, bb.max.z);
          const key = Math.round(radius * 50) / 50;
          const outer = key >= 0.8 ? this.rearWheelRadius : key >= 0.52 ? this.frontWheelRadius : this.trailerWheelRadius;
          const rim = outer * (key >= 0.8 ? 0.555 : key >= 0.52 ? 0.58 : 0.56);
          tyre = new THREE.Vector4(outer, 0.009 * (outer / 0.88) + 0.004, rim, 0.016 + 0.012 * (outer / 0.88));
          variant = `tyre${outer.toFixed(2)}`;
        }
      }
      const variantKey = `${src.uuid}|${variant}`;
      let m = this.matVariants.get(variantKey);
      if (m) {
        obj.material = m;
        return;
      }
      m = variant ? src.clone() : src;
      this.matVariants.set(variantKey, m);
      obj.material = m;

      m.envMapIntensity = 1.0;
      const maxAniso = Math.min(8, this.maxAnisotropy);
      for (const tex of [m.map, m.normalMap, m.roughnessMap, m.emissiveMap]) {
        if (tex) tex.anisotropy = maxAniso;
      }

      if (name.includes('grapes') && !isLeaf) {
        // Ripe wine grapes carry a waxy bloom: their highlights are broad and soft. The texture's rubbed-off
        // skin goes down to roughness 0.18, and its berry-scale normal map catches the rear work lamp at grazing
        // angles in thousands of pinpoints: the load turned into glittering black gravel (0.5 and 0.68 still
        // sparkled). This packed base layer is only the fill under the loose 3D berries, which keep their own
        // soft highlight (roughness 0.55), so it is made matte.
        m.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <roughnessmap_fragment>',
            '#include <roughnessmap_fragment>\nroughnessFactor = max(roughnessFactor, 0.82);'
          );
        };
        m.customProgramCacheKey = () => 'kh-grapes-bloom';
      }
      if (isLeaf) {
        // vine leaves on the grape load: alpha-tested cut-outs (no sorting artefacts), lit from both sides
        m.transparent = false;
        m.alphaTest = 0.5;
        m.depthWrite = true;
        m.side = THREE.DoubleSide;
      } else if (isGlass) {
        m.transparent = true;
        m.depthWrite = false;
        installGlassShader(m);
      } else if (isDecal) {
        m.transparent = true;
        m.depthWrite = false;
        m.polygonOffset = true;
        m.polygonOffsetFactor = -2;
        m.polygonOffsetUnits = -2;
      } else if (m.transparent) {
        m.depthWrite = false;
      }

      if (name.includes('display')) this.displayMats.push(m);
      const isDriver = name.includes('driver');
      const isInterior = name.includes('interior') || name.includes('seat') || name.includes('headliner') || name.includes('floor_mat');

      const emissiveLens =
        name.includes('display') || name.includes('headlight') || name.includes('taillight') || name.includes('beacon');
      if (hasDirt && !isGlass && !isLeaf && !isLive && !emissiveLens && !name.includes('grape')) {
        const isPaint = name.includes('paint') || name.includes('roof');
        const isRubber = name.includes('tyre') || name.includes('rubber') || name.includes('mat');
        const flat = isDecal || name.includes('print');
        installVehicleShader(m, {
          dirt: name.includes('tyre') ? 1.0 : flat ? 0.7 : name.includes('lens') ? 0.6 : 0.9,
          film: flat || isDriver || isInterior ? 0.0 : isPaint ? 0.09 : 0.15,
          bake: flat ? null : meshBake,
          edgeWear: isPaint ? 0.85 : isRubber || isDriver || name.includes('seat') ? 0.0 : 0.5,
          wearColor: isPaint
            ? PAINT_WEAR_COLOR
            : name.includes('galvan') || name.includes('steel') || name.includes('chrome') || name.includes('checker')
              ? METAL_WEAR_COLOR
              : PLASTIC_WEAR_COLOR,
          grime: isDriver ? 0.25 : isRubber ? 0.35 : isPaint ? 0.45 : 0.7,
          tyre,
          hideNear: isDriver ? this.driverHideSphere : undefined,
        });
      }
    });
  }

  private mountTractorModel(model: THREE.Object3D, bake: THREE.Texture | null): void {
    this.tractorRoot.clear();
    this.tuneMaterials(model, bake);
    this.tractorRoot.add(model);

    this.wheelFL = findNodeByName(model, 'Wheel_FL', 'wheel_fl');
    this.wheelFR = findNodeByName(model, 'Wheel_FR', 'wheel_fr');
    this.wheelRL = findNodeByName(model, 'Wheel_RL', 'wheel_rl');
    this.wheelRR = findNodeByName(model, 'Wheel_RR', 'wheel_rr');

    this.pivotFL = wrapSteerPivot(this.wheelFL);
    this.pivotFR = wrapSteerPivot(this.wheelFR);

    // Front mudguards share the hub origin of their wheel: hang them on the steer pivots so they turn
    // with the wheels (but do not roll).
    for (const [fenderName, pivot] of [
      ['FrontFender_L', this.pivotFL],
      ['FrontFender_R', this.pivotFR],
    ] as const) {
      const fender = findNodeByName(model, fenderName);
      if (fender && pivot) {
        fender.position.set(0, 0, 0);
        pivot.add(fender);
      }
    }

    this.mountVisualRig(model);

    this.steeringWheel = findNodeByName(model, 'SteeringWheel', 'steering');
    if (this.steeringWheel) {
      this.steeringWheelBaseRot.copy(this.steeringWheel.rotation);
    }

    this.beaconNode = findNodeByName(model, 'Beacon', 'beacon');
    this.beaconMats = [];
    if (this.beaconNode) {
      this.beaconNode.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          // The beacon spins every frame: as a shadow caster it forces the sun cascades to re-render continuously,
          // and while it cast, the cascaded shadows lost the roof's shadow over the cab interior (dark trim turned
          // bright orange-brown in the cab view). A 15 cm lens needs no shadow.
          o.castShadow = false;
          o.userData.khCastsShadow = false;
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

  /**
   * Visual-only rig of the Blender model: swinging front axle with a fitted tie rod, the driver's arms and the
   * live instrument overlays. Every part is optional (the placeholder model has none of them).
   */
  private mountVisualRig(model: THREE.Object3D): void {
    this.frontAxle = findNodeByName(model, 'FrontAxle');
    this.tieRod = findNodeByName(model, 'TieRod');
    if (this.frontAxle) {
      // hang the steer pivots (wheels + mudguards) and the tie rod on the axle so they follow its swing
      for (const node of [this.pivotFL, this.pivotFR, this.tieRod]) {
        if (!node) continue;
        node.position.sub(this.frontAxle.position);
        this.frontAxle.add(node);
      }
    }
    const ends = this.rigSteerArmEnds;
    this.steerArmLocal = [];
    if (ends.length === 2) {
      this.steerArmLocal = [ends[0].clone().sub(this.wheelFLPos), ends[1].clone().sub(this.wheelFRPos)];
      this.tieRodRestLen = ends[0].distanceTo(ends[1]);
    }

    this.steeringPivotNode = findNodeByName(model, 'SteeringPivot');
    this.driverArms = [];
    const shoulders = this.rigDriverShoulders;
    const angles = this.rigDriverHandAngles;
    for (const [i, tag] of (['L', 'R'] as const).entries()) {
      const upper = findNodeByName(model, `DriverArm_${tag}_Upper`);
      const fore = findNodeByName(model, `DriverArm_${tag}_Fore`);
      if (upper && fore && shoulders[i] && angles[i] !== undefined) {
        this.driverArms.push({ upper, fore, shoulder: shoulders[i], side: i === 0 ? 1 : -1, angle: THREE.MathUtils.degToRad(angles[i]) });
      }
    }

    this.clusterLive = this.createLiveDisplay(findNodeByName(model, 'ClusterLive'), 1024, 448);
    this.terminalLive = this.createLiveDisplay(findNodeByName(model, 'TerminalLive'), 640, 448);
    this.liveKey = '';
  }

  /**
   * Loose grape berries on the load: one InstancedMesh fed from a small Float32 file written by
   * blender/tractor/build_trailer.py (x, y, z, radius, tint per berry, shuffled). The drawn prefix shrinks
   * with camera distance and quality level, so the drone view does not pay for berries it cannot resolve.
   */
  private async loadGrapeBerries(glbUrl: string, fileName: string): Promise<void> {
    const url = new URL(fileName, new URL(glbUrl, document.baseURI)).href;
    let data: Float32Array;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = new Float32Array(await res.arrayBuffer());
    } catch (err) {
      throw new Error(`[tractor] manifest lists grape berries "${fileName}" but ${url} could not be loaded: ${String(err)}`);
    }
    const n = Math.floor(data.length / 5);
    if (n === 0) throw new Error(`[tractor] ${url} contains no berry records`);
    const geo = new THREE.OctahedronGeometry(1, 1);
    geo.setAttribute('normal', (geo.getAttribute('position') as THREE.BufferAttribute).clone()); // unit sphere: smooth normals
    // 0.55: waxy bloom (0.36 sparkled like wet gravel under the rear work lamp)
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0 });
    mat.name = 'Trailer_Grape_Berries_Instanced';
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.name = 'GrapeBerries';
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const o = i * 5;
      pos.set(data[o], data[o + 1], data[o + 2]);
      scl.setScalar(data[o + 3]);
      mesh.setMatrixAt(i, m4.compose(pos, q, scl));
      const tint = data[o + 4];
      if (tint > 2.5) col.setRGB(0.2, 0.045, 0.075); // half-ripe red berry
      else if (tint > 1.5) col.setRGB(0.15, 0.2, 0.045); // unripe green berry
      else col.setRGB(0.028 + 0.05 * tint, 0.017 + 0.062 * tint, 0.058 + 0.1 * tint); // skin -> waxy bloom
      mesh.setColorAt(i, col);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    const centre = new THREE.Vector3();
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      const dist = camera.position.distanceTo(centre.setFromMatrixPosition(mesh.matrixWorld));
      const lod = dist < 14 ? 1 : dist > 70 ? 0.15 : THREE.MathUtils.lerp(1, 0.15, (dist - 14) / 56);
      const quality = this.qualityLevel === 'low' ? 0.25 : this.qualityLevel === 'medium' ? 0.6 : 1;
      mesh.count = Math.max(1, Math.floor(n * lod * quality));
    };
    this.berryMesh = mesh;
    this.berryTotal = n;
    this.trailerRoot.add(mesh);
  }

  /**
   * Working cab mirrors: small planar reflections that only exist while the camera sits in the cab (and only
   * on quality high / ultra). Each mirror re-renders every 6th frame, alternating, with the shadow maps reused,
   * so the cab view pays about a third of an extra scene pass. Everywhere else the static mirror glass shows.
   */
  private createMirrorReflectors(mirrors: { position: [number, number, number]; yawDeg: number; size: [number, number] }[]): void {
    this.mirrorReflectors = [];
    mirrors.forEach((spec, idx) => {
      const reflector = new Reflector(new THREE.PlaneGeometry(spec.size[0], spec.size[1]), {
        textureWidth: 256,
        textureHeight: 512,
        clipBias: 0.003,
        color: 0x9aa0a6,
      });
      reflector.name = `MirrorReflector_${idx}`;
      reflector.position.set(...spec.position);
      reflector.rotation.y = THREE.MathUtils.degToRad(spec.yawDeg);
      reflector.visible = false;
      const renderReflection = reflector.onBeforeRender;
      let rendered = false;
      reflector.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
        this.mirrorFrame++;
        // both mirrors pass here every frame: refresh one of them every 3rd frame
        const due = Math.floor(this.mirrorFrame / mirrors.length) % 3 === 0 && Math.floor(this.mirrorFrame / mirrors.length / 3) % mirrors.length === idx;
        if (rendered && !due) return;
        rendered = true;
        renderReflection.call(reflector, renderer, scene, camera, geometry, material, group);
      };
      this.tractorRoot.add(reflector);
      this.mirrorReflectors.push(reflector);
    });
    // an invisible, always-drawn probe reports where the rendering camera is (the controller never sees it)
    const probeMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
    const probe = new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.01), probeMat);
    probe.name = 'CameraProbe';
    probe.frustumCulled = false;
    probe.castShadow = false;
    probe.onBeforeRender = (_renderer, _scene, camera) => {
      // the mirrors' own reflection passes render with a virtual camera: ignore those
      if (!this.mirrorReflectors.some((r) => r.camera === camera)) this.lastCameraPos.copy(camera.position);
    };
    this.tractorRoot.add(probe);
  }

  private updateMirrorReflectors(): void {
    if (this.mirrorReflectors.length === 0) return;
    const eye = this.tmpA.copy(this.cabCameraOffset).applyMatrix4(this.tractorRoot.matrixWorld);
    const inCab = this.lastCameraPos.distanceTo(eye) < 0.9;
    const enabled = inCab && (this.qualityLevel === 'high' || this.qualityLevel === 'ultra');
    for (const r of this.mirrorReflectors) r.visible = enabled;
  }

  /** Hydraulic hoses + lighting cable between tractor and trailer: sagging tubes rebuilt every frame. */
  private createHoses(tractorAnchors: [number, number, number][], trailerAnchors: [number, number, number][]): void {
    const count = Math.min(tractorAnchors.length, trailerAnchors.length);
    if (count === 0) return;
    this.hoseEnds = [];
    for (let i = 0; i < count; i++) {
      const a = new THREE.Vector3(...tractorAnchors[i]);
      const b = new THREE.Vector3(...trailerAnchors[i]);
      // rest length = straight-line distance with the rig coupled in a straight line, plus slack
      const bInTractor = b.clone();
      bInTractor.z += this.rearHitchOffset.z - this.trailerHitchOffset.z;
      this.hoseEnds.push({ tractor: a, trailer: b, rest: a.distanceTo(bInTractor) + 0.22, radius: i < 2 ? 0.011 : 0.008 });
    }
    const rings = HOSE_SEGMENTS + 1;
    const verts = count * rings * HOSE_SIDES;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    const index: number[] = [];
    for (let h = 0; h < count; h++) {
      const base = h * rings * HOSE_SIDES;
      for (let r = 0; r < HOSE_SEGMENTS; r++) {
        for (let k = 0; k < HOSE_SIDES; k++) {
          const a = base + r * HOSE_SIDES + k;
          const b = base + r * HOSE_SIDES + ((k + 1) % HOSE_SIDES);
          index.push(a, b, a + HOSE_SIDES, b, b + HOSE_SIDES, a + HOSE_SIDES);
        }
      }
    }
    geo.setIndex(index);
    const mat = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.78, metalness: 0 });
    mat.name = 'Vehicle_Hose_Dynamic';
    this.hoseMesh = new THREE.Mesh(geo, mat);
    this.hoseMesh.name = 'CouplingHoses';
    this.hoseMesh.frustumCulled = false;
    this.hoseMesh.castShadow = false;
    this.group.add(this.hoseMesh);
  }

  private updateHoses(): void {
    const mesh = this.hoseMesh;
    if (!mesh) return;
    mesh.visible = this.trailerAttached;
    if (!mesh.visible) return;
    this.tractorRoot.updateMatrixWorld(true);
    this.trailerRoot.updateMatrixWorld(true);
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const nrm = mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const a = this.tmpA;
    const b = this.tmpB;
    const c = this.tmpC;
    const t = this.tmpD;
    const side = this.tmpE;
    const up = this.tmpF;
    let i = 0;
    for (const hose of this.hoseEnds) {
      a.copy(hose.tractor).applyMatrix4(this.tractorRoot.matrixWorld);
      b.copy(hose.trailer).applyMatrix4(this.trailerRoot.matrixWorld);
      const dist = a.distanceTo(b);
      // slack hangs as a parabola; a stretched hose goes straight
      const sag = Math.sqrt(Math.max(hose.rest * hose.rest - dist * dist, 0.0004)) * 0.42;
      for (let r = 0; r <= HOSE_SEGMENTS; r++) {
        const u = r / HOSE_SEGMENTS;
        c.lerpVectors(a, b, u);
        c.y -= sag * 4 * u * (1 - u);
        t.subVectors(b, a);
        t.y -= sag * 4 * (1 - 2 * u);
        t.normalize();
        side.set(t.z, 0, -t.x);
        if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
        side.normalize();
        up.crossVectors(side, t).normalize();
        for (let k = 0; k < HOSE_SIDES; k++) {
          const ang = (k / HOSE_SIDES) * Math.PI * 2;
          const nx = side.x * Math.cos(ang) + up.x * Math.sin(ang);
          const ny = side.y * Math.cos(ang) + up.y * Math.sin(ang);
          const nz = side.z * Math.cos(ang) + up.z * Math.sin(ang);
          pos.setXYZ(i, c.x + nx * hose.radius, c.y + ny * hose.radius, c.z + nz * hose.radius);
          nrm.setXYZ(i, nx, ny, nz);
          i++;
        }
      }
    }
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
  }

  private applyQualityToExtras(): void {
    // berry density follows qualityLevel inside the InstancedMesh's onBeforeRender (see loadGrapeBerries)
    if (this.berryMesh) this.berryMesh.visible = this.berryTotal > 0;
  }

  private createLiveDisplay(node: THREE.Object3D | null, w: number, h: number) {
    let mesh: THREE.Mesh | null = null;
    node?.traverse((o) => {
      if (!mesh && o instanceof THREE.Mesh) mesh = o;
    });
    if (!mesh) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('[tractor] 2D canvas context unavailable for the live instrument display');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false; // glTF UV convention of the overlay quad
    tex.anisotropy = Math.min(8, this.maxAnisotropy);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    (mesh as THREE.Mesh).material = mat;
    (mesh as THREE.Mesh).castShadow = false;
    return { canvas, ctx, tex, mat };
  }

  /** Needles, gear and read-outs of the instrument cluster + terminal follow the telemetry (redrawn ~8x per second). */
  private updateLiveDisplays(dt: number): void {
    if (!this.clusterLive && !this.terminalLive) return;
    this.liveTimer += dt;
    if (this.liveTimer < 0.12) return;
    this.liveTimer = 0;
    const kmh = Math.abs(this.speedMps) * 3.6;
    const now = new Date();
    const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const key = `${kmh.toFixed(1)}|${Math.round(this.rpm / 10)}|${this.gear}|${clock}|${this.lightsOn}`;
    if (key === this.liveKey) return;
    this.liveKey = key;
    const font = '"DIN Alternate", "Helvetica Neue", Arial, sans-serif';

    if (this.clusterLive) {
      const { ctx, canvas, tex } = this.clusterLive;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const needle = (cx: number, cy: number, r: number, frac: number) => {
        const a = THREE.MathUtils.degToRad(225 - 270 * THREE.MathUtils.clamp(frac, 0, 1.04));
        ctx.strokeStyle = '#ff6028';
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(a) * r * 0.14, cy + Math.sin(a) * r * 0.14);
        ctx.lineTo(cx + Math.cos(a) * r * 0.78, cy - Math.sin(a) * r * 0.78);
        ctx.stroke();
        ctx.fillStyle = '#2a2c30';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.09, 0, Math.PI * 2);
        ctx.fill();
      };
      needle(216, 222, 196, this.rpm / 3000);
      needle(canvas.width - 216, 222, 196, kmh / 50);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f0f4f0';
      ctx.font = `bold 96px ${font}`;
      ctx.fillText(this.gear, 512, 172);
      ctx.fillStyle = '#aac8b4';
      ctx.font = `bold 34px ${font}`;
      ctx.fillText(clock, 512, 238);
      if (this.lightsOn) {
        ctx.fillStyle = '#4678ff';
        ctx.font = `bold 22px ${font}`;
        ctx.fillText('≡', 496, 422);
      }
      tex.needsUpdate = true;
    }
    if (this.terminalLive) {
      const { ctx, canvas, tex } = this.terminalLive;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#eceff4';
      ctx.font = `bold 36px ${font}`;
      ctx.fillText(kmh.toFixed(1), canvas.width - 22, 104);
      ctx.fillText(String(Math.round(this.rpm / 10) * 10), canvas.width - 22, 188);
      tex.needsUpdate = true;
    }
  }

  /** Front axle swing over uneven ground, tie rod fitted between the steering arms, driver's hands on the wheel. */
  private updateVisualRig(dt: number): void {
    if (this.frontAxle) {
      const [hFL, hFR] = this.wheelGroundY;
      const target = THREE.MathUtils.clamp(Math.atan2(hFL - hFR, this.trackWidth) - this.rollRad, -0.14, 0.14);
      this.axleSwing = THREE.MathUtils.lerp(this.axleSwing, target, Math.min(1, dt * 10));
      this.frontAxle.rotation.z = this.axleSwing;
    }
    if (this.tieRod && this.pivotFL && this.pivotFR && this.steerArmLocal.length === 2) {
      const endL = this.tmpA.copy(this.steerArmLocal[0]).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.steerAngleRad).add(this.pivotFL.position);
      const endR = this.tmpB.copy(this.steerArmLocal[1]).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.steerAngleRad).add(this.pivotFR.position);
      const d = this.tmpC.subVectors(endL, endR);
      this.tieRod.position.addVectors(endL, endR).multiplyScalar(0.5);
      this.tieRod.rotation.set(0, Math.atan2(-d.z, d.x), 0);
      this.tieRod.scale.set(d.length() / this.tieRodRestLen, 1, 1);
    }

    // Driver: hidden while the camera sits at the cab eye point; arms solved as two-bone chains to the rim
    this.driverHideSphere.set(0, -1e6, 0, 0);
    if (this.driverArms.length > 0) {
      const eye = this.tmpA.copy(this.cabCameraOffset).applyMatrix4(this.tractorRoot.matrixWorld);
      this.driverHideSphere.set(eye.x, eye.y, eye.z, this.driverSpec.hideRadius);
    }
    if (this.steeringWheel && this.steeringPivotNode) {
      const phi = THREE.MathUtils.clamp(this.steeringWheel.rotation.z - this.steeringWheelBaseRot.z, -1.1, 1.1);
      this.steeringPivotNode.updateMatrix();
      const L1 = this.driverSpec.upperArm;
      const L2 = this.driverSpec.foreArm;
      const down = this.tmpD.set(0, -1, 0);
      for (const arm of this.driverArms) {
        const a = arm.angle + phi;
        const hand = this.tmpA
          .set(Math.cos(a) * this.driverSpec.handRadius, Math.sin(a) * this.driverSpec.handRadius, -0.01)
          .applyMatrix4(this.steeringPivotNode.matrix);
        const toHand = this.tmpB.subVectors(hand, arm.shoulder);
        const dist = THREE.MathUtils.clamp(toHand.length(), 0.08, L1 + L2 - 0.004);
        toHand.normalize();
        const along = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
        const out = Math.sqrt(Math.max(L1 * L1 - along * along, 0));
        // elbows hang down and slightly outwards
        const pole = this.tmpC.set(arm.side * 0.5, -1, -0.1);
        pole.addScaledVector(toHand, -pole.dot(toHand)).normalize();
        const elbow = pole.multiplyScalar(out).addScaledVector(toHand, along).add(arm.shoulder);
        arm.upper.position.copy(arm.shoulder);
        arm.upper.quaternion.setFromUnitVectors(down, this.tmpB.subVectors(elbow, arm.shoulder).normalize());
        arm.fore.position.copy(elbow);
        // reach exactly to the rim even when the arm is fully stretched
        const tip = this.tmpB.copy(arm.shoulder).addScaledVector(toHand.subVectors(hand, arm.shoulder).normalize(), dist);
        arm.fore.quaternion.setFromUnitVectors(down, tip.sub(elbow).normalize());
      }
    }
  }

  private mountTrailerModel(model: THREE.Object3D, bake: THREE.Texture | null): void {
    this.trailerRoot.clear();
    this.tuneMaterials(model, bake);
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

    this.taillightGlows = [];
    this.trailerTaillightGlows = [];

    const hlGlowTex = createSoftGlowTexture('rgba(255,250,220,0.95)', 'rgba(255,235,175,0.42)');
    for (const off of this.headlightOffsets) {
      // Dipped beam: narrow cone aimed at the road ~11 m ahead, inverse-square falloff, nothing beyond 46 m.
      // Each lamp is toed out a little so the pair gives the wide, flat pattern of real low beams.
      // Penumbra 1: the intensity falls off from the axis over the whole cone. With 0.8 the cone's flank met
      // the road 2-4 m beside the bonnet at full inverse-square strength and cut off there: a crisp light oval
      // around the tractor in the chase view that read as a decal.
      const spot = new THREE.SpotLight(0xfff1cc, 0, 46, 0.42, 1.0, 2.0);
      // The manifest offset is the lamp face itself. A source sitting on (or a few mm behind) the lens lights
      // the lamp's own faces at inverse-square distances of millimetres: the HDR buffer overflows and bloom
      // smears it into a warm veil over the whole cab view at dusk. Emit from just in front of the lens.
      spot.position.set(off.x, off.y, off.z + LAMP_SOURCE_CLEARANCE);
      spot.castShadow = false;

      const target = new THREE.Object3D();
      target.position.set(off.x + Math.sign(off.x) * 1.9, -0.75, off.z + 14.5);
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

    // Rear cab work lamps: one soft spot that lights the hitch and the grape load behind the tractor
    // (soft flood: penumbra 1, so its pool on the road beside the trailer has no edge)
    if (this.workLightRearOffset) {
      const off = this.workLightRearOffset;
      const work = new THREE.SpotLight(0xfff4dc, 0, 11, 0.85, 1.0, 2.0);
      work.position.set(off.x, off.y, off.z - LAMP_SOURCE_CLEARANCE); // behind the rear-facing lamp face, see headlights
      work.castShadow = false;
      const target = new THREE.Object3D();
      target.position.set(0, 1.2, off.z - 4.2);
      this.tractorRoot.add(target);
      work.target = target;
      this.tractorRoot.add(work);
      this.workLightRear = work;
    }

    // Red tail lamp halos (tractor mudguard pods + trailer light bar)
    const tailGlowTex = createSoftGlowTexture('rgba(255,120,90,0.95)', 'rgba(255,40,20,0.40)');
    const addTailGlow = (parent: THREE.Object3D, off: THREE.Vector3, store: THREE.Sprite[]) => {
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: tailGlowTex,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0,
        })
      );
      glow.position.set(off.x, off.y, off.z - 0.05);
      glow.scale.set(0.42, 0.42, 1);
      parent.add(glow);
      store.push(glow);
    };
    for (const off of this.taillightOffsets) addTailGlow(this.tractorRoot, off, this.taillightGlows);
    for (const off of this.trailerTaillightOffsets) addTailGlow(this.trailerRoot, off, this.trailerTaillightGlows);

    // Amber Rundumleuchte beacon light + glow sprite
    const amberTex = createSoftGlowTexture('rgba(255,210,90,1.0)', 'rgba(255,130,15,0.55)');
    // A real rotating beacon throws a sweeping beam from its turning reflector. A spot aimed outwards and slightly
    // down does the same here, and (unlike the former omni light, which cast no shadow) it never lights the cab
    // interior or the hood through the roof below it.
    this.beaconLight = new THREE.SpotLight(0xff8c14, 0, 32, 0.5, 0.55, 1.7);
    this.beaconLight.position.set(this.beaconOffset.x, this.beaconOffset.y + 0.02, this.beaconOffset.z);
    this.beaconLight.castShadow = false;
    this.beaconTarget = new THREE.Object3D();
    this.beaconTarget.position.copy(this.beaconLight.position);
    this.beaconLight.target = this.beaconTarget;
    this.tractorRoot.add(this.beaconLight, this.beaconTarget);

    this.beaconGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: amberTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.9,
      })
    );
    this.beaconGlow.position.set(this.beaconOffset.x, this.beaconOffset.y + 0.03, this.beaconOffset.z);
    this.beaconGlow.scale.set(0.9, 0.9, 1);
    this.tractorRoot.add(this.beaconGlow);

    this.createBeamDecal();
    this.applyLightVisuals(false);
  }

  /**
   * Low-beam pattern on the road: an additive decal draped over the terrain in front of the tractor (the real
   * spot lights still light walls and objects; three cannot project a cookie without a shadow-casting spot).
   */
  private createBeamDecal(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('[tractor] 2D canvas context unavailable for the headlight beam pattern');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 256, 512);
    ctx.globalCompositeOperation = 'lighter';
    const lobe = (cx: number, cy: number, rx: number, ry: number, a: number) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(rx, ry);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, `rgba(255,240,205,${a})`);
      g.addColorStop(0.45, `rgba(255,232,190,${a * 0.42})`);
      g.addColorStop(1, 'rgba(255,225,180,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    };
    lobe(128, 330, 120, 230, 0.55); // wide spread
    lobe(108, 290, 46, 150, 0.6); // left lamp hot spot
    lobe(148, 290, 46, 150, 0.6); // right lamp hot spot
    lobe(128, 470, 70, 60, 0.35); // foreground spill
    // sharp-ish cut-off towards the far end, like a dipped beam
    ctx.globalCompositeOperation = 'destination-out';
    const cut = ctx.createLinearGradient(0, 0, 0, 120);
    cut.addColorStop(0, 'rgba(0,0,0,1)');
    cut.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cut;
    ctx.fillRect(0, 0, 256, 120);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(1, 1, 6, 14);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      fog: false,
    });
    this.beamDecal = new THREE.Mesh(geo, mat);
    this.beamDecal.name = 'HeadlightBeamDecal';
    this.beamDecal.frustumCulled = false;
    this.beamDecal.visible = false;
    this.group.add(this.beamDecal);
  }

  private updateBeamDecal(): void {
    const decal = this.beamDecal;
    if (!decal) return;
    const level = this.lightsOn ? 0.5 * this.nightFactor : 0;
    decal.visible = level > 0.01;
    if (!decal.visible) return;
    (decal.material as THREE.MeshBasicMaterial).opacity = level;
    const pos = decal.geometry.getAttribute('position') as THREE.BufferAttribute;
    const cosH = Math.cos(this.headingRad);
    const sinH = Math.sin(this.headingRad);
    const NX = 6;
    const NZ = 14;
    let i = 0;
    for (let r = 0; r <= NZ; r++) {
      const t = 1 - r / NZ; // first row = far end
      const lz = 2.9 + t * 21;
      const half = THREE.MathUtils.lerp(1.5, 5.6, t);
      for (let c = 0; c <= NX; c++) {
        const lx = THREE.MathUtils.lerp(half, -half, c / NX);
        const wx = this.x + lx * cosH + lz * sinH;
        const wz = this.z - lx * sinH + lz * cosH;
        pos.setXYZ(i++, wx, this.sampleSurfaceY(wx, wz) + 0.04, wz);
      }
    }
    pos.needsUpdate = true;
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
        boost: 1,
        vel: new THREE.Vector3(),
        age: 0,
        life: 1,
        baseScale: 0.25,
        maxScale: 1.2,
        active: false,
      });
    }

    for (let i = 0; i < 30; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: dustTex, transparent: true, opacity: 0, depthWrite: false })
      );
      sprite.visible = false;
      this.particleGroup.add(sprite);
      this.dustPool.push({
        sprite,
        boost: 1,
        vel: new THREE.Vector3(),
        age: 0,
        life: 1,
        baseScale: 0.45,
        maxScale: 1.8,
        active: false,
      });
    }
  }

  /**
   * Required wiring (src/main.ts): the road network's kerb / raised-sidewalk lift above
   * `terrain.getTerrainHeight`, i.e. `roadGroup.userData.getSurfaceLift`. Every wheel contact adds it.
   */
  public setSurfaceLiftSampler(fn: (x: number, z: number) => number): void {
    if (typeof fn !== 'function') {
      throw new Error('[tractor] setSurfaceLiftSampler needs a (x, z) => metres function (roadGroup.userData.getSurfaceLift)');
    }
    this.surfaceLift = fn;
  }

  private sampleSurfaceY(x: number, z: number): number {
    if (!this.surfaceLift) {
      throw new Error(
        '[tractor] no surface lift sampler: call tractor.setSurfaceLiftSampler(roadGroup.userData.getSurfaceLift) before loadModels()'
      );
    }
    // Draped roads sit ~0.07–0.11m above raw terrain height; span smoothly over the Kinderbach bridge deck too!
    const bridgeH = getBridgeDeckSurfaceHeight(x, z, this.terrain);
    const baseH = bridgeH !== null ? bridgeH : this.terrain.getTerrainHeight(x, z) + this.surfaceLift(x, z);
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

  /**
   * Time-of-day contract (see .gfx/BRIEF.md): called by the app on every preset / sun change.
   * nightFactor 0 = full daylight, 1 = darkest preset. Lamps keep their manual toggles; the factor only
   * scales how much they light the road and how strongly lenses and halos read against the ambient light.
   */
  public setTimeOfDay(_preset: TimeOfDayPreset, nightFactor: number): void {
    this.nightFactor = THREE.MathUtils.clamp(nightFactor, 0, 1);
    this.timeOfDayExplicit = true;
    this.applyLightVisuals(false);
  }

  /**
   * Quality contract (.gfx/review/FIXROUND.md): low = no small-part shadows, no loose berries beyond the
   * base layer, no mirror reflections; higher levels add them back.
   */
  public setQuality(level: 'low' | 'medium' | 'high' | 'ultra'): void {
    this.qualityLevel = level;
    const wheelsOnly = level === 'low';
    this.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.userData.khCastsShadow === undefined) return;
      const name = (o.material as THREE.Material).name?.toLowerCase() ?? '';
      o.castShadow = Boolean(o.userData.khCastsShadow) && (!wheelsOnly || /paint|tyre|galvan|grapes|chassis/.test(name));
    });
    this.applyQualityToExtras();
  }

  /** Until setTimeOfDay() is wired up, read the sun elevation of the scene's directional light. */
  private updateNightFactorFromSun(): void {
    if (this.timeOfDayExplicit) return;
    if (!this.sunLight) {
      let root: THREE.Object3D = this.group;
      while (root.parent) root = root.parent;
      root.traverse((o) => {
        if (!this.sunLight && o instanceof THREE.DirectionalLight) this.sunLight = o;
      });
      if (!this.sunLight) return;
    }
    this.tmpSunDir.copy(this.sunLight.position).sub(this.sunLight.target.position);
    if (this.tmpSunDir.lengthSq() < 1e-6) return;
    const sinElev = this.tmpSunDir.normalize().y;
    // 20 deg and higher = day, 6 deg (dusk preset) and lower = night
    this.nightFactor = 1 - THREE.MathUtils.smoothstep(sinElev, 0.105, 0.34);
  }

  private applyLightVisuals(isBraking: boolean): void {
    const night = this.nightFactor;
    const on = this.lightsOn;

    // Real light on the road: barely readable against the sun, full strength at dusk
    const spotIntensity = on ? 560 * (0.2 + 0.8 * night) : 0;
    for (const s of this.spotLights) {
      s.intensity = spotIntensity;
    }
    if (this.workLightRear) this.workLightRear.intensity = on ? 26 * (0.15 + 0.85 * night) : 0;

    for (const g of this.headlightGlows) {
      (g.material as THREE.SpriteMaterial).opacity = on ? 0.3 + 0.55 * night : 0;
      const sc = 0.5 + 0.38 * night;
      g.scale.set(sc, sc, 1);
    }
    for (const m of this.headlightMats) {
      m.emissive.setHex(0xfff0c4);
      m.emissiveIntensity = on ? 2.4 + 1.6 * night : 0.04;
    }
    const tailLevel = isBraking ? 3.2 : on ? 1.25 : 0.04;
    for (const m of this.taillightMats) {
      m.emissive.setHex(0xff1e10);
      m.emissiveIntensity = tailLevel;
    }
    const tailGlow = (isBraking ? 0.75 : on ? 0.4 : 0) * (0.3 + 0.7 * night);
    for (const g of this.taillightGlows) (g.material as THREE.SpriteMaterial).opacity = tailGlow;
    for (const g of this.trailerTaillightGlows) {
      (g.material as THREE.SpriteMaterial).opacity = this.trailerAttached ? tailGlow : 0;
    }
    // Instrument cluster / terminals: daylight readable, dimmed like real displays at night
    const displayLevel = THREE.MathUtils.lerp(1.0, 0.62, night);
    for (const m of this.displayMats) {
      m.emissiveIntensity = displayLevel;
    }
    for (const live of [this.clusterLive, this.terminalLive]) {
      live?.mat.color.setScalar(displayLevel);
    }
    // No emissive "fill" on the cab interior at dusk: a fixed emissive does not scale with the scene. At dusk
    // the outside radiance is ~0.01, so even 0.03 turned the black steering wheel and the dark trim cream-white
    // (and lit the cab like a lantern seen from behind). The interior is lit by the scene and the displays only.
    this.updateBeamDecal();
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
    this.wheelGroundY = [hFL, hFR, hRL, hRR]; // visual axle swing only

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
      // Clamp the hitch angle: beyond ~55° the tub's front corner would cut into the tractor's rear wheel
      // (tub front 1.07 m behind the eye, mudguards reach 0.12 m behind the hitch pin)
      let rel = Math.atan2(Math.sin(desiredYaw - this.headingRad), Math.cos(desiredYaw - this.headingRad));
      rel = THREE.MathUtils.clamp(rel, -MAX_HITCH_ANGLE_RAD, MAX_HITCH_ANGLE_RAD);
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
        slot.boost = 1;
        slot.baseScale = 0.22 + throttleLoad * 0.16;
        slot.maxScale = 0.95 + throttleLoad * 0.65;
        slot.sprite.position.copy(worldTip);
        slot.vel.set((Math.random() - 0.5) * 0.4, 1.45 + throttleLoad * 1.1, (Math.random() - 0.5) * 0.4);
        slot.sprite.visible = true;
      }
    }

    // 1b. Soot burst when the driver steps on it: three dark puffs in quick succession
    if (throttleLoad - this.lastThrottleLoad > 0.45) {
      this.tractorRoot.updateMatrixWorld(true);
      const worldTip = this.exhaustTipOffset.clone().applyMatrix4(this.tractorRoot.matrixWorld);
      for (let k = 0; k < 3; k++) {
        const slot = this.smokePool.find((p) => !p.active);
        if (!slot) break;
        slot.active = true;
        slot.age = -k * 0.07;
        slot.life = 1.3 + Math.random() * 0.5;
        slot.boost = 2.6;
        slot.baseScale = 0.3;
        slot.maxScale = 1.9 + k * 0.3;
        slot.sprite.position.copy(worldTip);
        slot.vel.set((Math.random() - 0.5) * 0.5, 2.4 + k * 0.4, (Math.random() - 0.5) * 0.5);
        slot.sprite.visible = true;
      }
    }
    this.lastThrottleLoad = THREE.MathUtils.lerp(this.lastThrottleLoad, throttleLoad, Math.min(1, dt * 3));

    // 2. Dust thrown up behind the driven wheels and the trailer bogie; builds with speed
    const absSpeed = Math.abs(this.speedMps);
    if (absSpeed > 1.8) {
      this.dustTimer += dt;
      const interval = THREE.MathUtils.lerp(0.12, 0.035, THREE.MathUtils.clamp((absSpeed - 1.8) / 8, 0, 1));
      if (this.dustTimer >= interval) {
        this.dustTimer = 0;
        const slot = this.dustPool.find((p) => !p.active);
        if (slot) {
          const pick = Math.random();
          const behind = this.speedMps >= 0 ? -1 : 1;
          let world: THREE.Vector3;
          if (pick < 0.62 || !this.trailerAttached) {
            this.tractorRoot.updateMatrixWorld(true);
            const side = Math.random() > 0.5 ? this.wheelRLPos : this.wheelRRPos;
            world = new THREE.Vector3(side.x, 0.18, side.z + behind * 0.55).applyMatrix4(this.tractorRoot.matrixWorld);
          } else {
            this.trailerRoot.updateMatrixWorld(true);
            world = new THREE.Vector3(Math.random() > 0.5 ? 0.88 : -0.88, 0.14, this.trailerAxleOffsetZ + behind * 0.9).applyMatrix4(
              this.trailerRoot.matrixWorld
            );
          }
          slot.active = true;
          slot.age = 0;
          slot.boost = 0.55 + 0.45 * THREE.MathUtils.clamp(absSpeed / 9, 0, 1);
          slot.life = 0.8 + Math.random() * 0.6;
          slot.baseScale = 0.35;
          slot.maxScale = 1.5 + Math.random() * 0.9;
          slot.sprite.position.copy(world);
          slot.vel.set((Math.random() - 0.5) * 0.9, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.9);
          slot.sprite.visible = true;
        }
      }
    }

    const advancePool = (pool: ParticleSlot[], maxOpacity: number) => {
      for (const p of pool) {
        if (!p.active) continue;
        p.age += dt;
        if (p.age < 0) continue; // delayed puff of a burst
        if (p.age >= p.life) {
          p.active = false;
          p.sprite.visible = false;
          continue;
        }
        const t = p.age / p.life;
        p.sprite.position.addScaledVector(p.vel, dt);
        const s = THREE.MathUtils.lerp(p.baseScale, p.maxScale, t);
        p.sprite.scale.set(s, s, 1);
        (p.sprite.material as THREE.SpriteMaterial).opacity = Math.min(0.85, Math.sin(t * Math.PI) * maxOpacity * p.boost);
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
    this.updateNightFactorFromSun();
    this.beaconPhase += safeDt * 9.5;
    if (this.beaconOn) {
      if (this.beaconNode) this.beaconNode.rotation.y = this.beaconPhase;
      const pulse = 0.55 + 0.45 * Math.sin(this.beaconPhase * 2.0);
      const night = this.nightFactor;
      // In daylight a rotating beacon is a bright lens, not a light source for its surroundings. The point light
      // casts no shadow, so any daytime residue would tint the shaded cab interior and the hood amber through
      // the roof: it only switches on as the sun goes down.
      if (this.beaconLight && this.beaconTarget) {
        this.beaconLight.intensity = 26 * night;
        // beam direction follows the reflector (node rotation.y), pitched ~13 deg below the horizon
        this.beaconTarget.position.set(
          this.beaconLight.position.x + Math.sin(this.beaconPhase) * 4,
          this.beaconLight.position.y - 0.92,
          this.beaconLight.position.z + Math.cos(this.beaconPhase) * 4
        );
      }
      if (this.beaconGlow) {
        (this.beaconGlow.material as THREE.SpriteMaterial).opacity = (0.35 + pulse * 0.5) * (0.45 + 0.55 * night);
        const s = (0.34 + pulse * 0.22) * (0.7 + 0.7 * night);
        this.beaconGlow.scale.set(s, s, 1);
      }
      for (const m of this.beaconMats) {
        m.emissive.setHex(0xff7d00);
        m.emissiveIntensity = 0.9 + pulse * 2.4;
      }
    } else {
      if (this.beaconLight) this.beaconLight.intensity = 0;
      if (this.beaconGlow) (this.beaconGlow.material as THREE.SpriteMaterial).opacity = 0;
      for (const m of this.beaconMats) {
        m.emissiveIntensity = 0.05;
      }
    }

    this.applyLightVisuals(isBraking);
    this.updateVisualRig(safeDt);
    this.updateHoses();
    this.updateMirrorReflectors();
    this.updateLiveDisplays(safeDt);
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
