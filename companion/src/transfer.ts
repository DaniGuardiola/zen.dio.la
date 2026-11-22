/**
 * Save a sitting to a file and open it again later (or on another Mac).
 *
 * The monk's memory is two things: zen's own record (sitting.json) and the Claude
 * conversation it resumes (session transcripts kept by Claude Code). A saved sitting
 * carries both, so the monk remembers everything after an import.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DATA_DIR, save, type Sitting } from "./state.ts";

export type SavedSitting = {
  app: "zen";
  kind: "sitting";
  format: 1;
  saved: string; // ISO date
  sitting: Sitting;
  /** session id -> its transcript (.jsonl) */
  sessions: Record<string, string>;
};

const projects = () => join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
/** Where Claude Code keeps conversations started in our data folder. */
const ourProject = () => join(projects(), DATA_DIR.replace(/[^a-zA-Z0-9]/g, "-"));
const SESSION = /^[0-9a-f-]{36}$/;

function findSession(id: string): string | undefined {
  const mine = join(ourProject(), `${id}.jsonl`);
  if (existsSync(mine)) return mine;
  // Older installs (or a moved data folder) may have it under another project folder.
  try {
    for (const dir of readdirSync(projects())) {
      const p = join(projects(), dir, `${id}.jsonl`);
      if (existsSync(p)) return p;
    }
  } catch {}
  return undefined;
}

export function exportSitting(s: Sitting): SavedSitting {
  const ids = new Set([s.sessionId, ...s.checkpoints.map((c) => c.session)].filter((x): x is string => !!x && SESSION.test(x)));
  const sessions: Record<string, string> = {};
  for (const id of ids) {
    const p = findSession(id);
    if (p) sessions[id] = readFileSync(p, "utf8");
  }
  return { app: "zen", kind: "sitting", format: 1, saved: new Date().toISOString(), sitting: s, sessions };
}

/**
 * Check a saved sitting and make it the current one. Throws with a reason if it isn't one.
 * The sitting it replaces is kept in <data>/backups, so opening a file never loses one.
 */
export function importSitting(data: unknown, current: Sitting): Sitting {
  const d = data as Partial<SavedSitting>;
  if (!d || d.app !== "zen" || d.kind !== "sitting" || typeof d.sitting !== "object" || !d.sitting)
    throw new Error("that isn't a saved zen sitting");
  if (d.format !== 1) throw new Error("that sitting was saved by a newer zen; update zen to open it");
  const s = d.sitting as Sitting;
  if (!Array.isArray(s.transcript) || !Array.isArray(s.checkpoints) || !Array.isArray(s.order))
    throw new Error("that saved sitting is damaged");
  if (current.transcript.length) {
    const backups = join(DATA_DIR, "backups");
    mkdirSync(backups, { recursive: true });
    writeFileSync(join(backups, `sitting-${new Date().toISOString().replace(/[:.]/g, "-")}.zen`), JSON.stringify(exportSitting(current)));
  }
  const dir = ourProject();
  mkdirSync(dir, { recursive: true });
  for (const [id, text] of Object.entries(d.sessions ?? {})) {
    if (!SESSION.test(id) || typeof text !== "string") continue;
    writeFileSync(join(dir, `${id}.jsonl`), text);
  }
  const sitting: Sitting = {
    ...s,
    noticed: s.noticed ?? {},
    dissolved: s.dissolved ?? {},
    commitments: s.commitments ?? [],
    silence: !!s.silence,
  };
  save(sitting);
  return sitting;
}
