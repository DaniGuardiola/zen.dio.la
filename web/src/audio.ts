/**
 * Audio in the page: mic capture (sent to the companion) and playback of the
 * monk's voice, keeping track of exactly which words have been heard.
 */

import { voiceBus } from "./fx.ts";

export type Word = { w: string; s: number; e: number };
type Chunk = { id: string; buffer: AudioBuffer; words: Word[]; text: string; start?: number; src?: AudioBufferSourceNode };

let ctx: AudioContext | undefined;
export const audio = () => (ctx ??= new AudioContext());

export class Player {
  private queue: Chunk[] = [];
  private played: Chunk[] = [];
  private out: GainNode;
  private cursor = 0; // when the next chunk starts, in ctx time
  playing = false;

  constructor(
    private onAudible: (on: boolean) => void,
    private onWord: (heardSoFar: string) => void,
  ) {
    this.out = audio().createGain();
    this.out.connect(voiceBus());
    requestAnimationFrame(this.tick);
  }

  push(id: string, sr: number, pcmB64: string, words: Word[], text: string) {
    const bytes = Uint8Array.from(atob(pcmB64), (c) => c.charCodeAt(0));
    const i16 = new Int16Array(bytes.buffer);
    const buf = audio().createBuffer(1, i16.length, sr);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < i16.length; i++) ch[i] = i16[i]! / 32768;
    const chunk: Chunk = { id, buffer: buf, words: words.length ? words : [{ w: text, s: 0, e: buf.duration }], text };
    const src = audio().createBufferSource();
    src.buffer = buf;
    src.connect(this.out);
    const t = Math.max(audio().currentTime + 0.05, this.cursor);
    src.start(t);
    chunk.start = t;
    chunk.src = src;
    this.cursor = t + buf.duration + 0.04; // pauses are already in the audio
    this.queue.push(chunk);
    if (!this.playing) {
      this.playing = true;
      this.onAudible(true);
    }
  }

  /** What is reaching the ears now: the context clock runs ahead of the speakers. */
  private now() {
    const a = audio();
    return a.currentTime - (a.outputLatency || 0) - (a.baseLatency || 0);
  }

  /**
   * Text up to a point in the reply. `heard()` counts a word once it has finished (what
   * the visitor actually got, for interruptions); `speaking()` counts it as it begins
   * (for showing words in step with the voice).
   */
  private upTo(edge: "s" | "e", lead = 0): string {
    const t = this.now() + lead;
    let out = "";
    for (const c of [...this.played, ...this.queue]) {
      if (c.start === undefined || t < c.start) break;
      for (const w of c.words) if (t - c.start >= w[edge]) out += w.w;
    }
    return out.replace(/\s+/g, " ").trim();
  }

  heard(): string {
    return this.upTo("e");
  }

  /** How far ahead of the voice words appear. Reading takes a beat, so text in exact
   * sync with speech feels late; this much lead makes them land together. */
  static LEAD = 0.1;

  speaking(): string {
    return this.upTo("s", Player.LEAD);
  }

  /** Total text queued for this reply. */
  all(): string {
    return [...this.played, ...this.queue].map((c) => c.text).join(" ");
  }

  duck(on: boolean) {
    this.out.gain.setTargetAtTime(on ? 0.25 : 1, audio().currentTime, 0.08);
  }

  /** Stop now; returns what was heard. */
  stop(): string {
    const heard = this.heard();
    for (const c of this.queue) c.src?.stop();
    this.queue = [];
    this.played = [];
    this.cursor = 0;
    this.duck(false);
    if (this.playing) {
      this.playing = false;
      this.onAudible(false);
    }
    return heard;
  }

  /** Start of a new reply. */
  reset() {
    this.played = [];
  }

  private tick = () => {
    const t = audio().currentTime;
    while (this.queue.length && t >= this.queue[0]!.start! + this.queue[0]!.buffer.duration) this.played.push(this.queue.shift()!);
    if (this.playing) this.onWord(this.speaking());
    if (this.playing && !this.queue.length && t > this.cursor - 0.1) {
      this.playing = false;
      this.onAudible(false);
    }
    requestAnimationFrame(this.tick);
  };
}

export async function startMic(onFrame: (pcm: ArrayBuffer, level: number) => void) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const a = audio();
  await a.audioWorklet.addModule("/mic-worklet.js");
  const node = new AudioWorkletNode(a, "mic");
  node.port.onmessage = (e) => onFrame(e.data.pcm, e.data.level);
  const src = a.createMediaStreamSource(stream);
  src.connect(node);
  return () => {
    src.disconnect();
    node.disconnect();
    stream.getTracks().forEach((t) => t.stop());
  };
}

/** A small bowl, struck softly. */
export function bell(strength = 1) {
  const a = audio();
  const t = a.currentTime;
  const master = a.createGain();
  master.gain.value = 0.12 * strength;
  master.connect(voiceBus());
  for (const [f, g, d] of [
    [220, 1, 7],
    [220 * 2.76, 0.4, 4],
    [220 * 5.4, 0.15, 2.5],
    [221.6, 0.6, 6],
  ] as const) {
    const o = a.createOscillator();
    const env = a.createGain();
    o.frequency.value = f;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(g, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(env).connect(master);
    o.start(t);
    o.stop(t + d);
  }
}
