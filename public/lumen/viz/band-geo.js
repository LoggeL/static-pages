// LUMEN band figure geometry, shared by the visualiser and the show check (no three.js): limb lengths, string-instrument
// outlines, strap placement and the standing string player's pose. Person frame: +z = facing, +x = his left, y 0 = floor;
// torso frame: origin = pelvis centre.

export const ARM = [0.29, 0.27], LEG = [0.44, 0.43]; // upper / lower lengths (m)
export const HIP = 0.93; // standing pelvis height
export const PELVIS = [0.165, 0.13, 0.115]; // ellipsoid radii (torso frame)
export const HIP_JOINT = [0.09, -0.04, 0]; // ±x (torso frame)
export const THIGH_R = 0.088, SHIN_R = 0.068;
export const LEG_POLE = (s, seated) => [s * 0.18, seated ? 0.7 : 0.05, 1]; // knee bend hint (person frame)

// string instrument body outline (instrument frame: +x along the neck, +y up in the body plane, +z out of the top);
// body depth 0.045 + 0.006 bevel, centred on z 0
export const BODY = {
  bass: [[0.02, 0.03], [0.06, 0.09], [0.075, 0.135], [0.045, 0.155], [-0.02, 0.13], [-0.08, 0.11], [-0.16, 0.13], [-0.26, 0.165], [-0.36, 0.16], [-0.44, 0.11], [-0.48, 0.03],
    [-0.48, -0.04], [-0.45, -0.11], [-0.38, -0.16], [-0.28, -0.175], [-0.18, -0.15], [-0.11, -0.12], [-0.06, -0.12], [-0.02, -0.13], [0.01, -0.12], [0.02, -0.09], [0.02, -0.03]],
  guitar: [[0.02, 0.03], [0.04, 0.07], [0.03, 0.11], [-0.03, 0.13], [-0.1, 0.12], [-0.15, 0.11], [-0.21, 0.13], [-0.29, 0.165], [-0.37, 0.15], [-0.42, 0.1], [-0.44, 0.02],
    [-0.43, -0.06], [-0.39, -0.13], [-0.31, -0.165], [-0.2, -0.16], [-0.1, -0.13], [-0.03, -0.1], [0.01, -0.06], [0.02, -0.03]],
};
export const BODY_HALF = 0.0285;
// strapped instrument in the torso frame (Euler XYZ): hangs in front of the belly, top tilted back so the lower bout swings out
// over the thighs; the back face stays ≥ 1 cm clear of pelvis, hips and legs in every pose (show-check)
export const STRAP = {
  bass: { pos: [0.03, 0, 0.235], rot: [-0.35, -0.08, 0.42] },
  guitar: { pos: [0.04, 0.04, 0.22], rot: [-0.35, -0.08, 0.37] },
};

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
// standing string player at energy e (0..1), beat phase ph, energy gate g, wide stance w (0..1), onset on:
// torso position / Euler XYZ, ankle targets (person frame), shoe yaw, instrument neck angle (rz)
export function stringPose(e, ph, g, w, on, kind) {
  const pulse = Math.pow(0.5 + 0.5 * Math.cos(ph * Math.PI * 2), 3), ee = e * e;
  const rock = 0.04 * g * Math.sin(ph * Math.PI);
  return {
    pos: [rock, HIP - 0.035 * e * pulse - 0.02 * g, 0],
    rot: [0.05 + 0.1 * ee * pulse, 0.04 * Math.sin(ph * Math.PI * 0.5), 0.045 * Math.sin(ph * Math.PI) * (0.3 + e) - rock * 1.2],
    feet: [[0.17 + 0.08 * w, 0.075, 0.06 + 0.05 * w], [-0.16 - 0.05 * w, 0.075, -0.04 - 0.03 * w]],
    yaw: [0.3 + 0.15 * w, -0.25],
    rz: STRAP[kind].rot[2] + 0.14 * g * clamp(on),
    pulse,
  };
}
