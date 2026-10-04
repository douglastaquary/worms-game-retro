type Tone = { freq: number; dur: number; type?: OscillatorType; gain?: number; slide?: number };

export class GameAudio {
  private context: AudioContext | null = null;
  private muted = false;
  private rotor: { osc: OscillatorNode; gain: GainNode } | null = null;

  get isMuted(): boolean {
    return this.muted;
  }

  unlock(): void {
    const ctx = this.ensure();
    if (ctx.state === 'suspended') void ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.muted) this.stopRotor();
    return this.muted;
  }

  play(kind: string): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (ctx.state === 'suspended') return;
    if (kind === 'fire') this.sweep([{ freq: 220, dur: 0.12, type: 'square', slide: 90, gain: 0.08 }]);
    if (kind === 'explode') this.noise(0.28, 0.18);
    if (kind === 'holy') {
      this.noise(0.45, 0.16);
      this.sweep([
        { freq: 523, dur: 0.4, type: 'triangle', gain: 0.07 },
        { freq: 659, dur: 0.5, type: 'triangle', gain: 0.06 },
        { freq: 784, dur: 0.7, type: 'sine', gain: 0.05 },
      ]);
    }
    if (kind === 'donkey') this.sweep([{ freq: 70, dur: 0.4, type: 'sawtooth', slide: 40, gain: 0.1 }]);
    if (kind === 'splash') this.noise(0.18, 0.08, 1800);
    if (kind === 'hurt') this.sweep([{ freq: 180, dur: 0.1, type: 'square', slide: 80, gain: 0.05 }]);
    if (kind === 'click') this.sweep([{ freq: 640, dur: 0.05, type: 'square', gain: 0.04 }]);
    if (kind === 'win') {
      this.sweep([
        { freq: 523, dur: 0.12, type: 'square', gain: 0.06 },
        { freq: 659, dur: 0.12, type: 'square', gain: 0.06 },
        { freq: 784, dur: 0.28, type: 'square', gain: 0.07 },
      ]);
    }
    if (kind === 'lose') this.sweep([{ freq: 196, dur: 0.4, type: 'triangle', slide: 90, gain: 0.07 }]);
  }

  startRotor(): void {
    if (this.muted || this.rotor) return;
    const ctx = this.ensure();
    if (ctx.state === 'suspended') return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 48;
    gain.gain.value = 0.03;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    this.rotor = { osc, gain };
  }

  stopRotor(): void {
    if (!this.rotor) return;
    try {
      this.rotor.osc.stop();
    } catch {
      /* already stopped */
    }
    this.rotor.osc.disconnect();
    this.rotor.gain.disconnect();
    this.rotor = null;
  }

  dispose(): void {
    this.stopRotor();
    void this.context?.close();
    this.context = null;
  }

  private ensure(): AudioContext {
    if (!this.context) this.context = new AudioContext();
    return this.context;
  }

  private sweep(tones: Tone[]): void {
    const ctx = this.ensure();
    let when = ctx.currentTime;
    for (const tone of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = tone.type ?? 'square';
      osc.frequency.setValueAtTime(tone.freq, when);
      if (tone.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, tone.slide), when + tone.dur);
      gain.gain.setValueAtTime(tone.gain ?? 0.06, when);
      gain.gain.exponentialRampToValueAtTime(0.001, when + tone.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(when);
      osc.stop(when + tone.dur + 0.02);
      when += tone.dur * 0.85;
    }
  }

  private noise(dur: number, gainValue: number, cutoff = 900): void {
    const ctx = this.ensure();
    const length = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start();
  }
}
