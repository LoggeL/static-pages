import { Vector3 } from 'three';
import { PLAYER_CONFIG } from './config.js';
import { CapsuleCollision } from './collision.js';

export class PlayerPhysics {
  constructor(colliders, config = {}) {
    this.config = { ...PLAYER_CONFIG, ...config, speed: { ...PLAYER_CONFIG.speed, ...config.speed } };
    this.collision = new CapsuleCollision(colliders, this.config);
    this.position = new Vector3();
    this.velocity = new Vector3();
    this.height = this.config.height;
    this.grounded = false;
    this.crouched = false;
    this.stepsClimbed = 0;
    this.distance = 0;
  }

  teleport(position) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.height = this.config.height;
    this.crouched = false;
  }

  setCrouched(wanted) {
    if (!wanted && !this.crouched) return false;
    if (wanted) {
      this.height = this.config.crouchHeight;
      this.crouched = true;
    } else if (this.collision.clear(this.position, this.config.height)) {
      this.height = this.config.height;
      this.crouched = false;
    }
    return this.crouched;
  }

  /** Aufruf mit festem dt; intern vier Kapsel-/Tür-Kollisionsschritte. */
  update(dt, horizontalVelocity, beforeSubstep) {
    const substeps = Math.max(3, Math.min(5, Math.round(this.config.substeps)));
    const subdt = dt / substeps;
    for (let i = 0; i < substeps; i++) {
      beforeSubstep?.(subdt);
      this.move(subdt, horizontalVelocity);
    }
  }

  move(dt, horizontalVelocity) {
    const old = this.position.clone();
    const wasGrounded = this.grounded;
    this.velocity.x = horizontalVelocity.x;
    this.velocity.z = horizontalVelocity.z;
    this.velocity.y = wasGrounded && this.velocity.y <= 0 ? 0
      : Math.max(-this.config.terminalSpeed, this.velocity.y - this.config.gravity * dt);
    const delta = this.velocity.clone().multiplyScalar(dt);
    this.position.add(delta);
    let result = this.collision.resolve(this.position, this.height);
    const flatDelta = delta.clone().setY(0);
    const moveLength = flatDelta.length();
    this.grounded = result.grounded;
    if (!this.grounded && wasGrounded && this.velocity.y <= 0) {
      const support = this.stepSupport(this.position, flatDelta, 0.004);
      if (support && Math.abs(support.point.y - this.position.y) < 0.004) {
        this.position.y = support.point.y + this.config.skin;
        this.grounded = true;
      }
    }
    if (!this.grounded && wasGrounded && this.velocity.y <= 0) {
      const snap = this.collision.drop(this.position, this.height, this.config.groundSnap);
      if (snap.grounded) {
        this.grounded = true;
        result = snap.result;
      }
    }
    // Auch Ground-Snap kann an einer Kante seitlich zurückschieben. Erst den
    // endgültigen Weg beurteilen, sonst bleibt der Spieler am Bordstein hängen.
    if (wasGrounded && moveLength > 1e-7) {
      const moveDirection = flatDelta.clone().multiplyScalar(1 / moveLength);
      const progress = this.position.clone().sub(old).dot(moveDirection);
      if (progress < moveLength * 0.92) {
        const step = this.tryStep(old, flatDelta, moveDirection, progress);
        if (step) {
          this.position.copy(step.position);
          result = step.result;
          this.grounded = true;
          this.stepsClimbed++;
        }
      }
    }
    if (this.grounded && this.velocity.y < 0) this.velocity.y = 0;
    if (result.ceiling && this.velocity.y > 0) this.velocity.y = 0;
    const moved = this.position.clone().sub(old);
    this.distance += Math.hypot(moved.x, moved.z);
  }

  tryStep(old, delta, direction, originalProgress) {
    const support = this.stepSupport(old, delta);
    if (!support) return null;
    const rise = support.point.y - old.y;
    if (rise < 0.001 || rise > this.config.stepHeight) return null;
    const raised = old.clone();
    raised.y = support.point.y + this.config.skin;
    if (!this.collision.clear(raised, this.height)) return null;
    raised.add(delta);
    const result = this.collision.resolve(raised, this.height);
    const progress = raised.clone().sub(old).dot(direction);
    if (progress < originalProgress + delta.length() * 0.1) return null;
    if (raised.y - old.y > this.config.stepHeight + 0.002) return null;
    // Keine seitlichen Sprünge an Zargen/Kanten durch die Stufenhilfe.
    const side = raised.clone().sub(old).setY(0).addScaledVector(direction, -progress);
    if (side.length() > 0.012) return null;
    result.grounded = true;
    return { position: raised, result };
  }

  stepSupport(position, delta, maxRise = this.config.stepHeight) {
    if (delta.lengthSq() < 1e-12) return null;
    // Vordere Aufstandsprobe erlaubt kurze Tritte, die schmaler als der
    // Kapseldurchmesser sind. Der gesamte Körper muss darüber frei bleiben.
    const direction = delta.clone().normalize();
    let support = null;
    for (const fraction of [1, 0.66, 0.33, 0]) {
      const origin = position.clone().addScaledVector(direction, (this.config.radius + delta.length()) * fraction);
      origin.y += maxRise + this.config.skin * 2;
      const hit = this.collision.raycast(origin, DOWN, maxRise + this.config.groundSnap);
      if (hit && hit.normal.y >= this.config.groundNormalY && (!support || hit.point.y > support.point.y)) support = hit;
    }
    return support;
  }
}

const DOWN = new Vector3(0, -1, 0);
