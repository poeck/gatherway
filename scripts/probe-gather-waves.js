// Run once in the signed-in Gather page's DevTools Console.
// Observes incoming waves for two minutes; does not send requests or change media.
(() => {
  const events = globalThis.gatherDev?.Repos?.gameSpace?.events;
  if (typeof events?.addEventListener !== 'function') {
    throw new Error('Gather wave events are unavailable');
  }
  let count = 0;
  const stop = events.addEventListener('WaveEvent', event => {
    const sentTimeMs = event.sentTime?.toMillis?.();
    console.log('[Gatherway wave]', JSON.stringify({
      count: ++count,
      senderId: typeof event.senderId === 'string' ? event.senderId : null,
      sentTimeMs: Number.isFinite(sentTimeMs) ? sentTimeMs : null,
      receivedTimeMs: Date.now(),
    }));
  });
  setTimeout(() => {
    stop();
    console.log('[Gatherway probe] Stopped');
  }, 120000);
  console.log('[Gatherway probe] Listening for two minutes');
})();
