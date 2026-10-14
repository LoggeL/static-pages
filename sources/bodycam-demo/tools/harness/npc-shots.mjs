const action = code => ({ type: 'eval', code });

export function createNPCShots() {
  return {
    version: 1, page: 'bodycam-demo/_dev/npc/?npcdebug=1&pause=1',
    description: 'C19: echte Officer-Instanzen, Kapseln, Türpfad und Zustandsgerüst.',
    defaults: { settleMs: 0, measureSeconds: 0 },
    setup: [action(`(() => {
      const f = window.npcTest;
      if (!f?.ready || f.app.npcs.npcs.length !== 3) throw new Error('NPC inspection not ready');
      f.freeze(true); f.app.dev.freeze(true); f.debug(true); f.neutral(true); f.step(0);
      return f.stats();
    })()`)],
    shots: [
      ...['S1', 'S2', 'S3'].map(id => ({ name: `model-${id}`,
        description: id === 'S3' ? 'S3 zur Modellinspektion in den freien Flur versetzt; Originalspawn bleibt in der NPC-Diagnose erhalten.'
          : `Officer-Platzhalter ${id}, Skelettkapseln und effektiver Spawn.`,
        actions: [action(`(() => { const f=window.npcTest;
          ${id === 'S3' ? "f.teleportNPC('S3',[-0.28,0.603,-2.4],0);" : ''}
          f.select('${id}'); f.inspect('${id}'); return f.stats(); })()`)] })),
      { name: 'closed-door-path', description: 'Realer HAL/BED1-Pfad bei geschlossener Tür.', actions: [action(`(async () => {
        const T=await import('three'), f=window.npcTest, a=f.app, m=a.npcs;
        for (const d of a.world.doors) { d.setAngle(d.maxAngle); d.velocity=0; d.latched=false; }
        const d=a.world.doors.find(d=>d.id==='bed1'); d.setAngle(0); d.velocity=0; d.latched=true;
        const start=m.navigation.nearest(new T.Vector3(4.3,0.603,-4.95),{roomId:'HAL'});
        m.teleport('S1',start); m.setState('S1','idle');
        const route=f.moveTo('S1','BED1',{state:'flee',allowDoorPush:true});
        if (route.status!=='ok' || !route.doors.includes('bed1')) throw new Error('Expected real BED1 door path');
        f.select('S1'); a.teleport(5.65,0.603,-4.95,122,-7); f.step(0); return route;
      })()`)] },
      { name: 'door-arrival', description: 'NPC nach realem Türschub im Zielraum.', actions: [action(`(() => {
        const f=window.npcTest, a=f.app, n=a.npcs.npcs.find(n=>n.id==='S1');
        for(let i=0;i<1800 && n.stateMachine.state!=='hide';i++) f.step(1/120);
        if(n.stateMachine.state!=='hide' || a.world.roomAt(n.position)?.id!=='BED1') throw new Error('NPC did not reach BED1');
        f.inspect('S1'); return f.stats();
      })()`)] },
      ...['aim', 'surrender', 'dead'].map(state => ({ name: state,
        description: `Technischer Zustand ${state}; der Officer hat keine Contract-Clips.`,
        actions: [action(`(() => { const f=window.npcTest; f.setState('S1','${state}'); f.step(0); f.inspect('S1');
          if(f.app.npcs.npcs.find(n=>n.id==='S1').stateMachine.state!=='${state}') throw new Error('Wrong NPC state'); return f.stats(); })()`)] })),
    ],
  };
}
