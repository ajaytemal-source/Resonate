class MicProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.inputSampleRate = sampleRate; // provided by AudioWorklet global
    const opts = (options && options.processorOptions) || {};
    this.targetSampleRate = opts.targetSampleRate || 16000;
    this.chunkMs = opts.chunkMs || 20; // 20–40ms recommended

    this.step = this.inputSampleRate / this.targetSampleRate;
    this.readIndex = 0; // fractional index into inputBuffer
    this.inputBuffer = new Float32Array(0);

    this.samplesPerChunk = Math.round((this.targetSampleRate * this.chunkMs) / 1000);
    this.mulawChunkBuffer = new Uint8Array(0);

    // --- Noise profiling & reduction (adaptive) ---
    // Profiling duration for initial noise estimate
    this.noiseProfileTarget = Math.max(1, Math.round(this.targetSampleRate * ((opts.noiseProfileMs || 300) / 1000)));
    this.noiseProfileSamples = 0;

    // Multi-band split using simple first-order IIR low-pass filters
    // Cutoffs chosen for speech: ~300 Hz (low), ~3000 Hz (mid)
    this.lowCutHz = 300;
    this.midCutHz = 3000;
    this.alphaLow = 1 - Math.exp(-2 * Math.PI * this.lowCutHz / this.targetSampleRate);
    this.alphaMid = 1 - Math.exp(-2 * Math.PI * this.midCutHz / this.targetSampleRate);
    this.lpfLow = 0; // state for low cutoff LPF
    this.lpfMid = 0; // state for mid cutoff LPF

    // Energy tracking (EMA of power)
    this.sigAlpha = 0.05;       // signal power smoothing
    this.noiseAlphaFast = 0.01; // track rising noise a bit faster
    this.noiseAlphaSlow = 0.001;// very slow when speech is present
    this.minGain = 0.2;         // floor attenuation to avoid artifacts
    this.reduction = 0.8;       // spectral subtraction strength

    this.sigPowLow = 1e-8;
    this.sigPowMid = 1e-8;
    this.sigPowHigh = 1e-8;
    this.noisePowLow = 1e-6;
    this.noisePowMid = 1e-6;
    this.noisePowHigh = 1e-6;
  }

  // G.711 mulaw encoder for 16-bit PCM input
  static linearToMulaw(sampleInt16) {
    let linear = sampleInt16;
    const BIAS = 0x84;
    const CLIP = 32635;
    let sign = (linear >> 8) & 0x80;
    if (sign !== 0) linear = -linear;
    if (linear > CLIP) linear = CLIP;
    linear += BIAS;
    let exponent = 0;
    for (let expMask = 0x4000; (linear & expMask) === 0 && exponent < 8; exponent++, expMask >>= 1);
    const mantissa = (linear >> (exponent + 3)) & 0x0f;
    const mulaw = ~(sign | (exponent << 4) | mantissa);
    return mulaw & 0xff;
  }

  appendToInputBuffer(frame) {
    const old = this.inputBuffer;
    const merged = new Float32Array(old.length + frame.length);
    merged.set(old, 0);
    merged.set(frame, old.length);
    this.inputBuffer = merged;
  }

  resampleAndEncode(frame) {
    // Append the new frame first
    this.appendToInputBuffer(frame);

    const outputs = [];
    // Generate target-rate samples using linear interpolation
    while (this.readIndex + 1 < this.inputBuffer.length) {
      const i0 = Math.floor(this.readIndex);
      const frac = this.readIndex - i0;
      const s0 = this.inputBuffer[i0];
      const s1 = this.inputBuffer[i0 + 1];
      const s = s0 + (s1 - s0) * frac;
      outputs.push(s);
      this.readIndex += this.step;
    }

    // Drop consumed input samples, keep fractional position
    const consumed = Math.floor(this.readIndex);
    if (consumed > 0) {
      this.inputBuffer = this.inputBuffer.slice(consumed);
      this.readIndex -= consumed;
    }

    if (outputs.length === 0) return;

    // --- Noise reduction (runs at 16 kHz target rate) ---
    // Profiling, adaptive noise floor, and multi-band gating
    const denoised = new Float32Array(outputs.length);
    for (let i = 0; i < outputs.length; i++) {
      const x = outputs[i];

      // Band split via LPFs
      this.lpfLow += this.alphaLow * (x - this.lpfLow);
      const low = this.lpfLow;
      this.lpfMid += this.alphaMid * (x - this.lpfMid);
      const mid = this.lpfMid - this.lpfLow; // between ~300 and ~3000 Hz
      const high = x - this.lpfMid;          // > ~3000 Hz

      // Update signal power EMAs per band
      const l2 = low * low;
      const m2 = mid * mid;
      const h2 = high * high;
      this.sigPowLow = (1 - this.sigAlpha) * this.sigPowLow + this.sigAlpha * l2;
      this.sigPowMid = (1 - this.sigAlpha) * this.sigPowMid + this.sigAlpha * m2;
      this.sigPowHigh = (1 - this.sigAlpha) * this.sigPowHigh + this.sigAlpha * h2;

      // Simple voice activity heuristic per band
      const lowRms = Math.sqrt(this.sigPowLow + 1e-12);
      const midRms = Math.sqrt(this.sigPowMid + 1e-12);
      const highRms = Math.sqrt(this.sigPowHigh + 1e-12);
      const lowNoise = Math.sqrt(this.noisePowLow + 1e-12);
      const midNoise = Math.sqrt(this.noisePowMid + 1e-12);
      const highNoise = Math.sqrt(this.noisePowHigh + 1e-12);
      const lowIsSpeech = lowRms > lowNoise * 1.5;
      const midIsSpeech = midRms > midNoise * 1.5;
      const highIsSpeech = highRms > highNoise * 1.5;

      // Update noise floor: faster when perceived as noise, very slow when speech
      const aNLow = lowIsSpeech ? this.noiseAlphaSlow : this.noiseAlphaFast;
      const aNMid = midIsSpeech ? this.noiseAlphaSlow : this.noiseAlphaFast;
      const aNHigh = highIsSpeech ? this.noiseAlphaSlow : this.noiseAlphaFast;
      this.noisePowLow = (1 - aNLow) * this.noisePowLow + aNLow * l2;
      this.noisePowMid = (1 - aNMid) * this.noisePowMid + aNMid * m2;
      this.noisePowHigh = (1 - aNHigh) * this.noisePowHigh + aNHigh * h2;

      // During initial profiling, bias noise floor upward a bit
      if (this.noiseProfileSamples < this.noiseProfileTarget) {
        this.noisePowLow = Math.max(this.noisePowLow, l2);
        this.noisePowMid = Math.max(this.noisePowMid, m2);
        this.noisePowHigh = Math.max(this.noisePowHigh, h2);
        this.noiseProfileSamples++;
      }

      // Compute soft gains per band (spectral subtraction-like)
      const gl = Math.max(this.minGain, Math.min(1, 1 - this.reduction * (lowNoise / (lowRms + 1e-6))))
      const gm = Math.max(this.minGain, Math.min(1, 1 - this.reduction * (midNoise / (midRms + 1e-6))))
      const gh = Math.max(this.minGain, Math.min(1, 1 - this.reduction * (highNoise / (highRms + 1e-6))))

      // Recombine bands
      let y = low * gl + mid * gm + high * gh;
      // Gentle limiter
      if (y > 1) y = 1;
      else if (y < -1) y = -1;
      denoised[i] = y;
    }

    // Convert to mulaw bytes and accumulate into chunk buffer
    // NOTE: mulaw encoding happens AFTER noise reduction
    const outLen = denoised.length;
    const encoded = new Uint8Array(outLen);
    for (let i = 0; i < outLen; i++) {
      // clamp to [-1,1], convert to 16-bit PCM
      const x = Math.max(-1, Math.min(1, denoised[i]));
      const s16 = x < 0 ? Math.round(x * 32768) : Math.round(x * 32767);
      encoded[i] = MicProcessor.linearToMulaw(s16);
    }

    // Append to mulawChunkBuffer
    const prev = this.mulawChunkBuffer;
    const merged = new Uint8Array(prev.length + encoded.length);
    merged.set(prev, 0);
    merged.set(encoded, prev.length);
    this.mulawChunkBuffer = merged;

    // Post fixed-size chunks for realtime streaming
    while (this.mulawChunkBuffer.length >= this.samplesPerChunk) {
      const chunk = this.mulawChunkBuffer.slice(0, this.samplesPerChunk);
      this.mulawChunkBuffer = this.mulawChunkBuffer.slice(this.samplesPerChunk);
      this.port.postMessage(chunk, [chunk.buffer]);
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channelData = input[0]; // mono
    if (!channelData) return true;

    this.resampleAndEncode(channelData);
    return true;
  }
}

registerProcessor('mic-processor', MicProcessor);