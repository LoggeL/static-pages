import { Box3, DoubleSide, Line3, Matrix3, Matrix4, Ray, Vector3 } from 'three';
import { PLAYER_CONFIG } from './config.js';

/** BVH-Kapselabfragen. Fußpunkt in Weltkoordinaten, Collider in eigenem Raum. */
export class CapsuleCollision {
  constructor(colliders, config = PLAYER_CONFIG) {
    this.config = config;
    this.colliders = colliders;
    this.segment = new Line3();
    this.box = new Box3();
    this.inverse = new Matrix4();
    this.normalMatrix = new Matrix3();
    this.linearMatrix = new Matrix3();
    this.trianglePoint = new Vector3();
    this.capsulePoint = new Vector3();
    this.normal = new Vector3();
    this.correction = new Vector3();
    this.worldCorrection = new Vector3();
    this.localOrigin = new Vector3();
    this.ray = new Ray();
    this.localRay = new Ray();
    this.queryCount = 0;
    this.triangleTests = 0;
  }

  get meshes() {
    return [this.colliders.static, ...(this.colliders.doors || [])].filter(Boolean);
  }

  resolve(position, height, radius = this.config.radius, iterations = this.config.collisionIterations) {
    const result = { grounded: false, ceiling: false, contacts: [], correction: new Vector3() };
    const initial = position.clone();
    const meshes = this.meshes;
    for (let pass = 0; pass < iterations; pass++) {
      let moved = 0;
      for (const mesh of meshes) {
        const tree = mesh.geometry.boundsTree;
        if (!tree || mesh.userData.collisionDisabled) continue;
        mesh.updateWorldMatrix(true, false);
        this.inverse.copy(mesh.matrixWorld).invert();
        this.normalMatrix.getNormalMatrix(mesh.matrixWorld);
        // World/door colliders have rigid transforms (uniform scale also works).
        const scale = mesh.matrixWorld.getMaxScaleOnAxis();
        const localRadius = radius / scale;
        this.segment.start.copy(position).addScaledVector(UP, radius).applyMatrix4(this.inverse);
        this.segment.end.copy(position).addScaledVector(UP, height - radius).applyMatrix4(this.inverse);
        this.localOrigin.copy(this.segment.start);
        this.box.makeEmpty().expandByPoint(this.segment.start).expandByPoint(this.segment.end);
        this.box.expandByScalar(localRadius + this.config.skin / scale);
        this.queryCount++;
        tree.shapecast({
          intersectsBounds: box => box.intersectsBox(this.box),
          intersectsTriangle: triangle => {
            this.triangleTests++;
            const distance = triangle.closestPointToSegment(this.segment, this.trianglePoint, this.capsulePoint);
            const margin = this.config.skin / scale;
            if (distance > localRadius + margin + 1e-9) return false;
            this.normal.subVectors(this.capsulePoint, this.trianglePoint);
            if (distance > 1e-9) this.normal.multiplyScalar(1 / distance);
            else {
              triangle.getNormal(this.normal);
              this.correction.addVectors(this.segment.start, this.segment.end).multiplyScalar(0.5).sub(triangle.a);
              if (this.normal.dot(this.correction) < 0) this.normal.negate();
            }
            const worldNormal = this.normal.clone().applyMatrix3(this.normalMatrix).normalize();
            result.grounded ||= worldNormal.y >= this.config.groundNormalY;
            result.ceiling ||= worldNormal.y <= -this.config.groundNormalY;
            result.contacts.push(worldNormal);
            if (distance < localRadius) {
              const depth = localRadius - distance + margin;
              this.correction.copy(this.normal).multiplyScalar(depth);
              this.segment.start.add(this.correction);
              this.segment.end.add(this.correction);
            }
            return false;
          },
        });
        this.worldCorrection.copy(this.segment.start).sub(this.localOrigin);
        this.worldCorrection.applyMatrix3(this.linearMatrix.setFromMatrix4(mesh.matrixWorld));
        position.add(this.worldCorrection);
        moved += this.worldCorrection.lengthSq();
      }
      if (moved < 1e-12) break;
    }
    result.correction.subVectors(position, initial);
    return result;
  }

  clear(position, height, radius = this.config.radius, tolerance = 0.0015) {
    const probe = position.clone();
    this.resolve(probe, height, radius);
    return probe.distanceToSquared(position) < tolerance * tolerance;
  }

  /** Vertikale Suche bis zum ersten Kontakt, ohne seitlichen Schub auf Rampen. */
  drop(position, height, distance) {
    const start = position.clone();
    const count = Math.max(1, Math.ceil(distance / 0.035));
    let upperY = start.y;
    for (let i = 0; i < count; i++) {
      let lowerY = start.y - (i + 1) * distance / count;
      const probe = start.clone().setY(lowerY);
      const result = this.resolve(probe, height, this.config.radius, 1);
      if (result.grounded) {
        for (let iteration = 0; iteration < 8; iteration++) {
          const middleY = (upperY + lowerY) / 2;
          probe.copy(start).y = middleY;
          const contact = this.resolve(probe, height, this.config.radius, 1);
          if (contact.grounded || contact.correction.lengthSq() > 1e-10) lowerY = middleY;
          else upperY = middleY;
        }
        position.copy(start).y = upperY;
        return { grounded: true, result };
      }
      if (result.correction.lengthSq() > 1e-10) break;
      upperY = lowerY;
    }
    position.copy(start);
    return { grounded: false };
  }

  /** Raycast gegen dieselben BVHs, inklusive aktueller Türtransformation. */
  raycast(origin, direction, maxDistance = Infinity, meshes = this.meshes) {
    this.ray.set(origin, direction);
    let closest = null;
    for (const mesh of meshes) {
      if (!mesh?.geometry.boundsTree || mesh.userData.collisionDisabled) continue;
      mesh.updateWorldMatrix(true, false);
      this.inverse.copy(mesh.matrixWorld).invert();
      this.localRay.copy(this.ray).applyMatrix4(this.inverse);
      const hit = mesh.geometry.boundsTree.raycastFirst(this.localRay, DoubleSide);
      if (!hit) continue;
      const point = hit.point.clone().applyMatrix4(mesh.matrixWorld);
      const distance = point.distanceTo(origin);
      if (distance > maxDistance || (closest && distance >= closest.distance)) continue;
      this.normalMatrix.getNormalMatrix(mesh.matrixWorld);
      closest = { ...hit, point, distance, object: mesh,
        normal: hit.face.normal.clone().applyMatrix3(this.normalMatrix).normalize() };
    }
    return closest;
  }
}

const UP = new Vector3(0, 1, 0);
