import * as THREE from 'three';
import type { TimeOfDayPreset } from './types';

interface LightingPresetConfig {
  elevationDeg: number;
  azimuthDeg: number;
  skyZenith: number;
  skyMid: number;
  skyHorizon: number;
  sunGlowColor: number;
  cloudLitColor: number;
  cloudShadeColor: number;
  cloudCoverage: number;
  cloudDensity: number;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  envIntensity: number;
  fogColor: number;
  fogDensity: number;
  exposure: number;
}

const PRESETS: Record<TimeOfDayPreset, LightingPresetConfig> = {
  morning: {
    elevationDeg: 20,
    azimuthDeg: 112,
    skyZenith: 0x4f84ca,
    skyMid: 0x8bb6e3,
    skyHorizon: 0xdce6f0,
    sunGlowColor: 0xfff0d4,
    cloudLitColor: 0xfffaf2,
    cloudShadeColor: 0xb7c6d8,
    cloudCoverage: 0.44,
    cloudDensity: 0.78,
    sunColor: 0xffe9cc,
    sunIntensity: 2.55,
    hemiSky: 0xa4c8ee,
    hemiGround: 0x5c5748,
    hemiIntensity: 0.72,
    envIntensity: 0.44,
    fogColor: 0xcfdce9,
    fogDensity: 0.00022,
    exposure: 0.94,
  },
  noon: {
    // Calibrated directly to measured Aug-2023 Kindenheim Street View sky mean (#B1BFD4) & bright summer daylight!
    elevationDeg: 54,
    azimuthDeg: 162,
    skyZenith: 0x6f9ad0,
    skyMid: 0xa2c0e2,
    skyHorizon: 0xdce6f1,
    sunGlowColor: 0xfffef8,
    cloudLitColor: 0xf6f9fc,
    cloudShadeColor: 0xc2d0df,
    cloudCoverage: 0.56,
    cloudDensity: 0.85,
    sunColor: 0xfffaf0,
    sunIntensity: 2.75,
    hemiSky: 0xdbe7f5,
    hemiGround: 0x9b9282,
    hemiIntensity: 1.28,
    envIntensity: 0.58,
    fogColor: 0xd4e2f0,
    fogDensity: 0.00010,
    exposure: 0.98,
  },
  golden: {
    elevationDeg: 22,
    azimuthDeg: 236,
    skyZenith: 0x5682be,
    skyMid: 0x94b2d4,
    skyHorizon: 0xebd0aa,
    sunGlowColor: 0xffd79b,
    cloudLitColor: 0xfff3dc,
    cloudShadeColor: 0xb0bacb,
    cloudCoverage: 0.48,
    cloudDensity: 0.80,
    sunColor: 0xffd89e,
    sunIntensity: 2.7,
    hemiSky: 0xc6d8ec,
    hemiGround: 0x76664f,
    hemiIntensity: 0.92,
    envIntensity: 0.48,
    fogColor: 0xdfd0ba,
    fogDensity: 0.00018,
    exposure: 0.96,
  },
  dusk: {
    elevationDeg: 6.0,
    azimuthDeg: 256,
    skyZenith: 0x1d2e57,
    skyMid: 0x445d8c,
    skyHorizon: 0xd28558,
    sunGlowColor: 0xff9b56,
    cloudLitColor: 0xf0a87b,
    cloudShadeColor: 0x3c4c70,
    cloudCoverage: 0.48,
    cloudDensity: 0.82,
    sunColor: 0xff9d5c,
    sunIntensity: 1.25,
    hemiSky: 0x5c79a8,
    hemiGround: 0x332c26,
    hemiIntensity: 0.74,
    envIntensity: 0.30,
    fogColor: 0x4e5c7a,
    fogDensity: 0.00034,
    exposure: 0.84,
  },
};

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldDir = normalize(position);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vWorldDir;
  uniform vec3 uSunDir;
  uniform vec3 uZenithColor;
  uniform vec3 uMidColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uSunGlowColor;
  uniform vec3 uCloudLitColor;
  uniform vec3 uCloudShadeColor;
  uniform float uCloudCoverage;
  uniform float uCloudDensity;
  uniform float uCloudTime;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
    for (int i = 0; i < 5; i++) {
      v += a * vnoise(p);
      p = rot * p * 2.04 + vec2(17.1, 31.7);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vWorldDir);
    float elev = clamp(dir.y, 0.0, 1.0);

    // Realistic 3-stop atmospheric Rayleigh gradient (horizon -> mid azure -> rich cobalt zenith)
    float t1 = pow(elev, 0.42);
    float t2 = pow(elev, 1.15);
    vec3 sky = mix(uHorizonColor, uMidColor, smoothstep(0.0, 0.48, t1));
    sky = mix(sky, uZenithColor, smoothstep(0.18, 0.95, t2));

    // Soft Mie solar aureole & subtle crisp solar disk
    float sunCos = max(dot(dir, normalize(uSunDir)), 0.0);
    float mieGlow = pow(sunCos, 6.0) * 0.24 + pow(sunCos, 42.0) * 0.35;
    float sunDisk = smoothstep(0.9992, 0.99985, sunCos) * 1.4;
    sky += uSunGlowColor * (mieGlow * (1.0 - elev * 0.45) + sunDisk);

    // Layered procedural summer Palatinate cumulus clouds projected onto curved sky plane
    if (dir.y > 0.015) {
      vec2 wind = vec2(uCloudTime * 0.0045, uCloudTime * 0.002);
      vec2 uv = dir.xz / (dir.y + 0.19) * 1.38 + wind;

      float baseField = fbm(uv * 1.15);
      float detailField = fbm(uv * 2.9 + vec2(4.2, -2.8));
      float shape = baseField * 0.72 + detailField * 0.28;

      float threshold = 1.0 - uCloudCoverage;
      float cloudAlpha = smoothstep(threshold, threshold + 0.26, shape) * uCloudDensity;

      // Directional cloud self-shadowing: sample slightly toward sun for sunlit cumulus tops vs cool bases
      vec2 sunProj = normalize(uSunDir.xz + vec2(0.0001)) * 0.11;
      float sunSample = fbm((uv + sunProj) * 1.15) * 0.72 + fbm((uv + sunProj) * 2.9 + vec2(4.2, -2.8)) * 0.28;
      float litFactor = clamp(0.55 + (shape - sunSample) * 2.4 + pow(sunCos, 4.0) * 0.35, 0.18, 1.0);

      vec3 cloudCol = mix(uCloudShadeColor, uCloudLitColor, litFactor);
      // Warm silver-lining near the sun
      cloudCol += uSunGlowColor * pow(sunCos, 10.0) * 0.22 * (1.0 - cloudAlpha * 0.4);

      // Perspective haze fade smoothly into horizon
      float horizonFade = smoothstep(0.015, 0.16, dir.y);
      cloudCol = mix(uHorizonColor, cloudCol, smoothstep(0.02, 0.22, dir.y));
      sky = mix(sky, cloudCol, cloudAlpha * horizonFade);
    }

    // Subtle below-horizon ground bounce color so reflections/gaps never show black
    if (dir.y < 0.0) {
      sky = mix(uHorizonColor, uHorizonColor * 0.65, clamp(-dir.y * 4.0, 0.0, 1.0));
    }

    gl_FragColor = vec4(sky, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function createSkyDomeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: true,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.4) },
      uZenithColor: { value: new THREE.Color(0x457dc9) },
      uMidColor: { value: new THREE.Color(0x79aae0) },
      uHorizonColor: { value: new THREE.Color(0xcbe0f2) },
      uSunGlowColor: { value: new THREE.Color(0xfffcf2) },
      uCloudLitColor: { value: new THREE.Color(0xfdfeff) },
      uCloudShadeColor: { value: new THREE.Color(0xa9bacf) },
      uCloudCoverage: { value: 0.50 },
      uCloudDensity: { value: 0.88 },
      uCloudTime: { value: 12.0 },
    },
  });
}

export class LightingSystem {
  public readonly skyMesh: THREE.Mesh;
  public readonly skyMat: THREE.ShaderMaterial;
  public readonly sunLight: THREE.DirectionalLight;
  public readonly hemiLight: THREE.HemisphereLight;
  public readonly fog: THREE.FogExp2;

  private readonly scene: THREE.Scene;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private sunDir = new THREE.Vector3();

  public currentPreset: TimeOfDayPreset = 'golden';
  public elevationDeg = PRESETS.golden.elevationDeg;
  public azimuthDeg = PRESETS.golden.azimuthDeg;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();

    this.skyMat = createSkyDomeMaterial();
    const skyGeo = new THREE.SphereGeometry(8200, 40, 24);
    this.skyMesh = new THREE.Mesh(skyGeo, this.skyMat);
    this.skyMesh.name = 'PfalzSkyAndClouds';
    this.skyMesh.frustumCulled = false;
    scene.add(this.skyMesh);

    this.sunLight = new THREE.DirectionalLight(0xffd79e, 2.7);
    this.sunLight.castShadow = true;
    const shadowRes = renderer.capabilities.maxTextureSize >= 4096 ? 4096 : 2048;
    this.sunLight.shadow.mapSize.set(shadowRes, shadowRes);
    this.sunLight.shadow.camera.near = 20;
    this.sunLight.shadow.camera.far = 1800;
    const d = 420;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.00035;
    this.sunLight.shadow.normalBias = 0.08;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    this.hemiLight = new THREE.HemisphereLight(0xa0bde2, 0x62533e, 0.76);
    scene.add(this.hemiLight);

    this.fog = new THREE.FogExp2(0xd8c7ae, 0.00020);
    scene.fog = this.fog;

    this.applyPreset('golden');
  }

  public applyPreset(preset: TimeOfDayPreset): void {
    this.currentPreset = preset;
    const cfg = PRESETS[preset];
    this.elevationDeg = cfg.elevationDeg;
    this.azimuthDeg = cfg.azimuthDeg;

    const u = this.skyMat.uniforms;
    u.uZenithColor.value.setHex(cfg.skyZenith);
    u.uMidColor.value.setHex(cfg.skyMid);
    u.uHorizonColor.value.setHex(cfg.skyHorizon);
    u.uSunGlowColor.value.setHex(cfg.sunGlowColor);
    u.uCloudLitColor.value.setHex(cfg.cloudLitColor);
    u.uCloudShadeColor.value.setHex(cfg.cloudShadeColor);
    u.uCloudCoverage.value = cfg.cloudCoverage;
    u.uCloudDensity.value = cfg.cloudDensity;

    this.sunLight.color.setHex(cfg.sunColor);
    this.sunLight.intensity = cfg.sunIntensity;
    this.hemiLight.color.setHex(cfg.hemiSky);
    this.hemiLight.groundColor.setHex(cfg.hemiGround);
    this.hemiLight.intensity = cfg.hemiIntensity;
    this.fog.color.setHex(cfg.fogColor);
    this.fog.density = cfg.fogDensity;
    this.renderer.toneMappingExposure = cfg.exposure;

    this.updateSunAngles(this.elevationDeg, this.azimuthDeg, true);
    this.scene.environmentIntensity = cfg.envIntensity;
  }

  public updateSunAngles(elevationDeg: number, azimuthDeg: number, rebuildEnv = false): void {
    this.elevationDeg = THREE.MathUtils.clamp(elevationDeg, 3, 78);
    this.azimuthDeg = ((azimuthDeg % 360) + 360) % 360;

    // Compass azimuth convention: 0°=North(-Z), 90°=East(+X), 180°=South(+Z), 270°=West(-X)
    const elevRad = THREE.MathUtils.degToRad(this.elevationDeg);
    const azimRad = THREE.MathUtils.degToRad(this.azimuthDeg);
    const cosE = Math.cos(elevRad);
    this.sunDir.set(Math.sin(azimRad) * cosE, Math.sin(elevRad), -Math.cos(azimRad) * cosE).normalize();

    this.skyMat.uniforms.uSunDir.value.copy(this.sunDir);
    this.updateShadowFocus(this.sunLight.target.position, 280);

    const lowFactor = 1.0 - THREE.MathUtils.smoothstep(this.elevationDeg, 6, 36);
    const warmColor = new THREE.Color(0xffb56b);
    const neutralColor = new THREE.Color(0xfff9ee);
    this.sunLight.color.copy(neutralColor).lerp(warmColor, lowFactor * 0.7);

    if (rebuildEnv) {
      this.rebuildEnvironmentMap();
    }
  }

  public rebuildEnvironmentMap(): void {
    const envScene = new THREE.Scene();
    const envSkyMat = this.skyMat.clone();
    const envSkyGeo = new THREE.SphereGeometry(100, 24, 14);
    envScene.add(new THREE.Mesh(envSkyGeo, envSkyMat));

    const groundMat = new THREE.MeshBasicMaterial({ color: 0x625a48, side: THREE.BackSide });
    const groundGeo = new THREE.SphereGeometry(90, 16, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5);
    envScene.add(new THREE.Mesh(groundGeo, groundMat));

    const prevEnv = this.envRT;
    this.envRT = this.pmrem.fromScene(envScene, 0.04);
    this.scene.environment = this.envRT.texture;
    if (prevEnv) prevEnv.dispose();
    envSkyGeo.dispose();
    envSkyMat.dispose();
    groundGeo.dispose();
    groundMat.dispose();
  }

  public updateClouds(dt: number, cameraPos?: THREE.Vector3): void {
    this.skyMat.uniforms.uCloudTime.value += dt;
    if (cameraPos) {
      this.skyMesh.position.set(cameraPos.x, 0, cameraPos.z);
    }
  }

  public updateShadowFocus(focusTarget: THREE.Vector3, cameraDistance: number): void {
    const span = THREE.MathUtils.clamp(cameraDistance * 1.15, 220, 680);
    const cam = this.sunLight.shadow.camera;
    if (Math.abs(cam.right - span) > 12) {
      cam.left = -span;
      cam.right = span;
      cam.top = span;
      cam.bottom = -span;
      cam.updateProjectionMatrix();
    }

    const snap = 4.0;
    const fx = Math.round(THREE.MathUtils.clamp(focusTarget.x, -850, 850) / snap) * snap;
    const fy = Math.round(focusTarget.y / snap) * snap;
    const fz = Math.round(THREE.MathUtils.clamp(focusTarget.z, -850, 850) / snap) * snap;

    this.sunLight.target.position.set(fx, fy, fz);
    this.sunLight.position.set(
      fx + this.sunDir.x * 760,
      fy + this.sunDir.y * 760,
      fz + this.sunDir.z * 760
    );
    this.sunLight.target.updateMatrixWorld();
  }

  public setShadowsEnabled(enabled: boolean): void {
    this.sunLight.castShadow = enabled;
    this.renderer.shadowMap.enabled = enabled;
  }
}
