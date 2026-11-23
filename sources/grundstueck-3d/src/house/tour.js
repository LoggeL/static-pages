// Blender/Cycles supplies the light and materials. This viewer only turns the virtual camera in the rendered panorama.
import './tour.css';

const rooms = {
  eg: { title: 'Essbereich im Erdgeschoss', picture: 'eg-blick.webp', panorama: 'eg.webp' },
  og: { title: 'Wohnküche im Obergeschoss', picture: 'og-blick.webp', panorama: 'og.webp' },
  aussen: { title: 'Haus von der Gartenseite', picture: 'aussen.webp' },
};
const url = name => new URL('blender/' + name, document.baseURI).href;
const radians = Math.PI / 180;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

function panoramaRenderer(canvas) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
  if (!gl) return null;
  const buildShader = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const vertex = buildShader(gl.VERTEX_SHADER, `
    attribute vec2 position;
    varying vec2 screen;
    void main() { screen = position; gl_Position = vec4(position, 0.0, 1.0); }
  `);
  const fragment = buildShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec2 screen;
    uniform vec4 lens;
    uniform sampler2D panorama;
    void main() {
      vec3 ray = normalize(vec3(screen.x * lens.x * lens.y, screen.y * lens.y, 1.0));
      float cp = cos(lens.w), sp = sin(lens.w);
      float y = ray.y * cp + ray.z * sp;
      float z = ray.z * cp - ray.y * sp;
      vec2 uv = vec2(fract(0.5 + (atan(ray.x, z) + lens.z) / 6.28318530718),
                     0.5 - asin(clamp(y, -1.0, 1.0)) / 3.14159265359);
      gl_FragColor = texture2D(panorama, uv);
    }
  `);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const location = gl.getAttribLocation(program, 'position');
  const lens = gl.getUniformLocation(program, 'lens');
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  let texture;
  function clear() {
    if (texture) gl.deleteTexture(texture);
    texture = null;
  }
  return {
    clear,
    load(img) {
      clear();
      const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      let source = img;
      if (img.naturalWidth > max) {
        source = document.createElement('canvas');
        source.width = max;
        source.height = Math.round(max * img.naturalHeight / img.naturalWidth);
        source.getContext('2d').drawImage(img, 0, 0, source.width, source.height);
      }
      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
    },
    draw({ yaw, pitch, zoom }) {
      if (!texture || gl.isContextLost() || !canvas.clientWidth || !canvas.clientHeight) return;
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(canvas.clientWidth * scale), height = Math.round(canvas.clientHeight * scale);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const aspect = width / height;
      const focal = clamp(Math.tan(42 * radians) / aspect, .38, .84) / zoom;
      gl.viewport(0, 0, width, height);
      gl.uniform4f(lens, aspect, focal, yaw, pitch);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

let tour;
function createTour() {
  const dlg = document.createElement('dialog');
  dlg.id = 'blender-dialog';
  dlg.setAttribute('aria-labelledby', 'tour-heading');
  dlg.innerHTML = `
    <div class="tour-shell">
      <header class="tour-header">
        <div class="tour-title"><p>Dautengasse · Wattenheim</p><h2 id="tour-heading">Haus in Blender</h2></div>
        <div class="tour-tabs" role="group" aria-label="Standpunkt wählen">
          <button data-room="eg">EG <span>· Essbereich</span></button>
          <button data-room="og">OG <span>· Wohnküche</span></button>
          <button data-room="aussen">Außen</button>
        </div>
        <button class="tour-close" type="button" aria-label="Blender-Ansichten schließen" title="Schließen">×</button>
      </header>
      <div class="tour-stage">
        <img class="tour-still" alt="">
        <canvas class="tour-pano" tabindex="0" aria-label="360-Grad-Raumansicht. Mit den Pfeiltasten umsehen, Plus und Minus zum Zoomen." hidden></canvas>
        <div class="tour-look" role="group" aria-label="Kamera einstellen" hidden>
          <button data-camera="out" aria-label="Herauszoomen">−</button>
          <button data-camera="reset" title="Blick zurücksetzen" aria-label="Blick zurücksetzen">↺</button>
          <button data-camera="in" aria-label="Hineinzoomen">+</button>
        </div>
      </div>
      <footer class="tour-foot">
        <span class="tour-status" role="status" aria-live="polite"></span>
        <div class="tour-actions"><a href="${url('Wohnhaus-214.blend')}" download>Blender-Datei</a><button class="tour-orbit">Modell isolieren</button></div>
      </footer>
    </div>`;
  document.getElementById('app').append(dlg);
  const stage = dlg.querySelector('.tour-stage'), canvas = dlg.querySelector('canvas');
  const still = dlg.querySelector('.tour-still'), status = dlg.querySelector('.tour-status');
  const look = dlg.querySelector('.tour-look'), buttons = [...dlg.querySelectorAll('[data-room]')];
  const fingers = new Map();
  let active, version = 0, graphics, loadModel, dragDistance = 0;
  const camera = {};
  function reset() { Object.assign(camera, { yaw: 0, pitch: -.105, zoom: 1 }); }
  function draw() { if (dlg.open && !canvas.hidden) graphics?.draw(camera); }
  function zoom(by) { camera.zoom = clamp(camera.zoom * by, .70, 2.8); draw(); }
  function turn(dx, dy) {
    camera.yaw -= dx;
    camera.pitch = clamp(camera.pitch + dy, -1.52, 1.52);
    draw();
  }
  const resize = new ResizeObserver(draw);
  resize.observe(stage);
  function poster(text) {
    canvas.hidden = true;
    look.hidden = true;
    status.textContent = text;
  }
  async function select(id) {
    if (!(id in rooms)) id = 'eg';
    const room = rooms[id], revision = ++version;
    active = id; dlg.dataset.room = id; fingers.clear();
    reset(); graphics?.clear();
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.room === id));
    still.alt = room.title; still.src = url(room.picture);
    poster(room.panorama ? 'Raumansicht wird geladen …' : 'Gartenseite · Außenansicht');
    if (!room.panorama) return;
    try {
      graphics ??= panoramaRenderer(canvas);
      if (!graphics) { poster(room.title); return; }
      const img = new Image();
      img.src = url(room.panorama);
      await img.decode();
      if (revision !== version || !dlg.open) return;
      graphics.load(img);
      canvas.hidden = false; look.hidden = false;
      draw();
      status.textContent = '360° · Ziehen zum Umsehen';
    } catch {
      if (revision === version) poster(room.title + ' · Einzelansicht');
    }
  }
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); version++; graphics = null; poster(rooms[active].title); });
  canvas.addEventListener('webglcontextrestored', () => { if (dlg.open) select(active); });
  buttons.forEach(b => b.addEventListener('click', () => select(b.dataset.room)));
  dlg.querySelector('.tour-close').onclick = () => dlg.close();
  dlg.querySelector('.tour-orbit').onclick = () => { dlg.close(); loadModel(active === 'aussen' ? 'full' : active); };
  look.addEventListener('click', e => {
    const action = e.target.closest('button')?.dataset.camera;
    if (action === 'reset') { reset(); draw(); }
    else if (action) zoom(action === 'in' ? 1.2 : 1 / 1.2);
  });
  function spread() {
    const [a, b] = [...fingers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragDistance = spread();
  });
  canvas.addEventListener('pointermove', e => {
    const prev = fingers.get(e.pointerId);
    if (!prev) return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size === 1) {
      const scale = 1.8 / (stage.clientHeight * camera.zoom);
      turn((e.clientX - prev.x) * scale, (e.clientY - prev.y) * scale);
    } else if (fingers.size === 2) {
      const next = spread();
      if (next > 1 && dragDistance > 1) zoom(next / dragDistance);
      dragDistance = next;
    }
  });
  const release = e => { fingers.delete(e.pointerId); dragDistance = spread(); };
  canvas.addEventListener('lostpointercapture', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoom(Math.exp(-Math.sign(e.deltaY) * .10)); }, { passive: false });
  canvas.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowLeft': turn(.12, 0); break;
      case 'ArrowRight': turn(-.12, 0); break;
      case 'ArrowUp': turn(0, .12); break;
      case 'ArrowDown': turn(0, -.12); break;
      case '+': case '=': zoom(1.2); break;
      case '-': zoom(1 / 1.2); break;
      case 'Home': reset(); draw(); break;
      default: return;
    }
    e.preventDefault();
  });
  dlg.addEventListener('close', () => {
    version++; fingers.clear(); graphics?.clear();
    if (['#innen', '#innen-og', '#blender'].includes(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  });
  return (id, onModel) => {
    loadModel = onModel;
    if (!dlg.open) dlg.showModal();
    select(id);
  };
}
export function openTour(id, openModel) {
  tour ??= createTour();
  tour(id, openModel);
}
