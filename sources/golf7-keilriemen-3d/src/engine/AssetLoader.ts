import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { InteractableId } from '../types';

const gltfLoader = new GLTFLoader();

/**
 * Loads a Blender-exported .glb asset from `/models/...` and enables consistent PBR shadows.
 */
export async function loadGLB(url: string): Promise<THREE.Group> {
  const gltf = await gltfLoader.loadAsync(url);
  gltf.scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      const isTransparent = mats.some((m) => m && m.transparent && m.opacity < 0.95);
      obj.castShadow = !isTransparent;
      obj.receiveShadow = true;
    }
  });
  return gltf.scene;
}

/**
 * Finds a named node inside a loaded GLB scene, detaches it from its GLB root,
 * optionally zeroes its local translation when attaching into an existing positioned pivot,
 * and returns it.
 */
export function extractNode(
  sceneRoot: THREE.Object3D,
  nodeName: string,
  zeroPosition = true
): THREE.Object3D | null {
  const found = sceneRoot.getObjectByName(nodeName);
  if (!found) {
    console.warn(`[AssetLoader] Missing GLB node: ${nodeName}`);
    return null;
  }
  found.parent?.remove(found);
  if (zeroPosition) {
    found.position.set(0, 0, 0);
  }
  return found;
}

/**
 * Removes procedural visual children from a Three.js group while keeping raycast hitboxes
 * (colorWrite: false or opacity: 0) and any objects marked `userData.preserveOnHydrate === true`.
 */
export function clearVisualChildren(group: THREE.Object3D): void {
  const toRemove: THREE.Object3D[] = [];
  for (const child of group.children) {
    if (child.userData?.preserveOnHydrate) continue;

    if (child instanceof THREE.Mesh) {
      const mat = child.material;
      const isHitbox =
        mat instanceof THREE.Material &&
        (mat.colorWrite === false || (mat.transparent && mat.opacity === 0));
      if (isHitbox) continue;
    }
    toRemove.push(child);
  }

  for (const child of toRemove) {
    group.remove(child);
  }
}

/**
 * Recursively applies `userData.interactableId` and shadows across an extracted Blender subtree.
 */
export function tagSubtreeInteractable(root: THREE.Object3D, id: InteractableId): void {
  root.userData.interactableId = id;
  root.traverse((obj) => {
    obj.userData.interactableId = id;
  });
}
