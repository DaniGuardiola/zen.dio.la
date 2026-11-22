import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DATA_DIR =
  process.env.ZEN_DATA_DIR ?? join(homedir(), "Library", "Application Support", "zen");
mkdirSync(DATA_DIR, { recursive: true });
const FILE = join(DATA_DIR, "sitting.json");

export type Line = { who: "monk" | "you"; text: string };

/** Where the sitting stood after a finished monk reply: enough to return there. */
export type Checkpoint = {
  lines: number; // transcript length at this point
  session: string; // the conversation that entry belongs to (each rewind starts a branch)
  at: string; // last conversation entry (SDK message uuid) to resume from
  noticed: Record<string, string>;
  dissolved: Record<string, string>;
  order: string[];
  commitments: string[];
  silence: boolean;
};

export type Sitting = {
  sessionId?: string;
  noticed: Record<string, string>; // view id -> their words
  dissolved: Record<string, string>; // view id -> how they saw it
  seen?: Record<string, string>; // view id -> the insight in the visitor's own words
  order: string[]; // dissolution order, for drawing the path as it was walked
  commitments: string[];
  silence: boolean;
  transcript: Line[];
  checkpoints: Checkpoint[];
  /** Set by a rewind: the next start resumes the conversation at this entry. */
  resumeAt?: string;
};

const fresh = (): Sitting => ({
  noticed: {},
  dissolved: {},
  order: [],
  commitments: [],
  silence: false,
  transcript: [],
  checkpoints: [],
});

export function load(): Sitting {
  if (!existsSync(FILE)) return fresh();
  try {
    return { ...fresh(), ...JSON.parse(readFileSync(FILE, "utf8")) };
  } catch {
    return fresh();
  }
}

export function save(s: Sitting) {
  writeFileSync(FILE, JSON.stringify(s, null, 2));
}

export function reset(): Sitting {
  rmSync(FILE, { force: true });
  return fresh();
}

/** Return the sitting to a checkpoint. Returns false if there is none at that point. */
export function rewind(s: Sitting, lines: number): boolean {
  const i = s.checkpoints.findIndex((c) => c.lines === lines);
  if (i < 0) return false;
  const c = s.checkpoints[i]!;
  s.transcript = s.transcript.slice(0, c.lines);
  s.noticed = structuredClone(c.noticed);
  s.dissolved = structuredClone(c.dissolved);
  s.order = [...c.order];
  s.commitments = [...c.commitments];
  s.silence = c.silence;
  s.checkpoints = s.checkpoints.slice(0, i + 1);
  s.sessionId = c.session;
  s.resumeAt = c.at;
  save(s);
  return true;
}
