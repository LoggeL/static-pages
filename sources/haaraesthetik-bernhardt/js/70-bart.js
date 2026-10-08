/* VII · 17:30 · Kontur – „Das Klingenlicht“ */
(() => {
  const L = window.LUMEN;
  const sec = document.getElementById('bart');
  if (!L || !sec) return;

  const card = sec.querySelector('.bt-card');
  const rows = [...sec.querySelectorAll('.bt-list li')];

  /* Einmaliger Lichtlauf über die Gravur, sobald die Karte erscheint */
  function sweep() {
    if (L.reduce) return;
    rows.forEach((li, i) => {
      setTimeout(() => li.classList.add('lit'), 700 + i * 170);
      setTimeout(() => li.classList.remove('lit'), 700 + i * 170 + 900);
    });
  }
  if (card) card.addEventListener('lumen:in', sweep, { once: true });

  /* Touch-Alternative zum Hover: Tippen lässt die Linie aufglühen */
  if (!L.fine) {
    rows.forEach(li => li.addEventListener('click', () => {
      rows.forEach(r => r !== li && r.classList.remove('lit'));
      li.classList.toggle('lit');
    }));
  }

  /* Messing-Karte: hauchfeine Neigung + wanderndes Glanzlicht mit der Maus */
  if (card && L.fine && !L.reduce) {
    const face = card.querySelector('.bt-card-face');
    let tx = 0, ty = 0, cx = 0, cy = 0, inside = false;
    card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width - 0.5;
      ty = (e.clientY - r.top) / r.height - 0.5;
      inside = true;
    });
    card.addEventListener('pointerleave', () => { tx = 0; ty = 0; inside = false; });
    face.style.transition = 'clip-path 1.6s var(--ease)';
    L.onFrame(() => {
      if (!inside && Math.abs(cx) < 0.001 && Math.abs(cy) < 0.001) return;
      cx = L.lerp(cx, tx, 0.08); cy = L.lerp(cy, ty, 0.08);
      card.style.setProperty('--mx', cx.toFixed(4));
      card.style.setProperty('--my', cy.toFixed(4));
    });
  }
})();
