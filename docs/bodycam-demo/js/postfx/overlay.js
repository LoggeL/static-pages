import * as THREE from 'three';

const DEG = Math.PI / 180;
const EMPTY = Object.freeze({});
const DEFAULT_START = Date.UTC(2026, 9, 14, 23, 14, 7);
const FONT_TIMEOUT_MS = 6000;
let shareTechMonoReady;

// The shared font survives individual overlay disposal and is requested once.
function loadShareTechMono() {
  if (shareTechMonoReady) return shareTechMonoReady;
  shareTechMonoReady = (async () => {
    if (!globalThis.FontFace || !document.fonts) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FONT_TIMEOUT_MS);
    try {
      const response = await fetch('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap', {
        signal: controller.signal,
      });
      if (!response.ok) return false;
      const css = await response.text();
      const source = /src:\s*([^;]+);/.exec(css)?.[1];
      if (!source || controller.signal.aborted) return false;
      const font = new FontFace('Share Tech Mono', source, { style: 'normal', weight: '400' });
      const loaded = await Promise.race([
        font.load(),
        new Promise((resolve) => controller.signal.addEventListener('abort', () => resolve(null), { once: true })),
      ]);
      if (!loaded) return false;
      document.fonts.add(loaded);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  })();
  return shareTechMonoReady;
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function text(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

function bounds() {
  return { text: '', x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0, capPx: 0, rotationDeg: 0, visible: false };
}

/**
 * OSD in display pixels, before the final lens/CA pass. `time` is elapsed seconds.
 * Mutate params.osd in place; changes are observed at most 30 times per second.
 */
export function createOverlay(params) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const scratch = document.createElement('canvas');
  const ink = scratch.getContext('2d', { willReadFrequently: true });
  if (!context || !ink) throw new Error('Das Bodycam-OSD benötigt Canvas 2D.');
  canvas.width = 1920;
  canvas.height = 1080;
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'Bodycam OSD (sRGB)';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.premultiplyAlpha = false;

  const effect = { connected: 0, disconnected: 0 };
  const metrics = {
    width: 1920, height: 1080, scale: 1, drawCount: 0, lastDrawTime: 0,
    fontFamily: '', fontStatus: 'loading', fontPx: 0, capPx: 0,
    clockValid: true, timestamp: '', left: bounds(), right: bounds(), status: bounds(),
  };
  const values = new Array(25);
  const clock = new Date(DEFAULT_START);
  let elapsed = 0;
  let baseTime = DEFAULT_START;
  let second = NaN;
  let nextParamCheck = -Infinity;
  let nextWallParamCheck = -Infinity;
  let dirty = true;
  let blank = false;
  let disposed = false;
  let fontRequest = 0;
  let ready = Promise.resolve('fallback');
  let effectMode = 0;
  let effectStart = 0;
  let effectDuration;
  let fontFamily = 'monospace';
  let fontCapRatio = 0.7;
  let parametersChanged = false;

  // Fixed primitive slots avoid JSON strings, arrays or closures in the frame loop.
  function slot(index, value) {
    if (values[index] !== value) {
      values[index] = value;
      parametersChanged = true;
    }
  }

  function readParams() {
    const osd = params?.osd || EMPTY;
    parametersChanged = false;
    slot(0, Math.max(1, finite(osd.capPx1080, 24)));
    slot(1, finite(osd.left?.[0], 100));
    slot(2, finite(osd.left?.[1], 95));
    slot(3, finite(osd.rightEdge, 1790));
    slot(4, text(osd.color, '#edf0eb'));
    slot(5, finite(osd.shadow?.[0], 3));
    slot(6, finite(osd.shadow?.[1], 3));
    slot(7, THREE.MathUtils.clamp(finite(osd.shadow?.[2], 0.65), 0, 1));
    slot(8, THREE.MathUtils.clamp(finite(osd.skewDeg, 12), -75, 75));
    slot(9, THREE.MathUtils.clamp(finite(osd.arcDeg, 3), -75, 75));
    slot(10, text(osd.textLeft, 'BWC-4 X60A1972 ▶'));
    slot(11, text(osd.dateFmt, 'M/D/YYYY'));
    slot(12, osd.showTime !== false);
    slot(13, text(osd.rec, 'REC'));
    const requestedFamily = text(osd.fontFamily, 'Share Tech Mono');
    const fontChanged = values[14] !== requestedFamily;
    slot(14, requestedFamily);
    const startTime = osd.startTime ?? '2026-10-14T23:14:07';
    const timeChanged = values[15] !== startTime;
    slot(15, startTime);
    slot(16, Math.max(0, finite(osd.connectedDuration, 1)));
    slot(17, Math.max(0, finite(osd.disconnectedDuration, 0)));
    slot(18, text(osd.connectedColor, '#60e980'));
    slot(19, text(osd.disconnectedColor, '#ed5252'));
    slot(20, Math.max(1, finite(osd.effectCapPx1080, 20)));
    slot(21, Math.max(0, finite(osd.shadowBlurPx1080, 1)));
    slot(22, osd.enabled !== false);
    slot(23, text(osd.connectedText, 'CAM CONNECTED'));
    slot(24, text(osd.disconnectedText, 'CAM DISCONNECTED'));
    if (timeChanged) {
      // An ISO date without a zone is a written camera-clock time, independent of host TZ.
      let parsed = startTime;
      if (typeof parsed === 'string') {
        const value = parsed.trim();
        parsed = Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/i.test(value) ? value : `${value}Z`);
      } else if (parsed instanceof Date) parsed = parsed.getTime();
      metrics.clockValid = Number.isFinite(parsed) && Math.abs(parsed) <= 8.64e15;
      baseTime = metrics.clockValid ? parsed : DEFAULT_START;
    }
    if (fontChanged) requestFont(requestedFamily);
    dirty ||= parametersChanged;
  }

  function measureFont() {
    ink.font = `100px ${fontFamily}`;
    const cap = ink.measureText('H');
    fontCapRatio = Math.max(0.1, (cap.actualBoundingBoxAscent + cap.actualBoundingBoxDescent) / 100);
  }

  function requestFont(family) {
    const request = ++fontRequest;
    const quoted = `"${family.replace(/["\\]/g, '\\$&')}"`;
    fontFamily = family === 'monospace' ? 'monospace' : `${quoted}, monospace`;
    metrics.fontFamily = family;
    metrics.fontStatus = family === 'Share Tech Mono' ? 'loading' : 'system';
    measureFont();
    const loading = family === 'Share Tech Mono' ? loadShareTechMono() : Promise.resolve(true);
    ready = loading.then((loaded) => {
      if (disposed || request !== fontRequest) return 'superseded';
      metrics.fontStatus = loaded ? (family === 'Share Tech Mono' ? 'loaded' : 'system') : 'fallback';
      if (!loaded) fontFamily = 'monospace';
      measureFont();
      dirty = true;
      return metrics.fontStatus;
    });
  }

  function clearBounds(target) {
    target.text = '';
    target.x = target.y = target.width = target.height = target.right = target.bottom = target.capPx = target.rotationDeg = 0;
    target.visible = false;
  }

  function drawBlock(label, target, anchor, top, align, capPx, rotationDeg, color) {
    clearBounds(target);
    if (!label) return;
    const fontPx = capPx / fontCapRatio;
    const font = `${fontPx}px ${fontFamily}`;
    ink.font = font;
    ink.textBaseline = 'alphabetic';
    const measured = ink.measureText(label);
    const minX = -measured.actualBoundingBoxLeft;
    const maxX = measured.actualBoundingBoxRight;
    const minY = -measured.actualBoundingBoxAscent;
    const maxY = measured.actualBoundingBoxDescent;
    const radians = rotationDeg * DEG;
    const a = Math.cos(radians);
    const b = Math.sin(radians);
    const shear = -Math.tan(values[8] * DEG);
    const c = a * shear - b;
    const d = b * shear + a;
    const lowX = Math.min(a * minX, a * maxX) + Math.min(c * minY, c * maxY);
    const highX = Math.max(a * minX, a * maxX) + Math.max(c * minY, c * maxY);
    const lowY = Math.min(b * minX, b * maxX) + Math.min(d * minY, d * maxY);
    const highY = Math.max(b * minX, b * maxX) + Math.max(d * minY, d * maxY);
    scratch.width = Math.max(1, Math.ceil(highX - lowX) + 16);
    scratch.height = Math.max(1, Math.ceil(highY - lowY) + 16);
    ink.font = font;
    ink.textBaseline = 'alphabetic';
    ink.fillStyle = color;
    ink.setTransform(a, b, c, d, 8 - lowX, 8 - lowY);
    ink.fillText(label, 0, 0);

    // Raster bounds include real glyph contours after skew/rotation, not an overlarge rotated rectangle.
    const width = scratch.width;
    const height = scratch.height;
    const pixels = ink.getImageData(0, 0, width, height).data;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[(y * width + x) * 4 + 3] === 0) continue;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    if (x1 < x0) return;
    const inkWidth = x1 - x0 + 1;
    const inkHeight = y1 - y0 + 1;
    const x = Math.round(anchor - (align === 'right' ? inkWidth : align === 'center' ? inkWidth * 0.5 : 0));
    const y = Math.round(top - (align === 'center' ? inkHeight * 0.5 : 0));
    context.drawImage(scratch, x0, y0, inkWidth, inkHeight, x, y, inkWidth, inkHeight);
    target.text = label;
    target.x = x;
    target.y = y;
    target.width = inkWidth;
    target.height = inkHeight;
    target.right = x + inkWidth;
    target.bottom = y + inkHeight;
    target.capPx = capPx;
    target.rotationDeg = rotationDeg;
    target.visible = true;
    if (target === metrics.left) {
      ink.setTransform(1, 0, 0, 1, 0, 0);
      const cap = ink.measureText('H');
      metrics.fontPx = fontPx;
      metrics.capPx = cap.actualBoundingBoxAscent + cap.actualBoundingBoxDescent;
    }
  }

  function rightText() {
    clock.setTime(baseTime + Math.floor(elapsed * 1000));
    const year = clock.getUTCFullYear();
    const month = clock.getUTCMonth() + 1;
    const day = clock.getUTCDate();
    const date = values[11].replace(/YYYY|YY|MM|DD|M|D/g, (token) => {
      if (token === 'YYYY') return String(year);
      if (token === 'YY') return String(year).slice(-2);
      if (token === 'MM') return String(month).padStart(2, '0');
      if (token === 'DD') return String(day).padStart(2, '0');
      return String(token === 'M' ? month : day);
    });
    let label = date;
    if (values[12]) {
      const time = `${String(clock.getUTCHours()).padStart(2, '0')}:${String(clock.getUTCMinutes()).padStart(2, '0')}:${String(clock.getUTCSeconds()).padStart(2, '0')}`;
      label += `${label ? '  ' : ''}${time}`;
    }
    if (values[13]) label += `${label ? '  ' : ''}${values[13]}`;
    metrics.timestamp = label;
    return label;
  }

  function draw() {
    if (!values[22] && blank) {
      dirty = false;
      return;
    }
    const scale = metrics.scale;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    clearBounds(metrics.left);
    clearBounds(metrics.right);
    clearBounds(metrics.status);
    if (values[22]) {
      context.shadowColor = `rgba(0,0,0,${values[7]})`;
      context.shadowOffsetX = values[5] * scale;
      context.shadowOffsetY = values[6] * scale;
      context.shadowBlur = values[21] * scale;
      const portrait = canvas.width < canvas.height;
      const capPx = portrait ? Math.min(values[0] * scale, canvas.width / 40) : values[0] * scale;
      const timestamp = rightText();
      drawBlock(values[10], metrics.left, portrait ? canvas.width * 0.08 : values[1] * scale, values[2] * scale, 'left', capPx, -values[9], values[4]);
      drawBlock(portrait ? values[13] : timestamp, metrics.right,
        portrait ? canvas.width * 0.92 : canvas.width - (1920 - values[3]) * scale,
        values[2] * scale, 'right', capPx, values[9], values[4]);
      if (effectMode) {
        drawBlock(values[effectMode === 1 ? 23 : 24], metrics.status, canvas.width * 0.5, canvas.height * 0.5,
          'center', values[20] * scale, 0, values[effectMode === 1 ? 18 : 19]);
      }
    }
    texture.needsUpdate = true;
    metrics.drawCount++;
    metrics.lastDrawTime = elapsed;
    blank = !values[22];
    dirty = false;
  }

  function updateEffect() {
    if (effectMode) {
      const duration = effectDuration ?? values[effectMode === 1 ? 16 : 17];
      if ((effectMode === 1 || duration > 0) && elapsed - effectStart >= duration) {
        effectMode = 0;
        dirty = true;
      }
    }
    effect.connected = effectMode === 1 ? 1 : 0;
    effect.disconnected = effectMode === 2 ? 1 : 0;
  }

  function update(time, dt = 0) {
    if (disposed) return;
    const previous = elapsed;
    elapsed = Number.isFinite(time) ? Math.max(0, time) : elapsed + Math.max(0, finite(dt, 0));
    const wallTime = performance.now() / 1000;
    if (elapsed >= nextParamCheck || elapsed < previous || wallTime >= nextWallParamCheck) {
      readParams();
      nextParamCheck = elapsed + 1 / 30;
      nextWallParamCheck = wallTime + 1 / 30;
    }
    updateEffect();
    const tick = Math.floor((baseTime / 1000 + elapsed) / (values[12] ? 1 : 86400));
    if (tick !== second) {
      second = tick;
      dirty = true;
    }
    if (dirty) draw();
  }

  function beginEffect(mode, duration) {
    if (disposed) return api;
    readParams();
    effectMode = mode;
    effectStart = elapsed;
    effectDuration = Number.isFinite(duration) ? Math.max(0, duration) : undefined;
    dirty = true;
    updateEffect();
    draw();
    return api;
  }

  function setSize(width, height) {
    if (disposed) return api;
    const w = Math.max(1, Math.round(finite(width, 1)));
    const h = Math.max(1, Math.round(finite(height, 1)));
    if (canvas.width === w && canvas.height === h) return api;
    canvas.width = metrics.width = w;
    canvas.height = metrics.height = h;
    metrics.scale = h / 1080;
    blank = false;
    readParams();
    draw();
    return api;
  }

  function reset() {
    if (disposed) return api;
    elapsed = 0;
    second = NaN;
    nextParamCheck = -Infinity;
    nextWallParamCheck = -Infinity;
    effectMode = 1;
    effectStart = 0;
    effectDuration = undefined;
    dirty = true;
    update(0, 0);
    return api;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    fontRequest++;
    effect.connected = effect.disconnected = 0;
    texture.dispose();
    canvas.width = canvas.height = scratch.width = scratch.height = 1;
  }

  const api = {
    texture, canvas, effect, metrics, setSize, update, reset, dispose,
    connected: (duration) => beginEffect(1, duration),
    disconnected: (duration) => beginEffect(2, duration),
    get ready() { return ready; },
  };
  reset();
  return api;
}
