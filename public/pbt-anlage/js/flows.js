// Stofffluss: Leitungswege als Linien, darauf wandernde Punkte je Medium. Wird über alles gezeichnet, damit die Ströme im Gerüst lesbar bleiben.
PBT.ready.then(P => {
  const THREE = P.THREE, grp = new THREE.Group(); grp.visible = false; P.scene.add(grp);
  const paths = []; let n = 0; const off = new Set();
  for (const f of window.PBT_ASSETS.flows) {
    const def = P.FLOWS[f.kind]; if (!def) continue;
    const pts = f.pts.map(P.b2t), cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const L = cum[cum.length - 1]; if (L < 1) continue;
    const col = new THREE.Color(def[1]);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: .6, depthTest: false, fog: false }));
    line.renderOrder = 9; line.frustumCulled = false; grp.add(line);
    const cnt = Math.max(2, Math.round(L / 2.4)); paths.push({ kind: f.kind, pts, cum, L, col, cnt, at: n, line, v: /pellet|pta|paste|melt/.test(f.kind) ? 2.2 : 4.5 }); n += cnt;
  }
  const pos = new Float32Array(n * 3), colr = new Float32Array(n * 3);
  for (const p of paths) for (let i = 0; i < p.cnt; i++) colr.set([p.col.r, p.col.g, p.col.b], (p.at + i) * 3);
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const c = cv.getContext('2d'), gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, '#fff'); gr.addColorStop(.45, '#fff'); gr.addColorStop(.6, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  const dots = new THREE.Points(geo, new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false, depthWrite: false, fog: false }));
  dots.renderOrder = 10; dots.frustumCulled = false; grp.add(dots);
  const update = t => {
    for (const p of paths) {
      const hide = off.has(p.kind); let k = 0;
      const s0 = (t * p.v) % (p.L / p.cnt);
      for (let i = 0; i < p.cnt; i++) {
        const s = s0 + i * p.L / p.cnt, o = (p.at + i) * 3;
        if (hide) { pos[o + 1] = -1e5; continue; }
        while (k < p.cum.length - 2 && p.cum[k + 1] < s) k++;
        const a = p.pts[k], b = p.pts[k + 1], u = (s - p.cum[k]) / Math.max(1e-6, p.cum[k + 1] - p.cum[k]);
        pos[o] = a.x + (b.x - a.x) * u; pos[o + 1] = a.y + (b.y - a.y) * u; pos[o + 2] = a.z + (b.z - a.z) * u;
      }
    }
    geo.attributes.position.needsUpdate = true;
  };
  P.onFrame.push((dt, t) => { if (!grp.visible) return false; update(t); return true; });
  P.setFlows = on => { grp.visible = on; P.invalidate(); };
  P.toggleFlowKind = kind => { off.has(kind) ? off.delete(kind) : off.add(kind); for (const p of paths) p.line.visible = !off.has(p.kind); P.invalidate(); return !off.has(kind); };
  P.flowKinds = [...new Set(paths.map(p => p.kind))];
});
