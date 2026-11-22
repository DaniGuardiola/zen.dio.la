"""
zen speech sidecar: local STT (Parakeet Unified, streaming, via transcribe.cpp, with
Silero VAD) + TTS (Kokoro with word timings).

Talks to the companion over a loopback WebSocket. Never reached by the browser directly.

in  (binary)  int16 LE mono PCM @ 16 kHz, mic audio
in  (json)    {"type":"speak","id":str,"text":str}   synthesize one chunk (a sentence or two)
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
import random
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import websockets

PORT = int(os.environ.get("ZEN_SPEECH_PORT", "47471"))
VOICE = os.environ.get("ZEN_VOICE", "am_onyx")
SPEED = float(os.environ.get("ZEN_VOICE_SPEED", "0.9"))
SR = 24000


def rest_after(text: str) -> float:
    """Pause after a phrase Kokoro split off inside a chunk."""
    t = text.rstrip(" \"')]")
    if t.endswith("?"):
        return 0.5
    if t.endswith((".", "!", "…")):
        return 0.35
    if t.endswith((",", ";", ":", "—")):
        return 0.18
    return 0.0


def speakable(text: str) -> list[str]:
    """Split into sentences for pacing, but never hand the voice a tiny one on its own:
    alone, "Ha." or "Me." comes out garbled ("hog", "mayo"). Short ones ride along."""
    out, cur = [], ""
    for s in re.split(r"(?<=[.!?…])\s+", text.strip()):
        if not s:
            continue
        cur = (cur + " " + s).strip()
        if len(cur.split()) >= 5:
            out.append(cur)
            cur = ""
    if cur:
        if out and len(cur.split()) < 3:
            out[-1] += " " + cur
        else:
            out.append(cur)
    return out


def log(*a):
    print("[speech]", *a, file=sys.stderr, flush=True)


log("loading models…")
from kokoro import KPipeline  # noqa: E402
from lexicon import apply as pronounce  # noqa: E402
import transcribe_cpp as tc  # noqa: E402
from huggingface_hub import hf_hub_download  # noqa: E402

# Native logs: only warnings and errors.
tc.set_log_callback(lambda level, msg: level in (2, 3) and log(msg.rstrip()))

tts = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
# Warm up so the first real sentence is fast.
for _ in tts("Hello.", voice=VOICE, speed=SPEED):
    pass

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

    def synth(self, gen, chunk_id, text, pause):
        """Runs in a worker thread. Kokoro yields one result per phrase it splits off."""
        t0 = time.perf_counter()
        # Sentence by sentence, so the pauses between them are ours, not the model's.
        results = [
            r
            for sentence in speakable(text)
            # A touch of variation from sentence to sentence, so it doesn't sound read off a page.
            for r in tts(pronounce(sentence), voice=VOICE, speed=SPEED * random.uniform(0.97, 1.03))
            if r.audio is not None
        ]
        for i, result in enumerate(results):
            if gen != self.generation:
                return
            audio = result.audio
            audio = audio.numpy() if hasattr(audio, "numpy") else np.asarray(audio)
            # Unhurried: silence after each phrase, longest at the end of the chunk.
            rest = pause if i == len(results) - 1 else rest_after(result.graphemes or "")
            audio = np.concatenate([audio, np.zeros(int(SR * rest), dtype=audio.dtype)])
            pcm16 = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
            words = []
            for t in result.tokens or []:
                if t.start_ts is None or t.end_ts is None:
                    continue
                words.append({"w": t.text + (t.whitespace or ""), "s": t.start_ts, "e": t.end_ts})
            self.send(
                {
                    "type": "audio",
                    "id": chunk_id,
                    "sr": 24000,
                    "pcm": base64.b64encode(pcm16).decode(),
                    "words": words,
                    "text": result.graphemes,
                }
            )
        log(f"tts {chunk_id} {time.perf_counter() - t0:.2f}s: {text[:40]!r}")
        if gen == self.generation:
            self.send({"type": "spoken", "id": chunk_id})

    async def speaker(self):
        while True:
            gen, chunk_id, text, pause = await self.speak_queue.get()
            if gen != self.generation:
                continue
            await asyncio.to_thread(self.synth, gen, chunk_id, text, pause)

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
                s.speak_queue.put_nowait((s.generation, m["id"], m["text"], float(m.get("pause", 0.6))))
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
