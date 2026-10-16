// Suspect personalities on top of the C19 technology. Seconds, metres, degrees, chances 0..1.
// Each layout suspect gets a temper; the stance from layout.json picks the opening posture.
export const BEHAVIOR_CONFIG = {
  profiles: {
    // Kitchen, crouched behind the fridge: waits for a clean look, pops up and shoots.
    S1: { temper: 'ambush', reaction: [0.5, 0.85], skill: 1.0, comply: 0.25, flee: 0.35, patience: 6 },
    // Kids' room corner, pistol on the door: the fast and dangerous one.
    S2: { temper: 'barricaded', reaction: [0.3, 0.5], skill: 1.2, comply: 0.15, flee: 0, patience: 9 },
    // Closet in bedroom 1: scared, bursts out once the officer is in the room.
    S3: { temper: 'hider', reaction: [0.6, 1.0], skill: 0.75, comply: 0.55, flee: 0.2, patience: 4,
      triggerRooms: ['BED1', 'CLO1'], triggerDistance: 3.4, burstOut: 1.0 },
  },
  defaults: { temper: 'ambush', reaction: [0.5, 0.8], skill: 1, comply: 0.3, flee: 0.25, patience: 5 },
  postures: { crouch_cover: 'hide', hide: 'alert', aim: 'aim', stand: 'idle' },
  turnDegPerSecond: 300,
  fire: {
    burst: [2, 4], interval: [0.22, 0.4], pause: [0.7, 1.3],
    // Spread narrows while the suspect keeps the officer in view; movement and a light in the face widen it.
    spreadFirst: 5, spreadSettled: 2, settleSeconds: 1.6, moveSpread: 3, moveSpeed: 4,
    // Under stress the first rounds go wide in one direction, then walk onto the target with time in view;
    // each shot's recoil kicks the next one off again. Metres at the target, before the spread cone.
    aimError: [0.6, 1.2], aimSettleSeconds: 1.4, recoilError: 0.2,
    chestDrop: 0.35, flinchSeconds: 0.35, cooldownSeconds: 0.18,
  },
  // Weapon light straight in the face delays the first shot and spoils the aim.
  glare: { coneDeg: 13, range: 9, reaction: 0.35, spread: 2.5 },
  shout: { range: 14, cooldown: 1.6, aimedDeg: 8, aimedBonus: 0.3, woundedBonus: 0.25, firedPenalty: 0.25,
    unseenPenalty: 0.15, delay: [0.4, 0.9], recheck: 2.0 },
  lostSeconds: 1.2,
  bark: { spotted: 0.55, refused: 0.8 },
  whiz: { distance: 1.3 },
  muzzleFlash: { color: '#ffb060', intensity: 2, distance: 9, seconds: 0.06 },
  bodyFallDelay: 0.75,
};
