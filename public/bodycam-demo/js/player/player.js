import { Euler, MathUtils, Quaternion, Vector3 } from 'three';
import { PLAYER_CONFIG } from './config.js';
import { PlayerPhysics } from './physics.js';
import { createBob } from './bob.js';

export { PLAYER_CONFIG } from './config.js';

export function createPlayer(options) {
  return new Player(options);
}

export class Player {
  constructor({ camera, input, world, config = {}, bob = {}, onStep = () => {}, onRoomChange = () => {} }) {
    this.config = { ...PLAYER_CONFIG, ...config, speed: { ...PLAYER_CONFIG.speed, ...config.speed } };
    this.camera = camera;
    this.input = input;
    this.world = world;
    this.physics = new PlayerPhysics(world.colliders, this.config);
    this.position = this.physics.position;
    this.velocity = new Vector3();
    this.wishVelocity = new Vector3();
    this.angularVelocity = new Vector3();
    this.bob = createBob(bob);
    this.onStep = onStep;
    this.onRoomChange = onRoomChange;
    this.yaw = 0;
    this.pitch = -MathUtils.degToRad(this.config.cameraPitchDown);
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.lean = 0;
    this.leanSuppressed = false;
    this.accumulator = 0;
    this.simulatedTime = 0;
    this.droppedTime = 0;
    this.stepCount = 0;
    this.room = null;
    this.cameraY = 0;
    this.speed = 0;
    this.state = {};
    this.previousQuaternion = new Quaternion();
    this.camera.fov = this.config.cameraFov;
    this.camera.rotation.order = 'YXZ';
    this.camera.updateProjectionMatrix();
    this.unsubscribe = [
      input.on('interact', () => this.interact()),
      input.on('keyup', event => { if (event.code === 'KeyE') this.leanSuppressed = false; }),
    ];
    this.doorGuards = world.doors.map(door => {
      const previous = door.canMove;
      const guard = () => (!previous || previous()) && this.physics.collision.clear(this.position, this.physics.height);
      door.canMove = guard;
      door.pusher = () => ({ position: this.position, velocity: this.wishVelocity, radius: this.config.radius });
      return { door, previous, guard };
    });
    const spawn = world.spawn;
    this.teleport(spawn.position.x, spawn.position.y, spawn.position.z, spawn.yawDeg, spawn.pitchDeg ?? -this.config.cameraPitchDown);
  }

  get grounded() { return this.physics.grounded; }
  get crouched() { return this.physics.crouched; }

  look(yawDeg, pitchDeg = -this.config.cameraPitchDown) {
    if (![yawDeg, pitchDeg].every(Number.isFinite)) throw new TypeError('Blickwinkel müssen endliche Zahlen sein.');
    this.yaw = this.targetYaw = MathUtils.degToRad(yawDeg);
    this.pitch = this.targetPitch = MathUtils.degToRad(MathUtils.clamp(pitchDeg, -this.config.maxPitch, this.config.maxPitch));
    this.updateCamera(0, { pitch: 0, yaw: 0, roll: 0, y: 0 });
    this.previousQuaternion.copy(this.camera.quaternion);
  }

  teleport(x, y, z, yawDeg = MathUtils.radToDeg(this.yaw), pitchDeg = -this.config.cameraPitchDown) {
    if (![x, y, z, yawDeg, pitchDeg].every(Number.isFinite)) throw new TypeError('Teleport benötigt endliche Zahlen.');
    this.physics.teleport(new Vector3(x, y, z));
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.accumulator = 0;
    this.lean = 0;
    this.leanSuppressed = false;
    this.speed = 0;
    this.bob.reset();
    this.cameraY = y + this.config.cameraHeight;
    this.look(yawDeg, pitchDeg);
    this.updateRoom();
  }

  doorInView() {
    const hit = this.physics.collision.raycast(this.camera.position,
      this.camera.getWorldDirection(new Vector3()), this.config.interactionDistance);
    return hit ? this.world.doors.find(door => door.collider === hit.object) || null : null;
  }

  interact() {
    const door = this.doorInView();
    if (!door) return false;
    this.leanSuppressed = true;
    door.toggle();
    this.input.emit('door', { door, opening: door.targetAngle > 0 });
    return true;
  }

  update(elapsed) {
    if (!Number.isFinite(elapsed) || elapsed <= 0) return;
    const dt = Math.min(elapsed, this.config.maxFrameTime);
    this.droppedTime += elapsed - dt;
    const mouse = this.input.consumeLook();
    this.targetYaw -= mouse.x * this.config.mouseSensitivity;
    this.targetPitch = MathUtils.clamp(this.targetPitch - mouse.y * this.config.mouseSensitivity,
      -MathUtils.degToRad(this.config.maxPitch), MathUtils.degToRad(this.config.maxPitch));
    const follow = 1 - Math.exp(-dt / this.config.mouseTau);
    this.yaw += (this.targetYaw - this.yaw) * follow;
    this.pitch += (this.targetPitch - this.pitch) * follow;

    const held = code => this.input.active && this.input.isDown(code);
    const crouch = held('KeyC') || held('ControlLeft') || held('ControlRight');
    this.physics.setCrouched(crouch);
    const sneak = held('AltLeft') || held('AltRight');
    const sprint = !this.crouched && !sneak && (held('ShiftLeft') || held('ShiftRight'));
    const speed = this.crouched ? this.config.speed.crouch
      : sneak ? this.config.speed.sneak : sprint ? this.config.speed.sprint : this.config.speed.walk;
    const axes = this.input.active && this.input.getMoveAxes?.();
    const forward = axes?.forward ?? Number(held('KeyW')) - Number(held('KeyS'));
    const right = axes?.right ?? Number(held('KeyD')) - Number(held('KeyA'));
    const movement = new Vector3(right, 0, -forward);
    if (movement.lengthSq() > 1) movement.normalize();
    movement.multiplyScalar(speed).applyAxisAngle(UP, this.yaw);
    this.wishVelocity.copy(movement);
    const previousPosition = this.position.clone();
    this.accumulator += dt;
    let ticks = 0;
    while (this.accumulator + 1e-10 >= this.config.fixedTimeStep) {
      this.physics.update(this.config.fixedTimeStep, movement, subdt => this.world.update?.(subdt));
      this.accumulator -= this.config.fixedTimeStep;
      this.simulatedTime += this.config.fixedTimeStep;
      ticks++;
    }
    if (ticks) {
      this.velocity.subVectors(this.position, previousPosition).divideScalar(ticks * this.config.fixedTimeStep);
      this.speed = Math.hypot(this.velocity.x, this.velocity.z);
    }
    const bob = this.bob.update(dt, { speed: Math.min(this.speed, speed), grounded: this.grounded,
      crouched: this.crouched, sprinting: sprint, ads: this.input.isDown('Mouse2') });
    for (let i = 0; i < bob.steps; i++) {
      const event = { surface: this.world.surfaceAt(this.position), speed: this.speed,
        position: this.position.clone(), room: this.room?.id || 'OUT' };
      this.stepCount++;
      this.onStep(event);
      this.input.emit('step', event);
    }
    const leanTarget = Number(held('KeyE') && !this.leanSuppressed) - Number(held('KeyQ'));
    this.lean += (leanTarget - this.lean) * (1 - Math.exp(-dt / this.config.leanTau));
    this.updateCamera(dt, bob);
    const rotation = this.previousQuaternion.clone().invert().multiply(this.camera.quaternion);
    if (rotation.w < 0) rotation.set(-rotation.x, -rotation.y, -rotation.z, -rotation.w);
    const angle = 2 * Math.acos(MathUtils.clamp(rotation.w, -1, 1));
    this.angularVelocity.set(rotation.x, rotation.y, rotation.z);
    if (angle > 1e-8) this.angularVelocity.normalize().multiplyScalar(angle / dt);
    else this.angularVelocity.set(0, 0, 0);
    this.previousQuaternion.copy(this.camera.quaternion);
    this.updateRoom();
    this.state = { moving: this.speed > 0.05, grounded: this.grounded, crouched: this.crouched,
      sprinting: sprint, sneaking: sneak, speed: this.speed, lean: this.lean, room: this.room,
      linearVelocity: this.velocity, angularVelocity: this.angularVelocity };
    if (this.position.y < this.config.resetBelowY) {
      const spawn = this.world.spawn;
      this.teleport(...spawn.position.toArray(), spawn.yawDeg, spawn.pitchDeg);
      this.input.emit('respawn', { reason: 'below-world' });
    }
  }

  updateCamera(dt, bob) {
    const height = this.crouched ? this.config.crouchCameraHeight : this.config.cameraHeight;
    const targetY = this.position.y + height;
    if (dt > 0) this.cameraY += (targetY - this.cameraY) * (1 - Math.exp(-dt / this.config.cameraHeightTau));
    const forward = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const center = new Vector3(this.position.x, this.cameraY, this.position.z);
    const desired = center.clone().addScaledVector(forward, this.config.cameraForward)
      .addScaledVector(right, this.lean * this.config.leanDistance);
    desired.y += bob.y;
    const direction = desired.clone().sub(center);
    const distance = direction.length();
    if (distance > 0.0001) {
      direction.multiplyScalar(1 / distance);
      const obstruction = this.physics.collision.raycast(center, direction, distance + this.config.cameraRadius);
      if (obstruction) desired.copy(center).addScaledVector(direction,
        Math.max(0, Math.min(distance, obstruction.distance - this.config.cameraRadius)));
    }
    // Kamerakugel hält auch beim Ducken/Lehnen Abstand von Wand und Decke.
    desired.y -= this.config.cameraRadius;
    this.physics.collision.resolve(desired, this.config.cameraRadius * 2, this.config.cameraRadius, 2);
    desired.y += this.config.cameraRadius;
    this.camera.position.copy(desired);
    this.camera.rotation.copy(new Euler(this.pitch + bob.pitch, this.yaw + bob.yaw,
      bob.roll - this.lean * MathUtils.degToRad(this.config.leanRoll), 'YXZ'));
    this.camera.updateMatrixWorld();
  }

  updateRoom() {
    const point = this.position.clone().addScaledVector(UP, 0.08);
    const room = this.world.roomAt?.(point) || this.world.rooms.find(candidate => candidate.contains?.(point)) || null;
    if (room?.id === this.room?.id) return;
    const previous = this.room;
    this.room = room;
    this.onRoomChange(room);
    this.input.emit('roomchange', { room, previous });
  }

  stats() {
    return { position: this.position.toArray(), yawDeg: MathUtils.radToDeg(this.yaw),
      pitchDeg: MathUtils.radToDeg(this.pitch), cameraPosition: this.camera.position.toArray(),
      speed: this.speed, grounded: this.grounded, crouched: this.crouched, capsuleHeight: this.physics.height,
      room: this.room?.id || 'OUT', surface: this.world.surfaceAt(this.position),
      steps: this.stepCount, stepsClimbed: this.physics.stepsClimbed,
      simulatedTime: this.simulatedTime, droppedTime: this.droppedTime,
      collisionQueries: this.physics.collision.queryCount, triangleTests: this.physics.collision.triangleTests,
      interaction: this.doorInView()?.id || null };
  }

  dispose() {
    this.unsubscribe.forEach(unsubscribe => unsubscribe());
    for (const { door, previous, guard } of this.doorGuards) {
      if (door.canMove === guard) door.canMove = previous;
      door.pusher = null;
    }
  }
}

const UP = new Vector3(0, 1, 0);
