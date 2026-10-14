// Serialized adapters forward the actual C18 inspection API. They do not
// replace the renderer, model loader, weapon state machine or readiness signal.
function installReadiness() {
  window.__bodycam = {
    get ready() { return window.fpTest?.ready === true; },
    stats() {
      const f = window.fpTest;
      if (!f?.ready) throw new Error('C18 fpTest is not ready');
      return { ...f.stats(), renderer: { info: {
        render: { ...f.renderer.info.render }, memory: { ...f.renderer.info.memory },
        programs: f.renderer.info.programs?.length,
      } } };
    },
  };
  return { adapter: 'C18 fpTest.ready/stats and real renderer.info -> __bodycam' };
}

async function preparePose(name) {
  const f = window.fpTest;
  if (!f?.ready) throw new Error('C18 fpTest is not ready');
  f.freeze(true);
  f.setMoving(false);
  f.freeTarget.rotation.set(0, 0, 0);
  await f.createInstances();
  f.setMarkers(true);
  f.setArmsVisible(true);
  f.look(0, -4);
  f.setPose('lowready');
  f.step(0.5);
  switch (name) {
    case 'low-ready': break;
    case 'ads': f.setPose('ads'); f.step(0.65); break;
    case 'reload-magwell':
      f.weapon.fire(1); f.step(0.2); f.weapon.reload(); f.step(0.4); break;
    case 'fast-turn': f.turn(95, 0.12); break;
    case 'look-down': f.look(95, -65); f.step(0.4); break;
    case 'free-target': f.setTarget('L', 'free'); f.step(0.8); break;
    case 'sprint': f.setPose('sprint'); f.step(0.35); break;
    case 'inspect': f.setPose('inspect'); f.step(2); break;
    case 'reload-empty': f.setPose('empty'); f.step(0.5); break;
    case 'finger-open': f.arms.setFingerPose('L', 'open', 0.4); f.step(0.4); break;
    default: throw new Error(`Unknown C18 shot pose: ${name}`);
  }
  return f.stats();
}

export function createArmsShots() {
  const descriptions = [
    ['low-ready', 'Bereitschaft mit beiden Handkontakten und sichtbaren IK-Zielen.'],
    ['ads', 'ADS nach 0,65 s mit freier Visierlinie.'],
    ['reload-magwell', 'Echtes Nachladen, linke Hand am Magazinschacht.'],
    ['fast-turn', 'Kontinuierliche 95-Grad-Drehung in 0,12 s mit echter Waffentraegheit.'],
    ['look-down', 'Blick 65 Grad nach unten mit beiden realen Armen.'],
    ['free-target', 'Freies kamera-relatives Object3D-Ziel fuer die linke Hand.'],
    ['sprint', 'Echter Sprint-Zustand der Waffenlogik.'],
    ['inspect', 'Echter Inspect-Zustand nach 2 s.'],
    ['reload-empty', 'Leeres Magazin, echtes ReloadEmpty und Magwell-Kontakt.'],
    ['finger-open', 'Offenes linkes Fingerpreset am unveraenderten Griffziel.'],
  ];
  return {
    version: 1,
    page: 'bodycam-demo/_dev/fp/?pause=1&markers=1',
    description: 'C18: zehn eingefrorene Posen mit echter Waffe, GLB-Armen und getrenntem Viewmodel-Tiefenpuffer.',
    source: { acceptance: 'public/bodycam-demo/_dev/fp/acceptance.mjs',
      method: 'Neue echte Waffen-/Arminstanz pro Pose; explizite 1/120-s-Simulation; kein Mock.',
      mobile: 'Der arms-Regressionslauf prueft separat die echte 390x844-Viewportgroesse.' },
    defaults: { settleMs: 100, measureSeconds: 1 },
    beforeReady: [{ type: 'eval', code: `(${installReadiness.toString()})()` }],
    setup: [{ type: 'eval', code: 'window.fpTest.freeze(true)' }],
    integration: 'fpTest.ready bleibt massgeblich. freeze/step/turn/setPose und createInstances benutzen unveraenderte C18-Module. rAF-Messungen eingefrorener Shots belegen Screenshot-Cadence; Arm-Updatekosten werden gesondert im arms-Regressionslauf gemessen.',
    shots: descriptions.map(([name, description]) => ({ name, description,
      actions: [{ type: 'eval', code: `(${preparePose.toString()})(${JSON.stringify(name)})` }],
    })),
  };
}
