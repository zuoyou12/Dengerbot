# Voice Model Download Guide

Quick reference for Supertonic 3 and other voice model downloads.

---

## Quick Reference

### Supertonic 3 (Speech Model)

**Purpose:** Text-to-speech for agent replies  
**Size:** ~138.6 MB total (145,296,838 bytes)  
**Load Path:** `<userData>/runtimes/supertonic-3-int8/`

| Component | Filename | Size |
|-----------|----------|------|
| duration_predictor | `duration_predictor.int8.onnx` | 3.7 MB |
| text_encoder | `text_encoder.int8.onnx` | 34.7 MB |
| vector_estimator | `vector_estimator.int8.onnx` | 74.8 MB |
| vocoder | `vocoder.int8.onnx` | 24.8 MB |
| unicode_indexer | `unicode_indexer.bin` | 256 KB |
| voice | `voice.bin` | 505 KB |
| config | `tts.json` | 8 KB |
| license | `LICENSE` | 1 KB |

---

## Download Sources

### Primary (may be slow/unreliable in some regions)
```
https://huggingface.co/csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11
```

### Alternative Mirror (recommended if primary fails)
```
https://hf-mirror.com/csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11
```

Mirror is verified working as of 2026-11-02.

---

## Storage Locations

| Environment | Path |
|-------------|------|
| **Packaged** | `%APPDATA%\OpenBot\runtimes\<model-name>` |
| **Development** | `.openbot-build/voice/<model-name>` |

Example path (Windows):
```
C:\Users\zuoyou\AppData\Roaming\OpenBot\runtimes\supertonic-3-int8
```

---

## Verification Commands

Test model availability:
```bash
cd D:\AI\bot\TeCat\dengerbot
"D:\AI\bot\TeCat\_tools\bun\node_modules\bun\bin\bun.exe" scripts/voice-model-download-test.ts
```

Expected output:
```
=== Summary ===
HuggingFace Mirror: ✓ Available
Supertonic 3 files: ✓ All reachable
Parakeet files:     ✓ All reachable
```

---

## Troubleshooting

### "Runtime unavailable" error
The bundled `sherpa-onnx.node` addon may be missing. Check:
```
resources/runtime/sherpa-onnx.node
```

### Download timeout/failure
Try:
1. Check network connectivity to HuggingFace
2. Use alternative mirror (see above)
3. Verify firewall isn't blocking downloads

### Model integrity failure
Files are automatically re-downloaded with SHA-256 validation on each build run.

---

## Other Models

| Model ID | Purpose | Size | Directory |
|----------|---------|------|-----------|
| `parakeet-tdt-0.6b-v3` | Speech recognition | ~625 MB | `parakeet-tdt-0.6b-v3-int8` |
| `sensevoice-small` | Multilingual ASR | ~239 MB | `sensevoice-small-int8` |
| `whisper-turbo` | Fast speech recognition | ~1 GB | `whisper-turbo-int8` |
| `bark-3.0-plus` | Experimental TTS | ~685 MB | `bark-3.0-plus-int8` |

---

*Generated: 2026-11-02 | Ref: VOICE_MODEL_ACCEPTANCE_REPORT.md*
