import type * as THREE from 'three';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export type QualityChoice = QualityLevel | 'auto';

export const QUALITY_LEVELS: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

export interface QualityConfig {
  level: QualityLevel;
  /** Upper bound for the canvas backing-store pixel ratio. */
  maxPixelRatio: number;
  /** Desired internal render resolution in pixels per CSS pixel (supersampling when above the canvas ratio). */
  targetScale: number;
  /** Hard cap on internally rendered pixels (protects GPU memory on very large displays). */
  maxInternalPixels: number;
  /**
   * Dynamic resolution: when the smoothed frame time stays above the budget, the internal resolution drops
   * step by step down to this fraction of the level's normal resolution (linear), and climbs back when
   * there is headroom. 1 disables it.
   */
  minResolutionScale: number;
  /** MSAA samples of the HDR scene target on ordinary-density screens (0 = off). */
  msaa: number;
  /** MSAA samples when the canvas pixel ratio is ≥ 1.75 (retina): dense pixels need less. */
  msaaHighDensity: number;
  /** Post anti-aliasing when the image is not supersampled. */
  fxaa: boolean;
  ambientOcclusion: boolean;
  /** AO buffer resolution relative to the internal resolution, and its absolute pixel cap. */
  aoScale: number;
  aoMaxPixels: number;
  bloom: boolean;
  /** Shadow-map resolution per cascade (near → far). */
  shadowMapSizes: [number, number, number, number];
  /** Half extent (m) of the outermost shadow cascade. */
  shadowFarRadius: number;
  /** While the view moves the near cascade is re-rendered every n-th frame. */
  shadowNearEveryNFrames: number;
  /** While nothing moves the near cascade is refreshed this often (s). */
  shadowNearIdleInterval: number;
  /** Casters smaller than this many shadow texels are skipped in the outer cascades. */
  shadowCasterCullTexels: number;
  /** Base ray-march steps of the cloud panorama and its width in pixels (height = width / 6). */
  cloudSteps: number;
  cloudPanoramaWidth: number;
}

export const QUALITY_CONFIGS: Record<QualityLevel, QualityConfig> = {
  low: {
    level: 'low',
    maxPixelRatio: 1.5,
    targetScale: 1,
    maxInternalPixels: 2_300_000,
    minResolutionScale: 0.6,
    msaa: 0,
    msaaHighDensity: 0,
    fxaa: true,
    ambientOcclusion: false,
    aoScale: 0.5,
    aoMaxPixels: 400_000,
    bloom: true,
    shadowMapSizes: [1024, 1024, 1024, 1024],
    shadowFarRadius: 520,
    shadowNearEveryNFrames: 2,
    shadowNearIdleInterval: 0.6,
    shadowCasterCullTexels: 2.5,
    cloudSteps: 32,
    cloudPanoramaWidth: 2048,
  },
  medium: {
    level: 'medium',
    maxPixelRatio: 1.5,
    targetScale: 1.25,
    maxInternalPixels: 3_000_000,
    minResolutionScale: 0.7,
    msaa: 2,
    msaaHighDensity: 0,
    fxaa: true,
    ambientOcclusion: true,
    aoScale: 0.5,
    aoMaxPixels: 500_000,
    bloom: true,
    shadowMapSizes: [2048, 2048, 1024, 1024],
    shadowFarRadius: 640,
    shadowNearEveryNFrames: 1,
    shadowNearIdleInterval: 0.35,
    shadowCasterCullTexels: 1.6,
    cloudSteps: 48,
    cloudPanoramaWidth: 4096,
  },
  high: {
    level: 'high',
    maxPixelRatio: 2,
    targetScale: 1.5,
    maxInternalPixels: 6_200_000,
    minResolutionScale: 0.7,
    msaa: 4,
    msaaHighDensity: 0,
    fxaa: true,
    ambientOcclusion: true,
    aoScale: 0.5,
    aoMaxPixels: 800_000,
    bloom: true,
    shadowMapSizes: [2048, 2048, 2048, 2048],
    shadowFarRadius: 760,
    shadowNearEveryNFrames: 1,
    shadowNearIdleInterval: 0.2,
    shadowCasterCullTexels: 1.1,
    cloudSteps: 64,
    cloudPanoramaWidth: 6144,
  },
  ultra: {
    level: 'ultra',
    maxPixelRatio: 2,
    targetScale: 2,
    maxInternalPixels: 9_500_000,
    minResolutionScale: 0.8,
    msaa: 4,
    msaaHighDensity: 4,
    fxaa: true,
    ambientOcclusion: true,
    aoScale: 0.5,
    aoMaxPixels: 1_600_000,
    bloom: true,
    shadowMapSizes: [4096, 4096, 2048, 2048],
    shadowFarRadius: 760,
    shadowNearEveryNFrames: 1,
    shadowNearIdleInterval: 0.1,
    shadowCasterCullTexels: 1.0,
    cloudSteps: 96,
    cloudPanoramaWidth: 8192,
  },
};

const STORAGE_KEY = 'kindenheim3d.quality';

export function isQualityChoice(v: unknown): v is QualityChoice {
  return v === 'auto' || v === 'low' || v === 'medium' || v === 'high' || v === 'ultra';
}

/** Reads the user's stored choice. `?quality=<level>` in the URL wins (handy for tests and benchmarks). */
export function loadQualityChoice(): QualityChoice {
  const fromUrl = new URLSearchParams(window.location.search).get('quality');
  if (fromUrl !== null) {
    if (!isQualityChoice(fromUrl)) {
      throw new Error(`[Quality] Invalid ?quality=${fromUrl}. Use one of: auto, low, medium, high, ultra.`);
    }
    return fromUrl;
  }
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    // Storage can be blocked (private mode / sandboxed iframe); the setting is simply not persisted then.
    console.info('[Quality] localStorage not available, using automatic quality.', err);
    return 'auto';
  }
  return isQualityChoice(stored) ? stored : 'auto';
}

export function storeQualityChoice(choice: QualityChoice): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch (err) {
    console.info('[Quality] Could not persist quality choice (localStorage blocked).', err);
  }
}

export function getGpuName(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return String(name ?? '');
}

/**
 * Picks a default quality level from what the browser reveals about the device.
 * Conservative on phones / integrated GPUs, generous on Apple Silicon and discrete GPUs.
 */
export function detectQualityLevel(renderer: THREE.WebGLRenderer): QualityLevel {
  const gpu = getGpuName(renderer).toLowerCase();
  const ua = navigator.userAgent.toLowerCase();
  const isMobile = /android|iphone|ipad|ipod|mobile/.test(ua) || (navigator.maxTouchPoints > 1 && /macintosh/.test(ua));
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;

  if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) return 'low';
  if (isMobile) return cores >= 6 && memory >= 6 ? 'medium' : 'low';
  if (/apple m\d|apple gpu/.test(gpu)) {
    // Apple Silicon: Max/Ultra/Pro chips (and every M-series with ≥ 10 cores) comfortably run "high".
    return cores >= 8 ? 'high' : 'medium';
  }
  if (/rtx|radeon rx (6|7|9)\d{3}|radeon pro|geforce gtx (1[06-9]|9[78])\d|arc\(tm\) a\d|quadro/.test(gpu)) return 'high';
  if (/geforce|radeon|nvidia|amd/.test(gpu)) return 'medium';
  if (/iris\(r\) xe|iris xe|iris plus|iris pro/.test(gpu)) return 'medium';
  if (/intel/.test(gpu)) return 'low';
  return memory >= 8 && cores >= 8 ? 'medium' : 'low';
}

export function resolveQuality(choice: QualityChoice, renderer: THREE.WebGLRenderer): QualityConfig {
  const level = choice === 'auto' ? detectQualityLevel(renderer) : choice;
  return QUALITY_CONFIGS[level];
}
