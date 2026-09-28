// Full-screen fragment shader: cold club haze that shatters into crystal facets on the high,
// tunnels on every kick, bleeds red at the edges when paranoia sets in and goes grey on the crash.

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform vec2 uMouse;
uniform float uTime, uE, uSat, uBeat, uC, uKick, uAnx, uDark, uAir, uHeart;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}
// x: distance to nearest seed, y: distance to the nearest edge, z: cell id
vec3 voro(vec2 x, float t) {
  vec2 n = floor(x), f = fract(x);
  float d1 = 8.0, d2 = 8.0;
  vec2 id = vec2(0.0);
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash2(n + g);
    o = 0.5 + 0.42 * sin(t + 6.2831 * o);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = n + g; }
    else if (d < d2) { d2 = d; }
  }
  return vec3(sqrt(d1), sqrt(d2) - sqrt(d1), hash(id));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime;
  float r0 = length(uv);

  // the kick pulls everything towards the centre
  uv *= 1.0 - 0.07 * uKick - 0.018 * uBeat * uE;

  // ---- sober club: cold haze and hard white spots ----
  float haze = fbm(uv * 1.6 + vec2(t * 0.03, -t * 0.02));
  vec3 base = vec3(0.018, 0.022, 0.03) + vec3(0.03, 0.04, 0.06) * haze;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 o = vec2(-0.75 + fi * 0.75, 0.62);
    vec2 d = uv - o;
    float a = atan(d.x, -d.y) - sin(t * (0.3 + 0.9 * uC) + fi * 2.3) * 0.6;
    float cone = smoothstep(0.09, 0.0, abs(a)) * smoothstep(1.8, 0.0, length(d));
    vec3 cc = mix(vec3(0.32, 0.38, 0.5), mix(vec3(0.85, 0.93, 1.0), vec3(1.0, 0.8, 0.4), step(1.5, fi) * uE), uE);
    base += cone * (0.35 + haze) * cc * (0.3 + 0.9 * uE);
  }

  // ---- the high: crystal facets ----
  float r = length(uv);
  vec2 q = uv * (2.6 + 1.6 * uE) + (uMouse - 0.5) * 0.7 * uE;
  q += normalize(uv + 1e-4) * 0.25 * sin(r * 6.0 - t * 1.5) * uE;
  vec3 v = voro(q, t * (0.25 + 0.9 * uC));
  vec3 v2 = voro(q * 2.3 + 7.1, t * 0.4);
  float id = v.z;
  vec3 ice = mix(vec3(0.45, 0.66, 0.95), vec3(0.96, 0.98, 1.0), id);
  vec3 gold = vec3(1.0, 0.76, 0.28);
  vec3 shard = mix(ice, gold, smoothstep(0.72, 0.95, id) * smoothstep(0.55, 1.0, uE));
  float glint = pow(0.5 + 0.5 * sin(id * 37.0 + t * (1.2 + 3.0 * uC) + uv.x * 2.0), 6.0);
  float shade = 0.08 + 0.55 * pow(1.0 - clamp(v.x, 0.0, 1.0), 2.2) + 0.9 * glint;
  vec3 col = shard * shade;
  col += vec3(1.0) * smoothstep(0.045, 0.0, v.y) * (0.35 + 0.9 * uBeat);
  col += vec3(0.75, 0.88, 1.0) * smoothstep(0.03, 0.0, v2.y) * 0.25 * uE;

  // speed lines: tunnel on the kick and while the level is high
  float an = atan(uv.y, uv.x);
  float streak = pow(noise(vec2(an * 36.0, r * 1.5 - t * (3.0 + 12.0 * uC))), 7.0);
  col += streak * vec3(0.85, 0.93, 1.0) * (0.6 * uC + 2.5 * uKick) * smoothstep(0.12, 0.9, r);

  vec3 c = mix(base, base * 0.3 + col, clamp(uE, 0.0, 1.0) * 0.85);

  // white bloom right after a line
  c += uKick * vec3(0.95, 0.98, 1.05) * smoothstep(1.3, 0.0, r0) * 0.6;

  // saturation
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uSat);

  // paranoia: the edges throb red with the heartbeat
  c += uAnx * vec3(0.55, 0.02, 0.05) * smoothstep(0.3, 1.1, r0) * (0.45 + 0.55 * uHeart);

  // crash: grey, flat, dim
  c = mix(c, vec3(l) * vec3(0.74, 0.79, 0.9), uDark * 0.7);
  c *= 1.0 - uDark * 0.45;

  // fresh air outside: night blue
  c = mix(c, c * vec3(0.4, 0.6, 1.15) + vec3(0.0, 0.012, 0.035), uAir * 0.6);

  gl_FragColor = vec4(c, 1.0);
}
`;

export function createGL(canvas) {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" });
  if (!gl) return null;

  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  try {
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  } catch (e) {
    console.warn("[dopamin] shader failed", e);
    return null;
  }
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const names = ["uRes", "uMouse", "uTime", "uE", "uSat", "uBeat", "uC", "uKick", "uAnx", "uDark", "uAir", "uHeart"];
  const u = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(prog, n)]));

  let scale = 0.5;
  const resize = () => {
    const w = Math.max(1, Math.round(canvas.clientWidth * scale * Math.min(devicePixelRatio, 2)));
    const h = Math.max(1, Math.round(canvas.clientHeight * scale * Math.min(devicePixelRatio, 2)));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  };

  // adaptive quality: drop resolution if frames are slow
  let slow = 0;
  return {
    render(p, frameMs) {
      if (frameMs > 26) slow++; else slow = Math.max(0, slow - 1);
      if (slow > 40 && scale > 0.3) { scale -= 0.1; slow = 0; }
      resize();
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform2f(u.uMouse, p.mx, p.my);
      gl.uniform1f(u.uTime, p.time);
      gl.uniform1f(u.uE, p.E);
      gl.uniform1f(u.uSat, p.sat);
      gl.uniform1f(u.uBeat, p.beat);
      gl.uniform1f(u.uC, p.c);
      gl.uniform1f(u.uKick, p.kick);
      gl.uniform1f(u.uAnx, p.anx);
      gl.uniform1f(u.uDark, p.dark);
      gl.uniform1f(u.uAir, p.air);
      gl.uniform1f(u.uHeart, p.heart);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
