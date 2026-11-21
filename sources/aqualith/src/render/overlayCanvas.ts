import {
  WORLD_W,
  WORLD_H,
  GRAVITY,
  type GameStateSnapshot,
  type MechanismSnapshot,
  type ToolForceInput,
  type TurbineState,
  type CisternState,
  type CrackedWallState,
  type RelicGoalState,
  type MagmaVentState,
  type PortalPairState,
  type HydroMineState,
  type ValveState,
  type HydroRelayState,
  type GeyserPumpState,
} from '../types.ts';
import { t } from '../i18n.ts';

const FONT_STACK = "'Inter', 'SF Pro Display', 'Segoe UI', system-ui, -apple-system, sans-serif";
const ICE_BRUSH_RADIUS_M = 0.24;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.lineTo(x, y + rad);
  ctx.arcTo(x, y, x + rad, y, rad);
  ctx.closePath();
}

/**
 * Diegetic 2D Canvas overlay renderer for AQUALITH.
 * Maps 16.0m x 9.0m bottom-left (+Y UP) world coordinates onto a crisp DPR-aware 2D canvas.
 */
export class OverlayRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private width = 1280;
  private height = 720;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (canvas.width > 0 && canvas.height > 0) {
      const clientW = canvas.clientWidth;
      if (clientW > 0 && canvas.width > clientW * 1.15) {
        this.dpr = canvas.width / clientW;
        this.width = clientW;
        this.height = canvas.height / this.dpr;
      } else {
        this.width = canvas.width;
        this.height = canvas.height;
      }
    }
  }

  /**
   * Resizes the overlay backing store cleanly while preventing double-DPR multiplication
   * regardless of whether the caller supplies CSS pixels or physical backing dimensions.
   */
  public resize(width: number, height: number, dpr?: number): void {
    const safeW = Math.max(1, width);
    const safeH = Math.max(1, height);

    if (typeof dpr === 'number' && Number.isFinite(dpr) && dpr > 0) {
      this.dpr = clamp(dpr, 1, 3);
      this.width = safeW;
      this.height = safeH;
      this.canvas.width = Math.max(1, Math.round(safeW * this.dpr));
      this.canvas.height = Math.max(1, Math.round(safeH * this.dpr));
      return;
    }

    const clientW = this.canvas.clientWidth;
    if (clientW > 0 && safeW > clientW * 1.25) {
      // Caller passed physical backing resolution directly
      this.dpr = clamp(safeW / clientW, 1, 3);
      this.width = safeW / this.dpr;
      this.height = safeH / this.dpr;
      this.canvas.width = Math.max(1, Math.round(safeW));
      this.canvas.height = Math.max(1, Math.round(safeH));
    } else {
      const devDpr =
        typeof globalThis.devicePixelRatio === 'number'
          ? clamp(globalThis.devicePixelRatio, 1, 2)
          : 1;
      this.dpr = devDpr;
      this.width = safeW;
      this.height = safeH;
      this.canvas.width = Math.max(1, Math.round(safeW * devDpr));
      this.canvas.height = Math.max(1, Math.round(safeH * devDpr));
    }
  }

  private cx(wx: number): number {
    return (wx / WORLD_W) * this.width;
  }

  private cy(wy: number): number {
    return (1 - wy / WORLD_H) * this.height;
  }

  private getScale(): number {
    return this.width / WORLD_W;
  }

  public render(
    state: GameStateSnapshot,
    mechanisms: MechanismSnapshot,
    toolInput: ToolForceInput,
    pointerWorld: { x: number; y: number; inside: boolean },
    time: number,
    showDragHint: boolean
  ): void {
    const ctx = this.ctx;
    if (!ctx || this.width <= 0 || this.height <= 0) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const scale = this.getScale();
    const uiScale = clamp(scale / 80, 0.72, 1.45);

    // 1. Diegetic mechanism indicators
    this.drawPortals(ctx, mechanisms.portals ?? [], scale, uiScale, time);
    this.drawPumps(ctx, mechanisms.pumps ?? [], scale, uiScale, time);
    this.drawRelicGoals(ctx, mechanisms.goals, scale, uiScale, time);
    this.drawMagmaVents(ctx, mechanisms.magmaVents, scale, time);
    this.drawCrackedWalls(ctx, mechanisms.crackedWalls, scale, uiScale, time);
    this.drawCisterns(ctx, mechanisms.cisterns, scale, uiScale);
    this.drawTurbines(ctx, mechanisms.turbines, scale, uiScale, time);
    this.drawMines(ctx, mechanisms.mines ?? [], scale, uiScale, time);
    this.drawRelays(ctx, mechanisms.relays ?? [], scale, uiScale, time);
    this.drawValves(ctx, state, mechanisms.valves ?? [], pointerWorld, scale, uiScale, time);

    // 2. Gentle Level 1 Drag Hint
    if (showDragHint && state.levelId === 'level-1') {
      this.drawLevel1DragHint(ctx, state, mechanisms, scale, uiScale, time);
    }

    // 3. Tool cursor visuals (only during active play inside canvas)
    if (state.screen === 'playing' && pointerWorld.inside) {
      this.drawToolCursor(ctx, state, toolInput, pointerWorld, scale, uiScale, time);
    }

    // 4. Slow-Mo frosted indigo vignette + badge
    if (state.slowMo) {
      this.drawSlowMoVignette(ctx, state, uiScale, time);
    }

    ctx.restore();
  }

  private drawTurbines(
    ctx: CanvasRenderingContext2D,
    turbines: TurbineState[],
    scale: number,
    uiScale: number,
    time: number
  ): void {
    for (const turb of turbines) {
      const x = this.cx(turb.x);
      const y = this.cy(turb.y);
      const r = turb.radius * scale;
      const ringR = r + Math.max(5 * uiScale, 0.08 * scale);
      const ratio =
        turb.targetCharge > 0
          ? clamp(turb.charge / turb.targetCharge, 0, 1)
          : turb.completed
            ? 1
            : 0;

      ctx.save();

      // Subtle outer track
      ctx.beginPath();
      ctx.arc(x, y, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
      ctx.lineWidth = 2.5 * uiScale;
      ctx.stroke();

      if (turb.completed) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 4.2);
        // Pulsing golden outer halo
        ctx.beginPath();
        ctx.arc(x, y, ringR + (4 + pulse * 4) * uiScale, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(251, 191, 36, ${0.18 + pulse * 0.2})`;
        ctx.lineWidth = 5 * uiScale;
        ctx.stroke();

        // Full golden charge ring
        ctx.beginPath();
        ctx.arc(x, y, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 3.2 * uiScale;
        ctx.shadowColor = 'rgba(251, 191, 36, 0.75)';
        ctx.shadowBlur = 10 * uiScale;
        ctx.stroke();
        ctx.shadowBlur = 0;

        this.drawCompactReadout(
          ctx,
          x,
          this.pickVerticalLabelY(y, ringR, 14 * uiScale),
          '100%',
          'rgba(254, 243, 199, 0.96)',
          'rgba(120, 53, 15, 0.72)',
          'rgba(251, 191, 36, 0.65)',
          10.5 * uiScale
        );
      } else if (ratio > 0.005) {
        const startAngle = -Math.PI * 0.5;
        const endAngle = startAngle + ratio * Math.PI * 2;

        // Soft glow layer
        ctx.beginPath();
        ctx.arc(x, y, ringR, startAngle, endAngle);
        ctx.strokeStyle = 'rgba(45, 212, 191, 0.32)';
        ctx.lineWidth = 6.5 * uiScale;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Crisp cyan-teal progress arc
        ctx.beginPath();
        ctx.arc(x, y, ringR, startAngle, endAngle);
        ctx.strokeStyle = 'rgba(94, 234, 212, 0.85)';
        ctx.lineWidth = 3 * uiScale;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Bright leading tip sparkle
        const tipX = x + Math.cos(endAngle) * ringR;
        const tipY = y + Math.sin(endAngle) * ringR;
        ctx.beginPath();
        ctx.arc(tipX, tipY, 3 * uiScale, 0, Math.PI * 2);
        ctx.fillStyle = '#ccfbf1';
        ctx.fill();

        if (ratio >= 0.03) {
          this.drawCompactReadout(
            ctx,
            x,
            this.pickVerticalLabelY(y, ringR, 14 * uiScale),
            `${Math.round(ratio * 100)}%`,
            'rgba(204, 251, 241, 0.95)',
            'rgba(15, 23, 42, 0.68)',
            'rgba(94, 234, 212, 0.52)',
            10.5 * uiScale
          );
        }
      }

      ctx.restore();
    }
  }

  private drawCisterns(
    ctx: CanvasRenderingContext2D,
    cisterns: CisternState[],
    scale: number,
    uiScale: number
  ): void {
    for (const c of cisterns) {
      const x0 = this.cx(c.x);
      const yTop = this.cy(c.y + c.h);
      const w = c.w * scale;
      const h = c.h * scale;
      const ratio = clamp(c.fillRatio, 0, 1);
      const accent = c.activated ? '#34d399' : '#38bdf8';
      const glow = c.activated ? 'rgba(52, 211, 153, 0.35)' : 'rgba(56, 189, 248, 0.28)';

      ctx.save();

      // Sleek corner brackets framing the cistern basin
      const bLen = Math.min(12 * uiScale, w * 0.28, h * 0.28);
      ctx.strokeStyle = c.activated ? 'rgba(52, 211, 153, 0.78)' : 'rgba(56, 189, 248, 0.48)';
      ctx.lineWidth = 1.8 * uiScale;
      ctx.lineCap = 'round';
      this.strokeCornerBrackets(ctx, x0, yTop, w, h, bLen);

      if (ratio > 0.01 || c.activated) {
        const barW = Math.max(6 * uiScale, 0.075 * scale);
        const barH = Math.max(24 * uiScale, h - 6 * uiScale);
        const margin = 8 * uiScale;

        // Place vertical fill bar cleanly on right or left side of the cistern
        const placeRight = x0 + w + margin + barW + 38 * uiScale < this.width;
        const barX = placeRight
          ? x0 + w + margin
          : x0 - margin - barW > 40 * uiScale
            ? x0 - margin - barW
            : x0 + w - barW - 4 * uiScale;
        const barY = yTop + (h - barH) * 0.5;

        // Dark track
        roundedRectPath(ctx, barX, barY, barW, barH, barW * 0.5);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = 1.2 * uiScale;
        ctx.stroke();

        // Rising fluid fill
        const fillH = Math.max(barW, barH * ratio);
        const fillY = barY + barH - fillH;
        roundedRectPath(ctx, barX + 1, fillY + 1, Math.max(1, barW - 2), Math.max(1, fillH - 2), barW * 0.45);
        ctx.fillStyle = accent;
        ctx.shadowColor = glow;
        ctx.shadowBlur = 8 * uiScale;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Percentage readout beside bar
        const pct = `${Math.round(ratio * 100)}%`;
        const labelX = placeRight ? barX + barW + 22 * uiScale : barX - 22 * uiScale;
        const labelY = clamp(barY + barH * (1 - ratio * 0.5), 16, this.height - 16);
        this.drawCompactReadout(
          ctx,
          clamp(labelX, 24, this.width - 24),
          labelY,
          pct,
          c.activated ? '#d1fae5' : '#e0f2fe',
          'rgba(15, 23, 42, 0.72)',
          c.activated ? 'rgba(52, 211, 153, 0.65)' : 'rgba(56, 189, 248, 0.55)',
          10 * uiScale
        );
      }

      ctx.restore();
    }
  }

  private drawCrackedWalls(
    ctx: CanvasRenderingContext2D,
    walls: CrackedWallState[],
    scale: number,
    uiScale: number,
    time: number
  ): void {
    for (const wall of walls) {
      if (wall.broken) continue;

      const hpRatio = wall.maxHp > 0 ? clamp(wall.hp / wall.maxHp, 0, 1) : 1;
      const damaged = hpRatio < 0.995;
      if (wall.stressGlow <= 0.08 && !damaged) continue;

      const x0 = this.cx(wall.x);
      const yTop = this.cy(wall.y + wall.h);
      const w = wall.w * scale;
      const h = wall.h * scale;
      const stress = clamp(wall.stressGlow, 0, 1);
      const pulse = 0.65 + 0.35 * Math.sin(time * 9.0);
      const flashAlpha = clamp(stress * 0.45 * pulse + (damaged ? 0.14 : 0), 0.08, 0.55);

      ctx.save();

      // Subtle amber stress fracture glow around & across wall
      ctx.fillStyle = `rgba(245, 158, 11, ${flashAlpha * 0.35})`;
      ctx.fillRect(x0, yTop, w, h);

      ctx.strokeStyle = `rgba(251, 191, 36, ${clamp(flashAlpha * 1.4, 0.35, 0.95)})`;
      ctx.lineWidth = 2 * uiScale;
      ctx.strokeRect(x0, yTop, w, h);

      // Fracture bar centered just above (or below if near top) the wall
      const barW = clamp(Math.max(w * 1.15, 42 * uiScale), 40 * uiScale, 84 * uiScale);
      const barH = 6 * uiScale;
      const barX = clamp(x0 + w * 0.5 - barW * 0.5, 10, this.width - barW - 10);
      const barY = yTop - 14 * uiScale > 12 ? yTop - 14 * uiScale : yTop + h + 8 * uiScale;

      roundedRectPath(ctx, barX, barY, barW, barH, barH * 0.5);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.fill();
      ctx.strokeStyle = `rgba(245, 158, 11, ${0.45 + stress * 0.4})`;
      ctx.lineWidth = 1.2 * uiScale;
      ctx.stroke();

      const fillW = Math.max(barH * 0.6, (barW - 2) * hpRatio);
      roundedRectPath(ctx, barX + 1, barY + 1, fillW, Math.max(1, barH - 2), barH * 0.4);
      ctx.fillStyle = hpRatio < 0.35 ? '#fb7185' : '#f59e0b';
      ctx.fill();

      ctx.restore();
    }
  }

  private drawRelicGoals(
    ctx: CanvasRenderingContext2D,
    goals: RelicGoalState[],
    scale: number,
    uiScale: number,
    time: number
  ): void {
    for (const goal of goals) {
      const x0 = this.cx(goal.x);
      const yTop = this.cy(goal.y + goal.h);
      const w = goal.w * scale;
      const h = goal.h * scale;
      const gx = x0 + w * 0.5;
      const gy = yTop + h * 0.5;

      ctx.save();

      if (goal.fulfilled) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 3.8 + goal.pulse);
        const rad = ctx.createRadialGradient(gx, gy, 2, gx, gy, Math.max(w, h) * 0.85);
        rad.addColorStop(0, `rgba(254, 240, 138, ${0.38 + pulse * 0.14})`);
        rad.addColorStop(0.55, `rgba(251, 191, 36, ${0.22 + pulse * 0.1})`);
        rad.addColorStop(1, 'rgba(251, 191, 36, 0)');
        ctx.fillStyle = rad;
        ctx.fillRect(x0 - w * 0.35, yTop - h * 0.35, w * 1.7, h * 1.7);

        ctx.strokeStyle = `rgba(251, 191, 36, ${0.75 + pulse * 0.25})`;
        ctx.lineWidth = 2.4 * uiScale;
        roundedRectPath(ctx, x0, yTop, w, h, 6 * uiScale);
        ctx.stroke();
      } else {
        // Subtle golden sanctuary dashed frame
        ctx.setLineDash([5 * uiScale, 4 * uiScale]);
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.42)';
        ctx.lineWidth = 1.6 * uiScale;
        roundedRectPath(ctx, x0, yTop, w, h, 5 * uiScale);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Floating animated golden sanctuary chevron / beacon arrow pointing gently into the goal zone
      const bob = Math.sin(time * 3.2 + goal.pulse) * 4.5 * uiScale;
      const beaconY = clamp(yTop - 16 * uiScale + bob, 22 * uiScale, this.height - 20 * uiScale);
      const chevW = 9 * uiScale;
      const chevH = 6 * uiScale;

      ctx.shadowColor = 'rgba(251, 191, 36, 0.8)';
      ctx.shadowBlur = goal.fulfilled ? 12 * uiScale : 7 * uiScale;

      // Upper delicate diamond finial
      ctx.beginPath();
      ctx.moveTo(gx, beaconY - 11 * uiScale);
      ctx.lineTo(gx + 3.5 * uiScale, beaconY - 7 * uiScale);
      ctx.lineTo(gx, beaconY - 3 * uiScale);
      ctx.lineTo(gx - 3.5 * uiScale, beaconY - 7 * uiScale);
      ctx.closePath();
      ctx.fillStyle = goal.fulfilled ? '#fef08a' : '#fbbf24';
      ctx.fill();

      // Nested double golden chevron pointing downward into sanctuary
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < 2; i++) {
        const oy = beaconY + i * 5.5 * uiScale;
        ctx.beginPath();
        ctx.moveTo(gx - chevW, oy - chevH * 0.5);
        ctx.lineTo(gx, oy + chevH * 0.5);
        ctx.lineTo(gx + chevW, oy - chevH * 0.5);
        ctx.strokeStyle = i === 0 ? 'rgba(253, 224, 71, 0.72)' : '#fbbf24';
        ctx.lineWidth = (i === 0 ? 1.8 : 2.5) * uiScale;
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  private drawMagmaVents(
    ctx: CanvasRenderingContext2D,
    vents: MagmaVentState[],
    scale: number,
    time: number
  ): void {
    for (const vent of vents) {
      if (vent.quenched) continue;

      const x0 = this.cx(vent.x);
      const yTop = this.cy(vent.y + vent.h);
      const w = vent.w * scale;
      const heatRatio = vent.maxHeat > 0 ? clamp(vent.heat / vent.maxHeat, 0.15, 1) : 1;
      const pulse = 0.5 + 0.5 * Math.sin(time * 5.2 + vent.steamPulse);

      ctx.save();

      // Subtle rising heat shimmer gradient above active vent
      const shimmerH = Math.max(22, 0.55 * scale) * (0.75 + heatRatio * 0.45);
      const grad = ctx.createLinearGradient(0, yTop, 0, yTop - shimmerH);
      grad.addColorStop(0, `rgba(249, 115, 22, ${0.24 * heatRatio + pulse * 0.08})`);
      grad.addColorStop(0.55, `rgba(245, 158, 11, ${0.11 * heatRatio})`);
      grad.addColorStop(1, 'rgba(245, 158, 11, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x0 - w * 0.08, yTop - shimmerH, w * 1.16, shimmerH);

      // Animated rising thermal shimmer waves
      const waveCount = 2;
      for (let i = 0; i < waveCount; i++) {
        const phase = (time * 1.1 + i * 0.5 + vent.steamPulse * 0.1) % 1;
        const wy = yTop - 4 - phase * shimmerH * 0.85;
        const alpha = Math.sin(phase * Math.PI) * 0.45 * heatRatio;
        ctx.beginPath();
        const segs = 12;
        for (let s = 0; s <= segs; s++) {
          const u = s / segs;
          const px = x0 + u * w;
          const py = wy + Math.sin(u * Math.PI * 3 + time * 7 + i * 2) * 2.2;
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = `rgba(251, 146, 60, ${alpha})`;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  private drawRelays(
    ctx: CanvasRenderingContext2D,
    relays: HydroRelayState[],
    scale: number,
    uiScale: number,
    time: number
  ): void {
    for (let rIdx = 0; rIdx < relays.length; rIdx++) {
      const relay = relays[rIdx];
      const charge = clamp(relay.charge, 0, 1);
      const r = Math.max(9 * uiScale, relay.radius * scale);
      const pulse = 0.5 + 0.5 * Math.sin(time * 6.5 + rIdx * 1.7);

      ctx.save();

      // Draw glowing electric charge rings at both copper electrodes (ax, ay) and (bx, by)
      const endpoints: Array<[number, number]> = [
        [this.cx(relay.ax), this.cy(relay.ay)],
        [this.cx(relay.bx), this.cy(relay.by)],
      ];

      for (const [ex, ey] of endpoints) {
        // Subtle outer track ring
        ctx.beginPath();
        ctx.arc(ex, ey, r + 4 * uiScale, 0, Math.PI * 2);
        ctx.strokeStyle = relay.active
          ? `rgba(103, 232, 249, ${0.42 + pulse * 0.28})`
          : 'rgba(56, 189, 248, 0.25)';
        ctx.lineWidth = (relay.active ? 2.4 : 1.5) * uiScale;
        ctx.stroke();

        if (relay.active) {
          // Animated outer electric pulse halo
          ctx.beginPath();
          ctx.arc(ex, ey, r + (7 + pulse * 4) * uiScale, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(34, 211, 238, ${0.2 + pulse * 0.22})`;
          ctx.lineWidth = 3 * uiScale;
          ctx.stroke();
        }

        if (charge > 0.02 || relay.active) {
          const arcSpan = relay.active ? Math.PI * 2 : charge * Math.PI * 2;
          const rotOffset = relay.active ? time * 3.5 : -Math.PI * 0.5;
          ctx.beginPath();
          ctx.arc(ex, ey, r + 4 * uiScale, rotOffset, rotOffset + arcSpan);
          ctx.strokeStyle = relay.active ? '#a5f3fc' : '#38bdf8';
          ctx.lineWidth = 2.6 * uiScale;
          ctx.lineCap = 'round';
          ctx.shadowColor = 'rgba(34, 211, 238, 0.85)';
          ctx.shadowBlur = (relay.active ? 10 : 6) * uiScale;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }

      // Draw crackling electric lightning arcs along bridgePath when >= 2 waypoints exist
      if (relay.bridgePath && relay.bridgePath.length >= 2) {
        const pts: Array<{ x: number; y: number }> = [];
        const path = relay.bridgePath;
        const tick = Math.floor(time * 26);

        for (let i = 0; i < path.length - 1; i++) {
          const x0 = this.cx(path[i][0]);
          const y0 = this.cy(path[i][1]);
          const x1 = this.cx(path[i + 1][0]);
          const y1 = this.cy(path[i + 1][1]);
          const dx = x1 - x0;
          const dy = y1 - y0;
          const segLen = Math.hypot(dx, dy);
          if (segLen < 0.5) continue;

          const subSteps = Math.max(2, Math.min(6, Math.ceil(segLen / (18 * uiScale))));
          const nx = -dy / segLen;
          const ny = dx / segLen;

          if (pts.length === 0) {
            pts.push({ x: x0, y: y0 });
          }

          for (let s = 1; s <= subSteps; s++) {
            const u = s / subSteps;
            const bx = x0 + dx * u;
            const by = y0 + dy * u;
            const isEnd = i === path.length - 2 && s === subSteps;
            if (isEnd) {
              pts.push({ x: bx, y: by });
            } else {
              const seed = (i * 31 + s * 17 + rIdx * 53 + tick * 97) & 0xffff;
              const hash = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
              const rand = hash - Math.floor(hash) - 0.5;
              const amp = (4.5 + 7.5 * Math.max(0.35, charge)) * uiScale;
              pts.push({
                x: bx + nx * rand * amp,
                y: by + ny * rand * amp,
              });
            }
          }
        }

        if (pts.length >= 2) {
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';

          // Pass 1: Outer cyan glow
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let k = 1; k < pts.length; k++) {
            ctx.lineTo(pts[k].x, pts[k].y);
          }
          ctx.strokeStyle = `rgba(34, 211, 238, ${0.42 + pulse * 0.2})`;
          ctx.lineWidth = 6.5 * uiScale;
          ctx.shadowColor = 'rgba(56, 189, 248, 0.9)';
          ctx.shadowBlur = 12 * uiScale;
          ctx.stroke();
          ctx.shadowBlur = 0;

          // Pass 2: Electric cyan body
          ctx.strokeStyle = 'rgba(103, 232, 249, 0.92)';
          ctx.lineWidth = 2.6 * uiScale;
          ctx.stroke();

          // Pass 3: Crisp white-hot core
          ctx.strokeStyle = '#f8fafc';
          ctx.lineWidth = 1.25 * uiScale;
          ctx.stroke();
        }
      }

      ctx.restore();
    }
  }

  private drawValves(
    ctx: CanvasRenderingContext2D,
    state: GameStateSnapshot,
    valves: ValveState[],
    pointerWorld: { x: number; y: number; inside: boolean },
    scale: number,
    uiScale: number,
    time: number
  ): void {
    const isPlaying = state.screen === 'playing';
    const isCh1 = state.levelId === 'level-1' || state.levelIndex === 1;

    for (const v of valves) {
      const vx = this.cx(v.x);
      const vy = this.cy(v.y);
      const hoverRadiusWorld = Math.max(0.75, v.length * 0.58);
      const distWorld = Math.hypot(pointerWorld.x - v.x, pointerWorld.y - v.y);
      const isHovered = isPlaying && pointerWorld.inside && distWorld <= hoverRadiusWorld;
      const isCh1Guide = isPlaying && isCh1 && state.elapsed < 10 && v.id === 'valve-1';

      if (!isHovered && !isCh1Guide) continue;

      const haloR = Math.max(22 * uiScale, v.length * 0.54 * scale);
      const pulse = 0.5 + 0.5 * Math.sin(time * 4.8);

      ctx.save();

      // Chapter 1 first-time pulsing guide ring on valve-1
      if (isCh1Guide) {
        const ping = (time * 0.85) % 1;
        ctx.beginPath();
        ctx.arc(vx, vy, haloR + ping * 16 * uiScale, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(251, 191, 36, ${(1 - ping) * 0.62})`;
        ctx.lineWidth = 2.2 * uiScale;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(vx, vy, haloR + pulse * 3 * uiScale, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(251, 191, 36, ${0.48 + pulse * 0.35})`;
        ctx.lineWidth = 2.4 * uiScale;
        ctx.stroke();
      }

      if (isHovered) {
        // Subtle pulsing clickable halo ring
        ctx.beginPath();
        ctx.arc(vx, vy, haloR + pulse * 2.5 * uiScale, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(251, 191, 36, 0.09)';
        ctx.fill();
        ctx.strokeStyle = `rgba(253, 224, 71, ${0.72 + pulse * 0.25})`;
        ctx.lineWidth = 2.2 * uiScale;
        ctx.shadowColor = 'rgba(251, 191, 36, 0.75)';
        ctx.shadowBlur = 9 * uiScale;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Curved brass toggle arrows orbiting the valve pivot
        const arrowR = haloR + 7 * uiScale;
        const rotSpin = Math.sin(time * 2.6) * 0.14;
        const arcs: Array<[number, number]> = [
          [-Math.PI * 0.76 + rotSpin, -Math.PI * 0.24 + rotSpin],
          [Math.PI * 0.24 + rotSpin, Math.PI * 0.76 + rotSpin],
        ];
        ctx.strokeStyle = '#fde68a';
        ctx.lineWidth = 2.1 * uiScale;
        ctx.lineCap = 'round';
        for (const [a0, a1] of arcs) {
          ctx.beginPath();
          ctx.arc(vx, vy, arrowR, a0, a1);
          ctx.stroke();

          const tipX = vx + Math.cos(a1) * arrowR;
          const tipY = vy + Math.sin(a1) * arrowR;
          this.drawArrowHead(ctx, tipX, tipY, a1 + Math.PI * 0.5, 7 * uiScale, '#fde68a');
        }

        // Gentle localized click tooltip
        const tipLabel = t(state.lang, 'valveClickHint');
        const labelY =
          vy - arrowR - 18 * uiScale > 20
            ? vy - arrowR - 18 * uiScale
            : vy + arrowR + 18 * uiScale;
        this.drawCompactReadout(
          ctx,
          vx,
          labelY,
          tipLabel,
          '#fef3c7',
          'rgba(15, 23, 42, 0.84)',
          'rgba(251, 191, 36, 0.72)',
          11 * uiScale
        );
      }

      ctx.restore();
    }
  }

  private drawPortals(
    ctx: CanvasRenderingContext2D,
    portals: PortalPairState[],
    scale: number,
    uiScale: number,
    time: number
  ): void {
    for (const p of portals) {
      const ix = this.cx(p.inX);
      const iy = this.cy(p.inY);
      const ox = this.cx(p.outX);
      const oy = this.cy(p.outY);
      const pulseGlow = clamp(p.pulse, 0, 1);

      ctx.save();

      // Graceful arched quadratic curve linking intake (inX, inY) -> output (outX, outY)
      const dx = ox - ix;
      const dy = oy - iy;
      const dist = Math.hypot(dx, dy);
      if (dist > 4) {
        const nx = -dy / dist;
        const ny = dx / dist;
        // Bias arch gently upward (-Y on canvas) when horizontal
        const sign = ny <= 0 ? 1 : -1;
        const arch = Math.min(85 * uiScale, dist * 0.16) * sign;
        const ctrlX = (ix + ox) * 0.5 + nx * arch;
        const ctrlY = (iy + oy) * 0.5 + ny * arch;

        const baseAlpha = 0.22 + pulseGlow * 0.55;
        ctx.setLineDash([4 * uiScale, 7 * uiScale]);
        ctx.lineDashOffset = -time * (26 + pulseGlow * 42) * uiScale;
        ctx.beginPath();
        ctx.moveTo(ix, iy);
        ctx.quadraticCurveTo(ctrlX, ctrlY, ox, oy);
        ctx.strokeStyle = `rgba(251, 191, 36, ${baseAlpha})`;
        ctx.lineWidth = (1.6 + pulseGlow * 1.4) * uiScale;
        ctx.lineCap = 'round';
        if (pulseGlow > 0.08) {
          ctx.shadowColor = 'rgba(251, 191, 36, 0.75)';
          ctx.shadowBlur = 8 * uiScale * pulseGlow;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.setLineDash([]);
      }

      // Subtle glowing intake/output rings
      const pr = Math.max(10 * uiScale, p.radius * scale);
      if (pulseGlow > 0.02) {
        ctx.beginPath();
        ctx.arc(ix, iy, pr * (1.08 + pulseGlow * 0.25), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(253, 224, 71, ${0.35 * pulseGlow})`;
        ctx.lineWidth = 2.5 * uiScale;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(ox, oy, pr * (1.08 + pulseGlow * 0.25), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(103, 232, 249, ${0.42 * pulseGlow})`;
        ctx.lineWidth = 2.5 * uiScale;
        ctx.stroke();
      }

      // Crisp directional chevrons streaming from output nozzle along (outDirX, -outDirY)
      const odx = p.outDirX;
      const ody = -p.outDirY;
      const oLen = Math.hypot(odx, ody);
      if (oLen > 0.001) {
        const ux = odx / oLen;
        const uy = ody / oLen;
        const ang = Math.atan2(uy, ux);
        const startDist = pr + 6 * uiScale;
        const travelDist = 28 * uiScale;
        const chevSize = 6.5 * uiScale;

        for (let i = 0; i < 3; i++) {
          const phase = (time * (1.5 + pulseGlow * 1.6) + i / 3) % 1;
          const d = startDist + phase * travelDist;
          const cx = ox + ux * d;
          const cy = oy + uy * d;
          const alpha = Math.sin(phase * Math.PI) * (0.45 + pulseGlow * 0.5);
          this.strokeChevron(ctx, cx, cy, ang, chevSize, `rgba(165, 243, 252, ${alpha})`, 2.1 * uiScale);
        }
      }

      ctx.restore();
    }
  }

  private drawPumps(
    ctx: CanvasRenderingContext2D,
    pumps: GeyserPumpState[],
    scale: number,
    uiScale: number,
    time: number
  ): void {
    for (const pump of pumps) {
      if (!pump.active || pump.power <= 0.1) continue;

      const px = this.cx(pump.x);
      const py = this.cy(pump.y);
      const cdx = pump.dirX;
      const cdy = -pump.dirY;
      const len = Math.hypot(cdx, cdy);
      if (len < 0.001) continue;

      const ux = cdx / len;
      const uy = cdy / len;
      const ang = Math.atan2(uy, ux);
      const pwr = clamp(pump.power, 0.1, 1.3);
      const streamLen = clamp(pump.range * 0.45, 0.75, 2.5) * scale;
      const chevWidth = clamp(pump.radius * scale * 0.78, 7 * uiScale, 16 * uiScale);

      ctx.save();

      // Subtle pressurized base ring at nozzle
      ctx.beginPath();
      ctx.arc(px, py, Math.max(8 * uiScale, pump.radius * scale), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(56, 189, 248, ${0.35 + pwr * 0.25})`;
      ctx.lineWidth = 2 * uiScale;
      ctx.stroke();

      // 4 animated directional pressure chevrons streaming along (dirX, dirY)
      const count = 4;
      for (let i = 0; i < count; i++) {
        const phase = (time * (1.7 + pwr * 1.4) + i / count) % 1;
        const d = (0.12 + phase * 0.88) * streamLen;
        const cx = px + ux * d;
        const cy = py + uy * d;
        const alpha = Math.sin(phase * Math.PI) * clamp(0.45 + pwr * 0.4, 0, 0.92);
        this.strokeChevron(
          ctx,
          cx,
          cy,
          ang,
          chevWidth * (1 - phase * 0.22),
          `rgba(125, 211, 252, ${alpha})`,
          2.3 * uiScale
        );
      }

      ctx.restore();
    }
  }

  private drawMines(
    ctx: CanvasRenderingContext2D,
    mines: HydroMineState[],
    scale: number,
    uiScale: number,
    time: number
  ): void {
    for (const mine of mines) {
      const mx = this.cx(mine.x);
      const my = this.cy(mine.y);
      const r = Math.max(8 * uiScale, mine.radius * scale);

      ctx.save();

      if (!mine.detonated) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 5.2 + mine.x * 1.3);
        const flashBoost = clamp(mine.flash, 0, 1);
        const ringR = r + (4 + pulse * 3.5) * uiScale;

        ctx.beginPath();
        ctx.arc(mx, my, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(245, 158, 11, ${0.32 + pulse * 0.34 + flashBoost * 0.3})`;
        ctx.lineWidth = (1.8 + flashBoost * 1.2) * uiScale;
        ctx.stroke();

        if (flashBoost > 0.05) {
          ctx.beginPath();
          ctx.arc(mx, my, r * 1.8, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(251, 146, 60, ${flashBoost * 0.22})`;
          ctx.fill();
        }
      } else if (mine.flash > 0.01) {
        // Faint blast preview flash on detonation
        const f = clamp(mine.flash, 0, 1);
        const blastR = r + (1.45 * (1 - f) + 0.35) * scale;

        const rad = ctx.createRadialGradient(mx, my, 2, mx, my, blastR);
        rad.addColorStop(0, `rgba(254, 240, 138, ${f * 0.38})`);
        rad.addColorStop(0.55, `rgba(251, 146, 60, ${f * 0.22})`);
        rad.addColorStop(1, 'rgba(249, 115, 22, 0)');
        ctx.fillStyle = rad;
        ctx.beginPath();
        ctx.arc(mx, my, blastR, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(mx, my, blastR * 0.92, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(253, 186, 116, ${f * 0.65})`;
        ctx.lineWidth = 2.4 * uiScale;
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  private drawToolCursor(
    ctx: CanvasRenderingContext2D,
    state: GameStateSnapshot,
    toolInput: ToolForceInput,
    pointerWorld: { x: number; y: number },
    scale: number,
    uiScale: number,
    time: number
  ): void {
    const px = this.cx(pointerWorld.x);
    const py = this.cy(pointerWorld.y);

    ctx.save();

    switch (state.activeTool) {
      case 'surge': {
        const r = Math.max(18, 0.3 * scale);
        const rot = time * 2.2;
        const engaged = toolInput.active;

        // Outer soft aura
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.strokeStyle = engaged ? 'rgba(94, 234, 212, 0.32)' : 'rgba(56, 189, 248, 0.22)';
        ctx.lineWidth = (engaged ? 4.5 : 3) * uiScale;
        ctx.stroke();

        // Sleek hydrodynamic crescent arcs
        for (let i = 0; i < 2; i++) {
          const a0 = rot + i * Math.PI;
          ctx.beginPath();
          ctx.arc(px, py, r, a0, a0 + Math.PI * 0.68);
          ctx.strokeStyle = engaged ? '#5eead4' : '#38bdf8';
          ctx.lineWidth = (engaged ? 2.8 : 2.1) * uiScale;
          ctx.lineCap = 'round';
          ctx.stroke();
        }

        // Dynamic drag velocity vector arrow when dragging
        if (engaged) {
          const cvx = toolInput.vx;
          const cvy = -toolInput.vy; // world +Y up -> canvas +Y down
          const speed = Math.hypot(cvx, cvy);
          if (speed > 0.12) {
            const nx = cvx / speed;
            const ny = cvy / speed;
            const arrowLen = clamp(22 * uiScale + speed * 0.14 * scale, 22 * uiScale, 1.55 * scale);
            const ex = px + nx * arrowLen;
            const ey = py + ny * arrowLen;

            // Glowing wake beam
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(ex, ey);
            ctx.strokeStyle = 'rgba(94, 234, 212, 0.35)';
            ctx.lineWidth = 6 * uiScale;
            ctx.lineCap = 'round';
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(ex, ey);
            ctx.strokeStyle = '#99f6e4';
            ctx.lineWidth = 2.4 * uiScale;
            ctx.stroke();

            this.drawArrowHead(ctx, ex, ey, Math.atan2(ny, nx), 9 * uiScale, '#99f6e4');
          }
        }
        break;
      }

      case 'ice': {
        const r = ICE_BRUSH_RADIUS_M * scale;
        const frostRatio =
          state.frostMax > 0
            ? clamp((state.frostMax - state.frostUsed) / state.frostMax, 0, 1)
            : 1;
        const melting = toolInput.secondary;
        const depleted = !melting && frostRatio <= 0.001;

        const hexColor = melting
          ? '#fda4af'
          : depleted
            ? '#fbbf24'
            : '#bae6fd';
        const arcColor = melting
          ? '#fb7185'
          : frostRatio < 0.15
            ? '#f87171'
            : '#38bdf8';

        // Crisp glowing hexagonal ice-crystal brush ring
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const ang = (Math.PI / 3) * i - Math.PI / 6;
          const vx = px + Math.cos(ang) * r;
          const vy = py + Math.sin(ang) * r;
          if (i === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
        ctx.fillStyle = melting ? 'rgba(251, 113, 133, 0.1)' : 'rgba(186, 230, 253, 0.12)';
        ctx.fill();
        ctx.strokeStyle = hexColor;
        ctx.lineWidth = 2 * uiScale;
        ctx.shadowColor = melting ? 'rgba(251, 113, 133, 0.6)' : 'rgba(125, 211, 252, 0.75)';
        ctx.shadowBlur = 8 * uiScale;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Frost budget remaining ring outside hexagon
        const gaugeR = r + 5.5 * uiScale;
        ctx.beginPath();
        ctx.arc(px, py, gaugeR, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
        ctx.lineWidth = 2 * uiScale;
        ctx.stroke();

        if (frostRatio > 0.005) {
          ctx.beginPath();
          ctx.arc(px, py, gaugeR, -Math.PI * 0.5, -Math.PI * 0.5 + frostRatio * Math.PI * 2);
          ctx.strokeStyle = arcColor;
          ctx.lineWidth = 2.6 * uiScale;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
        break;
      }

      case 'vortex': {
        if (toolInput.active && toolInput.chargePos) {
          const cx = this.cx(toolInput.chargePos.x);
          const cy = this.cy(toolInput.chargePos.y);
          const chargeNorm = clamp(toolInput.chargeTime / 0.75, 0, 1);
          const burstFactor = clamp(0.35 + toolInput.chargeTime * 0.9, 0.35, 1.0);

          // Contracting & brightening swirling concentric cyan-aqua spiral
          const outerR = (0.92 - chargeNorm * 0.52) * scale;
          const spin = time * (3.6 + chargeNorm * 7.5);
          const alpha = 0.5 + chargeNorm * 0.48;

          // Core charge glow
          const coreGrad = ctx.createRadialGradient(cx, cy, 1, cx, cy, outerR * 0.55);
          coreGrad.addColorStop(0, `rgba(207, 250, 254, ${0.42 + chargeNorm * 0.42})`);
          coreGrad.addColorStop(1, 'rgba(34, 211, 238, 0)');
          ctx.fillStyle = coreGrad;
          ctx.beginPath();
          ctx.arc(cx, cy, outerR * 0.55, 0, Math.PI * 2);
          ctx.fill();

          // 3 swirling spiral arms
          ctx.lineCap = 'round';
          for (let arm = 0; arm < 3; arm++) {
            const baseAngle = spin + (arm * Math.PI * 2) / 3;
            ctx.beginPath();
            const steps = 22;
            for (let s = 0; s <= steps; s++) {
              const u = s / steps;
              const rad = outerR * (1 - u * 0.78);
              const ang = baseAngle + u * Math.PI * 1.45;
              const sx = cx + Math.cos(ang) * rad;
              const sy = cy + Math.sin(ang) * rad;
              if (s === 0) ctx.moveTo(sx, sy);
              else ctx.lineTo(sx, sy);
            }
            ctx.strokeStyle = `rgba(34, 211, 238, ${alpha})`;
            ctx.lineWidth = (1.6 + chargeNorm * 1.4) * uiScale;
            ctx.stroke();
          }

          // Concentric outer ring
          ctx.beginPath();
          ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(103, 232, 249, ${0.35 + chargeNorm * 0.45})`;
          ctx.lineWidth = 1.8 * uiScale;
          ctx.stroke();

          // Aimed trajectory prediction vector from chargePos toward current pointer
          const aimWorldDx = pointerWorld.x - toolInput.chargePos.x;
          const aimWorldDy = pointerWorld.y - toolInput.chargePos.y;
          const aimWorldDist = Math.hypot(aimWorldDx, aimWorldDy);
          const hasDraggedAim = aimWorldDist > 0.12;
          const dirX = hasDraggedAim ? aimWorldDx / aimWorldDist : 0.5;
          const dirY = hasDraggedAim ? aimWorldDy / aimWorldDist : 0.8660254;

          if (hasDraggedAim) {
            // Direct aim guide from charge center to cursor
            ctx.setLineDash([4 * uiScale, 4 * uiScale]);
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(px, py);
            ctx.strokeStyle = 'rgba(165, 243, 252, 0.55)';
            ctx.lineWidth = 1.6 * uiScale;
            ctx.stroke();
            ctx.setLineDash([]);
          }

          // Forward ballistic trajectory preview (incorporating world GRAVITY)
          const launchSpeed = burstFactor * 14.5;
          const vx0 = dirX * launchSpeed;
          const vy0 = dirY * launchSpeed;
          const dotCount = hasDraggedAim ? 10 : 6;
          const dtStep = 0.046;

          let prevX = cx;
          let prevY = cy;
          let lastAngle = Math.atan2(-dirY, dirX);

          for (let k = 1; k <= dotCount; k++) {
            const tau = k * dtStep;
            const wx = toolInput.chargePos.x + vx0 * tau;
            const wy = toolInput.chargePos.y + vy0 * tau + 0.5 * GRAVITY * tau * tau;
            const tx = this.cx(wx);
            const ty = this.cy(wy);
            lastAngle = Math.atan2(ty - prevY, tx - prevX);
            prevX = tx;
            prevY = ty;

            const fade = (hasDraggedAim ? 1 : 0.55) * (1 - k / (dotCount + 2));
            ctx.beginPath();
            ctx.arc(tx, ty, (3.2 - k * 0.16) * uiScale, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(103, 232, 249, ${fade * 0.9})`;
            ctx.fill();
          }

          this.drawArrowHead(
            ctx,
            prevX,
            prevY,
            lastAngle,
            8 * uiScale,
            `rgba(165, 243, 252, ${hasDraggedAim ? 0.85 : 0.5})`
          );
        } else {
          // Idle vortex reticle
          const r = 0.32 * scale;
          const rot = time * 1.8;
          for (let i = 0; i < 3; i++) {
            const a = rot + (i * Math.PI * 2) / 3;
            ctx.beginPath();
            ctx.arc(px, py, r, a, a + 1.25);
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 2.1 * uiScale;
            ctx.lineCap = 'round';
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.arc(px, py, 3 * uiScale, 0, Math.PI * 2);
          ctx.fillStyle = '#a5f3fc';
          ctx.fill();
        }
        break;
      }

      case 'pour': {
        const r = 0.24 * scale;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
        ctx.fill();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.2 * uiScale;
        ctx.stroke();

        // Droplet glyph
        const bob = Math.sin(time * 5) * 2 * uiScale;
        ctx.beginPath();
        ctx.moveTo(px, py - 6 * uiScale + bob);
        ctx.quadraticCurveTo(px + 5 * uiScale, py + 1 * uiScale + bob, px, py + 5.5 * uiScale + bob);
        ctx.quadraticCurveTo(px - 5 * uiScale, py + 1 * uiScale + bob, px, py - 6 * uiScale + bob);
        ctx.fillStyle = '#7dd3fc';
        ctx.fill();
        break;
      }

      case 'drain': {
        const r = 0.28 * scale;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(244, 63, 94, 0.1)';
        ctx.fill();
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 2.2 * uiScale;
        ctx.stroke();

        // Subtle inward vacuum ticks
        const pulse = (time * 1.4) % 1;
        const innerR = r * (0.85 - pulse * 0.45);
        ctx.beginPath();
        ctx.arc(px, py, innerR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(251, 113, 133, ${1 - pulse})`;
        ctx.lineWidth = 1.6 * uiScale;
        ctx.stroke();
        break;
      }

      case 'rock': {
        const r = 0.24 * scale;
        const carving = toolInput.secondary;
        const strokeColor = carving ? '#fb7185' : '#d97706';

        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = carving ? 'rgba(251, 113, 133, 0.1)' : 'rgba(217, 119, 6, 0.12)';
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2.2 * uiScale;
        ctx.stroke();

        // Inner faceted basalt diamond
        const dr = r * 0.42;
        ctx.beginPath();
        ctx.moveTo(px, py - dr);
        ctx.lineTo(px + dr, py);
        ctx.lineTo(px, py + dr);
        ctx.lineTo(px - dr, py);
        ctx.closePath();
        ctx.strokeStyle = carving ? 'rgba(253, 164, 175, 0.8)' : 'rgba(251, 191, 36, 0.78)';
        ctx.lineWidth = 1.5 * uiScale;
        ctx.stroke();
        break;
      }
    }

    ctx.restore();
  }

  private drawSlowMoVignette(
    ctx: CanvasRenderingContext2D,
    state: GameStateSnapshot,
    uiScale: number,
    time: number
  ): void {
    ctx.save();

    const cx = this.width * 0.5;
    const cy = this.height * 0.5;
    const outerR = Math.hypot(cx, cy);
    const innerR = outerR * 0.52;
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.4);

    // Cool frosted indigo edge glow
    const vig = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
    vig.addColorStop(0, 'rgba(99, 102, 241, 0)');
    vig.addColorStop(0.7, `rgba(79, 70, 229, ${0.12 + pulse * 0.04})`);
    vig.addColorStop(1, `rgba(129, 140, 248, ${0.28 + pulse * 0.06})`);
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, this.width, this.height);

    // Subtle frosted hairline frame
    ctx.strokeStyle = 'rgba(165, 180, 252, 0.35)';
    ctx.lineWidth = 2 * uiScale;
    ctx.strokeRect(3, 3, Math.max(1, this.width - 6), Math.max(1, this.height - 6));

    // Crisp "0.35×" badge near top-center
    const label = t(state.lang, 'slowMoBadge');
    const fontPx = Math.round(12 * uiScale);
    ctx.font = `700 ${fontPx}px ${FONT_STACK}`;
    const textW = ctx.measureText(label).width;
    const pillW = textW + 28 * uiScale;
    const pillH = 24 * uiScale;
    const pillX = cx - pillW * 0.5;
    const pillY = clamp(this.height * 0.085, 14, 68);

    roundedRectPath(ctx, pillX, pillY, pillW, pillH, pillH * 0.5);
    ctx.fillStyle = 'rgba(30, 27, 75, 0.78)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(165, 180, 252, 0.65)';
    ctx.lineWidth = 1.4 * uiScale;
    ctx.stroke();

    // Glowing indigo status dot
    ctx.beginPath();
    ctx.arc(pillX + 12 * uiScale, pillY + pillH * 0.5, 3.2 * uiScale, 0, Math.PI * 2);
    ctx.fillStyle = '#a5b4fc';
    ctx.fill();

    ctx.fillStyle = '#e0e7ff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, pillX + 20 * uiScale, pillY + pillH * 0.5 + 0.5);

    ctx.restore();
  }

  private drawLevel1DragHint(
    ctx: CanvasRenderingContext2D,
    state: GameStateSnapshot,
    mechanisms: MechanismSnapshot,
    _scale: number,
    uiScale: number,
    time: number
  ): void {
    ctx.save();

    // Sweep gently from the starting basin toward the spillway ridge/turbine
    const firstTurbine = mechanisms.turbines[0];
    const sweepRight = !firstTurbine || firstTurbine.x >= 7.0;

    const p0 = { x: this.cx(sweepRight ? 2.8 : 13.2), y: this.cy(2.25) };
    const p1 = { x: this.cx(sweepRight ? 4.7 : 11.3), y: this.cy(3.75) };
    const p2 = { x: this.cx(sweepRight ? 6.6 : 9.4), y: this.cy(4.15) };

    const cycle = (time % 2.4) / 2.4;
    const fade =
      cycle < 0.15
        ? cycle / 0.15
        : cycle > 0.78
          ? Math.max(0, (1 - cycle) / 0.22)
          : 1;
    const prog = clamp((cycle - 0.05) / 0.78, 0, 1);

    // Subtle full guide curve
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
    ctx.setLineDash([6 * uiScale, 6 * uiScale]);
    ctx.strokeStyle = 'rgba(94, 234, 212, 0.35)';
    ctx.lineWidth = 2.2 * uiScale;
    ctx.stroke();
    ctx.setLineDash([]);

    // Animated sweeping trail up to current phase t = prog
    if (prog > 0.02) {
      const steps = 18;
      ctx.beginPath();
      let tipX = p0.x;
      let tipY = p0.y;
      let prevX = p0.x;
      let prevY = p0.y;

      for (let i = 0; i <= steps; i++) {
        const u = (i / steps) * prog;
        const omt = 1 - u;
        const x = omt * omt * p0.x + 2 * omt * u * p1.x + u * u * p2.x;
        const y = omt * omt * p0.y + 2 * omt * u * p1.y + u * u * p2.y;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        if (i === steps - 1) {
          prevX = x;
          prevY = y;
        }
        tipX = x;
        tipY = y;
      }

      ctx.strokeStyle = `rgba(94, 234, 212, ${0.85 * fade})`;
      ctx.lineWidth = 3.5 * uiScale;
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(45, 212, 191, 0.75)';
      ctx.shadowBlur = 10 * uiScale;
      ctx.stroke();
      ctx.shadowBlur = 0;

      const ang = Math.atan2(tipY - prevY, tipX - prevX);
      this.drawArrowHead(ctx, tipX, tipY, ang, 10 * uiScale, `rgba(153, 246, 228, ${fade})`);

      // Glowing drag touch orb
      ctx.beginPath();
      ctx.arc(tipX, tipY, 5 * uiScale, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(204, 251, 241, ${0.9 * fade})`;
      ctx.fill();
    }

    // Localized tutorial drag pill floating cleanly above the arc
    const label = t(state.lang, 'tutorialDrag');
    const fontPx = Math.round(13 * uiScale);
    ctx.font = `600 ${fontPx}px ${FONT_STACK}`;
    const textW = ctx.measureText(label).width;
    const pillW = textW + 28 * uiScale;
    const pillH = 28 * uiScale;
    const pillCx = clamp(p1.x, pillW * 0.5 + 14, this.width - pillW * 0.5 - 14);
    const pillCy = clamp(this.cy(4.85), 24, this.height - 24);

    roundedRectPath(ctx, pillCx - pillW * 0.5, pillCy - pillH * 0.5, pillW, pillH, pillH * 0.5);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(94, 234, 212, 0.58)';
    ctx.lineWidth = 1.5 * uiScale;
    ctx.stroke();

    ctx.fillStyle = '#e0f2fe';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, pillCx, pillCy + 0.5);

    ctx.restore();
  }

  private drawCompactReadout(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    text: string,
    textColor: string,
    bgColor: string,
    borderColor: string,
    fontPx: number
  ): void {
    ctx.font = `700 ${Math.round(fontPx)}px ${FONT_STACK}`;
    const textW = ctx.measureText(text).width;
    const padX = fontPx * 0.65;
    const pillW = textW + padX * 2;
    const pillH = fontPx * 1.55;
    const clampedX = clamp(cx, pillW * 0.5 + 4, this.width - pillW * 0.5 - 4);
    const clampedY = clamp(cy, pillH * 0.5 + 4, this.height - pillH * 0.5 - 4);

    roundedRectPath(ctx, clampedX - pillW * 0.5, clampedY - pillH * 0.5, pillW, pillH, pillH * 0.5);
    ctx.fillStyle = bgColor;
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.1;
    ctx.stroke();

    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, clampedX, clampedY + 0.5);
  }

  private pickVerticalLabelY(centerY: number, ringR: number, offset: number): number {
    const aboveY = centerY - ringR - offset;
    return aboveY > 18 ? aboveY : centerY + ringR + offset;
  }

  private strokeCornerBrackets(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    len: number
  ): void {
    ctx.beginPath();
    // Top-left
    ctx.moveTo(x, y + len);
    ctx.lineTo(x, y);
    ctx.lineTo(x + len, y);
    // Top-right
    ctx.moveTo(x + w - len, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + len);
    // Bottom-right
    ctx.moveTo(x + w, y + h - len);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w - len, y + h);
    // Bottom-left
    ctx.moveTo(x + len, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + h - len);
    ctx.stroke();
  }

  private drawArrowHead(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
    size: number,
    color: string
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-size, -size * 0.48);
    ctx.lineTo(-size * 0.72, 0);
    ctx.lineTo(-size, size * 0.48);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  private strokeChevron(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
    size: number,
    color: string,
    lineWidth: number
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(-size * 0.65, -size * 0.72);
    ctx.lineTo(size * 0.35, 0);
    ctx.lineTo(-size * 0.65, size * 0.72);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  }
}
