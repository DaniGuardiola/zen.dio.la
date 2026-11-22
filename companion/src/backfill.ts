/**
 * Sittings from before rewind existed have no checkpoints. Rebuild them from the saved
 * conversation: replay the monk's own game-tool calls turn by turn (so lights and
 * glimmers roll back correctly), and match each turn to a monk line in the transcript.
 */
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { CORE_IDS } from "./curriculum.ts";
import { DATA_DIR, save, type Checkpoint, type Sitting } from "./state.ts";

type Block = { type: string; text?: string; name?: string; input?: Record<string, string> };

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function backfill(s: Sitting, dir = DATA_DIR) {
  // Only the stretch before the first real checkpoint can be missing.
  const firstReal = s.checkpoints[0]?.lines ?? Infinity;
  const missing = s.transcript.some((l, i) => i + 1 < firstReal && l.who === "monk" && !l.text.endsWith(" —"));
  if (!missing || !s.sessionId) return;
  const session = s.checkpoints[0]?.session ?? s.sessionId;
  let msgs;
  try {
    msgs = await getSessionMessages(session, { dir });
  } catch (e) {
    console.warn("backfill: could not read the conversation:", e);
    return;
  }

  const state = { noticed: {} as Record<string, string>, dissolved: {} as Record<string, string>, order: [] as string[], commitments: [] as string[], silence: false };
  const turns: { text: string; at: string; state: typeof state }[] = [];
  let text = "";
  let spoken = false;
  let last: string | undefined;
  const flush = () => {
    if (last && text.trim()) turns.push({ text: text.trim(), at: last, state: structuredClone(state) });
    text = "";
    spoken = false;
  };

  for (const m of msgs) {
    const content = (m.message as { content?: string | Block[] } | undefined)?.content;
    const blocks: Block[] = typeof content === "string" ? [{ type: "text", text: content }] : (content ?? []);
    if (m.type === "user" && blocks.some((b) => b.type === "text")) flush(); // the visitor spoke: a new turn
    if (m.type === "assistant")
      for (const b of blocks) {
        if (b.type === "text" && !spoken) text += (text && !/\s$/.test(text) ? " " : "") + (b.text ?? "");
        if (b.type !== "tool_use") continue;
        if (text.trim()) spoken = true; // the monk's own rule: nothing said after bookkeeping counts
        const i = b.input ?? {};
        const tool = b.name?.replace(/^mcp__zen__/, "");
        if (tool === "notice_view" && i.view_id) state.noticed[i.view_id] = i.their_words ?? "";
        if (tool === "dissolve_view" && i.view_id) {
          if (!state.dissolved[i.view_id]) state.order.push(i.view_id);
          state.dissolved[i.view_id] = i.how_they_saw_it ?? "";
        }
        if (tool === "remember_commitment" && i.statement) state.commitments.push(i.statement);
        if (tool === "enter_silence") state.silence = CORE_IDS.every((id) => state.dissolved[id]); // it refuses otherwise
      }
    if (m.type === "user" || m.type === "assistant") last = m.uuid;
  }
  flush();

  const out: Checkpoint[] = [];
  let j = 0;
  s.transcript.forEach((line, i) => {
    if (i + 1 >= firstReal) return;
    if (line.who !== "monk" || line.text.endsWith(" —")) return; // cut-off replies aren't return points
    const want = norm(line.text).slice(0, 60);
    const k = turns.findIndex((t, n) => n >= j && norm(t.text).startsWith(want));
    if (k < 0) return;
    j = k + 1;
    out.push({ lines: i + 1, session, at: turns[k]!.at, ...structuredClone(turns[k]!.state) });
  });
  s.checkpoints = [...out, ...s.checkpoints];
  save(s);
  console.log(`backfill: ${out.length} return points from ${turns.length} turns`);
}

/**
 * Lights earned before remembrances existed only have the monk's third-person note
 * ("Looked for 'me' in the body..."). Turn those into quiet second-person recollections.
 */
export async function rememberOld(s: Sitting, cli?: string) {
  const missing = s.order.filter((id) => !s.remembered?.[id] && s.dissolved[id]);
  if (!missing.length) return;
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const notes = missing.map((id) => `${id}: ${s.dissolved[id]}`).join("\n");
  const prompt = `Rewrite each note below as something said to the person, about how they got there in a conversation. Second person, past tense, quiet. At most 30 words. Mostly what they did and said (their examples, their words in quotes); at most a light touch on where it led. Never "you saw", "you learned", "you realised", "you understood", no lesson or moral, no doctrine words. Answer only with JSON: {"<id>": "<text>", ...}.\n\n${notes}`;
  let out = "";
  try {
    for await (const m of query({
      prompt,
      options: { model: "claude-haiku-5-5", tools: [], settingSources: [], persistSession: false, cwd: DATA_DIR, pathToClaudeCodeExecutable: cli },
    }))
      if (m.type === "result" && m.subtype === "success") out = m.result;
    const json = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as Record<string, string>;
    s.remembered = { ...s.remembered };
    for (const id of missing) if (typeof json[id] === "string" && json[id]) s.remembered[id] = json[id];
    save(s);
    console.log(`remembered ${Object.keys(json).length} older lights`);
  } catch (e) {
    console.warn("could not rewrite older lights:", e);
  }
}
