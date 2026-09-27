// Full-screen fragment shader: club haze that melts into a kaleidoscopic plasma as euphoria rises.

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform vec2 uMouse;
uniform float uTime, uE, uSat, uBeat, uNausea, uDark, uChill, uHeat, uRush, uStim;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}
vec3 pal(float t) { return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime;

  // come-up nausea: the room sways
  uv += uNausea * 0.05 * vec2(sin(uv.y * 5.0 + t * 1.3), cos(uv.x * 4.0 + t * 1.1));
  // the world breathes with the kick
  uv *= 1.0 - 0.04 * uBeat * uE;

  // ---- sober club: haze and slow spotlights ----
  float haze = fbm(uv * 1.7 + vec2(t * 0.03, t * 0.02));
  vec3 base = vec3(0.025, 0.02, 0.045) + vec3(0.05, 0.04, 0.08) * haze;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 o = vec2(-0.7 + fi * 0.7, 0.62);
    vec2 d = uv - o;
    float a = atan(d.x, -d.y) - sin(t * (0.25 + 0.3 * uE) + fi * 2.1) * 0.55;
    float cone = smoothstep(0.13, 0.0, abs(a)) * smoothstep(1.7, 0.0, length(d));
    vec3 cc = mix(vec3(0.35, 0.25, 0.55), pal(fi * 0.3 + t * 0.05), uE);
    base += cone * (0.4 + haze) * cc * (0.35 + 0.8 * uE);
  }

  // ---- euphoric layer: kaleidoscope + domain-warped plasma ----
  float r = length(uv);
  float an = atan(uv.y, uv.x) + t * 0.04;
  float seg = 6.28318 / 8.0;
  float a2 = abs(mod(an, seg) - seg * 0.5);
  vec2 kal = vec2(cos(a2), sin(a2)) * r;
  vec2 q = mix(uv, kal, smoothstep(0.45, 1.0, uE) * 0.8);
  q += (uMouse - 0.5) * 0.25 * uE;
  vec2 w = vec2(fbm(q * 2.0 + t * 0.15), fbm(q * 2.0 + vec2(5.2, 1.3) - t * 0.12));
  float f = fbm(q * 2.4 + 3.2 * w + t * 0.08);
  vec3 col = pal(f * 1.6 + r * 0.55 - t * 0.07 + uBeat * 0.04);
  col *= 0.25 + 1.2 * f * f;
  float ring = smoothstep(0.05, 0.0, abs(fract(r * 2.6 - t * 0.35) - 0.5));
  col += (0.12 + 0.3 * uBeat) * ring * pal(r + t * 0.1) * smoothstep(0.6, 1.0, uE);

  vec3 c = mix(base, base * 0.35 + col * 0.95, clamp(uE, 0.0, 1.0) * 0.92);

  // rush: white-hot bloom from the centre
  c += uRush * vec3(1.0, 0.85, 0.95) * smoothstep(1.2, 0.0, r) * 0.8;

  // saturation
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uSat);

  // overheating: red-hot edges
  c += uHeat * vec3(0.55, 0.08, 0.02) * smoothstep(0.35, 1.1, r);

  // comedown: cold, flat, dim
  c = mix(c, vec3(l) * vec3(0.72, 0.78, 0.92), uDark * 0.65);
  c *= 1.0 - uDark * 0.45;

  // chill-out room: cool blue
  c = mix(c, c * vec3(0.45, 0.75, 1.25) + vec3(0.0, 0.01, 0.03), uChill * 0.55);

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
    console.warn("[serotonin] shader failed", e);
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

  const names = ["uRes", "uMouse", "uTime", "uE", "uSat", "uBeat", "uNausea", "uDark", "uChill", "uHeat", "uRush", "uStim"];
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
      gl.uniform1f(u.uNausea, p.nausea);
      gl.uniform1f(u.uDark, p.dark);
      gl.uniform1f(u.uChill, p.chill);
      gl.uniform1f(u.uHeat, p.heat);
      gl.uniform1f(u.uRush, p.rush);
      gl.uniform1f(u.uStim, p.stim);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
