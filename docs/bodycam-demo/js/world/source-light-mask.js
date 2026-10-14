import { Color, ShaderChunk } from 'three';

/** Source lights illuminate moving objects; their energy is already in static atlases. */
export function createSourceLightMask(scene) {
  const uniforms = {
    bodycamPointMask: { value: [] }, bodycamSpotMask: { value: [] },
    bodycamDirectionalMask: { value: [] }, bodycamHemisphereMask: { value: [] },
    bodycamAmbientLight: { value: new Color(0, 0, 0) },
  };
  let lastFrame = -1, lastRenderer = null, lastCamera = null, lastLayers = -1;
  function update(renderer, _scene, camera) {
    if (lastRenderer === renderer && lastFrame === renderer.info.render.frame
      && lastCamera === camera && lastLayers === camera.layers.mask) return;
    lastRenderer = renderer; lastFrame = renderer.info.render.frame;
    lastCamera = camera; lastLayers = camera.layers.mask;
    const lights = [];
    scene.traverseVisible(object => { if (object.isLight && object.layers.test(camera.layers)) lights.push(object); });
    // Match r170 WebGLLights' stable shadow/map ordering, including later weapon lights.
    const order = light => (light.castShadow ? 2 : 0) + (light.map ? 1 : 0);
    lights.sort((a, b) => order(b) - order(a));
    for (const [kind, name] of [['isPointLight', 'Point'], ['isSpotLight', 'Spot'],
      ['isDirectionalLight', 'Directional'], ['isHemisphereLight', 'Hemisphere']]) {
      uniforms[`bodycam${name}Mask`].value = lights.filter(light => light[kind])
        .map(light => light.userData.bakedSource ? 0 : 1);
    }
    const ambient = uniforms.bodycamAmbientLight.value;
    ambient.setRGB(0, 0, 0);
    for (const light of lights) if (light.isAmbientLight && !light.userData.bakedSource) {
      ambient.r += light.color.r * light.intensity;
      ambient.g += light.color.g * light.intensity;
      ambient.b += light.color.b * light.intensity;
    }
  }
  let chunk = ShaderChunk.lights_fragment_begin;
  for (const [call, mask] of [
    ['getPointLightInfo( pointLight, geometryPosition, directLight );', 'Point'],
    ['getSpotLightInfo( spotLight, geometryPosition, directLight );', 'Spot'],
    ['getDirectionalLightInfo( directionalLight, directLight );', 'Directional'],
  ]) {
    if (!chunk.includes(call)) throw new Error('Source light mask requires the pinned Three.js r170 shader');
    chunk = chunk.replace(call, `${call}\n directLight.color *= bodycam${mask}Mask[ i ];`);
  }
  chunk = chunk.replace('getAmbientLightIrradiance( ambientLightColor )', 'getAmbientLightIrradiance( bodycamAmbientLight )')
    .replace('getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal )',
      'bodycamHemisphereMask[ i ] * getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal )');
  const declarations = `
    uniform vec3 bodycamAmbientLight;
    #if NUM_POINT_LIGHTS > 0
      uniform float bodycamPointMask[ NUM_POINT_LIGHTS ];
    #endif
    #if NUM_SPOT_LIGHTS > 0
      uniform float bodycamSpotMask[ NUM_SPOT_LIGHTS ];
    #endif
    #if NUM_DIR_LIGHTS > 0
      uniform float bodycamDirectionalMask[ NUM_DIR_LIGHTS ];
    #endif
    #if NUM_HEMI_LIGHTS > 0
      uniform float bodycamHemisphereMask[ NUM_HEMI_LIGHTS ];
    #endif
  `;
  return {
    uniforms,
    apply(material) {
      const compile = material.onBeforeCompile;
      const beforeRender = material.onBeforeRender;
      material.onBeforeCompile = function(shader, renderer) {
        compile.call(this, shader, renderer);
        Object.assign(shader.uniforms, uniforms);
        shader.fragmentShader = declarations + shader.fragmentShader
          .replace('#include <lights_fragment_begin>', chunk);
      };
      material.onBeforeRender = function(...args) { beforeRender.apply(this, args); update(...args); };
      material.customProgramCacheKey = () => 'bodycam-baked-source-mask-r170-v1';
      material.userData.bakedSourceMask = true;
      material.needsUpdate = true;
    },
  };
}
