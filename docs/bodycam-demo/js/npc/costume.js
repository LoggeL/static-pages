import { Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry } from 'three';

// Plain clothes for the officer placeholder until a suspect.glb exists (CONTRACT: hoodie, jeans,
// sneakers, cap). Police gear is hidden and the uniform parts get flat colours (the atlas holds flat
// colours anyway). The duty belt stays as the hoodie hem so no skin shows at the waist. The skin-tight undershirt and trousers lose their muscle normal/AO detail and are
// pushed out along the normals so they read as loose cloth; a knit cap sits on the head socket.
// Colours are sRGB hex and stay dark: the weapon light and night exposure lift them a lot. null hides the part.
export const SUSPECT_COSTUMES = {
  hide: /^(BC_|Cable_|Carrier_|MagPouch|Mic_|Molle_|Patch|Radio|RifleMag|Velcro|Buckle|Cuff_|Holster_|Keeper_|Light_|PMag|Snap_|Cargo_|Cummerbund_|Strap_)/,
  parts: { top: /^Shirt$/, collar: /^ShirtCollar$/, hem: /^Belt$/, bottoms: /^Pants$/, shoes: /^Boot_/, soles: /^BootSole_/, gloves: /^Glove_/ },
  // The pistol only shows in the hand; a suspect has no duty holster.
  holster: false,
  looks: {
    // Grey hoodie, dark jeans, black gloves and cap: came prepared.
    S1: { top: '#26282a', bottoms: '#1b2230', shoes: '#141416', soles: '#202020', gloves: '#101010', cap: '#2a2b2d' },
    // Dark red hoodie, washed jeans, white sneakers.
    S2: { top: '#3a1a18', bottoms: '#2b313c', shoes: '#8f8c86', soles: '#a9a59d', gloves: null, cap: null },
    // Olive jacket, black jeans, grey sneakers, green cap.
    S3: { top: '#2f3327', bottoms: '#15181d', shoes: '#4a4844', soles: '#7c786f', gloves: null, cap: '#4a2a1c' },
  },
  fallback: 'S1',
  roughness: { top: 0.95, bottoms: 0.9, shoes: 0.75, soles: 0.8, gloves: 0.7 },
  // Metres along the vertex normal; parts listed here also drop the normal and occlusion maps.
  loose: { top: 0.02, collar: 0.02, hem: 0.012, bottoms: 0.006 },
  // Torso normals lean towards a vertical cylinder (bind pose, |x| below the shoulders) to hide the
  // sculpted chest under the cloth.
  smoothTorso: { top: 0.85 }, torsoHalfWidth: [0.18, 0.26],
  // Bunched hood around the neck bone: torus in bone space, shifted to the back.
  hood: { bone: 'Neck', radius: 0.1, tube: 0.046, offset: [0, -0.02, -0.025], scale: [1.18, 1, 1.2], tiltDeg: 10 },
  // Cap in S_Head space: a spherical cap opening downwards.
  cap: { radius: 0.112, offset: [0, 0.035, -0.008], scale: [1, 0.95, 1.08], thetaLength: 0.56 * Math.PI, roughness: 1 },
};

export function createSuspectCostumes(config = SUSPECT_COSTUMES) {
  const materials = new Map(), capSource = new MeshStandardMaterial({ name: 'Costume_Knit' }), capGeometry = new SphereGeometry(config.cap.radius, 20, 10, 0, Math.PI * 2, 0, config.cap.thetaLength);
  const hoodGeometry = new TorusGeometry(config.hood.radius, config.hood.tube, 10, 24);
  function material(source, part, color) {
    const key = `${source.uuid}:${part}:${color}`;
    if (!materials.has(key)) {
      const dressed = source.clone();
      dressed.name = `${source.name}_${part}`; dressed.map = null; dressed.color.set(color);
      dressed.roughness = part === 'cap' || part === 'hood' ? config.cap.roughness : config.roughness[part] ?? 1;
      const loose = config.loose[part];
      if (loose) {
        dressed.normalMap = null; dressed.aoMap = null; dressed.roughnessMap = null; dressed.metalnessMap = null; dressed.metalness = 0;
        const smooth = config.smoothTorso[part] ?? 0, [inner, outer] = config.torsoHalfWidth;
        dressed.onBeforeCompile = shader => {
          // Bind-space normal: beginnormal runs before skinning, begin_vertex after skinnormal.
          shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
\tvec3 looseNormal = normalize( objectNormal );
\tif ( ${smooth.toFixed(3)} > 0.0 && length( position.xz ) > 1e-4 ) {
\t\tfloat torso = 1.0 - smoothstep( ${inner.toFixed(3)}, ${outer.toFixed(3)}, abs( position.x ) );
\t\tlooseNormal = normalize( mix( looseNormal, normalize( vec3( position.x, 0.0, position.z ) ), ${smooth.toFixed(3)} * torso ) );
\t}
\tobjectNormal = looseNormal;`).replace('#include <begin_vertex>', `#include <begin_vertex>\n\ttransformed += looseNormal * ${loose.toFixed(4)};`);
        };
        dressed.customProgramCacheKey = () => `suspect-loose-${loose}-${smooth}`;
      }
      materials.set(key, dressed);
    }
    return materials.get(key);
  }
  return {
    /** Dresses one placeholder instance; returns what was changed for the NPC state. */
    dress(instance, id) {
      if (!instance.placeholder) return null;
      const look = { ...config.looks[id] ?? config.looks[config.fallback] };
      look.collar ??= look.top; look.hem ??= look.top;
      let hidden = 0, dressed = 0;
      instance.model.traverse(node => {
        if (!node.isMesh || node.name.endsWith('_Drawn')) return;
        if (config.hide.test(node.name)) { node.visible = false; hidden++; return; }
        const part = Object.keys(config.parts).find(key => config.parts[key].test(node.name));
        if (!part) return;
        if (look[part] === null) { node.visible = false; hidden++; return; }
        node.material = material(node.material, part, look[part]); dressed++;
      });
      if (!config.holster) instance.showHolster?.(false);
      let cap = null;
      if (look.cap && instance.sockets.head) {
        cap = new Mesh(capGeometry, material(capSource, 'cap', look.cap));
        cap.name = 'Costume_Cap'; cap.position.fromArray(config.cap.offset); cap.scale.fromArray(config.cap.scale);
        cap.castShadow = false; cap.receiveShadow = true;
        cap.userData.collidable = false;
        instance.sockets.head.add(cap);
      }
      let hood = null;
      const neck = config.hood && look.top ? instance.model.getObjectByName(config.hood.bone) : null;
      if (neck) {
        hood = new Mesh(hoodGeometry, material(capSource, 'hood', look.top));
        hood.name = 'Costume_Hood'; hood.position.fromArray(config.hood.offset); hood.scale.fromArray(config.hood.scale);
        hood.rotation.x = Math.PI / 2 + config.hood.tiltDeg * Math.PI / 180;
        hood.castShadow = false; hood.receiveShadow = true; hood.userData.collidable = false;
        neck.add(hood);
      }
      return { look: id in config.looks ? id : config.fallback, hidden, dressed, cap: !!cap, hood: !!hood };
    },
    dispose() { materials.forEach(entry => entry.dispose()); materials.clear(); capSource.dispose(); capGeometry.dispose(); hoodGeometry.dispose(); },
  };
}
