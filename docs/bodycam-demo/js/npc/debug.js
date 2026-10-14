import { BufferAttribute, BufferGeometry, Group, Line, LineBasicMaterial, Vector3 } from 'three';

export function createNPCDebug({ scene, camera, renderer, npcs, config, perception }) {
  const group = new Group(); group.name = 'NPCDebug'; scene.add(group);
  const materials = {
    path: new LineBasicMaterial({ color: config.pathColor, depthTest: false, transparent: true, opacity: 0.9 }),
    cone: new LineBasicMaterial({ color: config.coneColor, depthWrite: false, transparent: true, opacity: 0.5 }),
    zone: new LineBasicMaterial({ color: config.zoneColor, depthTest: false }),
  };
  const overlay = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (overlay) {
    overlay.dataset.npcDebug = 'states';
    Object.assign(overlay.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '20' });
    document.body.append(overlay);
  }
  const entries = new Map(), position = new Vector3(), projected = new Vector3();
  let disposed = false, enabled = !!config.enabled;
  function line(material, values) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(values), 3));
    const object = new Line(geometry, material); object.frustumCulled = false; group.add(object); return object;
  }
  for (const npc of npcs) {
    const cone = line(materials.cone, [0, 0, 0]);
    const path = line(materials.path, [0, 0, 0]);
    let label = null;
    if (overlay) {
      label = document.createElement('span');
      Object.assign(label.style, { position: 'absolute', color: '#fff', background: 'rgba(0,0,0,.7)',
        padding: '2px 5px', whiteSpace: 'nowrap', font: `${config.fontSize}px monospace` });
      overlay.append(label);
    }
    entries.set(npc.id, { cone, path, label, pathVersion: -1, coneKey: '' });
  }
  function replace(object, values) {
    object.geometry.dispose();
    object.geometry = new BufferGeometry();
    object.geometry.setAttribute('position', new BufferAttribute(new Float32Array(values.length ? values : [0, 0, 0]), 3));
  }
  function setEnabled(on) { enabled = !!on; group.visible = enabled; if (overlay) overlay.hidden = !enabled; return enabled; }
  function update() {
    if (disposed || !enabled) return;
    camera.updateWorldMatrix(true, false);
    const rect = renderer?.domElement.getBoundingClientRect() ?? { x: 0, y: 0, width: innerWidth, height: innerHeight };
    for (const npc of npcs) {
      const entry = entries.get(npc.id); if (!entry) continue;
      entry.cone.position.copy(npc.position); entry.cone.quaternion.copy(npc.root.quaternion);
      npc.nodes.S_Head.getWorldPosition(position);
      const height = position.y - npc.position.y;
      const key = `${perception.range}/${perception.fovDeg}/${height.toFixed(4)}`;
      if (key !== entry.coneKey) {
        const values = [0, height, 0], half = perception.fovDeg * Math.PI / 360;
        for (let i = 0; i <= config.coneSegments; i++) {
          const angle = -half + 2 * half * i / config.coneSegments;
          values.push(Math.sin(angle) * perception.range, height, Math.cos(angle) * perception.range);
        }
        values.push(0, height, 0); replace(entry.cone, values); entry.coneKey = key;
      }
      if (entry.pathVersion !== npc.pathVersion) {
        replace(entry.path, npc.path.flatMap(point => [point.x, point.y + 0.04, point.z]));
        entry.pathVersion = npc.pathVersion;
      }
      if (entry.label) {
        projected.copy(position).add(new Vector3(0, 0.22, 0)).project(camera);
        entry.label.hidden = projected.z < -1 || projected.z > 1;
        entry.label.textContent = `${npc.id}: ${npc.stateMachine.state}`;
        entry.label.style.transform = `translate(${rect.x + (projected.x + 1) * rect.width / 2}px,${rect.y + (1 - projected.y) * rect.height / 2}px)`;
      }
    }
  }
  setEnabled(enabled);
  return { group, get enabled() { return enabled; }, setEnabled, update,
    state: () => ({ enabled, paths: entries.size, labels: overlay?.childElementCount ?? 0 }),
    dispose() { if (disposed) return; disposed = true; scene.remove(group); overlay?.remove();
      for (const object of group.children) object.geometry?.dispose();
      Object.values(materials).forEach(material => material.dispose()); entries.clear(); } };
}
