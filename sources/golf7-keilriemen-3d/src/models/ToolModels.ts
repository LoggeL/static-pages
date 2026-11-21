import * as THREE from 'three';
import { extractNode, loadGLB } from '../engine/AssetLoader';
import type { ToolId } from '../types';

type ActionToolId = Exclude<ToolId, 'hand' | 'newParts'>;

interface ActiveToolAction {
  toolId: ActionToolId;
  duration: number;
  elapsed: number;
}

/**
 * High-detail procedural 3D mechanic toolset for the VW Golf 7 EA288 belt service:
 * impact17, torx25, ratchet13, torqueWrench, wrench16 (SW 16 offset box wrench), and pinT10060A.
 */
export class ToolModels {
  public readonly group = new THREE.Group();

  private readonly actionAnchor = new THREE.Group();
  private readonly actionToolGroups = new Map<ActionToolId, THREE.Group>();

  // Animated sub-pivots for action tools
  private readonly impactBodyGroup = new THREE.Group();
  private readonly impactSocketPivot = new THREE.Group();
  private readonly torxSpinPivot = new THREE.Group();
  private readonly ratchetPivot = new THREE.Group();
  private readonly torquePivot = new THREE.Group();
  private readonly actionWrenchPivot = new THREE.Group();
  private readonly pinBodyGroup = new THREE.Group();

  // Live attached SW 16 wrench for the interactive tensioner minigame
  private readonly tensionerWrenchRoot = new THREE.Group();
  private readonly tensionerWrenchPivot = new THREE.Group();

  private activeAction: ActiveToolAction | null = null;

  // Reusable math temporaries
  private readonly tmpBasisX = new THREE.Vector3();
  private readonly tmpBasisY = new THREE.Vector3();
  private readonly tmpBasisZ = new THREE.Vector3();
  private readonly tmpMat4 = new THREE.Matrix4();
  private readonly tmpVec = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();

  constructor() {
    this.group.name = 'MechanicTools';

    this.actionAnchor.name = 'ToolActionAnchor';
    this.actionAnchor.visible = false;
    this.group.add(this.actionAnchor);

    const scaleTex = this.createTorqueScaleTexture();

    this.registerActionTool('impact17', this.buildImpactWrench17());
    this.registerActionTool('torx25', this.buildTorx25Screwdriver());
    this.registerActionTool('ratchet13', this.buildRatchet13());
    this.registerActionTool('torqueWrench', this.buildTorqueWrench(scaleTex));
    this.registerActionTool('wrench16', this.buildOffsetWrench16(this.actionWrenchPivot));
    this.registerActionTool('pinT10060A', this.buildLockPinT10060A());

    // Dedicated live tensioner SW 16 wrench attached directly onto EA288 tensioner hex boss
    this.tensionerWrenchRoot.name = 'ActiveTensionerWrench16';
    this.tensionerWrenchRoot.visible = false;
    this.tensionerWrenchRoot.add(this.buildOffsetWrench16(this.tensionerWrenchPivot));
    this.group.add(this.tensionerWrenchRoot);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  public async loadBlenderModel(): Promise<void> {
    const glb = await loadGLB('./models/tools.glb');

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
      this.ratchetPivot.clear();
      this.ratchetPivot.add(ratchetNode);
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
      this.actionWrenchPivot.clear();
      this.actionWrenchPivot.add(wrenchNode);

      this.tensionerWrenchPivot.clear();
      this.tensionerWrenchPivot.add(wrenchNode.clone(true));
    }
  }

  /**
   * Spawns and animates a 3D tool at the target world position aligned along axisDir (defaults to +X).
   */
  public playToolAction(
    toolId: ToolId,
    targetWorldPos: THREE.Vector3,
    duration = 0.65,
    axisDir?: THREE.Vector3
  ): void {
    if (toolId === 'hand' || toolId === 'newParts') {
      return;
    }

    // Align actionAnchor so local +X points outward along axisDir from bolt toward mechanic
    this.tmpBasisX
      .copy(axisDir ?? new THREE.Vector3(1, 0, 0))
      .normalize();

    const upHint = Math.abs(this.tmpBasisX.y) > 0.92 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
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

  /**
   * Positions, orients, and rotates the 3D SW 16 offset box wrench directly on the tensioner hex boss.
   */
  public setActiveTensionerWrench(
    visible: boolean,
    hexWorldPos?: THREE.Vector3,
    hexWorldQuat?: THREE.Quaternion,
    angleRad = 0
  ): void {
    this.tensionerWrenchRoot.visible = visible;
    if (!visible) return;

    if (hexWorldPos) {
      this.tensionerWrenchRoot.position.copy(hexWorldPos);
    }

    if (hexWorldQuat) {
      this.applyNormalizedHexQuaternion(this.tensionerWrenchRoot.quaternion, hexWorldQuat);
    } else {
      this.tensionerWrenchRoot.quaternion.identity();
    }

    this.tensionerWrenchPivot.rotation.x = angleRad;
  }

  public update(dt: number): void {
    if (!this.activeAction) return;

    const clampedDt = Math.min(dt, 0.05);
    this.activeAction.elapsed += clampedDt;
    const progress = this.activeAction.elapsed / this.activeAction.duration;

    if (progress >= 1) {
      this.activeAction = null;
      this.actionAnchor.visible = false;
      return;
    }

    this.applyActionFrame(progress, clampedDt);
  }

  // ---------------------------------------------------------------------------
  // Animation Driver
  // ---------------------------------------------------------------------------

  private applyActionFrame(progress: number, dt = 0): void {
    if (!this.activeAction) return;
    const { toolId, elapsed } = this.activeAction;

    // Approach (0..0.16) -> Engage (0.16..0.82) -> Retract (0.82..1.0)
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

      case 'ratchet13': {
        this.ratchetPivot.position.set(approachOffset, 0, 0);
        // Ergonomic ratcheting arc around bolt axis
        const rock = Math.sin(workPhase * Math.PI * 4) * 0.36;
        this.ratchetPivot.rotation.x = 0.25 + rock;
        break;
      }

      case 'torqueWrench': {
        this.torquePivot.position.set(approachOffset, 0, 0);
        // Smooth tightening sweep ending in a calibrated tactile click snap at workPhase = 0.78
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

      case 'wrench16': {
        this.actionWrenchPivot.position.set(approachOffset, 0, 0);
        this.actionWrenchPivot.rotation.x = -Math.sin(workPhase * Math.PI) * 0.58;
        break;
      }

      case 'pinT10060A': {
        const pushDepth = progress < 0.5 ? 0.085 * (1 - Math.min(1, progress / 0.35)) : 0.085 * Math.max(0, (progress - 0.65) / 0.35);
        this.pinBodyGroup.position.set(pushDepth, 0, 0);
        break;
      }
    }
  }

  /**
   * Ensures a caller-provided hexWorldQuat aligns the wrench ring cleanly around the engine's +X spindle axis,
   * even if the source mesh was a raw CylinderGeometry rotated +-90° around Z or Y.
   */
  private applyNormalizedHexQuaternion(target: THREE.Quaternion, sourceQuat: THREE.Quaternion): void {
    target.copy(sourceQuat);

    const localX = this.tmpVec.set(1, 0, 0).applyQuaternion(sourceQuat);
    if (localX.x > 0.82) {
      return;
    }

    const localY = this.tmpVec.set(0, 1, 0).applyQuaternion(sourceQuat);
    if (Math.abs(localY.x) > 0.82) {
      const fixZ = localY.x > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.tmpQuat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), fixZ);
      target.multiply(this.tmpQuat);
      return;
    }

    const localZ = this.tmpVec.set(0, 0, 1).applyQuaternion(sourceQuat);
    if (Math.abs(localZ.x) > 0.82) {
      const fixY = localZ.x > 0 ? -Math.PI / 2 : Math.PI / 2;
      this.tmpQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), fixY);
      target.multiply(this.tmpQuat);
    }
  }

  private registerActionTool(id: ActionToolId, toolGroup: THREE.Group): void {
    toolGroup.visible = false;
    this.actionToolGroups.set(id, toolGroup);
    this.actionAnchor.add(toolGroup);
  }

  // ---------------------------------------------------------------------------
  // Individual 3D Tool Builders (Working Tip at Local (0,0,0), Extends +X)
  // ---------------------------------------------------------------------------

  private buildImpactWrench17(): THREE.Group {
    const root = new THREE.Group();
    root.name = 'ImpactWrench17';
    root.add(this.impactBodyGroup);

    const redBodyMat = new THREE.MeshStandardMaterial({
      color: 0xc81e24,
      metalness: 0.25,
      roughness: 0.36,
    });
    const rubberMat = new THREE.MeshStandardMaterial({
      color: 0x16181d,
      metalness: 0.08,
      roughness: 0.82,
    });
    const alloyMat = new THREE.MeshStandardMaterial({
      color: 0xb8c0ca,
      metalness: 0.84,
      roughness: 0.26,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.94,
      roughness: 0.14,
    });
    const ledMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xe0f2fe,
      emissiveIntensity: 2.2,
    });

    // Rotating 17mm deep impact socket (tip at X = 0)
    this.impactBodyGroup.add(this.impactSocketPivot);

    const socket = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0155, 0.0155, 0.052, 20),
      chromeMat
    );
    socket.rotation.z = Math.PI / 2;
    socket.position.x = 0.026;
    this.impactSocketPivot.add(socket);

    const socketBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.008, 20),
      redBodyMat
    );
    socketBand.rotation.z = Math.PI / 2;
    socketBand.position.x = 0.042;
    this.impactSocketPivot.add(socketBand);

    // Anvil & cast aluminum hammer housing
    const anvil = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.010, 0.018, 12), alloyMat);
    anvil.rotation.z = Math.PI / 2;
    anvil.position.x = 0.058;
    this.impactBodyGroup.add(anvil);

    const hammerNose = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.032, 0.058, 22),
      alloyMat
    );
    hammerNose.rotation.z = Math.PI / 2;
    hammerNose.position.x = 0.092;
    this.impactBodyGroup.add(hammerNose);

    // LED worklight ring around nose
    const ledRing = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.003, 8, 20), ledMat);
    ledRing.rotation.y = Math.PI / 2;
    ledRing.position.x = 0.064;
    this.impactBodyGroup.add(ledRing);

    // Main motor barrel
    const motorHousing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.034, 0.033, 0.11, 20),
      redBodyMat
    );
    motorHousing.rotation.z = Math.PI / 2;
    motorHousing.position.x = 0.165;
    this.impactBodyGroup.add(motorHousing);

    const rearBoot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0345, 0.031, 0.024, 20),
      rubberMat
    );
    rearBoot.rotation.z = Math.PI / 2;
    rearBoot.position.x = 0.222;
    this.impactBodyGroup.add(rearBoot);

    // Ergonomic rubber overmold pistol handle
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.125, 0.032), rubberMat);
    grip.position.set(0.158, -0.088, 0);
    grip.rotation.z = 0.18;
    this.impactBodyGroup.add(grip);

    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.022, 0.014), redBodyMat);
    trigger.position.set(0.128, -0.044, 0);
    this.impactBodyGroup.add(trigger);

    // 18V Lithium slide-on battery pack
    const battery = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.052, 0.072), rubberMat);
    battery.position.set(0.172, -0.162, 0);
    this.impactBodyGroup.add(battery);

    const batteryAccent = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.012, 0.074), redBodyMat);
    batteryAccent.position.set(0.172, -0.142, 0);
    this.impactBodyGroup.add(batteryAccent);

    return root;
  }

  private buildTorx25Screwdriver(): THREE.Group {
    const root = new THREE.Group();
    root.name = 'TorxT25Screwdriver';
    root.add(this.torxSpinPivot);

    const blueHandleMat = new THREE.MeshStandardMaterial({
      color: 0x1d5bbf,
      metalness: 0.18,
      roughness: 0.26,
    });
    const blackGripMat = new THREE.MeshStandardMaterial({
      color: 0x14171c,
      metalness: 0.08,
      roughness: 0.84,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.94,
      roughness: 0.14,
    });
    const s2TipMat = new THREE.MeshStandardMaterial({
      color: 0x3b424c,
      metalness: 0.86,
      roughness: 0.34,
    });

    // 6-lobe Torx T25 star tip at X = 0
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0026, 0.0022, 0.016, 6), s2TipMat);
    tip.rotation.z = Math.PI / 2;
    tip.position.x = 0.008;
    this.torxSpinPivot.add(tip);

    // Chrome blade shaft
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0032, 0.0032, 0.115, 14), chromeMat);
    shaft.rotation.z = Math.PI / 2;
    shaft.position.x = 0.072;
    this.torxSpinPivot.add(shaft);

    // Hex bolster collar
    const bolster = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.007, 0.014, 6), blackGripMat);
    bolster.rotation.z = Math.PI / 2;
    bolster.position.x = 0.135;
    this.torxSpinPivot.add(bolster);

    // Contoured cobalt-blue + black ergonomic handle (LatheGeometry)
    const handleProfile = [
      new THREE.Vector2(0.009, 0),
      new THREE.Vector2(0.016, 0.018),
      new THREE.Vector2(0.014, 0.042),
      new THREE.Vector2(0.0185, 0.078),
      new THREE.Vector2(0.0165, 0.105),
      new THREE.Vector2(0.0, 0.115),
    ];
    const handleGeom = new THREE.LatheGeometry(handleProfile, 18);
    handleGeom.rotateZ(-Math.PI / 2);
    const handle = new THREE.Mesh(handleGeom, blueHandleMat);
    handle.position.x = 0.14;
    this.torxSpinPivot.add(handle);

    // Soft-grip longitudinal rubber flutes
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const flute = new THREE.Mesh(new THREE.BoxGeometry(0.076, 0.007, 0.007), blackGripMat);
      flute.position.set(0.195, Math.sin(a) * 0.016, Math.cos(a) * 0.016);
      flute.rotation.x = -a;
      this.torxSpinPivot.add(flute);
    }

    return root;
  }

  private buildRatchet13(): THREE.Group {
    const root = new THREE.Group();
    root.name = 'Ratchet13mm';
    root.add(this.ratchetPivot);

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xe5eaf1,
      metalness: 0.94,
      roughness: 0.14,
    });
    const gripMat = new THREE.MeshStandardMaterial({
      color: 0x1a1e24,
      metalness: 0.12,
      roughness: 0.78,
    });
    const selectorMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      metalness: 0.3,
      roughness: 0.35,
    });

    // 13mm deep chrome socket (tip at X = 0)
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.036, 18), chromeMat);
    socket.rotation.z = Math.PI / 2;
    socket.position.x = 0.018;
    this.ratchetPivot.add(socket);

    // Short 3/8" extension bar (clears pulley lip cleanly)
    const ext = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.055, 14), chromeMat);
    ext.rotation.z = Math.PI / 2;
    ext.position.x = 0.062;
    this.ratchetPivot.add(ext);

    // Pear-shaped ratchet head
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.018, 22), chromeMat);
    head.rotation.z = Math.PI / 2;
    head.position.x = 0.095;
    this.ratchetPivot.add(head);

    const dirLever = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.018, 0.008), selectorMat);
    dirLever.position.set(0.106, 0.004, 0);
    this.ratchetPivot.add(dirLever);

    // Chrome beam extending upward/outward in YZ plane
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.18, 0.016), chromeMat);
    beam.position.set(0.098, 0.095, 0);
    this.ratchetPivot.add(beam);

    // Ergonomic knurled rubber handle
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.013, 0.0115, 0.098, 16),
      gripMat
    );
    handle.position.set(0.098, 0.195, 0);
    this.ratchetPivot.add(handle);

    return root;
  }

  private buildTorqueWrench(scaleTex: THREE.CanvasTexture): THREE.Group {
    const root = new THREE.Group();
    root.name = 'TorqueWrench';
    root.add(this.torquePivot);

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xe6ebf2,
      metalness: 0.95,
      roughness: 0.12,
    });
    const knurlGripMat = new THREE.MeshStandardMaterial({
      color: 0x15181d,
      metalness: 0.2,
      roughness: 0.85,
    });
    const collarMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      metalness: 0.88,
      roughness: 0.22,
    });
    const scaleMat = new THREE.MeshStandardMaterial({
      map: scaleTex,
      metalness: 0.6,
      roughness: 0.3,
    });

    // Socket at X = 0
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.042, 20), chromeMat);
    socket.rotation.z = Math.PI / 2;
    socket.position.x = 0.021;
    this.torquePivot.add(socket);

    // Extension clearance neck
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.045, 16), chromeMat);
    neck.rotation.z = Math.PI / 2;
    neck.position.x = 0.064;
    this.torquePivot.add(neck);

    // Ratcheting drive head
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.020, 24), chromeMat);
    head.rotation.z = Math.PI / 2;
    head.position.x = 0.092;
    this.torquePivot.add(head);

    // Long calibrated chrome shaft (0.42 m lever arm)
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.29, 18), chromeMat);
    shaft.position.set(0.096, 0.155, 0);
    this.torquePivot.add(shaft);

    // Etched Nm scale window collar
    const scaleCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0135, 0.0135, 0.075, 20),
      scaleMat
    );
    scaleCollar.position.set(0.096, 0.27, 0);
    this.torquePivot.add(scaleCollar);

    // Micrometer locking ring
    const lockCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.024, 20),
      collarMat
    );
    lockCollar.position.set(0.096, 0.32, 0);
    this.torquePivot.add(lockCollar);

    // Black knurled grip & end adjuster cap
    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0165, 0.0155, 0.125, 20),
      knurlGripMat
    );
    grip.position.set(0.096, 0.39, 0);
    this.torquePivot.add(grip);

    const endCap = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.016, 18), collarMat);
    endCap.position.set(0.096, 0.458, 0);
    this.torquePivot.add(endCap);

    return root;
  }

  private buildOffsetWrench16(pivotTarget: THREE.Group): THREE.Group {
    const root = new THREE.Group();
    root.name = 'Wrench16mm';
    root.add(pivotTarget);

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xe6ebf2,
      metalness: 0.94,
      roughness: 0.15,
    });
    const innerRingMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.85,
      roughness: 0.32,
    });

    // 16mm 12-point ring head centered around (0, 0, 0) gripping the tensioner hex boss
    const ringOuter = new THREE.Mesh(new THREE.TorusGeometry(0.0155, 0.0052, 12, 24), chromeMat);
    ringOuter.rotation.y = Math.PI / 2;
    ringOuter.position.x = 0.008;
    pivotTarget.add(ringOuter);

    // Subtle 12-point bi-hex inner teeth collar
    const ringInner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0115, 0.0115, 0.011, 12, 1, true),
      innerRingMat
    );
    ringInner.rotation.z = Math.PI / 2;
    ringInner.position.x = 0.008;
    pivotTarget.add(ringInner);

    // Offset neck stepping outward (+X) to clear pulley & belt cleanly while angling upward-forward
    const neckAngle = -0.36; // angled slightly forward (-Z) from straight up (+Y)
    const neckGroup = new THREE.Group();
    neckGroup.rotation.x = neckAngle;
    pivotTarget.add(neckGroup);

    const offsetNeck = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.036, 0.015), chromeMat);
    offsetNeck.position.set(0.018, 0.024, 0);
    offsetNeck.rotation.z = -0.45;
    neckGroup.add(offsetNeck);

    // Main I-beam chrome wrench shaft
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.0065, 0.175, 0.018), chromeMat);
    beam.position.set(0.027, 0.125, 0);
    neckGroup.add(beam);

    // Raised beam flank ribs for realistic forged Cr-V wrench silhouette
    for (const zOff of [-0.0075, 0.0075]) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.0085, 0.155, 0.003), chromeMat);
      rib.position.set(0.027, 0.125, zOff);
      neckGroup.add(rib);
    }

    // Opposite open-end 16mm jaw tip
    const jawLeft = new THREE.Mesh(new THREE.BoxGeometry(0.0065, 0.024, 0.009), chromeMat);
    jawLeft.position.set(0.027, 0.222, -0.011);
    jawLeft.rotation.x = 0.28;
    neckGroup.add(jawLeft);

    const jawRight = new THREE.Mesh(new THREE.BoxGeometry(0.0065, 0.024, 0.009), chromeMat);
    jawRight.position.set(0.027, 0.222, 0.011);
    jawRight.rotation.x = -0.28;
    neckGroup.add(jawRight);

    return root;
  }

  private buildLockPinT10060A(): THREE.Group {
    const root = new THREE.Group();
    root.name = 'PinT10060A';
    root.add(this.pinBodyGroup);

    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x3b424d,
      metalness: 0.88,
      roughness: 0.28,
    });
    const anodizedRedMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      metalness: 0.72,
      roughness: 0.26,
    });
    const collarMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.9,
      roughness: 0.18,
    });

    // Hardened 4mm steel dowel pin (tip at X = 0)
    const pinTip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0022, 0.0032, 0.008, 14),
      steelMat
    );
    pinTip.rotation.z = Math.PI / 2;
    pinTip.position.x = 0.004;
    this.pinBodyGroup.add(pinTip);

    const pinShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0032, 0.0032, 0.056, 14),
      steelMat
    );
    pinShaft.rotation.z = Math.PI / 2;
    pinShaft.position.x = 0.036;
    this.pinBodyGroup.add(pinShaft);

    // Machined depth stop collar
    const stopCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0065, 0.0065, 0.008, 16),
      collarMat
    );
    stopCollar.rotation.z = Math.PI / 2;
    stopCollar.position.x = 0.068;
    this.pinBodyGroup.add(stopCollar);

    // Knurled red anodized T10060A thumb grip with knurl rings
    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.011, 0.042, 20),
      anodizedRedMat
    );
    grip.rotation.z = Math.PI / 2;
    grip.position.x = 0.093;
    this.pinBodyGroup.add(grip);

    for (const rx of [0.078, 0.088, 0.098, 0.108]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.0112, 0.0012, 6, 18),
        anodizedRedMat
      );
      ring.rotation.y = Math.PI / 2;
      ring.position.x = rx;
      this.pinBodyGroup.add(ring);
    }

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
    ctx.fillText('40 - 200 Nm', 62, 92);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
}
