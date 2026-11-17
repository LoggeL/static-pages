// StemStage – crypto.js: Entschlüsselung passwortgeschützter Stems (WebCrypto).
// Format je Datei: [12 Byte IV][AES-256-GCM-Ciphertext inkl. 16 Byte Tag]
// Schlüssel: PBKDF2-SHA-256(passwort, salt, iterations) – Parameter stehen in songs.json → "encryption".

const enc = new TextEncoder();
const CHECK_TEXT = 'stemstage-ok';

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Leitet den AES-Schlüssel aus dem Passwort ab. */
export async function deriveKey(password, meta) {
  if (!globalThis.crypto?.subtle) throw new Error('WebCrypto nicht verfügbar (nur über HTTPS).');
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64ToBytes(meta.salt), iterations: meta.iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

/** Entschlüsselt einen ArrayBuffer im obigen Format. */
export async function decryptBuffer(key, buf) {
  const bytes = new Uint8Array(buf);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
}

/** Prüft ein Passwort gegen den Prüfblock in songs.json. Liefert den Schlüssel oder null. */
export async function tryPassword(password, meta) {
  if (!password || !meta) return null;
  try {
    const key = await deriveKey(password, meta);
    const plain = await decryptBuffer(key, b64ToBytes(meta.check).buffer);
    return new TextDecoder().decode(plain) === CHECK_TEXT ? key : null;
  } catch {
    return null;
  }
}
