"""
zen speech sidecar: local STT (Parakeet Unified, streaming, via transcribe.cpp, with
Silero VAD) + TTS (Breeze TTS 2 on MLX, cloning the monk's voice from a short clip, with word timings from a forced aligner).

Talks to the companion over a loopback WebSocket. Never reached by the browser directly.

in  (binary)  int16 LE mono PCM @ 16 kHz, mic audio
in  (json)    {"type":"speak","id":str,"text":str,"pause":s,"voice":id}   synthesize one chunk
in  (json)    {"type":"cancel"}                      drop all queued/in-flight synthesis
in  (json)    {"type":"commit"}                      the utterance so far became a turn; start a new one
out (json)    {"type":"ready"}
out (json)    {"type":"stt","kind":"start"|"preview"|"final","text":str,"utt":int}
              start: voice detected; preview: live text; final: the visitor paused.
              preview/final carry the whole utterance so far (until "commit").
out (json)    {"type":"audio","id":str,"sr":24000,"pcm":b64 int16,"words":[{"w","s","e"}],"text":str}
out (json)    {"type":"spoken","id":str}             synthesis for that id finished
"""

import asyncio
import base64
import json
import os
import unicodedata
import re
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import websockets

PORT = int(os.environ.get("ZEN_SPEECH_PORT", "47471"))
SR = 24000
TTS_MODEL = "mlx-community/Breeze-TTS-2-mlx-4bit"
ALIGN_MODEL = "mlx-community/Qwen3-ForcedAligner-0.6B-8bit"
DATA_DIR = os.environ.get("ZEN_DATA_DIR", os.path.expanduser("~/Library/Application Support/zen"))
# Who the monk sounds like: every sentence is cloned from a short clip of a voice. The
# voices that ship are in voice/ (voices.json says what each clip says); more can be added
# on a Mac as <DATA_DIR>/voices/<id>.wav plus <id>.txt with what the clip says.
VOICE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "voice")
BUNDLED = {v["id"]: (os.path.join(VOICE_DIR, v["id"] + ".wav"), v["text"]) for v in json.load(open(os.path.join(VOICE_DIR, "voices.json")))}
DEFAULT_VOICE = "elder"
SEED = 7


def ref_for(voice_id: str | None) -> tuple[str, str]:
    """The clip to clone (and what it says) for a voice id; the default if it's unknown."""
    if voice_id in BUNDLED:
        return BUNDLED[voice_id]
    if voice_id and re.fullmatch(r"[a-z0-9_-]+", voice_id):
        clip = os.path.join(DATA_DIR, "voices", voice_id)
        if os.path.exists(clip + ".wav") and os.path.exists(clip + ".txt"):
            return clip + ".wav", open(clip + ".txt").read().strip()
    return BUNDLED[DEFAULT_VOICE]


def rest_after(text: str) -> float:
    """Pause after a sentence inside a chunk."""
    t = text.rstrip(" \"')]")
    if t.endswith("?"):
        return 0.5
    if t.endswith((".", "!", "…")):
        return 0.35
    return 0.18


def sentences(text: str) -> list[str]:
    """One sentence at a time, so the pauses between them are ours, not the model's."""
    return [x for x in re.split(r"(?<=[.!?…])\s+", text.strip()) if x]


def log(*a):
    print("[speech]", *a, file=sys.stderr, flush=True)


log("loading models…")
from mlx_audio.tts.utils import load_model  # noqa: E402
from mlx_audio.stt import load as load_aligner  # noqa: E402
import transcribe_cpp as tc  # noqa: E402
from huggingface_hub import hf_hub_download  # noqa: E402

# Native logs: only warnings and errors.
tc.set_log_callback(lambda level, msg: level in (2, 3) and log(msg.rstrip()))

# The mouth: the voice model and the aligner, used only on this one thread (MLX likes it that way).
mouth = ThreadPoolExecutor(max_workers=1)


def _load_voice():
    global tts, aligner
    tts = load_model(TTS_MODEL)
    # Cloning re-encodes the reference on every call; it never changes, so encode it once.
    enc, cache = tts._encode_reference, {}

    def encode(ref):
        if not isinstance(ref, str):
            return enc(ref)
        if ref not in cache:
            cache[ref] = enc(ref)
        return cache[ref]

    tts._encode_reference = encode
    aligner = load_aligner(ALIGN_MODEL)
    voice("Hello.")  # the first line is slow; pay for it now


def generate(text: str, **kw) -> np.ndarray:
    parts = [np.array(r.audio, dtype=np.float32) for r in tts.generate(text=text, split_pattern=None, seed=SEED, **kw)]
    return np.concatenate(parts) if parts else np.zeros(0, np.float32)


def voice(text: str, voice_id: str | None = None) -> np.ndarray:
    """One sentence in the monk's voice, with the silence around it trimmed."""
    ref_audio, ref_text = ref_for(voice_id)
    pcm = generate(text, ref_audio=ref_audio, ref_text=ref_text)
    loud = np.flatnonzero(np.abs(pcm) >= 0.006)
    if not loud.size:
        return pcm[:0]
    start = max(0, int(loud[0] - 0.025 * SR))
    out = pcm[start : loud[-1] + int(0.06 * SR)].copy()
    fade = min(int(0.008 * SR), int(loud[0] - start))
    if fade > 0:
        out[:fade] *= np.linspace(0, 1, fade, endpoint=False, dtype=np.float32)
    return out


def letters(t: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", t.lower()) if c.isalnum())


def timings(text: str, pcm: np.ndarray) -> list[dict]:
    """When each word of `text` is said. The aligner hears words without punctuation; map
    them back onto the text as written, so the page can show exactly what was said."""
    tokens = re.findall(r"\S+\s*", text)
    dur = len(pcm) / SR
    try:
        a16 = np.interp(np.arange(0, len(pcm), SR / 16000), np.arange(len(pcm)), pcm).astype(np.float32)
        items = [(letters(i.text), float(i.start_time), float(i.end_time)) for i in aligner.generate(audio=a16, text=text, language="English")]
    except Exception as e:  # noqa: BLE001
        log(f"align failed: {type(e).__name__}: {e}")
        items = []
    words, k, last = [], 0, 0.0
    for tok in tokens:
        need, got, s, e = letters(tok), "", None, last
        while k < len(items) and len(got) < len(need):
            got += items[k][0]
            s = items[k][1] if s is None else s
            e = items[k][2]
            k += 1
        if s is None:  # punctuation alone, or the aligner ran out
            s = last
        words.append({"w": tok, "s": min(s, dur), "e": min(max(e, s), dur)})
        last = e
    if not items:  # spread evenly by length, better than nothing
        total = sum(len(t) for t in tokens) or 1
        t = 0.0
        for w in words:
            w["s"], t = t, t + dur * len(w["w"]) / total
            w["e"] = t
    return words


mouth.submit(_load_voice).result()

# The ear: NVIDIA Parakeet Unified streams accurate, punctuated text as the visitor
# speaks; Silero VAD says when they start and stop. All of it on one thread, in order.
ASR_MODEL = os.environ.get(
    "ZEN_STT_MODEL",
    hf_hub_download("handy-computer/parakeet-unified-en-0.6b-gguf", "parakeet-unified-en-0.6b-Q8_0.gguf"),
)
VAD_MODEL = hf_hub_download("handy-computer/silero-vad-v6.2-gguf", "silero-vad-v6.2-F32.gguf")
# 5.6 s left context, 0.16 s chunks, 0.32 s lookahead: words land ~0.5 s after they're said.
STREAM = tc.ParakeetBufferedStreamOptions(left_ms=5600, chunk_ms=160, right_ms=320)
ear = ThreadPoolExecutor(max_workers=1)


def _load():
    global asr, vad_model
    asr = tc.Model(ASR_MODEL)
    vad_model = tc.Model(VAD_MODEL)
    with asr.session() as warm, warm.stream(family=STREAM) as st:
        st.feed(np.zeros(16000, dtype=np.float32))
        st.finalize()


ear.submit(_load).result()
log("models ready")


class Session:
    def __init__(self, ws, loop):
        self.ws = ws
        self.loop = loop
        self.generation = 0  # bumped on cancel; stale synth results are dropped
        self.speak_queue: asyncio.Queue = asyncio.Queue()
        # Everything below is touched only on the `ear` thread.
        self.asr = asr.session()
        self.vad = vad_model.vad_session()
        self.frame = vad_model.vad_info.frame_samples
        self.stream = None  # live ASR stream while the visitor is speaking
        self.recent = np.zeros(0, dtype=np.float32)  # pre-roll for the start of speech
        self.speech_run = 0  # consecutive speech frames
        self.quiet_run = 0  # consecutive silent frames while speaking
        # The visitor's current utterance (may span pauses) until the companion commits it.
        self.utt_text = ""
        self.utt_id = 0
        self.shown = ""

    def send(self, obj):
        asyncio.run_coroutine_threadsafe(self.ws.send(json.dumps(obj)), self.loop)

    def joined(self, live: str = "") -> str:
        return (self.utt_text + " " + live).strip()

    def hear(self, pcm: np.ndarray):
        """On the ear thread: voice detection, then streaming recognition while they speak."""
        self.recent = np.concatenate([self.recent, pcm])[-int(16000 * 0.8) :]
        probs = self.vad.stream_feed(pcm).probs
        for p in probs:
            if p > 0.5:
                self.speech_run += 1
                self.quiet_run = 0
            elif p < 0.35:
                self.speech_run = 0
                self.quiet_run += 1
        frame_s = self.frame / 16000
        if self.stream is None:
            if self.speech_run * frame_s >= 0.1:
                # Speech: open a stream, starting a little before it so the first word is whole.
                self.stream = self.asr.stream(family=STREAM)
                self.stream.__enter__()
                self.stream.feed(self.recent.copy())
                self.quiet_run = 0
                self.send({"type": "stt", "kind": "start", "text": self.joined(), "utt": self.utt_id})
            return
        self.stream.feed(pcm)
        t = self.stream.text()
        live = (t.committed + t.tentative).strip()
        if live and self.joined(live) != self.shown:
            self.shown = self.joined(live)
            self.send({"type": "stt", "kind": "preview", "text": self.shown, "utt": self.utt_id})
        if self.quiet_run * frame_s >= 0.55:
            self.end_segment()

    def end_segment(self):
        """They paused: finish this stretch of speech and report the utterance so far."""
        try:
            self.stream.finalize()
            text = self.stream.text().committed.strip()
        finally:
            self.stream.__exit__(None, None, None)
            self.stream = None
            self.speech_run = 0
        if text:
            self.utt_text = self.joined(text)
        if self.utt_text:
            self.shown = self.utt_text
            self.send({"type": "stt", "kind": "final", "text": self.utt_text, "utt": self.utt_id})

    def commit(self):
        """The companion took the utterance as a turn (or dropped it): start fresh."""
        self.utt_text = ""
        self.shown = ""
        self.utt_id += 1

    def add_audio(self, data: bytes):
        pcm = np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768.0
        ear.submit(self.hear, pcm)

    def synth(self, gen, chunk_id, text, pause, voice_id):
        try:
            self._synth(gen, chunk_id, text, pause, voice_id)
        except Exception:  # noqa: BLE001
            log("tts failed:\n" + traceback.format_exc())
            self.send({"type": "spoken", "id": chunk_id})

    def _synth(self, gen, chunk_id, text, pause, voice_id):
        """On the mouth thread: sentence by sentence, so the pauses between them are ours."""
        t0 = time.perf_counter()
        said = sentences(text)
        for i, sentence in enumerate(said):
            if gen != self.generation:
                return
            pcm = voice(sentence, voice_id)
            if gen != self.generation:
                return
            words = timings(sentence, pcm)
            # Unhurried: silence after each sentence, longest at the end of the chunk.
            rest = pause if i == len(said) - 1 else rest_after(sentence)
            pcm = np.concatenate([pcm, np.zeros(int(SR * rest), dtype=np.float32)])
            self.send(
                {
                    "type": "audio",
                    "id": chunk_id,
                    "sr": SR,
                    "pcm": base64.b64encode((np.clip(pcm, -1, 1) * 32767).astype("<i2").tobytes()).decode(),
                    "words": words,
                    "text": sentence,
                }
            )
        log(f"tts {chunk_id} {time.perf_counter() - t0:.2f}s: {text[:40]!r}")
        if gen == self.generation:
            self.send({"type": "spoken", "id": chunk_id})

    async def speaker(self):
        while True:
            gen, chunk_id, text, pause, voice_id = await self.speak_queue.get()
            if gen != self.generation:
                continue
            await asyncio.get_running_loop().run_in_executor(mouth, self.synth, gen, chunk_id, text, pause, voice_id)

    def close(self):
        def shut():
            if self.stream is not None:
                self.stream.__exit__(None, None, None)
            self.vad.close()
            self.asr.close()

        ear.submit(shut)


async def handle(ws):
    loop = asyncio.get_running_loop()
    s = Session(ws, loop)
    speaker = asyncio.create_task(s.speaker())
    await ws.send(json.dumps({"type": "ready"}))
    try:
        async for msg in ws:
            if isinstance(msg, bytes):
                s.add_audio(msg)
                continue
            m = json.loads(msg)
            if m["type"] == "speak":
                s.speak_queue.put_nowait((s.generation, m["id"], m["text"], float(m.get("pause", 0.6)), m.get("voice")))
            elif m["type"] == "commit":
                ear.submit(s.commit)
            elif m["type"] == "cancel":
                s.generation += 1
    finally:
        speaker.cancel()
        s.close()


async def main():
    async with websockets.serve(handle, "127.0.0.1", PORT, max_size=2**24):
        log(f"listening on ws://127.0.0.1:{PORT}")
        print("READY", flush=True)
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
