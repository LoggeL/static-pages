import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments, Vector3 } from 'three';

// Wire positions are read from the production bone capsules, never from visual mesh bounds.
export function createCapsuleInspection({ scene, manager, color = 0x92c8ff, segments = 16 }) {
  const group = new Group(); group.name = 'NPCCapsuleInspection'; scene.add(group);
  const material = new LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.78 });
  const entries = new Map();
  let disposed = false;
  for (const npc of manager?.npcs ?? []) {
    for (const capsule of npc.hitZones.state().capsules) {
      const geometry = new BufferGeometry();
      // Two rings, four longitudinal edges and eight hemisphere meridians.
      const capSteps = 6;
      geometry.setAttribute('position', new BufferAttribute(new Float32Array((segments * 2 + 4 + 8 * capSteps) * 6), 3));
      const line = new LineSegments(geometry, material);
      line.name = `CapsuleWire_${npc.id}_${capsule.id}`; line.frustumCulled = false;
      group.add(line); entries.set(`${npc.id}/${capsule.id}`, { line, capSteps });
    }
  }
  const start = new Vector3(), end = new Vector3(), axis = new Vector3();
  const u = new Vector3(), v = new Vector3(), one = new Vector3(), two = new Vector3(), radial = new Vector3();
  function update() {
    if (disposed || !group.visible) return;
    for (const npc of manager?.npcs ?? []) for (const capsule of npc.hitZones.state().capsules) {
      const entry = entries.get(`${npc.id}/${capsule.id}`); if (!entry) continue;
      entry.line.visible = capsule.active && npc.root.visible;
      if (!entry.line.visible) continue;
      const data = entry.line.geometry.attributes.position;
      start.fromArray(capsule.start); end.fromArray(capsule.end); axis.subVectors(end, start);
      if (axis.lengthSq() < 1e-12) axis.set(0, 1, 0); else axis.normalize();
      u.set(Math.abs(axis.y) > 0.9 ? 1 : 0, Math.abs(axis.y) > 0.9 ? 0 : 1, 0).cross(axis).normalize();
      v.crossVectors(axis, u).normalize();
      const radius = capsule.radius;
      let index = 0;
      const edge = (a, b) => { data.setXYZ(index++, a.x, a.y, a.z); data.setXYZ(index++, b.x, b.y, b.z); };
      for (const center of [start, end]) for (let i = 0; i < segments; i++) {
        const angleA = i * Math.PI * 2 / segments, angleB = (i + 1) * Math.PI * 2 / segments;
        one.copy(center).addScaledVector(u, radius * Math.cos(angleA)).addScaledVector(v, radius * Math.sin(angleA));
        two.copy(center).addScaledVector(u, radius * Math.cos(angleB)).addScaledVector(v, radius * Math.sin(angleB));
        edge(one, two);
      }
      for (let meridian = 0; meridian < 4; meridian++) {
        const angle = meridian * Math.PI / 2;
        radial.copy(u).multiplyScalar(Math.cos(angle)).addScaledVector(v, Math.sin(angle));
        one.copy(start).addScaledVector(radial, radius); two.copy(end).addScaledVector(radial, radius); edge(one, two);
        for (const [center, sign] of [[start, -1], [end, 1]]) for (let i = 0; i < entry.capSteps; i++) {
          const a = i * Math.PI / (entry.capSteps * 2), b = (i + 1) * Math.PI / (entry.capSteps * 2);
          one.copy(center).addScaledVector(radial, radius * Math.cos(a)).addScaledVector(axis, sign * radius * Math.sin(a));
          two.copy(center).addScaledVector(radial, radius * Math.cos(b)).addScaledVector(axis, sign * radius * Math.sin(b));
          edge(one, two);
        }
      }
      data.needsUpdate = true;
    }
  }
  return { group, update, setEnabled(on) { group.visible = !!on; update(); },
    dispose() { if (disposed) return; disposed = true; group.removeFromParent();
      for (const entry of entries.values()) entry.line.geometry.dispose(); material.dispose(); entries.clear(); } };
}
