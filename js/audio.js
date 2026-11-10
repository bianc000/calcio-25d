// Sistema Audio Procedurale con Web Audio API (senza file esterni)
class SoundManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.initialized = true;
      }
    } catch (e) {
      console.warn("AudioContext non supportato o bloccato:", e);
    }
  }

  resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  // Calcio normale / passaggio
  playKick(power = 1) {
    if (this.muted || !this.ctx) return;
    this.resume();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140 + power * 40, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.12);

    gain.gain.setValueAtTime(0.4 * Math.min(1.2, power), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.12);
  }

  // Tiro potente
  playPowerShot() {
    if (this.muted || !this.ctx) return;
    this.resume();
    const now = this.ctx.currentTime;

    // Sub-bass thump
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.25);
    gain.gain.setValueAtTime(0.7, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);

    // Click/whoosh
    const bufferSize = this.ctx.sampleRate * 0.15;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.04));
    }
    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = buffer;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.3, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    whiteNoise.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);
    whiteNoise.start(now);
  }

  // Fischietto arbitro (doppia frequenza modulata)
  playWhistle(isDouble = false) {
    if (this.muted || !this.ctx) return;
    this.resume();

    const playSingleWhistle = (startTime, duration) => {
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';

      osc1.frequency.setValueAtTime(2850, startTime);
      osc2.frequency.setValueAtTime(3120, startTime);

      // Tremolo / effetto pallina nel fischietto
      const mod = this.ctx.createOscillator();
      const modGain = this.ctx.createGain();
      mod.frequency.setValueAtTime(35, startTime);
      modGain.gain.setValueAtTime(300, startTime);
      mod.connect(osc1.frequency);
      mod.connect(osc2.frequency);

      gain.gain.setValueAtTime(0.01, startTime);
      gain.gain.linearRampToValueAtTime(0.25, startTime + 0.03);
      gain.gain.setValueAtTime(0.25, startTime + duration - 0.05);
      gain.gain.linearRampToValueAtTime(0.001, startTime + duration);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      mod.start(startTime);
      osc1.start(startTime);
      osc2.start(startTime);

      mod.stop(startTime + duration);
      osc1.stop(startTime + duration);
      osc2.stop(startTime + duration);
    };

    const now = this.ctx.currentTime;
    if (isDouble) {
      playSingleWhistle(now, 0.22);
      playSingleWhistle(now + 0.28, 0.45);
    } else {
      playSingleWhistle(now, 0.35);
    }
  }

  // Suono del Palo / Traversa (metallo risonante)
  playPost() {
    if (this.muted || !this.ctx) return;
    this.resume();
    const now = this.ctx.currentTime;
    const freqs = [520, 1040, 1680];
    freqs.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.3 / (idx + 1), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.6);
    });
  }

  // Scivolata / contrasto
  playSlide() {
    if (this.muted || !this.ctx) return;
    this.resume();
    const now = this.ctx.currentTime;
    const bufferSize = this.ctx.sampleRate * 0.2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.08));
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, now);
    filter.frequency.linearRampToValueAtTime(300, now + 0.2);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    noise.start(now);
  }

  // Boato del pubblico per il Gol!
  playGoalCheer() {
    if (this.muted || !this.ctx) return;
    this.resume();
    const now = this.ctx.currentTime;
    const duration = 2.8;
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1);
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(450, now);
    filter.Q.setValueAtTime(1.2, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.45, now + 0.5);
    gain.gain.linearRampToValueAtTime(0.35, now + 1.8);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    noise.start(now);

    // Suono fischio insieme
    setTimeout(() => this.playWhistle(true), 200);
  }

  // Suono click interfaccia
  playBeep(freq = 600, dur = 0.08) {
    if (this.muted || !this.ctx) return;
    this.resume();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + dur);
  }

  // Notifica Special Ready (Arpeggio celestiale)
  playSpecialReady() {
    if (this.muted || !this.ctx) return;
    this.resume();
    const freqs = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    freqs.forEach((freq, idx) => {
      setTimeout(() => this.playBeep(freq, 0.12), idx * 70);
    });
  }

  // Mario Strikers Super Strike / Special Unleash
  playSpecialStrike(type = 'shot') {
    if (this.muted || !this.ctx) return;
    this.resume();
    const now = this.ctx.currentTime;

    // 1. Synth bass sweep
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(65, now + 0.4);

    gain.gain.setValueAtTime(0.7, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.45);

    // 2. Whoosh / Laser blast
    this.playPowerShot();
  }

  // Verso del Falco per l'abilità di Ara
  playEagleCry() {
    if (this.muted || !this.ctx) return;
    this.resume();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1800, now);
    osc.frequency.linearRampToValueAtTime(2600, now + 0.12);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.45);

    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.45);
  }
}

export const sounds = new SoundManager();
