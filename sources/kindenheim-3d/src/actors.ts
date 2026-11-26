/**
 * Shared registry of moving actors (NPC cars, pedestrians, the player's tractor + trailer).
 *
 * Contract between src/traffic.ts (cars), src/pedestrians.ts (people), src/tractor.ts and src/collision.ts:
 * every system publishes its moving bodies here once per frame, and anyone can query what is around a point.
 * Bodies are oriented boxes on the ground plane (world metres, +X East, +Z South, heading = yaw in radians;
 * forward = (sin(heading), cos(heading)), i.e. 0 = facing +Z / south - the convention of src/tractor.ts).
 *
 * Owner of each body updates it in place (no allocation per frame); systems remove their bodies on dispose.
 */

export type ActorKind = 'tractor' | 'trailer' | 'car' | 'pedestrian';

export interface ActorBody {
  readonly id: string;
  readonly kind: ActorKind;
  /** Centre on the ground plane. */
  x: number;
  z: number;
  /** Yaw in radians: forward = (sin(heading), cos(heading)), as in src/tractor.ts. */
  heading: number;
  /** Half extents of the footprint box: along the heading (length) and across it (width). */
  halfLength: number;
  halfWidth: number;
  /** Ground speed in m/s along the heading (negative when reversing). */
  speed: number;
  /** False while hidden (e.g. culled by quality level): ignored by queries. */
  active: boolean;
}

const bodies = new Map<string, ActorBody>();

export function registerActor(body: ActorBody): ActorBody {
  if (bodies.has(body.id)) throw new Error(`actors: duplicate actor id "${body.id}"`);
  if (!(body.halfLength > 0) || !(body.halfWidth > 0)) {
    throw new Error(`actors: actor "${body.id}" needs positive halfLength / halfWidth`);
  }
  bodies.set(body.id, body);
  return body;
}

export function unregisterActor(id: string): void {
  if (!bodies.delete(id)) throw new Error(`actors: unregisterActor("${id}") - no such actor`);
}

/** All active bodies whose footprint circle comes within `radius` of (x, z); `exclude` skips one id (yourself). */
export function queryActors(x: number, z: number, radius: number, out: ActorBody[], exclude?: string): ActorBody[] {
  out.length = 0;
  for (const b of bodies.values()) {
    if (!b.active || b.id === exclude) continue;
    const r = radius + Math.hypot(b.halfLength, b.halfWidth);
    const dx = b.x - x;
    const dz = b.z - z;
    if (dx * dx + dz * dz <= r * r) out.push(b);
  }
  return out;
}

export function getActor(id: string): ActorBody | undefined {
  return bodies.get(id);
}

export function allActors(): IterableIterator<ActorBody> {
  return bodies.values();
}
