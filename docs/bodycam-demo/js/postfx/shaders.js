export const fullscreenVertex = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const colorMath = /* glsl */`
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 toSRGB(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
vec3 toLinear(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
float hash(vec3 p) {
  p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
`;

export const motionFragment = /* glsl */`
varying vec2 vUv;
uniform sampler2D tWorld, tDepth, tView;
uniform mat4 inverseVP, previousVP;
uniform vec2 resolution, nearFar;
uniform float shutterScale, maxPixels, depthReject;
uniform int samples;
void main() {
  float depth = texture2D(tDepth, vUv).x;
  vec4 world = inverseVP * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 previous = previousVP * world;
  vec2 oldUV = previous.xy / max(previous.w, 0.00001) * 0.5 + 0.5;
  vec2 velocity = previous.w > 0.00001 ? (vUv - oldUV) * shutterScale : vec2(0.0);
  float pixels = length(velocity * resolution);
  velocity *= min(1.0, maxPixels / max(pixels, 0.001));
  vec3 col = vec3(0.0);
  float weight = 0.0;
  float centerZ = nearFar.x * nearFar.y / max(nearFar.y - depth * (nearFar.y - nearFar.x), 0.00001);
  // Centered shutter, depth rejection prevents foreground color leaking into the room.
  for (int i = 0; i < 32; ++i) {
    if (i >= samples) break;
    float along = samples > 1 ? float(i) / float(samples - 1) - 0.5 : 0.0;
    vec2 uv = clamp(vUv + velocity * along, vec2(0.0), vec2(1.0));
    float tapDepth = texture2D(tDepth, uv).r;
    float tapZ = nearFar.x * nearFar.y / max(nearFar.y - tapDepth * (nearFar.y - nearFar.x), 0.00001);
    float accept = 1.0 - smoothstep(depthReject, depthReject * 2.0 + 0.00001, abs(tapZ - centerZ) / max(centerZ,0.001));
    col += texture2D(tWorld, uv).rgb * accept; weight += accept;
  }
  vec4 view = texture2D(tView, vUv);
  if (weight < 0.0001) { col = texture2D(tWorld, vUv).rgb; weight = 1.0; }
  // Carry current, independently moving layer-1 coverage through the existing color passes.
  gl_FragColor = vec4(col / weight * (1.0 - view.a) + view.rgb, view.a);
}
`;

export const meterFragment = /* glsl */`
varying vec2 vUv;
uniform sampler2D tSource;
uniform float centerWeight, centerSigma, floorLog;
void main() {
  vec3 col = texture2D(tSource, vUv).rgb;
  // Floor keeps black areas from dominating the log average, so a bright lamp spot pulls exposure down like a real sensor.
  float logY = max(log2(max(dot(col, vec3(0.2126, 0.7152, 0.0722)), 0.000015258789)), floorLog);
  vec2 d = vUv - 0.5;
  float w = mix(1.0, exp(-dot(d,d) / max(2.0 * centerSigma * centerSigma, 0.0001)), centerWeight);
  gl_FragColor = vec4(clamp(logY, -16.0, 16.0) * w, w, 0.0, 1.0);
}
`;
export const reduceFragment = /* glsl */`
varying vec2 vUv;
uniform sampler2D tSource;
uniform vec2 texel;
void main() {
  vec2 d = texel * 0.5;
  gl_FragColor = (texture2D(tSource, vUv + vec2(-d.x,-d.y)) + texture2D(tSource, vUv + vec2(d.x,-d.y))
    + texture2D(tSource, vUv + vec2(-d.x,d.y)) + texture2D(tSource, vUv + d)) * 0.25;
}
`;
export const encodeMeterFragment = /* glsl */`
varying vec2 vUv;
uniform sampler2D tSource;
void main() {
  vec2 m = texture2D(tSource, vec2(0.5)).rg;
  float code = floor(clamp((m.r / max(m.g, 0.00001) + 16.0) / 32.0, 0.0, 1.0) * 65535.0 + 0.5);
  gl_FragColor = vec4(floor(code / 256.0), mod(code, 256.0), 0.0, 255.0) / 255.0;
}
`;

export const bloomDownFragment = /* glsl */`
varying vec2 vUv;
uniform sampler2D tSource;
uniform vec2 texel;
uniform float exposure, threshold, knee, radius;
uniform bool firstLevel;
vec3 tap(vec2 uv) {
  vec3 c = texture2D(tSource, uv).rgb;
  if (!firstLevel) return c;
  float y = max(max(c.r,c.g),c.b) * exposure;
  float soft = clamp(y - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / max(4.0 * knee, 0.0001);
  return c * max(soft, y - threshold) / max(y, 0.00001);
}
void main() {
  vec2 d = texel * max(radius, 0.01);
  vec3 c = tap(vUv) * 0.25;
  c += (tap(vUv + vec2(d.x,d.y)) + tap(vUv + vec2(-d.x,d.y))
    + tap(vUv + vec2(d.x,-d.y)) + tap(vUv - d)) * 0.1875;
  gl_FragColor = vec4(c, 1.0);
}
`;
export const bloomUpFragment = /* glsl */`
varying vec2 vUv;
uniform sampler2D tSource, tBase;
uniform vec2 texel;
uniform float radius;
void main() {
  vec2 d = texel * max(radius, 0.01);
  vec3 c = texture2D(tSource, vUv).rgb * 0.25;
  c += (texture2D(tSource, vUv + vec2(d.x,0.0)).rgb + texture2D(tSource, vUv - vec2(d.x,0.0)).rgb
    + texture2D(tSource, vUv + vec2(0.0,d.y)).rgb + texture2D(tSource, vUv - vec2(0.0,d.y)).rgb) * 0.125;
  c += (texture2D(tSource, vUv + d).rgb + texture2D(tSource, vUv - d).rgb
    + texture2D(tSource, vUv + vec2(d.x,-d.y)).rgb + texture2D(tSource, vUv + vec2(-d.x,d.y)).rgb) * 0.0625;
  gl_FragColor = vec4(mix(texture2D(tBase, vUv).rgb, c, 0.5), 1.0);
}
`;

export const gradeFragment = /* glsl */`
varying vec2 vUv;
uniform sampler2D tSource, tBloom, tOverlay;
uniform float exposure, bloomStrength, saturation, warmth, toe, whiteClip, knee, toePower;
uniform bool osdEnabled;
uniform int debugMode;
${colorMath}
vec3 tone(vec3 c) {
  c *= exposure;
  c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
  c = mix(vec3(luma(c)), c, saturation);
  c *= vec3(1.0 + warmth, 1.0, 1.0 - warmth);
  c = pow(smoothstep(vec3(toe), vec3(1.0), c), vec3(toePower));
  vec3 shoulder = smoothstep(vec3(knee), vec3(max(whiteClip, knee + 0.001)), c);
  return clamp(mix(c, vec3(1.0), shoulder), 0.0, 1.0);
}
void main() {
  vec4 source = texture2D(tSource, vUv);
  vec3 c = tone(source.rgb + texture2D(tBloom, vUv).rgb * bloomStrength);
  if (debugMode == 3) c = vec3(0.0);
  vec4 osd = texture2D(tOverlay, vUv);
  if (osdEnabled) c = mix(c, osd.rgb, osd.a);
  gl_FragColor = vec4(c, max(source.a, osdEnabled ? osd.a : 0.0));
}
`;

// The color pass and current viewmodel coverage must use the same lens mapping.
const lensMapping = /* glsl */`
uniform vec2 resolution, shakeUV;
uniform vec3 angularVelocity;
uniform float k1, k2, overscan, caR, caB, rollingSec;
vec2 sensorUV(vec2 uv) {
  return uv + shakeUV + vec2(-angularVelocity.y, angularVelocity.x) * rollingSec * (uv.y - 0.5);
}
float lensRadius2(vec2 uv) {
  vec2 p = (uv - 0.5) * vec2(2.0, 2.0 * resolution.y / resolution.x);
  return dot(p,p);
}
vec2 sourceUV(vec2 uv) {
  vec2 d = uv - 0.5;
  // Radius is normalized to W/2, not to each image axis independently.
  float r2 = lensRadius2(uv);
  return 0.5 + d * (1.0 + k1 * r2 + k2 * r2 * r2) / overscan;
}
`;

const overlayCoverage = /* glsl */`
${lensMapping}
uniform sampler2D tOverlay;
uniform bool osdEnabled;
float currentOverlayCoverage(vec2 imageUV) {
  if (!osdEnabled) return 0.0;
  vec2 uv = sensorUV(imageUV), src = sourceUV(uv);
  vec2 radial = (src - 0.5) * lensRadius2(uv);
  // Used only during signal loss: combined source alpha must not protect the weapon from VHS.
  return max(texture2D(tOverlay, clamp(src, 0.0, 1.0)).a,
    max(texture2D(tOverlay, clamp(src + radial * caR, 0.0, 1.0)).a,
        texture2D(tOverlay, clamp(src + radial * caB, 0.0, 1.0)).a));
}
`;

export const lensFragment = /* glsl */`
varying vec2 vUv;
uniform sampler2D tSource;
uniform int debugMode;
${lensMapping}
void main() {
  vec2 uv = sensorUV(vUv);
  float r2 = lensRadius2(uv);
  vec2 src = sourceUV(uv);
  if (debugMode == 2) {
    float code = floor(clamp(src.x,0.0,1.0) * 65535.0 + 0.5);
    float yCode = floor(clamp(src.y,0.0,1.0) * 255.0 + 0.5);
    gl_FragColor = vec4(floor(code/256.0)/255.0,mod(code,256.0)/255.0,yCode/255.0,1.0); return;
  }
  vec2 dr = (src - 0.5) * caR * r2;
  vec2 db = (src - 0.5) * caB * r2;
  vec4 red = texture2D(tSource, clamp(src + dr, vec2(0.0), vec2(1.0)));
  vec4 green = texture2D(tSource, clamp(src, vec2(0.0), vec2(1.0)));
  vec4 blue = texture2D(tSource, clamp(src + db, vec2(0.0), vec2(1.0)));
  gl_FragColor = vec4(red.r, green.g, blue.b, max(red.a,max(green.a,blue.a)));
}
`;

export const blockFragment = /* glsl */`
varying vec2 vUv;
uniform sampler2D tSource, tHistory;
uniform vec2 grid, imageTiles, resolution;
uniform float frameIndex, previousFrameIndex, holdMin, holdMax, detailReject, historyReject;
uniform bool historyValid;
${colorMath}
void main() {
  vec2 id = floor(vUv * grid);
  float hold = floor(mix(holdMin, holdMax + 0.999, hash(vec3(id, 0.0))));
  float phase = floor(hash(vec3(id, 1.0)) * hold);
  vec3 c = vec3(0.0);
  vec3 lo = vec3(1.0), hi = vec3(0.0);
  float coverage = 0.0;
  for (int y = 0; y < 4; ++y) for (int x = 0; x < 4; ++x) {
    vec2 uv = (id + (vec2(float(x),float(y)) + 0.5) / 4.0) / imageTiles;
    uv = clamp(uv, 0.5 / resolution, 1.0 - 0.5 / resolution);
    vec4 source = texture2D(tSource, uv);
    vec3 display = toSRGB(source.rgb);
    lo = min(lo, display); hi = max(hi, display); c += source.rgb;
    coverage = max(coverage, source.a);
  }
  c /= 16.0;
  vec3 range = hi - lo;
  float detail = max(range.r, max(range.g, range.b));
  float confidence = (1.0 - step(0.001, coverage)) * (1.0 - smoothstep(detailReject, detailReject * 2.0, detail));
  vec4 old = texture2D(tHistory, vUv);
  vec3 delta = abs(toSRGB(old.rgb) - toSRGB(c));
  // Compare time buckets, not tick modulo: 30 Hz and dropped frames must refresh too.
  bool sameHold = floor((frameIndex + phase) / hold) == floor((previousFrameIndex + phase) / hold);
  if (historyValid && sameHold && confidence > 0.0 && old.a > 0.0
      && max(delta.r, max(delta.g, delta.b)) <= historyReject) c = old.rgb;
  // Occupancy/detail always describe this frame, even when the color is held.
  gl_FragColor = vec4(c, confidence);
}
`;

export const sensorFragment = /* glsl */`
varying vec2 vUv;
uniform sampler2D tSource, tBlocks;
uniform vec2 blockGrid, imageTiles, maskAxes;
uniform vec3 outsideColor, noiseLuma, damageColor;
uniform vec3 profile[7];
uniform float radii[8];
uniform float rimInner, rimOuter, innerVignette, outsideBlur, sharpenAmount, sharpenRadius, haloClamp;
uniform float noiseTick, noiseChroma, blockAmount, blockLuma, blockMaxDelta, ringing, damageAmount, damageSaturation, dropout;
uniform float glitchAmount, glitchTick, stripePixels, syncPosition;
uniform bool maskEnabled, noiseEnabled, outputLinear;
uniform int debugMode;
${colorMath}
${overlayCoverage}
vec3 maskAt(float rho) {
  float r = rho;
  // rimInner/rimOuter move the measured 0.94–1.05 interval without changing its samples.
  if (r > 0.90) r = mix(0.94, 1.05, (r - rimInner) / max(rimOuter - rimInner, 0.0001));
  if (r <= radii[0]) return mix(vec3(1.0) + vec3(1.0,0.75,1.0) * innerVignette,
    profile[0], smoothstep(0.0, radii[0], r));
  vec3 value = outsideColor;
  for (int i = 0; i < 7; ++i) {
    if (r < radii[i+1]) {
      vec3 nextValue = outsideColor;
      if (i < 6) nextValue = profile[i+1];
      value = mix(profile[i], nextValue, clamp((r - radii[i]) / max(radii[i+1] - radii[i],0.0001), 0.0, 1.0));
      break;
    }
  }
  return value;
}
void main() {
  float rho = length((vUv - 0.5) / maskAxes);
  if (debugMode == 1) {
    // A display-referred 0.5 flat field makes the STYLE ratios measurable in PNGs.
    gl_FragColor = vec4(vec3(0.5) * (maskEnabled ? maskAt(rho) : vec3(1.0)), 1.0); return;
  }
  if (debugMode == 2) { gl_FragColor = texture2D(tSource, vUv); return; }
  vec2 d = vec2(sharpenRadius) / resolution;
  vec4 source = texture2D(tSource, vUv);
  vec3 base = source.rgb;
  vec3 blur = (texture2D(tSource,vUv + vec2(d.x,0.0)).rgb + texture2D(tSource,vUv - vec2(d.x,0.0)).rgb
    + texture2D(tSource,vUv + vec2(0.0,d.y)).rgb + texture2D(tSource,vUv - vec2(0.0,d.y)).rgb) * 0.25;
  vec3 sharp = base + clamp((base - blur) * sharpenAmount, vec3(-haloClamp), vec3(haloClamp));
  vec3 c = toSRGB(sharp);
  if (debugMode == 3) { gl_FragColor = vec4(c, 1.0); return; }
  if (blockAmount > 0.0) {
    vec3 current = toSRGB(base);
    float dark = 1.0 - smoothstep(blockLuma * 0.75, max(blockLuma,0.0001), luma(current));
    vec2 blockUV = (floor(vUv * imageTiles) + 0.5) / blockGrid;
    vec4 block = texture2D(tBlocks, blockUV);
    vec3 delta = toSRGB(block.rgb) - current;
    float distance = max(abs(delta.r), max(abs(delta.g), abs(delta.b)));
    // Sparse tile probes can miss a thin edge: bound the display-space residual per pixel.
    float compatible = 1.0 - smoothstep(blockMaxDelta, blockMaxDelta * 2.0, distance);
    float amount = clamp(blockAmount * dark * block.a * compatible * (1.0 - source.a), 0.0, 1.0);
    c += clamp(delta, vec3(-blockMaxDelta), vec3(blockMaxDelta)) * amount;
  }
  // Bounded 8-pixel ringing proxy; no full video encoder runs in the renderer.
  float edge = luma(toSRGB(base) - toSRGB(blur));
  c += edge * ringing * cos(gl_FragCoord.x * 0.785398) * cos(gl_FragCoord.y * 0.785398);
  float y = luma(c);
  if (noiseEnabled) {
    float sigma = mix(noiseLuma.x, noiseLuma.y, smoothstep(0.1,0.5,y));
    sigma = mix(sigma, noiseLuma.z, smoothstep(0.5,1.0,y));
    vec2 px = floor(vUv * resolution);
    // Uniform variates scaled to unit standard deviation.
    float n = (hash(vec3(px,noiseTick)) - 0.5) * 3.464102;
    vec3 chroma = vec3(hash(vec3(px,noiseTick+17.0)),hash(vec3(px,noiseTick+37.0)),hash(vec3(px,noiseTick+71.0))) - 0.5;
    c += sigma * (n + chroma * 3.464102 * noiseChroma);
  }
  c = mix(c, mix(vec3(luma(c)),c,damageSaturation) * damageColor, damageAmount);
  float dropoutRow = step(0.8, hash(vec3(floor(vUv.y * 32.0), glitchTick, 12.0)));
  c *= 1.0 - dropout * dropoutRow;
  if (glitchAmount > 0.0) {
    float stripe = hash(vec3(floor(gl_FragCoord.x / max(stripePixels,1.0)),glitchTick,1.0));
    float sync = step(0.94,fract(vUv.y + syncPosition));
    c = mix(c, vec3(stripe * 0.8 + sync * 0.2), glitchAmount);
    // Keep the pre-CA OSD legible above the failed camera signal.
    c = mix(c, toSRGB(base), currentOverlayCoverage(vUv));
  }
  if (maskEnabled) {
    vec2 m = vec2(outsideBlur) / resolution;
    vec3 outer = (texture2D(tSource,vUv+m).rgb + texture2D(tSource,vUv-m).rgb
      + texture2D(tSource,vUv+vec2(m.x,-m.y)).rgb + texture2D(tSource,vUv+vec2(-m.x,m.y)).rgb) * 0.25;
    c = mix(c,toSRGB(outer),smoothstep(rimInner,rimOuter,rho)) * maskAt(rho);
  }
  // Noise and the measured mask are display-referred. Return to linear for the final transfer.
  vec3 linearOutput = toLinear(clamp(c,0.0,1.0));
  gl_FragColor = vec4(outputLinear ? linearOutput : toSRGB(linearOutput), 1.0);
}
`;
