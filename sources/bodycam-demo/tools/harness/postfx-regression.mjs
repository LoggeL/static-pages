import fs from 'node:fs/promises';
import path from 'node:path';

const FIXTURE = '/bodycam-demo/__harness_postfx.html';
const HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#000}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"}}</script>
</head><body></body></html>`;

/** Real production shaders in a controlled GPU scene; no stored image baselines. */
export async function runPostfxRegression({ page, origin, out }) {
  const url = `${origin.replace(/\/$/, '')}${FIXTURE}`;
  const handler = route => route.fulfill({ contentType: 'text/html', body: HTML });
  const checks = [], images = [];
  await fs.mkdir(out, { recursive: true });
  await page.route(url, handler);
  const save = async (name, data) => {
    const file = path.join(out, `${name}.png`);
    await fs.writeFile(file, Buffer.from(data.split(',')[1], 'base64'));
    images.push(file);
  };
  try {
    await page.goto(url, { waitUntil: 'load' });
    const setup = await page.evaluate(async () => {
      const THREE = await import('three');
      const { createBodycamPost } = await import('/bodycam-demo/js/postfx/bodycam.js');
      const { fullscreenVertex } = await import('/bodycam-demo/js/postfx/shaders.js');
      const width = 1920, height = 1080;
      const renderer = new THREE.WebGLRenderer({ antialias: false });
      renderer.setPixelRatio(1); renderer.setSize(width, height);
      renderer.setClearColor(0, 0); document.body.append(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(82, width / height, .025, 100);
      scene.add(camera);
      const post = createBodycamPost(renderer, scene, camera, { params: {
        osd: { enabled: false }, exposure: { enabled: false, manualEV: 0 },
        noise: { enabled: false }, bloom: { enabled: false },
        lens: { mask: { enabled: false } }, rollingShutter: { enabled: true },
        blocks: { ringing: 0 }, debug: { gpuTiming: false },
      } });
      const size = 256, bytes = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4, gray = 64 + Math.round(5 * Math.sin(x * .1));
        bytes[i] = bytes[i + 1] = bytes[i + 2] = gray; bytes[i + 3] = 255;
      }
      const texture = new THREE.DataTexture(bytes, size, size);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
      const world = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ map: texture }));
      world.position.z = -4; scene.add(world);
      // Camera-attached silhouette covers the same layer path as the app weapon.
      // The real app/GLB is covered by the weapon shot list, not impersonated here.
      const view = new THREE.Mesh(new THREE.PlaneGeometry(.31, .21),
        new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(.012, .014, .016) }));
      view.layers.set(1); view.position.set(.13, -.1, -.5); camera.add(view);
      const line = new THREE.Mesh(new THREE.PlaneGeometry(.012, 20), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      line.position.set(-.5, 0, -3); scene.add(line);
      const targets = new Map(), materials = {}, draw = renderer.render.bind(renderer);
      renderer.render = (s, c) => {
        const target = renderer.getRenderTarget();
        if (target?.texture?.name?.startsWith('Bodycam.')) targets.set(target.texture.name, target);
        const material = s.children[0]?.material, uniforms = material?.uniforms;
        if (uniforms?.tBlocks) materials.sensor = material;
        if (uniforms?.shutterScale) materials.motion = material;
        return draw(s, c);
      };
      const quadScene = new THREE.Scene(), quadCamera = new THREE.Camera();
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); quad.frustumCulled = false; quadScene.add(quad);
      const readTarget = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false, type: THREE.UnsignedByteType });
      const coverageMaterial = new THREE.ShaderMaterial({ vertexShader: fullscreenVertex,
        fragmentShader: 'varying vec2 vUv; uniform sampler2D source; void main(){gl_FragColor=vec4(vec3(texture2D(source,vUv).a),1.0);}',
        uniforms: { source: { value: null } }, depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending });
      const renderMaterial = material => {
        quad.material = material; renderer.setRenderTarget(readTarget); draw(quadScene, quadCamera);
        const pixels = new Uint8Array(width * height * 4);
        renderer.readRenderTargetPixels(readTarget, 0, 0, width, height, pixels);
        renderer.setRenderTarget(null); return pixels;
      };
      const png = pixels => {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d'), image = context.createImageData(width, height);
        for (let y = 0; y < height; y++) image.data.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), (height - 1 - y) * width * 4);
        context.putImageData(image, 0, 0); return canvas.toDataURL('image/png');
      };
      const measure = (on, off, coverage) => {
        let maxDelta = 0, above8 = 0, coveredPixels = 0, coveredMax = 0, coveredAbove1 = 0, worldChanged = 0, sum = 0;
        for (let i = 0; i < on.length; i += 4) {
          const delta = Math.max(Math.abs(on[i] - off[i]), Math.abs(on[i + 1] - off[i + 1]), Math.abs(on[i + 2] - off[i + 2]));
          maxDelta = Math.max(maxDelta, delta); sum += delta; if (delta > 8) above8++;
          if (coverage[i] === 255) { coveredPixels++; coveredMax = Math.max(coveredMax, delta); if (delta > 1) coveredAbove1++; }
          else if (coverage[i] === 0 && delta > 0) worldChanged++;
        }
        return { maxDelta, above8, coveredPixels, coveredMax, coveredAbove1, worldChanged, meanDelta: sum / (width * height) };
      };
      const capture = () => {
        const sensor = materials.sensor, amount = sensor.uniforms.blockAmount.value;
        const on = renderMaterial(sensor); let off;
        try { sensor.uniforms.blockAmount.value = 0; off = renderMaterial(sensor); }
        finally { sensor.uniforms.blockAmount.value = amount; }
        coverageMaterial.uniforms.source.value = targets.get('Bodycam.lens').texture;
        const coverage = renderMaterial(coverageMaterial);
        return { on, off, coverage, metrics: { ...measure(on, off, coverage), blockAmount: amount,
          shutterScale: materials.motion.uniforms.shutterScale.value } };
      };
      const state = { time: 20, angularVelocity: new THREE.Vector3(), damage: 0, shake: .6 };
      const step = (dt = 1 / 60) => { state.time += dt; post.render(dt, state); };
      const gl = renderer.getContext(), info = gl.getExtension('WEBGL_debug_renderer_info');
      window.__postfxRegression = { THREE, width, height, renderer, scene, camera, post, texture, world, view, line,
        state, targets, materials, quad, readTarget, coverageMaterial, step, capture, measure, png };
      step();
      return { width, height, renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        fixture: 'Production post-FX with a controlled layer-1 silhouette and world geometry',
        comparison: 'Same already-rendered source, history, timestamp and sensor uniforms; only blockAmount differs',
        limits: { channelDelta: 8, coveredChannelDelta: 1, minimumCoveredPixels: 1000 } };
    });
    checks.push({ name: 'postfx-real-gpu', passed: /Metal/i.test(setup.renderer), details: setup });
    const rows = [];
    for (const quality of ['low', 'medium', 'high']) for (const speed of [300, 600]) {
      const result = await page.evaluate(({ quality, speed }) => {
        const f = window.__postfxRegression, radians = speed * Math.PI / 180, samples = [], rotations = [];
        f.post.setQuality(quality); f.camera.rotation.y = -2 * radians / 60; f.post.resetHistory(); f.step();
        for (let frame = 1; frame <= 12; frame++) {
          const sign = Math.floor((frame - 1) / 3) % 2 ? -1 : 1;
          f.state.angularVelocity.y = sign * radians; f.camera.rotation.y += sign * radians / 60;
          f.view.position.x = frame % 2 ? -.1 : .2; f.view.rotation.z = .15 * Math.sin(frame);
          f.step(); rotations.push(f.camera.rotation.y);
          if (frame === 8 || frame === 12) {
            const capture = f.capture(); samples.push({ frame, ...capture.metrics });
            if (frame === 12) f.lastCapture = capture;
          }
        }
        return { quality, speedDegPerSecond: speed, radiansPerFrame: radians / 60, rotations, samples,
          image: quality === 'high' && speed === 600 ? f.png(f.lastCapture.on) : null };
      }, { quality, speed });
      if (result.image) await save('postfx-rapid-high-600', result.image);
      delete result.image; rows.push(result);
    }
    checks.push({ name: 'postfx-fast-rotation-no-stale-blocks',
      passed: rows.every(row => row.samples.every(m => m.coveredPixels > 1000 && m.maxDelta <= 8 && m.coveredMax <= 1 && m.blockAmount > 0 && m.shutterScale > 0)),
      details: { rows, note: 'Fixed residual limits in 8-bit display RGB. The coverage gate prevents an empty mask from passing.' } });
    const negative = await page.evaluate(() => {
      const f = window.__postfxRegression, { on, off, coverage } = f.lastCapture, seeded = new Uint8Array(on);
      let center = -1;
      for (let y = 24; y < f.height - 24 && center < 0; y++) for (let x = 24; x < f.width - 24; x++) {
        if (coverage[(y * f.width + x) * 4] === 255) { center = y * f.width + x; break; }
      }
      if (center < 0) throw new Error('Post-FX negative control has no covered pixel');
      const cx = center % f.width, cy = Math.floor(center / f.width);
      for (let y = cy - 24; y < cy + 24; y++) for (let x = cx - 24; x < cx + 24; x++) {
        const i = (y * f.width + x) * 4;
        for (let c = 0; c < 3; c++) seeded[i + c] = off[i + c] < 64 ? off[i + c] + 64 : off[i + c] - 64;
      }
      return { metrics: f.measure(seeded, off, coverage), seededTile: { x: cx - 24, y: cy - 24, size: 48, channelOffset: 64 },
        off: f.png(off), coverage: f.png(coverage), seeded: f.png(seeded) };
    });
    await save('postfx-rapid-high-600-no-compression', negative.off);
    await save('postfx-rapid-high-600-coverage', negative.coverage);
    await save('postfx-negative-seeded-tile', negative.seeded);
    checks.push({ name: 'postfx-metric-rejects-seeded-48px-tile',
      passed: negative.metrics.above8 >= 48 * 48 && negative.metrics.coveredAbove1 > 0,
      details: { metrics: negative.metrics, seededTile: negative.seededTile, note: 'Negative control mutates a copy of real pixels only, never production renderer or measured positive frames.' } });
    const smooth = await page.evaluate(() => {
      const f = window.__postfxRegression;
      f.view.visible = false; f.line.visible = false; f.camera.rotation.y = 0; f.state.shake = 0;
      f.post.params.lens.enabled = false; f.post.params.rollingShutter.enabled = false;
      f.post.params.sharpen.amount = 0; f.state.angularVelocity.y = 8; f.post.resetHistory(); f.step();
      return f.capture().metrics;
    });
    checks.push({ name: 'postfx-compression-remains-active', passed: smooth.worldChanged > 100 && smooth.maxDelta <= 8 && smooth.blockAmount > 0,
      details: smooth });
    await page.evaluate(() => {
      const f = window.__postfxRegression, canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1024;
      const context = canvas.getContext('2d');
      context.fillStyle = '#000'; context.fillRect(0, 0, 1024, 1024);
      context.fillStyle = '#fff'; context.fillRect(510, 0, 4, 1024);
      f.blurTexture = new f.THREE.CanvasTexture(canvas); f.blurTexture.colorSpace = f.THREE.SRGBColorSpace;
      // A texture stripe shares the background depth. A separate foreground line
      // is intentionally excluded from background blur by the depth-reject pass.
      f.world.material.map = f.blurTexture; f.world.material.color.setRGB(1, 1, 1);
      f.world.material.needsUpdate = true; f.world.scale.setScalar(.3);
      f.line.visible = false; f.view.visible = false; f.scene.background = new f.THREE.Color(0);
      Object.assign(f.post.params.grade, { saturation: 1, warmIndoor: 0, toeCrush: 0, toePower: 1 });
      f.post.params.blocks.enabled = false;
    });
    const blur = [];
    for (const speed of [300, 600]) {
      const result = await page.evaluate(speed => {
        const f = window.__postfxRegression, gl = f.renderer.getContext();
        f.camera.rotation.y = 0; f.post.resetHistory(); f.step();
        f.camera.rotation.y = speed * Math.PI / 180 / 60; f.state.angularVelocity.y = speed * Math.PI / 180; f.step();
        const measureLine = () => {
          const pixels = new Uint8Array(f.width * 4); gl.readPixels(0, f.height / 2, f.width, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let first = -1, last = -1, active = 0, peak = 0;
          for (let x = 0; x < f.width; x++) { const v = pixels[x * 4]; peak = Math.max(peak, v); if (v > 6) { if (first < 0) first = x; last = x; active++; } }
          return { support: first < 0 ? 0 : last - first + 1, active, peak };
        };
        const moving = measureLine(), shutterScale = f.materials.motion.uniforms.shutterScale.value;
        f.post.resetHistory(); f.post.render(1 / 60, f.state); const reset = measureLine();
        return { speedDegPerSecond: speed, moving, reset, shutterScale };
      }, speed);
      blur.push(result);
    }
    checks.push({ name: 'postfx-world-camera-blur-preserved',
      passed: blur.every(row => row.shutterScale > 0 && row.reset.support > 0 && row.moving.support > row.reset.support + 30),
      details: { rows: blur, note: 'Coplanar texture stripe, same real camera pose, comparison against explicit history reset; camera rotates between consecutive world renders.' } });
    const gl = await page.evaluate(() => {
      const f = window.__postfxRegression, context = f.renderer.getContext();
      return { error: context.getError(), contextLost: context.isContextLost(), diagnostics: f.post.diagnostics };
    });
    checks.push({ name: 'postfx-gl-valid', passed: gl.error === 0 && !gl.contextLost, details: gl });
    return { checks, images, fixture: url };
  } finally {
    await page.evaluate(() => {
      const f = window.__postfxRegression;
      if (!f) return;
      f.post.dispose(); f.texture.dispose(); f.blurTexture?.dispose(); f.readTarget.dispose(); f.coverageMaterial.dispose(); f.quad.geometry.dispose();
      for (const mesh of [f.world, f.view, f.line]) { mesh.geometry.dispose(); mesh.material.dispose(); }
      f.renderer.dispose(); delete window.__postfxRegression;
    }).catch(() => {});
    await page.unroute(url, handler);
  }
}
