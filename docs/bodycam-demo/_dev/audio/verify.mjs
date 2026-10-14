#!/usr/bin/env node
// Focused integration regressions through real Chromium Web Audio.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/logge/Documents/Projects/bodycam-work/tools/node_modules/playwright');
const output = process.env.C4_OUTPUT || '/Users/logge/Documents/Projects/bodycam-work/codex/C4';
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/Users/logge/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
let report;
try {
  const page = await browser.newPage();
  await page.goto(process.argv[2] || 'http://127.0.0.1:8952/bodycam-demo/_dev/audio/');
  report = await page.evaluate(async () => {
    const { createAudio } = await import('../../js/audio/engine.js');
    const results = [];
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const missing = (url, init) => /\.ogg$/.test(url) ? Promise.resolve(new Response('', { status: 404 })) : fetch(url, init);
    const make = (duration = 2, extra = {}) => createAudio({
      context: new OfflineAudioContext(2, duration * 48000, 48000), autoStart: false,
      random: () => 0.5, fetch: missing, ...extra,
    });
    const run = async (name, task) => {
      try { results.push({ name, passed: true, ...await task() }); }
      catch (error) { results.push({ name, passed: false, error: error.stack }); }
    };
    const rms = (buffer, from = 0, to = buffer.duration) => {
      const data = buffer.getChannelData(0), begin = Math.ceil(from * buffer.sampleRate), end = Math.floor(to * buffer.sampleRate);
      let sum = 0; for (let i = begin; i < end; i++) sum += data[i] ** 2;
      return Math.sqrt(sum / (end - begin));
    };
    await run('Dateivarianten, gleichzeitige Tails, Mechanikpegel und Raumprofile', async () => {
      const audio = await make(2, { fetch, config: { variation: { gainDb: 0, pitchCents: 0, shotPitchCents: 0 } } });
      try {
        await audio.preload(['rifle_shot_outdoor', 'rifle_tail_outdoor', 'rifle_mech']);
        for (let i = 0; i < 10; i++) audio.gunshot({ indoor: false, distance: 0, when: i * 0.1 });
        const history = audio.getDiagnostics().history.filter(event => event.type === 'play');
        const shots = history.filter(e => e.name === 'rifle_shot_outdoor');
        assert(shots.every((e, i) => !e.fallback && (!i || shots[i - 1].variant !== e.variant)), 'Dateivariante wiederholt sich direkt');
        assert(history.filter(e => e.name === 'rifle_tail_outdoor').every((e, i) => e.when === shots[i].when), 'Tail startet verzögert');
        assert(history.filter(e => e.name === 'rifle_mech').every(e => e.gain === 0.25), 'Mechanikpegel nicht 0.25');
        audio.setRoom('LIV'); assert(audio.getDiagnostics().room.rt60 === 0.55, 'Layout-RT60 falsch');
        audio.setRoom('OUT', { rt60: 0.15 }); assert(audio.getDiagnostics().room.rt60 === 2, 'Außenhall nicht 2 Sekunden');
        audio.setRoom('LIV');
        const small = audio.gunshot({ indoor: true, roomId: 'LIV' });
        assert(!small.some(v => v.name === 'rifle_tail_indoor'), 'Kleiner Raum bekommt redundanten Tail');
        const large = audio.gunshot({ indoor: true, roomId: 'BATH' });
        assert(large.some(v => v.name === 'rifle_tail_indoor'), 'Großer Raum bekommt keinen Tail');
        return { loaded: audio.getDiagnostics().loaded, shots: shots.length };
      } finally { await audio.dispose(); }
    });
    await run('Fehlendes Manifest, negative Dateicaches, Loop-Zufallsstart, Dispose', async () => {
      const audio = await make(1, { fetch: async () => new Response('', { status: 404 }) });
      await audio.preload();
      assert(audio.getDiagnostics().manifestError !== null, 'Manifestfehler fehlt');
      const loop = audio.play('ambient_night_suburb');
      assert(loop.fallback && loop.loop && loop.offset > 0, 'Loop-Fallback ohne Zufallsstart');
      await audio.dispose();
      assert(audio.getDiagnostics().activeVoices === 0 && audio.getDiagnostics().reverbBanks === 0, 'Dispose lässt Nodes aktiv');
      assert(audio.context.state !== 'closed', 'Injizierter Context wurde geschlossen');
      const other = await make();
      try {
        await other.preload(['dry_fire']); const failed = other.getDiagnostics().failed;
        for (let i = 0; i < 6; i++) other.play('dry_fire');
        await other.preload(['dry_fire']);
        assert(failed === other.getDiagnostics().failed, '404 wurde erneut abgerufen');
        const history = other.getDiagnostics().history.filter(e => e.name === 'dry_fire');
        assert(history.every((e, i) => e.fallback && (!i || e.variant !== history[i - 1].variant)), 'Fallback wiederholt Variante');
        return { failedRequests: failed, loopOffset: loop.offset };
      } finally { await other.dispose(); }
    });
    await run('Stimmenlimit auch für Loops; geplanter Stop lässt sich vorziehen', async () => {
      const audio = await make(1, { config: { limits: { voices: 2 } } });
      try {
        for (let i = 0; i < 8; i++) audio.play('ambient_night_suburb');
        assert(audio.getDiagnostics().activeVoices === 2, 'Loop-Stimmenlimit überschritten');
        const voice = audio.play('ear_ringing', { when: 0.05, duration: 7 });
        voice.stop(0.2);
        assert(voice.endTime < 0.3, 'Früherer Stop wurde ignoriert');
        const end = voice.endTime;
        await audio.context.startRendering();
        await voice.finished;
        return { earlyStopEnd: end, stolen: audio.getDiagnostics().stolen };
      } finally { await audio.dispose(); }
    });
    await run('Laufzeit, Distanzpegel, Verdeckung und Tiefpass', async () => {
      const render = async (distance, occlusion) => {
        const audio = await make(1, { config: { variation: { gainDb: 0, pitchCents: 0 } } });
        try {
          // Broad-band glass noise allows a meaningful normalized spectral comparison.
          await audio.preload(['glass_break']);
          audio.play('glass_break', { when: 0.1, gain: 0.02, distance, occlusion, reverb: 0 });
          const buffer = await audio.context.startRendering(), data = buffer.getChannelData(0);
          let first = -1, diff = 0;
          for (let i = 1; i < data.length; i++) {
            if (first < 0 && Math.abs(data[i]) > 1e-7) first = i;
            diff += (data[i] - data[i - 1]) ** 2;
          }
          const level = rms(buffer);
          return { rms: level, onset: first / buffer.sampleRate, brightness: Math.sqrt(diff / data.length) / level };
        } finally { await audio.dispose(); }
      };
      const near = await render(0, 0), far = await render(34.3, 0), covered = await render(0, 1);
      assert(Math.abs(far.onset - near.onset - 0.1) < 0.002, '34.3m erzeugen nicht 100ms Laufzeit');
      assert(far.rms < near.rms / 10 && covered.rms < near.rms / 5, 'Entfernung/Verdeckung senken Pegel nicht');
      assert(covered.brightness < near.brightness * 0.6, `Verdeckung filtert Höhen nicht: ${JSON.stringify({ near, covered })}`);
      return { near, far, covered };
    });
    await run('Lichtbalken als bewegliche Mono-Punktquelle', async () => {
      const audio = await make(3);
      try {
        await audio.preload(['police_lightbar_hum']);
        audio.setListener([0, 0, 0], [0, 0, 0, 1]);
        const voice = audio.play('police_lightbar_hum', { position: [0, 0, -1] });
        assert(voice.loop, 'Lichtbalken loopt nicht');
        const moved = audio.context.suspend(1).then(async () => {
          voice.setPosition([0, 0, -50]); voice.setOcclusion(0.5);
          audio.setListener([1, 0, 0], [0, 0, 0, 1]);
          await audio.context.resume();
        });
        const rendered = await audio.context.startRendering(); await moved;
        const near = rms(rendered, 0.3, 0.8), far = rms(rendered, 1.5, 2.5);
        assert(far < near / 20, 'Positionsänderung/Verdeckung des Lichtbalkens fehlt');
        const left = rendered.getChannelData(0), right = rendered.getChannelData(1);
        assert(left.every((v, i) => v === right[i]), 'Punktquelle ist nicht mono am Bodycam-Mikro');
        return { near, far };
      } finally { await audio.dispose(); }
    });
    await run('Rauschboden -58 dBFS und vollständiger Master-Mute', async () => {
      const render = async volume => {
        const audio = await make(4, { autoStart: true, config: { buses: { ambience: 0 } } });
        try {
          await audio.preload(['ambient_night_suburb', 'ambient_house_room_tone', 'ambient_rain_light']);
          await audio.unlock(); audio.setMasterVolume(volume);
          return rms(await audio.context.startRendering(), 0.1, 4);
        } finally { await audio.dispose(); }
      };
      const noiseDb = 20 * Math.log10(await render(1)), muted = await render(0);
      assert(Math.abs(noiseDb + 58) < 0.5, 'Rauschboden wurde vom Makeup verstärkt');
      assert(muted === 0, 'Master-Mute lässt Rauschen durch');
      return { noiseDb, muted };
    });
    await run('Ambience-Ducking und Raumhall-Aufräumen', async () => {
      const render = async shot => {
        const audio = await make(9, { autoStart: true });
        try {
          await audio.preload(['ambient_night_suburb', 'ambient_house_room_tone', 'ambient_rain_light']);
          await audio.unlock();
          if (shot) audio.gunshot({ indoor: false, when: 0.5, gain: 0 });
          audio.setRoom('LIV', {}, { when: 2 }); audio.setRoom('OUT', {}, { when: 2.5 });
          const buffer = await audio.context.startRendering(); audio.update(9);
          assert(audio.getDiagnostics().reverbBanks === 1, 'Alte Convolver bleiben verbunden');
          return { duck: rms(buffer, 0.51, 0.56), recovered: rms(buffer, 1.3, 1.5) };
        } finally { await audio.dispose(); }
      };
      const base = await render(false), ducked = await render(true);
      assert(ducked.duck < base.duck * 0.5, 'Ambience duckt nicht');
      assert(Math.abs(ducked.recovered / base.recovered - 1) < 0.1, 'Ambience erholt sich nicht');
      return { base, ducked };
    });
    await run('Funkintervall und Sirenenpausen über AudioContext-Zeit', async () => {
      const audio = await make(12, { autoStart: true, config: { scheduler: {
        radioInterval: [0.4, 0.5], sirenInitial: [0.1, 0.1], sirenPause: [0.5, 0.5],
      } } });
      try {
        await audio.unlock();
        const pending = [1, 2, 8, 9, 11].map(t => audio.context.suspend(t).then(async () => {
          audio.update(999); // dt cannot cause a catch-up storm.
          const next = audio.getDiagnostics().nextRadio - audio.context.currentTime;
          assert(next >= 0.4 && next <= 0.5, 'Funkintervall falsch');
          await audio.context.resume();
        }));
        await audio.context.startRendering(); await Promise.all(pending);
        const history = audio.getDiagnostics().history;
        const radios = history.filter(e => e.name === 'radio_chatter'), sirens = history.filter(e => e.name === 'siren_distant');
        assert(radios.length === 5 && sirens.length === 2 && sirens.every(e => !e.loop), 'Scheduler wiederholt/überlappt falsch');
        return { radios: radios.length, sirens: sirens.map(e => e.when), productionInterval: [40, 90] };
      } finally { await audio.dispose(); }
    });
    return { passed: results.every(result => result.passed), results };
  });
} finally { await browser.close(); }
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
