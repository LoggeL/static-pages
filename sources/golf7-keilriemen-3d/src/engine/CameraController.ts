import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CameraPresetId } from '../types';

interface CameraPose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
}

interface ActiveTransition {
  startPos: THREE.Vector3;
  startTarget: THREE.Vector3;
  endPos: THREE.Vector3;
  endTarget: THREE.Vector3;
  elapsed: number;
  duration: number;
}

const TITLE_CENTER = new THREE.Vector3(0, 0.7, -0.3);
const TRANSITION_DURATION = 0.65;

export class CameraController {
  public readonly controls: OrbitControls;

  private readonly camera: THREE.PerspectiveCamera;
  private activePreset: CameraPresetId = 'overview';
  private transition: ActiveTransition | null = null;
  private titleOrbitActive = false;
  private titleAngle = 0.72;
  private titleRadius = 4.15;

  private readonly onControlStart = (): void => {
    // Immediate user drag cancels preset tween so camera stays responsive
    this.transition = null;
  };

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;

    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.492;
    this.controls.minDistance = 0.28;
    this.controls.maxDistance = 7.5;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;

    const initialPose = this.getPresetPose('overview', 0);
    this.camera.position.copy(initialPose.pos);
    this.controls.target.copy(initialPose.target);
    this.controls.update();

    this.controls.addEventListener('start', this.onControlStart);
  }

  public getPresetPose(preset: CameraPresetId, liftY: number): CameraPose {
    switch (preset) {
      case 'overview':
        return {
          pos: new THREE.Vector3(3.25, 1.8 + liftY * 0.4, -2.95),
          target: new THREE.Vector3(0.2, 0.75 + liftY * 0.72, -0.55),
        };
      case 'engineTop':
        return {
          pos: new THREE.Vector3(1.05, 1.65 + liftY, -2.05),
          target: new THREE.Vector3(0.05, 0.65 + liftY, -1.35),
        };
      case 'wheelWell':
        return {
          pos: new THREE.Vector3(1.92, 0.58 + liftY, -1.42),
          target: new THREE.Vector3(0.58, 0.44 + liftY, -1.32),
        };
      case 'beltClose':
        return {
          pos: new THREE.Vector3(1.10, 0.48 + liftY, -1.78),
          target: new THREE.Vector3(0.44, 0.44 + liftY, -1.35),
        };
      case 'tensionerMacro':
        return {
          pos: new THREE.Vector3(0.94, 0.56 + liftY, -1.66),
          target: new THREE.Vector3(0.44, 0.52 + liftY, -1.36),
        };
    }
  }

  public setPreset(preset: CameraPresetId, liftY: number, immediate = false): void {
    this.activePreset = preset;
    this.titleOrbitActive = false;

    const pose = this.getPresetPose(preset, liftY);
    if (immediate) {
      this.transition = null;
      this.camera.position.copy(pose.pos);
      this.controls.target.copy(pose.target);
      this.controls.update();
      return;
    }

    this.transition = {
      startPos: this.camera.position.clone(),
      startTarget: this.controls.target.clone(),
      endPos: pose.pos,
      endTarget: pose.target,
      elapsed: 0,
      duration: TRANSITION_DURATION,
    };
  }

  public adjustForLiftChange(oldLiftY: number, newLiftY: number): void {
    const deltaY = newLiftY - oldLiftY;
    if (Math.abs(deltaY) < 1e-6) return;

    if (this.transition) {
      const updated = this.getPresetPose(this.activePreset, newLiftY);
      this.transition.endPos.copy(updated.pos);
      this.transition.endTarget.copy(updated.target);
      return;
    }

    const carCenter = new THREE.Vector3(0.2, 0.7 + oldLiftY, -0.75);
    const distToCar = this.controls.target.distanceTo(carCenter);

    if (distToCar < 3.4) {
      const camDist = this.camera.position.distanceTo(this.controls.target);
      if (camDist < 2.9) {
        this.camera.position.y = Math.max(0.2, this.camera.position.y + deltaY);
        this.controls.target.y += deltaY;
      } else {
        this.camera.position.y = Math.max(0.2, this.camera.position.y + deltaY * 0.4);
        this.controls.target.y += deltaY * 0.72;
      }
      this.controls.update();
    }
  }

  public setTitleOrbit(active: boolean): void {
    this.titleOrbitActive = active;
    if (active) {
      this.transition = null;
      const dx = this.camera.position.x - TITLE_CENTER.x;
      const dz = this.camera.position.z - TITLE_CENTER.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.5) {
        this.titleAngle = Math.atan2(dx, dz);
        this.titleRadius = THREE.MathUtils.clamp(dist, 3.6, 4.4);
      } else {
        this.titleAngle = 2.35;
        this.titleRadius = 4.15;
      }
    }
  }

  public update(dt: number): void {
    const safeDt = Math.min(Math.max(dt, 0), 0.1);

    if (this.titleOrbitActive) {
      this.titleAngle += safeDt * 0.15;
      this.titleRadius = THREE.MathUtils.lerp(this.titleRadius, 4.1, Math.min(1, safeDt * 2.0));
      const targetY = 1.56 + Math.sin(this.titleAngle * 0.6) * 0.14;

      const desiredX = TITLE_CENTER.x + Math.sin(this.titleAngle) * this.titleRadius;
      const desiredZ = TITLE_CENTER.z + Math.cos(this.titleAngle) * this.titleRadius;

      this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, desiredX, Math.min(1, safeDt * 4.5));
      this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, targetY, Math.min(1, safeDt * 4.5));
      this.camera.position.z = THREE.MathUtils.lerp(this.camera.position.z, desiredZ, Math.min(1, safeDt * 4.5));

      this.controls.target.lerp(TITLE_CENTER, Math.min(1, safeDt * 5.0));
      this.controls.update();
      return;
    }

    if (this.transition) {
      this.transition.elapsed += safeDt;
      const rawT = Math.min(this.transition.elapsed / this.transition.duration, 1);
      const eased = 1 - Math.pow(1 - rawT, 3); // Cubic ease-out

      this.camera.position.lerpVectors(this.transition.startPos, this.transition.endPos, eased);
      this.controls.target.lerpVectors(this.transition.startTarget, this.transition.endTarget, eased);

      if (rawT >= 1) {
        this.camera.position.copy(this.transition.endPos);
        this.controls.target.copy(this.transition.endTarget);
        this.transition = null;
      }
    }

    this.controls.update();
  }

  public dispose(): void {
    this.controls.removeEventListener('start', this.onControlStart);
    this.controls.dispose();
  }
}
