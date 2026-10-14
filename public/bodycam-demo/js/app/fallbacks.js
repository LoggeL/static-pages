import * as THREE from 'three';
import { APP_CONFIG } from './config.js';
import { createEventBus } from './events.js';

export function createFallbackWorld(scene) {
  const config = APP_CONFIG.fallback;
  const root = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(config.groundSize, config.groundSize),
    new THREE.MeshStandardMaterial({ color: config.color, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.userData.surface = 'concrete';
  const light = new THREE.HemisphereLight(0xffffff, config.color, config.light);
  root.add(ground, light); scene.add(root);
  scene.background = new THREE.Color(config.color);
  const room = { id: 'OUT', reverb: {} };
  return { fallback: true, root, shootables: [ground], doors: [], rooms: [room], missingProps: [],
    spawn: { position: new THREE.Vector3(0, 0, 4), yawDeg: 0, pitchDeg: -4 },
    roomAt: () => room, surfaceAt: () => 'concrete', update() {},
    dispose() { root.removeFromParent(); ground.geometry.dispose(); ground.material.dispose(); },
  };
}

// A stationary observer makes missing world/player modules explicit without fake collision.
export function createFallbackPlayer(camera, world) {
  const position = world.spawn.position.clone();
  const velocity = new THREE.Vector3(), angularVelocity = new THREE.Vector3();
  let yawDeg = world.spawn.yawDeg, pitchDeg = world.spawn.pitchDeg;
  function look(yaw = yawDeg, pitch = pitchDeg) {
    if (![yaw, pitch].every(Number.isFinite)) throw new TypeError('Finite angles required');
    yawDeg = yaw; pitchDeg = THREE.MathUtils.clamp(pitch, -85, 85);
    camera.rotation.set(THREE.MathUtils.degToRad(pitchDeg), THREE.MathUtils.degToRad(yawDeg), 0, 'YXZ');
    camera.position.copy(position); camera.position.y += APP_CONFIG.fallback.cameraHeight;
    camera.updateMatrixWorld(true);
  }
  look();
  return { fallback: true, position, velocity, angularVelocity, room: world.roomAt(position), state: {},
    update() { look(); }, look,
    teleport(x, y, z, yaw, pitch) {
      if (![x, y, z].every(Number.isFinite)) throw new TypeError('Finite position required');
      position.set(x, y, z); look(yaw, pitch);
    },
    stats: () => ({ position: position.toArray(), cameraPosition: camera.position.toArray(), yawDeg, pitchDeg, room: 'OUT', fallback: true }),
    dispose() {},
  };
}

export function createFallbackInput() {
  return { ...createEventBus(), active: false, locked: false, isDown: () => false,
    consumeLook: () => ({ x: 0, y: 0 }), requestLock: async () => false, exitLock() {}, dispose() {} };
}
