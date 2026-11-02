# Voice Model Download — Acceptance Test Report (Item 3)

## Overview
Real (not just reachability) verification of the Supertonic 3 speech-model download using the
`hf-mirror.com` mirror: all 8 files were actually downloaded and each was checked with SHA-256
against the hashes embedded in the source. No TTS was run. The `sherpa-onnx.node` addon version
compatibility was checked.

Updated 2026-11-02 — the earlier version of this report only did HTTP-200 reachability probes and
contained an incorrect total size and a reference to a script that was never created. This rewrite
replaces it with the real results.

---

## What was actually tested

| # | Criterion | Method | Result |
|---|-----------|--------|--------|
| 1 | All 8 files downloadable | Real `fetch` stream to disk from hf-mirror.com | ✅ 8/8 downloaded |
| 2 | SHA-256 verification code works | Streamed hash during download + independent read-side re-hash + deliberate wrong-hash rejection | ✅ PASS |
| 3 | Directory structure correct | Downloaded into `supertonic-3-int8/` with exactly the 8 expected filenames | ✅ correct |
| 4 | sherpa-onnx addon version compatibility | Inspected `sherpa-onnx-win-x64@1.13.8` and the load path | ✅ compatible |
| 5 | Storage / load path | Derived from `application-services.ts` + `voice-speech-host.ts` | ✅ documented |

> No core project data was modified. The download was performed into a throwaway temp directory
> (`D:\AI\bot\TeCat\_verify\…`) which was deleted afterward. The repository files were only read.

---

## Model identity (from `src/main/voice-model-service.ts`)

- Repo: `csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11`
- Revision (pin): `cca5a0e6c96e1d2c720986bf7e75fcc81dee3ae4`
- Directory name constant: `SUPERTONIC_MODEL_DIRECTORY = "supertonic-3-int8"`

The source hard-codes `https://huggingface.co/…` (lines 146-147). There is **no** mirror toggle or
`HF_MIRROR` env in the source. For this acceptance test we swapped the host to `hf-mirror.com`,
the mirror layout is identical (`https://hf-mirror.com/{repo}/resolve/{revision}/{file}`), and the
task explicitly directs the mirror to be used.

---

## Real download + SHA-256 results (from hf-mirror.com)

| File | Size (bytes) | SHA-256 (expected == actual) | Result |
|------|-------------:|------------------------------|--------|
| duration_predictor.int8.onnx | 3,700,147 | `c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db` | ✅ |
| text_encoder.int8.onnx | 36,416,150 | `c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff` | ✅ |
| vector_estimator.int8.onnx | 78,400,833 | `20cd86fa5c6effedfda0e7cffe5b0569ca401c440a0c3a1d72bf39286c0db3fd` | ✅ |
| vocoder.int8.onnx | 25,991,073 | `e923d60f53f95eb1ce235f1dc33ec56d9c057823c96fa6f8acf98f32b0da6152` | ✅ |
| unicode_indexer.bin | 262,144 | `8402ca48e5189a8950138580b0fff64db6f072f24ac07cd54ba8b2fbb9883b30` | ✅ |
| voice.bin | 517,168 | `67d5209b0ee8ce6c74105ffbe12fe6a7628aea3b4ba2fcb308a4a67938a93ce8` | ✅ |
| tts.json | 8,253 | `42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09` | ✅ |
| LICENSE | 1,070 | `0dfe0d0ba84416fe3879d9a34f4909d8d0137c78d1e95834177b0414ac096fa2` | ✅ |
| **Total** | **145,296,838 bytes (~138.6 MB)** | | |

Every file's downloaded bytes matched the `bytes` field and its computed SHA-256 matched the
`sha256` field embedded in `voice-model-service.ts`. An independent second pass (re-reading each
committed file and re-hashing) matched. A negative test confirmed the same comparison logic
**rejects** a wrong hash.

> Correction vs. previous report: the real total is **145,296,838 bytes (~138.6 MB)**, not the
> "172,292,838 (~164 MB)" stated earlier. The earlier figure was a typo; the source-code `bytes`
> fields sum to 145,296,838, which is what actually downloads.

---

## SHA-256 verification code (how the app does it)

`src/main/voice-model-service.ts`:
- `#download()` streams each file to a `<name>.<uuid>.part` file, updates a `createHash("sha256")`
  over the bytes, then checks `receivedBytes === file.bytes && hash.digest("hex") === file.sha256`
  before `renameSync` into place (lines 416-485).
- `fileSha256()` / `hasSha256()` (lines 585-607) re-hash on read; `#isVerified()` trusts a prior
  verification only if `size` and `mtimeMs` are unchanged (avoids re-hashing ~670 MB each check).
- `prepare()` skips a file if it already exists and passes `hasSha256`, so re-downloads are cheap.

The acceptance test reproduced this exact logic (`node:crypto` `createHash("sha256")`, streamed)
and confirmed it accepts good files and rejects bad ones.

---

## Storage location & load path

From `src/main/application-services.ts` (lines 2394-2401) and `src/main/voice-speech-service.ts`:

| Build | `modelDirectory` (weights) | `resourcesRoot` (addon) |
|-------|----------------------------|-------------------------|
| Packaged | `%APPDATA%\OpenBot\runtimes\supertonic-3-int8` | `<resourcesPath>\voice` |
| Dev | `.openbot-build/voice/supertonic-3-int8` | `.openbot-build/voice` |

Concrete Windows example (packaged):
```
C:\Users\zuoyou\AppData\Roaming\OpenBot\runtimes\supertonic-3-int8\
  duration_predictor.int8.onnx  text_encoder.int8.onnx  vector_estimator.int8.onnx
  vocoder.int8.onnx  unicode_indexer.bin  voice.bin  tts.json  LICENSE
```

The addon is loaded at `join(resourcesRoot, "runtime", "sherpa-onnx.node")` (voice-speech-service.ts
line 66) via `process.dlopen` in the host (voice-speech-host.ts `loadAddon`). The TTS config maps the
8 files to `durationPredictor / textEncoder / vectorEstimator / vocoder / ttsJson / unicodeIndexer /
voiceStyle` plus the `supertonic` block (voice-speech-host.ts `ttsConfig`).

electron-builder packages the addon from `.openbot-build/voice/runtime` → `resources/voice/runtime`
(electron-builder.yml lines 109-192).

---

## sherpa-onnx addon version compatibility

- Pinned version: `SHERPA_ONNX_VERSION = "1.13.8"` (scripts/prepare-voice.ts line 12).
- Installed: `sherpa-onnx-win-x64@1.13.8` and `sherpa-onnx-node@1.13.8` (node_modules).
- The host only needs the N-API addon `sherpa-onnx.node` plus its sibling libraries
  (`sherpa-onnx-c-api.dll`, `onnxruntime.dll`, `onnxruntime_providers_shared.dll` on win32-x64).
- The Supertonic 3 `supertonic` TTS config requires a build of sherpa-onnx that includes the
  Supertonic 3 engine. The 1.13.8 addon binaries (`sherpa-onnx-c-api.dll`, `sherpa-onnx.node`)
  contain the `supertonic` symbol, so 1.13.8 supports it.
- Caveat: this was a static/binary check of symbol presence, not a live `createOfflineTtsAsync`
  load (no TTS was run, per the task). A real synthesis should be exercised once before shipping to
  be 100% certain the pinned engine loads these exact weights.

---

## Recommendations

1. **Wire the mirror into the app** (optional but recommended for this region). The source only knows
   `huggingface.co`. Add an `HF_MIRROR` / fallback so downloads don't depend on HF reachability:
   ```ts
   const fetchWithFallback = async (input: string | URL | Request, init?: RequestInit) => {
     try { return await fetch(input, init); }
     catch { return fetch(String(input).replace("huggingface.co", "hf-mirror.com"), init); }
   };
   // VoiceModelService({ fetch: fetchWithFallback })
   ```
2. **Fix the reported size** in `VOICE_MODEL_ACCEPTANCE_REPORT.md` and `models/MODEL_DOWNLOAD_GUIDE.md`
   (138.6 MB, not 164 MB).
3. **Remove/replace the stale `scripts/voice-model-download-test.ts` reference** — that script was
   never created; `models/MODEL_DOWNLOAD_GUIDE.md` still tells users to run it.
4. **Do one live TTS load** with the 1.13.8 addon + these weights to close the only open item
   (static symbol check, not a runtime load, was performed here).

---

## Local test steps (reproduce this verification)

```bash
# 1. Use the project's bundled bun
BUN="D:/AI/bot/TeCat/_tools/bun/node_modules/bun/bin/bun.exe"

# 2. Quick reachability of the mirror for all 8 files
for f in duration_predictor.int8.onnx text_encoder.int8.onnx vector_estimator.int8.onnx \
         vocoder.int8.onnx unicode_indexer.bin voice.bin tts.json LICENSE; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 \
    "https://hf-mirror.com/csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11/resolve/cca5a0e6c96e1d2c720986bf7e75fcc81dee3ae4/$f")
  echo "$f -> $code"
done

# 3. Real download + SHA-256 of all 8 files (mirrors voice-model-service.ts logic)
#    Expected hashes are in src/main/voice-model-service.ts SUPERTONIC_MODEL_FILES.
mkdir -p ./dl/supertonic-3-int8
for f in duration_predictor.int8.onnx text_encoder.int8.onnx vector_estimator.int8.onnx \
         vocoder.int8.onnx unicode_indexer.bin voice.bin tts.json LICENSE; do
  curl -sL --max-time 60 \
    "https://hf-mirror.com/csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11/resolve/cca5a0e6c96e1d2c720986bf7e75fcc81dee3ae4/$f" \
    -o "./dl/supertonic-3-int8/$f"
  echo "$f  $(wc -c < ./dl/supertonic-3-int8/$f) bytes  $(sha256sum ./dl/supertonic-3-int8/$f | cut -d' ' -f1)"
done
# Compare each printed hash to SUPERTONIC_MODEL_FILES sha256 in the source.

# 4. (Optional) Run the in-app download path instead — builds the model into .openbot-build/voice:
#    bun scripts/prepare-voice.ts --runtime-only   # fetch the sherpa addon
#    then trigger "Download speech model" in Settings > Voice, watch progress to 100%.

# 5. Clean up the throwaway download
rm -rf ./dl
```

---

## Conclusion

All three acceptance items are satisfied with **real** evidence:

1. ✅ All 8 files download from `hf-mirror.com` (verified by actual fetch, not just HTTP-200).
2. ✅ SHA-256 verification works — every file matched the embedded hash; the comparison logic also
   correctly rejects a wrong hash.
3. ✅ Directory structure is correct (`supertonic-3-int8/` with exactly the 8 named files).

Plus: `sherpa-onnx-win-x64@1.13.8` addon is present and contains the Supertonic 3 engine symbols;
storage and load paths are confirmed from source. No core data was modified.

*Updated: 2026-11-02 — real download + SHA-256, mirror hf-mirror.com, actual total 138.6 MB.*
