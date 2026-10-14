import { Vector3 } from 'three';
import { CapsuleCollision } from '../player/collision.js';
import { PLAYER_CONFIG } from '../player/config.js';

export const NAVIGATION_CONFIG = {
  nearestMaxDistance: 2,
  probeSpacing: 0.035,
  doorPadding: 0.025,
  doorInteractionDistance: 1.2,
  doorImpulse: 120,
  closedDoorCost: 1,
};

const radians = degrees => degrees * Math.PI / 180;

function segmentDistanceSquared(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const fraction = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
  return (x - ax - fraction * dx) ** 2 + (z - az - fraction * dz) ** 2;
}

// A binary heap keeps A* allocations and search costs bounded for the baked grid.
class Heap {
  constructor() { this.items = []; }
  push(node, priority) {
    const item = { node, priority }, items = this.items;
    let index = items.length;
    items.push(item);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent].priority <= priority) break;
      items[index] = items[parent];
      index = parent;
    }
    items[index] = item;
  }
  pop() {
    const items = this.items, first = items[0], last = items.pop();
    if (!items.length) return first;
    let index = 0;
    while (index * 2 + 1 < items.length) {
      let child = index * 2 + 1;
      if (child + 1 < items.length && items[child + 1].priority < items[child].priority) child++;
      if (items[child].priority >= last.priority) break;
      items[index] = items[child];
      index = child;
    }
    items[index] = last;
    return first;
  }
  get length() { return this.items.length; }
}

/** Feet positions are Three.js Y-up. Geometry, edge clearance and support come from nav.json. */
export function createNavigation({ world, data, config: overrides = {} }) {
  if (data?.version !== 1 || !data.grid || !Array.isArray(data.nodes) || !data.agent) {
    throw new Error('Unsupported NPC navigation data; run tools/nav/bake.py');
  }
  const config = { ...NAVIGATION_CONFIG, ...data.agent, ...overrides };
  if (config.radius > data.agent.radius + 1e-6 || config.height > data.agent.height + 1e-6) {
    throw new Error('NPC dimensions exceed the navigation bake; rebake for the larger capsule');
  }
  const grid = data.grid, nodes = data.nodes, count = nodes.length;
  const positions = nodes.map(node => new Vector3(
    grid.origin[0] + node[0] * grid.cellSize, node[2], grid.origin[1] + node[1] * grid.cellSize,
  ));
  const lookup = new Int32Array(grid.width * grid.depth).fill(-1);
  nodes.forEach((node, i) => { lookup[node[1] * grid.width + node[0]] = i; });
  const roomIndices = new Map(data.rooms.map((room, i) => [room.id, i]));
  const doorDefinitions = new Map((data.doors ?? []).map(door => [door.id, door]));
  const doors = (world?.doors ?? []).filter(door => doorDefinitions.has(door.id));
  const colliders = world?.colliders ?? { static: null, doors: [] };
  const collisionConfig = { ...PLAYER_CONFIG, radius: config.radius, height: config.height,
    skin: config.skin, stepHeight: config.maxStep };
  const collision = new CapsuleCollision(colliders, collisionConfig);
  const staticCollision = new CapsuleCollision({ static: colliders.static, doors: [] }, collisionConfig);
  const probe = new Vector3();

  function nodeAt(ix, iz) {
    return ix < 0 || iz < 0 || ix >= grid.width || iz >= grid.depth ? -1 : lookup[iz * grid.width + ix];
  }

  function staticVisible(start, end) {
    if (Math.abs(start.y - end.y) > config.maxStep + .006) return false;
    const test = new Vector3();
    const samples = Math.max(1, Math.ceil(Math.hypot(start.x - end.x, start.z - end.z) / config.probeSpacing));
    for (let i = 0; i <= samples; i++) {
      test.copy(start).lerp(end, i / samples);
      if (Math.abs(start.y - end.y) > .002 && i > 0 && i < samples) test.y = Math.max(start.y, end.y);
      if (!staticCollision.clear(test, config.height, config.radius, .002)) return false;
    }
    return true;
  }

  function nearestIndex(point, { roomId, maxDistance = config.nearestMaxDistance, blocked = null,
    visibleFrom = null, preferMain = true } = {}) {
    if (![point?.x, point?.y, point?.z].every(Number.isFinite)) return -1;
    const wanted = roomId === undefined ? undefined : roomIndices.get(roomId);
    if (roomId !== undefined && wanted === undefined) return -1;
    let nearest = -1, distance = maxDistance * maxDistance + 1e-12, nearestIsMain = false;
    const ix = Math.round((point.x - grid.origin[0]) / grid.cellSize);
    const iz = Math.round((point.z - grid.origin[1]) / grid.cellSize);
    const reach = Math.ceil(maxDistance / grid.cellSize);
    for (let z = Math.max(0, iz - reach); z <= Math.min(grid.depth - 1, iz + reach); z++) {
      for (let x = Math.max(0, ix - reach); x <= Math.min(grid.width - 1, ix + reach); x++) {
        const index = nodeAt(x, z);
        if (index < 0 || blocked?.[index] || (wanted !== undefined && nodes[index][3] !== wanted)) continue;
        const squared = positions[index].distanceToSquared(point);
        const main = nodes[index][5] === grid.mainComponent;
        if (squared > maxDistance * maxDistance + 1e-12 || (preferMain && nearestIsMain && !main)) continue;
        if ((preferMain && main && !nearestIsMain) || squared < distance) {
          if (visibleFrom && !staticVisible(visibleFrom, positions[index])) continue;
          nearest = index; distance = squared; nearestIsMain = main;
        }
      }
    }
    return nearest;
  }

  function nearest(point, options) {
    const index = nearestIndex(point, options);
    return index < 0 ? null : positions[index].clone();
  }

  function roomGoal(roomId, start) {
    const room = data.rooms.find(entry => entry.id === roomId);
    if (!room?.goal) return null;
    if (!start || nearestIndex(start) >= 0) return new Vector3().fromArray(room.goal);
    return null;
  }

  function leaf(door, angle = door.angle) {
    const definition = doorDefinitions.get(door.id);
    const heading = radians(door.leafHeading() + (angle - door.angle) * door.openDir);
    const hinge = door.hinge;
    return {
      door, definition, ax: hinge.x, az: hinge.z,
      bx: hinge.x + Math.cos(heading) * door.width,
      bz: hinge.z - Math.sin(heading) * door.width,
      bottom: hinge.y, top: hinge.y + (definition.height ?? 2.05),
    };
  }

  function touchesLeaf(point, shape) {
    return point.y < shape.top && point.y + config.height > shape.bottom
      && segmentDistanceSquared(point.x, point.z, shape.ax, shape.az, shape.bx, shape.bz)
        <= (config.radius + config.doorPadding) ** 2;
  }

  function doorGate(one, two, definition) {
    const center = definition.position;
    const alongX = definition.axis === 'x';
    const aNormal = (alongX ? one.z - center[2] : one.x - center[0]);
    const bNormal = (alongX ? two.z - center[2] : two.x - center[0]);
    if (Math.min(Math.abs(aNormal), Math.abs(bNormal)) > config.radius + grid.cellSize + .12
      && aNormal * bNormal >= 0) return false;
    const alongA = alongX ? one.x - center[0] : one.z - center[2];
    const alongB = alongX ? two.x - center[0] : two.z - center[2];
    return Math.min(Math.abs(alongA), Math.abs(alongB)) <= definition.width / 2 + config.radius;
  }

  function plan(start, goal, { allowDoorPush = true, maxDistance = config.nearestMaxDistance } = {}) {
    const blocked = new Uint8Array(count);
    // A push-capable route reserves room for the leaf at its open stop. It never walks through that leaf.
    const leaves = doors.map(door => leaf(door, allowDoorPush ? door.maxAngle : door.angle));
    for (const shape of leaves) {
      const radius = config.radius + config.doorPadding;
      const lowX = Math.floor((Math.min(shape.ax, shape.bx) - radius - grid.origin[0]) / grid.cellSize);
      const highX = Math.ceil((Math.max(shape.ax, shape.bx) + radius - grid.origin[0]) / grid.cellSize);
      const lowZ = Math.floor((Math.min(shape.az, shape.bz) - radius - grid.origin[1]) / grid.cellSize);
      const highZ = Math.ceil((Math.max(shape.az, shape.bz) + radius - grid.origin[1]) / grid.cellSize);
      for (let iz = Math.max(0, lowZ); iz <= Math.min(grid.depth - 1, highZ); iz++) {
        for (let ix = Math.max(0, lowX); ix <= Math.min(grid.width - 1, highX); ix++) {
          const index = nodeAt(ix, iz);
          if (index >= 0 && touchesLeaf(positions[index], shape)) blocked[index] = 1;
        }
      }
    }
    const startRoom = world?.roomAt?.(start)?.id, goalRoom = world?.roomAt?.(goal)?.id;
    const source = nearestIndex(start, { maxDistance, blocked, visibleFrom: start, roomId: startRoom });
    const destination = nearestIndex(goal, { maxDistance, blocked, visibleFrom: goal, roomId: goalRoom });
    const failed = reason => ({ status: 'unreachable', reason, points: [], nodes: [], doors: [], distance: 0,
      projectedStart: source < 0 ? null : positions[source].clone(),
      projectedGoal: destination < 0 ? null : positions[destination].clone() });
    if (source < 0) return failed('start-off-grid');
    if (destination < 0) return failed('goal-off-grid');
    const costs = new Float64Array(count).fill(Infinity), parent = new Int32Array(count).fill(-1);
    const visited = new Uint8Array(count), heap = new Heap();
    const target = positions[destination];
    costs[source] = 0;
    heap.push(source, positions[source].distanceTo(target));
    const closed = doors.filter(door => !door.isOpen);
    while (heap.length) {
      const current = heap.pop().node;
      if (visited[current]) continue;
      if (current === destination) break;
      visited[current] = 1;
      const node = nodes[current], one = positions[current];
      for (let direction = 0; direction < grid.directions.length; direction++) {
        if (!(node[4] & (1 << direction))) continue;
        const [dx, dz] = grid.directions[direction];
        const other = nodeAt(node[0] + dx, node[1] + dz);
        if (other < 0 || blocked[other] || visited[other]) continue;
        if (direction >= 4 && (blocked[nodeAt(node[0] + dx, node[1])] || blocked[nodeAt(node[0], node[1] + dz)])) continue;
        const two = positions[other];
        // Test the edge midpoint as well as nodes so diagonals cannot cut a moving leaf's corner.
        probe.copy(one).add(two).multiplyScalar(.5);
        if (leaves.some(shape => touchesLeaf(probe, shape))) continue;
        let extra = 0, impassable = false;
        for (const door of closed) {
          if (!doorGate(one, two, doorDefinitions.get(door.id))) continue;
          if (!allowDoorPush) { impassable = true; break; }
          extra += config.closedDoorCost * grid.cellSize;
        }
        if (impassable) continue;
        const cost = costs[current] + one.distanceTo(two) + extra;
        if (cost >= costs[other]) continue;
        costs[other] = cost;
        parent[other] = current;
        heap.push(other, cost + two.distanceTo(target));
      }
    }
    if (source !== destination && parent[destination] < 0) return failed('no-connected-route');
    const route = [destination];
    while (route.at(-1) !== source) route.push(parent[route.at(-1)]);
    route.reverse();
    const requiredDoors = new Set();
    let distance = 0;
    for (let i = 1; i < route.length; i++) {
      const one = positions[route[i - 1]], two = positions[route[i]];
      distance += one.distanceTo(two);
      for (const door of doors) if (doorGate(one, two, doorDefinitions.get(door.id))) requiredDoors.add(door.id);
    }
    // Keep grid anchors around steps and doors. The follower never needs unsafe line-of-sight smoothing.
    return { status: 'ok', points: route.map(i => positions[i].clone()), nodes: route, doors: [...requiredDoors],
      distance, projectedStart: positions[source].clone(), projectedGoal: positions[destination].clone() };
  }

  function canMove(start, end, { allowDoorPush = false } = {}) {
    if (![start?.x, start?.y, start?.z, end?.x, end?.y, end?.z].every(Number.isFinite)) return false;
    if (Math.abs(start.y - end.y) > config.maxStep + .006) return false;
    const flatDistance = Math.hypot(end.x - start.x, end.z - start.z);
    const count = Math.max(1, Math.ceil(flatDistance / config.probeSpacing));
    const checker = allowDoorPush ? staticCollision : collision;
    const raised = Math.max(start.y, end.y);
    for (let i = 0; i <= count; i++) {
      probe.copy(start).lerp(end, i / count);
      // The existing player physics raises the capsule before crossing a stair riser.
      if (Math.abs(start.y - end.y) > .002 && i > 0 && i < count) probe.y = raised;
      if (!checker.clear(probe, config.height, config.radius, .002)) return false;
      const near = nearestIndex(probe, { maxDistance: grid.cellSize * 1.45 });
      if (near < 0) return false;
    }
    return true;
  }

  function doorAhead(position, target, maxDistance = config.doorInteractionDistance) {
    const distance = position.distanceTo(target), count = Math.max(1, Math.ceil(Math.min(distance, maxDistance) / config.probeSpacing));
    const reach = Math.min(1, maxDistance / Math.max(distance, 1e-6));
    let closest = null, closestDistance = Infinity;
    for (const door of doors) {
      const shape = leaf(door);
      for (let i = 0; i <= count; i++) {
        probe.copy(position).lerp(target, i / count * reach);
        if (!touchesLeaf(probe, shape)) continue;
        const squared = probe.distanceToSquared(position);
        if (squared < closestDistance) { closest = door; closestDistance = squared; }
        break;
      }
    }
    return closest;
  }

  function pushDoor(door, position, { unlatch = false, strength = config.doorImpulse } = {}) {
    if (!doorDefinitions.has(door?.id) || !Number.isFinite(strength) || strength <= 0) return false;
    const shape = leaf(door);
    const point = new Vector3(shape.ax + .82 * (shape.bx - shape.ax), door.hinge.y + .95,
      shape.az + .82 * (shape.bz - shape.az));
    if (Math.hypot(position.x - point.x, position.z - point.z) > config.doorInteractionDistance) return false;
    if (door.latched) {
      if (!unlatch) return false;
      door.latched = false;
    }
    if (door.angle >= door.maxAngle - .5) return false;
    const direction = new Vector3(point.z - door.hinge.z, 0, -(point.x - door.hinge.x))
      .normalize().multiplyScalar(door.openDir);
    door.impulse(point, direction, strength);
    return true;
  }

  return { data, config, positions, plan, nearest, roomGoal, canMove, doorAhead, pushDoor,
    stats: { cells: count, edges: data.bake?.edges ?? null, cellSize: grid.cellSize }, collision };
}
