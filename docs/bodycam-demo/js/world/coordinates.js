import { Box3, MathUtils, Vector3 } from 'three';

/** Blender Z-up to glTF/Three Y-up, in metres. */
export function fromBlender(value, target = new Vector3()) {
  return target.set(value[0], value[2], -value[1]);
}

export function anchorFromBlender(anchor) {
  if (!anchor) return null;
  const { pos, ...metadata } = anchor;
  return {
    ...metadata,
    position: fromBlender(pos),
    yawDeg: anchor.yawDeg ?? anchor.rotZ ?? 0,
    pitchDeg: anchor.pitchDeg ?? 0,
    rotationY: MathUtils.degToRad(anchor.rotZ ?? anchor.yawDeg ?? 0),
    source: anchor,
  };
}

function boundsFromBlender(aabb) {
  return new Box3(
    new Vector3(aabb[0], aabb[2], -aabb[4]),
    new Vector3(aabb[3], aabb[5], -aabb[1]),
  );
}

function insidePolygon(x, z, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const cross = (x - a.x) * (b.y - a.y) - (z - a.y) * (b.x - a.x);
    if (Math.abs(cross) < 1e-7 && x >= Math.min(a.x, b.x) - 1e-7
      && x <= Math.max(a.x, b.x) + 1e-7 && z >= Math.min(a.y, b.y) - 1e-7
      && z <= Math.max(a.y, b.y) + 1e-7) return true;
    if ((a.y > z) !== (b.y > z)
      && x < (b.x - a.x) * (z - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function createRooms(layout) {
  return layout.rooms.map(source => {
    const bounds = source.aabb ? boundsFromBlender(source.aabb) : null;
    const floorY = source.floorZ ?? bounds?.min.y;
    const ceilingY = source.ceilingZ ?? bounds?.max.y;
    // Polygon Vector2 values describe the Three X/Z plane, not screen X/Y.
    const polygon = source.polygon?.map(([x, y]) => ({ x, y: -y }));
    const rects = source.rects?.map(([x0, y0, x1, y1]) =>
      new Box3(new Vector3(x0, floorY, -y1), new Vector3(x1, ceilingY, -y0)));
    return {
      ...source,
      source,
      bounds,
      aabb: bounds,
      rects,
      polygon,
      floorY,
      ceilingY,
      contains(point) {
        if (!bounds) return false;
        const epsilon = 0.025;
        if (point.y < floorY - epsilon || point.y > ceilingY + epsilon
          || point.x < bounds.min.x || point.x > bounds.max.x
          || point.z < bounds.min.z || point.z > bounds.max.z) return false;
        if (rects?.length) return rects.some(rect => point.x >= rect.min.x
          && point.x <= rect.max.x && point.z >= rect.min.z && point.z <= rect.max.z);
        return !polygon || insidePolygon(point.x, point.z, polygon);
      },
    };
  });
}
