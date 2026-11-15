// Procedural sound: every effect is an oscillator or filtered noise burst made in
// code, so the game ships no audio assets and loads nothing over the network.
export function createAudio() {
  let ctx = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function noise(when, dur, filterFreq, gain, type = 'lowpass') {
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, when);
    amp.gain.exponentialRampToValueAtTime(0.001, when + dur);
    src.connect(filter).connect(amp).connect(ctx.destination);
    src.start(when);
    src.stop(when + dur + 0.02);
  }

  function tone(when, freq, dur, gain, type = 'sine', slideTo = null) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(slideTo, when + dur);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, when);
    amp.gain.exponentialRampToValueAtTime(0.001, when + dur);
    osc.connect(amp).connect(ctx.destination);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  return {
    unlock() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); },
    shot(kind) {
      const c = ensure();
      if (!c) return;
      const now = c.currentTime;
      if (kind === 'lance') { noise(now, 0.28, 900, 0.5); tone(now, 160, 0.18, 0.3, 'square', 50); }
      else if (kind === 'longshot') { noise(now, 0.14, 1600, 0.42); tone(now, 220, 0.08, 0.2, 'square', 70); }
      else if (kind === 'rasp') { noise(now, 0.09, 2400, 0.3); }
      else { noise(now, 0.1, 1800, 0.35); }
    },
    distantShot() {
      const c = ensure();
      if (!c) return;
      noise(c.currentTime, 0.12, 700, 0.12);
    },
    dry() { const c = ensure(); if (c) tone(c.currentTime, 1400, 0.03, 0.12, 'square'); },
    reload() {
      const c = ensure();
      if (!c) return;
      const now = c.currentTime;
      tone(now, 900, 0.04, 0.15, 'square');
      tone(now + 0.28, 700, 0.04, 0.15, 'square');
    },
    hit(kill) {
      const c = ensure();
      if (!c) return;
      const now = c.currentTime;
      tone(now, 2100, 0.05, 0.16, 'sine');
      if (kill) tone(now + 0.07, 1500, 0.09, 0.18, 'sine');
    },
    hurt() { const c = ensure(); if (c) tone(c.currentTime, 180, 0.12, 0.25, 'sawtooth', 90); },
    plantBeep(final) {
      const c = ensure();
      if (!c) return;
      tone(c.currentTime, final ? 600 : 1100, 0.07, 0.2, 'square');
    },
    defuseBeep() { const c = ensure(); if (c) tone(c.currentTime, 900, 0.06, 0.18, 'square'); },
    explosion() {
      const c = ensure();
      if (!c) return;
      const now = c.currentTime;
      noise(now, 0.9, 300, 0.8);
      tone(now, 90, 0.8, 0.5, 'sine', 30);
    },
    roundEnd(win) {
      const c = ensure();
      if (!c) return;
      const now = c.currentTime;
      const notes = win ? [523, 659, 784] : [392, 330, 262];
      notes.forEach((f, i) => tone(now + i * 0.13, f, 0.22, 0.18, 'triangle'));
    },
    buy() { const c = ensure(); if (c) { tone(c.currentTime, 1200, 0.06, 0.15, 'sine'); tone(c.currentTime + 0.08, 1600, 0.08, 0.15, 'sine'); } },
    denied() { const c = ensure(); if (c) tone(c.currentTime, 220, 0.12, 0.18, 'square', 160); },
  };
}
