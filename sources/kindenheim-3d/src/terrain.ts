import * as THREE from 'three';
import type { MetaData } from './types';
import { resolveAssetUrl } from './url';

function createProceduralDetailTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const data = img.data;

  // Deterministic tileable multi-frequency hash for crisp micro-detail without seams
  const hash2 = (x: number, y: number, seed: number): number => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };

  const valueNoiseTileable = (u: number, v: number, freq: number, seed: number): number => {
    const x = u * freq;
    const y = v * freq;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const x0 = ((ix % freq) + freq) % freq;
    const x1 = (x0 + 1) % freq;
    const y0 = ((iy % freq) + freq) % freq;
    const y1 = (y0 + 1) % freq;

    const n00 = hash2(x0, y0, seed);
    const n10 = hash2(x1, y0, seed);
    const n01 = hash2(x0, y1, seed);
    const n11 = hash2(x1, y1, seed);
    const nx0 = n00 + (n10 - n00) * sx;
    const nx1 = n01 + (n11 - n01) * sx;
    return nx0 + (nx1 - nx0) * sy;
  };

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // R: fine grit/mineral grain (asphalt, gravel, soil)
      const grit =
        valueNoiseTileable(u, v, 64, 1) * 0.55 +
        valueNoiseTileable(u, v, 128, 2) * 0.3 +
        hash2(x, y, 3) * 0.15;

      // G: medium organic turf/soil clumping
      const organic =
        valueNoiseTileable(u, v, 16, 4) * 0.55 +
        valueNoiseTileable(u, v, 32, 5) * 0.3 +
        valueNoiseTileable(u, v, 64, 6) * 0.15;

      // B: directional furrow / agricultural row micro-texture
      const wave = 0.5 + 0.5 * Math.sin((u * 24 + valueNoiseTileable(u, v, 8, 7) * 0.35) * Math.PI * 2);
      const furrow = wave * 0.65 + valueNoiseTileable(u, v, 32, 8) * 0.35;

      // A: macro contrast variation
      const macro =
        valueNoiseTileable(u, v, 8, 9) * 0.65 + valueNoiseTileable(u, v, 16, 10) * 0.35;

      const i = (y * size + x) * 4;
      data[i] = Math.round(grit * 255);
      data[i + 1] = Math.round(organic * 255);
      data[i + 2] = Math.round(furrow * 255);
      data[i + 3] = Math.round(macro * 255);
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function createFallbackOrthoTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 512, 512);
  grad.addColorStop(0, '#6a7f4f');
  grad.addColorStop(0.5, '#7c8c55');
  grad.addColorStop(1, '#8d8058');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createNeutralMaskTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function loadTextureSafe(
  loader: THREE.TextureLoader,
  url: string,
  colorSpace: THREE.ColorSpace,
  anisotropy: number
): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = colorSpace;
        tex.anisotropy = anisotropy;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      () => resolve(null)
    );
  });
}

export class TerrainSystem {
  public readonly meta: MetaData;
  public readonly heightmap: Float32Array;
  public readonly gridSize: number;
  public readonly mapSizeM: number;
  public readonly halfSizeM: number;
  public readonly mesh: THREE.Mesh;
  public readonly material: THREE.MeshStandardMaterial;

  private readonly uniforms: {
    uDetailTex: { value: THREE.Texture };
    uLanduseTex: { value: THREE.Texture };
    uMapSize: { value: number };
    uDetailStrength: { value: number };
  };

  constructor(meta: MetaData, heightmap: Float32Array) {
    this.meta = meta;
    this.heightmap = heightmap;
    this.gridSize = meta.gridSize;
    this.mapSizeM = meta.mapSizeM || 2048;
    this.halfSizeM = this.mapSizeM * 0.5;

    // Choose high resolution segments (up to 512x512 = ~262k vertices, crisp topography at 4m spacing)
    const segs = Math.min(512, Math.max(128, this.gridSize - 1));
    const geom = new THREE.PlaneGeometry(this.mapSizeM, this.mapSizeM, segs, segs);
    geom.rotateX(-Math.PI / 2);

    const pos = geom.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);
      const vy = this.getTerrainHeight(vx, vz);
      pos.setY(i, vy);
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();

    const detailTex = createProceduralDetailTexture(512);
    const neutralMask = createNeutralMaskTexture();

    this.uniforms = {
      uDetailTex: { value: detailTex },
      uLanduseTex: { value: neutralMask },
      uMapSize: { value: this.mapSizeM },
      uDetailStrength: { value: 1.0 },
    };

    const mat = new THREE.MeshStandardMaterial({
      map: createFallbackOrthoTexture(),
      roughness: 0.94,
      metalness: 0.0,
      envMapIntensity: 0.22,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDetailTex = this.uniforms.uDetailTex;
      shader.uniforms.uLanduseTex = this.uniforms.uLanduseTex;
      shader.uniforms.uMapSize = this.uniforms.uMapSize;
      shader.uniforms.uDetailStrength = this.uniforms.uDetailStrength;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vTerrainWorldPos;`
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vTerrainWorldPos;
          uniform sampler2D uDetailTex;
          uniform sampler2D uLanduseTex;
          uniform float uMapSize;
          uniform float uDetailStrength;`
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            float camDist = distance(cameraPosition, vTerrainWorldPos);
            float closeFade = smoothstep(320.0, 22.0, camDist) * uDetailStrength;
            float microFade = smoothstep(95.0, 6.0, camDist) * uDetailStrength;

            vec2 uvFine = vTerrainWorldPos.xz * 0.24;
            vec2 uvMed  = vTerrainWorldPos.xz * 0.055;
            vec2 uvFar  = vTerrainWorldPos.xz * 0.014;

            vec4 dFine = texture2D(uDetailTex, uvFine);
            vec4 dMed  = texture2D(uDetailTex, uvMed);
            vec4 dFar  = texture2D(uDetailTex, uvFar);

            vec2 maskUv = vec2((vTerrainWorldPos.x / uMapSize) + 0.5, 0.5 - (vTerrainWorldPos.z / uMapSize));
            float luR = texture2D(uLanduseTex, maskUv).r * 255.0;

            // Landuse mask classes from data/meta.json:
            // 16=water, 32=forest, 64=road_asphalt, 96=vineyard, 144=meadow, 168=road_track, 192=residential, 224=farmland
            float isAsphalt  = 1.0 - smoothstep(10.0, 18.0, abs(luR - 64.0));
            float isVineyard = 1.0 - smoothstep(10.0, 18.0, abs(luR - 96.0));
            float isMeadow   = 1.0 - smoothstep(10.0, 18.0, abs(luR - 144.0));
            float isFarmland = 1.0 - smoothstep(10.0, 18.0, abs(luR - 224.0));

            // Combine orthophoto hue cues with real landuse classes for crisp close-range surface texture
            float gBias = diffuseColor.g - max(diffuseColor.r, diffuseColor.b);
            float isGreen = clamp(smoothstep(-0.02, 0.08, gBias) + isMeadow * 0.5 + isVineyard * 0.3, 0.0, 1.0);
            float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            float chroma = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b) - min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b);
            float isPaved = clamp((1.0 - smoothstep(0.03, 0.13, chroma)) * smoothstep(0.08, 0.45, lum) + isAsphalt * 0.85, 0.0, 1.0);

            // Organic grass/vineyard texture + soil/furrow texture + asphalt mineral grain
            float grassGrain = (dFine.g - 0.5) * 0.25 + (dMed.g - 0.5) * 0.15;
            float soilGrain  = (dFine.r - 0.5) * 0.24 + (dMed.b - 0.5) * (0.14 + 0.12 * (isFarmland + isVineyard)) + (dFar.a - 0.5) * 0.09;
            float pavedGrain = (dFine.r - 0.5) * 0.15 + (dMed.r - 0.5) * 0.07;

            float detailDelta = mix(soilGrain, grassGrain, isGreen);
            detailDelta = mix(detailDelta, pavedGrain, isPaved * 0.85);

            // Subtle natural micro-contrast at close range so DOP20 orthophoto stays tactile at street level
            float macroBreak = (dFar.a - 0.5) * 0.05 * closeFade;
            float microMod = 1.0 + detailDelta * (0.44 * closeFade + 0.66 * microFade) + macroBreak;

            // Calibrated DOP20 albedo matching real August midday satellite & Street View brightness (zero aerial over-brightening)
            diffuseColor.rgb *= 0.91;
            diffuseColor.rgb *= clamp(microMod, 0.78, 1.22);

            // Natural Pfalz summer vegetation greens & warm courtyard gravel/paving micro-relief
            float dLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            diffuseColor.rgb = mix(vec3(dLum), diffuseColor.rgb, 1.08);

            // Close-range lush summer verge grass on vineyards & meadows (replaces pale DOP20 roadside glare in sv_vineyard_edge_east)
            float vergeGrassMask = clamp(isVineyard + isMeadow, 0.0, 1.0) * (1.0 - isAsphalt);
            vec3 lushVerge = mix(vec3(0.70, 0.86, 0.58), vec3(0.78, 0.92, 0.68), dFine.g);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * lushVerge, microFade * 0.48 * vergeGrassMask);

            // Crisp warm-gray cobble/gravel micro-speckle on residential courtyards at street level
            float isRes = 1.0 - smoothstep(10.0, 18.0, abs(luR - 192.0));
            vec3 courtGrain = mix(vec3(0.93), vec3(1.07), dFine.r);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * courtGrain, microFade * 0.42 * isRes);

            vec3 turfTint = mix(vec3(1.02, 0.99, 0.94), vec3(0.95, 1.04, 0.92), dFine.g);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * turfTint, microFade * 0.30 * (1.0 - isPaved));
          }`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          {
            vec4 rNoise = texture2D(uDetailTex, vTerrainWorldPos.xz * 0.09);
            roughnessFactor = clamp(roughnessFactor + (rNoise.r - 0.5) * 0.14, 0.68, 0.98);
          }`
        );
    };

    this.material = mat;
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.name = 'KindenheimTerrain';
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
  }

  public async loadTextures(maxAnisotropy: number): Promise<void> {
    const loader = new THREE.TextureLoader();
    const [orthoTex, maskTex] = await Promise.all([
      loadTextureSafe(loader, resolveAssetUrl('data/terrain/orthophoto.jpg'), THREE.SRGBColorSpace, maxAnisotropy),
      loadTextureSafe(loader, resolveAssetUrl('data/terrain/landuse_mask.png'), THREE.NoColorSpace, 1),
    ]);

    if (orthoTex) {
      if (this.material.map) this.material.map.dispose();
      this.material.map = orthoTex;
      this.material.needsUpdate = true;
    }

    if (maskTex) {
      maskTex.minFilter = THREE.LinearFilter;
      maskTex.magFilter = THREE.LinearFilter;
      this.uniforms.uLanduseTex.value = maskTex;
    }
  }

  /**
   * Exact bilinear height sampling in local world coordinates:
   * x in [-mapSizeM/2, +mapSizeM/2] (West -> East)
   * z in [-mapSizeM/2, +mapSizeM/2] (North -> South)
   * Returns meters above meta.minElevationM.
   */
  public getTerrainHeight(x: number, z: number): number {
    const n = this.gridSize;
    const half = this.halfSizeM;

    const u = THREE.MathUtils.clamp((x + half) / this.mapSizeM, 0, 1);
    const v = THREE.MathUtils.clamp((z + half) / this.mapSizeM, 0, 1);

    const gx = u * (n - 1);
    const gz = v * (n - 1);

    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const x1 = Math.min(x0 + 1, n - 1);
    const z1 = Math.min(z0 + 1, n - 1);

    const tx = gx - x0;
    const tz = gz - z0;

    const h00 = this.heightmap[z0 * n + x0];
    const h10 = this.heightmap[z0 * n + x1];
    const h01 = this.heightmap[z1 * n + x0];
    const h11 = this.heightmap[z1 * n + x1];

    const h0 = h00 + (h10 - h00) * tx;
    const h1 = h01 + (h11 - h01) * tx;
    return h0 + (h1 - h0) * tz;
  }

  public getTerrainNormal(x: number, z: number, step = 2.0): THREE.Vector3 {
    const hL = this.getTerrainHeight(x - step, z);
    const hR = this.getTerrainHeight(x + step, z);
    const hU = this.getTerrainHeight(x, z - step);
    const hD = this.getTerrainHeight(x, z + step);
    return new THREE.Vector3(hL - hR, 2 * step, hU - hD).normalize();
  }

  public getAbsoluteElevation(x: number, z: number): number {
    return this.meta.minElevationM + this.getTerrainHeight(x, z);
  }

  public latLonToWorldXZ(lat: number, lon: number): [number, number] {
    const aff = this.meta.projection?.latLonToLocalAffine;
    if (aff) {
      const dLon = lon - this.meta.centerLon;
      const dLat = lat - this.meta.centerLat;
      const x = dLon * aff.dX_dLon + dLat * aff.dX_dLat;
      const z = dLon * aff.dZ_dLon + dLat * aff.dZ_dLat;
      return [x, z];
    }
    const metersPerDegLat = 111320;
    const metersPerDegLon = 111320 * Math.cos(THREE.MathUtils.degToRad(this.meta.centerLat));
    return [(lon - this.meta.centerLon) * metersPerDegLon, -(lat - this.meta.centerLat) * metersPerDegLat];
  }

  public worldToLatLon(x: number, z: number): { lat: number; lon: number } {
    const aff = this.meta.projection?.latLonToLocalAffine;
    if (aff) {
      const det = aff.dX_dLon * aff.dZ_dLat - aff.dX_dLat * aff.dZ_dLon;
      if (Math.abs(det) > 1e-6) {
        const dLon = (x * aff.dZ_dLat - z * aff.dX_dLat) / det;
        const dLat = (aff.dX_dLon * z - aff.dZ_dLon * x) / det;
        return {
          lat: this.meta.centerLat + dLat,
          lon: this.meta.centerLon + dLon,
        };
      }
    }
    const metersPerDegLat = 111320;
    const metersPerDegLon = 111320 * Math.cos(THREE.MathUtils.degToRad(this.meta.centerLat));
    return {
      lat: this.meta.centerLat - z / metersPerDegLat,
      lon: this.meta.centerLon + x / metersPerDegLon,
    };
  }

  public setWireframe(enabled: boolean): void {
    this.material.wireframe = enabled;
  }
}
