/**
 * The room's acoustics: the monk's voice and the bowl pass through a little warmth
 * and a small, dark stone room; underneath, a barely-there room tone.
 */
import { audio } from "./audio.ts";

let voiceIn: AudioNode | undefined;
let ambience: GainNode | undefined;
let wet: GainNode | undefined;

/** Settings the visitor controls (see controls.ts); applied to the graph below. */
export const prefs = { volume: 0.9, muted: false, ambience: true, room: true };

let out: { level: GainNode; presence: GainNode; amb: GainNode } | undefined;

/**
 * The end of every chain: ambience gate → level (volume, mute) → presence (fades out
 * when the page loses focus) → speakers.
 */
function master() {
  if (out) return out;
  const a = audio();
  const presence = new GainNode(a, { gain: 1 });
  const level = new GainNode(a, { gain: prefs.muted ? 0 : prefs.volume ** 2 });
  const amb = new GainNode(a, { gain: prefs.ambience ? 1 : 0 });
  amb.connect(level);
  level.connect(presence).connect(a.destination);
  out = { level, presence, amb };
  return out;
}

/** Apply `prefs` smoothly. */
export function applyPrefs() {
  const a = audio();
  const m = master();
  m.level.gain.setTargetAtTime(prefs.muted ? 0 : prefs.volume ** 2, a.currentTime, 0.05);
  m.amb.gain.setTargetAtTime(prefs.ambience ? 1 : 0, a.currentTime, 0.4);
  wet?.gain.setTargetAtTime(prefs.room ? 0.12 : 0, a.currentTime, 0.2);
}

let away: number | undefined;

/**
 * Step away from the room (page hidden or unfocused): everything fades out, then the
 * audio clock stops, so the monk's voice picks up exactly where it left off.
 */
export function setPresent(present: boolean) {
  const a = audio();
  const p = master().presence.gain;
  clearTimeout(away);
  p.cancelScheduledValues(a.currentTime);
  if (present) {
    if (a.state === "suspended") a.resume();
    p.setTargetAtTime(1, a.currentTime, 0.35);
  } else {
    p.setTargetAtTime(0, a.currentTime, 0.4);
    away = setTimeout(() => a.suspend(), 1800) as unknown as number;
  }
}

/** Synthetic impulse response: a few early reflections, then a tail that darkens as it decays. */
function room(a: AudioContext, seconds = 1.8, decay = 0.38) {
  const len = Math.floor(a.sampleRate * seconds);
  const ir = a.createBuffer(2, len, a.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / a.sampleRate;
      // One-pole low-pass that closes over time: high frequencies die first, like stone and wood.
      const k = 0.55 - 0.5 * Math.min(1, t / seconds);
      lp += k * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.exp(-t / decay);
    }
    for (const [ms, g] of [
      [11, 0.5],
      [19, 0.35],
      [29, 0.28],
      [43, 0.2],
    ] as const)
      d[Math.floor(((ms + ch * 3) / 1000) * a.sampleRate)]! += g * (ch ? -1 : 1);
  }
  return ir;
}

/** The node the monk's voice and the bowl should connect to. */
export function voiceBus(): AudioNode {
  if (voiceIn) return voiceIn;
  const a = audio();

  // Warmth: a little body, a little less edge.
  const low = new BiquadFilterNode(a, { type: "lowshelf", frequency: 180, gain: 3 });
  const mid = new BiquadFilterNode(a, { type: "peaking", frequency: 3200, Q: 0.8, gain: -2 });
  const high = new BiquadFilterNode(a, { type: "highshelf", frequency: 7000, gain: -5 });
  low.connect(mid).connect(high);

  const glue = new DynamicsCompressorNode(a, { threshold: -20, knee: 12, ratio: 2.5, attack: 0.01, release: 0.3 });
  glue.connect(master().level);

  const dry = new GainNode(a, { gain: 1 });
  high.connect(dry).connect(glue);

  const pre = new DelayNode(a, { delayTime: 0.028 });
  const verb = new ConvolverNode(a, { buffer: room(a) });
  wet = new GainNode(a, { gain: prefs.room ? 0.12 : 0 });
  high.connect(pre).connect(verb).connect(wet).connect(glue);

  voiceIn = low;
  return low;
}

/** Room tone: low brown noise breathing slowly, almost below hearing. Fades in. */
export function startAmbience() {
  if (ambience) return;
  const a = audio();
  const secs = 10;
  const buf = a.createBuffer(2, a.sampleRate * secs, a.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b = 0;
    for (let i = 0; i < d.length; i++) {
      b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = b * 3.5;
    }
    // Crossfade the loop seam.
    const fade = a.sampleRate;
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = d[i]! * k + d[d.length - fade + i]! * (1 - k);
    }
  }
  const src = new AudioBufferSourceNode(a, { buffer: buf, loop: true, loopStart: 1, loopEnd: secs - 0 });
  const lp = new BiquadFilterNode(a, { type: "lowpass", frequency: 380, Q: 0.3 });
  ambience = new GainNode(a, { gain: 0 });
  const breathe = new OscillatorNode(a, { frequency: 0.045 });
  const depth = new GainNode(a, { gain: 0.006 });
  breathe.connect(depth).connect(ambience.gain);
  src.connect(lp).connect(ambience).connect(master().amb);
  src.start();
  breathe.start();
  ambience.gain.setValueAtTime(0, a.currentTime);
  ambience.gain.linearRampToValueAtTime(0.022, a.currentTime + 8);
}

/** Let the room fall quiet (companion gone, or leaving). */
export function stopAmbience() {
  if (!ambience) return;
  const a = audio();
  const g = ambience;
  ambience = undefined;
  g.gain.cancelScheduledValues(a.currentTime);
  g.gain.setTargetAtTime(0, a.currentTime, 0.6);
  setTimeout(() => g.disconnect(), 4000);
}
