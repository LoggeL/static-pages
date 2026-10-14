// Keep the established player/door API in Blender coordinates at its input seam.
// level.json and the rendered GLBs remain Three.js Y-up.
const blender = ([x, y, z]) => [x, -z, y];
const anchor = value => value && ({ ...value, pos: blender(value.position) });

export function layoutFromLevel(level) {
  if (level.coords !== 'Three.js Y-up, meters' && !String(level.coords).includes('Y-up')) {
    throw new Error(`Unsupported level coordinates: ${level.coords}`);
  }
  return {
    playerSpawn: anchor(level.playerSpawn),
    policeCar: anchor(level.policeCar),
    suspects: (level.npcs ?? []).map(anchor),
    suspectsAlt: (level.npcsAlt ?? []).map(anchor),
    lights: Object.fromEntries((level.lights ?? []).filter(light => light.layoutAnchor && light.position)
      .map(light => [light.layoutAnchor, anchor(light)])),
    doors: (level.doors ?? []).map(door => ({ ...anchor(door), hinge: door.hinge && blender(door.hinge) })),
    rooms: (level.rooms ?? []).map(room => ({
      ...room,
      aabb: room.aabb && [room.aabb[0], -room.aabb[5], room.aabb[1], room.aabb[3], -room.aabb[2], room.aabb[4]],
      polygon: room.polygon?.map(([x, z]) => [x, -z]),
      rects: room.rects?.map(([x0, z0, x1, z1]) => [x0, -z1, x1, -z0]),
      floorZ: room.floorY, ceilingZ: room.ceilingY,
    })),
  };
}

export function prepareBakedDoors(house, level) {
  const definitions = new Map((level.doors ?? []).map(door => [door.object, door]));
  house.traverse(object => {
    if (!object.name.startsWith('DOOR_')) return;
    const definition = definitions.get(object.name);
    if (!definition?.hinge) return;
    object.userData = { ...object.userData, hinge: blender(definition.hinge),
      sourceCoordinateSystem: object.userData.coordinateSystem,
      coordinateSystem: 'Blender Z-up (door API)' };
  });
}

export function isDoorPart(object) {
  for (let node = object; node; node = node.parent) {
    if (node.name.startsWith('DOOR_')) return true;
  }
  return false;
}
