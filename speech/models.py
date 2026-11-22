"""The models the speech sidecar needs, shared by server.py and fetch.py."""

TTS_MODEL = "mlx-community/Breeze-TTS-2-mlx-4bit"  # the monk's voice (whole repo)
ALIGN_MODEL = "mlx-community/Qwen3-ForcedAligner-0.6B-4bit"  # word timings (whole repo)
ASR_FILE = ("handy-computer/parakeet-unified-en-0.6b-gguf", "parakeet-unified-en-0.6b-Q8_0.gguf")  # hearing
VAD_FILE = ("handy-computer/silero-vad-v6.2-gguf", "silero-vad-v6.2-F32.gguf")  # when they speak
