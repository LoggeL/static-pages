import type { BeltPulleyNode } from '../types';

interface PulleyNodeMeta {
  id: BeltPulleyNode;
  code: string;
  name: string;
  order: string;
  cx: number;
  cy: number;
  r: number;
  labelX: number;
  labelY: number;
  anchor: 'start' | 'middle' | 'end';
}

const PULLEYS: PulleyNodeMeta[] = [
  {
    id: 'crank',
    code: 'KW',
    name: 'Kurbelwelle',
    order: '1',
    cx: 72,
    cy: 168,
    r: 26,
    labelX: 34,
    labelY: 211,
    anchor: 'start',
  },
  {
    id: 'ac',
    code: 'KLIMA',
    name: 'Klimakompressor',
    order: '2',
    cx: 236,
    cy: 166,
    r: 21,
    labelX: 280,
    labelY: 211,
    anchor: 'end',
  },
  {
    id: 'alternator',
    code: 'GEN',
    name: 'Lichtmaschine',
    order: '3',
    cx: 228,
    cy: 52,
    r: 16,
    labelX: 228,
    labelY: 20,
    anchor: 'middle',
  },
  {
    id: 'tensioner',
    code: 'SPANN',
    name: 'Spannrolle (04L 903 315)',
    order: '4',
    cx: 132,
    cy: 128,
    r: 15,
    labelX: 14,
    labelY: 74,
    anchor: 'start',
  },
];

/**
 * Generates an inline SVG schematic of the VW Golf 7 1.6 TDI (EA288)
 * 6PK1025 serpentine belt routing viewed from the right wheel well (+X).
 */
export function renderBeltDiagramSVG(
  highlightedNode: BeltPulleyNode | null = null,
  completedNodes: BeltPulleyNode[] = [],
): string {
  const completedSet = new Set<BeltPulleyNode>(completedNodes);

  // Ribbed contact path (solid cyan/white):
  // Leaves smooth tensioner exit (131.7, 143.0) -> KW top (72.4, 142.0) -> wraps left/bottom KW
  // -> bottom KLIMA (236.9, 187.0) -> wraps right KLIMA -> right GEN (243.9, 50.2)
  // -> wraps top GEN -> leaves GEN top-left (215.2, 42.4) -> enters tensioner (144.0, 137.0).
  const ribbedBeltPath = [
    'M 131.7 143.0',
    'L 72.4 142.0',
    'A 26 26 0 1 0 73.1 194.0',
    'L 236.9 187.0',
    'A 21 21 0 0 0 256.9 163.6',
    'L 243.9 50.2',
    'A 16 16 0 0 0 215.2 42.4',
    'L 144.0 137.0',
  ].join(' ');

  // Smooth back contact over tensioner pulley 04L 903 315 (dashed amber indicator)
  const tensionerBackArc = 'M 144.0 137.0 A 15 15 0 0 1 131.7 143.0';
  const tensionerBackHalo = 'M 152.0 127.0 L 144.0 137.0 A 15 15 0 0 1 131.7 143.0 L 118.5 142.8';

  const pulleyMarkup = PULLEYS.map((p) => {
    const isCompleted = completedSet.has(p.id);
    const isHighlighted = highlightedNode === p.id;
    const isTensioner = p.id === 'tensioner';

    const rimStroke = isCompleted
      ? '#10b981'
      : isHighlighted
        ? '#00d4ff'
        : isTensioner
          ? '#f59e0b'
          : '#64748b';

    const fillColor = isCompleted
      ? 'rgba(16, 185, 129, 0.20)'
      : isHighlighted
        ? 'rgba(0, 212, 255, 0.16)'
        : 'rgba(15, 23, 42, 0.92)';

    const pulseRing = isHighlighted
      ? `<circle class="belt-svg-pulse-ring" cx="${p.cx}" cy="${p.cy}" r="${p.r + 7}" fill="none" stroke="#00d4ff" stroke-width="2.2" stroke-dasharray="4 3" />`
      : '';

    const completedRing = isCompleted
      ? `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r + 4}" fill="none" stroke="#10b981" stroke-width="1.6" opacity="0.85" />`
      : '';

    const innerGroove = isTensioner
      ? `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r - 4}" fill="none" stroke="rgba(245, 158, 11, 0.4)" stroke-width="1" />`
      : `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r - 4}" fill="none" stroke="rgba(148, 163, 184, 0.35)" stroke-width="1" stroke-dasharray="2 2" />`;

    const orderBadgeX = p.cx + p.r - 2;
    const orderBadgeY = p.cy - p.r + 2;
    const badgeFill = isCompleted ? '#10b981' : isHighlighted ? '#00d4ff' : '#1e293b';
    const badgeTextFill = isCompleted || isHighlighted ? '#042f2e' : '#cbd5e1';

    return `
      <g>
        ${pulseRing}
        ${completedRing}
        <circle cx="${p.cx}" cy="${p.cy}" r="${p.r}" fill="${fillColor}" stroke="${rimStroke}" stroke-width="${isCompleted || isHighlighted ? 2.4 : 1.8}" />
        ${innerGroove}
        <circle cx="${p.cx}" cy="${p.cy}" r="3" fill="${rimStroke}" />
        <text x="${p.cx}" y="${p.cy + 1}" text-anchor="middle" dominant-baseline="middle"
          fill="#f8fafc" font-size="${p.r > 20 ? 9.5 : 8}" font-weight="800" font-family="Inter, sans-serif">${p.code}</text>
        <circle cx="${orderBadgeX}" cy="${orderBadgeY}" r="7.2" fill="${badgeFill}" stroke="#090d16" stroke-width="1.4" />
        <text x="${orderBadgeX}" y="${orderBadgeY + 0.5}" text-anchor="middle" dominant-baseline="middle"
          fill="${badgeTextFill}" font-size="8" font-weight="800" font-family="Inter, sans-serif">${isCompleted ? '✓' : p.order}</text>
        <text x="${p.labelX}" y="${p.labelY}" text-anchor="${p.anchor}"
          fill="${isCompleted ? '#6ee7b7' : isHighlighted ? '#7dd3fc' : '#cbd5e1'}"
          font-size="9.5" font-weight="700" font-family="Inter, sans-serif">${p.name}</text>
      </g>
    `;
  }).join('');

  return `
    <svg viewBox="0 0 340 246" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="VW Golf 7 1.6 TDI EA288 Riemenverlauf 6PK1025">
      <defs>
        <marker id="beltArrowCw" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M 1 1 L 9 5 L 1 9 z" fill="#f59e0b" />
        </marker>
        <marker id="beltFlowArrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto">
          <path d="M 1 1.5 L 8.5 5 L 1 8.5 z" fill="#38bdf8" />
        </marker>
      </defs>

      <!-- Background technical grid -->
      <rect x="2" y="2" width="336" height="242" rx="10" fill="rgba(9, 13, 22, 0.72)" stroke="rgba(148, 163, 184, 0.14)" />
      <text x="14" y="18" fill="#7dd3fc" font-size="9.5" font-weight="800" letter-spacing="0.06em" font-family="Inter, sans-serif">
        EA288 1.6 TDI • 6PK1025 (+X RADHAUS)
      </text>

      <g transform="translate(18, 6)">
        <!-- Tensioner bracket arm & pivot housing behind belt -->
        <path d="M 156 96 L 132 128" stroke="rgba(245, 158, 11, 0.45)" stroke-width="8" stroke-linecap="round" />
        <circle cx="156" cy="96" r="10.5" fill="rgba(30, 41, 59, 0.95)" stroke="rgba(245, 158, 11, 0.75)" stroke-width="1.6" />

        <!-- Clockwise release arrow (SW 16) around tensioner pivot -->
        <path d="M 145 81 A 19 19 0 0 1 174 96" fill="none" stroke="#f59e0b" stroke-width="1.8" stroke-linecap="round" marker-end="url(#beltArrowCw)" />
        <text x="157" y="75" text-anchor="middle" fill="#fcd34d" font-size="8.5" font-weight="800" font-family="Inter, sans-serif">SW 16 ↻</text>

        <!-- T10060A 4mm lock pin dot -->
        <circle cx="152" cy="100" r="3.4" fill="#fbbf24" stroke="#090d16" stroke-width="1.1" />
        <line x1="155" y1="100" x2="180" y2="100" stroke="rgba(251, 191, 36, 0.55)" stroke-width="1" stroke-dasharray="2 2" />
        <text x="183" y="103" fill="#fde68a" font-size="8.5" font-weight="700" font-family="ui-monospace, monospace">T10060A (4 mm)</text>

        <!-- Leader line from tensioner label to pulley -->
        <line x1="88" y1="79" x2="120" y2="116" stroke="rgba(245, 158, 11, 0.4)" stroke-width="1" />

        <!-- Ribbed belt contact (solid cyan/white line) -->
        <path d="${ribbedBeltPath}" fill="none" stroke="#e2e8f0" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round" opacity="0.22" />
        <path d="${ribbedBeltPath}" fill="none" stroke="#38bdf8" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />

        <!-- Smooth back contact over tensioner (dashed amber indicator) -->
        <path d="${tensionerBackHalo}" fill="none" stroke="rgba(245, 158, 11, 0.3)" stroke-width="5.2" stroke-linecap="round" />
        <path d="${tensionerBackArc}" fill="none" stroke="#f59e0b" stroke-width="2.8" stroke-dasharray="4 2.5" stroke-linecap="round" />

        <!-- Subtle directional arrows along spans -->
        <line x1="142" y1="191" x2="164" y2="190" stroke="#38bdf8" stroke-width="1.6" marker-end="url(#beltFlowArrow)" />
        <line x1="252" y1="114" x2="250" y2="95" stroke="#38bdf8" stroke-width="1.6" marker-end="url(#beltFlowArrow)" />
        <line x1="186" y1="77" x2="173" y2="95" stroke="#38bdf8" stroke-width="1.6" marker-end="url(#beltFlowArrow)" />

        ${pulleyMarkup}
      </g>

      <!-- Legend footer -->
      <g transform="translate(14, 232)">
        <line x1="0" y1="0" x2="18" y2="0" stroke="#38bdf8" stroke-width="2.6" stroke-linecap="round" />
        <text x="23" y="3" fill="#cbd5e1" font-size="8.5" font-weight="600" font-family="Inter, sans-serif">Rippen (KW/KLIMA/GEN)</text>

        <line x1="142" y1="0" x2="160" y2="0" stroke="#f59e0b" stroke-width="2.6" stroke-dasharray="4 2.5" stroke-linecap="round" />
        <text x="165" y="3" fill="#fde68a" font-size="8.5" font-weight="600" font-family="Inter, sans-serif">Rücken (Spannrolle)</text>

        <circle cx="272" cy="0" r="3.5" fill="#10b981" />
        <text x="279" y="3" fill="#6ee7b7" font-size="8.5" font-weight="600" font-family="Inter, sans-serif">Fertig</text>
      </g>
    </svg>
  `;
}
