/**
 * zen companion: runs locally, serves the monk to the zen web page over a
 * loopback WebSocket. The page may be zen.dio.la or the copy served here.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import { sky } from "./curriculum.ts";
import { backfill } from "./backfill.ts";
import { Monk, MODELS, DEFAULT_MODEL, type MonkEvent } from "./monk.ts";
import { load, reset, rewind, type Sitting } from "./state.ts";
import { Voice, stopSidecar } from "./voice.ts";
import pkg from "../package.json" with { type: "json" };

const PORT = Number(process.env.ZEN_PORT ?? 47470);
const WEB_DIR = process.env.ZEN_WEB_DIR ?? join(import.meta.dir, "..", "..", "web", "dist");
const ALLOWED = [
  "https://zen.dio.la",
  ...(process.env.ZEN_DEV ? ["http://localhost:5173", "http://127.0.0.1:5173"] : []),
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
];

const cors = (origin: string | null): Record<string, string> =>
  origin && ALLOWED.includes(origin)
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST",
        "Access-Control-Allow-Private-Network": "true",
        Vary: "Origin",
      }
    : {};

type Conn = { model: string; monk?: Monk; voice?: Voice; heard?: string; muteTurn?: number; flushed?: number; chain: Promise<unknown> };
type WS = ServerWebSocket<Conn>;

let sitting: Sitting = load();
await backfill(sitting);
let active: WS | undefined; // one sitting at a time

function send(ws: WS, msg: object) {
  ws.send(JSON.stringify(msg));
}

function hello(ws: WS) {
  send(ws, {
    type: "hello",
    version: pkg.version,
    sky: sky(),
    noticed: Object.keys(sitting.noticed),
    dissolved: sitting.order,
    silence: sitting.silence,
    transcript: sitting.transcript,
    // Points the visitor can return to (transcript lengths after a finished reply).
    checkpoints: sitting.checkpoints.map((c) => c.lines),
  });
}

function startMonk(ws: WS) {
  const c = ws.data;
  c.monk = new Monk(sitting, (e: MonkEvent) => {
    send(ws, e);
    const v = c.voice;
    if (!v) return;
    if (e.type === "turn") v.newTurn();
    if (e.type === "delta" && c.muteTurn !== e.turn) v.feed(e.turn, e.text);
    if ((e.type === "said" || e.type === "done") && c.muteTurn !== e.turn && c.flushed !== e.turn) {
      c.flushed = e.turn;
      v.flush(e.turn);
    }
  }, c.model);
  c.monk.start();
}

function say(ws: WS, text: string, heard?: string) {
  const c = ws.data;
  c.chain = c.chain.then(() => c.monk?.say(text, { heard }));
}

const server = Bun.serve<Conn>({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });

    if (url.pathname === "/health")
      return Response.json(
        {
          app: "zen",
          version: pkg.version,
          protocol: 1,
          models: MODELS,
          defaultModel: DEFAULT_MODEL,
          sitting: { lines: sitting.transcript.length, lights: sitting.order.length, silence: sitting.silence },
        },
        { headers: cors(origin) },
      );

    if (url.pathname === "/ws") {
      // Browsers always send Origin; only our own pages may sit with the monk.
      if (!origin || !ALLOWED.includes(origin)) return new Response("forbidden", { status: 403 });
      const wanted = url.searchParams.get("model") ?? "";
      const model = MODELS.some((m) => m.id === wanted) ? wanted : DEFAULT_MODEL;
      return srv.upgrade(req, { data: { model, chain: Promise.resolve() } }) ? undefined : new Response("upgrade failed", { status: 400 });
    }

    if (url.pathname === "/reset" && req.method === "POST") {
      if (!origin || !ALLOWED.includes(origin)) return new Response("forbidden", { status: 403 });
      if (active) {
        active.data.monk?.close();
        active.data.monk = undefined;
        active.close();
      }
      sitting = reset();
      return Response.json({ ok: true }, { headers: cors(origin) });
    }

    if (url.pathname === "/update" && req.method === "POST") {
      if (!origin || !ALLOWED.includes(origin)) return new Response("forbidden", { status: 403 });
      // Homebrew installs: upgrade, then let launchd restart us.
      Bun.spawn(["/bin/sh", "-c", "brew upgrade daniguardiola/tap/zen && brew services restart daniguardiola/tap/zen"], {
        stdio: ["ignore", "inherit", "inherit"],
      });
      return Response.json({ ok: true }, { headers: cors(origin) });
    }

    // Local copy of the web page (works with no network permission prompts).
    const path = join(WEB_DIR, url.pathname === "/" ? "index.html" : url.pathname);
    if (path.startsWith(WEB_DIR) && existsSync(path)) return new Response(Bun.file(path));
    if (existsSync(join(WEB_DIR, "index.html"))) return new Response(Bun.file(join(WEB_DIR, "index.html")));
    return new Response("zen companion is running. The web page is not built here.", { status: 404 });
  },
  websocket: {
    maxPayloadLength: 1 << 24,
    open(ws) {
      if (active && active !== ws) {
        send(active, { type: "replaced" });
        active.close();
      }
      active = ws;
      hello(ws);
      startMonk(ws);
    },
    async message(ws, raw) {
      const c = ws.data;
      if (typeof raw !== "string") return c.voice?.mic(raw as Buffer);
      const m = JSON.parse(raw);
      switch (m.type) {
        case "say": // text mode; `heard` is how much of the reply was revealed
          return say(ws, String(m.text), m.heard);
        case "voice":
          if (m.on && !c.voice) {
            send(ws, { type: "voice", state: "loading" });
            const v = new Voice(
              (msg) => send(ws, msg),
              (text) => {
                const heard = c.heard;
                c.heard = undefined;
                say(ws, text, heard);
              },
              () => {
                // Visitor started talking over the monk: stop feeding TTS for this turn.
                c.muteTurn = c.monk?.turn;
              },
            );
            try {
              await v.connect();
              c.voice = v;
              send(ws, { type: "voice", state: "on" });
            } catch (e) {
              send(ws, { type: "voice", state: "error", message: String((e as Error).message) });
            }
          } else if (!m.on && c.voice) {
            c.voice.close();
            c.voice = undefined;
            send(ws, { type: "voice", state: "off" });
          }
          return;
        case "audible":
          return c.voice?.setAudible(!!m.on);
        case "heard": // after a barge-in, what the visitor actually heard of this turn
          c.heard = String(m.text ?? "");
          return;
        case "rewind": {
          // Return to just after a monk reply: the conversation forks from there.
          c.monk?.close();
          c.monk = undefined;
          c.voice?.cancel();
          if (!rewind(sitting, Number(m.lines))) send(ws, { type: "error", message: "nothing to return to there" });
          hello(ws);
          startMonk(ws);
          return;
        }
        case "reset":
          c.monk?.close();
          sitting = reset();
          hello(ws);
          startMonk(ws);
          return;
      }
    },
    close(ws) {
      ws.data.monk?.close();
      ws.data.voice?.close();
      if (active === ws) active = undefined;
    },
  },
});

console.log(`zen companion ${pkg.version} on http://127.0.0.1:${server.port}`);
process.on("SIGINT", () => (stopSidecar(), process.exit(0)));
process.on("SIGTERM", () => (stopSidecar(), process.exit(0)));
