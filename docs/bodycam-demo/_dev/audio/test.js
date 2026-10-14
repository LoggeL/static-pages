import { createAudio, attachAudio } from '../../js/audio/engine.js';
import { MIX_CONFIG } from '../../js/audio/mix-config.js';

const BASE = new URL('../../', import.meta.url).href;
const MANIFEST = new URL('data/sounds.json', BASE).href;
export const SURFACES = ['concrete', 'wood', 'carpet', 'tile', 'metal', 'plaster', 'glass', 'dirt', 'grass', 'asphalt', 'fabric', 'cardboard', 'flesh'];
export const EVENTS = ['shot', 'dryFire', 'magOut', 'magIn', 'boltRelease', 'casingHit', 'impact', 'step', 'door', 'roomChange', 'lightToggle'];
const ROOMS = { outdoor: { rt60: 2, indoor: false }, living_room: { rt60: 0.9, indoor: true }, bathroom: { rt60: 1.2, indoor: true } };
const ui = (id) => document.getElementById(id);
let live = null;
let detachLive = null;
let liveBus = null;
let frame = null;
let liveStarting = null;
const urls = [];

class EventBus {
  constructor() { this.listeners = new Map(); }
  on(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
    return () => this.off(type, callback);
  }
  off(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type, payload) { for (const callback of this.listeners.get(type) || []) callback(payload); }
}

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

function fallbackFetch(input, init) {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
  if (/\.(?:ogg|mp3|wav)(?:[?#]|$)/i.test(url)) return Promise.resolve(new Response('', { status: 404, statusText: 'Simulated missing audio' }));
  return fetch(input, init);
}

function log(value) {
  ui('log').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function status(text) { ui('state').textContent = text; }
function db(value) { return value > 0 ? 20 * Math.log10(value) : null; }

export function measure(buffer, start = 0, end = buffer.duration, ceilingDb = MIX_CONFIG.master.ceilingDb) {
  const begin = Math.max(0, Math.floor(start * buffer.sampleRate));
  const finish = Math.min(buffer.length, Math.ceil(end * buffer.sampleRate));
  const ceiling = 10 ** (ceilingDb / 20);
  let peak = 0, sumSquares = 0, clipped = 0, nearCeiling = 0, above097 = 0, nonFinite = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let index = begin; index < finish; index++) {
      const sample = samples[index];
      if (!Number.isFinite(sample)) { nonFinite++; continue; }
      const amplitude = Math.abs(sample);
      peak = Math.max(peak, amplitude);
      sumSquares += sample * sample;
      if (amplitude >= 1) clipped++;
      if (amplitude >= ceiling - 1e-5) nearCeiling++;
      if (amplitude > 0.97) above097++;
    }
  }
  const count = Math.max(0, finish - begin) * buffer.numberOfChannels;
  const rms = count ? Math.sqrt(sumSquares / count) : 0;
  return { start, end, peak, peakDbfs: db(peak), rms, rmsDbfs: db(rms), crestDb: rms ? db(peak / rms) : null,
    clippingRatio: count ? clipped / count : 0, ceilingRatio: count ? nearCeiling / count : 0,
    above097Ratio: count ? above097 / count : 0, nonFinite, samples: count };
}

export function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const bytes = new ArrayBuffer(44 + buffer.length * channels * 2);
  const view = new DataView(bytes);
  const text = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, bytes.byteLength - 44, true);
  const samples = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let offset = 44;
  for (let index = 0; index < buffer.length; index++) {
    for (let channel = 0; channel < channels; channel++) {
      const raw = samples[channel][index];
      const sample = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
      view.setInt16(offset, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
      offset += 2;
    }
  }
  return new Uint8Array(bytes);
}

function toBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}

function payloadFor(type, when = 0, indoor = false, surface = 'concrete') {
  const position = [0, 1.4, -1];
  const common = { when, position, occlusion: Number(ui('occlusion').value) };
  switch (type) {
    case 'shot': return { ...common, weapon: 'rifle', indoor, distance: 1, roomId: indoor ? 'living_room' : null };
    case 'step': return { ...common, surface, speed: 1.5, own: true };
    case 'casingHit': case 'impact': return { ...common, surface };
    case 'door': return { ...common, action: 'open' };
    case 'roomChange': return { when, roomId: indoor ? 'living_room' : null, profile: indoor ? ROOMS.living_room : ROOMS.outdoor };
    case 'lightToggle': return { ...common, enabled: true };
    default: return common;
  }
}

export function validateAdapter() {
  const results = [];
  const expected = {
    shot: ['gunshot'], dryFire: ['play', 'dry_fire'], magOut: ['play', 'mag_out'], magIn: ['play', 'mag_in'],
    boltRelease: ['play', 'bolt_release'], casingHit: ['play', 'casing_wood'], impact: ['play', 'impact_wood'],
    step: ['footstep', 'wood'], door: ['play', 'door_open_creak'], roomChange: ['setRoom', 'living_room'], lightToggle: ['play', 'light_click']
  };
  for (const kind of ['on/off', 'EventTarget']) {
    const calls = [];
    const fake = Object.fromEntries(['play', 'gunshot', 'footstep', 'setRoom'].map(method => [method, (...args) => { calls.push({ method, args }); return { stop() {} }; }]));
    const bus = kind === 'EventTarget' ? new EventTarget() : new EventBus();
    const emit = (event, payload) => kind === 'EventTarget' ? bus.dispatchEvent(new CustomEvent(event, { detail: payload })) : bus.emit(event, payload);
    const detach = attachAudio(fake, bus);
    if (typeof detach !== 'function') throw new Error(`${kind}: attachAudio muss eine detach-Funktion liefern.`);
    const events = EVENTS.map((event, index) => {
      const before = calls.length;
      emit(event, payloadFor(event, index + 1, true, 'wood'));
      const received = calls.slice(before);
      if (!received.length) throw new Error(`${kind}: ${event} löst keine Audiomethode aus.`);
      const [method, firstArgument] = expected[event];
      const mapped = received.find(call => call.method === method && (firstArgument === undefined || call.args[0] === firstArgument));
      if (!mapped) throw new Error(`${kind}: ${event} wurde falsch zugeordnet: ${JSON.stringify(received)}`);
      const options = mapped.args[method === 'gunshot' ? 0 : method === 'play' ? 1 : 2];
      if (options?.when !== index + 1) throw new Error(`${kind}: ${event} verliert den geplanten Zeitstempel.`);
      if (event === 'step' && mapped.args[1] !== 1.5) throw new Error(`${kind}: step verliert die Schrittgeschwindigkeit.`);
      return { event, received };
    });
    const count = calls.length;
    detach();
    for (const event of EVENTS) emit(event, payloadFor(event));
    if (calls.length !== count) throw new Error(`${kind}: detach entfernt nicht alle Listener.`);
    detach();
    results.push({ kind, passed: true, events, detached: true });
  }
  return { passed: true, cases: results };
}

export async function runOffline({ fallback = false, simulate404 = true, includeWav = false, seed = 4273, sampleRate = 48000, duration = 36 } = {}) {
  if (duration < 36) throw new Error('Die vollständige Prüfsequenz benötigt mindestens 36 Sekunden.');
  const context = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const audio = await createAudio({ manifestUrl: MANIFEST, baseUrl: BASE, context, random: randomGenerator(seed),
    ...(fallback && simulate404 ? { fetch: fallbackFetch } : {}) });
  let detach = () => {};
  try {
    await audio.preload();
    await audio.unlock();
    audio.setMasterVolume(1);
    audio.setListener([0, 1.4, 0], [0, 0, 0, 1]);
    const bus = new EventBus();
    detach = attachAudio(audio, bus);
    const timeline = [];
    const add = (when, event, payload) => timeline.push({ when, event, payload: { ...payload, when } });
    const addPlay = (when, name, options = {}) => timeline.push({ when, event: 'play', payload: { name, ...options, when } });
    add(0, 'roomChange', { roomId: null, profile: ROOMS.outdoor });
    for (const when of [2, 2.092, 2.184]) add(when, 'shot', { ...payloadFor('shot', when), occlusion: 0 });
    add(4.2, 'shot', { weapon: 'pistol', indoor: false, distance: 38, position: [18, 1.4, -33], occlusion: 0.65 });
    add(7, 'roomChange', { roomId: 'living_room', profile: ROOMS.living_room });
    for (const when of [9, 9.092, 9.184, 9.276, 9.368]) add(when, 'shot', { ...payloadFor('shot', when, true), occlusion: 0 });
    add(11.3, 'shot', { weapon: 'pistol', indoor: true, distance: 5, position: [3, 1.4, -4], occlusion: 0.2 });
    add(12.06, 'magOut', {}); addPlay(12.83, 'gear_rattle'); add(14.17, 'magIn', {});
    add(14.66, 'magOut', {}); addPlay(15.68, 'mag_drop'); add(16.06, 'magIn', {}); add(16.95, 'boltRelease', {});
    add(17.6, 'door', { action: 'open', position: [2, 1, -2] });
    add(18.3, 'door', { action: 'kick', position: [2, 1, -2] });
    add(19.1, 'door', { action: 'close', position: [2, 1, -2] });
    add(20, 'roomChange', { roomId: null, profile: ROOMS.outdoor });
    SURFACES.forEach((surface, index) => add(21 + index * 0.6, 'step', { surface, speed: index % 2 ? 1.5 : 3, position: [0, 0, 0], own: true }));
    add(29.4, 'dryFire', {}); add(29.8, 'lightToggle', { enabled: true });
    add(30.2, 'casingHit', { surface: 'concrete', position: [1, 0, -1] });
    add(30.6, 'casingHit', { surface: 'wood', position: [-1, 0, -1] });
    ['wood', 'plaster', 'concrete', 'metal', 'glass', 'flesh'].forEach((surface, index) => add(31 + index * 0.4, 'impact', { surface, position: [index - 2, 1, -2] }));
    timeline.sort((a, b) => a.when - b.when);
    for (const entry of timeline) {
      if (entry.event === 'play') {
        const { name, ...options } = entry.payload;
        audio.play(name, options);
      } else bus.emit(entry.event, entry.payload);
    }
    const beforeRender = audio.getDiagnostics();
    const rendered = await context.startRendering();
    const sections = [
      ['Außen: Ruhe', 0.5, 1.8], ['Außen: Gewehr', 2, 3.8], ['Außen: Pistole verdeckt', 4.2, 6.5],
      ['Innen: Ruhe', 7.5, 8.8], ['Innen: Gewehr / Tinnitus', 9, 11], ['Innen: Pistole', 11.3, 11.9],
      ['Teilnachladen', 12, 14.5], ['Leernachladen', 14.5, 17.3], ['Türen', 17.5, 20],
      ...SURFACES.map((surface, index) => [`Schritt: ${surface}`, 21 + index * 0.6, 21.6 + index * 0.6]),
      ['Bedienung / Hülsen / Einschläge', 29.4, 33.5], ['Ausklang', 33.5, 36]
    ].map(([name, start, end]) => ({ name, ...measure(rendered, start, end) }));
    const wav = encodeWav(rendered);
    const result = { mode: fallback ? 'fallback-404' : 'files', seed, sampleRate, duration: rendered.duration, channels: rendered.numberOfChannels,
      ceilingDb: MIX_CONFIG.master.ceilingDb,
      metrics: measure(rendered), sections, events: timeline, diagnostics: { beforeRender, afterRender: audio.getDiagnostics() },
      wavBytes: wav.length, ...(includeWav ? { wavBase64: toBase64(wav) } : {}) };
    const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    urls.push(url);
    result.downloadUrl = url;
    return result;
  } finally { detach(); await audio.dispose(); }
}

function showResult(result) {
  status(`Offline-Sequenz fertig (${result.mode}). Messwerte und WAV sind verfügbar.`);
  ui('metrics').replaceChildren();
  const table = document.createElement('table');
  const heading = document.createElement('tr');
  for (const title of ['Abschnitt', 'Peak dBFS', 'RMS dBFS', 'Clipping ≥ 1', 'Anteil am Ceiling']) {
    const cell = document.createElement('th'); cell.textContent = title; heading.append(cell);
  }
  table.append(heading);
  for (const row of [{ name: 'Gesamt', ...result.metrics }, ...result.sections]) {
    const tr = document.createElement('tr');
    for (const value of [row.name, row.peakDbfs?.toFixed(2) ?? '−∞', row.rmsDbfs?.toFixed(2) ?? '−∞',
      `${(row.clippingRatio * 100).toFixed(5)} %`, `${(row.ceilingRatio * 100).toFixed(3)} %`]) {
      const td = document.createElement('td'); td.textContent = value; tr.append(td);
    }
    table.append(tr);
  }
  ui('metrics').append(table);
  const link = document.createElement('a');
  link.href = result.downloadUrl; link.download = `bodycam-c4-${result.mode}.wav`; link.textContent = `${result.mode}: WAV herunterladen`;
  ui('downloads').append(link, document.createTextNode(' · '));
  const { wavBase64, downloadUrl, ...summary } = result;
  log(summary);
}

async function stopLive() {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  detachLive?.(); detachLive = null;
  const previous = live;
  live = null; liveBus = null;
  await previous?.dispose();
  status('Wiedergabe gestoppt.');
}

async function startLive() {
  if (live) return live;
  if (liveStarting) return liveStarting;
  liveStarting = (async () => {
    status('Audio wird entsperrt und geladen.');
    const audio = await createAudio({ manifestUrl: MANIFEST, baseUrl: BASE, ...(ui('fallback').checked ? { fetch: fallbackFetch } : {}) });
    try {
      await audio.unlock();
      await audio.preload();
      audio.setMasterVolume(Number(ui('volume').value));
      audio.setListener([0, 1.4, 0], [0, 0, 0, 1]);
      const room = ui('room').value;
      audio.setRoom(room === 'outdoor' ? null : room, ROOMS[room]);
      live = audio; liveBus = new EventBus(); detachLive = attachAudio(audio, liveBus);
      let previous = performance.now();
      const tick = (now) => { if (!live) return; live.update((now - previous) / 1000); previous = now; frame = requestAnimationFrame(tick); };
      frame = requestAnimationFrame(tick);
      status(`Audio aktiv: ${ui('fallback').checked ? '404-Fallback' : 'Dateien mit Fallback bei fehlenden Clips'}.`);
      log(audio.getDiagnostics());
      return audio;
    } catch (error) { await audio.dispose(); throw error; }
  })();
  try { return await liveStarting; } finally { liveStarting = null; }
}

async function action(callback) {
  try { await callback(); } catch (error) { status(`Fehler: ${error.message}`); log(error.stack || error.message); console.error(error); }
}

for (const surface of SURFACES) {
  const option = document.createElement('option'); option.value = surface; option.textContent = surface; ui('surface').append(option);
}
const labels = { shot: 'Schuss', dryFire: 'Leerschuss', magOut: 'Magazin heraus', magIn: 'Magazin hinein', boltRelease: 'Verschlussfang', casingHit: 'Hülse fällt', impact: 'Einschlag', step: 'Schritt', door: 'Tür öffnen', roomChange: 'Raum wechseln', lightToggle: 'Lichtschalter' };
for (const event of EVENTS) {
  const button = document.createElement('button'); button.textContent = `${labels[event]} (${event})`; button.dataset.event = event;
  button.addEventListener('click', () => action(async () => {
    const audio = await startLive();
    const indoor = ui('room').value !== 'outdoor';
    const payload = payloadFor(event, audio.context.currentTime, indoor, ui('surface').value);
    if (event === 'roomChange') {
      ui('room').value = indoor ? 'outdoor' : 'living_room';
      Object.assign(payload, { roomId: indoor ? null : 'living_room', profile: indoor ? ROOMS.outdoor : ROOMS.living_room });
    }
    liveBus.emit(event, payload); log({ event, payload, diagnostics: audio.getDiagnostics() });
  }));
  ui('events').append(button);
}
ui('unlock').addEventListener('click', () => action(startLive));
ui('stop').addEventListener('click', () => action(async () => { await liveStarting; await stopLive(); }));
ui('fallback').addEventListener('change', () => action(async () => { await liveStarting; await stopLive(); }));
ui('volume').addEventListener('input', () => live?.setMasterVolume(Number(ui('volume').value)));
ui('room').addEventListener('change', () => { const room = ui('room').value; live?.setRoom(room === 'outdoor' ? null : room, ROOMS[room]); });
ui('adapter').addEventListener('click', () => action(() => { log(validateAdapter()); status('Alle Bus-Ereignisse und detach geprüft.'); }));
for (const [id, fallback] of [['render-real', false], ['render-fallback', true]]) ui(id).addEventListener('click', () => action(async () => {
  ui('render-real').disabled = true; ui('render-fallback').disabled = true;
  status(`Offline-Sequenz wird gerendert (${fallback ? '404-Fallback' : 'Dateien'}).`);
  try { const result = await runOffline({ fallback }); showResult(result); status('Offline-Sequenz fertig. Messwerte und WAV sind verfügbar.'); }
  finally { ui('render-real').disabled = false; ui('render-fallback').disabled = false; }
}));
window.addEventListener('pagehide', () => { stopLive(); for (const url of urls) URL.revokeObjectURL(url); });
window.audioTest = { ready: true, runOffline, validateAdapter, measure, encodeWav, showResult, startLive, stopLive,
  getLiveDiagnostics: () => live?.getDiagnostics() ?? null, surfaces: SURFACES, events: EVENTS };
status('Bereit. Wiedergabe beginnt erst nach Klick auf „Audio starten“.');
