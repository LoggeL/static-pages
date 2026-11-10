// Szene, Licht, Laden des Modells, Zustände der Anlagenteile, Kamera. Blender-Koordinaten (x, y, z) → three.js (x, z, −y).
window.PBT = window.PBT || {};
PBT.ready = (async function () {
  const P = window.PBT, CDN = 'https://cdn.jsdelivr.net/npm/three@0.164.1/';
  const say = (t, k) => { document.getElementById('loadtxt').textContent = t; document.getElementById('loadbar').style.width = k * 100 + '%'; };
  say('Lade 3D-Bibliothek …', .08);
  const THREE = P.THREE = await import('three');
  const [{ OrbitControls }, { GLTFLoader }, { DRACOLoader }, { Sky }, { EffectComposer }, { RenderPass }, { GTAOPass }, { OutputPass }] = await Promise.all([
    'controls/OrbitControls.js', 'loaders/GLTFLoader.js', 'loaders/DRACOLoader.js', 'objects/Sky.js', 'postprocessing/EffectComposer.js',
    'postprocessing/RenderPass.js', 'postprocessing/GTAOPass.js', 'postprocessing/OutputPass.js'].map(f => import('three/addons/' + f)));
  const V3 = THREE.Vector3; P.b2t = p => new V3(p[0], p[2], -p[1]);

  // ---------- Renderer, Kamera, Steuerung ----------
  const canvas = document.getElementById('view');
  const renderer = P.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .58;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false; renderer.localClippingEnabled = true;
  const scene = P.scene = new THREE.Scene(), camera = P.camera = new THREE.PerspectiveCamera(38, 1, .5, 60000);
  camera.position.copy(P.b2t([-150, -230, 190]));
  const controls = P.controls = new OrbitControls(camera, canvas); controls.target.copy(P.b2t([28, 6, 14]));
  Object.assign(controls, { enableDamping: true, dampingFactor: .09, maxPolarAngle: Math.PI * .497, minDistance: 3, maxDistance: 1400, zoomToCursor: true, screenSpacePanning: true });
  let dirty = true; P.invalidate = () => { dirty = true; }; controls.addEventListener('change', P.invalidate);
  P.onFrame = []; P.afterRender = [];

  // ---------- Himmel, Umgebungslicht, Sonne, Dunst ----------
  const sunDir = new V3(-.452, .616, .645).normalize();
  const mkSky = () => { const s = new Sky(); s.scale.setScalar(30000); const u = s.material.uniforms; u.turbidity.value = 6; u.rayleigh.value = 1.5; u.mieCoefficient.value = .004; u.mieDirectionalG.value = .8; u.sunPosition.value.copy(sunDir); return s; };
  scene.add(mkSky());
  const env = new THREE.Scene(); env.add(mkSky());
  const gnd = new THREE.Mesh(new THREE.CircleGeometry(20000, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4d5146 })); gnd.position.y = -3; env.add(gnd);
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(env, 0, 1, 50000).texture; scene.environmentIntensity = .5;
  scene.fog = new THREE.FogExp2(0xc3d0db, .00013);
  const C = P.b2t([33, 4, 0]), sun = new THREE.DirectionalLight(0xfff0dc, 5.2);
  sun.position.copy(C).addScaledVector(sunDir, 420); sun.target.position.copy(C); scene.add(sun, sun.target); sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -165, right: 165, top: 150, bottom: -150, near: 120, far: 760 }); sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -.0005; sun.shadow.normalBias = .07;
  P.shadows = () => { renderer.shadowMap.needsUpdate = true; dirty = true; };

  // ---------- Nachbearbeitung: MSAA, Umgebungsverdeckung, Tonemapping ----------
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { samples: 4, type: THREE.HalfFloatType }));
  composer.addPass(new RenderPass(scene, camera));
  let gtao = null;
  try {
    gtao = new GTAOPass(scene, camera, 4, 4);
    gtao.updateGtaoMaterial({ radius: .8, distanceExponent: 1.3, thickness: 1.4, scale: 1.25, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    const ov = gtao.overrideVisibility.bind(gtao);  // Transparentes und Überlagerungen werfen keine Verdeckung
    gtao.overrideVisibility = () => { ov(); scene.traverse(o => { if (o.userData.noAO) o.visible = false; }); };
    composer.addPass(gtao);
  } catch (e) { console.warn('GTAO nicht verfügbar', e); gtao = null; }
  composer.addPass(new OutputPass());
  let off = 0, offT = 0; P.setShift = px => { offT = px; dirty = true; };  // Bildmitte neben die Seitenleisten schieben
  const applyOff = () => { const w = innerWidth, h = innerHeight; Math.abs(off) > .5 ? camera.setViewOffset(w, h, -off, 0, w, h) : camera.clearViewOffset(); };
  const resize = () => { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; applyOff(); camera.updateProjectionMatrix(); dirty = true; };
  addEventListener('resize', resize); resize();

  // ---------- Modell laden ----------
  say('Entpacke Modell …', .3);
  const A = window.PBT_ASSETS, draco = new DRACOLoader(); draco.setDecoderPath(CDN + 'examples/jsm/libs/draco/gltf/');
  const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
  const buf = await (await fetch('data:application/octet-stream;base64,' + A.glb)).arrayBuffer(); A.glb = null;
  say('Baue Szene …', .6);
  const gltf = await loader.parseAsync(buf, ''); scene.add(gltf.scene);

  // ---------- Materialien und Anlagenteile ----------
  const plane = P.plane = new THREE.Plane(new V3(0, 0, -1), 1e6), aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const seen = new Set(), siteMat = new Map(), ghostMat = new Map(), NOCAST = /^(glass|water|bdo|grass|far\d)$/;
  const fix = m => {
    if (seen.has(m)) return m; seen.add(m);
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (m[k]) m[k].anisotropy = aniso;
    if (m.name === 'grating') Object.assign(m, { transparent: false, alphaTest: .2, depthWrite: true });
    if (/^(glass|water|bdo)$/.test(m.name)) m.depthWrite = false;
    return m;
  };
  const ghost = m => {
    if (!ghostMat.has(m)) {
      const g = m.clone(); g.name = m.name + '_ghost'; g.transparent = true; g.depthWrite = false; g.opacity = m.name === 'grating' ? .22 : .13; g.color.lerp(new THREE.Color(0xa9d8ff), .45);
      g.roughness = Math.min(g.roughness, .35); g.clippingPlanes = [plane]; ghostMat.set(m, g);
    }
    return ghostMat.get(m);
  };
  const U = P.units = {};
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    let n = o; while (n && !n.userData.unit) n = n.parent;
    const unit = n ? n.userData.unit : 'site', role = n ? n.userData.role : 'shell'; let m = fix(o.material);
    if (unit === 'site') { if (!siteMat.has(m)) siteMat.set(m, m.clone()); m = o.material = siteMat.get(m); } else { m.clippingPlanes = [plane]; m.clipShadows = true; }
    o.castShadow = !NOCAST.test(m.name); o.receiveShadow = true; o.userData.mat0 = m; o.userData.cast0 = o.castShadow; o.userData.unitId = unit; o.userData.role = role;
    const u = U[unit] = U[unit] || { id: unit, state: 'solid', meshes: { shell: [], eq: [], inner: [] }, box: new THREE.Box3() };
    u.meshes[role].push(o); if (role !== 'inner') u.box.expandByObject(o);
  });
  for (const d of P.UNITS) {
    const u = U[d.id]; if (!u) { console.warn('fehlt im Modell:', d.id); continue; }
    u.def = d; u.center = u.box.getCenter(new V3()); const a = d.pos || (A.anchors[d.id] && [A.anchors[d.id][0], A.anchors[d.id][1], null]);
    u.anchor = a ? new V3(a[0], a[2] == null ? u.box.max.y + 1.5 : a[2], -a[1]) : new V3(u.center.x, u.box.max.y + 1.5, u.center.z);
  }
  const listeners = []; P.on = f => listeners.push(f); const emit = (e, id) => listeners.forEach(f => f(e, id));
  P.setState = (id, state) => {
    const u = U[id]; if (!u || u.state === state) return; u.state = state; const g = state === 'ghost', vis = state !== 'hidden';
    for (const m of u.meshes.shell) { m.visible = vis; m.material = g ? ghost(m.userData.mat0) : m.userData.mat0; m.castShadow = !g && m.userData.cast0; m.userData.noAO = g; m.renderOrder = g ? 4 : 0; }
    for (const m of u.meshes.eq.concat(u.meshes.inner)) m.visible = vis;
    P.shadows(); emit('state', id);
  };
  P.setSection = c => { plane.constant = c == null ? 1e6 : -c; if (gtao) gtao.enabled = c == null && P.ao !== false; P.shadows(); };
  P.setAO = on => { P.ao = on; if (gtao) gtao.enabled = on && plane.constant > 1e5; dirty = true; };

  // ---------- Auswahl per Klick ----------
  const ray = new THREE.Raycaster(), pickables = []; for (const id in U) if (id !== 'site') for (const r in U[id].meshes) pickables.push(...U[id].meshes[r]);
  P.pick = (x, y) => {
    ray.setFromCamera(new THREE.Vector2(x / innerWidth * 2 - 1, -y / innerHeight * 2 + 1), camera);
    const hits = ray.intersectObjects(pickables.filter(m => m.visible), false).filter(h => plane.distanceToPoint(h.point) >= 0);
    const weak = h => h.object.userData.noAO || h.object.userData.mat0.name === 'grating' || h.object.userData.unitId === 'i01';
    const h = hits.find(h => !weak(h) && h.distance < (hits[0].distance + 60)) || hits[0]; return h ? h.object.userData.unitId : null;
  };

  // Welche Anlagenteile stehen zwischen Kamerastandort und einem Anlagenteil?
  P.occluders = (id, from) => {
    const u = U[id], out = new Set(), c = u.center, s = u.box.getSize(new V3()).multiplyScalar(.3);
    const tg = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]].map(a => c.clone().add(new V3(a[0] * s.x, a[1] * s.y, a[2] * s.z)));
    const vis = pickables.filter(m => m.visible && !m.userData.noAO);
    for (const t of tg) {
      const dir = t.clone().sub(from); ray.far = dir.length(); ray.set(from, dir.normalize());
      for (const h of ray.intersectObjects(vis, false)) { if (h.object.userData.unitId === id) break; if (plane.distanceToPoint(h.point) >= 0) out.add(h.object.userData.unitId); }
    }
    ray.far = Infinity; return out;
  };
  // Beschleunigte Strahltests (optional – ohne die Bibliothek läuft die Auswahl langsamer, aber gleich)
  import('https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.7.4/build/index.module.js').then(b => {
    const q = pickables.slice(), step = () => { const t = performance.now(); while (q.length && performance.now() - t < 12) { const m = q.pop(); if (!m.geometry.boundsTree) { m.geometry.boundsTree = new b.MeshBVH(m.geometry); m.raycast = b.acceleratedRaycast; } else m.raycast = b.acceleratedRaycast; } if (q.length) setTimeout(step, 30); };
    setTimeout(step, 1500);
  }).catch(e => console.warn('BVH nicht verfügbar', e));

  // ---------- Kameraflug ----------
  let fly = null; const ease = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  P.flyTo = (pos, tgt, dur = 1.4) => { fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: tgt.clone(), s: performance.now(), dur: dur * 1000 }; };
  canvas.addEventListener('pointerdown', () => { fly = null; P.orbit = false; emit('orbit'); });
  P.focusUnit = id => {
    const u = U[id]; if (!u) return; const size = u.box.getSize(new V3()), r = Math.min(Math.max(size.length() / 2, 7), 110);
    const d = camera.position.clone().sub(controls.target); const az = Math.atan2(d.x, d.z), el = .42, dist = r / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
    const pos = u.center.clone().add(new V3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist)); pos.y = Math.max(pos.y, 2.5); P.flyTo(pos, u.center); return pos;
  };
  P.view = (p, t, dur) => P.flyTo(P.b2t(p), P.b2t(t), dur);

  // ---------- Bildschleife (rendert nur bei Änderungen) ----------
  let last = performance.now();
  const frame = now => {
    requestAnimationFrame(frame); const dt = Math.min(.1, (now - last) / 1000); last = now;
    if (fly) { const k = Math.min(1, (now - fly.s) / fly.dur), e = ease(k); camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.t0, fly.t1, e); dirty = true; if (k >= 1) fly = null; }
    if (Math.abs(offT - off) > .5) { off += (offT - off) * Math.min(1, dt * 6); if (Math.abs(offT - off) <= .5) off = offT; applyOff(); dirty = true; }
    if (P.orbit && !fly) { const d = camera.position.clone().sub(controls.target); d.applyAxisAngle(new V3(0, 1, 0), dt * .12); camera.position.copy(controls.target).add(d); dirty = true; }
    controls.update(); for (const f of P.onFrame) if (f(dt, now / 1000)) dirty = true;
    if (!dirty) return; dirty = false; composer.render(); for (const f of P.afterRender) f();
  };
  renderer.shadowMap.needsUpdate = true; say('Fertig', 1); requestAnimationFrame(frame);
  return P;
})().catch(e => { console.error(e); const t = document.getElementById('loadtxt'); if (t) { t.textContent = 'Modell konnte nicht geladen werden: ' + (e && e.message || e); t.classList.add('err'); } throw e; });
