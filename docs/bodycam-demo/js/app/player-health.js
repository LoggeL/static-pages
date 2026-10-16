// The officer's wounds. Suspect rounds arrive as `player.damage` on the shared bus; the camera
// effect reads state.damage (a pulse on each rise, see postfx damage), sounds go out as `sound`.
export const PLAYER_HEALTH = { max: 100, fadeSeconds: 0.45, heavyBreathBelow: 55, ringingOnFirstHit: true };

export function createPlayerHealth({ bus, state, camera, config = PLAYER_HEALTH }) {
  let health = config.max, hits = 0, breathing = false, dead = false;
  const here = () => camera.getWorldPosition(camera.position.clone()).toArray();
  const off = bus.on('player.damage', event => {
    if (dead) return;
    health = Math.max(0, health - (Number.isFinite(event.amount) ? event.amount : 20));
    hits++; state.damage = 1;
    bus.emit('sound', { name: 'impact_flesh', position: here() });
    if (hits === 1 && config.ringingOnFirstHit) bus.emit('sound', { name: 'ear_ringing' });
    if (!breathing && health > 0 && health < config.heavyBreathBelow) { breathing = true; bus.emit('sound', { name: 'breath_heavy' }); }
    if (health === 0) { dead = true; bus.emit('playerDeath', { sourceId: event.sourceId ?? null, hits }); }
  });
  return {
    get health() { return health; }, get dead() { return dead; },
    update(dt) { state.damage = Math.max(0, (state.damage ?? 0) - dt / config.fadeSeconds); },
    state: () => ({ health, hits, dead }),
    dispose() { off?.(); },
  };
}
