(function (root) {
  "use strict";

  const bus = {
    ctx: null,
    token: 0,

    unlock() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        if (!this.ctx) this.ctx = new AC();
        if (this.ctx.state === "suspended") this.ctx.resume();
      } catch (err) {
        this.ctx = null;
      }
    },

    cancel() {
      this.token += 1;
    },

    tone(freq, dur, type, gain, freq2) {
      if (!root.harvestSoundOn || !this.ctx) return;
      try {
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const amp = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        if (freq2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq2), t + dur);
        amp.gain.setValueAtTime(gain, t);
        amp.gain.exponentialRampToValueAtTime(0.0008, t + dur);
        osc.connect(amp);
        amp.connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + dur + 0.02);
      } catch (err) {
        /* headless or blocked audio should stay quiet */
      }
    },

    harvest() { this.tone(740, 0.08, "sine", 0.06, 1240); },
    mud() { this.tone(120, 0.1, "triangle", 0.07, 68); },
    bale() { this.tone(196, 0.07, "triangle", 0.07, 110); },
    knock() { this.tone(150, 0.05, "triangle", 0.05, 90); },
    barn() { this.tone(392, 0.12, "triangle", 0.05, 523); },

    win() {
      const token = ++this.token;
      const notes = [523, 659, 784, 1046];
      for (let i = 0; i < notes.length; i++) {
        const freq = notes[i];
        setTimeout(() => {
          if (token !== this.token) return;
          this.tone(freq, 0.16, "triangle", 0.055);
        }, i * 120);
      }
    },
  };

  root.harvestSoundOn = false;
  root.HarvestAudio = bus;
})(typeof globalThis !== "undefined" ? globalThis : this);
