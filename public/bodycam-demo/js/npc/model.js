import { Group, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { createAssetLoaders } from '../core/loaders.js';
import { buildProceduralNPCClips } from './procedural-clips.js';

export const NPC_MODEL_CONFIG = Object.freeze({
  fallbackModelUrl: 'models/officer.glb',
  modelYaw: 0,
  placeholderYaw: Math.PI,
  headBones: ['Head', 'head', 'Head_M'],
  handBones: ['Hand_R', 'RightHand', 'hand.R', 'Hand.R'],
  headOffset: [0, 0.08, 0],
  muzzleOffset: [0, 0.12, 0],
  muzzleForward: [0, 0, 1],
  placeholderMuzzleForward: [0, 1, 0],
});

const canonical = name => String(name).toLowerCase().replace(/^mixamorig[:_]?/, '').replace(/[^a-z0-9]/g, '');
const vector = (value, name, nonzero = false) => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite))
    throw new RangeError(`NPC model ${name} requires three finite numbers`);
  const result = new Vector3(...value);
  if (nonzero && result.lengthSq() < 1e-12) throw new RangeError(`NPC model ${name} must be nonzero`);
  return result;
};

/** One asset load for the library, independent bone/skeleton clones for every NPC.
 * modelUrl comes from nav.json's known assets; no speculative suspect.glb request.
 * Shared geometries/materials/textures belong to the library, never to an instance.
 */
export async function loadNPCModel({ baseUrl = new URL('../../', import.meta.url), renderer,
  modelUrl, config = {} } = {}) {
  const settings = { ...NPC_MODEL_CONFIG, ...config };
  for (const key of ['modelYaw', 'placeholderYaw'])
    if (!Number.isFinite(settings[key])) throw new RangeError(`Invalid NPC model ${key}`);
  for (const key of ['headBones', 'handBones'])
    if (!Array.isArray(settings[key]) || !settings[key].every(name => typeof name === 'string'))
      throw new RangeError(`Invalid NPC model ${key}`);
  const headOffset = vector(settings.headOffset, 'headOffset');
  const muzzleOffset = vector(settings.muzzleOffset, 'muzzleOffset');
  const authoredForward = vector(settings.muzzleForward, 'muzzleForward', true).normalize();
  const placeholderForward = vector(settings.placeholderMuzzleForward, 'placeholderMuzzleForward', true).normalize();
  const url = new URL(baseUrl, import.meta.url);
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  const fallbackUrl = new URL(config.fallbackUrl ?? settings.fallbackModelUrl, url).href;
  const requestedUrl = new URL(modelUrl ?? config.url ?? config.modelUrl ?? fallbackUrl, url).href;
  const assets = createAssetLoaders({ renderer });
  let gltf, loadedUrl = requestedUrl, loadError = null;
  try {
    try { gltf = await assets.gltf.loadAsync(loadedUrl); }
    catch (error) {
      if (loadedUrl === fallbackUrl) throw error;
      loadError = error.message;
      loadedUrl = fallbackUrl;
      gltf = await assets.gltf.loadAsync(loadedUrl);
    }
  } finally { assets.dispose(); }
  const source = gltf.scene;
  const placeholder = /\/officer\.glb$/i.test(new URL(loadedUrl).pathname);
  const geometries = new Set(), materials = new Set(), textures = new Set(), sourceSkeletons = new Set();
  const sourceMeshes = [];
  source.traverse(node => {
    if (!node.isMesh) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
    if (node.isSkinnedMesh) { sourceMeshes.push(node); sourceSkeletons.add(node.skeleton); }
  });
  // Rigs without authored clips get runtime-built ones; the placeholder also draws its holstered pistol.
  const sourceYaw = placeholder ? settings.placeholderYaw : settings.modelYaw;
  const procedural = gltf.animations?.length ? null : buildProceduralNPCClips(source, { yaw: sourceYaw });
  const animations = procedural?.clips.length ? procedural.clips : gltf.animations ?? [];
  const drawable = procedural?.pistol ?? null;
  const instances = new Set();
  let disposed = false, created = 0;

  function instantiate(npcId) {
    if (disposed) throw new Error('NPC model library is disposed');
    if (npcId === undefined || npcId === null) throw new TypeError('NPC model instance requires npcId');
    const model = cloneSkeleton(source), root = new Group();
    root.name = `NPC_${npcId}`;
    root.userData = { npcId, npc: true, collidable: false, placeholder };
    // The wrapper always follows Contract +Z; only the officer child corrects its -Z export.
    model.rotation.y += placeholder ? settings.placeholderYaw : settings.modelYaw;
    root.add(model);
    const nodes = {}, bones = new Map(), skeletons = new Set(), clonedMeshes = [];
    model.traverse(node => {
      if (node.name) nodes[node.name] = node;
      if (node.isBone) bones.set(canonical(node.name), node);
      node.layers.set(0);
      if (node.isMesh) {
        node.castShadow = true; node.receiveShadow = true;
        node.userData.collidable = false;
        // Exported bounds describe only the rest pose.
        if (node.isSkinnedMesh) { node.frustumCulled = false; clonedMeshes.push(node); }
      }
    });
    // SkeletonUtils clones per mesh. Meshes sharing one source skin can share one cloned skin.
    const clonedSkins = new Map();
    clonedMeshes.forEach((mesh, index) => {
      const sourceSkin = sourceMeshes[index]?.skeleton;
      const sharedSkin = clonedSkins.get(sourceSkin);
      if (sharedSkin) { mesh.skeleton.dispose(); mesh.skeleton = sharedSkin; }
      else clonedSkins.set(sourceSkin, mesh.skeleton);
      skeletons.add(mesh.skeleton);
    });
    const findBone = aliases => aliases.map(name => bones.get(canonical(name))).find(Boolean);
    const makeSocket = (name, parent, offset) => {
      const socket = new Object3D();
      socket.name = name;
      socket.position.copy(offset);
      socket.userData.npcFallbackSocket = true;
      (parent ?? model).add(socket);
      nodes[name] = socket;
      return socket;
    };
    const authoredHead = Boolean(nodes.S_Head), authoredMuzzle = Boolean(nodes.S_Muzzle);
    const headBone = findBone(settings.headBones), handBone = findBone(settings.handBones);
    if (!authoredHead) makeSocket('S_Head', headBone, headBone ? headOffset : new Vector3(0, 1.74, 0));
    // A drawable holster pistol gets a copy in the right hand; the muzzle socket sits on its muzzle.
    const holstered = drawable && handBone ? nodes[drawable.mesh] : null;
    let drawn = null, weaponDrawn = false;
    if (holstered?.isMesh) {
      drawn = new Mesh(holstered.geometry, holstered.material);
      drawn.name = `${drawable.mesh}_Drawn`;
      drawable.matrix.decompose(drawn.position, drawn.quaternion, drawn.scale);
      drawn.castShadow = true; drawn.receiveShadow = true; drawn.visible = false;
      drawn.userData.collidable = false;
      handBone.add(drawn);
      nodes[drawn.name] = drawn;
    }
    if (!authoredMuzzle) makeSocket('S_Muzzle', handBone, handBone ? drawn ? drawable.muzzle : muzzleOffset : new Vector3(0.25, 1.25, 0.15));
    const sockets = { head: nodes.S_Head, muzzle: nodes.S_Muzzle };
    const forward = authoredMuzzle ? authoredForward : drawn ? drawable.forward.clone() : placeholderForward;
    const quaternion = new Quaternion();
    let instanceDisposed = false;
    const instance = {
      root, model, nodes, sockets, animations, placeholder,
      get weaponDrawn() { return weaponDrawn; },
      /** Moves the pistol between holster and right hand; no-op for rigs without one. */
      setWeaponDrawn(value) {
        if (!drawn) return false;
        weaponDrawn = !!value; drawn.visible = weaponDrawn; holstered.visible = !weaponDrawn;
        return true;
      },
      getMuzzleDirection(out = new Vector3()) {
        nodes.S_Muzzle.updateWorldMatrix(true, false);
        return out.copy(forward).applyQuaternion(nodes.S_Muzzle.getWorldQuaternion(quaternion)).normalize();
      },
      state() {
        return { npcId, disposed: instanceDisposed, placeholder, sourceUrl: loadedUrl,
          bones: bones.size, skins: skeletons.size,
          clips: animations.map(clip => clip.name), proceduralClips: !!procedural?.clips.length,
          weapon: drawn ? (weaponDrawn ? 'hand' : 'holster') : null,
          sockets: {
            head: { authored: authoredHead, parent: nodes.S_Head.parent?.name ?? null },
            muzzle: { authored: authoredMuzzle, parent: nodes.S_Muzzle.parent?.name ?? null,
              forward: forward.toArray(), handWeaponAuthored: authoredMuzzle && !placeholder },
          } };
      },
      dispose() {
        if (instanceDisposed) return;
        instanceDisposed = true;
        root.removeFromParent();
        skeletons.forEach(skeleton => skeleton.dispose());
        instances.delete(instance);
      },
    };
    root.updateWorldMatrix(true, true);
    instances.add(instance); created++;
    return instance;
  }

  function state() {
    return { disposed, sourceUrl: loadedUrl, requestedUrl, loadError, placeholder,
      clips: animations.map(clip => clip.name), proceduralClips: !!procedural?.clips.length,
      proceduralMissing: procedural?.missing ?? [], created, instances: instances.size,
      shared: { geometries: geometries.size, materials: materials.size, textures: textures.size } };
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    [...instances].forEach(instance => instance.dispose());
    sourceSkeletons.forEach(skeleton => skeleton.dispose());
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    textures.forEach(texture => { texture.dispose(); texture.source?.data?.close?.(); });
  }
  return { instantiate, state, dispose, animations, config: settings };
}
