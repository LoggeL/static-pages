// Bedienoberfläche: Liste, Infokarte, Beschriftung, Werkzeugleiste, Auswahl per Klick.
PBT.ready.then(P => {
  const THREE = P.THREE, $ = s => document.querySelector(s), U = P.units, D = P.UNITS.filter(d => U[d.id]), byId = Object.fromEntries(D.map(d => [d.id, d]));
  const proc = D.filter(d => d.grp === 'p'); let sel = null, iso = false;
  const auto = new Set();  // beim Anfliegen automatisch transparent geschaltete Verdecker
  const clearAuto = () => { for (const k of auto) if (U[k].state === 'ghost') P.setState(k, 'solid'); auto.clear(); };
  const shift = () => P.setShift(innerWidth > 760 ? ($('#list').classList.contains('off') ? 0 : 166) - ($('#info').hidden ? 0 : 181) : 0);
  addEventListener('resize', shift);
  const IC = {
    x: '<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" opacity=".55"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/></svg>',
    eyeoff: '<svg viewBox="0 0 24 24"><path d="M4 4l16 16M9.9 5.8A10.6 10.6 0 0112 5.5C18.4 5.5 22 12 22 12a17 17 0 01-3.2 3.9M6.3 7.6A17 17 0 002 12s3.6 6.5 10 6.5a10 10 0 004-.8"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  // ---------- Liste ----------
  const list = $('#list');
  const rowHtml = d => `<div class="row" data-id="${d.id}" tabindex="0" role="button"><span class="nr">${d.nr}</span><span class="nm">${d.name}<small>${d.kurz}</small></span>` +
    `<button class="ib bx" title="Hülle transparent schalten" aria-label="${d.name} transparent schalten">${IC.x}</button><button class="ib be" title="Ausblenden" aria-label="${d.name} ausblenden">${IC.eye}</button></div>`;
  list.innerHTML = '<div class="grp">Prozess</div>' + proc.map(rowHtml).join('') + '<div class="grp">Infrastruktur</div>' + D.filter(d => d.grp === 'i').map(rowHtml).join('');
  const rows = Object.fromEntries([...list.querySelectorAll('.row')].map(r => [r.dataset.id, r]));
  const sync = id => {
    const r = rows[id], s = U[id].state; if (!r) return;
    r.classList.toggle('hid', s === 'hidden'); r.querySelector('.bx').classList.toggle('on', s === 'ghost'); r.querySelector('.be').innerHTML = s === 'hidden' ? IC.eyeoff : IC.eye;
    if (labels[id]) labels[id].classList.toggle('dim', s === 'hidden');
    if (sel === id) card(); $('#bxray').classList.toggle('on', D.every(d => U[d.id].state === 'ghost'));
  };
  list.addEventListener('click', e => {
    const r = e.target.closest('.row'); if (!r) return; const id = r.dataset.id, s = U[id].state;
    if (e.target.closest('.bx')) P.setState(id, s === 'ghost' ? 'solid' : 'ghost');
    else if (e.target.closest('.be')) P.setState(id, s === 'hidden' ? 'solid' : 'hidden');
    else select(id, true);
  });
  list.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('row')) { e.preventDefault(); select(e.target.dataset.id, true); } });
  $('#menu').onclick = () => { list.classList.toggle('off'); shift(); };

  // ---------- Beschriftung ----------
  const lc = $('#labels'), labels = {};
  for (const d of D) { const b = document.createElement('button'); b.className = 'lbl'; b.innerHTML = `<b>${d.nr}</b><span>${d.name}</span>`; b.onclick = () => select(d.id, true); lc.appendChild(b); labels[d.id] = b; }
  const v = new THREE.Vector3();
  P.afterRender.push(() => {
    if (lc.hidden) return;
    for (const d of D) {
      v.copy(U[d.id].anchor).project(P.camera); const el = labels[d.id];
      if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) { el.style.display = 'none'; continue; }
      el.style.display = ''; el.style.transform = `translate(${((v.x + 1) / 2 * innerWidth - 12).toFixed(1)}px, ${((1 - v.y) / 2 * innerHeight - 12).toFixed(1)}px)`;
    }
  });

  // ---------- Auswahl und Infokarte ----------
  const box = new THREE.Box3Helper(new THREE.Box3(), 0x58a8ff); box.material.depthTest = false; box.material.transparent = true; box.material.opacity = .75; box.renderOrder = 8; box.visible = false; P.scene.add(box);
  const info = $('#info');
  function card() {
    const d = byId[sel]; if (!d) { info.hidden = true; shift(); return; }
    const i = proc.indexOf(d), s = U[sel].state, prev = i > 0 ? proc[i - 1] : null, next = i >= 0 && i < proc.length - 1 ? proc[i + 1] : null;
    info.innerHTML = `<button class="ib x" title="Schließen" aria-label="Schließen">${IC.close}</button>` +
      `<div class="tag">${i >= 0 ? `Prozessschritt ${i + 1} von ${proc.length}` : 'Infrastruktur ' + d.nr}</div><h2>${d.name}</h2><div class="kurz">${d.kurz}</div><p>${d.text}</p>` +
      `<dl class="kenn">${d.kenn.map(k => `<dt>${k[0]}</dt><dd>${k[1]}</dd>`).join('')}</dl>` +
      (d.innen.length ? `<h3>Innenleben</h3><ul>${d.innen.map(t => `<li>${t}</li>`).join('')}</ul>` : '') +
      `<div class="acts"><button class="btn ${s === 'ghost' ? 'on' : 'pri'}" data-a="x">${IC.x}${s === 'ghost' ? 'Wieder deckend' : 'Transparent schalten'}</button>` +
      `<button class="btn ${iso ? 'on' : ''}" data-a="iso">${iso ? 'Alle zeigen' : 'Freistellen'}</button></div>` +
      (i >= 0 ? `<div class="nav"><button data-a="prev" ${prev ? '' : 'disabled style="visibility:hidden"'}>← ${prev ? prev.name : ''}</button><button data-a="next" ${next ? '' : 'disabled style="visibility:hidden"'}>${next ? next.name : ''} →</button></div>` : '') +
      '<p class="note">Kennwerte sind verfahrenstypische Richtwerte. Das Modell ist schematisch und bildet keine reale Anlage ab.</p>';
    info.hidden = false; shift();
  }
  info.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; const a = b.dataset.a, i = proc.indexOf(byId[sel]);
    if (b.classList.contains('x')) select(null);
    else if (a === 'x') P.setState(sel, U[sel].state === 'ghost' ? 'solid' : 'ghost');
    else if (a === 'iso') { iso = !iso; for (const d of D) if (d.id !== sel) P.setState(d.id, iso || auto.has(d.id) ? 'ghost' : 'solid'); if (iso) P.setState(sel, 'solid'); card(); }
    else if (a === 'prev') select(proc[i - 1].id, true);
    else if (a === 'next') select(proc[i + 1].id, true);
  });
  function select(id, fly) {
    if (iso && id !== sel) { iso = false; auto.clear(); for (const d of D) P.setState(d.id, 'solid'); }
    if (id !== sel) clearAuto();
    if (sel && rows[sel]) { rows[sel].classList.remove('sel'); labels[sel].classList.remove('sel'); }
    sel = id; box.visible = false;
    if (id) {
      rows[id].classList.add('sel'); labels[id].classList.add('sel'); rows[id].scrollIntoView({ block: 'nearest' });
      const u = U[id]; if (u.state === 'hidden') P.setState(id, 'solid');
      if (u.box.getSize(new THREE.Vector3()).length() < 140) { box.box.copy(u.box).expandByScalar(.4); box.visible = true; }
      if (fly) { const from = P.focusUnit(id); for (const k of P.occluders(id, from)) if (U[k].state === 'solid') { auto.add(k); P.setState(k, 'ghost'); } }
    }
    card(); P.invalidate();
  }
  P.select = select; P.on((e, id) => { if (e === 'state') sync(id); if (e === 'orbit') $('#borbit').classList.remove('on'); });

  // ---------- Klick und Hover in der 3D-Ansicht ----------
  const cv = $('#view'), tip = $('#tip'); let down = null, tHover = 0, drag = false;
  cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; drag = true; tip.hidden = true; $('#hint').classList.add('off'); });
  addEventListener('pointerup', e => {
    drag = false; if (!down || e.target !== cv) { down = null; return; }
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null; if (moved > 5) return;
    const id = P.pick(e.clientX, e.clientY); select(id && byId[id] ? id : null, false);
  });
  cv.addEventListener('pointermove', e => {
    if (drag || e.pointerType === 'touch') return; const now = performance.now(); if (now - tHover < 110) return; tHover = now;
    const id = P.pick(e.clientX, e.clientY), d = id && byId[id];
    cv.style.cursor = d ? 'pointer' : ''; tip.hidden = !d;
    if (d) { tip.textContent = `${d.nr} · ${d.name}`; tip.style.left = Math.min(e.clientX + 14, innerWidth - 220) + 'px'; tip.style.top = e.clientY + 16 + 'px'; }
  });
  cv.addEventListener('pointerleave', () => { tip.hidden = true; });
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return; const i = proc.indexOf(byId[sel]);
    if (e.key === 'Escape') select(null); else if (e.key === 'ArrowRight' && i >= 0 && i < proc.length - 1) select(proc[i + 1].id, true); else if (e.key === 'ArrowLeft' && i > 0) select(proc[i - 1].id, true);
  });

  // ---------- Werkzeugleiste ----------
  const VIEWS = { luft: [[-62, -118, 82], [28, 4, 12]], sued: [[19, -78, 24], [25, 8, 20]], nw: [[-38, 62, 30], [22, 10, 20]], innen: [[13.2, 8.8, 22.7], [36, 9.6, 22.3]] };
  $('#views').addEventListener('click', e => { const b = e.target.closest('button'); if (b) P.view(...VIEWS[b.dataset.v]); });
  $('#bxray').onclick = () => { const on = !D.every(d => U[d.id].state === 'ghost'); iso = false; auto.clear(); for (const d of D) P.setState(d.id, on ? 'ghost' : 'solid'); card(); };
  const leg = $('#legend');
  leg.innerHTML = '<b>Stoffströme</b>' + (P.flowKinds || []).map(k => `<button data-k="${k}" style="color:${P.FLOWS[k][1]}"><i></i><span style="color:var(--tx)">${P.FLOWS[k][0]}</span></button>`).join('');
  leg.addEventListener('click', e => { const b = e.target.closest('button'); if (b) b.classList.toggle('off', !P.toggleFlowKind(b.dataset.k)); });
  $('#bflow').onclick = e => { const on = e.currentTarget.classList.toggle('on'); P.setFlows(on); leg.hidden = !on; };
  $('#blbl').onclick = e => { const on = e.currentTarget.classList.toggle('on'); lc.hidden = !on; P.invalidate(); };
  const sr = $('#sectr'), so = $('#secto'), sp = $('#sect');
  const sect = () => { const c = +sr.value, on = c > +sr.min; P.setSection(on ? c : null); so.textContent = on ? `bei ${c.toFixed(1).replace('.', ',')} m` : 'aus'; $('#bsect').classList.toggle('on', on || !sp.hidden); };
  sr.addEventListener('input', sect); $('#bsect').onclick = () => { sp.hidden = !sp.hidden; sect(); };
  $('#borbit').onclick = e => { P.orbit = e.currentTarget.classList.toggle('on'); P.invalidate(); };
  $('#breset').onclick = () => {
    iso = false; auto.clear(); for (const d of D) P.setState(d.id, 'solid'); sr.value = sr.min; sp.hidden = true; sect(); select(null); P.view(...VIEWS.luft);
    if ($('#bflow').classList.contains('on')) $('#bflow').click();
  };

  // ---------- Start ----------
  shift(); $('#blbl').click(); $('#load').classList.add('done'); P.view(...VIEWS.luft, 3.2); setTimeout(() => $('#hint').classList.add('off'), 9000);
});
