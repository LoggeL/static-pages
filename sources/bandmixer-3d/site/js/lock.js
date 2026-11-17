// BandMixer 3D – lock.js: Einstiegspunkt mit Klassen-Passwort.
// Die Songs liegen nur verschlüsselt (.bin, AES-256-GCM) im Repo. Dieses Modul
//   1. holt das Passwort aus dem QR-Link (#pw=…), dem letzten Besuch oder fragt danach,
//   2. entschlüsselt *.bin-Stems transparent beim fetch(), sodass die Audio-Engine unverändert bleibt,
//   3. lässt #pw=… in der Adresse stehen, damit der QR-Code (location.href) das Passwort mitnimmt,
//   4. lädt danach erst die eigentliche App (app.js).
import { tryPassword, decryptBuffer } from './crypto.js';

const STORE = 'bandmixer.pw';

async function main() {
  let meta = null;
  try {
    const res = await fetch('./songs/lock.json', { cache: 'no-store' });
    if (res.ok) meta = await res.json();
  } catch { /* ohne lock.json: unverschlüsselter Betrieb */ }

  if (meta) {
    let key = null;
    let pw = null;
    const fromHash = new URLSearchParams(location.hash.slice(1)).get('pw');
    let stored = null;
    try { stored = localStorage.getItem(STORE); } catch { /* privat-Modus */ }
    for (const candidate of [fromHash, stored]) {
      if (candidate && (key = await tryPassword(candidate, meta))) { pw = candidate; break; }
    }
    if (!key) ({ key, pw } = await askPassword(meta, Boolean(fromHash)));
    try { localStorage.setItem(STORE, pw); } catch { /* egal */ }
    try {
      const u = new URL(location.href);
      u.hash = 'pw=' + encodeURIComponent(pw);
      history.replaceState(history.state, '', u);
    } catch { /* egal */ }
    installDecryptingFetch(key);
  }
  await import('./app.js');
}

function installDecryptingFetch(key) {
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    const res = await original(input, init);
    if (!res.ok || !/\/songs\/[^?#]+\.bin(?:[?#]|$)/.test(new URL(url, location.href).pathname + '')) return res;
    const plain = await decryptBuffer(key, await res.arrayBuffer());
    return new Response(plain, {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(plain.byteLength) },
    });
  };
}

function askPassword(meta, hadWrongHash) {
  const style = document.createElement('style');
  style.textContent = `
    .bm-lock{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:20px;
      background:radial-gradient(60% 40% at 50% 40%,rgba(168,85,247,.25),transparent 70%),rgba(6,8,14,.92);
      -webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#f4f4f8}
    .bm-lock form{width:min(400px,100%);padding:28px 24px;border-radius:22px;text-align:center;
      background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);box-shadow:0 30px 80px -30px rgba(0,0,0,.8)}
    .bm-lock h2{margin:6px 0 8px;font-size:22px}
    .bm-lock p{margin:0 0 16px;color:#b8b6c8;font-size:14.5px;line-height:1.45}
    .bm-lock input{width:100%;box-sizing:border-box;min-height:52px;padding:12px 14px;margin-bottom:12px;border-radius:14px;
      border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.07);color:#fff;font-size:18px;text-align:center;outline:none}
    .bm-lock input:focus{border-color:#a855f7;box-shadow:0 0 0 4px rgba(168,85,247,.25)}
    .bm-lock button{min-height:48px;padding:0 28px;border:0;border-radius:999px;color:#fff;font-weight:700;font-size:16px;cursor:pointer;
      background:linear-gradient(135deg,#f43f5e,#a855f7 55%,#38bdf8)}
    .bm-lock .err{color:#ff8fb6;margin:-4px 0 12px}
    .bm-lock small{display:block;margin-top:14px;color:#8e8ba3;font-size:12.5px}`;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.className = 'bm-lock';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <form novalidate>
      <div style="font-size:42px" aria-hidden="true">🔒</div>
      <h2>Klassen-Passwort</h2>
      <p>Die Songs sind nur für den Unterricht freigegeben. Gib das Passwort ein, das deine Lehrkraft genannt hat.</p>
      <input type="password" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" placeholder="Passwort" aria-label="Passwort">
      <p class="err" role="alert" ${hadWrongHash ? '' : 'hidden'}>${hadWrongHash ? 'Das Passwort im Link stimmt nicht.' : ''}</p>
      <button type="submit">Entsperren</button>
      <small>Tipp: Wer den QR-Code an der Wand scannt, muss nichts eintippen.</small>
    </form>`;
  document.body.appendChild(el);
  const form = el.querySelector('form');
  const input = el.querySelector('input');
  const err = el.querySelector('.err');
  input.focus();
  return new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = input.value.trim();
      const key = await tryPassword(pw, meta);
      if (!key) {
        err.hidden = false;
        err.textContent = 'Leider falsch – frag deine Lehrkraft 🙂';
        input.select();
        return;
      }
      el.remove();
      style.remove();
      resolve({ key, pw });
    });
  });
}

main();
