import {
  GRID_NX,
  GRID_NY,
  MAX_DEBRIS,
  MAX_PARTICLES,
  MAX_SPRAY,
  MAX_STEAM,
  PARTICLE_RADIUS,
  WORLD_H,
  WORLD_W,
} from '../types.ts';
import type {
  IFluidEngine,
  ITerrainGrid,
  LevelTheme,
  MechanismSnapshot,
  QualityLevel,
} from '../types.ts';
import {
  DEBRIS_FS,
  DEBRIS_VS,
  FLUID_SPLAT_FS,
  FLUID_SPLAT_VS,
  FULLSCREEN_QUAD_VS,
  GAUSSIAN_BLUR_FS,
  MECHANISM_FS,
  MECHANISM_VS,
  SPRAY_FS,
  SPRAY_VS,
  STEAM_FS,
  STEAM_VS,
  WATER_COMPOSITE_FS,
  WORLD_TERRAIN_FS,
} from './shaders.ts';

interface FBO {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
  isFloat: boolean;
}

interface CompiledProgram {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

const MAX_LANTERNS = 12;
const MECH_FLOATS_PER_VERTEX = 12; // aPos(2), aUv(2), aColor(4), aData(4)
const SPRAY_FLOATS_PER_INST = 6;   // x, y, vx, vy, life, maxLife
const STEAM_FLOATS_PER_INST = 6;   // x, y, vx, vy, life, maxLife
const DEBRIS_FLOATS_PER_INST = 7;  // x, y, angle, size, life, maxLife, kind

export class WebGLRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;

  private width = 1;
  private height = 1;
  private quality: QualityLevel = 'ultra';
  private useFloatFluid = false;
  private disposed = false;

  // Programs
  private readonly fluidSplatProg: CompiledProgram;
  private readonly blurProg: CompiledProgram;
  private readonly worldTerrainProg: CompiledProgram;
  private readonly mechProg: CompiledProgram;
  private readonly waterCompositeProg: CompiledProgram;
  private readonly sprayProg: CompiledProgram;
  private readonly steamProg: CompiledProgram;
  private readonly debrisProg: CompiledProgram;

  // VAOs & VBOs
  private readonly quadVBO: WebGLBuffer;
  private readonly quadVAO: WebGLVertexArrayObject;

  private readonly fluidVAO: WebGLVertexArrayObject;
  private fluidVBO: WebGLBuffer;
  private fluidVBOCapacityFloats = MAX_PARTICLES * 5;

  private readonly mechVAO: WebGLVertexArrayObject;
  private mechVBO: WebGLBuffer;
  private mechData = new Float32Array(16384 * MECH_FLOATS_PER_VERTEX);
  private mechVertexCount = 0;
  private mechVBOCapacityFloats = 16384 * MECH_FLOATS_PER_VERTEX;

  private readonly instQuadVBO: WebGLBuffer;
  private readonly sprayVAO: WebGLVertexArrayObject;
  private sprayInstVBO: WebGLBuffer;
  private sprayData = new Float32Array(MAX_SPRAY * SPRAY_FLOATS_PER_INST);
  private sprayCapacity = MAX_SPRAY;

  private readonly steamVAO: WebGLVertexArrayObject;
  private steamInstVBO: WebGLBuffer;
  private steamData = new Float32Array(MAX_STEAM * STEAM_FLOATS_PER_INST);
  private steamCapacity = MAX_STEAM;

  private readonly debrisVAO: WebGLVertexArrayObject;
  private debrisInstVBO: WebGLBuffer;
  private debrisData = new Float32Array(MAX_DEBRIS * DEBRIS_FLOATS_PER_INST);
  private debrisCapacity = MAX_DEBRIS;

  // Textures & FBOs
  private readonly terrainSdfTex: WebGLTexture;
  private readonly terrainKindTex: WebGLTexture;
  private readonly terrainSdfBytes = new Uint8Array(GRID_NX * GRID_NY * 4);
  private readonly terrainKindBytes = new Uint8Array(GRID_NX * GRID_NY);
  private lastTerrainVersion = -1;
  private terrainUploaded = false;

  private fluidFBO: FBO | null = null;
  private blurTempFBO: FBO | null = null;
  private fluidSmoothFBO: FBO | null = null;
  private sceneFBO: FBO | null = null;

  // Reusable uniform scratch arrays & lookup maps (zero per-frame GC)
  private readonly lanternPos = new Float32Array(MAX_LANTERNS * 2);
  private readonly lanternColor = new Float32Array(MAX_LANTERNS * 3);
  private readonly lanternRadius = new Float32Array(MAX_LANTERNS);
  private readonly gateMap = new Map<string, { cx: number; cy: number; open: number }>();
  private readonly pumpMap = new Map<string, { cx: number; cy: number; active: number }>();
  private readonly triggerMap = new Map<string, { cx: number; cy: number; ratio: number; active: number }>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const contextAttrs: WebGLContextAttributes = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    };
    const gl = canvas.getContext('webgl2', contextAttrs) ?? canvas.getContext('webgl2');
    if (!gl) {
      throw new Error('WebGL2 is not supported on this device or browser.');
    }
    this.gl = gl;

    // Check float renderability & linear filtering safely before creating fluid FBOs
    const extColorFloat = gl.getExtension('EXT_color_buffer_float');
    const extFloatLinear = gl.getExtension('OES_texture_float_linear');
    this.useFloatFluid = this.probeFloatFBO(extColorFloat !== null && extFloatLinear !== null);

    // Compile all shader programs & cache uniform locations
    this.fluidSplatProg = this.createProgram(FLUID_SPLAT_VS, FLUID_SPLAT_FS, [
      'uWorldSize',
      'uViewportSize',
      'uPointWorldDiameter',
      'uIsFloat',
      'uSplatScale',
    ]);

    this.blurProg = this.createProgram(FULLSCREEN_QUAD_VS, GAUSSIAN_BLUR_FS, [
      'uTex',
      'uBlurStep',
    ]);

    this.worldTerrainProg = this.createProgram(FULLSCREEN_QUAD_VS, WORLD_TERRAIN_FS, [
      'uTerrainSdfTex',
      'uTerrainKindTex',
      'uWorldSize',
      'uTime',
      'uQuality',
      'uSkyTop',
      'uSkyBottom',
      'uRockTint',
      'uLightDir',
      'uSunColor',
      'uNumLanterns',
      'uLanternPos',
      'uLanternColor',
      'uLanternRadius',
    ]);

    this.mechProg = this.createProgram(MECHANISM_VS, MECHANISM_FS, [
      'uWorldSize',
      'uTime',
      'uLightDir',
      'uSunColor',
    ]);

    this.waterCompositeProg = this.createProgram(FULLSCREEN_QUAD_VS, WATER_COMPOSITE_FS, [
      'uFluidTex',
      'uSceneTex',
      'uTerrainSdfTex',
      'uWorldSize',
      'uTime',
      'uIsFloat',
      'uQuality',
      'uWaterDeep',
      'uWaterShallow',
      'uSkyTop',
      'uSkyBottom',
      'uLightDir',
      'uSunColor',
      'uNumLanterns',
      'uLanternPos',
      'uLanternColor',
      'uLanternRadius',
    ]);

    this.sprayProg = this.createProgram(SPRAY_VS, SPRAY_FS, [
      'uWorldSize',
      'uWaterShallow',
      'uSunColor',
    ]);

    this.steamProg = this.createProgram(STEAM_VS, STEAM_FS, [
      'uWorldSize',
      'uTime',
      'uSunColor',
    ]);

    this.debrisProg = this.createProgram(DEBRIS_VS, DEBRIS_FS, [
      'uWorldSize',
      'uRockTint',
      'uSunColor',
    ]);

    // Full-screen quad VAO/VBO ([-1, 1]^2 strip)
    const quadVerts = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    this.quadVBO = this.requireBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

    this.quadVAO = this.requireVAO();
    gl.bindVertexArray(this.quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Fluid particle stream VAO/VBO ([px, py, vx, vy, foam])
    this.fluidVBO = this.requireBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fluidVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this.fluidVBOCapacityFloats * 4, gl.DYNAMIC_DRAW);

    this.fluidVAO = this.requireVAO();
    gl.bindVertexArray(this.fluidVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fluidVBO);
    this.bindAttrib(this.fluidSplatProg.program, 'aPos', 2, 20, 0);
    this.bindAttrib(this.fluidSplatProg.program, 'aVel', 2, 20, 8);
    this.bindAttrib(this.fluidSplatProg.program, 'aFoam', 1, 20, 16);

    // Dynamic Mechanism VAO/VBO
    this.mechVBO = this.requireBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.mechVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this.mechVBOCapacityFloats * 4, gl.DYNAMIC_DRAW);

    this.mechVAO = this.requireVAO();
    gl.bindVertexArray(this.mechVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.mechVBO);
    const mechStride = MECH_FLOATS_PER_VERTEX * 4;
    this.bindAttrib(this.mechProg.program, 'aPos', 2, mechStride, 0);
    this.bindAttrib(this.mechProg.program, 'aUv', 2, mechStride, 8);
    this.bindAttrib(this.mechProg.program, 'aColor', 4, mechStride, 16);
    this.bindAttrib(this.mechProg.program, 'aData', 4, mechStride, 32);

    // Instanced particle unit quad VBO
    this.instQuadVBO = this.requireBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instQuadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

    // Spray VAO
    this.sprayInstVBO = this.requireBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sprayInstVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this.sprayCapacity * SPRAY_FLOATS_PER_INST * 4, gl.DYNAMIC_DRAW);
    this.sprayVAO = this.setupInstancedVAO(
      this.sprayProg.program,
      this.sprayInstVBO,
      SPRAY_FLOATS_PER_INST * 4,
      [
        { name: 'aInstPosVel', size: 4, offset: 0 },
        { name: 'aInstLife', size: 2, offset: 16 },
      ]
    );

    // Steam VAO
    this.steamInstVBO = this.requireBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.steamInstVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this.steamCapacity * STEAM_FLOATS_PER_INST * 4, gl.DYNAMIC_DRAW);
    this.steamVAO = this.setupInstancedVAO(
      this.steamProg.program,
      this.steamInstVBO,
      STEAM_FLOATS_PER_INST * 4,
      [
        { name: 'aInstPosVel', size: 4, offset: 0 },
        { name: 'aInstLife', size: 2, offset: 16 },
      ]
    );

    // Debris VAO
    this.debrisInstVBO = this.requireBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.debrisInstVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this.debrisCapacity * DEBRIS_FLOATS_PER_INST * 4, gl.DYNAMIC_DRAW);
    this.debrisVAO = this.setupInstancedVAO(
      this.debrisProg.program,
      this.debrisInstVBO,
      DEBRIS_FLOATS_PER_INST * 4,
      [
        { name: 'aInstGeom', size: 4, offset: 0 },
        { name: 'aInstMeta', size: 3, offset: 16 },
      ]
    );

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // Terrain textures (128x72)
    this.terrainSdfTex = this.createTerrainTexture(gl.RGBA8, gl.RGBA, gl.LINEAR);
    this.terrainKindTex = this.createTerrainTexture(gl.R8, gl.RED, gl.NEAREST);

    // Initialize FBOs at current canvas dimensions
    const initW = Math.max(1, canvas.width || canvas.clientWidth || 1280);
    const initH = Math.max(1, canvas.height || canvas.clientHeight || 720);
    this.resize(initW, initH);
  }

  public resize(w: number, h: number): void {
    if (this.disposed) return;
    const rw = Math.max(1, Math.floor(w));
    const rh = Math.max(1, Math.floor(h));
    if (this.canvas.width !== rw || this.canvas.height !== rh) {
      this.canvas.width = rw;
      this.canvas.height = rh;
    }
    if (rw === this.width && rh === this.height && this.sceneFBO !== null) {
      return;
    }
    this.width = rw;
    this.height = rh;
    this.rebuildFramebuffers();
  }

  public setQuality(q: QualityLevel): void {
    if (this.disposed || this.quality === q) return;
    this.quality = q;
    this.rebuildFramebuffers();
  }

  public render(
    time: number,
    fluid: IFluidEngine,
    terrain: ITerrainGrid,
    mechanisms: MechanismSnapshot,
    theme: LevelTheme
  ): void {
    if (this.disposed) return;
    const gl = this.gl;

    // Ensure canvas size stays synchronized
    if (this.canvas.width !== this.width || this.canvas.height !== this.height) {
      if (this.canvas.width > 0 && this.canvas.height > 0) {
        this.width = this.canvas.width;
        this.height = this.canvas.height;
        this.rebuildFramebuffers();
      }
    }

    if (!this.fluidFBO || !this.blurTempFBO || !this.fluidSmoothFBO || !this.sceneFBO) {
      return;
    }

    // 0. Upload terrain SDF + crisp kind texture only when dirty/version changed
    this.syncTerrainTextures(terrain);
    const numLanterns = this.packLanternUniforms(theme);
    const qFloat = this.quality === 'ultra' ? 1.0 : 0.0;

    // =========================================================================
    // PASS 1: Fluid Particle Splat -> fluidFBO (half-res / quality-scaled)
    // =========================================================================
    const fluidW = this.fluidFBO.width;
    const fluidH = this.fluidFBO.height;

    if (fluid.numParticles > 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fluidFBO.framebuffer);
      gl.viewport(0, 0, fluidW, fluidH);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE);

      const pCount = Math.min(fluid.numParticles, Math.floor(fluid.particleVBOData.length / 5));
      if (pCount > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.fluidVBO);
        if (pCount * 5 > this.fluidVBOCapacityFloats) {
          this.fluidVBOCapacityFloats = pCount * 5;
          gl.bufferData(gl.ARRAY_BUFFER, this.fluidVBOCapacityFloats * 4, gl.DYNAMIC_DRAW);
        }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, fluid.particleVBOData.subarray(0, pCount * 5));

        const splatU = this.fluidSplatProg.uniforms;
        gl.useProgram(this.fluidSplatProg.program);
        gl.uniform2f(splatU.uWorldSize, WORLD_W, WORLD_H);
        gl.uniform2f(splatU.uViewportSize, fluidW, fluidH);
        // Splat kernel visual diameter ~7.2 * PARTICLE_RADIUS (~0.30m; Gaussian FWHM radius ~0.072m)
        gl.uniform1f(splatU.uPointWorldDiameter, PARTICLE_RADIUS * 7.2);
        gl.uniform1f(splatU.uIsFloat, this.useFloatFluid ? 1.0 : 0.0);
        gl.uniform1f(splatU.uSplatScale, this.useFloatFluid ? 0.28 : 0.16);

        gl.bindVertexArray(this.fluidVAO);
        gl.drawArrays(gl.POINTS, 0, pCount);
      }

      // =======================================================================
      // PASS 2: Separable 9-tap Gaussian Blur -> blurTempFBO -> fluidSmoothFBO
      // =======================================================================
      gl.disable(gl.BLEND);
      gl.useProgram(this.blurProg.program);
      gl.bindVertexArray(this.quadVAO);
      const blurU = this.blurProg.uniforms;
      gl.uniform1i(blurU.uTex, 0);

      // Resolution-independent blur step (~0.023m per tap => ~0.092m filter radius)
      const stepWorld = 0.023;
      gl.activeTexture(gl.TEXTURE0);

      // 2A: Horizontal
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurTempFBO.framebuffer);
      gl.viewport(0, 0, this.blurTempFBO.width, this.blurTempFBO.height);
      gl.bindTexture(gl.TEXTURE_2D, this.fluidFBO.texture);
      gl.uniform2f(blurU.uBlurStep, stepWorld / WORLD_W, 0.0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // 2B: Vertical
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fluidSmoothFBO.framebuffer);
      gl.viewport(0, 0, this.fluidSmoothFBO.width, this.fluidSmoothFBO.height);
      gl.bindTexture(gl.TEXTURE_2D, this.blurTempFBO.texture);
      gl.uniform2f(blurU.uBlurStep, 0.0, stepWorld / WORLD_H);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else {
      // Clear fluidSmoothFBO cleanly when basin is empty
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fluidSmoothFBO.framebuffer);
      gl.viewport(0, 0, this.fluidSmoothFBO.width, this.fluidSmoothFBO.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    // =========================================================================
    // PASS 3: Atmospheric World + SDF Terrain + Mechanisms -> sceneFBO
    // =========================================================================
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBO.framebuffer);
    gl.viewport(0, 0, this.sceneFBO.width, this.sceneFBO.height);
    gl.disable(gl.BLEND);

    // 3A: Sanctuary Backdrop + Terrain SDF Materials
    gl.useProgram(this.worldTerrainProg.program);
    const wtU = this.worldTerrainProg.uniforms;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.terrainSdfTex);
    gl.uniform1i(wtU.uTerrainSdfTex, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.terrainKindTex);
    gl.uniform1i(wtU.uTerrainKindTex, 1);

    gl.uniform2f(wtU.uWorldSize, WORLD_W, WORLD_H);
    gl.uniform1f(wtU.uTime, time);
    gl.uniform1f(wtU.uQuality, qFloat);
    gl.uniform3fv(wtU.uSkyTop, theme.skyTop);
    gl.uniform3fv(wtU.uSkyBottom, theme.skyBottom);
    gl.uniform3fv(wtU.uRockTint, theme.rockTint);
    gl.uniform2fv(wtU.uLightDir, theme.lightDir);
    gl.uniform3fv(wtU.uSunColor, theme.sunColor);
    gl.uniform1i(wtU.uNumLanterns, numLanterns);
    gl.uniform2fv(wtU.uLanternPos, this.lanternPos);
    gl.uniform3fv(wtU.uLanternColor, this.lanternColor);
    gl.uniform1fv(wtU.uLanternRadius, this.lanternRadius);

    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 3B: Mechanisms rendered inside sceneFBO BEFORE water refraction
    this.buildMechanismBatch(mechanisms, theme);
    if (this.mechVertexCount > 0) {
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.mechVBO);
      const floatsNeeded = this.mechVertexCount * MECH_FLOATS_PER_VERTEX;
      if (floatsNeeded > this.mechVBOCapacityFloats) {
        this.mechVBOCapacityFloats = floatsNeeded;
        gl.bufferData(gl.ARRAY_BUFFER, this.mechVBOCapacityFloats * 4, gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.mechData.subarray(0, floatsNeeded));

      gl.useProgram(this.mechProg.program);
      const mU = this.mechProg.uniforms;
      gl.uniform2f(mU.uWorldSize, WORLD_W, WORLD_H);
      gl.uniform1f(mU.uTime, time);
      gl.uniform2fv(mU.uLightDir, theme.lightDir);
      gl.uniform3fv(mU.uSunColor, theme.sunColor);

      gl.bindVertexArray(this.mechVAO);
      gl.drawArrays(gl.TRIANGLES, 0, this.mechVertexCount);
    }

    // =========================================================================
    // PASS 4: Optical Water Composite + Airborne Spray/Steam/Debris -> Screen
    // =========================================================================
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.BLEND);

    gl.useProgram(this.waterCompositeProg.program);
    const wcU = this.waterCompositeProg.uniforms;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fluidSmoothFBO.texture);
    gl.uniform1i(wcU.uFluidTex, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneFBO.texture);
    gl.uniform1i(wcU.uSceneTex, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.terrainSdfTex);
    gl.uniform1i(wcU.uTerrainSdfTex, 2);

    gl.uniform2f(wcU.uWorldSize, WORLD_W, WORLD_H);
    gl.uniform1f(wcU.uTime, time);
    gl.uniform1f(wcU.uIsFloat, this.useFloatFluid ? 1.0 : 0.0);
    gl.uniform1f(wcU.uQuality, qFloat);
    gl.uniform3fv(wcU.uWaterDeep, theme.waterDeep);
    gl.uniform3fv(wcU.uWaterShallow, theme.waterShallow);
    gl.uniform3fv(wcU.uSkyTop, theme.skyTop);
    gl.uniform3fv(wcU.uSkyBottom, theme.skyBottom);
    gl.uniform2fv(wcU.uLightDir, theme.lightDir);
    gl.uniform3fv(wcU.uSunColor, theme.sunColor);
    gl.uniform1i(wcU.uNumLanterns, numLanterns);
    gl.uniform2fv(wcU.uLanternPos, this.lanternPos);
    gl.uniform3fv(wcU.uLanternColor, this.lanternColor);
    gl.uniform1fv(wcU.uLanternRadius, this.lanternRadius);

    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 4B: Airborne Spray, Steam Plumes & Debris Chunks (Premultiplied Alpha)
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.renderSteam(time, fluid, theme);
    this.renderSpray(fluid, theme);
    this.renderDebris(mechanisms, theme);

    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;

    this.deleteFBO(this.fluidFBO);
    this.deleteFBO(this.blurTempFBO);
    this.deleteFBO(this.fluidSmoothFBO);
    this.deleteFBO(this.sceneFBO);
    this.fluidFBO = null;
    this.blurTempFBO = null;
    this.fluidSmoothFBO = null;
    this.sceneFBO = null;

    gl.deleteTexture(this.terrainSdfTex);
    gl.deleteTexture(this.terrainKindTex);

    gl.deleteBuffer(this.quadVBO);
    gl.deleteBuffer(this.fluidVBO);
    gl.deleteBuffer(this.mechVBO);
    gl.deleteBuffer(this.instQuadVBO);
    gl.deleteBuffer(this.sprayInstVBO);
    gl.deleteBuffer(this.steamInstVBO);
    gl.deleteBuffer(this.debrisInstVBO);

    gl.deleteVertexArray(this.quadVAO);
    gl.deleteVertexArray(this.fluidVAO);
    gl.deleteVertexArray(this.mechVAO);
    gl.deleteVertexArray(this.sprayVAO);
    gl.deleteVertexArray(this.steamVAO);
    gl.deleteVertexArray(this.debrisVAO);

    gl.deleteProgram(this.fluidSplatProg.program);
    gl.deleteProgram(this.blurProg.program);
    gl.deleteProgram(this.worldTerrainProg.program);
    gl.deleteProgram(this.mechProg.program);
    gl.deleteProgram(this.waterCompositeProg.program);
    gl.deleteProgram(this.sprayProg.program);
    gl.deleteProgram(this.steamProg.program);
    gl.deleteProgram(this.debrisProg.program);
  }

  // ===========================================================================
  // Internal Setup & FBO Management
  // ===========================================================================

  private probeFloatFBO(extensionsAvailable: boolean): boolean {
    if (!extensionsAvailable) return false;
    const gl = this.gl;
    // Drain prior flags cleanly
    while (gl.getError() !== gl.NO_ERROR) { /* noop */ }

    const fbo = this.createFBO(4, 4, true);
    const ok = fbo !== null && gl.getError() === gl.NO_ERROR;
    if (fbo) this.deleteFBO(fbo);
    return ok;
  }

  private rebuildFramebuffers(): void {
    this.deleteFBO(this.fluidFBO);
    this.deleteFBO(this.blurTempFBO);
    this.deleteFBO(this.fluidSmoothFBO);
    this.deleteFBO(this.sceneFBO);

    const fluidScale = this.quality === 'ultra' ? 0.625 : 0.5;
    const fluidW = Math.max(64, Math.round(this.width * fluidScale));
    const fluidH = Math.max(36, Math.round(this.height * fluidScale));

    let f1 = this.createFBO(fluidW, fluidH, this.useFloatFluid);
    let f2 = this.createFBO(fluidW, fluidH, this.useFloatFluid);
    let f3 = this.createFBO(fluidW, fluidH, this.useFloatFluid);

    // Seamless fallback to RGBA8 if float FBO failed completeness on any GPU
    if ((!f1 || !f2 || !f3) && this.useFloatFluid) {
      this.deleteFBO(f1);
      this.deleteFBO(f2);
      this.deleteFBO(f3);
      this.useFloatFluid = false;
      f1 = this.createFBO(fluidW, fluidH, false);
      f2 = this.createFBO(fluidW, fluidH, false);
      f3 = this.createFBO(fluidW, fluidH, false);
    }

    if (!f1 || !f2 || !f3) {
      throw new Error('Failed to create complete WebGL2 fluid framebuffers.');
    }

    const scene = this.createFBO(this.width, this.height, false);
    if (!scene) {
      throw new Error('Failed to create complete WebGL2 scene framebuffer.');
    }

    this.fluidFBO = f1;
    this.blurTempFBO = f2;
    this.fluidSmoothFBO = f3;
    this.sceneFBO = scene;
  }

  private createFBO(w: number, h: number, useFloat: boolean): FBO | null {
    const gl = this.gl;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) {
      if (texture) gl.deleteTexture(texture);
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      return null;
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const internalFormat = useFloat ? gl.RGBA16F : gl.RGBA8;
    const type = useFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, gl.RGBA, type, null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      return null;
    }

    return { framebuffer, texture, width: w, height: h, isFloat: useFloat };
  }

  private deleteFBO(fbo: FBO | null): void {
    if (!fbo) return;
    this.gl.deleteFramebuffer(fbo.framebuffer);
    this.gl.deleteTexture(fbo.texture);
  }

  private createTerrainTexture(internalFormat: number, format: number, filter: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error('Failed to create terrain texture.');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, GRID_NX, GRID_NY, 0, format, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  private syncTerrainTextures(terrain: ITerrainGrid): void {
    if (terrain.dirty) {
      terrain.rebuildSDFIfDirty();
    }
    if (this.terrainUploaded && terrain.version === this.lastTerrainVersion) {
      return;
    }

    const count = GRID_NX * GRID_NY;
    const sdf = terrain.sdf;
    const nx = terrain.sdfNormX;
    const ny = terrain.sdfNormY;
    const kinds = terrain.solidKind;
    const rgba = this.terrainSdfBytes;
    const kBytes = this.terrainKindBytes;

    for (let i = 0; i < count; i++) {
      const k = kinds[i];
      const o = i * 4;
      const rNorm = Math.max(0, Math.min(1, sdf[i] * 0.5 + 0.5));
      const gNorm = Math.max(0, Math.min(1, nx[i] * 0.5 + 0.5));
      const bNorm = Math.max(0, Math.min(1, ny[i] * 0.5 + 0.5));
      const aNorm = Math.max(0, Math.min(1, k / 5.0));

      rgba[o] = Math.round(rNorm * 255);
      rgba[o + 1] = Math.round(gNorm * 255);
      rgba[o + 2] = Math.round(bNorm * 255);
      rgba[o + 3] = Math.round(aNorm * 255);
      kBytes[i] = k;
    }

    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    gl.bindTexture(gl.TEXTURE_2D, this.terrainSdfTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GRID_NX, GRID_NY, gl.RGBA, gl.UNSIGNED_BYTE, rgba);

    gl.bindTexture(gl.TEXTURE_2D, this.terrainKindTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GRID_NX, GRID_NY, gl.RED, gl.UNSIGNED_BYTE, kBytes);

    gl.bindTexture(gl.TEXTURE_2D, null);
    this.lastTerrainVersion = terrain.version;
    this.terrainUploaded = true;
  }

  private packLanternUniforms(theme: LevelTheme): number {
    const count = Math.min(theme.ambientLanterns.length, MAX_LANTERNS);
    for (let i = 0; i < count; i++) {
      const l = theme.ambientLanterns[i];
      this.lanternPos[i * 2] = l.x;
      this.lanternPos[i * 2 + 1] = l.y;
      this.lanternColor[i * 3] = l.color[0];
      this.lanternColor[i * 3 + 1] = l.color[1];
      this.lanternColor[i * 3 + 2] = l.color[2];
      this.lanternRadius[i] = l.radius;
    }
    return count;
  }

  // ===========================================================================
  // Mechanism Batch Geometry Construction
  // ===========================================================================

  private buildMechanismBatch(m: MechanismSnapshot, theme: LevelTheme): void {
    this.mechVertexCount = 0;

    const portals = m.portals ?? [];
    const mines = m.mines ?? [];
    const seesaws = m.seesaws ?? [];
    const valves = m.valves ?? [];
    const relays = m.relays ?? [];
    const pumps = m.pumps ?? [];

    // 1. Drain Zone Grates
    for (let i = 0; i < m.drains.length; i++) {
      const d = m.drains[i];
      const asp = d.w / Math.max(d.h, 0.01);
      this.pushAxisRect(d.x, d.y, d.w, d.h, 1, 1, 1, 1, 1, asp, 0, 0);
    }

    // 2. Energy Conduits linking Turbines, Cisterns & Relays to Sluice Gates & Geyser Pumps
    this.gateMap.clear();
    for (let i = 0; i < m.gates.length; i++) {
      const g = m.gates[i];
      this.gateMap.set(g.id, {
        cx: g.baseX + g.w * 0.5,
        cy: g.baseY + g.h * 0.5,
        open: g.isOpen ? 1.0 : 0.0,
      });
    }

    this.pumpMap.clear();
    for (let i = 0; i < pumps.length; i++) {
      const p = pumps[i];
      this.pumpMap.set(p.id, {
        cx: p.x,
        cy: p.y,
        active: p.active ? 1.0 : 0.0,
      });
    }

    this.triggerMap.clear();

    for (let i = 0; i < m.turbines.length; i++) {
      const t = m.turbines[i];
      const chargeRatio = Math.max(0, Math.min(1, t.charge / Math.max(t.targetCharge, 0.001)));
      const tActive = t.completed ? 1.0 : 0.0;
      this.triggerMap.set(t.id, { cx: t.x, cy: t.y, ratio: chargeRatio, active: tActive });
      if (!t.linkedGateId) continue;
      const target = this.gateMap.get(t.linkedGateId);
      if (!target) continue;
      this.pushConduitPath(t.x, t.y, target.cx, target.cy, chargeRatio, t.completed || target.open > 0.5 ? 1.0 : 0.0);
    }

    for (let i = 0; i < m.cisterns.length; i++) {
      const c = m.cisterns[i];
      const sx = c.x + c.w * 0.5;
      const sy = c.y + c.h * 0.5;
      this.triggerMap.set(c.id, { cx: sx, cy: sy, ratio: c.fillRatio, active: c.activated ? 1.0 : 0.0 });
      if (!c.linkedGateId) continue;
      const target = this.gateMap.get(c.linkedGateId);
      if (!target) continue;
      this.pushConduitPath(sx, sy, target.cx, target.cy, c.fillRatio, c.activated || target.open > 0.5 ? 1.0 : 0.0);
    }

    for (let i = 0; i < relays.length; i++) {
      const r = relays[i];
      const midX = (r.ax + r.bx) * 0.5;
      const midY = (r.ay + r.by) * 0.5;
      const rActive = r.active ? 1.0 : 0.0;
      this.triggerMap.set(r.id, { cx: midX, cy: midY, ratio: r.charge, active: rActive });

      if (r.linkedGateId) {
        const gTarget = this.gateMap.get(r.linkedGateId);
        if (gTarget) {
          const da = Math.hypot(gTarget.cx - r.ax, gTarget.cy - r.ay);
          const db = Math.hypot(gTarget.cx - r.bx, gTarget.cy - r.by);
          const sx = da <= db ? r.ax : r.bx;
          const sy = da <= db ? r.ay : r.by;
          this.pushConduitPath(sx, sy, gTarget.cx, gTarget.cy, r.charge, r.active || gTarget.open > 0.5 ? 1.0 : 0.0);
        }
      }

      if (r.linkedPumpId) {
        const pTarget = this.pumpMap.get(r.linkedPumpId);
        if (pTarget) {
          const da = Math.hypot(pTarget.cx - r.ax, pTarget.cy - r.ay);
          const db = Math.hypot(pTarget.cx - r.bx, pTarget.cy - r.by);
          const sx = da <= db ? r.ax : r.bx;
          const sy = da <= db ? r.ay : r.by;
          this.pushConduitPath(sx, sy, pTarget.cx, pTarget.cy, r.charge, r.active || pTarget.active > 0.5 ? 1.0 : 0.0);
        }
      }
    }

    // Wire any pump trigger dependencies not already explicitly linked via relay.linkedPumpId
    for (let i = 0; i < pumps.length; i++) {
      const p = pumps[i];
      for (let k = 0; k < p.requiredTriggerIds.length; k++) {
        const trigId = p.requiredTriggerIds[k];
        // Avoid duplicating conduit if relay already drew via linkedPumpId
        let handledByRelay = false;
        for (let ri = 0; ri < relays.length; ri++) {
          if (relays[ri].id === trigId && relays[ri].linkedPumpId === p.id) {
            handledByRelay = true;
            break;
          }
        }
        if (handledByRelay) continue;
        const src = this.triggerMap.get(trigId);
        if (src) {
          this.pushConduitPath(src.cx, src.cy, p.x, p.y, src.ratio, src.active || (p.active ? 1.0 : 0.0));
        }
      }
    }

    // 3. Hydro-Relay Tesla Arc Filaments (drawn behind pylons)
    for (let i = 0; i < relays.length; i++) {
      const r = relays[i];
      const len = Math.hypot(r.bx - r.ax, r.by - r.ay);
      if (len > 1e-4) {
        const halfW = Math.max(0.14, r.radius * 0.68);
        this.pushSegmentRibbon(
          r.ax, r.ay, r.bx, r.by, halfW,
          1, 1, 1, 1,
          22, r.charge, r.active ? 1.0 : 0.0, len
        );
      }
    }

    // 4. Gate Slide Guide Rails
    for (let i = 0; i < m.gates.length; i++) {
      const g = m.gates[i];
      const cx0 = g.baseX + g.w * 0.5;
      const cy0 = g.baseY + g.h * 0.5;
      const cx1 = cx0 + g.openOffsetX;
      const cy1 = cy0 + g.openOffsetY;
      this.pushSegmentRibbon(cx0, cy0, cx1, cy1, 0.075, 1, 1, 1, 1, 8, g.openProgress, 0, 0);
    }

    // 5. Cistern Sensors
    for (let i = 0; i < m.cisterns.length; i++) {
      const c = m.cisterns[i];
      const asp = c.w / Math.max(c.h, 0.01);
      this.pushAxisRect(c.x, c.y, c.w, c.h, 1, 1, 1, 1, 3, c.fillRatio, c.activated ? 1 : 0, asp);
    }

    // 6. Relic Goals / Sanctuary Altars
    for (let i = 0; i < m.goals.length; i++) {
      const g = m.goals[i];
      const asp = g.w / Math.max(g.h, 0.01);
      this.pushAxisRect(g.x, g.y, g.w, g.h, 1, 1, 1, 1, 4, g.fulfilled ? 1 : 0, g.pulse, asp);
    }

    // 7. Magma Vents
    for (let i = 0; i < m.magmaVents.length; i++) {
      const mv = m.magmaVents[i];
      const heatRatio = Math.max(0, Math.min(1, mv.heat / Math.max(mv.maxHeat, 0.001)));
      const asp = mv.w / Math.max(mv.h, 0.01);
      this.pushAxisRect(
        mv.x,
        mv.y,
        mv.w,
        mv.h,
        mv.goalQuench ? 1 : 0,
        0,
        0,
        asp,
        5,
        heatRatio,
        mv.quenched ? 1 : 0,
        mv.steamPulse
      );
    }

    // 8. Cracked Basalt Walls (only while unbroken)
    const wallTintR = theme.rockTint[0] * 0.88;
    const wallTintG = theme.rockTint[1] * 0.88;
    const wallTintB = theme.rockTint[2] * 0.88;
    for (let i = 0; i < m.crackedWalls.length; i++) {
      const w = m.crackedWalls[i];
      if (w.broken) continue;
      const damage = 1.0 - Math.max(0, Math.min(1, w.hp / Math.max(w.maxHp, 0.001)));
      const asp = w.w / Math.max(w.h, 0.01);
      this.pushAxisRect(
        w.x,
        w.y,
        w.w,
        w.h,
        wallTintR,
        wallTintG,
        wallTintB,
        1,
        6,
        damage,
        w.stressGlow,
        asp
      );
    }

    // 9. Sluice Gates
    for (let i = 0; i < m.gates.length; i++) {
      const g = m.gates[i];
      const asp = g.w / Math.max(g.h, 0.01);
      this.pushAxisRect(g.x, g.y, g.w, g.h, 1, 1, 1, 1, 7, g.openProgress, g.isOpen ? 1 : 0, asp);
    }

    // 10. Hydro-Portals (Amber-Gold Entry + Cyan-Aqua Exit Ring + Directional Exit Beam)
    for (let i = 0; i < portals.length; i++) {
      const p = portals[i];
      const ringSize = Math.max(0.40, p.radius * 2.85);
      // Entry vortex ring
      this.pushRotatedRect(p.inX, p.inY, ringSize, ringSize, 0, 1, 1, 1, 1, 14, p.pulse, 0, 0);

      // Exit directional nozzle beam (behind exit ring)
      const dirLen = Math.hypot(p.outDirX, p.outDirY) || 1;
      const dx = p.outDirX / dirLen;
      const dy = p.outDirY / dirLen;
      const outAngle = Math.atan2(dy, dx);
      const beamLen = Math.max(0.8, p.radius * 3.1);
      const beamW = Math.max(0.45, p.radius * 2.1);
      const bx = p.outX + dx * (beamLen * 0.5);
      const by = p.outY + dy * (beamLen * 0.5);
      this.pushRotatedRect(bx, by, beamLen, beamW, outAngle, 1, 1, 1, 1, 16, p.pulse, p.boost, 0);

      // Exit vortex ring
      this.pushRotatedRect(p.outX, p.outY, ringSize, ringSize, 0, 1, 1, 1, 1, 15, p.pulse, 0, 0);
    }

    // 11. Geyser Pumps (Animated Cyan Plume Cone + Bronze Directional Nozzle Housing)
    for (let i = 0; i < pumps.length; i++) {
      const pump = pumps[i];
      const dirLen = Math.hypot(pump.dirX, pump.dirY) || 1;
      const dx = pump.dirX / dirLen;
      const dy = pump.dirY / dirLen;
      const angle = Math.atan2(dy, dx);
      const activeFloat = pump.active ? 1.0 : 0.0;

      if (pump.power > 0.01) {
        const range = Math.max(0.3, pump.range);
        const coneH = Math.max(0.36, pump.radius * 2.7);
        const cx = pump.x + dx * (range * 0.5);
        const cy = pump.y + dy * (range * 0.5);
        this.pushRotatedRect(cx, cy, range, coneH, angle, 1, 1, 1, 1, 24, pump.power, activeFloat, range);
      }

      const nozzleW = Math.max(0.46, pump.radius * 2.4);
      const nozzleH = Math.max(0.38, pump.radius * 2.1);
      this.pushRotatedRect(pump.x, pump.y, nozzleW, nozzleH, angle, 1, 1, 1, 1, 25, pump.power, activeFloat, 0);
    }

    // 12. Hydro-Relay Copper/Cyan Tesla Electrode Pylons
    for (let i = 0; i < relays.length; i++) {
      const r = relays[i];
      const pylonD = Math.max(0.42, r.radius * 2.25);
      const activeFloat = r.active ? 1.0 : 0.0;
      const objFloat = r.isObjective ? 1.0 : 0.0;
      this.pushRotatedRect(r.ax, r.ay, pylonD, pylonD, 0, 1, 1, 1, 1, 23, r.charge, activeFloat, objFloat);
      this.pushRotatedRect(r.bx, r.by, pylonD, pylonD, 0, 1, 1, 1, 1, 23, r.charge, activeFloat, objFloat);
    }

    // 13. Hydraulic Seesaws (Rotated Basalt-Brass Rocker Plank + Golden Fulcrum Pivot Hub)
    for (let i = 0; i < seesaws.length; i++) {
      const s = seesaws[i];
      const asp = s.length / Math.max(s.thickness, 0.02);
      this.pushRotatedRect(
        s.x,
        s.y,
        s.length,
        s.thickness,
        s.angle,
        wallTintR,
        wallTintG,
        wallTintB,
        1,
        18,
        0,
        0,
        asp
      );
      const hubD = Math.max(s.thickness * 1.9, 0.30);
      this.pushRotatedRect(s.x, s.y, hubD, hubD, s.angle * 0.5, 1, 1, 1, 1, 19, 0, 0, 0);
    }

    // 14. Interactive Diverter Valves (Rotated Bronze Vane + Luminous #5eead4 / #fcd34d Hub Button)
    for (let i = 0; i < valves.length; i++) {
      const v = valves[i];
      const asp = v.length / Math.max(v.thickness, 0.02);
      const toggledFloat = v.toggled ? 1.0 : 0.0;
      this.pushRotatedRect(v.x, v.y, v.length, v.thickness, v.angle, 1, 1, 1, 1, 20, toggledFloat, 0, asp);
      const hubD = Math.max(v.thickness * 2.5, 0.42);
      this.pushRotatedRect(v.x, v.y, hubD, hubD, 0, 1, 1, 1, 1, 21, toggledFloat, 0, 0);
    }

    // 15. Brass Hydro-Turbines (Stationary charge gauge arc + Rotating 6-paddle wheel)
    for (let i = 0; i < m.turbines.length; i++) {
      const t = m.turbines[i];
      const chargeRatio = Math.max(0, Math.min(1, t.charge / Math.max(t.targetCharge, 0.001)));
      const completed = t.completed ? 1.0 : 0.0;

      const gaugeSize = t.radius * 2.48;
      this.pushRotatedRect(t.x, t.y, gaugeSize, gaugeSize, 0, 1, 1, 1, 1, 13, chargeRatio, completed, 0);

      const wheelSize = t.radius * 2.08;
      this.pushRotatedRect(t.x, t.y, wheelSize, wheelSize, t.angle, 1, 1, 1, 1, 9, chargeRatio, completed, 0);
    }

    // 16. Floating Hydro-Mines (only while !detonated)
    for (let i = 0; i < mines.length; i++) {
      const mine = mines[i];
      if (mine.detonated) continue;
      const mineD = Math.max(0.24, mine.radius * 2.56);
      this.pushRotatedRect(
        mine.x,
        mine.y,
        mineD,
        mineD,
        mine.angle,
        1,
        1,
        1,
        1,
        17,
        mine.flash,
        mine.submergedRatio,
        0
      );
    }

    // 17. Buoyant Relic Arks & Relic Spheres
    for (let i = 0; i < m.bodies.length; i++) {
      const b = m.bodies[i];
      const inGoal = b.inGoal ? 1.0 : 0.0;
      if (b.kind === 'ark') {
        const asp = b.w / Math.max(b.h, 0.01);
        this.pushRotatedRect(
          b.x,
          b.y,
          b.w * 1.08,
          b.h * 1.18,
          b.angle,
          1,
          1,
          1,
          1,
          10,
          inGoal,
          b.submergedRatio,
          asp
        );
      } else {
        const d = Math.max(b.w, b.h) * 1.16;
        this.pushRotatedRect(b.x, b.y, d, d, b.angle, 1, 1, 1, 1, 11, inGoal, b.submergedRatio, 0);
      }
    }

    // 18. Aqueduct Spout Fountain Heads
    for (let i = 0; i < m.spouts.length; i++) {
      const s = m.spouts[i];
      const len = Math.hypot(s.dirX, s.dirY) || 1;
      const dx = s.dirX / len;
      const dy = s.dirY / len;
      const angle = Math.atan2(dy, dx);
      const w = Math.max(0.38, s.radius * 3.0);
      const h = Math.max(0.26, s.radius * 2.3);
      const cx = s.x - dx * (w * 0.36);
      const cy = s.y - dy * (w * 0.36);
      this.pushRotatedRect(cx, cy, w, h, angle, 1, 1, 1, 1, 12, s.enabled ? 1 : 0, 0, 0);
    }
  }

  private pushConduitPath(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    chargeRatio: number,
    active: number
  ): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const halfW = 0.055;
    if (Math.abs(dx) > 0.35 && Math.abs(dy) > 0.35) {
      // Architectural L-elbow conduit with flush mitered corner overlap
      const sx = dx >= 0 ? halfW * 0.5 : -halfW * 0.5;
      this.pushSegmentRibbon(x0, y0, x1 + sx, y0, halfW, 1, 1, 1, 1, 2, chargeRatio, active, Math.abs(dx));
      this.pushSegmentRibbon(x1, y0, x1, y1, halfW, 1, 1, 1, 1, 2, chargeRatio, active, Math.abs(dy));
    } else {
      const segLen = Math.hypot(dx, dy);
      this.pushSegmentRibbon(x0, y0, x1, y1, halfW, 1, 1, 1, 1, 2, chargeRatio, active, segLen);
    }
  }

  private pushSegmentRibbon(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    halfThickness: number,
    r: number,
    g: number,
    b: number,
    a: number,
    kind: number,
    p1: number,
    p2: number,
    p3: number
  ): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return;
    const nx = (-dy / len) * halfThickness;
    const ny = (dx / len) * halfThickness;
    this.pushQuad(
      x0 - nx, y0 - ny, 0, 0,
      x1 - nx, y1 - ny, 1, 0,
      x1 + nx, y1 + ny, 1, 1,
      x0 + nx, y0 + ny, 0, 1,
      r, g, b, a,
      kind, p1, p2, p3
    );
  }

  private pushAxisRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    g: number,
    b: number,
    a: number,
    kind: number,
    p1: number,
    p2: number,
    p3: number
  ): void {
    this.pushQuad(
      x, y, 0, 0,
      x + w, y, 1, 0,
      x + w, y + h, 1, 1,
      x, y + h, 0, 1,
      r, g, b, a,
      kind, p1, p2, p3
    );
  }

  private pushRotatedRect(
    cx: number,
    cy: number,
    w: number,
    h: number,
    angle: number,
    r: number,
    g: number,
    b: number,
    a: number,
    kind: number,
    p1: number,
    p2: number,
    p3: number
  ): void {
    const hw = w * 0.5;
    const hh = h * 0.5;
    const c = Math.cos(angle);
    const s = Math.sin(angle);

    const x0 = cx + (-hw * c - -hh * s);
    const y0 = cy + (-hw * s + -hh * c);
    const x1 = cx + (hw * c - -hh * s);
    const y1 = cy + (hw * s + -hh * c);
    const x2 = cx + (hw * c - hh * s);
    const y2 = cy + (hw * s + hh * c);
    const x3 = cx + (-hw * c - hh * s);
    const y3 = cy + (-hw * s + hh * c);

    this.pushQuad(
      x0, y0, 0, 0,
      x1, y1, 1, 0,
      x2, y2, 1, 1,
      x3, y3, 0, 1,
      r, g, b, a,
      kind, p1, p2, p3
    );
  }

  private pushQuad(
    x0: number, y0: number, u0: number, v0: number,
    x1: number, y1: number, u1: number, v1: number,
    x2: number, y2: number, u2: number, v2: number,
    x3: number, y3: number, u3: number, v3: number,
    r: number, g: number, b: number, a: number,
    kind: number, p1: number, p2: number, p3: number
  ): void {
    const needed = (this.mechVertexCount + 6) * MECH_FLOATS_PER_VERTEX;
    if (needed > this.mechData.length) {
      const next = new Float32Array(Math.max(this.mechData.length * 2, needed));
      next.set(this.mechData);
      this.mechData = next;
    }

    let idx = this.mechVertexCount * MECH_FLOATS_PER_VERTEX;
    const d = this.mechData;

    // Triangle 1: (0, 1, 2)
    idx = this.writeMechVert(d, idx, x0, y0, u0, v0, r, g, b, a, kind, p1, p2, p3);
    idx = this.writeMechVert(d, idx, x1, y1, u1, v1, r, g, b, a, kind, p1, p2, p3);
    idx = this.writeMechVert(d, idx, x2, y2, u2, v2, r, g, b, a, kind, p1, p2, p3);
    // Triangle 2: (0, 2, 3)
    idx = this.writeMechVert(d, idx, x0, y0, u0, v0, r, g, b, a, kind, p1, p2, p3);
    idx = this.writeMechVert(d, idx, x2, y2, u2, v2, r, g, b, a, kind, p1, p2, p3);
    this.writeMechVert(d, idx, x3, y3, u3, v3, r, g, b, a, kind, p1, p2, p3);

    this.mechVertexCount += 6;
  }

  private writeMechVert(
    d: Float32Array,
    idx: number,
    x: number, y: number, u: number, v: number,
    r: number, g: number, b: number, a: number,
    kind: number, p1: number, p2: number, p3: number
  ): number {
    d[idx] = x;
    d[idx + 1] = y;
    d[idx + 2] = u;
    d[idx + 3] = v;
    d[idx + 4] = r;
    d[idx + 5] = g;
    d[idx + 6] = b;
    d[idx + 7] = a;
    d[idx + 8] = kind;
    d[idx + 9] = p1;
    d[idx + 10] = p2;
    d[idx + 11] = p3;
    return idx + 12;
  }

  // ===========================================================================
  // Instanced Airborne Particle Passes (Steam, Spray, Debris)
  // ===========================================================================

  private renderSteam(time: number, fluid: IFluidEngine, theme: LevelTheme): void {
    const count = Math.min(fluid.numSteam, fluid.stx.length);
    if (count <= 0) return;

    const gl = this.gl;
    if (count > this.steamCapacity) {
      this.steamCapacity = count;
      this.steamData = new Float32Array(count * STEAM_FLOATS_PER_INST);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.steamInstVBO);
      gl.bufferData(gl.ARRAY_BUFFER, this.steamData.byteLength, gl.DYNAMIC_DRAW);
    }

    const d = this.steamData;
    for (let i = 0; i < count; i++) {
      const o = i * STEAM_FLOATS_PER_INST;
      d[o] = fluid.stx[i];
      d[o + 1] = fluid.sty[i];
      d[o + 2] = fluid.stvx[i];
      d[o + 3] = fluid.stvy[i];
      d[o + 4] = fluid.stlife[i];
      d[o + 5] = fluid.stmaxLife[i];
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.steamInstVBO);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.subarray(0, count * STEAM_FLOATS_PER_INST));

    gl.useProgram(this.steamProg.program);
    const u = this.steamProg.uniforms;
    gl.uniform2f(u.uWorldSize, WORLD_W, WORLD_H);
    gl.uniform1f(u.uTime, time);
    gl.uniform3fv(u.uSunColor, theme.sunColor);

    gl.bindVertexArray(this.steamVAO);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  }

  private renderSpray(fluid: IFluidEngine, theme: LevelTheme): void {
    const count = Math.min(fluid.numSpray, fluid.spx.length);
    if (count <= 0) return;

    const gl = this.gl;
    if (count > this.sprayCapacity) {
      this.sprayCapacity = count;
      this.sprayData = new Float32Array(count * SPRAY_FLOATS_PER_INST);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sprayInstVBO);
      gl.bufferData(gl.ARRAY_BUFFER, this.sprayData.byteLength, gl.DYNAMIC_DRAW);
    }

    const d = this.sprayData;
    for (let i = 0; i < count; i++) {
      const o = i * SPRAY_FLOATS_PER_INST;
      d[o] = fluid.spx[i];
      d[o + 1] = fluid.spy[i];
      d[o + 2] = fluid.svx[i];
      d[o + 3] = fluid.svy[i];
      d[o + 4] = fluid.slife[i];
      d[o + 5] = fluid.smaxLife[i];
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.sprayInstVBO);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.subarray(0, count * SPRAY_FLOATS_PER_INST));

    gl.useProgram(this.sprayProg.program);
    const u = this.sprayProg.uniforms;
    gl.uniform2f(u.uWorldSize, WORLD_W, WORLD_H);
    gl.uniform3fv(u.uWaterShallow, theme.waterShallow);
    gl.uniform3fv(u.uSunColor, theme.sunColor);

    gl.bindVertexArray(this.sprayVAO);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  }

  private renderDebris(mechanisms: MechanismSnapshot, theme: LevelTheme): void {
    const debris = mechanisms.debris;
    const count = debris.length;
    if (count <= 0) return;

    const gl = this.gl;
    if (count > this.debrisCapacity) {
      this.debrisCapacity = count;
      this.debrisData = new Float32Array(count * DEBRIS_FLOATS_PER_INST);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.debrisInstVBO);
      gl.bufferData(gl.ARRAY_BUFFER, this.debrisData.byteLength, gl.DYNAMIC_DRAW);
    }

    const d = this.debrisData;
    for (let i = 0; i < count; i++) {
      const chunk = debris[i];
      const o = i * DEBRIS_FLOATS_PER_INST;
      d[o] = chunk.x;
      d[o + 1] = chunk.y;
      d[o + 2] = chunk.angle;
      d[o + 3] = chunk.size;
      d[o + 4] = chunk.life;
      d[o + 5] = chunk.maxLife;
      d[o + 6] = chunk.kind === 'rock' ? 0 : chunk.kind === 'ice' ? 1 : 2;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.debrisInstVBO);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.subarray(0, count * DEBRIS_FLOATS_PER_INST));

    gl.useProgram(this.debrisProg.program);
    const u = this.debrisProg.uniforms;
    gl.uniform2f(u.uWorldSize, WORLD_W, WORLD_H);
    gl.uniform3fv(u.uRockTint, theme.rockTint);
    gl.uniform3fv(u.uSunColor, theme.sunColor);

    gl.bindVertexArray(this.debrisVAO);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  }

  // ===========================================================================
  // Low-Level WebGL2 Resource Helpers
  // ===========================================================================

  private createProgram(
    vsSource: string,
    fsSource: string,
    uniformNames: string[]
  ): CompiledProgram {
    const gl = this.gl;
    const vs = this.compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSource);

    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      throw new Error('Failed to create WebGL2 shader program.');
    }

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) || 'Unknown program link error';
      gl.deleteProgram(program);
      throw new Error(`WebGL2 program link failed: ${info}`);
    }

    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of uniformNames) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }

    return { program, uniforms };
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) {
      throw new Error('Failed to create WebGL2 shader.');
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) || 'Unknown shader compile error';
      gl.deleteShader(shader);
      throw new Error(`WebGL2 shader compile failed: ${info}`);
    }
    return shader;
  }

  private bindAttrib(
    program: WebGLProgram,
    name: string,
    size: number,
    stride: number,
    offset: number
  ): void {
    const gl = this.gl;
    const loc = gl.getAttribLocation(program, name);
    if (loc < 0) return;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
  }

  private setupInstancedVAO(
    program: WebGLProgram,
    instVBO: WebGLBuffer,
    stride: number,
    attribs: Array<{ name: string; size: number; offset: number }>
  ): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = this.requireVAO();
    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instQuadVBO);
    const cornerLoc = gl.getAttribLocation(program, 'aCorner');
    if (cornerLoc >= 0) {
      gl.enableVertexAttribArray(cornerLoc);
      gl.vertexAttribPointer(cornerLoc, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(cornerLoc, 0);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, instVBO);
    for (const a of attribs) {
      const loc = gl.getAttribLocation(program, a.name);
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, a.size, gl.FLOAT, false, stride, a.offset);
        gl.vertexAttribDivisor(loc, 1);
      }
    }

    return vao;
  }

  private requireBuffer(): WebGLBuffer {
    const buf = this.gl.createBuffer();
    if (!buf) throw new Error('Failed to create WebGL2 buffer.');
    return buf;
  }

  private requireVAO(): WebGLVertexArrayObject {
    const vao = this.gl.createVertexArray();
    if (!vao) throw new Error('Failed to create WebGL2 VAO.');
    return vao;
  }
}
