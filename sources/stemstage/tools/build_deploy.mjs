#!/usr/bin/env node
// StemStage – Build für öffentliches Hosting (z. B. GitHub Pages).
// Kopiert app/ nach <out>, verschlüsselt alle Nicht-Demo-Songs (AES-256-GCM) und trägt die
// Parameter in songs.json ein. Demo-Songs bleiben unverschlüsselt.
//
// Schlüsselmodell:
//   - Audio wird mit einem festen, zufälligen Inhaltsschlüssel verschlüsselt (tools/.content-key, geheim).
//   - Dieser Schlüssel liegt in songs.json "eingepackt" mit einem Passwort-Schlüssel (PBKDF2-SHA-256).
//   - Passwortwechsel ändert daher nur songs.json; verschlüsselte Stems werden in tools/.enc-cache/
//     wiederverwendet, solange sich die Quelldatei nicht ändert (kein Git-Ballast).
//
//   node tools/build_deploy.mjs --out ../dist --password "<klassen-passwort>"
//   (ohne --password wird tools/.class-password benutzt bzw. neu erzeugt; --password speichert es dort)

import { webcrypto as crypto, randomInt, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(TOOLS, '..', 'app');
const CACHE = path.join(TOOLS, '.enc-cache');
const ITERATIONS = 310000;
const CHECK_TEXT = 'stemstage-ok';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), [])
);
if (!args.out) { console.error('Aufruf: node tools/build_deploy.mjs --out <ordner> [--password <pw>]'); process.exit(1); }
const OUT = path.resolve(args.out);

// Passwort
const pwFile = path.join(TOOLS, '.class-password');
let password = args.password;
if (!password && fs.existsSync(pwFile)) password = fs.readFileSync(pwFile, 'utf8').trim();
if (!password) {
  const words = ['riff', 'groove', 'bassline', 'backbeat', 'refrain', 'solo', 'encore', 'soundcheck'];
  password = `${words[randomInt(words.length)]}-${randomInt(1000, 10000)}`;
}
fs.writeFileSync(pwFile, password + '\n', { mode: 0o600 });

// Inhaltsschlüssel (fest)
const ckFile = path.join(TOOLS, '.content-key');
if (!fs.existsSync(ckFile)) {
  fs.writeFileSync(ckFile, Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64') + '\n', { mode: 0o600 });
  fs.rmSync(CACHE, { recursive: true, force: true }); // neuer Schlüssel → alter Cache ungültig
}
const contentRaw = Buffer.from(fs.readFileSync(ckFile, 'utf8').trim(), 'base64');
const contentKey = await crypto.subtle.importKey('raw', contentRaw, 'AES-GCM', false, ['encrypt']);

// Passwort-Schlüssel (KEK)
const b64 = (u8) => Buffer.from(u8).toString('base64');
const salt = crypto.getRandomValues(new Uint8Array(16));
const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
const kek = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
  base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
);

async function encrypt(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return out;
}

/** Verschlüsselt eine Stem-Datei mit dem Inhaltsschlüssel, mit Cache (gleiche Quelle → gleiche Ausgabe). */
async function encryptCached(src, cacheName) {
  const raw = fs.readFileSync(src);
  const sha = createHash('sha256').update(raw).digest('hex');
  const bin = path.join(CACHE, cacheName + '.bin');
  const shaFile = bin + '.sha256';
  if (fs.existsSync(bin) && fs.existsSync(shaFile) && fs.readFileSync(shaFile, 'utf8').trim() === sha) {
    return { bytes: fs.readFileSync(bin), cached: true };
  }
  const enc = await encrypt(contentKey, raw);
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, enc);
  fs.writeFileSync(shaFile, sha + '\n');
  return { bytes: enc, cached: false };
}

// 1) App ohne Songs kopieren
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(APP, OUT, { recursive: true, filter: (src) => !src.startsWith(path.join(APP, 'songs')) });
fs.mkdirSync(path.join(OUT, 'songs'), { recursive: true });

// 2) Songs übernehmen bzw. verschlüsseln
const data = JSON.parse(fs.readFileSync(path.join(APP, 'songs', 'songs.json'), 'utf8'));
let bytesTotal = 0;
for (const song of data.songs) {
  const secret = song.source !== 'demo';
  fs.mkdirSync(path.join(OUT, 'songs', song.id), { recursive: true });
  let fresh = 0;
  for (const stem of song.stems) {
    const src = path.join(APP, stem.file);
    if (secret) {
      const rel = stem.file.replace(/\.mp3$/i, '.bin');
      const { bytes, cached } = await encryptCached(src, `${song.id}/${stem.id}`);
      if (!cached) fresh++;
      fs.writeFileSync(path.join(OUT, rel), bytes);
      stem.file = rel;
      stem.encrypted = true;
      bytesTotal += bytes.length;
    } else {
      fs.copyFileSync(src, path.join(OUT, stem.file));
      bytesTotal += fs.statSync(src).size;
    }
  }
  console.log(`${secret ? '🔒' : '  '} ${song.id}${secret ? `  (${fresh ? fresh + ' neu verschlüsselt' : 'aus Cache'})` : ''}`);
}
data.encryption = {
  kdf: 'PBKDF2-SHA-256',
  iterations: ITERATIONS,
  salt: b64(salt),
  check: b64(await encrypt(kek, new TextEncoder().encode(CHECK_TEXT))),
  key: b64(await encrypt(kek, contentRaw)),
};
fs.writeFileSync(path.join(OUT, 'songs', 'songs.json'), JSON.stringify(data, null, 2));
console.log(`\nFertig: ${OUT}  (${(bytesTotal / 1e6).toFixed(1)} MB Audio)`);
console.log('Klassen-Passwort gespeichert in tools/.class-password (nicht im Build).');
