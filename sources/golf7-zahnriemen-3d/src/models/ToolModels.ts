import * as THREE from 'three';
import { extractNode, getSharedModelUrl, loadGLB } from '../engine/AssetLoader';
import type { ToolId } from '../types';

type ActionToolId = Exclude<ToolId, 'hand' | 'newTimingBelt'>;

interface ActiveToolAction {
  toolId: ActionToolId;
  duration: number;
  elapsed: number;
}

/**
 * 3D mechanic toolset for the VW Golf 7 EA288 timing-belt workshop:
 * impact17, torx25, crankWrench, lockingPins, eccentricKey, and torqueWrench.
 * Hydrates from the shared Blender `tools.glb` while keeping procedural fallbacks.
 */
export class ToolModels {
  public readonly group = new THREE.Group();

  private readonly actionAnchor = new THREE.Group();
  private readonly actionToolGroups = new Map<ActionToolId, THREE.Group>();

  // Animated sub-pivots for action tools
  private readonly impactBodyGroup = new THREE.Group();
  private readonly impactSocketPivot = new THREE.Group();
  private readonly torxSpinPivot = new THREE.Group();
  private readonly crankWrenchPivot = new THREE.Group();
  private readonly torquePivot = new THREE.Group();
  private readonly actionEccentricPivot = new THREE.Group();
  private readonly pinBodyGroup = new THREE.Group();

  // Live attached tools for interactive OT cranking, eccentric tensioner & counterhold T10172 / T10051
  private readonly liveEccentricRoot = new THREE.Group();
  private readonly liveEccentricPivot = new THREE.Group();
  private readonly liveCrankRoot = new THREE.Group();
  private readonly liveCrankPivot = new THREE.Group();
  private readonly liveCounterholdRoot = new THREE.Group();
  private counterholdTimer = 0;

  private activeAction: ActiveToolAction | null = null;

  private readonly tmpBasisX = new THREE.Vector3();
  private readonly tmpBasisY = new THREE.Vector3();
  private readonly tmpBasisZ = new THREE.Vector3();
  private readonly tmpMat4 = new THREE.Matrix4();

  constructor() {
    this.group.name = 'MechanicTools';

    this.actionAnchor.name = 'ToolActionAnchor';
    this.actionAnchor.visible = false;
    this.group.add(this.actionAnchor);

    const scaleTex = this.createTorqueScaleTexture();

    this.registerActionTool('impact17', this.buildImpactWrench17());
    this.registerActionTool('torx25', this.buildTorx25Screwdriver());
    this.registerActionTool('crankWrench', this.buildCrankWrench(this.crankWrenchPivot));
    this.registerActionTool('torqueWrench', this.buildTorqueWrench(scaleTex));
    this.registerActionTool('eccentricKey', this.buildEccentricKey(this.actionEccentricPivot));
    this.registerActionTool('lockingPins', this.buildLockPinTool());

    // Live eccentric adjustment wrench attached on the timing tensioner
    this.liveEccentricRoot.name = 'ActiveEccentricWrench';
    this.liveEccentricRoot.visible = false;
    this.liveEccentricRoot.add(this.buildEccentricKey(this.liveEccentricPivot));
    this.group.add(this.liveEccentricRoot);

    // Live crankshaft wrench attached during OT alignment
    this.liveCrankRoot.name = 'ActiveCrankWrench';
    this.liveCrankRoot.visible = false;
    this.liveCrankRoot.add(this.buildCrankWrench(this.liveCrankPivot));
    this.group.add(this.liveCrankRoot);

    // Live V-fork Counterhold tool (T10172 + T10172/11 on cam / T10051 on HDP)
    this.liveCounterholdRoot.name = 'ActiveCounterholdTool';
    this.liveCounterholdRoot.visible = false;
    this.liveCounterholdRoot.add(this.buildCounterholdFork());
    this.group.add(this.liveCounterholdRoot);
  }

  public async loadBlenderModel(): Promise<void> {
    const glb = await loadGLB(getSharedModelUrl('tools.glb'));

    const impactNode = extractNode(glb, 'Tool_impact17', true);
    if (impactNode) {
      const socketNode = impactNode.getObjectByName('Tool_impact17_Socket');
      this.impactSocketPivot.clear();
      if (socketNode) {
        socketNode.parent?.remove(socketNode);
        this.impactSocketPivot.add(socketNode);
      }
      this.impactBodyGroup.clear();
      this.impactBodyGroup.add(this.impactSocketPivot);
      this.impactBodyGroup.add(impactNode);
    }

    const torxNode = extractNode(glb, 'Tool_torx25', true);
    if (torxNode) {
      this.torxSpinPivot.clear();
      this.torxSpinPivot.add(torxNode);
    }

    const ratchetNode = extractNode(glb, 'Tool_ratchet13', true);
    if (ratchetNode) {
      this.crankWrenchPivot.clear();
      this.crankWrenchPivot.add(ratchetNode);

      this.liveCrankPivot.clear();
      this.liveCrankPivot.add(ratchetNode.clone(true));
    }

    const torqueNode = extractNode(glb, 'Tool_torqueWrench', true);
    if (torqueNode) {
      this.torquePivot.clear();
      this.torquePivot.add(torqueNode);
    }

    const pinNode = extractNode(glb, 'Tool_pinT10060A', true);
    if (pinNode) {
      this.pinBodyGroup.clear();
      this.pinBodyGroup.add(pinNode);
    }

    const wrenchNode = extractNode(glb, 'Tool_wrench16', true);
    if (wrenchNode) {
      this.actionEccentricPivot.clear();
      this.actionEccentricPivot.add(wrenchNode);

      this.liveEccentricPivot.clear();
      this.liveEccentricPivot.add(wrenchNode.clone(true));
    }
  }

  public playToolAction(
    toolId: ToolId,
    targetWorldPos: THREE.Vector3,
    duration = 0.65,
    axisDir?: THREE.Vector3
  ): void {
    if (toolId === 'hand' || toolId === 'newTimingBelt') {
      return;
    }

    this.tmpBasisX.copy(axisDir ?? new THREE.Vector3(1, 0, 0)).normalize();
    const upHint =
      Math.abs(this.tmpBasisX.y) > 0.92 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    this.tmpBasisZ.crossVectors(this.tmpBasisX, upHint).normalize();
    this.tmpBasisY.crossVectors(this.tmpBasisZ, this.tmpBasisX).normalize();

    this.tmpMat4.makeBasis(this.tmpBasisX, this.tmpBasisY, this.tmpBasisZ);
    this.actionAnchor.position.copy(targetWorldPos);
    this.actionAnchor.quaternion.setFromRotationMatrix(this.tmpMat4);
    this.actionAnchor.visible = true;

    for (const [id, toolGroup] of this.actionToolGroups) {
      toolGroup.visible = id === toolId;
    }

    this.activeAction = {
      toolId,
      duration: Math.max(0.25, duration),
      elapsed: 0,
    };

    this.applyActionFrame(0);
  }

  public setActiveEccentricKey(
    visible: boolean,
    worldPos?: THREE.Vector3,
    angleRad = 0
  ): void {
    this.liveEccentricRoot.visible = visible;
    if (!visible) return;
    if (worldPos) {
      this.liveEccentricRoot.position.copy(worldPos);
    }
    this.liveEccentricRoot.quaternion.identity();
    this.liveEccentricPivot.rotation.x = angleRad;
  }

  public setActiveCrankWrench(
    visible: boolean,
    worldPos?: THREE.Vector3,
    angleRad = 0
  ): void {
    this.liveCrankRoot.visible = visible;
    if (!visible) return;
    if (worldPos) {
      this.liveCrankRoot.position.copy(worldPos);
    }
    this.liveCrankRoot.quaternion.identity();
    this.liveCrankPivot.rotation.x = angleRad;
  }

  public showCounterhold(worldPos: THREE.Vector3, duration = 0.85, scale = 1): void {
    this.liveCounterholdRoot.position.copy(worldPos);
    this.liveCounterholdRoot.scale.setScalar(scale);
    this.liveCounterholdRoot.visible = true;
    this.counterholdTimer = Math.max(0.25, duration);
  }

  public setActiveCounterhold(visible: boolean, worldPos?: THREE.Vector3, scale = 1): void {
    this.liveCounterholdRoot.visible = visible;
    this.counterholdTimer = visible ? 999 : 0;
    if (visible && worldPos) {
      this.liveCounterholdRoot.position.copy(worldPos);
      this.liveCounterholdRoot.scale.setScalar(scale);
    }
  }

  public update(dt: number): void {
    const clampedDt = Math.min(dt, 0.05);

    if (this.counterholdTimer > 0 && this.counterholdTimer < 900) {
      this.counterholdTimer -= clampedDt;
      if (this.counterholdTimer <= 0) {
        this.counterholdTimer = 0;
        this.liveCounterholdRoot.visible = false;
      }
    }

    if (!this.activeAction) return;

    this.activeAction.elapsed += clampedDt;
    const progress = this.activeAction.elapsed / this.activeAction.duration;

    if (progress >= 1) {
      this.activeAction = null;
      this.actionAnchor.visible = false;
      return;
    }

    this.applyActionFrame(progress, clampedDt);
  }

  private applyActionFrame(progress: number, dt = 0): void {
    if (!this.activeAction) return;
    const { toolId, elapsed } = this.activeAction;

    let approachOffset = 0;
    if (progress < 0.16) {
      const t = 1 - progress / 0.16;
      approachOffset = t * t * 0.11;
    } else if (progress > 0.82) {
      const t = (progress - 0.82) / 0.18;
      approachOffset = t * t * 0.11;
    }

    const workPhase = Math.max(0, Math.min(1, (progress - 0.16) / 0.66));

    switch (toolId) {
      case 'impact17': {
        const vib = progress >= 0.16 && progress <= 0.82 ? Math.sin(elapsed * 95) * 0.0022 : 0;
        this.impactBodyGroup.position.set(approachOffset + vib, vib * 0.6, 0);
        if (progress >= 0.12 && progress <= 0.86) {
          this.impactSocketPivot.rotation.x -= dt * 42;
        }
        break;
      }

      case 'torx25': {
        this.torxSpinPivot.position.set(approachOffset, 0, 0);
        if (progress >= 0.12 && progress <= 0.86) {
          this.torxSpinPivot.rotation.x -= dt * 24;
        }
        break;
      }

      case 'crankWrench': {
        this.crankWrenchPivot.position.set(approachOffset, 0, 0);
        const rock = Math.sin(workPhase * Math.PI * 4) * 0.36;
        this.crankWrenchPivot.rotation.x = 0.25 + rock;
        break;
      }

      case 'torqueWrench': {
        this.torquePivot.position.set(approachOffset, 0, 0);
        if (workPhase < 0.78) {
          const pullT = workPhase / 0.78;
          this.torquePivot.rotation.x = 0.58 * (1 - pullT) - 0.12;
        } else {
          const snapT = (workPhase - 0.78) / 0.22;
          const recoil = Math.sin(snapT * Math.PI * 2.5) * Math.exp(-snapT * 4) * 0.09;
          this.torquePivot.rotation.x = -0.18 - recoil;
        }
        break;
      }

      case 'eccentricKey': {
        this.actionEccentricPivot.position.set(approachOffset, 0, 0);
        this.actionEccentricPivot.rotation.x = -Math.sin(workPhase * Math.PI) * 0.58;
        break;
      }

      case 'lockingPins': {
        const pushDepth =
          progress < 0.5
            ? 0.085 * (1 - Math.min(1, progress / 0.35))
            : 0.085 * Math.max(0, (progress - 0.65) / 0.35);
        this.pinBodyGroup.position.set(pushDepth, 0, 0);
        break;
      }
    }
  }

  private registerActionTool(id: ActionToolId, toolGroup: THREE.Group): void {
    toolGroup.visible = false;
    this.actionToolGroups.set(id, toolGroup);
    this.actionAnchor.add(toolGroup);
  }

  private buildImpactWrench17(): THREE.Group {
    const root = new THREE.Group();
    root.add(this.impactBodyGroup);
    const redMat = new THREE.MeshStandardMaterial({ color: 0xc81e24, metalness: 0.25, roughness: 0.36 });
    const rubberMat = new THREE.MeshStandardMaterial({ color: 0x16181d, metalness: 0.08, roughness: 0.82 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.94, roughness: 0.14 });
    this.impactBodyGroup.add(this.impactSocketPivot);
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.0155, 0.0155, 0.052, 20), chromeMat);
    socket.rotation.z = Math.PI / 2;
    socket.position.x = 0.026;
    this.impactSocketPivot.add(socket);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.033, 0.12, 20), redMat);
    body.rotation.z = Math.PI / 2;
    body.position.x = 0.135;
    this.impactBodyGroup.add(body);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.125, 0.032), rubberMat);
    grip.position.set(0.14, -0.088, 0);
    this.impactBodyGroup.add(grip);
    return root;
  }

  private buildTorx25Screwdriver(): THREE.Group {
    const root = new THREE.Group();
    root.add(this.torxSpinPivot);
    const blueMat = new THREE.MeshStandardMaterial({ color: 0x1d5bbf, metalness: 0.18, roughness: 0.28 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.94, roughness: 0.14 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0032, 0.0032, 0.12, 14), chromeMat);
    shaft.rotation.z = Math.PI / 2;
    shaft.position.x = 0.065;
    this.torxSpinPivot.add(shaft);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.014, 0.11, 16), blueMat);
    handle.rotation.z = Math.PI / 2;
    handle.position.x = 0.175;
    this.torxSpinPivot.add(handle);
    return root;
  }

  private buildCrankWrench(pivotTarget: THREE.Group): THREE.Group {
    const root = new THREE.Group();
    root.add(pivotTarget);
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe5eaf1, metalness: 0.94, roughness: 0.14 });
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x1a1e24, metalness: 0.12, roughness: 0.78 });
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.036, 18), chromeMat);
    socket.rotation.z = Math.PI / 2;
    socket.position.x = 0.018;
    pivotTarget.add(socket);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.018, 22), chromeMat);
    head.rotation.z = Math.PI / 2;
    head.position.x = 0.065;
    pivotTarget.add(head);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.18, 0.016), chromeMat);
    beam.position.set(0.068, 0.095, 0);
    pivotTarget.add(beam);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.0115, 0.095, 16), gripMat);
    handle.position.set(0.068, 0.195, 0);
    pivotTarget.add(handle);
    return root;
  }

  private buildTorqueWrench(scaleTex: THREE.CanvasTexture): THREE.Group {
    const root = new THREE.Group();
    root.add(this.torquePivot);
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe6ebf2, metalness: 0.95, roughness: 0.12 });
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x15181d, metalness: 0.2, roughness: 0.85 });
    const scaleMat = new THREE.MeshStandardMaterial({ map: scaleTex, metalness: 0.6, roughness: 0.3 });
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.042, 20), chromeMat);
    socket.rotation.z = Math.PI / 2;
    socket.position.x = 0.021;
    this.torquePivot.add(socket);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.28, 18), chromeMat);
    shaft.position.set(0.072, 0.15, 0);
    this.torquePivot.add(shaft);
    const scale = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0135, 0.075, 20), scaleMat);
    scale.position.set(0.072, 0.26, 0);
    this.torquePivot.add(scale);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.015, 0.12, 20), gripMat);
    grip.position.set(0.072, 0.37, 0);
    this.torquePivot.add(grip);
    return root;
  }

  private buildEccentricKey(pivotTarget: THREE.Group): THREE.Group {
    const root = new THREE.Group();
    root.add(pivotTarget);
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe6ebf2, metalness: 0.94, roughness: 0.15 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0155, 0.0052, 12, 24), chromeMat);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = 0.008;
    pivotTarget.add(ring);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.0065, 0.175, 0.018), chromeMat);
    beam.position.set(0.026, 0.11, 0);
    pivotTarget.add(beam);
    return root;
  }

  private buildLockPinTool(): THREE.Group {
    const root = new THREE.Group();
    root.add(this.pinBodyGroup);
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x3b424d, metalness: 0.88, roughness: 0.28 });
    const redMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, metalness: 0.72, roughness: 0.26 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0032, 0.0032, 0.06, 14), steelMat);
    shaft.rotation.z = Math.PI / 2;
    shaft.position.x = 0.034;
    this.pinBodyGroup.add(shaft);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.042, 20), redMat);
    grip.rotation.z = Math.PI / 2;
    grip.position.x = 0.088;
    this.pinBodyGroup.add(grip);
    return root;
  }

  private buildCounterholdFork(): THREE.Group {
    const root = new THREE.Group();
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xbac4d0, metalness: 0.88, roughness: 0.24 });
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.14, roughness: 0.78 });
    const pinMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.72, roughness: 0.28 });

    // Twin V-arms engaging two sprocket holes (T10172 + T10172/11 / T10051 style, matching REPXPERT 07:05 & 08:40)
    for (const side of [-1, 1] as const) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.175, 0.014), steelMat);
      arm.position.set(0.022, 0.082, side * 0.024);
      arm.rotation.x = side * 0.16;
      root.add(arm);

      // Engagement adapter pin (T10172/11) reaching into sprocket lightening hole
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.024, 12), pinMat);
      pin.rotation.z = Math.PI / 2;
      pin.position.set(0.008, 0.004, side * 0.036);
      root.add(pin);
    }

    // Pivot bridge & long vertical leverage handle extending upward clear of the timing drive
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.022, 0.032), steelMat);
    bridge.position.set(0.022, 0.168, 0);
    root.add(bridge);

    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.010, 0.15, 14), gripMat);
    handle.position.set(0.022, 0.248, 0);
    root.add(handle);

    return root;
  }

  private createTorqueScaleTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(28, 16, 200, 96);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    for (let x = 44; x <= 212; x += 14) {
      ctx.beginPath();
      ctx.moveTo(x, 22);
      ctx.lineTo(x, x % 28 === 0 ? 52 : 40);
      ctx.stroke();
    }
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('20–120 Nm', 56, 92);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
}
