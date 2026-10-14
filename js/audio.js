(function () {
  'use strict';

  const DZ = window.DZ = window.DZ || {};
  const MASTER_VOLUME = 0.25;
  const MAX_VOICES = 24;

  DZ.Audio = class Audio {
    constructor() {
      this._context = null;
      this._master = null;
      this._limiter = null;
      this._noise = null;
      this._muted = false;
      this._voices = new Set();
      this._growlUntil = 0;
    }

    unlock() {
      let context = this._context;
      if (!context || context.state === 'closed') {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return Promise.resolve(false);

        try {
          for (const voice of this._voices) this._release(voice);
          context = new AudioContext();
          const master = context.createGain();
          const limiter = context.createWaveShaper();
          const curve = new Float32Array(2049);
          const scale = Math.tanh(1.25);
          for (let i = 0; i < curve.length; i++) {
            const x = (i / (curve.length - 1)) * 2 - 1;
            curve[i] = Math.tanh(x * 1.25) / scale;
          }
          limiter.curve = curve;
          limiter.oversample = '2x';
          master.gain.value = this._muted ? 0 : MASTER_VOLUME;
          limiter.connect(master);
          master.connect(context.destination);

          const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
          const samples = noise.getChannelData(0);
          for (let i = 0; i < samples.length; i++) {
            samples[i] = Math.random() * 2 - 1;
          }

          this._context = context;
          this._master = master;
          this._limiter = limiter;
          this._noise = noise;
          this._growlUntil = 0;
        } catch (_) {
          if (context && context.state !== 'closed') {
            try { Promise.resolve(context.close()).catch(() => {}); } catch (_) {}
          }
          return Promise.resolve(false);
        }
      }

      // 必须在按钮手势的同步调用栈内恢复，避免浏览器拦截声音。
      try {
        if (context.state === 'running') return Promise.resolve(true);
        return Promise.resolve(context.resume())
          .then(() => context.state === 'running', () => false);
      } catch (_) {
        return Promise.resolve(false);
      }
    }

    setMuted(muted) {
      this._muted = Boolean(muted);
      if (!this._master || !this._context || this._context.state === 'closed') return;
      const now = this._context.currentTime;
      const gain = this._master.gain;
      if (typeof gain.cancelAndHoldAtTime === 'function') {
        gain.cancelAndHoldAtTime(now);
      } else {
        const value = gain.value;
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(value, now);
      }
      gain.linearRampToValueAtTime(this._muted ? 0 : MASTER_VOLUME, now + 0.02);
    }

    _ready() {
      return !this._muted && this._context && this._context.state === 'running';
    }

    _release(voice) {
      voice.source.onended = null;
      for (const node of voice.nodes) node.disconnect();
      this._voices.delete(voice);
    }

    _play(options) {
      if (!this._ready() || this._voices.size >= MAX_VOICES) return false;
      const context = this._context;
      const start = context.currentTime + 0.005 + (options.delay || 0);
      const duration = options.duration || 0.12;
      const end = start + duration;
      const nodes = [];
      let source;
      let voice;

      try {
        source = options.noise ? context.createBufferSource() : context.createOscillator();
        nodes.push(source);
        if (options.noise) {
          source.buffer = this._noise;
          source.loop = false;
        } else {
          source.type = options.type || 'sine';
          source.frequency.setValueAtTime(options.from || 440, start);
          source.frequency.exponentialRampToValueAtTime(options.to || options.from || 440, end);
        }

        let output = source;
        if (options.filter) {
          const filter = context.createBiquadFilter();
          nodes.push(filter);
          filter.type = options.filter;
          const maxHz = context.sampleRate * 0.45;
          const hz = Math.min(options.filterHz || 2000, maxHz);
          filter.frequency.setValueAtTime(hz, start);
          if (options.filterTo) {
            filter.frequency.exponentialRampToValueAtTime(Math.min(options.filterTo, maxHz), end);
          }
          filter.Q.value = options.q || 0.7;
          output.connect(filter);
          output = filter;
        }

        const envelope = context.createGain();
        nodes.push(envelope);
        const attack = Math.min(options.attack || 0.003, duration * 0.3);
        envelope.gain.setValueAtTime(0, start);
        envelope.gain.linearRampToValueAtTime(options.volume || 0.15, start + attack);
        envelope.gain.exponentialRampToValueAtTime(0.0001, end - 0.003);
        envelope.gain.linearRampToValueAtTime(0, end);
        output.connect(envelope);
        envelope.connect(this._limiter);

        voice = { source, nodes };
        this._voices.add(voice);
        // 用音频结束事件释放节点，后台标签页的计时器可能被节流。
        source.onended = () => this._release(voice);
        if (options.noise) {
          const offset = Math.random() * Math.max(0, this._noise.duration - duration - 0.01);
          source.start(start, offset);
        } else {
          source.start(start);
        }
        source.stop(end);
        return true;
      } catch (_) {
        if (source) {
          source.onended = null;
          try { source.stop(); } catch (_) {}
        }
        for (const node of nodes) node.disconnect();
        if (voice) this._voices.delete(voice);
        return false;
      }
    }

    shot(type) {
      if (type === 'rifle') {
        this._play({ noise: true, duration: 0.105, volume: 0.32,
          filter: 'lowpass', filterHz: 6500, filterTo: 1000 });
        this._play({ type: 'sawtooth', from: 185, to: 48, duration: 0.11,
          volume: 0.17, filter: 'lowpass', filterHz: 1800, filterTo: 180 });
      } else if (type === 'pistol') {
        this._play({ noise: true, duration: 0.17, volume: 0.27,
          filter: 'bandpass', filterHz: 2800, filterTo: 650, q: 0.8 });
        this._play({ from: 155, to: 38, duration: 0.23, volume: 0.32 });
      }
    }

    reload() {
      [0, 0.13, 0.43, 0.65].forEach((delay, index) => {
        this._play({ noise: true, delay, duration: index === 2 ? 0.065 : 0.025,
          volume: 0.13, filter: 'bandpass', filterHz: index === 2 ? 1700 : 4200, q: 2 });
        this._play({ type: 'triangle', delay, from: index === 3 ? 2600 : 1900,
          to: 950, duration: 0.045, volume: 0.07 });
      });
    }

    hit(headshot = false) {
      this._play({ noise: true, duration: 0.035, volume: 0.12,
        filter: 'bandpass', filterHz: 1800 });
      this._play({ type: 'triangle', from: headshot ? 1450 : 760,
        to: headshot ? 2100 : 430, duration: headshot ? 0.1 : 0.06, volume: 0.12 });
      if (headshot) {
        this._play({ from: 2400, to: 1900, delay: 0.055, duration: 0.09, volume: 0.07 });
      }
    }

    growl() {
      if (!this._ready() || this._context.currentTime < this._growlUntil) return;
      const played = this._play({ type: 'sawtooth', from: 83, to: 31, duration: 1.1,
        attack: 0.12, volume: 0.19, filter: 'lowpass', filterHz: 270, filterTo: 85 });
      if (!played) return;
      this._growlUntil = this._context.currentTime + 1.3;
      this._play({ noise: true, duration: 0.95, attack: 0.1, volume: 0.24,
        filter: 'lowpass', filterHz: 320, filterTo: 100 });
      this._play({ from: 46, to: 28, duration: 1.15, attack: 0.08, volume: 0.15 });
    }

    // 膨胀体起爆：低频冲击 + 破片噪声，提示这是一次范围伤害。
    explosion() {
      this._play({ type: 'sine', from: 96, to: 26, duration: 0.5, attack: 0.004, volume: 0.4 });
      this._play({ noise: true, duration: 0.5, volume: 0.36,
        filter: 'lowpass', filterHz: 2200, filterTo: 160 });
      this._play({ type: 'sawtooth', from: 240, to: 52, duration: 0.26, volume: 0.16,
        filter: 'highpass', filterHz: 900 });
    }

    hurt() {
      this._play({ from: 110, to: 32, duration: 0.26, volume: 0.3, attack: 0.006 });
      this._play({ noise: true, duration: 0.15, volume: 0.2,
        filter: 'lowpass', filterHz: 600, filterTo: 120 });
    }

    // 倒地：低频下坠 + 心跳般的闷响，提示进入濒死读条。
    downed() {
      this._play({ type: 'sawtooth', from: 132, to: 41, duration: 0.72, attack: 0.01,
        volume: 0.2, filter: 'lowpass', filterHz: 420, filterTo: 110 });
      this._play({ noise: true, duration: 0.4, volume: 0.16,
        filter: 'lowpass', filterHz: 300, filterTo: 70 });
      this._play({ from: 62, to: 47, delay: 0.34, duration: 0.5, attack: 0.02, volume: 0.15 });
    }

    // 复活：三度上行 + 高频亮点，对应前线重生与无敌开启。
    revive() {
      [261.63, 392, 523.25].forEach((frequency, index) => {
        this._play({ type: 'triangle', from: frequency, to: frequency * 1.01,
          delay: index * 0.085, duration: 0.3, attack: 0.01, volume: 0.14 });
      });
      this._play({ noise: true, delay: 0.2, duration: 0.34, volume: 0.1,
        filter: 'bandpass', filterHz: 2400, filterTo: 5200, q: 1.4 });
    }

    // 传送：短促扫频 + 收尾滴答，强调位置切换。
    teleport() {
      this._play({ noise: true, duration: 0.26, volume: 0.15,
        filter: 'bandpass', filterHz: 420, filterTo: 4200, q: 2.2 });
      this._play({ type: 'sine', from: 180, to: 1250, duration: 0.22, attack: 0.006, volume: 0.13 });
      this._play({ from: 1568, to: 1046.5, delay: 0.2, duration: 0.14, attack: 0.004, volume: 0.1 });
    }

    pickup() {
      [659.25, 830.61, 987.77].forEach((frequency, index) => {
        this._play({ from: frequency, delay: index * 0.075,
          duration: 0.22, attack: 0.008, volume: 0.12 });
      });
    }

    wave() {
      [392, 493.88, 587.33, 783.99].forEach((frequency, index) => {
        this._play({ type: 'triangle', from: frequency, delay: index * 0.12,
          duration: 0.3, attack: 0.012, volume: 0.12 });
      });
    }

    end(won) {
      const notes = won ? [523.25, 659.25, 783.99, 1046.5] : [220, 174.61, 146.83, 110];
      notes.forEach((frequency, index) => {
        this._play({ type: won ? 'sine' : 'triangle', from: frequency,
          to: won ? frequency : frequency * 0.96, delay: index * (won ? 0.14 : 0.22),
          duration: index === 3 ? 0.8 : 0.36, attack: 0.02, volume: 0.14 });
      });
      this._play({ from: won ? 261.63 : 55, duration: 0.85,
        delay: won ? 0.42 : 0.66, attack: 0.025, volume: 0.12 });
    }
  };
})();
