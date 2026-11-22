import * as THREE from 'three';
import { extractNode, getSharedModelUrl, loadGLB } from '../engine/AssetLoader';
import {
  getBeltPosterTexture,
  getTireTreadTextures,
  getWorkshopFloorTextures,
  getWorkshopWallTexture,
} from '../engine/ProceduralTextures';
import type { InteractableMeta } from '../types';

export class WorkshopEnvironment {
  private readonly root = new THREE.Group();
  private readonly propsVisualsGroup = new THREE.Group();
  private readonly liftCarriagesGroup = new THREE.Group();
  private upButtonMesh: THREE.Mesh;
  private downButtonMesh: THREE.Mesh;
  private readonly wheelRackPos = new THREE.Vector3(2.35, 0.42, -0.35);
  private readonly benchPartsPos = new THREE.Vector3(2.26, 0.91, 1.35);

  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];
  private readonly ownedTextures: THREE.Texture[] = [];

  constructor(scene: THREE.Scene) {
    this.root.name = 'WorkshopEnvironment';
    this.propsVisualsGroup.name = 'WorkshopPropsVisuals';
    scene.add(this.root);
    this.root.add(this.propsVisualsGroup);
    this.root.add(this.liftCarriagesGroup);

    this.buildFloorAndBayMarkings();
    this.buildWallsAndCeiling();
    this.buildWerkstattwagen();
    this.buildWerkbank();
    this.buildReifenstaender();

    const buttons = this.buildTwoPostLift();
    this.upButtonMesh = buttons.upButtonMesh;
    this.downButtonMesh = buttons.downButtonMesh;

    this.setLiftHeight(0);
  }

  public async loadBlenderModel(): Promise<void> {
    const glb = await loadGLB(getSharedModelUrl('workshop_props.glb'));

    this.propsVisualsGroup.clear();
    this.liftCarriagesGroup.clear();

    for (const name of [
      'Lift_Columns',
      'Workshop_ToolCart',
      'Workshop_Workbench',
      'Workshop_TireRack',
    ]) {
      const node = extractNode(glb, name, false);
      if (node) {
        this.propsVisualsGroup.add(node);
      }
    }

    const carriages = extractNode(glb, 'Lift_Carriages', true);
    if (carriages) {
      this.liftCarriagesGroup.add(carriages);
    }

    const btnUp = this.propsVisualsGroup.getObjectByName('Lift_BtnUp');
    if (btnUp instanceof THREE.Mesh) {
      btnUp.userData.interactableId = 'liftControlUp';
      btnUp.userData.meta = {
        id: 'liftControlUp',
        label: 'Hebebühne AUF (Grün)',
        status: 'Bereit',
        hint: 'Klicken zum Hochfahren auf Arbeitshöhe',
      } satisfies InteractableMeta;
      if (btnUp.material instanceof THREE.MeshStandardMaterial) {
        btnUp.material = btnUp.material.clone();
        btnUp.material.emissive.setHex(0x22c55e);
        btnUp.material.emissiveIntensity = 1.25;
      }
      this.upButtonMesh = btnUp;
    }

    const btnDown = this.propsVisualsGroup.getObjectByName('Lift_BtnDown');
    if (btnDown instanceof THREE.Mesh) {
      btnDown.userData.interactableId = 'liftControlDown';
      btnDown.userData.meta = {
        id: 'liftControlDown',
        label: 'Hebebühne AB (Gelb)',
        status: 'Bereit',
        hint: 'Klicken zum Ablassen des Fahrzeugs',
      } satisfies InteractableMeta;
      if (btnDown.material instanceof THREE.MeshStandardMaterial) {
        btnDown.material = btnDown.material.clone();
        btnDown.material.emissive.setHex(0xf59e0b);
        btnDown.material.emissiveIntensity = 1.15;
      }
      this.downButtonMesh = btnDown;
    }
  }

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.ownedGeometries.push(geo);
    return geo;
  }

  private trackMat<T extends THREE.Material>(mat: T): T {
    this.ownedMaterials.push(mat);
    return mat;
  }

  private buildFloorAndBayMarkings(): void {
    const floorTextures = getWorkshopFloorTextures();
    floorTextures.map.repeat.set(6, 5);
    floorTextures.bumpMap.repeat.set(6, 5);
    floorTextures.roughnessMap.repeat.set(6, 5);

    const floorMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        map: floorTextures.map,
        bumpMap: floorTextures.bumpMap,
        bumpScale: 0.006,
        roughnessMap: floorTextures.roughnessMap,
        roughness: 1.0,
        metalness: 0.06,
      })
    );

    // 12m x 10m epoxy floor centered at Z = -0.8 (spans X: [-6, 6], Z: [-5.8, +4.2])
    const floor = new THREE.Mesh(this.trackGeo(new THREE.PlaneGeometry(12, 10)), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -0.8);
    floor.receiveShadow = true;
    this.root.add(floor);

    // Safety yellow/black hazard stripe border around the 2-post lift bay
    const hazardTex = this.createHazardStripeTexture();
    const hazardMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        map: hazardTex,
        roughness: 0.55,
        metalness: 0.05,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      })
    );

    const sideStripGeo = this.trackGeo(new THREE.PlaneGeometry(0.11, 4.5));
    for (const sideX of [-1.88, 1.88]) {
      const strip = new THREE.Mesh(sideStripGeo, hazardMat);
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(sideX, 0.002, -0.45);
      strip.receiveShadow = true;
      this.root.add(strip);
    }

    const endStripGeo = this.trackGeo(new THREE.PlaneGeometry(3.87, 0.11));
    for (const endZ of [-2.7, 1.8]) {
      const strip = new THREE.Mesh(endStripGeo, hazardMat);
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(0, 0.002, endZ);
      strip.receiveShadow = true;
      this.root.add(strip);
    }

    // Center oil-drain & inspection grate at (0, 0, -0.35)
    const grateGroup = new THREE.Group();
    grateGroup.position.set(0, 0.002, -0.35);

    const pitMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x090c10, roughness: 0.95, metalness: 0.1 })
    );
    const ironMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x2f3742, roughness: 0.52, metalness: 0.78 })
    );

    const pitBase = new THREE.Mesh(this.trackGeo(new THREE.PlaneGeometry(0.76, 1.85)), pitMat);
    pitBase.rotation.x = -Math.PI / 2;
    grateGroup.add(pitBase);

    const frameLongGeo = this.trackGeo(new THREE.BoxGeometry(0.04, 0.01, 1.9));
    for (const fx of [-0.38, 0.38]) {
      const frame = new THREE.Mesh(frameLongGeo, ironMat);
      frame.position.set(fx, 0.005, 0);
      frame.receiveShadow = true;
      grateGroup.add(frame);
    }

    const barGeo = this.trackGeo(new THREE.BoxGeometry(0.74, 0.008, 0.025));
    for (let z = -0.88; z <= 0.89; z += 0.075) {
      const bar = new THREE.Mesh(barGeo, ironMat);
      bar.position.set(0, 0.005, z);
      bar.receiveShadow = true;
      grateGroup.add(bar);
    }

    this.root.add(grateGroup);
  }

  private createHazardStripeTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#eab308';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#18181b';
      for (let i = -256; i < 512; i += 64) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + 32, 0);
        ctx.lineTo(i - 224, 256);
        ctx.lineTo(i - 256, 256);
        ctx.closePath();
        ctx.fill();
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 10);
    tex.anisotropy = 8;
    this.ownedTextures.push(tex);
    return tex;
  }

  private buildWallsAndCeiling(): void {
    const wallTex = getWorkshopWallTexture();
    const wallMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        map: wallTex,
        roughness: 0.72,
        metalness: 0.08,
      })
    );

    const wallHeight = 4.5;

    // Back wall at Z = +4.2 (spans X: [-4.8, +4.8], width 9.6m)
    const backWall = new THREE.Mesh(this.trackGeo(new THREE.PlaneGeometry(9.6, wallHeight)), wallMat);
    backWall.position.set(0, wallHeight / 2, 4.2);
    backWall.rotation.y = Math.PI;
    backWall.receiveShadow = true;
    this.root.add(backWall);

    // Left wall at X = -4.8 (spans Z: [-5.8, +4.2], length 10m)
    const leftWall = new THREE.Mesh(this.trackGeo(new THREE.PlaneGeometry(10.0, wallHeight)), wallMat);
    leftWall.position.set(-4.8, wallHeight / 2, -0.8);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.receiveShadow = true;
    this.root.add(leftWall);

    // Right wall at X = +4.8
    const rightWall = new THREE.Mesh(this.trackGeo(new THREE.PlaneGeometry(10.0, wallHeight)), wallMat);
    rightWall.position.set(4.8, wallHeight / 2, -0.8);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.receiveShadow = true;
    this.root.add(rightWall);

    // Front workshop shutter bay wall at Z = -5.8 (completes enclosure for title orbit)
    const frontWallMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.65, metalness: 0.3 })
    );
    const frontWall = new THREE.Mesh(this.trackGeo(new THREE.PlaneGeometry(9.6, wallHeight)), frontWallMat);
    frontWall.position.set(0, wallHeight / 2, -5.8);
    this.root.add(frontWall);

    // Sectional garage door panels on front wall
    const doorMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.48, metalness: 0.42 })
    );
    const slatGeo = this.trackGeo(new THREE.BoxGeometry(4.4, 0.56, 0.08));
    for (let row = 0; row < 5; row++) {
      const slat = new THREE.Mesh(slatGeo, doorMat);
      slat.position.set(0, 0.34 + row * 0.61, -5.75);
      this.root.add(slat);
    }

    // Framed EA288 Riemenverlauf technical poster on back wall (clearly visible from overview)
    const posterTex = getBeltPosterTexture();
    const posterFrameMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.32, metalness: 0.85 })
    );
    const posterMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        map: posterTex,
        roughness: 0.42,
        metalness: 0.05,
      })
    );

    const addFramedPoster = (pos: THREE.Vector3, rotY: number, scale = 1) => {
      const group = new THREE.Group();
      group.position.copy(pos);
      group.rotation.y = rotY;
      group.scale.setScalar(scale);

      const frame = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(1.36, 1.68, 0.04)), posterFrameMat);
      const canvas = new THREE.Mesh(this.trackGeo(new THREE.PlaneGeometry(1.26, 1.58)), posterMat);
      canvas.position.z = 0.022;
      group.add(frame, canvas);
      this.root.add(group);
    };

    addFramedPoster(new THREE.Vector3(1.5, 2.1, 4.16), Math.PI, 1.0);
    addFramedPoster(new THREE.Vector3(4.76, 2.05, 1.35), -Math.PI / 2, 0.85);

    // Dealership wall sign on back wall: "VOLKSWAGEN SERVICE • BAY 02"
    const signCanvas = document.createElement('canvas');
    signCanvas.width = 1024;
    signCanvas.height = 192;
    const sctx = signCanvas.getContext('2d');
    if (sctx) {
      sctx.fillStyle = '#0f172a';
      sctx.fillRect(0, 0, 1024, 192);
      sctx.fillStyle = '#1d4ed8';
      sctx.fillRect(0, 168, 1024, 24);
      sctx.fillStyle = '#f8fafc';
      sctx.font = 'bold 54px "Inter", "Segoe UI", Arial, sans-serif';
      sctx.textAlign = 'center';
      sctx.textBaseline = 'middle';
      sctx.fillText('AUTOHAUS SERVICE • HALLE 2 • EA288 TDI', 512, 86);
    }
    const signTex = new THREE.CanvasTexture(signCanvas);
    signTex.colorSpace = THREE.SRGBColorSpace;
    this.ownedTextures.push(signTex);
    const signMesh = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(3.4, 0.62, 0.06)),
      this.trackMat(new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.45, metalness: 0.2 }))
    );
    signMesh.position.set(-1.35, 3.25, 4.16);
    signMesh.rotation.y = Math.PI;
    this.root.add(signMesh);

    // Industrial glowing daylight window on left wall (X = -4.77)
    const windowFrameMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, metalness: 0.6 })
    );
    const windowGlowMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xe0f2fe,
        emissive: new THREE.Color(0xdbeafe),
        emissiveIntensity: 1.35,
        roughness: 0.25,
      })
    );

    const winGroup = new THREE.Group();
    winGroup.position.set(-4.77, 2.55, -0.45);
    winGroup.rotation.y = Math.PI / 2;

    const winPane = new THREE.Mesh(this.trackGeo(new THREE.PlaneGeometry(4.2, 1.35)), windowGlowMat);
    winGroup.add(winPane);

    const topBar = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(4.32, 0.07, 0.08)), windowFrameMat);
    topBar.position.y = 0.69;
    const botBar = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(4.32, 0.07, 0.08)), windowFrameMat);
    botBar.position.y = -0.69;
    winGroup.add(topBar, botBar);

    const mullionGeo = this.trackGeo(new THREE.BoxGeometry(0.06, 1.38, 0.07));
    for (const mx of [-2.12, -0.7, 0.7, 2.12]) {
      const mullion = new THREE.Mesh(mullionGeo, windowFrameMat);
      mullion.position.x = mx;
      winGroup.add(mullion);
    }
    this.root.add(winGroup);

    // Ceiling & overhead gantry trusses with emissive LED strip fixtures (bloom > 0.96)
    const ceilingMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x1a2029, roughness: 0.85, metalness: 0.2 })
    );
    const ceiling = new THREE.Mesh(this.trackGeo(new THREE.PlaneGeometry(10.0, 10.2)), ceilingMat);
    ceiling.position.set(0, wallHeight, -0.8);
    ceiling.rotation.x = Math.PI / 2;
    this.root.add(ceiling);

    const trussSteelMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x2b3441, roughness: 0.52, metalness: 0.72 })
    );
    const ledHousingMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xdbe2ea, roughness: 0.4, metalness: 0.5 })
    );
    const ledEmitMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: new THREE.Color(0xf8fafc),
        emissiveIntensity: 1.6,
        roughness: 0.15,
      })
    );

    const beamGeo = this.trackGeo(new THREE.BoxGeometry(9.6, 0.18, 0.14));
    const ledBodyGeo = this.trackGeo(new THREE.BoxGeometry(2.6, 0.055, 0.16));
    const ledStripGeo = this.trackGeo(new THREE.PlaneGeometry(2.5, 0.12));

    for (const tz of [-3.3, -1.35, 0.65, 2.65]) {
      const truss = new THREE.Mesh(beamGeo, trussSteelMat);
      truss.position.set(0, 4.34, tz);
      this.root.add(truss);

      for (const lx of [-2.1, 2.1]) {
        const housing = new THREE.Mesh(ledBodyGeo, ledHousingMat);
        housing.position.set(lx, 4.21, tz);
        const emitter = new THREE.Mesh(ledStripGeo, ledEmitMat);
        emitter.position.set(lx, 4.18, tz);
        emitter.rotation.x = Math.PI / 2;
        this.root.add(housing, emitter);
      }
    }
  }

  private buildWerkstattwagen(): void {
    const cart = new THREE.Group();
    cart.position.set(2.35, 0, -2.25);
    cart.rotation.y = -0.24;

    const redBodyMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.35, metalness: 0.25 })
    );
    const darkMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x181c22, roughness: 0.75, metalness: 0.2 })
    );
    const chromeMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.18, metalness: 0.92 })
    );

    // 4 caster wheels
    const wheelGeo = this.trackGeo(new THREE.CylinderGeometry(0.052, 0.052, 0.032, 16));
    const forkGeo = this.trackGeo(new THREE.BoxGeometry(0.05, 0.06, 0.05));
    for (const cx of [-0.31, 0.31]) {
      for (const cz of [-0.18, 0.18]) {
        const caster = new THREE.Mesh(wheelGeo, darkMat);
        caster.rotation.z = Math.PI / 2;
        caster.position.set(cx, 0.052, cz);
        caster.castShadow = true;
        const fork = new THREE.Mesh(forkGeo, chromeMat);
        fork.position.set(cx, 0.095, cz);
        cart.add(caster, fork);
      }
    }

    // Main red steel cabinet body (total height ~0.90m so overview sightline clears nicely)
    const cabinet = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.76, 0.74, 0.48)), redBodyMat);
    cabinet.position.set(0, 0.49, 0);
    cabinet.castShadow = true;
    cabinet.receiveShadow = true;
    cart.add(cabinet);

    // Ribbed rubber top work mat
    const topMat = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.78, 0.032, 0.5)), darkMat);
    topMat.position.set(0, 0.875, 0);
    topMat.castShadow = true;
    cart.add(topMat);

    // 6 drawers with brushed chrome pulls facing -X / -Z
    const drawerHeights = [0.075, 0.075, 0.085, 0.095, 0.125, 0.145];
    let curY = 0.78;
    for (const dh of drawerHeights) {
      curY -= dh / 2;
      const drawerFront = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.66, dh - 0.012, 0.02)),
        redBodyMat
      );
      drawerFront.position.set(0, curY, -0.245);
      const pull = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.56, 0.016, 0.018)),
        chromeMat
      );
      pull.position.set(0, curY + dh * 0.24, -0.258);
      cart.add(drawerFront, pull);
      curY -= dh / 2 + 0.009;
    }

    // Side tubular push handle
    const handleBar = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.42, 12)),
      chromeMat
    );
    handleBar.rotation.x = Math.PI / 2;
    handleBar.position.set(-0.44, 0.83, 0);
    cart.add(handleBar);

    const bracketGeo = this.trackGeo(new THREE.BoxGeometry(0.08, 0.024, 0.024));
    for (const bz of [-0.17, 0.17]) {
      const bracket = new THREE.Mesh(bracketGeo, darkMat);
      bracket.position.set(-0.4, 0.83, bz);
      cart.add(bracket);
    }

    // Static socket set case & wrench prop on top mat
    const caseMesh = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.32, 0.045, 0.22)), darkMat);
    caseMesh.position.set(0.12, 0.912, 0.03);
    caseMesh.rotation.y = 0.12;
    cart.add(caseMesh);

    this.propsVisualsGroup.add(cart);
  }

  private buildWerkbank(): void {
    const bench = new THREE.Group();
    bench.position.set(2.4, 0, 1.35);

    const frameMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.48, metalness: 0.55 })
    );
    const woodMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x9c7248, roughness: 0.68, metalness: 0.02 })
    );
    const viseMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.42, metalness: 0.65 })
    );
    const steelMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.25, metalness: 0.9 })
    );

    // Steel legs
    const legGeo = this.trackGeo(new THREE.BoxGeometry(0.055, 0.85, 0.055));
    for (const lx of [-0.3, 0.3]) {
      for (const lz of [-0.72, 0.72]) {
        const leg = new THREE.Mesh(legGeo, frameMat);
        leg.position.set(lx, 0.425, lz);
        leg.castShadow = true;
        leg.receiveShadow = true;
        bench.add(leg);
      }
    }

    // Lower storage shelf
    const shelf = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.62, 0.03, 1.44)), frameMat);
    shelf.position.set(0, 0.22, 0);
    shelf.receiveShadow = true;
    bench.add(shelf);

    // Solid beechwood tabletop (top surface at Y = 0.895)
    const top = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.72, 0.05, 1.62)), woodMat);
    top.position.set(0, 0.87, 0);
    top.castShadow = true;
    top.receiveShadow = true;
    bench.add(top);

    // Cast iron bench vise on front-left corner
    const viseGroup = new THREE.Group();
    viseGroup.position.set(-0.24, 0.895, -0.58);
    const viseBody = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.14, 0.11, 0.16)), viseMat);
    viseBody.position.y = 0.055;
    const viseJaw = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.14, 0.06, 0.04)), steelMat);
    viseJaw.position.set(0, 0.095, -0.09);
    const viseHandle = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 10)),
      steelMat
    );
    viseHandle.rotation.z = Math.PI / 2;
    viseHandle.position.set(-0.1, 0.055, -0.11);
    viseGroup.add(viseBody, viseJaw, viseHandle);
    bench.add(viseGroup);

    // Stainless magnetic parts tray at (2.26, 0.91, 1.35) -> local (-0.14, 0.905, 0)
    const tray = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.24, 0.024, 0.34)), steelMat);
    tray.position.set(-0.14, 0.907, 0);
    tray.castShadow = true;
    bench.add(tray);

    const trayInner = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.2, 0.01, 0.3)),
      this.trackMat(new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.35, metalness: 0.85 }))
    );
    trayInner.position.set(-0.14, 0.915, 0);
    bench.add(trayInner);

    this.propsVisualsGroup.add(bench);
  }

  private buildReifenstaender(): void {
    const rack = new THREE.Group();
    rack.position.set(2.35, 0, -0.35);

    const steelMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.45, metalness: 0.72 })
    );
    const accentMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.45, metalness: 0.35 })
    );

    // Uprights (spanning Z = -0.62 to +0.62, height 1.32m)
    const uprightGeo = this.trackGeo(new THREE.BoxGeometry(0.045, 1.32, 0.045));
    for (const rx of [-0.22, 0.22]) {
      for (const rz of [-0.62, 0.62]) {
        const post = new THREE.Mesh(uprightGeo, steelMat);
        post.position.set(rx, 0.66, rz);
        post.castShadow = true;
        rack.add(post);
      }
    }

    // Horizontal wheel cradle bars at lower (Y=0.22) and upper (Y=0.82) tiers
    const barGeo = this.trackGeo(new THREE.CylinderGeometry(0.018, 0.018, 1.28, 12));
    for (const by of [0.22, 0.82]) {
      for (const bx of [-0.16, 0.16]) {
        const bar = new THREE.Mesh(barGeo, accentMat);
        bar.rotation.x = Math.PI / 2;
        bar.position.set(bx, by, 0);
        rack.add(bar);
      }
    }

    // End crossbars
    const crossGeo = this.trackGeo(new THREE.BoxGeometry(0.48, 0.04, 0.04));
    for (const cz of [-0.62, 0.62]) {
      for (const cy of [0.06, 1.28]) {
        const cross = new THREE.Mesh(crossGeo, steelMat);
        cross.position.set(0, cy, cz);
        rack.add(cross);
      }
    }

    // 2 spare workshop tires parked neatly in the back half (+Z) leaving front slot free for removed Golf wheel
    const tireTex = getTireTreadTextures();
    const tireMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        map: tireTex.map,
        bumpMap: tireTex.bumpMap,
        bumpScale: 0.012,
        roughnessMap: tireTex.roughnessMap,
        roughness: 1.0,
        metalness: 0.05,
      })
    );
    const spareTireGeo = this.trackGeo(new THREE.CylinderGeometry(0.31, 0.31, 0.215, 28));
    for (const tz of [0.26, 0.49]) {
      const tire = new THREE.Mesh(spareTireGeo, tireMat);
      tire.rotation.z = Math.PI / 2;
      tire.rotation.y = Math.PI / 2;
      tire.position.set(0, 0.42, tz);
      tire.castShadow = true;
      rack.add(tire);
    }

    this.propsVisualsGroup.add(rack);
  }

  private buildTwoPostLift(): { upButtonMesh: THREE.Mesh; downButtonMesh: THREE.Mesh } {
    const liftGroup = new THREE.Group();
    liftGroup.name = 'TwoPostLift';

    const colMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.42, metalness: 0.62 })
    );
    const darkSteelMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x1e2530, roughness: 0.5, metalness: 0.72 })
    );
    const yellowMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.4, metalness: 0.28 })
    );
    const rubberMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x141619, roughness: 0.88, metalness: 0.05 })
    );

    const colHeight = 3.65;
    const colZ = -0.35;

    // Left (X = -1.48) and Right (X = +1.48) H-Columns
    const flangeGeo = this.trackGeo(new THREE.BoxGeometry(0.032, colHeight, 0.28));
    const webGeo = this.trackGeo(new THREE.BoxGeometry(0.22, colHeight, 0.04));
    const basePlateGeo = this.trackGeo(new THREE.BoxGeometry(0.42, 0.025, 0.46));
    const anchorGeo = this.trackGeo(new THREE.CylinderGeometry(0.015, 0.015, 0.03, 6));
    const lockPlateGeo = this.trackGeo(new THREE.BoxGeometry(0.05, 0.34, 0.14));

    for (const sideX of [-1.48, 1.48]) {
      const col = new THREE.Group();
      col.position.set(sideX, 0, colZ);

      const base = new THREE.Mesh(basePlateGeo, darkSteelMat);
      base.position.y = 0.0125;
      base.receiveShadow = true;
      col.add(base);

      for (const ax of [-0.15, 0.15]) {
        for (const az of [-0.17, 0.17]) {
          const bolt = new THREE.Mesh(anchorGeo, darkSteelMat);
          bolt.position.set(ax, 0.03, az);
          col.add(bolt);
        }
      }

      const outerFlange = new THREE.Mesh(flangeGeo, colMat);
      outerFlange.position.set(sideX < 0 ? -0.11 : 0.11, colHeight / 2, 0);
      outerFlange.castShadow = true;
      outerFlange.receiveShadow = true;

      const innerFlangeL = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.032, colHeight, 0.075)),
        colMat
      );
      innerFlangeL.position.set(sideX < 0 ? 0.11 : -0.11, colHeight / 2, -0.102);
      innerFlangeL.castShadow = true;

      const innerFlangeR = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.032, colHeight, 0.075)),
        colMat
      );
      innerFlangeR.position.set(sideX < 0 ? 0.11 : -0.11, colHeight / 2, 0.102);
      innerFlangeR.castShadow = true;

      const web = new THREE.Mesh(webGeo, colMat);
      web.position.set(0, colHeight / 2, 0);
      web.castShadow = true;

      // Safety yellow mechanical lock latch cover
      const lockPlate = new THREE.Mesh(lockPlateGeo, yellowMat);
      lockPlate.position.set(sideX < 0 ? -0.135 : 0.135, 1.55, 0);

      col.add(outerFlange, innerFlangeL, innerFlangeR, web, lockPlate);
      liftGroup.add(col);
    }

    // Overhead gantry crossbar at Y = 3.65m
    const crossbar = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(3.26, 0.16, 0.24)), colMat);
    crossbar.position.set(0, colHeight + 0.06, colZ);
    crossbar.castShadow = true;
    liftGroup.add(crossbar);

    const safetyPad = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(2.6, 0.06, 0.16)), yellowMat);
    safetyPad.position.set(0, colHeight - 0.04, colZ);
    liftGroup.add(safetyPad);

    // Hydraulic power unit motor & reservoir mounted on right column outside (+X)
    const tank = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.18, 0.42, 0.2)), darkSteelMat);
    tank.position.set(1.66, 1.52, colZ);
    tank.castShadow = true;
    const motor = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(0.08, 0.08, 0.28, 16)), colMat);
    motor.position.set(1.66, 1.87, colZ);
    liftGroup.add(tank, motor);

    // Movable carriages & 4 telescoping swing arms (rubber pad top at local Y = 0.08)
    this.liftCarriagesGroup.name = 'LiftCarriages';
    const sleeveGeo = this.trackGeo(new THREE.BoxGeometry(0.16, 0.56, 0.25));
    const knuckleGeo = this.trackGeo(new THREE.CylinderGeometry(0.045, 0.045, 0.08, 16));
    const padStemGeo = this.trackGeo(new THREE.CylinderGeometry(0.024, 0.024, 0.028, 14));
    const rubberPadGeo = this.trackGeo(new THREE.CylinderGeometry(0.062, 0.065, 0.026, 20));

    const sillPoints: Array<{ colX: number; pivotZ: number; targetX: number; targetZ: number }> = [
      // Left front & rear jacking sills
      { colX: -1.48, pivotZ: -0.44, targetX: -0.72, targetZ: -0.9 },
      { colX: -1.48, pivotZ: -0.26, targetX: -0.72, targetZ: 0.85 },
      // Right front & rear jacking sills
      { colX: 1.48, pivotZ: -0.44, targetX: 0.72, targetZ: -0.9 },
      { colX: 1.48, pivotZ: -0.26, targetX: 0.72, targetZ: 0.85 },
    ];

    for (const sideX of [-1.48, 1.48]) {
      const innerSign = sideX < 0 ? 1 : -1;
      const sleeve = new THREE.Mesh(sleeveGeo, colMat);
      sleeve.position.set(sideX + innerSign * 0.1, 0.31, colZ);
      sleeve.castShadow = true;
      sleeve.receiveShadow = true;
      this.liftCarriagesGroup.add(sleeve);
    }

    for (const armSpec of sillPoints) {
      const innerSign = armSpec.colX < 0 ? 1 : -1;
      const pivotX = armSpec.colX + innerSign * 0.16;
      const pivotZ = armSpec.pivotZ;

      const dx = armSpec.targetX - pivotX;
      const dz = armSpec.targetZ - pivotZ;
      const armLen = Math.hypot(dx, dz);
      const yaw = Math.atan2(-dz, dx);

      const armGroup = new THREE.Group();
      armGroup.position.set(pivotX, 0, pivotZ);

      const knuckle = new THREE.Mesh(knuckleGeo, darkSteelMat);
      knuckle.position.y = 0.045;
      armGroup.add(knuckle);

      // Outer box beam + inner telescoping stage
      const outerLen = armLen * 0.56;
      const innerLen = armLen * 0.52;

      const armSwivel = new THREE.Group();
      armSwivel.rotation.y = yaw;

      const outerBeam = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(outerLen, 0.048, 0.068)),
        colMat
      );
      outerBeam.position.set(outerLen / 2, 0.042, 0);
      outerBeam.castShadow = true;

      const innerBeam = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(innerLen, 0.038, 0.052)),
        darkSteelMat
      );
      innerBeam.position.set(armLen - innerLen / 2, 0.042, 0);
      innerBeam.castShadow = true;

      // Yellow safety toe-guard tip near pad
      const armTip = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.08, 0.04, 0.056)),
        yellowMat
      );
      armTip.position.set(armLen - 0.03, 0.042, 0);

      // Screw stem (Y = 0.053) + rubber jacking puck (height 0.026 centered at Y = 0.067 => TOP at exactly 0.080)
      const stem = new THREE.Mesh(padStemGeo, darkSteelMat);
      stem.position.set(armLen, 0.052, 0);

      const rubberPad = new THREE.Mesh(rubberPadGeo, rubberMat);
      rubberPad.position.set(armLen, 0.067, 0);
      rubberPad.castShadow = true;
      rubberPad.receiveShadow = true;

      armSwivel.add(outerBeam, innerBeam, armTip, stem, rubberPad);
      armGroup.add(armSwivel);
      this.liftCarriagesGroup.add(armGroup);
    }

    // Interactive Lift Control Box on right column at (X = +1.32, Y = 1.25, Z = -0.58)
    const ctrlBoxGroup = new THREE.Group();
    ctrlBoxGroup.position.set(1.32, 1.25, -0.58);

    const mountBracket = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.06, 0.06, 0.26)),
      darkSteelMat
    );
    mountBracket.position.set(0.09, 0, 0.13);
    ctrlBoxGroup.add(mountBracket);

    const enclosure = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.14, 0.28, 0.1)),
      yellowMat
    );
    enclosure.castShadow = true;
    ctrlBoxGroup.add(enclosure);

    const faceplate = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.115, 0.24, 0.012)),
      darkSteelMat
    );
    faceplate.position.set(0, 0, -0.052);
    ctrlBoxGroup.add(faceplate);

    // Glowing green UP button ('liftControlUp')
    const upMeta: InteractableMeta = {
      id: 'liftControlUp',
      label: 'Hebebühne AUF (Grün)',
      status: 'Bereit',
      hint: 'Klicken zum Hochfahren auf Arbeitshöhe',
    };
    const upMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x22c55e,
        emissive: new THREE.Color(0x22c55e),
        emissiveIntensity: 1.45,
        roughness: 0.25,
        metalness: 0.1,
      })
    );
    const upButtonMesh = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.026, 0.028, 0.022, 20)),
      upMat
    );
    upButtonMesh.rotation.x = Math.PI / 2;
    upButtonMesh.position.set(0, 0.056, -0.066);
    upButtonMesh.userData.interactableId = 'liftControlUp';
    upButtonMesh.userData.meta = upMeta;

    const upBezel = new THREE.Mesh(
      this.trackGeo(new THREE.TorusGeometry(0.03, 0.004, 10, 20)),
      darkSteelMat
    );
    upBezel.position.set(0, 0.056, -0.058);
    upBezel.userData.interactableId = 'liftControlUp';

    // Glowing amber DOWN button ('liftControlDown')
    const downMeta: InteractableMeta = {
      id: 'liftControlDown',
      label: 'Hebebühne AB (Gelb)',
      status: 'Bereit',
      hint: 'Klicken zum Ablassen des Fahrzeugs',
    };
    const downMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: new THREE.Color(0xf59e0b),
        emissiveIntensity: 1.35,
        roughness: 0.25,
        metalness: 0.1,
      })
    );
    const downButtonMesh = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.026, 0.028, 0.022, 20)),
      downMat
    );
    downButtonMesh.rotation.x = Math.PI / 2;
    downButtonMesh.position.set(0, -0.052, -0.066);
    downButtonMesh.userData.interactableId = 'liftControlDown';
    downButtonMesh.userData.meta = downMeta;

    const downBezel = new THREE.Mesh(
      this.trackGeo(new THREE.TorusGeometry(0.03, 0.004, 10, 20)),
      darkSteelMat
    );
    downBezel.position.set(0, -0.052, -0.058);
    downBezel.userData.interactableId = 'liftControlDown';

    ctrlBoxGroup.add(upButtonMesh, upBezel, downButtonMesh, downBezel);
    liftGroup.add(ctrlBoxGroup);

    this.propsVisualsGroup.add(liftGroup);

    return { upButtonMesh, downButtonMesh };
  }

  public setLiftHeight(y: number): void {
    this.liftCarriagesGroup.position.y = Math.max(0, y);
  }

  public getInteractables(): THREE.Object3D[] {
    return [this.upButtonMesh, this.downButtonMesh];
  }

  public getPartWorldPos(id: 'liftControlUp' | 'liftControlDown'): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    const target = id === 'liftControlUp' ? this.upButtonMesh : this.downButtonMesh;
    return target.getWorldPosition(new THREE.Vector3());
  }

  public getWheelRackPos(): THREE.Vector3 {
    return this.wheelRackPos.clone();
  }

  public getBenchPartsPos(): THREE.Vector3 {
    return this.benchPartsPos.clone();
  }

  public dispose(): void {
    for (const geo of this.ownedGeometries) {
      geo.dispose();
    }
    for (const mat of this.ownedMaterials) {
      mat.dispose();
    }
    for (const tex of this.ownedTextures) {
      tex.dispose();
    }
    this.ownedGeometries.length = 0;
    this.ownedMaterials.length = 0;
    this.ownedTextures.length = 0;
  }
}
