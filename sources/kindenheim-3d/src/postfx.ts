import * as THREE from 'three';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { QualityConfig } from './renderQuality';
import { AERIAL_GLSL, SKY_LUT_SAMPLE_GLSL, type SkyAtmosphere } from './skyAtmosphere';

/**
 * Kindenheim 3D frame pipeline (HDR, linear, scene-referred until the very last step):
 *
 *   scene → MSAA half-float target (+ depth)
 *         → GTAO (reduced resolution, depth only)
 *         → bloom (13-tap downsample chain, energy conserving)
 *         → final: ambient occlusion · aerial perspective / height haze · bloom · exposure · AgX · grade · sRGB
 *         → FXAA or supersample resolve → canvas
 */

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BLOOM_DOWN_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  uniform float uClamp;
  vec3 s(float x, float y) {
    vec3 c = texture2D(tSrc, vUv + vec2(x, y) * uTexel).rgb;
    if (uClamp > 0.0) {
      float m = max(c.r, max(c.g, c.b));
      c *= min(1.0, uClamp / max(m, 1e-4));
    }
    return c;
  }
  void main() {
    vec3 a = s(-2.0, 2.0), b = s(0.0, 2.0), c = s(2.0, 2.0);
    vec3 d = s(-2.0, 0.0), e = s(0.0, 0.0), f = s(2.0, 0.0);
    vec3 g = s(-2.0, -2.0), h = s(0.0, -2.0), i = s(2.0, -2.0);
    vec3 j = s(-1.0, 1.0), k = s(1.0, 1.0), l = s(-1.0, -1.0), m = s(1.0, -1.0);
    vec3 r = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
    gl_FragColor = vec4(max(r, vec3(0.0)), 1.0);
  }
`;

const BLOOM_UP_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tLow;   // coarser, already accumulated level
  uniform sampler2D tHigh;  // this level's downsample
  uniform vec2 uTexel;      // texel size of the coarser level
  uniform float uMix;
  void main() {
    vec2 o = uTexel;
    vec3 low =
      texture2D(tLow, vUv).rgb * 4.0 +
      (texture2D(tLow, vUv + vec2(o.x, 0.0)).rgb + texture2D(tLow, vUv - vec2(o.x, 0.0)).rgb +
       texture2D(tLow, vUv + vec2(0.0, o.y)).rgb + texture2D(tLow, vUv - vec2(0.0, o.y)).rgb) * 2.0 +
      texture2D(tLow, vUv + o).rgb + texture2D(tLow, vUv - o).rgb +
      texture2D(tLow, vUv + vec2(o.x, -o.y)).rgb + texture2D(tLow, vUv + vec2(-o.x, o.y)).rgb;
    low *= 1.0 / 16.0;
    gl_FragColor = vec4(mix(texture2D(tHigh, vUv).rgb, low, uMix), 1.0);
  }
`;

/**
 * Final pass: ambient occlusion + aerial perspective on the resolved HDR scene, bloom, then the film
 * response (exposure → AgX → look → sRGB → dither). One full-resolution pass instead of two.
 */
const FINAL_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform highp sampler2D tDepth;
  uniform sampler2D tAO;
  uniform sampler2D uSkyLUT;
  uniform mat4 uProjInv;
  uniform mat4 uCamWorld;
  uniform vec3 uCamPos;
  uniform float uAoIntensity;
  uniform sampler2D tBloom;
  ${SKY_LUT_SAMPLE_GLSL}
  ${AERIAL_GLSL}
  uniform float uBloom;
  uniform float uExposure;
  uniform float uContrast;
  uniform float uBlackLift;
  uniform float uSaturation;
  uniform vec3 uWhiteBalance;
  uniform vec3 uShadowTint;
  uniform vec3 uHighlightTint;
  uniform float uVignette;
  uniform float uAspect;

  const mat3 SRGB_TO_REC2020 = mat3(
    vec3(0.6274, 0.0691, 0.0164),
    vec3(0.3293, 0.9195, 0.0880),
    vec3(0.0433, 0.0113, 0.8956)
  );
  const mat3 REC2020_TO_SRGB = mat3(
    vec3(1.6605, -0.1246, -0.0182),
    vec3(-0.5876, 1.1329, -0.1006),
    vec3(-0.0728, -0.0083, 1.1187)
  );
  const mat3 AGX_INSET = mat3(
    vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
    vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
    vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859)
  );
  const mat3 AGX_OUTSET = mat3(
    vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
    vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
    vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405)
  );

  vec3 agxContrast(vec3 x) {
    vec3 x2 = x * x;
    vec3 x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  }

  // AgX (Blender/Filament formulation, as in three.js) with an ASC-CDL style "look" applied in AgX space.
  vec3 khAgx(vec3 color) {
    const float minEv = -12.47393;
    const float maxEv = 4.026069;
    color = SRGB_TO_REC2020 * color;
    color = AGX_INSET * color;
    color = max(color, 1e-10);
    color = (log2(color) - minEv) / (maxEv - minEv);
    color = clamp(color, 0.0, 1.0);
    color = agxContrast(color);

    // look: contrast (power), split toning, saturation
    color = pow(max(color, vec3(0.0)), vec3(uContrast));
    // toe lift (veiling glare of a real lens): the deepest shadows keep some separation instead of clipping
    color = uBlackLift + (1.0 - uBlackLift) * color;
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color *= mix(uShadowTint, uHighlightTint, smoothstep(0.05, 0.75, luma));
    luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = luma + uSaturation * (color - luma);

    color = AGX_OUTSET * color;
    color = pow(max(vec3(0.0), color), vec3(2.2));
    color = REC2020_TO_SRGB * color;
    return clamp(color, 0.0, 1.0);
  }

  float khNoise(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
  }

  void main() {
    vec3 hdr = texture2D(tScene, vUv).rgb;
    float depth = texture2D(tDepth, vUv).x;
    if (depth < 0.99999995) {
      vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vp /= vp.w;
      vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
      vec3 ray = wp - uCamPos;
      float dist = length(ray);
      // (AO and bloom are switched by uniforms, not defines: a quality change never recompiles this pass)
      if (uAoIntensity > 0.0) {
        float ao = texture2D(tAO, vUv).r;
        float sceneLuma = dot(hdr, vec3(0.2126, 0.7152, 0.0722));
        // Occlusion belongs to ambient light: fade it on pixels that are clearly lit by the sun. It is also
        // faded out in the distance, where it is sub-pixel anyway and depth precision would turn it into streaks.
        float k = uAoIntensity * (1.0 - 0.65 * smoothstep(0.45, 1.5, sceneLuma)) * (1.0 - smoothstep(180.0, 420.0, dist));
        hdr *= mix(1.0, ao, k);
      }
      vec3 dir = ray / max(dist, 1e-3);
      hdr = khAerialPerspective(hdr, dir, dist, uCamPos.y);
      // The outermost real ground dissolves into the endless plain the sky dome draws beyond it.
      float edgeDist = uWorldEdge.z > 0.5 ? length(wp.xz) : max(abs(wp.x), abs(wp.z));
      float edgeFade = smoothstep(uWorldEdge.x, uWorldEdge.y, edgeDist);
      if (edgeFade > 0.0) hdr = mix(hdr, khBeyond(dir, uCamPos, dist), edgeFade);
    }
    if (uBloom > 0.0) hdr = mix(hdr, texture2D(tBloom, vUv).rgb, uBloom);
    // natural lens falloff, applied to scene light before the film response
    vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
    float falloff = 1.0 - uVignette * smoothstep(0.12, 1.05, dot(q, q) * 1.6);
    vec3 c = khAgx(hdr * uWhiteBalance * (uExposure * falloff));
    // sRGB OETF
    c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
    // triangular dither against banding in sky gradients
    float n = khNoise(gl_FragCoord.xy) + khNoise(gl_FragCoord.xy + vec2(31.0, 17.0)) - 1.0;
    c += n / 255.0;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const RESOLVE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tLdr;
  uniform vec2 uSrcTexel;
  uniform float uSpread;
  void main() {
    vec2 o = uSrcTexel * uSpread;
    vec3 c = texture2D(tLdr, vUv + o).rgb + texture2D(tLdr, vUv - o).rgb +
             texture2D(tLdr, vUv + vec2(o.x, -o.y)).rgb + texture2D(tLdr, vUv + vec2(-o.x, o.y)).rgb;
    gl_FragColor = vec4(c * 0.25, 1.0);
  }
`;

const BLOOM_LEVELS = 6;

export interface FogSettings {
  /** haze (Mie) extinction per metre at ground level */
  mieExtPerM: number;
  hazeHeightM: number;
  mistExtPerM: number;
  mistHeightM: number;
  groundY: number;
  amount: number;
}

export interface GradeSettings {
  contrast: number;
  saturation: number;
  whiteBalance: THREE.Vector3;
  shadowTint: THREE.Vector3;
  highlightTint: THREE.Vector3;
  vignette: number;
  bloom: number;
  aoIntensity: number;
  /** Toe lift in the film response: the darkest tones are raised to this (AgX space, 0 = none). */
  blackLift: number;
}

export class RenderPipeline {
  public readonly fog: FogSettings = {
    mieExtPerM: 6e-5,
    hazeHeightM: 1200,
    mistExtPerM: 0,
    mistHeightM: 60,
    groundY: 0,
    amount: 1,
  };

  public readonly grade: GradeSettings = {
    contrast: 1.16,
    saturation: 1.2,
    whiteBalance: new THREE.Vector3(1, 1, 1),
    shadowTint: new THREE.Vector3(1, 1, 1),
    highlightTint: new THREE.Vector3(1, 1, 1),
    vignette: 0.16,
    bloom: 0.045,
    aoIntensity: 0.9,
    blackLift: 0,
  };

  /** Dynamic resolution on/off (off for clean captures and benchmarks that need a fixed resolution). */
  public dynamicResolution = true;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sky: SkyAtmosphere;
  private readonly quad = new FullScreenQuad();

  private quality: QualityConfig;
  private cssWidth = 1;
  private cssHeight = 1;
  private internalWidth = 1;
  private internalHeight = 1;
  private superSample = 1;
  private msaaSamples = 0;

  // dynamic resolution state
  private resolutionScale = 1;
  private frameEma = 16.7;
  private overBudgetMs = 0;
  private sinceChangeMs = 0;
  /** a scale that just proved too expensive is not retried before this much time has passed */
  private ceilingScale = 1;
  private ceilingHoldMs = 0;

  private readonly sceneTarget: THREE.WebGLRenderTarget;
  private readonly depthTexture: THREE.DepthTexture;
  private readonly ldrTarget: THREE.WebGLRenderTarget;
  /** second display-referred target for FXAA before an upscale */
  private readonly ldrTarget2: THREE.WebGLRenderTarget;
  private readonly bloomDown: THREE.WebGLRenderTarget[] = [];
  private readonly bloomUp: THREE.WebGLRenderTarget[] = [];
  private readonly gtao: GTAOPass;
  private readonly whiteTexture: THREE.DataTexture;
  private warmedUp = false;

  private readonly bloomDownMat: THREE.ShaderMaterial;
  private readonly bloomUpMat: THREE.ShaderMaterial;
  private readonly tonemapMat: THREE.ShaderMaterial;
  private readonly resolveMat: THREE.ShaderMaterial;
  private readonly fxaaMat: THREE.ShaderMaterial;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    sky: SkyAtmosphere,
    quality: QualityConfig
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.sky = sky;
    this.quality = quality;

    const base = { vertexShader: FULLSCREEN_VERT, depthTest: false, depthWrite: false, toneMapped: false };
    this.bloomDownMat = new THREE.ShaderMaterial({
      ...base,
      name: 'KH_BloomDown',
      fragmentShader: BLOOM_DOWN_FRAG,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uClamp: { value: 0 } },
    });
    this.bloomUpMat = new THREE.ShaderMaterial({
      ...base,
      name: 'KH_BloomUp',
      fragmentShader: BLOOM_UP_FRAG,
      uniforms: {
        tLow: { value: null },
        tHigh: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uMix: { value: 0.62 },
      },
    });
    this.tonemapMat = new THREE.ShaderMaterial({
      ...base,
      name: 'KH_FinalGrade',
      fragmentShader: FINAL_FRAG,
      uniforms: {
        tScene: { value: null },
        tDepth: { value: null },
        tAO: { value: null },
        uSkyLUT: sky.uniforms.uSkyLUT,
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uAoIntensity: { value: 1 },
        uBetaR: sky.uniforms.uBetaR,
        uMieExt: sky.uniforms.uMieExt,
        uHazeH: sky.uniforms.uHazeH,
        uMistExt: sky.uniforms.uMistExt,
        uMistH: sky.uniforms.uMistH,
        uFogGroundY: sky.uniforms.uFogGroundY,
        uFogAmount: sky.uniforms.uFogAmount,
        uPlainRadiance: sky.uniforms.uPlainRadiance,
        uWorldEdge: sky.uniforms.uWorldEdge,
        uPlainTex: sky.uniforms.uPlainTex,
        uPlainInfo: sky.uniforms.uPlainInfo,
        uEdgeH: sky.uniforms.uEdgeH,
        tBloom: { value: null },
        uBloom: { value: 0.05 },
        uExposure: { value: 1 },
        uContrast: { value: 1.15 },
        uBlackLift: { value: 0 },
        uSaturation: { value: 1.2 },
        uWhiteBalance: { value: new THREE.Vector3(1, 1, 1) },
        uShadowTint: { value: new THREE.Vector3(1, 1, 1) },
        uHighlightTint: { value: new THREE.Vector3(1, 1, 1) },
        uVignette: { value: 0.15 },
        uAspect: { value: 1.6 },
      },
    });
    this.resolveMat = new THREE.ShaderMaterial({
      ...base,
      name: 'KH_Resolve',
      fragmentShader: RESOLVE_FRAG,
      uniforms: { tLdr: { value: null }, uSrcTexel: { value: new THREE.Vector2() }, uSpread: { value: 0.5 } },
    });
    this.fxaaMat = new THREE.ShaderMaterial({
      ...base,
      name: 'KH_FXAA',
      vertexShader: FXAAShader.vertexShader,
      fragmentShader: FXAAShader.fragmentShader,
      uniforms: { tDiffuse: { value: null }, resolution: { value: new THREE.Vector2() } },
    });

    this.whiteTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.whiteTexture.needsUpdate = true;

    // All targets are created once and only ever resized: quality changes, window resizes and dynamic
    // resolution never rebuild passes or recompile shaders.
    this.depthTexture = new THREE.DepthTexture(2, 2);
    this.depthTexture.format = THREE.DepthFormat;
    this.depthTexture.type = THREE.UnsignedIntType;
    this.depthTexture.minFilter = THREE.NearestFilter;
    this.depthTexture.magFilter = THREE.NearestFilter;
    this.sceneTarget = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      samples: 0,
      depthBuffer: true,
      depthTexture: this.depthTexture,
      generateMipmaps: false,
    });
    this.sceneTarget.texture.name = 'KH.sceneHDR';
    const hdrOpts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    } as const;
    const ldrOpts = { ...hdrOpts, type: THREE.UnsignedByteType } as const;
    this.ldrTarget = new THREE.WebGLRenderTarget(2, 2, ldrOpts);
    this.ldrTarget.texture.name = 'KH.display';
    this.ldrTarget2 = new THREE.WebGLRenderTarget(2, 2, ldrOpts);
    this.ldrTarget2.texture.name = 'KH.displayAA';
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      this.bloomDown.push(new THREE.WebGLRenderTarget(2, 2, hdrOpts));
      if (i < BLOOM_LEVELS - 1) this.bloomUp.push(new THREE.WebGLRenderTarget(2, 2, hdrOpts));
    }

    // three 0.172: passing the depth texture to the constructor crashes (normalRenderTarget is undefined in
    // setGBuffer), so construct with the internal G-buffer (never rendered → never allocated on the GPU) and
    // switch to our resolved scene depth afterwards. Normals are reconstructed from depth.
    this.gtao = new GTAOPass(scene, camera, 2, 2);
    this.gtao.setGBuffer(this.depthTexture, undefined);
    this.gtao.gtaoMaterial.needsUpdate = true;
    this.gtao.pdMaterial.needsUpdate = true;
    this.gtao.output = GTAOPass.OUTPUT.Off;
    this.gtao.updateGtaoMaterial({
      radius: 1.6,
      distanceExponent: 1.6,
      thickness: 1.4,
      distanceFallOff: 1.0,
      scale: 1.25,
      samples: 12,
      screenSpaceRadius: false,
    });
    this.gtao.updatePdMaterial({
      lumaPhi: 10,
      depthPhi: 2,
      normalPhi: 3,
      radius: 5,
      radiusExponent: 1.4,
      rings: 2,
      samples: 12,
    });

    // Whole-frame statistics (the pipeline issues several render calls per frame).
    this.renderer.info.autoReset = false;
  }

  public get internalSize(): {
    width: number;
    height: number;
    superSample: number;
    msaa: number;
    resolutionScale: number;
  } {
    return {
      width: this.internalWidth,
      height: this.internalHeight,
      superSample: this.superSample,
      msaa: this.msaaSamples,
      resolutionScale: this.resolutionScale,
    };
  }

  /** The HDR scene target (programs must be compiled against it, see `renderer.compileAsync`). */
  public get sceneRenderTarget(): THREE.WebGLRenderTarget {
    return this.sceneTarget;
  }

  public setQuality(quality: QualityConfig): void {
    this.quality = quality;
    this.resolutionScale = Math.max(this.resolutionScale, quality.minResolutionScale);
    this.ceilingScale = 1;
    this.ceilingHoldMs = 0;
    this.resizeTargets();
    this.sky.setCloudQuality(quality.cloudSteps, quality.cloudPanoramaWidth);
  }

  public setSize(cssWidth: number, cssHeight: number): void {
    this.cssWidth = Math.max(1, Math.floor(cssWidth));
    this.cssHeight = Math.max(1, Math.floor(cssHeight));
    this.resizeTargets();
    if (!this.warmedUp) {
      this.warmedUp = true;
      this.sky.setCloudQuality(this.quality.cloudSteps, this.quality.cloudPanoramaWidth);
      this.warmUp();
    }
  }

  /**
   * Feeds one real frame time (ms between two animation frames). When frames stay over budget the internal
   * resolution steps down (never below the level's minResolutionScale); with headroom it steps back up.
   * A step that immediately proves too expensive is not retried for a while, so it cannot oscillate.
   */
  public reportFrameTime(frameMs: number): void {
    if (!this.dynamicResolution || this.quality.minResolutionScale >= 1) return;
    if (frameMs > 150 || frameMs <= 0) return; // tab switch / hitch: says nothing about steady-state cost
    this.frameEma += (frameMs - this.frameEma) * 0.06;
    this.sinceChangeMs += frameMs;
    this.ceilingHoldMs = Math.max(0, this.ceilingHoldMs - frameMs);
    const OVER = 19.2; // ≈ 52 fps
    const UNDER = 17.4; // at or below a 60 Hz refresh
    this.overBudgetMs = this.frameEma > OVER ? this.overBudgetMs + frameMs : 0;
    const STEP = 0.1;
    if (this.overBudgetMs > 700 && this.sinceChangeMs > 900 && this.resolutionScale > this.quality.minResolutionScale + 1e-3) {
      if (this.sinceChangeMs < 4000) {
        // we just tried this scale and it does not hold: remember it as too expensive for a while
        this.ceilingScale = this.resolutionScale - STEP;
        this.ceilingHoldMs = 45_000;
      }
      this.applyResolutionScale(Math.max(this.quality.minResolutionScale, this.resolutionScale - STEP));
    } else if (this.frameEma < UNDER && this.sinceChangeMs > 5000 && this.resolutionScale < 1 - 1e-3) {
      const limit = this.ceilingHoldMs > 0 ? this.ceilingScale : 1;
      if (this.resolutionScale + STEP <= limit + 1e-3) this.applyResolutionScale(Math.min(1, this.resolutionScale + STEP));
    }
  }

  private applyResolutionScale(scale: number): void {
    this.resolutionScale = Math.round(scale * 100) / 100;
    this.sinceChangeMs = 0;
    this.overBudgetMs = 0;
    // start the average from the budget so the new scale is judged on its own frames
    this.frameEma = 17.5;
    this.resizeTargets();
  }

  private resizeTargets(): void {
    const q = this.quality;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, q.maxPixelRatio);
    if (this.renderer.getPixelRatio() !== pixelRatio) this.renderer.setPixelRatio(pixelRatio);
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== this.cssWidth || size.y !== this.cssHeight) {
      // The stylesheet sizes the canvas (100 % of the window); only the drawing buffer is set here, so the
      // picture keeps filling the window while a debounced resize is still pending.
      this.renderer.setSize(this.cssWidth, this.cssHeight, false);
      const style = this.renderer.domElement.style;
      style.removeProperty('width');
      style.removeProperty('height');
    }

    const canvasW = Math.max(1, Math.floor(this.cssWidth * pixelRatio));
    const canvasH = Math.max(1, Math.floor(this.cssHeight * pixelRatio));
    // Internal resolution: supersample low-density screens up to the target scale, and never exceed the
    // pixel budget of the quality level (very large / retina windows then render slightly below native).
    let ss = Math.max(1, q.targetScale / pixelRatio);
    const maxSs = Math.sqrt(q.maxInternalPixels / (canvasW * canvasH));
    ss = Math.min(ss, maxSs) * this.resolutionScale;
    ss = Math.max(0.4, ss);
    const maxTex = this.renderer.capabilities.maxTextureSize;
    ss = Math.min(ss, maxTex / canvasW, maxTex / canvasH);
    this.superSample = ss;
    const w = Math.max(2, Math.round(canvasW * ss));
    const h = Math.max(2, Math.round(canvasH * ss));
    this.internalWidth = w;
    this.internalHeight = h;

    // Dense (retina) pixels need less multisampling than supersampled low-density ones.
    const wantedSamples = pixelRatio >= 1.75 ? q.msaaHighDensity : q.msaa;
    const samples = Math.min(wantedSamples, this.renderer.capabilities.maxSamples);
    this.msaaSamples = samples;
    if (this.sceneTarget.samples !== samples) {
      this.sceneTarget.samples = samples;
      this.sceneTarget.dispose();
    }
    this.sceneTarget.setSize(w, h);
    this.ldrTarget.setSize(w, h);
    this.ldrTarget2.setSize(w, h);
    let bw = w;
    let bh = h;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      bw = Math.max(2, Math.floor(bw / 2));
      bh = Math.max(2, Math.floor(bh / 2));
      this.bloomDown[i].setSize(bw, bh);
      if (i < BLOOM_LEVELS - 1) this.bloomUp[i].setSize(bw, bh);
    }
    // AO is low-frequency: cap its buffer so it does not grow with supersampling / retina resolutions
    const aoScale = Math.min(q.aoScale, Math.sqrt(q.aoMaxPixels / (w * h)));
    const aw = Math.max(2, Math.round(w * aoScale));
    const ah = Math.max(2, Math.round(h * aoScale));
    if (this.gtao.width !== aw || this.gtao.height !== ah) this.gtao.setSize(aw, ah);
  }

  /**
   * Compiles every post-processing program once (all quality variants use the same programs), so the first
   * switch to another quality level does not stall.
   */
  private warmUp(): void {
    const renderer = this.renderer;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    const tiny = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false });
    this.tonemapMat.uniforms.tAO.value = this.whiteTexture;
    this.tonemapMat.uniforms.tBloom.value = this.whiteTexture;
    this.tonemapMat.uniforms.tScene.value = this.whiteTexture;
    this.tonemapMat.uniforms.tDepth.value = this.depthTexture;
    this.bloomDownMat.uniforms.tSrc.value = this.whiteTexture;
    this.bloomUpMat.uniforms.tLow.value = this.whiteTexture;
    this.bloomUpMat.uniforms.tHigh.value = this.whiteTexture;
    this.resolveMat.uniforms.tLdr.value = this.whiteTexture;
    this.fxaaMat.uniforms.tDiffuse.value = this.whiteTexture;
    for (const mat of [this.bloomDownMat, this.bloomUpMat, this.tonemapMat, this.resolveMat, this.fxaaMat]) {
      this.pass(mat, tiny);
    }
    // the scene target has to exist on the GPU before its depth texture can be read by the AO pass
    renderer.setRenderTarget(this.sceneTarget);
    renderer.clear();
    this.gtao.render(renderer, tiny, this.sceneTarget, 0, false);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
    tiny.dispose();
  }

  private pass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.renderer.setRenderTarget(target);
    this.quad.material = material;
    this.quad.render(this.renderer);
  }

  public render(): void {
    const renderer = this.renderer;
    const sceneTarget = this.sceneTarget;
    const ldrTarget = this.ldrTarget;
    if (!this.warmedUp) {
      throw new Error('[RenderPipeline] render() called before setSize().');
    }
    const q = this.quality;
    renderer.info.reset();

    // haze settings live in uniforms shared by the sky dome and the final pass
    const su = this.sky.uniforms;
    su.uMieExt.value = this.fog.mieExtPerM;
    su.uHazeH.value = this.fog.hazeHeightM;
    su.uMistExt.value = this.fog.mistExtPerM;
    su.uMistH.value = this.fog.mistHeightM;
    su.uFogGroundY.value = this.fog.groundY;
    su.uFogAmount.value = this.fog.amount;
    this.sky.setCamera(this.camera);

    // 1 — scene, linear HDR, multisampled
    renderer.setRenderTarget(sceneTarget);
    renderer.render(this.scene, this.camera);

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    // 2 — ambient occlusion from the resolved depth buffer
    const aoOn = q.ambientOcclusion && this.grade.aoIntensity > 0;
    if (aoOn) this.gtao.render(renderer, ldrTarget, sceneTarget, 0, false);

    // 3 — bloom
    let bloomTexture: THREE.Texture = this.whiteTexture;
    const bloomOn = q.bloom && this.grade.bloom > 0;
    if (bloomOn) {
      const du = this.bloomDownMat.uniforms;
      let src: THREE.WebGLRenderTarget = sceneTarget;
      for (let i = 0; i < BLOOM_LEVELS; i++) {
        du.tSrc.value = src.texture;
        (du.uTexel.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
        // clamp fireflies, but leave the solar disk enough energy for a visible glare
        du.uClamp.value = i === 0 ? 220 : 0;
        this.pass(this.bloomDownMat, this.bloomDown[i]);
        src = this.bloomDown[i];
      }
      const uu = this.bloomUpMat.uniforms;
      let low: THREE.WebGLRenderTarget = this.bloomDown[BLOOM_LEVELS - 1];
      for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
        uu.tLow.value = low.texture;
        uu.tHigh.value = this.bloomDown[i].texture;
        (uu.uTexel.value as THREE.Vector2).set(1 / low.width, 1 / low.height);
        this.pass(this.bloomUpMat, this.bloomUp[i]);
        low = this.bloomUp[i];
      }
      bloomTexture = low.texture;
    }

    // 4 — AO + aerial perspective + world edge + bloom + film response + grade
    const tu = this.tonemapMat.uniforms;
    tu.tScene.value = sceneTarget.texture;
    tu.tDepth.value = this.depthTexture;
    tu.tAO.value = aoOn ? this.gtao.gtaoMap : this.whiteTexture;
    (tu.uProjInv.value as THREE.Matrix4).copy(this.camera.projectionMatrixInverse);
    (tu.uCamWorld.value as THREE.Matrix4).copy(this.camera.matrixWorld);
    (tu.uCamPos.value as THREE.Vector3).setFromMatrixPosition(this.camera.matrixWorld);
    tu.uAoIntensity.value = aoOn ? this.grade.aoIntensity : 0;
    tu.tBloom.value = bloomTexture;
    tu.uBloom.value = bloomOn ? this.grade.bloom : 0;
    tu.uExposure.value = renderer.toneMappingExposure;
    tu.uContrast.value = this.grade.contrast;
    tu.uBlackLift.value = this.grade.blackLift;
    tu.uSaturation.value = this.grade.saturation;
    (tu.uWhiteBalance.value as THREE.Vector3).copy(this.grade.whiteBalance);
    (tu.uShadowTint.value as THREE.Vector3).copy(this.grade.shadowTint);
    (tu.uHighlightTint.value as THREE.Vector3).copy(this.grade.highlightTint);
    tu.uVignette.value = this.grade.vignette;
    tu.uAspect.value = this.internalWidth / this.internalHeight;

    // 5 — to the canvas: supersample resolve, FXAA, or straight
    const canvasPixels = this.renderer.domElement.width * this.renderer.domElement.height;
    const rescaled = Math.abs(this.internalWidth * this.internalHeight - canvasPixels) > canvasPixels * 0.01;
    if (rescaled) {
      this.pass(this.tonemapMat, ldrTarget);
      let resolveSource = ldrTarget;
      if (this.superSample < 0.999 && q.fxaa) {
        // rendering below canvas resolution: anti-alias first, then upscale
        const fu = this.fxaaMat.uniforms;
        fu.tDiffuse.value = ldrTarget.texture;
        (fu.resolution.value as THREE.Vector2).set(1 / ldrTarget.width, 1 / ldrTarget.height);
        this.pass(this.fxaaMat, this.ldrTarget2);
        resolveSource = this.ldrTarget2;
      }
      const ru = this.resolveMat.uniforms;
      ru.tLdr.value = resolveSource.texture;
      (ru.uSrcTexel.value as THREE.Vector2).set(1 / ldrTarget.width, 1 / ldrTarget.height);
      ru.uSpread.value = this.superSample > 1 ? 0.25 * this.superSample : 0.0;
      this.pass(this.resolveMat, null);
    } else if (q.fxaa) {
      this.pass(this.tonemapMat, ldrTarget);
      const fu = this.fxaaMat.uniforms;
      fu.tDiffuse.value = ldrTarget.texture;
      (fu.resolution.value as THREE.Vector2).set(1 / ldrTarget.width, 1 / ldrTarget.height);
      this.pass(this.fxaaMat, null);
    } else {
      this.pass(this.tonemapMat, null);
    }

    renderer.setRenderTarget(null);
    renderer.autoClear = prevAutoClear;
  }
}
