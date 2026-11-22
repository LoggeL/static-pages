import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** Dedicated render layer for the isolated Oil-Sump Wet-Belt Cutaway camera (`Ölwanne [Z]`). */
export const OIL_CUTAWAY_LAYER = 2;

export class SceneManager {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly carLiftGroup = new THREE.Group();

  private readonly container: HTMLElement;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly outputPass: OutputPass;
  private readonly pmremTarget: THREE.WebGLRenderTarget;

  private readonly workLampSpot: THREE.SpotLight;
  private readonly workLampPoint: THREE.PointLight;
  private readonly workLampTarget: THREE.Object3D;
  private readonly workLampHousingGroup: THREE.Group;
  private readonly workLampLedMat: THREE.MeshStandardMaterial;

  private workLampEnabled = false;
  private currentLiftY = 0;

  constructor(container: HTMLElement) {
    this.container = container;

    const width = Math.max(container.clientWidth || window.innerWidth || 1280, 1);
    const height = Math.max(container.clientHeight || window.innerHeight || 720, 1);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x141922);
    this.scene.fog = new THREE.Fog(0x141922, 13, 26);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 60);
    this.camera.position.set(3.25, 1.8, -2.95);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.container.appendChild(this.renderer.domElement);

    // High-contrast Workshop PMREM Environment for clearcoat & chrome reflections
    this.pmremTarget = this.buildWorkshopEnvironmentPMREM();
    this.scene.environment = this.pmremTarget.texture;
    this.scene.environmentIntensity = 1.05;

    // Car Lift Group (vehicle root will be attached here)
    this.carLiftGroup.name = 'CarLiftGroup';
    this.scene.add(this.carLiftGroup);

    // Workshop Lighting Rig (also enabled on OIL_CUTAWAY_LAYER so the isolated oil-sump view is brightly lit!)
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.65);
    hemiLight.layers.enable(OIL_CUTAWAY_LAYER);
    this.scene.add(hemiLight);

    const keyDirLight = new THREE.DirectionalLight(0xfff7ed, 2.1);
    keyDirLight.layers.enable(OIL_CUTAWAY_LAYER);
    keyDirLight.position.set(2.4, 5.4, -1.6);
    keyDirLight.castShadow = true;
    keyDirLight.shadow.mapSize.set(2048, 2048);
    keyDirLight.shadow.bias = -0.0005;
    keyDirLight.shadow.normalBias = 0.02;
    keyDirLight.shadow.camera.left = -3.5;
    keyDirLight.shadow.camera.right = 3.5;
    keyDirLight.shadow.camera.top = 3.5;
    keyDirLight.shadow.camera.bottom = -3.5;
    keyDirLight.shadow.camera.near = 0.5;
    keyDirLight.shadow.camera.far = 14.0;
    this.scene.add(keyDirLight);

    const fillDirLight = new THREE.DirectionalLight(0xcfe8ff, 0.9);
    fillDirLight.layers.enable(OIL_CUTAWAY_LAYER);
    fillDirLight.position.set(4.2, 2.1, -3.6);
    this.scene.add(fillDirLight);

    // Dedicated front-right studio fill exclusively for the isolated Oil-Sump Cutaway view (`Z`)
    const cutawayKeyLight = new THREE.DirectionalLight(0xfff8eb, 1.45);
    cutawayKeyLight.layers.set(OIL_CUTAWAY_LAYER);
    cutawayKeyLight.position.set(3.0, 1.4, -2.2);
    this.scene.add(cutawayKeyLight);

    // Toggleable Magnetic LED Work Lamp aimed at EA288 belt drive (0.44, 0.45 + liftY, -1.32)
    this.workLampTarget = new THREE.Object3D();
    this.workLampTarget.position.set(0.44, 0.45, -1.32);
    this.scene.add(this.workLampTarget);

    this.workLampSpot = new THREE.SpotLight(0xf0f9ff, 0, 4.5, Math.PI * 0.23, 0.52, 1.35);
    this.workLampSpot.layers.enable(OIL_CUTAWAY_LAYER);
    this.workLampSpot.position.set(0.95, 0.88, -1.04);
    this.workLampSpot.target = this.workLampTarget;
    this.scene.add(this.workLampSpot);

    this.workLampPoint = new THREE.PointLight(0xe0f2fe, 0, 2.2, 1.4);
    this.workLampPoint.layers.enable(OIL_CUTAWAY_LAYER);
    this.workLampPoint.position.set(0.76, 0.56, -1.24);
    this.scene.add(this.workLampPoint);

    // Compact magnetic LED inspection lamp indicator mounted above the arch edge
    this.workLampHousingGroup = new THREE.Group();
    this.workLampHousingGroup.position.set(0.96, 0.89, -1.04);
    this.workLampHousingGroup.lookAt(this.workLampTarget.position);

    const housingMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.45,
      metalness: 0.4,
    });
    const housingMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.032, 0.09),
      housingMat
    );
    housingMesh.raycast = () => {};

    this.workLampLedMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      emissive: new THREE.Color(0xbae6fd),
      emissiveIntensity: 0.0,
      roughness: 0.2,
      metalness: 0.1,
    });
    const ledLensMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.044, 0.022),
      this.workLampLedMat
    );
    ledLensMesh.position.z = 0.046;
    ledLensMesh.raycast = () => {};

    this.workLampHousingGroup.add(housingMesh, ledLensMesh);
    this.scene.add(this.workLampHousingGroup);

    // Post-processing Pipeline (MSAA HalfFloat target + Bloom + ACES OutputPass)
    const renderTarget = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(this.renderer, renderTarget);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);

    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.26,
      0.35,
      0.96
    );
    this.composer.addPass(this.bloomPass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.updateWorkLampPositions();
  }

  private buildWorkshopEnvironmentPMREM(): THREE.WebGLRenderTarget {
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();

    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x111827);

    const disposables: Array<{ dispose: () => void }> = [];
    const addPanel = (
      geo: THREE.BufferGeometry,
      color: THREE.ColorRepresentation,
      intensity: number,
      pos: [number, number, number],
      rot: [number, number, number]
    ) => {
      const c = new THREE.Color(color).multiplyScalar(intensity);
      const mat = new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.rotation.set(rot[0], rot[1], rot[2]);
      envScene.add(mesh);
      disposables.push(geo, mat);
    };

    // Dark workshop epoxy floor bounce (preserves deep rich lower paint contrast)
    addPanel(new THREE.PlaneGeometry(18, 18), 0x161d29, 1.0, [0, -2.5, 0], [-Math.PI / 2, 0, 0]);

    // Cool industrial side walls
    addPanel(new THREE.PlaneGeometry(16, 8), 0x223044, 1.0, [-7, 1.5, 0], [0, Math.PI / 2, 0]);
    addPanel(new THREE.PlaneGeometry(16, 8), 0x1f2937, 1.0, [7, 1.5, 0], [0, -Math.PI / 2, 0]);
    addPanel(new THREE.PlaneGeometry(16, 8), 0x263244, 1.0, [0, 1.5, 7], [0, Math.PI, 0]);
    addPanel(new THREE.PlaneGeometry(16, 8), 0x1a2230, 1.0, [0, 1.5, -7], [0, 0, 0]);

    // High-contrast overhead LED workshop light banks (creates crisp automotive clearcoat streaks)
    const stripGeo = new THREE.PlaneGeometry(0.65, 7.2);
    disposables.push(stripGeo);
    for (const x of [-3.2, -1.1, 1.1, 3.2]) {
      const warmAccent = Math.abs(x) < 1.5 ? 0xfff8ed : 0xeff6ff;
      addPanel(stripGeo, warmAccent, 6.2, [x, 5.2, 0], [Math.PI / 2, 0, 0]);
    }

    // Cross overhead light bars
    const crossGeo = new THREE.PlaneGeometry(6.8, 0.48);
    disposables.push(crossGeo);
    addPanel(crossGeo, 0xf8fafc, 4.8, [0, 5.1, -3.4], [Math.PI / 2, 0, 0]);
    addPanel(crossGeo, 0xf1f5f9, 4.4, [0, 5.1, 3.4], [Math.PI / 2, 0, 0]);

    // Cool skylight bay bounce on left wall & front-right soft key card
    addPanel(new THREE.PlaneGeometry(4.5, 2.2), 0xbae6fd, 2.8, [-6.8, 3.2, -0.4], [0, Math.PI / 2, 0]);
    addPanel(new THREE.PlaneGeometry(3.2, 2.0), 0xe0f2fe, 2.4, [6.6, 2.2, -3.2], [0, -Math.PI * 0.72, 0]);

    const pmremRT = pmremGenerator.fromScene(envScene, 0.035);

    for (const item of disposables) {
      item.dispose();
    }
    pmremGenerator.dispose();

    return pmremRT;
  }

  private updateWorkLampPositions(): void {
    const yOff = this.currentLiftY;
    this.workLampTarget.position.set(0.44, 0.52 + yOff, -1.35);
    this.workLampSpot.position.set(0.95, 0.88 + yOff, -1.04);
    this.workLampPoint.position.set(0.76, 0.58 + yOff, -1.28);
    this.workLampHousingGroup.position.set(0.96, 0.89 + yOff, -1.04);
    this.workLampHousingGroup.lookAt(this.workLampTarget.position);
    this.workLampTarget.updateMatrixWorld();
  }

  public setWorkLamp(enabled: boolean): void {
    this.workLampEnabled = enabled;
    this.workLampSpot.intensity = enabled ? 6.5 : 0;
    this.workLampPoint.intensity = enabled ? 1.25 : 0;
    this.workLampLedMat.emissiveIntensity = enabled ? 2.4 : 0.0;
  }

  public setWorkLampLiftOffset(liftY: number): void {
    this.currentLiftY = liftY;
    this.updateWorkLampPositions();
    if (this.workLampEnabled) {
      this.workLampSpot.intensity = 6.5;
    }
  }

  /**
   * Switches camera render layers between normal workshop scene (layer 0) and
   * the isolated Oil-Sump Wet-Belt Cutaway diorama (OIL_CUTAWAY_LAYER) without
   * mutating any vehicle/repair visibility state.
   */
  public setOilCutawayCameraLayer(active: boolean): void {
    this.camera.layers.set(active ? OIL_CUTAWAY_LAYER : 0);
  }

  public resize(): void {
    const width = Math.max(this.container.clientWidth || window.innerWidth, 1);
    const height = Math.max(this.container.clientHeight || window.innerHeight, 1);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);

    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.bloomPass.setSize(width * pixelRatio, height * pixelRatio);
  }

  public render(): void {
    this.composer.render();
  }

  public dispose(): void {
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of materials) {
          mat.dispose();
        }
      }
    });

    this.pmremTarget.dispose();
    this.bloomPass.dispose();
    this.outputPass.dispose();
    this.composer.dispose();
    this.renderer.dispose();

    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
