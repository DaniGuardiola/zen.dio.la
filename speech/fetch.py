"""
Download everything the speech sidecar needs, reporting progress as JSON lines:
  {"done": bytes, "total": bytes}   every half second while downloading
  {"ok": true}                      everything is here
  {"ok": false, "error": "..."}
Already-downloaded files are skipped, so this is quick (and offline-safe) after the first time.
"""

import json
import os
import sys
import threading
import time

# Plain HTTP downloads: they resume where they stopped. (Hugging Face's xet transfer was
# much slower on some networks, stalled, and its partial files can't be resumed.)
os.environ["HF_HUB_DISABLE_XET"] = "1"

from huggingface_hub import HfApi, hf_hub_download, snapshot_download
from huggingface_hub.constants import HF_HUB_CACHE

from models import ALIGN_MODEL, ASR_FILE, TTS_MODEL, VAD_FILE


def say(obj):
    print(json.dumps(obj), flush=True)


def cached() -> bool:
    try:
        for repo in (TTS_MODEL, ALIGN_MODEL):
            snapshot_download(repo, local_files_only=True)
        for repo, name in (ASR_FILE, VAD_FILE):
            hf_hub_download(repo, name, local_files_only=True)
        return True
    except Exception:  # noqa: BLE001
        return False


def blobs(repo: str) -> str:
    return os.path.join(HF_HUB_CACHE, "models--" + repo.replace("/", "--"), "blobs")


def blob_bytes(repo: str) -> int:
    """Bytes of this repo in the cache so far, including files still downloading (each once)."""
    d = blobs(repo)
    if not os.path.isdir(d):
        return 0
    sizes: dict[str, int] = {}
    for e in os.scandir(d):
        if e.is_file():
            key = e.name.split(".")[0]
            sizes[key] = max(sizes.get(key, 0), e.stat().st_size)
    return sum(sizes.values())


def main():
    if cached():
        return say({"ok": True})
    api = HfApi()
    sizes = {}
    for repo in (TTS_MODEL, ALIGN_MODEL):
        sizes[repo] = sum(s.size or 0 for s in api.model_info(repo, files_metadata=True).siblings)
    for repo, name in (ASR_FILE, VAD_FILE):
        info = api.model_info(repo, files_metadata=True)
        sizes[repo] = next(s.size or 0 for s in info.siblings if s.rfilename == name)
    total = sum(sizes.values())
    stop = threading.Event()

    def report():
        last, moved = -1, time.monotonic()
        while not stop.wait(0.5):
            done = sum(min(blob_bytes(r), sizes[r]) for r in sizes)
            say({"done": done, "total": total})
            if done != last:
                last, moved = done, time.monotonic()
            elif time.monotonic() - moved > 90:
                # Stuck: stop; the companion starts again and it resumes from here.
                say({"ok": False, "error": "the download stalled", "stalled": True})
                os._exit(3)

    threading.Thread(target=report, daemon=True).start()
    for attempt in range(3):  # flaky networks: resume where it left off
        try:
            for repo in (TTS_MODEL, ALIGN_MODEL):
                snapshot_download(repo)
            for repo, name in (ASR_FILE, VAD_FILE):
                hf_hub_download(repo, name)
            break
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                stop.set()
                return say({"ok": False, "error": f"{type(e).__name__}: {e}"})
            time.sleep(3)
    stop.set()
    say({"done": total, "total": total})
    say({"ok": True})


if __name__ == "__main__":
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    try:
        main()
    except Exception as e:  # noqa: BLE001
        say({"ok": False, "error": f"{type(e).__name__}: {e}"})
        sys.exit(1)
