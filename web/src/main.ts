import { Sky, type Star } from "./sky.ts";
import { Player, startMic, bell, audio } from "./audio.ts";
import { startAmbience, stopAmbience, setPresent } from "./fx.ts";
import { mountControls } from "./controls.ts";

/** Companion versions this page can talk to, and the newest one released. */
const MIN_COMPANION = "0.1.0";
const LATEST_COMPANION = "0.4.1";
const DMG = "https://github.com/DaniGuardiola/zen.dio.la/releases/latest/download/zen.dmg";
// Served by a companion itself (any loopback port, except the Vite dev server)?
const LOCAL = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && location.port !== "5173";
const COMPANION = LOCAL ? location.origin : "http://127.0.0.1:47470";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const sky = new Sky($<HTMLCanvasElement>("sky"));
const monkEl = $("monk");
const youEl = $("you");
const input = $<HTMLInputElement>("words");
const micBtn = $("mic");
const logEl = $("log");
const linesEl = $("lines");
mountControls($("controls"));

let ws: WebSocket | undefined;
let reply = ""; // the monk's current reply, as received
let shown = 0; // characters of it revealed so far
let generating = false;
let voiceOn = false;
let stopMic: (() => void) | undefined;
let replaced = false;
/** `cp`: this monk line is a point the visitor can return to (see rewind). */
let transcript: { who: "monk" | "you"; text: string; cp?: number }[] = [];

const player = new Player(
  (on) => send({ type: "audible", on }),
  (heard) => {
    if (voiceOn) reveal(Math.max(shown, heardToChars(heard)));
  },
);

// --- connection -------------------------------------------------------------

const cmp = (a: string, b: string) => {
  const [x, y] = [a.split(".").map(Number), b.split(".").map(Number)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

type Health = {
  version: string;
  install?: "brew" | "app" | "dev";
  sitting?: { lines: number; lights: number; silence: boolean }; models?: { id: string; name: string; note: string }[]; defaultModel?: string; voices?: { id: string; name: string; note: string }[]; defaultVoice?: string };

async function health(waiting = false): Promise<Health | undefined> {
  try {
    const r = await fetch(`${COMPANION}/health${waiting ? "?waiting=1" : ""}`, { targetAddressSpace: "loopback" } as RequestInit);
    return r.ok ? await r.json() : undefined;
  } catch {
    return undefined;
  }
}

async function loopbackPermission(): Promise<string> {
  try {
    return (await navigator.permissions.query({ name: "loopback-network" as PermissionName })).state;
  } catch {
    return "prompt";
  }
}

function gate(html: string) {
  $("room").hidden = true;
  $("gate").hidden = false;
  $("gate-body").innerHTML = html;
}

const INSTALL = `
  <p>zen needs a small app on your Mac. It uses Claude, and voice models that stay on your machine.</p>
  <a class="primary" id="download" href="${DMG}">download for Mac</a>
  <details class="brew">
    <summary>or use Homebrew</summary>
    <code>brew install daniguardiola/tap/zen
brew services start daniguardiola/tap/zen</code>
  </details>
  <p class="fine">Apple Silicon Macs</p>`;

const OPEN_IT = `
  <p>Open <b>zen.dmg</b> from your Downloads, drag zen into Applications, and open it.</p>
  <p class="fine waiting">this page will open by itself once zen is running</p>
  <a class="quiet" href="${DMG}">download again</a>`;

let watching: number | undefined;

/** No companion yet: offer it, and keep looking so the page opens by itself once it runs. */
function install(downloaded = false) {
  gate(downloaded ? OPEN_IT : INSTALL);
  const dl = document.getElementById("download");
  if (dl) dl.addEventListener("click", () => setTimeout(() => install(true), 300));
  clearInterval(watching);
  watching = setInterval(async () => {
    if ($("gate").hidden || !(await health(true))) return;
    clearInterval(watching);
    enter();
  }, 2000) as unknown as number;
}

async function boot() {
  if (!LOCAL && (await loopbackPermission()) !== "granted") {
    gate(`<p>Sit, and the room will open.</p><button class="primary" id="retry">enter</button>`);
    $("retry").onclick = () => enter();
    return;
  }
  enter();
}

async function enter() {
  audio().resume(); // we have a user gesture (or a local page): unlock audio now
  const h = await health();
  if (!h && !LOCAL && (await loopbackPermission()) === "denied") {
    gate(`<p>Your browser is keeping this page from reaching zen on your Mac. Click the icon at the left of the address bar, allow it to reach devices on your network (local network access), then try again.</p>
      <button class="primary" id="retry">try again</button>`);
    $("retry").onclick = () => enter();
    return;
  }
  if (!h) return install();
  clearInterval(watching);
  if (cmp(h.version, MIN_COMPANION) < 0) {
    if (h.install === "app")
      gate(`<p>Your zen app (${h.version}) is too old for this room. Download the new one and replace it in Applications.</p>
        <a class="primary" href="${DMG}">download zen</a>`);
    else {
      gate(`<p>Your companion (${h.version}) is too old for this room.</p>
        <code>brew upgrade daniguardiola/tap/zen</code>
        <button class="primary" id="update">update now</button>`);
      $("update").onclick = update;
    }
    return;
  }
  if (cmp(h.version, LATEST_COMPANION) < 0) console.info(`zen companion ${LATEST_COMPANION} is available (you have ${h.version})`);
  preflight(h);
}

// --- preflight --------------------------------------------------------------------
// Once zen is found, the page gets everything ready by itself (Claude, the voice, the
// microphone) on a dark, quiet screen, then offers one thing: sit. Options wait behind
// "customize".

type Prefs = { mode: "speak" | "write"; model?: string; voice?: string };

function loadPrefs(): Prefs {
  try {
    return { mode: "speak", ...JSON.parse(localStorage.getItem("zen:prefs") ?? "{}") };
  } catch {
    return { mode: "speak" };
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem("zen:prefs", JSON.stringify(p));
  } catch {}
}

type Step = { state: "checking" | "working" | "ready" | "needed" | "error"; message?: string; fix?: string; done?: number; total?: number };

/** Ask for the microphone now, so the room never opens to a permission prompt. */
async function micPermission(): Promise<Step> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return { state: "ready" };
  } catch (e) {
    const err = e as DOMException;
    if (err.name === "NotFoundError") return { state: "needed", message: "No microphone found. Plug one in, or write instead." };
    if (/system/i.test(err.message))
      return { state: "needed", message: "macOS is keeping the microphone from your browser. Allow it in System Settings → Privacy & Security → Microphone, then reload this page." };
    if (err.name === "NotAllowedError")
      return { state: "needed", message: "The microphone is blocked. Allow it from the icon at the left of the address bar, then try again." };
    return { state: "error", message: `The microphone isn't available (${err.message}).` };
  }
}

const gb = (n = 0) => (n / 1e9).toFixed(1);

/** What the visitor sees while a step is under way: short, quiet. */
function quietly(name: "claude" | "voice" | "mic", st: Step) {
  if (name === "mic") return "allow the microphone";
  if (name === "claude") return "preparing the room";
  if (st.total) return `the voice is on its way · ${gb(st.done)} of ${gb(st.total)} GB`;
  if (/install/.test(st.message ?? "")) return "preparing the voice · first time only";
  if (/wak/.test(st.message ?? "")) return "the voice is waking";
  return "preparing the voice";
}

let preparing = 0;

function preflight(h: Health) {
  const run = ++preparing;
  const models = h.models ?? [];
  const voices = h.voices ?? [];
  const prefs = loadPrefs();
  if (!models.some((m) => m.id === prefs.model)) prefs.model = h.defaultModel ?? models[0]?.id;
  if (!voices.some((v) => v.id === prefs.voice)) prefs.voice = h.defaultVoice ?? voices[0]?.id;
  const choice = (name: string, value: string, label: string, note: string, on: boolean) =>
    `<label class="opt"><input type="radio" name="${name}" value="${value}" ${on ? "checked" : ""}/><span>${label}<small>${note}</small></span></label>`;
  gate(`
    <p id="pf-status" class="fine waiting">preparing the room</p>
    <div id="pf-bar" class="bar" hidden><i></i></div>
    <div id="pf-need" hidden><p id="pf-msg"></p><code id="pf-fix" hidden></code>
      <div class="prep-actions"><button class="quiet" id="pf-retry">try again</button><button class="quiet" id="pf-write" hidden>write instead</button></div></div>
    <button class="primary" id="sit" hidden>${h.sitting?.lines ? "return" : "sit"}</button>
    <button class="link" id="pf-custom" hidden>customize</button>
    <form id="setup" hidden>
      <fieldset>
        <legend>sit and</legend>
        ${choice("mode", "speak", "speak", "out loud", prefs.mode === "speak")}
        ${choice("mode", "write", "write", "in silence", prefs.mode === "write")}
      </fieldset>
      ${models.length ? `<fieldset><legend>with</legend>${models.map((m) => choice("model", m.id, m.name, m.note, m.id === prefs.model)).join("")}</fieldset>` : ""}
      ${voices.length > 1 ? `<fieldset id="voice-choice" ${prefs.mode === "speak" ? "" : "hidden"}><legend>hearing</legend>${voices.map((v) => choice("voice", v.id, v.name, v.note, v.id === prefs.voice)).join("")}</fieldset>` : ""}
      <div class="prep-actions">
        <button type="button" class="quiet" id="pf-open">open a saved sitting</button>
        ${h.sitting?.lines ? `<button type="button" class="quiet" id="begin-again">begin again</button>` : ""}
      </div>
    </form>`);
  $("pf-open").onclick = () => pickSitting();

  let mic: Step | undefined;
  const askMic = () => {
    mic = { state: "checking" };
    micPermission().then((m) => (mic = m));
  };
  if (prefs.mode === "speak") askMic();
  let retry = false;
  let ready = false;

  const form = $<HTMLFormElement>("setup");
  form.addEventListener("change", () => {
    const f = new FormData(form);
    prefs.mode = f.get("mode") === "write" ? "write" : "speak";
    prefs.model = String(f.get("model") ?? prefs.model ?? "");
    prefs.voice = String(f.get("voice") ?? prefs.voice ?? "");
    savePrefs(prefs);
    const vc = document.getElementById("voice-choice");
    if (vc) vc.hidden = prefs.mode !== "speak";
    if (prefs.mode === "speak" && !mic) askMic();
    tick();
  });
  $("pf-custom").onclick = () => (form.hidden = !form.hidden);
  $("pf-retry").onclick = () => {
    retry = true;
    if (mic && mic.state !== "ready") askMic();
    tick();
  };
  $("pf-write").onclick = () => {
    (form.querySelector('input[value="write"]') as HTMLInputElement).checked = true;
    form.dispatchEvent(new Event("change"));
  };
  const again = document.getElementById("begin-again");
  if (again)
    twoStep(again, "forget this sitting?", async () => {
      await fetch(`${COMPANION}/reset`, { method: "POST", targetAddressSpace: "loopback" } as RequestInit).catch(() => {});
      document.body.classList.remove("silence");
      transcript = [];
      enter();
    });
  $("sit").onclick = () => {
    if (!ready) return;
    preparing++;
    savePrefs(prefs);
    audio().resume(); // this click is the gesture that lets the monk be heard
    goFull(); // ...and that lets the room fill the screen
    voiceId = prefs.voice ?? "";
    connect(prefs.model);
    if (prefs.mode === "speak") setVoice(true);
  };

  let timer: number | undefined;
  async function tick() {
    clearTimeout(timer);
    if (run !== preparing) return;
    const speak = prefs.mode === "speak";
    let r: { monk: Step; voice?: Step } = { monk: { state: "ready" }, voice: { state: "ready" } };
    try {
      const res = await fetch(`${COMPANION}/ready?voice=${speak ? 1 : 0}${retry ? "&retry=1" : ""}`, { targetAddressSpace: "loopback" } as RequestInit);
      if (res.ok) r = await res.json();
      else if (res.status !== 404) throw new Error(`ready: ${res.status}`); // (404: an older companion, nothing to wait for)
    } catch {
      return enter(); // the companion went away
    }
    retry = false;
    if (run !== preparing) return;
    const steps: ["claude" | "voice" | "mic", Step][] = [["claude", r.monk]];
    if (speak) steps.push(["voice", r.voice ?? { state: "checking" }], ["mic", mic ?? { state: "checking" }]);
    const stuck = steps.find(([, st]) => st.state === "needed" || st.state === "error");
    const busy = steps.find(([, st]) => st.state === "checking" || st.state === "working");
    ready = !busy && !stuck;
    const status = $("pf-status");
    const bar = $("pf-bar");
    // Something to do and something still under way can both show: fix the one while the other carries on.
    status.hidden = !busy || (!!stuck && busy[0] !== "voice");
    $("pf-need").hidden = !stuck;
    $("sit").hidden = !ready;
    $("pf-custom").hidden = !ready && !stuck;
    if (stuck) {
      $("pf-msg").textContent = stuck[1].message ?? "Something went wrong.";
      $("pf-fix").hidden = !stuck[1].fix;
      $("pf-fix").textContent = stuck[1].fix ?? "";
      $("pf-write").hidden = stuck[0] === "claude";
    }
    if (busy) status.textContent = quietly(busy[0], busy[1]);
    const dl = steps.find(([n, st]) => n === "voice" && st.state === "working" && st.total);
    bar.hidden = !dl;
    if (dl) (bar.firstElementChild as HTMLElement).style.width = `${Math.min(100, (100 * (dl[1].done ?? 0)) / dl[1].total!).toFixed(1)}%`;
    timer = setTimeout(tick, ready ? 3000 : 700) as unknown as number;
  }
  tick();
}

function leave() {
  preparing++;
  replaced = true; // don't auto-reconnect
  if (voiceOn) setVoice(false);
  ws?.close();
  enter();
}

async function update() {
  gate(`<p>Updating. The room will reopen by itself.</p>`);
  await fetch(`${COMPANION}/update`, { method: "POST", targetAddressSpace: "loopback" } as RequestInit).catch(() => {});
  const wait = async () => ((await health())?.version && cmp((await health())!.version, MIN_COMPANION) >= 0 ? enter() : setTimeout(wait, 2000));
  setTimeout(wait, 4000);
}

let model = "";
let voiceId = "";

function connect(m = model) {
  model = m;
  replaced = false;
  ws = new WebSocket(COMPANION.replace(/^http/, "ws") + "/ws?" + new URLSearchParams({ model, voice: voiceId }));
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  audio().resume().then(startAmbience); // resolves once audio is allowed (after a click)
  ws.onclose = () => {
    generating = false;
    // No companion, no room: stop the voice and the room tone.
    player.stop();
    stopAmbience();
    if (replaced) return;
    setTimeout(async () => {
      if (await health()) return connect();
      install();
    }, 1500);
  };
  $("gate").hidden = true;
  $("room").hidden = false;
  if (loadPrefs().mode !== "speak") input.focus(); // speaking: nothing on screen but the dark
}

function send(msg: object) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// --- the monk's words -------------------------------------------------------

/**
 * The whole reply is laid out from the start, unrevealed words invisible, so each word
 * appears where it will stay: nothing shifts while you read.
 */
let laid = ""; // text currently laid out as spans
let words: { el: HTMLSpanElement; end: number }[] = [];

function render() {
  if (!reply.startsWith(laid)) {
    monkEl.textContent = "";
    laid = "";
    words = [];
  }
  // Lay out only complete tokens; a word still streaming in waits for its ending.
  const upto = !generating || reply.length === shown ? reply.length : Math.max(laid.length, reply.search(/\S*$/));
  for (const m of reply.slice(laid.length, upto).matchAll(/\s+|\S+/g)) {
    // A word shows once its letters are reached; trailing punctuation ("words.") is
    // timed separately by the voice, at the very end of the word, and must not hold it back.
    const core = m[0].replace(/[^\p{L}\p{N}]+$/u, "").length || m[0].length;
    const end = laid.length + m.index! + core;
    if (/^\s/.test(m[0])) monkEl.append(m[0]);
    else {
      const el = document.createElement("span");
      el.className = "w";
      el.textContent = m[0];
      monkEl.append(el);
      words.push({ el, end });
    }
  }
  laid = reply.slice(0, Math.max(laid.length, upto));
  let last: HTMLElement | undefined;
  for (const w of words) if (w.el.classList.toggle("on", w.end <= shown)) last = w.el;
  // A long reply scrolls within its place, keeping the newest word in view.
  if (last) {
    const box = monkEl.getBoundingClientRect();
    const r = last.getBoundingClientRect();
    if (r.bottom > box.bottom) monkEl.scrollTop += r.bottom - box.bottom + 4;
  } else monkEl.scrollTop = 0;
  monkEl.classList.toggle("scrolled", monkEl.scrollTop > 0);
}

function reveal(n: number) {
  shown = Math.min(n, reply.length);
  render();
}

/** Map heard text (normalised whitespace) back to a character count in `reply`. */
function heardToChars(heard: string) {
  if (!heard) return 0;
  let i = 0;
  let j = 0;
  while (i < reply.length && j < heard.length) {
    if (/\s/.test(reply[i]!)) i++;
    else if (/\s/.test(heard[j]!)) j++;
    else if (reply[i]!.toLowerCase() === heard[j]!.toLowerCase()) i++, j++;
    else i++; // tolerate tokenisation differences
  }
  return i;
}

// Text mode: reveal at the pace of speech, so reading feels like listening.
let lastAudio = 0; // when the monk's voice last played or arrived

setInterval(() => {
  if (shown >= reply.length || !present) return;
  if (player.playing) lastAudio = performance.now();
  // In voice mode the words follow the voice, unless the voice has gone quiet for a while
  // (slow or lost speech): then the text carries on alone rather than hang.
  if (voiceOn && performance.now() - lastAudio < 3500) return;
  const next = reply.slice(shown).match(/^\s*\S+/);
  reveal(shown + (next ? next[0].length : 1));
}, 210);

function cutOff(): string | undefined {
  const midReply = generating || shown < reply.length || player.playing;
  if (!midReply) return undefined;
  const heard = voiceOn && player.playing ? player.stop() : reply.slice(0, shown);
  reply = heard.trim() ? heard.trim() + " —" : "";
  shown = reply.length;
  render();
  return heard;
}

// --- protocol ---------------------------------------------------------------

type Msg =
  | {
      type: "hello";
      version: string;
      sky: Star[];
      noticed: string[];
      dissolved: string[];
      silence: boolean;
      transcript: typeof transcript;
      checkpoints: number[];
      seen?: Record<string, string>;
      remembered?: Record<string, string>;
    }
  | { type: "turn"; turn: number }
  | { type: "delta"; turn: number; text: string }
  | { type: "done"; turn: number; text: string; checkpoint?: number }
  | { type: "glimmer"; id: string }
  | { type: "dissolve"; id: string; name: string; plain: string; theirs?: string; remembrance?: string }
  | { type: "silence" }
  | { type: "voice"; state: "loading" | "on" | "off" | "error"; message?: string }
  | { type: "audio"; id: string; sr: number; pcm: string; words: { w: string; s: number; e: number }[]; text: string }
  | { type: "hearing"; text: string }
  | { type: "you"; text: string; display?: string }
  | { type: "duck" | "unduck" | "barge" | "replaced" | "spoken" | "turn-end" }
  | { type: "error"; message: string };

function onMessage(m: Msg) {
  switch (m.type) {
    case "hello": {
      sky.setStars(m.sky);
      if (location.hash === "#sky") return demo(m.sky);
      m.noticed.forEach((id) => sky.glimmer(id, true));
      m.dissolved.forEach((id) => sky.dissolve(id, true));
      seen = { ...(m.seen ?? {}) };
      remembered = { ...(m.remembered ?? {}) };
      if (m.silence) silence(true);
      else document.body.classList.remove("silence");
      transcript = m.transcript;
      for (const cp of m.checkpoints ?? []) if (transcript[cp - 1]) transcript[cp - 1]!.cp = cp;
      const last = [...transcript].reverse().find((l) => l.who === "monk");
      reply = last?.text ?? "";
      shown = reply.length;
      render();
      renderLog();
      break;
    }
    case "turn":
      lastAudio = performance.now() + 3000; // the monk needs a moment to think before the voice starts
      reply = "";
      shown = 0;
      generating = true;
      player.reset();
      render();
      break;
    case "delta":
      reply += m.text;
      render();
      break;
    case "done":
      generating = false;
      if (reply.trim() !== m.text) reply = m.text;
      render();
      if (m.text) transcript.push({ who: "monk", text: m.text, cp: m.checkpoint });
      renderLog();
      setTimeout(() => (youEl.style.opacity = "0"), 800);
      break;
    case "glimmer":
      sky.glimmer(m.id);
      break;
    case "dissolve":
      sky.dissolve(m.id);
      if (m.theirs) seen[m.id] = m.theirs;
      if (m.remembrance) remembered[m.id] = m.remembrance;
      setTimeout(() => bell(), 600);
      // Their own words, not a lesson.
      setTimeout(() => showSeen(m.name, m.theirs ? `“${m.theirs}”` : m.plain), 1400);
      break;
    case "silence":
      silence();
      break;
    case "voice":
      micBtn.dataset.state = m.state;
      micBtn.dataset.tip =
        m.message ?? { loading: "waking the voice…", on: "listening · click to write instead", off: "speak", error: "voice unavailable" }[m.state];
      if (m.message) {
        youEl.style.opacity = "1";
        youEl.textContent = m.state === "error" ? `voice: ${m.message}` : `${m.message}…`;
      } else if (m.state === "on") youEl.textContent = "";
      break;
    case "audio":
      lastAudio = performance.now();
      player.push(m.id, m.sr, m.pcm, m.words, m.text);
      break;
    case "duck":
      player.duck(true);
      break;
    case "unduck":
      player.duck(false);
      break;
    case "barge": {
      const heard = cutOff() ?? "";
      send({ type: "heard", text: heard });
      break;
    }
    case "you":
      youEl.style.opacity = "1";
      youEl.textContent = m.display ?? m.text;
      transcript.push({ who: "you", text: m.text });
      renderLog();
      break;
    case "hearing":
      youEl.style.opacity = "1";
      youEl.textContent = m.text;
      break;
    case "replaced":
      replaced = true;
      gate(`<p>The monk is sitting with you in another window.</p><button class="primary" id="retry">sit here instead</button>`);
      $("retry").onclick = () => enter();
      break;
    case "error":
      console.error("monk:", m.message);
      break;
  }
}

function silence(instant = false) {
  sky.silence(instant);
  document.body.classList.add("silence");
  if (!instant) setTimeout(() => bell(1.6), 1200);
}

// --- input ------------------------------------------------------------------

$("say").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  const heard = cutOff();
  youEl.style.opacity = "1";
  youEl.textContent = text;
  transcript.push({ who: "you", text });
  renderLog();
  send({ type: "say", text, heard });
  if (voiceOn) input.blur(); // back to listening; the box fades away again
});

/** A button that asks once before doing something that can't be undone. */
function twoStep(btn: HTMLElement, ask: string, act: () => void) {
  const label = btn.textContent;
  let armed: number | undefined;
  btn.onclick = () => {
    if (armed) {
      clearTimeout(armed);
      return act();
    }
    btn.textContent = ask;
    btn.classList.add("armed");
    armed = setTimeout(() => {
      armed = undefined;
      btn.textContent = label;
      btn.classList.remove("armed");
    }, 4000);
  };
}

async function setVoice(on: boolean) {
  if (!on) {
    voiceOn = false;
    document.body.classList.toggle("voice", false);
    stopMic?.();
    stopMic = undefined;
    player.stop();
    send({ type: "voice", on: false });
    micBtn.dataset.state = "off";
    return;
  }
  voiceOn = true;
  document.body.classList.toggle("voice", true);
  await audio().resume();
  micBtn.dataset.state = "loading";
  // The socket may still be opening right after "sit".
  while (ws?.readyState === WebSocket.CONNECTING) await new Promise((r) => setTimeout(r, 50));
  send({ type: "voice", on: true });
  try {
    const dot = micBtn.querySelector("span") as HTMLElement;
    stopMic = await startMic((pcm, level) => {
      ws?.send(pcm);
      dot.style.transform = `scale(${1 + Math.min(1.5, level * 6)})`;
    });
  } catch (err) {
    voiceOn = false;
    document.body.classList.toggle("voice", false);
    micBtn.dataset.state = "error";
    youEl.style.opacity = "1";
    youEl.textContent = "the microphone is not available";
    console.error(err);
  }
}

micBtn.addEventListener("click", () => setVoice(!voiceOn));

$("log-toggle").addEventListener("click", () => (logEl.hidden = !logEl.hidden));

// Sitting fills the screen. Leaving fullscreen (Esc) leaves a small way back, top left.
const fullBtn = $("full");
function goFull() {
  if (document.fullscreenEnabled && !document.fullscreenElement)
    document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
}
function syncFull() {
  fullBtn.hidden = !document.fullscreenEnabled || !!document.fullscreenElement;
}
fullBtn.addEventListener("click", goFull);
document.addEventListener("fullscreenchange", syncFull);
syncFull();

function renderLog() {
  linesEl.innerHTML = "";
  transcript.forEach((l, i) => {
    const p = document.createElement("p");
    p.className = l.who;
    p.textContent = l.text;
    // Any earlier reply of the monk's is a place to return to; the sitting forks from there.
    if (l.cp && i < transcript.length - 1) {
      const back = document.createElement("button");
      back.className = "return";
      back.textContent = "return here";
      twoStep(back, "forget what came after?", () => {
        logEl.hidden = true;
        if (voiceOn) player.stop();
        send({ type: "rewind", lines: l.cp });
      });
      p.append(back);
    }
    linesEl.append(p);
  });
  const reset = document.createElement("button");
  reset.textContent = "begin again";
  twoStep(reset, "forget this sitting?", () => {
    document.body.classList.remove("silence");
    transcript = [];
    logEl.hidden = true;
    send({ type: "reset" });
  });
  const keep = document.createElement("button");
  keep.textContent = "save this sitting";
  keep.onclick = () => saveSitting();
  const open = document.createElement("button");
  open.textContent = "open a saved sitting";
  open.onclick = () => pickSitting();
  const change = document.createElement("button");
  change.textContent = "change how you sit";
  change.onclick = () => {
    logEl.hidden = true;
    leave();
  };
  linesEl.append(keep, open, change, reset);
}

// --- saving and opening sittings ---------------------------------------------------
// A sitting saves to a .zen file (the conversation, the lights, and the monk's memory of
// it) to continue later or on another Mac. Open one from the ··· panel, from "customize",
// or by dropping the file anywhere on the page.

function toast(text: string) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.classList.add("gone"), 3500);
  setTimeout(() => t.remove(), 5000);
}

async function saveSitting() {
  try {
    const r = await fetch(`${COMPANION}/export`, { targetAddressSpace: "loopback" } as RequestInit);
    if (!r.ok) throw new Error(String(r.status));
    const blob = new Blob([await r.text()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `zen sitting ${new Date().toISOString().slice(0, 10)}.zen`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    toast("saved. open it again any time to carry on.");
  } catch (e) {
    toast(`couldn't save the sitting (${(e as Error).message})`);
  }
}

function pickSitting() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".zen,application/json";
  input.onchange = () => input.files?.[0] && openSitting(input.files[0]);
  input.click();
}

async function openSitting(file: File) {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return toast("that file isn't a saved sitting");
  }
  try {
    const r = await fetch(`${COMPANION}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      targetAddressSpace: "loopback",
    } as RequestInit);
    const res = (await r.json()) as { ok: boolean; error?: string };
    if (!res.ok) return toast(res.error ?? "couldn't open that sitting");
    logEl.hidden = true;
    document.body.classList.remove("silence");
    toast("the sitting is back. carry on where you left off.");
    // In the room, the companion sends the sitting over; before it, show "return".
    if ($("room").hidden) enter();
  } catch (e) {
    toast(`couldn't open the sitting (${(e as Error).message})`);
  }
}

// Drop a saved sitting anywhere.
let drags = 0;
const hasFile = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
addEventListener("dragenter", (e) => {
  if (!hasFile(e)) return;
  e.preventDefault();
  if (drags++ === 0) document.body.classList.add("dropping");
});
addEventListener("dragover", (e) => hasFile(e) && e.preventDefault());
addEventListener("dragleave", () => {
  if (--drags <= 0) (drags = 0), document.body.classList.remove("dropping");
});
addEventListener("drop", (e) => {
  if (!hasFile(e)) return;
  e.preventDefault();
  drags = 0;
  document.body.classList.remove("dropping");
  const f = e.dataTransfer?.files[0];
  if (f) openSitting(f);
});

addEventListener("keydown", (e) => {
  if (e.key === "Escape") logEl.hidden = true;
  else if (document.activeElement !== input && e.key.length === 1 && !e.metaKey && !e.ctrlKey) input.focus();
});

/** #sky: watch the whole path light up, then go out (no conversation). */
function demo(stars: Star[]) {
  $("room").hidden = true;
  const order = ["solid-self", "witness", "essence", "motion", "causation", "nihilism", "two-truths", "emptiness-absolute", "nirvana-elsewhere", "middle-position"];
  stars.forEach((s, i) => setTimeout(() => sky.glimmer(s.id), 300 + i * 150));
  order.forEach((id, i) => setTimeout(() => { sky.dissolve(id); bell(0.5); }, 2500 + i * 2200));
  setTimeout(() => silence(), 2500 + order.length * 2200 + 2000);
}

// --- what the lights mean ---------------------------------------------------

/** The visitor's own words for each light they've earned. */
let seen: Record<string, string> = {};
/** How they got to each light, recalled to them by the monk. */
let remembered: Record<string, string> = {};
const seenEl = $("seen");
const card = $("star-card");
let seenTimer: number | undefined;

/** When a light appears, say in a line what was just seen; it fades after a while. */
function showSeen(name: string, plain: string) {
  seenEl.innerHTML = "";
  const n = document.createElement("span");
  n.className = "name";
  n.textContent = name;
  const p = document.createElement("span");
  p.textContent = plain;
  seenEl.append(n, p);
  seenEl.classList.add("on");
  clearTimeout(seenTimer);
  seenTimer = setTimeout(() => seenEl.classList.remove("on"), 11000) as unknown as number;
}

/** Point at a star to see what it was: the view you held, what you saw, why it matters. */
function showCard(x: number, y: number) {
  const hit = sky.starAt(x, y);
  if (hit && !hit.star.view) return; // an older companion doesn't say what lights mean
  document.body.style.cursor = hit ? "help" : "";
  if (!hit) return void (card.hidden = true);
  const { star, lit, at } = hit;
  const row = (label: string, text: string) => {
    const p = document.createElement("p");
    const l = document.createElement("span");
    l.className = "label";
    l.textContent = label;
    p.append(l, text);
    return p;
  };
  card.innerHTML = "";
  if (lit) {
    const h = document.createElement("p");
    h.className = "name";
    h.textContent = star.name;
    const memory = document.createElement("p");
    memory.className = "memory";
    memory.textContent = remembered[star.id] || star.plain;
    card.append(h, memory);
    if (seen[star.id]) card.append(row("in your words", `“${seen[star.id]}”`));
    card.append(row("where you started", star.view));
  } else card.append(row("something you hold", star.view));
  card.hidden = false;
  const w = card.offsetWidth;
  card.style.left = `${Math.min(innerWidth - w - 12, Math.max(12, at[0] - w / 2))}px`;
  card.style.top = `${at[1] + 22}px`;
}

$("sky").addEventListener("pointermove", (e) => showCard(e.clientX, e.clientY));
$("sky").addEventListener("pointerdown", (e) => showCard(e.clientX, e.clientY));
$("sky").addEventListener("pointerleave", () => (card.hidden = true));

// Step out of the room when the page isn't in front: sound fades, the voice and the
// words pause, and both pick up where they were on return.
let present = true;
const presence = () => {
  const now = !document.hidden && document.hasFocus();
  if (now === present) return;
  present = now;
  setPresent(now);
};
for (const ev of ["visibilitychange", "blur", "focus"]) addEventListener(ev, presence);

// Browsers keep audio locked until the visitor interacts; unlock on the first touch or key.
const unlock = () => {
  if (audio().state !== "suspended") return;
  audio().resume();
  if (location.hash === "#sky") startAmbience();
};
for (const ev of ["pointerdown", "keydown", "touchstart"]) addEventListener(ev, unlock, { capture: true });

// Tuning from the console: zenLead(0.4) shows words further ahead of the voice.
(window as any).zenLead = (s: number) => (Player.LEAD = s);

boot();
