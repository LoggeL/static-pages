import { BufferGeometry, Matrix3, Mesh, MeshBasicMaterial, Vector3 } from 'three';

const endpoint = (names, offset = [0, 0, 0], fallback = null) => ({ names, offset, fallback });
const names = {
  head: ['Head', 'head', 'Head_M'], hips: ['Hips', 'hips', 'Pelvis'],
  chest: ['Spine2', 'Chest', 'Spine_02', 'Spine1'],
};
const limb = (side, zone, first, second, third, radiusA, radiusB) => [
  { id: `${zone}.${side}.upper`, zone, radius: radiusA,
    start: endpoint([`${first}${side}`, `${side === 'L' ? 'Left' : 'Right'}${zone === 'arms' ? 'Arm' : 'UpLeg'}`]),
    end: endpoint([`${second}${side}`, `${side === 'L' ? 'Left' : 'Right'}${zone === 'arms' ? 'ForeArm' : 'Leg'}`]) },
  { id: `${zone}.${side}.lower`, zone, radius: radiusB,
    start: endpoint([`${second}${side}`, `${side === 'L' ? 'Left' : 'Right'}${zone === 'arms' ? 'ForeArm' : 'Leg'}`]),
    end: endpoint([`${third}${side}`, `${side === 'L' ? 'Left' : 'Right'}${zone === 'arms' ? 'Hand' : 'Foot'}`]) },
];

export const NPC_HIT_ZONE_CONFIG = Object.freeze({
  scaleRadii: true,
  radiusScale: 1,
  capsules: Object.freeze([
    { id: 'head', zone: 'head', radius: 0.10,
      start: endpoint(names.head, [0, 0.025, 0]),
      end: endpoint(['HeadTop_End', 'HeadTop', 'Head_End'], [0, -0.065, 0],
        endpoint(names.head, [0, 0.11, 0])) },
    { id: 'torso', zone: 'torso', radius: 0.20,
      start: endpoint(names.hips), end: endpoint(names.chest, [0, 0.015, 0]) },
    ...limb('L', 'arms', 'Arm_', 'ForeArm_', 'Hand_', 0.073, 0.058),
    ...limb('R', 'arms', 'Arm_', 'ForeArm_', 'Hand_', 0.073, 0.058),
    ...limb('L', 'legs', 'UpLeg_', 'Leg_', 'Foot_', 0.095, 0.076),
    ...limb('R', 'legs', 'UpLeg_', 'Leg_', 'Foot_', 0.095, 0.076),
    ...['L', 'R'].flatMap(side => {
      const word = side === 'L' ? 'Left' : 'Right';
      const hand = [`Hand_${side}`, `${word}Hand`], foot = [`Foot_${side}`, `${word}Foot`];
      return [
        { id: `arms.${side}.hand`, zone: 'arms', radius: 0.045,
          start: endpoint(hand), end: endpoint(hand, [0, 0.13, 0]) },
        { id: `legs.${side}.foot`, zone: 'legs', radius: 0.068,
          start: endpoint(foot), end: endpoint([`ToeBase_${side}`, `${word}ToeBase`], [0, 0.02, 0],
            endpoint(foot, [0, 0.17, 0])) },
      ];
    }),
  ]),
});

/** Closest capsule boundary in raycaster near/far; distances are world metres.
 * Parallel rays, tangencies, zero-length capsules and rays starting inside are supported.
 */
export function intersectRayCapsule(ray, start, end, radius, near = 0, far = Infinity) {
  const origin = ray?.origin, direction = ray?.direction;
  if (!origin || !direction || !start || !end || !Number.isFinite(radius) || radius <= 0 ||
      !Number.isFinite(near) || near < 0 || !(far >= near)) return null;
  const values = [origin.x, origin.y, origin.z, direction.x, direction.y, direction.z,
    start.x, start.y, start.z, end.x, end.y, end.z];
  if (!values.every(Number.isFinite)) return null;
  const directionLength = Math.hypot(direction.x, direction.y, direction.z);
  if (directionLength < 1e-14) return null;
  const dx = direction.x / directionLength, dy = direction.y / directionLength, dz = direction.z / directionLength;
  const ax = end.x - start.x, ay = end.y - start.y, az = end.z - start.z;
  const length = Math.hypot(ax, ay, az);
  const ux = length ? ax / length : 0, uy = length ? ay / length : 0, uz = length ? az / length : 0;
  const ox = origin.x - start.x, oy = origin.y - start.y, oz = origin.z - start.z;
  const od = ox * ux + oy * uy + oz * uz, dd = dx * ux + dy * uy + dz * uz;
  const tolerance = 1e-9 * Math.max(1, length, radius);
  let closest = Infinity;
  const accept = t => {
    if (t >= near && t <= far && t < closest) closest = t;
  };
  const cap = (cx, cy, cz, side) => {
    const x = origin.x - cx, y = origin.y - cy, z = origin.z - cz;
    const b = x * dx + y * dy + z * dz;
    const c = x * x + y * y + z * z - radius * radius;
    const discriminant = b * b - c;
    if (discriminant < -tolerance * radius) return;
    const squareRoot = Math.sqrt(Math.max(0, discriminant));
    for (const t of [-b - squareRoot, -b + squareRoot]) {
      const along = od + t * dd;
      if (!length || (side < 0 ? along <= tolerance : along >= length - tolerance)) accept(t);
    }
  };
  if (length > 1e-12) {
    const vx = dx - ux * dd, vy = dy - uy * dd, vz = dz - uz * dd;
    const wx = ox - ux * od, wy = oy - uy * od, wz = oz - uz * od;
    const a = vx * vx + vy * vy + vz * vz;
    const b = vx * wx + vy * wy + vz * wz;
    const c = wx * wx + wy * wy + wz * wz - radius * radius;
    const discriminant = b * b - a * c;
    if (a > 1e-16 && discriminant >= -tolerance * a * radius) {
      const squareRoot = Math.sqrt(Math.max(0, discriminant));
      // The q form avoids cancellation for a distant ray origin.
      const q = -b - (b < 0 ? -squareRoot : squareRoot);
      const roots = q ? [q / a, c / q] : [-b / a];
      for (const t of roots) {
        const along = od + t * dd;
        if (along >= -tolerance && along <= length + tolerance) accept(t);
      }
    }
  }
  cap(start.x, start.y, start.z, -1);
  if (length > 1e-12) cap(end.x, end.y, end.z, 1);
  if (!Number.isFinite(closest)) return null;
  const point = new Vector3(origin.x + dx * closest, origin.y + dy * closest, origin.z + dz * closest);
  const along = length ? Math.min(length, Math.max(0, od + closest * dd)) : 0;
  const normal = new Vector3(point.x - start.x - ux * along,
    point.y - start.y - uy * along, point.z - start.z - uz * along).normalize();
  return { distance: closest, point, normal };
}

const canonical = name => String(name).toLowerCase().replace(/^mixamorig[:_]?/, '').replace(/[^a-z0-9]/g, '');

/** Register objects in world.shootables after createWeapon(), which installs mesh BVHs.
 * Geometry stays empty and the material invisible; visible=true retains weapon raycasts.
 */
export function createHitZones({ root, npcId, config = {} } = {}) {
  if (!root?.isObject3D) throw new TypeError('NPC hit zones require an Object3D root');
  if (npcId === undefined || npcId === null) throw new TypeError('NPC hit zones require npcId');
  const settings = { ...NPC_HIT_ZONE_CONFIG, ...config };
  if (!Number.isFinite(settings.radiusScale) || settings.radiusScale <= 0 || !Array.isArray(settings.capsules))
    throw new RangeError('Invalid NPC capsule configuration');
  const nodes = new Map();
  root.traverse(node => { if (node.isBone || node.name === 'S_Head') nodes.set(canonical(node.name), node); });
  function resolve(spec) {
    if (!spec) return null;
    const node = (spec.names ?? []).map(name => nodes.get(canonical(name))).find(Boolean);
    if (!node) return resolve(spec.fallback);
    const offset = spec.offset ?? [0, 0, 0];
    if (!Array.isArray(offset) || offset.length !== 3 || !offset.every(Number.isFinite))
      throw new RangeError('NPC capsule offsets require three finite numbers');
    return { node, offset: new Vector3(...offset) };
  }
  const geometry = new BufferGeometry();
  const material = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  material.visible = false;
  const normalToLocal = new Matrix3();
  const objects = [], capsules = [];
  let disposed = false;

  function refresh(capsule, refreshMatrices = false) {
    if (!capsule.from || !capsule.to) { capsule.active = false; return; }
    if (refreshMatrices) {
      capsule.from.node.updateWorldMatrix(true, false);
      capsule.to.node.updateWorldMatrix(true, false);
      capsule.object.updateWorldMatrix(true, false);
    }
    capsule.start.copy(capsule.from.offset).applyMatrix4(capsule.from.node.matrixWorld);
    capsule.end.copy(capsule.to.offset).applyMatrix4(capsule.to.node.matrixWorld);
    const scale = settings.scaleRadii
      ? Math.max(capsule.from.node.matrixWorld.getMaxScaleOnAxis(), capsule.to.node.matrixWorld.getMaxScaleOnAxis()) : 1;
    capsule.radius = capsule.baseRadius * settings.radiusScale * scale;
    capsule.active = Number.isFinite(capsule.radius) && capsule.radius > 0 &&
      Number.isFinite(capsule.start.x) && Number.isFinite(capsule.start.y) && Number.isFinite(capsule.start.z) &&
      Number.isFinite(capsule.end.x) && Number.isFinite(capsule.end.y) && Number.isFinite(capsule.end.z);
  }
  try {
    const ids = new Set();
    for (const definition of settings.capsules) {
      const { id, zone } = definition;
      const radius = settings.radii?.[id] ?? settings.radii?.[zone] ?? definition.radius;
      if (typeof id !== 'string' || !id || ids.has(id) || typeof zone !== 'string' ||
          !Number.isFinite(radius) || radius <= 0) throw new RangeError('Invalid NPC capsule definition');
      ids.add(id);
      const object = new Mesh(geometry, material);
      object.name = `NPCHitZone_${npcId}_${id}`;
      object.visible = true;
      object.renderable = false;
      object.frustumCulled = false;
      object.layers.set(0);
      object.userData = { npcId, zone, part: id, surface: 'flesh', npcHitZone: true, collidable: false, renderable: false };
      const capsule = { id, zone, from: resolve(definition.start), to: resolve(definition.end),
        baseRadius: radius, radius, start: new Vector3(), end: new Vector3(), object, active: false };
      object.raycast = (raycaster, intersections) => {
        if (disposed) return;
        for (let node = object; node; node = node.parent) if (!node.visible) return;
        refresh(capsule, true);
        if (!capsule.active) return;
        const hit = intersectRayCapsule(raycaster.ray, capsule.start, capsule.end, capsule.radius, raycaster.near, raycaster.far);
        if (!hit) return;
        // weapon.js applies inverse-transpose(matrixWorld), so face.normal is local.
        const localNormal = hit.normal.clone().applyMatrix3(normalToLocal.setFromMatrix4(object.matrixWorld).transpose()).normalize();
        intersections.push({ ...hit, object, face: { normal: localNormal, materialIndex: 0 },
          faceIndex: 0, npcId, zone, part: id, surface: 'flesh' });
      };
      root.add(object);
      capsules.push(capsule); objects.push(object);
    }
    update();
  } catch (error) {
    objects.forEach(object => object.removeFromParent());
    geometry.dispose(); material.dispose();
    throw error;
  }

  function update() {
    if (disposed) return;
    root.updateWorldMatrix(true, true);
    for (const capsule of capsules) refresh(capsule);
  }
  function raycast(raycaster) {
    if (disposed) return null;
    return raycaster.intersectObjects(objects, false)[0] ?? null;
  }
  function state() {
    return { npcId, disposed, count: capsules.length, active: capsules.filter(capsule => capsule.active).length,
      capsules: capsules.map(capsule => ({ id: capsule.id, zone: capsule.zone,
        start: capsule.start.toArray(), end: capsule.end.toArray(), radius: capsule.radius,
        bones: [capsule.from?.node.name ?? null, capsule.to?.node.name ?? null], active: !disposed && capsule.active })) };
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    objects.forEach(object => { object.visible = false; object.removeFromParent(); });
    capsules.forEach(capsule => { capsule.active = false; });
    geometry.dispose(); material.dispose();
  }
  return { root, objects, update, raycast, state, dispose, config: settings };
}
