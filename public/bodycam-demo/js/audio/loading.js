/** AbortSignal.any/timeout are missing in older Safari. Also bound non-abortable decoders. */
export async function runAudioTask(operation, { signals = [], timeoutMs = 8000 } = {}) {
  const controller = new AbortController(), removers = [];
  let timer, rejectTask;
  const cancelled = new Promise((_, reject) => { rejectTask = reject; });
  function abort(reason, name = 'AbortError') {
    if (controller.signal.aborted) return;
    controller.abort();
    const error = new Error(reason); error.name = name;
    rejectTask(error);
  }
  for (const signal of signals.filter(Boolean)) {
    if (signal.aborted) { abort('Audio-Laden abgebrochen'); break; }
    const listener = () => abort('Audio-Laden abgebrochen');
    signal.addEventListener('abort', listener, { once: true });
    removers.push(() => signal.removeEventListener('abort', listener));
  }
  if (timeoutMs > 0) timer = setTimeout(() => abort('Audio-Ladezeit überschritten', 'TimeoutError'), timeoutMs);
  try {
    const result = controller.signal.aborted ? cancelled : operation(controller.signal);
    return await Promise.race([result, cancelled]);
  } finally {
    clearTimeout(timer);
    for (const remove of removers) remove();
  }
}
