export const SURFACES = [
  'concrete', 'wood', 'carpet', 'tile', 'metal', 'plaster', 'glass',
  'dirt', 'grass', 'asphalt', 'fabric', 'cardboard', 'flesh',
];

const patterns = [
  ['glass', /glass/],
  ['asphalt', /asphalt|road/],
  ['grass', /grass/],
  ['dirt', /dirt|mud/],
  ['carpet', /carpet|rug/],
  ['tile', /tile|porcelain|ceramic/],
  ['metal', /metal|steel|stainless|aluminium|chrome|brass|copper|wire|chainlink|galv|needle/],
  ['wood', /wood|cabinet|laminate|hardboard|particleboard|fan_blade/],
  ['fabric', /fabric|mattress|curtain|cloth|canvas|foam|plush/],
  ['cardboard', /cardboard|paper|book|pizza/],
  ['flesh', /flesh|skin/],
  ['plaster', /plaster|wallpaper|ceiling|siding/],
  ['concrete', /concrete|brick|roof/],
];

/** Object extras take precedence; material names are the fallback. */
export function surfaceOf(object, materialIndex = 0) {
  for (let node = object; node; node = node.parent) {
    if (SURFACES.includes(node.userData?.surface)) return node.userData.surface;
  }
  const materials = object?.material;
  const material = Array.isArray(materials) ? materials[materialIndex] : materials;
  const name = material?.name?.toLowerCase() ?? '';
  return patterns.find(([, pattern]) => pattern.test(name))?.[0] ?? 'concrete';
}
