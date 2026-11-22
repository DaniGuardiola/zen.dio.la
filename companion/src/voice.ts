/**
 * Voice: bridges the speech sidecar (local STT/TTS) with the monk and the browser.
 *
 * Turn-taking:
 *   - STT "start" while the monk is audible  -> duck the monk's voice
 *   - real words (>= 2, not an echo of the monk) -> barge in: stop playback, ask the
 *     browser how much was heard, interrupt the monk
 *   - STT "final" -> wait a short grace period for the visitor to continue, then send
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DATA_DIR } from "./state.ts";

const SPEECH_PORT = Number(process.env.ZEN_SPEECH_PORT ?? 47471);
const SPEECH_DIR = process.env.ZEN_SPEECH_DIR ?? join(import.meta.dir, "..", "..", "speech");
/** How long to wait for more after the visitor pauses. A finished sentence ends the turn
 * sooner; a trailing fragment ("People can use…") waits longer for the rest. */
// (The speech process has already waited ~0.55 s of silence before calling it a pause.)
const graceFor = (text: string) => (/[.?!]["')\]]*$/.test(text.trim()) ? 600 : 1400);
const log = (...a: unknown[]) => console.log("[voice]", ...a);

type SpeechMsg =
  | { type: "ready" }
  | { type: "stt"; kind: "start" | "preview" | "final"; text: string; utt?: number }
  | { type: "audio"; id: string; sr: number; pcm: string; words: { w: string; s: number; e: number }[]; text: string }
  | { type: "spoken"; id: string };

let child: ChildProcess | undefined;

/**
 * Python for the sidecar. A checkout uses speech/.venv; an install builds its own
 * environment with uv the first time voice is used (models download on first start).
 */
async function python(status: (s: string) => void): Promise<string> {
  if (process.env.ZEN_PYTHON) return process.env.ZEN_PYTHON;
  const local = join(SPEECH_DIR, ".venv", "bin", "python");
  if (existsSync(local)) return local;
  const venv = join(DATA_DIR, "speech-venv");
  const py = join(venv, "bin", "python");
  // The marker holds the requirements it was built from; new ones mean a fresh build.
  const want = readFileSync(join(SPEECH_DIR, "requirements.txt"), "utf8");
  const marker = join(venv, ".ready");
  if (existsSync(marker) && readFileSync(marker, "utf8") === want) return py;
  rmSync(venv, { recursive: true, force: true });
  // The app bundles its own uv; Homebrew installs depend on the uv formula.
  const uv = process.env.ZEN_UV ?? Bun.which("uv", { PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` });
  if (!uv) throw new Error("uv is needed for voice: brew install uv");
  status("installing the voice, first time only");
  const run = async (args: string[]) => {
    const p = Bun.spawn([uv, ...args], { env: { ...process.env, VIRTUAL_ENV: venv }, stdout: "inherit", stderr: "inherit" });
    if ((await p.exited) !== 0) throw new Error(`uv ${args[0]} failed`);
  };
  await run(["venv", "--quiet", "--allow-existing", "--python", "3.12", venv]);
  await run(["pip", "install", "--quiet", "-r", join(SPEECH_DIR, "requirements.txt")]);
  writeFileSync(marker, want);
  return py;
}

export async function ensureSidecar(status: (s: string) => void = () => {}): Promise<boolean> {
  if (await reachable()) return true;
  if (!child) {
    const py = await python(status);
    // The first start downloads the voice and hearing models (about 4 GB).
    status(firstStart() ? "downloading the voice, about 4 GB, first time only" : "waking the voice");
    child = spawn(py, [join(SPEECH_DIR, "server.py")], {
      stdio: ["ignore", "pipe", "inherit"],
      env: { ...process.env, VIRTUAL_ENV: join(py, "..", ".."), TOKENIZERS_PARALLELISM: "false" },
    });
    child.on("exit", () => (child = undefined));
  }
  for (let i = 0; i < 2 * 60 * 60; i++) {
    if (await reachable()) return true;
    if (!child) return false;
    await Bun.sleep(500);
  }
  return false;
}

/** The voice model isn't downloaded yet: this is the first time the voice wakes. */
function firstStart() {
  const hub = process.env.HF_HOME ? join(process.env.HF_HOME, "hub") : join(homedir(), ".cache", "huggingface", "hub");
  return !existsSync(join(hub, "models--mlx-community--Breeze-TTS-2-mlx-4bit"));
}

async function reachable() {
  return new Promise<boolean>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${SPEECH_PORT}`);
    ws.onopen = () => (ws.close(), resolve(true));
    ws.onerror = () => resolve(false);
  });
}

/** Silence after a chunk, in seconds: a breath after a sentence, longer after a question or a paragraph. */
function pauseAfter(chunk: string, gap: string) {
  if (gap.includes("\n\n")) return 0.9;
  if (/\?["')\]]*$/.test(chunk.trim())) return 0.7;
  if (/[…]["')\]]*$/.test(chunk.trim())) return 0.6;
  return 0.45;
}

export function stopSidecar() {
  child?.kill();
}

const words = (t: string) => t.toLowerCase().match(/[a-z']+/g) ?? [];

export class Voice {
  private ws?: WebSocket;
  private pending = ""; // finalized visitor speech not yet sent
  private committed = -1; // last utterance id sent to the monk; later finals for it are late echoes
  private graceTimer?: Timer;
  private chunkSeq = 0;
  private buffer = ""; // monk text not yet sent to TTS
  private audible = false; // browser is playing monk audio
  private barged = false;
  private recentMonk = new Set<string>(); // words the monk is saying, for echo rejection
  private recentPairs = new Set<string>(); // ...and their word pairs, in order
  // The visitor paused, we sent their words, and they carried on before the monk said
  // anything: show it as one thought (the monk gets the rest as a follow-up).
  private lastSent = { text: "", at: 0 };
  private monkSpoke = false; // monk audio has gone out since the last send
  private prefix = "";

  constructor(
    private toBrowser: (msg: object) => void,
    private onUtterance: (text: string) => void,
    private onBarge: () => void,
  ) {}

  async connect() {
    if (!(await ensureSidecar((s) => this.toBrowser({ type: "voice", state: "loading", message: s }))))
      throw new Error("speech sidecar did not start");
    await new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${SPEECH_PORT}`);
      this.ws.onmessage = (e) => this.onSpeech(JSON.parse(String(e.data)) as SpeechMsg);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("speech sidecar unreachable"));
    });
  }

  mic(pcm: Buffer) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm);
  }

  /** Browser reports whether monk audio is currently playing. */
  setAudible(on: boolean) {
    this.audible = on;
    if (!on) this.barged = false;
  }

  /**
   * The monk's own voice leaking into the mic. Matching single words is too loose (the
   * visitor uses "I", "the", "self" too), so for two or more words the word *pairs* must
   * follow what the monk is saying.
   */
  private isEcho(text: string) {
    const w = words(text);
    if (!w.length || !this.audible) return false;
    if (w.length === 1) return this.recentMonk.has(w[0]!);
    const pairs = w.slice(1).map((x, i) => `${w[i]} ${x}`);
    return pairs.filter((p) => this.recentPairs.has(p)).length / pairs.length >= 0.6;
  }

  private show(text: string) {
    this.toBrowser({ type: "hearing", text: (this.prefix + " " + text).trim() });
  }

  private onSpeech(m: SpeechMsg) {
    if (m.type === "audio") {
      const sent = this.sentAt.get(m.id);
      if (sent) log(`speech ${m.id} ready in ${Date.now() - sent}ms`);
      const mw = words(m.text);
      mw.forEach((w, i) => {
        this.recentMonk.add(w);
        if (i) this.recentPairs.add(`${mw[i - 1]} ${w}`);
      });
      this.monkSpoke = true;
      this.toBrowser({ ...m, type: "audio" });
    } else if (m.type === "spoken") {
      this.toBrowser({ type: "spoken", id: m.id });
    } else if (m.type === "stt") {
      if (this.isEcho(m.text)) {
        // The monk's own voice leaking into the mic: forget it, don't let it start an utterance.
        if (m.kind === "final" && !this.pending) this.commit(m.utt);
        return;
      }
      if (m.kind === "preview") {
        // Accurate text of the utterance so far, while it's still being spoken.
        if (m.utt !== undefined && m.utt <= this.committed) return;
        this.show(m.text);
        // Real words over the monk's voice: they mean to speak, stop talking.
        if (this.audible && !this.barged && words(m.text).length - words(this.pending).length >= 2) this.barge();
        return;
      }
      clearTimeout(this.graceTimer);
      if (m.kind === "start") {
        if (this.audible) this.toBrowser({ type: "duck" });
        if (!this.pending && !this.monkSpoke && Date.now() - this.lastSent.at < 3000) {
          // They weren't done. Drop the reply the monk was about to give to the first half
          // (it gets told nothing was heard) and wait for the whole thought.
          this.prefix = this.lastSent.text;
          this.lastSent.at = 0;
          this.barge();
        }
        this.show(this.pending);
      } else if (m.kind === "final") {
        if (m.utt !== undefined && m.utt <= this.committed) return; // re-heard after it was already sent
        if (this.audible && !this.barged) {
          // A cough or a single "mm": let the monk carry on. Keep it, though: if they go on
          // talking it was the start of a sentence; if not, quietly let it go.
          if (words(m.text).length < 2) {
            this.pending = m.text.trim();
            this.toBrowser({ type: "unduck" });
            this.graceTimer = setTimeout(() => {
              this.pending = "";
              this.commit(m.utt);
            }, 3000);
            return;
          }
          this.barge();
        }
        // Finals carry the whole utterance so far, re-heard by the accurate model.
        this.pending = m.text.trim();
        this.show(this.pending);
        this.graceTimer = setTimeout(() => {
          const t = this.pending;
          this.pending = "";
          this.commit(m.utt);
          if (t) {
            log("heard:", JSON.stringify(t));
            this.toBrowser({ type: "you", text: t, display: (this.prefix + " " + t).trim() });
            this.prefix = "";
            this.lastSent = { text: t, at: Date.now() };
            this.monkSpoke = false;
            this.onUtterance(t);
          }
        }, graceFor(this.pending));
      }
    }
  }

  /** Close the current utterance; finals for it that arrive later are dropped. */
  private commit(utt?: number) {
    if (utt !== undefined) this.committed = Math.max(this.committed, utt);
    this.ws?.send(JSON.stringify({ type: "commit" }));
  }

  private barge() {
    log("barge-in");
    this.barged = true;
    this.cancel();
    this.toBrowser({ type: "barge" }); // browser stops audio and replies with what was heard
    this.onBarge();
  }

  /** Stream monk text in; speak it sentence by sentence. */
  feed(turn: number, delta: string) {
    this.buffer += delta;
    // Every sentence on its own, short ones too.
    const ends = /[.!?…]["')\]]*(\s+)/g;
    let m: RegExpExecArray | null;
    while ((m = ends.exec(this.buffer))) {
      const cut = m.index + m[0].length;
      const chunk = this.buffer.slice(0, m.index + m[0].length - m[1]!.length);
      if (!chunk.trim()) continue;
      this.speak(turn, chunk, pauseAfter(chunk, m[1]!));
      this.buffer = this.buffer.slice(cut);
      ends.lastIndex = 0;
    }
  }

  flush(turn: number) {
    if (this.buffer.trim()) this.speak(turn, this.buffer, 0.4);
    this.buffer = "";
    this.toBrowser({ type: "turn-end", turn });
  }

  private sentAt = new Map<string, number>();

  /** A new monk turn: anything left over from the last one is stale. */
  newTurn() {
    this.buffer = "";
    this.barged = false;
  }

  private speak(turn: number, text: string, pause: number) {
    const id = `${turn}:${this.chunkSeq++}`;
    this.sentAt.set(id, Date.now());
    this.ws?.send(JSON.stringify({ type: "speak", id, text: text.trim(), pause }));
  }

  cancel() {
    this.buffer = "";
    this.recentMonk.clear();
    this.recentPairs.clear();
    this.ws?.send(JSON.stringify({ type: "cancel" }));
  }

  close() {
    clearTimeout(this.graceTimer);
    this.ws?.close();
  }
}
