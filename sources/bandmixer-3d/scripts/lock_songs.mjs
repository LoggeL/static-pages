#!/usr/bin/env node
// BandMixer 3D – Songs für öffentliches Hosting verschlüsseln.
//
// Verschlüsselt alle songs/<id>/*.mp3 (AES-256-GCM) zu *.bin, löscht die Klartext-MP3s,
// biegt die Stem-URLs in song.json auf .bin um und schreibt songs/lock.json
// (PBKDF2-SHA-256-Parameter, Prüfblock und den mit dem Passwort eingepackten Inhaltsschlüssel).
//
//   node sources/bandmixer-3d/scripts/lock_songs.mjs --songs public/bandmixer-3d/songs \
//        --manifests sources/bandmixer-3d/site/songs --password "<klassen-passwort>" --key-file <geheim, außerhalb des Repos>
//
// Nur Passwort ändern (Audio bleibt gleich): dasselbe mit --rewrap (dann werden keine MP3s erwartet).
import { webcrypto as crypto } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? true : arr[i + 1]]] : acc), [])
);
for (const k of ['songs', 'password', 'key-file']) if (!args[k]) { console.error(`--${k} fehlt`); process.exit(1); }
const SONGS = path.resolve(args.songs);
const MANIFESTS = args.manifests ? path.resolve(args.manifests) : null;
const ITERATIONS = 310000;

const keyFile = path.resolve(args['key-file']);
if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64') + '\n', { mode: 0o600 });
const contentRaw = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64');
const contentKey = await crypto.subtle.importKey('raw', contentRaw, 'AES-GCM', false, ['encrypt']);

async function encrypt(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return out;
}

let count = 0;
if (!args.rewrap) {
  for (const id of fs.readdirSync(SONGS)) {
    const dir = path.join(SONGS, id);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.mp3'))) {
      const src = path.join(dir, f);
      fs.writeFileSync(src.replace(/\.mp3$/, '.bin'), await encrypt(contentKey, fs.readFileSync(src)));
      fs.unlinkSync(src);
      count++;
    }
    for (const base of [SONGS, MANIFESTS].filter(Boolean)) {
      const mf = path.join(base, id, 'song.json');
      if (!fs.existsSync(mf)) continue;
      const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
      for (const s of m.stems || []) if (typeof s.url === 'string') s.url = s.url.replace(/\.mp3$/, '.bin');
      fs.writeFileSync(mf, JSON.stringify(m, null, 2) + '\n');
    }
  }
}

const salt = crypto.getRandomValues(new Uint8Array(16));
const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(args.password).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
const kek = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const b64 = (u8) => Buffer.from(u8).toString('base64');
const lock = {
  kdf: 'PBKDF2-SHA-256',
  iterations: ITERATIONS,
  salt: b64(salt),
  check: b64(await encrypt(kek, new TextEncoder().encode('stemstage-ok'))),
  key: b64(await encrypt(kek, contentRaw)),
};
for (const base of [SONGS, MANIFESTS].filter(Boolean)) fs.writeFileSync(path.join(base, 'lock.json'), JSON.stringify(lock, null, 2) + '\n');
console.log(`${count} Stems verschlüsselt, lock.json geschrieben.`);
