import { lockable, loopLength, pointOnBelt, sections, wheels } from '../drive';
import type { LockableWheelId, TimingWheelId, VwBeltLayStationId } from '../types';

const SHORT_CODES: Record<TimingWheelId, string> = {
  crank: 'KW',
  lower: 'U-R',
  tensioner: 'SP-B',
  cam: 'NW',
  upper: 'O-R',
  pump: 'HDP',
  water: 'WP',
};

/** Official VW Rep.-Gr. 15 S. 118 primary laying order badges (passive idlers marked with '•'). */
const VW_ORDER_BADGE: Record<TimingWheelId, string> = {
  crank: '1',
  lower: '•',
  tensioner: '2',
  cam: '3',
  upper: '•',
  pump: '4',
  water: '5',
};

const LABEL_OFFSETS: Record<TimingWheelId, { dx: number; dy: number; anchor: 'start' | 'middle' | 'end' }> = {
  crank: { dx: 0, dy: 25, anchor: 'middle' },
  lower: { dx: -20, dy: 12, anchor: 'end' },
  tensioner: { dx: -22, dy: 4, anchor: 'end' },
  cam: { dx: -34, dy: -22, anchor: 'end' },
  upper: { dx: 0, dy: -14, anchor: 'middle' },
  pump: { dx: 22, dy: -16, anchor: 'start' },
  water: { dx: 22, dy: 15, anchor: 'start' },
};

/**
 * Generates an inline VW Digital Cockpit SVG schematic of the EA288 1.6 TDI
 * camshaft timing-belt drive computed directly from `drive.ts` pitch-line geometry,
 * numbered in the official VW Rep.-Gr. 15 S. 118 laying sequence (1. KW → 2. SP → 3. NW → 4. HDP → 5. WP).
 */
export function renderBeltDiagramSVG(
  highlightedNode: TimingWheelId | null = null,
  completedStations: readonly VwBeltLayStationId[] = [],
  lockedShafts: readonly LockableWheelId[] = []
): string {
  const completedSet = new Set<TimingWheelId>(completedStations);
  // Passive idlers automatically show done once the primary station right after them is placed
  if (completedSet.has('tensioner')) completedSet.add('lower');
  if (completedSet.has('pump')) completedSet.add('upper');
  const lockedSet = new Set<LockableWheelId>(lockedShafts);

  const scale = 48;
  const cx0 = 166;
  const cy0 = 140;
  const sx = (x: number) => cx0 + x * scale;
  const sy = (y: number) => cy0 - y * scale;

  const beltPoints: string[] = [];
  const totalSamples = 200;
  for (let i = 0; i <= totalSamples; i++) {
    const p = pointOnBelt((loopLength * i) / totalSamples);
    beltPoints.push(`${sx(p.x + p.nx * 0.02).toFixed(1)},${sy(p.y + p.ny * 0.02).toFixed(1)}`);
  }

  const backArcPaths: string[] = [];
  for (const sec of sections) {
    if (sec.wheel.teeth > 0) continue;
    const pts: string[] = [];
    const arcSteps = 18;
    for (let k = 0; k <= arcSteps; k++) {
      const p = pointOnBelt(sec.start + (sec.arc * k) / arcSteps);
      pts.push(
        `${k === 0 ? 'M' : 'L'} ${sx(p.x + p.nx * 0.02).toFixed(1)} ${sy(p.y + p.ny * 0.02).toFixed(1)}`
      );
    }
    backArcPaths.push(pts.join(' '));
  }

  const wheelMarkup = wheels
    .map((w) => {
      const id = w.id as TimingWheelId;
      const cx = sx(w.x);
      const cy = sy(w.y);
      const r = Math.max(9.5, w.r * scale);
      const isCompleted = completedSet.has(id);
      const isHighlighted = highlightedNode === id;
      const isToothed = w.teeth > 0;
      const isTensioner = id === 'tensioner';
      const isLocked = lockable.includes(id) && lockedSet.has(id as LockableWheelId);
      const badgeLabel = VW_ORDER_BADGE[id];

      const rimStroke = isCompleted
        ? '#10b981'
        : isHighlighted
          ? '#00d4ff'
          : isTensioner
            ? '#f59e0b'
            : isToothed
              ? '#38bdf8'
              : '#64748b';

      const fillColor = isCompleted
        ? 'rgba(16, 185, 129, 0.20)'
        : isHighlighted
          ? 'rgba(0, 212, 255, 0.16)'
          : 'rgba(15, 23, 42, 0.92)';

      const pulseRing = isHighlighted
        ? `<circle class="belt-svg-pulse-ring" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r + 6).toFixed(1)}" fill="none" stroke="#00d4ff" stroke-width="2" stroke-dasharray="4 3" />`
        : '';

      const completedRing = isCompleted
        ? `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r + 3.5).toFixed(1)}" fill="none" stroke="#10b981" stroke-width="1.5" opacity="0.85" />`
        : '';

      const innerDetail = isToothed
        ? `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${Math.max(4, r - 4).toFixed(1)}" fill="none" stroke="rgba(148, 163, 184, 0.4)" stroke-width="1" stroke-dasharray="2.2 2" />`
        : `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${Math.max(3, r - 3.5).toFixed(1)}" fill="none" stroke="rgba(245, 158, 11, 0.35)" stroke-width="1" />`;

      const otTri = lockable.includes(id)
        ? `<polygon points="${cx.toFixed(1)},${(cy - r - 1.5).toFixed(1)} ${(cx - 3.6).toFixed(1)},${(cy - r - 7.5).toFixed(1)} ${(cx + 3.6).toFixed(1)},${(cy - r - 7.5).toFixed(1)}" fill="${isLocked ? '#10b981' : '#f59e0b'}" />`
        : '';

      const lockDot = isLocked
        ? `<circle cx="${(cx + r * 0.42).toFixed(1)}" cy="${(cy - r * 0.25).toFixed(1)}" r="3.2" fill="#ef4444" stroke="#f8fafc" stroke-width="1" />`
        : '';

      const badgeX = cx + r * 0.82;
      const badgeY = cy - r * 0.72;
      const badgeFill = isCompleted
        ? '#10b981'
        : isHighlighted
          ? '#00d4ff'
          : badgeLabel === '•'
            ? '#334155'
            : '#1e293b';
      const badgeTextFill = isCompleted || isHighlighted ? '#042f2e' : '#cbd5e1';

      const off = LABEL_OFFSETS[id];
      const lx = cx + off.dx;
      const ly = cy + off.dy;

      return `
        <g>
          ${pulseRing}
          ${completedRing}
          ${otTri}
          <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${fillColor}" stroke="${rimStroke}" stroke-width="${isCompleted || isHighlighted ? 2.2 : 1.7}" />
          ${innerDetail}
          ${lockDot}
          <text x="${cx.toFixed(1)}" y="${(cy + 0.5).toFixed(1)}" text-anchor="middle" dominant-baseline="middle"
            fill="#f8fafc" font-size="${r > 18 ? 9 : 6.8}" font-weight="800" font-family="Inter, sans-serif">${SHORT_CODES[id]}</text>
          <circle cx="${badgeX.toFixed(1)}" cy="${badgeY.toFixed(1)}" r="6.2" fill="${badgeFill}" stroke="#090d16" stroke-width="1.2" />
          <text x="${badgeX.toFixed(1)}" y="${(badgeY + 0.5).toFixed(1)}" text-anchor="middle" dominant-baseline="middle"
            fill="${badgeTextFill}" font-size="7.5" font-weight="800" font-family="Inter, sans-serif">${isCompleted ? '✓' : badgeLabel}</text>
          <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${off.anchor}"
            fill="${isCompleted ? '#6ee7b7' : isHighlighted ? '#7dd3fc' : '#cbd5e1'}"
            font-size="8.2" font-weight="700" font-family="Inter, sans-serif">${w.name}</text>
        </g>
      `;
    })
    .join('');

  return `
    <svg viewBox="0 0 340 262" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="VW Golf 7 1.6 TDI EA288 Zahnriemen-Steuertrieb (VW-Folge 1 bis 5)">
      <rect x="2" y="2" width="336" height="258" rx="10" fill="rgba(9, 13, 22, 0.72)" stroke="rgba(148, 163, 184, 0.14)" />
      <text x="14" y="18" fill="#7dd3fc" font-size="8.9" font-weight="800" letter-spacing="0.05em" font-family="Inter, sans-serif">
        EA288 CLHA • VW-FOLGE: 1 KW → 2 SP → 3 NW → 4 HDP → 5 WP
      </text>

      <polyline points="${beltPoints.join(' ')}" fill="none" stroke="#e2e8f0" stroke-width="4.2" stroke-linejoin="round" opacity="0.2" />
      <polyline points="${beltPoints.join(' ')}" fill="none" stroke="#38bdf8" stroke-width="2.4" stroke-linejoin="round" />

      ${backArcPaths
        .map(
          (d) =>
            `<path d="${d}" fill="none" stroke="#f59e0b" stroke-width="2.8" stroke-dasharray="3.5 2.5" stroke-linecap="round" />`
        )
        .join('')}

      ${wheelMarkup}

      <g transform="translate(12, 248)">
        <line x1="0" y1="0" x2="14" y2="0" stroke="#38bdf8" stroke-width="2.4" stroke-linecap="round" />
        <text x="18" y="3" fill="#cbd5e1" font-size="7.9" font-weight="600" font-family="Inter, sans-serif">Verzahnt (KW/NW/HDP)</text>

        <line x1="128" y1="0" x2="142" y2="0" stroke="#f59e0b" stroke-width="2.4" stroke-dasharray="3.5 2.5" stroke-linecap="round" />
        <text x="146" y="3" fill="#fde68a" font-size="7.9" font-weight="600" font-family="Inter, sans-serif">Rücken (Rollen/WP)</text>

        <circle cx="256" cy="0" r="3.2" fill="#10b981" />
        <text x="263" y="3" fill="#6ee7b7" font-size="7.9" font-weight="600" font-family="Inter, sans-serif">1–5: VW-Folge</text>
      </g>
    </svg>
  `;
}
