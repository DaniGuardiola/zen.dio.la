import { query, tool, createSdkMcpServer, type SDKUserMessage, type Query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { PATH, SILENCE, CORE_IDS } from "./curriculum.ts";
import { MONK_PROMPT } from "./prompt.ts";
import { DATA_DIR, save, type Sitting } from "./state.ts";

export type MonkEvent =
  | { type: "turn"; turn: number }
  | { type: "delta"; turn: number; text: string }
  | { type: "said"; turn: number } // reply text complete, bookkeeping may follow
  | { type: "done"; turn: number; text: string; checkpoint?: number }
  | { type: "glimmer"; id: string }
  | { type: "dissolve"; id: string }
  | { type: "silence" }
  | { type: "error"; message: string };

/** Minds the visitor can choose from. The first is the default. */
export const MODELS = [
  { id: "claude-opus-5-5", name: "Opus 5.5", note: "deepest" },
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5", note: "quicker to answer" },
  { id: "claude-haiku-5-5", name: "Haiku 5.5", note: "quickest, lightest" },
];
export const DEFAULT_MODEL = process.env.ZEN_MODEL ?? MODELS[0]!.id;

/**
 * In a compiled build the SDK can't find its bundled CLI, so use the visitor's own
 * Claude Code install (they need it signed in anyway). launchd's PATH is minimal,
 * so look in the usual places too.
 */
function claudeCli(): string | undefined {
  if (process.env.ZEN_CLAUDE) return process.env.ZEN_CLAUDE;
  if (!import.meta.url.includes("$bunfs")) return undefined;
  const home = process.env.HOME ?? "";
  const path = [process.env.PATH, `${home}/.local/bin`, `${home}/.claude/local`, "/opt/homebrew/bin", "/usr/local/bin"].join(":");
  return Bun.which("claude", { PATH: path }) ?? undefined;
}

/** Async queue feeding the SDK's streaming-input mode. */
class Inbox implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private wake?: () => void;
  push(text: string) {
    this.items.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });
    this.wake?.();
  }
  async *[Symbol.asyncIterator]() {
    while (true) {
      while (this.items.length) yield this.items.shift()!;
      await new Promise<void>((r) => (this.wake = r));
    }
  }
}

const DONE = "Your reply was already delivered. End your turn now, with no further words.";
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const viewId = z.enum(PATH.map((n) => n.id) as [string, ...string[]]);

export class Monk {
  private inbox = new Inbox();
  private q?: Query;
  turn = 0;
  private reply = "";
  generating = false;

  constructor(
    private sitting: Sitting,
    private emit: (e: MonkEvent) => void,
    private model: string = DEFAULT_MODEL,
  ) {}

  private tools() {
    const s = this.sitting;
    const remaining = () => CORE_IDS.filter((id) => !s.dissolved[id]);
    return createSdkMcpServer({
      name: "zen",
      version: "0.1.0",
      tools: [
        tool(
          "search_teachings",
          "Search all teaching notes and sources for a word or idea.",
          { query: z.string() },
          async ({ query }) => {
            const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
            const hits = [...PATH, { ...SILENCE, view: "", insight: "", consequences: [], pitfalls: [] }]
              .flatMap((n) =>
                [
                  ...n.sources.map((x) => `[${n.id}] ${x.ref}: ${x.gist}`),
                  ...n.consequences.map((c) => `[${n.id}] consequence: ${c}`),
                  ...n.pitfalls.map((p) => `[${n.id}] pitfall: ${p}`),
                ].filter((line) => words.some((w) => line.toLowerCase().includes(w))),
              )
              .slice(0, 12);
            return text(hits.length ? hits.join("\n") : "Nothing in the notes covers this. Say so honestly if it matters.");
          },
        ),
        tool(
          "notice_view",
          "The visitor has expressed or clearly holds this view.",
          { view_id: viewId, their_words: z.string() },
          async ({ view_id, their_words }) => {
            if (!s.noticed[view_id]) this.emit({ type: "glimmer", id: view_id });
            s.noticed[view_id] = their_words;
            save(s);
            return text(`Noted. ${DONE}`);
          },
        ),
        tool(
          "remember_commitment",
          "Record a premise the visitor has granted, in their words.",
          { statement: z.string() },
          async ({ statement }) => {
            s.commitments.push(statement);
            save(s);
            return text(`Commitments so far:\n${s.commitments.map((c) => `- ${c}`).join("\n")}\n\n${DONE}`);
          },
        ),
        tool(
          "dissolve_view",
          "The visitor has genuinely seen through this view by their own reasoning (check the signs in the notes).",
          { view_id: viewId, how_they_saw_it: z.string() },
          async ({ view_id, how_they_saw_it }) => {
            if (!s.dissolved[view_id]) {
              s.order.push(view_id);
              this.emit({ type: "dissolve", id: view_id });
            }
            s.dissolved[view_id] = how_they_saw_it;
            save(s);
            const left = remaining();
            return text(
              left.length
                ? `Seen through. Still held somewhere: ${left.join(", ")}. Follow the visitor; do not announce progress. ${DONE}`
                : "Every view on the path is seen through. When the visitor stops holding even the middle, you may enter_silence.",
            );
          },
        ),
        tool("enter_silence", "End the sitting. Only when every non-optional view is dissolved.", {}, async () => {
          const left = remaining();
          if (left.length) return text(`Not yet. Still held: ${left.join(", ")}.`);
          s.silence = true;
          save(s);
          this.emit({ type: "silence" });
          return text("The lights go out. Say almost nothing.");
        }),
      ],
    });
  }

  start() {
    const s = this.sitting;
    this.q = query({
      prompt: this.inbox,
      options: {
        model: this.model,
        systemPrompt: MONK_PROMPT,
        tools: [],
        mcpServers: { zen: this.tools() },
        allowedTools: ["mcp__zen__*"],
        settingSources: [],
        strictMcpConfig: true,
        includePartialMessages: true,
        thinking: { type: "disabled" },
        cwd: DATA_DIR,
        resume: s.sessionId,
        // After a rewind: continue from that point on a new branch, leaving the old one intact.
        ...(s.resumeAt ? { resumeSessionAt: s.resumeAt, forkSession: true } : {}),
        pathToClaudeCodeExecutable: claudeCli(),
      },
    });
    this.pump().catch((e) => this.emit({ type: "error", message: String(e?.message ?? e) }));
    if (!s.sessionId) this.say("[the visitor sits down]", { hidden: true });
  }

  private async pump() {
    for await (const m of this.q!) {
      const sid = (m as { session_id?: string }).session_id;
      if (sid) this.sid = sid;
      // A fresh sitting: remember its conversation right away. After a rewind, the old
      // conversation and resume point stay until the new branch has a finished turn.
      if (sid && !this.sitting.sessionId) {
        this.sitting.sessionId = sid;
        save(this.sitting);
      }
      if ((m.type === "assistant" || m.type === "user") && "uuid" in m && m.uuid) this.lastEntry = m.uuid;
      if (m.type === "stream_event" && !this.interrupting) {
        const ev = m.event;
        if (ev.type === "content_block_start") {
          this.blockStart = true;
          // Once the monk has spoken and moved on to bookkeeping, anything it says
          // after is a repeat: the visitor already heard the reply.
          if (ev.content_block.type === "tool_use" && this.reply.trim() && !this.spoken) {
            this.spoken = true;
            this.emit({ type: "said", turn: this.turn });
          }
        } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta" && !this.spoken) {
          // Separate text blocks around tool calls with a space so words don't fuse.
          const t = this.reply && !/\s$/.test(this.reply) && this.blockStart ? " " + ev.delta.text : ev.delta.text;
          this.blockStart = false;
          this.reply += t;
          this.emit({ type: "delta", turn: this.turn, text: t });
        }
      } else if (m.type === "result") {
        if (this.interrupting) {
          this.interrupting();
          this.interrupting = undefined;
        } else this.finish();
      }
    }
  }
  private blockStart = false;
  private sid?: string;
  /** Latest conversation entry; a finished turn's last one is its checkpoint. */
  private lastEntry?: string;
  /** The reply for this turn is complete; only bookkeeping follows. */
  private spoken = false;
  /** Set while waiting for the SDK to close out an interrupted turn. */
  private interrupting?: () => void;

  private finish() {
    if (!this.generating) return;
    this.generating = false;
    const t = this.reply.trim();
    if (t) {
      const s = this.sitting;
      if (this.sid && this.sid !== s.sessionId) {
        // The branch made by a rewind is real now: it is the conversation from here on.
        s.sessionId = this.sid;
        s.resumeAt = undefined;
      }
      s.transcript.push({ who: "monk", text: t });
      if (this.lastEntry && s.sessionId)
        s.checkpoints.push({
          lines: s.transcript.length,
          session: s.sessionId,
          at: this.lastEntry,
          noticed: structuredClone(s.noticed),
          dissolved: structuredClone(s.dissolved),
          order: [...s.order],
          commitments: [...s.commitments],
          silence: s.silence,
        });
      save(s);
    }
    const cp = this.sitting.checkpoints.at(-1);
    this.emit({ type: "done", turn: this.turn, text: t, checkpoint: cp?.lines === this.sitting.transcript.length ? cp.lines : undefined });
  }

  /**
   * Send the visitor's words. If the monk is mid-reply, it is interrupted first and
   * told exactly how much of the reply the visitor actually heard (or read).
   */
  async say(words: string, opts: { heard?: string; hidden?: boolean } = {}) {
    let note = "";
    if (this.generating) {
      this.generating = false;
      const closed = new Promise<void>((r) => (this.interrupting = r));
      await this.q?.interrupt().catch(() => {});
      await Promise.race([closed, new Promise((r) => setTimeout(r, 4000))]);
      this.interrupting = undefined;
      const heard = (opts.heard ?? this.reply).trim();
      if (heard) this.sitting.transcript.push({ who: "monk", text: heard + " —" });
      note = heard ? `[interrupted: they heard only "${heard}"]\n` : "[interrupted before they heard anything]\n";
    } else if (opts.heard !== undefined && opts.heard.trim() !== this.reply.trim()) {
      // Reply finished generating but the visitor cut off playback partway.
      const s = this.sitting;
      const last = s.transcript.at(-1);
      if (last?.who === "monk") {
        if (opts.heard.trim()) last.text = opts.heard.trim() + " —";
        else {
          // Never heard at all: as far as the visitor is concerned it was never said.
          if (s.checkpoints.at(-1)?.lines === s.transcript.length) s.checkpoints.pop();
          s.transcript.pop();
        }
      }
      note = opts.heard.trim()
        ? `[interrupted: they heard only "${opts.heard.trim()}"]\n`
        : "[interrupted before they heard anything]\n";
    }
    if (!opts.hidden) this.sitting.transcript.push({ who: "you", text: words });
    save(this.sitting);
    this.turn++;
    this.reply = "";
    this.spoken = false;
    this.generating = true;
    this.emit({ type: "turn", turn: this.turn });
    this.inbox.push(note + words);
  }

  close() {
    this.q?.close();
  }
}
