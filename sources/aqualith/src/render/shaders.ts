// GLSL ES 3.00 Shaders for AQUALITH Multi-Pass Optical Water & Sanctuary Renderer

export const FULLSCREEN_QUAD_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;
out vec2 vUv;

void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Pass 1: Fluid Particle Splatting (density, weighted velocity, weighted foam)
export const FLUID_SPLAT_VS = `#version 300 es
precision highp float;

in vec2 aPos;
in vec2 aVel;
in float aFoam;

uniform vec2 uWorldSize;
uniform vec2 uViewportSize;
uniform float uPointWorldDiameter;

out vec2 vVel;
out float vFoam;

void main() {
  vec2 ndc = (aPos / uWorldSize) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
  float pxDiameter = uPointWorldDiameter * (uViewportSize.y / uWorldSize.y);
  gl_PointSize = clamp(pxDiameter, 4.0, 64.0);
  vVel = aVel;
  vFoam = aFoam;
}
`;

export const FLUID_SPLAT_FS = `#version 300 es
precision highp float;

in vec2 vVel;
in float vFoam;

uniform float uIsFloat;
uniform float uSplatScale;

out vec4 fragColor;

void main() {
  vec2 d = (gl_PointCoord - 0.5) * 2.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;

  float w = exp(-r2 * 4.4) * (1.0 - smoothstep(0.72, 1.0, r2));
  float contrib = w * uSplatScale;

  // Normalize velocity into [-1, 1] covering up to ~16 m/s cleanly
  vec2 velNorm = clamp(vVel * 0.0625, -1.0, 1.0);
  float foamVal = clamp(vFoam, 0.0, 1.25);

  if (uIsFloat > 0.5) {
    fragColor = vec4(contrib, velNorm.x * contrib, velNorm.y * contrib, foamVal * contrib);
  } else {
    // Shift velocity to [0, 1] * contrib so additive RGBA8 never clips negative components
    vec2 velEnc = (0.5 + 0.5 * velNorm) * contrib;
    fragColor = vec4(contrib, velEnc.x, velEnc.y, clamp(foamVal, 0.0, 1.0) * contrib);
  }
}
`;

// Pass 2: Resolution-independent 9-tap separable Gaussian blur
export const GAUSSIAN_BLUR_FS = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uBlurStep;

out vec4 fragColor;

void main() {
  vec4 acc = texture(uTex, vUv) * 0.204164;
  acc += (texture(uTex, vUv + uBlurStep * 1.0) + texture(uTex, vUv - uBlurStep * 1.0)) * 0.180174;
  acc += (texture(uTex, vUv + uBlurStep * 2.0) + texture(uTex, vUv - uBlurStep * 2.0)) * 0.123832;
  acc += (texture(uTex, vUv + uBlurStep * 3.0) + texture(uTex, vUv - uBlurStep * 3.0)) * 0.066282;
  acc += (texture(uTex, vUv + uBlurStep * 4.0) + texture(uTex, vUv - uBlurStep * 4.0)) * 0.027631;
  fragColor = acc;
}
`;

// Pass 3A: Sanctuary Backdrop, Volumetric Sun Rays, Lanterns & SDF Material Terrain
export const WORLD_TERRAIN_FS = `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uTerrainSdfTex;
uniform sampler2D uTerrainKindTex;

uniform vec2 uWorldSize;
uniform float uTime;
uniform float uQuality;
uniform vec3 uSkyTop;
uniform vec3 uSkyBottom;
uniform vec3 uRockTint;
uniform vec2 uLightDir;
uniform vec3 uSunColor;

uniform int uNumLanterns;
uniform vec2 uLanternPos[12];
uniform vec3 uLanternColor[12];
uniform float uLanternRadius[12];

out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * noise2D(p);
    p = rot * p * 2.03 + vec2(11.3, 7.1);
    a *= 0.5;
  }
  return v;
}

float voronoiEdge(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float md1 = 8.0;
  float md2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = vec2(hash21(n + g), hash21(n + g + vec2(37.2, 91.7)));
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < md1) {
        md2 = md1;
        md1 = d;
      } else if (d < md2) {
        md2 = d;
      }
    }
  }
  return sqrt(md2) - sqrt(md1);
}

vec3 computeBackdrop(vec2 worldPos, vec2 toSun) {
  float hNorm = clamp(worldPos.y / uWorldSize.y, 0.0, 1.0);
  vec3 sky = mix(uSkyBottom, uSkyTop, pow(max(hNorm, 1e-4), 0.82));

  // Soft horizon atmospheric glow toward sun azimuth
  vec2 sunAnchor = vec2(8.0 + toSun.x * 7.5, 9.2 + toSun.y * 2.0);
  float sunGlow = exp(-length((worldPos - sunAnchor) * vec2(0.22, 0.35)) * 0.7);
  sky += uSunColor * sunGlow * 0.24;

  // Parallax distant sunken aqueduct arches (far background)
  float farX = worldPos.x * 0.55 + 1.3;
  float farPillar = abs(fract(farX * 0.32) - 0.5);
  float farCol = (1.0 - smoothstep(0.055, 0.085, farPillar)) * step(worldPos.y, 7.6);
  float farArch = 1.0 - smoothstep(0.38, 0.42, length(vec2(fract(farX * 0.32) - 0.5, (worldPos.y - 6.7) * 0.28)));
  float farSilhouette = max(farCol * 0.7, (1.0 - farArch) * step(5.8, worldPos.y) * step(worldPos.y, 7.9));
  vec3 farColor = mix(uSkyBottom * 0.72, uRockTint * 0.38 + uSkyBottom * 0.48, 0.55);
  sky = mix(sky, farColor, farSilhouette * 0.35);

  // Midground fluted sanctuary temple columns & lintels
  float midPeriod = 3.25;
  float cellIdx = floor((worldPos.x + 0.65) / midPeriod);
  float colSeed = hash21(vec2(cellIdx, 4.1));
  if (colSeed > 0.22) {
    float lx = mod(worldPos.x + 0.65, midPeriod) - midPeriod * 0.5;
    float colW = 0.26 + colSeed * 0.08;
    float flute = 0.5 + 0.5 * cos(lx / colW * 18.0);
    float colMask = 1.0 - smoothstep(colW - 0.03, colW, abs(lx));
    float topBreak = 7.4 + colSeed * 1.4;
    colMask *= 1.0 - smoothstep(topBreak - 0.1, topBreak + 0.2, worldPos.y);
    // Horizontal carved band / capital
    float capital = (1.0 - smoothstep(colW * 1.25, colW * 1.35, abs(lx))) *
                    (1.0 - smoothstep(0.18, 0.24, abs(worldPos.y - (topBreak - 0.35))));
    float midMask = max(colMask, capital);
    vec3 midBase = mix(uSkyBottom * 0.55, uRockTint * 0.42, 0.45);
    vec3 midShade = midBase * (0.82 + 0.18 * flute) + uSunColor * 0.05 * max(0.0, sign(lx) * (-toSun.x));
    sky = mix(sky, midShade, midMask * 0.42);
  }

  // Soft cavern mist bands near lower basin
  float mist = fbm(vec2(worldPos.x * 0.32 + uTime * 0.06, worldPos.y * 0.65));
  float mistMask = (1.0 - smoothstep(0.2, 4.2, worldPos.y)) * (0.28 + 0.45 * mist);
  sky = mix(sky, mix(uSkyBottom, uSunColor, 0.14), mistMask * 0.22);

  // Volumetric diagonal sunlight rays
  vec2 perpLight = vec2(-toSun.y, toSun.x);
  float rayCoord = dot(worldPos - vec2(8.0, 9.0), perpLight);
  float ray1 = sin(rayCoord * 1.65 + uTime * 0.22) * 0.5 + 0.5;
  float ray2 = sin(rayCoord * 3.10 - uTime * 0.15 + 1.7) * 0.5 + 0.5;
  float ray3 = noise2D(vec2(rayCoord * 0.85 + uTime * 0.08, 2.3));
  float rays = pow(max(ray1 * 0.55 + ray2 * 0.25 + ray3 * 0.30, 1e-4), 2.1);
  float rayHeightFade = smoothstep(-0.5, 8.2, worldPos.y) * (1.0 - smoothstep(6.2, 9.4, worldPos.y * 0.6 + 2.0));
  sky += uSunColor * rays * (0.14 + 0.05 * uQuality) * (0.4 + 0.6 * rayHeightFade);

  // Floating sunlit dust motes in the sanctuary air
  vec2 moteUv = worldPos * vec2(2.6, 2.6) + vec2(-uTime * 0.14, -uTime * 0.22);
  vec2 mId = floor(moteUv);
  vec2 mF = fract(moteUv) - 0.5;
  float mRand = hash21(mId);
  if (mRand > 0.72) {
    vec2 mOff = vec2(hash21(mId + 1.3), hash21(mId + 7.9)) - 0.5;
    mOff *= 0.55;
    mOff += vec2(sin(uTime * 0.9 + mRand * 20.0), cos(uTime * 0.7 + mRand * 15.0)) * 0.09;
    float dMote = length(mF - mOff);
    float twinkle = 0.5 + 0.5 * sin(uTime * 2.5 + mRand * 40.0);
    float moteGlow = (1.0 - smoothstep(0.0, 0.075, dMote)) * twinkle * (0.35 + 0.65 * rays);
    sky += mix(uSunColor, vec3(1.0, 0.96, 0.85), 0.5) * moteGlow * 0.45;
  }

  return sky;
}

void main() {
  vec2 worldPos = vUv * uWorldSize;
  vec2 rawL = normalize(uLightDir + vec2(1e-5, 1e-4));
  vec2 toSun = rawL.y < 0.0 ? -rawL : rawL;

  vec4 sdfSample = texture(uTerrainSdfTex, vUv);
  float sdf = (sdfSample.r - 0.5) * 2.0;
  vec2 sdfN = normalize(sdfSample.gb * 2.0 - 1.0 + vec2(1e-5, 0.0));

  int kind = int(texture(uTerrainKindTex, vUv).r * 255.0 + 0.5);
  int edgeKind = kind;
  if (edgeKind == 0 && sdf < 0.09) {
    vec2 inwardUv = clamp(vUv - sdfN * vec2(1.0 / 128.0, 1.0 / 72.0), vec2(0.0), vec2(1.0));
    edgeKind = int(texture(uTerrainKindTex, inwardUv).r * 255.0 + 0.5);
    if (edgeKind == 0) {
      int k1 = int(texture(uTerrainKindTex, clamp(vUv + vec2(1.0 / 128.0, 0.0), vec2(0.0), vec2(1.0))).r * 255.0 + 0.5);
      int k2 = int(texture(uTerrainKindTex, clamp(vUv - vec2(1.0 / 128.0, 0.0), vec2(0.0), vec2(1.0))).r * 255.0 + 0.5);
      int k3 = int(texture(uTerrainKindTex, clamp(vUv + vec2(0.0, 1.0 / 72.0), vec2(0.0), vec2(1.0))).r * 255.0 + 0.5);
      int k4 = int(texture(uTerrainKindTex, clamp(vUv - vec2(0.0, 1.0 / 72.0), vec2(0.0), vec2(1.0))).r * 255.0 + 0.5);
      if (k1 == 1 || k1 == 2 || k1 == 5) edgeKind = k1;
      else if (k2 == 1 || k2 == 2 || k2 == 5) edgeKind = k2;
      else if (k3 == 1 || k3 == 2 || k3 == 5) edgeKind = k3;
      else if (k4 == 1 || k4 == 2 || k4 == 5) edgeKind = k4;
    }
  }

  vec3 skyCol = computeBackdrop(worldPos, toSun);

  // Ambient occlusion shadow in air near solid walls
  float airAo = smoothstep(-0.02, 0.45, sdf);
  skyCol *= mix(0.60, 1.0, airAo);

  // Add ambient lantern halos in air
  for (int i = 0; i < 12; i++) {
    if (i >= uNumLanterns) break;
    vec2 lPos = uLanternPos[i];
    vec3 lCol = uLanternColor[i];
    float lRad = max(uLanternRadius[i], 0.25);
    float dist = length(worldPos - lPos);
    float flicker = 0.94 + 0.06 * sin(uTime * 3.8 + float(i) * 2.3);
    float halo = exp(-(dist * dist) / (lRad * lRad * 0.42)) * 0.42
               + exp(-(dist * dist) / (lRad * lRad * 1.70)) * 0.14;
    float core = (1.0 - smoothstep(0.02, 0.11, dist)) * 1.15;
    skyCol += lCol * (halo + core) * flicker;
  }

  // Gate (3) and Cracked Wall (4) are drawn as smooth exact geometry in Mechanism Pass
  bool isTerrainMat = (edgeKind == 1 || edgeKind == 2 || edgeKind == 5);
  float solidMask = isTerrainMat ? (1.0 - smoothstep(-0.014, 0.014, sdf)) : 0.0;

  if (solidMask <= 0.001) {
    // Subtle framing vignette
    vec2 vig = vUv * (1.0 - vUv);
    float vigFactor = clamp(pow(max(vig.x * vig.y * 18.0, 1e-4), 0.22), 0.78, 1.0);
    fragColor = vec4(skyCol * vigFactor, 1.0);
    return;
  }

  // 2.5D bevel normal for carved stone / crystal / obsidian edges
  float rimFactor = smoothstep(-0.20, 0.0, sdf);
  vec2 texNoiseGrad = vec2(
    noise2D(worldPos * 7.5 + vec2(0.04, 0.0)) - noise2D(worldPos * 7.5 - vec2(0.04, 0.0)),
    noise2D(worldPos * 7.5 + vec2(0.0, 0.04)) - noise2D(worldPos * 7.5 - vec2(0.0, 0.04))
  ) * 0.65;
  vec3 N3 = normalize(vec3(
    sdfN.x * (0.25 + 0.75 * rimFactor) + texNoiseGrad.x * 0.35,
    sdfN.y * (0.25 + 0.75 * rimFactor) + texNoiseGrad.y * 0.35,
    mix(0.85, 0.32, rimFactor)
  ));
  vec3 L3 = normalize(vec3(toSun.x, toSun.y, 0.58));
  float ndotl = max(dot(N3, L3), 0.0);
  vec3 H3 = normalize(L3 + vec3(0.0, 0.0, 1.0));

  vec3 matColor = vec3(0.0);

  if (edgeKind == 1) {
    // Ancient Sanctuary Basalt Ashlar Masonry
    float rowH = 0.44;
    float colW = 0.88;
    float rowIdx = floor(worldPos.y / rowH);
    float xOff = mod(rowIdx, 2.0) * (colW * 0.5);
    vec2 blockCoord = vec2((worldPos.x + xOff) / colW, worldPos.y / rowH);
    vec2 blockId = floor(blockCoord);
    vec2 blockF = fract(blockCoord);

    float mortarX = min(blockF.x, 1.0 - blockF.x) * colW;
    float mortarY = min(blockF.y, 1.0 - blockF.y) * rowH;
    float mortar = smoothstep(0.0, 0.032, min(mortarX, mortarY));
    float stoneVar = 0.88 + 0.24 * hash21(blockId);

    float grain = fbm(worldPos * 3.8 + blockId * 3.1);
    float microVein = smoothstep(0.46, 0.54, fbm(worldPos * 9.0 + vec2(4.2, 1.9)));

    vec3 baseRock = uRockTint * stoneVar * (0.68 + 0.48 * grain);
    baseRock = mix(baseRock * 0.78, baseRock * 1.18, microVein * 0.35);
    // Darken mortar seams & add top stone bevel highlight
    baseRock *= mix(0.46, 1.0, mortar);
    float blockTopBevel = (1.0 - smoothstep(0.015, 0.06, mortarY)) * step(0.5, blockF.y);
    baseRock += uSunColor * blockTopBevel * 0.08 * mortar;

    // Deep interior cavern darkening + edge bevel rim highlight
    float interiorDepth = smoothstep(-0.85, -0.02, sdf);
    vec3 litRock = baseRock * (0.34 + 0.58 * ndotl + 0.22 * interiorDepth);

    // Moss / ancient sanctuary lichen along upward-facing stone ledges
    float mossNoise = fbm(worldPos * 6.2 + vec2(9.1, 2.7));
    float mossMask = smoothstep(0.28, 0.72, sdfN.y) * smoothstep(-0.14, -0.01, sdf) * smoothstep(0.36, 0.68, mossNoise);
    vec3 mossCol = vec3(0.14, 0.38, 0.22) * (0.7 + 0.5 * mossNoise) + uSunColor * 0.14 * ndotl;
    litRock = mix(litRock, mossCol, mossMask * 0.78);

    // Sunlit bevel edge glow
    float rim = smoothstep(-0.075, 0.0, sdf) * max(dot(sdfN, toSun), 0.0);
    litRock += uSunColor * rim * 0.34;
    matColor = litRock;
  } else if (edgeKind == 2) {
    // Translucent Glacial Ice Crystal
    float facet = voronoiEdge(worldPos * 3.6);
    float fineFacet = voronoiEdge(worldPos * 7.8 + vec2(4.5, 1.2));
    float crystalPlane = smoothstep(0.02, 0.36, facet);
    float innerCracks = 1.0 - smoothstep(0.0, 0.055, fineFacet);

    vec3 refractedBg = mix(skyCol, vec3(0.42, 0.84, 0.98), 0.62);
    vec3 iceCore = mix(vec3(0.28, 0.70, 0.90), vec3(0.74, 0.95, 1.0), crystalPlane * 0.75 + 0.25 * ndotl);
    matColor = mix(refractedBg, iceCore, 0.68);
    matColor += vec3(0.88, 0.99, 1.0) * innerCracks * 0.28;

    float iceSpec = pow(max(dot(N3, H3), 1e-4), 42.0);
    float frostRim = smoothstep(-0.085, 0.0, sdf);
    matColor += vec3(0.82, 0.97, 1.0) * frostRim * 0.42;
    matColor += mix(uSunColor, vec3(0.9, 0.98, 1.0), 0.65) * iceSpec * 0.72;
  } else {
    // Quenched Volcanic Obsidian Glass
    float conchoidal = voronoiEdge(worldPos * 4.4);
    float ripple = sin(conchoidal * 28.0 + fbm(worldPos * 6.0) * 4.0) * 0.5 + 0.5;
    vec3 glassBase = mix(vec3(0.04, 0.035, 0.07), vec3(0.11, 0.08, 0.16), ripple * 0.65);
    float glassSpec = pow(max(dot(N3, H3), 1e-4), 64.0);
    float edgeSheen = smoothstep(-0.065, 0.0, sdf);
    // Subtle deep violet & cooling amber edge refraction flecks
    matColor = glassBase * (0.6 + 0.55 * ndotl);
    matColor += vec3(0.48, 0.34, 0.75) * edgeSheen * 0.28;
    matColor += mix(uSunColor, vec3(0.85, 0.72, 1.0), 0.5) * glassSpec * 0.85;
    float coolingFleck = (1.0 - smoothstep(0.0, 0.035, conchoidal)) * smoothstep(0.55, 0.85, noise2D(worldPos * 5.1));
    matColor += vec3(0.65, 0.24, 0.08) * coolingFleck * 0.25;
  }

  // Lantern diffuse & specular bounce onto terrain surfaces
  for (int i = 0; i < 12; i++) {
    if (i >= uNumLanterns) break;
    vec2 lPos = uLanternPos[i];
    vec3 lCol = uLanternColor[i];
    float lRad = max(uLanternRadius[i], 0.25);
    vec2 toL = lPos - worldPos;
    float dist = length(toL);
    float atten = exp(-(dist * dist) / (lRad * lRad * 0.58));
    vec3 lDir3 = normalize(vec3(toL, 0.45));
    float lDiff = max(dot(N3, lDir3), 0.0);
    float lRim = smoothstep(-0.09, 0.0, sdf) * max(dot(sdfN, normalize(toL + vec2(1e-5))), 0.0);
    matColor += lCol * atten * (lDiff * 0.38 + lRim * 0.45);
  }

  vec3 finalRgb = mix(skyCol, matColor, solidMask);

  // Subtle framing vignette
  vec2 vig = vUv * (1.0 - vUv);
  float vigFactor = clamp(pow(max(vig.x * vig.y * 18.0, 1e-4), 0.22), 0.78, 1.0);
  fragColor = vec4(finalRgb * vigFactor, 1.0);
}
`;

// Pass 3B: Procedural Mechanism Geometry Shader (Premultiplied Alpha)
export const MECHANISM_VS = `#version 300 es
precision highp float;

in vec2 aPos;
in vec2 aUv;
in vec4 aColor;
in vec4 aData; // [effectKind, param1, param2, param3]

uniform vec2 uWorldSize;

out vec2 vUv;
out vec2 vWorldPos;
out vec4 vColor;
out vec4 vData;

void main() {
  vec2 ndc = (aPos / uWorldSize) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
  vUv = aUv;
  vWorldPos = aPos;
  vColor = aColor;
  vData = aData;
}
`;

export const MECHANISM_FS = `#version 300 es
precision highp float;

in vec2 vUv;
in vec2 vWorldPos;
in vec4 vColor;
in vec4 vData;

uniform float uTime;
uniform vec2 uLightDir;
uniform vec3 uSunColor;

out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float voronoiEdge(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float md1 = 8.0;
  float md2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = vec2(hash21(n + g), hash21(n + g + vec2(41.7, 19.3)));
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < md1) { md2 = md1; md1 = d; }
      else if (d < md2) { md2 = d; }
    }
  }
  return sqrt(md2) - sqrt(md1);
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  return sdBox(p, b - vec2(r)) - r;
}

void main() {
  int kind = int(vData.x + 0.5);
  float p1 = vData.y;
  float p2 = vData.z;
  float p3 = vData.w;

  vec2 rawL = normalize(uLightDir + vec2(1e-5, 1e-4));
  vec2 toSun = rawL.y < 0.0 ? -rawL : rawL;

  vec3 rgb = vec3(0.0);
  float alpha = 0.0;
  vec3 additive = vec3(0.0);

  if (kind == 1) {
    // Drain Zone Grate
    float asp = max(p1, 0.2);
    vec2 p = (vUv - 0.5) * vec2(asp, 1.0);
    float frame = sdBox(p, vec2(asp * 0.5, 0.5));
    float inner = sdBox(p, vec2(asp * 0.5 - 0.06, 0.42));
    float frameMask = 1.0 - smoothstep(-0.01, 0.015, frame);
    float innerMask = 1.0 - smoothstep(-0.01, 0.01, inner);

    float bars = abs(fract(vUv.x * max(4.0, floor(asp * 6.0))) - 0.5);
    float barMask = 1.0 - smoothstep(0.11, 0.16, bars);
    float crossBar = 1.0 - smoothstep(0.035, 0.055, abs(vUv.y - 0.5));
    float metalMask = max(1.0 - innerMask, max(barMask, crossBar));

    float suction = (1.0 - smoothstep(0.0, 0.45, length(vUv - 0.5))) * (0.5 + 0.5 * sin(uTime * 4.0 + vUv.y * 12.0));
    vec3 abyss = vec3(0.02, 0.04, 0.07) + vec3(0.06, 0.24, 0.34) * suction * 0.6;
    vec3 bronze = mix(vec3(0.24, 0.18, 0.12), vec3(0.54, 0.42, 0.24), vUv.y * 0.5 + 0.25);

    rgb = mix(abyss, bronze, metalMask);
    alpha = frameMask * 0.88;
  } else if (kind == 2) {
    // Energy Conduit (p1 = chargeRatio, p2 = activated, p3 = length)
    float distCenter = abs(vUv.y - 0.5);
    float tubeMask = 1.0 - smoothstep(0.32, 0.48, distCenter);
    float coreMask = 1.0 - smoothstep(0.03, 0.22, distCenter);

    float flow = sin((vUv.x * max(p3, 1.0) * 4.5 - uTime * (1.8 + p1 * 3.0)) * 3.14159) * 0.5 + 0.5;
    float pulse = flow * flow * flow;

    vec3 dimCol = vec3(0.25, 0.20, 0.12);
    vec3 activeCol = mix(vec3(0.98, 0.72, 0.22), vec3(0.24, 0.92, 1.0), p2);
    float energy = max(0.25 * p1, p2 * 0.85) + pulse * (0.25 + 0.75 * max(p1, p2));

    rgb = dimCol * tubeMask * 0.45;
    alpha = tubeMask * 0.45;
    additive = activeCol * coreMask * energy * 0.85;
  } else if (kind == 3) {
    // Cistern Counterweight Sensor (p1 = fillRatio, p2 = activated, p3 = aspect)
    float asp = max(p3, 0.25);
    vec2 p = (vUv - 0.5) * vec2(asp, 1.0);
    float outer = sdRoundBox(p, vec2(asp * 0.5, 0.5), 0.06);
    float inner = sdRoundBox(p, vec2(asp * 0.5 - 0.07, 0.41), 0.03);

    float bodyMask = 1.0 - smoothstep(-0.01, 0.015, outer);
    float cavityMask = 1.0 - smoothstep(-0.01, 0.01, inner);

    vec3 frameBronze = mix(vec3(0.32, 0.23, 0.14), vec3(0.76, 0.58, 0.28), 0.35 + 0.4 * vUv.y + 0.25 * (1.0 - abs(vUv.x - 0.5)));
    // Corner rivets
    vec2 cornerP = abs(p) - vec2(asp * 0.5 - 0.04, 0.45);
    float rivet = 1.0 - smoothstep(0.014, 0.024, length(cornerP));
    frameBronze += vec3(0.35, 0.28, 0.15) * rivet;

    // Gauge ticks & inner backing
    float tick = (1.0 - smoothstep(0.004, 0.012, abs(fract(vUv.y * 8.0) - 0.5))) * step(0.68, vUv.x) * cavityMask;
    vec3 cavityBg = vec3(0.04, 0.07, 0.11) + vec3(0.35, 0.32, 0.20) * tick;

    // Glowing aqua level meter
    float fillLevel = 0.08 + 0.84 * clamp(p1, 0.0, 1.0);
    float meniscusWave = sin(vUv.x * 16.0 + uTime * 4.5) * 0.01;
    float fluidColMask = (1.0 - smoothstep(fillLevel + meniscusWave - 0.015, fillLevel + meniscusWave + 0.015, vUv.y)) * cavityMask;
    float meniscusLine = (1.0 - smoothstep(0.0, 0.024, abs(vUv.y - (fillLevel + meniscusWave)))) * cavityMask * step(0.01, p1);

    vec3 meterCol = mix(vec3(0.08, 0.58, 0.78), vec3(0.35, 0.96, 1.0), vUv.y * 0.5 + 0.35);
    if (p2 > 0.5) {
      meterCol = mix(meterCol, vec3(0.95, 0.88, 0.45), 0.45 + 0.2 * sin(uTime * 5.0));
    }

    vec3 inside = mix(cavityBg, meterCol, fluidColMask * 0.85);
    rgb = mix(frameBronze, inside, cavityMask);
    alpha = bodyMask * 0.92;
    additive = vec3(0.45, 0.98, 1.0) * meniscusLine * 0.75 + meterCol * fluidColMask * 0.25 + vec3(1.0, 0.84, 0.35) * p2 * bodyMask * 0.18;
  } else if (kind == 4) {
    // Relic Goal Sanctuary Altar (p1 = fulfilled, p2 = pulse, p3 = aspect)
    float asp = max(p3, 0.5);
    vec2 p = (vUv - 0.5) * vec2(asp, 1.0);
    float r = length(p * vec2(1.0, 1.05));
    float theta = atan(p.y, p.x + 1e-5);

    // Pedestal base at bottom
    float base = sdRoundBox(p - vec2(0.0, -0.36), vec2(asp * 0.42, 0.12), 0.03);
    float baseMask = 1.0 - smoothstep(-0.01, 0.015, base);
    vec3 stoneGold = mix(vec3(0.34, 0.28, 0.22), vec3(0.84, 0.68, 0.32), smoothstep(0.08, 0.14, vUv.y));

    // Shimmering portal ring
    float ringR = 0.36;
    float ring = 1.0 - smoothstep(0.015, 0.06, abs(r - ringR));
    float innerRing = 1.0 - smoothstep(0.005, 0.03, abs(r - ringR * 0.72));
    float ticks = 0.5 + 0.5 * cos(theta * 12.0 + uTime * (p1 > 0.5 ? 2.4 : 0.8));
    float coreAura = exp(-r * r * 14.0) * (0.45 + 0.35 * sin(uTime * 3.0) + p1 * 0.7);

    vec3 goldCol = vec3(1.0, 0.80, 0.32);
    vec3 aquaCol = vec3(0.28, 0.95, 1.0);
    vec3 portalCol = mix(aquaCol, goldCol, 0.4 + 0.4 * ticks + p1 * 0.3);

    rgb = stoneGold * baseMask;
    alpha = baseMask * 0.96;
    additive = portalCol * (ring * (0.52 + 0.48 * ticks) + innerRing * 0.35) * (0.55 + p2 * 0.35 + p1 * 0.38)
             + aquaCol * coreAura * 0.45;
  } else if (kind == 5) {
    // Magma Vent (p1 = heatRatio, p2 = quenched, p3 = steamPulse, vColor.a = aspect, vColor.r = goalQuench)
    float asp = max(vColor.a, 0.5);
    vec2 p = (vUv - 0.5) * vec2(asp, 1.0);
    float box = sdRoundBox(p, vec2(asp * 0.5, 0.5), 0.08);
    float edgeFade = 1.0 - smoothstep(-0.02, 0.015, box);
    float crack = voronoiEdge(vWorldPos * 3.2 + vec2(0.0, -uTime * 0.15 * (1.0 - p2)));
    float n = noise2D(vWorldPos * 5.0 + vec2(0.0, -uTime * 0.6 * (1.0 - p2)));

    float heat = clamp(p1, 0.0, 1.0) * (1.0 - p2);
    float vein = 1.0 - smoothstep(0.012, 0.11 * (0.45 + heat), crack);
    float coreGlow = 1.0 - smoothstep(0.06, 0.56, length((vUv - 0.5) * vec2(1.0, 1.15)));

    vec3 darkBasalt = vec3(0.07, 0.055, 0.075);
    vec3 obsidianQuenched = vec3(0.05, 0.045, 0.10) + vec3(0.32, 0.18, 0.45) * vein * 0.35;
    vec3 molten = mix(vec3(0.95, 0.20, 0.02), vec3(1.0, 0.90, 0.34), clamp(vein * 0.65 + coreGlow * 0.55 + n * 0.2, 0.0, 1.0));

    // Subtle golden seal trim if primary goal quench vent
    float rim = smoothstep(-0.08, -0.01, box) * vColor.r;
    vec3 baseCol = mix(darkBasalt, obsidianQuenched, p2);
    rgb = mix(baseCol, molten, vein * heat * 0.85);
    rgb = mix(rgb, vec3(0.75, 0.56, 0.24), rim * 0.55);
    alpha = edgeFade * 0.96;

    float pulse = 0.85 + 0.15 * sin(uTime * 5.2 + vWorldPos.x * 3.0);
    additive = molten * (vein * 0.75 + coreGlow * 0.55) * heat * pulse * edgeFade;
    additive += vec3(0.6, 0.75, 0.85) * p3 * coreGlow * 0.25 * p2;
  } else if (kind == 6) {
    // Cracked Basalt Wall (p1 = damage, p2 = stressGlow, p3 = aspect)
    float asp = max(p3, 0.25);
    vec2 p = (vUv - 0.5) * vec2(asp, 1.0);
    float box = sdRoundBox(p, vec2(asp * 0.5, 0.5), 0.03);
    float mask = 1.0 - smoothstep(-0.01, 0.012, box);

    // Stone blocks
    float seam = min(abs(fract(vWorldPos.x * 1.4) - 0.5), abs(fract(vWorldPos.y * 2.2) - 0.5));
    float stone = smoothstep(0.0, 0.05, seam);
    float grain = noise2D(vWorldPos * 5.5);
    vec3 rockCol = vColor.rgb * (0.62 + 0.38 * grain) * mix(0.55, 1.0, stone);

    // Fracture cracks scaling with damage & stressGlow
    float fissure = voronoiEdge(vWorldPos * 2.7 + vec2(1.4, 3.8));
    float crackWidth = mix(0.038, 0.105, clamp(p1 * 0.85 + p2 * 0.5, 0.0, 1.0));
    float crackMask = 1.0 - smoothstep(0.008, crackWidth, fissure);
    float glowAmt = clamp(0.18 + p1 * 0.9 + p2 * 0.85, 0.0, 1.35);

    vec3 emberCol = mix(vec3(0.95, 0.32, 0.05), vec3(1.0, 0.84, 0.36), clamp(glowAmt * 0.75, 0.0, 1.0));
    // Edge rim light
    float bevel = 1.0 - smoothstep(-0.06, 0.0, box);
    rockCol += uSunColor * (1.0 - bevel) * 0.14 * max(0.2, toSun.y);

    rgb = mix(rockCol, vec3(0.05, 0.03, 0.02), crackMask * 0.75);
    alpha = mask;
    additive = emberCol * crackMask * glowAmt * mask * 0.95;
  } else if (kind == 7) {
    // Sluice Gate Bulkhead (p1 = openProgress, p2 = isOpen, p3 = aspect)
    float asp = max(p3, 0.25);
    vec2 p = (vUv - 0.5) * vec2(asp, 1.0);
    float box = sdRoundBox(p, vec2(asp * 0.5, 0.5), 0.04);
    float mask = 1.0 - smoothstep(-0.01, 0.012, box);

    float border = smoothstep(-0.07, -0.04, box);
    float ribs = 1.0 - smoothstep(0.01, 0.04, abs(fract((p.x + p.y) * 1.4) - 0.5));
    float metalGrain = noise2D(vUv * vec2(18.0, 8.0));

    vec3 bronzeDark = vec3(0.22, 0.16, 0.10);
    vec3 bronzeBright = vec3(0.78, 0.58, 0.28);
    float sheen = 0.35 + 0.45 * vUv.y + 0.2 * (1.0 - abs(vUv.x - 0.5)) + 0.12 * metalGrain;
    vec3 metal = mix(bronzeDark, bronzeBright, clamp(sheen, 0.0, 1.0));
    metal = mix(metal, bronzeDark * 1.15, ribs * 0.35);
    metal += vec3(0.25, 0.20, 0.10) * border;

    // Corner bolts
    vec2 boltP = abs(p) - vec2(max(asp * 0.5 - 0.07, 0.02), 0.42);
    float bolt = 1.0 - smoothstep(0.016, 0.028, length(boltP));
    metal += vec3(0.4, 0.32, 0.18) * bolt;

    // Center glowing rune lock
    float runeR = length(p);
    float rune = 1.0 - smoothstep(0.004, 0.022, abs(runeR - 0.11));
    float runeCore = 1.0 - smoothstep(0.0, 0.055, runeR);
    vec3 runeCol = mix(vec3(1.0, 0.55, 0.16), vec3(0.25, 0.96, 1.0), p2);

    rgb = metal;
    alpha = mask;
    additive = runeCol * (rune * 0.9 + runeCore * 0.65) * mask * (0.65 + 0.35 * sin(uTime * 3.5));
  } else if (kind == 8) {
    // Sluice Gate Guide Rail
    float slot = 1.0 - smoothstep(0.15, 0.45, abs(vUv.x - 0.5));
    float dashes = 1.0 - smoothstep(0.15, 0.35, abs(fract(vUv.y * 6.0) - 0.5));
    rgb = vec3(0.10, 0.09, 0.08) + vec3(0.22, 0.18, 0.11) * dashes * 0.4;
    alpha = slot * 0.42;
  } else if (kind == 9) {
    // Rotating Brass Hydro-Turbine (p1 = chargeRatio, p2 = completed)
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float theta = atan(p.y, p.x + 1e-5);

    // Outer brass rim ring
    float rim = (1.0 - smoothstep(0.93, 0.98, r)) * smoothstep(0.78, 0.83, r);
    // 6 beveled paddles
    float sector = abs(mod(theta + 3.14159265, 1.04719755) - 0.52359877);
    float bladeWidth = mix(0.22, 0.085, clamp(r, 0.2, 0.95));
    float blades = (1.0 - smoothstep(bladeWidth - 0.04, bladeWidth, sector)) * smoothstep(0.22, 0.28, r) * (1.0 - smoothstep(0.88, 0.95, r));
    // Hub disc
    float hub = 1.0 - smoothstep(0.29, 0.34, r);

    float mask = max(rim, max(blades, hub));
    float spec = 0.5 + 0.5 * cos(theta - 0.8);
    vec3 brass = mix(vec3(0.32, 0.22, 0.10), vec3(0.95, 0.74, 0.32), 0.35 + 0.55 * spec + 0.25 * (1.0 - r));
    // Dark rivet dots on rim
    float rimRivet = 1.0 - smoothstep(0.02, 0.038, length(vec2(sector, r - 0.88)));
    brass = mix(brass, vec3(0.98, 0.88, 0.55), rimRivet * 0.6);

    // Glowing charge core
    float core = 1.0 - smoothstep(0.04, 0.22, r);
    vec3 coreCol = mix(vec3(0.95, 0.45, 0.12), vec3(0.24, 0.96, 1.0), clamp(p1, 0.0, 1.0));
    if (p2 > 0.5) {
      coreCol = mix(coreCol, vec3(0.82, 1.0, 0.98), 0.45 + 0.25 * sin(uTime * 5.0));
    }

    rgb = mix(brass, coreCol, core * 0.85);
    alpha = mask;
    additive = coreCol * core * (0.35 + 0.85 * clamp(p1, 0.0, 1.0) + 0.4 * p2);
  } else if (kind == 10) {
    // Relic Ark Boat Hull + Luminous Core Crystal (p1 = inGoal)
    vec2 p = (vUv - 0.5) * 2.0;
    // Crescent boat hull SDF
    float keelY = -0.68 + 0.72 * p.x * p.x;
    float deckY = 0.22 + 0.30 * p.x * p.x;
    float hullMask = smoothstep(-0.04, 0.04, p.y - keelY)
                   * (1.0 - smoothstep(-0.04, 0.04, p.y - deckY))
                   * (1.0 - smoothstep(0.88, 0.98, abs(p.x)));
    float goldTrim = (1.0 - smoothstep(0.02, 0.11, abs(p.y - deckY))) * hullMask
                   + (1.0 - smoothstep(0.02, 0.10, abs(p.y - keelY))) * hullMask;
    float planks = sin(p.y * 22.0) * 0.5 + 0.5;
    vec3 hullWood = mix(vec3(0.30, 0.18, 0.10), vec3(0.55, 0.34, 0.18), planks * 0.5 + 0.3);
    vec3 goldCol = vec3(0.96, 0.78, 0.30) * (0.75 + 0.25 * p.y);
    vec3 arkCol = mix(hullWood, goldCol, goldTrim);

    // Suspended Relic Crystal above deck
    vec2 cp = p - vec2(0.0, 0.38);
    float cDist = abs(cp.x) * 1.45 + abs(cp.y) * 0.95;
    float crystalMask = 1.0 - smoothstep(0.28, 0.36, cDist);
    float crystalCradle = (1.0 - smoothstep(0.015, 0.045, abs(length(cp) - 0.34))) * step(cp.y, 0.08);
    vec3 crysCol = mix(vec3(0.18, 0.82, 0.98), vec3(0.85, 1.0, 1.0), 1.0 - smoothstep(0.04, 0.28, cDist));
    if (p1 > 0.5) crysCol = mix(crysCol, vec3(1.0, 0.94, 0.58), 0.4);

    float totalMask = max(hullMask, max(crystalMask, crystalCradle));
    rgb = mix(arkCol, goldCol, crystalCradle);
    rgb = mix(rgb, crysCol, crystalMask);
    alpha = totalMask;
    additive = crysCol * exp(-dot(cp, cp) * 9.0) * (0.55 + 0.55 * p1);
  } else if (kind == 11) {
    // Relic Sphere Astrolabe Orb (p1 = inGoal)
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float sphereMask = 1.0 - smoothstep(0.78, 0.84, r);
    float outerRing = 1.0 - smoothstep(0.03, 0.09, abs(r - 0.90));
    float meridian = (1.0 - smoothstep(0.02, 0.06, abs(abs(p.x) - sqrt(max(0.0, 0.64 - p.y * p.y)) * 0.55))) * sphereMask;

    float sBase = max(0.0, 1.0 - length(p - vec2(-0.28, 0.32)) * 1.45);
    float spec = sBase * sBase * sBase;
    vec3 orbCol = mix(vec3(0.08, 0.45, 0.72), vec3(0.36, 0.95, 1.0), 0.3 + 0.5 * (1.0 - r));
    orbCol += vec3(0.85, 0.98, 1.0) * spec;
    vec3 goldRing = vec3(0.95, 0.76, 0.32);
    if (p1 > 0.5) orbCol = mix(orbCol, vec3(0.95, 0.92, 0.55), 0.35);

    rgb = mix(orbCol, goldRing, max(outerRing, meridian * 0.7));
    alpha = max(sphereMask, outerRing);
    additive = vec3(0.30, 0.92, 1.0) * exp(-r * r * 4.5) * (0.45 + 0.5 * p1);
  } else if (kind == 12) {
    // Brass Aqueduct Spout Nozzle (p1 = enabled)
    vec2 p = (vUv - 0.5) * 2.0;
    // Nozzle pointing +X in local frame
    float body = sdRoundBox(p, vec2(0.82, 0.62 - p.x * 0.12), 0.14);
    float collar = sdRoundBox(p - vec2(-0.55, 0.0), vec2(0.24, 0.78), 0.08);
    float mask = 1.0 - smoothstep(-0.02, 0.04, min(body, collar));
    float mouth = 1.0 - smoothstep(-0.02, 0.04, sdBox(p - vec2(0.64, 0.0), vec2(0.24, 0.36)));

    vec3 brass = mix(vec3(0.28, 0.20, 0.12), vec3(0.82, 0.64, 0.30), 0.5 + 0.35 * p.y - 0.15 * p.x);
    vec3 mouthCol = vec3(0.04, 0.08, 0.12) + vec3(0.18, 0.78, 0.96) * p1 * 0.55;
    rgb = mix(brass, mouthCol, mouth);
    alpha = mask;
    additive = vec3(0.24, 0.88, 1.0) * mouth * p1 * (0.4 + 0.2 * sin(uTime * 6.0));
  } else if (kind == 13) {
    // Turbine Stationary Outer Charge Arc (p1 = chargeRatio, p2 = completed)
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float theta = atan(p.x, p.y + 1e-5); // 0 at top, increases clockwise
    float angNorm = mod(theta + 6.2831853, 6.2831853) / 6.2831853;

    float track = 1.0 - smoothstep(0.012, 0.045, abs(r - 0.94));
    float filled = step(angNorm, clamp(p1, 0.0, 1.0)) * smoothstep(0.0, 0.015, p1);
    vec3 bgTrack = vec3(0.14, 0.14, 0.16);
    vec3 arcCol = mix(vec3(0.98, 0.72, 0.24), vec3(0.26, 0.96, 1.0), clamp(p1, 0.0, 1.0));
    if (p2 > 0.5) arcCol = vec3(0.45, 1.0, 0.88);

    rgb = bgTrack * track * 0.6;
    alpha = track * 0.65;
    additive = arcCol * track * filled * (0.85 + 0.35 * p2);
  } else if (kind == 14) {
    // Hydro-Portal Entry Ring (Warm Amber-Gold + Inward Swirling Vortex Aura, p1 = pulse)
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float theta = atan(p.y, p.x + 1e-5);
    float pulse = clamp(p1, 0.0, 2.0);
    float ringR = 0.68 + 0.03 * sin(uTime * 5.0) * (1.0 + pulse);

    // Inward logarithmic spiral vortex
    float spiral = sin(theta * 5.0 + log(max(r, 0.04)) * 8.5 + uTime * (4.2 + pulse * 4.0)) * 0.5 + 0.5;
    float swirlMask = (1.0 - smoothstep(0.05, ringR + 0.04, r)) * smoothstep(0.08, 0.42, r);
    float voidMask = 1.0 - smoothstep(0.42, 0.68, r);

    float outerRing = 1.0 - smoothstep(0.03, 0.095, abs(r - ringR));
    float innerRing = 1.0 - smoothstep(0.015, 0.05, abs(r - ringR * 0.74));
    float ticks = 0.5 + 0.5 * cos(theta * 12.0 + uTime * 2.4);
    float edgeSoft = 1.0 - smoothstep(0.82, 0.99, r);
    float halo = exp(-abs(r - ringR) * 8.5) * (0.42 + 0.60 * pulse) * edgeSoft;

    vec3 amberDeep = vec3(0.22, 0.07, 0.02);
    vec3 amberBright = vec3(1.0, 0.68, 0.18);
    vec3 goldWhite = vec3(1.0, 0.94, 0.62);
    vec3 vortexCol = mix(amberBright, goldWhite, spiral * 0.65 + pulse * 0.3);

    rgb = amberDeep;
    alpha = voidMask * 0.78;
    additive = vortexCol * (outerRing * (0.7 + 0.35 * ticks) + innerRing * 0.45 + swirlMask * spiral * 0.58 + halo) * (0.80 + 0.75 * pulse) * edgeSoft;
  } else if (kind == 15) {
    // Hydro-Portal Exit Ring (Luminous Cyan-Aqua + Outward Vortex Aura, p1 = pulse)
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float theta = atan(p.y, p.x + 1e-5);
    float pulse = clamp(p1, 0.0, 2.0);
    float ringR = 0.68 + 0.03 * sin(uTime * 5.2 + 1.1) * (1.0 + pulse);

    // Outward swirling vortex
    float spiral = sin(theta * 5.0 - log(max(r, 0.04)) * 8.5 - uTime * (4.6 + pulse * 4.5)) * 0.5 + 0.5;
    float swirlMask = (1.0 - smoothstep(0.05, ringR + 0.04, r)) * smoothstep(0.08, 0.42, r);
    float voidMask = 1.0 - smoothstep(0.42, 0.68, r);

    float outerRing = 1.0 - smoothstep(0.03, 0.095, abs(r - ringR));
    float innerRing = 1.0 - smoothstep(0.015, 0.05, abs(r - ringR * 0.74));
    float ticks = 0.5 + 0.5 * cos(theta * 12.0 - uTime * 2.6);
    float edgeSoft = 1.0 - smoothstep(0.82, 0.99, r);
    float halo = exp(-abs(r - ringR) * 8.5) * (0.42 + 0.60 * pulse) * edgeSoft;

    vec3 cyanDeep = vec3(0.02, 0.14, 0.22);
    vec3 cyanBright = vec3(0.18, 0.90, 1.0);
    vec3 aquaWhite = vec3(0.84, 1.0, 1.0);
    vec3 vortexCol = mix(cyanBright, aquaWhite, spiral * 0.6 + pulse * 0.35);

    rgb = cyanDeep;
    alpha = voidMask * 0.75;
    additive = vortexCol * (outerRing * (0.7 + 0.35 * ticks) + innerRing * 0.45 + swirlMask * spiral * 0.58 + halo) * (0.80 + 0.75 * pulse) * edgeSoft;
  } else if (kind == 16) {
    // Hydro-Portal Exit Directional Nozzle Beam (p1 = pulse, p2 = boostScale)
    float radial = abs(vUv.y - 0.5) * 2.0;
    float halfBeam = mix(0.42, 0.88, vUv.x);
    float beamMask = 1.0 - smoothstep(halfBeam * 0.55, halfBeam, radial);
    float axial = smoothstep(0.0, 0.14, vUv.x) * (1.0 - smoothstep(0.32, 1.0, vUv.x));

    // Directional chevron waves flowing outward along +X
    float chevronPhase = fract((vUv.x - radial * 0.32) * 3.2 - uTime * 2.8);
    float chevron = (1.0 - smoothstep(0.18, 0.45, abs(chevronPhase - 0.5)));
    float pulse = clamp(p1, 0.0, 2.0);

    vec3 beamCol = mix(vec3(0.16, 0.88, 1.0), vec3(0.86, 1.0, 1.0), chevron * 0.55 + pulse * 0.3);
    float strength = beamMask * axial * (0.38 + 0.42 * chevron + 0.65 * pulse);
    rgb = beamCol;
    alpha = strength * 0.22;
    additive = beamCol * strength * 0.78;
  } else if (kind == 17) {
    // Floating Spiked Dark-Brass Hydro-Mine (p1 = flash, p2 = submergedRatio)
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float theta = atan(p.y, p.x + 1e-5);

    // 8 protruding naval mine spikes
    float spikeSector = abs(mod(theta + 3.14159265, 0.78539816) - 0.39269908);
    float spikeTip = mix(0.12, 0.018, clamp((r - 0.65) / 0.31, 0.0, 1.0));
    float spikeMask = (1.0 - smoothstep(spikeTip - 0.02, spikeTip + 0.012, spikeSector))
                    * smoothstep(0.60, 0.66, r)
                    * (1.0 - smoothstep(0.91, 0.98, r));
    float sphereMask = 1.0 - smoothstep(0.67, 0.73, r);
    float mask = max(sphereMask, spikeMask);

    // Dark oxidized brass spherical hull + sharp metallic rim highlight
    vec3 rimCol = mix(vec3(0.12, 0.10, 0.09), vec3(0.55, 0.44, 0.28), clamp(0.45 + 0.55 * (p.y * 0.6 - p.x * 0.4), 0.0, 1.0));
    float sphereShade = clamp(0.35 + 0.65 * (0.5 + 0.5 * (-p.x * 0.45 + p.y * 0.72)), 0.0, 1.0);
    vec3 brassHull = mix(vec3(0.08, 0.07, 0.06), vec3(0.38, 0.30, 0.19), sphereShade);
    float rimHighlight = smoothstep(0.54, 0.69, r) * sphereMask * max(0.0, p.y * 0.7 - p.x * 0.35 + 0.25);
    brassHull += vec3(0.42, 0.36, 0.24) * rimHighlight;

    // Equatorial seam & rivet studs
    float band = 1.0 - smoothstep(0.04, 0.075, abs(p.y)) * sphereMask;
    brassHull = mix(brassHull * 0.85, brassHull, band);
    float stud = 1.0 - smoothstep(0.025, 0.048, length(vec2(spikeSector * 0.65, r - 0.55)));
    brassHull += vec3(0.28, 0.22, 0.14) * stud * sphereMask;

    // Pulsing crimson-amber explosive core & hazard vents
    float pulse = 0.55 + 0.45 * sin(uTime * 5.2 + p1 * 4.0);
    float flashBoost = clamp(p1, 0.0, 1.5);
    float coreGlow = 1.0 - smoothstep(0.05, 0.26, r);
    float hazardSlit = (1.0 - smoothstep(0.012, 0.036, abs(r - 0.38))) * step(0.12, spikeSector);
    vec3 crimsonCore = mix(vec3(0.95, 0.14, 0.04), vec3(1.0, 0.78, 0.22), coreGlow * 0.7 + flashBoost * 0.5);

    rgb = mix(rimCol, brassHull, sphereMask);
    rgb = mix(rgb, crimsonCore, max(coreGlow * 0.9, hazardSlit * 0.6));
    alpha = mask;
    additive = crimsonCore * (coreGlow * (0.65 + 0.6 * pulse + flashBoost) + hazardSlit * (0.35 + 0.4 * pulse + flashBoost)) * sphereMask;
  } else if (kind == 18) {
    // Hydraulic Seesaw Rotated Basalt-and-Brass Plank (p3 = aspect length/thickness)
    float asp = max(p3, 1.0);
    vec2 p = (vUv - 0.5) * vec2(asp, 1.0);
    float box = sdRoundBox(p, vec2(asp * 0.5, 0.5), 0.14);
    float mask = 1.0 - smoothstep(-0.02, 0.02, box);

    // Carved ancient basalt inner stone + beveled brass edge caps & rails
    float grain = noise2D(vWorldPos * 6.5);
    vec3 stone = vColor.rgb * (0.68 + 0.42 * grain);
    float edgeDist = -box;
    float brassRail = 1.0 - smoothstep(0.08, 0.14, edgeDist);
    float endCap = smoothstep(asp * 0.5 - 0.55, asp * 0.5 - 0.42, abs(p.x));
    float brassMask = max(brassRail, endCap);

    vec3 brass = mix(vec3(0.32, 0.24, 0.12), vec3(0.86, 0.66, 0.30), 0.35 + 0.55 * vUv.y);
    float bevelLight = (1.0 - smoothstep(0.0, 0.08, edgeDist)) * (0.3 + 0.7 * vUv.y);
    brass += uSunColor * bevelLight * 0.22;

    // Rivets along brass end caps
    vec2 rivetP = vec2(abs(p.x) - (asp * 0.5 - 0.28), abs(p.y) - 0.24);
    float rivet = 1.0 - smoothstep(0.035, 0.06, length(rivetP));
    brass += vec3(0.35, 0.28, 0.14) * rivet;

    rgb = mix(stone, brass, brassMask);
    alpha = mask;
  } else if (kind == 19) {
    // Hydraulic Seesaw Ornate Golden Fulcrum Pivot Hub
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float theta = atan(p.y, p.x + 1e-5);
    float mask = 1.0 - smoothstep(0.88, 0.94, r);

    float outerRing = 1.0 - smoothstep(0.76, 0.84, r);
    float innerCap = 1.0 - smoothstep(0.38, 0.44, r);
    float sector = abs(mod(theta + 3.14159265, 1.04719755) - 0.52359877);
    float rivet = 1.0 - smoothstep(0.04, 0.07, length(vec2(sector * 0.62, r - 0.62)));

    vec3 darkBronze = vec3(0.24, 0.17, 0.09);
    vec3 gold = mix(vec3(0.62, 0.45, 0.18), vec3(0.98, 0.80, 0.34), 0.45 + 0.45 * p.y - 0.2 * p.x);
    rgb = mix(darkBronze, gold, outerRing * 0.45 + innerCap * 0.75 + rivet * 0.8);
    rgb += uSunColor * (1.0 - smoothstep(0.0, 0.12, abs(r - 0.84))) * 0.25;
    alpha = mask;
  } else if (kind == 20) {
    // Interactive Diverter Valve Beveled Bronze Vane (p1 = toggled, p3 = aspect)
    float asp = max(p3, 1.0);
    vec2 p = (vUv - 0.5) * vec2(asp, 1.0);
    float box = sdRoundBox(p, vec2(asp * 0.5, 0.5), 0.16);
    float mask = 1.0 - smoothstep(-0.02, 0.02, box);

    float ridge = 1.0 - smoothstep(0.03, 0.11, abs(p.y));
    float border = 1.0 - smoothstep(0.04, 0.10, -box);
    vec3 bronze = mix(vec3(0.28, 0.20, 0.11), vec3(0.84, 0.62, 0.28), 0.35 + 0.5 * vUv.y);
    bronze += vec3(0.26, 0.22, 0.12) * border;

    vec3 mintTeal = vec3(0.369, 0.918, 0.831);
    vec3 brassGold = vec3(0.988, 0.827, 0.302);
    vec3 inlayCol = mix(mintTeal, brassGold, p1 * 0.45);

    rgb = mix(bronze, inlayCol, ridge * 0.65);
    alpha = mask;
    additive = inlayCol * ridge * 0.35 * mask;
  } else if (kind == 21) {
    // Interactive Diverter Valve Luminous Clickable Hub Button (#5eead4 / #fcd34d brass ring, p1 = toggled)
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float theta = atan(p.y, p.x + 1e-5);

    vec3 mintAqua = vec3(0.369, 0.918, 0.831);  // #5eead4
    vec3 brassGold = vec3(0.988, 0.827, 0.302); // #fcd34d

    float outerBezel = 1.0 - smoothstep(0.84, 0.91, r);
    float brassRing = (1.0 - smoothstep(0.78, 0.84, r)) * smoothstep(0.48, 0.54, r);
    float innerOrb = 1.0 - smoothstep(0.46, 0.52, r);
    float ticks = 0.5 + 0.5 * cos(theta * 4.0 + (p1 > 0.5 ? 0.7854 : 0.0));

    float pulse = 0.82 + 0.18 * sin(uTime * 4.0);
    float glint = exp(-dot(p - vec2(-0.14, 0.18), p - vec2(-0.14, 0.18)) * 18.0);
    vec3 ringCol = brassGold * (0.78 + 0.22 * (p.y + ticks * 0.4));
    vec3 coreCol = mix(mintAqua, vec3(0.88, 1.0, 0.97), glint * 0.75 + (1.0 - smoothstep(0.0, 0.25, r)) * 0.35);
    if (p1 > 0.5) {
      coreCol = mix(coreCol, brassGold, 0.28);
    }

    vec3 darkRim = vec3(0.08, 0.10, 0.12);
    rgb = mix(darkRim, ringCol, brassRing);
    rgb = mix(rgb, coreCol, innerOrb);
    alpha = outerBezel;

    float outerHalo = exp(-abs(r - 0.72) * 5.2) * (0.42 + 0.18 * sin(uTime * 3.2));
    additive = (coreCol * innerOrb * 0.55 + mix(mintAqua, brassGold, 0.5) * outerHalo) * pulse;
  } else if (kind == 22) {
    // Hydro-Relay Tesla Arc Filament (p1 = charge, p2 = active, p3 = length)
    float charge = clamp(p1, 0.0, 1.0);
    float endEnv = sin(clamp(vUv.x, 0.0, 1.0) * 3.14159265);
    float amp = mix(0.04, 0.15, max(charge, p2));

    float jag1 = (sin(vUv.x * max(p3, 1.0) * 9.0 - uTime * 20.0) * 0.6
                + sin(vUv.x * max(p3, 1.0) * 19.0 + uTime * 31.0) * 0.4) * amp * endEnv;
    float jag2 = (sin(vUv.x * max(p3, 1.0) * 11.0 + uTime * 24.0 + 1.8) * 0.55
                + cos(vUv.x * max(p3, 1.0) * 23.0 - uTime * 27.0) * 0.45) * amp * 1.15 * endEnv;

    float d1 = abs(vUv.y - 0.5 - jag1);
    float d2 = abs(vUv.y - 0.5 - jag2);
    float arc1 = 1.0 - smoothstep(0.015, 0.085, d1);
    float arc2 = 1.0 - smoothstep(0.015, 0.075, d2);
    float glow = exp(-d1 * 7.5) * 0.65 + exp(-d2 * 8.5) * 0.45;

    // Subtle dormant guide line when charge is near zero
    float guideDot = (1.0 - smoothstep(0.03, 0.09, abs(vUv.y - 0.5)))
                   * step(0.45, fract(vUv.x * max(p3, 1.0) * 3.0)) * 0.22;

    vec3 copperDim = vec3(0.76, 0.45, 0.20);
    vec3 teslaCyan = vec3(0.24, 0.94, 1.0);
    vec3 arcCol = mix(copperDim, teslaCyan, smoothstep(0.05, 0.55, charge) + p2 * 0.5);
    vec3 coreWhite = mix(arcCol, vec3(0.88, 1.0, 1.0), 0.72);

    float intensity = max(0.15, charge * 0.95 + p2 * 0.55);
    rgb = arcCol;
    alpha = guideDot * (1.0 - charge) * 0.4;
    additive = (coreWhite * (arc1 + arc2 * 0.7) * 0.85 + arcCol * glow * 0.75) * intensity * endEnv + copperDim * guideDot;
  } else if (kind == 23) {
    // Hydro-Relay Copper/Cyan Tesla Electrode Pylon (p1 = charge, p2 = active, p3 = isObjective)
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float charge = clamp(p1, 0.0, 1.0);

    float baseMask = 1.0 - smoothstep(0.84, 0.91, r);
    // Concentric copper coil rings
    float coilWave = 0.5 + 0.5 * cos(r * 24.0);
    float coilMask = (1.0 - smoothstep(0.76, 0.83, r)) * smoothstep(0.32, 0.38, r);
    float coreOrb = 1.0 - smoothstep(0.26, 0.34, r);

    vec3 copperDark = vec3(0.36, 0.19, 0.09);
    vec3 copperBright = vec3(0.88, 0.54, 0.24);
    vec3 cyanGlow = vec3(0.22, 0.95, 1.0);
    vec3 coilCol = mix(copperDark, copperBright, coilWave * 0.8 + 0.2);

    // Energize coils & orb from warm copper to electric cyan with charge
    float energize = clamp(charge * 0.9 + p2 * 0.4, 0.0, 1.0);
    coilCol = mix(coilCol, cyanGlow, energize * coilWave * 0.52);
    vec3 orbCol = mix(vec3(0.85, 0.45, 0.16), vec3(0.62, 0.98, 1.0), energize);

    // Optional objective gold collar
    float objRing = (1.0 - smoothstep(0.018, 0.045, abs(r - 0.83))) * p3;
    coilCol = mix(coilCol, vec3(0.98, 0.82, 0.32), objRing * 0.85);

    rgb = mix(vec3(0.10, 0.09, 0.11), coilCol, coilMask);
    rgb = mix(rgb, orbCol, coreOrb);
    alpha = baseMask;

    float pulse = 0.78 + 0.22 * sin(uTime * 6.0);
    additive = cyanGlow * (coreOrb * (0.18 + 0.65 * energize) + coilMask * coilWave * energize * 0.35) * pulse
             + vec3(0.95, 0.68, 0.26) * objRing * 0.30;
  } else if (kind == 24) {
    // Geyser Pump Animated Cyan Hydro-Jet Plume Cone (p1 = power, p2 = active, p3 = range)
    float power = clamp(p1, 0.0, 1.0);
    if (power <= 0.01) discard;

    float halfCone = mix(0.18, 0.48, vUv.x);
    float radial = abs(vUv.y - 0.5) / max(halfCone, 0.05);
    float coneMask = 1.0 - smoothstep(0.62, 1.0, radial);
    float axialFade = smoothstep(0.0, 0.08, vUv.x) * (1.0 - smoothstep(0.50, 1.0, vUv.x));

    float flowWave = 0.5 + 0.5 * sin(vUv.x * max(p3, 1.0) * 8.5 - uTime * 15.0 - radial * 2.2);
    float coreJet = (1.0 - smoothstep(0.0, 0.48, radial)) * (1.0 - smoothstep(0.20, 0.82, vUv.x));
    vec3 cyanPlume = mix(vec3(0.14, 0.78, 0.98), vec3(0.82, 0.99, 1.0), coreJet);

    float strength = coneMask * axialFade * (0.45 + 0.55 * flowWave) * power;
    rgb = cyanPlume;
    alpha = strength * 0.26;
    additive = cyanPlume * strength * 0.92;
  } else if (kind == 25) {
    // Geyser Pump Bronze Directional Nozzle Housing (p1 = power, p2 = active)
    vec2 p = (vUv - 0.5) * 2.0;
    float baseBlock = sdRoundBox(p - vec2(-0.34, 0.0), vec2(0.46, 0.72), 0.14);
    float barrel = sdRoundBox(p - vec2(0.16, 0.0), vec2(0.56, 0.48 - p.x * 0.06), 0.10);
    float muzzleCollar = sdRoundBox(p - vec2(0.58, 0.0), vec2(0.16, 0.64), 0.06);
    float bodySdf = min(baseBlock, min(barrel, muzzleCollar));
    float mask = 1.0 - smoothstep(-0.03, 0.03, bodySdf);
    float throat = 1.0 - smoothstep(-0.02, 0.03, sdBox(p - vec2(0.64, 0.0), vec2(0.22, 0.34)));

    vec3 bronzeDark = vec3(0.24, 0.17, 0.10);
    vec3 bronzeBright = vec3(0.82, 0.62, 0.28);
    vec3 housing = mix(bronzeDark, bronzeBright, clamp(0.45 + 0.42 * p.y - 0.15 * p.x, 0.0, 1.0));
    float rim = 1.0 - smoothstep(0.0, 0.12, -bodySdf);
    housing += uSunColor * rim * 0.16 * max(0.2, p.y + 0.4);

    // Pressurized throat & status pressure orb
    float gaugeOrb = 1.0 - smoothstep(0.12, 0.20, length(p - vec2(-0.22, 0.0)));
    vec3 statusCol = mix(vec3(0.98, 0.58, 0.15), vec3(0.22, 0.96, 1.0), clamp(p1 + p2 * 0.5, 0.0, 1.0));
    vec3 throatCol = vec3(0.04, 0.08, 0.12) + vec3(0.18, 0.85, 1.0) * clamp(p1, 0.0, 1.0) * 0.65;

    rgb = mix(housing, throatCol, throat);
    rgb = mix(rgb, statusCol, gaugeOrb);
    alpha = mask;
    additive = statusCol * gaugeOrb * (0.45 + 0.75 * clamp(p1, 0.0, 1.0))
             + vec3(0.22, 0.92, 1.0) * throat * clamp(p1, 0.0, 1.0) * 0.55;
  }

  fragColor = vec4(rgb * alpha + additive, alpha);
}
`;

// Pass 4: Optical Water Surface Composite (Refraction, Caustics, Beer-Lambert, Fresnel, Foam)
export const WATER_COMPOSITE_FS = `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uFluidTex;
uniform sampler2D uSceneTex;
uniform sampler2D uTerrainSdfTex;

uniform vec2 uWorldSize;
uniform float uTime;
uniform float uIsFloat;
uniform float uQuality;

uniform vec3 uWaterDeep;
uniform vec3 uWaterShallow;
uniform vec3 uSkyTop;
uniform vec3 uSkyBottom;
uniform vec2 uLightDir;
uniform vec3 uSunColor;

uniform int uNumLanterns;
uniform vec2 uLanternPos[12];
uniform vec3 uLanternColor[12];
uniform float uLanternRadius[12];

out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float causticLayer(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float minD = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hash21(i + g), hash21(i + g + vec2(17.3, 43.1)));
      o = 0.5 + 0.42 * sin(uTime * 1.45 + 6.2831 * o);
      float d = length(g + o - f);
      minD = min(minD, d);
    }
  }
  return pow(clamp(minD, 1e-4, 1.0), 3.4);
}

float sampleDensity(vec2 uv) {
  float r = texture(uFluidTex, uv).r;
  return r * (uIsFloat > 0.5 ? 1.0 : 1.75);
}

void main() {
  vec3 sceneCol = texture(uSceneTex, vUv).rgb;
  vec4 raw = texture(uFluidTex, vUv);
  float densityScale = uIsFloat > 0.5 ? 1.0 : 1.75;
  float density = raw.r * densityScale;

  if (density < 0.09) {
    fragColor = vec4(sceneCol, 1.0);
    return;
  }

  float waterAlpha = smoothstep(0.14, 0.28, density);
  if (waterAlpha <= 0.001) {
    fragColor = vec4(sceneCol, 1.0);
    return;
  }

  vec2 worldPos = vUv * uWorldSize;
  vec2 rawL = normalize(uLightDir + vec2(1e-5, 1e-4));
  vec2 toSun = rawL.y < 0.0 ? -rawL : rawL;

  // Unpack velocity & foam from fluid field
  vec2 vel = vec2(0.0);
  float foam = 0.0;
  if (raw.r > 0.002) {
    if (uIsFloat > 0.5) {
      vel = raw.gb / raw.r;
      foam = raw.a / raw.r;
    } else {
      vel = (raw.gb / raw.r - 0.5) * 2.0;
      foam = raw.a / raw.r;
    }
    vel *= 16.0;
  }

  // Smooth density gradient + curvature for liquid surface normals & foam crests
  vec2 eps = vec2(0.044 / uWorldSize.x, 0.044 / uWorldSize.y);
  float dL = sampleDensity(vUv - vec2(eps.x, 0.0));
  float dR = sampleDensity(vUv + vec2(eps.x, 0.0));
  float dD = sampleDensity(vUv - vec2(0.0, eps.y));
  float dU = sampleDensity(vUv + vec2(0.0, eps.y));
  vec2 grad = vec2(dR - dL, dU - dD);
  float laplacian = dL + dR + dD + dU - 4.0 * density;

  // Attenuate density-grid gradient inside deep pool cores so liquid stays glassy-smooth
  float surfaceBand = 1.0 - smoothstep(0.32, 0.95, density);
  vec2 smoothGrad = grad * (0.35 + 0.65 * surfaceBand);

  // Velocity-advected animated capillary micro-wave ripples
  vec2 flowShift = vel * 0.045;
  vec2 wp1 = worldPos * 3.6 - flowShift + vec2(uTime * 0.85, -uTime * 0.52);
  vec2 wp2 = worldPos * 7.4 - flowShift * 1.4 + vec2(-uTime * 0.65, uTime * 1.05);
  float speedBoost = 1.0 + clamp(length(vel) * 0.18, 0.0, 1.1);
  vec2 rippleGrad = vec2(
    cos(wp1.x * 1.3 + sin(wp1.y)) * 0.55 + cos(wp2.x - wp2.y * 0.8) * 0.45,
    sin(wp1.y * 1.4 + cos(wp1.x)) * 0.55 + sin(wp2.y + wp2.x * 0.7) * 0.45
  ) * 0.048 * speedBoost;

  vec3 N = normalize(vec3(-smoothGrad.x * 2.4 + rippleGrad.x, -smoothGrad.y * 2.4 + rippleGrad.y, 0.52));

  // Snell's Law refraction + chromatic RGB dispersion on steep crests
  vec3 refractedRay = refract(vec3(0.0, 0.0, -1.0), N, 0.75);
  vec2 refractOffset = refractedRay.xy * 0.046 * vec2(uWorldSize.y / uWorldSize.x, 1.0);
  float dispScale = (0.04 + 0.06 * uQuality) * (0.35 + 0.65 * length(N.xy));

  vec2 uvR = clamp(vUv + refractOffset * (1.0 - dispScale), vec2(0.001), vec2(0.999));
  vec2 uvG = clamp(vUv + refractOffset, vec2(0.001), vec2(0.999));
  vec2 uvB = clamp(vUv + refractOffset * (1.0 + dispScale), vec2(0.001), vec2(0.999));

  vec3 refractedScene = vec3(
    texture(uSceneTex, uvR).r,
    texture(uSceneTex, uvG).g,
    texture(uSceneTex, uvB).b
  );

  // Animated underwater caustics projected onto refracted background
  float terrainSdf = (texture(uTerrainSdfTex, uvG).r - 0.5) * 2.0;
  float localSdf = (texture(uTerrainSdfTex, vUv).r - 0.5) * 2.0;
  vec2 causticPos = worldPos * 1.65 - toSun * 0.35 + N.xy * 0.42;
  float c1 = causticLayer(causticPos + vec2(uTime * 0.14, -uTime * 0.09));
  float c2 = uQuality > 0.5 ? causticLayer(causticPos * 1.37 - vec2(uTime * 0.11, uTime * 0.12)) : c1;
  float caustics = (c1 * 0.6 + c2 * 0.4) * 1.45;
  float causticVisibility = (1.0 - smoothstep(0.2, 2.4, density)) * (0.55 + 0.45 * (1.0 - smoothstep(0.0, 0.6, abs(terrainSdf))));
  refractedScene += mix(uWaterShallow, uSunColor, 0.55) * caustics * causticVisibility * 0.42;

  // Beer-Lambert optical absorption (shallow bright turquoise -> deep rich sapphire)
  float opticalDepth = clamp(density * 0.85, 0.0, 2.2) * (0.62 + 0.38 * clamp(terrainSdf + 0.25, 0.0, 1.0));
  vec3 sigma = (vec3(1.0) - clamp(uWaterDeep, 0.02, 0.92)) * vec3(1.85, 1.05, 0.62);
  vec3 transmittance = exp(-sigma * opticalDepth);
  vec3 scatterCol = mix(uWaterShallow, uWaterDeep, smoothstep(0.18, 1.35, opticalDepth));
  vec3 waterBody = refractedScene * transmittance + scatterCol * (1.0 - transmittance) * 0.72;

  // Subsurface turquoise glow in sunlit thin wave crests
  float thinCrest = (1.0 - smoothstep(0.16, 0.55, density)) * max(0.0, dot(N.xy, toSun) * 0.5 + 0.5);
  waterBody += uWaterShallow * thinCrest * 0.22;

  // Schlick Fresnel reflection + Sun Specular Glints
  float cosTheta = clamp(N.z, 0.0, 1.0);
  float omc = 1.0 - cosTheta;
  float fresnel = 0.04 + 0.96 * (omc * omc * omc * omc);
  vec3 reflDir = reflect(vec3(0.0, 0.0, -1.0), N);
  vec3 skyRefl = mix(uSkyBottom, uSkyTop, clamp(0.5 + reflDir.y * 0.85, 0.0, 1.0));

  vec3 L3 = normalize(vec3(toSun.x, toSun.y, 0.72));
  vec3 H3 = normalize(L3 + vec3(0.0, 0.0, 1.0));
  float ndoth = max(dot(N, H3), 1e-4);
  float specSharp = pow(ndoth, 72.0);
  float specBroad = pow(ndoth, 14.0);

  vec3 waterColor = mix(waterBody, skyRefl, fresnel * 0.62);
  waterColor += uSunColor * (specSharp * 1.45 + specBroad * 0.16);

  // Warm Lantern reflections on water ripples
  for (int i = 0; i < 12; i++) {
    if (i >= uNumLanterns) break;
    vec2 toL = uLanternPos[i] - worldPos;
    float dist = length(toL);
    float rad = max(uLanternRadius[i], 0.25);
    float atten = exp(-(dist * dist) / (rad * rad * 0.65));
    vec3 lDir3 = normalize(vec3(toL, 0.65));
    vec3 lH = normalize(lDir3 + vec3(0.0, 0.0, 1.0));
    float lSpec = pow(max(dot(N, lH), 1e-4), 28.0);
    waterColor += uLanternColor[i] * atten * (0.14 + lSpec * 0.85);
  }

  // Whitewater Foam & crisp air-water meniscus (suppressed against rock floor/wall borders)
  float airBorder = smoothstep(0.02, 0.15, localSdf);
  float crestFactor = clamp((length(grad) * 1.35 - laplacian * 0.45) * surfaceBand, 0.0, 1.0);
  float meniscus = smoothstep(0.14, 0.21, density) * (1.0 - smoothstep(0.21, 0.34, density)) * airBorder;
  float bubbleTex = noise2D(worldPos * 16.0 - flowShift * 1.6) * 0.65 + noise2D(worldPos * 32.0 + uTime * 0.8) * 0.35;
  float foamTrigger = smoothstep(0.28, 0.90, foam * 0.88 + crestFactor * 0.42);
  float foamStrength = foamTrigger * (0.35 + 0.65 * smoothstep(0.32, 0.78, bubbleTex));
  foamStrength = clamp(foamStrength * 0.78 + meniscus * 0.55, 0.0, 0.92);

  vec3 foamColor = mix(uWaterShallow * 1.1 + 0.25, vec3(0.95, 0.99, 1.0), 0.84);
  waterColor = mix(waterColor, foamColor, foamStrength);

  vec3 finalRgb = mix(sceneCol, waterColor, waterAlpha);
  fragColor = vec4(finalRgb, 1.0);
}
`;

// Airborne Spray Droplets (Instanced Velocity-Stretched Quads)
export const SPRAY_VS = `#version 300 es
precision highp float;

in vec2 aCorner;      // [-1, 1]^2 quad corner
in vec4 aInstPosVel;  // [x, y, vx, vy]
in vec2 aInstLife;    // [life, maxLife]

uniform vec2 uWorldSize;

out vec2 vLocal;
out float vAlpha;

void main() {
  vec2 pos = aInstPosVel.xy;
  vec2 vel = aInstPosVel.zw;
  float speed = length(vel);
  vec2 dir = speed > 0.05 ? vel / speed : vec2(0.0, 1.0);
  vec2 perp = vec2(-dir.y, dir.x);

  float lifeRatio = clamp(aInstLife.x / max(aInstLife.y, 0.001), 0.0, 1.0);
  float radius = 0.026 * (0.65 + 0.35 * lifeRatio);
  float stretch = 1.0 + min(speed * 0.26, 2.2);

  vec2 world = pos + perp * (aCorner.x * radius) + dir * (aCorner.y * radius * stretch);
  vec2 ndc = (world / uWorldSize) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);

  vLocal = aCorner;
  vAlpha = smoothstep(0.0, 0.28, lifeRatio);
}
`;

export const SPRAY_FS = `#version 300 es
precision highp float;

in vec2 vLocal;
in float vAlpha;

uniform vec3 uWaterShallow;
uniform vec3 uSunColor;

out vec4 fragColor;

void main() {
  float r2 = dot(vLocal, vLocal);
  if (r2 > 1.0) discard;
  float disc = 1.0 - smoothstep(0.2, 1.0, r2);
  float glint = exp(-dot(vLocal - vec2(-0.2, 0.25), vLocal - vec2(-0.2, 0.25)) * 7.0);
  vec3 col = mix(uWaterShallow * 0.8 + 0.3, vec3(0.95, 0.99, 1.0), 0.65) + uSunColor * glint * 0.65;
  float a = disc * vAlpha * 0.85;
  fragColor = vec4(col * a, a);
}
`;

// Airborne Steam Plumes (Instanced Soft Billowing Quads)
export const STEAM_VS = `#version 300 es
precision highp float;

in vec2 aCorner;
in vec4 aInstPosVel;
in vec2 aInstLife;

uniform vec2 uWorldSize;

out vec2 vLocal;
out float vAlpha;
out float vSeed;

void main() {
  vec2 pos = aInstPosVel.xy;
  vec2 vel = aInstPosVel.zw;
  float speed = length(vel);
  vec2 dir = speed > 0.05 ? vel / speed : vec2(0.0, 1.0);
  vec2 perp = vec2(-dir.y, dir.x);

  float lifeRatio = clamp(aInstLife.x / max(aInstLife.y, 0.001), 0.0, 1.0);
  float age = 1.0 - lifeRatio;
  float radius = mix(0.08, 0.24, age);
  float stretch = 1.0 + min(speed * 0.12, 0.45);

  vec2 world = pos + perp * (aCorner.x * radius) + dir * (aCorner.y * radius * stretch);
  vec2 ndc = (world / uWorldSize) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);

  vLocal = aCorner;
  vAlpha = smoothstep(0.0, 0.35, lifeRatio) * (1.0 - smoothstep(0.84, 1.0, lifeRatio));
  vSeed = fract(sin(dot(pos, vec2(12.9898, 78.233))) * 43758.5453);
}
`;

export const STEAM_FS = `#version 300 es
precision highp float;

in vec2 vLocal;
in float vAlpha;
in float vSeed;

uniform float uTime;
uniform vec3 uSunColor;

out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

void main() {
  float r = length(vLocal);
  if (r > 1.0) discard;
  float wisp = noise2D(vLocal * 2.2 + vec2(vSeed * 10.0, -uTime * 0.7));
  float puff = 1.0 - smoothstep(0.15, 1.0, r + (wisp - 0.5) * 0.38);
  vec3 steamCol = mix(vec3(0.76, 0.84, 0.90), vec3(0.98, 0.98, 0.96) + uSunColor * 0.12, 0.45 + 0.55 * vLocal.y);
  float a = puff * vAlpha * 0.34;
  fragColor = vec4(steamCol * a, a);
}
`;

// Airborne Rotating Debris Chunks (Rock, Ice Shards, Magma Embers)
export const DEBRIS_VS = `#version 300 es
precision highp float;

in vec2 aCorner;
in vec4 aInstGeom; // [x, y, angle, size]
in vec3 aInstMeta; // [life, maxLife, kindFloat]

uniform vec2 uWorldSize;

out vec2 vLocal;
out float vAlpha;
out float vKind;

void main() {
  vec2 pos = aInstGeom.xy;
  float ang = aInstGeom.z;
  float sz = aInstGeom.w;
  float c = cos(ang);
  float s = sin(ang);
  vec2 rotCorner = vec2(aCorner.x * c - aCorner.y * s, aCorner.x * s + aCorner.y * c);

  vec2 world = pos + rotCorner * sz;
  vec2 ndc = (world / uWorldSize) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);

  float lifeRatio = clamp(aInstMeta.x / max(aInstMeta.y, 0.001), 0.0, 1.0);
  vLocal = aCorner;
  vAlpha = smoothstep(0.0, 0.25, lifeRatio);
  vKind = aInstMeta.z;
}
`;

export const DEBRIS_FS = `#version 300 es
precision highp float;

in vec2 vLocal;
in float vAlpha;
in float vKind;

uniform vec3 uRockTint;
uniform vec3 uSunColor;

out vec4 fragColor;

void main() {
  int kind = int(vKind + 0.5);
  // Angular polygonal shard shape
  float poly = max(abs(vLocal.x) * 0.85 + abs(vLocal.y) * 0.55, abs(vLocal.y) * 0.95);
  float mask = 1.0 - smoothstep(0.68, 0.86, poly);
  if (mask <= 0.001) discard;

  vec3 col = vec3(0.0);
  vec3 glow = vec3(0.0);

  if (kind == 0) {
    // Fractured basalt rock chip
    float shade = 0.55 + 0.45 * (vLocal.y * 0.5 + 0.5);
    col = uRockTint * shade + uSunColor * max(0.0, vLocal.y) * 0.16;
  } else if (kind == 1) {
    // Sparkling ice crystal shard
    float facet = step(0.0, vLocal.x + vLocal.y * 0.5);
    col = mix(vec3(0.55, 0.90, 1.0), vec3(0.92, 0.99, 1.0), facet * 0.7);
    glow = vec3(0.35, 0.85, 1.0) * 0.25;
  } else {
    // Incandescent magma ember
    float core = 1.0 - smoothstep(0.0, 0.7, length(vLocal));
    col = mix(vec3(1.0, 0.30, 0.05), vec3(1.0, 0.92, 0.48), core);
    glow = col * 0.85;
  }

  float a = mask * vAlpha;
  fragColor = vec4(col * a + glow * vAlpha, a);
}
`;
