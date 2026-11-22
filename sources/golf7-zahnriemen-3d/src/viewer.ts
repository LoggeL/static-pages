import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DriveModel } from './model';
import type { PartId, View, VisualState } from './drive';

export type Pick = PartId | 'cover';
export interface Viewer {
  setView(view: View): void;
  setHoodOpen(open: boolean): void;
  draw(state: VisualState, changed: boolean, dt?: number): void;
}

const source = import.meta.env.DEV
  ? '/golf7-keilriemen-3d/models/'
  : '../golf7-keilriemen-3d/models/';
const HOOD_OPEN_RAD = 0.94; // ~54 deg authentic Mk7 open hood angle

export class WorkshopViewer implements Viewer {
  private readonly scene = new THREE.Scene();
  private readonly orthoCamera = new THREE.OrthographicCamera(-4, 4, 3, -3, 0.05, 165);
  private readonly carCamera = new THREE.PerspectiveCamera(32, 16 / 10, 0.25, 240);
  private activeCamera: THREE.Camera = this.orthoCamera;
  private readonly renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
  private readonly model = new DriveModel();
  private readonly controls: OrbitControls;
  private readonly loader = new GLTFLoader();
  private readonly shared = new THREE.Group();
  private vehicle?: THREE.Object3D;
  private hoodPivot?: THREE.Object3D;
  private loadingCar = false;
  private hoodOpen = false;
  private hoodProgress = 0;
  private readonly shadow: THREE.Mesh;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.DirectionalLight;
  private readonly rimLight: THREE.DirectionalLight;
  private readonly skyLight: THREE.HemisphereLight;
  private view: View = 'perspective';
  private dirty = true;
  private readonly ray = new THREE.Raycaster();

  constructor(
    private host: HTMLElement,
    private callout: HTMLElement,
    private onPick: (part: Pick) => void,
    private onError: (message: string) => void,
  ) {
    const canvas = this.renderer.domElement;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
    this.renderer.setClearColor(0, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.host.prepend(canvas);

    // Custom automotive studio + daylight sky PMREM so metallic blue paint shows
    // deep dark cobalt flanks and bright sky-blue clearcoat edge highlights!
    this.scene.environment = this.buildAutomotiveEnvironment();
    this.scene.environmentIntensity = 1.12;

    this.skyLight = new THREE.HemisphereLight(0xeef6ff, 0x263140, 1.15);
    this.keyLight = new THREE.DirectionalLight(0xfff6e8, 2.35);
    this.fillLight = new THREE.DirectionalLight(0xc8e1ff, 1.55);
    this.rimLight = new THREE.DirectionalLight(0xd9ecff, 1.65);
    this.scene.add(this.skyLight, this.keyLight, this.fillLight, this.rimLight, this.model.root);

    // The workshop's Blender assets use vehicle coordinates, in metres.
    // Rotate their timing face (+X) onto our XY plane (+Z) and keep exact registration.
    const alignment = new THREE.Group();
    alignment.rotation.y = -Math.PI / 2;
    alignment.scale.setScalar(1 / 0.145);
    this.shared.position.set(-0.426, -0.516, 1.27);
    alignment.add(this.shared);
    this.scene.add(alignment);

    this.loader.load(
      source + 'ea288_engine.glb',
      (gltf) => {
        const block = gltf.scene.getObjectByName('EA288_CoreBlock');
        if (block) this.shared.add(block);
        this.dirty = true;
      },
      undefined,
      () => this.onError('Motorblock konnte nicht geladen werden. Der Steuertrieb ist bedienbar.'),
    );

    // Smooth ground contact shadow plane
    const textureCanvas = document.createElement('canvas');
    textureCanvas.width = textureCanvas.height = 128;
    const ctx = textureCanvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
    grad.addColorStop(0, 'rgba(5,9,14,.78)');
    grad.addColorStop(0.55, 'rgba(6,10,16,.44)');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(textureCanvas),
        transparent: true,
        depthWrite: false,
      }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.shadow);

    this.controls = new OrbitControls(this.orthoCamera, canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = false;
    this.controls.addEventListener('change', () => {
      this.dirty = true;
    });

    let down: { x: number; y: number; id: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      down = e.isPrimary && e.button === 0 ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
    });
    canvas.addEventListener('pointercancel', () => {
      down = null;
    });
    canvas.addEventListener('pointerup', (e) => {
      if (
        down?.id === e.pointerId &&
        Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 &&
        this.view !== 'car'
      ) {
        const hit = this.raycastPart(e.clientX, e.clientY);
        if (hit) this.onPick(hit);
      }
      down = null;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.view === 'car' || down) {
        canvas.style.cursor = '';
        return;
      }
      canvas.style.cursor = this.raycastPart(e.clientX, e.clientY) ? 'pointer' : '';
    });

    new ResizeObserver(() => this.resize()).observe(this.host);
    this.setView('perspective');
  }

  private buildAutomotiveEnvironment(): THREE.Texture {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x162030);

    const disposables: Array<{ dispose(): void }> = [];
    const panel = (
      w: number,
      h: number,
      color: number,
      intensity: number,
      pos: [number, number, number],
      rot: [number, number, number],
    ) => {
      const geo = new THREE.PlaneGeometry(w, h);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(intensity),
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...pos);
      mesh.rotation.set(...rot);
      env.add(mesh);
      disposables.push(geo, mat);
    };

    // Dark cool ground bounce -> keeps vertical Golf flanks rich deep cobalt-blue!
    panel(26, 26, 0x101722, 1.0, [0, -3.5, 0], [-Math.PI / 2, 0, 0]);

    // Soft ambient studio walls (cooler darker horizon so clearcoat edge highlights pop)
    panel(20, 9, 0x24344c, 1.1, [0, 1.8, -9], [0, 0, 0]);
    panel(20, 9, 0x223147, 1.1, [0, 1.8, 9], [0, Math.PI, 0]);
    panel(20, 9, 0x2a3c56, 1.25, [9, 1.8, 0], [0, -Math.PI / 2, 0]);
    panel(20, 9, 0x1d293b, 1.0, [-9, 1.8, 0], [0, Math.PI / 2, 0]);

    // Broad daylight sky-blue ceiling softbox (gives photo-like blue hood & roof reflection!)
    panel(16, 14, 0x9cc7f5, 2.35, [0, 7.2, 0], [Math.PI / 2, 0, 0]);

    // Crisp automotive studio light ribbons creating clearcoat specular streaks along hood V-creases & fenders
    panel(1.6, 11, 0xffffff, 5.4, [3.2, 6.2, 0], [Math.PI / 2, 0, 0]);
    panel(1.4, 11, 0xe8f4ff, 4.6, [-2.4, 6.2, 0], [Math.PI / 2, 0, 0]);
    panel(9.5, 1.4, 0xf4f9ff, 4.2, [5.5, 4.2, 3.8], [0.55, -Math.PI * 0.68, 0]);
    panel(7.5, 2.2, 0xd8ecff, 3.1, [7.8, 3.2, -3.2], [0.22, -Math.PI * 0.34, 0]);
    panel(7.0, 2.0, 0xfff7ea, 3.4, [2.0, 3.5, 7.6], [-0.25, Math.PI, 0]);

    const tex = pmrem.fromScene(env, 0.035).texture;
    for (const d of disposables) d.dispose();
    pmrem.dispose();
    return tex;
  }

  private applyLighting(car: boolean) {
    if (car) {
      // Lighting tuned specifically to showcase the Metallic Medium Blue Golf VII front & sculpted flanks
      this.skyLight.color.setHex(0xdcecff);
      this.skyLight.groundColor.setHex(0x1f2836);
      this.skyLight.intensity = 1.25;

      this.keyLight.color.setHex(0xfff8ee);
      this.keyLight.intensity = 2.65;
      this.keyLight.position.set(22, 24, 14);

      this.fillLight.color.setHex(0xbadbff);
      this.fillLight.intensity = 1.75;
      this.fillLight.position.set(16, 12, -20);

      this.rimLight.color.setHex(0xd6ebff);
      this.rimLight.intensity = 1.5;
      this.rimLight.position.set(-20, 14, 12);

      this.scene.environmentIntensity = 1.24;
      this.renderer.toneMappingExposure = 1.18;
    } else {
      // Balanced technical lighting for the timing belt, gear teeth, reference marks & EA288 engine block
      this.skyLight.color.setHex(0xf2fffb);
      this.skyLight.groundColor.setHex(0x474d58);
      this.skyLight.intensity = 1.35;

      this.keyLight.color.setHex(0xfff4e2);
      this.keyLight.intensity = 2.25;
      this.keyLight.position.set(-3, 6, 7);

      this.fillLight.color.setHex(0xc8e0f4);
      this.fillLight.intensity = 1.65;
      this.fillLight.position.set(5, 3, 5);

      this.rimLight.color.setHex(0xc2daea);
      this.rimLight.intensity = 2.0;
      this.rimLight.position.set(4, 4, -6);

      this.scene.environmentIntensity = 0.94;
      this.renderer.toneMappingExposure = 1.12;
    }
  }

  setHoodOpen(open: boolean) {
    this.hoodOpen = open;
    this.dirty = true;
  }

  setView(view: View) {
    this.view = view;
    const car = view === 'car';
    this.applyLighting(car);

    if (this.vehicle) this.vehicle.visible = car;
    if (car && !this.vehicle && !this.loadingCar) {
      this.loadingCar = true;
      this.loader.load(
        source + 'golf7.glb',
        (gltf) => {
          this.loadingCar = false;
          this.vehicle = gltf.scene;
          this.hoodPivot = this.vehicle.getObjectByName('Golf7_HoodPivot') ?? undefined;
          if (this.hoodPivot) this.hoodPivot.rotation.x = this.hoodProgress * HOOD_OPEN_RAD;
          this.vehicle.visible = this.view === 'car';
          this.shared.add(this.vehicle);
          this.dirty = true;
        },
        undefined,
        () => {
          this.loadingCar = false;
          this.onError('Fahrzeugmodell konnte nicht geladen werden.');
        },
      );
    }

    this.shadow.position.set(car ? -8.76 : 0, car ? -3.55 : -2.05, car ? -2.94 : -2.5);
    this.shadow.scale.set(car ? 35 : 7.5, car ? 16.5 : 9, 1);

    if (car) {
      this.activeCamera = this.carCamera;
      this.controls.object = this.carCamera;
      this.controls.minPolarAngle = 0.24;
      this.controls.maxPolarAngle = Math.PI * 0.485;
      this.controls.minDistance = 16;
      this.controls.maxDistance = 68;
      // Front-biased 3/4 view close to reference photo perspective: showcases the blue front face,
      // halogen headlights, narrow chrome-trimmed grille, VW badge, lower slats & sculpted right flank,
      // with comfortable headroom even when the hood opens!
      this.controls.target.set(-5.0, 1.05, -2.94);
      this.carCamera.position.set(29.8, 5.2, 13.0);
    } else {
      this.activeCamera = this.orthoCamera;
      this.controls.object = this.orthoCamera;
      this.controls.minPolarAngle = 0.25;
      this.controls.maxPolarAngle = Math.PI * 0.77;
      this.controls.minZoom = 0.65;
      this.controls.maxZoom = 3.4;
      if (view === 'front') {
        this.controls.target.set(0.04, 0.14, 0);
        this.orthoCamera.position.set(0.04, 0.14, 14);
      } else {
        this.controls.target.set(-0.28, 0.0, -1.25);
        this.orthoCamera.position.copy(this.controls.target).add(new THREE.Vector3(-5.9, 3.0, 13));
      }
      this.orthoCamera.zoom = 1;
    }

    this.resize();
    this.controls.update();
    this.dirty = true;
  }

  private resize() {
    const width = Math.max(1, this.host.clientWidth),
      height = Math.max(1, this.host.clientHeight);
    const aspect = width / height;

    this.carCamera.aspect = aspect;
    this.carCamera.fov = aspect < 1.15 ? 40 : 32;
    this.carCamera.updateProjectionMatrix();

    const span =
      this.view === 'front' ? Math.max(4.55, 5.4 / aspect) : Math.max(5.32, 7.7 / aspect);
    this.orthoCamera.left = (-span * aspect) / 2;
    this.orthoCamera.right = (span * aspect) / 2;
    this.orthoCamera.top = span / 2;
    this.orthoCamera.bottom = -span / 2;
    this.orthoCamera.updateProjectionMatrix();

    this.renderer.setSize(width, height, false);
    this.dirty = true;
  }

  private raycastPart(x: number, y: number): Pick | null {
    const rect = this.host.getBoundingClientRect();
    this.ray.setFromCamera(
      new THREE.Vector2(
        ((x - rect.left) / rect.width) * 2 - 1,
        1 - ((y - rect.top) / rect.height) * 2,
      ),
      this.activeCamera,
    );
    for (const hit of this.ray.intersectObject(this.model.root)) {
      let node: THREE.Object3D | null = hit.object;
      let part: Pick | undefined;
      let visible = true;
      while (node) {
        if (!node.visible) {
          visible = false;
          break;
        }
        part ??= node.userData.part as Pick | undefined;
        node = node.parent;
      }
      if (visible && part) return part;
    }
    return null;
  }

  draw(s: VisualState, changed: boolean, dt = 0.016) {
    // Smoothly animate hood opening/closing in car view
    const targetHood = this.hoodOpen ? 1 : 0;
    if (Math.abs(this.hoodProgress - targetHood) > 0.0005) {
      const dir = targetHood > this.hoodProgress ? 1 : -1;
      this.hoodProgress = Math.max(
        0,
        Math.min(1, this.hoodProgress + dir * Math.min(dt, 0.05) * 2.1),
      );
      if (this.hoodPivot) {
        const t = this.hoodProgress;
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        this.hoodPivot.rotation.x = eased * HOOD_OPEN_RAD;
      }
      this.dirty = true;
    }

    if (!this.dirty && !changed) return;
    if (changed) this.model.update(s);
    this.renderer.render(this.scene, this.activeCamera);

    const pos = this.model.anchor(s.selected).project(this.activeCamera);
    const x = ((pos.x + 1) * this.host.clientWidth) / 2;
    const y = ((1 - pos.y) * this.host.clientHeight) / 2;
    const markerVisible =
      this.view !== 'car' &&
      !s.cover &&
      !(s.selected === 'belt' && !s.belt) &&
      x >= 12 &&
      x < this.host.clientWidth - 26 &&
      y >= 15 &&
      y < this.host.clientHeight - 30;
    this.callout.hidden = !markerVisible;
    this.callout.style.left = x + 'px';
    this.callout.style.top = y + 'px';
    this.callout.classList.toggle('flip', x > this.host.clientWidth * 0.71);
    this.dirty = false;
  }
}
