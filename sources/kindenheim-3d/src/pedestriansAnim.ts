/**
 * NPC pedestrians - skeleton animation baked into a bone-matrix texture + the instanced skinning material.
 *
 * The figures (blender/people/build_people.py) share one 19-bone adult skeleton; the dog has its own 19 bones.
 * Here the gaits are generated procedurally (walk with two-bone leg IK on planted feet, idle, chat, dog trot) and
 * baked ONCE at load into a float texture: every row = one pose, every bone = 3 texels (a 3x4 rigid matrix that maps
 * a rest-pose vertex to its posed position). The vertex shader blends two rows of the walk cycle, two rows of an
 * idle / chat loop and the walk-idle mix per instance, so hundreds of walkers cost one draw call per model and the
 * cycle phase can follow each walker's real ground speed (no foot sliding).
 *
 * Model space: +X = the figure's left, +Y up (0 = shoe sole), +Z forward. Pose rotations are expressed in that frame
 * with identity rest orientations: worldQ(child) = worldQ(parent) * localQ(child),
 * worldP(child) = worldP(parent) + worldQ(parent) * (head(child) - head(parent)), skin = T(worldP) R(worldQ) T(-head).
 */
import * as THREE from 'three';

export interface BoneDef {
  name: string;
  parent: string | null;
  head: [number, number, number];
  tail: [number, number, number];
}

export type AnimStyleName = 'normal' | 'elderly' | 'carryR' | 'elderlyCarryL' | 'leashL' | 'dog';

export interface AnimSpec {
  style: AnimStyleName;
  /** distance covered by one full gait cycle (two steps) at instance scale 1, metres */
  stride: number;
  /** walking speed range, m/s (figures only) */
  speed?: [number, number];
}

export const WALK_FRAMES = 32;
export const IDLE_FRAMES = 48;
export const CHAT_FRAMES = 48;
export const ROWS_PER_SET = WALK_FRAMES + IDLE_FRAMES + CHAT_FRAMES;
/** Duration of the idle and the chat loops (seconds). */
export const IDLE_LOOP_S = 5.2;
export const CHAT_LOOP_S = 4.4;

const DEG = Math.PI / 180;

export class Rig {
  public readonly names: string[];
  public readonly parent: Int16Array;
  public readonly head: THREE.Vector3[];
  public readonly tail: THREE.Vector3[];
  private readonly index = new Map<string, number>();

  constructor(defs: BoneDef[], public readonly label: string) {
    if (!Array.isArray(defs) || defs.length === 0) throw new Error(`[pedestrians] ${label}: skeleton has no bones`);
    this.names = defs.map((d) => d.name);
    this.parent = new Int16Array(defs.length);
    this.head = [];
    this.tail = [];
    defs.forEach((d, i) => {
      if (this.index.has(d.name)) throw new Error(`[pedestrians] ${label}: duplicate bone "${d.name}"`);
      if (!Array.isArray(d.head) || d.head.length !== 3 || !d.head.every(Number.isFinite)) {
        throw new Error(`[pedestrians] ${label}: bone "${d.name}" has no valid head position`);
      }
      this.index.set(d.name, i);
      this.head.push(new THREE.Vector3(...d.head));
      this.tail.push(new THREE.Vector3(...d.tail));
      if (d.parent === null) {
        if (i !== 0) throw new Error(`[pedestrians] ${label}: only the first bone may be the root ("${d.name}" has no parent)`);
        this.parent[i] = -1;
      } else {
        const p = this.index.get(d.parent);
        if (p === undefined) throw new Error(`[pedestrians] ${label}: bone "${d.name}" lists parent "${d.parent}" before it exists`);
        this.parent[i] = p;
      }
    });
  }

  public get count(): number {
    return this.names.length;
  }

  public idx(name: string): number {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`[pedestrians] ${this.label}: no bone "${name}"`);
    return i;
  }

  public has(name: string): boolean {
    return this.index.has(name);
  }
}

/** Working pose: world rotation + world head position of every bone. */
class Pose {
  public readonly q: THREE.Quaternion[];
  public readonly p: THREE.Vector3[];
  private readonly tmp = new THREE.Vector3();

  constructor(public readonly rig: Rig) {
    this.q = rig.head.map(() => new THREE.Quaternion());
    this.p = rig.head.map((h) => h.clone());
  }

  public root(b: number, q: THREE.Quaternion, offset: THREE.Vector3): void {
    this.q[b].copy(q);
    this.p[b].copy(this.rig.head[b]).add(offset);
  }

  /** FK child from its parent's world transform with a local rotation. */
  public fk(b: number, local: THREE.Quaternion): void {
    const par = this.rig.parent[b];
    this.p[b].copy(this.tmp.subVectors(this.rig.head[b], this.rig.head[par]).applyQuaternion(this.q[par])).add(this.p[par]);
    this.q[b].copy(this.q[par]).multiply(local);
  }

  /** Bone head placed by FK from the parent, world rotation set directly. */
  public fkWorld(b: number, worldQ: THREE.Quaternion): void {
    const par = this.rig.parent[b];
    this.p[b].copy(this.tmp.subVectors(this.rig.head[b], this.rig.head[par]).applyQuaternion(this.q[par])).add(this.p[par]);
    this.q[b].copy(worldQ);
  }

  public set(b: number, worldQ: THREE.Quaternion, worldP: THREE.Vector3): void {
    this.q[b].copy(worldQ);
    this.p[b].copy(worldP);
  }

  /** Where a rest-pose point attached to bone b ends up. */
  public pointOf(b: number, rest: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.subVectors(rest, this.rig.head[b]).applyQuaternion(this.q[b]).add(this.p[b]);
  }

  /** 3x4 row-major skin matrices of all bones into `out` at `offset`. */
  public write(out: Float32Array, offset: number): void {
    const m = new THREE.Matrix4();
    for (let b = 0; b < this.rig.count; b++) {
      m.makeRotationFromQuaternion(this.q[b]);
      const e = m.elements; // column-major
      const h = this.rig.head[b];
      const tx = this.p[b].x - (e[0] * h.x + e[4] * h.y + e[8] * h.z);
      const ty = this.p[b].y - (e[1] * h.x + e[5] * h.y + e[9] * h.z);
      const tz = this.p[b].z - (e[2] * h.x + e[6] * h.y + e[10] * h.z);
      const o = offset + b * 12;
      out[o] = e[0];
      out[o + 1] = e[4];
      out[o + 2] = e[8];
      out[o + 3] = tx;
      out[o + 4] = e[1];
      out[o + 5] = e[5];
      out[o + 6] = e[9];
      out[o + 7] = ty;
      out[o + 8] = e[2];
      out[o + 9] = e[6];
      out[o + 10] = e[10];
      out[o + 11] = tz;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// math helpers
// ---------------------------------------------------------------------------------------------------------------

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);

function qx(a: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(AX, a);
}
function qy(a: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(AY, a);
}
function qz(a: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(AZ, a);
}
/** Product of quaternions, applied right-to-left (q1 * q2 * ...). */
function qmul(...qs: THREE.Quaternion[]): THREE.Quaternion {
  const out = new THREE.Quaternion();
  for (const q of qs) out.multiply(q);
  return out;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const TAU = Math.PI * 2;

/**
 * Rotation that maps the rest frame (bone direction a0, side vector b0) onto the posed frame (a1, b1).
 * Side vectors are orthogonalised against the directions first.
 */
function alignFrame(a0: THREE.Vector3, b0: THREE.Vector3, a1: THREE.Vector3, b1: THREE.Vector3): THREE.Quaternion {
  const basis = (a: THREE.Vector3, b: THREE.Vector3): THREE.Matrix4 => {
    const x = a.clone().normalize();
    const y = b.clone().addScaledVector(x, -b.dot(x)).normalize();
    const z = new THREE.Vector3().crossVectors(x, y);
    return new THREE.Matrix4().makeBasis(x, y, z);
  };
  const m0 = basis(a0, b0);
  const m1 = basis(a1, b1);
  const r = m1.multiply(m0.transpose());
  return new THREE.Quaternion().setFromRotationMatrix(r);
}

/**
 * Two-bone IK: places the bones b1 (root at its FK head), b2 and the end effector head (b3's head) so that b3's head
 * reaches `target`, bending towards `pole`. Writes world rotations/positions for b1 and b2 and returns b3's head.
 * `stretchOut` receives how far the target was out of reach (0 when reachable).
 */
function twoBoneIK(
  pose: Pose,
  b1: number,
  b2: number,
  b3: number,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  stretchOut: { value: number }
): THREE.Vector3 {
  const rig = pose.rig;
  const h1 = pose.p[b1].clone();
  const l1 = rig.head[b2].distanceTo(rig.head[b1]);
  const l2 = rig.head[b3].distanceTo(rig.head[b2]);
  const toT = target.clone().sub(h1);
  let d = toT.length();
  const maxD = (l1 + l2) * 0.9995;
  stretchOut.value = Math.max(0, d - maxD);
  d = Math.min(Math.max(d, Math.abs(l1 - l2) + 1e-4), maxD);
  const e = toT.normalize();
  const f = pole.clone().addScaledVector(e, -pole.dot(e));
  if (f.lengthSq() < 1e-10) throw new Error(`[pedestrians] IK pole parallel to the limb (${rig.names[b1]})`);
  f.normalize();
  const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const knee = h1.clone().addScaledVector(e, l1 * cosA).addScaledVector(f, l1 * sinA);
  const end = h1.clone().addScaledVector(e, d);
  // plane normal (the limb's hinge axis), same for both bones
  const n = new THREE.Vector3().crossVectors(f, e).normalize();
  // rest frames
  const restDir1 = rig.head[b2].clone().sub(rig.head[b1]);
  const restDir2 = rig.head[b3].clone().sub(rig.head[b2]);
  const restN = new THREE.Vector3().crossVectors(pole, restDir1.clone().normalize());
  if (restN.lengthSq() < 1e-10) throw new Error(`[pedestrians] IK rest pole parallel to ${rig.names[b1]}`);
  const q1 = alignFrame(restDir1, restN, knee.clone().sub(h1), n);
  const q2 = alignFrame(restDir2, restN, end.clone().sub(knee), n);
  pose.set(b1, q1, h1);
  pose.set(b2, q2, knee);
  return end;
}

// ---------------------------------------------------------------------------------------------------------------
// human gait
// ---------------------------------------------------------------------------------------------------------------

interface GaitParams {
  duty: number;
  drop: number;
  bob: number;
  sway: number;
  yaw: number;
  roll: number;
  lean: number;
  stoop: number;
  armSwing: number;
  armLag: number;
  elbowBase: number;
  elbowSwing: number;
  lift: number;
  footWidth: number;
  heelStrike: number;
  toeOff: number;
  carryR: boolean;
  carryL: boolean;
  leashL: boolean;
}

function gaitParams(style: AnimStyleName): GaitParams {
  const normal: GaitParams = {
    duty: 0.62,
    drop: 0.022,
    bob: 0.017,
    sway: 0.018,
    yaw: 5 * DEG,
    roll: 3 * DEG,
    lean: 3.5 * DEG,
    stoop: 0,
    armSwing: 17 * DEG,
    armLag: 0.04,
    elbowBase: 11 * DEG,
    elbowSwing: 12 * DEG,
    lift: 0.085,
    footWidth: 0.92,
    heelStrike: 15 * DEG,
    toeOff: 28 * DEG,
    carryR: false,
    carryL: false,
    leashL: false,
  };
  switch (style) {
    case 'normal':
      return normal;
    case 'carryR':
      return { ...normal, carryR: true };
    case 'leashL':
      return { ...normal, leashL: true };
    case 'elderly':
    case 'elderlyCarryL':
      return {
        ...normal,
        duty: 0.66,
        drop: 0.04,
        bob: 0.009,
        sway: 0.024,
        yaw: 3 * DEG,
        roll: 2 * DEG,
        lean: 4 * DEG,
        stoop: 13 * DEG,
        armSwing: 9 * DEG,
        elbowBase: 18 * DEG,
        elbowSwing: 6 * DEG,
        lift: 0.05,
        footWidth: 1.05,
        heelStrike: 8 * DEG,
        toeOff: 16 * DEG,
        carryL: style === 'elderlyCarryL',
      };
    default:
      throw new Error(`[pedestrians] no human gait for style "${style}"`);
  }
}

interface HumanBones {
  hips: number;
  spine: number;
  chest: number;
  neck: number;
  head: number;
  side: {
    s: number;
    upperarm: number;
    forearm: number;
    hand: number;
    thigh: number;
    shin: number;
    foot: number;
    toe: number;
  }[];
}

function humanBones(rig: Rig): HumanBones {
  const side = (sfx: string, s: number) => ({
    s,
    upperarm: rig.idx(`upperarm${sfx}`),
    forearm: rig.idx(`forearm${sfx}`),
    hand: rig.idx(`hand${sfx}`),
    thigh: rig.idx(`thigh${sfx}`),
    shin: rig.idx(`shin${sfx}`),
    foot: rig.idx(`foot${sfx}`),
    toe: rig.idx(`toe${sfx}`),
  });
  const hb: HumanBones = {
    hips: rig.idx('hips'),
    spine: rig.idx('spine'),
    chest: rig.idx('chest'),
    neck: rig.idx('neck'),
    head: rig.idx('head'),
    side: [side('_L', 1), side('_R', -1)],
  };
  if (hb.hips !== 0) throw new Error('[pedestrians] human skeleton: "hips" must be the root bone');
  return hb;
}

type HumanMode = 'walk' | 'idle' | 'chat';

/** Foot placement for one leg: ankle target + foot pitch (positive = heel up). */
function footPlacement(
  rig: Rig,
  sb: HumanBones['side'][number],
  g: GaitParams,
  stride: number,
  u: number
): { ankle: THREE.Vector3; pitch: number } {
  const A0 = rig.head[sb.foot];
  const B0 = rig.head[sb.toe];
  const x = A0.x * g.footWidth;
  const ballC = new THREE.Vector3(x, 0, B0.z);
  const heelC = new THREE.Vector3(x, 0, A0.z - 0.06);
  const restAnkle = new THREE.Vector3(x, A0.y, A0.z);
  const zc = B0.z;
  const travel = g.duty * stride;
  let z: number;
  let h: number;
  let pitch: number;
  if (u < g.duty) {
    const s = u / g.duty;
    z = zc + travel / 2 - s * travel;
    h = 0;
    if (s < 0.16) pitch = -g.heelStrike * Math.pow(1 - s / 0.16, 1.5);
    else if (s > 0.55) pitch = g.toeOff * Math.pow((s - 0.55) / 0.45, 1.7);
    else pitch = 0;
  } else {
    const s = (u - g.duty) / (1 - g.duty);
    const e = s * s * (3 - 2 * s);
    z = zc - travel / 2 + e * travel;
    h = g.lift * Math.pow(Math.sin(Math.PI * s), 1.3) * (1 - 0.35 * s);
    pitch = g.toeOff * (1 - smooth(0, 0.55, s)) - g.heelStrike * smooth(0.45, 1, s);
  }
  const q = qx(pitch);
  if (pitch >= 0) {
    const pivot = new THREE.Vector3(x, h, z);
    return { ankle: restAnkle.clone().sub(ballC).applyQuaternion(q).add(pivot), pitch };
  }
  const pivot = new THREE.Vector3(x, h, z - (ballC.z - heelC.z));
  return { ankle: restAnkle.clone().sub(heelC).applyQuaternion(q).add(pivot), pitch };
}

/**
 * Human pose at cycle position u (0..1) of the given mode. `extraDrop` lowers the pelvis (auto-fitted so the legs
 * never over-extend). Returns the largest IK over-reach (m) for the fit.
 */
function humanPose(pose: Pose, hb: HumanBones, g: GaitParams, stride: number, mode: HumanMode, u: number, extraDrop: number): number {
  const rig = pose.rig;
  const walk = mode === 'walk';
  const ph = TAU * u;
  // ---- pelvis ----
  let yaw = 0;
  let roll = 0;
  const off = new THREE.Vector3();
  let breathe = 0;
  let headYaw = 0;
  let headPitch = 0;
  if (walk) {
    yaw = -g.yaw * Math.cos(ph);
    roll = g.roll * Math.sin(ph);
    off.set(g.sway * Math.sin(ph), -g.drop - extraDrop + g.bob * Math.cos(2 * TAU * (u - 0.3)), 0);
    headPitch = 1.5 * DEG * Math.cos(2 * TAU * (u - 0.3));
  } else {
    // weight shift, breathing, looking around (loops are seamless in u)
    off.set(0.012 * Math.sin(ph), -0.012 - extraDrop - 0.003 * Math.sin(2 * ph), 0.004 * Math.sin(ph + 1));
    roll = 1.2 * DEG * Math.sin(ph);
    yaw = 2 * DEG * Math.sin(ph + 0.6);
    breathe = 1.1 * DEG * Math.sin(2 * ph);
    headYaw = (mode === 'chat' ? 9 : 16) * DEG * Math.sin(ph + 0.3) + (mode === 'chat' ? 4 * DEG * Math.sin(3 * ph) : 0);
    headPitch = mode === 'chat' ? 4 * DEG * Math.sin(4 * ph) : 2 * DEG * Math.sin(2 * ph + 1);
  }
  pose.root(hb.hips, qmul(qy(yaw), qz(roll)), off);
  // ---- spine / chest / head ----
  const lean = g.lean + (walk ? 0 : -g.lean * 0.6);
  pose.fk(hb.spine, qmul(qy(-0.5 * yaw), qx(lean * 0.5 + g.stoop * 0.35)));
  pose.fk(hb.chest, qmul(qy(-1.0 * yaw), qx(lean * 0.5 + g.stoop * 0.65 + breathe), qz(-0.6 * roll)));
  pose.fk(hb.neck, qmul(qy(headYaw * 0.4 + 0.3 * yaw), qx(-(lean + g.stoop) * 0.45)));
  pose.fk(hb.head, qmul(qy(headYaw * 0.6 + 0.2 * yaw), qx(-(lean + g.stoop) * 0.45 + headPitch)));
  // ---- legs ----
  let reach = 0;
  const stretch = { value: 0 };
  for (const sb of hb.side) {
    pose.fk(sb.thigh, new THREE.Quaternion()); // places the hip joint
    let ankle: THREE.Vector3;
    let pitch: number;
    if (walk) {
      const fp = footPlacement(rig, sb, g, stride, (u + (sb.s > 0 ? 0 : 0.5)) % 1);
      ankle = fp.ankle;
      pitch = fp.pitch;
    } else {
      const A0 = rig.head[sb.foot];
      ankle = new THREE.Vector3(A0.x * 1.12, A0.y, A0.z + (sb.s > 0 ? 0.03 : -0.02));
      pitch = 0;
    }
    const pole = new THREE.Vector3(sb.s * 0.12, 0, 1).normalize();
    const end = twoBoneIK(pose, sb.thigh, sb.shin, sb.foot, ankle, pole, stretch);
    reach = Math.max(reach, stretch.value);
    // feet point straight ahead (slightly turned out when standing)
    const footQ = qmul(qy(walk ? 0 : sb.s * 7 * DEG), qx(pitch));
    pose.set(sb.foot, footQ, end);
    const toeQ = pitch > 0 ? qy(walk ? 0 : sb.s * 7 * DEG) : footQ;
    pose.fkWorld(sb.toe, toeQ);
  }
  // ---- arms ----
  for (const sb of hb.side) {
    const left = sb.s > 0;
    const legPhase = TAU * (u - g.armLag);
    // arm swings opposite to the leg of its side: left arm back while the left foot is forward (u = 0)
    let swing = walk ? g.armSwing * (left ? Math.cos(legPhase) : -Math.cos(legPhase)) : 0;
    let abd = sb.s * 5 * DEG;
    let elbow = g.elbowBase + (walk ? g.elbowSwing * Math.max(0, -swing / Math.max(g.armSwing, 1e-6)) : 0);
    let handUpright = false;
    if (!walk) {
      swing = 1.5 * DEG * Math.sin(ph + (left ? 0 : 1.5));
      elbow = g.elbowBase * 0.8 + 2 * DEG * Math.sin(ph);
    }
    if ((g.carryR && !left) || (g.carryL && left)) {
      swing = walk ? swing * 0.25 : swing * 0.5;
      abd = sb.s * 9 * DEG;
      elbow = 6 * DEG;
      handUpright = true;
    } else if (g.leashL && left) {
      swing = -24 * DEG + (walk ? 3 * DEG * Math.cos(legPhase) : 1.5 * DEG * Math.sin(ph));
      abd = sb.s * 8 * DEG;
      elbow = 52 * DEG;
    }
    if (mode === 'chat' && !left && !g.carryR) {
      // talking with the right hand: forearm up, small beats
      const beat = Math.max(0, Math.sin(2 * ph)) * 0.6 + 0.4 * Math.max(0, Math.sin(3 * ph + 1));
      swing = -(10 + 12 * beat) * DEG;
      abd = sb.s * 10 * DEG;
      elbow = (55 + 30 * beat) * DEG;
    } else if (mode === 'chat' && left && !g.carryL && !g.leashL) {
      elbow = (16 + 8 * Math.max(0, Math.sin(ph + 2))) * DEG;
    }
    pose.fk(sb.upperarm, qmul(qx(swing), qz(abd)));
    pose.fk(sb.forearm, qmul(qx(-elbow), qy(-sb.s * 12 * DEG)));
    if (handUpright) {
      const pend = (walk ? 3.5 : 1) * DEG * Math.sin(TAU * (u - 0.12));
      pose.fkWorld(sb.hand, qmul(qy(yaw * 0.5), qx(pend)));
    } else {
      pose.fk(sb.hand, qmul(qx(-6 * DEG), qz(-sb.s * 4 * DEG)));
    }
  }
  return reach;
}

// ---------------------------------------------------------------------------------------------------------------
// dog gait (trot)
// ---------------------------------------------------------------------------------------------------------------

interface DogBones {
  hips: number;
  spine: number;
  chest: number;
  neck: number;
  head: number;
  tail1: number;
  tail2: number;
  front: { s: number; upper: number; fore: number; paw: number; phase: number }[];
  hind: { s: number; thigh: number; shin: number; meta: number; phase: number }[];
}

function dogBones(rig: Rig): DogBones {
  const db: DogBones = {
    hips: rig.idx('d_hips'),
    spine: rig.idx('d_spine'),
    chest: rig.idx('d_chest'),
    neck: rig.idx('d_neck'),
    head: rig.idx('d_head'),
    tail1: rig.idx('d_tail1'),
    tail2: rig.idx('d_tail2'),
    // trot: diagonal pairs move together (left fore + right hind, then right fore + left hind)
    front: [
      { s: 1, upper: rig.idx('d_fupper_L'), fore: rig.idx('d_ffore_L'), paw: rig.idx('d_fpaw_L'), phase: 0 },
      { s: -1, upper: rig.idx('d_fupper_R'), fore: rig.idx('d_ffore_R'), paw: rig.idx('d_fpaw_R'), phase: 0.5 },
    ],
    hind: [
      { s: 1, thigh: rig.idx('d_hthigh_L'), shin: rig.idx('d_hshin_L'), meta: rig.idx('d_hmeta_L'), phase: 0.5 },
      { s: -1, thigh: rig.idx('d_hthigh_R'), shin: rig.idx('d_hshin_R'), meta: rig.idx('d_hmeta_R'), phase: 0 },
    ],
  };
  if (db.hips !== 0) throw new Error('[pedestrians] dog skeleton: "d_hips" must be the root bone');
  return db;
}

function dogPose(pose: Pose, db: DogBones, stride: number, mode: HumanMode, u: number, extraDrop: number): number {
  const rig = pose.rig;
  const walk = mode === 'walk';
  const ph = TAU * u;
  const duty = 0.5;
  const off = new THREE.Vector3(0, -0.012 - extraDrop, 0);
  let headPitch = 0;
  let headYaw = 0;
  let wag = 0;
  if (walk) {
    off.y += 0.012 * Math.cos(2 * ph);
    headPitch = 3 * DEG * Math.cos(2 * ph + 0.5);
    wag = 18 * DEG * Math.sin(ph);
  } else if (mode === 'idle') {
    headYaw = 28 * DEG * Math.sin(ph) + 8 * DEG * Math.sin(3 * ph);
    headPitch = 5 * DEG * Math.sin(2 * ph);
    wag = 22 * DEG * Math.sin(4 * ph);
  } else {
    // sniffing the ground
    headPitch = (34 + 6 * Math.sin(5 * ph)) * DEG;
    headYaw = 14 * DEG * Math.sin(ph);
    wag = 25 * DEG * Math.sin(5 * ph);
  }
  pose.root(db.hips, qy(walk ? 2 * DEG * Math.sin(ph) : 0), off);
  pose.fk(db.spine, qy(walk ? -1.5 * DEG * Math.sin(ph) : 0));
  pose.fk(db.chest, qx(walk ? 1 * DEG * Math.sin(2 * ph) : 0));
  pose.fk(db.neck, qmul(qy(headYaw * 0.5), qx(headPitch * 0.6)));
  pose.fk(db.head, qmul(qy(headYaw * 0.5), qx(headPitch * 0.4)));
  pose.fk(db.tail1, qmul(qy(wag), qx(-8 * DEG)));
  pose.fk(db.tail2, qy(wag * 0.7));

  let reach = 0;
  const stretch = { value: 0 };
  const travel = duty * stride;
  const legTarget = (contactRest: THREE.Vector3, lu: number, lift: number): { c: THREE.Vector3; flex: number } => {
    let z: number;
    let h: number;
    let flex: number;
    if (!walk) return { c: contactRest.clone(), flex: 0 };
    if (lu < duty) {
      const s = lu / duty;
      z = contactRest.z + travel / 2 - s * travel;
      h = 0;
      flex = 0;
    } else {
      const s = (lu - duty) / (1 - duty);
      const e = s * s * (3 - 2 * s);
      z = contactRest.z - travel / 2 + e * travel;
      h = lift * Math.sin(Math.PI * s);
      flex = Math.sin(Math.PI * s);
    }
    return { c: new THREE.Vector3(contactRest.x, contactRest.y + h, z), flex };
  };
  for (const f of db.front) {
    pose.fk(f.upper, new THREE.Quaternion());
    const pawTip = rig.tail[f.paw];
    const contactRest = new THREE.Vector3(pawTip.x, 0.0, pawTip.z);
    const { c, flex } = legTarget(contactRest, (u + f.phase) % 1, 0.08);
    // wrist above the contact; during swing the paw folds back
    const pawQ = qx(flex * 55 * DEG);
    const wristRestOff = rig.head[f.paw].clone().sub(contactRest);
    const wrist = wristRestOff.clone().applyQuaternion(pawQ).add(c);
    const end = twoBoneIK(pose, f.upper, f.fore, f.paw, wrist, new THREE.Vector3(0, 0, -1), stretch);
    reach = Math.max(reach, stretch.value);
    pose.set(f.paw, pawQ, end);
  }
  for (const hlg of db.hind) {
    pose.fk(hlg.thigh, new THREE.Quaternion());
    const tip = rig.tail[hlg.meta];
    const contactRest = new THREE.Vector3(tip.x, 0.0, tip.z);
    const { c, flex } = legTarget(contactRest, (u + hlg.phase) % 1, 0.07);
    const metaQ = qx(-flex * 30 * DEG);
    const hockRestOff = rig.head[hlg.meta].clone().sub(contactRest);
    const hock = hockRestOff.clone().applyQuaternion(metaQ).add(c);
    const end = twoBoneIK(pose, hlg.thigh, hlg.shin, hlg.meta, hock, new THREE.Vector3(0, 0, 1), stretch);
    reach = Math.max(reach, stretch.value);
    pose.set(hlg.meta, metaQ, end);
  }
  return reach;
}

// ---------------------------------------------------------------------------------------------------------------
// bake
// ---------------------------------------------------------------------------------------------------------------

export interface AnimSet {
  /** first texture row of this set */
  rowBase: number;
  /** distance per gait cycle at scale 1 (m) */
  stride: number;
  style: AnimStyleName;
}

/** All baked poses of every model + the dog in one float texture (3 texels per bone and row). */
export class AnimBank {
  public readonly texture: THREE.DataTexture;
  public readonly data: Float32Array;
  public readonly width: number;
  public readonly rows: number;
  public readonly bonesPerRow: number;
  private readonly sets = new Map<string, AnimSet>();

  constructor(entries: { key: string; rig: Rig; anim: AnimSpec }[]) {
    if (entries.length === 0) throw new Error('[pedestrians] AnimBank: nothing to bake');
    this.bonesPerRow = Math.max(...entries.map((e) => e.rig.count));
    this.width = this.bonesPerRow * 3;
    this.rows = entries.length * ROWS_PER_SET;
    if (this.rows > 4096) throw new Error(`[pedestrians] AnimBank: ${this.rows} rows exceed the 4096 texture limit`);
    this.data = new Float32Array(this.width * this.rows * 4);
    entries.forEach((entry, i) => {
      const rowBase = i * ROWS_PER_SET;
      this.bakeSet(entry.rig, entry.anim, rowBase, entry.key);
      this.sets.set(entry.key, { rowBase, stride: entry.anim.stride, style: entry.anim.style });
    });
    this.texture = new THREE.DataTexture(this.data, this.width, this.rows, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.name = 'PedestrianBoneMatrices';
    this.texture.needsUpdate = true;
  }

  public set(key: string): AnimSet {
    const s = this.sets.get(key);
    if (!s) throw new Error(`[pedestrians] AnimBank: no baked set "${key}"`);
    return s;
  }

  private bakeSet(rig: Rig, anim: AnimSpec, rowBase: number, key: string): void {
    if (!(anim.stride > 0.3 && anim.stride < 3)) throw new Error(`[pedestrians] ${key}: implausible stride ${anim.stride}`);
    const pose = new Pose(rig);
    const isDog = anim.style === 'dog';
    const hb = isDog ? null : humanBones(rig);
    const db = isDog ? dogBones(rig) : null;
    const g = isDog ? null : gaitParams(anim.style);
    const evalPose = (mode: HumanMode, u: number, drop: number): number =>
      isDog ? dogPose(pose, db!, anim.stride, mode, u, drop) : humanPose(pose, hb!, g!, anim.stride, mode, u, drop);
    const modes: [HumanMode, number, number][] = [
      ['walk', WALK_FRAMES, 0],
      ['idle', IDLE_FRAMES, WALK_FRAMES],
      ['chat', CHAT_FRAMES, WALK_FRAMES + IDLE_FRAMES],
    ];
    for (const [mode, frames, rowOff] of modes) {
      // auto-fit the pelvis height so no frame over-extends a leg (feet would slide otherwise)
      let drop = 0;
      for (let iter = 0; iter < 4; iter++) {
        let worst = 0;
        for (let f = 0; f < frames; f++) worst = Math.max(worst, evalPose(mode, f / frames, drop));
        if (worst < 1e-4) break;
        drop += worst + 0.002;
      }
      for (let f = 0; f < frames; f++) {
        const reach = evalPose(mode, f / frames, drop);
        if (reach > 0.003) {
          throw new Error(`[pedestrians] ${key}: ${mode} frame ${f} cannot reach its foot target (${(reach * 100).toFixed(1)} cm short)`);
        }
        const row = rowBase + rowOff + f;
        const o = row * this.width * 4;
        pose.write(this.data, o);
      }
    }
  }

  /**
   * CPU copy of the shader's blend: bone matrix for (walk frame rows a0/a1 lerp fa) mixed with (b0/b1 lerp fb) by
   * `blend`, applied to a rest-pose point. Used for leash end points.
   */
  public transformPoint(bone: number, a0: number, a1: number, fa: number, b0: number, b1: number, fb: number, blend: number,
    p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    let x = 0;
    let y = 0;
    let z = 0;
    const rows = [a0, a1, b0, b1];
    const w = [(1 - fa) * (1 - blend), fa * (1 - blend), (1 - fb) * blend, fb * blend];
    for (let k = 0; k < 4; k++) {
      if (w[k] === 0) continue;
      const o = rows[k] * this.width * 4 + bone * 12;
      const d = this.data;
      x += w[k] * (d[o] * p.x + d[o + 1] * p.y + d[o + 2] * p.z + d[o + 3]);
      y += w[k] * (d[o + 4] * p.x + d[o + 5] * p.y + d[o + 6] * p.z + d[o + 7]);
      z += w[k] * (d[o + 8] * p.x + d[o + 9] * p.y + d[o + 10] * p.z + d[o + 11]);
    }
    return out.set(x, y, z);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// material
// ---------------------------------------------------------------------------------------------------------------

/** Fixed colours for slots 8..15 (sRGB hex), see blender/people/people_geo.py SLOT. */
const FIXED_SLOT_COLORS = ['#1b1917', '#d6d1c6', '#3b1d36', '#c58d4c', '#8d9094', '#9a5a52', '#141212', '#1b1917'];
/** Roughness per slot 0..15 (skin, hair, top, bottom, shoes, accA, accB, accC, dark, sole, grapes, bread, metal, lip, nose, -). */
const SLOT_ROUGHNESS = [0.55, 0.5, 0.86, 0.82, 0.48, 0.72, 0.7, 0.62, 0.42, 0.85, 0.32, 0.72, 0.35, 0.5, 0.3, 0.5];
const SLOT_METALNESS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.85, 0, 0, 0];

const PED_PARS = /* glsl */ `
uniform highp sampler2D pedBoneTex;
attribute vec4 pedBones;
attribute vec4 pedWeights;
attribute vec2 pedSlot;
attribute vec4 pedAnimA;
attribute vec4 pedAnimB;
vec4 pedRow( int col, vec4 anim ) {
  vec4 a = texelFetch( pedBoneTex, ivec2( col, int( anim.x ) ), 0 );
  vec4 b = texelFetch( pedBoneTex, ivec2( col, int( anim.y ) ), 0 );
  return mix( a, b, anim.z );
}
vec3 pedSkin( vec3 pos, inout vec3 nrm ) {
  vec4 m0 = vec4( 0.0 );
  vec4 m1 = vec4( 0.0 );
  vec4 m2 = vec4( 0.0 );
  for ( int i = 0; i < 4; i ++ ) {
    float w = pedWeights[ i ];
    if ( w <= 0.0 ) continue;
    int col = int( pedBones[ i ] + 0.5 ) * 3;
    m0 += w * mix( pedRow( col, pedAnimA ), pedRow( col, pedAnimB ), pedAnimA.w );
    m1 += w * mix( pedRow( col + 1, pedAnimA ), pedRow( col + 1, pedAnimB ), pedAnimA.w );
    m2 += w * mix( pedRow( col + 2, pedAnimA ), pedRow( col + 2, pedAnimB ), pedAnimA.w );
  }
  nrm = vec3( dot( m0.xyz, nrm ), dot( m1.xyz, nrm ), dot( m2.xyz, nrm ) );
  vec4 p = vec4( pos, 1.0 );
  return vec3( dot( m0, p ), dot( m1, p ), dot( m2, p ) );
}
`;

const PED_COLOR_PARS = /* glsl */ `
attribute vec4 pedColA;
attribute vec4 pedColB;
uniform vec3 pedFixed[ 8 ];
uniform float pedRough[ 16 ];
uniform float pedMetal[ 16 ];
varying vec3 vPedColor;
varying float vPedRough;
varying float vPedMetal;
vec3 pedSrgbToLinear( vec3 c ) {
  return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( 0.04045, c ) );
}
vec3 pedUnpack( float v ) {
  float r = floor( v / 65536.0 );
  float g = floor( ( v - r * 65536.0 ) / 256.0 );
  float b = v - r * 65536.0 - g * 256.0;
  return pedSrgbToLinear( vec3( r, g, b ) / 255.0 );
}
`;

const PED_COLOR_MAIN = /* glsl */ `
  {
    int slot = int( pedSlot.x + 0.5 );
    vec3 c;
    if ( slot < 4 ) c = pedUnpack( slot == 0 ? pedColA.x : slot == 1 ? pedColA.y : slot == 2 ? pedColA.z : pedColA.w );
    else if ( slot < 8 ) c = pedUnpack( slot == 4 ? pedColB.x : slot == 5 ? pedColB.y : slot == 6 ? pedColB.z : pedColB.w );
    else c = pedFixed[ slot - 8 ];
    vPedColor = c * pedSlot.y;
    vPedRough = pedRough[ slot ];
    vPedMetal = pedMetal[ slot ];
  }
`;

export interface PedMaterials {
  color: THREE.MeshStandardMaterial;
  depth: THREE.MeshDepthMaterial;
}

export function createPedMaterials(bank: AnimBank): PedMaterials {
  const boneUniform = { value: bank.texture };
  const fixed = FIXED_SLOT_COLORS.map((hex) => new THREE.Color(hex)); // THREE.Color converts sRGB hex to linear
  const color = new THREE.MeshStandardMaterial({ name: 'PedestrianMaterial', roughness: 0.8, metalness: 0 });
  color.onBeforeCompile = (shader) => {
    shader.uniforms.pedBoneTex = boneUniform;
    shader.uniforms.pedFixed = { value: fixed };
    shader.uniforms.pedRough = { value: SLOT_ROUGHNESS };
    shader.uniforms.pedMetal = { value: SLOT_METALNESS };
    const vs = shader.vertexShader;
    for (const anchor of ['#include <common>', '#include <beginnormal_vertex>', '#include <begin_vertex>']) {
      if (!vs.includes(anchor)) throw new Error(`[pedestrians] three.js vertex shader changed: "${anchor}" not found`);
    }
    shader.vertexShader = vs
      .replace('#include <common>', `#include <common>\n${PED_PARS}\n${PED_COLOR_PARS}`)
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 objectNormal = vec3( normal );\nvec3 pedPos = pedSkin( position, objectNormal );\n${PED_COLOR_MAIN}`
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = pedPos;');
    const fs = shader.fragmentShader;
    for (const anchor of ['#include <common>', '#include <color_fragment>', '#include <roughnessmap_fragment>', '#include <metalnessmap_fragment>']) {
      if (!fs.includes(anchor)) throw new Error(`[pedestrians] three.js fragment shader changed: "${anchor}" not found`);
    }
    shader.fragmentShader = fs
      .replace('#include <common>', '#include <common>\nvarying vec3 vPedColor;\nvarying float vPedRough;\nvarying float vPedMetal;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vPedColor;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vPedRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vPedMetal;');
  };
  color.customProgramCacheKey = () => 'kh-pedestrian-v1';

  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, name: 'PedestrianDepth' });
  depth.onBeforeCompile = (shader) => {
    shader.uniforms.pedBoneTex = boneUniform;
    const vs = shader.vertexShader;
    for (const anchor of ['#include <common>', '#include <begin_vertex>']) {
      if (!vs.includes(anchor)) throw new Error(`[pedestrians] three.js depth shader changed: "${anchor}" not found`);
    }
    shader.vertexShader = vs
      .replace('#include <common>', `#include <common>\n${PED_PARS}`)
      .replace('#include <begin_vertex>', 'vec3 pedN = vec3( 0.0, 1.0, 0.0 );\nvec3 transformed = pedSkin( position, pedN );');
  };
  depth.customProgramCacheKey = () => 'kh-pedestrian-depth-v1';
  return { color, depth };
}

/** sRGB hex "#rrggbb" -> 24-bit integer as float (exact in float32). */
export function packHex(hex: string): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`[pedestrians] palette colour "${hex}" is not #rrggbb`);
  return parseInt(hex.slice(1), 16);
}
