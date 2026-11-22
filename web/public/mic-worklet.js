// Resamples mic audio to 16 kHz mono int16 and posts ~100 ms frames.
// Each output sample is the average of the input samples it covers (a box filter),
// which keeps high frequencies from folding back into the speech band as noise.
class Mic extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.acc = 0;
    this.sum = 0;
    this.count = 0;
    this.out = new Int16Array(1600);
    this.n = 0;
    this.level = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      this.level = Math.max(this.level * 0.9995, Math.abs(x));
      this.sum += x;
      this.count += 1;
      this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        const y = this.sum / this.count;
        this.sum = 0;
        this.count = 0;
        this.out[this.n++] = Math.max(-1, Math.min(1, y)) * 32767;
        if (this.n === this.out.length) {
          this.port.postMessage({ pcm: this.out.buffer.slice(0), level: this.level });
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("mic", Mic);
