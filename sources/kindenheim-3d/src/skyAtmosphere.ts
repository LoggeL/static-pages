import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Physically based sky for Kindenheim 3D.
 *
 *  - Atmosphere: single scattering (Rayleigh + Mie + ozone absorption) ray-marched on the GPU into a small
 *    "sky-view" lookup texture whenever the sun or the haze changes, plus an isotropic multiple-scattering
 *    term. The same LUT feeds the sky dome, the image-based lighting and the aerial-perspective pass, so
 *    distant terrain fades into exactly the colour the sky has at the horizon in that direction.
 *  - Clouds: a ray-marched cumulus slab (tileable Perlin-Worley noise texture) lit by the sun colour that
 *    actually reaches cloud altitude, with self-shadowing towards the sun, plus a thin cirrus sheet.
 *
 * All radiances are "scene referred": the caller passes the (exposure-normalised) solar irradiance.
 */

// ── Atmosphere constants (kilometres) ─────────────────────────────────────────────────────────────
const RG_KM = 6360.0;
const RT_KM = 6460.0;
const HR_KM = 8.0;
const HM_KM = 1.2;
const BETA_R = [5.802e-3, 13.558e-3, 33.1e-3] as const; // Rayleigh scattering per km at sea level
const BETA_O = [0.65e-3, 1.881e-3, 0.085e-3] as const; // ozone absorption per km at layer centre
const MIE_EXT_RATIO = 1.11; // extinction / scattering for continental aerosol
/** Altitude of the observer used for the LUT (Kindenheim lies ≈ 160–260 m above sea level). */
export const OBSERVER_ALT_KM = 0.22;
export const CLOUD_BASE_KM = 1.35;
export const CLOUD_TOP_KM = 2.25;
export const CIRRUS_ALT_KM = 10.5;

export const SKY_LUT_WIDTH = 256;
export const SKY_LUT_HEIGHT = 256;
/** The cloud panorama is refreshed in this many vertical strips, one per frame. */
const CLOUD_STRIPS = 24;

const TMP_V2 = new THREE.Vector2();

/** Azimuth bins of the outer ground edge height table (uEdgeH). */
export const EDGE_BINS = 64;

/** Rayleigh scattering coefficients per metre (used by the aerial-perspective pass). */
export const BETA_RAYLEIGH_PER_M = new THREE.Vector3(BETA_R[0] * 1e-3, BETA_R[1] * 1e-3, BETA_R[2] * 1e-3);

/**
 * Transmittance of the atmosphere from `altKm` towards a direction with the given sine of elevation,
 * including a soft planet shadow. CPU twin of the GLSL below (used for sun / cloud light colours).
 */
export function atmosphereTransmittance(
  altKm: number,
  sinElevation: number,
  mieScatterPerKm: number,
  ozone: number
): THREE.Vector3 {
  const r0 = RG_KM + altKm;
  const mu = THREE.MathUtils.clamp(sinElevation, -1, 1);
  let visibility = 1.0;
  if (mu < 0) {
    const closest = r0 * Math.sqrt(Math.max(0, 1 - mu * mu));
    visibility = THREE.MathUtils.smoothstep(closest, RG_KM - 0.4, RG_KM + 0.6);
  }
  if (visibility <= 0) return new THREE.Vector3(0, 0, 0);
  const disc = r0 * r0 * (mu * mu - 1) + RT_KM * RT_KM;
  const tTop = -r0 * mu + Math.sqrt(Math.max(0, disc));
  const steps = 64;
  const dt = tTop / steps;
  let odR = 0;
  let odM = 0;
  let odO = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * dt;
    const r = Math.sqrt(r0 * r0 + t * t + 2 * r0 * t * mu);
    const h = Math.max(0, r - RG_KM);
    odR += Math.exp(-h / HR_KM) * dt;
    odM += Math.exp(-h / HM_KM) * dt;
    odO += Math.max(0, 1 - Math.abs(h - 25) / 15) * dt;
  }
  const mieExt = mieScatterPerKm * MIE_EXT_RATIO;
  return new THREE.Vector3(
    Math.exp(-(BETA_R[0] * odR + mieExt * odM + BETA_O[0] * ozone * odO)) * visibility,
    Math.exp(-(BETA_R[1] * odR + mieExt * odM + BETA_O[1] * ozone * odO)) * visibility,
    Math.exp(-(BETA_R[2] * odR + mieExt * odM + BETA_O[2] * ozone * odO)) * visibility
  );
}

/** GLSL helper shared by every shader that reads the sky-view LUT. Needs `uniform sampler2D uSkyLUT;`. */
export const SKY_LUT_SAMPLE_GLSL = /* glsl */ `
  #define KH_LUT_H ${SKY_LUT_HEIGHT.toFixed(1)}
  // xyz = radiance, w = transmittance towards the ground hit (0 for rays that leave the atmosphere)
  vec4 khSkyLut(vec3 d) {
    float az = atan(d.z, d.x);
    float el = asin(clamp(d.y, -1.0, 1.0));
    float s = sqrt(abs(el) * 0.63661977);
    float halfSpan = 0.5 - 1.0 / KH_LUT_H;
    float v = el >= 0.0 ? 0.5 + 0.5 / KH_LUT_H + s * halfSpan : 0.5 - 0.5 / KH_LUT_H - s * halfSpan;
    return texture2D(uSkyLUT, vec2(az * 0.15915494 + 0.5, v));
  }
`;

/**
 * Aerial perspective shared by the post pass (scene geometry) and the sky dome (the endless ground plane
 * beyond the terrain). Needs the uniforms declared in AERIAL_UNIFORMS_GLSL and khSkyLut().
 */
export const AERIAL_GLSL = /* glsl */ `
  uniform vec3 uBetaR;        // Rayleigh scattering per metre
  uniform float uMieExt;      // haze extinction per metre at ground level
  uniform float uHazeH;       // haze scale height (m)
  uniform float uMistExt;     // low ground-mist extinction per metre
  uniform float uMistH;       // mist scale height (m)
  uniform float uFogGroundY;  // reference ground level (scene Y)
  uniform float uFogAmount;

  // optical depth of an exponential medium along a segment of length dist that climbs dy
  float khOpticalDepth(float y0, float dy, float dist, float H) {
    float a = dy / H;
    float f = abs(a) < 1e-3 ? 1.0 - a * 0.5 : (1.0 - exp(-a)) / a;
    return dist * exp(-max(y0, -H) / H) * f;
  }

  // col: radiance of the surface at distance dist (m) along dir, seen from height camY (scene Y)
  vec3 khAerialPerspective(vec3 col, vec3 dir, float dist, float camY) {
    float y0 = camY - uFogGroundY;
    float dy = dir.y * dist;
    vec3 tauR = uBetaR * khOpticalDepth(y0 + 200.0, dy, dist, 8000.0);
    float tauM = uMieExt * khOpticalDepth(y0, dy, dist, uHazeH) + uMistExt * khOpticalDepth(y0, dy, dist, uMistH);
    vec3 TR = exp(-tauR * uFogAmount);
    float TM = exp(-tauM * uFogAmount);
    // In-scattered light: haze converges to the horizon colour of that azimuth, air to a bluer sky tone over
    // the first kilometres. Over very long paths (far terrain ring, the plain beyond it) the air light also
    // saturates towards the horizon colour - otherwise the far land reads as a dark blue sea under a pale sky.
    vec3 hazeDir = normalize(vec3(dir.x, 0.003 + max(dir.y, 0.0) * 0.5, dir.z));
    float airElev = mix(0.42, hazeDir.y, smoothstep(2500.0, 16000.0, dist));
    vec3 airDir = normalize(vec3(dir.x, airElev, dir.z));
    vec3 inHaze = khSkyLut(hazeDir).rgb;
    vec3 inAir = khSkyLut(airDir).rgb;
    return col * TR * TM + inAir * (1.0 - TR) * TM + inHaze * (1.0 - TM);
  }

  uniform vec3 uPlainRadiance;  // mean radiance of the outermost real ground under the current light
  // x = where real ground starts to dissolve, y = where it is gone (m from the map centre); z = 1: measured as
  // radial distance (round far terrain ring), 0: per axis (the square map itself)
  uniform vec3 uWorldEdge;
  // The land beyond the modelled ground continues the far ring's own aerial photo (mirrored), at the height
  // of the ring's outer edge in that direction, on a curved Earth.
  uniform sampler2D uPlainTex;
  uniform vec4 uPlainInfo;      // x = photo side (m), y = 1 if the photo is set, z = outer edge radius (m), w = pixel angle (rad)
  uniform float uEdgeH[${EDGE_BINS}];      // scene Y of the outer ground edge per azimuth bin

  float khEdgeHeight(vec2 xz) {
    float a = (atan(xz.y, xz.x) * 0.15915494 + 0.5) * ${EDGE_BINS}.0 - 0.5;
    int i0 = int(floor(a));
    float f = a - float(i0);
    i0 = (i0 + ${EDGE_BINS}) % ${EDGE_BINS};
    return mix(uEdgeH[i0], uEdgeH[(i0 + 1) % ${EDGE_BINS}], f);
  }

  // What lies in direction dir where no modelled ground exists, seen from cam. minDist > 0: the caller is
  // dissolving real ground at that distance (the outer fade of the far ring), so the land is taken there.
  //
  // Geometry: the ground beyond the edge (horizontal distance tE along this azimuth, height yE) is a plain at
  // yE that curves away with the Earth: y(t) = yE - (t^2 - tE^2) / 2R. A view ray that passes over the edge
  // meets it further out, ever further as it approaches the true (dipped) horizon, so the haze thickens
  // continuously from the ring's last metres to the skyline - there is no band of nearby "plain" between the
  // ring and the sky, and no seam. Beyond the ring the regional haze over the plain grows a little denser,
  // so the skyline itself is a soft, nearly vanished line, as in real summer haze.
  vec3 khBeyond(vec3 dir, vec3 cam, float minDist) {
    vec3 horizon = khSkyLut(vec3(dir.x, max(dir.y, 0.0), dir.z)).rgb;
    float c = length(dir.xz);
    if (c < 1e-4) return horizon;
    if (dir.y >= 0.0 && minDist <= 0.0) return horizon;
    vec2 d2 = dir.xz / c;
    float s = dir.y / c;                          // rise per horizontal metre
    float R = uPlainInfo.z;
    float b = dot(cam.xz, d2);
    float tE = max(-b + sqrt(max(b * b - dot(cam.xz, cam.xz) + R * R, 0.0)), 0.0);
    float yE = khEdgeHeight(cam.xz + d2 * tE);
    const float INV_2R = 1.0 / (2.0 * 6.371e6);
    // ray: cam.y + s t; ground: yE - (t^2 - tE^2) / 2R   =>   INV_2R t^2 + s t + k = 0
    float k = cam.y - yE - tE * tE * INV_2R;
    float disc = s * s - 4.0 * INV_2R * k;
    float tHit = -1.0;
    if (disc >= 0.0) {
      float sq = sqrt(disc);
      float tN = (-s - sq) / (2.0 * INV_2R);
      float tF = (-s + sq) / (2.0 * INV_2R);
      tHit = tN > 0.0 ? tN : tF;
    }
    // slope of the true skyline, and how far above it this ray runs (in pixels) -> anti-aliased sky blend
    float sH = k > 0.0 ? -sqrt(4.0 * INV_2R * k) : 0.0;
    float pa = uPlainInfo.w;
    float tMin = minDist * c;
    float t;
    float wSky;
    if (tMin > 0.0) {
      t = max(tHit > 0.0 ? tHit : tMin, tMin);
      wSky = 0.0;
    } else {
      // rays that miss the ground are evaluated at the skyline distance for a smooth blend across it
      float tSky = k > 0.0 ? sqrt(k / INV_2R) : 2.0e5;
      t = tHit > 0.0 ? min(tHit, tSky) : tSky;
      t = max(t, tE);
      wSky = smoothstep(sH - pa, sH + pa, s);
    }
    t = min(t, 2.0e5);

    vec3 rad = uPlainRadiance;
    if (uPlainInfo.y > 0.5) {
      vec2 p = cam.xz + d2 * t;
      vec2 uv = p / uPlainInfo.x + 0.5;
      uv = 1.0 - abs(1.0 - mod(uv, 2.0));      // mirrored repeat: continuous, no fold seams
      // footprint of one pixel on the ground: across the ray pa*t, along it foreshortened by the grazing angle
      float graze = max(abs(s + 2.0 * INV_2R * t), 1e-4);   // ray slope relative to the curved ground
      float foot = pa * t * max(1.0, min(1.0 / graze, 300.0));
      float texM = uPlainInfo.x / float(textureSize(uPlainTex, 0).x);
      float lod = log2(max(foot / texM, 1.0));
      vec3 tex = textureLod(uPlainTex, uv, lod).rgb;
      vec3 mean = textureLod(uPlainTex, vec2(0.5), 16.0).rgb;
      vec3 ratio = clamp(tex / max(mean, vec3(1e-4)), vec3(0.3), vec3(2.5));
      rad *= mix(vec3(1.0), ratio, 0.85);
    }
    vec3 col = khAerialPerspective(rad, dir, t / c, cam.y);
    // denser regional haze over the plain beyond the modelled ring (zero at the ring's edge: continuous)
    float tauX = max(t - max(tE, tMin), 0.0) * uMieExt * 1.3 * uFogAmount;
    vec3 hazeH = khSkyLut(normalize(vec3(dir.x, 0.003, dir.z))).rgb;
    col = mix(hazeH, col, exp(-tauX));
    return mix(col, horizon, wSky);
  }
`;

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const ATMOSPHERE_COMMON_GLSL = /* glsl */ `
  #define PI 3.14159265359
  const float RG = ${RG_KM.toFixed(1)};
  const float RT = ${RT_KM.toFixed(1)};
  const float HR = ${HR_KM.toFixed(1)};
  const float HM = ${HM_KM.toFixed(1)};
  const vec3 BR = vec3(${BETA_R[0]}, ${BETA_R[1]}, ${BETA_R[2]});
  const vec3 BO = vec3(${BETA_O[0]}, ${BETA_O[1]}, ${BETA_O[2]});
  uniform float uMie;       // Mie scattering per km at sea level
  uniform float uMieG;
  uniform float uOzone;

  vec3 khDensities(float h) {
    h = max(h, 0.0);
    return vec3(exp(-h / HR), exp(-h / HM), max(0.0, 1.0 - abs(h - 25.0) / 15.0));
  }
  float khRaySphereFar(vec3 o, vec3 d, float r) {
    float b = dot(o, d);
    float c = dot(o, o) - r * r;
    float disc = b * b - c;
    if (disc < 0.0) return -1.0;
    return -b + sqrt(disc);
  }
  float khRaySphereNear(vec3 o, vec3 d, float r) {
    float b = dot(o, d);
    float c = dot(o, o) - r * r;
    float disc = b * b - c;
    if (disc < 0.0) return -1.0;
    return -b - sqrt(disc);
  }
  vec3 khExtinction(vec3 od) {
    return exp(-(BR * od.x + vec3(uMie * ${MIE_EXT_RATIO}) * od.y + BO * uOzone * od.z));
  }
  float khSunVisibility(vec3 p, vec3 s) {
    float b = dot(p, s);
    if (b >= 0.0) return 1.0;
    float closest = sqrt(max(dot(p, p) - b * b, 0.0));
    return smoothstep(RG - 0.4, RG + 0.6, closest);
  }
  vec3 khOpticalDepthToTop(vec3 p, vec3 d) {
    float tMax = khRaySphereFar(p, d, RT);
    const int N = 10;
    vec3 sum = vec3(0.0);
    float prev = 0.0;
    for (int i = 0; i < N; i++) {
      // quadratic spacing: dense samples close to the start where the air is thick
      float u1 = float(i + 1) / float(N);
      float t1 = tMax * u1 * u1;
      float t = 0.5 * (prev + t1);
      sum += khDensities(length(p + d * t) - RG) * (t1 - prev);
      prev = t1;
    }
    return sum;
  }
`;

const SKY_LUT_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uSunDir;
  uniform vec3 uSunIrradiance;
  uniform vec3 uGroundAlbedo;
  uniform float uMsFactor;
  uniform float uAltitude;
  ${ATMOSPHERE_COMMON_GLSL}

  void main() {
    float az = (vUv.x - 0.5) * 2.0 * PI;
    float halfSpan = 0.5 - 1.0 / ${SKY_LUT_HEIGHT.toFixed(1)};
    float sgn = vUv.y >= 0.5 ? 1.0 : -1.0;
    float s = clamp((abs(vUv.y - 0.5) - 0.5 / ${SKY_LUT_HEIGHT.toFixed(1)}) / halfSpan, 0.0, 1.0);
    float el = sgn * s * s * PI * 0.5;
    vec3 dir = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));

    vec3 o = vec3(0.0, RG + uAltitude, 0.0);
    float tTop = khRaySphereFar(o, dir, RT);
    float tGround = khRaySphereNear(o, dir, RG);
    bool hitsGround = tGround > 0.0;
    float tMax = hitsGround ? tGround : tTop;

    float mu = dot(dir, uSunDir);
    float phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
    float g = uMieG;
    float g2 = g * g;
    float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
    const float phaseIso = 1.0 / (4.0 * PI);

    const int NV = 40;
    const vec3 MS_TINT = vec3(0.5, 0.82, 1.45);
    const vec3 MIE_MS = vec3(0.95, 1.0, 1.1);
    vec3 od = vec3(0.0);
    vec3 L = vec3(0.0);
    float prev = 0.0;
    for (int i = 0; i < NV; i++) {
      float u1 = float(i + 1) / float(NV);
      float t1 = tMax * u1 * u1;
      float dt = t1 - prev;
      float t = 0.5 * (prev + t1);
      prev = t1;
      vec3 p = o + dir * t;
      vec3 dens = khDensities(length(p) - RG);
      vec3 Tview = khExtinction(od + dens * dt * 0.5);
      od += dens * dt;
      float vis = khSunVisibility(p, uSunDir);
      vec3 Tsun = vis > 0.0 ? khExtinction(khOpticalDepthToTop(p, uSunDir)) * vis : vec3(0.0);
      vec3 sR = BR * dens.x;
      vec3 sM = vec3(uMie * dens.y);
      // Multiple scattering approximation: every point is also lit by the sky above it, i.e. by light that
      // has already been scattered once. Its colour is that of sunlight that came down a short path (never the
      // deep red of a grazing sun), and its strength follows the LOCAL sun elevation at that point: full by
      // day, then falling by about a factor of ten per 3.7° of depression. Because points along a view ray
      // towards the sun sit under a higher sun than points away from it, the twilight glow gathers around the
      // sun's azimuth, the opposite horizon turns blue-grey, and no direction ever goes black.
      vec3 upP = normalize(p);
      float seP = dot(upP, uSunDir);
      float sMs = max(seP, 0.2);
      vec3 hDir = uSunDir - upP * seP;
      float hLen = length(hDir);
      hDir = hLen > 1e-4 ? hDir / hLen : vec3(1.0, 0.0, 0.0);
      vec3 msDir = upP * sMs + hDir * sqrt(1.0 - sMs * sMs);
      vec3 Tms = khExtinction(khOpticalDepthToTop(p, msDir));
      float seDeg = asin(clamp(seP, -1.0, 1.0)) * 57.29578;
      float gMs = exp(0.62 * min(0.0, seDeg - 3.0));
      // Haze (Mie) is optically thick along the horizon: its light is scattered many times and comes out
      // nearly white and isotropic. Giving it the blue Rayleigh tint (and the weak single-scatter side lobe
      // only) made the last degrees above a hazy noon horizon go grey-blue and darker than the sky above.
      vec3 msSrc = sR * MS_TINT + sM * MIE_MS;
      vec3 S = Tsun * (sR * phaseR + sM * phaseM) + Tms * gMs * msSrc * phaseIso * uMsFactor;
      // Once the local sun is down, the haze is still lit by the twilight arch: reddened light arriving low
      // over the horizon from the sun's side, scattered forwards by the aerosol. This is what makes the
      // afterglow reach right down to the horizon towards the sun (and only there).
      float wGlow = 1.0 - smoothstep(-1.0, 2.0, seDeg);
      if (wGlow > 0.0) {
        vec3 lowDir = upP * 0.07 + hDir * 0.99755;
        vec3 Tlow = khExtinction(khOpticalDepthToTop(p, lowDir));
        S += Tlow * (gMs * wGlow * 1.6) * (sM * phaseM + sR * phaseR * 0.35);
      }
      L += Tview * S * dt;
    }
    L *= uSunIrradiance;

    float groundT = 0.0;
    if (hitsGround) {
      vec3 Tview = khExtinction(od);
      vec3 pg = o + dir * tGround;
      vec3 n = normalize(pg);
      float cosS = max(dot(n, uSunDir), 0.0);
      vec3 Tsun = khExtinction(khOpticalDepthToTop(pg + n * 0.001, uSunDir)) * khSunVisibility(pg + n * 0.001, uSunDir);
      L += Tview * uGroundAlbedo / PI * uSunIrradiance * Tsun * cosS;
      groundT = dot(Tview, vec3(0.3333));
    }
    gl_FragColor = vec4(max(L, vec3(0.0)), groundT);
  }
`;

/** Cosine-weighted integral of the upper LUT hemisphere → sky irradiance on a horizontal surface (1×1). */
const SKY_IRRADIANCE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uSkyLUT;
  #define PI 3.14159265359
  ${SKY_LUT_SAMPLE_GLSL}
  void main() {
    vec3 E = vec3(0.0);
    const int NA = 24;
    const int NE = 10;
    for (int j = 0; j < NE; j++) {
      float el = (float(j) + 0.5) / float(NE) * PI * 0.5;
      float w = cos(el) * sin(el) * (PI * 0.5 / float(NE)) * (2.0 * PI / float(NA));
      for (int i = 0; i < NA; i++) {
        float az = (float(i) + 0.5) / float(NA) * 2.0 * PI;
        E += khSkyLut(vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az))).rgb * w;
      }
    }
    gl_FragColor = vec4(E, 1.0);
  }
`;

const CLOUD_NOISE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  vec2 hash22(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }
  float gnoise(vec2 p, float period) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = dot(hash22(mod(i, period)) * 2.0 - 1.0, f);
    float b = dot(hash22(mod(i + vec2(1.0, 0.0), period)) * 2.0 - 1.0, f - vec2(1.0, 0.0));
    float c = dot(hash22(mod(i + vec2(0.0, 1.0), period)) * 2.0 - 1.0, f - vec2(0.0, 1.0));
    float d = dot(hash22(mod(i + vec2(1.0, 1.0), period)) * 2.0 - 1.0, f - vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float worley(vec2 p, float period) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float md = 1.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = hash22(mod(i + g, period) + 17.0);
        vec2 r = g + o - f;
        md = min(md, dot(r, r));
      }
    }
    return 1.0 - sqrt(md);
  }
  float perlinFbm(vec2 uv, float freq) {
    float a = 0.5;
    float n = 0.0;
    float s = 0.0;
    for (int i = 0; i < 6; i++) {
      n += a * gnoise(uv * freq, freq);
      s += a;
      freq *= 2.0;
      a *= 0.5;
    }
    return n / s;
  }
  float worleyFbm(vec2 uv, float freq) {
    return worley(uv * freq, freq) * 0.625 + worley(uv * freq * 2.0, freq * 2.0) * 0.25 + worley(uv * freq * 4.0, freq * 4.0) * 0.125;
  }
  void main() {
    float pf = clamp(perlinFbm(vUv, 4.0) * 1.1 + 0.5, 0.0, 1.0);
    float wf = worleyFbm(vUv, 4.0);
    float perlinWorley = wf + pf * (1.0 - wf);            // remap(perlin, 0, 1, worley, 1)
    float w8 = worleyFbm(vUv, 8.0);
    float w16 = worleyFbm(vUv, 16.0);
    float low = clamp(perlinFbm(vUv + 0.371, 3.0) * 1.25 + 0.5, 0.0, 1.0);
    gl_FragColor = vec4(perlinWorley, w8, w16, low);
  }
`;

const SKY_DOME_VERT = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vWorldDir = position;
    vec4 mv = viewMatrix * vec4(mat3(modelMatrix) * position + cameraPosition, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w;   // always on the far plane: depth == 1.0 marks "sky" for the post passes
  }
`;

/** Tileable 3D noise, rendered slice by slice into a 3D texture (uSlice = normalised depth of the slice). */
const NOISE3D_COMMON_GLSL = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uSlice;
  vec3 hash33(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453123);
  }
  float gnoise3(vec3 p, vec3 period) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float r = 0.0;
    float n[8];
    for (int k = 0; k < 8; k++) {
      vec3 o = vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
      n[k] = dot(hash33(mod(i + o, period)) * 2.0 - 1.0, f - o);
    }
    r = mix(mix(mix(n[0], n[1], u.x), mix(n[2], n[3], u.x), u.y), mix(mix(n[4], n[5], u.x), mix(n[6], n[7], u.x), u.y), u.z);
    return r;
  }
  float worley3(vec3 p, vec3 period) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    float md = 1.0;
    for (int z = -1; z <= 1; z++) {
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec3 g = vec3(float(x), float(y), float(z));
          vec3 r = g + hash33(mod(i + g, period) + 31.0) - f;
          md = min(md, dot(r, r));
        }
      }
    }
    return 1.0 - min(sqrt(md), 1.0);
  }
  float worleyFbm3(vec3 uvw, vec3 freq) {
    return worley3(uvw * freq, freq) * 0.625 + worley3(uvw * freq * 2.0, freq * 2.0) * 0.25 + worley3(uvw * freq * 4.0, freq * 4.0) * 0.125;
  }
  float perlinFbm3(vec3 uvw, vec3 freq) {
    float a = 0.5;
    float n = 0.0;
    float s = 0.0;
    for (int i = 0; i < 5; i++) {
      n += a * gnoise3(uvw * freq, freq);
      s += a;
      freq *= 2.0;
      a *= 0.5;
    }
    return n / s;
  }
`;

/** Cloud base shape (128 × 128 × 32, x·z·height): R = Perlin-Worley, GBA = Worley at rising frequency. */
const CLOUD_SHAPE3D_FRAG = /* glsl */ `
  ${NOISE3D_COMMON_GLSL}
  void main() {
    vec3 uvw = vec3(vUv, uSlice);
    // the height axis is a quarter as long as the horizontal ones, so its cell counts are a quarter too
    vec3 f = vec3(4.0, 4.0, 1.0);
    float pf = clamp(perlinFbm3(uvw, f) * 1.25 + 0.5, 0.0, 1.0);
    float w0 = worleyFbm3(uvw, f);
    float perlinWorley = w0 + pf * (1.0 - w0);
    float w1 = worleyFbm3(uvw, f * 2.0);
    float w2 = worleyFbm3(uvw, f * 4.0);
    float w3 = worleyFbm3(uvw, f * 8.0);
    gl_FragColor = vec4(perlinWorley, w1, w2, w3);
  }
`;

/** Cloud erosion detail (64³): Worley at three frequencies. */
const CLOUD_DETAIL3D_FRAG = /* glsl */ `
  ${NOISE3D_COMMON_GLSL}
  void main() {
    vec3 uvw = vec3(vUv, uSlice);
    float w0 = worleyFbm3(uvw, vec3(2.0));
    float w1 = worleyFbm3(uvw, vec3(4.0));
    float w2 = worleyFbm3(uvw, vec3(8.0));
    gl_FragColor = vec4(w0, w1, w2, 1.0);
  }
`;

/**
 * Cloud panorama: a volumetric cumulus layer (3D Perlin-Worley shape eroded by 3D Worley detail, lit by a
 * cone march towards the sun) plus a cirrus sheet, ray-marched into an equirectangular texture of the upper
 * hemisphere (u = azimuth, v = elevation / 90°). The sky dome and the environment capture just sample it, so
 * the march can afford many steps, never shows per-pixel noise, and costs the same at any screen resolution.
 * It is refreshed in vertical strips, one per frame, because clouds move slowly.
 */
const CLOUD_PANO_FRAG = /* glsl */ `
  precision highp float;
  precision highp sampler3D;
  varying vec2 vUv;
  uniform sampler2D uSkyLUT;
  uniform sampler2D uSkyIrr;
  uniform sampler2D uNoise;
  uniform sampler3D uShape3D;
  uniform sampler3D uDetail3D;
  uniform vec3 uSunDir;
  uniform vec3 uCloudSun;       // solar irradiance reaching the cumulus layer
  uniform vec3 uCirrusSun;      // solar irradiance reaching the cirrus sheet
  uniform vec3 uGroundAlbedo;
  uniform vec3 uSunGround;
  uniform vec3 uHazeExt;        // extinction per km near the ground (aerial perspective on clouds)
  uniform float uCoverage;
  uniform float uCloudDensity;
  uniform float uCirrus;
  uniform float uTime;
  uniform float uPanoTexelAngle;
  uniform int uCloudSteps;
  #define PI 3.14159265359
  const float RG = ${RG_KM.toFixed(1)};
  // the slab the march covers (km above the observer); individual clouds sit at varying base heights inside it
  const float SLAB_BASE = ${(CLOUD_BASE_KM - OBSERVER_ALT_KM - 0.18).toFixed(3)};
  const float SLAB_TOP = ${(CLOUD_TOP_KM - OBSERVER_ALT_KM + 0.25).toFixed(3)};
  const float CIRRUS_ALT = ${(CIRRUS_ALT_KM - OBSERVER_ALT_KM).toFixed(3)};
  const float SHAPE_TILE = 6.4;     // km covered by one tile of the shape noise (x and z)
  const float DETAIL_TILE = 0.86;   // km covered by one tile of the detail noise
  // Extinction per km at density 1. Real cumulus is optically dense (visibility inside a few tens of metres):
  // a high view extinction gives the crisp, sharply bounded billows; the light march uses a lower value so
  // the multiply scattered interior stays luminous instead of going grey.
  const float SIGMA = 55.0;
  const float SIGMA_LIGHT = 20.0;
  ${SKY_LUT_SAMPLE_GLSL}

  // distance along a ray with sine-of-elevation mu to a shell h km above the observer (curved earth)
  float khShellDist(float h, float mu) {
    float r = RG + ${OBSERVER_ALT_KM.toFixed(2)};
    return -r * mu + sqrt(r * r * mu * mu + 2.0 * r * h + h * h);
  }
  float khHG(float mu, float g) {
    float g2 = g * g;
    return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
  }
  float khRemap(float x, float a, float b, float c, float d) {
    return c + (x - a) / (b - a) * (d - c);
  }

  vec2 khWind() { return uTime * vec2(0.0042, 0.0019); }

  // Weather at a ground position: x = coverage 0..1, y = height of this cloud's top (fraction of the slab),
  // z = height of its base (fraction of the slab). Fair-weather cumulus of mixed sizes with clear gaps.
  vec3 khWeather(vec2 q) {
    vec4 big = textureLod(uNoise, q * (1.0 / 47.0) + vec2(0.31, 0.67), 0.0);
    vec4 mid = textureLod(uNoise, q * (1.0 / 13.0), 0.0);
    vec4 small = textureLod(uNoise, q * (1.0 / 4.6) + vec2(0.57, 0.19), 0.0);
    float region = smoothstep(0.3, 0.72, big.a);                    // fields of cloud vs. open sky
    float cells = mid.r * 0.62 + small.r * 0.38;                    // big towers and small puffs
    float amount = uCoverage * mix(0.35, 1.55, region);
    float cov = clamp((cells - (1.0 - 0.52 * amount)) * 5.5, 0.0, 1.0);
    float top = mix(0.42, 1.0, clamp(cov * 1.15 * (0.55 + 0.9 * mid.g), 0.0, 1.0));
    float base = 0.04 + 0.2 * big.r;                                  // cloud groups condense at slightly different heights
    return vec3(cov, top, base);
  }

  // pos: km relative to the observer (y up). Returns 0..1.
  // detail: 0 = shape only, 1 = + Worley erosion, 2 = + a finer erosion octave (the cauliflower texture)
  float khCloudDensity(vec3 pos, vec3 weather, float lod, int detail) {
    float hf = (pos.y - SLAB_BASE) / (SLAB_TOP - SLAB_BASE);
    float rel = (hf - weather.z) / max(weather.y - weather.z, 0.05);   // 0 at this cloud's base, 1 at its top
    if (rel <= 0.0 || rel >= 1.0 || weather.x <= 0.0) return 0.0;
    // flat condensation base (cumulus bases are a nearly level, sharp line), rounded billowing top
    float gradient = smoothstep(0.0, 0.035, rel) * (1.0 - smoothstep(0.5, 1.0, rel));
    vec2 q = pos.xz + khWind();
    vec3 uvw = vec3(q * (1.0 / SHAPE_TILE), pos.y * (4.0 / SHAPE_TILE));
    vec4 n = textureLod(uShape3D, uvw, lod);
    float fbm = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
    float shape = khRemap(n.r, fbm - 1.0, 1.0, 0.0, 1.0);
    float d = khRemap(shape * gradient, 1.0 - weather.x * 0.9, 1.0, 0.0, 1.0) * weather.x;
    if (d <= 0.0) return 0.0;
    if (detail > 0) {
      // Erode the edges with inverted Worley cells: round, bulging billows ("cauliflower") everywhere above
      // the first few metres; only the very base keeps the softer, wispy fbm.
      vec3 duvw = vec3(q, pos.y) * (1.0 / DETAIL_TILE) + vec3(n.gb * 0.12, 0.0);
      // (lod is in shape-texture texels; the detail texels are ~4x and the fine ones ~10x smaller)
      vec3 e = textureLod(uDetail3D, duvw, max(lod - 1.9, 0.0)).rgb;
      float efbm = e.r * 0.625 + e.g * 0.25 + e.b * 0.125;
      if (detail > 1) {
        // a second, 2.7x finer octave of billows on the billows (prefiltered one level coarser)
        vec3 f = textureLod(uDetail3D, duvw * 2.71 + vec3(0.37, 0.11, 0.53), max(lod - 3.3, 0.0)).rgb;
        efbm = efbm * 0.68 + (f.r * 0.6 + f.g * 0.4) * 0.32;
      }
      float modifier = mix(efbm, 1.0 - efbm, smoothstep(0.02, 0.14, rel));
      d = khRemap(d, modifier * mix(0.3, 0.58, smoothstep(0.0, 0.2, rel)), 1.0, 0.0, 1.0);
    }
    // steep density ramp: the visible surface of a cumulus is a sharp boundary, not a 50 m soft falloff
    return clamp(d * 4.2, 0.0, 1.0) * uCloudDensity;
  }

  vec4 khClouds(vec3 dir, vec3 skyAmbientUp, vec3 skyAmbientDown, vec3 horizonGlow) {
    float t0 = khShellDist(SLAB_BASE, dir.y);
    float t1 = khShellDist(SLAB_TOP, dir.y);
    float span = t1 - t0;
    int steps = uCloudSteps;
    // grazing rays cross far more cloud field: give them more samples (bounded)
    steps = int(min(float(steps) * (1.0 + 1.6 * (1.0 - smoothstep(0.08, 0.6, dir.y))), 160.0));
    float dt = span / float(steps);
    // Prefilter the noise by texel footprint and by march spacing so distant clouds never alias.
    float lodPix = log2(max(t0 * uPanoTexelAngle * (128.0 / SHAPE_TILE), 1.0));
    float lodStep = log2(max(dt * (128.0 / SHAPE_TILE), 1.0)) - 1.0;
    float lod = clamp(max(lodPix, lodStep), 0.0, 5.0);
    float muS = dot(dir, uSunDir);
    // dual-lobe phase: forward peak (silver lining) + broad lobe; normalised so that 1.0 == isotropic
    float phase = mix(khHG(muS, 0.7), khHG(muS, -0.2), 0.4) * 4.0 * PI;
    vec3 lightDir = normalize(vec3(uSunDir.x, max(uSunDir.y, 0.1), uSunDir.z));
    vec3 sum = vec3(0.0);
    float trans = 1.0;
    float slabH = SLAB_TOP - SLAB_BASE;
    for (int i = 0; i < 160; i++) {
      if (i >= steps) break;
      float f = (float(i) + 0.5) / float(steps);
      vec3 pos = dir * (t0 + span * f);
      // flat-earth height inside the slab (curvature only matters for where the ray enters)
      pos.y = SLAB_BASE + slabH * f;
      vec3 weather = khWeather(pos.xz + khWind());
      if (weather.x <= 0.001) continue;
      float d = khCloudDensity(pos, weather, lod, 2);
      if (d <= 0.002) continue;

      // optical depth towards the sun: six widening taps inside a cone
      float tau = 0.0;
      float ls = 0.035;
      vec3 lp = pos;
      for (int j = 0; j < 6; j++) {
        lp += lightDir * ls;
        if (lp.y < SLAB_TOP) {
          vec3 lw = khWeather(lp.xz + khWind());
          tau += khCloudDensity(lp, lw, lod + 0.5 + float(j) * 0.35, j < 2 ? 1 : 0) * ls;
        }
        ls *= 1.7;
      }
      tau *= SIGMA_LIGHT;
      float hf = f;
      // Beer's law plus two cheap higher-order octaves: thick clouds stay luminous, edges stay crisp
      float Tsun = exp(-tau) + 0.42 * exp(-tau * 0.28) + 0.14 * exp(-tau * 0.07);
      Tsun *= 1.0 / 1.56;
      // "powder": freshly entered, sun-facing surfaces look darker than slightly deeper ones
      float powder = 1.0 - 0.6 * exp(-d * SIGMA_LIGHT * 0.22 - tau * 1.6);
      float phaseMix = mix(1.0, phase, 0.5 * exp(-tau * 0.4) + 0.12);
      vec3 lit = uCloudSun * (1.15 / PI) * Tsun * phaseMix * powder;
      // ambient: sky from above, ground bounce from below; bases are darker and cooler than tops
      float relH = clamp((hf - weather.z) / max(weather.y - weather.z, 0.05), 0.0, 1.0);
      // (the flat base sees only the dark ground: noticeably darker than the sunlit flanks)
      vec3 amb = mix(skyAmbientDown * 0.38, skyAmbientUp * 1.08, smoothstep(0.0, 0.55, relH)) * (0.5 + 0.5 * exp(-d * 2.5));
      // after sunset the twilight arch still lights the undersides from the side
      amb += horizonGlow * (1.0 - relH) * 0.55;
      float a = 1.0 - exp(-d * SIGMA * dt);
      sum += trans * a * (lit + amb);
      trans *= 1.0 - a;
      if (trans < 0.015) break;
    }
    return vec4(sum, 1.0 - trans);
  }

  vec4 khCirrusLayer(vec3 dir, vec3 skyAmbientUp) {
    float t = khShellDist(CIRRUS_ALT, dir.y);
    vec2 p = dir.xz * t + khWind() * 3.0;
    float lod = clamp(log2(max(t * uPanoTexelAngle / max(dir.y, 0.03) * (512.0 / 40.0), 1.0)), 0.0, 5.0);
    // wispy fibres: a slowly curving flow direction stretches the noise
    float bend = textureLod(uNoise, p * (1.0 / 190.0) + 0.53, 0.0).a - 0.5;
    float ang = 0.55 + bend * 1.3;
    vec2 ax = vec2(cos(ang), sin(ang));
    vec2 q = vec2(dot(p, ax), dot(p, vec2(-ax.y, ax.x)));
    float fibre = textureLod(uNoise, q * vec2(1.0 / 95.0, 1.0 / 22.0), lod).a;
    float wisp = textureLod(uNoise, q * vec2(1.0 / 41.0, 1.0 / 9.0) + 0.37, lod).r;
    float region = textureLod(uNoise, p * (1.0 / 150.0) + 0.11, 0.0).a;
    float d = smoothstep(0.42, 0.9, fibre * 0.55 + wisp * 0.5) * smoothstep(0.38, 0.72, region);
    d = d * d * uCirrus;
    float muS = dot(dir, uSunDir);
    float phase = mix(khHG(muS, 0.5), 1.0 / (4.0 * PI), 0.7) * 4.0 * PI;
    vec3 col = uCirrusSun * (0.2 / PI) * phase + skyAmbientUp * 0.55;
    return vec4(col * d, d);
  }

  void main() {
    float az = (vUv.x - 0.5) * 2.0 * PI;
    float el = max(vUv.y, 0.0015) * PI * 0.5;
    vec3 dir = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
    vec3 skyIrr = texture2D(uSkyIrr, vec2(0.5)).rgb;
    vec3 ambUp = skyIrr / PI;
    vec3 ambDown = uGroundAlbedo / PI * (uSunGround * max(uSunDir.y, 0.0) + skyIrr);
    vec3 lut = khSkyLut(dir).rgb;
    // brightest part of the twilight arch, towards the sun just above the horizon
    vec3 sunH = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + vec3(0.0, 0.05, 0.0));
    vec3 horizonGlow = khSkyLut(sunH).rgb * (1.0 - smoothstep(0.0, 0.14, uSunDir.y));

    vec3 col = vec3(0.0);
    float alpha = 0.0;
    if (uCirrus > 0.001) {
      vec4 ci = khCirrusLayer(dir, ambUp);
      vec3 haze = exp(-uHazeExt * (1.2 / max(dir.y, 0.012)));
      alpha = ci.a * dot(haze, vec3(0.3333));
      col = ci.rgb * haze;
    }
    if (uCoverage > 0.001) {
      vec4 cl = khClouds(dir, ambUp, ambDown, horizonGlow);
      // aerial perspective: distant clouds dissolve into the sky colour around them
      // (the haze sits in the lowest ~1.2 km, so the slant path through it is what dims distant clouds)
      vec3 T = exp(-uHazeExt * (1.05 / max(dir.y, 0.012)));
      vec3 cloudCol = cl.rgb * T + lut * cl.a * (1.0 - T);
      col = col * (1.0 - cl.a) + cloudCol;
      alpha = 1.0 - (1.0 - alpha) * (1.0 - cl.a);
    }
    gl_FragColor = vec4(col, alpha);
  }
`;

const SKY_DOME_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vWorldDir;
  uniform sampler2D uSkyLUT;
  uniform sampler2D uSkyIrr;
  uniform sampler2D uCloudPano;
  uniform vec3 uSunDir;
  uniform vec3 uSunDisk;        // radiance of the solar disk (already attenuated, clamped)
  uniform vec3 uGroundAlbedo;
  uniform float uEnvMode;
  uniform vec3 uSunGround;      // direct solar irradiance on the ground
  uniform float uCamY;          // camera height (scene Y)
  uniform vec3 uCamPosW;        // camera position (world) for the land beyond the modelled ground
  uniform float uPlainMeasured;
  #define PI 3.14159265359
  ${SKY_LUT_SAMPLE_GLSL}
  ${AERIAL_GLSL}

  void main() {
    vec3 dir = normalize(vWorldDir);
    vec3 skyIrr = texture2D(uSkyIrr, vec2(0.5)).rgb;
    vec3 groundRadiance = uGroundAlbedo / PI * (uSunGround * max(uSunDir.y, 0.0) + skyIrr);
    vec4 lut = khSkyLut(vec3(dir.x, max(dir.y, 0.0), dir.z));
    vec3 sky = lut.rgb;
    if (dir.y < 0.0) {
      if (uEnvMode > 0.5) {
        // image-based lighting: the lower hemisphere is the sun- and sky-lit ground right below
        // Physical bound: ground of albedo <= 0.4 under the light that is actually left - whatever the probe
        // saw, twilight is never lit from below brighter than the remaining sky and sun allow.
        vec3 groundMax = (uSunGround * max(uSunDir.y, 0.0) + skyIrr) * (0.4 / PI);
        vec3 ground = min(uPlainMeasured > 0.5 ? uPlainRadiance : groundRadiance, groundMax);
        sky = mix(sky, ground, smoothstep(0.0, 0.06, -dir.y));
      } else {
        // The world beyond the modelled terrain.
        sky = khBeyond(dir, uCamPosW, 0.0);
      }
    } else {
      if (uEnvMode < 0.5) {
        // solar disk with limb darkening (0.267° radius); hidden behind clouds below
        float mu = dot(dir, uSunDir);
        float ang = acos(clamp(mu, -1.0, 1.0));
        const float SUN_R = 0.004675;
        float edge = 1.0 - smoothstep(SUN_R * 0.92, SUN_R * 1.05, ang);
        float rr = clamp(ang / SUN_R, 0.0, 1.0);
        float limb = 1.0 - 0.55 * (1.0 - sqrt(1.0 - rr * rr));
        sky += uSunDisk * edge * limb * smoothstep(-0.006, 0.004, dir.y);
      }
      float az = atan(dir.z, dir.x);
      float el = asin(clamp(dir.y, 0.0, 1.0));
      vec4 clouds = texture2D(uCloudPano, vec2(az * 0.15915494 + 0.5, el * 0.63661977));
      // The panorama is coarser than the screen: steepen the coverage ramp so magnified cloud rims read as
      // crisp, eroded edges instead of a blur (premultiplied colour follows the new coverage).
      float aSharp = mix(clouds.a, clouds.a * clouds.a * (3.0 - 2.0 * clouds.a), 0.7);
      clouds.rgb *= clouds.a > 1e-4 ? aSharp / clouds.a : 0.0;
      clouds.a = aSharp;
      sky = sky * (1.0 - clouds.a) + clouds.rgb;
    }

    gl_FragColor = vec4(sky, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface SkyAtmosphereState {
  /** Unit vector pointing towards the sun (world space, +Y up). */
  sunDir: THREE.Vector3;
  /** Exposure-normalised solar irradiance at the top of the atmosphere (linear RGB). */
  sunIrradiance: THREE.Vector3;
  /** Mie (haze) scattering coefficient at sea level, per km. Clear ≈ 0.02, summer haze ≈ 0.08. */
  miePerKm: number;
  mieG: number;
  ozone: number;
  multiScatter: number;
  groundAlbedo: THREE.Vector3;
  cloudCoverage: number;
  cloudDensity: number;
  cirrus: number;
}

export class SkyAtmosphere {
  public readonly mesh: THREE.Mesh;
  public readonly material: THREE.ShaderMaterial;
  public readonly lutTarget: THREE.WebGLRenderTarget;
  public readonly irradianceTarget: THREE.WebGLRenderTarget;
  /** Uniform objects shared by the dome, the env-capture dome and external passes. */
  public readonly uniforms: Record<string, THREE.IUniform>;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly noiseTarget: THREE.WebGLRenderTarget;
  private readonly lutMaterial: THREE.ShaderMaterial;
  private readonly irrMaterial: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly envScene: THREE.Scene;
  private readonly envMaterial: THREE.ShaderMaterial;
  private readonly cloudMaterial: THREE.ShaderMaterial;
  private readonly shape3D: THREE.WebGL3DRenderTarget;
  private readonly detail3D: THREE.WebGL3DRenderTarget;
  private cloudTarget: THREE.WebGLRenderTarget;
  /** Panorama at a new quality level, filled strip by strip while the old one stays on screen. */
  private pendingCloudTarget: THREE.WebGLRenderTarget | null = null;
  private cloudStrip = 0;
  /** strips that still show the previous lighting (after a sun / haze / coverage change) */
  private cloudStripsStale = CLOUD_STRIPS;
  private cloudTimeRendered = Number.NaN;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    if (!renderer.capabilities.isWebGL2) {
      throw new Error('[SkyAtmosphere] WebGL2 is required for the physically based sky.');
    }
    if (!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float')) {
      throw new Error(
        '[SkyAtmosphere] This GPU/browser cannot render to floating-point textures (EXT_color_buffer_float missing).'
      );
    }

    this.lutTarget = new THREE.WebGLRenderTarget(SKY_LUT_WIDTH, SKY_LUT_HEIGHT, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      generateMipmaps: false,
    });
    this.lutTarget.texture.name = 'KH.skyViewLUT';
    this.irradianceTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
    });
    this.irradianceTarget.texture.name = 'KH.skyIrradiance';
    this.noiseTarget = new THREE.WebGLRenderTarget(512, 512, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      depthBuffer: false,
      generateMipmaps: true,
    });
    this.noiseTarget.texture.name = 'KH.cloudNoise';

    this.quad = new FullScreenQuad();

    const lutUniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunIrradiance: { value: new THREE.Vector3(1, 1, 1) },
      uGroundAlbedo: { value: new THREE.Vector3(0.12, 0.13, 0.08) },
      uMsFactor: { value: 1.0 },
      uAltitude: { value: OBSERVER_ALT_KM },
      uMie: { value: 0.04 },
      uMieG: { value: 0.78 },
      uOzone: { value: 1.0 },
    };
    this.lutMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: SKY_LUT_FRAG,
      uniforms: lutUniforms,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.irrMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: SKY_IRRADIANCE_FRAG,
      uniforms: { uSkyLUT: { value: this.lutTarget.texture } },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.uniforms = {
      uSkyLUT: { value: this.lutTarget.texture },
      uSkyIrr: { value: this.irradianceTarget.texture },
      uNoise: { value: this.noiseTarget.texture },
      uShape3D: { value: null },
      uDetail3D: { value: null },
      uCloudSteps: { value: 48 },
      uSunDir: lutUniforms.uSunDir,
      uSunDisk: { value: new THREE.Vector3(0, 0, 0) },
      uCloudSun: { value: new THREE.Vector3(1, 1, 1) },
      uCirrusSun: { value: new THREE.Vector3(1, 1, 1) },
      uGroundAlbedo: lutUniforms.uGroundAlbedo,
      uHazeExt: { value: new THREE.Vector3(0.05, 0.06, 0.08) },
      uCoverage: { value: 0.5 },
      uCloudDensity: { value: 1.0 },
      uCirrus: { value: 0.3 },
      uTime: { value: 12.0 },
      uCloudPano: { value: null },
      uPanoTexelAngle: { value: 0.002 },
      uSunGround: { value: new THREE.Vector3(1, 1, 1) },
      uCamY: { value: 200 },
      // aerial perspective (shared with the post pipeline's composite pass)
      uBetaR: { value: BETA_RAYLEIGH_PER_M.clone() },
      uMieExt: { value: 6e-5 },
      uHazeH: { value: 1200 },
      uMistExt: { value: 0 },
      uMistH: { value: 60 },
      uFogGroundY: { value: 0 },
      uFogAmount: { value: 1 },
      // world beyond the terrain (see LightingSystem.attachGround)
      uPlainRadiance: { value: new THREE.Vector3(0.1, 0.1, 0.06) },
      uPlainMeasured: { value: 0 },
      uWorldEdge: { value: new THREE.Vector3(1e9, 2e9, 0) },
      uCamPosW: { value: new THREE.Vector3() },
      uPlainTex: { value: SkyAtmosphere.blankTexture() },
      uPlainInfo: { value: new THREE.Vector4(1, 0, 1e9, 0.001) },
      uEdgeH: { value: new Array<number>(EDGE_BINS).fill(0) },
    };

    this.cloudTarget = this.createCloudTarget(2048);
    this.uniforms.uCloudPano.value = this.cloudTarget.texture;
    this.cloudMaterial = new THREE.ShaderMaterial({
      name: 'KH_CloudPanorama',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: CLOUD_PANO_FRAG,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.material = this.createDomeMaterial(0);
    this.envMaterial = this.createDomeMaterial(1);

    const geo = new THREE.IcosahedronGeometry(1, 5);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'PfalzSkyAndClouds';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.matrixAutoUpdate = false;
    // Drawn after every opaque object so sky shading only runs on pixels that actually show sky.
    this.mesh.renderOrder = 9000;

    this.envScene = new THREE.Scene();
    const envMesh = new THREE.Mesh(geo, this.envMaterial);
    envMesh.frustumCulled = false;
    this.envScene.add(envMesh);

    this.renderNoise();
    this.shape3D = this.renderNoise3D(CLOUD_SHAPE3D_FRAG, 128, 128, 32, 'KH.cloudShape3D');
    this.detail3D = this.renderNoise3D(CLOUD_DETAIL3D_FRAG, 64, 64, 64, 'KH.cloudDetail3D');
    this.uniforms.uShape3D.value = this.shape3D.texture;
    this.uniforms.uDetail3D.value = this.detail3D.texture;
  }

  /** Renders a tileable 3D noise volume slice by slice (once, at start-up). */
  private renderNoise3D(
    fragmentShader: string,
    width: number,
    height: number,
    depth: number,
    name: string
  ): THREE.WebGL3DRenderTarget {
    const target = new THREE.WebGL3DRenderTarget(width, height, depth, { depthBuffer: false });
    const tex = target.texture;
    tex.name = name;
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.wrapR = THREE.RepeatWrapping;
    tex.generateMipmaps = true;
    const mat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader,
      uniforms: { uSlice: { value: 0 } },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const prevTarget = this.renderer.getRenderTarget();
    const prevAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.quad.material = mat;
    for (let layer = 0; layer < depth; layer++) {
      mat.uniforms.uSlice.value = (layer + 0.5) / depth;
      this.renderer.setRenderTarget(target, layer);
      this.quad.render(this.renderer);
    }
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.autoClear = prevAutoClear;
    mat.dispose();
    return target;
  }

  private createDomeMaterial(envMode: number): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      name: envMode ? 'KH_SkyDome_Env' : 'KH_SkyDome',
      vertexShader: SKY_DOME_VERT,
      fragmentShader: SKY_DOME_FRAG,
      uniforms: { ...this.uniforms, uEnvMode: { value: envMode } },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      depthFunc: THREE.LessEqualDepth,
      fog: false,
      toneMapped: true,
    });
    return mat;
  }

  private renderToTarget(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    const prevTarget = this.renderer.getRenderTarget();
    const prevAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(target);
    this.quad.material = material;
    this.quad.render(this.renderer);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.autoClear = prevAutoClear;
  }

  private renderNoise(): void {
    const mat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: CLOUD_NOISE_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.renderToTarget(mat, this.noiseTarget);
    mat.dispose();
  }

  private createCloudTarget(width: number): THREE.WebGLRenderTarget {
    const target = new THREE.WebGLRenderTarget(width, Math.round(width / 6), {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      generateMipmaps: false,
    });
    target.texture.name = 'KH.cloudPanorama';
    this.uniforms.uPanoTexelAngle.value = (2 * Math.PI) / width;
    return target;
  }

  /**
   * Cloud quality: ray-march steps through the cumulus slab and panorama width in pixels
   * (height = width / 6, covering the upper hemisphere). The step count is a uniform, so changing it never
   * recompiles the shader.
   */
  public setCloudQuality(steps: number, panoramaWidth: number): void {
    const width = Math.min(panoramaWidth, this.renderer.capabilities.maxTextureSize);
    if (steps !== this.uniforms.uCloudSteps.value) {
      this.uniforms.uCloudSteps.value = steps;
      this.cloudStripsStale = CLOUD_STRIPS;
    }
    const building = this.pendingCloudTarget ?? this.cloudTarget;
    if (width !== building.width) {
      // A quality change must not stall: the new panorama is filled over the next frames (3 strips per
      // frame) while the old one stays on screen, then they are swapped. Synchronous renders (screenshots,
      // the debug API) complete it at once through updateClouds(true).
      if (this.pendingCloudTarget) this.pendingCloudTarget.dispose();
      if (width === this.cloudTarget.width) {
        this.pendingCloudTarget = null;
        this.uniforms.uPanoTexelAngle.value = (2 * Math.PI) / width;
      } else {
        this.pendingCloudTarget = this.createCloudTarget(width);
        this.cloudStrip = 0;
      }
      this.cloudStripsStale = CLOUD_STRIPS;
    }
  }

  /** True while parts of the panorama still show the lighting from before the last sun / haze change. */
  public get cloudsStale(): boolean {
    return this.cloudStripsStale > 0;
  }

  /**
   * Refreshes the cloud panorama. `full` redraws all of it now (preset changes, screenshots). Otherwise
   * one vertical strip per call follows the drifting clouds, and three per call while the panorama catches
   * up with a lighting change (sun slider). Returns true when a catch-up just completed.
   */
  public updateClouds(full = false): boolean {
    const target = this.pendingCloudTarget ?? this.cloudTarget;
    const time = this.time;
    if (full) {
      target.scissorTest = false;
      this.renderToTarget(this.cloudMaterial, target);
      const wasStale = this.cloudStripsStale > 0;
      this.cloudStripsStale = 0;
      this.cloudStrip = 0;
      this.cloudTimeRendered = time;
      this.swapPendingClouds();
      return wasStale;
    }
    const stale = this.cloudStripsStale > 0;
    if (!stale && time === this.cloudTimeRendered) return false; // frozen and up to date
    const count = stale ? Math.min(3, this.cloudStripsStale) : 1;
    const stripWidth = Math.ceil(target.width / CLOUD_STRIPS);
    for (let i = 0; i < count; i++) {
      const x = this.cloudStrip * stripWidth;
      target.scissor.set(x, 0, Math.min(stripWidth, target.width - x), target.height);
      target.scissorTest = true;
      this.renderToTarget(this.cloudMaterial, target);
      this.cloudStrip = (this.cloudStrip + 1) % CLOUD_STRIPS;
    }
    target.scissorTest = false;
    this.cloudTimeRendered = time;
    if (stale) {
      this.cloudStripsStale -= count;
      if (this.cloudStripsStale <= 0) this.swapPendingClouds();
      return this.cloudStripsStale <= 0;
    }
    return false;
  }

  private swapPendingClouds(): void {
    const next = this.pendingCloudTarget;
    if (!next) return;
    this.cloudTarget.dispose();
    this.cloudTarget = next;
    this.pendingCloudTarget = null;
    this.uniforms.uCloudPano.value = next.texture;
  }

  /** Re-renders the sky LUT + irradiance and updates all sun-dependent sky uniforms. */
  public update(state: SkyAtmosphereState): void {
    const lu = this.lutMaterial.uniforms;
    lu.uSunDir.value.copy(state.sunDir);
    lu.uSunIrradiance.value.copy(state.sunIrradiance);
    lu.uGroundAlbedo.value.copy(state.groundAlbedo);
    lu.uMsFactor.value = state.multiScatter;
    lu.uMie.value = state.miePerKm;
    lu.uMieG.value = state.mieG;
    lu.uOzone.value = state.ozone;
    this.renderToTarget(this.lutMaterial, this.lutTarget);
    this.renderToTarget(this.irrMaterial, this.irradianceTarget);

    const sinEl = state.sunDir.y;
    const u = this.uniforms;
    // Solar disk radiance: E / solid angle, clamped so half-float targets and bloom stay well behaved.
    const tGround = atmosphereTransmittance(OBSERVER_ALT_KM, sinEl, state.miePerKm, state.ozone);
    const disk = tGround.clone().multiply(state.sunIrradiance).multiplyScalar(1 / 6.8e-5);
    const maxC = Math.max(disk.x, disk.y, disk.z, 1e-6);
    const DISK_CLAMP = 900;
    if (maxC > DISK_CLAMP) disk.multiplyScalar(DISK_CLAMP / maxC);
    (u.uSunDisk.value as THREE.Vector3).copy(disk);
    (u.uSunGround.value as THREE.Vector3).copy(tGround).multiply(state.sunIrradiance);
    if (u.uPlainMeasured.value < 0.5) {
      // before the ground has been measured: albedo x direct sun (the sky part is added once it is known)
      (u.uPlainRadiance.value as THREE.Vector3)
        .copy(u.uSunGround.value as THREE.Vector3)
        .multiplyScalar(Math.max(sinEl, 0) / Math.PI + 0.06)
        .multiply(state.groundAlbedo);
    }

    const tCloud = atmosphereTransmittance((CLOUD_BASE_KM + CLOUD_TOP_KM) * 0.5, sinEl, state.miePerKm, state.ozone);
    (u.uCloudSun.value as THREE.Vector3).copy(tCloud).multiply(state.sunIrradiance);
    const tCirrus = atmosphereTransmittance(CIRRUS_ALT_KM, sinEl, state.miePerKm, state.ozone);
    (u.uCirrusSun.value as THREE.Vector3).copy(tCirrus).multiply(state.sunIrradiance);

    const mieExt = state.miePerKm * MIE_EXT_RATIO;
    (u.uHazeExt.value as THREE.Vector3).set(BETA_R[0] + mieExt, BETA_R[1] + mieExt, BETA_R[2] + mieExt);
    u.uCoverage.value = state.cloudCoverage;
    u.uCloudDensity.value = state.cloudDensity;
    u.uCirrus.value = state.cirrus;
    // the clouds are lit by this sun and sky: the whole panorama has to catch up (see updateClouds)
    this.cloudStripsStale = CLOUD_STRIPS;
  }

  /** Direct solar irradiance (scene units) arriving at the ground for the given state. */
  public static groundSunIrradiance(state: SkyAtmosphereState): THREE.Vector3 {
    return atmosphereTransmittance(OBSERVER_ALT_KM, state.sunDir.y, state.miePerKm, state.ozone).multiply(
      state.sunIrradiance
    );
  }

  /** Mean radiance of the outermost real ground; the endless plain beyond it takes this colour. */
  public setPlainRadiance(radiance: THREE.Vector3): void {
    (this.uniforms.uPlainRadiance.value as THREE.Vector3).copy(radiance);
    this.uniforms.uPlainMeasured.value = 1;
  }

  /**
   * Distance band (metres from the map centre) across which real ground dissolves into the plain. `radial`
   * measures it as distance from the centre (a round outer ring), otherwise per axis (a square edge).
   */
  public setWorldEdge(fadeStart: number, fadeEnd: number, radial: boolean): void {
    if (!(fadeEnd > fadeStart && fadeStart > 0)) {
      throw new Error(`[Sky] setWorldEdge: invalid fade band ${fadeStart} … ${fadeEnd} m`);
    }
    (this.uniforms.uWorldEdge.value as THREE.Vector3).set(fadeStart, fadeEnd, radial ? 1 : 0);
  }

  public get time(): number {
    return this.uniforms.uTime.value as number;
  }

  public set time(v: number) {
    this.uniforms.uTime.value = v;
  }

  /** Per-frame camera-dependent inputs of the dome shader. */
  public setCamera(camera: THREE.PerspectiveCamera): void {
    this.uniforms.uCamY.value = camera.position.y;
    (this.uniforms.uCamPosW.value as THREE.Vector3).setFromMatrixPosition(camera.matrixWorld);
    const h = this.renderer.getDrawingBufferSize(TMP_V2).y;
    (this.uniforms.uPlainInfo.value as THREE.Vector4).w =
      (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5)) / Math.max(h, 1) / camera.zoom;
  }

  /**
   * The land beyond the modelled ground: the outer aerial photo it continues (mirrored), the photo's side in
   * metres, the radius of the outer ground edge and the edge height (scene Y) in EDGE_BINS azimuth bins
   * (bin i centred on atan2(z, x) = -PI + (i + 0.5) * 2PI / EDGE_BINS). Without a photo the land beyond takes
   * the measured mean ground colour only.
   */
  public setOuterGround(photo: THREE.Texture | null, photoSideM: number, edgeRadiusM: number, edgeHeights: number[]): void {
    if (edgeHeights.length !== EDGE_BINS || edgeHeights.some((v) => !Number.isFinite(v))) {
      throw new Error(`[Sky] setOuterGround: need ${EDGE_BINS} finite edge heights, got ${edgeHeights.length}`);
    }
    if (!(edgeRadiusM > 0) || (photo && !(photoSideM > 0))) {
      throw new Error(`[Sky] setOuterGround: invalid edge radius ${edgeRadiusM} m / photo side ${photoSideM} m`);
    }
    if (photo && !photo.generateMipmaps) {
      throw new Error('[Sky] setOuterGround: the outer photo needs mipmaps (its mean colour is read from the last level)');
    }
    const u = this.uniforms;
    u.uPlainTex.value = photo ?? SkyAtmosphere.blankTexture();
    const info = u.uPlainInfo.value as THREE.Vector4;
    info.set(photo ? photoSideM : 1, photo ? 1 : 0, edgeRadiusM, info.w);
    u.uEdgeH.value = edgeHeights.slice();
  }

  private static blank: THREE.DataTexture | null = null;
  private static blankTexture(): THREE.DataTexture {
    if (!SkyAtmosphere.blank) {
      const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
      t.needsUpdate = true;
      SkyAtmosphere.blank = t;
    }
    return SkyAtmosphere.blank;
  }

  /** Renders sky + clouds (no solar disk) + sun/sky-lit ground into a PMREM environment. */
  public buildEnvironment(pmrem: THREE.PMREMGenerator): THREE.WebGLRenderTarget {
    return pmrem.fromScene(this.envScene, 0, 0.1, 100);
  }
}
