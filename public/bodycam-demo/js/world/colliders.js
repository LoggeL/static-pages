import {
  BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Vector3,
} from 'three';
import { acceleratedRaycast, MeshBVH, SAH } from 'three-mesh-bvh';
import { SURFACES, surfaceOf } from './surfaces.js';

export function isCollidable(mesh) {
  if (!mesh.isMesh || !mesh.geometry?.getAttribute('position')) return false;
  for (let node = mesh; node; node = node.parent) {
    if (!node.visible || node.userData?.collider || node.userData?.collision === false
      || node.userData?.collidable === false || node.userData?.decal) return false;
  }
  return true;
}

/** Bake only positions; visual geometries and their UV/material groups stay intact. */
export function makeCollider(meshes, { name, relativeTo = null } = {}) {
  const inverse = relativeTo ? relativeTo.matrixWorld.clone().invert() : new Matrix4();
  const matrix = new Matrix4();
  const vertex = new Vector3();
  let count = 0;
  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    const total = geometry.index?.count ?? geometry.attributes.position.count;
    const start = geometry.drawRange.start;
    count += Math.floor(Math.min(geometry.drawRange.count, total - start) / 3) * 3;
  }
  const positions = new Float32Array(count * 3);
  // BVH reorders indices, never these vertices. face.a therefore remains stable.
  const vertexSurfaces = new Uint8Array(count);
  const vertexSources = new Uint32Array(count);
  let output = 0;
  meshes.forEach((mesh, sourceIndex) => {
    const geometry = mesh.geometry;
    const sourcePositions = geometry.getAttribute('position');
    const index = geometry.index;
    const start = geometry.drawRange.start;
    const total = index?.count ?? sourcePositions.count;
    const end = start + Math.floor(Math.min(geometry.drawRange.count, total - start) / 3) * 3;
    matrix.multiplyMatrices(inverse, mesh.matrixWorld);
    for (let triangle = start; triangle < end; triangle += 3) {
      const group = geometry.groups.find(g => triangle >= g.start && triangle < g.start + g.count);
      const surface = SURFACES.indexOf(surfaceOf(mesh, group?.materialIndex ?? 0));
      for (let corner = 0; corner < 3; corner++) {
        const input = index ? index.getX(triangle + corner) : triangle + corner;
        vertex.fromBufferAttribute(sourcePositions, input).applyMatrix4(matrix);
        vertex.toArray(positions, output * 3);
        vertexSurfaces[output] = Math.max(0, surface);
        vertexSources[output] = sourceIndex;
        output++;
      }
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.boundsTree = new MeshBVH(geometry, { strategy: SAH, maxLeafTris: 10 });
  const collider = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
  collider.name = name ?? 'WorldCollider';
  collider.visible = false;
  collider.raycast = acceleratedRaycast;
  collider.userData.collider = true;
  collider.userData.vertexSurfaces = vertexSurfaces;
  collider.userData.vertexSources = vertexSources;
  collider.userData.sourceMeshes = meshes;
  collider.userData.triangles = count / 3;
  collider.userData.space = relativeTo ? 'door-local' : 'world';
  collider.updateMatrixWorld(true);
  return collider;
}

export function surfaceOfHit(hit) {
  const ids = hit?.object.userData.vertexSurfaces;
  return ids && hit.face ? SURFACES[ids[hit.face.a]] : surfaceOf(hit?.object, hit?.face?.materialIndex);
}

export function sourceOfHit(hit) {
  const data = hit?.object.userData;
  return data?.vertexSources && hit.face
    ? data.sourceMeshes[data.vertexSources[hit.face.a]] : hit?.object;
}

export function accelerateShootables(meshes) {
  for (const mesh of meshes) {
    if (!mesh.geometry.boundsTree) {
      // Keep original triangle order for downstream damage/decal integrations.
      mesh.geometry.boundsTree = new MeshBVH(mesh.geometry, { strategy: SAH, indirect: true });
    }
    mesh.raycast = acceleratedRaycast;
  }
}
