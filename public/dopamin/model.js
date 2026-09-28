// Heavily simplified pharmacology for a night of repeated nasal cocaine doses.
// Every line is a Bateman bolus; euphoria saturates and shrinks with acute tolerance,
// while the cardiovascular load keeps stacking. Pure functions so the timeline can project.

export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export const gauss = (t, mu, w) => Math.exp(-(((t - mu) / w) ** 2));

const KA = 0.2; // absorption through the nasal mucosa, 1/min
const KE = 0.04; // elimination, 1/min
const TP = Math.log(KA / KE) / (KA - KE);
const NORM = 1 / (Math.exp(-KE * TP) - Math.exp(-KA * TP)); // one standard line peaks at c = 1

/** cocaine level (1 = peak of one standard line) and the "kick" a few minutes after each line */
export function level(doses, t) {
  let c = 0, kick = 0;
  for (const d of doses) {
    const s = t - d.t;
    if (s < 0) continue;
    c += d.amt * NORM * (Math.exp(-KE * s) - Math.exp(-KA * s));
    kick += Math.min(1.3, d.amt) * gauss(s, 5, 2.6);
  }
  return { c, kick: clamp(kick) };
}

/** one integration step of the slow variables; returns the derived fast ones */
export function step(M, doses, t, dm) {
  const { c, kick } = level(doses, t);
  M.tol = Math.max(0, M.tol + (0.011 * c - 0.0045 * M.tol) * dm);
  // alcohol: absorbed over ~20 min, burnt at ~0.15 per mille per hour
  const absorbed = M.gut * Math.min(1, dm / 12);
  M.gut -= absorbed;
  M.bac = Math.max(0, M.bac + absorbed - 0.0025 * dm);
  // cocaethylene: made in the liver when both are on board, half-life ~2.5 h
  M.ce = Math.max(0, M.ce + (0.004 * c * M.bac - M.ce * (Math.LN2 / 150)) * dm);

  const E = clamp((1.12 * (1 - Math.exp(-1.9 * c))) / (1 + 1.1 * M.tol) + 0.2 * kick + 0.12 * M.ce, 0, 1.1);
  M.peak = Math.max(M.peak * Math.exp(-dm / 140), E);
  const crash = clamp(0.55 * M.tol - 0.9 * E + 0.05);
  const anx = clamp(0.22 * c * M.tol + 0.3 * crash + 0.25 * M.ce);
  const craving = clamp((M.peak - E) * 1.1 + 0.4 * crash);
  return { c, kick, E, crash, anx, craving };
}

export const newModel = () => ({ tol: 0, gut: 0, bac: 0, ce: 0, peak: 0 });

/** euphoria curve for the timeline: history is recorded, the future assumes no more lines */
export function project(doses, from, M0, end, n = 200) {
  const M = { ...M0 };
  const out = [];
  let t = from;
  const dt = 0.5;
  for (let i = 0; i <= n; i++) {
    const target = (i / n) * end;
    if (target < from) continue;
    while (t < target) {
      step(M, doses, t, dt);
      t += dt;
    }
    out.push([target, step({ ...M }, doses, target, 0).E]);
  }
  return out;
}
