import * as THREE from 'three';

/**
 * Cascaded sun shadows without touching any material.
 *
 * Four DirectionalLights share the sun direction. Light 0 carries the real sun colour; lights 1..3 are black
 * and exist only so three.js allocates/renders their shadow maps and hands every lit material the matching
 * `directionalShadowMap[i]` / `vDirectionalShadowCoord[i]` uniforms and varyings. A global patch of the
 * `lights_fragment_begin` / `shadowmap_pars_fragment` shader chunks then makes light 0 pick its shadow from the
 * finest cascade that contains the fragment (with cross-fades), and skips BRDF evaluation for the black lights.
 *
 * Because the patch is global there is nothing to register per material: custom `onBeforeCompile` hooks of
 * other modules keep working untouched.
 *
 * Stability / cost:
 *  - every cascade is a fixed-size orthographic box whose centre is snapped to its own texel grid → no shimmer
 *    while the tractor drives or the camera turns;
 *  - cascade 0 is re-rendered every frame, the outer cascades only when their snapped centre moves, the sun
 *    changes, or a slow refresh timer fires (at most one outer cascade per frame);
 *  - casters that are smaller than a cascade's texel are skipped for that cascade.
 */

export const CSM_CASCADE_COUNT = 4;

let chunksInstalled = false;

/** Must run before the first material is compiled. Idempotent. */
export function installCascadedShadowChunks(): void {
  if (chunksInstalled) return;
  chunksInstalled = true;

  const pars = THREE.ShaderChunk.shadowmap_pars_fragment;
  const anchor = 'float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {';
  if (!pars.includes(anchor)) {
    throw new Error('[CascadedShadows] three.js shadowmap_pars_fragment changed: anchor "texture2DCompare" not found.');
  }
  const csmPars = /* glsl */ `
	#if NUM_DIR_LIGHT_SHADOWS >= ${CSM_CASCADE_COUNT}
	#define KH_CSM

	// 16-tap PCF with exact bilinear weights: a 3x3-texel box filter of the bilinearly interpolated shadow test.
	float khShadowPCF( sampler2D shadowMap, vec2 mapSize, vec3 c ) {
		vec2 texel = 1.0 / mapSize;
		vec2 st = c.xy * mapSize - 0.5;
		vec2 base = floor( st );
		vec2 f = st - base;
		vec4 wx = vec4( 1.0 - f.x, 1.0, 1.0, f.x );
		vec4 wy = vec4( 1.0 - f.y, 1.0, 1.0, f.y );
		float sum = 0.0;
		for ( int j = 0; j < 4; j ++ ) {
			for ( int i = 0; i < 4; i ++ ) {
				vec2 uv = ( base + vec2( float( i ) - 0.5, float( j ) - 0.5 ) ) * texel;
				sum += wx[ i ] * wy[ j ] * step( c.z, unpackRGBAToDepth( texture2D( shadowMap, uv ) ) );
			}
		}
		return sum * ( 1.0 / 9.0 );
	}

	// 1 well inside the cascade, 0 at / beyond its border
	float khCascadeWeight( vec3 c, vec2 mapSize ) {
		if ( c.z >= 1.0 || c.z <= 0.0 ) return 0.0;
		vec2 d = min( c.xy, 1.0 - c.xy ) - 3.0 / mapSize;
		return clamp( min( d.x, d.y ) / 0.07, 0.0, 1.0 );
	}

	#define KH_CASCADE( idx ) \\
		c = vDirectionalShadowCoord[ idx ].xyz / vDirectionalShadowCoord[ idx ].w; \\
		c.z += directionalLightShadows[ idx ].shadowBias; \\
		t = khCascadeWeight( c, directionalLightShadows[ idx ].shadowMapSize ); \\
		if ( t > 0.0 ) { \\
			acc += remaining * t * khShadowPCF( directionalShadowMap[ idx ], directionalLightShadows[ idx ].shadowMapSize, c ); \\
			remaining *= 1.0 - t; \\
			if ( remaining <= 0.001 ) return acc; \\
		}

	float khCascades() {
		float acc = 0.0;
		float remaining = 1.0;
		float t;
		vec3 c;
		KH_CASCADE( 0 )
		KH_CASCADE( 1 )
		KH_CASCADE( 2 )
		KH_CASCADE( 3 )
		// beyond the last cascade: unshadowed
		return acc + remaining;
	}

	// shadowIntensity of light 0 is the "sun shadows" switch: 0 skips every lookup without a recompile
	float khCascadedSunShadow() {
		float strength = directionalLightShadows[ 0 ].shadowIntensity;
		if ( strength <= 0.0 ) return 1.0;
		return mix( 1.0, khCascades(), strength );
	}

	#endif

	${anchor}`;
  THREE.ShaderChunk.shadowmap_pars_fragment = pars.replace(anchor, csmPars);

  const lights = THREE.ShaderChunk.lights_fragment_begin;
  const dirStart = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
  const dirEnd = '#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )';
  const i0 = lights.indexOf(dirStart);
  const i1 = lights.indexOf(dirEnd);
  if (i0 < 0 || i1 < 0 || i1 < i0) {
    throw new Error('[CascadedShadows] three.js lights_fragment_begin changed: directional light block not found.');
  }
  const csmDirBlock = /* glsl */ `#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )

	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif

	#if defined( USE_SHADOWMAP ) && defined( KH_CSM )

		// Light 0 is the sun; directional lights 1..${CSM_CASCADE_COUNT - 1} are black cascade carriers and are skipped.
		directionalLight = directionalLights[ 0 ];
		getDirectionalLightInfo( directionalLight, directLight );
		directLight.color *= ( directLight.visible && receiveShadow ) ? khCascadedSunShadow() : 1.0;
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {

			#if UNROLLED_LOOP_INDEX >= ${CSM_CASCADE_COUNT}

				directionalLight = directionalLights[ i ];
				getDirectionalLightInfo( directionalLight, directLight );

				#if ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
				directionalLightShadow = directionalLightShadows[ i ];
				directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
				#endif

				RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

			#endif

		}
		#pragma unroll_loop_end

	#else

		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {

			directionalLight = directionalLights[ i ];

			getDirectionalLightInfo( directionalLight, directLight );

			#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
			directionalLightShadow = directionalLightShadows[ i ];
			directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
			#endif

			RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

		}
		#pragma unroll_loop_end

	#endif

#endif

`;
  THREE.ShaderChunk.lights_fragment_begin = lights.slice(0, i0) + csmDirBlock + lights.slice(i1);
}

interface Cascade {
  light: THREE.DirectionalLight;
  radius: number;
  mapSize: number;
  /** snapped centre the cached map was rendered for */
  center: THREE.Vector3;
  dirty: boolean;
  lastRenderTime: number;
  refreshInterval: number;
}

interface CasterEntry {
  object: THREE.Object3D;
  /** approximate world-space radius of one drawn item (one instance for InstancedMesh) */
  size: number;
}

/**
 * Shadow-only stand-in for a map-spanning InstancedMesh: the same geometry/material, but the instances are
 * split into ground cells so each cascade only draws the cells its light box touches. The stand-ins are
 * invisible to the camera pass (their group is only switched on while three.js renders shadow maps).
 */
interface InstanceProxy {
  source: THREE.InstancedMesh;
  group: THREE.Group;
  version: number;
  count: number;
  rebuilds: number;
  windowStart: number;
  /** instance buffer is rewritten continuously by its owner → not worth proxying */
  dynamic: boolean;
  /** owner wants this mesh to cast (its own castShadow flag, sampled outside the shadow pass) */
  wantsCast: boolean;
  size: number;
}

/** Edge length (m) of the ground cells used to split instanced shadow casters. */
const PROXY_CELL_M = 64;
/** Only instanced meshes with at least this many instances spread over at least this radius are split. */
const PROXY_MIN_INSTANCES = 48;
const PROXY_MIN_EXTENT_M = 110;

/** Light-space depth range (metres) in front of / behind the cascade centre. */
const LIGHT_DISTANCE = 1500;
const LIGHT_DEPTH = 3000;
/** Base half extents (metres) of cascades 0..2 at ground level; multiplied by the altitude scale. */
const BASE_RADII = [20, 62, 205];
const MAP_HALF = 1024;

/** Per-quality shadow budget (see renderQuality.ts). */
export interface ShadowQuality {
  /** shadow-map resolution per cascade, near → far */
  mapSizes: number[];
  /** half extent (m) of the outermost cascade = how far sun shadows reach */
  farRadius: number;
  /** while the view moves, the near cascade is re-rendered every n-th frame (1 = every frame) */
  nearEveryNFrames: number;
  /** while nothing moves, the near cascade is refreshed this often (seconds) for the odd animated prop */
  nearIdleInterval: number;
  /** casters smaller than this many texels of a cascade are left out of it */
  casterCullTexels: number;
}

export class CascadedSunShadows {
  public readonly lights: THREE.DirectionalLight[] = [];
  /** The light that actually illuminates the scene (cascade 0). */
  public readonly sunLight: THREE.DirectionalLight;

  private readonly cascades: Cascade[] = [];
  private readonly sunDir = new THREE.Vector3(0, 0, 0);
  private readonly lightRight = new THREE.Vector3();
  private readonly lightUp = new THREE.Vector3();
  private enabled = true;
  private sunActive = true;
  private radiusScale = 1;
  private casters: CasterEntry[] = [];
  private readonly suppressed: THREE.Object3D[] = [];
  private readonly proxies: InstanceProxy[] = [];
  private readonly proxyRoot = new THREE.Group();
  private readonly proxiedSources: THREE.Object3D[] = [];
  private shadowPassOpen = false;
  private quality: ShadowQuality = {
    mapSizes: [2048, 2048, 2048, 2048],
    farRadius: 760,
    nearEveryNFrames: 1,
    nearIdleInterval: 0.2,
    casterCullTexels: 1.1,
  };
  private frame = 0;
  /** render every out-of-date cascade on the next update (after a resize / re-enable), not one per frame */
  private flushNext = true;
  /** diagnostics: how often each cascade was re-rendered / the cascade set was re-fitted */
  public readonly stats = { cascadeRenders: [0, 0, 0, 0], refits: 0 };
  private time = 0;
  private roundRobin = 1;

  private readonly tmpFwd = new THREE.Vector3();
  private readonly tmpCenter = new THREE.Vector3();
  private readonly tmpMat = new THREE.Matrix4();
  private readonly tmpScale = new THREE.Vector3();

  constructor(scene: THREE.Scene, mapSizes: number[]) {
    installCascadedShadowChunks();
    this.quality = { ...this.quality, mapSizes: [...mapSizes] };
    this.proxyRoot.name = 'KH_ShadowProxies';
    this.proxyRoot.visible = false;
    scene.add(this.proxyRoot);
    for (let i = 0; i < CSM_CASCADE_COUNT; i++) {
      const light = new THREE.DirectionalLight(0xffffff, i === 0 ? 1 : 0);
      light.name = `KH_SunCascade${i}`;
      if (i > 0) light.color.setRGB(0, 0, 0);
      light.castShadow = true;
      const cam = light.shadow.camera;
      cam.near = 1;
      cam.far = LIGHT_DEPTH;
      light.shadow.autoUpdate = false;
      light.shadow.needsUpdate = true;
      const cascade: Cascade = {
        light,
        radius: i < 3 ? BASE_RADII[i] : this.quality.farRadius,
        mapSize: mapSizes[i],
        center: new THREE.Vector3(1e9, 0, 1e9),
        dirty: true,
        lastRenderTime: -1e9,
        // outer cascades only hold static scenery; cascade 1 is refreshed slowly for the odd moving prop
        refreshInterval: [0, 2.0, Infinity, Infinity][i],
      };
      light.shadow.mapSize.set(cascade.mapSize, cascade.mapSize);
      // Per-cascade hook that three.js calls right before it draws this cascade's casters.
      const shadow = light.shadow;
      const originalUpdateMatrices = shadow.updateMatrices.bind(shadow);
      shadow.updateMatrices = (l: THREE.Light) => {
        this.beginCascadeRender(i);
        originalUpdateMatrices(l);
      };
      this.cascades.push(cascade);
      this.lights.push(light);
      scene.add(light);
      scene.add(light.target);
    }
    this.sunLight = this.lights[0];
    this.applyCascadeProjection();
  }

  /** Applies a quality level's shadow budget. Nothing here recompiles a shader. */
  public setQuality(quality: ShadowQuality): void {
    const prev = this.quality;
    this.quality = { ...quality, mapSizes: [...quality.mapSizes] };
    let changed = prev.farRadius !== quality.farRadius;
    this.cascades.forEach((c, i) => {
      if (c.mapSize === quality.mapSizes[i]) return;
      c.mapSize = quality.mapSizes[i];
      c.light.shadow.mapSize.set(c.mapSize, c.mapSize);
      if (c.light.shadow.map) {
        c.light.shadow.map.dispose();
        c.light.shadow.map = null;
      }
      changed = true;
    });
    if (changed) {
      this.applyCascadeProjection();
      // an unrendered map reads as "everything in shadow": fill all of them before the next frame is shown
      this.flushNext = true;
    }
  }

  /**
   * The "sun shadows" switch. The light set, the shadow maps and every shader stay exactly as they are (so
   * nothing is recompiled); the shader skips the lookups and the maps simply stop being updated.
   */
  public setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.sunLight.shadow.intensity = enabled ? 1 : 0;
    if (enabled) {
      for (const c of this.cascades) c.dirty = true;
      this.flushNext = true;
    }
  }

  /**
   * @param direction unit vector towards the sun used for shading/shadows
   * @param active    false when the sun contributes no direct light (twilight): shadow maps are frozen.
   */
  public setSun(direction: THREE.Vector3, color: THREE.Color, intensity: number, active: boolean): void {
    this.sunLight.color.copy(color);
    this.sunLight.intensity = intensity;
    this.sunActive = active;
    if (this.sunDir.distanceToSquared(direction) > 1e-10) {
      this.sunDir.copy(direction).normalize();
      this.tmpMat.lookAt(this.sunDir, new THREE.Vector3(0, 0, 0), THREE.Object3D.DEFAULT_UP);
      this.lightRight.setFromMatrixColumn(this.tmpMat, 0);
      this.lightUp.setFromMatrixColumn(this.tmpMat, 1);
      for (const c of this.cascades) c.dirty = true;
    }
  }

  /**
   * Takes stock of the shadow casters: tiny ones are skipped in coarse cascades, and map-spanning instanced
   * meshes get per-cell shadow stand-ins. Call after the scene is built (and again after big scene changes).
   */
  public refreshCasters(scene: THREE.Scene): void {
    this.disposeProxies();
    const list: CasterEntry[] = [];
    const visit = (obj: THREE.Object3D): void => {
      if (obj === this.proxyRoot) return;
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.castShadow && mesh.geometry) {
        const size = this.measureCaster(mesh);
        if (size !== null) {
          const inst = obj as THREE.InstancedMesh;
          if (inst.isInstancedMesh && this.shouldProxy(inst)) {
            const proxy: InstanceProxy = {
              source: inst,
              group: new THREE.Group(),
              version: -1,
              count: -1,
              rebuilds: 0,
              windowStart: this.time,
              dynamic: false,
              wantsCast: true,
              size,
            };
            proxy.group.name = `KH_ShadowProxy:${inst.name}`;
            this.proxyRoot.add(proxy.group);
            this.buildProxy(proxy);
            this.proxies.push(proxy);
          } else {
            list.push({ object: obj, size });
          }
        }
      }
      for (const child of obj.children) visit(child);
    };
    visit(scene);
    this.casters = list;
    for (const p of this.proxies) {
      for (const child of p.group.children) this.casters.push({ object: child, size: p.size });
    }
    for (const c of this.cascades) c.dirty = true;
  }

  private measureCaster(mesh: THREE.Mesh): number | null {
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const bs = mesh.geometry.boundingSphere;
    if (!bs) return null;
    mesh.updateWorldMatrix(true, false);
    mesh.getWorldScale(this.tmpScale);
    let scale = Math.max(Math.abs(this.tmpScale.x), Math.abs(this.tmpScale.y), Math.abs(this.tmpScale.z));
    const inst = mesh as THREE.InstancedMesh;
    if (inst.isInstancedMesh && inst.count > 0) {
      let maxS = 0;
      const step = Math.max(1, Math.floor(inst.count / 8));
      for (let k = 0; k < inst.count; k += step) {
        inst.getMatrixAt(k, this.tmpMat);
        maxS = Math.max(maxS, this.tmpMat.getMaxScaleOnAxis());
      }
      scale *= maxS;
    }
    return bs.radius * scale;
  }

  private shouldProxy(inst: THREE.InstancedMesh): boolean {
    if (inst.count < PROXY_MIN_INSTANCES) return false;
    if (inst.boundingSphere === null) inst.computeBoundingSphere();
    const bs = inst.boundingSphere;
    if (!bs) return false;
    return bs.radius * inst.matrixWorld.getMaxScaleOnAxis() >= PROXY_MIN_EXTENT_M;
  }

  private buildProxy(proxy: InstanceProxy): void {
    const src = proxy.source;
    for (const child of [...proxy.group.children]) {
      proxy.group.remove(child);
      (child as THREE.InstancedMesh).dispose();
    }
    src.updateWorldMatrix(true, false);
    const srcArray = src.instanceMatrix.array as Float32Array;
    const count = src.count;
    const mw = src.matrixWorld.elements;
    const cells = new Map<number, number[]>();
    for (let i = 0; i < count; i++) {
      const o = i * 16;
      const lx = srcArray[o + 12];
      const ly = srcArray[o + 13];
      const lz = srcArray[o + 14];
      const wx = mw[0] * lx + mw[4] * ly + mw[8] * lz + mw[12];
      const wz = mw[2] * lx + mw[6] * ly + mw[10] * lz + mw[14];
      const key = (Math.floor(wx / PROXY_CELL_M) + 4096) * 8192 + (Math.floor(wz / PROXY_CELL_M) + 4096);
      let bucket = cells.get(key);
      if (!bucket) {
        bucket = [];
        cells.set(key, bucket);
      }
      bucket.push(i);
    }
    for (const bucket of cells.values()) {
      const part = new THREE.InstancedMesh(src.geometry, src.material, bucket.length);
      const dst = part.instanceMatrix.array as Float32Array;
      for (let k = 0; k < bucket.length; k++) {
        const o = bucket[k] * 16;
        dst.set(srcArray.subarray(o, o + 16), k * 16);
      }
      part.instanceMatrix.needsUpdate = true;
      part.name = proxy.group.name;
      part.castShadow = true;
      part.receiveShadow = false;
      part.customDepthMaterial = src.customDepthMaterial;
      part.matrixAutoUpdate = false;
      part.matrix.copy(src.matrixWorld);
      part.computeBoundingSphere();
      proxy.group.add(part);
    }
    proxy.group.updateMatrixWorld(true);
    proxy.version = src.instanceMatrix.version;
    proxy.count = count;
  }

  private disposeProxies(): void {
    for (const p of this.proxies) {
      for (const child of [...p.group.children]) (child as THREE.InstancedMesh).dispose();
      this.proxyRoot.remove(p.group);
    }
    this.proxies.length = 0;
  }

  /** Keeps the stand-ins in sync with their source meshes (visibility, cast flag, edited instances). */
  private syncProxies(): void {
    let changed = false;
    for (const p of this.proxies) {
      const src = p.source;
      p.wantsCast = src.castShadow;
      let visible = p.wantsCast && !p.dynamic;
      for (let o: THREE.Object3D | null = src; visible && o; o = o.parent) {
        if (!o.visible) visible = false;
      }
      if (p.dynamic) continue;
      if (src.instanceMatrix.version !== p.version || src.count !== p.count) {
        if (this.time - p.windowStart > 10) {
          p.windowStart = this.time;
          p.rebuilds = 0;
        }
        p.rebuilds++;
        if (p.rebuilds > 3) {
          // Somebody animates these instances: let the original mesh cast its own shadow again.
          p.dynamic = true;
          for (const child of [...p.group.children]) {
            p.group.remove(child);
            (child as THREE.InstancedMesh).dispose();
          }
          console.info(`[CascadedShadows] "${src.name}" changes its instances continuously - not split for shadows.`);
          visible = false;
        } else {
          this.buildProxy(p);
        }
        changed = true;
      } else if (p.group.children.length > 0) {
        const first = p.group.children[0];
        if (!first.matrix.equals(src.matrixWorld)) {
          for (const child of p.group.children) {
            child.matrix.copy(src.matrixWorld);
            child.matrixWorldNeedsUpdate = true;
          }
          changed = true;
        }
      }
      if (p.group.visible !== visible) {
        p.group.visible = visible;
        changed = true;
      }
    }
    if (changed) {
      this.casters = this.casters.filter((c) => c.object.parent?.parent !== this.proxyRoot);
      for (const p of this.proxies) {
        for (const child of p.group.children) this.casters.push({ object: child, size: p.size });
      }
      for (const c of this.cascades) c.dirty = true;
    }
  }

  private applyCascadeProjection(): void {
    this.cascades.forEach((c, i) => {
      const r = i < 3 ? Math.min(BASE_RADII[i] * this.radiusScale, this.quality.farRadius * 0.6) : this.quality.farRadius;
      c.radius = r;
      const cam = c.light.shadow.camera;
      cam.left = -r;
      cam.right = r;
      cam.top = r;
      cam.bottom = -r;
      cam.near = 1;
      cam.far = LIGHT_DEPTH;
      cam.updateProjectionMatrix();
      const texel = (2 * r) / c.mapSize;
      // Normal offset does the heavy lifting (robust at grazing sun); the depth bias only covers quantisation.
      c.light.shadow.normalBias = Math.max(0.02, texel * 1.75);
      c.light.shadow.bias = -(texel * 0.6) / LIGHT_DEPTH;
      c.dirty = true;
    });
  }

  /**
   * Fits the cascades to the camera. `force` re-renders every out-of-date cascade this frame
   * (used for synchronous screenshot renders); otherwise outer cascades are amortised.
   */
  public update(
    camera: THREE.PerspectiveCamera,
    heightAt: (x: number, z: number) => number,
    dt: number,
    force = false,
    dynamic = true
  ): void {
    this.time += dt;
    this.frame++;
    // Safety net: a render issued by somebody else may have left the shadow-pass state open.
    this.endFrame();
    if (!this.enabled) return;
    this.syncProxies();
    const clampXZ = (v: number) => THREE.MathUtils.clamp(v, -MAP_HALF + 2, MAP_HALF - 2);
    const groundY = heightAt(clampXZ(camera.position.x), clampXZ(camera.position.z));

    camera.getWorldDirection(this.tmpFwd);
    const pitchDown = Math.asin(THREE.MathUtils.clamp(-this.tmpFwd.y, -1, 1));
    const halfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
    const height = Math.max(1.5, camera.position.y - groundY);
    // Slant distance to the nearest visible ground decides how coarse the cascade set may be.
    const downAngle = THREE.MathUtils.clamp(pitchDown + halfFov, THREE.MathUtils.degToRad(9), Math.PI / 2);
    const slant = height / Math.sin(downAngle);
    const nearGroundDist = height / Math.tan(downAngle);
    // Altitude scale (power of two, with hysteresis so it does not flip-flop while the drone hovers).
    const ratio = slant / 34;
    let scale = this.radiusScale;
    while (scale < 8 && ratio > scale * 1.9) scale *= 2;
    while (scale > 1 && ratio < scale * 0.75) scale /= 2;
    if (scale !== this.radiusScale) {
      this.radiusScale = scale;
      this.stats.refits++;
      this.applyCascadeProjection();
    }

    const fx = this.tmpFwd.x;
    const fz = this.tmpFwd.z;
    const fl = Math.hypot(fx, fz);
    const dirX = fl > 1e-4 ? fx / fl : 0;
    const dirZ = fl > 1e-4 ? fz / fl : 0;

    if (this.flushNext) {
      force = true;
      this.flushNext = false;
    }
    let outerBudget = force ? 99 : 1;
    const n = this.cascades.length;
    for (let k = 0; k < n; k++) {
      // cascade 0 first, then the outer ones starting at a rotating index so none starves
      const i = k === 0 ? 0 : 1 + ((this.roundRobin + k - 1) % (n - 1));
      const c = this.cascades[i];
      const r = c.radius;
      const ahead = i === n - 1 ? Math.min(nearGroundDist * 0.5 + r * 0.25, 500) : nearGroundDist * 0.9 + r * 0.78;
      this.tmpCenter.set(camera.position.x + dirX * ahead, 0, camera.position.z + dirZ * ahead);
      if (i === n - 1) {
        const lim = MAP_HALF - r * 0.55;
        this.tmpCenter.x = THREE.MathUtils.clamp(this.tmpCenter.x, -lim, lim);
        this.tmpCenter.z = THREE.MathUtils.clamp(this.tmpCenter.z, -lim, lim);
      }
      // The cascade box is anchored on the ground it should cover (matters a lot for a low sun).
      this.tmpCenter.y = heightAt(clampXZ(this.tmpCenter.x), clampXZ(this.tmpCenter.z));

      // snap to this cascade's texel grid in light space
      const texel = (2 * r) / c.mapSize;
      const lx = this.tmpCenter.dot(this.lightRight);
      const ly = this.tmpCenter.dot(this.lightUp);
      const sx = Math.round(lx / texel) * texel;
      const sy = Math.round(ly / texel) * texel;
      this.tmpCenter.addScaledVector(this.lightRight, sx - lx).addScaledVector(this.lightUp, sy - ly);

      let needs = c.dirty;
      if (i === 0) {
        if (force) needs = true; // synchronous (screenshot) renders always get a fresh near cascade
        if (!needs) {
          // The near cascade follows the view. It is only re-rendered when the view moved by at least a
          // texel, when a caster moves (tractor driving), or on a slow idle timer - never "just because".
          const moved =
            Math.abs(this.tmpCenter.x - c.center.x) + Math.abs(this.tmpCenter.y - c.center.y) + Math.abs(this.tmpCenter.z - c.center.z) > texel * 0.5;
          if (moved || dynamic) needs = this.frame % this.quality.nearEveryNFrames === 0;
          else needs = this.time - c.lastRenderTime > this.quality.nearIdleInterval;
          if (!needs) this.tmpCenter.copy(c.center);
        }
      } else if (!needs) {
        const moved = Math.hypot(this.tmpCenter.x - c.center.x, this.tmpCenter.z - c.center.z);
        if (moved > r * 0.14) needs = true;
        else if (this.time - c.lastRenderTime > c.refreshInterval) needs = true;
        else this.tmpCenter.copy(c.center); // keep the cached placement
      }
      if (!this.sunActive && !c.dirty) needs = false;

      if (needs && i > 0) {
        if (outerBudget <= 0) {
          continue; // keep the cached map this frame, retry next frame
        }
        outerBudget--;
      }

      if (needs) {
        c.center.copy(this.tmpCenter);
        c.light.target.position.copy(c.center);
        c.light.position.copy(c.center).addScaledVector(this.sunDir, LIGHT_DISTANCE);
        c.light.target.updateMatrixWorld();
        c.light.updateMatrixWorld();
        c.light.shadow.needsUpdate = true;
        c.dirty = false;
        c.lastRenderTime = this.time;
      }
    }
    this.roundRobin = (this.roundRobin + 1) % (n - 1);
  }

  /** Called by three.js (via the wrapped updateMatrices) immediately before cascade `index` is drawn. */
  private beginCascadeRender(index: number): void {
    this.stats.cascadeRenders[index]++;
    if (!this.shadowPassOpen) {
      // First cascade of this frame: swap the map-spanning instanced meshes for their per-cell stand-ins.
      this.shadowPassOpen = true;
      this.proxyRoot.visible = true;
      for (const p of this.proxies) {
        if (p.dynamic || !p.wantsCast) continue;
        p.source.castShadow = false;
        this.proxiedSources.push(p.source);
      }
    }
    this.restoreSuppressed();
    if (index === 0) return;
    const c = this.cascades[index];
    const minSize = ((2 * c.radius) / c.mapSize) * this.quality.casterCullTexels;
    for (const entry of this.casters) {
      if (entry.size < minSize && entry.object.castShadow) {
        entry.object.castShadow = false;
        this.suppressed.push(entry.object);
      }
    }
  }

  private restoreSuppressed(): void {
    for (const obj of this.suppressed) obj.castShadow = true;
    this.suppressed.length = 0;
  }

  /** Call after every scene render: restores cast flags and hides the shadow stand-ins from the camera. */
  public endFrame(): void {
    this.restoreSuppressed();
    if (this.shadowPassOpen) {
      this.shadowPassOpen = false;
      this.proxyRoot.visible = false;
      for (const src of this.proxiedSources) src.castShadow = true;
      this.proxiedSources.length = 0;
    }
  }

  /** Marks every cascade for re-rendering (e.g. after large scene changes). */
  public invalidate(): void {
    for (const c of this.cascades) c.dirty = true;
  }

  public getDebugInfo(): Record<string, unknown> {
    return {
      radiusScale: this.radiusScale,
      cascades: this.cascades.map((c) => ({
        radius: c.radius,
        mapSize: c.mapSize,
        texelM: (2 * c.radius) / c.mapSize,
        center: [Math.round(c.center.x), Math.round(c.center.y), Math.round(c.center.z)],
      })),
      stats: { cascadeRenders: [...this.stats.cascadeRenders], refits: this.stats.refits },
      trackedCasters: this.casters.length,
      instanceProxies: this.proxies.map((p) => ({ name: p.source.name, instances: p.count, cells: p.group.children.length, dynamic: p.dynamic })),
    };
  }

  public get direction(): THREE.Vector3 {
    return this.sunDir;
  }
}
