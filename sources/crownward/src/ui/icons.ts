// Crownward – kleine Pixel-Icons für HUD und Touch-Steuerung, als SVG aus Zeichenrastern erzeugt.
// Jede Zeile = eine Pixelreihe, jedes Zeichen = Farbe aus der Palette ('.' = transparent).

const PALETTE: Record<string, string> = {
  o: '#4a2c0e', // Umriss dunkelbraun
  y: '#e9b949', // Gold
  l: '#ffe28a', // Gold hell
  d: '#b07a22', // Gold dunkel
  r: '#c8463a', // Rubin
  b: '#7a4c24', // Beutel
  B: '#a8703c', // Beutel hell
  s: '#ffd36b', // Sonne
  S: '#f29b4b', // Abendsonne
  p: '#f2a7a0', // Morgenrot
  m: '#e4e7f7', // Mond
  M: '#9aa3c8', // Mondschatten / Horizont
  g: '#c9cfe6', // Anker
  w: '#f6ecd4', // Pergamentweiß (Touch-Symbole)
};

const ICONS = {
  coin: ['..oooo..', '.ollyyo.', 'olyyyyyo', 'olyyyydo', 'oyyyyydo', 'oyyyyddo', '.oydddo.', '..oooo..'],
  crown: ['l...l...l', 'yl.lyl.ly', 'yyyyyyyyy', 'yryylyyry', 'yyyyyyyyy', 'ddddddddd'],
  pouch: ['..o...o..', '...ooo...', '...obo...', '..obBbo..', '.obBBbbo.', 'obBByBbbo', 'obBBbbbbo', '.obbbbbo.', '..ooooo..'],
  sun: ['....s....', '.s.....s.', '...sss...', '..sssss..', 's.sssss.s', '..sssss..', '...sss...', '.s.....s.', '....s....'],
  dusk: ['....S....', '.S.....S.', '...SSS...', '..SSSSS..', '.SSSSSSS.', 'MMMMMMMMM'],
  dawn: ['....p....', '.p.....p.', '...ppp...', '..ppppp..', '.ppppppp.', 'MMMMMMMMM'],
  moon: ['..mmmm..', '.mmmM...', 'mmmM....', 'mmmM....', 'mmmM....', 'mmmM....', '.mmmmM..', '..mmmm..'],
  anchor: ['...ggg...', '...g.g...', '...ggg...', '.ggggggg.', '....g....', '....g....', 'g...g...g', '.g..g..g.', '..ggggg..'],
  left: ['...w...', '..ww...', '.wwwwww', 'wwwwwww', '.wwwwww', '..ww...', '...w...'],
  right: ['...w...', '...ww..', 'wwwwww.', 'wwwwwww', 'wwwwww.', '...ww..', '...w...'],
  sprint: ['ww..ww...', '.ww..ww..', '..ww..ww.', '...ww..ww', '..ww..ww.', '.ww..ww..', 'ww..ww...'],
  pause: ['ww...ww', 'ww...ww', 'ww...ww', 'ww...ww', 'ww...ww', 'ww...ww', 'ww...ww'],
} satisfies Record<string, string[]>;

export type IconName = keyof typeof ICONS;

const cache = new Map<string, string>();

/** SVG-Markup eines Pixel-Icons in ganzzahliger Vergrößerung (crispEdges hält die Pixel scharf). */
export function icon(name: IconName, scale = 2): string {
  const ck = `${name}@${scale}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const rows = ICONS[name];
  const w = rows[0].length;
  const h = rows.length;
  let rects = '';
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    let x = 0;
    while (x < w) {
      const ch = row[x];
      if (ch === '.' || ch === undefined) {
        x++;
        continue;
      }
      // waagrechte Läufe gleicher Farbe zusammenfassen
      let run = 1;
      while (x + run < w && row[x + run] === ch) run++;
      rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${PALETTE[ch] ?? '#f0f'}"/>`;
      x += run;
    }
  }
  const svg = `<svg class="px-icon icon-${name}" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${rects}</svg>`;
  cache.set(ck, svg);
  return svg;
}

/** Prüfhilfe (Entwicklung/Tests): alle Raster rechteckig? */
export function iconsValid(): boolean {
  return Object.values(ICONS).every((rows) => rows.every((r) => r.length === rows[0].length));
}
