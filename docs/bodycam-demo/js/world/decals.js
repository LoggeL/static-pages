import { Group, MathUtils, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, TextureLoader, Vector3 } from 'three';
import { fromBlender } from './coordinates.js';

export const DECAL_CONFIG = { polygonOffsetFactor: -2, polygonOffsetUnits: -2, alphaTest: 0.015 };

export async function createDecals(layout, textureIndex, assetUrl, manager, config = DECAL_CONFIG) {
  const root = new Group();
  root.name = 'LayoutDecals';
  root.userData.decal = true;
  const loader = new TextureLoader(manager);
  const materials = new Map();
  const forward = new Vector3(0, 0, 1);
  for (const definition of layout.decals ?? []) {
    const id = definition.decal;
    if (!materials.has(id)) {
      const metadata = textureIndex.decals?.[id] ?? {};
      if (!metadata.file) throw new Error(`Missing decal filename: ${id}`);
      materials.set(id, (async () => {
        const map = await loader.loadAsync(assetUrl(`textures/${metadata.file}`));
        map.colorSpace = SRGBColorSpace;
        const normalMap = metadata.normal
          ? await loader.loadAsync(assetUrl(`textures/${metadata.normal}`)) : null;
        return new MeshStandardMaterial({
          name: `DECAL_${id}`, map, normalMap,
          roughness: metadata.roughness ?? 0.9, metalness: metadata.metalness ?? 0,
          transparent: true, depthWrite: false, alphaTest: config.alphaTest,
          polygonOffset: true, polygonOffsetFactor: config.polygonOffsetFactor,
          polygonOffsetUnits: config.polygonOffsetUnits,
        });
      })());
    }
  }
  const ready = new Map(await Promise.all([...materials].map(async ([id, material]) => [id, await material])));
  (layout.decals ?? []).forEach((definition, index) => {
    const size = definition.size ?? textureIndex.decals?.[definition.decal]?.sizeMeters ?? 1;
    const [width, height] = Array.isArray(size) ? size : [size, size];
    const mesh = new Mesh(new PlaneGeometry(width, height), ready.get(definition.decal));
    mesh.name = `DECAL_${definition.decal}_${index}`;
    mesh.userData.decal = true;
    fromBlender(definition.pos, mesh.position);
    const normal = fromBlender(definition.normal).normalize();
    mesh.quaternion.setFromUnitVectors(forward, normal);
    mesh.rotateZ(MathUtils.degToRad(definition.rot ?? 0));
    mesh.renderOrder = 1;
    root.add(mesh);
  });
  return root;
}
