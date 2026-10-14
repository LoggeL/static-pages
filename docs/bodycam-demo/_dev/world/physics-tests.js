import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { PlayerPhysics } from '../../js/player/physics.js';

function box(size, center) {
  return new THREE.BoxGeometry(...size).translate(...center);
}

function collider(geometries) {
  const geometry = mergeGeometries(geometries);
  geometry.boundsTree = new MeshBVH(geometry);
  geometries.forEach(part => part.dispose());
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function runPhysicsTests() {
  const results = [];
  const run = (name, task) => {
    try { results.push({ name, passed: true, ...task() }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  };
  const floor = () => box([30, 0.3, 30], [0, -0.15, 0]);
  const simulate = (physics, seconds, direction, hz = 60) => {
    const trace = [];
    for (let frame = 0; frame < seconds * hz; frame++) {
      physics.update(1 / hz, direction);
      if (frame % Math.round(hz / 10) === 0) trace.push(physics.position.toArray());
    }
    return trace;
  };
  const dispose = (...meshes) => meshes.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose(); });

  run('gravity-and-ground', () => {
    const mesh = collider([floor()]);
    const physics = new PlayerPhysics({ static: mesh, doors: [] });
    physics.teleport(new THREE.Vector3(0, 3, 0));
    simulate(physics, 2, new THREE.Vector3());
    assert(physics.grounded && Math.abs(physics.position.y) < 0.002, `Boden: ${physics.position.y}`);
    const final = physics.position.toArray();
    dispose(mesh);
    return { final };
  });

  for (const hz of [30, 60, 144]) run(`porch-three-19cm-steps-${hz}hz`, () => {
    const mesh = collider([floor(),
      box([1.5, 0.19, 0.207], [0, 0.095, 0.5175]),
      box([1.5, 0.38, 0.207], [0, 0.19, 0.3105]),
      box([1.5, 0.57, 0.207], [0, 0.285, 0.1035]),
      box([4, 0.57, 5], [0, 0.285, -2.5]),
    ]);
    const physics = new PlayerPhysics({ static: mesh, doors: [] });
    physics.teleport(new THREE.Vector3(0, 0.002, 2));
    const trace = simulate(physics, 3, new THREE.Vector3(0, 0, -1.5), hz);
    assert(physics.position.z < -1.5, `Treppe blockiert: ${physics.position.toArray()}`);
    assert(Math.abs(physics.position.y - 0.57) < 0.003, `Deckhöhe: ${physics.position.y}`);
    const final = physics.position.toArray();
    dispose(mesh);
    return { final, trace };
  });

  run('sprint-into-wall-corner', () => {
    const mesh = collider([floor(), box([0.12, 3, 10], [-0.06, 1.5, 0]), box([10, 3, 0.12], [0, 1.5, -0.06])]);
    const physics = new PlayerPhysics({ static: mesh, doors: [] });
    physics.teleport(new THREE.Vector3(1, 0.002, 1));
    simulate(physics, 4, new THREE.Vector3(-1, 0, -1).normalize().multiplyScalar(4.5));
    assert(physics.position.x >= 0.299 && physics.position.z >= 0.299,
      `Wandecke durchdrungen: ${physics.position.toArray()}`);
    assert(physics.position.y < 0.003, 'Wandecke hochgeklettert');
    const final = physics.position.toArray();
    dispose(mesh);
    return { final };
  });

  for (const degrees of [1, 5, 15]) run(`idle-on-${degrees}deg-slope`, () => {
    const slope = box([20, 0.2, 20], [0, -0.1, 0]).rotateZ(THREE.MathUtils.degToRad(degrees));
    const mesh = collider([slope]);
    const physics = new PlayerPhysics({ static: mesh, doors: [] });
    physics.teleport(new THREE.Vector3(0, 0.3, 0));
    simulate(physics, 1, new THREE.Vector3());
    const settled = physics.position.clone();
    simulate(physics, 10, new THREE.Vector3());
    const drift = physics.position.distanceTo(settled);
    assert(drift < 0.002, `Bewegung ohne Eingabe: ${drift} m`);
    assert(physics.grounded, 'Bodenkontakt verloren');
    dispose(mesh);
    return { drift };
  });

  run('door-frame-clearance', () => {
    const mesh = collider([floor(), box([4, 3, 0.2], [-2.453, 1.5, 0]),
      box([4, 3, 0.2], [2.453, 1.5, 0]), box([0.906, 0.95, 0.2], [0, 2.525, 0])]);
    const physics = new PlayerPhysics({ static: mesh, doors: [] });
    physics.teleport(new THREE.Vector3(0, 0.002, 1.5));
    simulate(physics, 2, new THREE.Vector3(0, 0, -1.5));
    assert(physics.position.z < -1, `Zarge blockiert: ${physics.position.toArray()}`);
    const final = physics.position.toArray();
    dispose(mesh);
    return { final };
  });

  run('rotated-local-door-collision', () => {
    const mesh = collider([floor()]);
    const door = collider([box([0.9, 2.05, 0.045], [0.45, 1.025, 0])]);
    const pivot = new THREE.Group();
    pivot.position.set(1.5, 0, -1);
    pivot.rotation.y = Math.PI / 2;
    pivot.add(door);
    pivot.updateMatrixWorld(true);
    const physics = new PlayerPhysics({ static: mesh, doors: [door] });
    physics.teleport(new THREE.Vector3(3, 0.002, -1.45));
    simulate(physics, 2, new THREE.Vector3(-1.5, 0, 0));
    assert(physics.position.x >= 1.82, `Lokale Tür durchdrungen: ${physics.position.toArray()}`);
    const closed = physics.position.toArray();
    pivot.rotation.y = 0;
    pivot.updateMatrixWorld(true);
    simulate(physics, 1.5, new THREE.Vector3(-1.5, 0, 0));
    assert(physics.position.x < 0.3, 'Collider folgt Tür nicht');
    const open = physics.position.toArray();
    dispose(mesh, door);
    return { closed, open };
  });

  run('crouch-under-ceiling-and-stand-check', () => {
    const mesh = collider([floor(), box([3, 0.2, 3], [0, 1.45, -2])]);
    const physics = new PlayerPhysics({ static: mesh, doors: [] });
    physics.teleport(new THREE.Vector3(0, 0.002, 0));
    physics.setCrouched(true);
    simulate(physics, 2, new THREE.Vector3(0, 0, -0.85));
    physics.setCrouched(false);
    assert(physics.crouched, 'Aufstehen durch niedrige Decke möglich');
    assert(physics.position.z < -1.5, 'Ducken erlaubt keinen Durchgang');
    simulate(physics, 2, new THREE.Vector3(0, 0, 0.85));
    physics.setCrouched(false);
    assert(!physics.crouched, 'Aufstehen im Freien blockiert');
    const final = physics.position.toArray();
    dispose(mesh);
    return { final };
  });

  return { passed: results.every(test => test.passed), tests: results };
}
