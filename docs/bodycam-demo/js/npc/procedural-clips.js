import { AnimationClip, Euler, Group, MathUtils, Matrix4, Quaternion, QuaternionKeyframeTrack,
  Vector3, VectorKeyframeTrack } from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { createTwoBoneIK } from '../fp/ik.js';

// Runtime-authored NPC clips for rigs that ship without animations (officer.glb placeholder).
// Character space: +Z forward, +Y up, +X the character's left. Metres, seconds, degrees.
// Pose fields for the right side are written like the left side and mirrored (x of positions,
// y/z of rotations), so symmetric poses use identical numbers.
export const NPC_PROCEDURAL_CONFIG = {
  fps: 30,
  // Holstered pistol in the rest pose: grip centre, muzzle tip, muzzle direction and slide top.
  pistol: { mesh: 'Pistol', grip: [-0.227, 0.985, -0.055], muzzle: [-0.227, 0.822, 0.016],
    forward: [0, -1, 0], up: [0, 0, 1] },
  // Hand frames in pistol space (X left, Y up, Z muzzle): wrist→knuckle and palm directions,
  // the hand-local palm point touching the grip and where it touches. Hand bones: +Y fingers, +Z palm.
  grips: {
    R: { fingers: [0, -0.34, 0.94], palm: [1, 0, 0], contact: [0, 0.065, 0.028], anchor: [-0.018, 0.004, 0] },
    // Support hand over the strong hand's fingers, thumb forward along the frame.
    L: { fingers: [-0.15, -0.72, 0.68], palm: [-1, 0.3, 0], contact: [0, 0.065, 0.028], anchor: [0.036, -0.012, 0.012] },
  },
  forearmTwist: 0.55,
  fingers: {
    relaxed: { Thumb: [[10, 0, 10], [10, 0, 0], [8, 0, 0]], Index: [14, 18, 8], Middle: [18, 22, 10],
      Ring: [22, 24, 10], Pinky: [26, 24, 10] },
    fist: { Thumb: [[40, 0, 35], [35, 0, 0], [30, 0, 0]], Index: [75, 90, 50], Middle: [80, 95, 50],
      Ring: [85, 95, 50], Pinky: [85, 90, 50] },
    open: { Thumb: [[5, 0, 15], [5, 0, 0], [5, 0, 0]], Index: [4, 4, 2], Middle: [5, 5, 2],
      Ring: [6, 6, 3], Pinky: [8, 6, 3] },
    trigger: { Thumb: [[30, 0, 20], [30, 0, 0], [25, 0, 0]], Index: [20, 25, 10], Middle: [75, 85, 35],
      Ring: [80, 85, 35], Pinky: [85, 80, 35] },
    support: { Thumb: [[30, 0, -25], [20, 0, 0], [10, 0, 0]], Index: [65, 75, 35], Middle: [75, 85, 35],
      Ring: [80, 85, 35], Pinky: [85, 80, 35] },
  },
};

const SIDES = { L: 'Left', R: 'Right' };
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const SPINE = [['Spine', 0.3], ['Spine1', 0.35], ['Spine2', 0.35]];
const TAU = Math.PI * 2, { sin, cos, exp, max, min } = Math;
const ZERO = [0, 0, 0];
const euler = new Euler();
const charQ = (e, out = new Quaternion()) =>
  out.setFromEuler(euler.set(MathUtils.degToRad(e[0]), MathUtils.degToRad(e[1]), MathUtils.degToRad(e[2]), 'YXZ'));
const mirrorRotation = e => [e[0], -e[1], -e[2]];
const mirrorPoint = v => [-v[0], v[1], v[2]];
const scaled = (e, s) => [e[0] * s, e[1] * s, e[2] * s];
const add = (a, b) => a.map((value, i) => value + b[i]);
const smooth = x => { x = MathUtils.clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const impulse = (t, peak) => { const x = max(0, t) / peak; return x * exp(1 - x); };
const wrap = x => ((x % 1) + 1) % 1;

/** Hand world rotation from wrist→knuckle (bone +Y) and palm (bone +Z) directions. */
function handBasis(fingers, palm, out = new Quaternion()) {
  const y = new Vector3(...fingers).normalize(), z = new Vector3(...palm);
  z.addScaledVector(y, -z.dot(y)).normalize();
  const x = new Vector3().crossVectors(y, z);
  return out.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

/** Clips with the animation contract names, plus where the drawn pistol sits in the right hand. */
export function buildProceduralNPCClips(source, { yaw = 0, config: overrides = {} } = {}) {
  const config = { ...NPC_PROCEDURAL_CONFIG, ...overrides };
  const poser = createPoser(source, yaw, config);
  if (poser.missing) return { clips: [], pistol: null, missing: poser.missing };
  const clips = Object.entries(CLIPS).map(([name, { duration, loop, pose, keys }]) =>
    poser.sample(name, duration, keys ? keyed(poser.ground(fillKeys(keys))) : pose, loop));
  const pistol = poser.pistolInHand();
  poser.dispose();
  return { clips, pistol, missing: [] };
}

function createPoser(source, yaw, config) {
  const root = new Group(), model = cloneSkeleton(source);
  model.rotation.y = yaw;
  root.add(model);
  root.updateWorldMatrix(true, true);
  const bones = new Map();
  model.traverse(node => { if (node.isBone && !bones.has(node.name)) bones.set(node.name, node); });
  const required = ['Hips', 'Neck', 'Head', ...SPINE.map(([name]) => name), ...Object.values(SIDES).flatMap(prefix =>
    ['Shoulder', 'Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot'].map(part => `${prefix}${part}`))];
  const missing = required.filter(name => !bones.has(name));
  if (missing.length) return { missing };
  const bone = name => bones.get(name);
  const rest = new Map();
  for (const node of bones.values())
    rest.set(node, { position: node.position.clone(), quaternion: node.quaternion.clone(),
      worldQ: node.getWorldQuaternion(new Quaternion()) });
  const hips = bone('Hips'), hipsParentInverse = hips.parent.getWorldQuaternion(new Quaternion()).invert();
  const legs = {}, arms = {}, fingerRotations = {};
  for (const [side, prefix] of Object.entries(SIDES)) {
    legs[side] = createTwoBoneIK({ upper: bone(`${prefix}UpLeg`), lower: bone(`${prefix}Leg`), hand: bone(`${prefix}Foot`) });
    arms[side] = createTwoBoneIK({ upper: bone(`${prefix}Arm`), lower: bone(`${prefix}ForeArm`), hand: bone(`${prefix}Hand`) });
    fingerRotations[side] = new Map();
  }
  const grips = Object.fromEntries(Object.entries(config.grips).map(([side, grip]) => {
    const quaternion = handBasis(grip.fingers, grip.palm);
    const position = new Vector3(...grip.anchor).sub(new Vector3(...grip.contact).applyQuaternion(quaternion));
    return [side, { quaternion, position }];
  }));
  const q = new Quaternion(), q2 = new Quaternion(), v = new Vector3(), v2 = new Vector3(), pole = new Vector3();
  const target = new Vector3(), gunQ = new Quaternion(), gunP = new Vector3();
  // Sampled surface points per body part, for floor contact. Skinned points follow their dominant bone.
  const groupOf = name => /^(Left|Right)(Arm|ForeArm|Hand)/.test(name) ? `${name.startsWith('Left') ? 'L' : 'R'}Arm`
    : /^(Left|Right)(UpLeg|Leg|Foot|Toe)/.test(name) ? `${name.startsWith('Left') ? 'L' : 'R'}Leg`
    : /^Head/.test(name) ? 'Head' : 'Torso';
  const surface = { Torso: [], Head: [], LArm: [], RArm: [], LLeg: [], RLeg: [], LArmEnd: [], RArmEnd: [], LLegEnd: [], RLegEnd: [] };
  const distal = name => /^(Left|Right)(ForeArm|Hand|Leg|Foot|Toe)/.test(name);
  model.traverse(mesh => {
    if (!mesh.isMesh) return;
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
    let owner = mesh.parent;
    while (owner && !owner.isBone) owner = owner.parent;
    for (let i = 0; i < position.count; i += 12) {
      let name = owner?.name ?? 'Hips';
      if (mesh.isSkinnedMesh) {
        let best = 0;
        for (let k = 1; k < 4; k++) if (skinWeight.getComponent(i, k) > skinWeight.getComponent(i, best)) best = k;
        name = mesh.skeleton.bones[skinIndex.getComponent(i, best)]?.name ?? name;
      }
      surface[groupOf(name)].push(mesh, i);
      if (distal(name)) surface[`${groupOf(name)}End`].push(mesh, i);
    }
  });
  function lowest(group) {
    const list = surface[group];
    let y = Infinity;
    for (let k = 0; k < list.length; k += 2) {
      const mesh = list[k];
      if (mesh.isSkinnedMesh) mesh.getVertexPosition(list[k + 1], v2); else v2.fromBufferAttribute(mesh.geometry.attributes.position, list[k + 1]);
      y = min(y, v2.applyMatrix4(mesh.matrixWorld).y);
    }
    return y;
  }
  // Soles sit above the rig origin in the bind pose; poses are authored against the real floor.
  const soleHeight = min(lowest('LLeg'), lowest('RLeg'));

  // Rotation about character axes as they were in the rest pose, applied after the parent.
  function fk(node, angles) {
    if (!node || !angles || (!angles[0] && !angles[1] && !angles[2])) return;
    const { worldQ } = rest.get(node);
    charQ(angles, q);
    node.quaternion.multiply(q2.copy(worldQ).invert().multiply(q).multiply(worldQ));
  }
  function fingerPreset(side, name) {
    let list = fingerRotations[side].get(name);
    if (list) return list;
    list = [];
    for (const finger of FINGERS) {
      const values = config.fingers[name]?.[finger];
      if (!values) continue;
      for (let index = 0; index < 3; index++) {
        const node = bone(`${SIDES[side]}Hand${finger}${index + 1}`);
        if (!node) continue;
        const angles = Array.isArray(values[index]) ? [...values[index]] : [values[index], 0, 0];
        if (side === 'R') { angles[1] = -angles[1]; angles[2] = -angles[2]; }
        list.push([node, new Quaternion().setFromEuler(new Euler(...angles.map(MathUtils.degToRad), 'XYZ'))]);
      }
    }
    fingerRotations[side].set(name, list);
    return list;
  }
  // Pronation/supination: the twist bone takes a share of the hand's roll around the forearm.
  function forearmTwist(prefix) {
    const twistBone = bone(`${prefix}ForeArmTwist`), hand = bone(`${prefix}Hand`);
    if (!twistBone || !(config.forearmTwist > 0)) return;
    q.copy(rest.get(hand).quaternion).invert().premultiply(hand.quaternion);
    v.copy(hand.position).normalize();
    const along = q.x * v.x + q.y * v.y + q.z * v.z;
    q.set(v.x * along, v.y * along, v.z * along, q.w);
    if (q.lengthSq() < 1e-12) return;
    q.normalize();
    twistBone.quaternion.copy(q2.identity().slerp(q, config.forearmTwist)).multiply(rest.get(twistBone).quaternion);
  }

  function apply(pose) {
    for (const [node, transform] of rest) {
      node.position.copy(transform.position); node.quaternion.copy(transform.quaternion);
    }
    v.fromArray(pose.hips ?? ZERO).y -= soleHeight;
    hips.position.add(v.applyQuaternion(hipsParentInverse));
    fk(hips, pose.hipsRot);
    const spine = pose.spine ?? ZERO, head = pose.head ?? ZERO;
    for (const [name, share] of SPINE) fk(bone(name), scaled(spine, share));
    fk(bone('Neck'), scaled(head, 0.4)); fk(bone('Head'), scaled(head, 0.6));
    for (const [side, prefix] of Object.entries(SIDES)) {
      const field = name => pose[`${side}${name}`];
      const rotation = name => field(name) && (side === 'R' ? mirrorRotation(field(name)) : field(name));
      fk(bone(`${prefix}Shoulder`), rotation('Clav'));
      fk(bone(`${prefix}Arm`), rotation('Arm'));
      fk(bone(`${prefix}ForeArm`), rotation('Fore'));
      fk(bone(`${prefix}Hand`), rotation('Hand'));
      fk(bone(`${prefix}UpLeg`), rotation('UpLeg'));
      fk(bone(`${prefix}Leg`), rotation('Leg'));
      fk(bone(`${prefix}Foot`), rotation('FootFK'));
    }
    root.updateWorldMatrix(true, true);
    for (const [side, prefix] of Object.entries(SIDES)) {
      const weight = pose[`${side}LegIK`] ?? 0;
      if (!(weight > 0)) continue;
      const mirror = side === 'R' ? mirrorPoint : value => value;
      const foot = pose[`${side}Foot`] ?? ZERO;
      target.fromArray(mirror(pose[`${side}Ankle`])).y -= soleHeight;
      const footQ = charQ(side === 'R' ? mirrorRotation(foot) : foot, new Quaternion())
        .multiply(rest.get(bone(`${prefix}Foot`)).worldQ);
      // Knees follow the foot's heading, slightly outward, unless a pose says otherwise.
      const knee = new Vector3(...mirror(pose[`${side}Knee`] ?? [0.12, 0, 1]));
      if (!pose[`${side}Knee`]) knee.applyAxisAngle(v2.set(0, 1, 0), MathUtils.degToRad(side === 'R' ? -foot[1] : foot[1]));
      bone(`${prefix}UpLeg`).getWorldPosition(pole).add(target).multiplyScalar(0.5).addScaledVector(knee.normalize(), 0.6);
      legs[side].solve(target, pole, footQ, weight);
    }
    const hold = pose.gunHold ?? 0;
    if (hold > 0) {
      charQ(pose.gunRot ?? ZERO, gunQ); gunP.fromArray(pose.gun).y -= soleHeight;
    }
    for (const [side, prefix] of Object.entries(SIDES)) {
      const mirror = side === 'R' ? mirrorPoint : value => value;
      const shoulder = bone(`${prefix}Arm`).getWorldPosition(new Vector3());
      const elbow = new Vector3(...mirror(pose[`${side}Elbow`] ?? [0.35, -0.5, -0.25])).normalize();
      pole.copy(shoulder).addScaledVector(elbow, 0.5);
      let weight = 0, rotation = null;
      if (hold > 0) {
        weight = hold;
        rotation = new Quaternion().copy(gunQ).multiply(grips[side].quaternion);
        target.copy(grips[side].position).applyQuaternion(gunQ).add(gunP);
      } else if (pose[`${side}Reach`] && (pose[`${side}ArmIK`] ?? 1) > 0) {
        weight = pose[`${side}ArmIK`] ?? 1;
        target.fromArray(mirror(pose[`${side}Reach`])).y -= soleHeight;
        if (pose[`${side}Palm`])
          rotation = handBasis(mirror(pose[`${side}FingerDir`] ?? [0, -1, 0]), mirror(pose[`${side}Palm`]));
      }
      if (!(weight > 0)) continue;
      arms[side].solve(target, pole, rotation, weight);
      if (rotation) forearmTwist(prefix);
    }
    for (const side of Object.keys(SIDES))
      for (const [node, rotation] of fingerPreset(side, pose[`${side}Fingers`] ?? 'relaxed')) node.quaternion.multiply(rotation);
    root.updateWorldMatrix(true, true);
  }

  function sample(name, duration, pose, loop) {
    const frames = max(2, Math.round(duration * config.fps) + 1);
    const times = new Float32Array(frames), records = new Map(), hipsPositions = new Float32Array(frames * 3);
    for (const node of rest.keys()) records.set(node, new Float32Array(frames * 4));
    for (let frame = 0; frame < frames; frame++) {
      const time = duration * frame / (frames - 1);
      times[frame] = time;
      apply(pose(loop && frame === frames - 1 ? 0 : time, duration));
      for (const [node, values] of records) {
        node.quaternion.toArray(values, frame * 4);
        if (frame) { // Shortest-path interpolation between neighbouring samples.
          const o = frame * 4, p = o - 4;
          if (values[o] * values[p] + values[o + 1] * values[p + 1] + values[o + 2] * values[p + 2] + values[o + 3] * values[p + 3] < 0)
            for (let k = 0; k < 4; k++) values[o + k] = -values[o + k];
        }
      }
      hips.position.toArray(hipsPositions, frame * 3);
    }
    const tracks = [new VectorKeyframeTrack(`${hips.name}.position`, times, hipsPositions)];
    for (const [node, values] of records) {
      const restQ = rest.get(node).quaternion;
      let moves = false;
      for (let o = 0; o < values.length && !moves; o += 4)
        moves = Math.abs(values[o] * restQ.x + values[o + 1] * restQ.y + values[o + 2] * restQ.z + values[o + 3] * restQ.w) < 0.999999;
      if (moves) tracks.push(new QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values));
    }
    return new AnimationClip(name, duration, tracks);
  }

  // The drawn pistol's transform in RightHand space, from the holster pose and the right grip frame.
  function pistolInHand() {
    apply({});
    const mesh = model.getObjectByName(config.pistol.mesh), hand = bone('RightHand');
    if (!mesh?.isMesh) return null;
    const { grip, muzzle, forward, up } = config.pistol;
    const z = new Vector3(...forward).normalize(), y = new Vector3(...up).normalize();
    const holster = new Matrix4().makeBasis(new Vector3().crossVectors(y, z), y, z).setPosition(...grip);
    const handScale = hand.getWorldScale(new Vector3());
    const handInGun = new Matrix4().compose(grips.R.position, grips.R.quaternion, handScale);
    const toHand = holster.multiply(handInGun).invert();
    return { mesh: config.pistol.mesh, matrix: toHand.clone().multiply(mesh.matrixWorld),
      muzzle: new Vector3(...muzzle).applyMatrix4(toHand),
      forward: new Vector3(0, 0, 1).applyQuaternion(grips.R.quaternion.clone().invert()) };
  }
  // Lying keys: torso exactly on the floor ('rest') or at least out of it ('clear'); limbs and head
  // are nudged by coordinate descent on their own pose fields until they touch instead of sinking.
  const LIMBS = [['Head', ['head']], ['LArm', ['LArm', 'LFore']], ['RArm', ['RArm', 'RFore']],
    ['LLeg', ['LUpLeg', 'LLeg']], ['RLeg', ['RUpLeg', 'RLeg']]];
  const CONTACT = 0.004;
  function ground(keys) {
    for (const key of keys) {
      if (!key.floor) continue;
      const pose = key.pose = Object.fromEntries(Object.entries(key.pose).map(([name, value]) =>
        [name, Array.isArray(value) ? [...value] : value]));
      apply(pose);
      const torso = lowest('Torso');
      if (key.floor === 'rest' || torso < CONTACT) pose.hips = add(pose.hips, [0, CONTACT - torso, 0]);
      for (const [group, fields] of LIMBS) {
        const original = fields.map(name => [...pose[name]]);
        const resting = key.floor === 'rest';
        const cost = () => {
          apply(pose);
          let drift = 0;
          fields.forEach((name, f) => pose[name].forEach((value, i) => { drift += (value - original[f][i]) ** 2; }));
          // Resting limbs lie with forearm/hand or shin/foot on the floor, the head on its side; nothing sinks in.
          const sink = max(0, CONTACT - lowest(group)) * 3;
          return sink + (resting ? Math.abs(lowest(surface[`${group}End`] ? `${group}End` : group) - CONTACT) : 0) + drift * 1e-5;
        };
        let best = cost();
        if (best < 1e-4) continue;
        for (const step of [8, 4, 2, 1]) {
          for (let sweep = 0, improved = true; improved && sweep < 6; sweep++) {
            improved = false;
            for (const name of fields) for (const i of [0, 2]) for (const sign of [1, -1]) {
              pose[name][i] += sign * step;
              const value = cost();
              if (value < best - 1e-6) { best = value; improved = true; } else pose[name][i] -= sign * step;
            }
          }
        }
      }
    }
    return keys;
  }
  function dispose() {
    model.traverse(node => { if (node.isSkinnedMesh) node.skeleton.dispose(); });
  }
  return { sample, pistolInHand, ground, dispose };
}

// Keyed partial poses as full poses; fields carry forward. [time, pose, stop, floor]
function fillKeys(keys) {
  const fields = [...new Set(keys.flatMap(([, pose]) => Object.keys(pose)))];
  let carried = {};
  const filled = keys.map(([time, pose, stop, floor]) => ({ time, pose: carried = { ...carried, ...pose }, stop: !!stop, floor }));
  for (const field of fields) {
    const first = filled.find(key => key.pose[field] !== undefined).pose[field];
    for (const key of filled) key.pose[field] ??= first;
  }
  return filled;
}

// Hermite interpolation through filled keys; `stop` keys halt motion.
function keyed(filled) {
  const fields = Object.keys(filled[0].pose);
  const last = filled.at(-1);
  const lerpField = (a, b, f) => Array.isArray(a) ? a.map((value, i) => f(value, b[i], i)) : f(a, b);
  return time => {
    if (time <= filled[0].time) return filled[0].pose;
    if (time >= last.time) return last.pose;
    let i = 0;
    while (time > filled[i + 1].time) i++;
    const k0 = filled[i - 1], k1 = filled[i], k2 = filled[i + 1], k3 = filled[i + 2];
    const h = k2.time - k1.time, u = (time - k1.time) / h, u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = 3 * u2 - 2 * u3, h11 = u3 - u2;
    const out = {};
    for (const field of fields) {
      const a = k1.pose[field], b = k2.pose[field];
      if (typeof a !== 'number' && !Array.isArray(a)) { out[field] = u < 1 ? a : b; continue; }
      const slope = (key, previous, next, index) => key.stop || !previous || !next ? 0 :
        (index === undefined ? next.pose[field] - previous.pose[field] : next.pose[field][index] - previous.pose[field][index])
          / (next.time - previous.time);
      out[field] = lerpField(a, b, (p1, p2, index) =>
        h00 * p1 + h10 * h * slope(k1, k0, k2, index) + h01 * p2 + h11 * h * slope(k2, k1, k3, index));
    }
    return out;
  };
}

// Ankle target and foot rotation for a ground point; heel lift pivots on the ball, toe lift on the heel.
const BALL = [0, -0.054, 0.131], HEEL = [0, -0.09, -0.07];
function plant(x, z, lift, pitch, yaw) {
  const pivot = pitch >= 0 ? BALL : HEEL, angle = MathUtils.degToRad(pitch);
  const a = -pivot[1], b = -pivot[2];
  return { ankle: [x, 0.112 + lift + pivot[1] + a * cos(angle) - b * sin(angle), z + pivot[2] + a * sin(angle) + b * cos(angle)],
    foot: [pitch, yaw, 0] };
}

const STANCE = {
  hips: [0, -0.018, 0], hipsRot: ZERO, spine: ZERO, head: [3, 0, 0],
  LArm: [-3, 0, -13], RArm: [-4, 0, -13], LFore: [-14, 0, 0], RFore: [-12, 0, 0],
  LAnkle: [0.12, 0.112, 0.035], RAnkle: [0.13, 0.112, -0.03], LFoot: [0, -4, 0], RFoot: [0, -6, 0],
  LLegIK: 1, RLegIK: 1, LFingers: 'relaxed', RFingers: 'relaxed',
};

function gait(t, T, { stance, front, back, lift, heelStrike, toeOff, width, yaw }) {
  const foot = phase => {
    const ph = wrap(phase);
    let z, up = 0, pitch;
    if (ph < stance) {
      const u = ph / stance;
      z = front - (front - back) * u;
      pitch = u < 0.15 ? heelStrike * (1 - u / 0.15) ** 2 : u > 0.6 ? toeOff * ((u - 0.6) / 0.4) ** 2 : 0;
    } else {
      const u = (ph - stance) / (1 - stance);
      z = back + (front - back) * smooth(u);
      up = lift * sin(Math.PI * u ** 0.75);
      pitch = MathUtils.lerp(toeOff, heelStrike, smooth(u * 1.15));
    }
    return plant(width, z, up, pitch, yaw);
  };
  const p = t / T, left = foot(p), right = foot(p + 0.5);
  return { p, LAnkle: left.ankle, LFoot: left.foot, RAnkle: right.ankle, RFoot: right.foot, LLegIK: 1, RLegIK: 1 };
}

function aimPose(t) {
  const p = t / 2.4, s = sin(TAU * p), c = cos(TAU * p);
  return {
    hips: [0.004 * s, -0.05, -0.02], hipsRot: [5, 0, 0], spine: [7 + 0.6 * s, 0, 0], head: [5, 0, 0],
    LAnkle: [0.14, 0.112, 0.11], RAnkle: [0.15, 0.112, -0.12], LFoot: [0, -6, 0], RFoot: [0, 4, 0], LLegIK: 1, RLegIK: 1,
    gunHold: 1, gun: [-0.03, 1.39 + 0.003 * s, 0.50], gunRot: [-0.6 * c, 0.4 * s, 0],
    LElbow: [0.6, -0.7, -0.1], RElbow: [0.6, -0.7, -0.1], LFingers: 'support', RFingers: 'trigger',
  };
}

const DEATH_START = { ...STANCE, LUpLeg: ZERO, RUpLeg: ZERO, LLeg: ZERO, RLeg: ZERO, LFootFK: ZERO, RFootFK: ZERO };
const DEATH_BACKWARD = [
  [0, DEATH_START],
  [0.12, { hips: [0, -0.05, -0.07], hipsRot: [-10, 6, 0], spine: [-20, 10, 4], head: [-22, 6, 0],
    LArm: [-35, 0, -5], RArm: [-45, 0, 0], LFore: [-50, 0, 0], RFore: [-40, 0, 0] }],
  [0.45, { hips: [0.02, -0.32, -0.1], hipsRot: [-18, 10, 5], spine: [-8, 6, 6], head: [8, 10, 0],
    LArm: [-10, 0, -20], RArm: [-15, 0, -15], LFore: [-30, 0, 0], RFore: [-25, 0, 0] }],
  [0.78, { hips: [0.03, -0.62, -0.32], hipsRot: [-52, 12, 8], spine: [-14, 6, 4], head: [-15, 15, 0],
    LArm: [-70, 0, 30], RArm: [-60, 0, 25], LLegIK: 0.6, RLegIK: 0.6,
    LUpLeg: [-35, 0, 0], LLeg: [60, 0, 0], RUpLeg: [-25, 0, 0], RLeg: [40, 0, 0] }],
  [1.0, { hips: [0.04, -0.86, -0.46], hipsRot: [-86, 12, 8], spine: [-4, 4, 4], head: [-8, 20, 0],
    LArm: [-30, 0, 70], RArm: [-20, 0, 60], LFore: [-30, 0, 0], RFore: [-20, 0, 0], LLegIK: 0, RLegIK: 0,
    LUpLeg: [-25, 0, 0], LLeg: [55, 0, 0], RUpLeg: [-10, 0, 0], RLeg: [20, 0, 0] }, true, 'rest'],
  [1.12, { hips: [0.04, -0.835, -0.465], hipsRot: [-82, 12, 8], head: [-14, 24, 0] }, false, 'clear'],
  [1.35, { hips: [0.04, -0.875, -0.47], hipsRot: [-90, 12, 8], spine: [-2, 4, 4], head: [5, 28, 0],
    LArm: [-10, 0, 80], RArm: [-5, 0, 70], LFore: [-25, 0, 0], RFore: [-35, 0, 0],
    LUpLeg: [-20, 0, 0], LLeg: [48, 0, 0], RUpLeg: [-4, 0, 0], RLeg: [12, 0, 0],
    LFootFK: [25, 0, 0], RFootFK: [20, 0, 0] }, true, 'rest'],
];
const DEATH_FORWARD = [
  [0, { ...DEATH_START, LKnee: [0.12, 0, 1], RKnee: [0.12, 0, 1] }],
  [0.12, { hips: [0, -0.05, 0.05], hipsRot: [10, -6, 0], spine: [22, -8, 0], head: [18, 0, 0],
    LArm: [-20, 0, -5], RArm: [-20, 0, -5], LFore: [-40, 0, 0], RFore: [-40, 0, 0] }],
  [0.42, { hips: [0, -0.47, 0.02], hipsRot: [8, -8, -4], spine: [26, -6, 0], head: [20, -8, 0],
    LAnkle: [0.13, 0.10, -0.40], RAnkle: [0.12, 0.10, -0.40], LFoot: [70, -4, 0], RFoot: [70, -4, 0],
    LKnee: [0.1, -0.5, 1], RKnee: [0.1, -0.5, 1],
    LArm: [-25, 0, -8], RArm: [-25, 0, -8], LFore: [-20, 0, 0], RFore: [-20, 0, 0] }, true],
  [0.75, { hips: [0, -0.62, 0.12], hipsRot: [45, -8, -4], spine: [20, -4, 0], head: [10, -10, 0],
    LArm: [-75, 0, -10], RArm: [-70, 0, -10], LFore: [-15, 0, 0], RFore: [-15, 0, 0] }],
  [1.0, { hips: [0, -0.88, 0.40], hipsRot: [88, -10, -4], spine: [4, -4, 0], head: [-20, -35, 0],
    LLegIK: 0, RLegIK: 0, LUpLeg: [-22, 0, 0], LLeg: [10, 0, 0], RUpLeg: [-18, 0, 0], RLeg: [6, 0, 0],
    LFootFK: [50, 0, 0], RFootFK: [50, 0, 0],
    LArm: [-30, 0, 20], RArm: [-40, 0, 60], LFore: [-15, 0, 0], RFore: [-25, 0, 0] }, true, 'rest'],
  [1.12, { hips: [0, -0.86, 0.41], hipsRot: [84, -10, -4] }, false, 'clear'],
  [1.35, { hips: [0, -0.885, 0.42], hipsRot: [90, -10, -4], spine: [3, -4, 0], head: [-25, -40, 0],
    LArm: [-5, 0, 62], RArm: [-25, 0, 95], LFore: [-4, 0, 0], RFore: [-10, 0, 0] }, true, 'rest'],
];

// No room to fall: the knees give, the body sinks onto the heels and slumps onto its side, curled.
const DEATH_CRUMPLE = [
  [0, { ...DEATH_START, LKnee: [0.12, 0, 1], RKnee: [0.12, 0, 1] }],
  [0.1, { hips: [0, -0.04, 0.02], hipsRot: [6, -4, 0], spine: [14, -6, 0], head: [16, 0, 0],
    LArm: [-15, 0, -6], RArm: [-18, 0, -6], LFore: [-35, 0, 0], RFore: [-35, 0, 0] }],
  [0.4, { hips: [0, -0.47, 0.0], hipsRot: [12, -6, -3], spine: [30, -6, 0], head: [32, -6, 0],
    LAnkle: [0.13, 0.10, -0.40], RAnkle: [0.12, 0.10, -0.38], LFoot: [70, -4, 0], RFoot: [70, -4, 0],
    LKnee: [0.1, -0.5, 1], RKnee: [0.1, -0.5, 1],
    LArm: [-8, 0, -4], RArm: [-8, 0, -4], LFore: [-12, 0, 0], RFore: [-12, 0, 0] }, true],
  [0.68, { hips: [0.03, -0.66, -0.06], hipsRot: [24, -8, -10], spine: [38, -6, -6], head: [38, -10, -8],
    LAnkle: [0.13, 0.10, -0.44], RAnkle: [0.12, 0.10, -0.42],
    LArm: [-20, 0, 4], RArm: [-26, 0, 8], LFore: [-20, 0, 0], RFore: [-25, 0, 0] }],
  [1.0, { hips: [0.2, -0.8, 0.02], hipsRot: [30, -12, -72], spine: [30, -6, -8], head: [24, -20, -14],
    LLegIK: 0, RLegIK: 0, LUpLeg: [-75, 0, 0], LLeg: [115, 0, 0], RUpLeg: [-65, 0, 0], RLeg: [120, 0, 0],
    LFootFK: [30, 0, 0], RFootFK: [30, 0, 0],
    LArm: [-35, 0, 20], RArm: [-60, 0, 35], LFore: [-40, 0, 0], RFore: [-30, 0, 0] }, true, 'rest'],
  [1.14, { hips: [0.2, -0.79, 0.02], hipsRot: [28, -12, -70], head: [20, -22, -12] }, false, 'clear'],
  [1.4, { hips: [0.21, -0.81, 0.02], hipsRot: [32, -12, -76], spine: [28, -6, -8], head: [28, -24, -16],
    LArm: [-30, 0, 15], RArm: [-55, 0, 40], LFore: [-45, 0, 0], RFore: [-25, 0, 0] }, true, 'rest'],
];

const CLIPS = {
  Idle: { duration: 6, loop: true, pose: t => {
    const p = t / 6, w = sin(TAU * p), b = sin(TAU * 2 * p), h = sin(TAU * p + 1.1);
    return { ...STANCE,
      hips: [0.012 * w, -0.018 + 0.002 * b, 0], hipsRot: [1, 2 * w, 2 * w],
      spine: [1 - 0.8 * b, -1.5 * w, -2.5 * w], head: [3 + 0.6 * b, 6 * h, 0.8 * w],
      LClav: [0, 0, 0.8 * b], RClav: [0, 0, 0.8 * b], LArm: [-3 - 0.6 * b, 0, -13], RArm: [-4 - 0.6 * b, 0, -13] };
  } },
  IdleNervous: { duration: 3, loop: true, pose: t => {
    const p = t / 3, w = sin(TAU * p), scan = sin(TAU * p + 0.4), b = sin(TAU * 2 * p);
    return { ...STANCE,
      hips: [0.022 * w, -0.06, -0.01], hipsRot: [6, 4 * w, 2.5 * w], spine: [8 + 0.8 * b, 9 * scan, -2 * w],
      head: [2, 22 * scan, 0], LAnkle: [0.16, 0.112, 0.07], RAnkle: [0.17, 0.112, -0.08], LFoot: [0, -2, 0], RFoot: [0, 4, 0],
      // Right hand hovers over the holstered pistol, left hand low and forward.
      RReach: [0.26, 1.06 + 0.006 * b, 0.0], RFingerDir: [0.1, -0.8, 0.6], RPalm: [-1, 0, 0], RElbow: [0.8, -0.2, -0.6],
      LReach: [0.2, 1.08 + 0.01 * w, 0.28], LFingerDir: [-0.25, -0.1, 1], LPalm: [0, -1, 0], LElbow: [0.6, -0.8, -0.1],
      LFingers: 'relaxed', RFingers: 'open' };
  } },
  Walk: { duration: 0.96, loop: true, pose: t => {
    const g = gait(t, 0.96, { stance: 0.62, front: 0.30, back: -0.44, lift: 0.12, heelStrike: -15, toeOff: 35, width: 0.10, yaw: -6 });
    const c = cos(TAU * g.p), s = sin(TAU * g.p), swing = cos(TAU * (g.p - 0.04));
    return { ...g,
      hips: [0.02 * s, -0.045 - 0.016 * cos(2 * TAU * g.p), 0], hipsRot: [3, -5 * c, 3 * s],
      spine: [3, 8 * c, -3 * s], head: [2, -3 * c, 0],
      LArm: [16 * swing, 0, -12], RArm: [-16 * swing, 0, -12],
      LFore: [-(15 + 12 * max(0, -c)), 0, 0], RFore: [-(15 + 12 * max(0, c)), 0, 0],
      LFingers: 'relaxed', RFingers: 'relaxed' };
  } },
  Run: { duration: 0.7, loop: true, pose: t => {
    const g = gait(t, 0.7, { stance: 0.36, front: 0.20, back: -0.30, lift: 0.30, heelStrike: -4, toeOff: 40, width: 0.09, yaw: -4 });
    const c = cos(TAU * g.p), s = sin(TAU * g.p), swing = cos(TAU * (g.p - 0.03));
    return { ...g,
      hips: [0.012 * s, -0.055 - 0.02 * cos(2 * TAU * (g.p - 0.18)), 0], hipsRot: [8, -7 * c, 2 * s],
      spine: [7, 11 * c, -2 * s], head: [-6, -4 * c, 0],
      LArm: [-6 + 26 * swing, 0, -17], RArm: [-6 - 26 * swing, 0, -17],
      LFore: [-(66 + 14 * max(0, -c)), 0, -14], RFore: [-(66 + 14 * max(0, c)), 0, -14],
      LFingers: 'fist', RFingers: 'fist' };
  } },
  AimPistol: { duration: 2.4, loop: true, pose: aimPose },
  FirePistol: { duration: 0.4, loop: false, pose: t => {
    const pose = aimPose(0), r = impulse(t, 0.045);
    return { ...pose, gun: add(pose.gun, [0, 0.012 * r, -0.035 * r]), gunRot: add(pose.gunRot, [-11 * r, 0, 0]),
      spine: add(pose.spine, [-1.5 * r, 0, 0]), head: add(pose.head, [-1 * r, 0, 0]) };
  } },
  HitReact: { duration: 0.6, loop: false, pose: t => {
    const a = impulse(t, 0.07), b = impulse(t, 0.22);
    return { ...STANCE,
      hips: add(STANCE.hips, [0, -0.03 * b, -0.045 * a + 0.01 * b]), hipsRot: [-7 * a, 6 * a, 0],
      spine: [-13 * a + 4 * b, 9 * a, 3 * a], head: add(STANCE.head, [-7 * a + 3 * b, 6 * a, 0]),
      LArm: add(STANCE.LArm, [-11 * a, 0, 8 * a]), RArm: add(STANCE.RArm, [-11 * a, 0, 8 * a]),
      LFore: add(STANCE.LFore, [-25 * a, 0, 0]), RFore: add(STANCE.RFore, [-25 * a, 0, 0]),
      LFingers: 'open', RFingers: 'open' };
  } },
  // Hit while aiming: the torso takes the jolt, the gun is knocked off line and comes back.
  HitReactArmed: { duration: 0.6, loop: false, pose: t => {
    const pose = aimPose(0), a = impulse(t, 0.07), b = impulse(t, 0.22);
    return { ...pose,
      hips: add(pose.hips, [0, -0.03 * b, -0.045 * a + 0.01 * b]), hipsRot: add(pose.hipsRot, [-6 * a, 6 * a, 0]),
      spine: add(pose.spine, [-12 * a + 4 * b, 8 * a, 3 * a]), head: add(pose.head, [-7 * a + 3 * b, 6 * a, 0]),
      gun: add(pose.gun, [0.04 * a, 0.07 * a - 0.03 * b, -0.10 * a]), gunRot: add(pose.gunRot, [-22 * a + 6 * b, 14 * a, 10 * a]),
      gunHold: 1 - 0.25 * a };
  } },
  DeathForward: { duration: 1.5, loop: false, keys: DEATH_FORWARD },
  DeathBackward: { duration: 1.5, loop: false, keys: DEATH_BACKWARD },
  DeathCrumple: { duration: 1.55, loop: false, keys: DEATH_CRUMPLE },
  Crouch: { duration: 3, loop: true, pose: t => {
    const p = t / 3, b = sin(TAU * 2 * p), h = sin(TAU * p + 0.5);
    return { ...STANCE,
      hips: [0, -0.43 + 0.004 * b, -0.12], hipsRot: [28, 0, 0], spine: [22 - 1.5 * b, 0, 0], head: [-14 + b, 10 * h, 0],
      LAnkle: [0.15, 0.112, 0.10], RAnkle: [0.15, 0.112, 0.0], LFoot: [0, -10, 0], RFoot: [0, -6, 0],
      LReach: [0.06, 0.56, 0.30], LFingerDir: [0, -0.7, 0.7], LPalm: [-1, 0, 0], LElbow: [1, 0, 0.3],
      RReach: [0.06, 0.57, 0.30], RFingerDir: [0, -0.7, 0.7], RPalm: [-1, 0, 0], RElbow: [1, 0, 0.3] };
  } },
  Surrender: { duration: 3, loop: true, pose: t => {
    const p = t / 3, w = sin(TAU * p), b = sin(TAU * 2 * p), h = sin(TAU * p + 0.8);
    return { ...STANCE,
      hips: [0.006 * w, -0.02, 0], hipsRot: [0, 1.5 * w, 1.5 * w], spine: [-2 + 0.8 * b, 0, -1.5 * w], head: [8, 4 * h, 0],
      LReach: [0.42, 1.68 + 0.008 * b, 0.06], LFingerDir: [0.15, 1, 0], LPalm: [0, 0, 1], LElbow: [1, -0.6, 0.2],
      RReach: [0.42, 1.68 + 0.008 * b, 0.06], RFingerDir: [0.15, 1, 0], RPalm: [0, 0, 1], RElbow: [1, -0.6, 0.2],
      LFingers: 'open', RFingers: 'open' };
  } },
};
export const NPC_PROCEDURAL_CLIP_NAMES = Object.freeze(Object.keys(CLIPS));
