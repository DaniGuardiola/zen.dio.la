/**
 * Everything the room needs before the visitor sits, checked and made ready up front:
 *   monk   Claude Code is installed and signed in
 *   voice  the speech environment is installed, the models are downloaded, the voice is awake
 * The page asks /ready and only opens the room when what it needs is ready.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { join } from "node:path";
import { claudeCli } from "./monk.ts";
import { DATA_DIR } from "./state.ts";
import { ensureSidecar, python, speechDir } from "./voice.ts";

export type Step = {
  state: "checking" | "working" | "ready" | "needed" | "error";
  /** what's happening, or what the visitor needs to do */
  message?: string;
  /** a command that fixes it, shown to copy */
  fix?: string;
  done?: number;
  total?: number;
};

const COMPILED = import.meta.url.includes("$bunfs");
const log = (...a: unknown[]) => console.log("[prepare]", ...a);

// --- the monk ------------------------------------------------------------------

let monk: Step = { state: "checking" };
let monkCheck: Promise<void> | undefined;
let monkAt = 0;

/** Signed in? Asks Claude Code for its account without sending it anything. */
async function checkMonk() {
  const cli = claudeCli();
  if (COMPILED && !cli) {
    monk = {
      state: "needed",
      message: "zen needs Claude Code (Claude in the terminal) on this Mac. Install it with this, then sign in with your Claude account:",
      fix: "curl -fsSL https://claude.ai/install.sh | bash",
    };
    return;
  }
  const never = { async *[Symbol.asyncIterator]() { await new Promise(() => {}); } };
  const q = query({
    prompt: never as AsyncIterable<never>,
    options: { tools: [], settingSources: [], persistSession: false, cwd: DATA_DIR, pathToClaudeCodeExecutable: cli },
  });
  try {
    const a = await Promise.race([q.accountInfo(), Bun.sleep(20_000).then(() => Promise.reject(new Error("it didn't answer")))]);
    const signedIn =
      (a.apiProvider && a.apiProvider !== "firstParty") || a.email || (a.tokenSource && a.tokenSource !== "none") || (a.apiKeySource && a.apiKeySource !== "none");
    monk = signedIn
      ? { state: "ready" }
      : { state: "needed", message: "Claude isn't signed in on this Mac. Open Terminal, run this, and sign in:", fix: "claude" };
  } catch (e) {
    monk = { state: "error", message: `Couldn't reach Claude: ${(e as Error).message}` };
  } finally {
    q.close();
  }
}

function refreshMonk() {
  // Once ready it stays ready; otherwise look again every few seconds (they may be signing in).
  if (monk.state === "ready" || monkCheck || Date.now() - monkAt < 3000) return;
  monkCheck = checkMonk()
    .catch((e) => void (monk = { state: "error", message: String(e) }))
    .finally(() => {
      monkCheck = undefined;
      monkAt = Date.now();
      log("monk:", monk.state, monk.message ?? "");
    });
}

// --- the voice -----------------------------------------------------------------

let voice: Step = { state: "checking" };
let voiceRun: Promise<void> | undefined;

async function prepareVoice() {
  voice = { state: "working", message: "getting ready" };
  const py = await python((s) => (voice = { state: "working", message: s === "installing" ? "installing (a minute or two, first time only)" : s }));
  // Models: quick when they're already here; the first time, about 5 GB with progress.
  voice = { state: "working", message: "checking the voice models" };
  const fetch = Bun.spawn([py, join(speechDir, "fetch.py")], {
    env: { ...process.env, VIRTUAL_ENV: join(py, "..", ".."), HF_HUB_DISABLE_PROGRESS_BARS: "1" },
    stdout: "pipe",
    stderr: "inherit",
  });
  let result: { ok?: boolean; error?: string } = {};
  let buf = "";
  for await (const chunk of fetch.stdout) {
    buf += new TextDecoder().decode(chunk);
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      try {
        const m = JSON.parse(line);
        if (typeof m.done === "number") voice = { state: "working", message: "downloading the voice (first time only)", done: m.done, total: m.total };
        if ("ok" in m) result = m;
      } catch {}
    }
  }
  await fetch.exited;
  if (!result.ok) throw new Error(`couldn't download the voice: ${result.error ?? "it stopped"}. Check your connection and try again; what already arrived is kept.`);
  voice = { state: "working", message: "waking the voice" };
  await ensureSidecar();
  voice = { state: "ready" };
}

function refreshVoice() {
  if (voice.state === "ready" || voiceRun) return;
  voiceRun = prepareVoice()
    .catch((e) => {
      voice = { state: "error", message: (e as Error).message };
      log("voice:", voice.message);
    })
    .finally(() => (voiceRun = undefined));
}

/** Where things stand; starts (or retries) whatever isn't ready yet. */
export function readiness(wantVoice: boolean, retry = false): { monk: Step; voice?: Step } {
  refreshMonk();
  if (wantVoice && (voice.state !== "error" || retry)) refreshVoice();
  return { monk, ...(wantVoice ? { voice } : {}) };
}

/** The sidecar went away (e.g. it crashed): the next sitting gets it ready again. */
export function voiceGone() {
  if (voice.state === "ready") voice = { state: "checking" };
}
