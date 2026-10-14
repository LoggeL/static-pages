export async function deadline(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`${label}: Zeitlimit ${milliseconds} ms überschritten.`);
        error.code = 'HARNESS_TIMEOUT';
        reject(error);
      }, milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export async function waitForReady(page, timeout) {
  await page.waitForFunction(() => {
    const ready = window.__bodycam?.ready;
    return ready === true || (ready && typeof ready.then === 'function');
  }, null, { timeout });
  await deadline(page.evaluate(async () => {
    const value = await window.__bodycam.ready;
    if (value === false) throw new Error('__bodycam.ready wurde mit false erfüllt.');
  }), timeout, '__bodycam.ready');
}

async function callHook(page, name, args) {
  return page.evaluate(async ({ name, args }) => {
    const api = window.__bodycam;
    if (typeof api?.[name] !== 'function') throw new Error(`Debug-Hook __bodycam.${name} fehlt.`);
    const value = await api[name](...args);
    return value === undefined ? null : value;
  }, { name, args });
}

export async function executeAction(page, action, timeout) {
  const perform = async () => {
    switch (action.type) {
      case 'teleport': return callHook(page, 'teleport', [...action.position, action.yawDeg ?? 0, action.pitchDeg ?? -4]);
      case 'look': return callHook(page, 'look', [action.yawDeg, action.pitchDeg]);
      case 'eval': return page.evaluate(action.code);
      case 'wait': return page.waitForTimeout(action.ms);
      case 'click': return page.locator(action.selector).click({ timeout });
      case 'keys': {
        const held = [];
        try {
          for (const key of action.keys) { await page.keyboard.down(key); held.push(key); }
          await page.waitForTimeout(action.durationMs ?? 80);
        } finally { for (const key of held.reverse()) await page.keyboard.up(key).catch(() => {}); }
        return null;
      }
      case 'mouse': {
        const button = action.button ?? 'left';
        if (action.position) await page.mouse.move(...action.position);
        try { await page.mouse.down({ button }); await page.waitForTimeout(action.durationMs ?? 80); }
        finally { await page.mouse.up({ button }).catch(() => {}); }
        return null;
      }
      default: throw new Error(`Unbekannte Aktion: ${action.type}`);
    }
  };
  const intentionalWait = action.type === 'wait' ? action.ms : ['keys', 'mouse'].includes(action.type) ? action.durationMs ?? 0 : 0;
  return deadline(perform(), timeout + intentionalWait, `Aktion ${action.type}`);
}

export async function readStats(page, timeout) {
  return deadline(page.evaluate(async () => {
    if (typeof window.__bodycam?.stats !== 'function') return null;
    const value = await window.__bodycam.stats();
    const seen = new WeakSet();
    const json = JSON.stringify(value, (_, item) => {
      if (typeof item === 'bigint') return String(item);
      if (typeof item === 'object' && item !== null) {
        if (seen.has(item)) return '[Circular]';
        seen.add(item);
      }
      return item;
    });
    return json === undefined ? null : JSON.parse(json);
  }), timeout, '__bodycam.stats()');
}
