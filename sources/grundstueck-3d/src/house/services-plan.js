import { systems } from './services.js';

const esc = (s) => String(s)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const ORDER = { supply: 0, junction: 1, outlet: 2, riser: 3 };

function project2D(points) {
  const out = [];
  for (const [u, v] of points) {
    const prev = out.at(-1);
    if (!prev || prev[0] !== u || prev[1] !== v) out.push([u, v]);
  }
  return out;
}

export function servicePlanMarkup(design, floor, active) {
  const routes = design.routes
    .filter((r) => active[r.system] && (r.level === floor || (floor === 'eg' && r.level === 'site')))
    .sort((a, b) => (ORDER[a.mark] ?? 1) - (ORDER[b.mark] ?? 1));
  const stations = design.stations.filter((st) => floor === st.level && active[st.system]);
  if (!routes.length && !stations.length) return '';

  const paths = [];
  for (const r of routes) {
    const sys = systems[r.system];
    const projected = project2D(r.points);
    const [u, v] = projected.at(-1);
    let strokes = '';
    if (projected.length >= 2) {
      const d = 'M' + projected.map((p) => p.join(',')).join('L');
      strokes =
        '<path d="' + d + '" stroke="white" stroke-width=".095"/>' +
        '<path d="' + d + '" stroke="' + sys.ink + '" stroke-width=".054" stroke-dasharray="' + sys.dash + '"/>';
    }
    let marker = '';
    if (r.mark === 'outlet') {
      marker = '<circle cx="' + u + '" cy="' + v + '" r=".065" fill="white" stroke="' + sys.ink + '" stroke-width=".035"/>';
    } else if (r.mark === 'riser') {
      marker =
        '<circle cx="' + u + '" cy="' + v + '" r=".105" fill="white" stroke="' + sys.ink + '" stroke-width=".038"/>' +
        '<circle cx="' + u + '" cy="' + v + '" r=".04" fill="' + sys.ink + '"/>';
    }
    if (r.level === 'site') {
      const [x, y] = projected[0];
      marker += '<path d="M' + x + ',' + (y - .105) + 'l.105,.105l-.105,.105l-.105,-.105Z" fill="white" stroke="' + sys.ink + '" stroke-width=".04"/>';
    }
    paths.push(
      '<g data-service="' + r.system + '" data-route="' + esc(r.id) + '">' +
      '<title>' + esc(sys.title + ' · ' + r.label) + '</title>' +
      strokes + marker + '</g>'
    );
  }
  for (const st of stations) {
    const [x, y] = st.point;
    const col = systems[st.system].ink;
    paths.push(
      '<g data-station="' + esc(st.id) + '" data-service="' + st.system + '">' +
      '<title>' + esc(st.label) + '</title>' +
      '<rect x="' + (x - .13) + '" y="' + (y - .13) + '" width=".26" height=".26" rx=".04" fill="' + col + '" stroke="white" stroke-width=".025"/>' +
      '<text x="' + x + '" y="' + (y + .062) + '" text-anchor="middle" font-size=".17" font-weight="bold" fill="white">' + esc(st.id) + '</text>' +
      '</g>'
    );
  }
  return '<g data-layer="services" fill="none" stroke-linejoin="round" stroke-linecap="round">' + paths.join('') + '</g>';
}
