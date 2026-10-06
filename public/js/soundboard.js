(function () {
  // Hype sounds, synthesized with the Web Audio API — no audio files to
  // host or license. Only loaded on the Big Screen. Browsers refuse to play
  // audio until the page has had a click, so the screen shows an
  // "Enable sound" button that calls unlock() once.
  let ctx = null;
  let master = null;
  let ready = false;

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      master = ctx.createGain();
      master.gain.value = 0.7;
      master.connect(comp);
      comp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    ready = true;
    return true;
  }

  function noiseBuffer(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function envelope(gainNode, t, attack, hold, release, peak) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + attack);
    g.setValueAtTime(peak, t + attack + hold);
    g.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  function blast(t, duration, freqs) {
    const out = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    out.connect(lp);
    lp.connect(master);
    envelope(out, t, 0.015, duration, 0.08, 0.28);
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = (i - 1) * 7;
      o.connect(out);
      o.start(t);
      o.stop(t + duration + 0.12);
    });
  }

  const sounds = {
    airhorn() {
      const t = ctx.currentTime + 0.02;
      const chord = [392, 494, 587];
      blast(t, 0.16, chord);
      blast(t + 0.24, 0.16, chord);
      blast(t + 0.48, 0.9, chord);
    },

    siren() {
      const t = ctx.currentTime + 0.02;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.9;
      lfoGain.gain.value = 320;
      o.frequency.value = 820;
      lfo.connect(lfoGain);
      lfoGain.connect(o.frequency);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2000;
      o.connect(lp);
      lp.connect(g);
      g.connect(master);
      envelope(g, t, 0.05, 2.2, 0.3, 0.14);
      o.start(t);
      lfo.start(t);
      o.stop(t + 2.7);
      lfo.stop(t + 2.7);
    },

    cheer() {
      const t = ctx.currentTime + 0.02;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(3.2);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.7;
      bp.frequency.setValueAtTime(1100, t);
      bp.frequency.linearRampToValueAtTime(2300, t + 1.4);
      const g = ctx.createGain();
      src.connect(bp);
      bp.connect(g);
      g.connect(master);
      envelope(g, t, 0.7, 1.4, 1.0, 0.5);
      src.start(t);

      // scattered claps on top of the crowd noise
      for (let i = 0; i < 26; i++) {
        const ct = t + 0.3 + Math.random() * 2.4;
        const clap = ctx.createBufferSource();
        clap.buffer = noiseBuffer(0.06);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 1500;
        const cg = ctx.createGain();
        clap.connect(hp);
        hp.connect(cg);
        cg.connect(master);
        envelope(cg, ct, 0.002, 0.01, 0.05, 0.25);
        clap.start(ct);
      }
    },

    scratch() {
      const t = ctx.currentTime + 0.02;
      for (let i = 0; i < 4; i++) {
        const st = t + i * 0.17;
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer(0.2);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 6;
        const up = i % 2 === 0;
        bp.frequency.setValueAtTime(up ? 400 : 3000, st);
        bp.frequency.exponentialRampToValueAtTime(up ? 3000 : 400, st + 0.15);
        const g = ctx.createGain();
        src.connect(bp);
        bp.connect(g);
        g.connect(master);
        envelope(g, st, 0.01, 0.1, 0.05, 0.55);
        src.start(st);
      }
    },

    drumroll() {
      const t = ctx.currentTime + 0.02;
      const hits = 52;
      for (let i = 0; i < hits; i++) {
        const ht = t + i * 0.042;
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer(0.08);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 900;
        const g = ctx.createGain();
        src.connect(hp);
        hp.connect(g);
        g.connect(master);
        const peak = 0.08 + (i / hits) * 0.5;
        envelope(g, ht, 0.002, 0.012, 0.045, peak);
        src.start(ht);
      }
      // crash at the end of the roll
      const ct = t + hits * 0.042 + 0.05;
      const crash = ctx.createBufferSource();
      crash.buffer = noiseBuffer(1.6);
      const chp = ctx.createBiquadFilter();
      chp.type = 'highpass';
      chp.frequency.value = 3500;
      const cg = ctx.createGain();
      crash.connect(chp);
      chp.connect(cg);
      cg.connect(master);
      envelope(cg, ct, 0.003, 0.05, 1.3, 0.7);
      crash.start(ct);
    },

    laser() {
      const t = ctx.currentTime + 0.02;
      for (let i = 0; i < 4; i++) {
        const lt = t + i * 0.22;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(2400, lt);
        o.frequency.exponentialRampToValueAtTime(110, lt + 0.3);
        o.connect(g);
        g.connect(master);
        envelope(g, lt, 0.005, 0.08, 0.2, 0.18);
        o.start(lt);
        o.stop(lt + 0.35);
      }
    },
  };

  function play(name) {
    if (!ready || !sounds[name]) return;
    if (ctx.state === 'suspended') ctx.resume();
    sounds[name]();
  }

  window.DJXAudio = {
    unlock,
    play,
    get ready() {
      return ready;
    },
  };
})();
