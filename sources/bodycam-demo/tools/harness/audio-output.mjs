export function validateAudioSink(value) {
  if (!['none', 'default'].includes(value)) throw new Error('audio-sink: none oder default erwartet.');
  return value;
}

export const DEFAULT_AUDIO_SINK = validateAudioSink(process.env.BODYCAM_AUDIO_SINK ?? 'none');

// Select a real browser output after readiness, before the App unlocks audio.
// No AudioContext constructor, engine or device configuration is replaced.
export async function configureAudioOutput(page, sink = DEFAULT_AUDIO_SINK) {
  validateAudioSink(sink);
  return page.evaluate(async sink => {
    const context = window.__bodycam?.dev?.audio?.context;
    if (!context) return { requested: sink, available: false };
    if (typeof context.setSinkId !== 'function') throw new Error('Native AudioContext.setSinkId fehlt.');
    await context.setSinkId(sink === 'none' ? { type: 'none' } : '');
    const actual = context.sinkId;
    if (sink === 'none' ? actual?.type !== 'none' : actual !== '') throw new Error('Audioausgang entspricht nicht der Auswahl.');
    return { requested: sink, available: true, sinkId: typeof actual === 'string' ? actual : { type: actual.type }, state: context.state, time: context.currentTime };
  }, sink);
}
