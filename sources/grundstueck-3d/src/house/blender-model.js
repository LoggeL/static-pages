import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PMREMGenerator } from 'three';

export function createStudioLight(renderer) {
  const room = new RoomEnvironment();
  const generator = new PMREMGenerator(renderer);
  try { return generator.fromScene(room, .045); }
  finally { room.dispose(); generator.dispose(); }
}

export async function loadBlenderHouse(base, signal) {
  const url = new URL(base + 'blender/haus.glb', document.baseURI);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Hausmodell: HTTP ' + response.status);
  const data = await response.arrayBuffer();
  const { scene: group } = await new GLTFLoader().parseAsync(data, new URL('.', url).href);
  const surfaces = [];
  const resources = new Set();
  group.traverse(o => {
    if (!o.isMesh) return;
    surfaces.push(o); resources.add(o.geometry);
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    o.castShadow = materials.every(m => !m.transparent);
    o.receiveShadow = true;
    for (const material of materials) {
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
  });
  const dispose = () => {
    for (const res of resources) {
      if (res.isTexture) res.source.data?.close?.();
      res.dispose();
    }
    resources.clear();
  };
  if (signal.aborted) { dispose(); throw new DOMException('Hausansicht geschlossen', 'AbortError'); }
  function setMode(mode) {
    const roof = mode === 'full' || mode === 'roof';
    for (const mesh of surfaces) {
      const { level, frontCut } = mesh.userData;
      mesh.visible = !((level === 'dach' || level === 'deckeOg') && !roof)
        && !((level === 'og' || level === 'deckeEg') && mode === 'eg')
        && !(frontCut && mode === 'cutaway');
    }
  }
  return { group, setMode, dispose };
}
