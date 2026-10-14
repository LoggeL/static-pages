import * as THREE from 'three';

export const MOVING = ['W_Mag', 'W_Bolt', 'W_ChargingHandle', 'W_Trigger', 'W_Selector', 'W_BoltCatch', 'W_DustCover'];
export const EMPTIES = ['W_Muzzle', 'W_Ejection', 'W_SightEye', 'W_LightEmitter', 'W_Grip_R', 'W_Grip_L', 'W_MagWell'];
export const REQUIRED = ['W_Root', ...MOVING, ...EMPTIES];
export const LIMITS = { bytes: 3_000_000, length: [0.81, 0.87], axisDot: 0.995 };

export function isWithin(node, ancestor) {
  for (let p = node; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

// Validate the unposed source graph before adding viewer helpers.
export function inspectWeapon(model, json, bytes) {
  model.updateMatrixWorld(true);
  const checks = [];
  const check = (id, passed, detail, warning = false) => checks.push({ id, passed: Boolean(passed), detail, severity: warning ? 'warning' : 'error' });
  const nodes = [];
  model.traverse(o => nodes.push(o));
  const sourceNodes = json.nodes || [];
  const root = model.getObjectByName('W_Root');
  const byName = n => nodes.filter(o => o.name === n);
  for (const name of REQUIRED) {
    const matches = byName(name);
    const sources = sourceNodes.filter(o => o.name === name);
    check(`node:${name}`, matches.length === 1 && sources.length === 1, `${name}: ${sources.length} Quellknoten`);
    if (matches.length === 1 && name !== 'W_Root') {
      check(`parent:${name}`, root && isWithin(matches[0], root), `${name} unter W_Root`);
      if (MOVING.includes(name)) {
        let mesh = false;
        matches[0].traverse(o => { if (o.isMesh) mesh = true; });
        check(`mesh:${name}`, mesh && sources.length === 1 && sources[0].mesh !== undefined, `${name} enthält eigene Geometrie`);
      } else check(`empty:${name}`, sources.length === 1 && sources[0].mesh === undefined, `${name} ist ein Empty`);
    }
  }
  const meshes = nodes.filter(o => o.isMesh);
  const sourceRoots = (json.scenes || [])[json.scene || 0]?.nodes || [];
  const owned = new Set();
  const pending = sourceNodes.flatMap((o, i) => o.name === 'W_Root' ? [i] : []);
  while (pending.length) {
    const index = pending.pop();
    if (owned.has(index)) continue;
    owned.add(index);
    pending.push(...(sourceNodes[index]?.children || []));
  }
  check('scene-root', sourceRoots.some(i => sourceNodes[i]?.name === 'W_Root'), 'W_Root ist eine Wurzel der aktiven Szene');
  check('root-empty', root && sourceNodes.find(o => o.name === 'W_Root')?.mesh === undefined, 'W_Root ist ein Empty');
  check('hierarchy', root && owned.size === sourceNodes.length && meshes.every(o => isWithin(o, root)), 'Alle exportierten Knoten gehören zu W_Root');
  const looseCam = nodes.filter(o => /^CamPin(?:\.|$)/i.test(o.name));
  check('campin', looseCam.length === 0, `${looseCam.length} eigenständige CamPin-Knoten`);
  check('size', bytes <= LIMITS.bytes, `${bytes.toLocaleString('de-DE')} / ${LIMITS.bytes.toLocaleString('de-DE')} Byte`);
  const box = new THREE.Box3().setFromObject(model, true);
  const size = box.getSize(new THREE.Vector3());
  check('length', size.z >= LIMITS.length[0] && size.z <= LIMITS.length[1], `Länge ${size.z.toFixed(4)} m; Soll 0,84 ± 0,03 m`);
  check('longitudinal-axis', size.z > size.x && size.z > size.y, 'Längste Ausdehnung entlang Welt-Z');
  for (const name of ['W_Muzzle', 'W_LightEmitter']) {
    const node = model.getObjectByName(name);
    const axis = node && new THREE.Vector3(0, 0, -1).transformDirection(node.matrixWorld);
    check(`axis:${name}`, axis && axis.dot(new THREE.Vector3(0, 0, -1)) >= LIMITS.axisDot,
      `${name} glTF lokal −Z → Welt [${axis ? axis.toArray().map(x => x.toFixed(4)).join(', ') : 'fehlt'}]`);
  }
  const muzzle = model.getObjectByName('W_Muzzle');
  const muzzlePos = muzzle?.getWorldPosition(new THREE.Vector3());
  check('muzzle-position', muzzlePos && Math.abs(muzzlePos.z - box.min.z) < 0.025, 'W_Muzzle liegt am vorderen Ende (Welt −Z)');
  const ejection = model.getObjectByName('W_Ejection');
  const ejectDir = ejection && new THREE.Vector3(1, 0, 0).transformDirection(ejection.matrixWorld);
  check('ejection-axis', ejectDir && ejectDir.x > 0.8, 'W_Ejection lokale +X zeigt nach rechts');
  const mag = model.getObjectByName('W_Mag');
  const magBox = mag && new THREE.Box3().setFromObject(mag, true).getSize(new THREE.Vector3());
  check('magazine-body', magBox && magBox.y > 0.12 && magBox.x > 0.02 && magBox.z > 0.05,
    `Magazinmaße ${magBox ? magBox.toArray().map(x => x.toFixed(4)).join(' × ') : 'fehlt'} m`);
  const magNodes = nodes.filter(o => /^Mag(?:Body|Round|Lip|Follower|Floor|Base|Rib)/i.test(o.name));
  check('magazine-hierarchy', mag && magNodes.every(o => isWithin(o, mag)), 'MagBody/Patronen/Magazindetails gehören zu W_Mag');
  let vertices = 0, triangles = 0, badPosition = 0, badNormal = 0, badIndex = 0, badUV = 0, noUV = 0;
  for (const mesh of meshes) {
    const { position: p, normal: n, uv } = mesh.geometry.attributes;
    if (!p) { badPosition++; continue; }
    vertices += p.count;
    const indices = mesh.geometry.index;
    triangles += (indices ? indices.count : p.count) / 3;
    for (let i = 0; i < p.count; i++) {
      if (![p.getX(i), p.getY(i), p.getZ(i)].every(Number.isFinite)) badPosition++;
      if (!n || ![n.getX(i), n.getY(i), n.getZ(i)].every(Number.isFinite) || Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) < 0.5) badNormal++;
      if (uv && (![uv.getX(i), uv.getY(i)].every(Number.isFinite) || uv.getX(i) < -0.001 || uv.getY(i) < -0.001 || uv.getX(i) > 1.001 || uv.getY(i) > 1.001)) badUV++;
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!uv && mats.some(m => m.map || m.normalMap || m.roughnessMap || m.metalnessMap)) noUV++;
    if (indices) for (let i = 0; i < indices.count; i++) if (indices.getX(i) >= p.count) badIndex++;
  }
  check('geometry', badPosition === 0 && badNormal === 0 && badIndex === 0, `Geometrie: ${badPosition} ungültige Positionen, ${badNormal} Normalen, ${badIndex} Indizes`);
  check('uv', badUV === 0 && noUV === 0, `Atlas-UVs: ${badUV} ungültige Koordinaten, ${noUV} texturierte Meshes ohne UVs`);
  const materials = json.materials || [];
  const baked = materials.filter(m => m.pbrMetallicRoughness?.baseColorTexture && m.alphaMode !== 'BLEND' && !m.emissiveTexture && !(m.emissiveFactor || []).some(x => x > 0));
  check('baked-pbr', baked.length > 0 && baked.every(m => m.normalTexture && m.occlusionTexture && m.pbrMetallicRoughness.metallicRoughnessTexture), `${baked.length} gebackene PBR-Materialien mit Albedo, AO, Roughness/Metalness und Normal`);
  check('embedded-images', (json.images || []).length > 0 && json.images.every(i => i.bufferView !== undefined), `${(json.images || []).length} eingebettete Texturen`);
  return { ok: checks.every(c => c.passed || c.severity === 'warning'), bytes, bounds: { min: box.min.toArray(), max: box.max.toArray(), size: size.toArray() }, vertices, triangles, meshes: meshes.length, materials: materials.length, checks };
}
