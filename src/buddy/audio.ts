/** microphone -> 16 kHz 16-bit PCM chunks (base64), and speaker for the 24 kHz PCM that Gemini sends back */

const toB64 = (u8: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};

export class MicCapture {
  onChunk: (b64: string) => void = () => undefined;
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private carry = new Float32Array(0);
  private cpos = 0;
  private out: number[] = [];

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const ctx = new AudioContext();
    this.ctx = ctx;
    const code = "class P extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor('pcm-cap',P)";
    const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const src = ctx.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(ctx, 'pcm-cap');
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);
    node.port.onmessage = (e) => this.push(e.data as Float32Array);
    await ctx.resume();
  }

  private push(f: Float32Array) {
    const r = (this.ctx?.sampleRate ?? 48000) / 16000;
    const buf = new Float32Array(this.carry.length + f.length);
    buf.set(this.carry); buf.set(f, this.carry.length);
    let pos = this.cpos;
    while (pos + r <= buf.length) {
      const a = Math.floor(pos), b = Math.max(a + 1, Math.min(buf.length, Math.floor(pos + r)));
      let s = 0;
      for (let i = a; i < b; i++) s += buf[i];
      this.out.push(s / (b - a));
      pos += r;
    }
    const k = Math.floor(pos);
    this.carry = buf.slice(k);
    this.cpos = pos - k;
    if (this.out.length >= 1600) {                       // ~100 ms
      const pcm = new Int16Array(this.out.length);
      for (let i = 0; i < pcm.length; i++) pcm[i] = Math.max(-1, Math.min(1, this.out[i])) * 0x7fff;
      this.out = [];
      this.onChunk(toB64(new Uint8Array(pcm.buffer)));
    }
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    this.stream = undefined; this.ctx = undefined;
  }
}

export class Speaker {
  private ctx = new AudioContext();
  private analyser = this.ctx.createAnalyser();
  private gain = this.ctx.createGain();
  private next = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private buf = new Uint8Array(256);

  constructor() {
    this.analyser.fftSize = 512;
    this.gain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }
  resume() { return this.ctx.resume(); }

  play(b64: string) {
    const bin = atob(b64);
    const n = bin.length >> 1;
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) << 16 >> 16;   // signed 16-bit LE
      f[i] = v / 32768;
    }
    const ab = this.ctx.createBuffer(1, n, 24000);
    ab.copyToChannel(f, 0);
    const s = this.ctx.createBufferSource();
    s.buffer = ab;
    s.connect(this.gain);
    const t = Math.max(this.ctx.currentTime + 0.02, this.next);
    s.start(t);
    this.next = t + ab.duration;
    this.sources.add(s);
    s.onended = () => this.sources.delete(s);
  }

  /** the student interrupted: stop talking right now */
  clear() {
    this.sources.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } });
    this.sources.clear();
    this.next = 0;
  }

  get speaking() { return this.sources.size > 0; }

  /** 0..1 loudness of what is playing now (drives the character's mouth/bounce) */
  level() {
    if (!this.sources.size) return 0;
    this.analyser.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) { const v = (this.buf[i] - 128) / 128; sum += v * v; }
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 4);
  }

  close() { this.clear(); void this.ctx.close().catch(() => undefined); }
}
