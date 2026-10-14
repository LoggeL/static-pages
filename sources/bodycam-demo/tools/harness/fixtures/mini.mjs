// Real GPU render, intentionally no CDN or Three.js dependency for the tool's self-test.
const canvas = document.querySelector('canvas');
const gl = canvas.getContext('webgl2');
if (!gl) throw new Error('WebGL2 unavailable');
const params = new URLSearchParams(location.search);
const state = { position: [0, 0, 0], yawDeg: 0, pitchDeg: -4, keys: [], frame: 0, clicks: 0, started: false };
const keySet = new Set();
addEventListener('keydown', event => { keySet.add(event.code); state.keys.push(`down:${event.code}`); });
addEventListener('keyup', event => { keySet.delete(event.code); state.keys.push(`up:${event.code}`); });
addEventListener('mousedown', () => state.clicks++);
document.querySelector('#start').onclick = () => { state.started = true; if (params.has('start')) window.__bodycam.ready = true; };
function shader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}
const program = gl.createProgram();
gl.attachShader(program, shader(gl.VERTEX_SHADER, `#version 300 es
in vec2 position;out vec2 uv;
void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`));
gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;in vec2 uv;out vec4 color;uniform vec3 pose;uniform vec2 angle;
void main(){
 vec2 p=uv+vec2(pose.x*.03,pose.z*.03)+angle/360.;
 vec2 grid=step(vec2(.07),fract(p*12.));
 vec3 tint=mix(vec3(.07,.13,.21),vec3(.26,.61,.70),uv.y);
 tint+=vec3(.12,.03,0.)*mod(floor(p.x*12.)+floor(p.y*12.),2.);
 color=vec4(tint*mix(.4,1.,grid.x*grid.y),1.);
}`));
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
gl.useProgram(program);
const buffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
const position = gl.getAttribLocation(program, 'position');
gl.enableVertexAttribArray(position);
gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
const pose = gl.getUniformLocation(program, 'pose');
const angle = gl.getUniformLocation(program, 'angle');
function render() {
  if (canvas.width !== innerWidth || canvas.height !== innerHeight) { canvas.width = innerWidth; canvas.height = innerHeight; gl.viewport(0,0,innerWidth,innerHeight); }
  if (keySet.has('KeyW')) state.position[2] -= .025;
  gl.uniform3fv(pose, state.position);
  gl.uniform2f(angle, state.yawDeg, state.pitchDeg);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  state.frame++;
  document.querySelector('#state').textContent = `Position: ${state.position.map(x=>x.toFixed(2)).join(', ')}\nBlick: ${state.yawDeg}° / ${state.pitchDeg}°\nFrames: ${state.frame}\nTasten: ${state.keys.join(', ')}`;
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
const stats = () => ({ fixture: true, player: structuredClone(state), renderer: { info: { render: { calls: 1, triangles: 1, frame: state.frame }, memory: { geometries: 1, textures: 0 } } } });
window.__bodycam = {
  ready: false,
  teleport(x, y, z, yaw, pitch) { state.position = [x,y,z]; state.yawDeg = yaw; state.pitchDeg = pitch; },
  look(yaw, pitch) { state.yawDeg = yaw; state.pitchDeg = pitch; },
  stats, player: state,
};
if (params.has('nostats')) delete window.__bodycam.stats;
if (params.has('missinghook')) delete window.__bodycam.teleport;
if (!params.has('never') && !params.has('start')) {
  if (params.has('promise')) window.__bodycam.ready = new Promise(resolve => setTimeout(resolve, 80));
  else setTimeout(() => { window.__bodycam.ready = true; }, 80);
}
console.info('C13 mini ready: real WebGL2 render loop');
