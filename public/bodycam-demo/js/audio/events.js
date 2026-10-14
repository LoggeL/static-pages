/** Accepts EventTarget, mitt/Node-style on/off, or on() returning an unsubscribe. */
export function attachAudio(audio, bus) {
  const unsubscribers = [];
  const payload = event => event && typeof event === 'object' && 'detail' in event ? event.detail || {} : event || {};
  const options = data => ({ ...data, position: data.position ?? data.point });
  const handlers = {
    shot: data => audio.gunshot(options(data)),
    dryFire: data => audio.play('dry_fire', options(data)),
    magOut: data => audio.play('mag_out', options(data)),
    magIn: data => audio.play('mag_in', options(data)),
    boltRelease: data => audio.play('bolt_release', options(data)),
    casingHit: data => audio.play(`casing_${['wood', 'carpet', 'fabric', 'cardboard'].includes(data.surface) ? 'wood' : 'concrete'}`, options(data)),
    impact: data => audio.play(`impact_${({ wood: 'wood', cardboard: 'wood', metal: 'metal', glass: 'glass', flesh: 'flesh',
      fabric: 'flesh', carpet: 'flesh', plaster: 'plaster' })[data.surface] || 'concrete'}`, options(data)),
    step: data => audio.footstep(data.surface, data.speed, options(data)),
    door: data => audio.play(data.action === 'kick' ? 'door_kick' : data.action === 'close' || data.open === false ? 'door_close' : 'door_open_creak', options(data)),
    roomChange: data => audio.setRoom(data.roomId ?? data.id ?? null, data.profile ?? data.reverb ?? {}, { when: data.when }),
    lightToggle: data => audio.play('light_click', options(data)),
    // Extra animation events in CONTRACT/STYLE, useful without a second adapter.
    magDrop: data => audio.play('mag_drop', options(data)),
    chargingHandle: data => audio.play('charging_handle', options(data)),
  };
  if (!bus || (typeof bus.addEventListener !== 'function' && typeof bus.on !== 'function')) throw new TypeError('Audio-Eventbus braucht on/off oder EventTarget.');
  for (const [name, handler] of Object.entries(handlers)) {
    const listener = event => handler(payload(event));
    if (typeof bus.addEventListener === 'function') {
      bus.addEventListener(name, listener); unsubscribers.push(() => bus.removeEventListener(name, listener));
    } else {
      const off = bus.on(name, listener);
      unsubscribers.push(typeof off === 'function' ? off : () => (bus.off || bus.removeListener)?.call(bus, name, listener));
    }
  }
  let detached = false;
  return () => { if (!detached) { detached = true; for (const unsubscribe of unsubscribers) unsubscribe(); } };
}
