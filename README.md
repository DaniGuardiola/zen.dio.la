# zen

A very small game that is a conversation. You sit with an old monk in a dark room. You
arrive holding views about yourself and the world; the monk never argues for a view of
its own. It takes your words seriously, asks what follows from them, and lets you find
the consequence you can't accept (*prasaṅga*, the method of Nāgārjuna and Candrakīrti).
When you see through a view, a point of light appears in the dark, joined to the lights
it grew from. At the end the lights gather into an ensō and go out: the raft is left at
the shore, and even emptiness is let go.

Text or voice. Voice is fully local (speech recognition and synthesis on your Mac); the
monk itself is Claude.

## Play

Open **https://zen.dio.la**. It needs a small companion on your Mac (Apple Silicon) and
[Claude Code](https://claude.com/claude-code), installed and signed in. Either
[download zen for Mac](https://github.com/DaniGuardiola/zen.dio.la/releases/latest/download/zen.dmg)
(a menu bar app; open it and it opens the room), or use Homebrew:

```sh
brew install daniguardiola/tap/zen
brew services start daniguardiola/tap/zen
```

## Run it (development)

```sh
cd web && bun install && bun run build         # the page the companion serves
cd speech && uv venv --python 3.12 .venv && VIRTUAL_ENV=.venv uv pip install -r requirements.txt
cd companion && bun install && bun run start   # monk on http://127.0.0.1:47470
```

Open http://127.0.0.1:47470. Watch the sky without talking: http://127.0.0.1:47470/#sky

Voice: click the small circle. The first time, the companion starts `speech/server.py`
(in `speech/.venv` for a checkout; installs build their own env with `uv`). Headphones
work best until the native audio path lands (see roadmap).

Settings (env): `ZEN_MODEL` (default `claude-opus-5-5`), more voices: drop `<id>.wav` + `<id>.txt` (what
the clip says) into `~/Library/Application Support/zen/voices/`, `ZEN_PORT`, `ZEN_DATA_DIR`. `ZEN_DEV=1` allows the
Vite dev server origin.

## Layout

| | |
|---|---|
| `companion/src/curriculum.ts` | **The path.** Ten views, each with probes, the reductio step by step, signs of genuine insight, pitfalls, and sources (verse-cited paraphrases). The doctrinal ground truth. |
| `companion/src/prompt.ts` | The monk: method, voice, guard rails, plus every teaching note inline (cached). |
| `companion/src/monk.ts` | Claude Agent SDK session (streaming input, no built-in tools, game tools over in-process MCP), interruption handling. |
| `companion/src/voice.ts` | Turn-taking: duck on speech start, barge-in on real words, echo rejection, grace window, sentence-chunked TTS. |
| `companion/src/server.ts` | Loopback HTTP + WebSocket, origin allowlist, `/health`, `/update`, serves the page. |
| `speech/server.py` | Local STT (NVIDIA Parakeet Unified EN 0.6B streaming via transcribe.cpp on Metal, Silero VAD for start/stop) + TTS (Breeze TTS 2 on MLX: every sentence is cloned from a short clip in `speech/voice/` (`voices.json` lists them: the elder, designed once from a description, and Alan Watts); word timings from the Qwen3 forced aligner). |
| `web/` | The page: canvas sky, the monk's words revealed at speaking pace, mic capture, playback that knows which word you heard last. |
| `packaging/zen.rb`, `scripts/release.sh` | Homebrew formula for `daniguardiola/tap` + signed, notarized release (tarball and `.dmg`). |
| `macos/` | `zen.app`: a menu bar app that runs the companion (open, open at login, quit), its icon and entitlements. |

## How it keeps the monk honest

- **Fixed teaching notes, not vibes.** Every view carries its canonical reductio and
  cited sources (MMK 1.1, 2.1, 13.8, 15.1–2, 18.1, 22.11, 24.8–19, 25.19–20, 27.30;
  Vigrahavyāvartanī 29; SN 5.10, 12.15, 12.67; MN 22; Milindapañha; Madhyamakāvatāra 6;
  Vimalakīrti ch. 9). The monk may only attribute words to a text when the notes do,
  and says plainly when a question is outside them.
- **Paraphrases, not quotes.** No open-licence English MMK exists (Garfield, Siderits &
  Katsura, Batchelor, Westerhoff are all copyrighted), so notes are our own wording with
  verse numbers. SuttaCentral's Sujato translations are CC0 and could be quoted verbatim.
- **Named failure modes.** Nihilism, reifying emptiness, Advaita's witness-Self, Taoist
  "Void as source", relativism, and Watts' cosmic monism are listed per view as pitfalls.
- **Lights mean something.** `dissolve_view` is only for insight reached by the
  visitor's own reasoning, matching the note's signs; agreeing with the monk or flipping
  to the opposite extreme does not count. `enter_silence` refuses until every core view is
  dissolved.

## Interruptions

Text and voice share one mechanism. The monk's reply is revealed at speaking pace (text)
or played sentence by sentence with per-word timings from the aligner (voice). When you cut in,
the page knows exactly what reached you, the companion interrupts the Claude turn, and
your next message arrives as `[interrupted: they heard only "…"] your words`. A cough or
a single "mm" only ducks the voice; two real words stop it. STT text that matches what
the monk is saying is treated as echo.

## Releasing

- Page: deploys itself on every push to `main` (Cloudflare Workers Builds, `wrangler.jsonc`).
  By hand: `(cd web && bun run build) && bunx wrangler deploy`.
- Companion: bump `companion/package.json` (and `LATEST_COMPANION` in `web/src/main.ts`),
  run `scripts/release.sh` (signs with your Developer ID and notarizes with the `zen`
  notarytool profile; see the script), attach the tarball, `zen.dmg` and `SHA256SUMS` to a
  GitHub release `v<version>`, and update `Formula/zen.rb` in `daniguardiola/homebrew-tap`.

## Install and updates (Homebrew)

`scripts/release.sh` builds `dist/zen-<v>-darwin-arm64.tar.gz` (compiled companion,
page, speech sidecar) and its sha256. Publish it as a GitHub release, then copy
`packaging/zen.rb` into the tap as `Formula/zen.rb`. Users:

```sh
brew install daniguardiola/tap/zen && brew services start daniguardiola/tap/zen
```

zen.dio.la checks `/health`: missing companion → install instructions; too old → an
"update now" button (`POST /update` runs `brew upgrade` + `brew services restart`). The
page reaches the companion via Chrome's Local Network Access (`loopback-network`
permission, asked on the "enter" click). The companion only accepts the zen.dio.la
origin and its own.

The monk runs through the visitor's own signed-in Claude Code. That is fine for you and
friends; for a public release, Anthropic's terms don't allow third-party products to
offer claude.ai login, so ship an `ANTHROPIC_API_KEY` path or get approval first.

## Roadmap

- Native audio I/O (Swift, `AVAudioEngine` voice processing) for reliable echo
  cancellation on speakers.
- Smart Turn v3 semantic end-of-turn instead of the fixed 700 ms grace window.
- A second, cheap "examiner" pass that checks each `dissolve_view` against the transcript.
- Tibetan-debate flourishes: a soft clap when a consequence lands; a "tsa" when the
  visitor contradicts a recorded commitment.
- Optional `.dmg` with a menu bar app; other backends behind the same tool surface.
